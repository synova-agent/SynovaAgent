---
north-star:
  服务用户: 企业主（最终受益者）与 GA（增长顾问，直接用户）。痛点：拿到安装包装不上／装上了打不开／开了窗用不了（要命令行）／首诊迟迟不出。
  服务场景: 新客户拿到 SynovaAgent 安装包 → 双击安装 → 服务自启 → 开窗即用（不碰命令行）→ 用一句话说出诉求 → 3 天内拿到首份诊断报告 → 报告命中一个他没想到的盲区。
  模块终态: 线1 桌面端 5/5 verified（Mac/Win 安装→出窗→开窗即用全链有真机证据在档）；线6 首次诊断 4/4 verified（端到端可复跑 exit 0 + TTFV 计时可判定 + 盲区命中经创始人核验）；两条线的证据 24h 内可一键重跑（rerun-evidence）。
  对齐北星: `.claude/PRODUCT-BRIEF.md` §二（谁在用：直接用户 = GA，最终受益者 = 企业主）+ §三（Synova 怎么工作：GA 按需诊断）+ §六 P0（"没有这些不能给 GA 用"）
  完成标准: 入口（GS-01 场景脚本 / 创始人双击安装包）→ 处理（打包 → 安装 → 服务自启 → 开窗即用 → 首启向导 → 首条诉求 → 六阶段诊断）→ 结果（GS-01 exit 0 + 证据 JSON 落 git + /api/healthz 200 + 报告端点 200 + 两条线断言在进度页转 pending_k3）
  当前进度: 线1 3/5（1-1/1-4 机器证据 09-13 在档但已 stale；1-2/1-3 无真机证据；1-8 证据 19 天已红）；线6 0/4（GS-01 当前 exit 1：S0-1 断言与 D590 裁决① 冲突，且 GS-01 从未绑定线6 断言）；本卡产出规格，实现按 S5 切片推进。
---

