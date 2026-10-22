# D870-D 借鉴重核（参照系失效检查）

> 任务：task-4（D870-D 切片）｜执行：coder-d｜M1 专用工作树 `/Users/wane/SynovaAgent/.synova-wt-d870`（分支 `feat/d870-official-baseline-study`）
> 本件唯一可写文件即本文件。**未 commit / 未 push**。所有命令原样可复现，临时脚本落在 `/tmp/d870/`（不入库）。

---

## 〇 表头：参照系（唯一，钉死）与版本错配警示

**参照系（唯一）**

```
/Users/wane/src/deepseek-harness/  @  tag dsh-v0.1.6-alpha.2  @  commit ddefc45fbc7f8e46dd73185e68295696d1297887
```

实测取证（原始输出）：

```
$ git -C /Users/wane/src/deepseek-harness rev-parse HEAD
ddefc45fbc7f8e46dd73185e68295696d1297887
$ git -C /Users/wane/src/deepseek-harness describe --tags --exact-match
dsh-v0.1.6-alpha.2
$ git -C /Users/wane/src/deepseek-harness status --porcelain | wc -l
       0
```

**⚠️ 版本错配警示（四层不同物，禁止互相代入）**

| 层 | 版本 | 本件是否用作参照 |
|---|---|---|
| DSH **checkout 源码树**（`/Users/wane/src/deepseek-harness/`） | **0.1.6-alpha.2**（tag `dsh-v0.1.6-alpha.2`） | ✅ **唯一参照系**（本件全部 `file:line` 均出自此树） |
| DSH **打包运行时**（`~/Library/Application Support/io.github.hairyf.deepseek-harness-desktop/dependencies/dsh/`） | **0.1.6-alpha.1** | ❌ 不作判据；仅在"参照系外路径"分类中登记（见 §4.2） |
| **.app 壳**（`/Applications/Deepseek Harness Desktop.app`） | **0.15.7** | ❌ 不作判据 |
| **updates 已下载** | **0.15.8（未安装）** | ❌ 不作判据 |

> 含义：凡我方文档引用的是 **npm 安装路径**（`~/.nvm/.../node_modules/@deepseek-ai/dsh/**`）或打包运行时路径的，**版本与我方参照系不是同一个断面**，本件按"参照系外路径"登记，不作通过/失效判定。

**硬边界遵守声明**：未改 `src/**`、`scripts/control-tower/**`、`.github/**`；未 commit / push；未引入依赖；官方树只读（本件对官方树只执行 `ls/grep/sed/wc` 只读命令）。

---

## 〇一 前提冻结（开工前逐条实测；不成立即停）

| # | 卡面前提 | 实测命令 | 实测输出摘要 | 判定 |
|---|---|---|---|---|
| P1 | 参照系 = `dsh-v0.1.6-alpha.2` @ `ddefc45`，0 脏 | `git -C …rev-parse HEAD` / `describe --tags --exact-match` / `status --porcelain \| wc -l` | `ddefc45…7887` / `dsh-v0.1.6-alpha.2` / `0` | ✅ 成立 |
| P2 | 两份任务书**当前不在 main**（PR #674 未合） | `ls docs/synova/research/研究院交接-20260918/` ；`git ls-tree -r --name-only origin/chore/ingest-institute` | main：`No such file or directory`；分支：9 个文件（含两件任务书 + 附录件） | ✅ 成立 → **只读 `origin/chore/ingest-institute` 取证** |
| P3 | `gap-line-mapping.yaml` main 可读、59 行、11 项 | `wc -l` ；`grep -c` 结构核对；逐行读 | `59`；`mapping:` 下 11 个 `- gap:` 条目（L16–L59） | ✅ 成立（11/11 可点） |
| P4 | 全仓库引用 `deepseek-harness` 或 `@deepseek-ai` 的文件数 | 冻结口径 `git grep -l -E "deepseek-harness\|@deepseek-ai" HEAD \| wc -l` → **`199`**（canonical）；老 main `3643db6a` → `198`；FS `grep -rl` → **`202`**（不稳定，见下） | 见 §0.2 差异归因 | ✅ 成立，**canonical 基线 = 199**（CTO 2026-09-21 修正：198 为旧 main 口径） |
| P5 | B-11~B-20 = 10 张已定义卡（B-21 是"借卡号起点"，不计） | `grep -n "B-1[0-9]\|B-2[0-9]" 派单-D760-D769-…md` | 定义行 L22–L31（B-11…B-20 各一行）；L33 起是落点说明 | ✅ 成立 |
| P6 | `ledger.json:4953-5008` **只覆盖 B-12~B-17** | `grep -n "B-1[1-9]\|B-20" ledger.json` | `4942=B-11`、`4953=B-12` … `5008=B-17`、`5019=B-18`、`5030=B-19`、`5041=B-20` | ✅ 成立（卡面自陈偏窄，**B-11→:4942 / B-18~B-20→:5019/5030/5041**） |
| P7 | B-20 在 D808 note 明写"未登记" | `grep -n "B-20" memory/notes/implemented/2026-09-17-D808-dsh-borrow-standard.md` | `25:- 待派（本卡登记不改）：B-01…B-10 回写 + 落点归属落 yaml + 4 文件锚点补齐 + B-20(D769) 未登记` | ✅ 成立 |

### 0.2 P4 口径冻结与差异归因（CTO 2026-09-21 修正后照抄复现）

**冻结口径（唯一，tracked-only）**

```bash
cd /Users/wane/SynovaAgent/.synova-wt-d870
git grep -l -E "deepseek-harness|@deepseek-ai" HEAD | wc -l        # → 199
git grep -l -E "deepseek-harness|@deepseek-ai" HEAD | sed 's|^HEAD:||' \
  | awk -F/ '{if($1=="task-state"){print "task-state/*.json"} else if(NF>=2){print $1"/"$2} else {print $1}}' \
  | sort | uniq -c | sort -rn
```

**原始输出（逐目录，合计校验 199）**

```
  69 docs/synova
  47 task-state/*.json
  28 docs/plans
  22 .claude/task-briefs
   6 memory/notes
   6 dsh/plugins
   3 tests/llm
   3 docs/archive
   3 .dsh/skills
   3 .synova/skills
   2 src/llm
   1 tests/store
   1 tests/control-tower
   1 src/store
   1 src/agent
   1 scripts/control-tower
   1 docs/authority
   1 .claude/bypass.log
```

**两个旧口径的差异归因（逐条实测，非估算）**

```
$ git rev-parse 1062ba2f^1 3643db6a
3643db6afdee67766c44265e7a388fd5fa55444b      # 1062ba2f^1 == 老 main
3643db6afdee67766c44265e7a388fd5fa55444b
$ git grep -l -E "deepseek-harness|@deepseek-ai" 3643db6a | wc -l
     198      # ← CTO 给的 198 = 旧 main 口径（#699 合并前）
$ git grep -l -E "deepseek-harness|@deepseek-ai" HEAD | wc -l
     199      # ← canonical：净增 1 = docs/synova/dispatch/D870-官方参照系学习计划-20260921.md（#699）
$ grep -rl -E "deepseek-harness|@deepseek-ai" . --exclude-dir=.git --exclude-dir=node_modules | wc -l
     202      # 文件系统口径：禁用于计数（含未跟踪产物）
$ git status --porcelain
?? docs/synova/research/official-borrowing-recheck.md          # 本件（D 切片产物）
?? docs/synova/research/official-electron-kernel-runtime.md    # A 切片产物
?? task-state/D870.json                                        # 本 session 自产
```

**为什么禁用 FS 口径（本件现场实证，同一会话三次测量）**：`grep -rl` 在同一工作树内 **`200` → `202` → `204`** 连续漂移——因为小队四个切片并行写盘，未跟踪产物不断增加（末次测量 `git status --porcelain` = 5 条 untracked：四份切片产物 + `task-state/D870.json`）。**同一时刻的 FS 计数取决于"谁刚写完"**，不是仓库事实；CTO 侧实测为 `201 vs 199`（差 2），本件实测 `202 vs 199`（差 3）/ `204 vs 199`（差 5）——**每次都对，每次都不能作为分母**。tracked-only 在同一窗口内**恒为 199**（三次测量一致）。

> 同类缺陷已致 A/B/C 三切片密度数字偏高（A `BrowserWindow 77→63`、B `theme 3290→2865`、C `switchModel 132→119`，CTO 实测）——本件一律采用 tracked-only。

**结论**：**canonical 基线 = 199**；第一层"失效清单"的分子/分母一律以 **199** 为基数；`198` 仅作旧 main 断面登记，不再作为口径。

