# D965 + D966 独立验收 evidence（task-4 阶段二）

> 复核员：`sentinel-verifier`（独立复核员，**非编码**；只读仓库，全部产物在 `/tmp/verify-d965/**`）
> 口径：只出 **自验结论**；永不写「审计通过」。禁 grep 型静态判据当验收 → 全部结论为**运行时断言 + 改坏即红**。
> 被验方脚本**未复用**：全部数字来自我自建的探针/夹具；被验方脚本仅在 D708 门禁一项作为门禁本体被调用（其结论也只作对照）。

## 0. 验收环境与基线

| 项 | 值 |
|---|---|
| D965 工作树 | `/Users/wane/SynovaAgent/.synova-wt-verify-d965c` @ `3d0232a0e18337d79ae537730b88232d67ff14f5` |
| D966 工作树 | `/Users/wane/SynovaAgent/.synova-wt-verify-d966b` @ `39b7d818e5b3f51c43da0841c1512c5f955511f0` |
| 基线对照树 | `/Users/wane/SynovaAgent/.synova-wt-verify-base2` @ `ce231ff1b1e419095117413badba8c6b55ae39fd` |
| ls-remote 回执 | `3d0232a0…\trefs/heads/fix/D965-sentinel-stub-cut` ／ `39b7d818…\trefs/heads/docs/D966-sentinel-idle-repro` |
| 真实基线（实测） | `origin/main` = `0f709900`。**D965 分支实际基于 `0f709900`**（非发单方写的 ce231ff1）；D966 基于 `ce231ff1`。`git diff ce231ff1 0f709900 -- extensions/sentinels src/sentinel src/adapters src/l4 tests/sentinel tests/sentinels` = 空 → 两基线在哨兵域等价 |
| 生产库 | 全程只读；探针只对 `.backup` 快照副本操作 |

自建产物：`probe-sentinels.mts`（主探针：Proxy 方法级计数 + SQL 级 prepare/行数计数 + loader 口径解包 + `--arity/--entry/--wt/--fixtures` 变体）、`probe-loader-path.mts`（loader 原生注册路径）、`d966-fixtures.mts`（19 节点/3 边三断面夹具）、`p7-write-three-state.mts`、`d966-static-scans.mts`（自实现 S1..S4）、canary 红绿夹具、`dyn/`（动态取数实验与 D966 夹具副本）。

---

# 一、D965 逐条自验结论

### D965-1 探针 43/0（裁撤前 45/0）—— **成立**

```
基线 ce231ff1（45 件）: sentinels_total=45  threw_count=0  raw_is_array_count=42
D965  3d0232a0（43 件）: sentinels_total=43  threw_count=0  raw_is_array_count=42
                        non_array_count=1 -> [customer-demand-shift {findings,degraded}]
                        store_zero_call_count=0（裁撤前为 2）
```

### D965-2 `_extinct` 12→14 / 两目录不存在 / 无空目录 —— **成立**

```
base  _extinct dirs = 12   |   D965 _extinct dirs = 14
_extinct 新增两名: sentinel-forecast-accuracy, sentinel-pricing-strategy
sentinel-forecast-accuracy: absent ✅   sentinel-pricing-strategy: absent ✅
find extensions/sentinels -type d -empty → (空输出)
活跃哨兵目录数（loader 口径: 跳过 shared 与 `_` 前缀）= 43
```

### D965-3 零误伤：差集恰为 4 条编造 / 反向 ∅ —— **成立**

loader 原生路径（`registerLoadedSentinels` + `registry.check`，DB=生产快照副本；**我自建**）：

```
registered: 45 -> 43      sentinels_with_findings: 15 -> 13      total_findings: 18 -> 14
A-B (消失): forecast-mape / forecast-sample / forecast-timeseries / pricing-disc
B-A (新增): (空)
sentinel 集合 A-B: ["sentinel-forecast-accuracy","sentinel-pricing-strategy"]   B-A: []
共有哨兵中 finding 集发生变化的 = []          ← 零误伤（其余 43 件逐条同集）
ASSERT 差集恰为 4 条编造 = HOLDS    ASSERT 反向差集为空 = HOLDS
```

### D965-4 那 4 条编造 finding 确实消失 —— **成立**（由上条 A-B 逐 id 证明，非采信「裁撤即消失」）

