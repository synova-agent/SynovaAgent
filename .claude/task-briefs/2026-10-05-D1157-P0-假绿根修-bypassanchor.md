# Task Brief: D1157 P0 假绿根修 — bypass 对账「记录判定」锚到 COMMITTED 记录行的 HASH= 字段

> 生成: 2026-10-05 | 任务: **D1157**（`alloc-task-id.sh --check-id D1157` 实测只被本卡分支占用，见 §号源核验）
> 认领: 治理线（worktree `.synova-wt-govl-1157`，分支 `fix/D1157-bypass-hash-anchor`）
> 上游: K3 审计报告 `2026-10-05-k3-审计报告-门禁治理波次-D1145-D1149.md` §二 提案 1（裁决：**批准（P0 级修复）**）
>      + §三 防线缺口收割第 1 行 + CTO 卡（插队批准，附四条硬约束）
> **本件性质 = 判据变更送审件**：走「提案 → K3 → CTO 裁」，**本分支不得自行合并**；夹具与实现随本件送审。
> 参考: D333 决策四步（第一性原理 → Anthropic 基线 → 开源实证 → 收敛检查）

#CRITERIA: A

## 【坐标系】（7 字段，照 `docs/synova/CTO-ROLE.md` §7.3）
- 执行态: 待裁（提案；实现已在分支、未合并）
- 施工批次: 0 修坏点（总闸类：执行证据链门禁自身可被绕过）
- 服务承重件: 否（护城河 6 承重件不含；属控制塔门禁基础件）
- 总闸: #973 修坏点族（不属 0-1/0-2 两个 cron 总闸）
- 命名空间: scripts/control-tower/check-bypass-log.sh（判据面）+ tests/control-tower/（夹具面）
- 验证级别: L2（夹具红绿二分 + 真实语料普查 + 全套既有回归）
- 阻塞源: K3 过审 → CTO 裁（判据变更不得自裁）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = AI 诊断 Agent。本任务位于**治理层（控制塔门禁）**，非产品五层。
病灶（P0 假绿，K3 已物理复现、CTO 亲手验过）：`check-bypass-log.sh` 对账时用
`grep -q "$h" $LEDGER_SOURCES`（**无锚**）判断"该提交在账本里有记录" ⇒ 该 sha 出现在账本**任何位置**
都算有记录。典型冒充源 = 绕过检测行 `detected-bypass head-mismatch marker=<sha> parent=<sha>`：
一个**从无自身记录**的提交，只要账本里有一行提到它（哪怕只是把它当 parent 写下来），门禁即 exit 0。
⇒ **执行证据链门禁可被绕过检测行自身洗白**：连续两次 `--no-verify` 互相洗白的链因此闭合（K3 §二判词）。

### b) 文件审计
- `scripts/control-tower/check-bypass-log.sh`（215 行，本卡改 **1 处判据 + 1 段注释**）—— 存在 → 改。
  L173（`origin/main` 版）`if ! grep -q "$h" $LEDGER_SOURCES 2>/dev/null; then` ⇒ 改为按记录行字段判定。
- `tests/control-tower/check-bypass-log.test.sh`（292 行）—— 存在 → 追加 D1157 夹具 ①–⑥（原 22 条全保留）。
- `tests/control-tower/check-bypass-log.beforeafter.sh` —— **新建**：改坏即红证据生成器（同一夹具喂任意版本门禁）。
- 新建：`.claude/task-briefs/2026-10-05-D1157-P0-假绿根修-bypassanchor.md`（本件）。
- 新建：`memory/notes/proposed/2026-10-05-d1157-bypass-hash-anchor.md`（铁律 49 决策 Note）。
- **不动**：`scripts/pre-commit-check.sh`、`ci.yml`、`scripts/audit/**`（K3 域）、D1152 语义相关任何分支。

