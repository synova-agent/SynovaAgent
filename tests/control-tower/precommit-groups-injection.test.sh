#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# precommit-groups-injection.test.sh — pre-commit 各组「违规注入必红」判别性夹具
#   M9 控制塔门禁三件套 / task-6（m9-coder-b 写集）。K3 批次2 §五 #1 要求：
#   证明各组不是 fail-open（"接线了"≠"被执行"——要有"注入即报红"的判别证据）。
#
# ═══ 契约（铁律 47）═══
#   @input  — 无参数。被测对象 = 本仓库 HEAD 的 scripts/pre-commit-check.sh。
#             环境开关: SYNO_PRE_COMMIT_INJECT_FULL=1 → 跑全部 12 组 + 3 条 D1023 反例；
#                       缺省（CI 与人工默认）→ 抽检 4 组（组 1/2/7/12）+ 3 条 D1023 反例 + 1 绿基线；
#                       SYNO_INJECT_REQUIRE_CLEAN_BASELINE=1 → 基线 HOST_STATE 也判红（严格守门）。
#   @output — 逐组结果行 + 耗时汇总表 + 收尾残留断言 + 末行机器可读汇总:
#             GATE_INJECTION_SUMMARY: scenarios=<n> red_confirmed=<n> structural_not_red=<n>
#                                     not_red=<n> green_confirmed=<n> green_fail=<n> g10region_named=<0|1>
#                                     baseline=<ok|host_state|FAIL> probe=<状态>(rc=<n>)
#                                     exempt_probe=<状态>(rc=<n>)
#                                     residue_code=<n> residue_repo=<n> shim=<0|1>
#   @exit   — 0 = 全部期望红组均 RED_CONFIRMED（structural_not_red 须带**已验证**的结构性理由），
#                且绿基线 rc=0（或 baseline=host_state 且有因果隔离探针证据），
#                且期望绿场景（g10exempt）GREEN_CONFIRMED 且判别性探针 RED_CONFIRMED，且残留断言过；
#             1 = 任一期望红组未红 / 期望绿场景未绿 / 判别性探针未红 / 基线不绿且不可归因 / 残留断言失败（业务失败）；
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
# ═══ D1023 A3补修新增（本批判据；抽检与全量都跑）═══
#   g10exempt 组 10/13 暂存 **domain-neutral 路径文件**（.claude/bypass.log，已跟踪）+ brief 声明条件区域 D
#                     → 期望**绿**（GREEN_CONFIRMED）: 组 10 区块无 ❌，且出现
#                       `条件区域检查通过 (D; domain-neutral 豁免 N 项)`（N>0）—— 只"没红"不算过：
#                       若 brief/CRITERIA 没被读到、或映射解析降级，G10 走"跳过/降级"分支（另一种假绿）。
#                     → 判别性探针（删掉即报红）: 在副本里物理删除 pre-commit-check.sh 的
#                       `D1023-DOMNEUTRAL-EXEMPT-BEGIN..END` 区间（仅豁免分支；删后 bash -n 仍 rc=0，
#                       已实测），重跑**同一注入** ⇒ 组 10 区块必须出现 ❌（exempt_probe=RED_CONFIRMED）。
#                       探针补丁未生效/删后语法坏/删后仍未红 ⇒ 判红（fail-closed）。
#                       ——证明绿来自豁免分支本身，而非整条 G10 被判据放宽（禁 grep 型静态判据当验收）。
#   g10region 组 10/13 暂存**区域外真代码** observer-adapters/claude-code-hook/hook.py（真实在库、
#                       58 行；实测 A/B/C/D 四区全零命中，见下方 [区域实测]）+ brief 声明条件区域 D
#                       → 期望**红**，且 ❌ 行必须**点名**该文件（只"红了"不够——红了但没点名 =
#                       可能因其它原因红，判别性不足）。同理可用的第二个探针:
#                       prototypes/l4-research/graph-bridge.ts（307 行，四区零命中）。
#   g10tests  组 10/13 暂存 **tests/** 下的文件（本夹具自身路径）+ brief 声明条件区域 D
#                       → 期望**绿**（⑥ 的回归锁）: tests/** 是 D.glob 新增项（CTO 2026-09-27 裁定）。
#                       ⑥ 之前 tests/** 不在任何区域 ⇒ 本夹具自身进 PR 变更集必让该 PR 红。
#   [区域实测] 用脚本真实 sed 管线回放 .codex/criteria-code-map.json（2026-09-27，本卡 base ad2cce20 + ⑥）:
#     A: src/l3/(.*/)?.*.ts|src/agent/diagnosis-launcher.ts|src/sentinel/(.*/)?.*.ts
#     B: src/growth/(.*/)?.*.ts|src/loops/(.*/)?.*.ts|extensions/ontology/edge-types/.*.json
#     C: src/routes/(.*/)?.*.ts|src/middleware/(.*/)?.*.ts|app/(.*/)?.*.(html|js|css)|electron/(.*/)?.*.(cjs|js)
#     D: src/(.*/)?.*.ts|scripts/(.*/)?.*.(sh|py)|tests/.*.*|package.json|build-synova.cjs   ← ⑥ 后
#     四区零命中（实测）: observer-adapters/claude-code-hook/hook.py、prototypes/l4-research/graph-bridge.ts
#     ⑥ 前 tests/** 亦四区零命中（tests/control-tower/x.test.sh、tests/foo/y.test.ts、tests/a.ts 实测）；
#     ⑥ 后三者均落 D（tests/.*.*）。
#   ⚠️ 前置依赖（如实声明，非静默假设）: 三个 G10 场景要求条件区域映射**可解析**（python3/python/py 之一可用）。
#      本机无 `python`（只有 python3）时，pre-commit G10 走 :1189-1223 的**显式降级**路径（⚠️ + degraded 登记，
#      不打绿勾），此环境下 g10exempt/g10tests 会判 GREEN_FAIL（缺 pass 行）⇒ 夹具 exit 1。
#      CI 上本夹具所在 job `gate-integrity` 跑 ubuntu-latest（ci.yml:568，非 windows 矩阵）→ 有 python3 ⇒ 前置满足。
#
#   用法: bash tests/control-tower/precommit-groups-injection.test.sh
#         SYNO_PRE_COMMIT_INJECT_FULL=1 bash tests/control-tower/precommit-groups-injection.test.sh
#   CI:   .github/workflows/ci.yml job `gate-integrity` step 2（抽检即注册；抽检已含 g10exempt/g10region/g10tests）
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
echo "MODE       = $([ "${SYNO_PRE_COMMIT_INJECT_FULL:-0}" = "1" ] && echo FULL-12-组+3反例 || echo SAMPLED-抽检-4-组+3反例)"
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
# D1023 反例场景与组 10 同区块（G10+G11 都在「组 10/13」块内）
LBL_g10exempt="$LBL_g10"
LBL_g10region="$LBL_g10"
LBL_g10tests="$LBL_g10"

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

