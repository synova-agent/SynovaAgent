# K4 批 3 · 队长收尾件（收尾三件之一）

- 批次：K4 批 3 · 收尾六卡（+1 治理段）
- 队长：synova-squad-lead
- 日期：2026-10-12
- **base（diff 左端，全程钉死）**：`ba1b22a8b5ff75833704bac22fcfcb47295dc970`（= `origin/local-main`）
- 交付仓：`D:\synova-wt`｜remote = `http://192.168.1.7:3000/synova-agent/SynovaAgent.git`

> 收尾三件 = ① diff ② 自验结论 ③ 遗留清单。本件载 ①②③。
> 所有数字来自命令原始输出；报差异均钉「读数时点 × diff 左端」。

---

## 一、批次队形与写者隔离

| 成员 | 工作目录（唯一写码处） | 分支 | 线 |
|---|---|---|---|
| impl-a | `D:\k4b3-l1-238-239` | `k4b3/l1-238-239` | L1 #238 → #239（串行） |
| impl-b | `D:\k4b3-l2-234-235` | `k4b3/l2-234-235` | L2 #234 → #235（串行） |
| impl-c | `D:\k4b3-l3-65` | `k4b3/l3-65` | L3 #65（+ #66 现状核验） |
| verifier | `D:\k4b3-verify` | `k4b3/verify` | 独立复核（只读） |
| 队长 | `D:\k4b3-lead` | `k4b3/lead` | 卡面/派单/收口/终验/治理件 |

`D:\synova-wt`（主工作区）**不写码**。成员 ≤4 满足（队长 + 3 实施 + 1 复核 = 5 个成员位里 4 个是队友）。
（口径说明：工作令 §三 队形 = 队长 + impl-a/b/c + verifier。此处「成员 ≤4」按**队友**计为 3 实施 + 1 复核 = **4**。）

---

## 二、🔴 本批的前提纠错（工作令 §二 五条 + 队长自纠）

| # | 工作令 §二 前提 | 实测 | 处置 |
|---|---|---|---|
| ① | `#238` 判据①「三口径全为 17」，要求改成 17、写明"改动来源=独立复核 C8 硬伤" | **三口径全为 15**（occ 22/23/45）；仓内裁定件明文「一律用 15」 | 🔴 **撤销该条**，判据① 用 15（CTO 2026-10-12 当面确认） |
| ② | E 号在 `extensions/ontology/` 0/17 命中 ⇒ 本卡是新建权威表 | `git grep -E 'E-[0-9]+(\.[0-9]+)?'` = **0 命中**；`$id` 全 `edge/` 前缀 | ✅ 成立（新建权威表的结论正确） |
| ③ | `edge-types/` 已 56 件；第 56 件 `goal_decomposition.json` 引入；其 `action_effect_lag` 是散文 | 56 件 ✅；`18ed356f` = `feat(k12-07)` 2026-10-11 ✅；散文值 1 件 ✅ | ✅ 成立（派单件基数 55 已按实测订正为 56） |
| ④ | `#239` 新增 `valves` 不覆盖 `edges[]`；`cycle-types.ts` 必须进写集 | `src/` 内 `Valve`/`actionEffectLag` = **0**（接线缺口为真） | ✅ 成立 |
| ⑤ | `#234/#235` 直接按现有卡面 Done 执行 | `transfer_function` 总 56 / TBD **52** ✅ | ✅ 成立，但卡面「4 条」未点名（已派判定） |

**队长自纠（2 条，均为队长测量错误，已入档）**：
- **自纠 1**：队长曾判「权威文档15 第三章不在本仓」= **假**。错因 = **用文件名当目录名**
  （目录实为 `权威文档15-企业循环溢出导航系统-20260714`）。实际**在仓内**，§3.5.1 可引一手原文。
- **自纠 2**：队长曾写「56 个 `$id` 全是 `edge/<snake>`」= **不精确**。实测 **45 下划线 / 5 连字符 / 6 单字**。

