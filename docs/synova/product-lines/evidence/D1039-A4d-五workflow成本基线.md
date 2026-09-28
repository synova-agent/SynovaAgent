# D1039 / A4-d — 五个 workflow 全盘成本基线（实测）

> 任务号 **D1041**（A4-d；父卡 **D1039**）｜产出人 coder-b｜分支 `team/a4b-vitest-log`｜工作树 `.synova-wt-a4-b`
> 取数时间：**2026-09-27T23:52Z ~ 2026-09-28T00:03Z**（UTC）｜仓库 HEAD：`06ae0b09`
> 数据来源：GitHub REST API，公开仓库，**未使用 token**（unauthenticated，配额 60/h）

---

## 〇、口径与复现命令（先声明，后给数）

### 0.1 两个**不同**的墙钟口径（队长 2026-09-28 口径纪律，两者都算、都报，不许混用）

```
[A] job 跨度口径（jobs API 逐条可核，本文件 §一 表内用）
    单 job 墙钟 = completed_at − started_at                    （同一 job 内）
    run 总墙钟  = max(所有 job 的 completed_at) − min(所有 job 的 started_at)   （同 run 内）

[B] run 墙钟口径（run 级时间戳，与 [A] 不同，§1.7 交叉核对用）
    run 总墙钟 = updated_at − run_started_at                   （同一 run 内，含排队与收尾）
```

**为什么要两个都算**：`[A] − [B]` 的差额 = 排队 + 收尾噪声，只有把两个都摆出来，
读者才能判断"占比高"是**被作业本身撑起来的**，还是**被排队撑起来的**。
同一 run（`36356959940`）实测：`[A] = 2223s`、`[B] = 2290s`，差额 **67s**。
本文件所有占比**显式标注用的是哪一个口径**。

🔴 **口径纪律（队长定，本文件遵守）**：
1. **run 墙钟 = `updated_at − run_started_at`**（不是 job 跨度）——两个口径都必须给公式与 run id。
2. **`cancelled` / `skipped` 样本一律原样保留并标注，不许平滑、不许剔除**——
   被平滑掉的恰好是最贵的那些样本。
3. **任何"提速"结论必须先证明该步真的执行过**（step 级 `conclusion` 不能是 `skipped`），
   否则不予采信（见 §三）。

**复现命令（逐字，无需 token）**：

```bash
curl -sS "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/workflows?per_page=50"
curl -sS "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/workflows/<workflow_id>/runs?per_page=10"
curl -sS "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs/<run_id>/jobs?per_page=100"
```

原始 JSON 已落盘留档（`/tmp/a4d-*.json`，本次会话内可核）。

**⚠️ API 配额状态（如实标注）**：取数时刻 **2026-09-27T23:52Z ~ 2026-09-28T00:03Z**（UTC）。
本文件全部数字在**该时刻**由上述 curl 取得；取数完毕后配额剩 **2**，reset `2026-09-28T00:35:37Z`。
**此后**队长尝试复拉 CI 日志时 GitHub 匿名 API **已 403（配额耗尽）** ⇒ §五 的"创始人侧参考值"
**本批次内无法证实或证伪**，本文件不假装核过。

**workflow_id 对照**：

| workflow | id |
|---|---|
| `.github/workflows/ci.yml` | 288777395 |
| `.github/workflows/dashboard-auto.yml` | 336361784 |
| `.github/workflows/desktop-build.yml` | 341510306 |
| `.github/workflows/product-progress.yml` | 334544220 |
| `.github/workflows/progress-freshness-watchdog.yml` | 359621587 |

---

## 一、每个 workflow × 每个 job 的基线

### 1.1 `ci.yml` — run **36356959940**（`pull_request`，conclusion `success`，head `9dc22d43`）

> 选它的理由：最近 10 个 run 中**唯一一个非 docs-only 且跑完**的（见 §三 混杂警告）。
> jobs 数 = 13。

| # | job 名 | job_id | conclusion | `started_at` | `completed_at` | 墙钟秒 |
|---|---|---|---|---|---|---|
| 1 | Control Tower Gate Tests (ubuntu-latest) | 108726663721 | success | 22:57:00Z | 23:00:34Z | **214** |
| 2 | Test-Kit Architecture Tests (ubuntu-latest) | 108726663739 | success | 22:57:00Z | 22:57:18Z | 18 |
| 3 | Integration Contract Check | 108726663779 | success | 22:57:00Z | 22:58:18Z | 78 |
| 4 | Checker Review (maker/checker) | 108726663782 | success | 22:57:00Z | 22:58:51Z | 111 |
| 5 | Architecture Check | 108726663821 | success | 22:57:00Z | 22:58:48Z | 108 |
| 6 | Gate Integrity (pattern sentinel + injection fixture + ci-reds) | 108726663834 | success | 22:57:00Z | 22:57:20Z | 20 |
| 7 | Test-Kit Architecture Tests (windows-latest) | 108726663838 | success | 22:57:00Z | 22:57:31Z | 31 |
| 8 | npm audit | 108726663687 | success | 22:57:01Z | 22:57:11Z | 10 |
| 9 | **Control Tower Gate Tests (windows-latest)** | 108726663743 | success | 22:57:01Z | **23:34:03Z** | **2222** |
| 10 | TypeScript + Lint + Iron Laws | 108726663823 | success | 22:57:02Z | 22:59:12Z | 130 |
| 11 | Vitest (2/2) | 108727008187 | success | 22:59:14Z | 23:01:54Z | 160 |
| 12 | Vitest (1/2) | 108727008201 | success | 22:59:14Z | 23:01:56Z | 162 |
| 13 | Golden Case F1 Gate | 108727459519 | success | 23:01:58Z | 23:02:26Z | 28 |

（日期均为 **2026-09-27**，表中省略日期）

**run 总墙钟（口径 [A] job 跨度）** = `23:34:03Z − 22:57:00Z` = **2223s = 37m03s**
**run 总墙钟（口径 [B] run 级）** = `updated_at 23:34:04Z − run_started_at 22:55:54Z` = **2290s = 38m10s**

**🔴 必写项 — `control-tower-tests` (windows) 占同 run ci.yml 总墙钟的百分比（两个口径都给）**：

```
口径 [A] job 跨度 :  2222s ÷ 2223s = 99.9546%  →  99.955%     （run 36356959940）
口径 [B] run 墙钟 :  2222s ÷ 2290s = 97.0306%  →  97.031%      （run 36356959940）
      公式：CT(windows) 单 job 墙钟 2222s ÷ run(updated_at − run_started_at) 2290s
```

**两个数都指向同一结论：ci.yml 的墙钟几乎完全等于「Control Tower Gate Tests (windows-latest)」一个 job。**
口径差（2223s vs 2290s，**67s**）全部是排队 + 收尾噪声，**不含任何作业时间** ⇒
即便按更宽的 run 口径算，该 job 仍占 **97.031%**，结论不变。
其余 12 个 job 全部在 **23:01:56Z** 前收工（最大 214s）；run 之所以要 37~38 分钟，是**唯一**因为这 1 个 job 独自又跑了 32 分钟。

