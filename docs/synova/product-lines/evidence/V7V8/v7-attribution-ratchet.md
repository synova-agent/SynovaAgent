# V7 · 归因棘轮 → 真门禁（判据 + 两段原始输出）

> 判据本体：`tests/ci/attribution-ratchet-probe.sh`（本卡新建，**不在** `.github/**`）
> 原始输出：`raw/v7-probe-against-current-ciyml.txt` ｜ `raw/v7-probe-against-patched-ciyml.txt`
> 补丁副本：`raw/ci-patched.yml`（生成脚本 `raw/make-patch.py`）｜ 逐行 diff 与理由：`ci-patch-proposal.md`

---

## 1. 现状（本卡实测，非引用）

`.github/workflows/ci.yml` 的 `Run tests` step（L246–269）在 vitest 非 0 后：

```bash
FAILED_TESTS=$(echo "$CLEAN_OUTPUT" | grep " FAIL " | grep -oP 'tests/\S+\.test\.ts' || true)
if [ -n "$FAILED_TESTS" ] && [ -n "$CHANGED" ]; then
  ... 逐个判"是否在本次改动集内" ...
  if [ -z "$NEW_FAILURES" ]; then
    echo "::warning::Vitest 存量红放行（…）"
    exit 0          # ← 归因外失败 = 放行，且是**全有全无**
  fi
  ...
fi
exit 1
```

**三条结构性缺陷**（探针场景固定住，逐条有原始输出）：

| # | 缺陷 | 后果 |
|---|---|---|
| ① | 失败清单用 `grep -oP 'tests/\S+\.test\.ts'` 提取 ⇒ **路径不含 `tests/` 子串的失败整条丢掉**（`extensions/**`、`scripts/**`…） | 这类失败**从不进入判定** |
| ② | 同一条正则对 `packages/x/tests/**` 只匹配 `tests/` 之后的部分 ⇒ **前缀被截断** ⇒ 归因到**不存在的文件** | 错归因；实测被静默放行 |
| ③ | `if [ -z "$NEW_FAILURES" ]; then exit 0` ⇒ **只要没有一条可归因，全部失败一起放行**（全有全无） | 一条永远无法归因的红（`tests/l3/graphbridge-wiring.test.ts`，其映射源 `src/l3/graphbridge-wiring.ts` **在仓内不存在**）就**永久豁免了所有红** |
| ④ | （`exclude` 之外）**完全没有到期语义** —— 台账、owner、expires 在 job 层不存在 | 棘轮只增不减，与判例 M-03 冲突 |

> 现状与铁律 36「vitest 必须全量通过、零失败才合并」矛盾：
> PR 面上只要"没有可归因的失败"，作业就 `success`。

---

## 2. 判据设计（为什么这不是"判据的影子实现"）

```
① 逐字提取 .github/workflows/ci.yml 里 `Run tests` step 的 `run:` 正文（唯一真值源）
② scratch git 仓构造受控 CHANGED（可切 PR 面 / main push 面）
③ PATH 上 npx shim 喂受控 vitest 输出
④ 跑「提取出来的真实 step 正文」，读 exit code，对照必备语义判红/绿
```

- **没有重写判据逻辑** —— 被测对象就是 ci.yml 里的原文；`--ci-yml` 换文件即可复验补丁。
- **三态退出码**（判例 M-02）：`0` 全绿 / `1` 有必备语义被违反 / `2` 探针自身失败（提取不到正文、缺 python3…）。
- **环境归一 2 条，已显式声明**（不是静默）：`${{ matrix.shard }}` → `1/2`（GitHub 展开）；
  `grep -oP` → 本机 BSD grep 无 `-P`，shim 用 python3 实现该语义（CI 上是真 GNU grep）。

### 8 条必备语义（场景）

| 场景 | 姿态 | 输入 | 必备 exit |
|---|---|---|---|
| S0 | PR | 无失败（对照组） | 0 |
| **S1** | PR | 归因外失败：`tests/` 内、PR 未改 | **≠0** |
| **S2** | PR | 归因外失败：`extensions/`（路径不含 `tests/`） | **≠0** |
| **S3** | PR | 归因外失败：`packages/test-kit/tests/` | **≠0** |
| S4 | PR | 可归因失败（PR 确实改了 `src/smoke.ts`） | ≠0 |
| S5 | main push | CHANGED 空 + 归因外失败 | ≠0 |
| **S6** | PR | 归因外失败 + 台账登记**未过期** ⇒ 允许放行 | 0 |
| **S7** | PR | 归因外失败 + 台账**已过期** ⇒ 必须红（M-03） | **≠0** |

---

## 3. 补前：对**现存** `ci.yml` 跑判据 ⇒ **exit 1（5/8，违反 S1/S3/S7）**

