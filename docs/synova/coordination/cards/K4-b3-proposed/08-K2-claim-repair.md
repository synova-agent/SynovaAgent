# 卡面 · [K2-B] claim_store --repair 规则化（带 --dry-run；**转义 `\"` 而非删引号**）

> **卡面来源**：K4 批 3 独立复核 **a-6 越界判定**（verifier 第四轮）+ CTO 令（R11 追认 + 转规则）｜
> **架构基准**：产品宪章 v8.1｜**机器真源**：`docs/synova/product-lines/evidence/K4-b3-VERIFY-lead-claimfix.md`
> **纪律**：缺字段问 CTO，不许猜｜**自建自报号**：编号待 CTO 分配
> **挂称**：里程碑 = K2 · 写入门禁与工具治理｜执行态 = **未开工**｜阻塞源 = **须 CTO 追认 R11**（本卡是 R11 的转规则落点）

---

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：把"我手工修那两份坏声明的做法"变成**一条带试运行的命令**，并且**保留引号**（不删）。

**② 解决什么问题**（实测）：
批 3 发现 `.claude/claims/201.yaml` / `345.yaml` **YAML 子集非法**（`note:` 的续行被当列表项）⇒
`claim_store` 解析**整库 fail-closed**：
```
$ python3 scripts/control-tower/claim_store.py --resolve x
{"status":"invalid", "degraded":true, "reason":"存在畸形 claim 文件: 201: …:15 不是合法列表项…; 345: …:29 …"}
⇒ 所有卡的 claim-first 不可达 ⇒ 提交回落 legacy brief 链 ⇒ 组 12 误判"不在 Q2 范围"
```
**队长为解阻塞，手工折叠了这两件**（属**越界"先做后报"** ⇒ **R11 待追认**）。
**而手工修法有缺陷**（verifier 实测）：
```
201: note 947 → 937 字符、引号 10 → 0
345: note 544 → 539 字符、引号 4 → 0
⇒ 正确自陈 =「机器读字段零变化；note 去引号 + 去尾空格」
⇒ 而"删引号"会抹掉短语边界（`标题'两条门禁同批 rc=0'字面成立` → `标题两条门禁同批 rc=0字面成立`）
⇒ 正确做法 = 转义 `\"`，不是删引号
```
**且这是"第二次在 YAML 双引号标量上踩坑"**（verifier 记）。

**③ 做完对项目的推动**：① 消灭"claim 库被单个畸形件打成 fail-closed"的**单点故障**；
② 把越界手改**转成规则**（否则等于给"任何人可改别人 claim"开口子）；
③ 宪章 **§2.7 一致性**：声明载体自身必须可解析。

**④ 🔴 不做行不行**：**不行**（结构缺口）——
理由：**一个畸形件能让全库 claim-first 失效** ⇒ 这是**单点故障**，且**修复权不明确**
（批 3 实证：#234/#235 两次都撞"声明载体不在执行者写集内"，导致**必须由队长越界**）。
⇒ 不是欠账，是**防线本身有洞**。

**⑤ 现在有什么基础**（实测）：
- ✅ 解析器存在且契约清晰：`scripts/control-tower/claim_store.py`（`parse_claim`，**fail-closed 不降级**，块内已写明）
- ✅ 报错**点名到行号**：「`{path}:{lineno} 不是合法列表项（缩进 `  - 值`）: {stripped!r}`」⇒ 修复面可定位
- ✅ 合规样例充足：25 件中 **20 件为内联 `note`**（最长 480 字符）⇒ **house convention 明确**
- ❌ **无 repair 子命令**；❌ **无 dry-run**；❌ 无"引号转义"策略
- ⚠️ 现有两个畸形件**已由队长手工修好**（工作树态，未提交）⇒ 本卡应**先以它们为回归夹具**

**⑥ 还需要做什么**：
① 加 `claim_store.py --repair [--dry-run] [`--all`|`--issue N`]`：
   · **只做结构折叠**（block/续行 → 内联标量），**内容零改动**；
   · **引号策略 = 转义 `\"`**（**禁删引号**）；
   · **`--dry-run` 必须打印 diff**（前后逐行）；
   · **幂等**（已合规件不改）；
   · **失败即非零退出 + 不改文件**。
② 把两件历史畸形件（`201`/`345` 的**修复前**版本，可从 `ba1b22a8b5` 取）做成**回归夹具**。
③ 明确定义：**`note` 是"人读标量"，单行内联**（写进 `claim_store` 契约注释 + 可能补 README）。
④ 与 [K2-D] 的关系：本卡的"机器读 vs 人读"分层报告，正是四元组纪律的一个实例。