# ── D1023 A3补修反例（本批判据；抽检与全量都跑）──
# 场景 a: domain-neutral 路径文件 + brief 声明条件区域 D ⇒ 期望**绿**（豁免生效）。
#   用 .claude/bypass.log —— **已跟踪**（`git ls-files .claude/bypass.log` 实测；
#   gate-hits.log 被 .gitignore 忽略，`git add` 进不了暂存区，不能作注入对象）。
#   brief 文本**不得**含「端到端/e2e/curl.*200/HTTP.*200」——组 10 区块同时含 G10+G11，
#   若 G11 因"有验收无测试"在同一区块报 ❌，会把本场景的判定搅红（非本场景要判的东西）。
inj_g10exempt() {
  printf '# %s g10exempt (domain-neutral 路径修改: 应由豁免分支跳过)\n' "$MARK" >> "$CLONE/.claude/bypass.log"
  # ⚠️ 实测陷阱（本夹具首轮自己踩中，见下）: 夹具 brief 的标题里**不能**再出现 `#CRITERIA:D` 字样 ——
  #   G10 用 `grep -oE '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]'` 抽取，抽到 **多行** 时
  #   `python -c "... m.get('$CRITERIA') ..."` 插值成跨行单引号字符串 → SyntaxError → `2>/dev/null || true`
  #   吞掉 → CRITERIA_GLOBS 空 → G10 走「无映射区域(跳过)」= **第三种假绿**（另两种：无 brief / 无 #CRITERIA）。
  #   首轮实测证据: 标题带 `#CRITERIA:D` + 正文 `#CRITERIA: D` ⇒ CRITERIA='D\nD' ⇒ 场景 a 判 GREEN_FAIL
  #   （pass 行='<无>'）、场景 b 判 NOT_RED（该红的没红）。故本夹具三个 brief 各自**只保留一处**该标记。
  #   （G10 侧已按 CTO 裁定⑦加 `head -1` 作纵深防护；夹具仍按"只留一处"写，避免依赖单一防线。）
  cat > "$CLONE/.claude/task-briefs/${TODAY}-m9-fixture-g10exempt-dm.md" <<EOF
# Task Brief — 夹具场景 G10exempt（domain-neutral 路径文件，期望豁免生效）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
夹具占位：domain-neutral 路径（ownership.yaml:207）不参与条件区域判定（pre-commit 组 10）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
参考：第一性原理 + 注入即验证（本夹具语境，无外部最佳实践可引）。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- .claude/bypass.log — 夹具注入的 domain-neutral 路径修改（豁免对象）

不做什么（含文件路径）：
- 不改 scripts/pre-commit-check.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：git commit（pre-commit 组 10）
处理：G10 取 brief 声明的条件区域 D，domain-neutral 路径走豁免分支
结果：组 10 区块无 ❌ 且打印豁免点名行

## 架构层
N/A（治理层夹具，不触五层依赖）

## Done 标准
- [x] domain-neutral 路径不计入条件区域不匹配（verify: 组 10 区块出现豁免点名行）
EOF
  git -C "$CLONE" add .claude/bypass.log ".claude/task-briefs/${TODAY}-m9-fixture-g10exempt-dm.md"
}

