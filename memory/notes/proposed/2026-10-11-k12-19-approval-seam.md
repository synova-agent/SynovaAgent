---
状态: proposed
日期: 2026-10-11
决策: K12-19 (#202 / 原 RB-05) 人在环审批缝的判定语义 = **fail-closed**：`allowed === true` **当且仅当**宿主应答端口显式答复「批准」；无人应答 / 超时 / 应答端口缺失 / 应答非法 **一律判拒**（拒 > 放行）。**非高风险动作不得经本缝自动放行**（否则「非高风险」就是绕过审批的后门）。生产入口 = `src/routes/self-ops.ts` 的 `POST /api/self-ops/execute`。
理由: |
  ① **第一性原理（本卡的存在理由）**: 任何自动化系统都诱惑「超时放行」（省事），那等于
     「只要没人看，什么都能干」。把这条诱惑从**纪律问题**变成**结构问题** —— 不改本缝的代码，
     就不存在任何能在「没人应答」时返回放行的路径（改动即被「改坏必红」判据抓住，已实测）。
  ② **实测病根（as_of `gitea/local-main@8cbe3fc1d`）**: `src/deploy/system-self-ops.ts` 的危险操作分支
     返回 `requiresApproval: true` 与一枚 `approval-${Date.now()}-xxx` 的"审批卡 ID"，而**全仓无任何
     一处会去审批它**；`src/routes/self-ops.ts` 收到 `requiresApproval` 就回 202。
     ⇒ 今天「需要审批」这四个字**没有执行体**：没有人被问、没有被拒，只有一枚时间戳。
     结构性自检（拆掉本层后直调 dispatcher 实测）: 危险动作**不被执行**（安全方向对），
     但**无显式拒、无留痕**，原 route 把它包成 202「待审批」＝永不落地。
     本层的增量 = 把它变成**显式 403 ＋ 稳定 code ＋ 谁/何时/动作/为什么 四要素留痕**。
  ③ **高风险清单是产品判断（非从 DSH 借）**: DSH 无「企业高风险动作」语义。本卡定的清单
     = `version-rollback`（数据兼容性风险）/ `db-repair`（不可逆）/ `schema-migrate`（失败即不可用），
     与 `system-self-ops` 自称「危险操作」的三项**逐项相等**（由测试对 `listAvailableOps()` 断言守住，
     防两处口径漂移）。**清单不是可配置项** —— 放宽清单等于悄悄削弱兜底。
  ④ **策略声明缺失即报错，不做兜底策略**: 策略解析入口在**声明缺失 / 形态非法 / 缺省裁决非 reject**
     三种情形下**抛错**；生产入口在**模块加载期**（＝启动期）调用它 ⇒ 声明坏掉则**进程起不来**，
     而不是等某次危险操作再悄悄放行（"宁可炸在启动期"）。
  ⑤ **判据形态（判例 V-01/V-02）**: 判定**不吃 grep** —— 真 import、真调用、真观测返回值与留痕字段、
     真起 HTTP 服务打生产路由。grep 只作 `[L1-辅证，不参与判定]`。
  ⑥ **降级语义不许混淆**: 「拒」是**确定结论**（不是降级）；`degraded = true` 仅用于**判不了**
     （应答非法 / 端口抛异常 / 策略非法 / 请求形态非法），且此类情形 `errors[]` **结构性非空**
     （由唯一出口强制，不靠每个分支自觉 —— 铁律 24/31）。
---

# 触发场景

K12 第 12 批「企业级一致性」第 19 卡（原 RB-05）。院方四层结构的**第四层（人在环）**；
产品架构位置 = 宪章 §0.4 的「−1 运行时」。创始人 2026-10-05 六条裁定之「高风险要人点头」。

# 分层归属（含实测到的既有边界，未改）

- **运行时层（本卡新建）**: `src/runtime/approval-seam.ts` —— 审批缝本体；
  按名注入 `ask` 端口（DSH 借鉴「按名声明 + 宿主满足」），**不 import 具体人类通道实现**。
- **生产入口（本卡接线，卡面写集外的唯一扩张件）**: `src/routes/self-ops.ts`
  —— `src/server.ts:482 app.use(selfOpsRoutes)` 已挂载，`POST /api/self-ops/execute` 为唯一生产入口。
  扩张依据三条（任一独立成立）: ① pre-commit 组 4a 对**新文件的每个 export** 要求
  `src/` 中**本文件之外**的真调用方（自引用被 `grep -v "$file"` 显式排除）；
  ② 创始人升格硬要求「新 export 要有真 `src/` 调用方，且该调用方在生产路径上会被执行」；
  ③ 铁律 37（无调用方的缝 = 死代码）。
- **未覆盖的边界（如实登记，建议另立卡）**:
  ① **人类应答通道尚未接线**（GA 审批卡片 / IM 回调未实现）⇒ `ask` 端口恒为「无应答」
     ⇒ **生产态下高风险动作恒判拒**。这是 fail-closed 的**正确结果**，不是缺件；
     但「有人通道后放行」这一路目前**只有单元/探针层证据**，无生产级证据。
  ② `executeSelfOp` 仍可在**进程内被直接调用**而绕过审批缝（今日唯一调用方就是 route）。
     属纵深防御缺口，修法（把闸下沉进 dispatcher）须改其**同步签名**，会打红既有测试 ⇒ 本卡不动。

# 判据与可复跑命令（机器可判）

```
npx tsx scripts/control-tower/probe-approval-seam.ts --case no-answer   # expectExit 0（登记件 RB-05）
npx tsx scripts/control-tower/probe-approval-seam.ts --all              # 5 场景 / 46 断言
npx vitest run tests/runtime/approval-seam.test.ts tests/security/approval-seam.test.ts   # 28 例
SYNO_CI=1 bash scripts/pre-commit-check.sh                              # 13 组全过
```

**反例（改坏即红，2026-10-11 实测）**: 把 `classifyAnswer` 里「无应答」分支改成
`return { kind: 'answered', answer: 'approved' }` ⇒ 探针 `RESULT=FAIL` / exit 1（`PASS=23 FAIL=2`），
vitest `9 failed | 19 passed (28)`（含生产入口那条 403 用例）；还原 ⇒ 探针 `PASS=25` / exit 0，
vitest `28 passed (28)`。

**独立复核（非作者所写）**: PR #224（`fix/k12-21-probe-ladder`，另一作者撰写的同名片）对本实现
`--case no-answer` 与 `--all` 均 `RESULT=PASS` / exit 0（`PASS=20`）—— 即先有独立声明的契约，后有实现。

**未实现不许绿**: 临时移开 `src/runtime/approval-seam.ts` ⇒ 探针报 `RESULT=NOT_IMPLEMENTED` / exit 2。

# 相关

- 卡面: `.claude/task-briefs/2026-10-11-202-approval-seam.md`（本卡交付 · 含两处写集扩张声明）
- 与相邻层的关系（本卡**只读**不改）: 权限判定（K12-09 跨 orgId 隔离 / K12-03 白名单）与**审批**分开管
  —— 同型证据: DSH `packages/interaction/permission-presets/README.md` 把 sandbox 级别与 approval 策略分开
- 缘起（本件因 Note 引用门禁要求而落）: 本卡写集含 `scripts/control-tower/probe-*.ts`
  ⇒ 命中"治理脚本区"触发面。探针是卡面 Q2 明列的**判据测量件**，非治理规则变更。
