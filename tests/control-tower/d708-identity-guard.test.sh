#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# d708-identity-guard.test.sh — D9206/卡 #1237: D708 身份推断护栏
#
# 病根（两个独立目击者同日，卡 #1237 载明）:
#   分支名 `fix/d734-…`（D734 = **门禁自己的号**）⇒ `infer_did()` → `源 branch → D734`
#   ⇒ 载入 **2026-09-14 的历史 brief** ⇒ ❌ block — 3 个写集外文件（夹带）
#   commit 标题写「D734」同型命中。**共同点 = D# 仅来自最弱锚点时，门禁静默取用一个"碰巧同号"的历史 brief**，
#   且**措辞一律说"夹带"** ⇒ 把排查方向引到"谁夹带了文件"而非"身份推断错了"。
#
# 本件断言四件事（全部机器可判）:
#   A. **疑似劫持必显式**（零交集 + 弱锚点 ⇒ exit 2 + 「疑似…劫持」措辞；**不得**仍说"夹带"）
#   B. **真夹带仍报夹带**（反例：有交集 + 多出未声明文件 ⇒ exit 1 + 「夹带」）—— 防判据被放宽成纸老虎
#   C. **措辞可区分**（A 的判据是"身份推断失败"族，B 是"真夹带"族；两者不共用同一句结论）
#   D. **变异体（去掉护栏）⇒ A 必红** ⇒ 证明本组断言真的在测那一行护栏
#
# 隔离: mktemp 沙箱 + 复制 gate/brief_parser/devdoc_writeset + git init；零网络、零宿主写入。
#      被测实现注入点 = SYNO_GATE_SRC（指向变异副本 ⇒ 零真实文件改动，ctrl-tower-change 模式 5）。
#
# 用法: bash tests/control-tower/d708-identity-guard.test.sh
# 退出码: 0 = 全绿；1 = 断言失败；2 = 检查自身失败（缺 python / 缺件）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE_SRC="${SYNO_GATE_SRC:-$REPO/scripts/control-tower/merge_writeset_gate.py}"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

[ -f "$GATE_SRC" ] || { echo "  ❌ 被测实现缺失: ${GATE_SRC}（检查自身失败）"; exit 2; }
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
echo "=== D708 身份推断护栏（D9206 · 卡 #1237）==="

# ── 沙箱构造: 复制 gate + 依赖 + git 基线 ──
build_sb() {
  local sb="$1" gate_src="$2"
  mkdir -p "$sb/scripts/control-tower" "$sb/.claude/task-briefs" "$sb/src"
  cp "$gate_src" "$sb/scripts/control-tower/merge_writeset_gate.py"
  cp "$REPO/scripts/control-tower/brief_parser.py" "$sb/scripts/control-tower/"
  cp "$REPO/scripts/control-tower/devdoc_writeset.py" "$sb/scripts/control-tower/"
  [ -f "$REPO/scripts/control-tower/claim_store.py" ] && cp "$REPO/scripts/control-tower/claim_store.py" "$sb/scripts/control-tower/"
  git -C "$sb" init -q
  git -C "$sb" config user.email t@t.local
  git -C "$sb" config user.name t
  printf 'seed\n' > "$sb/seed.txt"
  git -C "$sb" add -A >/dev/null 2>&1
  git -C "$sb" commit -q -m "chore: base"
}

# 写「碰巧同号的历史 brief」: 文件名带 D734、写集与本场景变更集**零交集**
write_old_brief() {  # $1 = sandbox $2 = 日期前缀 $3.. = 写集路径
  local sb="$1" d="$2"; shift 2
  {
    printf '#CRITERIA: A\n\n# Task Brief: D734 历史件（疑似劫持源）\n\n## Q0: 定位\n控制塔。\n\n'
    printf '## Q1: 调研\n铁律 35。\n\n## Q2: 范围 — 最简方案\n做什么:\n'
    for f in "$@"; do printf -- '- %s\n' "$f"; done
    printf '不做什么:\n- 不改 scripts/audit/audit-rules.sh\n\n'
    printf '## Q3: 验收\n入口: CI。\n\n## 架构层: scripts\n\n## Done 标准\n- [x] verify: x\n'
  } > "$sb/.claude/task-briefs/${d}-D734-old-brief.md"
  git -C "$sb" add -A >/dev/null 2>&1
  git -C "$sb" commit -q -m "docs(D734): 历史 brief 落库"
}

# 场景: 先立 base（含 brief），再写变更集 ⇒ --base..HEAD 只含本场景改动
scene_hijack() {  # $1 = sandbox ；分支名带门禁自己的号 D734，变更集与 brief 零交集
  local sb="$1"
  write_old_brief "$sb" "2026-09-14" "src/unrelated/zzz.ts"
  local base; base="$(git -C "$sb" rev-parse HEAD)"
  mkdir -p "$sb/src/a" "$sb/src/b" "$sb/src/c"
  printf 'a\n' > "$sb/src/a/x.ts"; printf 'b\n' > "$sb/src/b/y.ts"; printf 'c\n' > "$sb/src/c/z.ts"
  git -C "$sb" add -A >/dev/null 2>&1
  git -C "$sb" commit -q -m "fix: 与 D734 无关的三处改动"
  printf '%s' "$base"
}

run_gate() {  # $1 = sb  $2 = base  $3 = branch
  ( cd "$1" && "$PYBIN" "$1/scripts/control-tower/merge_writeset_gate.py" \
      --repo-root "$1" --base "$2" --head HEAD --branch "$3" 2>&1 )
}

