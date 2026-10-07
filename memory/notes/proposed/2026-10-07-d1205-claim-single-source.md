# 状态: proposed
# 日期: 2026-10-07
# 决策: D-C 标识与声明归一 —— 声明收敛为单一 claim 库；旧 D# 链只读保留；防劫持守卫为"减法"
# 理由: 见下（K3 变更前预审 2026-10-07 整改 R1-R7）

## 决策内容

1. **声明载体单源**：`.claude/claims/<issue号>.yaml`（字段仅 `writeset` + `done`，可选 `note`）。
   解析实现单源在 `scripts/control-tower/claim_store.py`；所有消费者经 `brief_parser.py`
   的 claim 分支取用 —— **不新增第二套解析口径**。
2. **迁移期优先级**：存在 issue claim 时**禁用** D# 强锚点回退
   （`resolve-commit-brief.sh`），防止"旧 D# 分支名 + 新 claim 并存"的双口径劫持。
3. **单一 feature flag**：`SYNO_CLAIM_V2`（**默认关**）。关 = 逐字节 legacy，回滚 = 关开关。
4. **防劫持守卫不随开关回退**：守卫是**减法**（移除一条回退），无 claim 时行为零变化；
   若随开关关闭，回滚态本身即带着 K3 定罪的 P0 劫持路径。
5. **三态退出码**：0 通过 ／ 1 违规（含**声明缺失 fail-closed**）／ 2 检查自身失败（同样阻断）。

## 为什么（第一性原理）

病根不是"D# 不好"，而是**同一事实有多个真相源**：brief Q2 散文 / current-brief /
task-state JSON / 分支名锚点，四者各自解析 ⇒ 漂移不可避免。
标识退役只是表象；真正要收敛的是**声明解析的入口数**。

## 代价与已知边界（诚实声明）

- claim 两字段制**没有** `exclude`（"不做什么"）字段 ⇒ `check-plan-integrity.sh` 的排除项
  检查在 claim 上恒空（不误判，但也**不保护**）。若 K3 要求保留排除项语义，需扩 claim schema。
- 迁移期消费者侧改动（6 条"显式降级"）**未在本批完成** —— 那些文件不在治理线 A 写集内，
  需另行派单。当前以 `--legacy-view` / `--migration-marker` 提供接入点。
- 存量 431 张 task-state 卡按"只读保留"处置（≥2 周），**未删**；去留待 K3 R7 的 git 历史核验。

## 关联

- 卡：#1221（父）／#1224（D-C）／D1205
- K3 预审：`2026-10-07-k3-审计报告-D-C标识与声明归一-变更前预审.md`
- 触及面清单：`docs/synova/coordination/D-C-标识归一-触及面清单.md`
- 夹具：`tests/control-tower/claim-identity-v2.test.py`（a/b/c + 4 变异体）
