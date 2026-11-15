# 决策: #1398 中性首次企业扫描纵向薄片

状态: proposed
日期: 2026-11-15

## 现状

固定 base 的旧 CSV、文档路由和②写入缺少来源版本、自然键幂等及证据／实例状态分离；`standardKey` 会覆盖当前 props，`FileGuard` 对边界外只读默认放行，均不能直接承接首次扫描。最终 DEV DOC 与 Mandate 已将实现限定为合成资料、⓪证据接入和②结构映射。

## 决定

在唯一 `extensions/ontology` loader／validator 中新增交付样例类型；以 `(graph,type,businessKey)` 关联既有图身份；用 version 6 新表保存扫描、来源、证据版本、断言、授权、报告及关联。L2 只依赖端口，Bootstrap 用同一 Database 和 graphStore 装配 L4 store 与 L2 service。独立默认拒绝路径授权、可见证据先过滤、同步事务及提交前文件身份复检作为硬边界。冲突并列、缺失为 null，人的说明只证明陈述发生。

## 依据

- Gitea #1398 评论 12428 最终 DEV DOC，SHA-256 `b54cdd6a71447d059d04e5b4026ff6037402e0e794cbb44ba17dbbd98864d840`。
- 评论 12430 `synova-1b-transitional-v1` 的固定 base、分支、写集和验收。
- 固定 base 的实际代码调用链与测试；历史资产四类审计见 `docs/synova/coordination/编码指令-1398-1b-enterprise-scan-20261114.md`。

## 生效时点

本 Note 随 #1398 PR 留痕；PR review 与合并后才成为 main 行为。本批只声明合成资料开发验收，不声称真实客户验收、瓶颈识别或①③④⑤⑥能力完成。

## 决定（补充，2026-11-16）：中性关系在参数桥登记面按「显式 unknown」登记

**背景**：DEV DOC §4 line 38 规定新关系 `edge/team_executes_activity` **不含**权重、瓶颈、因果函数或时滞。而 `tests/l4/ontology-loader-param-bridge-1031.test.ts` 的登记面模型（`scripts/control-tower/probe-ontology-values.ts`）隐含要求每条 `edge-types/*.json` 在 `tf / cs / lag` 三处闭合等式下可归类。

**失败的两条替代路**（实测，非推演）：
- `TFR_REGISTERED_OTHER` 以 `structural_na` 登记 → 1031 仍 3 红（`tally.tf_placeholder` 1≠2、absent 集多一件、`cs_resolved` 0≠1），且**探针自身由 `violations=0` 变 `violations=1` / `[FAIL] 违规 2 条` / exit 1**。原因：`structural_na` 的语义是「`transfer_function` = 占位串 `N/A — …`」（样例 `goal_decomposition` 同时**有** `action_effect_lag`），与新关系「三键皆无」不是同类。
- 改 1031 的闭合等式 → 与该件设计目的（消灭「数字变了靠手改」）相反，且与「1031 本件不改」自相矛盾。

**采纳决定**（CTO 裁定 12522 D-2′）：把新关系登记进 `PENDING_REGISTERED_ADDITIONS`（`expected: 'non_causal_unknown'`，与 #1350 两件同款），并在边 JSON 顶层声明 `"action_effect_lag": "unknown"` 与 `"transfer_function": "unknown"`。

**口径**：DEV DOC §4 line 38「不含因果函数或时滞」指**不含数值/函数定义**；显式 `unknown` 是「未确立」的保守声明，**不构成**声明了函数或时滞（CTO 12522 改口在案）。

**实测结果**：探针自身 `violations=0` / `[OK] 值域迁移判定全绿` / exit 0；`1031` 30/30 全绿；`k4-05bis` 20/20 全绿。改动仅 2 文件、**零测试改动**，判据结构未动。