# 场景 b（核心）: **区域外真代码** + brief 声明条件区域 D ⇒ 期望**红且点名该文件**。
#   证明修的是「domain-neutral 路径豁免」而不是「放宽整条闸」——若 G10 因本卡改动而整体放宽，本场景不会红。
#   探针取**真实在库**文件（派单件原举的 src/legacy/foo.js / tools/deploy.py 实测不存在，已弃用）：
#   修改其一行即进暂存集。路径实测 A/B/C/D 四区**零命中**（见头部 [区域实测]，脚本真实 sed 管线回放判定）。
G10REGION_FILE="observer-adapters/claude-code-hook/hook.py"   # 实测存在且 tracked，58 行
inj_g10region() {
  printf '\n# %s g10region (区域外真代码: 不在 A/B/C/D 任一区域)\n' "$MARK" >> "$CLONE/$G10REGION_FILE"
  cat > "$CLONE/.claude/task-briefs/${TODAY}-m9-fixture-g10region-outside.md" <<EOF
# Task Brief — 夹具场景 G10region（区域外真代码，期望仍红）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
夹具占位：条件区域外文件必须仍被判红。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
参考：第一性原理 + 注入即验证（本夹具语境，无外部最佳实践可引）。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- $G10REGION_FILE — 夹具修改的区域外真代码（不属 A/B/C/D 任一区域）

不做什么（含文件路径）：
- 不改 scripts/pre-commit-check.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：git commit（pre-commit 组 10）
处理：G10 取 brief 声明的条件区域 D，逐文件比对映射区域
结果：组 10 区块报 ❌ 并点名 $G10REGION_FILE

## 架构层
N/A（治理层夹具，不触五层依赖）

## Done 标准
- [x] 区域外文件被点名报红（verify: 组 10 区块 ❌ 明细含 $G10REGION_FILE）
EOF
  git -C "$CLONE" add "$G10REGION_FILE" ".claude/task-briefs/${TODAY}-m9-fixture-g10region-outside.md"
}

