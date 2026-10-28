/**
 * src/init/preset-loader.ts — 角色预设包（Role Pack）宿主侧 loader
 *
 * 架构位置: **⓪-b（人侧入口）内容载体** —— `extensions/presets/`（宪章 §4.1）。
 *   一个岗位一个目录，六件（v3：manifest ＋ 五件内容）声明「这个岗位该给 agent 带什么上下文」。
 *   **加一个角色目录 = 加一个岗位，不改宿主代码**（宪章三条不可妥协之①「文件驱动」）。
 *
 * 出处: K12-01 **段二**（#184）—— 段一已落内容面（`extensions/presets/**`，
 *   `content-registry` 登记为 `pending-cto`）；段二补宿主 loader + 接线，把该登记升为 `reachable`，
 *   使判据 `probe-role-pack.ts --role finance` 能从 exit 1 走到 exit 0。
 *   ⚠️ `manifest.json` 段一写明的 `exportKey: loadRolePacks` + `loaderPending: true`
 *   即本文件的接口预留 —— 本文件补齐后同步改 manifest（去 `loaderPending`、`entryPoint` 指本模块）。
 *   #1075 P2-1（审批门）：本文件是**审批态的唯一生产消费点** —— 单读 → contentHash →
 *   `judgeRolePackApproval()` → `RolePack.approval` / `PresetLoadReport.usable[]`，并让
 *   `resolveRoleKnowledgeScope()` 对未批准岗位 fail-closed（→ `src/middleware/auth.ts` 既有 `[{IN, []}]`）。
 *
 * 🔴 本文件**不含任何角色硬编码清单**：角色集合一律从磁盘目录名推导。
 *   判据探针据此设反例 —— 「磁盘上每个角色目录都出现在生产入口的真实返回里」，
 *   硬编码角色表 ⇒ 新建目录不出现 ⇒ 探针判红（`probe-role-pack.ts` 边界声明 ①）。
 *   （审批门的"出厂三包"清单在 `src/init/role-pack-approval.ts` 的 `FACTORY_APPROVALS`，**不在**本文件；
 *    本文件只按 roleId 取缓存指纹，不复制名单。）
 *
 * 设计哲学（一句）: **同一个 loader 里，"结构合法"与"内容被批准"是两道独立的门** ——
 *   结构门（P1-a）只答"包写得对不对"，审批门（#1075 P2-1）只答"这套内容能不能生效"；
 *   两者都过才进 `usable[]`，而"读不到"永远走 fail-closed（既不批准，也不静默放行）。
 *
 * 契约（铁律 47）:
 *   @input  — 无参数（零参查询；探针只驱动零参导出，见 `probe-role-pack.ts`「观测面」段）。
 *             可选环境变量 `SYNOVA_PRESETS_ROOT` 覆盖内容根（测试注入缝，同 `SYNOVA_CONTENT_REGISTRY_DISABLE` 惯例）。
 *             请求路径：`resolveRoleKnowledgeScope(roleId, options?: {root?, orgId?})`（`orgId` 参与审批指纹 —— N5；
 *             缺省 = `loadConfig().orgId`，即 `SYNOVA_ORG_ID || 'default'`）。
 *   @output — `loadRolePacks(): PresetLoadReport` — 角色清单 + 每角色的六件存在性 + v3 结构/refs 校验
 *             （`RolePack.schemaVersion`／`schemaValid`／`validation`）＋ **审批态**（`RolePack.approval`，
 *             additive）＋ **可用集**（`PresetLoadReport.usable`，additive）＋ degraded 信号
 *             `listRolePacks(): string[]` — 角色 id 清单（零参，机器可观测）
 *             `resolveRoleKnowledgeScope(roleId, options?)` — **请求路径**用的知识范围解析（#731 / T1；
 *               按需读盘 ＋ 内容/审批指纹缓存，见下「二bis」段）
 *             （有参查询不入零参契约面：无生产消费方即不导出，避免"导出但无人调用"的表面积 —— 铁律 0-2）
 *   @degraded — 内容根缺失 / roles 目录缺失 / 角色目录内文件读不到 / **knowledge-scope.yaml 内容坏** /
 *             **v3 结构或 refs 对账不过**（#1075 P1-a） / **审批态 = `unverified`**（#1075 P2-1）
 *             ⇒ **不抛**，返回 `degraded: true` + `errors[]` 逐条点名 + `log.warn/error`（铁律 11/24/31）。
 *             ⚠️ 区分四类：**ENOENT = 正常默认**（角色目录为空 / 该角色无 scope 文件 ⇒ degraded 但非错误）、
 *             **读失败/解析失败/形状非法 = 真错误**（进 `errors[]`）、
 *             **空文档（零内容或仅注释）= 未声明**（不计错；内容级红由 D5 探针 V1 的「scopes[] 为空」兜底 ——
 *             见 KL-T1-1）、**`pending`（无审批记录）= 不生效但 不计 degraded**（§4.5-C1 口径）。
 *             🔴 **审批折叠口径（#1075 P2-1）**：`unverified` ⇒ `errors[]` 点名 `ROLE_PACK_APPROVAL_UNVERIFIED`
 *             ＋ `degraded:true` ＋ `log.error`；`pending` ⇒ 只 `log.info` 点名 `ROLE_PACK_APPROVAL_PENDING`
 *             （**不进 `errors[]`、不计 degraded** —— 未被审批是默认状态，不是故障）。
 *             🔴 **N4**：`validation.ok !== true` 或无 `contentHash` ⇒ **不调用** `judgeRolePackApproval()`，
 *             `approval` 直接置 `unverified` 并沿用 `validation.problems[0].code`（关闭"无 hash 却判审批"的路径）。
 *             该分支的归因已由 `validation.problems` 逐条进 `errors[]`（一包一码，逐包归因不被噪声打散）
 *             ⇒ **不重复追加**第二条同包审批错误行；审批态仍从 `RolePack.approval.status/code` 读出。
 *             🔴 **请求路径（J9a）**：`pending` / `unverified` ⇒ `degraded:true` ＋ `problems` 含对应
 *             `ROLE_PACK_APPROVAL_PENDING` / `ROLE_PACK_APPROVAL_UNVERIFIED` ⇒ 调用点给 `{IN []}`
 *             （**整岗一件都不给看**）；**角色目录不存在仍是 I-C4**（`declared:false, degraded:false`，不追加 scope 维）。
 *   @authority — 由 `src/deploy/content-registry.ts` 的 `type:'presets'` 条目 init/cleanup 调用（boot 与
 *   content-reload 同一入口）；`probe-role-pack.ts` 只驱动零参只读导出；其它模块不得绕过 content-registry 直调。
 *   **审批判定本身唯一实现 = `src/init/role-pack-approval.ts`**（本文件只做"单读 → 拿 hash → 调判定 → 折叠信号"，
 *   不复制判定规则 —— N6 防循环依赖）。
 *   @not-here  — 不做内容面热加载编排（`content-reload.ts`）；不改写磁盘（只读 loader）；不定义权限项
 *   （`permission-grants.ts`）；不实现 v3 结构与 refs 判定（唯一实现 = `src/init/role-pack-schema.ts`；
 *   loader 只折 problems 进 `errors[]`）；**不做审批写入/撤销/UI/审计**（P3）；
 *   **不消费权限**（`permissionsPending` 只是标志，P2-4 才据此拒绝）。
 *
 * Source map（本文件内）:
 *   | 导出／函数 | 角色 |
 *   |---|---|
 *   | `loadRolePacks()` | boot/探针入口：目录名 → `readRolePack()` → `roles[]` ＋ `usable[]` ＋ `degraded` |
 *   | `listRolePacks()` | 零参角色 id 清单（探针观测面） |
 *   | `resolveRoleKnowledgeScope()` | 请求路径：内容 ＋ 审批态 → 知识范围（fail-closed） |
 *   | `clearPresetCache()` | 清理 scope 解析缓存（content-registry cleanup 契约） |
 *   | `readRolePack()` | 单角色装载：六件 → 校验（含 hash）→ 审批判定 → 折叠信号 |
 *   | `parseKnowledgeScope()` | `knowledge-scope.yaml` 内容解析（装载期与请求路径共用） |
 *   | `detectToolDeclarations()` | `capabilities[].tool` 存在性（`permissionsPending` 口径；解析失败 ⇒ 保守 true） |
 *   | `approvalFingerprintOf()`／`piecesStatFingerprint()` | 审批/内容指纹（缓存失效，见 KL-P2-3） |
 *   | `resolveOrgId()`／`resolvePresetsRoot()` | 注入缝（`SYNOVA_ORG_ID`／`SYNOVA_PRESETS_ROOT`） |
 *
 * 已知限制（Known Limitations；禁写"暂无"）:
 *   · **KL-T1-1**：`knowledge-scope.yaml` 为空文档/仅注释 ⇒ `declared:false` **不计错**（夹具与内容骨架
 *     普遍是"仅注释"形态；真正"文件在但无 scope"由 D5 探针 V1 兜底）。
 *   · **KL-P2-1（工作流闸，不是安全控制）**：审批门保证"默认不生效／改内容即失效／单字段篡改即失效／
 *     批准撤销即时生效／状态可见"；**不防**能改文件者重写记录并重算 hash（零门槛）。抗伪造／取证／
 *     撤销持久归 P3（审计链）／P4（签名清单）。
 *   · **KL-P2-2（无审批写入器）**：记录由 P3 写、本文件只读；测试手工构造记录。上线后客户新建岗位默认
 *     `pending`（不生效）—— 有意的安全默认。
 *   · **KL-P2-3（缓存覆盖面，严于 D10）**：请求路径缓存键 = 六件 `mtimeMs:size` 指纹 ＋ `orgId` ＋
 *     审批指纹（记录 `mtimeMs:size`／无记录 `none`／出厂 `factory:<roleId>:v1`）。比规格 D10 的
 *     "scopeYaml 指纹"多覆盖另外五件（防"改 capabilities.yaml 后请求路径仍用旧批准"的 fail-open）；
 *     代价是内容变动多一次重解析。**不依赖 `clearPresetCache()`**（批准/撤销下一次调用即生效 —— J10）。
 *   · **KL-P2-4（orgId 进程内缓存）**：缺省 orgId 由 `loadConfig().orgId` 首次读取后进程内缓存
 *     （`SYNOVA_ORG_ID` 改动需重启进程）；`orgId` 不是安全控制（规格 L7）。
 *   · **KL-P2-5（记录可删）**：删审批记录 ⇒ 退化为 `pending`（可见性可被抹）；撤销不持久（旧记录可贴回）。
 *     → P3 审计链 ＋ 撤销留痕。
 *   · **KL-P2-6（出厂三包只信代码锚）**：出厂 roleId 的批准不来自记录（记录只作日志），改出厂内容必须
 *     同批改 `FACTORY_APPROVALS`（评审闸的代价，规格 L3）。
 *   · **KL-P2-7（出厂锚依赖检出行尾）**：raw-bytes 指纹依赖 `.gitattributes` 的
 *     `extensions/presets/roles/** text eol=lf`（规格 L12）；撤该规则 ⇒ Windows/autocrlf 下三包全 `unverified`。
 *   · **KL-P2-8（J8 依赖非 root 身份）**：审批目录 `chmod 0o111` 的 fail-closed 判据在 root 下空转
 *     （规格 L11）。
 */
