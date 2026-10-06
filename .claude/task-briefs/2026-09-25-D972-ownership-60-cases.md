# Task Brief: D972 ownership 测试 58→60 用例（缩卡）+ CODEOWNERS BOM 核查

> 生成: 2026-09-25 | 分支: fix/d972-ownership-60-cases | base: origin/main `057d8ca0`
> 卡片: task-state/D972.json | 执行: coder-b（并行 CTO 小队）
> #CRITERIA: A

## Q0: 定位

### a) 项目拼图
控制塔治理面（ownership 机器化校验，非产品码）。`docs/synova/coordination/ownership.yaml`
是「文件归属哪个线」的单一事实源，`scripts/control-tower/check-ownership.py` 是判据执行器，
`tests/control-tower/check-ownership.test.sh` 是其物理证明。本卡只扩测试覆盖，不动规则本体。

### b) 文件审计（实测）
```
docs/synova/coordination/ownership.yaml            — ✅ 已含 docs/synova/presets/**（L148）与 .dsh/**（L169）
tests/control-tower/check-ownership.test.sh        — ✅ 基线 58 项（实跑 exit 0）；.dsh 零覆盖（grep 命中 0）
.github/CODEOWNERS                                 — ✅ 首 3 字节 23 20 2e（非 ef bb bf）⇒ 无需重生成
scripts/control-tower/check-ownership.py           — ✅ 工具本体存在（本卡禁改）
```
实测结论：卡面「两条 glob 未落」的前提**已被推翻**（已在 main）⇒ 本卡按队长口径走**缩卡**：
只补测试，不重做落表。另实测 `.dsh/**` 在测试内**零覆盖**（`grep -n '.dsh'` 零结果），是真缺口；
`presets/**` 已被 §5b（D935）覆盖 14 处 ⇒ 不重复堆用例。

### c) 决策
沿用 §5b 既有 D935 判别性夹具范式（`grep -qF` 前置 + 沙箱副本删规则 → 必红），**不另造范式**；
把该范式施加到真正零覆盖的 `.dsh/**`。参考：第一性原理（判据必须真读数据，不能是 grep 型静态判据）
+ 铁律 48（测试非空壳）+ 本卡缩卡口径（不重做已交付内容）+ 结论。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① 实测基线 58 → ② 定位真缺口（.dsh 零覆盖）→ ③ 沿用 §5b 范式补 2 项 → ④ 改坏即红验证 → ⑤ 门禁自过

### b) 执行约束
- rule: "补 2 项后用例数恰为 60"
  verify: bash tests/control-tower/check-ownership.test.sh
- rule: "新增断言须为判别性夹具（删规则即红），非静态判据"
  verify: grep -c 'D972' tests/control-tower/check-ownership.test.sh
- rule: "CODEOWNERS 无 BOM"
  verify: head -c 3 .github/CODEOWNERS | od -An -tx1

## Q2: 范围

**做什么：**
- tests/control-tower/check-ownership.test.sh（增 §5c：`.dsh/**` → mac 正例 + 删规则必红，共 2 项；58→60）
- .claude/task-briefs/2026-09-25-D972-ownership-60-cases.md（新建）
- task-state/D972.json（新建）
- docs/synova/product-lines/evidence/D972-ownership-60-20260925.md（新建；M6 交付回执 —— 必须列入写集，否则 D708 判夹带）

**不做什么：**
- 不改 .github/CODEOWNERS （实测首 3 字节非 ef bb bf，drift 断言已通过，无需重生成）
- 不改 docs/synova/coordination/ownership.yaml （两条 glob 已落 main，本卡缩卡不重做）
- 不改 scripts/control-tower/check-ownership.py （工具本体非本卡写集）
- 不改 scripts/control-tower/daily-cto-board.sh （D1008 单写者，已排他）
- 不改 scripts/audit/K3-*.sh （K3 域，红线）
- 不改 tests/control-tower/task-id-watermark-probe.test.sh （D974 写集）
- 不改 docs/authority/DOCS-REGISTRY.yaml （D973 写集）

## Q3: 验收

入口: `bash tests/control-tower/check-ownership.test.sh`
交互: 各域正例/越域/降级/边界 + §5c 沙箱副本删 `.dsh` 规则后复判
结果: `✅ 全部通过: 60 项`；删规则时同一路径判 mac 必须 exit 1（判别性）

## 架构层: 基础设施

## Done 标准
- [x] verify: bash tests/control-tower/check-ownership.test.sh （输出 `✅ 全部通过: 60 项` exit 0）
- [x] verify: SYNO_TEST_ARM=1 SYNO_CT_STAGED="scripts/control-tower/check-ownership.py" bash scripts/control-tower/ct-test-gate.sh （SYNC-OK exit 0）
- [x] verify: head -c 3 .github/CODEOWNERS | od -An -tx1 （非 ef bb bf）
- [x] verify: grep -c 'D972' tests/control-tower/check-ownership.test.sh （新增判别性夹具存在）
