# CT10-win — 黄金门禁覆盖度可见 + 空集恒真修复（D1056）

> 任务: D1056 ｜ 分支: `fix/ct10-win-golden-20260928` ｜ 工作树: `/Users/wane/SynovaAgent/.synova-wt-ct10-win`
> 成员: ct10-exec（A）｜ 日期: 2026-09-28
> 域: **win**（`scripts/ci/**` + `tests/ci/**`）— 与 mac 主批（D1055）分属两个 PR
> 依据: CTO 裁定「③ 的定性与修法按依据计划 D1046，不按派单件字面」

⚠️ **全文只说「自验结论」，不说「审计通过」**（审计权归 K3）。

---

## 〇、前置：队长前提冻结逐条复核（全部与卡面一致）

| # | 卡面前提 | 我的实测命令 | 原始输出 | 判定 |
|---|---------|-------------|---------|------|
| P1 | `scripts/ci/` 下只有 2 个 golden 脚本 | `ls scripts/ci/golden-*.ts \| wc -l` | `2`（`golden-case-checker.ts` / `golden-snapshot-runner.ts`） | ✅ 成立 |
| P2 | `tests/fixtures/golden-cases/*.json` = 11 件 | `ls tests/fixtures/golden-cases/*.json \| wc -l` | `11` | ✅ 成立 |
| P3 | `computeFnRegistry` 登记 1 条 | `grep -n computeFnRegistry scripts/ci/golden-snapshot-runner.ts` | `:82 export const computeFnRegistry ... = {` / `:83 computeCashRunway: (input) =>` / `:85 };` | ✅ 成立（1 条） |
| P4 | `GOLDEN_COMPUTE_INPUTS` 1 条 | `grep -rn GOLDEN_COMPUTE_INPUTS` | `golden-case-checker.ts:373` 定义、`:396` 使用；仅 `'cash-runway'` 一条 | ✅ 成立 |
| P5 | ① `:386` 前加 1 行（`skipped` 已统计、从不打印） | 读 `golden-snapshot-runner.ts:386-388` | `:386 if (checked === 0) {` / `:387 diffs.push(...跳过 ${skipped} 个...)` —— 通过路径**零打印** | ✅ 成立 |
| P6 | ③ `golden-case-checker.ts:270` `Object.values({}).every()` 空集恒真 | 读 `:270` | `const snapshotPassed = Object.values(snapshotResults).every((r) => r.passed);` | ✅ 成立 |

**无前提冲突项**。唯一分歧在 ③ 的**修法语义**（见 §一），已按规矩停手报队长（消息 `team-message-503e9196`）。

---

## 一、🔴 ③ 修法的口径分歧（实测证据 + 我的裁定理由）

### 1.1 卡面字面 vs 实测后果

卡面写「③ 空集恒真 → 对齐 `golden-snapshot-runner.ts:386-388` **显式判红**」。
字面照做（未覆盖 ⇒ `snapshotPassed=false` ⇒ `casePassed=false`）的**实测后果**：

**证据 A — 10/11 fixture 无快照段**（命令与全部输出）：
```
$ for f in tests/fixtures/golden-cases/*.json; do
    echo "$(basename $f): compute=$(grep -c '"compute"' $f) findings=$(grep -c '"findings"' $f) expertReport=$(grep -c '"expertReport"' $f)";
  done
golden-case-01-cashflow-crisis.json: compute=0 findings=0 expertReport=0
golden-case-02-margin-erosion.json: compute=0 findings=0 expertReport=0
golden-case-03-churn-surge.json: compute=0 findings=0 expertReport=0
golden-case-04-talent-drain.json: compute=0 findings=0 expertReport=0
golden-case-05-competition-attack.json: compute=0 findings=0 expertReport=0
golden-case-06-efficiency-attraction-failure.json: compute=0 findings=0 expertReport=0
golden-case-07-tech-debt-explosion.json: compute=0 findings=0 expertReport=0
golden-case-08-regulatory-fine-risk.json: compute=0 findings=0 expertReport=0
golden-case-09-market-expansion-failure.json: compute=0 findings=0 expertReport=0
golden-case-10-knowledge-loss-crisis.json: compute=0 findings=0 expertReport=0
golden-case-11-cash-runway-threshold.json: compute=1 findings=0 expertReport=0
```

