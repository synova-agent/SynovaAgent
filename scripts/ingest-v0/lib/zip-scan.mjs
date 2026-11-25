/**
 * scripts/ingest-v0/lib/zip-scan.mjs — 把 ZIP 文件展开成"条目级事实"（**只枚举、不解压**）。
 *
 * 为什么要独立一件：`zip-entries.mjs` 只负责解析结构，本件负责**安全语义**（哪些条目要记 skipped、
 * 哪些 zip 整体判 corrupt、哪些算 supported）；把它单独放，测试才能只针对语义断言，
 * 不用每次构造真实 ZIP 再跑目录遍历。
 *
 * 语义（任务书 §4／§6）：
 *   · ZIP 整体结构损坏 ⇒ 该 zip **从 supported 移到 skipped**（reason=`corrupt`），不假装"空 ZIP"；
 *   · 条目越界（`..`／绝对路径／盘符／UNC）⇒ `skipped{reason:'path_traversal'}`，路径写作 `<zip>!/<条目>`；
 *   · 条目加密 ⇒ `skipped{reason:'encrypted'}`（逐条，不合并成一句"含加密条目"）；
 *   · 条目解压后超过单文件上限 ⇒ `skipped{reason:'oversized'}`；
 *   · 目录型条目（名字以 `/` 结尾）不计入上面三类，只计入条目总数。
 */

import { readZipEntries } from './zip-entries.mjs';

/**
 * 为每个 supported 的 ZIP 附上条目统计，并把"必须跳过的条目"展开成 skipped 条目。
 *
 * @input  files —— `walk.scanTree().files`（本函数只读不改原数组）
 *         options.maxFileBytes —— 单条目解压后大小上限（默认取 budget 的 maxFileBytes）
 * @output `{files, extraSkipped}`：
 *           files —— 新数组；ZIP 项追加 `zip:{entryCount, directoryCount, traversalCount, encryptedCount,
 *                   oversizedCount}`；corrupt 的 ZIP 被**移除**（改由 extraSkipped 记录）
 *           extraSkipped —— `{path, reason, detail?}`（`corrupt`／`path_traversal`／`encrypted`／`oversized`）
 * @degraded 无：读失败/损坏都变成显式 skipped（不静默丢弃、不当成功）
 * @authority 越界判据只用 `zip-entries.isTraversalEntry`（经 `classify` 单一真源），本模块不另写
 * @not-here 不解压条目、不写任何文件、不联网；不判断条目内容能否被抽取
 * @error `IngestError(E_INPUT_UNREADABLE, phase='zip')` —— ZIP 文件打不开（IO 错误原样上抛，不吞）
 */
export function annotateZipFiles(files, options = {}) {
  const maxFileBytes = options.maxFileBytes;
  const enriched = [];
  const extraSkipped = [];

  for (const file of files) {
    if (!file.supported || file.type !== 'zip') {
      enriched.push(file);
      continue;
    }
    const result = readZipEntries(file.path, options);
    if (!result.ok) {
      extraSkipped.push({ path: file.relPath, reason: 'corrupt', detail: { corruptReason: result.corruptReason } });
      continue;
    }

    let directoryCount = 0;
    let traversalCount = 0;
    let encryptedCount = 0;
    let oversizedCount = 0;
    for (const entry of result.entries) {
      if (entry.directory) {
        directoryCount += 1;
        continue;
      }
      if (entry.traversal) {
        traversalCount += 1;
        extraSkipped.push({ path: `${file.relPath}!/${entry.name}`, reason: 'path_traversal' });
        continue;
      }
      if (entry.encrypted) {
        encryptedCount += 1;
        extraSkipped.push({ path: `${file.relPath}!/${entry.name}`, reason: 'encrypted' });
        continue;
      }
      if (typeof maxFileBytes === 'number' && entry.uncompressedSize > maxFileBytes) {
        oversizedCount += 1;
        extraSkipped.push({
          path: `${file.relPath}!/${entry.name}`,
          reason: 'oversized',
          detail: { uncompressedSize: entry.uncompressedSize, maxFileBytes },
        });
      }
    }

    enriched.push({
      ...file,
      zip: {
        entryCount: result.entryCount,
        directoryCount,
        traversalCount,
        encryptedCount,
        oversizedCount,
      },
    });
  }

  return { files: enriched, extraSkipped };
}
