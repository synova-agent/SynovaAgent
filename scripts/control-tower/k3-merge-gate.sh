#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# k3-merge-gate.sh — D923: K3 必经合并门禁（判定器）
#
# 政策（类目映射，外置可审）: scripts/control-tower/k3-gate-policy.yaml
# 说明文档: docs/synova/coordination/门禁说明-K3必经门禁-20260923.md
#
# 语义（CTO 裁定 3）:
#   · 命中三类路径的变更 → 必须有 K3 结论；PASS → 绿
#   · CONDITIONAL PASS / FAIL / NOT-AUDITABLE → 红 + 附理由（"有条件通过 = 未通过"）
#   · 非 K3 结论（tag 锚点/DONE/CTO 人工验收）→ 红（NOT_K3）
#   · 无结论 → 红 + "K3 排队中"提示（fail-closed）
#   · 非三类路径 → 20% 抽样，**永不阻断，只记录**
#
# 契约:
#   @input   — [--base <ref> --head <ref> --pr <号>]（PR 模式，CI 用）
#              | [--dir <路径>]（全扫盘点模式）
#              [--state-dir <目录>]（task-state/ 所在根；夹具注入用，默认仓库根）
#              [--policy <文件>] [--verbose]
#              注入缝（测试）: SYNO_K3_GREP / SYNO_K3_GIT
#   @output  — stdout: 判定摘要 + 命中清单 + 三路 D# 归因；末行
#              "K3-GATE: PASS | REJECT(<原因码>) | DEGRADED"
#              ::notice / ::warning 注解（可归因）
#   @exit    — 0 = 通过（绿）；1 = 拒绝（红）；2 = 检查执行失败/降级（fail-closed，绝不等同通过）
#              ⚠️ 裁定 3：**三类路径命中时，即使整体降级也必须是红（非 0）**——
#                 实现方式：**降级恒 `exit 2`**（本脚本 11 个 `degrade` 调用点**全部**立即 `exit 2`；2 非 0 ⇒ fail-closed）。
#                 更正（自验修复 F-5）：原注写「降级路径若已判定三类命中，则 exit 1（先红后降级提示）」——
#                 **该分支不可达**：所有降级判定都发生在「取变更集 / 读 policy / 读 task-state」阶段，
#                 早于三类命中判定，不可能"已知三类命中"再降级。已改为与实际行为一致的表述，**未改代码行为**。
#   @degraded— 结论源/仓库/policy 不可读 → stderr "degraded: <原因>" + ::warning
#              + 追加 <state-dir>/.codex/control-tower/logs/degraded-events.log（铁律 11）
#   @error   — .code = K3_GATE_SCAN_UNAVAILABLE | K3_GATE_POLICY_UNREADABLE | K3_GATE_STATE_UNREADABLE
#              .phase = 'scan'|'policy'|'state' ; .retryable = 布尔（铁律 32）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

MODE="diff"
BASE_REF=""; HEAD_REF=""; PR_NUM=""; TARGET_DIR="$REPO_DIR"; STATE_DIR="$REPO_DIR"
POLICY_FILE="$SCRIPT_DIR/k3-gate-policy.yaml"; VERBOSE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base)      BASE_REF="${2:-}"; shift 2 ;;
    --head)      HEAD_REF="${2:-}"; shift 2 ;;
    --pr)        PR_NUM="${2:-}"; shift 2 ;;
    --dir)       MODE="full"; TARGET_DIR="${2:-}"; shift 2 ;;
    --state-dir) STATE_DIR="${2:-}"; shift 2 ;;
    --policy)    POLICY_FILE="${2:-}"; shift 2 ;;
    --verbose)   VERBOSE=1; shift ;;
    -h|--help)   sed -n '5,42p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

GREP_BIN="${SYNO_K3_GREP:-grep}"
GIT_BIN="${SYNO_K3_GIT:-git}"
PYBIN=""
for c in python3 python py; do command -v "$c" >/dev/null 2>&1 && PYBIN="$c" && break; done

DEGRADED=0
degrade() { # <code> <原因> [phase]
  local code="$1" reason="$2" phase="${3:-scan}"
  DEGRADED=1
  echo "degraded: $reason (code=$code phase=$phase retryable=false)" >&2
  echo "::warning title=K3门禁降级::$reason (code=$code)"
  mkdir -p "$STATE_DIR/.codex/control-tower/logs" 2>/dev/null || true
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"k3-merge-gate\", \"code\": \"$code\", \"reason\": \"$reason\"}" \
    >> "$STATE_DIR/.codex/control-tower/logs/degraded-events.log" 2>/dev/null || true
}

