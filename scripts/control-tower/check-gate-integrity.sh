#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-integrity.sh — M9: 控制塔门禁完整性三件套（阻断型，0/1/2 三态 fail-closed）
#
# 背景（三类"门禁自身坏了没人知道"）:
#   · D937 — scripts/pre-commit-check.sh 内 grep 模式在 BSD grep 下语法非法（rc=2），
#            该检查恒不产出结果 = 门禁静默失效。
#   · D526 — 测试文件存在但未登记 CI 密封清单 = 永不执行。
#   · 既有 CI 红无基线 = 无法区分"已知红"与"新增红"。
#
# 契约（铁律 47）:
#   @用法    bash scripts/control-tower/check-gate-integrity.sh \
#              [--patterns-only|--registry-only] [--ci-reds <check-runs.json>] [--base-ref <ref>] [--root <dir>] [--verbose]
#            默认（无模式旗标）= A 模式哨兵 + B 登记 gate；--ci-reds 追加 C 对账；
#            未给 --ci-reds 时 C 显式 SKIPPED（不参与 OK/违规判定）。
#   D954（2026-09-25，K3 定罪「C 段空转」修复）——**对账对象必须可确定**:
#     · 定罪: C 段此前取的是**当前提交**的 check-runs（ci.yml `REF=head.sha`），而该时刻同 SHA
#       多数 job 仍 in_progress（conclusion≠failure）→ `失败检查 0 项` → **棘轮从未被行使**
#       （同 SHA 终局实有 3 个 failure）。取"当前提交"= 用未定态集合证明"无红"，是空转的根因。
#     · 修法: 取 **base**（PR: `github.event.pull_request.base.sha`；push: `origin/main`）并由
#       `--base-ref <ref>` 显式传入；C 段**必打印**一行 `对账对象 = <ref> @ <sha>`
#       （ASCII 前缀 `对账对象 `，供 ci.yml 证据步注解公开检索，使证据自带对账对象身份）。
#     · `--base-ref` 缺省时 C 段**显式 SKIPPED**（可见、不静默放行；ratchet 不判定 ≠ 通过）——
#       绝不"用不知来源的 JSON 判绿"。ref 不可解析 → **exit 2**（fail-closed，绝不判绿）。
#   @输入    注入缝（生产有默认值；测试必需）:
#              SYNO_GATE_SCAN_SCRIPTS  空格分隔脚本清单（默认 scripts/pre-commit-check.sh + scripts/control-tower/*.sh）
#              SYNO_TESTS_DIR          测试根（默认 tests/）
#              SYNO_CI_YML             CI 清单（默认 .github/workflows/ci.yml）
#              SYNO_GATE_BASELINE      未登记测试 ratchet 基线（默认 scripts/control-tower/gate-integrity-baseline.txt）
#              SYNO_CI_RED_BASELINE    既有 CI 红基线（默认 scripts/control-tower/ci-red-baseline.txt）
#              SYNO_GATE_DEGRADED_LOG  降级事件日志（默认 .codex/control-tower/logs/degraded-events.log）
#   @输出    违规行（`VIOLATION: ...`）+ 统计行 + 末行固定三态之一:
#              GATE-INTEGRITY: OK | GATE-INTEGRITY: VIOLATION(n) | GATE-INTEGRITY: DEGRADED
#   @exit    0=通过；1=违规；2=执行失败/降级（fail-closed——2 绝不等于通过）
#   @降级    依赖缺失/不可读/解析器失败 → stderr `degraded: <原因>` + 追加一行 JSON 到
#             degraded 日志（字段 time/component/code/phase/retryable；铁律 11/32）+ exit 2
#
# A 模式哨兵（方言分判是硬要求，否则误报）:
#   ERE = flags 含 E / --extended-regexp；BRE = 其余（含 -v / --invert-match）；-F 固定串跳过；-P PCRE 不可校验。
#   哨兵: `printf '' | grep [-E] -- "$PAT"` → rc 0/1 = 合法；rc ≥2 = 语法非法 → 违规（点名 file:line + 模式原文）。
#   方言判别样例（**同一坐标跨方言判定不同** —— 跨平台陷阱的根源）:
#     scripts/pre-commit-check.sh:991 `grep -Ev "...|^+++|..."`:
#       · BSD grep（macOS 本机）: rc=2 —— ERE 里 `^+` 无操作数 → **非法 = 违规**
#       · GNU grep（CI / Ubuntu）: `^+++` **合法且匹配一切** → rc 0/1 → **不违规**
#       依据出处: K3 批次2 报告附录 GNU grep 3.11 实证（CTO 2026-09-24 本地复现并认可根因）。
#     即同一条 `:991` 两端"是否违规"结论相反 → "已不再违规"绝不能一律判红（见下方 STALE 规则）。
#     scripts/pre-commit-check.sh:492 `grep -v '^+++'` → BRE 合法（rc=1），两端一致（方言分判避免误报）。
#   存量棘轮（CTO 裁定 2026-09-24，二次裁定 A: STALE 去平台陷阱）:
#     PATTERN-BASELINE 段（在 $SYNO_GATE_BASELINE 同一文件内）登记既有非法模式，每条:
#       <脚本相对路径>:<行号> | owner=<D#/角色> | expires=YYYY-MM-DD | evidence=<引用>
#     · 命中基线的既有违规 → 不判违规；输出 `PATTERN-BASELINE: registered <n>；STALE(<n>)` 计数
#     · 不在基线内的新非法模式 → **必红**（点名 file:line + 模式原文）
#     · 条目坐标在**本平台**已不再违规（如 :991 在 GNU 上）→ 记 **STALE**，输出
#       `PATTERN-BASELINE: STALE(<gnu|bsd>) <key>`：**可见 + 计数，但不影响退出码**
#       （跨方言判定不同，不能当"新增红"追责；本地 BSD 绿 / CI GNU 红 正是本规则要消除的陷阱）
#     · **expires 仍是硬门（STALE 不放行）**: 缺 `expires` 键 → exit 2 degrade；
#       expires < 今天 → exit 1（不论该条 registered 还是 STALE —— 防"拔牙"）
#     · 基线文件缺失/不可读 → exit 2（fail-closed：无登记簿 = 无法区分存量与新增）
#   平台方言由**行为探针**判定（不用 `grep --version` 文案）:
#     `printf 'test\n' | grep -Ev '^+++'` → rc=2 ⇒ **bsd**；rc 0/1 ⇒ **gnu**。
#   CI step summary: 若环境变量 $GITHUB_STEP_SUMMARY 存在且可写 → 追加 `## Gate Integrity` 块
#     （PATTERN-SENTINEL / PATTERN-BASELINE / CI-REGISTRY / CI-RED-CHECK / 末行判定）；
#     变量存在但不可写 → **显式 degrade（exit 2，不静默）**。
#   实测 2026-09-24（D938 base 416b4667 + coder-b 交件后）: 既有违规**仅 1 处** —— scripts/pre-commit-check.sh:991
#     （BSD rc=2）已登记 → 本机 `--patterns-only` exit 0（registered 1 / STALE 0）。该处修归 D937，本卡不改 pre-commit-check.sh。
#     扫描脚本 29 个 / 解析模式 268 个 / 可校验 236（ERE 124 · BRE 112）/ 不可校验 32（数字随文件增删漂移，以运行时输出为准）。
#   本器有效性证明由 tests/control-tower/check-gate-integrity.test.sh 用自造样本承担（不依赖仓库现状）。
#   已知静态边界（诚实声明，非违规）: 整行注释不扫（注释示例不执行）；变量/命令替换模式（如 "$PAT"）
#     与 -P PCRE 计为"不可校验"（计数、不判违规）；`-f 模式文件` 跳过。可校验模式数=0 → 降级 exit 2
#     （含 CTO 明令的"解析到 0 个模式"——防扫描器自身坏掉还报绿）。
#
# B 登记 gate（分面口径由 CTO 冻结 2026-09-24，实测于 D938 base 416b4667）:
#   · 扫描 $SYNO_TESTS_DIR 下 *.test.sh|*.test.py|*.test.ts。
#   · 登记判定 = 路径出现在 $SYNO_CI_YML **全文**（密封清单 `for t in` 或任意 job 的 `run:` 步骤均计登记——
#     重型夹具不进 canary 清单，避免 canary 时长翻倍）。
#   · **违规面 = CI 密封面（*.test.sh / *.test.py）**: 这两个面只有被显式登记才会在 CI 执行 → 未登记即违规。
#       - 未登记且不在基线 → `新增测试未登记 CI 密封清单`
#       - 基线有而"未登记集"无（已登记或文件已删）→ `基线过期，须删条目`
#   · **`*.test.ts` 只统计 + 一行 NOTE，不判违规**: vitest job 按 glob 自动发现并执行，已被 CI 覆盖。
#       ⚠ 失效条件: 若 vitest 改成显式清单（不再是 glob 全域），必须把 ts 面提升为违规面（再测口径）。
#   · 实测（D938 base）: sh|py 122 文件 / ci.yml 命中 43 / 未登记 79（基线 79 条）；
#     ts 610 文件 / 命中 1 / 未登记 609。命令:
#       git ls-tree -r --name-only HEAD | grep -E '^tests/.*\.test\.(sh|py)$' | sort -u | wc -l   # 122
#       grep -oE 'tests/[A-Za-z0-9_./-]+\.test\.(sh|py)' .github/workflows/ci.yml | sort -u | wc -l  # 43
#       git ls-tree -r --name-only HEAD | grep -E '^tests/.*\.test\.ts$' | sort -u | wc -l          # 610
#   · 基线文件缺失 → exit 2（fail-closed）。
#   基线文件 $SYNO_GATE_BASELINE 为**双段单文件**（A/B 各读自己那段，见两处段标记的注释行）:
#     [R] REGISTRY-BASELINE 段 = 未登记测试存量（本模式读）；[P] PATTERN-BASELINE 段 = 既有非法模式（A 模式读）。
#
# C 既有红对账（仅 --ci-reds 时执行；**必须同时给 --base-ref**，见上方 D954 段）:
#   读 GitHub check-runs JSON（.check_runs[].name/.conclusion）；conclusion=="failure" 的 name
#   必须在 $SYNO_CI_RED_BASELINE 内且 expires 未过期，否则违规。红基线每行格式（冻结）:
#     <check-run name> | first_seen=YYYY-MM-DD | owner=<D#/角色> | expires=YYYY-MM-DD | evidence=<引用>
#   · 可选键 `disposition_due=YYYY-MM-DD`（D954 新增消费）: **处置期限**（与 expires 同级硬门）——
#     键存在且 `disposition_due < 今天` → 违规「CI 红处置逾期」。键**缺失不判**（存量条目不回溯，
#     向后兼容）；缺 expires 键仍按既有规则 exit 2（两者语义不同：expires=豁免到期，disposition_due=处置到期）。
#   · name 匹配容忍 `|` 前空格（C1 缺陷修复：冻结格式是 `NAME | first_seen=...`），
#     name 内 ERE 元字符整体转义（检查名含中文/全角括号/点号）。
#   · expires / owner / disposition_due **按键取值**，绝不按字段序号（C2 缺陷修复：冻结格式 $2 是 first_seen，不是 expires）。
#   · 条目命中但缺 expires 键 → exit 2（malformed，绝不静默当 0 = fail-open）。
#   · JSON 不可读/非法/缺 check_runs → exit 2；expires < 今天 → 违规；disposition_due < 今天 → 违规。
#   · K3 端到端复核（真基线 + 真 API 快照，无需自造样本）:
#       curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" \
#         "https://api.github.com/repos/<owner>/<repo>/commits/<base sha>/check-runs" > /tmp/checkruns.json
#       bash scripts/control-tower/check-gate-integrity.sh --ci-reds /tmp/checkruns.json --base-ref <ref>
#     期望: 首行出 `对账对象 = <ref> @ <sha>`；既有红全部在 ci-red-baseline.txt 内 → rc=0；
#     退化/离线时用夹具的 C1/C2/C3/D1 断言做等价回归（含 D954 的 M1–M4 判别性靶）。
#
# 与 check-canary-drift.sh 的分工（CTO Q-M9-2）: canary 漂移 = 告警恒 exit 0；本器 = 阻断（1/2）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

