# Task Brief: P4 · 2.5 S1 — 门禁本体保护（仓内清单 ＋ check-gate-protection.sh ＋ 活腿 ①d）（Issue #586）

> 分支: ct/p2-5-s1-1018 ｜ 起点: `gitea/local-main` @ 85cdc31df（实测 `git rev-parse --short HEAD` == `git ls-remote gitea refs/heads/local-main` 前 9 位）
> 规格（唯一）: `docs/plans/codex/implementation/SYNOVA-IMPL-586-gate-protection-20261018.md`（338 行；sha256/16 = 3f1e2f2d892086e3；status: proposed）
> 域守则（均显式 read）: `scripts/control-tower/AGENTS.md` ｜ `tests/control-tower/AGENTS.md` ｜ `.gitea/AGENTS.md` ｜ `memory/notes/AGENTS.md`
> 本件是 pre-commit 组 6 要求的声明载体（gate-mandated companion），**不是交付件**（交付件 = 下列 7 件）

## Q0: 定位（项目拼图 + 文件审计）

**a) 项目拼图**：治理线 · P4 门禁。门禁本体（受保护路径清单／检查器／豁免）当前**不存在**——`grep -rE 'protected_file_patterns|受保护文件' scripts/ .gitea/ .github/` 实测 **0 命中**；平台侧 `protected_file_patterns=''`、`block_admin_merge_override=False`（S0 实证：override=false 时 admin force_merge ⇒ 200）。本件把「门禁本体清单」落成仓内可判单一真源，并在活腿 `local-gates` 上加一步 ①d 自检。

**b) 文件审计**：`.gitea/workflows/local-gates.yml` 现有 5 步（① 13 组 → ①b 看板 → ①c 内容耦合 → ② 架构 → ③ 增量测试），①d 插在 ① 之后、①b 之前；`scripts/control-tower/` 实测 136 件（`find -type f`），三态退出码／降级范式见 `check-gate-integrity.sh`；CT-40 配对规则见 `scripts/control-tower/ct-test-gate.sh`；豁免「无理由不生效」格式见 `scripts/control-tower/merge_writeset_gate.py:707-729`（`scan_exempt_section`）。

**c) 决策**：新建清单＋检查器（全仓唯一，不新建机制族）；复用四个既有约定：三态退出码／`@降级`＋`SYNO_GATE_DEGRADED_LOG`／UTF-8 强制／判别力自检。

## Q1: 调研（业界最佳实践 / 决策链 / memory 历史教训）

**a) 业界最佳实践**：三态退出码（0 通过／1 真红／2 检查自身失败）＋ fail-closed；「看不见 ≠ 没问题」（信号量==0 ⇒ exit 2）；「改坏确实红」（判别力自检）。依据 `scripts/control-tower/AGENTS.md`、`.dsh/skills/ctrl-tower-change/SKILL.md`、`.dsh/skills/dsh-code-standards/SKILL.md`。

**b) 决策链**：CTO 2026-10-18 裁定 —— R1＋R2 纳入清单／R3（`package.json`）不纳入｜平台配置＝S2 创始人执行，本批 0 行｜豁免硬条件（理由＋裁定号＋approver 作者）｜无自动化平台漂移检测｜pin 只是误改报警器｜①d 核不到平台侧｜顺序钉死 S1 → P5 PR 窗口 → S2 开保护。

**c) 历史教训**：F10 无现成受保护路径机制 ⇒ 不得假装平台字段已生效；F7 事件载荷不可靠（`${{ github.event_name }}` 在 Gitea host 模式实测失效）⇒ 豁免只能走仓内文件；F8 身份分离（创始人 `synova <huangxuesongvip@163.com>` vs 小队 `k12-batch5 <k12@local>`）⇒ R4 有区分力。**本次实测新增**：CI 克隆工作区 `/Users/wane/.ci-work/SynovaAgent` 只有远端 `origin`（= 本机 Gitea，非 GitHub 镜像），`gitea/local-main` **不可解析**而 `origin/local-main` 可解析 ⇒ ①d 步必须先把 canonical ref `refs/remotes/gitea/local-main` 物化，否则 ①d 在 CI 恒 exit 2、阻断全部合并。

## Q2: 范围 — 正确的最简方案是什么？

