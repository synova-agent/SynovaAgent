/**
 * policy.test.mjs — issue policy 单测（node --test，零第三方依赖）
 *
 * 运行: node --test tests/issue-management/policy.test.mjs
 *
 * 覆盖（铁律 48: 正常 / 降级 / 边界 + 接线）:
 *   ① 正常 — 合规 PR 零 finding；draft 豁免生效
 *   ② 逐规则 — linkedIssue / typeLabel / priorityLabel / areaLabel / requiredSections / placeholderLeft
 *   ③ 降级 — pr=null / body 非字符串 / labels 非数组 ⇒ summary.degraded=true 且不抛
 *   ④ 边界 — `abc#12` 不算引用（词边界）、`#12` 与 `owner/repo#7` 算、kind/* 数量≠1、stage 预设裁剪
 *   ⑤ 接线 — evaluate 被 policy.mjs 消费（真实 CLI 端到端 rc 断言在 tests/issue-management/cli.test.mjs）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, normalizePr, collectIssueRefs, RULE_ORDER } from "../../.github/issue-management/rules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(resolve(HERE, "../../.github/issue-management/config.json"), "utf8"));

const pr = (over = {}) => ({
  number: 1,
  title: "fix(D1): something",
  body: "Closes #12\n\n## 变更说明\n有实质内容\n\n## 受影响的铁律\n铁律 38",
  labels: [{ name: "kind/bug-fix" }, { name: "p1" }, { name: "area/ci" }],
  isDraft: false,
  ...over,
});

const rulesOf = (res) => res.findings.map((f) => f.rule).sort();

test("① 正常: 合规 PR 零 finding", () => {
  const res = evaluate({ pr: pr() }, CONFIG);
  assert.deepEqual(res.findings, [], "合规 PR 不应有 finding");
  assert.equal(res.summary.block, 0);
  assert.equal(res.summary.warn, 0);
  assert.equal(res.summary.degraded, false);
  assert.equal(res.summary.draft, false);
});

test("① 降级: draft 豁免 type/priority/area/sections/placeholder，但 linkedIssue 仍查", () => {
  const res = evaluate({ pr: pr({ isDraft: true, body: "无任何引用", labels: [] }) }, CONFIG);
  assert.deepEqual(rulesOf(res), ["linkedIssue"], "draft 只应命中 linkedIssue");
  assert.ok(res.summary.exempted.includes("typeLabel"), "typeLabel 应被 draft 豁免");
  assert.ok(res.summary.exempted.includes("priorityLabel"), "priorityLabel 应被 draft 豁免");
  assert.ok(!res.summary.exempted.includes("linkedIssue"), "linkedIssue 不可被 draft 豁免");
});

test("② linkedIssue: 无引用 ⇒ block 级 finding 且带 fix", () => {
  const res = evaluate({ pr: pr({ body: "没有引用任何 issue" }) }, CONFIG);
  const f = res.findings.find((x) => x.rule === "linkedIssue");
  assert.ok(f, "应命中 linkedIssue");
  assert.equal(f.severity, "block");
  assert.ok(f.fix && f.fix.length > 0, "finding 必须带修复动作");
});

test("② typeLabel: 缺 kind/* ⇒ 命中；两个 kind/* ⇒ 也命中（数量不合规）", () => {
  const none = evaluate({ pr: pr({ labels: [{ name: "p1" }] }) }, CONFIG);
  assert.ok(none.findings.some((f) => f.rule === "typeLabel"), "缺 kind/* 应命中");

  const two = evaluate({ pr: pr({ labels: [{ name: "kind/doc" }, { name: "kind/feature" }, { name: "p1" }] }) }, CONFIG);
  assert.ok(two.findings.some((f) => f.rule === "typeLabel"), "两个 kind/* 应命中");
});

test("② priorityLabel: 缺 p0-p3 ⇒ 命中；有 p2 ⇒ 通过", () => {
  const miss = evaluate({ pr: pr({ labels: [{ name: "kind/doc" }] }) }, CONFIG);
  assert.ok(miss.findings.some((f) => f.rule === "priorityLabel"));
  const ok = evaluate({ pr: pr({ labels: [{ name: "kind/doc" }, { name: "p2" }] }) }, CONFIG);
  assert.ok(!ok.findings.some((f) => f.rule === "priorityLabel"));
});

test("② areaLabel 是 warn 级（不计入 block）", () => {
  const res = evaluate({ pr: pr({ labels: [{ name: "kind/doc" }, { name: "p2" }] }) }, CONFIG);
  const f = res.findings.find((x) => x.rule === "areaLabel");
  assert.ok(f, "缺 area/* 应命中");
  assert.equal(f.severity, "warn");
  assert.equal(res.summary.block, 0);
});

test("② requiredSections: 缺 `## 变更说明` ⇒ warn", () => {
  const res = evaluate({ pr: pr({ body: "Closes #12\n没有段落标题" }) }, CONFIG);
  assert.ok(res.findings.some((f) => f.rule === "requiredSections"));
});

test("② placeholderLeft: 残留模板占位注释 ⇒ warn", () => {
  const body = "Closes #12\n\n## 变更说明\n<!-- 简要描述此 PR 做了什么，用户会看到什么变化 -->";
  const res = evaluate({ pr: pr({ body }) }, CONFIG);
  assert.ok(res.findings.some((f) => f.rule === "placeholderLeft"));
});

test("③ 降级: pr=null ⇒ degraded=true、不抛异常、不静默通过", () => {
  const res = evaluate({ pr: null }, CONFIG);
  assert.equal(res.summary.degraded, true);
  assert.ok(res.summary.degradedReasons.length > 0);
  assert.ok(res.findings.length > 0, "缺输入不得判为合规");
});

test("③ 降级: body 非字符串 + labels 非数组 ⇒ 记入 degradedReasons", () => {
  const res = evaluate({ pr: { number: 2, title: "t", body: 123, labels: "kind/doc" } }, CONFIG);
  assert.equal(res.summary.degraded, true);
  assert.ok(res.summary.degradedReasons.some((r) => r.includes("body")));
  assert.ok(res.summary.degradedReasons.some((r) => r.includes("labels")));
});

test("④ 边界: `abc#12` 不算引用（词边界），`#12`/`owner/repo#7`/`(#12)` 算", () => {
  const pat = CONFIG.rules.linkedIssue.acceptPatterns;
  assert.deepEqual(collectIssueRefs("abc#12", pat), [], "紧贴字母的 #12 不应算引用");
  assert.deepEqual(collectIssueRefs("Closes #12", pat), ["12"]);
  assert.deepEqual(collectIssueRefs("见 synova-agent/SynovaAgent#7", pat), ["7"]);
  assert.deepEqual(collectIssueRefs("修复 (#34)", pat), ["34"]);
  assert.deepEqual(collectIssueRefs("#12 与 #12 重复", pat), ["12"], "引用应去重");
});

test("④ 边界: labels 支持字符串数组与 {name} 对象数组混合", () => {
  const a = normalizePr({ labels: ["kind/doc", "p1"] });
  assert.deepEqual(a.labels, ["kind/doc", "p1"]);
  const b = normalizePr({ labels: [{ name: "kind/doc" }, { name: "p1" }] });
  assert.deepEqual(b.labels, ["kind/doc", "p1"]);
});

test("④ 边界: stage 预设只放行 enable 列出的规则（此处模拟 policy.mjs 的裁剪语义）", () => {
  const stage1 = JSON.parse(JSON.stringify(CONFIG));
  const allow = new Set(stage1.stages["1"].enable);
  for (const k of Object.keys(stage1.rules)) if (!allow.has(k)) stage1.rules[k] = { ...stage1.rules[k], enabled: false };
  const res = evaluate({ pr: pr({ labels: [], body: "无引用" }) }, stage1);
  assert.deepEqual(rulesOf(res), ["linkedIssue"], "stage1 只应命中 linkedIssue");
});

test("⑤ 接线: rules.mjs 导出的 evaluate/normalizePr/collectIssueRefs/RULE_ORDER 齐备", () => {
  assert.equal(typeof evaluate, "function");
  assert.equal(typeof normalizePr, "function");
  assert.equal(typeof collectIssueRefs, "function");
  assert.ok(Array.isArray(RULE_ORDER) && RULE_ORDER.length >= 6, "RULE_ORDER 应覆盖全部规则");
});

test("⑤ 接线: config.json 声明的规则名必须都存在于 RULE_ORDER（防配置漂移）", () => {
  for (const name of Object.keys(CONFIG.rules)) {
    assert.ok(RULE_ORDER.includes(name), `config 里的规则 ${name} 不在 RULE_ORDER 中（会静默不执行）`);
  }
});