# D954 定根（护栏）: 顺序 = `--root` 显式值 > `git rev-parse` > 脚本相对兜底。
#   `git rev-parse --show-toplevel` **随 cwd 漂移**（实测：cwd=主仓 → ROOT=主仓；cwd=另一 git 仓 →
#   ROOT=那个仓）→ 会静默读错树的基线 = "测试的树不是被测的树"。故 `--root` 必须在**本行之前**解析生效
#   （若在参数循环里才解析，非 git cwd 下 ROOT 已落空，覆盖将静默失效）。预扫只认 --root，不做别的判定。
ROOT_OVERRIDE=""
_i=1
while [ "$_i" -le "$#" ]; do
  _a="${!_i}"
  case "$_a" in
    --root) _j=$((_i + 1)); [ "$_j" -le "$#" ] && ROOT_OVERRIDE="${!_j}" ;;
    --root=*) ROOT_OVERRIDE="${_a#--root=}" ;;
  esac
  _i=$((_i + 1))
done
if [ -n "$ROOT_OVERRIDE" ]; then
  ROOT="$(cd "$ROOT_OVERRIDE" 2>/dev/null && pwd)"
  if [ -z "$ROOT" ]; then
    # degrade()/降级日志此刻尚未就绪（日志路径本身依赖 ROOT）→ 只 stderr 显式 + exit 2（fail-closed）
    printf 'degraded: --root 目录不存在或不可进入: %s\n' "$ROOT_OVERRIDE" >&2
    exit 2
  fi
