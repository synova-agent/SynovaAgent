# D1034/A4-e — `progress-freshness-watchdog` 红灯根因（只读诊断）

> 执行: diagnoser-c（只读，域判定 **domain-neutral**）｜任务: task-3 / D1036·A4-e｜日期: 2026-09-28
> 写集: **仅本文件**（`docs/synova/product-lines/evidence/D1034-A4e-watchdog-根因.md`）
> 未触碰: `scripts/audit/**` / `docs/synova/audit-reports/**` / `src/**` / 任何门禁脚本 / 任何 workflow
> 采集基线（重要，影响可复现性）: 本地 `HEAD=06ae0b09`，**落后 `origin/main` 4 个 commit**（`origin/main=ff467712`）。
> 滞后是否影响结论 → 三个受影响前缀逐一核对：
> ```
> $ for p in scripts/product-lines/ .github/workflows/ docs/synova/product-lines/; do git log --oneline HEAD..origin/main -- "$p"; done
> -- scripts/product-lines/ --      （空）
> -- .github/workflows/ --          （空）
> -- docs/synova/product-lines/ --
> 50f52f44 feat(D1028): D734 PR 预算门禁「纯归档/出库」路径级豁免 + 死代码清理声明逃生口（K3 CONDITIONAL PASS）
> ```
> `50f52f44` 只新增 `docs/synova/product-lines/evidence/D1028-A2/*`（`git show --stat 50f52f44` 原始输出），
> **未触碰** `product-progress.json` / `check-progress-freshness.py` / 任何 workflow ⇒ 本次分析对象在滞后区间内零改动，结论不受影响。

---

## 结论速览

| # | 问题 | 结论 |
|---|------|------|
| 1 | 红的原因分类 | **数据过期（判据对，链路断）**——不是阈值/解析 bug 引发的红 |
| 2 | 判据有没有 bug | 边界/解析/退出码语义**无 bug**；**时区语义有真 bug（±8 小时，file:line 见 §2.3）**，但**不是本次红的原因** |
| 3 | 链路断点 | `product-progress.yml:9-11 / :62-80`（b 案：只推 bot 分支不开 PR）+ **CTO 合并环节断**（`CI-诊断通道.md:134` 4 号诊断项逐字命中）。是「**没人合**」而不是「合不进去」（`git merge-tree` 零冲突，§3.3） |
| 4 | 修法 | 链路：**越权**，需 CTO 用 PAT 开 PR（§4.1）；判据：修法已给精确到行，但**本批不做**（改门禁 + 改判分链，需另立卡 + K3 复审，§4.2） |

---

## 0. 队长冻结前提的逐条复核（不实/漂移必须指出）

| 前提 | 复核命令 | 实测输出（原样） | 判定 |
|------|---------|-----------------|------|
| workflow 只有 1 个 job，名 `产物新鲜度（generated_at > 3 天必红）` | 读 `.github/workflows/progress-freshness-watchdog.yml` | `:22 jobs:` → 唯一 job `:23 freshness:` / `:24 name:` 命中全名；`:32 run: python3 scripts/product-lines/check-progress-freshness.py` | ✅ 属实 |
| 本地复现 `距今 7.3 天` / `EXIT=1` | `python3 scripts/product-lines/check-progress-freshness.py` | `🚨 产物过期: .../product-progress.json \| generated_at=2026-09-20 23:23:03 \| 距今 7.4 天 > 阈值 3.0 天` / `EXIT=1` | ✅ 属实（7.3→7.4 只因时钟前进，同向同量级） |
| main 侧 `generated_at = 2026-09-20 23:23:03` | `python3 -c "json.load(...)['generated_at']"` | `main generated_at = 2026-09-20 23:23:03` | ✅ 属实 |
| `origin/auto/product-progress` 侧 `generated_at = 2026-09-27 22:57:30` | `git show origin/auto/product-progress:...product-progress.json` | `auto generated_at = 2026-09-27 23:52:17` | ⚠️ **已前移**（分支被再次 force push，见下）；**"有产出、未落 main" 的结论不变** |
| watchdog run 时间线 9 条（id/日期/结论） | GitHub API `.../workflows/progress-freshness-watchdog.yml/runs` | 9 条 id 与结论 **逐条一致**（§1.3 原始表） | ✅ 属实 |
| `36301496780` job `06:54:51Z → 06:54:57Z`，失败 step = 检查 step | API `.../actions/runs/36301496780/jobs` | `JOB: 108569845998 ... started= 2026-09-27T06:54:51Z completed= 06:54:57Z`；`STEP: 4 '检查 product-progress.json generated_at' completed failure 06:54:54Z 06:54:55Z` | ✅ 属实 |

