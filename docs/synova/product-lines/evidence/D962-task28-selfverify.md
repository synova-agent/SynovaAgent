# D962 task-28 独立自验（V9 · 自验员 d962-verifier2）

> **自验员**：`d962-verifier2`（独立于编码成员 C；只读 + /tmp 副本）
> **对象**：`feat/d962-2a-merge` @ **1f577444**（`git ls-remote --heads origin` 实测同值）
> **方法**：`/tmp/d962v9/tree`（`git archive` 导出）+ `/tmp/d962v9/repo`（`git clone --shared`，`origin/main` 置为 `ee721b0a`）；所有变异探针在副本内 **same-path swap**（改→跑→还原→sha 核对）
> **主树**：`b8573c7a`，开工/收工 `git status --porcelain` = 5→5 未变；本报告为唯一写入
> **口径**：全部数字来自本自验命令原始输出；**未引用编码成员 C 的数字**；只给"自验结论"，不代表审计通过

---

## 〇、九项结论摘要

| # | 核对项 | 结论 |
|---|---|---|
| ① | 退役 3 零引用 + 承接面存在 | **一致** |
| ② | **L12 独立复现**（内联 #3 对 `'marketing'` 是否恒空转） | **复现成立**，且**比回执描述更重**：同输入下被退役脚本能命中、承界面不能（能力回退） |
| ③ | wire 4 改坏必红 / 有它则绿 | **一致**（4/4 各有点绿 + 变异红，含行为级探针） |
| ④ | claim-regex 是否逐字 V5.2.x:775 | **逐字一致**（60 字符 0 差异） |
| ⑤ | ci.yml `\|\| true` 清理 + `::warning` 可见性 | **一致**（`\|\| true` 已清；::warning 可见）；附 1 项口径登记（O1） |
| ⑥ | L11 脱敏 | **一致**（证据目录残留 0；门禁 rc=0；反向对照 rc=1）；全库口径附登记（O3） |
| ⑦ | 权威计数口径 + 算式自洽 | **一致**（21 = 48 − 27，逐类可核） |
| ⑧ | N12 措辞 | **一致**（含"CI 未跑" + 时标 + 禁冒充；附 O2 快照口径） |
| ⑨ | 新增 fail-open 自修（rc≠0 必计红） | **一致**（rc=3 / rc=127 双注入 + 无反例对照证明必要性） |

**另**：上一轮（task-26 V8）我提的 **F1 反引号缺陷已在 `1a50460f` 修复**，本自验复核：CI 等价跑 **stderr 0 行**、全脚本非注释行反引号 = 0（见 §十一）。

---

## 一、① 退役 3 零引用 + 承接面

### 1.1 三脚本确已删除

```
scripts/check-hardcoded.sh                          → 已删除 ✓
scripts/control-tower/check-canary-drift.sh         → 已删除 ✓
scripts/control-tower/check-name-allocation.sh      → 已删除 ✓
```

### 1.2 零引用复核（`scripts/ tests/ .github/ package.json`）

| 脚本名 | 命中数 | 命中性质（逐行分类） |
|---|---|---|
| `check-hardcoded` | **0** | — |
| `check-canary-drift` | 9 | 全部为：注释（check-gate-integrity.sh:109 / ct-health.sh:4,205,286 / alloc-task-id.test.sh:478）、**保留的守卫测试文件名**（ci.yml:273 测试清单）、ci.yml:337 注释。**无任何对已删脚本的活调用** |
| `check-name-allocation` | 8 | 注释（alloc-task-id.sh:223 / alloc-task-id.test.sh:459）、守卫测试文件名（ci.yml:282）、测试内"退役断言"（`RETIRED=…` + `[ ! -e ]`）。**无活调用** |

（`68747574` 时 `check-hardcoded.sh` 本就**没有**测试文件；另两件的测试文件保留并改指新主键/内联宿主。）

### 1.3 承接面存在且行为可用