### c) 决策
- **已有覆盖 → 复用**：三态退出码（0/1/2）与两条 fail-closed 路径**原样保留**；不新造机制、不动调用方。
- **无覆盖 → 新建**：只新建"记录判定"这一处谓词 + 其夹具；不改 job 结构、不改必需 context。
- **冲突 → 上报不自裁**：这是**门禁语义变更** ⇒ 出提案送 K3、CTO 裁；本分支不合并（红线：不得自裁）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **第一性原理**：证据链门禁的唯一职责 = 回答「产生这个提交的那台机器，是否真的跑过闸」。
  记账单位是**提交**，所以判据必须锚在**记录该提交的那条记录**上，而不是"这个字符串在文件里出现过"。
  两条推论：① `marker=` / `parent=` 是**关于别人的字段**，天然不构成记录（本卡修的就是这条）；
  ② 记录值可以是**短 sha**（人写的补记行），所以判定必须是"记录值是提交 sha 的前缀"，不是精确等值。
- **Anthropic 基线**：改门禁判据必须配**判别性夹具**——改坏必红、过紧也必红（两头锁死）；
  读不到判据源 ⇒ fail-closed 且不静默（铁律 11/24）；三态 0/1/2 不许混同（`ctrl-tower-change` 模式 1）。
- **开源实证**：`grep -q "$sha"` 型的"存在性判定"在门禁里是经典缺陷类（Cf. lint 门禁的
  "diff 里出现字符串 = 已修"反模式）。本仓同族先例可直接举出三条（见下）。
- **本仓实证（真实语料普查，见提案 §二）**：140 份账本 / 118,077 行 / 2,501 条 distinct 行里，
  **76 个 OID 只出现在 `detected-bypass … marker=/parent=` 行里、没有任何自身记录**
  ⇒ 旧判据对这 76 个 OID 全部判绿 = 假绿面实测大小（不是理论推演）。
- **memory / 本波次教训**：K3 §三「本该拦住的防线 = check-bypass-log 夹具，为何没拦住 = 只测
  『有 COMMITTED 过 / 无记录拦』，没测『错误类型的行不得冒充』」——本卡补的正是这一格。
  同族历史：D414/U1c（`|| true` 把 git 失败当通过 = M1 假 PASS）、D1145（来源全空 fail-closed）、
  D1152（跨机证据链；**本卡不许放宽它的三条语义**）。
- 参考系：`ctrl-tower-change`（门禁变更模式库）+ `claim-verifier`（声称↔物理证明）+ `squad-discipline`。

## Q2: 范围 — 正确的最简方案

做什么：
- `scripts/control-tower/check-bypass-log.sh`：L173 判据改为「记录行（时间戳开头 + `COMMITTED` 字段）
  的 `HASH=<hex 7–40>` 值 = 该提交 sha 的前缀」；同步改写头部 D1157 段与判据段注释（含普查数字与
  为何不用 `^$h` / 为何不用 K3 字面式的理由）。
- `tests/control-tower/check-bypass-log.test.sh`：追加 D1157 夹具 ①–⑥（见提案 §三），原 22 条断言不动。
- `tests/control-tower/check-bypass-log.beforeafter.sh`：新建改坏即红证据生成器（`--paths` 可指向任意版本门禁）。
- `scripts/hooks/post-commit.sh`：**写入侧同源修正**（CTO 第 2 版裁决并入本批）—— `_ledger_has_hash()` 幂等判据
  由无锚 `grep -q "$h"` 改为与读取侧**逐字同源**的锚定判据（`D1157-REC-RE-BEGIN/END` 块）；
  **写入格式（记录行本体）不动**，只动「是否已登记」的判定 ⇒ 消掉「写侧认为已记 / 读侧认为未记」的不对称。
- `tests/control-tower/post-commit.test.sh`：追加 F1–F4 夹具（同源断言 / 改坏即红独立红例 / H2 绿对照 / 两条负对照）。
- `.claude/task-briefs/2026-10-05-D1157-P0-假绿根修-bypassanchor.md`：本件（提案 + 普查 + 两段原始输出 + 回滚）。
- `memory/notes/proposed/2026-10-05-d1157-bypass-hash-anchor.md`：铁律 49 决策 Note。

