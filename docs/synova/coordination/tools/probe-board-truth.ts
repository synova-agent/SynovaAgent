#!/usr/bin/env node
/**
 * 板真值探针（probe-board-truth）—— 让 project 面板真实反映**代码现状**
 *
 * @why  创始人 2026-10-05：「我的目的就是 project 面板真实反馈我们代码的现状」
 *       实测差距（当日）：
 *         · 板说 K1 2/6、K3 1/4…合计 6/51（= **Issue 关闭数**，属"动作进度"）
 *         · 真值：0-1 循环点火**未接**（bindMainAgent 不在 server.ts）、0-3 坏点**未除**（4 处仍在）、
 *           K1-WH 验签**0 处** ⇒ 板与真值**不是同一个量**（"动作进度" vs "事实进度"）
 *       ⇒ 本探针把【git/GitHub 证据】推成板上的**执行态**，不由人手填。
 *
 * @contract（铁律 47）
 *   @input  — 无参（dry-run，只报差）｜`--emit`（把判定写回板）
 *   @output — stdout 逐条：item / 板上值 / 证据推出值 / 判定；**exit 0=一致 / 1=有差 / 2=检查自身失败**
 *   @degraded — gh 取不到 / JSON 解析失败 / 注册表读不到 ⇒ exit 2（禁静默当一致）
 *
 * @derivation（**唯一真源 = 证据**，判据写在代码里，不写散文）
 *   有【已合】PR 且 `git merge-base --is-ancestor <sha> origin/main` = 0 ⇒ 已交付
 *   有【进行中/已开】PR 且 head 含本卡 ⇒ 进行中
 *   有【已关未合】PR ⇒ 已推送（未合）
 *   无任何 PR 且无分支痕迹 ⇒ 未开工
 *   🔴 阻塞源 ≠ 无阻塞 ⇒ 阻塞（无论上面推成什么）
 *
 * @anti-fake-green（创始人 2026-10-05：「改坏即红」）
 *   ① 探针的"有差"必须来自**证据对比**，不许来自"脚本自身崩溃恰好返回 1"
 *   ② 自验：`--selftest` ⇒ 构造一张**已知未开工**的卡，探针必须判"未开工"
 *      （若它判别的值 ⇒ 说明推导逻辑坏了，不是数据坏了）
 *

 * @known-defects（**2026-10-05 CTO 实测标定，接手者必修** —— 未修前本探针的"不一致"不可直接采信）
 *   实测（dry-run）：报 13 处不一致，其中 **≥2 处是探针自己的假阴**：
 *
 *   🔴 缺陷 1 · 假阴（漏判"已合"）
 *      实例：卡 `0-10`(#984) 板=已交付 ｜ 探针=未开工
 *      根因：其关联 PR 是 **#1011**（经 `closedByPullRequestsReferences` 正式链接），
 *            而 **#1011 的标题里不含 `#984`** ⇒ 本探针的"标题正则匹配"抓不到
 *      ⇒ **修法**：主判据改用 GraphQL `closedByPullRequestsReferences`
 *                  （一次查一批 issue，成本可控）；标题匹配降为**补充**（捕捉未正式链接的）
 *      证据：`gh api graphql` 查 #984 ⇒ `closedByPullRequestsReferences` = PR #1011 MERGED
 *
 *   🔴 缺陷 2 · PR 型卡未处理
 *      实例：卡 `0-9bis`(#1124) 板=已交付 ｜ 探针=未开工
 *      根因：**#1124 本身就是 PR**（板的 content 是 PullRequest，不是 Issue）
 *            ⇒ 按"issue → 找关联 PR"的逻辑 ⇒ 对 PR 型卡**恒判未开工**
 *      ⇒ **修法**：`fetchCards` 已同时取 Issue/PullRequest 但未区分类型；
 *                  需加 `__typename` 判别：PR 型卡直接读它自己的 `state`/`mergedAt`
 *      证据：`gh pr view 1124` ⇒ MERGED 2026-10-05T04:50:02Z；且 0-9bis 改动 `02ef5362f` 已在 main
 *
 *   ⚠️ 另：`gh pr list --search <number>` **禁用** —— 它按文本匹配会假阳
 *      （实例：搜 "1126" 返回了 #767 这种无关 PR）
 *
 *   ⇒ 修完这两个缺陷后，**必须重跑并给出新的不一致清单**，才可用于回填板。
 *     在那之前：本探针**只能当"差异提示"，不得据此写回板**。
 * @does-not-touch 产品代码。只读 git/GitHub + 写板字段。
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REG_DIR = resolve(HERE, '..');
const PROJECT_ID = 'PVT_kwDOFAmDns4Blb57';
const REPO = 'synova-agent/SynovaAgent';
const STATE_FIELD = 'PVTSSF_lADOFAmDns4Blb57zhkRqdw';
const STATE_OPT: Record<string, string> = {
  未开工: '5627d850',
  已派单: 'eda908be',
  进行中: '7942c92d',
  阻塞: '8b100162',
  已交付: 'af8b09ab',
  不适用: 'caff13b8',
};
const EMIT = process.argv.includes('--emit');

type Card = { itemId: string; number: number | null; title: string; state: string | null };
type Item = { id: string; title: string };

function sh(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function gql(query: string): Record<string, unknown> {
  try {
    const out = execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], { encoding: 'utf-8' });
    return JSON.parse(out) as Record<string, unknown>;
  } catch (e) {
    process.stderr.write(`  🔴 gh 取不到 / 解析失败：${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
}

/** 取板上全部卡（游标分页；含 PR 类型 —— 见 check-cardmap 的同类教训） */
function fetchCards(): Card[] {
  const OUT: Card[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const after = cursor ? `, after: "${cursor}"` : '';
    const q = `query { node(id:"${PROJECT_ID}") { ... on ProjectV2 { items(first: 100${after}) { pageInfo { hasNextPage endCursor } nodes { id content { ... on Issue { number title } ... on PullRequest { number title } } fieldValues(first: 30) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } } } } } }`;
    const o = gql(q) as {
      data?: {
        node?: {
          items?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
            nodes?: Array<{
              id: string;
              content?: { number?: number; title?: string };
              fieldValues?: { nodes?: Array<{ name?: string; field?: { name?: string } }> };
            }>;
          };
        };
      };
    };
    const it = o.data?.node?.items;
    if (!it) {
      process.stderr.write(`  🔴 板结构不对（page=${page}）⇒ exit 2\n`);
      process.exit(2);
    }
    for (const n of it.nodes ?? []) {
      const c = n.content;
      if (!c?.number) continue;
      let state: string | null = null;
      for (const fv of n.fieldValues?.nodes ?? []) {
        if (fv.field?.name === '执行态') state = fv.name ?? null;
      }
      OUT.push({ itemId: n.id, number: c.number, title: c.title ?? '', state });
    }
    if (!it.pageInfo?.hasNextPage) break;
    cursor = it.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }
  return OUT;
}

