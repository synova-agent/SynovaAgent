# Task Brief: D925 deps-interface/setter 注入立为标准 + 检查器（首版只报不拦）

> 生成: 2026-09-23 | 分支: feat/d925-deps-interface | 工作树: .synova-wt-d925 | 卡号: D925
> 域: mac（控制塔 / CI / 规格） | as any: 0 | base: `feat/d924-subprocess-protocol`（栈式，已声明）
> 标准文档: docs/synova/coordination/标准-deps接口与setter注入-20260923.md

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务在**控制塔/标准层**（不属 L1–L5 产品分层；它约束 L2 编排层模块的**依赖获取方式**）。
解决的问题：编排入口模块（`*Handler/*Runner/*Coordinator/*Dispatcher`）直接向**生产活单例**取依赖
（`getFeedbackCollector()` 等），导致无法在测试中替换协作者、且耦合点隐式扩散。
本卡把"**经 deps 接口 + setter 注入取依赖**"立为标准，并配可执行检查器（首版只报不拦）。

活证据（实测，裁定 5）：
- `src/agent/loop-handlers.ts` 已有 **5 组**注入缝：`:105 setDiagnosisDeps` / `:294 setNavigationDeps` /
  `:444 setSelfCheckDeps` / `:560 setKnowledgeDeps` / `:617 setOverflowDeps`，签名一律 `(deps: XxxDeps | null): void`
- **反例样板**：`:374 export async function defaultEvolutionHandler(scale)` → `:377 getFeedbackCollector().getAggregatedSignals()`
  **直连活单例**（登记为后续卡，**本卡不改 `src/**`**）

新增/替换/扩展：**新增**标准文档 + 检查器 + baseline/exempt + 夹具；**改** dev-doc-spec 技能模板（增第 12 节）；**改** ci.yml 登记夹具。

### b) 文件审计
```
.claude/skills/dev-doc-spec/SKILL.md                        — ⚠️ 改（11 节模板 → 增第 12 节「可测试性（deps 注入）」）
.dsh/skills/dev-doc-spec/SKILL.md                           — ⚠️ 改（**必须由 sync-dsh-skills.sh 生成，禁手改**）
docs/synova/coordination/标准-deps接口与setter注入-20260923.md — ❌ 新建（标准 + 适用范围 + 失效条件 + 边界值）
scripts/control-tower/check-deps-injection.sh               — ❌ 新建（检查器）
scripts/control-tower/deps-injection-baseline.txt           — ❌ 新建（ratchet，每行带理由）
scripts/control-tower/deps-injection-exempt.txt             — ❌ 新建（显式豁免，每行带理由）
tests/control-tower/check-deps-injection.test.sh            — ❌ 新建（三路径 + 变异体判别 + 两模式）
.github/workflows/ci.yml                                    — ⚠️ 改（canary 清单追加第 44 条）
```
同类既有检查器（口径复用，不重复造）：`scripts/control-tower/check-subprocess-protocol.sh`（D924，同为控制塔 .sh 检查器范式）。

### c) 决策
- 无既有覆盖（`git grep -lE 'export function set[A-Za-z]+Deps\(' -- src` → 仅 `loop-handlers.ts`）→ **新建**。
- 检查器用 **.sh**：`tsconfig.json:29` include 仅 `src/**`，`scripts/**` 下 .ts 无类型网（同 D924 口径）。
- 判据冻结经队长核准（裁定 1 选变体 **B 窄**；裁定 2 闭集含**排除 `getDatabase`**；裁定 3 排除面 +4 条）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

### a) 调研
- 业界：依赖注入的"C 方案"是 **setter/ambient injection**（面向既有单例系统渐进改造），
  测试注入缝 = 受控替换点；成熟做法（如 Go 的 functional options、TS 的 setter 注入）都要求
  **默认值惰性构造 + 显式覆盖**，禁止调用点直接向活单例取值。
- 顶级团队：把"禁止直连活单例"做成**可执行检查**而非文档约定（铁律 35 自动化优先）。
- memory 历史教训：铁律 38（`as never` 曾逃逸）、铁律 47/48（契约优先 + 测试非空壳）；
  控制塔域历史：软提示若不显式打印即退化为"什么都不报"（V3.9 教训：软机制 0% 有效）。

