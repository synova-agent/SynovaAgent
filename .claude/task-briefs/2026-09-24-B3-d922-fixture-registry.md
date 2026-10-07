# Task Brief — B3 D922 夹具登记 CI（T3 注入改与文案无关 + 判别性反例）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L0 控制塔治理层（门禁质量），不动 src/**。问题族：M3「机制建成未接线/未自测」——D922 夹具 `install-dsh-preset.test.sh` 红了 2 条无人知，且**未登记** ci.yml 密封清单（K3 批次2 §五 #2 的复发点）。
K3 批次2 对 D922/D926 的条件三件：① 夹具登记 ci.yml ② 修 T3 字面耦合 ③ 登记后红转绿。
### b) 文件审计（实测，base=origin/main 9f0c8f65）
- `tests/control-tower/install-dsh-preset.test.sh`：现状 `PASS=23 FAIL=2 exit=1`（红项恰 T3×2）
- `docs/synova/coordination/dsh-preset-draft/persona-block.yml`：旧字面串 `DeepSeek Harness 编码代理` 命中 **0**（D926 persona 重写抹掉）→ T3 的 sed 空转
- `.github/workflows/ci.yml`：密封清单 42 条；该夹具**未登记**（grep 0 命中）
- `scripts/control-tower/install-dsh-preset.sh`：`--check` 用 `diff persona-block.yml vs extract_persona(installed)`，块边界 = `- id: persona` 起、下一条 `- id: ` 止
### c) 决策
不改安装器本体；只改**夹具注入方式**（与文案无关）+ 登记 + 判别性反例。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- Anthropic 工程基线：夹具必须**判别性**（改坏即红），且负控与主判据**分流标注**。
- 第一性原理：判据若依赖被删掉的文案串，则"红/绿"不再承载信息（D926 重写即抹掉该串）；注入必须锚在**结构**（persona 块边界）而非文案。
- memory 历史：M3（建成未接线）多次复发；D922 日期炸弹堵队列（门禁自阻断）；D516「登记后必须等 CI 真跑通」。
- 参考：Anthropic/第一性原理 + 结论=「注入锚结构 + 主判据/负控分流 + 登记并等 CI 真跑」。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- tests/control-tower/install-dsh-preset.test.sh — 改：T3 注入改「persona 块内插入标记行」（文案无关）＋ T3c 落点证明（承重）＋ T3b 旧 sed 负控（NEGATIVE-CONTROL，非承重）＋ M1/M2/M4 判别断言
- .github/workflows/ci.yml — 改：canary 密封清单追加 1 行 + gate-integrity job 末尾追加证据步（关键行发 ::notice 注解，公开可检索）
- .claude/task-briefs/2026-09-24-B3-d922-fixture-registry.md — 本 brief

交付文件集（冻结）：上述 3 条即本任务进入 main 的完整文件集，不得有第 4 个文件；S1 互证 `task-state/D922.json` → `write_set`。

不做什么（含文件路径）：
- 不改 scripts/control-tower/install-dsh-preset.sh（安装器本体零改动）
- 不改 scripts/control-tower/check-gate-integrity.sh（M9 写集）
- 不改 scripts/control-tower/ci-red-baseline.txt（M9 后随写集）
- 不改 scripts/pre-commit-check.sh（D937 范围）
- 不碰 scripts/audit/**（K3 红线）
- 不改 src/**、packages/**（非本卡域）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/install-dsh-preset.test.sh`（本地）与 CI canary 密封清单中的同名条目
处理：T3 在 installed persona 块内注入结构标记 → `--check` 比对 persona 块 → 判漂移
结果：本地 `PASS≥27 FAIL=0 rc=0`；CI 上该夹具执行并绿；CI 侧关键行以 `::notice title=b3-fixture::` 注解公开可检索

## 架构层: 基础设施

## Done 标准
- [ ] verify: `bash tests/control-tower/install-dsh-preset.test.sh; echo $?` → 0（PASS≥27 FAIL=0）
- [ ] verify: `grep -n "install-dsh-preset.test.sh" .github/workflows/ci.yml` → 命中 1 行（密封清单）
- [ ] verify: `bash scripts/control-tower/check-pr-budget.sh` → PASS（三文件 owner=mac、单域）
- [ ] verify: `git diff --name-only origin/main...HEAD | grep -c "install-dsh-preset.sh"` → 0（安装器零改动）
