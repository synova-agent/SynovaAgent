---
状态: proposed
日期: 2026-10-13
决策: 块级 `paths` 快照配「生成器 + 对账门禁」（CTO 裁定 074 步 1b / 078 放行）；判定三态 0=一致 / 1=不一致 / 2=判不了（fail-closed）；排序口径写死纯码点序；生成器与门禁共用 block-paths-core.ts 一份实现
理由: 真源 `ConstructionBlock.paths` 是手工跑脚本写死的并集快照 ⇒ 施工项一变即过时（2026-10-13 实测漂移 2/14 块）；且"悬空 item id"在本仓已有**静默跳过**的先例（deriveBlockDeps:2412），必须用 fail-closed 把它挡住
---

# Note: 块级 `paths` 生成器 ＋ 对账门禁（CTO 裁定 074 步 1b）

## 触发场景

真源 `docs/synova/coordination/施工项登记.ts` 的 `ConstructionBlock.paths`（= 该块 items 的
`paths` 并集，供"包管哪些路径"外部引用）是 **CTO 手工跑脚本算出来写死的**。
施工项一变（如 2026-10-13 加 K3-13…K3-17）那一栏就过时。

## 实测证据（本件的第一个战功）

复跑 `ct/block-paths@7f5d0d53e` 的 14 块 ⇒ **12 块一致、K10 / K12 不一致**：

```
XX K10  items=9  union=35  snap=31   ← 少 D48/D50 的 4 条（= PR #493 落地前的 7 项口径）
XX K12  items=21 union=53  snap=55   ← 多 K12-14 清空前的 2 条残留
```

根因（git 实测，非推测）：**生成快照时读到的是 PR #493 落地前的旧真源**。
`16c40d77d`（PR #493，00:58:07）同时做了两件事：D48/D50 入册且 `K10.items` 加至 9 项、
`K12-14` 的 paths 清空（CTO 裁定 062）。合入后真源 = K10=35 / K12=53。
CTO 已按此修正并推 `ct/block-paths@e095b2689`（本件判据①的新锚）。

## 决策

- **取数**：`import { constructionItems, constructionBlocks }`（**禁正则解析 TS**）
  — 真源里 K11/K12/RETIRED/K13 的定义带 `as BlockId` 断言，天真正则只命中 **10 块**（实测），实际 **14 块**
- **真值**：`blocks[].items[].paths` 的并集。块级 `paths` **只当被检对象**（禁拿快照验快照）
- **排序**：**纯码点序**（写死）。不用 `localeCompare`（依赖 locale/ICU，跨机不稳定；实证 K10 上两者序不同）
- **通配符**：按字符串原样处理，**禁规范化/合并**（`extensions/` ≠ `extensions/adapters/**`）
- **三态**：`0` 一致 ｜ `1` 不一致 ｜ **`2` 判不了**（读不到真源/导出缺失/形状不符/悬空 id/块级 `paths` 字段缺失）
  - 🔴 "快照字段缺失"归 **2** 而非 1：字段缺失 = 被检对象尚未入真源，此时"不一致"无对象可比
- **一份实现**：`block-paths-core.ts` 两纯函数 + 三个调用方（生成器 CLI / 门禁 CLI / 测试）；
  门禁**壳**（`check-block-paths.sh`）零判定逻辑（配对测试反证：壳内无 sort/Set/localeCompare）

## 🔴 与既有代码的**有意分叉**（最容易被照抄写错处）

真源同一文件 `施工项登记.ts:2405 deriveBlockDeps()`，在 `:2412` 对悬空 id 写的是
`if (!it) continue;` = **静默跳过**。本件的 `computeBlockPaths()` **必须相反**：
悬空 ⇒ **判不了（exit 2）**。理由：并集"少了一条"与"本来就没有"在结果上**长得一模一样**
⇒ 静默跳过 = 把"看不见"当"没问题"（正是本件要治的病）。
core 该分支上已写指名注释；配对测试用夹具 `dangling.ts`（其快照刻意 = "跳过后的并集"，
静默跳过的实现会**假绿**）锁住该语义。

