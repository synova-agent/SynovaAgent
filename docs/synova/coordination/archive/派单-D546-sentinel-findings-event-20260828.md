# 派单：哨兵 findings 事件化（D546，K3 战略 D394 片1）

> 派单: CTO | 2026-08-28 | 认领: 📋 dev-doc（撰写实现 spec）→ 🛠 编码（按 spec 执行）→ K3 → CTO 合并
> 方法论: K3 战略咨询（2026-08-16）D394 片1——「哨兵 findings 事件化先做（2-3 天）」，Mac 线现在做；与 Win 侧片2-A（D487 GA 诊断会话事件化，PR #241）并行推进
> 流程: dev-doc 出 spec → 编码按 spec 实现 → K3 审计 → CTO 合并
> 上一轮教训: D545 编号被 Win 侧分支名占用（跨线取号前应先 `git ls-remote --heads origin | grep win` 查占用）；Win 侧 D487 片2-A dev doc 已合 main（PR #241）——spec 须与片2-A 的事件契约对齐，避免两线事件格式分叉

---

## 写前核实（强制清单 — §〇c ①）

- [x] ① 任务来源/依赖: K3 战略咨询 D394 片1（台账 2026-08-16 战略定调：「D394 改切片（片1 哨兵 findings 事件化先做 2-3 天）」+ 战略终版「部署期优先于一切借鉴」）。并行线：Win D487（片2-A GA 诊断会话事件化 dev doc 已合 main）。
- [x] ② task-state 最新状态: D546 = claimed（本单新取号；D545 作废让渡 Win，见上一轮教训）。
- [x] ③ 基线资产实际存在（物理确认）:
  - `src/sentinel/runner.ts`（1100+ 行）——findings 流转：`records`（L247 flatMap）→ `GET /api/sentinel/findings`（零 routes 改动可见）
  - **durationMs 时间戳 bug**（K3 发现并入片1）：runner.ts L363/724/773/1081/1134 多处 durationMs——spec 阶段须定位「当时间戳用」的确切行（K3 原文：恒 1970）
  - 哨兵双体系：extensions/sentinels/ 45 文件驱动 + src/sentinel/adapters/ 4 内置 = 49 活跃
  - L07-1「哨兵调度真实运行」/ L07-3「监测结果持久化」已 verified（findings 持久化基础在）
- [x] ④ DSH 借鉴核查: 见下「DSH 借鉴核查」章节。
- [x] ⑤ 写集重叠检查: D546 未占用；与 D544（electron-renderer + tests/electron）零重叠；与 Win D487（GA 会话事件，Win 领地）跨线不重叠但**契约需对齐**。
- [x] ⑥ 上一轮教训: D545 编号让渡（跨线查占用）；D540 CI 红（交付贴 check-runs）；D543 解析器双源（事件契约单源化）。

## DSH 借鉴核查（强制章节 — §〇b 三步）

1. **施工图四色归属**: 哨兵体系 = 🟢 死守（src/sentinel/ 领域核心）。本次「事件化」涉及 src/store/（SessionStore 事件溯源）——施工图 §3 🔵 借 DSH（core/session 事件溯源，658 LOC，「Stage 1 借鉴理念自研」）。
2. **借鉴边界判定**: **有 DSH 借鉴（理念级）**——事件溯源范式（append-only log + 冷恢复，model-visible⟺logged 分离）。Stage 1 借鉴理念自研，**不引代码、不 npm install**。注意：D500 已做过 store 层事件流+直连双写（engine 悬空 seam 是已知遗留），spec 须先核 D500 的 store 现状再设计（复用而非重做）。
3. **DSH 源码参考**: `@deepseek-ai/dsh-session-persistence-jsonl/`（append-only JSONL 持久化范式）；`dsh-session/`（事件 log 与模型可见态分离）。读范式不 copy。

> 红线：借鉴 = 读范式自研；不引 DSH 代码；不复制 OpenViking（AGPLv3）；验收含接线审计。

---

## 切片定义（CTO 已定，dev-doc 复核）

| 切片 | 用户可见价值 | 验证锚点 | 依赖 |
|---|---|---|---|
| D546（本次） | 哨兵 findings 从「内存 records + 定时落库」升级为事件流（append-only），支撑片2 诊断会话事件化契约 | findings 事件可回放 + durationMs 修复 + 与 D487 契约对齐 | 无（可与 D544 并行，写集零重叠） |
| （Win 线）D487 片2-A | GA 诊断会话事件化 | Win 领地 | 契约对齐本单 |
| （后续）片3 | fork/resume | Q4 期权 | 片1+片2 |

