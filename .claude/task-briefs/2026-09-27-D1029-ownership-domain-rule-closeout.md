# D1029 — ownership 域规则收口（兜底不再静默归 win + 改规则须创始人批准 + 域≠权限）

#CRITERIA: C

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层（非五层架构内）。本任务改**域归属机器判定**这一条既有门禁的语义，并给
「谁能改域规则」加一道原生机制。

两个真问题（CTO 派单原文，已逐条实测）：
① **规则自授权**：`ownership.yaml` 决定「谁能改什么」，而它自身落
   `docs/synova/coordination/**` = **mac** ⇒ 执行者能改规则。
   实测：`python3 scripts/control-tower/check-ownership.py docs/synova/coordination/ownership.yaml`
   → `mac  docs/synova/coordination/ownership.yaml`（exit 0）。
② **「兜底 = win」已反复出问题 5 次**：D782（`tests/doc-system`）、D793/D795（`tests/project`）、
   D861（`tests/agent`+`tests/e2e`）、D914（`docs/synova/dispatch|authority|research`）——
   每次都是「新目录没登记 → 落 `**` 兜底判 win → 混装 PR 跨域红灯」。
   机制：`scripts/control-tower/check-ownership.py:47` 把 `**` 映射为 CODEOWNERS `*`，
   `:134-145 resolve_owner()` 最后匹配者胜出 ⇒ 任何路径都至少命中 `**` ⇒ **永不返回 None**。

### b) 文件审计（grep 实测，非记忆）
- 唯一机器消费者 = `scripts/control-tower/check-ownership.py`（`ownership.yaml` 头 L5 自述）。
- 生产调用链（完整输出，共 3 处直连 + 1 处间接）：
  `scripts/control-tower/check-pr-budget.sh:37`（`OWNERSHIP=` 赋值）、`:137` 区段注释、
  `scripts/pre-commit-check.sh:1515-1526`（D734 块调 `check-pr-budget.sh`）、
  `scripts/control-tower/scan-fullwidth-vars.sh:68,209,241,245`（`--domain` 过滤）。
- CI 侧：`grep -n "ownership\|check-pr-budget" .github/workflows/ci.yml` → **零命中**
  ⇒ `tests/control-tower/check-ownership.test.sh` **未注册进 CI**（只本地跑）。
- 配对测试 = `tests/control-tower/check-ownership.test.sh`（229 行，58 项）。
- 生成物 = `.github/CODEOWNERS`（54 行，头 L4 声称 drift 由 `ownership.test.sh` 断言 ——
  该文件**全仓不存在**，实为 `check-ownership.test.sh`；存量文案缺陷，本卡一并订正）。
- 冲突扫描：在飞分支 `docs/D975-ownership-sentinel-domain` 触碰 `ownership.yaml`；
  `fix/d972-ownership-60-cases` 触碰 `check-ownership.test.sh`。两件均**未落 main**，
  本卡为其下游（合入顺序需 CTO 排期，见报告 §遗留）。
### c) 决策
复用既有脚本 + 既有测试 + 既有 D734 接线位，**不新建门禁脚本**；
② 只用 GitHub 原生 CODEOWNERS（不新增自研权限门禁）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 参考：Anthropic 工程基线（渐进式收紧 + 判别性夹具）+ 第一性原理（先量爆炸半径再改语义）
  + 开源实证（GitHub CODEOWNERS「最后匹配者胜出」，无层级归属概念）
- memory 历史教训：D733（域机器化）、D734（PR 预算）、D782/D793/D795/D861/D914（兜底误判 5 次）、
  D897/D911（门禁开始阻止修复门禁）。结论：**同类第 5 次 ⇒ 改机制，不再打补丁。**
- **开工前实测否证了卡面一处前提（关键，见 Q2c）**：按字面「未匹配任何规则 ⇒ 报未归属」，
  今日 main 有 **1262 / 5570** 个 tracked 文件会落「未归属」⇒ 该口径不可直接落地。
  已收敛为「未匹配任何**显式**规则 ⇒ 未归属（不再静默归 win）」+ 显式声明 win 基线领地。

## Q2: 范围 — 正确的最简方案

做什么：
- scripts/control-tower/check-ownership.py — 兜底语义：`**` 命中（且非显式规则/非基线领地/非域豁免）
  ⇒ **报「未归属」并 exit 1** + 提示「请在 ownership.yaml 显式加规则」+ 给逃生口；
  新增 `--changed-from REF` 取变更集（生产走 `HEAD`）+ `--pr-body` 读 PR 描述；
  新增 `--claim-check`：变更集含 `ownership.yaml` 而 PR 描述无创始人批准凭据 ⇒ exit 1。
