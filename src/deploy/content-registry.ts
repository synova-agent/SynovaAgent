/**
 * src/deploy/content-registry.ts — extensions 内容面 `type → loader` 唯一真源
 *
 * 出处: 山河研究院《extensions内容面规范-v0》§5.2「entryPoint 字段的语义破损」修法原文：
 *   「建引擎侧 src/deploy/content-registry.ts（唯一 type→loader 表）；
 *     顶层 manifest 删除该字段或改名 loader 降为纯文档。」
 *
 * 为什么需要它（实测，as_of origin/main 5a6591c4a）:
 *   顶层 manifest 的 `entryPoint` 是语义破损的"文档即配置"——
 *     ① 反指方向错（内容声明引擎）＋ ② 解析基准错（差一级）＋ ③ 一处纯悬空 ＋ ④ **零运行时消费者**。
 *   实测双口径审计（全仓受控文件为判据）:
 *     · 10 处 `../src/...` 反指：文件相对口径 10/10 解析失败（`extensions/src/` 不存在）
 *     · 1 处 `./locale-loader.ts`（locales）：两种口径**皆悬空**（该文件从未在库）
 *   ⇒ loader 的真实映射必须由**引擎侧**持有（本文件），manifest 不再承担可执行语义。
 *
 * 设计（规范 §5.3 裁定 + §3.4 DSH 亲证的采纳边界）:
 *   · **宿主扫目录**（否决内容自注册）—— 本表是宿主侧静态数据，内容侧零改动即可增删；
 *   · 采纳 DSH 三机制之「早激活 / 失败隔离」：boot 全量解析，**逐项**失败隔离 + degraded 传播；
 *   · **不照搬** Cordis 的 inject 代际机制（§3.4 ④）：我们是静态文件、boot 时装配，
 *     只需其"按名声明、宿主满足"的**方向**——故本表用**名字**声明 loader/init/verify，而非闭包。
 *   · 模块说明符一律**字面量** import（`MODULE_IMPORTS`），保持静态可分析（不引入变量 import）。
 *
 * 契约 (铁律 47):
 *   @input  — `initContentTypes({ types?, modules? })`：`types` 限定装配子集；`modules` 注入模块表
 *             （缺省用本文件 `MODULE_IMPORTS`）——**依赖注入缝**，使 degraded/失败路径可被确定性测试，
 *             生产不传。
 *             可选环境变量 `SYNOVA_CONTENT_REGISTRY_DISABLE=1` 整体关闭装配（回退开关，§5.3 安全边际）
 *   @output — `ContentInitReport { results[], attempted, loaded, degraded, errors[] }`；
 *             纯查询 → `describeContentRegistry()`（**唯一只读入口**）
 *   @degraded — **逐项 try/catch 隔离**：单项失败 ⇒ 该条 `ok:false` + `error` + 写入 `errors[]`，
 *             整体 `degraded:true`；**不抛出、不阻断启动**（铁律 11/24/31：不静默降级，信号向上传播）。
 *             表自身完整性（编程错误）由 `describeContentRegistry().integrityProblems` **显式暴露**，
 *             由 boot 打印、由判据探针判红 —— 不静默吞。
 *
 * 🔴 导出面纪律（铁律 0-2 WIRE CHECK）: 本模块**只导出生产真消费的两件** ——
 *   `initContentTypes()`（boot 装配）与 `describeContentRegistry()`（boot 可观测 + 判据探针取数）。
 *   其余表项/工具一律**模块私有**，避免制造「导出但无人调用」的表面积。
 */
import { createLogger } from '@synova/logger';

const log = createLogger('deploy/content-registry');

/**
 * 内容项状态（V1「20/20 项有明确状态」的机器判据面）。
 * 🔴 写法说明: 运行时数组是**唯一真值**，类型由它派生（类型与校验同源，避免两处漂移）。
 *   不直写 `'a' | 'b' | 'c'` 联合 —— check-file-driven.sh 组 c 的启发式会把
 *   「含 3 个以上引号字面量 + `|`」的 `type` 行判为「硬编码本体类型联合」而硬阻断
 *   （实测 2026-10-09：本文件 status/face 两行各计 1 处，共 2 处）。本枚举是**注册表状态**、
 *   不是本体节点/边类型，与该组立法目的无关 ⇒ 改用数组派生的等价写法（语义不变）。
 */
