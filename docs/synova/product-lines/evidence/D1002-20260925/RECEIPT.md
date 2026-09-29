# D1002 收件回执（RECEIPT）— 2026-09-25

基准：base = feat/d947-middleware-default-posture @ **8b6c95dd**（栈式改判，创始人 2026-09-25；禁用本地 main）。分支 fix/d1002-workspaces-route-order @ **a3ab020d**（已推，§四回执）。提交链：cd97c8e9（fix 产品+测试）→ 776947a0（auto D521）→ eab08189（docs 治理）→ a3ab020d（auto D521）。

## 一、F1–F7 原始输出（分行写面；绿腿运行记录 = 编码席 team-message-958c1641，pre-push 门禁复跑通过）

绿基线：`npx vitest run tests/routes/workspaces-mine-conflicts.test.ts tests/routes/workspace-access-write-endpoint.test.ts` → **47/47 passed, exit 0**。

| 面 | 命令/用例（tests/routes/workspaces-mine-conflicts.test.ts 行号） | 状态 |
|---|---|---|
| 源码 | F3 源码腿 :247-257（readFileSync+带闭合引号 needle，4 条全字面量） | ✅ |
| 运行时栈 | F3 运行时腿 :265-274（stack=11 层；by-dept=2/mine=3/conflicts=4 < /:id=5） | ✅ |
| HTTP | F1 :314 manager JWT /mine → 200+ok+role='manager'（≠404） | ✅ |
| HTTP | F1 :321 可见集含自有属主+global、不含他人 marketing department 子 | ✅ |
| HTTP | F2 :336 无凭据 /conflicts → 401+code='UNAUTHORIZED' | ✅ |
| HTTP | F2 :342 合法 JWT → 200+conflicts 数组+count | ✅ |
| 直接 handler | F2-P :349 无 req.rbac 直调 → 403 'access denied'（fail-closed 判别性腿，非合成身份注入） | ✅ |
| HTTP | F4 :377 staff × 存在但非子 → 403（原 400；M3 回退即红） | ✅ |
| HTTP+真实 JWT 链 | 边界四值 :372/:377/:382/:387 + admin 对照 :392/:398 + 正路径 :404（200） | ✅ |
| HTTP | F5 边界 :282/:290 空 store → 200+[]+count 0 | ✅ |
| HTTP+日志 | F5 降级 :416 401+body{code:'UNAUTHORIZED',message:'JWT_SECRET not configured'}+日志 AUTH_UNAVAILABLE level='error' | ✅ |
| HTTP | 【附条件1+2】哨兵 :447-453 /by-dept/context → 200+department='context' | ✅（整段原始输出见下） |
| HTTP | F7 workspace-access :425 翻转断言 200+ok+role='staff'（该文件 28/28） | ✅ |
| tsc | npx tsc --noEmit | exit 2——全部错误在非写集文件（extensions/_extinct、src/mcp、ima.ts、server.ts:473-474 基线既有），写集零错误（未清项⑦） |

【附条件2】哨兵用例整段原始输出（编码席 `-t '哨兵'` 定向运行，逐字）：
```
 ✓ tests/routes/workspaces-mine-conflicts.test.ts (19 tests | 18 skipped) 9370ms
 Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)
==== vitest exit: 0 ====
```

F6 变异体（串行；红态关键断言原文 + 真实退出码 + 还原验证；完整运行记录 = team-message-958c1641）：
- **M1 三块移回 /:id 后**：exit **1**，8 failed | 11 passed。原文：F3 源码腿 `AssertionError: expected 10081 to be less than 4620`；F3 运行时腿 `expected 7 to be 2`；F1/哨兵/空store×2/F2 合法腿 ×6 `expected 404 to be 200`；保绿面符合预期（F2 无凭据 401、F2-P 403、E-2 全部、F5 降级）。还原：sha256 全等（3238398B…E4545）+ status 快照逐行一致。
- **M2 删 /conflicts 守卫（保新序）**：exit **1**，恰 1 failed：F2-P `AssertionError: expected 200 to be 403`；HTTP 面仍 401 不受骗。还原同上（零残留）。
- **M3 canModify 移回形状校验后**：exit **1**，3 failed：F4 主断言 `expected 400 to be 403` + 同因连带 2 腿（staff×不存在/空串）；m2 无权限 403、admin 400、正路径 200 保绿。还原同上；随后两文件合跑 47/47 exit 0。
- D-1 手段登记：还原采用 TEMP 备份回拷 + sha256 全等校验（`git checkout --` 会回 HEAD 丢实施态）；声明存于运行记录，未落已推产物（未清项⑨）。

## 二、三路径夹具输出（F5）
- 正常：合法 JWT 全绿腿（§一 F1/F2/F4/正路径行）。
- 降级：同实例 try/finally env 翻转（删 JWT_SECRET+DEV_MODE='false'+携任意 Bearer）→ 401+body{code,message}+日志 AUTH_UNAVAILABLE(level=error)（§一）。
- 边界：四值+空 store 两腿+哨兵（§一）。

## 三、团队成员运行记录
- Phase 0（D950 期，改号前）：自验 15/15 = team-message-d33f164c；编码可实施性+R1-R6 = d44a59e2；复核 A-H 0 退回 = 18856c9f。
- 实施：派单 c31603b6 → 编码席回报 958c1641。
- 独立验证：自验派单 e3f7fb33 → 报告 a75c3e32（17 成立/2 部分成立/0 不成立）；复核派单 4e8a02a4 → 报告 fc049128（0 退回点，可提请独立审计）。