import { createLogger } from '@synova/logger';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { load as parseYaml } from 'js-yaml';
import { loadConfig } from '../config';
import {
  ROLE_PACK_PIECES,
  validateRolePackDir,
  type RolePackValidation,
} from './role-pack-schema';
import {
  FACTORY_APPROVALS,
  judgeRolePackApproval,
  type RolePackApproval,
} from './role-pack-approval';

const log = createLogger('init/preset-loader');

/** 内容根（仓库相对）。环境变量覆盖 = 测试注入缝。 */
const PRESETS_DIR = 'extensions/presets';
/** 角色目录所在（相对内容根） */
const ROLES_SUBDIR = 'roles';
/** 审批记录根（相对<内容根>的 `../..` 即仓库根）—— 运行时状态，不在内容包内（规格 §1.2-4） */
const APPROVALS_SUBDIR = '.synova/approvals';
/** 能力声明件（`permissionsPending` 口径的唯一读取对象） */
const CAPABILITIES_FILE = 'capabilities.yaml';
/** 未批准岗位的请求路径 problem 码（§4.5-C1；`unverified` 用它，`pending` 用判定侧同名码） */
const APPROVAL_UNVERIFIED_CODE = 'ROLE_PACK_APPROVAL_UNVERIFIED';

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
  /** v3 结构 ＋ refs 对账是否通过（缺 `manifest.json` ⇒ false＝未完成校验，原因在 `missing`） */
  readonly schemaValid: boolean;
  /** 校验明细（纯数据；`problems` 已逐条折进 `PresetLoadReport.errors`）—— #1075 P1-a additive */
  readonly validation: RolePackValidation;
  /**
   * 审批态（#1075 P2-1 additive；形状 = 规格 §2.3-C）。
   * 🔴 只有 `status === 'approved'` 才允许进 `usable[]`；`pending`／`unverified` 一律**不生效**。
   */
  readonly approval: RolePackApproval;
}

