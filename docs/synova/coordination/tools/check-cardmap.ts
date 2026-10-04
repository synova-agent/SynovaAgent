#!/usr/bin/env node
/**
 * 溯源冻结 · 登记件 ↔ 板 的双向可追溯（生成 + 校验，一个脚本两件事）
 *
 * @why  ① K3 全仓审计实测出的最硬缺口：**登记件正文零卡号、板自动化零脚本**
 *          ⇒ 两份事实源会**静默分叉**，没人会知道
 *       ② 「不许人填两遍」—— 人填必漂移（CTO 已实测：97 条 Status 被一键刷成假值）
 *       ③ 所以本件做两件事：
 *          `--emit`  从【板】反查生成 `cardmap.json`（板的卡号是事实，不由人写）
 *          （默认）  校验双向一致，exit 三态
 *
 * @contract（铁律 47）
 *   @input  — 无参（默认校验）｜`--emit`（生成映射件）
 *   @output — `docs/synova/coordination/cardmap.json`（生成物，禁手改）
 *             stdout 逐条结论；**exit 0=一致 / 1=分叉 / 2=检查自身失败**
 *   @degraded — gh 取不到板 / JSON 解析失败 ⇒ exit 2（禁静默当一致）
 *
 * @freeze-both-ways
 *   正向：登记件每项 ⇒ 必须能在 cardmap 找到卡号，且板上该卡存在、标题含该项 id
 *   反向：cardmap 每张卡 ⇒ 其 id 必须在登记件里（板上的**孤儿卡**要报出来）
 *   🔴 两个登记件都覆盖：`施工项登记.ts`（40 项）+ `DSH借鉴项登记.ts`（24 项）
 *
 * @ref origin/main@1630a5014（截止 2026-10-05）
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REG_DIR = resolve(HERE, '..');
const MAP_PATH = resolve(REG_DIR, 'cardmap.json');
const PROJECT_ID = 'PVT_kwDOFAmDns4Blb57';

// ── 取板上全部卡（游标分页 —— GitHub 单页上限硬是 100，禁 first>100）────
function fetchCards(): Array<{ number: number; title: string }> {
  const OUT: Array<{ number: number; title: string }> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const after = cursor ? `, after: "${cursor}"` : '';
    const q = `query { node(id:"${PROJECT_ID}") { ... on ProjectV2 { items(first: 100${after}) { pageInfo { hasNextPage endCursor } nodes { content { ... on Issue { number title } } } } } } }`;
    let o: {
      data?: {
        node?: {
          items?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
            nodes?: Array<{ content?: { number?: number; title?: string } }>;
          };
        };
      };
    };
    try {
      const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${q}`], { encoding: 'utf-8' });
      o = JSON.parse(out) as typeof o;
    } catch (e) {
      process.stderr.write(`  🔴 板取不到（gh 失败或解析失败，page=${page}）：${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(2);
    }
    const it = o.data?.node?.items;
    if (!it) {
      process.stderr.write(`  🔴 板结构不对（page=${page}）⇒ exit 2\n`);
      process.exit(2);
    }
    for (const n of it.nodes ?? []) {
      const c = n.content;
      if (c?.number) OUT.push({ number: c.number, title: c.title ?? '' });
    }
    if (!it.pageInfo?.hasNextPage) break;
    cursor = it.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }
  return OUT;
}

// ── 取两个登记件的 (id, block) ──────────────────────────────────
type Reg = { id: string; block?: string; title: string; src: 'construction' | 'dsh' };

async function loadRegistries(): Promise<Reg[]> {
  let a: { constructionItems: Array<{ id: string; title: string }>; constructionBlocks: Array<{ id: string; items: string[] }> };
  let b: { dshItems: Array<{ id: string; name: string }> };
  try {
    a = (await import(`${REG_DIR}/施工项登记.ts`)) as typeof a;
    b = (await import(`${REG_DIR}/DSH借鉴项登记.ts`)) as typeof b;
  } catch (e) {
    process.stderr.write(`  🔴 登记件读不到：${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
  const blk = new Map<string, string>();
  for (const bl of a.constructionBlocks) for (const id of bl.items) blk.set(id, bl.id);
  const out: Reg[] = a.constructionItems.map((i) => ({ id: i.id, block: blk.get(i.id), title: i.title, src: 'construction' as const }));
  for (const i of b.dshItems) out.push({ id: i.id, title: i.name, src: 'dsh' as const });
  return out;
}

/** 卡标题判据：以 `<id>` 开头（后接空格/·/·） */
function cardMatchesId(title: string, id: string): boolean {
  const t = title.trim();
  return new RegExp(`^${id.replace('-', '\\-')}(?=\\s|·|:|｜|$)`, 'i').test(t);
}

