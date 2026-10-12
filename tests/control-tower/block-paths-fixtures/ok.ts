/**
 * 夹具 · `ok` —— **基线**（与真源同构的小号登记件）
 *
 * @why 本目录的夹具是「`--source <fixture>` 走真 CLI 全链路」这条判据的输入：
 *      情境⑤（悬空 id）/④（`paths` 缺省）/⑧（含空格·单引号的路径）在**现真源上取不到样本**，
 *      只能合成。而"合成数据是否真走了 CLI 那条 `import` 路径"是自证风险（V-07 假绿同族）
 *      ⇒ 一律经 `--source` 从**真 CLI** 读，而不是在测试里直接构造对象。
 *
 * 形态（刻意与真源同构：`items[].paths` / `blocks[].paths` 两处都在）:
 *   · 2 块：`FX-A`（2 项）/ `FX-B`（1 项）
 *   · 块级 `paths` = 各块 `items[].paths` 并集（去重 + 码点序）⇒ **一致** ⇒ 门禁应 exit 0
 */
export interface FxItem {
  id: string;
  paths?: string[];
}
export interface FxBlock {
  id: string;
  items: string[];
  paths?: string[];
}

export const constructionItems: readonly FxItem[] = [
  { id: 'a-1', paths: ['src/a.ts', 'tests/a.test.ts'] },
  { id: 'a-2', paths: ['src/a.ts', 'docs/提案/'] },
  { id: 'b-1', paths: ['src/b.ts'] },
];

export const constructionBlocks: readonly FxBlock[] = [
  { id: 'FX-A', items: ['a-1', 'a-2'], paths: ['docs/提案/', 'src/a.ts', 'tests/a.test.ts'] },
  { id: 'FX-B', items: ['b-1'], paths: ['src/b.ts'] },
];
