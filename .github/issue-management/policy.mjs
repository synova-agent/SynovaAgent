#!/usr/bin/env node
/**
 * policy.mjs — issue policy 执行体（CLI）
 *
 * 契约（铁律 47）:
 *   @input  argv:
 *     --payload <file|->  单个 PR 的 JSON（GitHub `pull_request` 对象或其子集）；`-` = stdin
 *     --batch <file>      PR 数组 JSON（预演/盘点用；与 --payload 互斥，--batch 优先）
 *     --config <file>     策略配置；默认 <repo>/.github/issue-management/config.json
 *     --issues <file>     可选：{ "<issue号>": { labels:[...] } }，供 linkedIssueLabels 规则消费
 *     --stage <1|2|3|4>   分级预案：只启用 config.stages[N].enable 列出的规则（未列出 = disabled）
 *     --json              额外输出一行机器可读 JSON（POLICY_JSON=…）
 *     --quiet             只输出汇总行
 *   环境:
 *     ISSUE_POLICY_ENFORCE  "true" ⇒ 强制执法（覆盖 config 的 informational 模式）
 *     GITHUB_STEP_SUMMARY   存在 ⇒ 追加 GitHub job summary（markdown）
 *     GITHUB_ACTIONS        存在 ⇒ 输出 ::warning / ::error 注解
 *   @output stdout:
 *     逐条 finding 行 `[block|warn] <rule>: <message> → fix: <fix>`
 *     汇总行 `POLICY_SUMMARY: pr=… block=… warn=… total=… draft=… degraded=… mode=…`
 *   @exit   0 = 无 block 级违规，或 informational 模式（只报不拦）
 *           1 = blocking 模式且存在 block 级违规
 *           2 = 检查未执行（payload/config 缺失或不可解析；fail-closed，不当成通过）
 *   @degraded exit 2 + stderr `degraded: <原因>`；PR 字段缺失走 rules.mjs 的 degraded 通道（不静默）
 *   @write  默认只写 stdout；仅在 GITHUB_STEP_SUMMARY 存在时追加该文件（GitHub 运行期产物）
 */

import { readFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "./rules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = resolve(HERE, "config.json");

function parseArgs(argv) {
  const out = { payload: "", batch: "", config: DEFAULT_CONFIG, issues: "", stage: "", json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`参数 ${a} 缺值`);
      return v;
    };
    switch (a) {
      case "--payload": out.payload = next(); break;
      case "--batch": out.batch = next(); break;
      case "--config": out.config = next(); break;
      case "--issues": out.issues = next(); break;
      case "--stage": out.stage = next(); break;
      case "--json": out.json = true; break;
      case "--quiet": out.quiet = true; break;
      default: throw new Error(`未知参数 ${a}`);
    }
  }
  return out;
}

function readJson(path, what) {
  try {
    const text = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
    return JSON.parse(text);
  } catch (err) {
    process.stderr.write(`degraded: 读不到/解析不了 ${what}（${path}）: ${err.message}\n`);
    process.exit(2);
  }
}

function isEnforced(config) {
  if (String(process.env.ISSUE_POLICY_ENFORCE || "").toLowerCase() === "true") return true;
  return config?.enforcement?.mode === "blocking";
}

function renderPr(res, cfg) {
  const lines = [];
  const where = res.prRef || "(PR)";
  if (!res.result.findings.length) {
    lines.push(`✅ ${where} 通过（0 违规${res.result.summary.draft ? "; draft 豁免 " + res.result.summary.exempted.length + " 条" : ""}）`);
  } else {
    lines.push(`⚠️ ${where} 命中 ${res.result.findings.length} 条（block=${res.result.summary.block} / warn=${res.result.summary.warn}）`);
    for (const f of res.result.findings) {
      lines.push(`   [${f.severity}] ${f.rule}: ${f.message}`);
      lines.push(`        → 修复: ${f.fix}`);
      lines.push(`        · 证据: ${f.evidence}`);
    }
  }
  if (res.result.summary.degraded) {
    lines.push(`   [degraded] 输入缺字段: ${res.result.summary.degradedReasons.join("; ")}`);
  }
  return lines.join("\n");
}

/** GitHub 注解（仅 GH Actions 下；informational 模式用 warning 不用 error） */
function annotate(findings, enforced) {
  if (!process.env.GITHUB_ACTIONS) return;
  for (const f of findings) {
    const lvl = enforced && f.severity === "block" ? "error" : "warning";
    process.stdout.write(`::${lvl} title=issue-policy(${f.rule})::${f.message} → ${f.fix}\n`);
  }
}

