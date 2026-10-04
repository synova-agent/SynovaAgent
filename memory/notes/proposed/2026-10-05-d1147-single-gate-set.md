# D1147 · 单套门禁（批2）：windows 腿降级为顾问信号 + 必需 context 12→9→10

- **状态**: proposed
- **日期**: 2026-10-05
- **背景**: 批2「单套门禁」——Mac/Win 都用 DSH ⇒ 门禁只维护一套。实测病根不是"windows 腿多余"，
  而是它**承载必需 context**：control-tower windows 腿中位数 106min（vs ubuntu 14min），平台抖动即卡死
  整条 PR 队列；同时 `Gate Integrity (…)` 这个真会红的三态门禁不在必需集，`npm audit` 这个双层豁免的
  恒绿项却在必需集（"必需"二字被贬值）。task-2 正文的三处数字互相矛盾（12→7 / 12→12 / 非必需），
  以步骤 1 的机器判据（「windows 两腿在非 scripts PR 上不出现」）为唯一可执行口径定案 ⇒ 12 → 9 → 10。
- **决定**:
  1. **windows 腿 = 顾问信号**（三条约束）：① 路径触发（仅 `scripts/**`|`tests/**` 变更才创建 job，
     fail-safe 绝不误跳）② 非必需（两个 context 名不得再进必需集）③ **恒 success**（失败经
     step `outcome` 检查 + `::error` 注解 + `::warning` 上看板）。
  2. **必需集两步走**：步骤 1（已 PATCH，12→9）= 移出 `npm audit` + 两条 windows；
     步骤 2（待 #948 处理，9→10）= 加入 `Gate Integrity (…)`。两步的正当性：注册表是 **live 镜像**，
     先 PATCH 后重放生成命令，镜像才不撒谎。
  3. **跨机制发现**（本卡实测，非推测）：「非必需但会红」是陷阱——C 段棘轮
     `check-gate-integrity.sh run_ci_reds`（L676+）统计 base commit 上**全部** `conclusion == failure`
     的 check-run（不问是否必需）⇒ 顾问红会经棘轮把**已入必需的 Gate Integrity** 拖红 ⇒ 变相全局阻断。
     故 ③ 是本卡的**必要**约束，不是风格选择。根治（C 段排除非必需 context）属判据变更 → K3，另卡。
  4. **本地提交端 = 「明确降级为旁路」**：裸 `git commit` 恒 exit 0（记账 `gate-soft-warnings.log`），
     官方路径 `synova-commit` 硬阻断。代价：裸路径缺陷最早在 CI 被拦（+1 push/CI 轮）+ 软告警累积风险；
     获偿：不再重演 V4.5.1「本地太挡 ⇒ `--no-verify` 泛滥 ⇒ 门禁形同虚设」。
- **考虑过的其他方案**:
  - 「windows 腿留在矩阵里、步骤级路径跳过」：不选——check-run 照样产出，达不到"非 scripts PR 不出现"，
    且 job 仍占 runner；更关键的是**保留必需 = 永久 blocked 或恒绿纸老虎**，二者都坏。
  - 「windows 腿留必需 + `continue-on-error`」：不选——同上，把"必需"变成永不生效的标签。
  - 「单独 workflow 文件 + `on.pull_request.paths:`」：不选——多一份 workflow 的真源与并发/事件面
    （merge_group/schedule），且 [R] 密封清单登记按 ci.yml 全文判定，收益不抵风险。
- **例外（写集外 3 个 sealed 夹具，全部机器强制、随本 PR 送 K3/CTO 过审）**:
  `tests/control-tower/ci-signal-classify.test.sh`（矩阵/timeout 钉子 + needs 登记，lead 已批）、
  `tests/control-tower/check-required-contexts.test.sh`（`12/12` 与 `npm audit` 金丝雀改为派生）、
  `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh`（fail-safe 计数口径**收紧**到 docs-only step 体内）。
- **相关 D#**: D1147（本卡）｜task-2。上游参考: D971（必需 context 消失 ⇒ 405）、D1112（needs 下游
  context 消失）、D954（未定态集合证明"无红" = 空转）、D1093/D526（密封清单须在 ci.yml 全文内）、
  D1039（按需跑判据 + 三条安全网）、D515/D516（本地软提示 + CI 权威）。
- **参考**: 第一性原理（门禁要"真拦得住 + 不拦不该拦的"）+ GitHub Actions 官方语义
  （job 级 `if:` ⇒ 不产 check-run；`needs:` 下游需显式 `if:`；step `continue-on-error` ⇒ job 结论 success）
  + `ctrl-tower-change` 模式 1（三态退出码）+ `squad-discipline`（声称↔证据、写集不重叠）
  ⇒ 结论：**降级为顾问信号 + 恒 success + 注解上看板，并同步把窗口 context 移出必需集**。
