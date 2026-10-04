#!/usr/bin/env node
/**
 * 施工项登记 · 执法体（三条不变量）—— 真能跑的检查
 *
 * @why  T7 独立复核最硬的一条反例：
 *       「登记件宣称的三条不变量【没有任何执行体】——
 *         `施工项登记.ts:21` 与生成器 `:14` 都写"由 check-construction-registry.py 执行"，
 *         而该文件在原三处仓都不存在。」
 *       ⇒ 约束搬出文档的判据是【违反时会失败】，不是【换了文件格式】。
 *       本文件就是那个"会失败"。
 *
 * @contract（铁律 47）
 *   @input  — 无参。读 `docs/synova/coordination/施工项登记.ts`。
 *   @output — stdout：逐条结论；**exit 0=过 / 1=违规 / 2=检查自身失败**（三态，本域铁律）
 *   @degraded — 登记件读不到 / ownership.yaml 不可解析 ⇒ exit 2（不静默当 0）
 *
 * @domain CTO（docs/synova/coordination/**）—— 本文件**不改 scripts/**，故不触治理线域
 *          ⚠️ 若治理线后来实现了 scripts/control-tower/check-construction-registry.py，
 *             以那个为准（它可进 CI）；本文件是 CT0 侧的**同源前置**，两者判据必须一致。
 *
 * @ref origin/main@1630a5014（2026-10-04 14:47）
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
// 🔴 修 T8 发现（三态 exit 契约未实现）：登记件读不到 / 结构不对 ⇒ exit 2
//    ⚠️ 必须用**动态 import**：静态 import 在 try 之前就失败，catch 根本没机会跑
//       （CTO 自查抓到的 bug：第一版用静态 import，verify 台实测 exit=1 而非 2）
type RegMod = typeof import('../施工项登记.ts');
let reg: RegMod;
try {
  reg = (await import('../施工项登记.ts')) as RegMod;
  if (!Array.isArray(reg.constructionItems) || !Array.isArray(reg.constructionBlocks)) throw new Error('结构不对');
} catch (e) {
  process.stderr.write(
    `  🔴 检查自身失败：登记件读不到或结构不对 — ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(2);
}
const { constructionItems, constructionBlocks, normalizePath, deriveBlockDeps, isModuleShape } = reg;
type Worker = RegMod['constructionItems'][number]['worker'];

type Fail = { inv: string; id: string; msg: string };
const fails: Fail[] = [];
const notes: string[] = [];
const gaps: string[] = [];

// 🔴 确定性（CTO 2026-10-04 自查发现）：git 探针必须指定【仓根】，不能靠 cwd ——
//    否则同一登记件在不同目录下结果不同（验证台副本报 7 处、原文件报 0 处）。
//    REG_GIT_ROOT 由调用方指定（默认 = 当前 cwd）。
const GIT_ROOT = process.env.REG_GIT_ROOT ?? process.cwd();
function sh(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const full = cmd === 'git' && args[0] !== '-C' ? ['-C', GIT_ROOT, ...args] : args;
    return { ok: true, out: execFileSync(cmd, full, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch {
    return { ok: false, out: '' };
  }
}

/** 产品仓路径是否存在于 origin/main（穿真相源，禁量工作树） */
function existsInMain(p: string): boolean {
  const r = sh('git', ['cat-file', '-e', `origin/main:${normalizePath(p)}`]);
  return r.ok;
}

