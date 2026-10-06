#!/usr/bin/env bash
# D2/D1177 判别夹具：台账**自洽**检查（ID 唯一 + path 存在）
#
# 为什么单独一个夹具：原门禁只做 substring 登记判定，**从不校验台账自身**
# ⇒ 「重复 ID / 悬空 path」这类缺陷**没有任何检查覆盖**。
# 本夹具用**改坏即红**（V-08）证明新检查真的有判别力 —— 且**两个方向都测**：
#   · 正常台账 ⇒ exit 0（不误红）
#   · 人为注入重复 ID ⇒ exit 1 且点名
#   · 人为注入 active 悬空 path ⇒ exit 1 且点名
#   · 🔴 反向对照：把同一条悬空 path 的 status 改成 draft ⇒ **不再红**（证明豁免是有界的，不是把检查关掉）
#   · glob path 有匹配 ⇒ 不红；glob 无匹配 ⇒ 红（证明 glob 真的被展开过，不是跳过）
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

SUT="scripts/doc-system/doc-registry-gate.sh"
NP=0; NF=0
ok() { echo "  ✅ $1"; NP=$((NP + 1)); }
no() { echo "  ❌ $1"; NF=$((NF + 1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1 expect=$3 got=$2"; fi; }

echo "── D1177 · 台账自洽检查判别夹具 ──"

# 🔴 夹具第一版失败的原因（记下来，避免下次再犯）:
#   门禁把台账里的 path 按 **$ROOT/<path>** 解析。第一版只把 registry 拷进空临时目录
#   ⇒ **全部 50 条仓内 path 都"不存在"** ⇒ 正常台账也判红，三条用例被同一个原因带偏。
#   ⇒ 正确做法：在临时根里**软链真实仓库的顶层条目**（含 `docs/` 下的每一项），
#      再放一份**可改写**的 registry 副本。这样"存在性"是真的，"可篡改"也是真的。
SELF_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkroot() { # $1 = 目标目录
  rm -rf "$1"; mkdir -p "$1"
  local e
  for e in "$SELF_ROOT"/* "$SELF_ROOT"/.[!.]*; do
    [ -e "$e" ] || continue
    local b; b="$(basename "$e")"
    [ "$b" = "docs" ] && continue          # docs 单独处理（要放可篡改的 registry）
    ln -s "$e" "$1/$b" 2>/dev/null || true
  done
  mkdir -p "$1/docs"
  for e in "$SELF_ROOT"/docs/*; do
    [ -e "$e" ] || continue
    ln -s "$e" "$1/docs/$(basename "$e")" 2>/dev/null || true
  done
  # 🔴 致命陷阱（本次实际踩到，须写下来）：`docs/authority` 上一轮被软链到了**真实目录**
  #   ⇒ 后面 `cp`/python 改写临时路径时**穿过了软链，改到了真仓库的台账**（我真把工作区的
  #   DOCS-REGISTRY.yaml 改坏了，靠 `git checkout --` 还原）。⇒ 必须①rm 掉那个软链、②用真目录、
  #   ③**每次改写前断言目标不是软链**（fail-closed，见 guard_real()）。
  rm -f "$1/docs/authority"
  mkdir -p "$1/docs/authority"
  # authority 下**除台账外**的文件仍软链过去（否则它们会全部算"悬空" —— 第一版就是这么错的）
  local f
  for f in "$SELF_ROOT"/docs/authority/*; do
    [ -e "$f" ] || continue
    [ "$(basename "$f")" = "DOCS-REGISTRY.yaml" ] && continue
    ln -s "$f" "$1/docs/authority/$(basename "$f")" 2>/dev/null || true
  done
  cp "$SELF_ROOT/docs/authority/DOCS-REGISTRY.yaml" "$1/docs/authority/DOCS-REGISTRY.yaml"
  [ -L "$1/docs/authority" ] && { echo "  ❌ 夹具自检失败: docs/authority 仍是软链 ⇒ 会改到真仓库"; exit 2; }
}
REAL_REG="$SELF_ROOT/docs/authority/DOCS-REGISTRY.yaml"
REAL_SUM="$(shasum -a 256 "$REAL_REG" | awk '{print $1}')"
guard_real() { # 🔴 每次篡改后调用：真仓库台账必须**逐字节未变**
  local now; now="$(shasum -a 256 "$REAL_REG" | awk '{print $1}')"
  if [ "$now" != "$REAL_SUM" ]; then
    echo "  ❌ **夹具污染了真仓库台账** —— 立即中止（这是夹具自身的缺陷，不是被测对象的）"
    exit 2
  fi
}
rung() { DOC_TRUTH_ROOT="$1" bash "$SUT" 2>&1; }

# ── 0. 正常台账 ⇒ 不误红 ──
T=$(mktemp -d); mkroot "$T"
OUT=$(rung "$T"); RC=$?
chk "正常台账: exit 0" "$RC" "0"
echo "$OUT" | grep -q "台账 ID 唯一" && ok "正常台账: 打印 ID 唯一结论" || no "正常台账: 缺 ID 判定行"

# ── 1. 注入重复 ID ⇒ 必红 ──
T2=$(mktemp -d); mkroot "$T2"
python3 - "$T2" <<'PY'
import io,sys,re
p=sys.argv[1]+"/docs/authority/DOCS-REGISTRY.yaml"
s=io.open(p,encoding="utf-8").read()
# 把第 2 个条目（DOC-0101）的 id 改成 DOC-0100（与第 1 个重复，若不存在则自造）
ids=re.findall(r'^\s*-\s*id:\s*(\S+)',s,re.M)
first=ids[0]
s=s.replace("- id: %s"%ids[5], "- id: %s"%first, 1)
io.open(p,"w",encoding="utf-8").write(s)
PY
guard_real
OUT=$(rung "$T2"); RC=$?
chk "注入重复 ID: exit 1" "$RC" "1"
echo "$OUT" | grep -q "台账 ID 重复" && ok "注入重复 ID: 点名" || no "注入重复 ID: 未点名"

# ── 2. 注入 active 悬空 path ⇒ 必红 ──
T3=$(mktemp -d); mkroot "$T3"
python3 - "$T3" <<'PY'
import io,sys
p=sys.argv[1]+"/docs/authority/DOCS-REGISTRY.yaml"
s=io.open(p,encoding="utf-8").read()
# 追加一条**合成条目**（status=active + 不存在的 path）—— 比"改某条既有条目"确定：
#   第一版改成 docs/authority/PRD.md 时，那条**恰好是 draft** ⇒ 被豁免 ⇒ 用例假过。
s += ("\n  - id: DOC-0999\n    type: governance\n"
      "    path: docs/authority/THIS-DOES-NOT-EXIST.md\n    status: active\n    owner: fixture\n")
io.open(p,"w",encoding="utf-8").write(s)
PY
guard_real
OUT=$(rung "$T3"); RC=$?
chk "注入 active 悬空 path: exit 1" "$RC" "1"
echo "$OUT" | grep -q "台账 path 悬空: docs/authority/THIS-DOES-NOT-EXIST.md" && ok "注入悬空 path: 点名到具体路径" || no "注入悬空 path: 未点名"

# ── 3. 🔴 反向对照：同一悬空 path 改成 draft ⇒ 不再红（豁免**有界**）──
T4=$(mktemp -d); mkroot "$T4"
python3 - "$T4" <<'PY'
import io,sys
p=sys.argv[1]+"/docs/authority/DOCS-REGISTRY.yaml"
s=io.open(p,encoding="utf-8").read()
# 同一合成条目，只把 status 从 active 改成 draft
s += ("\n  - id: DOC-0999\n    type: governance\n"
      "    path: docs/authority/THIS-DOES-NOT-EXIST.md\n    status: draft\n    owner: fixture\n")
io.open(p,"w",encoding="utf-8").write(s)
PY
guard_real
OUT=$(rung "$T4"); RC=$?
chk "反向对照: 悬空但 draft ⇒ exit 0（豁免有界）" "$RC" "0"
echo "$OUT" | grep -q "status=draft" && ok "反向对照: SKIP 是**显式**的（不静默）" || no "反向对照: SKIP 未显式打印"

# ── 4. glob：无匹配 ⇒ 必红（证明 glob 真被展开）──
T5=$(mktemp -d); mkroot "$T5"
python3 - "$T5" <<'PY'
import io,sys
p=sys.argv[1]+"/docs/authority/DOCS-REGISTRY.yaml"
s=io.open(p,encoding="utf-8").read()
s=s.replace("    path: WORKLOG-*.md", "    path: NOSUCHGLOB-*.md", 1)
io.open(p,"w",encoding="utf-8").write(s)
PY
guard_real
OUT=$(rung "$T5"); RC=$?
chk "glob 无匹配: exit 1" "$RC" "1"
echo "$OUT" | grep -q "glob 无匹配" && ok "glob 无匹配: 点名" || no "glob 无匹配: 未点名"

rm -rf "$T" "$T2" "$T3" "$T4" "$T5"
echo "RESULT: $NP PASS / $NF FAIL"
[ "$NF" -eq 0 ] || exit 1
exit 0
