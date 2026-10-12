/**
 * 夹具 · `mismatch-items` —— **负向 N1**：改一条 `item.paths`（块级快照不动）⇒ 门禁必须 exit 1
 *
 * 与 `ok.ts` 的**唯一差别**：`a-1.paths` 多了 `src/a-new.ts`（快照里没有）。
 * 🔴 用夹具而非真改登记件：登记件是 CTO 红线，且改文件会污染工作区、无法在 CI 复跑。
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
  { id: 'a-1', paths: ['src/a.ts', 'tests/a.test.ts', 'src/a-new.ts'] },
  { id: 'a-2', paths: ['src/a.ts', 'docs/提案/'] },
  { id: 'b-1', paths: ['src/b.ts'] },
];

export const constructionBlocks: readonly FxBlock[] = [
  { id: 'FX-A', items: ['a-1', 'a-2'], paths: ['docs/提案/', 'src/a.ts', 'tests/a.test.ts'] },
  { id: 'FX-B', items: ['b-1'], paths: ['src/b.ts'] },
];
