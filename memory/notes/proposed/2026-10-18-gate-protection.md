---
状态: proposed
日期: 2026-10-18
决策: 把「门禁本体」从文档口径变成仓内可判真源 —— 新增 `.gitea/protected-files.txt`（受保护路径 ＋ pin ＋ approvers）、三态检查器 `check-gate-protection.sh`、活腿 `local-gates` 的 ①d 自检步，并以 `gate-exemptions/*.md`（理由 ＋ 裁定号 ＋ 批准人作者）作为唯一豁免通道。
理由: 门禁本体（门禁脚本/workflow/测试）此前可被普通 PR 改掉，平台侧 `protected_file_patterns` 实测为空且 `block_admin_merge_override=False`（S0 实证：override=false 时 admin force_merge ⇒ 200）⇒ 现状对管理员完全不设防；平台机制要等 S2 才能开，而 S1 自身就改 `.gitea/**`，先开保护会锁死自己 ⇒ 必须先在仓内落可判清单 ＋ 自检腿，再开平台保护。
---

# 决策 Note — P4 · 2.5 S1 门禁本体保护（Issue #586）

> 过程件：记「做了什么、为什么、怎么判」，不写操作手册（手册归 `docs/` C 层）。
> 规格（唯一）：`docs/plans/codex/implementation/SYNOVA-IMPL-586-gate-protection-20261018.md`
> 本 Note 的**数值**以命令原始输出为准；标注「实测」的为本轮亲自复跑，其余为判据（未宣称已复跑）。

## 现状（2026-10-18 实测）

- **门禁本体不设防**：平台 `branch_protections/local-main` ⇒ `protected_file_patterns=''`、`block_admin_merge_override=False`；
  S0 一次性仓实测 `override=false + allowlist=[]` 时 admin `force_merge` ⇒ **200 / merged**。
- **仓内无任何"受保护路径"机制**：`grep -rE 'protected_file_patterns|受保护文件' scripts/ .gitea/ .github/` ⇒ **0 命中**（仅有文档自述）⇒ 确需新建，不是重复建设。
- **活腿/死腿**：活＝`.gitea/workflows/local-gates.yml`（`SYNO_CI=1` 硬阻断）；死＝`.github/workflows/ci.yml`（GitHub 镜像断，`check-gate-integrity` 与 sealed 执行只在死腿）。
- **事件载荷不可靠**：Gitea host 模式下 `${{ github.event_name }}` 实测不生效 ⇒ 豁免不能读 PR 正文/事件体，**只能走仓内文件**。
- **身份可判别**：创始人 merge 作者 `synova <huangxuesongvip@163.com>`；小队提交作者 `k12-batch5 <k12@local>` ⇒ 作者校验有区分力（R4 不是摆设）。
- **CI 工作区远端拓扑（本轮实测，本批最关键的现场事实）**：

  ```
  $ git -C /Users/wane/.ci-work/SynovaAgent remote
  origin                              # 恰 1 个
  $ git -C /Users/wane/.ci-work/SynovaAgent config --get remote.origin.url
  http://127.0.0.1:3000/synova-agent/SynovaAgent.git        # = 本机 Gitea，不是 GitHub 镜像
  $ git -C /Users/wane/.ci-work/SynovaAgent rev-parse --verify -q gitea/local-main; echo rc=$?
  rc=1                                # ⇒ canonical 名在 CI **不可解析**
  $ git -C /Users/wane/.ci-work/SynovaAgent rev-parse --verify -q origin/local-main
  85cdc31df0b3810ed907e1be5db47ffd08a0acab
  ```
  ⇒ **不物化 canonical ref，①d 在 CI 恒 exit 2 ⇒ 阻断全部合并**（本批偏差申报的由来，见下）。

## 决定

