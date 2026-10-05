# GS-01 首诊旅程场景（D446 + D527 扩展）

> 场景: 问卷/诉求入口 → 首诊诊断 → 报告产物可达（≤3 天路径）
> 前置: D232/D233 Electron 一体化 ✅（已在 main: 03f0ef86/cca6f721/8df38ad4）
> 归属: scripts/golden-scenarios/ → DeepSeek Harness（进审计无豁免）

## 断言契约（9 条，机器判定）

| # | 断言 id | 类型 | 证明 | V1 绑定 |
|---|---------|------|------|:---:|
| 1 | `noauth-protected-endpoint-401` | 负向·鉴权 | 无 JWT 调受保护端点 `/api/config/dump` → 401（fail-closed） | S0-1（非 V1） |
| 2 | `consult-noauth-contract` | 正向·免 JWT 契约 | 无 JWT 调 consult 缺 `initiator.role` → 400 且**非** 401（D590 裁决①） | S0-2（非 V1） |
| 3 | `consult-entry-validated` | 正常·参数契约 | 带 JWT 缺 `teamId` → 400 VALIDATION_ERROR | S0-2（非 V1） |
| 4 | `reports-endpoint-ok` | 正常·产物 | `GET /api/sentinel/reports` → 200 | S0-2（非 V1） |
| 5 | `electron-pack-config-valid` | 静态 | 打包配置携带 backend-spawn + renderer（D504） | **1-1** |
| 6 | `electron-backend-spawn-contract` | 静态+无头 | 服务自启 `reused` 路径 + `buildCommand` 双模式（D527 对齐切片 B prod 契约） | **1-4** |
| 7 | `electron-dual-bootstrap` | 静态 | `isPackaged` 双引导收敛（D504） | L1-5（V1 外，回归） |
| 8 | `electron-userdata-dbpath` | 静态 | `SYNOVA_DB_PATH`=userData 重定向（D504） | L1-7（V1 外，回归） |
| 9 | `consult-llm-recorded` | 门控全链 | consult 六阶段状态落盘（D527，见下） | **6-1** |

### V1 绑定口径（D804 D5，2026-09-17）

`evidence_map` 的 `acceptance_point` 键**一律用 V1 验收点 ID 原文**（`1-1`/`1-4`/`6-1`…），
字面与 `docs/synova/product-lines/product-lines.yaml` 一致——`calc-progress.py:177` 按
`acceptance_point` **精确匹配**，键写旧标签（`L1-1`/`L1-6`）会导致"线1/线6 场景证据恒为零"
（D804 §现状审计 C3）。非 V1 的自有契约（鉴权 `S0-*`、桌面端 `L1-5`/`L1-7`）保留自有标签，
**不冒充 V1**；V1 外项（1-5/1-7）只作回归，不计入分母。

> `6-2`（TTFV 计时）的绑定与断言**归切片 5**，本条不做空背书占位：`evidence_map` 条目若引用
> 零条真实断言，`buildEvidence` 会**恒判 pass**（白送绿）——`tests/golden-scenarios/gss-common.test.ts`
> 有全场景契约扫描拦这一类（D804 切片 0）。

### 口径变更登记（D804 D1，创始人 2026-09-17 批准）

- **旧口径（D446）**：无 JWT 调 consult → 401。**根因**：D590 裁决① 把
  `/api/diagnosis/consult` 纳入免 JWT 白名单（`src/middleware/auth.ts:121`，单机本地信任模型），
  该断言自此成为**恒定红**——自 2026-09-16 起 GS-01 恒 exit 1，且红不指向任何真实缺陷
  （D804 §现状审计 C1/C2）。
- **新口径**：负向 auth 断言**迁靶**到真正受 JWT 保护的 `GET /api/config/dump`
  （`src/routes/config.ts:25`，未进白名单）；consult 的免 JWT 语义改由**正向契约断言**接管
  （断言 2）。**迁靶 ≠ 删断言**：fail-closed 覆盖不减弱，白名单一旦回退即红。
- **不动裁决**：本场景只把断言对齐**已生效契约**，不改 `auth.ts` 白名单，不复活
  `/api/diagnosis/interview`（D590 裁决② 已 410）。

## 诚实 RED 声明（2026-08-21；2026-08-25 D527 更新）

- **契约断言（1-7）无 LLM 依赖，恒可跑**；**consult 真实六阶段（断言 8）依赖 LLM key**，
  非确定性产物不进无条件机器断言——采用 **GS01_LLM 门控 + 状态落盘**：
  - `GS01_LLM=1 bash .../run.sh`：带 JWT 发真实 `POST /api/diagnosis/consult`（teamId=gs01-e2e），
    收集 SSE 事件流 → `consult-llm-status.txt` 须为 `CONSULT_LLM_GREEN`（phase_started 0-5 全出现
    + complete + reportId 非空 + `GET /consult/:id/report?format=markdown` 200），
    SSE 原文与计时落 `evidence/GS-01-llm-stream-<date>.txt` / `GS-01-llm-timing-<date>.json`。
  - 未设 `GS01_LLM`：状态文件写 `CONSULT_LLM_RED (LLM key 未提供 ...)`——**如实 RED，不伪造全链路绿**。
  - 断言引擎（common/assert.ts）无条件分支原语，故机器断言只锁"状态被诚实记录"（contains
    `CONSULT_LLM_`）；GREEN/RED 的值由 evidence quote 呈现，由 README 本契约 + K3 复核约束。
- 全链路六阶段完成是端到端目标，与"30 分钟从安装到可发起"计时解耦（计时见
  `scripts/desktop/first-diagnosis-timing.sh`，runbook: docs/synova/runbooks/first-diagnosis-e2e.md）。

## 运行

```bash
bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh            # 9/9 契约断言（LLM 组如实 RED）
GS01_LLM=1 bash scripts/golden-scenarios/GS-01-first-diagnosis/run.sh # LLM 环境：全链路 GREEN（SSE ≤15 分钟）
# exit 0 = 9/9 断言通过；证据写 evidence/GS-01-<date>.json（同日重跑同名覆盖，幂等）
```

## 验收（派单）

- [x] 场景脚本 + expect.json 进 git（evidence 产物本机落盘，.gitignore 约定）
- [x] 机器判定 exit 0/1
- [x] 诚实 RED 标注（契约级 + LLM 门控组，非假绿）
- [x] D527：LLM 门控真实 consult 断言组 + SSE 事件流/计时 evidence 落盘（P2-2）

## D804 切片 0 验收（2026-09-17）

- [x] 负向 auth 断言迁靶受保护端点（`/api/config/dump`），consult 改由正向契约断言接管（D1）
- [x] `evidence_map` 键改 V1 ID 原文（`1-1`/`1-4`/`6-1`），`calc-progress.py` 可绑（D5）
- [x] 契约回归测试：键空间 ⊆ V1 ∪ 非 V1 标签 / 非空背书 / 负向靶点受保护（`gss-common.test.ts`）
- [x] 实跑 `exit 0` + 证据 `evidence/GS-01-<date>.json` 落 git（1-1/1-4/6-1 有 verdict）
- [ ] 切片 1：产物存在性断言（`electron-artifact-installable`，缺产物 → `ARTIFACT_MISSING` 判 fail）
- [ ] 切片 2：`backend-healthz-live` + `backend-restart-healthz-200` 实测段
- [ ] 切片 5：`6-2` TTFV 计时断言 + 绑定