**新登记的分歧（本批发现，非工作令所列）**：
- **§3.5.1 主张对象形态** `{minMonths,maxMonths}`，而 CTO 裁定为字符串区间 `[min,max]`；
  且 `check-ontology-fields.sh` 与 `src/l4/ontology-loader.ts` 均要求该字段为**非空字符串** ⇒ 对象形态撞红两道门禁。
  队长裁定：按 CTO 裁定的**字符串区间**落地，形态统一属另案。
- **权威文档01 两章在 4 条 E 号上命名互斥**（E-08 / E-10 / E-11 / E-12）。队长裁定：两章名**并列**、标 `[章间分歧·待裁]`、**不静默消解**。

---

## 三、队长裁决清单（队内自决部分，逐条附依据）

| # | 裁决 | 依据 |
|---|---|---|
| D1 | 交付仓 = `D:\synova-wt`（非 `novis-backup` 的 GitHub 仓）；base 一律钉 `ba1b22a8b5` | 工作令指向的仓 remote = GitHub（账号挂起、无 `local-main`）；真仓 = LAN Gitea，982 refs 已认证 |
| D2 | `#66/#1412` **不实施**（已由 PR #392 以 (C) 案落地） | `1ab0cbb33` / `d180632d6` / `d87b1ce3b`；改的是 `src/adapters/sqlite-graph-store.ts`，非工作令 §四⑥ 的 `engine-context` 路径 |
| D3 | `#238` 判据① 期望值 = `occurrences=45 distinct=15 hit=15 miss=0` | 实测三口径 15/15/15 + 仓内裁定件 blob `59c9a838c` §三 第 1 行 |
| D4 | 扩写集 = `tests/l4/edge-lag-unknown-degraded-1134.test.ts` + `tests/l4/ontology-loader-param-bridge-1031.test.ts` 归 **L2 先改**，L3 禁动 | 值迁移与 +2 新边**同时**撞这两件（impl-b 实测 7 处红 + `:376` 构造性必红）；同文件同时间只允许一个写者 |
| D5 | `#234` 迁移域按 **E 号覆盖**（非字符串同标签）；`#235` 用 E 号名精确命中（13 公式 / 39 `unknown`） | 两卡口径不同源，各自声明，禁互相放宽 |
| D6 | 新边初值 = `unknown`（**不用 `TBD`**） | `TBD` 会被 `#235` 的**全域** `TBD=0` 判据打红；`unknown` 既与既有约定同形（50/56）又不新增第三态 |
| D7 | 测量口径强制：比字节用 `Get-FileHash`/`sha256sum`（口径 W）或 `git hash-object` **并标注经 autocrlf clean**（口径 B） | `core.autocrlf=true` + 无 `.gitattributes` ⇒ 工作树 CRLF；`hash-object` 只证规范化一致（A2） |
| D8 | 禁把 `git hash-object` 结果写成「逐字节一致」而不带口径名 | 同上 |
| D9 | 证据件落 `docs/synova/product-lines/evidence/`，命名 `K4-b3-<卡号>-*` | M5 |

---

## 四、前提的独立复核（verifier，未看实施员结论）

verifier 独立复现 5 项前提，全部以 `ba1b22a8b5` 为基准、逐 blob `git cat-file -p` 导出、逐文件独立实现 git blob SHA-1 比对：
**582/582 字节等同 base；缺失 0 / 多出 0 / 不一致 0**。

| # | 口径 | verifier 实测 | 队长冻结值 | 判 |
|---|---|---|---|---|
| 1 | `edge-types/` 直读 `.json` | 件数 56 / `$id` 56 / `label` 56 | 同 | ✅ |
| 2 | cycles 六件三口径 | A occ22 dist15｜B occ23 dist15｜A∪B occ15 dist15；跨口径和 45；miss 0 | 同 | ✅ |
| 3 | `E-[0-9]+(\.[0-9]+)?` @ `extensions/ontology/` | occ 0 / dist 0 | 0 | ✅ |
| 4 | `action_effect_lag` 分组 / TBD | 50+2+1+1+1+1 = 56 闭合；TBD 52/56 | 同 | ✅ |
| 5 | `src/cycles/` 五阀三模式 | 全 0（`src/` 全域 476 文件亦 0） | 0 | ✅ |

