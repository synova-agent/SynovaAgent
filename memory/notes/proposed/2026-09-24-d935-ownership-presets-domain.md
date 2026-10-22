# 决策 Note — D935 ownership presets 域修正（窄卡）

- 状态: proposed（待 K3 审 + CTO 收件闸后 git mv 到 implemented/）
- 责任方: synova-squad-lead（D935 小队）
- 触发: CTO 2026-09-24 派单「Mac 侧 WIP=1 第 1 单 — 修 ownership.yaml 域判定」

## 决策

在 `docs/synova/coordination/ownership.yaml` 的 `rules:` 内**追加一条显式规则**
`docs/synova/presets/** → mac`，并重生成 `.github/CODEOWNERS`。

**只做这一件事**：不改解析算法、不改兜底语义、不动 `ci.yml`。

## 依据（可核）

- **归属权威源**：`docs/synova/coordination/TASK-ROUTING.md:37`「`scripts/control-tower/` + `scripts/backup/` + 门禁脚本 + `docs/synova/coordination/` + **DSH 预设与技能** → **Mac DSH**」；`:108` 复述。
- **兄弟路径先例**：`ownership.yaml:155`（`.synova/skills/**`→mac）、`:161`（`.dsh/**`→mac）均源自同一 L37；`docs/synova/presets/**` 是唯一漏登的兄弟路径。
- **真实阻塞复现**：`bash scripts/control-tower/check-pr-budget.sh --files "<D931 8 件写集>"` → `❌ ② 变更跨域`，exit 1（`docs/synova/presets/**` 判 `win`，其余判 `mac`）→ 卡住 PR #727。

## 前提纠正（本次实测，非转述）

派单件称「四处误判（dispatch / authority / research / presets）」，**实测仅 1 处成立**：

```
$ python3 scripts/control-tower/check-ownership.py \
    docs/synova/dispatch/x.md docs/authority/y.md docs/synova/research/z.md docs/synova/presets/w.md
mac  docs/synova/dispatch/x.md
mac  docs/authority/y.md
mac  docs/synova/research/z.md
win  docs/synova/presets/w.md
❌ FAIL 跨域: 变更落在 2 个域 ['mac', 'win'] —— 单个 PR 只许一个域
[exit code: 1]
```

前三条已由 **D914**（`c7046c07`，2026-09-22 20:44 提交 → 21:18 合并 **PR #708**）修掉。

**错误转述链**（三跳，全部可核）：
`task-state/D911.json` 缺陷② 追补实测（2026-09-22，当时为真）
→ `docs/synova/coordination/模块归属-MacWin-20260923.md:13`（#730 于 2026-09-24 04:36 合入，**照抄旧结论**）
→ CTO 派单件（把台账旧结论当现状转述）。

## 风险

- **写集冲突**：本卡 3 个文件与在飞卡 **D911**（`status: claimed`、`risk: high`、5 个工作树活跃）write_set **100% 重叠**。依 `TASK-ROUTING.md` §串行点「写集重叠 → 停手问创始人」已上报；**CTO 裁定 A**：M1 先合，令 D911 暂停这 3 文件。
- **治本未落地**：本卡是第 4 次「漏登记 → 落兜底误判」的同型补丁。机制治本（新增目录登记门禁）归 **M1b**，本卡不承接。
- **文档口径**：本次发现 `模块归属-MacWin-20260923.md:4` 声称「最长前缀优先 + 未登记 = fail-closed 由既有 `check-ownership.py` 物理执行」，而实测 `check-ownership.py:134` 为 last-match-wins、`:235` 无归属**不阻断** → **声称与实现不符**，已上报 CTO 并入 M1b。