**前提漂移的解释（原始数据）**：`origin/auto/product-progress` 当前 tip = `976a2af5`（`git ls-remote --heads origin`：
`976a2af50c2c4b058e4883dd599549a297f4c476 refs/heads/auto/product-progress`），其产物 `generated_at=2026-09-27 23:52:17` **恰等于**
该提交的 committer 时间（`git show -s --format=%cd` → `Sun Sep 27 23:52:17 2026 +0000`）。
队长测到的 `22:57:30` 对应更早一次刷新 run（`36356921027` push，`22:55:11Z→22:57:35Z`）；此后 23:48–23:52 又有两次 push run
（`36359938557` / `36359947344`）把分支 force push 到新时间戳。**bot 分支是 force push 覆盖式，所以「上一次测到的值」必然会被下一次覆盖。**

---

## 1. 红的分类：数据过期（判据对，链路断）

### 1.1 判据本体（`scripts/product-lines/check-progress-freshness.py`）关键行

```
 93:    age_days = (now_dt - gen_dt).total_seconds() / 86400.0
 94:    if age_days > max_age_days:          # 默认 max_age_days = 3.0（:40）
 95:        print("🚨 产物过期: ...")
 98:        return 1                          # exit 1 = 业务红
 99:    print("✅ 产物新鲜: ...")
100:    return 0
```
判定链上**只有一处算术**（`:93`）与**一处比较**（`:94`），无正则/无字符串删改/无副作用 ⇒ 不存在"解析把 0 天读成 7 天"的路径。

### 1.2 判据自己的密封测试：11/11 全绿（同一次红灯期间）

```
$ bash tests/control-tower/check-progress-freshness.test.sh
=== D786: check-progress-freshness（产物过期看门狗）===
  ✅ 接线: watchdog workflow 调用看门狗脚本
  ✅ 接线: 本测试在 ci.yml canary 清单
  ✅ ① 新鲜产物 exit 0 + ✅
  ✅ ② 过期产物 exit 1 + 🚨 告警
  ✅ ③ 边界 3.0 天 exit 0（等于阈值不告警）
  ✅ ④ 缺文件 exit 2 + degraded 留痕
  ✅ ⑤ 坏 JSON exit 2 + degraded 留痕
  ✅ ⑥ 缺 generated_at exit 2 + degraded 留痕
  ✅ ⑦ --now 不可解析 exit 2
  ✅ ⑦ 未知参数 exit 2
  ✅ ⑧ 真实产物 age=0 冒烟 exit 0（generated_at=2026-09-20 23:23:03）
════════════════════════════════════
  通过 11 / 失败 0
✅ 全部通过
SEALED_TEST_EXIT=0
```
（该测试在 CI canary 清单内：`.github/workflows/ci.yml:384 → tests/control-tower/check-progress-freshness.test.sh`，接线属实。）

### 1.3 9 条 run 的红/绿 **100% 被 main 侧产物时间戳解释**（机器生成，非手写）

```
run_id        date   run_started_at(UTC) | age | base(该 run 时 main 上的 gen) | conclusion | 判据预测一致?
36301496780 09-27 2026-09-27T06:54:49Z | 6.3137 天 | 09-20 23:23:03 | failure | YES
36223828228 09-26 2026-09-26T06:27:54Z | 5.2950 天 | 09-20 23:23:03 | failure | YES
36102852659 09-25 2026-09-25T06:26:17Z | 4.2939 天 | 09-20 23:23:03 | failure | YES
35964932621 09-24 2026-09-24T06:31:52Z | 3.2978 天 | 09-20 23:23:03 | failure | YES
35826571954 09-23 2026-09-23T06:24:04Z | 2.2924 天 | 09-20 23:23:03 | success | YES
35695613641 09-22 2026-09-22T06:36:39Z | 1.3011 天 | 09-20 23:23:03 | success | YES
35570154966 09-21 2026-09-21T06:49:51Z | 0.3103 天 | 09-20 23:23:03 | success | YES
35495023328 09-20 2026-09-20T06:44:41Z | 3.4887 天 | 09-16 19:00:59 | failure | YES
35426357599 09-19 2026-09-19T06:20:58Z | 2.4722 天 | 09-16 19:00:59 | success | YES
```
其中 `09-20` 那次用的是 **09-20 当天的旧产物**（`git show cb1bbcaf^:docs/synova/product-lines/product-progress.json` →
`generated_at = 2026-09-16 19:00:59`，来自 `31506d16` 提交）；`cb1bbcaf`（D850，2026-09-20 23:41:30 +0800）把产物刷新到
`2026-09-20 23:23:03` 并于此后落 main ⇒ 09-21/22/23 转绿，09-24 起再次转红。**时间线无一处需要"判据 bug"来解释。**

### 1.4 分类判定

> **红灯 = `main` 上 `docs/synova/product-lines/product-progress.json` 的 `generated_at` 已 6.3–6.7 天未更新（阈值 3.0），
> 而刷新链本身一直在产出（bot 分支每日更新），断点在「bot 分支 → main」的人工合并环节。**