## 实现踩坑（供下一位）

1. 🔴 **铁律 45 的活标本**：core 注释里写 `extensions/**/manifest.json` 字面量 ⇒
   其中 `*` `/` 组合**提前终结块注释** ⇒ esbuild 报 `Expected ";" but found "localeCompare"`
   （**报错点 37 行、真因 32 行**）。修法：注释里不写字面量，改用拼接描述 + 留痕。
2. 🔴 **worktree 不共用 node_modules**：门禁壳须**上溯 5 级**找 `node_modules/.bin/tsx`。
3. 🔴 **裸环境 PATH 无 node**：`node_modules/.bin/tsx` 是 `#!/usr/bin/env node` 的 JS 启动器 ⇒
   直接执行得 **exit 127**（`env: node: No such file or directory`，第一版实跑就是这个错）。
   修法：壳里**先探测可用 node**（PATH → 上溯 → `$HOME/.nvm/versions/node/*/bin` 版本降序），
   且**真跑一次 `node -v`/`tsx --version`** 判可用性（D328 P1-1：存在性≠可用性）。
4. **测试自己 import 真源会被 Vite 拦**：`await import(真源.ts)` 在 vitest 里解析出的对象无导出名
   （实测 `view.blocks is not iterable`）⇒ 正解是给生成器加 `--json-raw` 出口，
   **让测试走与门禁同一条取数链**，而不是在测试里再 import 一次。
5. **只改 `SYNO_TSX` 测不出"tsx 不可用"**：它只是候选第①个，后续候选会补上 ⇒ 假绿。
   真验法：把壳复制到"仓内无 node_modules + PATH 收窄"的沙箱再跑（配对测试 F 组即此形）。
6. 🔴 **`check-verifiable-done.sh` 的取数有判别力缺陷（本卡实测发现，已同批修 + 配对测试）**：
   原实现 `done <<< "$(echo "$DONE_SECTION" | grep -E '^\s*- \[x\]')"` **只把 `- [x]` 那一行**喂进循环
   ⇒ 写在**续行**里的 `verify:` **永远看不到** ⇒ 双向失效：
   ① 合法写法**假红**（本卡 brief 首版实测报「7 项 Done 中 3 项缺 verify:」，而那 3 项下一行都有 verify:）
   ② 只要把 verify 挤在同一行就过、续行内容不参与判定。
   修法只动**取数**（一个条目 = 该行 ＋ 其缩进续行），"必须有 verify"这条判据**不放松**；
   配对测试 `tests/control-tower/check-verifiable-done.test.sh`（8 断言）锁住两侧。
7. 🔴 **写测试夹具时，"夹具不可解析"会伪装成"判据通过"**：
   `resolve-commit-brief.sh` 对不可解析的 brief 会 `exit 1`，消费方随即走"无 brief，跳过" ⇒ **假绿**。
   夹具必须**可解析**（`## 架构层:` ＋ `#CRITERIA: A` ＋ `## Done 标准`）且文件名带今日日期前缀；
   沙箱还须**同构复制** `scripts/control-tower/brief_parser.py`（resolver 用 `dirname($0)/..` 定位它，不用 `$ROOT`）。

## 验收（可复跑）

```bash
bash scripts/control-tower/check-block-paths.sh                          # exit 0（真源 14 块逐块一致）
bash tests/control-tower/check-block-paths.test.sh                       # 23 断言全绿
npx vitest run tests/control-tower/block-paths-core.test.ts              # 32 断言全绿
npx tsx scripts/control-tower/gen-block-paths.ts --list | wc -l          # 14
```
可复现：两次独立进程输出 `cmp` 逐字节相同（哈希 `84b3bfb2981a4de6`）。

## 未决 / 边界

- 真源 `ConstructionBlock.paths` 字段属 **CTO 红线**，本件**只读**（不实现 `--write`）
- 本门禁的防守面 = 「快照 vs 现算」；**不**判"某 item 该不该有某路径"（那是派单裁定的事）
