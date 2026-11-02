# K12-ENG P0-4：知识 scope 探针 V3 改审批感知＋行为面夹具

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #188（K12-05）
- **决策**:
  1. `probe-knowledge-scope.ts` 的 V3 断言由"去掉一个 scope ⇒ 只少对应条目"改为
     **"改内容件 ⇒ 审批失效 ⇒ 该岗位全拒（fail-closed）、对照岗位不变"**。
  2. 新增 `scripts/control-tower/fixtures/k12-05-behavioral.sh`：临时 repo 形内容根＋临时库＋`JWT_SECRET`
     ＋真入口起服务，供 V2/V3/V4 真跑；`施工项登记.ts` K12-05 acceptance 改用该夹具。
- **理由**:
  - 三岗位全为出厂角色（审批只认代码锚，记录被忽略）＋探针 KL-4 限三角色 ⇒ 原 V3 结构性不可能：
    改任一内容件必触发 `E_FACTORY_ANCHOR_MISMATCH` ⇒ 审批 unverified ⇒ fail-closed 全拒，
    不可能"只少一条"。产品行为正确（#1075 P2-1 审批门），红在判据。
  - DSH rc.5："每条验收路径能拒绝非法输入"——新断言能拒绝"改坏仍放行"的 fail-open 形态。
- **证据**:
  - `bash scripts/control-tower/fixtures/k12-05-behavioral.sh` ⇒ 退出码=0；COVERAGE PASS=17
    （V2 差集、V3 审批感知＋零写痕、V4 同源对账、V5-A/B 自证伪、V6 条件==文件）
  - 反例：`K12_FIXTURE_BREAK=1`（不设 JWT_SECRET）⇒ register 500 ⇒ 退出码=2、FIXTURE_RESULT=FAIL
- **回滚**: 还原探针单文件＋删夹具＋还原登记件 acceptance 行（无产品改动）。
- **边界**: 夹具只写 `mktemp -d`；不改 content-registry/auth/产品代码。
