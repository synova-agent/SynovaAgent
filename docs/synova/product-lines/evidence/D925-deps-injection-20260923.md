# D925 证据 — deps 接口 / setter 注入立为标准 + 检查器（首版只报不拦）

> 卡号: D925 | 分支: `feat/d925-deps-interface` | 工作树: `.synova-wt-d925` | 域: mac
> **base**: `feat/d924-subprocess-protocol`（栈式，已声明；技术理由见 brief Q0）
> 测量时刻: **截至 2026-09-23T19:11:06+0800**（= CI 全部 check-run settle 时刻；各处另注自身时点） | 标准: [标准-deps接口与setter注入-20260923.md](../../coordination/标准-deps接口与setter注入-20260923.md)
> 修订: 2026-09-23 自验退回项修复（F-1 闭集排除理由改实测口径 / F-2 夹具恒真断言改实跑 / F-3 本时刻占位补精确值）

---

## §1 声称 ↔ 证据（逐条）

| # | 声称 | 命令 | 原始输出摘要 |
|---|------|------|-------------|
| S1 | 检查器语法合法 | `bash -n scripts/control-tower/check-deps-injection.sh` | `exit=0` |
| S2 | 夹具 27/27 全绿 | `bash tests/control-tower/check-deps-injection.test.sh` | `D925-FIXTURE: PASS(27/27)` `exit=0` |
| S3 | 全扫盘点：存量被 baseline 吸收 | `bash …/check-deps-injection.sh --dir .` | `OK (files=449, hits=0, exempted=2, baseline=2, exempt=0)` `exit=0` |
| S4 | **空 baseline 暴露原始命中 = 恰为冻结预测的 2 文件** | `--dir . --baseline <空>` | `HIT src/l3/expert-dispatcher.ts:307 R1` + `HIT src/sentinel/runner.ts:697 R1` → `REPORT(2)` `exit=0` |
| S5 | `--strict` 翻转 exit 1 | 同 S4 + `--strict` | `exit=1` |
| S6 | 只判新增（diff 模式） | `--base origin/main --head HEAD` | `mode=diff files=0` → `OK` `exit=0` |
| S7 | 技能双目录一致 | `bash scripts/workflow/sync-dsh-skills.sh --check` | `SYNC-OK: 技能一致（… 16 个技能）` `exit=0` |
| S8 | 夹具**已登记** CI（第 44 条） | `grep -n 'check-deps-injection.test.sh' .github/workflows/ci.yml` | `268:            tests/control-tower/check-deps-injection.test.sh; do`；清单条数 `44` |
| S9 | 新 .sh 有 UTF-8 头块 | `check-silent-swallow.sh --utf8 <两文件>` | 两条 `✅ 带头块` `exit=0` |
| S10 | 裁定 5：**5 组** setXxxDeps | `grep -nE 'set[A-Za-z]+Deps' src/agent/loop-handlers.ts` | `:105/:294/:444/:560/:617` = **5 组**（文档一律写 5） |
| S11 | 本卡不触产品代码 | `git diff --cached --name-only \| grep -c '^src/'` | `0` |
| **S13** | **闭集排除 `getDatabase` 的理由（实测口径）** — 纳入后**新增命中 = 0** | 变异体（把 `getDatabase` 并入 `SINGLETON_GETTERS_RE`）+ 空 baseline 全扫：`bash <变异体> --dir . --baseline <空>` | 正规判据 `HIT` ×2；变异体 `HIT` ×**2**（同 `expert-dispatcher.ts:307` / `runner.ts:697`）⇒ **新增 0**。另：真实 `loop-handlers.ts` 复制进沙箱单跑 → 正规 `hits=0`、变异体亦 `hits=0`（该文件导出 **5 条**缝 ⇒ R1 条件③不成立，天然免疫） |
| **S14** | **夹具用例 11 为实跑断言（非恒真）** | `sed -n '148,156p' tests/control-tower/check-deps-injection.test.sh` | 真检查器与坏校验体**两次独立调用**，`REAL_RC`/`MUT_RC` 分别对常量 1/0 断言；实测输出 `真检查器…(=1)` + `坏理由校验体…(=0)` |
| S12 | 判据与闭集均为**具名单一常量** | `grep -n '^SINGLETON_GETTERS_RE=\|^ENTRY_FN_RE=\|^SEAM_RE=\|^SEAM_SIG_RE=' …check-deps-injection.sh` | 4 条具名常量，各带命令 + 命中数注释 |

---

## §2 验收链原始输出