/** `loadRolePacks()` 的返回 */
export interface PresetLoadReport {
  /** 内容根绝对路径 */
  readonly root: string;
  /** 角色清单（按 roleId 字典序，稳定顺序便于判据比对） */
  readonly roles: readonly RolePack[];
  /**
   * **可用岗位集**（#1075 P2-1 additive）：`approval.status === 'approved' ∧ validation.ok` 的 roleId，
   * 稳定排序（= `roles[]` 的子序列，字典序）。`roles[]` 仍保留全量（可运维；未批准岗位要可见）。
   */
  readonly usable: readonly string[];
  /** 至少一项降级（缺根 / 缺目录 / 读失败 / 校验失败 / 审批 unverified） */
  readonly degraded: boolean;
  /** 逐条错误（铁律 24：不空吞）—— 仅真错误；`pending` 与"目录为空"这类正常默认不进 */
  readonly errors: readonly string[];
}

/**
 * 六件（含 `manifest.json`）：**宿主侧期望集**，`manifest.pieces[]` 的声明对账基准。
 * 单一出处 = `role-pack-schema.ROLE_PACK_PIECES`（#1075 P1-a：v3 起 manifest 自身也计入；顺序仍是契约的一部分）。
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
 *   （`isNonEmptyFile`），内容坏成什么样都看不见 ⇒ 六件套的**内容**从未被生产读过。
 */