else
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$ROOT" ] || ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # 非 git cwd 时按脚本位置定位仓库根
fi
TMPD="$(mktemp -d 2>/dev/null || mktemp -d -t m9-gate-integrity)"
trap 'rm -rf "$TMPD"' EXIT
DEGRADED_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"

# PYBIN 三级探测（PLATFORM-CHECKLIST.md #1，D520/D328：禁裸 python3——Windows 可能只有 python/py；
# 损坏 shim 要探"可用性"不只看存在性）。不可用 → 各模式显式 degrade exit 2（铁律 11，不静默）。
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

VIOLATIONS=0
violation() { VIOLATIONS=$((VIOLATIONS + 1)); printf 'VIOLATION: %s\n' "$1"; }
info() { printf '%s\n' "$1"; }
vprint() { [ "$VERBOSE" = 1 ] && printf '%s\n' "$1"; }

# ── 平台方言行为探针（不用 `grep --version` 文案）: `^+++` 在 BSD ERE 非法(rc=2)，GNU 合法(rc 0/1) ──
# 注: 探针模式用**拼接**构造 —— 本器会扫描自身，若把这条"故意非法"的 ERE 字面量写死，
#     会把自己判成新增违规（红证落入扫描面）；拼接后该调用是变量模式 → 计"不可校验"，不判违规。
_PROBE_PAT='^++'"+"           # = ^+++；BSD 下 rc=2 是**探针预期结果**，不是缺陷
grep_dialect() {
  printf 'test\n' | grep -Ev "$_PROBE_PAT" >/dev/null 2>&1
  case $? in
    2) printf '%s\n' "bsd" ;;
    *) printf '%s\n' "gnu" ;;
  esac
}
GREP_DIALECT="$(grep_dialect)"

# ── step summary 状态（CI 各面统计；未运行的模式留空 → 摘要写 not run）──
SUM_PARSED=""; SUM_CHECKABLE=""; SUM_ERE=""; SUM_BRE=""
SUM_PAT_REG=""; SUM_PAT_STALE=""
SUM_REG_SEALED=""; SUM_REG_LISTED=""; SUM_REG_UNREG=""; SUM_REG_BASE=""
SUM_CIRED=""

# ── 基线行取值（C1/C2 缺陷教训：**按键取值，绝不按字段序号**）──
_re_escape() { # 把 name 里的 ERE 元字符转义（检查名含中文/全角括号/点号等）
  printf '%s' "$1" | sed 's/[][\\.^$*+?(){}|]/\\&/g'
}
_key_value() { # $1=基线行 $2=键名（expires / owner / first_seen ...）→ 值（取首个匹配，去空白）
  printf '%s' "$1" | grep -oE "$2=[^|]*" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'   # swallow-ok: 键缺失=正常情形（调用方按空值走 degrade/违规分支，非静默通过）
}

# ── 降级事件日志（铁律 11/32；供 degrade 与 step-summary 不可写共用）──
_degrade_log() { # $1=code $2=phase $3=原因
  mkdir -p "$(dirname "$DEGRADED_LOG")" 2>/dev/null || true
  printf '{"time":"%s","component":"check-gate-integrity","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$DEGRADED_LOG" 2>/dev/null || true
}

# ── CI step summary（$GITHUB_STEP_SUMMARY 存在且可写 → 追加；存在但不可写 → 显式 degrade，不静默）──
# 实现注记（实测坑）: 把写文件的复合命令直接放进 `if ! { ... } >> "$f" …` 条件里时，
#   本机 bash 3.2 **重定向失败判不出来**（错误照打，条件仍走"成功"分支）——
#   故改为「显式 -w 判定 + 写函数 rc 判定」双保险，绝不靠重定向错误码。
_write_summary_block() { # $1=path $2=verdict；rc=写入结果（0=成功）
  {
    printf '\n## Gate Integrity\n'
    printf -- '- PATTERN-SENTINEL: parsed=%s checkable=%s (ERE %s / BRE %s)\n' "${SUM_PARSED:-not run}" "${SUM_CHECKABLE:-not run}" "${SUM_ERE:-0}" "${SUM_BRE:-0}"
    printf -- '- PATTERN-BASELINE: registered=%s STALE=%s\n' "${SUM_PAT_REG:-not run}" "${SUM_PAT_STALE:-not run}"
    if [ -z "$SUM_REG_SEALED" ]; then
      printf -- '- CI-REGISTRY: not run\n'
    else
      printf -- '- CI-REGISTRY: 密封面=%s 登记=%s 未登记=%s 基线=%s\n' "$SUM_REG_SEALED" "$SUM_REG_LISTED" "$SUM_REG_UNREG" "$SUM_REG_BASE"
    fi
    printf -- '- CI-RED-CHECK: %s\n' "${SUM_CIRED:-SKIPPED}"
    printf -- '- GATE-INTEGRITY: %s\n' "$2"
  } >> "$1" 2>/dev/null   # swallow-ok: 返回值即判据（调用方按 rc 走显式 degrade），非静默吞错
}

write_step_summary() { # $1=判定（OK | VIOLATION(n) | DEGRADED）；不可写时 exit 2
  local path="${GITHUB_STEP_SUMMARY:-}"
  [ -n "$path" ] || return 0                      # 未设置（本地运行）→ 正常跳过
  local wrc=0
  if [ -e "$path" ] && [ ! -w "$path" ]; then
    wrc=1                                         # 存在但不可写：显式判 -w，不靠重定向错误
  else
    _write_summary_block "$path" "$1"; wrc=$?
  fi
  if [ "$wrc" -ne 0 ]; then
    printf 'degraded: GITHUB_STEP_SUMMARY 存在但不可写: %s（step summary 无法落地，不静默跳过）\n' "$path" >&2
    _degrade_log "STEP_SUMMARY_UNWRITABLE" "summary" "GITHUB_STEP_SUMMARY 不可写: $path"
    printf 'GATE-INTEGRITY: DEGRADED\n'
    exit 2
  fi
}

