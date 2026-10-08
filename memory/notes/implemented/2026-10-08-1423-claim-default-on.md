# 2026-10-08 · 卡 #1423（D-C 最后一刀）`SYNO_CLAIM_V2` 默认翻「开」

- 状态: implemented（创始人 2026-10-08 裁决「**一步到位**，但是**现在还带 D 的任务也不要影响他们合并**」）
- 决策人: 创始人（原话如上）；执行: line-g-parser（Lead 分工: 开关翻面 + 反例夹具；`alloc-task-id` 由 Lead 负责）
- 依据: 卡 #1423；前置 #1353（唯一变量对照）/#1363（helper 前提点名）/#1365（身份显示口径）

## 本件做什么（一句话）

把 `SYNO_CLAIM_V2` 从「默认关」翻为「**默认开**」—— 新任务以 **issue 号身份 + `.claude/claims/<issue>.yaml`**
声明为默认路径（"禁新建 D#"的机制落地）；同时用一条**最小守护**保证**存量 D# 任务照旧可提交/可合并**
（"保存量 D#"）。

## 翻面点（5 处，口径统一）

| 层 | 位置 | 口径 |
|---|---|---|
| 单一事实源 | `claim_store.claim_v2_enabled()` | 未设 ⇒ **True**；truthy ⇒ True；**其它值（含 0/off/false）⇒ False = 唯一回滚点** |
| 提交端 | `pre-commit-check.sh` | 同上（`''|1|true|on|yes|y ⇒ 1`，其余 ⇒ 0） |
| 声明解析 | `workflow/resolve-commit-brief.sh` | 同上 |
| Done 对账 | `check-verifiable-done.sh` | 同上 |
| 散文校验 | `check-brief-vs-code.sh` | 同上 |

回滚语义保留：**显式 `SYNO_CLAIM_V2=0` ⇒ 逐字节 legacy**（组 12 的守护段在关态**不可达** ⇒ 与改前逐字一致）。

## 判据③（创始人那句话的机器判据）—— 反例守护

**实测风险（本件先测后改）**: 开关默认开后，D1220 的「claim 模式 ∧ 无 legacy 载体 ⇒ 硬红」
分支变成**默认可达**；而 D# 在飞任务的 brief 若落在 ±1 天窗口外（**跨日任务常态**），
`ALL_TODAY_BRIEFS` 为空 ⇒ 被误判"本提交无 legacy brief 载体" ⇒ **拦死在飞合并**（创始人明令禁止）。
现场实测（沙箱，窗口外 D# brief）：输出 `未被任何 claim 声明覆盖；且本提交无 legacy brief 载体`。

**最小修法**（`pre-commit-check.sh` 组 12，守护段）: 开关**开**时，把 resolver 已定位到的
**legacy 声明**（非 `.yaml`）并入 legacy 判定集 ——
- 判定力不降：该文件仍要过它的 Q2 写集/排除项（只是不再"看不见它"）；
- claim 载体（`*.yaml`）**不并入** ⇒ D1220 对 claim 用户的牙齿保留；
- 开关**关**时守护段不可达 ⇒ 回滚态逐字节不变。

## 判据（16 断言，含两处变异体）

**落位说明（守 D734 的 12 文件 PR 预算）**：本件判据**并入既有夹具**
`tests/control-tower/precommit-claim-wiring.test.sh`（该文件本就是"开关 × 组 6/12"的夹具），
不新开文件、不动 FACE-TOTAL（无新增测试文件 ⇒ sealed-tests 余量不变）。

```bash
bash tests/control-tower/precommit-claim-wiring.test.sh     # 46 通过 0 失败（含 #1423 全段）
#   §1 单一事实源三态（未设 on / 显式 0 off / 显式 1 on）
#   §2 四处 bash 口径一致（防漏改漂移）
#   §3 判据③ 反例: 窗口外 D# brief + 开关未设 ⇒ 组 12 判绿（在飞 D# 不被拦）
#      §3-M 变异: 中和守护段 ⇒ 「无 legacy 载体」误拦复现 ⇒ §3 必红（守护是承重点）
#   §4 判据④ 正向: claim 新格式端到端 ⇒ resolver 返回 claim + 组 6 走 claim 分支
#      §4-M 变异: 显式回滚 ⇒ 新格式报「今日无 task brief」不可提交 ⇒ 默认开是承重点
#   §5 回滚语义: 显式 0 ⇒ 组 12 逐字节 legacy（守护段不可达）
```

