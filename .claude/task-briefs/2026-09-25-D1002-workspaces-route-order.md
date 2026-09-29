# D1002 — 工作区路由遮蔽修复（W2/F-1）+ /conflicts 守卫补齐 + E-2 错误码顺序（栈式 base 8b6c95dd）

## Q0: 定位 — 项目拼图 + 文件审计
Synova L1 路由层（src/routes/workspaces-api.ts，基线实测 343 行）。D947 PR-2 已落 fail-closed 守卫体系（本文件 ：54 requireVerifiedRbac 唯一漏斗）；本卡修 D947 遗留的**注册序遮蔽**：GET /:id(:126) 先于 /mine(:264) 与 /conflicts(:294) 注册 ⇒ 二者 HTTP 恒 404（F-1 承重件，D948 PLAN 已证；/by-dept/:dept(:255) 两段式实测未被遮蔽，前移属防御性卫生）。部门分支前提：extractRbacContext（rbac.ts:127）硬编码 department:undefined ⇒ 本卡**完全不覆盖部门分支**（创始人裁定 2026-09-25，禁 syntheticRbac 合成 ctx 证明——D948 PLAN B-0b）。
文件审计（ef5c8caa=8b6c95dd 关键文件零差异已实测）：workspaces-api.ts 全部 11 条路由；既有夹具 workspace-access-write-endpoint.test.ts（:323-336 注释块 + :425-432 登记 404 断言为本卡改写面）；middleware-order.test.ts:184（N1 无凭据 401，认证层先于路由，**不受路由序影响**）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
Express 注册序语义：静态字面量段先于参数段注册（先例 P4/I4 源码断言 + loadMineHandler 运行时栈探针，middleware-order.test.ts:139-162 / workspace-access-write-endpoint.test.ts:338-350）。安全核心纪律：**先加守卫、后放开遮蔽，两步同一 commit 不拆**（把恒 404 变可达 = 新增读端点，必须先 fail-closed）。铁律 0-2/12（真实路由不 mock 管线）/24+31/33/38/47/48。反例教训：D948 PLAN B-0b——syntheticRbac(:369-371) 写死 department:undefined，加参直喂 handler 绕过 rbac.ts:127 = 假绿，已裁定禁止。
参考：Anthropic/DeepSeek/第一性原理 + 结论：路由序以「源码断言 + 运行时栈」双探针成对验证，判别性只挂真实路径（HTTP 面与 fail-closed 探针腿），变异体必须红。

## Q2: 范围 — 正确的最简方案
做什么：
- src/routes/workspaces-api.ts （路由序重排 + /conflicts 守卫 + /merge 权限前移 + :51 注释收录短式 + :278 F-3 注释订正）
- tests/routes/workspaces-mine-conflicts.test.ts （新建：F1/F2/F3/F5 + 边界四值 + by-dept/context 哨兵）
- tests/routes/workspace-access-write-endpoint.test.ts （:323-336 注释块整块改写 + :425-432 断言翻转 200，断言+注释同步）
- task-state/D1002.json
- .claude/task-briefs/2026-09-25-D1002-workspaces-route-order.md
- docs/synova/product-lines/evidence/D1002-20260925/PLAN.md
不做什么：
- 不改 src/middleware/auth.ts （D1000 切片 A 持有，同文件双写者禁）
- 不改 src/server.ts （触线文件禁塞；挂载点 :344 不动）
- 不改 tests/routes/middleware-order.test.ts （N1 401 断言与路由序无关）
- 不改 src/routes/department-workspace.ts 与 tests/routes/department-workspace.test.ts （@deprecated 另卡）
- 不改 scripts/audit/** （审计红线）
- 不改 docs/synova/coordination/** （越域）
- 不修 GET /api/workspaces/:92 无守卫既有缺口 （F-5 另立卡，创始人裁定）

## Q3: 验收 — 入口 → 交互 → 结果
入口：真实 createServer + fetch（铁律 12）：GET /api/workspaces/mine、/conflicts、/by-dept/:dept、PUT /:id/merge。
处理：① by-dept/mine/conflicts 三块整体上移至 /:id 之前（新下标 2/3/4）② /conflicts 加 requireVerifiedRbac（先守卫后放开，同 commit）③ /merge 的 canModifyWorkspace 前移到形状校验之前。
结果：F1–F7 + 附条件三条全绿（判据全文 = docs/synova/product-lines/evidence/D1002-20260925/PLAN.md v1.3，创始人 2026-09-25 裁定通过）；变异体 M1/M2/M3 各自红 + 还原后 git status 空。

## 架构层: L1（src/routes/ 路由层；仅消费相邻层 src/middleware/rbac.ts 既有导出，零新增跨层依赖）
## Done 标准:
- [ ] npx vitest run tests/routes/workspaces-mine-conflicts.test.ts tests/routes/workspace-access-write-endpoint.test.ts 返回 exit 0
- [ ] grep -cE "as any|as never|as unknown as" src/routes/workspaces-api.ts 返回 0
- [ ] 行数门禁: awk "END{exit (NR<500)?0:1}" src/routes/workspaces-api.ts 返回 0
- [ ] git status --porcelain 在变异体全部还原后输出为空

#CRITERIA: A
