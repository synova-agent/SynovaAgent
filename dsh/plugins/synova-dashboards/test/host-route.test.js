// test/host-route.test.js — Host 半路由契约测试（node:test）
// 用假 ctx.webServer 捕获真实 handler，再以假 req/res 驱动，验证契约：
//   GET /synova/pm/ledger  成功 → 200 + 账本对象 + { ok:true, source:"worktree"|"origin/main" }
//                          降级 → 200 + { ok:false, degraded:true, error, attempts }（不 500、不抛异常）
//   GET /synova/dashboards/data 仍注册（面板健康区数据源）。
// 三级取数：工作区文件 → git origin/main → 显式降级（见 lib/ledger.js）。
// 铁律 48：非空壳，正常/降级/边界三路径都有真实断言。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { name, inject } from "../lib/index.js";
import { LEDGER_REL_PATH, LEDGER_REF } from "../lib/ledger.js";

// lib/index.js 有进程级挂载护栏（let active）——生产上防重复挂载是正确的，
// 但同一进程里多次 apply 会被它挡掉。测试用带 query 的动态 import 取独立模块实例。
let moduleSeq = 0;
async function freshApply() {
  const mod = await import(`../lib/index.js?case=${moduleSeq++}`);
  return mod.apply;
}

/** 装载 Host 半，捕获注册的路由与 handler。 */
async function loadHost(repoRoot) {
  const apply = await freshApply();
  const routes = [];
  const warnings = [];
  const ctx = {
    logger: { warn: (m) => warnings.push(String(m)), error: (m) => warnings.push(String(m)) },
    effect(fn) {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    webServer: {
      register(spec) {
        routes.push(spec);
        return () => {};
      },
    },
  };
  apply(ctx, { repoRoot });
  return { routes, warnings };
}

/** 假 res：记录 status/headers/body。 */
function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: undefined,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(payload) { this.body = payload; },
  };
}

