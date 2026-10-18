---
status: proposed
日期: 2026-10-18
任务: #586（2.5 S1 · U3 门禁本体保护：仓库清单 ＋ check-gate-protection.sh ＋ ①d）—— **S0 已批（CTO 2026-10-18）**
撰写: P4（门禁包负责人）· **独立于实现者**
依据: S0 预演报告（3/3 通过 ＋ 1 缺口实证）｜CTO 2026-10-18 裁定（**原样并入本件 §7 与 §〇 权威件回执**）｜`dev-doc-spec` v2
批次规模: **新建 6 ＋ 改 1**（含 2 个测试件）；预估 +420/−0 行
---

# SYNOVA-IMPL-2.5-S1 · 门禁本体保护：仓内清单 ＋ 自检脚本 ＋ 活腿 ①d

> 🔴 **本件是执行小队的唯一规格源**。S2（平台配置）由创始人执行，**不在本批**；本批只做仓内三件（清单／检查器／接线）。
> 🔴 **顺序不可反**（裁）：S1 必须先合 main，S2 才能开平台保护 —— 因为 S1 自身改动 `.gitea/**`，保护先开就锁死自己。

---

## 封面 · 四行开场包

```
① 批次名：P4-2.5-S1-门禁本体保护
② 写集（逐文件；**L1 划定，L2 不得扩**）：
   - .gitea/protected-files.txt                              （<新建> 门禁本体清单 ＋ pin ＋ approvers）
   - scripts/control-tower/check-gate-protection.sh          （<新建> 三态检查器：清单完整性 ＋ diff 豁免核验）
   - tests/control-tower/check-gate-protection.test.sh      （<新建> CT-40 配对测试）
   - tests/control-tower/gate-protection-acceptance.test.sh （<新建> 自证脚本，裁 210 硬要求）
   - .gitea/workflows/local-gates.yml                        （改：新增 step「①d 门禁本体自检」）
   - gate-exemptions/README.md                               （<新建> 豁免格式说明，非保护路径）
   - memory/notes/proposed/2026-10-18-gate-protection.md     （<新建> 四态 Note，交付配套件）
③ 判据（含改坏必红）：
   - `bash scripts/control-tower/check-gate-protection.sh` ⇒ exit 0（清单/pin/approvers 一致）
   - `bash tests/control-tower/check-gate-protection.test.sh` ⇒ 末行 `结果: N 通过, 0 失败`
   - `bash tests/control-tower/gate-protection-acceptance.test.sh` ⇒ 末行 `结果: N 通过, 0 失败`（自证 10 项）
   - 反例：沙箱里「改受保护路径但无豁免」⇒ exit 1；「清单删空/缺失」⇒ exit 2；「pin 漂移」⇒ exit 1；「豁免无理由/作者非批准人」⇒ exit 1
④ 域守则指针（必须显式 read）：scripts/control-tower/AGENTS.md ｜ tests/control-tower/AGENTS.md ｜ .gitea/AGENTS.md ｜ memory/notes/AGENTS.md
```

---

## §〇 归属与依据（派单七问）

| # | 问 | 答 |
|---|---|---|
| 1 | 谁派 / 依据 | CTO 2026-10-18：S0 批 + "S1 直接往下走，不用再回来问我"；A/B 分类中 S1 = **实现件**（四条件自合＋自证脚本进 PR＋独立复核） |
| 2 | 归属包 | **P4 门禁**（治理域）｜域：`scripts/control-tower/`、`tests/control-tower/`、`.gitea/` |
| 3 | 写集 | 见 §2（6 新建 ＋ 1 改，两两不重叠） |
| 4 | 判据 | 见 §4（正常/降级/五条反例）＋ DS-1…DS-10 |
| 5 | 依赖 | 无代码依赖；**S2 有硬前置**（见 §7 P1：账号分离） |
| 6 | 不做什么 | 见 §1 非目标（逐条路径） |
| 7 | 回执 | 见 §8（R2 ≤10 行 ＋ 三信号；证据原始输出，禁截断） |

