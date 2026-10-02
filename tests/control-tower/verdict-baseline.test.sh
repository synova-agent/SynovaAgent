#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# verdict-baseline.test.sh — verdict 基线工具测试（铁律 48：正常/边界/降级）
# 用例: A 正常（三种位置+值域偏离）| B 边界（非字符串 verdict）| C 降级（坏 JSON 不失败）
#       D 错误（state-dir 不存在 exit 1）| E 时序倒挂被标记
# 运行: bash tests/control-tower/verdict-baseline.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/control-tower/verdict-baseline.py"
PASS=0; FAIL=0
t() { if [ "$2" = "$3" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi; }
sec() { # $1=报告文件 $2=小节序号（如 二）→ 打印该小节正文
  python3 -c "
import re,sys
t=open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'^## '+sys.argv[2]+r'、.*?(?=^## |\Z)', t, re.S|re.M)
print(m.group(0) if m else '')" "$1" "$2"
}

FIX=$(mktemp -d); trap 'rm -rf "$FIX"' EXIT
S="$FIX/task-state"; mkdir -p "$S"

# A: 三种位置 + 值域偏离
cat > "$S/D001.json" <<'J'
{"task_id":"D001","status":"audited","updated_at":"2026-08-22T10:00:00+08:00",
 "audit":{"verdict":"PASS","at":"2026-08-22","by":"k3"}}
J
cat > "$S/D002.json" <<'J'
{"task_id":"D002","status":"audited","verdict":"pass","updated_at":"2026-08-23T10:00:00+08:00"}
J
cat > "$S/D003.json" <<'J'
{"task_id":"D003","status":"impl_done","updated_at":"2026-08-24T10:00:00+08:00",
 "impl":{"verdict":"CONDITIONAL PASS","at":"2026-08-24","by":"k3"}}
J
cat > "$S/D004.json" <<'J'
{"task_id":"D004","status":"impl_done","updated_at":"2026-08-25T10:00:00+08:00"}
J

OUT="$FIX/base.md"
python3 "$SCRIPT" --state-dir "$S" --out "$OUT" >/dev/null 2>&1; RC=$?
t "A exit=0" 0 "$RC"
t "A 含 verdict 卡数=3" 3 "$(grep -oE '含 verdict 的卡: \*\*[0-9]+\*\*' "$OUT" | grep -oE '[0-9]+')"
t "A 位置种类=3" 3 "$(sec "$OUT" 二 | grep -c '^| `')"
t "A 小写 pass 判偏离" 1 "$(sec "$OUT" 三 | grep -c '| `pass` | 1 | PASS | ⚠ 是 |')"

# B: 边界——非字符串 verdict（嵌套对象）
cat > "$S/D005.json" <<'J'
{"task_id":"D005","status":"audited","updated_at":"2026-08-26T10:00:00+08:00",
 "audit":{"verdict":{"DS1":"ok"},"at":"2026-08-26","by":"k3"}}
J
python3 "$SCRIPT" --state-dir "$S" --out "$OUT" >/dev/null 2>&1
t "B 非字符串归 OTHER" 1 "$(sec "$OUT" 三 | grep -c '| OTHER | ⚠ 是 |')"

# C: 降级——坏 JSON 计入解析失败但不硬失败
echo '{ broken json' > "$S/D006.json"
OUT2=$(python3 "$SCRIPT" --state-dir "$S" --out "$OUT" 2>/dev/null); RC=$?
t "C 坏 JSON 仍 exit=0" 0 "$RC"
t "C 解析失败被计数" 1 "$(grep -c '解析失败: \*\*1\*\*' "$OUT")"

# D: 错误路径——目录不存在
python3 "$SCRIPT" --state-dir "$FIX/nope" >/dev/null 2>&1; t "D 目录不存在 exit=1" 1 $?

# E: 时序倒挂（audit.at 晚于 updated_at）
rm -f "$S/D006.json"
cat > "$S/D007.json" <<'J'
{"task_id":"D007","status":"audited","updated_at":"2026-09-01T10:00:00+08:00",
 "audit":{"verdict":"FAIL","at":"2026-09-09","by":"k3"}}
J
python3 "$SCRIPT" --state-dir "$S" --out "$OUT" >/dev/null 2>&1
t "E 时间倒挂被标记" 1 "$(grep -c '时间倒挂）: \*\*1\*\*' "$OUT")"

echo
echo "══ 结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