export interface KnowledgeScopeDeclaration {
  readonly roleId: string;
  /** 文件是否真的声明了内容（false = 缺件 / 空文档 ⇒ **不是错误**，见 KL-T1-1） */
  readonly declared: boolean;
  /** `scopes[].id`（顺序保留；去重由消费方决定） */
  readonly scopeIds: readonly string[];
  /** `deny[].id` */
  readonly denyIds: readonly string[];
  /** 内容级问题（形状非法 / 解析失败 / 重复 id / scopes 为空 / **审批未通过**）—— 空数组 = 内容可用 */
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
 * 解析内容根（绝对路径）—— `SYNOVA_PRESETS_ROOT` 注入缝（d-v3：服务与探针共用同一临时内容根）
 */
function resolvePresetsRoot(cwd: string = process.cwd()): string {
  const override = process.env['SYNOVA_PRESETS_ROOT'];
  if (typeof override === 'string' && override.length > 0) return override;
  return join(cwd, PRESETS_DIR);
}

/**
 * 实例组织 id（审批判定的租户字段；规格 §2.3-B / L7）。
 *
 * 单一来源 = `loadConfig().orgId`（`src/config.ts:110`：`SYNOVA_ORG_ID || 'default'`），
 * **首次读取后进程内缓存**（KL-P2-4：请求路径不每请求读配置文件；改 env 需重启）。
 * 显式入参（`resolveRoleKnowledgeScope(roleId, {orgId})`，N5）优先 —— 给测试与多实例调用方一个注入缝。
 */
let processOrgId: string | undefined;
function resolveOrgId(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  if (processOrgId === undefined) {
    try {
      processOrgId = loadConfig().orgId;
    } catch (err: unknown) {
      // config 读不到不等于"没有组织" ⇒ 显式回落（与 config.ts:110 缺省同值）＋留痕，不静默。
      // 🔴 不自造错误码（§4.5-C1 码表唯一）：本日志是**诊断面**（degraded:true ＋ 原因在 msg），
      //    不参与审批判决（审批判决码只由 role-pack-approval.ts 产出）。
      log.warn(
        { err, degraded: true },
        'orgId 读取失败 — 回落 SYNOVA_ORG_ID/default（与 config.ts:110 缺省同源；degraded，仍用缺省 org 判审批）',
      );
      processOrgId = process.env['SYNOVA_ORG_ID'] || 'default';
    }
  }
  return processOrgId;
}

/** 审批记录根（绝对路径）：`<内容根>/../..` = 仓库根 ⇒ `<仓库根>/.synova/approvals`（规格 §2.4/B9） */
function approvalsRootFor(repoRoot: string): string {
  return join(repoRoot, APPROVALS_SUBDIR);
}

/**
 * 包是否声明了 `capabilities[].tool`（`permissionsPending` 口径；规格 §2.3-C）。
 *
 * 🔴 **解析失败 ⇒ 保守 `true`**（"读不出"不得被当"没有 tools"——那会低估待批权限）；
 *   文件缺件时同样保守 `true`（此时包本身已被校验判 unverified，本值只影响 approved 包的标志）。
 *   `capabilities` 键缺省（合法形态：本包不声明能力）⇒ `false`（无待批权限）。
 */
function detectToolDeclarations(roleDir: string): boolean {
  const abs = join(roleDir, CAPABILITIES_FILE);
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch (err: unknown) {
    // 🔴 不自造错误码（§4.5-C1 码表唯一）：本路径只影响 `permissionsPending` 的保守取值，
    //    不产出审批判决码；原因进日志 msg（degraded:true），判决面由 `RolePack.approval` 承担。
    log.warn(
      { path: abs, err, degraded: true },
      `${CAPABILITIES_FILE} 不可读 — permissionsPending 按保守 true（不把"读不出"当"没有 tools"）`,
    );
    return true;
  }
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err: unknown) {
    log.warn(
      { path: abs, err, degraded: true },
      `${CAPABILITIES_FILE} YAML 解析失败 — permissionsPending 按保守 true`,
    );
    return true;
  }
  if (!isRecordValue(doc)) {
    log.warn(
      { path: abs, degraded: true },
      `${CAPABILITIES_FILE} 顶层不是映射 — permissionsPending 按保守 true`,
    );
    return true;
  }
  const capabilities = doc['capabilities'];
  if (capabilities === undefined || capabilities === null) return false;
  if (!Array.isArray(capabilities)) {
    log.warn(
      { path: abs, degraded: true },
      `${CAPABILITIES_FILE} 的 capabilities 不是数组 — permissionsPending 按保守 true`,
    );
    return true;
  }
  for (const entry of capabilities) {
    if (!isRecordValue(entry)) {
      log.warn(
        { path: abs, degraded: true },
        `${CAPABILITIES_FILE} 的 capabilities[] 条目不全是映射 — permissionsPending 按保守 true`,
      );
      return true;
    }
    const tool = entry['tool'];
    if (tool !== undefined && tool !== null) return true;
  }
  return false;
}

/**
 * 审批判定（#1075 P2-1 §2.1 步骤 ③）。
 *
 * @input  `roleDir`（绝对路径）、`roleId`（= 目录名）、`validation`（**同一次读**的校验结果）、`repoRoot`
 * @output {@link RolePackApproval}
 * @degraded **N4**：`validation.ok !== true` 或 `contentHash` 缺省 ⇒ **不调用** judge，
 *           直接 `{status:'unverified', code: validation.problems[0]?.code ?? 'ROLE_PACK_APPROVAL_UNVERIFIED'}`。
 *           否则把 hash 交给 `judgeRolePackApproval()`（出厂锚 → 记录 → 身份 → 租户 → 自绑定 → 指纹），
 *           日志由判定侧负责（本函数只在 N4 分支自己 `log.error`）。
 * @authority 唯一生产调用点 = `readRolePack()` 与 `resolveRoleKnowledgeScope()`；判定规则不在此复制（N6）。
 */
