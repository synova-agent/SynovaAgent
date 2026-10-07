# Task Brief: D709 dispatch-parallel-cto-batch

> 生成: 2026-09-11 | 任务: D709 | 认领: 主 CTO（synova-cto）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）；cto-handover skill §〇b/§〇c

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔派单与任务号登记批次（非五层）。为「并行 CTO 控制塔收口批次」出派单文档，并把 4 个
任务号（D706 synova-commit 删除项丢失 / D707 brief 双解析器 / D708 合并级写集对账 gate /
D709 本派单登记）按「先登记后使用」原则入 main，物理防撞车。
### b) 文件审计
- `bash scripts/control-tower/alloc-task-id.sh` × 4 → 实测输出 D706 / D707 / D708 / D709（`ls
  task-state/` 无同号；Win 线 D700-D704 不占本号段）
- 派单模板 `docs/synova/coordination/派单模板.md`（120 行，固定结构）——本派单逐节对齐
- 基线复核实测（main `4d9776de`）：`git grep -nE "grep +-[a-zA-Z]*P" -- scripts/` = 10 文件
  28 处；synova-commit L600/602/693/695；pre-commit-check.sh 组6 段 L763；
  check-brief-parseable.sh L73-76；ci.yml L51-57；DSH 源码 dsh-hook-protocol/lib/{invariant,index}.js
### c) 决策
新建派单文档 + 登记壳，零改产品代码。D664 brief 基线修正（漏算 pre-doc-audit.sh 3 处、
处数 28 非"6"）——与本批次同 PR 入库。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- cto-handover §〇c：派单六步 SOP（写前核实 6 项→写→写后自检 8 项→交付前物理复核 5 项→提交→
  给创始人复制段）；本单全部执行并在文档内留证。
- cto-handover §〇b：派单必带 DSH 借鉴核查三步（施工图四色→借鉴边界→源码文件+行号），
  无借鉴也必须写明原因（防执行方猜测）。
- memory 教训：D547/D545（骨架 brief 误提交）+ 本 session 实见 121 个「并发测试-N」垃圾 brief
  → 派单材料必须填实、命名规范；D382/D384（任务号分散自编必然撞车）→ 一律走 alloc-task-id。
### 参考：第一性原理（派单质量=执行方可直接开工）+ 模板固定结构 + 实测基线 → 结论：照模板出单、先登记号、基线以实测覆盖旧声明。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/coordination/派单-并行CTO-控制塔收口批次-20260911.md — 新建派单文档（模板全节）
- task-state/D706.json — alloc 登记壳入库（synova-commit 删除项丢失）
- task-state/D707.json — alloc 登记壳入库（brief 双解析器统一）
- task-state/D708.json — alloc 登记壳入库（合并级写集对账 gate）
- task-state/D709.json — 本单状态登记
- .claude/task-briefs/2026-09-11-D709-dispatch-parallel-cto-batch.md — 本 brief
- .claude/task-briefs/2026-09-10-D664-pre-commit-check-grep-p-self-clean.md — 基线修正（漏算文件 + 处数）
不做什么：
- 不改 src/server.ts（src/ 产品代码与本任务无关）
- 不改 scripts/audit/audit-rules.sh（K3 红线，审计域禁碰）
- 不改 .github/workflows/ci.yml（Win 线 D703/D704 正在写，写集重叠）
- 不改 scripts/control-tower/synova-commit（D706 开工后由执行方改，避免同文件双改）

## Q3: 验收 — 入口 → 交互 → 结果
入口：创始人复制派单文档「派单说明」段给并行 CTO session
处理：4 任务号在 main 登记 + 派单文档含完整基线/写集/借鉴/验收
结果：执行方拿到即可开工；K3 可按验证点独立复核

## 架构层: 基础设施（控制塔台账与派单，非五层）
控制塔派单与任务号登记，不属于五层产品架构

## Done 标准:
- [ ] python3 json.load 校验 task-state/D706.json D707.json D708.json D709.json 均通过
- [ ] 5 个强制章节齐备（零输出即通过）：`for s in 写前核实 "DSH 借鉴核查" 写后自检 交付前物理复核 派单说明; do grep -q "$s" docs/synova/coordination/派单-并行CTO-控制塔收口批次-20260911.md || echo "MISSING: $s"; done`
- [ ] 派单文档内 D664 基线表与 `git grep -nE "grep +-[a-zA-Z]*P" -- scripts/` 实测一致（10 文件 28 处）
