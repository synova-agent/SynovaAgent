#!/usr/bin/env node
/**
 * 判据等级定级机（grade-criteria）—— 对登记件每一项**机械取证**，不许猜
 *
 * @why  CTO 2026-10-05 派单 §3.2：「对活动项逐项定级」，且明令
 *       ① 判据 = L1-静态可达 / L2-接线 / L3-真跑 / L4-正确 / 不适用（**不许自创**）
 *       ② **缺证据的项 ⇒ 标 L1 并在备注写"未验"（不许猜、不许填高）**
 *       ⇒ 本件把"能机械判的"全部机械判掉，剩下的**显式标 未验**，交人裁。
 *
 * @contract（铁律 47）
 *   @input  — 无参 ｜ `--ref=<ref>`（默认 origin/main）｜ `--json=<path>`（行级结果落盘）
 *   @output — stdout 汇总 + JSON：每项 { id, card, level, evidence[], note }
 *   @degraded — git 取不到 ref / 登记件读不到 ⇒ exit 2（禁静默当"通过"）
 *
 * @levels（**逐字照 CTO 派单 §3.2，不自创**）
 *   L1-静态可达 = 写集文件在 origin/main 存在（`git cat-file -e origin/main:<path>`）—— **不得据此声称完成**
 *   L2-接线     = 有生产调用点（grep 到调用，且非测试文件、非注释行）
 *   L3-真跑     = 该卡完成标准里那条命令跑过且过（贴原始输出 + 取数时刻）
 *   L4-正确     = 回退修复 ⇒ 夹具必红（贴两段输出）
 *   不适用      = 治理/文档类，无代码判据
 *   ⚠️ 缺证据 ⇒ 标 L1 + 备注"未验"
 *
 * @does-not-touch 产品代码。只读 git。
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REG_DIR = resolve(HERE, '..');
const argv = process.argv.slice(2);
const REF = (() => {
  const a = argv.find((x) => x.startsWith('--ref='));
  return a ? a.slice('--ref='.length) : 'origin/main';
})();
const JSON_OUT = (() => {
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

// ── 路径存在性（支持 glob）────────────────────────────────────────
function globToRe(p: string): RegExp {
  let s = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') { s += '(?:.*/)?'; i += 2; } else { s += '.*'; i += 1; }
      } else s += '[^/]*';
    } else if ('\\^$.|?+()[]{}'.includes(ch)) s += '\\' + ch;
    else s += ch;
  }
  return new RegExp('^' + s + '$');
}

type Exists = { path: string; ok: boolean; how: string; detail: string };

function pathExists(p: string): Exists {
  if (!p.includes('*')) {
    const r = run('git', ['cat-file', '-e', `${REF}:${p}`]);
    return { path: p, ok: r.status === 0, how: `git cat-file -e ${REF}:${p}`, detail: r.status === 0 ? '存在' : '缺失' };
  }
  const idx = p.indexOf('*');
  const dirEnd = p.lastIndexOf('/', idx);
  const dir = dirEnd > 0 ? p.slice(0, dirEnd) : '.';
  const r = run('git', ['ls-tree', '-r', '--name-only', REF, '--', dir]);
  if (r.status !== 0) return { path: p, ok: false, how: `git ls-tree -r --name-only ${REF} -- ${dir}`, detail: `git 失败：${r.err.slice(0, 80)}` };
  const re = globToRe(p);
  const hits = r.out.split('\n').filter(Boolean).filter((f) => re.test(f));
  return {
    path: p,
    ok: hits.length > 0,
    how: `git ls-tree -r --name-only ${REF} -- ${dir}  （glob ${p}）`,
    detail: `${hits.length} 命中${hits.length ? '：' + hits.slice(0, 3).join(',') : ''}`,
  };
}

