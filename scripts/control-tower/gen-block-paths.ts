#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/gen-block-paths.ts — 块级 `paths` **生成器**（CTO 裁定 074 步 1b）
 *
 * @why 真源里 `ConstructionBlock.paths` 是**手工跑脚本写死**的快照 ⇒ 施工项一变（如加 K3-13…K3-17）
 *      那一栏就过时。本件提供"**能一键重算**"：喂登记件 ⇒ 吐出每块管哪些路径。
 *      🔴 对账（"字段里的 vs 现算的 ⇒ 不一致就红"）是 `check-block-paths.sh`；两者共用 `block-paths-core.ts`。
 *
 * @契约（铁律 47）
 *   @input   `--source <path>`（可选；默认 = 真源 `docs/synova/coordination/施工项登记.ts`）
 *            🔴 默认路径**必须是真源**；`--source` 只服务测试（`tests/control-tower/block-paths-fixtures/`）
 *   @output  stdout = **块级路径视图的稳定 JSON**（`{blockId: [paths...]}`，键码点序、值去重码点序）
 *            stderr = 诊断（notes / errors）
 *            `--list` 时改为人类可读的一行式对照（`K10  35  [...]`）
 *   @exit    0 = 算出来了 ｜ 2 = **判不了**（读不到真源 / 导出缺失 / 形状不符 / 悬空 id）—— **fail-closed**
 *            🔴 **本生成器永不 exit 1**：它的语义是"算"，不是"判"（判在门禁）
 *   @degraded — 无独立降级路径：任何异常都归 exit 2 + stderr 点名（禁"空结果当通过"）
 *
 * 🔴 **本件不实现 `--write`（有意）**：回写真源 `docs/synova/coordination/施工项登记.ts` 是 CTO 红线，
 *   且对 700+ 字面量数组做文本级替换是脆弱操作、会把"生成"变成"改真源"。
 *   ⇒ 生成器**只读**；快照更新由 CTO 在红线域执行（见治理线回执 §〇E 案 A ＋ CTO 裁定 078 一）。
 *
 * 取数方式（🔴 禁正则解析 TS）：
 *   真源里 K11/K12/RETIRED/K13 的定义带 `as BlockId` 断言（`id: 'K12' as BlockId, name: …`），
 *   按 `,` 和 `'` 写的正则会**漏掉这 4 块**（2026-10-13 实测：天真正则 10 块 vs 实际 14 块）
 *   ⇒ 只能 `import`。本文件的 `import` 是**唯一**取数入口。
 */
import { existsSync } from 'node:fs';
import { sourceImportSpec } from './block-paths-core.ts';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_OK,
  EXIT_UNJUDGEABLE,
  JSON_INDENT,
  computeBlockPaths,
  renderBlockPathsJson,
  type RegistryView,
} from './block-paths-core.ts';

/** 真源相对仓根的位置（🔴 唯一事实源，禁改） */
export const TRUE_SOURCE_REL = 'docs/synova/coordination/施工项登记.ts';

/** 从 cwd 逐级上溯定位仓根（判据：该目录下存在真源文件） */
export function locateRepoRoot(startDir: string = process.cwd()): string | null {
  if (process.env.SYNOVA_REPO_ROOT) {
    const cand = resolve(process.env.SYNOVA_REPO_ROOT);
    if (existsSync(join(cand, TRUE_SOURCE_REL))) return cand;
  }
  let cur = resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(cur, TRUE_SOURCE_REL))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

interface LoadResult {
  ok: boolean;
  view: RegistryView | null;
  /** 实际加载的文件（绝对路径） */
  sourcePath: string;
  error: string;
}

/**
 * 🔴 唯一取数入口：`import` 真源（或 `--source` 指定的夹具）。
 *
 * @contract
 *   @input  sourceArg = 绝对路径（CLI 已解析默认值）
 *   @output `{ok, view, sourcePath, error}`；`ok=false` 时 `error` 点名（哪条导出缺失 / 原始异常）
 *   @degraded import 失败 / 导出缺失 / 形状不符 ⇒ `ok=false`（调用方一律转 exit 2）
 */
export async function loadRegistryView(sourceArg: string): Promise<LoadResult> {
  const sourcePath = resolve(sourceArg);
  if (!existsSync(sourcePath)) {
    return { ok: false, view: null, sourcePath, error: `真源文件不存在：${sourcePath}` };
  }
  let mod: Record<string, unknown>;
  try {
    // 裁 422-R1：ESM specifier 必须 URL（Windows 绝对路径会被当协议 'd:'——组9 同族）
    mod = (await import(sourceImportSpec(sourcePath))) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, view: null, sourcePath, error: `import 真源失败：${msg}` };
  }
  const items = mod['constructionItems'];
  const blocks = mod['constructionBlocks'];
  const missing: string[] = [];
  if (items === undefined) missing.push('constructionItems');
  if (blocks === undefined) missing.push('constructionBlocks');
  if (missing.length > 0) {
    return {
      ok: false,
      view: null,
      sourcePath,
      error:
        `导出缺失：${missing.join(' + ')}（该文件不是登记件，或导出被改名）—— ` +
        `🔴 这正是"临时改名 ⇒ 必须 exit 2（不是 0）"的场景`,
    };
  }
  return {
    ok: true,
    view: { items: items as RegistryView['items'], blocks: blocks as RegistryView['blocks'] },
    sourcePath,
    error: '',
  };
}