# 场景 c（⑥ 回归锁）: 暂存 **tests/** 下的文件 + brief 声明条件区域 D ⇒ 期望**绿**。
#   ⑥（CTO 2026-09-27 裁定）把 `tests/**` 补进 D.glob 之前，tests/** 不在 A/B/C/D 任一区域
#   ⇒ 本夹具自身进某 PR 变更集时，该 PR 的 G10 会因本文件报红（本 PR 实测）。本场景把该结论锁进 CI。
#   注入对象 = 本夹具**自身路径**（最贴近真实场景：本卡第④件正是改这个文件）。
G10TESTS_FILE="tests/control-tower/precommit-groups-injection.test.sh"
inj_g10tests() {
  printf '\n# %s g10tests (tests/** 区域覆盖回归锁)\n' "$MARK" >> "$CLONE/$G10TESTS_FILE"
  cat > "$CLONE/.claude/task-briefs/${TODAY}-m9-fixture-g10tests-covered.md" <<EOF
# Task Brief — 夹具场景 G10tests（tests/** 落 D 区，期望绿）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
夹具占位：tests/** 必须落在条件区域 D（⑥ 回归锁）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
参考：第一性原理 + 判据数据须与自身描述自洽（D.description「所有源文件(兜底)」）。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- $G10TESTS_FILE — 夹具修改的 tests/** 文件（须落 D 区）

不做什么（含文件路径）：
- 不改 scripts/pre-commit-check.sh

## Q3: 验收 — 入口 → 交互 → 结果
入口：git commit（pre-commit 组 10）
处理：G10 取 brief 声明的条件区域 D，逐文件比对映射区域
结果：组 10 区块无 ❌（tests/** 落 D）
EOF
  git -C "$CLONE" add "$G10TESTS_FILE" ".claude/task-briefs/${TODAY}-m9-fixture-g10tests-covered.md"
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
# 组 10 结构性理由：G10/G11 是否**结构性不可达**（不可达时不得判 NOT_RED 了事）。
# A3 补修（D1023, 2026-09-27）——**探针对象同步**:
#   旧探针以 CHANGED_FILES/STAGED_FILES 为对象（A3 前这两个变量零赋值 ⇒ "使用存在但从未定义"
#   ⇒ 归因成立）。A3 已把真变量改为 STAGED_ALL，旧对象**已陈旧**：其"定义=0 且使用>0"判定
#   在 A3 后不再对应任何真实变量，若继续沿用 = 给 NOT_RED 发一张"结构性不可达"的假豁免证
#   （误授 STRUCTURAL_NOT_RED 的地雷）。现按真变量重写，判据两条（任一成立才算结构性不可达）:
#     (a) G10 区块引用了 $STAGED_ALL，但全脚本从未定义它（使用存在而定义缺失 → 恒空 → 恒走 soft_pass）
#     (b) G10 区块**零引用**变更集变量（该段不读任何暂存文件 → 无论内容如何都恒绿）
#   两条都用**副本脚本的真实文本**做探针；抽取/计数失败一律返回 1（宁可判 NOT_RED，不得口头豁免）。
assert_g10_structural() {
  local pc="$CLONE/scripts/pre-commit-check.sh"
  local defs usages
  # 定义数：`STAGED_ALL=` / `export STAGED_ALL=` 一律算定义（真实变量，A3 落地于 :313）
  defs="$(grep -cE '(^|[[:space:]])(export[[:space:]]+)?STAGED_ALL=[^=]' "$pc" 2>/dev/null || true)"
  # G10 区块（组 10/13 行 → 组 12/13 行）内对 $STAGED_ALL / ${STAGED_ALL} 的引用数
  usages="$(awk '
    f && index($0, "── 组 12/13") { exit }
    index($0, "── 组 10/13") { f = 1 }
    f
  ' "$pc" | grep -cE '\$\{?STAGED_ALL\}?' || true)"
  defs="${defs//[^0-9]/}"; usages="${usages//[^0-9]/}"
  echo "    [structural g10] 真变量 STAGED_ALL: 全脚本定义 ${defs:-0} 处 / 组 10 区块引用 ${usages:-0} 处"
  if [ "${defs:-0}" -eq 0 ] && [ "${usages:-0}" -gt 0 ]; then
    return 0   # (a) 使用存在但从未定义 → 变更集恒空 → G10/G11 判定恒走 soft_pass
  fi
  if [ "${usages:-0}" -eq 0 ]; then
    return 0   # (b) G10 区块不读变更集 → 结构性不可达
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
# D1023: 期望绿场景（g10exempt）计数器 + 判别性探针触发位
GREEN_N=0; GREENFAIL_N=0; EXEMPT_GREEN=0
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
  elif [ "$expect" = "green_g10" ]; then
    # D1023 场景 a 专用口径: 只判「组 10/13」区块（G10+G11 同区块），且必须看到**判定真的跑了**的证据。
    #   仅"区块无 ❌"不够 —— 无 brief / 无 #CRITERIA / 无映射区域 三条跳过路径同样是"没红"（另一种假绿）。
    #   三条件齐备才认绿: (i) 区块无 ❌ (ii) 出现 `条件区域检查通过 (D` (iii) 豁免计数 N>0（豁免确实生效）。
    local g10_pass g10_exempt_n g10_exempt_lines
    g10_pass="$(block_of "$label" "$out" | strip_ansi | grep -F '条件区域检查通过' | head -1 | sed 's/^[[:space:]]*//' || true)"
    g10_exempt_n="$(block_of "$label" "$out" | strip_ansi | grep -oE 'domain-neutral 豁免 [0-9]+ 项' | head -1 | grep -oE '[0-9]+' || true)"
    g10_exempt_n="${g10_exempt_n//[^0-9]/}"
    g10_exempt_lines="$(block_of "$label" "$out" | strip_ansi | grep -cF 'domain-neutral 路径豁免' || true)"
    g10_exempt_lines="${g10_exempt_lines//[^0-9]/}"
    if [ -z "$fails" ] && printf '%s' "$g10_pass" | grep -qF '条件区域检查通过 (D' && [ "${g10_exempt_n:-0}" -gt 0 ]; then
      st="GREEN_CONFIRMED"
      GREEN_N=$((GREEN_N + 1))
      EXEMPT_GREEN=1
      detail="组 10 区块无 ❌; ${g10_pass}; 豁免点名行=${g10_exempt_lines:-0}"
    else
      st="GREEN_FAIL"
      GREENFAIL_N=$((GREENFAIL_N + 1))
      detail="rc=$rc; 区块 ❌='${fails:-<无>}'; pass 行='${g10_pass:-<无>}'; 豁免计数='${g10_exempt_n:-<无>}'"
      echo "   [GREEN_FAIL] 组 10 区块原文（末 12 行）:"
      block_of "$label" "$out" | strip_ansi | tail -12 | sed 's/^/     /'
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

# 期望口径分配（单一事实源）: green_g10 = 只判「组 10/13」区块且必须看到"判定真跑了"的证据；
#   其余 = 期望该组区块出现 ❌。SCEN 与 RC 判据都从这里取，避免两处漂移。
expect_for() {
  case "$1" in
    g10exempt|g10tests) echo "green_g10" ;;
    *) echo "red" ;;
  esac
}