1. **仓内清单为单一真源**：`.gitea/protected-files.txt`（PATTERNS 段 ＋ 规范串 sha256 pin ＋ `APPROVERS`）。平台字段只是它的**粘贴副本**（S2 创始人执行），不是第二真源。
2. **检查器三态**：`0` 通过 ／ `1` 真红（pin 漂移 / 受保护变更无合规豁免 / 豁免不合法）／ `2` 检查自身失败（清单缺失/空、approvers 空、坏 base）。信号量==0 ⇒ **exit 2**（禁把"看不见"当"没问题"）。
3. **豁免只走仓内文件**：`gate-exemptions/*.md` 每行 `- <路径或glob> — <理由> — <裁定号>`，**无理由/无裁定号不生效**，作者须 ∈ `APPROVERS`；`gate-exemptions/` **不进**保护清单（否则死锁）；`README.md` 被检查器**显式排除**，不参与解析。
4. **接线**：活腿新增步 `①d 门禁本体自检（清单 ＋ diff 豁免）`，插在「① 13 组门禁」之后、「①b 看板真值」之前；BASE 解析链 `SYNO_BASE_REF → GITHUB_BASE_REF → gitea/local-main`；**不改**既有 step/job name（12 必需 context 的产出者），**不新增** `permissions` 块。
5. **不改 13 组、不改死腿**：不碰 `scripts/pre-commit-check.sh` 的组数，不碰 `.github/workflows/**`。

## 依据

- CTO 2026-10-18 裁定：R1＋R2 纳入清单／R3（`package.json`）不纳入｜平台执行＝创始人｜豁免硬条件（理由＋裁定号＋approver 作者）｜无自动化平台漂移检测｜pin 只是误改报警器｜①d 核不到平台侧。
- S0 预演报告（三验成对 ＋ 控制变量）：保护文件 PR 普通 merge ⇒ **405 Changed protected files**（对照 200）；allowlist 含该用户 ＋ override=true ⇒ force **200**；非 allowlist admin force ⇒ **405**。
- 规格 §S1-a…§S1-g、§4 判据、§7 红线与 Known Limitations。
- 复用既有约定（不新建机制族）：三态退出码 ／ `@降级`＋`SYNO_GATE_DEGRADED_LOG` ／ D732 UTF-8 强制 ／ 判别力自检；豁免"无理由不生效"格式取自 `merge_writeset_gate.py:707-729`；CT-40 配对；`SYNO_*` 注入缝。

## 写集（7 件，逐文件；L1 划定，实施不得扩）

| # | 文件 | 动作 | 备注 |
|---|---|---|---|
| 1 | `.gitea/protected-files.txt` | 新建 | 清单 ＋ pin ＋ APPROVERS（唯一真源） |
| 2 | `scripts/control-tower/check-gate-protection.sh` | 新建 | 三态检查器（头部契约 `@input/@output/@exit/@degraded`） |
| 3 | `tests/control-tower/check-gate-protection.test.sh` | 新建 | CT-40 配对（沙箱：正常/降级/五反例/bootstrap） |
| 4 | `tests/control-tower/gate-protection-acceptance.test.sh` | 新建 | 自证脚本（裁 210 硬要求：必须进 PR） |
| 5 | `.gitea/workflows/local-gates.yml` | 改 | 只加 ①d 一步，不动既有 step/job name |
| 6 | `gate-exemptions/README.md` | 新建 | 豁免格式与作者纪律（本目录不在保护清单内） |
| 7 | `memory/notes/proposed/2026-10-18-gate-protection.md` | 新建 | 本 Note |

不做什么（逐条路径）：平台配置（`protected_file_patterns`／`block_admin_merge_override`／`bypass_allowlist`）＝ S2，本批 **0 行**｜`scripts/audit/**`｜`scripts/pre-commit-check.sh` 的 13 组｜`.github/workflows/**`｜`src/**`｜在排旧 PR（S3）｜2.3／2.4 存量｜主树禁写。

## 自证（12/12 判据）

自证脚本 `tests/control-tower/gate-protection-acceptance.test.sh` 逐条打印实测数字，末行固定 `结果: N 通过, M 失败`，三态退出码（缺基线/不可解析 ⇒ exit 2）：

1. 清单存在、可读、非空；2. pin 与清单一致；3. 沙箱：改受保护路径无豁免 ⇒ 1；4. 沙箱：有合规豁免 ⇒ 0；5. 沙箱：豁免无理由 ⇒ 1；6. 沙箱：豁免作者非 approver ⇒ 1；7. 清单缺失/空 ⇒ 2；8. bootstrap（base 无清单）⇒ 0 ＋ `BOOTSTRAP`；9. ①d 已接线（grep workflow）；10. 检查器零平台 API 调用（grep 无 `/branch_protections`）；**11. ①d 步块内零 `origin/local-main`／`origin/main` 字面量**；**12. push 腿「只做清单完整性」语义澄清存在**。

