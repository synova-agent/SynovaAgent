# D733: ownership 机器化 + CODEOWNERS 全量化（ownership-machine-readable）

> 派单: docs/synova/coordination/派单-第四批-D733-D736-20260913.md §一（批 A，P0）
> 前置实测: TASK-ROUTING.md v4 §一（L27-L40）+ §串行点（L58-L65）在 origin/main 存在；`.github/CODEOWNERS` 45 行 26 条规则存在。
> 范围裁定（创始人 2026-09-14 批准，选项 A）: D733 第④项（改 `scripts/control-tower/pre-dispatch-check.sh`）依赖未合入的 PR #536 —— 该文件在 origin/main **不存在**（实测 `git cat-file -e origin/main:scripts/control-tower/pre-dispatch-check.sh` → 非零）；本 PR 交付 ①②③⑤，第④项待 #536 合入后补小 PR。

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔基础设施（非五层运行时）。域划分当前只有两个消费者：① 人读的 `docs/synova/coordination/TASK-ROUTING.md`（纯 Markdown，零机器消费者）；② `.github/CODEOWNERS` 26 条规则，其中 Win 域用 `src/` 兜底且排在 `src/sentinel/`/`src/cron/`/`src/mcp/` **之后** —— CODEOWNERS 是「最后匹配者胜出」，所以那三条 Mac 例外被 `src/` 吞掉（`require_code_owner_reviews=false` 实测，故今日无功能差异，一旦建三团队即错）。本任务新增机器可读单源 ownership.yaml + 校验器 check-ownership.py，并让 CODEOWNERS 由该单源**生成**（逐字节 drift 门禁）。
### b) 文件审计
grep 实测（origin/main）: `check-ownership` 零命中（无同名能力，不撞车）；`ownership.yaml` 零命中；`grep -rln bypass.log scripts/ | wc -l` 与本任务无关。既有可复用资产：`scripts/product-lines/productline_yaml.py`（311 行严格 YAML 子集解析器，零三方依赖，D333 决策记录在案，契约 @input/@output/@degraded/@error 齐全）→ **复用不重写**（本机 `python3 -c "import yaml"` → ModuleNotFoundError，PyYAML 不可用）。
### c) 决策
已有覆盖→复用 productline_yaml（同域：scripts/product-lines 与 scripts/control-tower 同属 Mac DSH 域）。无覆盖→新建 ownership.yaml + check-ownership.py。冲突→无。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
业界: GitHub CODEOWNERS 官方语义 = **最后匹配者胜出**（default owner 习惯写法是首行 `*`），故「宽规则在前、例外在后」；glob→owner 单源 + 生成产物 + drift 断言是基础设施即代码的常规做法。Anthropic 工程基线: ① 隔离 —— 门禁脚本不依赖他线模块的可变状态；② fail-closed —— 三态退出码（0 通过 / 1 业务阻断 / 2 检查执行失败，D328）；③ 机器可验契约 —— 反向验证（改数据必变行为）。memory 历史教训: 铁律 46「拆完了必须 grep 物理证明」的同构错误——「声称已对齐」必须由逐字节 diff 证明；D728/D729 两次派错线（CTO 裁决书 commit 9aaf0c68：D728 写集 100% 落 Win 域却派给 Mac）；铁律 11 静默降级禁止。
Q1c 决策参考系: 参考 Anthropic（fail-closed 三态 + 机器可验契约 + 隔离）+ 第一性原理（一个问题只留一个机器权威源，其余是它的产物）+ 开源实证（CODEOWNERS last-match-wins 官方语义）。结论: 收敛 —— ownership.yaml 为唯一源，CODEOWNERS 由 `--emit-codeowners` 生成并由测试逐字节断言，解析复用仓内已验证子集解析器（不新增第三方依赖）。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/ownership.yaml（新建，唯一机器权威源；每条规则带 source 字段回溯 TASK-ROUTING.md 行号）
  · 含 `domain_neutral` 段（D734 前置）：`.claude/bypass.log` / `.claude/task-briefs/**` / `task-state/**` /
    `memory/notes/**` / `.claude/gate-hits.log` / `.codex/**` —— 这些路径**每条线都写自己那一份**，不构成域信号。
    实测依据：抽样 origin 上 3 个真实分支，`.claude/bypass.log` 出现在**每一个**分支（D521 hook 自动登记）；
    Win 线分支同样带 `.claude/task-briefs/<自己的 brief>.md`。不豁免则每个 PR 都被判跨域（含本 PR）。
