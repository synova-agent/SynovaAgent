---
id: DOC-0144
日期: 2026-10-05
线: 治理线
类型: 判据文档
状态: 待裁（随 D1159 送 K3 → CTO）
---

# D1159 · 必需 context 变更顺序 — 判据与检查（放宽允许先行 / 收紧必须等 PR 合并后）

> 上游：K3 门禁治理波次审计报告 `~/synova-k3-audit/audit-reports/2026-10-05-k3-审计报告-门禁治理波次-D1145-D1149.md`
> §三 防线缺口收割第 4 行（"branch protection 先于 PR 变更 → 无对账门禁"）+ §总判定 #1077（顺序风险）
> 实例：**#1077（`afde93eae`）— branch protection 先行 PATCH 到 9 而 PR 未合并**
> 实现：`scripts/control-tower/check-required-contexts-order.py`（只读，三态）+ 配对测试 `tests/control-tower/check-required-contexts-order.test.sh`

---

## 🔴 定性声明（**读本件前先读这一句**）

> **本件是【检查件】，不是【门禁】。今日它不阻断任何东西。**

请勿把本件读成"必需 context 已经被看住了"。以下两条为**当前事实**（不是计划，不是期望）：

1. **今日零真实阻断执行方** —— `scripts/control-tower/check-required-contexts-order.py` 的生产调用点 = **0**。
   逐面排查（全 0）：pre-commit ｜ pre-push ｜ `scripts/hooks/` + `.git/hooks/` ｜ CI `run:` 段（排除密封清单登记行）｜
   `package.json` ｜ cron / launchd。全仓引用 14 行，逐行落点 = 脚本本体 / 其配对测试 / `task-state` / `.codex` 元数据 /
   `ci.yml` 两行（**登记的是"测试文件"，不是调用脚本**）⇒ **本器目前只被自己的配对测试执行**，**不挡任何 PR**。
   复跑命令（读者可直接核）：
   ```bash
   grep -rn 'check-required-contexts-order' --include='*.sh' --include='*.yml' --include='*.yaml' \
        --include='*.py' --include='*.json' --include='*.ts' . | grep -v node_modules
   ```
   排查表全文（含每一面的单条命令）= task brief「附二.1」。
2. **放宽方向无收敛机制** —— 判据刻意不对称（`live ⊆ 登记表 ⇒ OK`）方向成立，但**无棘轮 / 无高水位 / 无历史 / 无状态文件**
   ⇒ live 从 12 降到 9 之后，一旦 `live == 登记表`，那次弱化就**彻底不可见**（无警报、无收敛要求）。
   实测：脚本内 `ratchet|高水位|history|\.state` → **0 命中**；唯一写操作 = `tempfile.mkstemp`（读 `git show` 用，随即 `unlink`）
   ⇒ **无任何持久状态**。实跑：`--base-ref 'afde93eae^'` 逐条点名 3 条放宽项 + 打印动机锚点 #1077 → **`REQUIRED-CONTEXTS-ORDER: OK`（exit 0）**
   ⇒ 可见性**依赖人主动跑 + 主动读**。
   **待立卡**：「必需 context 保护高水位 / 只减不增棘轮」（不把"移除必需"改成违规；复刻 `gate-integrity-baseline.txt`
   的 `[R] 条数` 棘轮形态或持久化高水位报警）—— **语义变更 ⇒ 走 K3**。

> **要让本器真挡人**，须先立"接入哪条链 + 三态码怎么用"的卡 —— 本件**不做**（避免新件变成**暗中生效**的门禁）。
> 依据：K3 审计 P1①（放宽永久免罪）/ P1②（零真实执行方），复核席已独立复现；处置采 CTO 对 #1107 的先例（如实声明 + 立卡）。

---

## 一、判据（一句话）

**共享基础设施的分支保护，只允许朝"更松"的方向先行；朝"更紧"的方向必须等携带该变更的 PR 合并之后。**

判定对象只有三个集合：

| 记号 | 含义 | 来源 |
|---|---|---|
| **L**（live） | 当前 branch protection 的必需 context 集 | `gh api repos/<repo>/branches/<branch>/protection`（**只读 GET**） |
| **M**（main 登记态） | base-ref（默认 `origin/main`）里 `required-checks-baseline.txt` 的登记集 | `git show <base-ref>:scripts/control-tower/required-checks-baseline.txt` |
| **C**（候选） | 工作树登记表（本 PR 将要做的变更） | 工作树文件 |

## 二、判定表

| 情形 | 判定 | 退出码 | 为什么 |
|---|---|---|---|
| L == M | 一致 | 0 | 无可判定漂移 |
| **L ⊂ M**（live 少了） | **放宽在途（合法）** — 逐条点名 | 0 | **移除必需永不阻断**：只会让门禁变松，不卡任何在飞 PR；且可随时 PATCH 回来 |
| **L ⊃ M**（live 多了） | **收紧先行（违规）** — 逐条点名 + 处置 | **1** | 产出该 check-run 的 job 尚未随已合并变更进入 base ⇒ **未含该 job 的在飞 PR 永不上报该 check-run ⇒ 永久 blocked**（D971 同型事故：`405 "N of N required status checks are expected."`） |
| C ≠ M | **信息级**（不判违规） | 0 | C 是"意图"，L 是"事实"；**判事实**。C∖M 打印「须先合并再 PATCH live」，M∖C 打印「可先行 PATCH live」 |
| 取数/判据源不可得 | **降级** | **2** | fail-closed：gh 不可用、base-ref 不可解析、登记表不可读/0 条/畸形、复用面缺失 ⇒ **不判绿** |

