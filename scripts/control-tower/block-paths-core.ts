/**
 * scripts/control-tower/block-paths-core.ts — 块级 `paths` 生成/对账的**唯一实现**（CTO 裁定 074 步 1b）
 *
 * @why  「包管哪些路径」= `ConstructionBlock.paths`（快照），来源是 `blocks[].items[].paths` 的并集。
 *       快照是**手工跑脚本写死**的 ⇒ 施工项一变（如加 K3-13…K3-17）那一栏就过时。
 *       本件给两个能力：① **能一键重算**（生成器）② **能对账**（门禁：字段里的 vs 现算的 ⇒ 不一致就红）。
 *
 * @契约（铁律 47）
 *   @input   — `RegistryView`（= 已经 `import` 进来的 `{items, blocks}` 数据对象）。
 *              🔴 **本模块不在内部 import 真源**：取数在 CLI 入口（`gen-block-paths.ts`），
 *              这样 ① 可注入合成数据造"真源里不存在的形态"（悬空 id / `paths` 缺省 / 含空格路径）
 *              ② `import` 真源这条路仍只有一条（约束①：禁正则解析 TS）。
 *   @output  — `computeBlockPaths()` ⇒ `{ ok, exit, byBlock, diag }`（纯数据，不打印）
 *              `compareBlockPaths()` ⇒ `{ exit, ok, diffs, diag }`
 *   @degraded — 🔴 **fail-closed**：判不了 ⇒ `exit = 2`，**绝不"空结果当通过"**。
 *               任何形状异常（导出缺失 / 块 id 重复 / 悬空 item id / paths 形态非法）
 *               一律归 2，并在 `diag.errors` 里**点名**（不静默跳过、不静默降级）。
 *   @exit    — **三态（D328 / ctrl-tower-change 模式 1）**：
 *               `0` = 一致（快照 === 现算，逐字节）
 *               `1` = 不一致（两边都在但内容不同：多 / 少 / 顺序不同）
 *               `2` = **判不了**（读不到真源 / 导出缺失 / 形状不符 / 悬空 id / 快照字段缺失）
 *
 * 🔴 三条"这是稳当的实质"的实现约束（违反即回到同一个坑）
 *   ① **禁正则解析 TS**：真源里 K11/K12/RETIRED/K13 的定义带 `as BlockId` 断言
 *      （`id: 'K12' as BlockId, name: …`），按 `,` 和 `'` 写的正则会**漏掉这 4 块**
 *      （2026-10-13 实测：天真正则命中 10 块，实际 14 块）⇒ 只能 `import`。
 *      本模块的取数由 CLI 用 `import` 完成；回归防线见
 *      `tests/control-tower/block-paths-core.test.ts` 情境⑨。
 *   ② **禁从块级 `paths` 字段取数**（那是自证：拿快照验快照）。真值**只有一个来源**：
 *      `blocks[].items[].paths` 的并集 —— 块级 `paths` 只当**被检对象**。
 *   ③ **通配符按字符串处理，不做路径规范化**：
 *      `extensions/` ／ `extensions/adapters/` ＋ 双星 ／ `extensions/` ＋ 双星 ＋ `/manifest.json`
 *      是**三条不同路径**（三条字面量原样见真源 K12 快照）。
 *      🔴 **本行原先写字面量时，其中的 `*` `/` 组合把本块注释提前终结了** ——
 *         esbuild 报 `Expected ";" but found "localeCompare"`（**报错点在第 37 行、真因在第 32 行**），
 *         是铁律 45 的活标本 ⇒ 故此处**不写字面量**，改用拼接描述。
 *      ⇒ **禁合并**（合并会改并集）；⇒ **禁**调登记件里已有的 normalizePath()（它去行号与前缀，同样会改并集）。
 *
 * 🔴 排序口径（写死，禁改 —— 判据④"同输入逐字节相同"的承重件）
 *   **纯码点序**：比较器 (a, b) 返回 (a < b ? -1 : a > b ? 1 : 0)
 *   为什么不选 `localeCompare`：它依赖 locale / ICU，跨机（macOS / Windows / Linux）可能给出不同序 ⇒ 不满足"逐字节相同"。
 *   实证（2026-10-13 真源）：K10 快照前 4 条 = `.dsh/` → `.gitignore` → `Dockerfile` → `app/**`（**码点序**，大写先）；
 *   而 `localeCompare` 给出 `.dsh/` → `.gitignore` → `app/**` → `Dockerfile` ⇒ **两者不同**。
 *   ⇒ 选码点序**零代价**（与 CTO 已写入真源的快照序一致）；选 `localeCompare` 会制造 14 块全红。
 *   🔴 **禁依赖 `Set` 插入序**（那是引擎实现细节，不是契约）：本模块用 `Set` 只为去重，排序一律走上面的码点比较器。
 */

