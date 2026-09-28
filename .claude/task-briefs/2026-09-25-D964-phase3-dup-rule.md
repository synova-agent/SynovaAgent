# Task Brief: D964 阶段3 — 同类文档唯一性（并入 doc-registry-gate）
> 认领: 🧭 synova-cto（并行 CTO）

## Q0: 定位
### a) 拼图
文档治理（doc-system）。文档:代码 比 ≈4.2（DSH 0.68），需"同类文档只允许一份"的机器判据，且不得再增门禁。
### b) 文件审计
`scripts/doc-system/doc-registry-gate.sh`（D2 登记门禁，pre-commit 已调用）为唯一合理并入点；测试 `tests/doc-system/doc-registry-gate.test.sh` 已有三路径惯例。
### c) 决策
已有覆盖 → 并入既有检查（铁律 35 + DSH 反模式：不加新门禁脚本）。

## Q1: 调研
铁律 35；ctrl-tower-change 模式 2（bash+CJK 变量边界：sed/tr 破坏多字节变量 → 归一化改 python）+ windows-compat（无 GNU sed）。DSH 借鉴：无（本地文档治理，不涉 DSH 通用管道）。

## Q2: 范围 — 最简方案
做什么：
- scripts/doc-system/doc-registry-gate.sh：加「同类文档唯一性」（归一化名撞名 / 内容指纹相同 ⇒ 须写「取代:/合并:/supersedes:」否则红）
- tests/doc-system/doc-dup-rule.test.sh：新规则三路径 + 改坏即红
- .github/workflows/ci.yml：登记新测试
不做什么（含文件路径）：
- 不改 scripts/audit/**、src/**、docs/plans/**、docs/synova/audit-reports/**；不新建门禁脚本

## Q3: 验收
入口: pre-commit D2 登记门禁 / CI Control Tower Gate Tests。
处理: 新增 .md 归一化名去日期/版本/D# 后与既有比对 + 内容 md5 比对。
结果: 重复且无取代声明 ⇒ ❌ 阻断并给修法；有声明 ⇒ ✅ 放行。

## 架构层: scripts（doc-system）
## Done 标准
- [ ] 改坏即红: 构造重复文档样例 ⇒ exit 1（tests/doc-system/doc-dup-rule.test.sh ②④）
- [ ] 既有 doc-registry-gate.test.sh 全绿（9 通过 / 0 失败）
- [ ] 真实仓库实跑不误拦（0 疑似重复）
- 不改 scripts/audit/audit-rules.sh、scripts/pre-commit-check.sh、tests/control-tower/gate-stats.test.sh（明确不动这些具体文件）
