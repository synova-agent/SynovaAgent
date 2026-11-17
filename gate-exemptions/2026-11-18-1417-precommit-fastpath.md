# review: #1420
# 豁免登记 — Issue #1417（本地 pre-commit 收敛为默认快跑集 + 组7/13 提速 + pre-push 禁 npx）
#
# 变更性质：门禁脚本的性能与默认执行面调整。判据（hard/soft 语义、三态退出码）未弱化：
#   · 11 个检查组横幅与全部检查体零删除，FULL 模式（--full / SYNO_PRECOMMIT_FULL=1）与改动前同语义；
#   · 配对测试 tests/control-tower/precommit-fastpath.test.sh 覆盖「默认跳过 / 全量全跑 / 改坏必红抽两条」；
#   · CI core-gates（.gitea/**、SYNO_CI=1 语义）零改动。
# 依据：CTO 裁定 2026-11-18（Issue #1417 任务卡）。
#
# 逐文件豁免（三段式：路径 — 理由（≥10 字） — 裁定号）：
- scripts/pre-commit-check.sh — 默认快跑集/--full 开关与并行化落地，判据零删除 — #1417
- scripts/check-integrity-startup.sh — 组7 单进程批量重写（同判据，268s→1s） — #1417
- scripts/check-hardcoded.sh — 单次 git diff 复用（同判据，8s→1s） — #1417
- scripts/workflow/sync-dsh-skills.sh — 参数展开替代逐目录 basename（同判据，13s→8s） — #1417
- scripts/doc-system/doc-registry-gate.sh — BASE_IDS 冻结正则修复 + 内建匹配（同判据，>200s→30s） — #1417
- scripts/control-tower/baseline-check.sh — tsc 只用本地依赖，缺失 exit 2（不 npx 联网） — #1417
- scripts/pre-push-check.sh — 区分 baseline exit 1/2（降级不误报新增 tsc 错误） — #1417
- tests/control-tower/precommit-fastpath.test.sh — 新增配对测试（默认跳过/全量/改坏必红） — #1417
- tests/control-tower/precommit-groups-injection.test.sh — 注入场景显式 FULL 模式（保持原判定面） — #1417
- tests/control-tower/precommit-claim-wiring.test.sh — claim 探针显式 FULL 模式（保持原判定面） — #1417
- gate-exemptions/2026-11-18-1417-precommit-fastpath.md — 本豁免件自身在 diff 内（自覆盖行） — #1417
