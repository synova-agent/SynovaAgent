# src/l4/ · 施工守则

> 企业知识图谱本体层（企业"电子病历"）——图桥接 / 实体解析 / 社区报告 / 各类 store。

## 一、这块是什么
- 25 个 `.ts` / 5195 行（`ls src/l4/*.ts | wc -l`）。含 6 个 `*-store.ts`。
- 本体不是 KV：读侧沿边遍历（`queryNodes/queryEdges/traverse`），不直读字段。
- `src/l4/index.ts` 只有 5 个导出，且 `grep -rn "from '\.\./l4'" src/ --include="*.ts"` 实测 **0 命中** —— barrel 不是入口面，往它加导出 ≠ 接线。

## 二、谁可以改
- **归属**：产品线（`decisions/implemented/process/2026-10-02-role-division-final.md:47`）。
- ⚠️ 机器源未回写：`python3 scripts/control-tower/check-ownership.py src/l4/graph-bridge.ts` 实测输出 `win`（ownership.yaml 停留 2026-09-24）。冲突按本节归属，并上报 CTO。
- **改这块必须同时改**：`tests/l4/<同名>.test.ts`（现 26 个）＋ `tests/contract/l4-contract.test.ts`；store 装配点 `src/deploy/bootstrap.ts:775`；若新增 L1 直连 → `tests/architecture/l1-cross-layer-baseline.txt`（棘轮，只减不增，上调须 CTO 逐例批）。
- **越界判定**：`python3 scripts/control-tower/check-ownership.py <file...> --owner win`；**越界找**：CTO（治理线）。

## 三、改完怎么算完成
- **必须穿的生产入口**（要真调用链，不是 grep 命中）：
  1. 诊断主链：`POST /api/diagnosis/consult`（`src/routes/diagnosis.ts:189`）→ 该文件 `:501` 动态 import `src/agent/post-diagnosis-processor.ts` → 后者 `:103-109` 才真 import l4 三件套并调用 `createGraphBridge` / `generateCommunityReports` / `resolveEntitiesL3`。
  2. 记忆读链：`GET /api/actions`（`src/routes/actions-api.ts:54`）、`GET /api/notifications`（`src/routes/notifications.ts:74`）→ `src/services/memory-access-service.ts:14` → `l4/agent-memory-store`。
- **本域独有红线**（执法：`bash scripts/check-architecture.sh`）：
  1. `GraphStore` 只许在 `graph-bridge.ts` 声明 1 处（脚本 `:202-218`；实测 `graph-bridge.ts:30`）。
  2. L2（`src/agent/`、`src/orchestrator/`）不得 import l4，除 8 个白名单桥接（清单即脚本 `:46`）。
  3. L1→L4 存量 10 处是棘轮（基线 `:44-54`）只减不增；真豁免写行内 `// arch-allow(L4): 理由`。
  4. `queryNodes/queryEdges` 必须显式传 `graph`（多租户，脚本 `:220-234`）。
  5. 目录缺失必须 `degraded: true`，不许静默返空（现状正确：`industry-loader.ts:25`、`adapter-loader.ts:25`、`ontology-loader.ts:115`）。
- **「改坏即红」最小用例**（2026-10-02 在 `/tmp` 夹具上跑**真门禁**实测）：
  1. 在 l4 再写一次 `export interface GraphStore ` ⇒ `bash scripts/check-architecture.sh` ⇒ `❌ GraphStore 接口多处声明: 2 处`，exit 1；删除 ⇒ `架构检查: 全部通过 ✅`，exit 0。
  2. 新增任一 L1 文件 `import('../l4/agent-memory-store')` ⇒ `SYNO_CI=1 bash scripts/check-architecture.sh` ⇒ `❌ L1→L4 基线外新增 1 处`，exit 1；复原 ⇒ exit 0。
  3. 回归：`npx vitest run tests/l4 tests/contract/l4-contract.test.ts`【待定：本 session 内 vitest 原生绑定 `@rolldown/binding-darwin-arm64` 加载失败，未实跑】

## 四、不在这里的事
- `loadCycles` 在 `src/cycles/cycle-loader.ts:44` —— "目录缺失静默返 0" 属 `src/cycles/`，不在本域。
- `evidence/`（Collector/Corroboration）是同层邻域但独立目录；engine-core 已退役（`graph-bridge.ts:26`），别再引。
- `docs/synova/product-lines/product-progress.json` 的 `state_unknown=92` 按域不可归因（该文件 0 处提到 l4），不是本域待办。

## 五、不确定找谁
| 问题类型 | 找谁 |
|---|---|
| 归属冲突 / 门禁误拦漏拦 | CTO（治理线，`scripts/control-tower/**`） |
| 节点边语义 / 本域改动本身 | 产品线（本域 owner） |
| 审计结论 | K3（审计线，其他角色禁碰） |
