# D1051 线3 报告体系首切片：一页纸（3-1）+ 详细报告（3-2）+ 对话调深度（3-3）

**分支** `feat/d1051-line3-report-depth` @ `0996f468`｜**base** `main @ 20b55eba`｜**任务** D1051｜**依据计划** `整体推进计划-主线-20260913.md` v1.2 @ `sha256=4e46603facae4361…`（前缀实测命中）

> 派单：现场 alloc 卡「线3 · 报告体系首切片（agent team 模式）」｜小队 4 人（队长 + 规格 S + 编码 C + 独立复核 V）
> 措辞：本 PR 只给**自验结论**；通过与否归 **CTO 收件闸 + K3 终审**。**K3 复审通过前不得合并**（merge 勿 squash）。

---

## 一、业务闭环（老板视角）

```
老板一句大白话 → 一页纸（结论先行，10 分钟看完） → 「讲细一点」 → 详细报告 → 「说人话」 → 回一页纸深度
```

| 点 | 入口 | 结果 |
|---|---|---|
| **3-1** | `GET /api/diagnosis/consult/:consultId/report?format=markdown`（**不带 depth**） | 与 main **字节级相同**的一页纸；响应头 `X-Report-View-Depth: one_pager` |
| **3-2** | 同端点 **`&depth=detailed`** | 五章 markdown：结论 / 根因（全量）/ 专家完整推理 / 行动建议 / 数据时点；空章 → `[degraded]` |
| **3-3** | `POST /api/conversations/:id/messages`（复用线2 现成入口，**未新建**） | SSE 流内**旁挂新帧** `report_view: {type, sessionId, depth, reportId, markdown, degraded, reason?}`；既有 `complete` 帧**一字未改**；未命中深度词 → **不发帧**（零行为变化） |

非法 `depth` → 200 + `X-Report-Depth-Degraded: UNKNOWN_DEPTH` + 落回一页纸（不静默）。

## 二、写集（9 文件 = 4 改 + 5 新，win 域单域）

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/agent/report-depth.ts` | 新建 | 呈现粒度轴 `one_pager\|detailed` 单一事实源 + 确定性关键词表（最长匹配优先）；**零 import**（L2） |
| `src/l3/report-templates.ts` | 改 | `ReportData.chapters?` + 第 4 模板 `detailed_report`；**零新增 import** |
| `src/agent/report-assembler.ts` | 改 | `renderDetailedReport` / `renderReportView` / 装配轴映射表 / `assembleOnePagerInputsForOrg` / 谓词；`renderOnePager`、`assembleReport` **逻辑零改** |
| `src/routes/diagnosis.ts` | 改 | `?depth=` 解析（默认 `one_pager` = 现状）；`buildOnePagerInputs` 薄委托 |
| `src/routes/conversations.ts` | 改 | 轮内确定性判别 → `report_view` 帧；L5 动态加载**收敛单点**（未抬架构基线） |
| `tests/agent/report-depth.test.ts` | 新建 | 14 例 |
| `tests/agent/report-detailed.test.ts` | 新建 | 15 例 |
| `tests/routes/diagnosis-report-depth.test.ts` | 新建 | 7 例（真实路由 + 真实 HTTP） |
| `tests/routes/conversations-report-view.test.ts` | 新建 | 8 例（真实路由 + 真实 HTTP + 真 SSE） |

```
$ git diff --stat origin/main -- src tests
 9 files changed, 1769 insertions(+), 45 deletions(-)