if [ "${SYNO_PRE_COMMIT_INJECT_FULL:-0}" = "1" ]; then
  SCEN="g1 g2 g3 g4 g5 g6 g7 g8 g9 g10 g12 g13 g10exempt g10region g10tests"
  echo "[MODE] FULL：跑全部 12 组 + 3 条 D1023 反例（组 11 不存在，不跑）"
else
  SCEN="g1 g2 g7 g12 g10exempt g10region g10tests"
  echo "[MODE] SAMPLED：抽检 4 组（1/2/7/12）+ 3 条 D1023 反例（g10exempt/g10region/g10tests）——全量请设 SYNO_PRE_COMMIT_INJECT_FULL=1"
fi
# 期望绿场景数（RC 判据用它，避免"SCEN 被改坏后判据消失"）
GREEN_EXPECTED=0
for _s in $SCEN; do [ "$(expect_for "$_s")" = "green_g10" ] && GREEN_EXPECTED=$((GREEN_EXPECTED + 1)); done
echo "[D1023] 本模式期望: 红场景 $(($(echo $SCEN | wc -w | tr -d ' ') - GREEN_EXPECTED)) / 绿场景 ${GREEN_EXPECTED}"
echo ""

for s in $SCEN; do
  eval "lbl=\$LBL_$s"
  run_scenario "$s" "$lbl" "$(expect_for "$s")"