---

## 2. 判据逐行分析（`check-progress-freshness.py`，全文 104 行）

### 2.1 `age == 3.0` 边界：**文档 = 代码 = 测试三者一致，无 bug**

| 出处 | 原文 | 行号 |
|------|------|------|
| 文档（脚本契约头） | `[--max-age-days N]（默认 3；generated_at 距今**超过** N 天 → 告警）` | `check-progress-freshness.py:8` |
| 文档（退出码） | `0 = 新鲜（age ≤ 阈值；恰好等于阈值仍算新鲜——「超过 3 天」才告警）` | `:11` |
| 代码 | `if age_days > max_age_days:`（严格大于） | `:94` |
| workflow 注释 | `product-progress.json 的 generated_at 距今 > 3 天 → 脚本 exit 1 → job 红灯` | `progress-freshness-watchdog.yml:7` |
| workflow job 名 | `产物新鲜度（generated_at > 3 天必红）` | `:24` |
| 密封测试 | `③ 边界 — 恰好 3.0 天 → exit 0（「超过 3 天」才告警，等于不算）` / 断言 | `tests/control-tower/check-progress-freshness.test.sh:14, :60, :77-79` |

`--now` 注入缝实测（同一产物 `gen=2026-09-20 23:23:03`）：

```
$ python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-23 23:23:02"
✅ 产物新鲜: ... | generated_at=2026-09-20 23:23:03 | 距今 3.0 天 ≤ 阈值 3.0 天        EXIT=0
$ python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-23 23:23:03"
✅ 产物新鲜: ... | 距今 3.0 天 ≤ 阈值 3.0 天                                      EXIT=0
$ python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-23 23:23:04"
🚨 产物过期: ... | 距今 3.0 天 > 阈值 3.0 天                                      EXIT=1
```
⇒ **判定：边界语义无 bug**（`age == 3.0` 不 fail，秒级越过即 fail）。

**但发现一处显示缺陷（非功能性，`:95`）**：`%.1f` 舍入会印出自相矛盾的 `距今 3.0 天 > 阈值 3.0 天`（上面第 3 条原始输出即实例）。
比较用微秒精度、打印用 1 位小数 ⇒ 运维读日志时会以为「3.0 > 3.0 是 bug」。修法见 §4.2-T2。

### 2.2 解析路径：无 bug

`--file/--max-age-days/--now` 三参数解析（`:44-63`）对未知参数与坏数字都 exit 2（实测 ⑦ 两条 ✅）；
`generated_at` 缺失/非字符串 → exit 2（`:83-86`，实测 ⑥ ✅）；JSON 损坏 → exit 2（`:80-82`，实测 ⑤ ✅）。
`DATE_FMT` 单源（`:35`）同时用于解析与格式化，无格式漂移面。

### 2.3 🔴 时区语义：**真 bug（±8 小时）**——位置与实证

**代码事实**：三处都是 **naive（无 tzinfo）** 的墙钟比较，没有任何时区归一：

```
 66:        now = datetime.now().strftime(DATE_FMT)      # 取本地墙钟
 68:        now_dt = datetime.strptime(now, DATE_FMT)    # 解析出 naive datetime
 88:        gen_dt = datetime.strptime(gen, DATE_FMT)    # 同样 naive
 93:    age_days = (now_dt - gen_dt).total_seconds() / 86400.0   # naive - naive
```
生成侧同样是本地墙钟：`scripts/product-lines/calc-progress.py:691 today = today or datetime.now()`、
`:808 "generated_at": today.strftime("%Y-%m-%d %H:%M:%S")`。
⇒ **产物里的 `generated_at` 是"生成那一台机器的墙钟"，判据里的 `now` 是"判定那一台机器的墙钟"。两台机器时区不同（本地 CST / runner UTC）就产生 8.000 小时系统偏移。**

**两份产物的时区语义实证（用 git 时间戳锚定，非推测）**：

```
# main 侧产物：北京墙钟
$ git show -s --format='commit %h | author date %ad | committer date %cd' --date=iso cb1bbcaf
commit cb1bbcaf | author date 2026-09-20 23:41:30 +0800 | committer date 2026-09-20 23:41:30 +0800
main generated_at = 2026-09-20 23:23:03
# 若该串是 UTC，则对应北京 2026-09-21 07:23:03 —— 晚于提交时刻 23:41:30 +0800，物理不可能 ⇒ 必为北京墙钟

# bot 分支产物：UTC 墙钟
$ git show -s --format='commit %h | committer date %cd' --date=iso origin/auto/product-progress
commit 976a2af5 | committer date 2026-09-27 23:52:17 +0000
auto generated_at = 2026-09-27 23:52:17
# 与 runner 提交时刻「秒级完全相等」⇒ 必为 UTC 墙钟
```

