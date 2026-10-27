/**
 * src/init/preset-loader.ts — 角色预设包（Role Pack）宿主侧 loader
 *
 * 架构位置: **⓪-b（人侧入口）内容载体** —— `extensions/presets/`（宪章 §4.1）。
 *   一个岗位一个目录，六件（v2：manifest ＋ 五件内容）声明「这个岗位该给 agent 带什么上下文」。
 *   **加一个角色目录 = 加一个岗位，不改宿主代码**（宪章三条不可妥协之①「文件驱动」）。
 *
 * 出处: K12-01 **段二**（#184）—— 段一已落内容面（`extensions/presets/**`，
 *   `content-registry` 登记为 `pending-cto`）；段二补宿主 loader + 接线，把该登记升为 `reachable`，
 *   使判据 `probe-role-pack.ts --role finance` 能从 exit 1 走到 exit 0。
 *   ⚠️ `manifest.json` 段一写明的 `exportKey: loadRolePacks` + `loaderPending: true`
 *   即本文件的接口预留 —— 本文件补齐后同步改 manifest（去 `loaderPending`、`entryPoint` 指本模块）。
 *
 * 🔴 本文件**不含任何角色硬编码清单**：角色集合一律从磁盘目录名推导。
 *   判据探针据此设反例 —— 「磁盘上每个角色目录都出现在生产入口的真实返回里」，
 *   硬编码角色表 ⇒ 新建目录不出现 ⇒ 探针判红（`probe-role-pack.ts` 边界声明 ①）。
 *
 * 契约（铁律 47）:
 *   @input  — 无参数（零参查询；探针只驱动零参导出，见 `probe-role-pack.ts`「观测面」段）。
 *             可选环境变量 `SYNOVA_PRESETS_ROOT` 覆盖内容根（测试注入缝，同 `SYNOVA_CONTENT_REGISTRY_DISABLE` 惯例）。
 *   @output — `loadRolePacks(): PresetLoadReport` — 角色清单 + 每角色的六件存在性 + v2 结构/refs 校验
 *             （`RolePack.schemaVersion`／`schemaValid`／`validation`，additive）＋ degraded 信号
 *             `listRolePacks(): string[]` — 角色 id 清单（零参，机器可观测）
 *             `resolveRoleKnowledgeScope(roleId)` — **请求路径**用的知识范围解析（#731 / T1；
 *               按需读盘 ＋ mtime/size 缓存，见下「二bis」段）
 *             （有参查询不入契约面：无生产消费方即不导出，避免"导出但无人调用"的表面积 —— 铁律 0-2）
 *               故探针不驱动；保留给生产消费方与测试）
 *   @degraded — 内容根缺失 / roles 目录缺失 / 角色目录内文件读不到 / **knowledge-scope.yaml 内容坏** /
 *             **v2 结构或 refs 对账不过**（#1075 P1-a）
 *             ⇒ **不抛**，返回 `degraded: true` + `errors[]` 逐条点名 + `log.warn/error`（铁律 11/24/31）。
 *             ⚠️ 区分三类：**ENOENT = 正常默认**（角色目录为空 / 该角色无 scope 文件 ⇒ degraded 但非错误）、
 *             **读失败/解析失败/形状非法 = 真错误**（进 `errors[]`）、
 *             **空文档（零内容或仅注释）= 未声明**（不计错；内容级红由 D5 探针 V1 的「scopes[] 为空」兜底 ——
 *             见 KL-T1-1）。
 * @authority — 由 `src/deploy/content-registry.ts` 的 `type:'presets'` 条目 init/cleanup 调用（boot 与
 *   content-reload 同一入口）；`probe-role-pack.ts` 只驱动零参只读导出；其它模块不得绕过 content-registry 直调。
 * @not-here  — 不做内容面热加载编排（`content-reload.ts`）；不改写磁盘（只读 loader）；不定义权限项
 *   （`permission-grants.ts`）；不实现 v2 结构与 refs 判定（唯一实现 = `src/init/role-pack-schema.ts`；
 *   loader 只折 problems 进 `errors[]`）。
 */
