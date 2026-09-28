# D1053 · 线25 live/restart 设置分类 —— 活规格（spec 阶段交付 · 可直接施工）

> 任务号 **D1053** ｜ worktree `.synova-wt-squad-d1053` ｜ 分支 `feat/d1053-live-restart-settings` ｜ base `origin/main` @ `20b55eba`
> 记分对象：**25-8 / 25-9**（`docs/synova/product-lines/product-lines.yaml:1166-1175`）｜ 判据来源：K3 批次1 报告 FIX-C（commit `643069b9`）
> 前置证据：`docs/synova/product-lines/evidence/D1053/00-premise-freeze.json`（P1-P25 逐条实测）｜ `docs/synova/product-lines/evidence/D1053/10-conflict-scan.txt`（写集冲突扫描）
> 状态：**活规格 —— 未写一行产品代码。** 实现阶段照本文件施工；本文件不自判结论，判定权在成员 V 自验 → 队长自验结论 → CTO 收件闸 → K3 终审。

---

## 〇、本活规格的地位与用法

1. **唯一施工源**：实现阶段（成员 C）只照本文件写码；凡本文件未写的行为，一律视为**超范围**，先回报再动。
2. **前提不重查**：`00-premise-freeze.json` 的 P1-P25 已逐条实测（含 9 条派单件前提不成立/偏差）。本文件只做**重锚**，不重复实测。
3. **CTO 三项裁决已并入**（§三），施工方**不再就裁决提问**。
4. **队长两项新增已并入**：设置源 env 契约（§4.5）、判别性归属（§8.1）。
5. **本文件由成员 S（规格）撰写，成员 S 不参与实现**——规格与实现分离（独立规格硬要求）。
6. 施工顺序：`S1` 契约与类型 → `S2` 声明常量（§5.1 逐字落成代码）→ `S3` 源读取 → `S4` boot/冻结 → `S5` 两个消费者接线 → `S6` 三套件 → `S7` 夹具。
7. **写作纪律**：本文件所有数字来自命令原始输出（口径随行标注）；不含"我认为"。凡引用 DSH 的行号一律标注 as-of 版本 + 现验命令，**M3 锚点注释内禁写死行号**（§3.1）。

---

## 一、北星锚定与完成标准

### 1.1 产品线验收点（逐字引文，`product-lines.yaml:1166-1175`）

| 点 | desc（逐字） | evidence（逐字） |
|---|---|---|
| **25-8** | live 类设置改完不重启即生效：展示类/阈值类/文案类按 live 分类声明，改值后下一次读取即返回新值，且**全部在跑的消费者观察到同一新值（无部分消费者滞留旧值）** | `test:settings-applies-live`、`founder-demo:改配置免重启演示` |
| **25-9** | restart 类设置改完**在重启前不得半生效**：连接类/插件类/数据源类/鉴权类按 restart 分类声明，重启前旧连接以旧值继续且行为可预期，重启后新值生效 | `test:settings-applies-restart` |

**同批约束（yaml note 明写）**：25-8 与 25-9 共用同一 applies 分类机制，**必须同 PR 同批声明**。
**硬约束（实测校准）**：evidence 串逐字为 `settings-applies-live` / `settings-applies-restart` ⇒ 测试文件名必须**字面**含该串（A2 定位器按"内容 grep → 文件名 find"两步定位 `tests/`；机制见 §九 F1）。

### 1.2 北星锚定（产品意图，非技术指标）

- `.claude/PRODUCT-BRIEF.md:41`（逐字）：**"文件优先：专家知识在 `.md` 文件里，改文件就改行为，不需要改代码。`POST /api/reload` 5 秒生效。"**
- 本卡是该承诺的**边界补齐**：既有"改文件即改行为"只保证了"能生效"，**没有声明"哪些键允许即时生效、哪些必须等重启"**。live/restart 分类 = 把"生效边界"变成**声明式、可观测、可 dump** 的一等公民。
- 25-9 的反面（要防的状态）：**半生效**——部分消费者已用新值、部分仍用旧值。这是分布式不一致在单进程配置面的最小形态 ⇒ 必须用**生效边界**定义，而不是靠"读取时机"碰运气。

### 1.3 完成标准（业务一句话，与派单件一致）

> 改阈值/文案/展示 → **立即生效无需重启**；换数据源/连接/鉴权/插件 → **重启前完全无感（旧值持续工作）**；且启动日志能列出「未声明分类」的设置项（默认安全可观测）。

---

## 二、前提重锚与施工边界

### 2.0 前提重锚摘要（完整实测见 `00-premise-freeze.json`）

| 类 | 条目 | 派单件/PLAN 原文 | 实测（施工口径） |
|---|---|---|---|
| A 锚点过时 | P5 | 客户配置包 `mountPreset`，接线 `src/config.ts:34` | `mountPreset` 全仓 0 命中；真实符号 `discoverCustomerConfigPackages`/`resolveCustomerConfig`（`src/config/customer-config-package.ts`）；`src/config.ts:34` 是 sentinel 阈值字段 ⇒ 按真实锚点施工 |
| A | P6 | `src/agent/../diagnosis.ts:226` | 真实路径 `src/routes/diagnosis.ts:226`（行号对、路径错） |
| A | P7 | 判据 K3 报告在 main 可读 | 该路径**不在 main**；以 commit `643069b9` 回源（原文 316 行已核读） |
| A | P10 | `dsh-settings-file` 的 `resolveSpec`/分层 resolve 可借 | 该包在锁定快照**不存在**；`patchNode` 全仓 0 命中 ⇒ 可借面收敛到本仓 D599 落点 |
| B DSH 锚点断裂 | P8/P9 | `SettingsApplies = live\|restart`（v0.1.6 行号）；`applies: options?.applies ?? "live"` | `SettingsApplies` 全仓 0 命中；现快照（0.1.7-rc.1 @ `46a7f68b`）`applies` **硬编码 `"live"`**；无 `?? "live"` 形态 ⇒ **禁止写成"接入 DSH 的 live\|restart 分类"**（§3.1） |
| C 口径混用 | P15 | 「线25 5/10 → 8/10；全项目 11 → 14」 | 那是 K3 verdict 口径。`product-progress.json` 权威口径：线25 verified **0/9**、全项目 verified **0**、`pending_k3` 51；main 的线25 只有 **9 点** ⇒ 分母不是 10 |
| D 协同误判 | P17 | GS-08 记分通道不可用 ⇒ 自备 fixture | 成立但**不阻塞**：25-8/25-9 权威证据通道是 `test:`（非 `scenario:GS-08`） |
| D | P20 | 线3 切片「不构成冲突（不同模块面）」 | **部分不成立**：D1051 写集含 `src/routes/diagnosis.ts`、`src/routes/conversations.ts` ⇒ 本卡**不碰这两文件**（§2.3） |

**废卡触发：否。** 6 条锚点过时 + 1 条口径混用 + 2 条协同误判，均未击穿可行性（判据原文已核读、底层能力面存在）。

### 2.1 写集（本次 spec 提交：1 修改）

| 文件 | 操作 | 说明 |
|---|---|---|
| docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md | 修改 | 本活规格（PLAN → 活规格升级：7 项 + 队长 2 项 + CTO 3 裁决落地） |

> 口径：本表 = **本次 spec 提交实际落盘的文件集**（`scripts/workflow/check-dev-doc-write-set.sh` 逐条核「存在 + ∈ 本次 diff」）。
> **本门的触发条件（实测 `scripts/pre-commit-check.sh:1412`）**：`if echo "$STAGED_ALL" | grep -qE 'docs/plans/codex/implementation/SYNOVA-IMPL-.*\.md'` —— **仅当本次提交暂存了 dev doc 时才跑**；未暂存 ⇒ 本门直接跳过。
> ⇒ 规则精确表述（更正 PLAN 旧措辞"不回填 = CI 写集漂移硬红"，该措辞**漏了触发条件**）：**暂存 dev doc ⇒ §2.1 表必须 = 本次提交文件集**；**不暂存 dev doc ⇒ 本门跳过，§2.1 无需回填**。
> **实现提交定案：不暂存本 dev doc** ⇒ 届时本门跳过，§2.1 保持 = 本次 spec 提交的文件集（1 条）。
> 实现阶段的写集见 §2.2；实现提交的写集口径以 §2.2 + 该次 brief `## 写集` 为准。

### 2.2 实现阶段文件清单（8 个产品文件 + 治理产物）

**域：`win`（实测 PASS，见下）｜ PR 预算：8 个产品文件 + 治理产物（D860 口径不计入 12）**

| # | 文件 | 动作 | 写者 | 说明 |
|---|---|---|---|---|
| 1 | `src/config/settings-applies.ts` | 新建 | C1 | 分类内核：`SettingsApplies`；声明常量（§5.1）+ `declareSettings()`；未声明⇒强制 restart + 清单；live 现读 / restart boot 冻结；逐键 dump |
| 2 | `src/config/settings-source.ts` | 新建 | C1 | 两层文件源（workspace/home）读取 + 类型校验；叠加**复用** `config-layers.mergeLayers/resolveLayers`，**不重写第二套**（§4.5） |
| 3 | `src/routes/settings.ts` | 新建 | C1 | **真实入口** `GET /api/settings/effective`：每请求经同一 runtime accessor 取值（§七） |
| 4 | `src/routes/config.ts` | 修改（+≤15 行） | C1 | **第二消费者**：`/api/config/dump` 顶层增列 `settings:{keys,undeclared,degraded,scope}` 块（§7.2）—— 「两消费者同一新值」的物理证明面 |
| 5 | `src/server.ts` | 修改（**仅 3 行**） | C1 | 1 import + 1 `initSettingsBootFence()` 显式初始化 + 1 mount；热点文件（15 个未合并分支触及）⇒ **只允许这 3 行**（R4 由 2 行放宽） |
| 6 | `tests/config/settings-applies.test.ts` | 新建 | C1 | **LIVE 套件**；文件**内容**含串 `settings-applies-live`（不含 restart 串） |
| 7 | `tests/config/settings-source.test.ts` | 新建 | C1 | **RESTART 套件**；文件**内容**含串 `settings-applies-restart`（不含 live 串） |
| 8 | `tests/routes/settings.test.ts` | 新建 | C1 | **入口/E2E 套件**（路径 A+B+C 的 HTTP 端到端，真实路由、不 mock 管线，铁律 12）；承载"两消费者同一新值"断言（§8.1）；**内容不含**两串 |
| 9 | `docs/synova/product-lines/evidence/D1053/**` | 新建 | 队长/V | 四件套证据（域中性，D860 治理产物） |
| 10 | `.claude/task-briefs/2026-09-28-D1053-*.md`｜`task-state/D1053.json`｜`memory/notes/proposed/2026-09-28-D1053-*.md`｜`.claude/bypass.log` | 新建/修改 | 队长/hook | 认领链 + 四态 Note + 绕过账本（治理产物，D860 不计入预算） |

**三套件命名的强制依据（R1，逐条实测）**

1. **组 2 配对硬规则**（`scripts/pre-commit-check.sh:562-583` 实测）：新建 `src/x.ts` 必须同 commit 暂存**或磁盘存在** `tests/<镜像路径>.test.ts`（`src/ → tests/` 前缀替换 + 追加 `.test.ts`）。自算映射（= 本卡三套件定名）：

