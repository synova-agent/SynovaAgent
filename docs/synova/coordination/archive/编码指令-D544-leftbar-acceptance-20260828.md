# 编码指令 — D544 左栏 Codex 风格验收与合并准备（leftbar-acceptance）

> 交付: DeepSeek Harness · dev-doc | 2026-08-28 | 随 spec 交付，供编码 session 启动

---

## 1. 任务文档表（先读后动，顺序即优先级）

| 文档 | 路径 | 作用 |
|---|---|---|
| **验收 spec（编码唯一契约）** | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D544-leftbar-acceptance-20260828.md` | 章1 测试实跑 / 章2 8 条验收核验表 / 章3 接线核对 / 章4 合并流程 / 章5 缺口分级；DS1-DS7 完成标准 |
| 派单 D544 | 创始人 DSH 派单（2026-08-28） | 写集约束 + 5 章节要求 |
| 设计规格 v1 §六 | `docs/synova/coordination/SYNOVA-IMPL-DSH-前端交互设计-左栏Codex风格-v1.md`（tip 已清理；副本 `.wt-D537/docs/synova/coordination/` 或 `git show b0755d8b:…`） | 验收 8 条**原文**（spec §1 已全文引用） |
| D538 impl spec | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D538-frontend-leftbar-codex-20260827.md` | 实现契约权威（§4.2 接口形状 / §7.1 测试契约） |
| 北星 | `.claude/PRODUCT-BRIEF.md` §二（GA=直接用户）+ §四（L1 交互层） | 方向锚 |
| 铁律 | `AGENTS.md` 0-1/0-2/0-3/24/31/38/48 | 质量底线 |
| 前车之鉴 | D316（不实声称）/ D315（声称交付未提交）/ S-3（测试调用不计接线） | 本任务的审计焦点 |

## 2. 执行要求

认真阅读任务文档，然后执行任务。做到你的最高代码水平。任务复杂 → 先用 plan mode 做好计划再执行；先想清楚再动手（禁止没想清楚就改代码）。做完复核：与 dev doc 一致 / 不违反铁律 / 无 bug / 接线完整 / 测试到位 / 其他你认为需要复核的点。Kimi K3 会盯着你的任务，也会做最后的审计。

## 3. 任务专属硬约束（违反 = 审计 FAIL）

1. **写集精确性**: 只允许写 `electron-renderer/` 与 `tests/electron/`（spec §3.3.1 写集表）。排除: src/、scripts/audit/、scripts/pre-commit-check.sh、.github/workflows/ci.yml。收工时 `git diff --name-only origin/feat/d538-frontend-leftbar..HEAD` 必须与声明写集一致。
2. **基线与分支**: 基线 = `origin/feat/d538-frontend-leftbar`（tip **ee960a18**）。该分支已被 `.wt-D538-impl` 工作树占用检出——**禁止同分支双检出**，按 spec 章1 步骤 0 建 `feat/d544-leftbar-acceptance` 于 `.wt-d544`。开工前 `git fetch --all`；**禁 `git stash`**（铁律 0-3，用 worktree）；**禁直推 main**（门禁 0-2）。
3. **行号防漂移（M7/D524 教训）**: spec 章2/章3 的全部 file:line 基于 tip ee960a18。编码前抽验 3 处行号（如 LeftPanel.tsx L166 `.cap-section`、RightPanel.tsx L643 `CAP_DETAIL_VIEW`），漂移则先对齐再执行。
4. **诚实 RED**: 任一验证点跑不通（网络/npm registry 不可达、CI 红在切片外等）→ 如实标注 ⏸/❌ + 理由，禁伪造绿。缺口按 spec 章5 分级: 小项直修（DS3 emoji 等），大项停手报 CTO（写集外/契约变更/切片外红）。
5. **evidence 落盘**: 章1 三步实测输出 + 章2 八条标注行 + 章3 grep 结果 + CI check-runs 记录，落盘 `evidence/D544/`（K3 独立重跑可复现），并在 PR 描述同步一份。
6. **环境坑（实测在案）**: ① 本机 BSD grep **无 `-P`**（emoji 检查用 spec §9 给的 perl 命令）；② 主树 `/Users/wane/SynovaAgent/node_modules/.bin/vitest`（4.1.8）可对 `.wt-d544` 直接靶向跑（spec 章1 步骤 3 轻量替代）；③ electron-renderer 装依赖须走 npm registry（`npm ci`）；④ gatekeeper C2 对 renderer 路径有盲区（spec 决策参考已登记，不必修门禁）。
7. **零伪造红线**: `/api/ga/calibration` 不存在——任何"补一个 GA 接口"的冲动都是违铁律 8；RightPanel 存量 37 处 emoji 不修（范围外，登记即可）。

## 4. 复核清单（做完逐项自查）

- [ ] DS1-DS7（spec §11）逐项对照，禁重编号/跳号/静默缺项（S-10）
- [ ] 章1 三步全绿（renderer `npm ci` + `tsc --noEmit` exit 0 + capability.test **23/23**）
- [ ] 章2 八条全部产出 `验收N: 通过|部分|未实现 — 证据` 标注行
- [ ] DS3 小项已修: LeftPanel L217/L230/L253 emoji → Lucide（MessageSquare/Folder/Building2），修后 emoji grep = 0
- [ ] 章3 断言: 三接口 4/4/4 行命中 + `api/ga/calibration` = 0 + 状态机/权限生产接线命中
- [ ] 章4: main 已并入（唯一冲突 task-state/D538.json 取 main 侧）+ PR 已建 + 9 项 check-runs 状态记录（npm audit 黄灯标注）
- [ ] 铁律: `as any`=0（铁律 38）/ 降级诚实（24+31）/ 接线生产调用点（S-3）/ 无 --no-verify / 无 git stash（0-3）
- [ ] `task-state/D544.json` impl 段回填 + status=impl_done（D382 状态机）

## 5. 审计提示

- 提审口径: 一次提审覆盖 **D544（验收执行）+ D538（闭环合并）**；K3 核对 evidence/D544/ 独立重跑章1 三步 + 章3 grep。
- 验证点收口: 验收 8 条从「预判」收口为「标注」；合并判据 = PR CI check-runs 全绿（npm audit 黄灯豁免在案），**本地绿不算**。
- task-state: impl 段由编码 session 回填；audit 段待 CTO 合并后闭环。

---

开始吧。
