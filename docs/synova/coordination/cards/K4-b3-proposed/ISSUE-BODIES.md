# K4 批 3 · 9 张待建 issue（CTO 令 §三 / 第 3 条）

> **用途**：CTO 在 Gitea 建 issue 时**直接粘贴**（正文已按 §三 三条硬要求成型）。
> **为何由 CTO 提交**：执行侧**无 issue 创建通道** —— Gitea API `http://192.168.1.7:3000/api/v1/*` **匿名 403**；
> `gh` CLI 存在但面向 GitHub；`git credential fill` 对 `192.168.1.7` **取不到凭据**（只有 push 走 helper 成功）。
> ⇒ 与 PR 通道同一阻塞。**已在回执 §三 报告。**
> **卡面文件**：`docs/synova/coordination/cards/K4-b3-proposed/<NN>-<slug>.md`（已落仓）
> **建完改名**：按 `<issue号>-<slug>.md` 改名（CTO 令第 3 条）。

---

## 三条硬要求自检（每张卡面都已满足）

| 硬要求 | 落法 |
|---|---|
| ① 挂对里程碑 + 执行态/未开工 | 卡面头 **`挂称`** 字段：`里程碑 = K4 · 本体/因果边/循环编号` 或 `K2 · 写入门禁与工具治理`；`执行态 = 未开工` |
| ② 标题带前缀 | 标题一律 **`[K4-A]`…`[K4-E]` / `[gate]` / `[K2-A]`…`[K2-C]`** |
| ③ 卡面含 §〇 七问 | 每张都有 **§〇（七问：一句话/解决什么问题/推动/不做行不行/现有基础/还需要做什么/DSH 借鉴）** ＋ 六字段（Q0–Q3/架构层/写集）＋ Done 标准 |
| ④ 全文禁 `Closes` | 每张卡面末行为 **`Refs #<本卡 issue 号>`**（CTO 新令第 5 条；**禁 `Closes`**） |

---

## 9 条 issue 正文（可直接粘贴）

### 1 · `[K4-A]` tags.json 缺 first_order / second_order（存量；CI strict 会红）
```
【坐标系】
模块: K4 · 本体/因果边/循环编号　｜　执行态: 未开工　｜　里程碑: K4　｜　阻塞源: 无
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/01-K4-tags-registry.md

【背景一句话】让 extensions/ontology/tags.json 认得边文件里已经在用的两个标签，否则 CI 严格模式下会红。

【实测】tags.json 内 first_order → 0 命中、second_order → 0 命中；而变更件普遍在 tags 里用它们。
⇒ 本地 [V5 软提示]，CI（SYNO_CI strict）下转硬。**存量缺陷**，非任何卡引入。

【须先裁】① 扩 tags.json（补登记）｜② 改边文件去标签｜③ 其他 —— CTO 三选一
（CTO 裁定 §九 第 6 项已明文「tags 用合法值，不扩 tags.json」⇒ ① 属门禁语义变更，须另裁）

【验收】未登记标签 = 0，末行 `tags 合法数 = N / N`，exit 0；反例 = 塞一个非法标签 ⇒ 必红。
【Done】探针实跑 exit 0 + 造红 + 复原（口径 W）逐字节一致 + 四元组（值/口径/时点/探针版本）。

Refs #<本号>
```

### 2 · `[K4-B]` loader 的 prose_formula 测不出「已标定 vs 未标定」（13 公式与 39 unknown 同分类）
```
【坐标系】
模块: K4 · 本体/因果边/循环编号　｜　执行态: 未开工　｜　里程碑: K4　｜　阻塞源: 无
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/02-K4-loader-calibration-state.md

【背景一句话】让 loader 能分清「这条边的传导公式已标定」和「还标的是 unknown」——现在两者分类上长得一样。

【实测】（verifier 用真实 loader + 最小 logger 桩）
  unknown（未标定）      → status = prose_formula  injectable = false
  真公式（brand_builds） → status = prose_formula  injectable = false   ← 与 unknown 同 status
  TBD 占位               → status = placeholder    injectable = false
  P-3 对象               → status = resolved       injectable = true
⇒ 13 条权威公式与 39 条 unknown 在 loader 层同落 prose_formula ⇒ 只看分类的判据会说"55 条都有公式"（真值 = 13 + 3 条既有真公式）。

【为何"不行"】④ 参数层是护城河，而"已标定/未标定"不可分辨 ⇒ 无法回答"还差多少条标定" ⇒ 无法排期/验收。

【验收】tf_formula=13 / tf_declared_unknown=39 等**四类可数**；反例 = 真公式 → unknown ⇒ 计数 -1/+1。

Refs #<本号>
```