// ── 主流程 ────────────────────────────────────────────────────
const regs = await loadRegistries();
const cards = fetchCards();
const emit = process.argv.includes('--emit');

const map: Record<string, { card: number; src: string }> = {};
const orphans: Array<{ number: number; title: string }> = [];
const missing: string[] = [];
const titleMismatch: Array<{ id: string; card: number; title: string }> = [];

for (const r of regs) {
  const hit = cards.find((c) => cardMatchesId(c.title, r.id));
  if (hit) map[r.id] = { card: hit.number, src: r.src };
  else missing.push(r.id);
}

// 反向：板上的卡若标题形如 `<ID>-<数字>` 但不在登记件里 ⇒ 孤儿
const idSet = new Set(regs.map((r) => r.id));
for (const c of cards) {
  const m = /^([A-Z]{2}-\d{2}|[0-3]-\d{1,2}[ab]?)(?=\s|·|:|｜|$)/.exec(c.title.trim());
  // ⚠️ 只把【形如项号开头】且不在登记件的卡当孤儿 —— 标题不含项号的卡是**独立卡**
  //    （例 #989「2-1 W1 指标时序存储」标题是施工项描述、不含 id 前缀 ⇒ 不是孤儿）
  if (m && !idSet.has(m[1])) orphans.push(c);
}

// 已存 cardmap 的分叉检测（若 --emit 则重写）
let prev: Record<string, { card: number }> = {};
if (existsSync(MAP_PATH)) {
  try {
    prev = (JSON.parse(readFileSync(MAP_PATH, 'utf-8')) as { map?: Record<string, { card: number }> }).map ?? {};
  } catch {
    process.stderr.write('  🔴 cardmap.json 损坏（解析失败）⇒ exit 2\n');
    process.exit(2);
  }
}
const drifted = Object.entries(prev).filter(([id, v]) => map[id] && map[id].card !== v.card);

if (emit) {
  writeFileSync(
    MAP_PATH,
    JSON.stringify({ ref: 'generated-from-board', projectId: PROJECT_ID, total: Object.keys(map).length, map }, null, 2),
    'utf-8',
  );
  process.stdout.write(`  ✅ 已生成 cardmap.json（${Object.keys(map).length} 项 / 板 ${cards.length} 卡）\n`);
  process.exit(0);
}

// ── 校验报告 ──────────────────────────────────────────────────
const bySrc = { construction: 0, dsh: 0 } as Record<string, number>;
for (const v of Object.values(map)) bySrc[v.src] = (bySrc[v.src] ?? 0) + 1;

process.stdout.write(`  溯源冻结校验 ｜ 登记件 ${regs.length} 项（施工 ${regs.filter((r) => r.src === 'construction').length} + DSH ${regs.filter((r) => r.src === 'dsh').length}）｜ 板 ${cards.length} 卡\n`);
process.stdout.write(`  正向（登记件→卡）：已投放 ${Object.keys(map).length} ｜ 🔴 未投放 ${missing.length}${missing.length ? '：' + missing.join(',') : ''}\n`);
process.stdout.write(`  反向（卡→登记件）：孤儿卡 ${orphans.length}${orphans.length ? '：' + orphans.map((o) => `#${o.number}`).join(',') : ''}\n`);
process.stdout.write(`  与上次 cardmap 的分叉：${drifted.length}${drifted.length ? '：' + drifted.map(([id, v]) => `${id}(${v.card}→${map[id].card})`).join(',') : ''}\n`);

// 🔴 判据分级（2026-10-05 CTO 修）：
//   · missing / drifted  ⇒ **真分叉**（登记件与板对不上）⇒ exit 1
//   · orphans           ⇒ **警告**（板上存在"形如项号但登记件没有"的卡，
//                          多为历史遗留/拆项前旧卡）⇒ **不阻断**，但必须列出来供人工核
//     理由：误把"已知的历史卡"当违规 ⇒ 门禁会长期红 ⇒ 必被绕过（门禁膨胀的教训）
const hard = missing.length + drifted.length;
process.stdout.write(`\n  ══ ${hard === 0 ? '✅ 双向一致' : `🔴 ${hard} 处真分叉`}${orphans.length ? ` ｜ ⚠️ ${orphans.length} 处警告（独立卡，供人工核）` : ''} ══\n`);
process.exit(hard > 0 ? 1 : 0);