---

## 一 ① 任务书 DSH 借鉴 **14 项**（6+8）逐条核

### 1.1 计数裁定：14 成立，附录件"15 项"判为**源件计数错误**

| 事实 | 出处（**来源未入库**：`origin/chore/ingest-institute` @ `9cce8b87`） | 原文 |
|---|---|---|
| 数据层自证 **6 项缺口** | `任务书-数据与可观测层.md:1` | `# 任务书：数据与可观测层 6 项缺口（DSH 包级取证版）` |
| 信任层自证 **8 项缺口** | `任务书-基础设施与信任层.md:1` | `# 任务书：基础设施与信任层 8 项缺口（DSH 包级取证版）` |
| 附录件写 **15 项** | `可复制-DSH对比与任务书-20260918.md:195` | `四份任务书（3,264 行，15 项 DSH 借鉴 + 12 项自研缺陷）+ 度量方案 + 一个可跑脚本 + 9 条撤回记录。` |

**6+8=14**；两件宿主文件的**章节实体**为 `缺口 1..6`（数据层 L37/195/309/461/598/704）+ `缺口 1..8`（信任层 L34/224/348/506/687/850/1086/1242），**逐条点数为 14，无第 15 项章节实体**。
行数自证：465（总纲）+319（自研缺陷）+902（数据）+1578（信任）= **3264**，与附录件"3,264 行"**精确吻合** → 说明"15"不是行数笔误，而是**项数计错 1**。

**第 15 项候选实体（已核出，单列备查，不并入 14）**：总纲 §3.3 `P2-5 联网检索`（`20260918-可派工任务书-总纲.md`，**来源未入库**；`| P2-5 | 联网检索 | F | 本院 T9 已立项，独立推进 |`）。
- 总纲 §三索引共 **15 行**（P0 4 + P1 6 + P2 5），其中 14 行 1:1 映射两件任务书的 14 项，**第 15 行 = P2-5 联网检索**（无 8 问章节、未列 DSH 参考包）。
- 本件补核：官方**有对应物** `@deepseek-ai/dsh-tool-web`（`packages/web/tool-web`，`web_search`/`web_fetch`）→ 见 §5 `D-11`。
- **按 CTO 裁定仍以 14 收口**；第 15 项实体出处如上，是否补进归 CTO。

### 1.2 十四项逐条核（官方对应物 → 建议 → 官方 file:line）

> **来源标注**：本表 14 行全部取材自 `origin/chore/ingest-institute`（**逐条"来源未入库"，待 CTO 回"可读"后复验**）。
> **核验口径**：① 官方包/文件是否存在（`test -e`）；② 带行号锚点是否落在文件行数内（`wc -l` + `sed -n`）；③ 关键机制是否真有实现（`sed`/`grep` 实读，**不以 grep 命中当"实现存在"的证据**）。

| # | 缺口（任务书） | 官方对应物 | 官方 file:line（实测） | 建议 |
|---|---|---|---|---|
| 数-1 | 指标时序存储〔**来源未入库**〕 | **不存在**（DSH 无时序层） | `packages/storage/storage/lib/index.js:84-86`（"The hub itself performs no IO"）；`packages/storage/storage-domain/README.zh.md:152`（"没有跨表事务、二级索引或多段键"） | **沿用"自建"**；只借写链纪律：`packages/storage/storage-json/lib/index.js:25-40`（tmp→fsync→rename→fsyncDirectory） |
| 数-2 | 会话统计（用量指标）〔**来源未入库**〕 | **存在** | `packages/session/session-stats/lib/types/projection.js:6-11`（`step/end` 为计数权威的原文理由）；全文 `167` 行，与任务书 `:27-167` 锚点一致 | **沿用**；折叠规则可直接照抄，但**前置=我方先补 turn/step 事件** |
| 数-3 | 遥测 / OTel 上报〔**来源未入库**〕 | **存在但性质被否**（不是可观测性层） | `packages/session/session-telemetry-otel/lib/index.js:33`（`DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.FEEDBACK_ONLY`）；同文件 `metric\|trace` 命中数 **0**；`packages/llm/llm-deepseek/lib/index.js:1274`（`"x-deepseek-harness-user-id"`）；`packages/identity/anonymous-user-id/lib/index.js:9-14` | **沿用任务书结论：走 OTel 自研，不借 DSH 遥测** |
| 数-4 | 会话/历史搜索（FTS5）〔**来源未入库**〕 | **存在** | `packages/session-query/session-query-sqlite/lib/index.js`（`1155` 行；`fts5` 命中 14 处；`:82-118` = `ensurePersistentSchema`） | **沿用**（范式复用），租户隔离缺陷属我方（`search()` 缺 org_id，D826，本件不判） |
| 数-5 | 可解释性 / 轨迹〔**来源未入库**〕 | **存在** | `packages/session/session-turn-outline/lib/types/projection.js`（`134` 行，与总纲"134"一致）；`packages/session/session-turn-outline/README.zh.md:42`（`turn` = 宿主分配轮次号）；`packages/client/ui-trajectory/lib/client.js`（`8731` 行） | **沿用**；强前置仍是我方 turn/step 边界 |
| 数-6 | 会话格式迁移链〔**来源未入库**〕 | **存在** | `packages/session/session-format/README.zh.md:58`（"迁移链在构造时校验唯一且无缺口的顺序"）；`packages/session/session-format/lib/index.js`、`-catalog`、`-v0-to-v1` 均在树 | **沿用"范式借用、实现自建"** |
| 信-1 | 运行时不变量机制〔**来源未入库**〕 | **存在（且体量自证）** | `packages/runtime-diagnostics/invariants/lib/index.js` **实测 `wc -l` = 123**（任务书称"123 行"✅）；`:12` `InvariantError`、`:80` `register(packageName, installer)`、`:92` `installInvariant` | **沿用（P0 级）**；`register/install+违约抛错` 是本项核心 seam |
| 信-2 | HTTP 代理 / 内网适配〔**来源未入库**〕 | **存在** | `packages/util/http-proxy/lib/index.js`（`536` 行，与总纲"536"一致）；`:19` `const LOOPBACK_NO_PROXY = [`；`:44` "Everything else is reported, never silently dropped" | **沿用范式**；我方须加"告警 + 健康检查暴露"（不得静默降级） |
| 信-3 | 凭据管理与轮换〔**来源未入库**〕 | **存在（local 明确否决）** | `packages/credentials/credentials/lib/types/types.d.ts:11-46`；`packages/credentials/credentials-local/lib/index.js:343` `renderRecord` / `:549-560` 原子写（`mode 384` = 0600）；`:104` 明文权限告警 | **沿用"借 seam 自建后端"**；`-local` 明文渲染路径**否决** |
| 信-4 | 设置运行时修改〔**来源未入库**〕 | **存在（口径可直接抄）** | `packages/settings/settings/lib/types/index.d.ts:21` `export type SettingsApplies = 'live' \| 'restart';`；`packages/settings/settings/lib/types/redact.js:56-59`（**官方自陈 TODO：fail-closed 未做，union/intersection 可达的 secret 原样返回**） | **沿用**；`live/restart` 分类声明直接借；**脱敏 fail-closed 官方自己也没做**，勿照抄为"已解决" |
| 信-5 | Webhook / 事件订阅〔**来源未入库**〕 | **存在（入站，非出站）** | `packages/webhook/webhook/lib/types/types.d.ts:2`（"Provider-neutral webhook **deliveries**"）；`packages/webhook/webhook/lib/types/brand.d.ts:4/6/8`（Rule/Source/Delivery 三 id）；`packages/webhook/webhook-github/lib/types/handler.js:72`（`x-hub-signature-256`）、`:81`（`new Webhooks({secret}).verify(body, signature)`） | **沿用：5a 入站借范式 / 5b 出站自建**（官方无出站订阅） |
| 信-6 | 超长输出 / 溢出〔**来源未入库**〕 | **存在（三件套 + 截断披露）** | `packages/spill/spill/lib/index.js:22-51`；`packages/spill/spill-local/lib/index.js:17`（`DEFAULT_ROOT_PREFIX = "dsh-spill-"`）；`packages/spill/spill-policy/lib/index.js:8`；`packages/util/output-retention/lib/index.js:109` `trimTrailingPartialUtf8` / `:261` `describeOmitted` | **沿用**；我方缺口=「有截断、无账本」→ `describeOmitted` 正是账本范式 |
| 信-7 | 时间 / 日期上下文〔**来源未入库**〕 | **部分存在**（"给模型一只时钟"有；"数据时点"无） | `packages/context/time-context/lib/index.js:68` `createTimestampFormatter`（`250` 行）；同包 `asOf\|dataTimestamp\|数据时点` 命中 **0** | **沿用 7a 范式复用 / 7b 数据时点自建** |
| 信-8 | 文档格式转换〔**来源未入库**〕 | **存在但为不可用桩** | `packages/experimental/webworker-runtime/src/node/external_packages/libreoffice-kit.ts`（**12 行**，`createConverter()` 直接 `notAvailableError('@deepseek-ai/libreoffice-kit','createConverter')`）；引用点 `replaced-externals.ts:12`、`module-proxies.ts:68` | **沿用"不采用 libreoffice-kit"**；官方树内**无真实实现**，与我方"客户侧转 PDF"路线一致 |

