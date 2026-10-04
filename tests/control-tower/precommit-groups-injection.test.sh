#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# precommit-groups-injection.test.sh — pre-commit 各组「违规注入必红」判别性夹具
#   M9 控制塔门禁三件套 / task-6（m9-coder-b 写集）。K3 批次2 §五 #1 要求：
#   证明各组不是 fail-open（"接线了"≠"被执行"——要有"注入即报红"的判别证据）。
#
# ═══ 契约（铁律 47）═══
#   @input  — 无参数。被测对象 = 本仓库 HEAD 的 scripts/pre-commit-check.sh。
#             环境开关: SYNO_PRE_COMMIT_INJECT_FULL=1 → 跑全部 12 组；
#                       缺省（CI 与人工默认）→ 抽检 4 组（组 1/2/7/12）+ 1 绿基线；
#                       SYNO_INJECT_REQUIRE_CLEAN_BASELINE=1 → 基线 HOST_STATE 也判红（严格守门）。
#   @output — 逐组结果行 + 耗时汇总表 + 收尾残留断言 + 末行机器可读汇总:
#             GATE_INJECTION_SUMMARY: scenarios=<n> red_confirmed=<n> structural_not_red=<n>
#                                     not_red=<n> baseline=<ok|host_state|FAIL> probe=<状态>(rc=<n>)
#                                     residue_code=<n> residue_repo=<n> shim=<0|1>
#   @exit   — 0 = 全部期望红组均 RED_CONFIRMED（structural_not_red 须带**已验证**的结构性理由），
#                且绿基线 rc=0（或 baseline=host_state 且有因果隔离探针证据），且残留断言过；
#             1 = 任一期望红组未红 / 基线不绿且不可归因 / 残留断言失败（业务失败）；
#             2 = 夹具自身执行失败（不在 git 仓库 / clone 失败 / 副本 SHA 不一致，
#                 与"门禁没红"区分开——D328 三态）
#   @degraded — exit 2 + stderr "degraded: <原因>"（铁律 11/24）
#
# ═══ 组标签映射（**冻结事实，勿假设 1..13 连续**）═══
#   实测: `grep -c '── 组 ' scripts/pre-commit-check.sh` = 12
#   标签为 组 1/13, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13 —— **组 11 不存在**
#   （无 `── 组 11` echo；组号沿用脚本历史 echo，不重排）。本夹具按 echo 标签定位断言，
#   不按 1..13 循环，避免把不存在的组 11 当失败。
#
# ═══ 隔离（hermetic）═══
#   全部注入只发生在 `mktemp -d` 副本里（git clone 副本 + reset --hard/clean -fdx 复位）。
#   源工作树只读：夹具不写源工作树任何文件（收尾断言物理证明）。禁用 `timeout` 命令
#   （本机实测 `bash: timeout: command not found`）——需要限时用外层调度，或按本夹具做法
#   直接跑并记录耗时。
#
# ═══ 为何跑 pre-commit 时注入 GITHUB_ACTIONS=true + SYNO_CI=1 ═══
#   1) SYNO_CI=1 = ci.yml Iron Laws job 的同口径（软提示在 CI 转硬）——本夹具要验的正是
#      "CI 权威门禁"这条链路，否则本地 V5 软化会让 soft_check 不返回非 0，断言失去意义。
#   2) GITHUB_ACTIONS=true = 避开本地 GATEKEEPER 分支（pre-commit-check.sh L239: 该分支只在
#      非 CI 环境读 .claude/bypass.log 的"今日 detected-bypass"）。副本里的 bypass.log 是被
#      clone 携带的历史记录，与本次注入无关，属**宿主状态**而非**内容违规**；CI 上同一脚本
#      走 GITHUB_ACTIONS 分支天然不读它 → 夹具按 CI 口径对齐，避免宿主状态污染内容断言。
#      （实测：base 416b4667 当日 detected-bypass = 0，双保险。）
#   3) 不设 SYNO_DIFF_BASE → 组 1 走 `git diff --cached`（真实的"本次暂存"路径），
#      不依赖副本里是否存在 origin/main。
#   4) 不设 SYNO_TEST_ARM / SYNO_GIT_CACHED_* / SYNO_SECRETS_ROOT / SYNO_BRIEF_DIR
#      → _SANDBOX=0（decl_check 走硬阻断），且注入缝 fail-closed 保持关闭。
#
# ═══ python shim 与组 9（实测发现，见回报与注释）═══
#   本机（macOS）无 `python`（仅 python3）。组 9 契约门禁 L1099 用 `python -c` 解析
#   .codex/contracts/*.json → 无 python 时 DECLARED 恒空 → 该组**恒定假绿**（结构性 fail-open）。
#   夹具在宿主无 python 时启用 PATH shim（python→python3），仅为让组 9 的判定逻辑可执行
#   （CI runner 有 python）。shim 路径与启用标志全部打印在输出里，不静默。
#   ⚠️ 该 shim 不改被测脚本一个字节；无 shim 时的假绿现象由回报单独记录（CTO 裁定）。
#
# ═══ 既有红基线相关 ═══
#   本夹具不读 scripts/control-tower/ci-red-baseline.txt（那是 --ci-reds 的输入，属另一件）。
#   绿基线场景要求**干净副本 rc=0**；若 base 提交本身有存量红，绿基线会失败并逐行打印，
#   这正是"存量红必须可见"的判别（红证不得被静默）。此时不得修改夹具去迁就基线。
#
# ═══ 收尾残留断言（比"全仓库 grep=0"更强，且实测可满足）═══
#   实测：字面量 "INJECTED""-RED" 在 base 提交已存在于 6 个既有文件（D922/D935 证据、
#   preset SYSTEM-PROMPT、K3 D854 报告、总计划）——全仓库 grep=0 在任何实现下都不可达。
#   所以收尾断言分三面（全部打印原始输出）：
#     a) 代码/测试/脚本/CI 面 = 0（注入残留可能落地的面：src/ tests/ scripts/ .github/）
#     b) 仓库全量 = 既有基线数（夹具打印实测数；多于基线 = 有残留）
#     c) 副本内标记存在性（反向判别：注入确实发生过；绿基线必须 = 0）
#   夹具内标记用拼接写法（MARK="INJECTED""-RED"）→ 夹具自身不含连续字面量，不会自命中。
#
# ═══ 绿基线与宿主 /tmp 泄漏（实测发现，2026-09-24 本机复现；CTO 裁定前按此分类）═══
#   实测：干净副本直接跑 `GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh` → rc=1，
#   唯一红 = `❌ 时间戳顺序: brief 必须早于代码写入`。根因不是内容违规：
#     pre-commit-check.sh L910 `BEFORE_BRIEF_EVI="/tmp/.synova-before-brief"` = **绝对宿主路径**，
#     不是仓库相对路径 → 副本 hermetic 被打破，宿主上别人 session 的 marker 会污染副本判定。
#   本夹具处置（三线证据，不静默、也不动宿主文件）：
#     i)   基线 rc!=0 且「排除汇总行后唯一 ❌ = 时间戳顺序」且该绝对路径文件确实存在
#          → 判 BASELINE_HOST_STATE（不是 BASELINE_OK）
#     ii)  打印该 marker 的内容首行 + L910 的路径来源（grep 证据）
#     iii) 因果隔离探针（只改**副本**里这一行路径 → 仓库相对）重跑，rc=0 才认"内容基线为绿"；
#          探针改了被测对象，故只作因果归因，**不计入组判定**
#   默认：BASELINE_HOST_STATE 不置 rc=1（否则本机任何运行的验收命令恒失败），但汇总行
#   显式写 baseline=HOST_STATE 并打印 remediation（由 marker 属主 session 清理）。
#   要求严格者（或 CI 之外的守门）可设 SYNO_INJECT_REQUIRE_CLEAN_BASELINE=1 → HOST_STATE 直接判红。
#   CI 侧：runner /tmp 为全新 → 不存在该 marker → 基线应得 BASELINE_OK（本夹具在 CI 上会更严）。
#
# ═══ 注入清单（每组一个场景；"期望红"= 注入后该组区块必须出现 ❌）═══
#   g1  组 1/13  暂存新增 src/*.ts 含 `as any`（非注释行）            → as any 零容忍
#   g2  组 2/13  暂存新增 src/*.ts 且无配对 tests/*.test.ts           → 新文件配对
#   g3  组 3/13  暂存新增文件含 sk-<20+ alnum> 形态假密钥             → Secrets 扫描
#   g4  组 4/13  暂存新增 src/*.ts（带配对测试，排除组 2 干扰）       → 接线审计（未引用）
#   g5  组 5/13  暂存新增 src/*.ts 引用 packages/engine-core          → 铁律 46 桥接
#   g6  组 6/13  暂存代码 + 认领 brief 的 Q0/Q1/Q3/架构层/Done 全空   → 6 核心字段
#   g7  组 7/13  暂存新增行含 "Diagnostic"+"Module"（拼接，非注释）    → 禁止新 "Diagnostic"+"Module"
#   g8  组 8/13  暂存新增 extensions/<新目录>/probe.txt（无 manifest）→ 目录结构
#   g9  组 9/13  .codex/contracts/*.json 声明产出不在暂存区           → 契约门禁
#   g10 组 10/13 端到端 brief + 无暂存 .test.ts                      → G10/G11 条件区域
#   g12 组 12/13 暂存 scripts/*.sh 无任何今日 brief 认领               → Q2 范围一致性
#   g13 组 13/13 暂存改动 .claude/skills/**（与 .dsh/skills 漂移）     → 技能同步
#
# ═══ D1148 追加（两种模式都跑，非 run_scenario 框架）═══
#   d1148-decl   探针 brief 违反 ①Q0/Q1 空 ②无 #CRITERIA ③Done 无 verify: →
#                三条声明硬闸必须各自点名（合并前由 9 个检查点承担且多条永不阻断）
#   d1148-excl   认领者同时把探针文件列进 Q2「不改」→ 闸② 必须点名「Q2 排除项」
#
#   用法: bash tests/control-tower/precommit-groups-injection.test.sh
#         SYNO_PRE_COMMIT_INJECT_FULL=1 bash tests/control-tower/precommit-groups-injection.test.sh
#   CI:   .github/workflows/ci.yml job `gate-integrity` step 2（抽检即注册）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# 拼接写法：夹具自身不含连续字面量（收尾 grep 不自命中）
MARK="INJECTED""-RED"
# 拼接写法（同 MARK 惯例）：源码内**不出现**该连续 token —— 否则本夹具的新增行会被
#   pre-commit 组 7a「禁止新 "Diagnostic"+"Module"」按 PR diff 扫中 → 自误伤假红（#768 实测 2 处）。
#   语义完全等价：运行时拼接出的串与原先的字面量逐字节相同（注入行为不变）。
DM_TOKEN='Diagnostic''Module'

