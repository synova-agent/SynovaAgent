# Task Brief — D1196: project-coordinates workflow startup failure 修复（薄壳化）

## Q0: 定位
- 治理面 `.github/workflows/project-coordinates.yml` + 新增 `scripts/control-tower/sync_project_coordinates.py`。

## Q1: 调研 — 业界最佳实践 / DSH 对照 / memory 教训
- DSH 上游 workflow 一律薄壳：复杂逻辑进 scripts（同仓可测），workflow 只做胶水——本卡照此重写。
- 历史教训: 内联复杂 shell/heredoc 的 workflow 装载失败会以「push 事件 0 秒 failure」形态出现，难定位。

## Q2: 范围 — 做什么
- 症状（实测）: run 37591189894 — event=push、0 秒、零 job、conclusion=failure ⇒ GitHub **startup failure**
  （workflow 装载失败），首版把中文 output 键/多段 heredoc 内联在 workflow 里。
- 修法（DSH 式）: 逻辑全部移入 python 脚本（契约头块 + --from-body 注入缝 + --dry-run），
  workflow 只剩 checkout + 一条 `run: python3 scripts/...`；无中文 key，无内联 heredoc。

不做什么（含文件路径）：
- 不修改 .github/workflows/ci.yml（他卡写面）与 scripts/audit/**（K3 域）
- 不修改 .github/workflows/dashboard-auto.yml、.github/workflows/product-progress.yml（其余 workflow 不动）
- 不改动 Project #1 的字段结构（仅读写既有 7 字段）

## Q3: 验收
- push 该分支后**不再出现 startup failure run**（原症状零复现）。
- 本地离线: 无 token ⇒ exit 0 + notice；缺字段 ⇒ warning 点名；解析正确。
- 有 token 时: 挂板 + 逐字段写入（待 token，未实测，上界如实登记）。

## 架构层: 治理面（.github/workflows + scripts/control-tower）

#CRITERIA: D

## 写集
| 文件 | 类型 |
|---|---|
| .github/workflows/project-coordinates.yml | task |
| .github/workflows/ci.yml | task |
| scripts/control-tower/sync_project_coordinates.py | task |
| tests/control-tower/sync_project_coordinates.test.sh | task |
| memory/notes/proposed/2026-10-07-d1196-workflow-thin-shell.md | task |
| .claude/task-briefs/2026-10-07-D1196-991-workflow-startup-fix.md | task |

## Done 标准:
- [ ] verify: push 后 gh run list 该 workflow 无 startup failure（对比 run 37591189894）
- [ ] verify: python3 scripts/control-tower/sync_project_coordinates.py --from-body /tmp/body.md（无 token）⇒ rc=0
- [ ] verify: YAML 可解析且 triggers=issues
