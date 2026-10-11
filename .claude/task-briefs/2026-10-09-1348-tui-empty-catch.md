# Task Brief — #1348 0-7 同型残口 · src/tui-v2/chat.tsx 4 处静默空吞（含假进度）

> 卡号：#1348（模块 K10 · 第1批-补齐）｜分支：fix/1348-tui-empty-catch｜日期：2026-10-09
> as_of ref：`origin/main` = `5a6591c4a`（本地 ref；GitHub 账号停用，无法 fetch/comment/PR）
> 坐标系：总闸 不适用｜承重件 不适用｜批次 第1批-补齐｜命名空间 不适用｜执行态 已实现待验证｜验证级别 L2-真跑通（V3 受阻，见例外）｜阻塞源 GitHub 账号停用 + 本机 native 崩溃
#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = AI 诊断 Agent。本任务位于 **L1 交互层**（`src/tui-v2/`，ink 终端界面）。
现有模块：`chat.tsx`（主组件 TuiApp + main 入口）、`lib/bootstrap.ts`（引导）、`lib/commands.ts`（斜杠命令）、
`components/*`（Header/ChatPanel/Composer/StatusBar）、`hooks/use-streaming`。
本任务形态 = **扩展（修缺口）**，不新增模块：把 4 处「静默空吞 / 假进度」改为「降级可见」。
被调方（`src/services/update-checker.ts`、`src/services/deepseek-balance.ts`、
`src/agent/conversation-engine.ts`、`src/agent/diagnosis-launcher.ts`）**只读不改**。

### b) 文件审计（口径命令原文与读数见 .synova-out/读卡确认-1348.md 字段 3）
- 口径 A（`.catch(() => {})` 精确同型，`src/`）as_of `5a6591c4a` = 4 行（3 代码 + 1 注释）：`chat.tsx:237/242/418`
- 口径 B（单行空 catch 体，`src/`）= 1 行：`chat.tsx:260`（CTO 2026-10-08 裁定并入本卡）
- 口径 D（注释体空 catch，`src/`）= 10 文件：**面外存量，本卡不动**
- 复用既有设施：模块级 `log`（`createLogger('tui-v2')`，chat.tsx:33）、`addSystemMessage`/`addAlertMessage`/`setState(status)`
- 无覆盖冲突：`src/tui-v2/lib/**` 不在写集；`src/cron/**`（#1454）、`src/sentinel/**`（#1463）在飞，未碰

### c) 决策
已有覆盖 → 复用既有 `log` + 消息通道，**不新增第二套降级机制**（不加错误总线/事件系统、不新增 logger 命名空间）。
只改 4 个调用点；被调方语义与文件版本一律不动（写入纪律：同文件同一时间只有一个写者 = 本卡）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

### a/b) 业界与顶级团队
- 前端/CLI 的失败可见性基线：**每一次被吞掉的 rejection 都是一次不可诊断的静默降级**（铁律 11/24/31）。
  TUI 属「前端」⇒ 除日志外必须有**界面可见**的降级提示（否则用户对着假状态等）。
- 失败形态有两种，调用点必须都覆盖：**reject**（异常）与 **resolve(null)**（被调方内部消化后返回空）。
  只处理 reject = 半覆盖（本卡 `:418` 正是此坑：`diagnosis-launcher.ts` 内部 `log.error` + 落 error 事件 + `return null`，**不 rethrow**）。
- 关键 UI 语义：**进度文案不得在已失败时保持「进行中」**（假进度 = 用户可见的错误信息）。

### c) memory / 本项目历史教训
- 铁律 24 + 31：catch 必须 log + 降级信号传播；铁律 11：静默降级禁止。
- 判例 V-02（grep 型不得作验收）⇒ V1/V1b 只作**范围判据**，行为由 V2（真实渲染 + 注入）承担。
- 判例 V-07（假绿要用「拔掉实现照样通过」证伪）/ V-08（改坏即红）⇒ V4 四条反例逐条跑。
- 卡面陷阱：口径 C（字面 `catch(()=>{})` 无空格）只得 1 处且是注释 = 假数；`\s` 在 `git grep -E` 下 = 假零。

### d) 决策参考系
参考：**Anthropic 工程基线（失败必须可观测、降级必须显式）＋ 第一性原理（用户看到的只有界面；日志被 TUI 主动静音）**
⇒ 结论：四处均加 `log.warn/error`；`:237`/`:242`/`:418` 另加界面提示；`:418` 额外复位假进度。
`:260` 处于关闭路径（同 tick 即 `exit()`，界面帧不可观测）⇒ 只留 log.warn + 注释说明，不塞界面消息（避免制造不可观测的假象）。

## Q2: 范围 — 正确的最简方案

