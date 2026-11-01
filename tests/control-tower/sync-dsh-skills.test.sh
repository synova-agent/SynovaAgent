#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# sync-dsh-skills.test.sh — DSH 技能同步脚本测试（.synova/skills → .dsh/skills）
#
# 覆盖矩阵（正常 / 降级 / 边界 / 判别力）:
#   T1  无参数 = dry-run: 只打印计划, **零写盘**（目标/回收目录都不出现）        （正常·默认态）
#   T2  --apply 真同步: 复制内容一致 + 无 SKILL.md 目录跳过并 warn               （正常）
#   T3  --check 已一致 → exit 0 + SYNC-OK                                        （正常）
#   T4  源内容漂移: --check exit 1 点名；--apply 后目标更新且**旧内容移入回收**  （边界·不销毁）
#   T5  目标缺文件: --check exit 1 点名；--apply 修复                            （边界）
#   T6  目标多余件: --check/--dry-run 都报；--apply **移入回收**（不删）         （边界·只移不毁）
#   T7  源目录缺失 → exit 2 + degraded 显式日志（三态: 检查失败≠通过）           （降级, D328）
#   T8  非法参数 → exit 2（fail loud, 不许静默按默认跑）                          （降级）
#   T9  禁令: 脚本字面量零命中（不原地递归删除）                                  （结构）
#   T10 生产接线 + 组 13 判据形态（总是检查 / CI 硬阻断分支 / 无组13 GROUP_DOWN） （WIRE CHECK）
#   T11 判别力（改坏必红 #1）: 默认由 dry-run 改 apply ⇒ 本夹具 T1 断言会红        （变异）
#   T12 判别力（改坏必红 #2）: 把递归删除写回脚本 ⇒ T9 断言会红                    （变异）
#
# 隔离: mktemp 沙箱 + SYNO_SKILLS_SRC / SYNO_SKILLS_DST / SYNO_SKILLS_TRASH 注入;
#       零网络、零真实技能目录; 变异体一律在沙箱副本上做（工作树零污染）。
# 用法: bash tests/control-tower/sync-dsh-skills.test.sh
# 退出码: 0 = 全部通过；1 = 有失败
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SYNC="$REPO_DIR/scripts/workflow/sync-dsh-skills.sh"
PRECOMMIT="$REPO_DIR/scripts/pre-commit-check.sh"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_exit() { # <got> <want> <msg>
  if [ "$1" -eq "$2" ]; then pass "$3"; else fail "$3 (got exit=$1, want exit=$2)"; fi
}
assert_has() { # <text> <pattern> <msg>
  if printf '%s' "$1" | grep -q -- "$2"; then pass "$3"; else fail "$3 (未命中: $2)"; fi
}
assert_lacks() { # <text> <pattern> <msg>
  if printf '%s' "$1" | grep -q -- "$2"; then fail "$3 (不应命中: $2)"; else pass "$3"; fi
}

echo "=== sync-dsh-skills.test.sh（#1227 W3: dry-run 默认 / --apply / 只移不毁）==="

# ── 沙箱 ──
TMP=$(mktemp -d /tmp/sds-skills.XXXXXX) || { echo "❌ 无法创建沙箱"; exit 1; }
trap 'rm -rf "$TMP"' EXIT
SRC="$TMP/src-skills"
DST="$TMP/dst-skills"
TRASH="$TMP/.skill-trash"
mkdir -p "$SRC/skill-a" "$SRC/skill-b" "$SRC/skill-c" "$SRC/no-skill-dir"
printf '# skill A v1\n' > "$SRC/skill-a/SKILL.md"
printf '# skill B\n' > "$SRC/skill-b/SKILL.md"
printf '# skill C\n' > "$SRC/skill-c/SKILL.md"
printf 'not a skill\n' > "$SRC/no-skill-dir/notes.txt"   # 无 SKILL.md → 应跳过
mkdir -p "$DST"
export SYNO_SKILLS_SRC="$SRC"
export SYNO_SKILLS_DST="$DST"
export SYNO_SKILLS_TRASH="$TRASH"

