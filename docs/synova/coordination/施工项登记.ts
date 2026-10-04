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
 *   @output — `constructionItems` / `constructionBlocks` / `deriveOwner` 三个导出。
 *   @degraded — 不适用（纯数据模块，无失败路径）。
 *
 * @derivation（域的唯一权威不是本文件）
 *   `owner` 字段**不由人填**，而由 `paths` 经 `docs/synova/coordination/ownership.yaml`
 *   的规则推导（最后匹配者胜出）。本文件附一份规则镜像 `OWNERSHIP_RULES`，
 *   与 ownership.yaml **逐条对应**；镜像漂移由门禁 `check-construction-registry.py` 断言。
 *   ⇒ 治"负责人列被手填成不是负责人"（T6 面 3 反例）。
 *
 * @gate（三条不变量，由 scripts/control-tower/check-construction-registry.py 执行）
 *   INV-1 依赖可判：dependsOn 每个 id 存在、不成环；**建表项的每个 NOT NULL 字段必须有生产者**
 *   INV-2 归属可判：每个 item 的 owner 必须由其 paths 推导得出；owner 不可为空
 *   INV-3 标准可执行：每个 item 至少一条 acceptance.run 可执行；**禁用 grep 型判据**
 *   三态 exit：0=过 / 1=违规 / 2=检查自身失败
 *
 * @ref origin/main@1630a5014（2026-10-04 14:47）
 * @supersedes 施工单.md 的四批次表（转为本文件的 batch 字段）；
 *             施工单原文保留为历史，按创始人 2026-10-04 裁定标 superseded。
 */

// ════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════

export type BlockId =
  | 'K1' | 'K2' | 'K3' | 'K4' | 'K5'
  | 'K6' | 'K7' | 'K8' | 'K9' | 'K10';

