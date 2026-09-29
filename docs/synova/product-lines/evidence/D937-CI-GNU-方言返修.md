# D937 CI(GNU) 方言返修 — 夹具原始输出

> **任务**：PR #737 的 `tests/control-tower/gate-failopen-net.test.sh` 在 CI(GNU grep) 下红（方言依赖）
> **分支/工作树**：`fix/d937-gate-failopen` @ `/Users/wane/SynovaAgent/.synova-wt-squad-d937`
> **基线 tip**：`ce5b13b9`（改动前 `git rev-parse HEAD`）
> **本文件数字均来自命令原始输出，无手写。**

```
$ date -Iseconds
2026-09-24T23:35:46+08:00

$ 改动前 git rev-parse HEAD
ce5b13b9（改后 tip 见文末回执）

$ git status --short（改动前）
 M tests/control-tower/gate-failopen-net.test.sh

$ 夹具 sha256 改动前 = 010a7476e67e34398784074b95b3e9dd7dff837b4e3c9b7b404d6220cf354451（473 行）
$ 夹具 sha256 改动后 = ac3e002869b89e65d3efd2e5a1db0beaaf321c66f5b73cec65eceac483c79d5c
$ 夹具行数 改动后 = 514
```

## 1. CI 原文与**真正的失败点订正**

派单件给的 CI 片段：
```
❌ 应 exit 0, 实际 1 :: 模拟红
⚠️ PLATFORM-DIFF: 本平台 grep 未把 '^+++' 判为非法 ERE
```
**订正（我实测定位）**：`应 exit 0, 实际 1 :: …` 这句**不是**本夹具的断言，而是
`tests/control-tower/simulate-ci.test.sh:42`：

```
no "应 exit 0, 实际 $rc :: 内层失败: ${INNER:-（无 ❌ 行，见上方输出）}"
```

即：**simulate-ci 把密封清单里的测试跑一遍**，本夹具在 GNU 下返回 1 →
`simulate-ci.sh:61` 打 `❌ <test> — 模拟红（与 CI 一致）` → simulate-ci 断言 exit 0 失败。
所以"本夹具在 GNU 下红"成立，但报错行来自外层模拟器。

## 2. 根因：两处方言依赖（不止派单件点名的那一处）

| # | 位置 | 依赖 | BSD | GNU | 后果 |
|---|------|------|-----|-----|------|
| ① | `T3 降级` 用 `SYNO_DIAG_EXCL_OVERRIDE=^+++` 制造"非法 ERE" | grep 对 `^+++` 的判读 | exit 2（非法） | **接受** | GNU 下门禁不降级 → `T3 降级: stdout 含显式「降级」字样` **红**（= CI #737） |
| ② | `T3f 无缝合` 同一模式（**更隐蔽**） | 同上 | 采纳覆盖→必降级，故"无降级"是有效证据 | GNU 下**即使覆盖泄漏进生产也不会降级** | 该断言在 GNU 上**恒绿 = 判别力归零**（假绿，CI 不会红但也没在测） |

两处同源：**拿"某方言判 `^+++` 非法"当判据**。按 CTO 新规范第 5 条，夹具禁依赖平台方言。

## 3. 改法选择 = **(a) 与方言无关** + 探针观测（理由）

**选 (a)**，并把 `^+++` 降级为**可见观测**（即同时具备 (b) 的显式探针，但**不把双分支写进期望**）：

1. **判据只用与方言无关的非法 ERE**：`OVR_UNLAWFUL='a(b'`（括号不平衡）——
   BSD `parentheses not balanced` / GNU `Unmatched ( or \(` → **两方言一律 exit 2**。
   并且**不假设、要实测**：新增 `T3p` 前置断言先探本平台是否真 rc=2，不成立即 **fail loud**。
2. **`^+++` 不再参与任何 pass/fail**：只保留在 `T3d` 平台探针与**条件化金丝雀**里，
   平台差异以 `⚠️ PLATFORM-DIFF` 行**显式可见**（不静默）。
3. **不选"只做 (b)"的理由**：若把双分支期望写进判据（BSD 期望降级 / GNU 期望不降级），
   则**同一个夹具在不同平台上有不同的判定语义** —— 读日志的人必须知道自己在哪台机才能判读，
   且 GNU 分支只能断言"没降级"（弱断言，正是 ② 的假绿面）。改用 (a) 后：
   **判据单一、两平台同义、GNU 分支恢复判别力**。

**金丝雀保留（硬要求）**：`canary-paren.sh`（`a(b`）= **方言无关的强制金丝雀**，任何平台都必须抓到；
`canary-caret.sh`（`^+++`）为条件化观测（平台判其非法时才设）。

## 4. 方言敏感面全扫（不只看被点名的那处）

