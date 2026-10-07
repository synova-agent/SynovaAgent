# Task Brief: D749 write-set-generated-single-source

> 生成: 2026-09-14 | 任务: D749 | 认领: 主 CTO（synova-cto）
> 参考: 创始人指令「固定一个格式/流程，保证开始时就一次做对」

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔「声明层」根治（非五层）。CTO 本日在单条 PR 上被 G12 → V5 → D708 连拦三次（~1 小时），**根因全部是"改的文件 vs 声明的写集"不一致**。
### b) 文件审计（实测）
- brief 写集手写在散文里 → 漏写（brief 自身 / task-state / bypass.log）、格式错（`、`连接、反引号、全角标点）
- 四道门禁（G12 / D708 / CI 棘轮 / staging-guard）各自解析同一份散文 → 四套口径
- 本地 pre-commit 对这几类为**软提示**（不阻断）→ 错误只能在 CI 被抓（15~30 分钟/轮）
### c) 决策
写集改为**机器块 + 生成器**：`declare-write-set.sh` 从真实变更集生成，人只审不写。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 35（自动化优先）：能变规则的别靠文档；能生成的数据别手写
- 铁律 47：声明必须由物理证据支撑 → 写集证据 = git 变更集
- V4.5.1 教训：本地软提示 = 0% 有效（本单先做生成器；本地硬阻断化另单）
### 参考：铁律 35/47 + V4.5.1 → 写集由工具生成（消除手写类错误）

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/declare-write-set.sh — 写集生成器（读 git 变更集 → 生成 WRITE-SET 机器块；builtin 自动豁免；三态退出码）
- tests/control-tower/declare-write-set.test.sh — 配对测试（6 断言）
不做什么：
- 不改 scripts/audit/（审计红线）
- 不改四个门禁脚本本身（口径收敛另单，避免撞车）
- 不改 .github/workflows/ci.yml（批 C）

## Q3: 验收 — 入口 → 交互 → 结果
入口：提交前跑 declare-write-set.sh（或用 --staged）
处理：读真实变更集 → 生成写集块写入 brief
结果：写集不再手写；漏写/格式错从"必然发生"变为"不可能"

## 架构层: 基础设施（声明层机制）
## 主线贡献: infra:消除声明层错误（本日三次 CI 往返的根因）
## 域: mac

## Done 标准:
- [ ] 配对测试全绿：bash tests/control-tower/declare-write-set.test.sh → 6 通过 0 失败
- [ ] 生成器幂等：连跑两次 → 块唯一（grep -c WRITE-SET:BEGIN == 1）
- [ ] builtin 自动豁免：变更含 .claude/bypass.log 时块内标注 builtin
- [ ] 空变更集不静默：exit 2

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-14-D749-write-set-generated-single-source.md | task |
| scripts/ci/verify-doc.sh | task |
| scripts/control-tower/brief_parser.py | task |
| scripts/control-tower/declare-write-set.sh | task |
| scripts/pre-commit-check.sh | task |
| task-state/D749.json | task |
| tests/control-tower/declare-write-set.test.sh | task |