# ── T1: 无参数 = dry-run，只打印、零写盘 ──
OUT1=$(bash "$SYNC" 2>&1)
EXIT1=$?
assert_exit "$EXIT1" 1 "T1: dry-run 有待处理项 exit 1（1=漂移语义）"
assert_has "$OUT1" "DRY-RUN" "T1: 输出含 DRY-RUN 标记"
assert_has "$OUT1" "未改动任何文件" "T1: 明确宣告未改动文件"
[ ! -e "$DST/skill-a" ] && pass "T1: dry-run 未创建目标技能（零写盘）" || fail "T1: dry-run 竟写入目标"
[ ! -e "$TRASH" ] && pass "T1: dry-run 未创建回收目录" || fail "T1: dry-run 创建了回收目录"
assert_has "$OUT1" "skill-a" "T1: 计划点名 skill-a"

# ── T2: --apply 真同步 ──
OUT2=$(bash "$SYNC" --apply 2>&1)
EXIT2=$?
assert_exit "$EXIT2" 0 "T2: --apply exit 0"
[ -f "$DST/skill-a/SKILL.md" ] && diff -q "$SRC/skill-a/SKILL.md" "$DST/skill-a/SKILL.md" >/dev/null 2>&1 \
  && pass "T2: skill-a 内容一致" || fail "T2: skill-a 复制失败/内容漂移"
[ -f "$DST/skill-b/SKILL.md" ] && [ -f "$DST/skill-c/SKILL.md" ] \
  && pass "T2: skill-b/c 均复制" || fail "T2: skill-b/c 缺失"
[ ! -e "$DST/no-skill-dir" ] && pass "T2: 无 SKILL.md 目录未复制" || fail "T2: no-skill-dir 被误复制"
assert_has "$OUT2" "no-skill-dir" "T2: 跳过目录有显式警告"
[ ! -e "$TRASH" ] && pass "T2: 纯新增不产生回收目录" || fail "T2: 无多余件却创建了回收目录"

# ── T3: --check 已一致 → exit 0 ──
OUT3=$(bash "$SYNC" --check 2>&1)
EXIT3=$?
assert_exit "$EXIT3" 0 "T3: --check 一致 exit 0"
assert_has "$OUT3" "SYNC-OK" "T3: 输出含 SYNC-OK"
[ ! -e "$TRASH" ] && pass "T3: --check 零写盘（无回收目录）" || fail "T3: --check 写了回收目录"

# ── T4: 源内容漂移 → 点名；--apply 换新且旧内容移入回收（不销毁）──
printf '# skill A v2 drifted\n' > "$SRC/skill-a/SKILL.md"
OUT4=$(bash "$SYNC" --check 2>&1)
EXIT4=$?
assert_exit "$EXIT4" 1 "T4: 漂移 --check exit 1"
assert_has "$OUT4" "skill-a" "T4: --check 点名 skill-a"
OUT4D=$(bash "$SYNC" 2>&1)
assert_exit "$?" 1 "T4: 漂移时 dry-run exit 1"
assert_has "$OUT4D" "内容不一致" "T4: dry-run 标注内容不一致"
bash "$SYNC" --apply >/dev/null 2>&1
diff -q "$SRC/skill-a/SKILL.md" "$DST/skill-a/SKILL.md" >/dev/null 2>&1 \
  && pass "T4: --apply 后目标内容更新" || fail "T4: --apply 未更新目标"
[ -f "$TRASH/skill-a/SKILL.md" ] && grep -q "v1" "$TRASH/skill-a/SKILL.md" \
  && pass "T4: 旧内容整目录移入回收（可回滚）" || fail "T4: 旧内容未进回收目录"
assert_exit "$(bash "$SYNC" --check >/dev/null 2>&1; echo $?)" 0 "T4: 修复后 --check exit 0"

# ── T5: 目标缺文件 → exit 1 + 点名；--apply 修复 ──
rm -f "$DST/skill-b/SKILL.md"
OUT5=$(bash "$SYNC" --check 2>&1)
assert_exit "$?" 1 "T5: 目标缺失 --check exit 1"
assert_has "$OUT5" "skill-b" "T5: --check 点名 skill-b"
bash "$SYNC" --apply >/dev/null 2>&1
[ -f "$DST/skill-b/SKILL.md" ] && pass "T5: --apply 补齐缺失文件" || fail "T5: --apply 未补齐"
assert_exit "$(bash "$SYNC" --check >/dev/null 2>&1; echo $?)" 0 "T5: 修复后 --check exit 0"

