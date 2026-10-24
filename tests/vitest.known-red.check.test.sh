#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# vitest.known-red.check.test.sh — 已知红双向棘轮检查器的配对判据测试（#840 E-4 · 裁 352）
#
# 覆盖矩阵（铁律 48: 正常/降级/边界 + 改坏必红；三态退出码）:
#   正常 — 4 条已知红全命中 ⇒ rc0（KNOWN-RED-OK）
#   降级 — 缺 JSON ⇒ rc2｜坏 JSON ⇒ rc2｜缺登记表 ⇒ rc2 + E_REGISTRY（typed，不裸 traceback）
#   边界 — 未列出的**用例级**失败 ⇒ rc1｜未列出的**文件级**失败（status=failed/0 断言）⇒ rc1
#   改坏必红 — 删掉 file_failed 判据 ⇒ 文件级场景翻绿（证明该判据承重）；删 new_fail 判据 ⇒ 用例级翻绿
#
# 隔离: 每个用例独立 mktemp 沙箱（复制 manifest/registry）；结果 JSON 固定 /tmp/vitest-result.json
#        （检查器契约；测试末尾清理）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECKER="$REPO/tests/vitest.known-red.check.py"
JSON="/tmp/vitest-result.json"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
assert_rc() { if [ "$1" -eq "$2" ]; then ok "$3 (exit=$1)"; else no "$3 — exit=$1 期望 $2"; fi; }

[ -f "$CHECKER" ] || { echo "❌ 缺被测件 $CHECKER"; exit 2; }
SB="$(mktemp -d)"; trap 'rm -rf "$SB"; rm -f "$JSON"' EXIT
mkdir -p "$SB/tests/contract"
cp "$REPO/tests/vitest.known-red.txt" "$SB/tests/vitest.known-red.txt"
cp "$REPO/tests/contract/known-red.yaml" "$SB/tests/contract/known-red.yaml"

run_checker() { ( cd "$SB" && python3 "$CHECKER" ) >/tmp/kr-out.txt 2>&1; echo $?; }

python3 - "$SB" <<'PY'
import json, sys
sb = sys.argv[1]
known = [l.split("|")[0].strip().split("::")[0]
         for l in open(sb + "/tests/vitest.known-red.txt", encoding="utf-8")
         if l.strip() and not l.startswith("#")]
def write(path, data):
    json.dump(data, open(path, "w"), ensure_ascii=False)
write(sb + "/all-known.json", {"success": False, "testResults": [
    {"name": "/w/" + f, "status": "passed", "assertionResults": [{"fullName": "c", "status": "failed"}]}
    for f in known]})
write(sb + "/unlisted-case.json", {"success": False, "testResults": [
    {"name": "/w/" + f, "status": "passed", "assertionResults": [{"fullName": "c", "status": "failed"}]}
    for f in known] + [{"name": "/w/tests/other.test.ts", "status": "passed",
                        "assertionResults": [{"fullName": "x", "status": "failed"}]}]})
write(sb + "/unlisted-file.json", {"success": False, "testResults": [
    {"name": "/w/" + f, "status": "passed", "assertionResults": [{"fullName": "c", "status": "failed"}]}
    for f in known] + [{"name": "/w/tests/other.test.ts", "status": "failed", "assertionResults": []}]})
PY

echo "═══════════════════════════════════════════════════════════"
echo "  known-red 双向棘轮检查器（#840 · 裁 352）"
echo "═══════════════════════════════════════════════════════════"

# ── 降级：缺 / 坏 JSON ──
rm -f "$JSON"; assert_rc "$(run_checker)" 2 "T1 缺 JSON ⇒ exit 2"
printf '{bad json' > "$JSON"; assert_rc "$(run_checker)" 2 "T2 坏 JSON ⇒ exit 2"

# ── 正常：4 已知红全命中 ──
cp "$SB/all-known.json" "$JSON"; assert_rc "$(run_checker)" 0 "T3 已知红全命中 ⇒ exit 0"
grep -q "KNOWN-RED-OK" /tmp/kr-out.txt && ok "T3 末行 KNOWN-RED-OK" || no "T3 末行不合约: $(tail -1 /tmp/kr-out.txt)"

# ── 边界：未列出的用例级 / 文件级失败 ──
cp "$SB/unlisted-case.json" "$JSON"; assert_rc "$(run_checker)" 1 "T4 未列出（用例级）⇒ exit 1"
grep -q "未列出的失败" /tmp/kr-out.txt && ok "T4 点名未列出的失败" || no "T4 未点名"
cp "$SB/unlisted-file.json" "$JSON"; assert_rc "$(run_checker)" 1 "T5 未列出（文件级 status=failed/0 断言）⇒ exit 1"
grep -q "未覆盖的文件级失败" /tmp/kr-out.txt && ok "T5 点名文件级失败" || no "T5 未点名"

# ── 降级：缺登记表 ⇒ rc2 typed ──
mv "$SB/tests/contract/known-red.yaml" "$SB/kr.bak"
cp "$SB/all-known.json" "$JSON"; assert_rc "$(run_checker)" 2 "T6 缺登记表 ⇒ exit 2"
grep -q "E_REGISTRY" /tmp/kr-out.txt && ok "T6 typed message E_REGISTRY" || no "T6 缺 typed message"
mv "$SB/kr.bak" "$SB/tests/contract/known-red.yaml"

# ── 改坏必红：删判据 ⇒ 对应场景翻绿（证明判据承重）──
MUT="$SB/mut.py"
for spec in "file:uncovered_files" "new:new_fail"; do :; done
python3 - "$CHECKER" "$SB/mut-file.py" "$SB/mut-new.py" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
# 变异 1：文件级判据失效（uncovered_files 恒空）
m1 = src.replace('if not any(covers(e, f, "") for e in entries)]',
                 'if False]')
open(sys.argv[2], "w", encoding="utf-8").write(m1)
# 变异 2：未列出的用例级失败判据失效
m2 = src.replace('new_fail = [(f, n) for f, n in failed if not any(covers(e, f, n) for e in entries)]',
                 'new_fail = []')
open(sys.argv[3], "w", encoding="utf-8").write(m2)
PY
cp "$SB/unlisted-file.json" "$JSON"
( cd "$SB" && python3 "$SB/mut-file.py" ) >/dev/null 2>&1; RC1=$?
[ "$RC1" -eq 0 ] && ok "T7 变异体（删文件级判据）⇒ 该场景翻绿 ⇒ 判据承重" || no "T7 变异体仍红(rc=$RC1) ⇒ 判据可能空转"
cp "$SB/unlisted-case.json" "$JSON"
( cd "$SB" && python3 "$SB/mut-new.py" ) >/dev/null 2>&1; RC2=$?
[ "$RC2" -eq 0 ] && ok "T8 变异体（删用例级判据）⇒ 该场景翻绿 ⇒ 判据承重" || no "T8 变异体仍红(rc=$RC2) ⇒ 判据可能空转"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
