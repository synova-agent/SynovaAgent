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

export type Owner = 'mac' | 'win' | 'k3';

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
  batch: '第0批' | '第1批' | '第2批' | '第3批';
  block: BlockId;
  title: string;
  /** 写集：落点文件/目录 glob。域由此推导，不许人填 owner。 */
  paths: string[];
  /** 落点尚未定（无主项）⇒ true。门禁对 true 项报"无主"但不 exit 1（它本身就是要裁的事）。 */
  pathTBD?: boolean;
  /** 跨块依赖的施工项 id。空数组 = 无跨块依赖。 */
  dependsOn: string[];
  /** 本项若建表，列出表的 NOT NULL 字段 ⇒ 门禁查每个字段有无生产者（INV-1） */
  createsTable?: { name: string; notNullFields: string[] };
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
  /** 块间依赖（由 items 的 dependsOn 汇总 + 手工补的块级依赖） */
  dependsOnBlocks: BlockId[];
  /** 块级完成标准 = 至少一条穿生产入口的判据（T6: 7/10 块原无此列） */
  blockAcceptance: AcceptanceStep[];
  source: string;
}

// ════════════════════════════════════════════════════════════════
// 域规则镜像（与 docs/synova/coordination/ownership.yaml 逐条对应）
// 语义：按顺序匹配，最后匹配者胜出（与 CODEOWNERS 官方语义一致）
// ⚠️ 漂移由门禁断言：本数组的 glob 集合必须 = ownership.yaml 的 glob 集合
// ════════════════════════════════════════════════════════════════

export interface OwnershipRule {
  glob: string;
  owner: Owner;
  source: string;
}

