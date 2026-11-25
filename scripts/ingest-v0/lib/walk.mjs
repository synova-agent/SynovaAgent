/**
 * scripts/ingest-v0/lib/walk.mjs — 目录遍历（**唯一目录 I/O 入口**）。
 *
 * 为什么把 I/O 集中在一处：分类（`classify.mjs`）与限额（`budget.mjs`）都是纯函数，
 * 这样"遍历策略"只有一份实现，不会出现"CLI 一套、测试另一套"的双口径。
 *
 * 安全边界（任务书 §5／§6）：
 *   · **不跟链接**：一律 `lstat`，`isSymbolicLink()` 为真（含 Windows junction）⇒ 记
 *     `skipped{reason:'symlink'}` 且**不递归**；`--source` 自身是链接时 CLI 直接拒绝。
 *   · **不读文件内容**：只 `lstat` 取大小（发现层不需要内容；加密/损坏留给抽取层，ZIP 见 `zip-entries.mjs`）。
 *   · **超限即停**：累计型上限由 `budget` 抛 `E_RESOURCE_LIMIT`，错误携带**已扫到的部分结果**。
 *   · **确定性**：同目录内容 ⇒ 同顺序（按路径排序），便于报告逐字复跑。
 */

import fs from 'node:fs';
import path from 'node:path';
import { IngestError } from './errors.mjs';
import { admitFile, checkDepth } from './budget.mjs';
import { classifyFileName } from './classify.mjs';

/**
 * 递归扫描 `rootDir`。
 *
 * @input  rootDir —— 已确认存在的**真实目录**绝对路径（本函数不跟随链接，也不校验根）
 *         options.budget —— `budget.createBudget` 产物（就地累加）
 *         options.clock —— `() => epochMs`（注入，便于测时长上限；缺省 `Date.now`）
 * @output `{files, skipped, stats}`：
 *           files —— `{path, relPath, size, depth, type, supported, reason?}`（按 relPath 升序）
 *           skipped —— `{path, reason, detail?}`（`symlink`／`oversized`／`unreadable`／`vanished`）
 *           stats —— `{dirsVisited, maxDepthSeen}`
 * @degraded **不静默**：不可读目录/遍历中消失的条目都进 `skipped[]` 并带原因，不当"没问题"
 * @authority 分类只问 `classifyFileName`；限额只问 `budget`；本函数不另立判据
 * @not-here 不判断文件是否加密/损坏（发现层不打开内容）、不解压 ZIP、不联网、不写文件
 * @error `IngestError(E_RESOURCE_LIMIT, phase='scan')` —— 超限**立即停**；`.partial` 带已扫部分结果
 */
export function scanTree(rootDir, options = {}) {
  const budget = options.budget;
  const clock = options.clock ?? (() => Date.now());
  if (budget === undefined) {
    throw new IngestError('E_BAD_ARGS', 'scan', 'scanTree 需要 budget（限额判定必须显式注入）');
  }

  const files = [];
  const skipped = [];
  const stats = { dirsVisited: 0, maxDepthSeen: 0 };
  // 账本未给起点（0）时用注入时钟补一次 ⇒ 时长上限从"扫描开始"起算（否则从 epoch 起算，永远超限）
  if (budget.startedAtMs === 0) budget.startedAtMs = clock();

  /** 深度优先遍历（迭代式：显式栈，避免深目录爆栈）。 */
  const stack = [{ absDir: rootDir, relDir: '', depth: 0 }];
  try {
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      stats.dirsVisited += 1;
      if (current.depth > stats.maxDepthSeen) stats.maxDepthSeen = current.depth;

      let entries;
      try {
        entries = fs.readdirSync(current.absDir, { withFileTypes: true });
      } catch (err) {
        skipped.push({
          path: current.relDir === '' ? '.' : current.relDir,
          reason: 'unreadable',
          detail: err instanceof Error ? err.code ?? err.message : String(err),
        });
        continue;
      }
      // 确定性：readdir 顺序与平台/文件系统有关 ⇒ 显式排序后压栈（逆序入栈保证正序弹出）
      const names = entries.map(entry => entry.name).sort();
      for (let index = names.length - 1; index >= 0; index -= 1) {
        const name = names[index];
        const absPath = path.join(current.absDir, name);
        const relPath = current.relDir === '' ? name : `${current.relDir}/${name}`;
        let stat;
        try {
          stat = fs.lstatSync(absPath);
        } catch (err) {
          skipped.push({ path: relPath, reason: 'vanished', detail: err instanceof Error ? err.code ?? err.message : String(err) });
          continue;
        }
        // 符号链接 / junction：不跟随、不递归（判据只看 lstat，不看目标类型）
        if (stat.isSymbolicLink()) {
          skipped.push({ path: relPath, reason: 'symlink' });
          continue;
        }
        if (stat.isDirectory()) {
          const childDepth = current.depth + 1;
          checkDepth(budget, childDepth, relPath);
          stack.push({ absDir: absPath, relDir: relPath, depth: childDepth });
          continue;
        }
        if (!stat.isFile()) {
          skipped.push({ path: relPath, reason: 'not_regular_file' });
          continue;
        }
        const admitted = admitFile(budget, { size: stat.size, path: relPath }, clock());
        if (!admitted.accepted) {
          skipped.push({
            path: relPath,
            reason: admitted.reason,
            detail: { size: admitted.size, maxFileBytes: admitted.maxFileBytes },
          });
          continue;
        }
        const classification = classifyFileName(name);
        const item = {
          path: absPath,
          relPath,
          size: stat.size,
          depth: current.depth,
          type: classification.type,
          supported: classification.supported,
        };
        if (classification.supported) files.push(item);
        else files.push({ ...item, reason: classification.reason });
      }
    }
  } catch (err) {
    if (err instanceof IngestError) {
      err.partial = { files, skipped, stats };
    }
    throw err;
  }

  files.sort((left, right) => (left.relPath < right.relPath ? -1 : left.relPath > right.relPath ? 1 : 0));
  skipped.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files, skipped, stats };
}
