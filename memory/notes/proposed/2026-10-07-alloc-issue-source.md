# alloc-task-id 占用判定补「issue 标题」来源（过渡件）

- 状态: proposed（执行中）· 编号 **D1219** · 来源：Lead 立卡（过渡专用）
- 🔴 **过渡件声明**：**本来源为过渡件 —— `D# 退役时同批删除此来源`。**
  （Lead 裁决③要求此句同时落在 **卡面 / 代码注释 / PR 正文** 三处；并会进「自繁殖对冲」月度盘点复核是否已删。）

## 问题（本日第 5 次 D# 代价）

`alloc-task-id.sh` 的占用判定原有 **5 源**（`task-state` / `origin-main` / `remote-branch` /
`local-branch` / `worktree-name`），**看不见 issue 卡的标题**。
后果实证：`check-name-allocation.sh --id D1208` 判「**可用**」，而 **issue #1268 的标题已带 `D1208`**
⇒ 号被 issue 卡占用却不可判 ⇒ 我据此撞了本日第 4 次号。

## 决策

### 1. 实现点 = `alloc-task-id.sh` 的 `_occupy_locations()`（**不是** `check-name-allocation.sh`）
`check-name-allocation.sh:113` **明文委派** `alloc-task-id.sh --check-id`（注释：单一实现，杜绝第二副本漂移）。
⇒ 照卡面去改前者**等于造第二副本**。Lead 已批写集更正。
（**这是 Lead 派单写集写错路径的第 4 次（D732 类）** —— 教训：派单写集必须 grep 实现点，不凭卡面。）

### 2. 降级语义 = fail-open + 显式告警（**有意区别于既有 REMOTE_BRANCH_REFS**）
既有范式（`REMOTE_BRANCH_REFS`）：**超时 ⇒ fail-closed(2) / 不可达 ⇒ degraded 继续**（D1091）。
本源的取舍：**发号器是全队关键路径**，网络抖动导致全队发不出号，代价 > 偶发漏检一个占用
⇒ 不可达/超时/无 gh 一律 **fail-open + stderr 显式 degraded**（铁律 11，禁静默）。
**这个不一致是刻意且被裁决的**（Lead 裁决②），非遗漏。

三条齐（Lead 要求）：
1. stderr 显式 `degraded: issue 标题源不可达（…）`；
2. 结论措辞只报**「可判定范围内未见占用」**，**不得**报「未占用」；
3. 注入缝 `SYNO_ALLOC_NO_ISSUES=1`（**hermetic 必需** —— 两个相关测试都在 CI 密封清单里，
   不得打真网络）+ `SYNO_ALLOC_ISSUES_FILE=<path>`（测试注入快照内容，生产不设）。

### 3. 来源可追溯（Lead 额外要求）
同一命令在**有无网络**下结论可能不同 ⇒ `--check-id` 必留痕迹：
```
占用判定来源: 本地 task-state / origin-main / remote-branch / local-branch / worktree-name
              + issue-title(含=yes 状态=ok，过渡件：D# 退役时同批删除此来源)
```
**走 stderr** —— 援引 **stdout 接口契约**：`_occupy_locations` / `--check-id` 的
`@exit 1=已占（逐行输出冲突位置）` ⇒ stdout 只承载冲突行，来源说明/诊断一律 stderr。
> **P3 更正（返工 #1283）**：原文「上 stdout 会被读成"该位置已占用"」**理由不成立** ——
> verifier 核实唯一消费者 `check-name-allocation.sh` **按 rc 分支**、rc=0 时丢弃 stdout。
> **取舍仍对**，但依据应归**接口契约**，而非"消费端会误读"。

### 4. 只认 title 字段，不认 number 字段
快照行 = `<number><TAB><title>`，匹配面**只取 title**（与 ③④⑤ 同款词界正则
`(^|[^0-9a-z])d<num>([^0-9]|$)`）⇒ 不吃 `"number":1208` 这类数字字段的假命中。

### 5. 本仓语境门槛
与 ②④⑤ 同款：`TS_TOP` 为空（测试沙箱/非常规布局）⇒ 该源**跳过**，
避免沙箱测试去查**真仓**的 issue（hermetic 红线）。

## 踩坑留痕（平台纪律）

实现时按 skill `ctrl-tower-change` 模式 2 实测踩中**全角标点吞变量名**：
```bash
echo "…含=$_ISS_INCL 状态=$ISSUE_SRC_STATE，过渡件…"   # ❌ bash 把「，」并入变量名
# → alloc-task-id.sh: ISSUE_SRC_STATE�: unbound variable
echo "…含=${_ISS_INCL} 状态=${ISSUE_SRC_STATE}，过渡件…"  # ✅ 花括号显式边界
```
并做了全文件体检：未加花括号且紧跟全角标点的 `$VAR` 命中 = **0 处**。

## 判据（可复跑）

```bash
bash tests/control-tower/alloc-task-id.test.sh          # 67 项（原 56——新增 §13 十条）
bash tests/control-tower/check-name-allocation.test.sh  # 21 项（委派侧零回归）
# 三态语义（隔离 ②③④⑤ + 空 task-state）:
SYNO_ALLOC_ISSUES_FILE=<含 D9991 的快照> … --check-id D9991   # rc=1 + stdout 点名 issue-title
SYNO_ALLOC_ISSUES_FILE=<不含>            … --check-id D9992   # rc=0 + stderr 含=yes
SYNO_ALLOC_NO_ISSUES=1                   … --check-id D9992   # rc=0 + stderr 含=no（离线）
```
**判别性（改坏即红）**：把第 6 源停用（`if … && false`）⇒ 测试 **rc=1**（§13 断言转红）。

