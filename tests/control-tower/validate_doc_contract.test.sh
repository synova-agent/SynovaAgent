#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# validate_doc_contract.test.sh — 三闸判据内核测试（铁律 48: 非空壳）
# 覆盖矩阵（正常 / 边界 / 降级 / 判据来源）:
#   A 三块齐 → 白名单命中放行              exit 0
#   B 判据来自契约文本（改契约即改行为）    加一条阻断 → 原本放行的路径变红
#   C 缺块 → degraded（fail-closed）      移除 blocked 块 → exit 2
#   D --json 形状                          含 checked / transition_hits
#   E 闸 1 对缺段决策件判红                夹具决策件缺 决定/后果 → exit 1
#   F --baseline 可跑且 JSON 可解析        真仓全量
# 运行: bash tests/control-tower/validate_doc_contract.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IMPL="$REPO/scripts/control-tower/check-doc-contract.sh"
PASS=0; FAIL=0

t() { if [ "$2" = "$3" ]; then echo "  OK   $1 (=$3)"; PASS=$((PASS+1)); else echo "  FAIL $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi; }

# D520 清单1: PYBIN 三级探测（禁裸 python3 —— Windows 可能只有 python/py）
PYBIN=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done

FIX=$(mktemp -d); FIX2=$(mktemp -d); FIX3=$(mktemp -d)
trap 'rm -rf "$FIX" "$FIX2" "$FIX3"' EXIT
for d in "$FIX" "$FIX2" "$FIX3"; do mkdir -p "$d/docs/synova"; cp "$REPO/docs/synova/DOC-CONTRACT.md" "$d/docs/synova/DOC-CONTRACT.md"; done

bash "$IMPL" --repo-root "$FIX" --files docs/research/ok.md >/dev/null 2>&1; t "A 白名单命中→0" 0 "$?"

"$PYBIN" - "$FIX2/docs/synova/DOC-CONTRACT.md" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding='utf-8')
s = s.replace('novis-backup-20260526/**', 'novis-backup-20260526/**\ndocs/synova/research/**', 1)
p.write_text(s, encoding='utf-8')
PYEOF
bash "$IMPL" --repo-root "$FIX2" --files docs/synova/research/ok.md >/dev/null 2>&1; t "B 改契约即改行为→1" 1 "$?"
bash "$IMPL" --repo-root "$FIX" --files docs/synova/research/ok.md >/dev/null 2>&1; t "B 原契约同件仍放行→0" 0 "$?"

"$PYBIN" - "$FIX3/docs/synova/DOC-CONTRACT.md" <<'PYEOF'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1]); fence = chr(96) * 3
s = p.read_text(encoding='utf-8')
s = re.sub(re.escape(fence) + 'doc-contract-blocked.*?' + re.escape(fence), '', s, flags=re.S)
p.write_text(s, encoding='utf-8')
PYEOF
bash "$IMPL" --repo-root "$FIX3" --files docs/x.md >/dev/null 2>&1; t "C 缺 blocked 块→2" 2 "$?"

J=$(bash "$IMPL" --repo-root "$FIX" --files .claude/task-briefs/a.md --json 2>/dev/null)  # swallow-ok: 夹具只看 JSON 形状，失败由 exit code 用例覆盖
D1=no; case "$J" in *'"checked"'*) D1=yes;; esac
D2=no; case "$J" in *'"transition_hits"'*) D2=yes;; esac
t "D --json 含 checked/transition_hits" "yes yes" "$D1 $D2"

H=$(mktemp -d); mkdir -p "$H/docs/synova" "$H/decisions/process"
cp "$REPO/docs/synova/DOC-CONTRACT.md" "$H/docs/synova/DOC-CONTRACT.md"
printf '# 决策: 夹具\n\n状态: implemented\n日期: 2026-10-07\n\n## 一句话\n夹具\n' > "$H/decisions/process/2026-10-07-fixture.md"
bash "$IMPL" --repo-root "$H" --all-decisions >/dev/null 2>&1; t "E 闸1 缺段→1" 1 "$?"
rm -rf "$H"

B=$(bash "$IMPL" --repo-root "$REPO" --baseline --json 2>/dev/null)  # swallow-ok: 夹具只看 JSON 可解析性
F_OK=no; case "$B" in *'"gate3_inbound"'*) F_OK=yes;; esac
t "F --baseline JSON 可解析" yes "$F_OK"

echo ""
echo "validate_doc_contract.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0