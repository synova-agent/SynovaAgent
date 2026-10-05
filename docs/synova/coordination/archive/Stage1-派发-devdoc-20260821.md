# Stage 1 范式借鉴派发（2026-08-21，CTO 下发 dev-doc session）

> 认领角色：📋 synova-devdoc（写 spec）
> 依据：施工图 DOC-0114 §6 Stage 1 + 第六章借鉴清单 B1/B3/B4/B5
> 流程：dev-doc 写 spec（SYNOVA-IMPL-DSH 编号）→ 编码 session 实现 → K3 审计

---

## 背景（CTO 已读透，dev-doc 写 spec 前复核）

Stage 1 = 借鉴 DSH 的 4 个机制，**复制范式而非代码**（DSH 未稳定，直接引包会引入依赖）。施工图 R1 红线：Stage 3 前零 DSH 代码依赖。

**DSH 借鉴对象（CTO 已读）**：
- dsh-session：`Session` 是 append-only 事件流唯一事实源，LLM 消息历史由 `deriveMessages()` 派生；surface 层做有序投影 + 压缩；`model-visible ⟺ logged`
- .agents/notes：四态（proposed/implemented/archived/rejected）
- snapshot 测试：keyless 回放
- guard 包族：timeout-policy + repeat-tool-reminder

---

## 派发清单（4 个 spec，各独立 PR）

### Spec 1：D1 事件溯源 session log（借鉴 B1）

| 项 | 内容 |
|---|---|
| 借鉴点 | dsh-session 的 append-only 事件流 + `deriveMessages()` + surface 投影 |
| 落地对象 | `src/store/session-store.ts`（现状：sessions 表 + messages 表关系模型，需增加 append-only 事件流） |
| 补缺口 | S3-5（自诊断可信度）+ S0（信任建立）；可回放审计 + fork/resume |
| 验收 | append-only 事件流 + 消息从事件派生 + 可回放 |
| ⚠️ 归属 | **涉及 src/store（🔵 借 DSH 层，归 Win），写集需与 Win 核对**，dev-doc 先出 spec，编码实现前 grep 确认 src/store 归属 |

### Spec 2：D2 Agent Notes 四态（借鉴 B4）

| 项 | 内容 |
|---|---|
| 借鉴点 | .agents/notes 四态（proposed/implemented/archived/rejected） |
| 落地对象 | `memory/notes/`（四态目录已存在）+ 铁律结构化 |
| 补缺口 | S5-3（每次诊断沉淀） |
| 验收 | 四态结构 + 铁律强制（proposed→implemented 迁移规则） |
| 归属 | 治理层，Mac DSH（已有 D395-a 雏形，spec 需对齐现状不重复造） |

### Spec 3：D3 snapshot 测试（借鉴 B3）

| 项 | 内容 |
|---|---|
| 借鉴点 | snapshot 测试 keyless 回放 |
| 落地对象 | `scripts/ci/golden-snapshot-runner.ts`（已有雏形） |
| 补缺口 | 黄金数据集门禁（P1-2，模型/UI 输出可复现） |
| 验收 | 黄金数据集接入门禁 + snapshot 可复现 |
| 归属 | 治理层，Mac DSH |

### Spec 4：D4 guard（借鉴 B5）

| 项 | 内容 |
|---|---|
| 借鉴点 | guard 包族的 timeout-policy + repeat-tool-reminder |
| 落地对象 | `src/agent/tool-loop-executor.ts`（已有 ToolGuard 循环检测雏形） |
| 补缺口 | 防跑偏 + 超时（通用化控制塔） |
| 验收 | 循环卫生 + 超时策略 |
| 归属 | 治理层，Mac DSH |

---

## 给 dev-doc 的要求

1. **每个 spec 先走 `alloc-task-id.sh` 取号**（D1-D4 不直接当 D#，用分配器防撞车）
2. spec 六字段完整（Q0/Q1/Q2/Q3/架构层/#CRITERIA/Done），写集表列出真实文件
3. **复制范式非代码**：spec 里明确"借鉴什么理念、Synova 怎么自研实现"，不引 DSH 包
4. D1 的 spec 特别标注 src/store 归属需 Win 确认
5. 每 spec 完成走 task-state 更新（D382 状态机）

---

## 优先级

D2（Agent Notes，已有雏形最易）→ D3（snapshot，已有雏形）→ D4（guard，已有雏形）→ D1（事件溯源，涉及 src/store 最复杂，放最后 + 需 Win 协调）