## 权威件回执（派单前实读）

| 件 | as_of | 读了什么 |
|---|---|---|
| S0 预演报告 | 2026-10-18（本会话） | 三验成对＋控制变量：① 405 `Changed protected files`（对照 200）② allowlist force 200 ③ 非 allowlist admin force 405；补充：override=false 时 admin force **200** |
| CTO 裁定（提案 §7） | 2026-10-18 | R1+R2 纳入／R3 不纳入｜平台执行＝创始人｜豁免硬条件｜无自动化漂移｜#543 活体样本｜S0→S1→S2→S3→S4｜pin 只是误报器｜①d 核不到平台侧 |
| `scripts/control-tower/AGENTS.md` | `147361cac` | 三态退出码（0/1/2；信号量==0 ⇒ exit 2）／"改坏确实红"留档 |
| `tests/control-tower/AGENTS.md` | `147361cac` | 零失败才合并／CT-40 配对 |
| `.gitea/AGENTS.md` | `147361cac` | 改门禁只认本目录；须独立送审 |
| `memory/notes/AGENTS.md` | `147361cac` | 四态 Note；交付配套件默认可写（168-C） |
| **CTO 2026-10-18 回执** | 本会话 | 内容核过（325 行/sha/引用/四条 Known Limitations/豁免不递归/bootstrap+DS-6）；**3 条必改**：① 载体迁独立分支（已办）② 解析链删 `origin/*`（已改）③ push 腿空跑入 Known Limitations（已加）＋ 新事实：提交作者 `k12-batch5 <k12@local>` ⇒ 豁免须创始人网页提交 |

## §〇pre · pre-plan-thinking 9 问（逐问有证据）

| # | 问 | 证据（命令 ⇒ 输出摘要） | 落点 |
|---|---|---|---|
| ① | 问题 | 门禁本体可被普通 PR 改：`local-main` 分支保护 `protected_file_patterns=''`、`block_admin_merge_override=False`；S0 实证 override=false 时 admin force_merge ⇒ **200**（现状对管理员完全不设防） | §1／§3 |
| ② | 现状 | 活腿＝`local-gates`（①13 组＋①b 看板＋①c 内容耦合＋②架构＋③vitest --changed）；死腿＝`.github/workflows/ci.yml`（含 `check-gate-integrity`、sealed 执行）；`enable_status_check=True`、`status_check_contexts=['local-gates / gates (pull_request)']`、`enable_push=False` | §3 |
| ③ | 有没有现成 | 豁免"无理由不生效"范式：`scripts/control-tower/merge_writeset_gate.py:707-729` `scan_exempt_section`（`- <路径> — <理由>`）；CT-40 配对：`scripts/control-tower/ct-test-gate.sh:18`；三态＋degraded 既有约定。⚠️ **无**任何"受保护路径"现成件（`grep -rE 'protected_file_patterns\|受保护文件' scripts/ .gitea/ .github/` ⇒ 0）⇒ 只新建清单＋检查器，不新建机制族 | §6 |
| ④ | 最小改动 | 清单 1 ＋ 检查器 1 ＋ 配对测试 1 ＋ 自证 1 ＋ workflow 1 步 ＋ 豁免 README 1 ＋ Note 1；**不改 13 组**（撞 GATEKEEPER-COUNT 与"13 组"自声明）、不改 `ci.yml` | §2 |
| ⑤ | 最危险假设 | ①「配了平台就挡」→ S0 证伪（override=false 时 admin 200）⇒ 须 override=true＋allowlist；②「PR 正文能读」→ `.gitea/workflows/local-gates.yml:61` 注释实测 `${{ github.event_name }}` 在 Gitea host 模式不生效 ⇒ **改用仓内豁免文件**；③「作者邮箱可判别」→ 实测身份分离：创始人 merge `synova <huangxuesongvip@163.com>`，小队 `k12-batch5 <k12@local>` ⇒ 可判别 | §2／§7 |
| ⑥ | 失败路径 | 见 §4 五条反例（清单缺失/空 ⇒ 2；pin 漂移 ⇒ 1；受保护变更无豁免 ⇒ 1；豁免无理由/作者非批准人 ⇒ 1；bootstrap 行为） | §4 |
| ⑦ | 边界 | 不碰平台配置（S2）／`scripts/audit/**`／2.3／2.4／13 组／`ci.yml`；不处置在排 PR（S3） | §1／§7 |
| ⑧ | 可观测 | 一条命令：`bash scripts/control-tower/check-gate-protection.sh`；CI 上 = local-gates ①d 红/绿（该 job 已是 required status check） | §4 |
| ⑨ | 拆步 | S1-a 清单 → S1-b 检查器＋配对测试 → S1-c workflow ①d → S1-d 自证脚本 → S1-e Note → PR（四条件） | §8 |

