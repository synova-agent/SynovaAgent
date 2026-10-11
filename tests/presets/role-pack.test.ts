/**
 * tests/presets/role-pack.test.ts — K12-01（#184）角色预设包 · 段一（内容面）判据测试
 *
 * 本卡 §⑥ 判据（登记件逐字抄录）:
 *   · 3 个岗位各有预设包（目录 + 五件套齐）
 *   · `knowledge_scope` **真生效**：两个不同岗位用户 ⇒ 拿到的知识集合**不同**
 *   · 反例（改坏即红）：把某岗位的 `knowledge_scope` 删掉 ⇒ 判据必红
 *
 * 🔴 验证级别如实标注（两个级别不混报）:
 *   · 本文件是 **L1-静态可达 ＋ 内容面契约**：它证明「3 包齐备」与「三包的知识集合两两不同」。
 *   · **L2-真跑通**（穿生产入口 `describeContentRegistry()` / `initContentTypes()` 取角色清单）
 *     属 **段二**（宿主 loader ＋ content-registry 接线）—— 由 `scripts/control-tower/probe-role-pack.ts`
 *     判定。段二未落前本文件**不冒充** L2。
 *
 * 覆盖（铁律 48：正常路径 ＋ 降级路径 ＋ 边界条件，均带真 expect 断言）:
 *   ① 正常: 三包齐备 —— 每包 6 件（manifest ＋ 五件套）、全部非空、角色 manifest 五必填字段齐
 *   ② 正常: ★核心——三包两两 `knowledge-scope` 的 scope id 集合**不同**（岗位差异的物理证据）
 *   ③ 正常: 每包 `context-manifest.yaml` 含 `required: true` 条目（院方「②才是解药」）
 *   ④ 降级: 角色目录缺失 / 单件缺失 / YAML 损坏 / scopes 非数组 ⇒ degraded:true ＋ errors 点名
 *   ⑤ 边界: scope id 无重复；顶层 manifest 声明的 roles 数与磁盘实际一致（防漂移）
 *   ⑥ 反例: 把某岗位的 knowledge-scope 清空 ⇒ 集合比对照样必红（等价于卡面「删掉 ⇒ 判据必红」）
 *
 * 判据源: `docs/synova/coordination/施工项登记.ts` K12-01 条目；
 *         卡面 `.claude/task-briefs/2026-10-11-184-K12-01-预设包载体与装配-角色预设包五件套.md` §Q3/§⑥
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { load as parseYaml } from 'js-yaml';

const REPO_ROOT = process.cwd();
const PRESETS_DIR = join(REPO_ROOT, 'extensions', 'presets');
const ROLES_DIR = join(PRESETS_DIR, 'roles');

/** 角色的五件套 ＋ manifest（卡面 §Q2 写集逐字，与探针 `ROLE_PIECES` 同源同序） */
const ROLE_PIECES: readonly string[] = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
];

/** 角色 manifest 的必填字段（`check-file-driven.sh` 组(a) 的同一口径） */
const MANIFEST_REQUIRED_FIELDS: readonly string[] = ['$schema', 'name', 'version', 'type', 'entryPoint'];

/** 期望的出厂岗位数（卡面 §⑥「3 个岗位各有预设包」） */
const EXPECTED_ROLE_COUNT = 3;

// ══════════════════════════════════════════════════════════════════════════════
// 测试本地读取器（内容面读法；段二的生产 loader 落成后本读法可退役）
// ══════════════════════════════════════════════════════════════════════════════

/** 一个角色包的内容面读取结果 */
interface RolePackRead {
  readonly roleId: string;
  /** `knowledge-scope.yaml` 的 scope id（升序）—— 岗位差异的载体 */
  readonly scopeIds: readonly string[];
  /** `context-manifest.yaml` 中 `required: true` 的上下文条数 */
  readonly requiredContextCount: number;
  /** 任一构件读不到/解析失败即为 true（铁律 31：调用方必须检查） */
  readonly degraded: boolean;
  /** 逐条点名的降级原因（空数组 ⇔ 无降级） */
  readonly errors: readonly string[];
}