**证据 B — 该 checker 就是全队 pre-push 与 CI 的执行体**：
```
$ grep -rn "golden-case-checker" scripts/pre-push-check.sh .github/workflows/ci.yml
scripts/pre-push-check.sh:276:if ! npx tsx scripts/ci/golden-case-checker.ts; then
.github/workflows/ci.yml:564:        run: npx tsx scripts/ci/golden-case-checker.ts
```

**证据 C — 「未覆盖不阻断」是**既有绿腿钉住的契约**，不是空白**：
```
$ sed -n '255,265p' tests/ci/golden-case-checker.test.ts
  it('旧 fixture（无 compute 段）→ 只跑 F1，向后兼容', async () => {
    ...
    // 旧 fixture 无快照段 → checker 应只跑 F1 门禁，不报错
    expect(data.compute).toBeUndefined();
```
以及 `scripts/ci/golden-case-checker.ts:265` 自带注释：
`// D396: 三层快照检查（向后兼容——旧 fixture 无快照段则跳过）`

**证据 D — 既有绿腿直接断言「未篡改 ⇒ checker exit 0」**：
```
$ sed -n '82,92p' tests/ci/golden-case-break-test.sh
── Step 3: trap 还原 + 恢复断言 ──
  elif npx tsx "$CHECKER" > /dev/null 2>&1; then
    pass "还原后 checker exit 0 — trap 还原生效"
```

### 1.2 结论：字面 ③ 在我写集内无法落成绿交付

字面 ③ 会：①推翻 `golden-case-checker.test.ts:255` 与 `golden-case-break-test.sh:88` 两条既有绿腿；
②让 `pre-push-check.sh:276` 阻断全队所有推送；③让 `ci.yml:564` 在每个 PR 上常红；
④修它需要给 10 个 fixture 补快照段，而 **`tests/fixtures/golden-cases/**` 不在本卡写集内**
⇒ 违反统判据③「不留未接线/待后续」，且属卡面自陈「改门禁语义 ⇒ 需 CTO 批」的范畴。

**我落地的 ③（等价消除空集恒真，不引入新门禁语义）**：
- 空集**不再产出 `passed=true`** → 改判为 `passed=null`（未覆盖：既非 pass 也非 fail，**不作判定**）；
- 未覆盖**逐案 + 汇总显式可见**（原来完全不可见）；
- checker 退出码语义保持不变（D396 向后兼容边界照旧）。

**这不是"降低要求"**：原实现让「没有被任何快照层判定过」的案例静默躺在 `snapshotPassed=true` 上；
修复后同一事实变成 `passed=null` + 一行 `快照层: 未覆盖（无快照段）— 不作判定`，
**"通过"这个词不再被未判定的事实冒领**。

**✅ CTO 已裁（2026-09-28，经队长转达 · 第 3 项裁定）：采纳「中间方案」（显式记未覆盖 + 覆盖度可见）。**
即：本件落地的形态**就是 CTO 批准的形态**，**不采用**卡面字面「未覆盖 ⇒ 硬判红」。
裁定同时把「字面口径未落地」归入**后续卡**（不在本批补做）⇒ 本节**不再存在"待复核"状态**。
依据（CTO 同批裁定的理由）：`tests/fixtures/golden-cases/**` 补齐属**另卡**范畴；
CTO **不接受**全队 pre-push/CI 常红；同批 CTO 亦认同「在猜测上建新机制比不建更糟」的判断取向。
⇒ 本节结论由「**待 CTO 复核**」正式转为「**已裁定 · 中间方案获批**」。

---

## 二、交付逐条改动（文件:行 + 为什么）

### ① 覆盖行可见 — `scripts/ci/golden-snapshot-runner.ts`（+4 行，0 删）

| 位置 | 改动 | 为什么 |
|------|------|--------|
| `:386`（原 `:385` 之后，`if (checked === 0)` **之前**） | 新增 1 条 `console.log`：`[golden-snapshot-runner] 黄金数据集 compute 覆盖: 实际检查 N 个 / 跳过 M 个（registry 已登记 K 个 / 数据集哨兵 J 个）` | `checked`/`skipped` 原本**只在 `checked===0` 的失败分支里被读到**，绿态对"到底查了几个"完全无信息（D1046：覆盖不足 + **覆盖度不可见**）。无条件打印使绿态也暴露真实覆盖面 |

### ③ 空集恒真修复 — `scripts/ci/golden-case-checker.ts`（+48 行，−2 行）

