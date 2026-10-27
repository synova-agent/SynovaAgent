#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-knowledge-scope.ts — **D5 判据件**（#713 前置；#731 的知识一致**数据面**）
 *
 * 判据来源（不是转述）:
 *   · 规格 `.handbook/派单件/2026-10-27-规格-825-M7前置缺口补齐.md` §4.0（D5 定义 ＋ 三条硬性质 (a)(b)(c)）
 *   · dev doc `.handbook/派单件/2026-10-27-devdoc-825-M7生产消费链接线.md`
 *     §2.1（生产消费链现状→目标）／§2.5（d-kb/d-perm/d-jwt/d-v3/d-v4/d-refresh/d-deny）／§4.0／§5
 *   · 卡 `#713`（D5 反例卡）／`#731`（知识一致生产链）
 *
 * 🔴 靶子归一（裁 423，2026-10-27）:
 *   旧靶 = 已退役的"知识范围独立内容目录"（裁 423 归一后不再存在，故不在此写字面路径）——**该目录从来
 *   不存在** ⇒ 本探针改造前恒定 exit 2，从未有可能变绿（"判据存在但无靶"）。
 *   新靶 = **实物三件** `extensions/presets/roles/{finance,hr,sales}/knowledge-scope.yaml`；
 *   断言对象 = **真路由** `POST /api/knowledge/search` ＋ **真中间件链**（jwtAuthMiddleware → rbacMiddleware
 *   → 内联 provider）＋ **真 loader**（`src/init/preset-loader.ts` 的 `loadRolePacks()`）。
 *
 * 契约（铁律 47）:
 *   @input  — 裸跑（无参，卡面判据命令）｜`--base-url <url>`｜`--roles finance,hr`｜`--presets-root <dir>`
 *             ｜兼容 `--case layering` 与 `--all`（场景解析仍走 `probe-ladder.parseProbeArgs` 唯一实现）
 *   @output — stdout 逐条 `✅ PASS` / `❌ FAIL` / `⚠️ 未实现` / `⚠️ UNVERIFIED`，每条断言显式带级别
 *             `[L1-静态可达]` 或 `[L2-真跑通]`；末行由 `out.finish()` 单点签发 `RESULT=<verdict>`
 *   @degraded — 目标件缺失 / 岗位集派生为空（信号量==0） / 未接线（declared-only） / 环境不足
 *             ⇒ 逐条 `⚠️ 未实现` 后 **exit 2**（禁把"看不见"当"没问题"）
 *   退出码（三态，逐字保留）:
 *     0 = 全部 PASS ｜ 1 = 有 FAIL（**目标件在但断言不成立 = 业务红**）
 *     2 = 目标能力未实现 / 环境或检查自身失败 / **信号量==0**
 *   @exit    — 三态退出码的**标签形态**（D328；语义与上三行逐字同源，非第二口径）:
 *              0 = 全部 PASS
 *              1 = 有 FAIL（目标件在但断言不成立 = 业务红）
 *              2 = 目标能力未实现 / 环境或检查自身失败 / **信号量==0**
 *              ⇒ 散文与标签是同一语义的两个形态，**任一处不同 = 改门禁语义 = A 类**（须另走提案）。
 *
 * 🔴 @authority（**谁能跑／谁能改** —— 显式授权，DSH B5）:
 *   · 裸跑（无参）: **任何会话/任何人可跑** —— 这是卡面判据命令；只读仓库实物内容根，
 *     不写库、不写仓库，产出只在本进程 stdout。
 *   · 行为面（`--base-url`）: **需调用方自备环境** —— ① 已起好的服务（`DEV_MODE=true`，供真路由
 *     注册/登录取凭据；本件禁自造 JWT）② `SYNOVA_DB_PATH` 指向**临时库**（播种＋回库对账；
 *     禁写 `data/`）。本探针**不替生产起服务** ⇒ "谁能跑"＝能自行提供该环境的人
 *     （当前 = 本卡/PR 的取证会话）。
 *   · 谁能改: 脚本骨架／新增 probe = **治理线**（`scripts/control-tower/AGENTS.md`）；本件的
 *     **判据语义**（三态退出码／存在性闸 `GATE_TARGETS` 判定／判别力自检骨架 V5／任何断言字面）
 *     归块 `#713`／`#731` —— 改判据须先引该块卡号并另走提案（A 类）。头注与 README 属文档面。
 *
 * 🔴 @not-here（**本件不做什么** —— 边界，防职责扩散）:
 *   · **不替生产链接线**: 生产链没消费 scopes ⇒ 诚实 exit 2（先红态），不造一个能绿的假象。
 *   · **不建第二判据/第二口径**: 目标件清单只在 `TARGETS`／`GATE_TARGETS` 声明一处；权限命名空间
 *     取生产真源 `@synova/engine-auth` 的 `KNOWLEDGE_SCOPES`，不另抄名单；场景解析仍走
 *     `probe-ladder.parseProbeArgs` 唯一实现。
 *   · **不改门禁语义**: 见下方「三处逐字保留」—— 三态退出码（0/1/2）与"信号量==0 ⇒ exit 2"、
 *     存在性闸 `GATE_TARGETS` 判定、判别力自检骨架 V5 全部逐字保留（改这些 = A 类）。
 *   · **除播种外不写库**: 唯一写入是 `--base-url` 模式的播种，且只落 `SYNOVA_DB_PATH` 指向的
 *     **临时库**（KL-1 的 `pkb_domain` 直写已显式披露）；仓库零写痕由 V3 判据守住。
 *
 * 设计哲学（一句）: **判据只观测生产链已经做过的事** —— 探针不替生产链接线，只把"生产链是否真的消费了
 *   knowledge-scope.yaml"变成可观测的红/绿；接线没做，它就诚实地红（exit 2），而不是造一个能绿的假象。
 *
 * 两段式观测（缺一不可；判据来源 dev doc §4.0-(a)）:
 *   ① **结构面**（本进程内即可跑）: 起一个只挂**真中间件链**的 express app，发一次真请求，
 *      用 `getCurrentFilterClause('KnowledgeChunk')` 取**真 provider 返回的条件集**（不是读源码、不是替身）。
 *      条件集里没有 `pkb_domain` 维 ⇒ **生产链未消费 scopes（declared-only）** ⇒ V2/V3/V4/V6 一律 exit 2。
 *   ② **行为面**（须 `--base-url` ＋ 临时库）: 播种（生产 store.insert）→ **真路由**注册/登录取凭据
 *      （d-jwt：禁自造 JWT）→ 两岗位同 query 检索 → 回临时库按 id 反查 `source_id` 对账（d-v4）。
 *      改文件那一步只动 `--presets-root` 指向的**临时内容根**（d-v3），仓库零写痕。
 *
 * 🔴 三处**逐字保留**（改这些＝改门禁语义＝A 类，须另走提案）:
 *   · 三态退出码（0/1/2）与"信号量==0 ⇒ 2"；· 存在性闸 `GATE_TARGETS` 判定（缺任一 ⇒ exit 2）；
 *   · 判别力自检骨架（V5：探针自己把某岗位 scopes 改空/拔文件 ⇒ **自身必须转红**）。
 *
 * 跑法（dev 形态，见 dev doc §5）:
 *   node node_modules/.bin/tsx scripts/control-tower/probe-knowledge-scope.ts                # 裸跑：先红态 exit 2
 *   node node_modules/.bin/tsx scripts/control-tower/probe-knowledge-scope.ts \
 *     --base-url http://127.0.0.1:18790 --roles finance,hr --presets-root "$SYNOVA_PRESETS_ROOT"
 *
 * 已知限制（KL，禁写"暂无"）:
 *   KL-1 **播种必须直写 `pkb_domain`**: `KnowledgeStore.insert()` 的 INSERT 列清单与 `update()` 的
 *        UPDATE 列清单**都不含 `pkb_domain`**（实测：`update(id,{pkb_domain})` 后该列仍为 NULL）
 *        ⇒ 生产写 API 当前**无法**写入域元数据。播种是判据前置（规格 Known Limitations ①"判据语料走
 *        dev 形态播种"），故由探针在**同一库句柄**上直写该列并**显式打印**；断言对象仍全部在**读侧
 *        生产链**上。该缺口已随 PR1 回执上报 L1（影响 #731 接线卡的播种口径）。
 *   KL-2 结构面凭据由本进程 `signJwtToken`（生产签发函数）自签，secret 为**探针内 dev 常数**
 *        （仅当外部未设 `JWT_SECRET`）：该 token **不出本进程**、不用于外部服务；行为面凭据一律走真路由。
 *   KL-3 语料是 dev 形态**最小样本**（每 scope 一条 ＋ 一条 `source_id` 跨两岗位），不度量真实检索质量；
 *        "生产 corpus 分化"是后续数据面活（规格 Known Limitations ①）。
 *   KL-4 `--roles` 只接受实物岗位集（`finance`/`hr`/`sales`）内的岗位；越界即 `ARGS_INVALID`（exit 2），
 *        不做隐式回落（回落会把判据报成绿色的假事实）。
 *   KL-5 V5 自检会以**子进程**重跑本探针（`node --import tsx <本文件>`）⇒ 需 tsx 可按 cwd 解析；
 *        子进程内以 `SYNOVA_PROBE_KS_SELFCHECK=1` 防递归。
 *   KL-6 **不能删语料行**：`knowledge_chunks` 的 FTS 同步触发器 `kc_fts_delete` 把字符串 `id` 当 FTS5 的
 *        rowid（`VALUES('delete', old.id, …)`），rowid 必须整数 ⇒ 任何 `DELETE` 都抛
 *        `SQLITE_ERROR: SQL logic error`（实测：按 id 逐行删同样失败）。故播种改为"已存在且域集合一致
 *        就复用"，不一致则报环境原因（换临时库）——不拿脏语料出绿。该缺口属 `src/l4/knowledge-store.ts`
 *        （本卡写集外），已随回执上报。
 */

