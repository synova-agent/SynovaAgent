# D968 栈式两支 独立验收 evidence（task-4 阶段四）

> 复核员：`sentinel-verifier`（独立复核员，**非编码**；只读仓库，产物全部在 `/tmp/verify-d968/**`）
> 口径：只出 **自验结论**；永不写「审计通过」。判据 = **运行时断言 + 改坏即红**；**不复用被验方脚本作判据**。

## 0. 环境与栈结构

| 项 | 值 |
|---|---|
| PR-A（mac, 栈底） | `feat/D968a-sentinel-single-registry` @ `16c49cea4928c719ddd1205f2d2973f1b014a243`，base = `feat/D967b@80045321` |
| PR-B（win） | `feat/D968b-win-single-entry` @ `cd93104adb79b43338a599e9c55cc54ffef2df96`，base = PR-A |
| ls-remote | 两分支与发单 HEAD 逐字一致 |
| 栈关系 | `80045321 → 16c49cea → cd93104a` 祖先链逐段成立 ✅ |
| 我的工作树 | `.synova-wt-vd968a@16c49cea` ／ `.synova-wt-vd968b@cd93104a` ／ 对照 `.synova-wt-vd967b@80045321` |
| 生产库 | 只用 `.backup` 快照；`shasum` 复核未变 |

D708 写集门禁（栈式正确口径 base=各自父支）：**PR-A ✅ pass（16 文件）/ PR-B ✅ pass（5 文件）**，无夹带。
task-state `D968.json` 的 write_set 为**两 PR 并集**，含 `src/agent/synova-agent.ts` 与 `tests/integration/knowledge-feedback.integration.test.ts` ⇒ 无越界写集。

---

# 一、Done ①–⑤ 逐条

## ① adapters 逐件裁定「不留第三态」—— **成立**

基线树（D967b）5 个文件 → 两支叠加后 `src/sentinel/adapters/` **目录不存在**（`ls` 空，git 不追踪空目录）。

| 文件 | 裁定 | 我的独立取证 |
|---|---|---|
| `cpc-sentinel.ts` | 删 | 基线含 `@deprecated`；唯一测试 importer `tests/sentinel/adapters/cpc-sentinel.test.ts` 同步删除 |
| `goal-alignment-sentinel.ts` | 删 | 基线含 `@deprecated`；无任何 importer |
| `integration-health-sentinel.ts` | 删 | 基线含 `@deprecated`；基线唯一 importer = `durationms-regression.test.ts`，PR-A 已改为**内联等价夹具**（并保留 `999999` 伪 durationMs 断言） |
| `cash-flow-sentinel.ts` | 删 | **无 `@deprecated`**（实测 0 次）；与文件驱动 `cash-runway` 同子领域重复；生产从未注册 |
| `helpers.ts` | 随删 | 仅被上述 4 个适配器 import（实测 3 处 `from './helpers'`，全在被删件内）⇒ 删后**零引用** |

终检（PR-B 树）：5 个被删模块的 **代码 importer = 0**；残留命中仅 2 处**注释散文**（`builtins.ts:65`、`durationms-regression.test.ts:40` 的历史说明）。

## ② `loadSentinels()` 加载数 = 目录数（加载器语义口径）—— **成立**

```
加载器语义目录数 = 45 ｜ loadSentinels() = 45 ｜ errors=[]
ASSERT 加载数 = 目录数 → HOLDS
反例口径: 朴素顶层目录数（含 _extinct/shared）= 47 ｜ 递归 manifest 数 = 57
```
（口径与 45/43 无关：判据由 loader 语义推导——非递归、跳过 `shared` 与 `_` 前缀。
被验方 evidence 写"递归口径 = 58"，我实测 **57**；差额 = 根级 `extensions/sentinels/manifest.json`（扩展清单，非哨兵 manifest，我的实现显式排除）⇒ 口径差异，非矛盾。）

## ③ 「只加一个目录、不改一行代码 → 跑通」—— **成立（并坚持"真产出 finding"）**

自建 harness（`SENTINELS_FIXTURE_DIR` + `clearSentinelCache()`，公开 API）：