**⑦ DSH 借鉴方式**：**参考自研** —— 借方向的**可借**：
「**包自带判据、宿主只保证"不生效就报错"**」（`@deepseek-ai/dsh-invariants/lib/index.js:6-13`）
⇒ claim 自带 schema 判据（已有）+ **修复工具**（本卡新增），宿主只保证"改坏就报错"。
❌ **不借** DSH 的包隔离（这是仓内工具）。

**⑧ 涉及代码文件**：
`scripts/control-tower/claim_store.py`（加 `--repair`）｜
`.claude/claims/201.yaml`、`.claude/claims/345.yaml`（**回归夹具来源**；注意这两件**不属本队写集**）｜
`tests/control-tower/claim-store-repair.test.sh`（新建夹具测试）

---

## Q0: 定位 — 项目拼图 + 文件审计
**a) 在哪一块**：**K2 写入门禁与工具治理**（认领制声明载体的工具面）。
**b) 文件审计**：`claim_store.py` 有 `--check` / `--resolve` / `--coverage` / `--issue-of` 等子命令，**无 `--repair`**；两件历史畸形件可用作夹具；20/25 house convention = 内联 note。
**c) 结论**：**扩展**（给现有工具加一个子命令；不新建工具）。

## Q1: 调研
**a) 业界**：格式化工具标准 = **idempotent + dry-run + 只改必要处 + 失败不改文件**（gofmt/prettier 范式）。
**b) 顶级团队**：自动修复**必须可预览**；**不得改变语义**（只改结构）。
**c) 我们的错**：**批 3 实证**——队长手工修**改了 note 文本**（去引号）却自陈"零语义"（**不可证断言**，被 verifier 打掉）；
⇒ 教训：**改他人文件必须逐字段列"机器读 vs 人读"影响面**，且**优先可复用脚本 + dry-run**。

## Q2: 范围
**做什么**：加 `--repair [--dry-run]`；引号转义不删除；幂等；两件历史件作回归夹具。
**不做什么**（**必须带路径**）：
```
不改 .claude/claims/201.yaml / 345.yaml          （**非本队写集**；只从 git 取历史版本作夹具）
不改 .claude/claims/**  下其他现有 claim         （夹具只读）
不改 scripts/audit/**                            （K3 域，红线）
不改 scripts/commit-msg-check.sh                 （门禁语义）
不改 scripts/workflow/resolve-commit-brief.sh    （解析链路）
```
> ⚠️ **改 `claim_store.py` = 认领制工具语义变更 ⇒ 须 CTO 复核**（本卡为 R11 转规则的**批准落点**）。

## Q3: 验收 — 入口 → 交互 → 结果
**入口**：`python3 scripts/control-tower/claim_store.py --repair --dry-run --issue 201`。
**交互**：解析 → 定位结构违规行 → 折叠为内联标量（**转义引号**）→ dry-run 打 diff；非 dry-run 才写盘。
**结果**：dry-run 打印前后 diff 且**不写盘**；真实修复后 `--check 201` → `{"status":"ok",...}`；
**并断言"机器读字段零变化 + note 内容逐字符等价（仅引号转义）"**。
**反例**：对**已合规件**跑 `--repair` ⇒ **不改动**（幂等）；对**引号内含 `#` 的件** ⇒ 转义后 `_strip_inline_comment` **不截断**。

## 架构层: K2 写入门禁与工具治理（宪章 §4.7；认领制载体）

## 写集
```
scripts/control-tower/claim_store.py
tests/control-tower/claim-store-repair.test.sh
.claude/claims/<本卡号>.yaml
docs/synova/product-lines/evidence/K4-b3-claim-repair-<日期>.md
```

## Done 标准
```
① `--repair --dry-run` 存在：打印 diff 且**不写盘**（贴原始输出 + exit code）
② **引号策略 = 转义 `\"`**（**不可删引号**）；反例：含 `#` 的 note 修复后**不被截断**（贴前后对比）
③ **幂等**：对已合规件跑 ⇒ 零改动（贴 hash 前后一致，口径 W）
④ **失败不改文件**：故意喂一个无法安全修复的件 ⇒ 非零退出且文件 hash 不变
⑤ **两件历史畸形件**作为回归夹具，修复后 `--check` = ok，且 `writeset`/`done` **逐条不变**
⑥ 契约注释写明「`note` = 人读单行内联标量」
⑦ 四元组：值 + 口径 + 时点 + 探针版本（工具版本）
```
⚠️ PR 正文须写 `Closes #<本卡 issue 号>`（号未分配前用 `Refs` 占位）。
⚠️ 本卡是 **CTO 令 R11「追认 + 转规则」的落点** ⇒ PR 正文须显式引用该裁定。
