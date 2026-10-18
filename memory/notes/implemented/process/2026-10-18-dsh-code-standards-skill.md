# 新增 skill：dsh-code-standards（DSH 代码标准 12 项）

状态: implemented
日期: 2026-10-18

## 一句话

把 DSH 的代码标准提炼成 12 项强制项（每项带 DSH 源码 file:line 证据），落成 skill，
并在 squad-lead 三处预设里挂指针；同时列出本仓四个必须复用的既有约定。

## 问题

创始人 2026-10-18：「你把 dsh 的代码标准写到实施小队的预设或者 skill 中没有」
实测：persona 只有 8 项摘要（无证据、无验证方法）；**无专门 skill**（.dsh/skills 里只有 dsh-decision-lens 相关）。

## 决定

新增 `.dsh/skills/dsh-code-standards/SKILL.md`：
- A 结构标准（包目录 + README 骨架，证据 tool-bash/README.md:10..213）
- B 代码标准 8 项（typed error 带 code @agent-team/lib/index.js:13-18；config schema :1,:9；invariant companion；fail loud README:108；explicit authority README:107；JSDoc :19-23；design philosophy README:103；测试配对 CT-40）
- C 文档标准（Source map README:112-118；Known Limitations README:201；What success/failure looks like README:87）
- D 本仓必须复用的四个既有约定（三态退出码／@降级+degraded log／D732 UTF-8／判别力自检）
- E 验证清单（8 条可跑命令）
- F 已知差距（check-package-selfsufficiency.py 对照）

## 依据

创始人 2026-10-18 原话；DSH 源码与 README 实测行号；裁定 197。

## 生效时点

本 commit 起。
