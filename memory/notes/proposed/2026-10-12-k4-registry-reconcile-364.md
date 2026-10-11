# 2026-10-12 · #364 登记件与卡面/交付对账（K4）

- **状态**：proposed
- **触发**：K4-04（#237）关单后的 CTO 收尾核查，发现「机器真源」`docs/synova/coordination/施工项登记.ts` 与卡面/交付三处不一致。
- **决策**：按卡面（权威）对齐登记件，而不是反向改卡面。

## 改了什么
1. `B2-GRAPH`：`status: todo → done`（已合并 `dc5ce093c` + 卡 #237 已关单）。
2. `B2-GRAPH.acceptance` 与 `paths` 中的 `tests/l4/edge-query.test.ts` → `tests/adapters/sqlite-graph-store.legacy-schema.test.ts`。
   - 旧值 **在树上不存在**（`git ls-tree` 零命中）⇒ 该判据**永久 vacuous**；新值 = 卡面 Done① 点名的验收件（实测存在）。
3. `1-8` / `1-9` / `3-5` / `3-11`：`status: todo → doing`（批 2 在飞，四条 PR open）。
4. 新增条目 `B2-GRAPH-2`（= 卡面 **#345**，K4-04 Done④ 拆卡），并把 `B2-GRAPH-2` 补入 K4 块 `items`。

## 为什么不改 glob
登记件全件普遍使用 glob（`extensions/ontology/activity/`、`src/l4/**`、`cycles/builtin/*.cycle.json` …），
且 `check-registry-invariants.ts` **不校验路径精度** ⇒ glob 是登记件的既有约定，**不属本卡**。
「写集禁 glob」是**claim/brief 侧**的规则（门禁按字面匹配）。⇒ 本 PR 不动 glob，另记。

## 未动、留待核实
- `1-8` 的 `acceptance` 指向 `tests/sentinel/edge-lag-consumed.test.ts`（该文件**当前不存在**）。
  它是否为 1-8 的**预期交付物**需先读卡面 #234 才能判 ⇒ **不擅自改判据**，留待核。
- `0-4`（= K4-06 五阀）`status: todo` **实为正确**（未开工），不动。

## 验证
本地跑 `npx tsx scripts/control-tower/check-registry-invariants.ts`：
① 唯一性 82/82 ／ ② 引用完整性悬空 0 ／ ③ 归属一致 0 处不一致 ／ ④ 命名规则过 ／ ⑤ issue 唯一性 82/82 ／ ⑥ issue 必填过
⇒ `RESULT=PASS`，阻断级违例 0。

## 教训（本轮 CTO 自身）
首版编辑脚本用「就近缩进」解析条目块 ⇒ **改错 5 个无关条目的 status**；
因提交前逐条核对 diff 才发现（等同开工令 警告③「批量替换制造新错」）。
改为「以 `id:` 行为锚、就近括号匹配」并加**逐条自断言**（done +1 / doing +4 / todo −5）后重做。
⇒ 纪律候选：**批量/脚本化改判据源前，必须先解析出目标边界并逐条断言，禁止按位置猜。**
