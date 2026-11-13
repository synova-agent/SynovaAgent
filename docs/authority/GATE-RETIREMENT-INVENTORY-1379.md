# 历史门禁残余：退役候选清单（#1379 第一阶段）

> 日期：2026-11-13 ｜ 基线：`gitea/main@1d87111b6` ｜ 类型：只读盘点
> 判据源：`门禁体系最终裁定与收缩施工方案-v1.0-2026-11-03.md` §3–§6、Gitea Issue #1379。
> 本件只给候选与风险，不授权删除。第二阶段必须按获批对象逐项开 PR，先摘调用再删文件，并重新证明无活调用链。

## 0. 口径与结论边界

- “自动运行”区分 Gitea/GitHub workflow、git hook 与仅手工/配对测试；配对测试被 CI 注释或密封清单提及，不等于被测脚本有生产消费者。
- “核心门接管”只在实物链一致时写“是”：`.gitea/workflows/core-gates.yml` → `scripts/ci/core-tests.sh` → 类型、构建、Secrets、`tests/contract/**`、`tests/user-visible/**`、受影响 Vitest 与真实 JSON/断言计数。静态文档、看板、任务流程、台账和代码风格扫描不写成“已接管”。
- “删除”均指第二阶段候选；本 PR 不删除对象、不新增门禁。“保留手动”表示可从自动入口退出后按需使用；“留档”表示保留历史证据，不当作现行门禁。完整 pre-commit 发现旧台账漏登现存 `gitea/core-gates`，且旧校验器 `WF_IDS` 拒绝该 workflow；经用户明确批准，本 PR 仅补登该当前 workflow、增加一行旧校验器兼容并同步其配对测试的实际数量与 N2 作用域，不改任何退役状态。
- 不用零命中直接判退役。干净工作树无 `.claude/gate-hits.log`，`gate-retirement-report.sh` 自身也输出“无数据 ≠ 零命中，不得据此退役”。
- 明确排除：`.gitea/workflows/core-gates.yml`、`scripts/ci/core-tests.sh`、`tests/user-visible/**`、`tests/contract/**` 等现有契约测试、`scripts/audit/**` 均不是候选；本阶段未改它们。

## 1. 旧 `local-gates` 步骤与配套对象

整个 `.gitea/workflows/local-gates.yml` 当前只有 `workflow_dispatch`；所以下表“手动”均指 Gitea 旧门不再随 PR/push 自动运行。GitHub `.github/workflows/ci.yml` 仍有 PR/push/merge_group 触发，但其中下列旧检查标为 `[report-only #1239]` 且 `continue-on-error: true`，不能写成“完全不自动”。

| 路径／步骤 | 当前是否自动运行 | 是否有新门接管 | 删除风险 | 建议 | 机器证据 |
|---|---|---|---|---|---|
| `.gitea/workflows/local-gates.yml` 整件 | Gitea 仅手动 | 核心风险面是；全部治理面否 | 内含条件保留、看板、写集等非核心对象；整删会扩大范围 | 保留手动；本轮不整删 | E01、E02 |
| 工作区／依赖／③ 增量测试／①j 契约／①f 类型／清理步 | 仅手动 | 是：核心 checkout、npm ci、受影响测试、契约、类型与清理 | 只删旧步骤低；不得误删核心测试或 `scripts/pre-commit-check.sh` 的铁律面 | 删除（第二阶段按步骤，不碰测试资产） | E01、E02、E03 |
| ④ 复现器＋`scripts/control-tower/ci-emptygreen-sim.sh`＋`ci-deps-step-sim.sh`＋两件同名 `.test.sh` | 旧步手动；脚本无其他生产消费者 | 是：`core-gates-workflow.test.sh`／`core-tests.test.sh` 是当前配对反例 | 当前旧夹具在本机已红，不能把它当回退保障 | 删除（随旧④步同批） | E04、E05、E06 |
| ⑤ 空绿＋`scripts/control-tower/check-ci-empty-green.sh`＋同名 `.test.sh` | 旧步手动；脚本只见旧步与测试 | 是：核心 runner 解析真实 JSON、拒绝零有效回归／零断言 | `gate-assert.sh` 还有其他旧消费者，须单独核闭包 | 删除（先摘⑤步） | E02、E04、E07 |
| ①g＋`scripts/control-tower/check-test-obligations.py`＋同名 `.test.sh` | 旧步手动；无 pre-commit 生产调用 | 部分：核心真实执行测试，但不接管静态义务／棘轮 | `tests/contract/triviality-manifest.yaml` 被现有契约使用，必须保留；测试还绑定陈旧 `gitea/local-main` | 删除（只删检查器与配对测试，保留 manifest） | E04、E08、E09 |
| ⑦＋`scripts/control-tower/check-gate-integrity.sh`＋`check-gate-integrity{,.test.sh,-selfexclude.test.sh}`＋`ci-red-baseline.txt` | Gitea 手动；GitHub 报告自动 | 否；元门禁不应由核心接管 | `sealed-tests.sh`、`gate-integrity-baseline.txt` 仍有当前消费者，不能整组删 | 删除（仅检查器、专属配对与 CI-red 基线；先移 GitHub/local 两步） | E10、E11、E12 |
| ⑧＋`scripts/control-tower/check-required-contexts.py`＋同名 `.test.sh`＋`required-checks-baseline.txt` | Gitea 手动；GitHub 报告自动 | 否；现唯一 required context 是核心门，旧 GitHub 清单不是其真源 | 与⑦共用 required 基线，须同批；GitHub `needs` 注释也引用它 | 删除（与⑦协调，不改核心 context） | E10、E11、E13 |
| ① 主步中的 `check-registry-invariants.ts` | 旧步手动；无其他活调用 | 否；登记件治理默认报告 | 无同名配对测试；删除前仍需再跑全仓调用检索 | 删除（随旧主步拆分） | E14 |
| ⑫＋`scripts/workflow/check-brief-vs-code.sh` | Gitea 手动；GitHub 报告自动；legacy 工具链仍引用 | 否；claim 覆盖由 `claim_store.py` 承担，不是核心门 | 旧⑫对 YAML claim 明载 SKIPPED；但 `brief_parser.py`、旧测试、`loop-score.sh` 仍有引用 | 保留手动；不随旧⑫直接删脚本 | E10、E15、E16 |
| ①b `check-board-truth.ts` | 旧步手动；无其他生产调用 | 否；看板报告不属于核心判据 | `check-board-metrics.ts` 是独立实现而非 import；`check-merge-conditions.sh` 只有注释引用，删除不会断其执行 | 删除（随旧①b步；保留独立 board-metrics） | E14、E17 |
| ①c `check-content-coupling.sh`、② `check-architecture.sh` | 旧步手动；pre-commit 仍调用 | 否；属裁定 §4.3 条件保留 | 未做当前产品事故反例，不能因“旧”就删 | 保留手动 | E02、E18 |
| ①i `check-tool-args-delta.py`＋`tool-args-baseline.txt`＋`tool-signal-baseline.txt` | 旧步手动；pre-commit 与 `tests/agent/tool-args-validation.test.ts` 仍消费 | 部分：核心测试可覆盖行为，不接管静态 schema/取消棘轮 | 配对测试 97/1 是旧 CI 次数断言漂移，但工具校验仍有真实反例；baseline 有独立消费者 | 保留手动 | E04、E19 |
| ⑨ `verify-parallel.sh` | Gitea 手动；GitHub 报告自动；pre-push 仍引用 | 否；写集报告不是核心判据 | 仍有 `devdoc_writeset.py`、pre-push 与其他控制塔消费者 | 保留手动 | E10、E15 |
| ⑩ `diagnosis-quality-check.sh`、⑪ `golden-case-checker.ts` | Gitea 手动；GitHub 报告自动 | 否；属裁定 §4.3 条件保留／黄金案例 | 需要真实反例，不以名称判退 | 保留手动 | E10、E18 |
| `sealed-tests.sh`＋`gate-integrity-baseline.txt` | 被⑦及当前密封测试链消费 | 否 | #1367 核心用户可见回归仍调整 FACE 棘轮；不能随⑦误删 | 保留手动 | E11、E12、E20 |