```
$ bash tests/ci/attribution-ratchet-probe.sh --verbose
PROBE_EXIT=1
[probe] ci.yml = /Users/wane/SynovaAgent/.synova-wt-tests/.github/workflows/ci.yml
[probe] step   = Run tests (逐字提取)
[probe] extracted step body: 39 lines

── S1: PR 面 归因外失败：tests/ 内、PR 未改该文件
   required_exit!=0
   observed_exit=0
   ❌ 违反必备语义
   |  FAIL  tests/l3/graphbridge-wiring.test.ts > GraphBridge > case
   | ::warning::Vitest 存量红放行（非本 PR 改动文件引入，main 上同样红）: tests/l3/graphbridge-wiring.test.ts tests/other-unrelated.test.ts

── S3: PR 面 归因外失败：packages/test-kit/tests/ 下
   required_exit!=0
   observed_exit=0
   ❌ 违反必备语义
   |  FAIL  packages/test-kit/tests/architecture/01-layer-boundaries.test.ts > a > b
   | ::warning::Vitest 存量红放行（…）: tests/architecture/01-layer-boundaries.test.ts
   ↑ 注意：提交的是 **tests/architecture/...**，前缀 packages/test-kit/ 被正则截断 ⇒ 错归因

── S7: 归因外失败 + 台账已过期 ⇒ 必须红（M-03）
   required_exit!=0
   observed_exit=0
   ❌ 违反必备语义

══ 探针结论 ══
  必备语义: 5/8 成立；违反 3
  违反项: S1 S3 S7
  ⇒ 判据红：存在被静默放行的归因外失败
```

**S1 就是卡面说的那条链**：红 → 归因不到 → `::warning::` → `exit 0` → **全绿**。
**S3 是新发现**：`grep -oP` 的前缀截断把 `packages/test-kit/tests/...` 变成 `tests/architecture/...` ⇒ **错归因**。
**S7 是新发现**：job 层**根本没有到期语义**（M-03 只在 `ci-red-baseline.txt` 的 check 名层有）。

> 对照实测（`S5`）：**main push 姿态**（CHANGED 空）下 step 走 `exit 1` ⇒ **是红的**。
> ⇒ 精确结论是：**"永久放行"发生在 PR 面**；main push 面红但该红归因不到任何 PR。
> 卡面写"该红永远归因不到任何 PR ⇒ 永久放行"——**方向对，位置要精确到 PR 面**（本卡实测修正）。

---

## 4. 补后：对**补丁副本**跑同一判据 ⇒ **exit 0（8/8）**

```
$ bash tests/ci/attribution-ratchet-probe.sh \
      --ci-yml docs/synova/product-lines/evidence/V7V8/raw/ci-patched.yml --verbose
PROBE_EXIT=0
[probe] extracted step body: 63 lines        # 39 → 63（补丁后）

── S1: observed_exit=1  ✅
   | ::error::Vitest 阻断（本 PR 引进，或归因外未登记/已过期）:
   | tests/l3/graphbridge-wiring.test.ts (归因外未登记/已过期)
── S2: observed_exit=1  ✅   （extensions/ 路径不再被丢）
── S3: observed_exit=1  ✅   | packages/test-kit/tests/architecture/01-layer-boundaries.test.ts (归因外未登记/已过期)
                              ↑ 全路径，前缀不再被截断
── S4: observed_exit=1  ✅   | tests/smoke.test.ts (本 PR 引进)
── S5: observed_exit=1  ✅
── S6: observed_exit=0  ✅   | ::warning::Vitest 台账内存量红放行（未过期；铁律 11 可见）: …(登记至 2099-01-01)
── S7: observed_exit=1  ✅   （过期 ⇒ 红，M-03 成立）

══ 探针结论 ══
  必备语义: 8/8 成立；违反 0
  ⇒ 判据绿：归因外失败会红（放行只走"台账 + 未过期"这一条路）
```

---

## 5. 🔴 验证级别（判例 V-01 / V-09）

| 命题 | 级别 | 依据 |
|---|---|---|
| 现存 `ci.yml` 的 PR 面会静默放行归因外失败 | **L2-真跑通** | 逐字提取真实 step 正文 + 受控输入，得 `exit 0` |
| 正则前缀截断造成错归因 | **L2-真跑通** | 同上，输出里可见被截断的路径 |
| 补丁副本满足 8/8 必备语义 | **L2-真跑通** | 同上，得 `exit 0` |
| **补丁落 main 后 CI 真的会红** | **🔴 未验** | 本会话不取 GitHub Actions 真运行结果；`.github/**` 不在本卡写集 ⇒ **只到"本地等价判据"为止，真 CI 断言未验** |

> 按判例 V-09：**未核实项必须显式写"未核"，不许把"未核"写成"已核"。**
> 收口动作（不属本卡）：补丁经治理线 A 槽落 main → 复跑一次真 CI → 才可把第 4 行改判 L2。