| 位置 | 改动 | 为什么 |
|------|------|--------|
| `:221-248`（新增） | 新增**导出纯函数** `decideSnapshotVerdict(results)`：`covered=false → passed=null`；`covered=true → every(passed)`。含契约 JSDoc（@input/@output/@degraded，铁律 47） | 把三态判定从内联表达式抽成**可独立打靶的纯函数**，使 ③ 拥有真正的「改坏即红」夹具（见 §四 L4-red）；同时消掉 `Object.values({}).every()` 空集恒真 |
| `:282-284` | 新增 `coveredCases` / `uncoveredCases` 台账 | 覆盖度要"可见"就得有计数载体 |
| `:301-311` | 原 `const snapshotPassed = Object.values(snapshotResults).every(...)` → `const snapshotVerdict = decideSnapshotVerdict(snapshotResults)` + `casePassed = f1.passed && snapshotPassed !== false` | 空集不再恒真为 `true`；`!== false` 保持 D396「未覆盖不阻断」边界**逐字等价** |
| `:344-346` | 未覆盖案打印 `快照层: 未覆盖（无快照段）— 不作判定` | 未覆盖必须显式可见，不得因"没有可打印行"被读者读作通过 |
| `:380-381` | 汇总新增 `快照覆盖: N/11 案例（未覆盖 M 个 — 无快照段，不作判定）` | `通过: 11/11` ≠ `被快照层判定 11/11`，两者必须分开可见 |

### 新增夹具 — `tests/ci/golden-dataset-coverage.test.sh`（新建）

四腿 / 15 断言；L1/L2/L3 来自 D1046 报告 §188 原文口径，L4 是本卡 ③ 的判别腿。

### 未改动（守住写集边界）
- **未**碰 `tests/fixtures/golden-cases/**`（不在写集；这是 ③ 字面方案受阻的根因）
- **未**碰 `scripts/ci/golden-snapshot-runner.ts:310` 的 L2c 边界契约（「registry 登记什么查什么，不因未登记全量红」）——**未加上限地板**
- **未**做「未注册 expected 逐个登记」
- **未**碰 `scripts/audit/**`（K3 专属）、`.github/workflows/ci.yml`、`scripts/pre-push-check.sh`

---

## 三、改前 / 改后原始输出对照

### 3.1 改前（基线，命令：`npx tsx scripts/ci/golden-case-checker.ts`，exit=0，elapsed=1s）

```
═══════════════════════════════════════════════════════════
  Golden Case F1 Gate — 黄金案例回归测试
  案例数: 11
═══════════════════════════════════════════════════════════

  ✅ golden-case-01: 现金流危机 — F1 PASS (边缘=1.0, 节点=1.0, 级别=true)      ← 无任何快照层信息

  ✅ golden-case-02: 利润侵蚀 — F1 PASS (边缘=1.0, 节点=1.0, 级别=true)
  ...（03–10 同形，均无快照层信息）...
  ✅ golden-case-11-cash-runway-threshold: 现金流阈值告警（D356 修复对象） — F1 PASS (边缘=1.0, 节点=1.0, 级别=true)
     compute 快照: PASS

──── 阶段 5: 黄金数据集检查 (D474) ────                       ← 覆盖度无任何输出
═══════════════════════════════════════════════════════════
  结果: ✅ 全部通过
  通过: 11/11                                                 ← 11/11 通过 ≠ 11/11 被判定（不可见）
  黄金数据集: ✅ PASS
═══════════════════════════════════════════════════════════

[GATE] 全部 11 个黄金案例通过 — F1 门禁开放
```
**改前缺陷的物理指纹**：`快照层` 相关字样出现 **0 次**；`阶段 5` 下**零行**；`通过: 11/11` 无覆盖度旁注。

### 3.2 改后（命令同上，exit=0，elapsed=0s）

```
  ✅ golden-case-01: 现金流危机 — F1 PASS (边缘=1.0, 节点=1.0, 级别=true)
     快照层: 未覆盖（无快照段）— 不作判定
  ...（02–10 同形，各一行）...
  ✅ golden-case-11-cash-runway-threshold: 现金流阈值告警（D356 修复对象） — F1 PASS (边缘=1.0, 节点=1.0, 级别=true)
     compute 快照: PASS

──── 阶段 5: 黄金数据集检查 (D474) ────
[golden-snapshot-runner] 黄金数据集 compute 覆盖: 实际检查 1 个 / 跳过 15 个（registry 已登记 1 个 / 数据集哨兵 16 个）
═══════════════════════════════════════════════════════════
  结果: ✅ 全部通过
  通过: 11/11
  快照覆盖: 1/11 案例（未覆盖 10 个 — 无快照段，不作判定）
  黄金数据集: ✅ PASS
═══════════════════════════════════════════════════════════

[GATE] 全部 11 个黄金案例通过 — F1 门禁开放
```

