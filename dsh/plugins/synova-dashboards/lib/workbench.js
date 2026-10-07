// lib/workbench.js — 「Synova 开发工作台」面板 A 取数器（纯 Node，无 cordis 依赖 → 可 node --test）
//
// 四块（每块**独立取数、独立降级**，任一块失败不影响其余 → 铁律 31）：
//   ① grid      四问格子矩阵   源 docs/synova/coordination/宪章三问-48格.json（机读单源，D1059 升四问=64 格）
//   ② flow      今日/本周流水  源 git log（本仓权威）+ GitHub PR API（见 lib/flow.js）
//   ③ decisions 待你裁        源 docs/synova/product-lines/product-progress.json#decisions
//                              （上游单源 = cockpit-override.yaml#pending_decisions，由 calc-progress.py 派生）
//                              + task-state 卡面文本扫描「需创始人」（**显式标注为文本扫描，不混入权威列表**）
//   ④ blocked   阻塞           源 ledger.json#blocked（三要素口径）+ product-progress 各线 blocked
//
// 契约（铁律 47）：
//   @input   repoRoot: string — SynovaAgent 仓库根
//            opts.now?: Date / opts.fetchImpl? / opts.credentialsPath? — 透传给 flow（测试可控）
//   @output  Promise<WorkbenchPayload>（**永不抛异常**）
//            {
//              ok: boolean, degraded: boolean, degraded_sources: string[],
//              generated_at: string,
//              grid: { ok, source, source_detail, schema, counts, derived, questions[], rows[], error?, attempts? },
//              flow: <lib/flow.js FlowResult>,
//              decisions: { ok, source, generated_at, pending[], pending_count, resolved_count, card_scan[], error? },
//              blocked: { ok, items[], count, nonconforming[], nonconforming_count, sources[], error? }
//            }
//   @口径（禁臆写，全部对齐既有机器口径）：
//     · 空格 = status 缺失/未知/empty ⇒ **一律 ⚪未填**，绝不折算成绿（院方 X27：缺失≠通过）。
//       本模块只按文件里的 status 原值分桶，未知值单独记 unknown，不改写、不猜测。
//     · 阻塞三要素 = {reason, since, needs} 齐全才计入（scripts/project/gen-project-board.py:66 口径），
//       缺一即"未申报"，单列 nonconforming **不静默补**。
//     · 待你裁 = status ≠ resolved 才算待裁；等待天数取该项自带日期字段，缺失则 null（UI 显 —）。
//   @write   零写入：只 readFile / 只读 git / 只读 HTTP GET。
import { readRepoJson } from "./repofile.js";
import { collectFlow } from "./flow.js";

/** 四问格子机读单源（D1059 起含 q4「删了吗」）。 */
export const GRID_REL_PATH = "docs/synova/coordination/宪章三问-48格.json";
/** 产品完成度（六态/五态桶 + pending decisions 派生件）。 */
export const PROGRESS_REL_PATH = "docs/synova/product-lines/product-progress.json";
/** 项目账本（阻塞清单权威派生件）。 */
export const LEDGER_REL_PATH = "docs/synova/project/ledger.json";
/** 任务卡目录（治理卡/阻塞申报/待裁文本扫描的共同源）。 */
export const TASK_STATE_DIR = "task-state";

/** 四色（与 scripts/control-tower/gen-charter-grid.py:15-16 同口径，禁第二套配色）。 */
export const GRID_COLORS = {
  green: { label: "🟢 生效了", color: "#0a7d32" },
  yellow: { label: "🟡 接了但没生效", color: "#b8860b" },
  red: { label: "🔴 缺失", color: "#b3261e" },
  empty: { label: "⚪ 未填", color: "#6b7280" }
};

/** 未填/待办态（显式，不伪装成绿）。normalizeStatus 直接消费该集合。 */
export const EMPTY_STATUSES = new Set(["", "empty", "blank", "todo", "未填", "待办", "null", "undefined"]);

