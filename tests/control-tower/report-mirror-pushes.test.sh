#!/bin/bash
# @requires bash
# 配对测试：report-mirror-pushes.sh（#1034）
# 覆盖：缺 gh ⇒ exit 2；无 PR ⇒ 标"直推"；有 PR ⇒ 标"经 PR"
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$REPO/scripts/control-tower/report-mirror-pushes.sh"
P=0; F=0
ok(){ echo "  ✅ $1"; P=$((P+1)); }; no(){ echo "  ❌ $1"; F=$((F+1)); }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

# ① 无 gh ⇒ exit 2
( HOME="$TMP" PATH="/usr/bin:/bin" bash "$S" 1 >/dev/null 2>&1 ); [ $? -eq 2 ] && ok "无 gh → exit 2（fail-closed）" || no "无 gh 未 exit 2"

# ② 有 gh、无关联 PR ⇒ 直推
cat > "$TMP/bin/gh" <<'EOS'
#!/bin/bash
case "$1" in
  auth) exit 0 ;;
  api)
    if [[ "$2" == *"/pulls"* ]]; then echo 0; exit 0; fi
    echo '[{"sha":"aaaa1111bbbb","commit":{"committer":{"date":"2026-10-26T00:00:00Z"},"author":{"name":"win-push"},"message":"sync"}}]'
    exit 0 ;;
esac
exit 0
EOS
chmod +x "$TMP/bin/gh"
OUT="$(PATH="$TMP/bin:$PATH" bash "$S" 1 2>&1)"
echo "$OUT" | grep -q "直推" && ok "无 PR → 标直推" || no "未标直推: $OUT"

# ③ 有关联 PR ⇒ 经 PR
cat > "$TMP/bin/gh" <<'EOS'
#!/bin/bash
case "$1" in
  auth) exit 0 ;;
  api)
    if [[ "$2" == *"/pulls"* ]]; then echo 1; exit 0; fi
    echo '[{"sha":"bbbb2222cccc","commit":{"committer":{"date":"2026-10-26T00:00:00Z"},"author":{"name":"x"},"message":"feat"}}]'
    exit 0 ;;
esac
exit 0
EOS
chmod +x "$TMP/bin/gh"
OUT2="$(PATH="$TMP/bin:$PATH" bash "$S" 1 2>&1)"
echo "$OUT2" | grep -q "经 PR" && ok "有 PR → 标经 PR" || no "未标经 PR: $OUT2"

echo "结果: $P 通过, $F 失败"; [ "$F" -eq 0 ]
