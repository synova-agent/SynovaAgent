---
状态: proposed
日期: 2026-10-07
决策: CI 判据文本（docs-only 早退白名单正则）从 ci.yml 9 处内联副本收敛为单一真值源 `.github/ci-criteria.txt`；Vitest 默认改 `--changed`（影响面），全量由 schedule/人工兜底
理由: ① 同一判据多副本 = 判据漂移温床（改一处漏一处 ⇒ 某 job 悄悄全量/悄悄早退，两侧都不可见）；② 影响面优先 + 主干全量是业界基线，创始人 2026-10-07 已批方案七⑥；两项均不改变「哪条检查阻断合并」
---

# D1204 — CI 判据单源化（D-F/①）+ Vitest `--changed` 默认（D-E 余项）

- 状态: proposed（2026-10-07，治理线 B）
- 卡: #1227（D-F）· #1226（D-E）· 父卡 #1221（门禁减法与提速 v2.0）
- 关联脚本: `.github/ci-criteria.txt`（新建，唯一真值源）·
  `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh`（守卫同步改「单源派生」）

## 一、判据单源化（行为零变更的重构）

**旧口径**: docs-only 白名单正则在 `.github/workflows/ci.yml` **内联 9 份**（D1111/A5 时代刻意保留的
「同源多副本 + 夹具判别」），防线 = D1023 守卫断言「副本数 = 9 且唯一模式 = 1」。

**新口径**: 正则文本**只有一份** = `.github/ci-criteria.txt` 的 `DOCSONLY_WHITELIST_RE=` 键；
ci.yml 的 9 个 `Detect docs-only change (D515)` step 只**消费**（`grep -m1` 读键 → `grep -qvE "$DS_RE"`）。
守卫改判：单源键恰 1 行 ∧ ci.yml 内联副本 = 0 ∧ 单引号内联形态 = 0 ∧ 消费点 = 9 ∧ detect step = 9
∧ fail-safe 计数 = 9 ∧ 14 条行为用例（含 `.gitattributes`/`.gitmodules` 边界、锚点边界、`.html` 纳入）。

**降级方向**: 读不到键 ⇒ 各 detect step **显式**置 `docs_only=false`（**全量**）＋ `::warning` 留痕 ⇒ 绝不误跳。
🔴 **R1 更正（独立复核 verifier 2026-10-07，P1 真缺陷，我方与 K3 均未发现）**: 初版实现把「空 `DS_RE`」
  的期望方向写成了「`grep -qvE ''` 返 0 ⇒ false」，**事实相反** —— 实测 `printf x | grep -qvE ''` 返 **1**
  （空正则匹配每行，`-v` 反选后无输出），且该读取代码被**误放进 `if` 块内**（正常路径 `DS_RE` 从未赋值）
  ⇒ 真实行为是 `docs_only=true`（早退）= **fail-OPEN**（重活 step 全被 skip，只是被 D1023 守卫 step
  无 `if:` 恒跑兜住才没假绿）。修法: ① 单源读取移出 `if`；② 空值/不可解析一律**显式** false（不依赖
  grep 隐式语义）；③ 9 处 warning 文案改为与实况同向；④ 守卫新增 4 条**控制流真执行**断言
  （抽 ci.yml 真 step 正文在合成 git 仓跑），其中 `ctrl-empty-single-source-full` 正是本缺陷的判别器
  （用旧形态 ci.yml 复跑 ⇒ 该断言转红）。教训: **别把 grep 的隐式退出码当控制流判据写进注释与文档**，
  期望值必须由真执行夹具钉住。

**顺带修正的验收命令缺陷**: 原验收写法 `grep -c 'docs/.+\.(md|json|html)' ci.yml` 在 BRE 下对
含转义的原文**恒 0 命中**（纸老虎，改前改后都返 0）。真判据 = `grep -cF 'docs/.+\.(md|json|html)' ci.yml` = 0。

**回滚**: 单文件回滚（revert 本 PR）即恢复 9 处内联；无数据/状态迁移，无向后兼容问题。

## 二、Vitest 默认 `--changed` + 全量兜底

**旧口径**: `test` job 每次跑**全量** `npx vitest run --shard=N/2`（PR 与 nightly 同）。
**新口径**: PR/push ⇒ `npx vitest run --changed <merge-base> --passWithNoTests --shard=N/2`；
`schedule` / `workflow_dispatch` ⇒ 全量（同一步内门控，job `name:` 与 job 级 `if:` 不动 ⇒
`Vitest (1/2)`/`(2/2)` 两个必需 context 的产出机制零变更）。

**关键实现事实**（vitest 5.0.2 源码，非推断）:
- `--changed [since]` 的选择口径 = `git diff --name-only <since>...HEAD`（与 D721 三点差同轴）；
- `--passWithNoTests` **必需**：changed 模式选中 0 个测试是合法结果，否则 shard 校验处
  `--shard <count> must be a smaller than count of test files` 会直接抛错 ⇒ 必需 context 假红；
- 降级：`BASE` 不可解析 ⇒ 全量；非 PR 事件（schedule/dispatch）⇒ 全量。

**代价（如实登记）**: PR 期不再每次全量 ⇒ 未被影响面的回归最迟在 **nightly（现有 schedule，周日夜）** 曝光；
「nightly」按 D1195 同批既有语义 = 复用现有 `schedule` 触发（本卡不新增/不改 cron 频率）。

## 三、退出条件 / 复活条件

1. 若 `--changed` 在真实 src 变更 PR 上出现「选择集错误」（漏跑受影响测试 ⇒ 回归逃逸）连续 2 次
   ⇒ 关掉默认 changed（改回全量），保留 nightly 全量。
2. 若单源文件被证明会被「顺手放宽」（例如有人把 `.gitattributes` 加进白名单）
   ⇒ 守卫 14 条行为用例 + 内联副本=0 断言即为红线，不需新增机制。
3. 若需真·每日夜间全量（现为周日夜）⇒ 另开卡改 `schedule` cron（属调度频率变更，不在本卡范围）。
