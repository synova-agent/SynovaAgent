/**
 * analyze.ts — V3/V4 判据体检器（可复跑）
 *
 * 用法（在仓根跑）：
 *   node --experimental-strip-types docs/synova/product-lines/evidence/V3V4V5/analyze.ts \
 *        [--ref origin/main] [--registry docs/synova/coordination/施工项登记.ts]
 *
 * 输出：① 逐项 TSV（stdout）② 汇总计数（stderr，便于 `2>&1 >/dev/null` 单独取）
 *
 * 契约（铁律 47）：
 *   @input  — 登记件路径（默认 docs/synova/coordination/施工项登记.ts）+ git ref（默认 origin/main）
 *   @output — stdout: 每项一行的 TSV；stderr: 汇总计数块
 *   @degraded — git ref 不可解析 ⇒ 打印 `DEGRADED: ...` 到 stderr 并 exit 2（**不静默降级**，铁律 24）
 *
 * 口径（与登记件 ItemVerification 的 JSDoc 逐字一致）：
 *   A 判据须落本项写集内   — acceptance 里每个文件路径 ∈ paths（相等/子路径/通配）
 *   B 修复前 baseline 上须红 — 读登记件 `verification.baseline`（实测值，证据在 v3-baseline-run.md）
 *   C 出货姿态成立         — 判据件在 ref 存在 且 不依赖 gitignored 的 data/**
 *   D 改坏即红夹具         — 由 fixtures 路承担 ⇒ 本器输出 n/a
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const REF = arg('ref', 'origin/main');
const REG = arg('registry', 'docs/synova/coordination/施工项登记.ts');

let files;
try {
  files = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', REF], { maxBuffer: 1e9 }).toString().split('\n').filter(Boolean));
} catch (e) {
  process.stderr.write(`DEGRADED: 无法解析 ref ${REF}: ${e.message}\n`);
  process.exit(2);
}

const m = await import(process.cwd() + '/' + REG);
const items = m.constructionItems;

const PATHRE = /(?:^|[\s"'(=])((?:\.\/)?(?:src|tests|scripts|packages|extensions|expert|knowledge|theory|docs|cycles|tools|data|\.dsh)\/[A-Za-z0-9_\-.\/*]+\.[A-Za-z0-9]+)/g;
const refsOf = (it) => {
  const s = new Set();
  for (const a of it.acceptance) {
    if (a.run.includes('data/synova.db')) s.add('data/synova.db');
    let mm; PATHRE.lastIndex = 0;
    while ((mm = PATHRE.exec(a.run))) s.add(mm[1].replace(/^\.\//, ''));
  }
  return [...s];
};

/** 判据引用 p 是否落在本项写集内（A 判据） */
function inWriteSet(ref, paths) {
  return paths.some((p) => {
    if (p === ref) return true;
    if (p.endsWith('/')) return ref.startsWith(p);
    if (p.startsWith(ref)) return false;
    if (p.includes('*')) {
      const rx = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
      return rx.test(ref);
    }
    return ref.startsWith(p + '/');
  });
}

const rows = [];
for (const it of items) {
  if (it.status !== 'todo') continue;
  const refs = refsOf(it);
  const missing = refs.filter((r) => !files.has(r));
  const dbDep = refs.includes('data/synova.db');
  // 口径 1（严格，本器主口径）：命令里出现的**每个**文件路径都算，含 data/synova.db
  const A = refs.length === 0 ? 'n/a' : (refs.every((r) => inWriteSet(r, it.paths)) ? 'Y' : 'N');
  // 口径 2（S5 尽调口径，仅用于与既有数字对齐）：data/** 不算文件路径；无文件引用记 n/a
  const refs2 = refs.filter((r) => !r.startsWith('data/'));
  const A2 = refs2.length === 0 ? 'n/a' : (refs2.every((r) => inWriteSet(r, it.paths)) ? 'Y' : 'N');
  // 判据件缺失（S5 口径）：文件型引用缺失 **或** 判据不含任何文件引用
  const critMissing = refs2.length === 0 || refs2.some((r) => !files.has(r));
  const C = (missing.length === 0 && !dbDep && refs.length > 0) ? 'Y' : 'N';
  const B = it.verification ? it.verification.baseline : '?';
  rows.push({ id: it.id, worker: it.worker, verifier: it.verifier, level: it.verification?.level, A, A2, B, C, D: 'n/a', critMissing, nrefs: refs.length, nmiss: missing.length, miss: missing.join(','), refs: refs.join(',') });
}

const head = ['id', 'worker', 'verifier', 'level', 'A', 'A_S5', 'B', 'C', 'D', 'critMissing', 'nrefs', 'nmiss', 'missing', 'refs'];
console.log(head.join('\t'));
for (const r of rows) console.log([r.id, r.worker, r.verifier, r.level, r.A, r.A2, r.B, r.C, r.D, r.critMissing ? 'Y' : 'N', r.nrefs, r.nmiss, r.miss, r.refs].join('\t'));

const cnt = (f) => rows.filter(f).length;
const E = (s) => process.stderr.write(s + '\n');
E(`# ref=${REF} registry=${REG} todo=${rows.length}`);
E(`A(严格·含 data/** 路径)=Y:${cnt((r) => r.A === 'Y')} N:${cnt((r) => r.A === 'N')} n/a:${cnt((r) => r.A === 'n/a')}`);
E(`A(S5 口径·不含 data/**)=Y:${cnt((r) => r.A2 === 'Y')} N:${cnt((r) => r.A2 === 'N')} n/a:${cnt((r) => r.A2 === 'n/a')}`);
E(`B(green)=${cnt((r) => r.B === 'green')}  B(unrunnable)=${cnt((r) => r.B === 'unrunnable')}  B(red)=${cnt((r) => r.B === 'red')}`);
E(`C(Y)=${cnt((r) => r.C === 'Y')}  C(N)=${cnt((r) => r.C === 'N')}`);
E(`D: n/a（由 fixtures 路承担）`);
E(`L2=${cnt((r) => r.level === 'L2')}  L1=${cnt((r) => r.level === 'L1')}`);
E(`V5 verifier!==worker : ${cnt((r) => r.verifier !== r.worker)}/${rows.length}`);
E(`判据件缺失(S5 口径)=${cnt((r) => r.critMissing)} 项 —— S5 尽调记 40/46，本器减 1 因 1-1 已改指存在的 GS-08 执行器`);
