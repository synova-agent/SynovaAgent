# D1073 — X30 M2 前置：verdict 回填基线（机械层）

- **状态**: proposed
- **日期**: 2026-09-30
- **决策**: 新增 `scripts/control-tower/verdict-baseline.py`（**只读**）——全量扫描 `task-state/*.json`，
  统计 verdict 的**位置异构 / 值域异构 / 时序与元数据异常**，并产出 30 张「含 verdict」的逐卡样本，
  落 `docs/synova/coordination/verdict回填基线-20260930.md`。
- **理由**:
  - 令 §二 T6 要求「脚本比对 406 张卡的值域/时序/位置异构，首日全量核 30 张定基线」。
  - **硬顺序③**：verdict 回填完成前不得启动元审计（否则漏检追溯无数据 → 「K3 无漏检」假绿，K3 §九不该做 3）。
    故先把地基量清：位置先冻结、值域先归一，人工核对才不会返工。
  - **D336 审计红线**：本件是数据质量基线工具，**不定义审计判据、不判定任何卡是否通过**；
    落点在 `scripts/control-tower/`（工程数据面），不落 `scripts/audit/**`。判定归 K3。
- **实测基线（2026-09-30，全量 406 张，耗时 0.02s）**:
  - 含 verdict **173** 张（覆盖 42.6%），无 verdict **233** 张；解析失败 0。
  - **位置异构 5 类**：`audit.verdict` 172 ／ 顶层 `verdict` 3 ／ `impl.verdict` 1 ／ `impl_report.verdict` 1 ／ `ci.verdict` 1
    → 建议冻结唯一位置 `audit.verdict`（与既有 172 处一致）。
  - **值域偏离 7 类 8 处**：小写 `pass`×2、`DONE`、`CTO 验收通过（非 K3）`、`无 K3（…）`、长自由文本×2、非字符串（嵌套对象）×1；
    另 `CONDITIONAL PASS`(29) 与 `CONDITIONAL_PASS`(6) 两种写法并存 → 回填前需**先冻结枚举**（PASS/CONDITIONAL_PASS/FAIL/NOT_AUDITABLE）。
  - 时序倒挂 0；缺 `audit.at` 或 `audit.by` **28** 处（元审计无追溯锚）。
  - **量级口径**：机械层 0.02s 已完成；原估「4–6 人日」是**人工逐卡核对**口径（406 × 30–45 秒 ≈ 4.2 小时），不因机械扫描缩小。
- **验收证据**: `bash tests/control-tower/verdict-baseline.test.sh` = **PASS=9 FAIL=0**
  （正常三位置 / 值域偏离 / 非字符串边界 / 坏 JSON 降级 / 目录缺失 exit 1 / 时间倒挂标记）。
- **待办**: 位置与枚举的**冻结决定**需 CTO/K3 确认后，方可开展人工回填（本件不代为决定）。