**统计**：14/14 项**全覆盖**；Tier-A 显式路径引用 **217 处 / 36 个包，路径存在 217/217**；带行号锚点 **134 处，行号越界 0**。

### 1.3 行号锚点漂移清单（代码块级：`// dsh-<pkg>/<path>:<line>`）

命令：`python3 /tmp/d870/drift.py`（抽取任务书代码围栏首行锚点 → `sed` 对读官方行）。原始输出（18 行，节选关键列）：

```
Counter({'MATCH': 9, 'MISMATCH': 9})
[MATCH]    taskbook-infra-trust.md:62 dsh-invariants/lib/index.js:80       claim=register(packageName, installer) {   actual=register(packageName, installer) {
[MATCH]    taskbook-infra-trust.md:71 dsh-invariants/lib/index.js:92       claim=const installInvariant = (childCtx) => installer(childCtx, (message) => {  actual=同
[MISMATCH] taskbook-infra-trust.md:139 dsh-agent-loop/lib/invariant.js:24  claim=const expected = session.deriveMessages();   actual=const header = foldRequestHeader(events);
[MATCH]    taskbook-infra-trust.md:247 dsh-http-proxy/lib/index.js:390     claim=return new Agent({ factory(origin, options) {  actual=同
[MISMATCH] taskbook-infra-trust.md:519 dsh-settings/lib/types/index.d.ts:20  claim=export type SettingsApplies = 'live' | 'restart';  actual=/** When a namespace's changes take effect for its owner. */
[MISMATCH] taskbook-infra-trust.md:527 dsh-settings/lib/types/index.d.ts:49  claim=export interface SettingsDescriptor {        actual=/** One registered namespace as surfaced to configuration UIs. */
[MISMATCH] taskbook-infra-trust.md:575 dsh-settings/lib/types/redact.js:56    claim=default:                                     actual=// TODO(settings-wire-redaction): Fail closed instead — …
[MISMATCH] taskbook-infra-trust.md:712 dsh-webhook/lib/types/types.d.ts:2     claim=/** Provider adapters add their normalized … */  actual=import type { JsonValue } from '@deepseek-ai/dsh-util-values';
[MISMATCH] taskbook-infra-trust.md:750 dsh-webhook-github/lib/index.js:161    claim=const Config = z.object({                     actual=/** Host services required before the exact route can register. */
[MATCH]    taskbook-infra-trust.md:882 dsh-output-retention/lib/index.js:109 claim=function trimTrailingPartialUtf8(bytes) {     actual=同
[MISMATCH] taskbook-infra-trust.md:899 dsh-output-retention/lib/index.js:85  claim=return {                                     actual=finish() {
[MATCH]    taskbook-infra-trust.md:909 dsh-output-retention/lib/index.js:261 claim=function describeOmitted(omitted, unit) {    actual=同
[MISMATCH] taskbook-infra-trust.md:922 dsh-output-retention/lib/index.js:12  claim=* In particular `RetainedText.truncated`/…      actual=* In particular {@link RetainedText.truncated}/{@link …
[MATCH]    taskbook-infra-trust.md:1113 dsh-time-context/lib/index.js:68      claim=function createTimestampFormatter(timeZone) {  actual=同
```

**漂移量化**（`grep` 反查 claim 文本在官方文件的实际行 → 求差）：