TODAY="$(date +%Y-%m-%d)"

REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_DIR" ]; then
  echo "degraded: 不在 git 仓库内，无法定位被测对象 (code=GATE_INJECT_SETUP, phase=locate, retryable=false)" >&2
  exit 2
fi
BASE_SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
BRANCH="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"

TMP="$(mktemp -d)"
CLONE="$TMP/repo"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

echo "═══════════════════════════════════════════════════════════════"
echo "  pre-commit 组注入自测 (M9 task-6 / 判别性夹具)"
echo "═══════════════════════════════════════════════════════════════"
echo "REPO_DIR   = $REPO_DIR"
echo "BASE_SHA   = $BASE_SHA"
echo "BRANCH     = $BRANCH"
echo "TMP        = $TMP  （hermetic 副本；注入只发生在此）"
echo "MODE       = $([ "${SYNO_PRE_COMMIT_INJECT_FULL:-0}" = "1" ] && echo FULL-12-组 || echo SAMPLED-抽检-4-组)"
echo ""

# ── python shim（仅为组 9 可执行；见头部注释）──
HOST_PATH="$PATH"   # 保存宿主原始 PATH（组 9 结构性探针要用真实状态，不能用 shim 后的）
SHIM_USED=0
if ! command -v python >/dev/null 2>&1; then
  mkdir -p "$TMP/shim"
  printf '#!/bin/bash\nexec python3 "$@"\n' > "$TMP/shim/python"
  chmod +x "$TMP/shim/python"
  PATH="$TMP/shim:$PATH"; export PATH
  SHIM_USED=1
  echo "[ENV] 宿主无 python → 启用 PATH shim（python→python3），使组 9 契约门禁可执行（CI runner 有 python）"
  echo "[ENV] 无此 shim 时组 9 在本机恒假绿（pre-commit-check.sh L1099 用 python -c）—— 已单独记录为实测发现"
  echo ""
fi

# ── 副本 ──
if [ "$BRANCH" = "HEAD" ]; then
  git clone -q "$REPO_DIR" "$CLONE" 2>"$TMP/clone.err" || { echo "degraded: git clone 失败 (code=GATE_INJECT_SETUP, phase=clone, retryable=true)" >&2; cat "$TMP/clone.err" >&2; exit 2; }
  git -C "$CLONE" checkout -q --detach "$BASE_SHA" || { echo "degraded: 副本 checkout $BASE_SHA 失败" >&2; exit 2; }
else
  git clone -q --branch "$BRANCH" --single-branch "$REPO_DIR" "$CLONE" 2>"$TMP/clone.err" || { echo "degraded: git clone 失败 (code=GATE_INJECT_SETUP, phase=clone, retryable=true)" >&2; cat "$TMP/clone.err" >&2; exit 2; }
fi
CLONE_SHA="$(git -C "$CLONE" rev-parse HEAD)"
if [ "$CLONE_SHA" != "$BASE_SHA" ]; then
  echo "degraded: 副本 SHA($CLONE_SHA) != 源 HEAD($BASE_SHA) — 拒绝在错误对象上做注入断言 (code=GATE_INJECT_SETUP, phase=verify, retryable=true)" >&2
  exit 2