```
src/config/settings-applies.ts → tests/config/settings-applies.test.ts   （LIVE 套件）
src/config/settings-source.ts  → tests/config/settings-source.test.ts    （RESTART 套件）
src/routes/settings.ts         → tests/routes/settings.test.ts           （入口/E2E 套件）
```

   ⇒ PLAN 的三个旧套件名（**`settings-applies-live.test.ts`** / **`settings-applies-restart.test.ts`** / **`settings-applies-e2e.test.ts`**）会让三条配对全部判缺失（对应镜像文件不存在）⇒ 组 2 硬红。**本规格全文只保留本行这一处旧名对照，其余一律用上表新名**（V 自查口径：三旧名各命中 1 行）。
2. **A2 串一字面绑定**（`scripts/product-lines/run-machine-evidence.sh:77` 内容定位 `grep -l "$s" … \| head -1`）：串 `settings-applies-live` 与串 `settings-applies-restart` 各自**只能出现在一个**测试文件内，**互不共现**——否则 `head -1` 会把两个套件都绑到同一个文件。
3. **命名偏差登记（铁律 33，R6 要求给明确落点；非遗漏）**：
   - **偏差事实**：`tests/routes/settings.test.ts` 承载 **E2E 语义**（路径 A+B+C 真实 HTTP），按铁律 33 本应命名为 `*.e2e.test.ts`；实际用模块名命名。
   - **成因**：组 2 配对门（上第 1 条）要求镜像文件名 ⇒ 与铁律 33 的语义后缀约定冲突，此为**门禁约束优先**的偏差。
   - **先例**：D600 同型——`tests/routes/config.test.ts` 实测存在（路由模块名 = 测试名，其头部 `:1-6` 自述格式）。
   - **登记字段位（C 须原样落两处）**：① 文件头注释自述（照 D600 `tests/routes/config.test.ts:5-6` 格式写"本套件承载 E2E 语义，命名受组 2 配对门约束"）；② 回执 + PR 正文的「偏差登记」段（同一句）。
   - **判据不弱化**：E2E 的真实性不靠文件名后缀保证，靠 §8.1 的装配约束（真实 `createServer()` + 真实 `fetch` + `listen(0)`）。

**域归属实测（本规格新增，并修正 P18 的候选名不一致）**：

```
$ python3 scripts/control-tower/check-ownership.py src/config/settings-applies.ts src/config/settings-source.ts \
    src/routes/settings.ts src/routes/config.ts src/server.ts \
    tests/config/settings-applies.test.ts tests/config/settings-source.test.ts tests/routes/settings.test.ts
win  src/config/settings-applies.ts
win  src/config/settings-source.ts
win  src/routes/settings.ts
win  src/routes/config.ts
win  src/server.ts
win  tests/config/settings-applies.test.ts
win  tests/config/settings-source.test.ts
win  tests/routes/settings.test.ts

✅ PASS 8 个文件同域: win（无归属 0，域判定豁免 0）
```

> ⚠️ **勘误（须记入回执）**：P18 冻结时的候选清单里写的是 `src/config/settings-runtime.ts`（7 文件 / 域判定豁免 5），与 §2.2 及各工件的 `src/config/settings-source.ts` **文件名不一致**。本节按 §2.2 的真实 8 文件清单**重新实测**，结论同为 `win` 单域；文件名以 §2.2 为准。

**计数核对**：产品文件 8（1-8）+ 治理 1 目录 + 4 流程件；按 D860 口径计入预算的 = **8 ≤ 12** ✅

### 2.3 互斥与硬边界（含不碰清单）

**只读复用（不修改）**：`src/config/config-layers.ts`（`mergeLayers:75`/`resolveLayers:164`/`dumpLayers:186`/`configNamespace:112`/`deepEqualJson:93`）、`src/config/customer-config-package.ts`、`src/config.ts`、`docs/synova/product-lines/product-lines.yaml`（创始人领地）。

**明令不碰（逐条精确路径 + 实测理由）**：

| 不碰 | 实测理由（口径） |
|---|---|
| `scripts/audit/**`、`docs/synova/audit-reports/**` | K3 域（红线） |
| `docs/synova/product-lines/product-lines.yaml` | 创始人领地；note 重锚走 CTO（§3.1 裁决①） |
| `src/routes/diagnosis.ts`、`src/routes/conversations.ts` | D1051 在飞写集交集（`git diff --name-only origin/main...origin/feat/d1051-line3-report-depth` 实测含此二文件） |
| `src/sentinel/baseline-store.ts` | 3 个未合并分支触及（D967b/D968a/D968b，tip 2026-09-26） |
| `src/config/config-layers.ts`、`src/config/customer-config-package.ts` | 只读复用面清晰，改它 = 扩大爆炸半径（引用面 19+13+22+13 处，见 `10-conflict-scan.txt`） |
| `src/config.ts` | 本卡以新模块 + 新入口自洽闭环；接管 `loadConfig()` 语义 = 既存例外，未裁前不动（§3.2） |
| `scripts/pre-commit-check.sh`、`scripts/check-architecture.sh`、`.github/workflows/ci.yml` | 门禁脚本（一类一机制；改门禁属控制塔域） |
| `package.json` / `package-lock.json` | 不引 `@deepseek-ai/*`；亦不为 `js-yaml` 提依赖（§十一 前置） |
| `src/locale/**`、`src/routes/reload.ts` | 既存 live 通道（locale 缓存与 `/api/reload`）；本卡**引用其锚点，不改其实现**（§3.2 例外 2） |

### 2.4 只读复用面（实测引用面，来自 `10-conflict-scan.txt`）

| 符号 | 引用面（实算） | 本卡用法 |
|---|---|---|
| `mergeLayers` | 共 **19** 处 | 叠加 home/workspace 两层（**只调用，不修改**） |
| `dumpLayers` | 共 **13** 处 | 顶层键 provenance（本卡 `sourceLayer` 的第二重校验） |
| `resolveLayers` | 共 **22** 处 | 两层叠加的**唯一实现**（禁重写） |
| `configNamespace` | 共 **13** 处 | ns 品牌化校验复用同类正则语义 |
| `deepEqualJson` | — | **"两消费者同值"断言的比较器**（§8.1 C1） |
| `loadConfig` 消费面 | 共 **53** 处 | **高风险点**：本卡不改 `loadConfig()` 返回值语义（§十二 R2） |

引用面合计（①复用符号）= **80 处**（19+13+22+13+2，实算自 `10-conflict-scan.txt` 各段「共 N 处」）。

---

## 三、CTO 三项裁决的落地（照做，勿再提问）

### 3.1 裁决① yaml note 重锚 = **以现验锚点执行**（不动 yaml）

**执行口径（逐字约束，实现期注释与 PR 正文都必须遵守）**：

- 现验锚点 = **DSH 0.1.7-rc.1 @ `46a7f68b`**，命令：`git -C /Users/wane/src/deepseek-harness-017 grep -n 'applies' packages/settings/settings/lib/index.js` → 实测 `applies` 被**硬编码 `"live"`**（无注册期声明、无 `restart` 取值）；类型面仅字面量 `applies: 'live'`。
- **口径 = 借范式自研 + 以 DSH 恒 `live` 为反例边界**。
- **禁止表述**："接入 DSH 的 live|restart 分类"、"接入 `@deepseek-ai/dsh-settings`"（该能力在锁定快照不存在，且红线禁引 `@deepseek-ai/*`）。
- **M3 锚点注释给现验命令，禁写死行号**。实现期注释草案（逐字可用）：

```ts
// D1053 M3 锚点（现验，勿写死行号）—— as-of DSH 0.1.7-rc.1 @ 46a7f68b
//   复验: git -C /Users/wane/src/deepseek-harness-017 grep -n 'applies' packages/settings/settings/lib/index.js
//   实测: applies 恒为 "live"（无 restart 取值）⇒ 本实现不引 @deepseek-ai/*，只借"声明式分层 + 来源可 dump"范式，
//          并以"恒 live 默认"作为反例边界：Synova 必须能表达 restart，否则 25-9 的半生效无从防起。
```

- yaml note 的重锚**不在本卡写集**（创始人领地）；PR 正文 + 证据里登记"note 待重锚"，不阻塞本卡。

### 3.2 裁决② 既存例外（LLM 凭证热重载）——三条硬要求逐条落地

**例外事实（实测锚点）**：`src/config.ts:76` 注释"每请求 `loadConfig()` 均重读凭证文件 → 保存后下一请求即用新 key（热重载, spec §6 决策 3）"；`tests/routes/llm-config.test.ts:165` "热重载同进程断言（DS3 自动化代理）: POST 新 key → 同一进程 `loadConfig()` 立即读到新值"。**该路径已在测、已验，属既存 live 行为**，与本卡"鉴权类 = restart"的决定④正面冲突 ⇒ 登记为**既存例外**。

| 硬要求 | 落点（字段 / 日志 / 待办） |
|---|---|
| ⓐ 分类清单显式"例外节" | `src/config/settings-applies.ts` 的声明常量内，`llm.apiKey` 条目标 `applies: 'restart'` **且** `exception: { id: 'llm-credential-hot-reload', reason, anchors: ['src/config.ts:76','tests/routes/llm-config.test.ts:165'], since: 'D575' }`；`SettingsEffectiveRow.exceptionId` 透出到两个 HTTP 面 |
| ⓑ 启动清单必须打印该例外（可观测，不得静默） | boot 时 `log.warn` 一次例外节（逐条含 `exceptionId` + `applies` + 生效路径），并与未声明清单**分两行**打印；`/api/settings/effective` 响应含 `exceptions[]`（§7.4） |
| ⓒ 收敛路径入待办 | 待办（不阻塞本卡）："`llm.apiKey` 待评估迁移 restart 或明确豁免——现状 = 声明 `restart` 但实现经既有凭证热重载即时生效；二者须收敛为单一语义"；写进 §10 待办 + 四态 Note |

**例外清单（实测登记，全 2 条）**：

| # | 例外 | 冲突点 | 本卡处置 |
|---|---|---|---|
| E1 | LLM 凭证热重载（`src/config.ts:76` + `tests/routes/llm-config.test.ts:165`） | 决定④"鉴权类 = restart" vs 既有已验热重载 | 登记为本表例外；**不动既有路径**；ⓐⓑⓒ 三落点 |
| E2 | 文件驱动面（locale/专家/扩展）经 `POST /api/reload`（`src/routes/reload.ts:21`）即时生效 | 决定④"插件类 = restart" vs 既有 reload 通道 | 声明面区分：`settings.yaml` 内的**插件类键**（如 `extensions.*.enabled`）= restart；**扩展内容文件本身**（`extensions/**/manifest.json`、locale JSON）仍走既有 reload 通道，不纳入 `settings.yaml` 语义（不制造第二套生效机制） |

> ⚠️ **实测登记（不得当作已修）**：`src/init/file-driven-loaders.ts:27` 为 `void reloadLocale; // 备用热加载 — 接线` —— 该引用**不构成执行**（`void` 表达式，无调用）。即"locale 热加载"目前**只是被引用，未被执行**；不得在任何证据里把它当作"live 已生效"的证明。本卡不改该文件（§2.3），只登记。

### 3.3 裁决③ default-safe 适用边界（批准；未声明枚举面按 R8 收窄）

