# D1125 · Issue 政策门禁：informational 软上线 + S1–S4 分级方案

- **状态**: proposed
- **日期**: 2026-10-02
- **背景**: CTO `补充指令 1 · B 段政策` §5-① 要求「政策门禁先作为非必过软上线 + 出预演报告」。
  实测（as_of 2026-10-02T09:33:33Z）本仓 **124 个在飞 open PR**：`kind/*`、`area/*`、`p0–p3` 标签**实例数均为 0**
  （全部标签只有 `积压:*` 五类）。⇒ 任何"要求分类/优先级标签"的判据**首日命中 ~100%**，
  与 PR 质量无关，是**标签体系尚未启用**。故本件的真问题不是"要不要软上线"，而是**必须先分级**。
- **决定**:
  1. **双模式 + 默认 informational**：`config.json → enforcement.mode`。informational 下**有 block 级违规也 exit 0**
     （只报不拦）；转必过需**两步**：① job 名进必需集 ② mode 改 blocking。二者缺一不可。
  2. **分级落进配置、可执行**：`config.json → stages.{1..4}.enable`，`policy.mjs --stage N` 只放行该级规则
     （未列出者显式 disabled，不留半开态）。实测：**S1 51/124（41.1%）** · S2 123/124 · S3 123/124 · S4 123 block + 246 warn。
  3. **draft 豁免口径写进配置**：draft 跳 `typeLabel/priorityLabel/areaLabel/requiredSections/placeholderLeft`，
     **不跳 `linkedIssue`**（可追溯性对草稿同样成立）。S2 的"唯一通过者 #799"正是此豁免 ⇒ 真实口径 **非 draft 0/123 通过**。
  4. **判据取自默认分支**：`actions/checkout` 固定 `ref=default_branch` ⇒ PR 改不了自己的裁判。
  5. **最小权限**：`permissions: {contents: read}`（无任何 write）。阶段 2 规则启用时才追加 `issues: read`。
- **考虑过的其他方案**:
  1. **一步设为必过** ⇒ 否决：实测非 draft **0/123** 可过 S2 ⇒ 会同时卡死全部在飞 PR（且违反 CTO 明条）。
  2. **规则写宽一点（如"有任意标签即可"）** ⇒ 否决：判据退化为恒真，等于没门禁（V3.9：软机制 0% 有效）。
  3. **改 `ci.yml` 承载** ⇒ 否决：`ci.yml` 属单写者热点，本卡新增独立 workflow 文件。
  4. **引第三方 action 做政策校验** ⇒ 否决：G1 零 DSH/第三方依赖红线 + 供应链面。
  5. **只出报告不落代码** ⇒ 否决：报告无法被复算（`--stage N` 才让"转到哪一级"可量）。
- **后果**（长期承担）:
  - informational **无强制力**：观察期内靠数据说服，不靠拦截——这是有意的代价（换可达性）。
  - **单测未进 CI 密封面**：`tests/issue-management/*.test.mjs` 不在 `check-gate-integrity.sh` 的密封面正则
    `\.test\.(sh|py)$` 内，而 `ci.yml` 本卡冻结 ⇒ 单测**只在本地/交付验收跑**（已知缺口，另卡）。
  - **逐级转正需 CTO 裁**（转到哪一级 = 产品/业务决策，非技术自决）；且 `ISSUE_TEMPLATE` 未在 `main`
    （实测 0 文件）⇒ 入口缺失会让观察期数据失真，建议与该门禁同批上线。
  - 阶段 2 `linkedIssueLabels` 已实现但 disabled（需 `issues: read` + issue 元数据输入）。
- **取代**: 无（新增；不改任何既有门禁的通过/失败判定）。
