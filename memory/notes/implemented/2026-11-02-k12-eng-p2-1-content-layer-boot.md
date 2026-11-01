# K12-ENG P2-1：content-layer 进 boot 装配面（K12-20 上线闸）

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #203（K12-20）｜14 项批准 item 5（放行 boot 装配）
- **决策**: `src/deploy/content-registry.ts` 的 `content-layer` 项 `status: pending-cto → reachable`；
  loader（`../services/content-layering` / `resolveContent` / `initArgs:[{departmentIds:[]}]`）**逐字不动**。
- **理由**: 14 项批准 item 5；DSH rc.5 "wire invariants into an executed top-level gate"——
  内容层此前只在探针里被调用、生产无读者；进 boot 后由 `initContentTypes` 真装配并收集降级信号。
- **证据**:
  - `vitest tests/deploy/content-registry.test.ts` ⇒ 18 passed（reachable 20→21、non-reachable 2→1）
  - `vitest tests/smoke.test.ts` ⇒ 8 passed；boot 日志：`reachable=21/pendingCto=1`、
    `content-layer verified=1`、`attempted=13 loaded=13`
  - 反例：临时移走 `extensions/content-layers/` ⇒ `initContentTypes({types:['content-layer']})`
    ⇒ `degraded:true`、`warnings:["content-layer: loader 返回 degraded=true"]`（不静默）
- **回滚**: 还原 content-registry 单文件＋测试两处断言（status 回 pending-cto）。
- **边界**: 不改 `resolveContent` 解析器；不改 `extensions/content-layers/**`；不改 departments（K12-10）。