- 只对**新声明面**（`settings.yaml` + 代码声明表）默认安全：**未声明 ⇒ 强制 `restart`**（绝不按 live）。
- **未声明枚举面（R8，收窄并显式声明边界）**：`undeclared[]` = **`settings.yaml` 内出现但声明表未声明的键**（两层文件全量）。**既有 env 键不在本卡枚举范围**——理由：本卡写集**不碰 `src/config.ts`**（§2.3），把 53 处 `loadConfig()` 消费面的 env 键拉进枚举面 = 越界且会改变既有语义。
  ⇒ 因此**启动日志必须显式声明这个边界**（一句 `log.warn`，逐字见 §六），**不许"看起来是全量其实不是"**。
  > 本条是对 CTO 裁决③ 原文"启动时把全部未声明项（**含既有 env 键**）打印为清单"的**范围收窄**；收窄理由如上，落地形式 = 边界声明日志（可观测），不牺牲"不静默"的要求。
- **既有 env 键语义不变**：`loadConfig()` 及其 53 处消费面不动；`SYNOVA_*`/`LLM_*`/`PORT` 等 env 的优先级与含义均不改变（§十二 R2）。
- 未声明项**仅登记、不接管**：出现在 `undeclared[]` + 启动 `log.warn`，不进 `keys[]` 的 live 面。

### 3.4 R5 · 声明载体（唯一真相源，逐字定死）

- **分类声明的唯一真相源 = 代码内 registry**（`src/config/settings-applies.ts` 的 `BUILTIN_SETTINGS_DECLARATIONS` + `declareSettings()` 登记项）。
- **`settings.yaml` 只提供值**（键路径 → 值），**不承载 `applies`**。
- **yaml 中出现 `applies` 字段 ⇒ fail-closed 拒绝加载**：`degraded:true` + `code:'SETTINGS_SPEC_INVALID'` + `reason` **显式指向 registry**（"`applies` 只能在代码 registry 声明，不能写在 settings.yaml"）。
- 该规则同时**保住 M4 负控夹具**（§8.3）：负控文件写 `applies: "sometimes"` ⇒ 必红。
- 未声明键的定义随之确定：**yaml 出现但 registry 未声明 ⇒ 强制 `restart` + `declared:false` + 进 `undeclared[]`**。
- ⇒ 设计含义：**改分类 = 改代码（走 PR + 评审）**，改值 = 改文件（免重启或等重启）。这是 25-8/25-9 的机制核心：**值可热更、边界不可热更**。

---

## 四、契约表（铁律 47 / 32 / 24 / 31）——【活规格第 1 项】

### 4.1 `src/config/settings-applies.ts`

```ts
/** 生效边界：live = 下一次读取即新值；restart = 本进程 boot 冻结，重启后取新值。 */
export type SettingsApplies = 'live' | 'restart';

/** 数字域（JSON Schema 关键词，声明期 fail-closed 校验用）。 */
export interface SettingsDomain {
  minimum?: number; maximum?: number;
  exclusiveMinimum?: number; exclusiveMaximum?: number;
  integer?: boolean;
}

/** 一条键声明。消费者字段是"谁读它"的机器可核锚点（file:line，实测填入）。 */
export interface SettingsKeySpec {
  /** kebab-case 命名空间（^[a-z][a-z0-9-]*$，≤64 字符）。 */
  ns: string;
  /** 命名空间内的单段键名（不含 '.'，≤64 字符）。 */
  key: string;
  applies: SettingsApplies;
  /** 文件两层均未定义时采用的默认值（必须与 domain 相容）。 */
  defaultValue: unknown;
  domain?: SettingsDomain;
  /** 消费者锚点（file:line，实测；缺省 = 声明不完整，声明期抛错）。 */
  consumer: string;
  /** 既存例外（§3.2）：仅 E1/E2 两条登记项可携带。 */
  exception?: SettingsException;
}

export interface SettingsException {
  id: 'llm-credential-hot-reload' | 'file-driven-reload-channel';
  reason: string; anchors: string[]; since: string;
}

/** 逐键生效行（两个 HTTP 面共用的唯一形状）。 */
export interface SettingsEffectiveRow {
  ns: string; key: string;
  /** 全路径 = `${ns}.${key}`。 */
  path: string;
  applies: SettingsApplies;
  declared: boolean;
  /** live = 本次读取的现值；restart = boot 冻结值。 */
  effective: unknown;
  /** restart 且磁盘现值 ≠ effective 时 = 磁盘现值；否则 null。 */
  pending: unknown | null;
  changedOnDisk: boolean;
  /** workspace | home | declaration（两层文件均无 + 未声明 ⇒ 'none'）。 */
  sourceLayer: 'workspace' | 'home' | 'declaration' | 'none';
  defaultValue: unknown;
  consumer: string;
  exceptionId?: string;
}

export interface SettingsRuntime {
  bootId: string; bootedAt: string;
  /** 已存在的源文件绝对路径（不存在则 null）。 */
  sourceFiles: { workspace: string | null; home: string | null };
  undeclared: string[];
  exceptions: SettingsException[];
  degraded: boolean; reason?: string; code?: string;
  row(path: string): SettingsEffectiveRow | null;
  rows(filter?: { ns?: string; key?: string; includeUndeclared?: boolean; limit?: number }): SettingsEffectiveRow[];
}

/** loadSettingsSpec 的输出：已校验的声明 + 已读源 + 已叠加值（未冻结）。 */
export interface SettingsSpecBundle {
  declarations: SettingsKeySpec[];
  source: SettingsSourceResult;
  /** 两层叠加结果（**唯一**来自 resolveLayers，禁由 layerOfPath 重算）。 */
  resolved: LayerDoc;
  layerOfPath: (path: string) => 'workspace' | 'home' | 'none';
  undeclared: string[];
  degraded: boolean; reason?: string; code?: string;
}
```

**函数契约（可直接抄进实现 JSDoc）**

| 函数 | @input | @output | @degraded | @error（铁律 32） |
|---|---|---|---|---|
| `declareSettings(spec: SettingsKeySpec): void` | 单条键声明 | `void`；登记成功即进声明表 | 无（纯声明期，不做 I/O） | `SettingsSpecError`：非法 ns/key 格式、非法 `applies`（非 `live\|restart`）、缺 `consumer`、`defaultValue` 与 `domain` 不相容、**同 path 重复声明且内容不等**（内容全等 = 幂等，静默返回）→ `{code:'SETTINGS_SPEC_INVALID', phase:'declare', retryable:false}` |
| `loadSettingsSpec(options?: { source?: SettingsSourceResult; registry?: readonly SettingsKeySpec[] }): SettingsSpecBundle` | 可选已读源（缺省 = 调 `loadSettingsSource()`）；可选 registry 覆盖（缺省 = 内置声明表） | **读 + 校验**：返回 `{ declarations, source, resolved, layerOfPath, undeclared, degraded, reason?, code? }`；**不冻结**（冻结是 boot 的职责）。**这是 M4 负控的单元级直调入口**（§8.3） | 源层解析失败 / 文件值类型失配 ⇒ bundle 携 `degraded:true` + `reason` + `code`（**不因此抛**，铁律 24/31） | **fail-closed 主判据**：声明非法（`applies` 非 `live\|restart`、非法 ns/key、重复冲突声明、`domain` 越界、**yaml 出现 `applies`**）⇒ 抛 `SettingsSpecError` → `{code:'SETTINGS_SPEC_INVALID', phase:'spec', retryable:false}` |
| `bootSettingsRuntime(options?: { source?: SettingsSourceResult; now?: () => Date }): SettingsRuntime` | 可选已读源（缺省 = 调 `loadSettingsSource()`）；`now` 注入缝 | **纯工厂**：每次调用返回**全新独立** runtime（新 `bootId`）；**冻结全部 restart 类（含未声明项）的 boot 值**；打印未声明清单 + 范围边界 + 例外节（各一次 `log.warn`，触发条件见 §六 ④） | 源层解析失败/类型失配 ⇒ runtime `degraded:true` + `reason` + `code`，**仍返回可用 runtime**（live 键照常、restart 键用冻结/默认值） | 内部调 `loadSettingsSpec()`；其 `SettingsSpecError` **向上抛**（保留 fail-closed 语义，供单元级负控；生产路径由 `initSettingsBootFence` 转 degraded） |
| `initSettingsBootFence(options?): SettingsRuntime` | 同上一行 | **生产接线入口**：由 `src/server.ts` 的 `createServer()`（`:124`）显式调用；注册"本 server 实例的生效边界"，返回 runtime；**重复调用 = 同一实例**（幂等，`bootId` 不变） | **失败不 `process.exit`**：抛错被 `createServer()` 捕获 ⇒ `log.warn` + runtime `degraded:true` + `code:'SETTINGS_BOOT_FAILED'`，服务照常起（铁律 24/31：配置面故障不成为启动故障面） | 内部捕获 `SettingsSpecError` ⇒ 转为上述 degraded；**不向 `createServer()` 抛** |
| `getSettingsRuntime(): SettingsRuntime` | 无参 | 读取**已初始化**的生效边界；**未初始化时**（非生产装配路径）⇒ 隐式初始化一次 + `log.warn('SETTINGS_BOOT_IMPLICIT …')` + 该 runtime 标 `degraded:true` / `code:'SETTINGS_BOOT_IMPLICIT'`（**可观测，不隐藏**） | 透传底层 runtime 的 `degraded` | 不抛（隐式路径的 `SettingsSpecError` 同 `initSettingsBootFence` 转 degraded） |
| `getEffectiveRow(path: string): SettingsEffectiveRow \| null` | 全路径 `ns.key` | 单键行；未声明但存在于源 ⇒ `applies:'restart'` + `declared:false`；既未声明也不存在 ⇒ `null` | 透传 | 无（读取路径不抛；未命中返回 `null`） |

> **注意（接线铁律 4/0-2 + pre-commit 组 4）**：每个新导出必须有 `src/**` 内的**生产调用方**（不得只有测试调用）——本规格既定调用方：声明常量注册走 `declareSettings`（同文件 `BUILTIN_SETTINGS_DECLARATIONS` 注册循环）；`loadSettingsSpec` 由 `bootSettingsRuntime` 内部调用；`getEffectiveRow` 由 `rows()` 内部调用 + `src/routes/settings.ts` 的 ns/key 精确查询路径调用；`initSettingsBootFence` 由 `src/server.ts` 调用；`bootSettingsRuntime` 由 `initSettingsBootFence` 内部调用。
>
> **R4 · 生效边界的"受控例外"注释口径（逐字，实现必须原样落注释）** —— 本卡在 `src/config/settings-applies.ts` 内保留**一个**进程级生效边界，与 D599「客户配置不得写入任何进程级/全局单例」（`docs/plans/codex/implementation/SYNOVA-IMPL-D599-customer-config-package-20260908.md:93` 决策点 3；`src/config/customer-config-package.ts:17/358` 同口径）存在口径张力，故**按受控例外显式登记、不隐藏**：

```ts
// D1053 受控例外（R4）——进程级生效边界，理由与边界逐条如下：
//   ① 为什么必须有：restart 类键的"半生效"防线需要**一个**跨请求稳定的冻结快照；
//      没有稳定的进程级边界，两次请求就会拿到两个不同的"生效值"（= 半生效本身）。
//   ② 与 D599 决策点 3 的关系：D599 禁的是"客户配置写入进程级状态"（per-org 数据面泄漏）；
//      本例外承载的是**本实例的生效边界元数据**（bootId/冻结快照），不承载任何 per-org 客户数据，
//      也不被客户层写入（settings.yaml 只提供值，见 R5）。
//   ③ 不做隐式单例：初始化**必须**由 createServer() 显式调用 initSettingsBootFence()（src/server.ts:124）；
//      模块 import 副作用**不得**初始化（禁 `let x = boot()` 形态）。
//   ④ 可重置/可观测：bootId 可核（HTTP 响应）、初始化失败降级不 process.exit、隐式初始化必打
//      SETTINGS_BOOT_IMPLICIT 警告。测试用 bootSettingsRuntime() 造独立实例，不依赖本边界。
```

