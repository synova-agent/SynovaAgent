#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/check-block-paths.ts — 块级 `paths` **对账门禁**（CTO 裁定 074 步 1b）
 *
 * @why 真源里 `ConstructionBlock.paths`（快照）与 `blocks[].items[].paths` 的并集（真值）
 *      会随施工项变动而漂移（实证：2026-10-13 该漂移**真的发生了** —— K10 少 4 条、K12 多 2 条，
 *      根因是生成快照时读到了 PR #493 落地前的旧真源；见治理线回执 §〇）。
 *      本件把"漂移"变成**红灯**。
 *
 * @契约（铁律 47）
 *   @input   `--source <path>`（可选；默认 = 真源，见 `gen-block-paths.ts` 的 `TRUE_SOURCE_REL`）
 *   @output  stdout：一致 ⇒ 一行 `✅ …`；不一致 ⇒ 逐块差集明细 + 末行 SUMMARY
 *            stderr：诊断（notes / errors）
 *   @exit    🔴 **三态（D328 / ctrl-tower-change 模式 1）**
 *              0 = **一致**（14 块逐块：快照 === 现算，含顺序）
 *              1 = **不一致**（两边都在但内容/顺序不同）
 *              2 = **判不了**（fail-closed：读不到真源 / 导出缺失 / 形状不符 / 悬空 item id /
 *                            块级 `paths` 字段整体缺失）—— **绝不"空结果当通过"**
 *   @degraded — 无独立降级路径（同上，一切异常归 2）
 *
 * 🔴 **禁 `|| true` 吞崩溃**：本文件的 catch-all 显式 `exit 2`，且**先打印原始异常**。
 * 🔴 与生成器**共用一份实现**：直接调 `gen-block-paths.ts` 的 `main()` 取数/现算，
 *    再调 `block-paths-core.ts` 的 `compareBlockPaths()` 判差异 ⇒ 无第二份逻辑。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_MISMATCH,
  EXIT_OK,
  EXIT_UNJUDGEABLE,
  compareBlockPaths,
  type BlockDiff,
} from './block-paths-core.ts';
import { loadRegistryView, resolveSourceArg } from './gen-block-paths.ts';

/** 逐块差异的人类可读渲染（🔴 差集必须点名到"哪一条路径"，不许只说"N 处不一致"） */
export function renderDiffs(blockIds: readonly string[], diffs: readonly BlockDiff[]): string {
  const lines: string[] = [];
  lines.push(`🔴 块级 paths 对账失败：${diffs.length}/${blockIds.length} 块不一致`);
  for (const d of diffs) {
    if (d.orderOnlyDiffer) {
      lines.push(`  ❌ ${d.blockId}：集合相同但**顺序不同**（排序口径漂了 —— 本门禁口径=纯码点序）`);
    } else {
      lines.push(
        `  ❌ ${d.blockId}：快照 ${d.onlyInSnapshot.length + d.onlyInComputed.length} 条对不上`,
      );
    }
    for (const p of d.onlyInSnapshot) lines.push(`       - 仅快照有（应删）：${p}`);
    for (const p of d.onlyInComputed) lines.push(`       + 仅现算有（应补）：${p}`);
  }
  lines.push(`  ⓘ 聚合口径 = \`blocks[].items[].paths\` 并集（去重 + 纯码点序）；快照字段只是被检对象`);
  lines.push(`  ⓘ 重算命令：npx tsx scripts/control-tower/gen-block-paths.ts --list`);
  return lines.join('\n');
}

/** CLI 主体（导出供测试直接调；与 `gen-block-paths.ts:main()` 同参数形态） */
export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { sourceArg, error } = resolveSourceArg(argv);
  if (error !== '') {
    process.stderr.write(`❌ 门禁判不了（exit 2）：${error}\n`);
    return EXIT_UNJUDGEABLE;
  }

  const loaded = await loadRegistryView(sourceArg);
  if (!loaded.ok || loaded.view === null) {
    process.stderr.write(`❌ 门禁判不了（exit 2）：${loaded.error}\n`);
    return EXIT_UNJUDGEABLE;
  }

  const compared = compareBlockPaths(loaded.view);
  for (const n of compared.diag.notes) process.stderr.write(`  ${n}\n`);

  if (compared.exit === EXIT_UNJUDGEABLE) {
    for (const e of compared.diag.errors) process.stderr.write(`  ${e}\n`);
    process.stderr.write(
      `❌ 门禁判不了（exit 2）：${compared.diag.errors.length} 条形状/引用错误` +
        `（fail-closed —— 禁把"看不见"当"没问题"）\n`,
    );
    return EXIT_UNJUDGEABLE;
  }

  const blockIds = (loaded.view.blocks as readonly { id: string }[]).map((b) => b.id);

  if (compared.exit === EXIT_OK) {
    process.stdout.write(
      `✅ 块级 paths 对账通过：${blockIds.length} 块逐块一致（快照 === items.paths 并集，含顺序）\n`,
    );
    process.stdout.write(`ⓘ 真源 = ${loaded.sourcePath}\n`);
    return EXIT_OK;
  }

  process.stdout.write(renderDiffs(blockIds, compared.diffs) + '\n');
  process.stdout.write(
    `SUMMARY: exit=1 不一致块 ${compared.diffs.length} / 共 ${blockIds.length} 块\n`,
  );
  return EXIT_MISMATCH;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
    } catch (err) {
      // 非致命：`fileURLToPath` 在非常规 URL 形态下会抛 ⇒ 此时**无法断定**是否被直接调用。
      // 铁律 24/31 要求 catch 有处置信号；此处处置 = **显式降级为"不自动跑 main"** +
      // 在 stderr 留痕（被 import 时测试可读到），**不静默**（禁空 catch）。
      process.stderr.write(
        `ⓘ 降级：无法判定是否直接调用（${err instanceof Error ? err.message : String(err)}）` +
          ` ⇒ 不自动执行 main（作为模块被 import 时的预期行为）\n`,
      );
      return false;
    }
  })();

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      process.stderr.write(`❌ 门禁自身异常（exit 2）：${msg}\n`);
      process.exit(EXIT_UNJUDGEABLE);
    });
}
