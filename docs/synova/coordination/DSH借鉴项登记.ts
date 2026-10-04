/**
 * DSH 借鉴项登记.ts — DSH 侧 25 项的【独立登记】（创始人 2026-10-05 裁 A）
 *
 * @why  ① 院方《边界评估/00-最终方案.md》§二 给出四类边界清单：
 *          🔴 必须自建 37 项 ／ ✅ 用 DSH 14 项 ／ 🔧 参考自研 11 项 ／ ✂️ 可裁剪 16 项
 *       ② CTO 的 `施工项登记.ts`（40 项）**只覆盖"必须自建"的一个子集**
 *          ⇒ K10 只有 1 项（3-10），"用 DSH 14 项 / 参考自研 11 项"**零覆盖** = 真缺口
 *       ③ 创始人裁定：**单独成一件** —— 「一定不要和其他的混淆，冲突，或者甚至造成重复建设」
 *
 * @scope  本件**只登记**「用 DSH 14 项」+「参考自研 11 项」= **25 项**
 *         ✂️ 可裁剪 16 项**不进本件**：它们是"清理/退役"工作，属另一形态（见 §四 说明）
 *
 * @anti-duplication（**本件的核心纪律**，对应创始人"不重复建设"）
 *   本件每个 item 必须带 `conflictsWith` 字段：
 *     · 数组非空 ⇒ **已识别与现有 40 项的重叠/冲突**，必须写明并交创始人裁
 *     · 数组为空 ⇒ 实测无重叠（已逐条比对 `施工项登记.ts` 的 40 项标题）
 *   🔴 新增 item 时必须先跑比对，**不许静默加入**。
 *
 * @authority  权威源 = `~/山河研究院/04-技术研究/专题研究/DSH借鉴最终方案/边界评估/00-最终方案.md:57-67`
 *             本件是**转录 + 结构化**，不是二次创作；措辞与出处逐条可回查。
 *
 * @ref origin/main@1630a5014（2026-10-04）
 */

// ════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════

/** 四类边界归属（本件只含前两类） */
export type DshCategory = '必须自建' | '用DSH' | '参考自研' | '可裁剪';

/** 判据层级（**防"用静态存在当做完"**—— 依据院方现状报告:40「所有①健康只到静态可达」） */
export type CriterionLevel =
  | 'L1静态' // 代码在不在（git grep / git ls-tree）
  | 'L2接线' // 有无生产调用点
  | 'L3真跑' // 跑一次真实流程，缺陷不复现
  | 'L4正确'; // 回退修复 ⇒ 夹具必红

export interface DshItem {
  /** 编号：UD-01..UD-14（用 DSH）｜RS-01..RS-11（参考自研） */
  id: string;
  category: DshCategory;
  /** 名称（**逐字取权威源**） */
  name: string;
  /** 权威源原文（含出处行号） */
  source: string;
  /** 现状（本件只到 L1 静态；L2/L3/L4 由执行方补） */
  status: '未登记前' | 'L1实测' | '需跑真流程';
  /**
   * 🔴 **防重复建设**：与现有 `施工项登记.ts` 的 40 项的重叠/冲突。
   * 空数组 = 实测无重叠。非空 ⇒ 必须回创始人裁（本件不自行裁定）。
   */
  conflictsWith: string[];
  /** 冲突说明（仅当 conflictsWith 非空） */
  conflictNote?: string;
  /** 该项"做完"要哪一级判据（**不许用 L1 冒充完成**） */
  doneAt: CriterionLevel;
}

// ════════════════════════════════════════════════════════════════
// ✅ 用 DSH（14 项）—— 权威源 §二「✅ 用 DSH」单行 ／ 分隔，逐字
// ════════════════════════════════════════════════════════════════

