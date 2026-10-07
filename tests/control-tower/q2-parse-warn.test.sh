#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# q2-parse-warn.test.sh — D1241 / #1308: Q2「不可匹配条目」不得再静默 0 匹配
#
# SUT: scripts/control-tower/brief_parser.py（q2_entry_hazard / _q2_warn）
#      + scripts/workflow/resolve-commit-brief.sh（消费方: 传 source 给解析器）
#      + scripts/commit-msg-check.sh（消费方: 透传 Q2-PARSE-WARN 到提交端）
#
# 病根（#1308，实测）: Q2 条目写成「反引号包裹 / 行内尾随说明 / 通配符 / 全角分隔符」时
#   parse_q2 提取出的 token 经 match_path 恒不中 ⇒ **认领数恒 0 且静默** ⇒ 提交端以
#   「提交声明与暂存文件归属不一致 — 疑似并行劫持」暴露（措辞把排查引偏一轮）。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 判别性 + 接线）:
#   A 正常  — 裸路径条目 ⇒ --q2-include 输出该路径，**零**告警（不误报），且 match_path 可命中
#   B 边界  — 反引号包裹 ⇒ stderr 显式 Q2-PARSE-WARN（带 source:line + 原因）；
#             同一形态实测 match_path **不可命中**（= 复现"静默 0 匹配"的物理机制）
#   C 边界  — 行内尾随说明 ⇒ 同 B
#   D 契约  — stdout 仍只输出路径流（告警只走 stderr，不污染 --q2-include 的 5 处消费）
#   E 半径  — include 段查、exclude 段**不**查（exclude 散文条目不告警；半径理由见判据注释）
#   F 端到端— resolver: 反引号 brief 认领 0 / 裸路径 brief 认领 1 ⇒ 输出裸路径 brief（1:0 复现）
#             且 stderr 点名反引号 brief（根因可见化，不再只在结果侧报"不一致"）
#   G 端到端— 同数且身份锚点全未命中 ⇒ RESOLVER-TIE（stderr）标记「最弱裁决=字典序」可见
#   M1 变异 — 删掉 _q2_warn 调用 ⇒ B/C 的告警断言**必红**（防退回静默）
#   对照    — 未变异副本 B/C 仍告警（证明 M1 的翻转来自变异本身，非沙箱失真）
#   H 措辞  — 提交端两类原因可区分: 双方声明不一致 ⇒ 「疑似并行劫持」；
#             消息侧零声明 ⇒ 「认领解析失败（非劫持）」（两类都仍 exit 1，判定零变更）；
#             H3 = 本任务告警**展开**（根因与结论同屏）；H4 = 无关 brief 告警**折叠为计数**（降噪）
#   M2 变异 — 把两类原因压回一句 ⇒ H2 断言必红（措辞回退有判别力）
#   接线    — ① resolver 无内联 parse_q2 副本 ② resolver 传 source ③ commit-msg-check 透传前缀
#
# 语义边界（本件**不**断言的事，防假绿）:
#   · 不断言「不可匹配条目被丢弃」—— 它们**照旧进 include 列表**（输出契约零变更；
#     本卡只做可见化，判红/丢弃属判据变更，须 K3→CTO）。
#   · 不断言 exit code 变化：CLI 仍 exit 0（告警不是判定）。
#   · 不断言 Q2 条目语义正确性（那是 check-brief-vs-code / G12 的职责）。
#
# 隔离: mktemp 沙箱 + 复制解析器/脚本；零网络、零宿主写入（resolver 用 mktemp git 仓库）。
# 用法: bash tests/control-tower/q2-parse-warn.test.sh
# 退出码: 0 = 全绿；1 = 断言失败；2 = 检查自身失败（缺 python / 缺 SUT）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PARSER="$REPO/scripts/control-tower/brief_parser.py"
RESOLVER="$REPO/scripts/workflow/resolve-commit-brief.sh"
CMCHECK="$REPO/scripts/commit-msg-check.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }
[ -f "$PARSER" ] || { echo "  ❌ SUT 缺失: $PARSER"; exit 2; }
[ -f "$RESOLVER" ] || { echo "  ❌ SUT 缺失: $RESOLVER"; exit 2; }
[ -f "$CMCHECK" ] || { echo "  ❌ SUT 缺失: $CMCHECK"; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
TODAY="$(date +%Y-%m-%d)"
mkdir -p "$TMPD/samples"

echo "═══════════════════════════════════════════════════════════"
echo "  D1241/#1308 Q2 不可匹配条目 — 显式化夹具"
echo "═══════════════════════════════════════════════════════════"

# ── 三样本（卡面 ③）: 裸路径 / 反引号包裹 / 行内尾随说明 ─────────────────────
cat > "$TMPD/samples/bare.md" <<'EOF'
## Q2: 范围 — 裸路径样本
做什么:
- 修改 scripts/ok.sh
不做什么:
- 不改 scripts/audit/x.sh
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF
cat > "$TMPD/samples/backtick.md" <<'EOF'
## Q2: 范围 — 反引号样本（#1308 真实事故形态）
做什么:
- `tests/target.test.sh`（反引号包裹 + 行内尾随说明）
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF
cat > "$TMPD/samples/trailing.md" <<'EOF'
## Q2: 范围 — 行内尾随说明样本
做什么:
- scripts/target.sh 行内尾随说明
不做什么:
- 不改 any prose here without path
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF

cat > "$TMPD/samples/exclude_prose.md" <<'EOF'
## Q2: 范围 — exclude 散文样本
做什么:
- 修改 scripts/clean.sh
不做什么:
- 不改 any prose here without path
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF

# ── 辅助 ──────────────────────────────────────────────────────────────────────
run_cli() {  # <parser> <sample> <tag>  → $TMPD/<tag>.out / <tag>.err
  "$PYBIN" "$1" --q2-include "$2" >"$TMPD/$3.out" 2>"$TMPD/$3.err"
  return 0
}
warn_n() {  # <tag> → 告警行数（CRLF 已剥；grep -c 无命中 rc=1 由 || true 兜住）
  local _n
  _n="$(grep -c '^Q2-PARSE-WARN:' "$TMPD/$1.err" 2>&1 | tr -d ' \r' || true)"
  case "$_n" in ''|*[!0-9]*) _n=0 ;; esac
  printf '%s' "$_n"
}
matchable() {  # <parser> <sample> <staged> → 1=至少一条条目可命中 / 0=一条都不可命中
  "$PYBIN" - "$(dirname "$1")" "$2" "$3" >"$TMPD/match.out" 2>"$TMPD/match.err" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from brief_parser import parse_q2, match_path
text = open(sys.argv[2], encoding='utf-8', errors='replace').read()
inc = parse_q2(text, source='matchable-probe')['include']
print(1 if any(match_path(sys.argv[3], p) for p in inc) else 0)
PY
  tr -d ' \r\n' < "$TMPD/match.out"
}
last_match() {  # <sample> → include 条目数
  "$PYBIN" - "$(dirname "$PARSER")" "$1" >"$TMPD/cnt.out" 2>"$TMPD/cnt.err" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from brief_parser import parse_q2
text = open(sys.argv[2], encoding='utf-8', errors='replace').read()
print(len(parse_q2(text, source='cnt-probe')['include']))
PY
  tr -d ' \r\n' < "$TMPD/cnt.out"
}