## 2. pre-commit 十二组：没有“整组因 core 重复即可删”的组

实际横幅为组 1–10、12、13（枚举见 E21）。组 3 Secrets 必须保留；组 6 还含主树安全守卫，组 12 的 `claim_store.py --coverage` 是当前 claim 消费链，组 13 仍保护 `.synova/skills` ↔ `.dsh/skills` 同步。组 10 是最明确的整组历史候选；组 9 需拆成“空契约声明块”和“块级 paths”两部分。

| 组／对象 | 当前是否自动运行 | 是否有新门接管 | 删除风险 | 建议 | 机器证据 |
|---|---|---|---|---|---|
| 组 1 类型安全＋硬编码 | 本地 pre-commit | 类型检查是；`as any`、冲突标记、硬编码等否 | 整删会丢失非 tsc 防线 | 保留手动 | E02、E21 |
| 组 2 测试质量 | 本地 pre-commit | 真实测试／零断言是；静态配对、catch、控制塔配对否 | 整删会丢失非 Vitest 静态检查 | 保留手动 | E02、E21 |
| 组 3 Secrets | 本地 pre-commit；核心 Secrets 步 | 是 | 安全红线 | 保留手动（不得关闭或弱化） | E02、E21 |
| 组 4 接线完整性 | 本地 pre-commit | 受影响／用户可见测试只有间接覆盖 | 新 export 静态接线检查不等同核心 runner | 保留手动 | E21、E22 |
| 组 5 架构边界＋桥接 | 本地 pre-commit | 否；条件保留 | 需当前架构反例 | 保留手动 | E18、E21 |
| 组 6 Task Brief＋主树守卫 | 本地 pre-commit | claim schema 否；主树安全否 | 不得把主树守卫随 legacy brief 清理误删 | 保留手动；legacy 部分只报告 | E16、E21 |
| 组 7 架构合规＋绕过／数据流 | 本地 pre-commit | 部分行为测试；专家配置与绕过审计否 | 混合安全与历史检查，不宜整组删 | 保留手动 | E21 |
| 组 8 文件驱动＋验收 CI | 本地 pre-commit | 核心不直接读 `.claude/acceptance-ci-results.json` | 当前验收证据实跑为 6 测试全过；不能称无消费者 | 保留手动 | E21、E23 |
| 组 9 `.codex/contracts/*.json` 声明块 | 本地 pre-commit；当前零 JSON 对象 | 否；`tests/contract` 是另一类契约 | 零对象块有恒绿风险；块级 paths 不在此删除项内 | 删除（仅该声明块） | E21、E24 |
| 组 9 附加 `check-block-paths.{sh,ts}`＋`block-paths-core.ts`＋`gen-block-paths.ts` | 本地 pre-commit；旧主步手动；生成器链仍调用 | 否；块级登记治理默认报告 | 有 shell/TS/生成器/测试/fixture 闭包，不能只删薄壳 | 保留手动；若后续退役须整闭包另批 | E14、E25 |
| 组 10 V3 条件区域＋测试覆盖 | 本地 pre-commit；依赖 legacy `#CRITERIA` brief | 否；现行 claim 不消费 `#CRITERIA` | legacy brief 仍可被 resolver 读取，删除前先确认不再支持该流程 | 删除（整组候选，先移除 checkpoint 写入） | E16、E21、E26 |
| 组 12 Task Scope／claim coverage | 本地 pre-commit | 否；`claim_store.py` 是当前认领制实现 | 误删会断当前 claim 覆盖与排除判定 | 保留手动（报告化，不删 claim_store） | E16、E21 |
| 组 13 技能同步 | 本地 pre-commit | 否 | `.synova`／`.dsh` 双目录仍活跃，#1378 刚使用 | 保留手动 | E21、E27 |
| 附加 `check-pr-budget.sh`＋同名测试 | 本地 pre-commit；旧 CI 明载跳过 | 否；PR 尺寸流程不是核心风险 | 先摘 pre-commit 与接线断言，不能影响 claim 本身 | 删除（流程预算候选） | E21、E28 |
| 附加 `check-gate-budget.sh`＋`gate-stats.sh`＋`gate-telemetry.sh`＋配对测试 | budget/telemetry 由本地 pre-commit；stats 手工 | 否；核心 job timeout 不接管本地遥测账 | 先移除 `log_gate` 与 `gate_budget_report`；遥测失败目前不阻断，不应伪装安全守卫 | 删除（同一遥测批） | E04、E21、E29 |
| 附加 `check-quality-delta.py`＋同名测试 | 本地 pre-commit；旧①e手动 | 否；核心真实测试不接管 G1/G3/G4/G5 静态增量 | 配对 95/4，G5 在本机有 `FileNotFoundError`；但按裁定应先报告观察，不凭红就删 | 保留手动；后续无真实信号再另批删除 | E04、E30 |
| 附加 `check-unicode-confusable.py`＋同名测试 | 本地 pre-commit；旧⑥手动 | 否；风格报告 | 不直接影响客户运行，先退报告；仍被 `verify-governance.sh` 消费 | 保留手动 | E21、E31 |
| 附加 `check-mirror-freshness.sh`＋同名测试 | 本地 pre-commit 只报告 | 否；镜像运维检查 | 与每日镜像链同域，不能因核心不接管就删 | 保留手动 | E15、E21 |
| 附加治理 `check-gate-inventory.sh` | 本地 pre-commit；其余为手工 | 否；元门禁不应接管 | 先摘 pre-commit；与台账、生成器、共享 `gate-assert` 同批核闭包 | 删除（见 §3 整组） | E05、E21、E32 |