## 现状材料（dev-doc 必读，先读实际代码不凭记忆）

| 资产 | 位置 | 状态 | 与本单的关系 |
|---|---|---|---|
| findings 流转 | `src/sentinel/runner.ts` L247/328-363 | records 内存 + self-check 可见 | 事件化改造对象 |
| durationMs | `src/sentinel/runner.ts` L363/724/773/1081/1134 | K3 发现「当时间戳恒 1970」 | 片1 顺带修复 |
| D500 store 事件流 | task-state/D500.json + src/store/ | store 层事件流+直连双写已落地（engine 悬空 seam 遗留） | 复用评估——勿重做 |
| Win 片2-A 契约 | PR #241（D487 dev doc，129 行） | 已合 main | **事件契约对齐对象**（防两线格式分叉） |
| 哨兵双体系 | extensions/sentinels/ + src/sentinel/adapters/ | 49 活跃 | 事件化的数据来源 |

## D546：sentinel-findings-event（findings 事件化）

**目标**: 哨兵 findings 产生时写 append-only 事件流（而非仅内存/覆盖式落库），事件可回放；durationMs 时间戳 bug 修复；事件契约与 Win 片2-A 对齐。

**依赖**: 无硬依赖（与 D544 并行，写集零重叠；契约层面与 Win D487 对齐）。

**spec 必须覆盖的内容**（dev-doc 撰写时逐节落实，缺一返修）:

1. **「事件模型」章节**: findings 事件的 schema（事件类型/载荷/时间戳语义）、append-only 存储位置（文件 or store 表）、与现有 records/落库的关系（并存 or 替换）——**必须先读 D500 store 现状再定**（复用 vs 新建，防重复建设）。
2. **「D500 复用评估」章节**: D500 已落地 store 层事件流+直连双写（engine 悬空 seam 遗留已知）——spec 明确 findings 事件走 D500 的 store 通道还是独立通道，理由。
3. **「durationMs bug 定位」章节**: K3 原文「当时间戳恒 1970」——spec 给出确切 file:line（5 处候选中定位）+ 修复方案 + 回归测试要求。
4. **「与片2-A 契约对齐」章节**: 对照 Win D487 dev doc（PR #241）的事件字段/格式——findings 事件与 GA 会话事件的公共契约（共享 schema 或显式转换），防两线分叉。
5. **「测试与验收」章节**: 事件可回放断言（写→读→重放一致）、durationMs 回归测试、接线断言（新 export 生产调用点）、L07 监测线验证点收益标注。

**验收**（物理可复现，禁止文档声称）:

- **事件回放断言**: 产生 findings → 事件落盘 → 重新读取/回放 → 与产生时一致（sha256 或逐字段断言）。
- **durationMs 断言**: 修复处跑一次真实 sentinel check，durationMs 为合理正值（非 0/非 1970 纪元）。
- **契约断言**: findings 事件字段 ⊆ 与 D487 对齐的公共契约（spec 列字段表）。
- **CI 断言**: check-runs 三 job 全 success（贴结果，本地绿不算——D540 教训）。
- **接线断言**: 新 export 在 routes/ 或 l3/ 有生产调用（测试调用不计）。

## 写集约束

- **可碰**: src/sentinel/（runner.ts 及新事件模块）、src/store/（若走 D500 通道）、src/l3/（若涉及）、tests/（新事件测试）。
- **不碰**: electron-renderer/（D544 领地）、scripts/audit/（K3 红线）、scripts/pre-commit-check.sh、.github/workflows/ci.yml、Win 领地文件（GA 会话）。
- **防膨胀（红线）**: 零新组件/守护进程/launchd；复用 D500 store 或现有落库通道；不引 DSH 依赖。
- **并行纪律**: 与 D544 并行（写集零重叠）；各自独立 clone 工作（D540 机制）；契约对齐通过读 main 上 D487 dev doc（不跨线直接改对方文件）。

## 切片级审计

- 本单完成后 K3 审计（含 CI check-runs 核对）。
- task-state 加 `"slice": "d394-slice1"` 字段。
- 审计验收 = 事件回放断言 + durationMs 修复 + 契约对齐表 从 impl_done → verified。

## 给 dev-doc 的交付要求

