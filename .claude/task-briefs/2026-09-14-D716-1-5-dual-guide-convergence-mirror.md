# Task Brief: D716-spec2 安装引导单一入口（1-5 双引导收敛）— Win 线

> 生成: 2026-09-14 （2026-09-13 brief 的次日镜像——D594/D703 先例：跨零点 hook 按本地今日 glob + CI UTC 日期切换）
> 镜像源: .claude/task-briefs/2026-09-13-D716-1-5-dual-guide-convergence.md（内容除本行与文件名外完全一致）| 分支: feat/win-d716-dual-guide（@ origin/main 335eb5bd） | as any: 0
> Session: D716（独立 clone .sessions/D716/repo，分支 feat/win-d716-dual-guide；主工作区只读）
> 唯一契约: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D716-1-5-dual-guide-convergence-20260913.md（§5.1 写集 / §5.2 契约 / §7 测试 / §10 DS + 判绿口径）
> 派单: docs/synova/coordination/编码指令-D716-1-5双引导收敛-Win-20260913.md

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。
增长导航视角：桌面端目标用户（企业主/GA）只做一件事——双击安装包。安装引导存在第二个入口 = 首次使用路径分叉 = 增长激活漏斗的第一个流失点；本卡把"唯一引导入口"从 runbook 文档声明（D518/D603 型零执法）变成物理事实（删除 + 410 显式下线 + 回归守卫）。

### 三层解耦体系

纵向五层物理隔离：每层只与相邻层通信，失败/降级信号必须沿调用链向上传播（铁律 31）。
文件驱动扩展：新增能力靠文件不改代码。
数据安全分级：L0 公开摘要 → L1 聚合信号 → L2 脱敏证据 → L3 原始数据。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务收敛验收点 1-5「安装引导单一入口（双引导收敛）」（线 1 唯一 failed 点，D712 判 fail）。旧入口 = D283 旧 Web 安装引导（app/setup.html + app/js/setup.js + app/css/setup.css，由 src/server.ts:300 app.use('/app', express.static(process.cwd()/app)) 提供——问的是已作废的 serverUrl 配置）；新入口 = 桌面端 Electron 渲染层首诊页（electron/main.cjs:129 prod loadFile renderer/index.html，LlmSetupCard 被 WelcomeScreen 引用）。打包态因 cwd=resources 且 build-synova.cjs 不含 app/ 而恰好 404——"潜伏"非"已收敛"（spec §2 实测纠正派单原文）。本卡：退场（删除三件套 + setupGuideGoneRouter 410 显式下线，挂载早于静态）+ 守卫（G-3 引导唯一性 / G-4 打包形状 / G-5 渲染层唯一入口）+ runbook 声明补机制。新增/扩展（非替换）：L1 路由退场拦截器，形态对齐 D590 uploadV2GoneRouter 先例（src/server.ts:92-101）。

### b) 文件审计
grep/read 实测（clone @ 335eb5bd，2026-09-13，行号逐条重核与 spec §4 一致）：
- src/server.ts:92 export const uploadV2GoneRouter = Router().all(...)——410 先例形态模板
- src/server.ts:300 app.use('/app', express.static(path.join(process.cwd(), 'app')))+ 静态挂载（cwd 依赖 = 潜伏根因）
- src/server.ts:301-302 / 与 /login 重定向（悬挂重定向缺陷 C，登记不修）
- src/server.ts:316 llmConfigRoutes / :319 uploadV2GoneRouter 挂载 / :320 jwtAuth——D590 挂载纪律（410 先于 JWT）
- app/setup.html / app/js/setup.js / app/css/setup.css 三件套均在（git ls-files 可验）；css/js 唯一引用者 = setup.html
- electron/main.cjs:129 prod loadFile(process.resourcesPath/renderer/index.html) / :254 cwd 注入（只读）
- build-synova.cjs:153 files / :166 extraResources——均不含 app/ 条目（只读断言对象）
- electron-renderer/ WelcomeScreen 引用 LlmSetupCard（只读断言 G-5）
- tests/routes/ 与 tests/electron/ 目录存在；无同名测试文件（零撞车）

