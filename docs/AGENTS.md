# docs/ · 施工守则

## 一、这块是什么

`docs/` = 文档契约的 **C 层（长期文档）**：指南/架构/API/领域知识/术语表，一主题一份。
它同时是 D 层（过程，不入库）与 E 层（生成物，三条全满足才可入）的判定现场。
唯一准入门槛一问：**3 个月后一个新人，是否必须靠它才能理解我们为什么这样做？** 否 ⇒ 不进仓库。

## 二、谁可以改

**归属线：治理线** —— `decisions/implemented/process/2026-10-02-role-division-final.md:79`
明文「`docs/AGENTS.md`（文档治理规则）→ 治理线」。
**例外**：`docs/synova/coordination/` 的锚与回执归 **CTO**（同件 `:80`）。

**改这块必须同批做的三件事**：
1. 新增任何 `.md`/`.yaml` ⇒ 同批登记 `docs/authority/DOCS-REGISTRY.yaml`（否则 D2 红）
2. 移动/出库文档 ⇒ 同批同步注册表（「移出必与接手同批」，`docs/synova/DOC-CONTRACT.md:307`）
3. 改导航层事实（专家数/门禁组数/版本轴）⇒ 同批对齐 `AGENTS.md`·`CLAUDE.md`·`LOOP.md`（否则 D1 红）

**越界判定**（照同件 `:51-56`）：出【规则/门禁/CI/迁移/文档治理】⇒ 治理线；出【方向/跨线裁决】⇒ CTO；
出【钱/风险/不可逆/红线】⇒ 创始人。改 `DOC-CONTRACT.md` 本身 ⇒ 走 `decisions/` + K3 复审（`:288`），**不得自改**。

## 三、改完怎么算完成

**必须穿的生产入口**（实测调用链，非推断）：
1. `bash scripts/pre-commit-check.sh` → `:1469` D1 + `:1486` D2（本地软提示，`SYNO_CI=1` 时转硬阻断）
2. `.github/workflows/ci.yml:146` 以 `SYNO_CI: "1"` 跑同一脚本 ⇒ **CI 才是权威**
3. `ci.yml:57` docs-only 分类：改动须命中 `^docs/.+\.(md|json|html)$` 才走瘦身，否则全量 CI

**本域独有红线**：
- 🔴 不得新增「报告类 md」（`DOC-CONTRACT.md:334`）
- 🔴 禁新建索引/台账/看板 md —— 检索用 `git grep`（`:84`）
- 🔴 归档即冻结：归档件不得再编辑、重排、移动或删除（`:150`）
- 🔴 `coordination/` 在 §3 闸 3 阻断面（`:214`）

**「改坏即红」最小用例**（本窗实测：18 通过 / 5 通过，全绿）：
```
bash tests/doc-system/doc-registry-gate.test.sh   # 用例 A/H1：新增未登记 → exit 1
bash tests/doc-system/check-doc-truth.test.sh     # 用例 B/C/D/E：四类事实漂移 → exit 1
```
本窗实测 D2 **已红**：`.github/AGENTS.md`、`expert/AGENTS.md`、`scripts/control-tower/AGENTS.md`、`src/l4/AGENTS.md` 未登记（含本文件 —— 须与它们同批登记）。

## 四、不在这里的事

`decisions/**`（B 层）、`memory/notes/**`、`task-state/**`、`scripts/doc-system/**`（执行体：归治理线，但不在 `docs/` 路径内）、
根 `AGENTS.md`/`CLAUDE.md`（A 层入口，CTO + 创始人裁）、库外档案仓 `~/Synova-过程档案/`（§11，不进主仓）。

## 五、不确定找谁

【待定】`docs/` 下 236 件 `.html` 仍属「三不管」：闸 3 白名单只列 `.md`（`:193`），D2 只扫 `\.(md|yaml)$`（`scripts/doc-system/doc-registry-gate.sh:84`）。
范围修正件已出（`docs/synova/coordination/2026-10-02-D2-文档治理范围修正件-治理线一窗.md`），**执行体未并入**：
`scripts/control-tower/check-doc-contract.sh` 在本窗不存在，契约三闸（格式/取代/入库）**目前无机器执行体**。
⇒ 契约合规判定**归 K3**，不要按本文件推断；本域归属争议找治理线，跨线找 CTO。
