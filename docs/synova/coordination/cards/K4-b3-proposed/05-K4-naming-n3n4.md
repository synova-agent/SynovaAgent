# 卡面 · [K4-E] 边名 N3/N4 认领收口（消掉 #65 新边上的「待 N3/N4 确认」）

> **卡面来源**：K4 批 3 #65 落地实测（impl-c W-4）＋ CTO 2026-10-08 裁定 §2（命名须在《命名权威登记册》认领 N3/N4）｜
> **架构基准**：产品宪章 v8.1｜**机器真源**：`docs/synova/product-lines/evidence/K4-b3-1350-edge-vocabulary.md` §四 W-4
> **纪律**：缺字段问 CTO，不许猜｜**自建自报号**：编号待 CTO 分配
> **挂称**：里程碑 = K4 · 本体/因果边/循环编号｜执行态 = **未开工**｜阻塞源 = **库外**（《命名权威登记册》不在本仓）

---

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：把两条新边的名字**正式登进名册**，消掉文件里那句「⚠️ 命名待 N3/N4 认领确认」。

**② 解决什么问题**（实测，`a7437498c`）：
两条新边的 `description` **逐字**带：
> `⚠️ 命名待《命名权威登记册》N3/N4 认领确认。`
```
extensions/ontology/edge-types/goal_decomposes_to.json   $id=edge/goal_decomposes_to  label=GOAL_DECOMPOSES_TO
extensions/ontology/edge-types/plan_commits_to.json      $id=edge/plan_commits_to     label=PLAN_COMMITS_TO
```
⇒ 这两条边**已落盘、已可装载、已被测试认领**（58 件、`loadOntology().edgeTypes.length === 58`），
**但名字仍处"待认领"态** ⇒ 属**欠账**：文件里带着一个未消的"待确认"。
**另**：CTO 裁定 §2 原文要求「**须在库外《命名权威登记册》认领 N3/N4**」⇒ **该登记册不在本仓**
（批 3 已实测：卡面要求的提案文档目录也不在本仓，impl-c 登记为 **W-7**）。

**③ 做完对项目的推动**：① 消掉交付物里的"待确认"标记（**铁律 8**：TODO 不留交付物）；
② 让**边名有唯一权威**（宪章 §2.7 一致性）；③ 为 **[K4-C] 的落点裁定**提供命名层的前提
（若名字本身未认领，落点裁定会建在沙上）。

**④ 🔴 不做行不行**：**可以做，但代价明确** ——
不是安全底线（两件边已能正常装载/消费）；代价 = **交付物永久带"待确认"**，
且**下游任何引用这两个名字的卡都得重复解释"名字还没认领"**。
⇒ **欠账级**，但**因涉及"库外名册"，需要 CTO 牵头**（本队无权代认领）。

**⑤ 现在有什么基础**（实测）：
- ✅ 两件新边已落盘并可装载（58 件；V2 20/20 通过）
- ✅ 命名规则有先例可依：既有 58 件的 `$id` **全为 `edge/` 前缀**，名字部分 **45 下划线 / 5 连字符 / 6 单字**；新边用**下划线** ⇒ 与多数态一致
- ✅ 判据已存在：`tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts` 断言两件的 `$id`/`label`
- ❌ **N3/N4 认领回执不存在**；❌ 《命名权威登记册》**不在本仓**（库外）

**⑥ 还需要做什么**：
① **CTO 给出 N3/N4 认领回执**（或确认"无需认领、以本仓 `$id` 为准"）；
② 若认领 ⇒ **同 PR 内**把两件 `description` 的「待 N3/N4 认领确认」改为"**已认领 N3/N4（回执见 …）**"，并**保留订正痕迹**（不抹旧）；
③ 若确认无需认领 ⇒ 改为「**命名以本仓 `$id` 为唯一真源；无库外名册依赖**」并说明依据；
④ **把《命名权威登记册》是否落仓**作为子问题一并裁（B4：引用外部裁定须落仓内可引原件）。

**⑦ DSH 借鉴方式**：**自研** —— DSH 无"边名权威登记册"这种治理载体；
可借方向 = 「**声明必须与实际消费者一致；不生效就报错**」（`@deepseek-ai/dsh-invariants/lib/index.js:6-13`）
⇒ "名字已认领"应可被**判据**验，而不是靠注释里的口头承诺。

**⑧ 涉及代码文件**：
`extensions/ontology/edge-types/goal_decomposes_to.json`（`description`）｜
`extensions/ontology/edge-types/plan_commits_to.json`（`description`）｜
`docs/synova/coordination/numbering-authority.md`（若需登记 N3/N4）

---

## Q0: 定位 — 项目拼图 + 文件审计
**a) 在哪一块**：**② 本体层**（命名治理面；宪章 §0.4/§4.1）。
**b) 文件审计**：两件新边存在（58 件中最后两件）；`description` 带"待 N3/N4 认领确认"；**库外名册不在本仓**。
**c) 结论**：**扩展/订正**（改两件 `description`；不新建边）。

## Q1: 调研
**a) 业界**：命名权威登记册（name registry）用于防止同名不同物；认领 = **一次性、可查、带回执**。
**b) 顶级团队**：标识符注册表 + 引用校验；**未注册名不得进主干**。
**c) 我们的错**：**铁律 8**（TODO 不留交付物）—— "待认领"标记进了交付物；
另批 3 **B4 教训**：「逐字/原文照贴类要求，必须以**仓内可引原件**为前提，否则复核员只能比转述」。

## Q2: 范围
**做什么**：消掉两件 `description` 里的"待确认"；给出 N3/N4 认领回执或"无需认领"的书面裁定；裁《命名权威登记册》是否落仓。
**不做什么**（**必须带路径**）：
```
不改 extensions/ontology/edge-types/ 下既有 58 件中的任何其他件
不改 extensions/ontology/manifest.json        （属 [K1] / #65 已交付）
不改 packages/ontology/**                     （属 [K4-D]）
不改 scripts/audit/**                          （K3 域，红线）
不改 tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts  （#65 判据物；若必须改须声明串行）
```
## Q3: 验收 — 入口 → 交互 → 结果
**入口**：`grep -rn "待 N3/N4 认领确认" extensions/ontology/edge-types/`。
**交互**：读两件 `description` → 断言无"待确认"字样 → 断言认领回执（或"无需认领"裁定）在仓内可引。
**结果**：`grep` **0 命中**；两件 `description` 含认领结论 + 回执路径；exit 0。
**反例**：把任一件的"已认领"改回"待确认" ⇒ 判据必红。

## 架构层: ② 本体层（命名治理；宪章 §0.4 / §4.1）

## 写集
```
extensions/ontology/edge-types/goal_decomposes_to.json
extensions/ontology/edge-types/plan_commits_to.json
docs/synova/coordination/numbering-authority.md        （若需登记 N3/N4）
.claude/claims/<本卡号>.yaml
docs/synova/product-lines/evidence/K4-b3-naming-n3n4-<日期>.md
```

## Done 标准
```
① `grep -rn "待 N3/N4 认领确认" extensions/ontology/edge-types/` = 0 命中（贴原始输出 + exit code）
② 两件 `description` 含认领结论；回执或"无需认领"裁定**在仓内可引**（B4）
③ 反例（脚本化 + 核"替换确实发生"）：改回"待确认" ⇒ 判据红
④ 复原（口径 W）逐字节一致
⑤ 保留订正痕迹（不抹旧的"待确认"表述记录）
⑥ 四元组：值 + 口径 + 时点 + 探针版本
```
⚠️ PR 正文须写 `Closes #<本卡 issue 号>`（号未分配前用 `Refs` 占位）。