function resolveApprovalForRole(
  roleDir: string,
  roleId: string,
  validation: RolePackValidation,
  repoRoot: string,
): RolePackApproval {
  if (!validation.ok || validation.contentHash === undefined) {
    const code = validation.problems[0]?.code ?? APPROVAL_UNVERIFIED_CODE;
    log.error(
      {
        roleId,
        code,
        problems: validation.problems,
        degraded: true,
      },
      '岗位包结构/refs 校验未通过且无 contentHash — 不判审批（N4），approval 置 unverified',
    );
    return {
      status: 'unverified',
      code,
      reason:
        `结构/refs 校验未通过（${String(validation.problems.length)} 条问题），无 contentHash` +
        ' ⇒ 不调用 judgeRolePackApproval()（N4：不留"无 hash 却判定"的路径）',
    };
  }
  return judgeRolePackApproval({
    roleId,
    contentHash: validation.contentHash,
    orgId: resolveOrgId(),
    approvalsRoot: approvalsRootFor(repoRoot),
    hasToolDeclarations: detectToolDeclarations(roleDir),
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 二bis —— 请求路径：内容 ＋ 审批态 → 知识范围（缓存键含审批指纹，D10/J10）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 缓存值：`fingerprint` = 复合指纹（见 `scopeDeclCache` 注释），`decl` = 已折叠审批态的结果。
 */
const scopeDeclCache = new Map<
  string,
  { readonly fingerprint: string; readonly decl: KnowledgeScopeDeclaration }
>();

/** 出厂 roleId 的审批缓存指纹（`factory:<roleId>:v1`；来自 `FACTORY_APPROVALS` 常量，不复制名单） */
function factoryApprovalFingerprint(roleId: string): string | undefined {
  const matched = Object.entries(FACTORY_APPROVALS).find(([id]) => id === roleId);
  return matched?.[1].approvalId;
}

/**
 * 审批指纹（D10）：出厂 ⇒ `factory:<roleId>:v1`；有记录 ⇒ `mtimeMs:size`；无记录 ⇒ `none`。
 * stat 失败（非 ENOENT）⇒ `unreadable`（**每形态一个不同取值** ⇒ 恢复权限后下一次即重算；
 * 方向 fail-closed，不静默——`log.warn`）。
 */
function approvalFingerprintOf(roleId: string, approvalsRoot: string): string {
  const factoryFingerprint = factoryApprovalFingerprint(roleId);
  if (factoryFingerprint !== undefined) return factoryFingerprint;
  const recordPath = join(approvalsRoot, `${roleId}.json`);
  try {
    const stats = lstatSync(recordPath);
    return `${String(stats.mtimeMs)}:${String(stats.size)}`;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return 'none';
    log.warn(
      { roleId, path: recordPath, code, degraded: true },
      '审批记录 stat 失败 — 缓存按 unreadable 指纹（fail-closed 方向；本函数不抛）',
    );
    return 'unreadable';
  }
}

/**
 * 六件的 `mtimeMs:size` 指纹（**KL-P2-3**：比 D10 的 scopeYaml 指纹更严，覆盖另外五件）。
 * 缺件记为 `missing`（缺件是正常中间态，由 approval/validation 点名；此处不重复报错）。
 */
function piecesStatFingerprint(roleDir: string): string {
  const parts: string[] = [];
  for (const name of ROLE_PACK_PIECES) {
    try {
      const stats = statSync(join(roleDir, name));
      parts.push(`${name}:${String(stats.mtimeMs)}:${String(stats.size)}`);
    } catch {
      // 缺件 ⇒ 记 missing（正常中间态；不静默业务错误：缺件由 resolveApprovalForRole 的 N4 路径点名）
      parts.push(`${name}:missing`);
    }
  }
  return parts.join(',');
}

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

/**
 * 「审批未通过 ⇒ 一件都不给看」的统一出口（#1075 P2-1 / J9a）。
 *
 * 🔴 `pending` 与 `unverified` **处置相同（不生效）、可见性不同**（规格 D3）：
 *   · `pending`：默认状态 ⇒ `log.warn`（不是故障）；
 *   · `unverified`：异常态 ⇒ `log.error`（带判定侧 typed code）。
 *   两者 `problems` 都点名 `ROLE_PACK_APPROVAL_*` 装载期码 ＋ 内容侧问题（若有）—— J9a 据此可 grep。
 */
function approvalUnavailable(
  roleId: string,
  abs: string,
  approval: RolePackApproval,
  contentProblems: readonly string[],
): KnowledgeScopeDeclaration {
  const code = approval.status === 'pending' ? 'ROLE_PACK_APPROVAL_PENDING' : APPROVAL_UNVERIFIED_CODE;
  const problems = [
    `${code}: 岗位包审批未通过（status=${approval.status}` +
      `${approval.code !== undefined ? `, code=${approval.code}` : ''}）` +
      `${approval.reason !== undefined ? ` — ${approval.reason}` : ''}`,
    ...contentProblems,
  ];
  const detail = { roleId, path: abs, status: approval.status, code, approvalCode: approval.code, degraded: true };
  if (approval.status === 'pending') {
    log.warn(detail, '岗位包无审批记录（pending）— 该岗位按 fail-closed 拒绝全部知识（不生效，非故障）');
  } else {
    log.error(detail, '岗位包审批未通过（unverified）— 该岗位按 fail-closed 拒绝全部知识');
  }
  return { roleId, declared: false, scopeIds: [], denyIds: [], problems, degraded: true };
}

/**
 * 按需解析某岗位的知识范围（**请求路径**入口；#731 / T1 / d-refresh / #1075 P2-1）。
 *
 * @input  `roleId`（验签身份里的角色名）、`options.root`（内容根；缺省走 `SYNOVA_PRESETS_ROOT` 注入缝）、
 *         `options.orgId`（审批租户字段；缺省 `loadConfig().orgId` —— N5）
 * @output {@link KnowledgeScopeDeclaration}
 * @degraded **四条分支，安全方向不同（别合并）**:
 *           ① **角色目录不存在**（admin/manager/employee/viewer/liaison/ga/未知角色）
 *              ⇒ `declared: false, degraded: false` ＋ `log.warn`（I-C4：不追加 scope 维，**可观测**）；
 *           ② **角色目录存在但审批未通过**（`pending`／`unverified`；#1075 P2-1 / J9a）
 *              ⇒ `degraded: true` ＋ `problems` 含 `ROLE_PACK_APPROVAL_PENDING`／`ROLE_PACK_APPROVAL_UNVERIFIED`
 *              ＋ 内容侧问题 ⇒ 调用点给 `{pkb_domain IN []}`（**整岗一件都不给看**）；
 *           ③ **审批通过但 `knowledge-scope.yaml` 缺失/不可读/为空文档**
 *              ⇒ `degraded: true` ＋ `log.error(code=KNOWLEDGE_SCOPE_MISSING)` ⇒ 同上 fail-closed；
 *           ④ **内容坏**（YAML 坏/形状非法/`scopes[]` 空/重复 id）
 *              ⇒ `degraded: true` ＋ `log.error(code=KNOWLEDGE_SCOPE_INVALID)` ⇒ 同上 fail-closed。
 *           🔴 ② 是 #1075 P2-1 加的**工作流闸**：未审批 ≠ "该角色不属岗位包管辖"，
 *           不许落到 ①（那会把"未审批"变成"不限制"）。
 *           **本函数从不抛**（它在每个请求的判定路径上跑）。
 *
 * 🔴 缓存口径（d-refresh ＋ D10/J10）：缓存键 = `scopeYaml 指纹 | orgId | 审批指纹 | 六件 stat 指纹`
 *   —— 同一服务寿命内改内容文件（只改 mtime 或只改大小都算）、**写/删审批记录**、换 orgId
 *   ⇒ **下一次调用即重解析/重判**（J10：批准/撤销即时生效，**不依赖 `clearPresetCache()`**）。
 *   禁进程级常量：那会让"改文件 ⇒ 结果变"这条判据（D5 V3）假绿。
 */
export function resolveRoleKnowledgeScope(
  roleId: string,
  options: { root?: string; orgId?: string } = {},
): KnowledgeScopeDeclaration {
  try {
    const root = options.root !== undefined && options.root.length > 0 ? options.root : resolvePresetsRoot();
    const orgId = resolveOrgId(options.orgId);
    const repoRoot = resolve(root, '../..');
    const roleDir = join(root, ROLES_SUBDIR, roleId);
    const abs = join(roleDir, SCOPE_FILE);

    const roleDirExists = ((): boolean => {
      try {
        return statSync(roleDir).isDirectory();
      } catch {
        return false; // 目录不存在 = 该角色不属岗位包管辖（I-C4 的正常路径，不是错误）
      }
    })();

    if (!roleDirExists) {
      // I-C4：**角色目录不存在** ⇒ 不追加 scope 维（但必须可见，不静默）
      log.warn({ roleId, path: abs }, '岗位包目录不存在 ⇒ 不追加 scope 维（I-C4，可观测）');
      return { roleId, declared: false, scopeIds: [], denyIds: [], problems: [], degraded: false };
    }

    // 内容侧指纹（scope 件单独取：既要判断"是否可解析"，也是缓存键的一部分）
    let scopeFingerprint = 'missing';
    try {
      const stats = statSync(abs);
      if (stats.isFile()) scopeFingerprint = `${String(stats.mtimeMs)}:${String(stats.size)}`;
    } catch {
      // 缺件 ⇒ 'missing'（角色目录在而文件缺 ⇒ 后续审批/内容分支会 fail-closed，不在此静默）
    }
    const cacheKey = [
      scopeFingerprint,
      orgId,
      approvalFingerprintOf(roleId, approvalsRootFor(repoRoot)),
      piecesStatFingerprint(roleDir),
    ].join('|');

    const cached = scopeDeclCache.get(abs);
    if (cached !== undefined && cached.fingerprint === cacheKey) return cached.decl;

    // 审批判定（#1075 P2-1）：**单读**拿 contentHash（validateRolePackDir 内部六件只读一次）
    const validation = validateRolePackDir(roleDir, { repoRoot });
    const approval = resolveApprovalForRole(roleDir, roleId, validation, repoRoot);
    if (!validation.ok) {
      // 校验问题逐条留痕（装载期 errors[] 已有；请求路径也要可见 —— 铁律 24/31）
      log.warn(
        { roleId, problems: validation.problems, degraded: true },
        '请求路径：岗位包结构/refs 校验未通过 — 逐条点名（不抛）',
      );
    }

    const decl = parseKnowledgeScope(abs, roleId);

    let result: KnowledgeScopeDeclaration;
    if (approval.status !== 'approved') {
      // ② 未审批 ⇒ 整岗一件都不给看（J9a/J9b；**不得**落到 I-C4 的"不追加"分支）
      result = approvalUnavailable(roleId, abs, approval, decl.problems);
    } else if (decl.degraded) {
      // ③/④ 内容坏 ⇒ fail-closed（既有语义不动）
      log.error(
        { roleId, path: abs, problems: decl.problems, code: 'KNOWLEDGE_SCOPE_INVALID', degraded: true },
        '知识范围文件内容非法 — 该岗位按 fail-closed 拒绝全部知识（不回落"不过滤"）',
      );
      result = decl;
    } else if (!decl.declared) {
      // 文件在、可读，但内容为空/仅注释 ⇒ 声明面缺失（同族 fail-open，一律 fail-closed）
      result = scopeUnavailable(roleId, abs, `${abs}: 文件存在但未声明任何内容（空文档/仅注释）`);
    } else {
      result = decl;
    }

    scopeDeclCache.set(abs, { fingerprint: cacheKey, decl: result });
    return result;
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
 * 读一个角色包（磁盘实测六件 ＋ v3 结构/refs 校验 ＋ 审批判定）。
 *
 * #731 / T1：`knowledge-scope.yaml` 从"只判存在且非空"升级为**解析内容 ＋ 校验** ——
 *   内容坏（语法/形状/空 scopes/重复 id）⇒ 逐条进 `errors[]` ⇒ `degraded: true` ⇒ **可观测**，
 *   不再"文件在就当作齐备"。文件缺席/空文档 ⇒ 不计内容错（KL-T1-1），缺件另由 `missing` 报。
 *
 * #1075 P1-a：六件存在性判定后接 `validateRolePackDir()`（结构 ＋ `pieces`/`refs`/内容源三方对账）；
 *   问题逐条折成 `${roleId}: ${code} ${message}` 进 `errors[]`（点名可 grep）＋ `degraded:true`，**不抛**。
 *   🔴 `manifest.json` 缺件时**跳过** schema 校验（缺件已由 `missing`＋errors 报，不再级联 UNREADABLE）。
 *
 * #1075 P2-1：校验之后接审批判定（**同一份校验结果里的 contentHash**，不二次读盘）：
 *   `approved` ⇒ 可进 `usable[]`；`pending` ⇒ 不生效、**不计 degraded**；`unverified` ⇒ 不生效、
 *   `errors[]` 点名 `ROLE_PACK_APPROVAL_UNVERIFIED` ＋ `degraded:true`（铁律 11/24/31）。
 *
 * #1104（规格 §10-L14）：`repoRoot` 由调用方**显式传入** —— 来源＝内容根派生
 *   （内容根形如 `<root>/extensions/presets`，故 `repoRoot = resolve(root, '../..')`，见 `loadRolePacks()`）。
 *   🔴 判据：`kind=file` 的 refs 按本参数解析，**不得**回退 `process.cwd()` —— 否则打包/桌面形态
 *   （cwd≠仓库根）三个出厂包全部 degraded。approvalsRoot 同样由它派生（`<repoRoot>/.synova/approvals`）。
 *   本函数仍**不抛**：一切问题折进 `errors[]` ＋ `degraded:true`。
 *
 * @param rolesRoot - 角色目录的父目录（绝对路径）
 * @param roleId - 角色 id（= 目录名）
 * @param errors - 逐条问题累加器（调用方持有；本函数 push，不抛）
 * @param repoRoot - `kind=file` 引用的解析基准 ＋ 审批记录根派生基准（由内容根派生，禁 cwd）
 * @returns {@link RolePack}
 */
function readRolePack(rolesRoot: string, roleId: string, errors: string[], repoRoot: string): RolePack {
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

  // #1075 P1-a：v3 结构 ＋ refs 三方对账（IO 壳；不抛）。缺 manifest ⇒ 跳过（未校验，无 contentHash）
  let validation: RolePackValidation = { ok: false, schemaVersion: null, problems: [], refsChecked: 0 };
  if (pieces.includes('manifest.json')) {
    validation = validateRolePackDir(roleDir, { repoRoot });
    if (!validation.ok) {
      for (const problem of validation.problems) {
        errors.push(`${roleId}: ${problem.code} ${problem.message}`);
      }
      log.warn(
        { roleId, problems: validation.problems, degraded: true },
        '角色包 v3 结构/refs 校验未通过 — 逐条点名（不抛）',
      );
    } else {
      log.info({ roleId, refsChecked: validation.refsChecked }, '角色包 v3 结构与 refs 对账通过');
    }
  }

  // #1075 P2-1：审批判定（N4：无 contentHash ⇒ 不判；否则交 judge（单读产出 hash，不二次读盘））
  const approval = resolveApprovalForRole(roleDir, roleId, validation, repoRoot);
  if (approval.status === 'unverified') {
    // N4 分支（校验未通过 ⇒ 无 hash ⇒ 不判审批）时，`validation.problems` 已逐条进 errors[] 且已 degraded
    // ⇒ **不重复追加**第二条同包错误行（逐包归因保持"一包一码"；审批态在 `RolePack.approval` 与 log 可见）。
    const alreadyReportedByValidation = !validation.ok && validation.problems.length > 0;
    if (!alreadyReportedByValidation) {
      errors.push(
        `${roleId}: ${APPROVAL_UNVERIFIED_CODE}` +
          `${approval.code !== undefined ? ` ${approval.code}` : ''}` +
          `${approval.reason !== undefined ? ` — ${approval.reason}` : ''}`,
      );
    }
    log.error(
      { roleId, code: approval.code, reason: approval.reason, degraded: true, alreadyReportedByValidation },
      '角色包审批未通过 — 不生效（unverified 计入 degraded）',
    );
  } else if (approval.status === 'pending') {
    // pending = 默认状态（无记录）⇒ 不生效但**不计 degraded**（§4.5-C1 口径）；点名可 grep
    log.info(
      { roleId, code: approval.code, status: approval.status },
      '角色包无审批记录 — 不生效（pending，不计 degraded）',
    );
  } else {
    log.info(
      {
        roleId,
        approvalId: approval.approvalId,
        scope: approval.scope,
        permissionsPending: approval.permissionsPending,
      },
      '角色包审批通过 — 可进 usable[]',
    );
  }

  return {
    roleId,
    pieces,
    missing,
    knowledgeScope,
    schemaVersion: validation.schemaVersion,
    schemaValid: validation.ok,
    validation,
    approval,
  };
}

/**
 * 装配角色预设包（boot 入口 / 判据入口）。
 *
 * 🔴 零参（探针只驱动零参导出）—— 内容根由 `process.cwd()` + `SYNOVA_PRESETS_ROOT` 推导。
 * #1104：`repoRoot` 由**内容根派生**（`<root>/extensions/presets` ⇒ `resolve(root, '../..')`），
 *   显式传给 `readRolePack()` → `validateRolePackDir()`；`SYNOVA_PRESETS_ROOT` 注入的临时夹具根
 *   同理派生 —— 故 cwd≠仓库根时装载不再降级。
 * #1075 P2-1：`usable[]` = `approved ∧ validation.ok`（**稳定排序**；`roles[]` 保留全量）。
 */
export function loadRolePacks(): PresetLoadReport {
  const errors: string[] = [];
  const root = resolvePresetsRoot();
  const rolesRoot = join(root, ROLES_SUBDIR);
  // #1104：内容根形如 `<repoRoot>/extensions/presets` ⇒ 由它反推仓库根（禁 process.cwd()）
  const repoRoot = resolve(root, '../..');

  if (!existsSync(root)) {
    // ENOENT = 正常默认：内容面未装 ⇒ degraded，不是错误
    log.warn({ root }, 'presets 内容根不存在 — 角色预设包未装配（degraded，非错误）');
    return { root, roles: [], usable: [], degraded: true, errors };
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

  const roles = roleIds.map((id) => readRolePack(rolesRoot, id, errors, repoRoot));
  // #1075 P2-1 / D6：只有"审批批准 ∧ 结构合法"才可进可用集；roles[] 保留全量（可运维）
  const usable = roles
    .filter((pack) => pack.approval.status === 'approved' && pack.validation.ok)
    .map((pack) => pack.roleId);
  const degraded = errors.length > 0 || roleIds.length === 0;
  log.info({ root, roles: roleIds.length, usable: usable.length, degraded }, '角色预设包已装配');
  return { root, roles, usable, degraded, errors };
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
 * 🔴 #731 新增：`resolveRoleKnowledgeScope()` 为了请求路径的代价而带了 **内容/审批指纹缓存**
 *   （d-refresh：键含内容 mtime+size；#1075 P2-1 / D10：键另含 orgId ＋ 审批指纹 ⇒ 批准/撤销即时生效）。
 *   本函数现在**确有缓存要清**，故清掉它；仍满足 `content-registry` 的 `loader.cleanup` 契约
 *   （`probe-role-pack.ts` 会核该符号）。
 * 🔴 **不得依赖本函数**让批准/撤销生效（J10）—— 下一次调用按指纹自己失效；本函数只是额外卫生。
 */
export function clearPresetCache(): void {
  scopeDeclCache.clear();
  log.info('preset-loader 已清 knowledge-scope 解析缓存（loadRolePacks 本身无常驻缓存）');
}