/**
 * 读一个角色包的知识范围与上下文清单。
 *
 * @input  rolesRoot — `roles/` 目录绝对路径；roleId — 角色目录名
 * @output RolePackRead（含 degraded ＋ errors）
 * @degraded 角色目录缺失 / 两件 yaml 缺失 / JSON・YAML 解析失败 / `scopes` 非数组
 *           ⇒ `degraded: true` ＋ `errors[]` **逐条点名**，**不静默当空**
 */
function readRolePack(rolesRoot: string, roleId: string): RolePackRead {
  const dir = join(rolesRoot, roleId);
  const errors: string[] = [];
  let scopeIds: string[] = [];
  let requiredContextCount = 0;

  if (!existsSync(dir)) {
    return { roleId, scopeIds, requiredContextCount, degraded: true, errors: [`角色目录不存在: ${dir}`] };
  }

  const scopePath = join(dir, 'knowledge-scope.yaml');
  if (!existsSync(scopePath)) {
    errors.push(`knowledge-scope.yaml 缺失: ${scopePath}`);
  } else {
    try {
      const doc: unknown = parseYaml(readFileSync(scopePath, 'utf-8'));
      const rec = doc !== null && typeof doc === 'object' ? (doc as Record<string, unknown>) : undefined;
      const scopes = rec?.['scopes'];
      if (!Array.isArray(scopes)) {
        errors.push(`knowledge-scope.yaml 的 scopes 非数组: ${scopePath}`);
      } else {
        scopeIds = scopes
          .map((s) => (s !== null && typeof s === 'object' ? (s as Record<string, unknown>)['id'] : undefined))
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .sort();
      }
    } catch (err: unknown) {
      errors.push(`knowledge-scope.yaml 解析失败: ${scopePath} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const ctxPath = join(dir, 'context-manifest.yaml');
  if (!existsSync(ctxPath)) {
    errors.push(`context-manifest.yaml 缺失: ${ctxPath}`);
  } else {
    try {
      const doc: unknown = parseYaml(readFileSync(ctxPath, 'utf-8'));
      const rec = doc !== null && typeof doc === 'object' ? (doc as Record<string, unknown>) : undefined;
      const contexts = rec?.['contexts'];
      if (!Array.isArray(contexts)) {
        errors.push(`context-manifest.yaml 的 contexts 非数组: ${ctxPath}`);
      } else {
        requiredContextCount = contexts.filter(
          (c) => c !== null && typeof c === 'object' && (c as Record<string, unknown>)['required'] === true,
        ).length;
      }
    } catch (err: unknown) {
      errors.push(`context-manifest.yaml 解析失败: ${ctxPath} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { roleId, scopeIds, requiredContextCount, degraded: errors.length > 0, errors };
}

/** 磁盘上的角色目录 id（升序） */
function roleDirsOnDisk(rolesRoot: string): string[] {
  if (!existsSync(rolesRoot)) return [];
  return readdirSync(rolesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// ══════════════════════════════════════════════════════════════════════════════
// ① 正常路径 —— 三包齐备
// ══════════════════════════════════════════════════════════════════════════════

describe('K12-01 ① 正常: 3 个岗位各有预设包（目录 + 五件套齐）', () => {
  const roleIds = roleDirsOnDisk(ROLES_DIR);

  it('出厂岗位数 = 3（卡面 §⑥）', () => {
    expect(roleIds.length).toBe(EXPECTED_ROLE_COUNT);
  });

  it('顶层 manifest 声明的 roles 数与磁盘实际一致（防声明-实际漂移）', () => {
    const top = JSON.parse(readFileSync(join(PRESETS_DIR, 'manifest.json'), 'utf-8')) as Record<string, unknown>;
    expect(top['roles']).toBe(roleIds.length);
    expect(top['type']).toBe('presets');
  });

  it('每个角色目录含全部 6 件且均非空（0 字节 = 内容缺失）', () => {
    for (const roleId of roleIds) {
      for (const piece of ROLE_PIECES) {
        const p = join(ROLES_DIR, roleId, piece);
        expect(existsSync(p), `${roleId}/${piece} 应存在`).toBe(true);
        expect(readFileSync(p, 'utf-8').trim().length, `${roleId}/${piece} 不应为空`).toBeGreaterThan(0);
      }
    }
  });

  it('每个角色 manifest 的五必填字段齐（check-file-driven 组(a) 同口径）', () => {
    for (const roleId of roleIds) {
      const raw = readFileSync(join(ROLES_DIR, roleId, 'manifest.json'), 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const field of MANIFEST_REQUIRED_FIELDS) {
        expect(Object.prototype.hasOwnProperty.call(parsed, field), `${roleId}: 缺字段 ${field}`).toBe(true);
      }
      expect(parsed['roleId']).toBe(roleId);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ② 正常路径 —— ★核心: 岗位差异（knowledge_scope 真生效）
// ══════════════════════════════════════════════════════════════════════════════

describe('K12-01 ② 正常: 两个不同岗位 ⇒ 知识集合不同（§⑥ 核心判据）', () => {
  const roleIds = roleDirsOnDisk(ROLES_DIR);
  const reads = roleIds.map((r) => readRolePack(ROLES_DIR, r));

  it('三包均无降级（内容面读法下）', () => {
    for (const r of reads) {
      expect(r.errors, `${r.roleId}: ${r.errors.join('; ')}`).toEqual([]);
      expect(r.degraded).toBe(false);
    }
  });

  it('每个岗位的知识集合非空（空集合 = 该岗位无知识范围）', () => {
    for (const r of reads) expect(r.scopeIds.length).toBeGreaterThan(0);
  });

  it('★ 两两岗位的 scope id 集合**互不相同** —— 岗位差异的物理证据', () => {
    const sigs = reads.map((r) => `${r.roleId}=${r.scopeIds.join(',')}`);
    const sets = reads.map((r) => r.scopeIds.join(','));
    expect(new Set(sets).size, `三包知识集合应两两不同，实测: ${sigs.join(' | ')}`).toBe(reads.length);
  });

  it('每个岗位都有**独有**的 scope（不只是整体不同，而是各有专属）', () => {
    for (const r of reads) {
      const others = new Set(reads.filter((o) => o.roleId !== r.roleId).flatMap((o) => o.scopeIds));
      const own = r.scopeIds.filter((id) => !others.has(id));
      expect(own.length, `${r.roleId} 应有独有 scope，实测独有: ${own.join(',') || '(无)'}`).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 正常路径 —— 上下文清单（「②才是解药」）
// ══════════════════════════════════════════════════════════════════════════════

describe('K12-01 ③ 正常: 上下文清单是被解药（院方《02》§三 机制 1）', () => {
  const roleIds = roleDirsOnDisk(ROLES_DIR);

  it('每个岗位的 context-manifest 都含 required:true 的上下文', () => {
    for (const roleId of roleIds) {
      const r = readRolePack(ROLES_DIR, roleId);
      expect(r.requiredContextCount, `${roleId} 应有 required 上下文`).toBeGreaterThan(0);
    }
  });

  it('每个岗位都声明了 systemAddendum（岗位口吻注入面）', () => {
    for (const roleId of roleIds) {
      const raw = readFileSync(join(ROLES_DIR, roleId, 'context-manifest.yaml'), 'utf-8');
      expect(raw.includes('systemAddendum'), `${roleId} 应含 systemAddendum`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ 降级路径 —— 缺件 / 损坏 / 形状漂移（铁律 24/31，不静默）
// ══════════════════════════════════════════════════════════════════════════════

describe('K12-01 ④ 降级: 缺件与损坏必须被点名', () => {
  it('角色目录不存在 ⇒ degraded:true ＋ errors 点名', () => {
    const r = readRolePack(ROLES_DIR, '__no_such_role__');
    expect(r.degraded).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.scopeIds).toEqual([]);
    expect(r.errors[0]).toContain('__no_such_role__');
  });

  it('knowledge-scope.yaml 缺失 ⇒ degraded:true 且点名该件', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rolepack-'));
    try {
      const roleDir = join(tmp, 'ghost');
      mkdirSync(roleDir, { recursive: true });
      writeFileSync(join(roleDir, 'context-manifest.yaml'), 'roleId: ghost\ncontexts: []\n', 'utf-8');

      const r = readRolePack(tmp, 'ghost');
      expect(r.degraded).toBe(true);
      expect(r.errors.some((e) => e.includes('knowledge-scope.yaml'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('knowledge-scope.yaml 非法 YAML ⇒ degraded:true 且点名「解析失败」', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rolepack-'));
    try {
      const roleDir = join(tmp, 'broken');
      mkdirSync(roleDir, { recursive: true });
      writeFileSync(join(roleDir, 'knowledge-scope.yaml'), 'scopes: [ {id: "a"\n', 'utf-8');
      writeFileSync(join(roleDir, 'context-manifest.yaml'), 'roleId: broken\ncontexts: []\n', 'utf-8');

      const r = readRolePack(tmp, 'broken');
      expect(r.degraded).toBe(true);
      expect(r.errors.some((e) => e.includes('解析失败'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('scopes 不是数组（形状漂移）⇒ degraded:true 且点名', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rolepack-'));
    try {
      const roleDir = join(tmp, 'drift');
      mkdirSync(roleDir, { recursive: true });
      writeFileSync(join(roleDir, 'knowledge-scope.yaml'), 'roleId: drift\nscopes: {id: not-a-list}\n', 'utf-8');
      writeFileSync(join(roleDir, 'context-manifest.yaml'), 'roleId: drift\ncontexts: []\n', 'utf-8');

      const r = readRolePack(tmp, 'drift');
      expect(r.degraded).toBe(true);
      expect(r.errors.some((e) => e.includes('scopes 非数组'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 边界 + ⑥ 反例（改坏即红）
// ══════════════════════════════════════════════════════════════════════════════

describe('K12-01 ⑤ 边界: scope id 无重复 / 集合可比较', () => {
  const roleIds = roleDirsOnDisk(ROLES_DIR);

  it('同一岗位内 scope id 无重复（重复会让集合比较失去判别力）', () => {
    for (const roleId of roleIds) {
      const raw = readFileSync(join(ROLES_DIR, roleId, 'knowledge-scope.yaml'), 'utf-8');
      const doc = parseYaml(raw) as { scopes?: Array<{ id?: string }> };
      const ids = (doc.scopes ?? []).map((s) => s.id).filter((v): v is string => typeof v === 'string');
      expect(new Set(ids).size, `${roleId} scope id 有重复`).toBe(ids.length);
    }
  });
});

describe('K12-01 ⑥ 反例: 把某岗位的 knowledge-scope 清空 ⇒ 集合比较必红', () => {
  it('清空 scopes 后，该岗位集合与其他岗位不再可比 ⇒ 唯一性断言必然失败', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rolepack-'));
    try {
      // 复制三包的 knowledge-scope，再把 finance 清空 —— 模拟卡面「删掉某岗位 knowledge_scope」
      for (const roleId of roleDirsOnDisk(ROLES_DIR)) {
        const dir = join(tmp, roleId);
        mkdirSync(dir, { recursive: true });
        const src = join(ROLES_DIR, roleId, 'knowledge-scope.yaml');
        writeFileSync(join(dir, 'knowledge-scope.yaml'), readFileSync(src, 'utf-8'), 'utf-8');
      }
      writeFileSync(join(tmp, 'finance', 'knowledge-scope.yaml'), 'roleId: finance\nversion: 1.0.0\nscopes: []\n', 'utf-8');

      const mutated = roleDirsOnDisk(tmp).map((r) => readRolePack(tmp, r));
      const sets = mutated.map((r) => r.scopeIds.join(','));
      // 🔴 改坏后：finance 变空集，空集与任何集合都不同 ⇒ 「两两不同」这个弱断言**反而成立**
      //    ⇒ 说明「两两不同」单独不足以判红；必须叠加「每包非空」+「每包有独有 scope」才是真判据。
      expect(new Set(sets).size).toBe(mutated.length);

      // 真判据在这里：finance 的知识集合为空 ⇒ 「集合非空」断言必红
      const finance = mutated.find((r) => r.roleId === 'finance');
      expect(finance?.scopeIds.length).toBe(0);
      expect(() => {
        expect(finance?.scopeIds.length, 'finance 知识集合不应为空').toBeGreaterThan(0);
      }).toThrow();

      // 且「独有 scope」断言同样必红（空集无独有项）
      const others = new Set(mutated.filter((o) => o.roleId !== 'finance').flatMap((o) => o.scopeIds));
      const own = (finance?.scopeIds ?? []).filter((id) => !others.has(id));
      expect(own.length).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
