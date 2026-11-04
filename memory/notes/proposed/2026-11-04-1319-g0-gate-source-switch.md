# 决策: G0 根入口门禁判据源切换（AGENTS.md ＋ GATE-STANDARD 首部）— #1319 T1

状态: implemented
日期: 2026-11-04

> 承接：规格 `synova-handbook/派单件/2026-11-04-规格-1319-门禁G0-G2最小核心门切换.md` §6 T1（G0 冻结步）；
> 施工依据 = 《门禁体系最终裁定与收缩施工方案 v1.0》（2026-11-03）。
> 本件只记录 G0 的入口同步这一决定；G1 最小核心门与 G2 分支保护切换不在本件范围（证据与验收在 T2–T6）。

## 一句话

把 `AGENTS.md` 与 `docs/authority/GATE-STANDARD.md` 里「GATE-STANDARD v3.1 是唯一判据中枢」的口径，改为「门禁判据源 = 裁定 v1.0；GATE-STANDARD v3.1 已停止作为施工目标」，消除入口与施工依据互相矛盾。

## 问题

- `gitea/main` 上 `AGENTS.md:3` 仍称 GATE-STANDARD（v3.1 / D763）为唯一判据中枢，而裁定 v1.0 §0.2-1 已停止其作为施工目标 ⇒ CTO 与 coding 拿到相反指令。
- 另有两条旧治理口径与裁定 v1.0 §3.3（写集／任务卡类检查只报告、不阻断）冲突：`AGENTS.md` 的「四条件自合·零写集重叠」与「Q2『不做什么』必须含文件路径（pre-commit 组 6 强制）」。

## 决定

1. `AGENTS.md:3`：`**判据中枢 = GATE-STANDARD（v3.1 / D763）**` → `**门禁判据源 = 《门禁体系最终裁定与收缩施工方案 v1.0》（2026-11-03；本模块 Issue #1319）**；GATE-STANDARD（v3.1 / D763）**已停止作为施工目标**，仅作历史参考`。该行其余段落（架构基准、本地软提示等）一字未改。
2. `AGENTS.md` 四条件自合行：追加「（注：**"零写集重叠"是流程纪律，不作合并阻断**；写集声明类检查按裁定 v1.0 §3.3 只报告）」（引号按规格第 324 行原文，ASCII 直引号）。
3. `AGENTS.md` Q2 行：「pre-commit 组 6 强制」→「legacy 规范，已退役，不强制；对应机检按裁定 v1.0 §3.3 转报告」。
4. `docs/authority/GATE-STANDARD.md` 首部加 2 行状态指针（同上口径），正文不动。
5. 范围外一律不动：workflow、脚本、台账、`GATE-INVENTORY.yaml`、`check-doc-truth.sh` 机器真值行，以及 `AGENTS.md` 头部「真值，勿手改」块（含 `本件 23,154 B` —— 该自述值与实际字节本就有差，属「勿手改」范围，本批未动）。
6. `AGENTS.md` §15 关卡 A 整节轻量化：标题由「所有包、所有派单，强制走 `devdoc-gate-a`」改为「仅新模块／高风险触发，一次独立复核」；删去三处无条件强制（「所有包、所有派单」「任何 L1（P1–P10）…必须」「未过关卡 A 不许开工（Win/Mac 同规）」），改为「**触发范围内**未过复核不许开工」；保留五问口径与「不得自审」。理由：裁定 v1.0 §5.2 —— 关卡 A 只对**新模块或高风险 DEV DOC** 做一次独立复核，普通小改由 CTO 自检，不强制独立会话；旧文本把一次性复核写成了对所有派单的常设门禁，与裁定冲突。

## 理由

- 方向顺序：创始人最新裁定 ＞ 已确认产品方案 ＞ 宪章/本体规范 ＞ 历史方案；裁定 v1.0 优先于 GATE-STANDARD v3.1。
- 只改入口措辞、不改任何机器判据 ⇒ 不放宽也不收紧现有门禁；`check-doc-truth.sh` 改前/改后均 rc=0。

## 影响与回退

- 影响：入口不再把已停止的施工目标称为「唯一判据中枢」。G1/G2 之前旧门行为不变（阻断面由分支保护决定，本批不动）。
- 回退：`git revert` 本 commit 即恢复（纯文档改动，无机器真值参与）。

## 证据

- 基线：`git ls-remote gitea refs/heads/main` = `49d9fee360f7…`（现场重取）；规格锚 `27d06fcb6` 距该基线 **4 个 commit**（`git rev-list --count 27d06fcb6..49d9fee36` = 4，现场实测）。
- 改前：`git show 49d9fee36:AGENTS.md | sed -n '3p'` 含 `**判据中枢 = [`docs/authority/GATE-STANDARD.md`](./docs/authority/GATE-STANDARD.md)（v3.1 / D763）**`（现场实测原文）。
- 门禁：`bash scripts/doc-system/check-doc-truth.sh` 改前 rc=0（13 ✅ / 0 ❌ / 2 ⚠️）、改后 rc=0（13 ✅ / 0 ❌ / 2 ⚠️，⚠️ 为存量：C2 门禁组数(AGENTS.md)、W1 版本滞后），两次均为现场实跑。
- 字节：`AGENTS.md` 改前 24,430 B → 改后 24,733 B（+303 B）；`docs/authority/GATE-STANDARD.md` 33,443 B → 33,731 B（+288 B）。
- 改前：`git show gitea/main:AGENTS.md | sed -n '349p'` = `## 15. 🔴 关卡 A（dev doc 评审）——**所有包、所有派单，强制走 \`devdoc-gate-a\`**`
