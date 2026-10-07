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
**走 stderr** —— 因为 `_occupy_locations` 的 **stdout 是冲突行契约**（非空即「已占」），
来源说明若上 stdout 会被读成"该位置已占用"（契约污染）。此不变量已写进代码注释 + 夹具断言。

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
