#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# resolve-ci-base.test.sh — CT-40 配对：#598 resolve-ci-base.sh（#1117 P1 扩展）
#
# 覆盖（T1–T12）:
#   T1   契约（@input/@output/@exit ＋ SYNO_TRUNK_REF 入 @input ＋ 已知限制节；bash -n）
#   T2   显式 SYNO_BASE_REF=feat/x（非裸名）→ 原样输出（不重写）
#   T3   GITHUB_BASE_REF=main（裸名）→ 唯一远端归一化 origin/main（缺跟踪引用 ⇒ fetch 物化）
#   T4   缺省（非 CI）＋ 单远端 ＋ 跟踪引用缺失 → origin/main（P0：裸名可解析）
#   T5   CI ＋ 单远端 ＋ 跟踪引用陈旧 → 刷新到远端新 tip → 0（新鲜度断言＝刷新后相等）
#   T6   CI ＋ fetch 失败 ＋ 不可解析 → 2（fail-closed，不猜）
#   T7   CI ＋ 多远端 ＋ 不可解析 → 2（不猜）
#   T8   显式 base 不可解析 → 2
#   T9   SYNO_TRUNK_REF=trunk-x 单源可证：单远端 ⇒ origin/trunk-x ＋ refspec 随 TRUNK 物化
#   T9b  多远端 ＋ SYNO_TRUNK_REF=trunk-x ⇒ gitea/trunk-x（规格 §9.6 字面口径）
#   T10  J1 判别力自证：J1-a 同款流水（git grep ＋ awk 剥注释）在夹具上「代码行 1 / 注释 0」；
#        同一流水对本 helper ⇒ 0（禁把「看不见」当「没问题」）
#   T11  J2 正例：main 已前进、旧分支冻结 ⇒ base=origin/main 且变更集只含该 commit；
#        同夹具反例（base 指回旧点）⇒ 变更集 2 文件（差异真实存在）
#   T11b 变异体（固化）：副本把缺省 TRUNK 改回旧分支名 ⇒ base 变旧点、T11 的「1 文件」断言必红
#   T12  helper 内 local-main 字面 = 0（含注释 ⇒ J1-b 恰 3 行只来自 probe 历史注释）
#
# 隔离: mktemp 沙箱（bare origin ＋ 本地仓）；file:// 零网络；env -u 剥外层 CI 变量（判据纪律②）。
#       ⚠️ 夹具本地分支**显式 pin 为非 main**（`init.defaultBranch=main` 的机器上否则会凭空造出
#       本地 main ⇒ T7「多远端不可解析」场景假绿）。
# 用法: bash tests/control-tower/resolve-ci-base.test.sh  → 0 = 全过
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$REPO_DIR/scripts/control-tower/resolve-ci-base.sh"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "  ✅ $1"; }
no() { FAIL=$((FAIL+1)); echo "  ❌ $1" >&2; }
# 隔离运行：剥掉外层可能注入的 CI/base 变量
run_in() { local d="$1"; shift; ( cd "$d" && env -u SYNO_BASE_REF -u GITHUB_BASE_REF -u SYNO_TRUNK_REF -u SYNO_CI -u GITHUB_ACTIONS "$@" ); }
# J1-a 的注释剥离判据（与规格 §7 J1 的 awk 表达式逐字一致）
j1_filter() { awk '{l=$0; sub(/^[^:]*:[0-9]+:/,"",l); if (l ~ /^[[:space:]]*(#|\/\/|\*|\/\*)/) next; print}'; }

echo "=== #598 resolve-ci-base 配对测试（#1117 P1：SYNO_TRUNK_REF 单源 ＋ P0 裸名归一化） ==="

# ── T1 契约 ──────────────────────────────────────────────────────────────────
[ -f "$HELPER" ] && ok "T1a. 文件存在" || no "T1a. 文件缺失"
[ -x "$HELPER" ] && ok "T1b. 可执行" || no "T1b. 不可执行"
grep -q "@input" "$HELPER" && grep -q "@output" "$HELPER" && grep -q "@exit" "$HELPER" \
  && ok "T1c. 契约段齐（@input/@output/@exit）" || no "T1c. 契约段缺失"
grep -q "@input.*SYNO_TRUNK_REF" "$HELPER" && ok "T1d. @input 含 SYNO_TRUNK_REF（#1117 §6.1）" || no "T1d. @input 未声明 SYNO_TRUNK_REF"
grep -q "已知限制" "$HELPER" && ok "T1e. 已知限制节在（DSH 代码标准）" || no "T1e. 缺已知限制节"
bash -n "$HELPER" 2>/dev/null && ok "T1f. bash -n 通过" || no "T1f. bash -n 失败"

TMPD=$(mktemp -d /tmp/rcb.XXXXXX)
trap 'rm -rf "$TMPD"' EXIT