## 3. `scripts/control-tower/`、`tests/control-tower/` 与文档治理候选

| 路径 | 当前是否自动运行 | 是否有新门接管 | 删除风险 | 建议 | 机器证据 |
|---|---|---|---|---|---|
| `docs/authority/GATE-INVENTORY.yaml` | 被旧检查器读取，不自动执行 | 否；旧台账停止作为施工目标 | 含历史退役观察期与当前条目，整删会毁证据 | 留档；第二阶段只将登记状态转历史，不物理删除 | E12、E32、E33 |
| `check-gate-inventory.sh`＋`gen-gate-meta.sh`＋`gate-inventory.invariant.sh`＋`gate-assert.sh`＋各自配对测试 | 仅第一件在本地 pre-commit；其余旧治理链／测试 | 否；元门禁不需要替代 | `gate-assert` 被本组与 `verify-governance` 共用；须整闭包，不得单独留下悬空引用 | 删除（先摘 pre-commit，台账留档） | E05、E06、E31、E32 |
| `verify-governance.sh`＋同名测试 | 无生产自动入口；手工 | 否；治理总闸不需要替代 | 实际运行 3/4 PASS、G2 判不了并 rc=2，不是有效核心回退 | 删除 | E06、E31、E33 |
| `check-ledger-budget.sh`＋同名测试 | 无生产自动入口；手工 | 否 | advisory 实测台账超行、重复键、基准漂移；只证明旧账失效 | 删除 | E06、E33 |
| `gate-retirement-report.sh`＋同名测试＋`gate-retirement-batch1.test.sh` | 无生产自动入口；手工 | 否；本清单不依赖它自动判退 | 无日志时 42/42 都列零命中，不能拿输出直接执行 | 删除（随旧台账工具链） | E06、E33 |
| `quality-baseline.py`＋`quality-baseline.json`＋`quality-baseline.test.sh`＋`quality-standard.test.sh` | 无生产自动入口；手工／测试 | 否；历史质量扫描与台账 | `WIRING-REGISTRY.yaml` 含当前产品条目，必须留档；测试有输出契约漂移 | 删除（工具与基线；登记簿留档） | E06、E08、E34 |
| `check-k3-report.py`＋同名测试 | 无生产自动入口；仅测试 | 否；#1378 后审计结论写评论，不生成报告文件 | 旧“审计报告形式保险”消费者已消失；不涉及 `scripts/audit/**` | 删除 | E14、E35 |
| `check-project-coordinates.sh`＋同名测试 | 无生产自动入口；旧台账已标 `decision: retire` | 否；旧预演坐标检查 | 仍需第二阶段确认无新增消费者 | 删除 | E14、E36 |
| `check-customer-deps.ts`＋同名 `.test.ts` | `npm run check:customer-deps` 手工入口；非自动 | 否；端口级摘除演练 | 旧台账的 `decision: retire` 已被后续 npm 接线推翻 | 保留手动 | E14、E37 |
| `check-acceptance-matrix.py`＋同名测试 | 无生产自动入口；`retired:` 观察期至 2026-11-30 | 旧称由 `verify-governance.sh` 吸收，而后者也列候选 | 观察期未满；replacement 自身将退，第二阶段须重判而不是照抄 | 留档至观察期结束，再单独决定删除 | E12、E14、E38 |
| `retired:` 中其余既有项（含根级 `scripts/check-brief-vs-code.sh`、`check-deprecated-mapping.sh`、旧 hook／workflow 检查） | 多数无自动；个别仍被 pre-commit 读取或输出消费 | 逐项不同，不能统一写“核心接管” | 观察期分别至 2026-11-28／11-30；`check-silent-swallow.sh` 当前输出仍进 `soft_check`，旧“无出红”理由已有漂移 | 留档至各自观察期；第二阶段逐项重跑 `na_cmd`，不批量删 | E12、E39、E40 |
| `scripts/doc-system/check-doc-g3-datestamp.sh`、`check-doc-g5-bare-filename.sh`、`verify-doc-budgets.sh`、`verify-doc-gate-effectiveness.sh`＋配对测试 | 无生产自动入口；WIRING 明载 declared-only | 否；旧 G-DOC/W0 规则 | 当前文档守则仍有尺寸／登记要求，先确认保留检查由谁手工承担，再删这四件旧实现 | 删除（文档规则不同步削弱） | E34、E41 |
| `scripts/doc-system/check-doc-truth.sh`、`doc-registry-gate.sh`、`doc-truth-probe.sh`＋配对测试 | pre-commit；D2 另有 GitHub docs-only 步；文档守则明确要求 | 否；当前文档维护入口 | 本任务也依赖登记与真相检查，不能当无消费者旧件 | 保留手动 | E42、E43 |
| `docs/authority/WIRING-REGISTRY.yaml` | 被 quality-baseline 手工读取 | 否；末尾注明“G2 后随旧门退役” | 同时含核心、安全与当前产品接线记录，不能按旧门禁整件删除 | 留档；后续仅清理已批旧条目 | E34、E44 |
| `docs/authority/GATE-STANDARD.md` | 不执行 | 否；已停止作为施工目标 | 文件头已明确历史地位，无需删除 | 留档 | E45 |
| `gate-exemptions/**` 中旧门禁豁免（例：`2026-10-28-1089-gate-inventory.md`、`2026-10-24-p4-912-quality-delta.md`、`2026-11-09-1319-g2-old-trigger-retire.md`） | 仅在受保护路径检查时读取历史证据 | 否 | 删除会破坏变更审计与既有 PR 的可复核性 | 留档；不批量改 status 或删除 | E46、E47 |
| `.claude/claims/1319.yaml`、`.claude/claims/1378.yaml` 及旧治理批次 claims；`.claude/claims/_archived/**` | 被 claim 解析器按文件名读取；不自动执行旧任务 | 否 | #1319/#1378 Issue 已闭合，但 claim 是写集证据；当前活跃旧 claims 需先核 Issue 状态再归档 | 留档；后续按既有机制移 `_archived`，不删除 | E48、E49 |
| `DOCS-REGISTRY.yaml` 的 `DOC-0243 → GATE-INVENTORY.yaml` 及旧豁免登记 | 文档登记检查时读取 | 否 | 直接删行会破坏历史索引；`status: active` 需在对象退役时单独改，不在本阶段改 | 留档（后续转 archived/superseded，不删行） | E47、E50 |