echo ""
echo "── A 正常: 裸路径样本 ⇒ 输出该路径 + 零告警 + 可命中 ──"
run_cli "$PARSER" "$TMPD/samples/bare.md" bare
if grep -qx 'scripts/ok.sh' "$TMPD/bare.out"; then ok "A 裸路径条目正常输出"; else no "A 裸路径条目丢失: $(cat "$TMPD/bare.out")"; fi
if [ "$(warn_n bare)" = "0" ]; then ok "A 裸路径条目零告警（不误报）"; else no "A 裸路径被误报为不可匹配: $(cat "$TMPD/bare.err")"; fi
if [ "$(matchable "$PARSER" "$TMPD/samples/bare.md" scripts/ok.sh)" = "1" ]; then ok "A match_path 命中（认领可用）"; else no "A match_path 未命中 —— 裸路径形态被破坏"; fi

echo ""
echo "── B 边界: 反引号包裹 ⇒ 显式告警 + 实测不可命中（#1308 机制复现）──"
run_cli "$PARSER" "$TMPD/samples/backtick.md" backtick
WARN_B="$(warn_n backtick)"
if [ "$WARN_B" -ge 1 ]; then ok "B 反引号条目显式告警（${WARN_B} 条，不再静默）"; else no "B 反引号条目零告警 = 退回静默（#1308 复发）"; fi
if grep -q 'Q2-PARSE-WARN:.*backtick\.md:3' "$TMPD/backtick.err"; then ok "B 告警带 source:line 定位（可诊断）"; else no "B 告警缺定位: $(cat "$TMPD/backtick.err")"; fi
if grep -q '反引号' "$TMPD/backtick.err"; then ok "B 告警写明原因（反引号包裹）"; else no "B 告警未写原因"; fi
if [ "$(matchable "$PARSER" "$TMPD/samples/backtick.md" tests/target.test.sh)" = "0" ]; then ok "B 同形态实测 match_path 不命中（0 匹配机制已复现并被显式化）"; else no "B 反引号条目竟然命中 —— 前提失效，夹具结论不可信"; fi

