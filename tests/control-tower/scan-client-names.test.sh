#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# scan-client-names.test.sh — D1063/CN-01 扫描器**单元**测试
# （脚本配对名: scripts/control-tower/scan-client-names.py ↔ 本文件，U7/CT-40 规则）
# 接线/端到端测试在 tests/control-tower/client-name-gate.test.sh（两者互补，不重复）
#
# 覆盖矩阵（铁律 48 三路径 + 判别性 + 边界）:
#   正常 ① 干净内容 → exit 0
#   正常 ② 含名 fixture（内容命中）→ exit 1；②b 文件名命中 → exit 1
#   正常 ③ 边界编码：**UTF-8 BOM + CRLF** 的 .html 仍被拦（基线实测仓内存在带 BOM 的 .html）
#   正常 ④ 二进制未登记 → exit 1 且显式打印「未内容扫描（binary）」（禁静默 fail-open）
#   正常 ⑤ 二进制已登记（allowlist）→ 不再算缺口
#   判别 ⑥ 三段判别性：起点干净(0) → ① 含名拦(1) → ② 清空 entries 过(0) → ③ 恢复又拦(1)
#   降级 ⑩ patterns 缺失 → exit 2 + code（**不看门禁崩溃当通过**）
#   降级 ⑪ 数据文件损坏（salt 非 hex）→ exit 2
#   降级 ⑫ 数据文件自相矛盾（allowlist ∩ refused）→ exit 2
#   边界 ⑬ --add-entry 只落 hash：明文**不得**出现在数据文件中
#   边界 ⑭ 数据结构：entries 只含 id/len/sha256(/nonAscii)，sha256 = 64 hex，salt = 32 hex
#
# 沙箱（PLATFORM-CHECKLIST #6）: mktemp -d + trap 清理；git 身份一律 `-c user.name=t -c user.email=t@t`；
#   🔴 不写真实仓库（沙箱自带 .git；脚本是复制进去的）。
# 跨平台: 变量一律 `${}` 花括号边界（D370：全角标点会被 bash 当变量名字符）。
# 红证: fixture 带标记（由 `INJECTED-""RED` 拼接，本文件不含标记字面量）；收尾断言本卡产物零残留。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCANNER_SRC="$REPO/scripts/control-tower/scan-client-names.py"
RED_MARK="INJECTED-""RED"                     # 拼接：本文件不含标记字面量
RED_NAME="CN01TEST-测试客甲"                   # 合成名（**不是**任何真实客户名），仅存在于沙箱
RED_PARTIAL="客甲"                             # 合成名的 2 字部分名（测「部分名亦被拦」）

PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
if [ -z "$PYBIN" ]; then
  echo "SKIP→FAIL: 无可用 python —— 扫描器无法运行（不静默绿）"
  exit 1
fi
if [ ! -f "$SCANNER_SRC" ]; then
  echo "❌ 被测脚本不存在: scripts/control-tower/scan-client-names.py"
  exit 1
fi

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/scripts/control-tower" "$SB/docs/synova/business"
cp "$SCANNER_SRC" "$SB/scripts/control-tower/scan-client-names.py"
PAT="$SB/scripts/control-tower/client-name-patterns.json"
SCAN="$SB/scripts/control-tower/scan-client-names.py"
DOCDIR="docs/synova/business"

git -C "$SB" init -q .
GIT="git -C $SB -c user.name=t -c user.email=t@t"
$GIT commit -q --allow-empty -m "sandbox base"   # 建 HEAD：diff --cached 口径正常

echo "=== D1063/CN-01 扫描器单元测试 ==="

# ── 前置: 数据文件（合成名，只落 hash）──
"$PYBIN" "$SCAN" --patterns "$PAT" --add-entry "$RED_NAME" >/dev/null 2>&1
[ -f "$PAT" ] && ok "沙箱: 数据文件已用 --add-entry 生成" || no "沙箱: 数据文件生成失败"

# ── ⑬ --add-entry 只落 hash：明文不得出现在数据文件里 ──
if grep -qF "$RED_NAME" "$PAT"; then
  no "⑬ --add-entry 把明文写进了数据文件（契约破坏）"
else
  ok "⑬ --add-entry 只落 hash：明文未出现在数据文件中"
fi

