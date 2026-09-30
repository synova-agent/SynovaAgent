---
status: proposed
date: 2026-09-30
name: 文档契约生效后仍往主仓写过程 md
class: DOC_CONTRACT_PROCESS_MD_IN_REPO
constraint: "写任何 md 之前先跑契约 §1 一问（『3 个月后新人是否必须靠它才能理解为什么这样做』）；D 层过程（回执/验收/分类/派单/纪要/看板/探针/清单）一律不写进主仓——走 PR 正文 + commit + 卡 note 的 note 字段；库外产物落 ~/Synova-过程档案/（§11.3 命名 + INDEX.md 一行）"
expected: "连续两周『新增过程 md = 0』（契约 §6 验收②）；docs/synova/coordination/ 新增数归零，过程件出现在库外档案仓"
severity: block
occurrences: 1
first_seen: 2026-09-30
description: X30 窗口在契约生效（2026-09-27）后仍往 docs/synova/coordination/ 新增 14 份过程 md（闸 3 ❌ 明确点名该目录）；闸 1-3 尚未实现，故提交未被拦
---

# 文档契约生效后仍往主仓写过程 md（本窗口 14 份）

- **现象**: 本窗口在 `docs/synova/coordination/` 新增 14 份 md（回执/验收清单/操作卡/自省清单/分类/基线/证据/PR 正文/提案/报告）。而 `DOC-CONTRACT.md` v1.0.0 **2026-09-27 已生效**，其 §3 闸 3 白名单的 ❌ 行原文点名：「其余一律阻断（**coordination/** · task-briefs/ · reports/ · 派单 · 纪要 · 分类 · 看板 · 探针留档）」；§2.4 规定过程唯一载体 = **PR 三段式 + commit + 卡 note**；§10.3 立「主仓库唯一红线：不得新增报告类 md」。
- **根因**: ① 我没读新契约（开窗时按旧惯例写 coordination/）；② **闸 1–3 至今未实现**（`scripts/` · `.github/` 零引用 DOC-CONTRACT），契约先于执法生效 ⇒ 无任何机械提示；③ §8 说执法由「门禁治理线的工程派单」实现，而那份派单（`派单-治理体系最小充分形态-工程派单-20260926.md`）至今仅**暂存未提交**且带断面违规。
- **对照（同线已合规）**: 库外档案仓 `~/Synova-过程档案/` 已在用，且有 `2026-09-29-mac小队-证据-D1063-承接对账.md` —— **同一条线已在按 §11 出库**，只有我这批还在往主仓写。
- **已做的补救**: 本条先落 `memory/notes/proposed/`（§9 R2 修复把 `memory/notes/**` 纳入过渡期白名单，写它合规）；本窗口停止再往 coordination/ 新增；14 份按 §7 三类分流待处置（出库 / decisions/ 六段 / 证据走 `docs/**/evidence/**` + `--check` / PR 正文 / 卡 note）。
- **固化（可机械化与否）**: ★ 可机械化——**闸 3 入库闸**（§3）本就是这个用途：pre-commit 校验「新增 .md 是否命中白名单」，命中 `coordination/` 等即阻断。它属门禁线实现（§8），**本线只报不代建**（且执法派单未入库，无从执行）。
- **归属**: X30 工程线自我改善 + 门禁线缺口上报；处置口径（归线名/是否并入存量出库批）待创始人或 CTO 裁定。