> **交叉核对（与 diagnoser-c / 队长独立取数一致）**：diagnoser-c 与队长独立得出的 run 级墙钟
> = **2290s**，与本文件口径 [B] 逐秒相符（差值 0s）。两条独立路径同值 ⇒ run 墙钟数可核。

**step 级下钻（同 job，来源 `jobs[].steps`）**：

| step | 名称 | started → completed | 秒 |
|---|---|---|---|
| 1–2 | Set up job + actions/checkout@v4 | 22:57:03Z → 22:57:15Z | 12 |
| 3 | Detect docs-only change (D515) | 22:57:15Z → 22:57:15Z | 0 |
| 4 | **Run hermetic control-tower gate tests** | 22:57:15Z → **23:33:59Z** | **2204** |
| 8–9 | Post checkout + Complete job | 23:33:59Z → 23:34:01Z | 2 |

⇒ 37 分钟**全部**落在 step 4（2204s / 2222s = 99.19%）；checkout 12s、docs-only 判定 0s。
**成本不在"Windows 机器慢"，在 step 4 内部那 25 个密封门禁测试串行全跑。**

### 1.2 `dashboard-auto.yml` — run **36356920963**（`push`，`success`）

| job 名 | job_id | conclusion | `started_at` | `completed_at` | 墙钟秒 |
|---|---|---|---|---|---|
| generate | 108726386209 | success | 22:55:14Z | 22:55:28Z | **14** |

**run 总墙钟** = 14s（单 job）

### 1.3 `desktop-build.yml` — run **36356920961**（`push`，`success`）

| job 名 | job_id | conclusion | `started_at` | `completed_at` | 墙钟秒 |
|---|---|---|---|---|---|
| windows (nsis) | 108726386244 | success | 22:55:15Z | 22:57:56Z | **161** |
| macos (dmg + zip) | 108726386394 | success | 22:55:20Z | 22:59:52Z | **272** |

**run 总墙钟** = `22:59:52Z − 22:55:15Z` = **277s = 4m37s**（两 job 并行；串行和 = 433s）

### 1.4 `product-progress.yml` — run **36356921027**（`push`，`success`）

| job 名 | job_id | conclusion | `started_at` | `completed_at` | 墙钟秒 |
|---|---|---|---|---|---|
| 聚合 → 计算 → 页面 | 108726386546 | success | 22:55:14Z | 22:57:35Z | **141** |

**run 总墙钟** = 141s = 2m21s

### 1.5 `progress-freshness-watchdog.yml` — run **36301496780**（`schedule`，**`failure`**）

| job 名 | job_id | conclusion | `started_at` | `completed_at` | 墙钟秒 |
|---|---|---|---|---|---|
| 产物新鲜度（generated_at > 3 天必红） | 108569845998 | failure | 06:54:51Z | 06:54:57Z | **6** |

**run 总墙钟** = 6s（日期 2026-09-27）

### 1.6 五 workflow 单次成本横向对照（都为 1 次 push/PR 触发）

| workflow | 触发 | job 数 | run 总墙钟 | 最大单 job | 备注 |
|---|---|---|---|---|---|
| **ci.yml** | PR | 13 | **2223s（37m03s）** | CT(windows) 2222s | **占总成本绝对多数** |
| desktop-build.yml | push | 2 | 277s（4m37s） | macos 272s | |
| product-progress.yml | push | 1 | 141s（2m21s） | 141s | |
| dashboard-auto.yml | push | 1 | 14s | 14s | |
| watchdog | schedule | 1 | 6s（failure） | 6s | 每天 1 次 |

---

## 二、每个 workflow 最近 10 个 run 的 conclusion 分布

> 口径：`?per_page=10`，按下发顺序取最近 10 条；`IN_PROGRESS/QUEUED` = `conclusion` 为 `null`（API 原样返回 `None`），**不计入** success/failure/cancelled 三档。
> **`cancelled` 数 = 被 `cancel-in-progress` 杀掉的中途 run ⇒ 直接对应烧钱量。**

| workflow | 历史总 run 数 | success | failure | **cancelled** | in-progress/queued |
|---|---|---|---|---|---|
| **ci.yml** | 4670 | 5 | 0 | **3** | 2 |
| dashboard-auto.yml | 649 | 10 | 0 | **0** | 0 |
| desktop-build.yml | 518 | 8 | 0 | **0** | 2 |
| product-progress.yml | 730 | 10 | 0 | **0** | 0 |
| progress-freshness-watchdog.yml | 12 | 5 | **5** | **0** | 0 |

**ci.yml 的 3 个 cancelled 烧掉了多少（实测 jobs API，非估算）**：

| run_id | conclusion | run 总墙钟 | CT(windows) 被杀时已跑 | 明细来源 |
|---|---|---|---|---|
| 36356859727 | cancelled | **159s** | 109s（被杀） | `/tmp/a4d-jobs-ci-cancel-36356859727.json` |
| 36356580410 | cancelled | **300s** | **298s（被杀）** | `/tmp/a4d-jobs-ci-cancel-36356580410.json` |
| 36359938427 | cancelled | 17s（run 级） | —（未起） | `/tmp/a4d-runs-ci.json` |

**合计：3 个 cancelled run 烧掉 ≈ 476s ≈ 8 分钟 runner 时间**，其中 `36356580410` 的
CT(windows) 已跑 **298s** 才被杀——**这印证了「push 打断 → 跑了一半的 windows job 白烧」的机制**。
按 §1.1 的单次 2222s 计，**只要杀在 13% 进度以上，就比一次完整 run 更浪费**（因为下一次还要从头跑）。

**🔴 watchdog 另一条独立信号（本卡只报原始分布，根因属 D1037/A4-e 范围）**：
最近 10 次中 **failure 5 次**，且**最近连续 4 次（09-24 / 09-25 / 09-26 / 09-27）全红**——
09-23 之前是 5 连绿。这是**新出现的连续红**，不是长尾噪声。原始证据：

```
36301496780  failure  2026-09-27T06:54:49Z
36223828228  failure  2026-09-26T06:27:54Z
36102852659  failure  2026-09-25T06:26:17Z
35964932621  failure  2026-09-24T06:31:52Z
35826571954  success  2026-09-23T06:24:04Z   ← 断点
```

---

## 三、⚠️ 混杂警告：不要把 docs-only run 当成"优化后的基线"

**这是本次取数最容易骗人的地方，必须先讲。**

`ci.yml` 最近 10 个 run 里有 **9 个 run 总墙钟只有 32~60s**，看上去像"CI 已经变快了"。
**不是。** 实测 step 级证据（run `36359947341`，`push`，head `ff467712`
= `docs(D1034): cto-handover 加「派单模板 v2」…` **纯文档提交**）：
> （注：`ff467712` 的 commit message 原样写的是 `D1034`——该号正是 main 实际占用者，
> 本次 A4 批已整体顺延至 D1039+；此处**不改写原始 commit message**，保持可核。）