### b) Anthropic 决策链 ① SPEC → ② 测试 → ③ 实现 → ④ 接线 → ⑤ 验证
先出**判据冻结**并获队长核准（变体 B / 闭集 / 排除面）→ 再写夹具 → 再写检查器 → 登记 CI → 复跑验收。

### c) 决策参考系
参考：Anthropic（契约优先 + 三态退出码 + fail-closed）/ 第一性原理（判定单位应匹配"谁该负责注入"= 编排入口）
/ 开源实证（setter 注入的默认惰性构造范式）+ 结论：**变体 B（仅编排入口）+ 排除 getDatabase + 首版只报不拦**。

### d) 执行约束
引用铁律 0-2（spec→test→impl→wire）、铁律 11/24/31（静默降级禁止 + degraded 显式）、
铁律 35（能写 check-*.sh 的不靠 review）、铁律 47/48（契约优先 + 测试非空壳）。

## Q2: 范围

**做什么：**
- 新建 `docs/synova/coordination/标准-deps接口与setter注入-20260923.md` —— 标准 + **适用范围（声明式）** + 失效条件 + 边界值清单 + 反例样板
- 新建 `scripts/control-tower/check-deps-injection.sh` —— 检查器（R1/R2，两模式，三态退出码）
- 新建 `scripts/control-tower/deps-injection-baseline.txt` —— ratchet 存量（**每行带理由**）
- 新建 `scripts/control-tower/deps-injection-exempt.txt` —— 显式豁免（**每行带理由，无理由不生效**）
- 新建 `tests/control-tower/check-deps-injection.test.sh` —— 三路径 + 变异体判别 + 两模式 + 自我豁免断言
- 改 `.claude/skills/dev-doc-spec/SKILL.md` —— 11 节模板增第 12 节「可测试性（deps 注入）」
- 改 `.dsh/skills/dev-doc-spec/SKILL.md` —— **由 `sync-dsh-skills.sh` 生成**
- 改 `.github/workflows/ci.yml` —— canary 清单追加第 44 条
- 治理件：本 brief、`docs/synova/product-lines/evidence/D925-*`、`memory/notes/proposed/2026-09-23-d925-*`

**不做什么（含文件路径）：**
- **不改 `src/**` 任何产品代码**（含 `src/agent/loop-handlers.ts` —— 反例样板只写进标准文档，不在本卡修）
- 不改 `scripts/pre-commit-check.sh`（避免与 B3 抢文件）
- 不碰 `scripts/audit/**`（K3 专属，红线）
- 不改 `scripts/control-tower/check-subprocess-protocol.sh`（D924 产物，已交付）
- 不做一次性特例（豁免一律走"带理由的豁免文件 + baseline"两条规则缝，禁环境变量一键全豁免）

## 写集

> D749 单一事实源（机器块）。格式对齐 `scripts/control-tower/brief_parser.py`。
> 本块列**全部**变更文件（含 brief 自身与 Note），防 D708 判「夹带」。

| 文件 | 类别 |
|---|---|
| `.claude/skills/dev-doc-spec/SKILL.md` | task |
| `.dsh/skills/dev-doc-spec/SKILL.md` | task |
| `docs/synova/coordination/标准-deps接口与setter注入-20260923.md` | task |
| `scripts/control-tower/check-deps-injection.sh` | task |
| `scripts/control-tower/deps-injection-baseline.txt` | task |
| `scripts/control-tower/deps-injection-exempt.txt` | task |
| `tests/control-tower/check-deps-injection.test.sh` | task |
| `.github/workflows/ci.yml` | task |
| `.claude/task-briefs/2026-09-23-D925-deps-injection.md` | task |
| `docs/synova/product-lines/evidence/D925-deps-injection-20260923.md` | task |
| `memory/notes/proposed/2026-09-23-d925-deps-injection-standard.md` | task |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本，与写集无关） |

## Q3: 验收 — 入口 → 交互 → 结果

**入口（从哪触发）：**
- 人工/CI：`bash scripts/control-tower/check-deps-injection.sh --base <ref> --head <ref>`（**只判新增/改动文件**）
- 盘点/报告：`bash scripts/control-tower/check-deps-injection.sh --dir <路径>`（全扫 + baseline）
- CI：夹具 `tests/control-tower/check-deps-injection.test.sh` 登记进 `control-tower-tests` 显式清单（第 44 条）

