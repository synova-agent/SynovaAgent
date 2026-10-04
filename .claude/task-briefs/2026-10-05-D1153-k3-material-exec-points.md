# Task Brief — D1153 治理线三件（K3 送审材料 / 密封面差集 / 执行点口径）

> 卡: task-6（治理线 · 文书与取证）｜线: 治理线（govl）｜日期: 2026-10-05｜执行者: govl-k3-materials
> 分支: `docs/D1153-k3-material-exec-points`｜工作树: `.synova-wt-k3m`（基线 `origin/main` @ `13b294013`）
> 【坐标系】执行态=待K3/待复核｜施工批次=批3 门禁治理（本波次后置件）｜服务承重件=门禁治理材料面（非产品面）｜
> 总闸=#973 无关（本件不改任何执行体）｜命名空间=D1153｜验证级别=L2（本地判据 + `doc-registry-gate.sh` 真跑 rc=0）｜
> 阻塞源=K3 通道未在册（本件即为补通道；材料落库后解除）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
治理线「文书与取证」面，**不属产品五层**。本件服务于本波次门禁治理的**收口闭环**：
把已冻结的两个语义变更 PR（#1077 `435e58263` / #1107 `ac1829ca0`）**送进 K3 通道**（此前无通道在册，属合规缺口）；
把 T6 找错载体的「2 行 ci.yml 登记」**重找载体**；把 CTO 明裁「先定口径，再给数」的**执行点口径**定下来。
三件均**只读调查 + 文档落库**，**不改任何门禁逻辑、不改 `ci.yml`、不改任何在飞 PR 的分支**。

### b) 文件审计（改前实测）
- `docs/synova/coordination/K3-AUDIT-MATERIALS.md`、`K3-AUDIT-STANDARD-TASK.md`、`K3审计请求-D964-门禁语义变更-20260925.md`
  —— 仓内既有三种 K3 件形态；本件照 **D964 送审单**（对象表 + 待判问 + 自核命令）结构写，不自创格式。
- `docs/authority/DOCS-REGISTRY.yaml` —— D2 登记门禁（`scripts/doc-system/doc-registry-gate.sh`）的台账；现有最大 id = `DOC-0142`
  （in-flight：#1077 与 #1079 **同用 DOC-0143**，见「例外清单」）。
- `scripts/control-tower/check-gate-integrity.sh:604-671` —— 密封面 ratchet 的判据与口径（`find tests -name '*.test.sh|py'` − `ci.yml` 全文登记）。
- `scripts/control-tower/merge_writeset_gate.py` + `brief_parser.py:43-55` —— D708 写集对账读 **`## 写集` 机器块**（D749 单一事实源）。
- `tests/control-tower/*.test.sh`（实测 71 条未登记）+ `tests/{doc-system,project,desktop}/`（6 条）—— 差集对象。

### c) 决策
- 已有覆盖 → 复用：K3 件形态复用 D964；登记复用 `DOCS-REGISTRY.yaml`；计数复用 `check-gate-integrity.sh` 的既有口径（**不自创第三套**）。
- 无覆盖 → 新建：三份文档（送审件 / 差集报告 / 口径文档各一）。
- 冲突 → 规避：① **不新建** `scripts/control-tower/check-execution-points.sh`（口径未裁前落地 = 先给数后定口径，
  且新脚本会自指污染 G5 分母 + 撞密封面棘轮，理由见 `执行点基线-G1-G9.md` §二）；② 登记条目**插在 DOC-0140 之后**，
  避开 #1077/#1079 的尾部追加块，降低同波次文本冲突概率。

## Q1: 调研 — 业界最佳实践 / 决策链 / memory 历史教训

- **判例 V-05（禁中间态）**：送审件必须钉**冻结 head**（`435e58263` / `ac1829ca0`），头部再动即重锚。
- **判例 V-02（grep 不是验收）**：口径命令必须给**枚举源**，不能只给一个 `grep | wc -l` 的数。
- **判例 V-03（非作者独立复核）** / **M-02（三态退出码）**：复核签字 ≠ K3 过审，两栏分开写；命令三态 `0/1/2`。
- **CTO 明裁（2026-10-05）**：**先定口径，再给数**；口径定死前数字不入台账分母 ⇒ 本件 §四「不可比」逐条标注。
- **memory 教训**：`验"-84"式"声称完成"必须给可复跑命令`（D316）；`棘轮只减不增`（M-03）；
  `运行期产物不进版本控制`（M-05，本波次 #1075 已处置）；`改门禁者不自判`（A5 送审链）。
- **参考**：Anthropic「证据优先、断言可证伪」+ 第一性原理（口径必须先于数）。