## 编号留痕

本卡初拟 **D1218** ⇒ `check-name-allocation.sh` 判占用（在途分支 `feat/D1218-gen-cto-health-degrade`）
⇒ 取 **D1219**（三重核验：gate 可用 / main 零文件 / issue 标题零命中）。
**讽刺且自证**：正是本卡补的这类"多来源占用面"在当天第 5 次拦住了我。

## 相关

- 卡 #1224 / #1222（D-C 标识归一，D# 退役主线）· D1213（D# 身份提取器「散文盲」，另一面）
- 本日 D# 撞号 5 次代价：互合冲突 / 与 main 撞号 / 污染 D708 写集对账 / 多命中 fail-closed / 本卡来源缺失


---

# 返工记录（PR #1281 合并后 verifier 事后审计 → 返工卡 #1283）

## R1（P2）hermetic 不成立 —— 实测 15 次真网络调用

**verifier 数据 + 我复现（gh shim 插桩）**：
```
check-name-allocation.test.sh → 10 次真实 gh issue list
alloc-task-id.test.sh         →  5 次真实 gh issue list
合计 15 次  （与 verifier 数字逐字一致）
```
**根因（比"只有一处守卫"更深）**：两个测试的沙箱**各自 `git init`** ⇒
`TS_TOP` 非空 ⇒ 我加的 `TS_TOP` 门槛**不跳过**；而 `gh` 按 **PWD** 解析仓库
⇒ 沙箱 task-state 也会去查 **PWD 所在真仓**的 issue（跨仓污染 + 网络）。
⇒ **修法两层**：
1. **逐调用点加守卫** `SYNO_ALLOC_NO_ISSUES=1`（`alloc-task-id.test.sh` 19 处 + 委派侧 `chk()` 1 处）；
2. **工具侧**：gh 调用改为在 **`$TS_TOP`** 内取数（`sh -c 'cd "$1" && shift && exec gh "$@"'`），
   对齐既有原则「占用表全源跟随 task-state 所属仓库，不得混入 CWD 所在仓」。
**修后实测**：两套件真实调用 = **0**；生产路径（真 gh）仍 `含=yes 状态=ok` ✓。

### 🔴 反直觉点（Lead 要求做成断言）

**全局 export `SYNO_ALLOC_NO_ISSUES=1` 会破坏「源 active」场景** —— 因为优先级
`NO_ISSUES(1) > ISSUES_FILE(2)`：全局关源会把 §13 (a)(b) 依赖的"注入命中"场景一并关掉
⇒ **把判据放宽了**（正是要防的形态）。⇒ 必须**逐调用点**守卫。
**已钉成断言（§13(g)，三条）**：① 同命令加全局守卫 ⇒ rc 由 1→0（源被关）
② 全局守卫下**不可能**命中 issue-title ③ 对照：去掉守卫 ⇒ 源恢复 active（rc=1 + 点名）。
**判别性**：把优先级翻转（FILE>NO）⇒ 测试 rc=1（已实证）。

### 何时**不该**加守卫（同样重要）

§13(e)（源 active 但**不可达**）**刻意不加** `NO_ISSUES` —— 加了就变成"源 disabled"，
测的是另一条分支。修 R1 时我的批量加守卫脚本**误伤**了这一处（其 `ISSUES_FILE` 在续行上、
`bash "$TOOL"` 单行看不到 seam）⇒ 夹具立刻转红并点名，**这正是夹具承重**的体现。

## R2（P2）故障路径本身崩 —— `$VAR（` 全角吞变量名

`:523/:531/:545/:555` 四处 `$EXIT（期望 1）` ⇒ bash 3.2 + `set -u` 下 `EXIT?: unbound variable`
⇒ **真实失败信息被掩盖**（任一 fail 分支都中招）。已修 `${EXIT}（`。
**同类第 2 次**（上一次在 `alloc-task-id.sh` 的 `$_ISS_INCL 状态=$ISSUE_SRC_STATE，`）。

**全目录扫描（Lead 要求）** —— 非注释代码行命中 + `set -u` 判定：
```
set -u 命中（🔴 会真崩）: 17 个文件 / 我的写集只占 1 个（alloc-task-id.test.sh，已修 4 处）
  check-citations(5) · check-gate-integrity(1) · check-ownership(1) · check-pr-budget(1)
  check-preset-bundles(2) · ci-signal-classify(1) · daily-cto-board(2) · external-auditor(2)
  g12-day-window(1) · incident-loop-hygiene(2) · parallel-main-tree-occupancy(3) · post-commit(3)
  redeem-task-redeem(1) · session-worktree-isolation(3) · staging_guard(1) · synova-commit(1)
无 set -u（🟡 静默吞值）: tests/doc-system/doc-contract-property.test.sh(1)
```
**其余 16 个文件不在本卡写集** ⇒ 按纪律**只报不改**，已上报 Lead 处置（建议另卡：同类系统性清理）。
复跑命令：
```bash
grep -rEn '\$[A-Za-z_][A-Za-z0-9_]*[（），。：；！？、]' tests/ | grep -v ':\s*#'
```

## P3（P3）理由不成立，取舍仍对

见上文「来源可追溯」段的更正：援引 **stdout 接口契约**（`--check-id` 的 `@exit 1=逐行输出冲突位置`），
不再用"消费端会误读 stdout"这一被 verifier 证伪的理由。
