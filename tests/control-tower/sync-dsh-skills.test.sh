#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# sync-dsh-skills.test.sh — DSH 技能同步脚本测试（P0: .claude/skills → .dsh/skills）
#
# 覆盖（铁律 48: 正常/降级/边界; 铁律 0-2: red→green）:
#   1. 首次同步: 目标空 → 复制全部技能, 内容一致（正常）
#   2. --check 已同步 → exit 0（正常）
#   3. --check 源内容漂移 → exit 1 + 点名文件（边界）
#   4. --check 目标缺失 → exit 1 + 点名文件（边界）
#   5. 目标多余技能（源已删）→ 同步清理（正常）
#   6. 源目录缺失 → exit 2 降级 + 显式日志（降级, D328 三态: 检查失败≠通过）
#   7. 无 SKILL.md 的目录 → 跳过 + 警告, 不失败（边界）
#   8. 生产接线: pre-commit-check.sh 物理调用 sync-dsh-skills.sh（red: 零调用 → 失败）
#
# 隔离: mktemp 沙箱 + SYNO_SKILLS_SRC/SYNO_SKILLS_DST 测试注入, 零网络零真实目录。
# 用法: bash tests/control-tower/sync-dsh-skills.test.sh
# 退出码: 0 = 全部通过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

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
assert_grep() { # <file> <pattern> <msg>
  if grep -q "$2" "$1" 2>/dev/null; then pass "$3"; else fail "$3 (grep 未命中: $2)"; fi
}

# ── 沙箱 ──
TMP=$(mktemp -d /tmp/sds-skills.XXXXXX)
SRC="$TMP/src-skills"
DST="$TMP/dst-skills"
mkdir -p "$SRC/skill-a" "$SRC/skill-b" "$SRC/skill-c" "$SRC/no-skill-dir"
printf '# skill A v1\n' > "$SRC/skill-a/SKILL.md"
printf '# skill B\n' > "$SRC/skill-b/SKILL.md"
printf '# skill C\n' > "$SRC/skill-c/SKILL.md"
printf 'not a skill\n' > "$SRC/no-skill-dir/notes.txt"   # 无 SKILL.md → 应跳过
mkdir -p "$DST"
trap 'rm -rf "$TMP"' EXIT

export SYNO_SKILLS_SRC="$SRC"
export SYNO_SKILLS_DST="$DST"

# ── T1: 首次同步（正常路径）──
OUT1=$(bash "$SYNC" 2>&1)
EXIT1=$?
assert_exit "$EXIT1" 0 "T1: 首次同步 exit 0"
[ -f "$DST/skill-a/SKILL.md" ] && diff -q "$SRC/skill-a/SKILL.md" "$DST/skill-a/SKILL.md" >/dev/null 2>&1 \
  && pass "T1: skill-a 内容一致" || fail "T1: skill-a 复制失败/内容漂移"
[ -f "$DST/skill-b/SKILL.md" ] && [ -f "$DST/skill-c/SKILL.md" ] \
  && pass "T1: skill-b/c 均复制" || fail "T1: skill-b/c 缺失"
[ ! -e "$DST/no-skill-dir" ] && pass "T1: 无 SKILL.md 目录未复制" || fail "T1: no-skill-dir 被误复制"
echo "$OUT1" | grep -q "no-skill-dir" && pass "T1: 跳过目录有显式警告" || fail "T1: 无跳过警告"

# ── T2: --check 已同步 → exit 0（正常）──
OUT2=$(bash "$SYNC" --check 2>&1)
EXIT2=$?
assert_exit "$EXIT2" 0 "T2: --check 一致 exit 0"
echo "$OUT2" | grep -qi "SYNC-OK" && pass "T2: 输出含 SYNC-OK" || fail "T2: 无 SYNC-OK 标记"

# ── T3: 源内容漂移 → exit 1 + 点名（边界）──
printf '# skill A v2 drifted\n' > "$SRC/skill-a/SKILL.md"
OUT3=$(bash "$SYNC" --check 2>&1)
EXIT3=$?
assert_exit "$EXIT3" 1 "T3: 漂移 exit 1"
echo "$OUT3" | grep -q "skill-a" && pass "T3: 输出点名 skill-a" || fail "T3: 未点名漂移文件"

# ── T4: 目标缺失 → exit 1 + 点名（边界）──
rm -f "$DST/skill-b/SKILL.md"
OUT4=$(bash "$SYNC" --check 2>&1)
EXIT4=$?
assert_exit "$EXIT4" 1 "T4: 目标缺失 exit 1"
echo "$OUT4" | grep -q "skill-b" && pass "T4: 输出点名 skill-b" || fail "T4: 未点名缺失文件"

# ── T5: 目标多余技能 → 同步清理（正常）──
mkdir -p "$DST/skill-z"
printf '# zombie\n' > "$DST/skill-z/SKILL.md"
bash "$SYNC" >/dev/null 2>&1
[ ! -e "$DST/skill-z" ] && pass "T5: 僵尸技能已清理" || fail "T5: 僵尸技能残留"

# ── T6: 源目录缺失 → exit 2 降级（降级, D328 三态）──
OUT6=$(SYNO_SKILLS_SRC="$TMP/不存在-src" bash "$SYNC" --check 2>&1)
EXIT6=$?
assert_exit "$EXIT6" 2 "T6: 源缺失 exit 2 (降级≠通过)"
echo "$OUT6" | grep -qi "degraded\|降级" && pass "T6: 降级有显式日志" || fail "T6: 降级无日志（静默=违规）"

# ── T7: 源目录存在但为空 → 同步后目标应为空, --check exit 0（边界）──
EMPTY_SRC="$TMP/empty-src"
mkdir -p "$EMPTY_SRC"
EMPTY_DST="$TMP/empty-dst"
mkdir -p "$EMPTY_DST/old-skill"
printf '# old\n' > "$EMPTY_DST/old-skill/SKILL.md"
OUT7=$(SYNO_SKILLS_SRC="$EMPTY_SRC" SYNO_SKILLS_DST="$EMPTY_DST" bash "$SYNC" 2>&1)
EXIT7=$?
assert_exit "$EXIT7" 0 "T7: 空源同步 exit 0"
[ ! -e "$EMPTY_DST/old-skill" ] && pass "T7: 空源下目标被清空" || fail "T7: 空源下目标未清空"
OUT7C=$(SYNO_SKILLS_SRC="$EMPTY_SRC" SYNO_SKILLS_DST="$EMPTY_DST" bash "$SYNC" --check 2>&1)
assert_exit "$?" 0 "T7: 空源 --check exit 0"

# ── T8: 生产接线（wire check, 铁律 0-2 Step 5）──
# (D962 2a① V5.3: 组 13 判定迁 CI iron-laws——本地 pre-commit 零调用为设计。
#  接线判据改为: 脚本在位 + --check 语义可用 + CI 活点 = .github/workflows/ci.yml:111 iron-laws（无 needs）
if [ -f "$REPO_DIR/scripts/workflow/sync-dsh-skills.sh" ] && bash "$REPO_DIR/scripts/workflow/sync-dsh-skills.sh" --check >/dev/null 2>&1; then
  pass "T8: sync-dsh-skills.sh 在位且 --check 绿（组 13 判定迁 CI，本地调用点随 V5.3 移除）"
else
  fail "T8: sync-dsh-skills.sh 缺失或 --check 红"
fi

# ── 汇总 ──
echo ""
echo "═══════════════════════════════════════"
echo "  PASS=$PASS  FAIL=$FAIL"
echo "═══════════════════════════════════════"
[ "$FAIL" -eq 0 ]