```
# [single] loadSentinels().sentinels.length = 1（期望 1） errors=[]
# [single] registerLoadedSentinels = {"registered":1,"errors":[]}
# [single] registry.list() = ["sentinel-vd968-only"]
# [single] 端到端事件 payload findings = ["vd968-real-finding"]
# [single] ASSERT 真产出 finding（落事件流）→ HOLDS
# [single] ASSERT registry 注册数=1 → HOLDS
```
即：**发现（1）→ 注册（1）→ 执行（runOnce）→ 真产出 finding 落 `sentinel_events`（event_type='finding'）**——不是"注册成功"就算。
仓库既有真实管线三环 e2e（`tests/sentinel/d751-new-sentinel-e2e.test.ts`）在我副本内 **5 passed**。

## ④ 禁令 4：`filenameToExportKey()` **未修**、路径1 随整体删除 —— **成立**

- 基线 `builtins.ts` 的 `filenameToExportKey()` 在 PR-A 被**整段删除**（不是修键名）；头注释明写"明令禁止修复"。
- `registerBuiltinSentinels` 降为 **no-op + `log.warn`**（栈式编译约束的过渡态，PR-B 移除调用点）——`builtins.test.ts` 断言 `existsSync(PATH1_ADAPTERS_DIR)===false` 且 registry 增量 = 0。
- 我零改基线复现其键名不匹配（见 §二-1）。

## ⑤ 硬编码哨兵数改动态取数 —— **部分成立（批级时序问题）**

- **D968 自身触及的断言**：动态 ✓（Gate4 改为 `加载数 = 目录数`；`builtins.test.ts` 用夹具内计数）。
- **但同树仍有 3 处写死 45**（均**不在 D968 写集内**）：
```
tests/control-tower/check-sentinel-type-net.test.sh:37   assert_contains "$OUT" "45 个活跃哨兵全部已登记"
tests/sentinel/d752-type-net-gate.integration.test.ts:57,60  "45 个活跃哨兵全部登记"
tests/sentinel/path-dependency-sentinel.test.ts:82       expect(registered).toBe(45);
```
这 3 处**恰是 D965 的写集**（D965 分支已改为动态取数；main 尚未合入 D965）。⇒ 「已全部改动态取数」在 **D968 树/main 线上不成立**，在 **D965 合入后成立**；若 D965 不落，任何哨兵数变动都会让这 3 条转红。

---

# 二、四条关键声称

## 声称 1「路径1 关停是行为中性」—— **成立**

在**基线树**（D967b）零改代码调用 `registerBuiltinSentinels()`：

```
# 命中文件 = ["cash-flow-sentinel.ts","cpc-sentinel.ts","goal-alignment-sentinel.ts","integration-health-sentinel.ts"] → scanned = 4
#   cash-flow-sentinel.ts: 推导键="cashFlow"（模块内是否存在=false）｜实际导出=["cashFlowSentinel"]
#   cpc-sentinel.ts:       推导键="cpc"（false）｜实际导出=["cpcSentinel"]
#   goal-alignment-sentinel.ts: 推导键="goalAlignment"（false）｜实际导出=["goalalignmentSentinel"]
#   integration-health-sentinel.ts: 推导键="integrationHealth"（false）｜实际导出=["integrationHealthSentinel"]
{"level":50,...,"msg":"[builtins] cash-flow-sentinel.ts 未导出哨兵对象 (key=cashFlow)"} ×4
{"level":30,...,"registered":0,"total":0,"cronCount":0,"scanned":4,"msg":"[builtins] 哨兵自动注册完成"}
# registry.count() before = 0 → after = 0
# ASSERT registered = 0 → HOLDS
```
**生产级复核**：基线树先跑生产同款 `initFileDrivenLoaders()`（registry=45）再调路径1 ⇒ `45 → 45`，**增量为 0** ✓。

## 声称 2「Done③ 判别性（cache 陷阱）」—— **成立（双向红对照）**

```
clearSentinelCache 后（夹具 1 目录）: loadSentinels() = 1      → ASSERT 加载数=1 → HOLDS
去掉 clearSentinelCache（主目录先入缓存）: = 45               → VIOLATED（陷阱真实存在）
去掉 env（不指向夹具根）: = 45                                → VIOLATED
```
⇒ 锚定 `加载数=1` 的断言**必须**同时具备 env 与 clear，两者任一缺失即红。

