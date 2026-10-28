#!/bin/bash
# check-mirror-freshness.test.sh — #1087 / W5 配对测试（密封：全本地裸仓，不触网络）
# 覆盖: ① 新鲜 exit 0 ② 落后 exit 1（含计数）③ 分叉 exit 1 ④ 镜象超前 exit 1
#       ⑤ 判不了: 坏 URL exit 2 ⑤b 判不了: 镜象对象不可见 exit 2 ⑥ 判不了: canonical 缺失 exit 2
#       ⑦ 判不了: git 异常退出 128 **不得当 0**（W6/G6 同源）
#       ⑧ --json 合法 ⑨ 改坏必红: 把 fresh 判定改成恒真 ⇒ 落后用例必红（证明断言有判别力）
# 口径: 只跑本地 file 路径裸仓；mktemp 沙箱；零失败 ⇒ exit 0
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$REPO/scripts/control-tower/check-mirror-freshness.sh"
[ -f "$S" ] || { echo "❌ 被测件不存在: $S"; exit 2; }
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

g(){ git -C "$1" "${@:2}"; }

# 建一对：canon（工作仓，canonical ref = main）＋ mirror（裸仓）
mkrepo() { # $1 = 沙箱目录
  local d="$1"
  mkdir -p "$d"
  git init -q --bare "$d/mirror.git" || return 1
  git init -q "$d/canon" || return 1
  git -C "$d/canon" config user.email t@e.com
  git -C "$d/canon" config user.name t
  git -C "$d/canon" config commit.gpgsign false
  echo a > "$d/canon/a.txt"
  git -C "$d/canon" add -A >/dev/null
  git -C "$d/canon" commit -qm init
  git -C "$d/canon" branch -M main
  git -C "$d/canon" remote add mirror "$d/mirror.git"
  git -C "$d/canon" push -q mirror main || return 1
}

run(){ # run <root> <mirror-url> [extra...]  → stdout 存 $OUT，rc 存 $RC
  OUT="$(bash "$S" --root "$1" --canonical main --mirror-url "$2" "${@:3}" 2>&1)"; RC=$?
}

echo "── ① 新鲜：mirror == canonical ──"
D1="$TMPD/fresh"; mkrepo "$D1" || { no "① 夹具失败"; }
run "$D1/canon" "$D1/mirror.git"
[ "$RC" -eq 0 ] && ok "① exit 0" || no "① 期望 0 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "镜像新鲜" && ok "① 结论行可见" || no "① 缺结论行"

echo "── ② 落后：canonical 前进 2 提交 ──"
D2="$TMPD/stale"; mkrepo "$D2" || no "② 夹具失败"
echo b > "$D2/canon/b.txt"; g "$D2/canon" add -A >/dev/null; g "$D2/canon" commit -qm b
echo c > "$D2/canon/c.txt"; g "$D2/canon" add -A >/dev/null; g "$D2/canon" commit -qm c
run "$D2/canon" "$D2/mirror.git"
[ "$RC" -eq 1 ] && ok "② 落后 exit 1" || no "② 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "落后 2 提交" && ok "② 落后计数=2" || no "② 计数错（$OUT）"
printf '%s' "$OUT" | grep -q "旧树绿" && ok "② 结论句点名旧树绿" || no "② 缺结论句"

echo "── ③ 分叉：镜象与 canonical 各有一条独有提交 ──"
D3="$TMPD/diverged"; mkrepo "$D3" || no "③ 夹具失败"
git -C "$D3/canon" checkout -q -b mirror-div
echo m > "$D3/canon/m.txt"; g "$D3/canon" add -A >/dev/null; g "$D3/canon" commit -qm m
git -C "$D3/canon" checkout -q main
echo n > "$D3/canon/n.txt"; g "$D3/canon" add -A >/dev/null; g "$D3/canon" commit -qm n
OUT="$(bash "$S" --root "$D3/canon" --canonical main --mirror-ref mirror-div 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "③ 分叉 exit 1" || no "③ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "分叉" && ok "③ 点名分叉" || no "③ 未点名分叉（$OUT）"