/** 退出码三态（🔴 具名常量，禁在调用点写裸数字） */
import { pathToFileURL } from 'node:url';

/**
 * 真源 import 规约（裁 422-R1，组9 同族）：ESM 动态 import 的 specifier 必须是 URL——
 * Windows 绝对路径（`d:\\...`）会被解析成协议（"Received protocol 'd:'"）⇒ 先归一反斜杠再 pathToFileURL。
 * @input  **绝对** OS 路径（CLI 侧已 resolve；Windows 形态在 posix 上也可判——按相对处理，产物仍是合法无反斜杠 URL）
 * @output file:// URL 字符串（空格等特殊字符已百分号编码；恒无反斜杠）
 * @exit   纯函数不退出
 * @degraded 无（不可编码路径由 Node 抛 TypeError，由调用方 loadRegistryView 转 ok=false 点名，不静默）
 */
export function sourceImportSpec(p: string): string {
  return pathToFileURL(p.replace(/\\/g, '/')).href;
}

export const EXIT_OK = 0;
export const EXIT_MISMATCH = 1;
export const EXIT_UNJUDGEABLE = 2;

/** 稳定的 JSON 缩进（判据④"逐字节相同"的一部分：格式也必须写死） */
export const JSON_INDENT = 2;

/** 真源里"施工项"里本模块要用到的字段（宽松声明：真源字段多于此，这里只取所需） */
export interface RegistryItemLike {
  /** 人类可读别名（真源主键仍以 `issue` 为准；引用用 `id`） */
  id: string;
  /** 🔴 真值来源。真源类型是必填 `paths: string[]`，但**运行时可能是 `undefined`**（老数据 / 合成夹具）
   *  ⇒ 本模块按契约"缺省按 `[]` 处理，不崩"处理（情境④）。 */
  paths?: readonly string[] | undefined;
}

/** 真源里"块"里本模块要用到的字段 */
export interface RegistryBlockLike {
  id: string;
  /** 覆盖的施工项 id 列表 */
  items: readonly string[];
  /** 🔴 **被检对象**（不是真值来源）。真源写入前该字段不存在 ⇒ 判"判不了"（exit 2），**不是**"不一致"。 */
  paths?: readonly string[] | undefined;
}

/**
 * 登记件视图 —— 本模块的**唯一入参形态**。
 * 🔴 用宽松接口而非 `import` 真源类型：① 上游 `paths` 字段尚未落 main 时本模块仍可独立编译
 *    ② 合成夹具（`tests/control-tower/fixtures/block-paths/*.ts`）能合法注入。
 *    真源的运行时形状由 `validateRegistryView()` 兜住（fail-closed）。
 */
export interface RegistryView {
  items: readonly RegistryItemLike[];
  blocks: readonly RegistryBlockLike[];
}

/** 诊断信息（**点名**用：谁不可判、为什么） */
export interface BlockPathsDiag {
  /** 致命错误（非空 ⇒ 判不了 ⇒ exit 2）。每条都点名（块 id / item id / 路径 / 字段名）。 */
  errors: string[];
  /** 非致命观察（如"有几项缺 paths 字段"），打印但不改判定 */
  notes: string[];
}