done

# ═══ 判别性探针（场景 g10exempt 专用）: 删掉豁免分支 ⇒ 同一注入必须转红 ═══
#   这不是 grep 型静态判据: 探针在副本里**物理删除** pre-commit-check.sh 的
#   D1023-DOMNEUTRAL-EXEMPT-BEGIN..END 区间（只含"domain-neutral 路径 → continue"那一段；删后 bash -n 仍 rc=0，
#   已实测），然后重跑**完全相同的注入**。期望: 组 10 区块出现 ❌（原本绿的同一个注入转红）。
#   fail-closed 三关（任一不过即判红）: 补丁未生效 / 删后语法坏 / 删后仍未红。
PROBE2_RC="n/a"; PROBE2_STATUS="not_run"; EXEMPT_PROBE_OK=0
if [ "$EXEMPT_GREEN" -eq 1 ]; then
  echo "── 判别性探针: 删掉副本内 D1023-DOMNEUTRAL-EXEMPT 区间后重跑场景 g10exempt 同一注入 ──"
  reset_clone
  inj_g10exempt
  sed -i.bak '/D1023-DOMNEUTRAL-EXEMPT-BEGIN/,/D1023-DOMNEUTRAL-EXEMPT-END/d' "$CLONE/scripts/pre-commit-check.sh"
  if grep -qF 'domain-neutral 路径豁免，不参与条件区域判定' "$CLONE/scripts/pre-commit-check.sh"; then
    PROBE2_STATUS="PATCH_FAILED"
    echo "   ❌ 探针补丁未生效（豁免分支语句仍在副本里，区间哨兵或被改）→ 无法证明判别力，判红"
  elif ! bash -n "$CLONE/scripts/pre-commit-check.sh"; then
    PROBE2_STATUS="PATCH_BROKE_SYNTAX"
    echo "   ❌ 删除区间后副本 pre-commit-check.sh 语法坏（bash -n 非 0）→ 探针无效，判红"
  else
    ( cd "$CLONE" && GITHUB_ACTIONS=true SYNO_CI=1 bash scripts/pre-commit-check.sh ) >"$TMP/out.g10exempt.nobranch.log" 2>&1
    PROBE2_RC=$?
    PROBE2_FAILS="$(fail_lines "$LBL_g10exempt" "$TMP/out.g10exempt.nobranch.log" 2 || true)"
    if [ -n "$PROBE2_FAILS" ]; then
      PROBE2_STATUS="RED_CONFIRMED"; EXEMPT_PROBE_OK=1
      echo "   同一注入在删掉豁免分支后转红（判别力确认，rc=$PROBE2_RC）:"
      printf '%s\n' "$PROBE2_FAILS" | sed 's/^/     /'
    else
      PROBE2_STATUS="NOT_RED"
      echo "   ❌ 删掉豁免分支后组 10 区块仍未红（rc=$PROBE2_RC）→ 场景 a 的绿不是该分支造成的，判红"
      strip_ansi < "$TMP/out.g10exempt.nobranch.log" | grep -F 'domain-neutral' | head -3 | sed 's/^/     /' || true  # swallow-ok: 诊断型探测（无命中即无输出），判定已由上方 NOT_RED 分支给出
    fi
  fi
  # 刻意**不** reset_clone: 收尾残留断言的 c) 面要求副本内仍有标记暂存，本探针的注入正好满足
  echo ""