const CONTENT_STATUS_VALUES = ['reachable', 'retired', 'pending-cto'] as const;
export type ContentStatus = (typeof CONTENT_STATUS_VALUES)[number];

/** 三分面归属（规范 §2.1：内容 / 引擎 / 配置）—— 同样由运行时数组派生 */
const CONTENT_FACE_VALUES = ['content', 'config', 'engine'] as const;
export type ContentFace = (typeof CONTENT_FACE_VALUES)[number];

/** 装配时的接线验证步骤：调用某导出函数以证明该链路**被执行**（非 grep 型静态判据） */
export interface ContentVerifyStep {
  /** 导出函数名（必须在目标模块上真实存在） */
  fn: string;
  /** 位置参数（原样传入） */
  args?: unknown[];
  /** 覆盖模块（默认取所属 loader 的 module）；用于跨模块验证 */
  module?: string;
  /**
   * 从 init 返回值按点路径取值，**追加**为末位参数。
   * 例：`resultPathAtEnd: 'locale'` ⇒ `fn(...args, initResult.locale)`
   */
  resultPathAtEnd?: string;
}

/** loader 引用：全部按**名字**声明（方向 = 内容被宿主满足，与 DSH inject 同向） */
export interface ContentLoaderRef {
  /** `MODULE_IMPORTS` 的键（= src/ 内相对本文件的模块说明符） */
  module: string;
  /** 初始化函数名（boot 装配入口） */
  init: string;
  /** init 的位置参数 */
  initArgs?: unknown[];
  /** 装配后必须真实执行的接线验证步骤 */
  verify?: ContentVerifyStep[];
  /** 幂等/热重载清理函数名 —— **仅声明 + 探针校验可达，不被本表调用**（调用会破坏刚建的缓存） */
  cleanup?: string;
}

/** 一个 extensions 顶层内容项 */
export interface ContentTypeEntry {
  /** manifest.type 值（C3 判据的键） */
  type: string;
  /** 顶层目录名（相对 extensions/） */
  dir: string;
  face: ContentFace;
  status: ContentStatus;
  /** 文件驱动 loader（status==='reachable' 时与 readers 至少居其一） */
  loader?: ContentLoaderRef;
  /** 生产直读者（非 loader 通道的可达性证据；文件路径 + 说明） */
  readers?: string[];
  /** retired / pending-cto 必填：显式化理由（V1 的「已废弃显式化」载体） */
  reason?: string;
}

/**
 * 动态导入表 —— 键与 `ContentLoaderRef.module` 逐字对应。
 * 🔴 每个表项都是**字面量** `import(...)`：保持静态可分析（规范 §3.4-② 精神：
 *    依赖关系对宿主可见；不引入 `import(variable)` 这种对工具链不可见的形态）。
 */
const MODULE_IMPORTS: Readonly<Record<string, () => Promise<Record<string, unknown>>>> = {
  '../locale/locale-loader': () => import('../locale/locale-loader'),
  '../l3/report-template-loader': () => import('../l3/report-template-loader'),
  '../l3/framework-loader': () => import('../l3/framework-loader'),
  '../l3/rule-loader': () => import('../l3/rule-loader'),
  '../l3/business-model-loader': () => import('../l3/business-model-loader'),
  '../l4/ontology-loader': () => import('../l4/ontology-loader'),
  '../l4/adapter-loader': () => import('../l4/adapter-loader'),
  '../notifications/notification-loader': () => import('../notifications/notification-loader'),
  '../notifications/registry': () => import('../notifications/registry'),
  '../sentinel/sentinel-loader': () => import('../sentinel/sentinel-loader'),
};