echo ""
echo "── C 边界: 行内尾随说明 ⇒ 显式告警 + 实测不可命中 ──"
run_cli "$PARSER" "$TMPD/samples/trailing.md" trailing
if [ "$(warn_n trailing)" -ge 1 ]; then ok "C 行内尾随说明显式告警"; else no "C 行内尾随说明零告警 = 静默"; fi
if grep -q 'Q2-PARSE-WARN:.*trailing\.md:3' "$TMPD/trailing.err"; then ok "C 告警带 source:line 定位"; else no "C 告警缺定位: $(cat "$TMPD/trailing.err")"; fi
if [ "$(matchable "$PARSER" "$TMPD/samples/trailing.md" scripts/target.sh)" = "0" ]; then ok "C 同形态实测 match_path 不命中"; else no "C 尾随说明条目竟然命中 —— 前提失效"; fi

echo ""
echo "── D 契约: 告警只走 stderr，stdout 仍是路径流 ──"
if grep -q 'Q2-PARSE-WARN' "$TMPD/backtick.out"; then no "D 告警污染 stdout（--q2-include 的 5 处消费会被喂噪声）"; else ok "D stdout 无告警（路径流契约不变）"; fi
if [ "$(last_match "$TMPD/samples/backtick.md")" = "1" ]; then ok "D 不可匹配条目仍照旧进 include 列表（输出零变更）"; else no "D include 条目被丢弃 —— 属判据变更（本卡不应做）"; fi

