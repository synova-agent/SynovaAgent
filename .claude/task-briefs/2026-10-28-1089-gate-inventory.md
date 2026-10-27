# #1089 W1 门禁三分类登记（GATE-INVENTORY 纯追加 classification）

#CRITERIA: D

## Q1: 调研
依据：创始人规格 v2.0 §3 W1 / §4 G1 / §5 M-9（sha256/16 `e13b4ecc2e5929a3`，未入库件）；Issue #1089。
既有基础：`docs/authority/GATE-INVENTORY.yaml` **已存在**（952 行；append-only 中枢，`check-merge-conditions.sh` 消费）；
盘上 `scripts/control-tower/{check,verify}-*` 实测 **36** 件 vs 在册 **32**（漂移 +4；`check-citations.py` 在册但盘上已无＝幽灵）；
class/owner/review_after/entrypoint/required_ci **五字段零存在**。
决策：**不改写既有 952 行**，只做纯追加 `classification:` 段 —— 既满足 append-only 约束，又不动任何登记行。

## Q2: 范围
做什么:
- docs/authority/GATE-INVENTORY.yaml
- scripts/control-tower/check-gate-inventory.sh
- tests/control-tower/check-gate-inventory.test.sh
- gate-exemptions/2026-10-28-1089-gate-inventory.md
- .claude/task-briefs/2026-10-28-1089-gate-inventory.md
- memory/notes/proposed/2026-10-28-1089-gate-inventory.md
- docs/authority/DOCS-REGISTRY.yaml
- docs/authority/WIRING-REGISTRY.yaml

不做什么:
- scripts/control-tower/check-mirror-freshness.sh
- scripts/pre-commit-check.sh

## Q3: 验收
- 校验器真跑：`bash scripts/control-tower/check-gate-inventory.sh --root .` ⇒ **37 条目 / 37 件 / P0 8** ⇒ exit 0
- 配对测试：`bash tests/control-tower/check-gate-inventory.test.sh` ⇒ **22 通过 0 失败**
- M-9：`SYNO_P0_FLOOR=9` ⇒ **exit 1**（P0 降级需裁定号）；判不了（清单缺失/零条目）⇒ **exit 2**

## 架构层: 不属五层业务（治理脚本，scripts/control-tower）

## Done 标准
- [x] 校验器真绿 verify: `bash scripts/control-tower/check-gate-inventory.sh --root .`
- [x] 配对测试 22/0 verify: `bash tests/control-tower/check-gate-inventory.test.sh`
- [x] M-9 棘轮变红 verify: `SYNO_P0_FLOOR=9 bash scripts/control-tower/check-gate-inventory.sh --root .`
