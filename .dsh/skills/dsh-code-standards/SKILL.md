---
name: dsh-code-standards
description: DSH 代码标准（写代码／脚本／测试前必读）——8 项代码标准＋4 条必复用约定，每项带 DSH 源码 file:line 证据；含契约模板与决策镜头六原则。
whenToUse: 写代码/脚本/测试、新建 compute 或模块、代码质量审查、做技术取舍、交付前自检时。
---

# dsh-code-standards — DSH 代码标准

## 使用时机
写代码/脚本/测试之前逐条对照（L1 dev doc／L2 实施／独立复核）；本件是**判据**（缺项即不合格），不是建议。依据（2026-10-18 实测）：既有脚本无 Known Limitations／Source map、错误不带 code、复用现成件 0 处。

## A. 结构标准
`LICENSE README.md README.zh.md README.i18n.yaml lib/ package.json`；README frontmatter 有 `description:`＋`kind:`。
README 骨架（`dsh-tool-bash/README.md:10,14,26,72,108,201`）：Summary｜Use this package（**What can go wrong**←先讲失败）｜Understand（**Design philosophy**＝一个分离＋N 条承诺／**Source map**＝File→Role 表）｜Model Experience｜**Known Limitations**←🔴必须写"做不到什么"｜Dev Note

## B. 八项代码标准（带 file:line）
> ⚠️ **锚点基准（2026-11-03 实测校准）**：以下 `packages/...` 路径以 **dsh-ref v0.2.1-rc.2 @ 687f282e** 为准。
> 旧锚点 `dsh-*/lib/index.js` **已全部失效**（该版本源码为 `packages/<域>/<包>/src/*.ts`，无 `lib/`）。引用前先跑 §F 复核路径。

B1 **typed error 带 `code`**，禁裸 `throw new Error`/`raise Exception` — `packages/experimental/agent-team/src/error.ts:7-12`（`TeamError extends HarnessError`，`constructor(message, code, options)`）
B2 **config 用 schema 校验**（schemastery/zod），不是裸 JSON — `packages/experimental/agent-team/src/index.ts:60-62`（`z.number().step(1).min(1).default(...)`）
B3 **invariant companion**：不变式/错误类型独立成件 — `packages/experimental/agent-team/src/error.ts`（不进主入口）。⚠️ 旧锚点 `dsh-invariants` 包**已在 v0.2.0-rc.2 移除**（迁移指南：`docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/`）
B4 **bounds fail loud**：越限报 typed error，绝不静默复用/降级 — `packages/experimental/agent-team/src/index.ts:235`（超 `maxMessageBytes` → `TEAM_MESSAGE_TOO_LARGE`）
B5 **explicit authority**：每个入口写明"谁能调" — `dsh-tool-bash/README.md:107`（只有 Lead 能 spawn/reassign）+ `:201` Known Limitations
B6 **JSDoc 全公开方法**（`@param`/`@returns`）— `packages/shell/tool-bash/src/background.ts:17-18`；`@returns` 例：`packages/experimental/agent-team/src/error.ts:14-18`
B7 **design philosophy 一句可诵**：一个分离＋N 条承诺 — `README:103→105-108`
B8 **测试与实现配对**（含三态＋改坏必红）— CT-40：`<name>.sh|py` ↔ `<name>.test.sh`（`tests/control-tower/`）

## C. 文档标准
Source map 表（File→Role，`README:112-118`）｜Known Limitations **必须写"做不到什么"**（`README:201`，不写=不合格）｜"成功/失败长什么样"（agent-team `README:87`）｜双语 README（按需）

## D. 四条必复用既有约定（重复实现即不合格）
D1 **三态退出码**：0 通过／1 真红／**2 检查自身失败**（信号量==0 ⇒ 2）— `scripts/control-tower/pre-dispatch-check.sh` 头部
D2 **`@降级`**：stderr `degraded: <原因>`＋**`SYNO_GATE_DEGRADED_LOG`**（time/component/code/phase/retryable）＋exit 2 — `scripts/control-tower/check-gate-integrity.sh` 头部
D3 **UTF-8 强制**（D732）— 同上
D4 **判别力自检**：必须能证明"改坏确实红" — `check-gate-integrity.sh`／`scripts/check-verifiable-done.sh`

