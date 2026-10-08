# #1045 补项：施工项登记 K10/K4 块补 7 个登记项

#CRITERIA: A

## Q0:
定位：CTO 域（施工项登记.ts 自述「CTO 域」）。
背景：新立卡 #1454/#1463-#1467（K10）与 #1455（K4）来源为 边界C/规范 v0.1/烟测断点，
在登记件（判据的机器可读源）无对应施工项 ⇒ Win 执行/K3 审计/CTO 验收三读断链。
创始人 2026-10-09 明令补足。

## Q1:
调研：已逐字核 AcceptanceStep/ConstructionItem 接口与 3-10/3-11 既有条目形态；
判据交付物（probe/测试）按「本卡创建」先例列入 paths（INV-3 合规）。

## Q2:
做什么：
- docs/synova/coordination/施工项登记.ts（+7 项：B-RUNTIME/B3B7/BS-5/EXT-WIRE/BC-CLEAN/BS-6/B2-GRAPH；
  K10 items 数组同步 +6；K4 items 追加 B2-GRAPH；BS-6 status=proposal【待创始人裁 A/B】）
- .claude/claims/1045.yaml + 本 brief
不做什么（含文件路径）：
- 不改任何 src/**、.github/**、scripts/control-tower/**（判据交付物由对应执行卡创建，本件只登记）

## Q3:
入口：git show origin/main:docs/synova/coordination/施工项登记.ts
处理：TS 数据模块插入 7 个 ConstructionItem（含 sharedWrite 两处：EXT-WIRE×0-12、B2-GRAPH×1-10）
结果：constructionItems 49→56；K10 块 1→7 条；K4 +1；导入验证全过（新 id 7/7）

## 架构层:
CTO 治理层（登记件）——不触 L1-L5 运行时

## Done 标准
- [x] 7 个新 id 全部在 constructionItems 且被 K10/K4 items 引用 verify: npx tsx 导入打印（7/7）
- [x] TS 模块可导入且导出结构不变（constructionBlocks 12/items 56/deriveBlockDeps 等 5 键） verify: 同上
- [x] BS-6 为 proposal 状态（未裁不派） verify: 导入打印 status