/**
 * 把真源视图序列化成稳定 JSON（CLI 出口 `--json-raw`）。
 *
 * @why 测试需要"真源的数据"，而 import 真源**只允许发生在取数这一处**（约束①）。
 *      若让 vitest 自己 `import(真源.ts)`，Vite 会把它当源码打包 ⇒ 解析出无导出名的对象
 *      （实测：`view.blocks is not iterable`；`constructionBlocks` 为 undefined）。
 *      ⇒ 正解不是"在测试里再 import 一次"，而是**让测试走同一条取数出口**（本函数）：
 *        真源访问路径与门禁完全一致，且顺带把 CLI 取数链再验一遍。
 * @contract
 *   @input  view（已 import 的数据对象）
 *   @output 稳定 JSON 字符串：`{itemCount, blocks[{id,items,paths|null,computed}], items[{id,paths|null}]}`
 *           🔴 `paths: null` 表示**字段缺省**，与 `[]`（空数组）**区分开** —— 情境④要看得见这个差别
 *   @degraded 不适用（纯序列化）
 */
export function serializeViewForTests(view: RegistryView): string {
  // 🔴 用**同一函数**算现算并集。整体失败时（悬空 id / 形状异常 ⇒ ok=false）
  //   逐块回退为空数组，**但把错误一起输出** —— 序列化器不许因为"数据有问题"而崩，
  //   更不许把"有问题"静默成"空"（`diag` 一并带上，测试可断言）。
  const whole = computeBlockPaths(view);
  const computedByBlock = whole.ok ? whole.byBlock : {};
  const payload = {
    itemCount: view.items.length,
    ok: whole.ok,
    errors: whole.diag.errors,
    notes: whole.diag.notes,
    blocks: view.blocks.map((b) => ({
      id: b.id,
      items: [...b.items],
      paths: b.paths === undefined ? null : [...b.paths],
      computed: computedByBlock[b.id] ?? [],
    })),
    items: view.items.map((it) => ({
      id: it.id,
      paths: it.paths === undefined ? null : [...it.paths],
    })),
  };
  return JSON.stringify(payload, null, JSON_INDENT);
}

/** 解析 `--source`（默认真源；🔴 只在显式传参时走夹具） */
export function resolveSourceArg(argv: readonly string[]): { sourceArg: string; error: string } {
  const idx = argv.indexOf('--source');
  if (idx >= 0) {
    const val = argv[idx + 1];
    if (val === undefined || val === '' || val.startsWith('--')) {
      return { sourceArg: '', error: '`--source` 后面缺少路径参数' };
    }
    return { sourceArg: val, error: '' };
  }
  const root = locateRepoRoot();
  if (root === null) {
    return {
      sourceArg: '',
      error: `定位不到仓根（从 ${process.cwd()} 逐级上溯 12 层均无 ${TRUE_SOURCE_REL}）`,
    };
  }
  return { sourceArg: join(root, TRUE_SOURCE_REL), error: '' };
}

/** CLI 主体（🔴 显式导出：门禁 `check-block-paths.ts` 直接调它 ⇒ 生成器与门禁真的是"一份实现"） */
export async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const listMode = argv.includes('--list');
  /** 🔴 测试出口：输出"真源视图"（含逐块快照与现算、逐项 paths），供 vitest 走**同一条取数链**断言 */
  const rawMode = argv.includes('--json-raw');
  const { sourceArg, error } = resolveSourceArg(argv);
  if (error !== '') {
    process.stderr.write(`❌ 生成器判不了：${error}\n`);
    return EXIT_UNJUDGEABLE;
  }

  const loaded = await loadRegistryView(sourceArg);
  if (!loaded.ok || loaded.view === null) {
    process.stderr.write(`❌ 生成器判不了：${loaded.error}\n`);
    return EXIT_UNJUDGEABLE;
  }

  const computed = computeBlockPaths(loaded.view);
  for (const n of computed.diag.notes) process.stderr.write(`  ${n}\n`);
  if (!computed.ok) {
    for (const e of computed.diag.errors) process.stderr.write(`  ${e}\n`);
    process.stderr.write(
      `❌ 生成器判不了（exit 2）：${computed.diag.errors.length} 条形状/引用错误（fail-closed，禁空结果当通过）\n`,
    );
    return EXIT_UNJUDGEABLE;
  }

  process.stderr.write(
    `ⓘ 真源 = ${loaded.sourcePath}\n` +
      `ⓘ ${computed.itemCount} 项 / ${computed.blockCount} 块 —— 块级路径视图已算出（排序=纯码点序）\n`,
  );

  if (listMode) {
    const lines: string[] = [];
    for (const key of Object.keys(computed.byBlock).sort()) {
      const paths = computed.byBlock[key] as string[];
      lines.push(`${key}\t${paths.length}\t${JSON.stringify(paths)}`);
    }
    process.stdout.write(lines.join('\n') + '\n');
  } else if (rawMode) {
    // 🔴 测试出口：走**同一条取数链**（禁让测试自己再 import 一次真源）
    process.stdout.write(serializeViewForTests(loaded.view) + '\n');
  } else {
    process.stdout.write(renderBlockPathsJson(computed.byBlock) + '\n');
  }
  return EXIT_OK;
}

// 仅在作为 CLI 直接执行时跑 main（被 import 时不自动执行 —— 测试要 import 上面的纯函数）
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
      process.stderr.write(`❌ 生成器自身异常（exit 2）：${msg}\n`);
      process.exit(EXIT_UNJUDGEABLE);
    });
}
