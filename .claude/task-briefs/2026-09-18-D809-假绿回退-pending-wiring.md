# Task Brief: D809 假绿回退-pending-wiring

> 生成: 2026-09-18 | 任务: D809 | 认领: DeepSeek Harness
> 依据: CTO 派单【编码 session A｜假绿回退】+ K3 2026-09-18 D808 审计 P0（B-02/B-05/B-06 未接线）
> 参考: D333 决策四步（第一性原理 → Anthropic 工程基线 → 开源/仓内实证 → 收敛检查）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
Synova = AI 诊断 Agent。本任务**不进 L1-L5 产品运行时**，属**控制塔派生层**（`scripts/project/` + `docs/synova/project/`）。
链路: `docs/synova/project/26线-V1验收标准-v0.2-20260917.md` 附录 A（128 条断言，机器源）
  ＋ `docs/synova/product-lines/evidence/*.json`（证据记录）
  → `scripts/project/gen-project-board.py`（按「断言证据列 kind ↔ 证据 record_type」机械配对判分）
  → `docs/synova/project/ledger.json`（派生账本）
  → D794/D795 侧边栏「项目总览」看板（`dsh/plugins/synova-dashboards/lib/ledger.js` 只读）
断点（本单修的就是它）: 20-3 / 20-5 / 22-1 三点在 K3 D808 审计中被判 P0「B-02/B-05/B-06 未接线」，
但判据源里它们的证据列仍是 `test`，而 `test` 类证据记录**存量已有 13 份**（08-17 至 09-18）→ 看板持续亮绿灯（假绿）。
判分器**不读代码存在性**（DSH借鉴指引 v2 §11 已诊断），所以撤回只能落在**判据源**上。

### b) 文件审计
- `scripts/project/gen-project-board.py:434` → `matched = [c for c in cands if c["kind"] == a["kind"]]`：计分 = kind 与 `record_type` 强配对（假绿的物理成因）
- `scripts/project/gen-project-board.py:253` → `kind = cells[3] if cells[3] in EVIDENCE_PRIORITY else (cells[3] or None)`：未知 kind 原样保留（`pending_wiring` 天然不会与任何证据配对）
- `scripts/project/gen-project-board.py:426,499-508` → `v1_passed` / `totals` 组装点（本单新增 `pending_k3` 分类处）
- `docs/synova/project/26线-V1验收标准-v0.2-20260917.md:429`（20-3）/ `:431`（20-5）/ `:458`（22-1）→ 三条证据列现值 = `test`
- `docs/synova/project/26线-V1验收标准-v0.2-20260917.md:98` → 附录 A 头注「证据列按 CTO 2026-09-18 映射：`test` = 20-2/20-3/20-5/…」（随撤回同步，铁律 9 传播）
- `docs/synova/project/26线-V1验收标准-v0.2-20260917.md:533` → 附录 B 落库哈希 `97288654`（覆盖附录 A，随本次改动失效 → 同文件登记新哈希）
- `tests/project/gen-project-board.test.sh:369` → 组⑦ 正则 `([a-z0-9\-]+)` **不含下划线** → `pending_wiring` 行会被静默漏解析并误报「冻证件不一致」（必须同步修）
- `tests/project/gen-project-board.test.sh:348-364` → 组⑥ 真实仓库冒烟（读数断言点，本单扩测）
- 消费者审计: `dsh/plugins/synova-dashboards/lib/ledger.js:23-25` 只做 `JSON.parse`，无 schema 白名单 → 新增字段安全；`lib/client.js:104` 状态词表已含 `pending_k3:"待K3"`（口径同名）
- CI 现状: `.github/workflows/ci.yml:235-245` canary 清单只含 `tests/control-tower/*` 与 `tests/doc-system/*` → `tests/project/gen-project-board.test.sh` **不在 CI**，本单靠本地 + pre-commit 验收