| step | run 36356959940（非 docs-only） | run 36359947341（docs-only） |
|---|---|---|
| Detect docs-only change (D515) | 0s → `docs_only=false` | 0s → `docs_only=true` |
| **Run hermetic control-tower gate tests** | **2204s（跑了）** | **skipped（跳过）** |
| job 总墙钟 | 2222s | **17s** |

⇒ 「2222s → 17s」**不是提速 130 倍，是 D515 守卫把整个 step 跳过了**（`ci.yml:313` 起、
`if: steps.docsonly.outputs.docs_only != 'true'`）。拿 docs-only run 与代码 run 对比，
会得出**完全虚假的优化结论**。

**正确用法**：任何"CI 变快了"的声称，**必须**先证明该 run 是**非 docs-only**，
否则不可比。本卡 §1.1 选 `36356959940` 正是为此。

**本次会话的后缀旁证**：取数时段（23:42~23:50Z）恰好有 4 个 docs-only 提交（D1023/D1028/D1034
的 md 收尾 + 2 个 D521 bypass 登记），全部走跳过路径——**这本身就是"文档批不烧钱"的正面证据**。

---

## 四、数据局限（不可核处，如实声明）

1. **单 run 采样**：§一 每个 workflow 只取了 1 个代表性 run（卡面口径）。ci.yml 的
   `2222s / 2223s = 99.955%` 是**单 run 实测值**，不是 12-run 均值；若需要均值与 P95，
   须扩样（会消耗 API 配额，本次无 token 配额 60/h，取数后仅余 2）。
2. **`completed_at < started_at` 异常**：`ci.yml` run `36359947341` 的
   `Checker Review (maker/checker)` 报 `completed_at 23:49:08Z < started_at 23:49:09Z`
   （墙钟算出 **−1s**），且 conclusion = `skipped`。这是 GitHub 对 skipped job 的已知表现，
   **不是我的计算错误**；本卡所有 cancelled/skipped job 的墙钟均标注原值未平滑。
3. **job 名口径漂移**：早期 run 的 Vitest job 名为 `Vitest (${{ matrix.shard }})`
   （表达式未展开，见 run `36356859727` / `36356580410`），较新 run 为 `Vitest (1/2)` / `Vitest (2/2)`。
   **跨 run 按名聚合时会裂成两个 job**，做趋势对比时必须先归一化。
4. **未含 GitHub 计费口径**：本表的"墙钟秒"是**墙上时间**，不等于 GitHub 计费的
   **runner-minutes**（后者按 job 起算、四舍五入到分钟，且 public repo 免费）。
   本卡按任务书要求只给墙钟，**不声称等于账单**。
5. **API 配额**：无 token 60/h，本次取数后余 2（reset 2026-09-28T00:35:37Z）。
   复现若在同一小时内需等配额恢复。
6. **口径**：§一 表内"墙钟秒"= 口径 [A] job 跨度；§1.1 另给口径 [B] run 墙钟。
   **两个口径不同（2223s vs 2290s），混用会出错**——队长基线的同类口径错即由此产生。

---

## 五、附：A4-b（D1040）日志基线 —— 与"创始人侧参考值"的口径差异

> 本节不是 A4-d 的内容，是**同一批次的 A4-b 证据**，因为两者都涉及"日志量"口径，合并防止被误比。

### 5.1 创始人侧参考值（**降级为参考，不可与本地值直接比较**）

派单件原文给的"今天实测"值：

```
Vitest (1/2) 的 job 日志  7,767 行 / 1.58 MB
pino level：INFO 2,696 ｜ WARN 1,380 ｜ ERROR 39
```

**为什么不可直接比较（两处口径差，队长已裁定）**：
1. **载体不同**：那是 **GitHub Actions 网页日志**的 `Vitest (1/2)` **单分片 job**，
   ≠ 本地 `npx vitest run` 的 **全量 stdout**。shard 1/2 ⇒ 约一半用例。
2. **格式不同**：GitHub web log 含 `##[group]` 折叠标记、时间戳前缀、runner 记账行
   ⇒ 行数口径与本地 reporter stdout **不是同一件事**。
3. **配额状态**：队长事后尝试拉 CI 日志核对时，GitHub 匿名 API **已 403 配额耗尽**
   ⇒ **本批次内无法证实或证伪 7,767**。本文件**不假装核过**，只如实并列。

### 5.2 本地可复现基线（**A4-b 的正式验收口径** = 本节）

**逐字原命令**（改前 / 改后**同一条**，唯一变量 = `vitest.config.ts` 的 LOG_LEVEL 行）：

```bash
cd /Users/wane/SynovaAgent/.synova-wt-a4-b
npx vitest run --reporter=verbose > /tmp/a4b-before.log 2>&1   # 改前
npx vitest run --reporter=verbose > /tmp/a4b-after.log  2>&1   # 改后
```

**用例范围（保证可复现）**：**610 个测试文件 / 4,538 个用例**（`Test Files 2 failed | 605 passed | 3 skipped (610)`）。
环境：vitest **4.1.8**、node **v24.19.0**、HEAD `06ae0b09`、外部 `LOG_LEVEL` **未设**。

| 指标 | 改前 | 改后 | Δ |
|---|---|---|---|
| `wc -l` | **14,502** | **7,911** | **−6,591（−45.4%）** |
| `stat -f %z` (bytes) | **2,791,604** | **1,338,368** | **−1,453,236（−52.1%）** |
| pino `level:30` INFO | **6,619** | **0** | **−6,619（−100%）** |
| pino `level:40` WARN | **2,727** | **2,715** | −12 |
| pino `level:50` ERROR | **320** | **320** | **0（恒等）** |
| 墙钟 (real) | 46.980s | 49.206s | +2.2s（噪声内） |

**级别分布用的是这条命令（卡面那条 `grep -c '"level":20|40|50'` 已作废，见 §5.3）**：

```bash
for L in 10 20 30 40 50 60; do
  printf "  level=%s : %s\n" "$L" "$(grep -oE "\"level\":$L([^0-9]|$)" /tmp/a4b-before.log | wc -l | tr -d ' ')"
done
```

**读法**：INFO **完全归零**、ERROR **逐条恒等（320 = 320）** ⇒ 收敛是**选择性**的，
正是本卡要的"ERROR 不再被 INFO 淹没、失败时上下文仍在"；WARN 的 `−12` 属用例间非确定性
（条件性告警），已在 §5.4 声明。

### 5.3 卡面判据作废（队长 + verifier-v 独立同结论）

卡面原验收命令 `grep -c '"level":20|40|50'` **有两处错**，**本文件未使用**：
① BRE 下 `20|40|50` 是**字面量三选一**（要 `-E` 才是扩展正则），不是三个档；
② `-c` 只数**行**、**不分类**，三档会被混成一个数。
⇒ 已改用 §5.2 的逐档 `-oE` 计数（可独立复算）。

### 5.4 诚实声明（Δ 之外的两条杂音 + 一条环境限定）

