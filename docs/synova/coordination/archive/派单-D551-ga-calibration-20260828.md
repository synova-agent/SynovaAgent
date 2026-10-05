# 派单：GA 校准后端 spec 撰写（D551）

> 派单: CTO | 2026-08-28 | 认领: 📋 dev-doc（撰写 spec）→ 🛠 编码（实现，部署后排期）→ K3 → CTO 合并
> 方法论: T-M-03 前置（左栏 GA 置灰转真实数据）——GA 人机协同闭环（S5-2 GA 纠错回流，K3 定"断裂"）
> 流程: dev-doc 出 spec → 编码实现（**实现排部署后**，spec 先就绪）→ K3 审计 → CTO 合并
> 上一轮教训: D546 派单 durationMs 位置误标（基线核实不足）——本单基线已精确 grep；spec 撰写先读实际代码不凭记忆

---

## 写前核实（强制清单 — §〇c ①）

- [x] ① 任务来源/依赖: T-M-03（左栏 GA 项置灰转真数据）前置——`/api/ga/calibration` 后端缺失（台账 2026-08-26 登记："GA 人机协同属 Module-3，后端未做，届时前端 GA 项从置灰转真实接入"）。上游：D476（GA 范围，spec 在 main）+ D544（左栏实现，GA 项置灰已完成）。
- [x] ② task-state 最新状态: D551 = claimed（本单）；D550 已补记 alloc-origin 修复（撞号让渡）。
- [x] ③ 基线资产实际存在（物理确认，精确 grep）:
  - `src/routes/ga-admin.ts` L66/88/125：`GET/POST /api/ga/clients` + `POST /api/ga/switch/:orgId`（客户管理+切换，已存在）
  - `src/routes/ga-annotations.ts` L70/147/221：`POST/GET /api/ga/annotations` + `GET /api/ga/annotations/stats`（标注 CRUD+统计，已存在）
  - `src/routes/ga-annotations-types.ts`（标注类型）
  - `electron-renderer/src/stores/capability.ts`：`canAccessCap` GA 权限门控（fail-closed，cap==='ga' 仅 role==='ga'）
  - **`/api/ga/calibration` 缺失**（grep 零命中，已确认）
  - D476 spec：`docs/plans/codex/implementation/D476-ga-enterprise-scope-20260823.md`
- [x] ④ DSH 借鉴核查: 见下「DSH 借鉴核查」章节。
- [x] ⑤ 写集重叠检查: spec 是文档（docs/plans/），与在途（register src/middleware/、D548 product-lines/）零重叠。
- [x] ⑥ 上一轮教训: 基线核实精确 grep（防 D546 durationMs 误标）；spec 撰写先读实际代码。

## DSH 借鉴核查（强制章节 — §〇b 三步）

1. **施工图四色归属**: GA 协同模块——企业多用户领域能力，施工图 §3 混合模块「偏 🟢 做深」。
2. **借鉴边界判定**: **理念级借鉴 DSH feedback 范式**——施工图 §4「反馈闭环 feedback：log-only 不进模型，Stage 1 借鉴（补 N13 断裂）」。GA 校准回流的本质正是反馈闭环：GA 校准/注入 → 回流改进诊断。借鉴"log-only 不进模型"的分离理念（校准记录可审计、不直接改模型），**不引代码**。
3. **DSH 源码参考**: 无直接代码（feedback 是理念借鉴）；对应 Synova 自己的 N13 断裂（middle-evolution 零调用，D333 在做）——spec 需评估校准回流是否与 D333 进化闭环共享通道（防两套回流机制分叉）。

> 红线：借鉴理念自研；不引 DSH 代码；验收含接线审计。

---

## 切片定义（CTO 已定，dev-doc 复核）

| 切片 | 用户可见价值 | 验证锚点 | 依赖 |
|---|---|---|---|
| D551（本次） | spec 就绪——GA 校准三块（校准面板/信号注入/效用仪表）设计成可执行规格 | spec 质量门禁 + 契约可执行 | 上游 D476/D544 已合 |
| （后续，部署后）实现 | GA 人机协同闭环 | /api/ga/calibration 接线 + 前端 GA 项转真实数据 | 本单 spec + 部署后 |

