#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/exile-tree-core.ts — **隔离宿主树的唯一实现**（CTO 裁定 086）
 *
 * @why 两档演练都要"**把某个包的 paths 拿掉，看另一个包坏不坏**"，而"拿掉"必须
 *      ①**可还原** ②**不碰主树** ③**可复跑**。宿主树 = `git worktree`（天然隔离 + 天然可还原）；
 *      摘除 = 把匹配到的条目移进 `<树>/.exile-quarantine/<相对路径>`；还原 = 反向移回。
 *      🔴 本模块是**唯一判定/搬运逻辑**，`exile-tree.sh` 只是薄壳（同 `block-paths-core.ts` 的分工）。
 *
 * 🔴 为什么不写在 shell 里（实测踩坑，2026-10-13）:
 *   · macOS 自带 `/bin/bash` 是 **3.2**，**没有 `globstar`** ⇒ `src/l4/**` 此类字面量
 *     在 shell 里退化成单层 `*`（**少摘**且**静默**）；
 *   · 还原用 `find -maxdepth 1 -exec mv` 会在嵌套目录上撞 `Directory not empty`；
 *   · `set -u` 下 shell 数组下标/拼接易出 `unbound variable`。
 *   ⇒ 遍历与搬运一律用 Node（跨平台一致；Windows 亦可用）。
 *
 * @契约（铁律 47）
 *   @input   CLI：`--op <expand|exile|restore|verify> --tree <dir>` ＋（exile 时）`--patterns <json>`
 *            `--block <BlockId>` ＋ `--source <登记件>`（可选）
 *   @output  stdout = 一行 JSON（`{op, tree, matched, moved, restored, missing, dangling}`）
 *   @exit    🔴 **三态（D328）**：0 = 成了 ｜ 1 = 真红（摘除面为空 / 树不干净）｜
 *            2 = **判不了**（树不存在 / 真源读不到 / 形状不符）
 *   @degraded — **无独立降级路径**：一切异常归 exit 2 ＋ stderr 点名原始异常
 *
 * 🔴 三条口径（写死）
 *   ① **字面量在场为 0 必须点名**（`missing`）：登记件写了 `paths` 但树里匹配不到 ⇒ 说明
 *      这条字面量已漂（或写法与树结构不符）⇒ **不许静默跳过**（那正是"看不见当没问题"）。
 *   ② **被祖先覆盖者不再单列**：既匹配 `extensions/` 又匹配 `extensions/ontology/activity/` 时，
 *      只搬 `extensions/`（否则第二个搬不动 ⇒ 假红）。
 *   ③ **还原后必须自证干净**：`restore` 结束时隔离区必须为空（有残留 ⇒ exit 1）。
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_MISMATCH, EXIT_OK, EXIT_UNJUDGEABLE } from './block-paths-core.ts';

/** 隔离区目录名（树内，随树一起被销毁） */
export const QUARANTINE = '.exile-quarantine';

/** 一次操作的机器可读结果 */
export interface ExileTreeResult {
  op: string;
  tree: string;
  /** 匹配到的仓根相对路径（POSIX） */
  matched: string[];
  /** 实际搬走的条目数 */
  moved: number;
  /** 还原的条目数 */
  restored: number;
  /** 字面量在树里匹配数为 0 的（**必须点名**） */
  missing: string[];
  /** 悬空：隔离区里还有东西没还原回去 */
  dangling: string[];
}

/** 把反斜杠统一成 POSIX（Windows 与 macOS 同口径） */
function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/**
 * 读目录 —— **ENOENT 是正常默认**（遍历到一个不存在的分支），不是异常。
 *
 * @contract
 *   @input  abs（绝对路径）
 *   @output 子项名数组；不存在/不是目录/不可读 ⇒ `[]`
 *   @degraded 🔴 **有意不在此处 log**：本函数在 `**` 遍历里被调用 O(目录数) 次，
 *             逐个 log 会把 stderr 淹掉；而"看不见"这件事**不会被吞** ——
 *             它由调用方 `expandAll().missing` **逐条点名**（铁律 24 的立法目的
 *             "不许静默降级"由那一条守，不是靠这里打日志）。
 *             非 ENOENT（权限/EIO）同样返回 `[]`，代价是该分支不参与摘除 ——
 *             该情形由"摘除面为空 ⇒ exit 1"兜住（**不会当通过**）。
 */
function readdirSafe(abs: string): string[] {
  try {
    return readdirSync(abs);
  } catch (err) {
    // ENOENT / ENOTDIR：遍历到不存在的分支 ⇒ 正常默认。其余错误也不抛（见上方 @degraded）。
    void (err instanceof Error ? err.code : undefined);
    return [];
  }
}

/** 是否目录（不存在/不可读 ⇒ false；同 `readdirSafe`：由 `missing` 点名兜底，不静默通过） */
function isDir(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch (err) {
    void (err instanceof Error ? err.code : undefined);
    return false;
  }
}