# ── 沙箱 A：单远端（CI 姿态：origin=唯一远端） ──────────────────────────────
ORIGIN="$TMPD/origin.git"; git init --bare -q "$ORIGIN"
W="$TMPD/w"; git init -q "$W"
git -C "$W" symbolic-ref HEAD refs/heads/work   # pin 非 main（防 init.defaultBranch=main 造出本地 main）
git -C "$W" config user.email t@t; git -C "$W" config user.name t
git -C "$W" remote add origin "file://$ORIGIN"
echo a > "$W/a.txt"; git -C "$W" add a.txt; git -C "$W" commit -qm A
A_SHA="$(git -C "$W" rev-parse HEAD)"
git -C "$W" push -q origin HEAD:refs/heads/main 2>/dev/null
git -C "$W" push -q origin HEAD:refs/heads/local-main 2>/dev/null   # 冻结旧点形态（只做反例素材）
git -C "$W" fetch -q origin 2>/dev/null

# ── T2 显式非裸名 base 原样输出 ─────────────────────────────────────────────
git -C "$W" branch -f feat/x HEAD 2>/dev/null
OUT="$(run_in "$W" SYNO_BASE_REF=feat/x bash "$HELPER" 2>/dev/null)"; RC=$?
[ "$RC" -eq 0 ] && [ "$OUT" = "feat/x" ] && ok "T2. 显式 SYNO_BASE_REF=feat/x → '${OUT}'（0）" || no "T2. 显式 base 失败 rc=${RC} out=${OUT}"

# ── T3 GITHUB_BASE_REF 裸名 main → 唯一远端归一化（缺跟踪引用 ⇒ fetch 物化） ─
git -C "$W" update-ref -d refs/remotes/origin/main 2>/dev/null || true
OUT="$(run_in "$W" GITHUB_BASE_REF=main bash "$HELPER" 2>/dev/null)"; RC=$?
MAT="$(git -C "$W" rev-parse --short refs/remotes/origin/main 2>/dev/null || true)"
[ "$RC" -eq 0 ] && [ "$OUT" = "origin/main" ] && [ -n "$MAT" ] \
  && ok "T3. 裸 main 归一化 → '${OUT}'（fetch 物化=${MAT}，0）" || no "T3. 归一化失败 rc=${RC} out=${OUT} mat=${MAT}"

# ── T4 缺省（非 CI）＋ 单远端 ＋ 跟踪引用缺失 → 物化 → 0 ─────────────────────
git -C "$W" update-ref -d refs/remotes/origin/main 2>/dev/null || true
OUT="$(run_in "$W" bash "$HELPER" 2>/dev/null)"; RC=$?
MAT="$(git -C "$W" rev-parse --short refs/remotes/origin/main 2>/dev/null || true)"
[ "$RC" -eq 0 ] && [ "$OUT" = "origin/main" ] && [ -n "$MAT" ] \
  && ok "T4. 不可解析＋单远端 → 物化（origin/main=${MAT}，0）" || no "T4. 物化失败 rc=${RC} out=${OUT} mat=${MAT}"

# ── T5 CI ＋ 单远端 ＋ 跟踪引用陈旧 → 刷新 → 0（新鲜度＝刷新后相等） ─────────
echo b > "$W/b.txt"; git -C "$W" add b.txt; git -C "$W" commit -qm B
B_SHA="$(git -C "$W" rev-parse HEAD)"
git -C "$W" push -q origin HEAD:refs/heads/main 2>/dev/null
git -C "$W" update-ref refs/remotes/origin/main "$A_SHA"      # 造陈旧：本地跟踪引用停在旧点
OUT="$(run_in "$W" SYNO_CI=1 bash "$HELPER" 2>/dev/null)"; RC=$?
TIP="$(git -C "$W" rev-parse refs/remotes/origin/main 2>/dev/null || true)"
[ "$RC" -eq 0 ] && [ "$OUT" = "origin/main" ] && [ "$TIP" = "$B_SHA" ] \
  && ok "T5. CI 刷新陈旧 tracking（A→B=${TIP:0:9}）且新鲜度通过 → 0" || no "T5. CI 刷新失败 rc=${RC} out=${OUT} tip=${TIP:0:9} want=${B_SHA:0:9}"

# ── T6 CI ＋ fetch 失败 ＋ canonical 不可解析 → 2（fail-closed，不猜） ───────
git -C "$W" update-ref -d refs/remotes/origin/main 2>/dev/null || true
git -C "$W" remote set-url origin "file:///nonexistent-rcb-xyz" 2>/dev/null
OUT="$(run_in "$W" SYNO_CI=1 bash "$HELPER" 2>/dev/null)"; RC=$?
[ "$RC" -eq 2 ] && ok "T6. CI ＋ fetch 失败 ＋ 不可解析 → 2（fail-closed）" || no "T6. fetch 失败应 2，实际 rc=${RC}"
git -C "$W" remote set-url origin "file://$ORIGIN" 2>/dev/null

