#CRITERIA: D

# Task Brief: #202 → K12-19（原 RB-05）— 人在环审批（approval seam · 无人应答 ⇒ 拒）

> 卡面唯一真源：Gitea Issue #202 正文（CTO 亲撰）
> 架构基准：产品宪章 v8.1 §0.4（−1 运行时）／§4.1（⓪–⑤ ＋ −1）
> 分支：`work/k12-19-approval` ｜ BASE = `gitea/local-main@8cbe3fc1d`

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：**高风险动作要人点头**；**没人应答就拒绝**（不是"没人管就放行"）。

**② 解决什么问题**：任何自动化系统都有一个诱惑——**超时放行**（省事）。但那等于
「**只要没人看，什么都能干**」。院方《02》与四层结构都把这一层单列：它是权限体系的
**最后一道纵深**。

**③ 本卡实测到的具体病**（不是抽象风险 —— 是仓库里已经躺着的一段假审批）：
`src/deploy/system-self-ops.ts` 的危险操作分支（`version-rollback` / `db-repair` /
`schema-migrate`）返回 `requiresApproval: true` 与一枚 `approval-${Date.now()}-xxx` 的
"审批卡 ID"，而**全仓没有任何一处会去审批它**；`src/routes/self-ops.ts:77-80` 收到
`requiresApproval` 就回 202。⇒ 今天"需要审批"这四个字**没有执行体**：既没有人被问，
也没有拒绝，只有一枚时间戳。本卡把这一段接上真实的审批缝。

**④ 不做行不行**：**不行**。缺这一层 ⇒ 四层只剩三层，且风险最高的动作没有兜底。

**⑤ 现在有什么基础**：运行时侧 ✓ ／ 拒绝留痕先例 ✓（`auth.ts` 的 `AUTH_DEV_MODE_GRANT`
带 code 的告警风格）／ `src/runtime/approval-seam.ts` ❌ 不存在 ／
「什么算高风险动作」= **本卡的产品判断**（清单在本卡 Q3 明写，非从 DSH 借）。

**⑥ 还需要做什么**：审批缝（按名注入）＋ **无人应答 ⇒ 拒** ＋ 拒绝留痕 ＋
**策略声明缺失即报错** ＋ 测试 ＋ 探针 ＋ **生产入口接线**。

**⑦ DSH 借鉴方式**：**参考自研**（带 DSH file:line 证据）
 · ✅ **按名声明 + 宿主满足** —— `packages/compaction/compaction-basic/src/index.ts:114`
   （`static inject`）⇒ 审批缝按名注入 `ask` 端口，**不 import 具体实现**
 · ✅ **声明少而准 + 不生效就报错** —— `@deepseek-ai/dsh-invariants/lib/index.js:6-13`
   ⇒ 审批策略声明缺失 ⇒ **报错**（不许静默放行）
 · ✅ **同型实测：sandbox 与 approval 分离** ——
   `packages/interaction/permission-presets/README.md`（"bundles sandbox mode with an
   approval policy"）⇒ 权限判定（K12-09/10 的 RBAC/跨租户）与**审批**分开管
 · ⚠️ **DSH 无"企业高风险动作"语义** ⇒ 那张清单是我们的产品判断，**不从 DSH 借**

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
**产品架构 = −1 运行时（宪章 §0.4）**，四层结构的**第四层（人在环）**。
前三层：预设层（选）→ 解析层（算）→ 执行层（拦）→ **本层（兜底）**。
代码层：新增 `src/runtime/`（运行时横切；`check-architecture.sh` 的 L1→L3/L4/L5 模式表
不含 `/runtime/` ⇒ 不构成跨层违规，已实测 `PAT_L3/L4/L5` 三条正则）。

### b) 文件审计（实测 as_of `gitea/local-main@8cbe3fc1d`）
```
$ ls src/runtime/            → No such file or directory        # 本缝确不存在（卡面成立）
$ ls scripts/control-tower/probe-approval-seam.ts → No such file
$ git grep -ln "approval-seam\|approvalSeam" HEAD → 仅 3 个卡面/登记件（无代码）
$ ls scripts/control-tower/probe-ladder.ts → No such file        # K12-21 未落 main
$ grep -rn "api/self-ops" tests/ src/ --include=*.ts
    → 仅 src/routes/self-ops.ts 自身（**零测试覆盖**）
$ grep -rn "selfOpsRoutes" src/server.ts
    → 73: import ／ 482: app.use(selfOpsRoutes)                  # 生产已挂载
$ grep -n "dangerous\|requiresApproval" tests/deploy/system-self-ops.test.ts
    → 断言 executeSelfOp 对 3 个危险操作返回 requiresApproval=true（**同步签名，不得改**）
```

### c) 决策
- **审批 = 运行时侧的一个 seam**（不是业务代码里散落的 if）；**默认拒**。
- 🔴 **写集扩张 1 个文件（`src/routes/self-ops.ts`），理由与代价写在下方「写集扩张声明」。**

