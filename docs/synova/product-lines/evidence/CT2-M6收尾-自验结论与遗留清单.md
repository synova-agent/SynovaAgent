# CT2 — M6 收尾三件（diff / 自验结论 / 遗留清单）· D1032

> 任务: task-2（CT-FLOW）｜ 卡号: D1032 ｜ 成员: flow-fix
> 分支: `fix/ct-flow-brief-ledger-20260927` ｜ 工作树: `/Users/wane/SynovaAgent/.synova-wt-ct-flow`
> Base: `476bac39`（origin/main）｜ 配套证据: `docs/synova/product-lines/evidence/CT2-门禁流程修复-证据.md`
> ⚠️ 用词纪律: 本件只给「自验结论」，**不含**「审计通过」字样（审计权归 K3）。

---

## 0. M6-① `git diff --stat`（原始输出，提交前暂存区全景）

```
$ git diff --cached --stat
 .../2026-09-28-D1032-CT系列-brief账本门禁收口.md   |  69 +++++
 .github/workflows/ci.yml                           |   1 +
 .../evidence/CT2-M6收尾-自验结论与遗留清单.md      | 139 +++++++++
 .../evidence/CT2-门禁流程修复-证据.md              | 313 +++++++++++++++++++++
 .../2026-09-28-ct-flow-gate-fail-closed-ledger.md  |  69 +++++
 scripts/control-tower/check-name-allocation.sh     |  59 +++-
 scripts/hooks/post-commit.sh                       |  48 +++-
 scripts/workflow/resolve-commit-brief.sh           |  37 ++-
 task-state/D1032.json                              |  11 +
 tests/control-tower/check-name-allocation.test.sh  |  38 ++-
 tests/control-tower/post-commit.test.sh            |  39 ++-
 tests/control-tower/resolve-commit-brief.test.sh   |  61 +++-
 tests/control-tower/simulate-ci.test.sh            |  97 ++++++-
 13 files changed, 963 insertions(+), 18 deletions(-)
```
- **产品/测试改动 = 8 文件**（单域 mac，队长独立核验）：`scripts/{workflow/resolve-commit-brief.sh, control-tower/check-name-allocation.sh, hooks/post-commit.sh}` + 4 个 `tests/control-tower/*.test.sh` + `.github/workflows/ci.yml`。
- **治理产物 = 5 文件**（D860 不计预算）：D1032 brief、`task-state/D1032.json`、2 份 `CT2-` 证据件、铁律 49 决策 Note。
- `.claude/current-brief` 为 runtime 文件（`.gitignore:30` 命中），**未入库**（只读/写它不产生提交内容）。

> ⚠️ 自指说明（防误读）：上方 963 是**追加本节之前**的暂存区快照；追加本节（+25 行）后**最终提交**的复算口径如下——
> ```
> $ git show --stat --format="" 4061e0e1 | tail -1
>  13 files changed, 988 insertions(+), 18 deletions(-)
> $ git show --name-only --format="" 4061e0e1 | grep -c .
> 13
> ```
> 文件清单与上方完全一致，差值仅为本节自身行数。

---

## 1. simulate-ci 全量运行结果（唯一的两条既有重型用例的真实代价已记录）

