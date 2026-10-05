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
 *             开关：`--selftest`（自验推导逻辑）｜`--no-fetch`（不 fetch origin/main）
 *                   `--no-title-supplement`（关掉标题匹配补充）｜`--json=<path>`（行级结果落盘）
 *   @output — stdout 逐条：item / 板上值 / 证据推出值 / **证据依据**；**exit 0=一致 / 1=有差 / 2=检查自身失败**
 *   @degraded — gh 取不到 / JSON 解析失败 / 注册表读不到 / 板结构不对 ⇒ exit 2（禁静默当一致）
 *
 * @derivation（**唯一真源 = 证据**，判据写在代码里，不写散文）
 *   ① 正式链接（主判据）：GraphQL `closedByPullRequestsReferences`
 *      有【已合】PR 且 merge commit `git merge-base --is-ancestor <sha> origin/main` = 0 ⇒ 已交付
 *      有【进行中/已开】PR ⇒ 进行中 ；有【已关未合】PR ⇒ 进行中（"已推送"不是板上 option）
 *   ② PR 型卡（板的 content 是 PullRequest）：直接读它**自己的** state/mergedAt（不走 issue→PR）
 *   ③ 标题匹配 `#<number>`：**降为补充**（捕捉未正式链接的），仅在 ① 无结论时启用，且行内标注依据
 *   ④ 无任何 PR 且无分支痕迹 ⇒ 未开工
 *   🔴 阻塞：读板上「阻塞源」字段，≠「无阻塞」⇒ 阻塞（无论上面推成什么）
 *   🔴 「Issue 已关」**不参与**任何推导 —— 本轮全部意义就在纠正"关了=做完"
 *
 * @anti-fake-green（创始人 2026-10-05：「改坏即红」）
 *   ① 探针的"有差"必须来自**证据对比**，不许来自"脚本自身崩溃恰好返回 1"
 *   ② 自验：`--selftest` ⇒ 六条已知输入必须推出已知值（含"已知未开工的卡必须判未开工"）；
 *      任一不中 ⇒ exit 2（说明推导逻辑坏了，不是数据坏了）
 *
 * @known-defects（2026-10-05 CTO 实测标定 2 条 ｜ 2026-10-05 D1144 复核追加 3 条）
 *
 *   ✅ 缺陷 1 · 假阴（漏判"已合"）—— **已修（主判据改 GraphQL 正式链接）**
 *      实例：卡 `0-10`(#984) 板=已交付 ｜ 探针=未开工
 *      根因：其关联 PR 是 **#1011**（经 `closedByPullRequestsReferences` 正式链接），
 *            而 **#1011 的标题里不含 `#984`** ⇒ 旧版"标题正则匹配"抓不到
 *      修法：主判据改用 GraphQL `closedByPullRequestsReferences`（按 30 个 issue 一批，成本可控）；
 *            标题匹配降为**补充**（`--no-title-supplement` 可关）
 *      证据（2026-10-05 复核）：查 #984 ⇒ closedByPullRequestsReferences = PR #1011 MERGED，
 *            mergeCommit.oid=`8bf7414aeb80663313f531bf86b496543bbd75dc`，
 *            `git merge-base --is-ancestor 8bf7414a… origin/main` ⇒ 0（在 main）
 *
 *   ✅ 缺陷 2 · PR 型卡未处理 —— **已修（__typename 判别）**
 *      实例：卡 `0-9bis`(#1124) 板=已交付 ｜ 探针=未开工
 *      根因：**#1124 本身就是 PR**（板的 content 是 PullRequest，不是 Issue）
 *            ⇒ 按"issue → 找关联 PR"的逻辑 ⇒ 对 PR 型卡**恒判未开工**
 *      修法：`fetchCards` 取 `__typename` + PR 自带 `state/mergedAt/headRefOid/mergeCommit`；
 *            PR 型卡直接读**它自己**的状态
 *      证据（2026-10-05）：`gh pr view 1124` ⇒ MERGED 2026-10-05T04:50:02Z（板上 #1123/#1124 两张 PR 型卡）
 *
 *   ⚠️ 附则（照办）：`gh pr list --search <number>` **禁用** —— 它按文本匹配会假阳
 *      （实例：搜 "1126" 返回了 #767 这种无关 PR）。本探针全程只用
 *      ① `closedByPullRequestsReferences`（正式链接）② 本地标题正则（`#N` 词边界），不用 --search。
 *
 *   ✅ 缺陷 3 · `--selftest` 承诺未实现（**D1144 复核发现**）—— **已修**
 *      证据：文件头 @anti-fake-green ② 承诺 `--selftest`，旧版代码 grep `selftest` 零命中
 *      ⇒ "改坏即红"当时无物可依。现实现 6 条已知输入自验，任一不中 exit 2。
 *
 *   ✅ 缺陷 4 · 「阻塞」判据未实现（**D1144 复核发现**）—— **已修**
 *      证据：@derivation 承诺「阻塞源 ≠ 无阻塞 ⇒ 阻塞」，旧版代码是
 *            `const blocked = false; // TODO(下一版): 读「阻塞源」字段` ⇒ 恒不判阻塞
 *      实测影响：PL-04(#1110) 板上「阻塞源=等契约落地」而「执行态=未开工」⇒ 旧版永报"一致"
 *
 *   ✅ 缺陷 5 · 祖先判定过弱（**D1144 复核发现**）—— **已修**
 *      根因 a：旧 `sh()` 用 `execFileSync`，`merge-base --is-ancestor` 的非零退出与
 *              "git 自身报错"**都**返回空串 ⇒ 无法区分「不是祖先」和「判不了」
 *      根因 b：旧版拿 `headRefOid` 判祖先 —— **squash 合并后原 head 不在 main**，恒假
 *      修法：优先 `mergeCommit.oid`；三态 `yes/no/unknown`；unknown **不当作"否"**（仍按 PR 状态判）
 *
 *   ⚠️ 另加：origin/main **新鲜度校验**（as_of 纪律）—— 启动先 `git fetch origin main`，
 *      打印 `origin/main@<sha> (<committer date>)`；fetch 失败只警告不静默（继续用本地 ref）。
 *
 *   🔬 缺陷 1/2 修完后的复跑结论见 `docs/synova/coordination/判据等级定级清单-20261005.md`
 *      （CTO 2026-10-05 旧数 13 处**不得沿用** —— 那是未修缺陷时的不一致数）。
 *
 * @cto-rulings（2026-10-05 CTO 两条裁决 —— **本版已落地**）
 *   裁决 A · **双判据**：
 *     ① `closedByPullRequestsReferences`（正式链接）—— **主判**
 *     ② PR **标题/正文** `#N`（词边界）—— **弱判据**，会假阳（正文顺带提及也命中），
 *        命中一律在 basis 标「弱判据」，且**仅在 ① 无结论时**启用
 *     ⇒ **不许只用②，也不许只用①**。实例：#1051 的载体 PR 正文写 `Refs #1051`（非 Closes）
 *       ⇒ GitHub 不建正式链接 ⇒ 只有②抓得到。
 *   裁决 B · **两字段共存**：「执行态」= **证据面**（本探针自动写）；
 *     「已派单」等人工过程信号移入**独立字段「人工过程态」**（人填）。
 *     ⇒ 探针**不做** `--preserve-dispatch`（一个 flag 会掩盖语义）；两字段互不覆盖。
 *
 * @does-not-touch 产品代码。只读 git/GitHub + 写板字段（执行态）。
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
const BLOCK_FIELD = '阻塞源';
const BLOCK_NONE = '无阻塞';
/** gh pr list 单次上限；命中上限 ⇒ 快照可能被截断（必须报，禁静默） */
const PR_LIMIT = 1000;
/** 正式链接一次查多少个 issue（GraphQL 别名批量） */
const LINK_BATCH = 30;

const argv = process.argv.slice(2);
const EMIT = argv.includes('--emit');
const SELFTEST = argv.includes('--selftest');
const NO_FETCH = argv.includes('--no-fetch');
const NO_TITLE_SUPPLEMENT = argv.includes('--no-title-supplement');
/** 🔴 弱判据是否允许**写板**（默认否 —— 写板即断言，而弱判据会假阳，实测见下） */
const WEAK_EMIT = argv.includes('--emit-weak');
const JSON_OUT = ((): string | null => {
  const a = argv.find((x) => x.startsWith('--json='));
  return a ? a.slice('--json='.length) : null;
})();

function die(msg: string): never {
  process.stderr.write(`  🔴 ${msg}\n`);
  process.exit(2);
}

function run(cmd: string, args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function gql(query: string): Record<string, any> {
  const r = run('gh', ['api', 'graphql', '-f', `query=${query}`]);
  if (r.status !== 0) die(`gh 取不到 / 解析失败：${r.err || r.out}`);
  let o: Record<string, any>;
  try {
    o = JSON.parse(r.out) as Record<string, any>;
  } catch (e) {
    die(`GraphQL 响应解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (Array.isArray(o.errors) && o.errors.length > 0 && !o.data) {
    die(`GraphQL 报错：${JSON.stringify(o.errors).slice(0, 300)}`);
  }
  return o;
}

type CardKind = 'Issue' | 'PullRequest' | 'Other';
type Card = {
  itemId: string;
  kind: CardKind;
  number: number | null;
  title: string;
  /** 板上「执行态」当前值 */
  state: string | null;
  /** content 自身的状态：Issue=OPEN/CLOSED ｜ PR=OPEN/CLOSED/MERGED */
  contentState: string | null;
  mergedAt: string | null;
  headRefOid: string | null;
  mergeOid: string | null;
  /** 板上「阻塞源」 */
  blockSource: string | null;
};

/** 取板上全部卡（游标分页；含 PR 类型 + __typename 判别 —— 缺陷 2） */
function fetchCards(): Card[] {
  const OUT: Card[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const after = cursor ? `, after: "${cursor}"` : '';
    const q = `query { node(id:"${PROJECT_ID}") { ... on ProjectV2 { items(first: 100${after}) { pageInfo { hasNextPage endCursor } nodes { id content { __typename ... on Issue { number title state } ... on PullRequest { number title state mergedAt headRefOid mergeCommit { oid } } } fieldValues(first: 40) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } } } } } }`;
    const o = gql(q);
    const it = o.data?.node?.items;
    if (!it) die(`板结构不对（page=${page}）`);
    for (const n of it.nodes ?? []) {
      const c = n.content;
      if (!c?.number) continue;
      const f: Record<string, string | null> = {};
      for (const fv of n.fieldValues?.nodes ?? []) {
        const nm = fv?.field?.name;
        if (nm) f[nm] = fv.name ?? null;
      }
      const tn: string = c.__typename ?? 'Other';
      OUT.push({
        itemId: n.id,
        kind: tn === 'Issue' || tn === 'PullRequest' ? tn : 'Other',
        number: c.number,
        title: c.title ?? '',
        state: f['执行态'] ?? null,
        contentState: c.state ?? null,
        mergedAt: c.mergedAt ?? null,
        headRefOid: c.headRefOid ?? null,
        mergeOid: c.mergeCommit?.oid ?? null,
        blockSource: f[BLOCK_FIELD] ?? null,
      });
    }
    if (!it.pageInfo?.hasNextPage) break;
    cursor = it.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }
  return OUT;
}

// ── 正式链接（主判据，缺陷 1）────────────────────────────────────
type PrRef = {
  number: number;
  state: string;
  mergedAt: string | null;
  headRefOid: string | null;
  mergeOid: string | null;
};

function fetchLinkedPrs(numbers: number[]): Map<number, PrRef[]> {
  const out = new Map<number, PrRef[]>();
  for (let i = 0; i < numbers.length; i += LINK_BATCH) {
    const chunk = numbers.slice(i, i + LINK_BATCH);
    const parts = chunk
      .map(
        (n, k) =>
          `i${k}: issue(number:${n}) { number closedByPullRequestsReferences(first: 20) { nodes { number state mergedAt headRefOid mergeCommit { oid } } } }`,
      )
      .join(' ');
    const o = gql(`query { repository(owner:"synova-agent", name:"SynovaAgent") { ${parts} } }`);
    const repo = o.data?.repository;
    if (!repo) die('repository 取不到（正式链接查询）');
    chunk.forEach((n, k) => {
      const node = repo[`i${k}`];
      if (!node) {
        out.set(n, []);
        return;
      }
      const nodes = node.closedByPullRequestsReferences?.nodes ?? [];
      out.set(
        n,
        nodes
          .filter((p: Record<string, any>) => p && typeof p.number === 'number')
          .map((p: Record<string, any>) => ({
            number: p.number,
            state: p.state ?? 'UNKNOWN',
            mergedAt: p.mergedAt ?? null,
            headRefOid: p.headRefOid ?? null,
            mergeOid: p.mergeCommit?.oid ?? null,
          })),
      );
    });
  }
  return out;
}

// ── 标题匹配（**补充**，非主判据）────────────────────────────────
type PrLite = { number: number; state: string; mergedAt: string | null; head: string; mergeOid: string | null; title: string; body: string };
let PR_CACHE: PrLite[] | null = null;

function allPrs(): PrLite[] {
  if (PR_CACHE) return PR_CACHE;
  const out: PrLite[] = [];
  const truncated: string[] = [];
  for (const st of ['open', 'closed']) {
    const r = run('gh', [
      'pr', 'list', '-R', REPO, '--state', st, '--limit', String(PR_LIMIT),
      '--json', 'number,state,mergedAt,headRefOid,mergeCommit,title,body',
    ]);
    if (r.status !== 0) die(`PR 快照取不到（state=${st}）：${r.err || r.out}`);
    let arr: Array<Record<string, any>>;
    try {
      arr = JSON.parse(r.out) as Array<Record<string, any>>;
    } catch (e) {
      die(`PR 快照解析失败（state=${st}）：${e instanceof Error ? e.message : String(e)}`);
    }
    if (arr.length >= PR_LIMIT) truncated.push(st);
    for (const p of arr) {
      out.push({
        number: p.number,
        state: p.state,
        mergedAt: p.mergedAt ?? null,
        head: p.headRefOid,
        mergeOid: p.mergeCommit?.oid ?? null,
        title: p.title ?? '',
        body: p.body ?? '',
      });
    }
  }
  if (truncated.length > 0) {
    process.stderr.write(
      `  ⚠️ PR 快照命中上限 ${PR_LIMIT}（state=${truncated.join(',')}）⇒ 标题补充可能不完备（主判据不受影响）\n`,
    );
  }
  PR_CACHE = out;
  return out;
}

/**
 * 🔴 **弱判据**（CTO 2026-10-05 裁：双判据，本函数只作**补充**，**不单独用**）
 * 匹配 `#<number>`（词边界）出现在 PR **标题或正文** —— 覆盖 `Refs #N` 这类
 * **不产生正式链接**的载体（实例：#1051 的 PR 正文写 `Refs #1051`，#948/#1011 式正式链接为空）。
 * ⚠️ 会**假阳**：正文里顺带提到的卡号也会命中 ⇒ 命中一律在 basis 里标「弱判据」，
 *    且仅在主判据（closedByPullRequestsReferences）无结论时才启用。
 */
function weakMatchedPrs(number: number): PrLite[] {
  if (NO_TITLE_SUPPLEMENT) return [];
  const re = new RegExp(`#${number}(?![0-9])`);
  return allPrs().filter((p) => re.test(p.title) || re.test(p.body));
}

// ── 祖先判定（三态；缺陷 5）──────────────────────────────────────
type Anc = 'yes' | 'no' | 'unknown';

function isAncestor(sha: string | null | undefined): Anc {
  if (!sha) return 'unknown';
  if (run('git', ['cat-file', '-e', `${sha}^{commit}`]).status !== 0) return 'unknown';
  const r = run('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
  if (r.status === 0) return 'yes';
  if (r.status === 1) return 'no';
  return 'unknown';
}

// ── 由证据推执行态（**唯一真源**）────────────────────────────────
type Verdict = { state: string; basis: string };

function derive(card: Card, linked: PrRef[]): Verdict {
  // 🔴 阻塞优先（缺陷 4）：判据在函数内，**不由调用方传**（防"调用方传 false 就永不判阻塞"）
  if (card.blockSource && card.blockSource !== BLOCK_NONE) {
    return { state: '阻塞', basis: `阻塞源=${card.blockSource}` };
  }

  // ② PR 型卡：读它自己（缺陷 2）
  if (card.kind === 'PullRequest') {
    if (card.contentState === 'MERGED') {
      const anc = isAncestor(card.mergeOid ?? card.headRefOid);
      if (anc === 'yes') return { state: '已交付', basis: 'PR 型卡自身 MERGED + merge commit 在 origin/main' };
      if (anc === 'no') return { state: '已交付', basis: '⚠️ PR 型卡自身 MERGED 但 merge commit 不在 origin/main' };
      return { state: '已交付', basis: 'PR 型卡自身 MERGED（sha 不可判）' };
    }
    if (card.contentState === 'OPEN') return { state: '进行中', basis: 'PR 型卡自身 OPEN' };
    if (card.contentState === 'CLOSED') return { state: '进行中', basis: 'PR 型卡自身 CLOSED 未合' };
    return { state: '未开工', basis: `PR 型卡状态未知（${card.contentState ?? 'null'}）` };
  }

  if (card.number === null) return { state: '未开工', basis: '卡无 number' };

  // ① 正式链接（主判据，缺陷 1）
  const merged = linked.filter((p) => p.state === 'MERGED');
  for (const p of merged) {
    if (isAncestor(p.mergeOid ?? p.headRefOid) === 'yes') {
      return { state: '已交付', basis: `正式链接 PR #${p.number} MERGED + 在 origin/main` };
    }
  }
  if (merged.length > 0) {
    return {
      state: '已交付',
      basis: `正式链接 PR #${merged.map((p) => p.number).join(',')} MERGED（sha 不可判 / 未入 main）`,
    };
  }
  const open = linked.filter((p) => p.state === 'OPEN');
  if (open.length > 0) return { state: '进行中', basis: `正式链接 PR #${open.map((p) => p.number).join(',')} OPEN` };
  const closed = linked.filter((p) => p.state === 'CLOSED');
  if (closed.length > 0) {
    return { state: '进行中', basis: `正式链接 PR #${closed.map((p) => p.number).join(',')} CLOSED 未合` };
  }

  // ③ 弱判据补充（标题 + 正文 `#N`；仅在 ① 正式链接无结论时启用）
  const sup = weakMatchedPrs(card.number);
  const supMerged = sup.filter((p) => p.state === 'MERGED');
  for (const p of supMerged) {
    if (isAncestor(p.mergeOid ?? p.head) === 'yes') {
      return { state: '已交付', basis: `（**弱判据**：PR 标题/正文含 #${card.number}）PR #${p.number} MERGED + 在 origin/main` };
    }
  }
  const supOpen = sup.filter((p) => p.state === 'OPEN');
  if (supOpen.length > 0) {
    return { state: '进行中', basis: `（**弱判据**：PR 标题/正文含 #${card.number}）PR #${supOpen.map((p) => p.number).join(',')} OPEN` };
  }
  if (supMerged.length > 0) {
    return {
      state: '已交付',
      basis: `（**弱判据**：PR 标题/正文含 #${card.number}）PR #${supMerged.map((p) => p.number).join(',')} MERGED（sha 不可判）`,
    };
  }
  return { state: '未开工', basis: '无任何关联 PR（正式链接 0 / 标题补充 0）' };
}

// ── 登记件 ────────────────────────────────────────────────────────
type RegItem = { id: string; title: string; src: 'construction' | 'dsh' };

async function loadRegistries(): Promise<RegItem[]> {
  let a: { constructionItems: Array<{ id: string; title: string; status?: string }> };
  let b: { dshItems: Array<{ id: string; name: string }> };
  try {
    a = (await import(`${REG_DIR}/施工项登记.ts`)) as typeof a;
    b = (await import(`${REG_DIR}/DSH借鉴项登记.ts`)) as typeof b;
  } catch (e) {
    die(`登记件读不到：${e instanceof Error ? e.message : String(e)}`);
  }
  const out: RegItem[] = a.constructionItems
    .filter((i) => i.status !== 'retired' && i.status !== 'proposal')
    .map((i) => ({ id: i.id, title: i.title, src: 'construction' as const }));
  for (const i of b.dshItems) out.push({ id: i.id, title: i.name, src: 'dsh' as const });
  return out;
}

/** 卡标题判据：以 `<id>` 开头（后接空格/·/:/｜/结尾） */
function makeCardFinder(cards: Card[]): (id: string) => Card | undefined {
  return (id: string) => {
    const re = new RegExp(`^${id.replace('-', '\\-')}(?=\\s|·|:|｜|$)`, 'i');
    return cards.find((c) => re.test(c.title.trim()));
  };
}

// ── 自验（缺陷 3）────────────────────────────────────────────────
function selftest(): void {
  const base: Card = {
    itemId: 'SELFTEST', kind: 'Issue', number: 999999, title: 'SELFTEST',
    state: null, contentState: 'OPEN', mergedAt: null, headRefOid: null, mergeOid: null, blockSource: BLOCK_NONE,
  };
  const mainSha = run('git', ['rev-parse', 'origin/main']).out;
  if (!/^[0-9a-f]{40}$/.test(mainSha)) die('selftest 前置失败：取不到 origin/main sha');
  const cases: Array<{ name: string; got: Verdict; want: string }> = [];
  cases.push({ name: '已知未开工 ⇒ 未开工', got: derive(base, []), want: '未开工' });
  cases.push({
    name: '正式链接 MERGED 且 sha 在 main ⇒ 已交付',
    got: derive(base, [{ number: 1, state: 'MERGED', mergedAt: 'x', headRefOid: mainSha, mergeOid: mainSha }]),
    want: '已交付',
  });
  cases.push({
    name: '正式链接 OPEN ⇒ 进行中',
    got: derive(base, [{ number: 2, state: 'OPEN', mergedAt: null, headRefOid: null, mergeOid: null }]),
    want: '进行中',
  });
  cases.push({
    name: '阻塞源≠无阻塞 ⇒ 阻塞（压过证据）',
    got: derive({ ...base, blockSource: '等K3' }, [{ number: 3, state: 'MERGED', mergedAt: 'x', headRefOid: mainSha, mergeOid: mainSha }]),
    want: '阻塞',
  });
  cases.push({
    name: 'PR 型卡自身 MERGED + 在 main ⇒ 已交付',
    got: derive({ ...base, kind: 'PullRequest', contentState: 'MERGED', mergedAt: 'x', mergeOid: mainSha }, []),
    want: '已交付',
  });
  cases.push({
    name: 'PR 型卡自身 OPEN ⇒ 进行中',
    got: derive({ ...base, kind: 'PullRequest', contentState: 'OPEN' }, []),
    want: '进行中',
  });

  let bad = 0;
  process.stdout.write('  自验（--selftest）\n');
  for (const c of cases) {
    const ok = c.got.state === c.want;
    if (!ok) bad++;
    process.stdout.write(`    ${ok ? '✅' : '🔴'} ${c.name} ⇒ ${c.got.state}（期望 ${c.want}）｜${c.got.basis}\n`);
  }
  if (bad > 0) die(`自验不通过 ${bad}/${cases.length} ⇒ 推导逻辑坏了（不是数据坏了）`);
  process.stdout.write(`  ✅ 自验全过（${cases.length}/${cases.length}）\n`);
  process.exit(0);
}

// ── 主流程 ────────────────────────────────────────────────────────
if (SELFTEST) selftest();

if (!NO_FETCH) {
  const f = run('git', ['fetch', 'origin', 'main', '--quiet']);
  if (f.status !== 0) process.stderr.write(`  ⚠️ git fetch origin main 失败（用本地 ref，可能过期）：${f.err.slice(0, 200)}\n`);
}
const mainSha = run('git', ['rev-parse', '--short', 'origin/main']).out;
const mainDate = run('git', ['log', '-1', '--format=%cI', 'origin/main']).out;
if (!mainSha) die('取不到 origin/main（探针的祖先判据无依据）');
process.stdout.write(`  依据：origin/main@${mainSha}（${mainDate}）｜ 取数时刻 ${new Date().toISOString()}\n`);

const items = await loadRegistries();
const cards = fetchCards();
const findCard = makeCardFinder(cards);

const issueNumbers = items
  .map((it) => findCard(it.id))
  .filter((c): c is Card => !!c && c.kind === 'Issue' && typeof c.number === 'number')
  .map((c) => c.number as number);
const linkedMap = fetchLinkedPrs(issueNumbers);

let diff = 0;
let weakDiff = 0;
let checked = 0;
let missing = 0;
let unchanged = 0;
const rows: string[] = [];
type OutRow = {
  id: string; src: string; card: number | null; kind: CardKind;
  board: string | null; evidence: string; basis: string; same: boolean; blocked: boolean;
};
const outRows: OutRow[] = [];


for (const it of items) {
  const c = findCard(it.id);
  if (!c) {
    missing++;
    rows.push(`  ⚪ ${it.id} —— 板上无卡（登记件有、板没有）`);
    outRows.push({ id: it.id, src: it.src, card: null, kind: 'Other', board: null, evidence: '（无卡）', basis: '板上无卡', same: false, blocked: false });
    continue;
  }
  checked++;
  const v = derive(c, c.number !== null ? linkedMap.get(c.number) ?? [] : []);
  const got = c.state ?? '（未设）';
  const same = v.state === got;
  const isWeak = v.basis.indexOf('弱判据') >= 0;
  if (same) unchanged++;
  else {
    diff++;
    if (isWeak) weakDiff++;
    rows.push(
      isWeak
        ? `  ⚠️ ${it.id} #${c.number} 板=${got} 弱判据推=${v.state}（**默认不写板**，须 --emit-weak）｜ ${v.basis}`
        : `  🔴 ${it.id} #${c.number} 板=${got} 证据=${v.state} ｜ ${v.basis}`,
    );
    if (EMIT && STATE_OPT[v.state] && (!isWeak || WEAK_EMIT)) {
      gql(
        `mutation { updateProjectV2ItemFieldValue(input:{projectId:"${PROJECT_ID}",itemId:"${c.itemId}",fieldId:"${STATE_FIELD}",value:{singleSelectOptionId:"${STATE_OPT[v.state]}"}}) { projectV2Item { id } } }`,
      );
    }
  }
  outRows.push({
    id: it.id, src: it.src, card: c.number, kind: c.kind, board: c.state, evidence: v.state, basis: v.basis, same,
    blocked: !!c.blockSource && c.blockSource !== BLOCK_NONE,
  });
}

process.stdout.write(
  `  板真值探针 ｜ 登记件 ${items.length} 项（施工活动 + DSH）｜ 板 ${cards.length} 卡 ｜ 已核对 ${checked} ｜ 板上无卡 ${missing}\n`,
);
for (const r of rows) process.stdout.write(r + '\n');
const strongDiff = diff - weakDiff;
process.stdout.write(
  `\n  ══ ${diff === 0 ? '✅ 板与证据一致' : `🔴 ${strongDiff} 处主判据不一致${EMIT ? '（已写回）' : '（dry-run，加 --emit 写回）'} ｜ ⚠️ ${weakDiff} 处弱判据差异（默认只报不写，加 --emit-weak 才写）`} ｜ 一致 ${unchanged}/${checked} ══\n`,
);

if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      { asOf: new Date().toISOString(), originMain: mainSha, originMainDate: mainDate, total: items.length, checked, missing, diff, rows: outRows },
      null,
      1,
    ),
    'utf-8',
  );
  process.stdout.write(`  行级结果已落盘：${JSON_OUT}\n`);
}

process.exit(diff > 0 ? 1 : 0);