import { createLogger } from '@synova/logger';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { load as parseYaml } from 'js-yaml';
import {
  ROLE_PACK_PIECES,
  validateRolePackDir,
  type RolePackValidation,
} from './role-pack-schema';

const log = createLogger('init/preset-loader');

/** 内容根（仓库相对）。环境变量覆盖 = 测试注入缝。 */
const PRESETS_DIR = 'extensions/presets';
/** 角色目录所在（相对内容根） */
const ROLES_SUBDIR = 'roles';

/** 一个岗位预设包 */
export interface RolePack {
  /** 角色 id（= 目录名，去扩展名前的原名） */
  readonly roleId: string;
  /** 本包**实际存在且非空**的六件文件名（按磁盘实测，非声明） */
  readonly pieces: readonly string[];
  /** 六件里缺失的文件名（空数组 = 齐备） */
  readonly missing: readonly string[];
  /** 六件里 `knowledge-scope.yaml` 的**内容**解析结果（#731 / T1；additive，不改既有字段语义） */
  readonly knowledgeScope: KnowledgeScopeDeclaration;
  /** 包契约版本（`manifest.schemaVersion`；缺失/不可读 ⇒ null）—— #1075 P1-a additive */
  readonly schemaVersion: number | null;
  /** v2 结构 ＋ refs 对账是否通过（缺 `manifest.json` ⇒ false＝未完成校验，原因在 `missing`） */
  readonly schemaValid: boolean;
  /** 校验明细（纯数据；`problems` 已逐条折进 `PresetLoadReport.errors`）—— #1075 P1-a additive */
  readonly validation: RolePackValidation;
}

/** `loadRolePacks()` 的返回 */
export interface PresetLoadReport {
  /** 内容根绝对路径 */
  readonly root: string;
  /** 角色清单（按 roleId 字典序，稳定顺序便于判据比对） */
  readonly roles: readonly RolePack[];
  /** 至少一项降级（缺根 / 缺目录 / 读失败） */
  readonly degraded: boolean;
  /** 逐条错误（铁律 24：不空吞）—— 仅真错误，不含"目录为空"这类正常默认 */
  readonly errors: readonly string[];
}

/**
 * 六件（含 `manifest.json`）：**宿主侧期望集**，`manifest.pieces[]` 的声明对账基准。
 * 单一出处 = `role-pack-schema.ROLE_PACK_PIECES`（#1075 P1-a：v2 起 manifest 自身也计入；顺序仍是契约的一部分）。
 */
export const EXPECTED_PIECES: readonly string[] = ROLE_PACK_PIECES;

/** 六件里载荷知识范围的这一件（裁 423：唯一载体 = 岗位包实物） */
const SCOPE_FILE = 'knowledge-scope.yaml';
/** scope 声明里的字段名（zod 等价手写校验的靶；不引新依赖） */
const SCOPES_KEY = 'scopes';
const DENY_KEY = 'deny';
const COLLECTIONS_KEY = 'collections';

/**
 * `knowledge-scope.yaml` 的**内容**解析结果（#731 / T1）。
 *
 * 🔴 本类型是「装载期把内容读出来」的载体 —— 在此之前 loader 只判"文件存在且非空"
 *   （:97 起 `isNonEmptyFile`），内容坏成什么样都看不见 ⇒ 六件套的**内容**从未被生产读过。
 */
export interface KnowledgeScopeDeclaration {
  readonly roleId: string;
  /** 文件是否真的声明了内容（false = 缺件 / 空文档 ⇒ **不是错误**，见 KL-T1-1） */
  readonly declared: boolean;
  /** `scopes[].id`（顺序保留；去重由消费方决定） */
  readonly scopeIds: readonly string[];
  /** `deny[].id` */
  readonly denyIds: readonly string[];
  /** 内容级问题（形状非法 / 解析失败 / 重复 id / scopes 为空）—— 空数组 = 内容可用 */
  readonly problems: readonly string[];
  /** `problems.length > 0`（fail-loud 的可观测位：装载期 `errors[]` 与请求路径共用它） */
  readonly degraded: boolean;
}

