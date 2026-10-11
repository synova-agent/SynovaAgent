/**
 * src/onboarding/config-pack-generator.ts — 建档「文档进 → 配置出」的配置包生成器
 *
 * 架构位置: **⓪-b 人侧入口**（宪章 §4.1「人侧 extensions/presets/ + extensions/onboarding/」）。
 *   本文件把建档采集结果**落成内容面文件**（`extensions/presets/roles/{id}/` 五件套），
 *   使「丢一批文档 ⇒ 产出可用的岗位预设包」成立，且**加岗位不改宿主代码**。
 *
 * 出处: K12-03（#186）卡面 §Q2 写集 / §Q3 判据 V1（dry-run 不落盘）+ V2（真落盘 ≥2 角色目录）。
 *
 * 契约（铁律 47）:
 *   @input  — `GenerateConfigPackInput`：{ roles: RoleSeed[], rootDir?: string, dryRun?: boolean }
 *             `roles[]` 每项 = { roleId, knowledgeScope?, capabilities?, acceptanceCriteria? }
 *   @output — `ConfigPackResult`：{ written: string[], planned: string[], skipped: string[],
 *               degraded: boolean, errors: string[] }
 *             `dryRun=true` ⇒ **一律不落盘**（`written` 空，`planned` 列将写路径）——
 *             卡面 V1 明令「dry-run 不应写文件」（判据探针 `probe-onboarding.ts` 据此判红）。
 *   @degraded — 目录不可写 / 写失败 ⇒ **不抛**，进 `errors[]` + `log.error` + `degraded: true`
 *             （铁律 11/24/31：不静默降级）。roleId 非法（非 `[a-z0-9-]+`）⇒ 跳过并实名进 errors
 *             （**防路径穿越**，见 `SAFE_ROLE_ID`）。
 */
import { createLogger } from '@synova/logger';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const log = createLogger('onboarding/config-pack-generator');

/** 内容根（仓库相对）——与 `preset-loader.ts` 的 `PRESETS_DIR` 同源 */
const PRESETS_DIR = 'extensions/presets';
/** 角色目录所在（相对内容根） */
const ROLES_SUBDIR = 'roles';

/** 🔴 角色 id 白名单（防路径穿越：`../` / 绝对路径 / 空段一律不合法） */
const SAFE_ROLE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** 一个岗位的采集种子 */
export interface RoleSeed {
  /** 角色 id（= 目录名；须匹配 `SAFE_ROLE_ID`） */
  readonly roleId: string;
  /** 知识可见范围声明（落 `knowledge-scope.yaml` 的载荷） */
  readonly knowledgeScope?: readonly string[];
  /** 能力清单（落 `capabilities.yaml`） */
  readonly capabilities?: readonly string[];
  /** 验收判据（落 `acceptance-criteria.yaml`） */
  readonly acceptanceCriteria?: readonly string[];
}

/** `generateConfigPack()` 入参 */
export interface GenerateConfigPackInput {
  readonly roles: readonly RoleSeed[];
  /** 仓库根（缺省 `process.cwd()`）；测试注入缝 */
  readonly rootDir?: string;
  /** true ⇒ 只算不写（判据 V1） */
  readonly dryRun?: boolean;
}

/** `generateConfigPack()` 返回 */
export interface ConfigPackResult {
  /** 真写入的文件（仓库相对路径，已排序） */
  readonly written: readonly string[];
  /** dry-run 下"本会写入"的文件（仓库相对路径，已排序） */
  readonly planned: readonly string[];
  /** 因 roleId 非法而跳过的角色（含原因） */
  readonly skipped: readonly string[];
  readonly degraded: boolean;
  readonly errors: readonly string[];
}

/** YAML 列表渲染（纯字符串数组，不引入 YAML 依赖 —— 值来源是内部种子，非用户文本） */
function renderListYaml(key: string, items: readonly string[]): string {
  const head = '# 由 K12-03 建档通道生成（生成器: src/onboarding/config-pack-generator.ts）\n';
  const body = items.length === 0 ? `${key}: []\n` : `${key}:\n${items.map((i) => `  - ${i}\n`).join('')}`;
  return head + body;
}

/** 单角色要写的文件（相对角色目录）→ 内容 */
function roleFiles(seed: RoleSeed): readonly { readonly name: string; readonly body: string }[] {
  return [
    {
      name: 'knowledge-scope.yaml',
      body: renderListYaml('knowledgeScope', seed.knowledgeScope ?? []),
    },
    {
      name: 'capabilities.yaml',
      body: renderListYaml('capabilities', seed.capabilities ?? []),
    },
    {
      name: 'acceptance-criteria.yaml',
      body: renderListYaml('acceptanceCriteria', seed.acceptanceCriteria ?? []),
    },
  ];
}

/**
 * 把采集结果生成配置包（内容面文件）。
 *
 * 🔴 `dryRun` 语义不可妥协：**任何文件系统写入都不发生**（判据 V1）。
 */
export function generateConfigPack(input: GenerateConfigPackInput): ConfigPackResult {
  const root = input.rootDir ?? process.cwd();
  const dryRun = input.dryRun === true;
  const written: string[] = [];
  const planned: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const seed of input.roles) {
    if (!SAFE_ROLE_ID.test(seed.roleId)) {
      const why = `${seed.roleId}: roleId 非法（须匹配 ${String(SAFE_ROLE_ID)}，防路径穿越）`;
      skipped.push(why);
      errors.push(why);
      log.warn({ roleId: seed.roleId }, 'roleId 非法 — 跳过该角色（degraded）');
      continue;
    }
    const relDir = join(PRESETS_DIR, ROLES_SUBDIR, seed.roleId);
    for (const file of roleFiles(seed)) {
      const rel = join(relDir, file.name);
      if (dryRun) {
        planned.push(rel);
        continue;
      }
      try {
        const absDir = join(root, relDir);
        mkdirSync(absDir, { recursive: true });
        writeFileSync(join(root, rel), file.body, 'utf8');
        written.push(rel);
      } catch (err: unknown) {
        const msg = `${rel}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        log.error({ rel, err }, '配置包写入失败 — degraded');
      }
    }
  }

  const degraded = errors.length > 0;
  log.info({ dryRun, written: written.length, planned: planned.length, degraded }, '配置包生成完成');
  return {
    written: written.sort(),
    planned: planned.sort(),
    skipped: skipped.sort(),
    degraded,
    errors,
  };
}
