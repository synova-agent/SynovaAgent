/**
 * engine-auth/rbac.ts — RBAC 权限实现
 *
 * 三级角色: admin (全部) > manager (本团队+公开) > employee (本团队公开+公开)
 *
 * 规则:
 *   admin → FilterClause 为空 (无条件通过)
 *   manager → level IN ('public', 'team') AND teamId = 本团队 AND sensitivity != 'restricted'
 *   employee → level IN ('public') OR (level='team' AND teamId = 本团队 AND sensitivity != 'restricted')
 */
import type {
  UserContext, FilterClause, FilterCondition,
  ResourceRef, PermissionAction, AccessTags,
} from './types';
import type { AuthProvider } from './auth-provider';
import { createUserCache } from './cache';
import type { UserCache } from './cache';
import { createLogger } from '../../logger/src/index';

const log = createLogger('engine-auth/rbac');

// ═══ 角色层级 ═══

const ROLE_HIERARCHY: Record<string, number> = {
  admin: 100,
  manager: 50,
  employee: 20,
  viewer: 10,
  external: 5,
};

function getMaxRole(roles: string[]): string {
  let max = '', maxLvl = 0;
  for (const r of roles) {
    const lvl = ROLE_HIERARCHY[r] || 0;
    if (lvl > maxLvl) { max = r; maxLvl = lvl; }
  }
  return max;
}

// ═══ FilterClause 生成 ═══

/**
 * 根据用户角色生成 FilterClause。
 *
 * admin → []
 * manager → [{ field: 'access.level', operator: 'IN', value: ['public', 'team'] },
 *             { field: 'access.teamId', operator: 'EQ', value: teamId },
 *             { field: 'access.sensitivity', operator: 'NOT_EQ', value: 'restricted' }]
 * employee → [{ field: 'access.level', operator: 'IN', value: ['public'] }]
 *            OR [{ field: 'access.level', operator: 'EQ', value: 'team' },
 *                { field: 'access.teamId', operator: 'EQ', value: teamId }]
 */
function buildFilterClause(ctx: UserContext, _resourceType: string, _action: PermissionAction): FilterClause {
  const maxRole = getMaxRole(ctx.auth.roles);

  if (maxRole === 'admin') {
    return { conditions: [] }; // 无条件
  }

  const conditions: FilterCondition[] = [];

  if (maxRole === 'manager') {
    conditions.push(
      { field: 'access.level', operator: 'IN', value: ['public', 'team'] },
      { field: 'access.teamId', operator: 'EQ', value: ctx.auth.teamId },
      { field: 'access.sensitivity', operator: 'NOT_EQ', value: 'restricted' },
    );
  } else {
    // employee / viewer / external
    conditions.push(
      { field: 'access.level', operator: 'IN', value: ['public'] },
    );
    // 也可以访问自己团队的非敏感数据
    if (ctx.auth.teamId) {
      // 用 OR 逻辑: public OR (team AND same team AND not restricted)
      // 简化: 用两组合并 — 实际 SQL 中需要 CASE/OR
      // 这里返回单组条件，L4 实现时做 OR 拼接
      conditions.push(
        { field: 'access.teamId', operator: 'EQ', value: ctx.auth.teamId },
        { field: 'access.sensitivity', operator: 'NOT_EQ', value: 'restricted' },
      );
    }
  }

  // 敏感用户限制
  if (ctx.auth.sensitivity === 'sensitive') {
    conditions.push({ field: 'access.sensitivity', operator: 'IN', value: ['normal'] });
  }

  if (conditions.length === 0) {
    conditions.push({ field: 'access.level', operator: 'EQ', value: 'public' });
  }

  return { conditions };
}

// ═══ RBAC Provider ═══

export interface RBACConfig {
  /** 用户数据源: 根据 token 返回 UserContext */
  resolveUser: (token: string) => Promise<UserContext | null>;
  /** 缓存配置 */
  cacheMaxSize?: number;
  cacheTtlMs?: number;
}

export function createRBACProvider(config: RBACConfig): AuthProvider & { cache: UserCache; flushUser(token: string): Promise<void> } {
  const cache = createUserCache(config.cacheMaxSize, config.cacheTtlMs);

  return {
    cache,

    async getUserContext(token: string): Promise<UserContext> {
      const cached = cache.get(token);
      if (cached) return cached;

      const ctx = await config.resolveUser(token);
      if (!ctx) throw new Error('AUTH_FAILED: 无法解析用户身份');

      cache.set(token, ctx);
      return ctx;
    },

    async checkPermission(ctx: UserContext, _resource: ResourceRef, _action: PermissionAction): Promise<boolean> {
      // 简化: admin 全部通过，其他角色通过 FilterClause 间接控制
      const maxRole = getMaxRole(ctx.auth.roles);
      return maxRole === 'admin';
    },

    async filterResources<T extends Record<string, unknown>>(
      _ctx: UserContext,
      resources: T[],
      _action: PermissionAction,
    ): Promise<T[]> {
      // 基础实现: 资源自带 access 标签 → 按标签过滤
      // 完整实现需遍历 FilterClause
      const filter = buildFilterClause(_ctx, 'resource', _action);
      if (filter.conditions.length === 0) return resources;

      return resources.filter(r => {
        // K12-11 (#194): 类型收窄（行为逐字不变）—— 本文件此前**不在** `tsc` 程序内
        // （`src/` 无人 import 本包）；本卡把项模型接进 `src/middleware/auth.ts` 后，本文件
        // 才第一次被类型检查，暴露出这两处既有类型问题。此处只做类型级收窄，**不改判定逻辑**。
        const props = (r as { props?: Record<string, unknown> }).props;
        const access = (r.access ?? props?.['access']) as AccessTags | undefined;
        if (!access) return false; // 无标签 → 不通过
        return checkAccessTags(access, filter.conditions);
      });
    },

    async getPermissionFilter(ctx: UserContext, resourceType: string, action: PermissionAction): Promise<FilterClause> {
      const filter = buildFilterClause(ctx, resourceType, action);
      log.debug({ userId: ctx.userId, role: getMaxRole(ctx.auth.roles), resourceType, conditions: filter.conditions.length },
        'FilterClause 已生成');
      return filter;
    },

    async flushUser(token: string): Promise<void> {
      cache.invalidate(token);
    },
  };
}

// ═══ 辅助 ═══

function checkAccessTags(access: AccessTags, conditions: FilterCondition[]): boolean {
  // K12-11 (#194): 类型级收窄（行为逐字不变）—— 接口类型无索引签名，不能直接 `as Record<string, unknown>`
  //   （TS2352「sufficiently overlaps」）；用对象展开得到可索引的字面量类型，**不写断言族**。
  const bag: Record<string, unknown> = { ...access };
  for (const c of conditions) {
    const val = bag[c.field.replace('access.', '')];
    if (c.operator === 'IN') {
      const allowed = c.value as unknown[];
      if (!allowed.includes(val)) return false;
    } else if (c.operator === 'EQ') {
      if (val !== c.value) return false;
    } else if (c.operator === 'NOT_EQ') {
      if (val === c.value) return false;
    }
  }
  return true;
}
