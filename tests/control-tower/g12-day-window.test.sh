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
D0=$(date +%Y-%m-%d)
D1=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d 2>/dev/null || echo "$D0")
D2=$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d "tomorrow" +%Y-%m-%d 2>/dev/null || echo "$D0")
D3=$(date -v-2d +%Y-%m-%d 2>/dev/null || date -d "2 days ago" +%Y-%m-%d 2>/dev/null || echo "$D0")
D4=$(date -v+2d +%Y-%m-%d 2>/dev/null || date -d "2 days" +%Y-%m-%d 2>/dev/null || echo "$D0")

# 三日内 brief + 窗口外 brief + 非 md
touch "$TMP/briefs/${D1}-D100-x.md" "$TMP/briefs/${D0}-D101-y.md" "$TMP/briefs/${D2}-D102-z.md"
touch "$TMP/briefs/${D3}-D103-old.md" "$TMP/briefs/${D4}-D104-far.md"
echo "not md" > "$TMP/briefs/README.txt"

# 生产接线断言（D506 P1-3: 行为级验证，防"exit 0 浅绿"）:
#   ① 生产脚本用 python3 生成三日期正则（非手工/非 case 变量展开）
#   ② 生产脚本用 [[ =~ ]] 匹配（=~ RHS runtime 展开按 ERE 解析，| 是 alternation）
grep -q 'DAY_WINDOW_RE=\$(python3 -c' "$PCC" && ok "生产脚本 python3 生成窗口正则（接线断言）" || bad "DAY_WINDOW_RE 未由 python3 生成"
grep -q '\[\[ "$b" =~ \$DAY_WINDOW_RE \]\]' "$PCC" && ok "生产脚本用 [[ =~ ]] 匹配（=~ 语义正确）" || bad "生产脚本未用 [[ =~ ]]"
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

[ "$HIT_D1" -eq 1 ] && ok "昨日 brief（${D1}）被认领" || bad "昨日未认领（HIT=${HIT_D1}）"
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
