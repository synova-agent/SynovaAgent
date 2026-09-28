// lib/governance.js — 「治理线」面板 B 取数器（纯 Node，无 cordis 依赖 → 可 node --test）
//
// 面板 B 与面板 A **物理分离**（两个独立 slot 入口 + 两个独立路由）——创始人 2026-09-28 要求：
//   治理线不入格子矩阵，单独一面。故本模块不 import workbench 的组装逻辑，只复用读卡函数。
//
// 两块：
//   ① cards  治理卡：task-state/D###.json 中属于治理线的卡（域 / 卡号 / 状态 / 服务哪条主线 / 等待天数）
//   ② debt   欠账/待规划：docs/synova/coordination/board-backlog.json（PLAN-*，机器生成）
//
// 契约（铁律 47）：
//   @input   repoRoot: string
//            opts.now?: Date
//   @output  Promise<GovernancePayload>（**永不抛异常**）
//            {
//              ok, degraded, degraded_sources[], generated_at,
//              scope: { rule, signals[] },            // 口径必须随数据一起返回，UI 原样展示（可核）
//              cards: { ok, active[], resting[], count, by_domain{}, filter_note, error? },
//              debt:  { ok, source, generated_at, items[], count, error?,
//                       todos_yaml_note }             // 显式声明未消费 todos.yaml 及原因（不静默漏源）
//            }
//   @口径（禁臆写）：
//     · 治理线判定 = 三条**机器可见**信号之一（domain=doc-governance / title 以 CT- 开头 /
//       title|milestone 命中 治理|门禁|控制塔）。命中信号名随每张卡一起返回（signals 字段），
//       UI 逐卡显示"凭哪条信号入选"，可复核、可推翻。
//     · 「服务哪条主线」= 卡面显式字段（line/milestone）优先；否则从卡面文本抽 `线 N`；
//       都无 → null，UI 显式显示「—（卡面未声明）」，**不猜**（对齐 gen-project-board.py:493
//       "缺绑定则不臆测归属（宁缺勿造）"）。
//     · 等待天数 = 今天 − updated_at；updated_at 不可解析 → null（UI 显 —）。
//   @write   零写入。
import { readRepoJson } from "./repofile.js";
import { readTaskCards, daysBetween } from "./workbench.js";

/** 欠账/待规划表（机器生成；task-board-adapter 消费的同一份）。 */
export const BACKLOG_REL_PATH = "docs/synova/coordination/board-backlog.json";

/** 活卡状态（= 仍需推进；不含终态）。 */
export const ACTIVE_STATUSES = new Set(["claimed", "spec_done", "impl_done", "in_progress", "audit_done"]);

/** 终态（已完成，不再计时）。 */
export const RESTING_STATUSES = new Set(["audited", "closed", "rejected", "cancelled", "failed"]);

const GOV_TITLE_RE = /治理|门禁|控制塔/;

/**
 * 治理线判定 + 命中信号（信号名会随卡返回，UI 原样展示）。
 * @returns {string[]} 命中的信号名（空数组 = 不属于治理线）
 */
export function governanceSignals(card) {
  const signals = [];
  const title = String(card.title ?? "");
  const milestone = String(card.milestone ?? "");
  if (card.domain === "doc-governance") signals.push("domain=doc-governance");
  if (/^CT-/.test(title)) signals.push("标题以 CT- 开头");
  if (GOV_TITLE_RE.test(title) || GOV_TITLE_RE.test(milestone)) signals.push("标题/里程碑含 治理|门禁|控制塔");
  return signals;
}

