/**
 * 夹具 · `no-paths-field` —— **情境④**：某 item **缺 `paths` 字段** ⇒ 按 `[]` 处理，**不崩**
 *
 * @why 现真源实测 89 项**全部带 `paths`**（其中 17 项是空数组）⇒ 真源取不到"字段缺省"这个样本。
 *      本夹具同时覆盖情境⑧的字符面：路径含**空格 / 单引号 / 非 ASCII**。
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
  // 🔴 无 `paths` 键 ⇒ 按 []（不崩、不静默：core 会在 notes 里点名）
  { id: 'n-1' },
  // 含空格 / 单引号 / 非 ASCII 的路径 ⇒ 必须**原样**进结果（禁规范化）
  { id: 'n-2', paths: ['dir with space/x.ts', "it's/a.ts", '提案/子目录/'] },
];

export const constructionBlocks: readonly FxBlock[] = [
  {
    id: 'FX-NOPATHSFIELD',
    items: ['n-1', 'n-2'],
    // 码点序：'dir with space/x.ts' < 'it\'s/a.ts' < '提案/子目录/'
    paths: ["dir with space/x.ts", "it's/a.ts", '提案/子目录/'],
  },
];