**verifier 报的 4 项不一致（a-1/a-2/a-3/a-5）全部被队长采信并已处置**（见 §二/§三）：
a-1 → 自纠 2；a-2 → D3 附钉定义 + 判别性反例要求；a-3 → D7/D8；a-5 → 并列 + 待裁。

**verifier 报 b-2 被队长纠正**：其称「doc15 第三章不在本仓」与队长原判同错（同一根因：**用文件名当目录名**）。
实证 `git cat-file -e ba1b22a8b5:<doc15 第三章路径>` → **exit=0**。

**verifier 报 c 类（跑不通，采信并作为本批测量约束）**：
- `git archive … | tar -x` 在 PS 5.1 下跑不通；`git archive -o` 导出的 115 件中 **78 件**因 `CRLF_CONVERTED_BY_ARCHIVE` 哈希不一致
  ⇒ **任何"导出文件再比哈希"的复核都会假红** ⇒ 取数一律 `git cat-file -p` 直读。
- PS 5.1 `>`/`Out-File` 默认 **UTF-16LE + BOM**（首 8 字节 `ff fe …`）⇒ 落盘一律走 Node `fs.writeFileSync(...,'utf-8')`。
- 本地 `local-main` ref **落后远端 220 提交**（`b88a23f7…` vs `ba1b22a8b5…`）⇒ **禁钉分支名，一律写全 SHA**。

---

## 五、卡级交付证据

> 本节在三条实施线回执后逐卡填入（卡号 / 分支 / commit 实测 / 推送方式 / 写集全列 / 判据原始输出 + exit code / 反例造红 + 复原哈希 / 一句话自验结论）。

（待填）

---

## 六、遗留清单

| # | 遗留项 | 归属 | 说明 |
|---|---|---|---|
| R1 | 权威文档01 两章 4 条 E 号命名互斥（E-08/E-10/E-11/E-12） | **CTO** | 队长裁定「并列 + 待裁」；需 CTO 裁以哪章为准或确认并列形态 |
| R2 | `§3.5.1` 主张 `{minMonths,maxMonths}` 对象形态 vs 既有门禁要求非空字符串 | **CTO** | 队长裁定按字符串区间落地，形态统一属另案 |
| R3 | `1_month ⇒ [0.5,1]` 为**规则推导**（无 §3.5.1 权威值，E-13 属未覆盖项） | **CTO 追认** | 已在交付件标「推导非权威 + 提请追认」 |
| R4 | `#66/#1412` 剩余面：工作令 §四⑥ 要的 `src/init/engine-context.ts` 第二收口点 + `src/ingest/index.ts` 2 处自建 store | **CTO** | 已落地件走适配器路径；剩余面是否另立新卡，待 CTO 裁 |
| R5 | `TBD` 可容性口径冲突（#1350 W3 允许 `TBD` vs #235 全域 `TBD=0`） | **CTO 追认** | 队长裁定新边用 `unknown` |
| R6 | 两套本体词表并存（`extensions/ontology/` 56 JSON vs `packages/ontology/src/` TS 常量） | **CTO** | 本批未合；任一边体系改动须先声明与两者关系 |
| R7 | 本批扩写集 2 件（D4） | **CTO 收件闸** | 属「要扩写集」类，队长按授权裁决并在此显式登记 |
| R8 | `.claude/claims/201.yaml` / `345.yaml` 为**畸形 claim**（`claim_store` 报 `status=invalid`） | 存量 | 非本批产物；触发「归属呈报降级」（已由工具显式降级，非静默） |

---

## 七、收尾三件的提交与推送回执

（待填：commit 实测 / 推送方式 / `git ls-remote --heads origin 'refs/heads/k4b3/*'` 回执）

---

*本件为队长收尾件；所有数字可按文中命令复算。*