### D965-5 path-dependency 哨兵目录 0 改动 —— **成立**

```
base tree sha : 8b2464d802f7e3024b99f799be40da8192e6276f
D965 tree sha : 8b2464d802f7e3024b99f799be40da8192e6276f   ← 逐字节同一棵树
git diff --stat 0f709900..3d0232a0 -- extensions/sentinels/path-dependency → (空)
```

### D965-6 连带 5 文件「动态取数」判别性验证 —— **成立（写死 43 会当场露馅）**

自建实验：把 D965 树 `git archive` 到 `/tmp`，加 `zz-canary-dyn` 哨兵目录（合法 manifest + `check()`）并在 `src/sentinel/types.ts` 登记；再删 `value-capture` 目录并去登记；另把三处动态断言改回写死 43 作红对照。

```
STATE 0 原样（43）          : shell 9✅/0❌「动态取数=43」;  vitest 4 文件 34 passed (34)
STATE 1 +1 canary（44）     : shell 9✅/0❌「动态取数=44」;  2 文件 16 passed
STATE 2 写死 43（改坏）      : shell 8✅/1❌ → 「❌ 全登记计数输出（动态取数=43）— 未找到: 43 个活跃哨兵全部已登记」(exit=1)
                              d752  → AssertionError: expected 44 to be 43
                              path-dependency → registerLoadedSentinels 全量注册 失败(44 ≠ 43)
STATE 3 +canary −value-capture（43）: shell 9✅/0❌「动态取数=43」;  2 文件 16 passed
STATE 3b −canary −value-capture（42）: shell 9✅/0❌「动态取数=42」;  2 文件 16 passed
```

断言确实随目录集**双向跟随**；写死数字即红 ⇒ 「不是改成 43，而是动态取数」**成立**。

### D965-7 定向 vitest 34 passed / 门禁 shell 9✅0❌ —— **成立**

```
（在 /tmp 副本内我自己的运行）
✓ tests/sentinels/shared/d62-me-sentinels.test.ts (14 tests)
✓ tests/sentinel/d752-type-net-gate.integration.test.ts (4 tests)
✓ tests/sentinel/path-dependency-sentinel.test.ts (12 tests)
✓ tests/sentinel/finding-id-stability.test.ts (4 tests)
 Test Files  4 passed (4)      Tests  34 passed (34)
bash tests/control-tower/check-sentinel-type-net.test.sh → 全部通过: 9 ✅ / 0 ❌ (sh_exit=0)
```

**附加（发单方未要求）**：残留引用检查 —— `src/` 与 `extensions/` 中除 `_extinct/` 外零引用旧路径；两处新引用均指向 `_extinct/sentinel-{forecast-accuracy,pricing-strategy}/aggregate`。`task-state/D965.json` 中保留原 `write_set` 条目属卡面声明，非活引用。
**未复跑项**：定向 `tsc`（不在本轮判据清单内）；我以残留引用检查 + 运行时 load/register 替代。

---

# 二、D966 逐条自验结论

### 🚨 D966-1（发单方特别要求）「20/45 queryNodes 调用 = 0」—— **可复现；被验方「无法复现」不成立**

我自研探针在基线 `ce231ff1`、45 哨兵、生产库快照断面 A 上的**两种独立测量**：

```
方法级 queryNodes 调用=0 : 20 件
SQL 级 node 读 prepare=0 : 20 件
两者名单是否一致 = true
名单: agent-deployment-maturity, ai-ecosystem-fit, ai-investment-return, api-coverage,
customer-demand-shift, data-health, explore-exploit-balance, human-agent-boundary, make-or-buy,
moat-dependency, niche-breadth, niche-squeeze, opportunity-window, process-ai-readiness,
resource-misallocation, routine-mutation, sentinel-forecast-accuracy, sentinel-pricing-strategy,
strategy-capability-fit, value-capture
```

断面敏感性：`A/A2/B/C/D = 20`；`E（补 props 列 + 有图数据）= 11`；`D965 裁撤后 43 件 = 18`。
限定（必须同列）：这 20 件里 **18 件只是不直接调 queryNodes**，仍经 `traversal.traverse()` → `store.queryEdges/getNode` 触达图；「完全未触达图」仍只有 **2 件**（两个桩）。故：
**「queryNodes 调用 = 0」= 20 ✅（字面成立） ｜ 「空转/零调用」= 2 ✅（D966 的 R 成立）—— 两个不同口径，不能互相证伪。**