fi

# ═══ 场景 g10region 的"点名"断言（b 的核心口径: 红了还不够，必须点名那个区域外文件）═══
#   只判"区块有 ❌"不足以证明判别力 —— ❌ 可能来自别的文件（如夹具 brief 自己）或被别的规则命中。
#   这里直接读该场景日志，要求 ❌ 明细里出现 `<被注入的区域外路径> (不在条件 D` 这一条。
G10REGION_NAMED=0
if [ -f "$TMP/out.g10region.log" ]; then
  if block_of "$LBL_g10region" "$TMP/out.g10region.log" | strip_ansi | grep -qF "$G10REGION_FILE (不在条件 D"; then
    G10REGION_NAMED=1
  fi
fi
if [ "$G10REGION_NAMED" -eq 1 ]; then
  echo "[D1023] g10region 点名确认: ❌ 明细含 '$G10REGION_FILE (不在条件 D'"
else
  echo "[D1023] ❌ g10region 未点名 $G10REGION_FILE → 判别性不足，判红"
fi
echo ""
# ═══ [b 面登记] b 面基线演进: 6 →（M9/#741）7 →（D945 本卡）8 ═══
#   判据: b 面 = 仓库内命中 $MARK 的文件数 ≤ 基线；基线外的命中 = 泄漏（判红）。
#   b 面命中**只允许是引用该标记的文档**，实测 8 条（逐条登记）:
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
#   ⚠️ 待办（本轮由"已知脆弱性"升级为明确 TODO；CTO 批次5 发现登记 **P2-2**）:
#      b 面**硬编码计数随仓库文档增长漂移** —— 任何新文档引用该标记都会把 b 面推红，
#      而红的原因并非真泄漏（本轮 6→7、7→8 两次都是这个成因）。根治 = **动态基线**
#      （与 base-ref 计数对比，或按面分计：docs/ 面不参与判红）。属**判据语义变更**，
#      须过 K3，另立卡，不在本卡做。**在那之前：每新增一个引用该标记的文档，必须手动 +1 并登记。**
# ═══ 收尾残留断言（三面）═══
echo "── 收尾残留断言 ──"
CODE_RESIDUE="$(grep -rl "$MARK" "$REPO_DIR/src" "$REPO_DIR/tests" "$REPO_DIR/scripts" "$REPO_DIR/.github" 2>/dev/null | wc -l | tr -d ' ')"   # swallow-ok: 收尾计数的探测型 grep，无匹配=0 正是期望（a 面期望 0），计数交由下方断言判红
REPO_RESIDUE="$(grep -rl "$MARK" "$REPO_DIR" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | wc -l | tr -d ' ')"   # swallow-ok: 同上探测型计数（b 面期望 = 基线 8；6→7 见 M9/#741、7→8 见 D945 本卡，逐条登记见上方 [b 面登记]）；非探测路径不可达时计数为 0 会由断言判红，不静默
CLONE_POSITIVE="$(git -C "$CLONE" diff --cached | grep -c "$MARK" || true)"
CLONE_POSITIVE="${CLONE_POSITIVE//[^0-9]/}"
echo "a) 代码/测试/脚本/CI 面残留: $CODE_RESIDUE 个文件（期望 0）"
echo "   命令: grep -rl \"\$MARK\" \"\$REPO_DIR/{src,tests,scripts,.github}\" | wc -l"
echo "b) 仓库全量命中: $REPO_RESIDUE 个文件（基线 8，逐条登记见上方 [b 面登记]；逐行如下）"
grep -rl "$MARK" "$REPO_DIR" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | sed 's/^/     /' || true
echo "c) 副本内标记存在性（反向判别，最后场景应为 >0）: $CLONE_POSITIVE 行"
RESIDUE_FAIL=0
[ "$CODE_RESIDUE" -ne 0 ] && RESIDUE_FAIL=1
[ "$REPO_RESIDUE" -gt 8 ] && RESIDUE_FAIL=1
[ "$CLONE_POSITIVE" -eq 0 ] && RESIDUE_FAIL=1
[ "$RESIDUE_FAIL" -eq 0 ] && echo "✅ 残留断言满足（a=0, b<=8, c>0）" || echo "❌ 残留断言不满足（a=${CODE_RESIDUE}, b=${REPO_RESIDUE}, c=${CLONE_POSITIVE}）"

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
# D1023: 场景 a 必须**跑到且绿**（SCEN 清单被改坏/被跳过 = 判据消失 → fail-closed 判红），
#        且其判别性探针必须 RED_CONFIRMED（绿必须来自豁免分支本身）。
# D1023: 期望绿场景必须**跑到且全绿**（SCEN 清单被改坏/被跳过 = 判据消失 → fail-closed 判红），
#        且计数必须等于 expect_for 推出的期望数；判别性探针必须 RED_CONFIRMED（绿必须来自豁免分支本身）。
[ "$GREEN_N" -eq 0 ] && { RC=1; echo "   [D1023] 无任何 GREEN_CONFIRMED 场景 → 判红（判别判据缺失）"; }
[ "$GREEN_N" -ne "$GREEN_EXPECTED" ] && { RC=1; echo "   [D1023] 期望绿场景数 ${GREEN_EXPECTED} ≠ 实际 GREEN_CONFIRMED ${GREEN_N} → 判红"; }
[ "$GREENFAIL_N" -gt 0 ] && RC=1
[ "$EXEMPT_PROBE_OK" -ne 1 ] && { RC=1; echo "   [D1023] 判别性探针未确认（exempt_probe=$PROBE2_STATUS rc=$PROBE2_RC）→ 判红（无「删掉即报红」的判别力）"; }
[ "$G10REGION_NAMED" -ne 1 ] && RC=1   # b 场景必须点名那个区域外文件（信息已在上方打印）
[ "$G10REGION_FILE" = "" ] && { RC=1; echo "   [D1023] G10REGION_FILE 为空 → b 场景注入对象丢失，判红"; }
if [ "${SYNO_INJECT_REQUIRE_CLEAN_BASELINE:-0}" = "1" ] && [ "$BASE_STATUS" = "host_state" ]; then
  RC=1
  echo "   [STRICT] SYNO_INJECT_REQUIRE_CLEAN_BASELINE=1 且基线=HOST_STATE → 判红（严格守门模式）"