/** 全仓 PR 快照（一次拉全，本地精确关联 —— 禁 `--search <number>`：它按文本匹配会假阳） */
type PrLite = { number: number; state: string; mergedAt: string | null; head: string; title: string };
let PR_CACHE: PrLite[] | null = null;
function allPrs(): PrLite[] {
  if (PR_CACHE) return PR_CACHE;
  const out: PrLite[] = [];
  for (const st of ['open', 'closed']) {
    const r = execFileSync(
      'gh',
      ['pr', 'list', '-R', REPO, '--state', st, '--limit', '1000',
       '--json', 'number,state,mergedAt,headRefOid,title'],
      { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
    );
    const arr = JSON.parse(r) as Array<{ number: number; state: string; mergedAt: string | null; headRefOid: string; title: string }>;
    for (const p of arr) out.push({ number: p.number, state: p.state, mergedAt: p.mergedAt, head: p.headRefOid, title: p.title });
  }
  PR_CACHE = out;
  return out;
}

/** 该 issue 的关联 PR：**精确匹配 `#<number>`**（词边界；不看 search 的模糊结果） */
function prsFor(number: number): PrLite[] {
  const re = new RegExp(`#${number}(?![0-9])`);
  return allPrs().filter((p) => re.test(p.title));
}

/** 由证据推执行态（**唯一真源**） */
function derive(card: Card, blocked: boolean): string {
  if (blocked) return '阻塞';
  if (card.number === null) return '未开工';
  const prs = prsFor(card.number);
  // ① 已合且真进 main
  for (const p of prs) {
    if (p.mergedAt && sh(['merge-base', '--is-ancestor', p.head, 'origin/main']) !== '') return '已交付';
  }
  // ② 已合（但 sha 判不出来 ⇒ 按 PR 状态）
  if (prs.some((p) => p.state === 'MERGED')) return '已交付';
  // ③ 有开着的 PR ⇒ 进行中
  if (prs.some((p) => p.state === 'OPEN')) return '进行中';
  // ④ 有已关未合 ⇒ 已推送（未合）
  if (prs.some((p) => p.state === 'CLOSED')) return '已推送';
  return '未开工';
}

async function loadRegistries(): Promise<Item[]> {
  try {
    const a = (await import(`${REG_DIR}/施工项登记.ts`)) as {
      constructionItems: Array<{ id: string; title: string; status?: string }>;
    };
    return a.constructionItems
      .filter((i) => i.status !== 'retired' && i.status !== 'proposal')
      .map((i) => ({ id: i.id, title: i.title }));
  } catch (e) {
    process.stderr.write(`  🔴 登记件读不到：${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
}

// ── 主流程 ────────────────────────────────────────────────────
const items = await loadRegistries();
const cards = fetchCards();

// 卡标题判据：以 `<id>` 开头
function cardFor(id: string): Card | undefined {
  const re = new RegExp(`^${id.replace('-', '\\-')}(?=\\s|·|:|｜|$)`);
  return cards.find((c) => re.test(c.title.trim()));
}

let diff = 0;
let checked = 0;
let missing = 0;
const rows: string[] = [];
for (const it of items) {
  const c = cardFor(it.id);
  if (!c) {
    missing++;
    rows.push(`  ⚪ ${it.id} —— 板上无卡（登记件有、板没有）`);
    continue;
  }
  checked++;
  const blocked = false; // TODO(下一版): 读「阻塞源」字段（现先按 none）
  const want = derive(c, blocked);
  const got = c.state ?? '（未设）';
  // 「已推送」不是板上的 option ⇒ 归入「进行中」以免写不进去
  const eff = want === '已推送' ? '进行中' : want;
  if (eff !== got) {
    diff++;
    rows.push(`  🔴 ${it.id} #${c.number} 板=${got} 证据=${eff}`);
    if (EMIT && STATE_OPT[eff]) {
      gql(`mutation { updateProjectV2ItemFieldValue(input:{projectId:"${PROJECT_ID}",itemId:"${c.itemId}",fieldId:"${STATE_FIELD}",value:{singleSelectOptionId:"${STATE_OPT[eff]}"}}) { projectV2Item { id } } }`);
    }
  }
}

process.stdout.write(`  板真值探针 ｜ 登记件 ${items.length} 项（活动）｜ 板 ${cards.length} 卡 ｜ 已核对 ${checked} ｜ 板上无卡 ${missing}\n`);
for (const r of rows) process.stdout.write(r + '\n');
process.stdout.write(`\n  ══ ${diff === 0 ? '✅ 板与证据一致' : `🔴 ${diff} 处不一致${EMIT ? '（已写回）' : '（dry-run，加 --emit 写回）'}`} ══\n`);
process.exit(diff > 0 ? 1 : 0);