```
$ grep -nE "sed -i|grep -[a-zA-Z]*P|date -d|date -v|stat -c|stat -f|readlink -f|xargs -r|shuf|head -c|-oP|mapfile|readarray" tests/control-tower/gate-failopen-net.test.sh
（零命中 —— 除 T3/T3f 的 ^+++ 判据外无其它方言构造）

$ 同族自查（$VAR 紧贴非 ASCII，bash 3.2 会吞进变量名）
命中数 = 0
```

## 5. 四段原始输出（验收 ①②③④）

**① 本机（macOS / BSD grep）**

```
=== D937: 组 7a fail-open 假绿判别夹具 ===
  平台: Darwin ｜ grep: grep (BSD grep, GNU compatible) 2.6.0-FreeBSD

  ✅ T1 正常: 干净 diff → 组 7a ✅
  ✅ T1 正常: 干净 diff → exit 0
  ✅ T1s 正常(CI strict): 干净 diff → 组 7a ✅（严格模式不假红，实测全局 exit=1）
  ✅ T2 判别: 注入被禁模块用法 → CI strict exit 1 且组 7a 判 ❌（非假绿）
  ✅ T2b 判别: 带 +++ 头的 src/x.ts 命中 → exit 1 + 组 7a ❌
  ✅ T3p 前置: 本平台 grep 拒收非法 ERE 'a(b'（rc=2）—— T3 判据与方言无关
      （T3d 方言观测: grep -E -e '^+++' /dev/null → rc=2 = 本平台判其非法；GNU grep 接受之）
  ✅ T3 降级: 排除模式非法 → 组 7a 不判 ✅
  ✅ T3 降级: stdout 含显式「降级」字样
  ✅ T3 降级: CI strict 下降级计 HARD_FAIL (exit 1)
  ✅ T3f 无缝合: 未武装时覆盖变量被忽略（空 diff 路径，fail-closed）
  ✅ T3f 无缝合: 真实暂存区路径下覆盖变量同样被忽略
      （无缝合依据: 非法覆盖='a(b' 若被采纳, grep 编译期即 exit 2 → 必出「降级」；该 exit 2 已由 T3p 在本平台实测）
  ✅ T4 边界: // # * 三注释形态 → 组 7a ✅（零误报）
  ✅ T5 边界: .html 文档正文提及 → 组 7a ✅（零误伤）
  ✅ T5b 判别对照: 同正文挂 .ts 头 → 组 7a ❌（证明 T5 的 ✅ 来自豁免而非空转）
  ✅ T5c 真实样本: git show 58a19796 全文 → 组 7a ✅（0 命中；全局 exit=0 不判）

── 家族网: scripts/**/*.sh 的 grep -E 家族（行为编译检查 grep -E -e PAT /dev/null）──
  扫描 141 个 .sh ｜ 可判 277 ｜ 未解析 0 ｜ 非法 0
  （动态不可判 20 ｜ 非 ERE 跳过 592）
  ✅ 家族网: 非法 ERE 0 个（scripts/**/*.sh）
  ✅ 家族网: 未解析 0 个（无静默跳过）
  ✅ 家族网: 网规模非空转（可判 277 ≥ 200 且 .sh 141 ≥ 100）

── 金丝雀: 网必须能抓到非法 ERE（防空转网）──
  平台探针: grep -E -e '^+++' /dev/null → rc=2 （2 = 本平台按非法 ERE 拒收）
  ✅ 金丝雀: 括号不平衡非法 ERE 被网抓到（网非空转）
  ✅ 金丝雀: '^+++'（本期病根模式）被网抓到
  金丝雀扫描: 2 个 .sh ｜ 可判 2 ｜ 未解析 0 ｜ 非法 2
  ✅ 接线: ci.yml control-tower-tests 密封清单含本测试

结果: 21 通过, 0 失败
exit=0
```

**② GNU 行为对照 —— ⚠️ 说明：本机无 GNU grep（`ggrep` 不存在），此段是**PATH shim 模拟**，非真 GNU**

shim 只改一个方言差异（其余一律委托真 `/usr/bin/grep`），并自证其确实翻转了该判读：

```
$ cat $SHIM/grep
#!/bin/bash
for a in "$@"; do case "$a" in *'^+++'*) exit 1 ;; esac; done
exec /usr/bin/grep "$@"

$ 无 shim: grep -E -e "^+++" /dev/null ; echo rc=$?
rc=2   (BSD: 判非法)
$ 有 shim: PATH=$SHIM:$PATH grep -E -e "^+++" /dev/null ; echo rc=$?
rc=1   (GNU 模拟: 接受)
$ shim 对 OVR_UNLAWFUL 仍委托真 grep:
rc=2   (两个方言都应 2)
```