# ── 降级出口（铁律 11/32）: stderr 显式 + degraded 日志 JSON + exit 2（绝不当作通过）──
degrade() { # $1=code $2=phase $3=原因
  printf 'degraded: %s\n' "$3" >&2
  _degrade_log "$1" "$2" "$3"
  write_step_summary "DEGRADED" >/dev/null 2>&1 || true   # swallow-ok: 摘要写出错已由 write_step_summary 自己显式 degrade；此处不掩盖退出码
  printf 'GATE-INTEGRITY: DEGRADED\n'
  exit 2
}

usage() {
  cat <<'USAGE'
用法: bash scripts/control-tower/check-gate-integrity.sh [--patterns-only|--registry-only] [--ci-reds <json>] [--base-ref <ref>] [--verbose]
  --patterns-only   仅 A 模式哨兵（grep 方言语法验证）
  --registry-only   仅 B CI 登记 gate
  --ci-reds <json>  追加 C 既有红基线对账（GitHub check-runs JSON）
  --base-ref <ref>  C 段对账对象（**取 base，不取当前提交**；如 PR base.sha / origin/main）
                    缺省时 C 段显式 SKIPPED（不判定 ≠ 通过）；不可解析 → exit 2
  --root <dir>      显式定根（默认 `git rev-parse --show-toplevel`，**随 cwd 漂移**）；
                    多 worktree / cwd 非本仓场景必须显式给，防读错树的基线（D954 护栏）
  --verbose         打印逐条模式与集合明细
USAGE
}

# ═══ A 模式哨兵 ═══════════════════════════════════════════════════════════════

# 探针调用点（夹具 M4 变异点：整行替换为 `_rc=0` 后，非法 ERE 必须不再报红）
_sentinel_probe() { # $1=E|B  $2=模式 → 返回 grep rc（0/1=合法；≥2=非法）
  local _d="$1" _p="$2" _rc=0
  _sentinel_grep "$_d" "$_p"; _rc=$?    # M9-SENTINEL-CORE（夹具 M4 变异点）
  return "$_rc"
}

_sentinel_grep() { # 真正调用 grep —— 方言分判在此落地
  case "$1" in
    E) printf '' | grep -E -- "$2" >/dev/null 2>&1; return $? ;;
    B) printf '' | grep -- "$2" >/dev/null 2>&1; return $? ;;
    *) return 2 ;;
  esac
}