## 4. 机器证据（检索与真实调用链）

以下均为本基线现场检索；路径前缀省略为仓库相对路径。`Grep` 结果同时含注释时，结论已继续追 `run:`／函数调用／package.json，而不是把字面命中都当生产消费者。

### E01 — 触发器实测

```text
$ python - <<'PY'  # yaml.BaseLoader 读取两个 workflow 的 on
.gitea/workflows/local-gates.yml: on=workflow_dispatch
.gitea/workflows/core-gates.yml: on={'pull_request_target': {'branches': ['main']}, 'push': {'branches': ['main']}, 'workflow_dispatch': ''}
```

### E02 — 核心接管链

```text
.gitea/workflows/core-gates.yml:181  - name: 类型
.gitea/workflows/core-gates.yml:203  - name: 构建
.gitea/workflows/core-gates.yml:227  - name: Secrets
.gitea/workflows/core-gates.yml:244  - name: workflow 配对反例
.gitea/workflows/core-gates.yml:256  - name: runner 配对反例
.gitea/workflows/core-gates.yml:268  - name: 实际核心测试
scripts/ci/core-tests.sh:222  CORE-TESTS RUN contract ... tests/contract/
scripts/ci/core-tests.sh:246  CORE-TESTS RUN user-visible ... tests/user-visible/
scripts/ci/core-tests.sh:338  CORE-TESTS RUN affected ... --changed
scripts/ci/core-tests.sh:348  No test files found => fail_test
```

### E03 — 旧步骤枚举（现场输出，未截断）

```text
26:- name: 工作区（本机 Gitea 克隆；不用 actions/checkout）
50:- name: 依赖（lock 哈希指纹：变了就重装，没变才跳过）
80:- name: ① 12 组门禁（唯一的阻断门）
112:- name: ①d 门禁本体自检（清单 ＋ diff 豁免）
134:- name: ①b 看板真值（交付未回填检测 · CTO 2026-10-11 立）
142:- name: ①c 内容面耦合 CC1–CC4（K12-13/#196 · 存量棘轮／新增必拦）
159:- name: ② 架构边界（快，阻断）
182:- name: ③ 增量测试（vitest --changed；只测改动面，避免全量摩擦）
317:- name: ④ 门禁复现器自检（条件：变更集触碰工作流/复现器/夹具才跑；否则 <1s 跳过）
357:- name: ①e 质量增量闸（G1/G3/G4 · 只判变更集 · 不计组号）
393:- name: ①j 契约测试（tests/contract 全量 · Q-9 接线）
402:- name: ①f 类型＋铁律（tsc --noEmit ＋ check:iron-laws · 不计组号）
422:- name: ①g 测试义务闸（新模块缺 expected/snapshot ⇒ 红 · 只判变更集）
434:- name: ①i 工具入参校验增量闸（R1–R6 · 只判变更集 · 不计组号）
459:- name: ⑤ CI 空绿 step 级判据（test_count / skipped · 只判本 job 记录）
479:- name: ⑥ W10 Unicode 同形字分级门禁（A/B/C 阻断 · D 仅提醒 · 只查 diff）
515:- name: ⑦ 门禁完整性 check-gate-integrity.sh（patterns 哨兵 ＋ 登记 ratchet；C 段 --ci-reds 显式不跑 · #1239）
534:- name: ⑧ 必需 context ⇄ job name 一致性（check-required-contexts.py 静态面阻断；--api-check 显式不跑 · #1239）
547:- name: ⑨ 并行写集声明物理验证（verify-parallel.sh --ci-pr · #1239）
562:- name: ⑩ 诊断质量 7 项结构检查（diagnosis-quality-check.sh · #1239）
569:- name: ⑪ 黄金案例 F1 门禁（golden-case-checker.ts · #1239）
576:- name: ⑫ Brief 声明 vs 代码变更（check-brief-vs-code.sh --strict · #1239）
623:- name: 清理（令牌不落盘 · always）
```

### E04 — 配对测试原始结果

```text
TEST-RESULT ci-emptygreen-sim rc=5
  结果: 5 通过, 5 失败
  CI-EMPTYGREEN-SIM: HARNESS-BROKEN（桩未被执行）failures=10
TEST-RESULT ci-deps-step-sim rc=1
  RESULT: 2 PASS / 9 FAIL
  line 93: shasum: command not found
TEST-RESULT check-ci-empty-green rc=1
  结果: 37 通过, 1 失败
  ❌ 工作流可执行行出现 always()
TEST-RESULT check-gate-budget rc=0       结果: 17 通过, 0 失败
TEST-RESULT gate-stats rc=0              结果: 27 通过, 0 失败
TEST-RESULT gate-telemetry rc=0          结果: 17 通过, 0 失败
TEST-RESULT check-quality-delta rc=1     结果: 95 通过, 4 失败
TEST-RESULT quality-baseline rc=1        FAIL pass=161 fail=3
TEST-RESULT quality-standard rc=1        STANDARD-TEST rc=1 failures=5
TEST-RESULT check-test-obligations rc=1  结果: 47 通过, 1 失败
TEST-RESULT check-tool-args-delta rc=1   结果: 97 通过, 1 失败
```