> ⑪/⑫ 是 CTO 2026-10-18 三条必改后的追加项（规格 §S1-d 原文写「自证 10 项」）⇒ 计 **12/12**。
> 🔴 本 Note 只落**判据**；12/12 的**实测值**由该脚本末行给出，交付回执引用其原始输出（不在本件手写数字）。

## 生效时点

- **仓内部分**：本批 7 件合入 `local-main` 后，①d 随 `local-gates` 在**下一次 PR** 起生效（该 job 已是 required status check `local-gates / gates (pull_request)`）。
- **顺序钉死（不可反）**：**S1 合入（此刻保护未开）→ P5 的 PR 窗口（结掉 9 个触碰门禁的旧 PR）→ S2 才开平台保护**。
  理由：S1 自己就改 `.gitea/workflows/**`（在 R1 内）⇒ 必须趁保护未开时合入；S2 若先开，9 个旧 PR 全需创始人 force-merge。
- **平台部分**：S2（`protected_file_patterns`／`block_admin_merge_override=true`／`bypass_allowlist=synova`）由创始人执行，不在本批，本 Note 不宣称其已生效。

## 偏差申报（偏离原规格，逐条给理由）

1. **CI 的 base ref 物化**（规格 §S1-e 未写）：①d 在调用检查器前，若 `gitea/local-main` 不可解析**且** `git remote` 恰 1 个，
   则 `git fetch -q "<该远端>" '+refs/heads/local-main:refs/remotes/gitea/local-main'` 把 canonical ref 物化；fetch 失败打 `::warning`（**不吞**）；
   仍不可解析 ⇒ 把 `gitea/local-main` 交给检查器（exit 2，fail loud）。
   **理由**：实测 CI 克隆只有唯一远端且它＝本机 Gitea（非 GitHub 镜像）⇒ canonical 名在 CI 不可解析，**不加则 ①d 恒 exit 2、阻断全部合并**。
2. **裸分支名规范化**（规格未写）：`GITHUB_BASE_REF`／`SYNO_BASE_REF` 取到裸 `local-main` 时，改写成 `gitea/local-main`。
   **理由**：CI 克隆自带的本地分支在 clone 后不再更新（可能陈旧）⇒ 裸名会算出假红/假绿；规范化到刚物化的 ref 才与"禁陈旧 base"同旨。

## Known Limitations（做不到什么 —— 每条都是「做不到」，不得改写成「已核过」）

1. **无自动化平台漂移检测**：活腿 token 读 `branch_protections` = **403**（实测）⇒ 本方案核不到"平台规则是否被改/删"，只核仓内清单与豁免。
2. **pin 只是误改报警器**：蓄意改者可同步改 pin ⇒ 真防线是 S2 的平台字段（裁）。
3. **豁免作者校验在"同机同身份"下失效**：操作者若直接改 `git config user.email` 伪装创始人邮箱，作者校验可被绕过；真正授权仍是 S2 的 force-merge。
4. **bootstrap 是一次性开孔**：仅"base 无清单"时跳过 diff 判定；S1 合入后该孔自然关闭（DS-6 反例：base 有清单却改保护路径无豁免 ⇒ 必 1，保证它不是后门）。
5. **push 腿的 ①d 是空跑**：push 到 `local-main` 时 `gitea/local-main == HEAD` ⇒ `--changed-base` 的 diff 为空 ⇒ 跳过 diff 判定，push 腿只做「清单完整性＋pin」自检。**真正拦截发生在 pull_request 腿**（required status check）。🔴 **不得写成「push 也拦了」**。

## 关联

- 上游：CTO 2026-10-18 S0 批 ／ Issue #586 ／ 规格 `SYNOVA-IMPL-586-gate-protection-20261018.md`（status: proposed）
- 同族：门禁三态退出码（`scripts/control-tower/AGENTS.md`）／CT-40 配对（`ct-test-gate.sh`）／D472 Note 生命周期
- 待办（本批外）：S2 平台保护（创始人）｜S3 在排 9 个旧 PR（R1 命中 8：`#416 #509 #516 #521 #522 #543 #547 #553`；R2 命中 1：`#519`）