# ── ⑭ 结构：entries 只含 id/len/sha256(/nonAscii)，sha256 = 64 hex ──
STRUCT=$("$PYBIN" - "$PAT" <<'PY'
import json, re, sys
d = json.load(open(sys.argv[1]))
e = d["entries"][0]
keys_ok = set(e) <= {"id", "len", "sha256", "nonAscii"}
hex_ok = re.fullmatch(r"[0-9a-f]{64}", str(e["sha256"])) is not None
salt_ok = re.fullmatch(r"[0-9a-f]{32}", str(d["salt"])) is not None
id_ok = str(e["id"]).startswith("CN-")
print("OK" if (keys_ok and hex_ok and salt_ok and id_ok and set(e) >= {"id", "len", "sha256"}) else
      f"BAD keys={sorted(e)} hex={hex_ok} salt={salt_ok} id={id_ok}")
PY
)
[ "$STRUCT" = "OK" ] && ok "⑭ 数据结构: {id,len,sha256(/nonAscii)} + 64hex + 32hex salt" || no "⑭ 数据结构异常: ${STRUCT}"

# ── ① 干净内容 → exit 0 ──
printf 'this file has nothing sensitive at all\n' > "$SB/$DOCDIR/clean-note.md"
$GIT add -f "$DOCDIR/clean-note.md" >/dev/null 2>&1
RC=0; OUT=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC=$?
if [ "$RC" -eq 0 ]; then ok "① 干净内容 --scan-staged → exit 0（${OUT}）"; else no "① 干净内容应 exit 0，实际 ${RC} :: ${OUT}"; fi

# ── ② 含名 fixture：内容命中 → exit 1 ──
"$PYBIN" - "$SB/$DOCDIR/memo-$RED_MARK.md" "$RED_NAME" <<'PY'
import sys, pathlib
pathlib.Path(sys.argv[1]).write_text("# 会议纪要\n客户：%s\n" % sys.argv[2], encoding="utf-8")
PY
$GIT add -f "$DOCDIR/memo-$RED_MARK.md" >/dev/null 2>&1
RC=0; OUT=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "内容命中"; then
  ok "② 含名内容 → exit 1 且点名 [内容命中]"
else
  no "② 含名内容应 exit 1 + 内容命中，实际 rc=${RC} :: ${OUT}"
fi

# ── ②b 含名 fixture：**文件名**命中 → exit 1 ──
$GIT rm --cached -q "$DOCDIR/memo-$RED_MARK.md" >/dev/null 2>&1
rm -f "$SB/$DOCDIR/memo-$RED_MARK.md"
printf 'body is clean\n' > "$SB/$DOCDIR/plan-$RED_NAME-2026.md"
$GIT add -f "$DOCDIR/plan-$RED_NAME-2026.md" >/dev/null 2>&1
RC=0; OUT=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "路径命中"; then
  ok "②b 含名文件名 → exit 1 且点名 [路径命中]"
else
  no "②b 含名文件名应 exit 1 + 路径命中，实际 rc=${RC} :: ${OUT}"
fi

# ── ③ 边界编码：UTF-8 BOM + CRLF 的 .html 仍被拦 ──
$GIT rm --cached -q "$DOCDIR/plan-$RED_NAME-2026.md" >/dev/null 2>&1
rm -f "$SB/$DOCDIR/plan-$RED_NAME-2026.md"
"$PYBIN" - "$SB/$DOCDIR/bom-$RED_MARK.html" "$RED_NAME" <<'PY'
import sys, pathlib
body = "<html>\r\n<body>\r\n<p>客户：%s</p>\r\n</body>\r\n</html>\r\n" % sys.argv[2]
pathlib.Path(sys.argv[1]).write_bytes(b"\xef\xbb\xbf" + body.encode("utf-8"))  # BOM + CRLF
PY
$GIT add -f "$DOCDIR/bom-$RED_MARK.html" >/dev/null 2>&1
RC=0; OUT=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "内容命中"; then
  ok "③ BOM+CRLF 的 .html 仍被拦（剥 BOM / 兼容 CRLF 生效）"
else
  no "③ BOM+CRLF 应仍被拦，实际 rc=${RC} :: ${OUT}"
fi