extract_patterns() { # <脚本路径...> → TSV: file<TAB>line<TAB>dialect<TAB>pattern
  "$PYBIN" - "$@" <<'PYEOF'
import re
import sys

WORD = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
CMD_SEP = frozenset("|&;(){}`$")
KEYWORDS = frozenset(["if", "then", "else", "elif", "do", "while", "until", "!", "time",
                      "command", "exec", "eval", "xargs", "sudo", "env", "nohup", "bash", "sh"])
VALUE_LONG = frozenset(["include", "exclude", "exclude-dir", "exclude-from", "label",
                        "max-count", "after-context", "before-context", "context",
                        "binary-files", "devices", "directories", "color", "colour"])
VALUE_SHORT_DIGIT = frozenset("ABCm")


def is_expansion(line, j):
    """`$` 是否真的开启一次展开——双引号内 `"...\\.ts$"` 的 `$` 是字面量（后接引号），不是展开。"""
    n = len(line)
    if j + 1 >= n:
        return False
    nxt = line[j + 1]
    return nxt == '$' or nxt in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_{($?!*@#-'


def read_value(line, i):
    """读一个 shell 词 → (值, 是否含可展开引用, 新下标)。

    支持相邻段拼接（`'a'\"b\"c`、`'a'\\''b'`）——grep 模式常由多段引号拼出
    （实证 scripts/control-tower/dev-doc-gatekeeper.sh:109: `'...\\\"'\\'',;]+'`），
    按"首个引号段"截断会造出一个并不存在的非法模式（假阳性）。
    单引号内一律字面量；双引号内只对 `$ \\` \" \\\\` 去转义（POSIX）。
    """
    n = len(line)
    buf = []
    expandable = False
    j = i
    while j < n:
        c = line[j]
        if c in ' \t|;&()<>`':
            break
        if c == "'":
            j += 1
            while j < n and line[j] != "'":
                buf.append(line[j])
                j += 1
            if j < n:
                j += 1
            continue
        if c == '"':
            j += 1
            while j < n:
                d = line[j]
                if d == '\\' and j + 1 < n and line[j + 1] in '$`"\\\n':
                    buf.append(line[j + 1])
                    j += 2
                    continue
                if d == '"':
                    j += 1
                    break
                if d == '$' and is_expansion(line, j):
                    expandable = True
                buf.append(d)
                j += 1
            continue
        if c == '\\':
            if j + 1 < n:
                buf.append(line[j + 1])
                j += 2
                continue
            j += 1
            continue
        if c == '$' and is_expansion(line, j):
            expandable = True
        buf.append(c)
        j += 1
    return "".join(buf), expandable, j


def command_position(line, i):
    """grep 是否处于命令位置（前一个非空白为分隔符或 shell 关键字）——排除字符串字面量里的 'grep'。"""
    j = i - 1
    while j >= 0 and line[j] in ' \t':
        j -= 1
    if j < 0:
        return True
    if line[j] in CMD_SEP:
        return True
    k = j
    while k >= 0 and line[k] in WORD:
        k -= 1
    return line[k + 1:j + 1] in KEYWORDS


def parse_grep(line, start):
    """解析一个 grep 调用 → (方言, 模式, 是否可展开) 或 None。方言: E/B/U（U=不可校验）。"""
    n = len(line)
    i = start
    flags = set()
    pattern = None
    expandable = False
    while i < n:
        while i < n and line[i] in ' \t':
            i += 1
        if i >= n or line[i] == '#':
            break
        if line[i] == '-':
            if line.startswith('--', i):
                m = re.match(r'--[A-Za-z][A-Za-z0-9-]*', line[i:])
                if not m:
                    i += 2                      # 裸 `--`（选项结束）
                    continue
                opt = m.group(0)
                i += len(opt)
                if i < n and line[i] == '=':
                    j = i + 1
                    while j < n and line[j] not in ' \t':
                        j += 1
                    if opt == '--regexp':
                        pattern, expandable = line[i + 1:j], True
                    i = j
                    continue
                if opt == '--extended-regexp':
                    flags.add('E')
                elif opt == '--fixed-strings':
                    flags.add('F')
                elif opt == '--perl-regexp':
                    flags.add('P')
                elif opt == '--invert-match':
                    flags.add('v')
                elif opt == '--regexp':
                    while i < n and line[i] in ' \t':
                        i += 1
                    pattern, expandable, i = read_value(line, i)
                    break
                elif opt[2:] in VALUE_LONG:
                    while i < n and line[i] in ' \t':
                        i += 1
                    _, _, i = read_value(line, i)
                continue
            m = re.match(r'-[A-Za-z0-9]+', line[i:])
            if not m:
                break
            cluster = m.group(0)[1:]
            i += len(m.group(0))
            want = None
            has_digit = any(ch.isdigit() for ch in cluster)
            for ch in cluster:
                if not ch.isalpha():
                    continue
                flags.add(ch)
                if ch in 'ef':
                    want = ch
            if want == 'e':
                while i < n and line[i] in ' \t':
                    i += 1
                pattern, expandable, i = read_value(line, i)
                break
            if want == 'f':
                return None                     # -f 模式文件：静态不可知
            if cluster[-1] in VALUE_SHORT_DIGIT and not has_digit:
                while i < n and line[i] in ' \t':
                    i += 1
                _, _, i = read_value(line, i)   # -A 3 / -B 2 之类分离取值
            continue
        val, expandable, i = read_value(line, i)
        if val == "" and not expandable:
            break
        pattern = val
        break
    if pattern is None or pattern == "":
        return None
    if 'F' in flags:
        return ('F', pattern, expandable)       # 固定字符串：无语法风险
    if 'P' in flags:
        return ('U', pattern, expandable)       # PCRE：本哨兵不可校验
    if 'E' in flags:
        return ('E', pattern, expandable)
    return ('B', pattern, expandable)


def iter_greps(line):
    out = []
    n = len(line)
    i = 0
    while i < n:
        if (line.startswith('grep', i)
                and (i == 0 or line[i - 1] not in WORD)
                and (i + 4 >= n or line[i + 4] not in WORD)
                and command_position(line, i)):
            res = parse_grep(line, i + 4)
            if res is not None:
                out.append(res)
        i += 1
    return out


def main():
    for path in sys.argv[1:]:
        try:
            with open(path, encoding='utf-8', errors='replace') as fh:
                lines = fh.read().split('\n')
        except OSError as exc:
            sys.stderr.write("unreadable: %s: %s\n" % (path, exc))
            sys.exit(4)
        for no, line in enumerate(lines, 1):
            if line.lstrip().startswith('#'):
                continue                        # 整行注释：不执行，跳过（避免注释示例误报）
            for dialect, pattern, expandable in iter_greps(line):
                if dialect == 'F':
                    continue
                if dialect == 'U' or expandable:
                    sys.stdout.write("%s\t%d\tU\t%s\n" % (path, no, pattern))
                    continue
                sys.stdout.write("%s\t%d\t%s\t%s\n" % (path, no, dialect, pattern))


main()
PYEOF
}

run_patterns() {
  info ""
  info "── A 模式哨兵（grep 方言分判 + 语法 rc 验证 + 存量登记棘轮）──"
  local scan_list="${SYNO_GATE_SCAN_SCRIPTS:-$ROOT/scripts/pre-commit-check.sh $ROOT/scripts/control-tower/*.sh}"
  local existing="" f
  for f in $scan_list; do
    [ -f "$f" ] || degrade "A_SCAN_SCRIPT_MISSING" "patterns" "扫描脚本缺失: $f"
    [ -r "$f" ] || degrade "A_SCAN_SCRIPT_UNREADABLE" "patterns" "扫描脚本不可读: $f"
    existing="$existing $f"
  done

  local baseline="${SYNO_GATE_BASELINE:-$ROOT/scripts/control-tower/gate-integrity-baseline.txt}"
  [ -f "$baseline" ] || degrade "A_PATTERN_BASELINE_MISSING" "patterns" "模式基线缺失: $baseline"
  [ -r "$baseline" ] || degrade "A_PATTERN_BASELINE_UNREADABLE" "patterns" "模式基线不可读: $baseline"

  # PATTERN-BASELINE 段（段标记 = 注释行去 `#` 后以 ═ 开头 + 段名）→ key|expires
  awk '
    /^[[:space:]]*#/ {
      line = $0
      sub(/^[[:space:]]*#[[:space:]]*/, "", line)
      if (line ~ /^═+[[:space:]]*PATTERN-BASELINE/)  { sec = "P"; next }
      if (line ~ /^═+[[:space:]]*REGISTRY-BASELINE/) { sec = "R"; next }
      next
    }
    /^[[:space:]]*$/ { next }
    sec == "P" { print }
  ' "$baseline" 2>/dev/null > "$TMPD/pat_entries_raw.txt"   # swallow-ok: 基线可读性已在上游 -f/-r 校验；awk 读失败=空登记簿 → 既有违规回退为红（fail-closed，不静默放行）
  : > "$TMPD/pat_entries.txt"
  local pline pkey pexpires
  while IFS= read -r pline; do
    [ -n "$pline" ] || continue
    pkey="$(printf '%s' "$pline" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $1); print $1}')"
    pexpires="$(_key_value "$pline" expires | tr -d '[:space:]')"
    [ -n "$pkey" ] || continue
    printf '%s|%s\n' "$pkey" "$pexpires" >> "$TMPD/pat_entries.txt"
  done < "$TMPD/pat_entries_raw.txt"

  [ -n "$PYBIN" ] || degrade "A_NO_PYTHON" "patterns" "python 不可用（PYBIN 三级探测 python3/python/py 均失败）——模式解析无法执行"
  if ! extract_patterns $existing > "$TMPD/patterns.tsv" 2>"$TMPD/extract.err"; then
    local err
    err="$(tr '\n' ' ' < "$TMPD/extract.err" 2>/dev/null | cut -c1-200)"   # swallow-ok: 仅取诊断文本；读不到时 ${err:-unknown} 兜底，判据（exit 2）不受影响
    degrade "A_EXTRACT_FAILED" "patterns" "模式解析器执行失败: ${err:-unknown}"
  fi

  : > "$TMPD/pat_matched.txt"
  : > "$TMPD/pat_stale.txt"
  local parsed=0 checked=0 unverifiable=0 ere_n=0 bre_n=0 registered=0
  local p_file p_line p_dialect p_pattern rc label key
  while IFS=$'\t' read -r p_file p_line p_dialect p_pattern; do
    [ -n "${p_file:-}" ] || continue
    parsed=$((parsed + 1))
    if [ "$p_dialect" = "U" ]; then
      unverifiable=$((unverifiable + 1))
      vprint "  PATTERN [UNVERIFIABLE] ${p_file}:${p_line} ${p_pattern}"
      continue
    fi
    checked=$((checked + 1))
    if [ "$p_dialect" = "E" ]; then
      ere_n=$((ere_n + 1)); label="ERE"
    else
      bre_n=$((bre_n + 1)); label="BRE"
    fi
    vprint "  PATTERN [${label}] ${p_file}:${p_line} ${p_pattern}"
    _sentinel_probe "$p_dialect" "$p_pattern"; rc=$?
    if [ "$rc" -ge 2 ]; then
      key="${p_file#"$ROOT"/}:${p_line}"
      if awk -F'|' -v k="$key" '$1 == k { found = 1 } END { exit !found }' "$TMPD/pat_entries.txt" 2>/dev/null; then   # swallow-ok: 探测型（登记簿是否命中本 key）；读失败=未命中 → 走 else 判违规，不放行
        registered=$((registered + 1))
        printf '%s\n' "$key" >> "$TMPD/pat_matched.txt"
        vprint "  PATTERN-BASELINE: registered ${key}（既有违规，显式登记，不判违规）"
      else
        violation "非法 ${label} 模式（grep rc=${rc}）: ${p_file}:${p_line}: ${p_pattern}"
      fi
    fi
  done < "$TMPD/patterns.tsv"

  local n_entries today n_stale=0
  n_entries=$(wc -l < "$TMPD/pat_entries.txt" | tr -d ' ')
  today="$(date -u +%F)"
  info "PATTERN-SENTINEL: 解析 ${parsed} 个模式；可校验 ${checked}（ERE ${ere_n} / BRE ${bre_n}）；不可校验 ${unverifiable}；扫描脚本 $(printf '%s' "$existing" | wc -w | tr -d ' ') 个"
  if [ "$checked" -eq 0 ]; then
    degrade "A_NO_CHECKABLE_PATTERN" "patterns" \
      "可校验 grep 模式数=0（解析 ${parsed} 个）——扫描器疑似失效，fail-closed 不报绿"
  fi
  if [ "$n_entries" -gt 0 ]; then
    while IFS='|' read -r pkey pexpires; do
      [ -n "$pkey" ] || continue
      # 硬门 1: 缺 expires 键 → degrade（STALE / registered 都不放行）
      if [ -z "$pexpires" ]; then
        degrade "A_PATTERN_BASELINE_NO_EXPIRES" "patterns" "PATTERN-BASELINE 条目缺 expires 键（不可静默当 0）: ${pkey}"
      fi
      local is_stale=0
      if ! grep -F -x -q -- "$pkey" "$TMPD/pat_matched.txt" 2>/dev/null; then   # swallow-ok: 探测型（条目本轮是否命中）；文件缺失=未命中 → 判 STALE（可见+计数，不判违规）
        is_stale=1
        n_stale=$((n_stale + 1))
        printf '%s\n' "$pkey" >> "$TMPD/pat_stale.txt"
      fi
      # 硬门 2: expires < 今天 → exit 1（不论该条 registered 还是 STALE —— 防"拔牙"）
      if [[ "$pexpires" < "$today" ]]; then
        if [ "$is_stale" = 1 ]; then
          violation "PATTERN 基线过期（须修或延期；条目本平台已 STALE(${GREP_DIALECT})）: ${pkey}（expires ${pexpires} < ${today}）"
        else
          violation "PATTERN 基线过期（须修或延期）: ${pkey}（expires ${pexpires} < ${today}）"
        fi
      elif [ "$is_stale" = 1 ]; then
        # STALE: 本平台已不再违规（跨方言判定不同）→ 可见 + 计数，但**不影响退出码**
        info "PATTERN-BASELINE: STALE(${GREP_DIALECT}) ${pkey}（本平台已不再违规；不影响退出码；expires ${pexpires} 前须删条目或重修）"
        vprint "  PATTERN-BASELINE: STALE(${GREP_DIALECT}) ${pkey}（registered=0 / 本平台无违规坐标）"
      fi
    done < "$TMPD/pat_entries.txt"
  fi
  info "PATTERN-BASELINE: registered ${registered}；STALE(${n_stale})"
  SUM_PARSED="$parsed"; SUM_CHECKABLE="$checked"; SUM_ERE="$ere_n"; SUM_BRE="$bre_n"
  SUM_PAT_REG="$registered"; SUM_PAT_STALE="$n_stale"
}

# ═══ B CI 清单登记 gate ═══════════════════════════════════════════════════════

run_registry() {
  info ""
  info "── B CI 清单登记 gate（密封面 ratchet）──"
  local tests_dir="${SYNO_TESTS_DIR:-$ROOT/tests}"
  local ci_yml="${SYNO_CI_YML:-$ROOT/.github/workflows/ci.yml}"
  local baseline="${SYNO_GATE_BASELINE:-$ROOT/scripts/control-tower/gate-integrity-baseline.txt}"

  [ -d "$tests_dir" ] || degrade "B_TESTS_DIR_MISSING" "registry" "测试目录缺失: $tests_dir"
  [ -f "$ci_yml" ] || degrade "B_CI_YML_MISSING" "registry" "CI 清单缺失: $ci_yml"
  [ -f "$baseline" ] || degrade "B_BASELINE_MISSING" "registry" "ratchet 基线缺失: $baseline"

  local base_dir; base_dir="$(dirname "${tests_dir%/}")"
  local p
  find "$tests_dir" -type f \( -name '*.test.sh' -o -name '*.test.py' -o -name '*.test.ts' \) -not -path '*/node_modules/*' > "$TMPD/all_tests_raw.txt" 2>/dev/null   # swallow-ok: find 读目录失败=枚举为空 → 未登记集空 → [R] 条目全判"基线过期"（fail-closed 红，不静默放行）
  while IFS= read -r p; do printf '%s\n' "${p#"$base_dir"/}"; done < "$TMPD/all_tests_raw.txt" | sort -u > "$TMPD/all_tests.txt"
  # 登记 = 路径出现在 ci.yml **全文**（密封清单 for t in 或任意 job 的 run: 步骤）
  grep -oE 'tests/[A-Za-z0-9_./-]+\.test\.(sh|py|ts)' "$ci_yml" 2>/dev/null | sort -u > "$TMPD/registered_all.txt"   # swallow-ok: 探测型 grep；无匹配/读失败=登记集空 → 未登记集=全集 → 全红（fail-closed）
  grep -E '\.test\.(sh|py)$' "$TMPD/all_tests.txt" > "$TMPD/all_ci_face.txt" || true
  grep -E '\.test\.ts$' "$TMPD/all_tests.txt" > "$TMPD/all_ts_face.txt" || true
  grep -E '\.test\.(sh|py)$' "$TMPD/registered_all.txt" > "$TMPD/registered_ci_face.txt" || true
  comm -23 "$TMPD/all_ci_face.txt" "$TMPD/registered_ci_face.txt" > "$TMPD/unregistered_ci_face.txt"
  comm -23 "$TMPD/all_ts_face.txt" "$TMPD/registered_all.txt" > "$TMPD/unregistered_ts_face.txt"

  # REGISTRY-BASELINE 段 = 未登记测试存量棘轮（PATTERN-BASELINE 段由 A 模式读，此处跳过）
  awk '
    BEGIN { sec = "R" }
    /^[[:space:]]*#/ {
      line = $0
      sub(/^[[:space:]]*#[[:space:]]*/, "", line)
      if (line ~ /^═+[[:space:]]*PATTERN-BASELINE/)  { sec = "P"; next }
      if (line ~ /^═+[[:space:]]*REGISTRY-BASELINE/) { sec = "R"; next }
      next
    }
    /^[[:space:]]*$/ { next }
    sec == "R" { print }
  ' "$baseline" 2>/dev/null | tr -d '\r' | sed 's/[[:space:]]*$//' | sort -u > "$TMPD/baseline.txt"   # swallow-ok: 基线可读性已在上游 -f/-r 校验；无行=空基线 → 未登记项全判"新增"（红，不静默放行）

  comm -23 "$TMPD/unregistered_ci_face.txt" "$TMPD/baseline.txt" > "$TMPD/new_unregistered.txt"
  comm -13 "$TMPD/unregistered_ci_face.txt" "$TMPD/baseline.txt" > "$TMPD/stale_baseline.txt"

  local item
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    violation "新增测试未登记 CI 密封清单: ${item}"
  done < "$TMPD/new_unregistered.txt"
  while IFS= read -r item; do
    [ -n "$item" ] || continue
    violation "基线过期，须删条目: ${item}"
  done < "$TMPD/stale_baseline.txt"

  local n_all n_ci n_ts n_reg n_unreg n_base n_new n_stale
  n_all=$(wc -l < "$TMPD/all_tests.txt" | tr -d ' ')
  n_ci=$(wc -l < "$TMPD/all_ci_face.txt" | tr -d ' ')
  n_ts=$(wc -l < "$TMPD/all_ts_face.txt" | tr -d ' ')
  n_reg=$(wc -l < "$TMPD/registered_ci_face.txt" | tr -d ' ')
  n_unreg=$(wc -l < "$TMPD/unregistered_ci_face.txt" | tr -d ' ')
  n_base=$(wc -l < "$TMPD/baseline.txt" | tr -d ' ')
  n_new=$(wc -l < "$TMPD/new_unregistered.txt" | tr -d ' ')
  n_stale=$(wc -l < "$TMPD/stale_baseline.txt" | tr -d ' ')
  info "CI-REGISTRY: 测试文件 ${n_all}（密封面 sh/py ${n_ci}；ts 面 ${n_ts}）；ci.yml 登记（密封面）${n_reg}；密封面未登记 ${n_unreg}；基线 ${n_base} 条；基线外新增 ${n_new}；基线过期 ${n_stale}"
  info "CI-REGISTRY: NOTE unregistered-ts=$(wc -l < "$TMPD/unregistered_ts_face.txt" | tr -d ' ')（vitest glob 自动覆盖，不计密封面违规）"
  SUM_REG_SEALED="$n_ci"; SUM_REG_LISTED="$n_reg"; SUM_REG_UNREG="$n_unreg"; SUM_REG_BASE="$n_base"
  if [ "$VERBOSE" = 1 ]; then
    while IFS= read -r item; do
      [ -n "$item" ] || continue
      vprint "  UNREGISTERED(sealed): ${item}"
    done < "$TMPD/unregistered_ci_face.txt"
  fi
}

# ═══ C 既有红基线对账 ════════════════════════════════════════════════════════

run_ci_reds() { # $1 = check-runs JSON
  local json="$1"
  local red_base="${SYNO_CI_RED_BASELINE:-$ROOT/scripts/control-tower/ci-red-baseline.txt}"
  info ""
  info "── C 既有红基线对账（ratchet）──"
  # D954: 对账对象不可确定 → 不判定（显式 SKIPPED，可见；ratchet 未行使 ≠ 通过）
  #   绝不"拿不知来源的 JSON 判绿"——那正是 K3 定罪的空转形态（用未定态集合证明"无红"）。
  if [ -z "$BASE_REF" ]; then
    info "CI-RED-CHECK: SKIPPED (--ci-reds 已给但缺 --base-ref；对账对象不可确定 → ratchet 不判定，≠ 通过)"
    SUM_CIRED="SKIPPED(缺 --base-ref)"
    return 0
  fi
  local base_sha
  # 解析**针对 $ROOT（被审计的那棵树）**，不用进程 cwd —— 否则 `--root` 只定了基线、钉不住对账对象，
  # 仍会"读 A 树的基线、认 B 树的对账对象"。git 不可用/ref 不在该树 → 显式 degrade（fail-closed）。
  base_sha="$(git -C "$ROOT" rev-parse --verify --quiet "${BASE_REF}^{commit}" 2>/dev/null || true)"   # swallow-ok: 解析失败由下一行显式 degrade 兜住（不吞错）
  [ -n "$base_sha" ] || degrade "C_BASE_REF_UNRESOLVED" "ci-reds" "base-ref 不可解析: ${BASE_REF}（git -C ${ROOT} rev-parse --verify 失败）——对账对象不明，fail-closed 不判绿"
  # 对账对象行（ASCII 前缀「对账对象 」；ci.yml 证据步据此发布注解 → 证据自带对账对象身份）
  info "对账对象 = ${BASE_REF} @ ${base_sha}"
  [ -f "$json" ] || degrade "C_JSON_MISSING" "ci-reds" "check-runs JSON 不可读: $json"
  [ -f "$red_base" ] || degrade "C_RED_BASELINE_MISSING" "ci-reds" "CI 红基线缺失: $red_base"

  local failing="$TMPD/failing_names.txt"
  [ -n "$PYBIN" ] || degrade "C_NO_PYTHON" "ci-reds" "python 不可用（PYBIN 三级探测失败）——check-runs JSON 解析无法执行"
  if ! "$PYBIN" - "$json" > "$failing" 2>"$TMPD/json.err" <<'PYEOF'
import json
import sys

try:
    with open(sys.argv[1], encoding='utf-8') as fh:
        data = json.load(fh)
except Exception as exc:                       # noqa: BLE001 — 任何读取/解析失败都 fail-closed
    sys.stderr.write("json parse error: %s\n" % exc)
    sys.exit(3)
if not isinstance(data, dict):
    sys.stderr.write("json root not object\n")
    sys.exit(3)
runs = data.get('check_runs')
if not isinstance(runs, list):
    sys.stderr.write("check_runs missing or not list\n")
    sys.exit(3)
names = sorted({str(r.get('name', '')) for r in runs
                if isinstance(r, dict) and r.get('conclusion') == 'failure'})
for name in names:
    if name:
        print(name)
PYEOF
  then
    local jerr
    jerr="$(tr '\n' ' ' < "$TMPD/json.err" 2>/dev/null | cut -c1-200)"   # swallow-ok: 仅取诊断文本；读不到时 ${jerr:-unknown} 兜底，exit 2 判据不受影响
    degrade "C_JSON_INVALID" "ci-reds" "check-runs JSON 非法: ${json}（${jerr:-unknown}）"
  fi

  local red_norm="$TMPD/red_baseline.txt"
  # 归一：去注释/空行；tr -d '\r'；两侧 trim（数据行不得依赖缩进）
  grep -v '^[[:space:]]*#' "$red_base" 2>/dev/null | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' > "$red_norm" || true   # swallow-ok: 红基线存在性已在上游校验；无行=空登记表 → 所有失败项判"未登记"（红，不静默放行）

  local today name line expires owner due matched=0 n_fail=0 n_due=0
  today="$(date -u +%F)"
  while IFS= read -r name; do
    name="$(printf '%s' "$name" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -n "$name" ] || continue
    n_fail=$((n_fail + 1))
    # C1 修复: name 后 `|` 前可带空格（冻结格式 `CHECK_NAME | first_seen=...`），name 内正则元字符转义
    line="$(grep -E -m1 -- "^$(_re_escape "$name")[[:space:]]*\|" "$red_norm" 2>/dev/null || true)"
    if [ -z "$line" ]; then
      violation "未登记 CI 失败: ${name}"
      continue
    fi
    matched=$((matched + 1))
    # C2 修复: **按键取值**（不按字段序号——冻结格式里 $2 是 first_seen，不是 expires）
    expires="$(_key_value "$line" expires)"
    owner="$(_key_value "$line" owner)"
    due="$(_key_value "$line" disposition_due)"
    if [ -z "$expires" ]; then
      degrade "C_RED_BASELINE_NO_EXPIRES" "ci-reds" "CI 红基线条目缺 expires 键（不可静默当 0）: ${name}"
    fi
    vprint "  CI-RED-BASELINE: ${name}（owner=${owner:-未记}；expires=${expires}）"
    if [[ "$expires" < "$today" ]]; then
      violation "CI 红基线过期（须修或延期）: ${name}（expires ${expires} < ${today}）"
    fi
    # D954: disposition_due = **处置期限**，与 expires 同级硬门（逾期判红）。
    #   键**缺失不判**（存量条目不回溯；缺 expires 仍按既有规则 exit 2 —— 两者语义不同）。
    if [ -n "$due" ]; then
      vprint "  CI-RED-BASELINE: ${name}（disposition_due=${due}）"
      if [[ "$due" < "$today" ]]; then
        n_due=$((n_due + 1))
        violation "CI 红处置逾期（disposition_due 硬门）: ${name}（disposition_due ${due} < ${today}）"
      fi
    fi
  done < "$failing"

  info "CI-RED-CHECK: 失败检查 ${n_fail} 项；基线命中 ${matched} 项；基线条目 $(wc -l < "$red_norm" | tr -d ' ') 条；今天 ${today}；处置逾期 ${n_due} 项"
  SUM_CIRED="失败检查 ${n_fail} 项；基线命中 ${matched} 项；处置逾期 ${n_due} 项"
}

# ═══ 主流程 ═══════════════════════════════════════════════════════════════════

DO_PATTERNS=0; DO_REGISTRY=0; CI_REDS=""; BASE_REF=""; VERBOSE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --patterns-only) DO_PATTERNS=1 ;;
    --registry-only) DO_REGISTRY=1 ;;
    --ci-reds)
      CI_REDS="${2:-}"
      [ -n "$CI_REDS" ] || { usage >&2; degrade "USAGE_ARGS" "args" "--ci-reds 缺少 <json> 参数"; }
      shift
      ;;
    --ci-reds=*) CI_REDS="${1#--ci-reds=}" ;;
    --base-ref)
      BASE_REF="${2:-}"
      [ -n "$BASE_REF" ] || { usage >&2; degrade "USAGE_ARGS" "args" "--base-ref 缺少 <ref> 参数"; }
      shift
      ;;
    --base-ref=*) BASE_REF="${1#--base-ref=}" ;;
    --root) shift ;;                      # 已在文件头预扫生效（定根必须先于 ROOT 解析）
    --root=*) ;;                          # 同上
    --verbose) VERBOSE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; degrade "USAGE_ARGS" "args" "未知参数: $1" ;;
  esac
  shift
done
if [ "$DO_PATTERNS" = 0 ] && [ "$DO_REGISTRY" = 0 ]; then DO_PATTERNS=1; DO_REGISTRY=1; fi

info "GATE-INTEGRITY-CHECK: patterns=${DO_PATTERNS} registry=${DO_REGISTRY} ci_reds=$([ -n "$CI_REDS" ] && echo 1 || echo 0) base_ref=${BASE_REF:-<未提供>} root=${ROOT}"

[ "$DO_PATTERNS" = 1 ] && run_patterns
[ "$DO_REGISTRY" = 1 ] && run_registry
if [ -n "$CI_REDS" ]; then
  run_ci_reds "$CI_REDS"
else
  info ""
  info "CI-RED-CHECK: SKIPPED (no --ci-reds；CI job 提供)"
fi

info ""
if [ "$VIOLATIONS" -gt 0 ]; then
  write_step_summary "VIOLATION(${VIOLATIONS})"
  printf 'GATE-INTEGRITY: VIOLATION(%d)\n' "$VIOLATIONS"
  exit 1
fi
write_step_summary "OK"
printf 'GATE-INTEGRITY: OK\n'
exit 0
