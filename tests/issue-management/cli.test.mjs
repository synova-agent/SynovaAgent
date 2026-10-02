/**
 * cli.test.mjs — issue policy CLI 端到端契约测试（node --test）
 *
 * 运行: node --test tests/issue-management/cli.test.mjs
 *
 * 本文件锁死三条**进程级**契约（本卡核心 = 「非必过软上线」，必须由测试守，不靠文档）:
 *   ① informational ⇒ 有 block 级违规也 **rc=0**（只报不拦）
 *   ② ISSUE_POLICY_ENFORCE=true（或 config mode=blocking）⇒ 有 block 级违规 **rc=1**
 *   ③ payload 缺失/不可解析 ⇒ **rc=2**（检查未执行 ≠ 检查通过；fail-closed 且不静默）
 * 另附分级裁剪（--stage）与 GITHUB_STEP_SUMMARY 写入的行为断言。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const POLICY = resolve(HERE, "../../.github/issue-management/policy.mjs");

const TMP = mkdtempSync(join(tmpdir(), "issue-policy-cli-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

function writeJson(name, obj) {
  const p = join(TMP, name);
  writeFileSync(p, JSON.stringify(obj), "utf8");
  return p;
}

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [POLICY, ...args], {
    encoding: "utf8",
    env: { ...process.env, ISSUE_POLICY_ENFORCE: "", GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "", ...env },
  });
  return { rc: r.status, out: r.stdout || "", err: r.stderr || "" };
}

const NONCOMPLIANT = { number: 901, title: "no ref", body: "空正文", labels: [], isDraft: false };
const COMPLIANT = {
  number: 902,
  title: "fix(D1): x",
  body: "Closes #12\n\n## 变更说明\n有内容",
  labels: ["kind/bug-fix", "p1", "area/ci"],
  isDraft: false,
};

test("① informational: 有 block 级违规 ⇒ 仍 rc=0，且汇总标明 mode=informational", () => {
  const p = writeJson("bad.json", NONCOMPLIANT);
  const { rc, out } = run(["--payload", p]);
  assert.equal(rc, 0, "informational 模式不得阻断");
  assert.match(out, /block=[1-9]/, "应报出 block 级命中");
  assert.match(out, /mode=informational/);
});

test("② blocking: 同一输入 + ISSUE_POLICY_ENFORCE=true ⇒ rc=1", () => {
  const p = writeJson("bad2.json", NONCOMPLIANT);
  const { rc, out } = run(["--payload", p], { ISSUE_POLICY_ENFORCE: "true" });
  assert.equal(rc, 1, "blocking 模式有 block 级违规必须 rc=1");
  assert.match(out, /mode=blocking/);
});

test("② blocking: 合规 PR ⇒ rc=0（执法不等于恒红）", () => {
  const p = writeJson("good.json", COMPLIANT);
  const { rc, out } = run(["--payload", p], { ISSUE_POLICY_ENFORCE: "true" });
  assert.equal(rc, 0);
  assert.match(out, /block=0 warn=0/);
});

test("③ 降级: payload 文件不存在 ⇒ rc=2 + stderr degraded（不当作通过）", () => {
  const { rc, err } = run(["--payload", join(TMP, "nope.json")]);
  assert.equal(rc, 2);
  assert.match(err, /degraded:/);
});

test("③ 降级: payload 非法 JSON ⇒ rc=2", () => {
  const p = join(TMP, "broken.json");
  writeFileSync(p, "{ not json", "utf8");
  const { rc, err } = run(["--payload", p]);
  assert.equal(rc, 2);
  assert.match(err, /degraded:/);
});

test("③ 降级: 空 batch ⇒ rc=2（空输入不算通过）", () => {
  const p = writeJson("empty.json", []);
  const { rc, err } = run(["--batch", p]);
  assert.equal(rc, 2);
  assert.match(err, /degraded:/);
});

test("④ 边界: --stage 1 对「有引用但无标签」的 PR 零 block（证明分级裁剪生效）", () => {
  const noLabels = { number: 903, title: "fix: x", body: "Closes #12", labels: [], isDraft: false };
  const p = writeJson("nolabels.json", noLabels);
  const s1 = run(["--payload", p, "--stage", "1"]);
  assert.equal(s1.rc, 0);
  assert.match(s1.out, /block=0/, "stage1 只查 linkedIssue ⇒ 缺标签不应计入 block");
  assert.match(s1.out, /stage=1/);
  const s3 = run(["--payload", p, "--stage", "3"]);
  assert.match(s3.out, /block=2/, "stage3 应命中 linkedIssue 通过、type+priority 两条 block");
});

test("④ 边界: 未知 --stage ⇒ rc=2 + degraded（不静默降级为全规则）", () => {
  const p = writeJson("s.json", COMPLIANT);
  const { rc, err } = run(["--payload", p, "--stage", "99"]);
  assert.equal(rc, 2);
  assert.match(err, /degraded:/);
});

test("⑤ 接线: GITHUB_STEP_SUMMARY 存在时追加 job summary，并标注 informational", () => {
  const p = writeJson("sum.json", NONCOMPLIANT);
  const sum = join(TMP, "summary.md");
  writeFileSync(sum, "", "utf8");
  const { rc } = run(["--payload", p], { GITHUB_STEP_SUMMARY: sum });
  assert.equal(rc, 0);
  const text = readFileSync(sum, "utf8");
  assert.match(text, /Issue policy/);
  assert.match(text, /informational/);
  assert.match(text, /不会阻断任何 PR/);
});

test("⑤ 接线: --batch 输出 markdown 表 + 一行 POLICY_JSON（预演报告取数用）", () => {
  const p = writeJson("batch.json", [NONCOMPLIANT, COMPLIANT]);
  const { rc, out } = run(["--batch", p, "--json"]);
  assert.equal(rc, 0);
  assert.match(out, /\| PR \| draft \| block \| warn \| 命中规则 \|/);
  assert.match(out, /POLICY_JSON=\{/);
  const jsonLine = out.split("\n").find((l) => l.startsWith("POLICY_JSON="));
  const parsed = JSON.parse(jsonLine.slice("POLICY_JSON=".length));
  assert.equal(parsed.prs.length, 2);
  assert.equal(parsed.mode, "informational");
});
