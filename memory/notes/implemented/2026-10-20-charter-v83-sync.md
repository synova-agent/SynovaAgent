# 2026-10-20 · 产品宪章 v8.3 下游同步（裁 220）

> **类型**：implemented ｜ **裁定**：裁 220（CTO）｜ **上游**：产品宪章 v8.3（2026-10-20 定稿获签）

## 为什么
宪章 v8.2 → v8.3 改了 §4.7 边界（"不写生产代码"→"不做客户生产系统承包"+三级授权）、
§4.7 维度（三维→三维+实时性／工具数 5→4）、§4.4 ④b 写入路径、§5.8③ 自动写=目标态、
§7.5 护城河待验证、**§4.8 新增（② 只管结构／因果归 ①）**、L4 契约、解耦边界。
**下游不跟改 ⇒ 宪章与实物打架**，其中 expert 提示词不改则**专家行为与宪章相反**。

## 改了什么
### A 档（会实际改变行为）
- `AGENTS.md`（根件）：V7.0→V7.1、对齐 v8.3；§1 架构总图 ② 补「只负责结构」指针（宪章 §4.8）
- `expert/technology-foundation/PROMPT.md` ＋ `RULES.md`：不写生产代码 → **不做客户生产系统承包** ＋ 轻实施三级授权
- `expert/technology-foundation/TOOLS.md`：三维度 → **四维度**（含实时性；RULES.md 评分表为准）
- `agents/P8-内置FDE/AGENTS.md`：宪章 §4.7 转述同步
- `src/l4/AGENTS.md`：本体（**结构**）＋ 因果归属说明（边定义存储在校验侧、因果执行在 ①）
### B 档（版本引用）—— **本次改为「记录不加注」**
- `decisions/implemented/architecture/2026-10-09-权威架构总图.md`：**未加注**。
  原因：改它会激活**闸 1 的存量红**（该件头行是 `>` 引用块、非「决策: 标题」形态，且缺六段）——
  这是**存量不合规**，不是本次引入。已在台账记录，另立卡修格式。
- `decisions/implemented/process/2026-10-16-arch-authority-unification.md`：同上。
- 口径：**v8.3 已生效；两件基于 v8.2 撰写，结论不受影响**（架构统一决策与 v8.3 无冲突）。

## 未做（发现后主动回避）
- **`.dsh/skills/cto-handover/SKILL.md` 的「512 行」未改** —— 因为改它会激活 组 13 的**存量技能漂移 10 处**。
- 🔴 **同时发现一个 P0 隐患**：`sync-dsh-skills.sh` 的源是 `.synova/skills`、目标是 `.dsh/skills`，
  而 `.dsh/skills/dev-doc-spec/SKILL.md` 是 **v2（153 行）**、`.claude` 是**旧版（60 行）**
  ⇒ **盲目跑 sync 会用旧版覆盖 v2**。已立卡（见下），**本次不动**。

## 验证
- `check-gate-protection.sh --changed-base gitea/local-main` ⇒ 受保护路径均有合规豁免
- `SYNO_CI=1 pre-commit-check.sh` ⇒ 12 组（详见 PR）