/** 从卡面文本抽「线 N」（显式声明才算，抽不到返回 null）。 */
export function extractLines(card) {
  const hay = [card.note, typeof card.blocked === "string" ? card.blocked : card.blocked?.reason, card.title, card.milestone]
    .filter((s) => typeof s === "string")
    .join("\n");
  const found = new Set();
  for (const m of hay.matchAll(/线\s*(\d{1,3})/g)) found.add(Number(m[1]));
  for (const m of hay.matchAll(/(\d{1,3})\s*线(?![路条])/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/**
 * 「服务哪条主线」：显式字段优先 → 文本抽取 → null（不猜）。
 * @returns {{serves:string|null, serves_source:string}}
 */
export function resolveServes(card) {
  if (Number.isFinite(Number(card.line))) {
    return { serves: `线 ${Number(card.line)}`, serves_source: "卡面 line 字段" };
  }
  const lines = extractLines(card);
  if (lines.length > 0) {
    return { serves: lines.map((n) => `线 ${n}`).join("、"), serves_source: "卡面文本抽取" };
  }
  if (typeof card.milestone === "string" && card.milestone.trim() !== "") {
    return { serves: null, serves_source: "仅里程碑：" + card.milestone.trim(), milestone: card.milestone.trim() };
  }
  return { serves: null, serves_source: "卡面未声明" };
}

/**
 * 面板 B 取数。
 * @param {string} repoRoot
 * @param {{now?:Date}} [opts]
 * @returns {Promise<object>} 永不抛异常。
 */
export async function collectGovernance(repoRoot, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const degradedSources = [];

  const cardsRes = await readTaskCards(repoRoot).catch((err) => ({
    ok: false,
    degraded: true,
    error: `task-state 异常：${err?.message ?? err}`,
    cards: [],
    errors: []
  }));
  const backlogRes = await readRepoJson(repoRoot, BACKLOG_REL_PATH).catch((err) => ({
    ok: false,
    degraded: true,
    error: `board-backlog 异常：${err?.message ?? err}`,
    attempts: []
  }));

  if (!cardsRes.ok) degradedSources.push(`治理卡：${cardsRes.error}`);
  if (!backlogRes.ok) degradedSources.push(`欠账表：${backlogRes.error}`);

  const active = [];
  const resting = [];
  const byDomain = {};
  const signalCounts = {};
  const errors = [...(cardsRes.errors ?? [])];

  for (const c of cardsRes.cards ?? []) {
    const signals = governanceSignals(c);
    if (signals.length === 0) continue;
    for (const s of signals) signalCounts[s] = (signalCounts[s] ?? 0) + 1;

    const domain = typeof c.domain === "string" && c.domain !== "" ? c.domain : null;
    const key = domain ?? "—（卡面未声明）";
    byDomain[key] = (byDomain[key] ?? 0) + 1;

    const serves = resolveServes(c);
    const status = String(c.status ?? "");
    const blockedRaw = c.blocked;
    const blockedNote =
      typeof blockedRaw === "string"
        ? blockedRaw.replace(/\s+/g, " ").slice(0, 200)
        : blockedRaw && typeof blockedRaw === "object"
          ? String(blockedRaw.reason ?? "").replace(/\s+/g, " ").slice(0, 200)
          : null;

    const item = {
      id: c.task_id ?? null,
      title: c.title ?? "(无标题)",
      status: status || null,
      domain,
      domain_label: domain ?? "—（卡面未声明）",
      signals,
      serves: serves.serves,
      serves_source: serves.serves_source,
      milestone: c.milestone ?? null,
      owner: c.owner ?? null,
      risk: c.risk ?? null,
      depends_on: Array.isArray(c.depends_on) ? c.depends_on : [],
      blocked_note: blockedNote,
      updated_at: c.updated_at ?? null,
      waiting_days: c.updated_at ? daysBetween(c.updated_at, now) : null
    };

    if (ACTIVE_STATUSES.has(status)) active.push(item);
    else resting.push(item);
  }

  // 等待最久的排最前（创始人视角：先看卡最久的）
  const byWait = (a, b) => (b.waiting_days ?? -1) - (a.waiting_days ?? -1);
  active.sort(byWait);
  resting.sort(byWait);

  let debt = {
    ok: false,
    degraded: true,
    source: BACKLOG_REL_PATH,
    items: [],
    count: 0,
    error: backlogRes.error ?? "board-backlog 不可读",
    // 显式声明未消费 todos.yaml（T-*）及原因：本插件零依赖，不引入第二套 YAML 解析器 ——
    // 宁可少一个源并列明，也不静默漏源（铁律 24/31）。
    todos_yaml_note: "docs/synova/product-lines/todos.yaml（T-* 待办）未消费：插件零依赖，不引 YAML 解析器；该源由 task-board-adapter 的 Python 派生器消费"
  };
  if (backlogRes.ok) {
    const raw = Array.isArray(backlogRes.parsed?.backlog) ? backlogRes.parsed.backlog : [];
    const items = raw
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        id: x.id ?? null,
        title: x.title ?? "(无标题)",
        note: typeof x.note === "string" ? x.note.replace(/\s+/g, " ").slice(0, 200) : ""
      }));
    debt = {
      ok: true,
      degraded: false,
      source: BACKLOG_REL_PATH,
      source_detail: backlogRes.fallback_note,
      schema_version: backlogRes.parsed?.schemaVersion ?? null,
      items,
      count: items.length,
      todos_yaml_note: "docs/synova/product-lines/todos.yaml（T-* 待办）未消费：插件零依赖，不引 YAML 解析器；该源由 task-board-adapter 的 Python 派生器消费"
    };
  }

  return {
    ok: cardsRes.ok || debt.ok,
    degraded: degradedSources.length > 0,
    degraded_sources: degradedSources,
    generated_at: now.toISOString(),
    scope: {
      rule: "治理线 = 三条机器可见信号之一：① domain=doc-governance ② 标题以 CT- 开头 ③ 标题/里程碑含 治理|门禁|控制塔。逐卡回传命中信号，可复核可推翻。",
      signals: signalCounts
    },
    cards: {
      ok: cardsRes.ok,
      error: cardsRes.ok ? undefined : cardsRes.error,
      filter_note: "「服务哪条主线」只认卡面显式字段或文本里的『线 N』；没有就显示『—（卡面未声明）』，不猜。",
      active,
      resting,
      count: active.length + resting.length,
      active_count: active.length,
      resting_count: resting.length,
      by_domain: byDomain,
      read_errors: errors,
      read_error_count: errors.length
    },
    debt
  };
}