### c) 决策
已有覆盖→复用 D590 410 先例形态（同型同纪律，不另造机制）。无覆盖→新建 setupGuideGoneRouter + 两个守卫测试（精确文件名，不用目录级声明防 verify-parallel 假阳）。冲突→取消：退场用"删除 + 410"而非 302 重定向（重定向会制造第三入口 + 打包态悬挂）。跨域红线：electron/、electron-renderer/、build-synova.cjs 只读；product-lines.yaml 与 D712 证据不动；scripts/audit/ 不碰。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC：dev doc SYNOVA-IMPL-DSH-D716-1-5 §10 DS1-DS9 已定义机器可验完成标准 + 判绿口径（禁以打包态 404 冒充收敛）。
② 测试：先红（仓库根 cwd 起后端 curl /app/setup.html = 200 真实红，附状态码/头/body 三段）→ 后绿（410 + 守卫，铁律 0-2: spec→test→impl→wire→review→merge）。
③ 实现：setupGuideGoneRouter（410 + 人话 HTML 三段：已下线/唯一入口=双击安装包/开发者见 runbook）挂载早于 :300 静态；删三件套；runbook 补三行机制。
④ 接线：生产挂载点 app.use(setupGuideGoneRouter) 在 createServer 内（测试调用不计，S-3）；挂载顺序由测试断言锁定（G-2，不靠注释）。
⑤ 验证：DS1-DS8 逐条命令 + tsc 基线报错集恒等 + 守卫反向验证（红→移除→绿两段）。

引用依据（至少引用两项）：
- 铁律 37: dead code 入仓库即违规——删文件 + grep 零引用
- 铁律 11/24: 410 body 必须人话非空（禁静默降级变体）
- 铁律 0-2/48: 测试先行 + 测试非空壳（expect + 反向验证）
- CLAUDE.md D603 教训: 文档声称有执法 ≠ 有执法——本卡交付物必须含可执行守卫
- spec §5.2-B: 为什么 410 不是 302（书签兼容：无存量生产用户，410 人话指路即兼容）
- spec §4.3: D712 fail 的正确读法（cwd 巧合 404 ≠ 收敛）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
- rule: "setupGuideGoneRouter 挂载必须早于 /app 静态挂载（顺序即优先级），由测试 G-2 锁定"
  verify: "npx vitest run tests/routes/setup-guide-retired.test.ts"
- rule: "410 body 为人话 HTML 三段（含 唯一入口/安装包/双击 + runbook 路径），非空 body"
  verify: "grep -n '唯一入口' src/server.ts"
- rule: "旧引导三件套删除后全仓零引用（除退场路由字面量与历史研究快照）"
  verify: "grep -rn 'setup\\.html' src/ app/ --include=*.ts --include=*.html"
