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
| .github/workflows/ci.yml | task（**队长 2026-09-28 明确授权的写集扩展**：quality job 加「登记 + 真执行」step，见附录 D） |
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
- .github/workflows/ci.yml — quality job 末位加「A4-b LOG_LEVEL contract test (D1040)」step（**登记 + 真执行**，run 行含完整路径 tests/win/vitest-log-level.test.sh）
- docs/synova/product-lines/evidence/D1039-A4d-五workflow成本基线.md — A4-d 成本基线（含 A4-b 日志口径与本收尾三件）
- .claude/task-briefs/2026-09-28-D1040-A4b-vitest-log-level.md — 本件

不做什么

- 不改 packages/test-kit/vitest.config.ts（`packages/**` 红线；另一 harness，属另立卡）
- 不改 src/（本卡零产品代码变更）
- 不改 scripts/audit/（K3 专属红线）
- 不改 docs/synova/audit-reports/（K3 专属红线）
- 不改 memory/notes/（Note 由队长写）
- 不改 task-state/（队长建号）
- 不改 scripts/control-tower/check-gate-integrity.sh（登记 ratchet 本体不动——只加登记，不改判据）
- 不改 scripts/control-tower/check-canary-drift.sh（幽灵 matcher 本体不动）
- 不改 .github/workflows/ci.yml 的 control-tower-tests job 清单（该 job 零 npm 依赖，本测试须在有 npm ci 的 quality job 真执行）
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

- `.github/**` 改动 = **仅 `.github/workflows/ci.yml` 一处**（队长授权的写集扩展，见附录 D）；其余 `.github/**` 改动 **0**
- `src/**` 改动 **0**；`packages/**` 改动 **0**；`scripts/audit/**` 改动 **0**；`scripts/control-tower/**` 改动 **0**
- 禁 `--no-verify` / `git stash` / force push；**不 push**（队长攒批）
- 重型验证（全量 vitest）**串行**，与 `verifier-v` 互斥

---

## 附：执行期登记（不参与 Q2 解析，位于 `## Done 标准` 之后）

### A. 号段订正
原派单 D1035/D1036 作废（D1034 已被 main 占用），顺延 **D1040（A4-b）/ D1041（A4-d）**；证据文件按父卡号命名。

### B. 原卡面两处判据缺陷（已由队长裁定作废，登记备查）
1. 原验收命令 `grep -c '"level":20|40|50'` **有两处错**（BRE 下 `20|40|50` 非三选一；`-c` 只数行不分类）⇒ 改用逐档 `grep -oE '"level":<L>([^0-9]|$)'`。
2. 原卡面「改前 7,767 行 / 1.58 MB」是 **CI `Vitest (1/2)` 单分片 job 网页日志**口径，≠ 本地全量 stdout ⇒ 与本卡实测（14,502 行 / 2.79 MB，610 文件 / 4,538 用例）**不可直接比较**。

### C. ~~已知遗留（详见证据文件 §7.3）~~ **已由附录 D 闭合**
~~本测试**未登记进 `ci.yml` 密封清单** ⇒ 当前只能手工跑；登记由 A4-c/D1039 承接（合并顺序 A4-c 先、A4-b 后）。**不为变绿改 `ci.yml`。**~~

### D. 🔴 写集扩展（队长 2026-09-28 明确授权）—— 登记落点从 A4-c 改到本分支

**授权原文要点**：登记（+ 真执行）放进**本分支**，理由四条 ——
① 本树**有该测试文件** ⇒ 写完整路径**不产生「幽灵清单项」**告警；
② 登记立刻满足**本分支自己的** ratchet ⇒ **#873 当场可合**（不必再等 A4-c 先合）；
③ 合并后 main 同时拿到「文件 + 完整登记 + 真执行」⇒ 比「占位 + 事后补」干净；
④ 抹掉先前引入的 D1039→D1040 人为依赖（那条依赖本就是为绕 ratchet 才出现的）。

**被否决的 α 方案（登记在 A4-c）及其否决理由**：
`check-canary-drift.sh:34` 的幽灵 matcher 与 `check-gate-integrity.sh:618` 的登记 matcher **同源同形态**
（都扫 ci.yml 全文）⇒ ci.yml 一旦出现完整路径就**同时**算「已登记」+「清单项」；
而该文件**不在 A4-c 的树** ⇒ A4-c 会多一条幽灵告警，其文案 `幽灵清单项（清单有、文件无——改删）`
会**主动引导后人去删一行正确的登记** —— 一条会诱导后人删掉正确内容的可见告警，比静默更坏。

**本卡实际改动（两处，均实测）**：
1. `ci.yml` 的 `quality` job（**不是** `control-tower-tests`）**末位**加 step：
   `- name: A4-b LOG_LEVEL contract test (D1040)` / `run: bash tests/win/vitest-log-level.test.sh`。
   - **为何 quality**：本测试要 `npx vitest run`，而 CT job **零 npm 依赖**（无 `npm ci`）；quality 有 `npm ci`。test job 是 shard ×2 会跑两遍。
   - **为何末位**：测试内判别性夹具会临时注释 `vitest.config.ts` 契约行再复原（trap + cmp 自校验）⇒ 放末位可保证其后无 step 观察到该瞬时状态。
   - **登记形态为「真执行」**：run 行含**完整路径** `tests/win/vitest-log-level.test.sh` ⇒ 两个 matcher 都命中。**未用注释/无后缀写法取巧**（队长已否决）。
2. 本 brief 的 `## 写集` 机器块 + `## Q2` 做什么 **同步登记** `.github/workflows/ci.yml`（裸路径）。
   ⚠️ 同时**从「不做什么」删掉原「不改 .github/workflows/ci.yml」一行** —— 否则 G12 会把它判成
   「Q2 排除项禁止修改」**自己拦自己**（排除臂与 include 冲突）。

**未改（保持红线）**：`check-gate-integrity.sh` / `check-canary-drift.sh` 本体（只加登记，不改判据）、
CT job 的 for 清单、`.github/workflows/*.yml` 其余文件。
