# 域守则 3 处硬冲突更正（卸需重启／bundle 不可装载／交付配套件默认可写）

状态: implemented
日期: 2026-10-18

## 一句话

12 份域级 AGENTS.md 是 MVP 之前的版本；本次先修**会误导执行的 3 处硬冲突**，其余 9 份的 as_of 与增量归 P6。

## 问题

创始人 2026-10-18：「**12 份域守则也是旧版了吧，你仔细读一下和我们现在 MVP 阶段要做的事情是否一致？**」
逐份读完后确认 **3 处硬冲突**（不是措辞新旧，是**会让人做错**）：

1. **`extensions/sentinels/AGENTS.md` 写"卸＝移 `_extinct/`＋重扫"** —— 实测 `content-reload.ts` **无 `unregister` 逻辑**
   ⇒ **重扫不卸，必须重启**（裁定 167-U2）。不修则每个包都会照做并发现"没卸掉"。
2. **`extensions/AGENTS.md` 完全没提"bundle/桌面/容器形态内容面不可装载"** —— 实测同 SHA 只换形态：
   dev `registered=46/total=50` ｜ **bundle 5** ｜ **桌面 0** ｜ **容器 0**（裁定 161）。
   不修则包会以为"加目录就生效"，而客户形态根本不生效。
3. **`memory/notes/AGENTS.md` 缺"交付配套件默认可写"** —— 裁 168-C 已定 `memory/notes/**` 与
   `.claude/task-briefs/**` 属门禁触发的配套件，**默认可写、不必逐次报批**；不写则每张卡都要来问 CTO。

## 决定

只修这 3 处硬冲突（+ 顺带更正哨兵数 47→**48 目录/46 有效**、as_of → `3ab277c44`）；
**其余 9 份的 as_of 与增量归 P6（事实与入口件）**，不在此 PR 里一次改 12 份。

## 依据

- 裁定 161（bundle 形态复现矩阵）／167（U1 数据卫生、U2 卸不生效、U4 容器未核）／168-C（交付配套件）／163（E=46）
- 实测：`git show gitea/local-main:<path>`；`git ls-tree -d extensions/sentinels/` = 48 目录

## 生效时点

本 commit 起。
