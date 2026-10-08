# D1171 · W5 提案 — 核心 hermetic step「不再 skip」（门禁语义变更）

> **性质**：🔴 **门禁语义变更** ⇒ 纪律 = **提案 → K3 过审 → CTO 裁**；K3 结论前**不合并**，本线**不自判通过**。
> **出件**：治理线（GV-）｜ 2026-10-06 ｜ **状态：未裁**（本件只出提案 + 实测；实现件在 PR，不合并）
> **派单源**：CTO《开发计划 v2》A 槽 **W5**：「核心 hermetic step 加 `if: always()` 或独立 job ⇒ 该 step 在 PR run **不再 skip**」
> **基线 ref**：`54bfc3c7bc4f3447867a60f4fea8a7824c847429`

---

## 一、病灶（**实测**，非推断）

`Control Tower Gate Tests (ubuntu-latest)` 是 **main 分支保护的必需 context**（9 条之一）。
它承载的**核心重活** = step `Run hermetic control-tower gate tests`（密封测试清单，本树 **118** 条目）
+ `check-dsh-anchor` 自扫。

但该 step 带一条**路径判据门**（`ci.yml:512-516`）：
```yaml
if: >-
  github.event_name == 'schedule'
  || github.event_name == 'workflow_dispatch'
  || (steps.docsonly.outputs.docs_only != 'true'
  && (steps.ctsignal.outputs.run == 'true' || inputs.force_control_tower_tests == true))
```
⇒ 只有当「变更路径命中控制塔域」时才跑。

**实测（独立测量，as_of 2026-10-06）**：

| 量 | 值 |
|---|---|
| 最近 40 条 `ci.yml` run（滚动窗口 ~2h31m） | failure 15 / cancelled 14 / **success 11** |
| **success 的 11 条里，该 step 被 skip** | **10 / 11 = 90.9%** |
| 40 条里该 step **真正执行过** | 10 / 39 ≈ **25.6%** |
| 跳因（逐条抓分类器日志） | 10 条 success 的 classifier 输出 `结论: MISS ⇒ run=false` |

⇒ **后果**：必需 context `Control Tower Gate Tests (ubuntu-latest)` 在**没跑任何控制塔门禁**的情况下
**照样以 success 上报** ⇒ 「跳过 = 成功」通道在该 context 上**完全敞开**。

### 与 W3（聚合 job）的关系 —— **W5 不可被 W3 替代**
W3 的 `all-checks-passed`（另笔 #1168）判的是 **job 级** `needs.*.result`。
本处被 skip 的是 **job 内的 step**；该 **job 本身结论 = success**（这是 D1039 的设计：job 恒被调度、
必需 context 必报，跳过只发生在 step 级）。
⇒ **W3 在结构上抓不到本处**。两条**正交**，都必须做。

---

## 二、三个候选（含代价）

| 候选 | 做法 | 代价（实测/估算） | 满足 W5 判据？ |
|---|---|---|---|
| **A** | 重活 step 的 `if:` 去掉路径门（保留 docs-only 与 schedule/dispatch 分支）⇒ **非 docs-only PR 恒跑** | 每条非 docs-only PR run **多 ~13 分钟**（该 job `timeout-minutes: 14`；step 级 13）。按现队列 ~120 open PR、每 PR 至少 1 run 估 ⇒ **≈26 机时/轮** | ✅ 直接满足 |
| **B** | 把重活抽成**独立 job**（恒跑），原 job 保留判据门 | 与 A 同量级（同一条重活），但多一个 job 名 ⇒ 若进必需集就是**新增必需 context**（须同批改 branch protection，属更大变更） | ✅ |
| **C** | **两层**：把**快的那部分**（秒级：`ci-signal-classify` / `gate-failopen-net` / `d956-failmsg` 等）抽成**恒跑 step**；118 条的**全量密封套件**仍走路径门 | 每次 PR 多**秒级**；全量仍只在控制塔域跑 | ⚠️ **部分** —— 严格读判据「该 step 不再 skip」不成立（被抽走的那个 step 仍会 skip） |

### 我的倾向与代价（依判例库 B 档要求写全）
- **倾向 A**：它**字面满足** CTO 判据，且是最小结构改动（只改一个 `if:` 表达式，不新增 job/context）。
- **代价**：CI 成本上升一个量级（≈13 min × 每条非 docs PR）；且**队列吞吐会下降**——
  这与 CTO 自己在 D1014/D1039 立过的「**队列放大器**」顾虑**方向相反**（当时正是为省这条重活才加的路径门）。
- **若你更看重吞吐** ⇒ 选 **C**，但**须把 W5 判据改写成**「*核心*门禁不再 skip；全量套件按路径门」
  （即：**判据本身要改**，不是实现绕过去）。🔴 **我不自行二选一** —— 因为 A 与 C 的差别正是
  「**判据是否成立**」，属判据变更（须你裁 + K3）。

---

## 三、同批必须改的夹具（结构变更，有先例）

`tests/control-tower/ci-signal-classify.test.sh:226-227` **逐字固定**了「重活 step 消费判据输出」：
```bash
printf '%s' "$CTJOB" | grep -q 'steps.ctsignal.outputs.run' \
  && ok "接线: 重活 step 消费 ctsignal.outputs.run" || no "重活 step 未消费判据输出"
```
⇒ 选 A 则**这条断言必红**（重活 step 不再消费该输出）⇒ **必须同批改**该夹具的**期望值**。
**这不是"改夹具迁就实现"**：D1147 有**同类先例** —— 该文件 `:240-248` 的注释原文即
「这是**有意的门禁结构变更，随本卡同批送 K3/CTO 过审**（PR 正文点名），不是"改夹具迁就实现"：
钉子的**语义**逐字保留，改的只是**期望值**」。
⇒ 本提案沿用该先例：**保留钉子的语义**（"重活 step 的存在与门控必须逐字可核"），只把
"消费 `steps.ctsignal.outputs.run`"改为"恒跑（非 docs-only）"。

---

## 四、红线（本实现件遵守）

- 不改 `.github/workflows/ci.yml` 里任何既有 job 的 `name:`（9 条必需 context 名的唯一产出者）
- 不加 job 级 `if:` / `paths:` 到 `control-tower-tests`（那会让必需 context 永不报告 —— D971 型失效）
- 不碰 `scripts/audit/**`（K3 红线）
- 不删密封清单条目、不把重活改 `continue-on-error`、不加 `|| true`
- 不改 `scripts/control-tower/check-pr-budget.sh`（阈值归 #1017）

---

## 五、需要你裁的（**三选一**）

1. **选 A**（恒跑，字面满足判据，代价 = CI 成本升一档、吞吐降）
2. **选 C**（两层；**须同时改写 W5 判据**为"核心门禁不 skip"，代价 = 判据变更本身要被 K3 审）
3. **选 B**（独立 job 恒跑；须同批动 branch protection 加一个新必需 context）

**我倾向 A**（字面满足、改动最小、不需动 branch protection）；
**但如果你更看重队列吞吐，C 更优 —— 那需要你先把判据改写清楚，我再实现。**

---

## 六、未做 / 未核（V-09）

- **未实现**：本件只出提案（判据未裁，实现无意义）。实现件将随裁一起出。
- **成本数字**（≈13 min/PR、≈26 机时/轮）是**估算**，未做全量机时统计 —— 标注为估。
- 「该 job `timeout-minutes: 14`、step 级 13」取自 `ci.yml` 现状，未重新测 P95。