echo ""
echo "── E 半径: include 段查、exclude 段不查（同形条目，两侧对照）──"
# 判据: C 的「行内尾随说明」在 include 段**必须**告警（B/C 断言）；同形条目落在 exclude 段则**不**告警
# —— exclud 段存量 178/265 是散文式范围声明，逐条告警=噪音淹没信号（且 exclude 不参与认领/身份裁决）。
"$PYBIN" "$PARSER" --q2-exclude "$TMPD/samples/exclude_prose.md" >"$TMPD/exc.out" 2>"$TMPD/exc.err"
EXC_OUT_N="$(grep -c . "$TMPD/exc.out" | tr -d ' \r' || true)"
case "$EXC_OUT_N" in ''|*[!0-9]*) EXC_OUT_N=0 ;; esac
EXC_W="$(grep -c 'Q2-PARSE-WARN:' "$TMPD/exc.err" 2>&1 | tr -d ' \r' || true)"
case "$EXC_W" in ''|*[!0-9]*) EXC_W=0 ;; esac
if [ "$EXC_W" = "0" ]; then ok "E 同形条目在 exclude 段不告警（半径=include，防噪音）"; else no "E exclude 段误告警（噪音源）: $(cat "$TMPD/exc.err")"; fi
if [ "$EXC_OUT_N" -ge 1 ]; then ok "E exclude 解析结果照旧输出（${EXC_OUT_N} 条，半径只影响告警不影响解析）"; else no "E exclude 解析结果丢失"; fi

echo ""
echo "── F 端到端: resolver 认领裁决（反引号 0 : 裸路径 1）+ 根因透传 ──"
SB="$TMPD/sb"; mkdir -p "$SB/.claude/task-briefs"
git -C "$SB" init -q -b main >/dev/null 2>&1
git -C "$SB" config user.email t@t; git -C "$SB" config user.name t
cat > "$SB/.claude/task-briefs/${TODAY}-D9000-backtick.md" <<'EOF'
## Q2: 范围
做什么:
- `tests/target.test.sh`（反引号包裹）
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF
cat > "$SB/.claude/task-briefs/${TODAY}-D9001-bare.md" <<'EOF'
## Q2: 范围
做什么:
- tests/target.test.sh
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF
RESOLVED="$(cd "$SB" && bash "$RESOLVER" "tests/target.test.sh" 2>"$TMPD/resolver.err")"
if printf '%s' "$RESOLVED" | grep -q 'D9001-bare.md'; then
  ok "F 裸路径 brief 1:0 胜出（#1308 现象可复现: 反引号 brief 认领恒 0）"
else
  no "F resolver 未选裸路径 brief（实际: ${RESOLVED}）—— 认领语义与预期不符"
fi
if grep -q 'Q2-PARSE-WARN:.*D9000-backtick' "$TMPD/resolver.err"; then
  ok "F resolver stderr 点名反引号 brief ⇒ 根因不再只在结果侧暴露"
else
  no "F resolver 未透传 Q2-PARSE-WARN（消费方看不到根因）: $(cat "$TMPD/resolver.err")"
fi

echo ""
echo "── G 端到端: 同数且无身份锚点 ⇒ RESOLVER-TIE（字典序裁决可见化）──"
cat > "$SB/.claude/task-briefs/${TODAY}-D9002-bare2.md" <<'EOF'
## Q2: 范围
做什么:
- tests/target.test.sh
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF
RESOLVED2="$(cd "$SB" && bash "$RESOLVER" "tests/target.test.sh" 2>"$TMPD/tie.err")"
if grep -q '^RESOLVER-TIE:' "$TMPD/tie.err"; then
  ok "G 同数无锚点打 RESOLVER-TIE（最弱裁决可见）: $(grep -m1 '^RESOLVER-TIE:' "$TMPD/tie.err")"
else
  no "G 同数无锚点未打 RESOLVER-TIE（裁决仍在暗处）"
fi
if [ -n "$RESOLVED2" ] && [ -f "$RESOLVED2" ]; then ok "G stdout 契约不变（仍只输出 brief 路径）"; else no "G stdout 契约破坏: $RESOLVED2"; fi

