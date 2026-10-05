# D962 task-25【3】as any 9 处 / DiagnosticModule 3 处 分类表（未分类前不推修复）

> 数据源：`git diff ef299746...HEAD | awk '/^\+\+\+ b\//{f=$2} /^\+/ && /as (any|never)\b|as unknown as/…'`（逐文件计数，原始输出见交付回报）。CI 报数 9/3 与本地 awk 7 行/5 行的差 = CI 的 M= 管道把多模式行重复计数（grep -E 逐模式）+ PR-body md 1 行；**逐处分类以 awk 语义（物理行）为准**，两口径差已注明。

## as any 家族（CI 计 9 = 物理行 7 × 部分行双模式）

| # | 文件:上下文 | 行内容摘要 | 分类 | 依据 |
|---|---|---|---|---|
| 1 | scripts/pre-commit-check.sh:283 注释 | `# 铁律38: as any / as never …（跳注释行）` | **C 注释字面量** | 首 token `#`，非代码 |
| 2 | scripts/pre-commit-check.sh:284 判定体 | `M=$(…grep -E 'as (any\|never)\b…'…)` | **C 门禁源码字面量** | grep 模式字符串本体（重写后新增行），非生产类型断言 |
| 3 | scripts/pre-commit-check.sh:285 | `soft_check "as any / as never …"` | **C 检查名输出串** | 同上 |
| 4-5 | tests/control-tower/hard-gate-convergence.test.sh ×2 | `'soft_check "as any…"'` KEEP_CI_HARD 断言串 + 行为A3 探针断言行 | **A 测试注入样例** | 判别性夹具本体——成对反例=行为A/A2/A3 探针（正样本被拦的证明）；显式豁免标记=文件路径 tests/（pathspec 排除）；输出可见=本表 |
| 6 | tests/control-tower/precommit-groups-injection.test.sh | `LBL_g1="as any / as never…"` | **A 测试注入样例** | V5.3 标签常量，驱动 g1 场景红确认；成对反例=RED_CONFIRMED 输出 |
| 7 | docs/synova/coordination/D962-PR803-body.md | 「1. as any 探针（CI strict）…」证据摘录 | **C 文档证据摘录** | .md 由原排除面覆盖（\.md 在原 grep -Ev） |

**结论：0 处 B 类（生产码真红）**。命中全部为 ①重写后门禁自身源码 ②判别性夹具 ③文档证据。

## DiagnosticModule（CI 计 3 = 物理行 5 × 排除后余 3）

| # | 文件:上下文 | 行内容摘要 | 分类 | 依据 |
|---|---|---|---|---|
| 1 | scripts/pre-commit-check.sh 头注释 | `#30 DiagnosticModule / #38 G10…` | **C 注释字面量** | 清单注释 |
| 2 | scripts/pre-commit-check.sh NEW_DIAG= | `grep "^+.*DiagnosticModule"` | **C 门禁源码字面量** | 判定体本体 |
| 3 | scripts/pre-commit-check.sh soft_check 行 | 检查名输出串 | **C** | 同上 |
| 4 | scripts/pre-commit-check.sh 段注释 | `# ── #30 禁止新 DiagnosticModule…` | **C** | 段标题 |
| 5 | tests/control-tower/precommit-groups-injection.test.sh | `LBL_g7="禁止 DiagnosticModule…"` | **A 测试注入样例** | g7 场景标签，反例=inj_g7 注入 "Diagnostic"+"Module" 拼接样本被 RED_CONFIRMED |

**结论：0 处 B 类**。

## pathspec 收窄的定性（按你①的要求）

收窄排除面 = `*.test.ts` / `*.d.ts`（as-any 段）与判定面限定 src/ packages/（DiagnosticModule 段）——**对齐 main 组1/组7a 的既有口径**（main L485-500 实测：`AS_ANY_DIFF` 本就限 src/ packages/ + exclude tests/d.ts；NEW_DIAG 在 main 亦属 src 语义检查）。即：不是新造豁免，而是**恢复 main 原有判定边界**；重写初版（GIT_CACHED_DIFF 全仓）反而比 main 扩了面，导致夹具自伤。
**A 类三要件**：显式豁免标记 = pathspec `:(exclude)**/*.test.ts`（机器可读非注释）；成对反例 = 双探针实测（注入 src 样例 ⇒ ❌ 拦 exit 1；见下）；输出可见 = 本表 + CI run。
**「无它则红」反例（样例放回扫描面 ⇒ 必红）**：SYNO_TEST_ARM=1 注入 `+export const bad = 1 as any;` → `❌ as any…零容忍（铁律38）: 1 处 [CI strict——软提示转硬]`；注入 `+export class Foo implements DiagnosticModule {}` → `❌ 禁止 DiagnosticModule…: 1 处 [CI strict]`（原始输出已留档 /tmp 会话记录）。
**生产码零排除**：src/** packages/** 内非 test/d.ts 文件不在排除面——B 类若出现必被拦。

## 处置
- A/C 类合计 12 物理行（CI 计 9+3）→ 按上表通道消化；pathspec 修复（工作树未提交）**持至本表获你确认后**随【5】rebase 一并提交。
