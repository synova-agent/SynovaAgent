---
状态: proposed
日期: 2026-09-28
任务: D1053
决策: 线25 25-8/25-9（live/restart 设置生效语义分类）取「**借范式自研 + 默认安全 + 单 accessor + 可 dump**」四件套口径实现：① 声明式命名空间注册（每键 `applies: 'live'|'restart'`）；② **未声明的设置项一律不按 live 处理**（强制 restart 语义）并在启动打印未声明清单；③ live 键每次现读、restart 键返回 boot 快照（重启前绝不半生效）；④ 两消费者（`/api/settings/effective` 与 `/api/config/dump`）读同一 accessor，保证「无部分消费者滞留旧值」。叠加与 provenance **复用 D599 `src/config/config-layers.ts`**（B-10 落点，已在 main），不重写第二套。
理由: ① **DSH 侧锚点已断**（K3 批次1 P1-2 独立复现）：yaml note 引 v0.1.6-alpha.2 的 `SettingsApplies`（`lib/types/index.d.ts:21` / `lib/index.js:288`），但锁定快照 0.1.7-rc.1 中 `SettingsApplies` 全仓 0 命中、`packages/settings/settings/lib/index.js:446` **硬编码 `applies:"live"`**、`packages/settings/settings/lib/types/types.d.ts:32` 仅字面量 `applies:'live'`；`?? "live"` 全仓 0 命中；`dsh-settings-file` 包与 `patchNode` 符号**在快照中不存在** ⇒ 不能写「接入 DSH 的 live|restart 分类」（能力不存在），只能借第六章「复制范式而非代码」(`第六章-借鉴清单...:21`) 的范式面，并把 DSH「恒 live 默认」当作 **25-9 要防的半生效盲区的反例锚点**。② **默认安全的必要性**（第一性原理）：漏声明 = 静默按 live = 半生效，是分布式不一致在单进程配置面的最小形态；故 fail-closed 方向必须是「未声明 ⇒ 不比 live 更激进」。③ **单 accessor** 才能让「全部在跑的消费者观察到同一新值」可判；多 accessor = 必然漂移（同类第 N 次）。④ 不引 `@deepseek-ai/*` 包（处置表 `dsh-settings` = 接缝-预留；红线禁引）。
---

# 决策 Note — D1053 线25 live/restart 设置分类（实现口径）

> 任务: D1053 ｜ 小队（队长 `synova-squad-lead`）｜ 分支 `feat/d1053-live-restart-settings` ｜ base `origin/main` @ `20b55eba`
> 依据计划：v1.2 @ sha256(content)=4e46603f（实测命中；git blob = 8078f15b，两数皆真）
> 判据来源：K3 批次1 报告 FIX-C（commit `643069b9`，**未落 main** —— 见 00-premise-freeze P7）
> 状态：proposed（待 CTO 复核放行 + K3 复审通过后 `git mv` 到 `implemented/`）

---

## 1. 触发场景

25-8 / 25-9 是线25 第 8、9 格验收点：live 类（展示/阈值/文案）改值后下一次读取即返回新值；restart 类（连接/插件/数据源/鉴权）重启前不得半生效。K3 批次1 实测两点 **零实现零测试**（`src/` 仅 `src/l3/rule-loader.ts:26` 无关 `appliesTo`；`tests/` 零命中；`node_modules/@deepseek-ai` 不存在）⇒ 判 fail，并连带 25-7 体系复核 fail。K3 给的翻转点即本卡（FIX-C）。

## 2. 实测依据（命令原始输出，完整见 `docs/synova/product-lines/evidence/D1053/00-premise-freeze.json`）

| # | 事实 | 证据 |
|---|---|---|
| F1 | DSH 快照 = `0.1.7-rc.1` @ `46a7f68b`；`SettingsApplies` **0 命中** | `git grep SettingsApplies` 计数 0 |
| F2 | DSH `applies` **硬编码 `"live"`**（无注册期声明、无 restart 取值） | `packages/settings/settings/lib/index.js:446` |
| F3 | 现快照**没有 live\|restart 二元分类**可接入 | `lib/types/types.d.ts:32` 字面量 `applies: 'live'` |
| F4 | `dsh-settings-file` 包 / `patchNode` 符号**不存在** | `find` 空 + `git grep patchNode` 计数 0 |
| F5 | 仓内**已有** B-10 落点可复用（不重写） | `src/config/config-layers.ts`（D599，附录A:227 实证落 main） |
| F6 | 25-8/25-9 的 yaml evidence 串 = `settings-applies-live` / `settings-applies-restart` | `product-lines.yaml:1166-1175` |
| F7 | A2 管线**已在**尝试定位这两套件并静默跳过（假绿前提） | `list-test-points.py` 含 25-8/25-9；`run-machine-evidence.sh:76-80` |

## 3. 决策

1. **不引包**：`@deepseek-ai/dsh-settings` = 接缝-预留 ⇒ 只借范式（声明式分层 + namespace 注册 + schema 化 + 来源可 dump），代码自研。
2. **默认安全**：未声明项 ⇒ 强制 `restart` + 启动清单（可观测）；比对 DSH「恒 live 默认」形成反向边界。
3. **生效边界而非读取时机**：`live` 每次现读、`restart` boot 冻结并暴露 `pending`（暂存可见但不生效）。
4. **单 accessor + 双消费者**：`/api/settings/effective`（新增）与 `/api/config/dump`（扩列）读同一 accessor ⇒ 「同一新值」可判。
5. **写集收缩**（避跨卡重叠）：不碰 `src/routes/diagnosis.ts`、`src/routes/conversations.ts`（D1051 在飞）、`src/sentinel/baseline-store.ts`（3 未合并分支）；`src/server.ts` 仅 +2 行。
6. **锚点现查**：所有 DSH 引用为注释锚点 + 现验命令，**不写死行号**（K3 P1-2 的 M6 教训）。

## 4. 待裁（CTO 放行前）

1. yaml note 的 DSH 锚点重锚方式（并行 PR / 授权改 note / 全不动）。
2. 决定④「鉴权类 = restart」与既有 LLM 凭证热重载（`src/config.ts:76` + `tests/routes/llm-config.test.ts:165`）的口径冲突。
3. default-safe 的适用边界（新声明面 vs 全量设置项）。

## 5. 回退

本卡为纯新增面（新文件 + `src/server.ts` 2 行 + `src/routes/config.ts` ≤15 行）⇒ 回退 = `git revert <本 PR merge>` 即回到现状，无数据/契约迁移。