失败不是“通过”，也不是自动删除理由：它证明当前旧套件存在环境依赖或基线漂移，第二阶段不能把这些套件当可靠回退。

### E05 — 核心配对反例

首次未安装依赖时三项均按设计 `rc=2`（`installed toolchain missing; run npm ci first`），未写成通过。`npm ci` 实际新增 814 packages 后，原命令重跑：

```text
CORE-GATES-WORKFLOW-HARNESS RESULT pass=23 fail=0
TEST-RESULT core-gates-workflow rc=0
CORE-TESTS-HARNESS RESULT pass=29 fail=0
TEST-RESULT core-tests rc=0
CORE-USER-VISIBLE-HARNESS RESULT pass=5 fail=0
TEST-RESULT core-user-visible rc=0
```

其中的失败路径也实际执行并通过断言：contract failure、user-visible failure、affected failure、零对象 `rc=2`、`CORE_ZERO_ASSERTIONS`、workflow forgery 受信预检拒绝，以及 npm/lint/build/Secrets 故障分类。

### E06 — 旧治理工具配对结果

```text
TEST-RESULT check-gate-inventory rc=0     结果: 63 通过, 0 失败
TEST-RESULT gate-inventory.invariant rc=1 结果: 8 通过, 2 失败
TEST-RESULT gate-retirement-report rc=0   结果: 9 通过, 0 失败
TEST-RESULT gate-retirement-batch1 rc=0   结果: 6 通过, 0 失败
TEST-RESULT verify-governance rc=0        结果: 108 通过, 0 失败
TEST-RESULT check-ledger-budget rc=0      === 结果: PASS=20 FAIL=0 ===
```

### E07 — `check-ci-empty-green` 调用链

```text
.gitea/workflows/local-gates.yml:465  bash scripts/control-tower/check-ci-empty-green.sh --results ...
scripts/control-tower/check-ci-empty-green.sh:244  归一真源 = 邻件 gate-assert.sh
tests/control-tower/check-ci-empty-green.test.sh:5  被测对象
docs/authority/WIRING-REGISTRY.yaml:189  唯一消费点＝local-gates 末尾⑤
```

### E08 — 质量义务／工具入参的真实失败点

```text
check-test-obligations:
  S1 clean tree · --base gitea/local-main
  ❌ S1 SKIP 语义（无 src/** 变更）
  base=gitea/local-main ... changes=579 src_changes=43

check-tool-args-delta:
  ✅ T20 --selfcheck ⇒ exit 0
  ✅ T21② 副本 --selfcheck 报 SELFCHECK-FAIL（f4 失败）
  ❌ T22③ workflow 出现次数变了（1 != 0）⇒ 疑似新增 CI 步
```

### E09 — `check-test-obligations` 生产引用

```text
.gitea/workflows/local-gates.yml:430  python3 scripts/control-tower/check-test-obligations.py --base "$BASE"
tests/control-tower/check-test-obligations.test.sh:39  SUT=.../check-test-obligations.py
tests/contract/triviality-manifest.yaml:24  提及其 --write-baseline；manifest 本身不是候选
```

### E10 — GitHub 旧报告腿

```text
.github/workflows/ci.yml:3-20  on: push/pull_request/merge_group/workflow_dispatch
.github/workflows/ci.yml:213-219  Verify parallel ... [report-only] + continue-on-error: true
.github/workflows/ci.yml:974-977  Brief vs Code ... [report-only] + continue-on-error: true
.github/workflows/ci.yml:1126-1129  Gate integrity ... [report-only] + continue-on-error: true
.github/workflows/ci.yml:1050-1057  golden-case / diagnosis-quality ... [report-only]
```

### E11 — ⑦⑧ 实物调用

```text
.gitea/workflows/local-gates.yml:533  SYNO_BASE_REF=... bash scripts/control-tower/check-gate-integrity.sh
.gitea/workflows/local-gates.yml:546  python3 scripts/control-tower/check-required-contexts.py --verbose
scripts/control-tower/check-gate-integrity.sh:31  默认 gate-integrity-baseline.txt
scripts/control-tower/check-gate-integrity.sh:32  默认 ci-red-baseline.txt
scripts/control-tower/check-gate-integrity.sh:105  参与集生产单源 = required-checks-baseline.txt
```

### E12 — 既有退役观察期

```text
GATE-INVENTORY.yaml:2747  retired:
GATE-INVENTORY.yaml:2748  批1不删文件，观察期30天
GATE-INVENTORY.yaml:2758  observation_until: 2026-11-28
GATE-INVENTORY.yaml:2816  批2不删文件，观察期30天（至2026-11-30）
GATE-INVENTORY.yaml:2987  RET-w1-check-acceptance-matrix
GATE-INVENTORY.yaml:2995  observation_until: 2026-11-30
```

### E13 — required context 旧真源

```text
scripts/control-tower/check-required-contexts.py:15  默认 required-checks-baseline.txt
scripts/control-tower/check-required-contexts.py:648  prog="check-required-contexts.py"
tests/control-tower/check-required-contexts.test.sh:38  真接线断言：ci.yml 调用
```

### E14 — 旧候选的当前消费者复核

```text
check-registry-invariants.ts: 仅 .gitea/workflows/local-gates.yml:96 为生产调用；其余为旧台账
check-k3-report.py: 当前生产调用零；仅 tests/control-tower/check-k3-report.test.sh 与历史材料
check-project-coordinates.sh: 当前生产调用零；仅 tests/control-tower/check-project-coordinates.test.sh 与历史材料
check-customer-deps.ts: package.json:55 "check:customer-deps": "tsx scripts/control-tower/check-customer-deps.ts"
```

### E15 — 写集／Brief／镜像链

