# D962 2a① 终态 + 第二批删除 独立自验（task-15 / d962-verifier）

> 对象：分支 `feat/d962-2a-precommit-b` @ e58b55fe（base=origin/main@0ab457f2，禁栈式 ✔），工作树 `.synova-wt-d962b3` 只读。样例一律 /tmp 副本（git archive → /tmp/d962v3-tree），零改仓库源文件。禁引 B 数字，全部独立实测。

## ① 行数 + 断面 + 本地清单

- `wc -l scripts/pre-commit-check.sh` = **399**（≤400 ✔）。
- `grep -c 'check-dsh-anchor'` = **3**（D943 断面 ×3 在位 ✔）。
- 本地清单在位（逐条 grep 行号）：#46 GATEKEEPER（:74-86，ACK=1 逃生舱+degraded 登记）、#11家 CT-34 纯文档早退（:114-139，空暂存 fail-closed）、#17 主树占用（:160-192）、#33 绕过审计 7c（:194 起）、#30 DiagnosticModule（:229）、#38/#39 G10/G11（:232-269）、#3 硬编码、gate-hits 钩子（log_gate :17/:66，旁路 4 数据源）。✔

## ② 死分支修活实证（正样本，/tmp 夹具）

- 赋值在位：`scripts/pre-commit-check.sh:112` `CHANGED_FILES="$GIT_CACHED_ALL_NAMES"; STAGED_FILES=…; STAGED_ALL=…`（注释 D962 死分支修复）。
- 正样本：staged = brief（含 `#CRITERIA: A` + "端到端 e2e 验收"）+ `src/routes/unrelated.ts`（不在条件 A 的映射区域）+ 无测试文件 → 运行输出（原始）：
  - `⚠️  G10: 条件区域不匹配: 1 处  [警告]`
  - `⚠️  G11: 声明端到端验收但无测试文件: 1 处  [警告]`
  **不再恒跳过，修活成立。** ✔

## ③ 验收链模式 6 逐条自跑

1. `bash -n` → OK。
2. UTF-8 头块 → `file` = "UTF-8 text"；头 3 行含 PYTHONIOENCODING/LC_ALL。
3. 专项 tests：g10-cp3.test.sh **PASS=14 FAIL=0**（比 2a 期 9 项多出红分支断言，死分支修活后已补）；ci-strict-mode **pass=5 fail=0**。
4. `bash scripts/check-plan-integrity.sh` → ✅ principles/approach/memory_refs 全过。
5. pre-commit 自过：直接跑 rc=1 被 GATEKEEPER 拦（B 工作树 `.claude/bypass.log` 含今日 detected-bypass 痕迹）——GATEKEEPER 判别正常；按文档逃生舱 `SYNO_GATEKEEPER_ACK=1` 复跑 → **rc=0，"✅ 本地清单通过（D962 2a① 终态；33 项判定见 CI iron-laws）"**。✔
6. （补）ci-strict-visible 亦绿。

## ④ 历史事故回归集独立抽验（/tmp 夹具 + SYNO_CI=1，自造正样本）

| 回归项 | 正样本 | 实测（原始输出） |
|---|---|---|
| 铁律38 as any | `x as any` | ❌ as any 零容忍: 8 处（含我的 evilAny，点名） |
| engine-core 桥接 | `import … '../../packages/engine-core/…'` | ❌ 铁律46: 1 处（bridge-sample.ts 点名） |
| 接线（铁律4/5） | 新文件 `export function orphanUtil` | ❌ 接线审计: …unwired-sample.ts: export orphanUtil — 未被引用（点名） |
| Secrets | `sk-<22 位字母的门禁夹具串，task-28 按 CTO 裁定脱敏>` | check-secrets.sh rc=1，❌ 工作区发现真实凭证: 1 处（点名） |
| D296/D749 G12 | 无 brief 覆盖的 staged 代码 | ❌ G12: Q2 范围一致性: 37 处（含我未声明的样例文件） |
| 组7a DiagnosticModule | `export class MyDiagnosticModule` | ❌ 禁止 DiagnosticModule: 1 处（点名；`^\+\+\+` 排除项在正则中保全） |

**但发现一项拦不住/漂移（见问题 1）**：D937 密封回归网 grep-oP-regression.test.sh 在本分支 **5 处失败**（main 38/0 全绿）——`#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]` 等 5 个密封模式在重写后的脚本中不存在（B 把 CRITERIA 模式改为 `[:=：]` 含全角冒号、移除 brief 日期 `[0-9]{4}-…` 与 match_file 前缀模式），密封测试未同步。

