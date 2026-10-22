# 审计发现台账（KIMI K3 独立审计）

> 用途：把 K3 审计发现固化为**开发过程迭代的关键素材**——改进控制塔 + 改进 Codex 的 dev doc 编写 skill。
> 维护：Codex（Win）+ DeepSeek Harness（Mac，DSH 相关发现，2026-08-15 创始人批准）在每次 K3 审计完成后更新本台账 + 登记仪表盘。
> 关联：[AUDIT-PROTOCOL](AUDIT-PROTOCOL.md) / [ROLES](ROLES.md) / 审计报告 `docs/synova/audit-reports/`

## 一、审计发现台账

| 日期 | D# | 级别 | 发现 | 根因（该拦的防线） | 修复 | 改进归属 |
|------|----|:---:|------|------------------|------|:---:|
| 08-12 | D328 | P1-1 | python 损坏 shim 时一致性门禁**静默漏拦**（2/6 败，物理复现） | fail-open 把"检查未执行"与"检查通过"压成同一 exit 0；`command -v` 只探存在性不探可用性 | D330（探测+三态） | 控制塔+skill |
| 08-12 | D328 | P1-2 | DS4 声称"四条豁免全部测试覆盖"，Revert/无暂存**无用例** | DS verify 不映射"声称项↔用例"（自报无法自证） | D330（补 2 用例+措辞） | skill |
| 08-12 | D328 | P1-3 | DS7 无物理证据（bypass.log 空窗，ea1cb71 落窗内） | bypass.log 无对账方，执行证据链断裂无人发现 | D331（对账） | 控制塔 |
| 08-12 | D329 | P1-1 | tag V4.7.1 指向**孤儿提交** f685fa0（版本锚点断裂） | 无 tag-祖先校验（amend 重提交后 tag 未跟随） | D331（重指+校验） | 控制塔 |
| 08-12 | D329 | P1-2 | dc369fd 无 bypass.log 记录（**同型缺口第二次**） | 对账机制未建立即再犯 = 防线系统性失效 | D331（对账强制） | 控制塔 |
| 08-12 | D329 | P2-1 | write-set 记录无 task_id（dev doc §3.1 声称过度） | 文档-实现漂移：声称"记录含 X"但未实现/未验收 | D331 | skill |
| 08-12 | D329 | P2-2 | resolver --session **零生产调用方**（机制建成未接线） | dev doc §5 接线验收写浅：没要求"生产调用点真实传递" | D331（接线+§5 升级） | skill |
| 08-12 | D329 | P2-5 | synova-commit:367 裸 python3 + `\|\| true` 吞失败（同文件刚修过 commit-msg） | PYBIN 未全局对齐；`\|\| true` 连崩溃都吞 | D331（升级 P1） | 控制塔 |
| 08-12 | D329 | P2 其他 | 测试无 runner 接线 / genuine except 无 degraded / brief 引用不存在文件 / DS6"同 commit"与 gitignore 矛盾 / DS9 verify --self-test 无效 | 多个"声称 vs 物理"小缺口 | D331 清理 | skill+控制塔 |
| 08-09/12 | Mac ba653c3 | P2 | engine-core 退役清理"grep 物理证明零引用"**声称不实**：tests/run-e2e-pipeline.cjs（死文件）残留 3 处 packages/engine-core 引用 | M2 声称 vs 事实（清理时 grep 范围漏 tests/*.cjs） | 待清理 chore | skill |
| 08-12 | Mac 清理 | — | 审计基线 439→**434**（78K 删除，-5 FAIL / -1 arch / -2 WARN）；admin-knowledge.ts:17 L1→L4 违规**仍在**（D309 待做） | 大规模删除改变基线契约 | 基线已更新（2026-08-12） | 控制塔 |
| 08-12 | D330/D331 并行 | P0 | **共享暂存区拉锯**：D331 re-add 抢占 → D330 被 D328 门禁拒绝 → 循环（防护在工作，暴露 D307 缺失） | git index 是 worktree 级单例；门禁仲裁替代物理隔离；依赖任务被并行派发 | D332（软加固）+ D307（根治） | 控制塔+skill |
| 08-12 | K3 权威偏差审计 | P0×1 | **N13 反馈→规则闭环断裂**（middle-evolution 零调用、feedback-collector 无消费方） | 写了没接线（M3 类） | D333（P0） | 产品 |
| 08-12 | K3 权威偏差审计 | P1×5 | direction-monitor 未接线 / loop-4 无专属处理器 / GA 仅 type import / 静默升级回滚未实现 / orgId 未全量验证 | 多为"机制建成未接线/口径滞后" | D334-D338 | 产品+文档 |
| 08-12 | K3 权威偏差审计 | 文档×2 | AGENTS.md 哨兵口径 20 vs 45+4；N14 去重窗口 5 vs 30 | 口径滞后（代码无缺陷） | D339（待创始人定 N14） | 文档 |
| 08-12 | K3 D330 复审 | P1×1 | **bypass.log 连续第三个任务无记录**（6c00e46/407ff1f）——防线失效本身，两次排队进 CT 无物理执行体发现 | 对账机制只在队列，无自动执行 | **升级 P0 流程事项：D331 check-bypass-log 立即执行（K3 已给最小实现 comm -23）** | 控制塔 |
| 08-12 | K3 D330 复审 | 技术事实 | broken-python3 + 可用 python 时门禁**仍不拦截**（resolver PYBIN 无探测先死）——D330 只"不静默"非"仍拦截" | resolver 硬化未含探测 | D331 折入（§2.6/DS13） | 控制塔 |
| 08-12 | K3 D330 复审 | P2×5 | resolver exit 1 二义 / 用例 10 标题矛盾 / DS8 基线 439（我已误写 434 已修）/ V4.7.3 幻影条目 / 测试无 runner | 文档-代码小漂移 + 版本编排副作用 | D331 折入 + 文档已修 | skill+控制塔 |
| 08-12 | K3 权威偏差 v1.1 | P1×5 | ①V5 视图硬编码旧 6 专家（D282 未传播，铁律 9 违规实例）；②gate-status.json 缺失（3/19 信号仅 3 文件）；③铁律 36 无全量 vitest 强制点；④铁律 37 无 dead-code 扫描（direction-monitor 存活 11 天）；⑤铁律 9 无传播检查 | 控制塔视图/信号/铁律门禁缺失 | D340-D342 | 控制塔 |
| 08-12 | K3 权威偏差 v1.1 | 改判 | D-G2"已修复"→"引擎已修复，数据链路未担保"（gate-status 缺失 + 快照 11 天 + 自检盲区）；组 11 并入组 4（12 组计数口径 → D3）；铁律 38 确认全仓扫描 | 复核深化 | 演示前 checklist + D339 | 控制塔+文档 |
| 08-14 | K3 全链路审计 | P0×3 / P1×5 / P2×6 | **Agent 核心能力全链路 FAIL（0/3 贯通）**：L5 无 CRM/财务/HR 连接器；L4 类型契约断裂（Market≠Client、People≠Person、Event/Tool 零写入方）+ 属性契约断裂（cashBalance≠cash）+ filter bug（compute-cash-runway-months.ts:60）；P0 哨兵阈值告警生产死代码（sentinel-loader 从不挂 manifest）；L4 查询层静默 fail-open（schema 漂移只 warn 返回空）。活运行证明 L3 计算能力本身是真的，断裂在数据进出两端 | L5 连接器缺失 + L4 契约失配 + manifest 死代码 + fail-open | D355-D360（见仪表盘） | 产品 |
| 08-15 | K3 D366 审计 | P1×3 / P2×5 | **CONDITIONAL PASS（无 P0）**：DS1-DS8 八项物理一致（newermt=0、4 处生产调用、无 rm、T1/T2 双侧 15/15+12/12 绿、写集 9/9、版本三同步），自报偏离 a-i 全部诚实。**T3 故障注入发现 2 个新引入边缘回归**：P1-1 git commit --amend 必触发 detected-bypass head-mismatch 误报（marker 记旧 commit、HEAD^ 恒不等，一次 amend=当日提交死锁，CT-29 同型）；P1-2 D 前缀 brief 被"今日集合"物理排除（today_files_by_prefix 只匹配 YYYY-MM-DD-*，D 前缀 session 提交代码文件被 G12 阻断，§2.3 记录两种命名但方案只覆盖一种）；P1-3 dev doc 从未进入实现分支树（契约链分岔）。项 13 CI pending DEGRADED | 判定语义层缺口（dev doc 引用 CT-28 却语义层重蹈覆辙） | D373 | 控制塔 |
| 08-16 | K3 D355 审计 | P1×1 / P2×2 | **CONDITIONAL PASS（无 P0）**：P0-2 写侧契约收敛（3 JSON 对齐读侧）+ P0-3 fail-open 修复物理成立（T1/T2 24/24 绿 + T3 三组故障注入：真实旧库自动迁移、视图异常抛错、只读库抛错均 fail-closed）。P1-1 **版本幻影**（commit 声称 V4.7.10，VERSION.md/version.log/tag 三处零同步，且序号落后 V4.8.0）；P2-1 dev doc 写集表未回填（实际 6 修改+3 新建 vs doc 写 4+3）；P2-2 schema-migration.ts 注释陈旧。**正面（L4 发现 3）**：D307 worktree 隔离生效——D355 与 D366/D373 同机并行零暂存区竞争，bypass 证据链首次归属到 worktree 级 | 版本编排 + S-6 回填未执行 | P1-1 补 VERSION.md 条目；P2 回填 | 控制塔+skill |
| 08-16 | K3 D363 审计 | P1×1 / P2×4 | **CONDITIONAL PASS（无 P0）**：failover 接线物理成立（17/17 双侧 + K3 真实网络注入：连接拒绝/HTTP 500/双死/healthCheck），CI job 级 API 核实零偏差，S-6 回填+决策记录到位（交付质量创系列新高）。P1-1 **stream 混流**（主 provider 中途断流→调用方收到主残余+备全文拼接，既有 chain 代码缺陷本次接线暴露）；P2-1 任务 ID D363 复用（5b78a1c 审计登记与本任务混同）；P2-2 bypass 证据滞留 worktree；P2-3 无版本编排；P2-4 LLMClient 路径（GA 诊断）failover 缺（接口不兼容 descope） | 既有 chain 缺陷暴露 + ID 分配无唯一性校验 | P1-1 stream 改"首 token 前才 failover"；P2-4 单独立项 | 产品+控制塔 |
| 08-17 | K3 D356 审计 | P1×2 / P2×3 | **CONDITIONAL PASS（无 P0）**：三目标缺陷（P0-1 manifest 挂载/P1-1 degraded 拦截/P1-3 入口校验）在其层全部物理成立（T1 11/11 + K3 T3 真实 loader 装配复现；CI 8/8 job 级全绿）。**但结论边界须如实限定**：T3-4 生产语义 mock 下 cash-runway 阈值 critical 仍不可达——compute 过滤器 bug（compute-cash-runway-months.ts:60）是 P0-2 存量（descope 至 D355/D358），D356 真实价值=「静默死代码→诚实可见降级」非「生产能报真警」。P1-1 端到端测试 mock 忽略 filters 掩盖生产不可达；P1-2 dev doc+brief 未入库（untracked 仅存）+ 一任务两 dev doc 并存（旧线 DSH- 前缀 bc552aa） | mock 语义保真度缺失 + 契约文档入库无硬要求 + 旧线未退役 | P1-1 mock 真实执行 filters；P1-2 补入库 + 旧线退役；P2-2/P2-3 dev doc 微修 | 控制塔+skill |
| 09-17 | D803 自发现（CTO 指令⑤） | P2 | **铁律 38 门禁盲区：`tests/` 完全不设防**。实测 `scripts/pre-commit-check.sh:735` `STAGED_ALL_FILES=$(echo "$GIT_CACHED_ALL_NAMES" \| grep -E '^(src\|packages)/.*\.ts$' \| grep -v '\.test\.')`——组 1 类型安全扫描范围只含 `src/`+`packages/`，且**显式排除 `*.test.ts`**。实证：D803 在 `tests/contract/l4-contract.test.ts` 新增 2 处 `as unknown as GraphStoreReader`（:328/:352），**全部门禁零告警**，靠人工复核才发现；同一提交里 `src/` 侧 `as unknown as` 会立刻被组 1 硬阻断。AGENTS.md/CLAUDE.md 均写「`as never`/`as unknown as` 零容忍」，**文档口径与门禁作用域不一致**（文档全覆盖 vs 门禁仅 src/+packages/） | 「文档写零容忍」≠「门禁覆盖全仓」：铁律 38 的执行体从未扩到 tests/，而 tests/ 是本仓新增代码量最大的目录之一 | **本卡已自清**（2 处改为显式 `GraphStoreReader` 标注，`grep -c "as unknown as"` 仅剩既有 :40 logger mock）；**门禁扩域待 CTO**（扩 `tests/` 需先清存量，否则棘轮全红） | 控制塔 |
| 09-17 | D803 自发现 | P2 | **D366 三判未覆盖 `git cherry-pick` 重放 → `detected-bypass head-mismatch` 误报**（当日 2 条）。D803 用 `git cherry-pick` 把已过 synova-commit 的提交重放到单域分支，replay 后新 commit 的 parent 链与原 marker 无祖先关系 → post-commit（`scripts/hooks/post-commit.sh:113`）三判全不满足 → 写 detected-bypass → `pre-commit-check.sh:242` 计数命中 → Gatekeeper 熔断当日后续合法提交。同型先例：D366 P1-1（`git commit --amend` 必触发同一误报，台账 08-15 行）。**判定语义缺口第二次复现** | 三判（HEAD^ / HEAD^^ / is-ancestor）只覆盖普通 commit / amend / 并发覆盖，未覆盖「重放提交」（cherry-pick / rebase 已记录在台账却仍复现——防线未落地） | 建议补第 4 判：marker head 的 patch-id 或 commit-tree 指纹命中分支内任一提交即放行；本次按门禁自带逃生舱 `SYNO_GATEKEEPER_ACK=1` 人工确认 + D331 明文允许的「一次性补记」（标注 `cherry-pick 补记`） | 控制塔 |

## 二、模式归纳（跨审计复现的根因类）

| # | 模式 | 首次 | 再次 | 对应防线 |
|---|------|------|------|---------|
| M1 | **fail-open 静默失效**（检查未执行==检查通过） | D328 P1-1 | D329 P2-5（`\|\| true`） | 三态输出（pass/degraded/fail） |
| M2 | **声称 vs 事实**（doc/报告 overclaim） | D328 P1-2 | D329 P2-1（task_id）、Mac ba653c3（零引用声称） | DS verify 覆盖映射；写集声称=实现+验收 |
| M3 | **机制建成未接线**（WIRE CHECK 失败） | D329 P2-2 | — | 接线要求"生产调用点真实传递"（测试不计） |
| M4 | **执行证据链断裂**（bypass.log） | D328 P1-3 | D329 P1-2（第二次） | git log vs bypass.log 对账 |
| M5 | **环境依赖门禁**（python3/broken shim） | D328 P1-1 | D329 P2-5 | PYBIN 全局 + 可用性探测 |
| M6 | **版本锚点断裂**（tag 孤儿） | D329 P1-1 | — | tag-祖先校验（pre-push/CI） |
| M7 | **文档-实现漂移**（dev doc 未回填/声称未实现） | D329 P2-1 | — | dev doc 与最终实现同 commit 回填 |
| M8 | **共享暂存区竞争**（并行 session 共用 worktree index） | D330/D331（08-12） | — | worktree 隔离（D307）+ staging-guard 指引/事件记录（D332） |

## 三、控制塔改进队列（CT）

| # | 项 | 来源 | 状态 |
|---|-----|------|------|
| CT-1 | fail-open 三态（gate 输出区分 pass/degraded/fail） | M1 | ⏳ 健康审计队列（D330 只做 commit-msg 局部） |
| CT-2 | WIRE CHECK 升级（≥1 生产调用点，测试不计） | M3 | ⏳ 健康审计队列（D331 §5 局部落地） |
| CT-3 | bypass.log 对账（post-commit + 定期/CI） | M4 | 🔄 D331 折入 |
| CT-4 | tag-祖先校验（pre-push） | M6 | 🔄 D331 折入 |
| CT-5 | PYBIN 全局对齐（全 scripts 裸 python3 清零） | M5 | 🔄 D331 折入（synova-commit）+ 剩余点待扫 |
| CT-6 | CI job 级判定（生成器假红） | D320 审计 | ⏳ 未排 |
| CT-7 | pre-commit 性能/双重执行 | D319 报告 | ⏳ 未排 |
| CT-8 | baseline-check.test.sh 3 失败 | D318 报告 | ⏳ 未排 |
| CT-9 | 10 个 .sh UTF-8 头块 | D318 报告 | ⏳ 未排 |
| CT-10 | staging-guard 被拒带指引（活跃 session/归属/建议） | M8 | 🔄 D332 折入 |
| CT-11 | attach.py SessionStart 强制 register session | M8 | 🔄 D332 折入 |
| CT-12 | wait_manager 暂存区竞争检测/提示 | M8 | 🔄 D332 折入 |
| CT-13 | 提交被拒事件记录（parallel-conflicts.log） | M8 | 🔄 D332 折入 |
| CT-14 | 审计协议 L3 加"并行合规"检查项 | M8 | ✅ 已入 AUDIT-PROTOCOL（2026-08-12） |
| CT-15 | worktree 隔离落地（D307：独立 index/暂存区/current-brief + worktree-manager 生命周期） | M8 根因 | 🔄 D307 dev doc 就绪（2026-08-12，V4.8.0）— 待派发 |
| CT-16 | 进化闭环接线（N13/middle-evolution 零调用） | K3 权威偏差 P0-A1 | 🔄 D333（P0）待写 dev doc |
| CT-17 | **bypass 对账物理执行**（防"队列无执行体"——连续 3 任务无记录） | K3 D330 复审 P1 | 🔄 D331 check-bypass-log（升级 P0 优先级） |
| CT-18 | resolver PYBIN 可用性探测 + 退出码 0/1/2 语义化 | K3 D330 复审 | 🔄 D331 折入（§2.6/DS13） |
| CT-19 | 控制塔 V5 视图动态化（agent_health 读 expert-registry） | v1.1 P1-B1 | 🔄 D340 |
| CT-20 | 控制塔信号完整性（gate-status 回填 + 自检部分缺失升级） | v1.1 P1-B2 | 🔄 D341 |
| CT-21 | 铁律 36/37/9 门禁补全 | v1.1 P1-B3~B5 | 🔄 D342 |
| CT-22 | P2 结转治理（测试 runner 接线 / 用例标题 / brief 引用 / genuine degraded）——3 审计连续 carried，禁再 carry | 多份 | ⏳ 控制塔健康审计批次 |
| CT-23 | DS 对账机制（交付声明 vs dev doc DS 一一对应，禁重编号，缺项显式 descope） | K3 D331 L4 | 🔄 S-10 已入 skill；门禁化待健康审计 |
| CT-24 | resolver 硬化交付（DS13：PYBIN 可用性探测 + 退出码 0/1/2） | K3 D331 P1-1 | 🔄 D352 |
| 演示前 | D-G2 数据链路动作（回填信号 + 刷快照 + 验红灯） | v1.1 改判 | 🔄 并入 D341 |
| CT-25 | 循环执行体真实化（loop-2/3/4/5/6 placeholder 假成功 → 真实执行 + 修假 completed + middle-evolution 接入） | v2 P0-A1/P1-C2 | 🔄 D333（P0） |
| CT-26 | 铁律 38 扫描范围扩至 packages/（as any 清理或声称降级） | v2 P1-C1 | 🔄 D353 |
| CT-27 | N14 去重键稳定（finding.id 去时间戳） | v2 N14 | 🔄 D354 |
| CT-28 | **verify-parallel --scan-today 语义缺陷**（L135-146 只按当天 mtime 圈 doc 两两比对，不理解「依赖/接力顺序」——D332/D307 与 D331 写集重叠被误判并行冲突硬阻断；自愈=离开当天范围即放行。K3 审计仅验「门禁 5 存在+接线」，未覆盖判定语义=控制塔语义审计盲区） | 2026-08-13 并行拦截复盘（K3 盲区，本机发现） | 🔧 建议并入 D332 写集或新建补丁 |
| CT-29 | **pre-commit marker 并发缺陷**：post-commit 靠全局单例 `.claude/last-precommit-success` 检测 --no-verify 绕过，多 session 并发时一个 session 的 post-commit `rm` 掉 marker，导致另一个 session 的正常提交被误判 `detected-bypass no-precommit-marker`，反过来触发 GATEKEEPER 硬阻断所有提交（2026-08-14 文档拉平 D362 死锁实证）。修复方向：per-session marker 或按 commit hash 对账，替代单文件时间戳 | 2026-08-14 D362 文档拉平死锁 | 🔧 建议新建补丁（D363+） |
| CT-30 | **Secrets 门禁 .env 过拦**：check-secrets.sh 全工作区扫描 + 本地 .env 检查把 gitignored 未跟踪的 .env（本地密钥库，产品运行依赖真实密钥的正常状态）当违规硬阻断 → 2026-08-14 23:04 .env 写入真实密钥起**所有提交被误拦**（上一 session WIP 卡死实证）。修复（D370）：未跟踪 .env 豁免；被 git 跟踪/被暂存 .env 仍阻断（泄漏路径不变）。测试 tests/control-tower/secrets-env-exempt.test.sh 7 用例 | 2026-08-15 D370 门禁自检发现 | ✅ D370 已修 |
| CT-31 | **hook 测试缺 git 操作矩阵维度**：改动 hook 判定逻辑的交付，测试必须枚举"git 操作 × marker 状态"矩阵（至少普通/amend/reset 重提 × 匹配/不匹配/缺失/陈旧）——amend 场景打破"一次 pre-commit 对应一次全新 parent"假设，D366 只枚举了 marker 内容维度漏了操作维度 | K3 D366 审计 L4 发现 1（P1-1） | 🔧 并入 D373 + S 队列 |
| CT-32 | **判定语义变更缺"新旧过滤器等价集对账"DS**：判定类门禁的语义变更，DS 必须含新旧逻辑等价集对账（真实目录跑新旧过滤器，输出集合 diff 为空或逐项豁免）——D366 改了 mtime→文件名日期，但 DS 只验"newermt 清零+调用数"，没验"新旧今日集合等价"，导致 D 前缀 brief 语义回归（dev doc 引用 CT-28 却语义层重蹈覆辙） | K3 D366 审计 L4 发现 2（P1-2） | 🔧 并入 D373 + S 队列 |
| CT-33 | **分支与 brief 无对账**：G12 skip_re 豁免 docs/ 使文档类越界提交对 scope 门禁不可见（分支污染）；brief 头部"分支"字段从不与 `git branch --show-current` 对账（死文本）——commit 时 brief 声明分支与当前分支对账，或删除该字段 | K3 D366 审计 L4 发现 3（P2-5） | 🔧 并入 D373 或健康审计批次 |
| CT-34 | **文档提交豁免严格门禁（只保留 Secrets 扫描）**：文档（docs/、.claude/task-briefs/、memory/ 等）提交仅为跨机器（Mac/未来同事）同步信息，不应与代码同跑 13 组严格门禁。现状卡点（实证）：①组 6 时间戳顺序（before-brief 残留）不区分文档/代码，文档提交被误拦（D362 文档拉平 + D366 审计登记反复卡）；②G12b brief 可解析性对暂存 brief 触发；③task brief/Q2 范围/测试/接线/架构/契约对纯文档无意义。豁免：12 组（task brief + Q2 范围 + 时间戳 + 测试 + 接线 + 架构 + 契约 + 类型 + 文件驱动 + CP3 + scope + 技能）；保留：**Secrets 扫描**（文档同样泄密，D312 settings.json token 实证）。文档"真实性"不靠 pre-commit，靠 K3 审计兜底（声称 vs 事实复核）。归属：门禁脚本 scripts/pre-commit-check.sh 是 DSH 地盘，由 DSH 实现 | 2026-08-16 创始人决策 + D362/D366 文档提交反复卡门禁实证 | 🔧 DSH 排期（新 D#） |
| CT-35 | **版本号幻影门禁**：commit message 携带 `Vx.y.z` 时，同 commit 必须含 VERSION.md 对应条目变更（未落库版本号不得出现在消息）；铁律"版本只增不减"加序号方向校验（新条目不得落后于现存顶端）。D355 P1-1 实证（声称 V4.7.10 但三处零同步且落后 V4.8.0） | K3 D355 审计 L4 发现 1 | 🔧 门禁脚本（DSH 地盘） |
| CT-36 | **故障注入测试缺"失败时间点"维度**：stream/分页/批量类接口的降级测试必须覆盖"部分数据已交付后失败"场景（首 token 前/后/onComplete 前）；failover 语义（重试=内容重来）需在契约层显式定义"混流是否可接受"。D363 P1-1 实证（stream 混流） | K3 D363 审计 L4 发现 1 | 🔧 并入 S 队列（dev doc skill） |
| CT-37 | **能力存在性判定的近义词簇 grep**：K3 审计协议增补——能力存在性判定前，grep 关键词必须含近义词簇（failover\|chain\|circuit\|retry\|切换\|降级）；"零生产调用方的已实现能力"单独立项为"建成未接线"（铁律 37），不得并入"不存在"。D363 实证（K3 用 fallback 单关键词误判 failover 不存在，实为建成未接线） | K3 D363 审计 L4 发现 2（审计侧收割） | 🔧 K3 审计协议 |
| CT-38 | **任务 ID 唯一性校验**：注册新 ID 前 grep 既有 brief/提交/bypass.log 是否已占用（防 ID 复用）。D363 P2-1 实证（5b78a1c 审计登记与本任务共用 D363） | K3 D363 审计 L4 发现 3 | 🔧 任务 ID 分配处 |
| CT-48 | **门禁中文文件名盲区（core.quotepath）**：git ls-files 默认把中文路径转八进制转义（`\346\226\275...`），门禁脚本 `grep '\.md$'` 匹配不上转义后的行 → **中文命名的文档从未被门禁检查到**（K3 的 DOC-0114/0115/0116 三份中文名文档"隐形通过"实证）。修法：脚本改 `git -c core.quotepath=false ls-files`。与 K3 审计标准"中文变量边界"担心的场景吻合 | 2026-08-20 K3 任务卡交付顺带发现（非其文档引起） | 🔧 DSH 架构线（门禁脚本）；修复后中文名文档须补检 |
| CT-63 | **编号体系盲区三连撞（D551→D559→D600 实证，2026-09-08）**：Claude/Codex 线任务用 D# 但不在 task-state 登记（D598=PR #427、D599=docs/feat 在途、D600=PR #434），alloc-task-id 只看 task-state + worktree → 连续重发被占号码，CTO 改号两次（D600→D601）。**修复方向**：alloc 占用表并入 docs/plans/codex/implementation/SYNOVA-IMPL-D*/ 目录名 D# + 远程分支名 `(feat\|fix\|docs\|chore)/d?\d+` 扫描；或强制 Codex 线同步登记 task-state | 2026-09-08 D600 撞号实证（PR #434 vs D600 登记） | 🔧 DSH 控制塔（alloc-task-id.sh，D576 盲区延续） |
| CT-64 | **check-architecture.sh 四类漏网形态 → 68 处 runtime 跨层违规假绿（2026-09-08 扫描实证）**：①动态 import 全逃逸（只 grep `from.*路径`，42 处动态 runtime 不可见）②按名字豁免恰中违规文件（agent-observer/ga-annotations 整行 grep -v，恰是违规重灾区）③路径形态不匹配（expert-platform/store/l5/engine-context/sqlite-graph-store 无模式；只扫 src/routes/+server.ts，mcp/tui/cli/l1 全盲区）④本地 soft 提示 + grep 链尾 `\|\| true` 吞检查自身失败（M1 fail-open）。全量清单+修补方案见 docs/synova/research/L1跨层违规扫描-20260908.md §一/§四 | 2026-09-08 D601 L1 跨层扫描 | 🔧 DSH 控制塔另案派单（先修脚本→分批修 src/，避免一次性 68 处全红压垮编码线） |
| CT-65 | **M8 新变体：共享主树跨 session 分支互踩（ed38508d 实证，2026-09-08）**：dev-doc 线 session 在主工作树 commit `docs(D593)`，落在 CTO 刚 checkout 的 chore/d601-state-update 分支上（parent=95e1c9fa），且该提交无 COMMITTED 登记 → D331 对账拦推 + 我的分支被迫含他人提交。D537 拦"多 session 主树提交"但拦不住"他人提交进入我分支"的静默污染。**修复方向**：session 开工强制绑定分支（写集登记含 branch 字段 + 提交前 branch 对账，CT-33 同类）；dev-doc 线补 synova-commit 路径 | 2026-09-08 ed38508d 实证 + D331 一次性补记 | 🔧 DSH 控制塔 + dev-doc 线流程 |
| CT-70 | **`tests/project/**` 从未被任何 CI/脚本接线 → 测试写了没人跑（D811 实证，2026-09-20）**：`.github/workflows/ci.yml` 的 `Control Tower Gate Tests` job 是**显式文件清单**（`tests/control-tower/*.test.sh` + `tests/doc-system/*.test.sh`），全仓 grep `tests/project` 只命中 `.github/CODEOWNERS:38`（`tests/project/**`）—— 即 **D795 的 `gen-project-board.test.sh` 与 D811 的 `pr-queue-scan.test.sh` 都只靠人/K3 手动跑**。这正是本项目已复发多次的 M3「机制建成未接线」在**测试层**的形态：测试存在、pre-commit 组 2 只查「配对存在」，不查「有人在跑」。**修复方向**：① ci.yml 清单改 glob（`tests/**/*.test.sh`）或加 `tests/project/*.test.sh`；② 或 pre-commit 组 2 增「新增 *.test.sh 必须被某 workflow/脚本引用」检查（fail-closed） | 2026-09-20 D811 CI 复核时发现（本 PR CI 全绿但未跑该测试） | 🔧 DSH 控制塔 + CI（另起卡；本卡写集不含 .github/） |
| CT-71 | **G12d「生成物单点生成门禁」是虚设门禁（fail-open，D850 自验实测，2026-09-20）**：`git diff --cached --name-status` 的输出形态是 `M<TAB>path`，而脚本取 `${line:3}` —— **多切 1 个字符**（应为 `${line:2}`），于是 `docs/synova/product-lines/product-progress.json` 被解析成 `ocs/synova/…`，与 `GENERATED_FILES` 永不相等 → **该门禁从未拦截过任何一次生成物提交，恒报 ✅**。CTO 独立复现：`M\tdocs/… → 'ocs/…'`（不命中）；修正后命中。同族 **CT-64**（fail-open 门禁）。**修复方向**：`${line:2}` 或改 `--name-only`；并补「反例测试」——故意暂存一个 `GENERATED_FILES` 里的文件，断言门禁**必须红** | 2026-09-20 D850 编码 A 自验发现 + 队长独立复现 | 🔧 DSH 控制塔（`scripts/pre-commit-check.sh` G12d 段）；**同类第二次 → 已升级创始人知悉** |
| CT-72 | **`task-start.sh` 生成的 brief 无日期前缀 → G12 认领窗口漏判（D850 实测，2026-09-20）**：`TASK_ID=D850` 时 brief 名为 `D850.md`（无 `YYYY-MM-DD-` 前缀），而 G12 的「今日 brief」日期窗口按文件名取日期 → 认领集不含它 → 实测 **2 个文件被误判「不在 Q2 范围」**，执行方被迫改名才通过。**修复方向**：task-start 命名统一带日期前缀；G12 认领集取日期时同时兼容无前缀形态 | 2026-09-20 D850 执行中实测 | 🔧 DSH 控制塔（`scripts/workflow/task-start.sh` + pre-commit G12 段） |
| CT-73 | **控制塔测试写真实仓库 + 环境敏感假红（D850 自验实测，2026-09-20）**：① `tests/control-tower/product-lines.test.py` 的 `TestRefreshAll.test_end_to_end` 会跑 `refresh-all.sh` → `run-machine-evidence.sh` **往真实仓库写证据文件**（命名 `<type>-<date>.json`，不带任务号 → 违小队固化件 M5「证据文件必须按任务号命名」）；② 该测试在**无 `.git` / shallow** 环境下报「派生件陈旧」这类**误导性结论**（真因是 freshness gate 无 git，实测 `live_unverified 32→54 / stale 36→14`；移除 `.git` 后 `PASS=10 FAIL=2`）。`ci.yml` 多个 job 是默认 `fetch-depth: 1` → 接入即可能假红（D520 同类历史）。**修复方向**：证据写入落 `mktemp` 或加 D# 前缀；测试在无 git 时**显式 skip + 打印原因**，不报业务结论 | 2026-09-20 D850 独立自验员实测（V-11/V-13） | 🔧 tests/control-tower 域 + 接入 CI 的卡（D854/CT-70） |
| CT-74 | **「取消整体完成度百分比」只落一半（D850 写集外发现，2026-09-20）**：创始人签字的「取消总完成度百分比」在本仓度量链已落地，但**控制塔域两处面板仍渲染「总完成度」**：`app/founder-dashboard.html:126-127`（静态 `0.0%`，由 `scripts/control-tower/generate-dashboard.py:775` 生成，且在 pre-commit `GENERATED_FILES` 名单内）＋ `scripts/control-tower/views/pm_dashboard.py:109-110`（动态 `{overall:.1f}%`，源 `completion.systemScore`）。D850 写集禁碰 `scripts/control-tower/**`（D846-D848 地盘）→ 未越界，登记待另起卡 | 2026-09-20 D850 独立自验员实测 + 队长核实 | 🔧 控制塔域另起卡（须创始人授权改盘点位） |
| CT-75 | **win 域消费方读已删百分比字段 → 存在「口径复活」路径（D850 跨域发现，2026-09-20）**：`dsh/plugins/synova-dashboards/lib/collect.js:119`（`?? 0` → **静默变 0**）、**`lib/client.js:545-546` 有 `pct1()` fallback → 客户端自行算回百分比（口径在该面板复活）**、`dsh/plugins/task-board-adapter/scripts/derive-board-sources.py:292`（→ `None`）、`lib/sync.js:341/366`（渲染 `%`）＋对应测试。D850 已在派生件 `deprecated_fields` 与 `calc-progress.py:35,621-624` 显式登记（禁沉默已满足）；跨域合并会破单域门禁 → 另起 FIX 卡 | 2026-09-20 D850 编码 A 自验 + 独立自验员复核 | 🔧 win 线（dsh/plugins + 其测试） |
| CT-76 | **「可复现命令」断言了存在、没断言新鲜 → 陈旧中间件下假绿（D850 第三轮复验发现，2026-09-20）**：D850 的每条 `evidence_cmd` = 「件级源侧重算产物（`/tmp/ro-pp.json`）该档 vs 提交件该档」比对。缺失时 **fail-closed**（203/203 rc=1，独立自验员从零实测）；但中间件**存在且陈旧**时该档**假绿**——实测三步：①干净态 regenerate（`wired_broken=4` rc=0）②改源（k3 点 2-1 pass→fail）**不重生成** ③跑 evidence_cmd → **rc=0 输出 `wired_broken=4`**（漏掉源侧漂移）。文档两步走与 CI 路径（组①自行重生成）都不触发；危险窗口 = 复用 `/tmp` 残留件。**修复方向**：evidence_cmd 前置校验中间件 mtime/内嵌 `generated_at` 比被比对件新，或校验内嵌**源指纹**（yaml + evidence 清单 sha256）与当前源一致 → 不一致即 `STALE/FAIL-CLOSED`（不建议把两步绑成一条命令，会失去摊薄收益） | 2026-09-20 D850 第三轮独立复验（V-16） | 🔧 另起 FIX 卡（度量链：`calc-progress.py` evidence_cmd 生成段） |
| CT-77 | **独立判据的「强度」未分层：bound 型在基线上恒真（D850 第三轮复验发现，2026-09-20）**：D850 线级补了独立判据，但实测强度分层——`bound×28` 只是**必要条件上界**（28 线 healthy 全 0 时**恒真**，抓不到低估/漏点，只能抓高估）；`reconciliation×28` 是两源对账（提交件侧必然读提交件，强度低于等值复现）；**顶层仅 1 条等值型**。覆盖 = 线级 56/196；线级 `missing` 28 档无 probe、线级 `other_states` 112 档无独立判据。**修复方向**：①线级 healthy 补等值型判据或改**区间断言**（`lower ≤ healthy ≤ upper`）②线级 missing 补 probe 或显式声明「沿用顶层 probe 同一理由」③把「判据强度」写进 `cmd_semantics`（equality > reconciliation > bound） | 2026-09-20 D850 第三轮独立复验（V-17/ⓒ） | 🔧 另起 FIX 卡（度量链 + 测试域） |
| CT-69 | **`check-pr-budget.sh --files` 注入模式对非 ASCII 路径误判跨域（D811 实测，2026-09-20）**：把含中文名的写集经 shell 传入 `--files` 时，git 侧的八进制转义（`\351\230\237...`）被当作路径解析 → `check-ownership.py` 把这些文件判成 `win` 域 → 报「变更跨域」FAIL（实测 11 文件里 2 个中文名文件被误判）。**同一写集用真实暂存集跑则 PASS**（`git -c core.quotepath=false diff --cached --name-only` → 8 mac + 3 domain-neutral）。与 CT-48 同族（core.quotepath 盲区）。**修复方向**：`--files` 入参先做 quotepath 解码，或改用 `--staged` 从 git 直接取集 | 2026-09-20 D811 自过门禁时实测（非阻断项，本地 pre-commit 的 D734 走真实 diff） | 🔧 DSH 控制塔（check-pr-budget.sh / check-ownership.py 入参解码） |
| CT-67 | **测试断言硬编码 live 数据 → 存量假红（D811 发现，2026-09-20）**：`tests/project/gen-project-board.test.sh` 组⑥「真实仓库冒烟」把 `backlog_points=36`、`v1_passed=22` 等**具体数值**写死，仓库数据一变即红（实测现为 46 / 26）。**A/B 对照已证明与本任务无关**：`git show origin/main:scripts/project/gen-project-board.py` 与工作区版跑同一仓库（`--repo-root /Users/wane/SynovaAgent`），`totals` 逐键相等（v1_total=128 / v1_passed=26 / backlog_points=46 / delivery_pct=20.3）。**修复方向**：冒烟组只断言不变量（`v1_total > 0`、`v1_passed ≤ v1_total`、`0 ≤ delivery_pct ≤ 100`），具体数值留给密封夹具组 | 2026-09-20 D811 执行中实测（非本任务引入，已 A/B 对照排除） | 🔧 另起 FIX 卡（tests/project 域） |
| CT-68 | **派单/规格件未落 main 即被引用 → 执行方按路径取件必失败（D811 发现，2026-09-20）**：任务 D811 的派单件 `docs/synova/coordination/小队派单-D811-队列收口-20260920.md` 在 main 上**不存在**（只存在于 `chore/dispatch-d811` @ `5110188f` / PR #664 未合），且件内相对链接 `../skills/dsh-decision-lens/SKILL.md` 指向不存在的路径（实际在 `.synova/skills/dsh-decision-lens/`，且该 skill 也只在未合分支 PR #663 上）。执行方若按"派单件路径"开工，第一步就会取件失败。**防复发**：派单前 `git ls-tree origin/main -- <路径>` 实测存在性；未落 main 的规格件应在派单正文内联关键内容（本卡已内联）| 2026-09-20 D811 开工前核行（`git show 5110188f:...` 命中，`git ls-files` 零命中） | 🔧 CTO 派单流程（pre-dispatch-check 增"引用的规格件在 origin/main 存在"一项） |
| CT-66 | **squash merge 打断 bypass 登记 marker 父链 → detected-bypass head-mismatch 误报（2026-09-08 实证）**：squash 合并后，分支上的"bypass COMMITTED 登记"提交（marker=旧分支 hash，parent 链在主线上断裂）被 post-merge 检测判为 possible-bypass → 当日 Gatekeeper 熔断后续合法提交，需 SYNO_GATEKEEPER_ACK=1 人工放行（degraded-events.log 已留痕）。同族：CT-45（merge 提交 marker 缺失误伤）。**修复方向**：head-mismatch 判定豁免 squash/merge 来源的 marker 提交（D451 纯补记豁免同族扩展） | 2026-09-08 D601 簿记提交被熔断实证（23:15/23:20 BLOCKED 两条） | 🔧 DSH 控制塔（post-commit bypass 检测 + gatekeeper） |
| CT-47 | **bypass.log 多 PR 合并冲突（append-only 被跟踪）**：`.claude/bypass.log` 是被 git 跟踪的 append-only 证据日志，每个 session 的 synova-commit 都追加记录 → 多 PR 合并时各分支都改它 → 每次合并必冲突（D357 #55 + D354 #59 实证）。修复方向：① `.gitattributes` 给 bypass.log 配 `merge=union` 驱动（自动保留双方）；② 或改运行时产物不跟踪（但会破坏 D331 对账）；③ 或 synova-commit 不再把 bypass.log 作为写集提交。**建议 DSH 定方案** | 2026-08-20 多 PR 合并冲突实证 | 🔧 DSH 地盘（git 属性/门禁） |
| CT-46 | **gh 凭据失效（Claude Code 环境）**：D354 交付时 Claude Code 侧 gh pr create 401，PR 无法自动建——Codex 侧 gh 凭据正常，已由 Codex 补建 PR #59 | D354 交付报告 | ✅ 已由 Codex 补建 PR #59（Claude Code 侧 401 根因待查） |
| CT-45 | **calc-progress.py:69 SIX_STATES 无 deferred 态**：D357 引入的 3 个 deferred 种子（status: deferred）不在 SIX_STATES 状态机内 → 落 problems 警告、渲染为 uncommitted（exit 0 不破 CI，但 deferred 语义丢失） | D357 交付报告（附带发现） | 🔧 DSH 地盘，加第 7 态 deferred |
| CT-46 | **desktop-build 双平台 CI 调试时间黑洞（D529 实证，2026-08-25）**：C1 条件项（desktop-build CI 修复）耗时 2.5+ 小时、5-6 轮 CI 盲猜循环。根因链：① @electron/rebuild -f -w better-sqlite3 在 CI 上**挂起 10 分钟超时无输出**（step log 空，::error:: 抓不到内容）→ 每轮盲猜 15-20 分钟（electron-builder 双平台构建慢）② 双平台连环坑（node-gyp 版本/VS2026 → bcrypt N-API → npmRebuild → publish → 挂起，修一个暴露下一个）③ 无本地复现。**治本修复**：prebuild-install -r electron -t 33.4.11 直拉 better-sqlite3 Electron ABI prebuilt（绕过 @electron/rebuild 挂起），node-gyp@12 源码兜底——CI 3 连绿。**防复发（教训固化）**：① CI 构建步骤必须有"首行输出 + 步骤级 timeout + 挂起探针"（挂起即报卡点而非 10 分钟超时）② 新 native 依赖进 desktop-build 前先验证 prebuild-install 可达 ③ 双平台 CI 修复预计 2-3 轮 CI 循环是常态，派单预留 + 首轮必须带日志通道 | 2026-08-25 D529（CTO 介入诊断） | 🔧 控制塔（CI 步骤诊断通道） |
| CT-45 | **Gatekeeper 熔断误伤 merge 提交（no-precommit-marker 误判）**：merge 提交（GitHub PR merge / 本地 merge commit）不经本地 pre-commit hook → 无 pre-commit 成功 marker → post-commit 检测 "no-precommit-marker" 写 detected-bypass → 当日 Gatekeeper 硬阻断**熔断同日其他 session 的合法提交**（实证：chore/slicec-taskstate-fix merge 提交 98c5ceff 20:21 的 detected-bypass 熔断了 dev-doc D524 的提交 21:13，经 SYNO_GATEKEEPER_ACK=1 放行，留痕 degraded-events.log 13:31:01Z/13:31:04Z）。**修复方向**：merge 提交的 marker 缺失豁免（同 D328 commit-msg 对 MERGE_HEAD 的豁免模式——检测 MERGE_HEAD 存在即跳过 marker 缺失判定），或 Gatekeeper 熔断范围收窄（只熔断真实 --no-verify 绕过，不熔断 merge 提交） | 2026-08-25 D524 交付报告（CTO 监督发现） | ✅ **D530 已修复（2026-08-25，PR #191，ffac2bb5）**：post-commit.sh 对 HEAD^2 存在（merge 提交）跳过 bypass 判定，S10 测试用例 17/17 |
| CT-44 | **org-expert-tools.ts:43 同类错误声称**：注释「或授权飞书/钉钉/企微连接器自动拉取」——与 D357 降级的 index.ts 同款 overclaim（钉钉/企微连接器不存在） | D357 交付报告（附带发现，未扩写集仅报告） | 🔧 后续任务 descope |
| CT-43 | **injectConflictFindings 潜在无限循环（D37 隐患，P1）**：runner.ts ~937-969 对 `result.findings` 做 for...of 迭代的同时向同一数组 push 冲突 finding（注入项保留 relatedNodeId）——JS 数组迭代器每次 next() 重读 .length，若 store 对同一节点持续返回 has_conflict=true，注入的 finding 会被再次处理 → 潜在无限循环 | D354 交付报告（超出范围发现，存量缺陷，非 D354 引入） | 🔧 单独立项（产品 src/sentinel/runner.ts） |
| CT-42 | **门禁行为变化强制 bump（版本编排缺口）**：U4/U7/U8（D423 声称↔证据对照表 G12d / D433 fail-open 批量修复 / D438 绕过审计强弱信号分离）均为门禁行为变化，但 VERSION.md 仍停在 V4.8.0（D307），违反「任何门禁/工具行为变化必须 bump（PATCH 起步）」铁律。**CT-35 盲区**：版本号幻影门禁只查「commit message 带版本号→同 commit 必须 bump」，不查「改了门禁脚本却没 bump 也没声称版本号」。修复：① 补 bump VERSION.md（至少 V4.8.1，U4 新机制 G12d 建议 MINOR→V4.9.0）；② pre-commit 增「scripts/ 门禁脚本变更 → 同 commit 必须 bump VERSION.md」物理检查 | 2026-08-19 控制塔升级版本编排审计（Codex 发现） | 🔧 DSH 地盘（门禁脚本 + 版本编排） |
| CT-41 | **任务重开实现线旧线退役动作**：重新实现某任务时，旧实现分支须显式删除/归档 + registry 状态迁移，作为新线交付前置检查——D356 P2-1 实证：旧线 6db5a17 已审计未合并，与新线 82c21d8 思路不同，误合并即双份冲突 | K3 D356 审计 L4 发现 3 | 🔧 TASK-ROUTING / session registry |
| CT-40 | **dev doc + brief 入库硬要求**：交付完成（DS 全绿声明）时契约文档须随提交入库（或显式声明例外路径+时限+责任人）——D356 P1-2 实证：dev doc+brief 从未出现在任何提交，仅存工作树 untracked，git clean 即契约湮灭（D366 同型复发且更彻底） | K3 D356 审计 L4 发现 2 | 🔧 pre-commit 组 6 / 写集契约 |
| CT-39 | **store mock 语义保真度**：store 类 mock 的 queryNodes filters 必须真实执行（或头部声明与生产语义差异）——mock 忽略参数会掩盖"生产不可达"（D356 P1-1 实证：端到端用例 mock 忽略 filters，生产 sqlite 精确匹配下 compute 过滤器 bug 使阈值永不可达） | K3 D356 审计 L4 发现 1 | 🔧 测试技能 / CT-30 故障注入契约 |
| 权威18 | 审计体系冲刺（7 任务重编号 D343-D349）：D343 bypass A+B（P0）/ D344 报告git+dispatcher（P0）/ D345 doc-audit / D346 组13 / D347 JSON规范 / D348 CLAIM标签化（5份核心80%，按§5.5+验收#7）/ D349 JSON生成器 | 权威文档 18（2026-08-12） | 📝 D343-D349 待写 dev doc |
| 决策 | N14 去重窗口 ✅ 裁决 A（文档改 5 分钟，任务地图 v2 已改 2026-08-13）｜P0-8 boss 角色 ✅ 裁决 A（ENT 补 → D351）｜npm audit ⏳ 待裁（建议豁免并入 D309/D310） | 创始人 2026-08-13 | 🔄 D351 待写 + D339 含 N14 |
| 08-13 | K3 D331 复审 | P1×1 | **DS13 静默消失**：dev doc 承诺 resolver 硬化（PYBIN 探测 + 退出码 0/1/2）零交付，交付声明止于 DS12 无 descope——D330 L4#2 同构复发；broken-python 门禁仍不拦截、无 brief 仍误标 degraded | dev doc 完成标准 ⊆ 交付声明无对账机制 | D352（补做）+ S-10（skill） | skill+控制塔 |
| 08-13 | K3 D331 复审 | P2×4 | 25/25 vs 24/24 计数失真；brief 未入仓；"已写 memory"声称不实（第 2 次公式化声称）；测试无 runner（carried） | 声称-事实小漂移 | S-11（skill）+ carried | skill |
| 08-13 | K3 权威偏差 v2 | P0 加深 | **N13 根因加深：loop-3/5 名义进化通道是 placeholder 假成功**（loop-handlers.ts:4-5 "D9 未兑现"），每次 cron 触发写伪造 'completed' 记录（main-agent.ts:182-199）——断裂在仪表盘不可见 | placeholder 假成功 + 假审计记录 | D333（P0，吸收 D335/P1-C2） | 产品 |
| 08-13 | K3 权威偏差 v2 | 新 P1×2 | P1-C1：铁律 38 "as any 零存在"不实（组 1 只扫 src/，packages/ 36 文件 81 处无门禁）；P1-C2：4 默认循环处理器全 placeholder（吸收 P1-A2） | 门禁扫描范围盲区 + 假成功 | D353 + D333 吸收 | 控制塔 |
| 08-13 | K3 权威偏差 v2 | 改判 | 铁律 38 从"实证全覆盖"**退回**（packages 盲区）；D-G2 精确化（freshness/CP1 被动记录型，cp1 停 08-01）；N14 真问题是**去重键不稳定**（finding.id 含时间戳），窗口是二级 | v1.1 复核不完整 | D354 + 台账修正 | 控制塔 |
| 08-13 | K3 权威偏差 v2 | 文档 D5 | C线 S5-3/T-2/A线 B6 的 ✅ 基于 placeholder 接线，证据失去支撑 | 声称基于假执行体 | D339 扩 | 文档 |

