/**
 * d966-static-scans.mts — 复核员自建静态扫描 S1..S4（不依赖被验方脚本）
 * 定义（照被验方文档口径，独立实现）:
 *   S1 = 只扫 entryPoint 文件 · queryNodes 字样 0 次
 *   S2 = 只扫 entryPoint 文件 · 全无数据访问原语
 *   S3 = 扫整个哨兵目录   · queryNodes 字样 0 次
 *   S4 = 扫整个哨兵目录   · 全无数据访问原语
 * 另加 S5 = 运行时 §方法级 queryNodes 调用 = 0（由 probe JSON 提供，此处只打印对照）
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const WT = process.argv.find(a => a.startsWith('--wt='))?.slice(5) || '/Users/wane/SynovaAgent/.synova-wt-verify-base2';
const PRIMS = ['queryNodes', 'queryEdges', 'queryTriples', 'getNode', 'traverse'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const count = (files: string[], token: string) => files.reduce((s, f) => s + (readFileSync(f, 'utf8').split(token).length - 1), 0);

const root = join(WT, 'extensions', 'sentinels');
const dirs = readdirSync(root, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== 'shared' && !e.name.startsWith('_'))
  .map(e => e.name).sort();

const rows: Array<{ name: string; entryQN: number; entryAny: boolean; dirQN: number; dirAny: boolean; files: number }> = [];
for (const name of dirs) {
  const dir = join(root, name);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { entryPoint?: string };
  const entryRel = manifest.entryPoint || './aggregate.ts';
  const entryPath = join(dir, entryRel.replace('./', ''));
  const entryFiles = existsSync(entryPath) ? [entryPath] : [];
  const allFiles = walk(dir);
  const entryQN = count(entryFiles, 'queryNodes');
  const dirQN = count(allFiles, 'queryNodes');
  rows.push({
    name, entryQN, dirQN, files: allFiles.length,
    entryAny: PRIMS.some(p => count(entryFiles, p) > 0),
    dirAny: PRIMS.some(p => count(allFiles, p) > 0),
  });
}

const S1 = rows.filter(r => r.entryQN === 0).map(r => r.name);
const S2 = rows.filter(r => !r.entryAny).map(r => r.name);
const S3 = rows.filter(r => r.dirQN === 0).map(r => r.name);
const S4 = rows.filter(r => !r.dirAny).map(r => r.name);
console.log('# wt =', WT, '| active sentinels =', dirs.length);
console.log(`S1 只扫 entryPoint · queryNodes 字样 = 0 : ${S1.length}  [${S1.join(', ')}]`);
console.log(`S2 只扫 entryPoint · 全无原语     = 0 : ${S2.length}  [${S2.join(', ')}]`);
console.log(`S3 整目录 · queryNodes 字样      = 0 : ${S3.length}  [${S3.join(', ')}]`);
console.log(`S4 整目录 · 全无原语             = 0 : ${S4.length}  [${S4.join(', ')}]`);
console.log('assumption-check: 四种扫法里是否出现 20 =', [S1, S2, S3, S4].some(a => a.length === 20));
const s1 = S1.filter(n => !S3.includes(n));
console.log('S1→S3 差集（入口漏但目录有）:', JSON.stringify(s1));