/** 从 acceptance 命令行里抽出"判据交付物"候选路径 */
const ARTIFACT_RE = /(?:^|[\s"'`=(])((?:scripts|tests|src|extensions|docs|data|cycles|expert|knowledge|packages)\/[A-Za-z0-9_./@-]+\.(?:ts|tsx|sh|js|mjs|json|md|sql|db|yaml|yml))/g;
function artifactsIn(cmd: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  ARTIFACT_RE.lastIndex = 0;
  while ((m = ARTIFACT_RE.exec(cmd)) !== null) out.add(m[1]);
  return [...out];
}

// ── 类型 ──────────────────────────────────────────────────────────
type Step = { run: string; expectExit?: number; expectStdoutContains?: string; expectRowsGt?: { table: string; n: number }; expectRowsEq?: { table: string; n: number } };
type Item = {
  id: string;
  src: 'construction' | 'dsh';
  title: string;
  status: string;
  block: string;
  batch: string;
  paths: string[];
  acceptance: Step[];
  doneAt?: string;
  category?: string;
  source: string;
};

type Row = {
  id: string;
  src: string;
  block: string;
  batch: string;
  status: string;
  title: string;
  level: string;
  levelReason: string;
  writeSet: Exists[];
  writeSetAllExist: boolean;
  acceptance: Array<{ run: string; artifacts: Exists[]; artifactsAllExist: boolean }>;
  note: string;
};

async function load(): Promise<Item[]> {
  let a: { constructionItems: Array<Record<string, any>>; constructionBlocks: Array<{ id: string; items: string[] }> };
  let b: { dshItems: Array<Record<string, any>> };
  try {
    a = (await import(`${REG_DIR}/施工项登记.ts`)) as typeof a;
    b = (await import(`${REG_DIR}/DSH借鉴项登记.ts`)) as typeof b;
  } catch (e) {
    die(`登记件读不到：${e instanceof Error ? e.message : String(e)}`);
  }
  const blk = new Map<string, string>();
  for (const bl of a.constructionBlocks) for (const id of bl.items) blk.set(id, bl.id);
  const out: Item[] = a.constructionItems.map((i) => ({
    id: i.id, src: 'construction' as const, title: i.title, status: i.status,
    block: blk.get(i.id) ?? '?', batch: i.batch ?? '', paths: i.paths ?? [], acceptance: i.acceptance ?? [], source: i.source ?? '',
  }));
  for (const i of b.dshItems) {
    out.push({
      id: i.id, src: 'dsh' as const, title: i.name, status: i.status ?? '', block: 'K10',
      batch: '', paths: [], acceptance: [], doneAt: i.doneAt, category: i.category, source: i.source ?? '',
    });
  }
  return out;
}

const items = await load();
const refSha = run('git', ['rev-parse', '--short', REF]).out;
const refDate = run('git', ['log', '-1', '--format=%cI', REF]).out;
if (!refSha) die(`取不到 ${REF}（定级的静态面判据无依据）`);
const asOf = new Date().toISOString();
process.stdout.write(`  定级依据：${REF}@${refSha}（${refDate}）｜ 取数时刻 ${asOf}\n`);

const rows: Row[] = [];
const tally: Record<string, number> = {};

for (const it of items) {
  const writeSet = it.paths.map(pathExists);
  const writeSetAllExist = writeSet.length > 0 && writeSet.every((w) => w.ok);
  const acceptance = it.acceptance.map((s) => {
    const arts = artifactsIn(s.run).map(pathExists);
    return { run: s.run, artifacts: arts, artifactsAllExist: arts.length > 0 && arts.every((x) => x.ok) };
  });

  // ── 定级（严格按 CTO §3.2；缺证据 = L1 + 未验）──
  let level = 'L1-静态可达';
  let levelReason = '';
  let note = '';

  const codePaths = it.paths.filter((p) => /^(src|packages|extensions|scripts|cycles|expert)[/]/.test(p));
  const docPaths = it.paths.filter((p) => /^docs[/]/.test(p));

  if (it.status === 'retired' || it.status === 'proposal') {
    level = '不适用';
    levelReason = `登记件 status=${it.status}（非活动施工项）`;
  } else if (it.paths.length === 0) {
    level = 'L1-静态可达';
    levelReason = '登记件无 paths 字段 ⇒ L1 判据无对象';
    note = '未验：写集未定，L1 无对象（DSH 借鉴项登记件不含 paths）';
  } else if (codePaths.length === 0 && docPaths.length > 0) {
    level = '不适用';
    levelReason = '写集全为 docs/（治理/文档类，无代码判据）';
  } else if (writeSetAllExist) {
    level = 'L1-静态可达';
    levelReason = `写集 ${writeSet.length}/${writeSet.length} 在 ${REF} 存在`;
    const missingArt = acceptance.filter((a) => !a.artifactsAllExist);
    if (acceptance.length > 0 && missingArt.length === acceptance.length) {
      note = '未验：完成标准的判据交付物在 ' + REF + ' 不存在 ⇒ 命令必然不通过，未跑';
    } else if (acceptance.length > 0) {
      note = '未验：判据交付物已存在但本次未跑该命令（未取到原始输出）';
    } else {
      note = '未验：无 acceptance 步，L2/L3 无对象';
    }
  } else {
    level = 'L1-静态可达';
    levelReason = `写集部分缺失（${writeSet.filter((w) => w.ok).length}/${writeSet.length}）`;
    note = '未验：写集未全部可达';
  }

  // 生产调用点（L2）——机械面：写集里的 src/ 文件是否被 src/ 生产代码引用
  let l2: { ok: boolean; detail: string } = { ok: false, detail: '未查' };
  const srcFiles = it.paths.filter((p) => p.startsWith('src/') && p.endsWith('.ts'));
  if (srcFiles.length > 0 && writeSetAllExist) {
    const base = srcFiles[0].split('/').pop()!.replace(/\.ts$/, '');
    const g = run('git', ['grep', '-n', '--', base, REF, '--', 'src/']);
    const lines = g.out.split('\n').filter(Boolean).filter((l) => !/\.test\./.test(l));
    l2 = { ok: lines.length > 0, detail: `git grep -n '${base}' ${REF} -- src/ ⇒ ${lines.length} 行（去测试文件）` };
  }

  tally[level] = (tally[level] ?? 0) + 1;
  rows.push({
    id: it.id, src: it.src, block: it.block, batch: it.batch, status: it.status, title: it.title,
    level, levelReason, writeSet, writeSetAllExist, acceptance,
    note: note + (l2.detail !== '未查' ? ` ｜ L2 机械面：${l2.detail}（${l2.ok ? '有引用' : '无引用'}）` : ''),
  });
}

process.stdout.write(`  定级 ${rows.length} 项：${JSON.stringify(tally)}\n`);
const noWs = rows.filter((r) => r.writeSet.length === 0);
process.stdout.write(`  写集为空（L1 无对象）：${noWs.length} 项 —— ${noWs.map((r) => r.id).join(', ')}\n`);
const missArt = rows.filter((r) => r.acceptance.length > 0 && r.acceptance.every((a) => a.artifacts.length > 0 && !a.artifactsAllExist));
process.stdout.write(`  判据交付物缺失（L3 必然不过）：${missArt.length} 项\n`);

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ asOf, ref: REF, refSha, refDate, tally, rows }, null, 1), 'utf-8');
  process.stdout.write(`  行级结果已落盘：${JSON_OUT}\n`);
}