## 四、dev doc 编写 skill 改进队列（Codex synova-dev-doc）

| # | 改进 | 来源 | 状态 |
|---|------|------|------|
| S-1 | **MANDATORY push+CI DS**（推送后 origin..HEAD 空 + CI 逐 job 绿） | D328/D329 未推送教训 | ✅ 已入 requirements.md（2026-08-12） |
| S-2 | 写集表"记录含 X"声称 = 实现 + 验收（禁声称过度） | M2 | ✅ 已入 requirements.md（2026-08-12） |
| S-3 | §5 接线要求必须"生产调用点真实传递"（测试调用不计） | M3 | ✅ 已入 requirements.md + template.md（2026-08-12） |
| S-4 | DS verify 命令必须有效且映射"声称项↔用例" | M2/DS9 | ✅ 已入 requirements.md + template.md（2026-08-12） |
| S-5 | 测试 red 必须覆盖"失败模式"（broken shim/劫持/绕过），非仅 happy path | M1/M5 | ✅ 已入 requirements.md + template.md（2026-08-12） |
| S-6 | dev doc §3.2 最终实现同 commit 回填 | M7 | ✅ 已入 template.md（2026-08-12） |
| S-7 | 依赖非空 → 禁止并行派发（派发说明标注 worktree 要求） | M8 | ✅ 已入 requirements.md + template.md（2026-08-12） |
| S-8 | 写集表标注共享资源（VERSION.md/current-brief/暂存区） | M8 | ✅ 已入 requirements.md + template.md（2026-08-12） |
| S-9 | 任务前置含环境检查（session-registry 活跃 session） | M8 | ✅ 已入 requirements.md（2026-08-12） |