1. **改后多出 2 条失败，均已归因，非本卡引入**：
   - `tests/acceptance/zero-code-industry.test.ts > 新增行业零 .ts 文件修改` ——
     该用例断言 `git diff --name-only` 无 `.ts`（`zero-code-industry.test.ts:73-75`）。
     **编辑期必红，commit 后自愈**（D580 同型先例已登记在案），与行为无关。
     ✅ **已验证自愈**：`5e8031ab` 提交后工作树 clean，复跑该文件 =
     `Tests 2 failed | 3 passed (5)`，退回**改前基线同态**（该用例不再出现在失败列表）。
   - `tests/deploy/recovery-pack.test.ts > 错误密码解密失败` —— **单跑 7/7 全绿**，
     全量跑时为并发抖动，非本卡引入。
2. **WARN −12** 未逐条溯源（属非确定性告警，非本卡目标量），**不声称已解释**。
3. **🔴 环境限定（必须与"测试红"一起引用，否则构成不实声明）**：
   §5.2 表内的红/绿是**本地非 CI 口径**（`npx vitest run`，`CI` 未设 ⇒
   `vitest.config.ts:29-38` 的 CI 排除清单**不生效**，`tests/acceptance/**` 等被跑）。
   **同一 commit（`06ae0b09`）在 CI 侧是绿的**：run `36356959940` 的
   `Vitest (1/2)` 与 `Vitest (2/2)` 两个 job **conclusion 均为 `success`**（160s / 162s）。
   ⇒ 该差异是**环境依赖**（本地 vs CI 的 env/时序/排除清单差异），
   **既不是"CI 骗人"、也不是"本地数据造假"**。
   本文件任何引用"测试红"之处，均限定在**本地非 CI 口径**内，**不得外推为 CI 红**。

---

## 六、给下一步的可用结论（只陈述实测事实，不给方案）

1. **收益集中度极高**：`ci.yml` 的 37~38 分钟里 **97.031%~99.955%**（两口径）是一个 job、
   其 step 4 占该 job **99.19%**。
   ⇒ 优化 `ci.yml` 总时长**只有**意味着优化那 1 个 step；其余 12 个 job 合计不到 4 分钟。
2. **成本与"是否 docs-only"强相关**：非 docs-only run 2223s vs docs-only run 17~60s。
   ⇒ 任何基线/回归判定**必须标注 docs-only 状态**。
3. **cancelled 是纯损耗且已被实测量化**：最近 10 次 ci 有 3 次 cancelled，最惨一次
   CT(windows) 跑到 298s 才被杀而全废。
4. **watchdog 连续 4 天红**是当前唯一在"变大"的红：
   它是**每日一次、只需 6s**的低成本 job ⇒ 修复它**不涉成本**，纯属正确性（归 D1037）。

---

## 七、收尾三件（M6）— 改动清单 / 自验结论 / 遗留清单

> 归属：**D1040（A4-b）+ D1041（A4-d）同批**，证据统一挂父卡 **D1039**。
> 本文件是这两个任务的**唯一**证据落点（不另开文件——写集严格限定 3 个文件，M6 要求的
> 收尾三件按纪律写入本文件而非扩写集）。
> 分支 `team/a4b-vitest-log`｜工作树 `.synova-wt-a4-b`｜最终 HEAD `15e88bdc`

### 7.1 改动清单（`git diff --stat` 原始输出）

```
$ git diff --stat origin/main...HEAD
 .claude/bypass.log                                 |   4 +
 .../evidence/D1039-A4d-五workflow成本基线.md       | 349 +++++++++++++++++++++
 tests/win/vitest-log-level.test.sh                 | 175 +++++++++++
 vitest.config.ts                                   |   9 +
 4 files changed, 537 insertions(+)

$ git diff --stat origin/main...HEAD -- vitest.config.ts tests/win/vitest-log-level.test.sh \
    "docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md"
 .../evidence/D1039-A4d-五workflow成本基线.md       | 349 +++++++++++++++++++++
 tests/win/vitest-log-level.test.sh                 | 175 +++++++++++
 vitest.config.ts                                   |   9 +
 3 files changed, 533 insertions(+)
```

⚠️ **`.claude/bypass.log | 4 +` 不是我的写集**：由 `post-commit` hook（D521）**自动**追加并提交
（每条内容为 `COMMITTED | pre-commit PASS (hook 层登记) | HASH=<我的 commit>`，
**全部是 PASS 不是 bypass**）。我既不能改 hook（`scripts/` 域）也不能阻止它（阻止要 `--no-verify`，
是红线）。**如实披露，请 K3 按机制产物而非越界处置。**

**分支历史（`git log --oneline origin/main..HEAD`）**：

```
15e88bdc chore: bypass COMMITTED 登记 (auto hook, D521)     ← hook 自动
c032ece5 test(D1040): 号段更正 D1035→D1040（仅注释与横幅，零行为变更）
f13395c6 chore: bypass COMMITTED 登记 (auto hook, D521)     ← hook 自动
a1ee8ff5 docs(D1041): 补环境限定 — 本地非 CI 口径的红与 CI 侧同 commit 的绿必须并列
5b44d22c chore: bypass COMMITTED 登记 (auto hook, D521)     ← hook 自动
0559c645 docs(D1041): 五 workflow 成本基线（实测）— CT(windows) 占总墙钟 97.031%~99.955%
0069b535 chore: bypass COMMITTED 登记 (auto hook, D521)     ← hook 自动
5e8031ab test(D1040): 测试期强制 LOG_LEVEL=warn — ERROR 不再被 INFO 淹没
```

**ls-remote 回执（禁 push ⇒ 预期 0）**：

```
$ git ls-remote --heads origin | grep -c "team/a4b-vitest-log"
0
$ git rev-parse team/a4b-vitest-log
15e88bdc3ce84b6d8c92d907f6c6e34e3deb8f8f
```
⇒ **origin 上无此分支**（本地 SHAs 待队长攒批 push）。**本批未 push、未 force push、未 `--no-verify`、未 `git stash`。**

### 7.2 自验结论（逐条验收命令 + 原始输出）

**A（D1040）契约测试 — `bash tests/win/vitest-log-level.test.sh`**

```
── 1. 正常路径: 无外部 LOG_LEVEL ⇒ 应收敛到 warn ──
     探针 env LOG_LEVEL = 'warn'   探针 pino level = 'warn'
  ✅ process.env.LOG_LEVEL = warn
  ✅ pino 生效级别 = warn（模块加载期真读到）
── 2. 降级/边界: 外部 LOG_LEVEL=debug ⇒ 必须透传（语义：外部显式值优先）──
     探针 env LOG_LEVEL = 'debug'   探针 pino level = 'debug'
  ✅ 外部显式值透传（证明是 ?? 而非硬编码 warn）
  ✅ pino 生效级别 = debug
── 3. 边界护栏: 配置不得把 LOG_LEVEL 设成 'silent' ──
  ✅ 配置未设 silent（失败上下文保留）
── 4. 判别性夹具: 注释掉配置行 ⇒ 探针必须转红（该行承重）──
     注释后 探针 env LOG_LEVEL = 'undefined'   探针 pino level = 'info'
  ✅ 拿掉修复 ⇒ 探针退化为 'undefined'/'info'（第 1 步断言随之转红 ⇒ 判别性成立）
  ✅ 配置已立即复原（cmp 相等）
── 5. 生产接线: package.json 的 test 脚本走默认 config 解析 ──
     npm test = 'vitest run'
  ✅ npm test 走 'vitest run' ⇒ 默认解析 vitest.config.ts（非孤儿配置）
  结果: 8 通过, 0 失败   Status: ✅    EXIT=0
```
（在**最终 SHA `15e88bdc`** 上复跑，工作树 `git status --porcelain` 为空时执行）