### D966-2 静态四扫 S1..S4 = 3/3/2/2（自实现）—— **成立**

```
S1 只扫 entryPoint · queryNodes 字样 = 0 : 3  [cash-runway, sentinel-forecast-accuracy, sentinel-pricing-strategy]
S2 只扫 entryPoint · 全无原语     = 0 : 3  [同上]
S3 整目录 · queryNodes 字样      = 0 : 2  [sentinel-forecast-accuracy, sentinel-pricing-strategy]
S4 整目录 · 全无原语             = 0 : 2  [同上]
assumption-check: 四种扫法里是否出现 20 = false          ← 「没有任何一种静态扫法得到 20」成立
S1→S3 差集（入口漏但目录有）: ["cash-runway"]
运行时对照: R(总 store 调用=0)=2 ｜ R2(queryNodes 调用=0)=20 ｜ R3(node SQL prepare=0)=20
```

### D966-3 V3 口径 42/3/23/2 归因 —— **成立（逐项实测）**

自研探针变体（`--arity` × `--entry`）：

| 变体 | 数组 | 非数组 | 加载失败/抛错 | 零A | 零B | 零C | 零调用 |
|---|---|---|---|---|---|---|---|
| V1 entryPoint+四参 | 42 | 3 | 0 | 29 | 30 | 30 | 2 |
| V2 硬编码 aggregate+四参 | 41 | 3 | 1（path-dependency 模块缺失） | 28 | 29 | 30 | 2 |
| **V3 硬编码 aggregate+二参** | **42** | **2** | **1** | 22 | 22 | **23** | **2** |
| V4 entryPoint+二参 | 43 | 2 | 0 | 23 | 23 | 23 | 2 |
| V5 entryPoint+三参（无 thresholds） | 42 | 3 | 0 | 29 | 30 | 30 | 2 |

与 CTO 声明对齐：数组 42 ✅ ／ 异常 3（= 2 非数组 + 1 缺件）✅ ／ 零 finding 23（列C）✅ ／ 零调用 2 ✅。
**两条独立成因**：① entryPoint 口径差 1 件（硬编码 aggregate ⇒ path-dependency 记缺件，`Cannot find module '…/path-dependency/aggregate.ts'`）✅；② 缺 traversal 差 6 件（V1 零A 29 → V4 零A 23）✅，且 V5（只缺 thresholds）零A 仍 29 ⇒ **差异来自 traversal 而非 thresholds** ✅。

**⚠️ 与 D966 表述的差异（细节）**：净差 6 件成立，但**逐件进出面是 7 出 / 1 进**：
```
零→非零 (7): ai-ecosystem-fit, ai-investment-return, explore-exploit-balance, moat-dependency,
             process-ai-readiness, routine-mutation, strategy-capability-fit   ← D966 名单缺最后一件
非零→零 (1): customer-demand-shift（非数组 → 空数组，进入数组口径的零集）
```
机制核实：`strategy-capability-fit/aggregate.ts:44`、`routine-mutation/aggregate.ts:21` 均为
`if (traversal) { const r = traversal.traverse([teamId], ['DEPLOYS']); if (!r.nodes[0]) return []; }`。

### D966-4 双列 29 / 30，差值 1 = customer-demand-shift —— **成立**

```
生产库快照断面: zero_findings_raw_count=29  zero_findings_unpacked_count=30
差额 1 件 = customer-demand-shift（raw 非数组 {findings:[],degraded:true}，解包 0）
```

### D966-5 P7 三态（自建夹具 19 节点 + 3 边）—— **成立（含「补列不够」）**

```
═══ 写路径（createNode → createEdge → queryEdges 读回）═══
P-A legacy      : createNode OK ｜ createEdge THREW: table graph_triples has no column named props ｜ read-back 0
P-D props-added : createNode OK ｜ createEdge THREW: datatype mismatch ｜ read-back 0   ← 判别性证据：补列 ≠ 修好
P-F canonical   : createNode OK ｜ createEdge OK id=edge-438d49b4-… ｜ read-back 1 行 ｜ 表 4 行
```