**同一物理瞬间、两个墙钟 → 两个年龄（实测）**：

```
$ python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-27 06:54:51"   # = CI 的 UTC 墙钟
🚨 产物过期: ... | 距今 6.3 天 > 阈值 3.0 天      EXIT=1
$ python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-27 14:54:51"   # = 同一瞬间的北京墙钟
🚨 产物过期: ... | 距今 6.6 天 > 阈值 3.0 天      EXIT=1
# 手算：CI(UTC墙钟) age=6.3137 天 | 北京墙钟 age=6.6471 天 | 差=0.3333 天 = 8.0 小时
```

**两个方向的后果（都实测复现）**：

- **假绿（fail-open）**：北京产出的产物 + CI（UTC 钟）判定 → 年龄被**少算 8h**，产物已经真过期时仍报绿：
```
$ python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-23 16:00:00"
✅ 产物新鲜: ... | generated_at=2026-09-20 23:23:03 | 距今 2.7 天 ≤ 阈值 3.0 天     EXIT=0
# 同一瞬间的真实 age = 3.03 天（> 3.0 → 本应红）；脚本按 naive 相减得 2.69 天 ⇒ 假绿
```
- **假红（false-alarm）**：CI（UTC 钟）产出的产物 + 本地/人工（北京钟）判定 → 年龄被**多算 8h**，产物还新鲜时先报红：
```
$ git show origin/auto/product-progress:docs/synova/product-lines/product-progress.json > /tmp/auto-progress.json
auto generated_at = 2026-09-27 23:52:17
$ python3 scripts/product-lines/check-progress-freshness.py --file /tmp/auto-progress.json --now "2026-09-30 23:52:17"
✅ 产物新鲜: ... | 距今 3.0 天 ≤ 阈值 3.0 天        EXIT=0
$ python3 scripts/product-lines/check-progress-freshness.py --file /tmp/auto-progress.json --now "2026-09-30 23:53:00"
🚨 产物过期: ... | 距今 3.0 天 > 阈值 3.0 天        EXIT=1
# 按 UTC 墙钟差 = 3.0005 天（脚本会算的值）；若 gen 是 UTC 而 now 是北京，真实 age = 2.6672 天
# ⇒ 真实年龄 2.67 天（远未到 3 天）被判红 = 早报 8 小时
```

**为什么密封测试抓不到**：该测试**全部用例都用固定 `--now` 字符串**（`:48 NOW="2026-09-16 12:00:00"`），
且冒烟项用 `--now "$REAL_GEN"`（`:106`，age 恒为 0）——**跨时区/跨环境路径零覆盖**。
测试自身在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 下都会 11/11 绿，因此这个 bug 可以长期存活。

**对本次红灯的影响（必须honest）**：**本次红不由此产生**。所有 5 次红在两种钟下都 > 3.0 天（最少的是 09-24 的
3.2978 天 / 真值 3.63 天，同向判红）；3 次绿也都 < 2.3 天。**唯一值得注意的是 09-24 那次仅超阈 7.1 小时，落在 ±8h
误差带内**——即该缺陷已在阈值边界附近活动，换个方向就会翻结论。所以它是**必须修的潜在缺陷**，而不是本次红灯的因。

### 2.4 exit 2（降级）vs exit 1（业务红）在 CI 的可见性：**只有裸数字可见，原因不可见**

- workflow 侧：单 step（`progress-freshness-watchdog.yml:31-32`），
  `grep -n "::error\|if:\|continue-on-error" .github/workflows/progress-freshness-watchdog.yml` → **零命中（exit 1）**
  ⇒ 没有 `::error title=`、没有 step summary、没有 `if: failure()` 告警步骤。
- 平台实际回传（匿名 check-runs annotations，D521 通道，实测 3 条）：
```
$ curl -s ".../check-runs/108569845998/annotations"
annotations count = 3
warning | | 'Node.js 20 is deprecated. ...'                | .github
failure | | 'Process completed with exit code 1.'          | .github
notice  | | '"The ubuntu-latest label will migrate ..."'   | .github
```
⇒ **exit 1 与 exit 2 的区别只体现为 annotation 里那个裸数字**（`exit code 1` / `exit code 2`），
**「产物过期 / 产物缺失 / JSON 损坏 / 字段缺失」四种原因在平台上完全不可区分**，必须回到仓库文档
（`CI-诊断通道.md:130`）才知道该怎么读。失败邮件也只有一个泛化的 workflow 失败。对一个自称
"fail-visible（通道断了 3 天内必红）"（`progress-freshness-watchdog.yml:1`）的看门狗，这是**告警质量缺口**：它保证"必红"，
但没保证"红得能读"。修法见 §4.2-T3。

### 2.5 「修好了也永远红」路径：**存在，且当前有两条**