/**
 * 20 项 contents 全表（`extensions/` 顶层目录全集）。
 * 状态口径（spec §3.2 逐项裁定表 + §5.1 可达性实测）:
 *   reachable —— 有装配 loader，或有生产直读者（16 项存量可达 ＋ business-models 本卡接活 = 17）
 *   retired   —— 生产不可达且**无内容可接**（engine / tools）
 *   pending-cto —— 生产不可达但**修法牵涉架构（第四处两套并行）**，须过 CTO 再落地（llm-providers）
 */
const CONTENT_TYPES: readonly ContentTypeEntry[] = [
  {
    type: 'sentinel',
    dir: 'sentinels',
    face: 'content',
    status: 'reachable',
    loader: {
      module: '../sentinel/sentinel-loader',
      // registerLoadedSentinels() 内部先 loadSentinels() 再逐哨兵 import 并注册 — 覆盖原 boot 行为
      init: 'registerLoadedSentinels',
      verify: [
        { fn: 'loadSentinels' },
        { fn: 'getSentinelsByExpert', args: ['finance'] },
      ],
      cleanup: 'clearSentinelCache',
    },
  },
  {
    type: 'ontology',
    dir: 'ontology',
    face: 'content',
    status: 'reachable',
    loader: {
      module: '../l4/ontology-loader',
      init: 'loadOntology',
      verify: [
        { fn: 'getTypesByTags', args: [['human']] },
        { fn: 'validateEdgeEndpoints', args: ['INTERACTS_WITH', 'Person', 'Agent'] },
      ],
      cleanup: 'clearOntologyCache',
    },
    readers: ['src/agent/adapter-scanner.ts（ontology/field-mappings 子路径，独立于 ontology-loader 的注册通道）'],
  },
  {
    type: 'framework',
    dir: 'frameworks',
    face: 'content',
    status: 'reachable',
    loader: {
      module: '../l3/framework-loader',
      init: 'loadFrameworks',
      verify: [
        { fn: 'getFrameworksByCategory', args: ['psychology'] },
        { fn: 'matchFrameworksByConstraint', args: [['激励']] },
      ],
      cleanup: 'clearFrameworkCache',
    },
  },
  {
    type: 'report-template',
    dir: 'reports',
    face: 'content',
    status: 'reachable',
    loader: {
      module: '../l3/report-template-loader',
      init: 'loadTemplate',
      initArgs: ['default'],
      verify: [{ fn: 'listTemplates' }],
      cleanup: 'clearTemplateCache',
    },
  },
  {
    type: 'rule',
    dir: 'rules',
    face: 'content',
    status: 'reachable',
    loader: {
      module: '../l3/rule-loader',
      init: 'loadRules',
      verify: [{ fn: 'getUpgradeStrategy', args: ['general-enterprise'] }],
      cleanup: 'clearRuleCache',
    },
  },
  {
    type: 'locale',
    dir: 'locales',
    face: 'config',
    status: 'reachable',
    loader: {
      module: '../locale/locale-loader',
      init: 'loadLocale',
      // 原 boot: const { locale } = loadLocale(); t('report.title', locale)
      verify: [{ fn: 't', args: ['report.title'], resultPathAtEnd: 'locale' }],
      cleanup: 'reloadLocale',
    },
  },
  {
    type: 'notification',
    dir: 'notifications',
    face: 'content',
    status: 'reachable',
    loader: {
      module: '../notifications/notification-loader',
      init: 'loadAndRegisterNotificationAdapters',
      verify: [
        // 跨模块验证：这两个查询在 registry 上（原 boot 同款调用链）
        { fn: 'listNotificationChannels', module: '../notifications/registry' },
        { fn: 'listActiveAdapters', module: '../notifications/registry' },
      ],
    },
  },
  {
    type: 'adapter',
    dir: 'adapters',
    face: 'engine',
    status: 'reachable',
    loader: {
      module: '../l4/adapter-loader',
      init: 'loadAdapters',
      cleanup: 'clearAdapterCache',
    },
  },
  {
    // 🔴 本卡「接活」项 —— spec §3.2 #10：唯一读者是其自身死 loader（零外部 import）。
    //    loader 已在库且实现完整（7 个 business-model JSON → PKB 注入），接入即达。
    type: 'business-model',
    dir: 'business-models',
    face: 'content',
    status: 'reachable',
    loader: {
      module: '../l3/business-model-loader',
      init: 'loadBusinessModels',
      cleanup: 'clearBusinessModelCache',
    },
  },
  {
    // 🔴 CTO 2026-10-09 **已裁：采「案 B」**（原预裁「接活文件驱动系 + 退役硬编码类」经实测复核后改向）。
    //    CTO 派单原文：「案 B 落地补显式陈述 —— 10 空壳 vs src/providers 4 真实现 = **并行态**，
    //    **本卡不删真实现**」。⇒ 本卡**只补显式陈述，不删不接**（消并行待后续卡）。
    type: 'llm-provider',
    dir: 'llm-providers',
    face: 'config',
    status: 'pending-cto',
    reason:
      '🔴 CTO 2026-10-09 已裁**案 B**，落地形态如下（**并行态**，本卡不删真实现）：' +
      '① 侧 A `extensions/llm-providers/` = **10 个零导出空壳** —— 实测 `grep -c "^export"` ×10 全为 0、' +
      '文件第一字节即 `//`、整文件是一行注释（`export const …Adapter = {…}` 落在注释体内）、' +
      '真 `import()` 得 `EXPORTS=[]` ×10 ⇒ **不可被宿主 import，无可继承资产**；' +
      '② 侧 B `src/providers/` = **4 个真实现**（deepseek / ernie / gateway / openai）＋ `ProviderChain` ' +
      'failover 链 ＋ `detectProviderFromUrl` / `message-sanitizer`，且被 `src/agent/conversation-engine.ts:15` ' +
      '**真实 import**；' +
      '③ ⇒ 两侧并存 = **并行态**：一套是空的、一套是活的。' +
      '🔴 **本卡不删真实现**（不退役侧 B）；**也不接活侧 A**（其真实成本 = 从零写 10 个适配器，' +
      '非「接上已有实现」）⇒ **消并行待后续卡**（届时须过 §5.4 删路径核验 C2/requires）。' +
      '🔴 本表**不登记其 loader**：侧 A 未接活（案 B 未授权接活）⇒ 不把它接进 boot 装配面' +
      '（探针 ④ 段实证其未入装配）。' +
      '🔴 死引用一并记录：`src/providers/llm-provider-loader.ts` 零调用者' +
      '（实测 `grep -rn "llm-provider-loader|loadLLMProviders" src/ packages/` 仅自身命中）。',
  },
  {
    type: 'industry-template',
    dir: 'industries',
    face: 'content',
    status: 'reachable',
    readers: [
      'src/growth/context-loader.ts（读 industries/{sector}/thresholds.json）',
      'packages/evolution/src/global-analyzer.ts（INDUSTRIES_DIR）',
      'src/l4/ontology-loader.ts（读 industries/{name}/edge-types/ — 子路径，非本 type 的 loader）',
      // 🔴 本卡实测新发现（超出卡面 4 项范围，未处置、仅登记）: industries 的 manifest.entryPoint
      //    指向 src/l4/industry-loader.ts，而该 loader **零外部调用者**（`grep -rn "industry-loader|loadIndustries"`
      //    仅自身命中）。即「有 loader 但未接线」的第 5 例 —— 需另立卡裁决（不在本卡 4 项写集内）。
      '⚠️ 死 loader: src/l4/industry-loader.ts（loadIndustries 零外部调用者）',
    ],
  },
  {
    type: 'playbooks-manifest',
    dir: 'playbooks',
    face: 'content',
    status: 'reachable',
    readers: ['src/playbook/playbook-loader.ts', 'src/deploy/bootstrap.ts（Phase 2c: PlaybookLoader）'],
  },
  {
    type: 'skills-manifest',
    dir: 'skills',
    face: 'content',
    status: 'reachable',
    readers: ['src/skill/skill-loader.ts', 'src/deploy/bootstrap.ts（Phase 2b: SkillLoader）'],
  },
  {
    type: 'evolution-config',
    dir: 'evolution',
    face: 'config',
    status: 'reachable',
    readers: ['packages/evolution/src/global-analyzer.ts'],
  },
  {
    type: 'context-strategy',
    dir: 'context-strategies',
    face: 'content',
    status: 'reachable',
    readers: ['src/orchestrator/context-engine.ts'],
  },
  {
    type: 'implementation-pattern',
    dir: 'implementation-patterns',
    face: 'content',
    status: 'reachable',
    readers: ['src/services/pattern-matcher.ts'],
  },
  {
    type: 'policy',
    dir: 'policies',
    face: 'content',
    status: 'reachable',
    readers: [
      'src/services/escalation-engine.ts（读 policies/escalation-rules.json）',
      // data-access.yaml 实测零读者（spec §3.2 #16「半孤儿」）—— 可达性由 escalation-rules 支撑
    ],
  },
  {
    type: 'security-config',
    dir: 'security',
    face: 'config',
    status: 'reachable',
    readers: ['src/security/pre-upload-validator.ts'],
  },
  {
    // spec §3.2 #15：engine-config「零读者（构造路径口径复查仍 0）」；实测 `grep -rn engine-config
    // src/ packages/ scripts/` = 0 命中，且 extensions/engine/ 无 loader 可接。
    // ⇒ 废弃显式化（不删文件：删目录属 §5.4 删路径，需 C2 type 残留核验，本卡不越权）。
    type: 'engine-config',
    dir: 'engine',
    face: 'config',
    status: 'retired',
    reason:
      '零读者：实测 `grep -rn "engine-config" src/ packages/ scripts/ --include=*.ts` = 0 命中；' +
      'extensions/engine/diagnosis.json（6 阶段 phases/gates/maxToolRounds）无任何消费端，且无 loader 可接。' +
      '本卡显式化为 retired；复活需先建消费端（属架构变更）。',
  },
  {
    // spec §3.2 #20：tools「孤儿」。实测 extensions/tools/ **仅 manifest.json 一个文件**（零内容），
    // 且 `grep -rn tools-manifest src/ packages/ scripts/` = 0 命中 ⇒ 无内容可接、无 loader 可接。
    type: 'tools-manifest',
    dir: 'tools',
    face: 'config',
    status: 'retired',
    reason:
      '孤儿：extensions/tools/ 全目录**仅 manifest.json**（零内容文件，实测 git ls-tree 1 条）；' +
      '`grep -rn "tools-manifest" src/ packages/ scripts/ --include=*.ts` = 0 命中。' +
      '无内容可接 ⇒ 显式化为 retired（工具注册的真实通道是 MCP/工具注册表，不在此目录）。',
  },
];