不做什么（含文件路径）：
- 不改 `scripts/pre-commit-check.sh`（本地软提示层与 job 结构不动）。
- 不改 `.github/workflows/ci.yml`（**红线：12 必需 context 的唯一产出者**）。
- 不改 `scripts/control-tower/check-required-contexts.py`（属任务 B，另件）。
- 不改 `scripts/control-tower/bypass-ledger.sh`（来源合并逻辑不动；本卡只动"读出来怎么判"）。
- 不改 `scripts/hooks/post-commit.sh` 的**写入格式**（记录行格式 = 判据的前提，本卡不动它）；
  只改其幂等判据 `_ledger_has_hash()`（CTO 第 2 版裁决明令并入 ⇒ 见「做什么」第 4 条）。
- 不动 `scripts/audit/**`（K3 域，红线）。
- 不放宽 D1152 三条语义（fresh clone exit 0 / 本机待推 exit 1 / 首推 ref 缺失不免检）——见提案 §五。
- 不自行合并、不开 auto-merge（判据变更必须 K3 → CTO）。

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：`bash tests/control-tower/check-bypass-log.test.sh`（回归全量）、
`bash tests/control-tower/check-bypass-log.beforeafter.sh <gate>`（改坏即红两段证据）。
处理（中间步骤）：沙箱 repo 造"只有 `parent=<sha>`、无该提交自身记录"的账本 ⇒ 旧版门禁 exit 0（假绿）、
新版 exit 1（拦住）；再跑 ⑥ 负对照证明未过紧。
结果（最终展示）：`VERDICT=fake-green`（改前）/ `VERDICT=blocked`（改后）+ 28/28 断言通过（原始输出见提案 §三）。

## 架构层: 治理层（控制塔门禁脚本 `scripts/control-tower/**`；非产品 L1–L5 五层）

## Done 标准:
- [ ] `bash tests/control-tower/check-bypass-log.test.sh` → `结果: 28 通过, 0 失败`（含原 22 条不回归）
- [ ] 同一夹具喂 origin/main 版门禁 → `GATE_EXIT=0 / VERDICT=fake-green`（改前假绿成立）
- [ ] 同一夹具喂本分支版门禁 → `GATE_EXIT=1 / VERDICT=blocked`（改后已堵）
- [ ] D1152 三条语义未放宽（fresh clone 0 / 本机待推 1 / 首推 ref 缺失 1，均为既有断言实跑通过）
- [ ] 三态退出码保持 0/1/2（既有降级断言：缺 base 无 origin → exit 2 实跑通过）
- [ ] `bash tests/control-tower/post-commit.test.sh` → `结果: 33 通过, 0 失败`（含 F1–F4）
- [ ] **F2 独立红例**：`origin/main` 版 hook（`git show` 取，遵 H1）+ 账本只有 `parent=<sha>` ⇒ **不补记**（漏记成立）
- [ ] **F-fixed 绿对照（H2）**：同夹具 + 本支实现 ⇒ **必须补记**（红来自断言，非崩溃）
- [ ] **F1 同源断言**：写入侧/读取侧 `_REC_RE` 逐字一致（漂移即红）
- [ ] 真实语料普查数字可复跑（提案 §二命令逐条给出）
- [ ] 送 K3 过审 + CTO 裁之前**不合并**

---

# 提案正文（送 K3 过审 → CTO 裁）

## 一、判据变更（一行）

```diff
- if ! grep -q "$h" $LEDGER_SOURCES 2>/dev/null; then          # 该 sha 在账本任意位置出现即算有记录
+ _REC_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+[^ |]*[[:space:]]*\|?[[:space:]]*COMMITTED'
+ _RECORDED_HASHES="$(grep -hE "$_REC_RE" $LEDGER_SOURCES | grep -oE 'HASH=[0-9a-fA-F]{7,40}' \
+                      | sed 's/^HASH=//' | tr 'A-F' 'a-f' | sort -u)"
+ # 判定 = 记录行的 HASH= 值是该提交 sha 的**前缀**
+ if ! _recorded "$h"; then
```

语义一句话：**只认「COMMITTED 记录行」的「`HASH=` 字段值」，且该值必须是本提交 sha 的前缀**。

## 二、格式普查（**定锚依据**；CTO 硬约束 ②：先读真实行格式再定锚）