/** 收窄成"对象但不是数组" */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析 + 校验一份 `knowledge-scope.yaml`（**单点**；装载期与请求路径共用）。
 *
 * 边界（dev doc §4.2 边界值清单）:
 *   缺件 / 空文档（零内容或仅注释）⇒ `declared: false`，**不计错**
 *     —— KL-T1-1：夹具与内容骨架普遍是"仅注释"形态（`tests/init/preset-loader.test.ts` 的
 *        `writeRole()` 就写 `# <role>/<piece>`），把它判成错误 = 让装载面与既有判据对撞；
 *        真正的"文件在但无 scope"由 D5 探针 V1（`scopes[] 为空 ⇒ 业务红`）兜住。
 *   YAML 语法坏 / 顶层非映射 / `scopes` 缺失或非数组 / 条目缺非空 `id` / `id` 重复 /
 *    `scopes` 为空 / `collections` 非数组 / `deny` 非数组或条目缺 `id` ⇒ **进 `problems`**（真错误）。
 *   `roleId` 字段与目录名不一致 ⇒ 也进 `problems`（内容面自陈与物理位置漂移）。
 *   `deny` 与 `scopes` 同 id **不是**问题（D5 的 V6(ii) 语义样本正是构造这种重叠）。
 */
function parseKnowledgeScope(absPath: string, roleId: string): KnowledgeScopeDeclaration {
  const problems: string[] = [];
  const empty: KnowledgeScopeDeclaration = {
    roleId, declared: false, scopeIds: [], denyIds: [], problems, degraded: false,
  };
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err: unknown) {
    problems.push(`${absPath}: 读取失败 — ${err instanceof Error ? err.message : String(err)}`);
    return { ...empty, problems, degraded: true };
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err: unknown) {
    problems.push(`${absPath}: YAML 解析失败 — ${err instanceof Error ? err.message : String(err)}`);
    return { ...empty, problems, degraded: true };
  }
  if (doc === null || doc === undefined) return empty; // 空文档/仅注释 ⇒ 未声明（KL-T1-1）
  if (!isRecordValue(doc)) {
    problems.push(`${absPath}: YAML 顶层不是映射（实测 ${Array.isArray(doc) ? 'array' : typeof doc}）`);
    return { ...empty, problems, degraded: true };
  }

  const declaredRole = doc['roleId'];
  if (typeof declaredRole === 'string' && declaredRole.length > 0 && declaredRole !== roleId) {
    problems.push(`${absPath}: roleId「${declaredRole}」与目录名「${roleId}」不一致`);
  }

  const rawScopes = doc[SCOPES_KEY];
  if (rawScopes === undefined || rawScopes === null) {
    problems.push(`${absPath}: 缺 \`${SCOPES_KEY}\` 字段（文件在但未声明任何知识范围）`);
    return { ...empty, problems, degraded: true };
  }
  if (!Array.isArray(rawScopes)) {
    problems.push(`${absPath}: \`${SCOPES_KEY}\` 不是数组（实测 ${typeof rawScopes}）`);
    return { ...empty, problems, degraded: true };
  }

  const scopeIds: string[] = [];
  for (const [index, entry] of rawScopes.entries()) {
    if (!isRecordValue(entry)) {
      problems.push(`${absPath}: \`${SCOPES_KEY}[${String(index)}]\` 不是映射`);
      continue;
    }
    const id = entry['id'];
    if (typeof id !== 'string' || id.length === 0) {
      problems.push(`${absPath}: \`${SCOPES_KEY}[${String(index)}].id\` 缺非空字符串`);
      continue;
    }
    const collections = entry[COLLECTIONS_KEY];
    if (collections !== undefined && collections !== null && !Array.isArray(collections)) {
      problems.push(`${absPath}: \`${SCOPES_KEY}[${String(index)}].${COLLECTIONS_KEY}\` 不是数组`);
    }
    scopeIds.push(id);
  }
  const duplicates = [...new Set(scopeIds.filter((id, i) => scopeIds.indexOf(id) !== i))];
  if (duplicates.length > 0) {
    problems.push(`${absPath}: \`${SCOPES_KEY}\` 有重复 id：${duplicates.join(', ')}`);
  }
  if (scopeIds.length === 0) {
    problems.push(`${absPath}: \`${SCOPES_KEY}\` 为空 ⇒ 该岗位知识面为空（fail-closed：不得回落"不过滤"）`);
  }

  const denyIds: string[] = [];
  const rawDeny = doc[DENY_KEY];
  if (rawDeny !== undefined && rawDeny !== null) {
    if (!Array.isArray(rawDeny)) {
      problems.push(`${absPath}: \`${DENY_KEY}\` 不是数组（实测 ${typeof rawDeny}）`);
    } else {
      for (const [index, entry] of rawDeny.entries()) {
        if (!isRecordValue(entry)) {
          problems.push(`${absPath}: \`${DENY_KEY}[${String(index)}]\` 不是映射`);
          continue;
        }
        const id = entry['id'];
        if (typeof id !== 'string' || id.length === 0) {
          problems.push(`${absPath}: \`${DENY_KEY}[${String(index)}].id\` 缺非空字符串`);
          continue;
        }
        denyIds.push(id);
      }
    }
  }

  return {
    roleId,
    declared: true,
    scopeIds,
    denyIds,
    problems,
    degraded: problems.length > 0,
  };
}