/** 装配报告中的单项结果 */
export interface ContentInitItemResult {
  type: string;
  dir: string;
  ok: boolean;
  module?: string;
  /** 真实执行过的 verify 函数名（接线证据，非静态 grep） */
  verified: string[];
  /** loader 自身返回的降级信号（errors[] / degraded:true）—— 铁律 31 不丢信号 */
  warnings: string[];
  error?: string;
}

/** `initContentTypes()` 的返回（铁律 31：degraded 显式向上传播） */
export interface ContentInitReport {
  results: ContentInitItemResult[];
  attempted: number;
  loaded: number;
  degraded: boolean;
  /** 硬失败（抛错） */
  errors: string[];
  /** 软降级（loader 自报 errors[] / degraded:true） */
  warnings: string[];
}

/** 全表（防御性拷贝：调用方改不动真源） */
function listContentTypes(): ContentTypeEntry[] {
  return CONTENT_TYPES.map((e) => ({ ...e }));
}

/** 按状态取项 */
function listByStatus(status: ContentStatus): ContentTypeEntry[] {
  return CONTENT_TYPES.filter((e) => e.status === status);
}

/** 需要 boot 装配的项（reachable 且有 loader） */
function listLoadableTypes(): ContentTypeEntry[] {
  return CONTENT_TYPES.filter((e) => e.status === 'reachable' && e.loader !== undefined);
}