/** 把任意 status 归一化到四色之一；未知值 → "unknown"（单独记，不改写成绿）。 */
export function normalizeStatus(status) {
  if (status === null || status === undefined) return "empty";
  const s = String(status).trim().toLowerCase();
  // 纯空白 = 没填（不是"未知"）：测试实测 "  " 曾落到 unknown，被记成"数据源有怪值"——语义错
  if (EMPTY_STATUSES.has(s)) return "empty";
  if (s === "green" || s === "ok" || s === "on" || s === "生效" || s === "生效了") return "green";
  if (s === "yellow" || s === "wired" || s === "接上" || s === "接了没生效") return "yellow";
  if (s === "red" || s === "missing" || s === "缺失") return "red";
  return "unknown";
}

/** 两个日期相差整天数（b - a，向下取整）；任一不可解析 → null。 */
export function daysBetween(a, b) {
  const ta = a instanceof Date ? a.getTime() : Date.parse(a);
  const tb = b instanceof Date ? b.getTime() : Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.floor((tb - ta) / 86400000);
}

/**
 * ① 四问格子：按 (layer, ext_point) 归行，保持文件内出现顺序；四问列取自文件。
 * @param {string} repoRoot
 * @returns {Promise<object>} 永不抛异常。
 */
export async function readGrid(repoRoot) {
  const r = await readRepoJson(repoRoot, GRID_REL_PATH);
  if (!r.ok) {
    return {
      ok: false,
      degraded: true,
      error: r.error,
      attempts: r.attempts,
      path: GRID_REL_PATH,
      rows: [],
      questions: [],
      counts: null
    };
  }
  const d = r.parsed;
  const cells = Array.isArray(d?.cells) ? d.cells : null;
  if (cells === null) {
    return {
      ok: false,
      degraded: true,
      error: `${GRID_REL_PATH} 结构异常：缺 cells 数组`,
      attempts: [`${GRID_REL_PATH} 缺 cells 数组`],
      path: GRID_REL_PATH,
      rows: [],
      questions: [],
      counts: null
    };
  }

  const rowMap = new Map();
  const qMap = new Map();
  const byStatus = { green: 0, yellow: 0, red: 0, empty: 0, unknown: 0 };
  const unknownStatuses = new Set();
  let malformed = 0;

  for (const c of cells) {
    // 非对象元素：计入 malformed 并**显式报出**（早前直接 continue，会在 derived.filled 里被算成"已填"）
    if (!c || typeof c !== "object") {
      malformed += 1;
      continue;
    }
    const q = String(c.question ?? "");
    if (!qMap.has(q)) {
      qMap.set(q, { code: q, text: c.question_text ?? q, desc: c.question_desc ?? "" });
    }
    const key = `${c.layer ?? ""}\u0000${c.ext_point ?? ""}`;
    if (!rowMap.has(key)) {
      rowMap.set(key, { layer: c.layer ?? "", ext_point: c.ext_point ?? "", cells: {} });
    }
    const st = normalizeStatus(c.status);
    if (st === "unknown") unknownStatuses.add(String(c.status));
    byStatus[st] += 1;
    rowMap.get(key).cells[q] = {
      id: c.id ?? null,
      status: st,
      status_raw: c.status ?? null,
      label: (GRID_COLORS[st] ?? GRID_COLORS.empty).label,
      priority: c.priority ?? null,
      judgement: c.judgement ?? "",
      command: c.command ?? "",
      evidence: c.evidence ?? "",
      basis: c.basis ?? "",
      owner: c.owner ?? "",
      updated_at: c.updated_at ?? ""
    };
  }

  const rows = [...rowMap.values()].map((row) => ({
    layer: row.layer,
    ext_point: row.ext_point,
    // 行优先级沿用生成器口径：取该行 q1 格的 priority（gen-charter-grid.py:31）
    priority: row.cells.q1?.priority ?? row.cells[Object.keys(row.cells)[0]]?.priority ?? null,
    cells: row.cells
  }));

  const fileCounts = d?.counts && typeof d.counts === "object" ? d.counts : {};
  // 已填 = 真正归一化过的格（非 empty）；malformed 既不算已填也不算未填，单独计数
  const filled = byStatus.green + byStatus.yellow + byStatus.red + byStatus.unknown;
  const issues = [];
  if (malformed > 0) issues.push(`cells 里有 ${malformed} 个非对象元素（已跳过，未计入已填）`);
  if (rows.length === 0) issues.push("格子文件 cells 解析后为 0 行 —— 视为结构异常（空矩阵不得冒充合法全未填）");
  const structuralDegraded = rows.length === 0;
  return {
    ok: !structuralDegraded,
    degraded: structuralDegraded,
    error: structuralDegraded ? `宪章格子结构异常：${issues.join("；")}` : undefined,
    issues,
    source: r.source,
    source_detail: r.fallback_note,
    path: GRID_REL_PATH,
    schema: d?.schema ?? null,
    rules: d?.rules ?? null,
    // 文件自带 counts（作者声明）+ derived（本模块按 cells 实数，逐格可核）——
    // 两者并列展示，冲突时以 derived 为准并可见（不覆盖文件值，不静默改口径）
    counts: {
      cells: fileCounts.cells ?? null,
      ext_points: fileCounts.ext_points ?? null,
      questions: fileCounts.questions ?? null,
      filled: fileCounts.filled ?? null
    },
    derived: {
      cells: cells.length,
      rows: rows.length,
      questions: qMap.size,
      filled,
      malformed,
      by_status: byStatus,
      unknown_statuses: [...unknownStatuses]
    },
    questions: [...qMap.values()],
    colors: GRID_COLORS,
    rows
  };
}