**关键**：`实际检查 1 个 / 跳过 15 个 ... 数据集哨兵 16 个` —— **16 / 1 / 15 三个数字直接落进门禁输出**，
与卡面「声明 16、实际登记 1、其余 15 个全改 BOGUS 仍 passed」完全对上，且**由命令产出、非手写**。

grep 判别（改后）：
```
黄金数据集 compute 覆盖  → 1 处
快照层: 未覆盖           → 10 处
快照覆盖:                → 1 处
```

---

## 四、「改坏即红」红证（原始输出，非复述）

采集方式：备份源文件 → 注入 mutation → 跑真门禁 → 记录原始输出 → `trap EXIT` 还原 → 复核零残留。

### 4.1 L1-red — 删掉 ① 的覆盖行（⇒ L1-b 断言必红）

```
########## 改坏即红 · L1：删掉覆盖行 ##########
--- 源码中该行命中数 ---
0  <- 期望 0
0  <- 输出中命中数（期望 0 ⇒ L1-b 断言会红）
```

### 4.2 L2-red — 篡改 `GOLDEN_COMPUTE_INPUTS`（`cash 100000 → 100000000`）

```
$ perl -0pi -e "s/'cash-runway': [{ cash: 100000, ... }]/'cash-runway': [{ cash: 100000000, ... }]/" scripts/ci/golden-case-checker.ts
$ grep -n "cash: 100000000" scripts/ci/golden-case-checker.ts
420:  'cash-runway': [{ cash: 100000000, operatingExpense: 30000 }],

$ npx tsx scripts/ci/golden-case-checker.ts
──── 阶段 5: 黄金数据集检查 (D474) ────
[golden-snapshot-runner] 黄金数据集 compute 覆盖: 实际检查 1 个 / 跳过 15 个（registry 已登记 1 个 / 数据集哨兵 16 个）
═══════════════════════════════════════════════════════════
  结果: ❌ 有未通过案例
  通过: 11/11
  快照覆盖: 1/11 案例（未覆盖 10 个 — 无快照段，不作判定）
  黄金数据集: ❌ FAIL
       - cash-runway: severity 期望 "critical" 实际 "healthy"
═══════════════════════════════════════════════════════════

[GATE] 0 个黄金案例未通过 或 黄金数据集阶段失败 — 门禁拒绝
### rc=1  <- 期望非 0
```
⇒ **证明门禁真在跑 `computeCashRunway`**（输入改大 ⇒ runway 变长 ⇒ signal 由 `critical` 漂到 `healthy` ⇒ 判红），不是恒绿空壳。

### 4.3 L4-red — ③ 空集恒真回归（把 `passed: null` 还原成 `every(...)`）

```
$ perl -0pi -e "s/if \(!covered\) return \{ covered: false, passed: null \};/if (!covered) return { covered: false, passed: Object.values(results).every((r) => r.passed) };/" scripts/ci/golden-case-checker.ts
$ grep -n "passed: Object.values(results).every((r) => r.passed) }" scripts/ci/golden-case-checker.ts
245:  if (!covered) return { covered: false, passed: Object.values(results).every((r) => r.passed) };
246:  return { covered: true, passed: Object.values(results).every((r) => r.passed) };

$ npx tsx -e "import { decideSnapshotVerdict } from './scripts/ci/golden-case-checker.ts'; console.log('PROBE(mutated) ' + JSON.stringify(decideSnapshotVerdict({})));"
PROBE(mutated) {"covered":false,"passed":true}          ← 空集恒真回来了 ⇒ L4-b 断言必红

（还原后）
PROBE(restored) {"covered":false,"passed":null}         ← 修复生效
```
⇒ 这是 ③ 的**判别性夹具**：删掉修复 ⇒ 空集回 `passed:true` ⇒ 夹具红；还原 ⇒ 回 `null` ⇒ 夹具绿。

### 4.4 还原核实（零残留）

```
cash:100000000 残留 = 0  (期望 0)
bak 残留 =        0  (期望 0)
git status --short
 M scripts/ci/golden-case-checker.ts
 M scripts/ci/golden-snapshot-runner.ts
?? tests/ci/golden-dataset-coverage.test.sh
```
（两个 M 是本卡的真实交付改动，非 mutation 残留。）