---

## §1 做什么

**目标**：把"门禁本体清单"变成**仓内可判**的单一真源，并在活腿（`local-gates`）上加一道**自检**：清单缺失/空/pin 漂移 ⇒ 红/exit 2；PR 触碰受保护路径却没有**带理由、带裁定号、且由批准人提交**的豁免 ⇒ 红。

**可观测结果**：
1. `check-gate-protection.sh` 默认 exit 0；沙箱反例全部按 §4 变红；
2. `local-gates` 的 job 多一步 ①d，且其失败 = 合并被 required status check 挡住；
3. 自证脚本随 PR 入库并全绿。

**非目标（逐条路径）**：
- ❌ `.gitea/protected-files.txt` 的**平台侧**配置（`protected_file_patterns`／`block_admin_merge_override`／`bypass_allowlist`）= **S2**，创始人执行，本批不碰
- ❌ `scripts/audit/**`（K3）｜❌ `scripts/pre-commit-check.sh` 的 13 组（不改组数）
- ❌ `.github/workflows/**`（死腿，不在本批修）
- ❌ 2.3 存量基线｜2.4 双真源（另卡）
- ❌ 在排 PR 处置（S3）
- ❌ 平台 API 对账（token 403，见 §7 Known Limitations）

---

## §2 在哪做（file:line ＋ 写集）

### S1-a `.gitea/protected-files.txt`（新建）

格式（**检查器与 S2 的唯一真源**，逐字节）：

```
# protected-files.txt — 门禁本体清单（仓内真源；S2 由创始人粘贴进 Gitea protected_file_patterns）
# 语法：PATTERNS 段内每行一个 glob（gitea gobwas glob，大小写不敏感，相对仓库根）；# 开头为注释
# 改本清单 = 改门禁本体 ⇒ 必须走门禁豁免（见 gate-exemptions/README.md）
# PROTECTED-PATTERNS-SHA256=<sha256(规范串)>
# APPROVERS=huangxuesongvip@163.com
# PATTERNS-BEGIN
<一行一个 glob>
# PATTERNS-END
```

- **规范串**（pin 的计算对象）：PATTERNS 段内非空、非注释行，按**文件顺序**，去首尾空白，以 `\n` 连接并带末尾 `\n`；`sha256` 取 64 位小写十六进制。
- **APPROVERS**：`huangxuesongvip@163.com`（实测：创始人 merge 提交作者 `synova <huangxuesongvip@163.com>`；小队提交为 `k12@local`）。**空 ⇒ 检查器 exit 2**。
- **清单内容（R1＋R2，裁）**：`scripts/pre-commit-check.sh`、`scripts/commit-msg-check.sh`、`scripts/pre-push-check.sh`、`scripts/install-hooks.sh`、`scripts/check-*.sh`、`scripts/audit/**`、`scripts/control-tower/**`、`scripts/hooks/**`、`scripts/workflow/**`、`scripts/doc-system/**`、`scripts/ci/**`、`scripts/golden-scenarios/**`、`tests/control-tower/**`、`tests/doc-system/**`、`.gitea/workflows/**`、`.github/workflows/**`、`.github/CODEOWNERS`、`agents/**/AGENTS.md`、`.dsh/skills/**`、`docs/authority/DOCS-REGISTRY.yaml`（R3 `package.json` **不纳入**，裁）。