function makeRepo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "synova-route-"));
  for (const [rel, content] of Object.entries(files)) {
    if (content === undefined) continue;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

/** git 夹具：把 GOOD_LEDGER 提交到 main 并建 refs/remotes/origin/main，再按需破坏工作区副本。 */
function makeGitRepo({ worktree = "same" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "synova-route-git-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  const abs = join(root, LEDGER_REL_PATH);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, GOOD_LEDGER);
  git("add", LEDGER_REL_PATH);
  git("commit", "-q", "-m", "ledger");
  git("update-ref", `refs/remotes/${LEDGER_REF}`, "HEAD");
  if (worktree === "remove") rmSync(abs);
  else if (worktree !== "same") writeFileSync(abs, worktree);
  return root;
}

const GOOD_LEDGER = JSON.stringify({
  schema: "project-ledger/1",
  generated_at: "2026-09-17T10:00:00+08:00",
  git_head: "6a06e853",
  degraded: false,
  totals: { v1_total: 125, v1_passed: 0, v1_verified: 0, freshness: { green: 0, yellow: 0, red: 1 }, blocked_count: 0 },
  lines: [], blocked: [], timeline: [],
});

function findRoute(routes, path) {
  const r = routes.find((x) => x.path === path);
  assert.ok(r, `必须注册路由 ${path}`);
  return r;
}

test("Host 半导出契约：name / inject 保持 webServer（bundle 层按此挂载）", () => {
  assert.equal(name, "synova-dashboards");
  assert.deepEqual(inject, ["webServer"]);
});

test("同时注册四条只读路由：dashboards/data + pm/ledger（原有）+ workbench/data + governance/data（D1060）", async () => {
  const root = makeRepo({ [LEDGER_REL_PATH]: GOOD_LEDGER });
  const { routes } = await loadHost(root);
  assert.equal(routes.length, 4, "应恰好注册四条路由");
  for (const r of routes) assert.equal(r.kind, "exact");
  findRoute(routes, "/synova/dashboards/data");
  findRoute(routes, "/synova/pm/ledger");
  // D1060：两个新面板各一条只读路由（物理分离 ⇒ 两条独立路由，不是一个路由两个 section）
  findRoute(routes, "/synova/workbench/data");
  findRoute(routes, "/synova/governance/data");
});

test("D1060 降级形状：两个新路由在空仓库下仍 200 + 显式 degraded，不 500 不抛异常", async () => {
  const root = makeRepo({}); // 无任何数据源
  const { routes } = await loadHost(root);
  for (const path of ["/synova/workbench/data", "/synova/governance/data"]) {
    const res = fakeRes();
    await findRoute(routes, path).handler({}, res);
    assert.equal(res.statusCode, 200, path + " 降级也必须走 200");
    const body = JSON.parse(res.body);
    assert.equal(body.degraded, true, path + " 必须显式 degraded:true");
    assert.ok(String(body.error ?? (body.degraded_sources ?? []).join("；")).length > 0, path + " 降级必须带原因（禁静默）");
  }
});

test("正常路径：工作区账本存在 → 200 + 账本字段全保留 + source=worktree + no-store", async () => {
  const root = makeRepo({ [LEDGER_REL_PATH]: GOOD_LEDGER });
  const { routes } = await loadHost(root);
  const res = fakeRes();
  await findRoute(routes, "/synova/pm/ledger").handler({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.headers["cache-control"], "no-store");
  const body = JSON.parse(res.body);
  assert.equal(body.source, "worktree", "必须标出取数来源");
  assert.equal(body.ok, true);
  // 账本原字段一个不少（前端与既有 schema 不变）
  assert.equal(body.schema, "project-ledger/1");
  assert.equal(body.git_head, "6a06e853");
  assert.equal(body.totals.v1_total, 125);
  assert.deepEqual(body.lines, []);
  assert.equal(body.source_detail, undefined, "未发生回退时不得有 source_detail");
});

test("三级② 路由级回退：工作区账本改名/缺失 → 仍能从 origin/main 取到数据并标 source", async () => {
  const root = makeGitRepo({ worktree: "remove" }); // 等价于「把工作区 ledger.json 改名」
  const { routes } = await loadHost(root);
  const res = fakeRes();
  await findRoute(routes, "/synova/pm/ledger").handler({}, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true, "工作区改名不应导致数据不通");
  assert.equal(body.source, LEDGER_REF);
  assert.equal(body.totals.v1_total, 125);
  assert.match(body.source_detail, /已回退 git 权威/);
});

test("降级①：ledger.json 缺失 → 200 + ok:false/degraded:true（D795 未产出时的正常态）", async () => {
  const root = makeRepo({}); // 无 ledger.json
  const { routes, warnings } = await loadHost(root);
  const res = fakeRes();
  await findRoute(routes, "/synova/pm/ledger").handler({}, res);
  assert.equal(res.statusCode, 200, "降级不得返回 5xx（前端会误判为断网）");
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.degraded, true);
  assert.match(body.error, /工作区无/, "降级必须带上一级失败原因");
  assert.match(body.error, /origin\/main/, "降级必须带上二级失败原因");
  assert.equal(body.attempts.length, 2);
  assert.ok(warnings.some((w) => w.includes("ledger")), "降级必须留痕（铁律 24：禁静默）");
});

test("降级②：坏 JSON 且无 git 回退 → 200 + degraded:true + 解析原因，且不抛异常", async () => {
  const root = makeRepo({ [LEDGER_REL_PATH]: "{ not json" }); // 非 git 仓库 → 二级也失败
  const { routes, warnings } = await loadHost(root);
  const res = fakeRes();
  await assert.doesNotReject(
    () => findRoute(routes, "/synova/pm/ledger").handler({}, res),
    "坏 JSON 不得把异常抛给宿主"
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.degraded, true);
  assert.match(body.error, /JSON 解析失败/);
  assert.match(body.error, /origin\/main/);
  assert.ok(warnings.length > 0);
});

test("原有路由仍可用：/synova/dashboards/data 在无数据仓库下也不抛异常（返回 JSON）", async () => {
  const root = makeRepo({});
  const { routes } = await loadHost(root);
  const res = fakeRes();
  await findRoute(routes, "/synova/dashboards/data").handler({}, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(typeof body, "object");
  assert.ok(body.meta, "原有 payload 结构应保留 meta 字段");
});