# ── T7 CI ＋ 多远端 ＋ 不可解析 → 2（不猜） ─────────────────────────────────
git -C "$W" remote add alt "file://$ORIGIN" 2>/dev/null || true
git -C "$W" update-ref -d refs/remotes/origin/main 2>/dev/null || true
OUT="$(run_in "$W" SYNO_CI=1 bash "$HELPER" 2>/dev/null)"; RC=$?
[ "$RC" -eq 2 ] && ok "T7. 多远端＋不可解析＋CI → 2（不猜）" || no "T7. 多远端应 2，实际 rc=${RC}"

# ── T8 显式 base 不可解析 → 2 ───────────────────────────────────────────────
OUT="$(run_in "$W" SYNO_BASE_REF=no-such-ref bash "$HELPER" 2>/dev/null)"; RC=$?
[ "$RC" -eq 2 ] && ok "T8. 显式不可解析 base → 2" || no "T8. 坏 base 应 2，实际 rc=${RC}"

# ── T9 SYNO_TRUNK_REF=trunk-x 单源可证（单远端：归一化与 refspec 都随 TRUNK 变） ─
git -C "$W" remote remove alt 2>/dev/null || true          # 回到单远端（CI 姿态）
git -C "$W" push -q origin HEAD:refs/heads/trunk-x 2>/dev/null
git -C "$W" update-ref -d refs/remotes/origin/trunk-x 2>/dev/null || true
OUT="$(run_in "$W" SYNO_TRUNK_REF=trunk-x bash "$HELPER" 2>/dev/null)"; RC=$?
MAT="$(git -C "$W" rev-parse --short refs/remotes/origin/trunk-x 2>/dev/null || true)"
ok9=1
[ "$RC" -eq 0 ] || ok9=0
[ "$OUT" = "origin/trunk-x" ] || ok9=0
[ -n "$MAT" ] || ok9=0
[ "$OUT" != "origin/main" ] || ok9=0
[ "$ok9" -eq 1 ] \
  && ok "T9. SYNO_TRUNK_REF=trunk-x → '${OUT}'（refspec 物化=${MAT}；非硬编码 main，0）" || no "T9. 单源 override 失败 rc=${RC} out=${OUT} mat=${MAT}"

# ── T9b 多远端 ＋ SYNO_TRUNK_REF=trunk-x ⇒ gitea/trunk-x（§9.6 字面） ───────
git -C "$W" remote add gitea "file://$ORIGIN" 2>/dev/null || true
git -C "$W" fetch -q gitea '+refs/heads/trunk-x:refs/remotes/gitea/trunk-x' 2>/dev/null
OUT="$(run_in "$W" SYNO_TRUNK_REF=trunk-x bash "$HELPER" 2>/dev/null)"; RC=$?
[ "$RC" -eq 0 ] && [ "$OUT" = "gitea/trunk-x" ] \
  && ok "T9b. 多远端＋trunk-x → '${OUT}'（本地→gitea→origin，0）" || no "T9b. 多远端 trunk override 失败 rc=${RC} out=${OUT}"

# ── T10 J1 判别力自证（同款流水；夹具在沙箱仓内才可被 git grep --no-index 搜到） ─
J1A="$(git -C "$REPO_DIR" grep -n "local-main" -- scripts/control-tower/resolve-ci-base.sh 2>/dev/null | j1_filter | wc -l | tr -d ' ')"
[ "$J1A" = "0" ] && ok "T10a. helper 上 J1-a 代码级命中 = 0" || no "T10a. helper 代码级命中=${J1A}（期望 0）"
printf '# local-main\n__x=local-main\n * local-main\n' > "$W/j1-fixture.txt"
J1B="$( cd "$W" && git grep --no-index -n "local-main" -- j1-fixture.txt 2>/dev/null | j1_filter | tee "$TMPD/j1-fix.out" | wc -l | tr -d ' ')"
if [ "$J1B" = "1" ] && grep -q '__x=local-main' "$TMPD/j1-fix.out"; then
  ok "T10b. J1 判别力：注释行被剥掉、代码行计入（1 行＝__x=local-main）"
else
  no "T10b. J1 判别力失效（命中=${J1B}，期望仅代码行 1）"
fi

# ── T12 helper 内 local-main 字面 = 0（含注释） ─────────────────────────────
LIT="$(grep -c 'local-main' "$HELPER" 2>/dev/null | tr -d '[:space:]' || true)"
[ "$LIT" = "0" ] && ok "T12. helper 内 local-main 字面 = 0（J1-b 恰 3 行只来自 probe 历史注释）" || no "T12. helper 仍有 ${LIT} 处字面"

