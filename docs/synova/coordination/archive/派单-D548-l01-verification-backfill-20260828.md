# 派单：L01 桌面端验证点回填（D548）

> 派单: CTO | 2026-08-28 | 认领: 📋 dev-doc（核实证据 + 撰写回填 spec）→ 🛠 编码（更新 product-progress.json）→ CTO 复核
> 方法论: 部署主线（T-M-01/T-M-04）的 Mac 侧证据补全——D536 已实测 Mac 全链，验证点状态未回填（L01 0/8 → 目标 5-6/8，总进度 4% → ~6-7%）
> 流程: dev-doc 核实 D536 Mac 实测证据 ↔ L01 验证点对应 → spec 列回填清单 → 编码更新 json → refresh → CTO 复核
> 上一轮教训: evidence/ 被 .gitignore 忽略（既定设计，K3 靠 runbook 复跑）；D544 曾轻率跳过 DSH 借鉴核查；brief 骨架不得随派单进 main（D547 已加门禁）

---

## 写前核实（强制清单 — §〇c ①）

- [x] ① 任务来源/依赖: 部署主线 Mac 侧证据补全（T-M-01 Win 侧并行，本单 Mac 侧）。上游：D536 部署验收（Mac 闭环，实测通过 2026-08-26）。
- [x] ② task-state 最新状态: D548 = claimed（本单）；D547 已补回填（骨架 brief 门禁，撞号已解）。
- [x] ③ 基线资产实际存在（物理确认）:
  - `docs/synova/runbooks/founder-demo-mac.md`（main，D536 完成态："真实安装实测通过——四段结论"）
  - `scripts/desktop/mac-install-verify.sh`（exit 0 可用）、`scripts/desktop/upgrade-data-verify.sh`（DATA_RETAINED）
  - `docs/synova/product-lines/product-progress.json`（L01 8 验证点全 uncommitted）
  - evidence/D536-*（本地，.gitignore 忽略——K3 靠 runbook 复跑）
- [x] ④ DSH 借鉴核查: 本单是验证点取证回填（非新功能），无 DSH 借鉴——显式写「无 DSH 借鉴（证据回填任务，不涉及新能力）」，防执行方猜测。
- [x] ⑤ 写集重叠检查: D548 未占用；写集 docs/synova/product-lines/ 与在途任务零重叠。
- [x] ⑥ 上一轮教训: D536 evidence 不入 git 是既定设计（回填标注 runbook 引用即可）；D544 借鉴核查不能轻率跳过。

## DSH 借鉴核查（强制章节 — §〇b 三步）

1. **施工图四色归属**: L01 桌面端 = 🟢 死守（品牌表层）。
2. **借鉴边界判定**: **无 DSH 借鉴**——本单是验证点状态回填（证据引用 + status 更新），不涉及新能力/新机制，无 DSH 范式可借鉴。
3. **DSH 源码参考**: 无。

> 红线：不引 DSH 代码；验收含接线审计（product-progress 生成链路）。

---

## 切片定义（CTO 已定，dev-doc 复核）

| 切片 | 用户可见价值 | 验证锚点 | 依赖 |
|---|---|---|---|
| D548（本次） | L01 桌面端进度从 0/8 → 5-6/8（真实实测证据，非纸面） | L01 验证点 status 回填 verified + 证据引用 | 上游 D536 Mac 实测证据 |
| （并行）T-M-01 | Win 部署验收 | Win 物理机实测 | 本单 Mac 侧证据对照 |

## 现状材料（dev-doc 必读，先读实际代码不凭记忆）

| 资产 | 位置 | 状态 | 与本单的关系 |
|---|---|---|---|
| Mac 实测证据 | `docs/synova/runbooks/founder-demo-mac.md`（main） | D536 完成态「实测通过」 | 验证点回填的证据源 |
| 一键脚本 | `scripts/desktop/mac-install-verify.sh` / `upgrade-data-verify.sh` | exit 0 / DATA_RETAINED | 可复跑验证（K3 复跑入口） |
| product-progress.json | `docs/synova/product-lines/product-progress.json` | L01 8 点全 uncommitted | 回填对象 |
| L01 验证点定义 | 同 json `lines[0].points` | 8 点（1-1 安装包/1-2 Win/1-3 Mac/1-4 自启/1-5 引导/1-6 首诊/1-7 升级/1-8 复核） | 回填映射对象 |

## D548：l01-verification-backfill（验证点取证回填）

**目标**: 用 D536 Mac 实测证据（已入库 runbook）回填 L01 可支撑的验证点，L01 从 0/8 → 5-6/8，总进度 4% → ~6-7%。

**依赖**: 无（Mac 证据现成；Win 侧 T-M-01 并行不依赖）。

**spec 必须覆盖的内容**（dev-doc 撰写时逐节落实，缺一返修）:

1. **「验证点-证据映射表」章节**: 对 L01 8 个验证点逐条判定：
   - 可回填（Mac 侧证据充分）: 1-1（CI artifact 存在+md5）/ 1-3（Mac 实测安装通过）/ 1-4（启动+出窗实测）/ 1-6（首诊 1.8s，安装全程 <30min）/ 1-7（upgrade-data-verify DATA_RETAINED）
   - 待核实: 1-5（双引导收敛 D518——核实 release 产物是否单一引导入口）
   - 不可回填（归其他）: 1-2（Win，T-M-01）、1-8（审计复核，K3/审计员独立重跑）
   - 每条给: 验证点 id + 证据来源（runbook 章节/脚本名）+ 判定（回填/待核/归他）
