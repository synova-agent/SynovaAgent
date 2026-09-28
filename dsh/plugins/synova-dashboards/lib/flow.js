// lib/flow.js — 「开发工作台」区块② 今日/本周流水：git log（本地权威）+ PR（GitHub API）
//
// 契约（铁律 47）：
//   @input   repoRoot: string — SynovaAgent 仓库根
//            opts.now?: Date   — 注入"现在"（测试可控；默认 new Date()）
//            opts.credentialsPath?: string — GitHub 凭据文件（默认 ~/.dsh/.credentials.yaml，
//                                            与 scripts/project/pr-queue-scan.py 同一来源）
//            opts.fetchImpl?: typeof fetch — 注入 fetch（测试可控；默认全局 fetch）
//   @output  Promise<FlowResult>（**永不抛异常**）
//            {
//              ok: boolean,                 // 两个子块都失败才 false
//              generated_at: string,        // ISO8601
//              git:  { ok, degraded, error?, today:{since,commits:[…],capped}, week:{…} },
//              pr:   { ok, degraded, source:"api"|"snapshot", note?, generated_at?,
//                      open:[…], merged_week:[…], merged_today:[…], counts:{…} }
//            }
//   @取数
//     git：`git log --since=<ISO>` 只读；分「今日 00:00 本地」与「本周一 00:00 本地」两个窗口。
//     PR ：① GitHub API 两次只读 GET：`/pulls?state=open`（未合队列，~720KB/2.1s）
//              + `/search/issues?q=is:pr is:merged merged:>=<本周一>`（本周已合，~15KB/0.8s；
//                不用 `/pulls?state=closed` —— 它按 updated 排序，最近关闭的多为未合并清理，
//                统计"本周合并数"会恒为 0 而不报错 = 静默假数）
//              token 取自凭据文件，**只用于请求头，绝不回传/落盘/打印**
//          ② 任一步失败 → 回退仓库内机器生成的快照 docs/synova/project/pr-queue.json
//             （快照带 generated_at，UI 显式标注"快照"而非冒充实时，且不伪造"今日合并"）
//          ③ 两级都失败 → pr.ok=false + degraded + error
//   @degraded 全部失败路径都带 error/attempts，禁静默（铁律 24/31）；不写盘（零写入铁律）
//   @security 本模块只读凭据、只发只读 GET；返回体不含 token/密码字段。
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { gitRead, readRepoJson } from "./repofile.js";

/** PR 快照（机器生成，pr-queue-scan.py 产物）——API 不可达时的显式回退源。 */
export const PR_SNAPSHOT_REL = "docs/synova/project/pr-queue.json";

/** 凭据文件（与 scripts/project/pr-queue-scan.py 同源；不打印内容）。 */
export const DEFAULT_CREDENTIALS = join(homedir(), ".dsh", ".credentials.yaml");

/** git log 单窗口抓取上限（超过则 capped=true 显式标注，绝不假装全量）。 */
export const LOG_LIMIT = 500;

const REC_SEP = "\x1e";
const FIELD_SEP = "\x1f";

/** 本地时区当天 00:00。 */
export function startOfToday(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/** 本地时区本周一 00:00（周日算上一周的第 7 天）。 */
export function startOfWeek(now) {
  const d = startOfToday(now);
  const dow = d.getDay(); // 0=周日
  const back = dow === 0 ? 6 : dow - 1;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 0, 0, 0, 0);
}

/** 解析 `git log --pretty=format:%h%x1f%ad%x1f%an%x1f%s%x1e` 输出。 */
export function parseGitLog(stdout) {
  if (!stdout) return [];
  return stdout
    .split(REC_SEP)
    .map((s) => s.replace(/^\s+/, ""))
    .filter((s) => s.length > 0)
    .map((rec) => {
      const parts = rec.split(FIELD_SEP);
      return {
        hash: parts[0] ?? "",
        date: parts[1] ?? "",
        author: parts[2] ?? "",
        subject: parts.slice(3).join(FIELD_SEP).trim()
      };
    })
    .filter((c) => c.hash.length > 0);
}