### S1-b `scripts/control-tower/check-gate-protection.sh`（新建）

- 契约见 C1。实现语言不限（建议 bash ＋ `python3 -` 内联做 glob/sha256；与既有 gate 一致）。
- **默认模式**（无参）：清单完整性 + pin + approvers。
- **`--changed-base <ref>`**：额外核 diff；`<ref>` 不可解析 ⇒ exit 2。若 base 里**没有** `.gitea/protected-files.txt` ⇒ 打印 `BOOTSTRAP: 清单在 base 不存在，diff 模式跳过（首次落盘）` 并 exit 0（**一次性 bootstrap**，只为此）。
- **diff 判定**：`MB=$(git merge-base <ref> HEAD)`；`git diff --name-only "$MB" HEAD`；任一变更路径命中 PATTERNS ⇒ 必须在本 diff 内新增/修改 `gate-exemptions/*.md`，且每一条命中路径都有 `- <路径> — <理由> — <裁定号>` 行（理由非空）；该豁免文件最后一次提交作者邮箱 ∈ APPROVERS。缺一 ⇒ exit 1 并逐条点名。
- **不做**：不调 Gitea API（无平台对账能力，403）；不写仓库；不 git add/commit。

### S1-c `tests/control-tower/check-gate-protection.test.sh`（新建，CT-40 配对）

覆盖：正常（真清单 exit 0）｜降级（清单缺失/空 ⇒ 2）｜pin 漂移 ⇒ 1｜沙箱 diff：受影响路径无豁免 ⇒ 1、有合规豁免 ⇒ 0、豁免无理由 ⇒ 1、作者非 approver ⇒ 1｜bootstrap ⇒ 0 ＋ `BOOTSTRAP` 行｜坏 base ⇒ 2。**全部在 mktemp 沙箱跑**（`SYNO_GATE_PROTECTED_LIST` / `--root` 注入缝，禁写仓库）。

### S1-d `tests/control-tower/gate-protection-acceptance.test.sh`（新建，自证 10 项）

① 清单存在可读非空 ② pin 与清单一致 ③（沙箱）改受保护路径无豁免 ⇒ 1 ④ 有合规豁免 ⇒ 0 ⑤ 豁免无理由 ⇒ 1 ⑥ 豁免作者非 approver ⇒ 1 ⑦ 清单缺失/空 ⇒ 2 ⑧ bootstrap ⇒ 0 ＋ `BOOTSTRAP` ⑨ ①d 已接线（`grep` workflow）⑩ 检查器零平台 API 调用（`grep` 无 `/branch_protections`）。**三态退出码；缺基线/不可解析 ⇒ exit 2；每条打印实测数字。**

### S1-e `.gitea/workflows/local-gates.yml`（改：新增 step）

- 位置：step「① 13 组门禁」之后、「①b 看板真值」之前。
- 名称：`①d 门禁本体自检（清单 ＋ diff 豁免）`
- 命令：`bash scripts/control-tower/check-gate-protection.sh --changed-base "<BASE>"`；`BASE` 解析链：**`SYNO_BASE_REF → GITHUB_BASE_REF → gitea/local-main`**；全不可解析 ⇒ 检查器 **exit 2**（fail loud）。
  🔴 **禁退到 `origin/local-main` / `origin/main`**：实测 GitHub 镜像断，`origin/local-main` 落后 **351+ commits** ⇒ 拿陈旧 base 算 diff = 假红/假绿（CTO 2026-10-18 修正）。
  🔴 **push 腿只做「清单完整性 ＋ pin」**：push 到 `local-main` 时 `gitea/local-main == HEAD` ⇒ diff 为空 ⇒ 跳过 diff 判定；**真正拦截在 pull_request 腿**（见 Known Limitations 5）。
