# Task Brief: D702 消灭写操作吞错 — updateUser/deleteUser 返 {ok,error} + 8 调用点消费（K3 W-2）

> 生成: 2026-09-11 | 分支: feat/win-d702-write-op-no-swallow（@ main 358ac6eb） | as any: 0
> Session: D702（独立 clone .sessions/D702/repo，分支 feat/win-d702-write-op-no-swallow）
> 唯一契约: docs/plans/codex/implementation/SYNOVA-IMPL-D702-write-op-no-swallow-20260911.md

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。
增长导航视角：用户/成员写操作（绑定企业、角色变更、冻结）是增长导航的账号生命周期底座——持久化失败被吞 = 系统对"这家企业有哪些人、谁能看什么"的认知失真，诊断与增长建议建立在假事实之上。

### 三层解耦体系

纵向五层物理隔离：每层只与相邻层通信，失败/降级信号必须沿调用链向上传播（铁律 31）。
文件驱动扩展：新增能力靠文件不改代码。
数据安全分级：L0 公开摘要 → L1 聚合信号 → L2 脱敏证据 → L3 原始数据。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务修 K3 D651 审计 W-2「写操作吞错」：L5 存储侧 src/growth/user-store.ts 的 updateUser(:218)/deleteUser(:230) 内部 catch 吞错返 void，调用方无法感知持久化失败；最严重后果在 L1 交互层 src/routes/enterprise.ts:239 accept 绑定——orgId 绑定持久化失败仍返 linked:true（数据访问边界迁移假成功）。本卡把两个写方法改为返回 { ok: boolean; error?: string }，同步 src/services/anomaly-detector.ts:86 接口签名，enterprise.ts 6 处 + anomaly-detector.ts 2 处调用点全部消费 .ok（失败 log.warn + 降级响应）。新增/扩展（非替换）：写方法签名变更 + 调用点消费 + 测试护航。

### b) 文件审计
grep 实测（clone @ 358ac6eb，2026-09-11）：
- src/growth/user-store.ts:218-225 updateUser 返 void，catch :223 仅 log.warn——缺陷实证
- src/growth/user-store.ts:230-237 deleteUser 同型缺陷（catch :235）
- src/routes/enterprise.ts:239/:297/:314/:331/:347/:609 六处 updateUser/deleteUser 调用，全部不消费结果
- src/services/anomaly-detector.ts:86 UserStoreLike.updateUser 声明 void（镜像实现需同步）；:100/:110 调用点
- 全仓 grep 调用点 = 恰 8 处（上三文件），无遗漏调用方
- src/adapters/sqlite-graph-store.ts:318-332 updateNode 失败 log.warn 后 throw（真实失败源）；:139-158 createNode 恒生成 node-<uuid> 忽略 props.id（S-15 假 store 须镜像）
- tests/growth/user-store.test.ts 已存在 151 行（MockGraphStore 可扩展失败注入）
- tests/routes/enterprise.test.ts 已存在 529 行（D484/D485 真实 HTTP 基建）——spec §3.1 写"新建"实为扩展，§3.2 回填
- tests/services/anomaly-detector.test.ts:54 fake store 返 void——接口签名变更的强制连带（不改则 vitest 崩），§3.2 回填
- SabotageHandler/UserStoreLike 在 src/ 无其他消费方（grep 零命中）

### c) 决策
已有覆盖→复用 enterprise.test.ts 既有真实 HTTP 基建（D484/D485），不重搭 express 测试脚手架。user-store 层包 {ok,error} 不改 SqliteGraphStore 底层（dev doc §3.3）。失败注入方式=可开关的 MockGraphStore 标志位（镜像真实 updateNode 失败即 throw 语义）。S-15 round-trip 用真实 SqliteGraphStore（better-sqlite3 临时文件，既有 tests/adapters/sqlite-graph-store.test.ts 先例）+ WAL 写锁注入真实写锁冲突失败源，不做假 store 降级替代。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC：dev doc SYNOVA-IMPL-D702 §6 DS1-DS8 已定义机器可验完成标准。
② 测试：先写测试跑红（mock updateNode 抛错 → 修复前返 void 无法断言 ok:false；accept 绑定失败 → 修复前恒返 linked:true）→ 实现跑绿（铁律 0-2: spec→test→impl→wire→review→merge）。
③ 实现：2 写方法返 {ok,error} + 8 调用点消费，刚好满足 DS1-DS3。
④ 接线：8/8 调用点消费 .ok 即本卡接线验收（grep 实证）；无新 export 需要接线。
⑤ 验证：DS1-DS8 逐条命令 + tsc 基线 worktree 报错集逐条 diff 恒等。