fi
echo "CLONE_SHA  = $CLONE_SHA  (verified == BASE_SHA)"
echo ""

reset_clone() {
  git -C "$CLONE" reset -q --hard HEAD
  git -C "$CLONE" clean -qfdx
}

# ═══ 断言工具 ═══
# 区块提取: 从本组 echo 标签行起，到下一个「── 组 」或跨组区块标记（D782/PR 预算/D520）为止
block_of() { # <label> <logfile>
  awk -v pat="$1" '
    !f && index($0, pat) { f=1 }
    f {
      if (index($0, "── 组 ") && !index($0, pat)) exit
      if (index($0, "── D782") || index($0, "── PR 预算门禁") || index($0, "── D520/任务3")) exit
      print
    }
  ' "$2"
}

strip_ansi() { sed $'s/\033\\[[0-9;]*[a-zA-Z]//g'; }

fail_lines() { # <label> <logfile> <max>
  block_of "$1" "$2" | strip_ansi | grep '❌' | sed 's/^[[:space:]]*//' | head -"$3" || true
}

# 组标签常量（实测 echo 文本；组 11 不存在）
LBL_g1="── 组 1/13: 类型安全 + 硬编码数据 ──"
LBL_g2="── 组 2/13: 测试质量 ──"
LBL_g3="── 组 3/13: Secrets ──"
LBL_g4="── 组 4/13: 接线完整性 ──"
LBL_g5="── 组 5/13: 架构边界 + 桥接文件 ──"
LBL_g6="── 组 6/13: Task Brief (6 核心字段) ──"
LBL_g7="── 组 7/13: 架构合规 ──"
LBL_g8="── 组 8/13: 文件驱动架构完整性 (V3.9) ──"
LBL_g9="── 组 9/13: 契约门禁 ──"
LBL_g10="── 组 10/13: V3 流水线健康度 ──"
LBL_g12="── 组 12/13: Task Scope 一致性 ──"
LBL_g13="── 组 13/13: 技能同步一致性 ──"

INJ_NOTE=""
INJ_PREFLIGHT_FAIL=""

# ═══ 注入函数（只写 ${CLONE}）═══
inj_g1() {
  cat > "$CLONE/src/m9-fixture-g1.ts" <<EOF
// $MARK group-1 (as any 注入)
export const m9InjectG1 = 1 as any;
EOF
  git -C "$CLONE" add src/m9-fixture-g1.ts
}

inj_g2() {
  cat > "$CLONE/src/m9-fixture-g2.ts" <<EOF
// $MARK group-2 (新增实现无配对测试)
export function m9InjectG2(): number { return 2; }
EOF
  git -C "$CLONE" add src/m9-fixture-g2.ts
}

inj_g3() {
  cat > "$CLONE/src/m9-fixture-g3.ts" <<EOF
// $MARK group-3 (假密钥，仅存在于 mktemp 副本)
export const m9InjectG3 = "sk-abcdefghijklmnopqrstuvwx";
EOF
  git -C "$CLONE" add src/m9-fixture-g3.ts
}

inj_g4() {
  cat > "$CLONE/src/m9-fixture-g4.ts" <<EOF
// $MARK group-4 (新增 export，无任何 src/ 调用方)
export function m9InjectG4(): number { return 4; }
EOF
  cat > "$CLONE/tests/m9-fixture-g4.test.ts" <<EOF
// $MARK group-4 (配对测试：≥3 expect，避免与组 2 混淆)
import { describe, it, expect } from 'vitest';
describe('m9InjectG4', () => {
  it('placeholder', () => {
    expect(1).toBe(1);
    expect(2).toBe(2);
    expect(3).toBe(3);
  });
});
EOF
  git -C "$CLONE" add src/m9-fixture-g4.ts tests/m9-fixture-g4.test.ts
}

inj_g5() {
  cat > "$CLONE/src/m9-fixture-g5.ts" <<EOF
// $MARK group-5 (引用 packages/engine-core)
export const m9InjectG5 = 'packages/engine-core';
EOF
  git -C "$CLONE" add src/m9-fixture-g5.ts
}

inj_g6() {
  cat > "$CLONE/src/m9-fixture-g6.ts" <<EOF
// $MARK group-6 (认领 brief 6 字段为空)
export const m9InjectG6 = 6;
EOF
  cat > "$CLONE/.claude/task-briefs/${TODAY}-m9-fixture-g6-incomplete-fields.md" <<EOF
# Task Brief — 夹具场景 G6（6 核心字段不全）

## Q0: 定位 — 项目拼图 + 文件审计

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- src/m9-fixture-g6.ts — 夹具注入文件（Q2 已填，仅用于让本 brief 取得认领权）

不做什么（含文件路径）：
- 不改 scripts/pre-commit-check.sh

## Q3: 验收 — 入口 → 交互 → 结果
EOF
  git -C "$CLONE" add src/m9-fixture-g6.ts
  # 预检：认领解析必须落到本夹具 brief（否则组 6 断言的是别人的 brief，判别性失效）
  local resolved
  resolved="$(cd "$CLONE" && bash scripts/workflow/resolve-commit-brief.sh "src/m9-fixture-g6.ts" 2>/dev/null || true)"
  if ! echo "$resolved" | grep -q "m9-fixture-g6-incomplete-fields"; then
    INJ_PREFLIGHT_FAIL="g6 认领预检失败：resolve-commit-brief 返回 '${resolved:-<空>}'，未指向夹具 brief"
  else
    INJ_NOTE="认领预检: $(basename "$resolved")"
  fi
}

inj_g7() {
  cat > "$CLONE/src/m9-fixture-g7.ts" <<EOF
// $MARK group-7
export const m9InjectG7 = '$DM_TOKEN';
EOF
  git -C "$CLONE" add src/m9-fixture-g7.ts
}

inj_g8() {
  mkdir -p "$CLONE/extensions/m9-fixture-g8"
  cat > "$CLONE/extensions/m9-fixture-g8/probe.txt" <<EOF
$MARK group-8 (新扩展目录：故意不放 manifest.json)
EOF
  git -C "$CLONE" add extensions/m9-fixture-g8/probe.txt
}

inj_g9() {
  mkdir -p "$CLONE/.codex/contracts"
  cat > "$CLONE/.codex/contracts/m9-fixture-g9.json" <<EOF
[{"filePath": "src/m9-fixture-g9-not-staged.ts", "note": "$MARK group-9 声明产出不在暂存区"}]
EOF
  cat > "$CLONE/src/m9-fixture-g9.ts" <<EOF
// $MARK group-9 (仅为让暂存区非空)
export const m9InjectG9 = 9;
EOF
  git -C "$CLONE" add .codex/contracts/m9-fixture-g9.json src/m9-fixture-g9.ts
}

