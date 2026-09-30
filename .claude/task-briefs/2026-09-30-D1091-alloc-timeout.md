# Task Brief: D1091 — 取号器超时修复（两腿有界 + fail-closed + 扫描加速）

> 生成: 2026-09-30｜任务: D1091｜认领: 工程线（X30 启动窗）｜分支: feat/x30-48h-m0
> 触发: CTO 台账第七批①「取号器第 3 次挂死」升级创始人；创始人 2026-09-30 授权本线修

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是驻扎企业的 AI 诊断系统；诊断是手段，**增长导航**才是目的：持续观测、主动发现、自动诊断、给出行动建议、跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
**控制塔工具面**（取号唯一入口），非产品 L1–L5。影响所有线的开工能力。

### b) 文件审计
- `scripts/control-tower/alloc-task-id.sh`（502 行；唯一取号入口，D384/D940/D938 历史卡）。
- 既有夹具 `tests/control-tower/alloc-task-id.test.sh`（53 断言）+ `alloc-task-id-lock.test.sh`（7 断言）；CI 密封清单 `.github/workflows/ci.yml:496-498`。
- 台账第 3 次记录：`审计发现台账-DSH-CTO.md` 第七批 ①（2026-09-24 第三批、09-25 第五批各记一次）。
- 关系：**修复既有**（不加新门禁脚本）。

### c) 决策
最小修复＝给两条腿各有界 + 超时 fail-closed；同批把扫描腿换成并行枚举（否则加了超时会让取号在本机**永远失败**——这是本卡最容易做错的地方）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① Done＝端到端 ≤30s 且超时路径可确定性验证 → ② 先量后改（旧法 >4min／单进程 find 39s／并行枚举 1s）→ ③ 改 → ④ 接线 CI 密封清单 → ⑤ 自检（53+7+9 断言）。引用铁律 7/11/35。

### b) 本任务执行约束
- rule: "超时 ≠ 不可达：前者 fail-closed(exit 2)，后者维持降级继续"
  verify: 新测试 C/D 两组断言分别覆盖
- rule: "语义等价：扫描改法不得改变号集"
  verify: 实测唯一号 495 与单进程 find 逐值一致

### c) 决策参考系
参考：第一性原理（无界外部调用＝不可控）＋ 既有契约（degraded 可见）→ 结论：便携有界 + 区分两种降级。

### d) 相关 Note 引用
- [x] `memory/notes/proposed/2026-09-30-d1091-alloc-timeout.md`（本卡）

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- `scripts/control-tower/alloc-task-id.sh`：+`_run_bounded`／+`_wt_scan`／远端腿与扫描腿有界化／超时 exit 2／header 契约同步。
- `tests/control-tower/alloc-task-id-timeout.test.sh`（新，9 断言）＋接进 `ci.yml` 密封清单。
- Note 一条。

不做什么（含文件路径）：
- 不做「worktree 占用改索引」（设计变更，需定索引维护方；另立卡）；
- 不改 `scripts/audit/audit-check.py`、`scripts/audit/analyze-transitive-closure.py`（D336 审计红线）；
- 不改 `tests/control-tower/alloc-task-id.test.sh`（53 断言）、`tests/control-tower/alloc-task-id-lock.test.sh`（7 断言）——既有夹具全绿，本卡不动；
- 不改 `scripts/control-tower/install-dsh-preset.sh`、`scripts/control-tower/check-preset-bundles.sh`（门禁冻结）；
- 不新增 `scripts/control-tower/` 下的门禁脚本（只减不加）。

## 写集

| 文件 | 类 |
|---|---|
| `.claude/task-briefs/2026-09-30-D1091-alloc-timeout.md` | task |
| `scripts/control-tower/alloc-task-id.sh` | task |
| `tests/control-tower/alloc-task-id-timeout.test.sh` | task |
| `.github/workflows/ci.yml` | task |
| `memory/notes/proposed/2026-09-30-d1091-alloc-timeout.md` | task |
| `task-state/D1091.json` | task |
| `.claude/bypass.log` | builtin（synova-commit D414：证据链随提交入库，非人工写入） |

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：任何线调用 `bash scripts/control-tower/alloc-task-id.sh "<任务名>"`。
处理（中间经过哪些步骤）：远端腿（有界 20s）→ 扫描腿（有界 30s，并行枚举）→ 占用表合并 → 发号。
结果（最终展示在哪）：端到端 13s 出号；超时则 exit 2 + degraded 明示。

## 架构层: 基础设施（控制塔工具面，非 L1–L5）
## 文档引用: `审计发现台账-DSH-CTO.md` 第七批①；`D940` 历史卡；`DOC-CONTRACT.md`（本卡过程件落库外仓）
## 接口审计: 无产品代码接口变更；脚本新增环境变量 2 个（SYNO_ALLOC_SCAN_TIMEOUT / SYNO_ALLOC_TEST_STALL_SECS）

#CRITERIA: A

## Done 标准
- [ ] 入口可触达: 端到端真仓取号 ≤30s（实测 13s）
- [ ] 链路走通: 新测试 9/9 ＋ alloc-task-id.test.sh 53/53 ＋ 锁测试 7/7；新测试已入 ci.yml
- [ ] 结果可见: `git log -1 --oneline -- scripts/control-tower/alloc-task-id.sh` 有提交