---

## 五、测试与自验结果

| 项 | 命令 | 结果 | 耗时 |
|----|------|------|------|
| 新增夹具（四腿 15 断言） | `bash tests/ci/golden-dataset-coverage.test.sh` | **15 通过, 0 失败, exit=0** | 3s |
| 既有破坏态回归 | `bash tests/ci/golden-case-break-test.sh` | **3 通过, 0 失败, exit=0** | 1s |
| 既有单测（定向） | `npx vitest run tests/ci/` | **Test Files 2 passed / Tests 42 passed**, exit=0 | 0s |
| 定向类型检查（tsconfig 只含 `src/**`，故单独跑） | `npx tsc --noEmit --skipLibCheck --strict --target ES2022 --module ES2022 --moduleResolution bundler --esModuleInterop --resolveJsonModule scripts/ci/golden-case-checker.ts scripts/ci/golden-snapshot-runner.ts` | **exit=0**（零错误） | 1s |
| bash 语法 | `bash -n tests/ci/golden-dataset-coverage.test.sh` | exit=0 | — |

新增夹具四腿输出（节选）：
```
── L1: ① 覆盖行可见（绿态基线） ──
  ✅ L1-a 绿态 checker exit 0（基线可复现）
  ✅ L1-b 数据集覆盖行可见（命中 1 处）
  ✅ L1-c 案例快照覆盖汇总行可见（命中 1 处）
── L1-red: 改坏即红（删掉覆盖行 ⇒ L1-b 必须变红） ──
  ✅ L1-red 删掉覆盖行后输出命中 0 处 ⇒ L1-b 断言确会变红（夹具具判别性）
  ✅ L1-red 还原后覆盖行恢复可见（红→绿闭环）
── L2: 篡改 GOLDEN_COMPUTE_INPUTS (cash 100000 → 100000000) ⇒ 必须 exit 1 ──
  ✅ L2-a 篡改已注入（cash: 100000000）
  ✅ L2-b 篡改后 checker exit 1（非 0）— 门禁真跑 compute 而非恒绿空壳
  ✅ L2-c 失败输出点名 cash-runway（可定位）
── L3: trap 还原 ⇒ 必须回绿 ──
  ✅ L3-a 源文件已还原（篡改标记清零）
  ✅ L3-b 还原后 checker exit 0 — 红→绿闭环成立
── L4: ③ 空集恒真修复（decideSnapshotVerdict 边界） ──
  ✅ L4-a 生产接线存在（主流程调用 decideSnapshotVerdict，1 处）
  ✅ L4-b 空集 ⇒ covered=false 且 passed=null（不再恒真为通过）
── L4-red: 改坏即红（还原空集恒真 ⇒ L4-b 必须变红） ──
  ✅ L4-red-a mutation 已注入（空集恒真回归）
  ✅ L4-red-b 空集恒真回归后 passed=true ⇒ L4-b 断言确会变红（夹具具判别性）
  ✅ L4-red-c 还原后空集回到 passed=null（红→绿闭环）
```

### 施工中发现并修掉的自伤（如实记录）
首跑夹具时 L2 断言处抛 `L2_RC�: unbound variable` —— **D370 模式 2**：
`"…exit $L2_RC（非 0）…"` 中全角 `（` 在 UTF-8 locale 下被并入变量名。
修法：`${L2_RC}` 显式花括号边界。已用 `grep -nE '\$[A-Za-z_][A-Za-z0-9_]*[（）：，。；、]'` 全量扫描确认无同类残留。

---

## 六、Agent 自检 5 问

1. **接线检查**：①/③ 的落点 `scripts/ci/golden-case-checker.ts` 本身就接线在 `pre-push-check.sh:276` 与 `ci.yml:564`（原始输出见 §1.1 证据 B），改后跑该命令输出可见覆盖行 ⇒ **修复在真实接线点上生效**，非纸面。
   新增导出 `decideSnapshotVerdict` 的调用方：同文件 `runAllChecks()`（夹具 L4-a 断言接线存在，1 处）。