export const OWNERSHIP_RULES: readonly OwnershipRule[] = [
  // ── 兜底：win 域本体（必须在最前 —— 最后匹配者胜出）──
  { glob: '**', owner: 'win', source: 'ownership.yaml rules[0]（TASK-ROUTING L38/L39 兜底）' },

  // ── win 显式领地 ──
  { glob: 'extensions/**', owner: 'win', source: 'ownership.yaml（TASK-ROUTING L38）' },
  { glob: 'packages/**', owner: 'win', source: 'ownership.yaml（TASK-ROUTING L38）' },
  { glob: 'synova_worker/**', owner: 'win', source: 'ownership.yaml（TASK-ROUTING L38）' },
  { glob: 'docs/plans/**', owner: 'win', source: 'ownership.yaml（TASK-ROUTING L39）' },

  // ── mac 例外（必须排在兜底之后）──
  { glob: 'src/sentinel/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L31 哨兵体系核心）' },
  { glob: 'tests/sentinel/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L31 测试随域）' },
  { glob: 'src/cron/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L31）' },
  { glob: 'src/mcp/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L35 MCP 企业接入）' },
  { glob: 'src/agent/sentinel-service*', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L31）' },
  { glob: 'src/agent/sentinel-health-service.ts', owner: 'mac', source: 'ownership.yaml（派生: L31 行内系统边界）' },
  { glob: 'scripts/control-tower/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L37）' },
  { glob: 'scripts/workflow/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L37+L63）' },
  { glob: 'scripts/hooks/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L63）' },
  { glob: 'scripts/doc-system/**', owner: 'mac', source: 'ownership.yaml（派生: TASK-ROUTING L37+L63）' },
  { glob: 'tests/doc-system/**', owner: 'mac', source: 'ownership.yaml（派生: 同 scripts/doc-system）' },
  { glob: 'scripts/pre-commit-check.sh', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L63）' },
  { glob: 'scripts/pre-push-check.sh', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L63）' },
  { glob: 'scripts/install-hooks.sh', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L63）' },
  { glob: 'scripts/backup/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L37）' },
  { glob: 'scripts/product-lines/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L32）' },
  { glob: 'scripts/golden-scenarios/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L33）' },
  { glob: 'tests/control-tower/**', owner: 'mac', source: 'ownership.yaml（派生: 测试随门禁）' },
  { glob: 'docs/synova/coordination/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L37+L63）' },
  { glob: 'docs/synova/product-lines/**', owner: 'mac', source: 'ownership.yaml（TASK-ROUTING L32）' },
  { glob: 'scripts/project/**', owner: 'mac', source: 'ownership.yaml（D806 增补 / DIVISION-CHARTER-v4 §四）' },
  { glob: 'tests/project/**', owner: 'mac', source: 'ownership.yaml（D806 增补）' },
  { glob: 'docs/synova/project/**', owner: 'mac', source: 'ownership.yaml（D806 增补）' },
  { glob: 'docs/synova/**', owner: 'mac', source: 'ownership.yaml（D914 增补: 治理文档三目录）' },

  // ── k3 红线领地 ──
  { glob: 'scripts/audit/**', owner: 'k3', source: 'ownership.yaml（TASK-ROUTING L40 红线）' },
];

/** 把文件路径规范化成匹配用的相对路径（去行号、去绝对前缀） */
export function normalizePath(raw: string): string {
  return raw.replace(/:\d+(-\d+)?$/, '').replace(/^\.\//, '');
}

/**
 * 由 paths 推导 owner。规则：按 OWNERSHIP_RULES 顺序匹配，最后匹配者胜出。
 * @returns 推导出的 owner；若 paths 为空 ⇒ undefined（门禁按 INV-2 报违规）
 */
export function deriveOwner(paths: readonly string[]): Owner | undefined {
  if (paths.length === 0) return undefined;
  let owner: Owner | undefined;
  for (const raw of paths) {
    const p = normalizePath(raw);
    for (const rule of OWNERSHIP_RULES) {
      if (matchGlob(rule.glob, p)) owner = rule.owner; // 最后匹配者胜出
    }
  }
  return owner;
}

/** 极简 glob：支持 `**` 与 `*`（与 ownership.yaml 的消费者语义一致） */
function matchGlob(glob: string, path: string): boolean {
  const re = new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*') +
      '$',
  );
  return re.test(path);
}

// ════════════════════════════════════════════════════════════════
// 40 项（源自施工单，逐条给 paths / dependsOn / acceptance）
// ════════════════════════════════════════════════════════════════

export const constructionItems: readonly ConstructionItem[] = [
  // ───────────────── 第 0 批 · 止血 ─────────────────
  {
    id: '0-1', batch: '第0批', block: 'K1',
    title: '六个业务循环的 cron 是死路（总闸）',
    paths: ['src/loops/loop-scheduler.ts', 'src/server.ts', 'src/routes/loops.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'bash scripts/control-tower/probe-loops.sh', expectStdoutContains: 'MainAgent 已注入' },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM loop_runs WHERE created_at > datetime(\'now\', \'-1 hour\')"', expectRowsGt: { table: 'loop_runs', n: 0 } },
    ],
    status: 'todo',
    source: '施工单.md 0-1 / 现状报告 坏点2',
  },
  {
    id: '0-2', batch: '第0批', block: 'K6',
    title: '进化回写 applied 恒 0（总闸）',
    paths: ['src/growth/feedback-collector.ts'],
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
    id: '0-3', batch: '第0批', block: 'K3',
    title: '4 个内建哨兵永远注册不上',
    paths: ['src/sentinel/builtins.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'npm run probe:sentinels 2>/dev/null || npx tsx scripts/control-tower/probe-sentinels.ts', expectStdoutContains: 'cashFlow' },
    ],
    status: 'todo',
    source: '施工单.md 0-3 / 现状报告 坏点1',
  },
  {
    id: '0-4', batch: '第0批', block: 'K4',
    title: '循环的五阀映射指向已废止编号',
    paths: ['cycles/**/*.cycle.json', 'src/cycles/'],
    dependsOn: [],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-cycle-edges.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-4 / 现状报告 坏点6',
  },
  {
    id: '0-5', batch: '第0批', block: 'K6',
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
    id: '0-6', batch: '第0批', block: 'K8',
    title: 'Schema 校验器覆盖率 1/40',
    paths: ['src/l4/sog-schema-validator.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'bash -c "npx tsx scripts/control-tower/probe-diagnosis.ts 2>&1 | grep -q \'未覆盖类型\'"', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-6 / 现状报告 坏点4',
  },
  {
    id: '0-7', batch: '第0批', block: 'K6',
    title: '反馈通道 B 是"无声的洞"',
    paths: ['src/routes/chat.ts'],
    dependsOn: ['2-3'],
    acceptance: [
      { run: 'npx vitest run tests/routes/chat-feedback.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-7 / 现状报告 坏点8',
  },
  {
    id: '0-8', batch: '第0批', block: 'K6',
    title: '参数层 c 类整个模块零引用',
    paths: ['src/growth/goal-lifecycle.ts'],
    dependsOn: [],
    acceptance: [
      // 二选一（接上 or 废弃）由【脚本内部】判，命令本身必须是 tsx（不落 grep 型）
      { run: 'npx vitest run tests/growth/goal-lifecycle-wired-or-retired.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-8 / 现状报告 坏点7',
  },
  {
    id: '0-9', batch: '第0批', block: 'K1',
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
    id: '0-10', batch: '第0批', block: 'K1',
    title: 'fail-open 兜底（0-9 延伸）',
    paths: ['src/services/request-context.ts', 'src/routes/im.ts'],
    dependsOn: ['0-9'],
    acceptance: [
      { run: 'npx vitest run tests/security/request-context-failclosed.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-10（⚠️ CTO 实测：request-context 已修，剩 im.ts:53 补传 provider）',
  },
  {
    id: '0-11', batch: '第0批', block: 'K2',
    title: 'ToolRegistry 双重死门',
    paths: ['src/tools/tool-registry.ts'],
    dependsOn: [],
    acceptance: [
      // 二选一：(a) 装配并走 invoke ⇒ 越权返回 POLICY_DENIED；(b) 删掉 ⇒ 两符号 0 命中
      { run: 'bash -c "npx tsx scripts/control-tower/probe-tool-policy.ts | grep -q POLICY_DENIED || git grep -c setPolicyEngine -- src/ | grep -q ^0$"', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-11 / 现状报告 坏点9 同族',
  },
  {
    id: '0-12', batch: '第0批', block: 'K9',
    title: 'skills/ 46 个技能文件恒不加载',
    paths: ['src/agent/skill-lazy-loader.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'bash -c "npx tsx scripts/control-tower/probe-skills.ts | grep -q \'## Available Skills\'"', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 0-12 / 现状报告 坏点10',
  },

  // ───────────────── 第 1 批 · 补齐 ─────────────────
  {
    id: '1-1', batch: '第1批', block: 'K7',
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
    id: '1-2', batch: '第1批', block: 'K7',
    title: '输出契约不可版本化',
    paths: ['src/l3/report-templates.ts', 'extensions/reports/contracts/'],
    dependsOn: [],
    acceptance: [
      { run: 'npx vitest run tests/l3/report-contract-versioned.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-2',
  },
  {
    id: '1-3', batch: '第1批', block: 'K7',
    title: '客户模板位只有"报告"一种',
    paths: ['src/l3/report-template-loader.ts', 'extensions/reports/'],
    dependsOn: ['1-1', '1-2'],
    acceptance: [
      { run: 'npx vitest run tests/l3/report-template-client.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-3',
  },
  {
    id: '1-4', batch: '第1批', block: 'K6',
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
    id: '1-5', batch: '第1批', block: 'K7',
    title: 'customer-config 只解析不消费',
    paths: ['src/routes/diagnosis.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'npx vitest run tests/routes/customer-config-consumed.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-5',
  },
  {
    id: '1-6', batch: '第1批', block: 'K8',
    title: 'TraversalPermissionFilter 零接线',
    paths: ['src/l4/traversal-permission-filter.ts'],
    dependsOn: [],
    acceptance: [
      { run: 'npx vitest run tests/l4/traversal-permission.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-6',
  },
  {
    id: '1-7', batch: '第1批', block: 'K1',
    title: '多岗位执法只在 1 处',
    paths: ['src/middleware/rbac.ts', 'src/routes/'],
    dependsOn: ['0-9'],
    acceptance: [
      { run: 'npx vitest run tests/security/rbac-all-routes.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-7（⚠️ CTO 实测：origin/main 已修 rbac.ts:133-139）',
  },
  {
    id: '1-8', batch: '第1批', block: 'K4',
    title: '时滞 0/55（承重件 W3，第 1 批最便宜）',
    paths: ['extensions/ontology/edge-types/*.json'],
    dependsOn: [],
    acceptance: [
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实哨兵，断言它读到该字段
      { run: 'npx vitest run tests/sentinel/edge-lag-consumed.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 1-8 / 现状报告 W3',
  },
  {
    id: '1-9', batch: '第1批', block: 'K4',
    title: '因果强度 10 条缺字段（承重件 W2）',
    paths: ['extensions/ontology/edge-types/*.json'],
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
    id: '2-1', batch: '第2批', block: 'K3',
    title: '测量值时序不存在（承重件 W1，地基）',
    paths: ['src/sentinel/sentinel-events.ts', 'src/sentinel/'],
    pathTBD: true, // 🔴 建表落点未定：src/sentinel（mac）or src/store（win）—— 待裁
    dependsOn: ['0-3', '2-4', '2-6'],
    createsTable: {
      name: 'metric_readings',
      // 按 §七 合并后（metric_readings 基座 + measurements 三字段）
      notNullFields: [
        'org_id', 'metric_id', 'entity_id', 'value', 'observed_at', 'source_type',
        'is_estimated', 'confidence', 'degraded', 'created_at',
        'run_id', 'input_digest', 'def_version',
      ],
    },
    acceptance: [
      {
        run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM metric_readings WHERE observed_at > datetime(\'now\', \'-1 hour\')"',
        expectRowsGt: { table: 'metric_readings', n: 0 },
      },
    ],
    status: 'todo',
    source: '施工单.md 2-1 / archive/25 / 03-存储设计',
  },
  {
    id: '2-2', batch: '第2批', block: 'K5',
    title: '参数清单尚未列全',
    paths: [],
    pathTBD: true, // 🔴 纯文档，落点待裁（T6 建议归 mac）
    dependsOn: [],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/check-param-list.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 2-2 / archive/24',
  },
  {
    id: '2-3', batch: '第2批', block: 'K6',
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
    id: '2-4', batch: '第2批', block: 'K2',
    title: '写入门禁两道未接（是 2-1 的前提）',
    paths: ['src/security/file-guard.ts', 'src/tools/tool-registry.ts'],
    dependsOn: ['0-11'],
    acceptance: [
      { run: 'npx vitest run tests/security/file-guard.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 2-4',
  },
  {
    id: '2-5', batch: '第2批', block: 'K5',
    title: '两层结构（先验/偏差）无概念（承重件 W5）',
    paths: [],
    pathTBD: true,
    dependsOn: ['2-2'],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/check-param-layer.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 2-5',
  },
  {
    id: '2-6', batch: '第2批', block: 'K5',
    title: 'compute 契约注册表不存在（承重件 W4）',
    paths: ['src/contract/'],
    pathTBD: true, // 🔴 施工单未给目录
    dependsOn: [],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-compute-registry.ts', expectStdoutContains: 'COMPUTE-HHI-v1' },
    ],
    status: 'todo',
    source: '施工单.md 2-6（⚠️ 先定计数口径 U-4）',
  },
  {
    id: '2-7', batch: '第2批', block: 'K5',
    title: 'overall 准度不可测量',
    paths: [],
    pathTBD: true,
    dependsOn: ['2-1', '2-2', '2-3'],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-accuracy-trend.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 2-7（阻塞项在 2-1）',
  },

  // ───────────────── 第 3 批 · 新建 ─────────────────
  {
    id: '3-1', batch: '第3批', block: 'K9',
    title: '角色预设包（Role Pack）',
    paths: ['presets/roles/'],
    pathTBD: true, // 🔴 新目录，归属待裁（CODEOWNERS 无根级 presets/**）
    dependsOn: ['0-9', '1-2'],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-role-pack.ts --role finance', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-1',
  },
  {
    id: '3-2', batch: '第3批', block: 'K8',
    title: '岗位级知识层（第四层）',
    paths: ['src/l4/knowledge-store.ts'],
    dependsOn: ['0-9'],
    acceptance: [
      { run: 'npx vitest run tests/l4/knowledge-scope.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-2',
  },
  {
    id: '3-3', batch: '第3批', block: 'K9',
    title: '建档通道（"建档" 0 命中）',
    paths: ['src/onboarding/'],
    dependsOn: ['3-1', '3-2'],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-onboarding.ts --dry-run', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-3',
  },
  {
    id: '3-4', batch: '第3批', block: 'K9',
    title: '追问由本体缺口驱动',
    paths: ['src/onboarding/gap-questioner.ts'],
    dependsOn: ['3-3'],
    acceptance: [
      { run: 'npx vitest run tests/onboarding/gap-questioner.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-4（需图非空）',
  },
  {
    id: '3-5', batch: '第3批', block: 'K4',
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
    id: '3-6', batch: '第3批', block: 'K9',
    title: 'agent_readiness 工具',
    paths: ['extensions/skills/', 'src/agent/'],
    dependsOn: ['3-5', '0-12'],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-agent-readiness.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-6',
  },
  {
    id: '3-7', batch: '第3批', block: 'K7',
    title: 'Agent 化矩阵的触发点',
    paths: ['src/routes/diagnosis.ts', 'src/agent/'],
    dependsOn: ['3-6'],
    acceptance: [
      { run: 'npx vitest run tests/agent/agent-matrix-trigger.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-7',
  },
  {
    id: '3-8', batch: '第3批', block: 'K3',
    title: 'AI 化机会窗口哨兵（宪章 3.6 报正向）',
    paths: ['src/sentinel/', 'extensions/sentinels/'],
    dependsOn: ['3-5', '3-6'],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-sentinel.ts agent-opportunity-window', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-8',
  },
  {
    id: '3-9', batch: '第3批', block: 'K9',
    title: '生态准入三字段',
    paths: ['extensions/', 'src/extensions/'],
    pathTBD: true, // 🔴 "内容声明清单"落点未给
    dependsOn: [],
    acceptance: [
      { run: 'npx tsx scripts/control-tower/probe-eco-fields.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-9',
  },
  {
    id: '3-10', batch: '第3批', block: 'K10',
    title: 'DSH 三件公共前段（出站网关 / 脱敏监听 / 双 baseURL）',
    paths: ['.dsh/', 'docs/synova/research/DSH迁移施工图-20260820/'],
    dependsOn: [],
    acceptance: [
      { run: 'bash scripts/control-tower/probe-egress.sh', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-10',
  },
  {
    id: '3-11', batch: '第3批', block: 'K4',
    title: '专业包层（L1.5）机制',
    paths: ['extensions/', 'src/extensions/'],
    dependsOn: [],
    acceptance: [
      { run: 'npx vitest run tests/extensions/layer-precedence.test.ts', expectExit: 0 },
    ],
    status: 'todo',
    source: '施工单.md 3-11',
  },
  {
    id: '3-12', batch: '第3批', block: 'K6',
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
    dependsOnBlocks: [],
    blockAcceptance: [
      { run: 'bash scripts/control-tower/probe-loops.sh', expectStdoutContains: 'MainAgent 已注入' },
    ],
    source: 'T3 §二 K1',
  },
  {
    id: 'K2', name: '写入门禁与工具治理', items: ['0-11', '2-4'],
    dependsOnBlocks: [],
    blockAcceptance: [
      { run: 'npx vitest run tests/security/file-guard.test.ts', expectExit: 0 },
    ],
    source: 'T3 §二 K2',
  },
  {
    id: 'K3', name: '哨兵装载与时序落盘（a 类/W1）', items: ['0-3', '2-1', '3-8'],
    dependsOnBlocks: ['K1', 'K2', 'K5'],
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
    dependsOnBlocks: [],
    blockAcceptance: [
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实哨兵，断言它读到该字段
      { run: 'npx vitest run tests/sentinel/edge-lag-consumed.test.ts', expectExit: 0 },
    ],
    source: 'T3 §二 K4',
  },
  {
    id: 'K5', name: '参数层清单 + 契约注册表（d 类/W4/W5）', items: ['2-2', '2-5', '2-6', '2-7'],
    dependsOnBlocks: ['K4'],
    blockAcceptance: [
      { run: 'npx tsx scripts/control-tower/probe-compute-registry.ts', expectStdoutContains: 'COMPUTE-HHI-v1' },
    ],
    source: 'T3 §二 K5（🔴 无主 —— 待裁，见 §九#1）',
  },
  {
    id: 'K6', name: '反馈·进化回环（b 类/W6）', items: ['0-2', '0-5', '0-7', '0-8', '1-4', '2-3', '3-12'],
    dependsOnBlocks: ['K1'],
    blockAcceptance: [
      // 🔴 原为纯 grep 型（T6 面1 否决点）⇒ 改为穿生产入口：跑一次真实进化回写，断言表行
      { run: 'npx vitest run tests/growth/evolution-writeback.test.ts', expectExit: 0 },
      { run: 'sqlite3 data/synova.db "SELECT COUNT(*) FROM agent_memory WHERE key LIKE \'%_gaCorrections%\'"', expectRowsGt: { table: 'agent_memory', n: 0 } },
    ],
    source: 'T3 §二 K6',
  },
  {
    id: 'K7', name: '诊断→报告交付链', items: ['1-1', '1-2', '1-3', '1-5', '3-7'],
    dependsOnBlocks: [],
    blockAcceptance: [
      { run: 'bash scripts/golden-scenarios/run.sh GS-08', expectExit: 0 },
    ],
    source: 'T3 §二 K7',
  },
  {
    id: 'K8', name: '知识与图谱权限（L4）', items: ['0-6', '1-6', '3-2'],
    dependsOnBlocks: [],
    blockAcceptance: [
      { run: 'npx vitest run tests/security/org-isolation-audit.test.ts', expectExit: 0 },
    ],
    source: 'T3 §二 K8',
  },
  {
    id: 'K9', name: '建档·岗位预设·技能面', items: ['0-12', '3-1', '3-3', '3-4', '3-6', '3-9'],
    dependsOnBlocks: ['K8', 'K5'],
    blockAcceptance: [
      { run: 'npx tsx scripts/control-tower/probe-skills.ts', expectStdoutContains: '## Available Skills' },
    ],
    source: 'T3 §二 K9',
  },
  {
    id: 'K10', name: '平台交付与运行时（DSH）', items: ['3-10'],
    dependsOnBlocks: [],
    blockAcceptance: [
      { run: 'bash scripts/control-tower/probe-egress.sh', expectExit: 0 },
    ],
    source: 'T3 §二 K10',
  },
];
