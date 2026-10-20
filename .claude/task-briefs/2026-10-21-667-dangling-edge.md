# Task Brief: P1 · #667 — 悬挂边修复（MENTIONS target 用真实 Document id · 裁 275）

#CRITERIA: A

## Q0: 定位（项目拼图 + 文件审计）
- **问题**：`src/ingest/knowledge-ingest-bridge.ts` 的 `ingestDocumentText` 调 `store.createNode('Document', …)` 后丢弃返回 id；MENTIONS 边 target 写成 `` `doc_${fileName}` ``——该字符串不是真实节点 id ⇒ 悬挂边（`graph_triples.object_type='unknown'`）。原 catch 只 `log.debug` 静默跳过。
- **本卡**：#667（P1，裁 275 直令）；上游 M2 dangling-edge 教训（`memory/notes/proposed/2026-10-20-656-m2-ingest-entry.md`）。
- **动到的件**：`src/ingest/knowledge-ingest-bridge.ts`（修改）；`tests/ingest/knowledge-ingest-bridge.test.ts`（新建）；`.claude/task-briefs/2026-10-21-667-dangling-edge.md`（本件）；`memory/notes/proposed/2026-10-21-667-dangling-edge.md`（铁律 49 Note）。
- **不做**：不改 `src/adapters/sqlite-graph-store.ts`（写集外）；不改 M9 规格/fixture；不碰 `scripts/audit/**`；不引 DSH 依赖。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）
- **既有接口**：`GraphStore`（`src/l4/graph-bridge.ts`）有 `getNode(id, graph)`、`queryEdges(type?, from?, to?, graph?)`、`createEdge(type, from, to, weight?, props?, graph?)`；`SqliteGraphStore.createEdge` 对缺失端点只把 `subject_type/object_type` 写成 `unknown`，**不抛错**（`src/adapters/sqlite-graph-store.ts:194-221`）。
- **修复点**：必须在 bridge 内、`createEdge` 前断言 target 存在（写集不允许改 global store）；target 用 `createNode('Document')` 返回 id；失败写 `errors[]`＋`log.error`（铁律 11/24，不静默）。
- **测试范式**：`tests/ingest/` 已有 vitest 先例；用 `SqliteGraphStore` 真表；断言 `graph_triples.object_type='Document'`；反例传不存在 target ⇒ 必红；幂等用 `queryEdges` 查重。
- **历史教训**：M2 曾只数 `edgesCreated` 不验端点（dangling edge）；本卡测试必须验 target 存在＋类型，不只数边。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- src/ingest/knowledge-ingest-bridge.ts
- tests/ingest/knowledge-ingest-bridge.test.ts
- .claude/task-briefs/2026-10-21-667-dangling-edge.md
- memory/notes/proposed/2026-10-21-667-dangling-edge.md
不做什么：
- src/adapters/sqlite-graph-store.ts
- src/routes/conversations.ts
- src/agent/conversation-engine.ts
- tests/acceptance/mvp1-m2-ingest-entry.test.ts
- tests/acceptance/mvp1-m3-domain-chain.test.ts
- tests/acceptance/mvp1-m4-output-face.test.ts
- package.json
- tsconfig.json
- scripts/audit/
- scripts/control-tower/
- extensions/sentinels/
- electron-renderer/
- app/

## Q3: 验收（入口 → 交互 → 结果）
- **入口**：`npx vitest run tests/ingest/knowledge-ingest-bridge.test.ts`
- **交互**：`ingestDocumentText` → 建 Person/Team/Document → `createMentionsEdge`（assert target → `queryEdges` 幂等 → `createEdge`）→ 直接查 `graph_triples`。
- **结果**：正例 target=真实 Document id 且 `object_type='Document'`；反例 missing target 抛错且零边；幂等重复只一条；回归 M2＋route 26/26；tsc 0；pre-commit 12 组。
- **反例变异**：target 改回 `` `doc_${fileName}` `` ⇒ 正例必红（errors 非空）；还原后绿。

## Q4 契约与测试
- `createMentionsEdge(store, personId, documentId, orgId): boolean`：target 缺失 ⇒ 抛 `MENTIONS edge target not found: <id>`；已存在 ⇒ false（幂等）；新建 ⇒ true。
- `ingestDocumentText`：边失败写 `errors[]`（`MENTIONS_EDGE_FAILED: …`）＋`log.error`；外层 catch `unknown`；不静默。
- 测试禁 `as any/as never/as unknown as`；`expect()` 非空；不改被测 store 语义。

## 本任务在哪一层
代码层 L2（`src/ingest/` 摄取编排）→ ② 本体/图存储（只读复用 `GraphStore` 接口；不改 `src/l4`）。宪章 §0.4 ② 本体。

## Done 标准（至少一条可验证）
- [x] 新测试 3/3（正例/反例/幂等）→ `verify: npx vitest run tests/ingest/knowledge-ingest-bridge.test.ts`
- [x] 反例变异必红（target 改回 `doc_${fileName}` ⇒ 1 failed）→ `verify: 临时变异后 `npx vitest run tests/ingest/knowledge-ingest-bridge.test.ts`；还原后 3/3`
- [x] 回归 26/26（M2 acceptance＋route＋新测试）→ `verify: npx vitest run tests/ingest/knowledge-ingest-bridge.test.ts tests/acceptance/mvp1-m2-ingest-entry.test.ts tests/routes/conversations.test.ts`
- [x] 类型 0 error → `verify: npx tsc --noEmit`
- [x] 12 组门禁通过 → `verify: bash scripts/pre-commit-check.sh`
