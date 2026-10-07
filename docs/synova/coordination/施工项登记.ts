/**
 * 施工项登记.ts — 基座施工的【单一事实源】（D1144 / CTO 2026-10-04）
 *
 * @why  约束只活在 markdown 里时会发生三种失效（T6 独立复核实证）：
 *         ① 依赖活在表格里 → 被删没人知道（"批次降为块内顺序"删掉了 K2→K3 的系统级依赖）
 *         ② 归属活在表格里 → 10 格里 5 格不是负责人
 *         ③ 完成标准活在方案里 → 改 3 轮还在改
 *       ⇒ 本文件把三样搬进【机器可读 + 可执行】的载体，方案只做生成物。
 *
 * @contract（铁律 47）
 *   @input  — 无。本文件是数据模块（纯常量），无副作用、无 IO、无运行时依赖。
 *   @output — `constructionItems`（48 项）/ `constructionBlocks`（12 块）/
 *             ⚠️ 原注释写「40 项 / 10 块」，实测为 **48 / 12**（CTO 2026-10-08 裁：按实测订正）
 *             `deriveBlockDeps()`（块间依赖，运行时自动汇总）/ `isModuleShape()` / `normalizePath()`
 *   @degraded — 不适用（纯数据模块，无失败路径）
 *
 * ⚠️ 【已废止】本文件**不再**导出 `deriveOwner`，**不再**含 `OWNERSHIP_RULES` 镜像。
 *    域概念已于 2026-10-04 由创始人裁定废止（见同目录《域概念废止件-20261004.md》）。
 *    依据：「门禁里关于任务分配域的规则废止……怎么还存在域的问题呢」
 *    ⇒ 分配单位 = **模块**；`worker` 字段 = **派给谁**（CTO 派单时指定），不是"归属"。
 *
 * @gate（四条不变量，由 `tools/check-construction-registry.ts` 执行 —— **不是 .py**）
 *   ⚠️ 该执法体**尚未接线**（CI/pre-commit 不调用）⇒ 当前"0 违规"是本机结论，**非门禁结论**（见 #1035）
 *   ⚠️ 2026-10-08 实测补记：`tools/check-construction-registry.ts` 在 origin/main **不存在**（全树零命中）
 *      ⇒ "**声称有执法体、实际没有**"（CTO 2026-10-08 裁：归 **#1137（判据入仓）/ #1150（引用路径必须已落 main）** 族；
 *        本处只保留**事实记录**，**不另立卡**）。
 *   INV-1 依赖可判：dependsOn 每个 id 存在、不成环；建表项的每个 NOT NULL 字段须有**可核声明**
 *   INV-2 派单可判：worker 有值且在取值域内；paths 非空且为相对路径（`isModuleShape`）
 *   INV-3 标准可执行：每条 acceptance 须有 expect；**禁纯 grep 型**；引用的文件须存在或在写集内
 *   INV-4 写集互斥：写集**同路径** ⇒ exit 1，除非经 `sharedWrite` 显式声明共写（须串行）
 *   三态 exit：0=过 / 1=违规 / 2=检查自身失败
 *
 * 📌 **卡与项非一一对应**（CTO 2026-10-08 裁定）：本件是**施工项账**，不是卡账。
 *    有卡无项 = 卡面细化（卡比项细正常）；有项无卡 = **待立卡**（未入卡 = 未交办）。
 *    当前：`0-9bis` / `1-7bis` 有项无卡（CTO 已裁立卡）；8 张卡有前缀无项，本件不动。
 *
 * @ref origin/main@9e9e4bd9d（**2026-10-08 卡面→登记件回填断面**；原 1630a5014 / 2026-10-04 14:47）
 *      回填依据：CTO 2026-10-08 裁定（C-01 / C-02 / C-03=R4 / 内部自不一致 5 条 / status 以 GitHub 为准 / title 以卡面为准）
 * @supersedes 施工单.md 的四批次表（转为本文件的 batch 字段）；
 *             施工单原文保留为历史，按创始人 2026-10-04 裁定标 superseded。
 */

// ════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════

export type BlockId =
  | 'K1' | 'K2' | 'K3' | 'K4' | 'K5'
  | 'K6' | 'K7' | 'K8' | 'K9' | 'K10' | 'K11' | 'RETIRED';

/** 验收步：完成标准 = 可执行命令（禁 grep 型 —— T6 面 1 反例） */
export interface AcceptanceStep {
  /** shell 命令。必须在 CI 可跑。 */
  run: string;
  /** 期望。至少给 exit 或 stdoutContains 之一。 */
  expectExit?: number;
  expectStdoutContains?: string;
  /** 断言"运行后数据行数 > N"（穿生产入口的典型判据） */
  expectRowsGt?: { table: string; n: number };
  /** 断言"运行后数据行数 == N"（**清账型判据** —— 例：不该有 anonymous 行 ⇒ n=0） */
  expectRowsEq?: { table: string; n: number };
}

export interface ConstructionItem {
  id: string;
  /** 派给谁（**由 CTO 派单时指定** —— 不是"归属"。域概念已废止 2026-10-04） */
  worker: Worker;
  batch: '第0批' | '第1批' | '第2批' | '第3批';
  block: BlockId;
  title: string;
  /** 写集：落点文件/目录。**卡与卡不重叠由 CTO 派单时裁定**（不再由域推导）。 */
  paths: string[];
  /** 落点尚未定（无主项）⇒ true。门禁对 true 项报"无主"但不 exit 1（它本身就是要裁的事）。 */
  pathTBD?: boolean;
  /** 跨块依赖的施工项 id。空数组 = 无跨块依赖。 */
  dependsOn: string[];
  /** 🔴 **显式声明共写**（2026-10-04 立，治 INV-4 写集同路径）
   *  格式：`"<另一 item id>: <文件路径>"` —— 声明"本项与该 item 共写此文件，须串行"。
   *  依据：创始人废止"域"后，**写集互斥是唯一替代物**；而真实项目里确有"两张卡改同一文件"
   *        的正当情况 ⇒ 不许静默重叠，但允许**显式声明 + 串行**。 */
  sharedWrite?: string[];
  /** 本项若建表，列出表的 NOT NULL 字段 ⇒ 门禁查每个字段有无生产者（INV-1） */
  createsTable?: {
    name: string;
    notNullFields: string[];
    /** 🔴 **可空 + degrade 语义的字段**（2026-10-04 创始人裁 A 时立）
     *  用途：无生产者的字段【不得要求 NOT NULL】—— 否则表能建、写不进（T9 物证：exit 19）。
     *  写入侧契约：缺值 ⇒ 填 null 且该行 `degraded = 1`（禁静默降级 —— 铁律 24/31）。
     *  门禁行为：本名单内的字段**不要求生产者**（它们靠 degrade 标记显式降级）。 */
    nullableDegradedFields?: string[];
    /** 🔴 **字段级生产者声明**（2026-10-04 立，治 T7 面 2 反例「无字段→生产者声明位」）
     *  值 = 生产者的【模块/来源】。允许 `[known-gap]` 前缀表示生产者尚未实现。
     *  门禁 INV-1③ 判据：该字段在 origin/main 有写入门径 **或** 此处有声明 ⇒ 通过。 */
    fieldProducers?: Record<string, string>;
  };
  acceptance: AcceptanceStep[];
  status: 'todo' | 'doing' | 'done' | 'retired' | 'proposal' | 'active';
  /** ⚠️ `active` = GitHub 上已重开 / 在办（CTO 2026-10-08 裁，用于 0-9）。
   *  原 `retired` 的前提「auth.ts 内联空桩」只对**写入侧**成立；对**消费端短路**
   *  （knowledge-store.ts:195/:335 空条件集跳过过滤 ⇒ filtered_out 恒 0）不成立 ⇒ 本项重新有效。 */
  /** 出处（院方件 file:行号），供独立核 */
  source: string;
}

export interface ConstructionBlock {
  id: BlockId;
  name: string;
  /** 覆盖的施工项 */
  items: string[];
  /** 块间依赖。🔴 **已废止手写**（2026-10-04）—— 由 `deriveBlockDeps()` 从项级自动汇总。
   *  废止理由：我手写的值与项级对不上（T7 面 3 反例；执法体报 BLOCK-DEP 13 处）。 */
  dependsOnBlocks?: never;
  /** 块级完成标准 = 至少一条穿生产入口的判据（T6: 7/10 块原无此列） */
  blockAcceptance: AcceptanceStep[];
  source: string;
}

// ════════════════════════════════════════════════════════════════
// 【已废止】域规则镜像（2026-10-04 创始人裁定）
//
// 原设计：owner 由 paths 经 ownership.yaml 推导 ⇒ 治"负责人列被手填成不是负责人"
// 废止理由：创始人 2026-10-04「门禁里关于任务分配域的规则废止……怎么还存在域的问题呢」
//           + 2026-09-29「硬要分域，门禁相互拉扯，浪费时间」
// 替代：
//   · 分配单位 = **模块**（一个包/插件/模块），不是域
//   · `worker` 字段 = **派给谁**（由 CTO 派单时指定），不是"归属"
//   · 不冲突的保证 = **写集互斥**（派单时裁定）
// ⇒ 本文件不再含任何路径→域的规则；`core.PLATFORM` 之类概念随之废止。
// ════════════════════════════════════════════════════════════════

/** 执行者标识（会话实例名。**不是域** —— 由 CTO 派单时指定） */
export type Worker = 'cto' | 'win' | 'mac' | 'k3' | 'gov';

/** 模块粒度判据（创始人 2026-10-04：「开发的颗粒度你来定」）
 *  = **能独立完成"开发好 → 与基座接上"的最小单位**。
 *  具体形态：一个包（packages/*）／一个扩展（extensions/* 下的一个目录）／
 *            一个新模块（src/ 下一个可独立验收的目录或单文件）／一个门禁脚本。
 *  判据（三条全中才算一个模块）：
 *    ① 有独立写集（不与其它模块的文件重叠）
 *    ② 有独立完成标准（跑一次真实流程可验，禁 grep 型）
 *    ③ 能单独与基座对接（不依赖同批其它模块先完成）
 */
/** 把文件路径规范化（去行号、去绝对前缀）—— 判据引用与写集比对时用 */
export function normalizePath(raw: string): string {
  return raw.replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '');
}

export function isModuleShape(paths: readonly string[]): boolean {
  if (paths.length === 0) return false;
  // 判据（2026-10-04，创始人：「开发的颗粒度你来定」）：
  //   每个 path 必须是【相对路径】且【非空】—— 目录（可单层/可点开头）或文件皆可。
  //   ⚠️ 不做形态白名单（曾试 `<dir>/…` 与正则两种，都误伤合法项：单层目录 / 点开头目录 / 中文目录）
  //   ⇒ 保留唯一硬约束：**必须相对**（不以 `/` 开头、不含 `..`）—— 因为绝对路径无法与仓内写集比对。
  return paths.every((p) => !!p.trim() && !p.startsWith('/') && !p.includes('..'));
}


// ════════════════════════════════════════════════════════════════
// 40 项（源自施工单，逐条给 paths / dependsOn / acceptance）
// ════════════════════════════════════════════════════════════════

