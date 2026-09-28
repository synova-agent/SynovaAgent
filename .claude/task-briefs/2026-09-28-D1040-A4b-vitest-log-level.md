# Task Brief: D1040 A4-b 测试期 LOG_LEVEL 收敛（win 域）

> 生成: 2026-09-28 | 任务: **D1040**（A4-b；父卡 D1039） | 认领: DSH 小队成员 `coder-b`（队长 `lead`）
> 工作树: `.synova-wt-a4-b` ｜ 分支: `team/a4b-vitest-log`
> 源卡: CTO 派单「A4-b · 测试强制 `LOG_LEVEL=warn`」（task-2，本轮会话直派）
> 号段订正: 原派单写 D1035，与 main 已占用的 D1034 相邻批次撞号 ⇒ 队长 2026-09-28 顺延为 **D1040**

#CRITERIA: D

## 写集

> D749 机器块 = 写集**单一事实源**（解析器 `scripts/control-tower/brief_parser.py` `parse_write_set`；消费方 `scripts/pre-commit-check.sh` 组 12 G12）。散文 §Q2 仅作说明。
> 类：`task` = 本卡交付物；`builtin` = 运行期产物，不计入 include。
> ⚠️ 本文件**不得**再出现第二个 `^##\s*写集` 标题（D1028 实证：末尾 `## 写集边界（红线复核）` 被抢先命中 ⇒ 该块无表格行 ⇒ `include=[]` ⇒ G12 全量误报硬阻断）。

| 文件 | 类 |
|---|---|
| vitest.config.ts | task |
| tests/win/vitest-log-level.test.sh | task |
| docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md | task |
| .claude/task-briefs/2026-09-28-D1040-A4b-vitest-log-level.md | task |
| .claude/bypass.log | builtin（post-commit hook D521 自动追加 `COMMITTED \| pre-commit PASS`，非人工写入） |

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
**测试基建域**（非 L1–L5 产品层）。`vitest.config.ts` 是仓库根测试配置（`package.json` 的 `test: vitest run` 默认解析它），`test.env` 段向所有测试 worker 注入环境变量。本任务在 `test.env` 增一条 `LOG_LEVEL`，使测试期日志默认收敛到 `warn`——**ERROR 不再被 INFO 淹没，且失败时上下文仍在**。

### b) 文件审计（实测，file:line）

| # | 卡面前提 | 命令 | 实测输出 | 结论 |
|---|---|---|---|---|
| P1 | `packages/logger/src/index.ts:12` 模块加载期固化级别 | `sed -n '12p'` | `const level = process.env.LOG_LEVEL \|\| 'info';` | ✅ |
| P2 | 同级 `:44` 有 `silent` 二级抑制开关 | `grep -n LOG_LEVEL` | `12:`、`44: if (process.env.LOG_LEVEL !== 'silent') {` | ✅ 故**不得设 silent** |
| P3 | `vitest.config.ts` 有 `test.env` 但无 `LOG_LEVEL` | `grep -c LOG_LEVEL vitest.config.ts` | `0`（改前） | ✅ |
| P4 | 裸跑 `process.env.LOG_LEVEL === undefined` | 探针 test 文件 | `PROBE_ENV_LOG_LEVEL=undefined` / `PROBE_PINO_LEVEL=info` | ✅ |
| P5 | vitest 版本 4.1.8 | `npx vitest --version` | `vitest/4.1.8 darwin-arm64 node-v24.19.0` | ✅ |
| P6 | `tests/win/**` 已存在 | `ls tests/win/` | **不存在**（全仓 `grep -rn "tests/win"` **零引用**） | ❌ 前提不成立 → 本卡**新建目录** |
| P7 | `test.env` 覆盖/合并语义 | 探针 E2b（硬编码 `'warn'` + 外部 `LOG_LEVEL=debug`） | worker 内得 **`warn`**（外部值被压掉） | 🔴 **覆盖语义** ⇒ 必须写 `process.env.LOG_LEVEL ?? 'warn'` |

