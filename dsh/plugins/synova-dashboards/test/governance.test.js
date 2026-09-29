// test/governance.test.js — 面板 B「治理线」取数器单元测试（node:test）
// 覆盖：治理线判定信号 / 「服务哪条主线」显式优先-文本抽取-不猜 / 活卡终态分流与排序 /
//       欠账表 / 两源独立降级 / todos.yaml 未消费原因显式声明
// 铁律 48：非空壳，每条路径都有真实断言。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  collectGovernance, governanceSignals, resolveServes, extractLines,
  BACKLOG_REL_PATH, GOVERNANCE_LEDGER_REL, ACTIVE_STATUSES, RESTING_STATUSES
} from "../lib/governance.js";

function makeDir(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "synova-gov-"));
  for (const [rel, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

test("governanceSignals：三条机器可见信号，逐条可核；无信号 = 不属于治理线", () => {
  assert.deepEqual(governanceSignals({ title: "CT-34 门禁", domain: null }), ["标题以 CT- 开头", "标题/里程碑含 治理|门禁|控制塔"]);
  assert.deepEqual(governanceSignals({ title: "某功能", domain: "doc-governance" }), ["domain=doc-governance"]);
  assert.deepEqual(governanceSignals({ title: "普通卡", milestone: "M0 治理体系" }), ["标题/里程碑含 治理|门禁|控制塔"]);
  assert.deepEqual(governanceSignals({ title: "无关卡", milestone: "M2 增长", domain: "win" }), []);
});

test("extractLines / resolveServes：显式 line 字段优先；否则文本抽「线 N」；抽不到 → null 不猜", () => {
  assert.deepEqual(extractLines({ title: "修 线 3 与 8线 的哨兵" }).sort((a, b) => a - b), [3, 8]);
  assert.deepEqual(extractLines({ title: "无" }), []);
  assert.deepEqual(extractLines({ note: "服务线10与线11" }).sort((a, b) => a - b), [10, 11]);

  const explicit = resolveServes({ line: 7, title: "无文本线号" });
  assert.equal(explicit.serves, "线 7");
  assert.equal(explicit.serves_source, "卡面 line 字段", "显式字段优先于文本抽取");

  const text = resolveServes({ title: "为线 4 解除阻塞" });
  assert.equal(text.serves, "线 4");
  assert.equal(text.serves_source, "卡面文本抽取");

  const none = resolveServes({ title: "没写线号", milestone: null });
  assert.equal(none.serves, null, "抽不到必须为 null（不猜）");
  assert.equal(none.serves_source, "卡面未声明");

  const milOnly = resolveServes({ title: "没写线号", milestone: "M0 项目管理基建" });
  assert.equal(milOnly.serves, null, "只有里程碑 ≠ 主线，不得冒充");
  assert.match(milOnly.serves_source, /仅里程碑/);
});

test("collectGovernance 正常：治理卡按信号入选，活卡/终态分流，等待最久排最前", async () => {
  const root = makeDir({
    "task-state/D1014.json": { task_id: "D1014", title: "N12 根治 ci.yml concurrency", status: "impl_done", domain: "mac", milestone: "治理体系最小充分形态 · 阶段 0 阻塞解除", updated_at: "2026-09-26T03:30:00+08:00", note: "影响线 3 与线 8 的红灯" },
    "task-state/D513.json": { task_id: "D513", title: "控制塔四项返修", status: "impl_done", domain: null, updated_at: "2026-08-29" },
    "task-state/D387.json": { task_id: "D387", title: "CT-34 纯文档提交豁免门禁", status: "audited", domain: "mac", updated_at: "2026-08-20", note: "线 1" },
    "task-state/D700.json": { task_id: "D700", title: "普通功能卡", status: "claimed", domain: "win", updated_at: "2026-09-01" },
    [BACKLOG_REL_PATH]: { schemaVersion: 1, backlog: [{ id: "PLAN-x", title: "待规划项", note: "备注" }] }
  });
  const now = new Date("2026-09-29T10:00:00+08:00");
  const g = await collectGovernance(root, { now });
  assert.equal(g.ok, true);
  // D1066：落库件缺失 → 显式回退现场扫描（回退本身入 degraded_sources，不静默）
  assert.equal(g.source_mode, "live-scan-fallback");
  assert.equal(g.degraded, true);
  assert.ok(g.degraded_sources.some((x) => x.includes("落库件不可用")), JSON.stringify(g.degraded_sources));
  assert.equal(g.cards.count, 3, "D700 无治理信号 → 不入列");
  assert.equal(g.cards.active_count, 2, "impl_done 属活卡");
  assert.equal(g.cards.resting_count, 1, "audited 属终态");
  assert.deepEqual(g.cards.active.map((c) => c.id), ["D513", "D1014"], "等待最久排最前");
  const d1014 = g.cards.active.find((c) => c.id === "D1014");
  assert.equal(d1014.serves, "线 3、线 8");
  assert.equal(d1014.serves_source, "卡面文本抽取");
  assert.equal(d1014.waiting_days, 3);
  assert.equal(d1014.domain_label, "mac");
  const d513 = g.cards.active.find((c) => c.id === "D513");
  assert.equal(d513.serves, null);
  assert.equal(d513.domain_label, "—（卡面未声明）", "域缺失显式留白，不猜");
  assert.equal(d513.waiting_days, 31);
  assert.equal(g.cards.by_domain.mac, 2);
  assert.equal(g.cards.by_domain["—（卡面未声明）"], 1);
  assert.ok(g.cards.read_error_count === 0);
  // 欠账表
  assert.equal(g.debt.ok, true);
  assert.equal(g.debt.count, 1);
  assert.equal(g.debt.items[0].id, "PLAN-x");
  assert.match(g.debt.todos_yaml_note, /todos\.yaml（T-\* 待办）未消费：插件零依赖/);
  // 口径随数据返回（UI 原样展示，可核）
  assert.match(g.scope.rule, /domain=doc-governance/);
  assert.equal(g.scope.signals["标题以 CT- 开头"], 1);
});

test("collectGovernance：卡面 blocked 为对象时取 reason 作备注；字符串直接透传", async () => {
  const root = makeDir({
    "task-state/D1.json": { task_id: "D1", title: "门禁卡 A", status: "claimed", updated_at: "2026-09-28", blocked: { reason: "等 D2 合入", since: "2026-09-27", needs: "D2" } },
    "task-state/D2.json": { task_id: "D2", title: "门禁卡 B", status: "claimed", updated_at: "2026-09-28", blocked: "前置未达成（实测）" },
    [BACKLOG_REL_PATH]: { schemaVersion: 1, backlog: [] }
  });
  const g = await collectGovernance(root, { now: new Date("2026-09-29T10:00:00+08:00") });
  const a = g.cards.active.find((c) => c.id === "D1");
  const b = g.cards.active.find((c) => c.id === "D2");
  assert.equal(a.blocked_note, "等 D2 合入");
  assert.equal(b.blocked_note, "前置未达成（实测）");
});

test("collectGovernance 降级：task-state 与欠账表都不可读 → 两源原因并列，不抛异常", async () => {
  const root = makeDir({});
  const g = await collectGovernance(root, { now: new Date("2026-09-29T10:00:00+08:00") });
  assert.equal(g.ok, false);
  assert.equal(g.degraded, true);
  assert.equal(g.cards.ok, false);
  assert.equal(g.cards.count, 0);
  assert.equal(g.debt.ok, false);
  assert.ok(g.degraded_sources.length >= 2, "两源都要入账：" + JSON.stringify(g.degraded_sources));
  assert.match(g.degraded_sources.join("；"), /治理卡/);
  assert.match(g.degraded_sources.join("；"), /欠账表/);
  // 口径仍必须在场（面板降级时也要能解释自身口径）
  assert.match(g.scope.rule, /治理线 =/);
});

test("collectGovernance 降级：欠账表坏 JSON 不影响治理卡（两源独立）", async () => {
  const root = makeDir({
    "task-state/D513.json": { task_id: "D513", title: "控制塔四项返修", status: "impl_done", updated_at: "2026-08-29" },
    [BACKLOG_REL_PATH]: "{ bad json"
  });
  const g = await collectGovernance(root, { now: new Date("2026-09-29T10:00:00+08:00") });
  assert.equal(g.ok, true, "治理卡可用 ⇒ 面板不整黑");
  assert.equal(g.cards.ok, true);
  assert.equal(g.cards.count, 1);
  assert.equal(g.debt.ok, false);
  assert.match(g.debt.error, /JSON 解析失败/);
  assert.equal(g.degraded, true, "部分降级必须显式");
});

test("actives/resting 状态集口径：终态不入活卡（防把已审完的卡当在办）", () => {
  for (const s of ["claimed", "spec_done", "impl_done", "in_progress", "audit_done"]) {
    assert.ok(ACTIVE_STATUSES.has(s), s + " 应为活卡");
  }
  for (const s of ["audited", "closed", "rejected", "cancelled", "failed"]) {
    assert.ok(RESTING_STATUSES.has(s), s + " 应为终态");
  }
  assert.equal(ACTIVE_STATUSES.has("audited"), false);
});

// ══ D1066 §一.4「治理落库」：面板主源 = 仓库内 governance-tasks.json ══════════
const LEDGER_DOC = {
  schema: "governance-tasks/1",
  generated_by: "dsh/plugins/synova-dashboards/scripts/gen-governance-ledger.mjs",
  generated_at: "2026-09-29T05:13:00.939Z",
  source: { primary: "task-state/D###.json", rule: "治理线 = 三条机器可见信号之一" },
  degraded: false,
  degraded_sources: [],
  counts: { total: 2, active: 1, resting: 1, debt: 1, by_domain: { mac: 2 } },
  cards: [
    { id: "D1014", title: "N12 根治 ci.yml concurrency", status: "impl_done", domain: "mac", domain_label: "mac", signals: ["标题/里程碑含 治理|门禁|控制塔"], serves: "线 3、线 8", serves_source: "卡面文本抽取", updated_at: "2026-09-26", waiting_days: 3 },
    { id: "D387", title: "CT-34 纯文档提交豁免门禁", status: "audited", domain: "mac", domain_label: "mac", signals: ["标题以 CT- 开头"], serves: "线 1", serves_source: "卡面文本抽取", updated_at: "2026-08-20", waiting_days: 40 }
  ],
  debt: [{ id: "PLAN-x", title: "待规划项", note: "备注" }]
};

test("D1066 C4：落库件在场 → 主源切换为 in-repo-ledger（不再现场扫卡），条数取自落库件", async () => {
  const root = makeDir({
    [GOVERNANCE_LEDGER_REL]: LEDGER_DOC,
    // 故意**不放** task-state：证明主源真的换成了落库件（回退源根本没被读）
    "task-state-must-not-be-read/README": "若主源还是现场扫描，本用例会得到 0 条"
  });
  const g = await collectGovernance(root, { now: new Date("2026-09-29T10:00:00+08:00") });
  assert.equal(g.source_mode, "in-repo-ledger");
  assert.equal(g.degraded, false, "落库件可用且未标降级 ⇒ degraded 必须 false");
  assert.equal(g.cards.count, 2);
  assert.equal(g.cards.active_count, 1, "impl_done 属活卡（按落库件 status 分流）");
  assert.equal(g.cards.resting_count, 1, "audited 属终态");
  assert.equal(g.cards.active[0].id, "D1014");
  assert.equal(g.cards.active[0].serves, "线 3、线 8");
  assert.equal(g.cards.active[0].waiting_days, 3, "落库件的等待天数原样采用（生成时算的），不重算");
  assert.equal(g.debt.count, 1);
  assert.equal(g.debt.source, GOVERNANCE_LEDGER_REL + "#debt");
  assert.equal(g.ledger.ok, true);
  assert.equal(g.ledger.generated_at, LEDGER_DOC.generated_at);
  assert.equal(g.ledger.schema, "governance-tasks/1");
});

test("D1066 C3：落库件 provenance 带 generated_at；非易失路径不得告警，易失路径必须告警", async () => {
  // ① 主仓风格路径（fixture 在 /tmp 下，故这里显式注入 now 后只断言 generated_at/age 语义）
  const root = makeDir({ [GOVERNANCE_LEDGER_REL]: LEDGER_DOC });
  const g = await collectGovernance(root, { now: new Date("2026-09-29T06:13:00Z") });
  const pv = g.provenance[0];
  assert.equal(pv.label, "治理台账（仓库内落库件）");
  assert.equal(pv.generated_at, "2026-09-29T05:13:00.939Z");
  assert.ok(pv.age_hours > 0.9 && pv.age_hours < 1.1, "年龄应为 ~1h，实际 " + pv.age_hours);
  assert.equal(pv.stale, false, "1h < 24h ⇒ 不陈旧");
  assert.equal(pv.volatile, true, "fixture 在 /tmp 下 ⇒ 易失自检必须命中（这就是 C3 注入测试）");
  assert.match(pv.warning, /易失路径/);
  assert.equal(g.provenance_summary.ok, false);
  assert.ok(g.provenance_summary.volatile_paths.length >= 1);
});

test("D1066 C3：落库件陈旧（>24h）⇒ stale=true（UI 变灰）；时间不可解析 ⇒ stale=null（不猜新鲜）", async () => {
  const oldDoc = { ...LEDGER_DOC, generated_at: "2026-09-20T00:00:00.000Z" };
  const root = makeDir({ [GOVERNANCE_LEDGER_REL]: oldDoc });
  const g = await collectGovernance(root, { now: new Date("2026-09-29T10:00:00Z") });
  assert.equal(g.provenance[0].stale, true, "9 天前 ⇒ 陈旧");
  assert.ok(g.provenance[0].age_hours > 200);

  const badDoc = { ...LEDGER_DOC, generated_at: "不是时间" };
  const root2 = makeDir({ [GOVERNANCE_LEDGER_REL]: badDoc });
  const g2 = await collectGovernance(root2, { now: new Date("2026-09-29T10:00:00Z") });
  assert.equal(g2.provenance[0].age_hours, null);
  assert.equal(g2.provenance[0].stale, null, "不可解析 ⇒ null（UI 显 —），不得默认新鲜");
});

test("D1066 C4：落库件结构异常（缺 cards 数组）⇒ 显式回退现场扫描，不静默", async () => {
  const root = makeDir({
    [GOVERNANCE_LEDGER_REL]: { schema: "governance-tasks/1", generated_at: "2026-09-29T00:00:00Z" },
    "task-state/D513.json": { task_id: "D513", title: "控制塔四项返修", status: "impl_done", updated_at: "2026-08-29" }
  });
  const g = await collectGovernance(root, { now: new Date("2026-09-29T10:00:00+08:00") });
  assert.equal(g.source_mode, "live-scan-fallback");
  assert.equal(g.cards.count, 1, "回退现场扫描后仍拿到卡");
  assert.equal(g.ledger.ok, false);
  assert.match(g.ledger.hint, /gen-governance-ledger\.mjs/);
  assert.ok(g.degraded_sources.some((x) => x.includes("落库件不可用")));
});