命令（工作树根、真仓 cwd）：
```
$ bash tests/control-tower/simulate-ci.test.sh      # 06:37:53 → 06:58:15
结果: 15 通过, 1 失败
```
**唯一失败项**（既有用例「全绿桩 → exit 0」）及其原始输出（节选首尾）：
```
  ❌ 应 exit 0, 实际 1 :: 内层完整输出:
═══════════════════════════════════════════════════════════
  simulate-ci — push 前 CI 等价模拟 (D521)
═══════════════════════════════════════════════════════════
── 1/2: Iron Laws（CI strict: SYNO_CI=1, SYNO_DIFF_BASE=origin/main）──
── 2/2: 密封 gate 测试（ci.yml CT job 同款清单）──
  ✅ tests/control-tower/alloc-task-id-lock.test.sh
  …（38 个 ✅，含我改动的 check-name-allocation / post-commit / post-commit-marker
      / clone-shadow-commit / synova-commit 全部 ✅）…
  ❌ tests/control-tower/precommit-groups-injection.test.sh — 模拟红（与 CI 一致）
❌ 模拟失败 — 本地能抓的错别送 CI（修复后重跑本脚本再 push）
```
**归因（对照实测，非推断）**：该 CT 测试在**纯净 `4afd4ce1` 工作树**同样红——
```
$ cd /private/tmp/ct2-baseline && bash tests/control-tower/precommit-groups-injection.test.sh ; echo rc=$?
GATE_INJECTION_SUMMARY: scenarios=5 red_confirmed=3 structural_not_red=0 not_red=1 baseline=ok probe=not_run(rc=n/a) residue_code=0 residue_repo=8 shim=1
❌ 注入自测未达期望：not_red=1 baseline=ok probe=not_run residue_fail=0
rc=1
# 我的工作树同命令摘要行**逐字相同**；两日志 diff 仅路径/耗时（REPO_DIR、BRANCH、tmp 目录、秒数）
```
⇒ 「全绿桩」用例断言的是 `simulate-ci.sh rc==0`，而它要求 ci.yml 那 45 个 CT 测试全绿 ⇒ **既有红必然使它红**。
**与本卡四条交付判据无关**：我的新判据全部在沙箱 cwd 独立覆盖（见下），未依赖那 45 个测试。

**顺带（本修复的价值实证）**：该失败断言里现在能看到**内层完整输出 + 失败测试点名**——同一场景在改前只会输出
`grep -E "❌|FAIL" | cut -c1-400` 的 98 字符摘要行（内层 1594 字符全灭，见证据件 §4.2）。

**我的新断言（全绿，11 条）**：
```
  ✅ 前置: 内层桩输出不含 ❌/FAIL（旧 grep 过滤会全灭）
  ✅ 前置: 内层桩输出 1581 字符 > 400
  ✅ 沙箱红桩 → simulate-ci exit 1（内层失败已捕获）
  ✅ 断言信息透传内层真实输出（1960 字符 > 400，未被 cut 截断）
  ✅ 内层末行标记可见（诊断不丢尾部）
  ✅ 内层尾部行可见（非仅首 400 字符）
  ✅ 超上限截断显式标注原因与上限值
  ✅ 子进程注入失败绿桩 → 整测试 exit≠0（rc=1）
  ✅ 子进程失败断言信息含内层末行标记（端到端透传成立）
```
**单次 `simulate-ci.sh` 真仓实测耗时**（供 CTO 评估该测试的既有成本）：
```
$ /usr/bin/time -p env SYNO_SIM_PRECOMMIT=<绿桩> bash scripts/control-tower/simulate-ci.sh
real 580.83
user 514.14
sys 80.55
rc=1   # ← 同一条既有红
```

---

## 2. 四件交付的自验矩阵（本地实跑原始输出见证据件）

| 交付 | 测试文件 | 改后 | 红证（改坏即红） | 判据 |
|------|---------|------|----------------|------|
| CT-A1 | `tests/control-tower/resolve-commit-brief.test.sh` | **37 通过 / 0 失败** | 删 fail-closed 分支 → **33/4**（红点恰在场景 12） | tie 无锚点 ⇒ rc=2 + 点名两条 ✅ |
| CT-B | `tests/control-tower/check-name-allocation.test.sh` | **27 通过 / 0 失败** | 删 brief-dup 段 → **24/3** | 同号 ⇒ rc=1 + 点名全部；真实三份 D1023 全捞 ✅ |
| CT-2 | `tests/control-tower/post-commit.test.sh` | **15 通过 / 0 失败** | 置空 `_softfail_state` → **13/2** | 软失败放行 ⇒ 账本 `DEGRADED-PASS (soft-fail allowed ts=… exit=1)` ✅ |
| simulate-ci | `tests/control-tower/simulate-ci.test.sh` | **15 通过 / 1 失败**（唯一失败 = §1 既有红连带） | 新判据由「前置不成立/标记丢失/≤400」三条互斥断言守；旧实现 98 字符 vs 新 2340 字符 | FAIL 透传内层完整输出 ✅ |