export const constructionItems: readonly ConstructionItem[] = [
  // ───────────────── 第 0 批 · 止血 ─────────────────
  {
    id: '0-1',
    worker: 'win', batch: '第0批', block: 'K1',
    title: '六个业务循环的 cron 是死路（总闸）',
    // 卡面 §④「可碰」（首项仅在探针本身有缺陷时）；原 4 条写集随修复入 main 全部过期
    paths: [
      'tests/loops/probes/batch0a-probes.ts',
      'docs/synova/product-lines/evidence/**',
      'tests/loops/**',
    ],
    dependsOn: [],
    // CTO 2026-10-08 裁定（内部自不一致 #2）：原引 `loop_runs` 表 —— 该表在 origin/main **全树零命中**，判据根本跑不通。
    //   已按卡面 #975 判据订正为「探针 + 三态」；**不得自行换表名**（CTO 明令）。
    //   ⚠️ 计数口径（CTO 2026-10-08 要求写明）：本条的 `grep -c` 作用在**单个文件**（/tmp/batch0a.stderr.log）
    //      ⇒ 口径 = **行数**，不存在「多文件串接致两处命中并成一行」的少算风险（对照 3-9 的 27⇄28 假象）。
    //   V1 = 探针不再输出 `[D9] MainAgent 未注入 — 跳过 loop-1..6 (degraded)`（期望 0 命中）；
    //   V2 = 探针 stdout `bound:true` / `loop1ExecutionCount:1` / `loop1Scale:"slow"`（非命令型，见下方 §⑥ 抄录）。
    // ┌─ 卡面 §⑥ 判据（Issue #975，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-1 让 `LoopScheduler#setMainAgent` 被真注入；或统一两处同名函数（`src/s
    // │ - [ ] `V1` **唯一验收判据（原文口径）**：探针不再输出 `[D9] MainAgent 未注入 — 跳过 loop-1..6 (degraded)`
    // │       ⇒ 复现：`node_modules/.bin/tsx tests/loops/probes/batch0a-probes.ts 2> /tmp/batch0a.stderr.log; grep -c "D9\] MainAgent 未注入" /tmp/batch0a.stderr.log` ⇒ **期望 0**
    // │ - [ ] `V2` 探针 stdout：`bound:true` / `loop1ExecutionCount:1` / `loop1Scale:"slow"`
    // │ - [ ] `V3` 反例（改坏即红）：注释 `src/server.ts:164` 的 `bindMainAgent(mainAgent)` ⇒ `bound=false` / `count=0` / stderr 命中 D9；恢复后回绿
    // │ - [ ] `V4` 附带（非验收）：`git grep -c "\.setMainAgent(" origin/main -- src/` ⇒ 计数为 **0**（**诊断行，禁作完成判据**）
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'bash -c "node_modules/.bin/tsx tests/loops/probes/batch0a-probes.ts 2> /tmp/batch0a.stderr.log; grep -c \'D9] MainAgent 未注入\' /tmp/batch0a.stderr.log | grep -q ^0$"', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `（\`src/s`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    status: 'todo',
    source: '施工单.md 0-1 / 现状报告 坏点2',
  },
  {
    id: '0-2',
    sharedWrite: ["2-3: src/growth/feedback-collector.ts（0-2 改聚合键，2-3 改通道；须串行）"],
    worker: 'win', batch: '第0批', block: 'K6',
    title: '进化回写 applied 恒 0（总闸）',
    // 卡面 §④「实际修复落点，实测」；卡面明写「#1163 回填时须订正 paths」
    paths: [
      'src/loops/middle-evolution-engine.ts',
      'tests/growth/evolution-writeback.test.ts',
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #976，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-2 聚合改为 per `target_id`，或让动作携带真哨兵键——真哨兵 ID 已在 `:381` 的 
    // │ - [ ] `V1` **夹具真跑通**：`npx vitest run tests/growth/evolution-writeback.test.ts` ⇒ exit 0（三路径：正常 = 同实体 3 次 reject ⇒ `applied=1` + 阈值文件变化 + 账本行；降级 = 实体不在任何 `thresholds.json` ⇒ `skipped` 且不抛；边界 = <3 次不聚合、组内实体不唯一 ⇒ 不猜实体）
    // │ - [ ] `V2` **账本可对账**：`agent_memory` 出现 `key LIKE '%_gaCorrections%'` 行（= `applied` 恒 0 的直接反面）
    // │ - [ ] `V3`（原判据，**条件性**）`extensions/**/*.json` 出现 `_gaCorrections` ⇒ **当前条件未达成**（无真实反馈数据）；达成条件 = `feedback_log > 0`
    // │ - [ ] **反例（改坏即红）**：key 改回复合键 ⇒ 夹具 **4 failed**（`signalKeys:["reject:sentinel_alert:ga"] / gaCorrections:null`）
    // │ - [ ] **运行时回写复测（未做）**：真实反馈数据流入后，跑一轮进化回写并复核 `agent_memory` / `extensions/` 落盘
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实进化回写，断言表行
      { run: 'npx vitest run tests/growth/evolution-writeback.test.ts', expectExit: 0 },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM agent_memory WHERE key LIKE \'%_gaCorrections%\'"', expectRowsGt: { table: 'agent_memory', n: 0 } },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `已在 \`:381\` 的 `），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    // GitHub CLOSED；修复 `d872c09a6`（PR #1202）已入 main ⇒ 按 GitHub 订正（CTO 2026-10-08 条件 3）。⚠️ 卡面 §⑥ 记「运行时回写复测（未做）」—— done ≠ 复测已做
    // ⚠️ 待裁（CTO）：卡面 §⑤ 列 `0-1`(#975, OPEN) 为上游（「两闸皆通，第 2 批才有落点」）；登记件 dependsOn=[] ⇒ 口径级差异，未裁故**保留原值**（见 PR §保留待裁）
    status: 'done',
    source: '施工单.md 0-2 / 现状报告 坏点3',
  },
  {
    id: '0-3',
    worker: 'win', batch: '第0批', block: 'K3',
    title: '4 个内建哨兵永远注册不上',
    // 卡面 §④（首项仅当行为被证伪时才碰）
    paths: [
      'src/sentinel/builtins.ts',
      'tests/sentinel/**',
      'docs/synova/product-lines/evidence/**',
    ],
    dependsOn: [],
    // CTO 裁定 C-02（2026-10-08）：0-3.paths 含 `src/sentinel/builtins.ts`，与 2-1b / 3-8 的
    //   `src/sentinel/` **同路径** ⇒ 共写事实成立（原登记件缺声明；原卡面误称「登记件已有双向声明」）。
    //   现按事实补齐双向声明；卡面 #977 那句已同步改掉（CTO 要求）。
    sharedWrite: [
      "2-1b: src/sentinel/（0-3 仅当 `builtins.ts` 行为被证伪时才碰；同目录须串行）",
      "3-8: src/sentinel/（同上）",
    ],
    // ┌─ 卡面 §⑥ 判据（Issue #977，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-3 装载器改为「遍历模块导出、取第一个带 config 的对象」（推荐，把命名约定变成结构上不可能错）；或统
    // │ - [ ] `V1` **行为判据（CTO 裁定 R2 原文口径）**：**启动后注册数含 `cashFlow` / `cpc` / `goalAlignment` / `integrationHealth` 四个**
    // │       ⇒ 可核形式（口径对齐 §②d）：注册表含 4 个内置适配器 —— 注册 id `sentinel-cash-flow` / `sentinel-cpc` / `sentinel-goal-alignment` / `sentinel-integration-health`，且其**推导键**分别为 `cashFlow` / `cpc` / `goalAlignment` / `integrationHealth`
    // │ - [ ] `V2` **启动日志为证**：`[builtins] 哨兵自动注册完成` 行含 `scanned=4` 且 `registered=4`；4 个文件各有 `已注册`（或 `文件名推导键未命中 — 已按哨兵结构兜底命中`）行 —— **原始输出须留档**
    // │ - [ ] `V3` **反例（改坏即红）**：把 `resolveSentinelExport` 的兜底分支删掉（只留 `preferredKey` 取值）⇒ 4 个适配器全部 `log.error 未导出哨兵结构对象`，`registered` 掉到 **0**（= 原文 `registered=0 / scanned=4` 复现）
    // │ - [ ] `V4` **不得以"删掉 `filenameToExportKey`"为判据**（父卡原文要求已作废；`git grep` 命中 4 处 = 预期）
    // │ - [ ] `V5` 回归锁（补充，不得单独作完成判据）：`tests/sentinel/**` 相关用例 ⇒ exit 0
    // │ - **判定人**：K3 / 独立复核（执行方不得自判）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npm run probe:sentinels 2>/dev/null || npx tsx scripts/control-tower/probe-sentinels.ts', expectStdoutContains: 'cashFlow' },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `；或统`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    // GitHub CLOSED 2026-10-05；修复本体已入 main ⇒ 按 GitHub 订正。⚠️ 卡面 §⑤ 记「唯一缺口 = 启动输出作证（ncomments:0）」
    status: 'done',
    source: '施工单.md 0-3 / 现状报告 坏点1',
  },
  {
    id: '0-4',
    worker: 'win', batch: '第0批', block: 'K4',
    title: '循环的五阀映射指向已废止编号',
    // 卡面 §④；原 `src/cycles/` 已删（卡面明令绝不碰该目录）
    paths: [
      'cycles/builtin/*.cycle.json',
      'cycles/industry/*/*.cycle.json',
      'scripts/control-tower/probe-cycle-edges.ts',
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #978，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-4 写 E-x.y → label 映射并让加载器翻译；或按新体系重写。⚠️ 我实测：四个体系互不相认，权威
    // │ **Done 判据（可复现；原文保留并补强）**：
    // │ ```
    // │ ① 循环配置里 `E-[0-9]+\.[0-9]+` 形态出现次数 = 【0】
    // │    `git grep -ohE "E-[0-9]+\.[0-9]+" origin/main -- cycles/ | wc -l`   ⇒ 0（今 45）
    // │ ② 每条 `edgeRefs`/`edgeId` 的值 ∈ 代码边 `$id` ∪ `label`（或明确标 unknown）
    // │ ③ 低可信条目要么定稿、要么显式保留 unknown —— 【不许猜】
    // │ ```
    // │ **补强判据（本次新增）**：
    // │ ```
    // │ ④ 判据交付物落地且可跑：`npx tsx scripts/control-tower/probe-cycle-edges.ts` ⇒ exit 0（登记件 acceptance 原文）
    // │ ⑤ 反例（改坏即红）：把任一条 `edgeRefs` 值改回 `E-1.1` 形态 ⇒ ① 必红（45 ≠ 0）
    // │ ⑥ 反例（漏改即红）：只改 `nodes[].edgeRefs` 不改 `mapping[].edgeId` ⇒ ① 仍 > 0（残留 23 处）
    // │ ```
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-cycle-edges.ts', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `权威`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    status: 'todo',
    source: '施工单.md 0-4 / 现状报告 坏点6',
  },
  {
    id: '0-5',
    worker: 'win', batch: '第0批', block: 'K6',
    title: '目标哨兵"因子3"恒 false',
    paths: [
      'src/growth/goal-sentinel.ts',
      'tests/growth/goal-sentinel.test.ts',
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #979，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-5 删掉自相矛盾那一行（`baseline = …? 0 : null` 与 `:106` 的判据互斥）——
    // │ - [ ] `V1` **行为型判据**：`npx vitest run tests/growth/goal-sentinel.test.ts` ⇒ exit 0；且用例中存在"**构造数据下 `factor3.triggered === true`**"的断言（原判据原文：因子3 在构造数据下可为 true）
    // │ - [ ] `V2` **反向断言**：无 `baselinePeriod` 或无采集样本 ⇒ `factor3.triggered === false` 且 `degraded` 路径不抛（不猜值，P8）
    // │ - [ ] **反例（改坏即红）**：把 `baseline` 改回恒 `0`/`null` ⇒ 因子3 相关的 true 断言必红
    // │ - [ ] **复核项**：`git grep -n "baselinePeriod ? 0 : null" origin/main -- src/growth/` 的命中**必须落在注释行**（`:191`），不得出现在可执行代码
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/growth/goal-sentinel.test.ts', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `）——`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    // GitHub CLOSED；修复 `ab8450a57`（PR #1012）已入 main ⇒ 按 GitHub 订正
    status: 'done',
    source: '施工单.md 0-5 / 现状报告 坏点5',
  },
  {
    id: '0-6',
    worker: 'win', batch: '第0批', block: 'K8',
    title: 'Schema 校验器覆盖率 1/40',
    // 卡面 §④；第三项**仅当选 (b)** 时可碰（调用点 :82）
    paths: [
      'src/l4/sog-schema-validator.ts',
      'scripts/control-tower/probe-diagnosis.ts',
      'src/l4/graph-bridge.ts',
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #980，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-6 最小改动：把 `return []`（静默放行）改为返回 degraded + log.warn——不阻
    // │ - [ ] `V1`（**登记件 `acceptance` 原文**）：`bash -c "npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 | grep -q '未覆盖类型'"` ⇒ **exit = 0**
    // │ - [ ] `V2`（**施工单原文**）：跑一次诊断，日志出现「**未覆盖类型 N 个**」的**显式告警**（N 为一次诊断内去重聚合数）
    // │ - [ ] `V3` 告警内容可核：日志行须含 `nodeType`（或类型清单）——不能只是"未覆盖类型 N 个"而无从定位
    // │ - [ ] `V4` **不阻断**：`:141` 命中路径下 `store.createNode` **仍返回 nodeId**（写入未被拒），与改动前行为一致
    // │ - [ ] `V5` **反例（改坏即红）**：把 `:141` 改回 `if (!schema) return [];` 且不记日志 ⇒ `V1`/`V2` **必红**
    // │ - [ ] `V6` **反例（改坏即红）**：若选 (b)，把 `graph-bridge.ts:82` 的调用改回忽略 `degraded` ⇒ 降级信号不传播，`V4` 之外的铁律 31 检查必红
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'bash -c "npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 | grep -q \'未覆盖类型\'"', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `——不阻`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    status: 'todo',
    source: '施工单.md 0-6 / 现状报告 坏点4',
  },
  {
    id: '0-7',
    worker: 'win', batch: '第0批', block: 'K6',
    title: '0-7 补降级日志（`.catch(()=>{})` → 记 warn）；并补传 `memoryStore`',
    // 卡面 §④「本卡可碰 = 无（代码已完成）；取证用该文件（只跑不改）」
    paths: [
      'tests/routes/chat-feedback.test.ts',
    ],
    dependsOn: ['2-3'],
    // ┌─ 卡面 §⑥ 判据（Issue #981，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-7 补降级日志（`.catch(()=>{})` → 记 warn）；并补传 `memoryStore`
    // │ - [ ] `V1`（**登记件 acceptance 原文**）：`npx vitest run tests/routes/chat-feedback.test.ts` ⇒ **exit = 0**
    // │ - [ ] `V2` 成功路径：响应体 `feedback.persisted === true` **且真库出现 `correction_*` 企业事实行**（测试自述「真落库，不看布尔」）
    // │ - [ ] `V3` 降级路径：`memoryStore` 不可用 ⇒ 响应 `feedback.degraded === true` **且捕获到 `log.warn`**（铁律 24+31）
    // │ - [ ] `V4` 两条路径下「提议确认」主流程均**不被阻断**（`ok:true`）
    // │ - [ ] `V5` **反例（改坏即红，测试自带判别性）**：把 `collectFeedback(...)` 第 2 参 `memoryStore` 去掉（= 修复前）⇒ 用例 ① **必红**（`persisted` 恒 false）
    // │ - [ ] `V6` 真路由（铁律 12）：测试挂 `src/routes/chat` **真实 router** 到 express + 真实 HTTP 请求，**不 mock 管线**（仅 mock `engine-context` 的 DB 句柄与 `proposal-manager`）
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/routes/chat-feedback.test.ts', expectExit: 0 },
    ],
    // GitHub CLOSED 2026-10-05；修复 `ac2c11157` 已入 main ⇒ 按 GitHub 订正
    status: 'done',
    source: '施工单.md 0-7 / 现状报告 坏点8',
  },
  {
    id: '0-8',
    worker: 'win', batch: '第0批', block: 'K6',
    title: '参数层 c 类整个模块零引用',
    // 卡面 §④「本卡可碰 = 无（处置已完成）；取证用上述 5 个既有测试（只跑不改）」；CTO 2026-10-07 已裁以卡面 5 测试为准
    paths: [
      'tests/growth/goal-lifecycle.test.ts',
      'tests/integration/goal-lifecycle.integration.test.ts',
      'tests/growth/effect-verification.test.ts',
      'tests/growth/e2e-navigation-loop.integration.test.ts',
      'tests/growth/goal-sentinel.test.ts',
    ],
    dependsOn: [],
    // CTO 2026-10-07 裁定（判据收敛）：判据 = 卡面 5 个既有测试，**逐条跑、不许合并成一次跑**；
    //   原登记件引用的 `tests/growth/goal-lifecycle-wired-or-retired.test.ts` 在 main **不存在**（全树零命中）⇒ 已删除。
    // ┌─ 卡面 §⑥ 判据（Issue #982，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-8 二选一：接上（让 closeGoal/verifyEffect 有调用方）；或明确不接（删或标注废弃）—
    // │ - [ ] `V1`（**订正块 ①**）：模块头 `@deprecated` + 「未接线（#982 明示不接）」+ 接入点 `#1010` —— **已在 main**（C3/C4）
    // │ - [ ] `V2`（**订正块 ②**，**本次未做**）：5 个测试文件**逐条**跑绿，`npx vitest run` 各文件 **exit = 0**，命令与原始输出留档
    // │       🔴 **CTO 2026-10-07 裁定：判据收敛 = 以本项（卡面 5 个既有测试）为准**——原卡面订正块与登记件两条载体之争到此结束；登记件 `acceptance` 里的 `tests/growth/goal-lifecycle-wired-or-retired.test.ts`（**不存在**，C14）**不作判据**，标注 =「**登记件待回填（#1163）时改写**」。5 个文件与命令（逐条，不许合并成一次跑）：
    // │       ```
    // │       tests/growth/goal-lifecycle.test.ts
    // │       tests/integration/goal-lifecycle.integration.test.ts
    // │       tests/growth/effect-verification.test.ts
    // │       tests/growth/e2e-navigation-loop.integration.test.ts
    // │       tests/growth/goal-sentinel.test.ts
    // │       ```
    // │ - [ ] `V3`（**订正块 ③**）：`#1010` 已立且 **OPEN**（C5）
    // │ - [ ] `V4`（**原 Done，保留作反例基线**）：「该文件出现外部 import，或无残留符号」⇒ **已由订正块替代**；仍可用于**反例**：若有人按旧 Done 删文件 ⇒ `V2` 必红（5 个测试 import 不到模块）
    // │ - [ ] `V5` 反例（改坏即红）：去掉 `@deprecated` 且不接线上调用方 ⇒ 状态回落为"悬空"，本卡判断不成立
    // │ - ⚠️ **登记件 `acceptance` 与卡面订正冲突（已由 CTO 裁定消解）**：登记件要求 `npx vitest run tests/growth/goal-lifecycle-wired-or-retired.test.ts`（`施工项登记.ts:262`），但该文件**不存在**（C14）⇒ **CTO 2026-10-07 裁定：以卡面 5 个既有测试为准**（`V2`）；登记件那条标注「**登记件待回填（#1163）时改写**」。**本项不再是本卡未决项。**
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/growth/goal-lifecycle.test.ts', expectExit: 0 },
      { run: 'npx vitest run tests/integration/goal-lifecycle.integration.test.ts', expectExit: 0 },
      { run: 'npx vitest run tests/growth/effect-verification.test.ts', expectExit: 0 },
      { run: 'npx vitest run tests/growth/e2e-navigation-loop.integration.test.ts', expectExit: 0 },
      { run: 'npx vitest run tests/growth/goal-sentinel.test.ts', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `）—`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    status: 'todo',
    source: '施工单.md 0-8 / 现状报告 坏点7',
  },
  {
    id: '0-9',
    worker: 'win', batch: '第0批', block: 'K1',
    title: '0-9 知识权限过滤：复测 + 根因收口',
    paths: ['src/l4/knowledge-store.ts', 'tests/l4/**'],  // CTO 2026-10-08 裁定取 (a)
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #983，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-9 知识权限过滤：复测 + 根因收口
    // │ - [ ] 🔴 **注入 `staff` 角色请求 `search` ⇒ `knowledge_audit.filtered_out > 0`**（真跑：真 HTTP + 真路由 + 真库）—— **重开裁定第 3 件：本项 2026-10-07 未复测，不得据实现面宣称完成**
    // │   - 证据形态：请求原始输出 ＋ `sqlite3 <db> "SELECT event_type,user_id,total_hits,filtered_out FROM knowledge_audit ORDER BY id DESC LIMIT 1"` 原始输出
    // │   - **证据落点（硬要求）**：落 `docs/synova/product-lines/evidence/**`（仓内证据惯例），回执附路径；**未落档不得勾本项**
    // │ - [ ] **对照条**：`admin` 请求同一 query ⇒ 允许型条件集，但**不因空条件集而短路**（即：`conditions` 非空仍成立）
    // │ - [ ] **反例（改坏即红）**：把 `src/middleware/auth.ts:454-462` 的 `conditions` 改回 `[]` ⇒ 判据必红（`filtered_out` 回落 0）
    // │ - [ ] **根因短路的处置已落地**（§③.2，二选一且留痕）
    // │ - [ ] 单测（**补充，不得单独作为完成判据**）：`npx vitest run tests/` 相关用例 ⇒ exit 0
    // │ - **判定人**：K3 / 独立复核（执行方不得自判）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/security/org-isolation-audit.test.ts', expectExit: 0 },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM knowledge_audit WHERE filtered_out > 0"', expectRowsGt: { table: 'knowledge_audit', n: 0 } },
    ],
    // CTO 2026-10-08 裁定（条件 3）：原 `retired` ⇒ 改 `active`。原 retired 的理由「前提被证伪」只对 auth.ts **写入侧空桩**成立；对**消费端短路**（knowledge-store.ts:195/:335 空条件集跳过过滤 ⇒ filtered_out 恒 0）不成立
    // 📌 CTO 2026-10-08 裁定（0-9）：取 **(a)** —— 根因短路的对象就在 `src/l4/knowledge-store.ts`
    //   （`:335`「空条件 ⇒ 不过滤」，blame 停在 2026-06-05）；(b) 的探针属**判据交付物**不是根因修复，
    //   且会引入治理线窗串行（白增摩擦）。若最终确需探针 ⇒ 作为 (a) 的**附加**提出并**先报治理线窗**，主写集 = (a)。
    status: 'active',
    source: '施工单.md 0-9 —— 🔴 **已作废（2026-10-05）**：前提被证伪。auth.ts:354-356 实为 DEV_MODE 自动 admin 分支（非内联空桩）；真 provider 在 :441-459（身份派生非空条件集）。#983 已 CLOSED/NOT_PLANNED 同因。**本项无对象** ⇒ 转 0-9\u0027（知识审计不可归属）',
  },
  {
    id: '0-10',
    worker: 'win', batch: '第0批', block: 'K1',
    title: 'fail-open 兜底（0-9 延伸）',
    paths: [
      'tests/security/request-context-failclosed.test.ts',
      'tests/routes/im-authprovider.test.ts',
    ],
    // 与 K1-WH 同占 src/routes/im.ts ⇒ 显式声明共写（须串行）
    sharedWrite: ["K1-WH: src/routes/im.ts（同类端点，须串行）"],
    dependsOn: ['0-9bis'],
    // ┌─ 卡面 §⑥ 判据（Issue #984，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-10 按正本 §九原则 4 改 fail-closed：无 user/无 authProvider → 返回不
    // │ - [ ] `V1` **未认证 ⇒ search 返回 0 行**（原文口径）：注入 `staff`/匿名请求 `search` ⇒ 命中 **0 行**（或 `knowledge_audit.filtered_out > 0`）
    // │ - [ ] `V2` **未认证 ⇒ `log.warn` 留痕**：日志出现 `code=RBAC_DENIED` + `reason=no_request_context`
    // │ - [ ] `V3` **拒绝型条件集非空**：`getCurrentFilterClause(任意 resourceType)` 在无上下文时 `conditions.length > 0`，且 `field='__d947_no_authenticated_context'` / `operator='EQ'` / `value='__d947_deny_all__'`
    // │ - [ ] `V4` **有 user 无 authProvider ⇒ 同样拒绝**（不得因 user 存在而放行）
    // │ - [ ] `V5` **反例（改坏即红）**：把兜底改回 `{ conditions: [] }` ⇒ `tests/security/request-context-failclosed.test.ts` 必红；把 `im.ts` 的 `authProvider` 删掉 ⇒ `tests/routes/im-authprovider.test.ts` 必红
    // │ - [ ] `V6` 回归锁复跑：`npx vitest run tests/security/request-context-failclosed.test.ts tests/routes/im-authprovider.test.ts` ⇒ **exit = 0**
    // │ - **判定人**：K3 / 独立复核（执行方不得自判）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/security/request-context-failclosed.test.ts', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `→ 返回不`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    // GitHub CLOSED 2026-10-04；两处修复均已落 main ⇒ 按 GitHub 订正
    // ⚠️ 待裁（CTO）：登记件 dependsOn 含 `0-9bis`（**该项无对应卡**）；卡面 §⑤ 未提 ⇒ 未裁故**保留原值**
    status: 'done',
    source: '施工单.md 0-10（⚠️ CTO 实测：request-context 已修，剩 im.ts:53 补传 provider）',
  },
  {
    id: '0-11',
    sharedWrite: ["2-4: src/tools/tool-registry.ts（0-11 决策死门去留，2-4 接写入门禁；同一文件须串行）"],
    worker: 'win', batch: '第0批', block: 'K2',
    title: 'ToolRegistry 双重死门',
    paths: [
      'src/tools/tool-registry.ts',
      'scripts/control-tower/probe-tool-policy.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    // ⚠️ 待裁（CTO，C-13）：卡面 §⑥ 判据已行为化（越权 ⇒ POLICY_DENIED 且落审计）但**未给可执行命令**；
    //   登记件原值为 grep 型（与登记件自身 INV-3「禁纯 grep 型」冲突）⇒ **保留原值**，见 PR §保留待裁。
    // 🔴 口径 + 缺陷记录（CTO 2026-10-08 要求「串接后计数」型判据须标口径；本条更严重）：
    //   `git grep -c setPolicyEngine -- src/` 是 **per-file 计数**，输出形如 `src/xxx.ts:1`（每行一个 `path:count`），
    //   **不是总数**；实测有命中 ⇒ `src/tools/tool-registry.ts:1`（exit 0）；无命中 ⇒ 零输出 + exit 1。
    //   ⇒ 后续 `grep -q ^0$` 两种情况**都不匹配** ⇒ **B 分支恒失败**：本 command 在 (b) 路线下永远跑不通。（A 分支不受影响。）
    // ┌─ 卡面 §⑥ 判据（Issue #985，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-11 二选一：(a) 装配 setPolicyEngine(new PolicyEngine()) 并让工具执
    // │ - [ ] 选 (a)：越权调用返回 `POLICY_DENIED` **且落审计**（非静默）
    // │ - [ ] 选 (b)：`setPolicyEngine` / `.invoke` **两符号零命中**
    // │ - [ ] 反例（改坏即红）：把拒绝分支改成放行 ⇒ 必红
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      // 二选一：(a) 装配并走 invoke ⇒ 越权返回 POLICY_DENIED；(b) 删掉 ⇒ 两符号 0 命中
      { run: 'bash -c "npx tsx scripts/control-tower/probe-tool-policy.ts | grep -q POLICY_DENIED || git grep -c setPolicyEngine -- src/ | grep -q ^0$"', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `并让工具执`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    status: 'todo',
    source: '施工单.md 0-11 / 现状报告 坏点9 同族',
  },
  {
    id: '0-12',
    worker: 'win', batch: '第0批', block: 'K9',
    title: 'skills/ 46 个技能文件恒不加载',
    paths: [
      'src/agent/skill-lazy-loader.ts',
      'scripts/control-tower/probe-skills.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #986，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：0-12 在启动时调一次 scanFromFiles(<skills 目录>)；或把 skills/ 迁到 Pha
    // │ - [ ] prompt 出现 `## Available Skills`；`listForExpert` **非空**（穿生产入口）
    // │ - [ ] 反例（改坏即红）：把 `scanFromFiles` 调用再次去掉 ⇒ 判据必红
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'bash -c "npx tsx scripts/control-tower/probe-skills.ts | grep -q \'## Available Skills\'"', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（title）：卡面标题为 GitHub 显示限制下的**截断形态**（结尾 `或把 skills/ 迁到 Pha`），本字段为**完整命名** ——
    //   两处**故意不同**，不是「未同步」。理由：登记件是**判据源**，不该被 GitHub 显示限制绑架；卡号的标识作用不依赖标题完整。
    status: 'todo',
    source: '施工单.md 0-12 / 现状报告 坏点10',
  },

  // ───────────────── 第 1 批 · 补齐 ─────────────────
  {
    id: '1-1',
    worker: 'win', batch: '第1批', block: 'K7',
    title: '一页纸偏离只告警不拦截',
    paths: [
      'src/agent/report-assembler.ts',
      'scripts/golden-scenarios/GS-08-report-readable/',
    ],
    dependsOn: [],
    // CTO 裁定 C-01（2026-10-08）：原写 `bash scripts/golden-scenarios/run.sh GS-08` —— **该路径不存在**
    //   （main 上只有逐场景脚本 `scripts/golden-scenarios/GS-08-report-readable/run.sh`；见 scripts/golden-scenarios/README.md §运行契约）。
    //   登记件与卡面**同时订正**（卡面 #1061 §⑥ 那句已同步改掉）。
    //   另卡面 §⑥ 要求「GS-08 断言 3 → 4 且能红（正常绿 / 故意缺指针红 两段原始输出）」——非命令型，见下方抄录。
    // ┌─ 卡面 §⑥ 判据（Issue #1061，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-1 · 一页纸偏离只告警不拦截
    // │ - [ ] `strict` 下缺指针的报告**被拒**（穿生产入口）
    // │ - [ ] **GS-08 断言 3 → 4 且能红**（给两段原始输出：正常绿 / 故意缺指针红）
    // │ - [ ] `bash scripts/golden-scenarios/run.sh GS-08` ⇒ **exit = 0**（原卡判据命令，保留）
    // │ - [ ] 反例（改坏即红）：把 `strict` 分支改成只告警 ⇒ 必红
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'bash scripts/golden-scenarios/GS-08-report-readable/run.sh', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-1',
  },
  {
    id: '1-2',
    worker: 'win', batch: '第1批', block: 'K7',
    title: '输出契约不可版本化',
    paths: [
      'src/l3/report-templates.ts',
      'extensions/reports/contracts/',
      'tests/l3/report-contract-versioned.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #1062，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-2 · 输出契约不可版本化
    // │ - [ ] **改 yml 不改代码** ⇒ 槽位标题/必填项**随文件变**（穿生产入口）
    // │ - [ ] 删掉 yml ⇒ 回落 TS 常量（fallback 生效，不崩）
    // │ - [ ] 反例（改坏即红）：在 yml 里把某槽位标必填 ⇒ 缺该槽位的报告必被拦
    // │ - [ ] `npx vitest run tests/l3/report-contract-versioned.test.ts` ⇒ **exit = 0**（原卡判据命令，保留）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/l3/report-contract-versioned.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-2',
  },
  {
    id: '1-3',
    worker: 'win', batch: '第1批', block: 'K7',
    title: '客户模板位只有"报告"一种',
    paths: [
      'src/l3/report-template-loader.ts',
      'extensions/reports/',
      'tests/l3/report-template-client.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['1-1', '1-2'],
    // 📌 CTO 2026-10-08 裁定（1-3）：**以 §⑥ 为准 ⇒ 判据文件名 = `tests/l3/report-template-client.test.ts`**（本卡创建）。
    //   理由：判据是验收口径、**写集服务于判据**；两候选在 main 均不存在 ⇒ 必须新建；命名取 `client` 更贴本卡主题（「客户模板位」）。
    // ┌─ 卡面 §⑥ 判据（Issue #1063，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-3 · 客户模板位只有"报告"一种
    // │ - [ ] 客户丢入其一页纸 ⇒ **按其版式渲染**；缺必填 → **被拦**
    // │ - [ ] 反例（改坏即红）：把"缺必填被拦"改成只告警 ⇒ 判据必红
    // │ - [ ] `npx vitest run tests/l3/report-template-client.test.ts` ⇒ **exit = 0**（原卡判据命令，保留）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/l3/report-template-client.test.ts', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（1-3）：判据文件名 = `tests/l3/report-template-client.test.ts`（判据交付物，本卡创建）
    //   ⇒ 写集与 §⑥ 判据**同路径**；卡面 #1063 §④ 已同步订正（同一条纪律：卡面说错了也要改）
    status: 'todo',
    source: '施工单.md 1-3',
  },
  {
    id: '1-4',
    worker: 'win', batch: '第1批', block: 'K6',
    title: '目标"传导到每个人"',
    paths: [
      'src/growth/goal-types.ts',
      'src/growth/goal-store.ts',
      'tests/growth/goal-propagation.test.ts',
    ],
    dependsOn: [],
    // CTO 2026-10-08 裁定（内部自不一致 #3）：第 2 条原写列 `node_type` —— **该列不存在**，真列名 = `type`
    //   （`src/adapters/sqlite-graph-store.ts:25` `type TEXT NOT NULL`；`src/growth/goal-store.ts:262` 自述「列名实测为 `type`」）⇒ 已订正。
    //   ⚠️ 卡面 §⑥ V2 原话即「实测原文不可跑」，本条第 2 项即其「收窄后可跑形态」，并改用 `expectRowsGt`（非 grep）。
    // ┌─ 卡面 §⑥ 判据（Issue #1058，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-4 · 目标"传导到每个人"
    // │ - [ ] `V1` **穿生产入口**：`npx vitest run tests/growth/goal-propagation.test.ts` ⇒ exit 0（三路径：正常 = 3 成员 ⇒ 3 个 `GOAL_ASSIGNMENT` 节点、`coverage 3/3`；降级 = store 不可用 ⇒ `log.error` + `degraded=true` 不抛；边界 = 目标不存在 / 成员空集 / 重复成员 ⇒ 拒绝码 + 去重）
    // │ - [ ] `V2` **Done 判据（原卡逐字保留）**：`sqlite3 data/synova.db "SELECT COUNT(*) FROM graph_nodes WHERE node_type LIKE 'goal%'"` ⇒ **rows(graph_nodes) > 0**；**收窄后可跑形态**（实测原文不可跑，见 §②）：临时库上 `COUNT(graph_nodes WHERE type LIKE 'goal%') > 0`
    // │ - [ ] `V3` **变异体锚点**：真实库上「`GOAL_ASSIGNMENT` 增量 = 成员数」（去掉传导调用即 0 ⇒ 测试必红）
    // │ - [ ] **反例（改坏即红）**：把传导调用移除 / 节点 `type` 前缀改成非 `goal` ⇒ `V1`+`V2` 必红
    // │ - [ ] **待复核项（裁前不得勾）**：`assignedTo` 生产消费面 + "上级目标 → 子目标"边（§②/§③-6）
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/growth/goal-propagation.test.ts', expectExit: 0 },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM graph_nodes WHERE type LIKE \'goal%\'"', expectRowsGt: { table: 'graph_nodes', n: 0 } },
    ],
    // GitHub CLOSED；交付 `5386daa63`（PR #1204）已入 main ⇒ 按 GitHub 订正。⚠️ 卡面 §⑥ 列「待复核项（裁前不得勾）」
    status: 'done',
    source: '施工单.md 1-4',
  },
  {
    id: '1-5',
    sharedWrite: ["3-7: src/routes/diagnosis.ts（1-5 消费 customer-config，3-7 接 Agent 化触发；须串行）"],
    worker: 'win', batch: '第1批', block: 'K7',
    title: 'customer-config 只解析不消费',
    paths: [
      'src/routes/diagnosis.ts',
      'tests/routes/customer-config-consumed.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #1064，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-5 · customer-config 只解析不消费
    // │ - [ ] `V1` **穿生产入口**：`npx vitest run tests/routes/customer-config-consumed.test.ts` ⇒ exit 0
    // │ - [ ] `V2` **施工单原判据（行为型）**：**同 `orgId` 两个包（一个禁用某专家）⇒ 该专家不参与**；对照组（不禁用）⇒ 该专家参与。**不得以 SSE 事件存在代替参与集断言**
    // │ - [ ] `V3` **无配置回归**：无 `customer-config/{orgId}` 包 ⇒ 专家集与今日一致（default 行为）+ 诊断正常完成（不硬失败）
    // │ - [ ] `V4` **降级**：非法配置值 / 命名空间非对象 ⇒ 回退全量专家 + `log.warn`，诊断不中断
    // │ - [ ] **反例（改坏即红）**：把客户配置消费调用删掉 / 把禁用集读成启用集 ⇒ `V2` 必红
    // │ - [ ] **隔离（必查）**：跑 A 客户禁用配置后，B 客户的专家集**不受影响**（不得污染全局单例）
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/routes/customer-config-consumed.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-5',
  },
  {
    id: '1-6',
    worker: 'win', batch: '第1批', block: 'K8',
    title: 'TraversalPermissionFilter 零接线',
    // 卡面 §④；中间两条为「接线必碰（至少 1 处）」；判据文件由 `traversal-permission.test.ts` 订正为既有 `-filter.test.ts`
    paths: [
      'src/l4/traversal-permission-filter.ts',
      'src/agent/diagnosis-launcher.ts',
      'src/sentinel/sentinel-loader.ts',
      'tests/l4/traversal-permission-filter.test.ts',
    ],
    dependsOn: [],
    // 判据文件名订正（卡面 §⑤ 自陈「`tests/l4/traversal-permission.test.ts` **该文件不存在**，须按 §③ 约束 6 收敛后执行」）：
    //   ⇒ 改用既有 `tests/l4/traversal-permission-filter.test.ts`（main 实测存在，295 行 / 26 断言）。
    // ┌─ 卡面 §⑥ 判据（Issue #1066，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-6 · TraversalPermissionFilter 零接线
    // │ - [ ] `V1`（**施工单原文，行为判据**）：**两个不同 `department` 用户查同一图，返回节点集不同**——须给出两个 `UserContext`（`department` 不同、其余相同）的**节点集合差异输出**（不是断言布尔）；**接口形态 = 裁定后的 `filterNodes(userContext, nodes[])`**（§③ 约束 1）
    // │ - [ ] `V2`（**登记件 `acceptance` 原文**）：`npx vitest run tests/l4/traversal-permission.test.ts` ⇒ **exit = 0**（⚠️ 该文件不存在，须按 §③ 约束 6 收敛后执行）
    // │ - [ ] `V3` **穿生产入口**：从**真实入口**（诊断 `POST /api/diagnosis/consult` 或哨兵 `Sentinel.check()` 一轮）触发，证明过滤真的发生在链上——**禁 grep 型判据**
    // │ - [ ] `V4` `userContext` 非空转：`department` 过滤在**至少一条**生产路径上取到真实值（对应 §③ 约束 5；反例基线 = 坏点 9 知识权限过滤"接了但恒不生效"）
    // │ - [ ] `V5` admin 豁免仍成立：`role='admin'` ⇒ 节点集与未过滤结果**完全一致**（`isNodeAllowed:157` 语义不被接线破坏）
    // │ - [ ] `V6` 无悬挂引用：裁剪后 `edges` 中**每条边的 `from`/`to` 都在 `nodes` ∪ `startIds` 内**（约束 ② ）
    // │ - [ ] `V7` **反例（改坏即红）**：把接入的过滤调用去掉 ⇒ `V1` 必红（两个 department 返回同一集合）
    // │ - [ ] `V8` **反例（改坏即红）**：把 `isNodeAllowed:165-170` 的 department 分支注释掉 ⇒ `V1` 必红
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/l4/traversal-permission-filter.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-6',
  },
  {
    id: '1-7',
    worker: 'win', batch: '第1批', block: 'K1',
    title: '多岗位执法只在 1 处',
    // 卡面 §④；`src/routes/` 收窄为 5 个具名文件；`src/middleware/rbac.ts` **接口冻结后才可碰**
    paths: [
      'src/routes/workspaces-api.ts',
      'src/routes/workspace-data.ts',
      'src/routes/actions-api.ts',
      'src/routes/workspace.ts',
      'src/routes/department-workspace.ts',
      'src/middleware/rbac.ts',
      'tests/security/rbac-all-routes.test.ts',
    ],
    sharedWrite: ["RB-01/RB-03: src/middleware/rbac.ts（同文件，须串行 —— RB 系列落地前本项不动该文件）"],
    dependsOn: ['0-9'],
    // ┌─ 卡面 §⑥ 判据（Issue #1051，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-7 · 多岗位执法只在 1 处
    // │ - 🔴 **原判据作废**：`npx vitest run tests/security/rbac-all-routes.test.ts` ⇒ exit = 0 —— **姿态受限（DevMode 恒绿）**，不得单独作为完成判据（保留为回归锁，非完成判据）。
    // │ - [ ] `V1` **出货姿态**（`DEV_MODE=false` + `JWT_SECRET`）下，**每个**工作区路由匿名请求 ⇒ **403**：
    // │   `GET /api/workspaces`、`GET /api/workspaces/:id`、`GET /api/workspaces/by-dept/:dept`、`GET /api/workspaces/conflicts`、`GET /api/workspaces/mine`、`GET /api/workspaces/:id/context`、`PUT /api/workspaces/:id/*`、`POST /api/workspaces/:id/*`
    // │ - [ ] `V2` **匿名不得探存在性**：不存在的 `:id` + 匿名 ⇒ **403（不是 404）**
    // │ - [ ] `V3` **遮蔽消除**：`GET /api/workspaces/mine` 与 `/conflicts` **命中各自 handler**（非被 `/:id` 吞掉）
    // │ - [ ] `V4` **DevMode 无 secret ⇒ 不得返回真实工作台数据**（四姿态矩阵逐格可辨）
    // │ - [ ] `V5` **反例（改坏即红）**：删掉任一 `requireVerifiedRbac` 守卫 ⇒ 该路由匿名必 200/404；把 `/:id` 移回具体路径之前 ⇒ `V3` 必红
    // │ - [ ] `V6` 回归锁（非完成判据）：`npx vitest run tests/security/rbac-all-routes.test.ts` ⇒ exit = 0
    // │ - **判定人**：K3 / 独立复核（执行方不得自判）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/security/rbac-all-routes.test.ts', expectExit: 0 },
    ],
    // ⚠️ 待裁（CTO）：卡面 §⑤ 新增 `1-7bis` 接口冻结 = 🔴 硬阻塞；登记件列 0-9 ⇒ 未裁故**保留原值**（0-9 本轮回填为 active）
    status: 'todo',
    source: '施工单.md 1-7（⚠️ CTO 实测：origin/main 已修 rbac.ts:133-139）',
  },
  {
    id: '1-8',
    worker: 'win', batch: '第1批', block: 'K4',
    title: '1-8 落权威文档15 已给的 5 条预估值，其余标 unknown；【零阻塞】',
    paths: [
      'extensions/ontology/edge-types/*.json',
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #987，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-8 落权威文档15 已给的 5 条预估值，其余标 unknown；【零阻塞】
    // │ - [x] 「有 `action_effect_lag` 的边 0 → 55」⇒ **实测 55/55**（命令与输出见 §②）
    // │ - [x] CI 断言存在且带回归防线（`check-ontology-fields.sh` + 测试进 CI）
    // │ - [x] 改坏即红：删任一 edge-type 的 `action_effect_lag` ⇒ exit 1（脚本自述判别性，卡 #1015 G-1 Done 原文）
    // │ - **⇒ 处置建议（需 CTO 裁）**：核实"5 条预估值是否与 E-05/E-07/E-13/E-23/E-37 逐条对应"后**关闭本卡**；若值有偏差则只补值，不再重做字段。
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实哨兵，断言它读到该字段
      { run: 'npx vitest run tests/sentinel/edge-lag-consumed.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-8 / 现状报告 W3',
  },
  {
    id: '1-9',
    worker: 'win', batch: '第1批', block: 'K4',
    title: '1-9 给缺字段的 10 条边补 transfer_function；【零阻塞】',
    paths: [
      'extensions/ontology/edge-types/*.json',
    ],
    dependsOn: ['1-8'],
    // ┌─ 卡面 §⑥ 判据（Issue #988，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：1-9 给缺字段的 10 条边补 transfer_function；【零阻塞】
    // │ - [x] 「有该字段比例 45/55 → 55/55」⇒ **实测 55/55**（命令与输出见 §②）
    // │ - [x] CI 断言存在：`scripts/control-tower/check-ontology-fields.sh`（必查字段集含 `transfer_function`），测试进 CI（`ci.yml:594` / `:1124`）
    // │ - [ ] 🔴 **剩余**：3 条公式的参数抽进参数清单（依赖 2-2）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      // 🔴 原为纯 grep 型 ⇒ 改为穿生产入口：跑一次方向监测，断言参数【改变了输出】
      { run: 'npx vitest run tests/loops/direction-monitor.transfer-function.test.ts', expectExit: 0 },
    ],
    // ⚠️ 待裁（CTO）：卡面 §⑤ 称剩余部分落点 = 2-2 参数清单；登记件列 1-8 ⇒ 口径级差异，未裁故**保留原值**
    status: 'todo',
    source: '施工单.md 1-9 / 现状报告 W2',
  },

  // ───────────────── 第 2 批 · 地基 ─────────────────
  {
    id: '2-1a',
    worker: 'win', batch: '第2批', block: 'K3',
    title: '测量值时序 · 表定义（承重件 W1 的 schema 侧）',
    paths: [
      'src/store/',
      'tests/store/metric-readings-schema.test.ts',  // 判据交付物（本卡创建）
          'tests/store/metric-readings-insert.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    createsTable: {
      name: 'metric_readings',
      // 创始人 2026-10-04 裁 A：**目的是让需求能实现**，故：
      //    13 字段不是全 NOT NULL —— 3 个无生产者的字段降为可空 + degrade 语义。
      //    依据（T9 物证，我复现）：13 字段全 NOT NULL 时
      //      建表 exit 0 ｜ 按 2-1b 意图只填 archive/25 的 10 字段
      //      ⇒ exit 19 NOT NULL constraint failed: metric_readings.run_id
      //    ⇒ 表能建、写不进 = 不可用。降可空后能建且能写，缺口留在 degraded 标记（铁律 24/31）。
      //    注：三个字段的原生场景是 03 号 measurements 表，不是 archive/25 metric_readings；
      //        合并两张表是否成立仍需另裁 —— 本件先保证写入路径可用。
      // ── CTO 裁定 R4（2026-10-08 回填）：metric_readings = **17 列（含 id）**／不含 id 为 16 列 ──
      //   R4 依据 = archive/25 的 14 列 + `run_id` / `input_digest` / `def_version` 三个可空降级列。
      //   原登记件只列 13 字段（缺 `id` / `unit` / `source_id` / `evidence_ref`）⇒ 本处补齐到 17。
      //   🔴 本字段被门禁 INV-1 直接消费 ⇒ 改动等于改判据源（PR 正文已写明「CTO 裁定 R4」并附 17 列清单）。
      //   ── CTO 2026-10-08 补裁（第 5 条）：NULL 约束分列，**定死如下** ──
      //     17 列 = archive/25 的 14 列（**各自按原始 DDL 的约束**）
      //           + R4 的【3 个可空降级列】= `run_id` / `input_digest` / `def_version`
      //     ⇒ `nullableDegradedFields` = ['run_id','input_digest','def_version']（**不是** `unit`/`source_id`/`evidence_ref`）
      //     `unit` / `source_id` / `evidence_ref` 属 archive/25 的**原始 14 列**，其约束**以 archive/25 的 DDL 为准**
      //       ⇒ 不在可空降级集，列入 `notNullFields`（`id` = 主键）。
      //     ⚠️ 本字段被门禁 INV-1 直接消费 ⇒ 分列错会污染判据，故此处按裁定定死、不再留「待实现为准」的模糊表述。
      notNullFields: [
        // R4 新增 4 列（原登记件缺）：`id`（主键）+ archive/25 的 `unit` / `source_id` / `evidence_ref`
        'id', 'org_id', 'metric_id', 'entity_id', 'value', 'unit', 'observed_at',
        'source_type', 'source_id', 'is_estimated', 'confidence', 'evidence_ref',
        'degraded', 'created_at',
      ],
      // 可空 + degrade 语义（无生产者，不得要求 NOT NULL）。
      // 写入侧行为：缺则填 null 且把该行 degraded = 1（禁静默 —— 铁律 24/31）。
      nullableDegradedFields: ['run_id', 'input_digest', 'def_version'],
      fieldProducers: {
        id: "run: SQL 主键（TEXT PRIMARY KEY）—— 由写入侧生成，无需应用层生产者（R4 新增列）",
        unit: "[known-gap] 计量单位 —— 生产者待 2-1b 补（R4 新增列；卡面 §③ 未列入「必填 10 列」）",
        source_id: "[known-gap] 来源标识（具体来源 id）—— 生产者待 2-1b 补（R4 新增列）",
        evidence_ref: "[known-gap] 证据引用 —— 生产者待 2-1b 补（R4 新增列）",
        org_id: "producer: 2-1b（哨兵写入侧从调用上下文取 orgId；宪章 H2 强制不得留空）",
        metric_id: "producer: 2-1b（与参数清单 2-2 的 param_id 对齐；archive/25:142 U2）",
        entity_id: "producer: 2-1b（单元粒度，默认 * ；X10 的 N 个单元样本靠它）",
        value: "producer: 2-1b（compute 的输出值；archive/25 值字段）",
        observed_at: "producer: 2-1b（取值时点，非写入时点；archive/25）",
        source_type: "producer: 2-1b（来源枚举 compute/42edge/manual/connector；⚠️ 与 03 的 source 自由串待归一）",
        is_estimated: "run: 2-1b 写入侧填（默认 0，权威文档15 §3.5）",
        confidence: "run: 2-1b 写入侧按权威文档15 §3.5 填（默认 medium）",
        degraded: "run: 2-1b 写入侧按铁律 24/31 填（降级必须显式）",
        created_at: "run: SQL DEFAULT datetime now —— 无需应用层生产者",
        run_id: "[known-gap] 运行期上下文（03:191）—— 可空 + degrade；生产者待 2-1b 补",
        input_digest: "[known-gap] 输入快照摘要（03:193）—— 可空 + degrade；生产者待补",
        def_version: "[known-gap] 该指标定义/公式版本 —— 可空 + degrade；依赖 2-6 契约注册表（W4=纯缺口）",
      },
    },
    // ┌─ 卡面 §⑥ 判据（Issue #1053，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：2-1a · 测量值时序 · 表定义（承重件 W1 的 schema 侧）
    // │ - [ ] `V1` 真库表结构：`sqlite3 data/synova.db ".schema metric_readings"` ⇒ **1 表 + 3 索引 + 17 列**
    // │ - [ ] `V3` 幂等：同 `(org_id, metric_id, entity_id, observed_at)` 连写两次 ⇒ 行数仍为 **1**
    // │ - [ ] `V5` 只追加：`git grep "UPDATE metric_readings\|DELETE FROM metric_readings" origin/main -- src/ packages/` ⇒ **零命中**
    // │ - [ ] `V6` 删除安全：删表后报 `no such table`，且**哨兵仍能跑**（降级不崩，宪章 10.3）
    // │ - [ ] 单测（**补充，不得单独作为完成判据**）：`npx vitest run tests/store/metric-readings-schema.test.ts` / `-insert.test.ts` ⇒ exit 0
    // │ - **反例（改坏即红）**：删掉唯一索引 ⇒ `V3` 必红；任一可空列改回 NOT NULL ⇒ 写入路径必红
    // │ - **判定人**：K3 / 独立复核（执行方不得自判）
    // └─ 抄录结束 ┘
    acceptance: [
      {
        run: 'npx vitest run tests/store/metric-readings-schema.test.ts',
        expectExit: 0,
      },
      // 治 T9 物证「表能建、写不进」：必须实测【写入路径可用】，不是只验建表
      {
        run: 'npx vitest run tests/store/metric-readings-insert.test.ts',
        expectExit: 0,
      },
    ],
    // CTO 裁定 R1（2026-10-08 回填）：2-4 / 2-6 **解耦**（门禁管「写入」归 2-1b；`def_version` 已裁可空降级）⇒ dependsOn = []
    status: 'todo',
    source: '施工单 2-1（拆自 2-1，按 DSH 式「一能力一包」：schema 与 writer 分离，只通过 INSERT 契约相连）',
  },

  {
    id: '2-1b',
    sharedWrite: ["3-8: src/sentinel/（2-1b 加写入侧，3-8 加新哨兵；同目录须串行）", "0-3: src/sentinel/（C-02：0-3 兜底改 builtins.ts，同目录须串行）"],
    worker: 'win', batch: '第2批', block: 'K3',
    title: '测量值时序 · 写入侧（承重件 W1 的 writer 侧）',
    paths: ['src/sentinel/'],
    dependsOn: ['2-1a', '2-4'],
    // ┌─ 卡面 §⑥ 判据（Issue #1054，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：2-1b · 测量值时序 · 写入侧（承重件 W1 的 writer 侧）
    // │ - [ ] `V2` 真跑一次哨兵后：`sqlite3 data/synova.db "SELECT COUNT(*) FROM metric_readings WHERE observed_at > datetime('now','-1 hour')"` ⇒ **> 0**
    // │ - [ ] `V7` 能取某 `metric_id` 的 before/after 两段并算出差值（"时序是参数标定前提"的直接检验）
    // │ - [ ] 写入事件可在日志/表中观测到（非静默）
    // │ - **反例（改坏即红）**：把写入点注释掉 ⇒ `V2` 必红；把三个可空列改回 NOT NULL ⇒ 必红（NOT NULL constraint failed）
    // │ - **判定人**：K3 / 独立复核（执行方不得自判）
    // └─ 抄录结束 ┘
    acceptance: [
      {
        run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM metric_readings WHERE observed_at > datetime(\'now\', \'-1 hour\')"',
        expectRowsGt: { table: 'metric_readings', n: 0 },
      },
    ],
    // CTO 裁定 R1（2026-10-08 回填）：2-4 写入门禁 = **新增依赖**（门禁管写入）⇒ dependsOn = ["2-1a","2-4"]
    status: 'todo',
    source: '施工单 2-1（拆自 2-1）；写入侧 = src/sentinel（mac 域，archive/25 §三：只这三个写入点）',
  },
  {
    id: '2-2',
    worker: 'win', batch: '第2批', block: 'K5',
    title: '参数清单（含 W5 两层结构 layer 字段）—— 2-5 已并入本项',
    paths: ['docs/synova/coordination/'],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #1047，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：2-2 · 参数清单（含 W5 两层结构 layer 字段）—— 2-5 已并入本项
    // │ - [ ] 清单覆盖**五域 + 元参数 8 条**（计数命令 + 数字写进回执）
    // │ - [ ] **L0（可跨客户）参数 ≥1 条且有依据**
    // │ - [ ] `layer` 字段四层齐；命名**只有一套**（`grep` 两套命名 ⇒ 必红）
    // │ - [ ] `npx tsx docs/synova/coordination/tools/check-param-list.ts` ⇒ **exit = 0**（原卡判据命令；⚠️ 该脚本**不存在**，属本卡待建 —— 建后此判据方生效；未建前以 §⑥ 前两条为准）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      {
        run: 'npx tsx docs/synova/coordination/tools/check-param-list.ts',
        expectExit: 0,
      },
    ],
    // CTO 裁定 R1（2026-10-08 回填）：2-1a / 2-6 **解耦**（施工单原文「与 2-1 并行」优先；2-6 仅命名口径参考）⇒ dependsOn = []
    status: 'todo',
    source: '施工单 2-2 + 2-5 合并（同一份产物：清单本体 + 其 layer 字段；按选项①「不是独立项，是产物与字段」）',
  },
  {
    id: '2-3',
    sharedWrite: ["0-2: src/growth/feedback-collector.ts（同上）"],
    worker: 'win', batch: '第2批', block: 'K6',
    title: '反馈两通道分裂 + 正向值被 DDL 拒',
    // 卡面 §④「实际落点，实测」；原 `packages/evolution/` 已删（该目录属 3-12 的 global-analyzer.ts）
    paths: [
      'src/growth/feedback-collector.ts',
      'tests/growth/feedback-channel-unification.test.ts',
    ],
    dependsOn: [],
    // CTO 2026-10-08 裁定（内部自不一致 #4）：原判据 `sqlite3 … | grep -qv ^0$` 与 #1295（D1226「禁用 grep -qv 逐行取反」，OPEN）同族
    //   ⇒ 已换成**等价可判写法**：第 1 项 = 卡面 §⑥ V1 逐字命令（经生产入口 `collectFeedback` + `createEvolutionChannelSink` 写入 decision=confirm 且读得回）；
    //   第 2 项 = 原 SQL 保留 + 改用 `expectRowsGt`（结构性期望，无 grep）。
    //   ⚠️ 卡面 §⑥ V3「回滚」为 **P14 硬要求、当前 main 必红**（迁移末尾 DROP 旧表、无 `feedback_log_pre_k6_confirm_decision` 副本）——非命令型，见下方抄录。
    //   📌 CTO 2026-10-08 裁定（2-3）：P14 回滚**正式写入本项完成标准**（不是可选增强）。
    //     判据 = ① 迁移前副本存在（同 commit、同一份数据）② 按旧 CHECK 反向重建**可成功**。
    //     依据：宪章 P14「改与退必须是同一份数据」是**硬要求**（与 R5 / D1 一致）。
    // ┌─ 卡面 §⑥ 判据（Issue #1059，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：2-3 · 反馈两通道分裂 + 正向值被 DDL 拒
    // │ - [ ] `V1` **正反馈可写入（原判据语义，可跑形态）**：`npx vitest run tests/growth/feedback-channel-unification.test.ts` ⇒ exit 0；断言"经生产入口（`collectFeedback` + `createEvolutionChannelSink`）写入 `decision='confirm'` 成功且读得回"
    // │ - [ ] `V2` **迁移正确性**：旧 CHECK 库（无 `'confirm'`）→ `setDatabase()` 触发迁移 ⇒ ①写入 `confirm` 成功；②`schema_version` 含 `k6_confirm_decision`；③**存量行零丢失**（迁移前后行数相等）；④**幂等**（再跑一次迁移零副作用）
    // │ - [ ] `V3` **回滚（P14 硬要求，当前必红）**：迁移后执行回滚 ⇒ ①**行数一致**；②**内容逐行一致**（用**同一份副本** `feedback_log_pre_k6_confirm_decision` 恢复**同一张表、同一份数据**）；③"反向重建被旧 CHECK 拒"的路径**不再被触发**（§④ 硬要求 4 的物证）
    // │       - **反例（改坏即红）①**：删掉 `feedback_log_pre_k6_confirm_decision` 副本（或迁移末尾 `DROP` 后不落副本）⇒ 回滚**必红**（**当前 main 即此形态，`V3` 现为红**——§② 实测：迁移后旧表被 DROP，无 `*_pre_k6*` 备份表）
    // │       - **反例（改坏即红）②**：用"归档到 `agent_memory` 再重建"顶替"同一份数据"⇒ 内容比对**必红**（载体不同 = 两份数据 = 宪章 P14 原病，`产品宪章.md:129`）
    // │ - [ ] **反例（改坏即红）**：把 `'confirm'` 从 `FEEDBACK_DECISIONS` 删掉 ⇒ 新库写入被 CHECK 拒 ⇒ `V1` 必红；删掉 schema_version 守卫 ⇒ 迁移幂等用例必红
    // │ - [ ] **不得用 grep 型判据**：`git grep "confirm"` 命中 ≠ 生效；必须真写入 + 读回
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      // P14-① （CTO 2026-10-08 裁）：迁移前副本表存在且非空（= 同一份数据的载体）。
      //   ⚠️ 该表在**迁移之后**才存在；当前 main 尚未实现 ⇒ 本条**现为红**（预期，由本卡修）。
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM feedback_log_pre_k6_confirm_decision"', expectRowsGt: { table: 'feedback_log_pre_k6_confirm_decision', n: 0 } },
      // P14-② （CTO 2026-10-08 裁）：按旧 CHECK 反向重建**可成功** + 行数/内容逐行一致
      //   ⇒ 由 V1 同一夹具的回滚用例断言（卡面 §⑥ V3；反例②：换载体「归档到 agent_memory 再重建」⇒ 必红）。
      { run: 'npx vitest run tests/growth/feedback-channel-unification.test.ts', expectExit: 0 },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM feedback_log WHERE decision=\'confirm\'"', expectRowsGt: { table: 'feedback_log', n: 0 } },
    ],
    status: 'todo',
    source: '施工单.md 2-3',
  },
  {
    id: '2-4',
    sharedWrite: ["0-11: src/tools/tool-registry.ts（同上）"],
    worker: 'win', batch: '第2批', block: 'K2',
    title: '写入门禁两道未接（是 2-1 的前提）',
    paths: ['src/security/file-guard.ts', 'src/tools/tool-registry.ts'],
    dependsOn: ['0-11'],
    // ┌─ 卡面 §⑥ 判据（Issue #1052，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：2-4 · 写入门禁两道未接（是 2-1 的前提）
    // │ - [ ] 未授权写入**被拒**（不是静默通过）+ **审计留痕**（两样都要）
    // │ - [ ] 反例（改坏即红）：把拒绝分支改成 `return true` ⇒ 判据必红
    // │ - [ ] 两个不同权限用户行为**不同**（穿生产入口，非 grep）
    // │ - [ ] `npx vitest run tests/security/file-guard.test.ts` ⇒ **exit = 0**（原卡判据命令，保留）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/security/file-guard.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 2-4',
  },
  {
    id: '2-6',
    worker: 'win', batch: '第2批', block: 'K5',
    title: 'compute 契约注册表不存在（承重件 W4）',
    paths: [
      'src/contract/',
      'scripts/control-tower/probe-compute-registry.ts',  // 判据交付物（本卡创建）
    ],
    // 与 PL-04（三层契约）同占 src/contract/ ⇒ 显式声明共写（须串行）
    sharedWrite: ["PL-04: src/contract/（同上）"],
    // ✅ 落点已裁（选项①）：施工单原只写"新建…解析器"未给目录；src/contract/ 已存在（win 域）
    dependsOn: [],
    // ⚠️ 待裁（CTO，C-13）：卡面 §⑥ 以「断言明确（解析成功 + 调用成功，两步）」取代 `expectStdoutContains: COMPUTE-HHI-v1`；未裁故**保留原值**，见 PR §保留待裁。
    // ┌─ 卡面 §⑥ 判据（Issue #1048，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：2-6 · compute 契约注册表不存在（承重件 W4）
    // │ - [ ] `npx tsx scripts/control-tower/probe-compute-registry.ts` ⇒ exit 0，且**断言明确**（解析成功 + 调用成功，两步都要）
    // │ - [ ] 反例（改坏即红）：把某个契约 ID 从注册表删掉 ⇒ 探针必红；注册表指向不存在的实现 ⇒ 必红（禁静默）
    // │ - [ ] 计数口径写进本卡（口径名 + 命令 + 数字）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-compute-registry.ts', expectStdoutContains: 'COMPUTE-HHI-v1' },
    ],
    status: 'todo',
    source: '施工单.md 2-6（⚠️ 先定计数口径 U-4）',
  },
  {
    id: '2-7',
    worker: 'win', batch: '第2批', block: 'K5',
    title: 'overall 准度计量口径（"越用越准"的可测判据）',
    paths: ['docs/synova/coordination/tools/'],
    dependsOn: ['2-1b', '2-2', '2-3'],
    // ┌─ 卡面 §⑥ 判据（Issue #1049，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：2-7 · overall 准度计量口径（"越用越准"的可测判据）
    // │ - [ ] 能给出**一条可复核的准度变化证据链**（含：取自哪段时序、与什么比、结论怎么算出来）
    // │ - [ ] 反例（改坏即红）：把时序数据抽掉一段 ⇒ 证据链必须失效（不是照样给结论）
    // │ - [ ] `npx tsx docs/synova/coordination/tools/probe-accuracy-trend.ts` ⇒ **exit = 0**（原卡判据命令；⚠️ 该脚本**不存在**，属本卡待建 —— 建后此判据方生效；未建前以证据链可复核性为准）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      {
        run: 'npx tsx docs/synova/coordination/tools/probe-accuracy-trend.ts',
        expectExit: 0,
      },
    ],
    // ⚠️ 待裁（CTO）：卡面 §⑤ 列 2-1a / 2-1b；登记件仅 2-1b ⇒ 口径级差异，未裁故**保留原值**
    status: 'todo',
    source: '施工单 2-7（原「补在哪」栏为空 ⇒ 按选项①改为「口径判据脚本」，落 CTO 域 —— 它是判据不是产品功能）',
  },

  // ───────────────── 第 3 批 · 新建 ─────────────────
  {
    id: '3-1',
    worker: 'win', batch: '第3批', block: 'K9',
    title: '角色预设包（Role Pack）',
    paths: [
      'docs/synova/presets/roles/',
      'scripts/control-tower/probe-role-pack.ts',  // 判据交付物（本卡创建）
    ],
    // ✅ 落点已裁（选项③）：用 docs/synova/presets/** 既有规则（=mac）
    //    ⚠️ 若改判为根级 presets/roles/**（=win），须先在 ownership.yaml 补规则 —— 门禁语义变更，必过 K3
    dependsOn: ['0-9bis', '1-2'],
    // ┌─ 卡面 §⑥ 判据（Issue #1068，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-1 · 角色预设包（Role Pack）
    // │ - [ ] 3 个岗位各有预设包（目录 + 五件套齐）
    // │ - [ ] **`knowledge_scope` 真生效**：两个不同岗位用户 ⇒ 拿到的知识集合**不同**（穿生产入口）
    // │ - [ ] 反例（改坏即红）：把某岗位的 `knowledge_scope` 删掉 ⇒ 判据必红
    // │ - [ ] `npx tsx scripts/control-tower/probe-role-pack.ts --role finance` ⇒ **exit = 0**（原卡判据命令；脚本属本卡待建）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-role-pack.ts --role finance', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-1',
  },
  {
    id: '3-2',
    worker: 'win', batch: '第3批', block: 'K8',
    title: '岗位级知识层（第四层）',
    paths: [
      'src/l4/knowledge-store.ts',
      'tests/l4/knowledge-scope.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['0-9bis'],
    // ┌─ 卡面 §⑥ 判据（Issue #1067，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-2 · 岗位级知识层（第四层）
    // │ - [ ] 两个不同岗位用户查同一知识库 ⇒ 返回集合**不同**（穿生产入口，非 grep）
    // │ - [ ] 反例（改坏即红）：把 `colMap` 映射删掉 ⇒ 判据必红
    // │ - [ ] `npx vitest run tests/l4/knowledge-scope.test.ts` ⇒ **exit = 0**（原卡判据命令，保留）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/l4/knowledge-scope.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-2',
  },
  {
    id: '3-3',
    worker: 'win', batch: '第3批', block: 'K9',
    title: '建档通道（"建档" 0 命中）',
    paths: [
      'src/onboarding/',
      'scripts/control-tower/probe-onboarding.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['3-1', '3-2'],
    // ┌─ 卡面 §⑥ 判据（Issue #1069，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-3 · 建档通道（"建档" 0 命中）
    // │ - [ ] 丢一批文档 ⇒ 产出**一份基础配置包**（超管可确认）
    // │ - [ ] 六步逐段可观测（哪一步产出什么，有原始输出）
    // │ - [ ] 反例（改坏即红）：把 ③ 追问 摘掉 ⇒ 判据必红
    // │ - [ ] `npx tsx scripts/control-tower/probe-onboarding.ts --dry-run` ⇒ **exit = 0**（原卡判据命令；脚本属本卡待建）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-onboarding.ts --dry-run', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-3',
  },
  {
    id: '3-4',
    worker: 'win', batch: '第3批', block: 'K9',
    title: '追问由本体缺口驱动',
    paths: [
      'src/onboarding/gap-questioner.ts',
      'tests/onboarding/gap-questioner.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['3-3'],
    // ┌─ 卡面 §⑥ 判据（Issue #1070，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-4 · 追问由本体缺口驱动
    // │ - [ ] 给定空图 ⇒ 产出**有序**追问表
    // │ - [ ] 反例（改坏即红）：把目标 schema 的节点数改错 ⇒ 追问表必红
    // │ - [ ] `npx vitest run tests/onboarding/gap-questioner.test.ts` ⇒ **exit = 0**（原卡判据命令，保留）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/onboarding/gap-questioner.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-4（需图非空）',
  },
  {
    id: '3-5',
    worker: 'win', batch: '第3批', block: 'K4',
    title: '作业单元缺两件（实例 + 评估属性）',
    paths: ['extensions/ontology/activity/'],
    dependsOn: [],
    // CTO 2026-10-08 裁定（内部自不一致 #3 + #4）：原写列 `node_type`（不存在，真列名 `type`，`src/adapters/sqlite-graph-store.ts:25`）
    //   且用 `grep -qv ^0$`（#1295 / D1226 同族）⇒ 已同时订正：列名 → `type`；grep → `expectRowsGt`。
    // ┌─ 卡面 §⑥ 判据（Issue #1057，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-5 · 作业单元缺两件（实例 + 评估属性）
    // │ - [ ] `bash -c "sqlite3 data/synova.db \"SELECT COUNT(*) FROM graph_nodes WHERE type LIKE 'activity/%'\" | grep -qv ^0$"` ⇒ **exit = 0**（即出现 `activity/*` 节点）
    // │ - [ ] 属性非空（10 个属性至少覆盖读得到）
    // │ - [ ] 反例（改坏即红）：把实例删掉 ⇒ 判据必红
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM graph_nodes WHERE type LIKE \'activity/%\'"', expectRowsGt: { table: 'graph_nodes', n: 0 } },
    ],
    status: 'todo',
    source: '施工单.md 3-5',
  },
  {
    id: '3-6',
    sharedWrite: ["3-7: src/agent/（3-6 readiness 工具，3-7 触发链；同目录须串行）"],
    worker: 'win', batch: '第3批', block: 'K9',
    title: 'agent_readiness 工具',
    // 卡面 §④；首项实测存在；「两套技能系统（skills/ vs extensions/skills/）挂哪套待 0-12 裁定」
    paths: [
      'skills/org/agent-readiness.md',
      'extensions/skills/',
      'src/agent/',
      'scripts/control-tower/probe-agent-readiness.ts',
    ],
    dependsOn: ['3-5', '0-12'],
    // ┌─ 卡面 §⑥ 判据（Issue #1071，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-6 · agent_readiness 工具
    // │ - [ ] 给定一个作业实例 ⇒ 输出**分数 + T1–T4**
    // │ - [ ] 明确标出**哪两维是人评**
    // │ - [ ] 反例（改坏即红）：把某维度打分函数写成常数 ⇒ 判据必红
    // │ - [ ] `npx tsx scripts/control-tower/probe-agent-readiness.ts` ⇒ **exit = 0**（原卡判据命令；脚本属本卡待建）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-agent-readiness.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-6',
  },
  {
    id: '3-7',
    sharedWrite: ["1-5: src/routes/diagnosis.ts（同上）"],
    worker: 'win', batch: '第3批', block: 'K7',
    title: 'Agent 化矩阵的触发点',
    paths: [
      'src/routes/diagnosis.ts',
      'src/agent/',
      'tests/agent/agent-matrix-trigger.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['3-6'],
    // ┌─ 卡面 §⑥ 判据（Issue #1065，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-7 · Agent 化矩阵的触发点
    // │ - [ ] 诊断完成后**矩阵自动出现**（穿生产入口）
    // │ - [ ] 反例（改坏即红）：**跳过诊断直接调矩阵 ⇒ 必须被拒**（宪章 §4.7 硬纪律）
    // │ - [ ] 三类输出齐且按收益排序
    // │ - [ ] `npx vitest run tests/agent/agent-matrix-trigger.test.ts` ⇒ **exit = 0**（原卡判据命令，保留）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/agent/agent-matrix-trigger.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-7',
  },
  {
    id: '3-8',
    sharedWrite: ["2-1b: src/sentinel/（同上）", "0-3: src/sentinel/（C-02：同上）"],
    worker: 'win', batch: '第3批', block: 'K3',
    title: 'AI 化机会窗口哨兵（宪章 3.6 报正向）',
    paths: [
      'src/sentinel/',
      'extensions/sentinels/',
      'scripts/control-tower/probe-sentinel.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['3-5', '3-6'],
    // ┌─ 卡面 §⑥ 判据（Issue #1055，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-8 · AI 化机会窗口哨兵（宪章 3.6 报正向）
    // │ - [ ] `npx tsx scripts/control-tower/probe-sentinel.ts agent-opportunity-window` ⇒ exit 0，**且脚本断言明确写出**（禁止"跑通即过"）
    // │ - [ ] 出现一类「**正向发现**」产出（宪章 §3.6 要求的新类别）
    // │ - [ ] 增强阈值：人为把阈值调成不可达 ⇒ 判据**必红**（反例）
    // │ - [ ] 哨兵四问逐条有证据：加了吗 / 接上了吗 / 生效了吗 / 删干净（`sentinel-lifecycle` skill 判据源：院方 04-契约演进与机器可判性:122-131）
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-sentinel.ts agent-opportunity-window', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-8',
  },
  {
    id: '3-9',
    sharedWrite: ["3-11: extensions/（同上）"],
    worker: 'win', batch: '第3批', block: 'K9',
    title: '生态准入三字段',
    // 卡面 §④；原 `extensions/` 收窄为 manifest.json；另有「加载器接口」落点由执行方定 ⇒ pathTBD
    pathTBD: true,
    paths: [
      'extensions/**/manifest.json',
      'scripts/control-tower/probe-eco-fields.ts',
    ],
    // ✅ 落点已裁（选项③）：内容声明清单 = 扩展的声明文件，与 extensions/** 同族（win）
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #1072，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-9 · 生态准入三字段
    // │ - [ ] `V1` **判据脚本（登记件口径）**：`npx tsx scripts/control-tower/probe-eco-fields.ts` ⇒ exit 0
    // │ - [ ] `V2` **施工单原判据**：**加载器能读出三字段**——probe 必须**经加载器接口**读取（不是直接 `JSON.parse` 文件），且三字段值可打印
    // │ - [ ] `V3` **三字段语义断言**：① 可观测范围 = 声明的节点集合（非布尔）；② 背书与责任 = 有归属主体（人/角色/组织）；③ 契约兼容承诺 = 可锚定契约版本
    // │ - [ ] `V4` **向后兼容**：既有 135 个未声明三字段的 manifest ⇒ **不硬失败**，缺失走 `unknown` + `log.warn` 计数（**判据须含“改坏即红”：把缺失改成抛错 ⇒ 既有清单必红**）
    // │ - [ ] `V5`（**待裁**）**schema 落地**：是否同 commit 落 `extension-manifest-v1.json`（当前 28 处 `$schema` 指向悬空 URL）⇒ CTO 裁；未裁前 **probe 不校验 schema**，只报"字段缺失/存在"
    // │ - [ ] **反例（改坏即红）**：把三字段从加载器接口移除 ⇒ `V1`/`V2` 必红
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    // 口径订正（CTO 2026-10-08 要求写明口径；**数字复核后订正回 28**）：
    //   ‼️ 本件 dry-run 曾报「卡面 28 有误、应为 27」—— **该 27 是测量假象，卡面 28 正确**。
    //      假象成因：把 135 个 manifest 直接串接后 `grep -c`，某文件缺行尾换行 ⇒ 两处命中并成 1 行 ⇒ 少算 1。
    //   权威口径 = **口径 A（`extensions/**/manifest.json` 的【文件数】）**：
    //     `git grep -l '"$schema": *"https://synova.dev/schemas/extension-manifest-v1.json"' origin/main -- 'extensions/**/manifest.json' | wc -l` ⇒ **28**
    //     （总 manifest = 135 个；每个命中文件恰好 1 处 ⇒ 行数与文件数同值，但**只有文件数口径才抗串接假象**）
    //   另一口径 = 口径 B（全树含该 URL 的文件数）= **29**（比口径 A 多 1 个非 manifest 文件）。本件采用 **口径 A = 28**，与卡面一致。
    //   ✓ 同卡「manifest = 135」实测 135 —— 已核。
    //   📌 卡面 #1072 已同步写入本口径（数字保持 28，未改）。
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-eco-fields.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-9',
  },
  {
    id: '3-10',
    worker: 'win', batch: '第3批', block: 'K10',
    title: 'DSH 三件公共前段（出站网关 / 脱敏监听 / 双 baseURL）',
    // 卡面 §④；后两条为 CTO 2026-10-07 落点裁定（已裁可碰）
    paths: [
      '.dsh/',
      'docs/synova/research/DSH迁移施工图-20260820/',
      'scripts/control-tower/probe-egress.sh',
      'dsh/plugins/',
      'src/providers/**',
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #1050，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-10 · DSH 三件公共前段（出站网关 / 脱敏监听 / 双 baseURL）
    // │ - [ ] `V1` **探针判据（原文唯一完成标准）**：`bash scripts/control-tower/probe-egress.sh` ⇒ **exit = 0**
    // │ - [ ] `V2` **出网归零**：探针证明"无任何未走网关的 LLM/web_search 出站"（逐通道枚举，非抽样）
    // │ - [ ] `V3` **脱敏有规则**：探针证明 `sessionTelemetry/record` 监听器**已挂**且**规则集非空**；对照：不挂时记录原样出厂（`redact()` 恒等，`lib/index.js:174`）
    // │ - [ ] `V4` **双 baseURL 锁死**：只配 LLM 一条 baseURL ⇒ `web_search` **不得**独立出网
    // │ - [ ] `V5` **反例（改坏即红）**：(a) 拆掉脱敏监听 ⇒ `V3` 必红；(b) 让 `web_search` 走默认端点 ⇒ `V4` 必红；(c) 网关过滤未知 header ⇒ beta 头丢失（`mid-conversation-tool-changes-2026-07-01`），静默破裂可检出
    // │ - [ ] `V6` **不引 DSH 代码**：`git grep -n "@deepseek-ai" origin/main -- src/ packages/` ⇒ **0 命中**（借鉴 = 读范式自研）
    // │ - **判定人**：K3 / 独立复核（执行方不得自判）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'bash scripts/control-tower/probe-egress.sh', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-10',
  },
  {
    id: '3-11',
    sharedWrite: ["3-9: extensions/（3-11 加 L1.5 层，3-9 加声明三字段；同目录须串行）"],
    worker: 'win', batch: '第3批', block: 'K4',
    title: '专业包层（L1.5）机制',
    paths: [
      'extensions/',
      'src/extensions/',
      'tests/extensions/layer-precedence.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #1056，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-11 · 专业包层（L1.5）机制
    // │ - [ ] `V1`（**施工单原文**）：一个专业包装到**两个客户都生效**——同一 L1.5 专业包在两个不同 `orgId` 下均被加载命中
    // │ - [ ] `V2`（**穿生产入口**）：`npx vitest run tests/extensions/layer-precedence.test.ts` ⇒ **exit = 0**（登记件 `acceptance` 原文）
    // │ - [ ] `V3` 覆盖顺序：`custom > profession > industry > builtin` 逐层可证——构造同名键四层各一份，断言**胜出者为 custom**，且**移除 custom 后胜出者依次落到 profession → industry → builtin**
    // │ - [ ] `V4` 叠加语义 = 覆盖非替换：下层**未被覆盖的键必须保留**（宪章 P2「不是替换」）
    // │ - [ ] `V5` 反例（改坏即红）：把 L1.5 层从加载顺序中删除 ⇒ `V3` 必红（profession 层内容在任一客户下都取不到）
    // │ - [ ] `V6` 反例（改坏即红）：把覆盖语义改成"整文档替换" ⇒ `V4` 必红（下层独有键消失）
    // │ - **补充（不得单独作为完成判据）**：L1.5 包目录在 `extensions/` 下**加文件即可生效**，无需改宿主 TS（P1 判据）
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/extensions/layer-precedence.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-11',
  },
  {
    id: 'PL-04',
    worker: 'win', batch: '第2批', block: 'K5',
    title: '三层契约贯通（写入类型 ↔ 哨兵查询类型 ↔ field-mapping 白名单）',
    paths: [
      'src/contract/', 'src/adapters/', 'extensions/ontology/',
      'docs/synova/coordination/tools/probe-three-layer-contract.ts',  // 判据交付物（本卡创建）
    ],
    // PL-04 与 2-6 同占 src/contract/ ⇒ 显式声明共写（须串行）
    sharedWrite: ["2-6: src/contract/（PL-04 定三层契约形态，2-6 实现契约注册表；同目录须串行）"],
    dependsOn: ['2-6'],
    // ┌─ 卡面 §⑥ 判据（Issue #1110，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：PL-04 · 三层契约贯通（写入类型 ↔ 哨兵查询类型 ↔ field-mapping 白名单）
    // │ - [ ] `probe-three-layer-contract.ts --case cash-runway` 穿生产入口 ⇒ exit 0
    // │ - [ ] 三层类型集合**机械比对一致**（不一致即红）
    // │ - [ ] 合法写入 + 合法查询必须成功（反例：故意制造"一律拒绝" ⇒ 必红）
    // │ - [ ] 删除干净：旧白名单路径 `git grep` 零命中
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx docs/synova/coordination/tools/probe-three-layer-contract.ts --case cash-runway', expectExit: 0 },
    ],
    // 📌 CTO 2026-10-08 裁定（PL-04）：**不放宽，按登记件单文件为准**。
    //   理由：INV-4（写集互斥）是**硬不变量**；目录级放宽会与 2-2 / 2-7 / 1-7bis 制造**假阳性冲突**，
    //   而判据交付物只需一个文件。将来确需多文件 ⇒ **逐文件列出，不用目录级**（与 R21 一致）。
    status: 'todo',
    source: '边界评估/00-最终方案.md:48（领域智能 20 项之第 3 项，属【必须自建】）；创始人 2026-10-05 裁 A 归入 K5',
  },
  {
    id: '0-9bis',
    worker: 'win', batch: '第0批', block: 'K1',
    title: '知识审计不可归属（req.userId 恒 undefined ⇒ user_id 恒 anonymous）',
    paths: ['src/routes/knowledge.ts'],  // 收窄：auth.ts 归 0-9(已废) 遗留，若需改则走提案
    dependsOn: [],
    acceptance: [
      { run: "sqlite3 data/synova.db \"SELECT COUNT(*) FROM knowledge_audit WHERE user_id='anonymous'\"", expectRowsEq: { table: 'knowledge_audit', n: 0 } },
    ],
    status: 'todo',
    source: 'CTO 2026-10-05 实测：auth.ts 零处写 req.userId；knowledge.ts:40 读它并 `|| \'anonymous\'` ⇒ 审计行不可归属。取代已作废的 0-9（前提被证伪）。完成标准②须在【跑一次真 JWT 查询之后】测得',
  },
  {
    id: '1-7bis',
    worker: 'win', batch: '第1批', block: 'K1',
    title: 'RbacContext 无 org/team 维度（rbac.ts:127 department 恒 undefined）—— 接口变更，先提案',
    paths: ['docs/synova/coordination/提案/'],  // 专属子目录，避免与 2-2 写集相撞
    dependsOn: [],
    acceptance: [
      { run: 'test -f docs/synova/coordination/提案/RbacContext-org-team-维度.md', expectExit: 0 },
    ],
    status: 'proposal',
    source: '产品线 2026-10-05 独立复核四姿态实测：DevMode 无 secret 姿态下匿名 200 + 真实工作台数据 ⇒ 1-7 的守卫是身份级非越权级。根因=RbacContext 缺 org/team 维度。CTO 已批立项；**权限模型接口先冻结**（创始人 2026-10-05 裁）',
  },
  {
    id: 'K1-WH',
    worker: 'win', batch: '第0批', block: 'K1',
    title: '飞书 webhook 在硬化姿态下必然 401（生产功能不可达）',
    // 卡面 §④（段2）；`src/middleware/auth.ts` **仅当提案已批**时可碰
    paths: [
      'src/routes/im.ts',
      'src/middleware/auth.ts',
      'tests/routes/**',
      'tests/l1/**',
      'docs/synova/product-lines/evidence/**',
    ],
    sharedWrite: ["0-9(已作废): src/middleware/auth.ts（本卡接管该文件的写集）", "1-7bis: src/middleware/auth.ts（同族，须串行）"],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #1126，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：K1-WH · 飞书 webhook 在硬化姿态下必然 401（生产功能不可达）
    // │ 1. [ ] `V1` **L3 真跑**：以 `DEV_MODE=false` + 配 `JWT_SECRET` 启动，**构造一次真实飞书回调** ⇒ **不再是 401**（且回调被正确处理）
    // │ 2. [ ] `V2` **反向**：伪造签名/无签名 ⇒ **必须被拒**（证明开的是"验签"不是"开门"）
    // │ 3. [ ] `V3` **审计**：拒的那次**落审计**（可查"谁试过"）
    // │ 4. [ ] `V4` 🔴 **不许用"DevMode 下能通"声称完成**（那是掩盖，正是本卡要治的）
    // │ 5. [ ] `V5` **反例（改坏即红）**：把签名闸门短路为 `return next()` ⇒ `tests/routes/im-webhook-signature.test.ts` 必红；把 webhook 加进白名单（候选 A）⇒ `V2` 必红（无签名也 200）
    // │ 6. **判定人**：K3 / 独立复核（执行方不得自判）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/security/feishu-webhook-signature.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '产品线 K1 窗口上报 + CTO 实测（origin/main@65aa62dea）：jwtAuthMiddleware 全局挂载于 server.ts:344；isWhitelisted() 23 条不含 /api/im/feishu/webhook ⇒ 生产姿态必 401。与 1-7/1-7bis 同族（DevMode 掩盖）。🔴 修复方向不得简单加白名单（公网入口须验签）',
  },
  {
    id: 'RB-01',
    worker: 'win', batch: '第1批', block: 'K11',
    title: '多租户隔离：跨 orgId 读必须被拒（含 DevMode 姿态）',
    // 卡面 §④；第二项由 `src/middleware/rbac.ts` 订正而来；卡面写 `probe-*` 通配，此处取同域**具名**件（避免与 RB-02/03/04 的 probe 相撞）
    paths: [
      'src/middleware/auth.ts',
      'src/agent/prompt-assembler.ts',
      'scripts/control-tower/probe-rbac-multitenant.ts',
    ],
    sharedWrite: ["0-9(已作废)/1-7/K1-WH: src/middleware/auth.ts（同文件，须串行）"],
    dependsOn: [],
    // ┌─ 卡面 §⑥ 判据（Issue #1140，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：RB-01 · 多租户隔离：跨 orgId 读必须被拒（含 DevMode 姿态）
    // │ - [ ] **L3 真跑**：以 A 客户身份读 B 客户数据 ⇒ **被拒**（返回明确拒绝，不是空集）
    // │ - [ ] **DevMode 姿态**同样被拒（单独一条）
    // │ - [ ] 拒绝**落审计**
    // │ - [ ] 反例（改坏即红）：把拒绝改成"返回空集" ⇒ 判据必红
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-rbac-multitenant.ts --case cross-org', expectExit: 0 },
    ],
    status: 'todo',
    source: '创始人 2026-10-05：「DevMode 这个肯定是不允许的」+「云端服务肯定是不能 A 客户读 B 客户数据」。判据须在【硬化姿态】与【DevMode 姿态】各跑一次（构造跨 orgId 请求 ⇒ 必被拒），不依赖"真有第二个租户"',
  },
  {
    id: 'RB-02',
    worker: 'win', batch: '第1批', block: 'K11',
    title: '部门轴：departmentIds（复数）+ 文件驱动真源 + resolveContext 单一入口',
    // 同 RB-01：卡面 `probe-*` 通配取同域具名件
    paths: [
      'src/middleware/auth.ts',
      'src/agent/prompt-assembler.ts',
      'scripts/control-tower/probe-department-axis.ts',
    ],
    sharedWrite: ["RB-01: src/middleware/auth.ts（同文件，须串行）", "1-7bis: src/agent/prompt-assembler.ts（若涉）"],
    dependsOn: ['RB-01'],
    // ┌─ 卡面 §⑥ 判据（Issue #1141，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：RB-02 · 部门轴：departmentIds（复数）+ 文件驱动真源 + resolveContext 单一入口
    // │ - [ ] **L3 真跑**：两个分属不同部门的用户 ⇒ 上下文/可见面**不同**
    // │ - [ ] 反例（改坏即红）：把 `departmentIds` 退回单数 ⇒ 判据必红
    // │ - [ ] `resolveContext` 单入口：`grep` 到第二处解析点 ⇒ 必红
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-department-axis.ts --case multi-dept', expectExit: 0 },
    ],
    status: 'todo',
    source: '创始人 2026-10-05：「中层就会涉及多个部门」⇒ 必须复数；「部门唯一真源赞同文件驱动」（便于不同客户调整）。🔴 提案原稿的 departmentId（单数）作废。改造面：src/ 里 teamId/department 已 428 处 / 74 文件 ⇒ 必须有 resolveContext 单一入口，否则 74 文件各写各的判断',
  },
  {
    id: 'RB-03',
    worker: 'win', batch: '第2批', block: 'K11',
    title: '权限项模型：PermissionId[] + 角色为可配包（五档仅出厂默认）',
    paths: [
      'src/middleware/rbac.ts',
      'scripts/control-tower/probe-permission-grants.ts',  // 判据交付物（本卡创建）
    ],
    sharedWrite: ["1-7/RB-01: src/middleware/rbac.ts（同文件，须串行）"],
    dependsOn: ['RB-01'],
    // ┌─ 卡面 §⑥ 判据（Issue #1142，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：RB-03 · 权限项模型：PermissionId[] + 角色为可配包（五档仅出厂默认）
    // │ - [ ] **L3 真跑**：同一岗位名、两个客户 ⇒ **权限集合不同**（正是创始人原话场景）
    // │ - [ ] 反例（改坏即红）：把 `PermissionId[]` 退回档位枚举 ⇒ 判据必红
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-permission-grants.ts --case custom-role', expectExit: 0 },
    ],
    status: 'todo',
    source: '创始人 2026-10-05：「有一堆权限可以选择，根据岗位或角色灵活配置，不能根据岗位定死」+ 举例（同是市场总监，A 客户能看财务、B 客户不能）⇒ **不是 RBAC，是 Grant/ACL 模型**（角色只是打包）。五档保留为出厂默认，但**不是类型的一部分**',
  },
  {
    id: 'RB-04',
    worker: 'win', batch: '第3批', block: 'K11',
    title: 'BR-3 重构：从 RBAC 档位 → Grants + 客户自定义配置面',
    paths: [
      'extensions/', 'src/middleware/rbac.ts',
      'scripts/control-tower/probe-role-config.ts',  // 判据交付物（本卡创建）
    ],
    sharedWrite: ["RB-03: src/middleware/rbac.ts（同文件，须串行）"],
    dependsOn: ['RB-03'],
    // ┌─ 卡面 §⑥ 判据（Issue #1143，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：RB-04 · BR-3 重构：从 RBAC 档位 → Grants + 客户自定义配置面
    // │ - [ ] **L3 真跑**：客户自定义配置**真的生效**（改配置 → 权限随之变）
    // │ - [ ] **可回滚**：退回到出厂五档 ⇒ 行为与出厂一致（宪章 P14：改与退同一份数据）
    // │ - [ ] 反例（改坏即红）：自定义配置被忽略 ⇒ 判据必红
    // │ - **判定人**：K3 / 独立复核
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-role-config.ts --case customer-defined', expectExit: 0 },
    ],
    status: 'todo',
    source: '创始人 2026-10-05：「出厂设置5档，但是客户可以自己配。这个在企业应用里一定要可以调整，就像调整组织架构一样」。本项含客户配置面（文件驱动）',
  },
  {
    id: '3-12',
    worker: 'win', batch: '第3批', block: 'K6',
    title: '进化回环 E2/E3（跨客户模式 / 联邦）',
    // 卡面 §④；新增 API 走源文件深路径导入（index.ts 不在写集内）
    paths: [
      'packages/evolution/src/global-analyzer.ts',
      'tests/evolution/global-analyzer.test.ts',
    ],
    dependsOn: ['2-3'],
    // ┌─ 卡面 §⑥ 判据（Issue #1060，2026-10-07 断面；全文抄录，机器条目见下方 acceptance）─┐
    // │ 卡面标题：3-12 · 进化回环 E2/E3（跨客户模式 / 联邦）
    // │ - [ ] `V1` **机制判据（已达成）**：`npx vitest run tests/evolution/global-analyzer.test.ts` ⇒ exit 0（既有 `aggregateIndustryBaseline`/`writeIndustryThresholds` 用例 + E2 跨客户模式 + E3 联邦导出/导入）
    // │ - [ ] `V2` **k-匿名**：`exportFederatedStats` 输出**不含任何客户标识**（仅 `orgCount` 等聚合量）；不达 `minOrgs` ⇒ 拒绝 + 原因码
    // │ - [ ] `V3` **未信任输入**：`importFederatedStats` 对非法 JSON / 版本不符 / 门槛造假输入 ⇒ 拒绝 + `degraded`，**不抛**
    // │ - [ ] **反例（改坏即红，线回执登记的变异体 M3-12）**：把"自动枚举 org"退回单组织（如退回 `['default']`）⇒ E2 首个用例的 `orgsConsideredCount` / `patterns` 断言**立刻变红**
    // │ - [ ] **现实判据（未达，等客户）**：第二个真实客户进来时能测"参数能否复用"（施工单原文）——**必须由真实数据回答，不得用夹具代替**
    // │ - **判定人**：K3 / 独立复核（**执行方不得自判**）
    // └─ 抄录结束 ┘
    acceptance: [
      { run: 'npx vitest run tests/evolution/global-analyzer.test.ts', expectExit: 0 },
    ],
    // GitHub CLOSED；交付 `d306a36e9`（PR #1203）已入 main ⇒ 按 GitHub 订正。⚠️ 卡面 §⑥ 记「现实判据（未达，等客户）」
    status: 'done',
    source: '施工单.md 3-12（等客户，非技术阻塞）',
  },
];