```
=== D937: 组 7a fail-open 假绿判别夹具 ===
  平台: Darwin ｜ grep: grep (BSD grep, GNU compatible) 2.6.0-FreeBSD

  ✅ T1 正常: 干净 diff → 组 7a ✅
  ✅ T1 正常: 干净 diff → exit 0
  ✅ T1s 正常(CI strict): 干净 diff → 组 7a ✅（严格模式不假红，实测全局 exit=1）
  ✅ T2 判别: 注入被禁模块用法 → CI strict exit 1 且组 7a 判 ❌（非假绿）
  ✅ T2b 判别: 带 +++ 头的 src/x.ts 命中 → exit 1 + 组 7a ❌
  ✅ T3p 前置: 本平台 grep 拒收非法 ERE 'a(b'（rc=2）—— T3 判据与方言无关
      ⚠️ PLATFORM-DIFF: 本平台 grep 未把 '^+++' 判为非法 ERE（rc=1）—— 历史模式方言相关，故本夹具只用 'a(b' 作判据
  ✅ T3 降级: 排除模式非法 → 组 7a 不判 ✅
  ✅ T3 降级: stdout 含显式「降级」字样
  ✅ T3 降级: CI strict 下降级计 HARD_FAIL (exit 1)
  ✅ T3f 无缝合: 未武装时覆盖变量被忽略（空 diff 路径，fail-closed）
  ✅ T3f 无缝合: 真实暂存区路径下覆盖变量同样被忽略
      （无缝合依据: 非法覆盖='a(b' 若被采纳, grep 编译期即 exit 2 → 必出「降级」；该 exit 2 已由 T3p 在本平台实测）
  ✅ T4 边界: // # * 三注释形态 → 组 7a ✅（零误报）
  ✅ T5 边界: .html 文档正文提及 → 组 7a ✅（零误伤）
  ✅ T5b 判别对照: 同正文挂 .ts 头 → 组 7a ❌（证明 T5 的 ✅ 来自豁免而非空转）
  ✅ T5c 真实样本: git show 58a19796 全文 → 组 7a ✅（0 命中；全局 exit=0 不判）

── 家族网: scripts/**/*.sh 的 grep -E 家族（行为编译检查 grep -E -e PAT /dev/null）──
  扫描 141 个 .sh ｜ 可判 277 ｜ 未解析 0 ｜ 非法 0
  （动态不可判 20 ｜ 非 ERE 跳过 592）
  ✅ 家族网: 非法 ERE 0 个（scripts/**/*.sh）
  ✅ 家族网: 未解析 0 个（无静默跳过）
  ✅ 家族网: 网规模非空转（可判 277 ≥ 200 且 .sh 141 ≥ 100）

── 金丝雀: 网必须能抓到非法 ERE（防空转网）──
  平台探针: grep -E -e '^+++' /dev/null → rc=1 （2 = 本平台按非法 ERE 拒收）
  ⚠️ PLATFORM-DIFF: 本平台 grep 未把 '^+++' 判为非法 ERE → 仅以括号不平衡（a(b）做金丝雀（该条已由 T3p 实测，方言无关）
  ✅ 金丝雀: 括号不平衡非法 ERE 被网抓到（网非空转）
  金丝雀扫描: 1 个 .sh ｜ 可判 1 ｜ 未解析 0 ｜ 非法 1
  ✅ 接线: ci.yml control-tower-tests 密封清单含本测试

结果: 20 通过, 0 失败
exit=0
```

> 断言数 21(BSD) vs 20(GNU) 的差 = **条件化金丝雀那一条**（GNU 分支不设 caret 金丝雀）——
> 这是设计内的"探针 + 观测"，**两平台失败数都是 0**。

**③ 金丝雀改坏即红（防空转网）—— 删掉强制金丝雀 `canary-paren.sh` 的产生行**

```
$ （sed 删除 canary-paren.sh 产生行后）bash tests/control-tower/gate-failopen-net.test.sh
── 金丝雀: 网必须能抓到非法 ERE（防空转网）──
  ❌ 金丝雀: 网抓不到非法 ERE —— 网是空转的
  ✅ 金丝雀: '^+++'（本期病根模式）被网抓到
  金丝雀扫描: 1 个 .sh ｜ 可判 1 ｜ 未解析 0 ｜ 非法 1
结果: 20 通过, 1 失败
exit=1
```

**④ `bash -n`**

```
$ bash -n tests/control-tower/gate-failopen-net.test.sh   → rc=0（0 = 0 错误）
```

## 6. 差分对照：旧版 vs 新版（同一 GNU 模拟环境）

**A. 旧版夹具（`ce5b13b9` 上的内容）+ shim → 红 ＝ 复现 CI #737 的失败方式**