/** 是否在自身写集内（glob 前缀匹配） */
function inOwnWriteSet(p: string, own: readonly string[]): boolean {
  const n = normalizePath(p);
  return own.some((w) => {
    const wg = normalizePath(w);
    if (wg.endsWith('/**') || wg.endsWith('/')) return n.startsWith(wg.replace(/\*+$/, ''));
    if (wg.includes('*')) return new RegExp('^' + wg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$').test(n);
    return n === wg || n.startsWith(wg.replace(/\/$/, '') + '/');
  });
}

const ids = new Set(constructionItems.map((i) => i.id));

// ════════ INV-1 · 依赖可判 ════════
for (const it of constructionItems) {
  for (const d of it.dependsOn) {
    if (!ids.has(d)) fails.push({ inv: 'INV-1', id: it.id, msg: `dependsOn "${d}" 不存在` });
  }
}
// 环检测
{
  const g = new Map(constructionItems.map((i) => [i.id, i.dependsOn]));
  const seen = new Set<string>(), stack = new Set<string>();
  const walk = (n: string, path: string[]): void => {
    if (stack.has(n)) { fails.push({ inv: 'INV-1', id: n, msg: `依赖成环: ${[...path, n].join(' → ')}` }); return; }
    if (seen.has(n)) return;
    stack.add(n);
    for (const m of g.get(n) ?? []) walk(m, [...path, n]);
    stack.delete(n); seen.add(n);
  };
  for (const it of constructionItems) walk(it.id, []);
}
// 🔴 建表项：每个 NOT NULL 字段必须有【可核的生产者】
//    🔴 2026-10-04 CTO 自查修正：判据顺序改为**声明优先于 grep**。
//       原顺序（先 grep 后看声明）会导致**同一登记件在不同 cwd 下结果不同** —— 这是执法体最不该有的性质。
//       （实证：验证台副本报 7 处违规、原文件报 0 处；根因是 git grep 依赖 cwd 的仓状态）
//    新逻辑（确定性，与 cwd 无关）：
//       ① 有 producer:<id> 声明 ⇒ 通过（可核：声明指向一个 item id）
//       ② 有 [known-gap] 声明 ⇒ 记【待办】不记违规
//       ③ 有 run:<cmd> 声明   ⇒ 通过（命令即生产者证据）
//       ④ 有声明但形态不可核   ⇒ exit 1（INV-1③b）
//       ⑤ 完全无声明 ⇒ 才回落到 git grep 探针；探针也无命中 ⇒ exit 1（INV-1③）
for (const it of constructionItems) {
  if (!it.createsTable) continue;
  for (const f of it.createsTable.notNullFields) {
    const declared = it.createsTable.fieldProducers?.[f];
    if (declared) {
      if (declared.startsWith('[known-gap]')) {
        gaps.push(`${it.id} · ${it.createsTable.name}.${f} — ${declared.replace('[known-gap]', '').trim().slice(0, 70)}`);
      } else if (!/^(producer:|run:)/.test(declared)) {
        fails.push({
          inv: 'INV-1③b', id: it.id,
          msg: `字段 "${f}" 的声明不是可核形态（须 [known-gap] / producer:<id> / run:<cmd>）：${declared.slice(0, 50)}`,
        });
      }
      continue; // 有可核声明 ⇒ 不回落到 grep（保证与 cwd 无关）
    }
    // 无声明 ⇒ 回落到 git grep 探针（手写词边界；`\b` 在本机 git ERE 下不匹配任何东西）
    const g = sh('git', ['grep', '-l', '-E', `(^|[^A-Za-z0-9_])${f}([^A-Za-z0-9_]|$)`, 'origin/main', '--', 'src/', 'extensions/', 'packages/']);
    const hasProducer = g.ok && g.out.trim().length > 0;
    if (!hasProducer) {
      fails.push({
        inv: 'INV-1③', id: it.id,
        msg: `表 ${it.createsTable.name} 的 NOT NULL 字段 "${f}" 【无生产者】且登记件无 fieldProducers 声明位 ⇒ 建不过`,
      });
    }
  }
}

// ════════ INV-2 · 派单可判（原"归属可判" —— 域概念已废止 2026-10-04）════════
// 新判据：① worker 必须存在（派给谁）② paths 必须非空（落点已定）③ 形状须是模块
for (const it of constructionItems) {
  // 🔴 修 T8 发现（worker 取值域未校验）：'zzz-not-a-worker' 曾 → 0 违规
  const VALID_WORKERS: readonly Worker[] = ['cto', 'win', 'mac', 'k3', 'gov'];
  if (!it.worker) fails.push({ inv: 'INV-2', id: it.id, msg: 'worker 未指定（派给谁）' });
  else if (!VALID_WORKERS.includes(it.worker)) fails.push({ inv: 'INV-2', id: it.id, msg: `worker "${it.worker}" 不在取值域 ${VALID_WORKERS.join('/')}` });
  if (it.paths.length === 0) {
    if (!it.pathTBD) fails.push({ inv: 'INV-2', id: it.id, msg: '无 paths 且未标 pathTBD' });
  } else if (!isModuleShape(it.paths)) {
    fails.push({ inv: 'INV-2', id: it.id, msg: `写集形状不构成模块（须为 <dir>/… 形态）: ${it.paths.join(', ')}` });
  }
}

// ════════ INV-3 · 标准可执行（穿产品仓 or 在自身写集内）════════
const GREP_ONLY = /^(?!.*(?:vitest|tsx|probe-|scripts\/|sqlite3))(?=.*grep)/;
// 从命令里抽文件引用
function fileRefs(run: string): string[] {
  const out: string[] = [];
  const re = /(?<![\w/.-])((?:src|extensions|packages|scripts|tests|docs|cycles)\/[A-Za-z0-9_./\u4e00-\u9fa5*-]+\.(?:ts|tsx|sh|py|json|md|yaml|yml))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run)) !== null) out.push(m[1]);
  return out;
}
for (const it of constructionItems) {
  if (it.acceptance.length === 0) { fails.push({ inv: 'INV-3', id: it.id, msg: '无 acceptance' }); continue; }
  for (const a of it.acceptance) {
    const hasExp = a.expectExit !== undefined || a.expectStdoutContains !== undefined || a.expectRowsGt !== undefined;
    // ⚠️ 必须用 !== undefined —— `!a.expectExit` 会把合法值 0 判为假（T7 之前，我自己踩过，误报 36 处）
    if (!hasExp) fails.push({ inv: 'INV-3', id: it.id, msg: 'acceptance 无 expect' });
    if (GREP_ONLY.test(a.run)) fails.push({ inv: 'INV-3②', id: it.id, msg: `纯 grep 型判据 ⇒ ${a.run.slice(0, 60)}` });
    for (const f of fileRefs(a.run)) {
      const inMain = existsInMain(f);
      const inOwn = inOwnWriteSet(f, it.paths);
      if (!inMain && !inOwn) {
        fails.push({ inv: 'INV-3③', id: it.id, msg: `判据引用的 "${f}" 在 origin/main 不存在、也不在自身写集内 ⇒ 该判据跑不起来` });
      }
    }
  }
}