1. **spec 文件命名**: `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D546-sentinel-findings-event-20260828.md`
2. **spec 读者是编码 session**: 拿到即可执行，零二次提问；北星 front-matter 对齐 L07 监测线 + K3 咨询「护城河=本体被真实数据验证的速率」。
3. **D500 复用评估必须先读代码**（src/store/ 实际现状），不凭 task-state 描述。
4. **契约对齐表**必须列字段级对照（findings 事件 vs D487 GA 会话事件）。
5. **诚实声明**: 若发现 K3「durationMs 恒 1970」描述与代码不符（bug 已修/位置不同），spec 如实标注。

---

## 写后自检（强制清单 — §〇c ③）

- [x] ① 验证锚点正确（事件回放 + durationMs + 契约对齐，对应 L07 监测线）
- [x] ② D# 未占用（D546 刚取号；D545 作废让渡已注记）
- [x] ③ 依赖链正确（与 D544 并行零重叠；下游片2/片3 显式）
- [x] ④ DSH 借鉴核查三步完整（🟢哨兵 + 🔵事件溯源理念 + dsh-session-persistence-jsonl 参考）
- [x] ⑤ 现状材料全部核实过（runner.ts 行号实测 grep、D500 store、D487 契约 PR #241）
- [x] ⑥ 验收物理可复现（回放/durationMs/契约/CI/接线五断言）
- [x] ⑦ 术语一致（findings 事件/哨兵双体系/L07，与 K3 咨询一致）
- [x] ⑧ 无遗漏（并行纪律、D500 复用评估、契约对齐、诚实声明）

**交付门槛**: dev-doc 拿到派单可直接撰写 spec（基线/借鉴/写集/契约全给）+ 编码拿到 spec 即可执行。

---

## 派单说明（给创始人复制——自包含，零查找）

```
【派单】哨兵 findings 事件化（D546，K3 战略 D394 片1）
> 认领: 📋 dev-doc（撰写实现 spec）→ 🛠 编码（按 spec 执行）→ K3 → CTO 合并
> slice: d394-slice1 | 与 D544 并行（写集零重叠）

## 背景（一句话）
K3 战略咨询排定的部署期任务：哨兵 findings 从内存/覆盖式落库升级为
append-only 事件流（片1），与 Win 侧片2-A（D487 GA 会话事件化，已出 dev doc）
形成双线，契约对齐防分叉。

## 现状材料（撰写必读，均在 main）
- src/sentinel/runner.ts L247/328-363 —— findings 流转现状（records 内存 + self-check）
- src/sentinel/runner.ts L363/724/773/1081/1134 —— durationMs 候选（K3 报「恒 1970」，spec 定位确切行）
- task-state/D500.json + src/store/ —— D500 store 事件流已落地（复用评估，勿重做）
- PR #241（D487 片2-A dev doc）—— 事件契约对齐对象

## spec 必须覆盖（5 章节）
1. 「事件模型」: schema/存储位置/与 records 关系（先读 D500 现状再定）
2. 「D500 复用评估」: findings 事件走 store 通道还是独立通道 + 理由
3. 「durationMs bug 定位」: 确切 file:line + 修复 + 回归测试
4. 「与片2-A 契约对齐」: 与 D487 GA 会话事件的公共契约字段表
5. 「测试与验收」: 回放断言 + durationMs 回归 + 接线 + L07 收益标注

## 写集约束
- 可碰: src/sentinel/、src/store/（若走 store 通道）、src/l3/、tests/
- 不碰: electron-renderer/（D544 领地）、scripts/audit/、pre-commit-check.sh、ci.yml、Win 领地（GA 会话）
- 防膨胀: 零新组件，复用 D500 store 或现有通道，不引 DSH 依赖
- 并行纪律: 独立 clone 工作（D540 机制）；契约对齐靠读 main 的 D487 doc，不跨线改文件

## 验收（物理可复现）
- 事件回放: 产生→落盘→回放一致（sha256/逐字段）
- durationMs: 真实 sentinel check 跑出合理正值（非 0/1970）
- 契约: findings 事件字段 ⊆ 公共契约表
- CI: check-runs 三 job 全 success（贴结果）

## 交付要求（给 dev-doc）
1. spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D546-sentinel-findings-event-20260828.md
2. D500 复用评估先读 src/store/ 实际代码；契约对齐列字段级对照表
3. 若 K3「durationMs 恒 1970」与代码不符，spec 如实标注
```