command -v "$GREP_BIN" >/dev/null 2>&1 || { degrade K3_GATE_SCAN_UNAVAILABLE "grep 不可用: $GREP_BIN"; echo "K3-GATE: DEGRADED"; exit 2; }
printf 'probe\n' | "$GREP_BIN" -q 'probe' || { degrade K3_GATE_SCAN_UNAVAILABLE "grep 试运行失败: $GREP_BIN"; echo "K3-GATE: DEGRADED"; exit 2; }
[ -n "$PYBIN" ] || { degrade K3_GATE_SCAN_UNAVAILABLE "python3 不可用（读 policy / task-state 必需）"; echo "K3-GATE: DEGRADED"; exit 2; }
[ -f "$POLICY_FILE" ] || { degrade K3_GATE_POLICY_UNREADABLE "policy 不存在: $POLICY_FILE" policy; echo "K3-GATE: DEGRADED"; exit 2; }
[ -d "$STATE_DIR/task-state" ] || { degrade K3_GATE_STATE_UNREADABLE "task-state 目录不存在: $STATE_DIR/task-state" state; echo "K3-GATE: DEGRADED"; exit 2; }

# ── 取变更集 ────────────────────────────────────────────────────────────────
FILES_LIST="$(mktemp)"; trap 'rm -f "$FILES_LIST"' EXIT
if [ "$MODE" = "full" ]; then
  ( cd "$TARGET_DIR" && "$GIT_BIN" ls-files ) > "$FILES_LIST" 2>/dev/null || {
    degrade K3_GATE_SCAN_UNAVAILABLE "git ls-files 失败: $TARGET_DIR"; echo "K3-GATE: DEGRADED"; exit 2; }
else
  [ -n "$BASE_REF" ] && [ -n "$HEAD_REF" ] || { degrade K3_GATE_SCAN_UNAVAILABLE "PR 模式需 --base 与 --head"; echo "K3-GATE: DEGRADED"; exit 2; }
  "$GIT_BIN" -C "$TARGET_DIR" rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || { degrade K3_GATE_SCAN_UNAVAILABLE "base 无法解析: $BASE_REF"; echo "K3-GATE: DEGRADED"; exit 2; }
  "$GIT_BIN" -C "$TARGET_DIR" rev-parse --verify "$HEAD_REF" >/dev/null 2>&1 || { degrade K3_GATE_SCAN_UNAVAILABLE "head 无法解析: $HEAD_REF"; echo "K3-GATE: DEGRADED"; exit 2; }
  "$GIT_BIN" -C "$TARGET_DIR" -c core.quotepath=false diff --name-only --diff-filter=AM "$BASE_REF".."$HEAD_REF" 2>/dev/null > "$FILES_LIST" || {
    degrade K3_GATE_SCAN_UNAVAILABLE "git diff 失败: $BASE_REF..$HEAD_REF"; echo "K3-GATE: DEGRADED"; exit 2; }
fi
CHANGED=$(wc -l < "$FILES_LIST" | tr -d ' \n\r'); [ -z "$CHANGED" ] && CHANGED=0

# ── policy 抽取（无 pyyaml：定向抽取本检查器需要的少数键）───────────────
POLICY_OUT="$("$PYBIN" - "$POLICY_FILE" "$FILES_LIST" <<'PY' 2>/dev/null  # swallow-ok: 抽取失败→空值→下方显式判 degraded（不静默、不放行）
import re, sys
pol, flist = sys.argv[1], sys.argv[2]
txt = open(pol, encoding='utf-8').read()
def sect(name):
    m = re.search(rf"^  {name}:\n(.*?)(?=^  [A-Za-z_]+:|\Z)", txt, re.M | re.S)
    return m.group(1) if m else ""
def globs(block):
    m = re.search(r"^    globs:\n((?:      - .*\n)+)", block, re.M)
    return [l.strip()[2:].strip().strip('"') for l in m.group(1).splitlines()] if m else []
def exact(block):
    m = re.search(r"^    exact_files:\n((?:      - .*\n)+)", block, re.M)
    return [l.strip()[2:].strip().strip('"') for l in m.group(1).splitlines()] if m else []
def extra(block):
    m = re.search(r"^    extra_globs:\n(.*?)(?=^    [a-z_]+:|\Z)", block, re.M | re.S)
    return globs("  X:\n" + m.group(1).replace("      globs:", "    globs:")) if m else []