2. **「回填方法」章节**: product-progress.json 的验证点 status 更新规则（uncommitted → verified + evidence 引用字段，格式对齐现有 verified 点如 L07-1/7-3）+ refresh-all.sh 生效。
3. **「诚实声明」章节**: 明确哪些点是"实测证据回填"、哪些是"待核/归他"——不把 1-2/1-8 误标 verified（M2 红线：声称 vs 事实）。
4. **「可复跑验证」章节**: 每个回填点给 K3/审计员的复跑命令（mac-install-verify.sh / upgrade-data-verify.sh），证据不入 git 时如何独立核（runbook 引用）。

**验收**（物理可复现，禁止文档声称）:

- **映射表断言**: 8 点逐条判定表（回填 5 点 + 待核 1 点 + 归他 2 点），每点带证据来源。
- **json 断言**: product-progress.json 中 L01 回填点的 status = verified + evidence 引用非空；refresh 后 product-progress.html 同步（grep 验证点计数）。
- **复跑断言**: mac-install-verify.sh / upgrade-data-verify.sh 在干净环境 exit 0（可复跑性证明）。
- **诚实断言**: 1-2/1-8 未误标 verified（grep 确认）。

## 写集约束

- **可碰**: `docs/synova/product-lines/product-progress.json`、`product-progress.html`（refresh 生成）、`docs/synova/coordination/`（spec/派单文档）。
- **不碰**: `src/`、`scripts/audit/`（K3 红线）、`scripts/desktop/`（只读复核脚本，不改）、`evidence/`（.gitignore 既定设计，回填用 runbook 引用不复制）。
- **防膨胀（红线）**: 零新组件/脚本；只更新验证点状态 + 证据引用；不改权重/定义/总进度算法。

## 切片级审计

- 本单完成后 CTO 复核（映射表 + json 断言）；K3 审计随部署批次（L01 验证点 verified 可复跑核）。
- task-state 加 `"slice": "deploy-evidence"` 字段。
- 审计验收 = 映射表 + 复跑命令可独立核 从 impl_done → verified。

## 给 dev-doc 的交付要求

1. **spec 文件命名**: `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D548-l01-verification-backfill-20260828.md`
2. **spec 读者是编码 session**: 拿到即可执行（映射表 + json 更新规则全给）。
3. **证据引用格式**: 用 runbook 章节/脚本名（evidence/ 不入 git，禁止假装有文件证据）。
4. **诚实声明**: 1-2/1-8 归他明确标注，不误标 verified。

---

## 写后自检（强制清单 — §〇c ③）

- [x] ① 验证锚点正确（L01 0/8 → 5-6/8，映射表 + json 断言）
- [x] ② D# 未占用（D548 刚取号；D547 撞号已解）
- [x] ③ 依赖链正确（上游 D536 Mac 证据；并行 T-M-01 Win 侧）
- [x] ④ DSH 借鉴核查三步完整（🟢 死守 + 无 DSH 借鉴显式声明 + 无源码）
- [x] ⑤ 现状材料全部核实过（runbook 完成态/脚本 exit 0/json 8 点全 uncommitted 均核实）
- [x] ⑥ 验收物理可复现（映射表/json 断言/复跑/诚实断言）
- [x] ⑦ 术语一致（验证点/L01/deploy-evidence，与 product-progress 一致）
- [x] ⑧ 无遗漏（1-2/1-8 归他、evidence 不入 git、防膨胀）

**交付门槛**: dev-doc 拿到派单可直接撰写 spec（证据映射/回填规则/诚实声明全给）+ 编码拿到 spec 即可执行。

---

## 派单说明（给创始人复制——自包含，零查找）

```
【派单】L01 桌面端验证点回填（D548）
> 认领: 📋 dev-doc（核实证据 + 撰写回填 spec）→ 🛠 编码（更新 json）→ CTO 复核
> slice: deploy-evidence | 与 T-M-01（Win 部署验收）并行

## 背景（一句话）
D536 已实测 Mac 全链（安装/启动/出窗/首诊 1.8s/升级 DATA_RETAINED），但 L01
验证点状态没回填（0/8）——本单把实测证据回填，L01 → 5-6/8，总进度 4% → ~6-7%。

## 现状材料（撰写必读）
- docs/synova/runbooks/founder-demo-mac.md —— D536 完成态「实测通过」（证据源）
- scripts/desktop/mac-install-verify.sh + upgrade-data-verify.sh —— exit 0/DATA_RETAINED（复跑入口）
- docs/synova/product-lines/product-progress.json —— L01 8 点全 uncommitted（回填对象）

## spec 必须覆盖（4 章节）
1. 「验证点-证据映射表」: 8 点逐条判定（回填 5: 1-1/1-3/1-4/1-6/1-7；待核 1: 1-5；
   归他 2: 1-2 Win / 1-8 审计复核）+ 每条证据来源
2. 「回填方法」: status 更新规则 + refresh-all.sh 生效
3. 「诚实声明」: 1-2/1-8 不误标 verified（M2 红线）
4. 「可复跑验证」: 每点给 K3 复跑命令（证据不入 git，用 runbook 引用）

## 写集约束
- 可碰: docs/synova/product-lines/product-progress.json + .html（refresh 生成）
- 不碰: src/、scripts/audit/、scripts/desktop/（只读复核）、evidence/（.gitignore 既定设计）
- 防膨胀: 零新组件；只改验证点状态 + 证据引用

## 验收（物理可复现）
- 映射表: 8 点逐条判定 + 证据来源
- json: 回填点 status=verified + evidence 引用非空 + refresh 后 html 同步
- 复跑: mac-install-verify.sh / upgrade-data-verify.sh exit 0
- 诚实: 1-2/1-8 未误标 verified

## 交付要求（给 dev-doc）
1. spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D548-l01-verification-backfill-20260828.md
2. 证据引用用 runbook 章节/脚本名（evidence/ 不入 git）
3. 诚实声明 1-2/1-8 归他
```
