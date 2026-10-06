---
状态: proposed
日期: 2026-09-25
决策: daily-cto-board 的默认 REPO 去掉硬编码主工作区绝对路径，改为「脚本自身所属仓库根」；同时把看板变成对账探针的通用 runner（三态：0 一致 / 1 DRIFT / 2 无法测量）。
理由: 硬编码默认值使任何 worktree 里直接跑本脚本都会写进主工作区（多写者写同一被跟踪文件）；探针散落各处时「机制建成未接线」，故集中在看板首屏执行并显式报警，无探针也不静默。
---

# D969 — 看板默认工作区去硬编码 + 对账探针接入点

- 任务: D969
- 分支: feat/d969-daily-cto-board-paired-test（基线 origin/main 25e081ce）

## 问题（事故实证，2026-09-25）

16:41，coder-a 在 `.synova-wt-ctobatch-a` 内执行 `bash scripts/control-tower/daily-cto-board.sh`，
脚本旧第 8 行 `REPO="${SYNO_REPO:-/Users/wane/SynovaAgent}"` 把目标工作区解析到**主工作区**，
于是改写了主工作区的 `docs/synova/coordination/CTO-看板-自动.md`（tracked，7+/6-）与 gitignored 日志。

队长独立复核（证据强于自报）：该文件在本次之前**已经 dirty**——当日 01:22:26 / 13:21:58 两次 schedule
已改写且从未提交（`git log --since=2026-09-24 -- <file>` 仅 `11458279` 一条）。故本次为**覆盖既有 dirty**，
非引入者；裁定「维持现状」，不做回退（回退 = 往别人工作区写 + 丢当轮证据 + 下轮又覆盖）。

**根因与这一次运行无关**：默认值硬编码了**别人的工作区**——任何 worktree 里直接跑本脚本都会越界。
任何「只在主工作区跑」的口头约定都拦不住它（本卡即反例）。

## 决策

1. 默认 REPO = 「**脚本自身所属仓库根**」：锚定脚本所在目录做 `git rev-parse --show-toplevel`，
   worktree 内返回该 worktree 根 ⇒ 就地写、不越界；`SYNO_REPO` 覆盖缝保留；非 git 环境回落 `pwd`，
   由既有 `.git` 自检 fail-closed（exit 2）。
2. **schedule 行为不变**（实测只读解析：主工作区 `scripts/control-tower` → toplevel = 主工作区本身）。
3. 看板首屏加通用探针 runner：`scripts/control-tower/probes/*-probe.sh` 逐个执行；任一退出非 0
   或输出含 DRIFT → 显式报警（探针名 + 退出码）并记红；无探针 → 显式「无探针」。D971/D973/D974
   的探针作为独立文件落该目录，自动被发现（本轮为三条对账机制的**唯一接入点**）。
4. 配对测试（U7/CT-40）带**判别性夹具**：默认值一旦回退成硬编码绝对路径，`⑥` 断言必红
   （实测：注入硬编码路径 → `⑥ 沙箱内无产物` 红，且被注入版把产物写到沙箱外，实测 541B 文件落地）。

## 参考

参考：第一性原理（默认值不得指向他人工作区；失败必须可观测）+ Anthropic 基线（tri-state 门禁：
0 过 / 1 业务阻断 / 2 执行失败，绝不与通过混同）+ 项目既有 `ct-test-gate` 配对范式 + 结论：
不加新门禁，用「配对测试 + 探针 runner」把三条对账机制接进既有看板。

## 遗留（诚实登记）

- 探针 runner **无超时保护**：探针若无 `--max-time` 而挂死，看板随之挂起（本轮未加，登记为待办）。
- 本机 `.gitattributes:20` `.claude/reference-map.md merge=union` 与 D1009 治理对象同类（latent bug），
  不在本卡写集，仅登记。
