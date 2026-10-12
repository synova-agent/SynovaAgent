# 卡面 · [K4-A] tags.json 缺 first_order / second_order（存量；CI strict 会红）

> **卡面来源**：K4 批 3 收尾件实测（impl-b U9 / verifier 独立复核）｜**架构基准**：产品宪章 v8.1｜
> **机器真源**：`docs/synova/product-lines/evidence/K4-b3-lead-handover-20261012.md` §六 R/U 表
> **纪律**：缺字段问 CTO，不许猜｜**自建自报号**：本卡由执行小队自建，**编号待 CTO 分配**（`alloc-task-id.sh` 已 DEPRECATED，改用 issue 号作身份）
> **挂称**：里程碑 = K4 · 本体/因果边/循环编号｜执行态 = **未开工**｜阻塞源 = 无

---

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：让 `extensions/ontology/tags.json` 认得**边文件里已经在用的两个标签**，否则 CI 严格模式下会红。

**② 解决什么问题**（实测）：
```
$ tags.json 内逐串计数
first_order  → 0
second_order → 0
causal       → 1
structural   → 1
```
而**变更件普遍在 `tags` 里用 `first_order` / `second_order`** ⇒ 本地 `[V5 软提示]`（不阻断），
**CI（`SYNO_CI` strict）下转硬 ⇒ 转红风险**。
**关键**：这是**存量缺陷**，不是任何一张卡引入的；K4 批 3 的 #234 只是"一碰这些件即暴露它"。

**③ 做完对项目的推动**：消除一条**只在 CI 才红**的存量隐患（与 CTO §五 B6「CI-only 类红已 3 次」同族），
让后续任何碰 `edge-types/**` 的卡**不必反复解释"这条红不是我"**。

**④ 🔴 不做行不行**：**可以做，但代价明确** ——
它不是安全底线、也不是结构缺口；代价 = **每张碰 `edge-types/**` 的卡都要自证"这条红不是我"**（批 3 已发生一次）。
⇒ **欠账级**，诚实标注：优先级低于"合并闸"，但不做会让 CI 长期带一条噪声红。

**⑤ 现在有什么基础**（实测，as_of `local_repo@ba1b22a8b5`）：
- ✅ 检查器存在：组 8 `tags 引用完整性`（`scripts/pre-commit-check.sh`）
- ✅ 标签真源存在：`extensions/ontology/tags.json`
- ❌ `first_order` / `second_order` **在 `tags.json` 内 0 命中**，却在边文件 `tags` 里被使用
- ⚠️ **CTO 裁定 §九 第 6 项已明文**：「`tags` 用合法值，**不扩 `tags.json`**」（扩 = 放宽 `check-file-driven.sh` 检查面 = **门禁语义变更**）

**⑥ 还需要做什么**：**先裁"扩还是改"** ——
① **扩 `tags.json`**：补 `first_order` / `second_order` ⇒ 属**门禁语义变更**（CTO 已明令不做）⇒ 须 CTO 另裁；
② **改边文件 tags**：去掉这两个标签 ⇒ 改语义，且涉 50+ 件；
③ **第三条路（本卡倾向）**：查明这两个标签**是否本就是合法值集的一部分** —— 若 `check-file-driven.sh` 的合法集来自 `tags.json`，
   则"边文件用了非法标签"是**存量违规**，正确处置 = **在 `tags.json` 里补齐合法定义**（这不算"放宽"，是"补登记"）。
⇒ **本卡第一步即 CTO 裁定 ①/②/③ 之一**（属"要改门禁语义"）。

**⑦ DSH 借鉴方式**：**自研** —— DSH 无"本体标签词表"这种领域语义；
唯一可借方向 = 「**声明必须与实际消费者一致；不生效就报错**」（`@deepseek-ai/dsh-invariants/lib/index.js:6-13`）⇒ 本卡正是把"标签词表"与"实际使用"对齐。

**⑧ 涉及代码文件**：
`extensions/ontology/tags.json`（真源）｜`extensions/ontology/edge-types/**`（使用者）｜
`scripts/check-file-driven.sh`（检查器，**只读**）｜`scripts/pre-commit-check.sh`（组 8，**只读**）

---

## Q0: 定位 — 项目拼图 + 文件审计
**a) 在哪一块**：**② 本体层**（宪章 §0.4/§4.1；内容面 `extensions/ontology/`）。
**b) 文件审计**：`tags.json` 存在且被组 8 读取；`edge-types/` 现 **58 件**（批 3 后）；两标签在 `tags.json` 内 **0 命中**。
**c) 结论**：**补齐登记**（若 CTO 裁 ③）或**扩写集改边文件**（若裁 ②）；**新建文件 = 无**。

## Q1: 调研
**a) 业界**：受控词表（controlled vocabulary）实践 = 词表与实例必须**双向可校验**，未知标签应 **fail-closed**。
**b) 顶级团队**：schema 校验器把"未登记枚举值"当**构建错误**，不留"只警告"的口子。
**c) 我们的错**：**铁律 8**（Mock/TODO 不留交付物）同族 —— "临时标签"进了交付物；
且本批 **R18/F2** 教训：**判据自身缺陷比数据缺陷更隐蔽**（"标签缺失"被降级成软提示即属此类）。

## Q2: 范围
**做什么**：**先裁后做** —— ①/②/③ 三选一；落地后**组 8 在 CI strict 下应为绿**。
**不做什么**（**必须带路径**）：
```
不改 scripts/audit/**                （K3 域，红线）
不改 scripts/pre-commit-check.sh     （门禁脚本；改语义归 CTO）
不改 src/l4/ontology-loader.ts       （本卡不涉读取面）
不改 packages/ontology/**            （两套词表合属另卡 [K4-D]）
```
## Q3: 验收 — 入口 → 交互 → 结果
**入口**：`bash scripts/pre-commit-check.sh`（组 8）＋ CI strict 跑。
**交互**：扫 `edge-types/*.json` 的 `tags` → 逐串查 `tags.json` 合法集 → 报未登记项。
**结果**：**未登记项 = 0**；末行 `所有 tags 合法`；exit 0。**并须给反例**：临时加一个非法标签 ⇒ 必报红。

## 架构层: ② 本体层（宪章 §0.4 / §4.1）

## 写集
```
extensions/ontology/tags.json
（若 CTO 裁 ② 则另加：`)
extensions/ontology/edge-types/ 下逐条裸路径（以当刻 ls-tree 实测为准，逐条列全，禁 glob）
.claude/claims/<本卡号>.yaml
docs/synova/product-lines/evidence/K4-b3-tags-registry-<日期>.md
```

## Done 标准
```
① CTO 已裁 ①/②/③ 之一（书面）
② 探针/门禁实跑 ⇒ 未登记标签 = 0，末行 `tags 合法数 = N / N`，exit 0（贴原始输出）
③ 反例（脚本化 + 核"替换确实发生"）：塞一个非法标签 ⇒ 必报红且 exit 1
④ 复原（口径 W：Get-FileHash SHA256 原始字节）⇒ 逐字节一致
⑤ 四元组标注：值 + 口径 + 时点 + 探针版本
⑥ 写集实测 = git diff --name-only <merge-base>..HEAD 全列，零多零缺
```
🔴 **关单信号（CTO 令第 5 条）：全文禁 `Closes`，统一用 `Refs #<本卡 issue 号>`**。建号后把 `<本卡 issue 号>` 换成真号。