# ── ④ 二进制未登记 → exit 1 + 显式「未内容扫描（binary）」──
$GIT rm --cached -q "$DOCDIR/bom-$RED_MARK.html" >/dev/null 2>&1
rm -f "$SB/$DOCDIR/bom-$RED_MARK.html"
"$PYBIN" - "$SB/$DOCDIR/blob-$RED_MARK.docx" "$RED_NAME" <<'PY'
import sys, pathlib
pathlib.Path(sys.argv[1]).write_bytes(b"PK\x03\x04\x00\x00" + sys.argv[2].encode("utf-8") + b"\x00\x00binary")
PY
$GIT add -f "$DOCDIR/blob-$RED_MARK.docx" >/dev/null 2>&1
RC=0; OUT=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "未内容扫描（binary）"; then
  ok "④ 未登记二进制 → exit 1 且显式打印「未内容扫描（binary）」（禁静默 fail-open）"
else
  no "④ 未登记二进制应 exit 1 + 显式申明，实际 rc=${RC} :: ${OUT}"
fi

# ── ⑤ 二进制已登记（allowlist）→ 不再算缺口 ──
"$PYBIN" - "$PAT" "$DOCDIR/blob-$RED_MARK.docx" <<'PY'
import json, sys
p, path = sys.argv[1], sys.argv[2]
d = json.load(open(p))
d["binaryPolicy"]["allowlist"] = [{"path": path, "method": "raw", "reviewedAt": "test"}]
json.dump(d, open(p, "w"), ensure_ascii=False, indent=2)
PY
RC=0; OUT=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC=$?
if [ "$RC" -eq 0 ]; then
  ok "⑤ 已登记二进制 → 不再算缺口（exit 0）"
else
  no "⑤ 已登记二进制应 exit 0，实际 rc=${RC} :: ${OUT}"
fi

# ── ⑫ 自相矛盾（allowlist ∩ refused）→ exit 2 ──
"$PYBIN" - "$PAT" "$DOCDIR/blob-$RED_MARK.docx" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["binaryPolicy"]["refused"] = [{"path": sys.argv[2], "reason": "test"}]
json.dump(d, open(sys.argv[1], "w"), ensure_ascii=False, indent=2)
PY
RC=0; "$PYBIN" "$SCAN" --repo "$SB" --scan-staged >/dev/null 2>&1 || RC=$?
[ "$RC" -eq 2 ] && ok "⑫ 数据文件自相矛盾（allowlist ∩ refused）→ exit 2" || no "⑫ 应为 exit 2，实际 ${RC}"
"$PYBIN" - "$PAT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["binaryPolicy"].pop("refused", None)
d["binaryPolicy"]["allowlist"] = []
json.dump(d, open(sys.argv[1], "w"), ensure_ascii=False, indent=2)
PY

echo ""
echo "── ⑥ 三段判别性（起点 0 / ① 拦 / ② 摘规则放行 / ③ 恢复又拦）──"
$GIT rm --cached -q "$DOCDIR/blob-$RED_MARK.docx" >/dev/null 2>&1
rm -f "$SB/$DOCDIR/blob-$RED_MARK.docx"
printf 'clean baseline file\n' > "$SB/$DOCDIR/six1.md"
$GIT add -f "$DOCDIR/six1.md" >/dev/null 2>&1
RC0=0; "$PYBIN" "$SCAN" --repo "$SB" --scan-staged >/dev/null 2>&1 || RC0=$?
[ "$RC0" -eq 0 ] && ok "  ⑥-0 起点: 无语义命中 → exit 0" || no "  ⑥-0 起点应 exit 0，实际 ${RC0}"

printf '联系人：%s\n' "$RED_NAME" > "$SB/$DOCDIR/six2.md"
$GIT add -f "$DOCDIR/six2.md" >/dev/null 2>&1
RC1=0; "$PYBIN" "$SCAN" --repo "$SB" --scan-staged >/dev/null 2>&1 || RC1=$?
[ "$RC1" -eq 1 ] && ok "  ⑥-1 新增含名 fixture → 被拦 (exit 1)" || no "  ⑥-1 应被拦 (exit 1)，实际 ${RC1}"

"$PYBIN" - "$PAT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); d["entries"] = []; d["pathEntries"] = []
json.dump(d, open(sys.argv[1], "w"), ensure_ascii=False, indent=2)
PY
RC2=0; OUT2=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC2=$?
[ "$RC2" -eq 0 ] && ok "  ⑥-2 清空 entries（摘规则）→ 过 (exit 0)" || no "  ⑥-2 摘规则后应 exit 0，实际 ${RC2} :: ${OUT2}"

"$PYBIN" "$SCAN" --patterns "$PAT" --add-entry "$RED_NAME" >/dev/null 2>&1
RC3=0; "$PYBIN" "$SCAN" --repo "$SB" --scan-staged >/dev/null 2>&1 || RC3=$?
[ "$RC3" -eq 1 ] && ok "  ⑥-3 恢复规则 → 又拦 (exit 1)" || no "  ⑥-3 恢复后应 exit 1，实际 ${RC3}"

