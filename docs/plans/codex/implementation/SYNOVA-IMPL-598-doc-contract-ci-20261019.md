---
status: proposed
日期: 2026-10-19
任务: #598（闸 3 在 Gitea CI 空跑：doc-contract 无 base ⇒ 补 base ＋ fail-loud）
撰写: P4（门禁包负责人）· **独立于实现者**
依据: CTO 2026-10-19 卡（A 类）｜L1 复核事实（本件 §3）｜`dev-doc-spec` v2｜`pre-plan-thinking` 9 问
批次规模: 改 2 ＋ 新建 4（helper／配对测试／自证／Note）＋ 豁免件；预估 +170/−10 行
---

# SYNOVA-IMPL-598 · 闸 3 在 Gitea CI 空跑：补 base ＋ fail-loud

> 🔴 **本件是执行小队的唯一规格源**。**只做"让闸 3 在 CI 真跑"**：不迁 `docs/plans/**` 存量、不碰 `.github/**`、不改 §9.1 过渡表。
> 🔴 行号 as_of `ab70d634b`；若 **#595（组数口径）先合**，行号会漂移 ⇒ **按内容定位**，不按行号死盯。

---

## 封面 · 四行开场包

```
① 批次名：P4-闸3-CI-base
② 写集（逐文件；**L1 划定，L2 不得扩**）：
   - .gitea/workflows/local-gates.yml            （改：step ① 注入 SYNO_DIFF_BASE＋GITHUB_ACTIONS=true；step ①d 改用共享 helper）
   - scripts/control-tower/resolve-ci-base.sh    （<新建> CI base 解析 helper：链/规范化/物化/exit 2）
   - scripts/pre-commit-check.sh                 （改：闸 3 块 —— CI 无 base ⇒ fail loud；有 base 走 --base）
   - tests/control-tower/resolve-ci-base.test.sh （<新建> CT-40 配对）
   - tests/control-tower/doc-contract-ci-acceptance.test.sh（<新建> 自证 8 项）
   - memory/notes/proposed/2026-10-19-doc-contract-ci.md（<新建> 四态 Note）
   - gate-exemptions/2026-10-19-doc-contract-ci-598.md（<新建·创始人作者> ①d 豁免，见 §7 P2）
③ 判据（含改坏必判红）：
   - 沙箱：新增 docs/plans/** 文档 ＋ CI 模式（SYNO_CI=1 SYNO_DIFF_BASE=<base>）⇒ pre-commit **返回 1**
   - 真 PR：把临时 docs/plans 文档推进 PR 分支 ⇒ **CI 红**（贴 run 号）；删掉 ⇒ 绿（贴 run 号）
   - 本地（无 SYNO_CI）⇒ 返回 0 ＋ ⚠️ 软提示（不阻断）
   - CI（SYNO_CI=1）但无 base ⇒ **返回 1**（fail loud，禁再空跑）
④ 域守则指针（必须显式 read）：scripts/control-tower/AGENTS.md ｜ tests/control-tower/AGENTS.md ｜ .gitea/AGENTS.md ｜ memory/notes/AGENTS.md
```

---

## §〇 归属与依据（派单七问）

| # | 问 | 答 |
|---|---|---|
| 1 | 谁派 / 依据 | **CTO 2026-10-19 卡**（A 类）；Issue **#598** |
| 2 | 归属包 | **P4 门禁**（治理域）｜域：`scripts/control-tower/`、`tests/control-tower/`、`.gitea/` |
| 3 | 写集 | 见 §2（改 2 ＋ 新建 4 ＋ 豁免件） |
| 4 | 判据 | 见 §4（正常/降级/三条反例）＋ DS-1…DS-10 |
| 5 | 依赖 | **#595 先合**（顺序：S1 → #595 → 本卡）；①d 已生效 ⇒ 本卡 PR 需创始人作者豁免 |
| 6 | 不做什么 | 见 §1 非目标（逐条路径） |
| 7 | 回执 | 见 §8（R2 ≤10 行 ＋ 三信号） |

## 权威件回执（动笔前实读）