function mdTable(results, cfg) {
  const rows = [
    "| PR | draft | block | warn | 命中规则 |",
    "|---|---|---|---|---|",
  ];
  for (const r of results) {
    const rules = [...new Set(r.result.findings.map((f) => f.rule))].join(", ") || "—";
    rows.push(`| #${r.number} | ${r.result.summary.draft ? "yes" : "no"} | ${r.result.summary.block} | ${r.result.summary.warn} | ${rules} |`);
  }
  return rows.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`degraded: 参数解析失败: ${err.message}\n`);
    process.exit(2);
  }

  const config = readJson(args.config, "config");
  const issues = args.issues ? readJson(args.issues, "issues") : undefined;
  const enforced = isEnforced(config);
  const mode = enforced ? "blocking" : "informational";

  // 分级预案: --stage N ⇒ 只保留 config.stages[N].enable 列出的规则，其余显式 disabled
  let stageLabel = "";
  if (args.stage) {
    const stage = config.stages && config.stages[args.stage];
    if (!stage || !Array.isArray(stage.enable)) {
      process.stderr.write(`degraded: 未知 stage "${args.stage}"（config.stages 无该键）\n`);
      process.exit(2);
    }
    const allow = new Set(stage.enable);
    for (const name of Object.keys(config.rules || {})) {
      if (!allow.has(name)) config.rules[name] = { ...config.rules[name], enabled: false };
    }
    stageLabel = ` stage=${args.stage}（${stage.label}）`;
  }

  const batch = args.batch ? readJson(args.batch, "batch payload") : null;
  const prs = batch
    ? (Array.isArray(batch) ? batch : Array.isArray(batch.pullRequests) ? batch.pullRequests : [batch])
    : [readJson(args.payload || "-", "payload")];

  if (prs.length === 0) {
    process.stderr.write("degraded: 输入为空（0 个 PR）——不把空输入当成通过\n");
    process.exit(2);
  }

  const results = [];
  for (const raw of prs) {
    const result = evaluate({ pr: raw, config, issues }, config);
    const ref = raw && typeof raw === "object" && typeof raw.number === "number" ? `#${raw.number}` : "(PR)";
    results.push({ number: result.summary ? (raw.number ?? null) : null, prRef: ref, result });
  }

  const allFindings = results.flatMap((r) => r.result.findings);
  const blockTotal = allFindings.filter((f) => f.severity === "block").length;
  const warnTotal = allFindings.filter((f) => f.severity === "warn").length;
  const degradedTotal = results.filter((r) => r.result.summary.degraded).length;

  if (!args.quiet) {
    if (prs.length === 1) {
      process.stdout.write(renderPr(results[0], config) + "\n");
    } else {
      process.stdout.write(mdTable(results, config) + "\n");
    }
    annotate(allFindings, enforced);
  }

  const prLabel = prs.length === 1 ? results[0].prRef : `batch(${prs.length})`;
  const summaryLine =
    `POLICY_SUMMARY: pr=${prLabel} block=${blockTotal} warn=${warnTotal} total=${allFindings.length} ` +
    `prs=${prs.length} degraded=${degradedTotal} mode=${mode} stage=${args.stage || "-"}`;
  process.stdout.write(summaryLine + "\n");

  if (args.json) {
    process.stdout.write(
      "POLICY_JSON=" +
        JSON.stringify({
          mode,
          prs: results.map((r) => ({ number: r.number, findings: r.result.findings, summary: r.result.summary })),
          totals: { block: blockTotal, warn: warnTotal, total: allFindings.length, degraded: degradedTotal },
        }) +
        "\n"
    );
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      const head =
        `### Issue policy（${mode}${stageLabel}）\n\n` +
        `- PR 数: ${prs.length}\n- block 级命中: ${blockTotal}\n- warn 级命中: ${warnTotal}\n` +
        `- 输入缺字段: ${degradedTotal}\n` +
        (mode === "informational"
          ? `\n> ℹ️ 本检查当前为 **informational（非必过）**，不会阻断任何 PR。\n`
          : `\n> 🔴 本检查当前为 **blocking**。\n`);
      appendFileSync(summaryPath, head + (prs.length > 1 ? "\n" + mdTable(results, config) + "\n" : ""), "utf8");
    } catch (err) {
      process.stderr.write(`degraded: 写 GITHUB_STEP_SUMMARY 失败（不影响判定）: ${err.message}\n`);
    }
  }

  if (enforced && blockTotal > 0) process.exit(1);
  process.exit(0);
}

main();
