# K4-b3-VERIFY-239 — 独立复核：#239（K4-06 循环层五阀映射）＋ **V-5 补跑（#238 的 vitest）**

> **复核员**：verifier（task-4，只读侧）｜**复核时点**：2026-10-12（+08:00）
> **被审对象**：`k4b3/238-239` @ **`eb5ab88a90e71cb2c1206e1291d2cd2404020e25`**（`git ls-remote` 实测；7 笔；写集 **20 件**）
> **diff 左端**：`ba1b22a8b5`｜**重型验证**：本件含 **vitest 实跑**（CTO 授权 · 串行 · 同时仅本件在跑）
> **方法**：临时 detached worktree（`%TEMP%\k4b3-verify\wt-n3`，`git worktree add --detach`）＋ **junction** 指向 `D:\synova-wt\node_modules`（**gitignored、不进写集**）；跑毕 **`rmdir` 去 junction → `git worktree remove`**，残留 = 0，我方树未受影响（clean / SHA 不变）。
> **队内用语**：只给「自验结论」，不写「审计通过」。

---

## 〇、V-5 补跑（CTO/N3 第 1 项）：#238 的 `tests/coordination/numbering-authority.test.ts`

**四元组**：值 = `19 passed (19)`｜口径 = vitest `5.0.2` 单文件 run（`node_modules\.bin\vitest.cmd run <file> --reporter=verbose`）｜时点 = 2026-10-12 17:47:10（+08:00，vitest 自报）｜探针/被测版本 = `eb5ab88a9`（`git ls-remote` 实测）
```
$ node_modules\.bin\vitest.cmd run tests/coordination/numbering-authority.test.ts --reporter=verbose
 ✓ …（19 例逐例列出，含：六个原件存在 ｜ 词表 56/56/56 ｜ 两章各 42 且集合相同 ｜ 章间分歧恰 4 条(逐条钉两章名字)
    ｜ 第一章用表格承载同一 42 行表 ｜ 第二章自身不自洽(E-12) ｜ 表 A 精确命中恰 13 ｜ **降级路径：29 条未命中不得被计为命中**
    ｜ §3.5.1 八条中精确同义恰 4 ｜ golden 34/36(未命中=E-0.4/E-X.1) ｜ 形态交集 24 ｜ patch 34 distinct/119 处
    ｜ 判据④ occurrences=45/distinct=15/hit=15/miss=0 ｜ GLOSSARY 显式标注 ｜ 待裁四类齐 ｜ 19 条逐条在件 ｜ B2 五条在件）
 Test Files  1 passed (1)
      Tests  19 passed (19)
   Duration  751ms (import 36%, transform 31%, tests 24%, worker 9%)
V5_EXIT = 0
```
⇒ **上轮记的 b 类「未跑 vitest」→ 已跑、已闭** ✅（19/19 通过；且**降级路径**与**低置信项不得冒充命中**两类判别性断言都在其中）。

---

## 一、#239 四项（CTO 措辞）+ 点名附加项 —— **逐项实测**

### ① 五阀落地 —— ✅（我逐件读终态文件）
```
cash-cycle            valves 键=5 缺=[] 阀边=6  edges[]保留=true(len=4)
customer-cycle        valves 键=5 缺=[] 阀边=6  edges[]保留=true(len=3)
product-cycle         valves 键=5 缺=[] 阀边=7  edges[]保留=true(len=4)
talent-cycle          valves 键=5 缺=[] 阀边=6  edges[]保留=true(len=4)
store-replication     valves 键=5 缺=[] 阀边=9  edges[]保留=true(len=4)
arr-growth            valves 键=5 缺=[] 阀边=9  edges[]保留=true(len=6)
合计阀边 = 6+6+7+6+9+9 = **43** ✅
键名逐字 = acquisitionValve / allocationValve / conversionValve / deliveryValve / recycleValve ✅（test 内亦有逐字断言）
```

### ② `edges[]` 未被覆盖 —— ✅
```
$ git diff ba1b22a8b5..eb5ab88a9 -- cycles/ | grep -c '^[+-]\s*"edges"'
0            ← "edges" 行零改动（新键 valves 与之并存，同名不同物）
```
⇒ 六件的 `edges[]` **长度与内容均未动**（逐件 len 见 ①）✅；`cycle-types.ts:157` 的注释亦明写「doc15 §3.4 的 `edges{*Valve}` 与仓内 `edges[]` **同名不同物**」✅。

### ③ 接线「删掉即报红」 —— ✅ **我以真实消费链 + 硬编码反例双向证实**
**消费链（原文）**：
```
overflow-compute.ts:45  export function computeValveLagProfile(cycle: CycleConfig): ValveLagProfile
overflow-compute.ts:224 const valveLag = cycle.valves ? computeValveLagProfile(cycle) : null;
overflow-compute.ts:226-229 valveLagExceedsWindow = valveLag !== null && … dataWindowMonths < valveLag.criticalPathMinMonths;
overflow-compute.ts:230-235 if (valveLagExceedsWindow) log.warn(…'数据窗口短于五阀关键路径下界 — 溢出结论降级')
overflow-compute.ts:237 const degraded = data.dataPoints.length < 2 || valveLagExceedsWindow;   ← **真影响行为**
overflow-compute.ts:254/256 snapshot 里返回 valveLag / valveLagExceedsWindow
```
**`git grep "Valve" src/cycles/` = 24 处** ✅（与 impl-a 报数一致）；**关键行 = `overflow-compute.ts:224`** ✅ 逐字命中。
**vitest（同 tip）**：`tests/cycles/valve-mapping.test.ts` ⇒ **13 passed (13)** / exit 0，其中判别性用例：
`✓ 有 valves + 短窗口 ⇒ 被消费：valveLagExceedsWindow=true、degraded=true`｜`✓ 【反例·硬编码】无 valves ⇒ 同输入下 =false、=false`｜`✓ 【反例·值被真读】把全部桶改成 immediate ⇒ 关键路径 0 ⇒ 不再降级`｜`✓ 边界：窗口 == 关键路径 ⇒ 不降级（`<` 非 `≤`）`。

