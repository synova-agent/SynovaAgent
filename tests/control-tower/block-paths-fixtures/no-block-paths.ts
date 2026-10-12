/**
 * 夹具 · `no-block-paths` —— **负向 N3b**：块级 `paths` 字段**整体缺失** ⇒ 门禁必须 exit **2**（判不了）
 *
 * @why 这是"上游未合时"的真实形态（实测 `5a6591c4a` / `gitea/main` 上 12 块全无 `paths` 键）。
 *      判"判不了"而非"不一致"的理由：字段缺失 = **被检对象尚未入真源**，此时"不一致"一词没有对象可比
 *      （fail-closed 归 2）。副作用（有意）：本门禁在未被上游覆盖的分支上**不会红**，只会明确报判不了。
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
  { id: 'a-1', paths: ['src/a.ts'] },
];

// 🔴 注意：这里**故意**不写 `paths` 键
export const constructionBlocks: readonly FxBlock[] = [{ id: 'FX-NOPATHS', items: ['a-1'] }];