# ══════════════════════════════════════════════════════════════════════════════
# A. 疑似劫持（零交集 + 弱锚点）⇒ 显式报「疑似…劫持」，不得说"夹带"
# ══════════════════════════════════════════════════════════════════════════════
SB_A="$TMPD/sbA"; build_sb "$SB_A" "$GATE_SRC"
BASE_A="$(scene_hijack "$SB_A")"
OUT_A="$(run_gate "$SB_A" "$BASE_A" "fix/d734-identity-guard-probe")"; RC_A=$?

[ "$RC_A" -eq 2 ] && ok "A1 疑似劫持 ⇒ exit 2（fail-closed，非静默取用）" \
  || no "A1 期望 exit 2, 实际 exit=$RC_A"
case "$OUT_A" in
  *疑似*)     ok "A2 措辞含「疑似」（区分于断言式定罪）" ;;
  *)          no "A2 措辞缺「疑似」: $(printf '%s' "$OUT_A" | tail -3)" ;;
esac
case "$OUT_A" in
  *劫持*)     ok "A3 措辞含「劫持」（点名身份推断面）" ;;
  *)          no "A3 措辞缺「劫持」" ;;
esac
case "$OUT_A" in
  *身份推断*) ok "A4 措辞显式归属到「身份推断」（排查方向不被引到文件）" ;;
  *)          no "A4 措辞未显式点「身份推断」: $(printf '%s' "$OUT_A" | tail -3)" ;;
esac
case "$OUT_A" in
  *检测到*夹带*) no "A5 仍用「夹带」结论（会把排查方向引到文件，见卡 #1237 要求 3）" ;;
  *)             ok "A5 未复用「夹带」结论（措辞与真夹带分离）" ;;
esac

# ══════════════════════════════════════════════════════════════════════════════
# B. 反例: 真夹带（brief 命中 1 件 + 多出未声明件）⇒ 仍报「夹带」，护栏不得放宽
# ══════════════════════════════════════════════════════════════════════════════
SB_B="$TMPD/sbB"; build_sb "$SB_B" "$GATE_SRC"
write_old_brief "$SB_B" "2026-10-08" "src/a/x.ts"
BASE_B="$(git -C "$SB_B" rev-parse HEAD)"
mkdir -p "$SB_B/src/a" "$SB_B/src/b"
printf 'a\n' > "$SB_B/src/a/x.ts"
printf 'b\n' > "$SB_B/src/b/undeclared.ts"
git -C "$SB_B" add -A >/dev/null 2>&1
git -C "$SB_B" commit -q -m "feat(D734): 声明 1 件但实际带 2 件"
OUT_B="$(run_gate "$SB_B" "$BASE_B" "fix/d734-smuggle-probe")"; RC_B=$?

[ "$RC_B" -eq 1 ] && ok "B1 真夹带 ⇒ exit 1（未阻断，仅判夹带）" \
  || no "B1 期望 exit 1, 实际 exit=${RC_B}（护栏把真夹带也吞了 = 判据失效）"
case "$OUT_B" in
  *夹带*)   ok "B2 真夹带仍报「夹带」（反例成立：判据未被放宽成纸老虎）" ;;
  *)        no "B2 真夹带未报夹带: $(printf '%s' "$OUT_B" | tail -3)" ;;
esac
case "$OUT_B" in
  *疑似*)   no "B3 真夹带被误报「疑似劫持」（误伤）" ;;
  *)        ok "B3 真夹带未被误报为疑似劫持" ;;
esac

# ══════════════════════════════════════════════════════════════════════════════
# D. 变异体: 去掉护栏 ⇒ A 场景必须**重回到静默取用**（A1/A3 变红 ⇒ 本组断言有判别力）
# ══════════════════════════════════════════════════════════════════════════════
MUT="$TMPD/mutated-gate.py"
"$PYBIN" - "$GATE_SRC" "$MUT" <<'PYMUT'
import re, sys
from pathlib import Path
src, dst = Path(sys.argv[1]), Path(sys.argv[2])
t = src.read_text(encoding="utf-8")
# 变异: 把护栏的触发条件改成恒假（等价于"去掉护栏"）
m = re.search(r"^(?P<ind>\s*)if [^\n]*HIJACK[^\n]*:\s*$", t, re.M)
assert m, "未找到护栏触发行（判据锚点漂移 —— 夹具需同步）"
t = t[:m.start()] + f"{m.group('ind')}if False:  # MUTANT: 护栏被去掉\n" + t[m.end():]
dst.write_text(t, encoding="utf-8")
print("MUTANT: 护栏条件 → if False", file=sys.stderr)
PYMUT
if [ ! -f "$MUT" ]; then
  no "D0 变异体构造失败（缺 HIJACK 判据锚点 —— 夹具需同步）"
else
  SB_D="$TMPD/sbD"; build_sb "$SB_D" "$MUT"
  BASE_D="$(scene_hijack "$SB_D")"
  OUT_D="$(run_gate "$SB_D" "$BASE_D" "fix/d734-identity-guard-probe")"; RC_D=$?
  if [ "$RC_D" -eq 2 ] && case "$OUT_D" in *疑似*劫持*) true;; *) false;; esac; then
    no "D1 变异体: 去掉护栏后**仍**报疑似劫持 —— 判别力失效（该断言与护栏无关）"
  else
    ok "D1 变异体: 去掉护栏 ⇒ 回到静默取用（exit=${RC_D}，无「疑似劫持」）⇒ 本组断言确有判别力"
  fi
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
