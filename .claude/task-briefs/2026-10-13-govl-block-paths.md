# Task Brief: 治理线 · 块级 `paths` 生成器 ＋ 对账门禁（CTO 裁定 074 步 1b）

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
施工账层（`docs/synova/coordination/施工项登记.ts` = 单一事实源）。
真源里 `ConstructionBlock.paths` 是 **手工跑脚本写死**的并集快照 ⇒ 施工项一变它就过时
（实证 2026-10-13：K10 少 4 条 / K12 多 2 条，根因＝生成快照时读到 PR #493 落地**前**的旧真源）。
本任务 = 给这份快照配 **① 能一键重算的生成器 ② 能对账的门禁**（治理线域：`scripts/control-tower/`）。

### b) 文件审计
- 既有同族：`scripts/control-tower/check-registry-invariants.ts`（登记件不变量，三态 0/1/2）——**取数方式照它**（`import` 真源）
- 既有先例反例：`施工项登记.ts:2405 deriveBlockDeps()`，`:2412` 对悬空 id 写 `if (!it) continue;`（**静默跳过**）
  ⇒ 🔴 本件**有意与之相反**（悬空 ⇒ 判不了 exit 2），并在 core 里指名注释
- 无既有 `paths` 生成器/门禁（全树零命中）⇒ 新建

### c) 决策
新建三个文件（core + 生成器 CLI + 门禁薄壳）＋ 夹具 7 个 ＋ vitest + 配对 `.test.sh`；
接入 pre-commit 组 9 现有块（**不新增组号**）＋ `.gitea/workflows/local-gates.yml` ① 步内一行（**不动 job name**）。

## Q1: 调研
- 铁律 47（契约优先：core 两纯函数先定 JSDoc 输入/输出/降级）｜48（测试禁空壳）
- 铁律 45（注释中 `*/` 必须加空格）—— 🔴 **本件实测踩到**：core 注释里写 `extensions/**/manifest.json`
  字面量，其中 `*` `/` 组合**提前终结块注释** ⇒ esbuild 报 `Expected ";" but found "localeCompare"`
  （**报错点 37 行、真因 32 行**）；修法＝不写字面量 + 注释里留痕
- ctrl-tower-change skill：模式 1（三态退出码 0/1/2，禁 `|| true` 吞崩溃）、
  模式 3（条件跳过 <1s；本件改为**无条件跑** 0.25s + 有界执行）、模式 5（夹具沙箱 + 接线检查）、模式 6（验收链）
- windows-compat：`set -uo pipefail` 头块 + UTF-8 强制 + 不裸依赖（tsx/node 三级探测）

## Q2: 范围
做什么（🔴 **裸路径、独立成行** —— D1231/#1308 口径，反引号包裹会被判"恒不中"）：
- scripts/control-tower/block-paths-core.ts
- scripts/control-tower/gen-block-paths.ts
- scripts/control-tower/check-block-paths.ts
- scripts/control-tower/check-block-paths.sh
- scripts/pre-commit-check.sh
- scripts/check-verifiable-done.sh
- .gitea/workflows/local-gates.yml
- tests/control-tower/block-paths-core.test.ts
- tests/control-tower/check-block-paths.test.sh
- tests/control-tower/check-verifiable-done.test.sh
- tests/control-tower/block-paths-fixtures/ok.ts
- tests/control-tower/block-paths-fixtures/mismatch-items.ts
- tests/control-tower/block-paths-fixtures/mismatch-snapshot.ts
- tests/control-tower/block-paths-fixtures/no-block-paths.ts
- tests/control-tower/block-paths-fixtures/no-items-export.ts
- tests/control-tower/block-paths-fixtures/no-paths-field.ts
- tests/control-tower/block-paths-fixtures/dangling.ts
- memory/notes/proposed/2026-10-13-block-paths-generator.md

（说明：`check-verifiable-done.sh` = **顺带修一处判据判别力缺陷**（实测发现）：
原实现只把 `- [x]` **那一行**喂进判定循环 ⇒ 写在**续行**里的 `verify:` 永远看不到
⇒ ① 合法写法假红（本卡实测：报 3 项缺 verify，而那 3 项下一行都写着 verify:）
② 只要把 verify 挤在同一行就过、续行内容不参与判定。修法只动**取数**（条目 = 该行 ＋ 其缩进续行），
"必须有 verify"这条判据**不放松**。同族：本卡 brief 的 Done 段首版就是被它假红的。
`block-paths-core.ts` = 唯一实现 `computeBlockPaths` / `compareBlockPaths` / `renderBlockPathsJson`；
`gen-block-paths.ts` = 生成器 CLI（`--list` / `--json-raw` / 默认 JSON）；
`check-block-paths.ts` ＋ `.sh` = 门禁（判定 + 薄壳）；`pre-commit-check.sh` 加组 9 附加块，**不新增组号**；
`local-gates.yml` 加 ① 逐步内一行。**不新增任何组号/步骤名**。）