/** 验收步：完成标准 = 可执行命令（禁 grep 型 —— T6 面 1 反例） */
export interface AcceptanceStep {
  /** shell 命令。必须在 CI 可跑。 */
  run: string;
  /** 期望。至少给 exit 或 stdoutContains 之一。 */
  expectExit?: number;
  expectStdoutContains?: string;
  /** 断言"运行后数据行数 > N"（穿生产入口的典型判据） */
  expectRowsGt?: { table: string; n: number };
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
  /** 本项若建表，列出表的 NOT NULL 字段 ⇒ 门禁查每个字段有无生产者（INV-1） */
  createsTable?: {
    name: string;
    notNullFields: string[];
    /** 🔴 **字段级生产者声明**（2026-10-04 立，治 T7 面 2 反例「无字段→生产者声明位」）
     *  值 = 生产者的【模块/来源】。允许 `[known-gap]` 前缀表示生产者尚未实现。
     *  门禁 INV-1③ 判据：该字段在 origin/main 有写入门径 **或** 此处有声明 ⇒ 通过。 */
    fieldProducers?: Record<string, string>;
  };
  acceptance: AcceptanceStep[];
  status: 'todo' | 'doing' | 'done';
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
    paths: [
      'src/loops/loop-scheduler.ts',
      'src/server.ts',
      'src/routes/loops.ts',
      'scripts/control-tower/probe-loops.sh',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      { run: 'bash scripts/control-tower/probe-loops.sh', expectStdoutContains: 'MainAgent 已注入' },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM loop_runs WHERE created_at > datetime(\'now\', \'-1 hour\')"', expectRowsGt: { table: 'loop_runs', n: 0 } },
    ],
    status: 'todo',
    source: '施工单.md 0-1 / 现状报告 坏点2',
  },
  {
    id: '0-2',
    worker: 'win', batch: '第0批', block: 'K6',
    title: '进化回写 applied 恒 0（总闸）',
    paths: [
      'src/growth/feedback-collector.ts',
      'tests/growth/evolution-writeback.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实进化回写，断言表行
      { run: 'npx vitest run tests/growth/evolution-writeback.test.ts', expectExit: 0 },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM agent_memory WHERE key LIKE \'%_gaCorrections%\'"', expectRowsGt: { table: 'agent_memory', n: 0 } },
    ],
    status: 'todo',
    source: '施工单.md 0-2 / 现状报告 坏点3',
  },
  {
    id: '0-3',
    worker: 'win', batch: '第0批', block: 'K3',
    title: '4 个内建哨兵永远注册不上',
    paths: [
      'src/sentinel/builtins.ts',
      'scripts/control-tower/probe-sentinels.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      { run: 'npm run probe:sentinels 2>/dev/null || npx tsx scripts/control-tower/probe-sentinels.ts', expectStdoutContains: 'cashFlow' },
    ],
    status: 'todo',
    source: '施工单.md 0-3 / 现状报告 坏点1',
  },
  {
    id: '0-4',
    worker: 'win', batch: '第0批', block: 'K4',
    title: '循环的五阀映射指向已废止编号',
    paths: [
      'cycles/**/*.cycle.json',
      'src/cycles/',
      'scripts/control-tower/probe-cycle-edges.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-cycle-edges.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-4 / 现状报告 坏点6',
  },
  {
    id: '0-5',
    worker: 'win', batch: '第0批', block: 'K6',
    title: '目标哨兵"因子3"恒 false',
    paths: ['src/growth/goal-sentinel.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'npx vitest run tests/growth/goal-sentinel.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-5 / 现状报告 坏点5',
  },
  {
    id: '0-6',
    worker: 'win', batch: '第0批', block: 'K8',
    title: 'Schema 校验器覆盖率 1/40',
    paths: [
      'src/l4/sog-schema-validator.ts',
      'scripts/control-tower/probe-diagnosis.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      { run: 'bash -c "npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 | grep -q \'未覆盖类型\'"', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-6 / 现状报告 坏点4',
  },
  {
    id: '0-7',
    worker: 'win', batch: '第0批', block: 'K6',
    title: '反馈通道 B 是"无声的洞"',
    paths: [
      'src/routes/chat.ts',
      'tests/routes/chat-feedback.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['2-3'],
    acceptance: [
      { run: 'npx vitest run tests/routes/chat-feedback.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-7 / 现状报告 坏点8',
  },
  {
    id: '0-8',
    worker: 'win', batch: '第0批', block: 'K6',
    title: '参数层 c 类整个模块零引用',
    paths: [
      'src/growth/goal-lifecycle.ts',
      'tests/growth/goal-lifecycle-wired-or-retired.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      // 二选一（接上 or 废弃）由【脚本内部】判，命令本身必须是 tsx（不落 grep 型）
      { run: 'npx vitest run tests/growth/goal-lifecycle-wired-or-retired.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-8 / 现状报告 坏点7',
  },
  {
    id: '0-9',
    worker: 'win', batch: '第0批', block: 'K1',
    title: '知识权限过滤恒 fail-open',
    paths: ['src/middleware/auth.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'npx vitest run tests/security/org-isolation-audit.test.ts', expectExit: 0 },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM knowledge_audit WHERE filtered_out > 0"', expectRowsGt: { table: 'knowledge_audit', n: 0 } },
    ],
    status: 'todo',
    source: '施工单.md 0-9（⚠️ CTO 实测：origin/main 已修一半，剩装配）',
  },
  {
    id: '0-10',
    worker: 'win', batch: '第0批', block: 'K1',
    title: 'fail-open 兜底（0-9 延伸）',
    paths: [
      'src/services/request-context.ts',
      'src/routes/im.ts',
      'tests/security/request-context-failclosed.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['0-9'],
    acceptance: [
      { run: 'npx vitest run tests/security/request-context-failclosed.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-10（⚠️ CTO 实测：request-context 已修，剩 im.ts:53 补传 provider）',
  },
  {
    id: '0-11',
    worker: 'win', batch: '第0批', block: 'K2',
    title: 'ToolRegistry 双重死门',
    paths: [
      'src/tools/tool-registry.ts',
      'scripts/control-tower/probe-tool-policy.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      // 二选一：(a) 装配并走 invoke ⇒ 越权返回 POLICY_DENIED；(b) 删掉 ⇒ 两符号 0 命中
      { run: 'bash -c "npx tsx scripts/control-tower/probe-tool-policy.ts | grep -q POLICY_DENIED || git grep -c setPolicyEngine -- src/ | grep -q ^0$"', expectExit: 0 },
    ],
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
    acceptance: [
      { run: 'bash -c "npx tsx scripts/control-tower/probe-skills.ts | grep -q \'## Available Skills\'"', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-12 / 现状报告 坏点10',
  },

  // ───────────────── 第 1 批 · 补齐 ─────────────────
  {
    id: '1-1',
    worker: 'win', batch: '第1批', block: 'K7',
    title: '一页纸偏离只告警不拦截',
    paths: ['src/agent/report-assembler.ts', 'scripts/golden-scenarios/'],
    dependsOn: [],
    acceptance: [
      { run: 'bash scripts/golden-scenarios/run.sh GS-08', expectExit: 0 },
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
    acceptance: [
      { run: 'npx vitest run tests/l3/report-template-client.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-3',
  },
  {
    id: '1-4',
    worker: 'win', batch: '第1批', block: 'K6',
    title: '目标"传导到每个人"',
    paths: ['src/growth/goal-types.ts', 'src/growth/goal-store.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM graph_nodes WHERE node_type LIKE \'goal%\'"', expectRowsGt: { table: 'graph_nodes', n: 0 } },
    ],
    status: 'todo',
    source: '施工单.md 1-4',
  },
  {
    id: '1-5',
    worker: 'win', batch: '第1批', block: 'K7',
    title: 'customer-config 只解析不消费',
    paths: [
      'src/routes/diagnosis.ts',
      'tests/routes/customer-config-consumed.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
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
    paths: [
      'src/l4/traversal-permission-filter.ts',
      'tests/l4/traversal-permission.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      { run: 'npx vitest run tests/l4/traversal-permission.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-6',
  },
  {
    id: '1-7',
    worker: 'win', batch: '第1批', block: 'K1',
    title: '多岗位执法只在 1 处',
    paths: [
      'src/middleware/rbac.ts',
      'src/routes/',
      'tests/security/rbac-all-routes.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['0-9'],
    acceptance: [
      { run: 'npx vitest run tests/security/rbac-all-routes.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-7（⚠️ CTO 实测：origin/main 已修 rbac.ts:133-139）',
  },
  {
    id: '1-8',
    worker: 'win', batch: '第1批', block: 'K4',
    title: '时滞 0/55（承重件 W3，第 1 批最便宜）',
    paths: [
      'extensions/ontology/edge-types/*.json',
      'tests/sentinel/edge-lag-consumed.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
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
    title: '因果强度 10 条缺字段（承重件 W2）',
    paths: [
      'extensions/ontology/edge-types/*.json',
      'tests/loops/direction-monitor.transfer-function.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['1-8'],
    acceptance: [
      // 🔴 原为纯 grep 型 ⇒ 改为穿生产入口：跑一次方向监测，断言参数【改变了输出】
      { run: 'npx vitest run tests/loops/direction-monitor.transfer-function.test.ts', expectExit: 0 },
    ],
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
    ],
    dependsOn: ['2-4', '2-6'],
    createsTable: {
      name: 'metric_readings',
      notNullFields: [
        'org_id', 'metric_id', 'entity_id', 'value', 'observed_at', 'source_type',
        'is_estimated', 'confidence', 'degraded', 'created_at',
        'run_id', 'input_digest', 'def_version',
      ],
      // 🔴 逐字段声明生产者（CTO 2026-10-04 裁定；[known-gap] = 生产者尚未实现，属施工项）
      fieldProducers: {
        org_id: '2-1b 写入侧（哨兵）：从调用上下文取 orgId（宪章 H2 强制，不得留空）',
        metric_id: '2-1b 写入侧：与参数清单 2-2 的 param_id 对齐（archive/25:142 U2 明写"命名统一是前置"）',
        entity_id: "2-1b 写入侧：单元粒度（默认为 * ，X10 的 N 个单元样本靠它）",
        observed_at: '2-1b 写入侧：**取值时点**（不是写入时点，archive/25:60）',
        source_type: "[known-gap] enum('compute','42edge','manual','connector') —— 由 2-1b 写入侧按来源填；" +
          "⚠️ 待裁：与 03:192 的 source 自由串（含 erp）两套枚举需归一（T7 面 2 问 C）",
        is_estimated: '2-1b 写入侧：默认 0（权威文档15 §3.5）',
        confidence: "2-1b 写入侧：默认 medium（权威文档15 §3.5）",
        created_at: "SQL DEFAULT（datetime now）—— 无需应用层生产者",
        input_digest: '[known-gap] 输入快照摘要（03:193）—— 需 2-1b 写入侧计算或由 compute 层提供',
        def_version: '[known-gap] 该指标定义/公式版本 —— 依赖 2-6 契约注册表（W4＝⑤纯缺口）',
      },
    },
    acceptance: [
      {
        run: 'npx vitest run tests/store/metric-readings-schema.test.ts',
        expectExit: 0,
      },
    ],
    status: 'todo',
    source: '施工单 2-1（拆自 2-1，按 DSH 式「一能力一包」：schema 与 writer 分离，只通过 INSERT 契约相连）',
  },

  {
    id: '2-1b',
    worker: 'win', batch: '第2批', block: 'K3',
    title: '测量值时序 · 写入侧（承重件 W1 的 writer 侧）',
    paths: ['src/sentinel/'],
    dependsOn: ['2-1a'],
    acceptance: [
      {
        run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM metric_readings WHERE observed_at > datetime(\'now\', \'-1 hour\')"',
        expectRowsGt: { table: 'metric_readings', n: 0 },
      },
    ],
    status: 'todo',
    source: '施工单 2-1（拆自 2-1）；写入侧 = src/sentinel（mac 域，archive/25 §三：只这三个写入点）',
  },
  {
    id: '2-2',
    worker: 'win', batch: '第2批', block: 'K5',
    title: '参数清单（含 W5 两层结构 layer 字段）—— 2-5 已并入本项',
    paths: ['docs/synova/coordination/'],
    dependsOn: ['2-1a', '2-6'],
    acceptance: [
      {
        run: 'npx tsx docs/synova/coordination/tools/check-param-list.ts',
        expectExit: 0,
      },
    ],
    status: 'todo',
    source: '施工单 2-2 + 2-5 合并（同一份产物：清单本体 + 其 layer 字段；按选项①「不是独立项，是产物与字段」）',
  },
  {
    id: '2-3',
    worker: 'win', batch: '第2批', block: 'K6',
    title: '反馈两通道分裂 + 正向值被 DDL 拒',
    paths: ['packages/evolution/', 'src/growth/feedback-collector.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'bash -c "sqlite3 data/synova.db \"SELECT COUNT(*) FROM feedback_log WHERE decision=\'confirm\'\" | grep -qv ^0$"', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 2-3',
  },
  {
    id: '2-4',
    worker: 'win', batch: '第2批', block: 'K2',
    title: '写入门禁两道未接（是 2-1 的前提）',
    paths: ['src/security/file-guard.ts', 'src/tools/tool-registry.ts'],
    dependsOn: ['0-11'],
    acceptance: [
      { run: 'npx vitest run tests/security/file-guard.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 2-4',
  },  {
    id: '2-6',
    worker: 'win', batch: '第2批', block: 'K5',
    title: 'compute 契约注册表不存在（承重件 W4）',
    paths: [
      'src/contract/',
      'scripts/control-tower/probe-compute-registry.ts',  // 判据交付物（本卡创建）
    ],
    // ✅ 落点已裁（选项①）：施工单原只写"新建…解析器"未给目录；src/contract/ 已存在（win 域）
    dependsOn: [],
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
    acceptance: [
      {
        run: 'npx tsx docs/synova/coordination/tools/probe-accuracy-trend.ts',
        expectExit: 0,
      },
    ],
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
    dependsOn: ['0-9', '1-2'],
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
    dependsOn: ['0-9'],
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
    acceptance: [
      { run: 'bash -c "sqlite3 data/synova.db \"SELECT COUNT(*) FROM graph_nodes WHERE node_type LIKE \'activity/%\'\" | grep -qv ^0$"', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-5',
  },
  {
    id: '3-6',
    worker: 'win', batch: '第3批', block: 'K9',
    title: 'agent_readiness 工具',
    paths: [
      'extensions/skills/',
      'src/agent/',
      'scripts/control-tower/probe-agent-readiness.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['3-5', '0-12'],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-agent-readiness.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-6',
  },
  {
    id: '3-7',
    worker: 'win', batch: '第3批', block: 'K7',
    title: 'Agent 化矩阵的触发点',
    paths: [
      'src/routes/diagnosis.ts',
      'src/agent/',
      'tests/agent/agent-matrix-trigger.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['3-6'],
    acceptance: [
      { run: 'npx vitest run tests/agent/agent-matrix-trigger.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-7',
  },
  {
    id: '3-8',
    worker: 'win', batch: '第3批', block: 'K3',
    title: 'AI 化机会窗口哨兵（宪章 3.6 报正向）',
    paths: [
      'src/sentinel/',
      'extensions/sentinels/',
      'scripts/control-tower/probe-sentinel.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: ['3-5', '3-6'],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-sentinel.ts agent-opportunity-window', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-8',
  },
  {
    id: '3-9',
    worker: 'win', batch: '第3批', block: 'K9',
    title: '生态准入三字段',
    paths: [
      'extensions/',
      'scripts/control-tower/probe-eco-fields.ts',  // 判据交付物（本卡创建）
    ],
    // ✅ 落点已裁（选项③）：内容声明清单 = 扩展的声明文件，与 extensions/** 同族（win）
    dependsOn: [],
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
    paths: [
      '.dsh/',
      'docs/synova/research/DSH迁移施工图-20260820/',
      'scripts/control-tower/probe-egress.sh',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      { run: 'bash scripts/control-tower/probe-egress.sh', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-10',
  },
  {
    id: '3-11',
    worker: 'win', batch: '第3批', block: 'K4',
    title: '专业包层（L1.5）机制',
    paths: [
      'extensions/',
      'src/extensions/',
      'tests/extensions/layer-precedence.test.ts',  // 判据交付物（本卡创建）
    ],
    dependsOn: [],
    acceptance: [
      { run: 'npx vitest run tests/extensions/layer-precedence.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-11',
  },
  {
    id: '3-12',
    worker: 'win', batch: '第3批', block: 'K6',
    title: '进化回环 E2/E3（跨客户模式 / 联邦）',
    paths: ['packages/evolution/src/global-analyzer.ts'],
    dependsOn: ['2-3'],
    acceptance: [
      { run: 'npx vitest run tests/evolution/global-analyzer.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-12（等客户，非技术阻塞）',
  },
];

// ════════════════════════════════════════════════════════════════
// 10 块
// ════════════════════════════════════════════════════════════════

export const constructionBlocks: readonly ConstructionBlock[] = [
  {
    id: 'K1', name: '接线·点火·权限执行面', items: ['0-1', '0-9', '0-10', '1-7'],
    blockAcceptance: [
      { run: 'bash scripts/control-tower/probe-loops.sh', expectStdoutContains: 'MainAgent 已注入' },
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
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实哨兵，断言它读到该字段
      { run: 'npx vitest run tests/sentinel/edge-lag-consumed.test.ts', expectExit: 0 },
    ],
    source: 'T3 §二 K4',
  },
  {
    id: 'K5', name: '参数层清单 + 契约注册表（d 类/W4/W5）', items: ['2-2', '2-6', '2-7'],
    blockAcceptance: [
      { run: 'npx tsx scripts/control-tower/probe-compute-registry.ts', expectStdoutContains: 'COMPUTE-HHI-v1' },
    ],
    source: 'T3 §二 K5（🔴 无主 —— 待裁，见 §九#1）',
  },
  {
    id: 'K6', name: '反馈·进化回环（b 类/W6）', items: ['0-2', '0-5', '0-7', '0-8', '1-4', '2-3', '3-12'],
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
      { run: 'bash scripts/golden-scenarios/run.sh GS-08', expectExit: 0 },
    ],
    source: 'T3 §二 K7',
  },
  {
    id: 'K8', name: '知识与图谱权限（L4）', items: ['0-6', '1-6', '3-2'],
    blockAcceptance: [
      { run: 'npx vitest run tests/security/org-isolation-audit.test.ts', expectExit: 0 },
    ],
    source: 'T3 §二 K8',
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
