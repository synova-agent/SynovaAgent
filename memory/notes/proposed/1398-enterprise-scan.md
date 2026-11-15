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

## 决定（补充二，2026-11-16）：独立复核退回的两项缺陷及其修法

**阻塞项 1（产品行为）：跨 viewer 的 GET 返回 500。** 旧 `writeEvidence` 只在 `model.sources`（= **创建者**可见集）里找来源，找不到即跳过 ⇒ 不可见来源的证据版本从未落库 ⇒ 更宽可见者 GET 时 `scan_assertion_evidence` 的复合外键 `(graph, evidence_version_id)` 找不到父行 ⇒ `TRANSACTION_ABORTED`（`evidenceParent=0`），且 500 消息回显内部 evidence-version ID。

**修法**：证据版本改为按「**全部授权来源**」随 run 落库（身份取自 `describeSource()` 单一真源，不复制公式）；不可见来源的期间/时态留 `NULL`、`parse_status` 记 `pending`（未确立），**不参与任何可见性计算或派生值**，也不进入任何 viewer 的报告 —— 「落库」≠「回显」。同时 500 消息去掉了内部 ID（只留 SQLite 原因与父行计数）。**未改共享 Schema、未改权限模型。**

**阻塞项 2（测试可靠性）：`variants.test.ts` 对整串 JSON 搜裸数字 `'120'` ⇒ 随机 flake。** 机制：`stableId()` = `前缀-` + sha256 前 32 位 hex（`canonical.ts:27-29`），报告里此类 hex 标识约 25–30 个，每个含子串 `120` 的概率 ≈ 30/4096 ≈ 0.7% ⇒ 聚合 ≈ 13–18%，与复核者实测 ~13% 相符。**修法**：改结构化断言（值 / 来源可见性 / 证据链 sourceRef / cross_source / partial_visibility），固定文件名整串判据保留；同类缺陷在 `isolation.test.ts` 一并修掉。

**代价登记（不在本票修）**：角色词表分裂（`visibility.ts` 的 `owner/operator/responsible` vs 产品 `WorkspaceRole`）⇒ 真实登录用户会 deny-all；preflight worker 打包依赖 devDependency `tsx`；`scanner.ts` 同 basename 静默覆盖。三项均由 CTO 另立票。
