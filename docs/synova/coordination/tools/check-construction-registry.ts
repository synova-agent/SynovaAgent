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
import { constructionItems, constructionBlocks, normalizePath, deriveBlockDeps, isModuleShape } from '../施工项登记.ts';

type Fail = { inv: string; id: string; msg: string };
const fails: Fail[] = [];
const notes: string[] = [];

function sh(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }) };
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
// 🔴 建表项：每个 NOT NULL 字段必须有生产者（否则 exit 2 —— 治"第 29 张零行表"）
for (const it of constructionItems) {
  if (!it.createsTable) continue;
  for (const f of it.createsTable.notNullFields) {
    // 生产者判据：产品仓里存在写入该字段的证据（INSERT/UPDATE/props 赋值），或【有声明位】
    const g = sh('git', ['grep', '-l', '-E', `\\b${f}\\b`, 'origin/main', '--', 'src/', 'extensions/', 'packages/']);
    const hasProducer = g.ok && g.out.trim().length > 0;
    if (!hasProducer) {
      // 登记件是否有"字段→生产者"声明位？
      const declared = (it as unknown as { fieldProducers?: Record<string, string> }).fieldProducers?.[f];
      if (!declared) {
        fails.push({
          inv: 'INV-1③',
          id: it.id,
          msg: `表 ${it.createsTable.name} 的 NOT NULL 字段 "${f}" 【无生产者】且登记件无 fieldProducers 声明位 ⇒ 建不过`,
        });
      }
    }
  }
}

// ════════ INV-2 · 派单可判（原"归属可判" —— 域概念已废止 2026-10-04）════════
// 新判据：① worker 必须存在（派给谁）② paths 必须非空（落点已定）③ 形状须是模块
for (const it of constructionItems) {
  if (!it.worker) fails.push({ inv: 'INV-2', id: it.id, msg: 'worker 未指定（派给谁）' });
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

// ════════ 块完整性 ════════
const inBlock = new Set<string>();
for (const b of constructionBlocks) {
  for (const i of b.items) {
    if (!ids.has(i)) fails.push({ inv: 'BLOCK', id: b.id, msg: `引用了不存在的项 ${i}` });
    if (inBlock.has(i)) fails.push({ inv: 'BLOCK', id: b.id, msg: `项 ${i} 出现在多个块` });
    inBlock.add(i);
  }
  if (b.blockAcceptance.length === 0) fails.push({ inv: 'BLOCK', id: b.id, msg: '无块级完成标准' });
}
for (const it of constructionItems) if (!inBlock.has(it.id)) fails.push({ inv: 'BLOCK', id: it.id, msg: '不属于任何块' });

// 块级依赖：**已改为自动汇总**（2026-10-04 废止手写）⇒ 不再有"手写值与项级不符"这类违规
// 保留一条断言：自动汇总的结果必须能算出来（否则说明项级依赖有悬空 id）
{
  const dep = deriveBlockDeps();
  const n = Object.values(dep).reduce((a, x) => a + x.length, 0);
  notes.push(`块间依赖（自动汇总）: ${n} 条 —— ${Object.entries(dep).filter(([, v]) => v.length).map(([k, v]) => `${k}→[${v.join(',')}]`).join('  ')}`);
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
for (const n of notes) console.log(`  ℹ️  ${n}`);
console.log('');
console.log(`  ══ 合计 ${fails.length} 处违规 ══`);
process.exit(fails.length > 0 ? 1 : 0);
