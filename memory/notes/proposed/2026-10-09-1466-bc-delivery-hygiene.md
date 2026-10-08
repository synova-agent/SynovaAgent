---
状态: proposed
日期: 2026-10-09
决策: 交付面卫生（卡 #1466 / 登记件 BC-CLEAN）——BC-3 认出已由 #1457 落地故零动作；BC-4 删 0 字节死壳；BC-7 以「零非客户功能件」为口径把 control-tower 从客户构建上下文 95 件收到 11 件 src/ 依赖闭包；BC-8 仓库/CI 面已满足、本机活工作区一律不删。
理由: ① 先量后动：四项现状逐条复跑，卡面「待做」与 main 实况不符者以实况为准（BC-3 已完成 17 分钟、BC-8 防再犯已存在）；② 判例 P-03 断言不变性检查发现卡面 V2 字面「零 control-tower」**必然失败**（src/ 有 4 处 load-bearing 引用），故按 BC-7 原文「非客户功能」重述判据并显式列出不可达差额（V-09）；③ 破坏性动作一律拒做：109 个 .synova-wt-* 全为活工作区（0 失效），清理他人工作区 = 事故；④ 判据载体做成可注入反例的探针（V-08 改坏即红），而非 grep 型静态断言（V-02）。
---

## 决策上下文

卡 #1466（模块 K10 · 第1批-补齐 · BC 清理族），出处院方《边界C》§3.4 BC-3/4/7/8，
登记件判据 `docs/synova/coordination/施工项登记.ts` :: **BC-CLEAN**
（acceptance = `bash scripts/control-tower/probe-delivery-hygiene.sh` expectExit 0）。

## 触发场景（四项实测，as_of `origin/main=5a6591c4a`，2026-10-09）

| 项 | 卡面口径 | 实测 | 处置 |
|---|---|---|---|
| BC-3 日期快照 | app/ 内 3 份快照 html（5,404 LOC 占 45%）「待移档案」 | 卡面命令**零命中**；3 件已由 **#1457 `9783411a3`**（2026-10-09T02:34，比本卡基线早 17 分钟）移出；复算 1660+1872+1872=**5404** LOC，5404/12045=**44.86%** | **零动作**（重做 = 二次误删风险）+ 落常驻判据 |
| BC-4 0 字节空件 | `diagnosis-upload-v2.ts` 0 字节 | 确认 0 B；溯源 `fdfc0799e`(D573) 49535 B → **`b54a0fb6a`(D590) 清空为 0 B 后从未删**；同型第二件 `tests/test-http-route.ts`；两件零代码引用 | `git rm` 两件 + 常驻判据防复发 |
| BC-7 控制塔进客户交付 | 「引入 Python 依赖且非客户功能」 | `Dockerfile:41 COPY scripts/ ./scripts/`；`.dockerignore` 未排除 ⇒ 95 件全量进镜像；基镜像 `node:22-alpine` **无 python3** ⇒ 40 个 `.py` 永不可执行 | `.dockerignore` 剥离 84 件，留 11 件 src/ 闭包 |
| BC-8 工作树残留 | 「本地实测 N 个」 | `.gitignore:90` 已有 `.synova-wt-*`；tracked 零命中；CI 零引用；**本机 live 136（`.synova-wt-*` 命名 109，0 失效）** | 仓库/CI 面已满足；本机**不删**（他线活动工作区） |

附带发现：`app/favicon.ico` = 5 字节字面量 `dummy`（`6475 6d6d 79`），零引用 ⇒ 占位符桩件出交付面。

## 不可达差额（判例 V-09，显式列出，不许写成已核）

BC-7 的字面判据「客户构建产物**零** control-tower」在**当前写集内不可达**：`src/` 对
`scripts/control-tower/` 有 4 处 load-bearing 引用 ——

- `src/l4/agent-memory-store.ts:20` — **静态 value import** `../../scripts/control-tower/enterprise-fact-store`
  （缺件 = 模块解析失败 = **启动崩**，不是降级）
- `src/deploy/bootstrap.ts:1125` — `await import('../../scripts/control-tower/conflict-scanner')`
  （cron 每日 04:00 企业事实冲突扫描；缺件 = 该 cron 降级）
- `src/agent/proactive-push.ts:192` / `src/agent/synova-agent.ts:106,127` / `src/l4/department-memory-store.ts:216`
  — `python3 scripts/control-tower/emit-signal.py`
- `src/routes/cockpit.ts:27` — `python3 generate-dashboard.py`（→ `views/*.py` + `founder-truth.py`）

达成「整目录归零」必须改上述 6 个 `src/` 文件（本卡写集外）= **架构变更 ⇒ 须 CTO 裁**。
本卡按 BC-7 原文口径落实为「交付面零【非客户功能】control-tower 件」，
并把闭包做成探针的**双向**断言（少一件 ⇒ 客户镜像断；多一件 ⇒ 交付面污染）。

## 风险与等价性边界

- 本机**无 docker 二进制**（`command -v docker` 空）⇒ V2 以 `.dockerignore` 语义子集
  （`*` `!` `**` `?` 尾斜杠目录 无斜杠按 basename、末次匹配胜、目录剪枝）模拟客户构建上下文，
  **真 `docker build` 未核**。失败爆炸半径：6 件 `views/*.py` 依赖「反选目录 ⇒ 可下探」语义，
  若该语义不成立最坏是 `generate-dashboard.py` 缺依赖 → 座舱 500 —— 而 alpine 无 python3 时
  它**本来就 500**；启动关键件（2 个 `.ts`）是直接子件、文件级反选，不依赖下探。
- `.dockerignore` 不在登记件 BC-CLEAN 的 `paths` 机器清单（`app/**`/`.gitignore`/探针）内，
  但属卡面 §写集「构建排除清单」；已在卡面【读卡确认】与交付件中显式声明为写集扩展。

## 参考系

判例库（`~/Synova-过程档案/2026-10-04-cto-判例库-各线自查用.md`）：
V-02（禁 grep 型验收）／V-08（改坏即红）／V-09（不可核项显式列出）／M-02（三态退出码）／
M-04（同一事实一处表达）／M-05（运行期产物不进版本控制）／P-01（派单方配方要核）／
**P-03（必然失败的断言 = 派单缺陷）**／S-01（真相源 `git show` + 数字前 `tr -d`）。