## E. 契约模板（并入 contract-template；铁律 47/48）
新增 compute（`(store: GraphStoreReader, teamId: string) => ComputeResult`）、bash 脚本、模块接口 ⇒ **先写契约再写代码**（pre-commit 组 2 硬阻断无 JSDoc 的 compute）。
```typescript
/**
 * computeCashFlowMetrics — 现金流哨兵指标
 *   @input  — store: GraphStoreReader（L4 本体图读取器）, teamId: string；沿 OWES 边找债务、沿 GENERATES 边找现金流入（图遍历，非 KV 读取）
 *   @output — { metrics: { operatingCashFlow, kzScore, ... }, computedAt: ISO }
 *   @degraded — 数据不完整（如缺 Financial 节点）→ degraded: true ＋ 缺失字段清单（调用方据此降级展示，铁律 31）
 *   @error  — CASH_FLOW_ERROR：.code ＋ .phase='compute' ＋ .retryable（铁律 32；数据缺失 retryable vs 类型非法不可重试）
 */
```
```bash
#   @input  — [--check]；环境注入 SYNO_XXX_SRC/DST（测试用）
#   @output — 同步报告＋SYNC-OK 标记
#   @exit   — 0 成功/一致；1 业务阻断（漂移）；2 检查执行失败/降级（D328 三态）
#   @degraded — exit 2 ＋ stderr "degraded: <原因>"（铁律 11 显式降级，不静默）
#   @error  — .code ＋ .phase ＋ .retryable
```
**测试契约**（铁律 48，red→green）：① 正常——合法输入 → 契约输出形状正确（必有 `expect()`）② 降级——数据缺失/不可写 → `degraded: true`＋显式 log（铁律 24）③ 边界——空输入/空目录/漂移/多余项/幂等重跑。命名：`*.test.ts`／`*.integration.test.ts`（cover 真实路由，不 mock 管线，铁律 12）／`*.e2e.test.ts`；bash `*.test.sh` 在 `tests/control-tower/`。
**降级规则**（铁律 11/24/31）：catch 必有 `log.warn/error`（不空吞）＋返回 `degraded: true` 或错误 UI｜ENOENT（默认不告警）vs JSON.parse 失败（告警＋degraded）｜调用方必须检查并传播/展示。
验证：`grep -n "@input\|@output\|@degraded" <新文件>`｜`bash scripts/workflow/check-silent-swallow.sh --diff`｜`vitest run --changed`。