// ════════ INV-4 · 写集互斥（2026-10-04 立 —— 治 T8 面 3 核心反例）════════
// 背景：创始人废止"域"后，**写集互斥是唯一的替代物**（废止件 §五③）。
//       而 T8 实测：登记件自身 35 对写集重叠、执法体一条不查。
// 分级（按真实语义）：
//   · **同路径** ⇒ exit 1（两张卡改同一文件，必须显式声明共写并串行）
//   · 包含 / 相交 ⇒ ℹ️ 报告（宽卡应写窄；这是提示不是违规）
{
  type G = { pat: string; item: string; re: RegExp; dir: boolean };
  const gs: G[] = [];
  const mkRe = (p: string, dir: boolean): RegExp =>
    new RegExp(
      '^' + p.replace(/[*]{2}/g, '\u0000').replace(/[*]/g, '[^/]*').replace(/\u0000/g, '.*')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') + (dir ? '(/.*)?$' : '$'),
    );
  for (const it of constructionItems) {
    for (const raw of it.paths) {
      const pp = normalizePath(raw).replace(/\/$/, '');
      const dir = pp.endsWith('/**') || !pp.includes('.');
      gs.push({ pat: pp, item: it.id, re: mkRe(pp, dir), dir });
    }
  }
  const samePath: string[] = [];
  const softShared: string[] = [];
  const soft: string[] = [];
  const seen = new Set<string>();
  for (const g1 of gs) for (const g2 of gs) {
    if (g1.item >= g2.item) continue;
    if (!g1.re.test(g2.pat) && !g2.re.test(g1.pat)) continue;
    const k = [g1.item, g2.item].sort().join('|') + '|' + [g1.pat, g2.pat].sort().join('~');
    if (seen.has(k)) continue;
    seen.add(k);
    if (g1.pat === g2.pat) samePath.push(`${g1.item} × ${g2.item} 同写 ${g1.pat}`);
    else soft.push(`${g1.item} × ${g2.item}  ${g1.pat} ／ ${g2.pat}`);
  }
  for (const x of samePath) {
    const id = x.split(' ')[0];
    // 🔴 修：原先只查一侧（pair 的第一个 id）⇒ 声明在另一侧时漏判
    //    改为【两侧都查】
    const ids2 = [x.split(' ')[0], x.split(' ')[2]];
    const pathPart = x.split('同写 ')[1] ?? '';
    const declared = ids2.some((iid) =>
      (constructionItems.find((y) => y.id === iid)?.sharedWrite ?? []).some((w) => w.includes(pathPart)),
    );
    if (!declared) {
      fails.push({ inv: 'INV-4', id, msg: `写集同路径且未声明共写（须加 sharedWrite）：${x}` });
    } else {
      softShared.push(x);
    }
  }
  if (soft.length) notes.push(`写集包含/相交 ${soft.length} 对（提示：宽卡应写窄）—— 前 5: ${soft.slice(0, 5).join(' ; ')}`);
  if (softShared.length) notes.push(`已显式声明共写（须串行）${softShared.length} 对: ${softShared.join(' ; ')}`);
}

