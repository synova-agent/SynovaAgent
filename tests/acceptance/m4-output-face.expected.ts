/**
 * tests/acceptance/m4-output-face.expected.ts — M4 出口面验收的**唯一期望源**（#1053 / T5 / 台账 #1051）
 *
 * 设计哲学：一个分离 ＋ 两条承诺 —— 把「被测系统应当长什么样」从「怎么验」里彻底分出去：
 *   承诺 ① **单一真源**（Q-10）：验收件不写字面量断言值，所有期望经 EXP_* 引用；期望漂移只能靠改本文件发生（可 diff、可 review）。
 *   承诺 ② **零环境耦合**：纯数据 ＋ 纯函数 —— 零 import、零 I/O、零网络、零时钟、零随机；同一份本文件在 CI 与本机
 *            给出逐字相同的期望（时刻由验收件用 tests/acceptance/support/clock.ts 的 nowMs() 计算，本文件只给**偏移量**）。
 *
 * 契约（铁律 47）:
 *   @input    无 —— 模块级常量与纯函数；不读环境变量、不读文件、不取系统时间
 *   @output   见下方分组注释：EXP_* 常量（端点/口径/testid/服务端回归/装配/一页纸/禁渲模式/降级码）
 *             ＋ shouldLoadTrends() 纯函数（「是否发起趋势请求」的唯一判定口径）
 *   @exit     不适用 —— 无脚本入口；本文件的语法/类型错误由 vitest 转译期与 tsc 暴露
 *   @degraded 不适用 —— 模块自身无失败路径（纯字面量求值不会失败）；shouldLoadTrends 对非法入参
 *             按 JSDoc 语义返回 false 而非抛错（理由见该函数注释：调用点是渲染期守卫，抛错会炸整棵树）
 *   @authority 只被本批验收件 tests/acceptance/mvp1-m4-output-face.test.ts 引用（tests 内唯一消费者，
 *             pre-commit 组 4 接线审计按此判）；**产品代码（src/**、electron-renderer/**）一律不得 import 本文件**
 *             —— 期望不得反向流入实现，否则「期望」会被实现同化（假绿的结构性来源）
 *   @not-here 不放被测逻辑（不实现取数/渲染/装配）；不做快照基线（理由见已知限制）；不定义服务端契约
 *             —— 契约真源在 src/routes/sentinel.ts，本文件只是它的**期望镜像**
 *
 * 已知限制（DSH 代码标准 C）:
 *   · 本文件**只放期望值，不放被测逻辑**。`shouldLoadTrends` 是**期望口径的参照实现**：
 *     生产真落点归 **T2/T4**（Container 早退守卫 ＋ RightPanel 的 `activeOrgId !== null` 门控 —— 已在库的生产事实）；
 *     **纯函数化**（lib/measurement-trends.ts 导出 `shouldLoadTrends` 供 Container 引用）仍 **deferred**（需 L1
 *     批准扩写集）。因此本函数**不得**被描述成「已抽成生产纯函数」；
 *     生产行为的证据在验收件 `A8-b`（Container 源码断言），不在本文件。
 *   · 不采用**整树快照**（snapshot）：快照随无关 DOM 波动整体变红，且「变红」不指向具体判据，
 *     失败点不可读；本批用**结构化子串 ＋ 计数 ＋ 源码字面量**断言。（详细理由归 T6 的
 *     `electron-renderer/AGENTS.md`，本批不写 AGENTS.md。）
 *   · 本文件的期望值是**契约镜像**，不自动跟随实现漂移 —— 这正是设计意图（实现改了期望没改 ⇒ 必红）；
 *     但反向成立：若服务端契约经批准变更，须同批改本文件，否则本文件变成过期镜像（人工守）。
 *   · `EXP_` 前缀是约定而非机器约束：新增导出若无此前缀，由验收件/复核人工把关。
 */

// ═══ ① 端点与口径 ═══

/** 趋势端点（相对 API 源；服务端 `view=trends` 分支 —— src/routes/sentinel.ts:156） */
export const EXP_TRENDS_PATH = '/api/sentinel/metrics/readings?view=trends';

/** 展示层口径版本（= electron-renderer/src/lib/measurement-trends.ts 的 TREND_SEMANTICS_VERSION） */
export const EXP_SEMANTICS_VERSION = 'cost0-v1';