```text
scripts/pre-push-check.sh:493  VERIFY_PARALLEL="$SCRIPT_DIR/control-tower/verify-parallel.sh"
scripts/control-tower/devdoc_writeset.py:6-7  统一供 verify-parallel.sh 等
scripts/workflow/check-brief-vs-code.sh:12  用法 ... [--strict]
scripts/pre-commit-check.sh:2434-2437  check-mirror-freshness.sh 只报告
```

### E16 — 当前 claim／legacy 分流

```text
AGENTS.md:270  legacy brief 规范已退役；现行 = Gitea Issue ＋ .claude/claims/<issue>.yaml
scripts/pre-commit-check.sh:1167  声明载体双形态；claim 默认开
scripts/pre-commit-check.sh:1187-1197  claim 由 claim_store.py --check 判定
scripts/pre-commit-check.sh:1873-1905  claim_store.py --coverage 计算覆盖
.gitea/workflows/local-gates.yml:615-618  YAML claim ⇒ ⑫ SKIPPED（载体不适用）
```

### E17 — 看板真值的旧 `wired_to` 已漂移

```text
scripts/control-tower/check-board-metrics.ts:28  仅 import node:fs；未 import check-board-truth
scripts/control-tower/check-board-metrics.ts:58  注释称“同口径，收紧版”，为独立实现
scripts/control-tower/check-merge-conditions.sh:92  仅分页大小注释引用 check-board-truth.ts
当前 scripts/control-tower 检索：check-board-truth.ts 无其他 import／执行调用
=> 旧 GATE-INVENTORY 的 wired_to 不能代替当前调用链；删除不影响 board-metrics 执行
```

### E18 — 裁定明确条件保留

```text
门禁体系最终裁定与收缩施工方案-v1.0-2026-11-03.md:202-214
  条件保留：架构边界／内容耦合／诊断质量／工具入参校验／契约测试／空绿检测／部署与安全探针
  只保留能拦截当前产品事故的最小判据；逐个做反例验证
```

### E19 — 工具 baseline 独立消费者

```text
tests/agent/tool-args-validation.test.ts:283-284
  scripts/control-tower/tool-args-baseline.txt 登记集合 == 运行时空 schema 集合
scripts/pre-commit-check.sh:2327-2351  check-tool-args-delta.py 调用与失败处理
```

### E20 — 密封测试仍有当前消费者

```text
scripts/control-tower/sealed-tests.sh:12-13  check-gate-integrity.sh B 段向本脚本取数
.claude/claims/1367.yaml:22  verify: bash scripts/control-tower/sealed-tests.sh --slack
.claude/claims/1367.yaml:23  note: FACE-TOTAL 215→216 保持 slack=10
```

### E21 — pre-commit 横幅与附加调用

```text
783:── 组 1: 类型安全 + 硬编码数据
855:── 组 2: 测试质量
964:── 组 3: Secrets
979:── 组 4: 接线完整性
1040:── 组 5: 架构边界 + 桥接文件
1136:── 组 6: Task Brief (6 核心字段)
1407:── 组 7: 架构合规
1579:── 组 8: 文件驱动架构完整性 (V3.9)
1613:── 组 9: 契约门禁
1697:── 组 10: V3 流水线健康度
1772:── 组 12: Task Scope 一致性
2087:── 组 13: 技能同步一致性
2118-2150  质量增量附加块
2152-2200  文档真相附加块
2202-2254  PR 预算附加块
2418-2444  gate-inventory／mirror 治理附加块
2512-2529  gate_budget_report
```

### E22 — 接线静态检查不是核心 runner

```text
scripts/pre-commit-check.sh:983-1025  新 export 被引用／被调用的物理检查
scripts/ci/core-tests.sh:338-365  核心只运行受影响 Vitest 并解析真实结果
```

### E23 — 验收证据实跑

```text
$ bash scripts/check-acceptance-ci.sh
✅ 能力验收 CI (6 测试, 全部通过)
ACTUAL-RESULT check-acceptance-ci rc=0
```

### E24 — 空 `.codex/contracts` 对象

```text
Glob(path=.codex, pattern=contracts/*.json) => No matches found
scripts/pre-commit-check.sh:1620-1644  只有目录存在且非空才逐份声明判定
```

### E25 — block-paths 闭包

```text
scripts/pre-commit-check.sh:1662  调 check-block-paths.sh
scripts/control-tower/check-block-paths.sh:29  ENTRY=check-block-paths.ts
scripts/control-tower/check-block-paths.ts  与 gen-block-paths.ts 共用 block-paths-core.ts
tests/control-tower/check-block-paths.test.sh:70-74  同时断言 pre-commit/local-gates/gen 调用
```

### E26 — 组 10 的 legacy 输入

```text
scripts/pre-commit-check.sh:1701-1769  读取 .codex/criteria-code-map.json 与 brief 中 #CRITERIA
.codex/criteria-code-map.json:2  V3 §1.5 条件代码区域映射表
```

### E27 — 技能同步当前调用

```text
scripts/pre-commit-check.sh:2100  bash scripts/workflow/sync-dsh-skills.sh --check
.claude/claims/1378.yaml:19  verify: bash scripts/workflow/sync-dsh-skills.sh --check
```

### E28 — PR 预算当前调用与旧 CI 跳过

```text
scripts/pre-commit-check.sh:2236-2253  读取 SYNO_SKIP_PR_BUDGET 并调 check-pr-budget.sh --quiet
.gitea/workflows/local-gates.yml:94  export SYNO_SKIP_PR_BUDGET=1
```

### E29 — 遥测与耗时链

```text
scripts/pre-commit-check.sh:211  _tel=scripts/control-tower/gate-telemetry.sh
scripts/pre-commit-check.sh:222  gate-telemetry.sh --emit ...
scripts/pre-commit-check.sh:2523  check-gate-budget.sh --log ...
scripts/control-tower/gate-stats.sh:17  日志由 gate-telemetry.sh 单点写入
```

### E30 — 质量增量失败细节

```text
❌ G5-9 jscpd 缺失 ⇒ exit 0（不阻断） — exit=1 期望 0
❌ G5-9 未点名 E_JSCPD-MISSING: Traceback
FileNotFoundError: [WinError 2] 系统找不到指定的文件。
结果: 95 通过, 4 失败
```

