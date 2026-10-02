# D1122 · W1-A 死项退役：A1 断链注册行 + A3 hook-check-task-scope + A9 gate-stats

- **状态**: proposed
- **日期**: 2026-10-02
- **背景**: 治理线总窗 W1 第一批（共享任务板 `task-1`）。方向锚要求退役「写了没人调」的假门禁——
  这类门禁的代价不是 0 而是**负**：它让运维者以为防线在（假绿），并让「hook 有 N 条」「门禁有 M 个」
  这类计数失真。本件按「零行为变更」口径只做机械退役（不改变任何一条检查的通过/失败）。
  实测三条死项（均为物理 grep，非推断）：
  ① `scripts/hooks/hook-enforce-v25.sh` 在 `origin/main` **全仓不存在**，而 `.codex/hooks.json:18`
     仍注册它 ⇒ 每次 PreToolUse 拉起一个不存在的脚本，静默空转（继任者实为 `hook-enforce-loop.sh`）；
  ② `scripts/workflow/hook-check-task-scope.sh` **无任何 hook 接线**（`.claude/settings.json` 不存在、
     `.codex/hooks.json` 0 命中）、`ci.yml` 0 命中 ⇒ PreToolUse 面从未生效，只在文档里被描述为门禁；
  ③ `scripts/control-tower/gate-stats.sh` 同样无生产消费：`ci.yml:504` 只登记其**测试**，
     唯一「生产」侧触点 `scripts/pre-commit-check.sh:14` 是**注释**（F4 明令禁改）。
     ⚠️ 它另有一个**写集外**的活引用：`scripts/control-tower/simulate-ci.sh:62` 的 `SMOKE_TESTS` 默认样本串
     —— 这正是本件第 1 版退回、第 2 版扩权的原因（见下「考虑过的其他方案」1）。
- **决定**:
  1. **A1 删断链注册**：删 `.codex/hooks.json` 中注册 `hook-enforce-v25.sh` 的 object，
     其余 4 条 hook 注册逐字不动；JSON 仍合法（实测 `json.load` 通过）。零行为变更，
     因为被删的注册指向的文件本就不存在。
  2. **A3 退役 hook-check-task-scope**：删脚本 + 删其夹具；
     `gate-integrity-baseline.txt` [R] 段**删对应条目**（78→77）并在段头注明删除理由与 `as_of=2026-10-02`；
     `.codex/control-tower/VERSION.md` 的 D366 条目下标注「已退役（D1122）」，不动其它内容。
     **删条目是棘轮合规的减项**：段头既定语义「文件已删 ⇒ 条目过期 ⇒ 须删条目」——
     留着才是违规（基线过期）。非判据放宽。
  3. **A9 退役 gate-stats**（第 1 版退回 → 第 2 版经队长 **F1 有限扩权**后落地）：删
     `scripts/control-tower/gate-stats.sh` + `tests/control-tower/gate-stats.test.sh` +
     `ci.yml:504` 登记行（**只删这一行**），并按 F1 **仅改一行** `scripts/control-tower/simulate-ci.sh:62`
     （`SMOKE_TESTS` 默认样本串去掉已删夹具）——该行是 smoke fail-closed 的触发源，不消则 CI 恒红。
     实测翻绿：`bash tests/control-tower/simulate-ci.test.sh` → `结果: 10 通过, 0 失败`、**rc=0**。
- **考虑过的其他方案**:
  1. **A9 按派单件三处改动直接落地（第 1 版写集内）** ⇒ **第 1 次已驳回、履行「退回不自扩权」，后经 F1 扩权才做**：
     实测 `scripts/control-tower/simulate-ci.sh:62` 的 `SMOKE_TESTS` 默认值**硬引用**
     `tests/control-tower/gate-stats.test.sh`，且 smoke 分支对该样本 fail-closed
     （样本不在 ci.yml 密封清单内即 `FAIL=1`）。三处改动落地即令
     `tests/control-tower/simulate-ci.test.sh` 恒红，而该夹具**本身就在 ci.yml 密封清单内** ⇒ CI 红。
     探针工作树实测复现：`结果: 9 通过, 1 失败`、`rc=1`，失败行
     `❌ smoke 代表样本 tests/control-tower/gate-stats.test.sh 不在 ci.yml 密封清单内（fail-closed）`。
     ⇒ 第 1 次按「需要改写集外的文件时停下并回报队长，不要自己扩权」**只退回、不落地**；
     队长 **F1**（写集 +1 文件 = `simulate-ci.sh`，**仅许改 `:62` 一行**）后补做并实测翻绿。
     结论固化：**清单与消费端必须同批收缩**——第 1 版派单漏的正是这条侧翼。
  2. **A9 改为「保留 ci.yml 登记行、只删文件」** ⇒ 否决：会留下「登记了不存在的测试」的漂移
     （`check-canary-drift.sh` 自愈 warning），且违背派单件明条「从 ci.yml 删除其测试登记行」。
  3. **A3 连同 `today-by-name.test.sh:152` 一起改** ⇒ 否决（本卡不自扩权）：该断言为**求和后 ≥4**，
     删后实测 `CALLS=13` **仍 PASS**，无功能影响；且该测试在改动前就已红
     （`line 67: DAY_WINDOW_RE: unbound variable`，预存在缺陷）。写集外残留按派单纪律登记、不自改。
  4. **删 `.codex/hooks.json` 注册时连带改 `AGENTS.md` / `hook-enforce-loop.sh` 注释（旧名遗留）** ⇒ 否决：
     均不在本件写集；属文档漂移另卡，避免一卡多域。
- **后果**:
  - 好：三条假门禁从「静默空转」转为「显式退役 + 有记录」；hook 注册表与实际文件重新一致；
    净删 4 文件、净新增 0 机制（治理线「KPI 是否定自己的扩张」口径下的正收益）；
    **`simulate-ci.test.sh` 由修复前红翻绿**（9 通过 1 失败 rc=1 → 10 通过 0 失败 rc=0）。
  - 坏/要长期承担：① `scripts/pre-commit-check.sh:14`、`scripts/hooks/hook-enforce-loop.sh:3`、
    `AGENTS.md:175`、`.codex/control-tower/VERSION.md:170/190/200` 的历史注释/字符串残留**显式登记留待文档卡**
    （F2 口径：活引用为 0 即可，字符串引用允许留存但须逐条标注）；
    ② `tests/control-tower/today-by-name.test.sh:152` 残留 + `:67` 预存在红按 **F3 禁触碰**，转 `task-4`/D1124；
    ③ 退役只减不增，但**未建立任何机器防线防止未来再出现「注册指向不存在文件」的断链**
    （本件是清理不是防复发）；建议后续卡：hook 注册表 ⇄ 实际文件的机械一致性检查（当前零检查）。
- **取代**: 无（净删除，不取代任何既有决策）。