### 4.2 `src/config/settings-source.ts`

```ts
export interface SettingsSourceResult {
  /** 两层叠加后的文档（detached）。 */
  doc: LayerDoc;
  /** 已存在的源文件（不存在 = null）。 */
  files: { workspace: string | null; home: string | null };
  /** 每个顶层/叶子键的归属层（read-only provenance walk，§4.5）。 */
  layerOfPath: (path: string) => 'workspace' | 'home' | 'none';
  degraded: boolean;
  /** 降级原因（含具体文件 + 错误类别），degraded=false 时省略。 */
  reason?: string;
  errors: string[];
}
```

| 函数 | @input | @output | @degraded | @error（铁律 32） |
|---|---|---|---|---|
| `loadSettingsSource(options?: { root?: string; home?: string }): SettingsSourceResult` | 可选覆盖（缺省取 env，见 §4.5） | 两层叠加 doc + 文件路径 + 逐路径归属 | **是**：解析失败 / 类型失配 / IO 错误 ⇒ `degraded:true` + `reason` + `log.warn`（铁律 24） | 不抛业务错（结构错误全部降级为 `degraded`，禁静默——`errors[]` 非空时 `degraded` 必须为 `true`） |

**ENOENT vs 解析失败（逐字规则，实现必须区分）**

| 情形 | `degraded` | `log` | `reason` 示例 |
|---|---|---|---|
| 两层文件均不存在 | `false` | `debug` | （无）——缺配置 = 正常默认，**不是降级** |
| 单层不存在、另一层存在 | `false` | `debug` | （无）——按存在层叠加 |
| `js-yaml` 解析失败（YAML 语法/JSON 语法） | **`true`** | **`log.warn`** | `SETTINGS_SOURCE_UNPARSABLE` + 文件绝对路径 + 解析器原文摘要 |
| 读取 IO 错误（EACCES 等） | **`true`** | **`log.warn`** | `SETTINGS_SOURCE_IO` + errno |
| 文件值类型与声明 `defaultValue` 同类性不符 | **`true`** | **`log.warn`** | `SETTINGS_VALUE_TYPE_MISMATCH` + key + 期望/实得类型 |

### 4.3 `src/routes/settings.ts`

| 函数 | @input | @output | @degraded | @error（铁律 32） |
|---|---|---|---|---|
| `createSettingsRoutes(runtime?: SettingsRuntime): Router` | 可选注入 runtime（缺省 = `getSettingsRuntime()`）；构造时**不** boot | express `Router`，绑定 `GET /api/settings/effective` | 每次请求从 runtime 读 `degraded`/`reason`/`code` 并透传响应体 | 无抛出路径：声明非法被 `SettingsSpecError` 捕获 ⇒ `200 + degraded:true + code`（§7.3）；未知异常 ⇒ 兜底 `200 + degraded:true + code:'SETTINGS_ROUTE_INTERNAL'` + `log.warn`（检查表面不成为故障面） |

### 4.4 装配与"两消费者同一 runtime"（`src/server.ts` 仅 2 行）

**唯一装配路径（逐字，R4 后为 3 行）**：

```ts
import settingsRoutes from './routes/settings';                    // ← server.ts 改动 1/3（D1053）
import { initSettingsBootFence } from './config/settings-applies'; // ← server.ts 改动 2/3（D1053）
// …（在 createServer() 体内、app.listen(config.port) 之前）
initSettingsBootFence();                                           // ← server.ts 改动 3/3（D1053，显式初始化生效边界）
app.use(settingsRoutes);                                           // ← 与改动 3 同属本卡；参照 configRoutes:385 邻位
```

> 行数口径：**import ×2 + 调用/挂载 ×2 = 3 行逻辑改动**（1 import 组 + 1 `initSettingsBootFence()` + 1 `app.use`）。热点文件（15 个未合并分支触及，§九 F7）⇒ **不得再多加一行**。

- `src/routes/settings.ts` **默认导出 = `createSettingsRoutes()` 的实例**（与既有 `configRoutes`/`reloadRoutes` 导出风格一致）。
- **生效边界 = 该 server 实例启动时刻**（R4 定案）：生产 = 进程启动（`createServer()` 调 `initSettingsBootFence()`）；测试 = 再次调用 `initSettingsBootFence()` 或 `bootSettingsRuntime()` 造新边界。
- **boot 时点**：显式调用发生在 `createServer()` 内、`app.listen()`（`:476`）之前 ⇒ 未声明清单、范围边界、例外节均在**启动期**打印（满足 §3.3 与 R8 的可观测性）。
- **初始化失败**：`degraded:true` + `log.warn`，**不 `process.exit`**；服务照常监听（配置面故障不成为启动故障面）。
- **第二消费者**：`src/routes/config.ts` 内的 `/api/config/dump` 处理器调用**同一个** `getSettingsRuntime()`（同一进程单例）⇒ 两个面天然同值，**不需要共享变量、不需要 DI 容器**。
- **测试可 boot 两次（restart 语义）而不用 src 测试开关**：`bootSettingsRuntime()` 是**生产导出**（非测试开关），三套件各自调用它构造独立 runtime ⇒ "重启后新值生效"在同进程内可判（§8.2 路径 B）。**禁止**在 `src/**` 添加任何 `if (process.env.NODE_ENV==='test')` 类开关（《穿真实入口 v1》四条禁止之一）。

### 4.5 设置源接口契约（队长新增 1，逐字固定；S/C/V 同一份）

| 项 | 逐字约定 |
|---|---|
| workspace 层 | env `SYNOVA_SETTINGS_ROOT`（**默认 = `process.cwd()`**）→ 文件 = `<root>/settings.yaml` |
| home 层 | env **`SYNOVA_SETTINGS_HOME`**（**默认 = `$HOME/.synova`**）→ 文件 = `<home>/settings.yaml` |
| 叠加优先级 | **workspace > home** |
| 叠加实现 | **复用** `src/config/config-layers.ts` 的 `mergeLayers`/`resolveLayers`；映射 = `resolveLayers({ default: homeDoc, workspace: workspaceDoc })`（`LAYER_ORDER` 内 `default` 先于 `workspace`，后者胜 ⇒ 等价 home < workspace）。**禁重写第二套叠加实现** |
| provenance | 复用 `dumpLayers` 的顶层键归属做**第二重校验**；叶子级 `sourceLayer` 由**只读 walk** `layerOfPath()` 得出（按 `mergeLayers` 同型递归规则：叶子取"定义该路径的最高层"，`undefined` = 不定义）。**`layerOfPath` 只做归属查询，取值一律来自 `resolveLayers` 输出** —— 不得用 walk 结果替代叠加结果 |
| ENOENT | = 正常默认（**非降级**），`log.debug` |
| 解析失败 | = `degraded:true` + `log.warn`（铁律 24），**不得静默**；`code` 见 §4.2 |
| 测试/自验隔离 | 三套件与 V 的验收命令**必须**把 `SYNOVA_SETTINGS_ROOT` 与 `SYNOVA_SETTINGS_HOME` 指向 `/tmp/...`（`mkdtempSync(join(tmpdir(),'d1053-'))`）；**绝不写仓库与真实 `$HOME`**；同时把 `SYNOVA_DATA_DIR` 指向 `/tmp`（`src/services/llm-credential-store.ts:74` 实测读该 env，缺省写仓库 `data/`） |
| 命名唯一性 | 上述两 env 是**唯一**的源定位缝；**禁另立第三套命名**（如 `SYNOVA_SETTINGS_FILE`）。PLAN §六 里的 `SYNOVA_SETTINGS_FILE` 作废（R3） |
| **弃用 `SYNOVA_HOME`（R3，实测依据）** | `SYNOVA_HOME` **已有既有语义 = 安装目录**，被 `scripts/install.sh:36`（`INSTALL_DIR="${SYNOVA_HOME:-$HOME/.synova-agent}"`）、`scripts/install.ps1:32`、`scripts/setup.ps1:74` 三处钉住 ⇒ 若复用为 settings home 层会与安装目录语义冲突。故本卡用 **`SYNOVA_SETTINGS_HOME`**（前缀命名空间隔离），**不得**读写 `SYNOVA_HOME` |

> ⚠️ **勘误（PLAN 缺陷，本规格已改）**：PLAN §六 ②-⑤ 使用 `SYNOVA_SETTINGS_FILE=<单文件>`，与本节的两 env 双文件模型冲突 ⇒ **该变量名作废**；验收命令一律改为 `SYNOVA_SETTINGS_ROOT=<root> SYNOVA_SETTINGS_HOME=<home>` 双 env 形态（R3 定案名，§十三）。

---

## 五、键路径 × applies 分类表 ——【活规格第 2 项】

### 5.1 分类表 = 实现期声明常量（`BUILTIN_SETTINGS_DECLARATIONS`，逐字落成代码）

> 口径：下表**就是** §4.1 `SettingsKeySpec[]` 的实现内容（不是文档描述）。每行 `consumer` 必须**逐字**来自本表（实测 file:line），实现期不得改写为其它锚点。默认值列取自实测代码常量/仓库配置，非手写。
>
> **R5 载荷分工（逐字）**：`applies` 只在本表（代码 registry）；`settings.yaml` **只写值**。两侧示例：

```yaml
# <root>/settings.yaml —— 只提供值，禁止出现 applies（出现即 SETTINGS_SPEC_INVALID，§3.4）
settings:
  diagnosis:
    gateDataCompleteness: 0.30      # ← 值；分类来自 registry（= live）
  llm:
    baseUrl: "http://old.invalid"   # ← 值；分类来自 registry（= restart）
  rogue:
    whoAmI: 1                       # ← registry 未声明 ⇒ 强制 restart + declared:false + undeclared[]
```

| 类 | 判定 | 键路径 | 默认值 | 实测消费者（file:line） |
|---|---|---|---|---|
| **展示类** | live | `display.reportTemplate` | `default.hbs` | `src/l3/report-template-loader.ts:137`（读 `extensions/reports/manifest.json` 的 `templates.default`） |
| **阈值类** | live | `diagnosis.gateDataCompleteness` | `0.3` | `src/l3/synova-diagnosis-engine-impl.ts:52`（`DEFAULT_GATE_COMPLETENESS`）；消费点 `src/routes/diagnosis.ts:311`、`src/routes/conversations.ts:143`（⚠ D1051 在飞，**只读不改**） |
| **阈值类** | live | `sentinel.findingCountRatioWarning` | `2.0` | `src/sentinel/baseline-store.ts:157`（`this.config.findingCountRatioWarning`；**该文件不碰**） |
| **文案类** | live | `wording.locale` | `zh-CN` | `src/locale/locale-loader.ts:54`（`loadLocale`，`DEFAULT_LANG:26`）；接线点 `src/init/file-driven-loaders.ts:24`（⚠ `:27` 的 `void reloadLocale` **不构成执行**，见 §3.2） |
| **连接类** | restart | `llm.baseUrl` | `https://api.deepseek.com/v1` | `src/config.ts:91`（`storedLlmRuntime?.baseUrl \|\| env \|\| fileCfg?.llm.baseUrl \|\| 'https://api.deepseek.com/v1'`） |
| **连接类** | restart | `server.port` | `18790` | `src/server.ts:476`（`app.listen(config.port)`）；来源 `src/config.ts:107` |
| **插件类** | restart | `extensions.skill.enabled` | `true` | `src/skill/skill-loader.ts:120`（扫 `manifest.json`）；同族 `src/l3/framework-loader.ts:47`、`src/l4/industry-loader.ts:3` |
| **数据源类** | restart | `store.dbPath` | `./data/synova.db` | `src/init/engine-context.ts:66`（`new Database(config.dbPath)`）；来源 `src/config.ts:104` |
| **鉴权类** | restart | `llm.apiKey` | `''`（env 链末位空串） | `src/config.ts:77`；**既存例外 E1**（§3.2） |