- rule: "build-synova.cjs files/extraResources 不含 app/ 条目（只读断言 G-4，不改该文件）"
  verify: "npx vitest run tests/electron/dual-guide-packaging-guard.test.ts"

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档冲突时）
决策点 1（收敛方向）：参考：D518 已裁唯一路径=安装包双击 + 打包态实测只出货渲染层 + 产品定位（老板双击零命令行）→ 结论：收敛到桌面端渲染层首诊页（spec §5.4-1 A）。
决策点 2（退场方式）：参考：第一性原理（退场必须与 cwd 无关）+ D590 410 先例 → 结论：删除三件套 + 410 显式 + 人话指路（spec §5.4-2 C）。
决策点 3（书签兼容）：参考：无存量生产用户（客户A在作战手册阶段）+ 302 会制造第三入口 → 结论：410 + 人话指路，不自动跳转（spec §5.4-3 B）。
决策点 4（守卫归属）：参考：跨域写撞车（electron 域=Mac DSH）→ 结论：只读测试断言，不改 build-synova.cjs（spec §5.4-7 B）。
决策点 5（evidence 落盘归属）：spec §5.4-8 裁 Win 贴 PR 原始输出、Mac/CTO 落盘；本卡派单指令（2026-09-13 Win 线任务书）明确要求 Win 落盘 docs/synova/product-lines/evidence/ 下 .txt/.json（归档仍归 Mac/CTO）→ 结论：按派单指令执行，落盘 + PR 双轨，不动 product-lines.yaml。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/server.ts: 新增 setupGuideGoneRouter（Router().all('/app/setup.html') → 410 + text/html 人话三段），形态对齐 :92 D590 先例；app.use(setupGuideGoneRouter) 挂载在 :300 静态挂载之前（不动 src/server.ts:301-302 重定向与静态挂载本体）
- docs/synova/runbooks/desktop-dev-prod.md: §一 收敛声明补退场机制（410 路由名 + 挂载顺序）+ 旧 URL 锚 + 守卫测试名，措辞与代码事实一致
- app/setup.html: 删除（D283 旧安装引导页，四步向导）
- app/js/setup.js: 删除（仅被 setup.html 引用，实测）
- app/css/setup.css: 删除（仅被 setup.html 引用，实测）
- tests/routes/setup-guide-retired.test.ts: 新建——410 行为（T2/T3）+ 挂载顺序源码断言（G-2）+ 文件存在仍 410 优先级证明（T6）+ 降级（T7 目录缺失/ T8 HEAD）+ 边界（T9/T10）+ 引导唯一性守卫 G-3 与反向验证（T11）
- tests/electron/dual-guide-packaging-guard.test.ts: 新建——只读断言 build-synova.cjs files/extraResources 不含 app/ 条目（G-4 + 反向验证 T12）+ 渲染层唯一入口（G-5：electron/main.cjs prod loadFile + LlmSetupCard 被 WelcomeScreen 引用）
- docs/synova/product-lines/evidence/D716-win-20260913/1-5-dual-guide-win-evidence.txt: 交付证据落盘（红测 curl 200 三段 / 绿测 410 三段 / 删除 grep 零引用 / 守卫反向验证两段 / 测试输出；.txt 非 .log 防 gitignore 静默忽略）
- task-state/D716.json: 回填 impl 段（commit + by + files[] + 每条 DS 证据指针）
- .claude/task-briefs/2026-09-13-D716-1-5-dual-guide-convergence.md: brief 簿记

不做什么（排除项）：
- 不改 electron/main.cjs（Mac DSH 域；本卡只读断言 G-5，需动即停手报 CTO）
- 不改 ./build-synova.cjs（打包配置已正确不含 app/；本卡只读断言 G-4）
- 不改 electron-renderer/ 任何文件（D575 首诊页已成立，目标入口不动）
- 不改 app/index.html 与 app/ 其余 14 页、不改 app/js/admin.js（线 2 交互域；D246 管理台 onboarding 非安装引导，spec §5.4 决策 4）
- 不改 docs/synova/product-lines/product-lines.yaml（1-5 状态推进归 Mac/CTO）
- 不改 docs/synova/product-lines/evidence/D712-mac-20260913/ 下任何文件（历史 red 基线）
- 不改 scripts/audit/ 任何脚本（K3 审计红线）
- 不修 src/server.ts :301-302 悬挂重定向与 :302 /login 重定向（缺陷 C 登记不修，spec §4.4-C）
- 不改 src/sentinel/（spec 1 监测契约属 Mac 线同批任务，与本卡零交集）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：用户=双击安装包（唯一路径）；开发者=旧书签 URL /app/setup.html；测试入口 = npx vitest run tests/routes/setup-guide-retired.test.ts tests/electron/dual-guide-packaging-guard.test.ts。
处理（中间经过哪些步骤）：GET /app/setup.html → 命中挂载在静态之前的 setupGuideGoneRouter → 410 + text/html 人话三段（此页已下线 / 唯一入口=双击安装包 / 开发者见 runbook）；三件套已删 → express.static 仍挂载其余 14 页不报错；守卫测试锁定：引导文件复活 / app/ 进打包条目 / 渲染层首诊页被拆 → 必红。
结果（最终展示在哪）：旧 URL 在任何 cwd 形态下 410（非 200/静默 404）；仓库零旧引导文件（grep 零引用）；打包形状不含 app/；唯一引导 = 渲染层首诊页；DS1-DS8 逐条输出落盘 evidence + 贴 PR → 1-5 具备翻绿资格（判定权在证据 + K3）。