不做什么（含文件路径）：
- ❌ 不改 docs/synova/coordination/施工项登记.ts（CTO 红线，含 `paths` 字段**内容**）
- ❌ 不碰 scripts/audit/**（K3 红线）
- ❌ 不改 .github/workflows/ci.yml 与 .gitea/workflows/local-gates.yml 的任何 **job `name:`**（12 必需 context 唯一产出者）
- ❌ 不动 scripts/check-pr-budget.sh（MAX_FILES 阈值承载件；派单 §五明令）
- ❌ 不实现 `--write` 回写真源（红线 + 脆弱文本替换；快照更新由 CTO 在红线域执行）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/check-block-paths.sh`（pre-commit 组 9 / CI ① 步自动调）
处理：`import` 真源 ⇒ `blocks[].items[].paths` 并集（去重 + 纯码点序）⇒ 与块级 `paths` 快照逐块比
结果：一致 `✅…14 块逐块一致` / exit 0；不一致：逐块差集点名（`- 仅快照有` / `+ 仅现算有`）+ exit 1；
      判不了：点名原因 + exit 2（fail-closed，**绝不"空结果当通过"**）

## Q4 契约与测试
- 契约：core 两函数的 `@input/@output/@degraded/@exit` 全写在 JSDoc（见文件头，铁律 47）
- 三态：`0` 一致 ｜ `1` 不一致 ｜ `2` 判不了（读不到真源/导出缺失/形状不符/悬空 id/块级 paths 字段缺失）
- 排序：**纯码点序**（写死；禁 `localeCompare`——依赖 locale/ICU，跨机不稳定；实证 K10 两者给出不同序）
- 测试：10 情境逐条有断言（vitest 32 断言全绿）＋ 负向 4 条贴原始输出（`.test.sh` 23 断言全绿）
- 可复现：同输入两次独立进程 ⇒ `cmp` 逐字节相同（哈希 `84b3bfb2981a4de6` = `84b3bfb2981a4de6`）

## 本任务在哪一层
−1 运行时（登记件/施工账 ＋ 控制塔门禁脚本；不涉五层业务代码）

#CRITERIA: A

## 写集
- scripts/control-tower/block-paths-core.ts
- scripts/control-tower/gen-block-paths.ts
- scripts/control-tower/check-block-paths.ts
- scripts/control-tower/check-block-paths.sh
- scripts/pre-commit-check.sh
- scripts/check-verifiable-done.sh
- .gitea/workflows/local-gates.yml
- tests/control-tower/block-paths-core.test.ts
- tests/control-tower/check-block-paths.test.sh
- tests/control-tower/check-verifiable-done.test.sh
- tests/control-tower/block-paths-fixtures/ok.ts
- tests/control-tower/block-paths-fixtures/mismatch-items.ts
- tests/control-tower/block-paths-fixtures/mismatch-snapshot.ts
- tests/control-tower/block-paths-fixtures/no-block-paths.ts
- tests/control-tower/block-paths-fixtures/no-items-export.ts
- tests/control-tower/block-paths-fixtures/no-paths-field.ts
- tests/control-tower/block-paths-fixtures/dangling.ts
- memory/notes/proposed/2026-10-13-block-paths-generator.md
- .claude/task-briefs/2026-10-13-govl-block-paths.md

## Done 标准
### 本件判据（逐条可跑）
- [x] verify: `bash scripts/control-tower/check-block-paths.sh`（expectExit 0 —— 真源 14 块逐块一致）
- [x] verify: `bash tests/control-tower/check-block-paths.test.sh`（expectExit 0 —— 23 断言全绿）
- [x] verify: `bash tests/control-tower/check-verifiable-done.test.sh`（expectExit 0 —— 8 断言全绿，续行 verify 取数回归）
- [x] verify: `npx vitest run tests/control-tower/block-paths-core.test.ts`（expectExit 0 —— 32 断言全绿）
- [x] verify: `npx tsx scripts/control-tower/gen-block-paths.ts --list | wc -l`（expectExit 0 —— 14 行）
### 附加模板项
- [x] 反例（改坏即红）：N1 改 item.paths ⇒ exit 1 ／ N2 删块级 paths 条目 ⇒ exit 1
      （`verdict` 判据点＝配对测试 D 组，commands 见 tests/control-tower/check-block-paths.test.sh）
      verify: bash tests/control-tower/check-block-paths.test.sh
- [x] 三态：缺导出 / 缺块级 paths 字段 / 悬空 id ⇒ exit 2（**不是 0**）
      （判据点＝配对测试 E 组，夹具 no-items-export.ts / no-block-paths.ts / dangling.ts）
      verify: bash tests/control-tower/check-block-paths.test.sh
- [x] 接线：pre-commit 组 9 ＋ local-gates.yml ① 步（WIRE CHECK 由配对测试 A 组断言）
      verify: bash tests/control-tower/check-block-paths.test.sh

---
## 状态
- 2026-10-13：本卡建立。依据 CTO 裁定 074 步 1b ＋ **放行令（裁定 078）**。
