// test/flow.test.js — 「今日/本周流水」取数器单元测试（node:test）
// 覆盖：时间窗计算（含周日边界）/ git log 解析 / 凭据只读 / repo slug 解析 /
//       PR API 正常-部分失败 / API 失败回退快照（显式标注）/ 两级都失败降级
// 铁律 48：非空壳，每条路径都有真实断言。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  collectFlow, parseGitLog, startOfToday, startOfWeek, readGithubToken,
  readRepoSlug, PR_SNAPSHOT_REL, LOG_LIMIT
} from "../lib/flow.js";

function makeDir(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "synova-flow-"));
  for (const [rel, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

/** git 夹具：真仓库 + 一次提交 + origin remote（不进网，只用于 remote 解析）。 */
function makeGitRepo({ remote = "git@github.com:tangbaobao520/SynovaAgent.git", commit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "synova-flowgit-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "tester");
  git("config", "commit.gpgsign", "false");
  if (remote) git("remote", "add", "origin", remote);
  if (commit) {
    writeFileSync(join(root, "a.txt"), "a");
    git("add", "a.txt");
    git("commit", "-q", "-m", "feat: 首次提交");
  }
  return root;
}

/** 造一个 PR API 假响应（只实现本模块读取的字段）。 */
function prJson(number, over = {}) {
  return Object.assign({
    number, title: "PR " + number, draft: false,
    user: { login: "u" }, created_at: "2026-09-29T01:00:00Z",
    updated_at: "2026-09-29T02:00:00Z", merged_at: null,
    head: { ref: "feat/x" }, html_url: "https://example/" + number
  }, over);
}

// ── 时间窗 ────────────────────────────────────────────────────────────────
test("startOfToday：本地 00:00；startOfWeek：本周一 00:00（周日归上一周）", () => {
  const t = startOfToday(new Date("2026-09-29T15:04:05+08:00"));
  assert.equal(t.getDate(), 29);
  assert.equal(t.getHours(), 0);
  assert.equal(t.getMinutes(), 0);

  // 2026-09-29 是周二 → 本周一 = 09-28
  assert.equal(startOfWeek(new Date("2026-09-29T15:00:00+08:00")).getDate(), 28);
  // 2026-09-28 是周一 → 本周一 = 自己
  assert.equal(startOfWeek(new Date("2026-09-28T00:30:00+08:00")).getDate(), 28);
  // 2026-09-27 是周日 → 本周一 = 09-21（周日不得算作新一周起点）
  assert.equal(startOfWeek(new Date("2026-09-27T23:59:00+08:00")).getDate(), 21);
});

test("parseGitLog：按 \\x1e/\\x1f 解析多行提交，subject 含分隔符也要完整保留", () => {
  const raw = "abc123\x1f2026-09-29T01:01:49+08:00\x1ftangbaobao520\x1fmerge(D1060): 并入前置\x1e" +
              "def456\x1f2026-09-28T09:25:13+08:00\x1fu\x1fdocs: B2 出库\x1e";
  const commits = parseGitLog(raw);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0], { hash: "abc123", date: "2026-09-29T01:01:49+08:00", author: "tangbaobao520", subject: "merge(D1060): 并入前置" });
  assert.deepEqual(parseGitLog(""), []);
  assert.deepEqual(parseGitLog(undefined), []);
  assert.equal(LOG_LIMIT, 500);
});

// ── 凭据 ──────────────────────────────────────────────────────────────────
test("readGithubToken：env 覆盖优先；文件缺 GITHUB_TOKEN 字段 → 显式失败；文件不存在 → 显式失败", async () => {
  const prev = process.env.SYNOVA_GITHUB_TOKEN;
  try {
    process.env.SYNOVA_GITHUB_TOKEN = "env-token";
    const envHit = await readGithubToken("/nonexistent/path");
    assert.equal(envHit.ok, true);
    assert.equal(envHit.token, "env-token");
    assert.match(envHit.source, /^env:/);
  } finally {
    if (prev === undefined) delete process.env.SYNOVA_GITHUB_TOKEN;
    else process.env.SYNOVA_GITHUB_TOKEN = prev;
  }

  const dir = makeDir({ "creds.yaml": "OTHER: 1\n# comment\n" });
  const noField = await readGithubToken(join(dir, "creds.yaml"));
  assert.equal(noField.ok, false);
  assert.match(noField.error, /无 GITHUB_TOKEN 字段/);

  const withTok = makeDir({ "creds.yaml": 'GITHUB_TOKEN: "ghp_secret_value"\nOTHER: 2\n' });
  const ok = await readGithubToken(join(withTok, "creds.yaml"));
  assert.equal(ok.ok, true);
  assert.equal(ok.token, "ghp_secret_value", "引号必须剥掉");
  assert.match(ok.source, /^file:/);

  const missing = await readGithubToken(join(makeDir({}), "nope.yaml"));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /无凭据文件/);
});

