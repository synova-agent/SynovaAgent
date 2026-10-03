# Task Brief: ISSUE#980 无 schema 覆盖的节点类型必须显形（静默放行 → degraded + log.warn）

> 生成: 2026-10-04 | 卡: #980（0-6，第 0 批-止血） | 认领: exec-batch0b
> 派单件: docs/synova/product-lines/dispatch/派单-产品线P0波次-D962-D963与第0批承接-20261004.md
> 参考: 铁律 11/31（静默降级禁止 / 降级信号传播）+ 铁律 47（契约优先）

#CRITERIA: B

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L4 本体层的数据入库校验器。`src/l4/sog-schema-validator.ts` 在 `graph-bridge.ts:82`
的 `store.createNode` 包装处被调用（校验失败 → 记录 + 返回 false，**不阻断写入**）。
现有 8 个 nodeType 有 schema，磁盘上本体共 29 个节点类型 ⇒ 多数类型**无 schema**，
而唯一放行分支 `:141` 是 `if (!schema) return [];` —— **静默放行、零信号**（铁律 11 违例）。
### b) 文件审计
- `grep -n "return \[\]" src/l4/sog-schema-validator.ts` ⇒ `141:  if (!schema) return []; // 未知类型 — 不校验（允许扩展）`
- `validateNodeProps` **零外部调用者**（全仓 grep 仅定义处）⇒ 改其返回类型不产生外部破坏面
- `validateAndLog` 唯一调用者 `src/l4/graph-bridge.ts:82`，**返回值被丢弃** ⇒ 保持 boolean 签名零涟漪
- 覆盖数实测：`NODE_SCHEMAS` 8 键（FINANCIAL/PERSON/CLIENT/RISK/GOAL/AGENT/TEAM/DOCUMENT）；
  节点类型 29 = resource 13 + activity 8 + outcome 8
### c) 决策
复用现有函数与调用链，**不新增导出函数**（避免又一个"定义了没人调"的假门）——
降级信号挂在被调用路径上的 `log.warn` + `validateNodeProps` 的返回结构里。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11/31：放行可以，**静默不行**。降级必须 `log.warn` + 可检查的 degraded 标记。
- 铁律 4/5（写了不接线 = 未交付）：**不新增无人调用的导出**（#985 正是此病）。
- 铁律 47：新增返回结构先写 JSDoc 契约（输入/输出/降级）。
- 卡面口径：「不阻断，但可见」⇒ 校验行为**不变**（仍放行），只增加可见性。
参考：第一性原理（"未校验" ≠ "校验通过"，两者必须可区分）× 开源实证（schema validator 惯例：
unknown type 走 warning 通道并带 coverage 计数，不抛错）× 铁律 11/31 ⇒ 结论：**degraded 标记 + 聚合告警**。

## 写集
| 文件 | 类型 |
|---|---|
| `src/l4/sog-schema-validator.ts` | task |
| `docs/synova/product-lines/evidence/issue980-sog-schema-uncovered-visible-20261004.md` | task |
| `.claude/task-briefs/2026-10-04-ISSUE980-sog-schema-uncovered-visible.md` | builtin（本卡 task brief，流程产物） |

## Q2: 范围 — 正确的最简方案
做什么：
- `src/l4/sog-schema-validator.ts` — `:141` 未知类型分支：登记未覆盖类型 + `log.warn`（含「未覆盖类型 N 个」）+ 返回 `degraded: true`，**仍不阻断**
- `src/l4/sog-schema-validator.ts` — `validateNodeProps` 返回结构改为 `SchemaValidationResult`（带 JSDoc 契约）
- `src/l4/sog-schema-validator.ts` — `validateAndLog` 消费新结构，**保持 boolean 签名**（graph-bridge 零涟漪）
不做什么：
- 不改 `src/l4/graph-bridge.ts`（调用点不在写集；返回值本就被丢弃，无需改）
- 不改 `src/l4/knowledge-store.ts`
- 不改 `scripts/**`（治理线域）
- 不改 `extensions/ontology/**`（本体数据不在本卡写集）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`store.createNode(type, props, graph)`（`graph-bridge.ts:81-82` 包装）
处理：`validateAndLog` → `validateNodeProps` → 未知类型分支登记 + `log.warn`
结果：stderr 出现 `[SOG-schema] 未覆盖类型 N 个（本次新增 <TYPE>）…（degraded，不阻断）`；
      `validateNodeProps(...).degraded === true` 且 `errors.length === 0`（不阻断语义不变）

## 架构层:
L4（本体层 — `src/l4/**`：图存储桥接与 schema 校验；禁跨层，铁律 39）

## Done 标准
- [ ] verify: 夹具调用 `validateNodeProps('SOME_UNCOVERED_TYPE', {})` ⇒ `degraded=true` + `errors=[]`
- [ ] verify: 夹具捕获 stderr ⇒ 命中 `未覆盖类型` + `SOG_SCHEMA_UNCOVERED` + `level:40`
- [ ] verify: 已知类型（如 `FINANCIAL`）仍 `degraded=false`，且违规 props 仍能报错（校验未被削弱）
- [ ] verify: 改坏即红四步（移除 log.warn → 红；移除 degraded → 红；恢复 → 绿）