## 判据变更面（须 K3 批八过审）

1. **默认翻面**：`SYNO_CLAIM_V2` 未设 ⇒ 开（原为关）。回滚点仍是显式 0。
2. **两处既有断言翻面**（它们在钉旧默认，属"判据"而非"实现"）：
   - `tests/control-tower/claim-identity-v2.test.py`（4 处：默认断言翻面 + 3 处**回滚态场景显式关**）；
   - `tests/control-tower/precommit-claim-wiring.test.sh`（默认断言翻面 + 新增"显式 0 ⇒ off"回滚断言）。
   说明：这不改变这些用例的**意图**（守 legacy 链/守卫减法/回滚语义），只把它们从"依赖默认关"改为"显式声明回滚态"。
3. **组 12 守护段**（新增）：开关开时把 resolver 定位到的 legacy 声明并入 legacy 判定集
   —— 新可达路径，但只把"窗口外 brief"从"不可见"改为"按既有规则判定"（不新增判据、不放松）。
4. **棘轮零改动**：本件**不新增测试文件**（判据并入既有夹具）⇒ `# FACE-TOTAL` 无需上调、
   sealed-tests 余量不变（原拟新增夹具时曾触发 "余量 11 > SLACK-CAP 10"，改用并入方式规避）。

## 未做（诚实列）

- **不删 `infer_did`**（创始人明令）：存量 D# 链**只读保留**；删它 ⇒ 在飞 D# 任务在**合并级立刻 fail-closed**
  ⇒ 正是被禁止的后果。存量清零后另卡再删。
- 不改 `alloc-task-id.sh`（Lead 负责：新号断流 + 通告）。
- 不改 `ci.yml` / `scripts/audit/**` / `check-gate-integrity.sh`。

## 追加（CI 面）: 分离头检出下 claim 不可达 —— "新格式只在本机成立"的真因

**现象**：本 PR 的 CI `TypeScript + Lint + Iron Laws` / `Gate Integrity` 红，首错
`❌ Done 可证伪性: 声明 …/2026-10-08-1398-field-truth-source-b1b.md 无 Done 条目`。

**实测判据链（三步，可复跑）**：
1. CI 的 PR 检出是**分离头（detached HEAD）** ⇒ `git branch --show-current` 为空 ⇒
   resolver 的 `ISSUE_HINT` 为空 ⇒ **本任务 claim 在 CI 不可达**（本地有分支名 ⇒ 可达 ⇒ **只在本机成立**）。
2. resolver 遂走**日期回退**（D317 兜底）⇒ 取一份**与本 PR 无关**的今日 brief 当声明：
   CI（合并树）取到 `2026-10-08-1398-*.md`（该 brief 无 Done 条目 ⇒ 判 Done 失败）；本地分离头复现取到 `1408-*.md`。
3. ⇒ **与"我的 Done 段格式"无关、也与开关翻面无因果**（该回退在开关两种状态下都会发生）。

**修法（同批，判据变更面 ④）**：`resolve-commit-brief.sh` 的 `ISSUE_HINT` 在为空时补
**`GITHUB_HEAD_REF`**（GH Actions 的 PR **源分支**名）—— 实测：分离头 + `GITHUB_HEAD_REF=feat/<issue>-…`
⇒ 返回 **claim** ✓；不带 hint ⇒ 退回无关 brief ✓（判别成立）。
**刻意不用 `GITHUB_REF_NAME`**：PR 下它是 `<PR号>/merge`，**PR 号 ≠ issue 号** ⇒ 会指向错 claim（比没有更坏）。

**对存量 D# 的影响：零**。D# 分支名（如 `feat/D1245-…`）不产 issue 号 ⇒ 不命中 claim ⇒ 逐字节 legacy ✓
（创始人约束"保存量 D#"仍成立）。