### c) 决策
- **复用**既有「kind ↔ record_type 配对」判分机制（判分算法零改动），只新增一个**非证据 kind**；不新建派生器、不发明第二套判分。
- **复用**仓内既有状态词表 `pending_k3`（`dsh/plugins/synova-dashboards/lib/client.js:104` 已定义「待K3」），不另造词。
- **不取消**任何既有资产: 存量证据记录（含 D806 那份）一律不改——撤回是判据源变更，不是删历史。
- 撞车回避: 看板插件 `dsh/plugins/synova-dashboards/**` 当前有并行 session 改动（主工作区分支 `feat/d782-doc-truth-wiring` 暂存区已含 `lib/client.js`）→ 本单物理不碰。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **第一性原理**: 假绿的本质不是「数字算错」，是**判据源里没有『已交付但未接线』这一态**——读者只能从「无证据」里猜。最简机制 = 在判据源加一个非证据标记，让派生器显式归类，而不是再加一层说明文档。
- **Anthropic 工程基线**: ① fail-closed（`pending_wiring` 永不计通过——即便有人伪造 `record_type=pending_wiring` 的证据记录也点不亮）② 机器可验（状态字段 + 计数，不靠散文）③ 派生只读（`ledger.json` 由脚本重算，禁手改）。
- **memory/ 教训**: `memory/notes/proposed/2026-09-18-d806-ledger-dsh-alignment.md`「看板只读『证据 × 验收点』绑定，不读代码存在性」→ 撤回必须写进判据源，否则派生器无从知道；D793 Note「TTL 到期即扣完成度 → 完成度不单调」→ 反向恢复路径必须保留（改回 `test` 即回 25，不做不可逆删除）。
- **本单独立复现的物理事实（非转述派单）**:
  - `git grep -n "callWithResilience\|streamWithRetry" origin/main -- src/` → 除 `src/llm/retry-middleware.ts` 自述与 `src/llm/types.ts` 注释外**零调用方** = B-02 未接线
  - `git grep -n "invariant" origin/main -- src/` → 无任何不变量注册表文件 = 22-1 所要求的 `dsh-invariants` 范式未见落地
  - 20-3/20-5 的组件层有生产调用点（`src/agent/conversation-engine.ts:48,596,752`；`src/llm/retry-middleware.ts:25` 引 `timeout`），但其 **M3 锚点仍为 Win 旧路径**（D808 §11.3 ③ 具名的 4 文件之一）→ 依派单判「未接线」，本单照派单执行撤回并在交付报告如实分列这两类事实。
- **铁律引用**: 铁律 7（Done 标准可验）、铁律 9（关键变更 grep 传播）、铁律 11/24/31（不静默降级）、铁律 47/48（契约 + 非空壳测试）、铁律 0-5（不碰 `scripts/audit/**`）、铁律 0-3（worktree 隔离 + PR）
- 参考：第一性原理 + Anthropic fail-closed 基线 + 仓内实证（kind 配对机制已存在） + 结论：**判据源加非证据 kind `pending_wiring`，派生器 fail-closed 归类为 `pending_k3`，反向可复原**。

## Q2: 范围 — 正确的最简方案
做什么：
- docs/synova/project/26线-V1验收标准-v0.2-20260917.md — 附录 A 三条证据列 `test` → `pending_wiring`（20-3 / 20-5 / 22-1）+ 头注映射同步 + 附录 B 落库哈希登记新值
- scripts/project/gen-project-board.py — `pending_wiring` 一等非证据态：永不配对（fail-closed）→ `status=pending_k3`，不计 `v1_passed`/保鲜；`totals.pending_k3` + `lines[].pending_k3` 显式计数；契约注释更新（铁律 47）
- tests/project/gen-project-board.test.sh — 组⑦ kind 正则补 `_`；新增组⑧ `pending_wiring` 语义（正常/降级/边界三路径 + 反向恢复）；组⑥ 补真实仓库三点状态断言
- docs/synova/project/ledger.json — 重跑派生器刷新（机器生成，禁手改）
- task-state/D809.json — 状态机登记（impl 段 + write_set + verify）
- memory/notes/proposed/2026-09-18-d809-pending-wiring.md — 铁律 49 决策沉淀（口径变更记录）
- .claude/task-briefs/2026-09-18-D809-假绿回退-pending-wiring.md — 本 brief
不做什么：
- 不改 docs/synova/product-lines/evidence/D806-borrow-cards-20260918.json（存量证据只增不改——撤回靠判据源 kind 变更，不篡改历史记录）
- 不改 docs/synova/product-lines/product-lines.yaml（另一条判分链的真相源，本单零改动）
- 不改 scripts/product-lines/calc-progress.py（判分脚本红线，本单零改动）
- 不改 dsh/plugins/synova-dashboards/lib/client.js（看板插件并行 session 占用中——撞车回避，接线缺口见交付报告「待派」）
- 不改 scripts/audit/ 下任何文件（铁律 0-5 K3 红线）
- 不改 src/ 下任何产品代码（本单只改台账判据与派生器，不写产品功能）

## Q3: 验收 — 入口 → 交互 → 结果
入口：D794 侧边栏「项目总览」面板 → `GET /synova/pm/ledger`（读 `docs/synova/project/ledger.json`）
处理：附录 A 三点证据列 `pending_wiring` → `gen-project-board.py` 按 fail-closed 归类（永不配对）→ 重算账本
结果：`totals.v1_passed` 由 25 → **22**（三点点亮撤回）；三点 `status="pending_k3"` 且不进保鲜分桶；**反向**: 接线完成后把证据列改回 `test` → 下一轮派生自动恢复 25（不做不可逆删除）

