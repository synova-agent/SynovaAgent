// test/workbench.test.js — 面板 A「Synova 开发工作台」取数器单元测试（node:test）
// 覆盖：四问格子（正常/缺文件/坏 JSON/缺 cells/未知状态）/ 待你裁（权威源 + 卡面扫描）/
//       阻塞（三要素口径 + 未申报单列）/ 任务卡读取容错 / collectWorkbench 全链路不抛异常
// 铁律 48：非空壳，每条路径都有真实断言（含边界与降级）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  readGrid, buildDecisions, buildBlocked, readTaskCards, collectWorkbench,
  normalizeStatus, daysBetween, EMPTY_STATUSES, GRID_REL_PATH, GRID_COLORS
} from "../lib/workbench.js";

function makeDir(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "synova-wb-"));
  for (const [rel, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

/** 四问格子夹具：2 层 × 2 扩展点 × 4 问 = 8 格（与真实文件同构）。 */
const GRID = {
  schema: "charter-three-questions/1.0",
  created_at: "2026-09-25",
  rules: { empty_is_not_green: "空格必须显式报红/待办，不得默认绿（院方 X27：缺失≠通过）" },
  counts: { cells: 8, ext_points: 2, questions: 4, filled: 0 },
  cells: (() => {
    const out = [];
    let n = 0;
    for (const [layer, ext] of [["对象层", "节点（要素）"], ["判据层", "阈值"]]) {
      for (const q of [["q1", "加了吗"], ["q2", "接上了吗"], ["q3", "生效了吗"], ["q4", "删了吗"]]) {
        n += 1;
        out.push({
          id: "C" + String(n).padStart(2, "0"),
          layer, ext_point: ext, question: q[0], question_text: q[1], question_desc: q[1] + " —— 说明",
          status: "empty", priority: "P1", judgement: "", command: "", evidence: "", owner: "", updated_at: ""
        });
      }
    }
    return out;
  })()
};

function card(over = {}) {
  return Object.assign({
    task_id: "D999", title: "t", status: "claimed", updated_at: "2026-09-20",
    blocked: null, note: null, domain: null
  }, over);
}

// ── ① 状态归一：空格绝不折算成绿 ───────────────────────────────────────────
test("normalizeStatus：空/''/null/undefined/todo 一律 empty；未知值单独 unknown（不折成绿）", () => {
  for (const v of ["", "  ", null, undefined, "empty", "EMPTY", "todo", "未填", "待办"]) {
    assert.equal(normalizeStatus(v), "empty", JSON.stringify(v) + " 必须是 empty");
  }
  assert.equal(normalizeStatus("green"), "green");
  assert.equal(normalizeStatus("yellow"), "yellow");
  assert.equal(normalizeStatus("red"), "red");
  assert.equal(normalizeStatus("wat"), "unknown", "未知值不得折算成任何有效色");
  assert.ok(EMPTY_STATUSES.has("empty"));
  // 四色标签与生成器同口径（禁第二套配色）
  assert.equal(GRID_COLORS.empty.label, "⚪ 未填");
  assert.equal(GRID_COLORS.green.label, "🟢 生效了");
  assert.match(GRID_COLORS.yellow.label, /接了但没生效/);
  assert.match(GRID_COLORS.red.label, /缺失/);
});

test("daysBetween：可解析 → 整天数；不可解析 → null（不猜 0）", () => {
  assert.equal(daysBetween("2026-09-19", new Date("2026-09-29T10:00:00+08:00")), 10);
  assert.equal(daysBetween("nonsense", new Date()), null);
  assert.equal(daysBetween(null, new Date()), null);
});

// ── ① 四问格子 ────────────────────────────────────────────────────────────
test("readGrid 正常：16 行 × N 问同构渲染数据；derived 按 cells 实数（不信文件 counts）", async () => {
  const root = makeDir({ [GRID_REL_PATH]: GRID });
  const g = await readGrid(root);
  assert.equal(g.ok, true);
  assert.equal(g.source, "worktree");
  assert.equal(g.rows.length, 2, "2 个扩展点 = 2 行");
  assert.equal(g.questions.length, 4, "四问");
  assert.deepEqual(g.questions.map((q) => q.text), ["加了吗", "接上了吗", "生效了吗", "删了吗"]);
  assert.equal(g.derived.cells, 8);
  assert.equal(g.derived.filled, 0, "全 empty ⇒ filled=0（空格不折算成已填）");
  assert.deepEqual(g.derived.by_status, { green: 0, yellow: 0, red: 0, empty: 8, unknown: 0 });
  // 文件 counts 原样保留，供 UI 并列展示（不覆盖文件值）
  assert.deepEqual(g.counts, { cells: 8, ext_points: 2, questions: 4, filled: 0 });
  // 每格都带四色 label（空格 = ⚪未填）
  assert.equal(g.rows[0].cells.q1.status, "empty");
  assert.equal(g.rows[0].cells.q1.label, "⚪ 未填");
  assert.equal(g.rows[0].priority, "P1", "行优先级取 q1 的 priority");
});

test("readGrid：文件 cells 里出现未知 status → derived.unknown 记数 + unknown_statuses 留原值，绝不折成绿", async () => {
  const g2 = JSON.parse(JSON.stringify(GRID));
  g2.cells[0].status = "maybe";
  const root = makeDir({ [GRID_REL_PATH]: g2 });
  const g = await readGrid(root);
  assert.equal(g.ok, true);
  assert.equal(g.derived.by_status.unknown, 1);
  assert.equal(g.derived.by_status.green, 0, "未知态不得进位成绿");
  assert.deepEqual(g.derived.unknown_statuses, ["maybe"]);
  assert.equal(g.rows[0].cells.q1.status, "unknown");
  assert.equal(g.rows[0].cells.q1.status_raw, "maybe", "原始值必须保留可核");
});

test("readGrid 降级①：工作区与 origin/main 两级皆无 → 显式 degraded（含两级原因），不抛异常", async () => {
  const root = makeDir({});
  const g = await readGrid(root);
  assert.equal(g.ok, false);
  assert.equal(g.degraded, true);
  assert.equal(g.rows.length, 0);
  assert.ok(g.attempts.length >= 1, "必须带上每一级的失败原因");
  assert.match(g.error, /宪章三问-48格\.json/);
});

test("readGrid 降级②：坏 JSON → 显式 degraded（不许静默返回空矩阵冒充「全未填」）", async () => {
  const root = makeDir({ [GRID_REL_PATH]: "{ not json" });
  const g = await readGrid(root);
  assert.equal(g.ok, false);
  assert.equal(g.degraded, true);
  assert.match(g.error, /JSON 解析失败/);
});

test("readGrid 降级③：结构缺 cells 数组 → 显式 degraded（不把空当合法 0 行）", async () => {
  const root = makeDir({ [GRID_REL_PATH]: { schema: "x", counts: { cells: 8 } } });
  const g = await readGrid(root);
  assert.equal(g.ok, false);
  assert.match(g.error, /缺 cells 数组/);
});

// ── ③ 待你裁 ──────────────────────────────────────────────────────────────
test("buildDecisions：status≠resolved 才算待裁；等待天数取该项日期锚点；无锚点标 waiting_unknown", () => {
  const progress = {
    ok: true,
    parsed: {
      generated_at: "2026-09-28 15:51:09",
      decisions: [
        { id: "D-1", title: "已裁的", status: "resolved", resolved_date: "2026-09-12", suggestion: { label: "A", reason: "r" } },
        { id: "D-2", title: "待裁的", status: "pending", raised_date: "2026-09-19", suggestion: { label: "B", reason: "r2" }, options: [{ label: "B" }, { label: "C" }] },
        { id: "D-3", title: "无锚点的", status: "open", suggestion: null }
      ]
    }
  };
  const now = new Date("2026-09-29T10:00:00+08:00");
  const d = buildDecisions(progress, [], now);
  assert.equal(d.ok, true);
  assert.equal(d.pending_count, 2);
  assert.equal(d.resolved_count, 1);
  assert.equal(d.pending[0].id, "D-2");
  assert.equal(d.pending[0].waiting_days, 10);
  assert.equal(d.pending[0].suggestion.label, "B");
  assert.equal(d.pending[0].options.length, 2);
  assert.equal(d.pending[1].waiting_unknown, true, "无日期锚点必须标未详，不得编天数");
  assert.equal(d.pending[1].waiting_days, null);
  assert.equal(d.source, "docs/synova/product-lines/product-progress.json#decisions");
  assert.match(d.upstream_source, /cockpit-override\.yaml#pending_decisions/);
});

test("buildDecisions：卡面「需创始人」单列 card_scan，不混进 pending 权威表；终态卡排除", () => {
  const progress = { ok: true, parsed: { decisions: [] } };
  const cards = [
    card({ task_id: "D811", title: "队列收口", status: "impl_done", note: "本卡不关闭任何 PR（需创始人签字或 token）" }),
    card({ task_id: "D777", title: "已关的", status: "closed", note: "需创始人确认（历史）" }),
    card({ task_id: "D778", title: "无关", status: "claimed", note: "普通备注" })
  ];
  const d = buildDecisions(progress, cards, new Date("2026-09-29T10:00:00+08:00"));
  assert.equal(d.pending_count, 0, "无结构化待裁");
  assert.equal(d.card_scan_count, 1, "只扫出活卡 D811");
  assert.equal(d.card_scan[0].id, "D811");
  assert.equal(d.card_scan[0].waiting_days, 9);
  assert.match(d.card_scan[0].excerpt, /需创始人/);
});

test("buildDecisions 降级：progress 不可读 → ok:false + error（面板显式降级）", () => {
  const d = buildDecisions({ ok: false, error: "工作区无 product-progress.json" }, [], new Date());
  assert.equal(d.ok, false);
  assert.match(d.error, /product-progress/);
  assert.equal(d.pending_count, 0);
});

// ── ④ 阻塞 ────────────────────────────────────────────────────────────────
test("buildBlocked：ledger 三要素条目计入并按天数降序；卡面字符串备注单列不计入（不静默补）", () => {
  const ledger = {
    ok: true,
    parsed: { blocked: [
      { id: "D812", reason: "前置未合入", since: "2026-09-18", needs: "D778", days: 11 },
      { id: "D500", reason: "等 X", since: "2026-09-27", needs: "Y", days: 2 }
    ] }
  };
  const progress = { ok: true, parsed: { lines: [] } };
  const cards = [
    card({ task_id: "D935", blocked: "已解除。开工前 M2 扫描发现写集重叠" }),
    card({ task_id: "D821", blocked: "设计前置：先冻结出站 HTTP 唯一出口" }),
    card({ task_id: "D900", blocked: { reason: "只给了原因" } }),
    card({ task_id: "D901", blocked: null })
  ];
  const b = buildBlocked(ledger, progress, cards, new Date("2026-09-29T10:00:00+08:00"));
  assert.equal(b.ok, true);
  assert.equal(b.count, 2, "只有三要素齐全的两条计入");
  assert.deepEqual(b.items.map((x) => x.id), ["D812", "D500"], "按已卡天数降序");
  assert.equal(b.items[0].days, 11);
  assert.equal(b.nonconforming_count, 2, "字符串备注（非「已解除」）+ 三要素不全各一条");
  assert.deepEqual(b.nonconforming.map((x) => x.id).sort(), ["D821", "D900"]);
  assert.equal(b.nonconforming[0].kind === "字符串备注" || b.nonconforming[0].kind === "三要素不全", true);
  assert.match(b.rule, /三要素/);
  assert.ok(b.sources.includes("docs/synova/project/ledger.json"));
});

test("buildBlocked：product-progress 各线 blocked 也计入（带线号），两源去重", () => {
  const ledger = { ok: true, parsed: { blocked: [{ id: "D1", reason: "R", since: "2026-09-25", needs: "N", days: 4 }] } };
  const progress = { ok: true, parsed: { lines: [
    { id: 1, name: "桌面端", blocked: [{ id: "D1", reason: "R", since: "2026-09-25", needs: "N", days: 4 }] },
    { id: 4, name: "数据接入", blocked: [{ id: "D2", reason: "R2", since: "2026-09-01", needs: "N2", days: 28 }] }
  ] } };
  const b = buildBlocked(ledger, progress, [], new Date());
  assert.equal(b.count, 2, "D1 两源重复必须去重");
  assert.equal(b.items[0].id, "D2");
  assert.equal(b.items[0].line, 4);
  assert.equal(b.items[0].line_name, "数据接入");
  assert.ok(b.sources.some((s) => s.includes("lines[].blocked")));
});

test("buildBlocked 降级：两源都不可读 → ok:false + error 并列（不静默当 0 阻塞）", () => {
  const b = buildBlocked({ ok: false, error: "ledger 不可读" }, { ok: false, error: "progress 不可读" }, [], new Date());
  assert.equal(b.ok, false);
  assert.equal(b.degraded, true);
  assert.match(b.error, /ledger 不可读/);
  assert.match(b.error, /progress 不可读/);
});

// ── 任务卡读取 ────────────────────────────────────────────────────────────
test("readTaskCards：坏 JSON 卡进 errors 但其余卡照读（单卡不拖垮整表）", async () => {
  const root = makeDir({
    "task-state/D001.json": { task_id: "D001", title: "好卡", status: "claimed" },
    "task-state/D002.json": "{ bad",
    "task-state/README.md": "非卡"
  });
  const r = await readTaskCards(root);
  assert.equal(r.ok, true);
  assert.equal(r.cards.length, 1, "只读 D*.json 且坏卡跳过");
  assert.equal(r.cards[0].task_id, "D001");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /D002\.json: 坏 JSON/);
  assert.equal(r.degraded, true, "有坏卡必须显式 degraded");
});

test("readTaskCards 降级：task-state 目录不存在 → ok:false（ENOENT 与坏 JSON 分开报）", async () => {
  const root = makeDir({});
  const r = await readTaskCards(root);
  assert.equal(r.ok, false);
  assert.match(r.error, /task-state 目录不存在/);
});

// ── 全链路 ────────────────────────────────────────────────────────────────
test("collectWorkbench：不存在的 repoRoot 下也不抛异常，四块各自显式降级", async () => {
  const root = makeDir({});
  const p = await collectWorkbench(root, {
    now: new Date("2026-09-29T10:00:00+08:00"),
    fetchImpl: async () => { throw new Error("network disabled in test"); }
  });
  assert.equal(typeof p, "object");
  assert.equal(p.degraded, true);
  assert.ok(p.degraded_sources.length >= 3, "至少格子/待裁/阻塞/任务卡四源里的多条入账，实际：" + JSON.stringify(p.degraded_sources));
  assert.equal(p.grid.ok, false);
  assert.equal(p.decisions.ok, false);
  assert.equal(p.flow.pr.ok, false, "无网络且无快照 → PR 显式降级");
  assert.equal(p.generated_at, new Date("2026-09-29T10:00:00+08:00").toISOString());
});

test("collectWorkbench：全绿夹具下 ok:true / degraded:false，且数字全部来自夹具（禁手写）", async () => {
  const root = makeDir({
    [GRID_REL_PATH]: GRID,
    "docs/synova/product-lines/product-progress.json": {
      generated_at: "2026-09-28 15:51:09",
      decisions: [{ id: "D-9", title: "待裁项", status: "pending", raised_date: "2026-09-20", suggestion: { label: "A", reason: "r" } }]
    },
    "docs/synova/project/ledger.json": { ok: true, blocked: [{ id: "D812", reason: "R", since: "2026-09-18", needs: "N", days: 11 }] },
    "task-state/D812.json": { task_id: "D812", title: "卡", status: "claimed", updated_at: "2026-09-18" }
  });
  const p = await collectWorkbench(root, {
    now: new Date("2026-09-29T10:00:00+08:00"),
    fetchImpl: async () => { throw new Error("no net"); }
  });
  assert.equal(p.grid.ok, true);
  assert.equal(p.decisions.ok, true);
  assert.equal(p.decisions.pending_count, 1);
  assert.equal(p.decisions.pending[0].waiting_days, 9);
  assert.equal(p.blocked.count, 1);
  // 流水：非 git 目录（非仓库）→ git 段降级，但函数整体不抛
  assert.equal(p.flow.git.ok, false);
  assert.equal(typeof p.flow.git.error, "string");
  assert.equal(p.ok, true, "四块里至少一块可用 ⇒ ok:true（面板不整黑）");
});

// ══ 独立复核反例回归（2026-09-29：K3 式独立验证发现 4 处"口径声明与实际不符/静默丢弃"）══════
// 每条都对应一个**实跑过的反例**，修复后必须仍然绿；改名/删除即视为回归。

test("回归 CE1：ledger 条目缺三要素 → 不计入阻塞数，单列「上源三要素不全」（不得兜成「(无原因)」计入）", () => {
  const ledger = { ok: true, parsed: { blocked: [{ id: "B-EMPTY" }] } };
  const b = buildBlocked(ledger, { ok: true, parsed: { lines: [] } }, [], new Date("2026-09-29T10:00:00+08:00"));
  assert.equal(b.count, 0, "缺要素条目不得计入阻塞数");
  assert.equal(b.nonconforming_count, 1, "必须单列，不静默丢");
  assert.equal(b.nonconforming[0].kind, "上源三要素不全");
  assert.match(b.nonconforming[0].id ?? "", /^$/);
  assert.match(b.nonconforming[0].note, /docs\/synova\/project\/ledger\.json/, "必须标注上源");
});

test("回归 CE3：product-progress 线级 blocked 缺 since/needs → 不计入，单列", () => {
  const progress = { ok: true, parsed: { lines: [{ id: 3, name: "报告", blocked: [{ reason: "r only" }] }] } };
  const b = buildBlocked({ ok: false, error: "ledger 不可读" }, progress, [], new Date());
  assert.equal(b.count, 0);
  assert.equal(b.nonconforming_count, 1);
  assert.match(b.nonconforming[0].kind, /上源三要素不全/);
});

test("回归 CE4：卡面三要素齐全 + ledger 不可读 → 必须从卡面直取计入（否则真实阻塞静默消失）", () => {
  const cards = [card({ task_id: "D901", line: 7, blocked: { reason: "前置未合", since: "2026-09-18", needs: "D778" } })];
  const b = buildBlocked({ ok: false, error: "工作区无 ledger.json" }, { ok: false, error: "无 progress" }, cards, new Date("2026-09-29T10:00:00+08:00"));
  assert.equal(b.count, 1, "ledger 不可读时卡面完整阻塞必须补位计入");
  assert.equal(b.card_fallback_count, 1);
  assert.equal(b.items[0].id, "D901");
  assert.equal(b.items[0].line, 7);
  assert.match(b.items[0].source, /task-state\/D901\.json/);
  assert.equal(b.degraded, true, "ledger 不可读必须显式降级");
  // ledger 可用时**不得**重复计入（去重 + 只在 !ledger.ok 时补位）
  const b2 = buildBlocked({ ok: true, parsed: { blocked: [{ id: "D901", reason: "前置未合", since: "2026-09-18", needs: "D778", days: 11 }] } }, { ok: false, error: "x" }, cards, new Date("2026-09-29T10:00:00+08:00"));
  assert.equal(b2.count, 1, "ledger 可用时不得因卡面直取而双计");
  assert.equal(b2.card_fallback_count, 0);
});

test("回归 CE5：卡面 blocked 为 true/数字/数组（类型非法）→ 单列，不静默丢弃", () => {
  const cards = [
    card({ task_id: "D1", blocked: true }),
    card({ task_id: "D2", blocked: 42 }),
    card({ task_id: "D3", blocked: ["a", "b"] })
  ];
  const b = buildBlocked({ ok: true, parsed: { blocked: [] } }, { ok: true, parsed: { lines: [] } }, cards, new Date());
  assert.equal(b.count, 0);
  assert.equal(b.nonconforming_count, 3, "三种非法类型都必须可见");
  for (const n of b.nonconforming) assert.match(n.kind, /类型非法/);
  assert.deepEqual(b.nonconforming.map((n) => n.id).sort(), ["D1", "D2", "D3"]);
});

test("回归 CE6：两条无 id、同 reason、不同 since 的阻塞 → 不得误合为一条", () => {
  const ledger = { ok: true, parsed: { blocked: [
    { reason: "同因", since: "2026-09-01", needs: "N", days: 28 },
    { reason: "同因", since: "2026-09-20", needs: "N", days: 9 }
  ] } };
  const b = buildBlocked(ledger, { ok: true, parsed: { lines: [] } }, [], new Date());
  assert.equal(b.count, 2, "去重键必须含 since/needs");
});

test("回归 CE7：ledger.blocked 里混入字符串/null/数字 → 单列「非对象条目」，不计入", () => {
  const ledger = { ok: true, parsed: { blocked: ["a string", null, 5, { id: "OK", reason: "r", since: "2026-09-20", needs: "n", days: 9 }] } };
  const b = buildBlocked(ledger, { ok: true, parsed: { lines: [] } }, [], new Date());
  assert.equal(b.count, 1, "只有合法那条计入");
  assert.equal(b.items[0].id, "OK");
  assert.equal(b.malformed_upstream, 3, "三条非法上源条目必须被点名");
  assert.equal(b.nonconforming_count, 3);
});

test("回归 finding a：ledger 不可读但 progress 可读 → collectWorkbench 必须把它计入 degraded_sources", async () => {
  const root = makeDir({
    [GRID_REL_PATH]: GRID,
    "docs/synova/product-lines/product-progress.json": { generated_at: "x", decisions: [], lines: [{ id: 3, name: "报告", blocked: [{ id: "L3", reason: "r", since: "2026-09-20", needs: "n", days: 9 }] }] },
    "task-state/D1.json": { task_id: "D1", title: "t", status: "claimed", updated_at: "2026-09-20" }
  });
  const p = await collectWorkbench(root, { now: new Date("2026-09-29T10:00:00+08:00"), fetchImpl: async () => { throw new Error("no net"); } });
  assert.equal(p.blocked.ok, true, "progress 可用 ⇒ 阻塞块仍可用");
  assert.equal(p.blocked.degraded, true, "ledger 不可读 ⇒ 块级 degraded 必须为真");
  assert.ok(p.degraded_sources.some((s) => s.includes("阻塞")), "必须进 degraded_sources，实际：" + JSON.stringify(p.degraded_sources));
  assert.equal(p.blocked.items[0].id, "L3", "可用源的条目仍展示");
});

test("回归 finding b：任务卡坏 JSON → 必须进 degraded_sources（同数据在治理线可见，A 面不得静默）", async () => {
  const root = makeDir({
    [GRID_REL_PATH]: GRID,
    "task-state/D1.json": { task_id: "D1", title: "好卡", status: "claimed", updated_at: "2026-09-20" },
    "task-state/D2.json": "{ bad json"
  });
  const p = await collectWorkbench(root, { now: new Date("2026-09-29T10:00:00+08:00"), fetchImpl: async () => { throw new Error("no net"); } });
  assert.equal(p.task_cards.error_count, 1);
  assert.ok(p.degraded_sources.some((s) => s.includes("坏卡")), "坏卡必须入 degraded_sources：" + JSON.stringify(p.degraded_sources));
});

test("回归 finding h：cells 为空数组的格子文件 → 视为结构异常（空矩阵不得冒充合法全未填）", async () => {
  const root = makeDir({ [GRID_REL_PATH]: { schema: "x", counts: { cells: 0 }, cells: [] } });
  const g = await readGrid(root);
  assert.equal(g.ok, false);
  assert.equal(g.degraded, true);
  assert.match(g.error, /结构异常/);
});

test("回归 finding d：cells 里混入非对象元素 → 计入 derived.malformed，且不算「已填」", async () => {
  const g2 = JSON.parse(JSON.stringify(GRID));
  g2.cells.push(null, "junk");
  const root = makeDir({ [GRID_REL_PATH]: g2 });
  const g = await readGrid(root);
  assert.equal(g.ok, true);
  assert.equal(g.derived.malformed, 2);
  assert.equal(g.derived.filled, 0, "畸形元素不得被算成已填");
  assert.equal(g.derived.by_status.empty, 8);
  assert.ok(g.issues.some((s) => s.includes("非对象元素")));
});

test("回归 finding e：EMPTY_STATUSES 必须被生产代码消费（防死导出，铁律 37）", async () => {
  const src = await import("node:fs/promises").then((m) => m.readFile(new URL("../lib/workbench.js", import.meta.url), "utf8"));
  const uses = src.split("EMPTY_STATUSES").length - 1;
  assert.ok(uses >= 2, "EMPTY_STATUSES 必须至少被定义处 + 一处生产调用（当前出现 " + uses + " 次）");
});