**P1 · 通道型（当前激活，就是本次红灯）**
刷新产物只推 `auto/product-progress`，**没有任何自动合并入口**：
```
$ grep -rn "auto/product-progress\|auto/dashboard" .github/workflows/ scripts/
.github/workflows/product-progress.yml:70:          git checkout -b auto/product-progress
.github/workflows/product-progress.yml:73:          git push origin auto/product-progress --force
.github/workflows/product-progress.yml:78:           echo "   1) 用 PAT 从 auto/product-progress 开 PR（真实凭据 → 必需检查正常报告）"
.github/workflows/dashboard-auto.yml:65:          git checkout -B auto/dashboard origin/main
.github/workflows/dashboard-auto.yml:68:          git push origin auto/dashboard --force
.github/workflows/dashboard-auto.yml:73:           echo "   1) 用 PAT 从 auto/dashboard 开 PR（真实凭据 → 必需检查正常报告）"
```
⇒ 只要人不合并，**链路每天健康运转、看门狗每天红**（"修好了也永远红"的字面实例，已持续 09-24 起 4 次）。

**P2 · 幂等型（假红，尚未激活但可达）**
`product-progress.yml:66` 用 `git diff --quiet -- docs/synova/product-lines/` 决定是否提交，
而两个生成器在"数据没变"时都**不重写文件**：
```
scripts/product-lines/calc-progress.py:831  # 幂等: 仅 generated_at 变化 → 不重写（防 CI 每跑一次就产生一条噪音提交/bot PR）
scripts/product-lines/calc-progress.py:842  log.info("进度无变化（仅时间戳），不重写（幂等）")
scripts/product-lines/gen-progress-page.py:458  log.info("页面无变化，不重写（幂等）")
.github/workflows/product-progress.yml:66-69  if git diff --quiet ...; then echo "无变化，跳过（幂等）"; exit 0
```
⇒ **一个"产品层面没变化"的静默周**，刷新链每次都成功、每次都"无变化，跳过"，`generated_at` 被冻结在 main 上，
3 天后看门狗照样红——**红的是"没数据变化"，不是"链路断了"**（假红）。这是判据语义与幂等设计的冲突，
不是代码笔误。

**P3 · 无自愈**：`CI-诊断通道.md:123-124`（B.2 末段）说明 D373 自愈机制处理的是"有分支无 PR"的悬挂态，
不处理当前这种"有分支、无 PR、且**按设计**不开 PR"的状态 ⇒ 通道型断链没有自动恢复路径。

---

## 3. 链路断点定位（为什么 main 停在 09-20）

### 3.1 断点 1：设计 b（有意为之，非故障）

```
.github/workflows/product-progress.yml:9-13
# D786 通道设计 (b，2026-09-16): 产物有变化 → 只提交 bot 分支 auto/product-progress（force push），
#   **不再开 PR**——GITHUB_TOKEN 创建的 PR 不触发任何 workflow，12 个必需检查永不报告 = 永久
#   blocked（#404 实证）。合并由 CTO session 用 PAT 显式开 PR + CI 全绿 + API 合并。
...
.github/workflows/product-progress.yml:62-80   末步骤：「产物有变化则提交到 bot 分支（D786 通道设计 b：不开 PR）」
```
链路文档同口径：`docs/synova/coordination/CI-诊断通道.md:74-77`（CTO session 显式合并 3 步）、
`:88-103`（PAT 开 PR / 查 check-runs 非零 / squash 合并的标准命令）。

### 3.2 断点 2：CTO 合并环节（人为缺口）——**诊断项 4 号逐字命中**

```
docs/synova/coordination/CI-诊断通道.md:135
4. **CTO 合并环节断了**（bot 分支有新提交但没人开 PR）：按 B.1 标准命令走 1-2-3。
```

PR 侧原始数据（GitHub API，`state=all&head=tangbaobao520:auto/product-progress`）：
```
586 closed merged_at= None  created=2026-09-16T11:04:59Z  updated=2026-09-16T12:27:30Z  chore(D371): 产品进度自动更新
404 closed merged_at= None  created=2026-09-07T06:28:18Z  updated=2026-09-16T11:04:56Z  chore(D371): 产品进度自动更新
386 closed merged_at= None  created=2026-09-07T06:27:57Z  ...
367 closed merged_at=2026-09-06T09:21:24Z  created=2026-09-05T16:35:16Z   ← 最后一次真正合并
362 closed merged_at= None  ...
54  closed merged_at= None  ...
```
⇒ **最后一次成功的 bot 分支合并 = PR #367（2026-09-06）**；此后 #404/#586 等均未合并关闭；
截至本次诊断**没有任何 open PR 指向 `auto/product-progress`**。这与"看门狗 09-24 起连红"的时间线一致。

### 3.3 是「没人合」还是「合不进去」？→ **合得进去，是没人合**