- **不改**任何既有 step / job name（12 个必需 context 的产出者）。

### S1-f `gate-exemptions/README.md`（新建）

写清格式：文件名任意、内容每行 `- <路径或 glob> — <理由> — <裁定号>`；无理由/无裁定号不生效；提交作者必须是 `.gitea/protected-files.txt` 的 `APPROVERS`；**该目录不在保护清单内**（否则加豁免本身还要豁免）。

- 🔴 **作者事实（CTO 2026-10-18 实测）**：主仓提交作者 = `k12-batch5 <k12@local>`（**不是**创始人邮箱）⇒ R4 有区分力：**agent 自写的豁免必被 R4 判红**。
- 🔴 **因此：豁免文件必须由创始人在 Gitea 网页直接编辑提交**（作者才算其账号）；**命令行提交的豁免一律被 R4 判红**。README 必须原样写清，否则第一个真豁免会卡住。

### S1-g `memory/notes/proposed/2026-10-18-gate-protection.md`（新建，四态 Note）

---

## §3 凭什么做（现状证据）

| # | 前提 | 命令 ⇒ 原始输出（摘要） |
|---|---|---|
| F1 | 平台机制存在但空 | `branch_protections/local-main` ⇒ `protected_file_patterns=''`、`block_admin_merge_override=False`、`enable_bypass_allowlist=False`、`enable_push=False`、`enable_status_check=True`、`status_check_contexts=['local-gates / gates (pull_request)']` |
| F2 | **现状对管理员完全不设防** | S0 一次性仓：`override=false + allowlist=[]` 时 admin `force_merge` ⇒ **200 / merged** |
| F3 | 保护文件能真拦（S0 ①） | 保护文件 PR（mergeable=True）普通 merge ⇒ **405 `{"message":"Changed protected files"}`**；对照（非保护文件）⇒ **200** |
| F4 | allowlist 能 bypass（S0 ②） | allowlist 含该用户 + override=true ⇒ `force_merge` **200 / merged=True** |
| F5 | override=true 关掉管理员兜底（S0 ③） | allowlist 不含该 admin ⇒ `force_merge` **405 / 保持 open** |
| F6 | 活腿/死腿 | 活：`.gitea/workflows/local-gates.yml:75` `SYNO_CI=1 bash scripts/pre-commit-check.sh`；死：`check-gate-integrity` 与 sealed 执行只在 `.github/workflows/ci.yml`（GitHub 镜像断） |
| F7 | 事件载荷不可靠 | `.gitea/workflows/local-gates.yml:61` 注释：Gitea host 模式下 `${{ github.event_name }}` 实测不生效 ⇒ 豁免只能用**仓内文件** |
| F8 | 身份可判别 | 创始人 merge：`synova <huangxuesongvip@163.com>`；小队：`k12-batch5 <k12@local>`（`git log -25 --format='%an <%ae>'`） |
| F9 | 影响面（真数） | 当前 **15** open PR：**R1 命中 8**（#416 #509 #516 #521 #522 #543 #547 #553）＋ R2 仅 1（#519）⇒ 共 9 |
| F10 | 无现成受保护路径机制 | `grep -rE 'protected_file_patterns|受保护文件' scripts/ .gitea/ .github/` ⇒ 0（仅 P4 文档自述） |

**若 F1–F10 任一不成立 ⇒ 停，退回 L1。**

---

## §4 怎么算做完（三路径 ＋ 反例 ＋ DS）

### 正常

```bash
bash scripts/control-tower/check-gate-protection.sh; echo "exit=$?"           # 期望 exit=0，打印清单条数/pin 前 8 位/approvers
bash tests/control-tower/check-gate-protection.test.sh; echo "exit=$?"        # 期望末行「结果: N 通过, 0 失败」、exit 0
bash tests/control-tower/gate-protection-acceptance.test.sh; echo "exit=$?"   # 期望 10/10 通过、exit 0
grep -c "check-gate-protection.sh" .gitea/workflows/local-gates.yml            # 期望 ≥1（①d 接线）
```

