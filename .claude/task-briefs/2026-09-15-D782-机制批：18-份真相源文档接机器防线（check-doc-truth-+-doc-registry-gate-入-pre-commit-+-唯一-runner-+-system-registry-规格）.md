# Task Brief: D782 机制批：18 份真相源文档接机器防线（check-doc-truth + doc-registry-gate 入 pre-commit + 唯一 runner + system-registry 规格）

> 生成: 2026-09-15 | 任务: D782 | 认领: CTO（DeepSeek Harness, synova-cto）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔/治理域（scripts/doc-system + pre-commit + CI canary），非产品代码。
K3 2026-09-14 专项审计 §7.1 实证：D1/D2 防线 2026-08-19 建成即零调用（M3 第 3
次复发：D329 P2-2 → 本报告）；W1/W2 接线断言（tests/doc-system/doc-registry-gate.test.sh
L62-65）红 ≥25 天无 runner 可见；DRIFT-LEDGER 手写台账 25 天未重跑且声称与
git 事实相反（LOOP.md "8-20 已重写"从未合入）。
### b) 文件审计
- scripts/doc-system/check-doc-truth.sh L1-121（D1，实测 exit 1 六项硬失败：C1×3 专家数 7/7/8≠6、C2×2 组数 8≠13、C3 LOOP=V4.4.5）
- scripts/doc-system/doc-registry-gate.sh L1-49（D2，git 模式查 staged/untracked 新增 .md/.yaml 登记）
- tests/doc-system/doc-registry-gate.test.sh L64-65（W1/W2 = grep pre-commit-check.sh 两脚本名，期望 0）
- scripts/pre-commit-check.sh：grep "check-doc-truth\|doc-registry-gate" 零命中（git log -S 全历史零命中，从未接過）
- .github/workflows/ci.yml L224-258：control-tower-tests job 逐项枚举 33 个测试全部来自 tests/control-tower/，doc-system 零个
- expert/expert-registry.yaml v3.0（D650）：6 专家 = host + fundamental-efficiency/customer-growth/organizational-capability/technology-foundation/competitive-strategy
- tests/control-tower/grep-oP-regression.test.sh L200-214：BOM ratchet 精确匹配断言（清单与实际必须逐条一致）
### c) 决策
复用为主：D1/D2/六测试全部已存在，本单只补「调用点 + runner + 探针 + registry
样板」。新增仅 4 个文件（doc-truth-probe.sh、gen-system-registry.sh、
verify-system-registry.sh、system-registry.test.sh）+ 2 个生成物。

## Q1: 调研 — 业界最佳实践 / Anthropic 工程决策链 / memory 历史教训
- 铁律 0-2（测试先行+接线验收，WIRE CHECK）；铁律 35（自动化优先）；铁律 47/48（契约优先/测试非空壳）
- M3（机制建成未接线）：D329 P2-2 首次 → K3 2026-09-14 §7.2 收割 2 第 3 次——本单主靶
- M9（K3 §10.3 提案，永久红→信号衰减）：接线前必须先清 D1 六项红，否则 CI 权威上线即全线红
- D734 先例（pre-commit-check.sh L1397-1419）：附加命名检查块、不并入 13 组编号——改组数会连锁打破 C2 真值与 fastlane-bypass-only.test.sh 断言
- D515/D516（本地软提示 + CI 权威 SYNO_CI=1 转硬）——K3 §7.2 收割 3 明确该分工成立，缺的是调用点
- D520（平台敏感命令清单：GNU touch -d / sed -i / declare -A 需 bash4，mac bash 3.2 + BSD 工具兼容）
参考：K3 §7.2 五条收割 + §10.1/10.2 规格 + Anthropic 基线（canary 测试必须进 runner 才算数）+ 第一性原理（零调用的检查 = 不存在的检查）→ 收敛：接线优先于新机制，Anti-bloat（§10.3：零新增 M 类）。