import { execFileSync, spawnSync } from 'child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import type { Server } from 'http';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import express, { type NextFunction, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { jwtAuthMiddleware, signJwtToken } from '../../src/middleware/auth';
import { rbacMiddleware } from '../../src/middleware/rbac';
import { getCurrentFilterClause } from '../../src/services/request-context';
import { loadRolePacks, type PresetLoadReport } from '../../src/init/preset-loader';
import { KnowledgeStore } from '../../src/l4/knowledge-store';
// 权限命名空间宇宙的**生产真源**（d-perm：命名空间 = scope id 第一个 '.' 之前的前缀）——
// 探针不自己抄一份名单（禁第二口径）；T2 换成文件派生后，这里自动跟着变。
import { KNOWLEDGE_SCOPES } from '@synova/engine-auth';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

/** 本探针的场景集 —— 卡面判据命令是**裸跑即跑**，故只有一个场景（parseProbeArgs 无参会自动选中它） */
export const KNOWN_CASES: readonly string[] = ['layering'] as const;

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」
 * 机械校验（`probe-ladder.readDeclaredTargets` 用正则解析**字面量数组**，故这里必须是字面量，禁用展开）。
 *
 * 声明口径：**本探针一旦报 PASS 就必然存在**的那一组 = 存在性闸三件（实物岗位 scope 文件）
 * ＋ 本判据断言对象所在的三个生产件（真路由 / 真中间件链的认证与 RBAC）。
 */
export const TARGETS: readonly string[] = [
  'extensions/presets/roles/finance/knowledge-scope.yaml',
  'extensions/presets/roles/hr/knowledge-scope.yaml',
  'extensions/presets/roles/sales/knowledge-scope.yaml',
  'src/routes/knowledge.ts',
  'src/middleware/auth.ts',
  'src/middleware/rbac.ts',
];

/**
 * 存在性闸（语义**逐字保留**：缺任一 ⇒ exit 2）——只换了靶：
 * 实物三件岗位 `knowledge-scope.yaml`，不再是那个已退役、从来不存在的内容面独立目录（见裁 423）。
 * 给了 `--presets-root` 时，同一组相对路径还会在**临时内容根**上再判一次（V3/反例都在这根上动手）。
 */
const GATE_TARGETS: readonly string[] = [
  'extensions/presets/roles/finance/knowledge-scope.yaml',
  'extensions/presets/roles/hr/knowledge-scope.yaml',
  'extensions/presets/roles/sales/knowledge-scope.yaml',
];

/** 只打印、不作闸：本卡接线会落在这里（写集外，探针只披露存在性） */
const INFORMATIONAL: readonly string[] = [
  'packages/engine-auth/src/permission-grants.ts',
  'src/init/preset-loader.ts',
];

/** 实物岗位集（**文件派生结果的期望值**；集合相等断言，不是 ≥1） */
const EXPECTED_ROLES: readonly string[] = ['finance', 'hr', 'sales'];

/** 内容根下的相对结构（与 `src/init/preset-loader.ts` 同口径） */
const PRESETS_REL = 'extensions/presets/';
const ROLES_SUBDIR = 'roles';
const SCOPE_FILE = 'knowledge-scope.yaml';

/**
 * scope 维条件字段名 —— **I-C1/I-C2 接口契约**（PR1/PR2 两端必须一致；队长定，见卡 `task-4`）:
 *   scope ⇒ `{ field:'pkb_domain', operator:'IN', value:<scopes[].id 去重排序> }`
 *   deny  ⇒ `{ field:'pkb_domain', operator:'NOT_EQ', value:<deny[].id> }`（matchFilter 无 NOT_IN）
 * 名字取自 `knowledge_chunks.pkb_domain` 列（`src/l4/knowledge-store.ts:72`），且 `matchFilter`
 * 对字段名直通（`:701` `colMap[field] || field`）⇒ 加该维**不需要**改 store。
 */
const SCOPE_FIELD = 'pkb_domain';
/** 既有敏感度条件（K12-11 不回退：必须仍在条件集第 0 位，scope 维只能"追加"） */
const SENSITIVITY_FIELD = 'access.sensitivity';

/** 已知权限命名空间集合 —— 直接取生产真源 `@synova/engine-auth` 的 `KNOWLEDGE_SCOPES`（禁第二口径） */
const KNOWN_SCOPE_NAMESPACES: ReadonlySet<string> = new Set<string>(KNOWLEDGE_SCOPES);

/** 生产入口（卡面原文） */
const SEARCH_PATH = '/api/knowledge/search';
const AUTH_REGISTER_PATH = '/api/auth/register';
const AUTH_LOGIN_PATH = '/api/auth/login';

/**
 * 检索探针用的同一 query —— 🔴 必须**不含连字符**：FTS5 把 `-` 当 NOT 运算符，
 * `MATCH 'synova-probe-…'` 会抛 `SqliteError: no such column`（实测）⇒ 生产路由 500。
 */
const PROBE_QUERY = 'synovaprobeknowledgescope';

/** 默认两岗位（卡面旗标示例 `--roles finance,hr`） */
const DEFAULT_ROLES: readonly string[] = ['finance', 'hr'];

/** 探针播种语料的 `source_id` 前缀（幂等清理只认这个前缀，绝不碰真实语料） */
const SEED_SOURCE_PREFIX = 'probe-ks:';

/** dev 形态行为面凭据的固定口令（真路由注册/登录用；非生产凭据） */
const DEV_PASSWORD = 'probe-dev-pass-1';
/** 结构面自签用的 dev secret（仅当外部未设 JWT_SECRET；见 KL-2） */
const DEV_JWT_SECRET = 'probe-ks-dev-secret-0123456789';
/** 自检子进程防递归开关 */
const SELFCHECK_ENV = 'SYNOVA_PROBE_KS_SELFCHECK';
/** HTTP / 子进程超时（超时即 fail-loud，不静默等） */
const HTTP_TIMEOUT_MS = 15_000;
const SELFCHECK_TIMEOUT_MS = 180_000;

/** 六条 V 判据的**目标态**语义（靶=实物三件；用于未实现时逐条披露） */
const V_ITEMS: ReadonlyArray<{ id: string; text: string }> = [
  { id: 'V1', text: '文件派生岗位集 == 实物 {finance,hr,sales}（集合相等），且每岗位 scopes[] 非空' },
  { id: 'V2', text: '两岗位同一 query 穿真路由 POST /api/knowledge/search ⇒ 返回 id 集合不同' },
  { id: 'V3', text: '改临时内容根里 finance 的 scopes ⇒ finance 结果变、hr 不变，且仓库 git status --porcelain 无新增' },
  { id: 'V4', text: '可对账：两岗位结果 id 回临时库 SELECT source_id 反查 ⇒ 同一事实指向同一源行' },
  { id: 'V5', text: '判别力自检：拔岗位 scope 文件 ⇒ 自身 exit 2；scopes 改空 ⇒ 自身 exit 1' },
  { id: 'V6', text: 'deny 两段式：(i) 真 provider 条件集含 deny 派生的 NOT_EQ 逐 id；(ii) 临时根构造 scopes 与 deny 同 id 重叠 ⇒ 排除只能来自 deny' },
];

/** declared-only 的统一原因串（回执/PR 正文直接引用这一句） */
const DECLARED_ONLY_REASON =
  '生产链未消费 scopes（declared-only：真 provider 条件集无 pkb_domain 维）⇒ 未接线，判据不可判定（先红态，禁谎报绿）';

// ─────────────────────────────────────────────────────────────────────────────
// 类型与小工具（本文件自足；写集只含本文件）
// ─────────────────────────────────────────────────────────────────────────────

