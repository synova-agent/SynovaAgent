# #731 / 裁 425-A1：知识 scope 维**紧急回滚开关**（默认严开；关必留痕）

- **状态**: proposed（待 L1 收件闸 ＋ K3 审计追认为 implemented）
- **日期**: 2026-10-27
- **批次**: P3-M7-裁425返工批（#825）· 活1／3 · 分支 `ct/p3m7-pr2`（PR #1060 追加提交，base `a886225ba`）
- **依据**: CTO 裁定 425-A1（#825 返工单）｜ 卡 `task-1` 正文（写集／判据／反例）｜
  同线 Note `memory/notes/proposed/2026-10-27-731-knowledge-scope-wiring.md`（本开关是其**回滚面**）
- **生效时点**: 合入 `local-main` 后生效；**未合入前不生效**（本开关不改变任何默认姿态）

## 一、现状（为什么需要它）

PR2 已把 scope 维接进生产读链（`auth.ts` 内联 provider **追加** `{pkb_domain IN <scopes[].id>}`）。
按 KL-1/KL-2，`pkb_domain` 现物全 NULL ⇒ `IN` 对 NULL 恒 false ⇒ **finance/hr/sales 对现存语料检索为空**。
这是 fail-closed 的正确方向，但它落在**每个请求的判定路径**上，且数据回填另立卡
⇒ 上线后若观测到"岗位检索归零超出预期"，需要有**一条不重编译、不重启的撤退路径**。

## 二、决定

| 面 | 决定 |
|---|---|
| 开关载体 | 环境变量 **`SYNOVA_KNOWLEDGE_SCOPE_DIM`**。**缺省/空串/任何其它值 = 严开**；**仅 `off`**（大小写与首尾空白不敏感）= 关闭。**不读请求、不读数据库**（回滚发生在"判定逻辑本身不可信"时） |
| 判定点 | **唯一**：`src/middleware/auth.ts` 的 `getPermissionFilter` 内一句 `...(scopeGate.enabled ? knowledgeScopeConditions(payload.role) : [])`。**只**决定"是否展开"，`knowledgeScopeConditions()` 本体的 I-C1/I-C2/I-C3/I-C4/I-C6 语义**逐字不动** |
| 关闭态形状 | 条件集退到 `1` 条（`access.sensitivity` 仍在**第 0 位**）⇒ 仍**非空** ⇒ 不触发 `knowledge-store.ts:335`「条件集为空 = 完全不过滤」的 fail-open |
| 留痕（禁静默关） | 关闭判定打 `log.warn`，payload = `code:KNOWLEDGE_SCOPE_DIM_DISABLED` ＋ `phase:knowledge-scope-dim` ＋ `retryable:true` ＋ `degraded:true` ＋ **`registrations`**（本进程累计关闭判定数）。每进程一次 memo **只压日志量**；计数照记 ⇒ "关了几次"在**运行期留痕**里可对账（**该计数的消费点就是这条日志**，不为判据单开只读导出 —— 铁律 37） |
| 可观测面 | **唯一新增 export** = `knowledgeScopeDimensionGate()`（`{enabled,degraded,code,phase,retryable}`，生产调用点 = `getPermissionFilter`）。日志文本**进程内拦不到**（`@synova/logger` 经 `pino.destination({dest:2})` 直写 fd 2 且 level 在 import 时绑定）⇒ 留痕面判据走**跨进程 fd 2**（`spawnSync(process.execPath, ['--import','tsx','--eval',…])`，照 `tests/l4/edge-lag-unknown-degraded-1134.test.ts:443` 先例）。曾有的 `knowledgeScopeDimensionDisabledRegistrations()` 只读导出**已删除**（无生产调用点 = 死代码，铁律 37） |
| 判定是否 memo | **不 memo**（每次现读环境）⇒ 解除回滚 = 去掉环境变量，**无需重启**（与 d-refresh「禁进程级常量」同纪律） |

## 三、判别力（改坏必红，均为实测原始输出）

- **反例 1（本卡判据③，静默关）**：让关闭路径**不打 `log.warn`**（只跳过滤）⇒ 跨进程留痕断言红：
  `关闭路径**无**留痕行 ⇒ 这就是"静默关"（判据②(b) 的红态）: stderr=: expected null not to be null`
  （`tests/extensions/knowledge-scope-wiring.test.ts:779`；条件面 (a) 仍绿 ⇒ 牙长在留痕面）。已还原。
- **反例 2（防"降级信号恒真"）**：严开态也硬报 `degraded:true`+code ⇒ 判据①（默认环境严开）红
  （`gate` 深度等值断言失败 + 跨进程"严开态不得有留痕行"双保险）。已还原。
- 两序一致：本组用例**单跑**（`-t "降级路径（开关=off）"` / `-t "正常路径（默认环境）"`各 `1 passed | 21 skipped`）
  与**整文件跑**（`22 passed`）结论相同 —— 留痕面靠 fresh 子进程绕开 per-process memo，不依赖计数器增量。
- 还原后 `git status --porcelain` 仅两件写集；`npx tsc --noEmit` 无输出。

## 四、已知限制（禁写"暂无"）

- KL-A 关闭态是**粗粒度**的：一关即**全岗位**失去 scope 维（含审计口径里"该岗不该看到的"），
  期间跨岗位隔离**不存在**——这是回滚的应有语义，不是缺陷；故每一次关闭判定都累加 `registrations`
  （随该进程那条 `log.warn` 发出）⇒ 长跑进程的"关过几次"仍可对账，但**日志行本身只有一条**（memo）。
- KL-B 开关**不做鉴权**：能改进程环境的人本就能改 `JWT_SECRET`；本开关不引入新的信任边界，
  也**不**提供热配置接口（不新增 HTTP 面）。
- KL-C 本开关**不**回滚 KL-1（写侧仍无法表达 scope、`pkb_domain` 仍全 NULL）；它只撤"读侧收窄"。
- KL-D 日志"每进程一次"意味着**长跑进程**只留**一条** warn；多次关闭/解除的**计数**由登记面承担，
  日志面不承担频次统计（两者同源同一判定点，但不是同一载体）。
