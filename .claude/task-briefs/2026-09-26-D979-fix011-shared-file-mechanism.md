# D979 — FIX-011：共享治理文件的多卡归属机制

## Q0: 定位
- 域: mac（控制塔）
- 对象（实测落点，**修正派单件前提#1**）: `scripts/commit-msg-check.sh` 第 46–127 行 的 D328 提交声明-内容一致性判定段
  - 派单件写 `scripts/pre-commit-check.sh` — 实测不成立：该文件无 D328 一致性判定段（grep 原始输出见回执）
- 归属解析链: `scripts/commit-msg-check.sh` → `scripts/workflow/resolve-commit-brief.sh` → `scripts/control-tower/brief_parser.py`

## Q1: 调研
- 实测 24h 内 `D328` 拦 3 次：`ci.yml`→D954、`task-state/D954.json`→D954、`派单模板.md`→D931/D943
- 后果：FIX-003 后半（CI 清单注册）被迫移出；R1–R4 两轮无法落 main
- 根因：**共享文件有历史归属 ⇒ 新卡改它即判"并行劫持"**（resolver 从暂存集只解析出一张 brief：认领数最多 → 锚点 → 日期回退，共享件被多张历史 brief 认领 ⇒ 选中陈旧 brief ⇒ CLAIM_DID≠MSG_DID）
- 本卡开工实测（red 基线，原始输出见回执）: 本卡真实暂存集（未改 Q2 前）被认领到陈旧 brief
  `2026-09-06-D582-CT-60-D328-提取大小写兼容.md` → `❌ D328: 提交声明(D979)与暂存文件归属(D582)不一致 — 疑似并行劫持` exit=1
- 冲突扫描: `git grep -c "commit-msg-check.sh" origin/main -- .claude` → 12 张历史 brief 认领该文件

## Q2: 范围

做什么（逐文件路径 — 本卡唯一写集，两两不重叠）:
- scripts/commit-msg-check.sh
- scripts/control-tower/shared_file_decl.py
- tests/control-tower/shared_file_decl.test.sh
- tests/control-tower/commit-msg-consistency.test.sh
- .claude/task-briefs/2026-09-26-D979-fix011-shared-file-mechanism.md
- task-state/D979.json
- scripts/control-tower/gen-watermark.sh
- tests/control-tower/gen-watermark.test.sh

> T3（本卡 Phase 3，迁移落地）另产出文档/证据类文件（`docs/synova/coordination/派单模板/**`、`docs/synova/coordination/号段水位.md`、`docs/synova/coordination/号段/**`、`docs/synova/product-lines/evidence/D979-迁移落地-20260926/**`）—— 权威清单见 `task-state/D979.json` 的 `write_set`（本行仅为说明，不参与代码认领）。

不做什么（含文件路径）:
- 不修改 scripts/pre-commit-check.sh
- 不修改 scripts/workflow/resolve-commit-brief.sh
- 不修改 scripts/control-tower/brief_parser.py
- 不修改 scripts/control-tower/staging_guard.py
- 不修改 scripts/control-tower/synova-commit
- 不修改 scripts/audit/
- 不修改 docs/synova/audit-reports/
- 不修改 src/

约束（说明，非排除项）: 不放宽门禁换通过；三态退出码语义不变（0 通过 / 1 业务阻断 / 2 检查失败=同样阻断）；不删既有检查；不新增逃生舱；不设 blanket 豁免。

## 写集

| 文件 | 类型 |
|---|---|
| scripts/commit-msg-check.sh | task |
| scripts/control-tower/shared_file_decl.py | task |
| tests/control-tower/shared_file_decl.test.sh | task |
| tests/control-tower/commit-msg-consistency.test.sh | task |
| .claude/task-briefs/2026-09-26-D979-fix011-shared-file-mechanism.md | task |
| task-state/D979.json | task |
| scripts/control-tower/gen-watermark.sh | task（T3） |
| tests/control-tower/gen-watermark.test.sh | task（T3） |

## Q3: 验收
- 入口: 任何卡的提交（`git commit` → commit-msg hook → `scripts/commit-msg-check.sh`）
- 处理: 授权卡改共享文件（被改文件内声明含 MSG_DID + CLAIM_DID 双向）⇒ 放行并打印证据行；非授权卡 ⇒ 仍拒
- 结果: 共享治理文件可被正常维护，真劫持仍被拦（`❌ D328 ... 疑似并行劫持` 保留）

## 架构层
控制塔

## 迁移清单（Done#3 — 目标与分步顺序；**本卡不执行**，逐文件属后续卡的写集）
目标共享文件（本卡冲突扫描实测认领数）与声明落点：
1. `scripts/commit-msg-check.sh` — 12 张历史 brief 认领；文本载体：文件头注释行 `# 共享声明: D###, D###`
2. `scripts/workflow/resolve-commit-brief.sh` — 29 张；同上（`#` 注释行）
3. `tests/control-tower/commit-msg-consistency.test.sh` — 4 张；同上
4. `task-state/D954.json` — 结构化载体：`"shared_with": ["D954", "D###"]`
5. `.github/workflows/ci.yml` — 文本载体：`# 共享声明: D###, D###`
6. `.claude/task-briefs/派单模板.md`（D931/D943 冲突件）— 文本载体：正文行 `共享声明: D###, D###`
分步顺序：
1. 机制先落 main（本卡）→ 2. 每个共享文件由其**当前 owner 卡**在自己的提交里加声明行（声明含 owner D# + 下一个确知要改该文件的卡 D#）→ 3. 后续卡改该文件时把新 D# 追加进声明（同一提交内改声明 + 改内容）→ 4. 每步走 PR，K3 复审。

## Done 标准
- [x] 机制落地：`scripts/control-tower/shared_file_decl.py` 解析两种声明载体 + `scripts/commit-msg-check.sh` 仅在双向命中时放行 — verify: bash tests/control-tower/shared_file_decl.test.sh
- [x] 两侧反例原始输出：授权通过（exit 0 + 证据行）/ 非授权仍红（exit 1 + `疑似并行劫持`）— verify: bash tests/control-tower/commit-msg-consistency.test.sh
- [x] 判别性夹具：删掉声明行即报红（非 grep 型静态判据）— verify: bash tests/control-tower/commit-msg-consistency.test.sh
- [x] 零回归：既有 13 个一致性用例全绿；MSG_DID 为空 / 无认领 / resolver 失败行为与修复前完全一致 — verify: bash tests/control-tower/commit-msg-consistency.test.sh
- [x] 语法与吞错：`bash -n scripts/commit-msg-check.sh` + `check-silent-swallow.sh --diff` 无新增静默吞错 — verify: bash -n scripts/commit-msg-check.sh
- [x] 声明落到真实共享件：`派单模板.md` 声明行 + 同窗口并发卡夹具红→绿（证据落 evidence/D979-迁移落地-20260926/）— verify: bash tests/control-tower/commit-msg-consistency.test.sh
- [x] 号段水位可复算：生成器从 task-state + 分支反查（水位非手写）+ `--check` 幂等 — verify: bash tests/control-tower/gen-watermark.test.sh

#CRITERIA: A