## 架构层: L1 交互（src/server.ts 路由退场 + app/ 引导三件套删除）+ 构建期只读守卫（tests 只读断言 build-synova.cjs 与 electron/main.cjs，electron 域零写入）
#CRITERIA: A

## Done 标准
- [ ] DS1 verify: 仓库根 cwd 起后端（临时端口+临时 DB，不碰 data/synova.db）→ curl -i /app/setup.html → 410 且 body 含 唯一入口/安装包（实现前同形态实测 200 = 真实红留痕）
- [ ] DS2 verify: test ! -e app/setup.html && test ! -e app/js/setup.js && test ! -e app/css/setup.css && echo GONE；grep -rn "setup\.html" src/ app/ --include=*.ts --include=*.html 仅退场路由字面量
- [ ] DS3 verify: npx vitest run tests/routes/setup-guide-retired.test.ts → 全绿（挂载顺序 G-2 + T6 文件存在仍 410）
- [ ] DS4 verify: npx vitest run tests/electron/dual-guide-packaging-guard.test.ts → 全绿（G-4 只读 + G-5 唯一入口；release/ 不存在时静态断言路径并在 evidence 标注未跑真实包内清单）
- [ ] DS5 verify: 守卫反向验证两段贴 evidence——人为放回 app/setup.html → G-3 红 → 移除 → 绿；临时副本注入 app/ 条目 → G-4 红 → 撤销 → 绿
- [ ] DS6 verify: grep -n "loadFile" electron/main.cjs 命中 prod 行 + grep -rn "LlmSetupCard" electron-renderer/ 命中 WelcomeScreen 引用
- [ ] DS7 verify: grep -n "410\|setupGuideGoneRouter" docs/synova/runbooks/desktop-dev-prod.md → 命中 ≥2
- [ ] DS8 verify: npx vitest run 相关域零失败 + tsc 报错集与基线恒等 + bash scripts/control-tower/synova-commit 提交（禁 --no-verify）+ git push 后 PR CI task-relevant jobs 绿

## 文档引用
- docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D716-1-5-dual-guide-convergence-20260913.md（唯一契约：§5.1 写集 / §5.2 契约 / §7 测试 / §10 DS + 判绿口径）
- docs/synova/coordination/编码指令-D716-1-5双引导收敛-Win-20260913.md（派单：判据/红线/复核清单）
- docs/synova/runbooks/desktop-dev-prod.md（D518 目标形态：唯一路径=安装包双击）
- src/server.ts:92-101/:300-302/:316-320（D590 410 先例 + 挂载纪律实测锚点）
- CLAUDE.md D603 段（声明 ≠ 执法——本卡必须交付守卫）+ AGENTS.md 铁律 37/38/39

## 接口审计
- src/server.ts: setupGuideGoneRouter（新增 export，Router；生产挂载点 = createServer 内 app.use(setupGuideGoneRouter)，早于 :300）
- src/server.ts: uploadV2GoneRouter（:92 形态先例 / :319 挂载点——只读参照，不改）
- electron/main.cjs: loadFile（:129 prod 渲染层入口——只读断言 G-5）
- electron-renderer/.../WelcomeScreen → LlmSetupCard（只读断言 G-5）
- build-synova.cjs: files(:153) / extraResources(:166)（只读断言 G-4）
消费点与死代码判据（grep 实测）：setupGuideGoneRouter 生产消费点恰 1 处（createServer 挂载）；三件套删除后 css/js 零引用、setup.html 仅剩退场路由字面量与历史研究快照（docs/synova/research/ 点时间快照非活门禁）。

## 写集豁免（D708 合并级对账，2026-09-13 CTO 派单指令要求）

- .claude/task-briefs/2026-09-14-D716-1-5-dual-guide-convergence-mirror.md — 本镜像 brief：D296 认领制的门禁输入（非交付物）

- .claude/task-briefs/2026-09-13-D716-1-5-dual-guide-convergence.md — 本卡 brief：D296 认领制的门禁输入（非交付物）