/**
 * 按需解析某岗位的知识范围（**请求路径**入口；#731 / T1 / d-refresh）。
 *
 * @input  `roleId`（验签身份里的角色名）、`options.root`（内容根；缺省走 `SYNOVA_PRESETS_ROOT` 注入缝）
 * @output {@link KnowledgeScopeDeclaration}
 * @degraded **三条分支，安全方向不同（别合并）**:
 *           ① **角色目录不存在**（admin/manager/employee/viewer/liaison/ga/未知角色）
 *              ⇒ `declared: false, degraded: false` ＋ `log.warn`（I-C4：不追加 scope 维，**可观测**）；
 *           ② **角色目录存在但 `knowledge-scope.yaml` 缺失/不可读/为空文档**
 *              ⇒ `degraded: true` ＋ `log.error(code=KNOWLEDGE_SCOPE_MISSING)` ⇒ 调用点给
 *              `{pkb_domain IN []}`（**fail-closed：整岗一件都不给看**）；
 *           ③ **内容坏**（YAML 坏/形状非法/`scopes[]` 空/重复 id）
 *              ⇒ `degraded: true` ＋ `log.error(code=KNOWLEDGE_SCOPE_INVALID)` ⇒ 同上 fail-closed。
 *           🔴 ② 是自验抓到的**真 fail-open 修复**：曾把"目录在但文件没了"当 ① 处理 ⇒ 删文件即可看全库。
 *           **本函数从不抛**（它在每个请求的判定路径上跑）。
 *
 * 🔴 缓存口径（d-refresh）：缓存键 = 绝对路径，值带 `mtimeMs:size` 指纹 —— 同一服务寿命内改内容
 *   文件（只改 mtime 或只改大小都算）⇒ **下一次调用即重解析**。禁进程级常量：那会让
 *   "改文件 ⇒ 结果变"这条判据（D5 V3）假绿。
 */
const scopeDeclCache = new Map<string, { readonly fingerprint: string; readonly decl: KnowledgeScopeDeclaration }>();