### 降级（必须可触发）

```bash
SYNO_GATE_PROTECTED_LIST=/nope bash scripts/control-tower/check-gate-protection.sh; echo "exit=$?"   # 期望 2 + stderr degraded:
```

### 🔴 反例（改坏必红，五条）

```bash
# R1 pin 漂移：沙箱里改一条 patterns 但不改 pin ⇒ exit 1
# R2 受保护变更无豁免：沙箱 git 仓 base→HEAD 改 scripts/pre-commit-check.sh，无 gate-exemptions/*.md ⇒ exit 1
# R3 豁免不合法：有豁免文件但缺理由 / 缺裁定号 ⇒ exit 1
# R4 豁免作者非 approver：豁免文件由 k12@local 提交（`git -c user.email=k12@local commit`）⇒ exit 1
# R5 清单信号量 0：PATTERNS 段清空 ⇒ exit 2
```

### DS（交付声明，逐条可核验）

| # | 声明 | 核验 |
|---|---|---|
| DS-1 | 清单/pin/approvers 一致 | 默认模式 exit 0 |
| DS-2 | 受保护路径变更无豁免 ⇒ 红 | 沙箱 R2 exit 1 且点名路径 |
| DS-3 | 合规豁免 ⇒ 绿 | 沙箱 ④ exit 0 |
| DS-4 | 豁免无理由/作者不符 ⇒ 红 | 沙箱 R3/R4 exit 1 |
| DS-5 | 清单缺失/空 ⇒ exit 2（禁静默放行） | 沙箱 R5／缺文件 |
| DS-6 | bootstrap 只对"base 无清单"生效 | 沙箱：base 无清单 ⇒ 0＋BOOTSTRAP；base 有清单但改了保护路径无豁免 ⇒ 1（反例保证 bootstrap 不是后门） |
| DS-7 | ①d 已接线 | `grep` workflow 命中 |
| DS-8 | 零平台 API 调用 | `grep -c '/branch_protections' scripts/control-tower/check-gate-protection.sh` = 0 |
| DS-9 | CT-40 配对测试存在且绿 | 配对测试 exit 0 |
| DS-10 | 自证脚本随 PR | 文件在 diff 内且 exit 0 |

---

## §5 怎么跑

```bash
git -C /Users/wane/SynovaAgent fetch gitea
git -C /Users/wane/SynovaAgent worktree add .synova-wt-p25s1-$(date +%m%d) -B ct/p2-5-s1-$(date +%m%d) gitea/local-main
cd /Users/wane/SynovaAgent/.synova-wt-p25s1-$(date +%m%d)
# 依赖：无（bash + git + python3 标准库；不装包、无服务、无端口）
# 运行：见 §4；证据落 docs/evidence/p2-5-s1/（.gitignore:81 evidence/ 覆盖，不入库不脏树）
# 自检环境：bash --version | head -1 && python3 --version && git rev-parse --short HEAD
```

---

## §6 有什么基础（禁重复建设）

| 能力 | 证据 | 结论 |
|---|---|---|
| 豁免"无理由不生效"格式 | `scripts/control-tower/merge_writeset_gate.py:707-729` `scan_exempt_section` | **复用格式**（`- <路径> — <理由>`；本卡加裁定号为强约束） |
| 三态退出码＋degraded | `scripts/control-tower/AGENTS.md`；`check-gate-integrity.sh` 头部 | 复用（0/1/2；`degraded:` + `SYNO_GATE_DEGRADED_LOG`） |
| CT-40 配对 | `scripts/control-tower/ct-test-gate.sh:18`（`scripts/{control-tower,workflow,hooks}/<name>.<sh\|py> ↔ tests/control-tower/<name>.test.sh`） | 本卡检查器**必须**有配对测试 |
| 沙箱注入缝 | `check-dev-doc-write-set.sh` 的 `SYNO_DEV_DOC`／`SYNO_DEV_DOC_DIR` 范式 | 复用（`SYNO_GATE_PROTECTED_LIST`） |
| 受保护路径机制 | `grep` ⇒ 0 | **确需新建**（全仓唯一；平台字段是 S2） |
| 事件载荷 | `.gitea/workflows/local-gates.yml:61` | 不复用 event body（不可靠）→ 仓内文件 |