## 架构层: 基础设施
控制塔派生层（`scripts/project/` + `docs/synova/project/` + `tests/project/`），不进 L1-L5 产品运行时，不 import `src/**`；只读 `src/` 的存在性证据。

## Done 标准
- [ ] ① 三点证据列 = `pending_wiring`（机器解析，非文本 grep）— verify: `python3 -c "import importlib.util,sys;from pathlib import Path;spec=importlib.util.spec_from_file_location('g','scripts/project/gen-project-board.py');g=importlib.util.module_from_spec(spec);sys.modules['g']=g;spec.loader.exec_module(g);L,_,_=g.parse_v1_dod(Path('docs/synova/project/26线-V1验收标准-v0.2-20260917.md'));got={a['id']:a['kind'] for l in L for a in l['assertions']};bad={k:got.get(k) for k in ('20-3','20-5','22-1') if got.get(k)!='pending_wiring'};assert not bad,bad"` exit 0
- [ ] ② 重算后 v1_passed 25 → 22（三点点亮撤回）— verify: `python3 -c "import json;t=json.load(open('docs/synova/project/ledger.json',encoding='utf-8'))['totals'];assert t['v1_passed']==22,t['v1_passed']"` exit 0
- [ ] ③ `pending_wiring` 计为 `pending_k3` 且不计 passed — verify: `python3 -c "import json;d=json.load(open('docs/synova/project/ledger.json',encoding='utf-8'));assert d['totals']['pending_k3']==3,d['totals'].get('pending_k3');a={x['id']:x for l in d['lines'] for x in l['assertions']};bad={k:(a[k]['status'],a[k]['ok']) for k in ('20-3','20-5','22-1') if a[k]['status']!='pending_k3' or a[k]['ok']};assert not bad,bad"` exit 0
- [ ] ④ 反向可证伪：接线完成后改回 `test` 即恢复 25 — verify: `bash tests/project/gen-project-board.test.sh 2>&1 | grep -q "组⑧.*反向"` 且 `bash tests/project/gen-project-board.test.sh 2>&1 | tail -1 | grep -q "FAIL=0"` exit 0（夹具内翻转 kind 实测 22↔25，不污染仓库）
- [ ] ⑤ 派生器自测全绿（含新增组⑧三路径）— verify: `bash tests/project/gen-project-board.test.sh 2>&1 | tail -1 | grep -q "FAIL=0"` exit 0
- [ ] ⑥ 分母/backlog 不受影响（撤回不改分母）— verify: `python3 -c "import json;t=json.load(open('docs/synova/project/ledger.json',encoding='utf-8'))['totals'];assert (t['v1_total'],t['backlog_points'])==(128,36),(t['v1_total'],t['backlog_points'])"` exit 0
- [ ] ⑦ 冻证件 §〇–§六 逐字节未动（签字哈希复现 c11841e6）— verify: `bash tests/project/gen-project-board.test.sh 2>&1 | grep -c "✅ 签字区 sha256"` 等于 1 且 `bash tests/project/gen-project-board.test.sh 2>&1 | tail -1 | grep -q "FAIL=0"` exit 0
- [ ] ⑧ 派生可复现（同输入重跑读数逐键相等）— verify: `python3 scripts/project/gen-project-board.py --today 2026-09-18 --out /tmp/d809-replay.json && python3 -c "import json;a=json.load(open('docs/synova/project/ledger.json',encoding='utf-8'));b=json.load(open('/tmp/d809-replay.json',encoding='utf-8'));assert a['totals']==b['totals'],(a['totals'],b['totals']);assert [l['v1_passed'] for l in a['lines']]==[l['v1_passed'] for l in b['lines']]"` exit 0
- [ ] ⑨ 证据记录零改动（撤回不篡改历史）— verify: `git diff --name-only origin/main...HEAD | grep -c "docs/synova/product-lines/evidence/"` 等于 0
- [ ] ⑩ 本地 CI 等价验收全绿 — verify: `SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh && bash scripts/control-tower/simulate-ci.sh` exit 0

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-18-D809-假绿回退-pending-wiring.md | task |
| docs/synova/project/26线-V1验收标准-v0.2-20260917.md | task |
| docs/synova/project/ledger.json | task |
| memory/notes/proposed/2026-09-18-d809-pending-wiring.md | task |
| scripts/project/gen-project-board.py | task |
| task-state/D809.json | task |
| tests/project/gen-project-board.test.sh | task |