附加自检（全过）：
```
bash -n <7 个改动文件>                                  → 全部 exit 0
bash scripts/workflow/check-silent-swallow.sh --diff     → ✅ 无新增 .sh（跳过）/ 新增行无未豁免吞错
bash scripts/workflow/check-silent-swallow.sh --utf8     → 17 个缺头块（**基线同 17，逐字同列表**，我的 3 个脚本均不在列）
bash scripts/check-plan-integrity.sh                     → rc=0（Q2 排除项含路径 / 声明不改的文件未出现在变更集）
bash scripts/workflow/check-brief-parseable.sh <D1032 brief> → rc=0（Q2 ✓ #CRITERIA=A 架构层=基础设施 Done=5）
bash scripts/workflow/resolve-commit-brief.sh "<计划提交清单>" → 返回本 D1032 brief（rc=0；**未被自身 fail-closed 反噬**）
```

---

## 3. 自验结论

**自验结论：可提请独立审计。**（本件不主张"通过"——通过与否归 CTO 收件闸 + K3 终审）

依据：
1. 四条交付各有**改前/改后原始输出**（账本行、checker 输出、resolver 输出、透传字符数）与**独立的「改坏即红」红证**（单点变异 → 恰好目标断言红、其余保持绿 ⇒ 夹具是判别性的，不是恒红网）。
2. CT-B 判据在**真实数据**（`origin/main` 三份 D1023 brief）上成立，第三份（`2026-09-27-…`）未被漏判，未使用合成替身。
3. CT-2 的**串标防护**（干净提交不被误标）经夹具守；首次实现（仅 mtime 窗口）在该夹具下暴露同秒误标，已通过「证据行 ts 消费判定」修复并复测。
4. `simulate-ci` 唯一失败项已用**纯净基线对照**证明为既有红，且失败断言本身成为本修复的价值实证（内层完整透传）。
5. 全部改动文件 `bash -n` 通过；`--diff` 吞错扫描干净；`--utf8` 缺头块列表与基线逐字一致（非本卡引入）。
6. 写入范围：未触碰主树；未碰 `scripts/audit/**`；未碰 `scripts/install-hooks.sh`；未用 `--no-verify` / `git stash` / force push。

**不主张的部分（明确留白，防夸大）**：
- 未做全量 `vitest`（本卡不涉及 `src/**` 产品代码；不触发该门禁的变更面）。
- CT-A1 的 `exit 2` 在既有调用方（`pre-commit-check.sh:772` 等 `2>/dev/null || true`）会被当成"无 brief"跳过——本卡只保证「绝不给出错误 brief」，**不保证**调用方把并列升级为硬阻断（见遗留 L4）。

---

## 4. 遗留清单（如实登记，不隐藏）

