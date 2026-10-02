# Task Brief: D1067 FIX CT-2b 夹具 BSD 宿主假设（`/usr/bin/stat` 硬编码，GNU/Linux 宿主可能误红）

> 生成: 2026-09-29 | 任务: D1067 | 认领: <开工时填> | 来源: D1064 独立自验员发现 + Mac-CTO 2026-09-29 批令立卡（欠账表）
> 参考: D1064（#894，修复本体的同文件）；windows-compat 模式 2（环境差异 = 误诊重灾区）

#CRITERIA: C

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
基础设施层（tests/control-tower 夹具），不涉产品五层。D1064 新增的 CT-2b「CI 等价」夹具
（tests/control-tower/post-commit.test.sh:161-204 起）在 GNU stat shim 环境下，`-c %Y` 委托腿
硬编码 `/usr/bin/stat`——隐含「宿主 stat 是 BSD」假设。
### b) 文件审计（实测，非记忆）
- 本机/macOS：`/usr/bin/stat -c %Y` 报 `illegal option -- c` → 委托腿拿到 BSD 语义，正确（D1064 自验实证）。
- GNU/Linux 宿主：`/usr/bin/stat` 即 GNU stat，`-c %Y` 返回真 GNU 输出 → 新代码按设计丢弃垃圾并落 shim `-f` 腿
  ⇒ **CT-2b 可能误红**（夹具测的不是 hook 而是宿主方言）。仅环境前移风险，当前 CI（ubuntu 跑 shim 全程接管）
  与 mac 本机均不受影响——D1064 双环境 17/0 实证。
### c) 决策
改夹具一处：显式声明宿主假设，或按 `uname` 分派委托 stat 路径。不新增脚本、不改 hook、不放宽判据。

## Q1: 调研 — 业界最佳实践 / 历史教训
历史教训族：D1030 裸 git init（main/master 方言）→ M5b「夹具必须 hermetic，不得依赖宿主语义」；
windows-compat 模式 2「测试要确定性，不依赖运行环境」。本卡是同族第 3 例（宿主 stat 方言）。
参考系：第一性原理（夹具自持 > 宿主假设）+ M5b/M13。

## 写集（机器块 = 单一事实源）
| 文件 | 类型 |
|---|---|
| tests/control-tower/post-commit.test.sh | task（仅 CT-2b 夹具段） |
| .claude/task-briefs/<本卡文件名>.md | task |
| task-state/D1067.json | task |

## Q2: 范围 — 正确的最简方案
做什么：
- CT-2b 夹具 `-c %Y` 委托腿：按 `uname -s` 分派（Darwin → /usr/bin/stat；Linux → shim 内自持委托或显式 skip+注释），
  或最低限度在夹具头注释显式声明「本夹具假定宿主 stat 为 BSD，GNU 宿主行为未定义」
不做什么（含文件路径）：
- 不改 scripts/hooks/post-commit.sh（D1064/#894 交付物，未合并前冻结）
- 不改判据文本、不改 simulate-ci.test.sh、不碰 scripts/audit/**、不动 gate-integrity-baseline.txt

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/control-tower/post-commit.test.sh`
处理：CT-2b 在 mac（BSD 宿主）与本机可造的 GNU 宿主模拟下结论同源
结果：双环境 `0 失败`，且改坏即红可证

## 架构层
基础设施（tests/control-tower 夹具）；非 L1–L5

## Done 标准
- [ ] verify: mac 本机 `bash tests/control-tower/post-commit.test.sh` → `0 失败`（贴原始输出）
- [ ] verify: GNU 宿主模拟（等价注入）下 CT-2b 结论与 mac 同源（贴原始输出）
- [ ] verify: 改坏即红——还原 D1064 前回退顺序 → CT-2/CT-2b 变红（贴原始输出）
- [ ] verify: `bash scripts/control-tower/check-gate-integrity.sh --root .` → `GATE-INTEGRITY: OK`
