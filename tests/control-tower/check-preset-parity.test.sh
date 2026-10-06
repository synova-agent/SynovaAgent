#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-preset-parity.test.sh — C2 跨机预设/技能一致性检查的判别夹具（判据⑤「改坏即红」）
#
# 被测: scripts/control-tower/check-preset-parity.sh
# 规格源: /Users/wane/山河研究院/05-组织协作工作流/补充研究-2-Win侧完整规格.md
#   [W]:261 指纹四项 + 两文件逐字节比对；[W]:277 验收（人为改一侧→CI 红）；[W]:284 先建议级
#
# 覆盖矩阵（铁律 48: 正常/降级/边界；铁律 0-2: red→green）:
#   正常  T1 --generate 产出四项（走真实入口，非 mock）           → exit 0 + 落盘四项如实
#   正常  T2 幂等 + 只写本侧（二次 generate 整树摘要不变）         → 同字节
#   正常  T3 两侧同源 → --check 逐字节一致                        → exit 0 + PARITY: OK
#   占位  T4 对侧为合法占位（本树 win.json 同形态）                → exit 0 + PARITY: PENDING
#   🔴红  T5 **改坏即红（判据⑤）**: 四项各改一项 → 逐条点名        → exit 1 + ADVISORY-RED
#   🔴红  T6 占位里塞指纹值（伪造对侧数据）                        → exit 1 + VIOLATION
#   边界  T7 对侧多一个 skill（17 vs 16）→ 点名该 skill           → exit 1
#   边界  T8 skill 摘要取**整目录**（加一个附属文件 → 摘要变）      → 摘要不等
#   降级  T9 文件缺失 / JSON 不可解析 / 未给模式 / 未知参数 / 未知侧 → exit 2 + degraded
#   降级  T10 skills 目录缺失（零 skill 无判定价值）               → exit 2
#   零写  T11 --check 模式**零写入**（整树摘要前后不变）           → 摘要相等
#   自证  T12 判别性变异体（点名逻辑恒真 → 点名行消失）            → 夹具断言依赖真实判据
#
# 隔离: mktemp 沙箱 + SYNO_* 注入缝 → 不碰真实仓库/真实 ~/.dsh*；被测脚本只读仓内文件。
# 平台: PYBIN 三级探测（禁裸 python3）；无 sed -i；无 grep -P；无 date +%s；
#       一律 grep -qF 固定串（不依赖 ERE/BRE 方言）；json 改坏走 python（跨平台）。
# 用法: bash tests/control-tower/check-preset-parity.test.sh
# 退出码: 0 = 全部通过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECK="$REPO_DIR/scripts/control-tower/check-preset-parity.sh"

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "❌ 降级: python 不可用（python3/python/py 均缺失或不可运行）—— 夹具无法运行" >&2
  exit 2
fi
if [ ! -f "$CHECK" ]; then
  echo "❌ 缺被测脚本: $CHECK" >&2
  exit 2