> **7 类全覆盖核对**：live 3 类（展示 / 阈值 / 文案）+ restart 4 类（连接 / 插件 / 数据源 / 鉴权）= 与 yaml 25-8/25-9 四类逐条对齐 ⇒ 每类 ≥1 键路径 + 默认值 + 消费者，无空类。

### 5.2 分类判据（新键入表时怎么判，逐条可核）

1. **改它需要重建进程内已建立的资源吗？** 需要（socket 监听、DB 句柄、HTTP 客户端、凭证/密钥装载、扩展加载器索引）⇒ `restart`。
2. **它的作用面是"下一次读取的输出"吗？** 是（标签/文案、阈值参数、展示模板名）⇒ `live`。
3. **两可时默认安全**：判不准 ⇒ `restart`（未声明亦强制 `restart`，同一方向）。
4. **不得用"grep 到符号"作为分类依据**（禁 grep 型静态判据，F2）：分类必须在 §5.1 表内以"默认值 + 实测消费者"落账。
5. **既存例外优先于本判据**：E1/E2 两条按 §3.2 处置，不按本条重判。

### 5.3 边界值清单（每个参数：空 / 单元素 / 恰临界 / 超限 / 零 / 负值）

| 参数 | 空 | 单元素 | 恰临界（=阈值 / =limit） | 超限 | 零 / 负值 |
|---|---|---|---|---|---|
| `SettingsKeySpec.ns` | `''` → 抛 `SETTINGS_SPEC_INVALID` | `'a'` 合法（正则容许单字符） | 长度 64 合法 | 长度 65 → 抛 | 无负值语义（非数字） |
| `SettingsKeySpec.key` | `''` → 抛 | `'x'` 合法 | 长度 64 合法 | 长度 65 → 抛；含 `'.'` → 抛（禁多段，避免与 `path` 混淆） | 同上 |
| `SettingsKeySpec.consumer` | `''` → 抛（声明不完整） | `'src/x.ts:1'` 合法 | 无上限约束（超长仅告警） | — | — |
| `applies` | `''` / 缺省 → 抛（**禁隐式默认**） | 合法值仅 `'live'` / `'restart'` | — | `'sometimes'`/`'LIVE'` → 抛（**M4 负控**）；**yaml 里出现 `applies` 字段本身 → 抛**（R5：值面不得携带分类） | — |
| `diagnosis.gateDataCompleteness`（`domain:{minimum:0,maximum:1}`） | `null` → 类型失配降级 | — | `0` 合法（下界闭）、`1` 合法（上界闭） | `1.000001` → 抛；`-0.000001` → 抛 | `0` 合法（语义 = 不过滤）；负值 → 抛；`NaN`/`Infinity` → 抛 |
| `sentinel.findingCountRatioWarning`（`domain:{exclusiveMinimum:0}`） | `null` → 类型失配降级 | `0.0001` 合法 | 恰 `0` → 抛（**下界开**） | 上限不设 | `0` → 抛；负值 → 抛 |
| `server.port`（`domain:{minimum:1,maximum:65535,integer:true}`） | `null` → 类型失配降级 | `1` 合法 | `1` 与 `65535` 均合法 | `65536` → 抛；`18790.5` → 抛（非整） | `0` → 抛（**`0` 是监听语义的"随机口"，不得作为声明值**——本卡 e2e 用 `PORT=0` 起服，但那是 env 不是声明）；负值 → 抛 |
| `wording.locale` | `''` → 抛 | `'en-US'` 合法 | `extensions/locales/manifest.json:languages` 成员合法 | 非成员（如 `'xx-XX'`）→ **声明期抛**（禁静默回退 `zh-CN`） | — |
| `includeUndeclared`（query） | 缺省 = `1` | `'0'`/`'1'` 合法 | — | 其它值 → `400`（§7.3） | — |
| `limit`（query，1..500，默认 100） | 缺省 = 100 | `1` 合法 | `1` / `500` 均合法（**含边界**） | `501` → `400`；非数字 → `400` | `0` → `400`；负值 → `400` |
| `undeclared[]`（输出集合） | `[]` = 无未声明（**非降级**） | 1 条 | 恰 100 条时 `truncated:false` | 101 条 ⇒ 输出前 100 + `truncated:true` | — |

---

## 六、既存例外节（活规格第 3 项；落地字段 / 日志 / 待办）

本节即 §3.2 裁决②的执行视图，**逐条落到可核物**：

| 硬要求 | 字段（声明/响应） | 日志（boot，各一次） | 待办 |
|---|---|---|---|
| ⓐ 显式例外节 | 声明：`SettingsKeySpec.exception`；响应：`SettingsEffectiveRow.exceptionId` + 顶层 `exceptions[]` | boot `log.warn`（含 `exceptionId`/`applies`/`anchors`） | 例外清单全文入四态 Note |
| ⓑ 启动清单打印 | — | **三行**（逐字见本节末）：`SETTINGS_UNUSED_UNDECLARED`（N 条）→ `SETTINGS_UNDECLARED_SCOPE`（范围边界）→ `SETTINGS_EXCEPTION_ACTIVE`（M 条例外）；**三者皆不得静默** | — |
| ⓒ 收敛路径 | — | — | "`llm.apiKey`：声明 `restart` vs 实现热重载 ⇒ 待评估迁移或明确豁免"入 §10 待办 + Note `proposed/`；**不阻塞本卡** |

**启动日志格式（逐字，供 V grep 判别；三行，缺一即路径 C 判退）**

```
log.warn({ count, undeclared }, 'SETTINGS_UNUSED_UNDECLARED 未声明分类项（默认安全 = 强制 restart）')
log.warn({ scope }, 'SETTINGS_UNDECLARED_SCOPE 枚举范围 = settings.yaml 内未声明键；既有 env 键不在本卡枚举范围（D1053 §3.3 / R8）')
log.warn({ count, exceptions }, 'SETTINGS_EXCEPTION_ACTIVE 既存例外（不按声明面自动生效，见 D1053 §6）')
```

> V 的路径 C 检查**三件**：① `SETTINGS_UNUSED_UNDECLARED` 出现且条目与夹具一致；② `SETTINGS_UNDECLARED_SCOPE` **边界声明**出现（防"看起来全量其实不是"）；③ `SETTINGS_EXCEPTION_ACTIVE` 出现（CTO 裁决②ⓑ 可观测性）。

**打印触发条件（④，C 的默认已批准，逐字定死）**

| 条件 | `SETTINGS_UNUSED_UNDECLARED` | `SETTINGS_UNDECLARED_SCOPE` | `SETTINGS_EXCEPTION_ACTIVE` |
|---|---|---|---|
| settings 面**为空**（两层皆 ENOENT，`sourceFiles` 双 `null`） | **不打** | **不打** | **打**（有声明面即打） |
| settings 面非空（任一层存在） | 打（N ≥ 0，含 0 项） | 打 | 打 |

- **理由**：空面无可枚举对象，"0 项"会污染 9 个既有 `createServer()` 测试的日志断言（噪音 ⇒ 门禁被绕过）。
- **例外打印独立于该条件**（`SETTINGS_EXCEPTION_ACTIVE` 恒打）：裁决②ⓑ 的可观测性不因"面为空"而消失。
- V 的路径 C 面**非空** ⇒ 三行判据不受影响。

---

## 七、HTTP 契约 ——【活规格第 4 项】

### 7.1 `GET /api/settings/effective`（新）

**Query 参数**

| 参数 | 类型 | 缺省 | 语义 | 非法 |
|---|---|---|---|---|
| `ns` | string | 无（= 全量） | 按命名空间过滤；须匹配 `^[a-z][a-z0-9-]*$` | 格式非法 → `400` |
| `key` | string | 无 | 与 `ns` 合用精确查询单键 | `key` 存在但 `ns` 缺失 → `400`；该键不存在 → `200` + `keys:[]`（**不是 404**） |
| `includeUndeclared` | `'0'\|'1'` | `'1'` | 是否把未声明项（强制 restart）并入 `keys[]` | 其它值 → `400` |
| `limit` | int 1..500 | `100` | `keys[]` 截断上限 | 越界/非数字 → `400` |

**响应 schema（字段名逐字固定）**

```json
{
  "ok": true,
  "degraded": false,
  "reason": "（degraded=true 时存在）",
  "code": "（degraded=true 时存在；取值见 7.3）",
  "bootId": "9f1c…（randUUId，进程 boot 身份；重启后有且仅有一个新值）",
  "bootedAt": "2026-09-28T12:00:00.000Z",
  "sourceFiles": { "workspace": "/tmp/d1053-root/settings.yaml", "home": null },
  "undeclared": ["rogue.whoAmI"],
  "undeclaredTotal": 1,
  "undeclaredScope": "settings.yaml",
  "truncated": false,
  "exceptions": [ { "id": "llm-credential-hot-reload", "reason": "…", "anchors": ["src/config.ts:76"], "since": "D575" } ],
  "counts": { "declared": 9, "live": 4, "restart": 5, "undeclared": 1 },
  "filters": { "ns": null, "key": null, "includeUndeclared": true, "limit": 100 },
  "keys": [
    {
      "ns": "diagnosis", "key": "gateDataCompleteness", "path": "diagnosis.gateDataCompleteness",
      "applies": "live", "declared": true,
      "effective": 0.55, "pending": null, "changedOnDisk": false,
      "sourceLayer": "workspace", "defaultValue": 0.3,
      "consumer": "src/l3/synova-diagnosis-engine-impl.ts:52"
    }
  ]
}
```

**关键断言语义（供套件与 V 逐条核；含命名判据，V 可在自己的 harness 里独立断言）**

- `effective` 对 live 键 = **本次请求**重新读盘的值；对 restart 键 = **boot 冻结值**（同 `bootId` 内多次请求恒等）。
- `pending != null` **仅当**该键 `applies==='restart'` 且磁盘现值 `deepEqualJson` 与 `effective` 不等。
- **判据 D-BOOT-1（硬判别式，出处 = 本节）**：**同一 `bootId` 下，任一 `applies:'restart'` 键的 `effective` 发生变化 ⇒ 必红（半生效）**。
  - 判据的机器形态：对同一 `bootId` 的两次采样做 `deepEqualJson(row.effective_1, row.effective_2)`，不相等即违反。
  - 反向（同样必核）：`bootId` **变化**后 restart 键 `effective` 允许变化；若新 boot 下 restart 键**仍为旧值**而磁盘已改 ⇒ 判 **"restart 声明未生效"**（25-9 的 fail_when 第二条）。
  - V 的独立断言**不依赖 C 的用例**（同一条判据，独立 harness 复现）。

