# 2026-10-24 · #917 拍 1：GitHub 退 architecture job ／ Gitea 进 ①f（一进一出）

## 现状（实测）

`ci.yml` 15 job。逐条对照后**只有 `architecture` 是真重复**：Gitea ② 调同一个
`scripts/check-architecture.sh` 且已注入 `SYNO_CI=1`（无新增 rc=0／人为新增 L1→L3 rc=1）。
其余 4 个各有非重复面（`quality` 的 `tsc`、`control-tower-tests` 的 hermetic 套件、
`test` 的全量分片、`gate-integrity` 的常跑腿）。

真缺口：**合并门在 Gitea，而 `tsc --noEmit` 只在 GitHub quality 跑**，GitHub main 落后且红无人看
⇒ 类型错误可一路合进 `local-main`。

## 决定

一进一出（裁 300／335）：
- **退** `.github/workflows/ci.yml` 的 `architecture` job（15→14）＋ `all-checks-passed.needs` 删一项。
- **进** Gitea 新步 **①f**：`npx tsc --noEmit`（真缺口）＋ `check:iron-laws`（= `scripts/pre-commit-check.sh` 本体）。
  铁律半边**按标记去重**：① 已以 `SYNO_CI=1 + SYNO_DIFF_BASE` 跑过同一脚本（① 落 `.gate-step1-ran`）⇒
  ①f 不再重复跑（重复跑只会烧时长，且无 base 重跑会得到"空暂存 ⇒ 多数组跳过"的空绿，更坏）。

## 依据

裁 335／#917 批文；判据 ①人为类型错 ⇒ ①f 红（本机实测 `tsc` rc=2，删文件后 rc=0）。

## 生效时点

本 PR 合并 `local-main` 起。回滚 = revert（GitHub job 恢复 + 删 ①f）。

## 遗留（平台侧，需创始人/CTO 操作）

`Architecture Check` 仍是 GitHub **branch protection 的必需 context**（`scripts/control-tower/required-checks-baseline.txt:48`）。
job 删掉后 `check-required-contexts.py` 会报 1 条 VIOLATION（该检查只在 GitHub gate-integrity 跑，不影响 Gitea 合并门）。
正确处置：① 创始人在 GitHub 仓库设置里删该 required context ② 用基线文件头部记载的命令**重放生成**基线
（禁手抄—— 该表是 live 镜像，不是目标态声明）。