echo ""
echo "── 部分名段（CN-02 型：多长度条目共存 —— 只有部分名也必须被拦）──"
# 背景: 实测客户名「前 2 字部分名」在仓内独立存在（含落在 gate 域内的两件），
#   4 字滑窗抓不到 ⇒ 必须支持**不同长度条目共存**（len=2 与 len=13 同表）。
"$PYBIN" "$SCAN" --patterns "$PAT" --add-entry "$RED_PARTIAL" >/dev/null 2>&1
LENS_JSON=$("$PYBIN" - "$PAT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(",".join(str(e["len"]) for e in d["entries"]))
PY
)
if echo "$LENS_JSON" | grep -q "2" && echo "$LENS_JSON" | grep -q "13"; then
  ok "  部分名-1 多长度条目共存（entries len=${LENS_JSON}）"
else
  no "  部分名-1 多长度条目未共存（len=${LENS_JSON}）"
fi
$GIT reset -q
rm -f "$SB/$DOCDIR"/*.md
printf '作者：%s\n' "$RED_PARTIAL" > "$SB/$DOCDIR/partial-$RED_MARK.md"
$GIT add -f "$DOCDIR" >/dev/null 2>&1
RC_P=0; OUT_P=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC_P=$?
if [ "$RC_P" -eq 1 ] && echo "$OUT_P" | grep -q "内容命中"; then
  ok "  部分名-2 仅含部分名的 fixture → 被拦（exit 1，内容命中）"
else
  no "  部分名-2 仅含部分名应被拦，实际 rc=${RC_P} :: ${OUT_P}"
fi
if echo "$OUT_P" | grep -q "CN-02"; then
  ok "  部分名-3 命中点名到 CN-02（可归因到具体条目，非模糊命中）"
else
  no "  部分名-3 命中未点名 CN-02，实际=${OUT_P}"
fi
# 反向：既不含全名也不含部分名 → 必须放行（防「多登记一条 = 恒红」）
printf '这是一段完全无关的正文\n' > "$SB/$DOCDIR/partial-$RED_MARK.md"
$GIT add -f "$DOCDIR" >/dev/null 2>&1
RC_N=0; "$PYBIN" "$SCAN" --repo "$SB" --scan-staged >/dev/null 2>&1 || RC_N=$?
[ "$RC_N" -eq 0 ] && ok "  部分名-4 两者皆无 → 放行（门禁仍有判别力）" || no "  部分名-4 应放行，实际 ${RC_N}"
$GIT reset -q

echo ""
echo "── 空集可区分段（假绿防线：空集不得与「检查 0 件 / 命中 0 件」同形）──"
$GIT reset -q   # 清空暂存 ⇒ 模拟纯删除提交（ACMR 集为空）
RC_E0=0; OUT_E=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC_E0=$?
if echo "$OUT_E" | grep -q "本次无文本件可扫"; then
  ok "  空集-1 空扫描集 → 显式打印「本次无文本件可扫（N=0）—— 未覆盖任何文件」"
else
  no "  空集-1 空扫描集未显式申明未覆盖（输出=${OUT_E}）"
fi
SAME_SHAPE=$(echo "$OUT_E" | grep -cE "^检查 [0-9]+ 件" | tr -d '\n\r')
if [ "${SAME_SHAPE:-1}" -eq 0 ]; then
  ok "  空集-2 空集**不**使用「检查 N 件 / 命中 M 件」同形汇总（可区分）"
else
  no "  空集-2 空集仍打印同形汇总 —— 假绿不可区分"
fi
[ "$RC_E0" -eq 0 ] && ok "  空集-3 空集 exit 0（非阻断，但已显式申明零覆盖）" || no "  空集-3 空集应 exit 0，实际 ${RC_E0}"
COV_JSON=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged --json)
COV=$(printf '%s' "$COV_JSON" | "$PYBIN" -c "import json,sys; print(json.load(sys.stdin)['coverage'])")
[ "$COV" = "empty" ] && ok "  空集-4 JSON coverage=\"empty\"（机器可判）" || no "  空集-4 coverage 应为 empty，实际 ${COV}"
# 反向断言：非空且干净时必须**是**同形汇总（否则「可区分」不成立）
printf 'clean\n' > "$SB/$DOCDIR/rev.md"
$GIT add -f "$DOCDIR/rev.md" >/dev/null 2>&1
RC_E1=0; OUT_E1=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC_E1=$?
if echo "$OUT_E1" | grep -qE "^检查 1 件 / 命中 0 件"; then
  ok "  空集-5 非空干净扫描 → 同形汇总在场（两种形态可区分，非「一律不打印」）"
else
  no "  空集-5 非空干净扫描应打印同形汇总，实际=${OUT_E1}"
fi
$GIT reset -q

echo ""
echo "── 二进制-树模式（队长 2026-09-29 裁定：任何未登记二进制 ⇒ 绝不返回 0）──"
TREE2="$SB/tree2"
mkdir -p "$TREE2"
git -C "$TREE2" init -q .
"$PYBIN" - "$TREE2/blob.bin" <<'PY'
import sys, pathlib
pathlib.Path(sys.argv[1]).write_bytes(b"\x00\x01binary-payload")
PY
git -C "$TREE2" add -A -f >/dev/null 2>&1
git -C "$TREE2" -c user.name=t -c user.email=t@t commit -qm tree2 >/dev/null 2>&1
RC_T=0; OUT_T=$("$PYBIN" "$SCAN" --repo "$TREE2" --scan-all-tree 2>&1) || RC_T=$?
if echo "$OUT_T" | grep -q "未内容扫描（binary）"; then
  ok "  树模式-1 未登记二进制 → 显式点名「未内容扫描（binary）」（不静默）"
else
  no "  树模式-1 未登记二进制未点名，实际=${OUT_T}"
fi
if [ "$RC_T" -eq 1 ]; then
  ok "  树模式-2 未登记二进制 ⇒ exit 1（绝不返回 0 —— 否则 C2 全树清零靠二进制盲区假绿）"
else
  no "  树模式-2 应为 exit 1，实际 ${RC_T}"
fi

echo ""
echo "── ⑩/⑪ 降级路径：数据文件缺失/损坏 → exit 2（不得与通过混同）──"
mv "$PAT" "$PAT.saved"
RC10=0; OUT10=$("$PYBIN" "$SCAN" --repo "$SB" --scan-staged 2>&1) || RC10=$?
if [ "$RC10" -eq 2 ] && echo "$OUT10" | grep -q "CN_PATTERNS_MISSING"; then
  ok "  ⑩ patterns 缺失 → exit 2 + code=CN_PATTERNS_MISSING（fail-closed）"
else
  no "  ⑩ patterns 缺失应 exit 2，实际 ${RC10} :: ${OUT10}"
fi
printf '{"version":1,"salt":"NOT-HEX","entries":[],"pathEntries":[]}\n' > "$PAT"
RC11=0; "$PYBIN" "$SCAN" --repo "$SB" --scan-staged >/dev/null 2>&1 || RC11=$?
[ "$RC11" -eq 2 ] && ok "  ⑪ salt 非 hex（数据文件损坏）→ exit 2" || no "  ⑪ 损坏数据文件应 exit 2，实际 ${RC11}"
mv "$PAT.saved" "$PAT"

echo ""
echo "── 收尾: 红证零残留（可判定口径）──"
IN_SB=$(grep -rlF "$RED_MARK" "$SB" | wc -l | tr -d ' ')
echo "  沙箱内含红证标记的文件数=${IN_SB}（沙箱由 trap 整体删除 ⇒ 本卡零残留）"
# ⚠️ 不拿「全仓 grep 标记 = 0」当判据：仓库内**存量** 15 个治理/证据文档本身就含该字面量
#   （属他人产物，2026-09-29 实测已上报队长），全仓 0 不可能在不改他人文件的前提下达成。
LEAK=0
for f in scripts/control-tower/scan-client-names.py scripts/control-tower/client-name-patterns.json \
         scripts/pre-commit-check.sh .gitignore tests/control-tower/scan-client-names.test.sh \
         tests/control-tower/client-name-gate.test.sh; do
  if [ -f "$REPO/$f" ] && grep -qF "$RED_MARK" "$REPO/$f"; then
    echo "  本卡产物含红证标记: $f"; LEAK=$((LEAK + 1))
  fi
done
[ "$LEAK" -eq 0 ] && ok "本卡产物红证零残留" || no "本卡产物残留红证 ${LEAK} 件"

echo ""
echo "结果: ${PASS} 通过, ${FAIL} 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