```
# ① bot 分支只领先 1 个 commit，且只动 product-lines 产物（6 文件）
$ git log --oneline origin/main..origin/auto/product-progress
976a2af5 chore(D371): 产品进度自动更新 2026-09-27
$ git show --stat origin/auto/product-progress | tail -8
 docs/synova/product-lines/evidence-expiry.json             |  94 ++++--
 docs/synova/product-lines/evidence/D817-capture-20260918.json | 70 +++--
 docs/synova/product-lines/evidence/D819-capture-20260919.json |  2 +-
 docs/synova/product-lines/evidence/test-2026-09-27.json       | 184 ++++++++++++
 docs/synova/product-lines/product-progress.html            |  26 +-
 docs/synova/product-lines/product-progress.json            | 330 ++++++++++++---------
 6 files changed, 506 insertions(+), 200 deletions(-)

# ② 它的父提交就是 origin/main 的祖先；main 之后只多了 1 个 commit，且不碰产物
$ git merge-base --is-ancestor 50f52f446c349019853c3e9d4079886db826914b origin/main ; echo EXIT=$?
EXIT=0
$ git log --oneline 50f52f446c349019853c3e9d4079886db826914b..origin/main
ff467712 docs(D1034): cto-handover 加「派单模板 v2」— 预置坑位（门禁合规六条 + 推送纪律四条）
$ git log --oneline 50f52f44..origin/main -- docs/synova/product-lines/     # 空 ⇒ 零冲突面

# ③ 真试合（只读，不写工作区/索引）：exit 0 = 无冲突
$ git merge-tree --write-tree origin/main origin/auto/product-progress
c2fbbb0974ab8c58161c0dcab8277128a9a3aa12
MERGE_TREE_EXIT=0
```

### 3.4 刷新链本身是健康的（排除"上游坏了"）

```
$ curl -s .../workflows/product-progress.yml/runs?per_page=12      # total_count = 730
36359947344 push success dur=186s (2026-09-27T23:49:02Z)
36359938557 push success dur=209s (2026-09-27T23:48:52Z)
36356921027 push success dur=144s (2026-09-27T22:55:11Z)
36355698510 push success dur=183s (2026-09-27T22:33:28Z)
36355046075 push success dur=214s (2026-09-27T22:22:09Z)
36296966540 push success dur=140s (2026-09-27T05:21:26Z)
36269530072 push success dur=205s (2026-09-26T20:26:26Z)
36233707072 push success dur=184s (2026-09-26T09:44:51Z)
```
⇒ 「触发 → 刷新 → force push bot 分支」全绿；**唯一断口在 bot 分支 → main 的人工合并**。

---

## 4. 修法

### 4.1 链路修（本批**不能做** → 归 CTO）

**最小可行修复（3 步，命令见 `CI-诊断通道.md:88-103`）**：
1. 用 PAT 从 `auto/product-progress` 开 PR（真实凭据 → 12 个必需检查才会报告）；
2. 等 check-runs 非零且全 pass；
3. API squash 合并 → main 产物 `generated_at` 前进到 2026-09-27 → 看门狗次日自动转绿。
（本次 `merge-tree` 已证明无冲突，且 bot 分支仅落后 main 1 个 commit ⇒ **一次点击即可闭环**。）

**为什么本批不能做（三条独立理由）**：
1. **越权（写集）**：本卡 `write_scopes` 仅 `docs/synova/product-lines/evidence/D1034-A4e-watchdog-根因.md`；
   开 PR/合并会写入 `docs/synova/product-lines/**` 的 6 个文件 + 改动 main。属"擅自扩写集"禁令范围。
2. **凭证**：合并需要 `GITHUB_TOKEN`（PAT）。`CI-诊断通道.md:147-150` 明确记载「未采 (a) 的原因：当前唯一可用凭据是
   创始人个人宽权 classic PAT——单方面写入 repo secret 意味着任何未来 workflow 都能以创始人全部权限行事
   （安全 posture 变更，CTO 不自决）」⇒ 本批更没有自决权。
3. **流程**：合并 bot 分支是 CTO 的既定动作（`CI-诊断通道.md:77` "合并是 CTO 的工作，D570"），且合并前必须
   看到必需检查全绿——这一步只能由持有 PAT 的 CTO session 在本批之外执行。

### 4.2 判据修（修法已精确到行，但本批**不做** → 另立卡 + K3 复审）

**T1 · 时区归一（修 §2.3 的真 bug）**——推荐"双端扎 UTC"：

