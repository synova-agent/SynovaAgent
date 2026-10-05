# D1163 — CTO 侧双闸（收件闸 / dispatch 闸）：判据件与安装方案

- 状态: proposed（等 K3 过审 → CTO 裁 → 创始人执行安装）
- 日期: 2026-10-06
- 卡: D1163 ｜ 域: 治理线（门禁/控制塔）
- 依据: CTO 派单《装两个闸》2026-10-06（§1 收件闸 / §2 dispatch 闸 / §3 安装方案 + K3 送审 / §4 persona 改行）

## 决策

1. **载体** = DSH hooks 桥（`@deepseek-ai/dsh-hooks-claude-code`，CC 方言 `hooks.json`），
   而非 git hook：两道闸管的是"收发时刻"，不是"提交时刻"。
2. **收件闸**（`UserPromptSubmit`）= 六行信封齐 + 值非空 ⇒ 放行；否则拒收并点名缺项。
3. **dispatch 闸**（`PreToolUse`）= 四类引用核验（路径存在 / 外部件五元组 / 单流 / 分支·PR 真伪），
   CTO 明令"四类为限" ⇒ 语义项（技术声称复现、写集交集、依赖图）**不做**，仍归 skill 人工。
4. **触发面取"声称"而非"出现"**：误拦（CTO 收发全停）与漏拦代价不对称 ⇒
   正文提到"回执"不拦；指令形态（含任务号/指令词）才拦；④ 判"声称 vs 事实"而非"点名即在 main"
   （按字面会把一切在飞引用判红 = D734 式"越守规矩越红"）。五处细化的代价逐条列在判据件 §2.2/§3.3。
5. **退出码双层**：闸内部守仓库三态（0 通过 / 1 违规 / 2 自身失败）；
   宿主方言只认 exit 2 阻断 ⇒ `--hook` 模式把 1 映射为 2；三道 fail-closed 保险
   （闸内自身失败 / 入口缺件 / 命令串 `|| exit 2`），防"门禁静默消失"。
6. **先软后硬**：`SYNO_GATE_MODE=advise` 一键转"只留痕不阻断"，装闸首周建议先跑 advise。
7. **自繁殖对冲**：新控制必写替代与退出条件 —— 替代 = 会话指令自觉 / 既有 `pre-dispatch-check.sh`
   人工复核；退出 = `install-cto-gates.sh --uninstall` 一条命令 + 重启（脚本自检残留计数）。

## 顺带取证纠正（口径）

- **"12 必需 context"是陈口径**：实测 `grep -vcE '^\s*#|^\s*$' scripts/control-tower/required-checks-baseline.txt` ⇒ **9**
  （文件内记 12→9 已落地、9→10 待触发）。凡以"12"为判据的场合须改读基线文件。
- Gate Integrity **C 段对必需/非必需零区分**（`check-gate-integrity.sh:717-718`），
  提案"只统计必需 context"与其后果（唯一定罪对象恰是非必需红 ⇒ 改后不清理基线就是空转）见送审件 §B。

## 影响面

- 新增: 4 个 shell 件 + 1 词表 + 1 模板 + 2 文档 + 2 测试 + 14 夹具
- 改动: `.github/workflows/ci.yml`（+2 行，仅登记两份测试进 `control-tower-tests` 密封清单；**未动任何 job `name:`**）
- 不碰: `scripts/audit/**`、`pre-commit-check.sh`、`pre-dispatch-check.sh`、`check-gate-integrity.sh`、真实 profile 目录

## 回滚

- 本卡（代码层）：`git revert <squash 提交>`；两闸未被任何 hooks.json 引用前，零运行时影响。
- 装闸后（运行层）：`bash scripts/control-tower/install-cto-gates.sh --uninstall` + 重启 DSH。

## 关联

- 判据件: `docs/synova/gates/D1163-CTO侧双闸-判据与安装-20261006.md`
- 送审件: `docs/synova/gates/D1163-K3送审件-20261006.md`（含 C 段棘轮提案 + CTO persona 改行建议）