| 被退役 | 承界面 | 本自验原始输出 |
|---|---|---|
| `check-hardcoded.sh` | `pre-commit-check.sh:297-306` 内联 `#3`（`HARDCODE_DATA` + `soft_check`） | 注入 `'研发部'` 探针 → `⚠️ 硬编码业务数据/类型 (#3 保留·本地): 1 处` 并点名 `scripts/control-tower/tmp-probe-cn.ts` —— **面在，但见 §二** |
| `check-canary-drift.sh` | `ct-health.sh:206 run_canary_drift()`，调用点 `ci.yml:339-341` | `tests/control-tower/check-canary-drift.test.sh` → **11 通过, 0 失败** rc=0；`ct-health.sh canary-drift` 实跑 rc=0 且打印 `::warning title=canary-drift::69 个测试不在 CI canary 清单: …` |
| `check-name-allocation.sh` | `alloc-task-id.sh:226-236 --check-id` + `:170 _occupy_locations()`（单一副本） | 三态直测（沙箱 task-state）：已占 `D77777`→**rc=1** 并点名 task-state 路径；未占 `D88888`→**rc=0**；非法 `D`/`abc`→**rc=2** `非法卡号…`；`77777` 亦命中同一占用面。守则测试 **9 通过, 0 失败** |

**①结论：一致。**

---

## 二、② L12 独立复现（**本自验另建探针，且加做"被退役脚本对照"**）

### 2.1 复现：内联 #3 对 `'marketing'/'sales'/'finance'` 恒空转

```
探针 A  const DEPTS = ['marketing', 'sales', 'finance'];   （.ts，新增暂存）
  → ✅ 硬编码业务数据/类型 (#3 保留·本地)          ← 未命中
探针 B  const DEPTS = ['研发部', '市场部'];
  → ⚠️  硬编码业务数据/类型 (#3 保留·本地): 1 处 + 点名探针文件   ← 命中
仅第一段 grep（应命中 A）:
  scripts/control-tower/tmp-probe-marketing.ts:1:const DEPTS = ['marketing', 'sales', 'finance'];
叠加排除链（同一行）: 无输出 ⇒ 被自吞
```

根因逐字确认（`pre-commit-check.sh:302`）：排除链 `…|'business_model'|'finance'|'marketing'|'sales'|: \[` **含目标字面量自身**，故凡由这三个词命中的行必被同一条 `grep -v` 排除。

### 2.2 **加强证据（回执未做）**：被退役脚本对同一行是命中的

把同一文件暂存后跑 `68747574:scripts/check-hardcoded.sh`：

```
⚠️  检测到可能的硬编码数组:
+const DEPTS = ['marketing', 'sales', 'finance'];
  → 如果这些值代表可扩展的实体(专家/哨兵/工具)，应从配置或目录扫描获取
```

⇒ L12 不只是"承接面窄"，而是**同输入下的能力回退**：退役前可命中、退役后永不可命中。**该卡（CTO 新卡）成立，且应按"能力回退"定级。**

**②结论：L12 复现成立，且证据强于回执表述。**

---

## 三、③ wire 4：有它则绿 + 改坏必红（全部自跑）

### 3.1 有它则绿（组级测试 + CI 等价生产跑）

```
tests/control-tower/ct-test-gate.test.sh        → 结果: 6 通过, 0 失败   rc=0
tests/control-tower/platform-checklist.test.sh  → 结果: 14 通过, 0 失败  rc=0
tests/control-tower/claim-regex-narrow.test.sh  → 结果: 9 通过, 0 失败   rc=0
tests/control-tower/check-preset-bundles.test.sh→ PASS=39  FAIL=0       rc=0

CI 等价跑（GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main）rc=0、stderr 0 行：
  ✅ V5 平台敏感命令: 新控制塔脚本对照 PLATFORM-CHECKLIST.md (D520)
  ✅ CT-40 控制塔脚本测试配对: SYNC-OK: 控制塔脚本配对测试全绿 (8 个脚本)
  ✅ D945 预设 bundle 源形态: --repo 汇总: 发现 1 个预设, 违规 0 个
```

