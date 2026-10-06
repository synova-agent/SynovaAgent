// codemod.mjs — 给 施工项登记.ts 的 48 项插入 verifier + verification 字段
// 用法: node codemod.mjs <dry|apply>
// 规则全部显式声明在本文件内，逐项可复核（禁手改数字）
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const WT = '/Users/wane/SynovaAgent/.synova-wt-registry';
const FILE = WT + '/docs/synova/coordination/施工项登记.ts';
const BASE = 'origin/docs/D1144-registry-unbundle';
const MODE = process.argv[2] || 'dry';

const m = await import(FILE);
const items = m.constructionItems;

const baseFiles = new Set(
  execFileSync('git', ['-C', WT, 'ls-tree', '-r', '--name-only', BASE], { maxBuffer: 1e9 })
    .toString().split('\n').filter(Boolean)
);

const PATHRE = /(?:^|[\s"'(=])((?:\.\/)?(?:src|tests|scripts|packages|extensions|expert|knowledge|theory|docs|cycles|tools)\/[A-Za-z0-9_\-.\/*]+\.[A-Za-z0-9]+)/g;
const refsOf = (it) => {
  const s = new Set();
  for (const a of it.acceptance) {
    let mm; PATHRE.lastIndex = 0;
    while ((mm = PATHRE.exec(a.run))) s.add(mm[1].replace(/^\.\//, ''));
  }
  return [...s];
};

// ── V5 规则（判据落地方，取值域见 Verifier 的 JSDoc）──────────────────────────
// 依据：TASK-ROUTING.md v4 §一「模块所有权表（唯一权威）」
//   scripts/control-tower/ + docs/synova/coordination/ + scripts/golden-scenarios/ → Mac DSH
//   scripts/audit/ + 审计标准 → Kimi K3 ；主 CTO 盯全局
const ALWAYS_TO = new Set(['0-1', '0-2']);                       // 总闸（方向级）
const LOAD_BEARING = new Set(['1-8', '1-9', '2-1a', '2-1b', '2-6']); // 承重件 W1/W2/W3/W4
function verifierFor(it) {
  const refs = refsOf(it);
  // R1 安全/权限/多租户/隔离 → K3（审计线：第三方审）
  if (it.block === 'K11' || refs.some((p) => p.startsWith('tests/security/'))) return 'k3';
  // R2 总闸/承重件 → CTO
  if (ALWAYS_TO.has(it.id) || LOAD_BEARING.has(it.id)) return 'cto';
  // R3 控制塔/门禁/流程/证据引擎类判据件 → 模块所有者 Mac DSH
  if (refs.some((p) => p.startsWith('scripts/control-tower/') || p.startsWith('docs/synova/coordination/') || p.startsWith('scripts/golden-scenarios/'))) return 'mac';
  // R4 其余（tests/** 或数据断言）→ Mac DSH（异机独立跑）
  return 'mac';
}

// ── V3/V4 实测结论（本会话实跑，原始输出见 evidence）────────────────────────
const MEASURED_GREEN = {                                          // 基线实跑 exit 0（B 不成立）
  '0-5': 'tests/growth/goal-sentinel.test.ts',
  '0-7': 'tests/routes/chat-feedback.test.ts',
  '0-10': 'tests/security/request-context-failclosed.test.ts',
  '1-7': 'tests/security/rbac-all-routes.test.ts',
  '2-4': 'tests/security/file-guard.test.ts',
  '3-12': 'tests/evolution/global-analyzer.test.ts',
};
const A_FIXED = new Set(['0-5', '2-4', '3-12']);

const q = (s) => s.replace(/'/g, '\u2019');

const plan = [];
for (const it of items) {
  const refs = refsOf(it);
  const missing = refs.filter((p) => !baseFiles.has(p));
  const dbDep = it.acceptance.some((a) => a.run.includes('data/synova.db'));
  const grepOnly = it.acceptance.some((a) => /\|\s*grep\s+-q/.test(a.run));

  let level, baseline, note, unverified;
  if (it.status === 'retired') {
    level = 'L1'; baseline = 'unrunnable';
    note = '已退役（#983 CLOSED/NOT_PLANNED）：前提被证伪 ⇒ 无判据、不参与 A/B/C/D 判定';
  } else if (it.status === 'proposal') {
    level = 'L1'; baseline = 'unrunnable';
    note = '提案项（接口变更先提案）：未派单 ⇒ 无判据可跑，A/B/C/D 均不适用';
  } else if (MEASURED_GREEN[it.id]) {
    level = 'L2'; baseline = 'green';
    note = `判据件 ${MEASURED_GREEN[it.id]} 在本 ref 存在，本会话于未修复基线实跑取到可复核输出（exit 0）`
      + (A_FIXED.has(it.id) ? '；A 修复：判据件已并入本项写集' : '');
    unverified = '未验：判据在未修复基线上全绿（exit 0）⇒ B 不成立，不能区分未修/已修；须补区分性断言后重判';
  } else if (it.id === '1-1') {
    level = 'L1'; baseline = 'unrunnable';
    note = 'V4(b) 修复：改指本 ref 存在的 GS-08 场景执行器（原 scripts/golden-scenarios/run.sh 系 phantom path，从未在任何 ref 存在）'
      + '；C 结构成立（场景走 common/fresh-db.ts 临时库，不触真实库）';
    unverified = '未验：判据件已落本 ref，但本会话沙箱下实跑 exit 1（npx/TMPDIR 写受限，非断言失败）⇒ B 未判';
  } else {
    level = 'L1'; baseline = 'unrunnable';
    const parts = [];
    if (missing.length) parts.push(`判据件 ${missing[0]} 不在本 ref（git cat-file -e 失败），须由本卡创建后才可跑`);
    else if (refs.length === 0) parts.push('判据不含文件引用（仅数据断言）⇒ A 无从判');
    else parts.push('判据件在本 ref 存在，但本会话未实跑');
    if (dbDep) parts.push('依赖 gitignored 的 data/synova.db ⇒ 干净检出/CI 姿态下 C 结构性不成立');
    if (grepOnly) parts.push('判据含纯 grep 型步骤（判例 V-02 违规，须由本卡改写为断言型）');
    note = parts.join('；');
    unverified = refs.length === 0
      ? '未验：判据仅数据断言且依赖 gitignored 的 data/synova.db ⇒ 干净检出下无法跑，B 无从判（判例 V-09 显式列出，禁写成已核）'
      : '未验：判据件不在本 ref ⇒ 无法在未修复基线上跑，B 无从判（判例 V-09 显式列出，禁写成已核）';
  }

  plan.push({ id: it.id, status: it.status, verifier: verifierFor(it), level, baseline, note: q(note), unverified: unverified ? q(unverified) : undefined, refs, missing });
}

// ── 报告 ────────────────────────────────────────────────────────────────
const todo = plan.filter((p) => p.status === 'todo');
const indep = todo.filter((p) => p.verifier !== 'win');
console.log(`items=${plan.length} todo=${todo.length}`);
console.log(`V5 verifier !== worker('win') : ${indep.length}/${todo.length}`);
const byV = {}; for (const p of todo) byV[p.verifier] = (byV[p.verifier] || 0) + 1;
console.log('verifier 分布:', JSON.stringify(byV));
const byL = {}; for (const p of plan) byL[p.level] = (byL[p.level] || 0) + 1;
console.log('level 分布:', JSON.stringify(byL));
const byB = {}; for (const p of plan) byB[p.baseline] = (byB[p.baseline] || 0) + 1;
console.log('baseline 分布:', JSON.stringify(byB));
if (MODE === 'dry') { console.log(JSON.stringify(plan, null, 1)); process.exit(0); }

// ── 写回 ────────────────────────────────────────────────────────────────
const byId = Object.fromEntries(plan.map((p) => [p.id, p]));
const lines = fs.readFileSync(FILE, 'utf8').split('\n');
const out = [];
let cur = null, hits = { v: 0, r: 0 };
for (const line of lines) {
  const mid = /^    id: '([^']+)',?\s*$/.exec(line);
  if (mid && byId[mid[1]]) cur = byId[mid[1]];
  out.push(line);
  if (cur && /^    worker: /.test(line)) {
    out.push(`    verifier: '${cur.verifier}',`);
    hits.v++;
  }
  if (cur && /^    status: '/.test(line)) {
    out.push('    verification: {');
    out.push(`      level: '${cur.level}', baseline: '${cur.baseline}',`);
    out.push(`      evidence: 'docs/synova/product-lines/evidence/V3V4V5/per-item.md#${cur.id}',`);
    out.push(`      note: '${cur.note}',`);
    if (cur.unverified) out.push(`      unverified: '${cur.unverified}',`);
    out.push('    },');
    hits.r++;
    cur = null;
  }
}
fs.writeFileSync(FILE, out.join('\n'));
console.log('inserted verifier=', hits.v, 'verification=', hits.r);
