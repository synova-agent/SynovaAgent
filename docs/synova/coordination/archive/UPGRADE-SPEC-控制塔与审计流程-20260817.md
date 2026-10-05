# Synova 控制塔与审计流程升级方案（完整施工版）

> **作者**：DeepSeek Harness（Mac DSH，🧭 CTO） | **日期**：2026-08-17
> **上游文档**：[OPTIMIZATION-双侧质量体系与审计流程-20260817.md](OPTIMIZATION-双侧质量体系与审计流程-20260817.md)（评估与决策建议）
> **性质**：可施工的升级 spec。所有控制塔脚本变更遵循 `ctrl-tower-change` + `windows-compat` + `contract-template` 模式库（三态退出码 / UTF-8 头块 / 条件跳过 <1s / 测试注入沙箱）。
> **红线**：不碰 `scripts/audit/`（K3 专属）；不修改审计判定口径（U8 审计流程仅提工程侧框架，判定标准本体归 K3，采纳权在创始人 + K3）。
> **利益声明**：控制塔脚本是作者领地，作者即责任方。

---

## 第一部分：总览

### 1.1 目标

把评估阶段发现的三大类问题固化为物理门禁，一次性根治：

| 类 | 问题 | 对应 M 模式 | 升级项 |
|---|---|---|---|
| 过程产物靠自觉必漏 | bypass.log 证据链断裂、写集漂移、产物不可复现、声称无证据 | M2/M4/M7 | U1/U2/U3/U4（第一阶段） |
| 门禁误伤反噬 | marker 并发死锁、secrets 过拦、verify-parallel 误报 | M1（判定语义） | U5（第二阶段） |
| 约束不对称 + 审计成本 | Mac 无写时约束、K3 审机器能查的项 | — | U6/U7（第二阶段）、U8（第三阶段） |

### 1.2 设计原则（全部升级项共享）

1. **三态退出码（D328 根）**：`exit 0` 通过 / `exit 1` 业务阻断 / `exit 2` 检查本身执行失败或降级。绝不把"检查没跑成"与"检查通过"混同，也绝不把"降级"与"失败"混同（后者是误伤根因）。
2. **fail-closed 默认，degraded 显式**：降级必须写日志 + 标 `degraded: true`，禁止 `|| true` 吞崩溃。
3. **exit 2（降级）的阻断按场景区分（自查澄清，统一 U1 与 U5）**：D328 原始设计 exit 2 同样阻断（绝不与通过混同），但 CT-29/CT-30 误伤证明"工具降级 ≠ 安全问题"时不应锁死全线。统一口径——
   - **安全关键对账**（证据链完整性/合规证明，如 U1 bypass 对账）："查不了 = 无法证明合规 = 等同于不合规"→ exit 2 阻断（或要求显式人工确认豁免并记 degraded-events.log）。
   - **工具自身降级**（git/网络/环境不可用，如 U5 marker/secrets 工具失败）：exit 2 → 告警 + 记 degraded-events.log + 提供人工确认逃生舱，**不硬阻断**（否则一次工具故障锁死全线，CT-29/CT-30 重演）。
   - 共同底线：无论阻断与否，降级**必须显式记 degraded-events.log**，绝不静默（铁律 11）。