命令（可复跑，产品仓任意 worktree 内）：

```bash
cd /Users/wane/SynovaAgent
LEDGERS=$(find . -name 'bypass.log' -type f -not -path './node_modules/*')
cat $LEDGERS | wc -l                                   # 118077 行 / 140 份账本
cat $LEDGERS | sort -u | wc -l                         # 2501 条 distinct
REC_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+[^ |]*[[:space:]]*\|?[[:space:]]*COMMITTED'
cat $LEDGERS | sort -u | grep -c 'COMMITTED'           # 含 COMMITTED 子串: 2003
cat $LEDGERS | sort -u | grep -cE "$REC_RE"            # 记录行（时间戳开头）: 2002
cat $LEDGERS | sort -u | grep 'COMMITTED' | grep -vE "$REC_RE"   # 差集: 1 条 = LEDGER-RETRACT 散文行
cat $LEDGERS | sort -u | grep -E "$REC_RE" | grep -oE 'HASH=[0-9a-fA-F]{7,40}' | sed 's/HASH=//' | awk '{print length($0)}' | sort -n | uniq -c
```

实测结果：

| 事实 | 数字 | 对锚定的意义 |
|---|---|---|
| 账本语料 | 140 份 / 118,077 行 / 2,501 distinct | 普查不是抽样 |
| 含 `COMMITTED` 子串的 distinct 行 | 2,003 | — |
| 其中**以 ISO 时间戳开头**的记录行 | **2,002** | ⇒ 行首锚（时间戳）不丢任何真记录 |
| 唯一例外 | `LEDGER-RETRACT` 散文行（提了"COMMITTED 记录"字样） | ⇒ 只按子串抽会把**散文行**当真记录；锚行首正好排除它 |
| 非记录行含 `HASH=` 字段的行 | **0** | ⇒ `HASH=` 字段本身就是强区分器 |
| `HASH=` 值长度分布 | 8 位 ×10 / 40 位 ×1992 / 44 位 ×1 | ⇒ ① 短 sha 必须认（否则新假红）；② 44 位是过捕，必须设上界 |
| 记录行分隔符 | ` | ` 规范（`post-commit.sh:117` 唯一写入器）+ 空格变体 ×1 | ⇒ 两种都认 |
| `^$h`（行首=该 sha）可行性 | **0** 命中 | ⇒ 该锚永不命中（行首是时间戳，sha 在行尾字段），CTO 提醒成立 |

**"fake green 面"实测**（同一语料，可复跑）：

```bash
cat $LEDGERS | sort -u | grep -vE "$REC_RE" | grep -oE '[0-9a-f]{8,40}' | tr 'A-F' 'a-f' | sort -u   # 82 个 token
cat $LEDGERS | sort -u | grep 'detected-bypass' | grep -oE '(marker|parent)=[0-9a-f]+' | sed -E 's/^(marker|parent)=//' | sort -u | wc -l   # 76
```

⇒ **76 个 OID 只出现在 `detected-bypass … marker=/parent=` 行、无任何自身记录**：
旧判据对这 76 个全部判绿（假绿面实测大小），新判据全部判红（正确面）。

## 三、改坏即红夹具 + 修复前后两段原始输出（CTO 硬约束 ①③）

夹具（`tests/control-tower/check-bypass-log.beforeafter.sh`，自包含沙箱；账本**只有** `parent=<sha>`）：

```
账本内容: 2026-10-05T00:00:00Z detected-bypass head-mismatch marker=0000000000000000000000000000000000000000 parent=<该提交>
待记录提交: <sha8>（远端 ref origin/feat/p0 不存在 ⇒ D1152 过滤关闭 ⇒ 必进待记录集）
```

**修复前**（`git show origin/main:scripts/control-tower/check-bypass-log.sh`，origin/main = `707dd946b`）：

