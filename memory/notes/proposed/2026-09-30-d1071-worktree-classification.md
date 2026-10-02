# D1071 — X30 M0.5a：295 工作树三分类（只读判档，不删）

- **状态**: proposed
- **日期**: 2026-09-30
- **决策**: 新增 `scripts/control-tower/classify-worktrees.py`（**只读**）——把 `.synova-wt-*` 存量逐树判为
  **可合 / 需改 / 作废 / 活跃**，落 `docs/synova/coordination/工作树分类-20260930.md`（296 行，一树一行）。
  判据复用 `check-orphan-worktrees.sh` 的孤儿定义并扩展：
  独有提交 = `origin/main..HEAD`；**实质提交** = 独有提交剔除自动噪声（`bypass COMMITTED 登记` / `merge origin/main into` / 刷新类）；
  可合 = 实质≥1 且工作区干净且 `merge-tree` 无冲突；需改 = 有实质但脏或冲突；作废 = 无实质且干净；活跃 = 有活 session 或本脚本所在树。
- **理由**:
  - 令 §二 T3 要求 295 全覆盖，并**明令禁止「孤儿=0 清理」**（会删掉未合并交付）。故本机制只读判档，回收动作留人工。
  - 存量里绝大多数「独有提交」是自动 hook 的 `bypass COMMITTED 登记` 噪声——不做剔除会把噪声当成交付，导致误判「可合」。
  - 复用优先（铁律：无覆盖才新建）：已有 `check-orphan-worktrees.sh` 定义孤儿，本件只在其上补三分类与实质提交过滤，不另立判据源。
- **实测结果（2026-09-30，`--root /Users/wane/SynovaAgent`，17 秒 8 线程）**:
  - 扫描 **296** 个 `.synova-wt-*`（存量 295 ＋ 本启动窗新建 1）；**全部 296 个均已注册为 git worktree**（0 个未注册残留目录）。
  - **可合 105 ｜ 需改 125 ｜ 作废 65 ｜ 活跃 1**（合计 296，自表复算）。
  - git 注册工作树共 **457** 个：其中 297 个在本目录 `.synova-wt-*` 名下、160 个在别处（116 个 `/private/tmp`、19 个 `/Users/wane` 等）。
  - **僵尸注册 1 个**：`.synova-wt-d755` 已注册但磁盘无目录（`git worktree prune` 可清，属元数据修复、不动交付，留人工确认）。
  - 修正留痕：本 Note 初稿曾写「49 个未注册目录」，经自表复算为 **0**，已勘误（与 X30 内规「统计数字必须自表复算」同源，工程侧同样适用）。
- **验收证据**: `bash tests/control-tower/classify-worktrees.test.sh` = **PASS=8 FAIL=0**
  （可合/作废/需改三判定 + 全录 + **只读红线（工作树与分支数不变）** + 非 git 根 exit 1）。
- **待办**: 105 个「可合」的入队顺序需 CTO 排（本件只分类不排序）；未注册目录的处置需人工确认。