/** 区块标题字面量（组件渲染为 `📈 测量值＋趋势`，此处取可断言的最短子串） */
export const EXP_SECTION_TITLE = '测量值＋趋势';

// ═══ ② 稳定选择器（data-testid，共 8 个）═══

export const EXP_TESTID = {
  section: 'measurement-trend-section',
  item: 'measurement-trend-item',
  empty: 'measurement-trend-empty',
  degraded: 'measurement-trend-degraded',
  loading: 'measurement-trend-loading',
  limitations: 'measurement-trend-limitations',
  selectOrg: 'measurement-trend-select-org',
  onePager: 'measurement-to-onepager',
} as const;

// ═══ ③ 服务端回归（A6/A7/A1/A2/A3 ＋ T8 追加 A4 空表／A5 三观测）═══

/** 两个企业作用域（服务端 orgId 契约：最短 2 字符，故不能用单字符） */
export const EXP_ORG = { AA: 'org-aa', BB: 'org-bb' } as const;

/** 聚合查询的 entityId（writer 缺省 '*'；summarizeMetricTrends 按 metric×entity 分组） */
export const EXP_ENTITY_ID = '*';

export const EXP_CODE_INVALID_ORG_ID = 'INVALID_ORG_ID';
export const EXP_CODE_INVALID_DAYS = 'INVALID_DAYS';

/** A7 单条：query 形态 ＋ 服务端 `received` 原样回显的期望值 */
export interface ExpInvalidOrgIdCase {
  label: string;
  /** 直接拼到 `?` 之后的原始查询串（禁再次编码 —— 形态本身就是被测面） */
  query: string;
  /** 服务端 `received: req.query.orgId` 的 JSON 化期望（数组/对象也算非法 ⇒ 原样回显） */
  received: string | string[] | Record<string, string>;
}

/**
 * A7 orgId 非法四形态（express 4 query parser=extended/qs 实测形态，2026-10-20 本机实测）:
 *   `?orgId=bad+id%21` ⇒ `'bad id!'` ｜ `?orgId=A` ⇒ `'A'` ｜ `?orgId=a&orgId=b` ⇒ `['a','b']` ｜ `?orgId[a]=b` ⇒ `{a:'b'}`
 */
export const EXP_ORG_INVALID: readonly ExpInvalidOrgIdCase[] = [
  { label: '含空格与感叹号', query: 'orgId=bad+id%21', received: 'bad id!' },
  { label: '单字符（契约最短 2 字符）', query: 'orgId=A', received: 'A' },
  { label: '重复参数（数组）', query: `orgId=${EXP_ORG.AA}&orgId=${EXP_ORG.BB}`, received: [EXP_ORG.AA, EXP_ORG.BB] },
  { label: 'qs 对象', query: 'orgId%5Ba%5D=b', received: { a: 'b' } },
];

/** A3 days 越界/非整数五格（服务端须 400 INVALID_DAYS，不 clamp、不折 7） */
export const EXP_DAYS_INVALID: readonly string[] = ['0', '-5', 'abc', '1e9', '3651'];

/** A3 上界**含等号**：3650 ⇒ 200（边界与越界必须分开验） */
export const EXP_DAYS_BOUNDARY_VALID = '3650';

/** A2 窗口收窄到 1 天 */
export const EXP_DAYS_ONE = '1';

/** A1 服务端缺省窗口（天） */
export const EXP_DAYS_DEFAULT = 7;

/** 种子指标 id（临时库每次新建 ⇒ 静态 id 即可；禁含 'SENTINEL-' 前缀，缺省口径排除轮次级） */
export const EXP_METRIC = {
  UP: 'M4-REV-1053-UP',
  DOWN: 'M4-CASH-1053-DOWN',
  OLD: 'M4-OLD-1053-OUT-OF-WINDOW',
} as const;

/**
 * 种子时刻偏移（相对 nowMs()，毫秒）——单位化后由验收件转 SQLite `datetime('now')` 同构串。
 * 窗口语义（buildWhere: `observed_at >= datetime('now','-<days> days')`）：
 *   PREV=2 天前 ／ LATEST=1 分钟前 ⇒ 同时落入 7 天与 1 天窗口；OLD=8 天前 ⇒ 只落在 7 天**之外**。
 */