### E31 — Unicode／治理共享件

```text
scripts/pre-commit-check.sh:2452-2477  check-unicode-confusable.py 调用
scripts/control-tower/verify-governance.sh:32  gate-assert.sh 为 G6 唯一真源
scripts/control-tower/check-gate-inventory.sh:116  gate-assert.sh 为归一真源
scripts/control-tower/check-ci-empty-green.sh:244  gate-assert.sh 为归一真源
```

### E32 — gate-inventory 生产与伴生链

```text
scripts/pre-commit-check.sh:2423-2432  调 check-gate-inventory.sh --root
scripts/control-tower/gate-inventory.invariant.sh:108  INV_CHECKER=check-gate-inventory.sh
scripts/control-tower/gate-inventory.invariant.sh:346-355  复用其 rc 做 disk↔registry 对齐
scripts/control-tower/gen-gate-meta.sh:52  check-gate-inventory 消费生成段
scripts/control-tower/gen-gate-meta.sh:417-421  WF_IDS 硬编码旧集合，不含现存 gitea/core-gates
实测：补登 core-gates 后仍报“清单多处未登记面（禁造幽灵腿）: gitea/core-gates”
```

### E33 — 旧工具真实运行结果

```text
gate-retirement-report:
  数据源 ... ⚠️ 无数据（日志不存在）
  ① 零命中候选（现存 42 项中 42 项）
  无命中数据 ⇒ 不得据此退役任何检查（无数据 ≠ 零命中）
  30 天前基线: 不可得 ⇒ 净增不可算

verify-governance:
  G2 分腿证据: SKIP；遥测有效 0 条；ci 证据有效 0 条
  小结: PASS 3 / FAIL 0 / SKIP 0 / 判不了 1（共 4 项）
  GOVERNANCE: 3/4 PASS（1 判不了）
  ACTUAL-RESULT verify-governance rc=2

check-ledger-budget --advisory:
  LEDGER: lines=3103/800 dup_across_sections=159 drift=128 measured_at=4b5a9d399 base=1d87111b6
  LEDGER-VIOLATION: L_LINES / L_DUP / L_MEASURED_AT
  ACTUAL-RESULT check-ledger-budget rc=0
```

### E34 — quality 基线漂移原始输出

```text
quality-baseline:
  ✅ --check-registry 真件 (rc=0)
  ❌ 点名 entries[0].consumer — 未找到
  ❌ 点名 entries[0].defined_at — 未找到
  ❌ 点名 entries[0].stray_key — 未找到

quality-standard:
  ❌ 登记表校验失败 rc=0（期望 0 ＋ REGISTRY-OK rows=11）；实际 REGISTRY-OK rows=47
  ❌ 盘点输出缺 covered=G12/12 B9/9 X7/7 S12/12 K35/35 R40/40
  ❌ 盘点输出缺 PAIRING-OK t1..t5=5/5
  ❌ 盘点输出缺 excluded_headers=19
  ❌ 盘点校验失败 rc=2（GATE-INVENTORY line 1881 裸标量）
```

### E35 — 新审计口径

```text
AGENTS.md:245  独立审计按需触发；结论写任务卡／Issue／PR 评论，不生成审计报告文件
Gitea #1378 已关闭；其 Done 明确普通任务不叠加多轮独立复核
```

### E36 — 旧 `decision: retire` 与实测对照

```text
GATE-INVENTORY.yaml:855  check-project-coordinates decision: retire
GATE-INVENTORY.yaml:856  预演模式、默认 exit 0、wired_to=[]
当前检索：仅配对测试与历史材料；无生产调用
```

### E37 — 旧 `check-customer-deps` 退役理由已过期

```text
GATE-INVENTORY.yaml:711  decision: retire（旧记录）
package.json:55  "check:customer-deps": "tsx scripts/control-tower/check-customer-deps.ts"（当前入口）
=> 不执行旧 retire 建议，改保留手动
```

### E38 — acceptance-matrix 退役记录与替代件风险

```text
GATE-INVENTORY.yaml:2987-2995
  path: scripts/control-tower/check-acceptance-matrix.py
  absorbed_by: scripts/control-tower/verify-governance.sh
  observation_until: 2026-11-30
WIRING-REGISTRY.yaml:154-157  status: retired；consumer=null
```

### E39 — 根级 Brief 重复件已登记但仍需观察

```text
GATE-INVENTORY.yaml:2958-2966
  RET-w1-root-check-brief-vs-code
  replacement: scripts/workflow/check-brief-vs-code.sh
  observation_until: 2026-11-30
```

### E40 — 旧退役理由与现行代码不完全一致

```text
GATE-INVENTORY.yaml:2977-2986  check-silent-swallow 退役记录称调用点 || true
scripts/pre-commit-check.sh:880-884  || true 后仍将含 ❌ 输出送入 soft_check
=> 第二阶段必须重判，不能机械执行历史退役理由
```

### E41 — declared-only 文档检查

```text
WIRING-REGISTRY.yaml:353-366  gDoc3/gDoc5：consumer=null，本批不接 pre-commit/CI
WIRING-REGISTRY.yaml:406-421  gDoc1/gDoc2：consumer=null，本批不接 pre-commit/CI
```

### E42 — 文档真相／登记当前调用

```text
scripts/pre-commit-check.sh:2178-2199  check-doc-truth.sh / doc-registry-gate.sh
.github/workflows/ci.yml:167  docs-only 分支 bash scripts/doc-system/doc-registry-gate.sh
scripts/doc-system/doc-truth-probe.sh:34  D1=check-doc-truth.sh
```

### E43 — 文档域现行守则

```text
docs/AGENTS.md:10  新文件须登记 docs/authority/DOCS-REGISTRY.yaml
docs/AGENTS.md:13  C 件：check-doc-truth.sh 绿
```

### E44 — WIRING 自身过渡口径

```text
WIRING-REGISTRY.yaml:440-447  ci.coreTests；consumer=null 是旧扫描看不见 .gitea，不代表未接线
WIRING-REGISTRY.yaml:447  “G2 后随旧门退役”
```

### E45 — 旧标准已标历史

