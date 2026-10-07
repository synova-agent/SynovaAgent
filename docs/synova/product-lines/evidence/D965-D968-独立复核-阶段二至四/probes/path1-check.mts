/**
 * path1-check.mts — D968 关键声称 1「路径1 关停是行为中性」复现
 * 在基线树（D967b）调用 registerBuiltinSentinels()，独立复现 scanned/registered 与键名不匹配。
 */
import { readdirSync } from 'fs';
import { join } from 'path';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
process.chdir(WT);
const { registerBuiltinSentinels } = await import(`${WT}/src/sentinel/builtins.ts`);
const { getSentinelRegistry, destroySentinelRegistry } = await import(`${WT}/src/sentinel/registry.ts`);

// 我自实现的同款推导（复刻旧 filenameToExportKey 语义，仅用于展示不匹配）
const derive = (f: string) => f.replace(/-sentinel\.ts$/, '').replace(/\.ts$/, '').replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());

const dir = join(WT, 'src', 'sentinel', 'adapters');
const files = readdirSync(dir).filter(f => f.endsWith('-sentinel.ts') || f.endsWith('-sentinel.js'));
console.log('# 扫描源 =', dir);
console.log('# 命中文件 =', JSON.stringify(files), '→ scanned =', files.length);
for (const f of files) {
  const mod = await import(join(dir, f).replace(/\\/g, '/'));
  const derived = derive(f);
  const actual = Object.keys(mod).filter(k => /sentinel/i.test(k));
  console.log(`#   ${f}: 推导键="${derived}"（模块内是否存在=${derived in mod}）｜实际导出=${JSON.stringify(actual)}`);
}

destroySentinelRegistry();
const reg = getSentinelRegistry();
const before = reg.count();
console.log('# registry.count() before =', before);
await registerBuiltinSentinels();
const after = reg.count();
console.log('# registry.count() after  =', after);
console.log(`# ASSERT registered = 0 → ${after - before === 0 ? 'HOLDS' : 'VIOLATED(+' + (after - before) + ')'}`);
console.log('# registry 内哨兵 =', JSON.stringify(reg.list().map(s => s.config.id)));
process.exit(0);