## 四、DSH 防线映射（synova-dsh persona 免疫细胞）

> 2026-08-15 创始人批准：K3 审计错误闭环覆盖 DeepSeek Harness。DSH 无 PreToolUse hook，
> 免疫细胞形态 = persona 规则（`~/.dsh/.agent-presets/synova-dsh/agent.cordis.yml`）。
> 闭环规则：**同类错误第二次出现 = 防线系统性失效，必须升级给创始人。**

| M 模式 | 根因类 | DSH persona 防线 |
|--------|--------|------------------|
| M1 | fail-open 静默失效（检查未执行==检查通过） | SOP ⑤ verify 必须真实执行；验证失败 ≠ 通过；降级诚实（自检 5 问 2） |
| M2 | 声称 vs 事实（doc/report overclaim） | 汇报必须文件 + 行号；"拆完了"由 grep 物理证明（铁律 47） |
| M3 | 机制建成未接线（WIRE CHECK 失败） | 自检 5 问 1：新 export 谁调用（grep 确认调用方存在） |
| M4 | 执行证据链断裂（bypass.log） | 禁止 --no-verify；提交走 synova-commit |
| M5 | 环境依赖门禁（python3/broken shim） | 关键脚本 PYBIN 探测；脚本失败不算通过 |
| M6 | 版本锚点断裂（tag 孤儿） | 铁律 0-3：开工前 git fetch + pull --ff-only；禁止 behind 开工 |
| M7 | 文档-实现漂移（dev doc 未回填） | 交付汇报与实现同 commit 回填 |
| M8 | 共享暂存区竞争（并行 session） | 分支隔离（铁律 0-3/34）+ 认领制（D296） |

