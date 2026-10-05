# 派单：左栏 Codex 风格验收合并（D544）

> 派单: CTO | 2026-08-28 | 认领: 📋 dev-doc（撰写验收 spec）→ 🛠 编码（按 spec 执行）→ CTO 复验合并
> 方法论: 战略待办 T-M-02——桌面端前端能力落地 + 消除孤儿实现（D402/D445 同型风险）
> 流程: dev-doc 出验收 spec → 编码按 spec 执行 → K3/CTO 复验合并
> 上一轮教训: D538 实现 910 行躺分支未合并（孤儿风险）；D540 CI 红（本地绿 ≠ CI 绿，交付必须 CI check-runs 确认）

---

## 写前核实（强制清单 — §〇c ①）

- [x] ① 任务来源/依赖: 战略待办 T-M-02（PR #251 补录）。上游：D538 派单统筹（设计稿 PR #220 已合 main）+ 实现分支 feat/d538-frontend-leftbar（ee960a18，已 push，910 行/10 文件）。
- [x] ② task-state 最新状态: D538 = impl_done（PR #250 回填，impl 段来自分支）；D544 = claimed（本单新取号，验收任务）。
- [x] ③ 基线资产实际存在（物理确认）:
  - 分支 `feat/d538-frontend-leftbar`（origin 已有，tip ee960a18）——electron-renderer/src/components/LeftPanel.tsx + RightPanel.tsx + stores/capability.ts + app-store.ts + styles/global.css + tests/electron/capability.test.ts（170 行）
  - 设计文档 `docs/synova/coordination/SYNOVA-IMPL-DSH-前端交互设计-左栏Codex风格-v1.md`（main，§六 8 条可证伪验收）
  - 后端 3 接口：/api/signals（sentinel.ts:46）/ /api/loops/status（loops.ts:80）/ /api/actions（actions-api.ts:54）——已核实存在（D538 派单时核）
  - electron-renderer/package.json："test": "vitest run"（**本地无 node_modules，验收需先 npm install**）
- [x] ④ DSH 借鉴核查: 沿用 D538 派单结论——🟢 死守（桌面端品牌表层）+ 理念借鉴 DSH Web GUI sidebar/nav（dsh-dashboards），Stage 3 前零代码依赖。本单为验收任务，无新借鉴。
- [x] ⑤ 写集重叠检查: D544 未占用（刚取号）；与在途无重叠（D542/D543 已合 main）。
- [x] ⑥ 上一轮教训: 实现躺分支未合并（孤儿）→ 本单终点是合并进 main；本地绿 ≠ CI 绿 → 交付必须 GitHub check-runs 确认；brief Q2 必须覆盖全部改动文件（含新增测试文件，D543 实证 G12 拦截）。

## DSH 借鉴核查（强制章节 — §〇b 三步）

1. **施工图四色归属**: 桌面端 = 🟢 死守（品牌表层，施工图 §3 明确"electron/ 品牌表层继续投入"）。
2. **借鉴边界判定**: 沿用 D538 派单已定结论——左栏导航**理念借鉴** DSH Web GUI 的 sidebar/nav 组织范式，**Stage 3 前零代码依赖**（不 npm install DSH 包、不 copy 代码）。本单为验收合并，不引入新借鉴。
3. **DSH 源码参考**: 无新增（验收任务）。

> 红线：不 npm install @deepseek-ai/dsh；不复制 OpenViking（AGPLv3）；验收含接线审计。

---

## 切片定义（CTO 已定，编码 session 复核）

| 切片 | 用户可见价值 | 验证锚点 | 依赖 |
|---|---|---|---|
| D544（本次） | 左栏能力导航 + 右栏联动可用，实现合入 main（孤儿消除） | 设计文档 §六 8 条逐条标注 + CI 三 job 绿 | 上游 D538 实现（分支）已就绪 |
| （后续）T-M-03 | GA 置灰转真数据 | 等后端 /api/ga/calibration | 本单 + 后端 Module-3 |
| （后续）T-M-01 | Win 部署验收 | founder-demo-win runbook | 本单（桌面端前端完整） |