**冲突扫描（M2）**：全仓 `LOG_LEVEL` 引用共 8 处（`grep -rn`，排除 node_modules/.git）——
`packages/logger/src/index.ts:12,44`（读方，只读）、`vitest.config.ts`（本卡写）、
`packages/test-kit/vitest.config.ts:29`（**另一个 harness**，用 `'silent'`）、
`packages/test-kit/src/test-utils.ts:32`、`src/init/engine-context.ts:154`、`src/tui-v2/lib/bootstrap.ts:50`、
`README.md:82`。**写集无重叠**——根 vitest 的 `include` 仅 `./tests/**`，不覆盖 `packages/test-kit/tests/**`。

### c) 决策
复用：既有 `test.env` 段（不新增 `setupFiles`，不新增依赖）。
新建：`tests/win/` 目录 + 一个 `.test.sh` 契约测试。
取消：无。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **第一性原理**：日志的价值 = 失败时**恰好**需要的那几行。INFO 全量输出会把 ERROR 淹掉（改前 ERROR 320 条淹没在 6,619 条 INFO 中）；但把级别压到 `silent` 则连 ERROR 也没了，等于**把仪表的线剪断**。正确解是**选择性收敛**：留 WARN+ERROR。
- **Anthropic 基线**：测试基建改动必须配**判别性夹具**（改坏即红），且判据要在**真实运行时**判定，不能只 grep 配置文本。
- **开源实证 / 本仓既有范式**：`packages/test-kit/vitest.config.ts:29` 已用 `test.env.LOG_LEVEL` 范式 ⇒ 复用而非发明。
- **memory 历史教训**：① **坑清单「禁 grep 型静态判据当验收」**（实测 3/5=60%）⇒ 本卡判据在**测试 worker 进程内**读 `process.env` 与 `logger.level`，不 grep 配置；② **坑清单「『接线了』≠『被执行』」** ⇒ 判别性夹具 = 拿掉修复后必须转红；③ D580 同型：`tests/acceptance/zero-code-industry.test.ts:73-75` 断言 `git diff --name-only` 无 `.ts` ⇒ **编辑期必红、commit 后自愈**。
- 参考：第一性原理（选择性收敛）+ Anthropic（判别性夹具）+ 开源实证（test.env 既有范式）+ 收敛（不引入 setupFiles）

## Q2: 范围 — 正确的最简方案

做什么

- vitest.config.ts — 在 `test.env` 增 `LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn'`（不新增 setupFiles）
- tests/win/vitest-log-level.test.sh — 新建契约测试（正向 warn / 外部 debug 透传 / 不得 silent / 判别性夹具 / 生产接线 / 时序守卫四判据）
- docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md — A4-d 成本基线（含 A4-b 日志口径与本收尾三件）
- .claude/task-briefs/2026-09-28-D1040-A4b-vitest-log-level.md — 本件

不做什么

