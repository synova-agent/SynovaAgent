# K4 批 2 · 前提冻结（Lead 实测 · 原始输出）

> 任务：批 2 · K4-03(#1057) / K4-01(#1134) / K4-07(#1056) / K4-02(#1031)
> 执行：synova-squad-lead（批 2）｜ 时间：2026-10-11 22:26–22:50 (+08:00)
> 口径：**基线 = rebase 当刻 `origin/local-main` 的 tip**（非死 SHA）。所有数字取自命令原始输出，未手写。

---

## 一、环境事实（实测）

| # | 前提 | 命令 | 输出摘要 |
|---|---|---|---|
| E1 | 旧仓只读、独立可寻址 | `git -C D:\novis-backup-20260526\Novis\synova-agent rev-parse --show-toplevel` | `D:/novis-backup-20260526/Novis/synova-agent` |
| E2 | 远端必须 192.168.1.7 | `git -C D:\synova-wt-1455 remote get-url origin` | `http://192.168.1.7:3000/synova-agent/SynovaAgent.git` |
| E3 | 远端可写凭据可用且判别性成立 | `ls-remote` + 伪 token / 匿名对照 | 有效 token=OK；`nouser:bogustoken123`=FAIL；匿名=FAIL |
| E4 | 本机**无 sqlite3 CLI** | `where sqlite3` | `INFO: Could not find files for the given pattern(s).` |
| E5 | python3 可用（判据①替代读数） | `where python3` / `python3 -c "import sqlite3"` | `Python313\python3.exe`；`sqlite3 module OK 3.50.4` |
| E6 | Git Bash 全路径 | `if exist "C:\Program Files\Git\bin\bash.exe"` | 存在 |
| E7 | 克隆后 token 0 处 | `remote -v \| findstr /i "token"` | `TOKEN_REMAINS=NO`（4 份克隆逐份复核） |

## 二、基线漂移（🔴 派单件已预告"当日移动 8 次"）

| 时刻 | 命令 | `origin/local-main` |
|---|---|---|
| 22:26 | `git -C D:\synova-wt-b2-lead rev-parse origin/local-main` | `340616017e45af3fde5993993f6b664b74910ad1` |
| 22:35 | 同（新克隆 `D:\synova-wt-b2-1057` / `-1056` 的 clone tip） | `e52499ddd6a1320435abd44f24323b5865d4caa1` |

⇒ 凡「基线」处，本批一律取**各克隆 rebase 当刻**的 tip，并逐卡钉 SHA 记入回执。

## 三、四卡接过来（旧仓分支 → LAN 克隆）

命令：`git fetch D:/novis-backup-20260526/Novis/synova-agent +<branch>:refs/heads/tXXX`

| 卡 | 分支 @ 派单件 SHA | 实测 tip | 相对基点 `5a6591c4a` 的提交数 | 写集（`merge-base..HEAD` 文件数） |
|---|---|---|---|---|
| K4-03 | `fix/1057-activity-instance-props @ 1dc66e64a` | `1dc66e64` ✓ 命中 | 6 | 13 |
| K4-01 | `fix/1134-edge-lag-enum @ 7b6bdd9bb` | `7b6bdd9b` ✓ 命中 | 2 | 4 |
| K4-07 | `feat/1056-l15-profession-layer @ 4d004a5da` | `4d004a5d` ✓ 命中 | 1 | 10 |
| K4-02 | `fix/1031-ontology-param-bridge @ 135f0877d` | `135f0877` ✓ 命中 | 6 | 6 |

**写集逐文件（原始 `git diff --name-only`）**

```
K4-03 : .claude/claims/1057.yaml
        .claude/task-briefs/2026-10-09-1057-activity-instance-props.md
        docs/synova/product-lines/evidence/1057-activity-instance-props.md
        extensions/ontology/activity/{acquisition,compliance,coordination,governance,innovation,learning,maintenance,production}.json
        extensions/ontology/activity/instances/activity-production-wani-baby-001.json
        tests/l4/activity-instance-1057.test.ts
K4-01 : .claude/claims/1134.yaml
        .claude/task-briefs/2026-10-09-1134-edge-lag-unknown-degraded.md
        docs/synova/product-lines/evidence/1134-edge-lag-unknown-degraded-20261009.md
        tests/l4/edge-lag-unknown-degraded-1134.test.ts        （700 行）
K4-07 : .claude/claims/1056.yaml
        .claude/task-briefs/2026-10-09-1056-l15-profession-layer.md
        docs/synova/product-lines/evidence/1056-l15-profession-layer-20261010.md
        extensions/professions/{manifest.json,chain-retail-expansion/manifest.json,chain-retail-expansion/thresholds.json}
        src/extensions/profession-layer.ts
        src/init/file-driven-loaders.ts
        tests/extensions/{layer-precedence.test.ts,profession-layer.test.ts}
K4-02 : .claude/claims/1031.yaml
        .claude/task-briefs/2026-10-09-1031-ontology-param-bridge.md
        docs/synova/product-lines/evidence/1031-delivery.md
        docs/synova/product-lines/evidence/1031-injection-contract.md
        src/l4/ontology-loader.ts                              （+259 行）
        tests/l4/ontology-loader-param-bridge-1031.test.ts      （417 行）
```

**写集互斥（实测）**：四卡产品面**两两零重叠**（唯一潜在触点 `src/init/file-driven-loaders.ts` 仅 K4-07 一家写；`src/l4/ontology-loader.ts` 仅 K4-02 一家写）。

## 四、逐卡前提实测

### K4-03 / #1057
| # | 前提 | 命令 | 输出 |
|---|---|---|---|
| 1057-1 | 四个卡面落点在 local-main 均为 0 件（"本卡新建"） | `git ls-tree -r --name-only origin/local-main -- <p>` | `customer-config/ontology-instances`=0 / `extensions/ontology/extensions`=0 / `scripts/control-tower/probe-ontology-instances.ts`=0 / `tests/ontology/instance-loading.test.ts`=0 |
| 1057-2 | `tests/ontology/` 已存在（非空） | 同上 | `tests/ontology/adapter-user.test.ts`（1 件） |
| 1057-3 | `activity/` 8 类目 | `git ls-tree --name-only origin/local-main -- extensions/ontology/activity/` | 8 |
| 1057-4 | 「既有 10 个属性」确实在分支上 | `git show t1057:extensions/ontology/activity/production.json` → python3 读数 | `optionalProps` 含 `headcount`/`hours_per_run`/`runs_per_period`/`unit_labor_cost`/`error_rate`/`structuredness`/`error_tolerance`/`data_reachability`/`agent_readiness_score`/`agent_type_recommendation` |
| 1057-5 | 分支上实例件落点在旧位（须搬） | `git diff --name-status 5a6591c4a..t1057 -- extensions/ontology/activity/` | `A extensions/ontology/activity/instances/activity-production-wani-baby-001.json` + 8 件 `M` |
| 1057-6 | 本机判据①原命令不可用 ⇒ 已裁换 python3 | 见 E4/E5 | 成立 |

### K4-01 / #1134
| # | 前提 | 命令 | 输出 |
|---|---|---|---|
| 1134-1 | `unknown` = **50** 条 | `git grep -h '"action_effect_lag"' origin/local-main -- extensions/ontology/edge-types/ \| sed 's/.*: //' \| sort \| uniq -c` | `50 "unknown"` / `2 "3-6_months"` / `1 "immediate"` / `1 "1_month"` / `1 "1-3_months"` / **`1 "0d — 分解关系为结构性从属…"`（散文值，非枚举）** |
| 1134-2 | 🔴 卡面「55 个文件」**已漂移** | `git ls-tree --name-only … edge-types/ \| wc -l` | **56** |
| 1134-3 | 散文值落点 | `git grep -n 'action_effect_lag' … \| grep -v 枚举值` | `extensions/ontology/edge-types/goal_decomposition.json:32` |
| 1134-4 | 分支**未改** edge-types | `git diff --name-only 5a6591c4a..t1134 -- extensions/ontology/edge-types/ \| wc -l` | `0` ⇒ 「与 #1350 同目录串行」在当前分支上**无物理交叠**（声明面串行仍然照办） |

### K4-07 / #1056
| # | 前提 | 命令 | 输出 |
|---|---|---|---|
| 1056-1 | 改名对象存在（现名 `profession-layer.ts`） | 分支写集 | `src/extensions/profession-layer.ts` |
| 1056-2 | `src/extensions/` 在 local-main 仅 2 件 | `git ls-tree -r --name-only … src/extensions/` | `registry.ts` `types.ts` |
| 1056-3 | K12-20 查重面**零交集** | `extensions/content-layers/`=4 件；`src/services/content-layering.ts`=345 行 | 与 K4-07 写集（`extensions/professions/**` + `src/extensions/**`）无交集 ✓ |
| 1056-4 | `file-driven-loaders.ts` 在 local-main 上**恰好改过 1 次** | `git log --oneline 5a6591c4a..origin/local-main -- src/init/file-driven-loaders.ts` | `1` 件：`ed7613c1 feat(1465): extensions 内容面 content-registry 唯一 type→loader 真源 + 4 项不可达裁决 + 4 目录 manifest` |
| 1056-5 | 🔴 **rebase 冲突**（派单件预告成立） | `setup-card.bat` 内 `git rebase local-main` | `CONFLICT (content): Merge conflict in src/init/file-driven-loaders.ts` → 已 `rebase --abort`，**停，报 CTO** |

### K4-02 / #1031
| # | 前提 | 命令 | 输出 |
|---|---|---|---|
| 1031-1 | local-main 上 `transfer_function` 的**生产读取面** | `git grep -l 'transfer_function' origin/local-main -- src/` | **1 个文件**，且仅 1 处**注释**：`src/loops/direction-monitor.ts:312` ⇒ 旧卡面「`:546` 读 `edge.props["transfer_function"]`」**在 local-main 上不成立**（读取面已被移走/未落）。与派单件「未交① direction-monitor.ts 读取面」一致 |
| 1031-2 | 边类型带 `causal_strength` | `git grep -l 'causal_strength' … edge-types/ \| wc -l` | `55` |
| 1031-3 | 分支未碰 direction-monitor.ts | `git diff --name-only 5a6591c4a..t1031 -- src/loops/direction-monitor.ts \| wc -l` | `0` ✓ 与派单件「写集显式剔除」一致 |
| 1031-4 | 「417 行测试」 | 分支写集 | `tests/l4/ontology-loader-param-bridge-1031.test.ts` = 417 行 ✓ |

## 五、🔴 与派单件不一致处（登记，不改派单件）

| # | 项 | 派单件说法 | 实测 |
|---|---|---|---|
| D1 | K4-03 落点来源 | 「落点以**卡面**为准」 | GitHub 旧卡面 `.k4-cards/card-1057.md` **不含**这四个落点；四落点原文在 **local-main 上**的 `docs/synova/coordination/K4-审计定稿与卡面全套.md:589-592` 与 `.claude/task-briefs/2026-10-11-236-K4-03-…md:105-109`。⇒ 落点以 local-main 卡面为准（可核） |
| D2 | K4-01 范围 | 「只交信号+计数，**不含值域迁移**（值域迁移另立卡）」 | local-main 卡面 `2026-10-11-234-K4-01-按权威15-3-5-1-重落-8-条边类型预估值.md` 的 Done **正是**值域重落（写集＝55 条 edge-types + `probe-ontology-values.ts` + `tests/ontology/edge-lag-values.test.ts`）。⇒ **两件互斥**，待 CTO 裁 |
| D3 | K4-02 范围 | 「已交＝注入契约+实现+417 行测试；未交③ causal_strength 数值注入」 | local-main 卡面 `…-235-K4-02-52-条-TBD-占位值落定…md` Done =「探针 exit 0 且 `TBD=0`」（＝填 52 条真公式）。⇒ 口径不同，待 CTO 裁 |
| D4 | K4-01 边类型文件数 | 卡面 55 | **56**（另有 1 条非枚举散文值） |
| D5 | K4-07 接线 | 「卡面写'待横向查重后定'⇒ CTO 准保留接线」 | 保留接线 ⇒ 必与 local-main 侧 `ed7613c1`（content-registry 唯一真源）**正面冲突**，rebase 已实测冲突 |

## 六、队内落位与串行

- 成员 ≤4：队长 + `coder-k4-03`（实施）+ `analyst-k4`（只读分析）+ `verifier-k4`（独立复核）。
- 重型验证串行 ≤1（vitest / 全量门禁）。
- 开工卡：**K4-03**（rebase 无冲突）；K4-01/K4-02/K4-07 **挂起待裁**（D2/D3/D5）。
- 合并顺序仍按 CTO 令：#343 → #1057 → #1134 → #1056 → #1031；每合一条，下一条 rebase 到新 tip 复跑。

**原始输出落点**：`D:\novis-backup-20260526\Novis\.k4-b2-lead\`（recon3.sh / premises*.sh 及其输出，本仓外，不污染仓库）。

---

## 七、CTO 裁定登记（2026-10-11 夜，按序）

| # | 事项 | 裁定 | 落点 |
|---|---|---|---|
| R1 | K4-07 rebase 冲突解法 | **甲**：保 main 侧 `ed7613c1` content-registry 唯一 type→loader 真源；L1.5 接线改为**经 content-registry 声明** | 分支 `feat/1056-l15-profession-layer` |
| R2 | K4-01 范围（派单件 vs local-main 卡面） | **甲**：按派单件 —— 只交「信号 + 计数」，**不含值域迁移**（值域迁移另立卡） | 分支 `fix/1134-edge-lag-enum` |
| R3 | K4-02 范围 | **甲**：按派单件 —— 注入契约 + 实现 + 417 行测试；**两笔账**写清未交项 | 分支 `fix/1031-ontology-param-bridge` |
| R4 | K4-03 落点级冲突（`customer-config` 幽灵 orgId） | **甲**：**按现状交付 + 证据件挂「已知副作用」+ 另立卡收口** | 分支 `fix/1057-activity-instance-props` |
| R5 | K4-07 写集扩容（甲裁定的物理前提） | **甲**：扩容 **+2 件**（`src/deploy/content-registry.ts` + `tests/deploy/content-registry.test.ts`）；probe 计数钉 20→24 **不属本卡**（留批 1/K12-21） | task-4 r4 写集已更新 |

### R4 的独立复核依据（队长实测）
- `src/config/customer-config-package.ts:56` `ORG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/` ⇒ `ontology-instances` **命中**；
- 同件 `:45` `COMPOSITION_FILE = 'config.yml'`、`:198-224 scanRoot`：命中即建包、缺文件即标 `broken`（`:209-210` 注释自陈「残渣报 broken 会让运维学会忽略告警」）；
- 生产路径 `src/routes/diagnosis.ts:226-232`：`discoverCustomerConfigPackages` → `brokenPackages.map(p=>p.orgId)` 进 INFO 日志。
⇒ 交付后生产日志将长期出现 `orgId=ontology-instances` 的假 broken；**本卡不修**，另立卡收口。

### R5 的独立复核依据（实施席取证，行号锚点）
- `src/deploy/content-registry.ts:552` 硬钉 `CONTENT_TYPES.length !== 24`；
- `tests/deploy/content-registry.test.ts:42` 按**磁盘目录集**取数、`:44/:72/:113` 钉 24/19/5 ⇒ 分支带入 `extensions/professions/` 后**一 rebase 即红**；
- `src/init/file-driven-loaders.ts`（main 侧 88 行）自述「新增内容项 = registry 加一条声明，本文件零改动」。

## 八、本批交付与复核状态（as_of 2026-10-11 23:2x）

| 卡 | 分支 | 交付 SHA | 远端 | 复核 | PR |
|---|---|---|---|---|---|
| K4-03 / #1057 | `fix/1057-activity-instance-props` | `f28b7c12`（产品件 `e0641824`；`cc3ad9fc` 为已复核钉定 SHA，其上两笔为 **doc-only**） | ✅ | ✅ 自验结论：**一致（可提请独立审计）** | **#361**（base=local-main，mergeable=True） |
| K4-01 / #1134 | `fix/1134-edge-lag-enum` | `d764a3f8`（产品件 `bfea3acf`；`429d8ebe` 为已复核钉定 SHA） | ✅ | ✅ 自验结论：**一致（可提请独立审计）**（五连全过） | **#362**（base=local-main，mergeable=True） |
| K4-07 / #1056 | `feat/1056-l15-profession-layer` | `f199a526`（产品件 `2cf60dfc`） | ✅ | ✅ 自验结论：**一致（可提请独立审计）**（五连全过） | **#365**（base=local-main，mergeable=True） |
| K4-02 / #1031 | `fix/1031-ontology-param-bridge` | 交付中（`db53d316` + 提交后复跑待收） | — | 待开（`task-9`） | — |

**复核报告转录（已入各卡分支）**：
- `docs/synova/product-lines/evidence/1057-independent-verify-20261011.md`（本分支内）
- `docs/synova/product-lines/evidence/1134-independent-verify-20261011.md`（本分支内）

**漂移登记**：远端 `local-main` 在本批期间移动 ≥4 次：`340616017e` → `e52499ddd` → `dc5ce093`（复核席取值）。⇒ 每条 PR 在轮到自己合并前**必须 rebase 到当刻 tip 并复跑**（CTO 令 + 铁律 0-3）。

**边界（不得放大）**：K4-03 的 `verifier-k4` 已实测 `src/l4/ontology-loader.ts:80-97` **不扫** `extensions/ontology/extensions/**` 与 `customer-config/**` ⇒ 本卡交付是 **L1 真读盘**，**不是** L2 生产链；不得读成「本体层已能装数据」。同类地，K4-01 的 `READ_SIDE_EMISSION = NOT_IMPLEMENTED` 棘轮表示读取侧发射体仍不存在。