```
$ bash -n scripts/control-tower/check-deps-injection.sh
exit=0

$ bash scripts/workflow/check-silent-swallow.sh --utf8   （全量）
exit=1（存量 16 处缺头块，非本卡引入；pre-commit 只跑 --diff，见遗留 L2）
$ bash scripts/workflow/check-silent-swallow.sh --utf8 scripts/control-tower/check-deps-injection.sh
[utf8] ✅ scripts/control-tower/check-deps-injection.sh 带头块     exit=0
$ bash scripts/workflow/check-silent-swallow.sh --utf8 tests/control-tower/check-deps-injection.test.sh
[utf8] ✅ tests/control-tower/check-deps-injection.test.sh 带头块  exit=0

$ bash tests/control-tower/check-deps-injection.test.sh
… （27 条断言逐条 PASS，全文见夹具输出）
D925-FIXTURE: PASS(27/27)
exit=0

$ bash scripts/control-tower/check-deps-injection.sh --base origin/main --head HEAD
[deps-injection] mode=diff files=0 baseline=2 exempt=0 skipped_test=0
DEPS-INJECTION: OK (files=0, hits=0, exempted=0, baseline=2, exempt=0)
exit=0

$ bash scripts/workflow/sync-dsh-skills.sh --check
SYNC-OK: 技能一致（源 …/.claude/skills → 目标 …/.dsh/skills, 16 个技能）
exit=0
```

### 空 baseline 下的原始命中（判据判别力实证）

```
$ bash scripts/control-tower/check-deps-injection.sh --dir . --baseline <空文件>
[deps-injection] mode=full files=449 baseline=0 exempt=0 skipped_test=0
HIT  src/l3/expert-dispatcher.ts:307  R1  编排入口直连生产单例且无 setXxxDeps 注入缝
HIT  src/sentinel/runner.ts:697  R1  编排入口直连生产单例且无 setXxxDeps 注入缝
::warning file=src/l3/expert-dispatcher.ts,line=307::DEPS-INJECTION R1 …
::warning file=src/sentinel/runner.ts,line=697::DEPS-INJECTION R1 …
DEPS-INJECTION: REPORT(2) — 首版只报不拦（--strict 才 exit 1）
exit=0
```
与判据冻结时预测的 2 文件**逐位吻合**（含真实行号）；`--strict` → `exit=1`。

---

## §3 夹具覆盖矩阵（27 断言，对应队长裁定 3 逐条）

| 用例 | 断言 | 对应裁定 |
|------|------|---------|
| 1 正常路径 | 合规模块（含注入缝）→ `exit 0` 且**零 ::warning** | 三路径·正常 |
| 2 反例 R1 | report 仍 `exit 0` 但**必须打印 `::warning file=…,line=…`**；`--strict` → `exit 1` | **裁定 3c**（告警必须可见） |
| 3 反例 R2 | 签名缺 `\| null` → 命中 R2 | 三路径·反例 |
| 4 降级 | `SYNO_DEPS_GREP` 不可用 → `exit 2` + stderr `degraded:` + 码 `DEPS_SCAN_UNAVAILABLE` | 三路径·降级 |
| 5 降级 | `--dir` 无 `src/` → exit 2；坏 base ref → exit 2 | 边界 |
| 6 降级 | 显式 `--baseline` 不存在 → `exit 2` + 码 `DEPS_BASELINE_UNREADABLE` | fail-closed |
| 7 豁免 fail-closed | exempt **文件缺失** → 0 条豁免（违规仍报） | **裁定 3d①** |
| 8 豁免 fail-closed | exempt 行**无理由** → 不生效（违规仍报） | **裁定 3d②** |
| 9 豁免生效 | exempt 行**带理由** → 吸收，`exit 0` 且零 warning | 裁定 5（显式豁免缝） |
| 10 变异体① | 改坏 R1 主判据 → 同一反例**必须漏判** | 判别性 |
| 11 变异体② | 改坏 exempt 理由校验 → 无理由豁免**被错误吸收**（证明理由校验承重） | 判别性 |
| 12 **diff 模式** | 只报新增 `new.ts`；未改动的存量 `old.ts` **不报** | **裁定 3 末条**（两模式） |
| 13 **自我豁免** | 检查器源码副本放进 `src/` → **0 命中**（防自吞） | **裁定 3b** |

> 说明：`skipped_test=0` 是**实测事实**——`find src -name '*.test.ts' -o -name '*.test.tsx' | wc -l` → **0 个**
> （本项目测试位于 `tests/`，不在 `src/` 下）。EX-A 测试面排除**今日为 no-op 但保留**，以防未来 `src/` 内出现测试文件。

---

## §4 M6-1 `git diff --stat` 原始输出

```
$ git diff --cached --stat
 .claude/skills/dev-doc-spec/SKILL.md               |   5 +
 .dsh/skills/dev-doc-spec/SKILL.md                  |   5 +
 .github/workflows/ci.yml                           |   3 +-
 .../标准-deps接口与setter注入-20260923.md          | 176 ++++++++++++++++
 scripts/control-tower/check-deps-injection.sh      | 226 +++++++++++++++++++++
 scripts/control-tower/deps-injection-baseline.txt  |  19 ++
 scripts/control-tower/deps-injection-exempt.txt    |  16 ++
 tests/control-tower/check-deps-injection.test.sh   | 175 ++++++++++++++++
 8 files changed, 624 insertions(+), 1 deletion(-)

$ git diff --cached --numstat
5	0	.claude/skills/dev-doc-spec/SKILL.md
5	0	.dsh/skills/dev-doc-spec/SKILL.md
2	1	.github/workflows/ci.yml
176	0	docs/synova/coordination/标准-deps接口与setter注入-20260923.md
226	0	scripts/control-tower/check-deps-injection.sh
19	0	scripts/control-tower/deps-injection-baseline.txt
16	0	scripts/control-tower/deps-injection-exempt.txt
175	0	tests/control-tower/check-deps-injection.test.sh
```