4. **条件跳过 <1s**：新门禁只在相关文件入暂存区时运行（V4.5.1 教训：122s 超时 = 被迫 `--no-verify` = 全线失效）。
5. **测试注入沙箱**：环境变量/`--home` 注入覆盖真实路径，测试零真实目录零网络；测试含生产接线 grep 检查（铁律 0-2 WIRE CHECK）。
6. **机器能查的不靠人审**：能写成 grep/bash 检查的全部前置到 pre-commit/CI，K3 只审语义。
7. **文档豁免原则（最高优先级约束 — 创始人 CT-34 决策 + 2026-08-17 重申）**：纯文档提交的目的是**跨机器同步信息**（docs/、memory/、task-state/、.claude/task-briefs/、根级 *.md/*.html/*.txt），**不触发本方案任何新代码门禁**。所有新门禁（U1-U7）的条件跳过必须先经 CT-34 的 `is_doc_only` 判定早退。文档真实性不靠 pre-commit 门禁，靠 K3 审计兜底（声称 vs 事实复核）。**历史教训（不得重蹈）**：D362 文档拉平死锁 + D366 审计登记反复卡——文档门禁过强曾浪费大量时间。

### 1.3 升级项清单与路线图

| # | 升级项 | 阶段 | 修复对象 | 归属 | 状态 |
|---|---|---|---|---|---|
| U1 | bypass.log 证据链对账门禁 | 一 | M4（CT-17，4 次复发） | DSH | spec |
| U2 | dev doc 写集双向对账门禁 | 一 | M2/M7（写集漂移） | DSH | spec |
| U3 | 生成器产物可复现校验 | 一 | 产物不可复现（3 次复发） | DSH | spec |
| U4 | 交付方"声称↔证据"自证表 | 一 | M2（K3 降本前提） | DSH | spec |
| U5 | 门禁三态化改造（CT-29/30/28） | 二 | 门禁误伤 | DSH | spec |
| U6 | Mac DSH 写时约束（goal 门禁化） | 二 | Mac 约束不对称 | DSH | spec |
| U7 | 控制塔测试接入门禁 | 二 | CT-40 | DSH | spec |
| U8 | 三层审计模型 + 风险分级 | 三 | K3 成本 | 创始人+K3 决策 | 框架 |

**依赖关系**：U1-U4 彼此独立可并行；U5 独立；U6/U7 独立；U8 依赖 U1-U4 落地（机器预审是审计分层的前提）。

---

### 1.4 研究阶段新发现（施工前必读，均经行号核实）

撰写本 spec 前的脚本实证研究，发现若干影响设计的事实：

1. **synova-commit 路径 13 组门禁跑两遍**：`synova-commit:549` 先 `bash pre-commit-check.sh`，`:571` `git commit` 又触发 `.git/hooks/pre-commit`（install-hooks.sh:45 委托同一脚本）→ 每次 commit ~2×50s。这是未登记的效率损耗（见 U5 附注）。
2. **DEGRADED 路径不写 HASH**：`synova-commit:476` 的 DEGRADED 记录无 `HASH=` 字段，但该路径仍 `git commit`（:480-483）→ 此提交在 `check-bypass-log.sh` 按 hash 对账时**必然报缺失**（U1 必须补）。
3. **check-bypass-log.sh 已存在且已接入 pre-push 门禁 7**（对账 `git log BASE..HEAD --no-merges` vs bypass.log，:49-54），但 **base 不可解析时 fail-open exit 0**（:41-42）。U1 是"修复 + 前移"，非从零建。
4. **scripts/workflow/loop-context.sh:88 `grep -c "$TODAY"` 未过滤 `detected-bypass`**——把 COMMITTED 正常提交也计为绕过，是 GATEKEEPER 误报熔断源之一（并入 U1 修）。
5. **pre-push-check.sh:71 声称 `SYNO_ALLOW_MAIN_PUSH` 逃生舱"已记 bypass.log"，全仓 grep 无对应写入代码**——M2 声称 vs 事实实例（并入 U1 修，要么补写入要么删声称）。
6. **写集对账是 fail-open 且单向**：`check-dev-doc-write-set.sh` 只查"声明了没改"，"改了没登记"完全没查；无写集表/doc 缺失全部 SKIP exit 0（:54-83）；头部承诺的"计数对比"（:10）未实现。G12c 靠 `|| true`+❌grep 判定，脚本崩溃静默放行。
7. **gen-cto-health.py 无任何仓库态校验**（`cat-file/ls-tree/ls-files` 零匹配），spec/audit 派生只看工作区文件 `.exists()`（:225-228）——产物不可复现现场。退出码只有 0（无三态）。
8. **dev_doc_gatekeeper.py 无 C6**（.sh 有 C6、.py 没有）——双版漂移（并入 U2 修）。

---

## 第二部分：第一阶段升级项（纯省钱，DSH 领地内）

> 目标：把复发 ≥2 次的过程产物问题固化为物理门禁，让 K3 不再为同类问题反复付费。

### U1 — bypass.log 证据链对账门禁（CT-17，M4 第 4 次复发）

#### 背景与问题

`bypass.log`（`.claude/bypass.log`，git 跟踪）是"每次提交都过了 pre-commit"的唯一证据链。M4 已 4 次复发（D328→D329→D383→D394/D395a），每次 K3 都要手工对账 git log vs bypass.log。三个断裂源（行号实证）：

- **写了没提交**：bypass.log 是 git 跟踪文件，synova-commit 在 `:601` 追加 COMMITTED 记录，但若本次提交的文件集不含 bypass.log，则新记录留在工作区未入库 → K3 `git show` 出旧版本，证据链断。
- **DEGRADED 无 HASH**：`:476` DEGRADED 记录无 HASH，但该提交真实发生 → `check-bypass-log.sh` 按 hash 对账必然报缺失。
- **对账 fail-open**：`check-bypass-log.sh:41-42` base 不可解析时 exit 0（查不了 = 通过，M1）。

#### 契约

```bash
# scripts/control-tower/reconcile-bypass-log.sh（新）
# 契约:
#   @input  — [--self-test]（测试注入）| 无参（synova-commit :601 后 / pre-push 调用）
#             环境注入 SYNO_BYPASS_LOG / SYNO_BASE（测试用）
#   @output — 对账报告；缺失提交逐行点名（hash + 提交标题）
#   @exit   — 0 = 证据链完整；1 = 有提交缺证据记录（业务阻断）；
#             2 = 检查执行失败/降级（base 不可解析/git 不可用/bypass.log 缺失）
#   @degraded — exit 2 + stderr "degraded: <原因>" + 追加 .claude/degraded-events.log
#   @error  — .code=BYPASS_RECONCILE_ERROR .phase=commit|push .retryable=true
```

#### 实现方案（四子项）

- **U1a 证据链随提交入库**：`synova-commit` 在 `git commit` 前，检测 `git diff --name-only -- .claude/bypass.log` 非空且 bypass.log 不在本次提交文件集 → `git add .claude/bypass.log` 自动并入 + 显式 log `"bypass.log 证据链随提交入库"`。改动点：synova-commit `:569` 之前。
- **U1b DEGRADED 补 HASH**：`:480-483` DEGRADED 路径 commit 成功后，补写 `... | DEGRADED-COMMITTED | TASK_ID=.. | HASH=$(git rev-parse HEAD)`。
- **U1c 对账 fail-open 修复（两处 + 时间戳统一）**：① `check-bypass-log.sh:41-42` base 不可解析时 exit 0 → exit 2 + 写 degraded-events.log；② `:49` `git log ... || true` git 失败 → 空循环假 PASS → exit 2。pre-push 门禁 7 对 exit 2 硬阻断（fail-closed，防"查不了=通过"）。合法浅克隆用显式 `SYNO_BYPASS_BASE` 豁免并记 degraded-events.log。③ 顺带统一时间戳：post-commit.sh 用 UTC（`date -u`）、synova-commit 用本地时区（`date -Iseconds`），同一 bypass.log 两种格式共存 → 统一 UTC（防对账/解析漂移）。
- **U1d 误报熔断源修复**：`loop-context.sh:88` `grep -c "$TODAY"` → `grep -c "$TODAY.*detected-bypass"`（只计真绕过，对齐 pre-commit-check.sh:104 现行口径）；pre-push-check.sh:71 的虚假声称——补 `SYNO_ALLOW_MAIN_PUSH` 实际写入 bypass.log，或删除该注释。

#### 测试方案（tests/control-tower/reconcile-bypass-log.test.sh）

| 路径 | 用例 |
|---|---|
| 正常 | 全部提交有 COMMITTED 记录（含 HASH）→ exit 0 |
| 降级 | bypass.log 不存在 / base 不可解析 / git 不可用 → exit 2 + degraded-events.log 有记录 |
| 边界 | DEGRADED-COMMITTED 无 HASH 提交被识别为缺失；merge commit 跳过；root commit 不误报；bypass.log 有未提交工作区变更时 U1a 触发 add |
| 接线 | grep `reconcile-bypass-log` 在 synova-commit 与 pre-push-check.sh 中被调用（铁律 0-2） |

#### 验收（Done）

- [ ] `bash tests/control-tower/reconcile-bypass-log.test.sh` 全绿
- [ ] 制造一次"bypass.log 改了没提交"→ commit 时被 U1a 自动并入（物理复现）
- [ ] `git log` 与 bypass.log 对账脚本 exit 0（本仓现状）
- [ ] pre-push 人为制造 base 不可解析 → exit 2 硬阻断（非静默放行）

#### 风险与回滚

风险低（只读对账 + 自动 add 一个机器文件）。**文档豁免**：纯文档提交（CT-34 `is_doc_only` 判定）的对账缺失降级为告警不阻断——文档常为同步信息、可能直接 `git commit` 不经 synova-commit（无 COMMITTED 记录），不得因此卡文档同步（原则 7）。回滚 = 删 synova-commit 一处 add + 还原 check-bypass-log.sh 退出码。不碰审计脚本。

---

### U2 — dev doc 写集双向对账门禁（M2/M7）

#### 背景与问题

dev doc §3.1 声明的写集 vs 实际 `git diff` 文件集应一致。现状两处漂移：D355 写集 7 实际 9（少列 2）；D383 声称 25 实际 23（漏交）。现有 `check-dev-doc-write-set.sh` **只查"声明了没改"单向**，"改了没登记"完全没查；无写集表时 fail-open exit 0；G12c 靠 `|| true`+❌grep，崩溃静默放行。

#### 契约

```bash
# scripts/workflow/check-dev-doc-write-set.sh（扩展，不重写）
# 契约:
#   @input  — 无参（pre-commit G12c 调用，暂存含 SYNOVA-IMPL-*.md 时）；
#             环境注入 SYNO_TEST_ARM=1 + SYNO_GIT_CACHED_*（测试）
#   @output — 双向对账报告：超出声明集（over）+ 少于声称集（under）逐行点名
#   @exit   — 0 = 写集与实际一致；1 = 有偏差（业务阻断）；
#             2 = 检查执行失败/降级（无写集表但暂存含 dev doc / git 不可用）
#   @degraded — exit 2 + stderr 原因（铁律 11；区分"无 dev doc 无需对账"=exit 0 与"有 dev doc 无写集表"=exit 1）
```

#### 实现方案

- **U2a 双向对账**：在现有单向基础上，补反向集合差——`git diff --cached --name-only`（代码文件）对写集表取差集。**rename 容错**（D395a O1：git mv 呈 R 条目）：用 `git diff --cached --name-status` 解析 `R100 old new`，rename 前后视为同一文件，不计偏差。文档类（docs/、memory/、task-state/）默认豁免双向对账（CT-34 口径），仅代码/脚本/测试文件参与。
- **U2b fail-open 修复 + 三态**：无写集表但暂存含 `SYNOVA-IMPL-*.md` → exit 1（阻断，这正是 D381 C6 要的）；本就无 dev doc → exit 0（合法，无需对账）。
- **U2c G12c 接线三态化**：`pre-commit-check.sh:995-996` 去掉 `|| true`，保留 `DEV_DOC_EXIT=$?`，按 0/1/2 分别 soft_pass/hard_check/hard_check（沿用组 13 现行三态范式 :1009-1021）。
- **U2d 双版漂移修复**：`dev_doc_gatekeeper.py` 补 C6 写集表存在性检查，与 `.sh` 对齐（或删除 .py 版统一用 .sh——收敛单源，铁律 37）。

#### 施工隘口（研究实证，spec 已裁决——施工前必读）

> 以下 4 点是现状脚本里已存在、双向对账必然撞上的坑，spec 提前裁决，施工者照做即可：

1. **G12c 触发逃逸**：G12c 仅在"dev doc 同 commit 暂存"时触发——dev doc 先提交、代码后提交则对账完全不运行。**裁决**：对账绑定"当前任务 dev doc"（仿 `.claude/current-brief` 机制，维护 `.claude/current-dev-doc` 指针），而非仅看本次暂存是否含 dev doc；commit 端用指针对账当次，pre-push 端兜底做全分支对账（防多次 commit 累积逃逸）。
2. **对账基准混用**：现脚本 `check-dev-doc-write-set.sh:117-118` 混用 `git diff HEAD`（含未暂存）与 `git diff --cached`（暂存）。**裁决**：pre-commit 语境统一用 `git diff --cached --name-only`（暂存集），避免未暂存文件误报；pre-push 语境用 `git diff <base>...HEAD`。
3. **clean_entry 全小写**（`devdoc_writeset.py:80`）：路径被归一为小写。**裁决**：反向精确匹配前，实际 diff 文件集也先经同一 `clean_entry` 归一（大小写敏感 FS 上否则误报）；或在反向对账里做大小写不敏感比较。
4. **目录级 / 多文件单元格**：目录级条目（`/` 结尾）在反向集合差中展开为其下实际变更文件做前缀匹配；多文件单元格（如 `.gitignore / .gitattributes`）先拆分再逐项对账。

#### 测试方案

| 路径 | 用例 |
|---|---|
| 正常 | 写集 = 实际 diff → exit 0 |
| 降级 | git 不可用 → exit 2 |
| 边界 | 改了没登记（over）→ exit 1 点名；声明了没改（under）→ exit 1 点名；git mv rename 不计偏差；纯文档提交豁免；有 dev doc 无写集表 → exit 1 |
| 接线 | grep `check-dev-doc-write-set` 在 pre-commit-check.sh 中被调用且 exit code 未被 `|| true` 吞 |

#### 验收（Done）

- [ ] 双向偏差用例全绿（over/under/rename/豁免）
- [ ] 人为制造"改了没登记"→ commit 被 G12c 阻断
- [ ] 杀掉 check 脚本（模拟崩溃）→ G12c exit 2 硬阻断（非静默放行）

#### 风险与回滚

风险中：双向对账可能误伤"合理的临时文件"。缓解：文档类豁免 + rename 容错 + 清晰点名（让作者一眼看到哪个文件没登记）。**文档豁免**：纯文档提交（无代码/脚本/测试变更，CT-34 `is_doc_only`）不触发写集对账——文档同步不该被对账卡（原则 7）。回滚 = 还原 G12c 的 `|| true`。

---

### U3 — 生成器产物可复现校验（产物不可复现 3 次复发）

#### 背景与问题

`gen-cto-health.py` 生成 CTO-HEALTH.md 时，spec/audit 派生只读**工作区文件** `.exists()`（:225-228），无仓库态校验 → 工作区含未提交/未合并文件时，产物显示"spec_done ✅"但 main 树里根本没有该文件（D399/D394 phantom 行实证）。产物脱离 git 真相 = 不可复现 = K3 审计失真。退出码只有 0（无三态）。

#### 契约

```python
# gen-cto-health.py 新增仓库态校验（不改对外渲染契约）
# 契约:
#   @input  — 源文件路径（task-state/*.json / spec / audit-report 路径）
#   @output — 复用现有 CTO-HEALTH.md；新增：phantom 条目显式标 degraded 而非渲染为 ✅
#   @exit   — 0 = 全部源可复现；1 = 有 phantom 条目（--strict 时业务阻断）；
#             2 = 检查执行失败/降级（git 不可用 → 全量标 degraded，不静默）
#   @degraded — 源文件未被 git 跟踪（untracked/uncommitted）→ 该条目渲染为
#               "⚠ degraded: 源未入库（git cat-file -e 失败）"，绝不渲染为 ✅
```

#### 实现方案

- **U3a 仓库态校验函数**：新增 `_repo_tracked(path) -> bool`——`git cat-file -e HEAD:<path>`（或 `git ls-files --error-unmatch <path>`，三态：0 跟踪/1 未跟踪/2 git 不可用）。替代裸 `.exists()`（:225-228）。
- **U3b phantom 不渲染为 ✅**：源文件 `_repo_tracked` 返回 False → 该条目渲染 `⚠ degraded: 源未入库`；git 不可用（exit 2）→ 整表标 degraded + stderr。
- **U3c 三态退出码**：默认模式 phantom 只告警不阻断（报告工具属性）；`--strict` 模式 phantom → exit 1（供 CI/pre-commit 阻断用）。git 不可用 → exit 2。施工落点（行号实证）：`:186` 旁（唯一 git 调用处）加校验、`:225-228` 派生加"已提交"维度、`:421` 指纹 sha256 纳入 git 态、`main` :400-449 加 exit 2 分支。
- **U3d 顺带修文档漂移**：docstring :12 写 `AUDIT-FINDINGS-LEDGER.md`，实际 :41 读的是 `审计发现台账-DSH-CTO.md`——对齐（M7）。另修现存静默吞错 :55-57/:194-196/:217-218/:280-281。
- **适用范围**：gen-cto-health.py + generate-dashboard.py + gen-task-board.py（三生成器同一校验函数，抽公共模块 `scripts/control-tower/repo_state.py`，避免三份副本，铁律 37）。

#### 测试方案

| 路径 | 用例 |
|---|---|
| 正常 | 全部源已入库 → 渲染 ✅，exit 0 |
| 降级 | git 不可用 → 全表 degraded，exit 2 |
| 边界 | 源文件 untracked → 该条目渲染 degraded 非 ✅；--strict 时 exit 1；rename 后源路径校验 |
| 接线 | grep `_repo_tracked\|repo_state` 在 gen-cto-health.py 中被调用 |

#### 验收（Done）

- [ ] 制造一个 untracked spec 文件 → 生成 CTO-HEALTH 该条目显示 degraded 而非 ✅（物理复现 D394 phantom 不再发生）
- [ ] --strict 模式 phantom → exit 1

#### 风险与回滚

风险低（报告工具，非阻断）。回滚 = 还原 `.exists()`。注意：生成器是 DSH 领地，但要确保 degraded 标记不破坏现有 CTO-HEALTH 渲染格式（前端/仪表盘消费方）。

---

### U4 — 交付方"声称↔证据"自证表（M2，K3 降本前提）

#### 背景与问题

K3 每份审计报告都要重新收集 7 项材料（材料确认表）逐项物理复测——这是成本大头。根因：交付方的"声称"没有绑定可执行证据，K3 只能当侦探重新查。S-10/S-11 已要求 DS verify 映射"声称↔用例"，但无硬格式、无机器预跑。

#### 定位（重要边界）

U4 **不能**机器化语义对账（"声称"是否属实是 K3 的语义判断）。U4 能机器化的是：**格式强制 + 证据命令可执行 + 证据命令预跑非空**。目标是把 K3 从"侦探"变"法官"——交付方交结构化对照表，K3 抽验即可。

#### 契约

```bash
# scripts/control-tower/verify-claims-table.sh（新）
# 契约:
#   @input  — <交付报告路径>（dev doc §交付声明节）；环境注入测试
#   @output — 对照表校验报告：每条声称是否有证据命令 + 证据命令预跑结果
#   @exit   — 0 = 对照表完整且证据命令全部可执行非空；1 = 有声称无证据/证据命令为空（业务阻断）；
#             2 = 检查执行失败/降级
#   @degraded — 证据命令执行失败 → 该条标 degraded + exit 2（不静默当通过）
```

#### 实现方案

- **U4a 硬格式**：交付报告模板（`dsh-devdoc-draft` + Codex dev-doc 模板）§交付声明节强制"声称↔证据对照表"，三列：`声称 | 证据命令 | 预期`。例：`| transitionFindingStatus 已接线 | grep -rn "transitionFindingStatus" src/ \| grep -v test | 非空 |`。
- **U4b 校验脚本**：`verify-claims-table.sh` 解析对照表，逐条执行证据命令，验证输出匹配预期（非空/含关键词）。任一证据命令失败/为空 → exit 1 点名该声称。
- **U4c 接线**：交付报告暂存时（`SYNOVA-IMPL-*.md` 含交付声明节）由 pre-commit 组 12 附挂触发（沿用 G12c 条件模式）。**安全约束**：证据命令必须白名单（只允许 grep/git/vitest/ls 等只读命令），禁止任意命令执行（防注入——这是最高风险点，见风险节）。
- **U4d persona/skill 联动**：编码 persona 汇报步骤⑧（"声称↔证据"）与本表对齐，填不出 = 不准提交。

#### 测试方案

| 路径 | 用例 |
|---|---|
| 正常 | 对照表每条声称有证据命令且预跑非空 → exit 0 |
| 降级 | 证据命令执行失败 → 该条 degraded + exit 2 |
| 边界 | 有声称无证据 → exit 1 点名；证据命令为空 → exit 1；非白名单命令（rm/curl 写）→ 拒绝执行 + exit 2 |
| 接线 | grep `verify-claims-table` 在 pre-commit-check.sh / dev-doc-gatekeeper.sh 中被调用 |

#### 验收（Done）

- [ ] 交一份缺证据的交付报告 → commit 被阻断并点名哪条声称没证据
- [ ] 白名单外命令被拒绝

#### 风险与回滚

**最高风险项**：执行交付方提供的命令有注入面。缓解：严格白名单（只读命令清单）+ 拒绝 shell 元字符（`;&|` 等）+ 超时。若白名单实现复杂，**降级方案**：U4 第一版只查"对照表存在 + 格式正确"，不预跑命令（预跑留到第二版）。回滚 = 摘掉 G12 附挂触发。**文档豁免**：纯文档同步提交（只提交交付报告/dev doc、无代码实现）不强制自证表——自证表绑定"实现提交"（代码 + 交付报告同 commit，或经 `.claude/current-dev-doc` 指针关联），纯文档同步豁免（原则 7）。

---

## 第三部分：第二阶段升级项（降误伤 + 补约束）

> 目标：Win 侧治"门禁反噬"，Mac 侧补"写时约束"。

### U5 — 门禁三态化改造（CT-29 / CT-30 / CT-28）

> 共同根因：把"检查没跑成 / 降级"与"检查没通过"压成同一个 exit（M1 判定语义缺陷的反面——把降级当失败硬阻断 = 误伤）。统一修法：**三态输出，degraded 只告警不硬阻断**。

#### U5a — CT-29：pre-commit marker 并发死锁

**现场**（行号实证）：marker 是全局单例 `.claude/last-precommit-success`（install-hooks.sh:51 写 `HEAD|epoch`，**`>` 直接覆盖非原子，并发 pre-commit 后写者胜出**）。post-commit.sh:30 判定 `marker_head == HEAD^` 才 pass，`:41` 不等则记 `detected-bypass head-mismatch`。多 session 并发时 session B 的 pre-commit 覆盖 marker，session A commit 时 marker_head≠A 的 HEAD^ → A 被误判 bypass。**误报经三处放大**：① GATEKEEPER 组 0（pre-commit-check.sh:99-111）今日≥1 即硬阻断所有提交（D362 死锁）；② 组 7c（pre-commit-check.sh:701-718）今日 detected-bypass ≥3 硬阻断 / ≥2 警告；③ gen-cto-health.py（:39/:72-94/:286-287）24h 内有 detected-bypass → 仪表盘红灯升级创始人。D366 只改"不 rm 只覆盖"（post-commit.sh:39 注释），没解决"覆盖"本身。**附带跨平台 bug**：post-commit.sh:65 `grep -oP` 在 macOS BSD grep 无 `-P` → TASK_ID 恒为 `Dunknown`（D334 双机残留，正好踩 Mac/Win 差异）。

**实现方案（双管齐下）**：
- **主修（判定语义）**：post-commit.sh:30 判定从单一"精确等 HEAD^"改为**分场景三判**——
  ```
  pass 当且仅当满足其一：
  ① marker_head == HEAD^                              # 常规 commit
  ② git rev-parse marker_head^ == git rev-parse HEAD^ # amend（marker 的 parent == 新 HEAD 的 parent）
  ③ git merge-base --is-ancestor marker_head HEAD     # 并发（marker 被更新提交覆盖，仍是祖先）
  ```
  ⚠️ **自查修正**：单纯祖先对账（③）对 amend **无效**——amend 替换掉的旧 commit 不在新历史里，`is-ancestor` 返回假仍误报（即 D366 P1-1 已知伤）。amend 必须走判②（parent 相同）。安全性分析：bypass（`--no-verify`）时 pre-commit 不跑、marker 不更新停在旧提交——判③会**误判 pass**（放宽）。收紧补偿：加新鲜度校验 `marker_ts` 与 HEAD commit 时间差 >300s 仍报 possible-bypass（现有 :34-37 diff 逻辑保留）。**结论：三判 + freshness = 同时消除并发误报与 amend 误报，且不明显放宽真绕过检测。**
- **兜底（熔断三态化，覆盖两处消费方）**：组 0 GATEKEEPER（:99-111）与组 7c（:701-718）今日 detected-bypass 触发硬阻断 → 改为 exit 1 前先做"是否真绕过"二次确认（对账 marker 是否祖先/是否 amend），或降级为告警 + 要求人工 `SYNO_GATEKEEPER_ACK=1` 确认。防单点误报锁死全线。

**测试**：双 session 并发提交互不误判；amend 提交不误判；真 `--no-verify` 仍被抓（freshness 兜底）；GATEKEEPER 不再因单次误报锁死。

#### U5b — CT-30：secrets 门禁 fail-open 隐患

**现场**：check-secrets.sh 主体已修（D370：L53-56 未跟踪豁免 / L102-108 暂存阻断 / L157-171 被跟踪阻断），但仍有三处缺口：① **L55 "git 不可用 → 误判未跟踪 → 豁免" fail-open**——`git ls-files --error-unmatch` 失败既可能是"真未跟踪"也可能是"git 不可用"，现状混同 → git 故障时被跟踪 .env 也被豁免（判错方向=静默放行，M1）；② **L102 暂存 .env 阻断仅匹配根 `^\.env$`，子目录 .env 漏检**；③ docstring L5 声称 ak-/fk-/org-/飞书 secret 在全工作区扫描段，但 L27-29 只有 sk-/cli_——声称未实现（M2）。退出码 0/1 两态（豁免与真干净同态），另 L45/88/122/139/160 五处 `|| true`。

**实现方案**：① L55 前置 `git rev-parse` 预检区分"未跟踪"vs"git 不可用"——git 不可用 → exit 2（degraded，写 degraded-events.log），不静默豁免；确认真未跟踪才豁免。② L102 补子目录 `.env`（`(^|/)\.env$`）。③ L5 声称未实现的密钥模式——补实现或删声称（M2）。④ 整脚本三态化（0/1/2 + EXEMPT/DEGRADED 通道分流）。

**测试**：git 不可用 → exit 2 非静默豁免；真未跟踪 .env → 豁免 exit 0；被跟踪/暂存 .env → exit 1 阻断。

#### U5c — CT-28：verify-parallel 判定语义

**现场**（行号实证）：`--scan-today` 用纯文件名日期圈定当天文档（L135-147），再对称全组合两两比对写集重叠（L187-191），**无"依赖/接力"方向性**——D332/D307 与 D331 是接力关系却被误判并行冲突硬阻断。另有三处判定缺陷：① L90 靠 grep `'"status": "block"'` 文本判 block，格式漂移即静默放行（M1）——且 devdoc_writeset.py 内核本有三态（0/1/2，L139/142）被外壳压回两态；② "今天"按日历文件名圈定，**跨天自动脱险（非幂等）**——同两文档昨天拦今天放；③ `--check-declared`（L162）对全文 grep D 编号当并行声明，依赖提及也被拉入比对误伤。用法错误也 exit 0（L194）。

**实现方案**：
- 用法错误 exit 0 → exit 2（立即可做，低风险）。
- block 判定：L74-90 改为直传 devdoc_writeset.py 的 exit code（内核本有三态 L139/142），弃 grep 文本匹配——这是最小修复。
- **调用方分流**：verify-parallel 三态化后，调用方 pre-push:323 与 pre-commit:174 必须按 exit code 分流（0 过/1 业务阻断/2 降级告警），否则三态形同虚设。
- 接力/依赖识别：写集表加可选"依赖/接力自 <任务>"字段；比对时声明了接力关系的重叠降级为告警（非硬阻断）。这是较大改造，建议第二阶段单独立项（依赖 dev doc 模板先加接力字段）。跨天非幂等随接力识别一并解决（关系判定替代日历圈定）。

**测试**：用法错误 exit 2；JSON 格式漂移不静默放行；声明接力的两文档重叠 → 告警非阻断。

#### U5 附注 — pre-commit 跑两遍（效率）

synova-commit 路径 13 组跑两遍（:549 + git commit 触发 hook）。方案：synova-commit 的 `git commit` 加 `--no-verify`（因为 :549 已跑过且记录），**但**这会让 post-commit 检测不到 marker——需配合：synova-commit 自己写 marker（install-hooks.sh:51 逻辑上移），或 git commit 时不加 --no-verify 但给 pre-commit-check.sh 加"60s 内已跑过则秒退"缓存。**建议后者**（不破坏 bypass 检测）：pre-commit-check.sh 开头检查 `last-precommit-success` 的 timestamp，<60s 且 HEAD 未变 → 直接 exit 0（幂等短路）。收益：每次 commit 省 ~50s。

---

### U6 — Mac DSH 写时约束（goal 门禁化）

#### 背景与问题

Mac DSH 无 PreToolUse/PostToolUse hook（persona-block.yml:105 自述），流程纪律靠 persona 自律 → M2/M4/M7 过程产物漏（D391/D393 FAIL 的全部根因）。Claude Code 有写前/写后钩子物理强制，DSH 没有——这是两边唯一的约束不对称。

#### 定位

DSH 平台没有 PreToolUse hook，无法用 Claude Code 同款机制。但 DSH 有 `goal` 机制和可执行 bash。方案：把 8 步 SOP 的**每步物理证据**做成一个校验脚本，persona 规则要求"每步必须先过校验才进下一步"。这是把"请自觉"升级为"机器卡点"。

#### 契约

```bash
# scripts/workflow/sop-gate.sh（新）
# 契约:
#   @input  — --step <2|5|7> [--brief <name>]（对应 SOP 步骤）
#   @output — 该步骤物理证据校验报告
#   @exit   — 0 = 该步证据齐全可进下一步；1 = 证据缺失（阻断，并给补救命令）；
#             2 = 校验执行失败/降级
#   @degraded — exit 2 + stderr 原因
```

各步骤物理校验：
- `--step 2`（brief 完成）：`test -f .claude/task-briefs/<brief>` 且 6 核心字段（Q0/Q1/Q2/Q3/架构层/Done）非空（复用 brief_parser.py）。
- `--step 5`（verify 完成）：`verify-incremental.sh` 最近执行 exit 0（读其状态文件）+ 无未修复 tsc/vitest 失败。
- `--step 7`（可提交）：bypass.log 无未提交变更（U1a 已保证）+ 交付报告含"声称↔证据"对照表（U4）。

#### 实现方案

- 新建 `sop-gate.sh`，三态退出码，每步校验独立函数。
- **persona 集成**：编码 persona（dsh-preset-draft/persona-block.yml）SOP 步骤②⑤⑦后加"先跑 `bash scripts/workflow/sop-gate.sh --step N`，exit 0 才继续"。这是 persona 规则，但卡点本身是物理脚本——自觉的部分只剩"记得调脚本"，而脚本结果可核（K3 可审计 sop-gate 调用痕迹）。
- **可选硬化**：session 级封装 `synova-sop`（参考 synova-commit），把 SOP 串成状态机，每步自动调 sop-gate，未过不进下一步。

#### 测试方案

| 路径 | 用例 |
|---|---|
| 正常 | 各步证据齐全 → exit 0 |
| 降级 | brief_parser/git 不可用 → exit 2 |
| 边界 | brief 存在但缺 Q3 字段 → exit 1 点名缺哪个字段；未到 step 5 就调 step 7 → exit 1 |
| 接线 | grep `sop-gate` 在 persona-block.yml 中被引用 |

#### 验收（Done）

- [ ] 缺 Q3 字段的 brief 调 `--step 2` → exit 1 点名
- [ ] persona 更新落位（install-dsh-preset.sh --install 后 .dsh 预设含 sop-gate 引用）

#### 风险与回滚

风险：persona 集成仍是"软"的（agent 可能不调脚本）。缓解：sop-gate 结果写入 `.claude/sop-gate.log`（git 跟踪），K3 审计可对账"该任务是否每步都过了 sop-gate"——把软约束变成可审计事实。**文档豁免**：纯文档/纯同步任务（无代码实现）不走 sop-gate 的代码步骤（step 5 verify / step 7 提交前代码检查）——文档同步任务不受编码 SOP 约束（原则 7）。回滚 = 还原 persona。

---

### U7 — 控制塔测试接入门禁（CT-40）

#### 背景与问题

`tests/control-tower/*.test.sh` 不跑在 pre-commit/CI → 控制塔脚本改坏了没有物理拦截（D393 红灯实证：验收测试交付态 6/7 红灯却无门禁拦住）。控制塔是最高风险变更（D328-D335 一半 P0 在这），却恰恰没有自己的测试门禁。

#### 契约

```bash
# 集成进 pre-commit 组 2（测试质量），不新建组
# 契约:
#   @input  — 暂存含 scripts/control-tower/|scripts/workflow/|scripts/hooks/ 下 .sh/.py 变更
#   @output — 对应 tests/control-tower/*.test.sh 执行结果
#   @exit   — 0 = 配对测试全绿；1 = 测试失败/脚本变更无配对测试（业务阻断）；
#             2 = 测试执行失败/降级
#   @degraded — exit 2 + stderr 原因（测试脚本崩溃/环境不可用 → 显式降级，不静默当通过）
```

#### 实现方案

- **U7a 配对规则**：`scripts/control-tower/foo.sh` ↔ `tests/control-tower/foo.test.sh`；`scripts/workflow/check-foo.sh` ↔ `tests/control-tower/check-foo.test.sh` 或 `tests/workflow/`。脚本变更无配对测试 → exit 1（铁律 2 测试配对的控制塔版）。
- **U7b 执行**：配对测试存在则执行，红 → exit 1。条件跳过：无控制塔脚本变更 → <1s soft_pass（模式 3）。
- **U7c CI 兜底**：`.github/workflows/` 加一个 job 跑全部 `tests/control-tower/*.test.sh`（防 pre-commit 被绕过时的最后防线）。注意控制塔测试多为 bash，CI runner 需 bash 环境（ubuntu 自带）。
- **性能**：控制塔测试是 bash 起子进程，可能慢。只跑"变更脚本配对的测试"，非全量；全量留给 CI。

#### 测试方案

| 路径 | 用例 |
|---|---|
| 正常 | 改 control-tower 脚本 + 配对测试绿 → exit 0 |
| 降级 | 测试脚本自身崩溃 → exit 2 |
| 边界 | 改 control-tower 脚本无配对测试 → exit 1；配对测试红 → exit 1；无控制塔变更 → 跳过 <1s |
| 接线 | grep 配对逻辑在 pre-commit-check.sh 组 2 中 |

#### 验收（Done）

- [ ] 故意改坏一个 control-tower 脚本 → commit 被组 2 阻断
- [ ] CI 控制塔测试 job 绿

#### 风险与回滚

风险：控制塔测试可能本身有假失败（D381 修过 test-dev-doc-gatekeeper.py 假失败）。缓解：先修既有测试再入门禁；入门禁前全量跑一遍确认基线绿。回滚 = 摘掉组 2 的控制塔分支。

---

## 第四部分：第三阶段升级项（审计流程，需创始人 + K3 确认）

> ⚠️ **红线声明**：本部分只提"工程侧的机器预审与流程框架"，**不编写、不修改任何审计判定标准**（`scripts/audit/` 与审计口径归 K3 专属）。落地前需创始人拍板 + K3 确认。

### U8 — 三层审计模型 + 风险分级

#### 背景与问题

K3 成本高的根因：把机器 1 秒能查的物理项（接口存在性/路径存在/架构边界/接线/测试覆盖/证据对账/版本编排）交给零上下文的语义大脑逐份重新验证。15 项里约 7 项机器可查。且同类问题复发（M4×4、产物不可复现×3、M7 多次）说明审计发现了但没固化成防线 → 反复付费审同一问题。

#### 三层模型

```
第 0 层  机器预审（pre-commit / CI）     = U1+U2+U3+U4+U7 落地的门禁
         物理项全前置，查不过到不了 K3。成本≈0，每次提交都跑。
第 1 层  交付方自证（U4 声称↔证据对照表）  把 K3 从侦探变法官，只抽验。
第 2 层  K3 语义终审                     只审机器查不了的：
         T3 故障注入设计 / 声称-事实语义对账 / 形似神不似 / north-star 对齐 / dev doc 语义漂移
```

#### 风险分级（建议表，采纳权在创始人 + K3）

| 任务类型 | 例子 | 建议审计方式 |
|---|---|---|
| 纯文档 | memory 归档、台账、报告 | 免 K3 全量（机器预审即可；与 CT-34 豁免口径一致） |
| 低风险代码 | 加测试、只读 dashboard | 机器预审 + K3 抽查（如每 3 抽 1） |
| 高风险代码 | 改门禁/架构/数据流/schema/本体契约 | 机器预审 + K3 全量（K3 真正该花的时间） |
| spec 关卡 | 新方案 | 轻审（写集承载、现状 grep 等机器项前置） |

**落地机制（工程侧）**：任务在 `task-state/<D#>.json` 加 `risk: low|medium|high` 字段（派活时由 CTO/创始人标）；K3 开工前先跑一个"机器预审汇总脚本"（聚合 U1-U4/U7 结果 + 基线 + 测试），输出"预审是否已过"——没过直接打回，不浪费语义大脑。

#### 不做的事（边界）

- 不改 K3 的 15 项判定口径、不改 AUDIT-PROTOCOL、不碰 scripts/audit/。
- 不取消 K3 对高风险任务的全量审计权。
- "抽查"不代表低风险任务零审计——抽查比例与触发升级条件由 K3/创始人定。

#### 验收（Done）

- [ ] 创始人确认风险分级表
- [ ] K3 确认"机器预审前置"不打断其协议
- [ ] 一个低风险任务走完"机器预审 + 抽查"流程，对比全量审的成本

---

## 第五部分：附录

### 5.1 风险总表（按等级）

| 升级项 | 风险 | 等级 | 缓解 |
|---|---|---|---|
| U4 自证表 | 执行交付方命令的注入面 | **高** | 严格白名单 + 禁 shell 元字符 + 超时；或第一版只查格式不预跑 |
| U5a CT-29 | 祖先对账放宽真绕过检测 | 中 | 保留 freshness 校验兜底；二次确认再熔断 |
| U2 写集对账 | 误伤合理临时文件 | 中 | 文档豁免 + rename 容错 + 清晰点名 |
| U6 写时约束 | persona 仍是软约束 | 中 | sop-gate.log 入 git，K3 可对账 |
| U1/U3/U7 | 低 | 低 | 只读对账 / 报告工具 / 测试配对 |

### 5.2 回滚总表

所有升级项都可独立回滚（还原对应脚本/hook/组），互不影响。无 schema 变更、无数据迁移、不碰审计脚本。

### 5.3 建议落地顺序

1. **U1 + U3 + U7**（低风险，先落地立刻止血 M4/产物复现/控制塔无测试门禁）
2. **U2**（中风险，双向对账需观察误伤）
3. **U5**（降误伤，含 pre-commit 跑两遍的效率优化）
4. **U4**（高风险，先出格式版，预跑版单独评审）
5. **U6**（Mac 约束，persona + sop-gate）
6. **U8**（审计流程，待创始人 + K3 决策）

### 5.4 需创始人拍板的决策（承上游评估文档第八节）

- D1 K3 审计是否卡合并（高风险任务合并前需 PASS/CP）
- D2 审计成本策略（机器预审 + 风险分级 vs 每任务全量）
- D3 Mac 是否补写时约束（U6）
- D4 先做哪个（建议 U1+U3+U7 先行）

### 5.5 证据索引（全部可复核）

- pre-commit 集成范式（三态/组结构/HARD_FAIL 汇总）：`scripts/pre-commit-check.sh:48-51,53-62,1009-1021,1043-1055`；`STAGED_ALL` 定义 :156
- bypass 机制：`scripts/control-tower/synova-commit:476,601,633`；`scripts/control-tower/check-bypass-log.sh:40-54`；`scripts/hooks/post-commit.sh:21-57`；`scripts/install-hooks.sh:45-53`；`scripts/workflow/loop-context.sh:88`（误报源）；`scripts/pre-push-check.sh:71`（虚假声称）
- 写集对账：`scripts/workflow/check-dev-doc-write-set.sh:54-83,116-122`；`pre-commit-check.sh:993-1001`（G12c）；`dev-doc-gatekeeper.sh:182-216`（C6）
- 产物复现：`scripts/control-tower/gen-cto-health.py:186,225-228`
- CT-30/CT-28：`scripts/check-secrets.sh:53-56,102-108,157-171`；`scripts/control-tower/verify-parallel.sh:90,135-147,187-194`
- 问题实证：`docs/synova/coordination/审计发现台账-DSH-CTO.md`（M1-M8、CT-17/28/29/30/40）；`docs/synova/audit-reports/2026-08-17-D394.md`、`2026-08-17-D395a.md`

---

*本 spec 为施工蓝本。每个升级项实施前应走标准流程：task-start 取号（alloc-task-id.sh）→ task brief → 契约先行 → 测试先行 → 实现 → 接线 → K3 审计（高风险项）。改门禁 = 无豁免，全部待 K3 审计。*