| 件 | as_of | 读了什么 |
|---|---|---|
| CTO 2026-10-19 卡 | 本会话 | 空跑事实／4 条判据／3 条边界／顺序 |
| `scripts/pre-commit-check.sh` | `ab70d634b` | `:366-390` GIT_CACHED 来源（CI 仅 GITHUB_ACTIONS+SYNO_DIFF_BASE 走 diff，否则 --cached）｜`:427-428` 无 md 跳过｜`:435-439` `--base` 条件｜`:446/:452` SYNO_CI 返回 1 |
| `scripts/control-tower/check-doc-contract.sh` | `ab70d634b` | `--files/--base/--staged`；返回 0/1/2；闸 3 = §3 阻断清单（`docs/plans/**`） |
| `.gitea/workflows/local-gates.yml` | `ab70d634b` | `:75` step ① `SYNO_CI=1 bash pre-commit-check.sh`（**无 SYNO_DIFF_BASE**）；①d 的 base 解析块（S1 交付，可抽共享） |
| 域守则 4 份 | `ab70d634b` | 三态／零失败／改门禁只认 `.gitea`／四态 Note |

---

## §〇pre · `pre-plan-thinking` 9 问（逐问有证据）

| # | 问 | 证据（命令 ⇒ 输出摘要） | 落点 |
|---|---|---|---|
| ① | 问题 | 闸 3 对 `docs/plans/**` 能判 FAIL，但 CI 里从不核（空跑）⇒ 10 月新增 5 件 dev doc 全部漏网（`gitea/local-main` 实测） | §1／§3 |
| ② | 现状 | `scripts/pre-commit-check.sh:366-390`：CI 仅 `GITHUB_ACTIONS=true && SYNO_DIFF_BASE` 时用 base diff，否则 `--cached`；workflow `:75` 从不注入 `SYNO_DIFF_BASE` ⇒ `--cached` 为空 ⇒ `STAGED_ALL` 空 ⇒ `:427-428` 直接"无文档变更（跳过）" | §3 |
| ③ | 有没有现成 | **有**：①d 已实现 base 解析（链＋物化＋裸名规范化，S1 交付）⇒ 抽成 helper 复用；`SYNO_DIFF_BASE` 注入缝是既有设计（D390 注释自述"CI gap 补齐"）；`check-doc-contract.sh --base` 已支持 | §6 |
| ④ | 最小改动 | workflow 注入 base（step ①）＋ helper ＋ 闸 3 块 fail-loud ＋ 自证；**不改 checker 判据、不动存量文档** | §2 |
| ⑤ | 最危险假设 | ①「设了 SYNO_DIFF_BASE 就行」——还需 `GITHUB_ACTIONS=true`（D390 守卫：本地忽略该缝）⇒ workflow 显式设 ②「CI 总有 base」——push 腿 base==HEAD ⇒ diff 空 ⇒ 跳过（**设计如此**，拦截在 PR 腿） ③「闸 3 只看暂存」——实测 `STAGED_ALL` 在 CI 由 GIT_CACHED 决定，故必须走 base 注入 | §2／§7 |
| ⑥ | 失败路径 | 见 §4 三条反例（沙箱 CI 模式必判红／本地必软／无 base 必 fail loud） | §4 |
| ⑦ | 边界 | 不迁 docs/plans 存量；不碰 .github；不改 §9.1；不改 checker 判据 | §1／§7 |
| ⑧ | 可观测 | 真 PR 的 CI run 号（红/绿）＋ 沙箱三态 ＋ workflow grep | §4 |
| ⑨ | 拆步 | W1 helper → W2 workflow → W3 闸 3 块 → W4 两测试 → W5 Note → W6 豁免 → 真 PR 红/绿证据 → PR | §8 |

---

## §1 做什么

**目标**：Gitea CI 的闸 3 拿到 **base diff**，对"本 PR 新增的 `docs/plans/**` 文档"真判；且**CI 拿不到 base 时 fail loud**（返回 1），永不静默退回 `--staged` 空跑。

**可观测结果**：
1. 真 PR 里加一个 `docs/plans/**` 文档 ⇒ CI **红**；删掉 ⇒ **绿**（run 号入证据）；
2. 本地提交同样的文档 ⇒ **只软提示**（返回 0）；
3. CI 无 base ⇒ **返回 1**（fail loud）。

**非目标（逐条路径）**：
- ❌ 不迁 `docs/plans/**` 存量（24 件；迁出另卡，等 CTO 批分类表）
- ❌ `.github/**`（GitHub 腿不参与）｜❌ `docs/synova/DOC-CONTRACT.md` §9.1 过渡表（`.claude/task-briefs` 那条无关）
- ❌ 不改 `check-doc-contract.sh` / `validate_doc_contract.py` 的判据
- ❌ 2.3／2.4／平台配置（S2）

