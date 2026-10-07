---
name: pr-review
description: PR 合并前审查流程（DeepSeek Harness 专属职责）。收到任何 PR 合并审查请求时使用。结构化输出 通过/阻塞/建议，阻塞项必须附文件+行号+铁律编号。历史：TASK-ROUTING D336 规定 Claude 的 PR 先过 DSH 这关。
---

# pr-review — PR 合并前审查

## 使用时机
收到 PR 合并请求（TASK-ROUTING：Claude Code 的 PR 先过 DeepSeek Harness）。PR 审查 ≠ 审计——不下审计结论，审计只认 K3 报告；但审查必须物理复现，不凭 PR 描述。

## 审查五步（每步输出物理证据，不写"看起来没问题"）

### ① 范围与撞车（D336 认领制）
- PR 涉及模块在 `docs/synova/coordination/TASK-ROUTING.md` 当前认领状态是否与 PR 作者一致？撞车 → 停，转创始人仲裁
- 分支是否 feat//fix//chore/（铁律 34）？是否曾 force push（`git reflog` 检查）？禁止直接 push main（铁律 0-3）
- V5.2.0：PR 描述宜含"clone 完成"声明（在 `.sessions/<sid>/repo` 独立 clone 内完成）；写集对账已由 CI/PR 阶段 verify-parallel `--ci-pr` 权威兜底，审查仍需抽查写集与 dev doc 一致，但不重复跑本地全量对账

### ② 铁律逐项物理检查（bash 说话）
```bash
# as any（铁律 38, 全仓零容忍）
grep -rn "as any" <PR改动文件>
# 空 catch / 静默降级（铁律 11/24）
grep -A2 "catch" <文件> | grep -v "log\."
# 新 export 接线（铁律 0-2 WIRE CHECK）
grep -rn "<新函数名>" src/     # 零结果 = 未接线
# 测试非空壳（铁律 48）
grep -c "expect(" <新测试文件>
# 架构边界（铁律 39）+ engine-core（铁律 46）
bash scripts/check-architecture.sh && bash scripts/check-bridge-files.sh
```

### ③ 声称 vs 事实（claim-verifier 精神）
- PR 描述每条"已完成 X"声称 → 逐项物理复现。声称"拆完了/清理完" → grep 零引用证明
- 声称"测试通过" → 自己跑 `vitest run --changed`；声称"门禁过" → 看 bypass.log 是否落窗（D331 对账）

### ④ 门禁自洽
- PR 是否动了门禁脚本（pre-commit/check-*/synova-commit）？→ 改门禁的 PR 额外加载 ctrl-tower-change 技能逐模式核对
- PR 是否动 scripts/audit/？→ 直接拒绝并转 K3（红线，违反 = 事故）

### ⑤ 输出结构化审查结论
```
结论: 通过 | 有条件通过 | 阻塞
阻塞项: [文件:行号] 铁律N — 现象（可复现命令）
建议项: [文件:行号] 说明（非阻断）
自检: 每项结论都有物理命令支撑
```

## 红线
- PR 审查 ≠ 审计；不对审计标准下结论
- 不修改 scripts/audit/ 与审计标准；审计类问题只转达 K3
- 审查报告同样遵守"文件+行号+为什么"（自己的汇报纪律）