echo ""
echo "── M1 变异: 删掉显式告警调用 ⇒ B/C 的告警断言必红（判别力）──"
mkdir -p "$TMPD/mut"
cp "$PARSER" "$TMPD/mut/brief_parser.py"
"$PYBIN" - "$TMPD/mut/brief_parser.py" >"$TMPD/mut.log" 2>&1 <<'PYMUT'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding='utf-8')
anchor = '_q2_warn(source, lineno, orig, hazard, path)'
assert anchor in t, '夹具写集漂移：未找到 _q2_warn 调用点（判据锚点已改名）'
p.write_text(t.replace(anchor, 'pass  # MUTANT: 显式告警被删'), encoding='utf-8')
print('M1 注入: 删除 _q2_warn 调用')
PYMUT
run_cli "$TMPD/mut/brief_parser.py" "$TMPD/samples/backtick.md" mut-backtick
run_cli "$TMPD/mut/brief_parser.py" "$TMPD/samples/trailing.md" mut-trailing
MUT_N=$(( $(warn_n mut-backtick) + $(warn_n mut-trailing) ))
if [ "$MUT_N" -eq 0 ]; then
  ok "M1 变异体: 告警被删后归零 ⇒ 夹具 B/C 断言必红（对「退回静默」有判别力）"
else
  no "M1 变异体: 删掉调用后仍有 ${MUT_N} 条告警 —— 判别力失效（断言未绑到该判据）"
fi
if [ "$MUT_N" -eq 0 ] && [ "$(last_match "$TMPD/samples/backtick.md")" = "1" ]; then
  ok "M1 变异体仍在输出同一条目 ⇒ 翻转可归因于「告警」而非「解析」"
else
  no "M1 变异体: 输出侧同时变了 ⇒ 变异不干净（无法归因）"
fi
# 对照组: 未变异副本仍告警（排除沙箱失真）
if [ "${WARN_B:-0}" -ge 1 ] && [ "$(warn_n trailing)" -ge 1 ]; then
  ok "对照组: 未变异解析器 B/C 仍告警 ⇒ M1 翻转来自变异本身"
else
  no "对照组: 未变异解析器未告警 —— 沙箱失真，M1 结论不可信"
fi

echo ""
echo "── H 提交端措辞: 真劫持 vs 认领解析失败（两类原因必须可区分；判定都不变）──"
SB2="$TMPD/sb-msg"; mkdir -p "$SB2/.claude/task-briefs"
cp -R "$REPO/scripts" "$SB2/scripts"
git -C "$SB2" init -q -b main >/dev/null 2>&1
git -C "$SB2" config user.email t@t; git -C "$SB2" config user.name t
# 反引号 brief（认领恒 0，但产生告警）——复现 #1308 现场: 告警与「不一致」结论同屏
cat > "$SB2/.claude/task-briefs/${TODAY}-D9000-backtick.md" <<'EOF'
## Q2: 范围
做什么:
- `tests/target.test.sh`（反引号包裹）
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF
cat > "$SB2/.claude/task-briefs/${TODAY}-D9001-bare.md" <<'EOF'
## Q2: 范围
做什么:
- tests/target.test.sh
## 架构层: 基础设施
#CRITERIA: A
## Done 标准
- [x] verify: echo 1
EOF
run_cm() {  # <sandbox> <message> <tag> → 输出落 $TMPD/cm.<tag>.out；printf 退出码
  local mf="$TMPD/cm-msg.txt"
  printf '%s\n' "$2" > "$mf"
  ( cd "$1" && SYNO_STAGED_FILES="tests/target.test.sh" bash "$1/scripts/commit-msg-check.sh" "$mf" ) >"$TMPD/cm.$3.out" 2>&1
  printf '%s' "$?"
}
RC_H1="$(run_cm "$SB2" 'chore(D9999): 真劫持措辞探针' h1)"
if [ "$RC_H1" = "1" ] && grep -q '疑似并行劫持' "$TMPD/cm.h1.out" && ! grep -q '认领解析失败' "$TMPD/cm.h1.out"; then
  ok "H1 双方声明不一致 ⇒ 「疑似并行劫持」（唯一该用该措辞的场景）"
else
  no "H1 真劫持措辞异常（rc=${RC_H1}）: $(tail -3 "$TMPD/cm.h1.out")"