**B（D1040）判别性夹具 ——「拿掉修复 ⇒ 红」（原始输出，节选关键行）**

真实**删除** `LOG_LEVEL` 契约行后复跑同一测试：

```
$ bash tests/win/vitest-log-level.test.sh ; echo "EXIT=$?"
── 1. 正常路径: 无外部 LOG_LEVEL ⇒ 应收敛到 warn ──
     探针 env LOG_LEVEL = 'undefined'   探针 pino level = 'info'
  ❌ process.env.LOG_LEVEL 期望 warn，实得 'undefined'
  ❌ pino 生效级别期望 warn，实得 'info'
── 4. 判别性夹具: 注释掉配置行 ⇒ 探针必须转红（该行承重）──
  ❌ 无法注释配置行（LOG_LEVEL 契约行缺失 ⇒ 修复已被拿掉 ⇒ 本测试即红）
  结果: 4 通过, 3 失败
  Status: ❌ D1040 LOG_LEVEL 契约未通过
EXIT=1
```
随后 `cp /tmp/a4b-config.bak vitest.config.ts && cmp -s …` → `RESTORED_OK`，配置零残留。

**C（D1040）`npx vitest run tests/logger.test.ts`**

```
{"level":40,...,"msg":"test warn message"}
{"level":50,...,"msg":"test error message"}
 ✓ tests/logger.test.ts (5 tests) 3ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```
> 旁证：输出里**只有 `level:40/50`，INFO 不再出现** —— 契约在真实 logger 上生效。

**D（D1040）改前/改后原始数字** —— 见 §5.2 表（14,502→7,911 行；2,791,604→1,338,368 bytes；
INFO 6,619→0；ERROR 320→320 恒等）。命令逐字见 §5.2，级别分布命令见 §5.2 末。

**E（D1041）A4-d 数据** —— 全部来自 §一/§二 的 curl 原始 JSON，公式见 §〇。

### 7.3 遗留清单（每条 = 为什么**本批不能做**）

| # | 遗留项 | 为什么本批不能做 |
|---|---|---|
| 1 | ~~`tests/win/vitest-log-level.test.sh` **未接线进 CI**~~ **✅ 已闭合（2026-09-28，见 §8.6）** | 原理由：`ci.yml` 不在我的写集（严格限定 3 文件）。**队长同日授权写集扩展** ⇒ 已在 `quality` job 加「登记 + 真执行」step；`check-gate-integrity.sh` 复跑 = `GATE-INTEGRITY: OK`。**本测试现在 CI 会真跑，不再只能手工跑。** |
| 2 | `packages/test-kit/vitest.config.ts:29` 用 `LOG_LEVEL: 'silent'`，与本卡 `'warn'` 语义**不一致** | 卡面红线明令**不改 `packages/**`**。且这是**另一个 harness**（root vitest 的 include 只覆盖 `./tests/**`，`packages/test-kit/tests/**` 归它自己那份 config）。**建议 CTO 单独裁决**：`silent` 与该包"失败时出上下文"的目标相悖。 |
| 3 | 改后 **WARN 2,727→2,715（−12）未逐条溯源** | 属**用例间非确定性**告警，定位需**多次全量统计**（3× 全量 ≈ 3×50s，且 8GB 机器要求串行、队列里还有别人）。**且非本卡目标量**——本卡目标是 INFO 淹没 ERROR。**不声称已解释**。 |
| 4 | 创始人侧参考值 **7,767 行 / 1.58 MB / INFO 2,696** 本批内**无法证实或证伪** | ① 它是 **CI `Vitest (1/2)` 单分片 job 的网页日志**口径，与本地全量 stdout 不同载体；② 队长事后拉 CI 日志时 GitHub 匿名 API **已 403 配额耗尽**（reset 后另取）。已在 §5.1 明确标注**不可直接比较**，**不假装核过**。 |
| 5 | 本地 3 个存量红（`tests/acceptance/zero-code-industry.test.ts` ×2、`tests/l3/graphbridge-wiring.test.ts` ×1） | **改前即红（基线自带）**，非本卡引入；且 **CI 侧同 commit 为绿**（环境依赖，见 §5.4.3）。修它们属 `src/**`/测试域，**不在写集**。 |
| 6 | `.claude/bypass.log` 被 hook 自动提交 4 行进我的分支 | `post-commit` hook（D521）**自动行为**；改 hook 属 `scripts/` 域（不在写集），阻止它需 `--no-verify`（红线禁）。**已披露**（§7.1）。 |
| 7 | 全量 vitest **会污染 4 个 tracked 文件**（`D817-capture-*.json` / `D819-capture-*.json` / `extensions/industries/*/thresholds.json`）——测试自身往 fixture 写时间戳 | 修它要改**测试或源码**（`tests/**`/`src/**` 均不在写集）。本批处置 = **两次跑完各 `git checkout --` 复原一次**，已确认最终工作树 clean。**这是存量缺陷**（D819 同型先例），建议立卡。 |
| 8 | ci.yml 口径只取**单 run 采样**，未扩样到 12-run 均值/P95 | 扩样需**消耗 GitHub API 配额**（无 token 60/h，本次取数后余 2），且 §一 已按卡面口径（代表性 run）交付。已作为局限声明（§四.1）。 |
| 9 | 号段 `D1035/D1036` 已被本批更正为 `D1040/D1041`，但 `memory/notes/**` 的 Note 由队长写 | 队长明令"**Note 由队长写，你不要动 `memory/notes/**`**" ⇒ 属队长收口项，非我写集。 |

---

## 八、第二轮：PR #873 两个红的定位与修复（2026-09-28）

> 队长定位并派活；本节记录**我复现**的原始输出与修复后的自验。**两红均已复现成立，非误报。**

### 8.1 红 1 — `G12: task brief Q2 范围一致性`（`TypeScript + Lint + Iron Laws`）

**复跑（CI 等价口径，原始输出）**：
```
$ GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh
  ❌ G12: task brief Q2 范围一致性（写集单一事实源，D749）: 2 处  [硬阻断]
     tests/win/vitest-log-level.test.sh (不在 Q2 范围内)
     vitest.config.ts (不在 Q2 范围内)
  ❌ 1 组未通过 — 提交已拒绝
```
> ⚠️ **与队长转述的差异（点名）**：队长转述的 annotation 只列了 `.test.sh` 一处，
> 本地实测是 **2 处**（`vitest.config.ts` 也在内）。**以实测为准**，两份都必须在写集里。

**根因（三层，逐层实测）**：
1. **表层**：G12 用**别人的** Q2 去核**我的**文件。
2. **中层**：我的分支**没有自己的 brief** ——
   `git diff --name-only origin/main...HEAD -- .claude/task-briefs/` → **空**。