export const EXP_SEED_WINDOW = {
  PREV_MS_AGO: 2 * 24 * 60 * 60 * 1000,
  LATEST_MS_AGO: 60 * 1000,
  OLD_MS_AGO: 8 * 24 * 60 * 60 * 1000,
} as const;

/**
 * 两 org 种子期望值（手算，**不从被测函数反推**）:
 *   UP  : (125 − 100) / |100| = +0.25 ／ count 2 ／ unit 'ratio'
 *   DOWN: (60  − 80)  / |80|  = −0.25 ／ count 2 ／ unit 'months'
 *   OLD : 单条 42（仅用于「缺省窗口排除」断言，不参与变化率）
 */
export const EXP_SEED = {
  UP: { PREV_VALUE: 100, LATEST_VALUE: 125, CHANGE_RATIO: 0.25, COUNT: 2, UNIT: 'ratio' },
  DOWN: { PREV_VALUE: 80, LATEST_VALUE: 60, CHANGE_RATIO: -0.25, COUNT: 2, UNIT: 'months' },
  OLD: { VALUE: 42, COUNT: 1, UNIT: 'ratio' },
} as const;

/** 单观测条目的 count（days=1 收窄后只剩最新一条；也是 A9 单观测夹具的 count） */
export const EXP_SINGLE_OBSERVATION_COUNT = 1;

/** 趋势方向（deriveTrendDirection 的四值域；A9 用 UNKNOWN，A6 用 UP/DOWN） */
export const EXP_TREND = { UP: 'up', DOWN: 'down', FLAT: 'flat', UNKNOWN: 'unknown' } as const;

// ── T8 追加夹具（A4 空表 ／ A5 三观测）：**只用新 org**，不动上面两 org 的种子（否则 A1/A2/A6 会漂）──

/**
 * A4 夹具（规格 §7.2 `A4/[R3-table]`：空表 ⇒ `ok:true,count:0,summary:[]` 且 UI 空态、**不降级**）:
 *   · `org-cc`：三指标各 1 行、全部 **8 天前**（缺省 7 天窗口之外）⇒ 缺省窗口 **count=0**；
 *     放宽到 days 上界后 **count=3** —— 证明「0」是**窗口裁剪**，不是数据缺失（与 A1 的对照手法同源）。
 *   · `org-ff`：**从未种过**（任何窗口都 0 组）—— 与上一例互为对照（无数据 vs 窗口外）。
 *   · 服务端 200 原文只有 `ok/count/summary`（**ok:true 分支不带 degraded 字段**）；
 *     `degraded:false` 是 loader `normalizeView` 归一出来的结论，二者不得混为一谈。
 */
export const EXP_A4 = {
  ORG_OUT_OF_WINDOW: 'org-cc',
  ORG_NEVER_SEEDED: 'org-ff',
  /** 窗口外三指标（每指标恰 1 行；id 不含 SENTINEL- 前缀 ⇒ 不被「排除轮次级」口径滤掉） */
  OUT_OF_WINDOW_METRICS: ['M4-A4-1053-CC-ALPHA', 'M4-A4-1053-CC-BETA', 'M4-A4-1053-CC-GAMMA'],
  OUT_OF_WINDOW_VALUE: 42,
  OUT_OF_WINDOW_UNIT: 'ratio',
  /** 缺省 7 天窗口内的组数（窗口外 ⇒ 0 组） */
  DEFAULT_WINDOW_GROUP_COUNT: 0,
  /** 放宽到 days 上界后的组数（数据确实在库里 ⇒ 3 组） */
  WIDE_WINDOW_GROUP_COUNT: 3,
} as const;

/**
 * A4-c 空态**禁渲**的「编造数值」形态（`0` ＋ 单位）—— 空态一条都不许出现。
 * 理由：空表不是「所有指标取值为 0」；把缺席画成 0 就是编造（铁律 11「不假装」）。
 */
export const EXP_EMPTY_FORBIDDEN_VALUES: readonly string[] = [
  `0 ${EXP_SEED.UP.UNIT}`,
  `0 ${EXP_SEED.DOWN.UNIT}`,
];

