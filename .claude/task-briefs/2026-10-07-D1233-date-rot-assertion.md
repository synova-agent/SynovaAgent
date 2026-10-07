# Task Brief — 日期腐化：date-rot 断言不再写死日期（D1233 / 卡 #1302）

> **改号留痕（同族第 3、4 次碰撞，Lead 裁决）**：本件先取 **D1230**（用前三重核验）；line F 的
> **#1304 于 15:25:53Z 合入，比本件 PR #1305 早 25 秒** ⇒ 按「先合者留号」D1230 归 line F；
> 拟改 **D1232** 时 Lead 新立的 **#1309 已占 D1232** ⇒ 终取 **D1233**（Lead 核：main 零文件 + issue 标题零命中）。
> 处置：新分支 `fix/date-rot-d1233` + 新 PR（**不从 #1305 推回**，禁 force push）；3 载体 `git mv` **两轮**
> + **大小写全覆盖**替换（`[Dd]1230→[Dd]1233`，每轮 10 处，含**代码/夹具**内 2 处注释）。
> 根因＝「人肉分配全局标识 + 无仲裁」—— 正是 D-C（切 issue 号）最硬的论据。

> 卡 **#1302**（Lead 派单）· 编号 **D1233**（用前自查：gate 可用 / main 零文件 / issue 标题零命中）
> 从 `origin/main` 开新分支 `fix/date-rot-session-worktree` · 与括号类（#1301/#1288/D9204）**台账分开**

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理面（控制塔测试夹具）。**日期腐化类** = 断言写死某个历史日期，而被测系统按**当天**生成值
⇒ 断言随日期必然失败（与「变量吞全角括号」（#1288）是**不同类**：那类是语法崩溃掩盖失败，
这类是判据本身过期）。
### b) 文件审计（实跑）
- 失败点（verifier 定位，我已复现）：
  `tests/control-tower/session-worktree-isolation.test.sh:63`
  ```bash
  grep -q '2026-08-27' "$SB1/.claude/current-brief.D539" && ok "…" || no "参数优先: brief 名异常"
  ```
- **机制实跑验证**（本卡亲自跑过）：沙箱跑 `task-start.sh --session-id D539` 后，
  `.claude/current-brief.D539` 的内容 **= `2026-10-07-auto.md`**（**当天**日期；今天=2026-10-07），
  而断言 grep 的是 `2026-08-27` ⇒ **恒红**。实测 `rc=1`，`25 通过, 1 失败` ✓ 与 verifier 逐字一致。
### c) 决策
**不写死日期**：改为断言**形态**（`[0-9]{4}-[0-9]{2}-[0-9]{2}-<slug>.md`）**并加强**为
「能解析到沙箱里真实存在的 brief 文件」（比旧断言更强，且完全与运行日解耦）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **第一性原理**：断言应检验**契约**（这里是「写进 current-brief 的是最新 brief 的**文件名**」），
  而非某个**运行期快照值**。写死日期 = 把「当天的值」当成不变量 ⇒ 判据自带过期时间。
- **同类历史**（memory）：`check-manual-drift.sh` 因「文档硬编码数字 → 每次改代码都要改文档」被删除
  （v3.0 清理）—— 同型病根：**把可变值写进判据**。
- **反例（不做过头）**：`deriveValidFrom('2026-Q1') → '2026-01-01'` 这类**确定性映射**的硬编码日期
  是**合法**的（纯函数输入/期望值，与运行日无关）⇒ 本卡**不**去动它们（见 §同类扫描）。
参考：第一性原理（判据不含可变快照）+ 既有 drift 教训 ⇒ **形态 + 可解析** 双断言。

## Q2: 范围 — 正确的最简方案
做什么：
- tests/control-tower/session-worktree-isolation.test.sh
- .claude/task-briefs/2026-10-07-D1233-date-rot-assertion.md
- memory/notes/proposed/2026-10-07-d1233-date-rot-assertion.md
- task-state/D1233.json

改动内容（与上方清单对应）：
1. 测试文件：① 加 `_is_brief_name()` 形态判据（带 @input/@output 契约注释）
   ② `:63` 改为「形态合法 + 可解析到真实文件」两断言
   ③ §9 **判别性夹具**（4 条错形必被拒 + 1 条正对照必须被接受）
2. 本 brief（流程）；3. 决定 Note（铁律 49）；4. 认领台账。

> ⚠️ **路径必须「裸写、独立成行、零反引号、零尾随说明」**（本次实测教训）：
> `parse_q2` + `match_path` 按整行取模式 ⇒ 写成 `` - `path` — 说明 `` 会**匹配 0 个**暂存文件
> （**静默不认领**）。而 `resolve-commit-brief.sh` 在多 brief 同认领时取「认领数最多」、
> **同数**则按身份锚点→**字典序** ⇒ 存量 brief（`…-D1223-…`，其写集也含同一测试文件、
> 且用裸路径）会以 1:0 取胜 ⇒ commit-msg 判「D328 疑似并行劫持」**真阻断**（本卡实测被拦一次）。