# ── 沙箱 B：J2 夹具（main 已前进 1，旧分支冻结在旧点） ──────────────────────
J2D="$(mktemp -d /tmp/rcb-j2.XXXXXX)"
trap 'rm -rf "$TMPD" "$J2D"' EXIT
git init --bare -q "$J2D/origin.git"
JW="$J2D/w"; git init -q "$JW"
git -C "$JW" symbolic-ref HEAD refs/heads/work     # pin 非 main
git -C "$JW" config user.email t@t; git -C "$JW" config user.name t
git -C "$JW" remote add origin "file://$J2D/origin.git"
printf 'T1\n' > "$JW/base.txt"; git -C "$JW" add base.txt; git -C "$JW" commit -qm T1
git -C "$JW" push -q origin HEAD:refs/heads/main 2>/dev/null            # 起点：两 ref 同点
git -C "$JW" push -q origin HEAD:refs/heads/local-main 2>/dev/null      # 旧分支冻在该点
printf 'T2\n' > "$JW/trunk.txt"; git -C "$JW" add trunk.txt; git -C "$JW" commit -qm T2
git -C "$JW" push -q origin HEAD:refs/heads/main 2>/dev/null            # main 前进 1（trunk 侧提交）
git -C "$JW" fetch -q origin 2>/dev/null
git -C "$JW" checkout -q -b test/j2
printf 'ONLY\n' > "$JW/only.txt"; git -C "$JW" add only.txt; git -C "$JW" commit -qm only   # 测试分支 = trunk ＋ 1

# ── T11 J2 正例（CI 姿态）＋ 反例（差异真实存在） ───────────────────────────
OUT="$(run_in "$JW" SYNO_CI=1 bash "$HELPER" 2>/dev/null)"; RC=$?
CHG="$(git -C "$JW" diff --name-only "origin/main...HEAD" 2>/dev/null | tr '\n' ' ')"
CHGOLD="$(git -C "$JW" diff --name-only "origin/local-main...HEAD" 2>/dev/null | tr '\n' ' ')"
[ "$RC" -eq 0 ] && [ "$OUT" = "origin/main" ] && [ "$CHG" = "only.txt " ] \
  && ok "T11. 正例 base=${OUT} rc=0；变更集只含该 commit（${CHG% }）" || no "T11. 正例失败 rc=${RC} base=${OUT} 变更集=[${CHG}]"
N_OLD="$(printf '%s' "$CHGOLD" | tr ' ' '\n' | grep -c . || true)"
[ "${N_OLD:-0}" -eq 2 ] \
  && ok "T11-反例. base 指回旧点 ⇒ 变更集 2 文件（trunk 历史被重算）[${CHGOLD% }]" || no "T11-反例. 旧点变更集=${N_OLD:-0} 文件（期望 2）[${CHGOLD}]"

# ── T11b 变异体（固化）：缺省 TRUNK 改回旧分支名 ⇒ T11 的断言必红 ────────────
MUT="$J2D/mutant-resolve-ci-base.sh"
sed 's/SYNO_TRUNK_REF:-main/SYNO_TRUNK_REF:-local-main/' "$HELPER" > "$MUT" 2>/dev/null
chmod +x "$MUT" 2>/dev/null
N_MUT="$(grep -c 'SYNO_TRUNK_REF:-local-main' "$MUT" 2>/dev/null | tr -d '[:space:]' || true)"
OUTM="$(run_in "$JW" SYNO_CI=1 bash "$MUT" 2>/dev/null)"; RCM=$?
CHGM="$(git -C "$JW" diff --name-only "${OUTM}...HEAD" 2>/dev/null | tr '\n' ' ')"
N_CHGM="$(printf '%s' "$CHGM" | tr ' ' '\n' | grep -c . || true)"
okM=1
[ "$N_MUT" = "1" ] || okM=0                       # 变异点唯一（缺省值只有一处 ⇒ 单源）
[ "$RCM" -eq 0 ] || okM=0
[ "$OUTM" = "origin/local-main" ] || okM=0        # 变异体确实改回了旧口径
[ "${N_CHGM:-0}" -ne 1 ] || okM=0                 # T11 的「恰 1 文件」断言在变异体下必红
[ "$okM" -eq 1 ] \
  && ok "T11b. 变异体 base=${OUTM} ⇒ 变更集 ${N_CHGM:-0} 文件（T11 断言必红）；变异点=${N_MUT}（单源）" || no "T11b. 变异体未被判红（变异点=${N_MUT} rc=${RCM} base=${OUTM} 变更集=${N_CHGM:-0}）"

echo ""
echo "结果: ${PASS} 通过 / ${FAIL} 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