```
$ bash tests/control-tower/check-bypass-log.beforeafter.sh /tmp/d1157-prefix/check-bypass-log.sh
────────────────────────────────────────────────────────────────────
⚠️  origin/<当前分支> 不可解析（分支=feat/p0）—— 跳过「他机已过闸」优化，range 内全部提交按待记录要求（fail-closed）
✅ bypass.log 对账通过: 1 条本机待推提交全部有记录（ebd18129…..HEAD；未启用他机已过闸过滤（ref 不可解析））
────────────────────────────────────────────────────────────────────
GATE_EXIT=0
VERDICT=fake-green  （exit 0 = 无自身记录的提交被放行 ⇒ 假绿成立）
```

**修复后**（本分支）：

```
$ bash tests/control-tower/check-bypass-log.beforeafter.sh
────────────────────────────────────────────────────────────────────
⚠️  origin/<当前分支> 不可解析（分支=feat/p0）—— 跳过「他机已过闸」优化，range 内全部提交按待记录要求（fail-closed）
❌ bypass.log 缺以下提交记录（执行证据链断裂）:
  feat: 待记录提交（无自身记录） [828716d1]
  请确认提交经 synova-commit（含 COMMITTED 记录）或一次性补记后再推送
────────────────────────────────────────────────────────────────────
GATE_EXIT=1
VERDICT=blocked     （exit 1 = 无自身记录的提交被拦 ⇒ 假绿已堵）
```

回归全量（同一命令出两段对照）：

```
$ bash tests/control-tower/check-bypass-log.test.sh
  夹具: 待记录提交 d2576cc5（origin/feat/p0 不存在 ⇒ D1152 过滤关闭 ⇒ 必进待记录集）
  ✅ D1157① 仅 parent=<sha> 出现 ⇒ 不算记录 ⇒ exit 1（P0 假绿已堵）
  ✅ D1157② 仅 marker=<sha> 出现 ⇒ 不算记录 ⇒ exit 1
  ✅ D1157③ 负对照: HASH=<8 位短 sha> 记录 ⇒ 仍算记录 ⇒ exit 0（未过紧）
  ✅ D1157④ 负对照: 无 `|` 空格分隔记录行 ⇒ 仍算记录 ⇒ exit 0
  ✅ D1157⑤ 散文行提及 COMMITTED+HASH= ⇒ 不算记录 ⇒ exit 1（锚行首生效）
  ✅ D1157⑥ 负对照: 两记录挤一行时前一条仍被认 ⇒ exit 0（HASH 长度有界，未过捕）
结果: 28 通过, 0 失败
```

判别性总表（两头锁死）：

| 夹具 | 形状 | 改坏后期望 | 过紧后期望 |
|---|---|---|---|
| ① | `parent=<sha>` | **必红**（当前: 绿 = 假绿回归） | — |
| ② | `marker=<sha>` | **必红** | — |
| ③ | `HASH=<8 位短 sha>` 记录行 | — | **必红**（当前: 绿 = 误拦） |
| ④ | 空格分隔记录行（无 `\|`） | — | **必红**（当前: 绿 = 误拦） |
| ⑤ | 散文行含 `COMMITTED` + `HASH=<sha>` | **必红** | — |
| ⑥ | 两记录挤一行（40 位在前） | — | **必红**（当前: 绿 = 过捕漏认） |

## 四、与 K3 提案字面的偏差（三处，逐条给理由；**请 K3 重点复核**）

K3 §二 提案 1 字面：`改 grep -q "COMMITTED.*HASH=$sha"`。本卡不采用字面式，三处偏差：

1. **不要求精确等值 `HASH=$sha`，改为前缀判定** —— 因普查实测**历史 700 条记录值是 8 位短 sha**
   （distinct 值里 10 条 8 位）。精确等值会让这些提交**永远判红**（新假红，比原缺陷更贵：
   误拦 → `--no-verify` → 假绿面更大，正是 V4.5.1/V3.9 教训的成因而非解药）。
2. **锚行首（ISO 时间戳）+ `COMMITTED` 字段位，而非"含 COMMITTED 子串"** —— 因普查实测存在
   **散文行**（`LEDGER-RETRACT`，提了"COMMITTED 记录"字样 2003−2002=1 条）。若该行日后带上
   `HASH=`（撤销记录时顺手写 OID 是很自然的动作），"含子串"式立刻回归假绿。**夹具⑤正是钉这一格**。