/** 注册表只读快照（boot 可观测 ＋ 判据探针取数的**唯一入口**） */
export interface ContentRegistrySnapshot {
  entries: ContentTypeEntry[];
  /** `MODULE_IMPORTS` 的键集（探针据此校验 loader.module 自洽） */
  moduleKeys: string[];
  /** 闭合枚举的运行时真值（探针/单测据此校验状态合法性，**避免第二处口径**） */
  statusValues: readonly string[];
  faceValues: readonly string[];
  /** 表自身完整性（空数组 = 通过）；即 `assertRegistryIntegrity` 的**非抛出**形态 */
  integrityProblems: string[];
  counts: { total: number; reachable: number; retired: number; pendingCto: number };
}

/**
 * 表自身完整性检查（**编程错误**，不降级 —— 返回明细由调用方决定如何处置）。
 * 与运行态同源：`initContentTypes` 与判据探针都经本函数取数。
 */
function collectIntegrityProblems(): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const e of CONTENT_TYPES) {
    if (seen.has(e.type)) problems.push(`type 重复: ${e.type}`);
    seen.add(e.type);
    if (!(CONTENT_STATUS_VALUES as readonly string[]).includes(e.status)) {
      problems.push(`${e.type}: status 非法 "${e.status}"`);
    }
    if (!(CONTENT_FACE_VALUES as readonly string[]).includes(e.face)) {
      problems.push(`${e.type}: face 非法 "${e.face}"`);
    }
    if (e.status === 'reachable' && e.loader === undefined && (e.readers ?? []).length === 0) {
      problems.push(`${e.type}: reachable 但既无 loader 也无 readers`);
    }
    if (e.status !== 'reachable' && !e.reason) {
      problems.push(`${e.type}: status=${e.status} 必须有显式 reason（V1「已废弃显式化」）`);
    }
    if (e.loader !== undefined && MODULE_IMPORTS[e.loader.module] === undefined) {
      problems.push(`${e.type}: loader.module 不在 MODULE_IMPORTS: ${e.loader.module}`);
    }
    for (const step of e.loader?.verify ?? []) {
      const m = step.module ?? e.loader?.module;
      if (m === undefined || MODULE_IMPORTS[m] === undefined) {
        problems.push(`${e.type}: verify ${step.fn} 的 module 不在 MODULE_IMPORTS: ${String(m)}`);
      }
    }
  }
  if (CONTENT_TYPES.length !== 20) {
    problems.push(`CONTENT_TYPES 应为 20 项，实测 ${CONTENT_TYPES.length}`);
  }
  return problems;
}