// ════════════════════════════════════════════════════════════════
// 10 块
// ════════════════════════════════════════════════════════════════

export const constructionBlocks: readonly ConstructionBlock[] = [
  {
    id: 'K11' as BlockId, name: '权限与多租户（部门轴 / 权限项模型 / 跨租户隔离）',
    items: ['RB-01', 'RB-02', 'RB-03', 'RB-04'],
    blockAcceptance: [
      { run: 'npx tsx scripts/control-tower/probe-rbac-multitenant.ts --case cross-org', expectExit: 0 },
    ],
    source: '创始人 2026-10-05 裁：① DevMode 跨租户不可放行（原话「这个肯定是不允许的」）② 未来云端服务涉多租户（「肯定是不能 A 客户读 B 客户数据」）③ 五档出厂默认可客户自配（「像调整组织架构一样」）④ 权限项灵活配置不解岗位定死（飞书式）⑤ 部门真源文件驱动 ⑥ 先冻契约形状分批实现，**缺口必须在面板真实反映**',
  },
  {
    id: 'RETIRED' as BlockId, name: '已作废项（保留 id 防撞号；不派单）',
    items: ['0-9'],
    blockAcceptance: [
      { run: 'echo "RETIRED 块：已作废项只留痕，无判据（禁派单）"', expectStdoutContains: 'RETIRED' },
    ],
    source: 'CTO 2026-10-05：0-9 前提被证伪 ⇒ 作废（同 #983 CLOSED/NOT_PLANNED）。本块只留痕，不派单、不进任何批次。',
  },
  {
    id: 'K1', name: '接线·点火·权限执行面', items: ['0-1', '0-9bis', '0-10', '1-7', '1-7bis', 'K1-WH'],
    blockAcceptance: [
      // 块标准原为 `bash scripts/control-tower/probe-loops.sh` —— **该件在 origin/main 不存在**（全树零命中）。
      // 已按 CTO 2026-10-08 对 0-1 的裁定（内部自不一致 #2）同步为卡面 #975 的探针判据。
      { run: 'bash -c "node_modules/.bin/tsx tests/loops/probes/batch0a-probes.ts 2> /tmp/batch0a.stderr.log; grep -c \'D9] MainAgent 未注入\' /tmp/batch0a.stderr.log | grep -q ^0$"', expectExit: 0 },
      // 口径：`grep -c` 作用在单文件 ⇒ 行数口径（无串接少算风险）。
    ],
    source: 'T3 §二 K1',
  },
  {
    id: 'K2', name: '写入门禁与工具治理', items: ['0-11', '2-4'],
    blockAcceptance: [
      { run: 'npx vitest run tests/security/file-guard.test.ts', expectExit: 0 },
    ],
    source: 'T3 §二 K2',
  },
  {
    id: 'K3', name: '哨兵装载与时序落盘（a 类/W1）', items: ['0-3', '2-1a', '2-1b', '3-8'],
    blockAcceptance: [
      {
        run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM metric_readings WHERE observed_at > datetime(\'now\', \'-1 hour\')"',
        expectRowsGt: { table: 'metric_readings', n: 0 },
      },
    ],
    source: 'T3 §二 K3',
  },
  {
    id: 'K4', name: '本体·因果边·循环编号', items: ['0-4', '1-8', '1-9', '3-5', '3-11'],
    blockAcceptance: [
      // ⚠️ 待裁（CTO）：本块标准引 `tests/sentinel/edge-lag-consumed.test.ts` —— 该件在 main **不存在**，
      //   且其对应项 1-8 的判据本身仍是 `⚠️ 待裁`（卡面改用了既有 check-ontology-fields.sh）⇒ 本块标准随之待裁。
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实哨兵，断言它读到该字段
      { run: 'npx vitest run tests/sentinel/edge-lag-consumed.test.ts', expectExit: 0 },
    ],
    source: 'T3 §二 K4',
  },
  {
    id: 'K5', name: '参数层（a/b/c/d 四类，护城河资产本体）', items: ['2-2', '2-6', '2-7', '0-7', '0-8', '2-3', 'PL-04'],
    blockAcceptance: [
      { run: 'npx tsx scripts/control-tower/probe-compute-registry.ts', expectStdoutContains: 'COMPUTE-HHI-v1' },
    ],
    source: 'T3 §二 K5（🔴 无主 —— 待裁，见 §九#1）',
  },
  {
    id: 'K6', name: '反馈·进化回环（进化侧；参数层 b/c 类已移入 K5）', items: ['0-2', '0-5', '1-4', '3-12'],
    blockAcceptance: [
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实进化回写，断言表行
      { run: 'npx vitest run tests/growth/evolution-writeback.test.ts', expectExit: 0 },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM agent_memory WHERE key LIKE \'%_gaCorrections%\'"', expectRowsGt: { table: 'agent_memory', n: 0 } },
    ],
    source: 'T3 §二 K6',
  },
  {
    id: 'K7', name: '诊断→报告交付链', items: ['1-1', '1-2', '1-3', '1-5', '3-7'],
    blockAcceptance: [
      // CTO 裁定 C-01（2026-10-08）同批订正：原写 `scripts/golden-scenarios/run.sh` —— **该路径不存在**
      //   （main 上只有逐场景脚本；见 scripts/golden-scenarios/README.md §运行契约）。
      { run: 'bash scripts/golden-scenarios/GS-08-report-readable/run.sh', expectExit: 0 },
    ],
    source: 'T3 §二 K7',
  },
  {
    id: 'K8', name: '知识与图谱权限（L4）', items: ['0-6', '1-6', '3-2'],
    blockAcceptance: [
      // 🔴 修 T9 面 1 反例「K8 块标准串到 K1」：原为 org-isolation-audit（= K1 的项 0-9 判据）
      //    ⇒ K8 三项一件未做也能绿。改为 K8 自己三项的合并判据。
      // 判据文件名订正（与 1-6 同）：原 `traversal-permission.test.ts` 在 main **不存在**
      //   ⇒ 改用既有 `tests/l4/traversal-permission-filter.test.ts`（卡面 1-6 §⑤ 已自陈该文件不存在）。
      { run: 'npx vitest run tests/l4/traversal-permission-filter.test.ts', expectExit: 0 },
      { run: 'npx vitest run tests/l4/knowledge-scope.test.ts', expectExit: 0 },
    ],
    source: 'T3 §二 K8（blockAcceptance 已按 T9 面1 反例改：禁串块）',
  },
  {
    id: 'K9', name: '建档·岗位预设·技能面', items: ['0-12', '3-1', '3-3', '3-4', '3-6', '3-9'],
    blockAcceptance: [
      { run: 'npx tsx scripts/control-tower/probe-skills.ts', expectStdoutContains: '## Available Skills' },
    ],
    source: 'T3 §二 K9',
  },
  {
    id: 'K10', name: '平台交付与运行时（DSH）', items: ['3-10'],
    blockAcceptance: [
      { run: 'bash scripts/control-tower/probe-egress.sh', expectExit: 0 },
    ],
    source: 'T3 §二 K10',
  },
];


// ════════════════════════════════════════════════════════════════
// 块间依赖：**从项级自动汇总**（禁手补 —— 2026-10-04 废止手写）
// ════════════════════════════════════════════════════════════════

export function deriveBlockDeps(): Record<BlockId, BlockId[]> {
  const out = {} as Record<BlockId, BlockId[]>;
  const byId = new Map(constructionItems.map((i) => [i.id, i]));
  for (const b of constructionBlocks) {
    const deps = new Set<BlockId>();
    for (const iid of b.items) {
      const it = byId.get(iid);
      if (!it) continue;
      for (const d of it.dependsOn) {
        const dt = byId.get(d);
        if (dt && dt.block !== b.id) deps.add(dt.block);
      }
    }
    out[b.id] = [...deps].sort();
  }
  return out;
}