### 为什么这条不对称是刻意的

- 放宽（移除必需）：唯一的代价是"少卡了一道"，可观测、可回滚、不阻塞任何人 ⇒ 允许先行。
- 收紧（新增必需）：代价是**在飞 PR 集体卡死**，且只能靠人工 PATCH 解 —— 更贵、更隐蔽。
  ⇒ 必须等"产出该 check-run 的 job"已经进 base（同一 PR 内更新登记表），再 PATCH live。

### 与相邻检查的分工（不重叠、不重造）

| 检查 | 回答的问题 |
|---|---|
| `check-required-contexts.py` | ① 必需集 ⊆ 本仓可产出集（job `name:` 改动即失配）；② live ⇄ **登记表**是否**一致**（双向，任一侧差集即违规） |
| **`check-required-contexts-order.py`（本件）** | 同一个"不一致"，**方向是哪一边**、这个方向**允不允许**（放宽允许 / 收紧禁止） |

⇒ 本器**复用** peer 的 live 取数（含 gh 缺失/超时/形状不符的降级语义）、登记表解析（schema/畸形即降级）、差集原语；
不重造、不复制实现。判别性已物理锁住：同一份"放宽在途"数据，**本器 0 / peer 1**（测试用例 ② 逐条断言）。

## 三、可复跑命令

```bash
# 当前态（真仓，需 gh 读权限；CI 的 github.token 无 admin ⇒ 会降级 exit 2，属预期）
python3 scripts/control-tower/check-required-contexts-order.py

# 历史实例复现（#1077 前一刻：live=9 而登记表=12 ⇒ 放宽在途，逐条点名 3 条）
python3 scripts/control-tower/check-required-contexts-order.py --base-ref 'afde93eae^'

# 只判不判（打印三份清单）
python3 scripts/control-tower/check-required-contexts-order.py --verbose

# 配对测试（沙箱化，零网络，stub gh 注入）
bash tests/control-tower/check-required-contexts-order.test.sh
```

### 期望输出（2026-10-05 实测）

```
$ python3 scripts/control-tower/check-required-contexts-order.py
取数: live=9 条（gh api …/protection，只读 GET）｜origin/main 登记表=9 条｜候选登记表=9 条
  OK: live 与 origin/main 登记表逐字一致（9 条，零差集）
REQUIRED-CONTEXTS-ORDER: OK                                  # exit 0

$ python3 scripts/control-tower/check-required-contexts-order.py --base-ref 'afde93eae^'
取数: live=9 条 ｜ afde93eae^ 登记表=12 条 ｜候选登记表=9 条
  🟢 放宽在途（合法）: live 已不再要求「Control Tower Gate Tests (windows-latest)」（…属放宽先行）
  🟢 放宽在途（合法）: live 已不再要求「Test-Kit Architecture Tests (windows-latest)」（…属放宽先行）
  🟢 放宽在途（合法）: live 已不再要求「npm audit」（…属放宽先行）
REQUIRED-CONTEXTS-ORDER: OK                                  # exit 0（放宽允许先行）

# 收紧先行的反例（测试用例 ③，stub 注入）：live 多出一条 ⇒
VIOLATION: 收紧先行: live 必需 context「…」不在 <base-ref> 登记表里 —— …永久 blocked（D971 同型 405）。处置: 先把产出该 check-run 的变更合并进 <base-ref>（并同 PR 更新登记表），**再** PATCH live。
REQUIRED-CONTEXTS-ORDER: VIOLATION(1)                        # exit 1
```

## 四、三态退出码（不可混同）

- `0` = 顺序合法（一致，或仅放宽）
- `1` = 违规（收紧先行；逐条点名 + 处置）
- `2` = 执行失败/降级（**绝不等于通过**）：gh 不可用/未登录/超时/JSON 形状不符、base-ref 不可解析或无登记表、
  登记表不可读/0 条/畸形、复用面（`check-required-contexts.py`）缺失或加载失败。

本器**刻意不提供** `--allow-degraded`：live 是唯一判定输入，"取数不可用"= 无法判定，给旗标只会造出免检开关
（D1111/收件修正口径：旗标不得吞违规）。CI 侧若要周期跑本检查，须用带 admin 权限的 PAT 通道（另立卡）。

## 五、只读保证（红线）

本器只做三件事：`gh api` 的 **GET**（经 peer）、`git show`、读文件。
**无** `--method`/`-X`、**无** PATCH/PUT/POST/DELETE（测试用例 ⑦ 以"去注释+去字面量后 grep"物理断言）。
branch protection 的变更权限不在治理线 —— 本器**只报不改**。

## 六、已知边界（诚实声明）

1. 只读 `required_status_checks.contexts` 的存在性，不读 `app_id`/`checks` 绑定（同 peer）。
2. 不判"必需 context 的产出 job 是否有 job 级 `if:`/`paths:` 过滤"（D971 的另一半，peer 头注释同款 TODO）。
3. `--base-ref` 仅取**登记表**（登记态），不取 base 的 ci.yml 产出集 —— "live ⊆ base 产出集"由 peer 承担。
4. `L ⊃ M` 时本器只报不改：PATCH 权限不在本线。
5. 未接入 CI 周期任务（首版为可复跑的手工/PR 期检查）；CI 化需 PAT，另立卡。
