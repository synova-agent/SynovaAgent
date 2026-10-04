# task-state 索引（机器生成，禁手改）

> 生成器: `scripts/control-tower/task-state-retention.py index --apply`（D1150）
> 日期口径 = **最后提交日期**（`git log -1 --format=%cs`）；未跟踪件退化为文件 mtime（标 `(mtime)`）。
> 覆盖自检: 本文件行数 == task-state 顶层 + archive/ 的 `*.json` 件数（不等即生成器 exit 1）。

**保留（顶层 327 件）**

| D 号 | 日期 | 标题 | 状态 |
|---|---|---|---|
| D1000 | 2026-09-25 | 身份链补全：部门可见性恢复（服务端签发/接收链 + 桌面端身份通道切换） | claimed |
| D1001 | 2026-09-25 | 表缺口收口：渲染层测试归属改判 mac（改判建议件 + 证据集；Mac-CTO 执行改表） | delivered |
| D1002 | 2026-09-25 | 工作区路由遮蔽修复（W2/F-1）+ 错误码顺序（E-2）+ /conflicts 守卫补齐 | claimed |
| D1003 | 2026-09-26 | 文档/产物治理：Windows 工具陷阱固化（docs/tools.md）+ A 类一次性产物清理登记（18 件，跨域拆单） | claimed |
| D1004 | 2026-10-05(mtime) | js-yaml 未声明依赖收口（package.json 只声明 @types，运行时包缺失） | claimed |
| D1007 | 2026-09-25 | M9 门禁三件套收口（恢复 rebase 丢失接线 + M3 夹具假绿根治 + 棘轮基线清理；承接 PR#768/原#741） | impl_done |
| D1014 | 2026-09-26 | N12 根治：ci.yml 加 concurrency（同 ref 只留最新）+ push 触发收窄为 [main] + pull_request.types 显式化 | impl_done |
| D1022 | 2026-09-26 | T3 CI 止血包（timeouts + docsonly 推广） | claimed |
| D1023 | 2026-09-28 | CI docs-only 白名单补全 + P1 补修（.gitattributes/.gitmodules 移出、锚定分层注释、判别性夹具） | claimed |
| D1030 | 2026-09-28 | CT系列-门禁推断随机性根治（CT-C P0 + CT-A2 多命中 fail-closed + CT-D 豁免粒度 + CT-D2 doc-registry CI fail-open） | claimed |
| D1031 | 2026-09-28 | CT系列-gitattributes裸CR清理（L-CR + L-M2 工作树清理） | claimed |
| D1039 | 2026-09-28 | A4-CI成本收口 — control-tower-tests 按需跑（ci.yml 路径门控 + 可测分类器） | claimed |
| D1040 | 2026-09-28 | A4-b 测试强制 LOG_LEVEL=warn（vitest 日志噪声收口） | claimed |
| D1041 | 2026-09-28 | A4-d 五 workflow 全盘成本盘点（实测基线） | claimed |
| D1042 | 2026-09-28 | A4-e progress-freshness-watchdog 红根因（只读诊断） | claimed |
| D1043 | 2026-09-28 | A4-v 独立复核：真实 run 实测比对改动前后 CI 墙钟 | claimed |
| D1044 | 2026-09-28 | B1-archive-294-outbound | claimed |
| D1049 | 2026-09-28 | 产品完成度仪表盘周例行刷新（28 线六态） | claimed |
| D1050 | 2026-09-28 | B2-task-briefs-outbound | claimed |
| D1052 | 2026-09-29 | 注入夹具 b 面排除 docs（系统性假红修复） | claimed |
| D1058 | 2026-09-29 | 派单闸门落地：R8 修复 + §〇 归属/回执/点 id 三项检查 | claimed |
| D1059 | 2026-09-29 | 宪章格子升四问（48→64）+ 生成器对齐 + D963 规格更新 | claimed |
| D1062 | 2026-10-01 | 域门禁改信息性（不阻断）—— 创始人 2026-09-29 决策 | in_progress |
| D1064 | 2026-09-29 | FIX-D1032 软失败记账 CI-only 红（post-commit _softfail_state） | claimed |
| D1065 | 2026-09-29 | FIX bypass.log 跨 PR 弄脏（合并吞吐瓶颈） | claimed |
| D1067 | 2026-09-29 | FIX CT-2b 夹具 BSD 宿主假设（/usr/bin/stat 硬编码，GNU/Linux 宿主可能误红） | pending |
| D1070 | 2026-10-02 | X30 落地启动窗 M0 基础层（T1 merge_group + T2 门禁日志有界归档） | impl_done |
| D1071 | 2026-10-02 | X30 M0.5a 295 工作树三分类（只读，不删） | impl_done |
| D1073 | 2026-10-02 | X30 启动窗 T6 verdict 回填基线（脚本层 + 30 张样本） | impl_done |
| D1091 | 2026-10-02 | 取号器超时修复（两腿有界 + fail-closed + 扫描加速） | claimed |
| D1093 | 2026-10-02 | PR #908 CI 修复（登记闸 + 文档登记 + swallow-ok） | claimed |
| D1094 | 2026-10-02 | Python 工具 Windows 兼容修复（classify-worktrees / verdict-baseline） | claimed |
| D1095 | 2026-10-01 | g12 夹具结构性断言（存量红根治） | in_progress |
| D1096 | 2026-10-01 | 推前预演脚本（L-022 四件套工具化） | in_progress |
| D1097 | 2026-10-01 | 交接指令落地 skill | in_progress |
| D1100 | 2026-10-02 | 执行 Mac-CTO 五项裁定（分支保护与 CI 准出） | claimed |
| D1104 | 2026-10-01 | brief 模板占位符雷拆除（全队阻断源） | in_progress |
| D1105 | 2026-10-02 | 派单件移交线负责人层 + dashboards 改道 | in_progress |
| D1109 | 2026-10-02 | CI 关键路径瘦身（simulate-ci smoke 缩量 + 清单保值断言） | impl_done |
| D1112 | 2026-10-02 | 治理线一窗：门禁专项吸收与文档治理范围修正 | in_progress |
| D1116 | 2026-10-02 | T3 timeout 基线重取（ci.yml，n=12 实采样） | impl_done |
| D1150 | 2026-10-05 | 资产回收 — worktree 回收器 / task-state 保留策略与索引 / docs 归档（批6） | in_progress |
| D397 | 2026-09-10 | （原 guard 通用化已砍）产品 loop 卫生 D397'——K3 重定义 | closed |
| D398 | 2026-09-10 | 组织记忆策略调整（排最后，先看数据——K3 定序） | closed |
| D411 | 2026-09-10 | control-system-design-docs | closed |
| D485 | 2026-09-05 | register 认证闭环 切片 C——双轨账号关联（个人账号绑定企业，飞书/钉钉模式） | impl_done |
| D488 | 2026-09-05 | full-pipeline Stage 5b 专家数断言修复（D282 9→7 迁移后过时，动态读 yaml）（Stage 5b 断言修复已随 D567/7b576c89 落地 main，PR #259 同稿已关闭，CTO 对账 2026- | spec_done |
| D489 | 2026-09-02 | D394 片2-B——GA 诊断会话事件化·consult 路由接线（DiagnosisLauncher 完整替换） | impl_done |
| D490 | 2026-09-01 | expert-config-loader parseSimpleYaml 死分支修复（yaml 驱动专家路由） | spec_done |
| D491 | 2026-09-02 | expert-router 测试债修复（selectExpert 映射 + 测试对齐 7 位专家） | spec_done |
| D492 | 2026-09-05 | task-decomposer DIMENSION_EXPERT_MAP 对齐 7 位专家 | impl_done |
| D501 | 2026-08-29 | as-any 检查排除测试文件（修 CI 误报 19 处） | impl_done |
| D502 | 2026-08-23 | 任务看板多源统一（Win git 派生 + 26 线 + 待规划全量上板） | impl_done |
| D503 | 2026-08-23 | G12 时区容差修复（brief 认领窗口 ±1 天） | impl_done |
| D504 | 2026-08-24 | electron-desktop-bootstrap | impl_done |
| D505 | 2026-08-23 | sentinel-self-diagnosis | impl_done |
| D507 | 2026-09-08 | worktree-isolation | closed |
| D508 | 2026-08-29 | 提交流程减负四项（对账 merge-base/--check 全量/brief 骨架/双清洁） | impl_done |
| D509 | 2026-08-29 | union driver + G12 修复回归 main（API 合并遗漏补救） | impl_done |
| D511 | 2026-09-08 | version-guard-gate | closed |
| D512 | 2026-09-08 | gs-refresh-evidence | closed |
| D513 | 2026-08-29 | 控制塔四项返修（Win反馈+D331残余） | impl_done |
| D515 | 2026-08-29 | 控制塔 V5.0.0 减负重构（三批 13 项） | impl_done |
| D516 | 2026-08-29 | D515 审计返修 — CI strict 模式（P0 权威落地）+ 去重 + P2×4 | impl_done |
| D520 | 2026-08-29 | 控制塔跨平台适配收口（CRLF/python3/fastlane/双平台CI/checklist）+ 版本纪律 | impl_done |
| D521 | 2026-08-29 | 控制塔提交链路收敛 — tag时机/bypass竞态/语义parser/CI诊断/push模拟（治本） | impl_done |
| D524 | 2026-08-29 | D518 dev doc prod 契约返修（M7 漂移，K3 C2） | impl_done |
| D525 | 2026-08-29 | P1-1 synova-commit.test.sh 红态修复（D507 段配对测试，K3 D521 遗留） | impl_done |
| D526 | 2026-08-29 | CI canary 密封清单漂移告警（L4，K3 D521 遗留） | impl_done |
| D529 | 2026-09-08 | C1 desktop-build CI 修复（macos electron-builder + windows backend 失败） | closed |
| D530 | 2026-08-28 | CT45-gatekeeper-merge-exempt | impl_done |
| D531 | 2026-08-28 | AGENTS.md/CLAUDE.md 对齐 V5.1.1 + 每周自检机制 | impl_done |
| D532 | 2026-08-28 | 自检脚本 --report + launchd 每周日 8:00 自动自检落位 | impl_done |
| D533 | 2026-08-28 | CI 调试可达性根治（凭证共享 / CRLF 治本 / debug 纪律——审计收敛版 3 项） | impl_done |
| D534 | 2026-08-29 | Agent Notes 四态（Stage1-D2，S5-3 知识沉淀） | impl_done |
| D535 | 2026-08-29 | guard 循环卫生+超时（Stage1-D4，控制塔防跑偏） | impl_done |
| D536 | 2026-08-28 | 部署轨：桌面端实际部署验收（Track A，founder-demo checklist Mac+Win） | impl_done |
| D537 | 2026-08-29 | 控制塔并行污染+提交链摩擦根治（Win 反馈 #1-#6，单源 6 项） | impl_done |
| D538 | 2026-08-29 | 前端交互实现：左栏 Codex 风格（产品独有能力导航） | impl_done |
| D540 | 2026-08-28 | clone-pilot-shadow-commit | impl_done |
| D541 | 2026-08-28 | claim-regex-narrow | impl_done |
| D542 | 2026-08-28 | ci-strict-visible-fail | impl_done |
| D543 | 2026-08-28 | gate-tests-seal-and-parser-symmetry | impl_done |
| D544 | 2026-08-28 | leftbar-acceptance-merge | impl_done |
| D545 | 2026-09-08 | sentinel-findings-event（作废：D545 号与 Win 侧 feat/win-d545-v520-skill-sync 同号） | closed |
| D546 | 2026-08-28 | sentinel-findings-event | impl_done |
| D547 | 2026-08-28 | skeleton-brief-gate | impl_done |
| D548 | 2026-09-08 | l01-verification-backfill | closed |
| D549 | 2026-08-29 | sealed-tests-ci-canary | impl_done |
| D550 | 2026-08-29 | alloc-origin-merge（发号器占用合并 origin/main） | impl_done |
| D552 | 2026-08-28 | cto-governance-backfill-workspace-sweep | impl_done |
| D553 | 2026-08-28 | impl-done-disposal-and-audit-dispatch | impl_done |
| D554 | 2026-08-28 | post-commit-no-sweep-ct43 | impl_done |
| D555 | 2026-08-28 | verify-parallel-ci-closed-task-exempt | impl_done |
| D556 | 2026-09-08 | ga-calibration-frontend-wire-plus-return-loop-layer2 | audited |
| D557 | 2026-08-29 | verify-parallel-signal4-no-taskstate-merged | impl_done |
| D558 | 2026-09-10 | D487 session_events 迁移回归测试补写（K3 P1） | closed |
| D559 | 2026-08-29 | CT-46 pre-commit 组1 类型安全模式扩 as never / as unknown as | claimed |
| D560 | 2026-08-29 | D549 重做 — claim-regex 动态化 + canary 密封补齐（K3 FAIL 闭合） | impl_done |
| D561 | 2026-08-29 | D509/D535/D508 三 P1 恢复批 — g12-day-window 恢复 + incident-loop 4b + 注释如实化 | impl_done |
| D562 | 2026-08-29 | K3 复审批 D558-D561 派单 + 三连验收台账登记 | impl_done |
| D563 | 2026-09-02 | D489 验收返修 diagnosis.ts as never 双处类型窄化 | impl_done |
| D564 | 2026-09-02 | incident-loop.test.sh Windows 兼容修复 canary 首测双失败 | impl_done |
| D565 | 2026-09-08 | test-kit CI 接线 — 棘轮基线测试入 CI 双平台（K3 P1） | closed |
| D566 | 2026-09-08 | 提示词优化策略不实修复（K3 21-2 不实转 FIX） | closed |
| D567 | 2026-09-08 | 专家枚举硬编码残留 ×4 传播修复（K3 15-1） | audited |
| D568 | 2026-09-08 | enterprise-fact superseded_by 语义实现（K3 18-5） | audited |
| D569 | 2026-09-08 | dsh 仪表盘 collector 改 git 权威读取（治数据陈旧） | audited |
| D570 | 2026-09-03 | AGENTS/CLAUDE 版本对齐 V5.2.7 + CTO 自检发现台账消化 | impl_done |
| D571 | 2026-09-04 | pre-push 逃生舱审计链修复 + CTO 合并通道纪律固化 | impl_done |
| D572 | 2026-09-05 | 线1桌面端K3全量复核派单 | audited |
| D575 | 2026-09-08 | LLM 配置首启向导——借鉴 DSH credential seam（打开产品第一步即配置） | audited |
| D576 | 2026-09-08 | 产品线兑换机制修复 CT-53 + alloc 在途盲区 CT-54 | audited |
| D577 | 2026-09-08 | 哨兵阈值配置真实挂载——死代码转活（7-2/8-1/10-3） | audited |
| D578 | 2026-09-08 | FIX-D572-Win真机实测1-2 | audited |
| D579 | 2026-09-06 | FIX-D572-k3verdict-stale机制 | audited |
| D580 | 2026-09-06 | 08告警工单切片-8-2入库-8-3去重稳定化-8-4状态机API | audited |
| D581 | 2026-09-06 | D578收尾三残留-Win验证脚本BOM-证据路径-构建守卫 | audited |
| D582 | 2026-09-06 | CT-60 D328 提取大小写兼容 | audited |
| D583 | 2026-09-06 | P0专家名测试债-D282迁移余波 | claimed |
| D584 | 2026-09-08 | P1 DSH线测试债-sentinels与契约批 | impl_done |
| D586 | 2026-09-08 | LLM 稳定错误码 taxonomy 收敛对齐（DSH 借鉴卡 B-01） | audited |
| D587 | 2026-09-08 | 工具结果修剪器（DSH 借鉴卡 B-04） | audited |
| D588 | 2026-09-08 | 会话投影注册表（DSH 借鉴卡 B-07） | audited |
| D589 | 2026-09-08 | stale 26 点重验批（D579 机制生效后首轮回绿工程） | impl_done |
| D590 | 2026-09-09 | L1-P1对话HTTP-SSE端点 | audited |
| D591 | 2026-09-09 | L1-P1桌面端对话接线 | audited |
| D592 | 2026-09-08 | L1-P1对话E2E场景+产线2-1/2-2/2-5证据 | audited |
| D593 | 2026-09-16 | L1-P2桌面报告工单 | audited |
| D594 | 2026-09-10 | L1-P2交互卡片链路 | closed |
| D595 | 2026-09-10 | L1-P3MCP认证权限 | audited |
| D596 | 2026-09-10 | L1-P3TUI清理与文档拉平 | closed |
| D597 | 2026-09-08 | D588会话投影接线-M3第5次修复 | impl_done |
| D598 | 2026-09-15 | DSH 借鉴卡 B-03：token 四桶计量 + 成本护栏 | impl_done |
| D599 | 2026-09-15 | DSH 借鉴卡 B-09+B-10：客户配置包机制蓝本（四层叠加 + dump 可检查） | impl_done |
| D600 | 2026-09-09 | S1-6 CFG 产品化诊断第一命令 | impl_done |
| D601 | 2026-09-08 | 任务看板映射校准 + L1 跨层违规扫描（改号自 D600） | impl_done |
| D602 | 2026-09-09 | D602 L1-P2 交互卡片呈现+preload/IPC收敛+通知error消费（原审计编号 D594） | impl_done |
| D603 | 2026-09-09 | L1-P3 TUI 清理 + 跨层修复 + 文档拉平 | impl_done |
| D651 | 2026-09-09 | K3双线编码管线代码质量对比评估 | impl_done |
| D660 | 2026-09-10 | 任务看板活动判定重排——running=48h 分支活动 + 待规划 backlog 列三源落位 | impl_done |
| D661 | 2026-09-11 | grep-oP-portable-family-fix | impl_done |
| D663 | 2026-09-11 | ct-ci-hermetic-arch-ratchet | impl_done |
| D664 | 2026-09-13 | pre-commit-check-grep-p-self-clean | audited |
| D665 | 2026-09-11 | main-build-job-failure-fix | impl_done |
| D705 | 2026-09-11 | cto-docs-batch-d593-confirm-backlog | claimed |
| D706 | 2026-09-13 | synova-commit-deletion-loss-fix | audited |
| D707 | 2026-09-13 | brief-archlayer-parser-unify | audited |
| D708 | 2026-09-13 | m9-merge-writeset-gate | audited |
| D709 | 2026-09-12 | dispatch-parallel-cto-batch | claimed |
| D710 | 2026-09-12 | ct47-lock-landing-record | claimed |
| D711 | 2026-09-13 | D1-notification-model-landing | claimed |
| D712 | 2026-09-13 | 桌面端线 1 证据重验批（Mac 侧 1-1/1-3/1-4/1-5/1-6/1-7） | impl_done |
| D713 | 2026-09-13 | desktop-package-signature-and-verify-gate | impl_done |
| D714 | 2026-09-13 | f3-preload-sandbox-renderer-api-fix | impl_done |
| D715 | 2026-09-13 | k3-audit-ctl-slice-and-line1 | audit_done |
| D716 | 2026-09-15 | devdoc-monitoring-contract-and-dual-guide | spec_done |
| D717 | 2026-09-13 | coding-product-debt-batch | impl_done |
| D718 | 2026-09-13 | cto-parallel-ctl-minor-fixes | impl_done |
| D719 | 2026-09-13 | dispatch-batch2-registration | claimed |
| D720 | 2026-09-13 | 四线派单 brief 落 main（D715-D718 由骨架填实）+ 主树残留判定 | claimed |
| D721 | 2026-09-13 | CI 存量失败棘轮：变更集基准改 merge-base 三点差 + 放行可见化 | impl_done |
| D725 | 2026-09-13 | D660 数据生命周期五层阶梯 spec | spec_done |
| D737 | 2026-09-15 | tag-bypass-wiring 真红定位与修复 | claimed |
| D740 | 2026-09-14 | L1交互层未闭合项取证（D518/D519/D590/D591/D593/D595/D602 + D594 + D572） | impl_done |
| D741 | 2026-09-14 | 真相源状态写入链路定位（product-progress 线状态 + task-state FAIL 看板链路） | impl_done |
| D742 | 2026-09-15 | 孤儿测试门禁——CI 未执行的测试文件清单（防『写了没人跑』） | claimed |
| D743 | 2026-09-15 | alloc-task-id 跨分支唯一性——两条线拿到同一个号（D712 实证撞号） | claimed |
| D745 | 2026-09-15 | （作废）计划表占位号（『补定义 B-11~B-20』）——实测指引 §4+附录 B 已有简卡定义，本号无独立交付物 | rejected |
| D746 | 2026-09-15 | （作废）计划表占位号（『逐卡实现』）——实现已拆为 D760~D769 十张卡，本号作废 | rejected |
| D747 | 2026-09-15 | 桌面端 1-4 重打新产物 + 证据落盘（line-1 关键一件） | claimed |
| D748 | 2026-09-14 | board-verdict-dimension-visible-failures | claimed |
| D749 | 2026-09-14 | write-set-generated-single-source | claimed |
| D750 | 2026-09-14 | 修 inferCategory 与 SIGNAL_TO_EXPERT 分类法错配——10 类中 7 类不可达（活缺陷，P0） | claimed |
| D751 | 2026-09-15 | 「新增生效」硬断言——把文件驱动的宣称变成物理事实（P1） | impl_done |
| D752 | 2026-09-15 | 哨兵类型网登记从软约束改硬门禁（8/45 未登记，P1） | impl_done |
| D753 | 2026-09-14 | 计数一致性债——单一事实源缺失（P2，禁止在 D750 修好前调整本体规模） | claimed |
| D754 | 2026-09-15 | 声明/注释漂移——哨兵 route 声明缺失 + runner 注释描述的失效模式与实际不符（P2） | claimed |
| D755 | 2026-09-14 | inquiry-pluginability-debt-registration | claimed |
| D756 | 2026-09-14 | dispatch-sentinel-debts-d751-d752-d754 | claimed |
| D757 | 2026-09-15 | 哨兵类型欠账修复：3 个未登记哨兵的类型错（D752 门禁暴露） | claimed |
| D758 | 2026-09-15 | 证据目录域判定豁免（D734 假阳性修复） | claimed |
| D759 | 2026-09-15 | 回退 nodemailer 10 依赖升级（主树 tsc 变红） | claimed |
| D760 | 2026-09-15 | DSH 借鉴卡 B-11：MCP client 双 transport（stdio/StreamableHTTP + 工具表变更通知重载 + scrubbedParentEnv） | claimed |
| D761 | 2026-09-15 | DSH 借鉴卡 B-12：webhook 事件触发路（source/rule/delivery 三 id + delivery 校验与 deepFreeze + provenance 注入 + GitHub HMAC 验签） | claimed |
| D762 | 2026-09-15 | DSH 借鉴卡 B-13：goal 事件溯源状态机四件套（foldGoal/GOAL_CHANGE_VERSION 投影 + goal-round-driver 竞态围栏与续轮提示 + tool-goal 执行时 authority） | claimed |
| D763 | 2026-09-15 | DSH 借鉴卡 B-14：消息级反馈 sidecar（域 spec + schema 族 + 会话生命周期指纹围栏 createdAt+cwd） | claimed |
| D764 | 2026-09-15 | DSH 借鉴卡 B-15：权限预设写穿（预设=旋钮打包 sandbox-mode+approval-policy，写穿到会话事件，预设不成为第二真相源） | claimed |
| D765 | 2026-09-15 | DSH 借鉴卡 B-16：不可信上下文标注（跨会话引用 URI 编解码 + 大小上限 + 候选限流 + 不可信模型上下文标记） | claimed |
| D766 | 2026-09-15 | DSH 借鉴卡 B-17：skill provider 两阶段触发（dispatcher 主动发现 + 模型主动拉取） | claimed |
| D767 | 2026-09-15 | DSH 借鉴卡 B-18：运行时不变量注册表（InvariantRegistry，检查可选、违约必炸） | claimed |
| D768 | 2026-09-15 | DSH 借鉴卡 B-19：持久化分级哲学（提醒/会话走日志=冷恢复免费；伴随会话的长跑作业走内存） | claimed |
| D769 | 2026-09-20 | DSH 借鉴卡 B-20：速览族六项小缺口（截断披露/防呆/擦除/时间上下文/FTS5/检查点） | claimed |
| D770 | 2026-09-20 | 登记 DSH 借鉴卡 B-11~B-20 为看板任务 + 计划表回填 D# + 排期派单 | claimed |
| D771 | 2026-09-20 | 派单前复核脚本 D370 类崩溃修复（$VAR 全角边界）+ 幻号/欠登记 task-state 补登记 | claimed |
| D772 | 2026-09-20 | 收口登记：D769 卡 + D770/D771 自身台账（拆单后续） | claimed |
| D773 | 2026-09-16 | Win 域代行规约（临时，至 Win 机回归）+ DSH 卡与 Win 工单执行方改派 Mac | claimed |
| D774 | 2026-09-16 | 证据保鲜流水线：一键重跑全部可自动化验收 + 兑换 + TTL 定时 + 过期预警 | impl_done |
| D775 | 2026-09-15 | N13 进化闭环真实化：loop-3/5 非 placeholder + feedback 消费方接线 | claimed |
| D776 | 2026-09-15 | 线4 数据接入：L5 连接器（CRM/财务/HR）+ L4 类型契约收敛 → GS-01~04 转绿 | claimed |
| D777 | 2026-09-15 | 第五批派单：产品推进（线1 收口 + 证据保鲜 + 审计吞吐 + 产品缺口 + DSH 卡） | claimed |
| D778 | 2026-09-16 | 交付物复核门禁：派单文档 pre-commit 强制 pre-dispatch-check + CTO 交付三件套固化 | claimed |
| D779 | 2026-09-20 | 登记补齐：D727-D736 task-state 从 #536 分支抽出入 main（复核 ① 项 + 看板可见） | claimed |
| D780 | 2026-09-20 | K3 审计批次四：33 个 impl 无 audit 任务 + 本批新交付（D751/D752/D754/D757/D758/D759） | claimed |
| D781 | 2026-09-20 | K3 权威文档一致性专项审计（2026-09-14）登记：FAIL / 35 条（9 P0） | claimed |
| D782 | 2026-09-16 | 机制批：18 份真相源文档接机器防线（check-doc-truth + doc-registry-gate 入 pre-commit + 唯一 runner + system-registry 规格） | impl_done |
| D783 | 2026-09-20 | 文档一致性批：P1/P2 逐条「改文档 or 改事实」收敛（27 条） | claimed |
| D784 | 2026-09-20 | 审计侧 3 条免疫细胞落位（dsh-audit-draft persona → install，创始人过措辞） | claimed |
| D785 | 2026-09-20 | 因果链 22 条 ↔ cycles/*.cycle.json 对应关系取证（供 §8#5 裁定） | claimed |
| D787 | 2026-09-20 | CT 最高优先三机制：提交级写集对账 + 合并 diff 白名单核验 + task-state 载体存在性检查；并附 D595 载体修复 | claimed |
| D788 | 2026-09-20 | 预算门禁口径修正：只计审查面（治理/审计产物不计入计数与域判定）——解锁审计批次落地 | claimed |
| D789 | 2026-09-20 | K3 审计批次五：D774/D786 流水线与看门狗 + D782 part1 + 门禁变更（D778/D788）+ A1 口径修复 | claimed |
| D790 | 2026-09-17 | A1 度量口径修复：证据失效比时间戳（不比日期）+ 重跑刷新 | impl_done |
| D791 | 2026-09-17 | 线3 报告体系 spec：一页纸结构（3-1）+ 各维度循环结论（3-7） | spec_done |
| D792 | 2026-09-20 | main 存量红定位：Vitest (2/2) shard2 失败集（只读诊断，不改 CI） | claimed |
| D793 | 2026-09-17 | 项目管理方案：26 线 V1 验收标准（断言版）+ 四视图派生器（S0a/S0b/S2） | claimed |
| D794 | 2026-09-17 | 项目总览插件：左侧边栏入口 + 四视图（全局可见） | claimed |
| D795 | 2026-09-17 | 项目账本派生器：gen-project-board.py → ledger.json（四视图数据源） | impl_done |
| D796 | 2026-09-17 | 交付纪律三闸（物理固化）：工作区归属 / 完工落库 / 派单四件套 | claimed |
| D797 | 2026-09-17 | S1：task-state 六字段回填 + 门禁（解锁阻塞/时间轴） | claimed |
| D798 | 2026-09-17 | S3：账本日常化（每日刷新 + 周报生成器） | claimed |
| D799 | 2026-09-20 | 产品线第一条 100%：线 10 资本循环（V1 6/6） | claimed |
| D800 | 2026-09-17 | 证据完整性：未挣得证据洞（--skip-vitest 写假绿） | claimed |
| D803 | 2026-09-18 | 线10 资本循环 V1 6/6（第一条 100% 线，规格先行） | ? |
| D806 | 2026-09-18 | 台账修复-DSH复用可见 | impl_done |
| D808 | 2026-09-18 | DSH 借鉴标准更新（治理文档）：合规口径 + G3 守卫物理化 + 落点归属 + V1 元断言一致性核对表 | impl_done |
| D809 | 2026-09-18 | 假绿回退：20-3/20-5/22-1 证据标 pending_wiring（不计 passed） | impl_done |
| D810 | 2026-09-18 | LLM 韧性层三入口接线（retry-middleware / context-compaction / timeout） | impl_done |
| D811 | 2026-09-20 | 队列收口：未合 PR 台账扫描器 + 可签字关闭清单 + 上限=12 提示层 + 旁路派生指标 | impl_done |
| D812 | 2026-09-18 | 派单引用小节存在性门禁（C4）：pre-dispatch-check 增检查 ⑪ | claimed |
| D813 | 2026-09-18 | tests/** 类型网 ratchet（卡 C）：新增 check-test-type-net.sh + 冻结基线 | claimed |
| D814 | 2026-09-18 | D708 任务号推断修复：merge-main 后被错锚到 main 侧任务号（infer_did 改 --first-parent） | claimed |
| D815 | 2026-09-20 | 线10 资本循环全链路独立复核（第一条 100% 线收官，10-8 门槛） | audited |
| D816 | 2026-09-18 | 控制塔卫生：alloc-task-id 跨 worktree 取号 + .claude/bypass.log 停止入库 | claimed |
| D817 | 2026-09-19 | 第 0 项：CI 能跑一次生产入口级对话（验证基础设施，全部验收的公共前置） | impl_done |
| D818 | 2026-09-19 | 三项开工前核实（研究院任务书的未核实面）：security 余 11 文件 / 数据层未核实 1·2·5·10 / Node 基线 | claimed |
| D819 | 2026-09-19 | P0-1+P0-2+D817-F1/F2：工具 schema 进请求体 + tool_call 配对 + 响应侧 tool_calls 映射 + assistant 不重复入上下文 | claimed |
| D820 | 2026-09-19 | T-D3：删会话不删诊断报告（隐私/数据资产；清理函数已存在却零调用） | claimed |
| D821 | 2026-09-21 | P-1 HTTP 代理 / 内网适配（企业私有化部署刚需，前提清单第 1 项） | audited |
| D822 | 2026-09-19 | T-D5 降级信号自遮蔽（写失败被同轮后一次成功抹掉，且测试固化了缺陷） | claimed |
| D823 | 2026-09-19 | T-D6 im-inbound 调不存在的方法（IM 历史恢复静默空转） | claimed |
| D824 | 2026-09-19 | T-D12 check-bridge-files 孤儿脚本处置（防回潮门禁本身『写了没接上』） | claimed |
| D825 | 2026-09-19 | T-D2+T-D9：压缩入日志 + 工具事件入日志（同一 schema 变更，必须一起做） | claimed |
| D826 | 2026-09-22 | search() 缺租户过滤（跨租户泄露面；锚点＝第 2 个客户接入前必须修） | claimed |
| D827 | 2026-09-22 | 会话统计：两处『有雏形零接线』接通（agent_metrics 零写入 + checkpoint() 零消费者） | claimed |
| D828 | 2026-09-22 | 趋势算法接线（computeTemporalBaseline 零生产调用） | claimed |
| D829 | 2026-09-19 | packages/evolution 接线（2,503 行零生产引用；线 17 第一条验收点） | claimed |
| D830 | 2026-09-20 | T-D1/T-D10 复核：D810 是否真覆盖（对着已合入 main 独立复核） | audited |
| D831 | 2026-09-22 | P-2 不变量机制（前提清单第 2 项；首批 3 条断言） | claimed |
| D832 | 2026-09-19 | 固化①：新验收标准进派单与规格（门禁 + 模板） | claimed |
| D833 | 2026-09-19 | 固化②：CTO 验收记录模板 + 检查（我的验收也受门禁约束） | claimed |
| D834 | 2026-09-19 | 固化③：项目总览/台账跟踪三层清单（29 线 / 3 前提 / 12 线外 + 9 断线） | claimed |
| D835 | 2026-09-19 | 控制塔卫生 2：D708 写集门禁对 git mv（重命名）来源路径误判为夹带 | claimed |
| D836 | 2026-09-20 | K3 独立审计：D819 工具接线三修（试点队产出）—— 试点指标③（审计能挑出几个问题） | audited |
| D837 | 2026-09-19 | 小队模式物理门禁：check-team-protocol.sh（M1–M6 六项检查 + 夹具 + 接线） | claimed |
| D838 | 2026-09-19 | 两条新线的验收点补全 + 11 项缺口验收点起草 + V1 标准变更单（起草件，待创始人确认） | claimed |
| D839 | 2026-09-20 | 认领制缺陷：已完成 session 的 brief 不释放声明 → 后续任务被永久锁死（D296/D329 门禁） | claimed |
| D840 | 2026-09-20 | 派单模板加『为什么派它/做完推动什么』必填节 + 并行车道图（创始人 2026-09-20 要求） | impl_done |
| D841 | 2026-09-20 | K3 独立审计：D839 认领门禁变更（完成即释放/批量释放/持久化）——门禁变更属审计面 | audited |
| D842 | 2026-09-20 | 归档恢复 1/3：task-state 记账卡（D769/D770/D771/D772/D779/D780/D781） | impl_done |
| D843 | 2026-09-20 | 归档恢复 2/3：task-state 记账卡（D783/D784/D785/D787/D788/D789/D792） | impl_done |
| D845 | 2026-09-20 | 固化 DSH 决策六原则为纪律件（skill：dsh-decision-lens）——创始人 2026-09-20 定'以后遇到需要决策的用 DSH 的思维' | impl_done |
| D846 | 2026-09-20 | K3 P1-1 后续：释放证据无防伪——改工作树即可无痕解锁他人认领（释放判定不得读工作树） | claimed |
| D847 | 2026-09-20 | K3 P1-3 后续：claim-releases 台账并发 lost-update（30 轮首轮即中） | claimed |
| D848 | 2026-09-20 | 账本漂移门禁：证据/状态变更合并后必须重算 ledger 派生器（K3 D815 P1 归因） | claimed |
| D849 | 2026-09-20 | 研究院交接文档入库 + 未读事故固化（5 份正式文档只读 1 份） | impl_done |
| D850 | 2026-09-20 | 度量口径改造：取消整体完成度百分数 → 离散三档 + evidenceCmd（小队 D850 编码 A） | impl_done |
| D852 | 2026-09-21 | §6-5 四项产品决定落地：线 8 出站/入站 webhook、线 4 spill 双阈值、线 3 时间窗粒度、线 25 live/restart（各新增验收点） | impl_done |
| D853 | 2026-09-20 | 批十四条件闭环（『有条件通过』=未通过，创始人 2026-09-20 裁决） | claimed |
| D854 | 2026-09-20 | D811 条件闭环 + CT-70 立卡（tests/project 在 CI 上是绿色假象） | claimed |
| D855 | 2026-09-21 | 「未知档」成分分解 + 实现态机器可读源（DSH 原则④：未知是第一等公民，禁静态凑数） | claimed |
| D856 | 2026-09-22 | 签署态单一权威源 + 派生表 + 不一致检查；重做 #677（0 字节空 blob 拒绝） | claimed |
| D857 | 2026-09-21 | 控制塔两处「总完成度」改读离散三档（CT-74）+ 补『禁百分比』grep 断言 | claimed |
| D858 | 2026-09-21 | D854/CT-70 审计条件闭环：canary 覆盖语义物理展开（glob）+ 绿腿告警可见 + 假覆盖 fail-closed + 证据包标准化 | audited |
| D860 | 2026-09-22 | PR 预算口径治本（F9/F12 一族）：治理产物（brief/卡/Note/规格/自验记录）不计入 ≤12 文件预算 | impl_done |
| D861 | 2026-09-22 | main 红修复：Vitest (2/2) + generate + 聚合→计算→页面（cc4e4166 / 272dbd82） | impl_done |
| D862 | 2026-09-21 | P-1 收尾三项（D821 越界挂账）：connector 覆盖 src/connectors/ima.ts+ima-connector.ts ｜ 健康检查暴露 kind:'socks' 含值 ｜ 启动期 proxy-install/boo | claimed |
| D863 | 2026-09-22 | ci.yml 小改：绿腿告警回捞 + canary 假覆盖传导（原 D858 队报的 CT-78） | claimed |
| D864 | 2026-09-22 | D864 复审 P1-2 闭环：`.claude/reference-map.md` 生成物不入库 | claimed |
| D865 | 2026-09-22 | D831 K3 退回闭环（P0-1 违约真 fail-closed / P0-2 CI 真绿 / P1×3 / P2×6 逐条处置） | audited |
| D866 | 2026-09-22 | 首 token 窗口心跳/超时（N3） | claimed |
| D867 | 2026-09-22 | 合并回退「已完成状态」防护 | claimed |
| D868 | 2026-09-22 | D868 CI 预算 + 跨域结构性根因（**已并入 D911 切片 B**） | closed |
| D869 | 2026-09-22 | 门禁组 7 死检查：`^+++` 使 grep -Ev exit 2 被 `\|\| true` 吞 | claimed |
| D870 | 2026-09-22 | 官方参照系学习计划（Electron 封装 / UI / 模型切换 / 借鉴重核）—— 四份对照表 + 借鉴总表 + 改法卡建议清单 | audited |
| D911 | 2026-09-22 | 控制塔门禁三缺陷根治：D708 误拦合法 PR / D733 无「代行」机制 / D749 判据漂移 | claimed |
| D912 | 2026-09-22 | 研究院材料升权威级 + 引用纪律 + 派单模板「旧信息漏洞自检」 + 补 4 卡 write_set（**原误标 D850，撞号重编号**） | impl_done |
| D913 | 2026-09-22 | 卡登记补齐：D864/D865/D866–D870 入 task-state + D870 K3 复审派单 | impl_done |
| D914 | 2026-09-22 | ownership 补齐：CTO 治理文档三目录（dispatch/authority/research）落 win 兜底 → 归 mac | impl_done |
| D915 | 2026-09-22 | 创始人面板恢复落 main（bot 通道被 GitHub 平台机制永久阻断） | impl_done |
| D916 | 2026-09-22 | D870 K3 审计 P2 收口（4 条 implement 侧）+ CTO 口径订正（P2-1） | claimed |
| D917 | 2026-09-22 | 双 DSH 提升清单（10 条）落地：入库 + 裁定 + 分档派工 | claimed |
| D918 | 2026-09-25 | 控制塔日期边界定时炸弹修复（gate-stats 夹具相对时间化）——合并队列解阻第一件 | audited |
| D919 | 2026-09-25 | 引用可核验门禁（check-citations fail-closed + 可归因；pre-dispatch ⑥ 接线 + CI 密封） | audited |
| D920 | 2026-09-25 | 合并队列推进器入库（serialmerge 两根因机器化 + 密封测试）+ CTO 台账登记 | audited |
| D921 | 2026-09-23 | K3 独立审计派单（D919 引用可核验门禁 + D920 合并队列推进器） | impl_done |
| D922 | 2026-09-25 | 程序：双 DSH 提升方案落地（9 子卡 / 3 Wave / 程序级长任务） | spec_done |
| D923 | 2026-09-23 | W1-1·D1：K3 升级为必经合并门禁 + 异构交叉评审 | spec_done |
| D924 | 2026-09-25 | W1-2·B4：子进程输出协议规范（禁标记字符串分割混合流） | spec_done |
| D925 | 2026-09-25 | W1-3·C2：deps-interface + setter 注入立为标准模式 | spec_done |
| D926 | 2026-09-25 | 小队行为纪律技能化（synova-dsh persona 精简 + squad-discipline 技能 + 队长预设接线） | audited |
| D928 | 2026-09-24 | 第③面生成器修复（gen-cto-health 崩溃 + verdict 误判）——恢复「打开即真相」 | impl_done |
| D930 | 2026-09-23 | Win 侧同步包（控制塔/预设/技能/必读文档对齐） | impl_done |
| D931 | 2026-09-25 | 小队执行形态接线（队长预设挂 Agent Teams + 派单模板执行形态硬字段 + 纪律条目） | audited |
| D933 | 2026-09-24 | Win 派单（W0 + 首模块）+ 模块归属基线 | impl_done |
| D934 | 2026-09-24 | 两侧协作方式（Mac/Win 同构，唯一差异 = CTO 角色由 Codex 执行） | impl_done |
| D935 | 2026-09-25 | M1 ownership presets 域修正（窄卡） | claimed |
| D936 | 2026-09-24 | 模块归属改为服从 ownership.yaml（删四组冲突清单）+ 台账三批登记 | impl_done |
| D937 | 2026-09-24 | P0 门禁 fail-open 假绿：pre-commit 组 7a ERE 非法致检查恒过 | spec_done |
| D938 | 2026-09-24 | alloc-task-id.sh 两缺陷 + scripts 全角紧贴变量统一清扫 | spec_done |
| D939 | 2026-09-24 | 生成物注释漂移：CODEOWNERS 与 ownership.yaml 引用不存在的 test 文件 | spec_done |
| D940 | 2026-09-24 | 名字统一分配（worktree/分支/卡号）——今天撞号 3 次 | spec_done |
| D941 | 2026-09-24 | M1b：ownership.yaml 生成式重写（最长前缀 + 兜底 fail-closed + 解析算法）必过 K3 | spec_done |
| D942 | 2026-09-24 | CTO 固化件 I/II + cto/k3 预设入仓 + cto-handover 技能开工首件 | impl_done |
| D943 | 2026-09-25 | D943 机制面：DSH 断面唯一源+门禁 / K3 报告机械保险 / 观测式看板 runner（拆分自 #738） | impl_done |
| D945 | 2026-09-25 | 预设机制迁移（legacy 目录 → bundle 声明行）：仓库侧收口 + legacy 退役 + B3 夹具适配 + 一致性对账 | spec_done |
| D954 | 2026-09-25 | C 段空转修复：--ci-reds 对账对象改指 base + 判别夹具 + infer_did 回退/--did | spec_done |
| D955 | 2026-09-25 | D943 文档面 + DSH 断面接线（PR-2）：旧断面锚清零 + 断面门禁接线 CI/pre-commit | impl_done |
| D956 | 2026-09-26 | CI 失败消息观测性（失败行入窗+截断自报+三态） | in_progress |
| D963 | 2026-09-29 | DSH 侧边栏面板「宪章三问 48 格」——48 格的第一个真实用例（按三问验收） | spec_done |
| D964 | 2026-09-25 | 文档减负 + K3 报告指针式（程序卡：阶段0 只读 / 阶段1 门禁豁免 / 阶段1b 引用豁免根 / 阶段2 K3报告PR清收 / 阶段3 同类文档唯一性 / 阶段4 分批归档 / 阶段5 日报指标） | in_progress |
| D965 | 2026-09-25 | P0 修 3 个坏哨兵（path-dependency 缺 aggregate；forecast-accuracy / pricing-strategy 契约违反） | spec_done |
| D966 | 2026-09-25 | P0 独立复现「空转/零调用」并出三类清单（真算的/空转的/缺件的） | spec_done |
| D967 | 2026-09-25 | P0 measurements 时序层（建表+接线+基线改名+修零值污染+产品价值验证） | spec_done |
| D968 | 2026-09-25 | P1 统一哨兵注册为单入口（裁剪 adapters 5 个 @deprecated + 去 runner 冗余） | spec_done |
| TEMPLATE | 2026-08-17 | <任务名> | claimed |
| ct-64 | 2026-09-09 | check-architecture.sh 四类漏网形态修补——68 处存量假绿转明账 | impl_done |

**归档（archive/ 86 件；只读，保留策略见 `expire`）**

| D 号 | 日期 | 标题 | 状态 |
|---|---|---|---|
| D356 | 2026-10-05 | P0 哨兵阈值告警接线 + 降级误报修复 | audited |
| D379 | 2026-10-05 | path-dependency 哨兵空壳补实现 | audited |
| D383 | 2026-10-05 | CTO 2026-08-16 统一批次（哨兵口径/派活/B1/C6 固化/状态机/台账拆分） | audited |
| D384 | 2026-10-05 | D383 审计 P1×4 修复批次（写集漂移/D382 撞车/CTO-HEALTH 无源/幂等+测试） | audited |
| D385 | 2026-10-05 | K3 审计产物合入仓库（D383 findings 镜像 + 审计报告落库） | audited |
| D386 | 2026-10-05 | 修复 sentinel-loader.test.ts 断言容忍规范外哨兵 computes 空（CI Vitest 预存红） | audited |
| D387 | 2026-10-05 | CT-34 纯文档提交豁免门禁（pre-commit 白名单 + Secrets 保留） | audited |
| D389 | 2026-10-05 | D387 审计产物合入仓库 | audited |
| D390 | 2026-10-05 | P1-1 修复：注入缝武装守卫 + 豁免事件 exempt.log 落盘（K3 D387） | audited |
| D391 | 2026-10-05 | admin-knowledge.ts:17 L1→L4 跨层修复（CI Architecture 转绿，D309 落地，K3 P2-5 派单） | audited |
| D392 | 2026-10-05 | npm audit 豁免落地（CI 黄灯 + 台账/DASHBOARD 记录）+ D387 PASS 补核登记 | audited |
| D393 | 2026-10-05 | task-state 状态工件自动派生改造（D393） | audited |
| D394 | 2026-10-05 | 事件溯源（哨兵 findings 事件化先做——K3 改切片） | audited |
| D395 | 2026-10-05 | Agent Notes 四态（D395-a 开发组织版，1天——K3 拆分） | audited |
| D396 | 2026-10-05 | snapshot 测试（黄金用例固化回归门禁——K3 提前 P0 同批） | audited |
| D399 | 2026-10-05 | D393 审计 FAIL 修复（自指悖论/spec 双向失真/CTO-HEALTH 可复现/门禁记录入库） | audited |
| D400 | 2026-10-05 | D399 复审 CONDITIONAL PASS 收尾（D394-D398/D391 入库 + 纯净重生成 + 注释同步） | audited |
| D401 | 2026-10-05 | K3 战略咨询终版 + 分工规划信息落库（台账/TASK-ROUTING/task-state） | audited |
| D402 | 2026-10-05 | D391 审计 P1 修复（federated 兜底写入即蒸发 + 补 dev doc/brief） | audited |
| D403 | 2026-10-05 | 派活文件落库（4 brief + dev-doc 启动指引 + 认领表） | audited |
| D404 | 2026-10-05 | 上下文完整性修复落库（K3 咨询入库 + CT-40/41 + 仪表盘更新） | audited |
| D405 | 2026-10-05 | CT-41① CI 状态入仪表盘 | audited |
| D406 | 2026-10-05 | D395-a 审计 P1 修复（P1-2 腐化通道优先：check-lessons-learned 改向 + P1-1 层1门禁落点） | audited |
| D407 | 2026-10-05 | cto-health-audit-glob-fix | audited |
| D408 | 2026-10-05 | cto-closeout-registry-todos | audited |
| D409 | 2026-10-05 | cto-taskstate-consistency | audited |
| D410 | 2026-10-05 | task-to-progress-auto-redeem | audited |
| D412 | 2026-10-05 | u3-artifact-gate | audited |
| D413 | 2026-10-05 | u7-ct-test-gate | audited |
| D414 | 2026-10-05 | u1-bypass-evidence-chain | audited |
| D415 | 2026-10-05 | u2-writeset-reconcile | audited |
| D416 | 2026-10-05 | u6-sop-gate | audited |
| D417 | 2026-10-05 | u5-secrets-failopen | audited |
| D419 | 2026-10-05 | u-founder-truth-mvp | audited |
| D428 | 2026-10-05 | CTO 收尾：K3 U1-U8 控制塔升级 15 分支批量合并入 main | audited |
| D429 | 2026-10-05 | founder-truth 控制台验证（U1-U8 合并后首跑） | audited |
| D430 | 2026-10-05 | A2 机器验证入库接线（测试→证据→完成度，补历史完成度） | audited |
| D439 | 2026-10-05 | 控制台重新生成（右边栏数据刷新：D430/D438 后快照更新） | audited |
| D440 | 2026-10-05 | 控制台自动生成接 CI（dashboard-auto.yml） | audited |
| D441 | 2026-10-05 | D339 quotepath 修复移植到 main（Mac 中文文件名门禁误报根治） | audited |
| D442 | 2026-10-05 | GS-03 资本循环场景脚本（erp-standard → cash 对齐 + 阈值触发） | audited |
| D443 | 2026-10-05 | GS-02 客户循环场景脚本（crm-standard → customer-demand-shift critical） | audited |
| D444 | 2026-10-05 | GS-04 人才循环场景脚本（hr-standard → key-person-risk） | audited |
| D445 | 2026-10-05 | GS-05 告警闭环场景脚本（越阈 fixture → sentinel_tickets + 去重键） | audited |
| D446 | 2026-10-05 | GS-01 首诊旅程场景脚本（问卷 → 首诊报告 ≤3 天路径） | audited |
| D447 | 2026-10-05 | GS-06 进化闭环场景脚本（反馈注入 → loop-3/5 真实执行） | audited |
| D448 | 2026-10-05 | GS-07 数据安全场景脚本（敏感数据 → PII 脱敏 + 越权拒绝） | audited |
| D449 | 2026-10-05 | GS-08 报告可读场景脚本（GS-01 产物 → 一页纸 + 移动端） | audited |
| D450 | 2026-10-05 | GS 场景派活落库（8 任务 D442-D449 + 派活文件） | audited |
| D451 | 2026-10-05 | CT-42 session 专属 brief 读侧接线 + D331 补记死循环豁免 | audited |
| D452 | 2026-10-05 | 全项目视野修复（方案B）+ 状态对齐 D401/403/404/405 | audited |
| D453 | 2026-10-05 | CT-39 CI 红超 24h 自动入待办（信号失效 M1 同型根治） | audited |
| D454 | 2026-10-05 | GSS 服务启动原生崩溃修复 env+ESM | audited |
| D455 | 2026-10-05 | 修复 D355 残留 — cashBalance↔cash 对齐 + compute filter bug | audited |
| D456 | 2026-10-05 | alloc-task-id 并发原子锁（撞号根治，D454/D455 冲突教训） | audited |
| D457 | 2026-10-05 | bypass.log 多 PR 合并冲突根治（merge=union） | audited |
| D458 | 2026-10-05 | 多 session 并行冲突系统性根治（运行时状态去跟踪 + 版本管理固化） | audited |
| D459 | 2026-10-05 | 生成物单点生成门禁（G12d，session 禁改 CI 生成物） | audited |
| D460 | 2026-10-05 | LLM-as-a-Verifier 部署 + synova-verify skill（A2 语义预筛） | audited |
| D461 | 2026-10-05 | worktree 收尾强制（孤儿检测 + CTO-HEALTH 显示） | audited |
| D462 | 2026-10-05 | better-sqlite3 v12 升级（Node 24 兼容，解锁 GS-03/GS-05 服务器启动） | audited |
| D463 | 2026-10-05 | GS-05 告警闭环修复：run-once 接 runner 管线 + critical/emergency 自动建工单（选项 A） | audited |
| D464 | 2026-10-05 | control-tower-gate-fix | audited |
| D465 | 2026-10-05 | CI 门禁 diff 语义补齐（空暂存假绿消除） | audited |
| D466 | 2026-10-05 | check-bypass-log 注释同步 + tag-bypass-wiring 测试跨平台修复 | audited |
| D467 | 2026-10-05 | 方案1 挪CI——本地软提示+CI权威 | audited |
| D468 | 2026-10-05 | 方案3 同步降频（砍 D335 提交前同步） | audited |
| D472 | 2026-10-05 | Agent Notes 四态铁律结构化（Stage1-D2） | audited |
| D473 | 2026-10-05 | guard 循环卫生+超时（Stage1-D4） | audited |
| D474 | 2026-10-05 | snapshot keyless 回放门禁（Stage1-D3） | audited |
| D483 | 2026-10-05 | register 认证闭环 切片 A——匿名注册可达（D481 产品发现收尾） | audited |
| D484 | 2026-10-05 | register 认证闭环 切片 B——企业邀请注册链路打通（D102 邀请令牌补全） | audited |
| D486 | 2026-10-05 | register 认证闭环 端到端测试切片（A/B 真实 server 全链路验证 + 缺口补充） | audited |
| D487 | 2026-10-05 | D394 片2-A——GA 诊断会话事件化装配（D500 地基接线，交付物可自证） | audited |
| D500 | 2026-10-05 | 事件溯源 session log（Stage1-D1，取代 Win D469 草稿） | audited |
| D510 | 2026-10-05 | d504-audit-fix | audited |
| D514 | 2026-10-05 | D510 审计返修（3 P1 残留） | audited |
| D517 | 2026-10-05 | L1-A 安装包可产出(1-1) | audited |
| D518 | 2026-10-05 | L1-A 安装引导单入口(1-5) | audited |
| D519 | 2026-10-05 | L1-A Mac 安装实测(1-3) | audited |
| D522 | 2026-10-05 | L1-B 服务自启开窗即用(1-4) | audited |
| D523 | 2026-10-05 | L1-B Windows 双击安装启动出窗(1-2) | audited |
| D527 | 2026-10-05 | L1-C 首诊旅程端到端(1-6) | audited |
| D528 | 2026-10-05 | L1-C 升级/重装不丢数据(1-7) | audited |
| D539 | 2026-10-05 | session-worktree-isolation | audited |
| D551 | 2026-10-05 | ga-calibration-backend-spec | audited |
---

<!-- coverage: retained=327 archived=86 total=413 -->