---

## §7 前置与红线

**顺序（钉死，不可反）**：
```
S1 合入（此刻保护未开）→ P5 的 PR 窗口（结掉 9 个触碰门禁的旧 PR）→ S2 开保护
```
理由：S1 自己就动 `.gitea/workflows/**`（在 R1 内）⇒ 必须趁保护未开合入；S2 一旦开保护，9 个旧 PR 的合入会全部需要创始人 force-merge。

**前置（硬）**

| # | 前置 | 判据 | 未满足 |
|---|---|---|---|
| P1 | **账号分离 —— ✅ 已解除（CTO 2026-10-18 替办）**：主仓 `gitea` remote 已从 `synova`(admin) 切到 `win-push`（非 admin，permission=write；实测读/写均通，`login=win-push is_admin=False`）⇒ S2 的 bypass allowlist 定为 **`synova`（创始人 admin）**。历史依据：分离前 agent token 属于唯一 admin `synova` ⇒ allowlist 放入 `synova` 等于 agent 也能 bypass；当前已无此问题 | `GET /user`（gitea remote 的 token）⇒ `login=win-push is_admin=False` | 若 remote 被切回 admin token ⇒ S2 停 |
| P2 | S1 先合 main，S2 后开平台保护 | `.gitea/protected-files.txt` 已在 `gitea/local-main` | 停 |
| P3 | 清单内容 = 裁定的 R1＋R2（R3 不纳入） | 与 §2 列表逐条一致 | 停 |
| P4 | approvers 初值 `huangxuesongvip@163.com`（实测） | 创始人可改一行；**改名单属 protected 变更 ⇒ 需豁免**（有意设计） | 记录，不一停 |

**红线**

```
❌ 平台配置（patterns/override/allowlist）—— S2 创始人执行，本批 0 行
❌ scripts/audit/**｜scripts/pre-commit-check.sh 的 13 组｜.github/workflows/**
❌ 不调 Gitea API（token 403；且禁把 admin token 进 CI）
❌ 不处置在排 9 个 PR（S3）｜不动 2.3／2.4｜主树禁写｜禁 --no-verify｜禁 force push｜禁 git stash
```

**Known Limitations（必须写进交付件，禁写成"已检测"）**

1. **无自动化平台漂移检测**：活腿 token 读 `branch_protections` = **403**（实测）；本方案核不到"平台规则是否被改/删"，只核仓内清单与豁免。
2. **pin 只是误改报警器**，蓄意改者可同步改 pin —— 真防线是 S2 的平台字段（裁）。
3. **豁免作者校验在"同机同身份"下失效**：若操作者用创始人邮箱提交（如直接改 git config），作者校验可被绕过；真正授权仍是 S2 的 force-merge。
4. **bootstrap 是一次性开孔**：仅"base 无清单"时跳过 diff；S1 合并后该孔自然关闭（DS-6 反例保证）。
5. **push 腿的 ①d 是空跑**：push 到 `local-main` 时 `gitea/local-main == HEAD` ⇒ `--changed-base` 的 diff 为空 ⇒ 跳过 diff 判定；push 腿只做「清单完整性＋pin」自检。**真正拦截发生在 pull_request 腿**（required status check `local-gates / gates (pull_request)`）。🔴 **禁写成「push 也拦了」**。

---

## §8 交什么（给 L1）

```
 R2 指针 ≤10 行：批次名 ｜ 写集（逐文件）｜ 自验结论 ｜ 证据路径 ｜ 未决项
 证据：docs/evidence/p2-5-s1/（原始输出全量，禁截断）
 三信号：① 判据通过率 ② 例外清单 ③ 在飞数
 🔴 自证脚本必须进 PR（裁 210）；不进 ⇒ 视为未自证 ⇒ 独立复核不受理
 🔴 不判"通过"：只能给 自验结论 / 可提请独立复核 / 退回（附失败点原文）
```