## 现状材料（dev-doc 必读，先读实际代码不凭记忆）

| 资产 | 位置 | 状态 | 与本单的关系 |
|---|---|---|---|
| GA 客户管理 | `src/routes/ga-admin.ts` L66/88/125 | clients CRUD + switch 已存在 | calibration 的上下文（客户维度） |
| GA 标注 | `src/routes/ga-annotations.ts` L70/147/221 | annotations CRUD + stats 已存在 | **复用评估对象**（calibration 是否扩展标注而非新建） |
| 前端门控 | `electron-renderer/src/stores/capability.ts` | canAccessCap fail-closed，GA 项置灰 | calibration 转真实数据的对接契约 |
| 范围定义 | `docs/plans/codex/implementation/D476-ga-enterprise-scope-20260823.md` | GA 范围已定 | spec 引用权威 |
| 回流断裂 | 台账 S5-2「GA 纠错回流断裂」+ N13（middle-evolution 零调用，D333 在做） | 断裂 | calibration 回流设计必须评估与 D333 的关系 |

## D551：ga-calibration-backend-spec（GA 校准后端 spec）

**目标**: 产出 GA 校准后端的可执行 spec——编码拿到即可实现（部署后），左栏 GA 项从置灰转真实数据的契约清晰。

**依赖**: 无（spec 是文档；实现排部署后）。

**spec 必须覆盖的内容**（dev-doc 撰写时逐节落实，缺一返修）:

1. **「复用评估」章节（先读 ga-annotations.ts 实际代码）**: calibration 三块（诊断校准/手动信号注入/反馈效用仪表）中，哪些能**扩展 annotations**、哪些必须新建——防止重复建设（标注 vs 校准的边界：标注是"记录意见"，校准是"修正结论并回流"，两者的数据模型差异要写清）。
2. **「校准数据模型」章节**: calibration 的 schema（校准对象=诊断报告？finding？；校准动作=认可/修正/打回；版本链——多次校准怎么追踪）；手动信号注入的 schema（信号类型/来源/有效期）。
3. **「回流机制」章节（关键，S5-2 断裂）**: 校准结果如何回流改进诊断——**必须评估与 D333（进化闭环 middle-evolution）的关系**：共用通道还是独立通道？防两套回流分叉。诚实标注：若 D333 未完成导致回流只能"记录待用"，spec 如实写（不假装闭环）。
4. **「前端契约」章节**: 与 capability.ts 的 GA 权限门控对接——左栏 GA 项从置灰转真实数据需要的 API 契约（接口清单 + 请求/响应 schema + GA 角色验证）。
5. **「测试与验收」章节**: calibration 三块的测试要求（正常/降级/边界）+ 接线审计（新路由在 server.ts 挂载 + 前端调用点）。

**验收**（物理可复现，禁止文档声称）:

- **复用评估断言**: spec 明确扩展 vs 新建的边界（引用 ga-annotations.ts file:line）。
- **契约断言**: API 契约表（接口/请求/响应/角色验证）完整可执行。
- **回流诚实断言**: S5-2 断裂的回流设计有明确结论（共用/独立通道 + D333 依赖如实标注）。
- **spec 质量**: dev-doc-gatekeeper exit 0（如有）+ 北星 front-matter 对齐 PRODUCT-BRIEF GA 定义。

## 写集约束

- **可碰**: `docs/plans/codex/implementation/`（新 spec 文档）、`docs/synova/coordination/`（派单）。
- **不碰**: `src/`（只读核实，不改代码——spec 是文档）、`scripts/audit/`（K3 红线）、`electron-renderer/`（只读核实契约）。
- **防膨胀**: spec 明确"复用优先"（扩展 annotations 优先于新建）；回流设计评估 D333 共享通道，禁止设计第二套进化回流。

## 切片级审计

- spec 交付 → CTO 复核（复用评估/回流诚实断言）→ 实现排部署后。
- task-state 加 `"slice": "ga-module-3"` 字段。
- 审计验收 = 复用评估 file:line + 契约表 + 回流诚实声明 从 spec_done → 实现前复核。

