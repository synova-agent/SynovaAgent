# V4 · 判据件可跑性实测 —— 「引用的判据件在 ref 存在吗」

## 命令

```bash
# 逐项：对 acceptance 里出现的每个路径跑一次 git cat-file -e（三态：OK / FAIL + git 原始 stderr）
$ git -C /Users/wane/SynovaAgent/.synova-wt-registry cat-file -e \
      origin/docs/D1144-registry-unbundle:<路径>
```

## 原始输出（49 条引用）

```
FAIL	0-1	scripts/control-tower/probe-loops.sh	fatal: path 'scripts/control-tower/probe-loops.sh' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	0-1	data/synova.db	fatal: path 'data/synova.db' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	0-2	tests/growth/evolution-writeback.test.ts	fatal: path 'tests/growth/evolution-writeback.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	0-2	data/synova.db	fatal: path 'data/synova.db' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	0-3	scripts/control-tower/probe-sentinels.ts	fatal: path 'scripts/control-tower/probe-sentinels.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	0-4	scripts/control-tower/probe-cycle-edges.ts	fatal: path 'scripts/control-tower/probe-cycle-edges.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
OK  	0-5	tests/growth/goal-sentinel.test.ts
FAIL	0-6	scripts/control-tower/probe-diagnosis.ts	fatal: path 'scripts/control-tower/probe-diagnosis.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
OK  	0-7	tests/routes/chat-feedback.test.ts
FAIL	0-8	tests/growth/goal-lifecycle-wired-or-retired.test.ts	fatal: path 'tests/growth/goal-lifecycle-wired-or-retired.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
OK  	0-10	tests/security/request-context-failclosed.test.ts
FAIL	0-11	scripts/control-tower/probe-tool-policy.ts	fatal: path 'scripts/control-tower/probe-tool-policy.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	0-12	scripts/control-tower/probe-skills.ts	fatal: path 'scripts/control-tower/probe-skills.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
OK  	1-1	scripts/golden-scenarios/GS-08-report-readable/run.sh
FAIL	1-2	tests/l3/report-contract-versioned.test.ts	fatal: path 'tests/l3/report-contract-versioned.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	1-3	tests/l3/report-template-client.test.ts	fatal: path 'tests/l3/report-template-client.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	1-4	data/synova.db	fatal: path 'data/synova.db' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	1-5	tests/routes/customer-config-consumed.test.ts	fatal: path 'tests/routes/customer-config-consumed.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	1-6	tests/l4/traversal-permission.test.ts	fatal: path 'tests/l4/traversal-permission.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
OK  	1-7	tests/security/rbac-all-routes.test.ts
FAIL	1-8	tests/sentinel/edge-lag-consumed.test.ts	fatal: path 'tests/sentinel/edge-lag-consumed.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	1-9	tests/loops/direction-monitor.transfer-function.test.ts	fatal: path 'tests/loops/direction-monitor.transfer-function.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	2-1a	tests/store/metric-readings-schema.test.ts	fatal: path 'tests/store/metric-readings-schema.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	2-1a	tests/store/metric-readings-insert.test.ts	fatal: path 'tests/store/metric-readings-insert.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	2-1b	data/synova.db	fatal: path 'data/synova.db' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	2-2	docs/synova/coordination/tools/check-param-list.ts	fatal: path 'docs/synova/coordination/tools/check-param-list.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	2-3	data/synova.db	fatal: path 'data/synova.db' does not exist in 'origin/docs/D1144-registry-unbundle'
OK  	2-4	tests/security/file-guard.test.ts
FAIL	2-6	scripts/control-tower/probe-compute-registry.ts	fatal: path 'scripts/control-tower/probe-compute-registry.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	2-7	docs/synova/coordination/tools/probe-accuracy-trend.ts	fatal: path 'docs/synova/coordination/tools/probe-accuracy-trend.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-1	scripts/control-tower/probe-role-pack.ts	fatal: path 'scripts/control-tower/probe-role-pack.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-2	tests/l4/knowledge-scope.test.ts	fatal: path 'tests/l4/knowledge-scope.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-3	scripts/control-tower/probe-onboarding.ts	fatal: path 'scripts/control-tower/probe-onboarding.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-4	tests/onboarding/gap-questioner.test.ts	fatal: path 'tests/onboarding/gap-questioner.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-5	data/synova.db	fatal: path 'data/synova.db' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-6	scripts/control-tower/probe-agent-readiness.ts	fatal: path 'scripts/control-tower/probe-agent-readiness.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-7	tests/agent/agent-matrix-trigger.test.ts	fatal: path 'tests/agent/agent-matrix-trigger.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-8	scripts/control-tower/probe-sentinel.ts	fatal: path 'scripts/control-tower/probe-sentinel.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-9	scripts/control-tower/probe-eco-fields.ts	fatal: path 'scripts/control-tower/probe-eco-fields.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-10	scripts/control-tower/probe-egress.sh	fatal: path 'scripts/control-tower/probe-egress.sh' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	3-11	tests/extensions/layer-precedence.test.ts	fatal: path 'tests/extensions/layer-precedence.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	PL-04	docs/synova/coordination/tools/probe-three-layer-contract.ts	fatal: path 'docs/synova/coordination/tools/probe-three-layer-contract.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	0-9bis	data/synova.db	fatal: path 'data/synova.db' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	K1-WH	tests/security/feishu-webhook-signature.test.ts	fatal: path 'tests/security/feishu-webhook-signature.test.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	RB-01	scripts/control-tower/probe-rbac-multitenant.ts	fatal: path 'scripts/control-tower/probe-rbac-multitenant.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	RB-02	scripts/control-tower/probe-department-axis.ts	fatal: path 'scripts/control-tower/probe-department-axis.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	RB-03	scripts/control-tower/probe-permission-grants.ts	fatal: path 'scripts/control-tower/probe-permission-grants.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
FAIL	RB-04	scripts/control-tower/probe-role-config.ts	fatal: path 'scripts/control-tower/probe-role-config.ts' does not exist in 'origin/docs/D1144-registry-unbundle'
OK  	3-12	tests/evolution/global-analyzer.test.ts
```

