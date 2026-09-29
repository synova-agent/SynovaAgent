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
import { join } from "node:path";
import { readRepoJson, provenanceOf, provenanceSummary } from "./repofile.js";
import { readTaskCards, daysBetween } from "./workbench.js";

/** 欠账/待规划表（机器生成；task-board-adapter 消费的同一份）。 */
export const BACKLOG_REL_PATH = "docs/synova/coordination/board-backlog.json";

/** D1066 §一.4：治理卡台账落库件（仓库内、机器生成；面板主源）。 */
export const GOVERNANCE_LEDGER_REL = "docs/synova/coordination/governance-tasks.json";

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

  // ── ① 主源：仓库内落库件 governance-tasks.json（D1066 §一.4「治理落库」）──────
  // 治「数据源在库外档案仓 / 每次请求现场扫 390 张卡」：面板改读仓库内机读件，
  // 且落库件自带 generated_at ⇒ 陈旧可见（见 provenance）。
  const ledgerRes = await readRepoJson(repoRoot, GOVERNANCE_LEDGER_REL).catch((err) => ({
    ok: false, degraded: true, error: `governance-tasks.json 异常：${err?.message ?? err}`, attempts: []
  }));
  const ledgerDoc = ledgerRes.ok === true && Array.isArray(ledgerRes.parsed?.cards) ? ledgerRes.parsed : null;

  // ── ② 回退源：现场扫描（**仅当落库件不可用**，且回退本身显式入 degraded_sources）──
  let cardsRes = { ok: false, cards: [], errors: [], error: "未扫描（落库件可用）" };
  let backlogRes = { ok: false, error: "未读取（落库件可用）" };
  if (!ledgerDoc) {
    [cardsRes, backlogRes] = await Promise.all([
      readTaskCards(repoRoot).catch((err) => ({ ok: false, degraded: true, error: `task-state 异常：${err?.message ?? err}`, cards: [], errors: [] })),
      readRepoJson(repoRoot, BACKLOG_REL_PATH).catch((err) => ({ ok: false, degraded: true, error: `board-backlog 异常：${err?.message ?? err}`, attempts: [] }))
    ]);
    degradedSources.push(
      `治理台账落库件不可用（${ledgerRes.error ?? "结构异常"}）→ 已回退现场扫描 task-state；` +
      `该回退态下数据源仍在库外实时扫，建议跑 node dsh/plugins/synova-dashboards/scripts/gen-governance-ledger.mjs --repo-root <repo> 落库`
    );
    if (!cardsRes.ok) degradedSources.push(`治理卡：${cardsRes.error}`);
    if (!backlogRes.ok) degradedSources.push(`欠账表：${backlogRes.error}`);
  } else if (ledgerDoc.degraded === true) {
    degradedSources.push(`落库件自身降级：${(ledgerDoc.degraded_sources ?? []).join("；") || "未注明"}`);
  }

  const active = [];
  const resting = [];
  const byDomain = {};
  const signalCounts = {};
  const errors = ledgerDoc ? [] : [...(cardsRes.errors ?? [])];

  const pushCard = (item) => {
    const key = item.domain_label ?? "—（卡面未声明）";
    byDomain[key] = (byDomain[key] ?? 0) + 1;
    for (const s of item.signals ?? []) signalCounts[s] = (signalCounts[s] ?? 0) + 1;
    if (ACTIVE_STATUSES.has(String(item.status ?? ""))) active.push(item);
    else resting.push(item);
  };

  if (ledgerDoc) {
    // 落库件路径：卡已是面板形状（生成器用同一套 governanceSignals/resolveServes 产出）
    for (const c of ledgerDoc.cards) {
      if (!c || typeof c !== "object") continue;
      pushCard({
        id: c.id ?? null,
        title: c.title ?? "(无标题)",
        status: c.status ?? null,
        domain: c.domain ?? null,
        domain_label: c.domain_label ?? (c.domain ?? "—（卡面未声明）"),
        signals: Array.isArray(c.signals) ? c.signals : [],
        serves: c.serves ?? null,
        serves_source: c.serves_source ?? "卡面未声明",
        milestone: c.milestone ?? null,
        owner: c.owner ?? null,
        risk: c.risk ?? null,
        depends_on: Array.isArray(c.depends_on) ? c.depends_on : [],
        blocked_note: c.blocked_note ?? null,
        updated_at: c.updated_at ?? null,
        waiting_days: c.waiting_days ?? null
      });
    }
  } else {
    for (const c of cardsRes.cards ?? []) {
      const signals = governanceSignals(c);
      if (signals.length === 0) continue;
      const domain = typeof c.domain === "string" && c.domain !== "" ? c.domain : null;
      const serves = resolveServes(c);
      const blockedRaw = c.blocked;
      const blockedNote =
        typeof blockedRaw === "string"
          ? blockedRaw.replace(/\s+/g, " ").slice(0, 200)
          : blockedRaw && typeof blockedRaw === "object"
            ? String(blockedRaw.reason ?? "").replace(/\s+/g, " ").slice(0, 200)
            : null;
      pushCard({
        id: c.task_id ?? null,
        title: c.title ?? "(无标题)",
        status: c.status ?? null,
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
      });
    }
  }

  // 等待最久的排最前（创始人视角：先看卡最久的）
  const byWait = (a, b) => (b.waiting_days ?? -1) - (a.waiting_days ?? -1);
  active.sort(byWait);
  resting.sort(byWait);

  // ── ③ 欠账/待规划 ────────────────────────────────────────────────────────
  const TODOS_NOTE = "docs/synova/product-lines/todos.yaml（T-* 待办）未消费：插件零依赖，不引 YAML 解析器；该源由 task-board-adapter 的 Python 派生器消费";
  let debt;
  if (ledgerDoc) {
    const items = Array.isArray(ledgerDoc.debt) ? ledgerDoc.debt : [];
    debt = {
      ok: true,
      degraded: false,
      source: GOVERNANCE_LEDGER_REL + "#debt",
      source_detail: ledgerRes.fallback_note,
      generated_at: ledgerDoc.generated_at ?? null,
      items,
      count: items.length,
      todos_yaml_note: TODOS_NOTE
    };
  } else if (backlogRes.ok) {
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
      generated_at: backlogRes.parsed?.generated_at ?? null,
      schema_version: backlogRes.parsed?.schemaVersion ?? null,
      items,
      count: items.length,
      todos_yaml_note: TODOS_NOTE
    };
  } else {
    debt = {
      ok: false,
      degraded: true,
      source: BACKLOG_REL_PATH,
      items: [],
      count: 0,
      error: backlogRes.error ?? "board-backlog 不可读",
      todos_yaml_note: TODOS_NOTE
    };
  }

  // ── ④ D1066「时效真」：来源 + 生成时间 + 陈旧 + 易失路径自检 ────────────────
  const provenance = [
    provenanceOf({
      label: ledgerDoc ? "治理台账（仓库内落库件）" : "治理卡（现场扫描回退）",
      path: join(repoRoot, GOVERNANCE_LEDGER_REL),
      source: ledgerDoc ? ledgerRes.source : "task-state(live)",
      generated_at: ledgerDoc ? ledgerDoc.generated_at ?? null : now,
      now,
      note: ledgerDoc ? null : `落库件不可用：${ledgerRes.error ?? "结构异常"}`
    }),
    provenanceOf({
      label: "欠账/待规划",
      path: join(repoRoot, debt.source === GOVERNANCE_LEDGER_REL + "#debt" ? GOVERNANCE_LEDGER_REL : BACKLOG_REL_PATH),
      source: debt.ok ? debt.source : null,
      generated_at: debt.generated_at ?? null,
      now
    })
  ];

  return {
    ok: (ledgerDoc ? ledgerDoc.cards.length > 0 : cardsRes.ok) || debt.ok,
    degraded: degradedSources.length > 0,
    degraded_sources: degradedSources,
    generated_at: now.toISOString(),
    source_mode: ledgerDoc ? "in-repo-ledger" : "live-scan-fallback",
    ledger: ledgerDoc
      ? {
          ok: true,
          path: GOVERNANCE_LEDGER_REL,
          source: ledgerRes.source,
          generated_at: ledgerDoc.generated_at ?? null,
          schema: ledgerDoc.schema ?? null,
          generated_by: ledgerDoc.generated_by ?? null,
          counts: ledgerDoc.counts ?? null,
          degraded: ledgerDoc.degraded === true,
          degraded_sources: ledgerDoc.degraded_sources ?? []
        }
      : {
          ok: false,
          path: GOVERNANCE_LEDGER_REL,
          error: ledgerRes.error ?? "落库件结构异常",
          hint: "跑 node dsh/plugins/synova-dashboards/scripts/gen-governance-ledger.mjs --repo-root <repo> 落库"
        },
    provenance,
    provenance_summary: provenanceSummary(provenance),
    scope: {
      rule: "治理线 = 三条机器可见信号之一：① domain=doc-governance ② 标题以 CT- 开头 ③ 标题/里程碑含 治理|门禁|控制塔。逐卡回传命中信号，可复核可推翻。",
      signals: signalCounts
    },
    cards: {
      ok: ledgerDoc ? true : cardsRes.ok,
      error: ledgerDoc ? undefined : (cardsRes.ok ? undefined : cardsRes.error),
      source: ledgerDoc ? GOVERNANCE_LEDGER_REL : "task-state(现场扫描)",
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