口径：**交付物 8 件**（D860 计件）；治理件（brief / Note / 本证据）不计入，三项另见提交。
机器计件以 `check-pr-budget.sh` 为准（见 §5）。

---

## §5 M6-2 自验结论

**可提请独立审计。**

依据：S1–S12 均有命令 + 原始输出；三路径（正常/降级/反例）与**两模式**均有夹具断言；
变异体判别证明判据承重；豁免 fail-closed 两半（缺文件 / 缺理由）均被断言；降级 exit 2 显式。
**本结论不代表"通过"** —— 通过与否归 CTO 收件闸 + K3 终审。

---

## §6 M6-3 遗留清单

| # | 事项 | 处置建议 |
|---|------|---------|
| L1 | **R1 为文件级判定** ⇒ 抓不到"有注入缝文件内部"的直连（典型：`src/agent/loop-handlers.ts:374 defaultEvolutionHandler` → `:377 getFeedbackCollector()`）。该文件已有 5 条缝，故整文件放行 | **已知边界**，标准文档 §6-F1 登记「文件级 → 函数级」的收紧触发条件（出现第一例实际漏拦即收紧）。**刻意不在夹具里断言其存在**（不把缺陷固化成契约）。本卡不改 `src/**`（CTO 裁定 5） |
| L2 | `check-silent-swallow.sh --utf8` 全量 **16 个 .sh 缺 UTF-8 头块**（存量，非本卡引入） | 已有独立立项；pre-commit 只跑 `--diff`，不阻断 CI |
| L3 | **`packages/**` 未纳入扫描范围** | **显式范围决定，非遗漏**；标准文档 §6-F2 登记纳入触发条件 |
| L4 | 闭集**排除 `getDatabase`/`getDb`** —— **纳入后全仓新增命中实测 = 0**（正规判据 `HIT ×2`，并入后仍 `HIT ×2`；见标准 **§3** 与本文 **S13**）；**真实理由是语义范围**（本标准对象是 **5 个编排单例**的活单例耦合；DB 有既成合规 fallback 写法 `loop-handlers.ts:471`，属**另一关注点**）。原始面 **34 = "含该调用的文件数"口径，非噪声量**。 | 标准文档 §6-F3：若日后要求 DB 也走注入 → 扩闭集 + 一次性补 baseline |
| L5 | 入口函数命名清单（`*Handler/*Runner/*Coordinator/*Dispatcher`）可能漏新命名 | 标准文档 §6-F4：出现第一例新命名入口直连 → 扩 `ENTRY_FN_RE` + 补夹具 |
| L6 | **逐条对齐**：`sync-dsh-skills.sh` 输出「16 个技能已同步」，但 `git status` 显示**仅 dev-doc-spec 两文件变化** | 已实读核验（其余 15 个技能内容本就一致，sync 幂等）；无需动作 |
| L7 | **基线存量 2 条尚未改造**（`expert-dispatcher.ts` / `runner.ts` 补注入缝） | 属后续卡；baseline 只可缩短——补缝后删行。**翻转 `--strict` 进 CI 的门槛**见标准文档 §6-F5（baseline 归零 + 连续 N≥5 PR 零新增） |
| L8 | 交付时 `git ls-remote --heads origin \| grep d925` 回执**随交付报告附上** | 见交付报告 |

---

## §7 自检 5 问（铁律）

1. **接线检查**：新脚本谁调用？
   `grep -n 'check-deps-injection.test.sh' .github/workflows/ci.yml` → **:268**（CI `control-tower-tests` 清单，共 44 条）；
   夹具用例 1–13 真实调用检查器；检查器由人/CI 直接执行。
2. **异常处理**：每个 catch/降级有 log + degraded？
   检查器无 `catch`；降级统一走 `degrade()` → stderr `degraded:` + `<扫描根>/.codex/.../degraded-events.log` + **exit 2**（夹具用例 4/5/6 断言）。
   刻意**不用管道子 shell**（`record` 需累计计数）；无空吞分支。
3. **类型安全**：`as any` = 0？
   本卡产物为 `.sh` / `.md`，无 TS 代码；`git diff --cached --name-only | grep -c '^src/'` = **0**（不触产品代码）。
4. **测试质量**：有断言且覆盖正常/降级/边界？
   **27 条断言**覆盖：正常（1）、反例（2/2b/3）、降级×3（4/5/6）、豁免 fail-closed 两半（7/8）、豁免生效（9）、
   变异体判别（10/11）、**两模式**（full 1–11 / diff 12）、**自我豁免**（13）。
5. **残留清理**：有死代码/旧引用残留？
   实现过程中**发现并已删除**一版 R2 早期实现的死代码（管道子 shell + 未回收的 `HITS_TMP.rm2` 临时文件）；
   当前脚本无未使用变量/分支。仓库内 `grep -rc INJECTED-RED` = 0（夹具未写该字面量）。