---

## §2 在哪做（file:line ＋ 写集）

### W1 `scripts/control-tower/resolve-ci-base.sh`（<新建>）

契约见 C1；实现照 ①d 现有逻辑（S1 交付）抽成独立件：

```
链：SYNO_BASE_REF → GITHUB_BASE_REF → gitea/local-main
规范化：裸 local-main → gitea/local-main
物化：gitea/local-main 不可解析 且 远端恰 1 个 ⇒ git fetch <remote> '+refs/heads/local-main:refs/remotes/gitea/local-main'
校验：git rev-parse --verify -q "$BASE^{commit}" 失败 ⇒ exit 2（stderr degraded:）
输出：stdout 只打印最终 ref；只读、不写仓库
```

### W2 `.gitea/workflows/local-gates.yml`

- **step ①**（`:75` 一带）：run 开头加
  `BASE="$(bash scripts/control-tower/resolve-ci-base.sh)" || exit $?`，调用改为
  `PATH=… SYNO_CI=1 GITHUB_ACTIONS=true SYNO_DIFF_BASE="$BASE" bash scripts/pre-commit-check.sh`
  （🔴 必须显式 `GITHUB_ACTIONS=true`：`scripts/pre-commit-check.sh:378` 的 D390 守卫只在它为 true 时才用 `SYNO_DIFF_BASE`）。
- **step ①d**：把内联的 base 解析块替换为同一 helper（`BASE="$(bash scripts/control-tower/resolve-ci-base.sh)"`），其余不变。
- **不动** job 名与其它 step；不改任何 step 的既有语义。

### W3 `scripts/pre-commit-check.sh`（闸 3 块）

- 在闸 3 块（`D1193`）的 `_DC_ARGS` 选择**之前**加 fail-loud：
  ```bash
  # #598: CI 无 base ⇒ fail loud（禁静默退回 --staged 空跑）
  if [ "${SYNO_CI:-0}" = "1" ] && [ -z "${SYNO_DIFF_BASE:-}" ]; then
    soft_check "D1193 文档契约三闸: CI 无 base（fail-closed，禁空跑）" "SYNO_DIFF_BASE 未注入"
    返回 1
  fi
  ```
- 保留既有 `--base` 分支（`GITHUB_ACTIONS=true && SYNO_DIFF_BASE`）与 `--staged` 本地分支；保留 RC=1/RC≥2 的 `SYNO_CI=1 ⇒ 返回 1`。
- 不改 13 组编号/组内容（#595 负责组数口径，本卡不碰）。

### W4 测试（新建 2）

- `tests/control-tower/resolve-ci-base.test.sh`（**新建**；CT-40 配对）：沙箱 git 仓覆盖 —— ① 显式 `SYNO_BASE_REF` ② `GITHUB_BASE_REF=local-main` 裸名规范化 ③ canonical 不可解析＋单远端 ⇒ fetch 物化 ④ 多远端 ⇒ 不 fetch、exit 2 ⑤ 全不可解析 ⇒ exit 2 ⑥ 只读（跑完沙箱脏度 0）。
- `tests/control-tower/doc-contract-ci-acceptance.test.sh`（**新建**；自证）：逐项见 §4 DS；其中"沙箱 CI 模式必判红"与"本地必软"必须真跑 `pre-commit-check.sh`（纯文档暂存 ⇒ 闸 3 后即早退，秒级）。

### W5 `memory/notes/proposed/2026-10-19-doc-contract-ci.md`（**新建**；四态 Note）

### W6 `gate-exemptions/2026-10-19-doc-contract-ci-598.md`（**必须创始人作者**）

---

## §3 凭什么做（事实，全部可复跑）

