# Task Brief: D759 回退 nodemailer 10 依赖升级（主树 tsc 变红）

> 生成: 2026-09-15 | 分支: fix/d759-revert-nodemailer10 | as any: 0
> 域: mac（package.json / package-lock.json 属 Mac 兜底域；单域）
> 主线贡献: infra:主树 tsc 红 = 所有 PR 的 TS 门禁红（阻塞全部合入，含 line-1 的 1-5）
> 触发: CTO 清 PR 积压时合入 dependabot #549（nodemailer 9.1.1→10.0.3）

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现、自动诊断，给出行动建议，跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
依赖版本层（package.json / package-lock.json），不属五层架构任何一层；影响面 = 全仓 tsc 与运行时。

### b) 文件审计（实测）
- CI 实测报错: `src/services/email-service.ts(35,19): error TS2503: Cannot find namespace 'nodemailer'`（PR #563/#560 的 TS 门禁同一报错，run job 104280890721 / 104283996509）。
- `src/services/email-service.ts:35` 用 `nodemailer.Transporter`（依赖 `@types/nodemailer` 的命名空间声明）。nodemailer 10 不再提供该形态 → 命名空间查找失败。
- 反向事实: 本地 node_modules 仍是 9.1.1（`node_modules/nodemailer/package.json` 实测 version=9.1.1），即本机未复现，需按锁文件复核。
- chalk 6.0.0（#548）：全仓 grep `chalk` 命中 0（src/ scripts/ electron/ packages/）→ 无使用点，不在本单范围。

### c) 决策
不在本单改产品代码去适配 v10（会引入未验证的 API/类型迁移），而是**回退到已验证的 9.1.1 组合**，把依赖升级降级为独立任务（一依赖一 PR + `npm ci` + tsc + vitest 全绿才合）。
理由：主树红会阻塞全部 PR（含 line-1 的 1-5），止血优先；依赖升级不是主线，不该占用主线窗口。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 回退后 tsc 恢复绿（CI 实测同一 job）。
② 测试 = 依赖版本类改动无单测可写；等价物 = **用 CI 的同一命令复核**（tsc + pre-commit）。
③ 实现 = `git revert 06b6584e`（#549 的 squash 提交）→ package.json + package-lock.json 同时回到 9.1.1。
④ 接线 = 无。
⑤ 验证 = 本地 tsc 零新增 + CI TS 门禁绿。

引用依据：
- 铁律 36（零失败才合并）：本次事故正是「旧基线上的绿」被当成「合并后的绿」——教训入台账
- M2（声称 vs 事实）：本单每条结论都带 CI job id / file:line
- M4（执行证据链断裂）：依赖升级须在锁文件层面验证，不能只看 PR 的 CI 徽章

### b) 本任务执行约束
- rule: "回退只动依赖版本，不动产品代码"
  verify: "git diff --name-only origin/main...HEAD → 仅 package.json / package-lock.json（+ brief/task-state）"
- rule: "回退后主树 tsc 无新增错误"
  verify: "npx tsc --noEmit → 与 main 基线一致（无 TS2503）"

### c) 决策参考系
参考：第一性原理（合并后的组合态才是真相）+ Anthropic 工程基线（依赖升级单独通道）——结论：先回退止血，依赖升级另立任务。

### d) 相关 Note 引用
无 Note（未触治理脚本区/规则文档区）；教训登记到 `docs/synova/coordination/AUDIT-FINDINGS-LEDGER.md`（随 D759 交付一并登记）。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- package.json — `nodemailer` 回到 `^9.1.1`
- package-lock.json — 回到 9.1.1 解析结果（git revert 原样带回）

不做什么：
- 不改 src/services/email-service.ts（不改产品代码去适配 v10）
- 不改 scripts/pre-commit-check.sh（门禁本身无问题）
- 不改 .github/workflows/ci.yml（CI 无问题）
- 不动 chalk / zod / vitest 的版本（chalk 无使用点；vitest 5 升级另议）

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：CI `TypeScript + Lint + Iron Laws` 作业（同 job 复跑）
处理（中间步骤）：`npm ci`（按锁文件装 9.1.1）→ `npx tsc --noEmit`
结果（最终展示在哪）：该 job 转绿；阻塞的 PR（#563/#560/#538/#534…）同步 main 后 TS 门禁恢复绿

## 架构层: scripts（依赖清单层，不属 L1-L5）；影响面覆盖全仓
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: verify: npx tsc --noEmit --pretty false 2>&1 | grep -c "TS2503" → 0
- [ ] 链路走通: verify: grep -n '"nodemailer"' package.json → ^9.1.1；node -e "require('./package-lock.json').packages['node_modules/nodemailer'].version" → 9.1.1
- [ ] 结果可见: verify: CI TypeScript + Lint + Iron Laws 作业绿（贴 job id）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-15-D759-revert-nodemailer10.md | task |
| package-lock.json | task |
| package.json | task |
| task-state/D759.json | task |

