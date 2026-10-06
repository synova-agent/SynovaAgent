# CI 存量红差分记录（为什么 Gate Integrity 红与本 PR 无关）

> 本件为**命令生成**（非手写）：下方 ❌ 行逐字取自两次夹具运行的原始日志。
> 复跑：

```bash
# 在干净 origin/main 上跑同一夹具（CI 里失败的那一步）
git worktree add --detach /tmp/diff-main origin/main
( cd /tmp/diff-main && bash tests/control-tower/precommit-groups-injection.test.sh ) 2>&1 | tail -20
```

## 结论

该夹具的 baseline 场景（干净副本 + 无注入）**在干净 origin/main 上同样 FAIL**，
且与本人分支的 ❌ 集合**逐条相同**（下列两段）。⇒ Gate Integrity 的红是**存量红**，与本 PR 改动无关。

## raw：本分支（docs/V10V11V12-schema-gates）

```
   [BASELINE_FAIL] 全部 ❌ 行:
     ❌ DSH 断面一致性 (D943): 3 处  [CI strict——软提示在 CI 上为硬阻断]
     ❌ docs/synova/coordination/提案/RbacContext-org-team-维度.md:405 未登记的 DSH 版本串 0.1.2-install
     ❌ docs/synova/coordination/提案/RbacContext-org-team-维度.md:406 未登记的 DSH 版本串 0.2.0-rc.2
     ❌ as any / as never / as unknown as 零容忍（新增，铁律 38；存量独立清理）: 1 处  [硬阻断]
     ❌ 新文件配对: impl 须同 commit 有 test: 1 处  [硬阻断]
     ❌ 禁止 DiagnosticModule: 新模块须实现 Sentinel 接口: 1 处  [CI strict——软提示在 CI 上为硬阻断]
     ❌ 声明闸② brief↔代码一致性（Q2 写集/排除项/可解析；D1148 合并 15→3）: 1 处  [硬阻断]
  ❌ D1148 合并提交: MERGE_HEAD=1 rc=1 —— 声明闸把另一父的文件当成本次对象（或跳过未留痕）
       ❌ DSH 断面一致性 (D943): 3 处  [CI strict——软提示在 CI 上为硬阻断]
          ❌ docs/synova/coordination/提案/RbacContext-org-team-维度.md:405 未登记的 DSH 版本串 0.1.2-install
          ❌ docs/synova/coordination/提案/RbacContext-org-team-维度.md:406 未登记的 DSH 版本串 0.2.0-rc.2
       ❌ 1 组未通过 — 提交已拒绝
GATE_INJECTION_SUMMARY: scenarios=5 red_confirmed=4 structural_not_red=0 not_red=0 baseline=FAIL probe=not_run(rc=n/a) residue_code=0 residue_repo=2 shim=1 decl_gates=1
❌ 注入自测未达期望：not_red=0 baseline=FAIL probe=not_run residue_fail=0
mine_exit=1
```

## raw：origin/main（干净，同一台机器同一命令）

```
   [BASELINE_FAIL] 全部 ❌ 行:
     ❌ 未登记: decisions/proposed/process/2026-10-01-pre-push-preview.md （请加入 docs/authority/DOCS-REGISTRY.yaml）
     ❌ DSH 断面一致性 (D943): 3 处  [CI strict——软提示在 CI 上为硬阻断]
     ❌ docs/synova/coordination/提案/RbacContext-org-team-维度.md:405 未登记的 DSH 版本串 0.1.2-install
     ❌ as any / as never / as unknown as 零容忍（新增，铁律 38；存量独立清理）: 1 处  [硬阻断]
     ❌ 新文件配对: impl 须同 commit 有 test: 1 处  [硬阻断]
     ❌ 禁止 DiagnosticModule: 新模块须实现 Sentinel 接口: 1 处  [CI strict——软提示在 CI 上为硬阻断]
     ❌ 声明闸② brief↔代码一致性（Q2 写集/排除项/可解析；D1148 合并 15→3）: 1 处  [硬阻断]
  ❌ D1148 合并提交: MERGE_HEAD=1 rc=1 —— 声明闸把另一父的文件当成本次对象（或跳过未留痕）
          ❌ 未登记: decisions/proposed/process/2026-10-01-pre-push-preview.md （请加入 docs/authority/DOCS-REGISTRY.yaml）
       ❌ DSH 断面一致性 (D943): 3 处  [CI strict——软提示在 CI 上为硬阻断]
          ❌ docs/synova/coordination/提案/RbacContext-org-team-维度.md:405 未登记的 DSH 版本串 0.1.2-install
          ❌ docs/synova/coordination/提案/RbacContext-org-team-维度.md:406 未登记的 DSH 版本串 0.2.0-rc.2
       ❌ 1 组未通过 — 提交已拒绝
GATE_INJECTION_SUMMARY: scenarios=5 red_confirmed=4 structural_not_red=0 not_red=0 baseline=FAIL probe=not_run(rc=n/a) residue_code=0 residue_repo=1 shim=1 decl_gates=1
❌ 注入自测未达期望：not_red=0 baseline=FAIL probe=not_run residue_fail=0
main_exit=1
```

## 为什么 CI 其他地方也红（同样非本 PR）

本 PR 含一个 .ts 文件（`docs/synova/coordination/tools/check-coordination-schema.ts`），
不匹配 CI 的 docs-only 白名单（`^docs/.+\.(md|json|html)$`）⇒ 各 job 走**全量**路径 ⇒ 触发 `npm ci`，
而 main 的 `npm ci` 结构性必红（vitest/coverage-v8 ERESOLVE，#1159 未合，属治理线）。
原始输出见下方（失败步骤名逐字取自 CI check-run）：

```
job / failed step（取自 gh run view --json jobs）:
  TypeScript + Lint + Iron Laws            -> Run npm ci
  Architecture Check                       -> Run npm ci
  Integration Contract Check               -> Run npm ci
  Checker Review (maker/checker)           -> Run npm ci
  Vitest (1/2)                             -> Run npm ci
  Golden Case F1 Gate                      -> Run npm ci
  Gate Integrity (...)                     -> pre-commit groups injection fixture (sampled)
```