```

## 三、四项证据（本 PR 内，K3 可独立复跑）

| # | 项 | 位置 |
|---|---|---|
| ① | **verify 命令**（可重跑） | brief「Done 标准」12 条 + 下 §四 |
| ② | **机器证据 .json** | `docs/synova/product-lines/evidence/D1051/`（20-* 改坏即红 / 21-* 反向走入口 / 22-* 自验结论 / 25-* 套件日志 / 27-* 门禁 / 28-* 探针） |
| ③ | **真实入口走通**（非仅单测） | 真实 express 路由 + 真实 `better-sqlite3` + 真实 `http.listen(0)` + 真实 `fetch`；固定诊断产物经 `saveDiagnosisCheckpoint(phase=5)` 注入；**12/12 步 PASS** |
| ④ | **改坏即红**（成员 V 独立做） | 7 例注入（R1–R6 + R6c，第二独立注入源）**逐个报红**且失败断言命中预期、复原后 sha 一致 |

**套件实跑**：7 套件 / **67 passed** / `✓` 行数 67 == `it(` 计数 67 / **0 skip / 0 only**（A2 静默跳过判据）。
**回归红线**：`report-assembler` + `report-onepager-trace` + `cycle-conclusion-service` = **23 it / 140 expect 全绿且三文件零改动**。
**负控**：fixture 字段名故意写错 → 断言报红（10 PASS / 2 FAIL）⇒ 断言对内容敏感，非骨架空转。

## 四、门禁（原始输出）

```
$ bash scripts/check-architecture.sh                              → exit 0，1b/1c/1d 三段 new=0，未抬基线
$ bash scripts/control-tower/check-bypass-log.sh origin/main      → exit 0 对账通过
$ bash scripts/control-tower/check-pr-budget.sh --base origin/main --max-files 12
    ✅ ① 变更文件数 12 ≤ 上限 12    ✅ ② 变更单域 PASS（9 文件同域 win）   ✅ ③ 落后 0
$ python3 scripts/control-tower/merge_writeset_gate.py --did D1051
    ✅ 结论: pass — 提交文件集 ⊆ 声明写集（无夹带）
```
提交未走 `--no-verify`（无 bypass 记录）；`.claude/bypass.log` 为 D521 hook 自动登记。

## 五、诚实边界（**请 CTO/K3 重点看这节**）

1. **点级证据 `.json` 未落**（四件套 ② 的形式缺口）：`evidence-writer.py` 无 `--at` 且 `calc-progress.py` machine 路径只传 `date` ⇒ **与代码同日（2026-09-28）的验证必判 `stale`**。线 3 `modules` 含 `src/l3/` 与 `src/agent/report-assembler.ts`。**须在下一个自然日**按 `30-closeout.md §三 遗留 1` 的命令重跑。**未用改口径消解。**
2. **两条派单前提偏差（实测，已报 CTO）**：① D791 PR-B（mac 域 GS-08 生产路径改造）**未落 main** ⇒ `scenario:GS-08` 当下**不是可用的记分通道**（`S8-x` 与 `3-x` 无映射）；② main **无固定诊断产物** ⇒ 本切片自备 fixture。故验证收敛到 **win 域 + 真实 HTTP**。见 `00-premise-freeze.json` P7/P8。
3. **偏差声明**：spec 与实现**同 PR**（D791 先例）；若裁定「规格须先落 main 可读」，本件需拆两 PR。
4. **tsc 存量 31 错**与基线逐行相同 ⇒ **不得以「`npm run lint` 全绿」当验收判据**；本卡 9 文件零错误。
5. **PR 预算取舍**：实测被计数 13 件（9 代码 + 3 harness + hook 账本）> 12 ⇒ **裁掉一次性探针 `23b-probe-throwing-template.ts`**（其输出日志保留；文件在 `verify/d1051-line3-report-depth` 分支可取）。**未用改名绕豁免手法。**
6. **控制塔发现 4 条**（登记不修，`31-ct-findings.json`）：无参默认 base 误导 / devdoc 写集表首列 ID 致 S2 静默失效 / machine 路径不消费 `at` / `synova-commit` no-op 时 exit 0。

## 六、小队运行记录（M3）

| 角色 | 成员 | 共享任务 | 状态 |
|---|---|---|---|
| 队长 | synova-squad-lead | 前提冻结 / 冲突扫描 / 写集互斥 / 收尾三件 | 完成 |
| 规格 S | squad-d1051-spec | task-1（含 DR-1 退回 + 口径回填两次修订） | completed |
| 编码 C | squad-d1051-code | task-2、task-4 | completed |
| 独立复核 V | squad-d1051-verify | task-3、task-5（**不由编码兼任**） | completed |

**队长两次退回、一次裁定补强**：① DR-1（spec 落 L3 → **新增 L1→L3 跨层违规 = CI 硬失败**，实测 `routes/diagnosis.ts=1` / `routes/conversations.ts=1` 基线各已用满）→ 退回改落 L2；② 规格 4 处指纹口径**字面不可达**（C 实跑发现）→ 退回口径回填；③ V 发现 `report_view` 帧 `degraded` 零覆盖 → **裁定补齐**（C 加 2 例、V 独立证真红）。

---

**交付标记**：`可提请独立审计`（成员 V 自验结论：退回项 0）。**K3 复审通过前不得合并。**
