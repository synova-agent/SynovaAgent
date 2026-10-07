# Task Brief — gen-cto-health 配对测试存量红（卡死该脚本的一切改动）（D1215）

> 卡 **#1268** · 批次：门禁减法2（存量红清理）· 服务承重件：门禁配对测试
> 编号说明：本卡原取 D1208（与卡面一致），但 **D1208 已被同批 ownership 任务（卡 #1233）占用**
> ⇒ 经 Lead 裁定改用 **D1215**（已三重核验：命名分配器可用 / main 零文件 / issue 标题零命中）。
> 产物同时引「卡 #1268」。**号只是过渡锚，卡号才是身份**（D-C 方向）。

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理面（`scripts/control-tower`）控制塔脚本 + 其 U7 配对测试。本卡不新增能力，
只**修复存量红**：让 `gen-cto-health.py` 与它的配对测试重新可改。

### b) 文件审计（本轮实测，file:line）
- 崩溃点 = `scripts/control-tower/gen-cto-health.py:305`
  `spec_path = (d.get("spec") or {}).get("path")` —— 只容纳 `spec` 为 `dict`/`null`。
- **spec 形态实测分布**（`task-state/*.json`）：`str=171 / null=189 / dict=83`
  ⇒ 命中任一 `str` 即 `AttributeError: 'str' object has no attribute 'get'` ⇒ 生成器 rc=1。
- 静默机制 = `tests/control-tower/gen-cto-health.test.sh:43`
  `OUT1=$(python3 "$GEN" 2>&1)` 在 `set -euo pipefail` 下遇 rc≠0 **立即中止整个测试**，
  而 traceback 被 `2>&1` 收进变量、**永不打印** ⇒ 只剩 8 行输出 + rc=1 + 零诊断。
- 卡死机制 = U7 配对门禁要求 control-tower 脚本必须带**绿的**配对测试 ⇒
  测试恒红 ⇒ **任何人对 `gen-cto-health.py` 的任何改动都提交不了**（不止本批线）。

### c) 决策
修**脚本的数据形态容纳度** + 修**测试的静默中止**；**不给配对门禁加豁免**（那会打开
「存量红可绕过配对门禁」的口子，正是 v2.0 要消灭的形态），也不动任何判据。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **判定 #1268 Done①**：**不是环境依赖**（archive 干净树同样中止 ⇒ 数据在仓里），
  而是**被测脚本行为漂移**（台账 `spec` 字段的形态在历史演进中从 dict 扩到 str，脚本未跟上）。
- **铁律 11（静默降级禁止）** 的同型形态：失败**无声**比失败本身更贵 ——
  本次正是「测试静默中止」把故障伪装成「门禁在正常工作」。
- **铁律 48（测试不可为空壳）**：新夹具覆盖三形态（正常 dict / 边界 str / 边界 null）。
- **判据不降级**：`D399/D412` 的「json spec.path 必须**工作区存在** ∧ **已提交 HEAD**」双守卫**原样保留**，
  本卡只放宽「把不是 dict 的 spec 当 dict 取属性」这一步。
参考：第一性原理（失败必须可见 + 输入形态要先定契约再消费）⇒ 容纳三形态 + 测试显式点名。

## Q2: 范围 — 正确的最简方案
做什么：
- `scripts/control-tower/gen-cto-health.py` — `spec` 三形态容纳：**只有 dict 提供 json path**；
  `str`/`null` 一律「无 json path」，回落到既有 glob 派生（`has_spec`）
- `tests/control-tower/gen-cto-health.test.sh` — ① 全部生成器调用改走 `run_gen`（显式收 rc，
  失败即打印原始输出 ⇒ 禁静默中止）；② 新增 §6 三形态夹具（沙箱镜像仓内相对结构 + 真 git 仓）
- `.claude/task-briefs/2026-10-07-D1215-gen-cto-health-配对测试存量红.md` — 本 brief
- `task-state/D1215.json` — 台账
- `memory/notes/proposed/2026-10-07-gen-cto-health-spec-shapes.md` — 决策沉淀（铁律 49）

不做什么（含文件路径）：
- 不改 `scripts/control-tower/ct-test-gate.sh`（U7 配对门禁本体）——**不加豁免、不动判据**
- 不改 `scripts/pre-commit-check.sh`（提交端门禁）
- 不改 `.github/workflows/ci.yml`（密封清单/CI 面）
- 不改 `scripts/audit/**`（K3 红线）
- 不改任何 `task-state/*.json` 的既有数据（本卡**不做数据迁移**：容纳形态，不改历史台账）
- 不修 `gen-cto-health.py:296` 的 `r"D(\d{3})"` 三位数正则（4 位 D# 会被截成 3 位）——
  属**另一类**问题（编号正则），且当前 `spec_files` 用同一正则、口径自洽，**另卡**，本卡不夹带

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/gen-cto-health.test.sh`
处理：生成器按三形态台账派生任务状态；测试对每次调用显式收 rc 并在失败时打印原始输出。
结果：**rc=0**（PASS=14 FAIL=0），且三形态夹具在改前代码下**必红**（改坏即红已实证）。

## 架构层: 治理面（scripts/control-tower）
#CRITERIA: D

## 写集
| 文件 | 类型 |
|---|---|
| `scripts/control-tower/gen-cto-health.py` | task |
| `tests/control-tower/gen-cto-health.test.sh` | task |
| `.claude/task-briefs/2026-10-07-D1215-gen-cto-health-配对测试存量红.md` | task |
| `task-state/D1215.json` | task |
| `memory/notes/proposed/2026-10-07-gen-cto-health-spec-shapes.md` | task |

## Done 标准
- [ ] verify: bash tests/control-tower/gen-cto-health.test.sh ⇒ rc=0 且 结果: PASS=14 FAIL=0
- [ ] verify: python3 scripts/control-tower/gen-cto-health.py ⇒ rc=0（改前 rc=1）
- [ ] verify: 三形态夹具判别性 —— 把 gen-cto-health.py:305 还原为 (d.get("spec") or {}).get("path") ⇒ 测试 rc=1 且点名 AttributeError
- [ ] verify: grep -c 'get("spec") or {}' scripts/control-tower/gen-cto-health.py ⇒ 0（旧形态已清除）
- [ ] verify: bash scripts/pre-commit-check.sh ⇒ 13 组通过