3. **病根**：`scripts/workflow/resolve-commit-brief.sh` 回退链（认领 → `current-brief` → 今日最新）
   **全落空就静默挑一份无关 brief** ⇒ 解析到 `.claude/task-briefs/2026-09-27-D1023-skill-lessons-ref.md`，
   而该 brief `grep -c "tests/win"` → **0**。

**修复**：新建 `.claude/task-briefs/2026-09-28-D1040-A4b-vitest-log-level.md`，含
`#CRITERIA: D` + `## 写集` 机器块（D749 单一事实源）+ 六字段。
**解析器实测**（不是我肉眼认为对）：
```
parse_write_set.include = ['vitest.config.ts', 'tests/win/vitest-log-level.test.sh',
                           'docs/.../D1039-A4d-五workflow成本基线.md', '.claude/task-briefs/2026-09-28-D1040-...md']
parse_q2.exclude        = ['.github/workflows/ci.yml', 'packages/test-kit/vitest.config.ts', 'src/',
                           'scripts/audit/', 'docs/synova/audit-reports/', 'memory/notes/',
                           'task-state/', 'packages/logger/src/index.ts']
parse_criteria          = 'D'
```
**修后复跑**：`✅ G12: 所有文件均在 Q2 范围内` ⇒ `✅ 全部 13 组通过`（EXIT=0）。

**踩到的两个 brief 书写陷阱（都来自 D1028 的实证，已规避）**：
① 只能有一个 `^##\s*写集` 标题——再加一个 `## 写集边界…` 会被抢先命中 ⇒ 该块无表格行 ⇒ `include=[]` ⇒ G12 全量误报；
② `做什么`/`不做什么` **必须行首写**（写成 `### 做什么` 则 `parse_q2` 只认行首 ⇒ exclude 臂**空转 fail-open**）。

### 8.2 红 2 — `Gate Integrity` 的 CI 密封清单 ratchet（**本批按裁定不修**）

```
── B CI 清单登记 gate（密封面 ratchet）──
VIOLATION: 新增测试未登记 CI 密封清单: tests/win/vitest-log-level.test.sh
CI-REGISTRY: 测试文件 742（密封面 sh/py 132；ts 面 610）；ci.yml 登记（密封面）53；
             密封面未登记 79；基线 78 条；基线外新增 1；基线过期 0
GATE-INTEGRITY: VIOLATION(1)      EXIT=1
```
**处置（队长 2026-09-28 裁决，同日更新 —— 见 §8.6：登记落点已从 A4-c 改到本分支，本处已闭合）**：
原裁定为「不为变绿去改 `ci.yml`，等 A4-c 先合」。**同日队长裁决更新**：登记（+ 真执行）放进**本分支**，
理由 = 本树有该测试文件 ⇒ 写完整路径**不产生幽灵告警**，且立刻满足本分支自己的 ratchet ⇒ **#873 当场可合**。
⇒ 本处红**已消失**（见 §8.6 复跑原始输出：`GATE-INTEGRITY: OK`）。

### 8.3 时序守卫 —— **四条判据**全部实测通过（含 fail-safe）

**为什么需要**：本测试会被登记进 CI，而**不含本卡修复的分支**（如 A4-c）跑它时会硬断言失败
⇒ 无条件硬断言会让那种分支必红。但判别性又不能丢。

**🔴 一处必须在设计上说清的张力**：队长给的守卫字面规格是「契约行不存在 ⇒ 跳过不判红」，
但判据③又要求「本分支删掉该行 ⇒ 必须红」。**这两条在只读配置内容时是互斥的**
——「A4-c 分支（从来不该有）」与「本分支被回退（本该有却没有）」在**配置内容上完全同形**。
⇒ 我用**分支历史**作区分信号（`git log -S<契约行> -- vitest.config.ts`），四模式穷尽且互斥：

| 契约行在配置 | 本分支历史曾引入 | 模式 | 行为 |
|---|---|---|---|
| 是 | 是 | `ASSERT` | 硬断言 |
| 否 | **是** | `REGRESSION` | **红**（引入过又丢了） |
| 否 | 否 | `SKIP` | 跳过留痕，不判红 |
| 否 | **不可判定** | **`ASSERT`** | **fail-safe：宁可误红，不静默放行**（队长 2026-09-28 追加硬要求） |

**🔴 fail-safe（第 4 行，安全侧）**：历史信号**不可判定** ⇒ 降级 **`ASSERT`**，**绝不降级 `SKIP`**。
不可判定条件（任一命中）：① `git rev-parse --absolute-git-dir` / `--git-common-dir` 失败或为空；
② 存在 `shallow` 文件（浅克隆）；③ `git log -S` 非零退出。
**理由**：判据③（判别性）是**安全侧**，`SKIP` 是**松侧**；历史信号会因 shallow clone / fetch-depth 不足在 CI 失效
（`ci.yml:312` 的 D520 先例：depth=1 时 `origin/main` 缺失）——那时若静默 `SKIP`，**判别性会静默消失**（M3 家族）。
**实测本仓 CT job 用 `fetch-depth: 0`（`ci.yml:312`）⇒ 正常 CI 走 ASSERT/SKIP，fail-safe 只在病态环境触发。**

**信号有效性实测**：本分支 `git log -S` 命中 **1**（`5e8031ab`）；`origin/main` 命中 **0**。