/** 生产 FilterClause 的一条条件（内联结构类型；取值由 normalizeConditions 显式校验，铁律 38） */
interface FilterCondition {
  readonly field: string;
  readonly operator: string;
  readonly value: unknown;
}

/** 一个岗位的 scope 文件真解析结果（`problem === null` 才算内容可用） */
interface RoleScopeDecl {
  readonly roleId: string;
  readonly scopes: readonly string[];
  readonly deny: readonly string[];
  readonly problem: string | null;
}

/** CLI 旗标（裸跑时三项皆空，语义与旧卡一致） */
interface ProbeCliOptions {
  readonly baseUrl: string | null;
  readonly roles: readonly string[];
  readonly presetsRoot: string | null;
}

/** 一次运行的上下文（内容根 + 岗位声明 + 旗标） */
interface ProbeContext {
  readonly root: string;
  readonly presetsRoot: string;
  readonly options: ProbeCliOptions;
  readonly roleDecls: readonly RoleScopeDecl[];
}

/** 结构面观测结果：production chain 是否消费了 scopes ＋ 每岗位条件集 */
interface ScopeObservation {
  readonly consumed: boolean;
  readonly conditions: ReadonlyMap<string, readonly FilterCondition[]>;
}

/** 单岗位检索观测 */
interface SearchObservation {
  readonly status: number;
  readonly ids: readonly string[];
}

interface RoleProbe {
  readonly role: string;
  readonly token: string;
  readonly before: SearchObservation;
}

type BehaviourResult =
  | { readonly ok: true; readonly probes: readonly RoleProbe[]; readonly sourceRows: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * d-perm 口径：权限命名空间 = scope id **第一个 '.' 之前**的前缀（`finance.statements` ⇒ `finance`；
 * 裸 id 无前缀 ⇒ 整个 id 视作命名空间，正是"未知命名空间"的形态）。探针只做纯字符串派生，不重定义规则。
 */
function scopeNamespace(scopeId: string): string {
  const dot = scopeId.indexOf('.');
  return dot > 0 ? scopeId.slice(0, dot) : scopeId;
}

/** 收窄成「字符串数组」（非字符串成员丢弃，不静默造值） */
function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * 探针契约形状自检（铁律 47）：ladder 的 ProbeModule 形状 ＋ **闸靶必须是 TARGETS 的子集**。
 * 后者是齿：`assertTargetsExist` 判的是 GATE_TARGETS，而 ladder 的"报绿须目标存在"不变式判的是
 * TARGETS ⇒ 若闸靶不在 TARGETS 里，两套声明就会漂移（假绿从这条缝进来）。
 */
function contractShapeOk(mod: ProbeModule): boolean {
  const shapeOk = Array.isArray(mod.KNOWN_CASES) && mod.KNOWN_CASES.length > 0 && typeof mod.main === 'function';
  const gateOk = GATE_TARGETS.length > 0 && GATE_TARGETS.every((rel) => TARGETS.includes(rel));
  return shapeOk && gateOk;
}

/** `extensions/presets/roles/x/knowledge-scope.yaml` → `roles/x/knowledge-scope.yaml`（同一字面源派生） */
function presetsRelative(repoRelative: string): string {
  return repoRelative.startsWith(PRESETS_REL) ? repoRelative.slice(PRESETS_REL.length) : repoRelative;
}

/** 「无法核实」的统一出口：留 UNVERIFIED ＋ 记 NOT_IMPLEMENTED 让退出码 fail-closed（不许假绿） */
function cannotJudge(out: ProbeOutput, id: string, reason: string): void {
  out.unverified(`${id} 无法核实: ${reason}`);
  out.notImplemented(`${id} 判据不可判定（fail-closed ⇒ exit 2，不许假绿）`);
}

/** 解析 CLI 旗标（只认本卡新增三件；其余原样交回 `parseProbeArgs`，不新增第二套场景口径） */
function parseCliOptions(argv: readonly string[]): { options: ProbeCliOptions; rest: readonly string[] } {
  const rest: string[] = [];
  let baseUrl: string | null = null;
  let presetsRoot: string | null = null;
  let roles: readonly string[] = DEFAULT_ROLES;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === undefined) break;
    if (flag !== '--base-url' && flag !== '--roles' && flag !== '--presets-root') {
      rest.push(flag);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new ProbeError('ARGS_MISSING_VALUE', 'args', `${flag} 后缺值`);
    }
    i += 1;
    if (flag === '--base-url') {
      if (!/^https?:\/\//.test(value)) {
        throw new ProbeError('ARGS_INVALID', 'args', `--base-url 须以 http:// 或 https:// 开头: ${value}`);
      }
      baseUrl = value.replace(/\/+$/, '');
    } else if (flag === '--presets-root') {
      const abs = resolve(value);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        throw new ProbeError('PRESETS_ROOT_MISSING', 'args', `--presets-root 不是目录: ${abs}`);
      }
      presetsRoot = abs;
    } else {
      const picked = value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      if (picked.length < 2) {
        throw new ProbeError('ARGS_INVALID', 'args', '--roles 至少给两个岗位（V2 需两岗位同 query 对照）');
      }
      const unknown = picked.filter((role) => !EXPECTED_ROLES.includes(role));
      if (unknown.length > 0) {
        throw new ProbeError(
          'ARGS_INVALID',
          'args',
          `--roles 含实物岗位集外的岗位: ${unknown.join(',')}（实物集=${EXPECTED_ROLES.join(',')}；不做隐式回落）`,
        );
      }
      roles = picked;
    }
  }
  return { options: { baseUrl, roles, presetsRoot }, rest };
}