引用依据（至少引用两项）：
- 铁律 24: catch 必须 log.warn/error + degraded 返回
- 铁律 31: 降级信号传播——调用方检查、前端展示
- 铁律 0-2: 测试先行 + WIRE CHECK
- memory/2026-09-09-d650-expert-domain-rename-delivery.md: 基线对照与 CI job 级归因方法
- memory/2026-09-08-d598-token-meter.md: clone+junction 下 vitest 须 node --preserve-symlinks
- memory/2026-09-10-d662-expert-residual-sweep.md: junction 两步法 + tsc 基线错误集恒等判零新增
- docs/plans/codex/implementation/SYNOVA-IMPL-D702-write-op-no-swallow-20260911.md §2.3/§4（S-15 真实依赖语义）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
- rule: "updateUser/deleteUser 返回 { ok: boolean; error?: string }，catch 内 log.warn + 返回失败对象，不 throw 不吞"
  verify: "grep -c '{ ok: boolean; error?: string }' src/growth/user-store.ts"
- rule: "enterprise.ts:239 accept 绑定失败不得返回 linked:true，返 500 + degraded:true，且不消耗邀请 token"
  verify: "grep -n 'linked: true' src/routes/enterprise.ts"
- rule: "8 处调用点全部消费 .ok（enterprise 6 + anomaly-detector 2），不做全仓存量扫描不写 AST 门禁"
  verify: "grep -c 'ok' src/routes/enterprise.ts src/services/anomaly-detector.ts"

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档冲突时）
决策点 1（返回类型）：参考：K3 W-2 + 铁律 24/31 + dev doc §4.5 决策点 1 → 结论：{ ok: boolean; error?: string } 内联类型，不 throw（写失败降级不炸调用链）、不造 WriteResult 新类型名（DS2 字面 grep 契约）。
决策点 2（accept 失败响应）：参考：铁律 31 + dev doc §4.5 决策点 2 → 结论：500 { ok:false, code:'PERSIST_FAILED', degraded:true }；邀请保持 pending 可重试（不消耗 token）；最终形态回填 §3.2。
决策点 3（S-15 失败源）：参考：第一性原理（最少机制=用真实依赖的真实失败路径）+ D701 store-id bug 教训 → 结论：WAL 双连接写锁注入真实锁冲突失败，使 updateNode 按生产语义 throw；放弃纯 mock 注入作为唯一证据。

### d) 相关 Note 引用
- [ ] memory/notes/proposed/2026-09-11-d702-write-op-no-swallow.md（本任务交付后新建）

## Q2: 范围 — 正确的最简方案是什么？

本任务不做的（排除项清单在本节末尾；先列做什么，排除项随后逐条）：

做什么：
- src/growth/user-store.ts: updateUser/deleteUser 返回 { ok: boolean; error?: string }，catch 内 log.warn + return { ok:false, error }，成功 return { ok:true }
- src/services/anomaly-detector.ts: :86 UserStoreLike.updateUser 签名同步 + :100/:110 调用点消费 .ok（失败 log.warn，冻结失败不记入 alerts）
- src/routes/enterprise.ts: :239/:297/:314/:331/:347/:609 六处消费结果；:239 绑定失败返 500 degraded 且邀请保持 pending 不消耗
- tests/growth/user-store.test.ts: 扩展 ≥4 用例（成功 {ok:true} / updateNode 抛错 {ok:false,error} / deleteUser 同型 / S-15 真实 SQLite round-trip）+ MockGraphStore 失败注入开关
- tests/routes/enterprise.test.ts: 扩展 D702 describe ≥2 用例（accept 绑定 updateUser 失败不返 linked:true + 正常路径仍 linked:true），复用 D484/D485 真实 HTTP 基建
- tests/services/anomaly-detector.test.ts: 既有 fake store 返 void 同步为返 {ok:true}（接口签名变更强制连带，不改则 D243 既有用例崩溃——非越界扩展，§3.2 回填）
- docs/plans/codex/implementation/SYNOVA-IMPL-D702-write-op-no-swallow-20260911.md: §3.2 最终实现同 commit 回填
- .claude/task-briefs/2026-09-11-D702-write-op-no-swallow.md: brief 簿记