def excludes(block):
    # <规则>.exclude —— 该规则的自排除面。
    # L9（D923 收尾）：此前 policy 已声明 B_finance.exclude 但**抽取器从未消费** ⇒ 声明与实现不一致。
    # 现按「声明即生效」实现（排除项与规则标签绑定，见下方 match3 的 rule_excluded）。
    m = re.search(r"^    exclude:\n((?:      - .*\n)+)", block, re.M)
    return [l.strip()[2:].strip().strip('"') for l in m.group(1).splitlines()] if m else []
def pick_excl(block):
    # C_storage.pickaxe.exclude_globs —— pickaxe 扫描面排除（6 空格键 / 8 空格条目）
    m = re.search(r"^      exclude_globs:\n((?:        - .*\n)+)", block, re.M)
    return [l.strip()[2:].strip().strip('"') for l in m.group(1).splitlines()] if m else []
A, B, C = sect("A_security"), sect("B_finance"), sect("C_storage")
pat = ""
m = re.search(r"^      pattern:\s*\"?([^\"\n]+)\"?", C, re.M)
if m: pat = m.group(1).strip()
# 规则标签随 pattern 一并输出 —— 缺陷 B（红必须可归因）：命中的是「哪条规则」要能写出来
def emit(label, pats, excls):
    for g in pats:
        print("RULE\t" + label + "|" + g)
    for e in excls:
        print("EXCL\t" + label + "|" + e)
emit("A_security.globs", globs(A), excludes(A))
emit("A_security.exact_files", exact(A), excludes(A))
emit("A_security.extra_globs", extra(A), excludes(A))
emit("B_finance.globs", globs(B), excludes(B))
emit("C_storage.globs", globs(C), excludes(C))
for g in pick_excl(C):
    print("PICKEXCL\t" + g)
if pat: print("PICKAXE\t" + pat)
sys.exit(0)
PY
)"
RULE_PATTERNS="$(printf '%s\n' "$POLICY_OUT" | "$GREP_BIN" '^RULE' | cut -f2- || true)"
RULE_EXCLUDES="$(printf '%s\n' "$POLICY_OUT" | "$GREP_BIN" '^EXCL' | cut -f2- || true)"
PICKAXE_PAT="$(printf '%s\n' "$POLICY_OUT" | "$GREP_BIN" '^PICKAXE' | cut -f2- || true)"
PICK_EXCL_POLICY="$(printf '%s\n' "$POLICY_OUT" | "$GREP_BIN" '^PICKEXCL' | cut -f2- || true)"
if [ -z "$RULE_PATTERNS" ]; then
  degrade K3_GATE_POLICY_UNREADABLE "policy 未抽出任何类目规则（文件损坏或格式变更）: $POLICY_FILE" policy
  echo "K3-GATE: DEGRADED"; exit 2
fi

