#!/usr/bin/env bash
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SRC="$ROOT/scripts/pre-commit-check.sh"
TMP=$(mktemp -d)
# Windows（MINGW/MSYS）：mktemp 可能返回 C:\...（带盘符），拼入 PATH 时会在冒号处被截断 ⇒ 先转 POSIX 路径
case "$(uname -s)" in
  MINGW*|MSYS*) TMP=$(cygpath -u "$TMP" 2>/dev/null || echo "$TMP") ;;
esac
trap 'rm -rf "$TMP"' EXIT
pass=0 fail=0
check() {
  local name=$1 expected=$2 actual=$3
  if [ "$actual" = "$expected" ]; then printf 'ok - %s\n' "$name"; pass=$((pass+1));
  else printf 'not ok - %s (expected=%s actual=%s)\n' "$name" "$expected" "$actual"; fail=$((fail+1)); fi
}
awk '{print} /^# INTERPRETER-GUARD-END$/{exit}' "$SRC" > "$TMP/guard.sh"
printf '\nexit 0\n' >> "$TMP/guard.sh"
mkdir "$TMP/bin"
cat > "$TMP/bin/grep" <<'EOF'
#!/usr/bin/env bash
case "${MOCK_GREP_MODE:-real}" in
  wsl) exit 0 ;;
  native) exit 1 ;;
  *) command grep "$@" ;;
esac
EOF
chmod +x "$TMP/bin/grep"
MOCK_GREP_MODE=wsl PATH="$TMP/bin:$PATH" bash "$TMP/guard.sh" >"$TMP/wsl.out" 2>&1
check 'WSL 明确判环境失败' 2 "$?"
grep -q 'SYNO-ENV-ERROR.*Git for Windows Bash' "$TMP/wsl.out"
check '错误信息指向 Git Bash' 0 "$?"
MOCK_GREP_MODE=native PATH="$TMP/bin:$PATH" bash "$TMP/guard.sh" >"$TMP/native.out" 2>&1
check '非 WSL 环境不误拦' 0 "$?"
grep -q 'BASE_OUT=.*|| BASE_RC=' "$ROOT/scripts/pre-push-check.sh"
check 'pre-push 环境失败不会被 set -e 提前吞掉' 0 "$?"
printf 'PRE-COMMIT-INTERPRETER RESULT pass=%s fail=%s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
