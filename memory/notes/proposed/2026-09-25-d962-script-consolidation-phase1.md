---
状态: proposed
日期: 2026-09-25
决策: D962 阶段 2a②③⑥——check-* 脚本 46→20 收敛第一批（退役 14 + 合并 4 + 新宿主 ct-health.sh）与组 5/8/9/10 组级测试
理由: 已批 D962-phase2-plan.md §一处置清单执行；check-* 泛滥（46 个）是 v2.5→V5 门禁堆积产物，按"一类一机制"收敛
class: D962_SCRIPT_CONSOLIDATION
constraint: "退役必给防护承接；合并必逐字迁移保行为等价；终态 find check-*=20"
expected: 46→28（第一批）→20（第二批，依赖 A 的 2a① pre-commit 重写去引用）
severity: warn
occurrences: 1
first_seen: 2026-09-25
description: |
  第一批落地项：
  - 退役 14: as-any/security/file-hell/fde-terms/check-spec/self-diagnosis/integrity-startup/
    tech-debt/checks-test-quality/ci-contract-gaps/wf-test-first/wf-dataflow-alignment/
    根brief-vs-code/lessons-learned（防护承接逐条见 D962-phase2-plan.md §一）
  - 合并 4: ci-stale-red+orphan-worktrees→ct-health.sh（无 check- 前缀，健康观测域非判定域，
    队长已确认不计入 20）；sentinel-type-net→check-architecture.sh §5（保 SYNO_TYPE_NET_ROOT
    注入缝+LC_ALL=C 防御）；boundaries-incremental→verify-incremental.sh L4b 内联
  - merge-base 修复移植: D520/D708 棘轮修复原落在根目录死副本 check-brief-vs-code.sh 上
    （workflow 真身无 merge-base，合并提交会误判越界）——移植进真身后才删副本，防护未丢
  - 组级测试 g5/g8/g9/g10: 正常/降级/边界+改坏即红，全绿
  发现并上报（pre-commit 域=A）: ①CHANGED_FILES 零赋值→G10/G11 死分支；②组9/组10 判定体
  裸 python 违 PLATFORM-CHECKLIST #1（无 python 别名机静默空转）
---