### 7.2 `GET /api/config/dump?orgId=…` 扩列（既有，向后兼容；形状按 R6/R7 定死）

- 保留既有全部字段：`ok` / `orgId` / `config` / `provenance` / `degraded` / `reason?` / `audit`（`src/routes/config.ts:35-43` 实测）。
- **新增一个顶层字段 `settings`（R6/R7 定死形状）**：

```json
{
  "ok": true, "orgId": "default", "config": {}, "provenance": [], "degraded": false, "audit": [],
  "settings": {
    "keys": [ /* 与 §7.1 同形状的逐键行数组 */ ],
    "undeclared": ["rogue.whoAmI"],
    "degraded": false,
    "scope": "process"
  }
}
```

- **`catch` / degraded 分支同样增列 `settings`**（R7 硬要求——否则降级模式下两消费者形状不一致，C1 断言无法比较）：该分支取 `{ "keys": [], "undeclared": [], "degraded": true, "scope": "process" }`。既有 catch 分支字段保持在原位（`src/routes/config.ts:48-56`）。
- **不动**：既有 6 字段语义、`orgId` 校验（缺省/非字符串 → `400` + `{ok:false, code:'VALIDATION_ERROR'}`，`:28` 实测）、**零缓存**（每次请求走同一 runtime 的 accessor，不缓存 `settings` 块——正是 M3 的判别对象，§8.3）。
- 语义：客户端配置解析异常 → `200 + degraded:true`（`:48-56` 实测）——新字段**不得**改变这两种既有语义。

### 7.3 状态码语义表（400 vs 200+degraded）

| 情形 | HTTP | body 关键字段 | 依据 |
|---|---|---|---|
| `ns` 格式非法 / `key` 无 `ns` / `includeUndeclared` 非 `0\|1` / `limit` 越界非数字 | **400** | `{ok:false, code:'VALIDATION_ERROR', error}` | 请求形状错（镜像 `routes/config.ts:28` 既有先例） |
| 两层 `settings.yaml` 均不存在 | **200** | `degraded:false`，`sourceFiles` 皆 `null`，各键 `sourceLayer:'declaration'` | ENOENT = 正常默认（§4.5） |
| YAML/JSON 解析失败 | **200** | `degraded:true, code:'SETTINGS_SOURCE_UNPARSABLE', reason` | 铁律 24/31：检查表面不成为故障面 |
| 读取 IO 错误 | **200** | `degraded:true, code:'SETTINGS_SOURCE_IO', reason` | 同上 |
| 文件值类型与声明不符 | **200** | `degraded:true, code:'SETTINGS_VALUE_TYPE_MISMATCH', reason`（该键回落 `defaultValue`，**显式**在 `reason` 里点名键与类型） | 禁静默降级 |
| 声明表非法（`applies:'sometimes'`、重复冲突、domain 越界）**或 yaml 出现 `applies` 字段**（R5） | **200** | `degraded:true, code:'SETTINGS_SPEC_INVALID', reason`（**显式指向 registry**），**涉事键不得出现在 `keys[]`（禁回落默认值当作正常行）** | M4 负控的 HTTP 面 |
| 存在未声明键 | **200** | `degraded:false`，`undeclared` 非空 | 正常状态，非降级（§3.3） |
| 未预期内部异常 | **200** | `degraded:true, code:'SETTINGS_ROUTE_INTERNAL', reason` + `log.warn` | §4.3 |

### 7.4 未声明清单字段（逐字）

| 字段 | 位置 | 语义 |
|---|---|---|
| `undeclared[]` | 响应顶层 | 全路径字符串数组（`ns.key`），**排序稳定**（字典序）；含**全部**未声明项来自两层文件（不只 workspace） |
| `undeclaredTotal` | 响应顶层 | 未声明项总数（截断前） |
| `undeclaredScope` | 响应顶层 | **恒为字面量 `"settings.yaml"`** —— 把 R8 的枚举范围边界同时暴露在 HTTP 面（机器可核，不靠读日志） |
| `truncated` | 响应顶层 | `undeclared.length < undeclaredTotal` 时为 `true`（阈值 = `limit`，默认 100） |
| `keys[].declared` | 每键行 | 未声明项并入时为 `false`，且 `applies` **必为 `restart`** |
| `/api/config/dump.settings` | 该面顶层 | `{keys, undeclared, degraded, scope:"process"}`；catch 分支同样增列（§7.2） |
| 启动日志 | stdout/stderr | §六 的**三行** `log.warn`（未声明清单 + 范围边界 + 例外节），**启动期各一次** |

---

## 八、三路径夹具 + M1-M4 变异体 ——【活规格第 5 项】

### 8.1 三套件职责表（断言 ↔ 变异体；队长新增 2 的落地）

> 口径：**每条断言只归属一个套件**；「两消费者同一新值」**必须**落在驱动真实 HTTP 的 e2e 套件——否则 M3（消费者侧注入模块级缓存）无法使其变红 = 缺判别性夹具。

| 套件（文件名逐字） | 承载断言 | 对应变异体（注入点） | 红证判据 |
|---|---|---|---|
| `tests/config/settings-applies.test.ts`（**LIVE 套件**，内容含串 `settings-applies-live`） | **A1** live 键改盘后同一 runtime 的 `effective` 立即新值；**A2** `sourceLayer` 归属正确（home/workspace/declaration 三态）；**A3** 未声明键 ⇒ `applies:'restart'` + `declared:false` + 进 `undeclared[]` | **M2**（从声明常量删一条键）⇒ A3 必红；**M1**（applies 判定分支把 restart 当 live）⇒ **本套件 A2/A3 不红**（设计如此），由 RESTART 套件红 | 对应 `expect(...)` 失败 |
| `tests/config/settings-source.test.ts`（**RESTART 套件**，内容含串 `settings-applies-restart`） | **B1** 同一 boot：改盘后 `effective` = 旧值 **且** `pending` = 新值 **且** `applies:'restart'`；**B2** 同 boot 内多次读取 `effective` 恒等（冻结稳定，判据 **D-BOOT-1**）；**B3** 新 boot（`bootSettingsRuntime()` 二次调用）：`bootId` 变化 **且** `effective` = 新值 | **M1**（restart 当 live）⇒ B1 必红（`effective` 变新值 = 半生效） | 同上 |
| `tests/routes/settings.test.ts`（**入口/E2E 套件**，内容**不含**两串） | **C1 两消费者同一新值**：真实 HTTP 下，`/api/settings/effective` 与 `/api/config/dump` 对同一 key 的 `effective` 满足 `deepEqualJson` 相等（live 键改盘后为**新值**且两值相等）；**C2** `400` 校验语义（4 种非法 query）；**C3** 未声明清单出现在 HTTP 响应（`undeclared[]` + `undeclaredScope` + `truncated`）；**C4** 非法声明 ⇒ `200 + degraded:true + code:'SETTINGS_SPEC_INVALID'` 且涉事键不在 `keys[]` | **M3**（`src/routes/config.ts` 消费者侧注入模块级缓存）⇒ **C1 必红**（两消费者值不等）；**M4**（负控：yaml 带 `applies:'sometimes'`）⇒ C4 必红 | 同上 |

**e2e 装配（逐字约束，铁律 12 不 mock 管线）**

- 起**真实** `createServer()`（`src/server.ts:124`）+ `process.env.PORT='0'` + 从 `server.address()`（`AddressInfo`）取实际端口 + 真实 `fetch`。先例：`tests/integration/production-entry-conversation.integration.test.ts:145`（"PORT=0 + server.address()"）。
- `SYNOVA_SETTINGS_ROOT` / `SYNOVA_SETTINGS_HOME` / `SYNOVA_DATA_DIR` 指向 `mkdtempSync(join(tmpdir(),'d1053-'))`；env 隔离清单参照上引先例的 `ENV_KEYS`（逐键 `delete`，避免落到真实 provider/仓库路径）。
- **`initSettingsBootFence()` 在该套件内必须被调用**（`createServer()` 内已调用；若套件自建 app 则显式调用），否则 `getSettingsRuntime()` 会走隐式初始化路径并标 `SETTINGS_BOOT_IMPLICIT`（那会削弱 C1 的生产等价性）。
- **不得** mock 管线、**不得** `app.listen` 假 app 后手工挂 handler。

### 8.2 三路径夹具（每条都有**运行期**判据，不用 grep 型静态判据）

| 路径 | 场景 | 夹具装配 | 判据（可执行） | 验收点 |
|---|---|---|---|---|
| **A · live 生效** | 改 live 类键（阈值类 `diagnosis.gateDataCompleteness` 0.3→0.55） | 起服 → `GET` 一次 → `sed -i` 改 `<root>/settings.yaml` → **不重启**再 `GET` | 两消费者都返回新值 **且 `deepEqualJson(a,b)===true`**（无部分消费者滞留旧值） | 25-8 |
| **B · restart 隔离** | 改 restart 类键（连接类 `llm.baseUrl` `old.invalid`→`new.invalid`） | 同上改盘 → 同进程重复 `GET` → 再 `bootSettingsRuntime()` 二次 boot / 或真重启进程 | 同 boot：`effective` **仍 `old.invalid`** + `pending` = `new.invalid` + `applies:'restart'` + `/api/healthz` 200 + 端口不变；新 boot：`bootId` 变 + `effective` = `new.invalid` | 25-9 |
| **C · 默认安全（未声明）** | 源里放未声明键 `rogue.whoAmI` | 在 A/B 的同一文件追加该键 → 起服 | 该键 `applies` **强制 `restart`**、`declared:false`、进 `undeclared[]`；**三行启动日志各 ≥1**：`SETTINGS_UNUSED_UNDECLARED` + `SETTINGS_UNDECLARED_SCOPE`（枚举边界声明）+ `SETTINGS_EXCEPTION_ACTIVE`（CTO-② 例外打印） | 25-8 note + 完成标准 |

**健康检查路径（实测，勿抄）**：`/api/healthz` —— `grep -n "api/healthz" src/routes/healthz.ts` → `323:router.get('/api/healthz', async (_req, res) => {`。**不是** `/healthz`（PLAN §四 写作 `healthz` 属不精确，本规格已更正）。

### 8.3 M1-M4 变异体（逐条：改哪里 + 期望哪个套件红 + 复原判据）

| 变异 | 改哪里（注入点） | 期望哪个套件红 | 复原判据 |
|---|---|---|---|
| **M1** restart 项当 live 处理 | `src/config/settings-applies.ts` 的分类判定分支，使 `restart` 键走现读 | `tests/config/settings-source.test.ts` 的 **B1 必红** | 复原后 `git diff --stat` 空 **且** `shasum -a 256 <file>` 与注入前记录值逐字相同（V 注入前后各存一次基线哈希） |
| **M2** 删分类声明 | 从 `BUILTIN_SETTINGS_DECLARATIONS` 移除一条键（模拟"忘声明"） | `tests/config/settings-applies.test.ts` 的 **A3 必红** | 同上（哈希一致） |
| **M3** 消费者绕过 accessor 自缓存 | `src/routes/config.ts` 内注入模块级缓存分支（首次读后缓存 `settings` 块） | `tests/routes/settings.test.ts` 的 **C1 必红**（两消费者值不等） | 同上 |
| **M4** 非法配置负控 | 夹具文件写 `applies: "sometimes"`（R5：yaml 本不得含 `applies`）／坏 YAML | `tests/routes/settings.test.ts` 的 **C4 必红**；**且**单元级直调 `loadSettingsSpec()` 抛 `SettingsSpecError`（**非 0 exit**）；**且**进程级起服**不崩死**（degraded 响应，见 §7.3） | 删除负控夹具文件；`git status --porcelain` 仅剩本卡声明写集 |