fi

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_rc() { # <got> <want> <msg>
  if [ "$1" -eq "$2" ]; then pass "$3"; else fail "$3（got rc=$1, want rc=$2）"; fi
}
assert_eq() { # <got> <want> <msg>
  if [ "$1" = "$2" ]; then pass "$3"; else fail "$3（got=$1 want=$2）"; fi
}
assert_ne() { # <a> <b> <msg>
  if [ "$1" != "$2" ]; then pass "$3"; else fail "$3（两者相同=$1，应为不同）"; fi
}
assert_has() { # <haystack> <fixed-needle> <msg>
  if printf '%s' "$1" | grep -qF -- "$2"; then pass "$3"; else fail "$3（缺串: $2）"; fi
}
assert_absent() { # <haystack> <fixed-needle> <msg>
  if printf '%s' "$1" | grep -qF -- "$2"; then fail "$3（不应出现: $2）"; else pass "$3"; fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
[ -n "$TMP" ] && [ -d "$TMP" ] || { echo "❌ 降级: mktemp 沙箱不可用" >&2; exit 2; }

SKILLS="brief-compose claim-verifier contract-template cto-handover ctrl-tower-change \
dev-doc-delivery dev-doc-spec dsh-decision-lens git-sync-pr north-star-guard pr-review \
pre-dispatch-check squad-discipline synova-audit synova-verify windows-compat"

# ── 沙箱造侧: 16 skill（含 1 个带附属文件的 dev-doc-delivery 型）+ 2 预设 + 断面源 + profile ──
mk_side() { # <root> [<skill 数，缺省 16>]
  local root="$1" n="${2:-16}" i=0 s
  mkdir -p "$root/.dsh/skills" "$root/docs/synova/presets/synova-squad-lead" \
    "$root/docs/synova/presets/synova-k3-audit" "$root/docs/synova/coordination" \
    "$root/profiles/desktop"
  for s in $SKILLS; do
    i=$((i + 1)); [ "$i" -le "$n" ] || break
    mkdir -p "$root/.dsh/skills/$s"
    printf '# %s\n正文 %s\n' "$s" "$s" > "$root/.dsh/skills/$s/SKILL.md"
  done
  mkdir -p "$root/.dsh/skills/brief-compose/template"
  printf '模板正文\n' > "$root/.dsh/skills/brief-compose/template/编码指令模板.md"
  printf -- '- id: preset-synova-squad-lead\n' > "$root/docs/synova/presets/synova-squad-lead/cordis.patch.yml"
  printf -- '- id: preset-synova-k3-audit\n' > "$root/docs/synova/presets/synova-k3-audit/cordis.patch.yml"
  "$PYBIN" - "$root" <<'PY'
import json
import sys
root = sys.argv[1]
with open(root + "/docs/synova/coordination/DSH-断面.json", "wb") as f:
    f.write((json.dumps({"authority": "夹具", "current": {"version": "9.9.9-test",
               "head": "deadbeef", "tag": "dsh-v9.9.9-test"}}, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
with open(root + "/profiles/desktop/package.json", "wb") as f:
    f.write((json.dumps({"name": "desktop", "dsh": {"profile": {"bundles": ["a", "b", "c"]}}},
               ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
PY
}

gen() { # <root> <side> → stdout+stderr 合一
  SYNO_PARITY_REPO_DIR="$1" SYNO_PROFILE_DIR="$1/profiles/desktop" \
    bash "$CHECK" --generate --side "$2" 2>&1
}
chk() { # <a> <b> [<extra 参数，可省>]
  bash "$CHECK" --check --a "$1" --b "$2" ${3:-} 2>&1
}
mut_json() { # <in> <out> <mode> [<arg>] —— 改坏/伪造（禁 sed -i）
  "$PYBIN" - "$1" "$2" "$3" "${4:-}" <<'PY'
import json
import sys
src, dst, mode, arg = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(src, encoding="utf-8") as f:
    doc = json.load(f)
if mode == "skill":
    doc["skills_sha256"][arg] = "0" * 64
elif mode == "skill_add":
    doc["skills_sha256"][arg] = "1" * 64
elif mode == "preset":
    doc["preset_cordis_patch_sha256"][arg] = "2" * 64
elif mode == "tag":
    doc["dsh_anchor_tag"] = "dsh-broken-by-fixture"
elif mode == "bundles":
    doc["bundles_line_count"] = int(doc["bundles_line_count"]) + 1
with open(dst, "wb") as f:
    f.write((json.dumps(doc, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
PY
}
mk_placeholder() { # <out>
  "$PYBIN" - "$1" <<'PY'
import json
import sys
with open(sys.argv[1], "wb") as f:
    f.write((json.dumps({"schema": "synova/parity/v1", "placeholder": True, "status": "pending-win",
                         "note": "占位：待 Win 侧生成/提交", "skills_sha256": None,
                         "preset_cordis_patch_sha256": None, "dsh_anchor_tag": None,
                         "bundles_line_count": None}, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
PY
}
tree_digest() { # <dir> → 整树逐文件摘要（只读；与门禁同口径 LF 归一）
  "$PYBIN" - "$1" <<'PY'
import hashlib
import sys
from pathlib import Path
root = Path(sys.argv[1])
h = hashlib.sha256()
for p in sorted((x for x in root.rglob("*") if x.is_file()), key=lambda x: x.as_posix()):
    h.update(p.relative_to(root).as_posix().encode("utf-8"))
    h.update(b"\0")
    h.update(p.read_bytes().replace(b"\r\n", b"\n"))
    h.update(b"\n")
print(h.hexdigest())
PY
}
get_hash() { # <json> <skill-id>
  "$PYBIN" -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8"))["skills_sha256"].get(sys.argv[2],"(缺失)"))' "$1" "$2"
}

A="$TMP/side-a"
B="$TMP/side-b"
mk_side "$A"
mk_side "$B"
MAC="$A/docs/synova/parity/mac.json"
WIN="$B/docs/synova/parity/win.json"

echo "=== T1 正常: --generate 产出四项（真实入口） ==="
OUT="$(gen "$A" mac)"; rc=$?
assert_rc "$rc" 0 "T1.1 generate mac exit 0"
assert_has "$OUT" "PARITY: GENERATED mac" "T1.2 摘要行 PARITY: GENERATED mac"
assert_has "$OUT" "skills=16 preset=2 tag=dsh-v9.9.9-test bundles=3" "T1.3 四项计数如实（16/2/tag/3）"
if [ -f "$MAC" ]; then pass "T1.4 落点 docs/synova/parity/mac.json 存在"; else fail "T1.4 未生成 $MAC"; fi
ITEMS="$("$PYBIN" -c 'import json,sys;d=json.load(open(sys.argv[1],encoding="utf-8"));print(len(d["skills_sha256"]),len(d["preset_cordis_patch_sha256"]),d["bundles_line_count"],d["dsh_anchor_tag"],d["schema"])' "$MAC" 2>/dev/null || echo READ-FAIL)"
assert_eq "$ITEMS" "16 2 3 dsh-v9.9.9-test synova/parity/v1" "T1.5 落盘四项 + schema 正确"
assert_has "$OUT" "profile-dir: $A/profiles/desktop" "T1.6 解析面逐行可观测（profile-dir 打印）"

echo "=== T2 正常: 幂等 + 只写本侧 ==="
H1="$(tree_digest "$A")"
OUT="$(gen "$A" mac)"; rc=$?
H2="$(tree_digest "$A")"
assert_rc "$rc" 0 "T2.1 二次 generate exit 0"
assert_eq "$H2" "$H1" "T2.2 逐字节幂等（整树摘要不变）"
assert_absent "$(ls "$A/docs/synova/parity")" "win.json" "T2.3 --side mac 不写对侧（不伪造 Win 数据）"

echo "=== T3 正常: 两侧同源 → --check 一致 ==="
OUT="$(gen "$B" win)"; rc=$?
assert_rc "$rc" 0 "T3.1 generate win exit 0"
OUT="$(chk "$MAC" "$WIN")"; rc=$?
assert_rc "$rc" 0 "T3.2 同源两侧 → exit 0"
assert_has "$OUT" "PARITY: OK" "T3.3 摘要行 PARITY: OK"
assert_has "$OUT" "逐字节一致" "T3.4 判据为逐字节比对"
assert_has "$OUT" "[OK] skills_sha256（A=16 B=16" "T3.5 逐项判定行在场"

echo "=== T4 占位: 对侧为合法占位 → PENDING（不判红、不伪造） ==="
mk_placeholder "$WIN"
OUT="$(chk "$MAC" "$WIN")"; rc=$?
assert_rc "$rc" 0 "T4.1 合法占位 → exit 0"
assert_has "$OUT" "PARITY: PENDING" "T4.2 摘要行 PARITY: PENDING"
assert_has "$OUT" "待 win 侧生成/提交" "T4.3 明确标注待对侧提交"

echo "=== T5 🔴 改坏即红（判据⑤）: 四项各改一项 → 逐条点名 ==="
mut_json "$MAC" "$TMP/t5-skill.json" skill cto-handover
OUT="$(chk "$MAC" "$TMP/t5-skill.json")"; rc=$?
assert_rc "$rc" 1 "T5.1 改坏 skills 一项 → exit 1"
assert_has "$OUT" "cto-handover" "T5.2 点名被改的 skill"
assert_has "$OUT" "[DIFF] skills_sha256" "T5.3 点名所属项"
assert_has "$OUT" "ADVISORY-RED" "T5.4 标注建议级红（[W]:284 不阻断）"
OUT="$(chk "$MAC" "$TMP/t5-skill.json" --advisory)"; rc=$?
assert_rc "$rc" 0 "T5.5 同输入 --advisory → exit 0（建议级用）"
mut_json "$MAC" "$TMP/t5-tag.json" tag
OUT="$(chk "$MAC" "$TMP/t5-tag.json")"; rc=$?
assert_rc "$rc" 1 "T5.6 改坏 dsh_anchor_tag → exit 1"
assert_has "$OUT" "[DIFF] dsh_anchor_tag" "T5.7 点名 dsh_anchor_tag"
mut_json "$MAC" "$TMP/t5-bundles.json" bundles
OUT="$(chk "$MAC" "$TMP/t5-bundles.json")"; rc=$?
assert_rc "$rc" 1 "T5.8 改坏 bundles_line_count → exit 1"
assert_has "$OUT" "[DIFF] bundles_line_count: A=3 B=4" "T5.9 点名 bundles 两侧值"
mut_json "$MAC" "$TMP/t5-preset.json" preset synova-squad-lead
OUT="$(chk "$MAC" "$TMP/t5-preset.json")"; rc=$?
assert_rc "$rc" 1 "T5.10 改坏预设 sha256 → exit 1"
assert_has "$OUT" "synova-squad-lead" "T5.11 点名被改的预设"

echo "=== T6 🔴 占位被塞指纹值（伪造对侧数据）→ VIOLATION ==="
"$PYBIN" - "$TMP/t6-holder.json" <<'PY'
import json
import sys
with open(sys.argv[1], "wb") as f:
    f.write((json.dumps({"schema": "synova/parity/v1", "placeholder": True, "status": "pending-win",
                         "note": "占位", "skills_sha256": None, "preset_cordis_patch_sha256": None,
                         "dsh_anchor_tag": None, "bundles_line_count": 3},
                        ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
PY
OUT="$(chk "$MAC" "$TMP/t6-holder.json")"; rc=$?
assert_rc "$rc" 1 "T6.1 占位携带指纹值 → exit 1（占位不是免检后门）"
assert_has "$OUT" "PARITY: VIOLATION" "T6.2 摘要行 PARITY: VIOLATION"
assert_has "$OUT" "占位不得携带指纹值" "T6.3 点名违规原因"

echo "=== T7 边界: 对侧多一个 skill（17 vs 16）→ 点名 ==="
mut_json "$MAC" "$TMP/t7-extra.json" skill_add zzz-extra-skill
OUT="$(chk "$MAC" "$TMP/t7-extra.json")"; rc=$?
assert_rc "$rc" 1 "T7.1 数量不等 → exit 1"
assert_has "$OUT" "zzz-extra-skill" "T7.2 点名多出的 skill"
assert_has "$OUT" "A=16 B=17" "T7.3 两侧计数如实"

echo "=== T8 边界: skill 摘要取整目录（加附属文件 → 摘要变） ==="
mk_side "$TMP/side-c"
H_BASE="$(get_hash "$MAC" brief-compose)"
printf '追加\n' > "$TMP/side-c/.dsh/skills/brief-compose/template/新增附属.md"
gen "$TMP/side-c" mac >/dev/null 2>&1
H_NEW="$(get_hash "$TMP/side-c/docs/synova/parity/mac.json" brief-compose)"
assert_ne "$H_NEW" "$H_BASE" "T8.1 附属文件改变 → skill 摘要改变（整目录口径，非只看 SKILL.md）"

echo "=== T9 降级: 缺失/不可解析/参数错 → exit 2 + degraded ==="
OUT="$(chk "$TMP/none.json" "$MAC")"; rc=$?
assert_rc "$rc" 2 "T9.1 A 侧缺失 → exit 2"
assert_has "$OUT" "degraded:" "T9.2 显式 degraded 行（不静默）"
assert_has "$OUT" "PARITY: DEGRADED" "T9.3 摘要行 PARITY: DEGRADED"
printf '{ 坏 json' > "$TMP/bad.json"
OUT="$(chk "$TMP/bad.json" "$MAC")"; rc=$?
assert_rc "$rc" 2 "T9.4 JSON 不可解析 → exit 2"
OUT="$(bash "$CHECK" 2>&1)"; rc=$?
assert_rc "$rc" 2 "T9.5 未给模式 → exit 2"
OUT="$(bash "$CHECK" --check --bogus 2>&1)"; rc=$?
assert_rc "$rc" 2 "T9.6 未知参数 → exit 2"
OUT="$(gen "$A" solaris)"; rc=$?
assert_rc "$rc" 2 "T9.7 未知侧别 → exit 2"
assert_has "$OUT" "degraded:" "T9.8 未知侧别显式降级"

echo "=== T10 降级: skills 目录缺失（零 skill 无判定价值） ==="
mk_side "$TMP/side-d"
rm -rf "$TMP/side-d/.dsh/skills"
OUT="$(gen "$TMP/side-d" mac)"; rc=$?
assert_rc "$rc" 2 "T10.1 skills 目录缺失 → exit 2"
assert_has "$OUT" "degraded:" "T10.2 显式 degraded 行"
if [ -f "$TMP/side-d/docs/synova/parity/mac.json" ]; then fail "T10.3 降级时不得落盘"; else pass "T10.3 降级时零落盘"; fi

echo "=== T11 零写入: --check 模式整树摘要前后不变 ==="
mk_side "$TMP/side-e"
gen "$TMP/side-e" mac >/dev/null 2>&1
cp "$TMP/side-e/docs/synova/parity/mac.json" "$TMP/side-e/docs/synova/parity/win.json"
H1="$(tree_digest "$TMP/side-e")"
chk "$TMP/side-e/docs/synova/parity/mac.json" "$TMP/side-e/docs/synova/parity/win.json" >/dev/null 2>&1
chk "$TMP/side-e/docs/synova/parity/mac.json" "$TMP/side-e/docs/synova/parity/win.json" --advisory >/dev/null 2>&1
H2="$(tree_digest "$TMP/side-e")"
assert_eq "$H2" "$H1" "T11.1 --check（含 diag 失败路径）零写入"

echo "=== T12 判别性自证: 点名逻辑变异体 → 夹具断言不再成立 ==="
MUT="$TMP/mutant.sh"
"$PYBIN" - "$CHECK" "$MUT" <<'PY'
import sys
with open(sys.argv[1], encoding="utf-8") as f:
    src = f.read()
needle = "if va == vb:"
if src.count(needle) != 1:
    sys.stderr.write("变异点不唯一: %d\n" % src.count(needle))
    sys.exit(1)
with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as f:
    f.write(src.replace(needle, "if True:"))
PY
OUT="$(bash "$MUT" --check --a "$MAC" --b "$TMP/t5-skill.json" 2>&1)"; rc=$?
assert_has "$OUT" "PARITY: DIFF" "T12.1 变异体仍报不一致（红/绿由逐字节比对定，未变）"
assert_absent "$OUT" "cto-handover" "T12.2 变异体不再逐条点名 ⇒ T5.2 的断言依赖真实判据（非空洞）"

echo "──── 结果: $PASS 通过, $FAIL 失败 ────"
[ "$FAIL" = "0" ] || exit 1
