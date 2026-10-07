# Task Brief — D-A 第一刀：pre-push 减负（D1202）

## Q0: 定位
- 治理面 `scripts/pre-push-check.sh` + `tests/ci/golden-case-gate.test.ts`；父卡 #1221（v2.0 方案三）。

## Q1: 调研
- 实测: pre-push 含 golden-case（60s+，且依赖 npx——今晚实测 npx 缺失造成一次假红）+ vitest 改基（30-120s）；
  两者在 CI 均已权威执行（golden-case job / Vitest 两片均为必需 context）。
- 手段对比: 全删=推不动；条件跳过=软机制（V3.9「软机制 0% 有效」）；故直接退役 + 断言改指 CI。

## Q2: 范围 — 做什么
- 退役 pre-push 门禁 2（golden F1 + checksum + 诊断质量）与门禁 3（vitest 改基）。
- 保留：门禁 0（D334 多机同步/防覆盖）、1（secrets）、4/5/6/tag、**7（bypass 账本对账——特意保留，
  它今晚真实拦下一次 --no-verify 污染且零耗时；偏离字面口径已留痕）**。
- 断言同步：`tests/ci/golden-case-gate.test.ts` 由「pre-push 调用方」改为「CI 调用方 + pre-push 已退役」。
- 实测：pre-push 墙钟 60s+ → **14.9s**。

不做什么（含文件路径）：
- 不修改 scripts/pre-commit-check.sh（D-A 第二刀，须与 D-C 声明格式同步做）
- 不修改 .github/workflows/ci.yml（他卡写面）与 scripts/audit/**（K3 域）
- 不修改 scripts/workflow/check-golden-regression.sh、scripts/ci/diagnosis-quality-check.sh（判据脚本零改动，仅改调用方）

## Q3: 验收
- 入口: `git push` / `bash scripts/pre-push-check.sh`
- 结果: 推送耗时从 60s+ 降至 ~15s；golden/vitest 权威判定仍在 CI（必需 context）。

## 架构层: 治理面（scripts/pre-push-check.sh）

#CRITERIA: D

## 写集
| 文件 | 类型 |
|---|---|
| scripts/pre-push-check.sh | task |
| tests/ci/golden-case-gate.test.ts | task |
| .claude/task-briefs/2026-10-07-D1202-DA-prepush-slim.md | task |
| memory/notes/proposed/2026-10-07-d1202-prepush-slim.md | task |

## Done 标准:
- [ ] verify: time bash scripts/pre-push-check.sh ⇒ 墙钟 <20s（实测 14.9s）
- [ ] verify: npx vitest run tests/ci/golden-case-gate.test.ts ⇒ 7 passed
- [ ] verify: push-sync-guard / tag-ancestry / tag-bypass-wiring / ci-strict-visible 四套 ⇒ OK