test("readRepoSlug：从 origin URL 解析 owner/repo（ssh 与 https 两种）；非 GitHub → 显式失败", async () => {
  const sshRepo = makeGitRepo({ remote: "git@github.com:tangbaobao520/SynovaAgent.git" });
  assert.deepEqual(await readRepoSlug(sshRepo), { ok: true, slug: "tangbaobao520/SynovaAgent" });
  const httpsRepo = makeGitRepo({ remote: "https://github.com/o/r.git" });
  assert.deepEqual(await readRepoSlug(httpsRepo), { ok: true, slug: "o/r" });
  const localRepo = makeGitRepo({ remote: "/tmp/local/path" });
  const bad = await readRepoSlug(localRepo);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不是 GitHub 仓库/);
});

// ── collectFlow ───────────────────────────────────────────────────────────
test("collectFlow 正常：git 今日/本周窗口 + PR API（open 与 search 两次调用），计数正确", async () => {
  const repo = makeGitRepo();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts && opts.headers && opts.headers.authorization });
    if (String(url).includes("/search/issues")) {
      return { ok: true, status: 200, json: async () => ({
        total_count: 2,
        items: [
          { number: 876, title: "docs: B2 出库", user: { login: "u" }, created_at: "2026-09-27T00:00:00Z", updated_at: "2026-09-28T09:25:13Z", closed_at: "2026-09-28T09:25:13Z", html_url: "h", pull_request: { merged_at: "2026-09-28T09:25:13Z" } },
          { number: 800, title: "更早的", user: { login: "u" }, created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-21T00:00:00Z", closed_at: "2026-09-21T00:00:00Z", html_url: "h", pull_request: { merged_at: "2026-09-21T00:00:00Z" } }
        ]
      }) };
    }
    return { ok: true, status: 200, json: async () => [prJson(880), prJson(879, { created_at: "2026-09-20T00:00:00Z" })] };
  };
  const now = new Date("2026-09-29T10:00:00+08:00");
  const f = await collectFlow(repo, { now, fetchImpl, credentialsPath: (() => {
    const d = makeDir({ "c.yaml": "GITHUB_TOKEN: tok\n" });
    return join(d, "c.yaml");
  })() });
  assert.equal(f.ok, true);
  assert.equal(f.git.ok, true, "真仓库必须有 git 流水");
  assert.ok(f.git.week.commits.length >= 1);
  assert.equal(f.pr.ok, true);
  assert.equal(f.pr.source, "api");
  assert.equal(f.pr.counts.open, 2);
  assert.equal(f.pr.counts.open_week, 1, "第二条 created_at=09-20 在本周窗（09-28 起）外");
  assert.equal(f.pr.counts.merged_week, 1, "只有 09-28 合并的在本周窗内");
  assert.equal(f.pr.counts.merged_total_count, 2);
  // 两次调用且都带鉴权头（token 只进 header）
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.auth === "Bearer tok"));
  // 红线：载荷里不得出现 token 明文
  assert.equal(JSON.stringify(f).includes("Bearer tok"), false, "结果体不得含鉴权头");
  assert.equal(JSON.stringify(f).includes("GITHUB_TOKEN"), false, "结果体不得含凭据字段名");
});