## 声称 3「B2：H1 跨源语义」—— **成立（含同源红对照）**

用**真实加载管线**构造"磁盘 2 个 manifest、注册成功 1 个"漂移：
```
# [drift] 磁盘源 loadSentinels() = 2 ｜ errors(load)=[]
# [drift] 注册源 registerLoadedSentinels = {"registered":1,"errors":["哨兵 vd968-broken entryPoint 不存在: …/aggregate.ts"]}
# [drift] registry.count() = 1
# [drift] runSelfCheck 落事件 finding ids = ["self-check-H1-1"]
# [drift] H1 描述 = 哨兵注册率 50% 低于阈值 80% — 部分哨兵静默失效，巡检覆盖不全
# [drift] ASSERT H1 告警（跨源 ratio<1）→ HOLDS
```
**红对照**（/tmp 副本把 `state.expectedCount = loadSentinels().sentinels.length` 改成 `getSentinelRegistry().count()`）：
```
# [drift] runSelfCheck 落事件 finding ids = []
# [drift] ASSERT H1 告警 → VIOLATED
```
⇒ 同源快照下检测力**归零**，跨源语义是承重的（非装饰）。

## 声称 4「生产启动链 = 文件驱动唯一入口」—— **成立（附两条精确化）**

源码链（PR-B 树逐段核）：
```
src/server.ts:15  import { initFileDrivenLoaders } from './init/file-driven-loaders';
src/server.ts:127 const boot = new Bootstrap();
src/deploy/bootstrap.ts Phase 3b (~L841-848) → await initFileDrivenLoaders()
src/init/file-driven-loaders.ts → loadSentinels() + registerLoadedSentinels()
```
运行时（生产同款函数）：
```
# 磁盘 manifest 数（loader 源）= 45
# initFileDrivenLoaders() 后 registry.count() = 45
# ASSERT registry 集合 == 文件驱动 manifest 集合 → HOLDS
# 非文件驱动来源的注册项 = []
```
**反向核**：`src/server.ts:15` 的 `initFileDrivenLoaders` 在该文件内**调用 0 次** ⇒ 死 import **属实**（卡面 `uncleared` 已如实登记）。

**两条精确化（发单方口径需收窄）**：
1. `deploy/bootstrap.ts` 还有 **Phase 2a**（`runPhase2a`，~L375-395）也做 `loadSentinels()+registerLoadedSentinels()` ⇒ 启动路径上**同一件事有两个调用点**（都属文件驱动）。「唯一入口 = 文件驱动」作为**入口种类**成立；作为**单一调用点**不成立（重复注册时 registry 会走"覆盖旧实例"分支）。
2. Phase 3b 的失败被 `catch → log.warn + ctx.addDegraded`（fail-open 但显式 degraded），非静默。

---

# 三、两条「已登记、不判缺陷」项复核

## `check-deprecated-mapping.sh` 恒真门禁 —— **发单方的更正成立**

基线树（adapters **仍在**，且 `cash-flow-sentinel.ts` 的 `@deprecated` 计数 = **0**）：
```
$ bash scripts/check-deprecated-mapping.sh
  ✅ 旧适配器映射: 全部已标注 @deprecated        ← 假绿
$ grep -qL "@deprecated" src/sentinel/adapters/*-sentinel.ts | wc -l   → 0
$ grep -L  "@deprecated" src/sentinel/adapters/*-sentinel.ts            → cash-flow-sentinel.ts
判别性对照（临时文件）: grep -qL 计数=0 ／ grep -L 计数=1（列出 no-mark.ts）
```
机制：`-q` 抑制 `-L` 的输出 ⇒ `UNDOCUMENTED` 恒 0 ⇒ 永远 ✅。
⇒ **"从一开始就恒真，非本批裁撤所致"成立**（该脚本不在 D968 写集，属 win 域，卡面已登记待立卡）。

## PR-B 未复跑 tsc —— **理由成立（我独立补跑）**