# ── T6: 目标多余件（源已删）→ 报告 + 移入回收，不是原地删 ──
mkdir -p "$DST/skill-zombie"
printf '# zombie payload\n' > "$DST/skill-zombie/SKILL.md"
OUT6C=$(bash "$SYNC" --check 2>&1)
assert_exit "$?" 1 "T6: 目标多余 --check exit 1"
assert_has "$OUT6C" "skill-zombie" "T6: --check 点名 skill-zombie"
OUT6D=$(bash "$SYNC" 2>&1)
assert_exit "$?" 1 "T6: 目标多余 dry-run exit 1"
assert_has "$OUT6D" "目标多余" "T6: dry-run 标注目标多余"
OUT6A=$(bash "$SYNC" --apply 2>&1)
assert_exit "$?" 0 "T6: --apply exit 0"
[ ! -e "$DST/skill-zombie" ] && pass "T6: 多余件已移出目标目录" || fail "T6: 多余件仍留在目标"
[ -f "$TRASH/skill-zombie/SKILL.md" ] && grep -q "zombie payload" "$TRASH/skill-zombie/SKILL.md" \
  && pass "T6: 多余件内容保留在回收目录（非销毁）" || fail "T6: 多余件被销毁（禁：只移不毁）"
assert_has "$OUT6A" "moved:" "T6: --apply 输出逐个列出移出动作"

# ── T7: 源目录缺失 → exit 2 降级（三态: 失败≠通过）──
OUT7=$(SYNO_SKILLS_SRC="$TMP/不存在-src" bash "$SYNC" --check 2>&1)
assert_exit "$?" 2 "T7: 源缺失 --check exit 2"
assert_has "$OUT7" "degraded" "T7: 降级有显式 degraded 日志（铁律 11 不静默）"
OUT7A=$(SYNO_SKILLS_SRC="$TMP/不存在-src" bash "$SYNC" --apply 2>&1)
assert_exit "$?" 2 "T7: 源缺失 --apply exit 2（同样 fail-closed）"

# ── T8: 非法参数 → exit 2（不许静默按默认模式跑）──
OUT8=$(bash "$SYNC" --bogus 2>&1)
assert_exit "$?" 2 "T8: 非法参数 exit 2"
assert_has "$OUT8" "usage" "T8: 非法参数给出 usage（fail loud）"
OUT8B=$(bash "$SYNC" --check --apply 2>&1)
assert_exit "$?" 2 "T8: 多参数 exit 2"

# ── T9: 禁令扫描（不原地递归删除）──
BANNED="rm -r""f"   # 拼接写法：本文件自身不含连续字面量，避免仓库级 grep 自命中
if grep -qF -- "$BANNED" "$SYNC"; then
  fail "T9: 脚本含禁用字面量（含注释也不许）: $BANNED"
else
  pass "T9: 脚本零命中禁用字面量"
fi
if grep -qF 'mv "$srcp" "$dest"' "$SYNC"; then
  pass "T9: 移出动作走 mv（只移不毁，可回滚）"
else
  fail "T9: 移出动作未见 mv — 疑似原地销毁"
fi

# ── T10: 生产接线 + 组 13 判据形态（WIRE CHECK，铁律 0-2）──
if grep -qF "sync-dsh-skills.sh" "$PRECOMMIT"; then
  pass "T10: pre-commit-check.sh 物理调用 sync-dsh-skills.sh"
else
  fail "T10: pre-commit-check.sh 零调用 — 组 13 未接线"
fi
if grep -qE 'sync-dsh-skills\.sh" --check' "$PRECOMMIT"; then
  pass "T10: 组 13 以 --check 调用（只校验）"
else
  fail "T10: 组 13 未以 --check 调用"
fi
# 无条件检查: 旧的条件跳过变量必须已消失（代码行判定，注释里提到旧行为不算）
if grep -vE '^[[:space:]]*#' "$PRECOMMIT" | grep -q "SKILL_FILES_STAGED"; then
  fail "T10: 组 13 仍有条件跳过（SKILL_FILES_STAGED）—— 无 staged skill 时不检查"
else
  pass "T10: 组 13 无条件检查（无 staged skill 也跑 --check）"