### 3.2 改坏必红（**行为级**，非 grep 断言）

| 点 | 变异 | 原始输出 |
|---|---|---|
| ④ CT-40 | 门禁脚本改名 | `❌ CT-40 控制塔脚本测试配对: 门禁脚本缺失: 1 处 [CI strict]` + `::error title=IronLaws:…` |
| ④ CT-40 | 观测面探针（同一行仅去掉回填） | 见 §九 |
| ⑤ platform | 新增脚本注入裸 `python3` | 本地 `⚠️ …: 1 处` 点名探针；`SYNO_CI=1` → `❌ … [CI strict]` |
| ⑤ platform | 对照：探针改 PYBIN 化 | `✅`（零误报） |
| ⑤ platform | 删 D520 块（同路径 swap） | `platform-checklist.test.sh` → **12 通过, 2 失败**：`❌ pre-commit 接线缺失` + `❌ 未点名` |
| ⑥ claim-regex | 正则收窄为 `已拆` | `claim-regex-narrow.test.sh` → **5 通过, 4 失败**：`❌ T1 收窄后正则缺失` + `❌ T4a/T4b/T4d 未触发` |
| ⑥ claim-regex | 行为探针（CI 口径） | 含「已拆分」→ `❌ 铁律 47 … [CI strict]`；含「迁移完成」→ ❌；**裸「拆分」无「完成」→ 无输出（收窄语义正确）**；无声称 → 无输出 |
| ⑦ preset | 调用改指不存在脚本 | `❌ D945 预设 bundle 源校验（rc=127）: 1 处 [CI strict]` + 载荷 `rc=127 — bash: …NO-SUCH-preset-bundles.sh: No such file or directory` + `::error` 注解 |
| 附 | `ct-test-gate.sh` 生产 diff 基缝 fail-closed | 正常 base → `SYNC-OK…(8 个脚本)` rc=0；不存在 base → `rc=2` + `degraded: git diff … 失败（fail-closed，不当作无变更）`；ARM 覆盖变量在生产（非 ARM）被忽略 |

**③结论：一致**（4 点均有"有它则绿 + 坏它则红"，且红/绿均为生产脚本行为，非静态 grep）。

---

## 四、④ claim-regex 是否逐字为 V5.2.x `:775` 原文

```
$ git show 0889eb16^:scripts/pre-commit-check.sh   → 1603 行
$ sed -n '775p' …   if grep -qi "已拆\|已迁移\|已清理\|拆分.*完成\|迁移.*完成\|清理.*完成\|完成.*拆分\|完成.*迁移\|完成.*清理" "$BRIEF" 2>/dev/null; then  # swallow-ok: …
$ sed -n '558p' 1f577444:scripts/pre-commit-check.sh    if grep -qi "已拆\|已迁移\|已清理\|拆分.*完成\|迁移.*完成\|清理.*完成\|完成.*拆分\|完成.*迁移\|完成.*清理" "$BRIEF" 2>/dev/null; then

提取模式串比对：V5.2.x = 60 字符；交付版 = 60 字符；逐字相同 = True；字符级差异 = 0
```

差异仅在**缩进**（交付版在 CI 权威区内缩进 4 空格）与**去掉尾部 `# swallow-ok` 注释**（该注释语义已由块首三态注释承接）。**逐字一致成立。**

---

## 五、⑤ `|| true` 清理点 + `::warning` 可见性

### 5.1 调用点已改显式 if（`ci.yml:337-341`）

```
337          # task-28 裁定②: 原 `check-canary-drift.sh || true` 退役——逻辑已内联入 ct-health.sh；
338          #   `|| true` 一并清除（不静默吞）：改显式 if + ::warning 注解，退出码仍不阻断本 step。
339          if ! bash scripts/control-tower/ct-health.sh canary-drift; then
340            echo "::warning title=canary-drift::漂移对账非零退出（告警不阻断，K3 P2-4 单独立项）"
341          fi
```