读侧断面矩阵（同节点同边，仅换 schema 断面；我自研探针）：

| 断面 | 数组 | 非数组 | 零A | 零B | qE 调用 | qE 读到行 | SQL prepare 失败 | 有边读哨兵 |
|---|---|---|---|---|---|---|---|---|
| P-A 19 节点 / 0 边 / legacy | 42 | 3 | 25 | 26 | 49 | **0** | 49 | 41 |
| P-B 19 节点 / 3 边 / legacy | 42 | 3 | 25 | 26 | 49 | **0** | 49 | 41 |
| P-D 3 边 / props-added | 43 | 2 | **16** | **16** | 49 | **144** | 0 | 41 |
| P-F 3 边 / canonical | 43 | 2 | **16** | **16** | 49 | **144** | 0 | 41 |

⇒ 与 D966 §4.3 的 B/D/F 三行**逐项相同**（25/26、16/16、144 行、49 调用、0→49 失败）。

### D966-6 方法层「假绿」—— **成立**

```
有 queryEdges 调用的哨兵数 = 41 ｜ 边读 SQL prepare 的哨兵数 = 41 ｜ 其中失败 = 41
边读调用总数 = 49 ｜ prepare 总数 = 49 ｜ 失败 = 49
node 读 prepare 总数 = 48 ｜ 两类合计 = 97      ← 与「SQL 层 prepare 97/49」逐项吻合
边读真的读到的行数 = 0
方法层 queryEdges 是否抛过错 = NO（无一次抛错=静默 fail-open）
```
即：方法层 41 个哨兵「正常返回空数组」↔ SQL 层 49/49 全失败 ↔ 真读 0 行；`queryEdges` 的 catch 只 `log.warn` + `return []`，**调用方拿不到 degraded**（铁律 11/31 意义上的静默降级）——**证实，非证伪**。

### D966-7 方向不单调（B → D/F 逐哨兵）—— **成立**

```
产出改变哨兵数 = 15 ｜ 增 13 ｜ 减 2
↑ ai-ecosystem-fit, ai-investment-return, api-coverage, competitive-moat(1→2), customer-demand-shift,
  data-health, explore-exploit-balance, niche-squeeze, process-ai-readiness, resource-misallocation,
  routine-mutation, strategy-capability-fit, value-capture
↓ software-health 4→0 ｜ unit-economics 3→0
零 finding: 零A 25→16 ｜ 零B 26→16   边读行数: 0→144
```
与被验方 §4.4 的**名单与数字逐项一致**。

### D966-8 夹具 10 it / 25 expect / 红绿对照 —— **成立**

```
grep -c "expect(" sentinel-audit.test.ts = 25 ｜ grep -c "  it(" = 10
未改动运行: Test Files 1 passed (1) ｜ Tests 10 passed (10)
CI 口径 SYNOVA_PROD_DB_CAPTURE=/nonexistent/ci.db: Test Files 1 passed (1) ｜ Tests 10 passed (10)
fail-closed（prod-snapshot + 快照缺失）: 显式抛错「D966 前置条件失败：生产库不存在 /nonexistent/ci.db」
pinned-prod-schema 对照: 建表成功，graph_triples 无 props（漂移态）✅
```
改坏即红（我在 /tmp 副本注入 `edges: threeEdges('INJECTED-RED')`）：**4 failed | 6 passed**
```
× T1 canary: 三个夹具的边数据都真实落库 → AssertionError: expected +0 to be 3
× T3 canonical 断面：同一夹具读到 3 行 → AssertionError: expected +0 to be 3
× T4c 整表重建为 canonical：写边成功 → AssertionError: expected 1 to be greater than or equal to 3
× T5 legacy 0 条 / canonical ≥1 条 → AssertionError: expected 0 to be greater than 0
```
红证清理：我副本注入前 1 处、还原后 0 处；被验分支 `tests/sentinel/audit/**` 内 `INJECTED-RED` = **0**；
diff 中 3 处命中**全在 `D966-sentinel-idle-repro-evidence.md` 散文**（描述注入手法/清理命令），非活夹具。

### D966-9 两点/三点 diff 与 D708 夹带判定 —— **成立（含一处表述修正）**

