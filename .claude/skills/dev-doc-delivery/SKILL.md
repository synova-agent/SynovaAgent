---
name: dev-doc-delivery
description: dev doc 交付附带编码指令——把创始人标准模板（认真阅读/最高代码水平/plan mode/复核清单/K3 审计）针对当前任务定制成编码 session 启动指令。每次 dev doc 交付汇报前使用，产出"编码指令-<任务>-<date>.md"随 spec 一起交付。历史：创始人 2026-08-25 要求"交付结果顺便带编码 session 任务指令"；触发词：编码指令/编码session/交付指令/启动指令。
---

# dev-doc-delivery — dev doc 交付附带编码指令

## 使用时机

每次 dev doc 交付（流程第⑦步汇报）前，生成**编码 session 启动指令**作为交付物的一部分。

**硬规则：dev doc 交付 = spec 文件 + task-state 回填 + 编码指令，三件套缺一不可。** 缺编码指令 = 交付不完整（铁律 4 精神：编码 session 拿不到任务指令就无法开工）。

## 输入

- 本次交付的 spec 文件路径（`docs/plans/codex/implementation/SYNOVA-IMPL-*.md`）
- 派单文档路径（`docs/synova/coordination/派单-*.md`）
- 任务专属材料：依赖声明 / K3 教训 / 写集约束 / 红线 / 环境坑 / 验证点收口口径

## 生成方法（7 段结构，模板文件：`template/编码指令模板.md`）

1. **任务文档表**：spec（编码唯一契约）+ 派单 + 北星（PRODUCT-BRIEF §节 + 施工图 §节）+ 前车之鉴（K3 审计报告）——编码 session 先读后动。
2. **执行要求**：认真阅读 spec 关键节（§1 Authority / §4 Current State / §5 写集 / §7 测试 / §10 DS）→ 复杂任务先 plan mode 列改动清单再动手 → 最高代码水平（as any=0 铁律 38 / 契约优先 JSDoc 铁律 47 / 降级诚实 log+degraded 铁律 24+31 / 测试非空壳三路径铁律 48）。
3. **任务专属硬约束**（本任务特有，逐条写死，违反 = 审计 FAIL）：
   - **依赖前置 + 基线核验**：基线分支/commit + 哪些上游切片/任务须先合入 + 编码前 `git fetch --all && git pull --ff-only` + 重新核验 spec 行号（防 M7 漂移——D524 教训：照旧行号写测试会红）；前置未满足 → waiting 不伪造实测。
   - **写集精确性**：只改 spec §5.1 写集表文件；`git diff --name-only` 与实际改动完全一致；禁"树终验声称不符"。
   - **诚实 RED**：LLM/外部依赖/上游产物不可用时如实标注 ⏸/❌ + 理由（README + evidence 双处），禁伪造绿、禁契约断言冒充全链路。
   - **evidence 落盘规范**：计时/断言/指纹/时间戳落盘（evidence 目录），K3 独立重跑可复现；禁仅 task-state 单副本。
   - **红线**：不碰 src/（如派单规定）、不碰 scripts/audit/（K3 专属）、零 DSH 依赖（Stage 3 前）。
   - **环境坑**：实测发现的宿主环境坑（如 `ELECTRON_RUN_AS_NODE=1`）。
4. **复核清单**（做完逐项自查，K3 会盯着 + 最后审计）：
   - 与 dev doc 一致：spec §10 DS 逐项对照（S-2 声称=实现+验收，禁 overclaim）
   - 铁律：接线完整（新 export 有**生产**调用点，测试调用不计 S-3，spec §8 逐条 grep）、降级诚实（24+31）、类型安全（38）、契约优先（47）、测试非空壳（48）、架构边界（39/46）
   - 无 bug：spec §7 verify 命令逐条跑通 + vitest 全绿 + pre-commit 全过（禁 --no-verify）+ synova-commit（禁 git stash，铁律 0-3）
   - 接线完整：spec §8 每条 grep 出真实生产调用点
   - 测试到位：red→green 已证、三路径覆盖、expect 非空壳
   - 其他：残留清理（死代码 grep 零）、文件驱动（manifest/tags）、产物可复现性（幂等+dry-run）
5. **审计提示**：提审口径（一次提审覆盖哪些 D）+ 验证点收口（如 5/8→8/8）+ task-state impl 段回填要求 + 脚本可复现要求（审计员独立重跑）。
6. 结尾固定句：**"开始吧。"**

## 模板要点保留清单（创始人标准模板，一个不丢）

- [ ] 认真阅读任务文档，然后执行任务
- [ ] 做到你的最高代码水平
- [ ] 任务复杂 → 先用 plan mode 做好计划再执行
- [ ] 先想清楚再动手（禁止没想清楚就改代码）
- [ ] 做完复核：与 dev doc 一致 / 不违反铁律 / 无 bug / 接线完整 / 测试到位 / 其他你认为需要复核的点
- [ ] Kimi K3 会盯着你的任务，也会做最后的审计

## 落盘

- 路径：`docs/synova/coordination/编码指令-<任务名>-<YYYYMMDD>.md`（与派单同目录，随 spec 交付）
- 交付时在汇报里给出指令全文（用户可复制）+ 落盘路径