3. **`HASH=` 值长度设上界 40** —— 因普查实测 1 条"两条记录挤同一行"的行，无界抽取会把后随
   时间戳的 `2026` 吃进来（值变成 44 位），于是**该条真记录反而不被认**（新假红）。**夹具⑥钉这一格**。

> 附：本次工作中**本人新写的证据脚本也踩了同族"全角变量边界"坑**（`"$SHA8（"` → bash 3.2.57
> `unbound variable`，即 K3 提案 5 `$DOC_ARG（` 的同族），已改 `${SHA8}`。
> 复跑证据：`bash scripts/control-tower/scan-fullwidth-vars.sh --paths <本卡三个文件>` → `退出码 0（扫描集内零违规）`。
> 记此以备同族扫描器覆盖率评估，**本卡不修扫描器**（越域）。

## 五、D1152 语义不变（CTO 硬约束 ④）

本卡只替换「记录判定」谓词，**不碰**待记录集合的构造与两条 fail-closed 路径。既有断言实跑通过：

| D1152 语义 | 断言（`check-bypass-log.test.sh`） | 实跑 |
|---|---|---|
| fresh clone exit 0 | 用例①「来源全空 + 无待记录提交 → exit 0」 | ✅ 通过 |
| 本机待推提交 exit 1 | 用例③④「无记录 → exit 1 + 点名缺失」 | ✅ 通过 |
| 首推 ref 缺失不免检 | 用例⑤「origin/feat/first-push 不存在 ⇒ 不过滤 ⇒ exit 1」 | ✅ 通过 |
| 缺 base 且无 origin → exit 2 | 降级用例「对账无法执行」 | ✅ 通过（三态未变） |

另外本卡**未**放宽：来源全空仍 exit 1、git log 失败仍 exit 2、显式 base 不可解析仍 exit 1。

## 六、影响面

- **谁会红**：只有"账本里从未有过自身 COMMITTED 记录、却出现在 `marker=`/`parent=`/散文行里"的提交
  （真实语料实测 76 个 OID 面）。这类提交**本来就该补记**——按既有 SOP：`synova-commit` 过闸或一次性补记。
- **谁会由红转绿（修复反向缺陷）**：记录值为短 sha 的 700 条历史记录中被精确等值式误拦者；
  以及挤行场景下被过捕吞掉的那 1 条记录。
- **不影响的**：新提交（走 `synova-commit` ⇒ `post-commit.sh:117` 写全 40 位 `HASH=`）；
  CI/新 clone（`.claude/bypass.log` 不存在属正常态，D1145/D1152 语义未动）；
  调用点数量/形态不变（本脚本的消费方 = pre-push 链 + 三个测试件，均实跑通过）：
  `tests/control-tower/tag-bypass-wiring.test.sh` → **26 通过 / 0 失败**、
  `tests/control-tower/bypass-ledger.test.sh` → **全部通过 22 项**（含"对账器未接 union"接线断言）。
- **性能**：抽取从"逐 pending 提交扫全账本"变成"**一次性**预取 distinct 记录集合，逐条前缀比对"
  （真实语料 distinct 记录 1,984 条；pending 通常 1–5 条）⇒ 不比旧实现慢。

## 七、回滚

- 单一 revert：`git revert <本卡 commit>`（只碰 1 处判据 + 夹具，无 schema/接口面）。
- 回滚后自检：`bash tests/control-tower/check-bypass-log.test.sh` 应回到 22 通过
  （D1157 六条夹具会红 —— 这是**预期的**：那六条描述的正是回滚后回归的缺陷）。
- 无数据面/迁移面 ⇒ 无"回滚不干净"风险；不涉及 branch protection / 必需 context。

## 八、残余风险与未做到（诚实列）

1. **写入器改格式 = 锚失效**：若 `post-commit.sh` 未来不再以 ISO 时间戳开头写记录行，
   本判据会对新记录**误拦**（fail-closed 方向，安全但吵）。缓解：已列明唯一写入器为
   `scripts/hooks/post-commit.sh:117`（grep 证据）⇒ 改格式者必与判据同批改；本卡夹具④覆盖分隔符变体。