async function readGitWindow(repoRoot, since, now) {
  const sinceIso = since.toISOString();
  const out = await gitRead(repoRoot, [
    "log",
    `--since=${sinceIso}`,
    `-n`,
    String(LOG_LIMIT),
    "--date=iso-strict",
    `--pretty=format:%h${FIELD_SEP}%ad${FIELD_SEP}%an${FIELD_SEP}%s${REC_SEP}`
  ]);
  if (!out.ok) return { ok: false, degraded: true, error: out.error, since: sinceIso, commits: [], capped: false };
  const commits = parseGitLog(out.stdout);
  return {
    ok: true,
    degraded: false,
    since: sinceIso,
    commits,
    capped: commits.length >= LOG_LIMIT,
    window_days: Math.max(1, Math.round((now.getTime() - since.getTime()) / 86400000))
  };
}

/** 只读凭据文件取 GITHUB_TOKEN（与 house 扫描器同源）。绝不回传内容。 */
export async function readGithubToken(path = DEFAULT_CREDENTIALS) {
  const envTok = process.env.SYNOVA_GITHUB_TOKEN;
  if (typeof envTok === "string" && envTok.trim() !== "") {
    return { ok: true, token: envTok.trim(), source: "env:SYNOVA_GITHUB_TOKEN" };
  }
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const code = err?.code ?? "EIO";
    return {
      ok: false,
      error: code === "ENOENT" ? `无凭据文件 ${path}` : `凭据读取失败（${code}）`
    };
  }
  const m = raw.match(/GITHUB_TOKEN:\s*("([^"]*)"|'([^']*)'|(\S+))/);
  const token = m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
  if (!token) return { ok: false, error: "凭据文件无 GITHUB_TOKEN 字段" };
  // 只回传**来源类型**，不回传路径：绝对路径会随 200 响应出网（独立复核 finding f）
  return { ok: true, token, source: "file" };
}

/**
 * 脱敏：把 token 明文从任何将要回传/落日志的字符串里抹掉。
 * 独立复核 finding 5：自定义 fetch 可能把请求头原文塞进 error.message，
 * 一旦原样回传就会**把 token 写进 200 响应体**。此处兜底，改后不可复现。
 */
export function redact(text, token) {
  const s = String(text ?? "");
  if (!token || token.length < 8) return s;
  return s.split(token).join("***");
}

/** 从 origin remote URL 解析 owner/repo（不硬编码仓库名）。 */
export async function readRepoSlug(repoRoot) {
  const out = await gitRead(repoRoot, ["remote", "get-url", "origin"]);
  if (!out.ok) return { ok: false, error: out.error };
  const url = out.stdout.trim();
  const m = url.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return { ok: false, error: `origin 不是 GitHub 仓库：${url}` };
  return { ok: true, slug: `${m[1]}/${m[2]}` };
}

/** 单条 PR 的**最小只读投影**（刻意不含任何 token 相关字段）。 */
function projectPr(p) {
  return {
    number: p.number,
    title: p.title,
    user: p.user?.login ?? null,
    draft: p.draft === true,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
    merged_at: p.merged_at ?? null,
    head_ref: p.head?.ref ?? null,
    html_url: p.html_url ?? null
  };
}

