# Task Brief: D850 度量口径改造：取消总完成度百分比 → 离散三档 + evidenceCmd

> 生成: 2026-09-20 | 任务卡: 小队 D850 编码 A（task-1）| 工作树: .synova-wt-d850 | 分支: team/d850-discrete-health | 基线: origin/main dae40d96
> 小队固化件 M3：队内结论只写「自验」，独立审计由队外 K3 另做。

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
目标: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。

本任务是**度量层（治理/看板）**改造，不碰产品运行时：把「总完成度百分比」换成创始人签字的
「N 个健康 / M 个写了没接 / K 个缺」离散计数，且每个数字带一条可复现命令。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
- 纵向五层：不涉及。本卡不改 L1-L5 任何 src/ 代码（写集零 src/）。
- 横向 Monorepo 包：不涉及。
- **扩展/派生层（本项目第四类：git 真相 → 派生物）**：本卡改三个**只读派生器**与其派生物。
  派生链：`task-state/*.json + V1 断言表 + 证据记录` --(gen-project-board.py)--> `docs/synova/project/ledger.json`；
  `product-lines.yaml + 证据记录` --(calc-progress.py)--> `product-progress.json` --(gen-progress-page.py)--> `product-progress.html`。
  三者**都是派生物，禁手改**（本卡因此只允许由脚本重生成，见 Q2）。
- 所属系统：基础设施（创始人驾驶舱 / 项目账本），非 GA 诊断、非哨兵。

### b) 文件审计（开工物理核行，禁凭记忆）
| # | 任务卡基线声称 | 实测（命令） | 结论 |
|---|---|---|---|
| 1 | `gen-project-board.py:635-647` totals 含 delivery_pct/verify_pct | `awk NR>=635&&NR<=647` 命中 `delivery_pct`:641 / `verify_pct`:642 | ✓ |
| 2 | `gen-project-board.py:714-716` stdout 打印 delivery=% | 实测 :714-717（:716 跨行续行） | ✓（行尾差 1 行，非实质） |
| 3 | `calc-progress.py:339-341` product_progress_pct + total_lines | :339 `product_progress_pct` / :340 `total_lines` | ✓ |
| 4 | `calc-progress.py:302` 线级 progress | **实测 :306 计算 / :326 落库**（:302 是 note 字段） | ✗ 行号漂移，已在交付说明点名（队长已复核确认） |
| 5 | `calc-progress.py:393-394` 汇总日志 | 实测 :392-394（`产品总进度 %s%%` 在 :392） | ✓（起行差 1） |
| 6 | 实跑 calc-progress → total_lines=28（目标 29） | `python3 scripts/product-lines/calc-progress.py --out /tmp/...` → `线数 28` | ✓ |
| 7 | `product-lines.yaml:53-57` version/total_lines:28/v2_lines | :53-57 逐行命中；`lines:` 28 条（id 1..28）+ `v2_lines: ["federated-evolution"]` = 29 | ✓ |
| 8 | `product-progress.html:57`「产品总进度 1% · 26 条产品线」 | :57 逐字命中 | ✓ |
| 9 | `gen-project-board.test.sh:351-352` 写死 lines=26 | :351-352 命中（队长补充点名的 CT-67 第三处） | ✓ |
| 10 | CT-67 登记在 `AUDIT-FINDINGS-LEDGER.md:101` | :101 命中（`backlog_points=36` / `v1_passed=22`） | ✓ |
| 11 | 全仓是否存在 `implemented/wired/live/testedThroughEntry` 机器可读源（三档判定源存在性） | `grep -rn testedThroughEntry scripts/ docs/synova/ task-state/` → **只命中 2 份 md 文档，零机器可读源** | **关键发现**（见 Q1c） |