| # | 遗留项 | 证据 | 影响 | 建议归属 |
|---|-------|------|------|---------|
| **L1** | `tests/control-tower/precommit-groups-injection.test.sh` 既有红（g12 `NOT_RED`），并使 `simulate-ci.test.sh`「绿桩→exit 0」连带红 | 纯净 `4afd4ce1` 工作树 rc=1，摘要行逐字相同（§1） | CI canary 少一组注入保护；simulate-ci 测试无法全绿 | **独立开卡**（owner: CTO 排期；不在本卡写集） |
| **L2** | 存量同号 brief：本仓 **30 个 D#** 被 ≥2 份 brief 用作任务身份（如 D593 ×5、D964 ×5），`brief-dup` 会对这些号报冲突 | 证据件 §2.5；判定命令 = `check-name-allocation.sh --id <D#>` | 人工校验这些 D# 时会多一条冲突（真值，但含"同任务拆多 brief"合法形态） | **规则侧决策**（CTO）：数据收口（改名/加 `-part-N-` 标记）或给校验器加显式豁免规则；**禁一次性特例** |
| **L3** | `tests/control-tower/resolve-commit-brief.test.sh` 改前**未登记 ci.yml**（显式清单无 glob 兜底）⇒ 该测试（含既有 11 个场景 + 本卡新增场景 12）CI 覆盖为零 | `grep -c "resolve-commit-brief.test.sh" .github/workflows/ci.yml` 改前 = **0**，改后 = **1**（§5 已接上） | 既有缺口；本卡已接线，**后续须由 CI 实跑确认**（K3/CI 首跑可见） | 已在本卡闭合（接线属交付内容）；若 CI 首跑红，按新证据另立卡 |
| **L4** | CT-A1 的并列诊断只对**直接调用方**可见：`pre-commit-check.sh:772` / `check-brief-vs-code.sh:35` / `check-plan-integrity.sh:19` / `check-verifiable-done.sh:21` 均 `2>/dev/null \|\| true` 吞 exit code ⇒ 并列被当作"无 brief"跳过 | 调用点原文（证据件 §1.2 契约说明） | 门禁链里不会硬阻断，只在人工/审计直接调用时可见 | 另立项：如需链内 fail-closed，需改上述调用方（不在本卡写集） |
| **L5** | 同号检测的**命名盲区**：7 类中 341/418 份 brief 命名符合 `YYYY-MM-DD[-_ ]D###…`；77 份 legacy 命名（如 `2026-06-14-1143-D53-API.md`）不含可解析身份 ⇒ 不参与检测 | `python3` 计数（证据件 §2.5 同源） | legacy 命名 brief 之间撞号不会被发现 | 若要覆盖需扩规则（另立项；避免一次性特例） |
| **L6** | `scripts/control-tower/synova-commit:449/:793` 在软提示存在时仍打印「13 组通过」/「全部 13 组检查通过」 | `synova-commit:442-450`、`:793`（本轮未改，最小连带；其上一行已原样透传软提示行） | 摘要行措辞不精确；**账本侧已由 CT-2 记真实状态** | 如需精确措辞，另立项（改 synova-commit + 其测试，本轮刻意不动以最小化连带） |
| **L7** | CT-2 的配对依据是文件写入序 + 证据行消费；极端并发（两个提交同时读到同一未消费软失败行）可能双标 | 证据件 §3.2 | 只会**多标** DEGRADED（安全方向：宁多标不误标 PASS） | 观察项；如出现再收紧（例如把 ts 消费改为原子写） |

---

## 5. 决策记录（收口期）

- **`ci.yml` 接线修复（交付内容，非遗留）**：CT job 用**显式清单**（`run: | for t in \ …`，无 glob 兜底），
  `tests/control-tower/resolve-commit-brief.test.sh` 改前**零登记** ⇒ CT-A1 夹具"只在本地跑过、CI 永不执行"
  = 统判据④「未接线」形态。收口前实测原文：
  ```
  $ grep -n "resolve-commit-brief" .github/workflows/ci.yml
  (零提及)
  $ grep -c "resolve-commit-brief.test.sh" .github/workflows/ci.yml
  0
  # 对照：check-name-allocation=1 / post-commit=1 / simulate-ci=1 / post-commit-marker=1 / clone-shadow-commit=1 / synova-commit=1
  ```
  处置：经队长批准（并核验域归属=mac 单域、三个队友工作树 `ci.yml` 计数均 0 无并发写者、插入点 `ci.yml:352` 旁）
  在 `ci.yml` 插入 **1 行**；改后 `grep -c` = 1，清单 45→46，YAML 双解析器（ruby / node js-yaml）均 OK，`git diff --numstat` = `1 0`。
  ⇒ 这是**既有缺口由本轮接上**（该测试文件从未登记；本卡把 CT-A1 夹具连同它一起接进 CI）。
- `L-BYPASS-LEDGER` 落点：由 CTO 裁定为 `scripts/hooks/post-commit.sh`（方案 A）；**正常 PASS 行文本一字未动**，`post-commit-marker.test.sh:71` / `clone-shadow-commit.test.sh:64` 硬断言保持绿（全量 CT 跑中二者均 ✅）。
- `L-Q2` 归属：改为 gate-fix（task-5）——本卡不碰 `.claude/task-briefs/2026-09-26-D1023-commit-msg-decisions.md`。
- `scripts/install-hooks.sh`：CTO 未批扩写集 ⇒ **零字节改动**（实测其已正确写 `GATE_FAIL_SOFT`，只需 post-commit 读）。
- 分支 base：未推送 ⇒ 用 `git merge --ff-only origin/main` 同步到 `476bac39`（**非 rebase、非 force**）。