### 3 · `[K4-C]` 权威表 7 个 E 号无 $id 落点（卡住 6 件循环 7 个阀位）
```
【坐标系】
模块: K4 · 本体/因果边/循环编号　｜　执行态: 未开工　｜　里程碑: K4　｜　阻塞源: 无
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/03-K4-eid-landing.md

【背景一句话】把编号对不上的边一条条判清"对应哪个边"——现在 7 个循环阀门卡在这上面，算不了。

【实测】（a7437498c）6 件 cycle 的 valve 边含 distinct E 号 = 21，T1–T5 切分 9+3+1+7+1 = 21；
  T4「无 $id 落点」= 7（E-01 / E-04 / E-06 / E-30 / E-34 / E-35 / E-37）；
  T5「两依据相冲」= 1（E-25）；T3「章间分歧」= 1（E-08）。
🔴 关键因果（impl-a 原文）：「7 = 19 条待裁清单的运行时后果 —— 待裁不是纸面问题，它已卡住 6 件循环里的 7 个阀位。」

【验收】T4 = 0；每条要么有 $id 落点、要么有"本体层确无"的书面裁定（禁悬空）；探针末行 resolved=N registered_gap=0 / exit 0。

Refs #<本号>
```

### 4 · `[K4-D]` 两套本体词表合并（extensions/ontology 58 JSON ↔ packages/ontology/src 常量）
```
【坐标系】
模块: K4 · 本体/因果边/循环编号　｜　执行态: 未开工　｜　里程碑: K4　｜　阻塞源: 无
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/04-K4-vocabulary-merge.md

【背景一句话】仓库里有两份"本体边清单"，靠人手工同步——合掉它，改成一份。

【实测】真相源 A = extensions/ontology/edge-types/*.json = 58 件（loader 目录扫）；
  真相源 B = packages/ontology/src/edge-types.ts 常量 = 54 条。
  B 被 9 个 src/ 文件 import；ALL_EDGE_TYPES 被 3 个 src/ 文件消费。
  🔴 entity-resolver.ts:215 使邻居类型余弦相似度向量维度随数组长度变 ⇒ 52→54 是行为变化（无测试钉长度，批 3 已作 W-8 登记）。
  🔴 两源漂移无门禁（批 3 之前 56 vs 52 长期并存无人发现）。

【验收】两源一致判据存在且 exit 0；反例 = JSON 加 1 件不同步 ⇒ 判据必红；向量维度不再隐性变化（钉长度测试）。

Refs #<本号>
```

### 5 · `[K4-E]` 边名 N3/N4 认领收口（消掉 #65 新边上的「待 N3/N4 确认」）
```
【坐标系】
模块: K4 · 本体/因果边/循环编号　｜　执行态: 未开工　｜　里程碑: K4　｜　阻塞源: 库外（《命名权威登记册》不在本仓）
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/05-K4-naming-n3n4.md

【背景一句话】把两条新边的名字正式登进名册，消掉文件里那句「⚠️ 命名待《命名权威登记册》N3/N4 认领确认」。

【实测】（a7437498c）两件新边 description 逐字带该待确认标记；
  edge/goal_decomposes_to / edge/plan_commits_to 已落盘、可装载（58 件）、已被测试认领。
  但 CTO 裁定 §2 要求在库外《命名权威登记册》认领 N3/N4 —— 该册不在本仓（批 3 已作 W-4/W-7 登记）。

【验收】grep "待 N3/N4 认领确认" = 0 命中；两件 description 含认领结论；回执或"无需认领"裁定**在仓内可引**（B4）。

Refs #<本号>
```

### 6 · `[gate]` probe-cycle-edges 无任何自动执行链（恒绿隐患；与 #346 vacuous 绿同族）
```
【坐标系】
模块: K2 · 写入门禁与工具治理　｜　执行态: 未开工　｜　里程碑: K2　｜　阻塞源: 无（改门禁语义须 CTO 裁）
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/06-K2-gate-probe-wiring.md

【背景一句话】给两个探针挂上自动执行——现在它们只有人手跑才有约束力，跑不跑没人知道。

【实测】git grep -n "probe-cycle-edges" -- scripts/pre-commit-check.sh .github/ .gitea/ ⇒ 零命中。
  引用面只有 claims 的 verify 文本、施工项登记.ts 的 {run, expectExit}、docs/evidence；
  而登记件的消费方（check-registry-invariants.ts 等）**只校验登记、不执行 run:**。
⇒ 判据存在、有效、exit code 正确，但**没有任何 check 会在提交/CI 时跑它** ⇒ 恒绿隐患。

【为何"不行"】判据不自动执行 = 判据不成立：probe 若被改坏，**没有任何门禁会红**。

【验收】两个探针各有可核的自动触发点；判别性证明 = 改坏被检体 ⇒ 触发点必红。

Refs #<本号>
```