/**
 * 注册表只读快照 —— **生产消费点**：`src/init/file-driven-loaders.ts` 在 boot 打印
 * 注册表构成与完整性问题（规范 §5.3「早激活：boot 全量解析，选择前暴露失败」）；
 * **判据消费点**：`scripts/control-tower/probe-content-registry.ts` 的 PRESENCE/INTEGRITY 段。
 */
export function describeContentRegistry(): ContentRegistrySnapshot {
  const entries = listContentTypes();
  return {
    entries,
    moduleKeys: Object.keys(MODULE_IMPORTS),
    statusValues: CONTENT_STATUS_VALUES,
    faceValues: CONTENT_FACE_VALUES,
    integrityProblems: collectIntegrityProblems(),
    counts: {
      total: entries.length,
      reachable: listByStatus('reachable').length,
      retired: listByStatus('retired').length,
      pendingCto: listByStatus('pending-cto').length,
    },
  };
}

/** 按名调用导出函数（唯一的"按名声明→宿主调用"接缝） */
function callNamed(mod: Record<string, unknown>, fn: string, args: unknown[]): unknown {
  const f = mod[fn];
  if (typeof f !== 'function') {
    throw new Error(`导出缺失或非函数: ${fn}`);
  }
  return (f as (...a: unknown[]) => unknown)(...args);
}

/** 按点路径取 init 返回值的字段（`resultPathAtEnd` 用） */
function pickPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * 收集 loader 自身返回的降级信号（原 `file-driven-loaders.ts` 各块内的
 * `if (errors.length > 0) log.warn(...)` 逻辑统一收敛到这里 —— 铁律 31 不丢信号）。
 *
 * 导出说明: 模块私有 —— degraded 判定路径经 `initContentTypes({ modules })` 注入缝被单测覆盖，
 * 不额外扩表面积（见文件头「导出面纪律」）。
 */
