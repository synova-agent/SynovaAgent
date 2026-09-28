# PR 正文（D1053）—— 供 CTO 创建 PR 时原样粘贴

> **创建入口**：`https://github.com/tangbaobao520/SynovaAgent/pull/new/feat/d1053-live-restart-settings`
> （本 session **无 `gh`、无 `GITHUB_TOKEN`** ⇒ 队不代建、不代找凭证；branch/tip 已推送可核：`24d8505d6bf20b955a61cc6aca4fea511259daa2`）
> **merge_method 用 `merge`，勿 squash**（`.claude/bypass.log` 为 `merge=union`，squash 会破坏 append-only 证据链）

---

## 标题

```
feat(D1053): 线25 live/restart 设置分类（25-8 / 25-9 翻绿）
```

## 摘要

线25 第 8、9 格验收点：**live 类**（展示/阈值/文案）改值后**下一次读取即返回新值**；**restart 类**（连接/插件/数据源/鉴权）**重启前绝不半生效**；未声明分类的设置项**默认安全**（强制 restart 语义）并在启动打印清单。

**M1 口径（按 CTO 裁决①(c) 执行）**：以**现验锚点**执行、**不动 yaml**。锁定 DSH 快照 `0.1.7-rc.1 @ 46a7f68b` 中 `SettingsApplies` 类型**不存在**、`packages/settings/settings/lib/index.js:446` **硬编码 `applies: "live"`**（`lib/types/types.d.ts:32` 仅字面量）⇒ 只能**借范式自研**（B-10 声明式分层 + 来源可 dump，复用 D599 落点）并把 DSH「恒 live 默认」当**反例边界**。**未引任何 `@deepseek-ai/*` 依赖**（处置表 `dsh-settings` = 接缝-预留）。

**接管点**：K3 批次1 FIX-C（报告 commit `643069b9`，**未落 main** —— 见偏差登记）。

## 写集（8 件产品文件，全部 ⊂ win 域）

| # | 文件 | 操作 |
|---|---|---|
| 1 | `src/config/settings-applies.ts` | 新建（分类内核；registry = 声明唯一真相源；`initSettingsBootFence` 生产接线） |
| 2 | `src/config/settings-source.ts` | 新建（`SYNOVA_SETTINGS_ROOT` / `SYNOVA_SETTINGS_HOME` 两层源；复用 `config-layers` 叠加） |
| 3 | `src/routes/settings.ts` | 新建（`GET /api/settings/effective` = 真实入口） |
| 4 | `src/routes/config.ts` | 修改 **+14 ≤ 15**（`/api/config/dump` 增列 = 第二消费者） |
| 5 | `src/server.ts` | 修改 **恰 4 物理行**（2 import + 1 `initSettingsBootFence()` + 1 mount；mount 在 404 兜底前） |
| 6 | `tests/config/settings-applies.test.ts` | 新建（**LIVE 套件**，含 A2 串 `settings-applies-live`） |
| 7 | `tests/config/settings-source.test.ts` | 新建（**RESTART 套件**，含 A2 串 `settings-applies-restart`） |
| 8 | `tests/routes/settings.test.ts` | 新建（**入口/E2E 套件**，不含两串；两消费者同值断言落此） |

治理产物（D860 口径**不计入 PR 12 文件预算**）：`.claude/task-briefs/2026-09-28-D1053-*.md`、`task-state/D1053.json`、`memory/notes/proposed/2026-09-28-D1053-*.md`、`docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-*.md`、`docs/synova/product-lines/evidence/D1053/**`、`.claude/bypass.log`

## 写集豁免

**无**（本 PR 未申请任何豁免）。PR 预算门禁实测：`✅ ① 9 文件 ≤ 12` ｜ `✅ ② 单域 win` ｜ `✅ ③ 落后 0`。
**接线门禁走 (b) 收缩公开面、零豁免**：公开面收敛为 3 个**已跨文件接线**入口（`initSettingsBootFence` ← `src/server.ts:45/127`、`getSettingsRuntime` ← 两消费者、`getEffectiveRow` ← `src/routes/settings.ts`）；其余符号无生产消费者 ⇒ **私有化**，**`.claude/plan.json` 零改动**（未走 `wiring:deferred`）。

## 证据（四件套齐，全部可独立复跑）

- **① verify 命令**：三套件（LIVE 6 / RESTART 7 / E2E 9 = 22 例）+ 负控 10/10
- **② `.json` 证据**：`25-V-DEV5闭合.json`（最新批次，机器可读）+ `20a`/`22a`/`24a`（vitest **原文行**含套件名与用例数）—— **非 A2 产物**（A2 管线有静默跳过假绿前科，见遗留 L1）
- **③ 真实入口**：真进程起 `src/index.ts` → `GET /api/settings/effective` 与 `GET /api/config/dump` 两端点读同一 accessor
- **④ 改坏即红**：M1-M4 四条全红且归属正确 + 三份 sha256 复原逐字一致 + 红证 `INJECTED-RED-D1053` **0 残留**

