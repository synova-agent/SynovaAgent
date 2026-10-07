# 编码指令 — 线10 资本循环 V1 6/6（D803）

> 本指令随 dev doc 交付给编码 session。**认真阅读任务文档，然后执行任务。**
> 派单: `docs/synova/coordination/派单-D804-D803-DSH标准-20260917.md` §三（CTO 派单，DSH 标准规格先行，分支 `docs/dispatch-dsh-standard-20260917`）
> 审计: Kimi K3 会盯着你的任务，D803 完成后做最终审计（全链路复核 = 线10 第 6 点 10-8 本体，K3 报告即验收证据）

---

## 〇、开工前置（不满足 → waiting，禁伪造）

0. **D803 dev doc 已过 CTO 复核冻结**（`docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D803-capital-cycle-20260917.md`，gatekeeper 6/6 ALL PASS @2026-09-17）且已随交付分支落库可读。冻结前不动任何写集文件。
1. `git fetch --all && git pull --ff-only`，确认 main 最新；从 main 拉隔离 worktree + 自开分支（建议 `feat/d803-capital-cycle-v1`）；先建 task brief（写集用 `declare-write-set.sh` 机器生成）。
2. **行号重核（D524 教训）**：spec 全部 file:line 为 2026-09-17 实测。开工前抽查 5 处关键锚点（`src/sentinel/sentinel-loader.ts:210-212` 挂载、`src/agent/data-ingest-service.ts:164` financialType、`extensions/sentinels/cash-runway/aggregate.ts:34-41` 降级短路、`scripts/golden-scenarios/GS-03-capital-cycle/expect.json` evidence_map、`docs/synova/product-lines/product-lines.yaml` 线10 段）——若 main 期间有新合并导致漂移，以**重读后的真实代码**为准，禁照抄旧行号。

## 一、任务文档（必读，先读后动，读不完不动手）