**DSH 侧审计发现闭环流程**：
```
K3 发现 → 查本台账 M 模式 → 归属判定
  · DSH 犯的错 → 记入台账 + 长成 persona 规则（免疫细胞）
  · 控制塔/工程缺陷 → 记入 CT 队列（DSH 领地，负责修）
  · 审计脚本/审计标准 → 只转达 K3，绝不修改 scripts/audit/（红线）
→ 记录 → 同类第二次 → 升级创始人
```

## 五、演进记录

| 日期 | 事件 |
|------|------|
| 2026-08-12 | 建台账；登记 K3 D328/D329 两轮审计发现（P1×5 + 关键 P2）+ 7 模式 + CT/S 队列 |
| 2026-08-12 | S-2~S-6 写入 synova-dev-doc skill（requirements.md + template.md），skill 改进队列全部落地 |
| 2026-08-12 | 登记 Mac 双提交（ba653c3 engine-core 清理 + 46b9271 D321 Mac 兼容）；审计基线 439→434；admin-knowledge D309 待做；run-e2e-pipeline.cjs 残留待清；分支分歧待合并 |
| 2026-08-12 | D330/D331 共享暂存区拉锯事件 → 根因三层（物理/设计/流程）+ M8 模式 + CT-10~14 + S-7~9；D332 dev doc 就绪（V4.7.4）；PARALLEL-DISCIPLINE.md 建立 |
| 2026-08-12 | **D307 dev doc 补齐**（长期 backlog 未落地，本次承认疏漏并补写；V4.8.0 物理根治）→ CT-15 |
| 2026-08-12 | K3 权威偏差审计（A线复核）登记：P0×1/P1×5/文档×2 → D333-D339 队列；已闭环×4 防重定案；G6 改判；快照 08-01 观察项 |
| 2026-08-12 | K3 D330 复审：CONDITIONAL PASS（P1-1/1-2 独立复验通过，加分项诚实标注）；bypass 连续 3 任务无记录 → 升级 P0；resolver 探测折入 D331；DS8 基线 439 修正（我误写 434） |
| 2026-08-12 | K3 权威偏差 v1.1：P1-B1~B5 → D340-D342；D-G2 改判；铁律覆盖总表（36/37/9 无门禁）；组11 修正；D-G2 数据链路演示前动作；P0-8/N14 待决策 |
| 2026-08-13 | 权威文档 18（审计体系）登记：D# 冲突重编号（研究方案 D331-337 → D343-349，7 任务）；代码现状核（dispatcher/doc-audit-interface/claim-tag-spec 已存在，doc-audit.sh/bypass-log-reconcile.sh 缺失，报告未 git 跟踪）；标注方案内部矛盾（§五迁移 vs §5.5 不迁移，按 5.5+验收#7） |
| 2026-08-13 | 创始人裁决 N14=A（文档改 5 分钟已落实）+ P0-8=A（ENT 补 boss → D351）；建立"创始人待裁决区"（npm audit 仍待）；复盘：待裁决项此前只登记未主动提出，流程已纠正 |
| 2026-08-13 | K3 D331 复审：CONDITIONAL PASS——D329 的 P1/P2 全部落地（bypass 证据链首次完整）；P1-1 DS13 resolver 硬化零交付（D352 补做）；P2×4；L4 DS 对账机制 → S-10/S-11 已入 skill |
| 2026-08-13 | K3 权威偏差 v2：N13 根因加深（placeholder 假成功 + 伪造 completed）→ D333 扩为循环执行体真实化；铁律 38 改判退回（packages 81 处 as any）→ D353；N14 真问题去重键 → D354；D335 吸收；D5 文档 → D339 |
| 2026-08-13 | 决策参考机制建立（DECISION-REFERENCE.md）：四步框架（第一性原理→Anthropic→DeepSeek 开源实证→收敛检查）+ 记录参考系强制；S-12 入 dev-doc skill（多选项任务必填决策参考小节 + 完成报告决策记录） |
| 2026-08-15 | **DSH 审计闭环建立**：① 决策模式（D333）写入 synova-dsh persona——技术决策自决四步 + 记录参考系 + 收敛直接执行，只有产品/业务决策问创始人（创始人无代码基础，禁止转嫁技术决策）；② 审计免疫写入 persona——K3 发现 → 查台账 M 模式 → 归属判定（DSH 犯错→persona 规则；控制塔缺陷→CT 队列；审计脚本→只转达 K3）；③ 本台账新增 §四 DSH 防线映射（M1-M8 → persona 规则）；④ 台账维护权扩至 DSH（创始人批准） |
| 2026-08-20 | **Win 侧 LLM-as-a-Verifier 部署完成（synova-verify，与 Mac D460 对齐）**：`.venv-llmverifier` venv（Python 3.11）+ `llm-verifier 0.2.0`（Win `Scripts/` 路径）；DeepSeek key 从 `~/.dsh/.credentials.yaml` 运行时注入（未入库）；compare 实测「完整交付 0.6316 vs 空泛声明 0.0」判别力正常。文档：docs/synova/coordination/WIN-LLM-VERIFIER-DEPLOY-20260820.md。**同批拉平 mac 施工图修正**：`src/locale/` + `src/infra/`（command-lanes 安全机制）从删除候选移出改保留（施工图 §3.5 误判，静态 grep 数引用≠死代码，动态 require/文件驱动扫描数不到） |
| 2026-08-20 | **K3 D354 审计（v2 声称↔证据新范式首用）**：U4 4 条声称全部实测 PASS；发现 **P1-1** 交付声明表只有 4 行 vs DS1-DS7 七条——DS4-DS7 缺项且无显式 descope（S-10 违规，D331 DS13 后第二次）；**P1-2** G12d 门禁部署漂移（main 有、本机工作区无，印证 v2 步骤 0 存在性核验必要）；**P2-1** 提交含写集外 bypass.log、DS5「与写集一致」措辞过强。DS1 测试因 K3 命令审批 7 次过期未跑 → Codex 代跑 6/6 绿 → 结论 DEGRADED 升级 **CONDITIONAL PASS**。改进归属：P1-1/P2-1 → dev doc skill（声称↔证据表须覆盖全部 DS 或显式 descope；写集措辞含证据链惯例）；P1-2 → 部署环境 |
| 2026-08-19 | **D357/D354/D358 三任务交付（均未合并 main）**：D357 连接器 descope（PR#55 OPEN，外部审计 P0/1/2=0，含 IM 企微同族降级）；D354 去重键稳定化（commit dc4f4232 已推送，gh 凭据失效 PR 待建，DS1-DS7 全绿）；D358 合并哨兵去 _extinct（PR#58 OPEN，16 compute 迁入 + 2 aggregate 重写，DS1-DS8 全绿，CI 双 job 绿）。**问题如实登记**：CT-43 injectConflictFindings 潜在无限循环（D354 存量 D37 隐患）、CT-44 org-expert-tools.ts:43 同类声称、CT-45 calc-progress.py 无 deferred 态（DSH）、CT-46 gh 凭据失效；门禁拦截教训：G12c 写集 glob 被当字面路径（D358 改逐文件枚举）、D366 跨午夜 brief 改名（D357/D358）、hook 敷衍词误中（D358） |
| 2026-08-19 | **控制塔升级版本编排审计**：U4/U7/U8（D423/D433/D438）门禁行为变化未 bump VERSION.md（仍 V4.8.0）→ CT-42 登记（门禁行为变化强制 bump + CT-35 盲区识别：只查「声称版本号→bump」不查「改门禁→bump」）；顺带发现 D333 编号复用（旧=决策参考框架 V4.7.5 / 新=N13 进化闭环）= CT-38 任务 ID 唯一性校验又一实证 |
| 2026-08-17 | **K3 D356 审计**：CONDITIONAL PASS（无 P0，P1×2/P2×3）——三目标缺陷在其层全成立，但结论边界=「装配接通+降级诚实」，生产真警依赖 D355/D358（P0-2 存量）；P1-2 dev doc+brief 未入库 + 一任务两 dev doc 并存 → 补入库 + 旧线 6db5a17 退役；CT-39~41 登记（mock 语义保真度 / dev doc 入库硬要求 / 旧线退役动作） |
| 2026-08-23 | **D476/D477 交付 + 合并（PR #124/#123，终审 PASS）**：D476=GA 上游 enterpriseId 断点 + overflow 隔离收紧（D338 移交 O7/O8；auth.orgId 权威 + 跨租户 403 + config.orgId 兜底，测试 20/20，CI 9/9 全绿含 Vitest 双 shard）；D477=standardKey 块读收敛 + outcome 族 4 标签注册（D470 审计遗留 #2/#3，测试 7/7，CI 9/9 全绿）。**遗留登记（另立任务跟踪）**：① **overflow 路由未挂载 server.ts**（D90 声称挂载实为仅 import；D476 为预防性硬化）——挂载 + graphStore 生产注入归 Win（server.ts=Claude 串行点）；② **sentinel.ts L119 `\|\| 'synova'`**（O6 类，D338 已 defer）——归 DSH（src/sentinel）；③ **auth.ts L366 x-synova-token legacy 合成 'default'**——归 Win（src/middleware）。另：CI Vitest matrix 已修复（PR 上真实运行双 shard 全绿），DSH 任务卡子任务 3 提前闭环 | 