/** 环境变量临时覆盖（`SYNOVA_PRESETS_ROOT` 是 loader/engine-auth 的**既有注入缝**，不另造一套） */
async function withEnvOverride<T>(name: string, value: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

/** 真 loader（同步版）：经既有注入缝把内容根拨到 `presetsRoot` */
function loadRolePacksAt(presetsRoot: string): PresetLoadReport {
  const previous = process.env['SYNOVA_PRESETS_ROOT'];
  process.env['SYNOVA_PRESETS_ROOT'] = presetsRoot;
  try {
    return loadRolePacks();
  } finally {
    if (previous === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
    else process.env['SYNOVA_PRESETS_ROOT'] = previous;
  }
}

/** 真解析一个岗位的 `knowledge-scope.yaml`（不是 grep；坏件不抛，转成 `problem` 让判据显式红） */
function readRoleScopes(presetsRoot: string, roleId: string): RoleScopeDecl {
  const abs = join(presetsRoot, ROLES_SUBDIR, roleId, SCOPE_FILE);
  if (!existsSync(abs)) return { roleId, scopes: [], deny: [], problem: `${SCOPE_FILE} 不存在: ${abs}` };
  try {
    const doc = loadYaml(readFileSync(abs, 'utf-8'));
    if (!isRecord(doc)) return { roleId, scopes: [], deny: [], problem: 'YAML 顶层不是映射' };
    const rawScopes = doc['scopes'];
    if (!Array.isArray(rawScopes)) return { roleId, scopes: [], deny: [], problem: '缺 scopes[] 字段' };
    const scopes: string[] = [];
    for (const entry of rawScopes) {
      if (!isRecord(entry) || typeof entry['id'] !== 'string' || entry['id'].length === 0) {
        return { roleId, scopes: [], deny: [], problem: 'scopes[] 条目缺非空 id' };
      }
      scopes.push(entry['id']);
    }
    const deny: string[] = [];
    const rawDeny = doc['deny'];
    if (Array.isArray(rawDeny)) {
      for (const entry of rawDeny) {
        if (isRecord(entry) && typeof entry['id'] === 'string' && entry['id'].length > 0) deny.push(entry['id']);
      }
    }
    return { roleId, scopes, deny, problem: null };
  } catch (err: unknown) {
    return {
      roleId,
      scopes: [],
      deny: [],
      problem: `YAML 解析失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function declOf(ctx: ProbeContext, roleId: string): RoleScopeDecl {
  const found = ctx.roleDecls.find((decl) => decl.roleId === roleId);
  if (found === undefined) {
    throw new ProbeError('ROLE_DECL_MISSING', '内容面', `岗位 ${roleId} 的 scope 声明未载入（内部不一致）`, false);
  }
  return found;
}

/** `git status --porcelain`（V3 的仓库零写痕判据；原始行原样返回，供证据打印） */
function gitPorcelain(root: string): string[] {
  const raw = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' });
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 收窄 provider 返回的条件集（结构不符 ⇒ null，由调用方 fail-loud） */
function normalizeConditions(raw: unknown): FilterCondition[] | null {
  if (!Array.isArray(raw)) return null;
  const conditions: FilterCondition[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const field = item['field'];
    const operator = item['operator'];
    if (typeof field !== 'string' || typeof operator !== 'string') return null;
    conditions.push({ field, operator, value: item['value'] });
  }
  return conditions;
}

/** 从监听中的 server 取回环地址（监听端口 0 ⇒ 内核分配；取不到即 fail-loud） */
function originOf(server: Server): string {
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) {
    throw new ProbeError('SERVER_ADDR_UNKNOWN', '结构观测', 'listen(0) 未返回地址对象', true);
  }
  return `http://127.0.0.1:${String(addr.port)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 结构面：起只挂**真中间件链**的 app，观测真 provider 返回的条件集
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 观测某岗位的真 provider 条件集。
 *
 * 链路与生产同序（`src/server.ts`：jwt → rbac → 路由）：`jwtAuthMiddleware` 验签后
 * `runWithContext({authProvider})`；探针在**它下游**用生产函数 `getCurrentFilterClause('KnowledgeChunk')`
 * 取条件集 —— 这正是路由 `src/routes/knowledge.ts:59` 做的事，探针不复制其逻辑。
 *
 * @returns 条件集；观测失败（无 secret / 未回 200 / 条件集结构不可收窄）⇒ null
 */
async function captureConditions(role: string, presetsRoot: string): Promise<FilterCondition[] | null> {
  const token = signJwtToken({ sub: `probe-${role}`, role, orgId: 'probe-org' });
  if (token === null) return null;
  const box: { conditions: FilterCondition[] | null } = { conditions: null };

  const app = express();
  app.use(express.json());
  app.use(jwtAuthMiddleware);
  app.use(rbacMiddleware);
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    void getCurrentFilterClause('KnowledgeChunk')
      .then((clause) => {
        box.conditions = normalizeConditions(clause.conditions);
        next();
      })
      .catch(() => {
        next();
      });
  });
  app.post(SEARCH_PATH, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  const server = app.listen(0);
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('listening', () => {
        resolveListen();
      });
      server.once('error', (err: Error) => {
        rejectListen(new ProbeError('SERVER_LISTEN_FAILED', '结构观测', err.message, true));
      });
    });
    const base = originOf(server);
    const res = await withEnvOverride('SYNOVA_PRESETS_ROOT', presetsRoot, () =>
      fetch(`${base}${SEARCH_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: PROBE_QUERY, limit: 50 }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      }),
    );
    const text = await res.text();
    if (res.status !== 200) {
      return null;
    }
    if (text.length === 0) return box.conditions;
    return box.conditions;
  } finally {
    server.close();
  }
}

/**
 * 结构面总观测：真 provider 条件集 → 生产链是否消费 scopes ＋ K12-11（sensitivity 仍在第 0 位）守卫。
 * 捕获失败 = 检查自身跑不动 ⇒ 抛 ProbeError（exit 2），不伪装成业务红。
 */
async function observeScopeDimension(ctx: ProbeContext, out: ProbeOutput): Promise<ScopeObservation> {
  const conditions = new Map<string, readonly FilterCondition[]>();
  for (const role of ctx.options.roles) {
    const captured = await captureConditions(role, ctx.presetsRoot);
    if (captured === null) {
      throw new ProbeError(
        'CONDITION_CAPTURE_FAILED',
        '结构观测',
        `岗位 ${role} 的真 provider 条件集不可观测（JWT secret 不可用或 app 未回 200）⇒ 结构面判据自身跑不动`,
        true,
      );
    }
    conditions.set(role, captured);
    out.note(`  [${role}] 真 provider conditions = ${JSON.stringify(captured)}`);
  }

  // K12-11 不回退守卫：scope 维只能"追加"；既有 sensitivity 条件必须仍在条件集第 0 位
  let sensitivityKept = true;
  for (const [role, conds] of conditions) {
    const first = conds[0];
    const ok = first !== undefined && first.field === SENSITIVITY_FIELD && first.operator === 'IN';
    if (!ok) {
      sensitivityKept = false;
      out.fail(`[${role}] 既有 ${SENSITIVITY_FIELD} 条件不在条件集第 0 位 ⇒ K12-11 回退（scope 维只能追加，不许替换）`, 'L1');
    }
  }
  if (sensitivityKept) {
    out.pass(`条件集第 0 位仍是 ${SENSITIVITY_FIELD} 条件（K12-11 不回退：scope 维只能追加）`, 'L1');
  }

  const consumed = [...conditions.values()].every((conds) => conds.some((cond) => cond.field === SCOPE_FIELD));
  if (consumed) {
    out.pass(`生产链已消费 scopes：条件集出现 ${SCOPE_FIELD} 维（declared-only 已消除）`, 'L2');
  } else {
    out.note(`  declared-only 判定: 条件集内无 ${SCOPE_FIELD} 维 ⇒ 生产链未消费 knowledge-scope.yaml（接线未做）`);
  }
  return { consumed, conditions };
}

// ─────────────────────────────────────────────────────────────────────────────
// 行为面：播种（生产 store）→ 真路由凭据 → 两岗位检索 → 回库对账
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KL-1：生产写 API **没有** `pkb_domain` 写入路径（`insert()` 的 INSERT 列清单与 `update()` 的
 * UPDATE 列清单都不含该列；实测 `update` 后仍 NULL）⇒ 播种改在同一库句柄上直写该列。
 * 本函数**不参与任何断言**：断言对象全在读侧生产链（store.search ＋ 真路由）。
 */
function patchPkbDomain(db: Database.Database, id: string, scopeId: string): void {
  db.prepare('UPDATE knowledge_chunks SET pkb_domain = ? WHERE id = ?').run(scopeId, id);
}

/** 探针语料现状（按 `source_id` 前缀识别，绝不碰真实语料） */
function readProbeCorpus(db: Database.Database): { count: number; domains: string[] } {
  const rows: unknown = db
    .prepare('SELECT pkb_domain FROM knowledge_chunks WHERE source_id LIKE ?')
    .all(`${SEED_SOURCE_PREFIX}%`);
  const domains: string[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (isRecord(row) && typeof row['pkb_domain'] === 'string') domains.push(row['pkb_domain']);
    }
  }
  return { count: Array.isArray(rows) ? rows.length : 0, domains };
}

/**
 * 播种语料（幂等：**已有同形语料就复用**，不删不重建 —— 见 KL-6）。
 *
 * 🔴 KL-6（实测，2026-10-27）: `knowledge_chunks` 的 FTS 同步触发器 `kc_fts_delete` 把**字符串 id**
 *   当 FTS5 的 rowid 用（`VALUES('delete', old.id, …)`），而 rowid 必须是整数 ⇒ **任何 DELETE 都抛
 *   `SQLITE_ERROR: SQL logic error`**（实测：按 id 逐行删同样失败）。⇒ 探针**不删行**，改为
 *   "语料已在且域集合与当前 scopes 一致 ⇒ 复用；不一致 ⇒ 报环境原因（换临时库重跑），绝不拿脏语料出绿"。
 *   该缺口属 `src/l4/knowledge-store.ts`（本卡写集外），已随回执上报。
 */
function seedCorpus(
  ctx: ProbeContext,
  dbPath: string,
  out: ProbeOutput,
): { ok: true; seeded: number; reused: number } | { ok: false; reason: string } {
  const expectedDomains = [...new Set(ctx.options.roles.flatMap((role) => [...declOf(ctx, role).scopes]))].sort();
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 8000');
    const store = new KnowledgeStore(db);
    const existing = readProbeCorpus(db);
    if (existing.count > 0) {
      const actual = [...new Set(existing.domains)].sort();
      const sameDomains = actual.length === expectedDomains.length && expectedDomains.every((d) => actual.includes(d));
      if (!sameDomains) {
        return {
          ok: false,
          reason:
            `临时库里残留探针语料（${String(existing.count)} 条，域=[${actual.join(',')}]）与当前 scopes（[${expectedDomains.join(',')}]）不一致，` +
            '且 KL-6：生产 FTS 同步触发器使 DELETE 不可用 ⇒ 无法安全重置 ⇒ 请换一个临时库重跑（禁拿脏语料出绿）',
        };
      }
      out.note(`  播种复用: 临时库已有本探针语料 ${String(existing.count)} 条（域一致，KL-6：不删不重建）`);
      return { ok: true, seeded: 0, reused: existing.count };
    }

    const sharedSourceId = `${SEED_SOURCE_PREFIX}shared`;
    const pair = ctx.options.roles.slice(0, 2);
    let seeded = 0;
    for (const role of ctx.options.roles) {
      const decl = declOf(ctx, role);
      decl.scopes.forEach((scopeId, index) => {
        // 两岗位各有一条**同 source_id** 的语料（V4 可对账的最小样本）
        const shared = pair.includes(role) && index === 0;
        const id = store.insert({
          text: `${PROBE_QUERY} role=${role} scope=${scopeId}`,
          sourceType: 'document',
          sourceId: shared ? sharedSourceId : `${SEED_SOURCE_PREFIX}${scopeId}`,
          authorityLevel: 'reference',
          accessLevel: 'private',
          accessSensitivity: 'normal',
        });
        patchPkbDomain(db, id, scopeId); // KL-1
        seeded += 1;
      });
    }
    out.note(
      `  播种(生产 store.insert ＋ KL-1 直写 pkb_domain): ${String(seeded)} 条｜同源事实 source_id=${sharedSourceId}`,
    );
    return { ok: true, seeded, reused: 0 };
  } finally {
    db.close();
  }
}

/** 回临时库按 id 反查 `source_id`（d-v4：路由响应不含 source_id，只能回库对账） */
function lookupSourceIds(dbPath: string, ids: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const placeholders = ids.map(() => '?').join(',');
    const rows: unknown = db
      .prepare(`SELECT id, source_id FROM knowledge_chunks WHERE id IN (${placeholders})`)
      .all(...ids);
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (isRecord(row) && typeof row['id'] === 'string' && typeof row['source_id'] === 'string') {
          map.set(row['id'], row['source_id']);
        }
      }
    }
    return map;
  } finally {
    db.close();
  }
}

/** POST JSON（统一超时；解析失败不回抛，由调用方按 status 判） */
async function postJson(
  url: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> | null; text: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await res.text();
  const box: { body: Record<string, unknown> | null } = { body: null };
  try {
    const value: unknown = JSON.parse(text);
    box.body = isRecord(value) ? value : null;
  } catch (err: unknown) {
    // 铁律 24/31（不静默降级）: 响应体非 JSON 不是"错误"（调用方按 status 判定，非 200 时已打印原文），
    // 但**必须留痕**——诊断信息走 stderr，不污染 stdout 的 `RESULT=` 末行契约。
    box.body = null;
    process.stderr.write(
      `[probe-knowledge-scope] 响应体非 JSON（按无结构化回执处理，body 原文交由调用方处置）: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
  return { status: res.status, body: box.body, text };
}

/** 两岗位凭据：走**真路由**签发（d-jwt：禁自造 JWT）——先注册，已存在则登录取回 */
async function authorize(baseUrl: string, role: string, out: ProbeOutput): Promise<string | null> {
  const email = `probe-${role}@dev.local`;
  const reg = await postJson(`${baseUrl}${AUTH_REGISTER_PATH}`, { email, password: DEV_PASSWORD, role });
  out.note(`  [${role}] POST ${AUTH_REGISTER_PATH} ⇒ HTTP ${String(reg.status)}`);
  const regToken = reg.body?.['token'];
  if (reg.status === 201 && typeof regToken === 'string') {
    out.note('    凭据来源: 真路由注册签发');
    return regToken;
  }
  const login = await postJson(`${baseUrl}${AUTH_LOGIN_PATH}`, { email, password: DEV_PASSWORD });
  out.note(`  [${role}] POST ${AUTH_LOGIN_PATH} ⇒ HTTP ${String(login.status)}`);
  const loginToken = login.body?.['token'];
  if (login.status === 200 && typeof loginToken === 'string') {
    out.note('    凭据来源: 真路由登录取回');
    return loginToken;
  }
  out.note(`    注册回执: ${reg.text.slice(0, 200)}`);
  out.note(`    登录回执: ${login.text.slice(0, 200)}`);
  return null;
}

/** 穿真路由检索一次（同一 query）；非 200 ⇒ null（由调用方按环境/业务分辨） */
async function searchAs(
  baseUrl: string,
  token: string,
  out: ProbeOutput,
  who: string,
): Promise<SearchObservation | null> {
  const res = await postJson(`${baseUrl}${SEARCH_PATH}`, { query: PROBE_QUERY, limit: 50 }, token);
  out.note(`  [${who}] POST ${SEARCH_PATH} ⇒ HTTP ${String(res.status)}`);
  if (res.status !== 200) {
    out.note(`    body: ${res.text.slice(0, 200)}`);
    return null;
  }
  const ids: string[] = [];
  const rows = res.body?.['results'];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (isRecord(row) && typeof row['id'] === 'string') ids.push(row['id']);
    }
  }
  out.note(`    hits=${String(ids.length)} ids=${ids.join(',') || '(空)'}`);
  return { status: res.status, ids };
}

/**
 * 行为面观测（**只观测、不断言**）：即便当前是 declared-only 先红态，也把管线跑一遍并打印观测结果
 * —— 这样 PR2 接完线后的绿跑里，这段代码不是第一次被执行。
 */
async function observeBehaviour(ctx: ProbeContext, out: ProbeOutput): Promise<BehaviourResult> {
  const { baseUrl } = ctx.options;
  if (baseUrl === null) {
    return { ok: false, reason: '未提供 --base-url ⇒ 无法穿真路由做端到端（本探针不替生产起服务）' };
  }
  const dbPath = process.env['SYNOVA_DB_PATH'];
  if (dbPath === undefined || dbPath.length === 0) {
    return { ok: false, reason: '环境缺 SYNOVA_DB_PATH ⇒ 无法播种与回库对账（V4 须直查临时库；禁写主树 data/）' };
  }
  if (!existsSync(dbPath)) {
    return { ok: false, reason: `SYNOVA_DB_PATH 指向的库不存在: ${dbPath}（服务未以该库启动？）` };
  }

  out.note(`  行为面: base=${baseUrl}｜临时库=${dbPath}`);
  const seeded = seedCorpus(ctx, dbPath, out);
  if (!seeded.ok) return { ok: false, reason: seeded.reason };
  const probes: RoleProbe[] = [];
  for (const role of ctx.options.roles) {
    const token = await authorize(baseUrl, role, out);
    if (token === null) {
      return {
        ok: false,
        reason: `岗位 ${role} 无法从真路由取得凭据（${AUTH_REGISTER_PATH}／${AUTH_LOGIN_PATH}）⇒ 需 DEV_MODE=true 且服务已就绪`,
      };
    }
    const before = await searchAs(baseUrl, token, out, role);
    if (before === null) {
      return { ok: false, reason: `岗位 ${role} 的 POST ${SEARCH_PATH} 未返回 200 ⇒ 无法比较两岗位结果集` };
    }
    probes.push({ role, token, before });
  }
  const allIds = probes.flatMap((probe) => probe.before.ids);
  return { ok: true, probes, sourceRows: lookupSourceIds(dbPath, allIds) };
}

// ─────────────────────────────────────────────────────────────────────────────
// V1–V6 断言（仅在存在性闸通过后被调用）
// ─────────────────────────────────────────────────────────────────────────────

/** V1：文件派生岗位集 == 实物三件（集合相等）＋ 每岗位 scopes[] 内容判据 */
function checkRoleSet(ctx: ProbeContext, out: ProbeOutput): void {
  let derived: string[];
  try {
    const report = loadRolePacksAt(ctx.presetsRoot);
    derived = report.roles
      .map((pack) => pack.roleId)
      .slice()
      .sort();
    out.note(
      `  V1 真 loader（src/init/preset-loader.loadRolePacks）派生岗位集 = [${derived.join(', ')}]` +
        `｜内容根=${report.root}｜degraded=${String(report.degraded)}`,
    );
    for (const err of report.errors) out.note(`    loader 报告: ${err}`);
  } catch (err: unknown) {
    cannotJudge(out, 'V1', `真 loader 调用失败: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (derived.length === 0) {
    // 信号量==0 ⇒ exit 2（逐字保留的口径：禁把"看不见"当"没问题"）
    cannotJudge(out, 'V1', '文件派生岗位集为空（信号量==0 ⇒ 禁把"看不见"当"没问题"）');
    return;
  }
  const expected = EXPECTED_ROLES.slice().sort();
  const sameSet = derived.length === expected.length && expected.every((role) => derived.includes(role));
  if (sameSet) {
    out.pass(`V1 文件派生岗位集 == 实物三件 [${expected.join(', ')}]（集合相等，不是 ≥1）`, 'L2');
  } else {
    out.fail(`V1 文件派生岗位集 ≠ 实物三件：派生=[${derived.join(',')}] 期望=[${expected.join(',')}]`, 'L1');
  }

  for (const decl of ctx.roleDecls) {
    if (decl.problem !== null) {
      out.fail(`[${decl.roleId}] ${SCOPE_FILE} 内容不可用: ${decl.problem}`, 'L1');
      continue;
    }
    const duplicates = decl.scopes.filter((id, index) => decl.scopes.indexOf(id) !== index);
    if (decl.scopes.length === 0) {
      out.fail(`[${decl.roleId}] scopes[] 为空 ⇒ 该岗位知识面为空（业务红：文件在但无任何 scope）`, 'L1');
    } else if (duplicates.length > 0) {
      out.fail(`[${decl.roleId}] scopes[] 有重复 id: ${[...new Set(duplicates)].join(',')}`, 'L1');
    } else {
      out.pass(
        `[${decl.roleId}] 真解析 scopes[]=${String(decl.scopes.length)} 个 id｜deny[]=${String(decl.deny.length)} 个 id`,
        'L1',
      );
      // 🔴 独立复核建议 ②（2026-10-27）: PASS 行**不许静默带过异常** —— 下列两态会让 V6 变成恒真式，
      //   必须在紧邻行显式点名（note 不计 PASS/FAIL，但把"这行为什么看起来全绿"说清楚）。
      if (decl.deny.length === 0) {
        out.note(
          `    note: [${decl.roleId}] deny[] 为空 ⇒ 该岗位**无任何排除项**（V6 对它恒真，不得当作"越权面已覆盖"）`,
        );
      }
      const unknownNamespaces = [
        ...new Set(
          decl.scopes
            .map((id) => scopeNamespace(id))
            .filter((ns) => !KNOWN_SCOPE_NAMESPACES.has(ns)),
        ),
      ];
      if (unknownNamespaces.length > 0) {
        out.note(
          `    note: [${decl.roleId}] 未知命名空间 ns=${unknownNamespaces.join(',')} ⇒ 不在 engine-auth 的` +
            ` KNOWLEDGE_SCOPES 内（权限面会 fail-closed 丢弃，须在 PR 正文列 d-perm 迁移说明）`,
        );
      }
    }
  }
}

/** V2：两岗位同一 query ⇒ 返回 id 集合不同（差异来源由 V3 归因到内容文件） */
function checkRoleDifference(behaviour: { probes: readonly RoleProbe[] }, out: ProbeOutput): void {
  const [first, second] = behaviour.probes;
  if (first === undefined || second === undefined) {
    cannotJudge(out, 'V2', '--roles 少于两个岗位 ⇒ 无对照');
    return;
  }
  const left = first.before.ids.slice().sort();
  const right = second.before.ids.slice().sort();
  if (left.length === 0 || right.length === 0) {
    cannotJudge(
      out,
      'V2',
      `岗位结果为空（${first.role}=${String(left.length)}｜${second.role}=${String(right.length)}）⇒ 无法区分"scope 生效"与"库为空"`,
    );
    return;
  }
  const same = left.length === right.length && left.every((id, index) => right[index] === id);
  if (same) {
    out.fail(
      `两岗位同 query 结果集相同（${String(left.length)} 条）⇒ knowledge-scope 未在检索结果上生效（差异该由内容文件决定）`,
      'L2',
    );
    return;
  }
  out.pass(
    `V2 两岗位同 query 结果集不同（${first.role}=${String(left.length)} 条｜${second.role}=${String(right.length)} 条）`,
    'L2',
  );
}

/** V3：改临时内容根里 subject 岗位的 scopes ⇒ 该岗位结果变、对照岗位不变；仓库零写痕 */
async function checkFileDrivesBehaviour(
  ctx: ProbeContext,
  behaviour: { probes: readonly RoleProbe[]; sourceRows: ReadonlyMap<string, string> },
  out: ProbeOutput,
): Promise<void> {
  const [subject, control] = behaviour.probes;
  if (subject === undefined || control === undefined) {
    cannotJudge(out, 'V3', '--roles 少于两个岗位 ⇒ 无对照');
    return;
  }
  if (ctx.options.presetsRoot === null) {
    cannotJudge(out, 'V3', '未提供 --presets-root ⇒ 无法定位服务正在读的内容根（禁止改仓库实物文件）');
    return;
  }
  const baseUrl = ctx.options.baseUrl;
  if (baseUrl === null) {
    cannotJudge(out, 'V3', '未提供 --base-url ⇒ 无法重打真路由观测"改文件 ⇒ 结果变"');
    return;
  }
  const decl = declOf(ctx, subject.role);
  if (decl.scopes.length < 2) {
    cannotJudge(out, 'V3', `岗位 ${subject.role} 的 scopes 少于 2 个 ⇒ 无法"去掉一个再看变化"`);
    return;
  }
  const targetScope = decl.scopes[decl.scopes.length - 1];
  const file = join(ctx.presetsRoot, ROLES_SUBDIR, subject.role, SCOPE_FILE);
  const original = readFileSync(file, 'utf-8');
  const porcelainBefore = gitPorcelain(ctx.root);

  try {
    const doc = loadYaml(original);
    if (!isRecord(doc) || !Array.isArray(doc['scopes'])) {
      cannotJudge(out, 'V3', `临时内容根里的 ${subject.role}/${SCOPE_FILE} 结构异常 ⇒ 无法构造改写`);
      return;
    }
    doc['scopes'] = doc['scopes'].filter((entry) => !(isRecord(entry) && entry['id'] === targetScope));
    writeFileSync(file, dumpYaml(doc), 'utf-8');
    out.note(`  改写临时内容根: ${subject.role}/${SCOPE_FILE} 去掉 scope 「${targetScope}」（仓库零改动）`);

    const subjectAfter = await searchAs(baseUrl, subject.token, out, `${subject.role}(改文件后)`);
    const controlAfter = await searchAs(baseUrl, control.token, out, `${control.role}(改文件后)`);

    if (subjectAfter === null) {
      cannotJudge(out, 'V3', `${subject.role} 改文件后检索不可用（HTTP 非 200）`);
      return;
    }
    const vanished = subject.before.ids.filter((id) => !subjectAfter.ids.includes(id));
    const appeared = subjectAfter.ids.filter((id) => !subject.before.ids.includes(id));
    if (vanished.length === 0) {
      out.fail(
        `V3 改 ${subject.role} 的 scopes（去掉 ${targetScope}）后结果集**未变**（${String(subject.before.ids.length)} → ${String(subjectAfter.ids.length)}）⇒ 生产链没读内容文件`,
        'L2',
      );
      return;
    }
    const vanishedSources = vanished.map((id) => behaviour.sourceRows.get(id) ?? '(反查不到)');
    const sourcesMatch = vanishedSources.every((sourceId) => sourceId.endsWith(targetScope));
    if (sourcesMatch) {
      out.pass(
        `V3 行为跟着内容文件走: ${subject.role} 少了 ${String(vanished.length)} 条，且消失项 source_id 正属被去掉的 scope「${targetScope}」`,
        'L2',
      );
    } else {
      out.fail(
        `V3 结果变化与内容改写**不对应**: 去掉「${targetScope}」却消失了 ${vanishedSources.join(',')} ⇒ 差异不是由 knowledge-scope.yaml 决定`,
        'L2',
      );
      return;
    }
    if (appeared.length > 0) {
      out.fail(`V3 改文件后 ${subject.role} 出现新命中 ${appeared.join(',')}（去掉 scope 不该新增命中）`, 'L1');
    }
    if (controlAfter === null) {
      cannotJudge(out, 'V3', `${control.role} 改文件后检索不可用（HTTP 非 200）`);
      return;
    }
    const controlSame =
      control.before.ids.length === controlAfter.ids.length &&
      control.before.ids.every((id) => controlAfter.ids.includes(id));
    if (controlSame) {
      out.pass(`V3 对照岗位 ${control.role} 结果集不变（${String(controlAfter.ids.length)} 条）⇒ 差异只由该岗位的 scope 文件决定`, 'L2');
    } else {
      out.fail(
        `V3 对照岗位 ${control.role} 结果集也变了（${String(control.before.ids.length)} → ${String(controlAfter.ids.length)}）⇒ 差异来源不止内容文件`,
        'L1',
      );
    }
  } finally {
    writeFileSync(file, original, 'utf-8');
  }

  const porcelainAfter = gitPorcelain(ctx.root);
  const newDirty = porcelainAfter.filter((line) => !porcelainBefore.includes(line));
  out.note(
    `  git status --porcelain 改文件前=${String(porcelainBefore.length)} 条｜改文件后=${String(porcelainAfter.length)} 条｜新增=${String(newDirty.length)} 条` +
      (porcelainAfter.length === 0 ? '（仓库零写痕）' : `：${porcelainAfter.slice(0, 5).join(' ; ')}`),
  );
  if (newDirty.length === 0) {
    out.pass('V3 仓库零写痕：git status --porcelain 无新增条目（改动只落在临时内容根）', 'L2');
  } else {
    out.fail(`V3 仓库出现新写痕: ${newDirty.slice(0, 5).join(' ; ')} ⇒ 判定行为不是在临时根上验证的`, 'L1');
  }
}

/** V4：一致性 = **可对账**（≠ 相同输出）——两岗位结果 id 回临时库反查 `source_id`，同一事实须同源 */
function checkReconcile(
  behaviour: { probes: readonly RoleProbe[]; sourceRows: ReadonlyMap<string, string> },
  out: ProbeOutput,
): void {
  const allIds = behaviour.probes.flatMap((probe) => probe.before.ids);
  const missing = allIds.filter((id) => !behaviour.sourceRows.has(id));
  if (missing.length > 0) {
    out.fail(
      `V4 结果 id 回临时库反查不到 source_id: ${missing.slice(0, 5).join(',')}${missing.length > 5 ? '…' : ''} ⇒ 结果不可对账`,
      'L1',
    );
    return;
  }
  const sourceSets = behaviour.probes.map(
    (probe) => new Set(probe.before.ids.map((id) => behaviour.sourceRows.get(id) ?? '')),
  );
  const firstSet = sourceSets[0] ?? new Set<string>();
  const rest = sourceSets.slice(1);
  const shared = [...firstSet].filter((sourceId) => sourceId.length > 0 && rest.every((set) => set.has(sourceId)));
  out.note(
    `  V4 反查: ${String(allIds.length)} 条 id 全部命中｜同 source_id 交集 = ${shared.join(',') || '(空)'}`,
  );
  if (shared.length === 0) {
    cannotJudge(out, 'V4', '两岗位结果无同源事实（source_id 无交集）⇒ 无法验证"同一事实指向同一源行"（播种须覆盖同源两域）');
    return;
  }
  out.pass(
    `V4 同一事实可对账：source_id=${shared.join(',')} 在两岗位结果中各出现一次且指向同一源行（一致性=可对账≠相同输出）`,
    'L2',
  );
}

/** V6(i) 结构断言：真 provider 条件集内，scope 维 == 文件派生集合，deny 逐 id 有 NOT_EQ */
function checkDenyStructure(ctx: ProbeContext, observed: ScopeObservation, out: ProbeOutput): void {
  for (const role of ctx.options.roles) {
    const decl = declOf(ctx, role);
    const conditions = observed.conditions.get(role) ?? [];
    const allowed = new Set<string>();
    for (const cond of conditions) {
      if (cond.field !== SCOPE_FIELD || cond.operator !== 'IN') continue;
      for (const id of stringArrayOf(cond.value)) allowed.add(id);
    }
    const expected = [...new Set(decl.scopes)].slice().sort();
    const actual = [...allowed].slice().sort();
    const sameSet = expected.length === actual.length && expected.every((id) => allowed.has(id));
    if (sameSet) {
      out.pass(`[${role}] V6(i) scope 维 IN 条件 == 文件派生 scopes（${String(expected.length)} 个 id，集合相等）`, 'L2');
    } else {
      out.fail(
        `[${role}] V6(i) scope 维 IN 条件 ≠ 文件派生 scopes：文件=[${expected.join(',')}] 条件=[${actual.join(',')}]`,
        'L1',
      );
    }

    if (decl.deny.length === 0) {
      out.note(`  [${role}] 文件未声明 deny[] ⇒ 无 deny 派生条件可断言`);
      continue;
    }
    const excluded = new Set<string>();
    for (const cond of conditions) {
      if (cond.field !== SCOPE_FIELD || cond.operator !== 'NOT_EQ') continue;
      if (typeof cond.value === 'string') excluded.add(cond.value);
    }
    const absent = decl.deny.filter((id) => !excluded.has(id));
    if (absent.length === 0) {
      out.pass(
        `[${role}] V6(i) deny 派生排除条件齐备：${String(decl.deny.length)} 条 NOT_EQ 逐 id 命中（${decl.deny.join(',')}）`,
        'L2',
      );
    } else {
      out.fail(
        `[${role}] V6(i) deny 派生排除条件缺失: ${absent.join(',')}（deny 声明了但条件集无对应 NOT_EQ ⇒ 越权面敞开）`,
        'L1',
      );
    }
  }
}

/** V6(ii) 语义断言（防恒真）：临时根里造一份 scopes 与 deny **同 id 重叠**的岗位 yaml ⇒ 排除只能来自 deny */
async function checkDenySemantics(ctx: ProbeContext, out: ProbeOutput): Promise<void> {
  const role = ctx.options.roles[0];
  if (role === undefined) {
    cannotJudge(out, 'V6', '--roles 为空 ⇒ 无法构造语义样本');
    return;
  }
  const decl = declOf(ctx, role);
  if (decl.deny.length === 0) {
    cannotJudge(out, 'V6', `岗位 ${role} 未声明 deny[] ⇒ 无法构造"scopes 与 deny 同 id 重叠"的语义样本`);
    return;
  }
  const denyId = decl.deny[0];
  if (denyId === undefined) return;
  const tempRoot = mkdtempSync(join(tmpdir(), 'probe-ks-deny-'));
  try {
    cpSync(ctx.presetsRoot, tempRoot, { recursive: true });
    const file = join(tempRoot, ROLES_SUBDIR, role, SCOPE_FILE);
    const doc = loadYaml(readFileSync(file, 'utf-8'));
    if (!isRecord(doc) || !Array.isArray(doc['scopes'])) {
      cannotJudge(out, 'V6', '临时根里该岗位 scope 文件结构异常 ⇒ 语义样本构造失败');
      return;
    }
    const scopes: unknown[] = [...doc['scopes']];
    const overlapped = scopes.some((entry) => isRecord(entry) && entry['id'] === denyId);
    if (!overlapped) {
      scopes.push({ id: denyId, label: '(探针构造：与 deny 同 id 的 scope)', collections: ['probe-deny-overlap'] });
      doc['scopes'] = scopes;
      writeFileSync(file, dumpYaml(doc), 'utf-8');
      out.note(`  语义样本: 临时根里把 deny 的 id「${denyId}」同时写进 scopes[]（scopes 与 deny 同 id 重叠）`);
    } else {
      out.note(`  语义样本: 该岗位 scopes 已含 deny 的 id「${denyId}」（天然重叠）`);
    }

    const captured = await captureConditions(role, tempRoot);
    if (captured === null) {
      cannotJudge(out, 'V6', '临时内容根上无法观测条件集（结构面环境不足）');
      return;
    }
    const allowed = new Set<string>();
    const excluded = new Set<string>();
    for (const cond of captured) {
      if (cond.field !== SCOPE_FIELD) continue;
      if (cond.operator === 'IN') for (const id of stringArrayOf(cond.value)) allowed.add(id);
      if (cond.operator === 'NOT_EQ' && typeof cond.value === 'string') excluded.add(cond.value);
    }
    if (!allowed.has(denyId)) {
      out.fail(
        `V6(ii) 语义样本无效：deny 的 id「${denyId}」没进 scope IN 条件 ⇒ 构造没生效（deny 语义仍不可判）`,
        'L1',
      );
      return;
    }
    if (excluded.has(denyId)) {
      out.pass(
        `V6(ii) deny 有牙齿：「${denyId}」同时被 scope IN 允许、被 deny NOT_EQ 排除 ⇒ 该条排除只能来自 deny（防恒真）`,
        'L2',
      );
    } else {
      out.fail(
        `V6(ii) scopes 与 deny 同 id 重叠时条件集缺「${denyId}」的 NOT_EQ ⇒ deny 无牙齿（"看不到 deny 域"只是 scopes 没覆盖的恒真式）`,
        'L1',
      );
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// V5 判别力自检（骨架逐字保留的语义：探针自己把靶改坏 ⇒ **自身必须转红**）
// ─────────────────────────────────────────────────────────────────────────────

/** 把某岗位 yaml 的 scopes 改空（V5-B 的破坏夹具） */
function emptyScopesFixture(file: string): void {
  const doc = loadYaml(readFileSync(file, 'utf-8'));
  if (!isRecord(doc)) {
    throw new ProbeError('SELFCHECK_FIXTURE', '自检夹具', `${file} 顶层不是映射`, true);
  }
  doc['scopes'] = [];
  writeFileSync(file, dumpYaml(doc), 'utf-8');
}

/** 以**子进程**重跑本探针（真退出码，不是模拟） */
function runSelf(scriptPath: string, args: readonly string[]): { status: number | null; lastLine: string } {
  const res = spawnSync(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    timeout: SELFCHECK_TIMEOUT_MS,
    env: { ...process.env, [SELFCHECK_ENV]: '1' },
  });
  const stdout = typeof res.stdout === 'string' ? res.stdout : '';
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { status: res.status, lastLine: lines[lines.length - 1] ?? '(无输出)' };
}

/**
 * V5：判别力自检 —— 探针自己把靶改坏，**自身必须转红**（"永远是绿"的探针 = 检查自身失败）。
 *   A 拔文件 ⇒ 存在性闸 ⇒ exit 2；B scopes 改空 ⇒ 业务红 ⇒ exit 1。
 * 破坏都在 `mktemp -d` 的内容根副本上做，仓库零改动。
 */
function checkDiscrimination(ctx: ProbeContext, out: ProbeOutput): void {
  const scriptPath = process.argv[1];
  if (scriptPath === undefined || !/probe-knowledge-scope\.ts$/.test(scriptPath)) {
    out.note('  V5 判别力自检: 本进程非直接执行（被 ladder import）⇒ 无法起自身子进程，跳过（不计 PASS/FAIL）');
    return;
  }
  if (process.env[SELFCHECK_ENV] === '1') {
    out.note('  V5 判别力自检: 自检子进程内跳过（防无限递归）');
    return;
  }
  const subject = ctx.options.roles[0];
  if (subject === undefined) {
    cannotJudge(out, 'V5', '--roles 为空 ⇒ 无岗位可破坏');
    return;
  }
  const rootMissing = mkdtempSync(join(tmpdir(), 'probe-ks-v5a-'));
  const rootEmpty = mkdtempSync(join(tmpdir(), 'probe-ks-v5b-'));
  try {
    cpSync(ctx.presetsRoot, rootMissing, { recursive: true });
    cpSync(ctx.presetsRoot, rootEmpty, { recursive: true });
    rmSync(join(rootMissing, ROLES_SUBDIR, subject, SCOPE_FILE), { force: true });
    emptyScopesFixture(join(rootEmpty, ROLES_SUBDIR, subject, SCOPE_FILE));
    const sharedArgs = ['--roles', ctx.options.roles.join(',')];

    const caseA = runSelf(scriptPath, ['--presets-root', rootMissing, ...sharedArgs]);
    const caseB = runSelf(scriptPath, ['--presets-root', rootEmpty, ...sharedArgs]);
    out.note(`  V5-A 拔 ${subject}/${SCOPE_FILE} ⇒ 自身子进程真实 exit=${String(caseA.status)}（末行 ${caseA.lastLine}）`);
    out.note(`  V5-B ${subject} scopes 改空 ⇒ 自身子进程真实 exit=${String(caseB.status)}（末行 ${caseB.lastLine}）`);

    if (caseA.status === 2) {
      out.pass('V5-A 判别力: 拔掉岗位 scope 文件 ⇒ 探针自身 exit 2（存在性闸有牙齿）', 'L2');
    } else {
      out.fail(`V5-A 判别力不成立: 拔文件后自身 exit=${String(caseA.status)}（期望 2）⇒ 存在性闸无牙齿`, 'L1');
    }
    if (caseB.status === 1) {
      out.pass('V5-B 判别力: 某岗位 scopes 改空 ⇒ 探针自身 exit 1（业务红有牙齿）', 'L2');
    } else {
      out.fail(`V5-B 判别力不成立: scopes 改空后自身 exit=${String(caseB.status)}（期望 1）⇒ 内容级判据无牙齿`, 'L1');
    }
  } finally {
    rmSync(rootMissing, { recursive: true, force: true });
    rmSync(rootEmpty, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 场景
// ─────────────────────────────────────────────────────────────────────────────

async function runCase(name: string, ctx: ProbeContext, out: ProbeOutput): Promise<void> {
  if (name !== 'layering') {
    cannotJudge(out, name, `本探针无场景「${name}」`);
    return;
  }
  checkRoleSet(ctx, out); // V1
  const observed = await observeScopeDimension(ctx, out); // 结构面（真 middleware ＋ 真 provider）
  checkDiscrimination(ctx, out); // V5（与接线无关：探针自身必须能转红）
  const behaviour = await observeBehaviour(ctx, out); // 行为面：只观测、不断言

  if (!observed.consumed) {
    out.note('  declared-only: 先红态 —— 接线未做，V2/V3/V4/V6 不可判定（本次只交红态证据）');
    // 🔴 独立复核建议 ①（2026-10-27）: 诚实度声明 —— 本态下绿态分支**没有跑过**，不得让人误读成"已验证"。
    out.note('  ⚠️ 执行面声明: 本次**未执行** `--base-url`／绿态分支（V2/V3/V4/V6 的 consumed 面）；');
    out.note('     上述四条判据的语义**尚未被任何真跑验证过** —— 绿态要等 #731 接线完成后的首次运行才首次执行；');
    out.note('     本探针在此不做任何"该分支能绿"的声称。');
    for (const id of ['V2', 'V3', 'V4', 'V6']) cannotJudge(out, id, DECLARED_ONLY_REASON);
    return;
  }

  checkDenyStructure(ctx, observed, out); // V6(i)
  await checkDenySemantics(ctx, out); // V6(ii)

  if (!behaviour.ok) {
    for (const id of ['V2', 'V3', 'V4']) cannotJudge(out, id, `行为面环境不足: ${behaviour.reason}`);
    return;
  }
  checkRoleDifference(behaviour, out); // V2
  await checkFileDrivesBehaviour(ctx, behaviour, out); // V3
  checkReconcile(behaviour, out); // V4
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-knowledge-scope（D5 / #713·#731 · 知识一致数据面）');
  try {
    if (!contractShapeOk({ KNOWN_CASES, main })) {
      out.error('探针契约形状自检失败（KNOWN_CASES／main 形状不符，或 GATE_TARGETS ⊄ TARGETS）');
      out.finish();
      return 2;
    }

    const root = locateRepoRoot();
    const { options, rest } = parseCliOptions(argv);
    const args = parseProbeArgs(KNOWN_CASES, rest);

    // KL-2：结构面需要能自签 token。DEV_MODE=true 时生产 getSecret() 返回 null（设计如此），
    //   故仅在外部未设 JWT_SECRET 时用探针内 dev secret；该 token 不出本进程。
    if (process.env['JWT_SECRET'] === undefined || process.env['JWT_SECRET'].length < 16) {
      process.env['JWT_SECRET'] = DEV_JWT_SECRET;
      out.note('  KL-2: 外部 JWT_SECRET 缺失/过短 ⇒ 结构面改用探针内 dev secret（token 不出本进程）');
    }

    const presetsRoot = options.presetsRoot ?? join(root, PRESETS_REL);
    out.note('判据来源: 规格 §4.0（D5）＋ dev doc §2.1/§2.5/§4.0｜靶: 实物三件 roles/{finance,hr,sales}/knowledge-scope.yaml');
    out.note(`仓库根: ${root}`);
    out.note(`内容根: ${presetsRoot}${options.presetsRoot === null ? '（仓库实物，只读）' : '（--presets-root 临时根）'}`);
    out.note(
      `场景: ${args.all ? '--all' : args.cases.join(', ')}｜岗位: ${options.roles.join(',')}｜base-url: ${options.baseUrl ?? '(未提供)'}`,
    );

    for (const rel of INFORMATIONAL) {
      out.note(`  · 参考件 ${rel} ⇒ ${existsSync(join(root, rel)) ? '存在' : '不存在'}（本卡写集外，不作闸门）`);
    }

    // 存在性闸（语义逐字保留：缺任一 ⇒ exit 2）；给了临时内容根则同一组相对路径在临时根上再判一次
    const repoGateOk = assertTargetsExist(root, out, [...GATE_TARGETS]);
    const presetsGateOk =
      options.presetsRoot === null
        ? true
        : assertTargetsExist(options.presetsRoot, out, GATE_TARGETS.map(presetsRelative));
    if (!repoGateOk || !presetsGateOk) {
      for (const item of V_ITEMS) out.notImplemented(`${item.id} ${item.text}`);
      out.note('原因: 实物岗位 scope 文件缺失 ⇒ 存在性闸判 exit 2（缺任一即 2，语义未变：未实现不许绿）');
      out.finish();
      return out.exitCode();
    }

    const ctx: ProbeContext = {
      root,
      presetsRoot,
      options,
      roleDecls: EXPECTED_ROLES.map((role) => readRoleScopes(presetsRoot, role)),
    };

    for (const name of args.cases) {
      out.case(name);
      await runCase(name, ctx, out);
    }

    out.finish();
    return out.exitCode();
  } catch (err: unknown) {
    const pe =
      err instanceof ProbeError
        ? err
        : new ProbeError(
            'PROBE_KNOWLEDGE_SCOPE_UNEXPECTED',
            'run',
            err instanceof Error ? err.message : String(err),
            true,
          );
    console.error(`[ERROR] ${pe.code}@${pe.phase} retryable=${String(pe.retryable)}: ${pe.message}`);
    out.error(`${pe.code}@${pe.phase}: ${pe.message}`);
    out.finish();
    return 2;
  }
}

// 仅在直接执行时跑 CLI（被 ladder import 时不产生副作用）
// `ProbeModule` 标注 = 编译期契约自检：签名漂移（KNOWN_CASES / main 形状）会当场 tsc 报错
if (process.argv[1] && /probe-knowledge-scope\.ts$/.test(process.argv[1])) {
  const self: ProbeModule = { KNOWN_CASES, main };
  self.main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