test("collectFlow：无 token（凭据文件缺失）→ 回退 PR 快照并显式标注「快照」，不冒充实时", async () => {
  const repo = makeGitRepo();
  const snapshot = {
    schema: "pr-queue-snapshot/1", generated_by: "pr-queue-scan.py", generated_at: "2026-09-20T20:24:38+08:00",
    degraded: false, warning: "未合 PR 队列超限",
    metrics: { queue_length: 46, limit: 12, over_limit: true, closeable_count: 13, oldest: { number: 464, age_days: 11 } },
    records: [{ number: 671, title: "docs(D848)", owner: "mac-cto", created_at: "2026-09-20", age_days: 0, behind: 5, ci_state: "pending", closeable: false }]
  };
  const root = makeDir({ [PR_SNAPSHOT_REL]: snapshot });
  const f = await collectFlow(root, {
    now: new Date("2026-09-29T10:00:00+08:00"),
    credentialsPath: join(root, "no-such-creds.yaml"),
    fetchImpl: async () => { throw new Error("must not be called without token"); }
  });
  assert.equal(f.pr.ok, true);
  assert.equal(f.pr.source, "snapshot");
  assert.equal(f.pr.generated_at, "2026-09-20T20:24:38+08:00");
  assert.match(f.pr.note, /GitHub API 不可用，已回退 PR 快照/);
  assert.equal(f.pr.age_days, 8, "快照年龄必须如实算出（陈旧可见）");
  assert.equal(f.pr.counts.open, 46);
  assert.equal(f.pr.counts.over_limit, true);
  // 快照不含合并时间 ⇒ 本周/今日已合必须留空，**不得拿旧数据充今日流水**
  assert.deepEqual(f.pr.merged_week, []);
  assert.deepEqual(f.pr.merged_today, []);
  assert.equal(f.pr.counts.merged_week, undefined, "快照态不得编造合并计数");
});

test("collectFlow 降级：API 与快照两级皆失败 → pr.ok:false + 两级原因（不静默）", async () => {
  const repo = makeGitRepo();
  const creds = makeDir({ "c.yaml": "GITHUB_TOKEN: tok\n" });
  const f = await collectFlow(repo, {
    now: new Date("2026-09-29T10:00:00+08:00"),
    credentialsPath: join(creds, "c.yaml"),
    fetchImpl: async () => { throw new Error("connection refused"); }
  });
  assert.equal(f.pr.ok, false);
  assert.equal(f.pr.degraded, true);
  assert.match(f.pr.error, /GitHub API 失败/);
  assert.match(f.pr.error, /快照|pr-queue\.json/);
  assert.ok(Array.isArray(f.pr.attempts) && f.pr.attempts.length >= 2, "两级原因都要在 attempts 里");
  assert.equal(f.ok, true, "git 仍可用 ⇒ 整块不判死");
  assert.equal(f.degraded, true, "部分降级必须显式");
});

test("collectFlow：HTTP 非 200 也算失败（不把错误响应当数据）", async () => {
  const repo = makeGitRepo();
  const creds = makeDir({ "c.yaml": "GITHUB_TOKEN: tok\n" });
  const f = await collectFlow(repo, {
    now: new Date("2026-09-29T10:00:00+08:00"),
    credentialsPath: join(creds, "c.yaml"),
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: "rate limited" }) })
  });
  assert.equal(f.pr.ok, false);
  assert.match(f.pr.error, /HTTP 403/);
});

test("collectFlow：git 不可用（非仓库）→ git 段显式降级，函数不抛异常", async () => {
  const root = makeDir({});
  const f = await collectFlow(root, {
    now: new Date("2026-09-29T10:00:00+08:00"),
    credentialsPath: join(root, "none.yaml"),
    fetchImpl: async () => { throw new Error("no net"); }
  });
  assert.equal(f.git.ok, false);
  assert.equal(f.git.degraded, true);
  assert.ok(typeof f.git.error === "string" && f.git.error.length > 0);
  assert.equal(f.ok, false, "两块都不可用 ⇒ ok:false");
});
