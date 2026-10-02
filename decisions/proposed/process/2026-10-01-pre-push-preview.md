# 决策: 落 pre-push-preview.sh（L-022「推前四件套」工具化）

状态: proposed
日期: 2026-10-01

## 一句话

把 L-022「推前四件套」从**仓外档案仓的 4 条手工命令**，工具化为**仓内可跑脚本** `scripts/workflow/pre-push-preview.sh`。

## 问题

2026-10-01 取证实测（《防线验证》第 3 条）：`scripts/workflow/pre-push-preview.sh` **不存在**；
L-022 实体只在 `~/Synova-过程档案/`，是 4 条**手工命令**（非脚本）。
⇒ 新 session（含新任 CTO）**没有"一条命令预演"**，会重犯「推了才发现 CI 红」——
  实测 5 类红全本地可发现，每轮 CI 36 分钟 × 5 轮 ≈ **3 小时空转**。

## 决定

新增 `scripts/workflow/pre-push-preview.sh`：
- 四件套：① brief 可解析 ② 写集一致(D708) ③ 夹具真 MARK 三面自测 ④ `SYNO_CI=1` pre-commit
- 参数 `--fast`（只跑 1-3）／`--list`／`--strict`（存量红也阻断）
- **含两个实测修正**：
  1. **npx PATH 自动注入**（非交互 shell 未加载 nvm ⇒ npx 缺失 ⇒ golden-case 门禁**误报「诊断质量退化解冻」**）
  2. **存量红 vs 新引入分类**（01 号研究 §B-1 应用）：实测 3/4 夹具自测在 **main 原状即 ❌**，属既有缺陷
- **不依赖 `timeout`**（macOS 无此命令，实测 `command not found`）

## 考虑过的其他方案

1. **只写进 skill 不落脚本** ⇒ 否决：skill 是提示不是工具，L-022 已证明"手工四步"会漏
2. **直接进 pre-push hook** ⇒ 否决：会拖慢每次 push；预演应由人显式调用
3. **依赖 `timeout` 做超时控制** ⇒ 否决：本机 macOS 无该命令（实测 command not found）

## 后果

- **收益**：推前可本地秒级预演，堵住"本地过、CI 红"的 3 小时空转
- **代价**：多一个脚本维护面（属"工具"非"门禁"，坏了不阻断交付）
- **已知存量红**：3/4 夹具自测（g12「期望红的组未红」）—— 默认警告、`--strict` 阻断；修复后应移出清单

## 取代

无（新建）

## 取代判定（契约 §3 闸2）

- **同主题候选检索命令**：`grep -rl '推前预演\|L-022\|pre-push-preview' decisions/ memory/notes/ 2>/dev/null`
- **检索到的候选**：
  · `scripts/pre-push-check.sh`（既有**推前门禁**）—— 非决策件；与本件关系是**互补**（本件是"预演工具"，不阻断；门禁仍由它执行）
  · `memory/notes/proposed/2026-09-18-d806-ledger-dsh-alignment.md` —— 主题为账本对齐，不相关
  · `memory/notes/implemented/2026-09-03-d571-escape-hatch-audit-chain.md` —— 主题为逃逸舱审计，不相关
- **判定**：**无全取代、无部分取代**。本文为**新主题**（L-022 四件套的**工具化落地**），
  不改变任何既有决策的效力；亦未被任何既有决策取代。
- **备注**：本段为**事后补齐**（契约自查 2026-10-01 发现初版缺失闸2 要素）——
  根因见契约 §3 三闸**无机器执行体**（`grep -rn 'DOC-CONTRACT' scripts/ .github/` 零命中），
  属契约自身待修项，已记入交接索引。
