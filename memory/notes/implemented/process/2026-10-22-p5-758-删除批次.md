# P5 清账 · #758 删除执行批次（20 删 + 1 配套改）

状态: implemented
日期: 2026-10-22

## 一句话

裁 253-D1/D2/D4/A5 ＋ 裁 271 批准的 **20 件无消费者载体**出库（A 1 ｜ B 11 ｜ C 4 ｜ D 4），并同步
`tests/control-tower/grep-oP-regression.test.sh` 的 BOM 待清清单 **2 行**（删件配套）；不实现功能、不改被测行为，一组一 PR。

## 现状（改之前）

- 存量载体占维护/CI 成本：`jtbd_overlap.py` 194 行但全树 `git grep -c jtbd_overlap` = **0 文件**；
  `scripts/jtbd-dedup.py`（354 行）/`-v2.py`（464 行）/`merge-expert-files.sh`（246 行）/
  `workflow/install-post-commit.sh`（33 行）活引用 0。
- C11 的 12 对测试存在**弃侧副本**在 `extensions/sentinels/**/computes/`：`vitest.config.ts:28` 的 include
  只收 `./tests/**` ⇒ 弃侧**不在收集集**；E3 专项实测 11 对断言等价（删弃侧丢 0 条断言），
  第 12 对 `cash-conversion-cycle` 语义漂移（`>=90`/`warning` vs `>120`/`critical`）⇒ **不删，归 #757**。
- 4 个 `tracked .pyc` 仍在库（`.gitignore:19-20` 已覆盖 `__pycache__`，出库后不会再进库）。
- 两个陷阱已由 L1 实测：① 删 jtbd-dedup 两件必须同批删 BOM 清单 `:214`/`:215` 两行，否则
  `grep-oP-regression.test.sh` 报「行首 BOM 清单漂移」；② `scripts/control-tower/dev_doc_gatekeeper.py`
  被 `tests/control-tower/test-dev-doc-gatekeeper.py:9` 执行级 import ⇒ **不删**（要删须同批退役其测试，属 P4 门禁面）。

## 决定

1. **一组一 PR 串行**：A（A 组）→ B（B 组）→ D（D 组）→ C（C 组，等 #829 对 #634 结论：合则只核"已 0 件"，关/retire 则独立出 PR）。
2. A/B/D 正文引 `Refs #758`，C 用 `Closes #758`（最后一组）；**均不自行合并**，留待独立复核（四条件③）。
3. 判据口径（现场修正，L1 已裁）：base 全量跑存量 8 条红（worktree 路径/环境相关＋2 条测试自身缺 `await`）⇒
   主判据 = `CI=1` 全量跑（**失败 0** 且 `numTotalTests` 逐字不变）；副判据 = 不设 CI 的全量跑按
   「失败集合与 base 逐条相同（零新增失败）」；两者原始输出均入 handbook `派单件/过程档案/`。
4. 写集外一律不动；`git diff --name-only` 必须与写集逐字一致（多一件即停报 L1）。

## 依据

- 裁 253-D1（A 组唯一批准件）｜裁 253-D2（C11 只删弃侧，先迁移后删）｜裁 253-D4（.pyc 出库）｜
  裁 253-A5（本批立项）｜裁 271（5 脚本候选并入，本批 4 删 1 留）。
- 规格：`.handbook/派单件/2026-10-22-规格-758-p5-删除批次.md`（唯一规格）；
  `.handbook/派单件/2026-10-22-规格-829-老PR三分类.md` §7.2（C 组与 #634 的顺序耦合）；
  `.handbook/派单件/过程档案/2026-10-19-P5-删除收口记录.md`（判据与失败关闭闸先例）。
- 域守则：`memory/notes/AGENTS.md`（铁律 49 四态 Note）、`extensions/AGENTS.md`（B 组红线）、
  `scripts/control-tower/AGENTS.md`、`tests/control-tower/AGENTS.md`（配套改域）。

## 生效时点

- 随各 PR 合并生效；**删除不可逆**（出库即从 `local-main` 消失），故每件必须留消费面实测与反例原始输出。
- **失效条件**：若 #829 对 #634 的结论为「重开·待合」⇒ C 组停（报 L1），不得跳过顺序自行出 PR；
  若 #757 裁出第 12 对口径 ⇒ 另卡处置，不回改本批。
