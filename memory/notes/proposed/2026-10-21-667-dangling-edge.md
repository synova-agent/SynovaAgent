---
状态: proposed
日期: 2026-10-21
任务: #667
---

# #667 悬挂边修复（MENTIONS target 用真实 Document id）

## 现状

`src/ingest/knowledge-ingest-bridge.ts` 的 `ingestDocumentText` 调 `store.createNode('Document', …)` 后**丢弃返回 id**，MENTIONS 边 target 写成 `` `doc_${fileName}` ``；该字符串不是真实节点 id ⇒ 悬挂边（`graph_triples.object_type='unknown'`）。原 catch 仅 `log.debug` 静默跳过，不可观测。

## 决定

1. 接住 `createNode('Document')` 返回值 `documentId`，MENTIONS target 用它；
2. 边写入前 `assertNodeExists(store, documentId, orgId)`（`getNode` 为 null ⇒ 抛错）；
3. 抽出 `createMentionsEdge`：先断言 target，再幂等查重（`queryEdges`），再 `createEdge`；返回 true=新建/false=已存在；
4. 调用方捕获后写 `result.errors[]` ＋ `log.error`（不静默；铁律 11/24）；外层 catch 改 `unknown`。

## 依据

裁 275（CTO：先修 #667，再开 M9）｜#667 卡｜M2 dangling-edge 教训（`memory/notes/proposed/2026-10-20-656-m2-ingest-entry.md`）。

## 证据（本轮实测）

- `npx vitest run tests/ingest/knowledge-ingest-bridge.test.ts` ⇒ **3/3**（正例 target=Document id＋object_type=Document；反例 missing target 抛错且零边；幂等只一条）。
- 反例变异：target 改回 `` `doc_${fileName}` `` ⇒ 正例 **1 failed**（errors 非空）；还原后 3/3。
- `npx vitest run tests/acceptance/mvp1-m2-ingest-entry.test.ts tests/routes/conversations.test.ts` ⇒ **26/26**。
- `npx tsc --noEmit` ⇒ 0；`bash scripts/pre-commit-check.sh` ⇒ 12 组通过。

## 生效时点

本 PR 合入后；M9 依赖此 merge sha（`merge-base --is-ancestor <sha> HEAD`）。
