# Task Brief: D1170 govl-1165-postmerge-corrections

> 生成: 2026-10-06 | 任务: D1170 | 认领: 治理线(deepseek-flash)
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）
> 坐标系: 执行态=已交付 ｜ 施工批次=第0批-止血 ｜ 服务承重件=不适用 ｜ 总闸=不适用
>          命名空间=不适用 ｜ 验证级别=L2-真跑通 ｜ 阻塞源=无阻塞
> 派单源: **独立复核的追账**（判例 S-07：检出自己错时必须回写受影响的所有载体）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理/门禁层。**本卡不是新功能，是对我自己已合入 #1165 的三处缺陷的追账**。
### b) 文件审计（复核给的证据 → 我在 main 上逐条复核）
- `.github/workflows/ci.yml:198` → `timeout-minutes: 15`（我在 #1165 里改的；**无判据支撑**）
- `tests/control-tower/post-commit.test.sh:352` → `git log --format=%H -1 -S'D1157-REC-RE'`（取**最新**改动计数的提交）
- `tests/electron/backend-spawn.test.ts:118` → 注释写「**单点且不漏**」（过强声明）
- `.claude/task-briefs/2026-10-06-D1164-*.md` → `:50` 列 ci.yml 为「做什么」、`:59` 又列进「不做什么」（**自相矛盾**）
- PR #1165 正文「未夹带」段第 1 条明写「不改 .github/workflows/ci.yml」——**与 diff 不符**
### c) 决策
三条代码修正 + 两处载体回写（brief 自相矛盾 / PR 正文更正），**全部只改判据与说明，不改产品行为**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 判例 **S-07**（撤回没有奖励，所以靠纪律不靠动机：检出自己错时**必须回写所有受影响载体**）
- 判例 **S-02**（一切"现状"必须带 as_of）⇒ 我写的 `MERGED-BY @ 17:30` **晚于实际合并 17:03:32**，是假时间戳
- 判例 **P-03**（断言不变性）、**M-04**（同一事实只许一处表达）、**V-09**（未核写未核）
- 复核给出的**判据级证据**（我逐条在 main 上复现）：
  · `timeout 8→15` 那个 commit（`76abd97da`）**只改了这一行**，run `37426081446` 仍 `cancelled` 且时长 **15m15s**
  · 真修复（W1e）后同 job `success` **1m46s–2m44s** ⇒ **8 分钟绰绰有余**
  ⇒ 「加超时」被**证伪**；保留 15 的唯一效果 = 未来每次挂死多烧 7 分钟（2 个 shard 各一次）
- 决策参考：**第一性原理**（一条无效果的改动留着只会增加成本）+ **Anthropic 工程基线**（判据必须能证伪自己）⇒ 结论 = 回退 + 修耦合 + 收回过强声明。

## Q2: 范围 — 正确的最简方案
做什么：
- .github/workflows/ci.yml — `timeout-minutes` 15 → **8**（回基线）+ 注释按复核证据重写
- tests/control-tower/post-commit.test.sh — `git log` 加 **`--reverse`**（取最初引入，免受后续注释编辑重定位）
- tests/electron/backend-spawn.test.ts — 收回"单点且不漏"；改**进程组回收**（与产品契约 `backend-spawn.cjs:106` 一致）
- .claude/task-briefs/2026-10-06-D1164-govl-w-group-g0-unblock.md — 删自相矛盾（`:59` 那条排除项措辞已收窄为"仅 W2/W3/W5/W9 部分"）
- memory/notes/proposed/2026-10-06-d1170-*.md + task-state/D1170.json
不做什么：
- 不改 src/services/email-service.ts（复核已确认类型改动等价、运行时零差异）
- 不改 package.json / package-lock.json（复核确认 W1 修复成立）
- 不改 docs/synova/coordination/DSH-断面.json（复核确认补登记成立）
- 不改 scripts/control-tower/scan-fullwidth-vars.sh
- 不碰 scripts/audit/check-audit-consistency.sh（K3 红线）
- 不改 .github/workflows/ci.yml 里任何既有 job 的 `name:`
- 不改 scripts/control-tower/check-pr-budget.sh（阈值归 #1017）

## Q3: 验收 — 入口 → 交互 → 结果
入口：CI 安装/测试 job；夹具调用
处理：超时回基线；夹具基线定位去耦合；兜底回收对齐产品契约
结果：
- `grep -c "timeout-minutes: 15" .github/workflows/ci.yml` ⇒ **0**
- `bash tests/control-tower/post-commit.test.sh` ⇒ `结果: 33 通过, 0 失败`
- `npx vitest run tests/electron/backend-spawn.test.ts` ⇒ `17 passed` 且**进程自行退出**
- `git log --reverse -S…` 与 `git log -S…` 现取同一提交；且**后续注释编辑不再重定位**（结构性差异）

## 架构层:
scripts（控制塔）+ `.github/workflows/`（非产品五层）

## Done 标准
- [ ] verify: `grep -c "timeout-minutes: 15" .github/workflows/ci.yml` ⇒ 0
- [ ] verify: `bash tests/control-tower/post-commit.test.sh` ⇒ 含 `33 通过, 0 失败`
- [ ] verify: `grep -c -- "--reverse" tests/control-tower/post-commit.test.sh` ⇒ ≥2
- [ ] verify: `grep -c "单点且不漏" tests/electron/backend-spawn.test.ts` ⇒ 0
- [ ] verify: `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'` ⇒ exit 0
