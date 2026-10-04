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
// ✅ 用 DSH（**13 项**）—— 权威源 §二「✅ 用 DSH」单行 ／ 分隔，逐字
//    ⚠️ 权威源 14 项，**UD-06「人审审批（最强复用候选）」已整项移出**：
//       创始人 2026-10-05 裁定「这个我们不要去做」⇒ 不是标"不适用"，是**移出范围**。
//       移出记录见文末 §Moved-out（不许静默删除）。
// ════════════════════════════════════════════════════════════════

export const useDshItems: readonly DshItem[] = [
  {
    id: 'UD-01', category: '用DSH', name: 'Agent 循环',
    source: '00-最终方案.md:58（✅ 用 DSH 段，第一项）',
    status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
    conflictNote:
      '✅ **已撤销冲突（创始人 2026-10-05 裁定）**：DSH 的 Agent 循环是【运行时能力】（一轮 agent 怎么跑）；' +
      '现行 0-1「六个业务循环的 cron 死路」是【业务层面】（资本循环/人才循环…）。' +
      '**两者正交，不冲突，可并行。**' +
      '⚠️ 教训：CTO 曾按"循环"一词匹配判冲突 —— **词同 ≠ 物同，必须看语义层级**。',
  },
  {
    id: 'UD-02', category: '用DSH', name: '工具注册与执行管线',
    source: '00-最终方案.md:58',
    status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
    conflictNote:
      '✅ **已撤销冲突（创始人 2026-10-05）**：这就是「用 DSH 的」内容本身（权威源 §7.2 第 3 项：' +
      '**工具注册与执行管线（defineTool + ctx.tools.register）**）。' +
      '与 0-11/2-4 是**替代关系**（换了管线，0-11「双重死门」随之消失），**不是冲突**。' +
      '⇒ 0-11/2-4 是「我们的工具治理缺陷」（独立保留）；UD-02 是「换成 DSH 管线」（替换）。',
  },
  { id: 'UD-03', category: '用DSH', name: '会话事件溯源+持久化', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-04', category: '用DSH', name: '模型抽象+适配+重试', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-05', category: '用DSH', name: '沙箱隔离', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-07', category: '用DSH', name: '子代理委派', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },
  { id: 'UD-08', category: '用DSH', name: '上下文压缩三件套', source: '00-最终方案.md:58', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [] },

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
    conflictsWith: [], // ✅ 已撤销（2026-10-05）—— 权威源 §7.3：保留文件驱动，只加「注册/校验/展示」三道关卡；补字段与加关卡并行不冲突
    conflictNote:
      '✅ **已撤销冲突**（权威源 `边界A §7.3` 逐字：「**compute 装载器——保留文件驱动，' +
      '但注册/校验/展示三件事照 DSH 重做**」）⇒ 不是整块重做，是**加三道显式关卡**：' +
      '① 注册（DSH `defineTool`+`ctx.tools.register` vs 我们靠文件名约定 ⇒ 约定错则静默不注册；' +
      '实证=院方坏点1「4 个内建哨兵永远注册不上」）；② 校验（DSH 注册即校验 schema；我们写库零校验，' +
      '实证 `边界A:62`「可写 NONEXISTENT_EDGE 并落库可回读」）；③ 展示（DSH 有 catalog）。' +
      '⇒ 与 1-8/1-9/2-6（补字段）**并行不冲突**：补的是内容，加的是关卡。',
  },
  {
    id: 'RS-05', category: '参考自研', name: '技能目录注入',
    source: '00-最终方案.md:64（B 线 2 项 ⑤，引 expert-dispatcher.ts:311）', status: 'L1实测', doneAt: 'L3真跑',
    conflictsWith: [],
    conflictNote:
      '✅ **已撤销冲突（同 RS-12 技能系统的改判）**：RS-05 是「技能目录注入」这一**具体机制**' +
      '（`expert-dispatcher.ts:311`；DSH 有 `<available_skills>` catalog 强对应物），与 RS-12 同链。' +
      '0-12 保留为前置（先把我们自己的技能加载起来）。',
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
    source: '00-最终方案.md:66（C ⑧）', status: 'L1实测', doneAt: 'L2接线',
    conflictsWith: [],
    conflictNote:
      '✅ **已撤销冲突 + 已核实（CTO 2026-10-05 实测）**：**不是「已是现状」，是「②写了没接」**。' +
      '证据：① 定义 `src/agent/tool-profiles.ts:102`；② `src/` 调用方 **0 个**' +
      '（仅测试 `tests/agent/tool-profiles.test.ts:8,73,76,82,90`）；③ 仓库自己的审计基线早报过：' +
      '`docs/synova/audit/SYNOVA-AUDIT-BASELINE-20260801.txt:524`' +
      '「export filterToolsByProfile -- **WARNING: no callers in src/**」。' +
      '⇒ 权威源说「形状正确」指**逻辑形状**，不等于**接上了**。与 0-11/1-7 **不重叠**（独立接线缺口）。',
  },
  {
    id: 'RS-09', category: '参考自研', name: 'BR-3 五角色 RBAC 模板表（业务语义是我们的）',
    source: '00-最终方案.md:66（C ⑨）', status: 'L1实测', doneAt: 'L1静态',
    conflictsWith: [],
    conflictNote:
      '✅ **已撤销冲突 + 已核实（CTO 2026-10-05 实测）：五角色表已在**。' +
      '证据：`packages/engine-auth/src/rbac.ts` 的 `ROLE_HIERARCHY` = admin:100 / manager:50 / ' +
      'employee:20 / viewer:10 / external:5。' +
      '⇒ 与 1-7 **不重叠**（1-7「多岗位执法只在 1 处」是**覆盖面**问题；RS-09 是**表本身**）。' +
      '🔴 但实测出**新缺陷 N-DEFECT-01**：同文件头注释写「三级角色: admin > manager > employee」，' +
      '与代码的五级**不符** ⇒ 文档与实现不一致。',
  },
  {
    id: 'RS-10', category: '参考自研', name: 'BR-4 Electron 桌面壳（637 LOC）',
    source: '00-最终方案.md:66（C ⑩）', status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
  },
  {
    id: 'RS-12', category: '参考自研',
    name: '技能系统（**保留我们的 skill 文件驱动 + 借 DSH 的 catalog/按需加载/profile 层**）',
    source:
      '00-最终方案.md:58（原列「用 DSH」第 9 项「技能系统」）—— ' +
      'CTO 2026-10-05 改判为「参考自研」',
    status: '需跑真流程', doneAt: 'L3真跑', conflictsWith: [],
    conflictNote:
      '🔴 **CTO 决定（创始人 2026-10-05：「换 dsh 的吧，但如果我们有什么特色需要保留的、' +
      '我们的应用场景需要保留的，你要给我做决定」）**——与 RS-04 compute 装载器同一模式：' +
      '**保留我们的特色 + 借它的机制**。\n' +
      '  **保留（我们的特色，必须留）**：① 技能文件驱动 `skills/<名字>/SKILL.md` 加文件即生效' +
      '（宪章:116 P1「加文件即可不改代码」）；② 技能 ↔ 角色预设包（3-1）↔ 岗位（3-2）的业务绑定；' +
      '③ 三层可见性（industry/custom/profession/builtin，见 3-11 的 L1.5 层）。\n' +
      '  **借 DSH 的机制**：① catalog 注入（对应 `expert-dispatcher.ts:311`）；' +
      '② 按需加载触发（不一次性全塞上下文）；③ profile patch 层（技能对哪个 profile 可见）。\n' +
      '  🔴 **0-12 保留为前置**（把我们自己的技能加载起来 = 前提，不是被替代）。',
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

// ════════════════════════════════════════════════════════════════
// §Moved-out（移出范围，**不许静默删除**）
// ════════════════════════════════════════════════════════════════

/**
 * 权威源 §二「✅ 用 DSH」原列 **14 项**；本件现为 **13 项**。
 * 差额 1 项已移出：
 */
export const movedOut = [
  {
    id: 'UD-06(原)', name: '人审审批（权威源标注：最强复用候选）',
    source: '00-最终方案.md:58',
    reason: '创始人 2026-10-05 裁定：「人审核审批是什么意思？类似飞书/企业微信那种审批流程么？这个我们不要去做。」',
    disposition: '**整项移出范围**（不是标"不适用"）—— 与 1-7「多岗位执法」的冲突声明一并撤销。',
  },
] as const;

// ════════════════════════════════════════════════════════════════
// §NewDefects（本件核实过程中**新发现**的缺陷，须回 40 项/独立卡）
// ════════════════════════════════════════════════════════════════

/**
 * ⚠️ 这些不是"DSH 借鉴项"，是**核实过程中的副产品**：
 *    实测发现「文档与实现不符」。登记在此**以免丢失**，但**处置权在创始人/治理线**。
 */
export const newDefects = [
  {
    id: 'N-DEFECT-01',
    title: 'engine-auth/rbac.ts 头注释写「三级角色」，代码 `ROLE_HIERARCHY` 实为五级',
    evidence:
      '`packages/engine-auth/src/rbac.ts` 头注释「三级角色: admin > manager > employee」；' +
      '同文件 `ROLE_HIERARCHY` = admin/manager/employee/viewer/external 五级',
    impact: '读者按注释理解权限模型 ⇒ 漏掉 viewer/external 两级（越权判断面可能低估）',
    suggestedAt: '与 1-7（多岗位执法）同批，或并入门禁的"文档与代码一致"类检查',
  },
] as const;