`grep -n '|| true' ci.yml` 全文件仍有多处（40/47/77/159/163/311/312/369/436/437/474/488/492/493/494…），逐条核**均非本调用点**（tsc 管道过滤、日志、git fetch 兜底等既有 `swallow-ok`/设计内用法）—— 裁定5 指定的这一处**已清**。

### 5.2 `::warning` 可见性（行为级）

- 注入漂移探针（新增未登记 `tmp-canary-probe.test.sh`）：`ct-health.sh canary-drift` 输出
  `::warning title=canary-drift::70 个测试不在 CI canary 清单: …`（基线 69 → 注入 70，**计数随探针变化**，可判别）。
- 中和 `ct-health.sh:260` 的 `::warning` 发射 → `check-canary-drift.test.sh` **9 通过, 2 失败**（`❌ 缺 ::warning` / `❌ 真机输出异常`），还原后 sha `6f4a8380…` 一致。
- **O1（登记）**：`ct-health.sh canary-drift` **在漂移存在时仍 exit 0**（设计如此：canary 漂移=告警恒 0，见 `check-gate-integrity.sh:109` 分工注释、测试断言"真机自检: exit 0（告警不阻断）"）。因此 `ci.yml:339` 的 `if !` 分支**只在 ct-health 自身异常（如脚本崩溃/清单源缺失以外的失败）时才有可能触发，漂移本身不触发**；漂移可见性实际由 ct-health 自打的 `::warning` 承担（已实测可见）。**不是缺陷**（与"告警不阻断"一致），但"改显式 if + ::warning"对该调用点的**净增益只覆盖异常路径**，建议回执注明，避免读者误以为漂移会走 ci.yml 的那行 warning。

---

## 六、⑥ L11 脱敏核

```
(a) 目标文件现状（D962-2a2-selfverify.md 第 35 行）:
      | Secrets | `sk-<22 位字母的门禁夹具串，task-28 按 CTO 裁定脱敏>` | check-secrets.sh rc=1，❌ 工作区发现真实凭证: 1 处（点名） |
(b) 回执声明范围（docs/synova/product-lines/evidence/）残留:
      grep -rnE 'sk-[a-zA-Z0-9]{20,}|cli_[a-z0-9]{10,}' docs/synova/product-lines/evidence/  → 0 行  ✓
(c) 暂存该文件后跑门禁:
      ✅ 工作区无真实凭证 / ✅ 暂存文件无硬编码凭证 / ✅ Secrets 扫描: 全部通过     rc=0
(d) 判据非空转对照（把该行还原为夹具假 key 再暂存）:
      ❌ Secrets 扫描: 1 项违规 — 提交已拒绝                                     rc=1
      （还原后 rc 回 0，工作树与 HEAD 差异 = 0）
```

**O3（登记 · 全库口径）**：任务书写的"全库残留 `sk-[A-Za-z0-9]{20,}` 应为 0"在**全仓**不成立 —— 实测命中 **8 个文件**，且与 `origin/main` **集合完全相同（本 PR 未增未减）**：`docs/archive/08-代码审计报告-20260603.md`（含 `sk-41e897d2…`，该文档本身在记录历史事故）、`docs/synova/archive/2026-05-06/SYNOVA-全量静态代码分析报告-*`、以及 6 个测试夹具（`check-secrets.test.sh` / `doc-commit-exempt.test.sh` / `precommit-groups-injection.test.sh` / `secrets-env-exempt.test.sh` / `pii-scrubber.test.ts` / `pre-upload-validator.test.ts`）。**本卡范围内（证据目录 + 该文件）= 0 ✓**；全库存量是否清理属独立议题。

---

## 七、⑦ 权威计数口径实测 + 算式自洽