/** A5 三观测夹具的单指标期望（值**手算**，不从被测函数反推） */
export interface ExpThreeObsMetric {
  metricId: string;
  unit: 'ratio' | 'months';
  /** 三条观测值，按时间**从旧到新**（[0]=最旧 3 天前 ／ [1]=次新 2 天前 ／ [2]=最新 1 天前） */
  series: readonly number[];
  latestValue: number;
  /** 次新（不是最旧） */
  previousValue: number;
  changeRatio: number | null;
  /** deriveTrendDirection 的期望（手写语义，不由被测函数反推） */
  direction: 'up' | 'down' | 'flat' | 'unknown';
}

export interface ExpThreeObsFixture {
  ORG_THREE_OBS: string;
  ORG_PREV_ZERO: string;
  /** 每指标观测条数（= 服务端每行 count） */
  COUNT_PER_METRIC: number;
  /** summary 组数 = 3 指标 × 单 entity('*') */
  SUMMARY_GROUP_COUNT: number;
  /** previous=0 那支 org 的 summary 组数 */
  ZERO_CASE_SUMMARY_GROUP_COUNT: number;
  METRICS: readonly ExpThreeObsMetric[];
  ZERO_CASE: ExpThreeObsMetric & { COUNT: number };
}

/**
 * A5 夹具（规格 §7.2：`3 观测 ⇒ count=3、previous=次新；previous=0 ⇒ changeRatio=null`）:
 *   · `org-dd`：**3 个指标 × 每个 3 条观测**（3/2/1 天前，全在缺省 7 天窗口内）⇒ summary 3 组、每组 count=3;
 *       A: [100, 80, 120] ⇒ latest 120 ／ previous 80 ／ (120−80)/|80| = **+0.5**（up）
 *       B: [ 10, 20,   5] ⇒ latest   5 ／ previous 20 ／ (5−20)/|20|   = **−0.75**（down）
 *       C: [  4,  3,   3] ⇒ latest   3 ／ previous  3 ／ (3−3)/|3|    = **0**（flat 边界）
 *   · `org-gg`：`previous=0` 一例 —— [7, 0, 50] ⇒ latest 50 ／ **previousValue=0** ／ **changeRatio=null**
 *     （源码依据 `src/sentinel/metric-readings-reader.ts:148-151`：`previous.value !== 0 ? … : null`）
 *     ⇒ 展示层必须写「未知」而**不是**「持平」：0 是真实读数，不是"不可算"的替身。
 */
export const EXP_A5: ExpThreeObsFixture = {
  ORG_THREE_OBS: 'org-dd',
  ORG_PREV_ZERO: 'org-gg',
  COUNT_PER_METRIC: 3,
  SUMMARY_GROUP_COUNT: 3,
  ZERO_CASE_SUMMARY_GROUP_COUNT: 1,
  METRICS: [
    { metricId: 'M4-A5-1053-THREE-OBS-A', unit: 'ratio', series: [100, 80, 120], latestValue: 120, previousValue: 80, changeRatio: 0.5, direction: 'up' },
    { metricId: 'M4-A5-1053-THREE-OBS-B', unit: 'months', series: [10, 20, 5], latestValue: 5, previousValue: 20, changeRatio: -0.75, direction: 'down' },
    { metricId: 'M4-A5-1053-THREE-OBS-C', unit: 'ratio', series: [4, 3, 3], latestValue: 3, previousValue: 3, changeRatio: 0, direction: 'flat' },
  ],
  ZERO_CASE: {
    metricId: 'M4-A5-1053-PREV-ZERO',
    unit: 'ratio',
    series: [7, 0, 50],
    latestValue: 50,
    previousValue: 0,
    changeRatio: null,
    direction: 'unknown', // previous=0 ⇒ 不可算 ⇒ 未知（**不是** flat；A5-b 断言）
    COUNT: 3,
  },
};

/**
 * A4/A5 的时刻偏移（相对 `nowMs()`，毫秒）——**既有 `EXP_SEED_WINDOW` 不动**，新夹具用新键（夹具隔离）。
 */
export const EXP_EXTRA_SEED_WINDOW = {
  /** A4：缺省 7 天窗口之外（8 天前） */
  OUT_OF_WINDOW_MS_AGO: 8 * 24 * 60 * 60 * 1000,
  /** A5：三条观测 = 3 天前（最旧）／2 天前（次新）／1 天前（最新），全在 7 天窗口内 */
  THREE_OBS_MS_AGO: [3 * 24 * 60 * 60 * 1000, 2 * 24 * 60 * 60 * 1000, 1 * 24 * 60 * 60 * 1000],
} as const;