PR-B 自身 src 改动 = 纯删除调用点（`git diff 16c49cea..cd93104a --stat` 仅 `src/agent/synova-agent.ts` 9 行 + 测试 + 证据）。
我独立在**叠加后的 PR-B 树**跑 `tsc --noEmit`：
```
错误总数 = 28
分布: extensions/sentinels/_extinct/**（24，全部为归档件的历史报错）
      src/connectors/ima.ts(2) ／ src/server.ts(2)（均为既有）
D968 触及文件（builtins.ts / runner.ts / synova-agent.ts / 被删适配器）→ 0 错
```
⇒ 「纯删除、无新增类型面」成立；且我复现出被验方声称的 **28** 这个数字。

---

# 四、回归面（我自建副本，无 `data/synova.db`）

```
PR-B 树 tests/sentinel 全量 : Test Files 212 passed | 1 skipped (213) ｜ Tests 962 passed | 1 skipped (963)
PR-B 树 tests/integration   : Test Files 5 passed (5) ｜ Tests 44 passed (44)
D968 定向 5 文件            : 29 passed（含 registry-single-entry 7、self-check-h1-cross-source 4、builtins 3、durationms 4、knowledge-feedback 11）
d751 十环 e2e               : 5 passed
PR-A 单独 knowledge-feedback: 2 failed | 9 passed（正是那两条硬编码 adapters 断言 = 栈式联合验收点）
```
**十环 e2e 红对照**：把夹具 manifest 的 `expert` 由 `fundamental-efficiency` 改为 `technology-foundation` ⇒ 环1/环2/环3 全红（`expected [ 'technology-foundation' ] to include 'fundamental-efficiency'`）⇒ 三环断言确实在读 manifest 声明，非空跑。

---

# 五、与发单方不一致之处

| # | 项 | 其表述 | 我的实测 | 性质 |
|---|---|---|---|---|
| 1 | Done⑤ | 「硬编码哨兵数**已全部**改动态取数」 | D968 触及的已动态 ✓；同树仍 3 处写死 45（check-sentinel-type-net.test.sh:37 / d752:57,60 / path-dependency:82），**均属 D965 写集**、D965 未合入 | 🟡 批级时序：D965 落地后才成立；否则哨兵数一变即红 |
| 2 | 关键声称 4 | 「唯一入口 = 文件驱动」 | 作为**入口种类**成立；但启动路径有 **Phase 2a + Phase 3b 两个调用点**做同一件事（重复注册） | 🟡 口径需收窄（建议后续卡合并） |
| 3 | D968 evidence §4 | 递归 manifest 口径 = 58 | 我实测 57（不含根级扩展清单 `extensions/sentinels/manifest.json`）/ 58（含） | ⚪ 口径差异，非矛盾 |
| 4 | 残留 | 未提 | `scripts/workflow/decide-next.sh:77,82` 仍引用已删的 `src/sentinel/adapters/`（D5/D6 缺口检查将永远看到"缺件"） | ⚪ 出写集、行为不崩、建议立卡 |
| 5 | 卡面 `results.tests_sentinel` | 34 文件 / 247 用例 | 我跑同目录全量 = 213 文件 / 963 用例（超集全绿） | ⚪ 范围口径不同 |

# 六、未能复现项（诚实登记）

1. **未运行被验方脚本作判据**（按其 `evidence` 的原始输出仅作对照）；全部结论来自自建 harness。
2. **未跑全仓库 vitest**：本轮 = `tests/sentinel` 全量 + `tests/integration` 全量 + 定向 5 文件 + d751 e2e + 多个红对照。
3. **Phase 2a/3b 的"重复注册"未做竞态实测**（仅源码链 + 运行时注册集合核验）；其影响面（registry 覆盖警告）未量化。
4. `decide-next.sh` 残留仅做静态定位，未实际触发该分支（脚本为交互式建议器）。

# 七、红线自证

- 未修改任何仓库文件；三个验收工作树 `git status --short` 为空；全部实验在 `/tmp/verify-d968/**`（含 `INJECTED-RED` 红对照，均在副本内，副本已还原）。
- 生产库 `data/synova.db` 仅 `.backup` 快照读取；未写。
- 未复用被验方脚本作判据来源；未写「审计通过」；未触碰 `scripts/audit/**`。
