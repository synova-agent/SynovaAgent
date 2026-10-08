# 决策 Note — 0-4 循环编号映射（#978 / 卡 K4 · 第0批-止血）

- 状态: proposed（待 CTO 收件闸 + K3 终审后 `git mv` 到 implemented/）
- 日期: 2026-10-08
- 责任方: synova-squad-lead（队长）｜执行位: sra-map
- 触发: CTO 2026-10-08 v3 派单「资产积累的第一口饭」派单 E（#978）；本 Note 由**门禁要求**产出（D395-a：暂存含 `scripts/control-tower/**` ⇒ commit 必须引用真实 Note），并经队长实测 `scripts/commit-msg-check.sh:249`（`CT_ORCH_TOUCHED=` 判定行；该文件在 origin/main 与本工作树均为 **278 行**）触发条件成立。

## 决策

1. **路线取 (b)：按新体系重写，不写映射层。**
   理由三条（均可核）：
   - **（a）在写集内物理不可实现**：卡面 §四.2(a) 要求「加载器翻译」，但 §九「绝不能碰」明列 `src/cycles/cycle-loader.ts` ⇒ 翻译环节无处落地。
   - **（a）产出的是死数据**：§四.4 + C7/C8/C9 实测 `edgeRefs`/`mapping` **零消费者**（`src/cycles/cycle-types.ts:29` 仅类型声明）⇒ 映射层只会把死数据换成两层死数据。
   - **机械映射会误配**：权威42 ∩ 代码55 = **13**；权威有代码无 **29**；代码有权威无 **42** ⇒ 两套是**不同集合**，不是同一物的两种写法。
2. **目标形态统一取 `$id`（`edge/<snake>`）**，不取 `label`；证据文件另附 label 供核。
3. **判据只用反例证伪，不用 grep 型静态判据当验收**（本仓既有纪律）：
   - 「改坏即红」：任一条 `edgeRefs` 置回 `E-1.1` 形态 ⇒ probe 必 exit 1。
   - 「漏改即红」：只改 `edgeRefs` 不改 `mapping[].edgeId` ⇒ 残留 23 处 ⇒ probe 必 exit 1。
4. **卡面命名权威优先于代码字面证据**：`E-3.7` 保留卡面候选 `edge/capital_allocation`（尽管 `innovation_output.json` 的 description 字面含「研发投入」），`E-4.6` 保留卡面候选 `edge/external_feedback`（尽管仓内两条信号指向 `customer_data_loop`）。**偏差不静默覆盖，作为待裁项逐条上报 CTO**（见下「待裁项」）。

## 依据（参考系，K3 可核）

- **第一性原理**：编号体系的价值 = **两侧能被第三方在无上下文条件下对上**。当前 `E-N.M` 是**第三套私有编号**（权威01 里 `E-N.M` 出现 0 次、代码边里 0 次）⇒ 保留它会永久制造第三套语义。
- **Anthropic 工程基线**：判据交付物须**自带生效判据**、不生效即报错（fail-closed）；本卡 probe 三态 exit（0 通过 / 1 违规 / 2 词表缺失 fail-closed）。
- **开源实证 / 本仓既有范式**：ratchet（存量只减不增）优于一次性清洗——本卡把 `cycles/` 的 `E-x.y` 降到 0，为后续「不得回加」留出机械判据。
- **收敛检查**：本决策不动 `src/**`、不动 `scripts/workflow/system-registry.json`（35 条跨基域，卡面 §四.5 明令本卡不动），不越 `scripts/audit/**` 红线。
- ⚠️ **行号勘误留痕（队长自陈）**：本 Note 初稿曾写 `scripts/commit-msg-check.sh:140`，经执行位实测纠偏为 **`:249`**（判定行 `CT_ORCH_TOUCHED=`；文件 **278 行**）。错误根因同本批另两处：队长量的是**本机主工作区**，而该树**落后 origin/main 1404 个 commit**（其 `commit-msg-check.sh` 仅 **132 行**，与 origin/main 的 278 行不同版本）。**教训：行号/文件存在性一律以 `git show origin/main:<path>` 为准，禁在主工作树量真值。**

## 实测证据锚（本 Note 的决策所据）

```
改前：git grep -ohE "E-[0-9]+\.[0-9]+" origin/main -- cycles/ | wc -l   → 45
改后：git grep -ohE "E-[0-9]+\.[0-9]+" -- cycles/            | wc -l   → 0
口径：edgeRefs=22 + mapping[].edgeId=23 = 45（distinct=17）
probe：legacy_occurrences=0 / $id=55 / label=55 / distinct_used=15 / unknown=0 → exit 0
```

## 待裁项（不静默覆盖，上报 CTO）

- **R1 `E-3.7`**：卡面候选 `capital_allocation` vs `innovation_output.json`（description 字面含「研发投入」、requiredProps 含 `rd_spend`）——本轮按**卡面**执行。
- **R2 `E-4.6`**：卡面候选 `external_feedback`（requiredProps 为竞争反应口径）vs 仓内两条信号指向 `customer_data_loop`——本轮按**卡面**执行。
- **R3 折叠**：`E-1.1`/`E-2.1`/`E-3.7` → 同一 `edge/capital_allocation`（卡面候选即如此）⇒ 旧编号区分度丢失，属路线 (b) 已知代价。

## 失效条件

本 Note 的决策 1（路线 (b)）在下列任一成立时失效并需重裁：① CTO 裁定改走 (a) 并**同时**授权扩写集到 `src/cycles/cycle-loader.ts`；② 后续新增 `edgeRefs`/`mapping` 的真实消费者（则该字段从「惰性元数据」变为运行时契约，重写口径需重评）。决策 4 在 CTO 对 R1/R2 出裁决后由裁决覆盖。
