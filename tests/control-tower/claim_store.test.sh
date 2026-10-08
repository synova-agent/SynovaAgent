#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# claim_store.test.sh — U7/CT-40 配对测试（scripts/control-tower/claim_store.py）
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界；ctrl-tower-change 模式 1: 三态退出码 0/1/2）:
#   正常 — 两字段声明解析（writeset/done/note）→ exit 0；写集/命令逐行输出
#   降级 — 畸形声明（未知键 / 内联标量 / 缺键 / done 无 verify / 空 writeset / 空 done）
#          → **exit 2**（检查自身失败，不等于通过）
#   边界 — 声明缺失 → exit 1（无声明，不是"通过"）；`#N`/纯数字/分支形态取号；
#          `--resolve-path` 三态；`--legacy-view` 迁移期标识与 errors 非静默
#
# 单测面分工: 本 sh 只测 **CLI 三态与对外契约**；claim 语义级的变异体反例在
#   tests/control-tower/claim-identity-v2.test.py（R3 夹具 a/b/c + d 变异体）。
# 隔离: mktemp 沙箱 + SYNO_CLAIM_DIR 注入缝，零真实仓库写入、零网络。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLAIM="$REPO/scripts/control-tower/claim_store.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
assert_rc() { if [ "$1" -eq "$2" ]; then ok "$3 (exit=$1)"; else no "$3 — exit=$1 期望 $2"; fi; }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export SYNO_CLAIM_DIR="$TMP/claims"
mkdir -p "$SYNO_CLAIM_DIR"

run() { "$PYBIN" "$CLAIM" --root "$TMP" "$@"; }

echo "=== claim_store 配对测试（U7/CT-40）==="

# ── 正常: 两字段声明 ──
cat > "$SYNO_CLAIM_DIR/1224.yaml" <<'EOF'
writeset:
  - scripts/a.sh
  - scripts/b.sh
done:
  - verify: bash tests/x.test.sh
note: 样例
EOF
OUT=$(run --show '#1224'); assert_rc $? 0 "正常: 两字段声明被接受"
echo "$OUT" | grep -q '"issue": "1224"' && ok "正常: issue 号归一（去 #）" || no "正常: issue 号未归一: $OUT"
echo "$OUT" | grep -q 'scripts/b.sh' && ok "正常: writeset 完整读出" || no "正常: writeset 缺失"

OUT=$(run --writeset 1224); assert_rc $? 0 "正常: --writeset 输出"
[ "$(echo "$OUT" | wc -l | tr -d ' ')" = "2" ] && ok "正常: writeset 两行" || no "正常: writeset 行数异常"

OUT=$(run --done 1224); assert_rc $? 0 "正常: --done 输出"
echo "$OUT" | grep -q '^bash tests/x.test.sh$' && ok "正常: done 剥离 verify: 前缀（值=命令本体）" || no "正常: done 载荷异常: $OUT"

# ── 三态边界: 缺失 → exit 1（不是 0）──
run --check 999 >/dev/null 2>&1; assert_rc $? 1 "--check 缺声明 → exit 1（无声明 ≠ 通过）"
run --path 999 >/dev/null 2>&1; assert_rc $? 1 "--path 缺声明 → exit 1"

# ── 降级: 六类畸形 → exit 2 ──
mk() { printf '%b' "$2" > "$SYNO_CLAIM_DIR/$1.yaml"; }
mk 10 "writeset:\n  - a.sh\ndone:\n  - verify: bash x.sh\nwrite_set:\n  - typo\n"
run --check 10 >/dev/null 2>&1; assert_rc $? 2 "降级: 未知键 → exit 2"
mk 11 "writeset: a.sh\ndone:\n  - verify: bash x.sh\n"
run --check 11 >/dev/null 2>&1; assert_rc $? 2 "降级: 内联标量 → exit 2"
mk 12 "writeset:\n  - a.sh\n"
run --check 12 >/dev/null 2>&1; assert_rc $? 2 "降级: 缺 done 键 → exit 2"
mk 13 "writeset:\n  - a.sh\ndone:\n  - 跑一下测试\n"
OUT=$(run --check 13 2>&1); assert_rc $? 2 "降级: done 缺 verify: → exit 2"
echo "$OUT" | grep -q 'claim-done-without-verify' && ok "降级: 点名错误码（铁律 32）" || no "降级: 未点名错误码: $OUT"
mk 14 "writeset:\ndone:\n  - verify: bash x.sh\n"
run --check 14 >/dev/null 2>&1; assert_rc $? 2 "降级: 空 writeset → exit 2"
mk 15 "writeset:\n  - a.sh\ndone:\n"
run --check 15 >/dev/null 2>&1; assert_rc $? 2 "降级: 空 done → exit 2"