2. **未覆盖 Windows 侧实测**（与 K3 审计同局限：本机 macOS bash 3.2.57）。
   跨平台适配已过 `PLATFORM-CHECKLIST` 9 条：无裸 `python3`、无 GNU-only 选项、用 `[[:space:]]`/`{m,n}`
   区间（BSD grep 实测支持，命令见 §二）。
3. **`LEDGER-RETRACT` 撤销语义未纳入**：撤销行只加注不删行 ⇒ 被撤销的 COMMITTED 记录**仍被算作记录**。
   本卡未动（属独立缺陷类，需 CTO 定口径：撤销是否应使记录失效）。已在此点名，避免"以为覆盖了"。
4. **未在 CI 侧新增执行体**：本判据的执行方仍是 pre-push 门禁 + 测试脚本（与改前一致）；
   是否把 `check-bypass-log` 纳入 CI 密封清单属另一议题（本卡不越域改 `ci.yml`）。
5. **同族缺陷（写入侧，本卡未修，需 CTO 定卡片归属）**：`scripts/hooks/post-commit.sh:44`
   `_ledger_has_hash() { … grep -q "$h" $srcs …; }` 用的是**同一条无锚判据**（幂等检查"该 HASH 是否已登记"）。
   影响方向相反：若某 sha 已作为**非记录行的字段**出现在账本里，hook 会误判"已登记"⇒ **跳过写 COMMITTED 行**
   ⇒ 证据链静默缺一条（且修复后与对账器判据**不对称**：写侧认为已记、读侧认为未记 ⇒ 推送时被判红）。
   可达性评估：该 sha 必须是"提交**之前**就已出现在账本里的值"，而 commit sha 由内容+父+时间戳决定，
   实际场景（amend/rebase/cherry-pick 均改 sha）里不可达；76 个实测 OID 全是历史已合并提交。
   ⇒ 定级 **P2 潜在**，本卡**不改它**（改写入侧 = 换锚，属另一件事，且会扩大本卡爆炸半径）。
   建议：CTO 定一张"写入侧判据对齐"小卡（一并与 `_ledger_has_hash` 的 fail-closed 口径复核）。
6. **号源核验**：`bash scripts/control-tower/alloc-task-id.sh --check-id D1157` → 仅命中
   `local-branch fix/D1157-bypass-hash-anchor`（本卡自身分支），未命中 task-state / origin/main /
   remote-branch / worktree 名 ⇒ 该号**只存在于未合并分支上**，无撞号。
   （注：CTO 卡面建议的 `fix/D1154-p0-bypassanchor` **不可用** —— D1154 已被产品线
   `.claude/task-briefs/2026-10-05-D1154-产品线-qa-ask权限上下文接线-#984.md` 占用。）

## 收尾清单（**合并后必须立即开卡** —— CTO 第 2 版裁决明令「不许丢」）

> 理由（CTO 原话）：修 P0 只是让它不再**假绿**；**误写入本身仍会发生** ⇒ 修完 P0，「误写入怎么撤回」就变成真问题。

- [ ] **开卡：`LEDGER-RETRACT` 语义**（撤回记录怎么被对账尊重 + 防「洗白式撤回」）—— 口径已由 CTO 给出，逐条引用：
  1. 撤回**不改历史行**，而是**追加一条 RETRACT 记录**（append-only；账本不接受原地改）。
  2. RETRACT 必须带**四要素**：撤回者 / 时刻 / 被撤 HASH / 原因。
  3. 对账时**被 RETRACT 的 HASH 不计入「有记录」**。
  4. 🔴 **禁令**：RETRACT **不得**用于「我确实绕过了，想洗白」⇒ 判据 = **RETRACT 记录本身必须可被独立复核**
     （撤回原因须指向具体事件）。
- [ ] 现状注记（本卡实测）：账本里已存在 1 条 `LEDGER-RETRACT` 散文行（只加注不删行）⇒ 被撤记录**仍算记录**；
  本卡不动它（属上述卡）。

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| scripts/control-tower/check-bypass-log.sh | task |
| scripts/hooks/post-commit.sh | task |
| tests/control-tower/post-commit.test.sh | task |

