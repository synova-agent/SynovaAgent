# Task Brief: D804 dev doc — M1「能装能用」线1 桌面端 + 线6 首诊端到端（DSH 八节规格）

> 生成: 2026-09-17 | 任务: D804 | 认领: synova-devdoc（DSH dev doc 会话）| 域: win（D773 代行：Mac 侧执行，域声明不变）
> 依据: `docs/synova/coordination/派单-D804-D803-DSH标准-20260917.md` §一（模板）+ §二（本卡，PR #618）
> 分母: `docs/synova/project/26线-V1验收标准-草案v0.1-20260917.md`（线1 5 条 / 线6 4 条）
> 计划: `docs/synova/coordination/整体推进计划-主线-20260913.md` v1.2@4e46603f（实测 sha256 前缀 4e46603facae4361）
> 参考: D333 决策四步（第一性原理→Anthropic 工程基线→开源实证→收敛检查）

#CRITERIA: D

## 主线贡献
line-1/1-1、line-1/1-4（能被装起来用 = 主线支柱①）+ line-6/6-1、6-2、6-3（首诊端到端）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属 **L1 交互层（桌面端）** 与 **L2/L3 编排-洞察链路（首诊 consult）** 的**验收证据面**，不改产品逻辑：
- 纵向：跨 L1（Electron 打包/自启/开窗）与 L2-L3（consult 六阶段 → 报告）——本卡只写规格，不写实现。
- 横向：不建包、不迁包。
- 扩展：不新增文件驱动模块。
- 三系统归属：GA 按需诊断（首诊六阶段）+ 基础设施（打包/安装/证据链）。

本卡 = A 类任务的**阶段 0（dev doc）**，产出唯一：`docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D804-line1-6-onboarding-20260917.md`。按派单 §四「规格冻结门」，**本阶段零 `src/**` 变更**（写集 = 本 doc + 本 brief + task-state/D804.json）。

### b) 文件审计（2026-09-17 实测，全部 file:line 可核）
| 关键词 | 实测结果 | 关系 |
|---|---|---|
| GS-01 场景 | `scripts/golden-scenarios/GS-01-first-diagnosis/run.sh`（8 断言）+ `expect.json`（evidence_map 键 = S0-1/S0-2/L1-1/L1-4/L1-5/L1-6/L1-7） | **扩展**（新增 5 断言 + 键改 V1 ID） |
| 产物/安装 | `build-synova.cjs`、`.github/workflows/desktop-build.yml`、`scripts/desktop/verify-package-signature.sh`（exit 0/1/2）、`release/`（0.1.0 arm64 dmg/zip 在档） | **复用**（断言化，不重建） |
| 服务自启 | `electron/main.cjs:119`（`[preload-check]` 哨兵；:252 ensureBackend 调用）、`electron/backend-spawn.cjs:148`（ensureBackend：probe→spawn→degraded）、`electron/config.json`（serverUrl 18790） | **复用 + 补强**（probe 结构校验） |
| 健康检查 | `src/routes/healthz.ts:323`（GET /api/healthz，200=healthy\|degraded）、`src/routes/health.ts:16`（/health） | **复用** |
| 首诊链路 | `src/routes/diagnosis.ts:189`（POST /api/diagnosis/consult 免 JWT）、`:620`（500 兜底）、`src/agent/diagnosis-launcher.ts:179`（concerns 消费） | **复用**（口径校准） |
| 问卷 | `src/interview/question-bank.ts`（**零生产调用方**，仅 `tests/interview/question-bank.test.ts`）；`/api/diagnosis/interview` 已 410（`src/server.ts:93` D590 裁决②） | **口径澄清**（不复活旧端点） |
| TTFV 计时 | `scripts/desktop/first-diagnosis-timing.sh`（--mode dev\|prod，exit 0/1/2，5 里程碑） | **复用 + 接线**到 GS-01（6-2） |
| 证据入库 | `scripts/product-lines/evidence-writer.py`（schema=1，4 类型，founder_demo 必须 --quote）、`scripts/golden-scenarios/common/assert.ts`（http/sqlite/file/process 四型）、`scripts/product-lines/calc-progress.py:67`（TTL 14 天）+ A1 modules 变更失效 | **扩展**（--tag 防双机撞名，D715 P1-1） |
| 真机脚本 | `scripts/desktop/mac-install-verify.sh`（四断言 A1-A4）、`scripts/desktop/win-install-verify.ps1`（A/B/C/D，缺 exe → exit 2 waiting）、`scripts/desktop/upgrade-data-verify.sh` | **复用**（Mac 实测；Win 挂账 D773） |

### c) 决策
- 已有覆盖 → 复用（GS-01 / 桌面 4 脚本 / assert.ts / evidence-writer / calc-progress）。
- 无覆盖 → 扩展既有脚本与断言（**不新建平行体系**）。
- 冲突 → **已识别 1 处契约冲突**：GS-01 `noauth-401` 与 D590 裁决①（consult 免 JWT 白名单）矛盾 → 本 doc 走决策参考（§决策参考 D1）改口径，交 CTO 冻结。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

