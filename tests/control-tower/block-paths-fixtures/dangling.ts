/**
 * 夹具 · `dangling` —— **情境⑤**：`items` 引用了不存在的 item id ⇒ 门禁必须 exit **2**
 *
 * @why 现真源实测**悬空 0 处** ⇒ 取不到真样本，只能合成。
 * 🔴 且这是**本件最容易被照抄写错的地方**：真源同一文件里 `deriveBlockDeps()`
 *   （`施工项登记.ts:2405`，判定在 `:2412`）对悬空 id 写的是 `if (!it) continue;` = **静默跳过**。
 *   ⇒ 本夹具锁住**相反**的语义：悬空 ⇒ 判不了（因为"并集少了一条"与"并集本来就少"结果上长得一样，
 *     静默跳过 = 把"看不见"当"没问题"）。
 *
 * 形态：`FX-DANGLE` 引用 `ghost-99`（不存在），同时其块级 `paths` 与"跳过 ghost-99 后的并集"**恰好一致**
 *   ⇒ 若门禁静默跳过，它会**假绿**（这正是本夹具要杀的假绿）。
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

export const constructionItems: readonly FxItem[] = [{ id: 'a-1', paths: ['src/a.ts'] }];

export const constructionBlocks: readonly FxBlock[] = [
  // 🔴 快照刻意 = "跳过 ghost-99 之后的并集" ⇒ 静默跳过 ⇒ exit 0（假绿）；正确语义 ⇒ exit 2
  { id: 'FX-DANGLE', items: ['a-1', 'ghost-99'], paths: ['src/a.ts'] },
];
