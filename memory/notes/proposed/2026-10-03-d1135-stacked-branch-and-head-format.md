# D1135 · 栈式分支写集陷阱 + DSH head 格式口径（两条**可复发**的机制缺陷）

- **状态**: proposed
- **日期**: 2026-10-03
- **决策**: ① 栈式卡片的 brief **不得**把"栈基座带来的文件"写成 Q2 排除项（写集只由机器块表达）；② `DSH-断面.json` 的 `current.head` **只能填 `--short` 逐字**（本仓 10 位），全 sha 入 `note`；③ 门禁 `head_re` 的 8 位盲区与 `:116` 硬编码豁免 **登记另卡，本卡不修**。
- **理由**: 两条都会**静默**地把"以为查过了"变成"其实没查 / 查不到"—— 一条让**本地绿灯不代表 CI 绿**，一条让**假绿**通过。
- 相关 D#: D1135

## 一、栈式分支陷阱（本卡 CI 首跑红的根因）

现象：`TypeScript + Lint + Iron Laws` 红 ⇒ `G12: Q2 排除项禁止修改: scripts/control-tower/check-dsh-anchor.py，来自认领 brief …D1135…`
链条：栈在 #970 上 ⇒ 相对 `main` 的 diff 含 **#970 的文件** ⇒ 机器写集块**由差异化自动生成**（`D749` 机器块优先）⇒ 那些文件成了本卡**认领范围** ⇒ 散文 Q2 又写「不改它」⇒ **同一 brief 内认领 × 排除自相矛盾**，`pre-commit-check.sh:1350-1367` 硬阻断。
**纪律**：栈式卡片 brief **不写**这类排除项；写集只由机器块表达，人类散文**只解释、不声明反范围**。

🔴 **附带的更贵的坑**：`SYNO_DIFF_BASE` 在本机被**有意忽略**（`pre-commit-check.sh:271-275`，D390 防注入缝旁路）⇒ 本地 `bash scripts/pre-commit-check.sh` 的 G12 是**空跑**（只遍历暂存区）⇒ **"pre-commit 13 组全过"不覆盖 G12 的 CI 语义**。
**覆盖 CI 口径的正确姿势**（复现/验证用；使检查更严，非绕过）：
```
GITHUB_ACTIONS=true SYNO_DIFF_BASE=origin/main SYNO_CI=1 bash scripts/pre-commit-check.sh
```

## 二、DSH head 格式口径（两处失明）

1. **填全 sha ⇒ 永久假 DEGRADED**：`check-dsh-anchor.py:80` 取 `git rev-parse --short HEAD`、`:83` 做**字符串不等比较** ⇒ `current.head` 只能填**短式逐字**（本仓实测 **10 位**，如 `639ed01539`）。全 40 位 sha 写 `current.note`（已入 `policy.head_field_format`）。
2. **引用 superseded 断面 ⇒ 假绿**：`:168` `head_re = \b(00102833|46a7f68b|[0-9a-f]{8})\b` —— `[0-9a-f]{8}` 只认**恰好 8 位** hex。实测 `findall`：
   `'… @ 4878cdabd8'`→`[]`　`'… @ 639ed01539'`→`[]`　`'… @ abcdef12'`→`['abcdef12']`
   ⇒ 「引用已 superseded 断面」对**现行短 sha 格式完全失明**；叠加 `:116` 硬编码豁免 `46a7f68b` ⇒ **两个真实 head 都检测不到**。
   ⇒ **建议另卡**：`head_re` 放宽（如 `[0-9a-f]{7,40}`）、去 `46a7f68b` 硬编码豁免，并补夹具锁死（8 位可触发已实测 ⇒ 分支可达，只是看不见 10 位）。

## 相关
- 事实源 `docs/synova/coordination/DSH-断面.json`｜门禁 `scripts/control-tower/check-dsh-anchor.py`｜夹具 `tests/control-tower/check-dsh-anchor.test.sh`
- 上游 Note：`memory/notes/proposed/2026-10-03-d1132-dsh-anchor-factsource.md`（D1132）、`memory/notes/proposed/2026-09-24-dsh-anchor-gate.md`（D943）
- **取代**: 无