## ⑤ 第二批 6 删除复核

- 删除 6 = acceptance-ci / bridge-files / deprecated-mapping / q0c-tracking / verifiable-done / brief-parseable（commit 2177a0a0 --stat）。零引用 grep：acceptance-ci/bridge-files/q0c-tracking/verifiable-done = 0；残留 3 处均为良性（check-hardcoded.sh 自述头注释、plan-integrity:16 迁移说明注释、loop-score:76 退役注释）。✔
- brief-parseable → `check-plan-integrity.sh --brief` 行为对比（同一 /tmp/brief-sample.md）：两宿主对坏 brief 均 rc=1；但**判定集不同**——新宿主新增 "#CRITERIA 缺失（必填 A-D）" 与 "Q2 做什么 无路径条目" 判据（旧版无），旧版另有 架构层 判据差异。**非逐字等价，是加严并入**（见问题 2）。
- 两 SKILL.md（pr-review）`diff` 逐字一致 ✔；`sync-dsh-skills.sh --check` → `SYNC-OK: 16 个技能` rc=0 ✔。

## ⑥ 计数链核（独立 find/ls-tree，含合并模拟）

| 状态 | B 声称 | 我实测 |
|---|---|---|
| 本分支 e58b55fe | 41 | **41** ✔ |
| 2a-scripts db3099fa | 29 | **28**（ls-tree 与工作树 find 双口径一致） |
| 合并后（模拟：分支集 − 2a 相对 main 删除集） | 23 | **22** |
| canary 删除后 | 22 | **21** |

后三段各差 1（见问题 3）。

## ⑦ WIP 血缘核

- `/tmp/D962-2a-precommit-WIP.sh` sha256 = `f957e4459309f495264976691d7402ec84591f0c0aecec281e15fafc63e399a2` ✔（410 行）。
- diff WIP→终稿：115 行变化，410→399。**删减内容类别逐条**：① 头部/段内注释改写（措辞压缩，无语义）；② `_DSH_PYBIN` 双轨 → `PYBIN` 全局化（合并变量，非删检查）；③ G12 `\$` 逃逸 bug 修复（恒绿 fail-open → 修，非删）；④ **新增** D547 骨架 brief 硬拦进早退路径（加严非减）；⑤ G10 分支重排（soft_pass 三条仍存 :250-254）。**断面（check-dsh-anchor 3=3）、检查调用数（hard/soft/warn =18=18）、三态语义、回归集内联全部保留，无保护性删减。** ✔

## 问题清单

1. **（阻断级）D937 密封回归网红**：grep-oP-regression.test.sh 本分支 5 失败 vs main 38/0 全绿。根因 = 2a① 重写改了 CRITERIA 模式（加全角：）并移除 brief 日期/match_file 前缀两模式，密封测试未同步——CI control-tower-tests lane 合并即红。**修复（同步密封断言或恢复模式）前不建议合并/提审。**
2. （轻）brief-parseable 并入声明"逐字吸收"与实测不符：新宿主为加严版（+#CRITERIA 必填、Q2 路径条目判据），建议 Note/plan 修正措辞并补两宿主判定集差异的测试注记。
3. （轻）计数链后三段（29/23/22）与我实测/模拟（28/22/21）各差 1，需 B 给出口径或勘误。
4. （环境注记，非缺陷）pre-commit 自过需 ACK=1：B 工作树 bypass.log 含今日 detected-bypass（synova-commit hook 登记"bypass COMMITTED"痕迹被 GATEKEEPER 计数）——GATEKEEPER 行为正常但该日常模式可能在 CI 外误伤，可列 CT 观察项。

## 未清项（非本批范围，按队长要求列出）

- M8 主树占用家族：本地保留 ✔ 但其 4 次历史事故的专项回归正样本未单独造（#17 判定体在位，:160-192 读码核过）。
- 桌面端人工截图类验收（D963 判据⑤"生效了吗"）仍待人工，未清。

## 自验结论

①②③⑤⑦ 全过；④ 六条正样本全部被拦但连带暴露 D937 密封回归网 5 处红（问题 1，阻断级）；⑥ 计数链首段吻合、后三段差 1 待勘误。

**自验结论：退回一件（问题 1 修复后复审）——grep-oP-regression.test.sh 密封断言与重写后脚本漂移致 CI lane 红，其余两件（措辞/计数勘误）随修复一并处理；问题 1 修复并复跑密封测试全绿后，可提请独立审计。**

— d962-verifier，2026-09-25，零仓库源文件改动（样例均在 /tmp/d962v3-tree）
