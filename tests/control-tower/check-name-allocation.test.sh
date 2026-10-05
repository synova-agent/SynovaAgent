#!/usr/bin/env bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═════════════════════════════════════════════════════════════════
# check-name-allocation.test.sh — D940 原「三元组校验器」退役后的**主键守卫**（task-28 裁定③）
#
# 背景（CTO 裁定③「换主键」）: `scripts/control-tower/check-name-allocation.sh` 退役；
#   占用判定的**权威主键**改为 `scripts/control-tower/alloc-task-id.sh --check-id <D###>`
#   （实现 = 同文件 `_occupy_locations()`，D940 ③；**单一副本**避免第二实现漂移）。
#   本文件保留原名以维持 ci.yml 密封清单登记不变。
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   退役 — 原校验器已删除（铁律 37：死代码不留）
#   正常 — task-state 已占 → rc=1 且逐行点名冲突位置
#   正常 — 未占 → rc=0
#   边界 — 非法卡号 → rc=2（D328 三态，绝不与 0 混同）
#   接线 — 新主键 `--check-id` 存在 + 本测试在 ci.yml 密封清单
# 沙箱: SYNO_TASK_STATE_DIR + SYNO_ALLOC_NO_{REMOTE,BRANCH,WORKTREE}（零真实占用面）
# ═════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOC="$REPO/scripts/control-tower/alloc-task-id.sh"
RETIRED="$REPO/scripts/control-tower/check-name-allocation.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D940 主键守卫（原三元组校验器退役后）==="

# ── 退役守卫 + 接线 ──
[ ! -e "$RETIRED" ] && ok "退役: 原 check-name-allocation.sh 已删除（铁律 37）" || no "原校验器仍在库（退役未完成）"
grep -q -- '--check-id' "$ALLOC" && ok "接线: 新主键 alloc-task-id.sh --check-id 存在" || no "--check-id 缺失（主键替换点不在位）"
grep -q "check-name-allocation.test.sh" "$REPO/.github/workflows/ci.yml" \
  && ok "接线: 本测试在 ci.yml control-tower-tests 密封清单" || no "本测试不在密封清单（CI 不跑 = 摆设）"
grep -q '^_occupy_locations()' "$ALLOC" && ok "接线: 占用判定单一副本 _occupy_locations() 在位" || no "_occupy_locations 缺失"

# ── 夹具: 只读沙箱（只留 task-state 面，其余占用面显式关闭）──
TS="$TMPD/task-state"; mkdir -p "$TS"
printf '{}\n' > "$TS/D77777.json"
run() { ( cd "$REPO" && SYNO_TASK_STATE_DIR="$TS" SYNO_ALLOC_NO_REMOTE=1 SYNO_ALLOC_NO_BRANCH=1 SYNO_ALLOC_NO_WORKTREE=1 \
           bash "$ALLOC" --check-id "$1" 2>&1 ); }

OUT=$(run D77777); RC=$?
[ "$RC" -eq 1 ] && ok "正常: 已占 id → rc=1" || no "已占应 rc=1，实得 $RC"
printf '%s' "$OUT" | grep -q "task-state" && ok "正常: 冲突位置逐行点名（task-state）" || no "未点名冲突位置: $OUT"

OUT=$(run D88888); RC=$?
[ "$RC" -eq 0 ] && ok "正常: 未占 id → rc=0" || no "未占应 rc=0，实得 $RC"

OUT=$(run Dabc); RC=$?
[ "$RC" -eq 2 ] && ok "边界: 非法卡号 → rc=2（三态）" || no "非法卡号应 rc=2，实得 $RC"
printf '%s' "$OUT" | grep -q "非法卡号" && ok "边界: 非法卡号有显式点名" || no "非法卡号无点名: $OUT"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