### 7 · `[K2-C]` memory/notes/README 契约与 262 件实践形态漂移
```
【坐标系】
模块: K2 · 写入门禁与工具治理　｜　执行态: 未开工　｜　里程碑: K2　｜　阻塞源: 无
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/07-K2-note-shape.md

【背景一句话】让那本「决策记录该怎么写」的说明书，和仓库里真实在写的 262 份记录对上。

【实测】README 契约 = 头字段「状态:/日期:/决策:/理由:」；memory/notes/** 262 件形态分布：
  行首 `状态:` → 109 件｜列表形 `- **状态**:` → 21 件｜英文 `status:` → 23 件｜其余未归类。
⇒ 契约只覆盖 262 件里的 109 件（≈42%）⇒ 没有判据能回答"这份 Note 合规吗"。
  （commit-msg 门禁只 grep"是否引用了 Note 路径"，不校验头字段形态。）

【验收】CTO 裁形态（a 收缩契约 / b 迁移少数态 / c 双形态均合法）；判据实跑不合规 = 0；反例 = 错误形态 ⇒ 必红且点名片名。

Refs #<本号>
```

### 8 · `[K2-B]` claim_store --repair 规则化（带 --dry-run；转义 \" 而非删引号）
```
【坐标系】
模块: K2 · 写入门禁与工具治理　｜　执行态: 未开工　｜　里程碑: K2　｜　阻塞源: 须 CTO 追认 R11
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/08-K2-claim-repair.md

【背景一句话】把"我手工修那两份坏声明的做法"变成一条带试运行的命令，并且保留引号（不删）。

【实测】.claude/claims/201.yaml / 345.yaml 的 note 续行非法 ⇒ claim_store 解析整库 fail-closed：
  {"status":"invalid","degraded":true,…} ⇒ 所有卡的 claim-first 不可达 ⇒ 提交回落 legacy brief 链 ⇒ 组 12 误判"不在 Q2 范围"。
  队长手工修复（**越界"先做后报"** ⇒ R11 待追认）；verifier 实测该手改**改了 note 文本**（引号 10→0 / 4→0）
  ⇒ 正确自陈 =「机器读字段零变化；note 去引号」；**正确做法 = 转义 \"**。

【验收】--repair --dry-run 打印 diff 且不写盘；引号转义不删除；幂等；失败不改文件；两件历史畸形件作回归夹具。

Refs #<本号>
```

### 9 · `[K2-A]` 四元组 + 判据边界／命中打全文／反向造红 —— 入技能与门禁
```
【坐标系】
模块: K2 · 写入门禁与工具治理　｜　执行态: 未开工　｜　里程碑: K2　｜　阻塞源: 无（入门禁须 CTO 裁）
卡面（主仓为准）: docs/synova/coordination/cards/K4-b3-proposed/09-K2-criteria-discipline.md

【背景一句话】把 K4 批 3 换来的三条血的教训，写成规则 + 判据，别留在"下次还要重新吃一遍"。

【实测】批 3 实证 F1（同一事实两处取值不同）4 例、F2（判据自身缺陷、反向失效）2 例：
  F2-1 正则 53 命中字节数 1653 的子串｜F2-2 git grep "MISS" 命中 TRANSMISSION 的子串（/MISS/.test('TRANSMISSION') === true）。
  另 R19 跨文档比对必须先钉配对键、禁按位置；R22 造红必须脚本化并核"替换确实发生"。

【验收】六条纪律逐条在技能内成文且各挂本批实例引证；.claude/ ↔ .dsh/ 双轨逐字节一致（组 13 exit 0）。
🔴 红线：本卡不碰 scripts/audit/**；审计标准部分只转达 K3。

Refs #<本号>
```

---

## 建完后须做的两件

1. **卡面文件改名**：`<NN>-<slug>.md` → **`<issue号>-<slug>.md`**（CTO 令第 3 条）；
   例：`01-K4-tags-registry.md` → `471-K4-tags-registry.md`
2. **卡面 `Refs` 占位替换**：把各卡面末行的 `Refs #<本卡 issue 号>` 换成真号