/**
 * ③ 待你裁：权威源（product-progress#decisions，status≠resolved）+ 卡面文本扫描（显式标注）。
 * @param {string} repoRoot
 * @param {Date} now
 * @param {Array<object>} cards 已读的任务卡（由 readTaskCards 提供，避免重复扫盘）
 */
export function buildDecisions(progress, cards, now) {
  const pending = [];
  const resolved = [];
  const src = progress?.ok ? progress.parsed?.decisions : null;
  const list = Array.isArray(src) ? src : [];
  for (const d of list) {
    if (!d || typeof d !== "object") continue;
    const status = String(d.status ?? "").toLowerCase();
    const isPending = status !== "resolved" && status !== "closed" && status !== "done";
    const anchor = d.raised_date ?? d.created_at ?? d.date ?? null;
    const item = {
      id: d.id ?? null,
      title: d.title ?? "(无标题)",
      context: d.context ?? "",
      options: Array.isArray(d.options) ? d.options : [],
      suggestion: d.suggestion ?? null,
      status: d.status ?? null,
      resolved_date: d.resolved_date ?? null,
      raised_date: anchor,
      waiting_days: anchor ? daysBetween(anchor, now) : null,
      waiting_unknown: !anchor
    };
    (isPending ? pending : resolved).push(item);
  }

  // 卡面文本扫描（**非权威**：卡 note/blocked 里出现「需创始人」的活卡）。
  // 单列 card_scan，绝不混进 pending —— 因为这些卡没有 options/suggestion 结构，
  // 混进去就等于替创始人造了一个没有依据的待裁项（禁臆写）。
  const scan = [];
  for (const c of cards) {
    const text = `${c.note ?? ""}\n${typeof c.blocked === "string" ? c.blocked : ""}`;
    if (!text.includes("需创始人")) continue;
    const st = String(c.status ?? "");
    if (st === "closed" || st === "rejected" || st === "cancelled") continue;
    scan.push({
      id: c.task_id ?? null,
      title: c.title ?? "(无标题)",
      status: c.status ?? null,
      updated_at: c.updated_at ?? null,
      waiting_days: c.updated_at ? daysBetween(c.updated_at, now) : null,
      excerpt: text.replace(/\s+/g, " ").slice(0, 160)
    });
  }

  return {
    ok: progress?.ok === true,
    degraded: progress?.ok !== true,
    error: progress?.ok ? undefined : progress?.error,
    source: PROGRESS_REL_PATH + "#decisions",
    upstream_source: "docs/synova/product-lines/cockpit-override.yaml#pending_decisions",
    generated_at: progress?.ok ? progress.parsed?.generated_at ?? null : null,
    pending,
    pending_count: pending.length,
    resolved_count: resolved.length,
    resolved,
    card_scan: scan,
    card_scan_count: scan.length
  };
}