**判别性要求（"删掉即报红"）**：M1-M4 每条必须能被 V **独立复现为红**；若注入后套件仍绿 ⇒ 判定 **"接线了≠被执行"**，退回（不是补文档）。

### 8.4 红证不残留

- 全部注入须带标记串 **`INJECTED-RED-D1053`**（临时代码分支/注释）。
- 收尾硬判据：`grep -rc 'INJECTED-RED-D1053' src/ tests/ | grep -v ':0'` → **空**（该判据写进 M6 收尾三件）。
- 复原后另有第二判据：`git status --porcelain` 仅剩本卡声明写集。

---

## 九、失效条件清单 ——【活规格第 6 项】

| # | 失效模式（有前科） | 实测锚点 | 本卡对策（写进验收命令/夹具） |
|---|---|---|---|
| **F1** | **A2 机器证据管线假绿**：套件定位失败**静默跳过**却统一写 `pass` | `scripts/product-lines/run-machine-evidence.sh`：**:70-71** 预置 `VERDICT="pass"` / `QUOTE="vitest 套件全绿"`；**:77** 内容定位、**:86** 未找到 → `? $s → 未找到测试文件（跳过该套件）`；**:90-94** 仅当**一个都没找到**才 `exit 2`（fail-closed）⇒ **部分跳过仍写 pass** | ① 测试文件名**字面**含 `settings-applies-live`/`settings-applies-restart`（两步定位都能命中）；② 证据必须附「**实际执行了哪个套件、跑了几个用例**」的 `--reporter=verbose` 原始输出；③ 静默跳过 = 无效证据（V 判退） |
| **F2** | **grep 型静态判据当验收**（实测 3/5 = 60% 命中率） | — | 每条判据都必须有运行期夹具（三路径 + M1-M4）；不接受"grep 到符号"作为验收 |
| **F3** | **「接线了」≠「被执行」** | 现成反例：`src/init/file-driven-loaders.ts:27` `void reloadLocale;` | M2/M3 判别性夹具：删声明 / 绕 accessor ⇒ 必须报红；不红 = 未接线（§8.3） |
| **F4** | **证据新鲜度**：证据日期后该线 modules（`src/config/`）再有提交 ⇒ 判 `stale` | `scripts/product-lines/calc-progress.py:47` | 证据在**代码冻结后**跑；3 天内送审；证据产出后不再改 `src/config/**` |
| **F5** | **L1→L3 跨层基线**（线3 切片曾被退回） | `scripts/check-architecture.sh` 的 `PAT_L3='(/l3/\|/sentinel/\|/expert-platform/\|/expert/)'`；`src/config/**` 不在任何层模式内 | 新模块落 `src/config/**`；测试/路由不 import `l3/ sentinel/ expert/ l4/ store/`；`src/routes/config.ts` 已有 `../config/*` 合法先例（`:20`） |
| **F6** | **跨卡写集重叠** | D1051 在飞写集实测含 `src/routes/diagnosis.ts`、`src/routes/conversations.ts`；`src/sentinel/baseline-store.ts` 被 3 分支触及 | 三者**不进写集**（§2.3）；开工/合并前 `git fetch --all` 复扫 |
| **F7** | **热点文件**（`src/server.ts` 被 15 个未合并分支触及） | `10-conflict-scan.txt` ③ | 只加 2 行（§4.4）；合并前复扫 |
| **F8** | **红证残留** | — | 标记串 + 收尾 `grep=0`（§8.4） |
| **F9** | **Windows 门禁 fail-open** | — | 本卡不含 win 专属脚本改动；若 CI 该腿 degraded，必须在回执**显式标 degraded**（禁静默绿） |
| **F10** | **同类第二次 = 升级** | M1/M6/M7 模式（K3 台账） | 出现同类第二次 ⇒ 立即升级 CTO，**不自行加机制**（一类一机制） |
| **F11** | **不引 `@deepseek-ai/*` 依赖** | `ls -d node_modules/@deepseek-ai` → `No such file or directory`；处置表 `dsh-settings` = 接缝-预留 | 引包 = 越界（红线）；M3 锚点用注释 + 现验命令，不落 import |
| **F12** | **`js-yaml` 属传递依赖借用**（本卡新增登记） | `npm ls js-yaml` → `js-yaml@4.3.0 extraneous`；`package.json` 无该直接依赖（仅 `@types/js-yaml` 在 devDependencies）；`package-lock.json` 内由 `electron-updater`/`app-builder-lib` 传递引入 ⇒ `npm ci` 会装上 | 沿用既有先例（`src/config/customer-config-package.ts:32` 同型 import）；**不改 `package.json`**（超写集）；若实现期解析器不可用 ⇒ 报阻塞，**不得**静默跳过 YAML 支持；待办见 §10 |
| **F13** | **端口假设漂移**（PLAN §六 用 `${PORT:-18790}`） | `src/config.ts:107` = `parseInt(process.env.PORT \|\| String(filePort \|\| 3000), 10)`；`filePort` 来自 `synova.json`（`{"server":{"port":18790}}`）或 `DEFAULT_CONFIG.server.port = 18790`（`src/config-file.ts`） | 验收命令**显式 `export PORT=<空闲口>`** + 从启动日志回读；**不依赖**隐式默认口（§十三） |

---

## 十、不做清单 + 实现阶段文件清单 ——【活规格第 7 项】

**不做清单（带精确路径，与 §2.3 同源，逐条可核）**

| 不做 | 精确路径 |
|---|---|
| 不改 K3 域 | `scripts/audit/**`、`docs/synova/audit-reports/**` |
| 不改创始人领地 | `docs/synova/product-lines/product-lines.yaml`（含 25-8/25-9 的 note 重锚） |
| 不改在飞/热点写集 | `src/routes/diagnosis.ts`、`src/routes/conversations.ts`（D1051）、`src/sentinel/baseline-store.ts`（3 分支） |
| 不改只读复用面 | `src/config/config-layers.ts`、`src/config/customer-config-package.ts` |
| 不改既有 live 通道 | `src/config.ts`（含 `:76` 热重载）、`src/locale/**`、`src/routes/reload.ts` |
| 不改门禁 | `scripts/pre-commit-check.sh`、`scripts/check-architecture.sh`、`scripts/workflow/**`、`.github/workflows/ci.yml` |
| 不引依赖 | `package.json`、`package-lock.json`（禁 `@deepseek-ai/*`；不为 `js-yaml` 提依赖） |
| 不写 src 测试开关 | 任意 `src/**` 内的 `NODE_ENV==='test'` / `SYNO_TEST*` 分支（《穿真实入口 v1》禁止项） |
| 不做第二套叠加 | 任何 `src/config/**` 内新增的 merge/overlay 实现（§4.5） |
| 不做第二套源命名 | 除 `SYNOVA_SETTINGS_ROOT` / `SYNOVA_SETTINGS_HOME` 之外的源定位 env（`SYNOVA_SETTINGS_FILE` 作废；安装目录 env 见 §4.5 R3 不得复用） |

**实现阶段文件清单**：见 §2.2（8 个产品文件 + 治理产物）。

**待办（不阻塞本卡，逐条登记）**

1. `product-lines.yaml` 的 25-8/25-9 note 重锚（DSH 锚点已断，P8/P9）——创始人领地，走 CTO（§3.1）。
2. `llm.apiKey` 既存例外 E1 的收敛（迁移 restart 或明确豁免）——§3.2ⓒ。
3. `js-yaml` 由传递依赖提升为直接依赖（`package.json`）——F12。
4. `src/init/file-driven-loaders.ts:27` 的 `void reloadLocale` 不构成执行（locale 热加载未被执行）——单独立卡。
5. GS-08 记分通道（D791 PR-B 未落 main）——与本卡权威证据通道（`test:`）无关，仅登记（P17）。

---

## 十一、依赖与前置（未满足 ⇒ 停，不抢跑）

| # | 前置 | 判定命令（实测过） | 现状 |
|---|---|---|---|
| D1 | 工作树干净且不落后 | `git status --porcelain`（空）+ `git rev-list --left-right --count origin/main...HEAD` | 起手实测 `0	2`（ahead 2 / behind 0）✅ |
| D2 | 分支 tip 已推送 | `git ls-remote --heads origin \| grep d1053` | `6e662bf4…  refs/heads/feat/d1053-live-restart-settings` ✅ |
| D3 | 判据来源可回源 | `git show 643069b9:<K3 报告路径>` | 可回源（§2.0 P7）✅ |
| D4 | DSH 现验锚点可核 | `git -C /Users/wane/src/deepseek-harness-017 grep -n 'applies' packages/settings/settings/lib/index.js` | 命中硬编码 `"live"` ✅（施工按 §3.1 口径） |
| D5 | `js-yaml` 可用 | `node -e "require.resolve('js-yaml')"` | `npm ci` 路径可装上（F12）✅ |
| D6 | 域归属单域 | `python3 scripts/control-tower/check-ownership.py <8 文件>` | `PASS 8 个文件同域: win` ✅ |
| D7 | 写集冲突 0 | `10-conflict-scan.txt` ② = 0 个脏改动工作树 | ✅ |
| D8 | 端口可控 | 验收命令显式 `export PORT=<空闲口>`（F13） | 由 V 现场选口 ✅ |

**硬依赖：无**（K3 报告为判据来源，非代码前置）。**同批约束**：25-8 与 25-9 同 PR 声明（§1.1）。**反向依赖**：25-7（`k3_only` 审计员复核）的翻转点 = 本卡；本卡完成 ⇒ 25-7 可复审 ⇒ 一格工作换三格。

---

## 十二、风险与上限

| # | 风险 | 量级/口径 | 对策 |
|---|---|---|---|
| R1 | `src/server.ts` 热点冲突（15 个未合并分支） | 实测 tip 2026-09-25 | 只加 2 行；合并前 `git fetch --all` 复扫 + rebase 而非 merge |
| R2 | `loadConfig()` 语义回归（消费面 53 处） | 实测 53 处 | 本卡**不接管** `loadConfig()`；新面独立闭环；既有 env 键语义不变（§3.3） |
| R3 | 同键多消费者默认值不一致（真实半生效温床） | **4 落点 / 2 个不同默认值（0.3×3、0.4×1）**，实测：`src/l3/synova-diagnosis-engine-impl.ts:52` `DEFAULT_GATE_COMPLETENESS = 0.3`；`src/routes/diagnosis.ts:311` `?? 0.3`；`src/routes/conversations.ts:143` `?? 0.3`；`src/orchestrator/diagnosis-orchestrator.ts:65` `gateDataCompleteness: 0.4`（**唯一 0.4**） | 本卡**只把声明面唯一化**为 `defaultValue: 0.3` + `consumer` 锚点（§5.1）；**`src/routes/conversations.ts:143` 与 `src/orchestrator/diagnosis-orchestrator.ts:65` 两处均未消除**（前者 = D1051 在飞写集，后者 = 超写集）⇒ V 的证据**必须点明"未消除 + 未消除的原因"**，禁写成"已统一" |
| R4 | 重型验证压满（8GB 机器，两次前科） | — | vitest **串行 ≤1**；本卡重型验证 = 3 套件一次性跑（不并发） |
| R5 | PR 预算 | 8 产品文件 + 治理产物 | ≤12 单域 ✅ |
| R6 | 证据 stale | `calc-progress.py:47` | 代码冻结后跑证据；3 天内送审（F4） |
| R7 | 自验独立性（M3 型事故） | — | V 不得由 C1 兼任；V 只读产品代码（可写 `/tmp`）；注入在临时分支/临时文件上做，出证据后复原 |

