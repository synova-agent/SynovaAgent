#!/usr/bin/env node
// scripts/judge-charter.mjs — 宪章 64 格判据执行器（D1066 §一.2「内容真」）
//
// 为什么要有它：创始人要求「填 64 格（**从证据派生，禁手编**）」。本执行器把这件事变成
//   **可复跑的命令**：每格一条 judge_cmd，退出码即判据结论 —— 作者不手写任何状态。
//
// 契约（铁律 47）：
//   @input  --repo-root <dir>（默认本脚本上溯三级）
//           --charter <rel>（默认 docs/synova/coordination/宪章三问-48格.json）
//           --map <rel>（默认 docs/synova/coordination/charter-judge-map.json）
//           --dry-run（只跑命令并打印，不写回）
//           --timeout-ms <n>（单条命令超时，默认 15000）
//   @output 成功 → 写回 charter JSON，逐格更新：
//             judge_cmd / judge_state / judge_basis / status / judgement / evidence / command / updated_at / checked_by
//           stdout 打印：ready/red/green/empty 计数 + 逐格一行（id 状态 命令）
//   @口径（对齐院方 X27 与 gen-charter-grid.py:15-16）
//     · judge_state=ready 且命令退出 0  ⇒ status=green（判据成立）
//     · judge_state=ready 且命令退出 ≠0 ⇒ status=red（判据不成立 / 缺失）
//     · judge_state=todo（无命令）      ⇒ status=empty（⚪ 未填/待办）—— **绝不折算成绿**
//     · 命令执行异常/超时 ⇒ red + evidence 记录原因（不静默、不判绿）
//   @degraded 全程不抛异常到调用方会中断写盘；单条命令失败只影响该格，其余照跑
//   @write 只写 charter JSON（幂等：同 repo 状态 → 同结果；updated_at 取 --now 或当前时间）
//
// 用法：node dsh/plugins/synova-dashboards/scripts/judge-charter.mjs --repo-root /Users/wane/SynovaAgent

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function arg(name, def = null) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1];
    if (argv[i].startsWith(name + "=")) return argv[i].slice(name.length + 1);
  }
  return def;
}
const hasFlag = (f) => argv.includes(f);

const repoRoot = arg("--repo-root") || join(HERE, "..", "..", "..", "..");
const charterRel = arg("--charter", "docs/synova/coordination/宪章三问-48格.json");
const mapRel = arg("--map", "docs/synova/coordination/charter-judge-map.json");
const dryRun = hasFlag("--dry-run");
const timeoutMs = Number(arg("--timeout-ms", "15000"));
const nowIso = new Date().toISOString();

/** 跑一条判据命令：只读（命令来自本仓映射文件），带超时，绝不写盘。 */
function runJudge(cmd) {
  try {
    const out = execSync(cmd, {
      cwd: repoRoot,
      shell: "/bin/sh",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    });
    const first = String(out ?? "").trim().split("\n").filter(Boolean).slice(0, 2).join(" / ");
    return { exit: 0, output: first };
  } catch (err) {
    if (err?.signal === "SIGTERM" || err?.code === "ETIMEDOUT") {
      return { exit: 124, output: `超时（${timeoutMs}ms）` };
    }
    const code = typeof err?.status === "number" ? err.status : 1;
    const first = String(err?.stdout ?? err?.stderr ?? err?.message ?? "")
      .trim().split("\n").filter(Boolean).slice(0, 2).join(" / ");
    return { exit: code || 1, output: first };
  }
}

const charterAbs = join(repoRoot, charterRel);
const mapAbs = join(repoRoot, mapRel);
const charter = JSON.parse(readFileSync(charterAbs, "utf8"));
const map = JSON.parse(readFileSync(mapAbs, "utf8"));

// ext_point → layer 必须唯一（数据源如此；若重复则显式报错，不猜）
const probeKey = new Map();
for (const p of map.probes ?? []) {
  const k = `${p.layer}\u0000${p.ext_point}`;
  if (probeKey.has(k)) {
    console.error(`❌ judge-map 重复项：${p.layer} / ${p.ext_point}`);
    process.exit(1);
  }
  probeKey.set(k, p);
}

let green = 0, red = 0, empty = 0, ready = 0;
const lines = [];

for (const cell of charter.cells) {
  const probe = probeKey.get(`${cell.layer}\u0000${cell.ext_point}`);
  const q = probe ? probe[cell.question] : null;
  if (!q) {
    // 映射缺该格 → 显式 todo（不默认红也不默认绿）
    Object.assign(cell, {
      judge_cmd: "", judge_state: "todo",
      judge_basis: "判据映射缺失（charter-judge-map.json 未覆盖本格）",
      status: "empty",
      judgement: "待办：判据映射缺失，待补 charter-judge-map.json 后由 judge-charter.mjs 派生",
      evidence: "", command: "", updated_at: nowIso.slice(0, 10), checked_by: "judge-charter.mjs@D1066"
    });
    empty++;
    lines.push(`${cell.id}  ⚪ 未填  (映射缺失)`);
    continue;
  }

  cell.judge_state = q.state;
  cell.judge_cmd = q.cmd ?? "";
  cell.judge_basis = q.basis ?? q.todo_reason ?? "";

  if (q.state !== "ready" || !q.cmd) {
    Object.assign(cell, {
      status: "empty",
      judgement: q.todo_reason ?? "待办：判据命令未就绪",
      evidence: "",
      command: "",
      updated_at: nowIso.slice(0, 10),
      checked_by: "judge-charter.mjs@D1066"
    });
    empty++;
    lines.push(`${cell.id}  ⚪ 未填  (todo)`);
    continue;
  }

  ready++;
  const r = runJudge(q.cmd);
  if (r.exit === 0) {
    cell.status = "green";
    cell.judgement = `判据成立：${q.basis}（命令退出 0）`;
    green++;
    lines.push(`${cell.id}  🟢 生效了  ${q.cmd}`);
  } else {
    cell.status = "red";
    cell.judgement = `判据不成立：${q.basis}（命令退出 ${r.exit}）`;
    red++;
    lines.push(`${cell.id}  🔴 缺失  ${q.cmd}`);
  }
  cell.command = q.cmd;
  cell.evidence = `exit=${r.exit}${r.output ? " | " + r.output.slice(0, 200) : ""}`;
  cell.updated_at = nowIso.slice(0, 10);
  cell.checked_by = "judge-charter.mjs@D1066";
}

charter.counts = Object.assign({}, charter.counts, {
  cells: charter.cells.length,
  ext_points: new Set(charter.cells.map((c) => c.layer + "\u0000" + c.ext_point)).size,
  questions: new Set(charter.cells.map((c) => c.question)).size,
  filled: green + red
});
charter.judged_at = nowIso;
charter.judged_by = "dsh/plugins/synova-dashboards/scripts/judge-charter.mjs (D1066)";
charter.judge_convention = map.convention ?? null;

if (dryRun) {
  console.log(lines.join("\n"));
  console.log(`\n[dry-run] ready=${ready} green=${green} red=${red} empty=${empty}`);
  process.exit(0);
}

writeFileSync(charterAbs, JSON.stringify(charter, null, 2) + "\n", "utf8");
console.log(lines.join("\n"));
console.log(`\n✅ 写回 ${charterRel}`);
console.log(`   判据就绪 ${ready} 格 → 🟢 ${green} / 🔴 ${red}；⚪ 未填 ${empty}（todo/映射缺失，不折算成绿）`);
console.log(`   已填 filled = ${charter.counts.filled}/${charter.counts.cells}（= green+red，仅统计真跑过的判据）`);
