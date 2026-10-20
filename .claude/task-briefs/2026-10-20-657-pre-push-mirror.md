# Task Brief: P4 · #657 — 门禁 0-2 补 remote 维度（mirror 推送放行）

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）
- 门禁 0-2（`scripts/pre-push-check.sh:74-80`）只看 ref 不看 remote：`refs/heads/main` 一律拦 ⇒ 推 `mirror`（只读镜像）与推 `gitea`（真源）同罪；卡 #657 现场 dry-run 实测 exit 1。
- 关联件：`tests/control-tower/push-sync-guard.test.sh`（0-1/0-2 既有夹具）、`scripts/install-hooks.sh`（pre-push 传参）。

## Q1: 调研（决策链 / 既有基础）
- 0-1 已有"按被推 ref 判"（#617）；remote 名 `$1`/`PUSH_URL` 已传入 pre-push；`grep -rn "mirror" scripts/` 无既有放行逻辑 ⇒ **扩展现有 0-2**（不新建脚本）。
- 依据：卡 #657 全文 ＋ 裁 223（A 类 CTO 已批）。

## Q2: 范围（做什么 / 不做什么——含文件路径）
做什么：
- scripts/pre-push-check.sh
- tests/control-tower/pre-push-mirror.test.sh
- gate-exemptions/2026-10-20-pre-push-mirror-657.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-20-pre-push-mirror-657.md
- .claude/task-briefs/2026-10-20-657-pre-push-mirror.md
不做什么：
- scripts/pre-push-check.sh 的 0-1 段（#617 已单独处理）
- scripts/audit/**
- scripts/control-tower/**

## Q3: 验收（入口 → 交互 → 结果）
- 入口：`bash tests/control-tower/pre-push-mirror.test.sh`
- 交互：六判据（gitea main 拒／mirror ff 放行／non-ff 拒／日志／核 SHA 等与不等／feat 回归）
- 结果：24 通过 / 0 失败；M1/M2 两改坏必红；push-sync-guard 回归 21/0。

## Q4: 契约与测试
- 0-2 只对 `remote==mirror ∧ ref==refs/heads/main` 走镜像分支；三硬约束（ff-only／mirror-sync.log／`--verify-mirror-sync`）。
- 测试注入：`SYNO_MIRROR_REMOTE`/`SYNO_MIRROR_SYNC_LOG`/`SYNO_MIRROR_PENDING`；沙箱 file:// 零网络。

## 本任务在哪一层
- 治理线 / 门禁（pre-push 0-2）；不涉产品运行时。

## Done 标准（至少一条可验证）
- [ ] mirror 夹具 24/0 → `verify: bash tests/control-tower/pre-push-mirror.test.sh`
- [ ] push-sync-guard 回归 21/0 → `verify: bash tests/control-tower/push-sync-guard.test.sh`
- [ ] 本地 12 组通过 → `verify: bash scripts/pre-commit-check.sh`