## 现状材料（编码 session 必读，先读实际代码不凭记忆）

| 资产 | 位置 | 状态 | 与本单的关系 |
|---|---|---|---|
| 实现分支 | `feat/d538-frontend-leftbar`（origin，tip ee960a18） | 910 行/10 文件，**未合并** | 验收对象；基于 origin/main 建工作树 |
| 测试 | `tests/electron/capability.test.ts` | 170 行：toggleCap 状态机 4 用例 / canAccessCap 权限矩阵 6 用例 / 边界 fail-closed / CAPABILITY_IDS 完整性 | 覆盖验收 3/4/5 逻辑层；**1/2/6（UI 呈现）需代码核对** |
| 设计文档 | `docs/synova/coordination/SYNOVA-IMPL-DSH-前端交互设计-左栏Codex风格-v1.md` §六 | 8 条可证伪验收 | 验收清单的唯一权威 |
| 后端接口 | sentinel.ts:46 / loops.ts:80 / actions-api.ts:54 | 3 接口存在 | 核实前端调用点真接线 |

## D544：leftbar-acceptance-merge（验收 + 修红 + 合并准备）

**目标**: 设计文档 §六 8 条验收逐条标注（通过/部分/未实现+证据），测试实跑，分支具备合并条件（CI 三 job 绿）。

**依赖**: 无（实现已就绪）。

**spec 必答题**（编码 session 必须回答，缺一返修）:

1. **「测试实跑」章节**: npm install → npm test 执行步骤 + 预期输出 + 红时修复清单模板（红修复在分支 follow-up commit）。
2. **8 条验收逐条核**（§六原文对照实现代码，每条标注 + 证据）:
   - ①能力位位置 ②Lucide 线性图标无 emoji ③右栏四联动 ④取消选中回三标签 ⑤GA 权限置灰 ⑥折叠态图标条 ⑦代码质量（as any=0/接线/degraded/expect）⑧术语无 FDE
   UI 呈现类（1/2/6）证据标准 = 组件 JSX file:line 对照；逻辑类（3/4/5/7）= 测试名 + store/组件 file:line。
3. **「接口接线核对清单」章节**: 3 接口调用点核验方法 + GA 置灰渲染分支核验方法。
4. **「合并流程」章节**: merge 分支方案步骤 + CI 三 job 确认方法——明确「本地绿不算，CI check-runs 为准」。
5. **「缺口分级」章节**: 小项编码直接修 / 大项停手报 CTO 裁决的分级标准。

**验收**（物理可复现，禁止文档声称）:

- **测试断言**: vitest exit 0（capability 全套）+ `npm run lint`（或 tsc --noEmit）零新增错。
- **验收标注表**: 8 条逐条 `通过|部分|未实现 + file:line 证据`，贴交付报告。
- **CI 断言**: merge 分支 push 后 GitHub check-runs 三 job（TypeScript+Lint+Iron Laws / Control Tower Gate Tests ubuntu+windows）全 success——**截图或 API 输出贴报告**。
- **接线断言**: capability store 新 export 在 LeftPanel/RightPanel 有真实调用（grep file:line）。

## 写集约束

- **可碰**: electron-renderer/（LeftPanel/RightPanel/stores/styles）、tests/electron/、分支上的测试修复 commit。
- **不碰**: src/（API 后端）、scripts/audit/（K3 红线）、scripts/pre-commit-check.sh、.github/workflows/ci.yml。
- **防膨胀（红线）**: 不新增组件/依赖包（package.json 只允许既有依赖）；不引入 DSH 依赖；图标用 Lucide 现有集不新增库。
- 串行: 本单为 T-M-02 主体；T-M-01（Win 部署验收）依赖本单完成。

## 切片级审计

- 本单完成后 CTO 复验合并；K3 审计随下一批（桌面端批次）。
- task-state 加 `"slice": "leftbar-acceptance"` 字段。
- 审计验收 = 8 条标注表 + CI 三绿 + 分支合并进 main。

## 给 dev-doc 的交付要求

