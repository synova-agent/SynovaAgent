# Task Brief — D926 小队行为纪律技能化（dsh persona 精简 + squad-discipline）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

治理/组织形态面，不动 src/** 产品代码。

- 创始人 2026-09-23 指令：`synova-dsh`（纪律模式）也名存实亡 → 取其可取、与控制塔不冲突者，给小队，可作成 skill。
- 文件审计：`docs/synova/coordination/dsh-preset-draft/persona.md`（128 行铁律抄本，本件精简）+ 同目录 `persona-block.yml`（安装源，须同步）；`docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md`（37 行，本件追加队内纪律段）；`.claude/skills/`（15 技能，本件新增第 16 个）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

参考：Anthropic/DeepSeek/第一性原理 + 结论=**门禁能拦的不写进 prompt/skill；只保留"无人能拦、只能自持"的行为纪律**。

- V3.9 教训（仓库 memory）：「硬阻断 100% 有效，软机制 0% 有效」——原 persona 七成条款是门禁的软抄本，价值低且必然数字漂移（M7）。
- Anthropic 基线：机器可验契约 + fail-closed → 规则应落在脚本，不落在文本。
- 反内卷（DeepSeek）：一类一机制，不重复表达。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：
- .claude/skills/squad-discipline/SKILL.md + .dsh/skills/squad-discipline/SKILL.md — 新技能（6 节 17 条，只收门禁外纪律）
- docs/synova/coordination/dsh-preset-draft/persona.md + persona-block.yml — 128 → 45 行；改为指向脚本/CI 单一事实源 + 指向 squad-discipline（双写一致）
- docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md — 追加「队内行为纪律」段（全队加载 skill）
- task-state/D926.json、.claude/task-briefs/2026-09-23-D926-squad-discipline.md、memory/notes/proposed/2026-09-23-squad-discipline-from-dsh-persona.md
- docs/authority/DOCS-REGISTRY.yaml — 新文档登记

不做什么（含文件路径）：
- 不改 src/ 下任何产品代码
- 不改 scripts/audit/**（审计红线）、不写审计标准
- 不改 scripts/control-tower/install-dsh-preset.sh（D922 已交付其退役机制，本件不再动）
- 不改 tests/control-tower/install-dsh-preset.test.sh（本件不改注册表，无需改测试）

## 写集

| 文件 | 类别 |
|---|---|
| `.claude/skills/squad-discipline/SKILL.md` | task |
| `.dsh/skills/squad-discipline/SKILL.md` | task |
| `docs/synova/coordination/dsh-preset-draft/persona.md` | task |
| `docs/synova/coordination/dsh-preset-draft/persona-block.yml` | task |
| `docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md` | task |
| `task-state/D926.json` | task |
| `.claude/task-briefs/2026-09-23-D926-squad-discipline.md` | task |
| `memory/notes/proposed/2026-09-23-squad-discipline-from-dsh-persona.md` | task |
| `docs/authority/DOCS-REGISTRY.yaml` | task |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本） |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash scripts/workflow/sync-dsh-skills.sh --check`；`bash tests/control-tower/install-dsh-preset.test.sh`
处理：技能双写一致性；预设安装脚本用仓库版 persona 覆盖（T1/T2 覆盖 persona 双写）
结果：SYNC-OK（16 技能）+ 预设测试 25/0 + pre-commit 13 组通过

## 架构层

治理/组织形态（`.claude/skills` + `docs/synova/presets` + `docs/synova/coordination`；不触五层依赖图）

## Done 标准

- [ ] `bash scripts/workflow/sync-dsh-skills.sh --check` → SYNC-OK（含新技能）
- [ ] `bash tests/control-tower/install-dsh-preset.test.sh` → PASS=25 FAIL=0（persona 精简不破坏安装）
- [ ] `bash scripts/pre-commit-check.sh` → 全部 13 组通过