**处理（中间步骤）：**
1. 收集扫描面：diff 模式取 `--base..--head` 的 A/M 文件；full 模式取 `--dir` 下 `src/**/*.ts`
2. 排除测试面（`*.test.ts` / `*.integration.test.ts` / `*.e2e.test.ts` / `tests/**`）
3. **R1**：文件（a）含生产单例 getter 调用（**具名闭集常量**）（b）导出编排入口函数（**具名常量**）（c）**未导出** `setXxxDeps` 注入缝 → 命中
4. **R2**：`export function setXxxDeps(` 声明行签名不匹配 `(deps: <Type> | null): void` → 命中
5. 比对 baseline（ratchet）与 exempt（**无理由不生效**；文件缺失/格式坏 → **0 条豁免**）
6. 输出命中；report 模式逐条 `::warning`

**结果（最终展示）：**
`mode=report`（默认）→ **恒 exit 0**，命中以 `::warning` 逐条打印；`--strict` → 新增违规 exit 1；
执行失败/降级 → exit 2（fail-closed，绝不等同通过）

**契约（铁律 47）：**
```
@input   — [--dir <路径>] | [--base <ref> --head <ref>] ; [--strict] ; [--baseline <文件>] ; [--exempt <文件>]
           注入缝（测试用）: SYNO_DEPS_GREP / SYNO_DEPS_GIT
@output  — stdout: 命中清单；report 模式每命中一行 "::warning file=<f>,line=<n>::<说明>"；末行 DEPS-INJECTION: OK|REPORT(n)|VIOLATION(n)
@exit    — 0 = 通过 / report 模式恒 0 ; 1 = --strict 且有新增违规 ; 2 = 检查执行失败/降级（fail-closed）
@degraded— 扫描器/仓库不可用 → exit 2 + stderr "degraded: <原因>" + <扫描根>/.codex/.../degraded-events.log
@error   — .code = DEPS_SCAN_UNAVAILABLE | DEPS_BASELINE_UNREADABLE ; .phase = 'scan'|'baseline' ; .retryable
```

**验收命令（可复制 + 预期退出码）：**
```bash
bash -n scripts/control-tower/check-deps-injection.sh                              # 0 语法
bash tests/control-tower/check-deps-injection.test.sh                              # 0 夹具全绿
bash scripts/control-tower/check-deps-injection.sh --base origin/main --head HEAD  # 0（首版只报）
bash scripts/workflow/sync-dsh-skills.sh --check                                   # 0（双目录一致）
```
**降级路径验收**：注入缝指向不可用扫描器 → **exit 2** + 显式 `degraded:`。
**变异体判别验收**：mktemp 副本上改坏 R1 判据 → 反例样例必须**漏判**；改坏 exempt 理由校验 → 无理由豁免**必须不生效**。
**自我豁免断言**：检查器跑自身/夹具目录 → **零命中**（防自吞）。
**红证不残留**：仓库内 `grep -rc INJECTED-RED` = 0。

## 架构层: 控制塔/标准层（非 L1–L5 产品分层）

产物位于 `scripts/control-tower/` + `tests/control-tower/` + `docs/synova/coordination/` + `.claude/skills/` + `.github/workflows/`，
属门禁/标准自身正确性域。**本卡不触任何产品代码（`src/**` 零改动）**。

## Done 标准: 至少一条可验证的完成标准

1. `bash tests/control-tower/check-deps-injection.test.sh` → **exit 0**（含三路径 + 变异体判别 + 两模式 + 自我豁免 + 豁免 fail-closed 断言）
2. `bash scripts/control-tower/check-deps-injection.sh --base origin/main --head HEAD` → **exit 0**（首版只报）
3. `bash scripts/workflow/sync-dsh-skills.sh --check` → **exit 0**（`.claude` ↔ `.dsh` 一致，组 13 硬阻断）
4. 新夹具**已登记**进 `.github/workflows/ci.yml` 的 `control-tower-tests` 显式清单（第 44 条；未登记 = 永不运行）
5. `python3 scripts/control-tower/merge_writeset_gate.py --base feat/d924-subprocess-protocol --head HEAD --branch feat/d925-deps-interface` → **夹带 0**
6. 交付含 `git diff --stat` 原始输出 + `git ls-remote --heads origin | grep d925` 回执