1. **spec 文件命名**: `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D544-leftbar-acceptance-20260828.md`
2. **spec 读者是编码 session**：拿到即可执行，零二次提问。
3. **验收标准引用设计文档 §六原文**（不转述失真）。
4. **spec 中固化执行纪律**: 环境问题如实报不绕过；CI check-runs 为准。
5. **写集声明**: Q2 = electron-renderer/ + tests/electron/；排除 src/、scripts/audit/、pre-commit-check.sh、ci.yml。

---

## 写后自检（强制清单 — §〇c ③）

- [x] ① 验证锚点正确（设计 §六 8 条 + CI 三绿）
- [x] ② D# 未占用（D544 刚取号，task-state 已登记）
- [x] ③ 依赖链正确（上游 D538 实现已就绪；下游 T-M-01/T-M-03 显式依赖本单）
- [x] ④ DSH 借鉴核查三步完整（🟢 死守 + 理念借鉴沿用 D538 结论 + 无新增）
- [x] ⑤ 现状材料全部核实过（分支 tip/测试清单/设计 §六 8 条原文/接口位置均 git show 核实）
- [x] ⑥ 验收物理可复现（vitest 实跑 + 8 条标注表 + CI check-runs）
- [x] ⑦ 术语一致（左栏/能力导航/Lucide/GA，与设计文档一致；界面禁 FDE）
- [x] ⑧ 无遗漏（执行方=编码、8 条标注表、CI 证据、诚实声明、下游依赖）

**交付门槛**: 编码 session 拿到派单可直接开工（基线/验收清单/写集全给）+ CTO 复验可核（标注表 + CI 证据）。

---

## 派单说明（给创始人复制——自包含，零查找）

```
【派单】左栏 Codex 风格验收合并（D544）
> 认领: 📋 dev-doc（撰写验收 spec）→ 🛠 编码（按 spec 执行）→ CTO 复验合并 | slice: leftbar-acceptance

## 背景（一句话）
左栏前端实现 910 行躺在 feat/d538-frontend-leftbar 分支从未合并（孤儿风险），
本单按设计文档 8 条可证伪验收逐条核 + 测试实跑 + CI 确认，合入 main。

## 现状材料（执行方必读）
- 分支: feat/d538-frontend-leftbar（origin 已有，tip ee960a18）——LeftPanel/RightPanel/
  stores/capability.ts + tests/electron/capability.test.ts（170 行）
- 设计文档: docs/synova/coordination/SYNOVA-IMPL-DSH-前端交互设计-左栏Codex风格-v1.md
  §六 8 条可证伪验收（验收唯一权威）
- 后端 3 接口: /api/signals、/api/loops/status、/api/actions（已存在，核前端调用点）
- 注意: electron-renderer 无 node_modules，先 npm install

## spec 必须覆盖（dev-doc 撰写）
1. 「测试实跑」章节: npm install → npm test 步骤 + 红时修复清单模板
2. 「8 条验收核验表」: 每条核验方法 + 证据标准 + 标注格式（引用 §六原文）
3. 「接口接线核对清单」: 3 接口调用点 + GA 置灰分支的核验方法
4. 「合并流程」: merge 分支方案 + CI check-runs 确认（本地绿不算）
5. 「缺口分级」: 小项编码直接修 / 大项停手报 CTO

## 写集约束
- 可碰: electron-renderer/、tests/electron/
- 不碰: src/、scripts/audit/、scripts/pre-commit-check.sh、.github/workflows/ci.yml
- 防膨胀: 不新增依赖包（package.json 只允许既有依赖）；图标用 Lucide 现有集

## 验收（物理可复现）
- vitest exit 0 + lint/tsc 零新增错
- 8 条标注表（每行 file:line 证据）
- CI check-runs 三 job 全 success（贴结果，本地绿不算）

## 交付要求（给 dev-doc）
1. spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D544-leftbar-acceptance-20260828.md
2. spec 读者是编码 session，拿到即可执行零二次提问
3. 验收标准引用设计 §六原文；写集 Q2 = electron-renderer/ + tests/electron/
```
