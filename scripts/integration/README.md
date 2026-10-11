# scripts/integration/ — 端到端判据（集成线）

> 用途：把"机器能不能转"从**静态装配取证**变成**跑得出来的判据**。
> 治理线（巡检器/调度/告警）只负责**调这里的脚本**，不解读内部逻辑。

## e2e-decision-roundtrip.ts — J5 / #405：④ 决策台账「写 → 读回」

**它证明什么**：真实入口（HTTP）触发一次工单关闭裁决 → 落 ④ 台账 → 业务路径读回该行且逐字段匹配。任何一半断 ⇒ exit 1（"摘掉任一接头 ⇒ 端到端必红"是它唯一的 Done）。

### 接口约定（治理线按此调用）

```
运行:  npx tsx scripts/integration/e2e-decision-roundtrip.ts   # 在仓根、npm ci 之后
输入:  环境变量全可选 —— SYNOVA_DB_PATH（缺省用临时库，不碰 data/synova.db）
                              ｜ SYNOVA_ORG_ID（缺省 default）｜ KEEP_DB=1（排障保留库）
输出:  逐段 [BOOT]/[SEED]/[WRITE]/[READ]/[PASS]/[FAIL] 明细
       ＋ 终行 `E2E-DECISION-ROUNDTRIP: PASS|FAIL (failPoints=[…])`
退出码（三态，禁吞）:
  0 = 通过
  1 = 真红（读回空/字段不匹配/写侧降级/接头被摘）—— 这是"机器转不了"的证据
  2 = 环境或脚本自身失败（服务起不来/播种失败）—— 不是产品红，先修环境
```

### 判别力（改坏即红，型 B/C 防线）

- 摘掉 `GET /api/sentinel/tickets/:id/decisions` 路由 ⇒ exit 1（failPoints 含 LEDGER-READ-BROKEN）
- 摘掉 `listDecisionRows` 读口/装配 ⇒ 503 LEDGER_READER_NOT_WIRED ⇒ exit 1
- 写侧降级（ledgerRecorded=false）⇒ exit 1（LEDGER-WRITE-DEGRADED）
- 每次运行用唯一锚点（时间戳+pid），断言读回行含锚 —— 防历史行冒充（纪律 8）

### 环境

- Node 24.x ＋ `npm ci`（净安装态与非净安装态都须能跑）；`better-sqlite3` 为原生依赖
- 不需要 JWT 配置（自动走 AUTH_DEV_MODE 留痕通道，鉴权中间件照常穿过）
- 不需要网络、不碰真库、不留残留（缺省临时库用后即删）
