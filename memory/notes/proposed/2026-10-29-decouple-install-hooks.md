# Note — 门禁日志与 Claude Code 解耦（proposed）

## 现状
`install-hooks.sh` 生成的 pre-commit 包装器把 3 个运行时日志写在 `.claude/`：
`pre-commit-failures.log`、`gate-soft-warnings.log`、`last-precommit-success`。
`.claude/` 是 Claude Code 客户端目录；门禁运行时产物绑在某个 AI 客户端上属工具耦合。

## 决定
写入改 `<ROOT>/.synova/logs/`（`mkdir -p` 自愈）；读取方**新路径优先、legacy `.claude/` 只读回落并 `::warning`**；`.gitignore` 加 `.synova/logs/`；不迁移历史文件。

## 依据
创始人 2026-10-29 指令（小任务·A 类门禁面：3 处 `.claude/` → `.synova/logs/`，与 Claude Code 彻底脱钩）；配套卡 #1146（批1 退役的解耦脏点）。

## 生效时点
合入 main 起；已装 hook 的机器需重跑 `bash scripts/install-hooks.sh` 才切到新路径（未重跑者走 legacy 回落，仍可工作）。

## 未决
`dsh/plugins/synova-dashboards/lib/collect.js` 已加新路径优先+旧路径回落；后续可删旧路径回落（观察期后）。
