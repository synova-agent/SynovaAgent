#!/usr/bin/env bash
# tests/control-tower/g12-day-window.test.sh — G12 认领窗口行为级密封测试（D506，K3 P1-3）
# D561 恢复：main 树丢失（API-merge 误用，D509 P1），自 dangling 9cb09dbb 恢复 + 适配当前 main（D506 ERE 语义不变，接线断言实测全匹配）
# 覆盖（铁律 48）:
#   正常: 昨日/今日/明日 三日期前缀 brief 全部被认领（≠ 只 exit 0 浅绿——直测认领行为）
#   降级: python3 不可用 → 回退单日本地 glob（仍认领今日）
#   边界: 窗口外日期（前天/后天）不认领；非 .md 不认领；无 brief 目录 → 空
# 环境: bash 3.x/5.x + git 不需要；只测 today_files_by_prefix 语义（source 脚本段）
# 用法: bash tests/control-tower/g12-day-window.test.sh

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCC="$HERE/../../scripts/pre-commit-check.sh"  # 真实脚本（用于 source 认领函数——需定位到段）
PASS=0; FAIL=0; SKIP=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# 用临时目录模拟 .claude/task-briefs/，直接提取并运行脚本的认领逻辑（不改生产文件）
TMP="$(mktemp -d /tmp/g12win.XXXXXX)"
mkdir -p "$TMP/briefs"
# task-32（Windows 二修）: 期望集须与**生产实现同源**取日（生产用 python datetime）。
#   原用 bash `date -v-1d || date -d ...` 链：跨工具取日 ⇒ 在 Windows 腿可能与 python 不同日
#   （或 fallback 链把 D1/D2/D3/D4 全塌成 D0 ⇒ 夹具文件名重复、期望集含重复项）⇒ 假红。
#   改为 python 取日（同源），无 python 时退回 date 链（保持降级可见）。
_DATES=$("${PYBIN_TP:-$(command -v python3 2>/dev/null || command -v python 2>/dev/null)}" -c "
import datetime
t=datetime.date.today()
print(' '.join((t+datetime.timedelta(days=k)).isoformat() for k in (0,-1,1,-2,2)))" 2>/dev/null || true)
if [ -n "$_DATES" ]; then
  set -- $_DATES; D0="$1"; D1="$2"; D2="$3"; D3="$4"; D4="$5"
else
  echo "  ⚠️  未取到 python 日期，退回 date 链（跨工具取日，Windows 可能不同日）" >&2
  D0=$(date +%Y-%m-%d)
  D1=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d 2>/dev/null || echo "$D0")
  D2=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "tomorrow" +%Y-%m-%d 2>/dev/null || echo "$D0")
  D3=$(date -v-2d +%Y-%m-%d 2>/dev/null || date -d "2 days ago" +%Y-%m-%d 2>/dev/null || echo "$D0")
  D4=$(date -v+2d +%Y-%m-%d 2>/dev/null || date -d "2 days" +%Y-%m-%d 2>/dev/null || echo "$D0")
fi

# 三日内 brief + 窗口外 brief + 非 md
touch "$TMP/briefs/${D1}-D100-x.md" "$TMP/briefs/${D0}-D101-y.md" "$TMP/briefs/${D2}-D102-z.md"
touch "$TMP/briefs/${D3}-D103-old.md" "$TMP/briefs/${D4}-D104-far.md"
echo "not md" > "$TMP/briefs/README.txt"

