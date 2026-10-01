# Task Brief: D1090 — 文档契约合规迁移（14 件分流 + 2 决策）

> 生成: 2026-09-30｜任务: D1090｜认领: 工程线（X30 启动窗）｜分支: feat/x30-48h-m0
> 触发: 创始人指出 `DOC-CONTRACT.md`（2026-09-27 生效）已要求 D 层过程不入库，而本窗口仍写入 `coordination/`
> 裁定: **方案 A**（推送前摘出，main 一次都不脏）

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是驻扎企业的 AI 诊断系统；诊断是手段，**增长导航**才是目的：持续观测、主动发现、自动诊断、给出行动建议、跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
**文档治理面**（契约 §2 五层归属 / §7 存量分流 / §10 证据归属 / §11 库外仓），非产品 L1–L5。

### b) 文件审计
- 契约本体 `docs/synova/DOC-CONTRACT.md`（v1.0.0 implemented，2026-09-27 生效）；§3 闸 3 ❌ 行点名 `coordination/`。
- 库外落点 `~/Synova-过程档案/`（§11.2，已存在且在跑；有 `TEMPLATE.md` + `INDEX.md`）。
- B 层落点 `decisions/`（已启用，存量仅 `decisions/process/2026-09-26-doc-contract.md`）。
- 本窗口新增 14 份过程件（`git diff --diff-filter=A main..HEAD -- docs/synova/coordination/`）⇒ **全部违规**。
- 关系：**修复既有**（把违规件按契约分流），非新建。

### c) 决策
按 §7 三类分流：**过程性 ⇒ 出库**（13 件）｜**D 层唯一过程载体 ⇒ PR 正文**（1 件）｜**决策性 ⇒ `decisions/proposed/process/`**（2 件）｜结论进**卡 note**（§10.1②）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① Done＝「main 无新增过程 md」＋「库外仓可查」 → ② 分流判据取自契约原文（§7 三类）→ ③ 落盘 → ④ 接线（INDEX 同步 ＋ 卡 note 指针）→ ⑤ 自检（命名/索引/front-matter 三行）。引用铁律 7/35/49。

### b) 本任务执行约束
- rule: "出库件必须命中 §11.3 命名值集，且 INDEX 有行"
  verify: 复核脚本（命名正则 + INDEX 主题比对）输出「无缺失」
- rule: "结论进卡 note，不留 md 派生"
  verify: `task-state/D10*.json` 的 note 字段含结论与指针（sha256+位置+as_of+怎么重跑）

### c) 决策参考系
参考：第一性原理（痕迹与思考分离）＋ 契约原文（不发明新机制）→ 结论：出库 + 决策 + 卡 note 三段。

### d) 相关 Note 引用
- [x] `memory/notes/proposed/2026-09-30-doc-contract-process-md-in-repo.md`（本事故的免疫细胞）

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- 13 件出库至 `~/Synova-过程档案/`（§11.3 命名 + INDEX 同步）；PR 正文转 PR 描述（档外留副本）。
- 2 份 B 层决策（六段格式）：建包须做行集差集 / 引用用节名不用行号。
- 16 张卡 note 回填「结论一行 + 证据指针」。
- 从分支 `git rm` 这 14 份（移出 ≠ 删历史）。

不做什么（含文件路径）：
- 不动他人域（`docs/synova/coordination/派单-D1074-*.md`、`审计发现台账-DSH-CTO.md`、`AUDIT-PROTOCOL.md`）；
- 不做闸 1–3 的实现（属门禁线；其轮1交付已自陈「代码层不存在实现」）；
- 不做存量全量出库（属文档线 B1/B2 在制批次）；
- 不触 `scripts/audit/**`（D336）。

## 写集

| 文件 | 类 |
|---|---|
| `.claude/task-briefs/2026-09-30-D1090-doc-contract-migration.md` | task |
| `decisions/proposed/process/2026-09-30-preset-landing-must-diff-against-working-peer.md` | task |
| `decisions/proposed/process/2026-09-30-cite-by-section-name-not-line-number.md` | task |
| `docs/synova/coordination/D1082-PR正文与推送就绪-20260930.md` 等 14 份（**删除/移出**） | task |
| `task-state/D1090.json` ＋ D1070-D1089 各卡 note（回填） | task |
| `.claude/bypass.log` | builtin（synova-commit D414：证据链随提交入库，非人工写入） |

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：创始人问「文档契约生效了吗」；任何人 `ls ~/Synova-过程档案/ | grep 2026-09-30`。
处理（中间经过哪些步骤）：14 件分流 → 出库（命名/索引/三行复核）→ 决策六段 → 卡 note 指针 → 分支摘出。
结果（最终展示在哪）：库外仓 14 件 + `decisions/proposed/process/` 2 件 + 16 张卡 note；main 新增过程 md = 0。

## 架构层: 基础设施（文档治理面，非 L1–L5）
## 文档引用: `docs/synova/DOC-CONTRACT.md` §2/§3/§7/§10/§11；`~/Synova-过程档案/TEMPLATE.md`
## 接口审计: 无代码接口变更

#CRITERIA: A

## Done 标准
- [ ] 入口可触达: 库外仓 14 件命名合规、INDEX 有行、front-matter 三行齐
- [ ] 链路走通: decisions/ 2 件六段齐（含「考虑过的其他方案」与「取代」）；16 张卡 note 含指针
- [ ] 结果可见: `git log -1 --oneline -- decisions/` 有提交；分支上 14 份已移出（`git ls-files docs/synova/coordination/ | grep -c D108` = 0）

---

## 附：旧路径的处理（§7「不返工」）

本卡移出后，早前的 brief / Note 里仍写着 `docs/synova/coordination/<原名>` 的旧路径——那是**历史记录写下的当时路径**，按 §7「不返工、不搬家式消耗」**不改写**。
新旧对应关系见库外档案仓 `INDEX.md` 的「关联卡/PR」列（同批 14 行）。
