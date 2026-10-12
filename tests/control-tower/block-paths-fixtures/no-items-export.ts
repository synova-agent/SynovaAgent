/**
 * 夹具 · `no-items-export` —— **负向 N3**：让 `constructionItems` **import 失败**（导出被改名）
 * ⇒ 门禁必须 exit **2**（**不是 0**）
 *
 * @why 派单 §四负向第 3 条原文：「让 `constructionItems` import 失败（如临时改名）⇒ 门禁 **exit 2**（不是 0）」。
 *      这是"读不到真源"的最小复现：门禁若把"取不到数"当成"空并集"⇒ 会得出"全都一致"的假绿。
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

/** 🔴 改名的导出（`constructionItems` 这个名字在本文件里**不存在**） */
export const constructionItemsRenamed: readonly FxItem[] = [{ id: 'a-1', paths: ['src/a.ts'] }];

export const constructionBlocks: readonly FxBlock[] = [
  { id: 'FX-RENAMED', items: ['a-1'], paths: ['src/a.ts'] },
];
