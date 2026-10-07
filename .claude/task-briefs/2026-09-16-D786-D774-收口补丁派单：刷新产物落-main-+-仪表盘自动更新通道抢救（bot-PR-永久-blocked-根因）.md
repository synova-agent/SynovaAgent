# Task Brief: D786 D774 收口补丁派单：刷新产物落 main + 仪表盘自动更新通道抢救（bot PR 永久 blocked 根因）

> 生成: 2026-09-16 | 分支: docs/d786-t1a-evidence → docs/d786-t1b-artifacts → docs/d786-t2-channel-watchdog | as any: 0
> 域: mac（单域：scripts/product-lines/** + docs/synova/product-lines/** + .github/workflows/**（T2 红区，理由见 Q2））
> 主线贡献: infra:仪表盘真假（产品可见性 + 进度产物自动刷新通道 + 产物过期看门狗）
> 依据: 派单 docs/synova/coordination/派单-D774-收口补丁与仪表盘通道抢救-20260915.md（PR #584）· 计划 v1.3@eef38a85

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
治理层 + 产品可见性层：`docs/synova/product-lines/product-progress.json` 是 26 线进度页与看板的真相源产物，由 `scripts/product-lines/calc-progress.py` 计算、`refresh-all.sh` 刷新。本任务 = ① 把刷新后的真相落进 main（D774 缺口）；② 修「自动刷新」早已断掉的链（bot PR 永久 blocked）；③ 建产物过期看门狗（断链不再无人知晓）。

### b) 文件审计（全部本单实测，2026-09-16）
- main 产物过期：`git show origin/main:…/product-progress.json` → `generated_at 2026-09-12 23:41:24 | pct 1`；派单 F1 六态 `stale 29 / pending_k3 34`
- 幂等基线：origin/main 已跟踪 `rerun-evidence-summary-2026-09-15.json`（`before==after: stale=27 pending_k3=36`，fresh=8/fail=3/skip=2）——刷新后目标态与之一致
- #404（auto/product-progress）：实测 head `6395b014` → check-runs `total_count: 0` / statuses `total_count: 0`（永久 blocked；本单前置已关闭）
- 分支保护（实测）：12 个必需检查（Architecture Check / Checker Review / Control Tower Gate ×2 / Golden Case F1 / Integration Contract / Test-Kit ×2 / TS+Lint+Iron Laws / Vitest ×2 / npm audit）
- 根因落点：`.github/workflows/dashboard-auto.yml` 与 `product-progress.yml` 的「产物有变化则提交 bot 分支并开 PR」步骤用 `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` 执行 `gh pr create` → GITHUB_TOKEN 触发的事件不再触发任何 workflow → 必需检查永不报告
- 通道文档现状：`docs/synova/coordination/CI-诊断通道.md` 已有 D521 版（无 token 读 CI 失败；初判「不存在」有误，实测更正）→ T2 追加 PART B（仪表盘自动更新链路）
- 看门狗缺口：grep `generated_at` scripts/product-lines/ → 仅生成器写入，无任何消费者做过期告警（实测）

### c) 决策
复用 D774 已交付的流水线（rerun-evidence.sh / refresh-all.sh / gen-expiry-warnings.py）跑产物；T2 通道选 **(b) workflow 只产分支 + CTO session 显式合并**（理由见 Q1 决策参考系）；看门狗新建 `check-progress-freshness.py` + 每日 CI job。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 派单验收五条（T1 产物落 main 当天日期 + 六态 27/36；T1 反向失败不计 verified；T2 check-runs 非零或 (b) 文档化；看门狗触发/恢复；红线零提交）。
② 测试等价物 = 看门狗密封测试 `tests/control-tower/check-progress-freshness.test.sh`（三路径，铁律 48，入 CI canary）+ 流水线自身 exit 1 显式失败形态（F3 已验）。
③ 实现 = 见 Q2 写集。
④ 接线 = 产物落 main 后看板/进度页消费端自动反映（链路已存在）；看门狗接 `.github/workflows/progress-freshness-watchdog.yml` schedule。
⑤ 验证 = 逐条贴原始输出（派单§四）。

### b) 铁律与教训引用
- 铁律 35（自动化优先：看门狗从「没人发现」变 CI 红灯）· 铁律 47/48（新脚本契约头 + 三路径测试）
- M4（执行证据链断裂：产物没进 main = 成果换了个人就看不见）· M2（声称 vs 事实：「自动刷新在跑」被实测推翻）
- D334（PR 工作流：合并走 PR）· D570 复盘（「合并 PR 是 CTO 的工作」→ 方案 (b) 与既有裁决天然一致）
- 铁律 0-5（审计红线：不碰 scripts/audit/**、不写 k3 证据）

### c) 决策参考系
参考：第一性原理（GitHub 物理设计：GITHUB_TOKEN 触发的事件不递归触发 workflow——bot PR 拿不到必需检查是平台行为，不是配置错误；PR 必须由真实凭据创建）+ Anthropic 基线（fail-visible：静默断链 → 显式红灯）+ 开源实证（GitHub 官方文档 "Triggering a workflow from a workflow"：GITHUB_TOKEN 事件除 workflow_dispatch/repository_dispatch 外不触发新 run）→ **结论选 (b)**：workflow 只产分支，CTO session 用 PAT 显式开 PR（真实凭据 → 12 检查正常报告 → CI 全绿 → API 合并）；(a)（PAT/GitHub App 入 repo secret）列为升级路径，需创始人创建最小权限 fine-grained PAT——把个人宽权 PAT 单方面写入 repo secret 属安全 posture 变更，CTO 不自决。

## Q2: 范围 — 正确的最简方案

做什么（T1｜产物落盘——机器生成，拆 PR-A 证据 / PR-B 产物两单以满足 ≤12 文件预算）：
- docs/synova/product-lines/product-progress.json — 刷新后（rerun-evidence → refresh-all 重算）
- docs/synova/product-lines/product-progress.html — 同上（A5 页面再生成）
- docs/synova/product-lines/evidence-expiry.json — gen-expiry-warnings.py 产物（origin/main 当前未跟踪，本单纳入）
- docs/synova/product-lines/rerun-evidence-summary-2026-09-16.json — 流水线汇总（fresh/fail/skip/degraded + 六态对照）
- docs/synova/product-lines/evidence/test-2026-09-16*.json — 线1 vitest + A2 机器证据（流水线生成）
- scripts/golden-scenarios/evidence/GS-*-2026-09-16.json — GS 场景证据（含 GS-01/02/04 失败如实入库）
- .claude/task-briefs/2026-09-16-D786-D774-收口补丁派单：刷新产物落-main-+-仪表盘自动更新通道抢救（bot-PR-永久-blocked-根因）.md — 本 brief

做什么（T2｜通道修复 + 看门狗——手写，**红区文件显式声明**）：
- .github/workflows/product-progress.yml — 【红区声明】改动理由：移除 bot PR 创建步骤（`gh pr create` 用 GITHUB_TOKEN = F6 根因，PR 永久 blocked），保留分支产出，改由 CTO 显式合并（派单 T2-4 授权二选一，本单选 (b)）
- .github/workflows/dashboard-auto.yml — 【红区声明】同上（auto/dashboard 路，#403 同根因一并处置）
- .github/workflows/progress-freshness-watchdog.yml — 【红区声明】新增：产物过期看门狗（每日 cron + workflow_dispatch；generated_at >3 天 → job 红灯 + 邮件告警）
- .github/workflows/ci.yml — 【红区声明】改动理由：看门狗密封测试 `tests/control-tower/check-progress-freshness.test.sh` 加入 Control Tower Gate Tests canary 清单（铁律 35：测试入 CI 强制，否则建了不接线 M3）
- scripts/product-lines/check-progress-freshness.py — 新增：看门狗脚本（契约头 + 三路径测试）
- tests/control-tower/check-progress-freshness.test.sh — 新增：看门狗密封测试（入 ci.yml canary，双平台矩阵；三路径：正常/过期触发/降级 fail-closed）
- docs/synova/coordination/CI-诊断通道.md — 追加 PART B 通道链路文档（根因 + (b) 设计 + 诊断步骤 + 看门狗；下次断能查；保留 D521 原文不动）
- memory/notes/implemented/2026-09-16-d786-dashboard-channel-watchdog.md — 决策 Note（Note 引用门禁）

不做什么：
- 不改 scripts/product-lines/calc-progress.py（判分规则红线：TTL=14 天与失效口径冻结，保鲜 ≠ 改判分）
- 不改 scripts/product-lines/rerun-evidence.sh、refresh-all.sh、run-machine-evidence.sh（D774 已交付，本单只消费）
- 不碰 scripts/audit/**、不写 k3 / founder_demo 类证据（K3 红线）
- 不动 task-state/D786.json 与 .claude/task-briefs/2026-09-15-D786-d774-closeout.md（归 PR #584 写集，防撞车）
- 不删除/重建远端 auto/dashboard、auto/product-progress 分支（由 workflow 自身逻辑管理；本单只关 PR #403/#404）
- 不引入 @deepseek-ai 依赖、不复制 OpenViking（红线）

## Q3: 验收 — 入口 → 交互 → 结果

入口：worktree 内 `bash scripts/product-lines/rerun-evidence.sh`（node_modules 链接主工作区 → vitest/A2 不降级）
处理：新证据落盘 → refresh-all 重算六态 → 产物 commit（synova-commit）→ PR（PAT 创建 → 12 必需检查全绿 → API squash 合并）；T2 改 workflow 停 bot PR + 看门狗
结果：main 上 generated_at=2026-09-16、六态 stale=27/pending_k3=36；GS-01/02/04 失败如实呈现（不被计为 verified）；通道文档 + 看门狗上线（断链 3 天内必红灯）

## 架构层: scripts（治理层产物通道 + .github 工作流编排；不触 src/ L1-L5）
#CRITERIA: A

## Done 标准
- [ ] 产物新鲜: verify: `python3 -c "import json;d=json.load(open('docs/synova/product-lines/product-progress.json'));print(d['generated_at'])"` → `2026-09-16 ...`（main 合并后）
- [ ] 六态对齐: verify: rerun-evidence-summary-2026-09-16.json 的 `six_state_after` 含 `pending_k3=36`、`stale=27`
- [ ] 失败不静默: verify: rerun-evidence.sh exit 1 且汇总 items 含 `GS-01/GS-02/GS-04` verdict=fail（反向：失败场景不计 verified）
- [ ] 通道可查: verify: `grep -c "check-runs" docs/synova/coordination/CI-诊断通道.md` → ≥1（诊断步骤落档）
- [ ] 看门狗可触发: verify: `python3 scripts/product-lines/check-progress-freshness.py --file <临时旧产物>` → exit 1 告警；换当日产物 → exit 0
- [ ] 红线未越: verify: `git log --oneline -- scripts/product-lines/calc-progress.py`（本单区间）→ 0 提交

## 写集

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-16-D786-D774-收口补丁派单：刷新产物落-main-+-仪表盘自动更新通道抢救（bot-PR-永久-blocked-根因）.md | task（PR-A） |
| scripts/golden-scenarios/evidence/GS-01-2026-09-16.json | 机器生成（PR-A） |
| scripts/golden-scenarios/evidence/GS-02-2026-09-16.json | 机器生成（PR-A） |
| scripts/golden-scenarios/evidence/GS-03-2026-09-16.json | 机器生成（PR-A） |
| scripts/golden-scenarios/evidence/GS-04-2026-09-16.json | 机器生成（PR-A） |
| scripts/golden-scenarios/evidence/GS-05-2026-09-16.json | 机器生成（PR-A） |
| scripts/golden-scenarios/evidence/GS-06-2026-09-16.json | 机器生成（PR-A） |
| scripts/golden-scenarios/evidence/GS-07-2026-09-16.json | 机器生成（PR-A） |
| scripts/golden-scenarios/evidence/GS-08-2026-09-16.json | 机器生成（PR-A） |
| docs/synova/product-lines/evidence/test-2026-09-16.json | 机器生成（PR-A） |
| docs/synova/product-lines/evidence/test-2026-09-16-1.json | 机器生成（PR-A） |
| memory/notes/implemented/2026-09-16-d786-dashboard-channel-watchdog.md | task（PR-A） |
| docs/synova/product-lines/product-progress.json | 机器生成（PR-B） |
| docs/synova/product-lines/product-progress.html | 机器生成（PR-B） |
| docs/synova/product-lines/evidence-expiry.json | 机器生成（PR-B） |
| docs/synova/product-lines/rerun-evidence-summary-2026-09-16.json | 机器生成（PR-B） |
| .github/workflows/product-progress.yml | task（T2，红区已声明） |
| .github/workflows/dashboard-auto.yml | task（T2，红区已声明） |
| .github/workflows/progress-freshness-watchdog.yml | task（T2，红区已声明） |
| .github/workflows/ci.yml | task（T2，红区已声明：canary 清单加看门狗测试） |
| scripts/product-lines/check-progress-freshness.py | task（T2） |
| tests/control-tower/check-progress-freshness.test.sh | task（T2） |
| docs/synova/coordination/CI-诊断通道.md | task（T2：追加 PART B 通道链路文档，保留 D521 原文） |