## Q2: 范围 — 正确的最简方案
做什么（PR-0 先行治理批，5 文件，D708 写集声明）：
- docs/synova/coordination/ownership.yaml：scripts/doc-system/** 显式归 mac + 4 导航文档入 domain_neutral（D734 单域假阳性修复，D782 PR-1 前置）
- .github/CODEOWNERS：--emit-codeowners 重跑（doc-system 规则落地 +1 行）
- memory/notes/proposed/2026-09-15-D782-doc-truth-wiring.md：D534 决策 Note（§四b PR-0 段）
- task-state/D782.json：状态 claimed → impl_in_progress
- .claude/task-briefs/**：本 brief（D782 唯一 brief，四批共用；文件名含全角冒号会被 Q2 parser 按冒号截断，故以 glob 声明）
做什么（PR-1 接线批，原 12 文件现 9 文件——Note/brief/task-state 已随 PR-0 先行）：
- .github/workflows/ci.yml：control-tower-tests job 的 for 列表追加 tests/doc-system/ 6 个测试（控制塔红区显式声明；理由：K3 §7.2 收割 2 实证"红灯 ≥25 天零 runner"；该 job 自称『门禁坏了能抓到』的 canary 却缺 doc-system 域全部测试；列表级追加是最小改动，不碰 quality/integration/checker 等其他 job，不影响 docs-only 瘦身逻辑。
- scripts/pre-commit-check.sh：门禁红区显式声明。组 13 后追加「D782 文档真相防线」附加命名块（同 D734 模式，组号保持 13 不变——组数是 check-doc-truth.sh C2 的真值来源，改组数=连锁打破 AGENTS.md '13 组'声明）。调用 D1/D2：本地 soft_check（V5 分工）+ SYNO_CI=1 自动转硬。
- scripts/doc-system/check-doc-truth.sh：仅清首行 BOM（接线后输出直进 pre-commit 流，噪音行不可留）
- scripts/doc-system/doc-registry-gate.sh：仅清首行 BOM（同上）
- tests/control-tower/grep-oP-regression.test.sh — BOM_PENDING 清单同步删 2 行（ratchet 精确匹配）
- AGENTS.md：D1 六项硬失败根因修复之一
- CLAUDE.md：D1 六项硬失败根因修复之一
- LOOP.md：D1 六项硬失败根由修复之一
- knowledge/shared/README.md：D1 六项硬失败根因修复之一。总述（K3 台账 P1-07/P1-08，§12.3 列为"可直接开工、无需裁定"）：专家数对齐 registry v3.0=6（host+5 问题域名单）、组数 8→13、LOOP.md 版本轴对齐 V5.2.7。先转绿再接线，防 M9 永久红。
- memory/notes/proposed/2026-09-15-D782-doc-truth-wiring.md（D534 决策 Note）+ task-state/D782.json + 本 brief

做什么（PR-2 探针批，8 文件）：
- scripts/doc-system/doc-truth-probe.sh：存活探针 + DRIFT-LEDGER 机器生成（三态: FRESH-GREEN/FRESH-RED/STALE/NEVER-RUN + degraded exit 2）
- tests/doc-system/doc-truth-probe.test.sh：探针测试 18 用例（四态各测 + 红连续性 + 降级）
- docs/authority/DRIFT-LEDGER.md：由探针生成机器段（保留人工修复历史段）
- tests/doc-system/check-doc-truth.test.sh：BSD 兼容修复 sed -i → sed -i.bak（mac 2/5→5/0）
- tests/doc-system/doc-staleness.test.sh：BSD 兼容修复 touch -d → python3 os.utime（mac 2/4→4/0）
- tests/doc-system/doc-triage.test.sh：BSD 兼容修复 touch -d（mac 4/8→8/0）
- scripts/doc-system/doc-categories.sh：bash 3.2 兼容重写 declare -A → eval 受控枚举（mac 3/14→14/0）
- scripts/doc-system/doc-triage.sh：bash 3.2 兼容重写 declare -A → 换行定界集合（mac 4/8→8/0）
做什么（PR-3 BOM 尾批）：doc-system 剩余 5 文件 BOM + grep-oP 清单收尾
做什么（PR-4 registry 样板，4 文件）：
- scripts/doc-system/gen-system-registry.sh：寄存器生成器（AD01 第四章 42 边 + 五 counter; K3 §10.1; 禁手编字段）
- scripts/doc-system/verify-system-registry.sh：I1/I2/I3 校验器（只报不裁定; 三态; 样板=AD01+AD12+AD03）
- docs/authority/system-registry.json：生成物（generatedBy/generatedAtCommit 锚定）
- tests/doc-system/system-registry.test.sh：21 用例（I2 命中 E-08/E-10/E-11/E-12; 三路径）

不做什么：
- 不碰 scripts/audit/ 目录（K3 红线，check-gates-v2.py 的 BOM 保留原样——按 grep-oP ratchet 域派工原则归属 K3 域）
- 不改 tests/doc-system/doc-registry-gate.test.sh 的 W1/W2 断言（验收=让它自然转绿，改断言=作弊）
- 不裁定 K3 §8 待裁定项（E-08/E-10/E-11/E-12 以哪套编号为号、≥30 hard 是否下调、AD15 归属、因果链裁定——全部留给创始人；校验器只报冲突不定对错）
- 不改 .github/workflows/ci.yml 的 quality job docs-only 跳过逻辑（D515 设计；docs-only PR 的 D1 CI 权威缺位登记 Note 待立项）
- 不统一 compute 45/50/60/61/76/86/124 等多口径数字（K3 §12b.4：六种口径各有语义，压平=制造新错）
- 不碰 expert/expert-registry.yaml（真值源头只读，只改文档侧声明）
- 不碰 .git/hooks/pre-commit 这个 hook 文件的 exit 0 软提示语义（D4 分工成立，K3 收割 3 明示）

## Q3: 验收 — 入口 → 交互 → 结果
入口：git commit（pre-commit D782 附加块调用 D1/D2）+ CI push/PR（control-tower-tests 跑 doc-system 6 测试）
处理：D1/D2 从零调用变每次提交被调用（本地软提示/CI SYNO_CI=1 权威）；W1/W2 断言因 pre-commit 物理含调用点转绿
结果（可证伪）：
- bash tests/doc-system/doc-registry-gate.test.sh → 9 通过 0 失败（现 7/2）
- bash scripts/doc-system/check-doc-truth.sh → exit 0（现 6 项硬失败）
- 反向：从 pre-commit-check.sh 摘掉 D1/D2 调用 → W1/W2 必红；恢复 → 绿
- time 前后 pre-commit 差 ≤ +5s
- 存活探针：三态可区分（防线绿/防线红/从未运行，各测一例）
- 校验器对 AD01 报出 E-08/E-10/E-11/E-12 一码多义 → 用例断言命中

## 架构层:
scripts（控制塔/文档系统治理域；不触 src/ L1-L5）

## Done 标准
- [ ] verify: bash tests/doc-system/doc-registry-gate.test.sh → "9 通过 / 0 失败"
- [ ] verify: bash scripts/doc-system/check-doc-truth.sh → exit 0
- [ ] verify: grep -c "check-doc-truth.sh\|doc-registry-gate.sh" scripts/pre-commit-check.sh → ≥2
- [ ] verify: 摘线 → W1/W2 红（贴输出）；恢复 → 绿
- [ ] verify: pre-commit 全程 time 对比 ≤ +5s
- [ ] verify: bash tests/doc-system/system-registry.test.sh → 全过（含 E-08 断言命中）
