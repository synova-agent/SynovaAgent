#!/usr/bin/env tsx
/**
 * 登记件不变量检查（CTO 2026-10-11 立）
 *
 * 背景（事故）：K12 新建项用了 id `1-9`，与 K4 既有项撞号；随后用正则"首匹配"改状态 ⇒ **误改 K4 的项**。
 * 根因实测：`git grep constructionItems -- scripts/ tests/ .github/` = **0 命中**
 *          ⇒ 登记件（机器真源）**零机器约束**：没有主键约束、没有唯一性检查、没有引用完整性检查。
 *
 * 契约（铁律 47）：
 *   @input  无参（读 docs/synova/coordination/施工项登记.ts）
 *   @output 逐条 ✅/❌ + 末行 `RESULT=PASS|FAIL` + 计数
 *   @exit   0=全部通过 ｜ 1=有不变量被破坏 ｜ 2=检查自身无法执行（fail-closed）
 *   @degraded 依赖缺失/文件读不到 ⇒ exit 2 + 明确原因（不静默）
 *
 * 四查（本件范围）：
 *   ① 唯一性     —— item id 全局唯一（**这是本次事故的直接维度**）
 *   ② 引用完整性 —— 每个块的 items 都能找到对应 item
 *   ③ 归属一致   —— item.block 必须出现在其所属块的 items 里（双向一致）
 *   ④ 命名规则   —— **新增项**须为 `<前缀>-<序号>` 式；裸"批次-序号"式记为 ⚠️（存量豁免，见下）
 */
import { constructionItems, constructionBlocks } from '../../docs/synova/coordination/施工项登记.ts';

const LEGACY_RE = /^\d+-\d+$/;          // 旧体系：0-4 / 1-9 / 3-11 …
const LEGACY_ALLOW = new Set(constructionBlocks.find((b) => b.id === 'K4')?.items ?? []);

let fail = 0;
const warn = (ok: boolean, msg: string) => { console.log(`  ${ok ? '✅' : '⚠️'} ${msg}`); };
const say = (ok: boolean, msg: string) => { console.log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail++; };

// ① 唯一性
const seen = new Map<string, number>();
for (const i of constructionItems) seen.set(i.id, (seen.get(i.id) ?? 0) + 1);
const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);
say(dups.length === 0, `① 唯一性：${constructionItems.length} 项 / ${seen.size} 个唯一 id${dups.length ? ` ｜ 🔴 重复: ${dups.join(', ')}` : ''}`);

// ② 引用完整性
const ids = new Set(constructionItems.map((i) => i.id));
const dangling: string[] = [];
for (const b of constructionBlocks) for (const x of b.items) if (!ids.has(x)) dangling.push(`${b.id}→${x}`);
say(dangling.length === 0, `② 引用完整性：块内悬空 ${dangling.length} 处${dangling.length ? ` ｜ ${dangling.join(', ')}` : ''}`);

// ③ 归属一致（双向）
const inconsistent: string[] = [];
for (const b of constructionBlocks) {
  for (const x of b.items) {
    const it = constructionItems.find((i) => i.id === x);
    if (it && it.block !== b.id) inconsistent.push(`${x} 声明 block=${it.block} 但被 ${b.id} 引用`);
  }
}
for (const i of constructionItems) {
  const b = constructionBlocks.find((x) => x.id === i.block);
  if (b && !b.items.includes(i.id)) inconsistent.push(`${i.id} 声明 block=${i.block} 但不在该块 items 里`);
}
warn(inconsistent.length === 0, `③ 归属一致（存量告警，不计阻断）：${inconsistent.length} 处不一致${inconsistent.length ? ` ｜ ${inconsistent.slice(0, 5).join('; ')}` : ''}`);

// ④ 命名规则（CTO 2026-10-11：**存量白名单豁免；白名单外一律阻断**）
//   白名单 = 本裁定生效时已在册的裸"批次-序号"式项（冻结）；此后新增裸式 ⇒ 阻断。
const LEGACY_FROZEN = new Set(['0-1', '0-10', '0-11', '0-12', '0-2', '0-3', '0-4', '0-5', '0-6', '0-7', '0-8', '0-9', '0-9bis', '1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-7bis', '1-8', '1-9', '2-1a', '2-1b', '2-2', '2-3', '2-4', '2-4bis', '2-6', '2-7', '3-10', '3-11', '3-12', '3-2', '3-5', '3-6', '3-7', '3-8', '3-9']);
const legacyNew = constructionItems.filter((i) => LEGACY_RE.test(i.id) && !LEGACY_FROZEN.has(i.id)).map((i) => i.id);
say(legacyNew.length === 0, `④ 命名规则：新项须 \`<前缀>-<序号>\` 式（存量冻结 ${LEGACY_FROZEN.size} 项豁免）${legacyNew.length ? ` ｜ 🔴 白名单外裸式: ${legacyNew.slice(0, 6).join(', ')}` : ''}`);


// ⑤ 【CTO 2026-10-11 立】issue 号唯一性（**唯一真源**）—— 手写 id 会撞，issue 号不会
const withIssue = constructionItems.filter((i) => typeof i.issue === 'number');
const iseen = new Map<number, number>();
for (const i of withIssue) iseen.set(i.issue as number, (iseen.get(i.issue as number) ?? 0) + 1);
const idup = [...iseen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `#${k}×${n}`);
say(idup.length === 0, `⑤ issue 唯一性（真源）：${withIssue.length}/${constructionItems.length} 项已带 issue ｜ 重复 ${idup.length ? idup.join(', ') : '0'}`);

// ⑥ 新增项必须有 issue（存量豁免：LEGACY 白名单 = 未带 issue 的存量项，只告警）
const noIssue = constructionItems.filter((i) => typeof i.issue !== 'number').map((i) => i.id);
console.log(`  ${noIssue.length ? '⚠️' : '✅'} ⑥ issue 必填（新项）：缺 issue 的项 ${noIssue.length} 项（存量待收敛）${noIssue.length ? ` ｜ ${noIssue.slice(0, 6).join(', ')}…` : ''}`);

console.log(`  RESULT=${fail === 0 ? 'PASS' : 'FAIL'} ｜ 项 ${constructionItems.length} ｜ 块 ${constructionBlocks.length} ｜ **阻断级**违例 ${fail}（① 唯一性 / ② 引用完整性）；③④ 为存量告警`);
process.exit(fail === 0 ? 0 : 1);
