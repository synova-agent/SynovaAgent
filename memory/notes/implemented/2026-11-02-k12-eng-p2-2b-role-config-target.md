# K12-ENG P2-2b：role-config 探针靶归一（#505 判 A）

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #195（K12-12）｜14 项批准 item 4（#505 判 A）
- **决策**: 探针靶从**从未存在的** `presets/grants` 目录改为**角色包实物**
  `extensions/presets/roles/<roleId>/{tenant/<tenantId>/}capabilities.yaml` 的 `permissionGrants` 段；
  V1–V6 语义随落点归一，逐条带 L1/L2：
  - V1 三角色包 `permissionGrants.grants` 非空（文件驱动）
  - V2 fail-closed：临时租户包写入未知项 ⇒ 引擎权限集**不含**未知项（白名单）
  - V3 审批留痕：`loadRolePacks()` 真读 approvalId=factory:*／scope；`approvedAt` 常量在场
  - V4 客户可改：临时副本加 grant ⇒ 引擎权限集变；仓库零写痕
  - V5 反例：去掉 `permissionGrants` ⇒ 权限集少项（不变=fail-open）
  - V6 与建档联通：生成器写角色包 `capabilities.yaml`（同落点，不另建通道）
- **理由**: #195 的 V1–V6 原靶是 `extensions/presets/grants/`（实测从未存在）⇒ 探针不可达；
  #468 决策 Note 第 4 条已定"客户矩阵=角色包 permissionGrants"。DSH rc.5：判据靶必须是真实载体。
- **证据**:
  - `probe-role-config --all` ⇒ 退出码=0、`COVERAGE: PASS=14`、`RESULT=PASS`
  - 配对测试 `tests/control-tower/probe-role-config.test.sh` ⇒ 10/0
  - V2/V4/V5 均在 `mkdtemp` 临时副本上真跑引擎（`@synova/engine-auth`），仓库零写痕
- **回滚**: 还原探针单文件＋删配对测试（无产品改动）。
- **边界**: 不改引擎、不改角色包、不改生成器（P2-2a 单独 PR）。