// ═══ ④ A8 零请求：纯函数 ＋ 装配源码字面量 ═══

/**
 * 「是否发起趋势请求」的**唯一判定口径**（A8）：
 *   null / undefined / '' ⇒ false（未选客户 ⇒ 零请求，不拿聚合数冒充客户数）
 *   非空字符串          ⇒ true
 *
 * 为什么非法入参返回 false 而不抛错：本函数模拟的是**渲染期守卫**，调用点在 useEffect 体内、
 * 整棵组件树的渲染路径上 —— 抛错会炸掉面板（白屏），而「未选客户」是合法业务态而非异常。
 * 故按契约返回 false，把「非法/缺席」统一收敛为「不请求」这一个安全动作（fail-safe，非 fail-open：
 * 它不会放行任何请求）。
 *
 * 🔴 落点现状（**不得写成「已抽成生产纯函数」**）：本函数是**期望口径的参照实现**；
 *    生产真落点归 **T2/T4**（容器早退守卫 ＋ RightPanel 门控 = 已在库的生产事实）；
 *    **纯函数化**（lib 导出 `shouldLoadTrends` 供容器引用）仍 **deferred**，需 L1 批准扩写集。
 *    生产行为的证据 = 验收件 `A8-b` 对 MeasurementTrendContainer.tsx 的源码断言。
 */
export function shouldLoadTrends(orgId: string | null | undefined): boolean {
  return typeof orgId === 'string' && orgId !== '';
}

// ═══ ⑤ A13 装配（RightPanel）源码字面量 ═══

/**
 * 装配期望 —— 全部以「可 grep 的源码字面量」形态给出（**不做位置式 index 期望**：
 * 位置断言会被无关行漂移误伤，且「变红」不指向判据）。
 */
export const EXP_WIRING = {
  /** 挂载标签：`(src.match(/<MeasurementTrendContainer/g) ?? []).length` 须等于 count */
  containerTag: '<MeasurementTrendContainer',
  count: 1,
  /** 门控字面量（未选客户 ⇒ 不挂载 ⇒ 零请求） */
  gate: 'activeOrgId !== null',
  /** 一页纸回调：仅 ws_ga 传入（其余视图 undefined ⇒ 无死按钮）；须恰出现 1 次 */
  onePagerCallback: "view === 'ws_ga' ? () => setTab('report') : undefined",
  /** tab 状态上提（原在 GAWorkspaceTabs 内）——须在任何早退之前 */
  tabStateLifted: "useState<'action' | 'sentinel' | 'pattern' | 'report'>('report')",
  /** tab 早退（hooks 规则要求 state 在其之前） */
  earlyReturn: 'if (!open) return null;',
  /** tab 经 props 下传（GAWorkspaceTabs 自身不再持有 tab state） */
  tabPassDown: '<GAWorkspaceTabs tab={tab} />',
  /** GAWorkspaceTabs 签名参数（tab 由右面板注入） */
  gaTabsParams: '{ tab: GAWorkspaceTab }',
  /** 源码文件（写集内只读；路径即断言对象） */
  rightPanelPath: 'electron-renderer/src/components/RightPanel.tsx',
  containerPath: 'electron-renderer/src/components/MeasurementTrendContainer.tsx',
  sectionPath: 'electron-renderer/src/components/MeasurementTrendSection.tsx',
  loaderPath: 'electron-renderer/src/lib/measurement-trends.ts',
  /** 容器调 loader（A8-b：守卫须在此调用之前；全文件恰 1 次） */
  loaderCall: 'loadMeasurementTrends(',
  /** 容器零请求守卫（useEffect 体内、loader 调用之前） */
  emptyOrgGuard: "if (orgId === null || orgId === '')",
  /** 容器的网络原语名（请求只经 loader ⇒ 全文件不得出现该原语的调用形态） */
  fetchName: 'fetch',
} as const;

// ═══ ⑥ A9 M3 四真值（经 Section 渲染）═══

/** 单条 M3 真值：metricId ＋ 数值 ＋ 单位 ＋ 期望渲染文本（`<值> <单位>`，见 Section 的 value span） */
export interface ExpMetricTruth {
  metricId: string;
  value: number;
  unit: 'ratio' | 'months';
  /** 渲染期 value span 的期望文本（值为单观测 ⇒ data-trend 必为 unknown） */
  rendered: string;
}

