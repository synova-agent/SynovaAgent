# Task Brief: D710 ct47-lock-landing-record

> 生成: 2026-09-11 | 任务: D710 | 认领: 主 CTO（synova-cto）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）；铁律 49（决策沉淀）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔治理落地记录批次（非五层）。创始人 2026-09-11 裁决：CT-47 上锁「方案 A」+ 开启 Secret
Scanning；密钥轮换暂缓。本批次把「裁决 + 落地实况 + 复核证据」沉淀为四态 Note + 台账更新 +
backlog 登记，并把新约束同步给已派出的并行 CTO 派单文档。
### b) 文件审计
- `docs/synova/coordination/审计发现台账-DSH-CTO.md:98` CT-47 行状态列现为「🔴 待创始人裁决加严」——本批改「已裁决+已落地」
- `memory/notes/implemented/` 无 CT-47 落地 Note（`ls` 实测）——本批新建
- 落地实况取证：API GET `/branches/main/protection` → required_status_checks.checks=12、enforce_admins.enabled=true；`/repos/...` → secret_scanning=enabled、push_protection=enabled（validity_checks/non_provider_patterns 两次 PATCH 未生效）
- 必跑检查名单取证：commit `76efe4cd`（docs-only PR）与 `261ad6c6`（代码 PR）check-runs 交集 = 12 项，全为 app_id=15368
### c) 决策
台账就地更新（不改结构）+ 新建四态 Note + backlog 增登记（钥匙暂缓）= append/修订式，零代码改动。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- memory 教训：V3.9「被绕过的门禁 = 没有门禁」；CT-47 四次实证（#223/#299/#476/本夜 PR #494 首轮红）；
  M1 fail-open（本地 hook 管不到 GitHub merge 通道 = 结构性缺口）。
- 业界实证：GitHub branch protection required status checks 是平台级物理门禁；**设「从不运行的检查」
  会造成永久 pending 死锁**——故本批先用两类 PR（docs-only / 代码）的 check-runs 交集确定必跑名单。
- 参考：第一性原理（门禁必须在被规避的通道上物理存在）+ GitHub 平台能力实证 → 结论：方案 A。
### 参考：GitHub Docs branch protection / secret scanning（公开仓库免费）+ 实测 check-runs → 方案 A + 三件套

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/审计发现台账-DSH-CTO.md — CT-47 行状态改为已裁决+已落地（含 12 项名单与复核证据）
- memory/notes/implemented/2026-09-11-ct47-branch-protection-lock.md — 四态 Note（铁律 49）
- docs/synova/coordination/board-backlog.json — 增 PLAN-credential-rotation-deferred（创始人决定暂缓 + 取证结论 + 后续注意）
- docs/synova/coordination/派单-并行CTO-控制塔收口批次-20260911.md — 交付要求补第 6 条（合并已上锁）
- .claude/task-briefs/2026-09-11-D710-ct47-lock-landing-record.md — 本 brief
- task-state/D710.json — 状态登记
不做什么：
- 不改 scripts/audit/audit-rules.sh（K3 红线，审计域禁碰）
- 不改 src/server.ts（src/ 产品代码与本任务无关）
- 不改 .github/workflows/ci.yml（Win 线 D703/D704 写集中）
- 不改 scripts/pre-commit-check.sh（D664 开工后由执行方改）

## Q3: 验收 — 入口 → 交互 → 结果
入口：创始人/任何 session 读台账 CT-47 行或四态 Note
处理：记录裁决来源 + 落地实况表 + 复核命令
结果：CT-47 状态可核（API GET 复核 12 项 + enforce_admins）；后续 session 不会重复「待裁决」

## 架构层: 基础设施（控制塔治理记录，非五层）
控制塔治理落地与决策沉淀，不属于五层产品架构

## Done 标准:
- [ ] grep -c "已裁决 + 已落地" docs/synova/coordination/审计发现台账-DSH-CTO.md → ≥1（CT-47 行）
- [ ] grep -q "enforce_admins" memory/notes/implemented/2026-09-11-ct47-branch-protection-lock.md → 命中
- [ ] python3 json.load 校验 board-backlog.json 通过 且含 PLAN-credential-rotation-deferred
- [ ] PR CI 12 项检查全绿（**本 PR 即新门禁的首次实测**：红态无法合并）
