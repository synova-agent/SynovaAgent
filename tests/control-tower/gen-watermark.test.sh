#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# gen-watermark.test.sh — D979 T3 号段水位生成器测试
#
# 被测: scripts/control-tower/gen-watermark.sh
# 契约: @input task-state/*.json + 全分支名 + [--check]；@output 号段/{README,Mac,Win,K3}.md
#       @degraded 无 python / 无 task-state → 显式 degraded + exit 2
#       三态: 0=成功 / 1=--check 漂移或缺失 / 2=自身失败或降级
#
# 覆盖（铁律 48：正常/降级/边界）:
#   1. 正常：mac/win/k3 三归属 → 水位 = 各自实测最大 D#（D968 / D1002 / D865）
#   2. 段外异常：Mac 段出现 D1007 → Mac.md 段外异常点名（不修数、只报事实）
#   3. 归属来自 domain 双值 `win/mac` → 两个分册都列该卡
#   4. 归属来自 owner 关键字（domain 缺失 + owner=mac-coding）→ 计入 Mac
#   5. 归属来自分支名（chore/win-d1050-x，无 task-state 卡）→ 计入 Win 且水位抬到 D1050
#   6. 幂等：连续两次生成内容一致；`--check` → exit 0
#   7. 漂移：改一字节后 `--check` → exit 1 + 「漂移」
#   8. 缺失：删一个生成物后 `--check` → exit 1 + 「缺失」
#   9. 降级：无 task-state 目录 → exit 2 + 显式 degraded
#  10. 降级：python 全损坏（PATH 前置 exit 127 shim）→ exit 2 + 显式 degraded
#  11. 边界：task-state 存在但无可解析卡号 → 水位「未定义」+ exit 0（不崩）
#  12. 接线：生成物目录与 `号段水位.md` 指针目标一致（指针 ≠ 断链）
#
# 隔离: 全部在 mktemp -d 沙箱内造 git repo + task-state（不碰真实仓库）
# 用法: bash tests/control-tower/gen-watermark.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
GEN="$REPO_DIR/scripts/control-tower/gen-watermark.sh"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_exit() { if [ "$1" = "$2" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1 实际=$2"; fi; }
assert_contains() { if grep -qF "$2" "$1" 2>/dev/null; then pass "$3"; else fail "$3 — 未在 $1 找到: $2"; fi; }
assert_out() { if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 输出未含: $2"; fi; }

SANDBOX=$(mktemp -d /tmp/gtb-wm-XXXXXX)
trap 'rm -rf "$SANDBOX"' EXIT

make_repo() { # <name> → 打印 repo 路径
  local r="$SANDBOX/$1"
  mkdir -p "$r/task-state"
  git -C "$r" init -q -b main
  git -C "$r" config user.email t@synova.local
  git -C "$r" config user.name "Test Runner"
  echo "$r"
}
mkcard() { # <repo> <D#> <json-body>
  printf '%s\n' "$3" > "$1/task-state/D$2.json"
}
run_gen() { # <repo> [args...] → 设置 OUT/EC
  local repo="$1"; shift
  set +e
  OUT=$(bash "$GEN" --root "$repo" "$@" 2>&1)
  EC=$?
  set -e
}

[ -f "$GEN" ] && pass "生成器存在" || fail "生成器缺失: $GEN"
bash -n "$GEN" && pass "bash -n 语法通过" || fail "bash -n 失败"

echo "═══════════════════════════════════════════════════════════"
echo "  D979 T3 号段水位生成器 — 测试"
echo "  SUT: $GEN"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── 1. 正常：三归属水位 ───
echo "── 1. 正常: mac/win/k3 → 水位各取实测最大 D# ──"
R1=$(make_repo r1)
mkcard "$R1" 900 '{"task_id":"D900","domain":"mac","owner":"mac-coding"}'
mkcard "$R1" 968 '{"task_id":"D968","domain":"mac","owner":"mac-coding"}'
mkcard "$R1" 1000 '{"task_id":"D1000","domain":"win","owner":"win-coding"}'
mkcard "$R1" 1002 '{"task_id":"D1002","domain":"win","owner":"win-coding"}'
mkcard "$R1" 865 '{"task_id":"D865","domain":"k3","owner":"k3"}'
git -C "$R1" add -A >/dev/null && git -C "$R1" commit -q -m init
run_gen "$R1"
assert_exit 0 "$EC" "正常生成"
assert_contains "$R1/docs/synova/coordination/号段/Mac.md" "| 水位（段内实测最大 D#） | D968 |" "Mac 水位 = D968（实测最大）"
assert_contains "$R1/docs/synova/coordination/号段/Win.md" "| 水位（段内实测最大 D#） | D1002 |" "Win 水位 = D1002"
assert_contains "$R1/docs/synova/coordination/号段/K3.md" "| 水位（段内实测最大 D#） | D865 |" "K3 水位 = D865"
assert_contains "$R1/docs/synova/coordination/号段/README.md" "| Mac | D9xx | D968 | D969 |" "README 汇总含下一个建议号"
assert_out "$OUT" "Mac: 段=D9xx 水位=D968" "stdout 摘要含水位"
echo ""

# ─── 2. 段外异常 ───
echo "── 2. 段外异常: Mac 段出现 D1007 → 点名（事实上报，不改数）──"
mkcard "$R1" 1007 '{"task_id":"D1007","domain":"mac","owner":"mac-coding"}'
git -C "$R1" add -A >/dev/null && git -C "$R1" commit -q -m add1007
run_gen "$R1"
assert_exit 0 "$EC" "含段外异常仍生成成功"
assert_contains "$R1/docs/synova/coordination/号段/Mac.md" "| 段外异常（越上界，需裁定） | D1007 |" "Mac.md 点名段外 D1007"
rm -f "$R1/task-state/D1007.json"
git -C "$R1" add -A >/dev/null && git -C "$R1" commit -q -m del1007
echo ""

# ─── 3. domain 双值 ───
echo "── 3. 归属双值: domain=win/mac → 两个分册都列 ──"
R3=$(make_repo r3)
mkcard "$R3" 1050 '{"task_id":"D1050","domain":"win/mac","owner":"x"}'
git -C "$R3" add -A >/dev/null && git -C "$R3" commit -q -m init
run_gen "$R3"
# 双归属: Win 段内（水位 D1050）+ Mac 段外异常（越上界）
assert_contains "$R3/docs/synova/coordination/号段/Win.md" "| 水位（段内实测最大 D#） | D1050 |" "Win.md: 双归属卡计入段内水位"
assert_contains "$R3/docs/synova/coordination/号段/Mac.md" "| 段外异常（越上界，需裁定） | D1050 |" "Mac.md: 双归属卡列为越上界异常"
echo ""

# ─── 4. owner 关键字 ───
echo "── 4. 归属来自 owner 关键字（domain 缺失）→ 计入 Mac ──"
R4=$(make_repo r4)
mkcard "$R4" 941 '{"task_id":"D941","owner":"mac-coding"}'
git -C "$R4" add -A >/dev/null && git -C "$R4" commit -q -m init
run_gen "$R4"
assert_contains "$R4/docs/synova/coordination/号段/Mac.md" "| 水位（段内实测最大 D#） | D941 |" "owner 关键字归属 Mac"
echo ""

# ─── 5. 分支名归属 ───
echo "── 5. 归属来自分支名: chore/win-d1050-x（无 task-state 卡）→ Win 水位 D1050 ──"
R5=$(make_repo r5)
mkcard "$R5" 1000 '{"task_id":"D1000","domain":"win","owner":"win-coding"}'
git -C "$R5" add -A >/dev/null && git -C "$R5" commit -q -m init
git -C "$R5" branch chore/win-d1050-x
run_gen "$R5"
assert_contains "$R5/docs/synova/coordination/号段/Win.md" "| 水位（段内实测最大 D#） | D1050 |" "分支名归属抬升 Win 水位"
echo ""

# ─── 6. 幂等 ───
echo "── 6. 幂等: 连跑两次内容一致 + --check exit 0 ──"
run_gen "$R1"; assert_exit 0 "$EC" "第二次生成成功"
for f in README Mac Win K3; do
  cp "$R1/docs/synova/coordination/号段/$f.md" "$SANDBOX/snap-$f.md"
done
run_gen "$R1"
for f in README Mac Win K3; do
  if cmp -s "$SANDBOX/snap-$f.md" "$R1/docs/synova/coordination/号段/$f.md"; then pass "幂等: $f.md 两跑一致"; else fail "幂等失败: $f.md"; fi
done
run_gen "$R1" --check
assert_exit 0 "$EC" "--check 通过（生成物 == 仓库）"
assert_out "$OUT" "✅ 号段水位与仓库逐字节一致" "--check 输出确认"
echo ""

# ─── 7. 漂移 ───
echo "── 7. 漂移: 手改一字节 → --check exit 1 ──"
printf '\n<!-- drift -->\n' >> "$R1/docs/synova/coordination/号段/Mac.md"
run_gen "$R1" --check
assert_exit 1 "$EC" "漂移检出（业务态 exit 1）"
assert_out "$OUT" "漂移:" "漂移行点名"
run_gen "$R1"  # 复原
assert_exit 0 "$EC" "重生成后复原"
run_gen "$R1" --check
assert_exit 0 "$EC" "复原后 --check 通过"
echo ""

# ─── 8. 缺失 ───
echo "── 8. 缺失: 删一个生成物 → --check exit 1 ──"
rm -f "$R1/docs/synova/coordination/号段/Win.md"
run_gen "$R1" --check
assert_exit 1 "$EC" "缺失检出 exit 1"
assert_out "$OUT" "缺失:" "缺失行点名"
run_gen "$R1"
echo ""

# ─── 9. 降级: 无 task-state ───
echo "── 9. 降级: 无 task-state 目录 → exit 2 + 显式 degraded ──"
EMPTY=$(mktemp -d "$SANDBOX/empty-XXXXXX")
run_gen "$EMPTY"
assert_exit 2 "$EC" "无 task-state → exit 2（降级，非静默）"
assert_out "$OUT" "degraded" "显式 degraded 文案"
assert_out "$OUT" "缺 task-state 目录" "文案点名原因"
echo ""

# ─── 10. 降级: python 全损坏 ───
echo "── 10. 降级: python3/python/py 全损坏（PATH 前置 exit 127）→ exit 2 ──"
FAKEBIN="$SANDBOX/fakebin"; mkdir -p "$FAKEBIN"
for c in python3 python py; do printf '#!/bin/bash\nexit 127\n' > "$FAKEBIN/$c"; chmod +x "$FAKEBIN/$c"; done
BASH_BIN="$(command -v bash)"
set +e
OUT=$(PATH="$FAKEBIN" "$BASH_BIN" "$GEN" --root "$R1" 2>&1); EC=$?
set -e
assert_exit 2 "$EC" "损坏 shim → exit 2（可用性探测生效）"
assert_out "$OUT" "无可用 PYBIN" "文案点名无可用 PYBIN（D520 标注后文案）"
echo ""

# ─── 11. 边界: 无卡号 ───
echo "── 11. 边界: task-state 存在但无可解析卡号/坏 json → 未定义 + exit 0 ──"
R11=$(make_repo r11)
printf '{bad json' > "$R11/task-state/Dabc.json"
printf '{"task_id":"none"}' > "$R11/task-state/notes.json"
git -C "$R11" add -A >/dev/null && git -C "$R11" commit -q -m init
run_gen "$R11"
assert_exit 0 "$EC" "无卡号不崩（exit 0）"
assert_contains "$R11/docs/synova/coordination/号段/Mac.md" "未定义（段内无卡）" "水位标未定义"
echo ""

# ─── 12. 接线: 指针目标 == 生成物目录 ───
echo "── 12. 接线: 号段水位.md 指针目标 == 生成物目录 ──"
PTR="$REPO_DIR/docs/synova/coordination/号段水位.md"
if [ -f "$PTR" ]; then
  if grep -qF "号段/README.md" "$PTR"; then pass "指针指向 号段/README.md"; else fail "指针未指向 号段/README.md"; fi
  if grep -qF "gen-watermark.sh" "$PTR"; then pass "指针披露生成器（可复算）"; else fail "指针未披露生成器"; fi
else
  fail "指针文件缺失: $PTR"
fi
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过 / $FAIL 失败"
echo "═══════════════════════════════════════════════════════════"
[ "$FAIL" = "0" ] || exit 1