## 计数（由上面的原始输出统计，非手写）

```
$ grep -c "^OK"   → 7
$ grep -c "^FAIL" → 42
```

## 逐项体检（机器生成，口径见文件头）

```
$ node --experimental-strip-types docs/synova/product-lines/evidence/V3V4V5/analyze.ts \
      --ref origin/docs/D1144-registry-unbundle
# ref=origin/docs/D1144-registry-unbundle registry=docs/synova/coordination/施工项登记.ts todo=46
A(严格·含 data/** 路径)=Y:39 N:7 n/a:0
A(S5 口径·不含 data/**)=Y:41 N:0 n/a:5
B(green)=6  B(unrunnable)=40  B(red)=0
C(Y)=7  C(N)=39
D: n/a（由 fixtures 路承担）
L2=6  L1=40
V5 verifier!==worker : 46/46
判据件缺失(S5 口径)=39 项 —— S5 尽调记 40/46，本器减 1 因 1-1 已改指存在的 GS-08 执行器
```

> **两个 A 口径都报**（避免口径分裂）：严格口径把 `data/synova.db` 也算"命令里出现的文件路径"⇒ A=N 7 项；
> S5 尽调口径不含 `data/**` ⇒ A=Y 41 / n/a 5（S5 记 38/46，本次 +3 来自 0-5 / 2-4 / 3-12 的 A 修复）。

## 本次做的 V4(b) 真修复（逐项判，非一刀切）

| 项 | 动作 | 判据 |
|----|------|------|
| 1-1 | 改指向 | `scripts/golden-scenarios/run.sh`（**任何 ref 都不存在的 phantom path**，`git log --all --diff-filter=A` 空）→ `scripts/golden-scenarios/GS-08-report-readable/run.sh`（本 ref 存在，`git cat-file -e` = OK） |
| 0-5 | A 修复 | 判据件 `tests/growth/goal-sentinel.test.ts` 并入 `paths`（原不在写集，A=N） |
| 2-4 | A 修复 | 判据件 `tests/security/file-guard.test.ts` 并入 `paths` |
| 3-12 | A 修复 | 判据件 `tests/evolution/global-analyzer.test.ts` 并入 `paths` |

## 🔴 未做的 V4(a)「补判据件」—— 结构性越界，不照做

40 项里 36 步引用的判据件落在 `scripts/control-tower/probe-*.ts/.sh` 与 `tests/**`；
本卡写集 = `docs/synova/coordination/施工项登记.ts` + `docs/synova/product-lines/evidence/V3V4V5/`，
且派单纪律明文**禁改 `scripts/**`**、D 判据夹具归 fixtures 路 ⇒ **补判据件越出槽界**。
⇒ 按判例 P-01（派单方配方同样要被执行方核）报回，改走「保留原判据 + 降级 L1 + 显式未验」。