### c) 决策
已有覆盖 → 复用（三个派生器已存在，本卡只改口径，不新建脚本）。
无覆盖 → 三档判定源：**不新建判定机制**（新建 = 第二真相源）。无源可判定的态 → 显式 `null` + 原因（禁猜 0）。
冲突 → 无。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链（铁律 0-2）
① SPEC：引用权威两件（见下）；② 测试：先写断言（红）→ 再实现；③ 实现：刚好满足；④ 接线：三个派生件由脚本重生成 + 面板渲染；⑤ 验证：先红后绿两次原始输出 + 每档 evidence_cmd 逐条实跑。

引用依据：
- 铁律 0-2（spec → test → impl → wire → review → merge）、铁律 7（入口可触达/链路走通/结果可见）
- 铁律 24+31（降级不静默；无法判定的态显式 null + reason，禁猜 0）
- 铁律 47/48（契约优先；测试非空壳，必须有 expect 式断言）
- memory 历史教训：`docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md:101`（CT-67 测试断言硬编码 live 数据 → 存量假红）、`CT-70`（tests/project/** 未被 CI 接线）

### b) 本任务执行约束（每条带 verify 命令）
- rule: "三档必须互斥且完备，恒等式必须物理闭合（各档之和 + 显式列出的其它态 = v1_total）"
  verify: `python3 scripts/project/gen-project-board.py --out /tmp/l.json --quiet && python3 -c "import json;d=json.load(open('/tmp/l.json'));print(d['totals']['buckets']['identity'])"`
- rule: "禁止再输出任何百分比口径字段（product_progress_pct / delivery_pct / verify_pct / 产品总进度 / 总完成度）"
  verify: `grep -rn "product_progress_pct|delivery_pct|verify_pct|产品总进度|总完成度" scripts/project/gen-project-board.py scripts/product-lines/calc-progress.py scripts/product-lines/gen-progress-page.py docs/synova/project/ledger.json docs/synova/product-lines/product-progress.json docs/synova/product-lines/product-progress.html`（零命中；**创始人签字要求的唯一形式判据例外**）
- rule: "每档 evidence_cmd 必须实测能跑（exit 0 且产出可核对数字）"
  verify: `bash tests/project/gen-project-board.test.sh`（组⑩ 逐条实跑 evidence_cmd）

### c) 决策参考系（D333 四步）
① 第一性原理：一个数字可信 ⟺ 它由真实证据源判定 + 带一条可复现命令（《方案-项目度量-从声明驱动到事实驱动》§四：
   「每个数字必须带一条可复现的命令。不能复现的数字，不上看板」）。因此：**有源的档出数，无源的档出 null**，不用 0 冒充。
② Anthropic 工程基线：fail-closed + 机器可验契约 + 不静默降级 → 无法判定的态必须显式 `count: null` + `reason`（对齐既有先例：
   `ledger.pr_queue=null + skipped_sources`、`timeline.actual.merged=null`）。
③ 开源实证/本仓实证：《方案-项目度量-从声明驱动到事实驱动》§六 —— 作者手握全部 8 个断线实例、连改三版判据，静态检测准确率仍只有
   **3/5 = 60%**。→ 静态 grep 检测**只能粗筛，不能当判定源**（本卡因此不引入任何 grep 型判定源）。
④ 收敛检查：①②③ 同向 —— 三档只用**已有机器可读信号**，无信号即 null。
**结论（参考：第一性原理 + Anthropic fail-closed + 本仓 §六 实测 + 收敛）**：
- `written_not_wired` = V1 断言表「证据」列 `pending_wiring` 撤回标记（D809；= 有实现未接线）→ **可判定出数**
- `healthy` = 点亮 且 另有 record_type=k3 的独立 PASS 裁决（「独立核验通过」口径）→ **可判定出数**；
  **严格口径 `live && testedThroughEntry` 仍无机器可读源**（e2e 不在 CI），故同时显式登记 `strict_source` 缺失，不冒充
- `live_unverified` = 点亮但无独立核验 = 总纲 §1.2「能跑未验证」→ **单独成态，绝不并进 healthy**（任务卡红线）
- `missing`（缺）= **null + 原因**：总纲 §1.2 判定手段 = 代码检索；本卡明令禁 grep 型静态判据，且「无匹配证据」≠「无实现」（诚实规则）
- `wired_broken`（接了跑不通）= **null + 原因**：判定手段 = 冒烟启动，无机器可读源
- 残余 `state_unknown` = 显式列出（既未点亮、也非撤回）→ 恒等式闭合于 v1_total，**不丢点**

### d) 相关 Note 引用
- [x] `memory/notes/proposed/2026-09-20-D850-discrete-health-buckets.md`（本卡决策沉淀；铁律 49，commit-msg 门禁消费）

## Q2: 范围 — 正确的最简方案是什么？

做什么（每文件一行；路径与说明之间留空格 —— 全角括号紧贴路径会被 G12 解析器并入路径导致误报）：
- scripts/project/gen-project-board.py — totals 去 delivery_pct/verify_pct；新增 totals.buckets 三档+恒等式；stdout 摘要去百分比
- scripts/product-lines/calc-progress.py — total_lines 计入 v2_lines 得 29；顶层去百分比字段改 buckets；线级 progress_pct 保留并标 deprecated + 加线级 buckets；汇总日志去百分比
- scripts/product-lines/gen-progress-page.py — 面板零百分比：29 条产品线 + 三档 + 每档 evidenceCmd；页脚文案同步改离散口径
- tests/project/gen-project-board.test.sh — 新增组⑩ 三档恒等式/evidence_cmd 实跑/无百分比字段；修 CT-67 三处 live 硬编码 → 不变量断言；修组⑤ 反条件断言
- tests/project/calc-progress-panel.test.sh — 【V-2 修复，队长批写集】面板契约密封测试：全部 evidence_cmd（顶层 + 每条线）逐条实跑断言 rc=0 且值 == JSON count；源侧独立核对命令；null 带 reason + 恒等式；反漂移（已提交派生件 == 现场重跑）；面板零渲染型百分比
- docs/synova/project/ledger.json — 由 gen-project-board.py 重生成（禁手改）
- task-state/D850.json — 任务卡登记
- .claude/task-briefs/2026-09-20-D850-discrete-health.md — 本文件（task-start 原生成 `D850.md` 无日期前缀 → G12 今日认领窗口漏判，已改名）
- memory/notes/implemented/2026-09-20-D850-discrete-health-buckets.md — 决策沉淀（铁律 49，commit-msg 门禁消费）
  ※ 与任务卡 writeScopes 的偏差：卡写 `memory/notes/proposed`，实际落 `implemented/`。
    理由：`check-notes-lifecycle.sh` 判定「proposed/ Note 引用 D# 且该 D# 已 impl_done」= 僵尸条目 → 硬阻断；
    D850 的决策确实已落地（口径变更进代码），故按 `memory/notes/README.md` 四态规则放 `implemented/`（状态字段与目录一致）。
- docs/synova/product-lines/product-progress.json — 由 calc-progress.py 重生成；**本地验证但不提交**（G12d/D458 CI 单点生成物，session 提交即硬阻断）
- docs/synova/product-lines/product-progress.html — 由 gen-progress-page.py 重生成；**本地验证但不提交**（同上，G12d/D458）

不做什么（含文件路径）：
- 不改 docs/synova/product-lines/product-lines.yaml（编码 B 写集；本卡只读取 v2_lines，不改它）
- 不改 .github/workflows/ci.yml（CT-70/D854 独占）
- 不改 scripts/control-tower/synova-commit（D846-D848 地盘；本卡只调用它）
- 不改 scripts/audit/ 下任何文件（审计红线，永不由开发线修改）
- 不改 tests/control-tower/product-lines.test.py（不在本卡写集；其存量假红只登记，见遗留清单）
- 不改 docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md（不在本卡写集；CT-67 数字漂移只登记）
- 不改 scripts/product-lines/refresh-all.sh（会写 todos.yaml 等写集外文件，禁跑）
- 不改 dsh/plugins/synova-dashboards（win 域；跨域会破单域门禁，登记为遗留）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
- 派生器：`python3 scripts/project/gen-project-board.py --out docs/synova/project/ledger.json`
- 面板：`python3 scripts/product-lines/calc-progress.py --out docs/synova/product-lines/product-progress.json` → `python3 scripts/product-lines/gen-progress-page.py`
- 测试：`bash tests/project/gen-project-board.test.sh`
处理（中间经过哪些步骤）：
读 git 真相（V1 断言表 / yaml / 证据记录）→ 逐点判定 → 折叠为三档离散计数 + 每档 evidence_cmd + 恒等式 → 落 ledger.json / product-progress.json → 渲染 product-progress.html
结果（最终展示在哪）：
- `docs/synova/project/ledger.json` 的 `totals.buckets`
- `docs/synova/product-lines/product-progress.html` 头部「29 条产品线 + 三档 + 每档 evidenceCmd」（**页面零百分比**）
- 派生器 stdout 摘要行（零百分比）

## 架构层: 基础设施

## Done 标准
- [ ] 入口可触达: `python3 scripts/project/gen-project-board.py --out /tmp/l.json --quiet` 退出码 0 且 `/tmp/l.json` 含 `totals.buckets`
- [ ] 链路走通: `python3 scripts/product-lines/calc-progress.py --out docs/synova/product-lines/product-progress.json` 后 `python3 -c "import json;print(json.load(open('docs/synova/product-lines/product-progress.json'))['total_lines'])"` 打印 **29**
- [ ] 结果可见: `python3 scripts/product-lines/gen-progress-page.py` 后面板 HTML 含「29 条产品线」且**零百分比**；`bash tests/project/gen-project-board.test.sh` 打印 `FAIL=0`
- [ ] 三档恒等式物理闭合: 各档之和 + 显式列出的其它态 = v1_total（组⑩ 断言）
- [ ] 每档 `evidence_cmd` 非空且逐条实跑 exit 0（组⑩ 断言）
- [ ] 禁百分比 grep 零命中（创始人签字要求的唯一形式判据）
- [ ] `bash scripts/pre-commit-check.sh` 自过（禁 `--no-verify`）
#CRITERIA: A

## 写集豁免

> 本段由**小队队长（CTO 收口件）**追加：D850/M6 要求队长交齐「最终 diff / 自验结论 / 遗留清单」并逐张收口归属，这些收口件不在编码 A 的编码写集内，但属**同一派单**（`docs/synova/coordination/派单-CT70与D850-D852小队-20260920.md` §B「交回三件」）的交付物。逐条理由如下（`merge_writeset_gate.py` D708 声明级豁免机制）。

- docs/synova/coordination/收口-D850-D852小队-20260920.md — 三件交付之三（遗留清单＋归属逐张收口＋三态判定），队长件，非编码 A 写集
- docs/synova/coordination/D850-D852-改动清单-20260920.md — 三件交付之一（最终 diff），队长件
- docs/synova/coordination/D850-D852-自验记录-20260920.md — 三件交付之二（独立自验员三轮结论），队长件
- docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md — 台账登记（红线「发现即登记」：CT-71…CT-77；只追加行，不改既有条目）
- task-state/D852.json — D852 完成即释放：claimed → impl_done（同一收口动作）
- memory/notes/implemented/2026-09-20-D852-product-decisions-6-points.md — D852 决策 Note 迁入 implemented（与 task-state 成对，防 `check-notes-lifecycle.sh` 僵尸阻断）
- memory/notes/proposed/2026-09-20-D852-product-decisions-6-points.md — 同上（迁出侧，rename 的一半）
- .claude/task-briefs/2026-09-20-D850-D852-小队收口.md — 队长收口件的 task brief 本体（pre-commit G6 消费）