fi
# CI 硬阻断分支: G13 漂移必须在 CI 走 hard_check（checkpoint 名逐字保留）
if grep -qF 'hard_check "G13: 技能漂移' "$PRECOMMIT"; then
  pass "T10: G13 漂移存在 hard_check 分支（CI 硬阻断，名称锚定 GATE-INVENTORY）"
else
  fail "T10: G13 漂移缺 hard_check 分支（CI 无法阻断）"
fi
if grep -qE '^GROUP_DOWN=1.*组13' "$PRECOMMIT"; then
  fail "T10: 组 13 仍在 GROUP_DOWN 降级区（CI 只报不拦）"
else
  pass "T10: 组 13 已退出 GROUP_DOWN 降级区"
fi
GROUP_DOWN_LINES=$(grep -cE '^GROUP_DOWN=[01] ' "$PRECOMMIT" | tr -d ' \r\n')
if [ "$GROUP_DOWN_LINES" = "8" ]; then
  pass "T10: 组界开关 8 行（组5/6、组8、组9/10、#912 保原态）与头注一致"
else
  fail "T10: 组界开关行数=${GROUP_DOWN_LINES}（期望 8；改了组界须同步头注与 GATE-INVENTORY）"
fi
if grep -qE -- '--apply' "$SYNC"; then
  pass "T10: 脚本声明 --apply 模式（真同步入口）"
else
  fail "T10: 脚本缺 --apply 模式"
fi

# ── T11: 判别力（改坏必红 #1）——把默认从 dry-run 改回"直接写" ──
#   变异点 = case 的空参数分支（只改前置赋值无效：case 会把它再覆盖回 dry-run）
MUT1="$TMP/mut1-sync.sh"
cp "$SYNC" "$MUT1"
sed -i 's/^  "")      MODE="dry-run" ;;/  "")      MODE="apply" ;;/' "$MUT1" 2>/dev/null \
  || sed 's/^  "")      MODE="dry-run" ;;/  "")      MODE="apply" ;;/' "$SYNC" > "$MUT1"
MUT_DST="$TMP/mut1-dst"
MUT_TRASH="$TMP/.mut1-trash"
mkdir -p "$MUT_DST"
SYNO_SKILLS_SRC="$SRC" SYNO_SKILLS_DST="$MUT_DST" SYNO_SKILLS_TRASH="$MUT_TRASH" \
  bash "$MUT1" >/dev/null 2>&1
if [ -e "$MUT_DST/skill-a" ]; then
  pass "T11: 变异（默认改为写盘）被 T1 断言抓红 —— 默认 dry-run 是承重的"
else
  fail "T11: 变异后仍零写盘 ⇒ T1 断言无判别力（假绿）"
fi
if grep -qF 'MODE="apply"' "$MUT1" && grep -qF 'MODE="dry-run"' "$MUT1"; then
  pass "T11: 变异确实落在空参数分支上（副本可复核）"
else
  fail "T11: 变异未生效（夹具自身缺陷）"
fi

# ── T12: 判别力（改坏必红 #2）——把递归删除写回脚本 ──
MUT2="$TMP/mut2-sync.sh"
cp "$SYNC" "$MUT2"
printf '\n%s "$DST/skill-a"\n' "$BANNED" >> "$MUT2"
MUT2_HITS=$(grep -cF -- "$BANNED" "$MUT2" | tr -d ' \r\n')
if [ "${MUT2_HITS:-0}" -ge 1 ]; then
  pass "T12: 变异（写回递归删除）被 T9 断言抓红 —— 禁令扫描是承重的"
else
  fail "T12: 变异后禁令扫描仍 0 命中 ⇒ T9 断言无判别力"
fi
REAL_HITS=$(grep -cF -- "$BANNED" "$SYNC" | tr -d ' \r\n')
if [ "${REAL_HITS:-0}" -eq 0 ]; then
  pass "T12: 真实脚本复核仍 0 命中"
else
  fail "T12: 真实脚本命中 ${REAL_HITS} 处"
fi

# ── 汇总 ──
echo ""
echo "═══════════════════════════════════════"
echo "${PASS} 通过 ${FAIL} 失败"
echo "═══════════════════════════════════════"
[ "$FAIL" -eq 0 ]
