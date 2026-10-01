---
状态: proposed
日期: 2026-10-01
决策: 为 DOC-CONTRACT 三闸补执行体；不新增判据、不接线、作者不自判
理由: 契约自述「机器可核」，实测全仓零执行体 ⇒ 那句话是承诺不是事实。但补执行体的人不得自判判据正确（红线 R-6），故本件只交付"可跑"并交 K3 核。
---

# D1107 · 三闸执行体

## 触发

契约 §3 写「三闸（**机器可核** —— 不靠自律，铁律 35）」，触发点 pre-commit + CI。
实测：
```
grep -rn "DOC-CONTRACT" --include=*.sh --include=*.py --include=*.yml scripts/ .github/  → 0
阳性对照 grep -rn "pre-commit-check" 同口径                                              → 45
```
⇒ 不是 grep 坏，是**真没有**。独立复核件已把该缺口列为 ⚠️ 未修项。

## 决策

- **补执行体**（`check-doc-contract.sh` + `validate_doc_contract.py`），判据**逐条对应既有 §2.2/§3/§9**，不发明；
- **不接线**（接入 pre-commit/CI 归治理线）⇒ 本件**不声称已执法**；
- **不新增白名单**：`memory/notes/**` 已在契约 §9 :300（过渡期补充），执行体直接读它；
- **不把存量冲突判成新违规**（coordination/·task-briefs/ 仍在库且与认领制打架）—— 显式登记在 §3.1；
- 🔴 **交 K3 独立复核**（红线 R-6）。

## 附带发现（只上报，不代改）

`--all-decisions` 全量核暴露 **2 处存量违规**：
- `decisions/process/2026-09-26-doc-contract.md:85` —— `## 取代` 段未输出候选清单/判定
- `decisions/proposed/process/2026-10-01-pre-push-preview.md:39` —— 同上

⇒ 本件**不改别人写的决策记录**（越界）；登记为存量债，归治理线。