不做什么（含文件路径）：
- **不改**任何「确定性映射」的硬编码日期（如 `tests/l3/period-utils.test.ts`、`tests/l4/graph-bridge.test.ts`
  的 `deriveValidFrom('2026-Q1') → '2026-01-01'`）—— 那些**不是腐化**，见 §同类扫描
- **不改** `scripts/workflow/task-start.sh`（被测系统行为本身正确：它就该写当天日期）
- **不混入**括号类（#1301 / #1288 / D9204）的任何改动
- 不改 `.github/workflows/ci.yml` / `scripts/pre-commit-check.sh` / `scripts/audit/**`

## 写集（含重命名撤出件 —— Lead ③ 要求）

| 文件 | 类型 |
|---|---|
| `tests/control-tower/session-worktree-isolation.test.sh` | task（形态判据 + 双断言 + §9 判别性 5 条） |
| `.claude/task-briefs/2026-10-07-D1233-date-rot-assertion.md` | brief |
| `memory/notes/proposed/2026-10-07-d1233-date-rot-assertion.md` | 决定 Note（铁律 49） |
| `task-state/D1233.json` | 台账 |
| `.claude/task-briefs/2026-10-07-D1230-date-rot-assertion.md` | task（**重命名撤出件**：首轮改号前路径，本分支内已撤出；origin/main 从未存在） |
| `memory/notes/proposed/2026-10-07-d1230-date-rot-assertion.md` | task（**重命名撤出件**：同上） |
| `task-state/D1230.json` | task（**重命名撤出件**：同上） |
| `.claude/task-briefs/2026-10-07-D1232-date-rot-assertion.md` | task（**重命名撤出件**：中间号，二次改号后撤出） |
| `task-state/D1232.json` | task（**重命名撤出件**：同上） |

> 撤出件只作**声明留痕**，**不**写进 Q2 的 include 清单（那会撞 Q2「路径可解析」检查——旧路径在本分支不存在）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/session-worktree-isolation.test.sh`
处理：沙箱按当天生成 brief 名 → 形态判据 + 可解析断言（与日期无关）
结果：`rc=1 → 0`；`25 通过 1 失败 → 32 通过 0 失败`；错形必被拒（判别性夹具）。

## 架构层: 治理面（tests/control-tower）
#CRITERIA: D

## 同类扫描（卡 #1302 ② 要求：先报不改）
```bash
# 口径 1（原始：一切硬编码 YYYY-MM-DD 字面量）—— 宽，含大量合法用例
git grep -nE "'20[0-9]{2}-[0-9]{2}-[0-9]{2}'" origin/main -- tests/
#   实测: 26 个文件 / 59 行（main 实况）
# 口径 2（**腐化形状**：硬编码日期出现在**匹配位**——grep/toContain/=~ 去匹配一个生成物）
git grep -nE "(grep +(-[a-zA-Z]+ +)*'20[0-9]{2}-[0-9]{2}-[0-9]{2}'|toContain\('20[0-9]{2}-[0-9]{2}-[0-9]{2}'\)|=~ *'20[0-9]{2}-[0-9]{2}-[0-9]{2}')" origin/main -- tests/
#   实测: **恰好 1 条** —— 就是本卡修的那一行（session-worktree-isolation.test.sh:63）
```
**结论（口径 2 是关键）**：该类**没有第二例**。口径 1 的其余命中是**确定性用例**，非腐化 ——
我抽验 2 个高风险候选确认：
- `tests/l4/graph-bridge.test.ts:243` `expect(deriveValidFrom('2026-Q1')).toBe('2026-01-01')` ⇒ 纯函数映射，合法（同文件 `Date.now()` 只用于随机 ID）
- `tests/growth/goal-lifecycle.test.ts:18` `deadline: '2026-12-31'` ⇒ 夹具**输入**值，合法（`createdAt` 的 `new Date()` 是无关观测字段）

⇒ **不扩大改动面**；若日后要机械化，判据应是「硬编码日期是否出现在**匹配位**」而非「是否出现日期」。

## Done 标准
- [ ] verify: `bash tests/control-tower/session-worktree-isolation.test.sh` ⇒ rc=0 且 `32 通过, 0 失败`（改前 rc=1 / 25·1）
- [ ] verify: 该文件内**不再有「硬编码日期当匹配器」的断言**（不是「字面量计数=0」——那是坏判据）：
      `grep -cE "grep +-[a-zA-Z]* *'20[0-9]{2}-[0-9]{2}-[0-9]{2}'" <本文件>` ⇒ **0**
      （⚠️ 字面量 `2026-08-27` 仍出现 **3 处**且**应当保留**：1 处历史注释 + 2 处 §9
      **负向夹具输入**（喂旧写死值形态 ⇒ 必须被拒）。把判据写成「字面量计数=0」会
      反而**禁止掉证明判别性的那个输入** —— 本卡自己踩过这个坏判据，已更正。）
- [ ] verify: 判别性 —— 把 `_is_brief_name` 放宽为 `^[0-9]+-[0-9]+-[0-9]+` ⇒ 夹具 3 条转红、测试 rc=1（已实证）
- [ ] verify: `bash scripts/pre-commit-check.sh` ⇒ 13 组通过