```
$ find scripts -type f -name 'check-*' ! -path 'scripts/audit/*' | wc -l
21
main 同口径（git ls-tree -r origin/main -- scripts，排除 scripts/audit/，取 basename ^check-） = 48
（scripts/audit/ 内 check-* = 1，故未排除时为 49；口径必须排除 audit，实测与 21 口径对齐）
main 有 / HEAD 无 的 check-* 清单 = 27 条（逐名可点）
48 − 27 = 21  ⇔ 实测 21   ✓ 算式自洽
本卡退役 3（check-hardcoded.sh / check-canary-drift.sh / check-name-allocation.sh）均在该 27 条清单内 ✓
```

**⑦结论：一致**（21 为实测值，非凑数；差 1 到 ≤20 的归属问题属 CTO 裁定，不在本自验判定范围）。
附：本提交写集实测 `git diff --name-status origin/main..1f577444` = **104 = 34A+29D+41M**，与 `task-state/D962.json#write_set` **逐类一致**（见 O2）。

---

## 八、⑧ N12 措辞核（PR #803 正文）

```
docs/synova/coordination/D962-PR803-body.md:
  L5: > ## ⛔ **CI 未跑（外部队列停摆 @2026-09-25T19:04:20Z）**
  L6: > 所有 CI run（9fd034dd / 25e1b414 / 933bf1de 及其后）全部 queued，无一产出结论 ⇒ 本文所有判据均为 本地 CI 等价复跑（不等价于真 run）
  L7: > **禁以本地等价冒充实跑**；**CI 恢复后必须重跑本 PR 与 main 两侧并补结论**；**合并前若无真 run 结论，需创始人书面接受风险**
  L63: 真 CI 队列积压 36168743118 / 36168749183 / 36170408913 / 36170416178 全部 queued、无结论 ⇒ …（不以本地等价冒充实跑）
```

含**显式未跑声明 + ISO 时标 + 具体 run id + 禁止冒充条款 + 创始人书面风险条款**；未见任何"本地等价 == 真 run"的表述。**一致。**

**O2（登记 · 口径）**：正文 L10/L18/L19 的"写集 97 = 33A+26D+38M"是**显式声明为 `ae371c45` 代码态**的快照（正文自述"不再递归追写自身 sha"），而 HEAD `1f577444` 实测/声明均为 **104 = 34A+29D+41M**（增量 = 本卡 3 退役 + 8 件证据迁入 + 回执等）。属自述范围的快照，**非写集缺陷**，但 PR 正文读者若只看数字会误读，建议与 task-26 的 F3 同类处理（合并前刷新一次或加"随本卡增至 104"字样）。

---

## 九、⑨ 新增 fail-open 自修核（④⑦ 失败分支 rc≠0 必计红）

对 ④⑦ 各做**双注入**（交付版 vs 去掉回填的反例），证明"失败必计红"不是句子而是行为：

| 点 | 注入 | 交付版（有回填） | 反例（去掉回填） |
|---|---|---|---|
| ④ CT-40 | 被调脚本 `exit 3` **且零输出** | `❌ CT-40 控制塔脚本测试配对（rc=3）: 1 处 [CI strict]` + 载荷 `rc=3（无输出；见 CT-40 门禁原始退出码）` + `::error` 注解 | `✅ CT-40 控制塔脚本测试配对（rc=3）` —— **假绿**，且当次全树 `❌` 计数 = **0** |
| ⑦ preset | 调用改指不存在脚本（rc=127） | `❌ D945 预设 bundle 源校验（rc=127）: 1 处 [CI strict]` + 载荷 `rc=127 — bash: …No such file or directory` + `::error` 注解 | `✅ D945 预设 bundle 源校验（rc=127）` —— **假绿** |

⇒ 回执所称"rc=127 曾打 ✅（fail-open）"的形态**可复现**，且交付版的回填**确实把它堵住**（计 ❌ + 计入 `HARD_FAIL` → 提交拒绝）。**⑨结论：一致。**

---

## 十、登记项汇总（均不影响九项通过）