```text
GATE-STANDARD.md:8  2026-11-03 起停止作为继续施工目标，仅作历史事实与安全能力参考
GATE-STANDARD.md:9  现行判据源 = 门禁体系最终裁定与收缩施工方案
```

### E46 — 旧豁免件枚举

```text
Glob(gate-exemptions/*gate-inventory*):
  2026-10-28-1089-gate-inventory.md
  2026-10-25-p2-975-gate-inventory.md
Glob(gate-exemptions/*quality-delta*):
  2026-10-24-p4-912-quality-delta.md
```

### E47 — 旧门禁登记与豁免实物流

```text
DOCS-REGISTRY.yaml:1957-1981  #1319 核心门与 T3 旧触发退役登记
DOCS-REGISTRY.yaml:1982-1987  #1367 用户可见核心回归登记
.claude/claims/1319.yaml:13  保留旧步骤与手动入口，不清理历史文件
```

### E48 — 已闭合核心切换任务 claim

```text
Gitea API #1319: state=closed
Gitea API #1378: state=closed
.claude/claims/1319.yaml 与 .claude/claims/1378.yaml 仍在活跃 claims 目录
```

### E49 — 历史 claim 不改写原则

```text
.claude/claims/_archived/1379.yaml 是 2026-10-08 另一历史任务的同名归档，与当前 Issue #1379 标题／写集不同
当前任务新建 .claude/claims/1379.yaml；未修改该归档件
```

### E50 — GATE-INVENTORY 的 DOCS 登记

```text
DOCS-REGISTRY.yaml:861-866
  id: DOC-0243
  path: docs/authority/GATE-INVENTORY.yaml
  status: active
  note: 旧门禁盘点 ...
```

## 5. 配对测试补充结果（元门禁与文档）

`check-gate-integrity.test.sh` 单独运行 15 分钟后超时；日志在连续 62 条 `✅` 后停止于“接线: 无 head.sha”段，未产生 `TEST-RESULT`，故记为“超时／全套未验证”，不记通过。其余测试单独完成：

```text
TEST-RESULT check-required-contexts rc=0          结果: 51 通过, 0 失败
TEST-RESULT check-gate-integrity-selfexclude rc=0 结果: 12 通过 / 0 失败
TEST-RESULT check-k3-report rc=1                  结果: 6 通过, 2 失败
TEST-RESULT check-project-coordinates rc=1        结果: 12 通过, 1 失败
```

失败原文要点：

```text
check-k3-report:
  T1 合格 = OK 期望 0 实得 1；R1 断面与唯一源不一致（源=0.2.1-rc.5 @ b830ec950f）
  T6 计数无命令 = DEGRADED 期望 2 实得 1（同时出现 R5 与 R1）

check-project-coordinates:
  UnicodeDecodeError: 'gbk' codec can't decode byte 0xb0 in position 52
  chmod: cannot access '/tmp/.../mut.sh': No such file or directory
  ❌ 4.1 变异体应 0 实际 127
```

文档治理配对结果：

```text
TEST-RESULT check-doc-g3-datestamp rc=0       结果: 35 通过, 0 失败
TEST-RESULT check-doc-g5-bare-filename rc=0   结果: 47 通过, 0 失败
TEST-RESULT verify-doc-budgets rc=0           结果: 49 通过, 0 失败
TEST-RESULT verify-doc-gate-effectiveness rc=1 结果: 37 通过, 5 失败
```

`verify-doc-gate-effectiveness` 的真实根输出为 `EFFECTIVENESS: RED 6 ｜ 生效 0/6 ｜ declared-only 4 ｜ 无实现 1（G-DOC-6）`，并指出 G-DOC-4 的 MAP 行锚仍指向不含 `check-doc-contract.sh` 的 `scripts/pre-commit-check.sh:518`；其变异体也未按预期翻绿。这支持“旧生效性检查与现行文档链已漂移”，但前三个文档检查仍有配对判别力，所以表中只把四件旧实现列候选，不把整个文档治理目录列为删除。

## 6. 第二阶段执行约束与待 CTO 裁定

1. **先批准对象，再逐项删调用与文件**。本清单不把“候选”当“批准”；不得批量删除。
2. **先留档台账，再删元门禁**。建议顺序：GATE/WIRING 状态留档 → 摘 pre-commit／GitHub／local-gates 调用 → 删检查器与配对测试 → 复跑核心门及调用检索。
3. **观察期不越过**。`retired:` 批 1／批 2 分别到 2026-11-28／2026-11-30；到期后仍需重跑各自 `na_cmd`，特别是 `check-silent-swallow.sh` 这类代码已变化的对象。
4. **需 CTO 裁定 A**：是否接受“组 10 整组＋组 9 空 `.codex/contracts` 声明块”作为首批 pre-commit 删除候选；legacy brief 兼容是否仍需保留。
5. **需 CTO 裁定 B**：`check-gate-integrity.sh` 与 `check-required-contexts.py` 退出 GitHub 报告腿时，是否同批删除旧 `all-checks-passed` 聚合 job；本清单未把该 job 单列直接删除，因为它仍在 `.github/workflows/ci.yml` 且有 `needs` 依赖。
6. **需 CTO 裁定 C**：`verify-governance.sh` 也列退役后，`check-acceptance-matrix.py` 原 `absorbed_by` 已失效；观察期后是留作手工验收器还是删除。
7. **需 CTO 裁定 D**：`sealed-tests.sh`／`gate-integrity-baseline.txt` 是保留当前密封测试体系，还是另开最小化迁移；本清单明确不建议随⑦误删。
8. **需 CTO 裁定 E**：`quality-delta`、Unicode、block-paths 先保留手动报告；后续以真实事故信号决定，不设数量 KPI。

## 7. 本阶段未做

- 未删除或修改任何候选对象；未改 core-gates、core runner、用户可见／契约测试、`scripts/audit/**`。
- 未新增门禁、required context、回归台账或替代治理框架。
- 未改历史豁免、历史 claim、WIRING-REGISTRY 或旧标准的退役状态；仅在用户批准后向 GATE-INVENTORY 补登现存 `gitea/core-gates`、给旧校验器增加一行兼容并同步其配对测试，未改其他条目。
- 未自行合并；本清单交 CTO／创始人验收。