async function fetchPrPage(fetchImpl, slug, token, query) {
  const url = `https://api.github.com/repos/${slug}/pulls?${query}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "synova-dsh-dashboards"
      },
      signal: ctrl.signal
    });
    if (!res.ok) return { ok: false, error: `GitHub API HTTP ${res.status}` };
    const body = await res.json();
    if (!Array.isArray(body)) return { ok: false, error: "GitHub API 返回非数组" };
    return { ok: true, items: body.map(projectPr) };
  } catch (err) {
    const msg = err?.name === "AbortError" ? "GitHub API 超时（8s）" : `GitHub API 失败：${redact(err?.message ?? err, token)}`;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 已合并 PR：走 search API（`is:merged merged:>=<日期>`）——**唯一**能按"合并时间窗口"取数的官方口径。
 * 为什么不用 `GET /pulls?state=closed`：该端点按 updated 排序，返回的 30 条可能一条都没合并
 * （实测：本仓最近关闭的多为未合并清理），拿它统计"本周合并数"会恒为 0 而不报错 —— 静默假数。
 * search API 单次 ~15KB / 0.8s（对比 pulls 全量 720KB / 2.1s），且 rate limit 30/min 足够 60s 轮询。
 */
async function fetchMergedSince(fetchImpl, slug, token, sinceDate) {
  const day = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, "0")}-${String(sinceDate.getDate()).padStart(2, "0")}`;
  const q = encodeURIComponent(`repo:${slug} is:pr is:merged merged:>=${day}`);
  const url = `https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=100`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "synova-dsh-dashboards"
      },
      signal: ctrl.signal
    });
    if (!res.ok) return { ok: false, error: `GitHub search HTTP ${res.status}` };
    const body = await res.json();
    const items = Array.isArray(body?.items) ? body.items : null;
    if (items === null) return { ok: false, error: "GitHub search 返回结构异常（缺 items）" };
    return {
      ok: true,
      total_count: Number.isFinite(body.total_count) ? body.total_count : items.length,
      capped: Number.isFinite(body.total_count) && body.total_count > items.length,
      items: items.map((p) => ({
        number: p.number,
        title: p.title,
        user: p.user?.login ?? null,
        draft: p.draft === true,
        created_at: p.created_at ?? null,
        updated_at: p.updated_at ?? null,
        merged_at: p.pull_request?.merged_at ?? p.closed_at ?? null,
        html_url: p.html_url ?? null
      }))
    };
  } catch (err) {
    const msg = err?.name === "AbortError" ? "GitHub search 超时（8s）" : `GitHub search 失败：${redact(err?.message ?? err, token)}`;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 实时 PR 取数（两级：open + 最近关闭），失败返回 ok:false 由调用方回退快照。 */
async function readPrApi(repoRoot, now, opts) {
  const attempts = [];
  const slug = await readRepoSlug(repoRoot);
  if (!slug.ok) return { ok: false, attempts: [slug.error] };
  const tok = await readGithubToken(opts.credentialsPath);
  if (!tok.ok) return { ok: false, attempts: [tok.error] };

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return { ok: false, attempts: ["运行环境无 fetch"] };

  const open = await fetchPrPage(fetchImpl, slug.slug, tok.token, "state=open&sort=updated&direction=desc&per_page=30");
  if (!open.ok) attempts.push(`open: ${open.error}`);
  const mergedRes = await fetchMergedSince(fetchImpl, slug.slug, tok.token, startOfWeek(now));
  if (!mergedRes.ok) attempts.push(`merged: ${mergedRes.error}`);
  if (!open.ok && !mergedRes.ok) return { ok: false, attempts };

  const todayIso = startOfToday(now).getTime();
  const weekIso = startOfWeek(now).getTime();
  const ts = (s) => (s ? Date.parse(s) : NaN);
  const openItems = open.ok ? open.items : [];
  const mergedItems = mergedRes.ok ? mergedRes.items : [];
  const inWin = (list, from) => list.filter((p) => Number.isFinite(ts(p.merged_at)) && ts(p.merged_at) >= from);

  return {
    ok: true,
    source: "api",
    slug: slug.slug,
    credential_source: tok.source,
    partial: attempts.length > 0,
    attempts,
    open: openItems,
    merged_recent: mergedItems,
    merged_window_since: startOfWeek(now).toISOString(),
    merged_total_count: mergedRes.ok ? mergedRes.total_count : null,
    merged_capped: mergedRes.ok ? mergedRes.capped === true : false,
    opened_today: openItems.filter((p) => Number.isFinite(ts(p.created_at)) && ts(p.created_at) >= todayIso),
    opened_week: openItems.filter((p) => Number.isFinite(ts(p.created_at)) && ts(p.created_at) >= weekIso),
    merged_today: inWin(mergedItems, todayIso),
    merged_week: inWin(mergedItems, weekIso),
    counts: {
      open: openItems.length,
      open_today: openItems.filter((p) => Number.isFinite(ts(p.created_at)) && ts(p.created_at) >= todayIso).length,
      open_week: openItems.filter((p) => Number.isFinite(ts(p.created_at)) && ts(p.created_at) >= weekIso).length,
      merged_today: inWin(mergedItems, todayIso).length,
      merged_week: inWin(mergedItems, weekIso).length,
      merged_total_count: mergedRes.ok ? mergedRes.total_count : null
    }
  };
}

/** 快照回退：docs/synova/project/pr-queue.json（机器生成，带 generated_at）。 */
async function readPrSnapshot(repoRoot, now) {
  const r = await readRepoJson(repoRoot, PR_SNAPSHOT_REL);
  if (!r.ok) return { ok: false, attempts: r.attempts };
  const d = r.parsed;
  const records = Array.isArray(d?.records) ? d.records : [];
  const metrics = d?.metrics && typeof d.metrics === "object" ? d.metrics : {};
  const ageDays = d?.generated_at ? Math.floor((now.getTime() - Date.parse(d.generated_at)) / 86400000) : null;
  return {
    ok: true,
    source: "snapshot",
    source_detail: r.source,
    generated_at: d?.generated_at ?? null,
    age_days: Number.isFinite(ageDays) ? ageDays : null,
    degraded: false,
    // 快照是**点快照**：只有 open 队列，没有「今日合并」语义 → 显式留空而非拿旧数据充今日
    open: records.map((x) => ({
      number: x.number,
      title: x.title,
      user: x.owner ?? null,
      draft: false,
      created_at: x.created_at ?? null,
      updated_at: null,
      merged_at: null,
      head_ref: x.head_ref ?? null,
      age_days: x.age_days ?? null,
      behind: x.behind ?? null,
      ci_state: x.ci_state ?? null,
      closeable: x.closeable === true,
      html_url: null
    })),
    merged_today: [],
    merged_week: [],
    opened_today: [],
    opened_week: [],
    counts: {
      open: Number.isFinite(metrics.queue_length) ? metrics.queue_length : records.length,
      over_limit: metrics.over_limit === true,
      limit: Number.isFinite(metrics.limit) ? metrics.limit : null,
      closeable_count: Number.isFinite(metrics.closeable_count) ? metrics.closeable_count : null,
      oldest: metrics.oldest ?? null,
      ci_distribution: metrics.ci_distribution ?? null
    },
    warning: typeof d?.warning === "string" ? d.warning : null
  };
}

/**
 * 组装区块②：git 流水（今日/本周）+ PR 流水（API → 快照 → 显式降级）。
 * @param {string} repoRoot
 * @param {{now?:Date, credentialsPath?:string, fetchImpl?:Function}} [opts]
 * @returns {Promise<object>} 永不抛异常。
 */
export async function collectFlow(repoRoot, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const today = startOfToday(now);
  const week = startOfWeek(now);

  const [gitToday, gitWeek] = await Promise.all([
    readGitWindow(repoRoot, today, now).catch((err) => ({
      ok: false,
      degraded: true,
      error: `git 今日窗口异常：${err?.message ?? err}`,
      since: today.toISOString(),
      commits: [],
      capped: false
    })),
    readGitWindow(repoRoot, week, now).catch((err) => ({
      ok: false,
      degraded: true,
      error: `git 本周窗口异常：${err?.message ?? err}`,
      since: week.toISOString(),
      commits: [],
      capped: false
    }))
  ]);

  const git = {
    ok: gitToday.ok || gitWeek.ok,
    degraded: !(gitToday.ok && gitWeek.ok),
    error: [gitToday.error, gitWeek.error].filter(Boolean).join("；") || undefined,
    today: gitToday,
    week: gitWeek
  };

  let pr;
  const api = await readPrApi(repoRoot, now, opts).catch((err) => ({ ok: false, attempts: [`API 异常：${err?.message ?? err}`] }));
  if (api.ok) {
    pr = api;
  } else {
    const snap = await readPrSnapshot(repoRoot, now).catch((err) => ({ ok: false, attempts: [`快照异常：${err?.message ?? err}`] }));
    if (snap.ok) {
      pr = {
        ...snap,
        note: `GitHub API 不可用，已回退 PR 快照（${PR_SNAPSHOT_REL}，生成于 ${snap.generated_at ?? "未知"}）`,
        attempts: [...(api.attempts ?? []), ...(snap.attempts ?? [])]
      };
    } else {
      pr = {
        ok: false,
        degraded: true,
        source: null,
        error: [...(api.attempts ?? []), ...(snap.attempts ?? [])].join("；") || "PR 取数失败",
        attempts: [...(api.attempts ?? []), ...(snap.attempts ?? [])]
      };
    }
  }

  return {
    ok: git.ok || pr.ok,
    degraded: !(git.ok && pr.ok),
    generated_at: now.toISOString(),
    git,
    pr
  };
}