/**
 * A9 四真值 —— 手算自 M3 夹具（revenue=300 ／ cost=0 ／ opex=30 ／ cash=180）:
 *   grossMargin = (300 − 0)      / 300 = 1
 *   netMargin   = (300 − 0 − 30) / 300 = 0.9
 *   revenueYoY  = (200 − 100)    / 100 = 1
 *   runway      = 180 / (30 / 2)       = 12（months）
 *
 * 与 `tests/acceptance/mvp1-m3-domain-chain.test.ts:101-113` 的 EXP_* **同口径**（同值同单位）；
 * 两处各自独立手算、互不反推 —— 双源一致才算真值，任一处漂移即红。
 * 本批只验「这四个真值经 Section 渲染不丢真」；M3 链路的产出正确性由 m3 那支验收件负责。
 */
export const EXP_M3_TRUTHS: readonly ExpMetricTruth[] = [
  { metricId: 'CASH-FLOW-GROSS-MARGIN', value: 1, unit: 'ratio', rendered: '1 ratio' },
  { metricId: 'CASH-FLOW-NET-MARGIN', value: 0.9, unit: 'ratio', rendered: '0.9 ratio' },
  { metricId: 'CASH-FLOW-REVENUE-YOY-GROWTH', value: 1, unit: 'ratio', rendered: '1 ratio' },
  { metricId: 'CASH-FLOW-RUNWAY-MONTHS', value: 12, unit: 'months', rendered: '12 months' },
];

// ═══ ⑦ A10 一页纸四章 ＋ 溯源指针 ═══

/** 一页纸四槽位标题（= src/agent/report-onepager-trace.ts 的 ONEPAGER_SLOT_TITLES 字面镜像） */
export const EXP_ONEPAGER_SLOTS: readonly string[] = [
  '### 结论',
  '### 关键证据',
  '### 各维度循环结论',
  '### 行动建议',
];

/** 溯源指针前缀（文法 `[src:<kind>:<ref>]`，kind ∈ report/cycle/finding/evidence） */
export const EXP_POINTER_PREFIX = '[src:';

/** 报告外可溯源种类（resolved 且 kind ∈ {cycle,finding,evidence} ⇒ 支柱② 判据） */
export const EXP_EXTERNAL_POINTER_KINDS: readonly string[] = ['cycle', 'finding', 'evidence'];

// ═══ ⑧ A11 禁渲密钥（四态输出都不得命中）═══

/** 渲染产物禁含的模式（大小写不敏感；命中 ⇒ 密钥/凭据泄漏到用户可见面） */
export const EXP_FORBIDDEN_RENDER_PATTERNS: readonly RegExp[] = [
  /token\s*=/i,
  /secret/i,
  /apiKey/i,
  /Bearer\s+/i,
];

// ═══ ⑨ 降级错误码（Q-3/Q-9：errors 每条带 `<CODE>: ` 前缀）═══

/**
 * loader 的 5 个降级 code（= MeasurementTrendsErrorCode 全集）。
 * 约束：loader **自己生成**的 errors 必须以 `<code>: ` 开头；服务端 errors 原样透传（不套壳）。
 */
export const EXP_ERROR_CODE = {
  HTTP: 'METRIC_TRENDS_HTTP_ERROR',
  NETWORK: 'METRIC_TRENDS_NETWORK_ERROR',
  INVALID_JSON: 'METRIC_TRENDS_INVALID_JSON',
  INVALID_SHAPE: 'METRIC_TRENDS_INVALID_SHAPE',
  SERVER_DEGRADED: 'METRIC_TRENDS_SERVER_DEGRADED',
} as const;

/** 全部 5 个 code（顺序无关，用于「全集覆盖」断言） */
export const EXP_ERROR_PREFIX: readonly string[] = [
  EXP_ERROR_CODE.HTTP,
  EXP_ERROR_CODE.NETWORK,
  EXP_ERROR_CODE.INVALID_JSON,
  EXP_ERROR_CODE.INVALID_SHAPE,
  EXP_ERROR_CODE.SERVER_DEGRADED,
];