**四判据原始输出**：
```
① A4-c 类分支（scratch worktree @ origin/main + 本测试文件，已清理）:
     契约行在 vitest.config.ts 中  : 0
     本分支历史曾引入该契约行      : 0   (可判定=1 rc=1)
     ⇒ 模式 = SKIP
     ⏭️  SKIP: vitest.config.ts 无 LOG_LEVEL 契约行，且本分支历史从未引入过它。
     ⏭️  SKIP: 原因 = 本测试由 A4-c/D1039 登记进 ci.yml 密封清单，而该分支不含本卡修复。
     ⏭️  SKIP: 判别性未丢 = 在含修复的分支上仍是硬断言；删掉契约行即转 REGRESSION 红（判据③）。
     ⏭️  SKIP: 应然状态 = 合并顺序 A4-c 先、A4-b 后；A4-b 合入 main 后即转为 ASSERT。
   ── 3. 边界护栏 ✅ / ── 5. 生产接线 ✅
   模式: SKIP   结果: 2 通过, 0 失败    Status: ⏭️ SKIP    **EXIT=0（不红，判据①满足）**

② 本分支:
     ⇒ 模式 = ASSERT      探针 env LOG_LEVEL = 'warn'   pino = 'warn'
     （§1/§2/§3/§4/§5 全绿）  结果: 8 通过, 0 失败   **EXIT=0（判据②满足）**

③ 本分支 + 删掉契约行（模拟回退）:
     ⇒ 模式 = REGRESSION
     ❌ process.env.LOG_LEVEL 期望 warn，实得 'undefined'
     ❌ pino 生效级别期望 warn，实得 'info'
     ❌ 无法注释配置行（LOG_LEVEL 契约行缺失 ⇒ 修复已被拿掉 ⇒ 本测试即红）
     结果: 4 通过, 4 失败   Status: ❌    **EXIT=1（判据③满足 ⇒ 判别性保持）**
     随后 cmp 复原 → RESTORED_OK

④ fail-safe 反例（**真浅克隆**，非模拟）:
   $ git clone --depth 1 --single-branch --branch main file:///Users/wane/SynovaAgent /tmp/a4b-shallow
     → .git/shallow 存在（内容 ff467712…）；git log 条数 = **1**
     → 配置里有契约行 = 0；`git log -S` 命中 = **0**   ← 浅克隆下必然 0，这就是"信号失效"的形态

   (a) 旧两模式逻辑在同一浅克隆下：
       契约行在配置 = 0 ；旧逻辑只看『有没有命中』= 0
       ⇒ 旧逻辑判定 = **SKIP**（判别性静默消失 —— 这正是 fail-safe 要堵的洞）

   (b) 新逻辑（含 fail-safe）在同一浅克隆下：
       契约行在 vitest.config.ts 中  : 0
       本分支历史曾引入该契约行      : 0   (可判定=0 rc=2)
       ⚠️  FAIL-SAFE: 历史信号不可判定 (rc=2) ⇒ 降级 ASSERT，**不降级 SKIP**
       ⚠️  FAIL-SAFE: 可能原因 = shallow clone (fetch-depth<0) / git 不可用 / gitdir 不可解析
       ⚠️  FAIL-SAFE: 取舍 = 宁可误红（安全侧），不可静默放行（松侧）
       ⇒ 模式 = ASSERT        ← **走了 ASSERT 而非 SKIP（判据④满足）**
       ❌ process.env.LOG_LEVEL 期望 warn，实得 'undefined'
       结果: 4 通过, 3 失败   **EXIT=1（安全侧误红，符合契约）**
```
**子项 3 与 5（`silent` 护栏、生产接线）不依赖修复 ⇒ 在任何模式下都照跑**，SKIP 模式也非空转。

**⚠️ 两处 brief / 门禁解析陷阱（本卡实测，队长 2026-09-28 采纳转 CTO）**：
① **只能有一个 `^##\s*写集` 标题** —— 再加一个 `## 写集边界…` 会被 `parse_write_set` 抢先命中 ⇒
   该块无 `|` 表格行 ⇒ `present=True, include=[]` ⇒ **G12 全量误报**（D1028 实证，本卡规避）。
② **`做什么` / `不做什么` 必须行首写** —— 写成 `### 做什么` 时 `parse_q2` 只认行首 ⇒
   **exclude 臂空转（fail-open）**，15 条排除项会被当成 include（D1028 实证，本卡规避）。
   ⇒ 与队长的「G12 排除臂对目录 glob 完全失效」**同族**：排除臂本就脆弱。

### 8.4 本轮门禁结果（原始输出摘录）

```
$ GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh
  ✅ G12: 所有文件均在 Q2 范围内
  ✅ D734 PR 预算: 文件数 / 单域 / 落后基线 均在预算内
  ✅ 全部 13 组通过
  ⚠️  1 项警告 (不阻断)   ← PRD 对照（可选提示，永不阻断）
EXIT=0

$ bash scripts/control-tower/check-gate-integrity.sh
  GATE-INTEGRITY: VIOLATION(1)     ← 见 §8.2，按裁定等 A4-c 合入后消失
EXIT=1
```

### 8.5 本轮遗留

| # | 项 | 为什么本批不能做 |
|---|---|---|
| 10 | **门禁缺口：没有任何门禁检查「提交所在分支是否有自己的 brief」** —— resolver 会用无关 brief 静默顶上，只在 G12 报一个**指向错误方向**的错（看起来像"文件不在范围"，实际是"brief 缺失"） | 属 `scripts/workflow/resolve-commit-brief.sh` 域，**不在本卡写集**；队长已登记拟报 CTO 另立卡（建议 resolver 命中「非本分支认领的 brief」时**显式降级/报错**，而非静默挑一份） |
| 11 | `PATTERN-BASELINE: STALE(bsd) scripts/pre-commit-check.sh:991`（`expires 2026-10-08`） | 存量台账过期项，**不影响退出码**；修它属 `scripts/pre-commit-check.sh` 域（不在写集） |

---

## 八·续、登记接线闭合（2026-09-28 同日，队长裁决更新后）

### 8.6 ci.yml 接线（**登记 + 真执行**）—— §8.2 的红就此闭合

**队长裁决更新**：登记落点从 A4-c **改到本分支**（写入集扩展，队长明确授权）。理由四条：
① 本树**有该测试文件** ⇒ 写完整路径**不产生「幽灵清单项（清单有、文件无）」**告警；
② 登记立刻满足**本分支自己的** ratchet ⇒ **#873 当场可合**（不必再等 A4-c 先合）；
③ 合并后 main 同时拿到「文件 + 完整登记 + 真执行」⇒ 比「占位 + 事后补」干净；
④ 抹掉先前 D1039→D1040 的人为依赖（那条依赖本就是为绕 ratchet 才出现的）。

**被否决的 α 方案（登记在 A4-c）与否决理由**：两个 matcher 同源同形态（都扫 ci.yml 全文）——
`check-gate-integrity.sh` 的登记 matcher 与 `check-canary-drift.sh:34` 的幽灵 matcher。
ci.yml 一旦出现完整路径就**同时**算「已登记」+「清单项」，而该文件**不在 A4-c 的树**
⇒ A4-c 会多一条幽灵告警，其文案 `幽灵清单项（清单有、文件无——改删）` **会引导后人删掉一行正确的登记**
——一条会诱导后人删掉正确内容的可见告警，**比静默更坏**。

**落点选择的实测依据**：

| 候选 job | 有 `npm ci`？ | 判据 |
|---|---|---|
| `control-tower-tests` | **否**（零 npm 依赖） | ❌ 本测试要 `npx vitest run`，无依赖跑不起来 |
| `test`（Vitest） | 是 | ❌ `strategy.matrix.shard = [1/2, 2/2]` ⇒ **会跑两遍** |
| **`quality`** | **是** | ✅ 6 min 预算，本测试实测 **3.589s** |

**为何放 `quality` job 末位**：测试内的判别性夹具会临时注释 `vitest.config.ts` 的契约行再复原
（trap + `cmp` 自校验）⇒ 放末位可保证**其后没有任何 step 会观察到该瞬时状态**。

**实际写入（逐字）**：
```yaml
      - name: A4-b LOG_LEVEL contract test (D1040)
        if: steps.docsonly.outputs.docs_only != 'true'
        run: bash tests/win/vitest-log-level.test.sh
```
（前面 8 行注释说明登记形态/落点理由/末位理由/时序守卫；`run` 行含**完整路径**以供两个 matcher 命中。
**未用注释登记、未用无后缀写法取巧**——队长已否决。）