### ④ 两反例 —— ✅ **均由我独立造红（非读件）**
**反例 A（删任一 cycle 的五阀字段 ⇒ 探针 exit 1）**：
```
基态：node scripts/control-tower/probe-cycle-valves.ts
      → valve_files=6 compliant=6 violations=0 ；✅ 结论：6/6 件含完整五阀映射…；exit 0
造红：删除 cycles/builtin/cash-cycle.cycle.json 的 valves 键（"替换确实发生"已核）
      → ❌ cycles/builtin/cash-cycle.cycle.json @ valves — 判据① 违规：valves 缺失（五阀映射未配置）
        valve_files=6 compliant=5 violations=1 ；exit **1**          ✅ 期望 1
复原：git checkout -- <该件> ⇒ 0 条变更（工作树恢复）
```
**反例 B（`overflow-compute` 消费改硬编码 ⇒ 测试红）**：
```
造红：`const valveLag = cycle.valves ? computeValveLagProfile(cycle) : null;` → `const valveLag = null;`
      → vitest ⇒ ❯ tests/cycles/valve-mapping.test.ts (13 tests | **2 failed**) ；exit **1**
        × 有 valves + 短窗口 ⇒ 被消费…  AssertionError: expected null not to be null
        × 【反例·值被真读】…
        Tests  2 failed | 11 passed (13)                             ✅ 期望非 0
复原：git checkout -- src/cycles/overflow-compute.ts ⇒ 0 条变更 ⇒ 复跑 **13 passed (13)** / exit 0 ✅
```
> **我的一次无效尝试（自陈）**：首跑我用了 `--reporter=basic`（vitest 5 不支持）⇒ 那次 exit 1 是**报告器加载失败**、**不是测试红**；已改用默认报告器重做，上面的红是**真红**。

### 点名附加项
- **`valves` 五阀键名/形态对齐 doc15 第一章 §3.4** ✅（键名逐字；元素 `{edgeId, actionEffectLag}`；test 有逐字断言）。
- **43 条阀边逐字取自 §5 六张模板** ✅ **6/6 逐条一致**（按 `name ↔ cycleId` 配对后比"阀名集合 + 每阀 `(edgeId|actionEffectLag)` 序列"；口径 = 逐件读**已提交**文件；见 §三 口径提示）。
- **桶规范 6 / 实用 5 带口径** ✅：探针输出原样含 `lag_buckets_used = 5   （实用桶数；规范 6 / 实用 5）` ＋ `lag_unused_buckets = >12_months`；test 亦有「桶口径锁定：规范 6 / 实用 5（`>12_months` 已定义、本轮 0 次使用）」✅。

## 二、结论用语

**`eb5ab88a9`（#238 ＋ #239）—— `可提请独立审计`**：
- **V-5 ✅ 补跑完成**（19/19、exit 0）⇒ #238 的 b 类"未跑 vitest"**已闭**
- **#239 四项 ✅ 全过**：五阀齐备（5 键 ×6 件、43 条）｜`edges[]` 零改动（0 行）｜接线**真消费**（影响 `degraded` + 进 snapshot；硬编码反例 ⇒ 2 failed）｜**两反例均造红成功**（探针 exit 1；测试 2 failed）
- 点名三项 ✅（键名逐字 / 43 条 6/6 逐字 / 桶口径带名）
- **未核（b）**：① 43 条逐字比对是"§5 模板 vs 落盘值"的**逐条串比对**，**未**核"模板本身是否权威"（那是 #238 的 T/待裁面）；② 我未跑全量 vitest（只跑两个相关文件，按 CTO 指定范围）。

## 三、口径/环境提示（供收件闸与全队复用）

1. **本机 `bash` = WSL（无发行版）** ⇒ claim 里形如 `bash scripts/…sh` 的 verify 命令**直接跑会失败**；必须用 **Git Bash 全路径**（`C:\Program Files\Git\bin\bash.exe`）或 `cmd /c`。我实测：直接用 PATH 的 `bash` → `GATE_EXIT=255`＋"未安装发行版"乱码；用 Git Bash → 正常。⇒ **属复现口径缺口**（建议写进复核须知）。
2. **vitest 报告器**：`--reporter=basic` 在 vitest 5 不存在 ⇒ 别用它（否则把"报告器失败"误读成"测试红"）。
3. **临时 worktree + junction 的可复现做法**（本件方法）：`git worktree add --detach <tmp> <rev>` → `mklink /J <tmp>\node_modules <有依赖的树>\node_modules` → 跑 → `rmdir <junction>` → `git worktree remove`（**禁 `rm -rf` 跟随 junction**）。实测 `node_modules` 未进写集、我方树 SHA 不变。