| 文档 | 路径 | 作用 |
|---|---|---|
| D803 spec | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D803-capital-cycle-20260917.md` | **编码唯一契约**（八节：§三 S2 逐字段契约 / §五 S4 失败模式 / §六 S5 五切片 / §七 S6 断言表 / §十 写集 / §十二 DS1-DS12） |
| 派单 | `docs/synova/coordination/派单-D804-D803-DSH标准-20260917.md` §三 + §一模板 | 切片节奏（每片独立 commit+断言）/ 写集 ≤12 / 冻结门 |
| 北星 | `.claude/PRODUCT-BRIEF.md` §一/§三 | 产品方向锚点（哨兵 7×24 主动监测告警，不是 ChatBot） |
| V1 分母 | `docs/synova/project/26线-V1验收标准-草案v0.1-20260917.md` §线10 | 六断言判定式原文（10-5/10-7 是 V1 外，**不做**） |
| 前车之鉴 | `docs/synova/audit-reports/AGENT-CAPABILITY-FULL-CHAIN-AUDIT-20260813.md` §2.2 | K3 三重缺陷定罪原文——你的修复就是给这三条收尾，别引入同类新断裂 |

## 二、执行要求（做到你的最高代码水平）

1. **认真阅读** spec §一（Authority，权威引用带原文）/ §五（S4 九条失败模式）/ §六（S5 五切片：①挂载回归守卫 ②契约测试先红 ③跑道语义后绿 ④GS-03 负向相位 ⑤证据绑定+K3 备料）/ §七（S6 断言表+反向必红四条）/ §十（写集 10 修改 + 0 新建）/ §十二（DS1-DS12）。
2. **先 plan mode 再做**：列出文件级改动清单（照 spec §10.1 写集）→ 确认切片依赖（②→③ red→green；①④⑤独立）→ 想清楚再动手。**禁止没想清楚就改代码。**
3. **最高代码水平**：`as any`=0（铁律 38）；契约优先（compute 修改保持既有 JSDoc 契约同步，铁律 47）；降级诚实（新增 degraded 路径必有 log + finding 可见，铁律 24/31）；测试非空壳（expect 断言 + 正常/降级/边界三路径，铁律 48；red→green 留原始输出）。

## 三、D803 专属硬约束（违反 = 审计 FAIL）

1. **切片纪律（派单 §一.三）**：五切片各自独立 commit；每片先跑该片断言并**贴原始输出**再进下一片；**禁止一个提交混多片、禁止跳过断言进下一片**。顺序：切片②（契约测试，先红）→ 切片③（读侧修复，转绿）；切片①/④/⑤ 可穿插。
2. **写集精确性**：只改 spec §10.1 写集表 10 个文件（零新建）；完工时 `git diff --name-only`（对 base 分支）与写集**完全一致**。**零 `scripts/product-lines/calc-progress.py`、零 `scripts/audit/**`、零 src/\*\*（本卡写集天然不含 src，冻结门自动满足）**——完成报告附 `git log --stat` 自证。
3. **诚实 RED**：DS8（K3 复核）不是你的环节——做到 DS7（ledger 线10 v1_passed=5/6 + K3 备料清单落盘）即为完工线，10-8 由 K3 执行后转 verified。K3 备料按 spec 切片⑤（gen-k3-task.py 口径：点级 verdicts + `acceptance_point="line:10"` 线级复核双要求写明）。任何环境不满足（如 GS-03 bootstrap 起不来）→ 对应 DS 标 ⏸/❌ + 理由，禁假绿。
4. **evidence 落盘**：GS-03 场景证据（`scripts/golden-scenarios/evidence/GS-03-<date>.json`）与 A2 测试证据（`docs/synova/product-lines/evidence/test-<date>*.json`）原始 JSON **入 git**；反向必红四条（spec §七）的破坏→变红→还原全过程输出贴完成报告——K3 会独立重跑复现。
5. **行为红线**：不新增哨兵、不新增 finding.id（复用 `cr_runway_degraded`，finding-id-stability.test.ts 对 44 aggregate 全量守卫）；不动 10-5（工单推送）/10-7（报告结论）——V1 外 backlog；**多租户 teamId 缺口（spec S4 行9）只登记不修**，顺手修 = 越权退回。
6. **环境坑（实测注记）**：GS-03 依赖 better-sqlite3 ABI 对齐（D462：Node 24 + sqlite v12，`npx tsx` 直跑）；bootstrap 起真实服务（JWT 自举 + 临时端口，临时库经 `SYNOVA_DB_PATH` 显式隔离，禁碰真实 `data/synova.db` 铁律 0-4）；python 环节 `PYTHONIOENCODING=utf-8`（Windows 代行按 D773 规约）。

## 四、做完之后的复核清单（逐项自查，K3 会盯着你，也会做最后的审计）

1. **与 dev doc 一致**：DS1-DS12 逐项对照（DS1-DS7 + DS9-DS12 你的环节；DS8 = K3 环节），声称 = 实现 + 验收（S-2），禁 overclaim、禁重编号/静默缺项（S-10）。
2. **不违反铁律**：接线（spec §八五条生产链复跑通过——上传→节点 / 哨兵触发→阈值告警 / cron / 契约测试→A2 证据 / 场景证据→点位）、降级诚实（24/31）、类型安全（38）、契约优先（47）、测试非空壳（48）、架构边界（39/46）。
3. **无 bug**：spec §七 verify 命令逐条跑通；`node_modules/.bin/vitest run tests/sentinels/cash-runway/ tests/sentinels/revenue-health.test.ts tests/contract/l4-contract.test.ts tests/sentinel/sentinel-threshold-wiring.test.ts tests/golden-scenarios/gss-common.test.ts` 全绿 + 全量 vitest 零新增失败 + tsc 零新增错误；pre-commit 全过（**禁 --no-verify**）；提交走 synova-commit（**禁 git stash**，铁律 0-3）；GS-05 回归绿（同哨兵消费方）。
4. **反向必红**（spec §七四条，逐条实测）：注释 loader 挂载行 → 负向断言红；`cash`→`cashBalance` → 契约+场景双红；现金链加回 `|| total_revenue` → L1 红；删证据 verdict → 点位回退 false。跑完还原，输出入报告。
5. **测试到位**：切片②修复前新 describe 红（原始输出）、修复后绿；compute 新增 ≥6 用例覆盖部分缺失/显式0/字段链/Infinity 边界；expect 非空壳（每断言带 purpose）。
6. **收口自证**：`bash scripts/golden-scenarios/GS-03-capital-cycle/run.sh` exit 0 且证据 verdicts 同日含 10-1/10-3/10-6；`python3 scripts/product-lines/list-test-points.py` 含 10-2；`bash scripts/product-lines/refresh-all.sh` 后 ledger 线10 **v1_passed=5, v1_total=6**（DS7）；次日跨天重跑一次证据日期滚动（DS11）。
7. **其他你认为需要复核的点**：残留（旧 camelCase 读名 grep 复查）、expect.json 过 gss-common schema 校验、yaml 只动线10 的 10-2 一行。

## 五、K3 审计提示（收尾要求）

- 完成后**一次提审 D803**（K3 全链路复核即 10-8 本体）：报告须覆盖点级 verdicts（10-1…10-6 + 10-5/10-7 显式 V1 外）+ 线级复核（`acceptance_point="line:10", verdict=pass`）——缺线级复核则 100% 封顶 99（calc-progress 契约，非本卡可改）。
- 审计验收 = ledger 线10 **v1_passed == v1_total == 6** 且 10-8 verified（product-progress 重算后线10 → 第一条 100% 线）。
- 完成后回填 `task-state/D803.json` **impl 段**（commit + by + files[]，与写集一致）+ 验收证据原文；审计员会**独立重跑** GS-03 / vitest / refresh-all——脚本幂等、无本机假设（跑前读 spec §五 S4 环境行与 §八幂等节）。

**开始吧。**