# pickaxe 扫描面排除（缺陷 A 修复 · D923 收尾任务 0）:
#   ① docs/** tests/** *.md —— 文档/证据正文含 DDL 字面量（本卡首轮实测，非真 DDL 变更）
#   ② policy C_storage.pickaxe.exclude_globs —— **门禁自身产物**（判定器 + policy）。
#      理由与可核命令在 policy 的 exclude_globs_reason / exclude_globs_evidence：两者以"数据"形式
#      承载 DDL 模式字面量（YAML cmd 证据串 / pattern 常量 / reason 散文 / shell 注释），
#      且无任何真实 DB 执行能力（探测 `sqlite3|.prepare(|.exec(|new Database` 命中 **2** 处，
#      两处**均为本判据自身的文本（自指）**：policy 的 cmd 串 + 本行注释）⇒ 不可能产生真 DDL 变更。
#      不加此排除时，任何触碰门禁文件的 PR 都会被 pickaxe 误红（长期运营缺陷）。
PICK_EXCLUDES=( ':(exclude)docs/**' ':(exclude)tests/**' ':(exclude)*.md' )
while IFS= read -r pex; do
  [ -z "$pex" ] && continue
  PICK_EXCLUDES[${#PICK_EXCLUDES[@]}]=":(exclude)${pex}"
done <<< "$PICK_EXCL_POLICY"

# 三类匹配：把 policy 的 glob 转成 git-pathspec 语义的 shell 匹配（`**` → 任意层级）
# RULE_PATTERNS 每行形如 `<规则标签>|<pattern>`；命中时把标签写入 MATCH_RULE（缺陷 B：可归因）
# RULE_EXCLUDES 每行形如 `<规则标签>|<exclude-glob>`；命中该规则但落在此面内 → 不算命中（L9：声明即生效）
glob_hit() { # <相对路径> <pattern> → 0=命中
  local f="$1" pat="$2"
  case "$pat" in
    *"/**") case "$f" in "$(printf '%s' "${pat%/**}")"/*) return 0 ;; esac ;;
    *\**)
      local core="${pat#\*\*\/}"; core="${core#\*}"
      case "$f" in *"${core%\*}"*) return 0 ;; esac ;;
    *) [ "$f" = "$pat" ] && return 0 ;;
  esac
  return 1
}
rule_excluded() { # <相对路径> <规则标签> → 0=被该规则的 exclude 排除
  local f="$1" want="$2" line
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      "$want|"*) glob_hit "$f" "${line#*|}" && return 0 ;;
    esac
  done <<< "$RULE_EXCLUDES"
  return 1
}
match3() { # <相对路径> → 0=命中三类（MATCH_RULE=规则标签）
  local f="$1" rule
  MATCH_RULE=""
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    rule="${pat%%|*}"; pat="${pat#*|}"
    if glob_hit "$f" "$pat"; then
      if rule_excluded "$f" "$rule"; then continue; fi
      MATCH_RULE="$rule"; return 0
    fi
  done <<< "$RULE_PATTERNS"
  return 1
}

HIT3=""   # 逐行 `<规则标签>|<路径>`（只含 glob/exact 命中；pickaxe 命中另存，缺陷 B）
while IFS= read -r f; do
  [ -z "$f" ] && continue
  MATCH_RULE=""
  if match3 "$f"; then HIT3="${HIT3}${MATCH_RULE}|${f}"$'\n'; fi
done < "$FILES_LIST"

HIT3_GLOB_N=0
[ -n "$HIT3" ] && HIT3_GLOB_N=$(printf '%s' "$HIT3" | "$GREP_BIN" -c . | tr -d ' \n\r' || true)
[ -z "$HIT3_GLOB_N" ] && HIT3_GLOB_N=0

# pickaxe：本次 diff 是否增删 DDL 行（只认"本次变更"语义）
# 缺陷 A 修复（任务 0）: 扫描面在 docs/tests/md 之外**再排除门禁自身产物**（policy exclude_globs）
# 缺陷 B 修复（任务 0）: 保留命中文件清单（PICK_HIT_LIST）以便逐条归因，不再只留计数
PICK_HIT_LIST=""
if [ "$MODE" = "diff" ] && [ -n "$PICKAXE_PAT" ]; then
  PICK_HIT_LIST="$("$GIT_BIN" -C "$TARGET_DIR" -c core.quotepath=false diff -G"$PICKAXE_PAT" --name-only "$BASE_REF".."$HEAD_REF" -- . "${PICK_EXCLUDES[@]}" 2>/dev/null || true)"
fi
PICK_HIT=0
[ -n "$PICK_HIT_LIST" ] && PICK_HIT=$(printf '%s' "$PICK_HIT_LIST" | "$GREP_BIN" -c . | tr -d ' \n\r' || true)
[ -z "$PICK_HIT" ] && PICK_HIT=0
HIT3_N=$((HIT3_GLOB_N + PICK_HIT))

# ── D# 解析（三路，**必须可归因**）────────────────────────────────────────
BRANCH="$("$GIT_BIN" -C "$TARGET_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
BRANCH_ARG="${GITHUB_HEAD_REF:-$BRANCH}"
SRC1=""; SRC2=""; SRC3=""
SRC1="$(printf '%s' "$BRANCH_ARG" | "$GREP_BIN" -oiE 'D[0-9]+' | tr 'a-z' 'A-Z' | sort -u | tr '\n' ' ' || true)"
[ -z "$SRC1" ] && SRC1="$(printf '%s' "$BRANCH_ARG" | "$GREP_BIN" -oiE 'D[0-9]+' | tr 'a-z' 'A-Z' | sort -u | tr '\n' ' ' || true)"
# 第二路必须扫**整个变更集**（而非仅三类命中）——brief 文件本身不属三类路径
BRIEF_FILES="$("$GREP_BIN" -E '^\.claude/task-briefs/.*-[Dd][0-9]+-.*\.md$' "$FILES_LIST" || true)"
for bf in $BRIEF_FILES; do
  d="$(basename "$bf" | "$GREP_BIN" -oiE 'D[0-9]+' | head -1 | tr 'a-z' 'A-Z' || true)"; [ -n "$d" ] && SRC2="${SRC2}${d} "
done
SRC2="$(printf '%s' "$SRC2" | tr ' ' '\n' | sort -u | "$GREP_BIN" -v '^$' | tr '\n' ' ' || true)"
if [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "${GITHUB_EVENT_PATH:-}" ]; then
  SRC3="$("$PYBIN" -c "
import json,sys,re
try:
    d=json.load(open(sys.argv[1],encoding='utf-8'))
    b=((d.get('pull_request') or {}).get('body') or '')
    print(' '.join(sorted(set(re.findall(r'D[0-9]+', b)))))
except Exception: print('')
" "$GITHUB_EVENT_PATH" 2>/dev/null || true)"
fi
DS="$(printf '%s %s %s' "$SRC1" "$SRC2" "$SRC3" | tr ' ' '\n' | sort -u | "$GREP_BIN" -v '^$' | tr '\n' ' ' || true)"

# ── 结论读取（task-state 优先；报告正文子串兜底）──────────────────────────
read_verdict() { # <D#> → 归一码 或 empty
  local d="$1"
  "$PYBIN" - "$STATE_DIR" "$d" <<'PY' 2>/dev/null  # swallow-ok: 读取失败→空→按 NO_VERDICT 处理（fail-closed 转红，不静默放行）
import json, sys, re, glob, os
state, did = sys.argv[1], sys.argv[2]
card = os.path.join(state, "task-state", f"{did}.json")
card_alt = None
if not os.path.isfile(card):
    for f in glob.glob(os.path.join(state, "task-state", "*.json")):
        try:
            if (json.load(open(f, encoding='utf-8')).get('task_id') or '').strip() == did:
                card_alt = f; break
        except Exception: pass
card = card if os.path.isfile(card) else card_alt
raw = None
if card:
    try: raw = json.load(open(card, encoding='utf-8')).get('audit')
    except Exception: raw = None
v = None
if isinstance(raw, dict): v = raw.get('verdict')
elif isinstance(raw, str): v = raw
M = {
 'PASS':'PASS','pass':'PASS',
 'CONDITIONAL PASS':'CONDITIONAL_PASS','CONDITIONAL_PASS':'CONDITIONAL_PASS',
 'FAIL':'FAIL',
 'NOT-AUDITABLE':'NOT_AUDITABLE','NOT_AUDITABLE':'NOT_AUDITABLE',
 '无 K3（V5.1.3 tag 锚点闭环）':'NOT_K3','DONE':'NOT_K3','CTO 验收通过（非 K3）':'NOT_K3',
}
if v is not None and str(v).strip() in M:
    print(M[str(v).strip()]); raise SystemExit
# 报告正文兜底（既有唯一约定: CONDITIONAL PASS > PASS > FAIL > ?）
for f in sorted(glob.glob(os.path.join(state, 'docs/synova/audit-reports/*.md'))):
    m = re.search(r'D\d+', os.path.basename(f))
    if m and m.group(0) == did:
        try: txt = open(f, encoding='utf-8', errors='replace').read()
        except Exception: continue
        if 'CONDITIONAL PASS' in txt: print('CONDITIONAL_PASS'); raise SystemExit
        if 'PASS' in txt: print('PASS'); raise SystemExit
        if 'FAIL' in txt: print('FAIL'); raise SystemExit
        print('NO_VERDICT'); raise SystemExit
print('NO_VERDICT')
PY
}

echo "[k3-gate] mode=$MODE changed=$CHANGED three_category_hits=$HIT3_N (glob=$HIT3_GLOB_N pickaxe=$PICK_HIT)"
echo "[k3-gate] D# 归因 → ①分支名(${BRANCH_ARG})：[${SRC1:-无}] ②brief 文件名：[${SRC2:-无}] ③PR 正文：[${SRC3:-无}] ⇒ 采用：[${DS:-无}]"

# 缺陷 B 修复（任务 0 · CTO「红必须可归因」）：glob 与 pickaxe 两类命中**逐条列出**并标明规则来源
print_hits() {
  echo "[k3-gate] 三类命中清单（glob ${HIT3_GLOB_N} 项 / pickaxe ${PICK_HIT} 项）："
  if [ "$HIT3_GLOB_N" -gt 0 ]; then
    printf '%s' "$HIT3" | while IFS= read -r h; do
      [ -z "$h" ] && continue
      echo "  - (glob) ${h#*|}   ← 规则 ${h%%|*}"
    done
  fi
  if [ "$PICK_HIT" -gt 0 ]; then
    printf '%s\n' "$PICK_HIT_LIST" | while IFS= read -r h; do
      [ -z "$h" ] && continue
      echo "  - (pickaxe) $h   ← 规则 C_storage.pickaxe（本次 diff 增删 DDL 行）"
    done
  fi
}
if [ "$HIT3_N" -gt 0 ]; then print_hits; fi
if [ "$VERBOSE" = "1" ]; then
  echo "[k3-gate] verbose: pickaxe 排除面 = ${PICK_EXCLUDES[*]}"
fi

if [ "$HIT3_N" -eq 0 ]; then
  # 非三类 → 20% 抽样，**永不阻断，只记录**
  if [ -n "$PR_NUM" ] && [ "$PR_NUM" -eq "$PR_NUM" ] 2>/dev/null; then
    if [ $((PR_NUM % 5)) -eq 0 ]; then
      echo "::notice title=K3抽样::PR #$PR_NUM 抽中 20% 抽样（PR号%5==0）——记录性覆盖，不阻断"
      echo "[k3-gate] 抽样命中（非三类路径）——永不阻断"
    fi
  fi
  [ "$DEGRADED" -eq 1 ] && { echo "K3-GATE: DEGRADED"; exit 2; }
  echo "K3-GATE: PASS"
  exit 0
fi

# 三类命中 → 必须有结论
if [ -z "$DS" ]; then
  echo "::error title=K3门禁::三类路径命中但**三路均未能识别卡号**（分支名/brief 文件名/PR 正文皆无 D#）⇒ 无结论 = 红"
  echo "[k3-gate] 出口：在 PR 正文或分支名写明卡号 D#；或由 CTO 具名豁免（写入卡/PR，可核）"
  echo "K3-GATE: REJECT(NO_CARD_ID)"
  exit 1
fi

WORST=""; REASONS=""
for d in $DS; do
  code="$(read_verdict "$d")"; [ -z "$code" ] && code="NO_VERDICT"
  case "$code" in
    PASS) ;;
    CONDITIONAL_PASS) WORST="REJECT"; REASONS="${REASONS}${d}: CONDITIONAL PASS —— 有条件通过 = 未通过；" ;;
    FAIL)             WORST="REJECT"; REASONS="${REASONS}${d}: FAIL —— K3 判失败；" ;;
    NOT_AUDITABLE)    WORST="REJECT"; REASONS="${REASONS}${d}: NOT-AUDITABLE —— 不可审计 ≠ 通过；" ;;
    NOT_K3)           WORST="REJECT"; REASONS="${REASONS}${d}: 非 K3 结论（tag 锚点/DONE/CTO 人工验收）不得充当 K3 通过；出口：补 K3 结论或 CTO 具名豁免；" ;;
    NO_VERDICT)       WORST="REJECT"; REASONS="${REASONS}${d}: 无 K3 结论 —— K3 排队中；出口：等结论或 CTO 具名豁免；" ;;
    *)                WORST="REJECT"; REASONS="${REASONS}${d}: 未知归一码 $code；" ;;
  esac
done

# 裁定 1 硬要求：归一动作**显式可见**（禁静默归一）——具名列出卡号
for d in $DS; do
  c="$(read_verdict "$d")"
  if [ "$c" = "PASS" ]; then
    raw="$("$PYBIN" -c "
import json,sys,glob,os
state,did=sys.argv[1],sys.argv[2]
for f in glob.glob(os.path.join(state,'task-state','*.json')):
    try: d=json.load(open(f,encoding='utf-8'))
    except Exception: continue
    if (d.get('task_id') or os.path.basename(f)[:-5])==did:
        a=d.get('audit'); v=a.get('verdict') if isinstance(a,dict) else a
        print(v if v is not None else 'null'); break
" "$STATE_DIR" "$d" 2>/dev/null || true)"
    case "$raw" in
      pass) echo "::notice title=K3归一::$d 的 verdict 原值为小写 'pass' —— 已显式归一为 PASS（非静默；待裁定 8 卡回填时统一）" ;;
    esac
  fi
done

if [ "$WORST" = "REJECT" ]; then
  echo "::error title=K3门禁::三类路径命中（${HIT3_N} 项）且卡内无通过级 K3 结论：$REASONS"
  echo "K3-GATE: REJECT($REASONS)"
  exit 1
fi

if [ "$DEGRADED" -eq 1 ]; then
  echo "K3-GATE: DEGRADED"; exit 2
fi
echo "K3-GATE: PASS"
exit 0