- scripts/control-tower/check-ownership.py（新建，三态；`--owner` 断言模式 + 无 `--owner` 的单域模式 + `--emit-codeowners` 生成模式）
- .github/CODEOWNERS（由 ownership.yaml 生成，修复 last-match-wins 顺序——宽规则在前、Mac 例外在后）
- tests/control-tower/check-ownership.test.sh（新建，正常/降级/边界 + D728/D729 两次真实派错线回归）
  ※ 文件名按仓内硬门禁 CT-40 配对规则（`scripts/control-tower/<name>.py ↔ tests/control-tower/<name>.test.sh`，ct-test-gate.sh:18/45）
    定为 check-ownership.test.sh；派单写的 ownership.test.sh 会被 CT-40 判「缺配对测试」而硬阻断提交，故按门禁命名。
- .claude/task-briefs/2026-09-14-D733-ownership-machine-readable.md（本 brief 自身，D708 写集对账用）
- memory/notes/proposed/2026-09-14-ownership-machine-readable.md（铁律 49/D534 强制：改 scripts/control-tower/ 的 commit
  必须引用真实存在的 Note 路径，commit-msg 物理门禁；未落地故入 proposed/）
不做什么：
- 不改 scripts/control-tower/pre-dispatch-check.sh（D733 第④项接线；实测 origin/main 不存在该文件，只在未合入的 PR #536 —— 待 #536 合入后补小 PR）
- 不改 tests/control-tower/pre-dispatch-check.test.sh（同上，随 PR #536 的 pre-dispatch-check.sh 一起落地）
- 不改 scripts/pre-commit-check.sh（D734 独立 PR 才动这一组接线）
- 不改 scripts/audit/audit-rules.sh（K3 审计红线，禁碰）
- 不改 .github/workflows/ci.yml（派单红区，#520 刚改过）
- 不改 src/server.ts（Claude 专属串行点，本任务零产品代码）
- 不改 task-state/D733.json（该登记在未合入的 PR #536 上；本 PR 重复创建会造成 add/add 冲突）
- 不改 scripts/product-lines/productline_yaml.py（复用其 load_file，只读 import，不修改）

## Q3: 验收 — 入口 → 交互 → 结果
入口: `python3 scripts/control-tower/check-ownership.py <文件...> [--owner mac|win|k3]`。
处理: 读 ownership.yaml（复用 productline_yaml.load_file）→ 逐文件按「最后匹配者胜出」解析归属 → 与声明 owner 比对（或统计不同 owner 集合）。
结果: stdout 逐文件点名 `owner  path`；越域/跨域 → 逐行点名「期望 X 实际 Y」+ exit 1；无归属规则匹配 → ⚠️ 明示（不静默）+ 不计阻断；yaml 缺失/解析失败/未知名/无输入 → exit 2（fail-closed）。`--emit-codeowners` 输出 CODEOWNERS 全文，与 `.github/CODEOWNERS` 逐字节一致。

## 架构层: 基础设施
控制塔门禁基建（scripts/control-tower/），与五层运行时（L1-L5）无关：不 import src/、不 import packages/、零跨层。消费面 = 派单/PR 校验（第④项待 PR #536 合入后接线）。

## Done 标准: 物理命令断言（每条可直接跑，exit 0 = 达标）
- [ ] DS1: `python3 scripts/control-tower/check-ownership.py src/server.ts --owner mac; test $? -eq 1`（server.ts = Claude/Win 专属 → 派给 mac 必红）
- [ ] DS2: `python3 scripts/control-tower/check-ownership.py src/evidence/x.ts --owner mac; test $? -eq 1`（src/evidence = Win 域 → 派给 mac 必红）
- [ ] DS3: 反向验证（证明校验真在读数据）: `bash tests/control-tower/check-ownership.test.sh` 内含「删默认规则 → 上述两条变绿（exit 0）→ 还原」用例且全绿
- [ ] DS4: `bash tests/control-tower/check-ownership.test.sh` 全绿（正常/降级/边界 + D728/D729 真实错误回归）
- [ ] DS5: `python3 scripts/control-tower/check-ownership.py --emit-codeowners | diff - .github/CODEOWNERS`（drift 门禁，零输出 = 一致）
- [ ] DS6: `bash -n` 语法 + `python3 -m py_compile scripts/control-tower/check-ownership.py` 通过；写集外零改动（`git diff --name-only origin/main...HEAD` 仅列 Q2 include）
- [ ] DS7: `SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh` + `bash scripts/control-tower/simulate-ci.sh` 均 exit 0
