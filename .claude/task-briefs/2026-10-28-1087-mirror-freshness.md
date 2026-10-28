# #1087 W5 镜像新鲜度检查器（旧树假绿检测）

#CRITERIA: D

## Q1: 调研
依据：创始人门禁治理规格 v2.0 §3 W5 / §4 G5 / §5 M-5（sha256/16 `e13b4ecc2e5929a3`，未入库件）；
实证见 Issue #1087（GitHub 镜象 `1ca0d4dfc` vs `local-main` `a32efef5b`，落后 117 提交）。
既有基础：`scripts/control-tower/mirror-sync-push.sh`（推镜象）与 `report-mirror-pushes.sh`（推送账），
但**无任何判据回答"镜象是否新鲜"** ⇒ 本卡补只读判据，不改推送链路。

## Q2: 范围
做什么:
- .gitea/workflows/local-gates.yml
- scripts/control-tower/check-mirror-freshness.sh
- tests/control-tower/check-mirror-freshness.test.sh
- gate-exemptions/2026-10-28-1087-mirror-freshness.md
- .claude/task-briefs/2026-10-28-1087-mirror-freshness.md
- memory/notes/proposed/2026-10-28-1087-mirror-freshness.md

不做什么:
- scripts/audit/
- scripts/control-tower/probe-line-signals.ts

## Q3: 验收
- 配对测试：`bash tests/control-tower/check-mirror-freshness.test.sh` ⇒ **16 通过 0 失败**
- 真跑：`--canonical gitea/local-main --mirror-url <github>` ⇒ **exit 1 / stale behind=117**
- 判不了：`--canonical nope` ⇒ **exit 2**（禁当通过）

## 架构层: 不属五层业务（治理脚本，scripts/control-tower）

## Done 标准
- [x] 密封测试 16/0 verify: `bash tests/control-tower/check-mirror-freshness.test.sh`
- [x] 真跑 stale 117 verify: `bash scripts/control-tower/check-mirror-freshness.sh --canonical gitea/local-main --mirror-ref origin/main`
- [x] 判不了 exit 2 verify: `bash scripts/control-tower/check-mirror-freshness.sh --canonical nope`
