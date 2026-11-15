# #1398 1B 中性首次企业扫描｜执行记录

- 权威：Gitea Issue #1398 评论 12428（`gateA-approved-2026-11-14`）与评论 12430（`synova-1b-transitional-v1`）。
- 固定 DEV DOC SHA-256：`b54cdd6a71447d059d04e5b4026ff6037402e0e794cbb44ba17dbbd98864d840`。
- Base：`8abdaa7cf9e11ef27f49682e77e86c0d12ffed12`；Branch：`feat/1398-enterprise-scan`。
- 范围：仅合成 CSV／Markdown／JSON 的⓪证据接入与②结构映射。交付只是中性样例，不表示客户瓶颈。

## 实现级历史资产审计

以下结论来自固定 base 的实际代码与调用链，而非仅按文件是否存在判断。

### 可直接复用

1. `src/middleware/auth.ts` 的 `jwtAuthMiddleware`、`signJwtToken`：`src/server.ts` 在路由前统一验签并注入 `req.auth`；新路由只读取其中的 `sub/orgId/role/departmentIds`。真实路由测试覆盖无、空、无效 token 均为 401 `UNAUTHORIZED`。
2. `src/adapters/sqlite-graph-store.ts` 的 `SqliteGraphStore.createNode/createEdge`：Bootstrap Phase 1c 已构造同一实例；本票 L4 store 接收该实例与同一 Database，②身份继续写 `graph_nodes/graph_triples`，没有新建②数据库。
3. `src/store/schema-migration.ts` 的 `Migration`、`reconcileSchema`、`SchemaMigrationError`：现有图存储构造时执行迁移链；本票注册 version 6 并复用 `SCHEMA_TOO_NEW` 和相邻版本校验。
4. `src/deploy/bootstrap.ts`、`src/services/container.ts`、`src/server.ts` 的组合根：storage 阶段创建 L4 store 与 L2 service，server 仅放入容器并挂载路由，路由从 `req.app.locals.container` 取服务。
5. Express、 better-sqlite3 同步事务和 Vitest：均为 base 已声明依赖；本票未增加解析、DSH 或模型依赖。

### 需改造后复用

1. `src/l4/ontology-loader.ts`：原调用链为目录扫描→`loadOntology`→label 端点表。保留同一 loader，增加 `naturalKey/version/cardinality/temporal` 读取、按 `$id` 查询端点、重复 `$id` 与新类型自然键检查；没有 overlay。
2. `src/l4/sog-schema-validator.ts`：原静态 `NODE_SCHEMAS` 的旧类型行为保留；增加从上述 loader 的 canonical 定义生成校验规则。`EnterpriseScanStore.writeObjects` 在新建②对象前调用同一 `validateAndLog`，缺自然键属性硬拒绝。
3. `src/adapters/sqlite-graph-store.ts`：只复用创建原语，不复用 `standardKey`。扫描自然键由 `scan_ontology_links(graph,subject_kind,type,business_key)` 唯一约束，图 props 含 `businessKey`；重复运行先查关联，不重复创建对象。
4. `extensions/ontology/manifest.json` 与 `packages/ontology/src/{node-types,edge-types}.ts`：目录 JSON 仍是唯一真源；manifest 按目录实数更新，TS 文件只作镜像。

### 仅作反例／历史参考

1. `src/connectors/csv-import.ts`：`parseFloat(...) || 0`、零值跳过、逐行直接创建节点且写入当前时间。新解析器严格校验数值，空白保留 `null`，来源内容哈希作版本，不调用该连接器。
2. `src/routes/import.ts`、`src/routes/documents.ts`：只有数量／时间 ID／固定 0.8 置信度，列表读取失败还返回空成功；均不进入扫描调用链。
3. `src/routes/ontology.ts`：按请求类型直接建图，无来源版本、自然键或七态；不作为②摄取入口。
4. `src/adapters/standard-key-guard.ts`：同键会合并覆盖 props 并追加冲突，可能消灭并列值；本票不传入 `standardKey`，断言及版本分列保存冲突。
5. `src/security/file-guard.ts`：`checkBoundary` 对边界外只读默认放行。新 `EnterpriseScanPathAuthorizer` 独立默认拒绝，在任何读取前校验授权根、`..`、realpath 和逐段链接，提交前再做同描述符 fstat 与内容复检。
6. `edge/deploys` 等历史关系要求瓶颈／弹性字段：新关系只含事实结构、期间与来源，不继承这些字段，不推断瓶颈。

### 后续独立清理（本 PR 不处理）

- 旧 CSV 的非法值补零、重复节点和当前时间版本。
- 文档路由的固定置信度与读取失败空成功。
- `standardKey` 覆盖当前 props 的冲突语义。
- `FileGuard` 边界外只读默认放行及图查询失败返回空集合的历史行为。
- 其他①③④⑤⑥运行时和历史 Schema 漂移；按 Mandate 均不属于本票。

## 实现与验收入口

- `POST /api/enterprise-scan/runs`；`GET /api/enterprise-scan/runs/:runId`。
- `src/connectors/enterprise-scan/**`：worker 预检、默认拒绝路径授权、RFC4180 CSV／固定 Markdown／固定人的说明 JSON、可见范围过滤和确定性映射。
- `src/l4/enterprise-scan-store.ts`：同一 Database 同步事务，写 run／来源／证据版本／②／断言／报告；COMMIT 前再次检查授权、realpath、路径链身份、fstat 文件身份和哈希。
- `src/store/migrations/006-enterprise-scan.ts`：version 6，11 张扫描表及复合约束；无自动 down migration，回滚验证使用预迁移 SQLite backup。
- golden 独立手算：4 对象、2 关系、6 自然键关联、11 断言身份及版本、14 断言证据关联；planned=15、delivered=15、accepted=13。

不声称真实客户验收、经营瓶颈识别或①③④⑤⑥能力完成。