不做什么（排除项）：
- 不改 src/adapters/sqlite-graph-store.ts 底层 updateNode/createNode（通用 props merge，本卡只在 user-store 层包 {ok,error}）
- 不做「写方法 void + catch」AST 门禁（属 scripts/ 门禁层，dev doc §3.3 明示另立任务）
- 不做全仓存量写操作吞错扫描（本卡只修 K3 点名的 updateUser/deleteUser，dev doc §3.3）
- 不改 src/routes/auth.ts、src/agent/、src/l3/ 等其余 src/ 文件（grep 实证 8 调用点全在写集三文件内）
- 不新建 tests/agent/user-store.test.ts 副本（spec §0 校订明确扩展 tests/growth/ 既有文件）
- 不引 @deepseek-ai、不动 expert/ extensions/（非借鉴卡，写集零交集）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：POST /api/enterprise/invitation/accept（绑定）、PUT/DELETE /api/enterprise/members/:id、freeze/unfreeze、POST members/:userId/role、SabotageHandler.freezeUser；测试入口 = vitest run tests/growth/user-store.test.ts tests/routes/enterprise.test.ts。
处理（中间经过哪些步骤）：写操作 → UserStore.updateUser/deleteUser → GraphStore.updateNode 持久化 → 失败时 catch 打 log.warn 并返 {ok:false,error} → 调用点检查 .ok → 失败返 5xx degraded 响应且不宣布成功。
结果（最终展示在哪）：HTTP 响应如实反映持久化结果（绑定失败 = 500 {ok:false,degraded:true}，邀请保持 pending）；DS1-DS8 逐条命令输出 + vitest red→green 留痕 → PR CI task-relevant jobs 绿。

## 架构层: L1 交互层（src/routes/enterprise.ts 六端点消费）+ L5 服务/存储（src/services/anomaly-detector.ts、src/growth/user-store.ts）——失败信号沿 L5→L1 传播，不改层边界。
#CRITERIA: A

## Done 标准
- [ ] DS1 verify: grep -n "updateUser.*: void\|deleteUser.*: void" src/growth/user-store.ts src/services/anomaly-detector.ts → 零命中
- [ ] DS2 verify: grep -n "{ ok: boolean; error?: string }" src/growth/user-store.ts src/services/anomaly-detector.ts → 命中 ≥2
- [ ] DS3 verify: sed -n '235,250p' src/routes/enterprise.ts → :239 之后有 .ok 判定，失败路径不返 linked:true
- [ ] DS4 verify: vitest run tests/growth/user-store.test.ts tests/routes/enterprise.test.ts → 全绿 ≥6 用例（red 已留痕）
- [ ] DS5 verify: node --preserve-symlinks node_modules/vitest/vitest.mjs run tests/growth/ tests/routes/ tests/services/ → 全绿；tsc 报错集与基线 worktree 逐条 diff 恒等
- [ ] DS6 verify: grep -rn "as any\|as never\|as unknown as" src/growth/user-store.ts src/services/anomaly-detector.ts src/routes/enterprise.ts → 新增行零命中
- [ ] DS7 verify: git diff --name-only HEAD^ → 恰为 Q2 写集 + brief/spec 簿记，无越界
- [ ] DS8 verify: grep -n "no-verify" .claude/bypass.log 本次零新增；git push 后 PR CI task-relevant jobs 绿

## 文档引用
- docs/plans/codex/implementation/SYNOVA-IMPL-D702-write-op-no-swallow-20260911.md（唯一契约：§2 代码审计 / §3.1 写集 / §4 red→green / §6 DS1-DS8）
- docs/synova/coordination/Win侧代码质量提升建议-20260909.md（W-2 权威来源）
- AGENTS.md 铁律 24/31（降级 log.warn + degraded 传播）
- src/adapters/sqlite-graph-store.ts:139-158/:318-332（S-15 真实依赖语义）

## 接口审计
- src/growth/user-store.ts: UserStore.updateUser
- src/growth/user-store.ts: UserStore.deleteUser
- src/services/anomaly-detector.ts: UserStoreLike.updateUser
- src/services/anomaly-detector.ts: SabotageHandler.freezeUser
- src/routes/enterprise.ts: setUserStore

消费点与死代码判据（grep 实测）：src/ 内写方法调用 = 恰 8 处（§Q0b 全列表）；SabotageHandler/UserStoreLike 生产消费方仅 anomaly-detector.ts 自身（无其他 src/ 消费者）；updateNode 底层保持 void+throw 契约不变。