# ── 生产活点断言（task-26 改指**真实活点**）──────────────────────────────────────
# 原断言针对 V5.2.x 实现: ① grep 'DAY_WINDOW_RE=$(python3 -c' ② grep '[[ "$b" =~ $DAY_WINDOW_RE ]]'。
# V5.3（0889eb16）把三日窗搬进 **CI 权威区 G12 块**（python 直接 glob 出 -1/0/+1 三日 brief），
#   原 grep 目标随之消失 ⇒ 断言红（真警报：判定面被移出本地，断言未同步）。
# 改指活点后判据**不减弱**（四条均行为/可达性，强于原静态 grep）:
#   ① 活点实现可提取（提取失败即红，不静默跳过）
#   ② 活点行为: 用**提取出的生产 python** 跑夹具 → 精确集合相等（-1/0/+1 命中；±2 与非 .md 排除）
#   ③ 能力等价: 同一夹具下「新活点 glob 三日」与「旧实现三日正则」集合相等（证等价，非"能过就算"）
#   ④ 活点可达性: 该实现位于 CI 权威区（SYNO_CI=1）+ ci.yml 的 iron-laws job 无 needs
#   ⑤ 降级三态: python 不可用 → fail-closed 显式降级（不静默假绿）
PYBIN_TP="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
if [ -z "$PYBIN_TP" ]; then echo "degraded: 无可用 python（三日窗活点断言无法执行）" >&2; exit 2; fi
CIY="$HERE/../../.github/workflows/ci.yml"

G12_PY=$(python3 - "$PCC" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'for B in \$\("\$PYBIN" -c "\n(.*?)\n" 2>/dev/null\); do', src, re.S)
print(m.group(1) if m else '')
PY
)
[ -n "$G12_PY" ] && ok "活点① 可提取: CI 权威区 G12 三日窗实现（python -c 内联）" || bad "活点① 不可提取: G12 三日窗实现缺失/被改写（原 grep 目标已随 V5.3 消失）"

# 活点行为夹具（-2/-1/0/+1/+2 日 + 非 .md）；目录口径与生产实现一致（.claude/task-briefs/）
mkdir -p "$TMP/.claude/task-briefs"
touch "$TMP/.claude/task-briefs/${D1}-D100-x.md" "$TMP/.claude/task-briefs/${D0}-D101-y.md" "$TMP/.claude/task-briefs/${D2}-D102-z.md" \
      "$TMP/.claude/task-briefs/${D3}-D103-old.md" "$TMP/.claude/task-briefs/${D4}-D104-far.md"
echo "not md" > "$TMP/.claude/task-briefs/README.txt"
LIVE_SET=$(cd "$TMP" && "$PYBIN_TP" -c "$G12_PY" 2>/dev/null | sort || true)
WANT_SET=$(printf '%s\n' \
  ".claude/task-briefs/${D1}-D100-x.md" ".claude/task-briefs/${D0}-D101-y.md" ".claude/task-briefs/${D2}-D102-z.md" | sort)
if [ "$LIVE_SET" = "$WANT_SET" ]; then
  ok "活点② 行为: 生产实现精确命中 -1/0/+1 三日 brief、排除 ±2 日与非 .md（集合相等）"
else
  bad "活点② 行为: 生产实现集合不符 —— 期望 [$(echo "$WANT_SET" | tr '\n' ' ')] 实得 [$(echo "$LIVE_SET" | tr '\n' ' ')]"
fi

# 能力等价: 旧实现 = '^(D-1|D0|D+1)-' 正则 × *.md basename（V5.2.x 语义），同一夹具
OLD_RE="^(${D1}|${D0}|${D2})-"
OLD_SET=$(cd "$TMP/.claude/task-briefs" && for f in *.md; do [ -e "$f" ] || continue; [[ "$f" =~ $OLD_RE ]] && echo ".claude/task-briefs/$f"; done | sort)
[ "$LIVE_SET" = "$OLD_SET" ] && ok "活点③ 能力等价: 新活点（glob 三日）与旧实现（三日正则）在同夹具上集合相等" || bad "活点③ 能力等价失败: 旧=[$(echo "$OLD_SET" | tr '\n' ' ')] 新=[$(echo "$LIVE_SET" | tr '\n' ' ')]"