**关键证据（DEV-5 闭合）**：`M3 + 只跑 C1` = **RED**，`expected 0.3 to be 0.55` @ `tests/routes/settings.test.ts:151` —— 第二消费者 `/api/config/dump` 滞留旧值，**命中的正是 25-8「部分消费者滞留旧值」失效模式本身**。

## 自验结论（链条）

`成员 C 实现 → 成员 V 独立自验（不得兼任编码；4 批 20-V/22-V/24-V，每批新基线重跑）→ 队长「自验结论」 → CTO 收件闸 → K3 终审`

- V 三轮结论均为 **`自验结论：可提请独立审计`**（自验人 `d1053-verify` ≠ 实现者 `d1053-impl` ⇒ 无 M3 型事故）
- 队长收尾三件：`docs/synova/product-lines/evidence/D1053/30-队长收尾三件.md`（diff / 自验结论 / 遗留清单）
- **本 PR 不判"通过"**；通过与否归 CTO 收件闸四判据 + K3 终审。**有条件通过 = 未通过。**

## 偏差登记（全部已处置或已出卡）

| # | 级别 | 内容 | 状态 |
|---|---|---|---|
| DEV-1 | P2 | live 键行 `defaultValue` 返 null | **closed**（C `f80992a9` + 断言；V 复核） |
| DEV-2 | P2 | `counts.restart` 曾计入未声明行 | **closed**（C `f80992a9` + 四条不变量；V 复核） |
| DEV-3 | P3 | 规格 §8.3 写 M2⇒A3，实测 A1 | **closed**（S `8b7759b9`） |
| DEV-4 | P3 | 规格 §7.2 字段名 `settingsApplies` vs 实现 `settings` | **closed**（S `8b7759b9`，以实现为准） |
| DEV-5 | P2 | **C1 不具 M3 判别性**（先改盘后首读） | **closed**：C `34554877` 改「预热→改盘→再比」+ 删恒真断言 → S `2680b1d8` 回填行号 → **V `24-V` 复核 `M3+只跑C1` = RED** |
| — | 注记 | `f80992a9` subject 写「counts.restart **计入**未声明」，语义应为「**修：曾**计入」；**以代码为准**（`src/routes/settings.ts:117-118` 含 `row.declared &&`） | 已登记（不改历史提交） |

## 与 K3 批次1 判定相关联的偏差（登记，非本 PR 缺陷）

| # | 内容 |
|---|---|
| 判据来源未落 main | K3 批次1 报告（`2026-09-28-K3-产品线审计-批次1-线25线1.md`）**只在 `origin/audit/k3-20260928-batch1-line25-line1`**（commit `643069b9`），`git log main -- <path>` 为空 |
| 线25 分母 | main 的 yaml 线25 = **9 点**（25-1…25-9）；K3 按派单定义审的 **25-10 尚未落 main** |
| 完成度口径 | 派单件"线25 5/10 → 8/10、verified 11→14"为 **K3 verdict 口径**；`product-progress.json` 权威口径 = `pending_k3` **不计入** verified（现 0/9、全项目 0、pending_k3 51） |
| Node 口径 | K3 批次1「Node 22 权威」**已反向过期**：实测 `better_sqlite3.node` = **ABI 137 = Node 24**（Node 22 下 Bootstrap 套件 `Phase 0 fatal`）⇒ 本 PR 全部证据出自 **v24.19.0** |

## 三声明源对齐（D708）

`brief ## 写集` ↔ `dev doc §2.2 文件清单` ↔ `本 PR 正文「## 写集」` 三处以**同一 8 件**为准（+ 治理产物 28 件不计预算）；`## 写集豁免` = **无**。

## 合并与后续

- **merge_method = `merge`**（勿 squash）
- 反向依赖：**本 PR 合入后 25-7（审计员复核插件化体系，`k3_only`）可复审翻绿** —— 一格工作换三格（25-7/25-8/25-9）
- 出卡待处置：**L1 A2 假绿实物（P0，须 CTO/control-tower）** ｜ L2 K3 Node 注记（audit 域）｜ L3 既存例外收敛路径 ｜ L4 同键多消费者默认值 4 落点/2 默认值未消除 ｜ **L5 yaml note DSH 锚点重锚（CTO 已宣布并行 PR；口径行待创始人确认）** ｜ L6 本 PR 由 CTO 创建 ｜ L7 subject 精度注记 ｜ L8 V 的 /tmp harness 未入库（K3 如需可索）｜ L9 25-10 未落 main ｜ L10 证据时效（3 天内送审）