| # | 事实 | 命令 ⇒ 原始输出（摘要） |
|---|---|---|
| F1 | 闸 3 能拦 | `bash scripts/control-tower/check-doc-contract.sh --files docs/plans/codex/implementation/SYNOVA-IMPL-595-gate-count-20261019.md` ⇒ `[FAIL] 闸 3 · 入库闸`「命中契约 §3 阻断清单 docs/plans/**」**返回 1** |
| F2 | CI 走 `--cached`（无 base） | `scripts/pre-commit-check.sh:378` 仅 `GITHUB_ACTIONS=true && SYNO_DIFF_BASE` 时用 `_DIFF_RANGE`；否则 `:385-388` `git diff --cached`；workflow `:75` **不注入 `SYNO_DIFF_BASE`** |
| F3 | 空跑实证 | 干净树 `bash scripts/control-tower/check-doc-contract.sh --staged` ⇒ `闸 3 … (核 0 件)` **返回 0**；`STAGED_ALL` 空 ⇒ `:427-428` 打印"无文档变更（跳过）" |
| F4 | 存量（`gitea/local-main`） | `git ls-tree -r --name-only gitea/local-main -- docs/plans/codex/implementation/ \| wc -l` ⇒ **24**；`git log --since=2026-10-01 --diff-filter=A --name-only gitea/local-main -- docs/plans/codex/implementation/ \| sort -u \| wc -l` ⇒ **5**（与 CTO 数一致；⚠️ 我起初在旧 worktree 得 21/2，切 `gitea/local-main` 后一致） |
| F5 | 判别力（本地软／CI 硬） | 沙箱：暂存一个新增 `docs/plans/**` 文档 ⇒ `SYNO_CI=1 bash scripts/pre-commit-check.sh` **返回 1**（❌ D1193）；无 `SYNO_CI` ⇒ **返回 0**（⚠️ 软提示）——原始输出已留 |
| F6 | 判据源 | `docs/synova/DOC-CONTRACT.md` §3 阻断清单含 `docs/plans/**`（`:194/:196-207/:255`）；§9.1 过渡表（**不改**） |
| F7 | 可复用 | ①d 的 base 解析（链/规范化/物化）已在 main（S1 交付）；`SYNO_DIFF_BASE` 注入缝注释自述"CI gap 补齐"（`scripts/pre-commit-check.sh:375-377`） |
| F8 | D390 守卫 | 本地 `GITHUB_ACTIONS != true` ⇒ 忽略 `SYNO_DIFF_BASE`（`:377`）⇒ workflow 必须显式设 `GITHUB_ACTIONS=true` |

**若 F1–F8 任一不成立 ⇒ 停，退回 L1。**

---

## §4 怎么算做完

### 正常

```bash
# 沙箱（fixture 自建；或复用 tests/control-tower/doc-contract-ci-acceptance.test.sh 的沙箱）
SYNO_CI=1 SYNO_DIFF_BASE=<base> bash scripts/pre-commit-check.sh   # 期望 返回 0（无新增 docs/plans 时）
bash scripts/pre-commit-check.sh                                   # 期望 返回 0（本地）
bash tests/control-tower/resolve-ci-base.test.sh; echo "exit=$?"    # 期望 0
bash tests/control-tower/doc-contract-ci-acceptance.test.sh; echo "exit=$?"  # 期望 0（自证）
grep -c "SYNO_DIFF_BASE" .gitea/workflows/local-gates.yml           # 期望 ≥1（step ① 注入）
grep -c "resolve-ci-base.sh" .gitea/workflows/local-gates.yml       # 期望 ≥2（① 与 ①d 共用）
```

### 降级

```bash
# CI 无 base ⇒ fail loud（禁空跑）
SYNO_CI=1 bash scripts/pre-commit-check.sh   # 期望 返回 1，含「CI 无 base（fail-closed）」
# base 不可解析 ⇒ helper exit 2
SYNO_BASE_REF=no-such-ref bash scripts/control-tower/resolve-ci-base.sh; echo "exit=$?"   # 期望 2
```

### 🔴 反例（改坏必判红，三条）

```bash
# R1 沙箱 CI 模式必判红：base 之后新增 docs/plans/** 文档；SYNO_CI=1 SYNO_DIFF_BASE=<base> ⇒ 返回 1（D1193 FAIL）
# R2 本地必软：同一文档，无 SYNO_CI ⇒ 返回 0 ＋ ⚠️（不阻断）
# R3 真 PR 红/绿：PR 分支推一个临时 docs/plans 文档 ⇒ CI 红（run 号）；revert ⇒ CI 绿（run 号）
```

### DS（交付声明，逐条可核验）

| # | 声明 | 核验 |
|---|---|---|
| DS-1 | CI 注入 base | workflow step ① 含 `SYNO_DIFF_BASE` ＋ `GITHUB_ACTIONS=true` |
| DS-2 | ① 与 ①d 共用 helper | grep `resolve-ci-base.sh` ≥2 处（两 step） |
| DS-3 | CI 无 base ⇒ fail loud | `SYNO_CI=1`（无 base）⇒ 返回 1 |
| DS-4 | 沙箱 CI 模式必判红 | R1 沙箱：新增 docs/plans 文档 ⇒ 返回 1（原始输出入证据） |
| DS-5 | 本地必软 | R2：返回 0 ＋ ⚠️ |
| DS-6 | 真 PR 红/绿 | R3：CI run 号（红）＋ run 号（绿），原文入 PR 正文 |
| DS-7 | helper 契约 | 配对测试 6 例全过；沙箱跑完脏 0 |
| DS-8 | 自证 8 项 | 自证脚本 返回 0 |
| DS-9 | 未动存量/边界 | `git diff --name-only` 不含 `docs/plans/**`、`.github/**`、`DOC-CONTRACT.md` |
| DS-10 | 双命令终态 | `pre-commit-check.sh` 本地 返回 0；CI 模式（有 base）返回 0 |

---

## §5 怎么跑

```bash
git -C /Users/wane/SynovaAgent fetch gitea
git -C /Users/wane/SynovaAgent worktree add .synova-wt-dc-impl-1019 -B ct/p4-doc-contract-1019 gitea/local-main
cd /Users/wane/SynovaAgent/.synova-wt-dc-impl-1019
# 依赖：无（bash + git）；真 PR 红/绿证据要在 push 后等 CI（每次 ~20–60s）
# 证据：docs/evidence/p4-doc-contract/（.gitignore:81 evidence/ 覆盖；原始输出禁 head 截断；run 号贴 PR 正文）
```

---

## §6 有什么基础（禁重复建设）

| 能力 | 证据 | 结论 |
|---|---|---|
| base 解析（链/规范化/物化） | ①d 步骤（S1 交付，main `ab70d634b`） | **抽 helper 复用**（① 与 ①d 共用，禁两处漂移） |
| `SYNO_DIFF_BASE` 注入缝 | `scripts/pre-commit-check.sh:375-390`（D390 守卫语义） | **复用**（不新造缝） |
| 闸 3 执行体与判据 | `check-doc-contract.sh` / `validate_doc_contract.py` | **不改**（只喂 base） |
| soft/hard 语义 | `soft_check`（本地软、CI strict）；`:446/:452` 已写 返回 1 | 复用（本卡只补 fail-loud 前置） |
| CT-34 早退位置 | 闸 3 块在早退**之前**（`:420` 注释） | 不动位置 |

---

## §7 前置与红线

**前置（硬）**

| # | 前置 | 判据 | 未满足 |
|---|---|---|---|
| P1 | **#595 先合**（顺序：S1 → #595 → 本卡） | `git merge-base --is-ancestor <#595 merge> gitea/local-main` | 停 |
| P2 | **创始人作者豁免**：本 PR 触碰受保护路径（`scripts/pre-commit-check.sh`、`scripts/control-tower/**`、`tests/control-tower/**`、`.gitea/workflows/**`）⇒ ①d 要求豁免 | `gate-exemptions/2026-10-19-doc-contract-ci-598.md` 每行 `- <路径> — <理由> — <裁定号>`，**最后提交作者 = `huangxuesongvip@163.com`（创始人网页提交）** | ①d 红 ⇒ PR 不合 |
| P3 | 不动存量文档 | `git diff --name-only` 不含 `docs/plans/**` | 停 |
| P4 | 不改判据源 | `git diff --name-only` 不含 `docs/synova/DOC-CONTRACT.md` | 停 |

**红线**

```
❌ 不迁/不改 docs/plans/** 存量｜❌ .github/**｜❌ §9.1 过渡表
❌ 不改 check-doc-contract.sh / validate_doc_contract.py 的判据
❌ 不改 13 组编号/组内容（#595 域）
❌ 主树禁写｜禁 --no-verify｜禁 force push｜禁 git stash
```

**Known Limitations（必须写进交付件）**

1. **push 腿 diff 为空**：push 到 `local-main` 时 base==HEAD ⇒ 闸 3 不核文档；**真正拦截在 PR 腿**。禁写成"push 也拦了"。
2. **`GITHUB_ACTIONS=true` 是显式设的**（Gitea 腿的 D390 守卫要求）；若 Gitea 未来原生不设该变量，本卡仍工作（workflow 自设），但语义上它是"CI 标记"，不是"GitHub 平台标记"。
3. 本卡只让闸 3 拿到 base；其它依赖 `SYNO_DIFF_BASE` 的检查会**同时**进入 diff 模式（既有设计"CI gap 补齐"）⇒ 若 CI 出现新红，先判是否为该 PR 的真实问题（不得为凑绿关检查）。
4. 存量 24 件 `docs/plans/**` 不会被本卡清理（迁出另卡）。

---

## §8 交什么（给 L1）

```
 R2 指针 ≤10 行：批次名 ｜ 写集（逐文件）｜ 自验结论 ｜ 证据路径 ｜ 未决项
 证据：docs/evidence/p4-doc-contract/（原始输出全量，禁截断）＋ 真 PR 红/绿 run 号
 三信号：① 判据通过率 ② 例外清单 ③ 在飞数
 🔴 自证脚本必须进 PR；不进 ⇒ 视为未自证 ⇒ 独立复核不受理
 🔴 不判"通过"：只能给 自验结论 / 可提请独立复核 / 退回（附失败点原文）
```

**合并**：四条件自合（CI 全绿 pending=0 ／ 零写集重叠 ／ **独立复核 = L1 复跑 PASS** ／ 串行）；PR 提交后停下报 L1，PASS 前不得合。

---

## C1 契约

```
 resolve-ci-base.sh
 @input  环境：SYNO_BASE_REF / GITHUB_BASE_REF / 远端列表；git 仓库
 @output stdout = 单个 ref（如 gitea/local-main）；失败时 stderr `degraded: <原因>`
 @exit   0 = 解析成功；2 = 全部不可解析（含 fetch 失败/多远端不物化）
 @side-effect 仅可能 `git fetch`（不写工作树、不改分支）
 闸 3 块（pre-commit-check.sh）
 @env    SYNO_CI / SYNO_DIFF_BASE / GITHUB_ACTIONS
 @行为   有 SYNO_DIFF_BASE 且 CI ⇒ --base；本地 ⇒ --staged；CI 无 base ⇒ 返回 1（fail loud）
 @exit   0/1/2 与既有一致（2 = 检查自身降级，CI 下转 1）
```

## C2 边界值

| 边界 | 期望 |
|---|---|
| base 不可解析（坏 ref） | helper exit 2；CI step 失败 |
| 多远端且 canonical 不可解析 | 不 fetch，exit 2 |
| 单远端且 canonical 不可解析 | fetch 物化后成功 |
| `GITHUB_BASE_REF=local-main`（裸） | 规范化为 `gitea/local-main` |
| CI 有 base、无 md 变更 | 闸 3 跳过（"无文档变更"），返回 0 |
| CI 有 base、有新增 docs/plans/** | 返回 1（FAIL） |
| CI 无 base | 返回 1（fail loud） |
| 本地无 SYNO_CI | 软提示，返回 0 |
| push 腿（base==HEAD） | diff 空 ⇒ 跳过（Known Limitations 1） |

## C3 失效条件

- **何时可撤**：若 Gitea 原生提供 PR base 环境变量（可靠）且 pre-commit 能直接读取 ⇒ helper 可退役；或 `DOC-CONTRACT.md` 的闸 3 迁出 `docs/plans/**` 白名单（另卡）⇒ 本卡随之失效。
- **前提变更不得带病续跑**：若 #595 改动 workflow 的 step 名/结构，本卡 rebase 后必须重验 `grep SYNO_DIFF_BASE` 与真 PR 红/绿。

---

## 附录 · 派单内部一致性自检（教训：同一单两条要求对同一路径互斥）

| 检查 | 结论 |
|---|---|
| 写集 vs 非目标 | W1–W6 全在 §2；非目标是**不同路径**（docs/plans 存量／.github／DOC-CONTRACT.md）⇒ 零互斥 |
| "注入 base" vs "不改判据" | 只改 workflow 与 pre-commit 的**取数方式**，checker/validate 判据零改动 ⇒ 不互斥 |
| fail-loud vs 本地软提示 | 本地无 `SYNO_CI` ⇒ 软；CI（`SYNO_CI=1`）无 base ⇒ 硬；两分支互斥且各自可判 |
| push 腿空 vs PR 腿拦 | push 腿 base==HEAD ⇒ 空（Known Limitations 1）；PR 腿 base=目标分支 ⇒ 真判 ⇒ 不互斥 |
| helper 复用 vs #595 抢改 workflow | P1 钉死 #595 先合；本卡 rebase 后按内容定位、重验 grep ⇒ 不互斥 |
| 豁免件 vs 写集 | 豁免由**创始人网页提交**（作者校验），L2 不写；不占 L2 写集 |