echo "── ④ 镜象超前（canonical 是镜象祖先）──"
D4="$TMPD/ahead"; mkrepo "$D4" || no "④ 夹具失败"
git -C "$D4/canon" checkout -q -b mirror-ahead
echo m > "$D4/canon/m.txt"; g "$D4/canon" add -A >/dev/null; g "$D4/canon" commit -qm m
git -C "$D4/canon" checkout -q main
OUT="$(bash "$S" --root "$D4/canon" --canonical main --mirror-ref mirror-ahead 2>&1)"; RC=$?
[ "$RC" -eq 1 ] && ok "④ 超前 exit 1" || no "④ 期望 1 实得 $RC（$OUT）"
printf '%s' "$OUT" | grep -q "超前 1 提交" && ok "④ 超前计数=1" || no "④ 计数错（$OUT）"

echo "── ⑤ 判不了：镜象 URL 不存在 ⇒ exit 2 ──"
run "$D1/canon" "$TMPD/no-such-mirror.git"
[ "$RC" -eq 2 ] && ok "⑤ 坏 URL exit 2（禁当通过）" || no "⑤ 期望 2 实得 $RC（$OUT）"

echo "── ⑤b 判不了：镜象提交对象不可见（ls-remote 只给 sha）⇒ exit 2 ──"
D5="$TMPD/unknown"; mkdir -p "$D5"
git init -q --bare "$D5/mirror.git"
git init -q "$D5/other"
git -C "$D5/other" config user.email t@e.com; git -C "$D5/other" config user.name t
git -C "$D5/other" config commit.gpgsign false
echo z > "$D5/other/z.txt"; git -C "$D5/other" add -A >/dev/null; git -C "$D5/other" commit -qm z
git -C "$D5/other" push -q "$D5/mirror.git" HEAD:main || no "⑤b 推镜象失败"
run "$D1/canon" "$D5/mirror.git"
[ "$RC" -eq 2 ] && ok "⑤b 对象不可见 exit 2（禁猜落后/分叉）" || no "⑤b 期望 2 实得 $RC（$OUT）"

echo "── ⑥ 判不了：canonical ref 不存在 ⇒ exit 2 ──"
OUT="$(bash "$S" --root "$D1/canon" --canonical no-such-ref --mirror-url "$D1/mirror.git" 2>&1)"; RC=$?
[ "$RC" -eq 2 ] && ok "⑥ 缺 canonical exit 2" || no "⑥ 期望 2 实得 $RC（$OUT）"

echo "── ⑦ 判不了：git 以 128 退出 ⇒ 必须 2，严禁当 0 ──"
mkdir -p "$TMPD/fakebin"
printf '#!/bin/sh\nexit 128\n' > "$TMPD/fakebin/git"
chmod +x "$TMPD/fakebin/git"
OUT="$(PATH="$TMPD/fakebin:$PATH" bash "$S" --root "$D1/canon" --canonical main --mirror-url "$D1/mirror.git" 2>&1)"; RC=$?
[ "$RC" -eq 2 ] && ok "⑦ 128 ⇒ exit 2（不是 0）" || no "⑦ 期望 2 实得 $RC（$OUT）"

echo "── ⑧ --json 为合法 JSON ──"
run "$D2/canon" "$D2/mirror.git" --json
printf '%s' "$OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["status"]=="stale" and d["behind"]==2 else 1)' \
  && ok "⑧ JSON 可 parse 且 status/behind 正确" || no "⑧ JSON 不合法或字段错（$OUT）"

echo "── ⑨ 改坏必红：fresh 判定改成恒真 ⇒ 落后用例必变绿（证明②有判别力）──"
MUT="$TMPD/mutant.sh"
sed 's|^if \[ "\$MIRROR_SHA" = "\$CANON_SHA" \]; then  # @mutate-point: fresh|if true; then  # mutant|' "$S" > "$MUT"
grep -q "mutant" "$MUT" && ok "⑨ 变异点已注入" || no "⑨ 变异点未命中（@mutate-point 被改名？）"
OUT="$(bash "$MUT" --root "$D2/canon" --canonical main --mirror-url "$D2/mirror.git" 2>&1)"; RC_MUT=$?
[ "$RC_MUT" -eq 0 ] && ok "⑨ 变异后落后用例变绿 ⇒ 若有人如此改坏，②必红（判别力成立）" \
  || no "⑨ 期望变异体 exit 0 实得 $RC_MUT（说明变异点失效）"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
