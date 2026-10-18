#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-package-selfsufficiency.test.sh — CT-40 强制配对测试（W2 · Issue #566）
#
# 被测: scripts/control-tower/check-package-selfsufficiency.py（W1）
# 配对规则: scripts/{control-tower,workflow,hooks}/<name>.py ↔ tests/control-tower/<name>.test.sh
#
# 覆盖矩阵（铁律 48：正常 / 降级 / 边界）:
#   1  正常        全 ✅ fixture（2 包）⇒ exit 0 ＋ 每包 10 格全 ✅ ＋ SELFSUFFICIENCY: PASS
#   1b 中文包名    中文包名 fixture（真实命名形态）⇒ exit 0 ＋ signal=1（不依赖 ambient core.quotepath）
#   2  过滤        --packages P1 ⇒ 只出 P1 行（矩阵 1 行）
#   3  改坏        §三 删命令 token ⇒ exit 1 ＋ 第 ② 格 🔴（判别力；红只此一格）
#   4  缺节        删 §四 ⇒ exit 1 ＋ 第 ③ 格 🔴（缺节记 🔴，不跳过）
#   5  信号量==0   沙箱无 agents/ ⇒ exit 2 ＋ stderr degraded: ＋ signal=0
#   6  坏 ref      --ref 不存在 ⇒ exit 2 ＋ degraded:
#   7  不存在的包   --packages P9 ⇒ exit 2 ＋ degraded:
#   8  --json      合法 JSON（python3 -m json.tool）＋ matrix/gaps/manual_pending/summary/exit
#   9  真实仓       --selfcheck ⇒ exit 1 ＋ SELFCHECK-OK（B inner_exit=1；C inner_exit=2）
#   9b 判据⑧回归①  B999 只在被审包守则内 ⇒ ⑧ 🟡 ＋ exit 1 ＋ json pending=1（非自身命中，🟡 可达）
#   9c 判据⑧回归②  B7（他处有，先出现）＋ B999（仅自身）⇒ 仍 ⑧ 🟡（遍历全部 tokens，非只看首个）
#  10  只读证明    运行前后真实仓 git status --porcelain 不变
#
# 沙箱 = 系统临时目录（mktemp -d）；沙箱内 git init ＋ 写 fixture 包守则 ＋ commit。
# 🔴 不依赖/不硬编码真实仓库矩阵（dev doc §10：真实矩阵随包守则修复而变）。
# 不联网 · 不写真实仓 · 不 commit/stage。断言失败 ⇒ exit 1（禁吞错兜底）。
# 用法: bash tests/control-tower/check-package-selfsufficiency.test.sh
# 退出码: 0 = 全部通过；1 = 有失败（含 W1 未交付）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/check-package-selfsufficiency.py"
REL_TOOL="scripts/control-tower/check-package-selfsufficiency.py"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_exit() { # $1=期望 $2=实际 $3=名称
  if [ "$2" = "$1" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1，实际=$2"; fi
}
assert_contains() { # $1=输出 $2=ERE $3=名称
  if grep -qE "$2" <<<"$1"; then pass "$3"; else fail "$3 — 未匹配 /$2/"; fi
}
assert_not_contains() { # $1=输出 $2=ERE $3=名称
  if grep -qE "$2" <<<"$1"; then fail "$3 — 不应出现 /$2/"; else pass "$3"; fi
}

# ── 矩阵解析（只对 fixture 判，禁硬编码真实矩阵）──
matrix_row() { # $1=输出 $2=包名前缀 → 首个以该包名开头的行（矩阵在前，缺口清单在后）
  printf '%s\n' "$1" | awk -v p="$2" '{s=$0; sub(/^[[:space:]]+/,"",s); if (index(s,p)==1) {print; exit}}'
}
row_col() { # $1=行 $2=列号(1-10) → 该列 verdict
  printf '%s\n' "$1" | awk -v n="$2" '{c=0; for(i=1;i<=NF;i++){ if($i=="✅"||$i=="🔴"||$i=="🟡"){c++; if(c==n){print $i; exit}}}}'
}
data_rows() { # $1=输出 → 矩阵数据行数（包名 P<数字>-… 且带 verdict）
  local n
  n=$(printf '%s\n' "$1" | grep -cE '^[[:space:]]*P[0-9]+-[A-Za-z0-9_.-]+[[:space:]]+(✅|🔴|🟡)') || n=0
  printf '%s' "$n"
}
row_all_green() { # $1=行 → YES / NO(第n格=…)
  local n got out=YES
  for n in 1 2 3 4 5 6 7 8 9 10; do
    got="$(row_col "$1" "$n")"
    [ "$got" = "✅" ] || out="NO(第${n}格=${got:-缺})"
  done
  printf '%s' "$out"
}

# ── fixture 包守则（十项全绿基线；dev doc §5.1/§5.3）──
# 绿点依据：②③ 引用均真实存在；§三 有命令 token(bash)＋反例 token(改坏/必红)；
# §四 有文件级扩展名；§五 命中"不依赖"；§六 有含 / 的路径 token；
# §七 有 `…AGENTS.md` ＋ 标题"必须显式"；「事实落点」节在；全文有"四条件"；
# 全文无 B\d+ / \d+\.\d+ / K\d+-\d+（⑧ N/A）、无 handbook 行（⑨ N/A）。
good_agents() {
  cat <<'FIXTURE'
# AGENTS.md · fixture 包（包自足性审查用）

## 一、定位
配对测试用的 fixture 包，只服务审查脚本自身的判别力。

## 二、是什么
入口说明见 `README.md`，示例代码在 `src/example.ts`，自测脚本 `scripts/selftest.sh`。

## 三、怎么算完成
- 正常：运行 `bash scripts/selftest.sh` ⇒ exit 0。
- 反例：改坏 `scripts/selftest.sh` 末行 ⇒ 必红（exit 1）。

## 四、写集
- 写集（本包）：`src/example.ts`（已存在，仅示例）。

## 五、依赖
- 不依赖（fixture 自足，无外部前置）。

## 六、不做
- 不碰 `src/legacy/**`。

## 七、域守则（必须显式 read）
- `AGENTS.md`（本包守则＝判据真源）。

## 八、事实落点
- 本包事实落点＝本文件所在目录。

## 九、合并规则
- 合并走四条件（CI 绿／零写集重叠／已过独立复核／串行）。
FIXTURE
}

new_repo() { # $1=沙箱目录：git init ＋ 公共文件 ＋ P0 fixture 包 ＋ 首提交
  local d="$1"
  mkdir -p "$d/scripts/control-tower" "$d/src" "$d/agents/P0-selftest"
  cp "$TOOL" "$d/$REL_TOOL"
  printf 'fixture repo\n' > "$d/README.md"
  printf 'export const example = 1;\n' > "$d/src/example.ts"
  printf '#!/bin/bash\nexit 0\n' > "$d/scripts/selftest.sh"
  good_agents > "$d/agents/P0-selftest/AGENTS.md"
  git -C "$d" init -q
  git -C "$d" add -A
  git -C "$d" -c user.email=fixture@example.test -c user.name=fixture -c commit.gpgsign=false commit -qm "fixture: baseline"
}
add_package() { # $1=沙箱目录 $2=包目录名
  mkdir -p "$1/agents/$2"
  good_agents > "$1/agents/$2/AGENTS.md"
  git -C "$1" add -A
  git -C "$1" -c user.email=fixture@example.test -c user.name=fixture -c commit.gpgsign=false commit -qm "fixture: add $2"
}
commit_sandbox() { # $1=沙箱目录 $2=msg
  git -C "$1" add -A
  git -C "$1" -c user.email=fixture@example.test -c user.name=fixture -c commit.gpgsign=false commit -qm "$2"
}
run_tool() { # $1=沙箱目录，剩余=参数；输出 stdout+stderr；返回脚本 exit
  ( cd "$1" && shift && python3 "$REL_TOOL" "$@" 2>&1 )
}

# ── 前置：W1 必须存在（缺失 ⇒ 配对测试红，绝不自建）──
echo "═══════════════════════════════════════════════════════════════════"
echo "  P4 包自足性审查脚本 — CT-40 配对测试（W2 · Issue #566）"
echo "═══════════════════════════════════════════════════════════════════"
if [ ! -f "$TOOL" ]; then
  echo "❌ 被测脚本不存在: $TOOL" >&2
  echo "   W1（check-package-selfsufficiency.py）未交付 ⇒ CT-40 配对测试红（不自建、不跳过）" >&2
  echo "   结果: 0 通过, 1 失败 (W1 missing)"
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/p4-selfsufficiency-XXXXXX")"
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

# 只读证明：运行前快照（真实仓）
BEFORE="$(git -C "$REPO_DIR" status --porcelain)"

# ── 1. 正常：全 ✅ fixture（2 包）⇒ exit 0 ──
echo ""
echo "── 1. 正常：全 ✅ fixture（2 包）⇒ exit 0 ＋ 10 格全 ✅ ──"
GOOD="$TMP_ROOT/good"
new_repo "$GOOD"
add_package "$GOOD" "P1-sample"
EXIT=0
OUT=$(run_tool "$GOOD") || EXIT=$?
assert_exit 0 "$EXIT" "全 ✅ fixture ⇒ exit 0"
assert_contains "$OUT" 'SELFSUFFICIENCY: PASS' "汇总行 SELFSUFFICIENCY: PASS"
assert_contains "$OUT" 'signal=2' "汇总行 signal=2（发现 2 份包守则）"
assert_contains "$OUT" 'red=0' "汇总行 red=0"
ROWS="$(data_rows "$OUT")"
if [ "$ROWS" = "2" ]; then pass "矩阵数据行 = 2（P0/P1 各一行）"; else fail "矩阵数据行 = ${ROWS}（期望 2）"; fi
R0="$(matrix_row "$OUT" "P0-selftest")"
R1="$(matrix_row "$OUT" "P1-sample")"
if [ -n "$R0" ] && [ -n "$R1" ]; then pass "矩阵含 P0-selftest / P1-sample 两行"; else fail "矩阵缺包行（P0=${R0:-空} P1=${R1:-空}）"; fi
for row in "$R0" "$R1"; do
  G="$(row_all_green "$row")"
  if [ "$G" = "YES" ]; then pass "包行 10 格全 ✅"; else fail "包行非全 ✅：${G}｜行=${row}"; fi
done

# ── 1b. 中文包名（真实命名形态）⇒ discovery 不得依赖 ambient core.quotepath ──
echo ""
echo "── 1b. 中文包名 fixture ⇒ exit 0 ＋ signal=1（quotepath 无关性）──"
# 依据：真实仓包目录为中文（agents/P4-门禁…），dev doc §5.3 的 selfcheck fixture 亦为
# agents/P0-自测/AGENTS.md ⇒ 审查器必须在「干净仓」（core.quotepath 默认 true）下也能发现。
CN="$TMP_ROOT/cn-pkg"
mkdir -p "$CN/scripts/control-tower" "$CN/src" "$CN/agents/P1-样例"
cp "$TOOL" "$CN/$REL_TOOL"
printf 'fixture repo\n' > "$CN/README.md"
printf 'export const example = 1;\n' > "$CN/src/example.ts"
printf '#!/bin/bash\nexit 0\n' > "$CN/scripts/selftest.sh"
good_agents > "$CN/agents/P1-样例/AGENTS.md"
git -C "$CN" init -q
commit_sandbox "$CN" "fixture: chinese package name"
EXIT=0
OUT_CN=$(run_tool "$CN") || EXIT=$?
assert_exit 0 "$EXIT" "中文包名 fixture ⇒ exit 0（不依赖 ambient quotepath）"
assert_contains "$OUT_CN" 'signal=1' "中文包名被 discovery 发现（signal=1）"
assert_contains "$OUT_CN" '^[[:space:]]*P1-样例[[:space:]]+(✅|🔴|🟡)' "矩阵含 P1-样例 行"

# ── 2. --packages 过滤：只出请求的包 ──
echo ""
echo "── 2. --packages P1 过滤 ⇒ 只出 P1 行 ──"
EXIT=0
OUT_F=$(run_tool "$GOOD" --packages P1) || EXIT=$?
assert_exit 0 "$EXIT" "--packages P1 ⇒ exit 0"
ROWS_F="$(data_rows "$OUT_F")"
if [ "$ROWS_F" = "1" ]; then pass "--packages P1 ⇒ 矩阵 1 行"; else fail "--packages P1 ⇒ 矩阵 ${ROWS_F} 行（期望 1）"; fi
assert_contains "$OUT_F" '^[[:space:]]*P1-sample[[:space:]]+(✅|🔴|🟡)' "--packages P1 ⇒ 含 P1-sample 行"
assert_not_contains "$OUT_F" '^[[:space:]]*P0-selftest[[:space:]]+(✅|🔴|🟡)' "--packages P1 ⇒ 不含 P0 矩阵行"

# ── 3. 改坏：§三 删命令 token ⇒ exit 1 ＋ 第 ② 格 🔴 ──
echo ""
echo "── 3. 改坏：§三 无命令 token ⇒ exit 1 ＋ ② 🔴（判别力）──"
BAD="$TMP_ROOT/bad-cmd"
new_repo "$BAD"
python3 - "$BAD/agents/P0-selftest/AGENTS.md" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = re.sub(r"## 三、.*?(?=## 四、)", "## 三、怎么算完成\n- 结果须符合预期。\n\n", s, flags=re.S)
open(p, "w", encoding="utf-8").write(s)
PY
commit_sandbox "$BAD" "fixture: break section 3"
EXIT=0
OUT_B=$(run_tool "$BAD") || EXIT=$?
assert_exit 1 "$EXIT" "改坏 §三（删命令）⇒ exit 1"
RB="$(matrix_row "$OUT_B" "P0-selftest")"
C2="$(row_col "$RB" 2)"
if [ "$C2" = "🔴" ]; then pass "改坏 §三 ⇒ 第 ② 格 🔴"; else fail "改坏 §三 ⇒ 第 ② 格=${C2:-缺}（期望 🔴）"; fi
assert_contains "$OUT_B" 'SELFSUFFICIENCY: GAP' "汇总行 SELFSUFFICIENCY: GAP"
assert_contains "$OUT_B" 'red=1' "red=1（仅 ② 红）"
assert_contains "$OUT_B" 'exit=1' "汇总行 exit=1"

# ── 4. 缺节：删 §四 ⇒ exit 1 ＋ 第 ③ 格 🔴 ──
echo ""
echo "── 4. 缺节：删 §四 ⇒ exit 1 ＋ ③ 🔴（缺节记 🔴 不跳过）──"
MISS="$TMP_ROOT/missing-sec4"
new_repo "$MISS"
python3 - "$MISS/agents/P0-selftest/AGENTS.md" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = re.sub(r"## 四、.*?(?=## 五、)", "", s, flags=re.S)
open(p, "w", encoding="utf-8").write(s)
PY
commit_sandbox "$MISS" "fixture: drop section 4"
EXIT=0
OUT_M=$(run_tool "$MISS") || EXIT=$?
assert_exit 1 "$EXIT" "删 §四 ⇒ exit 1"
RM="$(matrix_row "$OUT_M" "P0-selftest")"
C3="$(row_col "$RM" 3)"
if [ "$C3" = "🔴" ]; then pass "删 §四 ⇒ 第 ③ 格 🔴"; else fail "删 §四 ⇒ 第 ③ 格=${C3:-缺}（期望 🔴）"; fi
assert_contains "$OUT_M" 'exit=1' "删 §四 ⇒ 汇总行 exit=1"

# ── 5. 信号量==0：沙箱无 agents/ ⇒ exit 2 ──
echo ""
echo "── 5. 信号量==0：沙箱无 agents/ ⇒ exit 2 ＋ degraded: ──"
EMPTY="$TMP_ROOT/empty"
mkdir -p "$EMPTY/scripts/control-tower"
cp "$TOOL" "$EMPTY/$REL_TOOL"
git -C "$EMPTY" init -q
commit_sandbox "$EMPTY" "fixture: no agents"
EXIT=0
OUT_E=$(run_tool "$EMPTY") || EXIT=$?
assert_exit 2 "$EXIT" "无 agents/（信号量==0）⇒ exit 2"
assert_contains "$OUT_E" 'degraded:' "降级必打 degraded:（铁律 11）"
assert_contains "$OUT_E" 'signal=0' "信号量==0 必须显式可见（禁把看不见当没问题）"

# ── 6. 坏 ref ⇒ exit 2 ──
echo ""
echo "── 6. 坏 ref ⇒ exit 2 ＋ degraded: ──"
EXIT=0
OUT_R=$(run_tool "$GOOD" --ref no-such-ref-do-not-exist) || EXIT=$?
assert_exit 2 "$EXIT" "--ref 不存在 ⇒ exit 2"
assert_contains "$OUT_R" 'degraded:' "坏 ref ⇒ degraded:"

# ── 7. 请求的包不存在 ⇒ exit 2 ──
echo ""
echo "── 7. --packages P9（fixture 中不存在）⇒ exit 2 ──"
EXIT=0
OUT_P=$(run_tool "$GOOD" --packages P9) || EXIT=$?
assert_exit 2 "$EXIT" "--packages P9 ⇒ exit 2"
assert_contains "$OUT_P" 'degraded:' "不存在的包 ⇒ degraded:"

# ── 8. --json 合法 ＋ 契约字段 ──
echo ""
echo "── 8. --json ⇒ 合法 JSON ＋ 契约字段 ──"
EXIT=0
JSON_OUT=$( ( cd "$GOOD" && python3 "$REL_TOOL" --json 2>/dev/null ) ) || EXIT=$?
assert_exit 0 "$EXIT" "--json ⇒ exit 0"
if printf '%s' "$JSON_OUT" | python3 -m json.tool > /dev/null 2>&1; then
  pass "--json 是合法 JSON（python3 -m json.tool）"
else
  fail "--json 非法 JSON（python3 -m json.tool 解析失败）"
fi
KEYS=$(printf '%s' "$JSON_OUT" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print("PARSE_FAIL:" + str(e)); sys.exit(0)
need = ["matrix", "gaps", "manual_pending", "summary", "exit"]
miss = [k for k in need if k not in d]
print("OK" if not miss else "MISSING:" + ",".join(miss))
' 2>&1)
if [ "$KEYS" = "OK" ]; then pass "--json 含 matrix/gaps/manual_pending/summary/exit"; else fail "--json 契约字段缺失（${KEYS}）"; fi

# ── 9. 真实仓 --selfcheck ⇒ exit 1 ＋ SELFCHECK-OK（快照式，不依赖真实矩阵）──
echo ""
echo "── 9. 真实仓 --selfcheck ⇒ exit 1 ＋ SELFCHECK-OK ──"
EXIT=0
OUT_S=$( ( cd "$REPO_DIR" && python3 "$REL_TOOL" --selfcheck 2>&1 ) ) || EXIT=$?
assert_exit 1 "$EXIT" "真实仓 --selfcheck ⇒ exit 1（成功语义，§5.3）"
assert_contains "$OUT_S" 'SELFCHECK-OK' "输出含 SELFCHECK-OK（改坏必红）"
# 断言锚定 [selfcheck] 子例行本身（禁匹配 SELFCHECK-FAIL 的说明文字 —— 假阳性）
assert_contains "$OUT_S" '^\[selfcheck\] A .*inner_exit=0' "A 子例基线 ⇒ inner_exit=0"
assert_contains "$OUT_S" '^\[selfcheck\] B .*inner_exit=1' "B 子例改坏 ⇒ inner_exit=1"
assert_contains "$OUT_S" '^\[selfcheck\] C .*inner_exit=2' "C 子例空仓 ⇒ inner_exit=2"

# ── 9b. 判据⑧ 回归①：编号只在被审文档自身 ⇒ 非自身 0 命中 ⇒ 🟡 可达 ──
echo ""
echo "── 9b. 判据⑧：B999 只在被审包守则内 ⇒ ⑧ 🟡 ＋ exit 1 ＋ json pending=1 ──"
# 依据：§5.1⑧「0 命中 ⇒ 🟡」。被审文档自身必含该编号 ⇒ 若不自排除则"0 命中"不可达、⑧ 空转。
SELFHIT="$TMP_ROOT/selfhit-only"
mkdir -p "$SELFHIT/scripts/control-tower" "$SELFHIT/src" "$SELFHIT/agents/P0-selftest"
cp "$TOOL" "$SELFHIT/$REL_TOOL"
printf 'fixture repo\n' > "$SELFHIT/README.md"
printf 'export const example = 1;\n' > "$SELFHIT/src/example.ts"
printf '#!/bin/bash\nexit 0\n' > "$SELFHIT/scripts/selftest.sh"
{ good_agents; printf '\n编号自查用 B999（仓内仅本文出现）。\n'; } > "$SELFHIT/agents/P0-selftest/AGENTS.md"
git -C "$SELFHIT" init -q
commit_sandbox "$SELFHIT" "fixture: number token only in self"
EXIT=0
OUT_SH=$(run_tool "$SELFHIT") || EXIT=$?
assert_exit 1 "$EXIT" "⑧ 非自身 0 命中 ⇒ exit 1（🟡 不视为通过）"
RSH="$(matrix_row "$OUT_SH" "P0-selftest")"
C8="$(row_col "$RSH" 8)"
if [ "$C8" = "🟡" ]; then pass "⑧ 非自身 0 命中 ⇒ 第 ⑧ 格 🟡（待人工可达）"; else fail "⑧ 非自身 0 命中 ⇒ 第 ⑧ 格=${C8:-缺}（期望 🟡）"; fi
assert_contains "$OUT_SH" 'pending=1' "汇总行 pending=1"
EXIT_J=0
JSON_SH=$( ( cd "$SELFHIT" && python3 "$REL_TOOL" --json 2>/dev/null ) ) || EXIT_J=$?
assert_exit 1 "$EXIT_J" "⑧ 🟡 ⇒ --json exit 1"
JSUM=$(printf '%s' "$JSON_SH" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print("PARSE_FAIL:" + str(e)); sys.exit(0)
s = d.get("summary", {})
print("pending=%s,red=%s,exit=%s" % (s.get("pending"), s.get("red"), d.get("exit")))
' 2>&1)
if [ "$JSUM" = "pending=1,red=0,exit=1" ]; then pass "⑧ 🟡 ⇒ json summary pending=1 red=0 exit=1"; else fail "⑧ 🟡 ⇒ json summary=${JSUM}（期望 pending=1,red=0,exit=1）"; fi

# ── 9c. 判据⑧ 回归②：遍历全部 tokens（首个命中、其后未命中 ⇒ 仍 🟡）──
echo ""
echo "── 9c. 判据⑧：B7（仓内他处也有，先出现）＋ B999（仅自身）⇒ 仍 ⑧ 🟡 ──"
# 判别设计：文档序 tokens[0]=B7（他处命中 ⇒ 只看首个会判 ✅）、tokens[1]=B999（仅自身）
# ⇒ 期望 🟡，证明逐一遍历全部 tokens 而非只看 tokens[0]。
MULTI="$TMP_ROOT/multi-token"
mkdir -p "$MULTI/scripts/control-tower" "$MULTI/src" "$MULTI/agents/P0-selftest"
cp "$TOOL" "$MULTI/$REL_TOOL"
printf 'fixture repo\n' > "$MULTI/README.md"
printf '// 编号 B7 在其它文件（非被审文档）也出现\nexport const example = 1;\n' > "$MULTI/src/example.ts"
printf '#!/bin/bash\nexit 0\n' > "$MULTI/scripts/selftest.sh"
{ good_agents; printf '\n编号自查用 B7（仓内他处亦见）与 B999（仅本文）。\n'; } > "$MULTI/agents/P0-selftest/AGENTS.md"
git -C "$MULTI" init -q
commit_sandbox "$MULTI" "fixture: multi tokens, first hits elsewhere"
EXIT=0
OUT_MT=$(run_tool "$MULTI") || EXIT=$?
assert_exit 1 "$EXIT" "仅 tokens[1] 非自身 0 命中 ⇒ exit 1"
RMT="$(matrix_row "$OUT_MT" "P0-selftest")"
C8M="$(row_col "$RMT" 8)"
if [ "$C8M" = "🟡" ]; then pass "⑧ 遍历全部 tokens（B7 命中＋B999 未命中 ⇒ 🟡）"; else fail "⑧ 只看 tokens[0]？第 ⑧ 格=${C8M:-缺}（期望 🟡 —— 说明未遍历到 B999）"; fi
assert_contains "$OUT_MT" 'pending=1' "汇总行 pending=1（B999 计入待人工）"

# ── 10. 只读证明 ──
echo ""
echo "── 10. 只读证明：运行前后真实仓 git status --porcelain 不变 ──"
AFTER="$(git -C "$REPO_DIR" status --porcelain)"
if [ "$BEFORE" = "$AFTER" ]; then
  pass "真实仓未被写入（git status --porcelain 前后一致：$(printf '%s' "$BEFORE" | grep -c . | tr -d '\n\r') 行）"
else
  fail "只读证明失败：真实仓状态变化 —— before=[${BEFORE}] after=[${AFTER}]"
fi

# ── 汇总 ──
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  结果: ${PASS} 通过, ${FAIL} 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ check-package-selfsufficiency 配对测试未通过"
  echo "═══════════════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ check-package-selfsufficiency 配对测试全部通过"
echo "═══════════════════════════════════════════════════════════════════"
exit 0