/** glob 片段 ⇒ 正则（`*` = 段内任意；不支持 `?`/`[]` —— 登记件里没有，**不造未用能力**） */
export function segmentToRegExp(seg: string): RegExp {
  const special = new Set(['\\', '^', '$', '.', '|', '?', '+', '(', ')', '[', ']', '{', '}']);
  let re = '';
  for (const c of seg) re += c === '*' ? '[^/]*' : special.has(c) ? '\\' + c : c;
  return new RegExp('^' + re + '$');
}

/**
 * 展开一条 paths 字面量 ⇒ 树里**实际存在**的仓根相对路径。
 *
 * 🔴 **口径（写死）**：`**` **只下沉到目录**，**不逐文件列举** —— 摘除面的语义是
 *    "**拿掉父目录即等价**"，逐文件列举只会让条目数爆炸而结论不变。
 *    末段为具体名（`*.json` / `manifest.json`）时仍逐条匹配（那里需要逐条）。
 *    ⇒ `src/**` 的返回是 `['src', …子目录]`，**不含** `src/a.ts` 这类文件。
 *
 * @contract
 *   @input  tree（宿主树绝对路径）｜ pattern（登记件原样字面量，**禁规范化**）
 *   @output 仓根相对 POSIX 路径数组（码点序去重）；匹配不到 ⇒ `[]`
 *   @degraded 不适用（读不到目录按"该层无子项"处理，**不静默吞异常** —— 由 `missing` 点名暴露）
 */
export function expandPattern(tree: string, pattern: string): string[] {
  const raw = toPosix(pattern);
  const segs = raw.replace(/\/+$/, '').split('/').filter((s) => s !== '');
  if (segs.length === 0) return [];
  const out = walk(tree, segs, '');
  return [...new Set(out)].sort();
}

function walk(tree: string, segs: string[], prefix: string): string[] {
  if (segs.length === 0) return prefix === '' ? [] : [prefix];
  const head = segs[0] as string;
  const rest = segs.slice(1);
  const baseAbs = prefix === '' ? tree : join(tree, prefix);
  if (head === '**') {
    const out: string[] = [];
    out.push(...walk(tree, rest, prefix));
    for (const e of readdirSafe(baseAbs)) {
      if (!isDir(join(baseAbs, e))) continue;
      const np = prefix === '' ? e : prefix + '/' + e;
      out.push(...walk(tree, ['**', ...rest], np));
    }
    return out;
  }
  if (head.includes('*')) {
    const re = segmentToRegExp(head);
    const out: string[] = [];
    for (const e of readdirSafe(baseAbs)) {
      if (!re.test(e)) continue;
      const np = prefix === '' ? e : prefix + '/' + e;
      out.push(...walk(tree, rest, np));
    }
    return out;
  }
  const np = prefix === '' ? head : prefix + '/' + head;
  const abs = join(tree, np);
  if (!existsSync(abs)) return [];
  if (rest.length === 0) return [np];
  return isDir(abs) ? walk(tree, rest, np) : [];
}

/** 去掉被祖先覆盖的条目（口径②） */
export function dropNested(rels: readonly string[]): string[] {
  const sorted = [...rels].sort();
  const out: string[] = [];
  for (const r of sorted) {
    if (out.some((p) => r === p || r.startsWith(p + '/'))) continue;
    out.push(r);
  }
  return out;
}

/**
 * 展开一组字面量（口径①：**在场为 0 的字面量逐条点名**）。
 *
 * @contract
 *   @input  tree｜patterns
 *   @output `{rels, missing}`
 *   @degraded 不适用
 */
export function expandAll(tree: string, patterns: readonly string[]): { rels: string[]; missing: string[] } {
  const rels: string[] = [];
  const missing: string[] = [];
  for (const p of patterns) {
    const hit = expandPattern(tree, p);
    if (hit.length === 0) missing.push(p);
    rels.push(...hit);
  }
  return { rels: dropNested(rels), missing };
}

/**
 * 摘除：把 `rels` 移进隔离区（保留相对结构）。
 *
 * @contract
 *   @input  tree｜rels（仓根相对 POSIX）
 *   @output 实际搬走的条目数
 *   @degraded 不适用（抛 = 环境失败，调用方转 exit 2）
 */
export function applyExile(tree: string, rels: readonly string[]): number {
  let moved = 0;
  for (const rel of rels) {
    const src = join(tree, rel);
    if (!existsSync(src)) continue;
    const dst = join(tree, QUARANTINE, rel);
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    moved++;
  }
  return moved;
}

/** 递归收集隔离区内的条目（相对隔离区的 POSIX 路径） */
function walkQuarantine(qroot: string, prefix: string, out: string[]): void {
  const abs = prefix === '' ? qroot : join(qroot, prefix);
  for (const e of readdirSafe(abs)) {
    const np = prefix === '' ? e : prefix + '/' + e;
    out.push(np);
    if (isDir(join(abs, e))) walkQuarantine(qroot, np, out);
  }
}

