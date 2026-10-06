#!/usr/bin/env bash
# D5 文档引用完整性 · 判别夹具
# 判别力（V-08 两个方向）:
#   · 盘点模式（无 --changed）**永不判红**（棘轮式）
#   · --changed 一个引用全存在的文件 ⇒ exit 0
#   · --changed 一个含悬空引用的文件 ⇒ exit 1 且**点名到具体路径**
#   · 降级：根不存在 ⇒ exit 2
#   · **两个口径都可出**（global / per-file）—— 口径是参数不是硬编码（复核要点）
# 🔴 安全性: 全部在临时根里新建文件，不软链真实仓库。
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
SUT="scripts/control-tower/check-doc-ref-integrity.py"
NP=0; NF=0
ok(){ echo "  ✅ $1"; NP=$((NP+1)); }; no(){ echo "  ❌ $1"; NF=$((NF+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else no "$1 expect=$3 got=$2"; fi; }
echo "── D5 文档引用完整性 判别夹具 ──"
T=$(mktemp -d); mkdir -p "$T/docs/a" "$T/src"
echo "real" > "$T/src/real.ts"
cat > "$T/docs/a/ok.md" <<'MD'
引用 `src/real.ts` 存在。
MD
cat > "$T/docs/a/bad.md" <<'MD'
引用 `src/nope.ts` 不存在。
MD
run(){ python3 "$SUT" --root "$T" --untracked "$@" 2>&1; }
OUT=$(run); RC=$?
chk "盘点: exit 0（棘轮式不红存量）" "$RC" "0"
echo "$OUT" | grep -q "存量:" && ok "盘点: 打印存量数字" || no "盘点: 未打印"
OUT=$(run --scope per-file); RC=$?
chk "口径切换: --scope per-file ⇒ exit 0" "$RC" "0"
echo "$OUT" | grep -q "按文件计" && ok "口径: 输出写明 per-file 语义" || no "口径: 未写明"
OUT=$(run --changed docs/a/ok.md); RC=$?
chk "全存在 ⇒ exit 0" "$RC" "0"
OUT=$(run --changed docs/a/bad.md); RC=$?
chk "悬空 ⇒ exit 1" "$RC" "1"
echo "$OUT" | grep -q "src/nope.ts" && ok "悬空: 点名到具体路径" || no "悬空: 未点名"
OUT=$(python3 "$SUT" --root /tmp/nope-$$ 2>&1); RC=$?
chk "降级: 根不存在 ⇒ exit 2" "$RC" "2"
echo "$OUT" | grep -q "DEGRADED" && ok "降级: 末行 DEGRADED" || no "降级: 末行非 DEGRADED"
rm -rf "$T"
echo "RESULT: $NP PASS / $NF FAIL"
[ "$NF" -eq 0 ] || exit 1
exit 0