### a) 业界最佳实践（同类问题怎么做）
1. **Electron 官方**：沙箱化 preload 不得 `require` 相对文件 → 配置经 `webPreferences.additionalArguments` 透传（`electron/main.cjs:82-89` 已采纳）；单实例用 `app.requestSingleInstanceLock()`（已采纳 `electron/main.cjs:156`）。
2. **安装器可用性判据**：不在 CI 里"能构建"就宣称"能用"——macOS 必须校验 `_CodeSignature` 封印（D713 事故：产物存在但打开报"已损坏"）；Windows 提权框只能真机验（D712 实证）。
3. **验收断言化**：Google SRE/CI 实践——每个验收点必须绑定**可复跑命令 + 退出码 + 原始输出落盘**（GSS：exit 0/1，三态语义，"查询失败 ≠ 真空 ≠ 通过"）。
4. **TTFV 度量**：价值实现时间（time-to-first-value）必须**分段计时**（install / launch / healthz / first-diagnosis-ready），目标值（≤3 天）与仪表（计时字段）分离——目标达成是业务结论，仪表可用是工程断言。

### b) memory/ 历史教训（同类错误）
| 教训 | 出处 | 对本卡约束 |
|---|---|---|
| **证据不在 git = 温床**：D714 声称 `[preload-check] OK` 仅存 note 自述，K3 D715 P1-4 判 1-4 不可转绿 | `docs/synova/audit-reports/2026-09-13-D715.md` §五 | 1-4 转绿**必须**是 git 内原始日志 + 渲染层 API 实测请求两件套 |
| **双机证据同名 add/add 撞车**：evidence-writer 文件名无平台/任务维度 | D715 P1-1（同文件） | 切片 5：`--tag` 维度化 |
| **同日矛盾证据由文件名字典序定胜负**：calc machine 段无 fail 优先/tiebreaker | D715 P1-3 | 本卡证据**同日单源**，不由字典序决胜 |
| **状态机诚实规则**：无证据 = 未验证；yaml 标 verified 无证据 → 降级 | `scripts/product-lines/calc-progress.py` §诚实规则 | 禁止"写完就完"，一切以证据落盘为准 |
| **契约门禁 fail-open 教训**（检查没跑 ≠ 通过） | 铁律 24/31 + D381 | 断言缺产物 → 诚实红，不 skip |

### c) 决策参考系
见本 doc §决策参考（7 个决策点，均走四步并记录参考系）。

### d) 相关 Note
本卡为规格类，无新治理机制 → 不新建 Note；规格结论随 doc 冻结（如需沉淀，实现卡在 `memory/notes/proposed/` 补一条）。

## Q2: 范围 — 正确的最简方案
**做什么**（本阶段）：
- 唯一产出 `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D804-line1-6-onboarding-20260917.md`（八节 S1-S8 + 写集表 + 断言表 + 决策参考 + DS 清单）
- task-state/D804.json：spec 段 + status=spec_done

**不做什么**（排除项，含文件路径）：
- 不改 `scripts/audit/`（K3 红线）、不写审计标准、不做任何 K3 判定
- 不改 `src/**`（派单 §四 规格冻结门：spec 未冻结不得动 src）——特别是不改 `src/middleware/auth.ts` 的白名单口径（D590 裁决①，属创始人裁决面）
- 不改 `src/routes/diagnosis.ts`、`src/routes/healthz.ts`、`src/agent/diagnosis-launcher.ts`（本卡只用其既有契约）
- 不改 `scripts/product-lines/calc-progress.py`（判分器，派单红线）
- 不改 `.github/workflows/ci.yml`（控制塔域）
- 不复活 `/api/diagnosis/interview`（D590 裁决② 已 410）
- 不写实现代码、不生成 evidence JSON（证据由实现卡产出）

## Q3: 验收 — 入口 → 交互 → 结果
- **入口**：本 doc（dev doc 链接）+ `bash scripts/control-tower/dev-doc-gatekeeper.sh <doc>`（exit 0）
- **处理**：八节齐备（S1-S8 逐节自检表）→ CTO 逐节复核冻结
- **结果**：doc 入 main（PR）；实现卡可照 doc 直接开工（写集表机器可提取、断言绑 verify 命令）

## 架构层: 基础设施
L1（Electron 桌面端）+ L2/L3 编排链路（仅验收面）；写集落 `scripts/golden-scenarios`、`scripts/desktop`、`scripts/product-lines`、`tests/**`、`electron/**`（≤12 文件预算）

## Done 标准
- [ ] 入口可触达: `bash scripts/control-tower/dev-doc-gatekeeper.sh docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D804-line1-6-onboarding-20260917.md` → exit 0
- [ ] 链路走通: 八节 S1-S8 全写 + 写集表可被 `devdoc_writeset.py --extract` 提取（C6）
- [ ] 结果可见: PR 正文附八节清单（逐节"已写/不适用+理由"）+ 八节自检表 + 未能定论项
- [ ] verify: `python3 scripts/control-tower/devdoc_writeset.py --extract <doc>` → status=ok 且 entries ≥1
- [ ] verify: `bash scripts/workflow/check-dev-doc-write-set.sh <doc>`（写集对账，证据在 PR 正文）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-17-D804-line1-6-onboarding-spec.md | task |
| docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D804-line1-6-onboarding-20260917.md | task |
| docs/synova/coordination/编码指令-D804-line1-6-onboarding-20260917.md | task |
| task-state/D804.json | task |