做什么：
- src/tui-v2/chat.tsx（唯一被改的源码文件，四处调用点）
- tests/tui-v2/chat-degradation.test.ts（V2 注入式证据）
- tests/tui-v2/ink-fakes.ts（假 TTY 夹具）
- tests/tui-v2/harness/entry-with-fault.ts（V3 受控注入入口）
- tests/tui-v2/harness/run-prod-faketty.ts（V3 假 TTY runner）
- tests/tui-v2/harness/run-v3-faketty.sh（V3 驱动脚本）
- tests/tui-v2/harness/run-v3-pty.sh（V3 真 PTY 驱动，供可 PTY 机器复跑）
- tests/tui-v2/harness/llm-stub-server.mjs（假 LLM 外部边界替身）
- .claude/claims/1348.yaml（写集声明 S0 源）
- .claude/task-briefs/2026-10-09-1348-tui-empty-catch.md（本 brief）

不做什么：
- src/services/update-checker.ts（被调方冻结）
- src/services/deepseek-balance.ts（被调方冻结）
- src/agent/conversation-engine.ts（被调方冻结）
- src/agent/diagnosis-launcher.ts（被调方冻结）
- src/agent/expert-file-loader.ts（口径 D 面外存量）
- src/config-file.ts（口径 D 面外存量）
- src/l3/expert-dispatcher.ts（口径 D 面外存量）
- src/l3/framework-loader.ts（口径 D 面外存量）
- src/l3/synova-diagnosis-engine-impl.ts（口径 D 面外存量）
- src/l4/knowledge-store.ts（口径 D 面外存量）
- src/routes/cockpit.ts（口径 D 面外存量）
- src/routes/knowledge-ask.ts（口径 D 面外存量）
- src/services/llm-credential-store.ts（口径 D 面外存量）
- src/services/resource-monitor.ts（口径 D 面外存量）
- src/routes/chat.ts（口径 A 注释命中处，写集外）

### Q2-说明（做什么/为什么，散文）

改动（src/tui-v2/chat.tsx 四处调用点）：
原 :237 与 :242 两处 `catch(() => {})` → 各加 `log.warn` 与 `addSystemMessage('⚠️ …')` 界面提示；
原 :260 `try { db.pragma('wal_checkpoint(TRUNCATE)') } catch {}` → `log.warn` + 注释（关闭路径不阻断）；
原 :418 探针调用 → 覆盖 reject 与 resolve(null) 两形态：`log.error`/`log.warn` + `addAlertMessage('⚠️ …')` +
复位 :420 写入的假进度（仅当状态仍是该假进度时复位，避免覆盖后续真实 phase 进度）。

手段：真实 ink 渲染（假 TTY 夹具）+ vi.mock 注入 reject / db.pragma 抛错 + vi.spyOn 断言 log.warn/error
真被调用 + 最终帧断言假进度已复位 + /help 交互（V5）。

其他口径：不新增错误总线/事件系统/第二 logger 命名空间；不删原 :418 调用（删 = 改行为 = 超授权）；
不改门禁语义；不合并 PR。

## Q3: 验收 — 入口 → 交互 → 结果

- **入口**：`npm run tui`（= `tsx src/tui-v2/chat.tsx`，ink 需 TTY）
- **交互**：
  - 启动期两条探测失败（更新检查/余额）→ 界面出现两条 ⚠️ 系统消息
  - 访谈完成（Phase 0 完成）→ `handlePhaseComplete` → 诊断启动；诊断为 reject 或返回 null 时 → ⚠️ 告警 + 状态复位为「准备就绪」
  - 关闭期 WAL checkpoint 抛错 → warn 留痕，关闭流程继续
  - 失败后仍能响应 `/help`（降级不阻断）
- **结果**：四处失败均在**界面**可见（alert/system 消息）+ 日志留痕（`log.warn/error`）+ 不出现假进度
- **验证级别**：V2 = L2（真实 ink 渲染，6/6 通过）；V3 = **受阻**（见 Done 标准与例外清单）

## 架构层: L1（交互层：src/tui-v2/），只调用相邻 L2/L3 的既有接口，未新增跨层依赖

## Done 标准
- [x] V1 口径 A（src/tui-v2/，文件数口径，修复 sha）= 0 verify: test "$(git grep -lE 'catch[[:space:]]*\(\([[:space:]]*\)[[:space:]]*=>[[:space:]]*\{[[:space:]]*\}' HEAD -- src/tui-v2 | wc -l | tr -d ' ')" -eq 0
- [x] V1b 口径 B（src/，文件数口径，修复 sha）= 0 verify: test "$(git grep -lE 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}' HEAD -- src | wc -l | tr -d ' ')" -eq 0
- [x] V2 行为判据 6/6 通过（真实 ink 渲染 + 注入式证据；含 reject 与 resolve(null) 两形态与 /help 交互） verify: npx vitest run tests/tui-v2
- [x] V4 反例 ①③④ 三条红（①④ grep 红、③ 行为红，原始输出留档）；反例 ② 因前提不成立无法变红（见交付正文例外） verify: grep -q 'MUTANT-①-V1-RED' .synova-out/证据/V4-四条反例-原始输出.txt
- [ ] V3 生产入口取证 —— 受阻：Node 24 + better-sqlite3 12.11.1 原生断言（未打补丁的生产入口直跑亦复现） verify: bash tests/tui-v2/harness/run-v3-faketty.sh natural /tmp/v3-1348-out