## 四、git diff --stat + ls-remote（基准 8b6c95dd）
> 勘误（2026-09-25，CTO 实测对账）：本节原贴 7 件 stat 系收尾提交前（@a3ab020d）截取，漏计 RECEIPT.md 自身（第 8 件）；已按最终态 d29a1362 重取。bypass.log 同步修正 +2→+3（收尾笔 auto-hook 再登记一行）。
```
$ git diff --stat 8b6c95dd..d29a1362
 .claude/bypass.log                                 |   3 +
 .../2026-09-25-D1002-workspaces-route-order.md     |  40 ++
 .../product-lines/evidence/D1002-20260925/PLAN.md  |  34 ++
 .../evidence/D1002-20260925/RECEIPT.md             |  92 +++++
 src/routes/workspaces-api.ts                       | 150 +++----
 task-state/D1002.json                              |  37 ++
 .../routes/workspace-access-write-endpoint.test.ts |  27 +-
 tests/routes/workspaces-mine-conflicts.test.ts    | 454 +++++++++++++++++++++
 8 files changed, 752 insertions(+), 85 deletions(-)
$ git ls-remote --heads origin | grep d1002
 d29a1362d465d99fd2655b9bfda6bb1fd6be47d2  refs/heads/fix/d1002-workspaces-route-order
```
构成：**8 件 = 3 产品（workspaces-api.ts / 新测试 / 翻转测试）+ 4 治理（task-brief / PLAN.md / RECEIPT.md / task-state 卡片，治理产物不计 PR 预算）+ 1 hook 副产物（bypass.log，M4）**。
push 门禁原文（关键行）：`✅ bypass.log 对账通过: 3d04a49205b341ebc2467ee7a1d3f0d42ae247c3..HEAD 全部提交有记录`；`✅ 全部门禁通过 — 允许推送`。

## 五、未清项（诚实登记）
1. auth.ts:82 陈旧注释（写 server.ts:315，实测挂载 :344）——等 D1000 切片 A 合后随下一张卡。
2. 渲染层 15 fetch 点身份覆盖面——D1001/mac 域另立卡。
3. **F1 部门分支在 D1002 内完全未验证——既未在 HTTP 面验证、也未在 handler 面验证；不采用合成 ctx 证明。部门可见性语义归 D1000 身份链后继卡。**（创始人裁定原文）
4. ±1 行数口径差：派单 344 vs 基线实测 343；PLAN 预算 ≈354 vs 实施实测 **355**（<500 ✓）；新测试文件实测 **454** 行、workspace-access 532（-5）。
5. 派单件指纹锚 **124d41dc**（docs/d949-d950-dispatch 尖端，未落 main，不引用路径）。
6. 栈式风险：D947 PR-2 若因 CI 返工重写，本卡 rebase 按 CTO 指令处理，不自行 force push。
7. tsc --noEmit exit 2：全部基线既有/环境性（非写集文件），写集零错误；CI 侧另行核对。
8. 编码席报告"新建测试 411 行"与实测 454 不符——口径不一致登记，代码态以实测为准。
9. D-1（变异体还原手段）声明仅存运行记录 team-message-958c1641，未落已推产物；D-2（空串格真实 JWT 链直调）已经自验席对账与代码形态一致。
10. syntheticRbac 全文 grep 唯一命中 = 新测试文件 :11 的 ◆F1 裁定声明注释；零代码使用、零合成身份注入。
11. :321「不含他人 department 工作区」为**排除面**断言（真实 JWT 链锁定部门分支 inert 不越权）——与「部门分支零断言」执行决定的字面边界，显式登记供 K3 裁。
12. .claude/bypass.log +3 行为 D521 auto hook 副产物（8 件改动中唯一非人为文件，M4 工具默认副作用，内容全为 COMMITTED|PASS 正常标记）。
13. 边界四值「存在但非子→403/400」的 admin×非子 400 半边无显式腿（admin 400 层已由空串×admin、不存在×admin 双腿覆盖；判据未要求，低危登记）。

## 六、派单件指纹对账
- 派单件：D1002-workspaces-route-order-f1-20260925.md @ docs/d949-d950-dispatch 尖端 124d41dc（blob c321ca44）；对账基准 = 创始人 session 消息 + 该指纹。
- 改号映射：D950→D1002（Mac-CTO 2026-09-25 裁定，与 Mac 侧 116 卡归一撞号）；D947 引用保留原号（特批）；D948→D1000、D949→D1001 按新谱。
- 判据谱系：一页 PLAN（三席 Phase 0 交叉 15/15）→ 附条件三条 → 必改一条照抄替换 → 补充三条 → gate 改判（栈式 8b6c95dd）→ PLAN v1.3（本目录 PLAN.md）→ 本回执。
- 执行对账：F1-F7 + 附条件 1/2/3 + 补充 1/2/3 全部落点见 §一 与 PLAN.md；独立自验（a75c3e32）17/17/0、独立复核（fc049128）0 退回点。

## 七、收尾三件路径（M6）
- diff：本回执 §四（原始 stat + ls-remote）。
- 自验结论：§一/§二 + 自验席报告 a75c3e32（独立于编码）。
- 遗留清单：§五（13 条，含创始人预登记 2 条原文）。

**结论：可提请独立审计。** 终审归 K3。