```
两点 diff origin/main..HEAD  : 13 文件（= 11 卡内文件 + 2 个 main 侧幻影）
  其中幻影: D .claude/task-briefs/2026-09-25-D964-ledger-row6.md
            M docs/synova/coordination/审计发现台账-DSH-CTO.md
  （发单方转述为「2 个删除文件」——实测是 1 个 D + 1 个 M）
三点 diff origin/main...HEAD : 11 文件（恰为卡内文件）
git log --diff-filter=D origin/main..HEAD : 空（本卡从未删文件）
引入来源: 0f709900 相对 ce231ff1 改了这 2 个文件 → 分支缺它 ⇒ 两点 diff 显示为反向幻影
D708 门禁（merge_writeset_gate.py）取 merge-base 后 diff（= 三点语义），检出树实跑：
  D966: ✅ pass — 提交文件集 ⊆ 声明写集（无夹带）｜ 变更集 11 文件（merge-base ce231ff1）
  D965: ✅ pass — 无夹带 ｜ 变更集 47 文件（merge-base 0f709900）
  ⇒ 两点幻影**不会**导致 D708 误判夹带（门禁用三点口径）
```

---

# 三、与发单方/被验方数字不一致之处（逐条）

| # | 来源 | 其数字 | 我的实测 | 性质 |
|---|---|---|---|---|
| 1 | 发单方转述 D966 §3.2 | 「没有任何一种扫法得到 20」 | **运行时可复现 20**（方法与 SQL 双测一致；静态 S1..S4 确实无 20） | 🔴 影响已上报结论，建议更正为「20 = queryNodes 方法级调用数=0 口径，A–D 断面 20 / E 断面 11」 |
| 2 | D966 §3.1 差集名单 | 6 件（V1 零产出但 V4 有产出） | 净差 6 ✔，但**逐件 7 出 / 1 进**，第 7 件 `strategy-capability-fit` 被 `customer-demand-shift` 入零集抵消 | 🟡 结论方向对，名单缺 1 件 |
| 3 | 发单方转述 D966 | 「2 个删除文件」 | 两点 diff 幻影 = 1 个 D + 1 个 M（共 2 文件） | 🟡 数量对、类型表述需修正 |
| 4 | 发单方写 D965 基线 | ce231ff1 | D965 分支实际基于 `0f709900`（ce231ff1 的下一提交）；哨兵域零差异 | 🟡 卡面 base 字段与事实不符（D965 task-state 也写 ce231ff1） |
| 5 | D966 §2.1 | 「A 空库 + legacy」零A 28 / 零B 29 | 生产快照真空白 = 29/30；19 节点 0 边 = 25/26；**B/D/F 三行与我逐项相同** | 🟡 其 A 断面夹具定义歧义（「空库」可能仍含节点），无法在不明其夹具种子时精确对齐；不影响判别性结论 |
| 6 | D965 定向 tsc | 3 次均空（过滤 `_extinct/` 等） | **未复跑**（不在判据清单）；我做了残留引用检查（零残留） | ⚪ 未复现项，非不一致 |

# 四、未能复现项（诚实登记）

1. **D965 定向 `tsc --noEmit`** 未独立重跑（机器重型串行 + 不在发单方判据清单）；替代检查：旧路径在 `src/`、`extensions/` 零残留引用 + loader 运行时 43/43 注册 0 错。
2. **D966 §2.1「A 空库」的 28/29**：被验方未给出该断面的夹具种子；我用两个明确定义的断面（真空白 29/30、19 节点 0 边 25/26）替代，B/D/F 三行完全对齐。
3. **未运行被验方脚本**（除 D708 门禁本体作为对照）：按纪律全部用自建探针/夹具；被验方 `run-*.ts` 的原始输出未逐条对拍（其结论已由我的独立实现覆盖）。
4. **D967/D968 未验**（发单方指定本阶段只验 D965/D966）。

# 五、红线自证

- 未修改任何仓库文件；`git status --short` 在被验工作树为空；全部实验树/夹具在 `/tmp/verify-d965/**`。
- 生产库 `data/synova.db` 只读；探针只对 `.backup` 快照副本写入。
- 未复用被验方脚本作判据来源；未写「审计通过」；未对 `scripts/audit/**` 作任何改动。