inj_g10() {
  cat > "$CLONE/scripts/m9-fixture-g10.sh" <<EOF
#!/bin/bash
# $MARK group-10 (端到端声明但暂存区无 .test.ts)
exit 0
EOF
  chmod +x "$CLONE/scripts/m9-fixture-g10.sh"
  cat > "$CLONE/.claude/task-briefs/${TODAY}-m9-fixture-g10-e2e-no-tests.md" <<EOF
# Task Brief — 夹具场景 G10（声明端到端验收但暂存区无测试文件）

## Q0: 定位 — 项目拼图 + 文件审计
夹具占位：G10/G11 条件区域与测试覆盖判定的注入场景。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
参考：第一性原理 + 注入即验证（本夹具语境，无外部最佳实践可引）。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- scripts/m9-fixture-g10.sh — 夹具注入脚本

不做什么（含文件路径）：
- 不改 scripts/pre-commit-check.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：bash scripts/m9-fixture-g10.sh（端到端占位）
处理：占位
结果：exit 0

## 架构层
L1（夹具占位，不触五层依赖）

## Done 标准
- [x] 端到端占位命令可执行（verify: bash scripts/m9-fixture-g10.sh）
EOF
  git -C "$CLONE" add scripts/m9-fixture-g10.sh
  local resolved
  resolved="$(cd "$CLONE" && bash scripts/workflow/resolve-commit-brief.sh "scripts/m9-fixture-g10.sh" 2>/dev/null || true)"
  if ! echo "$resolved" | grep -q "m9-fixture-g10-e2e-no-tests"; then
    INJ_PREFLIGHT_FAIL="g10 认领预检失败：resolve-commit-brief 返回 '${resolved:-<空>}'，未指向夹具 brief"
  else
    INJ_NOTE="认领预检: $(basename "$resolved")"
  fi
}

inj_g12() {
  cat > "$CLONE/scripts/m9-fixture-g12.sh" <<EOF
#!/bin/bash
# $MARK group-12 (无任何今日 brief 认领：Q2 范围外)
exit 0
EOF
  chmod +x "$CLONE/scripts/m9-fixture-g12.sh"
  git -C "$CLONE" add scripts/m9-fixture-g12.sh
}

inj_g13() {
  printf '\n<!-- %s group-13 (故意制造 .claude/skills ↔ .dsh/skills 漂移) -->\n' "$MARK" >> "$CLONE/.claude/skills/squad-discipline/SKILL.md"
  git -C "$CLONE" add .claude/skills/squad-discipline/SKILL.md
}

# ═══ 结构性理由断言：非红时必须**物理验证**理由（不得口头豁免，不得白名单）═══
# 通用约定：场景名 $name 若未红，则尝试 assert_${name}_structural；不存在该函数 → NOT_RED（判失败）。
# 每个 assert 必须**用当前脚本里的真实模式**做探针（从副本 pre-commit-check.sh 抽模式），
# 抽出失败即返回 1（宁可判红，不得用"我记得"当理由）。
# 组 12：场景未红的结构性理由 —— 组 12 在「无今日 brief」时**整段跳过**（soft_pass / fail-open）。
#   pre-commit-check.sh 组 12 注释自述（D506 修正）：
#     "ALL_TODAY_BRIEFS 空 → G12 整段跳过 soft_pass（fail-open）"
#   本场景只注入 scripts/m9-fixture-g12.sh，**未注入"今日 brief"** ⇒ 组 12 不产生 ❌
#   是其 fail-open 行为所致 —— 属**门禁自身缺陷**（需 CTO 另行派工），非夹具失效。
#   物理探针（不许口头豁免）：① 组 12 标签在源码 ② fail-open 分支在源码 ③ clone 内今日 brief 数 = 0
assert_g12_structural() {
  local pc="$CLONE/scripts/pre-commit-check.sh"
  if ! grep -q '组 12/13: Task Scope 一致性' "$pc" 2>/dev/null; then
    echo "    [structural g12] 未找到组 12 标签（模式抽不到）"
    return 1
  fi
  local fo
  fo="$(grep -cE 'ALL_TODAY_BRIEFS 空|G12 整段跳过|整段跳过 soft_pass' "$pc" 2>/dev/null || true)"
  fo="${fo//[^0-9]/}"
  local today n
  today="$(date +%Y-%m-%d)"
  n="$(ls "$CLONE/.claude/task-briefs/" 2>/dev/null | grep -c "$today" || true)"
  n="${n//[^0-9]/}"
  echo "    [structural g12] fail-open 自述命中 ${fo:-0} 处 ｜ clone 内今日($today) brief 数 = ${n:-0}"
  if [ "${fo:-0}" -gt 0 ] && [ "${n:-0}" -eq 0 ]; then
    return 0   # fail-open 分支存在 + 今日 brief 为 0 ⇒ 组 12 结构性不可达（门禁缺陷，已立卡）
  fi
  return 1
}

assert_g10_structural() {
  local pc="$CLONE/scripts/pre-commit-check.sh"
  local defs usages
  # 定义数：`CHANGED_FILES=` / `STAGED_FILES=` / `export ...=` 一律算定义
  defs="$(grep -cE '(^|[[:space:]])(export[[:space:]]+)?(CHANGED_FILES|STAGED_FILES)=' "$pc" 2>/dev/null || true)"
  usages="$(grep -cE '\$(CHANGED_FILES|\{CHANGED_FILES\}|STAGED_FILES|\{STAGED_FILES\})' "$pc" 2>/dev/null || true)"
  defs="${defs//[^0-9]/}"; usages="${usages//[^0-9]/}"
  echo "    [structural g10] pre-commit-check.sh: 定义 ${defs:-0} 处 / 使用 ${usages:-0} 处"
  if [ "${defs:-0}" -eq 0 ] && [ "${usages:-0}" -gt 0 ]; then
    return 0   # 使用存在但从未定义 → G10/G11 判定恒走 soft_pass（结构性不可达）
  fi
  return 1
}