| # | 事项 | 级别 | 建议 |
|---|---|---|---|
| O1 | `ci.yml:339` 的 `if !` 兜底分支对"漂移"不可达（ct-health 漂移恒 exit 0）；漂移可见性由 ct-health 自打 `::warning` 承担（已实测） | 登记 | 回执/注释注明"该行只覆盖异常路径"，免误读 |
| O2 | PR 正文写集 97（`ae371c45` 快照）vs HEAD 104 | 登记 | 合并前刷新或加增量字样 |
| O3 | 全库 `sk-[A-Za-z0-9]{20,}` = 8 文件（与 main 全同、本 PR 未动）；本卡范围内 = 0 | 登记 | 存量清理另立议题 |
| O4 | 内联 #3 命中输出里的字面 `\n`（`${HARDCODE_DATA}…\n` 未 printf 展开）显示为 `…\\n` | 微 | 可与 L12 同卡顺手修 |
| O5 | `--check-id D9` → rc=0（按实现"应形如 D942 或 942"，`9` 属合法号）；非法判据是"去前缀后非纯数字" | 微 | 口径无需改，仅记录边界 |

---

## 十一、附：上一轮 F1 修复复核（本自验顺手回放）

```
$ grep -n '靠 bash' scripts/pre-commit-check.sh          → 无（注释已改写）
$ 非注释行含反引号 = 0（脚本内 16 行含反引号，全在 # 注释行）
$ GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh
   rc=0；stderr 行数 = 0     （task-26 时同口径 stderr=2 行）
修复提交：1a50460f fix(D962): V2 自验 F1 反引号修复 …
```

---

## 十二、自验结论

> **自验结论：通过（九项核对全部一致；另 1 项成立的新发现 = L12 定级建议上调，附 5 项登记）。**
>
> - ① 退役 3：脚本确删、**无活引用**（余者皆注释/保留守卫测试）、三承界面均在位且行为可用（canary 11/0、name-alloc 9/0、`--check-id` 三态 rc=1/0/2、#3 探针命中）；
> - ② **L12 独立复现成立且证据更强**：内联 #3 对 `'marketing'/'sales'/'finance'` 恒空转（首段 grep 命中 → 排除链自吞），而被退役 `check-hardcoded.sh` 对**同一行**能命中 ⇒ **能力回退**，建议 CTO 新卡按"回退"而非"覆盖窄"定级；
> - ③ wire 4：4 测试绿（6/0、14/0、9/0、39/0）+ CI 等价生产跑绿（rc=0、stderr 0）+ 4 点各自变异红（含行为级探针）——**判据非空转**；
> - ④ claim-regex **逐字 = V5.2.x:775**（60/60，0 差异）；
> - ⑤ `|| true` 指定点已清、`::warning` 实测可见（附 O1 口径登记）；
> - ⑥ L11：证据目录与目标文件残留 = 0、暂存门禁 rc=0、还原假 key 反例 rc=1（判据有效）；全库口径见 O3；
> - ⑦ 21 = 48 − 27 实测自洽，本卡 3 退役在 27 内；
> - ⑧ PR 正文含"CI 未跑 @2026-09-25T19:04:20Z" + 禁冒充 + 创始人书面风险，无冒充；
> - ⑨ fail-open 自修经 rc=3 / rc=127 双注入 + 无反例对照证明**必要且有效**（反例确实打 ✅）。
>
> **不构成审计通过** —— 通过与否归 CTO 收件闸 + K3 终审。
> **边界（未核/不可判）**：真 CI run（`gh` 本机不可用，正文已自标"队列停摆/待补"，属 L3 未清）；Windows 侧；vitest 全量（不在本卡判定面）；远端 reflog（force 判定只能给本地可观测结论，承接 V8 的 F4）。
> **本报告落 `docs/synova/product-lines/evidence/`（D581 豁免跟踪路径）**，主树未提交（本角色不 commit）；请队长按 M6 走正规通道提交。