做什么（写集，逐文件；裸路径独立成行；L1 划定，L2 及成员不得扩）：
- .gitea/protected-files.txt
- scripts/control-tower/check-gate-protection.sh
- tests/control-tower/check-gate-protection.test.sh
- tests/control-tower/gate-protection-acceptance.test.sh
- .gitea/workflows/local-gates.yml
- gate-exemptions/README.md
- memory/notes/proposed/2026-10-18-gate-protection.md
- .claude/task-briefs/2026-10-18-586-gate-protection.md

不做什么（禁碰，含路径）：
- .gitea/ 下的平台配置（`protected_file_patterns` / `block_admin_merge_override` / `bypass_allowlist`）= S2 创始人执行，本批 0 行
- scripts/audit/
- scripts/pre-commit-check.sh
- .github/workflows/
- src/（任何 L1–L5 业务代码）
- 在排 9 个旧 PR（S3）｜2.3／2.4 存量
- 主树 /Users/wane/SynovaAgent（禁写）

## Q3: 验收（入口 → 交互 → 结果）

**入口**：`bash scripts/control-tower/check-gate-protection.sh [--list <path>] [--changed-base <ref>] [--json] [--root <dir>]`；注入缝 `SYNO_GATE_PROTECTED_LIST`。
**交互**：三态退出码；降级 stderr 一行 `degraded: <原因>` ＋ `SYNO_GATE_DEGRADED_LOG`（`time/component/code/phase/retryable`）＋ exit 2；末行 `结果: N 通过, M 失败`。
**结果**（原始输出为准）：
- 默认模式 ⇒ exit 0（清单条数／pin 前 8 位／approvers 三项实测）
- 配对测试 ⇒ 末行 `结果: N 通过, 0 失败`、exit 0
- 自证脚本 ⇒ 12/12、exit 0（含 ⑪ ①d 步块内 `origin/local-main|origin/main` 零命中、⑫ push 腿「只做清单完整性」语义澄清）
- 五条反例：pin 漂移 ⇒ 1｜受保护变更无豁免 ⇒ 1｜豁免无理由 ⇒ 1｜豁免作者非 approver ⇒ 1｜清单空/缺失 ⇒ 2
- bootstrap：base 无清单 ⇒ exit 0 ＋ `BOOTSTRAP`；DS-6：base 有清单却改保护路径无豁免 ⇒ 必 1
- `grep -c "check-gate-protection.sh" .gitea/workflows/local-gates.yml` ⇒ ≥1；`grep -c "/branch_protections" scripts/control-tower/check-gate-protection.sh` ⇒ 0

## Q4 契约与测试

- 头部契约 `@input/@output/@exit/@degraded/@error`（`E_LIST_MISSING/E_LIST_EMPTY/E_APPROVERS_EMPTY/E_PIN_MISMATCH/E_BAD_BASE/E_EXEMPT_INVALID`）；设计哲学一句；「已知限制」节；结构表（File→Role 式）。
- 纯 bash ＋ python3 标准库（python3.9 兼容；macOS bash 3.2：禁关联数组/mapfile）；UTF-8 强制；禁静默吞错。
- 配对测试全沙箱（`mktemp` ＋ `git init` ＋ 注入缝），零真实仓库写入；覆盖正常／降级／五反例／bootstrap／DS-6，末行固定格式。
- 自证脚本只读仓库，12 项逐条打印实测数字；缺基线/不可解析 ⇒ exit 2。

## 本任务在哪一层

基础设施（控制塔门禁；不触 L1–L5 业务代码）

#CRITERIA: A

## Done 标准

- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p25s1-impl-1018 && bash scripts/control-tower/check-gate-protection.sh; test $? -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p25s1-impl-1018 && bash tests/control-tower/check-gate-protection.test.sh; test $? -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p25s1-impl-1018 && bash tests/control-tower/gate-protection-acceptance.test.sh; test $? -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p25s1-impl-1018 && test "$(grep -c 'check-gate-protection.sh' .gitea/workflows/local-gates.yml)" -ge 1
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p25s1-impl-1018 && test "$(grep -c '/branch_protections' scripts/control-tower/check-gate-protection.sh)" -eq 0
- [ ] verify: cd /Users/wane/SynovaAgent/.synova-wt-p25s1-impl-1018 && git status --porcelain | grep -cE '^(\?\?| M|M |A )' | awk '{exit !($1<=8)}'