/** `computeBlockPaths()` 的返回 */
export interface ComputeResult {
  /** 计算本身是否成功（false ⇒ exit 2） */
  ok: boolean;
  exit: number;
  /** 🔴 每块的**现算并集**（去重 + 码点序）。`ok=false` 时内容不保证可用。 */
  byBlock: Record<string, string[]>;
  /** 现算用到的 item 数（供报告） */
  itemCount: number;
  blockCount: number;
  diag: BlockPathsDiag;
}

/** 单块的差异明细（`compareBlockPaths()` 用） */
export interface BlockDiff {
  blockId: string;
  /** 快照里有、现算没有 */
  onlyInSnapshot: string[];
  /** 现算有、快照没有 */
  onlyInComputed: string[];
  /** 集合相同但**顺序不同**（同一批元素，两种排列）—— 单独点名，因为这是"排序口径漂了"而非"内容漂了" */
  orderOnlyDiffer: boolean;
}

/** `compareBlockPaths()` 的返回 */
export interface CompareResult {
  exit: number;
  ok: boolean;
  /** 逐块差异（仅不一致的块；一致块不入列） */
  diffs: BlockDiff[];
  diag: BlockPathsDiag;
}

/** 🔴 码点序比较器（**写死**，见文件头"排序口径"）。禁换成 `localeCompare`。 */
export function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 去重 + 码点序（🔴 唯一排序出口；`Set` 只用于去重，序不依赖它） */
export function dedupSort(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort(compareCodePoint);
}

/**
 * 真源形状校验（fail-closed）。
 *
 * @why 门禁的失败模式之一是"读到的东西形状不对，于是算出一个空结果并当作通过"。
 *      本函数把这类情况**全部归到 exit 2**，并逐条点名。
 * @contract
 *   @input  view（`{items, blocks}`，运行时对象，可能是任意形状）
 *   @output 错误清单（空数组 = 形状可用）
 *   @degraded 不适用（纯校验，无失败路径 —— 校验本身不抛）
 */
export function validateRegistryView(view: unknown): string[] {
  const errors: string[] = [];
  if (view === null || typeof view !== 'object') {
    return ['真源形状不符：视图不是对象'];
  }
  const v = view as { items?: unknown; blocks?: unknown };
  if (!Array.isArray(v.items)) errors.push('真源形状不符：缺少 `constructionItems` 数组（导出缺失或改名）');
  if (!Array.isArray(v.blocks)) errors.push('真源形状不符：缺少 `constructionBlocks` 数组（导出缺失或改名）');
  if (errors.length > 0) return errors;

  const items = v.items as unknown[];
  const blocks = v.blocks as unknown[];

  const seenItem = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as { id?: unknown } | null;
    if (it === null || typeof it !== 'object') {
      errors.push(`constructionItems[${i}] 不是对象`);
      continue;
    }
    if (typeof it.id !== 'string' || it.id === '') {
      errors.push(`constructionItems[${i}] 缺 id 或 id 非字符串`);
      continue;
    }
    if (seenItem.has(it.id)) errors.push(`item id 重复：\`${it.id}\``);
    seenItem.add(it.id);
  }

  const seenBlock = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as { id?: unknown; items?: unknown } | null;
    if (b === null || typeof b !== 'object') {
      errors.push(`constructionBlocks[${i}] 不是对象`);
      continue;
    }
    if (typeof b.id !== 'string' || b.id === '') {
      errors.push(`constructionBlocks[${i}] 缺 id 或 id 非字符串`);
      continue;
    }
    if (seenBlock.has(b.id)) errors.push(`🔴 块 id 重复：\`${b.id}\``);
    seenBlock.add(b.id);
    if (!Array.isArray(b.items)) errors.push(`块 \`${b.id}\` 的 items 不是数组`);
  }

  return errors;
}

