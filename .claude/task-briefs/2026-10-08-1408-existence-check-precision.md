# Task Brief: #1408 类级复查 —— "是否存在 X"判断的精度修复

> 卡: **#1408**（K3 · W1-时序 · p1）｜CTO 2026-10-08 要求（批 C 前置）：**同型错误第二次 ⇒ 做类级检查**
> 声明载体: `.claude/claims/1408.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
批 A/B 两次踩到"同名串骗过判断"（writer import 被注释骗过｜接口扩写被注释骗过）⇒ 本 PR 做**类级复查**并修全部同类。

### b) 文件审计（实跑，ref=origin/main@23a0f0d7b）
**本卡用过的"是否存在 X"判断清单（逐个核）**：
| # | 判断 | 对象 | 精度 | 判 |
|---|---|---|---|---|
| 1 | V3 覆盖率扫描（`tests/sentinel/silent-wrong-value.test.ts:72`） | **源码文本** | 排 import ✓｜**未排注释 ✗** | 🔴 **第三处 ⇒ 修** |
| 2 | V3-b 覆盖率扫描（同文件 `:133`） | 源码文本 | 同上 | 🔴 同修 |
| 3 | claim 的 verify 命令（`grep -rl "checkFiniteInputs("`） | 源码文本 | 未排注释 ✗ | 🔴 修（comment-proof 口径） |
| 4 | `toContain('非有限数')` / `toContain('缺字段')`（测试内多处） | **运行时返回值**（warnings 数组） | 精确（断言的是返回值文本） | ✅ 不属于本风险类 |
| 5 | 助手/写入器内部（`src/sentinel/assert-finite-inputs.ts`） | 运行时数据 | 无源码文本判断 | ✅ |

### c) 决策
**判据分两类**：**对源码文本**的存在性判断必须精确（排注释/排 import/限定代码行）；**对运行时值**的断言不受此风险影响。
⇒ 修 1/2/3；并加**精度自证**（合成内容断言）+ **归因实验**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **扫"出现" ≠ 扫"调用"**（本卡已踩一次：V3 首版只扫"出现"⇒ M1 假绿）
- **扫"注释" ≠ 扫"代码"**（本卡再踩两次）⇒ 一般化：**凡"按代码形态"写的检查，都能被"换一种等价形态"绕过**
- 防御：**把启发式判断换成确定性检查**（精确匹配 / 限定行 / 排除注释）

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行）：
- tests/sentinel/silent-wrong-value.test.ts — 新增 `isCallLine()` / `countCallLines()`（排注释 + 排 import + 匹配调用形状）；两处扫描改用它；新增 **V3-c 精度自证**断言（注释行/JSDoc/import ⇒ 0；真实调用 ⇒ 1）
- .claude/claims/1408.yaml — verify 命令改 comment-proof 口径
- .claude/task-briefs/2026-10-08-1408-existence-check-precision.md — 本 brief

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/margin-health/computes/compute-incentive-bind.ts（仅实验时临时注入注释，**已 `git checkout` 还原**）
- 不改 src/sentinel/assert-finite-inputs.ts（助手无源码文本存在性判断）
- 不改 src/sentinel/metric-readings-writer.ts（批 A 已合；其 import 判断已 anchord 到 `^import`）
- 不改 extensions/sentinels/capital-health/computes/asset-turnover.ts（批 B 已合）
- 不改 scripts/pre-commit-check.sh（门禁脚本 = 治理线路径）

范围外约束（非文件级）：门禁发现第 12/13/14/15 条 ⇒ 交门禁治理线（只报不动）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`npx vitest run tests/sentinel/silent-wrong-value.test.ts`。
处理：扫描判定"调用行"时排除注释与 import。
结果：仅注释提及 ⇒ **不计为调用**；真实调用 ⇒ 计 1。

## Q4 契约与测试:
- 契约：`isCallLine(line): boolean`（注释/JSDoc/import ⇒ false；`checkFiniteInputs(` 调用 ⇒ true）｜`countCallLines(content): number`
- 测试：**V3-c 精度自证**（4 个合成样例）+ 原有 V1/V2/V3/V4/V-writer/V1-b/V2-b/V3-b/V4-b 不回归
- 归因实验：旧谓词 + 仅注释提及 ⇒ **V3 红（集合 6≠5）**；新谓词 ⇒ 绿
- 零 `as any` / `as never` / `as unknown as`

## 架构层: tests/**（判据精度）+ 声明载体

## Done 标准
- [ ] verify: npx vitest run tests/sentinel/silent-wrong-value.test.ts
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/l4/ tests/agent/ tests/adapters/
- [ ] verify: bash -c 'grep -c "isCallLine" tests/sentinel/silent-wrong-value.test.ts'
- [ ] verify: npx tsc --noEmit