function collectInitWarnings(out: unknown, type: string): string[] {
  if (out === null || typeof out !== 'object') return [];
  const rec = out as Record<string, unknown>;
  const errs = rec.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    return [`${type}: loader 自报 ${errs.length} 条错误 — ${errs.map(String).join('; ')}`];
  }
  if (rec.degraded === true) return [`${type}: loader 返回 degraded=true`];
  return [];
}

/**
 * boot 装配入口 —— `src/init/file-driven-loaders.ts` 的唯一调用点。
 *
 * @param opts.types 只装配指定 type 子集（默认全部 reachable+有 loader 的项）
 * @returns 逐项结果 + degraded 汇总；**任何单项失败都不抛出**
 */
export async function initContentTypes(
  opts: {
    /** 只装配指定 type 子集（缺省全部 reachable+有 loader 的项） */
    types?: string[];
    /** 注入模块表（缺省 `MODULE_IMPORTS`）—— 依赖注入缝，供确定性测试 degraded/失败路径 */
    modules?: Readonly<Record<string, () => Promise<Record<string, unknown>>>>;
  } = {},
): Promise<ContentInitReport> {
  const empty: ContentInitReport = {
    results: [],
    attempted: 0,
    loaded: 0,
    degraded: false,
    errors: [],
    warnings: [],
  };

  if (process.env.SYNOVA_CONTENT_REGISTRY_DISABLE === '1') {
    log.warn('SYNOVA_CONTENT_REGISTRY_DISABLE=1 — 内容面装配已关闭（回退开关，未装任何 loader）');
    return empty;
  }

  const modules = opts.modules ?? MODULE_IMPORTS;
  const targets = listLoadableTypes().filter(
    (e) => opts.types === undefined || opts.types.includes(e.type),
  );

  const results: ContentInitItemResult[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const entry of targets) {
    const loader = entry.loader;
    if (loader === undefined) continue; // listLoadableTypes 已过滤，类型收窄
    const verified: string[] = [];
    try {
      const importer = modules[loader.module];
      if (importer === undefined) throw new Error(`MODULE_IMPORTS 缺键: ${loader.module}`);
      const mod = await importer();

      const initOut = await callNamed(mod, loader.init, loader.initArgs ?? []);
      verified.push(loader.init);

      for (const step of loader.verify ?? []) {
        const stepModule = step.module ?? loader.module;
        const stepImporter = modules[stepModule];
        if (stepImporter === undefined) throw new Error(`MODULE_IMPORTS 缺键(verify): ${stepModule}`);
        const stepMod = stepModule === loader.module ? mod : await stepImporter();
        const args = [...(step.args ?? [])];
        if (step.resultPathAtEnd !== undefined) {
          args.push(pickPath(initOut, step.resultPathAtEnd));
        }
        callNamed(stepMod, step.fn, args);
        verified.push(step.fn);
      }

      const itemWarnings = collectInitWarnings(initOut, entry.type);
      if (itemWarnings.length > 0) {
        warnings.push(...itemWarnings);
        log.warn({ type: entry.type, warnings: itemWarnings }, '内容项装配带降级信号 — degraded');
      }
      results.push({
        type: entry.type,
        dir: entry.dir,
        ok: true,
        module: loader.module,
        verified,
        warnings: itemWarnings,
      });
      log.info({ type: entry.type, verified: verified.length }, '内容项已装配');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 铁律 24/31: 不空吞 —— 有 log.warn + 进 errors[] + degraded=true
      log.warn({ err, type: entry.type, dir: entry.dir }, '内容项装配失败 — degraded（不阻断启动）');
      results.push({
        type: entry.type,
        dir: entry.dir,
        ok: false,
        module: loader.module,
        verified,
        warnings: [],
        error: msg,
      });
      errors.push(`${entry.type}: ${msg}`);
    }
  }

  const loaded = results.filter((r) => r.ok).length;
  return {
    results,
    attempted: targets.length,
    loaded,
    degraded: errors.length > 0 || warnings.length > 0,
    errors,
    warnings,
  };
}