/** 单条路径的形态校验（与登记件 `isModuleShape()` 同族：必须相对、非空；本件**不做规范化**，只判非法） */
function pathShapeErrors(blockId: string, itemId: string, path: unknown, idx: number): string[] {
  const out: string[] = [];
  if (typeof path !== 'string') {
    out.push(`块 \`${blockId}\` ← item \`${itemId}\` 的 paths[${idx}] 不是字符串`);
    return out;
  }
  if (path.trim() === '') {
    out.push(`块 \`${blockId}\` ← item \`${itemId}\` 的 paths[${idx}] 是空串`);
  }
  if (path.startsWith('/')) {
    out.push(`块 \`${blockId}\` ← item \`${itemId}\` 的 paths[${idx}] 是绝对路径：\`${path}\``);
  }
  if (path.includes('..')) {
    out.push(`块 \`${blockId}\` ← item \`${itemId}\` 的 paths[${idx}] 含 \`..\`：\`${path}\``);
  }
  return out;
}

/**
 * 🔴 现算：`blocks[].items[].paths` 的并集（去重 + 码点序）。
 *
 * @contract
 *   @input  view = `{items, blocks}`（已 import 进来的数据对象）
 *   @output `{ok, exit, byBlock, itemCount, blockCount, diag}`
 *   @degraded 任一形状异常 ⇒ `ok=false` + `exit=EXIT_UNJUDGEABLE(2)` + `diag.errors` 点名
 *   @exit    0 = 算出来了 ｜ 2 = 判不了（本函数**不返回 1** —— "不一致"是 `compareBlockPaths()` 的语义）
 *
 * 🔴 与 `施工项登记.ts:deriveBlockDeps()` 的**语义分叉（有意为之，禁"照着抄"）**：
 *   真源里 `deriveBlockDeps()` 对悬空 id 写的是 `if (!it) continue;` —— **静默跳过**。
 *   🔴 **本函数必须相反**：悬空 id ⇒ **判不了（exit 2）**，因为"并集少了一条"与"并集本来就少"
 *   在结果上**长得一模一样** ⇒ 静默跳过 = 把"看不见"当"没问题"（正是本件要治的病）。
 *   依据：CTO 派单 §四⑤＋ CTO 裁定 078 ④（"那正是新会话会照抄的地方"）。
 *   改动本分支前先读这段：它不是笔误，是与真源既有实现**有意不同**。
 */
export function computeBlockPaths(view: RegistryView): ComputeResult {
  const diag: BlockPathsDiag = { errors: [], notes: [] };

  const shapeErrors = validateRegistryView(view);
  if (shapeErrors.length > 0) {
    diag.errors.push(...shapeErrors);
    return { ok: false, exit: EXIT_UNJUDGEABLE, byBlock: {}, itemCount: 0, blockCount: 0, diag };
  }

  const items = view.items as readonly RegistryItemLike[];
  const blocks = view.blocks as readonly RegistryBlockLike[];

  const byId = new Map<string, RegistryItemLike>();
  for (const it of items) byId.set(it.id, it);

  const byBlock: Record<string, string[]> = {};
  let itemsWithoutPaths = 0;
  let danglingCount = 0;

  for (const b of blocks) {
    const collected: string[] = [];
    for (const itemId of b.items) {
      const it = byId.get(itemId);
      if (it === undefined) {
        // 🔴 悬空引用 ⇒ 判不了（禁静默跳过 —— 见上方"语义分叉"）
        diag.errors.push(`🔴 悬空引用：块 \`${b.id}\` 的 items 引用了不存在的 item id \`${itemId}\``);
        danglingCount++;
        continue;
      }
      const paths = it.paths;
      if (paths === undefined) {
        // 情境④：paths 缺省 ⇒ 按 [] 处理，不崩；但**要看得见**
        itemsWithoutPaths++;
        continue;
      }
      if (!Array.isArray(paths)) {
        diag.errors.push(`块 \`${b.id}\` ← item \`${itemId}\` 的 \`paths\` 不是数组`);
        continue;
      }
      for (let i = 0; i < paths.length; i++) {
        const errs = pathShapeErrors(b.id, itemId, paths[i], i);
        if (errs.length > 0) diag.errors.push(...errs);
      }
      collected.push(...(paths as readonly string[]).filter((p) => typeof p === 'string'));
    }
    byBlock[b.id] = dedupSort(collected);
  }

  if (itemsWithoutPaths > 0) {
    diag.notes.push(`ⓘ ${itemsWithoutPaths} 个 item 缺 \`paths\` 字段 ⇒ 按 \`[]\` 处理（不崩，但已点名）`);
  }
  if (danglingCount > 0) {
    diag.errors.push(`🔴 共 ${danglingCount} 处悬空引用 ⇒ 并集不可信 ⇒ 判不了（exit 2）`);
  }

  const ok = diag.errors.length === 0;
  return {
    ok,
    exit: ok ? EXIT_OK : EXIT_UNJUDGEABLE,
    byBlock,
    itemCount: items.length,
    blockCount: blocks.length,
    diag,
  };
}