| 文件 | 行 | 改成 | 为什么 |
|------|----|------|--------|
| `scripts/product-lines/check-progress-freshness.py` | `:25` | `from datetime import datetime, timezone` | 引入时区构造器 |
| 同上 | `:66` | `now = datetime.now(timezone.utc).strftime(DATE_FMT)` | 判定端一律取 UTC 墙钟，不取本机墙钟 |
| 同上 | `:68` / `:88` | 解析后 `.replace(tzinfo=timezone.utc)`（或 `strptime` 后统一 attach UTC） | 两串同源同时区，相减才有意义 |
| 同上 | `:93` | 保持 `(now_dt - gen_dt)`，但两侧均为 aware UTC | 消除 ±8h 系统偏移 |
| 同上 | `:3-19` 契约头 | 明确写「`generated_at` 语义 = **UTC 墙钟**」 | 否则下一个消费者仍会按本地钟生成 |
| `scripts/product-lines/calc-progress.py` | `:691` / `:808` | `today = today or datetime.now(timezone.utc)`；`generated_at` 写 UTC 墙钟 | 生成端与判定端同源 |
| `tests/control-tower/check-progress-freshness.test.sh` | 新增用例 | 同一 `--now` 绝对时刻，在 `TZ=UTC` 与 `TZ=Asia/Shanghai` 下**必须同年齢** | 当前全用例用固定 `--now`，跨时区零覆盖（§2.3） |

**为什么本批不做**：① 这两个文件分别是 **D786 看门狗的物理执法器**与**判分链生成器**，改它们＝改门禁/改判分，
按「门禁脚本变更 = 最高风险」需另立卡 + K3 复审（本卡红线「不改产品/门禁代码」直接覆盖）；
② 存在**历史产物语义迁移面**：现存两份产物分别是北京墙钟（main）与 UTC 墙钟（bot 分支），切换语义需要一次性
声明与过渡窗口；③ 本卡写集只有 1 个 md。

**T2 · 消息舍入自相矛盾（§2.1 实例）**：`check-progress-freshness.py:95` 的 `%.1f` → `%.2f`（或额外打印秒级差），
避免出现 `距今 3.0 天 > 阈值 3.0 天` 这种"看起来像 bug"的日志。同文件 ⇒ 与 T1 同批另立卡。

**T3 · 让"红得能读"（§2.4）**：`.github/workflows/progress-freshness-watchdog.yml:31-32` 的 step 改为
把脚本输出转成显式注解 + 摘要，例如
```
::error title=产物新鲜度(exit $RC)::$MSG          # 让 D521 匿名通道能读到原因，而不只是裸 exit code
echo "### 产物新鲜度" >> "$GITHUB_STEP_SUMMARY"  # 把 🚨/✅ 全文落到 run 摘要
```
**为什么本批不做**：改 `.github/workflows/**` 是 CI 红区（`ci.yml` 更是 CTO 排期热点文件），本卡只读 + 报告。

**T4 · 消掉「静默周假红」（§2.5-P2）**，二选一（推荐 a，不改判分链）：
- (a) 看门狗增加"二次判据"：若 `auto/product-progress` 分支在阈值内仍有新 commit（=链路活跃），
  则判"链路活、只是无人合"（黄/告警文案不同），只有分支也停了才按红处理；
- (b) `calc-progress.py:831-843` 的幂等分支改为仍重写 `generated_at`（代价：每周产生 1 条无信息量 bot commit）。
**为什么本批不做**：需要改判据或判分链（同 T1 的红线），且要先与 CTO 确认"新鲜度"到底是想度量
**产物被重算过** 还是 **main 上的数字被刷新过**——这是产品口径问题，不是编码问题。

---

## 5. A4-d 支撑：5 个 workflow 成本基线**原始证据**（独立取数，供成员 B 的 md 核对）

仓库当前恰好 5 个 workflow（`ls .github/workflows/`：`ci.yml` / `dashboard-auto.yml` / `desktop-build.yml` /
`product-progress.yml` / `progress-freshness-watchdog.yml`）。数据源：GitHub Actions API `runs` 接口，
`dur = updated_at - run_started_at`（秒）。

| workflow | 累计 run（total_count） | 最近 8 次 duration（秒） | 中位数（粗算） |
|----------|------------------------|--------------------------|----------------|
| `ci.yml` | 4670 | 20 / 100 / 60 / 17(cancelled) / 36 / **2290** / 35 / 32 | ~48（**离群点 2290 = 38 分钟**） |
| `dashboard-auto.yml` | 649 | 20 / 23 / 17 / 21 / 16 / 16 / 17 / 20 | ~18.5 |
| `desktop-build.yml` | 518 | 291 / 277 / 281 / 275 / 253 / 279 / 260 / 266 | ~273.5 |
| `product-progress.yml` | 730 | 186 / 209 / 144 / 183 / 214 / 140 / 205 / 184 | ~184.5 |
| `progress-freshness-watchdog.yml` | 12 | 8 / 11 / 11 / 10 / 12 / 11 / 8 / 10 | ~10.5 |

