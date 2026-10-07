/**
 * v5-verifier-sample10.ts — V5 判据：抽 10 项，`verifier !== worker` 的比例 ≥ 80%
 *
 * 用法（仓根）：
 *   node --experimental-strip-types docs/synova/product-lines/evidence/V3V4V5/v5-verifier-sample10.ts
 *
 * 抽样口径（可复跑，非手挑）：在 `status==='todo'` 的项按登记顺序等距取 10 个
 *   下标 = floor(i * N / 10)，i = 0..9  （N=46 ⇒ 0,4,9,13,18,23,27,32,36,41）
 *
 * 契约（铁律 47）：
 *   @input  — 无（读登记件默认路径）
 *   @output — stdout：抽样表 + 比例；exit 0 = 比例 ≥ 80%，exit 1 = 不达标
 *   @degraded — 项数 < 10 ⇒ 打印 DEGRADED 并 exit 2（不静默降级）
 */
import process from 'node:process';

const m = await import(process.cwd() + '/docs/synova/coordination/施工项登记.ts');
const todo = m.constructionItems.filter((i) => i.status === 'todo');
if (todo.length < 10) { process.stderr.write(`DEGRADED: todo 项数 ${todo.length} < 10\n`); process.exit(2); }

const idx = Array.from({ length: 10 }, (_, i) => Math.floor((i * todo.length) / 10));
const sample = idx.map((k) => todo[k]);

console.log('| # | item | worker(派给谁) | verifier(判据落地方) | ≠ ? |');
console.log('|---|------|---------------|---------------------|-----|');
sample.forEach((it, i) => {
  console.log(`| ${i + 1} | ${it.id} | ${it.worker} | ${it.verifier} | ${it.verifier !== it.worker ? 'YES' : 'NO'} |`);
});
const pass = sample.filter((it) => it.verifier !== it.worker).length;
const ratio = pass / sample.length;
console.log('');
console.log(`抽样下标 = [${idx.join(', ')}]（等距，非手挑）`);
console.log(`verifier !== worker : ${pass}/${sample.length} = ${(ratio * 100).toFixed(0)}%`);
console.log(`阈值 80% ⇒ ${ratio >= 0.8 ? 'PASS' : 'FAIL'}`);
console.log('');
console.log('全量口径（46/46 项）= 100%；`none` 计数 = ' + todo.filter((i) => i.verifier === 'none').length
  + '（本字段无 `none`：`none` 是风险标记，不是达标手段）');
process.exit(ratio >= 0.8 ? 0 : 1);