fi
RC_H2="$(run_cm "$SB2" 'chore: 零声明措辞探针' h2)"
if [ "$RC_H2" = "1" ] && grep -q '认领解析失败（非劫持）' "$TMPD/cm.h2.out" && ! grep -q '疑似并行劫持' "$TMPD/cm.h2.out"; then
  ok "H2 消息侧零声明 ⇒ 「认领解析失败（非劫持）」（不误指劫持；仍 exit 1，判定不变）"
else
  no "H2 零声明措辞异常（rc=${RC_H2}）: $(tail -3 "$TMPD/cm.h2.out")"
fi
# H3: 消息声明的正是那条告警 brief ⇒ 逐条展开（根因与结论同屏；#1308 现场）
RC_H3="$(run_cm "$SB2" 'chore(D9000): 告警透传探针' h3)"
if grep -q 'Q2-PARSE-WARN:.*D9000-backtick' "$TMPD/cm.h3.out"; then
  ok "H3 告警属于本提交任务 ⇒ 展开明细（根因与结论同屏，不再「引偏一轮」）"
else
  no "H3 本任务告警未展开（rc=${RC_H3}）: $(tail -3 "$TMPD/cm.h3.out")"
fi
# H4: 与本任务无关的 brief 告警 ⇒ 折叠为计数（防每次提交刷 100+ 行把判决行淹掉）
if grep -q '另有 .* 条不可匹配 Q2 条目' "$TMPD/cm.h2.out" && ! grep -q 'Q2-PARSE-WARN:.*D9000-backtick' "$TMPD/cm.h2.out"; then
  ok "H4 无关 brief 的告警折叠为计数 + 自检命令（不静默、不刷屏）"
else
  no "H4 降噪档失效（无关 brief 明细被逐条展开或计数缺失）: $(tail -3 "$TMPD/cm.h2.out")"
fi

echo ""
echo "── M2 变异: 把两类原因压回同一措辞 ⇒ H2 断言必红（判别力）──"
SB3="$TMPD/sb-msg-mut"; cp -R "$SB2" "$SB3"
"$PYBIN" - "$SB3/scripts/commit-msg-check.sh" >"$TMPD/mut2.log" 2>&1 <<'PYMUT2'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding='utf-8')
anchor = '认领解析失败（非劫持）'
assert anchor in t, '夹具写集漂移：未找到「认领解析失败（非劫持）」措辞锚点'
p.write_text(t.replace(anchor, '疑似并行劫持'), encoding='utf-8')
print('M2 注入: 两类原因措辞被压回一句')
PYMUT2
RC_M2="$(run_cm "$SB3" 'chore: 零声明措辞探针' m2)"
if [ "$RC_M2" = "1" ] && grep -q '疑似并行劫持' "$TMPD/cm.m2.out"; then
  ok "M2 变异体: 零声明场景被压回「疑似并行劫持」⇒ H2 断言必红（对措辞回退有判别力）"
else
  no "M2 变异体: 措辞回退未复现（rc=${RC_M2}）—— 判别力失效"
fi

echo ""
echo "── 接线（铁律 0-2）──"
if grep -q 'def parse_q2' "$RESOLVER"; then
  no "接线①: resolver 再现内联 parse_q2 副本（Step B 去副本被回退）"
else
  ok "接线①: resolver 无内联 parse_q2 副本（单一事实源）"
fi
if grep -q 'source=os.path.basename' "$RESOLVER"; then
  ok "接线②: resolver 向 parse_q2 传 source（告警可定位到 brief）"
else
  no "接线②: resolver 未传 source ⇒ 告警无法定位到哪个 brief"
fi
if grep -q 'Q2-PARSE-WARN:' "$CMCHECK"; then
  ok "接线③: commit-msg-check.sh 透传 Q2-PARSE-WARN（提交端可见根因）"
else
  no "接线③: 提交端未透传告警（根因仍不可见）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