**合并**：四条件自合（CI 全绿 pending=0 ／ 零写集重叠 ／ **独立复核 = L1 复跑 PASS** ／ 串行）；PR 提交后**停下报 L1**，PASS 前不得合。

---

## C1 契约

```
 check-gate-protection.sh [--list <path>] [--changed-base <ref>] [--json]
 @input  .gitea/protected-files.txt（或 SYNO_GATE_PROTECTED_LIST）；git 仓库（diff 模式）
 @output stdout 逐项 ✅/❌（含实测数字）＋ 末行 `结果: N 通过, M 失败`；--json 输出结构化
 @exit   0=通过 ｜ 1=真红（pin 漂移/受保护变更无合规豁免/豁免不合法）｜ 2=检查自身失败（清单缺失/不可读/解析为空/approvers 空/坏 base）
 @degraded stderr 一行 `degraded: <原因>` ＋ SYNO_GATE_DEGRADED_LOG JSON（time/component/code/phase/retryable）＋ exit 2
 @error  code ∈ {E_LIST_MISSING,E_LIST_EMPTY,E_APPROVERS_EMPTY,E_PIN_MISMATCH,E_BAD_BASE,E_EXEMPT_INVALID}
 豁免语法：gate-exemptions/*.md，每行 `- <路径或 glob> — <理由> — <裁定号>`；缺任一 ⇒ 不生效
```

## C2 边界值

| 边界 | 期望 |
|---|---|
| 清单文件不存在／不可读 | exit 2 |
| PATTERNS 段空（全注释） | exit 2（信号量==0） |
| 只有 1 条 pattern | 正常 |
| APPROVERS 空 | exit 2 |
| pin 大小写/空格差异 | 规范化后比较（trim；hex 小写） |
| glob 含 `**`／`*`／`?`／大小写混合 | 与 Gitea 同语义（大小写不敏感；`**` 跨目录） |
| diff 为空 | exit 0 |
| base 不可解析 | exit 2 |
| bootstrap（base 无清单） | exit 0 ＋ `BOOTSTRAP` 行 |
| 豁免文件多条路径 | 逐条覆盖；缺一条即红 |
| 同一路径多次声明 | 取任一合规行 |

## C3 失效条件

- **何时可撤**：Gitea 支持"从 CI 读平台规则"（只读 token 或新 API）且 CTO 批 ⇒ 本仓内清单降级为文档；或 2.4/U1 统一真源后由 CI 单源生成。
- **前提变更**：S2 若改用"临时清空 patterns"的应急放行 ⇒ 本卡的豁免语法须同批复核；不得带病续跑。

---

## 附录 · 派单内部一致性自检（教训：同一单两条要求对同一路径互斥）

| 检查 | 结论 |
|---|---|
| 写集 vs 非目标 | 7 件写集全在 §2；非目标是**不同路径**（平台配置／audit／13 组／ci.yml／2.3／2.4）⇒ 零互斥 |
| bootstrap vs 反例 | bootstrap 只在"base 无清单"生效；DS-6 用"base 有清单"反例保证它**不是后门** ⇒ 两条要求不互斥 |
| 豁免文件路径 | `gate-exemptions/` **不在**保护清单内（否则加豁免本身还要豁免）⇒ 与"每行豁免必须覆盖受保护路径"不互斥 |
| approvers 可改 vs protected | 改 approvers 属 protected 变更 ⇒ 需豁免 —— 有意设计，不是死锁（豁免由创始人提交） |
| 自证脚本 vs 写集 | 自证脚本在写集内；它检查写集内文件的存在与接线 ⇒ 不越界 |
| 平台配置 | S1 明确 0 行；S2 由创始人执行 ⇒ 无"本批却改平台"的互斥 |