/**
 * 🔴 对账：块级 `paths`（快照，**被检对象**）vs 现算并集（真值）。
 *
 * @contract
 *   @input  view = `{items, blocks}`
 *   @output `{exit, ok, diffs, diag}`；`diffs` 仅含不一致的块
 *   @degraded 现算判不了 ⇒ 直接 2；**快照字段整体缺失** ⇒ 2（判不了：被检对象还没入真源）
 *   @exit    **三态**：0 = 14 块逐块一致 ｜ 1 = 有差异（至少一块） ｜ 2 = 判不了
 *
 * 🔴 "快照字段缺失 ⇒ 2 而非 1"的理由：字段缺失意味着**被检对象尚未入真源**（上游未合 / 老真源），
 *   此时"不一致"这个词没有意义（没有东西可比）⇒ 按 fail-closed 归"判不了"。
 *   副作用（有意）：本门禁在未被上游覆盖的分支上**不会红**，只会明确报"判不了"。
 */
export function compareBlockPaths(view: RegistryView): CompareResult {
  const computed = computeBlockPaths(view);
  if (!computed.ok) {
    return { exit: EXIT_UNJUDGEABLE, ok: false, diffs: [], diag: computed.diag };
  }

  const blocks = view.blocks as readonly RegistryBlockLike[];
  const missingSnapshot = blocks.filter((b) => b.paths === undefined).map((b) => b.id);
  if (missingSnapshot.length > 0) {
    computed.diag.errors.push(
      `🔴 块级 paths 字段缺失 ⇒ 判不了（被检对象尚未入真源，非"不一致"）：` +
        `${missingSnapshot.join(', ')}（共 ${missingSnapshot.length}/${blocks.length} 块）`,
    );
    return { exit: EXIT_UNJUDGEABLE, ok: false, diffs: [], diag: computed.diag };
  }

  const diffs: BlockDiff[] = [];
  for (const b of blocks) {
    const snapshot = b.paths as readonly string[];
    const computedPaths = computed.byBlock[b.id] ?? [];
    const snapSet = new Set(snapshot);
    const compSet = new Set(computedPaths);
    const onlyInSnapshot = dedupSort([...snapSet].filter((p) => !compSet.has(p)));
    const onlyInComputed = dedupSort([...compSet].filter((p) => !snapSet.has(p)));
    const setEqual = onlyInSnapshot.length === 0 && onlyInComputed.length === 0;
    // 集合相同也要查顺序：排序口径漂了同样是"不一致"（否则判据④失去防线）
    const orderOnlyDiffer = setEqual && JSON.stringify(snapshot) !== JSON.stringify(computedPaths);
    if (!setEqual || orderOnlyDiffer) {
      diffs.push({ blockId: b.id, onlyInSnapshot, onlyInComputed, orderOnlyDiffer });
    }
  }

  const exit = diffs.length === 0 ? EXIT_OK : EXIT_MISMATCH;
  return { exit, ok: diffs.length === 0, diffs, diag: computed.diag };
}

/** 块级路径视图 → 稳定 JSON（🔴 键按码点序排，保证"同输入逐字节相同"） */
export function renderBlockPathsJson(byBlock: Record<string, string[]>): string {
  const ordered: Record<string, string[]> = {};
  for (const key of Object.keys(byBlock).sort(compareCodePoint)) {
    ordered[key] = byBlock[key] as string[];
  }
  return JSON.stringify(ordered, null, JSON_INDENT);
}