<!--
  SYNOVA-IMPL-DSH-D804: M1「能装能用」线1 桌面端 + 线6 首诊端到端 — dev doc（DSH 八节）
  状态: dev doc（待 CTO 复核冻结）| 2026-09-17 | 域: win（D773 代行：Mac 侧执行，域声明不变）
  权威: 派单-D804-D803-DSH标准-20260917.md §一（模板）+ §二（本卡，PR #618）
        + 26线-V1验收标准-草案v0.1-20260917.md（线1 5 条 / 线6 4 条）
        + 整体推进计划-主线-20260913.md v1.2@4e46603f（sha256 实测前缀 4e46603facae4361）
  红线: 本阶段零 src/ 下任何变更（派单 §四 规格冻结门）；不碰 scripts/audit/**（K3 专属）
  轮次: 初稿（CTO 逐节复核后退回则按退回意见修订）
-->


# D804 — M1「能装能用」线1 桌面端 + 线6 首诊端到端

> **一句话问题**：产品"能装能用"的**机器判据不存在**——GS-01 场景的断言集（写于 D446）与后来生效的 D590 裁决①（consult 免 JWT 白名单）**口径矛盾**，导致 GS-01 自 2026-09-16 起 exit 1；同时 GS-01 的 `evidence_map` 键写的是 `L1-1/L1-4/L1-6`，与 `product-lines.yaml` 的验收点 ID（`1-1/1-4`）**对不上**，机器上"线1 场景证据"恒为零；线6 的首诊旅程（问卷→报告）与 TTFV 计时**零断言绑定**。结果：线1 只有 3/5 绿且证据 14 天内必过期，线6 诚实 0/4——创始人问"装得上吗、首诊出得来吗"，回答只能靠人去跑。

---

## 0. Authority Doc Verification（权威文档核验）

**权威 ① — 派单（本卡）**：`docs/synova/coordination/派单-D804-D803-DSH标准-20260917.md`（PR #618 内，未合并到 main）

> §二 **目标**：线1 的 1-1/1-4 断言化 + 线6 的 6-1/6-2/6-3 端到端可复跑（Win/Mac 真机证据按 D773 挂账）
> §二 **验收**：GS-01 场景 24h 内可复跑 exit 0；线1 ≥3 条断言转 pending_k3；K3 复核点（1-8）在报告中列出
> §四 **规格冻结门**：dev doc 经 CTO 复核前，**不得提交任何 src/ 下的变更**（违反 = 该 PR 退回）

**权威 ② — V1 分母（唯一来源）**：`docs/synova/project/26线-V1验收标准-草案v0.1-20260917.md`

> **线1 桌面端** V1 断言：`1-1` Mac 安装包能打出且可安装（verify: GS-01 exit 0 + 产物存在｜证据: scenario｜fail_when: 产物缺失或场景红）；`1-2` Win 双击 → 装好 → 出窗（真机实测含时间戳｜founder-demo｜装不上/不弹窗）；`1-3` Mac 双击 → 装好 → 出窗（真机实测｜founder-demo｜同上）；`1-4` 服务自启 + 开窗即用（GS-01 + 重启后 `/health` 200｜scenario｜重启后服务不在）；`1-8` 审计员复核安装实测记录（K3 报告 PASS｜k3｜复核 NOT-AUDITABLE/FAIL）
> **线6 首次诊断** V1 断言：`6-1` 首诊旅程端到端（新装→问卷→报告）（GS-01 exit 0｜scenario｜任一环断）；`6-2` ≤3 天出首诊（TTFV 可测）（GS-01 计时字段｜scenario｜超 3 天/无计时）；`6-3` 命中 ≥1 个老板盲区（创始人演示核验｜founder-demo｜无新信息）；`6-7` 审计员复核首诊旅程（K3 PASS｜k3｜复核不通过）
> **V1 外（不进本卡分母）**：1-5 双引导收敛 / 1-6 30 分钟计时 / 1-7 升级重装不丢数据 / 6-4~6-6

**权威 ③ — 机器绑定源**：`docs/synova/product-lines/product-lines.yaml`（线1 `evidence: ["scenario:GS-01"]`；1-8 `k3_only: true`；线6 `6-1/6-2/6-3 evidence: ["scenario:GS-01"]`、`6-7 k3_only: true`）——本 doc 的断言 ID 必须与之逐字一致，否则 `calc-progress.py` 绑不上（本节即为此而生）。

**权威 ④ — 主线计划**：`docs/synova/coordination/整体推进计划-主线-20260913.md` v1.2@`4e46603f`

> 主线支柱①「**能被装起来用**」= 桌面端线 1 走到 100%（1-1…1-8 全部 verified）
> 阶段 2 原文：**1-4 重打新产物 + 证据落盘**：重打包 → 安装实测 → `[preload-check] OK` 原始日志 + 渲染层 API 实测请求**双双落 git 证据文件**（贴命令与输出）

**权威 ⑤ — K3 审计（外部事实源，本 doc 只引用不改判）**：`docs/synova/audit-reports/2026-09-13-D715.md`

> §四 1-4 **failed 维持——不可自动转绿**：D714 修复代码已入 main + 哨兵已加，但修复后产物未经发布物路径实测；`[preload-check] OK` 日志仅存于 memory note 自述，原始日志未落 git 证据目录（P1-4）。**转绿条件 = D714 后重打包 → 安装 → `[preload-check] OK` 日志 + 渲染层 API 实测请求成功双双落盘**
> §四 1-1：arm64 打包能力已两次实证；**x64 仍不可信**（beforePack 单次调用 → x64 包内 arm64 native）
> §五 P1-1：evidence-writer 双机产证同名撞车（文件名无平台/任务维度）→ 合并即 add/add 冲突

**权威 ⑥ — 铁律**：`AGENTS.md`（铁律 0-2 spec→test→impl→wire→review→merge；4/5 入口→交互→结果与调用链；11/24/31 降级必须 log + degraded 且传播；33 测试命名；35 自动化优先；38 `as any` 零容忍；47 契约优先；48 测试非空壳三路径）+ 铁律 0-4（数据资产备份：禁止 `cp data/synova.db`）。

**权威 ⑦ — 域与代行**：`docs/synova/coordination/Win域代行规约-20260915.md`（D773）

> 实机级（Windows 安装/升级/双击 GUI/NSIS 路径/权限框）→ **挂账**，Win 回归后补验；**禁止**用 Mac 结果声称实机通过。

**核验方式**：本文所有"现状"声称均带 `file:line` 或 evidence 路径，逐条 grep/read 于 2026-09-17 在 `origin/main @0f59e514` 上完成（§现状审计）。

---

## S1 价值与入口

| 维度 | 内容 |
|---|---|
| **谁** | ① 企业主（最终受益者）：不懂命令行，只接受"双击安装 → 打开就能说话"；② GA（增长顾问）：拿它上门服务客户，装不上的机器 = 丢单；③ 创始人：用"双击安装包 + 看首诊报告"判断产品是否成立 |
| **什么场景** | 新客户第一小时：拿到安装包 → 双击 → 装好 → 服务自己起来 → 窗口里配一次模型 → 说一句"我们增长卡在哪" → 拿到首份诊断报告 |
| **触发什么** | 桌面端：`双击安装包`（OS 安装器）→ Electron 主进程 `ensureBackend` 自启后端（用户零命令）；首诊：首启向导（`//api/llm/*` 免 JWT）→ 首条诉求（`initiator.concerns`）→ `POST /api/diagnosis/consult`（SSE 六阶段）→ `GET /api/diagnosis/consult/:id/report` |
| **预期可观测结果** | ① `bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh` → **exit 0**，且 `scripts/golden-scenarios/evidence/GS-01-<date>.json` 中点 `1-1/1-4/6-1/6-2` 有 verdict 记录；② 打包实测：`[preload-check] OK` 原始日志 + 渲染层真实 API 请求记录**双双落 git**；③ 重启后 `curl -s http://localhost:18790/api/healthz` → HTTP 200；④ 报告端点 HTTP 200 + 一页纸 markdown 非空 |

**入口 → 交互 → 结果 三环节**（铁律 4/7）：

| 环节 | 线1（桌面端） | 线6（首诊） |
|---|---|---|
| 入口 | 安装包双击（OS 层）／`scripts/desktop/*-install-verify.*`（机器层） | 窗口内首条诉求（人）／`POST /api/diagnosis/consult`（机器） |
| 交互 | 服务自启 → `[preload-check]` 自检 → renderer 加载 | SSE 六阶段（phase_started 0→5）→ complete + reportId |
| 结果 | 窗口可交互 + `/api/healthz` 200 + renderer API 请求非零 | 报告端点 200 + 一页纸非空 + 证据 JSON 落 git |

> **口径澄清（"问卷"）**：V1 线6 的 DoD 写"新装 → 问卷 → 报告"。**当前产品里的"问卷"= 首启向导 + 首条自然语言诉求**：结构化访谈端点 `/api/diagnosis/interview` 已在 D590 裁决② 显式 **410 下线**（src/server.ts L93 ），src/interview/question-bank.ts  全仓**零生产调用方**（仅 `tests/interview/question-bank.test.ts`）。故本卡不复活旧端点，机器证据锚定"诉求入口 + consult 契约 + 报告产物"（决策参考 D3）。

---

## S2 契约（新增或改动接口，逐接口 @input/@output/@degraded/@error/@idempotent）

> 三态退出码统一口径：**0 = 成功/通过｜1 = 业务阻断（断言红、断言失败）｜2 = 前置缺失或执行失败（degraded，显式提示，不静默）**。

### 2.1 既有接口（本卡只引用，不改实现）

| 接口 | @input | @output | @degraded | @error | @idempotent |
|---|---|---|---|---|---|
| `POST /api/diagnosis/consult`（src/routes/diagnosis.ts L189 ） | body `{teamId, initiator:{role, name?, concerns?}, scope?}`；**免 JWT**（src/middleware/auth.ts L121  D590 裁决①） | `200` + SSE 事件流（`phase_started` 0-5 / `complete` / `reportId`）；响应头 `X-Consult-Id` | 客户配置解析失败/计量失败/注入失败 → 各自 `log.warn` + `degraded` 字段，诊断继续 | 缺 `teamId` 或 `initiator.role` → `400 VALIDATION_ERROR`；执行失败 → SSE `{type:'error'}` + `500 DIAGNOSIS_ERROR`（`:620`） | 每次调用新 `consultId`（`diag-<teamId>-<ts36>`）；重放产生新诊断，不幂等（设计如此） |
| `GET /api/diagnosis/consult/:id/report`（同文件） | path `:id`；query `format=markdown\|json` | `200` + 报告内容（`diagnosis_checkpoints` phase=5 为事实源） | 存储不可用 → `503 STORE_UNAVAILABLE` + `degraded:true` | 未完成/不存在 → `404 NOT_FOUND` | 幂等（只读） |
| `GET /api/healthz`（src/routes/healthz.ts L323 ） | 无 | `200` + `{status:'healthy'\|'degraded', checks:{...}}`；组件级 degraded 明细 | 组件缺失（数据库未初始化/无 LLM key/哨兵未跑）→ `status:'degraded'` 仍 **200** | — | 幂等（只读） |
| `GET /api/config/dump`（src/routes/config.ts L25 ） | 无（**受 JWT 保护**，挂载点在 src/server.ts  认证中间件之后） | `200` + 配置来源 provenance | — | 无 token → `401 UNAUTHORIZED`（本卡用作负向 auth 断言靶点） | 幂等（只读） |
| `GET /health`（src/routes/health.ts L16 ） | 无（白名单） | `200` | — | — | 幂等（只读） |

### 2.2 本卡新增/改动的断言面契约（实现期落在此）

| 接口 | @input | @output | @degraded | @error | @idempotent |
|---|---|---|---|---|---|
| `scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（**改**） | 环境：`GS01_LLM=1`（LLM 全链门控，既有）、`GS01_TTFV=1`（prod 计时段，新增）、`GS01_SKIP_ARTIFACT=1`（无产物环境显式降级，新增）；可选 `--installer <dmg>` | `exit 0` = expect.json 全断言 pass；`exit 1` = 任一 fail/error；`exit 2` = bootstrap 超时/前置缺失；证据 `scripts/golden-scenarios/evidence/GS-01-<date>.json` | 产物缺失 → 状态文件写 `ARTIFACT_MISSING`（1-1 判 fail，不 skip）；LLM 未提供 → `CONSULT_LLM_RED`；TTFV 未跑 → `TTFV_RED`（值在 evidence quote 可见） | 断言引擎 `error` 态（查询失败）→ 场景判 fail（"查询失败 ≠ 真空 ≠ 通过"） | 同日重跑覆盖同名证据（`assert.ts` 契约）；临时库/临时端口，跑完清理 |
| `scripts/golden-scenarios/GS-01-first-diagnosis/expect.json`（**改**） | — | `assertions[]` ≥12 条（每条含 `id/desc/purpose/check/expect`）；`evidence_map` 键 = **V1 断言 ID 原文**（`1-1/1-4/6-1/6-2`） | 无 purpose 或缺 `expect` → 引擎拒绝执行（exit 2，防恒真断言） | 清单非法 → `ExpectDocError` → exit 2 | 静态文件，无副作用 |
| `electron/backend-spawn.cjs` → `probeOnce(url, timeoutMs)`（**改**） | `url`（如 `http://localhost:18790`）+ 超时 | `true` = 端口上是**健康的 Synova 后端**（HTTP 200 **且** body 可解析为 `{status}` 字段） | 端口被非 Synova 服务占用但返回 200 → 结构校验不通过 → 视为不可达 → 走 spawn（不误判 `reused`），日志显式 | 网络/超时/解析异常 → `false`（不抛，既有语义） | 幂等（只读探活） |
| `scripts/desktop/first-diagnosis-timing.sh`（**改**） | 既有 `--mode dev\|prod`、`--installer`、`--server-url`、`--out`、`--dry-run`；**新增** `--status-out <path>`（把 `TTFV_OK/TTFV_OVER_TARGET/TTFV_RED` 状态行写盘供 GS-01 断言） | `exit 0` = 里程碑走完（含超目标值）；`exit 1` = 里程碑探测失败（JSON 落盘失败步）；`exit 2` = 前置缺失（prod 缺 installer / 缺 hdiutil） | 每个失败步 `echo "[timing] 失败里程碑: <name>: <原因>"` + JSON `failures[]` | 参数非法 → exit 2 | 重复运行覆盖同名 evidence JSON；`--dry-run` 零副作用 |
| `scripts/product-lines/evidence-writer.py`（**改**） | 既有 `--type ci\|scenario\|test\|founder_demo --date --verdict --points --source [--quote] [--out-dir]`；**新增** `--tag <slug>`（平台/任务维度，如 `mac-d804`） | 文件名 `<type>-<date>[-<tag>][-N].json`（schema=1） | out-dir 不可写 → `log.error` + exit 2（fail-closed） | 参数非法 / founder_demo 缺 `--quote` → exit 2 | 同日同 type/tag 递增序号，不覆盖（既有语义保留） |
| `scripts/desktop/verify-package-signature.sh`（复用） | `--app <path>` \| `--dmg <path>` \| `--all [--dir release]` | `exit 0` 全部封印有效；逐项 ✅/❌ 明细 | 非 macOS → 明确提示 + exit 2 | 路径不存在 / 挂载失败 / 无 codesign → exit 2 | 挂载有卸载清理，幂等 |
| `scripts/desktop/mac-install-verify.sh`（复用） | `[--dry-run] [--skip-build] [--keep-data]` | `exit 0` = 四断言（进程/窗口/healthz/后端日志）全过；证据 `evidence/D519-mac-<ts>/` | 失败步 `echo "[mac-verify] 失败步骤: …"` + evidence `fail.txt` | 缺 dmg/缺 hdiutil → exit 2 | 清理挂载与进程；`--keep-data` 保留 userData |
| `scripts/desktop/win-install-verify.ps1`（复用，**挂账**） | `[-DryRun] [-SkipInstall] [-KeepData]` | `exit 0` = A/B/C/D 四断言全过 | 缺 `.exe` → `exit 2 waiting`（受控状态，不伪造） | 断言失败 → exit 1 | 只 `Stop-Process` 本实例 pid（禁 `taskkill /IM node.exe`） |

---

## S3 数据流图（安装 → 服务自启 → 开窗 → 问卷 → 首诊 → 报告；每步标失败分支）

```
① 打包（Mac: 本机 / CI desktop-build.yml）
   npm run build:backend ──▶ dist/backend.mjs        [失败] esbuild 错 → 无 prod 后端入口
   electron-renderer: npm run build ──▶ dist/renderer/  [失败] tsc/vite 错 → 无首诊 UI
   npx electron-builder --config build-synova.cjs --mac [失败] extraResources 落空 → 空包
        └─ beforePack 断言 dist/backend.mjs 存在（fail-fast）→ 不出空包
        └─ afterPack ad-hoc 签名 + 自检（D713）→ 自检失败 throw，坏包不出货
        └─ 失败分支（产物缺失/未签名）→ 断言 electron-artifact-installable 判 fail（ARTIFACT_MISSING），1-1 红

② 安装（用户双击；Mac 走挂载+拷贝，Win 走 NSIS）
   dmg → /Applications/SynovaAgent.app            [失败] 封印破损 → macOS「已损坏」（D713 已修，回归即红）
   exe → %LOCALAPPDATA%\Programs\SynovaAgent       [失败] UAC 提权框阻塞（D712 实测）→ 挂账，禁止 Mac 结果顶替

③ 启动（双击图标；用户零命令行）
   Electron main boot mode=prod
   ├─ requestSingleInstanceLock()（electron/main.cjs:156） [失败] 二次启动 → 聚焦既有窗口后退出（不产生第二实例）
   └─ ensureBackend({serverUrl:18790, mode:prod, dbPath:userData/data/synova.db})（main.cjs:252 / backend-spawn.cjs:148）
        ├─ probe /api/healthz 200 且 body 结构合法 ──▶ reused=true（不重复 spawn）
        ├─ 不可达 ──▶ spawn(ELECTRON_RUN_AS_NODE=1, dist/backend.mjs) ──▶ probeUntil(默认 60s)
        │      └─ [失败] 超时/重启超限 → degraded=true（log.error 显式）
        │      └─ [失败] 端口被占（EADDRINUSE）→ 后端进程 exit 1（src/server.ts L511 reject → src/index.ts L24）→ degraded=true
        └─ [降级分支] 加载离线页（"Synova Server 未启动 + 地址 + 重试"）—— 用户可见，不静默

④ 开窗
   prod: loadFile(resources/renderer/index.html)（main.cjs:127）
   did-finish-load 探针 → `[preload-check] OK: electronAPI 已暴露` / `FAIL`（main.cjs:119/121）
        └─ [失败] FAIL → 渲染层无 electronAPI → API 请求打 file:// 被 CSP 拦（F3 类回归）→ 1-4 必红

⑤ 问卷（= 首启向导 + 首条诉求）
   LlmSetupCard（/api/llm/* 免 JWT，D575）  [降级] 「暂不配置」→ StatusBar 黄条（不静默）
   首条诉求文本 → useStreaming（electron-renderer 的 src 目录下 hooks/useStreaming.ts）

⑥ 首诊触发
   POST /api/diagnosis/consult（免 JWT，D590 裁决①）
        ├─ [失败] 缺 teamId / initiator.role → 400 VALIDATION_ERROR（入口可达性据此断言）
        └─ SSE 200 + X-Consult-Id

⑦ 六阶段诊断（SSE）
   phase_started 0..5 → complete + reportId
        ├─ [降级] 客户配置/计量/注入失败 → warn + degraded，诊断继续
        └─ [失败] LLM 不可达/断网 → SSE {type:'error'} + 500 兜底 → 用户可见错误提示

⑧ 报告
   GET /api/diagnosis/consult/:id/report?format=markdown → 200（一页纸 markdown）
        ├─ [失败] 未完成/已过期 → 404 NOT_FOUND
        └─ [降级] 存储不可用 → 503 STORE_UNAVAILABLE + degraded=true

⑨ 证据落盘（本卡新增面）
   GS-01 断言引擎（scripts/golden-scenarios/common/assert.ts）→ evidence/GS-01-<date>.json（record_type=scenario）
   → calc-progress.py 消费（14 天 TTL + A1：线1 modules=electron/ 有变更即 stale）
   → 产品进度页（1-1/1-4/6-1/6-2 转 pending_k3 → K3 复核转 verified）
```

---

## S4 失败模式表（≥7 条：行为 + 降级动作 + 用户可见信号，禁静默）

| # | 失败模式 | 行为（实测/代码事实） | 降级动作 | **用户可见信号** |
|---|---|---|---|---|
| F1 | **端口占用**（18790 被第三方进程占用） | `probeOnce` 探活失败 → spawn 后端 → `app.listen` 触发 `server.on('error', reject)`（src/server.ts L511 ）→ src/index.ts L24  `process.exit(1)` → `probeUntil` 超时 → `degraded:true` | 保持窗口存活 + 离线页；`backend.log` 记录 spawn 与失败原因；断言 `backend-healthz-live` 红 | 离线页「⚠ Synova Server 未启动 + 服务器地址 http://localhost:18790 + 重试连接」（`electron/main.cjs:45-70`）；控制台 `[electron] 后端自启 degraded — …` |
| F2 | **端口被"伪健康"服务占用**（返回 200 但非 Synova） | 旧行为：`probeOnce` 只看 statusCode 200 → 误判 `reused=true` → 窗口连到别人的服务（UI 空白/接口 404） | 本卡**补强**：探活加响应体结构校验（`{status}` 字段），结构不符 → 视为不可达 → 走 spawn → spawn 失败则 degraded | 控制台 `[backend-spawn] 探活响应结构不符 — 视为不可达` + 离线页（不再静默连错服务） |
| F3 | **服务未起**（spawn ENOENT / 包内 dist 缺失） | `ensureBackend` catch spawn error → `degraded:true`，`error` 带原因 | 离线页 + 日志；不重启风暴（10 分钟窗口内最多 3 次重启，超限即降级） | 离线页（同 F1）+ `[electron] 后端自启 degraded — spawn 失败: …` |
| F4 | **无数据**（首次启动空库，客户还没给任何数据） | `/api/healthz` 返回 `status:'degraded'` + `checks.database.detail = 数据库文件不存在(首次启动尚未初始化)`（D712 原始证据）；诊断仍可发起（诉求路径） | 组件级 degraded 明细透传；报告标注数据不足；不阻断首诊 | 健康端点明细（`curl /api/healthz` 可见）+ 窗口内黄条/空态提示 |
| F5 | **断网 / LLM 不可达** | consult SSE 发 `{type:'error', code, message}`（src/routes/diagnosis.ts L183 ）；异常兜底 `500 DIAGNOSIS_ERROR`（`:620`） | 诊断中断但进程不崩；证据 `consult-llm-status.txt = CONSULT_LLM_RED (curl exit=N)`；重试可用 | 对话流内错误事件（用户看到失败原因）+ 可重发；不假装成功 |
| F6 | **安装权限被拒** | macOS：未签名/带 quarantine → 「已损坏，无法打开」（D713 事故形态；ad-hoc 签名 + 打包自检已修，回归即红）；Windows：NSIS 需 UAC 提权，D712 实测人工点击/提权双阻塞 | 构建期 fail-fast（签名自检不过不出包）；运行期不降级（安装是 OS 层权限，产品无法绕过） | macOS Gatekeeper 弹窗 / Windows UAC 提权框；runbook 给人工放行步骤 |
| F7 | **重复安装 / 重复启动** | 二次启动：`requestSingleInstanceLock()` 返回 false → `app.quit()` + 首实例 `second-instance` 聚焦（`electron/main.cjs:156-166`）；覆盖安装：`cp -R` 替换 `.app`，userData 不动（`scripts/desktop/upgrade-data-verify.sh`） | 单实例保护 SQLite 不被双写；覆盖安装后 `SYNOVA_DB_PATH` 仍指 userData | 第二次双击 = 窗口被拉到前台（用户看到"又打开了"）；无报错弹窗 |
| F8 | **升级覆盖旧数据** | 覆盖安装后 `upgrade-data-verify.sh` 断言：表清单 / 关键表行数 / db md5 / `integrity_check` 前后一致 | 不一致 → 脚本 `die` + evidence `fail.txt`（exit 1），不静默 | 断言明细落 `scripts/golden-scenarios/evidence/upgrade-data-<date>-<ts>/`；进度页 1-7（V1 外）红 |
| F9 | **产物缺失 / 断言漂移**（本卡新增失败面） | `release/` 无 dmg/exe → GS-01 写 `ARTIFACT_MISSING` → `electron-artifact-installable` 判 fail | 显式红 + 修复指引（`npm run electron:build:mac`）；`GS01_SKIP_ARTIFACT=1` 只影响本机复跑便利性，**不改变 1-1 判红** | GS-01 输出 `[GS-01] 产物缺失：请先跑 npm run electron:build:mac`；证据 JSON 中 1-1 = fail |
| F10 | **证据过期（14 天 TTL / A1 代码变更）** | `calc-progress.py:67` TTL=14 天；证据日期后 `electron/**` 有提交 → 自动 stale（不继承旧绿） | `rerun-evidence.sh` 一键重跑（GS 场景 + 线1 vitest + A2 套件）→ 写新证据 → 刷新进度 | 产品进度页 🔴/🟡 stale 标记 + `gen-expiry-warnings.py` 过期告警 |

---

## S5 切片计划（6 片，每片可独立验收 + 独立回滚）

> 排序即依赖顺序；每片一个提交（禁止混片）。域：win（D773 Mac 代行）。文件预算 ≤12（本表合计 11）。

### 切片 0：GS-01 断言契约校准 + V1 绑定（前置，解锁全部）
- **改哪些文件**：`scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（S0-1 负向断言迁靶 + consult 免 JWT 契约断言）、`scripts/golden-scenarios/GS-01-first-diagnosis/expect.json`（`evidence_map` 键改 V1 ID）、同目录 `README.md`（口径与诚实 RED 声明）、`tests/golden-scenarios/gss-common.test.ts`（新增契约回归用例）
- **断言**：`bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh` → exit 0；`python3 -c` 校验 `evidence_map` 键 ⊇ {`1-1`,`1-4`,`6-1`,`6-2`}；无 token 调 `/api/config/dump` → 401；无 token 调 consult（缺 `initiator.role`）→ 400 且**非** 401
- **回滚方式**：`git revert <该片 commit>`（纯脚本 + 测试，零产品代码；回滚后 GS-01 回到 8 断言口径，证据同日重跑覆盖）

### 切片 1：打包产物 + 安装脚本（1-1 / 1-3）
- **改哪些文件**：`scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（新增产物段：解析 `release/` 最新 dmg/exe → `verify-package-signature.sh --all --dir release` → 写 `electron-artifact-check.txt`）、`expect.json`（新增 `electron-artifact-installable`）、`README.md`（产物前置说明）
- **断言**：GS-01 exit 0 且证据中 `1-1 = pass`；反向验证：`mv release/*.dmg /tmp` → GS-01 必红（`ARTIFACT_MISSING`）→ 移回后复绿；`bash scripts/desktop/mac-install-verify.sh`（Mac 实机四断言）exit 0
- **回滚方式**：revert 该片 commit；产物断言消失即回到切片 0 口径（1-1 退回只靠 CI `desktop-build.yml` 的产物面）

### 切片 2：服务自启与健康检查（1-4 前半）
- **改哪些文件**：`electron/backend-spawn.cjs`（`probeOnce` 响应体结构校验）、`tests/electron/backend-spawn.test.ts`（结构校验三路径用例）、`scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（新增 `backend-healthz-live` + `backend-restart-healthz-200` 两段）、`expect.json`
- **断言**：GS-01 exit 0 且 `1-4` 有 pass；重启段：同一临时 data dir 二次 bootstrap → `/api/healthz` 200；伪健康注入：本地起一个返回 200 非 JSON 的假服务占端口 → 断言"不判定为 reused"（单测覆盖）
- **回滚方式**：revert 该片 commit（`electron/` 回滚后必须重跑 `npx vitest run tests/electron/`）；**注意**：`electron/**` 属线1 modules → 回滚后旧证据自动 stale（A1），需重跑 GS-01

### 切片 3：开窗即用（免命令行）（1-4 后半，含 D747 产物路径实测）
- **改哪些文件**：`scripts/desktop/mac-install-verify.sh`（新增 `[preload-check] OK` 断言：从 app 日志抓取并落 evidence）、`scripts/desktop/first-diagnosis-timing.sh`（同上抓取，供 prod 段）、`docs/synova/runbooks/first-diagnosis-e2e.md`（复跑手册 + 挂账口径）、`tests/electron/mac-install-verify.test.ts`（契约回归）
- **断言**：重打包 → `bash scripts/desktop/mac-install-verify.sh` → exit 0，且 evidence 目录含 `1-4-preload-check.txt`（`[preload-check] OK` 原文 + 时间戳）与 `1-4-renderer-api.txt`（渲染层真实 API 请求记录，来自 `backend.log` 的 `/api/` 请求行，计数 ≥1）
- **回滚方式**：revert 该片 commit（脚本层）；已生成的 evidence 文件随之移除，避免"证据与代码不符"

### 切片 4：问卷 → 首诊 → 报告链路（6-1 / 6-3 前置）
- **改哪些文件**：`scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（consults 契约段 + LLM 门控段沿用 D527；新增报告产物非空断言）、`expect.json`、`README.md`（诚实 RED 声明更新）
- **断言**：`GS01_LLM=1 bash …/run.sh` → exit 0 且 `1-6`（V1 外）/`6-1` 状态为 GREEN（phase_started 0-5 + complete + reportId + 报告端点 200）；无 LLM key 时 `6-1` 如实 RED（不伪造）
- **回滚方式**：revert 该片 commit；门控段回滚后 LLM 组不再产出状态文件（`6-1` 退回无证据）

### 切片 5：计时字段与证据落盘（6-2）+ 双机证据命名 + 挂账登记
- **改哪些文件**：`scripts/desktop/first-diagnosis-timing.sh`（`--status-out`）、`scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（TTFV 段，dev 计时 + `GS01_TTFV=1` 时 prod 计时）、`expect.json`、`scripts/product-lines/evidence-writer.py`（`--tag`）、`tests/control-tower/product-lines.test.py`（`--tag` 用例）
- **断言**：GS-01 exit 0 且证据中 `6-2 = pass`（计时 JSON 含 5 里程碑字段 + `verdict ∈ {WITHIN_TARGET, OVER_TARGET}`）；`--tag` 用例：同 type/date 不同 tag → 两文件并存（防 D715 P1-1 撞名）
- **回滚方式**：revert 该片 commit；`--tag` 回滚后 evidence-writer 回到无 tag 文件名（**双机并行时须错开日期**，登记为回滚副作用）

---

## S6 断言表（1-1/1-2/1-3/1-4/1-8 + 6-1/6-2/6-3 逐条绑定 verify / 场景 ID / 证据类型 / fail_when）

| 断言 | 判定式 | **verify 命令**（可逐字复跑） | 场景 ID | 证据类型 | fail_when | 当前状态（2026-09-17） |
|---|---|---|---|---|---|---|
| **1-1** | Mac 安装包能打出且可安装 | `bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（exit 0）**且** `ls release/*.dmg` 有产物 **且** `bash scripts/desktop/verify-package-signature.sh --all --dir release`（exit 0） | GS-01 | scenario（+ 产物清单 `D804-mac-<date>/1-1-artifacts.txt`：文件名/大小/md5/Info.plist 版本 == package.json 版本） | 产物缺失或场景红 | 部分：pack 配置断言 pass（09-16 证据），**产物存在性无断言** → 本卡切片 1 补 |
| **1-2** | Win：双击 → 装好 → 出窗 | Win 真机：`powershell -File scripts/desktop/win-install-verify.ps1`（exit 0，四断言 A/B/C/D） | GS-01（V1 口径）+ Win 真机 | founder-demo（`win-install-verify` 原始输出 + exe md5 + 时间戳） | 装不上/不弹窗 | **缺环境**：无 Win 机、`release/` 无 `.exe` → 脚本 `exit 2 waiting`；按 D773 **挂账**，禁 Mac 结果顶替 |
| **1-3** | Mac：双击 → 装好 → 出窗 | `bash scripts/desktop/mac-install-verify.sh`（exit 0，四断言：进程/窗口/healthz/后端日志） | GS-01 + Mac 真机 | founder-demo（+ scenario 引用） | 同上 | 部分：D712/D713 旧产物证据已 stale；**本卡切片 1/3 重打后重测** |
| **1-4** | 服务自启 + 开窗即用（用户不碰命令行） | ① `bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（exit 0，含 `backend-healthz-live` + `backend-restart-healthz-200`）；② 打包实测：`bash scripts/desktop/mac-install-verify.sh` exit 0 **且** `D804-mac-<date>/1-4-preload-check.txt` 含 `[preload-check] OK` **且** `1-4-renderer-api.txt` 记录的渲染层 `/api/` 请求数 ≥1 | GS-01 | scenario | 重启后服务不在 / 渲染层 API 请求为 0 | **K3 判 failed（D715 §四，不可自动转绿）**：需切片 3 的重打包实测双证据 → 转 pending_k3 |
| **1-8** | 审计员复核安装实测记录（独立重跑） | K3 独立重跑（外部；本卡只保证证据齐备可复核：产物 md5 + 安装断言原文 + `[preload-check]` 日志 + 渲染层 API 记录） | — | k3（`k3_only: true`） | 复核 NOT-AUDITABLE/FAIL | 旧证据（`task-D527.json`）19 天已红；**转绿入口 = 本卡证据齐备后进 K3 队列** |
| **6-1** | 首诊旅程端到端（新装 → 问卷 → 报告） | `GS01_LLM=1 bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（exit 0；`consult-llm-status.txt = CONSULT_LLM_GREEN`：phase_started 0-5 全出现 + complete + reportId 非空 + `GET /report?format=markdown` 200） | GS-01 | scenario | 任一环断 | **0/4**：GS-01 现 exit 1（S0-1 口径冲突）；LLM 组一直如实 RED（未提供 key） |
| **6-2** | ≤3 天出首诊（TTFV 可测） | ① dev 计时（无条件，随 GS-01）：`bash scripts/desktop/first-diagnosis-timing.sh --mode dev --server-url <GS-01 临时端口> --out <evidence>`（exit 0，JSON 含 5 里程碑 + verdict）；② prod 实测（`GS01_TTFV=1`）：`--mode prod --installer <release dmg>` → `total_sec ≤ 259200` | GS-01 | scenario（+ `first-diagnosis-timing-<date>.json`） | 超 3 天/无计时 | **无计时字段绑定**（V1 verify 写"GS-01 计时字段"，但 GS-01 现无该断言）→ 本卡切片 5 补 |
| **6-3** | 命中 ≥1 个老板盲区 | 创始人演示核验：首诊报告中标出 ≥1 条"企业主此前没想到"的结论 → 记录（截图/纪要路径）→ `python3 scripts/product-lines/evidence-writer.py --type founder_demo --points 6-3 --verdict pass --quote <记录路径> --tag <platform-d804>` | GS-01（报告产物）+ 演示 | founder-demo（**必须 --quote**，防空壳核验） | 无新信息 | 无证据；**待创始人演示**（挂账项，不可由机器代证） |
| **6-7** | 审计员复核首诊旅程 | K3 独立复核（外部） | — | k3（`k3_only: true`） | 复核不通过 | 未进队列；入口 = 6-1 GREEN 证据在档 |

> **口径冲突登记（交 CTO 冻结时裁）**：`product-lines.yaml` 线6 `6-3` 的 `evidence` 字段写 `["scenario:GS-01"]`，而 V1 分母文档（权威②）判据为 `founder-demo`。本卡按 **V1 分母文档**执行（founder-demo），并在实现期一并修正 yaml 绑定（属 D795 账本派生器域，需 CTO 确认写集归属）。

---

## S7 幂等与可观测（重复安装 / 重复运行 / 日志与计数 / 证据落盘路径）

### 7.1 重复安装与重复运行

| 动作 | 行为 | 幂等性 | 证据 |
|---|---|---|---|
| 二次双击/二次启动 app | `requestSingleInstanceLock()` false → 本实例 `app.quit()`；首实例收到 `second-instance` → `show()+focus()`（`electron/main.cjs:156-166`） | ✅ 不产生第二实例（保护 SQLite 单写） | 控制台 `[electron] 已有实例运行，本实例退出（单实例锁）` |
| 覆盖安装（升级） | 替换 `.app`/`.exe`，userData 不受影响；`SYNOVA_DB_PATH` 仍指 userData/data/synova.db | ✅ 数据不丢（`upgrade-data-verify.sh` 断言表清单/行数/md5/integrity 前后一致） | `scripts/golden-scenarios/evidence/upgrade-data-<date>-<ts>/` |
| 重复跑 GS-01（同日） | 临时库 + 临时端口，跑完 `cleanup` 删除；证据同名覆盖（`assert.ts` 契约）→ 同日重跑零新增文件 | ✅ 幂等 | `scripts/golden-scenarios/evidence/GS-01-<date>.json`（覆盖） |
| 重复跑 GS-01（跨日） | 新日期 → 新文件；旧文件保留（14 天后自动 stale） | ✅ | 同上 |
| 重复跑计时脚本 | 同名 evidence JSON 覆盖；`--dry-run` 零副作用 | ✅ | `scripts/golden-scenarios/evidence/first-diagnosis-timing-<date>.json` |
| evidence-writer 重复写 | 同日同 type/tag → 递增序号（`-1`、`-2`），不覆盖 | ✅ | `docs/synova/product-lines/evidence/<type>-<date>[-<tag>][-N].json` |

### 7.2 日志与计数（可观测面）

| 观测点 | 载体 | 用途（断言/复核） |
|---|---|---|
| 启动模式 | `[electron] boot mode=prod\|dev server=<url>`（`electron/main.cjs:247`） | 证明跑的是打包态（prod）而非 dev |
| 服务自启 | `[backend-spawn]` 前缀日志 + `backend.log`（userData/logs） | `reused` / `started` / `degraded` 三态可判 |
| 渲染层链路 | `[preload-check] OK\|FAIL`（`electron/main.cjs:119/121`） | **1-4 关键判据**：FAIL = UI 死（F3 回归） |
| 渲染层→后端真实请求 | `backend.log` 中来自渲染层的 `/api/...` 请求行（计数 ≥1） | **1-4 关键判据**：0 条 = 链路未通（D713 教训） |
| 首诊 SSE | `consult-llm-stream.txt`（事件流原文）+ `consult-llm-status.txt`（GREEN/RED） | 6-1 判据，K3 可独立复核 |
| TTFV 里程碑 | timing JSON：`install_start / install_done / app_launch / healthz_200 / first_diagnosis_ready` + `total_sec` + `verdict` | 6-2 判据 |
| 健康明细 | `GET /api/healthz` → `checks.{database,llm_connectivity,last_sentinel_run,disk_free_gb,data_freshness,watchdog_alive}` | F4 无数据降级可见性 |
| 降级留痕 | `.codex/control-tower/logs/degraded-events.log`（门禁脚本降级）+ 服务 `log.warn/error` | 铁律 24/31 审计面 |

### 7.3 证据落盘路径（全部入 git，不吃 .gitignore）

| 证据 | 路径 | 类型 | 消费方 |
|---|---|---|---|
| GS-01 场景证据 | `scripts/golden-scenarios/evidence/GS-01-<date>.json` | scenario | `calc-progress.py` → 进度页 |
| SSE 事件流原文 | `scripts/golden-scenarios/evidence/GS-01-llm-stream-<date>.txt` | 佐证 | K3 复核 |
| 计时证据 | `scripts/golden-scenarios/evidence/GS-01-llm-timing-<date>.json`、`first-diagnosis-timing-<date>.json` | scenario 佐证 | 6-2 |
| 安装实测证据 | `docs/synova/product-lines/evidence/D804-mac-<date>/`（`1-1-artifacts.txt` / `1-3-install-assertions.txt` / `1-4-preload-check.txt` / `1-4-renderer-api.txt`） | 原文（命令 + 原始输出） | K3 复核 1-8 |
| 兑换证据 | `docs/synova/product-lines/evidence/scenario-<date>-<tag>.json`（`record_type=scenario`，points=`1-1,1-3,1-4`） | scenario | `calc-progress.py` |
| 演示核验 | `docs/synova/product-lines/evidence/founder_demo-<date>-<tag>.json`（**必须含 quote**） | founder_demo | 1-2/1-3/6-3 |
| 挂账登记 | `task-state/D804.json`（`blocked` / `next` 字段）+ runbook「挂账」节 | 流程 | CTO/创始人 |

> **命名纪律（防 D715 P1-1 双机 add/add 撞名）**：Mac 侧证据 tag 一律 `mac-d804`，Win 侧 `win-d804`；文件名含平台与任务号，两侧并存不冲突。

---

## S8 回滚方案（版本回退 / 特性开关）

### 8.1 版本回退（按片 revert，无跨片耦合）

| 触发情形 | 回退动作 | 回退后必做 |
|---|---|---|
| 新断言误红（口径写错/环境差异）导致 GS-01 长期红 | `git revert <片 commit>`（切片 0-5 各自独立；切片 0 是唯一全局前置，revert 它 = 回到 8 断言口径） | 重跑 GS-01 生成新证据（旧证据因 A1 自动 stale，不会误当绿） |
| `electron/backend-spawn.cjs` 探活结构校验引发回归 | revert 切片 2 的 electron 段（或整体回退该片） | 重跑 `npx vitest run tests/electron/` + GS-01；线1 证据 stale 后重跑 |
| `evidence-writer.py --tag` 影响存量调用 | revert 切片 5 的该文件（`--tag` 可选参数，缺省行为与回退前完全一致） | 跑 `python3 -m pytest tests/control-tower/product-lines.test.py`（或该仓库既有 py 测试口径） |
| 安装/实测脚本改动导致取证失败 | revert 切片 1/3 的脚本段 | 用回退前脚本重新取证，证据日期更新 |

**回退铁律**：任何回退提交必须附「回退后重跑命令 + 原始输出」，禁止"回退了但证据还是旧的"。

### 8.2 特性开关（环境级，仅作用于场景/取证脚本，**不改产品默认行为**）

| 开关 | 默认 | 作用 | 关闭后果（必须是显式 RED 或显式 skip，不得静默绿） |
|---|---|---|---|
| `GS01_LLM=1` | 关（未设） | 启用真实六阶段 consult（LLM 全链） | 关：`CONSULT_LLM_RED (LLM key 未提供)` 落盘，6-1 无 GREEN 证据 |
| `GS01_TTFV=1` | 关 | 启用 prod 安装计时段（需 `release/` 产物） | 关：`TTFV_RED` 落盘，6-2 只剩 dev 计时（instrumentation 仍判 pass） |
| `GS01_SKIP_ARTIFACT=1` | 关 | 无产物环境（fresh clone / CI）下跳过产物**检查动作**，便于跑其余断言 | 关：产物段正常执行；开：状态文件写 `ARTIFACT_SKIPPED`，**1-1 仍判 fail**（显式降级，不放绿） |

**产品侧无开关**：切片 2 的探活结构校验是 fail-closed 的**唯一行为**（不符合结构即视为不可达），无旁路环境变量；如需回滚 → 走 8.1 版本回退。

---

### 12.1 写集 (11 修改 + 2 新建)
| 文件 | 操作 | 说明 |
|------|:---:|------|
| scripts/golden-scenarios/GS-01-first-diagnosis/ | 修改 | `run.sh`（契约校准 + 产物段 + healthz/重启段 + TTFV 段）、`expect.json`（断言 + evidence_map 键改 V1 ID）、`README.md`（口径与诚实 RED） |
| scripts/desktop/first-diagnosis-timing.sh | 修改 | 新增 `--status-out`：把 `TTFV_OK/TTFV_OVER_TARGET/TTFV_RED` 状态行写盘，供 GS-01 断言消费（既有里程碑/退出码语义不变） |
| scripts/desktop/mac-install-verify.sh | 修改 | 新增 `[preload-check]` 原文抓取 + 渲染层 `/api/` 请求计数落 evidence（1-4 双证据） |
| scripts/product-lines/evidence-writer.py | 修改 | 新增 `--tag`（平台/任务维度）防双机同名 add/add（D715 P1-1）；缺省行为与现状逐字一致 |
| electron/backend-spawn.cjs | 修改 | `probeOnce` 加响应体结构校验（`{status}` 字段），防"伪健康服务"误判 `reused`（F2）；不改 spawn/重启/degraded 既有语义 |
| tests/golden-scenarios/ | 修改 | `gss-common.test.ts` 增 GS-01 契约回归（断言集 / evidence_map 键 ⊆ V1 ID / exit 语义 / 缺产物判红） |
| tests/electron/backend-spawn.test.ts | 修改 | 探活结构校验三路径（正常 JSON / 200 非 JSON / 超时）——铁律 48 正常+降级+边界 |
| tests/electron/mac-install-verify.test.ts | 修改 | 新证据抓取契约的静态回归（防脚本漂移） |
| tests/control-tower/product-lines.test.py | 修改 | `evidence-writer --tag` 用例（同名不同 tag 并存 / 缺 tag 向后兼容） |
| docs/synova/runbooks/first-diagnosis-e2e.md | 修改 | 端到端复跑手册（命令 + 门控 + 诚实 RED + 挂账口径） |
| docs/synova/product-lines/evidence/ | 新建 | 本卡证据目录：`D804-mac-<date>/`（四份原文）+ `scenario-<date>-mac-d804.json`（兑换证据）——目录级声明（父目录已存在；新文件由实现卡产出） |
| task-state/ | 修改 | `D804.json` 回填 spec/impl 段（status 状态机，D382 口径） |
| docs/plans/codex/implementation/ | 新建 | 本 spec 自身（`SYNOVA-IMPL-DSH-D804-line1-6-onboarding-20260917.md`）——过程工件 |

> 计数口径：11 修改（含 4 个目录级）+ 2 新建（evidence 目录级 + spec 文件）。实现提交后按 D590 先例精确化为确切文件名。
> **共享资源标注**：`docs/synova/product-lines/evidence/` 与 K3/其他卡共用父目录 → 本卡一律 `D804-mac-*` / `*-mac-d804` 前缀，与其他卡零同名；`scripts/golden-scenarios/evidence/` 由场景脚本机器生成，不手工编辑。

---

## Test Requirements（L1 / L2a / L2b / L2c）

> 铁律 33 命名约定 + 铁律 48 非空壳（每文件 expect() 覆盖正常/降级/边界三路径）。**测试先行**：每片先写红，再改脚本。

| 层 | 类型 | 文件 | 覆盖（正常 / 降级 / 边界） |
|---|---|---|---|
| **L1** | 断言清单契约（单元） | `tests/golden-scenarios/gss-common.test.ts`（扩展） | ① `evidence_map` 键 ⊆ {`1-1`,`1-3`,`1-4`,`6-1`,`6-2`} ∪ 非 V1 标签；② 每条断言含 `purpose`（缺则拒执行）；③ exit 0/1 语义；④ 缺产物 → `ARTIFACT_MISSING` 判 fail（**不得 skip**）；⑤ 假 `noauth-401` 型断言不得回归（负向断言靶点必须是受保护路径） |
| **L1** | 探活结构校验（单元） | `tests/electron/backend-spawn.test.ts`（扩展） | ① 200 + `{status}` → true（reused）；② 200 + 非 JSON/无 status → false（走 spawn）；③ 超时/连接拒绝 → false（不抛）；④ 原有 spawn/重启/degraded 用例零回归 |
| **L1** | 脚本契约静态回归 | `tests/electron/mac-install-verify.test.ts`（扩展）、`tests/desktop/`（如需） | ① 脚本含 `[preload-check]` 抓取与渲染层请求计数逻辑；② 失败路径 `echo 失败步骤` + evidence（不静默）；③ exit 0/1/2 语义与注释一致 |
| **L1** | 证据命名（单元） | `tests/control-tower/product-lines.test.py`（扩展） | ① `--tag` → 文件名含 tag；② 无 `--tag` → 与现状同名（向后兼容）；③ 同名不同 tag 并存；④ founder_demo 缺 `--quote` → exit 2 |
| **L2a** | 接线（同层集成） | `scripts/golden-scenarios/GS-01-first-diagnosis/run.sh` | 真实 bootstrap（临时端口 + 临时库）→ 真实 HTTP 断言（healthz/consult 校验/报告端点）→ 断言引擎落 evidence。**不 mock 管线**（铁律 12） |
| **L2b** | 降级路径 | 同上 + 单测 | ① 缺产物 → `ARTIFACT_MISSING`；② 无 LLM key → `CONSULT_LLM_RED`；③ TTFV 未跑 → `TTFV_RED`；④ 端口被伪服务占 → 不判 reused；⑤ 所有降级均有 log + 状态文件（铁律 11/24/31） |
| **L2c** | 边界 | 同上 | ① 同日重跑同名覆盖（幂等）；② 重启后 healthz 仍 200；③ 报告未完成 → 404；④ 存储不可用 → 503 degraded（如可注入） |

**red 证据要求**：交付时必须贴「各层测试首跑失败（red）→ 实现后 green」的原始输出（派单 §三 每片节奏）；仅 green 无 red → 判空壳。

---

## Wiring Verification

| 变更 | 生产调用点（真实传递，测试调用不计） | 验证方式 |
|---|---|---|
| `run.sh` 新增断言段 | GS-01 场景脚本本体 = 生产验收入口（`bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`）；被 `scripts/product-lines/rerun-evidence.sh`（D774 保鲜流水线）调用 | `grep -rn "GS-01-first-diagnosis" scripts/product-lines/rerun-evidence.sh scripts/golden-scenarios/README.md` 命中 |
| `expect.json` 新断言 | `scripts/golden-scenarios/common/assert.ts` 读入执行（`--expect` 路径由 run.sh 传） | 跑 GS-01 → 证据 JSON 中逐条 verdict 出现 |
| `probeOnce` 结构校验 | 生产调用链：`electron/main.cjs:252` `ensureBackend(...)` → `backend-spawn.cjs:148` → `probeOnce`（`backend-spawn.cjs` 内 `ensureBackend` 第一步探活） | `grep -rn "probeOnce" electron/`；打包态实测日志（`reused`/`spawn` 分支） |
| `first-diagnosis-timing.sh --status-out` | GS-01 `run.sh` TTFV 段调用（`bash scripts/desktop/first-diagnosis-timing.sh --mode dev --status-out …`）；runbook 手工复跑同命令 | `grep -rn "first-diagnosis-timing" scripts/golden-scenarios/GS-01-first-diagnosis/run.sh docs/synova/runbooks/first-diagnosis-e2e.md` 命中 |
| `evidence-writer.py --tag` | `scripts/product-lines/run-machine-evidence.sh` + `rerun-evidence.sh` + 人工兑换（runbook 命令） | `grep -rn "evidence-writer" scripts/product-lines/` 命中；`--tag` 用例绿 |
| 新证据文件 | `calc-progress.py` 扫描 `docs/synova/product-lines/evidence/*.json`（`load_evidence_records`） | `python3 scripts/product-lines/calc-progress.py` → 进度页 1-1/1-4/6-1/6-2 状态变化 |

> **WIRE CHECK（铁律 0-2 Step 5）**：实现完成后必须贴 `grep -rn` 结果证明上述每个新符号/新参数在生产路径有调用方（`scripts/golden-scenarios/`、`scripts/desktop/`、`electron/` 三处），测试文件内的调用不计。

---

## 现状审计（Current State，2026-09-17 于 origin/main @0f59e514 实测）

| # | 声称 | 证据（可核） |
|---|---|---|
| C1 | GS-01 当前 **exit 1** | `scripts/golden-scenarios/evidence/GS-01-2026-09-16.json` → `verdict: "fail"`；断言 `noauth-401` detail：`contains "401" 未命中` |
| C2 | 根因 = 断言与 D590 裁决① 冲突（**非代码缺陷**） | src/middleware/auth.ts L121  `path.startsWith('/api/diagnosis/consult')` 在白名单内；`:87-101` 注释载明"D590（创始人裁决① 鉴权过桥）… 单机本地信任" |
| C3 | GS-01 断言集从未绑定线6 断言 | `expect.json` `evidence_map` 键 = `S0-1/S0-2/L1-1/L1-4/L1-5/L1-6/L1-7`（无 `6-1/6-2/6-3`）；`calc-progress.py:177` 按 `acceptance_point` 精确匹配 → 线6 场景证据恒为零 |
| C4 | 1-1 无产物断言（仅打包配置静态断言） | `expect.json` `electron-pack-config-valid` = grep `build-synova.cjs`/`main.cjs` 文本；`release/` 产物存在但无断言消费 |
| C5 | 1-4 被 K3 判 **failed 且不可自动转绿** | `docs/synova/audit-reports/2026-09-13-D715.md` §四（转绿条件 = 重打包实测 + `[preload-check] OK` + 渲染层 API 请求双双落盘） |
| C6 | F3 修复已在 main（沙箱 preload 不 require 相对文件 + 启动自检哨兵） | `electron/preload.cjs:17-31`（`additionalArguments` 透传）；`electron/main.cjs:82-89`、`:112-125`（`[preload-check]` 探针） |
| C7 | 打包链 + 签名门禁已在 main | `build-synova.cjs`（beforePack/afterPack + 自检）、`.github/workflows/desktop-build.yml`（mac+win 矩阵 + 产物断言 + `verify-package-signature.sh --all`） |
| C8 | 端口来源：Electron 探 18790；后端端口 = `PORT` 或 `synova.json server.port` 或 3000 | `electron/config.json`（`serverUrl: http://localhost:18790`）；src/config.ts L107 ；仓库根 `synova.json`（`server.port: 18790`）；src/config-file.ts L44 （`join(process.cwd(),'synova.json')`）；`electron/backend-spawn.cjs:168-174`（prod env 只设 `ELECTRON_RUN_AS_NODE` + `SYNOVA_DB_PATH`，**未设 PORT**） |
| C9 | 打包产物内**无** `synova.json` | `ls 打包产物 app 包内 Contents/Resources 目录（`ls release/mac-arm64/` 可建）——**无** synova.json；`build-synova.cjs:153-175` 的 `files`/`extraResources` 均未包含） |
| C10 | 单实例锁 + 数据目录重定向已实现 | `electron/main.cjs:156`（`requestSingleInstanceLock`）、`:252-259`（`dbPath = userData/data/synova.db`）；`scripts/desktop/upgrade-data-verify.sh`（覆盖安装数据断言） |
| C11 | 现状账簿：线1 3/5、线6 0/4 | `docs/synova/project/ledger.json`（generated_at 2026-09-17T01:26:34+08:00，head f83f85c2）：线1 `v1_passed=3`（1-1/1-4/1-8），线6 `v1_passed=0` |

> **C8/C9 联立的未定论项**（见文末"未能定论项"）：打包态后端端口解析依赖 `cwd/synova.json`，而包内无该文件、spawn 未注入 `PORT` → 在**干净机器**上后端可能落在 3000 而 Electron 探 18790。既有证据（`D712-mac-20260913/1-3-healthz.json` 200）**不能区分**"包内后端自启成功"与"本机已有 18790 服务被复用"——两种情形都会 200。故本卡把它列为**必须实测澄清**项（切片 3 的 prod 复跑为唯一判据，命令见 S6 1-4）。**实现卡禁止在未实测前声称该链路已通。**

---

## What We Don't Do（明确排除）

| 不做 | 原因 |
|---|---|
| 改 src/middleware/auth.ts  的 consult 白名单口径 | 属 D590 创始人裁决①面；本卡只把**断言**对齐裁决，不动裁决 |
| 复活 `/api/diagnosis/interview`（结构化问卷端点） | D590 裁决② 已 410 下线；复活 = 与已生效裁决冲突（口径澄清见 S1 / 决策参考 D3） |
| 改 `scripts/product-lines/calc-progress.py` | 判分器红线（派单 §一）；本卡只产出证据，不动判分 |
| 改 src/ 下的任何文件 | 派单 §四 规格冻结门；本卡阶段 0 零 src 变更 |
| 碰 `scripts/audit/**`、写审计标准、做 K3 判定 | K3 专属红线（D336 多 Agent 协议） |
| 改 `.github/workflows/ci.yml` | 控制塔/CI 域，非本卡写集；CI 侧产物面继续由既存 `desktop-build.yml` 承载 |
| 用 Mac 实测结果声称 Win 实机通过 | D773 规约明令：实机级证据挂账，禁顶替 |
| 新增 Electron 自动更新 / 多用户 RBAC / 安装向导重构 | V1 外或超本卡范围（1-5/1-7 已在前卡；RBAC 属线 23） |
| 把 1-5/1-6/1-7（V1 外）算进本卡完成度 | V1 分母冻结：V1 外一律进 V2 backlog，不得改分母 |

---

## 决策参考（S-12：7 个决策点，均走四步并记录参考系）

| # | 决策点 | 选项 | 参考系（第一性原理 / Anthropic 基线 / 开源实证 / 收敛） | 结论 |
|---|---|---|---|---|
| **D1** | GS-01 `noauth-401` 与 D590 裁决① 冲突怎么修 | A 保留断言、给 consult 加回认证／B 直接删断言／C 负向断言迁靶到受保护端点 + consult 免 JWT 正向契约断言 | ① 第一性原理：断言应描述**已生效契约**，契约变更后断言必须跟改，否则"红"不指向任何真实缺陷；② Anthropic 基线：fail-closed 必须保覆盖——删断言 = 防线消失；③ 实证：D590 明确"免 JWT"是桌面端零命令行的承诺（白名单注释 :87-101）；④ 收敛：A 违反裁决、B 弱化防线、**C 同时满足两者** | **C**：负向 auth 断言迁到 `GET /api/config/dump`（受 JWT 保护）；consult 断言改为"无 token + 缺 role → 400 且非 401"。**口径变更需 CTO 冻结确认**（派单：冻结后改口径须附变更说明） |
| **D2** | 1-1 断言形态 | A 只依赖 CI artifact／B GS-01 内断言 `release/` 产物存在 + 封印有效／C GS-01 内每次真打 20 分钟包 | ① 第一性原理：V1 判据是"GS-01 exit 0 + 产物存在"→ 产物必须被场景消费；② Anthropic：证据须可本地复跑（CI 产物不满足"24h 内可复跑"）；③ 实证：D713 证明"构建成功 ≠ 可安装"，必须校验封印；④ 收敛：A 不可本地复跑、C 破坏幂等经济性、**B 正解** | **B**：产物段 + `verify-package-signature.sh`；无产物 = 诚实红 + 修复指引（`GS01_SKIP_ARTIFACT` 只降检查动作，不放绿） |
| **D3** | 线6"问卷"入口口径 | A 复活 interview 端点／B 首启向导 + 首条诉求（concerns）→ consult／C 新建问卷 UI | ① 第一性原理：V1 要的是"没数据也能起步"，诉求路径已满足；② Anthropic：不重新引入已下线的接口（避免第二真相源）；③ 实证：src/interview/question-bank.ts  零生产调用方（grep），`useStreaming.ts` 已发 `concerns`；④ 收敛：**B** | **B**：口径写入 S1/S3；机器证据 = consult 契约 + LLM 门控全链 + 报告产物；结构化问卷（线4 4-1）不在本卡 |
| **D4** | 6-2 断言的边界 | A 断言"≤3 天"／B 机器锁"计时可判定" + prod 数字入证据 | ① 第一性原理：3 天是**客户旅程时长**，无法在场景里制造，但"计时字段存在且 verdict 可算"是工程事实；② Anthropic：断言必须机器可复跑；③ 实证：`first-diagnosis-timing.sh` 已把"目标值非硬断言"写进注释（超时如实记 OVER_TARGET）；④ 收敛：**B** | **B**：dev 计时断言无条件跑（instrumentation）；prod 实测（`GS01_TTFV=1`）出数字落证据；V1 fail_when 两条（超 3 天 / 无计时）分别由 prod 证据与 dev 断言覆盖 |
| **D5** | GS-01 证据键 | A 保留 `L1-1/L1-4`／B 改 V1 断言 ID | ① 第一性原理：机器账本按 `product-lines.yaml` 的 ID 匹配，键不对 = 证据进不了账；② Anthropic：契约（ID 空间）必须单一事实源；③ 实证：`calc-progress.py:177` 精确匹配 `acceptance_point`；④ 收敛：**B** | **B**：`evidence_map` 键一律 V1 原文（`1-1/1-3/1-4/6-1/6-2`）；非 V1 断言（双引导/升级）保留自有标签，不冒充 V1 |
| **D6** | 双机证据撞名（D715 P1-1） | A 手写带前缀 JSON／B `evidence-writer --tag` 维度化 | ① 第一性原理：文件名必须携带唯一维度（平台+任务）；② Anthropic：机器生成优于手写（防漂移）；③ 实证：D715 已证 add/add 冲突会丢另一侧判定；④ 收敛：**B** | **B**：`--tag`（缺省向后兼容）；本卡 mac 侧统一 `mac-d804` |
| **D7** | 1-2/1-3 真机证据怎么办 | A 用 Mac 结果声称双平台／B Mac 实测 + Win 挂账，禁顶替 | ① 第一性原理：证据必须来自被测环境；② Anthropic：不能让"环境缺失"变成"事实假设"；③ 实证：D712 Win 提权框阻塞 + D773 规约；④ 收敛：**B** | **B**：Mac 侧走 `mac-install-verify.sh` 实测；Win 侧 `win-install-verify.ps1` 保持 `exit 2 waiting`，挂账登记 `task-state/D804.json` + runbook |

---

## DS 清单（与本文档一一对应，禁重编号——S-10）

| DS | 内容 | 对应章节 | 验证 |
|---|---|---|---|
| DS1 | 八节齐备（S1-S8）且过 dev-doc-gatekeeper（C1-C6 全过，exit 0） | 全文 | `bash scripts/control-tower/dev-doc-gatekeeper.sh <doc>` → exit 0 |
| DS2 | 写集表可机器提取（C6） | §写集 | `python3 scripts/control-tower/devdoc_writeset.py --extract <doc>` → `status=ok` |
| DS3 | 断言表逐条覆盖 1-1/1-2/1-3/1-4/1-8 + 6-1/6-2/6-3（+6-7），每条含 verify 命令 / 场景 ID / 证据类型 / fail_when | S6 | 逐行对照 `product-lines.yaml` 与 V1 分母文档 |
| DS4 | 失败模式表 ≥7 条（实际 10 条），每条含行为 + 降级动作 + 用户可见信号（禁静默） | S4 | 10 行逐条含 F1-F10 |
| DS5 | 切片 ≥4 片（实际 6 片），每片含"改哪些文件 + 断言 + 回滚方式"且可独立验收 | S5 | 6 片逐节自检 |
| DS6 | 契约逐接口 @input/@output/@degraded/@error/@idempotent + 三态退出码 0/1/2 | S2 | 两张契约表 |
| DS7 | 幂等与可观测：重复安装/运行行为 + 日志与计数 + 证据落盘路径 | S7 | 三张表（7.1/7.2/7.3） |
| DS8 | 回滚方案：版本回退（按片）+ 特性开关（环境级，无产品旁路） | S8 | 8.1/8.2 两张表 |
| DS9 | Test Requirements 四层（L1/L2a/L2b/L2c）+ red 证据要求 | Test Requirements | 表格 + 交付贴 red/green 原文 |
| DS10 | Wiring Verification：每个新增符号/参数在生产路径有调用方（测试调用不计） | Wiring Verification | `grep -rn` 逐行命中 |
| DS11 | 现状审计 11 条声称全部带 `file:line` 或 evidence 路径（无凭记忆项） | 现状审计 C1-C11 | 逐条 grep/read |
| DS12 | 未定论项显式登记（C8/C9 打包态端口；6-3 yaml↔V1 口径冲突；Win 实机挂账） | 文末 + S6 注 | 三类项逐条写明"为什么未定论 + 谁能定 + 定论命令" |
| DS13 | 决策参考 7 点走四步并记录参考系（S-12） | 决策参考 | 表格 7 行 |
| DS14 | 提交纪律：隔离 worktree + 分支 + brief（写集机器生成）+ `synova-commit` + push + PR（PR 正文附八节清单） | 交付时 | `git log` / PR 链接 |
| DS15 | 红线自查：本卡零 src/ 下的变更、零 `scripts/audit/**` 触碰 | What We Don't Do | `git diff --name-only origin/main...HEAD` 逐行核对 |

---

## 自检清单

- [x] 权威文档核验：派单（PR #618）/ V1 分母 / product-lines.yaml / 主线计划 v1.2@4e46603f（sha256 实测前缀 `4e46603facae4361`）/ K3 D715 审计 / 铁律 / D773 代行规约，逐条引用原文
- [x] 现状不凭记忆：C1-C11 全部 `file:line` 或 evidence 路径，2026-09-17 于 `origin/main @0f59e514` 实测
- [x] 声称 = 实现 + 验收：本卡阶段 0 只写规格，无任何"已实现"声称；实现项全部标为切片/DS
- [x] 接线 = 生产调用点真实传递（Wiring Verification 表逐行给出 `grep` 目标）
- [x] verify 命令有效且映射"声称项 ↔ 用例"（S6 每条断言可逐字复跑；禁 `echo 0`）
- [x] 测试 red 覆盖失败模式（L2b 五条降级路径 + L1 缺产物判红 + 负向断言不得退化为恒真）
- [x] §S2 契约与最终实现同 commit 回填（实现卡义务：契约变更须同步本 doc 口径，S-6）
- [x] 多选项必写决策参考（7 点，S-12）+ 完成报告决策记录（实现卡义务）
- [x] 依赖非空 → 不并行派发：切片 0 为唯一前置（顺序依赖已标注）；共享资源（evidence 目录）已标注命名隔离（S-7/S-8）
- [x] 未定论项显式登记，未猜测（见下节）
- [x] 不是凭记忆 / 未用 `--no-verify`（本卡阶段 0 仅文档提交）

---

## 未能定论项（显式，禁猜——交 CTO/创始人裁决）

| # | 未定论项 | 为什么未定论（实测边界） | 谁/什么能定论 | 定论命令（实现卡执行） |
|---|---|---|---|---|
| U1 | **打包态后端是否真能自启并绑 18790** | 证据面无法区分两种情形：`D712-mac-20260913/1-3-healthz.json`（HTTP 200）既可来自包内自启后端，也可来自本机既存的 18790 服务被 `probeOnce` 判为 `reused`（`electron/config.json` 探 18790；包内无 `synova.json`、prod spawn 未设 `PORT`，见 C8/C9） | 实现卡切片 3 的 prod 复跑（须在**无既存 18790 服务**的干净环境，先 `pkill -f "SynovaAgent"` 并确认 `curl` 18790 失败） | `lsof -nP -iTCP:18790 -sTCP:LISTEN`（应为空）→ 双击 app → `curl -s http://localhost:18790/api/healthz`；同时抓 `[electron] boot mode=prod`、`[preload-check] OK`、`backend.log` 首行 `配置加载完成 port=…` |
| U2 | **6-3 的证据类型**（`product-lines.yaml` 写 `scenario:GS-01` vs V1 分母文档写 `founder-demo`） | 两处权威文档口径不一致；yaml 是 `calc-progress.py` 的消费源，V1 文档是分母唯一来源 | CTO（口径裁决）+ 创始人演示（证据本身） | 实现卡按 V1 文档产 `founder_demo` 证据；yaml 绑定修正需 CTO 确认写集归属（D795 账本派生器域） |
| U3 | **Win 实机证据（1-2 + Win 侧 1-3/1-6）** | 无 Win 机（D773 代行期），`release/` 无 `.exe`；`win-install-verify.ps1` 现为 `exit 2 waiting` | Win 机回归后由执行方补跑；期间**挂账**（≠ 完成） | `powershell -File scripts/desktop/win-install-verify.ps1`（exit 0 = 四断言全过）；证据入 `docs/synova/product-lines/evidence/D804-win-<date>/` |
| U4 | **x64 打包信任度**（K3 D715 §四：beforePack 单次调用 → x64 包内 arm64 native） | 本卡只断言 mac arm64 产物面；x64 缺陷未修前不得声称 x64 可用 | 实现卡（如采纳）或独立卡修 beforePack 按 arch 处理 | `npx electron-builder --config build-synova.cjs --mac --x64` → 检查包内 `better-sqlite3` ABI/arch（`file node_modules/better-sqlite3/build/Release/*.node`） |
| U5 | **"双击"语义**（`mac-install-verify.sh` 走"挂载 + cp"绕开 Gatekeeper 拦截） | 脚本路径证明"安装包可用（安装→启动→出窗）"，但**未**逐字证明"双击（含 Gatekeeper 首启交互）" | 创始人/GA 实机双击演示（founder-demo） | 人工双击 dmg 内 app + 记录 Gatekeeper 提示与窗口出现时间 → `--type founder_demo --points 1-3 --quote <记录路径>` |

---

## 附录 A：本卡与相邻卡的边界（防撞车，需 CTO 确认）

| 相邻卡 | 现状 | 边界判定 |
|---|---|---|
| **D747**（桌面端 1-4 重打新产物 + 证据落盘，`status=claimed`，域 mac） | 与切片 3 目标重叠（重打包 → 安装实测 → 双证据） | 本卡=**规格**（零 src 变更、写集见上表）；D747=该规格的**执行**之一。**请 CTO 裁决**：D747 作为本卡切片 3 的承接卡（推荐，避免同模块双认领），或明确两者写集互斥 |
| **D791 线3 报告体系**（PR #617） | 一页纸四槽位 + 可溯源 | 本卡 6-1 只断言"报告端点 200 + 产物非空"；报告**结构**断言归线3，不重复 |
| **D716/1-5 双引导收敛** | 1-5 属 V1 外（backlog） | 本卡不碰 1-5；GS-01 中既存 `L1-5` 断言保留为回归，不计分 |
| **D774 证据保鲜流水线** | 已入 main（`scripts/product-lines/rerun-evidence.sh`） | 本卡切片 5 的 `--tag` 服务于该流水线的双机场景；不修改其调度语义 |