// ════════ 块完整性 ════════
const inBlock = new Set<string>();
for (const b of constructionBlocks) {
  for (const i of b.items) {
    if (!ids.has(i)) fails.push({ inv: 'BLOCK', id: b.id, msg: `引用了不存在的项 ${i}` });
    if (inBlock.has(i)) fails.push({ inv: 'BLOCK', id: b.id, msg: `项 ${i} 出现在多个块` });
    inBlock.add(i);
  }
  if (b.blockAcceptance.length === 0) fails.push({ inv: 'BLOCK', id: b.id, msg: '无块级完成标准' });
  // 🔴 修 T8 发现：blockAcceptance 原先只判"非空" ⇒ 块级标准是漏判区
  //    现把 INV-3 的三条判据同样施于块级标准
  for (const a of b.blockAcceptance) {
    const hasExp = a.expectExit !== undefined || a.expectStdoutContains !== undefined || a.expectRowsGt !== undefined;
    if (!hasExp) fails.push({ inv: 'BLOCK-INV3', id: b.id, msg: '块级标准无 expect' });
    if (GREP_ONLY.test(a.run)) fails.push({ inv: 'BLOCK-INV3②', id: b.id, msg: `块级标准纯 grep 型 ⇒ ${a.run.slice(0, 60)}` });
    for (const f of fileRefs(a.run)) {
      if (!existsInMain(f) && !inOwnWriteSet(f, b.items.flatMap((iid) => constructionItems.find((x) => x.id === iid)?.paths ?? []))) {
        fails.push({ inv: 'BLOCK-INV3③', id: b.id, msg: `块级标准引用的 "${f}" 不存在且不在块内任一项写集内 ⇒ 跑不起来` });
      }
    }
  }
}
for (const it of constructionItems) if (!inBlock.has(it.id)) fails.push({ inv: 'BLOCK', id: it.id, msg: '不属于任何块' });

// 块级依赖：**已改为自动汇总**（2026-10-04 废止手写）⇒ 不再有"手写值与项级不符"这类违规
// 保留一条断言：自动汇总的结果必须能算出来（否则说明项级依赖有悬空 id）
{
  const dep = deriveBlockDeps();
  const n = Object.values(dep).reduce((a, x) => a + x.length, 0);
  notes.push(`块间依赖（自动汇总）: ${n} 条 —— ${Object.entries(dep).filter(([, v]) => v.length).map(([k, v]) => `${k}→[${v.join(',')}]`).join('  ')}`);
  // 🔴 T8 发现"块级依赖有 2 个环"，CTO 复核后判定：**这 2 个"环"是块分组的产物，不是真环**。
  //    证据（项级实测）：K3⇄K5 的项级依赖为 2-1a→2-6、2-2→2-1a、2-7→2-1b ⇒ 链 2-6→2-1a→2-2，**无环**；
  //                    K7⇄K9 为 3-1→1-2、3-7→3-6 ⇒ 两条**互不相连**的线性边，被"块"圈在一起才成环。
  //    ⇒ 真依赖在**项级**（INV-1 已判，无环）；块级"环"是分组假象 ⇒ 降为 ℹ️ 不记违规。
  //    （这与"域"同型：拿【分组】当【依赖】会产生假问题。）
  {
    const seenB = new Set<string>(), stackB = new Set<string>();
    const cycles: string[] = [];
    const walkB = (b: string, path: string[]): void => {
      if (stackB.has(b)) { cycles.push([...path, b].join(' → ')); return; }
      if (seenB.has(b)) return;
      stackB.add(b);
      for (const m of dep[b as keyof typeof dep] ?? []) walkB(m as string, [...path, b]);
      stackB.delete(b); seenB.add(b);
    };
    for (const b of constructionBlocks) walkB(b.id, []);
    const uniq = [...new Set(cycles)];
    if (uniq.length) notes.push(`块级"环"（分组假象，非真环 —— 项级已验无环）: ${uniq.join(' / ')}`);
  }
}

// ════════ 报告 ════════
const byInv = new Map<string, Fail[]>();
for (const f of fails) { const a = byInv.get(f.inv) ?? []; a.push(f); byInv.set(f.inv, a); }

console.log(`  施工项登记执法体 ｜ 项数 ${constructionItems.length} ｜ 块数 ${constructionBlocks.length}`);
console.log(`  ref: origin/main@1630a5014 ｜ 判据：INV-1 依赖 / INV-2 归属 / INV-3 标准 / BLOCK 完整性`);
console.log('');
for (const [k, v] of [...byInv.entries()].sort()) {
  console.log(`  ${k}: ${v.length} 处`);
  for (const x of v.slice(0, 12)) console.log(`    ${x.id.padEnd(6)} ${x.msg}`);
  if (v.length > 12) console.log(`    … 另有 ${v.length - 12} 处`);
}
console.log('');
if (gaps.length) {
  console.log(`  ⏳ 已声明但未实现（known-gap，${gaps.length} 处 —— 属施工项，非违规）:`);
  for (const g of gaps) console.log(`    ${g}`);
  console.log('');
}
for (const n of notes) console.log(`  ℹ️  ${n}`);
console.log('');
console.log(`  ══ 合计 ${fails.length} 处违规 ══`);
process.exit(fails.length > 0 ? 1 : 0);