2. **异常处理**：本次改动未新增任何 `catch`；`decideSnapshotVerdict` 为纯函数无 IO 无降级路径。既有 `catch` 未改动。
3. **类型安全**：`as any` / `as never` / `as unknown as` 新增 **0**；定向 tsc exit=0。
4. **测试质量**：新夹具 15 断言全部为真断言（含 4 条 mutation 判别断言）；覆盖正常路径（L1/L2/L3）+ 边界（L4 空集）+ 降级（前置缺文件/npx 不可用 ⇒ 显式 `exit 1`，不静默 skip）。
5. **残留清理**：mutation 备份文件 0、`cash: 100000000` 残留 0（§4.4 原始输出）；无死代码（`snapshotPassed` 三态全部被读）。

---

## 七、自验结论

**自验结论：可提请独立审计。**

逐条对照统判据：
| 判据 | 状态 | 依据 |
|------|------|------|
| ① 每条有「改坏即红」反例 | ✅ | §4.1（L1）、§4.2（L2）、§4.3（L4③）三份原始红证 |
| ② 改前/改后原始输出 | ✅ | §3.1 / §3.2 |
| ③ 不留「未接线/待后续」 | ⚠️ **部分** | ①/③ 均落在已接线的真实门禁上（原命令输出即证明）；**唯一遗留**：新夹具 `.test.sh` 未登记进 CI 白名单 —— 见 §八 R1，**不在本卡写集内** |
| ④ 数字来自命令原始输出 | ✅ | 全文数字均附命令；无 `head` 截断关键输出 |

⚠️ **不宣称「产品被验证」**：本次只证明「黄金门禁的覆盖度现在不可见地 → 可见」与「空集不再恒真」，
**不**表示 11 个案例被有效覆盖（实测 **只有 1/11** 被快照层判定）。

---

## 八、遗留清单（如实记录，含未解决项）

| # | 遗留项 | 性质 | 建议处置 | 归属 |
|---|--------|------|---------|------|
| **R1** | 新夹具 `tests/ci/golden-dataset-coverage.test.sh` **未登记进 CI 白名单**。实测 `grep -n "tests/ci" .github/workflows/ci.yml` **零命中** —— CI 的门禁测试是**显式白名单** `for t in \ …`（`ci.yml:339-379`），不是 glob；同目录既有 `golden-case-break-test.sh` **同样未登记**（它只出现在 `.claude/settings.json:45` 的 Bash 允许清单里）。要让本夹具在 CI 自动跑，须改 `.github/workflows/ci.yml` | **写集外** | 请队长裁定：扩写集到 `ci.yml` 加一行，或按同目录既有惯例接受（本卡不擅自扩） | 队长 / CTO |
| **R2** | ③ 的**字面口径**（未覆盖 ⇒ 硬判红）未落地 | ✅ **已裁定（2026-09-28）**：CTO 采纳**中间方案**（显式记未覆盖 + 覆盖度可见），**不采用**字面硬判红；该字面口径归入**后续卡**（本批不补做）。§1.2 已同步 | 无（已闭合） |
| **R3** | `scripts/ci/**` **不在 D534 Note 必填触发面**内 | 事实记录 | `scripts/commit-msg-check.sh:140` 的 `CT_ORCH_TOUCHED` 只匹配 `scripts/{control-tower,workflow,hooks}/`+`src/orchestrator/`+`AGENTS.md`/`CLAUDE.md`/`memory/notes/README.md` ⇒ `scripts/ci/` 的治理变更**无 Note 强制**。另 `memory/notes/**` 不在本卡写集，故**未新建 Note** | 队长 / CTO |
| **R4** | 黄金数据集覆盖面仍为 **1/16** | 已知缺口 | 本次只做「可见化」，**未**做「逐个登记」（卡面明令不做）；后续 D355-D360 按同契约增量登记 | 后续批次 |
| **R5** | 10/11 fixture 无快照段 | 已知缺口 | 由 ③ 显式可见（`快照覆盖: 1/11`），不再静默；补快照段需独立卡 + 写集 | 后续批次 |

---

## 九、`git diff --stat`（原始输出）

```
$ git diff --stat
 scripts/ci/golden-case-checker.ts    | 50 ++++++++++++++++++++++++++++++++++--
 scripts/ci/golden-snapshot-runner.ts |  4 +++
 2 files changed, 52 insertions(+), 2 deletions(-)

$ git diff --numstat
48	2	scripts/ci/golden-case-checker.ts
4	0	scripts/ci/golden-snapshot-runner.ts
```

新增文件（未计入 `git diff`，须 `git status`/`--stat --cached` 可见）：
`tests/ci/golden-dataset-coverage.test.sh`（新建，夹具）
