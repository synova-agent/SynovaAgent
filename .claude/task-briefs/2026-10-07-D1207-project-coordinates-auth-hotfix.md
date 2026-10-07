# Task Brief — D1207: project-coordinates sync 认证缺失热修（全仓 Gate Integrity 红）

## Q0: 定位
- 治理面 `.github/workflows/project-coordinates.yml` + `scripts/control-tower/sync_project_coordinates.py`（我 #1237 交付物的缺陷）。

## Q1: 调研
- 现象: main 上 2 条 `sync` failure check-run（run 37617344582/37617326037, event=issues）⇒ Gate Integrity C 段「既有红对账」判红 ⇒ **全仓所有 PR 同红**（实测卡住 #1259/#1260/#1257/#1262）。
- 根因: 脚本内部走 `gh api graphql`，而 gh 认证读的是 `GH_TOKEN`/`GITHUB_TOKEN`；workflow 只注入 `PROJECT_TOKEN` ⇒ 「有 token 但未认证」⇒ GraphQL 失败 ⇒ exit 2。

## Q2: 范围
做什么：
- workflow env 增 `GH_TOKEN: ${{ secrets.PROJECT_TOKEN }}`；
- 脚本 `gh_graphql` 前置检查认证态（缺失 ⇒ 抛明确错误「仅设 PROJECT_TOKEN 不足以让 gh 认证」，避免排障指向 GraphQL 语法）。
不做什么（含文件路径）：
- 不改 `.github/workflows/ci.yml`（线 B 写集）
- 不改 `scripts/control-tower/ci-red-baseline.txt`（Gate Integrity 台账，本修根因而非登记绕过）
- 不改 `scripts/control-tower/check-gate-integrity.sh`（线 B 与 #1263 冲突面）

## Q3: 验收
- 入口: issue 编辑触发（issues=[opened, edited]）
- 结果: sync job exit 0（无 token ⇒ notice+0；有 token ⇒ 认证成功）

## 架构层: 治理面（.github/workflows + scripts/control-tower）

#CRITERIA: D

## 写集
| 文件 | 类型 |
|---|---|
| .github/workflows/project-coordinates.yml | task |
| scripts/control-tower/sync_project_coordinates.py | task |
| .claude/task-briefs/2026-10-07-D1207-project-coordinates-auth-hotfix.md | task |

## Done 标准:
- [ ] verify: bash tests/control-tower/sync_project_coordinates.test.sh ⇒ 8/8（含认证缺失前置）
- [ ] verify: 触发一次 issues 事件 ⇒ sync job 结论 success（贴 run 号）
- [ ] verify: main 上不再新增 sync failure check-run