- tests/control-tower/check-ownership.test.sh — 三条反例 + 判别性夹具（改坏即红）+ 旧「静默归 win」用例改写
- docs/synova/coordination/ownership.yaml — 头部自我声明（改本文件须创始人批准，凭据入 PR 描述）；
  新增 `domain_defaults`（win 基线领地显式声明）+ `rule_authority`（域≠权限、规则最终权限在创始人）；
  兜底规则注释改为「未归属 ⇒ 需显式认领」
- .github/CODEOWNERS — 生成物，须重跑 `--emit-codeowners` 覆盖（含订正第 4 行失效路径）
- .github/workflows/ci.yml — 把 check-ownership.test.sh + check-pr-budget.test.sh 注册进 control-tower-tests
- docs/synova/coordination/TASK-ROUTING.md — 新增「规则修改权」「域≠权限」两节（带 source 回溯）

不做什么：
- scripts/audit/** — 禁区（K3 红线），零触碰
- src/ 下任何产品代码文件 — 零触碰
- scripts/pre-commit-check.sh — 不扩 D734 块结构
- scripts/control-tower/check-pr-budget.sh — 未归属文案错配只登记不修
- scripts/doc-system/doc-registry-gate.sh — D2 登记门禁缺口另立卡
- docs/synova/coordination/ownership.yaml 的 domain_neutral 段与既有 rules 的 glob/owner — 只增不改
- .synova-wt-d975 与 .synova-wt-d972 两个在飞分支的写集 — 另开 PR
- 本卡不新建任何权限门禁脚本（② 复用 GitHub CODEOWNERS 原生机制，见 §Q2c/契约）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`python3 scripts/control-tower/check-ownership.py <文件...>`（`--owner` 断言 / 单域 / `--claim-check`）
处理：按「显式规则 → 基线领地 → 域豁免」解析；命中兜底 ⇒ 未归属；claims 检查 PR 描述凭据
结果：未归属逐条点名 + 提示显式认领命令 + exit 1；加规则后同 PR 通过（exit 0）；改规则无凭据 exit 1

## 架构层: N/A（治理层，非 L1–L5）

## Done 标准
- [ ] a) 新目录（未登记）提交 ⇒ 提示「未归属需认领」，不再静默归 win — verify: bash tests/control-tower/check-ownership.test.sh 含 §10a 用例全绿
- [ ] b) 同 PR 加规则 + 该文件 ⇒ 通过（逃生口有效）— verify: bash tests/control-tower/check-ownership.test.sh 含 §10b 用例全绿
- [ ] c) 改 ownership.yaml 但无创始人批准凭据 ⇒ 拦 — verify: bash tests/control-tower/check-ownership.test.sh 含 §10c 用例全绿
- [ ] d) 既有用例零回归 — verify: bash tests/control-tower/check-ownership.test.sh（贴 PASS/FAIL 原始计数）
- [ ] e) 下游消费者零回归 — verify: bash tests/control-tower/check-pr-budget.test.sh（贴 PASS/FAIL 原始计数）
- [ ] f) 生成物零漂移 — verify: python3 scripts/control-tower/check-ownership.py --emit-codeowners | diff - .github/CODEOWNERS（零输出）
- [ ] g) CODEOWNERS 头第 4 行指向真实文件 — verify: grep -n check-ownership.test.sh .github/CODEOWNERS
- [ ] h) 未归属存量已实测并登记（不静默）— verify: 报告 §存量 给出完整命令与原始输出

### DS1（核心反例 a）
```
python3 scripts/control-tower/check-ownership.py <一个只命中兜底、不在基线的路径>
  → exit 1，stdout 含「未归属」+「请在 ownership.yaml 显式加规则」
```
### DS2（逃生口 b）
沙箱：改动集 = {新目录文件, ownership.yaml(已加该规则)} ⇒ `--claim-check --pr-body <带批准凭据>` + 单域判定 → exit 0
### DS3（凭据 c）
沙箱：改动集 = {ownership.yaml}，`--pr-body` 无凭据 → exit 1；带 `## 创始人批准` → exit 0

## 写集声明（单一事实源）
```
scripts/control-tower/check-ownership.py
tests/control-tower/check-ownership.test.sh
docs/synova/coordination/ownership.yaml
.github/CODEOWNERS
.github/workflows/ci.yml
docs/synova/coordination/TASK-ROUTING.md
.claude/task-briefs/2026-09-27-D1029-ownership-domain-rule-closeout.md
task-state/D1029.json
memory/notes/proposed/2026-09-27-D1029-ownership-fallback-claim.md
docs/synova/product-lines/evidence/D1029-ownership/
```
