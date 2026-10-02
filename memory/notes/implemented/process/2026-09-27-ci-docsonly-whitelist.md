# CI docs-only 白名单补全

状态: implemented
日期: 2026-09-27

## 一句话

让 .gitignore 这类配置文件的改动，不再触发整套 21 分钟的控制塔体检。

## 问题

docs-only 早退的判定是 grep -qvE '\.(md|json)$|task-state/|\.claude/'。
.gitignore 不在其中 -> 含它的纯文档 PR 被判 docs_only=false ->
Windows 跑 21 分 47 秒 + ubuntu 2 分 43 秒 约 24 分钟白烧（实测于 PR #860）。

## 决定

10 处白名单正则统一加：.gitignore / .gitattributes / .gitmodules / LICENSE / .gitkeep。

## 考虑过的其他方案

1. 顺便去掉 Control Tower 的 Windows matrix —— 否决：该 matrix 注释写明是 D520/任务2 的设计
   （平台问题不再等 Win 实测暴露）；去掉它须单独设计"按需跑" + K3 意见。
2. 把正则抽成变量 —— 否决：本 PR 求最小改动面（10 处替换风险可控，抽变量属重构）。

## 后果

- 含 .gitignore 的纯文档 PR：24 分钟 -> 早退
- 遗留：该正则仍在 10 处重复（同一逻辑复制 10 遍）-> 记入 CI 处置清单（应抽变量）

## 取代

无。