## F. 决策镜头六原则（并入 dsh-decision-lens；引用必须给 file:line）
> 创始人 2026-09-20：「决策用 DSH 的思维」＋「六条原则＝决策纪律」。**引用必须读 DSH 源码，不得凭印象**。
1 **上限即纪律** — `packages/experimental/agent-team/src/index.ts:42-44`（`DEFAULT_MAX_MEMBERS=16`／`MAX_TASKS=256`／`MAX_MESSAGE_BYTES=65_536`）＋`:50`（非正整数配置 → `TEAM_INVALID_CONFIG`）＋`:235`（超限抛错）⇒ 在飞必须有**显式上限**；超限先**退役**（关闭/合并/拒绝），不许堆积。⚠️ 上限值随版本变（本基准为 16，**不是**旧稿所记 4）。
2 **归属自有＋可归因** — `packages/experimental/agent-team/src/error.ts:7-12`（`TeamError extends HarnessError`，失败带机器可读 `code`）⇒ 机制由被守护对象声明；在飞件有主人，失败带代码＋归属。⚠️ 旧锚点 `dsh-invariants` 已于 v0.2.0-rc.2 移除。
3 **只做协调不干活** — `packages/workflow/tool-workflow/src/index.ts:166`（"the agents do the work"，脚本无 fs/network/timer/Node.js API）⇒ 编排只管上限/并发/取消，执行一律派出。
4 **机械与业务语义分离** — `packages/util/output-retention/src/index.ts:7-9`（库只管 mechanical question"留了什么/省了什么"，业务语义归工具包）⇒ 队列健康＝纯机械派生指标（age/behind/CI/主人），不把"卡住"与"被绕过"揉进一个数字。
5 **诊断不污染主路径** — 同上（`error.ts` 不进主入口；retention 是库）⇒ 检查/协调走旁路，只有"不拦就真出事"才进主路径门禁。
6 **权威账本在 Lead** — agent-team `authoritative Lead-log owner`＋advisory write scopes ⇒ 写集是提示，权威记录在队长/CTO。
**决策四步**：① 先量不先加机制（队列/behind/age/CI/在飞）② 先修瓶颈再加负载 ③ 超限即退役（给关闭理由，不留悬案）④ 旁路落地（优先派生指标/旁路检查）。
**复核路径（引用前先跑）**：
> ⚠️ **2026-11-03 校准**：下列命令中的 `lib/*.js` 路径**在 v0.2.1-rc.2 已不存在**，旧命令会全部空输出。
> 包目录也从 `node_modules/@deepseek-ai/dsh-*` 扁平布局改为 **`packages/<域>/<包>/`** 分域布局。

```bash
D="<DSH 源码根>/packages"        # 本机实测基准：/d/dsh-ref/packages（v0.2.1-rc.2 @ 687f282e）
sed -n '42,50p;230,240p' "$D/experimental/agent-team/src/index.ts"   # 上限（默认值 + 超限抛错）
sed -n '1,20p'  "$D/experimental/agent-team/src/error.ts"            # 归因（TeamError 带 code）
sed -n '160,170p' "$D/workflow/tool-workflow/src/index.ts"           # 只协调（agents do the work）
sed -n '1,12p'  "$D/util/output-retention/src/index.ts"              # 机械 vs 语义
```
**自检（引用前必跑，任一为空即锚点失效，不得引用）**：
```bash
for f in experimental/agent-team/src/index.ts experimental/agent-team/src/error.ts \
         workflow/tool-workflow/src/index.ts util/output-retention/src/index.ts; do
  [ -s "/d/dsh-ref/packages/$f" ] && echo "OK  $f" || echo "DEAD $f"
done
```
**借鉴边界**：DSH 一能力一独立包、包间不共享文件 ⇒ advisory 写集够；我们单仓共享文件（`src/**`、`scripts/**`）⇒ **必须文件级互斥＋串行合并**。判据："两个 agent 同时改这个文件，坏不坏？"坏 ⇒ 物理互斥；不坏 ⇒ 照抄 advisory。
**反模式**：❌ 用"再加一道门禁"回应某类错反复出现（先问是否队列/并发上限）❌ 多含义塞进一个指标（卡住＋被绕过＋质量差＝"健康分"）❌ 主路径承担诊断 ❌ 无界堆积 ❌ 引用 DSH 无 file:line（凭印象＝不算核查）。

## G. 交付前验证清单
```bash
head -40 <file> | grep -E "@input|@output|@exit|@degraded"   # 1 契约
grep -nE "class .*Error|raise .*Error\(" <file> | head      # 2 typed error
grep -c "Known Limitations\|已知限制" <file>                # 3 Known Limitations
grep -c "Source map\|File | Role\|文件.*职责" <file>        # 4 Source map
grep -nE "exit 2|exit\(2\)" <file>                          # 5 三态
grep -nE "selfcheck|自检|改坏" <file>                       # 6 判别力
grep -cE "degraded|SYNO_GATE_DEGRADED_LOG|D732" <file>      # 7 复用约定
ls <name>.test.sh 2>/dev/null || echo "🔴 缺配对测试"  # 8 配对
```