/**
 * 「装不进去 ⇒ 一件都不给看」的统一出口（fail-closed）。
 *
 * 🔴 与 I-C4（无角色目录 ⇒ 不追加）的区别是**安全方向**：
 *   角色目录在而知识范围取不到 ⇒ 说明"这个岗位本来该有 scope 声明" ⇒ **一件都不给看**；
 *   角色目录根本不存在 ⇒ 说明"这个角色不属岗位包管辖"（admin/manager/employee/viewer/liaison/ga/未知）
 *   ⇒ 不追加 scope 维，交既有 sensitivity 面管。
 *   🔴 反例（本卡自验抓到的真 fail-open）: 曾对**两种**情形都返回 `declared:false, degraded:false`
 *   ⇒ 删掉 `roles/finance/knowledge-scope.yaml` 后 finance **能看见全部语料** ——
 *   这正是本批要杀的"因为读不到而不收"。
 */
function scopeUnavailable(roleId: string, abs: string, reason: string): KnowledgeScopeDeclaration {
  log.error(
    { roleId, path: abs, reason, code: 'KNOWLEDGE_SCOPE_MISSING', degraded: true },
    '角色目录在但知识范围取不到 — 该岗位按 fail-closed 拒绝全部知识（不回落"不过滤"）',
  );
  return { roleId, declared: false, scopeIds: [], denyIds: [], problems: [reason], degraded: true };
}

export function resolveRoleKnowledgeScope(
  roleId: string,
  options: { root?: string } = {},
): KnowledgeScopeDeclaration {
  try {
    const root = options.root !== undefined && options.root.length > 0 ? options.root : resolvePresetsRoot();
    const roleDir = join(root, ROLES_SUBDIR, roleId);
    const abs = join(roleDir, SCOPE_FILE);
    const roleDirExists = ((): boolean => {
      try {
        return statSync(roleDir).isDirectory();
      } catch {
        return false; // 目录不存在 = 该角色不属岗位包管辖（I-C4 的正常路径，不是错误）
      }
    })();

    let fingerprint: string;
    try {
      const st = statSync(abs);
      if (!st.isFile()) throw new Error('not a regular file');
      fingerprint = `${String(st.mtimeMs)}:${String(st.size)}`;
    } catch {
      if (!roleDirExists) {
        // I-C4：**角色目录不存在** ⇒ 不追加 scope 维（但必须可见，不静默）
        log.warn({ roleId, path: abs }, '岗位包目录不存在 ⇒ 不追加 scope 维（I-C4，可观测）');
        return { roleId, declared: false, scopeIds: [], denyIds: [], problems: [], degraded: false };
      }
      // 🔴 fail-closed：角色目录在而 knowledge-scope.yaml 缺/不可读 ⇒ **整岗不给看**
      return scopeUnavailable(roleId, abs, `${abs}: 角色目录存在但 ${SCOPE_FILE} 缺失或不可读`);
    }
    const cached = scopeDeclCache.get(abs);
    if (cached !== undefined && cached.fingerprint === fingerprint) return cached.decl;
    const decl = parseKnowledgeScope(abs, roleId);
    scopeDeclCache.set(abs, { fingerprint, decl });
    if (decl.degraded) {
      log.error(
        { roleId, path: abs, problems: decl.problems, code: 'KNOWLEDGE_SCOPE_INVALID', degraded: true },
        '知识范围文件内容非法 — 该岗位按 fail-closed 拒绝全部知识（不回落"不过滤"）',
      );
      return decl;
    }
    if (!decl.declared) {
      // 文件在、可读，但内容为空/仅注释 ⇒ 声明面缺失（同族 fail-open，一律 fail-closed）
      return scopeUnavailable(roleId, abs, `${abs}: 文件存在但未声明任何内容（空文档/仅注释）`);
    }
    return decl;
  } catch (err: unknown) {
    log.error(
      { roleId, err, code: 'KNOWLEDGE_SCOPE_RESOLVE_FAILED', degraded: true },
      '知识范围解析未预期异常 — 该岗位按 fail-closed 拒绝全部知识',
    );
    return {
      roleId, declared: false, scopeIds: [], denyIds: [],
      problems: [err instanceof Error ? err.message : String(err)],
      degraded: true,
    };
  }
}