/** code 与原因之间的分隔符（errors 字符串形态 `<code><sep><原因>`） */
export const EXP_ERROR_SEPARATOR = ': ';

// ═══ ⑩ 渲染夹具（与运行时刻无关的常量；夹具不是期望值，但同样收进唯一源）═══

/** 夹具 latestAt（SQLite datetime 同构串；组件原样输出，不本地化） */
export const EXP_FIXTURE_AT = '2026-10-20 09:00:00';

/** 方向三分支夹具：flat（0）＋ 边界 null（算不出方向 ⇒ 显式 unknown） */
export const EXP_FIXTURE_FLAT = {
  METRIC_ID: 'M4-FLAT-1053-FIXTURE',
  VALUE: 42,
  PREVIOUS_VALUE: 42,
  CHANGE_RATIO: 0,
} as const;

export const EXP_FIXTURE_NULL = {
  METRIC_ID: 'M4-NULL-1053-FIXTURE',
} as const;

/** 渲染期「算不出」的可见文案（Section 的 DIRECTION_META.unknown.symbol） */
export const EXP_UNKNOWN_RENDERED = '未知';

/** 合成降级视图的 errors 文案（不得含 EXP_FORBIDDEN_RENDER_PATTERNS 任何一条） */
export const EXP_DEGRADED_PROBE_ERROR = 'M4_DEGRADED_PROBE: 读回服务不可用';

/** 反例服务器探针码（仅测试内合成，非生产契约） */
export const EXP_PROBE = {
  HTTP_500_CODE: 'M4_PROBE_500',
  BAD_SHAPE_METRIC_ID: 'M4-BAD-SHAPE',
  SERVER_DEGRADED_PASSTHROUGH: 'SERVER_DEGRADED',
} as const;

// ═══ ⑪ Container 源码字面量（A4-d 状态映射 ／ Q-5 cancelled 守卫；T8 追加）═══

/**
 * A4-d：`electron-renderer/src/components/MeasurementTrendContainer.tsx` 的 `deriveState` 三条分支字面量
 * —— **view → state 语义的唯一来源**。
 *
 * 为什么只做源码断言：容器含 `useEffect`，render 桥不执行 hook（文件头「为什么必须分三层」），
 * 直接 import 容器会把 hook 环境带进验收件。故「ok 且 summary 空 ⇒ empty」只能由**生产源码字面量**证明，
 * 再由验收件按该结论传 `state`（**不得由测试自造第二套状态语义**）。
 */
export const EXP_DERIVE_STATE = {
  /** 映射函数声明（定位锚） */
  declaration: 'function deriveState(',
  /** ① 首渲染（未取回）⇒ loading */
  loadingBranch: "if (view === null) return 'loading';",
  /** ② 失败或降级 ⇒ degraded（ok 为真且未降级才可能往下走） */
  degradedBranch: "if (!view.ok || view.degraded) return 'degraded';",
  /** ③ 成功但零组 ⇒ empty（**空表是合法业务态，不是降级**）；否则 ready */
  emptyOrReadyBranch: "return view.summary.length === 0 ? 'empty' : 'ready';",
  /** 映射结论真被接到展示组件（= 不是死代码：接线证据） */
  wiredToSection: 'state={deriveState(view)}',
} as const;

/**
 * Q-5：容器 effect 的 **cancelled 守卫**（卸载/重跑后不得再 `setView`）——源码字面量。
 * 只做源码断言，**不写成行为测试**：render 桥不执行 hook，写成「渲染后再断言」必是假绿。
 */
export const EXP_CANCELLED_GUARD = {
  /** 守卫变量声明（必须出现在 loader 调用之前 —— 否则竞态窗口根本不存在） */
  declaration: 'let cancelled = false',
  /** cleanup 置位（两条路径：未选客户早退 ／ effect 卸载）⇒ 至少 2 处 */
  setTrue: 'cancelled = true',
  minSetTrueOccurrences: 2,
  /** 成功路径守卫：卸载后不再 setView（不写已卸载组件） */
  thenGuard: 'if (!cancelled) setView(result)',
  /** 失败路径守卫 */
  catchGuard: 'if (!cancelled)',
  /** 两条分支的定位锚（切片用：自 `.then(` 到 `.catch(`） */
  thenMarker: '.then(',
  catchMarker: '.catch(',
} as const;
