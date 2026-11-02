# K12-ENG P1-2：岗位内容分层探针防恒真＋V4 靶修正

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #203（K12-20）
- **决策**:
  1. V2 差异叶子**只取内容面**（`prompt/tools/knowledge`）；`appliedLayers`／部门身份/层名不计入"内容差异"。
  2. V4 交叉验证不再引用已作废的 `extensions/knowledge-scope/`（裁 423）；改指 `extensions/presets/roles/<role>/knowledge-scope.yaml`，并如实标注"可见性面由 #188 行为面夹具覆盖，本卡不重复判定"。
- **理由**: 旧实现把身份串计入差异 ⇒ 两部门层内容被抹平后仍 PASS（判据可恒真，M09b 实证）。DSH rc.5：
  判据必须能拒绝非法输入。
- **证据**:
  - `probe-content-layering --case dept-diff` ⇒ 退出码=0；V2 差异叶子 6 个（3+3，逐字命中内容层文件）
  - 反例：把 `departments/{finance,sales}.yaml` 都替换为 `enterprise.yaml` ⇒ **退出码=1**、V2 FAIL（"逐字相同"）
  - 配对测试 5/0
- **回滚**: 还原探针单文件＋删配对测试。