/** 解析内容根（绝对路径）—— `SYNOVA_PRESETS_ROOT` 注入缝（d-v3：服务与探针共用同一临时内容根） */
function resolvePresetsRoot(cwd: string = process.cwd()): string {
  const override = process.env['SYNOVA_PRESETS_ROOT'];
  if (typeof override === 'string' && override.length > 0) return override;
  return join(cwd, PRESETS_DIR);
}

/** 读目录项名（安全：失败返回空数组 + log.warn） */
function safeReaddir(dir: string, errors: string[]): string[] {
  try {
    return readdirSync(dir);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    // ENOENT = 正常默认（目录尚不存在）；其余 = 真错误
    if (code !== 'ENOENT') {
      const msg = `${dir}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      log.warn({ dir, err }, 'presets 目录读取失败 — degraded');
    }
    return [];
  }
}

/** 判定文件存在且非空 */
function isNonEmptyFile(abs: string): boolean {
  try {
    return existsSync(abs) && statSync(abs).isFile() && statSync(abs).size > 0;
  } catch {
    return false; // statSync 竞态（文件被删）⇒ 视为不存在，非错误
  }
}

/**
 * 读一个角色包（磁盘实测六件 ＋ v2 结构/refs 校验）。
 *
 * #731 / T1：`knowledge-scope.yaml` 从"只判存在且非空"升级为**解析内容 ＋ 校验** ——
 *   内容坏（语法/形状/空 scopes/重复 id）⇒ 逐条进 `errors[]` ⇒ `degraded: true` ⇒ **可观测**，
 *   不再"文件在就当作齐备"。文件缺席/空文档 ⇒ 不计内容错（KL-T1-1），缺件另由 `missing` 报。
 *
 * #1075 P1-a：六件存在性判定后接 `validateRolePackDir()`（结构 ＋ `pieces`/`refs`/内容源三方对账）；
 *   问题逐条折成 `${roleId}: ${code} ${message}` 进 `errors[]`（点名可 grep）＋ `degraded:true`，**不抛**。
 *   🔴 `manifest.json` 缺件时**跳过** schema 校验（缺件已由 `missing`＋errors 报，不再级联 UNREADABLE）。
 */
function readRolePack(rolesRoot: string, roleId: string, errors: string[]): RolePack {
  const roleDir = join(rolesRoot, roleId);
  const pieces: string[] = [];
  const missing: string[] = [];
  for (const piece of EXPECTED_PIECES) {
    if (isNonEmptyFile(join(roleDir, piece))) pieces.push(piece);
    else missing.push(piece);
  }
  if (missing.length > 0) {
    // 缺件是**内容问题**（非读取失败）⇒ 记 errors 让调用方可见，但不 throw
    errors.push(`${roleId}: 缺件 ${missing.join(', ')}`);
    log.warn({ roleId, missing }, '角色包缺件 — degraded');
  }

  const scopePath = join(roleDir, SCOPE_FILE);
  const knowledgeScope = pieces.includes(SCOPE_FILE)
    ? parseKnowledgeScope(scopePath, roleId)
    : { roleId, declared: false, scopeIds: [], denyIds: [], problems: [], degraded: false };
  if (knowledgeScope.degraded) {
    for (const problem of knowledgeScope.problems) errors.push(problem);
    log.error(
      { roleId, path: scopePath, problems: knowledgeScope.problems, code: 'KNOWLEDGE_SCOPE_INVALID', degraded: true },
      '角色包 knowledge-scope.yaml 内容非法 — 装载期已点名（fail-loud）',
    );
  } else if (knowledgeScope.declared) {
    log.info(
      { roleId, scopes: knowledgeScope.scopeIds.length, deny: knowledgeScope.denyIds.length },
      '角色包 knowledge-scope.yaml 内容已解析并校验',
    );
  }

  // #1075 P1-a：v2 结构 ＋ refs 三方对账（IO 壳；不抛）。缺 manifest ⇒ 跳过（未校验）
  let validation: RolePackValidation = { ok: false, schemaVersion: null, problems: [], refsChecked: 0 };
  if (pieces.includes('manifest.json')) {
    validation = validateRolePackDir(roleDir);
    if (!validation.ok) {
      for (const problem of validation.problems) {
        errors.push(`${roleId}: ${problem.code} ${problem.message}`);
      }
      log.warn(
        { roleId, problems: validation.problems, degraded: true },
        '角色包 v2 结构/refs 校验未通过 — 逐条点名（不抛）',
      );
    } else {
      log.info({ roleId, refsChecked: validation.refsChecked }, '角色包 v2 结构与 refs 对账通过');
    }
  }

  return {
    roleId,
    pieces,
    missing,
    knowledgeScope,
    schemaVersion: validation.schemaVersion,
    schemaValid: validation.ok,
    validation,
  };
}

/**
 * 装配角色预设包（boot 入口 / 判据入口）。
 *
 * 🔴 零参（探针只驱动零参导出）—— 内容根由 `process.cwd()` + `SYNOVA_PRESETS_ROOT` 推导。
 */
export function loadRolePacks(): PresetLoadReport {
  const errors: string[] = [];
  const root = resolvePresetsRoot();
  const rolesRoot = join(root, ROLES_SUBDIR);

  if (!existsSync(root)) {
    // ENOENT = 正常默认：内容面未装 ⇒ degraded，不是错误
    log.warn({ root }, 'presets 内容根不存在 — 角色预设包未装配（degraded，非错误）');
    return { root, roles: [], degraded: true, errors };
  }

  const entries = safeReaddir(rolesRoot, errors);
  const roleIds: string[] = [];
  for (const name of entries) {
    // 只要目录；忽略 .DS_Store / 文件 / 隐藏项
    if (name.startsWith('.')) continue;
    try {
      if (!statSync(join(rolesRoot, name)).isDirectory()) continue;
    } catch (err: unknown) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      log.warn({ name, err }, '角色目录 stat 失败 — degraded');
      continue;
    }
    roleIds.push(name);
  }
  roleIds.sort(); // 稳定顺序（判据可比对）

  const roles = roleIds.map((id) => readRolePack(rolesRoot, id, errors));
  const degraded = errors.length > 0 || roleIds.length === 0;
  log.info({ root, roles: roleIds.length, degraded }, '角色预设包已装配');
  return { root, roles, degraded, errors };
}

/**
 * 零参查询：角色 id 清单（**机器可观测面** —— 判据探针驱动本函数观察真实返回）。
 *
 * @output 角色 id 数组（字典序）；内容缺失 ⇒ 空数组（不是 null；调用方按空处理）
 */
export function listRolePacks(): string[] {
  return loadRolePacks().roles.map((r) => r.roleId);
}

/**
 * 状态清理（幂等）。
 *
 * `loadRolePacks()` / `listRolePacks()` **不持有进程级缓存**（每次调用直读磁盘，保持"加文件即生效"
 * 的宪章语义）—— 这条不变。
 * 🔴 #731 新增：`resolveRoleKnowledgeScope()` 为了请求路径的代价而带了 **mtime/size 指纹缓存**
 *   （d-refresh：键含 mtime+size，改文件即失效）。本函数现在**确有缓存要清**，故清掉它；
 *   仍满足 `content-registry` 的 `loader.cleanup` 契约（`probe-role-pack.ts` 会核该符号）。
 */
export function clearPresetCache(): void {
  scopeDeclCache.clear();
  log.info('preset-loader 已清 knowledge-scope 解析缓存（loadRolePacks 本身无常驻缓存）');
}