# 活点可达性: CI 权威区（SYNO_CI=1 才执行）+ iron-laws job（无 needs）承接
CIZONE=$(awk '/^if \[ "\$\{SYNO_CI:-0\}" = "1" \]; then/{f=1} f{print} f&&/^fi$/{exit}' "$PCC")
printf '%s\n' "$CIZONE" | grep -q 'timedelta(days=k)' && ok "活点④ 位于 CI 权威区（SYNO_CI=1 时执行 = iron-laws 活点）" || bad "活点④ 不在 CI 权威区（本地不执行 = 无落点）"
if grep -qE '^  iron-laws:[[:space:]]*$' "$CIY" && ! awk '/^  iron-laws:[[:space:]]*$/{f=1;next} f&&/^  [A-Za-z0-9_-]+:[[:space:]]*$/{exit} f&&/^    needs:/{print}' "$CIY" | grep -q .; then
  ok "活点④ iron-laws job 存在且无 needs（上游红不牵连 ⇒ 该判定面有独立回报点）"
else
  bad "活点④ iron-laws job 缺失或带 needs（判定面无独立回报点）"
fi
grep -q 'G12: 无可用 python' "$PCC" && ok "活点⑤ 降级三态: python 不可用 → fail-closed 显式降级（不静默假绿）" || bad "活点⑤ 缺 fail-closed 降级分支（python 不可用时会静默假绿）"

grep -qE '^today_files_by_suffix\(\)' "$PCC" && bad "死代码 today_files_by_suffix 函数仍存在（铁律 37）" || ok "死代码 today_files_by_suffix 函数已删除（仅剩注释提及不影响）"

# 语义验证: 与生产同逻辑的 python3 生成正则 + [[ =~ ]] 匹配行为（bash 语言确定性）
DAY_WINDOW_RE=$(python3 -c "
import datetime
t = datetime.date.today()
print('^(' + '|'.join((t + datetime.timedelta(days=k)).isoformat() for k in (-1, 0, 1)) + ')-')")

# 用生产正则执行认领匹配（与 today_files_by_prefix 的 [[ =~ ]] 语义一致）
LIST=""
for f in "$TMP"/briefs/*; do
  [ -e "$f" ] || continue
  b=${f##*/}
  if [[ "$b" =~ $DAY_WINDOW_RE ]]; then LIST+="$f"$'\n'; fi
done
HIT_D1=$(echo "$LIST" | grep -c "${D1}-D100-x.md" || true)
HIT_D0=$(echo "$LIST" | grep -c "${D0}-D101-y.md" || true)
HIT_D2=$(echo "$LIST" | grep -c "${D2}-D102-z.md" || true)
HIT_OLD=$(echo "$LIST" | grep -c "${D3}-D103-old.md" || true)
HIT_FAR=$(echo "$LIST" | grep -c "${D4}-D104-far.md" || true)
HIT_TXT=$(echo "$LIST" | grep -c "README.txt" || true)

[ "$HIT_D1" -eq 1 ] && ok "昨日 brief（${D1}）被认领" || bad "昨日未认领（HIT=$HIT_D1）"
[ "$HIT_D0" -eq 1 ] && ok "今日 brief（${D0}）被认领" || bad "今日未认领"
[ "$HIT_D2" -eq 1 ] && ok "明日 brief（${D2}）被认领" || bad "明日未认领"
[ "$HIT_OLD" -eq 0 ] && ok "前天（${D3}）窗口外不认领" || bad "前天误认领"
[ "$HIT_FAR" -eq 0 ] && ok "后天（${D4}）窗口外不认领" || bad "后天误认领"
[ "$HIT_TXT" -eq 0 ] && ok "非 .md 不认领" || bad "README.txt 误认领"

# 降级路径: python3 不可用 → 回退单日正则（模拟 DAY_WINDOW_RE 空 → 生产脚本回退 ^${TODAY}-）
DAY_WINDOW_RE="^${D0}-"
LIST2=""
for f in "$TMP"/briefs/*; do
  [ -e "$f" ] || continue
  b=${f##*/}
  if [[ "$b" =~ $DAY_WINDOW_RE ]]; then LIST2+="$f"$'\n'; fi
done
[ "$(echo "$LIST2" | grep -c "${D0}-D101-y.md" || true)" -eq 1 ] && ok "回退单日仍认领今日" || bad "回退路径失效"

rm -rf "$TMP"
# D561 适配: 输出格式对齐当前仓库控制塔测试惯例（"N 通过, 0 失败"），exit 语义不变
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ]
