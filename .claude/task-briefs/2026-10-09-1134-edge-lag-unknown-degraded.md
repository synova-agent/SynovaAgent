# #1134 — W3 时滞：`action_effect_lag` 越权威枚举（`unknown`）—— 乙路线落地（标 degraded + 落审计）

#CRITERIA: A

## Q0:
定位：模块 **K4 本体·因果边·循环编号**（W3 时滞值侧）。落点不在五层运行时，而在
**防线 / 审计侧**（`tests/` 域）——因实测 `src/` + `packages/` 对 `action_effect_lag` **零消费方**。
背景：55 件 edge-type 全部带 `action_effect_lag`，值分布 `unknown 50 / 3-6_months 2 / immediate 1 /
1_month 1 / 1-3_months 1`；权威文档15 第一章 §3.4 的枚举**只有 6 值、不含 `unknown`**
⇒ 严格枚举校验器上线那一刻，50 条越枚举值会一次性爆（卡面称"定时雷"）。

## Q1:
调研：
- 判据分叉（卡面 §五）：`unknown` **是**显式降级标记 ⇒ 乙（不纳入枚举 + 标 degraded + 落审计）；
  **不是**（只是"暂未标定"）⇒ 甲（改权威文档枚举 + 定义消费语义）。
- 决定性既有判据：`docs/synova/product-lines/evidence/issue987-988-本体边时滞与因果强度-20261004.md:63`
  「其余 **50 条** = `"unknown"`（**显式未知，不留空、不猜数 —— 铁律 11/31**）」；同件 `:41` 值域 = 六值「**外加 `unknown`**」；
  doc15 第三章 `:526`「`action_effect_lag` **未定义** ⇒ 默认值 + **标注 `degraded: true`**」⇒ 降级语义早已写在权威文档，缺的只是实现。
- 职责边界（既有决策）：`memory/notes/proposed/2026-10-07-d1174-ontology-field-guard.md:9`
  「值内容（"unknown"/"TBD"）是数据质量，**归产品线**，不在本防线」⇒ 本卡即该让渡面。
- 历史教训：铁律 11/31（静默降级禁止 + 降级信号传播）；铁律 48（测试非空壳，正常/降级/边界）；
  铁律 0-2（接线 ≠ 被执行）；「禁 grep 型静态判据当验收」（施工项登记 `1-8` 已明文否决 grep 型）。
- 决策参考系：参考 第一性原理（枚举成员 = "有档位"；`unknown` = "无档位"的显式编码，
  两者不可混同）+ 本项目既有判据链（`issue987-988` + doc15 §3.8）+ 控制塔职责边界（D1174）
  ⇒ 结论：**乙**，且落点今天只能在防线/审计侧（零消费者）。

## Q1c:
参考：第一性原理 + 项目既有判据链（issue987-988:63/41、doc15 三章:526）+ D1174 职责边界 + 铁律 11/31
⇒ 结论 = 乙（不纳入枚举）；交付 = 防线/审计侧可执行实现；读取侧 emitter 明确不在本卡。

## Q2:
做什么：
- tests/l4/edge-lag-unknown-degraded-1134.test.ts
- docs/synova/product-lines/evidence/1134-edge-lag-unknown-degraded-20261009.md
- .claude/claims/1134.yaml
- .claude/task-briefs/2026-10-09-1134-edge-lag-unknown-degraded.md
不做什么（含文件路径）：
- 不改 extensions/ontology/edge-types/augments.json（**及该目录其余 54 件——值与键一律不动**，CTO #1350 W3「同形即可、不自创」）
- 不改 extensions/ontology/tags.json（CTO #1350 ruling 6：扩 tags = 放宽 check-file-driven.sh 检查面 = 门禁语义变更）
- 不改 scripts/control-tower/check-ontology-fields.sh（其判据自述冻结，改 = 判据变更 ⇒ 提案→K3→CTO；另立卡）
- 不改 src/l4/ontology-loader.ts（#1031 域；读者侧 emitter 不在本卡）
- 不改 scripts/audit/completion-engine.py（K3 审计域，红线）
- 不改 docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/SYNOVA-RESEARCH-第一章-循环配置规范与动态加载机制-v1-0-20260714.md（权威文档 = 登记件域，甲才需改；乙不动）

## Q3:
入口：`npx vitest run tests/l4/edge-lag-unknown-degraded-1134.test.ts`（vitest job 按 vitest.config.ts:28 自动纳入）
处理：子进程 + `chdir` 沙箱 → 动态 `import` 生产入口 `loadOntology()` 取 55 件字段值 →
  审计函数对每个越允许集值产**具名审计行** + 派生 `degraded` 标记 → 与棘轮基线（55/50/5）比对
结果：**30 用例全绿**；绿腿 `LAG_UNKNOWN=50` / 红腿（1 件真值→`unknown`）`LAG_UNKNOWN=51` ⇒ 棘轮必红；
  真仓 `git status` 洁净（改坏一律在 `mktemp -d` 沙箱内，`finally` 清理）

## 架构层:
防线/审计侧（tests 域）—— 不触 L1–L5 运行时；不触控制塔门禁

## Done 标准
- [x] 定向 vitest 30 用例全绿（正常 7 / 改坏即红 5 / 边界 8 / 降级契约 3 / 报告面 7） verify: npx vitest run tests/l4/edge-lag-unknown-degraded-1134.test.ts
- [x] 真仓数据面 / 生产码 / 门禁 **零改动**（edge-types 值键未动、src 未动、scripts 未动） verify: git diff --name-only origin/main -- extensions/ontology/edge-types extensions/ontology/tags.json src scripts
- [x] 既有防线冻结字段集未被改（仍仅字段名、无枚举） verify: git grep -n '^FIELDS=' -- scripts/control-tower/check-ontology-fields.sh
- [x] 改坏即红可重放：真值→unknown ⇒ 派生降级计数 50→51（沙箱，零真仓写入） verify: bash .k4-publish/redproof.sh
- [x] 写集对账无夹带 verify: bash scripts/control-tower/merge_writeset_gate.py --base origin/main --head HEAD --branch fix/1134-edge-lag-enum