/**
 * ④ 阻塞：ledger#blocked（三要素齐全）+ product-progress 各线 blocked；缺要素单列 nonconforming。
 * @param {object} ledger   readRepoJson(ledger) 结果
 * @param {object} progress readRepoJson(product-progress) 结果
 * @param {Array<object>} cards
 * @param {Date} now
 */
export function buildBlocked(ledger, progress, cards, now) {
  const items = [];
  const sources = [];
  const errors = [];
  const malformed = [];
  // 三要素门槛**统一施加于每一个入参**（不只在卡面对象上）——
  // 独立复核实测（2026-09-29）：原实现对 ledger / progress 的条目无条件计入，
  // 于是 `{id:'X'}` 这种缺要素条目会被计成"阻塞 1 条"，而面板文案却宣称"缺一不计入" = **口径声明与实际不符**。
  // 派生件（ledger.blocked 由 gen-project-board.py:66 三要素过滤后产出）通常三要素齐全，
  // 故正常数据行为不变；不齐全的一律单列 malformed，**不静默补、不计入**。
  const pushBlocked = (b, extra, src) => {
    if (!b || typeof b !== "object") {
      malformed.push(Object.assign({ kind: "非对象条目", note: JSON.stringify(b ?? null).slice(0, 120), source: src }, extra));
      return;
    }
    const reason = String(b.reason ?? "").trim();
    const since = b.since ?? null;
    const needs = String(b.needs ?? "").trim();
    if (!reason || !since || !needs) {
      malformed.push(Object.assign({
        kind: "三要素不全",
        note: [reason && "有 reason", since && "有 since", needs && "有 needs"].filter(Boolean).join("+") || "全缺",
        source: src
      }, extra));
      return;
    }
    items.push(Object.assign({
      id: b.id ?? null,
      reason,
      since,
      needs,
      days: Number.isFinite(b.days) ? b.days : daysBetween(since, now),
      source: src
    }, extra));
  };

  if (ledger?.ok) {
    const list = Array.isArray(ledger.parsed?.blocked) ? ledger.parsed.blocked : [];
    for (const b of list) pushBlocked(b, { line: b?.line ?? b?._line ?? null }, LEDGER_REL_PATH);
    sources.push(LEDGER_REL_PATH);
  } else {
    errors.push(ledger?.error ?? "ledger 不可读");
  }

  if (progress?.ok) {
    const lines = Array.isArray(progress.parsed?.lines) ? progress.parsed.lines : [];
    for (const l of lines) {
      const bl = Array.isArray(l?.blocked) ? l.blocked : [];
      for (const b of bl) {
        pushBlocked(b, { line: l?.id ?? l?.line ?? null, line_name: l?.name ?? null }, PROGRESS_REL_PATH + "#lines[].blocked");
      }
    }
    sources.push(PROGRESS_REL_PATH + "#lines[].blocked");
  } else {
    errors.push(progress?.error ?? "product-progress 不可读");
  }

  // ledger 不可读时：卡面里**三要素齐全**的阻塞本应由 ledger 派生出来，此刻不会出现 →
  // 直接以卡面为源计入（显式标注 source），否则这些真实阻塞会**静默消失**
  // （独立复核反例 CE4：卡面三要素齐全 + ledger 不可读 → count:0, nonconforming:0）。
  let cardFallbackCount = 0;
  if (!ledger?.ok) {
    for (const c of cards) {
      const blk = c.blocked;
      if (!blk || typeof blk !== "object" || Array.isArray(blk)) continue;
      const reason = String(blk.reason ?? "").trim();
      const since = blk.since ?? null;
      const needs = String(blk.needs ?? "").trim();
      if (!reason || !since || !needs) continue; // 不全的走下面 nonconforming 分支
      cardFallbackCount += 1;
      pushBlocked(blk, {
        // 卡面 blocked 对象本身常无 id（id 在卡上）→ 用 task_id 补，面板才点得出是谁
        id: blk.id ?? c.task_id ?? null,
        line: Number.isFinite(Number(c.line)) ? Number(c.line) : null
      }, TASK_STATE_DIR + "/" + (c.task_id ?? "?") + ".json");
    }
    if (cardFallbackCount > 0) sources.push(TASK_STATE_DIR + "/*.json（ledger 不可读时的卡面直取）");
  }

  // 去重：key 含 since/needs（独立复核反例 CE6：两条无 id 同 reason 但不同 since 的阻塞曾被误合一条）
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const k = `${it.id ?? ""}|${it.reason}|${it.since ?? ""}|${it.needs ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(it);
  }
  deduped.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  // 卡面 blocked 未按三要素申报（字符串备注 / 缺字段 / 其它类型）→ 单列，不静默补、不计入阻塞数
  const nonconforming = [];
  const pushNonconforming = (c, kind, note) => {
    nonconforming.push({
      id: c.task_id ?? null,
      status: c.status ?? null,
      kind,
      note: String(note ?? "").replace(/\s+/g, " ").slice(0, 160),
      updated_at: c.updated_at ?? null,
      days: c.updated_at ? daysBetween(c.updated_at, now) : null
    });
  };
  for (const c of cards) {
    const blk = c.blocked;
    if (blk === null || blk === undefined || blk === "") continue;
    if (typeof blk === "string") {
      if (blk.trim().startsWith("已解除")) continue;
      pushNonconforming(c, "字符串备注", blk);
      continue;
    }
    if (typeof blk === "object" && !Array.isArray(blk)) {
      const hasAll = Boolean(String(blk.reason ?? "").trim()) && Boolean(blk.since) && Boolean(String(blk.needs ?? "").trim());
      if (hasAll) continue; // 结构完整：已计入（ledger 派生，或 ledger 不可读时由上面的卡面直取计入）
      pushNonconforming(c, "三要素不全", blk.reason ?? blk.note ?? "");
      continue;
    }
    // 其它类型（true / 数字 / 数组）→ 早前被静默丢弃（独立复核反例 CE5）
    pushNonconforming(c, "类型非法（" + (Array.isArray(blk) ? "array" : typeof blk) + "）", JSON.stringify(blk));
  }

  // 上源 malformed 并入 nonconforming 展示（带 source，可核）
  for (const m of malformed) {
    nonconforming.push({
      id: m.id ?? null,
      status: m.status ?? null,
      kind: "上源" + m.kind,
      note: (m.note ?? "") + (m.source ? " ← " + m.source : ""),
      updated_at: null,
      days: null
    });
  }
  nonconforming.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  return {
    ok: sources.length > 0,
    degraded: errors.length > 0,
    error: errors.length > 0 ? errors.join("；") : undefined,
    errors,
    sources,
    items: deduped,
    count: deduped.length,
    nonconforming,
    nonconforming_count: nonconforming.length,
    malformed_upstream: malformed.length,
    card_fallback_count: cardFallbackCount,
    rule: "三要素 {reason, since, needs} 齐全才计入阻塞（scripts/project/gen-project-board.py:66 口径）；三个入参一视同仁，缺一即单列「未申报」，不计入"
  };
}

/** 读 task-state/D*.json（坏卡单独记入 errors，不整体失败）。 */
export async function readTaskCards(repoRoot) {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = `${repoRoot}/${TASK_STATE_DIR}`;
  const cards = [];
  const errors = [];
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    const code = err?.code ?? "EIO";
    return { ok: false, degraded: true, error: code === "ENOENT" ? `${TASK_STATE_DIR} 目录不存在` : `读目录失败（${code}）`, cards, errors };
  }
  for (const n of names) {
    if (!/^D\d+\.json$/.test(n)) continue;
    let raw;
    try {
      raw = await readFile(`${dir}/${n}`, "utf8");
    } catch (err) {
      errors.push(`${n}: 读取失败（${err?.code ?? "EIO"}）`);
      continue;
    }
    try {
      const d = JSON.parse(raw);
      if (d && typeof d === "object" && !Array.isArray(d)) cards.push(d);
      else errors.push(`${n}: 结构非对象`);
    } catch {
      errors.push(`${n}: 坏 JSON`);
    }
  }
  return { ok: true, degraded: errors.length > 0, cards, errors, count: cards.length };
}

/**
 * 组装面板 A 全量 payload。
 * @param {string} repoRoot
 * @param {{now?:Date, fetchImpl?:Function, credentialsPath?:string}} [opts]
 * @returns {Promise<object>} 永不抛异常。
 */
export async function collectWorkbench(repoRoot, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();

  const [grid, flow, ledger, progress, cardsRes] = await Promise.all([
    readGrid(repoRoot).catch((err) => ({ ok: false, degraded: true, error: `grid 异常：${err?.message ?? err}`, rows: [], questions: [], counts: null })),
    collectFlow(repoRoot, opts).catch((err) => ({ ok: false, degraded: true, error: `flow 异常：${err?.message ?? err}`, git: null, pr: null })),
    readRepoJson(repoRoot, LEDGER_REL_PATH).catch((err) => ({ ok: false, degraded: true, error: `ledger 异常：${err?.message ?? err}`, attempts: [] })),
    readRepoJson(repoRoot, PROGRESS_REL_PATH).catch((err) => ({ ok: false, degraded: true, error: `progress 异常：${err?.message ?? err}`, attempts: [] })),
    readTaskCards(repoRoot).catch((err) => ({ ok: false, degraded: true, error: `task-state 异常：${err?.message ?? err}`, cards: [], errors: [] }))
  ]);

  const cards = Array.isArray(cardsRes.cards) ? cardsRes.cards : [];
  const decisions = buildDecisions(progress, cards, now);
  const blocked = buildBlocked(ledger, progress, cards, now);

  // 降级清单必须覆盖**每一处**部分降级（铁律 31）。
  // 独立复核实测（2026-09-29）三处漏洞，此处逐条堵：
  //   a. blocked 只在 !ok 时上报 → ledger 整体不可读而 progress 可读时，面板展示残缺阻塞列表却零降级信号
  //   b. 任务卡坏 JSON（cardsRes.errors）从不入账 → 同数据在治理线可见、在面板 A 静默
  //   c. flow 无 degraded_sources 字段，引用它等于丢掉 git/pr 各自原因
  const degradedSources = [];
  if (!grid.ok) degradedSources.push(`宪章格子：${grid.error}`);

  const flowParts = [];
  if (flow?.ok !== true) flowParts.push("流水整体不可用");
  if (flow?.git && flow.git.ok !== true) flowParts.push(`git 流水：${flow.git.error ?? "不可用"}`);
  if (flow?.pr && flow.pr.ok !== true) flowParts.push(`PR：${flow.pr.error ?? "不可用"}`);
  if (flow?.pr && flow.pr.ok === true && flow.pr.source === "snapshot") flowParts.push(`PR：${flow.pr.note ?? "已回退快照"}`);
  if (flowParts.length > 0) degradedSources.push(flowParts.join("；"));

  if (!decisions.ok) degradedSources.push(`待你裁：${decisions.error}`);
  if (blocked.ok !== true) {
    degradedSources.push(`阻塞：${blocked.error ?? "不可用"}`);
  } else if (blocked.degraded === true) {
    degradedSources.push(`阻塞（部分）：${blocked.error}`);
  }
  if (cardsRes.ok === false) degradedSources.push(`任务卡：${cardsRes.error}`);
  else if (Array.isArray(cardsRes.errors) && cardsRes.errors.length > 0) {
    degradedSources.push(`任务卡（${cardsRes.errors.length} 张坏卡）：${cardsRes.errors.slice(0, 3).join("；")}`);
  }
  if (Array.isArray(grid.issues) && grid.issues.length > 0 && grid.ok === true) {
    degradedSources.push(`宪章格子（结构提示）：${grid.issues.join("；")}`);
  }

  return {
    ok: grid.ok || flow.ok || decisions.ok || blocked.ok,
    degraded: degradedSources.length > 0,
    degraded_sources: degradedSources,
    generated_at: now.toISOString(),
    grid,
    flow,
    decisions,
    blocked,
    task_cards: {
      ok: cardsRes.ok === true,
      count: cards.length,
      error: cardsRes.error,
      errors: Array.isArray(cardsRes.errors) ? cardsRes.errors : [],
      error_count: Array.isArray(cardsRes.errors) ? cardsRes.errors.length : 0
    }
  };
}