```
  ✅ T2 判别: 注入被禁模块用法 → CI strict exit 1 且组 7a 判 ❌（非假绿）
  ✅ T2b 判别: 带 +++ 头的 src/x.ts 命中 → exit 1 + 组 7a ❌
  ❌ T3 降级: 组 7a 在非法排除模式下仍判 ✅（fail-open 未修）:   ✅ 禁止 DiagnosticModule: 新模块须实现 Sentinel 接口
  ✅ T5b 判别对照: 同正文挂 .ts 头 → 组 7a ❌（证明 T5 的 ✅ 来自豁免而非空转）
结果: 18 通过, 1 失败
exit=1
```

**B. 新版夹具 + shim → 绿**

```
  ✅ T3p 前置: 本平台 grep 拒收非法 ERE 'a(b'（rc=2）—— T3 判据与方言无关
      ⚠️ PLATFORM-DIFF: 本平台 grep 未把 '^+++' 判为非法 ERE（rc=1）—— 历史模式方言相关，故本夹具只用 'a(b' 作判据
      （无缝合依据: 非法覆盖='a(b' 若被采纳, grep 编译期即 exit 2 → 必出「降级」；该 exit 2 已由 T3p 在本平台实测）
── 金丝雀: 网必须能抓到非法 ERE（防空转网）──
  ⚠️ PLATFORM-DIFF: 本平台 grep 未把 '^+++' 判为非法 ERE → 仅以括号不平衡（a(b）做金丝雀（该条已由 T3p 实测，方言无关）
  ✅ 金丝雀: 括号不平衡非法 ERE 被网抓到（网非空转）
结果: 20 通过, 0 失败
exit=0
```

> A 的 ❌ 与 CI 日志同型（`T3 降级` 因 GNU 接受 `^+++` 而不降级）；B 在同一环境下全绿 ⇒ **方言依赖已消除**。

## 7. 返修过程中发现的**第二处**缺陷（我自己的新代码，如实登记）

加 `T3d` 探针时我写了 `…（rc=$PRC_HISTORIC）` —— **`$VAR` 后紧跟全角 `）`**。
bash 3.2 会把多字节首字节并进变量名 → `unbound variable` 崩溃。
**恶劣之处：它只在 `else` 分支（= 平台不判 `^+++` 非法 = GNU 分支）才崩**，
本地 BSD 分支永远看不到 —— 若不修，修完 CI 反而会以另一种方式红。**是 GNU 模拟差分对照把它抓出来的。**

已修的 4 处：`$PRC_UNLAWFUL（` / `$PRC_HISTORIC）` / `$OVR_UNLAWFUL）` / 一处注释。
并写入文件头的写法硬约束 + 自查命令：
```
$ LC_ALL=C grep -cE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' tests/control-tower/gate-failopen-net.test.sh
0
```
（该形态与 §2 的两处同属"**只在某个平台/分支上才暴露**"的一类，故并入本件登记。）

## 8. 同族关系（CTO 第 5 条：今天第 3 例方言同族）

| # | 事件 | 方言/平台差异 | 处置 |
|---|------|--------------|------|
| 1 | 组 7a fail-open 假绿（D937 本体） | `^+++`：BSD 判非法 exit 2 / GNU 接受 | c1 改三态 + 结构化比较（方言无关） |
| 2 | M9 棘轮 | （同一类"平台假设"驱动的门禁判定） | 该轮已处置 |
| 3 | **本件**（CI #737） | 夹具**拿** `^+++` **当判据** → GNU 下红 | 本件：判据改方言无关 + 探针观测 |

**共性**：三例都是"**把某个平台的具体行为当成普适事实**"。
本件的机制化对策 = ① 判据只用两方言同义的构造 ② 该构造的"合法性前提"由夹具**自己实测**（`T3p`）
③ 历史模式只作**可见观测**，不参与判定。

## 9. 未清项 / 已知边界（诚实披露）

1. **② 的 GNU 段是 PATH shim 模拟，不是真 GNU grep**（本机无 `ggrep`；`command -v ggrep` 空）。
   它只复刻了 `^+++` 这一条被点名差异，并已自证翻转；**真 GNU 验证需 CI 复跑**。
2. **家族网（family_scan）的判定是平台相对**的：它用**运行平台的 grep** 编译 `scripts/**/*.sh` 的字面模式，
   故"非法"计数天然随平台而变（本件实测 BSD=0）。这是该网的**设计语义**（抓"某个平台跑起来会炸的模式"），
   但严格说仍属"平台相关判定"；本次**未改其语义**（改了就等于削弱它），登记供 CTO/K3 裁量。
3. **CI 双平台真日志未取**：环境无 `gh`，`origin` 为 SSH 且认证失效；本件给的是本机两段对照。
   推送后 CI 复跑结果以 job 日志为准。
4. 未触碰 `tests/control-tower/alloc-task-id*.test.sh` 等他人文件；未改 `scripts/**`。