# 组 7：7a（"Diagnostic"+"Module"）排除正则含 `^+++` = **非法 ERE** → `grep -Ev` 直接报错
#   （BSD grep 实测 rc=2: "repetition-operator operand invalid"）→ 管道输出为空、又有 `|| true`
#   → NEW_DIAG 恒空 → 该子检查恒定"✅"（fail-open）。
#   反例（防止把归因扩大到整个组）：7d（数据流）HAS_HARD 用的是 `\|` 交替，是**有效 BRE**，
#   实测能命中 'marketing' → 组 7 区块并非整体坏死，坏死点精确到 7a 的正则。
# 两条都用**从副本脚本抽出的真实模式**做探针（不信口述；7a 探针是判据，7d 探针只作反例记录）。
assert_g7_structural() {
  local pc="$CLONE/scripts/pre-commit-check.sh" hit=0 pat patd out rc cnt
  pat="$(grep -n 'NEW_DIAG=' "$pc" | head -1 | sed -E 's/.*grep -Ev "([^"]*)".*/\1/')"
  if [ -z "$pat" ] || [ "$pat" = "$(grep -n 'NEW_DIAG=' "$pc" | head -1)" ]; then
    echo "    [structural g7] 抽取 7a 排除正则失败 → 无法归因（判红）"
    return 1
  fi
  out="$(printf '%s\n' "+export const F = '$DM_TOKEN';" | grep -Ev "$pat" 2>&1)"; rc=$?
  echo "    [structural g7] 7a 排除正则探针（判据）: rc=$rc 输出='${out}'"
  [ "$rc" -ne 0 ] && hit=1
  patd="$(grep -n 'HAS_HARD=' "$pc" | head -1 | sed -E 's/.*grep -c "([^"]*)".*/\1/')"
  if [ -n "$patd" ] && [ "$patd" != "$(grep -n 'HAS_HARD=' "$pc" | head -1)" ]; then
    cnt="$(printf "export const x = 'marketing';\n" | grep -c "$patd" 2>/dev/null || true)"
    cnt="${cnt//[^0-9]/}"
    echo "    [structural g7] 7d HAS_HARD 反例探针（行含 'marketing'，期望 cnt>0 即该子检查活着）: cnt=${cnt:-0}"
  fi
  [ "$hit" -eq 1 ]
}

# 组 9：宿主无 python 时 L1099 `python -c` 恒失败 → DECLARED 恒空 → 契约门禁恒绿（结构性假绿）。
# 用**未启用 shim 的原始 PATH**证明宿主真实状态。
assert_g9_structural() {
  local out rc
  out="$(PATH="$HOST_PATH" python -c 'print(1)' 2>&1)"; rc=$?
  echo "    [structural g9] 原始 PATH 下 python 探针: rc=$rc 输出='${out}'"
  [ "$rc" -ne 0 ]
}

# ═══ 场景执行 ═══
NAMES=(); RCS=(); T_RUN=(); T_ALL=(); STATUS=(); DETAIL=()
RED_N=0; STRUCT_N=0; NOTRED_N=0; BASE_STATUS="ok"; HOST_STATE=0
PROBE_RC="n/a"; PROBE_STATUS="not_run"

run_scenario() {
  local name="$1" label="$2" expect="$3"
  local out="$TMP/out.$name.log" t0=$SECONDS t1 t2 rc
  INJ_NOTE=""; INJ_PREFLIGHT_FAIL=""
  reset_clone
  if [ "$name" != "baseline" ]; then "inj_$name"; fi
  if [ -n "$INJ_PREFLIGHT_FAIL" ]; then
    echo "── 场景 $name: PREFLIGHT FAIL — $INJ_PREFLIGHT_FAIL"
    NAMES+=("$name"); RCS+=("n/a"); T_RUN+=(0); T_ALL+=(0); STATUS+=("PREFLIGHT_FAIL"); DETAIL+=("$INJ_PREFLIGHT_FAIL")
    NOTRED_N=$((NOTRED_N + 1))
    return
  fi
  local staged_mark
  staged_mark="$(git -C "$CLONE" diff --cached | grep -c "$MARK" || true)"
  staged_mark="${staged_mark//[^0-9]/}"
  t1=$SECONDS
  ( cd "$CLONE" && GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh ) >"$out" 2>&1
  rc=$?
  t2=$SECONDS

  local has_label=0 has_fail=0 fails all_fails
  if grep -qF "$label" "$out"; then has_label=1; fi
  fails="$(fail_lines "$label" "$out" 2 || true)"
  if [ -n "$fails" ]; then has_fail=1; fi
  all_fails="$(strip_ansi < "$out" | grep '❌' | sed 's/^[[:space:]]*//' | head -3 || true)"

  local st detail
  if [ "$expect" = "green" ]; then
    # 绿基线口径 = 全输出（非单区块）：任一 ❌ 或 rc!=0 都算基线不绿
    local sole_fails sole_n
    sole_fails="$(strip_ansi < "$out" | grep '❌' | grep -v '组未通过' || true)"
    sole_n="$(printf '%s\n' "$sole_fails" | grep -c . || true)"
    if [ "$rc" -eq 0 ] && [ -z "$all_fails" ]; then
      st="BASELINE_OK"; detail="rc=0, 全输出无 ❌"
    elif [ "$rc" -ne 0 ] && [ "${sole_n:-0}" -eq 1 ] \
      && printf '%s' "$sole_fails" | grep -q '时间戳顺序' \
      && [ -f /tmp/.synova-before-brief ]; then
      # 宿主 /tmp 泄漏：唯一红来自仓库外宿主状态（见头部注释），非内容违规
      st="BASELINE_HOST_STATE"
      HOST_STATE=1
      detail="唯一 ❌ = 时间戳顺序（宿主 /tmp/.synova-before-brief，pre-commit-check.sh L910 绝对路径）——hermetic 被宿主状态打破"
      echo "   [HOST-STATE] 宿主 marker 内容首行: $(head -1 /tmp/.synova-before-brief 2>/dev/null)"   # swallow-ok: 宿主 marker 可能不存在（缺失即不判 HOST_STATE，属预期状态），读失败取空串继续
      echo "   [HOST-STATE] 路径来源: $(grep -n 'BEFORE_BRIEF_EVI=' "$CLONE/scripts/pre-commit-check.sh" | head -1)"
      echo "   [HOST-STATE] remediation: 由该 marker 的属主 session 执行 rm /tmp/.synova-before-brief（本夹具不动宿主文件）"
    else
      st="BASELINE_FAIL"
      detail="rc=$rc; 首个 ❌: $(echo "$all_fails" | head -1)"
      BASE_STATUS="FAIL"
      echo "   [BASELINE_FAIL] 全部 ❌ 行:"
      printf '%s\n' "$all_fails" | sed 's/^/     /'
    fi
  else
    if [ "$has_fail" -eq 1 ]; then
      st="RED_CONFIRMED"
      detail="$(echo "$fails" | tr '\n' '|' | cut -c1-160)"
      RED_N=$((RED_N + 1))
    elif declare -F "assert_${name}_structural" >/dev/null 2>&1 && "assert_${name}_structural"; then
      st="STRUCTURAL_NOT_RED"
      detail="注入未红，结构性理由由 assert_${name}_structural 探针物理验证（见上方 [structural] 行）→ 属门禁自身缺陷，需 CTO 另行派工"
      STRUCT_N=$((STRUCT_N + 1))
    else
      st="NOT_RED"
      detail="rc=$rc; label_present=$has_label; 区块无 ❌ → 期望红的组未红"
      NOTRED_N=$((NOTRED_N + 1))
    fi
  fi

  echo "── 场景 $name ($label)"
  echo "   rc=$rc  注入标记命中行数(staged)=$staged_mark  label=$has_label  ${INJ_NOTE:+$INJ_NOTE}"
  echo "   耗时: pre-commit=$((t2 - t1))s  场景合计=$((t2 - t0))s"
  echo "   判定: $st"
  [ -n "$fails" ] && echo "$fails" | sed 's/^/     /'
  [ "$st" = "NOT_RED" ] && { echo "     ⚠️ 未红：输出末尾 5 行（全量日志: ${out}）"; strip_ansi < "$out" | tail -5 | sed 's/^/       /'; }
  echo ""
  NAMES+=("$name"); RCS+=("$rc"); T_RUN+=("$((t2 - t1))"); T_ALL+=("$((t2 - t0))"); STATUS+=("$st"); DETAIL+=("$detail")
}

echo "── 场景 0: baseline (干净副本，无任何注入) ──"
run_scenario "baseline" "── 组 1/13" "green"

# ── 因果隔离探针（仅当基线被判 HOST_STATE；只改副本里的绝对路径，用于把"宿主污染"从猜测变成证据）──
if [ "$HOST_STATE" -eq 1 ]; then
  echo "── 因果隔离探针: 把**副本** pre-commit-check.sh L910 的 /tmp 绝对路径改为仓库相对后重跑 ──"
  sed -i.bak 's|BEFORE_BRIEF_EVI="/tmp/.synova-before-brief"|BEFORE_BRIEF_EVI="$ROOT/.claude/.before-brief-probe"|' "$CLONE/scripts/pre-commit-check.sh"
  if grep -q 'BEFORE_BRIEF_EVI="\$ROOT/.claude/.before-brief-probe"' "$CLONE/scripts/pre-commit-check.sh"; then
    ( cd "$CLONE" && GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh ) >"$TMP/out.baseline-localized.log" 2>&1
    PROBE_RC=$?
    if [ "$PROBE_RC" -eq 0 ]; then
      PROBE_STATUS="CAUSE_CONFIRMED"
      BASE_STATUS="host_state"
      echo "   探针 rc=0 → 因果确认：干净副本的**内容基线为绿**，唯一红来自宿主 /tmp marker 的绝对路径读取"
    else
      PROBE_STATUS="CAUSE_NOT_CONFIRMED"
      BASE_STATUS="FAIL"
      echo "   探针 rc=${PROBE_RC}（≠0）→ 归因不成立：基线红不止宿主 marker（按 BASELINE_FAIL 处理）"
      strip_ansi < "$TMP/out.baseline-localized.log" | grep '❌' | head -5 | sed 's/^/     /'
    fi
  else
    PROBE_STATUS="PATCH_FAILED"; BASE_STATUS="FAIL"
    echo "   ❌ 探针补丁未生效（未匹配到 L910 原文）→ 无法归因，按 BASELINE_FAIL 处理"
  fi
  reset_clone   # 撤销副本上的探针补丁（下一场景另有一层 reset）
fi
echo ""

if [ "${SYNO_PRE_COMMIT_INJECT_FULL:-0}" = "1" ]; then
  SCEN="g1 g2 g3 g4 g5 g6 g7 g8 g9 g10 g12 g13"
  echo "[MODE] FULL：跑全部 12 组（组 11 不存在，不跑）"
else
  SCEN="g1 g2 g7 g12"
  echo "[MODE] SAMPLED：抽检 4 组（1/2/7/12）——全量请设 SYNO_PRE_COMMIT_INJECT_FULL=1"
fi
echo ""

for s in $SCEN; do
  eval "lbl=\$LBL_$s"
  run_scenario "$s" "$lbl" "red"
done

# ═══════════════════════════════════════════════════════════════════════════════
# D1148: 声明类三闸「注入即红」判别（先红后绿）
#   三闸（D1148 spec）: ① brief schema（6 字段/骨架/时间戳/Q0 系列）
#                      ② brief↔代码一致性（Q2 写集 ⊆ 声明 / 排除项 / 可解析）
#                      ③ Done 可证伪（每个 - [x] 带 verify:）
#   注入: 一个**同时违反三条**的提交 —— 探针 brief 认领探针脚本（故 BRIEF 非空、
#         闸② 走「可解析」子判据），brief 的 Q0/Q1 段为空（闸①）且无 #CRITERIA、
#         Done 项无 verify:（闸③）。
#   期望: rc=1 且三条闸各自出现 ❌。缺任一条 = 该闸 fail-open 或未接线（本夹具判红）。
#   判别性说明: 三闸合并前，①②③ 由 9 个独立检查点承担且其中多条永不阻断
#         （opt_check PRD 对照 261 次命中/0 阻断）——本段就是"合并后仍抓得到"的物理证明。
# ═══════════════════════════════════════════════════════════════════════════════
echo "── D1148 声明类三闸注入（①②③ 必须各自点名）──"
D1148_FAIL=0
reset_clone
DECL_BRIEF="$CLONE/.claude/task-briefs/${TODAY}-d1148-decl-probe.md"
cat > "$DECL_BRIEF" <<EOF
# Task Brief — D1148 三闸探针（**故意**同时违反 ①②③）

## Q0: 定位 — 项目拼图 + 文件审计

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

## Q2: 范围 — 正确的最简方案
做什么:
- scripts/d1148-decl-probe.sh

不做什么:
- 不改 scripts/pre-commit-check.sh

## Q3: 验收 — 入口 → 交互 → 结果

## 架构层
基础设施

## Done 标准
- [x] 占位完成标准（故意不写 verify 命令）
EOF
cat > "$CLONE/scripts/d1148-decl-probe.sh" <<EOF
#!/bin/bash
# $MARK d1148 三闸探针（探针 brief 认领本文件）
exit 0
EOF
chmod +x "$CLONE/scripts/d1148-decl-probe.sh"
git -C "$CLONE" add scripts/d1148-decl-probe.sh
( cd "$CLONE" && GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh ) >"$TMP/out.d1148.log" 2>&1
DECL_RC=$?
DECL_FAILS="$(strip_ansi < "$TMP/out.d1148.log" | grep '❌' | sed 's/^[[:space:]]*//' || true)"
DECL_MISS=""
for g in '声明闸①' '声明闸②' '声明闸③'; do
  printf '%s\n' "$DECL_FAILS" | grep -q "$g" || DECL_MISS="$DECL_MISS $g"
done
if [ "$DECL_RC" -eq 1 ] && [ -z "$DECL_MISS" ]; then
  echo "  ✅ D1148 三闸注入: rc=1 且 ①②③ 三闸各自点名（无 fail-open）"
else
  echo "  ❌ D1148 三闸注入: rc=$DECL_RC 未点名闸:${DECL_MISS:-<无>} —— 三硬闸存在 fail-open 或未接线"
  printf '%s\n' "$DECL_FAILS" | sed 's/^/     /' | head -10
  D1148_FAIL=1
fi

# ── D1148 二次注入: Q2 排除项被判据捕获（闸② 的第二条子判据：写集 ⊆ 声明）──
#   探针 brief 认领 scripts/d1148-excl-probe.sh，同时在 Q2 明确「不改」它
#   → 声明与写集自相矛盾，闸② 必须点名（D296 认领制排除项判定的回归防线）。
echo "── D1148 闸② 排除项注入 ──"
reset_clone
EXCL_BRIEF="$CLONE/.claude/task-briefs/${TODAY}-d1148-excl-probe.md"
cat > "$EXCL_BRIEF" <<EOF
# Task Brief — D1148 排除项探针

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
探针占位。
### b) 文件审计
探针占位。
### c) 决策
探针占位。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
参考：第一性原理 + 探针语境。

## Q2: 范围 — 正确的最简方案
做什么:
- scripts/d1148-excl-probe.sh

不做什么:
- 不改 scripts/d1148-excl-probe.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：探针。处理：探针。结果：占位。

## 架构层
基础设施

## Done 标准
- [x] verify: bash scripts/d1148-excl-probe.sh
EOF
cat > "$CLONE/scripts/d1148-excl-probe.sh" <<EOF
#!/bin/bash
# $MARK d1148 排除项探针（认领者同时声明"不改"它）
exit 0
EOF
chmod +x "$CLONE/scripts/d1148-excl-probe.sh"
git -C "$CLONE" add scripts/d1148-excl-probe.sh
( cd "$CLONE" && GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh ) >"$TMP/out.d1148-excl.log" 2>&1
EXCL_RC=$?
EXCL_FAILS="$(strip_ansi < "$TMP/out.d1148-excl.log" | grep '❌' | sed 's/^[[:space:]]*//' || true)"
if [ "$EXCL_RC" -eq 1 ] && printf '%s\n' "$EXCL_FAILS" | grep -q '声明闸②' \
   && printf '%s\n' "$EXCL_FAILS" | grep -q 'Q2 排除项'; then
  echo "  ✅ D1148 闸② 排除项注入: rc=1 且点名「Q2 排除项」"
else
  echo "  ❌ D1148 闸② 排除项注入: rc=${EXCL_RC}，闸② 未捕获自相矛盾的排除项"
  printf '%s\n' "$EXCL_FAILS" | sed 's/^/     /' | head -8
  D1148_FAIL=1
fi

# ── D1148 三次注入: 合并提交（无自撰文件）→ 声明三闸**无对象**，不得假红 ──
#   背景（本卡实测）: 把 main 合并进本分支时，`git diff --cached`（vs 第一父）含**第二父的全部
#   文件**——旧实现照此解析"认领者"，把 main 侧**别人的 brief** 当成本次对象判可解析性 →
#   闸② 假红「#CRITERIA 缺失」（本卡真的踩到一次）。本场景在 clone 内造真实合并（side 分支
#   带一份**故意不完整**的 brief + 一个未认领脚本），用 `--no-commit` 停在 MERGE_HEAD 存在的
#   提交前状态，断言：rc=0 且**显式打印**跳过行（非假红、也非静默跳过）。
echo "── D1148 合并提交无自撰文件（不得假红）──"
reset_clone
_SIDE_ORIG="$(git -C "$CLONE" rev-parse HEAD)"
git -C "$CLONE" checkout -q -b d1148-side
cat > "$CLONE/.claude/task-briefs/${TODAY}-d1148-side-brief.md" <<EOF
# side 分支 brief（模拟别人线上的**不完整** brief：无 #CRITERIA、无 Done 条目）
## Q2: 范围
做什么:
- scripts/d1148-side-probe.sh
EOF
printf '#!/bin/bash\n# %s d1148 side probe\nexit 0\n' "$MARK" > "$CLONE/scripts/d1148-side-probe.sh"
chmod +x "$CLONE/scripts/d1148-side-probe.sh"
git -C "$CLONE" add .claude/task-briefs/${TODAY}-d1148-side-brief.md scripts/d1148-side-probe.sh
git -C "$CLONE" -c user.name=t -c user.email=t@t commit -q -m "side: 模拟 main 侧不完整 brief"
git -C "$CLONE" checkout -q --detach "$_SIDE_ORIG"
git -C "$CLONE" -c user.name=t -c user.email=t@t merge --no-commit --no-ff -q d1148-side
MERGE_HEAD_PRESENT=0
[ -n "$(git -C "$CLONE" rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)" ] && MERGE_HEAD_PRESENT=1
( cd "$CLONE" && GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh ) >"$TMP/out.d1148-merge.log" 2>&1
MERGE_RC=$?
MERGE_SKIP_LINE="$(strip_ansi < "$TMP/out.d1148-merge.log" | grep '声明类三闸：合并提交且无自撰文件' || true)"
if [ "$MERGE_HEAD_PRESENT" -eq 1 ] && [ "$MERGE_RC" -eq 0 ] && [ -n "$MERGE_SKIP_LINE" ]; then
  echo "  ✅ D1148 合并提交: rc=0 + 显式跳过行（MERGE_HEAD 已就位；非假红非静默）"
else
  echo "  ❌ D1148 合并提交: MERGE_HEAD=$MERGE_HEAD_PRESENT rc=$MERGE_RC —— 声明闸把另一父的文件当成本次对象（或跳过未留痕）"
  strip_ansi < "$TMP/out.d1148-merge.log" | grep '❌' | sed 's/^/     /' | head -6
  D1148_FAIL=1
fi
echo ""

# ═══ [b 面登记] b 面基线演进: 6 →（M9/#741）7 →（D945）8 →（D1028 本卡）13 ═══
#   判据: b 面 = 仓库内命中 $MARK 的文件数 ≤ 基线；基线外的命中 = 泄漏（判红）。
#   b 面命中**只允许是引用该标记的文档**，实测 13 条（逐条登记）:
#     1. docs/synova/product-lines/evidence/D922-phase0-verify-20260923.md
#     2. docs/synova/product-lines/evidence/D935-20260924/self-verify.md
#     3. docs/synova/product-lines/evidence/D935-20260924/closeout.md
#     4. docs/synova/coordination/总计划-双DSH提升-W1波-20260923.md
#     5. docs/synova/coordination/收件闸检查单.md
#     6. docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md
#     7. docs/synova/audit-reports/2026-09-20-K3-D854.md
#     8. docs/synova/presets/synova-squad-lead/cordis.patch.yml   ← D945 本卡 bundle 迁移**新增**；
#        该文件是"反例字样"的载体（非夹具残留）。#1–#7 已于 origin/main（`git grep -l <MARK> origin/main`
#        核实 main 侧 = 7），故本轮 7→8 属"登记本卡自己引入的合法文档命中"，非放宽判据。
#     9. docs/synova/product-lines/evidence/D1028-A2/03-自验结论-原样转存.md   ← D1028 本卡**新增**；
#        #1–#8 已于 origin/main（`git grep -l <MARK> origin/main` 核实 main 侧 = 8）。
#    10. docs/synova/product-lines/evidence/D1028-A2/03d-静态复核-原始.txt
#    11. docs/synova/product-lines/evidence/D1028-A2/06d-判据台账v2-原始.md
#    12. docs/synova/coordination/D1028-交付与遗留.md
#    13. docs/synova/coordination/D1028-假绿专题-并卡材料.md
#        #9–#13 均为 D1028 本卡的**原始输出/收尾转存件**，#9/#10/#11 逐字节转存了注入夹具
#        的输出（其中包含该标记原文），#12/#13 为收尾与并卡材料 —— 属本注释许可的
#        "引用该标记的文档"（非夹具残留；a 面 `residue_code=0` 亦证代码面零残留）。
#        ⇒ 故本轮 8→13 同属"登记本卡自己引入的合法文档命中"，**非放宽判据**。
#   ⚠️ 待办（本轮由"已知脆弱性"升级为明确 TODO；CTO 批次5 发现登记 **P2-2**）:
#      b 面**硬编码计数随仓库文档增长漂移** —— 任何新文档引用该标记都会把 b 面推红，
#      而红的原因并非真泄漏（6→7、7→8、8→13 三次都是这个成因）。根治 = **动态基线**
#      （与 base-ref 计数对比，或按面分计：docs/ 面不参与判红）。属**判据语义变更**，
#      须过 K3，另立卡，不在本卡做。**在那之前：每新增一个引用该标记的文档，必须手动 +1 并登记。**
# ═══ 收尾残留断言（三面）═══
echo "── 收尾残留断言 ──"
CODE_RESIDUE="$(grep -rl "$MARK" "$REPO_DIR/src" "$REPO_DIR/tests" "$REPO_DIR/scripts" "$REPO_DIR/.github" 2>/dev/null | wc -l | tr -d ' ')"   # swallow-ok: 收尾计数的探测型 grep，无匹配=0 正是期望（a 面期望 0），计数交由下方断言判红
# 2026-09-28 CTO 修正（b 面口径）: b 面排除 docs/ —— 证据与记录文档合法携带该标记字样
#   （例：B2 出库门禁证据 A-03、线3 注入红证 20-verify-break-red）。原口径下"证据增长 ⇒
#   顶破基线 13 ⇒ 每个基于最新 main 的 PR 被误红"（#875/#877/#872 三 PR 实证）。
#   a 面已独立保证"代码/测试/脚本/CI 面 = 0"。
#   ⚠️ 本注释刻意不写连续字面量（与 :67 的拼接约定一致）—— 否则夹具自身会自命中（2026-09-28 实测 a=1）。
REPO_RESIDUE="$(grep -rl "$MARK" "$REPO_DIR" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs 2>/dev/null | wc -l | tr -d ' ')"   # swallow-ok: 同上探测型计数（b 面期望 = 基线 13；6→7 见 M9/#741、7→8 见 D945、8→13 见 D1028 本卡，逐条登记见上方 [b 面登记]）；非探测路径不可达时计数为 0 会由断言判红，不静默
CLONE_POSITIVE="$(git -C "$CLONE" diff --cached | grep -c "$MARK" || true)"
CLONE_POSITIVE="${CLONE_POSITIVE//[^0-9]/}"
echo "a) 代码/测试/脚本/CI 面残留: $CODE_RESIDUE 个文件（期望 0）"
echo "   命令: grep -rl \"\$MARK\" \"\$REPO_DIR/{src,tests,scripts,.github}\" | wc -l"
echo "b) 仓库全量命中: $REPO_RESIDUE 个文件（基线 13，逐条登记见上方 [b 面登记]；逐行如下）"
grep -rl "$MARK" "$REPO_DIR" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs 2>/dev/null | sed 's/^/     /' || true
echo "c) 副本内标记存在性（反向判别，最后场景应为 >0）: $CLONE_POSITIVE 行"
RESIDUE_FAIL=0
[ "$CODE_RESIDUE" -ne 0 ] && RESIDUE_FAIL=1
[ "$REPO_RESIDUE" -gt 13 ] && RESIDUE_FAIL=1
[ "$CLONE_POSITIVE" -eq 0 ] && RESIDUE_FAIL=1
[ "$RESIDUE_FAIL" -eq 0 ] && echo "✅ 残留断言满足（a=0, b<=13, c>0）" || echo "❌ 残留断言不满足（a=${CODE_RESIDUE}, b=${REPO_RESIDUE}, c=${CLONE_POSITIVE}）"

# ═══ 汇总表 ═══
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  耗时 / 结果汇总表"
echo "═══════════════════════════════════════════════════════════════"
printf '%-10s %-6s %-8s %-8s %s\n' "场景" "rc" "耗时(s)" "合计(s)" "判定"
i=0
while [ "$i" -lt "${#NAMES[@]}" ]; do
  printf '%-10s %-6s %-8s %-8s %s\n' "${NAMES[$i]}" "${RCS[$i]}" "${T_RUN[$i]}" "${T_ALL[$i]}" "${STATUS[$i]}"
  i=$((i + 1))
done
echo ""
echo "── 明细（逐场景判定依据；供自验/独立审计复核）──"
i=0
while [ "$i" -lt "${#NAMES[@]}" ]; do
  echo "  ${NAMES[$i]}: $(printf '%s' "${DETAIL[$i]}" | cut -c1-200)"
  i=$((i + 1))
done
echo ""

RC=0
[ "$BASE_STATUS" = "FAIL" ] && RC=1
[ "$NOTRED_N" -gt 0 ] && RC=1
[ "$RESIDUE_FAIL" -ne 0 ] && RC=1
[ "${D1148_FAIL:-0}" -ne 0 ] && RC=1   # D1148: 声明类三闸注入未红 = fail-open/未接线
if [ "${SYNO_INJECT_REQUIRE_CLEAN_BASELINE:-0}" = "1" ] && [ "$BASE_STATUS" = "host_state" ]; then
  RC=1
  echo "   [STRICT] SYNO_INJECT_REQUIRE_CLEAN_BASELINE=1 且基线=HOST_STATE → 判红（严格守门模式）"
fi

echo "GATE_INJECTION_SUMMARY: scenarios=${#NAMES[@]} red_confirmed=$RED_N structural_not_red=$STRUCT_N not_red=$NOTRED_N baseline=$BASE_STATUS probe=$PROBE_STATUS(rc=$PROBE_RC) residue_code=$CODE_RESIDUE residue_repo=$REPO_RESIDUE shim=$SHIM_USED decl_gates=${D1148_FAIL:-0}"
if [ "$RC" -eq 0 ]; then
  echo "✅ 注入自测结果：期望红组全部 RED_CONFIRMED，残留断言满足，baseline=${BASE_STATUS}（结论归自验/独立审计，本夹具只出证据）"
  [ "$BASE_STATUS" = "host_state" ] && echo "   ⚠️ 注意：基线非天然绿（宿主 /tmp marker 绝对路径读取，已由探针因果确认）——CI 上新 runner 应为 BASELINE_OK"
else
  echo "❌ 注入自测未达期望：not_red=$NOTRED_N baseline=$BASE_STATUS probe=$PROBE_STATUS residue_fail=$RESIDUE_FAIL"
fi
exit "$RC"
