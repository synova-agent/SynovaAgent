#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# staging_guard.test.sh — U7/CT-40 配对测试（scripts/control-tower/staging_guard.py）
#
# 本件专测 **D-C 增量**：认领制判定对「声明载体双形态」的处置（claim vs legacy brief）。
#   语义级 session/registry 行为在 tests/control-tower/staging-guard-session.test.py
#   （该件在 main 上已有 6 项存量红，属既有基线，不在本件范围——本件不与其重叠）。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界）:
#   正常 — 声明身份与本 session 任务一致 → 不 block
#   降级 — 声明身份与本 session 任务不一致 → block（劫持）；跨口径（claim × D#）→
#          **显式不判定**（返回空身份 → 跳过），由 commit-msg D328 侧兜底，不在此误伤
#   边界 — claim 路径识别（`.claude/claims/*.yaml` 才算 claim，其他 .yaml 不算）；
#          身份串形态（`#<issue>` vs `D<#>`）；取不到身份 → 不判定
#
# 隔离: python 直调模块函数，零 git、零 registry、零网络。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }

echo "=== staging_guard 配对测试（U7/CT-40 · D-C 增量面）==="

OUT=$("$PYBIN" - "$REPO" <<'PY' 2>&1
import sys
repo = sys.argv[1]
sys.path.insert(0, repo + "/scripts/control-tower")
from staging_guard import _is_claim_path, _declared_identity, _declared_identity_id  # noqa: E402

fail = 0
def chk(cond, label, extra=""):
    global fail
    if cond:
        print("PASS|" + label)
    else:
        print("FAIL|" + label + (" | " + str(extra) if extra else ""))
        fail += 1

# ── 边界: claim 路径识别（必须精确到 .claude/claims/，否则会把任意 yaml 当声明）──
chk(_is_claim_path(".claude/claims/1224.yaml"), "路径: .claude/claims/1224.yaml 识别为 claim")
chk(not _is_claim_path(".claude/task-briefs/2026-10-07-D1205-x.md"), "路径: brief .md 非 claim")
chk(not _is_claim_path("config/1224.yaml"), "路径: 非 claims 目录的 yaml 不算 claim")

# ── 正常: 声明身份提取（claim → #issue；legacy brief → D#）──
chk(_declared_identity("/r/.claude/claims/1224.yaml") == "#1224", "身份: claim → #1224",
    _declared_identity("/r/.claude/claims/1224.yaml"))
chk(_declared_identity("/r/.claude/task-briefs/2026-10-07-D1205-x.md") == "D1205",
    "身份: legacy brief → D1205",
    _declared_identity("/r/.claude/task-briefs/2026-10-07-D1205-x.md"))

# ── 正常: 同口径一致 → 不判定为空（调用方不 block）──
c = "/r/.claude/claims/1224.yaml"
chk(_declared_identity_id("#1224", c) == "#1224", "口径: claim × #1224 → 一致身份")
chk(_declared_identity_id("1224", c) == "#1224", "口径: claim × 裸 1224 → 一致身份")
b = "/r/.claude/task-briefs/2026-10-07-D1205-x.md"
chk(_declared_identity_id("D1205", b) == "D1205", "口径: legacy × D1205 → 一致身份")

# ── 边界: 跨口径 → 空身份（显式不判定，由 D328 兜底；不在此误伤）──
chk(_declared_identity_id("D1205", c) == "", "跨口径: claim 声明 × D# session → 不判定",
    _declared_identity_id("D1205", c))
chk(_declared_identity_id("#1224", b) == "", "跨口径: legacy 声明 × issue session → 不判定",
    _declared_identity_id("#1224", b))

# ── 边界: 取不到身份 → 不判定（不误伤）──
chk(_declared_identity_id("no-identity-here", c) == "", "边界: 无身份 → 空")
chk(_declared_identity("/r/.claude/claims/notanumber.yaml") == "",
    "边界: 非数字 claim 文件名 → 空身份")

# ── 降级: 不一致必须能构成 block 判据（精确相等，禁 startswith）──
chk(_declared_identity_id("#12240", c) != "#1224" or "#12240" != "#1224",
    "降级: #12240 不得与 #1224 混同")

sys.exit(2 if fail else 0)
PY
)
RC=$?

while IFS='|' read -r kind label extra; do
  case "$kind" in
    PASS) ok "$label" ;;
    FAIL) no "$label${extra:+ — $extra}" ;;
  esac
done <<< "$OUT"

if [ "$RC" -eq 2 ]; then
  no "python 断言层报告失败（见上方 ❌）"
elif [ "$RC" -ne 0 ]; then
  no "python 断言层异常退出 rc=$RC（检查自身失败）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