- 不改 .github/workflows/ci.yml（**队长 2026-09-28 裁决 A 撤回**：该文件属 **mac 域**，加进本 win 域 PR 会被 D734 ②「变更跨域」硬阻断；登记由 A4-c/D1039 承接，见附录 D）
- 不改 packages/test-kit/vitest.config.ts（`packages/**` 红线；另一 harness，属另立卡）
- 不改 src/（本卡零产品代码变更）
- 不改 scripts/audit/（K3 专属红线）
- 不改 docs/synova/audit-reports/（K3 专属红线）
- 不改 memory/notes/（Note 由队长写）
- 不改 task-state/（队长建号）
- 不改 docs/synova/coordination/ownership.yaml（域映射属治理源，且在 OUTBOUND_DENY_EXACT 绝不豁免）
- 不改 scripts/control-tower/check-pr-budget.sh（预算门禁本卡只读——不为解开跨域改判据）
- 不改 scripts/control-tower/check-gate-integrity.sh（登记 ratchet 本体不动）
- 不改 scripts/control-tower/check-canary-drift.sh（幽灵 matcher 本体不动）
- 不改 packages/logger/src/index.ts（读方只读，本卡只改注入侧）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/win/vitest-log-level.test.sh`（手工）；CI 侧由 `ci.yml` 密封清单登记后执行——**本卡不登记**，登记在 A4-c。
处理：测试内生成临时探针 `.test.ts` ⇒ `npx vitest run <探针>` 在**测试 worker 进程内**打印 `process.env.LOG_LEVEL` 与 `logger.level` ⇒ 解析断言。
结果：逐条 ✅/❌ 打印 + 退出码（0 全绿 / 1 有断言失败）；临时探针与备份配置由 `trap` 自清理。

## 架构层
测试基建域（仓库根配置 + `tests/` 测试面），非 L1–L5 产品层。

## Done 标准

- [ ] 改前/改后 `npx vitest run --reporter=verbose` 行数下降：verify: bash -c 'test -s /tmp/a4b-before.log && test -s /tmp/a4b-after.log && test "$(wc -l < /tmp/a4b-after.log)" -lt "$(wc -l < /tmp/a4b-before.log)"'
- [ ] 级别分布：改后 INFO(`"level":30`) 计数 = 0，ERROR(`"level":50`) 与改前**恒等**：verify: bash -c 'test "$(grep -oE "\"level\":30([^0-9]|$)" /tmp/a4b-after.log | wc -l | tr -d " ")" = "0"'
- [ ] 契约测试全绿：verify: bash tests/win/vitest-log-level.test.sh
- [ ] 判别性夹具：拿掉 `vitest.config.ts` 的 `LOG_LEVEL` 契约行 ⇒ 同测试 **EXIT=1**（3 条断言失败）
- [ ] 时序守卫三判据：① 未含修复的分支 ⇒ 跳过留痕且不红；② 本分支 ⇒ 硬断言通过；③ 本分支删掉契约行 ⇒ 红
- [ ] `npx vitest run tests/logger.test.ts` 仍绿（5/5）
- [ ] `GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh` ⇒ **全部 13 组通过**
- [ ] 收尾三件（diff / 自验结论 / 遗留清单）提交进仓库并给路径

## 红线复核

- `.github/**` 改动 **0**（β 曾加 16 行，**已按裁决 A 全量撤回**，见附录 D）；`src/**` 改动 **0**；`packages/**` 改动 **0**；`scripts/audit/**` 改动 **0**；`scripts/control-tower/**` 改动 **0**
- 禁 `--no-verify` / `git stash` / force push
- 重型验证（全量 vitest）**串行**，与 `verifier-v` 互斥

---

## 附：执行期登记（不参与 Q2 解析，位于 `## Done 标准` 之后）

### A. 号段订正
原派单 D1035/D1036 作废（D1034 已被 main 占用），顺延 **D1040（A4-b）/ D1041（A4-d）**；证据文件按父卡号命名。

### B. 原卡面两处判据缺陷（已由队长裁定作废，登记备查）
1. 原验收命令 `grep -c '"level":20|40|50'` **有两处错**（BRE 下 `20|40|50` 非三选一；`-c` 只数行不分类）⇒ 改用逐档 `grep -oE '"level":<L>([^0-9]|$)'`。
2. 原卡面「改前 7,767 行 / 1.58 MB」是 **CI `Vitest (1/2)` 单分片 job 网页日志**口径，≠ 本地全量 stdout ⇒ 与本卡实测（14,502 行 / 2.79 MB，610 文件 / 4,538 用例）**不可直接比较**。

### C. 已知遗留（详见证据文件 §7.3）—— **回到 α：登记由 A4-c/D1039 承接**
本测试**未登记进 `ci.yml` 密封清单** ⇒ 当前只能手工跑（CI 会真跑 = 待 A4-c 登记后，见附录 D）。
**不为变绿改 `ci.yml`。**

### D. 🔴 登记落点：β 试过 → 被硬门禁否决 → **按裁决 A 全量回退到 α**（2026-09-28 同日三段）

> 本节按时间顺序记录三次变化，**含被否决方案与被回退的提交**，供 K3 核账。

**D1. 原方案 α（登记在 A4-c/D1039）**
被队长否决，理由：`check-canary-drift.sh:34` 的幽灵 matcher 与 `check-gate-integrity.sh:618` 的登记 matcher
**同源同形态**（都扫 ci.yml 全文）⇒ ci.yml 出现完整路径即同时算「已登记」+「清单项」，而该文件不在 A4-c 的树
⇒ A4-c 多一条幽灵告警，其文案会**引导后人删掉一行正确的登记**。

**D2. 改为 β（登记在本分支）—— 队长授权写集扩展**
改动：`ci.yml` 的 `quality` job 末位加 step（`run: bash tests/win/vitest-log-level.test.sh`，
含完整路径；**真执行**非注释）。落点理由：本测试要 `npx vitest run`，CT job 零 npm 依赖；
`test` job 是 shard ×2 会跑两遍；`quality` 有 `npm ci`。
末位理由：判别性夹具会临时注释 `vitest.config.ts` 再复原 ⇒ 保证其后无 step 观察到瞬时状态。
同步把 ci.yml 登记进本 brief 机器块 + Q2，并**删掉**「不做什么」里原「不改 .github/workflows/ci.yml」一行
（否则 G12 会把它判成 Q2 排除项**自己拦自己**）。

**D3. 🔴 β 在真机上被硬门禁否决 —— 撤回**

推送后 CI run `36366542542`（sha `adc1b741`）实测：
```
  Gate Integrity (...)                                         completed  **success**  22s   ← ✅ 红2 修好
  TypeScript + Lint + Iron Laws                                completed  **failure**  118s  ← ❌ 新红
   失败步: [ 8] Iron laws check  **failure**  2.0s
   我的 step: [11] A4-b LOG_LEVEL contract test (D1040)  skipped（被前面失败挡住）
```
**真因 = D734 ②「变更跨域」（hard FAIL）**，本地复跑原始输出：
```
$ bash scripts/control-tower/check-pr-budget.sh --base origin/main
  ✅ ① 变更文件数 4 ≤ 上限 12
  ❌ ② 变更跨域 —— 一个 PR 只许一个域（D733 ownership.yaml）
       mac  .github/workflows/ci.yml          ← β 加进来的这一处
       win  tests/win/vitest-log-level.test.sh
       win  vitest.config.ts
  ✅ ③ 落后 origin/main 0 个提交 ≤ 20
❌ FAIL PR 超预算      EXIT=1
```
`docs/synova/coordination/ownership.yaml:151-153` 实测：`.github/workflows/**` → **owner: "mac"**。

**关键复核（推翻 α 被否的唯一理由）**：幽灵**只是 warning，不是失败** ——
```
$ sed -n '56,83p' scripts/control-tower/check-canary-drift.sh
  echo "::warning title=canary-ghost::CI 清单含不存在文件"     ← ::warning，非 ::error
  ...
  exit 0                                                       ← 脚本恒 exit 0（本机实测 EXIT=0）
```
⇒ 代价不对等：**α = 一条自愈 `::warning`；β = 一个硬阻断，PR 合不进去。**

**D4. 裁决 A（队长 2026-09-28）：回退 β，回到 α** —— 队长认同「用硬阻断换一条 warning 是方向错了」。
**本卡已执行**：`.github/workflows/ci.yml` **逐字恢复到 `origin/main` 版本**（β 的 16 行全量撤回，
`git diff origin/main -- .github/workflows/ci.yml` = 空）；brief 机器块 / Q2 / 红线复核同步回退；
登记由 **A4-c/D1039** 承接（合并顺序：A4-c 先，A4-b 后）。

**D5. 根因归属（队长裁定，非本卡执行方责任）**：`ci.yml` 属 **mac 域**这条前提**应由派单方在拍 β 前核**；
队长已认领并署名。本卡记功项：**未改 `.test.sh` 后缀/名字**（形状取巧，队长已否决）、
**未改 `ownership.yaml`**（不在写集 + 在 `OUTBOUND_DENY_EXACT` 绝不豁免）、
**未自寻跨域逃生口**（读 `check-pr-budget.sh` 确认唯一豁免是 D1028 出库豁免，`ⓐ∧ⓑ` 均不满足 ⇒ 如实报而不硬凑）。

**D6. 未被撤回的产出（本次 β 试验的净收益）**：D3 的**域冲突证据本身**
（「登记要与文件同树」与「D733 单域」两条约束天然打架 —— `ci.yml` 是 mac、被登记文件是 win）
已写入证据文件 §8.6，供 CTO 判定是否需要为「跨域登记」开一条正路。

### E. 与队长指令的一处口径修正（已获队长确认）
本卡早期按「**禁 push**」执行；后续队长指令要求 `synova-commit` 提交 —— 该工具**自带 push（M4 设计行为）**。
队长 2026-09-28 确认：**这是工具设计行为，不算违反纪律**，且「全员禁 push」与 `synova-commit` 路径**自相矛盾**，属指令口径问题。
