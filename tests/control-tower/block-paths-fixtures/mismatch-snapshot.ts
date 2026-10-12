/**
 * 夹具 · `mismatch-snapshot` —— **负向 N2**：删一条**块级** `paths` 条目 ⇒ 门禁必须 exit 1
 *
 * 与 `ok.ts` 的**唯一差别**：`FX-A.paths` 少了 `tests/a.test.ts`（item 侧不动）。
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
  { id: 'FX-A', items: ['a-1', 'a-2'], paths: ['docs/提案/', 'src/a.ts'] },
  { id: 'FX-B', items: ['b-1'], paths: ['src/b.ts'] },
];