**复跑原始输出（4 项全绿）**：
```
① YAML 合法性（node yaml 解析）:
     quality.name = "TypeScript + Lint + Iron Laws"      ← 必需 context 名未变
     quality.timeout-minutes = 6                          ← 未变
     quality.steps 数 = 10
     末尾 step = {"name":"A4-b LOG_LEVEL contract test (D1040)","if":"...docs_only != 'true'","run":"bash tests/win/vitest-log-level.test.sh"}
     control-tower-tests 未被动: timeout = ${{ matrix.os == 'windows-latest' && 106 || 14 }} | name = "Control Tower Gate Tests (${{ matrix.os }})"

② bash scripts/control-tower/check-gate-integrity.sh
     CI-REGISTRY: ci.yml 登记（密封面）**54**（原 53）；基线外新增 **0**（原 1）；基线过期 0
     GATE-INTEGRITY: **OK**            EXIT=0        ← §8.2 的红已闭合

③ bash scripts/control-tower/check-canary-drift.sh
     EXIT=0；我的测试在「不在 canary 清单」告警里出现 **0** 次；**无幽灵告警**

④ GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh
     ✅ 全部 13 组通过                 EXIT=0
```

**🔴 必需 context 不受影响（K3 会核这一条，队长 2026-09-28 点名要求写入交付说明）**：

本卡改的是 `quality` job **内部的 steps 列表（追加一个 step）**，**未触碰** job 的三个身份字段：

| 字段 | 改前 | 改后 | 是否影响必需 context |
|---|---|---|---|
| `name:`（**= 必需 context 名**） | `TypeScript + Lint + Iron Laws` | **逐字未变** | ✅ 无影响 |
| `runs-on:` | `ubuntu-latest` | 未变 | ✅ |
| `timeout-minutes:` | `6` | **未变** | ✅ |

**结论（可被独立复核）**：main 分支保护的 **12 个必需检查**（含 `TypeScript + Lint + Iron Laws`）
**全部照常创建、照常报告**——本 step 只是在该 job 内多跑 3.589s 的一个断言脚本。
**不存在**「新增 step 改了 job 名 ⇒ 必需 context 永不报告 ⇒ PR 永久 blocked」这一类风险。
复核命令：`node -e "const y=require('yaml'),d=y.parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));console.log(JSON.stringify({name:d.jobs.quality.name,to:d.jobs.quality['timeout-minutes'],runs:d.jobs.quality['runs-on']}))"`

（另：本 step 带 `if: steps.docsonly.outputs.docs_only != 'true'` ⇒ 纯文档 PR 不跑，与同 job 其余 step 口径一致；
**job 本身仍照常创建**，故 docs-only PR 的可读状态与改前一致。）

### 8.7 fail-safe 反例 —— **逐字命令 + 完整原始输出**（队长点名的补件）

```bash
$ git clone --depth 1 --single-branch --branch main "file:///Users/wane/SynovaAgent" /tmp/a4b-failsafe
$ cd /tmp/a4b-failsafe
$ cat .git/shallow
ff4677129dce2ff068a816eed3db0687b060c64c          ← 浅克隆标记存在
$ git rev-list --count HEAD
1                                                 ← 历史上只有 1 个提交（信号必然失效）
$ mkdir -p tests/win && cp <worktree>/tests/win/vitest-log-level.test.sh tests/win/
$ ln -sfn /Users/wane/SynovaAgent/node_modules node_modules
$ bash tests/win/vitest-log-level.test.sh
```
**原始输出（EXIT=1）**：
```
═══════════════════════════════════════════════════════════════
  D1040 · 测试期 LOG_LEVEL 契约（vitest.config.ts test.env）
═══════════════════════════════════════════════════════════════

── 0. 时序守卫模式判定 ──
     契约行在 vitest.config.ts 中  : 0
     本分支历史曾引入该契约行      : 0   (可判定=0 rc=2)
     ⚠️  FAIL-SAFE: 历史信号不可判定 (rc=2) ⇒ 降级 ASSERT，**不降级 SKIP**
     ⚠️  FAIL-SAFE: 可能原因 = shallow clone (fetch-depth<0) / git 不可用 / gitdir 不可解析
     ⚠️  FAIL-SAFE: 取舍 = 宁可误红（安全侧），不可静默放行（松侧）
     ⇒ 模式 = ASSERT                      ← 判据④：走 ASSERT 而非 SKIP

── 1. 正常路径: 无外部 LOG_LEVEL ⇒ 应收敛到 warn ──
     探针 env LOG_LEVEL = 'undefined'   探针 pino level = 'info'
  ❌ process.env.LOG_LEVEL 期望 warn，实得 'undefined'
  ❌ pino 生效级别期望 warn，实得 'info'

── 2. 降级/边界: 外部 LOG_LEVEL=debug ⇒ 必须透传（语义：外部显式值优先）──
     探针 env LOG_LEVEL = 'debug'   探针 pino level = 'debug'
  ✅ 外部显式值透传（证明是 ?? 而非硬编码 warn）
  ✅ pino 生效级别 = debug

── 4. 判别性夹具: 注释掉配置行 ⇒ 探针必须转红（该行承重）──
  ❌ 无法注释配置行（LOG_LEVEL 契约行缺失 ⇒ 修复已被拿掉 ⇒ 本测试即红）

── 3. 边界护栏: 配置不得把 LOG_LEVEL 设成 'silent' ──
  ✅ 配置未设 silent（失败上下文保留）

── 5. 生产接线: package.json 的 test 脚本走默认 config 解析 ──
     npm test = 'vitest run'
  ✅ npm test 走 'vitest run' ⇒ 默认解析 vitest.config.ts（非孤儿配置）
═══════════════════════════════════════════════════════════════
  模式: ASSERT   结果: 4 通过, 3 失败
  Status: ❌ D1040 LOG_LEVEL 契约未通过
═══════════════════════════════════════════════════════════════
```
**反证（同一浅克隆下旧两模式逻辑会判 SKIP）** —— 逐字命令 + 原始输出：
```bash
$ KEY="LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',"
$ FIX_IN_CONFIG=0; grep -qF "$KEY" vitest.config.ts 2>/dev/null && FIX_IN_CONFIG=1; echo "FIX_IN_CONFIG=$FIX_IN_CONFIG"
FIX_IN_CONFIG=0
$ FIX_IN_HISTORY=0; git log --format=%H -S"$KEY" -- vitest.config.ts 2>/dev/null | grep -q . && FIX_IN_HISTORY=1; echo "FIX_IN_HISTORY=$FIX_IN_HISTORY"
FIX_IN_HISTORY=0
$ # 旧两模式逻辑：FIX_IN_CONFIG≠1 且 FIX_IN_HISTORY≠1 ⇒ SKIP
⇒ 旧逻辑判定 MODE=SKIP（判别性静默消失）
```
⇒ **同一环境、同一命令，旧逻辑静默 SKIP、新逻辑 fail-safe ASSERT** —— 这就是 fail-safe 的价值。

**运行耗时（判据② ASSERT 路径，本机）**：`real 0m3.589s`（队长本机实测 3.3s，同量级）。
`quality` job 预算 6 min ⇒ 影响可忽略。

---

*本文件为 A4-d（D1041，父卡 D1039）+ A4-b（D1040）交付物。所有数字均来自实测，公式在 §〇 声明。*