## 六、流程减负清单（省时不丢质量，2026-08-16 创始人提出）

> 依据：D362 文档拉平、D355/D363 提交、D307 验收期间积累的一手时间黑洞证据。原则：只减「纯摩擦/重复劳动」，不动「质量根」（代码门禁 + K3 审计）。

### 6.1 减负项（省时点，按优先级）

| # | 减负项 | 省什么时间 | 为什么不丢质量 | 归属 | 优先级 |
|---|--------|-----------|--------------|------|:---:|
| 1 | 文档提交豁免（CT-34） | 文档提交从反复卡几十轮 → 秒级（只跑 Secrets） | 文档真实性靠 K3 审计兜底，不靠 pre-commit | DSH（执行中） | P0 |
| 2 | worktree 初始化脚本 | 新 worktree 一键就绪，免每次手动 safe.directory（dubious ownership）/ SSH host key / 清 index.lock | 纯环境配置，与质量零关系 | DSH | P0 |
| 3 | bypass 补记自动化（BACKFILL 标记） | 手动补记（完整 40 位 hash + 双 worktree 分别补）→ 自动 + BACKFILL 区分真实/补记 | 证据链机制保留，只自动化补记动作 | DSH | P1 |
| 4 | 版本编排统一入口（CT-35） | 孤儿 tag / 幻影版本号（V4.8.0 孤儿、V4.7.10 未落库）从源头消失 | 版本三同步（VERSION.md/version.log/tag）约束保留 | DSH | P1 |
| 5 | 任务 ID 唯一性校验（CT-38） | ID 复用（D363 被用两次）的混同排查省掉 | ID 唯一性保障证据链/仪表盘对账 | DSH | P1 |
| 6 | synova-commit 双重执行消除 | 门禁跑两次（synova-commit 内部跑 + git commit hook 再跑）→ 一次（D362 实测 554s 超时根因） | 门禁内容不变，只去掉重复执行 | DSH | P1 |
| 7 | **merge 引入提交的 D331 对账豁免**（对账 base 改 merge-base） | 本次 D476/D477/台账三 PR 每次 merge main 后 push 都被 D331 拦，需逐条补记 merge 引入的 main 提交（5848de18/988f4f7a/b13b2489/869df05e/9b68cb7a 等，共 6+ 次补记循环）——对账只应查"未入 main 的提交"，已合入 main 的提交天然有主侧记录 | 证据链语义不变（仍查本地新提交），只是不再重复验证 main 已验过的提交 | DSH | P0 |
| 8 | **reference-map.md 注册 union merge driver**（.gitattributes + merge driver，bypass.log 同先例） | 每次 merge main 都手工 union 解决 reference-map.md 冲突（本 session 6+ 次）——append-only 文档天然冲突 | 文档内容两侧全保留（union），无信息丢失 | DSH（.gitattributes/config） | P1 |
| 9 | **D334 远端分叉策略**（禁止/协调 session 往他人分支推 tmp-merge） | D470/D475/D471 分支多次被其他 session 推 `Merge ... into tmp-dXXX` → D334 拦 → 强制 merge 远端再推（3+ 次循环） | 分支归属清晰，防覆盖语义保留 | DSH | P1 |
| 10 | **hook 软门禁失败不写 GATE_FAIL_SOLL 进 bypass.log** | 每次 commit 后 bypass.log 被 hook 噪声污染 → 下一次 commit/merge 前必须 `checkout -- bypass.log`（本 session 10+ 次） | 证据链只记真实提交/真实失败，软门禁告警走独立日志 | DSH | P2 |
| 11 | **golden-case/D100 门禁增量或并行** | pre-push 固定全量 11 golden-case + D100（60-90s/次），docs 提交也跑 | 受影响范围判定替代全量，或并行化 | DSH | P2 |

### 6.2 保留项（防误伤——这些不减）

| 保留项 | 为什么不减 |
|--------|-----------|
| 代码提交 13 组门禁（类型安全/Secrets/接线/架构/测试） | 质量根，一毫米不动 |
| K3 审计 T1/T2/T3 故障注入 | 抓真相的唯一关卡（D363 stream 混流就是 T3 抓的） |
| S-6 dev doc 回填 + S-10 DS 对账 | 防「文档-实现漂移」 |
| 接线验收（生产调用点 ≥1） | 防「机制建成未接线」（M3 模式） |

### 6.3 结论

效率降低的根因不是「质量要求变高」，而是**文档提交跑代码门禁 + worktree 环境摩擦 + 证据链补记重复劳动**三类纯摩擦。§6.1 五项落地后，这三类摩擦消掉大半，§6.2 的质量根不受影响。