## Q2: 范围 — 正确的最简方案

做什么：
1. **D1153-1 K3 送审材料落库** → `docs/synova/coordination/K3-送审-门禁治理波次-20261005.md`
   （对象表 + 逐条语义变更引用 + K3 待判 6 问 + 自核命令 + 缺口清单；**两冻结锚点各引用 ≥1 次**）。
2. **D1153-2 密封面差集与载体判定** → `docs/synova/coordination/未登记密封面清单-20261005.md`
   （`origin/main` 实测 + 全量 77 条差集 + 逐条调用方证据 + T6「2 行」载体判定 = PR #1079）。
3. **D1153-3 执行点口径与实测** → `docs/synova/coordination/执行点基线-G1-G9.md`
   （一句话定义 + 一条可复跑命令 E0（`sed | bash` 抽取，不新建执行体）+ `as_of` 实测 + 与 130 基线的逐面可比性 + 新脚本契约草案）。
4. 登记：`docs/authority/DOCS-REGISTRY.yaml` 追加 `DOC-0144/0145/0146`（**追加型，不动既有条目**）。
5. 本 brief 与 Note：`.claude/task-briefs/2026-10-05-D1153-k3-material-exec-points.md`、
   `memory/notes/proposed/2026-10-05-d1153-k3-material-exec-points.md`。

不做什么（含文件路径）：
- **不改 `ci.yml`**（`.github/workflows/ci.yml` 归 T3/Lead；本件只给插入位置与形式建议）；
- **不改任何门禁语义**：`scripts/pre-commit-check.sh`、`scripts/control-tower/check-gate-integrity.sh`、
  `scripts/doc-system/doc-registry-gate.sh` 一律只读；
- **不碰 `scripts/audit/**`**（K3 域红线）与 `scripts/hooks/**`；
- **不新建** `scripts/control-tower/check-execution-points.sh` 及任何 `.test.sh` 夹具（避免密封面棘轮"基线外新增"）；
- **不改** `tests/control-tower/` 下任何夹具（本波次 #1107 正在改其中 2 个，防写集重叠）；
- **不碰** in-flight 分支：`chore/D1147-single-gate-set`、`chore/D1148-decl-consolidate`、`chore/D1150-asset-reclaim`；
- **不合并任何 PR、不开 auto-merge、不使用 `--no-verify`**（本线当前无合并权）；
- 不改 `docs/authority/DOCS-REGISTRY.yaml` 的既有条目（只追加 `DOC-0144/0145/0146`）。

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash scripts/doc-system/doc-registry-gate.sh`（D2 登记门禁）＋ 三份文档的直接阅读。
处理：送审件提供 K3 可独立复跑的 8 条命令；差集报告提供与门禁逐条一致的复算命令；口径文档提供 `sed | bash` 单行命令。
结果：三份可直接交付 K3/CTO 的件；`doc-registry-gate.sh` rc=0；两锚点引用计数 ≥1。

## 架构层: L0（治理层，非产品五层 L1–L5）

## Done 标准:
- [x] 三份文档落库，且送审件同时引用两冻结锚点（`grep -c` 各 ≥1） verify: `grep -c 435e58263 docs/synova/coordination/K3-送审-门禁治理波次-20261005.md`
- [x] 差集清单与门禁 verbose 输出**逐条一致** verify: `diff <(find tests -name '*.test.sh' -o -name '*.test.py' | sort) <(grep -oE 'tests/[^ ]+\.test\.(sh|py)' .github/workflows/ci.yml | sort -u) | wc -l`（应 = 77）
- [x] 口径命令可复跑且打印 `as_of` SHA verify: `sed -n '/^# ===E0-BEGIN===/,/^# ===E0-END===/p' docs/synova/coordination/执行点基线-G1-G9.md | bash | head -2`
- [x] D2 登记门禁 rc=0（3 个新文档全部登记） verify: `bash scripts/doc-system/doc-registry-gate.sh`
- [x] 未改任何门禁执行体 verify: `git diff --name-only origin/main...HEAD | grep -E '^(scripts/|\.github/|tests/)' | wc -l`（应 = 0）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-05-D1153-k3-material-exec-points.md | task |
| docs/authority/DOCS-REGISTRY.yaml | task |
| docs/synova/coordination/K3-送审-门禁治理波次-20261005.md | task |
| docs/synova/coordination/执行点基线-G1-G9.md | task |
| docs/synova/coordination/未登记密封面清单-20261005.md | task |
| memory/notes/proposed/2026-10-05-d1153-k3-material-exec-points.md | task |