### 写集扩张声明（例外 · 主动披露，不隐藏）
卡面 §写集 原列 4 件。本卡**不得不**加入第 5 件 `src/routes/self-ops.ts`，三条**相互独立**
的理由（每条单独成立即足够）：

1. **门禁物理要求**：`pre-commit-check.sh` 组 4a 对**新文件的每一个 export** 做
   `grep -rn "\b<name>\b" src/ --include=*.ts | grep -v "$file" | grep -v "\.test\."`
   —— **显式排除本文件自身**。⇒ 若调用方落在 `src/runtime/approval-seam.ts` 内部，
   门禁**不认**（自引用恒不满足）⇒ 必须存在**另一个** `src/` 真调用方。
2. **创始人本轮升格硬要求 #2**（原话）：「接线类交付的 Done 必须含**生产路径有入口会触发**
   （新 export 要有真 `src/` 调用方，且该调用方在生产路径上会被执行）」。卡面 §Q3 入口一行
   写的正是「高风险动作触发点（**生产入口**）」，即本卡预期的就是这个入口。
3. **铁律 37（Dead code 入仓库即违规）**：无调用方的缝 = 死代码。

**为什么选 `src/routes/self-ops.ts`（而不是 `src/deploy/system-self-ops.ts`）**：
后者已被 `tests/deploy/system-self-ops.test.ts` 断言为**同步**接口（3 个危险操作各断言
`requiresApproval === true`）；审批天然是异步（等人类）⇒ 动它要改签名 + 连带改测试，
**打红已合判据**。选 route 则 `executeSelfOp` 一行不动，零回归。
**边界守住**：不改 `src/middleware/auth.ts`（含 K12-03 白名单与 K12-09 `CROSS_ORG_FORBIDDEN`／
`evaluateCrossOrgAccess`）、不改 `src/onboarding/**`、不改 `extensions/**`、不改 `scripts/audit/**`。

### 测试件路径拆分声明（例外 · 主动披露）
卡面 §写集 原列**一份**测试件 `tests/security/approval-seam.test.ts`。实测**该单件无法过门禁**：
`SYNO_CI=1 bash scripts/pre-commit-check.sh` 组 2b 对 `src/runtime/approval-seam.ts` 报
`缺少 tests/runtime/approval-seam.test.ts` —— 组 2b 是**严格路径镜像**（`src/<x>.ts → tests/<x>.test.ts`，
源码只 `sed 's|^src/|tests/|'` ＋ 追加 `.test.ts`，**无 basename 回退**）；而 `tests/security/`
是 `src/security/` 的镜像位、不是通用"安全类"目录。
⇒ 本卡按**关注点**拆两份（**不重复、不互为代理**）：
- `tests/runtime/approval-seam.test.ts` = **缝本体**契约（四变体 / 不变量 / 策略解析）——兼作组 2b 镜像位；
- `tests/security/approval-seam.test.ts` = **生产入口**安全语义（真 express app ＋ 真 router ＋ 真 HTTP）
  —— 卡面原定的那一份**保留**，只是判据对象收窄为 `src/routes/self-ops.ts`。
代价：新增 1 个测试文件（+ 卡面原定那份保留）。**未删卡面任何声明件**。

## Q1: 调研 — 依据 / DSH 边界 / memory 教训
- **DSH 依据**：见 §〇⑦ 表（三条带 file:line，一条明确不适用）。
- **memory 教训**：铁律 24/31（禁静默降级）⇒ 无人应答必须**显式拒 + 留痕**，不是超时放行；
  铁律 32（catch 包装 `.code`/`.phase`/`.retryable`）；铁律 47/48（契约先行 + 真断言）。
- **判例 V-01/V-02**：判定**不吃 grep**。grep 只能作 `[L1-辅证]` 且**不进 verdict**。
- **结构判据**：拆掉本层 ⇒ 高风险动作**直接拒**（不是"没人管就放行"）⇒ 更安全 ✅
  （对应本卡 V6 实验记录）。

## Q2: 范围
做什么：
- src/runtime/approval-seam.ts
- src/routes/self-ops.ts
- tests/runtime/approval-seam.test.ts
- tests/security/approval-seam.test.ts
- scripts/control-tower/probe-approval-seam.ts
- .claude/task-briefs/2026-10-11-202-approval-seam.md