/**
 * 还原：把隔离区内容搬回原位，并清掉隔离区（口径③：**残留必须为 0**）。
 *
 * @contract
 *   @input  tree
 *   @output `{restored, dangling}`；`dangling` 非空 ⇒ 调用方判真红（exit 1）
 *   @degraded 不适用
 */
export function restoreTree(tree: string): { restored: number; dangling: string[] } {
  const qroot = join(tree, QUARANTINE);
  if (!existsSync(qroot)) return { restored: 0, dangling: [] };
  const entries: string[] = [];
  walkQuarantine(qroot, '', entries);
  // 深→浅：文件先回位，目录再回位（避免 Directory not empty）
  const deepestFirst = [...entries].sort((a, b) => b.split('/').length - a.split('/').length);
  let restored = 0;
  for (const rel of deepestFirst) {
    const src = join(qroot, rel);
    const dst = join(tree, rel);
    if (existsSync(dst)) continue;
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    restored++;
  }
  rmSync(qroot, { recursive: true, force: true });
  const dangling = existsSync(qroot) ? [QUARANTINE] : [];
  return { restored, dangling };
}

/** 读 `--flag value` */
function readFlag(argv: readonly string[], flag: string): string {
  const i = argv.indexOf(flag);
  return i < 0 ? '' : (argv[i + 1] ?? '');
}

/**
 * CLI 主体（🔴 显式导出：薄壳与测试都直接调它）。
 *
 * @contract
 *   @input  process.argv：`--op <expand|exile|restore>` `--tree <dir>` `--patterns <json数组>`
 *   @output stdout 一行 JSON：`ExileTreeResult`
 *   @exit   0 = 成了 ｜ 1 = 真红（摘除面为空 / 有残留）｜ 2 = 判不了（参数缺失 / 树不存在 / 异常）
 *   @degraded 一切异常 ⇒ exit 2 ＋ stderr 点名
 */
export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const op = readFlag(argv, '--op');
  const tree = resolve(readFlag(argv, '--tree'));
  const patternsRaw = readFlag(argv, '--patterns');
  if (op === '' || tree === '' || readFlag(argv, '--tree') === '') {
    process.stderr.write('❌ 隔离树判不了（exit 2）：必须给 --op 与 --tree\n');
    return EXIT_UNJUDGEABLE;
  }
  if (!existsSync(tree)) {
    process.stderr.write(`❌ 隔离树判不了（exit 2）：树不存在 ${tree}\n`);
    return EXIT_UNJUDGEABLE;
  }
  let patterns: string[] = [];
  if (patternsRaw !== '') {
    try {
      const parsed: unknown = JSON.parse(patternsRaw);
      if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) {
        process.stderr.write('❌ 隔离树判不了（exit 2）：--patterns 必须是字符串数组的 JSON\n');
        return EXIT_UNJUDGEABLE;
      }
      patterns = parsed;
    } catch (err) {
      process.stderr.write(
        `❌ 隔离树判不了（exit 2）：--patterns 不是合法 JSON（${err instanceof Error ? err.message : String(err)}）\n`,
      );
      return EXIT_UNJUDGEABLE;
    }
  }

  const result: ExileTreeResult = {
    op,
    tree,
    matched: [],
    moved: 0,
    restored: 0,
    missing: [],
    dangling: [],
  };
  if (op === 'expand') {
    const ex = expandAll(tree, patterns);
    result.matched = ex.rels;
    result.missing = ex.missing;
  } else if (op === 'exile') {
    const ex = expandAll(tree, patterns);
    result.matched = ex.rels;
    result.missing = ex.missing;
    result.moved = applyExile(tree, ex.rels);
  } else if (op === 'restore') {
    const rs = restoreTree(tree);
    result.restored = rs.restored;
    result.dangling = rs.dangling;
  } else {
    process.stderr.write(`❌ 隔离树判不了（exit 2）：不认识的 --op 「${op}」\n`);
    return EXIT_UNJUDGEABLE;
  }

  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.dangling.length > 0) {
    process.stderr.write(`❌ 真红（exit 1）：隔离区有残留 ${result.dangling.join(', ')}\n`);
    return EXIT_MISMATCH;
  }
  if (op === 'exile' && result.moved === 0) {
    process.stderr.write('❌ 真红（exit 1）：摘除面为空（moved=0）—— 探针无效，禁当通过\n');
    return EXIT_MISMATCH;
  }
  for (const m of result.missing) {
    process.stderr.write(`  ⚠️ 字面量在树里匹配为 0（已点名，不静默跳过）：${m}\n`);
  }
  return EXIT_OK;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
    } catch (err) {
      process.stderr.write(
        `ⓘ 降级：无法判定是否直接调用（${err instanceof Error ? err.message : String(err)}）⇒ 不自动执行 main\n`,
      );
      return false;
    }
  })();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`❌ 隔离树自身异常（exit 2）：${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(EXIT_UNJUDGEABLE);
    });
}