export const useDshItems: readonly DshItem[] = [
  {
    id: 'UD-01', category: '用DSH', name: 'Agent 循环',
    source: '00-最终方案.md:58（✅ 用 DSH 段，第一项）',
    status: '需跑真流程', doneAt: 'L3真跑',
    conflictsWith: ['0-1'],
    conflictNote:
      '🔴 **重叠**：现行 0-1「六个业务循环的 cron 是死路（总闸）」是【修我们自己的循环调度】；' +
      '而此处主张【Agent 循环用 DSH 的】。二者是**同一条链的两种解法**（修 vs 换），' +
      '⇒ 必须裁：先修（保 0-1）还是直接换（DSH 的 agent 循环）？**不许两条并行做。**',
  },
  {
    id: 'UD-02', category: '用DSH', name: '工具注册与执行管线',
    source: '00-最终方案.md:58',
    status: '需跑真流程', doneAt: 'L3真跑',
    conflictsWith: ['0-11', '2-4'],
    conflictNote:
      '🔴 **冲突**：现行 0-11「ToolRegistry 双重死门」+ 2-4「写入门禁两道未接」= 【修现有工具注册/门禁】；' +
      '此处主张【用 DSH 的工具注册与执行管线】⇒ 若换，0-11/2-4 的修法可能整块作废。' +
      '⇒ 必须裁：修（保 0-11/2-4）还是换（DSH 管线）。',
  },
  { id: 'UD-03', category: '用DSH', name: '会话事件溯源+持久化', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-04', category: '用DSH', name: '模型抽象+适配+重试', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-05', category: '用DSH', name: '沙箱隔离', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  {
    id: 'UD-06', category: '用DSH', name: '人审审批（权威源标注：最强复用候选）',
    source: '00-最终方案.md:58（原文加粗：**人审审批（最强复用候选）**）',
    status: '需跑真流程', doneAt: 'L3真跑',
    conflictsWith: ['1-7'],
    conflictNote:
      '⚠️ **待核重叠**：现行 1-7「多岗位执法只在 1 处」是【把执法点铺开】；' +
      '人审审批是【审批流】。两者可能相关（岗位×审批矩阵）也可能独立。' +
      '⇒ 需执行方核实后者是否已含前者，再定去留。',
  },
  { id: 'UD-07', category: '用DSH', name: '子代理委派', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-08', category: '用DSH', name: '上下文压缩三件套', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  {
    id: 'UD-09', category: '用DSH', name: '技能系统',
    source: '00-最终方案.md:58',
    status: 'L1实测', doneAt: 'L3真跑',
    conflictsWith: ['0-12'],
    conflictNote:
      '🔴 **部分重叠**：现行 0-12「skills/ 46 个技能文件恒不加载」= 【把我们自己的技能加载起来】；' +
      '此处主张【用 DSH 的技能系统】。若是"换用 DSH 的技能系统"，0-12 的修法就作废。' +
      '⇒ 必须裁：接我们自己的（保 0-12）还是换 DSH 的。',
  },
  { id: 'UD-10', category: '用DSH', name: '后台作业', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-11', category: '用DSH', name: '凭证接缝', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-12', category: '用DSH', name: '设置持久化', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  {
    id: 'UD-13', category: '用DSH', name: '插件扩展面（Host+Client 双面）',
    source: '00-最终方案.md:58（原文加粗）', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
  },
  { id: 'UD-14', category: '用DSH', name: 'profile patch', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
];

// ════════════════════════════════════════════════════════════════
// 🔧 参考自研（11 项 = A 4 + B 2 + C 5）—— 权威源 §二，带行内编号 ①–⑪，逐字
// ════════════════════════════════════════════════════════════════

export const refSelfItems: readonly DshItem[] = [
  {
    id: 'RS-01', category: '参考自研', name: '图存储接口（语义自建、物理层可挂 DSH storage）',
    source: '00-最终方案.md:62（A 线 4 项 ①，引 边界A §7.3）', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
  },
  {
    id: 'RS-02', category: '参考自研', name: '进程内事件总线',
    source: '00-最终方案.md:62（A ②）', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
    conflictNote: '⚠️ 权威源特别注明：**DSH hook 是命令式出站回调，替换会改失败模型** ⇒ 自研理由成立。',
  },
  {
    id: 'RS-03', category: '参考自研', name: '数据分级·证据保留分级',
    source: '00-最终方案.md:62（A ③）', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
    conflictNote: '⚠️ 权威源注明：**DSH 有 session 保留策略，无"证据资产"概念** ⇒ 自研理由成立。',
  },
  {
    id: 'RS-04', category: '参考自研', name: 'compute 装载器（保留文件驱动，注册/校验/展示照 DSH 重做）',
    source: '00-最终方案.md:62（A ④）', status: 'L1实测', doneAt: 'L3真跑',
    conflictsWith: ['1-8', '1-9', '2-6'],
    conflictNote:
      '🔴 **重叠**：现行 1-8/1-9/2-6 都是【compute 侧补字段/补契约】；' +
      'RS-04 是【装载器本身重做】。装载器若重做，1-8/1-9/2-6 的落点会变。' +
      '⇒ 需裁：先补字段（保 1-8/1-9/2-6）还是先重做装载器。',
  },
  {
    id: 'RS-05', category: '参考自研', name: '技能目录注入',
    source: '00-最终方案.md:64（B 线 2 项 ⑤，引 expert-dispatcher.ts:311）', status: 'L1实测', doneAt: 'L3真跑',
    conflictsWith: ['0-12'],
    conflictNote: '⚠️ 与 UD-09 同链（技能系统）：RS-05 是"目录注入"这一具体机制，UD-09 是"整系统换 DSH"。',
  },
  {
    id: 'RS-06', category: '参考自研', name: '专家证据过滤 / PII 脱敏 / 超时 / 重试 / 结构化输出校验',
    source: '00-最终方案.md:64（B ⑥，引 expert-dispatcher.ts:202-219,335-339,480-501）', status: '需跑真流程', doneAt: 'L3真跑',
    conflictsWith: [],
    conflictNote: '⚠️ 与 3-10 的"脱敏监听"相关但不同：3-10 是 DSH 的 session-telemetry 监听；RS-06 是我们专家链自己的脱敏。',
  },
  {
    id: 'RS-07', category: '参考自研', name: 'BR-1 哈希链审计算法（权威源标注：实现正确、是合规卖点、DSH 无等价物）',
    source: '00-最终方案.md:66（C 线 5 项 ⑦，引 边界C §3.2）', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
  },
  {
    id: 'RS-08', category: '参考自研', name: 'BR-2 工具角色 profile 过滤（形状正确，读写两处都查）',
    source: '00-最终方案.md:66（C ⑧）', status: '需跑真流程', doneAt: 'L3真跑',
    conflictsWith: ['0-11', '1-7'],
    conflictNote: '⚠️ 与 0-11（ToolRegistry）/1-7（多岗位执法）相邻：RS-08 是"读侧过滤已正确"，可能已是现状而非待建。',
  },
  {
    id: 'RS-09', category: '参考自研', name: 'BR-3 五角色 RBAC 模板表（业务语义是我们的）',
    source: '00-最终方案.md:66（C ⑨）', status: '需跑真流程', doneAt: 'L3真跑',
    conflictsWith: ['1-7'],
    conflictNote: '⚠️ 与 1-7 同域（多岗位/RBAC）；需核实是否已被 1-7 覆盖。',
  },
  {
    id: 'RS-10', category: '参考自研', name: 'BR-4 Electron 桌面壳（637 LOC）',
    source: '00-最终方案.md:66（C ⑩）', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
  },
  {
    id: 'RS-11', category: '参考自研',
    name: 'BR-5 四处 DSH 范式自研实现（timeout / tool-result-pruner / context-compaction / session-projection）',
    source: '00-最终方案.md:66（C ⑪）',
    status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
    conflictNote:
      '🔴 **权威源有两处必须带入的口径**（不许省略）：' +
      '① 断面＝`0.1.1-rc.2`（2026-09-08），**现行锚＝`0.2.0-rc.2`**，版本距离＝11 个 alpha + rc.1 + rc.2；' +
      '② 结论**已按新基线改写**：原「能换就换」→ **「必须重对后逐条定：能换／不能换／需改」**' +
      '（重对执行＝基座线 B-1 卡，2026-10-01 签发）。' +
      '⚠️ 措辞纪律：不得写"锚定 0.1.1-rc.2"（"锚定"＝现行锁定，已致一次误读）。',
  },
];

// ════════════════════════════════════════════════════════════════
// 汇总 + 防重复断言
// ════════════════════════════════════════════════════════════════

export const dshItems: readonly DshItem[] = [...useDshItems, ...refSelfItems];

/** 有冲突声明的项（**必须回创始人裁，本件不自行裁定**） */
export const itemsWithConflicts: readonly DshItem[] = dshItems.filter((i) => i.conflictsWith.length > 0);

/** 自检：项数 + 冲突项数（供执法体与生成器引用） */
export function summarize(): { total: number; conflicts: number; byCat: Record<string, number> } {
  const byCat: Record<string, number> = {};
  for (const i of dshItems) byCat[i.category] = (byCat[i.category] ?? 0) + 1;
  return { total: dshItems.length, conflicts: itemsWithConflicts.length, byCat };
}
