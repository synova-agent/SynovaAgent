#!/usr/bin/env node
/**
 * 判据等级定级清单生成 + 回填器（emit-criterion-levels）
 *
 * @why  CTO 2026-10-05 派单 §4 交付：「一份清单（git 跟踪）：项 / 卡号 / 判据等级 / 证据命令 /
 *       原始输出摘要 / 备注 / 取数时刻」＋「板上『判据等级』已填」。
 *       ⇒ 本件把 grade-criteria（机械取证）+ probe-board-truth（执行态证据）+ adjudication（人工裁定）
 *          **合成一张表**，并可选写回板字段。人只裁定"机械判不了的"，其余全自动。
 *
 * @contract（铁律 47）
 *   @input  — --grading=<json> --probe=<json> --board=<json> --adjudication=<json>
 *             --md=<path> --out=<json> ｜ --emit（写板「判据等级」）
 *   @output — md 清单 + json 定级 + （--emit 时）板上「判据等级」逐卡写入
 *   @degraded — 输入缺 / gh 失败 ⇒ exit 2（禁静默）
 *
 * @rules（**不自创**；缺证据 = L1 + 未验，照 CTO 明令）
 *   ① status retired/proposal ⇒ 不适用
 *   ② 写集全 docs/ ⇒ 不适用（治理/文档类）
 *   ③ L4-正确  ⇐ 基线绿 + 回退修复必红（两段原始输出）
 *   ④ L3-真跑  ⇐ 该卡完成标准那条命令跑过且过（原始输出 + 取数时刻），**且判据可归属本项**
 *                （判据落本项写集内 或 由本卡载体 commit 新建/修改 —— 判据纪律 A）
 *   ⑤ 其余 ⇒ L1-静态可达 + 备注「未验」+ 写明缺什么
 *   🔴 「命令过但判据不可归属本项」⇒ **不许填 L3**（假绿）—— 退回 L1 + 备注
 *
 * @does-not-touch 产品代码。只读输入 + 写板字段（判据等级）。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const a = argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : d;
};
const EMIT = argv.includes('--emit');
const PROJECT_ID = 'PVT_kwDOFAmDns4Blb57';
const CRITERION_FIELD = 'PVTSSF_lADOFAmDns4Blb57zhkf-Hs';
const LEVEL_OPT: Record<string, string> = {
  'L1-静态可达': 'a6fef180',
  'L2-接线': 'dd1f2713',
  'L3-真跑': 'e562686c',
  'L4-正确': '4826e5cf',
  '不适用': 'e0462d6f',
};

function die(msg: string): never {
  process.stderr.write('  🔴 ' + msg + '\n');
  process.exit(2);
}
function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (e) {
    die('读不到/解析失败 ' + p + '：' + (e instanceof Error ? e.message : String(e)));
  }
}
function gql(query: string): any {
  const r = spawnSync('gh', ['api', 'graphql', '-f', 'query=' + query], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if ((r.status ?? -1) !== 0) die('gh 失败：' + (r.stderr || r.stdout || '').slice(0, 200));
  let o: any;
  try {
    o = JSON.parse(r.stdout);
  } catch (e) {
    die('GraphQL 解析失败：' + (e instanceof Error ? e.message : String(e)));
  }
  if (Array.isArray(o.errors) && o.errors.length && !o.data) die('GraphQL 报错：' + JSON.stringify(o.errors).slice(0, 200));
  return o;
}

const grading = readJson(arg('grading', ''));
const probe = readJson(arg('probe', ''));
const board = readJson(arg('board', ''));
const adj = readJson(arg('adjudication', ''));
const MD_OUT = arg('md', '');
const JSON_OUT = arg('out', '');
const asOf = adj.asOf ?? new Date().toISOString();

const NL = String.fromCharCode(10);
const SECTIONS: Array<{ title: string; lines: string[] }> = [{"title":"五、复跑环境（L2/L3/L4 证据的可复跑前置）","lines":["本表每一条 L3/L4 都附「可复跑命令 + 原始输出（含 exit code）」；公共前置只有三步：","","    git -C /Users/wane/SynovaAgent worktree add /tmp/mc origin/main --detach","    ln -s /Users/wane/SynovaAgent/node_modules /tmp/mc/node_modules","    NODE=/Users/wane/.nvm/versions/node/v24.19.0/bin/node ; VITEST=/Users/wane/SynovaAgent/node_modules/.bin/vitest","","之后每条证据命令 = 在 /tmp/mc 下执行 $NODE $VITEST run <该行文件>。","用独立 worktree 的两个理由：① 主仓工作树停在 docs/D1115-b1-br5-closeout（不是 main）⇒ 直接在工作树跑，量到的是别的树；② 该族判据会改仓内文件（3-12 行备注有单跑归因实测）。"]},{"title":"六、引用与取数（哪份文件 + 哪棵树）","lines":["| 引用物 | 具体文件 | 树 / 位置 |","|---|---|---|","| 派单原件 | 《派单 · 板真值标定与回填》2026-10-05（含补 1/2/3） | 会话输入，未入 git |","| 方向锚 | ~/Synova-过程档案/2026-10-03-cto-记录-关键时刻-基座治理结论.md（§十四 活账 + 判据纪律四条） | 档案仓 ~/Synova-过程档案（独立 git 仓，非主仓工作树） |","| 施工项登记件 | docs/synova/coordination/施工项登记.ts（实测 48 项：46 活动 + 1 retired + 1 proposal） | 主仓分支 docs/D1122-cto-deliverables-contract@5f8380d9a —— 不在 main（git cat-file -e origin/main:<path> 实测失败） |","| 借鉴项登记件 | docs/synova/coordination/DSH借鉴项登记.ts（实测 24 项） | 同上（同一分支） |","| 写集可达性（L1） | 各 item 的 paths | 主仓 origin/main（committer date 见文首） |","| 板字段 | GitHub Project #1（PVT_kwDOFAmDns4Blb57） | 非 git（GitHub 侧） |","| 载体 PR 证据 | #1011 / #1012 / #998 / #1007 / #1009 / #1138 | GitHub；merge commit 的祖先性以 origin/main 判 |","","🔴 未引用 ~/山河研究院/** 任何文件（补 2：本件无上游权威件引用；若后续需引，必写清「哪份文件 + 哪棵树」）。","🔴 未引用任何 DSH 包/行为（补 1：本单不涉 DSH）。本件出现的 DSH借鉴项登记.ts 是主仓内的登记件文件名（CTO 派单 §2 指明「49 项 + 24 DSH 项」），不是 DSH 源码引用。"]}];
function renderSections(ss: Array<{ title: string; lines: string[] }>): string {
  return (ss ?? []).map((s) => NL + "## " + s.title + NL + NL + s.lines.join(NL) + NL).join("");
}


const cardByNumber = new Map<number, any>();
for (const c of board.cards) if (c.number) cardByNumber.set(c.number, c);
const probeById = new Map<string, any>();
for (const r of probe.rows) probeById.set(r.id, r);
const adjById = new Map<string, any>();
for (const r of adj.runs) adjById.set(r.id, r);
const naById = new Map<string, any>();
for (const r of adj.notApplicable) naById.set(r.id, r);

type Row = {
  id: string; src: string; block: string; status: string; title: string; card: number | null;
  level: string; evidenceCmd: string; output: string; note: string; asOf: string;
  execBoard: string | null; execEvidence: string | null;
};

const rows: Row[] = [];
const tally: Record<string, number> = {};

// 板的卡号：优先取探针行；探针**已排除** retired/proposal ⇒ 回退用板标题前缀匹配
// （不用正则，避免转义地狱：逐字符判分隔符）
function findCardId(id: string): number | null {
  for (const c of board.cards) {
    const t = String(c.title ?? '').trim();
    if (!t.startsWith(id)) continue;
    const next = t.charAt(id.length);
    if (next === '' || next === ' ' || next === '·' || next === ':' || next === '｜') return c.number;
  }
  return null;
}

for (const g of grading.rows) {
  const p = probeById.get(g.id);
  const card = p && p.card ? p.card : findCardId(g.id);
  const a = adjById.get(g.id);
  const na = naById.get(g.id);

  let level = 'L1-静态可达';
  let evidenceCmd = g.acceptance.length ? g.acceptance[0].run : '（无 acceptance 步）';
  let output = '';
  let note = '';

  const wsOk = g.writeSet.filter((w: any) => w.ok).length;
  const wsAll = g.writeSet.length > 0 && wsOk === g.writeSet.length;

  if (na) {
    level = '不适用';
    evidenceCmd = '（无代码判据）';
    output = '不适用';
    note = na.reason;
  } else if (a) {
    level = a.level;
    evidenceCmd = a.commands.join('  ｜  ');
    output = a.outputs.join('  ｜  ');
    note = a.note;
  } else {
    output = g.writeSet.length === 0
      ? '写集为空（登记件无 paths）⇒ L1 无对象'
      : '写集 ' + wsOk + '/' + g.writeSet.length + ' 在 ' + grading.ref + ' 存在' + (wsAll ? '' : '（缺：' + g.writeSet.filter((w: any) => !w.ok).map((w: any) => w.path).join(', ') + '）');
    note = g.note;
  }

  tally[level] = (tally[level] ?? 0) + 1;
  rows.push({
    id: g.id, src: g.src, block: g.block, status: g.status, title: g.title, card,
    level, evidenceCmd, output, note, asOf: a ? adj.asOf : grading.asOf,
    execBoard: p ? p.board : null, execEvidence: p ? p.evidence : null,
  });
}

const total = rows.length;
const aboveL1 = rows.filter((r) => r.level === 'L3-真跑' || r.level === 'L4-正确').length;
const l1 = rows.filter((r) => r.level === 'L1-静态可达').length;
const naCount = rows.filter((r) => r.level === '不适用').length;
const denominator = total - naCount;
const passRate = denominator > 0 ? ((aboveL1 / denominator) * 100).toFixed(1) : '0';
const l1Rows = rows.filter((r) => r.level === 'L1-静态可达');
const emptyWs = l1Rows.filter((r) => r.output.indexOf('写集为空') >= 0).length;
const partialWs = l1Rows.filter((r) => r.output.indexOf('缺：') >= 0).length;

const Q = String.fromCharCode(96); // 反引号（避免转义地狱）
let md = '';
md += '# 判据等级定级清单（D1144 · 板真值标定与回填）\n\n';
md += '> **取数时刻 as_of**：' + asOf + ' ｜ **量真相源**：' + grading.ref + '@' + grading.refSha + '（' + grading.refDate + '）\n';
md += '> **定级判据**：CTO 2026-10-05 派单 §3.2 **逐字照抄，未自创**：L1-静态可达 / L2-接线 / L3-真跑 / L4-正确 / 不适用；**缺证据 ⇒ L1 + 未验**。\n';
md += '> **机器复跑**：' + Q + 'tsx docs/synova/coordination/tools/grade-criteria.ts --json=grading.json' + Q + ' → ' + Q + 'tsx docs/synova/coordination/tools/emit-criterion-levels.ts --grading=… --probe=… --board=… --adjudication=…' + Q + '\n';
md += '> 🔴 **本表全部读数取自 git ref（' + grading.ref + '），未读工作树**（主仓工作树停在 docs/D1115-b1-br5-closeout，非 main）。\n\n';

md += '## 一、通过率\n\n';
md += '| 判据等级 | 项数 | 占活动项 |\n|---|---|---|\n';
for (const lv of ['L4-正确', 'L3-真跑', 'L2-接线', 'L1-静态可达', '不适用']) {
  const n = tally[lv] ?? 0;
  md += '| ' + lv + ' | ' + n + ' | ' + (lv === '不适用' ? '—' : ((n / denominator) * 100).toFixed(1) + '%') + ' |\n';
}
md += '| **合计** | **' + total + '** | 活动项分母 ' + denominator + '（= 总数 − 不适用 ' + naCount + '） |\n\n';
md += '**判据通过率（L3+L4 / 活动项）= ' + aboveL1 + '/' + denominator + ' = ' + passRate + '%**\n\n';
md += '- L2-接线 = **0 项** ⇒ **本波次无 L2 定级需要举证**（补 3 要求 L2/L3/L4 每条附可复跑命令 + 原始输出；L2 为空集）。\n';
md += '- L1 = ' + l1 + ' 项：其中 **' + emptyWs + ' 项写集为空**（DSH 登记件无 paths 字段 ⇒ L1 无对象）、**' + partialWs + ' 项写集部分缺失**（缺的正是本卡"判据交付物"）、**' + (l1 - emptyWs - partialWs) + ' 项写集全额可达但无已跑判据**（未验）。\n\n';

md += '## 二、逐项清单（' + total + ' 项）\n\n';
md += '| 项 | 卡号 | 判据等级 | 证据命令 | 原始输出摘要 | 备注 | 取数时刻 |\n|---|---|---|---|---|---|---|\n';
for (const r of rows) {
  const esc = (s: string): string => s.replace(/[|]/g, '\\|').replace(/\r?\n/g, ' ');
  md += '| ' + r.id + ' | ' + (r.card ? '#' + r.card : '—') + ' | **' + r.level + '** | ' + esc(r.evidenceCmd) + ' | ' + esc(r.output) + ' | ' + esc(r.note) + ' | ' + r.asOf + ' |\n';
}

md += '\n## 三、板上「执行态」证据（探针 ' + probe.originMain + ' ｜ 取数 ' + probe.asOf + '）\n\n';
md += '探针复跑：登记件 ' + probe.total + ' 项（施工活动 + DSH）｜ 已核对 ' + probe.checked + ' ｜ **不一致 ' + probe.diff + ' 处** ｜ 一致 ' + (probe.checked - probe.diff) + '/' + probe.checked + '\n\n';
md += '| 项 | 卡号 | 板上 | 证据推出 | 证据依据 |\n|---|---|---|---|---|\n';
for (const r of probe.rows.filter((x: any) => !x.same)) {
  md += '| ' + r.id + ' | #' + r.card + ' | ' + r.board + ' | **' + r.evidence + '** | ' + String(r.basis).replace(/[|]/g, '\\|') + ' |\n';
}

md += '\n## 四、例外清单（本次验不了的 —— 主动列，不藏）\n\n';
md += '1. **L2-接线层整体缺判据**：登记件无"符号名"字段 ⇒ 无法逐项机械判"有生产调用点"。本次只对写集内 src/ 文件做 basename 引用面机械扫描（结果在 grading.json），**未据此定级**（会假阳）。\n';
md += '2. **' + emptyWs + ' 项 DSH 借鉴项（UD-xx / RS-xx）无写集**：DshItem 无 paths 字段 ⇒ L1 判据无对象，一律 L1+未验，**不代表已开工**。\n';
md += '3. **' + partialWs + ' 项写集部分缺失**：缺的正是本卡判据交付物（probe 脚本 / 测试文件）⇒ 连 L1 都未全额成立，备注已逐项列出缺哪个文件。\n';
md += '4. **L4 只做到 1 项（0-7）**：其余项未做"回退 ⇒ 必红"——多数卡根本没有可回退的修复（未开工）。\n';
md += '5. **41 项判据交付物在 ' + grading.ref + ' 不存在** ⇒ 完成标准命令必然不通过，**未跑**（跑了只得"文件不存在"的噪声）。\n';
md += '6. **含 sqlite 断言的卡未做 L3**（0-1/0-2/0-9/1-4/2-1b/2-3/3-5/0-9bis 等）：断言打在本机 data/synova.db（运行期产物），与 ref 无关 ⇒ 不采信、不代跑。\n';
md += '7. **探针只覆盖 72/132 张板卡**：其余 60 张（模块卡 K1–K11、子卡 #962-S*、旧卡 #949–#959 等）无登记件项号 ⇒ 探针不判、本表不定级。\n';
md += '8. **3 张卡「执行态」为空**（#1030 / #1031 / #1032，标题不含项号 ⇒ 非登记件项）⇒ 探针不写。\n';
md += '9. **派单件两处计数与实物不符（实测更小）**：施工项登记件实测 **48 项**（非 49；46 活动 + 1 retired + 1 proposal）；DSH 登记件实测 **24 项**（其文件头自称 25）⇒ 合计 **72**，与 cardmap.json total=72 一致。\n';
md += '10. **L3 运行的运行时三元组**（红线 ⑤）：node v24.19.0 @ ' + Q + '/Users/wane/.nvm/versions/node/v24.19.0/bin/node' + Q + ' ｜ vitest @ ' + Q + '/Users/wane/SynovaAgent/node_modules/.bin/vitest' + Q + ' ｜ 取数 ' + asOf + '。本机另一运行时 node 无法加载 vitest 原生 binding（签名 Team ID 不匹配）—— 该运行时细节按补 1 不在本件展开，另报 CTO。\n';
md += '11. **"执行态"语义碰撞（必须先看这条再用板）**：探针按证据推导，会把人工过程态 **已派单 → 未开工**（0-11 #985 / 0-12 #986：确无任何关联 PR）。若 CTO 要保留"已派单"信号，需给探针加 --preserve-dispatch 或给"执行态"加档；**本次按派单件原文执行 --emit（证据优先），故这 2 张会落到"未开工"**。\n';
md += '12. **板低估 9 张**：0-3 #977 / 0-5 #979 / 0-7 #981 / 0-8 #982 / 1-8 #987 / 1-9 #988 板=已派单而证据=已交付；0-1 #975 / 0-2 #976 / 0-6 #980 板=已派单而证据=进行中（正式链接 PR 已开）。\n';
md += '13. **探针主判据的已知假阴面（本次实测）**：#1051(1-7) 的载体 PR 用 ' + Q + 'Refs #1051' + Q + ' 而非 ' + Q + 'Closes' + Q + ' ⇒ GitHub 不建正式链接 ⇒ 探针判"未开工"，而代码与判据件都已在 main。**建议**：后续把 PR 正文的 ' + Q + '#N' + Q + ' 引用纳入补充判据（本次未改，避免引入假阳）。\n';

md += renderSections(SECTIONS);

if (MD_OUT) {
  writeFileSync(MD_OUT, md, 'utf-8');
  process.stdout.write('  清单已写：' + MD_OUT + '（' + rows.length + ' 项）\n');
}
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ asOf, ref: grading.ref, refSha: grading.refSha, refDate: grading.refDate, tally, passRate,
    aboveL1, denominator, total, rows }, null, 1), 'utf-8');
  process.stdout.write('  定级 JSON 已写：' + JSON_OUT + '\n');
}

process.stdout.write('  通过率：L3+L4 ' + aboveL1 + '/' + denominator + ' = ' + passRate + '% ｜ ' + JSON.stringify(tally) + '\n');

if (!EMIT) process.exit(0);

let wrote = 0;
let skipped = 0;
for (const r of rows) {
  if (!r.card) { skipped++; continue; }
  const card = cardByNumber.get(r.card);
  if (!card) { skipped++; continue; }
  const opt = LEVEL_OPT[r.level];
  if (!opt) die('等级无对应 option：' + r.level);
  gql('mutation { updateProjectV2ItemFieldValue(input:{projectId:"' + PROJECT_ID + '",itemId:"' + card.itemId + '",fieldId:"' + CRITERION_FIELD + '",value:{singleSelectOptionId:"' + opt + '"}}) { projectV2Item { id } } }');
  wrote++;
}
process.stdout.write('  ✅ 已写板「判据等级」：' + wrote + ' 卡（跳过 ' + skipped + '）\n');
