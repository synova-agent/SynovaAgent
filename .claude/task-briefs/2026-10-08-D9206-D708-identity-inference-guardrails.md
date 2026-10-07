# Task Brief: D9206 D708 身份推断护栏（卡 #1237）

> 生成: 2026-10-08 | 任务: D9206 | 认领: line-f-dc（治理线施工队 D-C 接力位）
> 卡面: **#1237**（D708 身份推断护栏）| 取号: `alloc-task-id.sh`（**唯一取号入口** —— 今日已发生 3 次人肉分配撞号）
> 解除限制: `merge_writeset_gate.py` 原属 D-D 域，Lead 已解除禁碰（条件: 一件一 PR，不与 ③ 混）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔（基础设施层）· **合并级门禁的身份推断面**。目标：修「**D# 仅来自最弱锚点时，
门禁静默取用一个"碰巧同号"的声明，并把这误报成"夹带"**」这一族故障（卡 #1237 两个独立目击者同日）。
新增/替换/扩展判定：**扩展** `merge_writeset_gate.py`（新增护栏 + 身份纠正档 + 措辞分离）；
**新增**专项夹具 1 件；**最小调整**既有夹具 2 处（口径隔离，非放宽）。

### b) 文件审计（grep 实况，非记忆）
- 身份推断实现：`scripts/control-tower/merge_writeset_gate.py:286-386 infer_did()`
  （顺序 `--did 显式 → 分支名 → 提交 subject`）
- issue 档：同文件 `infer_issue_identity():388-445`（claim 存在即禁用 D# 链，K3 R3）
- 豁免面：`collect_explicit_exempt()` + `EXEMPT_HEADING_RE`（`## 写集豁免`）
- 既有夹具：`tests/control-tower/merge_writeset_gate.test.sh`（63 断言，**在 CI 密封面执行集内**）
  + `tests/control-tower/claim-identity-v2.test.py`（21 用例）
- 现场证据（卡 #1237）：分支名 `fix/d734-…` ⇒ `源 branch → D734` ⇒ 载入 2026-09-14 老 brief ⇒
  `❌ block — 3 个写集外文件（夹带）`；本人另于本批实测同型活样本
  （`--branch feat/D1223-dc-remainder → 任务 D1223 → 载入他人 task-state/D1223.json` ⇒ 13 件夹带）。

### c) 决策
- 复用：**不新增第二套解析** —— 身份纠正走既有单源 `resolve-commit-brief.sh`（"文件 → 认领 brief"唯一实现）
- 扩展：D# 链中**新增一档**「claiming-brief」（写集命中本次变更集 ⇒ 携带证据 ⇒ 强于提交标题）
- 新增：护栏（弱锚点 ∧ 零交集 ⇒ 显式疑似劫持）；措辞分离（身份推断失败 ≠ 真夹带）

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 业界：身份/授权信息必须来自**不可被请求方任意改写**的载体；否则须"多来源交叉 + 冲突即停"。
  分支名与提交标题都可由提交者自定 ⇒ 只能作兜底，不能作权威。
- Anthropic 决策链：spec（触发条件 + 反例保护）→ 夹具先行（A/B/D 三组）→ 实现 → 接线（命名常量 = 变异锚点）→ 验证。
- memory/ 教训：铁律 0-2（无夹具不合并）、铁律 11（禁静默降级 —— 本件正是"静默取用"的对面）、
  铁律 24/31（降级显式 + 传播）、D370（`$VAR（` 全角边界：**本件夹具自撞并已修**）、
  ctrl-tower-change 模式 1（三态退出码）/模式 5（变异副本注入）。
- 参考：Anthropic 工程基线（契约 + 夹具先行）+ 判例三档 B（最保守解释 + 代价显式登记）。
  结论：护栏**只收窄"静默取用"这一格**，不改变夹带判据本身；触发面刻意做窄（零交集），
  把误拦代价压到最小。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/merge_writeset_gate.py
- tests/control-tower/d708-identity-guard.test.sh
- tests/control-tower/merge_writeset_gate.test.sh
不做什么：
- 不改 scripts/control-tower/alloc-task-id.sh（线 D 所有）
- 不改 .github/workflows/ci.yml（线 D 在改 #1236）
- 不改 scripts/audit/**（K3 红线）
- 不改 scripts/control-tower/check-gate-integrity.sh（线 B 所有）
- 不改 scripts/pre-commit-check.sh（line E #1287 在飞；本卡亦无需改它）
- 不改 scripts/workflow/resolve-commit-brief.sh（③ 件写集，另 PR）
- 不改 scripts/commit-msg-check.sh（③ 件写集 + #1308，另 PR）
- 不改 scripts/check-brief-vs-code.sh（③ 件写集，另 PR）
- 不改 scripts/check-verifiable-done.sh（③ 件写集，另 PR）
- 不改 scripts/check-plan-integrity.sh（③ 件写集，另 PR）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`python3 scripts/control-tower/merge_writeset_gate.py --base <ref> --head HEAD --branch <name>`
（CI 步骤「Merge write-set reconciliation (D708)」即此入口）。
处理：issue 档 → D# 链（显式/分支/提交标题）→ 声明解析 → **阶段一 身份纠正**（弱锚点 ∧ 零交集 ⇒ 试 claiming-brief）
→ **阶段二 护栏裁决**（纠正后仍零交集 ∧ 显式豁免也零命中 ⇒ 疑似劫持 exit 2）→ 夹带判定（原语义不变）。
结果：① 劫持被显式报出且排查方向指向"身份"而非"文件"；② 真夹带仍报夹带（exit 1）；
③ 两处既有断言经 `--did` 口径隔离后仍绿（63/0）。

## 架构层: 基础设施

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-08-D9206-D708-identity-inference-guardrails.md | task |
| memory/notes/proposed/2026-10-08-d9206-d708-identity-guard.md | task |
| scripts/control-tower/merge_writeset_gate.py | task |
| tests/control-tower/d708-identity-guard.test.sh | task |
| tests/control-tower/merge_writeset_gate.test.sh | task |
| task-state/D9206.json | task |
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |

## Done 标准
- [x] verify: bash tests/control-tower/d708-identity-guard.test.sh → 「9 通过, 0 失败」（A1-A5 + B1-B3 + D1 变异体）
- [x] verify: bash tests/control-tower/merge_writeset_gate.test.sh → 「63 通过, 0 失败」（基线 63，无回归）
- [x] verify: python3 tests/control-tower/claim-identity-v2.test.py → 「Ran 21 tests ... OK」
- [ ] verify: GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh 通过
