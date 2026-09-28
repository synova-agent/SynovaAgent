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
