# Task Brief: D1100 — 执行 Mac-CTO 五项裁定（分支保护与 CI 准出）

> 生成: 2026-10-01｜任务: D1100｜认领: 工程线（X30 启动窗）｜分支: feat/x30-48h-m0
> 依据: `decisions/process/2026-10-01-branch-protection-and-ci-admission.md`（CTO 裁定：五项全批，带约束）

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是驻扎企业的 AI 诊断系统；诊断是手段，**增长导航**才是目的。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
**CI 准出面与治理规则执行**，非产品 L1–L5。

### b) 文件审计
- `scripts/control-tower/check-pr-budget.sh`（D734 计数口径，待改）
- `scripts/control-tower/log-snapshot.sh`（V5 平台敏感命令，已改）
- GitHub 分支保护（legacy 12 项必需 + ruleset `main-protect`），gh 已授权
- 裁定全文：`decisions/process/2026-10-01-branch-protection-and-ci-admission.md`
- 关系：**执行既有裁定**（不改裁定本身）。

### c) 决策
按 CTO 指定顺序：④（CI 红）→ ①（预算口径）→ ②（必需集）→ ③（ruleset 转换，不可逆）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① Done＝四项各带原始输出/run id/API 快照 → ② 本地复跑 → ③ 改 → ④ 推/调 API → ⑤ 复验。引用铁律 11/35。

### b) 本任务执行约束
- rule: "不调高任何上限；不改 job/step 显示名；只动 GI 与 npm audit；不删测试"
- rule: "③ 不可逆 ⇒ ①② 未复验通过前不得执行；复验不过=停手上报"

### c) 决策参考系
参考：CTO 裁定全文（含五判据）+ 第一性原理（机械问题与业务语义分离）→ 结论：按序执行、逐件留证。

### d) 相关 Note 引用
- [x] 拟新增 `memory/notes/proposed/2026-10-01-d1095-cto-ruling-exec.md`

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- ④ `log-snapshot.sh`：裸 python3 → PYBIN 三级探测（已落）
- ① `check-pr-budget.sh`：排除三类流程文件 + 显示改「实质/流程/输出行数」三值 + 注释/README 单源
- ② GitHub 必需集：+ Gate Integrity（逐字名）/ − npm audit（保持运行）；登记 P2 债
- ③ Convert to ruleset（①② 复验后；转换前后 API 快照逐条对照）

不做什么（含文件路径）：
- 不改 `scripts/audit/audit-check.py`、`scripts/audit/analyze-transitive-closure.py`（D336 红线）；
- 不删 `tests/control-tower/log-snapshot.test.sh` 等既有夹具；
- 不扩大白名单（`.claude/skills/**`、`decisions/**`、`docs/**`、`.claude/bypass.log` 本次不入）。

## 写集

| 文件 | 类 |
|---|---|
| `.claude/task-briefs/2026-10-01-D1100-cto-ruling-exec.md` | task |
| `scripts/control-tower/log-snapshot.sh` | task |
| `scripts/control-tower/check-pr-budget.sh` | task |
| `task-state/D1100.json` | task |
| `.claude/bypass.log` | builtin（synova-commit D414） |

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：PR #908 的 CI 与 GitHub 分支保护配置。
处理：逐件执行 → 本地/API 复验 → 留证。
结果：V5 命中清零；预算输出三值且含流程文件不超限；必需集含 GI 不含 npm audit；ruleset 转换前后快照一致。

## 架构层: 基础设施（CI 准出面）
## 文档引用: CTO 裁定件；`PLATFORM-CHECKLIST.md` §1；`D734`；`D1028`
## 接口审计: 无产品代码接口变更

#CRITERIA: A

## Done 标准
- [ ] 入口可触达: V5 平台敏感命令命中 = 0（本地复跑）
- [ ] 链路走通: 预算脚本输出三值且复验通过；API 读回必需集合规
- [ ] 结果可见: `git log -1 --oneline -- scripts/control-tower/log-snapshot.sh` 有提交