```
agent-loop/lib/invariant.js        :24   -> 实际 26   drift=+2
settings/lib/types/index.d.ts      :20   -> 实际 21   drift=+1
settings/lib/types/index.d.ts      :49   -> 实际 50   drift=+1（同文件另有一处 75 为同名局部声明）
settings/lib/types/redact.js       :56   -> 实际 55   drift=-1
webhook/lib/types/types.d.ts       :2    -> 实际 4    drift=+2
webhook-github/lib/index.js        :161  -> 实际 167  drift=+6     ← 最大漂移
output-retention/lib/index.js      :85   -> 候选 87   drift=+2（`return {` 在 69/75/87/202 多处，需人工锚定）
（2 行 MISMATCH 为表格散文非代码锚点：http-proxy 行 267、output-retention 行 922 的 `{@link}` 渲染差异）
```

**分类**：**内容全部存在，无一处"官方无此物"**；问题为**行号漂移 1–6 行**（6 处可量化）+ 2 处非代码锚点误判 + 1 处歧义锚点。
**建议**：任务书锚点**可沿用**（内容可核），但引用时须**重新锚定**（本件已给实测行号）；把"锚点漂移 ≤6 行"登记为已知精度边界。

### 1.4 附录件 §二 **9 项撤回清单**逐条核（**来源未入库**）

出处：`可复制-DSH对比与任务书-20260918.md:46-56`（表头 `| # | 已作废的说法 | 修正后 | 为什么 |`）。

| # | 撤回项（§二 原文要点 · **逐条来源未入库**） | 本次实测（命令/输出） | 判定 |
|---|---|---|---|
| 1 | engine-core 已彻底退役：目录不存在、非注释引用 0、无依赖、动态 import 零〔**来源未入库**〕 | `ls -d packages/engine-core` → `No such file or directory`；`grep -rn engine-core src/ packages/ --include='*.ts' \| grep -v '\.test\.'` → 64 命中，**逐条看全为注释/JSDoc**；非注释行过滤 `grep -vE ':\s*(//\|\*\|/\*)'` → **0**；`grep "from .*engine-core\|require(.*engine-core"` → **0**；`package.json` 无依赖 | ✅ **成立** |
| 2 | 路径 A 已被施工图改为"A 形态"（核心独立服务 + MCP 边界）〔**来源未入库**〕 | `docs/synova/research/DSH迁移施工图-20260820/` 下 `DSH迁移施工图-20260820.md`、`DSH施工图-一页纸大纲-20260820.md` 均含"A 形态"表述 | ✅ **成立（文档级）** |
| 3 | 有机制（pre-commit 组 4 接线完整性），但判据是 grep〔**来源未入库**〕 | `grep -n 接线完整性 scripts/pre-commit-check.sh` → `:27`（组清单）、`:643`（`# 组 4: 接线完整性`）、`:653`（`echo 组 4/13`） | ✅ **成立** |
| 4 | 26 线"覆盖了参数配置，缺标定与跨客户收敛"（称 `标定`/`transfer_function`/`42 边`/`因果` 全 0）〔**来源未入库**〕 | `docs/synova/product-lines/product-lines.yaml`：`阈值`=**15**、`标定`=**5**、`transfer_function`=**3**、`因果`=**2** | ⚠️ **撤回项自身前提已过期**：四个关键词**均已非 0**；"全 0"表述**不再成立**，须重核（不推翻结论方向，但数字须更新） |
| 5 | libreoffice-kit 源码可得性"瑕疵"收窄；适配器 `.ts` 不在 tarball〔**来源未入库**〕 | 官方树内该名只出现在 webworker-runtime 的**桩**：`external_packages/libreoffice-kit.ts`（12 行，`notAvailableError`）、`replaced-externals.ts:12`、`module-proxies.ts:68` | ✅ **与"适配器 .ts 不在 tarball"一致**；官方树内**无真实实现** |
| 6 | DSH 全家族没有时序存储〔**来源未入库**〕 | §1.2 数-1 两条官方原文（hub 不执行 IO / 无跨表事务·二级索引·多段键） | ✅ **成立** |
| 7 | DSH telemetry 不是可观测性层，是默认关闭的日志外发管道〔**来源未入库**〕 | `DEFAULT_TELEMETRY_MODE = SessionTelemetryMode.FEEDBACK_ONLY`（`:33`）；包内 `metric\|trace` 命中 **0** | ✅ **成立** |
| 8 | 该学前端架构，不抄界面（界面会露出工作区/文件树/终端）〔**来源未入库**〕 | 官方 client 包实测含：`packages/client/ui-sidebar-files`、`packages/client/ui-sidebar-terminal`、`packages/client/ui-workspace`、`packages/client/ui-directory-picker-native` | ✅ **成立**（且给出包级证据） |
| 9 | 26 线是不完整的"单客户纯软件"产品定义（缺参数标定/多客户/被验证 + 咨询交付裂缝）〔**来源未入库**〕 | `product-lines.yaml`：`续费`=**0**、`咨询交付`=**0**、`交付`=**0**、`咨询`=**0**；`被验证`=1、`多客户`=3 | ✅ **成立**（"咨询交付裂缝"关键词仍全 0） |

**9/9 逐条覆盖**；其中 **#4 需复验更新**（关键词已非 0）。

---

## 二 ② 11 项归线（`docs/synova/product-lines/gap-line-mapping.yaml`，main 可读）

前提实测：`wc -l` = **59**（卡面 59 ✅）；`mapping:` 下 **11 个 `- gap:` 条目**（L16–L59）✅。

| # | gap（yaml 行） | note 点名的 DSH 包/机制 | 参照系核对（官方 file:line） | 官方对应物 | 建议 |
|---|---|---|---|---|---|
| 1 | 遥测 / OTel（L16-19） | "DSH 的不是可观测性层（默认关闭的日志外发管道）" | `packages/session/session-telemetry-otel/lib/index.js:33`；包内 metric/trace = 0 | 存在但**性质与 note 一致** | **沿用**（自建走 OTel） |
| 2 | 会话统计（用量）（L20-23） | `dsh-session-stats` 字段口径；"两处零接线"属我方 | `packages/session/session-stats/lib/types/projection.js:6-11`（全文 167 行） | 存在 | **沿用** |
| 3 | 会话搜索（FTS5）（L24-27） | 未点名 DSH 包（仅我方 `search()` 缺 org_id，D826） | `packages/session-query/session-query-sqlite/lib/index.js`（1155 行，`fts5` ×14） | 存在（note 未引，**建议补包名锚点**） | **沿用** |
| 4 | 超长输出 / spill（L28-31） | "与 tool-result-pruner 的先后顺序须先冻结；两个 cap 数字待产品决定" | `packages/spill/spill-policy/lib/index.js:8`；`packages/util/output-retention/lib/index.js:109/261` | 存在 | **沿用**（顺序问题仍待产品决定，非 DSH 侧风险） |
| 5 | 凭据管理（L32-35） | `dsh-credentials-local` 明文落盘，明确否决 | `packages/credentials/credentials-local/lib/index.js:343`（`renderRecord` 渲染文本落盘）、`:104`（权限告警）、`:549-560`（原子写 mode 0600） | 存在 | **沿用否决**（"明文"措辞精确化：**渲染文本 + 0600 权限**，非加密） |
| 6 | 文档格式转换（L36-39） | `libreoffice-kit` 不采用（许可义务 + Linux 无原生包） | 官方树内为 **12 行不可用桩**（`experimental/webworker-runtime/src/node/external_packages/libreoffice-kit.ts`） | 存在但**不可用** | **沿用"客户侧转 PDF"** |
| 7 | 联网检索（L40-43） | 未点名 DSH 包（"研究院 T9 已立项"） | `packages/web/tool-web`（`@deepseek-ai/dsh-tool-web`，`web_search`/`web_fetch`） | **存在（note 漏引）** | **改 note**：补 `dsh-tool-web` 锚点，避免"联网检索无参照"的误读 |
| 8 | 设置运行时修改（L44-47） | `live/restart 分类声明` | `packages/settings/settings/lib/types/index.d.ts:21` `SettingsApplies = 'live' \| 'restart'` | 存在 | **沿用** |
| 9 | Webhook / 事件订阅（L48-51） | "DSH 的 webhook 是入站，我方需求偏出站" | `packages/webhook/webhook/lib/types/types.d.ts:2`（deliveries 入站）；三 id 见 `brand.d.ts:4/6/8` | 存在（**入站**） | **沿用**（5b 出站自建） |
| 10 | 时间上下文（L52-55） | "7a 范式复用 / 7b 数据时点自建" | `packages/context/time-context/lib/index.js:68`；`asOf\|dataTimestamp\|数据时点` = **0** | 部分存在 | **沿用** |
| 11 | 可解释性 / 轨迹（L56-59） | "强前置：事件流缺 turn/step 边界" | `packages/session/session-turn-outline/lib/types/projection.js`（134 行）；`README.zh.md:42`（turn 号） | 存在 | **沿用** |

**11/11 全覆盖**；发现 **1 处 note 需改**（#7 联网检索漏引官方对应物）、**1 处措辞需精确化**（#5 "明文落盘"）。

---

## 三 ③ 借鉴卡 B-11 ~ B-20（**10 张**）

**卡号口径**：B-21 = 借卡号起点、非已定义卡，**不计入**（其唯一落点 `docs/authority/产品完成度定义与推进总纲-20260918.md:279`，本件未将其计入 10 张）。

**台账行号自定位（实测，修正卡面"只覆盖 B-12~B-17"的偏窄描述）**：

```
$ grep -n "B-1[1-9]\|B-20" docs/synova/project/ledger.json
4777: "title": "（作废）计划表占位号（『补定义 B-11~B-20』）…"      ← 作废占位号
4942: B-11 (D760)   4953: B-12 (D761)   4964: B-13 (D762)   4975: B-14 (D763)
4986: B-15 (D764)   4997: B-16 (D765)   5008: B-17 (D766)   5019: B-18 (D767)
5030: B-19 (D768)   5041: B-20 (D769)   5052: 登记卡（B-11~B-20 为看板任务）
```

| 卡 | D# | 卡内容（台账 L22–L31 定义行） | 官方锚点核对（方式=实读，非 grep 命中） | 判定 |
|---|---|---|---|---|
| B-11 | D760 | MCP client 双 transport（stdio/StreamableHTTP）+ 工具表变更通知重载 + 子进程环境擦除 | `packages/mcp/mcp-client/lib/index.js`（835 行）：`:4` `StreamableHTTPClientTransport`、`:6` `StdioClientTransport`、`:7/:28` `scrubbedParentEnv()`（来自 `dsh-subprocess`） | ✅ **存在** |
| B-12 | D761 | webhook 事件触发路（source/rule/delivery 三 id + provenance + **GitHub HMAC 验签**） | 三 id：`packages/webhook/webhook/lib/types/brand.d.ts:4/6/8`；**HMAC 实读**：`packages/webhook/webhook-github/lib/types/handler.js:72`（读 `x-hub-signature-256`）、`:81`（`new Webhooks({secret}).verify(body, signature)`） | ✅ **存在**（注：验签**不在** `lib/index.js`，而在 `lib/types/handler.js`；`createHmac` 仅存于 tests——**"grep 不到"不等于"没实现"**） |
| B-13 | D762 | goal 事件溯源四件套（foldGoal 投影 + 轮驱竞态围栏 + tool-goal authority） | `packages/goal/goal-round-driver/lib/index.js:54`（"Install automatic same-session continuation and its race fences."）、`:167`（step fence 竞态）；`goal-round-driver/lib/invariant.js:30` `foldGoal(events)`；`packages/goal/goal/lib/types/runtime.js:4` `GOAL_CHANGE_VERSION = 1` | ✅ **存在** |
| B-14 | D763 | 消息级反馈 sidecar（域 spec + schema 族 + 会话指纹围栏 createdAt+cwd） | `packages/feedback/message-feedback/lib/index.js:61-69`（`createdAt`/`updatedAt` refine + `sessionId` schema） | ✅ **存在**；⚠️ 指引写 `types/{spec,types}.js`，**实测无 `spec.js`**（包内为 `lib/types/{index,types}.js`）→ **锚点需改** |
| B-15 | D764 | 权限预设写穿（预设=旋钮打包 sandbox-mode+approval-policy；预设不做第二真相源） | `packages/interaction/permission-presets/lib/index.js:185`（未限定执行器即报错的原文）、`:310/:369/:400` `sandboxMode` 写穿 | ✅ **存在** |
| B-16 | D765 | 不可信上下文标注（跨会话引用 URI 编解码 + 大小上限 + 候选限流） | `packages/context/session-reference/lib/index.js:94` `MAX_REFERENCES = 3`、`:98` `DEFAULT_MAX_REFERENCE_BYTES = 65536`、`:519` `listCandidates(agent, query, limit = candidateLimit)`、`:520` 非正 limit 抛错 | ✅ **存在** |
| B-17 | D766 | skill provider 两阶段触发（dispatcher 主动发现 + 模型主动拉取） | `packages/skill/skill/lib/index.js:7`（"Agent skill provider registry."）、`:11-12`（provider 决定来源，service 只合并 catalog）；`dsh-skill-filesystem`/`dsh-tool-skill` 均在树 | ✅ **存在** |
| B-18 | D767 | 运行时不变量注册表（`InvariantRegistry`；检查可选、违约必炸） | `packages/runtime-diagnostics/invariants/lib/index.js`（**123 行**，独立 `wc -l` 复核与指引"123 行"一致） | ✅ **存在** |
| B-19 | D768 | 持久化分级准则（"按死后是否需要复活选路线"：schedule vs jobs 对照） | `packages/jobs/jobs/README.zh.md:53`（"随 harness 进程终止而消失；跨重启的持久执行需要一个实现本约定的不同后端"）；`packages/schedule/schedule/README.zh.md:12`（"提醒在重启后仍然存在，但交付需要 live 根 agent"） | ✅ **存在，且原文即准则本身** |
| B-20 | D769 | 速览族六项（output-retention / repeat-tool-reminder / scrubbedParentEnv / time-context / session-query-sqlite / session-checkpoint-policy） | 六个机制逐项存在：`util/output-retention/lib/index.js:109/261`、`util/repeat-tool-reminder`、`mcp/mcp-client/lib/index.js:7`（`scrubbedParentEnv`）、`context/time-context/lib/index.js:68`、`session-query/session-query-sqlite/lib/index.js`、`session/session-checkpoint-policy` | ✅ **六项全在；但"未登记"如实保留**（见下） |

**B-20 未登记（如实记录，不补）**：
- `memory/notes/implemented/2026-09-17-D808-dsh-borrow-standard.md:25` 原文：`…+ B-20(D769) 未登记`；
- `docs/synova/coordination/board-backlog.json:304-307`：`"title": "借鉴卡 B-20 未登记（D760…D768 已覆盖 B-11…B-19，D769 空号）"`，`severity: P2`，`source: D808 实测（2026-09-17）`。
- 台账 `ledger.json:5041` 有 B-20 行（D769，`claimed`），**与"未登记"不矛盾**：ledger 有卡行，缺席的是"task-state 登记 + 验收点绑定"。
- **B-19 是 10 张里唯一有 note 的卡**：`memory/notes/implemented/2026-09-06-d580-ticket-dedup-persistence.md`（本件核对存在）。

**范式来源行修正**：卡面给的是 `DSH借鉴指引-v2-20260904.md:96-101`，实测该区间**只覆盖 B-12~B-17**；**B-11 在 :95、B-18 在 :102、B-19 在 :103、B-20 在 :104**（完整区间 = **:95-104**）。

**10 张卡台账状态**：`ledger.json` 中 D760–D769 全部 `status: claimed`、`owner: null`（行号 4941/4952/…/5040 的 `id` 行）。

---

## 四 ④ 所有引用 DSH 路径的产物（两层都做）

### 4.1 第一层（全量 100%）：脚本化抽取 + 官方树 `test -e`

**命令（原样可复现，tracked-only = 冻结口径）**

```bash
# 1) 抽取集（唯一口径）：tracked-only @ HEAD = 199
cd /Users/wane/SynovaAgent/.synova-wt-d870
git grep -l -E "deepseek-harness|@deepseek-ai" HEAD | sed 's|^HEAD:||' | sort > /tmp/d870/fs_all.txt
wc -l < /tmp/d870/fs_all.txt        # → 199
# 2) 抽取被引路径（4 形态：绝对路径 / deepseek-harness/<p> / Windows 反斜杠 / @deepseek-ai/<pkg>）
python3 /tmp/d870/layer1.py
# 3) 逐条在参照系树 test -e（脚内 os.path.exists ≡ test -e；结果见下表）
```

**原始输出（`layer1.py`，tracked-only 199）**

```
files scanned: 199 mentions: 219
== status counts ==
   157 EXISTS
    55 PKG_NOT_IN_TREE      # 55 条里 52 条是裸 `@deepseek-ai/dsh`（伞包，映射到 apps/cli 后 EXISTS）
     4 MISSING
     3 OUT_OF_REF
unique (tag,norm): 81
```

**修正伞包映射后（`@deepseek-ai/dsh` → `apps/cli`；实测 `apps/cli/package.json:2` `"name": "@deepseek-ai/dsh"`）终态**

```
mentions: 219  [('EXISTS', 209), ('MISSING', 4), ('OUT_OF_REF', 3), ('PKG_NOT_IN_TREE', 3)]
unique:    81  [('EXISTS', 71), ('MISSING', 4), ('OUT_OF_REF', 3), ('PKG_NOT_IN_TREE', 3)]
```

**覆盖面（分子/分母一律 = 199）**：**199/199 文件全量扫描**；**219 条提及**、**81 条唯一路径引用**逐条判定。
**未达标差异如实登记（不凑数）**：CTO 冻结口径分母 199 = 本件实扫 **199**，**一致**。差异只出现在**旧口径**：本件先前用 FS 口径实扫 **200**（多 1 = 未跟踪 `task-state/D870.json`，其唯一贡献是一条 `ROOT_DIR` 提及，**不含任何路径引用**）→ 该差异**不影响失效清单分子**：FS 200 与 tracked 199 两个断面下，`MISSING/PKG_NOT_IN_TREE/OUT_OF_REF` **完全相同（4/3/3）**，唯一变化是 `ROOT_DIR 1 → 0`。

### 4.2 失效清单（**11 条**，三分类）

| # | 分类 | 引用（我方 file:line） | 被引路径/包 | 实测 | 处置建议 |
|---|---|---|---|---|---|
| 1 | **路径不存在** | `docs/synova/research/专家架构重定义与权威口径审计-20260905/附录-证据清单-20260905.md:42` | `D:\deepseek-harness\apps\cli\config\agent-presets\standard\agent.cordis.yml` | `apps/cli/config/` 下**只有 `examples/`** → **MISSING** | **已改名/已迁移**：官方预设落点 = `packages/preset/agent-presets/presets/standard/agent.cordis.yml`（实测存在）→ 修引用 |
| 2 | **路径不存在** | 同上 `:43` | `D:\deepseek-harness\apps\cli\config\agent-presets\` | **MISSING** | 同上；且 H-03 列的四档 `standard/minimal/cordis/**code**`：官方实测 `presets/` = `cordis`/`minimal`/`ptc`/`standard`，**无 `code`** → 内容也需修 |
| 3 | **已改名** | `.claude/task-briefs/2026-09-08-D598-token-meter-cost-guardrail.md:18`、`:70` | `packages/llm/llm-deepseek/lib/types/translate.js` | **MISSING**；现存 `lib/types/protocols/messages/translate.js`、`lib/types/protocols/chat-completions/translate.js` | **改路径**（下移到 `protocols/` 子目录）；`mapUsage` 语义须在新路径重核 |
| 4 | **语义变更（省略写法）** | `.claude/task-briefs/2026-09-07-D587-win-tool-result-pruner.md:65` | `D:/deepseek-harness/.../compaction-tool-result-pruner/lib/index.js` | 省略号路径本身 `test -e` 失败；**真路径 EXISTS** | **非失效**：改写成全路径 `packages/compaction/compaction-tool-result-pruner/lib/index.js:7/24/32/90`（本件已代核，:7 = `/** Fixed marker substituted for every removed middle span. */`） |
| 5 | **语义变更（行号漂移）** | `.claude/task-briefs/2026-09-20-D811-队列收口.md:26` 等 | `packages/compaction/compaction-basic/lib/index.js` | 文件 EXISTS；带行号引用存在 **±1~±6 行漂移**（见 §1.3） | **改锚点**；引用处补"锚点重建"纪律 |
| 6 | **语义变更（换行/排版）** | `docs/synova/coordination/D852-V1-轻量变更单-20260920.md:85`（同型另有 `D852-派单回执:103-104`、`D852-live-restart-清单:6`、`SYNOVA-IMPL-DSH-D590-…:355`） | `packages/{compaction-basic,compaction-tool-result-pruner,llm-retry,session-projection,util/timeout}/**` | 5 个文件全部 EXISTS；但引用写法是**一行内多文件共用一个行号序列**（`:85,102,161,245,288`），机械核验**不可判定**（26 组配对中 7 组行号越界/错配） | **改写法**：一行一锚点（`<file>:<line>` 单一配对），否则无法机械复验 |
| 7 | **路径不存在（包名）** | `docs/synova/coordination/dsh-cto-draft/agent.cordis.yml:271` | `@deepseek-ai/dsh-workflow-worker-thread` | **PKG_NOT_IN_TREE 保留，口径 =「官方 workspace（`packages/**/package.json`）无此包名」**；但**官方确有该名**：登记于 `docs/dependency-catalog.json:3196` 为**外部依赖**（`version: 0.1.5-rc.2`、`location: node_modules/@deepseek-ai/…`、`direct: true`；catalog 顶层 = 官方 `@deepseek-ai/dsh` `0.1.5-rc.1`、`capturedAt 2026-09-12`；当前磁盘该目录 **MISSING**） | **该名不是幽灵名**：我方草稿引用它 = **直接依赖官方发布包**，与 **G1 守卫**（`grep -rn "@deepseek-ai" src/ packages/` = 0）的冲突面须核 → **核该依赖的必要性与 G1 合规性；若确需该能力，按"复制实现思路、不引入依赖"重写，而非改自研命名** |
| 8 | **路径不存在（截断/glob）** | `docs/synova/coordination/派单-L1切片C-D527-D528-20260825.md:15` | `@deepseek-ai/dsh-client-ui-*`（写作 `dsh-client-ui-`） | 通配写法，非可解析包名 | **改写法**：给出完整包名清单（官方 `packages/client/ui-*` 实测 47 个族） |
| 9 | **路径不存在（第三方）** | `dsh/plugins/synova-dashboards/package.json:25` | `@deepseek-ai/dsh-client-runtime` | 全树**无此名**；最近似为 `dsh-client-test-runtime`（`packages/test-support/client-runtime`），**非同物** | 我方插件依赖声明需核（是否应为 `dsh-client-test-runtime` 或 `dsh-client-modules`） |
| 10 | **参照系外（不计入失效）** | `docs/synova/research/DSH迁移施工图-20260820/DSH借鉴指引-v2-20260904.md:26` 等 3 处 | `…/dependencies/dsh/node_modules/@deepseek-ai/{dsh,dsh-llm,dsh-hook-protocol}` | 属**打包运行时（0.1.6-alpha.1）**，不在参照系树 | **单列**：判定"失效"会张冠李戴；引用须明标"打包运行时断面" |
| 11 | **参照系外（第三方框架）** | `dsh/plugins/synova-dashboards/lib/index.js:27`、`dsh/plugins/task-board-adapter/lib/index.js:59` | `@deepseek-ai/cordis` | 官方树 **EXISTS = `vendor/cordis`**（修正：**不是**失效项，映射后 EXISTS） | 无需处置（保留登记） |

**#7 复核命令（原样可复现；`R=/Users/wane/src/deepseek-harness`）**

```bash
R=/Users/wane/src/deepseek-harness
find $R/packages -maxdepth 3 -name package.json -not -path '*/node_modules/*' | wc -l
#   → 291        （packages/** 非 node_modules 的 manifest 数）
grep -rho '"@deepseek-ai/[a-z0-9-]*"' $(find $R/packages -maxdepth 3 -name package.json -not -path '*/node_modules/*') | sort -u | wc -l
#   → 302        （上述 manifest 声明的 @deepseek-ai/* 唯一名）
grep -rl 'dsh-workflow-worker-thread' $R --include=package.json | wc -l
#   → 0          （**package.json 口径**：全树 manifest 中 0 命中 → 仅证「workspace 无此包名」，不等于「官方无此名」）
grep -n 'dsh-workflow-worker-thread' $R/docs/dependency-catalog.json
#   → 3196:      "name": "@deepseek-ai/dsh-workflow-worker-thread",
#     3200:          "location": "node_modules/@deepseek-ai/dsh-workflow-worker-thread",
#   （官方 @deepseek-ai/dsh 依赖清单快照把它登记为**已安装外部依赖** @0.1.5-rc.2 / direct:true；
#     同一口径下 catalog 的 @deepseek-ai/* 条目数 = 243： grep -c '"name": "@deepseek-ai/' → 243）
```
> **数字口径修正（CTO 2026-09-21 解除冻结小修）**：本行原写「全树 package.json（**597 键**）」——经复核，597 是**本件抽取脚本的中间产物**（`/tmp/d870/pkgmap.txt` 291 + `/tmp/d870/pkgmap_full.txt` 306，同一包在"短名键/全名键"两种键形下各计一次），**不是任何仓库真值口径、不可复现**，已删除并替换为上表可复现数字（291 / 302 / 0）。

> **三分类计数（分母 = 199 文件 / 81 条唯一引用）**
> · **路径不存在**：**5 条** = `apps/cli/config/agent-presets*` 2 条（#1/#2）+ 包名/通配 3 条（#7 `@deepseek-ai/dsh-workflow-worker-thread`、#8 `@deepseek-ai/dsh-client-ui-` 通配、#9 `@deepseek-ai/dsh-client-runtime`）
> · **已改名/已迁移**：**3 条**（#1 落点→`packages/preset/agent-presets/presets/standard/agent.cordis.yml`；#2 落点→`presets/`（且官方**无 `code`** 档，实测 `cordis/minimal/ptc/standard`）；#3 `llm-deepseek/lib/types/translate.js`→`lib/types/protocols/{messages,chat-completions}/translate.js`）
> · **语义变更**：**3 条**（#4 省略写法、#5 行号漂移 ±1~±6、#6 "一行多锚点"写法不可机械核验）
> · **参照系外（单列，不计入失效）**：**2 条**（#10 打包运行时路径 ×3 提及、#11 映射后实为 EXISTS 的第三方 `vendor/cordis`）
>
> **精确口径（对账用，tracked-only 199）**：唯一路径引用中 `MISSING` **4 条**、`PKG_NOT_IN_TREE` **3 条**、`OUT_OF_REF` **3 条**、`ROOT_DIR` **0 条**（FS 口径下曾为 1 条，来自未跟踪的 `task-state/D870.json`，已随口径冻结剔除）；其余 **71 条 EXISTS**。上表 11 行为"问题 + 写法类问题"的合并视图（含 2 条属我方文书写法而非官方失效）。

### 4.3 第二层（人工语义）：全量组 + 抽样率

**覆盖面（实测，非估算）**

| 组 | 总体文件数 | 本次核 | 覆盖率 | 说明 |
|---|---|---|---|---|
| `skills/**`（`.synova/skills` + `.dsh/skills`） | **30** | **30** | **100%** | 6 文件有 DSH 引用（cto-handover 29 命中 / dsh-decision-lens 8 / pr-review 1 / dev-doc-delivery 1 + 模板 2，两树镜像），24 文件**零引用** |
| `task-state/**` | 47 | **47** | **100%** | 全部为 `@deepseek-ai` 裸提及（G1 守卫字样 / 参照系声明），**无路径引用 → 无失效面** |
| `docs/synova/coordination/**` | 41 | **41** | **100%** | 含 `dsh-cto-draft/agent.cordis.yml`（27 引用，1 问题）、`dsh-preset-draft/`、`dsh-audit-draft/`、`dsh-devdoc-draft/` |
| `scripts/**` | 1 | **1** | **100%** | `scripts/control-tower/install-dsh-preset.sh`（`:85-87` 目标布局 = `config/agent-presets/standard`，**与官方树实际落点不符** → 见 §4.2 #1/#2） |
| 预设相关 | — | — | **100%** | `.dsh/.agent-presets/**`、`.claude/presets`、`.dsh/presets` **均不存在**（实测）→ 仓库侧实体 = `docs/synova/coordination/dsh-preset-draft/` + 上述脚本 + 其测试 |
| **全量组合计** | **95** | **95** | **100%** | — |
| `docs/plans/**` | 28 | 3 | 11% | 抽样 |
| `.claude/task-briefs/**` | 22 | 3 | 14% | 抽样 |
| `docs/synova/**`（非 coordination/research） | 16 | 2 | 12% | 抽样 |
| `docs/synova/research/**` | 12 | 2 | 17% | 抽样 |
| `docs/archive/**` | 3 | 1 | 33% | 抽样 |
| `memory/notes/**` | 6 | 1 | 17% | 抽样 |
| `dsh/plugins/**` | 6 | 1 | 17% | 抽样 |
| `tests/**` | 5 | 1 | 20% | 抽样 |
| `src/**` | 4 | 1 | 25% | 抽样 |
| `other`（`.claude/bypass.log`、`docs/authority/…`） | 2 | 2 | 100% | 抽样 |
| **抽样组合计** | **104** | **17** | **16.3%** | 门槛 ≥10% ✅ |

**总体覆盖率**：**112 / 199 = 56.3%**（全量组 95 + 抽样组 17）；**抽样率 = 17/104 = 16.3%**（≥10% 门槛 ✅）。
> 分母口径：**199 = tracked-only（`git grep × HEAD`）**，与 §0.2 冻结口径一致。`skills/**` 的 30 文件全量核属**目录级全扫**（其中仅 6 文件命中关键词、进入 199 集），故不计入上表分母。

**抽样判定（逐文件，cites = 路径引用数，problems = 失效数）**

```
OK    .synova/skills/cto-handover/SKILL.md                        cites=2  problems=0
OK    .synova/skills/dev-doc-delivery/template/编码指令模板.md    cites=1  problems=0
OK    .synova/skills/dsh-decision-lens/SKILL.md                   cites=0  problems=0
OK    .claude/task-briefs/2026-08-22-D473-guard-loop-hygiene.md   cites=2  problems=0
OK    .claude/task-briefs/2026-09-08-D592-L1-P1对话E2E场景.md     cites=0  problems=0
OK    .claude/task-briefs/2026-09-09-D658-sentinel-manifest-expert-sync.md  cites=0  problems=0
OK    .dsh/skills/cto-handover/SKILL.md                           cites=2  problems=0
OK    .dsh/skills/dev-doc-delivery/template/编码指令模板.md       cites=1  problems=0
OK    .dsh/skills/dsh-decision-lens/SKILL.md                      cites=0  problems=0
OK    docs/archive/SYNOVA-IMPL-DSH-D534-notes-four-state-mechanism-20260826.md  cites=4  problems=0
OK    docs/plans/codex/implementation/SYNOVA-IMPL-D586-llm-error-taxonomy-align-20260907.md   cites=1  problems=0
OK    docs/plans/codex/implementation/SYNOVA-IMPL-D651-expert-name-reference-sync-20260909.md cites=0  problems=0
OK    docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D500-session-event-sourcing-20260822.md  cites=4  problems=0
OK    docs/synova/audit-reports/2026-08-16-D394-D398-strategy-consult.md  cites=1  problems=0
OK    docs/synova/founder-console.html                           cites=0  problems=0
OK    docs/synova/research/Harness研究与Synova战略再定位-20260816/附录-证据清单-20260816.md  cites=0  problems=0
ISSUE docs/synova/research/DSH迁移施工图-20260820/DSH借鉴指引-v2-20260904.md  cites=6  problems=1  ← B-14 `types/{spec,types}.js` 锚点不符
```

**全量组的 3 处问题（清单）**

```
ISSUE docs/synova/coordination/dsh-cto-draft/agent.cordis.yml      cites=27  problems=1  ← @deepseek-ai/dsh-workflow-worker-thread 树中无此包
ISSUE docs/synova/coordination/派单-L1切片C-D527-D528-20260825.md  cites=1   problems=1  ← @deepseek-ai/dsh-client-ui-* 通配写法
ISSUE docs/synova/coordination/派单-并行CTO-控制塔收口批次-20260911.md cites=4  problems=1  ← 打包运行时断面路径（参照系外）
```

**第二层语义结论（人工判定，逐条给依据）**

| 判定项 | 结论 | 依据 |
|---|---|---|
| 引用"官方包存在"是否可当"机制在场" | **不可**——本件对每条关键结论都回到 `sed -n '<N>p'` 实读 | 反例：B-12 HMAC 在我的首轮 `grep -ni 'hmac\|signature'` 里**零命中**（仅 tests 命中），实读 `handler.js:81` 才确认验签在（委托 `@octokit/webhooks` 的 `Webhooks.verify`）→ **"grep 不到 ≠ 没实现"**，与本件另一条结论"grep 到 ≠ 实现"互为两面 |
| 我方文档的锚点粒度 | **不足**：D852 系列一行内多文件共用行号序列 | §4.2 #6 |
| 归档件（docs/plans、docs/archive） | **抽样 11%–33% 全部通过**（路径全 EXISTS） | 抽样表 |
| 我方脚本侧 | `install-dsh-preset.sh:85-87` 目标布局与官方树不一致 | §4.2 #1/#2；需以**打包运行时**或新版官方树复验（本件不越界改脚本） |

---

## 五 借鉴项（**12 条**，配额 ≥8 → 满足）

> 每条给：复制边界分类（核心自研 / 可参照 / 可直接复制）+ 官方 file:line（官方无对应物则明写）+ 我方"改到什么程度"。

| ID | 标题 | 分类 | 官方 file:line | 可执行动作 | 我们改到什么程度 |
|---|---|---|---|---|---|
| D-01 | 运行时不变量注册表（seam 形态：`register(packageName, installer)` + 违约抛 `INVARIANT` 码） | **可直接复制** | `packages/runtime-diagnostics/invariants/lib/index.js:12`、`:80`、`:92` | 照抄 register/install/throw 三段 seam，断言体全部用我方事件名重写 | 我方 `src/infra/**` 出现可注册的 invariant 表，且**删掉任一安装点即报红**（判别性夹具） |
| D-02 | 持久化分级准则（作业 vs 提醒：跨重启要不要复活；**准则文本级可直接复制**） | **可直接复制** | `packages/jobs/jobs/README.zh.md:53`、`packages/schedule/schedule/README.zh.md:12` | 把准则写成我方存储选型 checklist，对存量选型逐项标注 | Sentinel 工单/哨兵任务在文档中逐项标"重启复活/不复活"，无一项留空 |
| D-03 | 截断账本（`trimTrailingPartialUtf8` + `describeOmitted`） | **可直接复制** | `packages/util/output-retention/lib/index.js:109`、`:261` | 20+ 处 `.slice(0,N)` 全部改经账本出口，记录"切了多少/切在哪/可否取回/精确字节" | `grep -c '\.slice(0,' src/**` 的每一处都有对应账单条目（可脚本对账） |
| D-04 | spill 三件套（策略/本地根/取回指引） | **可参照** | `packages/spill/spill/lib/index.js:22-51`、`spill-local/lib/index.js:17`、`spill-policy/lib/index.js:8` | 借"策略-落盘-取回提示"三段结构，落盘根与保留期由我方产品决定 | 两个 cap 数字（产品决定）落文档；溢出后模型能拿到取回提示 |
| D-05 | webhook 入站范式（三 id + credential-ref 标记 + 签名先于 JSON 解析） | **可参照** | `packages/webhook/webhook/lib/types/brand.d.ts:4/6/8`、`webhook-github/lib/types/handler.js:72`、`:81` | 5a 入站照抄"验签→解析→幂等 id"顺序；5b 出站自建 | 入站路由有 HMAC/token 校验且**校验先于 body 解析**（可用坏签名夹具验） |
| D-06 | HTTP 代理失败处理（"reported, never silently dropped"） | **可参照** | `packages/util/http-proxy/lib/index.js:19`、`:44` | 借 no_proxy 回环清单 + 失败必报 | 代理不可用时 `degraded:true` + 健康检查可见（禁静默） |
| D-07 | 设置热改 `live\|restart` 分类声明（**口径级可直接复制**） | **可直接复制** | `packages/settings/settings/lib/types/index.d.ts:21` | 每个配置命名空间声明生效方式 | 我方配置面 100% 有 `live/restart` 标注，未标注不合并 |
| D-08 | 会话统计折叠规则（以 `step/end` 计步，不以 assistant/message 计步） | **可直接复制** | `packages/session/session-stats/lib/types/projection.js:6-11` | 先补 turn/step 事件，再照抄折叠字段与边界状态 | 8 字段 + 边界状态逐项有测试；取消/失败步各计一条 |
| D-09 | 跨会话引用上限/限流（3 条 / 64KB / 候选限流抛错） | **可直接复制** | `packages/context/session-reference/lib/index.js:94`、`:98`、`:519-520` | 借常量与"非正 limit 即抛错"的防御 | 我方引用注入有硬上限；越限报错不静默截断 |
| D-10 | 时间上下文只做"给模型一只时钟" | **可参照** | `packages/context/time-context/lib/index.js:68` | 复用 `Intl.DateTimeFormat` 封装与注入面 | 报告"生成时间"有；**"数据时点"另立自研**（官方无，`:asOf` 命中 0） |
| D-11 | 联网检索官方对应物（`dsh-tool-web`：`web_search`/`web_fetch`，外部文本标不可信） | **可参照** | `packages/web/tool-web`（README.zh.md 概述段） | 归线 #7 note 补锚点；借"结果标为外部不可信数据"的处置 | 检索结果进入我方上下文时带不可信标记，且工具缺失时返回结构化错误而非消失 |
| D-12 | 凭据本地存储的**反面**范式（渲染文本落盘 + 0600 + 权限自检）——**官方实现建议撤回** | **核心自研** | `packages/credentials/credentials-local/lib/index.js:104`、`:343`、`:549-560` | 仅借"启动即校验文件权限并拒绝启动"这一条；**官方 `-local` 明文渲染实现撤回、不采纳**；存储必须加密 | 数据源凭据加密可轮换；启动时权限自检缺一即拒绝启动 |

---

## 六 未覆盖 / 存疑项（如实列）

1. **任务书 14 项取材来源未入库**：全部结论基于 `origin/chore/ingest-institute`（`9cce8b87`）。CTO 回"可读"后须复验，尤其 §1.2 的 14 行与 §1.4 的 9 行（本件已逐条标注"来源未入库"）。
2. **第 15 项实体悬置**：总纲 `P2-5 联网检索` 是唯一候选（出处已给），是否并入 14 由 CTO 裁定；本件按 14 收口 + 单列备查。
3. **打包运行时（0.1.6-alpha.1）未作判据**：3 条 `OUT_OF_REF` 与 `install-dsh-preset.sh` 的目标布局（`config/agent-presets/standard`）**未在参照系树验证**，需在打包运行时断面复验；本件不越界判定。
4. **行号锚点只做了"代码块级"漂移量化（18 处）**：表格内联锚点（`path:12-16,49-52` 式）因写法不可机械解析，未逐条量化；**这是本件未覆盖的最大面**，建议后续以"一行一锚点"规范后再全量机械核。
5. **`dsh-client-runtime` 归属未定**：官方树无此名，最近似 `dsh-client-test-runtime` 但**非同一物**；我方 `dsh/plugins/synova-dashboards/package.json:25` 的依赖声明意图未查（属插件侧，超出本件写集）。
6. **`@deepseek-ai/cordis` 的第三方属性**：官方树映射到 `vendor/cordis`，但"是否为 upstream `cordis` 的 repack"未核（只读命令层面无法确认）。
7. **未 commit / 未 push**：本件按任务书硬边界停在"文件落盘"。`git ls-remote` 回执**不适用**（本件不入库、不推送）。末次实测 `git status --porcelain`（工作树内）= **5 条 untracked**：`docs/synova/research/` 下四份切片产物（A/B/C/D）+ `task-state/D870.json`；**无一条 ` M`（无 tracked 文件被改）**，与"只写自己那一份"一致。
8. **口径修正已落**（CTO 2026-09-21）：本件初稿按 FS 口径（200）出数，已按冻结口径 **tracked-only 199** 全量重跑并回填 §0.2 / §4.1 / §4.2 / §4.3；**分子（失效清单）在两个口径下完全相同（4/3/3）**，仅分母与 `ROOT_DIR` 一项变化。
9. **未做**：未在参照系树跑任何构建/测试（官方树只读 + "禁重型并发"约束）；未核 `dsh-*` 的 npm 发布版本号与 tree 内 `package.json` 版本是否一致（超出本件写集，属 A 切片"打包态"范围）。

---

## 七 机器可读块

```json
{"d870_borrow_items":[
{"id":"D-01","title":"运行时不变量注册表 seam（register/install/违约抛 INVARIANT）","class":"可直接复制","official":"packages/runtime-diagnostics/invariants/lib/index.js:12,80,92","action":"照抄三段 seam，断言体用我方事件名重写","scope_for_us":"src/infra/** 出现可注册 invariant 表，删任一安装点即报红"},
{"id":"D-02","title":"持久化分级准则（跨重启要不要复活）","class":"可直接复制","official":"packages/jobs/jobs/README.zh.md:53 / packages/schedule/schedule/README.zh.md:12","action":"写成存储选型 checklist 并对存量逐项标注","scope_for_us":"Sentinel 工单/哨兵任务逐项标复活性，无空项"},
{"id":"D-03","title":"截断账本（trimTrailingPartialUtf8 + describeOmitted）","class":"可直接复制","official":"packages/util/output-retention/lib/index.js:109,261","action":"20+ 处 .slice(0,N) 改经账本出口","scope_for_us":"每处截断有账单条目（切多少/切在哪/可否取回/精确字节）"},
{"id":"D-04","title":"spill 三件套（策略/落盘根/取回指引）","class":"可参照","official":"packages/spill/spill/lib/index.js:22-51 / spill-local/lib/index.js:17 / spill-policy/lib/index.js:8","action":"借三段结构，cap 由产品定","scope_for_us":"两个 cap 数字落文档；溢出后模型可拿到取回提示"},
{"id":"D-05","title":"webhook 入站范式（三 id + credential-ref + 验签先于解析）","class":"可参照","official":"packages/webhook/webhook/lib/types/brand.d.ts:4,6,8 / webhook-github/lib/types/handler.js:72,81","action":"5a 入站照抄验签→解析→幂等 id；5b 出站自建","scope_for_us":"入站校验先于 body 解析，坏签名夹具可判红"},
{"id":"D-06","title":"HTTP 代理失败必报（never silently dropped）","class":"可参照","official":"packages/util/http-proxy/lib/index.js:19,44","action":"借 no_proxy 回环清单 + 失败必报","scope_for_us":"代理不可用 = degraded:true + 健康检查可见"},
{"id":"D-07","title":"设置热改 live/restart 分类声明","class":"可直接复制","official":"packages/settings/settings/lib/types/index.d.ts:21","action":"每个配置命名空间声明生效方式","scope_for_us":"配置面 100% 有 live/restart 标注，未标注不合并"},
{"id":"D-08","title":"会话统计折叠规则（step/end 计步权威）","class":"可直接复制","official":"packages/session/session-stats/lib/types/projection.js:6-11","action":"先补 turn/step 事件，再照抄折叠与边界状态","scope_for_us":"8 字段 + 边界状态逐项有测试；取消/失败步各计一条"},
{"id":"D-09","title":"跨会话引用上限/限流（3 条 / 64KB / 非正 limit 抛错）","class":"可直接复制","official":"packages/context/session-reference/lib/index.js:94,98,519-520","action":"借常量与防御式抛错","scope_for_us":"引用注入有硬上限，越限报错不静默截断"},
{"id":"D-10","title":"时间上下文只做「给模型一只时钟」","class":"可参照","official":"packages/context/time-context/lib/index.js:68","action":"复用 Intl 封装与注入面","scope_for_us":"生成时间有；数据时点另立自研（官方无，asOf 命中 0）"},
{"id":"D-11","title":"联网检索官方对应物 dsh-tool-web（结果标外部不可信）","class":"可参照","official":"packages/web/tool-web（README.zh.md 概述段）","action":"归线 #7 补锚点；借不可信标记处置","scope_for_us":"检索结果入上下文带不可信标记，工具缺失时返回结构化错误"},
{"id":"D-12","title":"凭据本地存储反面范式（仅取「启动即校验权限」）（官方 -local 明文渲染实现建议撤回）","class":"核心自研","official":"packages/credentials/credentials-local/lib/index.js:104,343,549-560","action":"只借权限自检一条；官方 -local 明文渲染实现撤回不采纳；存储必须加密","scope_for_us":"数据源凭据加密可轮换；权限自检失败即拒绝启动"}
]}
```

---

## 附：本件复现命令索引（临时脚本，不入库）

```bash
python3 /tmp/d870/extract2.py     # ① 任务书 Tier A/B 引用抽取 + 解析（217 TierA 全 EXISTS / 154 TierB 全 DIR）
python3 /tmp/d870/drift.py        # ① 代码块锚点漂移（9 MATCH / 9 MISMATCH）
python3 /tmp/d870/layer1.py       # ④ 第一层（tracked-only 199）219 mentions / 81 unique → test -e
python3 /tmp/d870/layer2.py       # ④ 第二层 分组与抽样（95 全量 + 17 抽样 = 112/199 = 56.3%）
python3 /tmp/d870/anchors2.py     # ④ 锚点写法诊断（26 组配对，暴露"一行多锚点"不可机械核验）
```

**未覆盖声明**：本件**未** commit、**未** push、**未**跑任何重型验证（docs-only，符合"8GB 机器串行"约束）。行数：见文件末尾自动统计（`wc -l`）。