## 给 dev-doc 的交付要求

1. **spec 文件命名**: `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D551-ga-calibration-backend-20260828.md`
2. **spec 读者是编码 session**: 拿到即可实现（复用边界/数据模型/契约全给）。
3. **基线引用精确 file:line**（D546 教训：durationMs 误标）——ga-admin/ga-annotations 的行号已核实，spec 引用须再复核一遍。
4. **回流诚实声明**: S5-2/D333 关系如实写，不假装闭环。

---

## 写后自检（强制清单 — §〇c ③）

- [x] ① 验证锚点正确（复用评估 + 契约表 + 回流诚实断言）
- [x] ② D# 未占用（D551 取号；D550 撞号已让渡补记）
- [x] ③ 依赖链正确（上游 D476/D544 已合；实现排部署后显式）
- [x] ④ DSH 借鉴核查三步完整（🟢 做深 + feedback log-only 理念借鉴 + 无直接代码）
- [x] ⑤ 现状材料全部核实过（ga-admin/ga-annotations 行号精确 grep、capability 门控、D476 在 main）
- [x] ⑥ 验收物理可复现（复用 file:line/契约表/回流诚实）
- [x] ⑦ 术语一致（GA=诊断顾问角色/校准=修正并回流/标注=记录意见，与 D476 一致）
- [x] ⑧ 无遗漏（复用评估、回流与 D333 关系、前端契约、防膨胀）

**交付门槛**: dev-doc 拿到派单可直接撰写 spec（基线/复用边界/回流关系/契约全给）+ 编码拿到 spec 即可实现。

---

## 派单说明（给创始人复制——自包含，零查找）

```
【派单】GA 校准后端 spec 撰写（D551）
> 认领: 📋 dev-doc（撰写 spec）→ 🛠 编码（实现排部署后）→ K3 → CTO 合并
> slice: ga-module-3

## 背景（一句话）
左栏 GA 项现在置灰——/api/ga/calibration 后端缺失。本单让 dev-doc 把 GA 校准
三块（诊断校准/手动信号注入/反馈效用仪表）设计成可执行 spec，实现排部署后。

## 现状材料（撰写必读，均已精确核实）
- src/routes/ga-admin.ts L66/88/125 —— clients CRUD + switch 已存在（上下文）
- src/routes/ga-annotations.ts L70/147/221 —— 标注 CRUD + stats 已存在（复用评估对象）
- electron-renderer/src/stores/capability.ts —— canAccessCap GA 门控 fail-closed（前端契约）
- docs/plans/codex/implementation/D476-ga-enterprise-scope-20260823.md —— GA 范围权威
- 台账 S5-2「GA 纠错回流断裂」+ N13（D333 在做）—— 回流设计必须评估与 D333 关系

## spec 必须覆盖（5 章节）
1. 「复用评估」: 校准三块哪些扩展 annotations、哪些新建（先读实际代码，标注 vs 校准边界）
2. 「校准数据模型」: schema（校准对象/动作/版本链）+ 信号注入 schema
3. 「回流机制」: 校准如何回流改进诊断——与 D333 共用还是独立通道（防两套分叉）；
   若 D333 未完成只能"记录待用"，如实写不假装闭环
4. 「前端契约」: 左栏 GA 置灰转真实数据的 API 契约（接口/请求响应/GA 角色验证）
5. 「测试与验收」: 三块测试要求 + 接线审计

## 写集约束
- 可碰: docs/plans/codex/implementation/（新 spec）
- 不碰: src/（只读核实）、scripts/audit/、electron-renderer/（只读契约）
- 防膨胀: 复用优先（扩展 annotations 优先新建）；回流禁设计第二套进化机制

## 验收（物理可复现）
- 复用评估引用 ga-annotations.ts file:line
- API 契约表完整可执行
- 回流与 D333 关系有明确结论（诚实标注依赖）

## 交付要求（给 dev-doc）
1. spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D551-ga-calibration-backend-20260828.md
2. 基线引用精确 file:line（先再复核一遍行号）
3. 回流诚实声明（不假装闭环）
```