不做什么（含文件路径）：
- 不改 src/middleware/auth.ts（K12-03/09/10/11/12 写集；本卡只消费其判定结果）
- 不改 src/onboarding/**（K12-03/04 写集）
- 不改 src/deploy/system-self-ops.ts（既有同步测试断言其行为）
- 不改 extensions/**（审批策略若成内容面，另卡）
- 不改 scripts/audit/**
- 不提交 scripts/control-tower/probe-ladder.ts（K12-21 写集：PR #224 在飞，见下方风险声明）

## 在飞重叠声明（主动披露）
`scripts/control-tower/probe-approval-seam.ts` **与在飞 PR #224（`fix/k12-21-probe-ladder`，
`#205 K12-21 测量梯子`）同路径**。该分支已有一份 602 行的同名片。本卡处置：
- **不取用**其 `probe-ladder.ts`（不在本卡写集，取了即 = 抄 #224 的写集）；
- 本卡探针**自带契约**、**可独立直跑**，且**契约兼容**（末行 `RESULT=` + 词元
  `PASS/FAIL/NOT_IMPLEMENTED/ERROR`，三态退出码 0/1/2 一致）；
- 实现侧显式对齐 #224 探针声明的契约面（`requestApproval` / `resolveApprovalPolicy` /
  `HIGH_RISK_ACTIONS` ＋ `{action, actor, ask, policy}` 入参 ＋ `decision`/`allowed`/`audit`
  返回形态），**并实测跑过 #224 的原始探针**（证据见交付回执 ⑦）。
⇒ 合并时两者任一存活都能测得同一结论；冲突是**同语义重复**，非语义分歧。

## Q3: 验收 — 入口 → 交互 → 结果
- **入口（生产入口，真跑）**：`POST /api/self-ops/execute`（`src/routes/self-ops.ts`，
  经 `src/server.ts:482 app.use(selfOpsRoutes)` 挂载）
- **交互/处理**：动作命中 `HIGH_RISK_ACTIONS` ⇒ 暂停 ⇒ 经宿主注入的 `ask` 端口**请人点头**
  ⇒ 有答按答 ／ **无答 ⇒ 拒**
- **结果（可观测）**：`403 + { ok:false, code:'APPROVAL_DENIED', approval:{...四要素留痕...} }`；
  非高风险动作**保持原语义不变**（`executeSelfOp` 原样返回）

**高风险动作清单（本卡的产品判断，唯一声明点 = `HIGH_RISK_ACTIONS`）**：
| 动作 | 为什么高风险 |
|---|---|
| `version-rollback` | 版本回滚 ⇒ 数据兼容性风险（`system-self-ops` 自带 warnings 已述） |
| `db-repair` | 数据库修复**不可逆**，失败即数据损坏 |
| `schema-migrate` | Schema 迁移失败 ⇒ 服务不可用 |

⇒ 清单与 `listAvailableOps()` 中 `severity==='dangerous'` 的 3 项**逐项相等**（测试断言，防两处口径漂移）。

### 判据（V1–V7 可变现为命令）
- **V1** `npx tsx scripts/control-tower/probe-approval-seam.ts --case no-answer` ⇒ **exit 0**
- **V2** **无人应答 ⇒ 拒**（**不许超时放行**）＋ 留痕四要素（谁/何时/什么动作/为什么拒）
- **V3** 有答 ⇒ 按答执行（`approved` ⇒ 放行 ／ `rejected` ⇒ 拒，两态各跑一次）
- **V4** **声明缺失即报错**：策略未声明（`resolveApprovalPolicy(undefined)`）⇒ 报错，不静默放行
- **V5** 反例（**改坏即红**）：把"无人应答"改成"默认放行" ⇒ V2 必红
- **V6** 结构判据自检：拆掉本层 ⇒ 高风险动作**直接拒**（留实验记录）
- **V7** **反例四变体**逐个实测：无应答 ／ 超时 ／ 应答缺失 ／ 应答非法 ⇒ **全部判拒**

## 架构层: −1 运行时（宪章 §0.4 产品架构）／代码层 L1（src/routes/self-ops.ts 生产入口）
## 写集
| 文件 | 类别 |
|---|---|
| src/runtime/approval-seam.ts | task（新建 · 审批缝本体） |
| src/routes/self-ops.ts | task（接线 · 生产入口 —— 扩张声明见 Q0c） |
| tests/runtime/approval-seam.test.ts | task（新建 · 缝本体配对测试 ＋ 组 2b 镜像位） |
| tests/security/approval-seam.test.ts | task（新建 · 生产入口安全判据） |
| scripts/control-tower/probe-approval-seam.ts | task（新建 · 判据测量件） |
| .claude/task-briefs/2026-10-11-202-approval-seam.md | task（本件） |

## Done 标准
- [ ] verify: `npx tsx scripts/control-tower/probe-approval-seam.ts --case no-answer`（expectExit 0；登记件 RB-05）
- [ ] verify: `npx tsx scripts/control-tower/probe-approval-seam.ts --all`（全场景 + 反例四变体）
- [ ] verify: `npx vitest run tests/security/approval-seam.test.ts`
- [ ] verify: `npx tsc --noEmit`
- [ ] 反例（改坏必红）：无人应答改成默认放行 ⇒ 探针与测试**双双判红**，留原始输出
- [ ] **接线实测**：真 express app 挂真 router ⇒ 高风险动作 **403 拒**（非 202/200）
- [ ] 结构判据自检：拆掉本层 ⇒ 高风险动作直接拒（留一次实验记录）
