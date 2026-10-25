# #998 D331 去摩擦：对账来源并入主工作树账本（裁 420-③）

## 病灶
`.sessions/<sid>/bypass.log` 与 `.claude/bypass.log` 都在**各自 worktree 内**。
在 worktree A 用 synova-commit / plain commit 产生的记录，在 worktree B 推送时**查不到** ⇒ fail-closed 误拦。
今天 CTO 代合/代推实测 3 次被拦（#973 #993 各一次 + 一次 merge 后重挂）。

## 修法（最小）
`check-bypass-log.sh` 的来源集合 = 当前 ROOT ∪ **主工作树**（`git rev-parse --git-common-dir` 的上一级）
的 `.claude/bypass.log` 与 `.sessions/*/bypass.log`，去重。
判据强度不变：仍是「COMMITTED 行的 HASH= 值 = 提交 sha 前缀」。

## 为什么这样够（不削弱价值）
- `--no-verify` 提交**仍不写记录** ⇒ 仍被抓（裁 420 的核心价值保留）；
- merge 提交本就由 `git log --no-merges` 排除；
- 只是**让同机另一 worktree 的记录可见**，不引入跨机豁免。

## 已知限制
- 跨**机器**仍不可见（账本不随 git 走，D1145 既定）⇒ 他机拉分支再推仍按"他机已过闸"过滤（D1152）；
- 主工作树路径靠 `--git-common-dir` 推导；旧 git 版本无 `--path-format` 时退化为仅当前 ROOT（fail-closed 不变）。