# ── 边界: issue 号提取（单源，commit-msg/gate 同批消费）──
chk_issue() { # <文本> <期望>
  local got; got=$(run --issue-of "$1")
  if [ "$got" = "$2" ]; then ok "边界: issue-of '$1' → '$2'"; else no "边界: issue-of '$1' → '$got' 期望 '$2'"; fi
}
chk_issue 'feat(#1234): x' '1234'
chk_issue 'feat/1234-x' '1234'
chk_issue 'fix/#1017-y' '1017'
chk_issue 'docs(d577-closeout): x' ''      # legacy D# scope 不得产伪 issue
chk_issue 'Merge 9e4141d54e2b into 76' ''  # 合成 merge 主题不得产伪 issue
chk_issue 'feat/win-d702-abc' ''           # legacy 分支不得产伪 issue

# ── 边界（**卡 #1423 翻面**）: 默认开 + 回滚 = 显式关 ──
OUT=$(env -u SYNO_CLAIM_V2 "$PYBIN" "$CLAIM" --flag); assert_rc $? 0 "--flag 可读"
[ "$OUT" = "on" ] && ok "边界: SYNO_CLAIM_V2 **默认开**（#1423: 新任务走 issue 号身份）" || no "边界: 默认应为 on，实得 $OUT"
OUT_OFF="$(SYNO_CLAIM_V2=0 "$PYBIN" "$CLAIM" --flag 2>/dev/null || true)"   # swallow-ok: 失败即空 → 下一行断言判红
[ "$OUT_OFF" = "off" ] && ok "边界: 显式 0 ⇒ 关（#1423 唯一回滚点，回滚语义保留）" || no "边界: 显式 0 应为 off，实得 $OUT_OFF"
OUT=$(SYNO_CLAIM_V2=1 "$PYBIN" "$CLAIM" --flag)
[ "$OUT" = "on" ] && ok "边界: SYNO_CLAIM_V2=1 → on" || no "边界: 开关未生效: $OUT"

# ── 边界: --resolve-path 三态（先清掉上面的畸形样本——同目录存在畸形 claim 时
#    resolve 判 invalid/exit 2 是**设计行为**：不得把"有声明读不动"当作"无声明"）──
rm -f "$SYNO_CLAIM_DIR"/1[0-5].yaml
run --resolve-path scripts/a.sh >/dev/null 2>&1; assert_rc $? 0 "--resolve-path 命中 → exit 0"
run --resolve-path docs/none.md >/dev/null 2>&1; assert_rc $? 1 "--resolve-path 无命中 → exit 1"

# ── 边界: --legacy-view 迁移期标识（禁静默空白，K3 R6）──
# 注入一条畸形样本：迁移期视图必须把它**报出来**（errors + degraded），不得静默丢
mk 16 "writeset:\n  - a.sh\ndone:\n  - verify: bash x.sh\nwrite_set:\n  - typo\n"
OUT=$(run --legacy-view)
assert_rc $? 0 "--legacy-view 可跑"
echo "$OUT" | grep -q '迁移期' && ok "边界: 含显式迁移期标识" || no "边界: 缺迁移期标识"
echo "$OUT" | grep -q '"errors": \[\]' && no "边界: 应报出畸形条目（非静默）" || ok "边界: 畸形条目进 errors（非静默吞）"
echo "$OUT" | grep -q '"degraded": true' && ok "边界: 有畸形 → degraded=true（铁律 31）" || no "边界: degraded 标记缺失"

# ── 边界: 迁移期标识串自身非空（消费者可打印）──
OUT=$(run --migration-marker); assert_rc $? 0 "--migration-marker 可跑"
[ -n "$OUT" ] && ok "边界: 标识串非空" || no "边界: 标识串为空（=静默空白）"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