**上限**：成员 ≤4（队长 + ≤2 编码 + 1 独立自验）；WIP=1（本卡未过 CTO 收件闸不放行下一张代码卡）；重型验证同时 ≤1。

---

## 十三、可复制验收命令（V 独立重跑；①-⑧ 全绿才算四件套齐）

```bash
# ── 变量与隔离（绝不写仓库与真实 $HOME；env 名 = R3 定案） ──
WT=/Users/wane/SynovaAgent/.synova-wt-squad-d1053
cd "$WT"
export SYNOVA_SETTINGS_ROOT=/tmp/d1053-root               # → /tmp/d1053-root/settings.yaml（workspace 层）
export SYNOVA_SETTINGS_HOME=/tmp/d1053-settings-home      # → …/settings.yaml（home 层）；安装目录 env 不得复用（§4.5 R3）
export SYNOVA_DATA_DIR=/tmp/d1053-root                    # 凭证文件落 /tmp（src/services/llm-credential-store.ts:74）
export SYNOVA_DB_PATH=/tmp/d1053-root/synova.db           # 不写仓库 data/
rm -rf /tmp/d1053-root /tmp/d1053-settings-home
mkdir -p /tmp/d1053-root /tmp/d1053-settings-home

# ── ① 三套件（独立重跑）——必须打印套件名与用例数（防 A2 静默跳过，F1） ──
npx vitest run tests/config/settings-applies.test.ts \
               tests/config/settings-source.test.ts \
               tests/routes/settings.test.ts --reporter=verbose

# ── ② 起真实服务：显式空闲口 + 从启动日志回读实际端口（F13，不依赖隐式默认口） ──
export PORT=17453                                # 现场选空闲口；PORT 优先于 synova.json/DEFAULT_CONFIG
SYNOVA_SKIP_MCP=1 npx tsx src/index.ts > /tmp/d1053-server.log 2>&1 & SRV=$!
sleep 5
grep -n "配置加载完成" /tmp/d1053-server.log      # 回读实际 port（src/config.ts:119 打印；格式以实测行为准并贴原始行）
curl -s "http://127.0.0.1:${PORT}/api/healthz" | head -c 200   # 实测路径 = /api/healthz（src/routes/healthz.ts:323）

# ── ③ 夹具：两层文件（workspace 覆盖 home）+ 未声明键（**只写值，R5：禁写 applies**） ──
cat > /tmp/d1053-settings-home/settings.yaml <<'YAML'
wording:
  locale: zh-CN
YAML
cat > /tmp/d1053-root/settings.yaml <<'YAML'
settings:
  diagnosis:
    gateDataCompleteness: 0.30      # 分类来自代码 registry（live）
  llm:
    baseUrl: "http://old.invalid"   # 分类来自代码 registry（restart）
  rogue:
    whoAmI: 1                       # registry 未声明 ⇒ 强制 restart + undeclared[]
YAML
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | python3 -m json.tool
curl -s "http://127.0.0.1:${PORT}/api/config/dump?orgId=default" | python3 -m json.tool

# ── ④ 路径 A：改 live 键 → 不重启，下一次读取即新值，两消费者同值 ──
sed -i.bak 's/0.30/0.55/' /tmp/d1053-root/settings.yaml
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | grep -c '0.55'          # 期望 ≥1
curl -s "http://127.0.0.1:${PORT}/api/config/dump?orgId=default" | grep -c '0.55'  # 期望 ≥1（第二消费者同值 ⇒ C1）

# ── ⑤ 路径 B：改 restart 键 → 重启前完全无感（旧值持续 + pending 可见 + bootId 不变） ──
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | grep -o '"bootId": *"[^"]*"' | head -1   # 记录 bootId_A
sed -i.bak 's#http://old.invalid#http://new.invalid#' /tmp/d1053-root/settings.yaml
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | grep -c 'old.invalid'  # 期望 ≥1（旧值仍生效）
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | grep -c '"pending"'    # 期望 ≥1（暂存可见）
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | grep -o '"bootId": *"[^"]*"' | head -1   # 期望 == bootId_A（判据 D-BOOT-1 前提）
kill $SRV; sleep 2
SYNOVA_SKIP_MCP=1 npx tsx src/index.ts > /tmp/d1053-server2.log 2>&1 & SRV=$!
sleep 5
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | grep -c 'new.invalid'  # 期望 ≥1（新 boot 后生效）
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | grep -o '"bootId": *"[^"]*"' | head -1   # 期望 != bootId_A

# ── ⑥ 路径 C：未声明键 ⇒ 默认安全 + 三行启动日志（面非空 ⇒ 三行必打） ──
grep -c 'SETTINGS_UNUSED_UNDECLARED'  /tmp/d1053-server2.log   # 期望 ≥1（清单可见，不静默）
grep -c 'SETTINGS_UNDECLARED_SCOPE'   /tmp/d1053-server2.log   # 期望 ≥1（枚举边界声明，R8）
grep -c 'SETTINGS_EXCEPTION_ACTIVE'   /tmp/d1053-server2.log   # 期望 ≥1（CTO-② 例外打印）
kill $SRV; sleep 1

# ── ⑦ 负控：**两条并存**（单元级 = 非 0 exit；进程级 = degraded 不崩死） ──
printf 'settings:\n  bad:\n    x: { applies: sometimes }\n' > /tmp/d1053-root/bad.yaml
# ⑦-a 单元级直调（fail-closed 抛 SettingsSpecError ⇒ 非 0 exit）
SYNOVA_SETTINGS_ROOT=/tmp/d1053-root SYNOVA_SETTINGS_HOME=/tmp/d1053-nonexistent \
  npx tsx -e "import('/Users/wane/SynovaAgent/.synova-wt-squad-d1053/src/config/settings-applies.ts').then(m=>m.loadSettingsSpec())"; echo "⑦-a 期望非 0 exit"
# ⑦-b 进程级（配置面故障不得成为启动故障面：不崩死，返回 degraded + code）
SYNOVA_SKIP_MCP=1 npx tsx src/index.ts > /tmp/d1053-server3.log 2>&1 & SRV=$!
sleep 5
curl -s "http://127.0.0.1:${PORT}/api/healthz" -o /dev/null -w '%{http_code}\n'          # 期望 200（未崩死）
curl -s "http://127.0.0.1:${PORT}/api/settings/effective" | grep -c 'SETTINGS_SPEC_INVALID'  # 期望 ≥1（degraded + code）
kill $SRV; sleep 1

# ── ⑧ 红证不残留 + 工作区干净 ──
grep -rc 'INJECTED-RED-D1053' src/ tests/ | grep -v ':0' || echo "红证 0 命中"
git status --porcelain   # 期望仅本卡声明写集
```

**四件套对应**：①=verify 命令（三套件）｜②=真实入口（真配置面读改 + 真 HTTP 读值 + 健康面）｜③④⑤⑥⑦=改坏即红（M1-M4 + **§八 8.3 的复原哈希一致**）｜`evidence/D1053/*.json`=.json 证据（含「实际执行了哪个套件、跑了几个用例」原始输出）。

> **三条口径更正（实测/裁决，勿抄 PLAN）**：① 健康面 = `/api/healthz`（`src/routes/healthz.ts:323`），**不是** `/healthz`；② 端口**必须显式 `export PORT=<空闲口>`**，不得依赖 `${PORT:-18790}` 形态的隐式默认（F13）；③ 负控判据**两条并存**——单元级直调 `loadSettingsSpec()` 非 0 exit，**且**进程级起服 degraded 不崩死（不是二选一）；④ env 名 = `SYNOVA_SETTINGS_ROOT` + `SYNOVA_SETTINGS_HOME`（R3 定案）；`SYNOVA_SETTINGS_FILE` 与安装目录 env 均已作废（§4.5）。

---

## 交付声明

> 节号 = 计划中的「§十四」。**标题逐字为 `## 交付声明`**：`scripts/control-tower/verify-claims-table.sh`（U4/D423 门禁，`scripts/pre-commit-check.sh:1427` 附挂）用 `^#{2,4}\s*交付声明` 定位本节；标题带序号会**静默跳过**（脚本 exit 0 但不校验）⇒ 标题不得加序号前缀。

| 声称 | 证据命令 | 预期 |
|---|---|---|
| 本次 spec 提交只改 1 个文件 | git diff --stat HEAD | 1 file changed |
| §2.1 声明条数 = 1 | python3 scripts/control-tower/devdoc_writeset.py --extract docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md | cleaned 数组长度 1 |
| 写集表可被门禁提取器解析（零漂移的前提） | python3 scripts/control-tower/devdoc_writeset.py --extract docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md | status=ok 且 cleaned 长度 1（漂移实测见 §2.1 注，跑 bash scripts/workflow/check-dev-doc-write-set.sh 得 声明 1 条 漂移 0） |
| 7 项 + 队长 2 项各自成节且非空 | grep -n "活规格第" docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md | 命中 7 处标题 |
| 三套件定案名与配对门一致 | grep -n "tests/config/settings-applies.test.ts" docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md | 命中 ≥1 |
| 分类表 9 条声明均带实测消费者锚点 | grep -n "src/l3/synova-diagnosis-engine-impl.ts:52" docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md | 命中 ≥1 |
| DSH 现验锚点可核（M3 用现验命令） | git -C /Users/wane/src/deepseek-harness-017 grep -n applies packages/settings/settings/lib/index.js | 命中硬编码 live |
| 既存例外 E1 锚点可核 | grep -n 热重载 src/config.ts | 命中 76 |
| 健康路径实测 | grep -n api/healthz src/routes/healthz.ts | 命中 323 |
| 端口来源实测 | grep -n port synova.json | 命中 18790 |
| js-yaml 借用面实测 | grep -n js-yaml src/config/customer-config-package.ts | 命中 32 |
| 红证标识串已规定为收尾判据 | grep -c INJECTED-RED-D1053 docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md | 计数 ≥1 |
| 分支 tip 已在远端 | git ls-remote --heads origin \| grep d1053 | 命中 6e662bf4 |

> 本表随 spec 提交落盘；实现阶段的交付声明由实现方另行追加（同一节内追加行即可，格式同本表）。

---

## 十五、状态语义（执行方一律不自判结论）

- 链条：**成员 V 独立自验 → 队长「自验结论」 → CTO 收件闸四判据 → K3 终审**。
- 本产出标 **`可提请独立审计`**；**K3 复审完成前不得合并**。有条件 = 未完成。
- 队长只能给：`自验结论` / `可提请独立审计` / `退回（附理由）`。
- 本活规格**不产生**任何"已完成 / 已验收"结论；文中"期望红 / 期望绿"仅描述夹具判据，不是交付状态。

---

*活规格完 · 撰写：成员 S（独立于实现）· spec 阶段交付即回执，不等 impl。*