fi

echo "GATE_INJECTION_SUMMARY: scenarios=${#NAMES[@]} red_confirmed=$RED_N structural_not_red=$STRUCT_N not_red=$NOTRED_N green_confirmed=$GREEN_N green_fail=$GREENFAIL_N baseline=$BASE_STATUS probe=$PROBE_STATUS(rc=$PROBE_RC) exempt_probe=$PROBE2_STATUS(rc=$PROBE2_RC) residue_code=$CODE_RESIDUE residue_repo=$REPO_RESIDUE shim=$SHIM_USED g10region_named=$G10REGION_NAMED"
if [ "$RC" -eq 0 ]; then
  echo "✅ 注入自测结果：期望红组全部 RED_CONFIRMED、期望绿场景（g10exempt）GREEN_CONFIRMED、判别性探针 RED_CONFIRMED，残留断言满足，baseline=${BASE_STATUS}（结论归自验/独立审计，本夹具只出证据）"
  [ "$BASE_STATUS" = "host_state" ] && echo "   ⚠️ 注意：基线非天然绿（宿主 /tmp marker 绝对路径读取，已由探针因果确认）——CI 上新 runner 应为 BASELINE_OK"
else
  echo "❌ 注入自测未达期望：not_red=$NOTRED_N green_fail=$GREENFAIL_N exempt_probe=$PROBE2_STATUS baseline=$BASE_STATUS probe=$PROBE_STATUS residue_fail=$RESIDUE_FAIL"
fi
exit "$RC"