单条大额样本（用于核对"成本大头在哪"）：
```
ci.yml  36356959940  ev=pull_request concl=success dur=2290s  created=2026-09-27T22:55:54Z   ← 38 分钟单次
desktop-build 36359947413 push success dur=291s (2026-09-27T23:49:02Z)
```
**取数说明（供核对）**：`ci.yml` 的 8 次里有 2 条 `conclusion=None`（本文件写作时仍在跑），已原样保留；
`cancelled` 一条也原样保留。**这些数字是 API 原始值，未做任何平滑**；成员 B 若给出不同的中位数，
应以"是否含 cancelled/在跑样本"和"时间窗口"两点对齐口径。

---

## 6. 遗留清单（每条附「为什么本批不能做」）

| # | 遗留项 | 归属 | 为什么本批不能做 |
|---|--------|------|-----------------|
| L1 | 用 PAT 从 `auto/product-progress` 开 PR + CI 全绿 + squash 合并（唯一能让看门狗转绿的动作） | CTO | ① 本卡写集仅 1 个 md，合并会写入 `docs/synova/product-lines/**` 6 文件 → 越权；② 需创始人宽权 PAT，`CI-诊断通道.md:147-150` 记载 CTO 亦不自决；③ 合并是 `D570` 规定的 CTO 动作 |
| L2 | 修 `check-progress-freshness.py` 时区 bug（T1，7 处改动 + 1 条跨时区测试） | 另立卡 | 看门狗判据 = 物理执法器，改它属门禁变更（最高风险）→ 需新卡 + K3 复审；且存在两份历史产物的时区语义迁移面 |
| L3 | 修 `:95` 消息舍入（T2） | 另立卡 | 同文件同批，与 L2 合并处理更省；本卡红线「不改门禁代码」 |
| L4 | 看门狗 step 加 `::error` / step summary（T3） | CTO 排期 | 改 `.github/workflows/**` 是 CI 红区，本卡只读 |
| L5 | 「静默周假红」口径裁定 + 实现（T4） | CTO/产品口径 | 先要裁定「新鲜度」度量的是"产物被重算"还是"main 数字被刷新"，属产品口径而非编码；且改动落在判据/判分链 |
| L6 | `dashboard-auto.yml` 的 `auto/dashboard` 通道同型（同一天没人合） | CTO | 同一根因的第二个实例；本卡范围只含 `progress-freshness-watchdog`，跨 workflow 需扩写集授权 |
| L7 | 本证据文件未提交、未推送（`git status` 显示 `?? docs/synova/product-lines/evidence/D1034-A4e-watchdog-根因.md`） | lead | 队长指令明确「**不要 push**」；提交（pre-commit 13 组 + 铁律 49 决策 Note 引用）应由队长的收尾三件统一处理 |

---

## 7. 可复跑命令清单（任何人可据此复现本文全部数字）

```bash
cd /Users/wane/SynovaAgent

# 前提 & 复现
python3 scripts/product-lines/check-progress-freshness.py; echo "EXIT=$?"
git show -s --format='%h %ad %cd' --date=iso cb1bbcaf
git show origin/auto/product-progress:docs/synova/product-lines/product-progress.json | python3 -c "import json,sys;print(json.load(sys.stdin)['generated_at'])"

# 边界
python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-23 23:23:03"   # → EXIT=0
python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-23 23:23:04"   # → EXIT=1

# 时区
python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-27 06:54:51"   # CI 钟 → 6.3 天
python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-27 14:54:51"   # 北京钟 → 6.6 天
python3 scripts/product-lines/check-progress-freshness.py --now "2026-09-23 16:00:00"   # 假绿实例 → EXIT=0（真值 3.03 天）

# 密封测试
bash tests/control-tower/check-progress-freshness.test.sh

# 链路
git ls-remote --heads origin | grep -E "auto/product-progress|refs/heads/main"
git log --oneline origin/main..origin/auto/product-progress -- docs/synova/product-lines/ | head -20
git merge-tree --write-tree origin/main origin/auto/product-progress; echo "MERGE_TREE_EXIT=$?"
curl -s "https://api.github.com/repos/tangbaobao520/SynovaAgent/pulls?state=all&head=tangbaobao520:auto%2Fproduct-progress&per_page=20"

# CI 侧
curl -s "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/workflows/progress-freshness-watchdog.yml/runs?per_page=12"
curl -s "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs/36301496780/jobs"
curl -s "https://api.github.com/repos/tangbaobao520/SynovaAgent/check-runs/108569845998/annotations"
curl -s "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/workflows/product-progress.yml/runs?per_page=12"
```

---

**自验声明**：本文件为**只读诊断的原始证据汇总**，不含任何判据修改、不含任何"已修复"声称。
可提请独立审计：所有结论均可由 §7 命令复跑得到相同原始输出；本地采集基线落后的 4 个 commit 已核对了零影响面（§顶部）。
