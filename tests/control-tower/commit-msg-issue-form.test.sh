#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# commit-msg-issue-form.test.sh — D1223/② 提交端「issue 新形态」配对夹具
#
# SUT: scripts/commit-msg-check.sh（D-C 单库 R5 的提交端消费点）
#
# 为什么需要本件（铁律 0-2 · 无夹具＝纸老虎）:
#   D-C 核心已把 `feat(#N): …` 形态接进提交端（scope 字符集含 `#` + MSG_ISSUE 走
#   claim_store.parse_issue），但**全仓无任何夹具覆盖提交端这条路径**
#   （实测: `grep -rln 'feat(#\|\-\-issue-of' tests/control-tower/*` 仅命中
#   claim_store.test.sh，它只测库本身；claim-identity-v2.test.py 不碰提交端）。
#   本件补上该防线：新形态一旦被改坏（解析删掉 / 字符集收紧）必须**物理红**。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 判别性）:
#   C1 正常  — `feat(#1284): …` + claim 声明（开关开）→ exit 0（**新形态通过**）
#   C2 边界  — `feat(): …`（空 scope）→ exit 1（格式门禁拒绝）
#   C3 兼容  — `chore(D1099): …` + legacy brief → exit 0（**旧形态在兼容期仍通过**）
#   C4 边界  — `feat(#1284): …` 但暂存文件**不在**该 claim 写集 → exit 1（新形态不得白名单化）
#   C5 边界  — 开关关（迁移期默认）+ 新形态 → 格式面通过（观察口径，不断言身份判定）
#   C6 边界  — 分支名锚点(D1099) 与消息声明(D1223) **冲突**、且无 claim → exit 1（R4 fail-closed）
#   C7 边界  — 分支名锚点(D1099) 与消息声明(D1099) **一致** → exit 0（不误伤；R4 只拦冲突）
#   M1 变异  — 中和 MSG_ISSUE 提取（issue 号解析被删）⇒ **C1 必红**（判别性核心）
#   M2 变异  — 从格式门禁字符类移除 `#` ⇒ **C1 必红**（字符集是硬条件，不是装饰）
#   M3 变异  — 删掉 R4 冲突检查（把 stderr 重定向恢复成丢弃）⇒ **C6 必红**（最弱锚点劫持面复开）
#
# 语义边界（本件**不**断言的事，防假绿）:
#   · 本件不测 D708 合并级对账（那是 merge_writeset_gate.test.sh 的职责）。
#   · 本件不测"分支名身份顺位"（提交端**不消费**分支名：`grep -n 'branch\|symbolic-ref'
#     scripts/commit-msg-check.sh` 零命中）——该面属 D708 侧，另卡。
#   · C5 的"开关关"只断言**格式面**通过：身份对账在开关关时走 legacy 口径（迁移期设计），
#     断言 exit 0 是**记录现行为**，不是声称"新形态在开关关时具备身份保障"。
#
# 隔离: mktemp 沙箱 + 复制 scripts/ + 注入 SYNO_STAGED_FILES / SYNO_CLAIM_V2；零网络、零宿主写入。
# 用法: bash tests/control-tower/commit-msg-issue-form.test.sh
# 退出码: 0 = 全绿；1 = 断言失败；2 = 检查自身失败（缺 python / 缺 SUT）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/commit-msg-check.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

[ -f "$SUT" ] || { echo "  ❌ SUT 缺失: $SUT（检查自身失败）"; exit 2; }
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== 提交端 issue 新形态夹具（D1223/② · 新旧兼容 + 判别性）==="

# ── 沙箱构造: scripts/ 全量 + claim(#1284) + legacy brief(D1099) ──
build_sb() {
  local d="$1"
  mkdir -p "$d/.claude/claims" "$d/.claude/task-briefs" "$d/memory/notes/proposed"
  cp -R "$REPO/scripts" "$d/scripts"
  cat > "$d/.claude/claims/1284.yaml" <<'YAML'
writeset:
  - tests/x.test.sh
done:
  - verify: bash tests/x.test.sh
YAML
  cat > "$d/.claude/task-briefs/2026-10-07-D1099-legacy-probe.md" <<'MD'
# Task Brief: D1099 legacy probe
#CRITERIA: D
## Q0: 定位
probe
## Q1: 调研
Anthropic
## Q2: 范围
做什么：
- tests/y.test.sh
不做什么：
- 不改 src/foo/bar.ts
## Q3: 验收
入口：x
处理：y
结果：z
## 架构层: 基础设施
## Done 标准
- [x] verify: bash tests/y.test.sh
MD
  printf '%s\n' '---' '状态: proposed' '日期: 2026-10-07' '决策: probe' '理由: probe' '---' \
    > "$d/memory/notes/proposed/2026-10-07-probe.md"
  git -C "$d" init -q -b main >/dev/null 2>&1
  git -C "$d" config user.email t@t
  git -C "$d" config user.name t
}

# rc_of <sandbox> <checker> <msg> <staged> <claim_v2>
rc_of() {
  local d="$1" chk="$2" msg="$3" staged="$4" v2="$5" mf rc=0
  mf="$(mktemp)"
  printf '%s\n' "$msg" > "$mf"
  ( cd "$d" && SYNO_STAGED_FILES="$staged" SYNO_CLAIM_V2="$v2" bash "$chk" "$mf" ) >/dev/null 2>&1 || rc=$?
  rm -f "$mf"
  printf '%s' "$rc"
}

SB="$TMPD/sb"; build_sb "$SB"

# ── C1 正常: 新形态 + claim（开关开）⇒ 必须通过 ──
RC1=$(rc_of "$SB" "$SB/scripts/commit-msg-check.sh" 'feat(#1284): 新形态探针' 'tests/x.test.sh' 1)
[ "$RC1" -eq 0 ] && ok "C1 新形态 feat(#1284): + claim → exit 0（通过）" \
  || no "C1 新形态应 exit 0, 实际 exit=$RC1（issue 解析或 scope 字符集回归）"

# ── C2 边界: 空 scope ⇒ 必须拒绝 ──
RC2=$(rc_of "$SB" "$SB/scripts/commit-msg-check.sh" 'feat(): 空 scope 探针' 'tests/x.test.sh' 1)
[ "$RC2" -eq 1 ] && ok "C2 空 scope feat(): → exit 1（格式门禁拒绝）" \
  || no "C2 空 scope 应 exit 1, 实际 exit=$RC2"

# ── C3 兼容期: 旧形态 + legacy brief ⇒ 必须仍通过 ──
RC3=$(rc_of "$SB" "$SB/scripts/commit-msg-check.sh" 'chore(D1099): legacy 探针' 'tests/y.test.sh' 1)
[ "$RC3" -eq 0 ] && ok "C3 旧形态 chore(D1099): + legacy brief → exit 0（兼容期仍通过）" \
  || no "C3 旧形态应 exit 0, 实际 exit=$RC3（旧 D# 链被误伤）"

# ── C4 边界: 新形态但暂存不在该 claim 写集 ⇒ 不得白名单化 ──
RC4=$(rc_of "$SB" "$SB/scripts/commit-msg-check.sh" 'feat(#1284): 越界探针' 'tests/y.test.sh' 1)
[ "$RC4" -eq 1 ] && ok "C4 新形态 + 暂存不在 claim 写集 → exit 1（fail-closed，不白名单化）" \
  || no "C4 应 exit 1, 实际 exit=$RC4（新形态被当成免检通道）"

# ── C5 边界: 开关关（迁移期默认）⇒ 格式面仍通过（如实记录现行为）──
RC5=$(rc_of "$SB" "$SB/scripts/commit-msg-check.sh" 'feat(#1284): 开关关探针' 'tests/x.test.sh' 0)
[ "$RC5" -eq 0 ] && ok "C5 开关关 + 新形态 → exit 0（格式面通过；身份对账走 legacy 口径）" \
  || no "C5 开关关应 exit 0（格式面）, 实际 exit=$RC5"

# ── C6/C7 边界: R4「分支名劫持」——最弱锚点与消息声明冲突 ⇒ fail-closed ──
# 地形: 分支名带 D1099（有可解析 brief）；暂存文件**不被任何 brief 认领** ⇒ 解析器走到
#       「强锚点回退（分支名）」⇒ 打 RESOLVER-ANCHOR 标记 ⇒ 提交端必须与消息声明比对。
SBB="$TMPD/sbr4"; build_sb "$SBB"
git -C "$SBB" checkout -q -b "feat/D1099-branch-anchor" 2>/dev/null || true
git -C "$SBB" add -A >/dev/null 2>&1
git -C "$SBB" commit -q -m "init" >/dev/null 2>&1
# 标记先行断言: 解析器确实打了"最弱锚点"标记（否则 C6 判的是别的路径 = 假绿）
MARK=$( cd "$SBB" && bash "$SBB/scripts/workflow/resolve-commit-brief.sh" "tests/z.test.sh" 2>&1 >/dev/null || true )
echo "$MARK" | grep -q 'source=branch-anchor' \
  && ok "接线④: 解析器在分支锚点回退时打 RESOLVER-ANCHOR 标记（C6 判据的硬条件）" \
  || no "接线④: 未打最弱锚点标记 — C6 将判在别的路径上（假绿风险）: ${MARK}"

RC6=$(rc_of "$SBB" "$SBB/scripts/commit-msg-check.sh" 'chore(D1223): 分支锚点冲突探针' 'tests/z.test.sh' 1)
[ "$RC6" -eq 1 ] && ok "C6 分支锚点(D1099) × 消息声明(D1223) 冲突 → exit 1（R4 fail-closed）" \
  || no "C6 冲突应 exit 1, 实际 exit=$RC6（最弱锚点劫持面复开）"

RC7=$(rc_of "$SBB" "$SBB/scripts/commit-msg-check.sh" 'chore(D1099): 分支锚点一致探针' 'tests/z.test.sh' 1)
[ "$RC7" -eq 0 ] && ok "C7 分支锚点(D1099) × 消息声明(D1099) 一致 → exit 0（只拦冲突，不误伤）" \
  || no "C7 一致应 exit 0, 实际 exit=$RC7（R4 检查误伤一致路径）"

# ── 对照组: 接线断言（缺任一 ⇒ 本件恒绿 = 纸老虎）──
grep -q 'MSG_ISSUE=' "$SUT" && ok "接线①: SUT 含 MSG_ISSUE 提取点" || no "接线①: MSG_ISSUE 提取点缺失"
grep -q 'claim_store' "$SUT" && ok "接线②: SUT 经 claim_store 单源（不复制正则）" || no "接线②: claim_store 单源缺失"
grep -qF -- '[a-zA-Z0-9_.+#-]' "$SUT" && ok "接线③: 格式门禁 scope 字符类含 #（本件判据的硬条件）" || no "接线③: scope 字符类缺 #"

# ══════════════════════════════════════════════════════════════════════════════
# 变异体（判别性: 改坏即红）——在沙箱副本上注入，断言 C1 必翻转
# ══════════════════════════════════════════════════════════════════════════════
expect_c1_mut() {  # $1=变异体名  $2=沙箱路径
  local name="$1" sb="$2" rc
  rc=$(rc_of "$sb" "$sb/scripts/commit-msg-check.sh" 'feat(#1284): 新形态探针' 'tests/x.test.sh' 1)
  if [ "$rc" -ne 0 ]; then
    ok "变异体 $name: C1 已翻转（exit=$rc ≠ 0）⇒ 夹具对该改坏有判别力"
  else
    no "变异体 $name: C1 仍 exit 0 —— 判别力失效（该改坏抓不到）"
  fi
}

# M1: 中和 MSG_ISSUE 提取（issue 号解析被删）⇒ 新形态必被拒
SB_M1="$TMPD/sb-M1"; build_sb "$SB_M1"
"$PYBIN" - "$SB_M1/scripts/commit-msg-check.sh" <<'PYM1'
import re, sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
# 把 MSG_ISSUE 的赋值整体置空（模拟"issue 号解析被删"）
n = 0
def repl(m):
    global n
    n += 1
    return 'MSG_ISSUE=""  # MUTANT: issue 解析被删\n'
t2, k = re.subn(r'^\s*MSG_ISSUE=\$\(.*?\).*$', repl, t, flags=re.M)
assert k >= 1, "未找到 MSG_ISSUE 赋值点（夹具写集漂移）"
p.write_text(t2, encoding="utf-8")
print(f"M1 注入: 中和 {k} 处 MSG_ISSUE 提取", file=sys.stderr)
PYM1
expect_c1_mut "M1 issue 号解析被删" "$SB_M1"

# M2: 从格式门禁字符类移除 `#` ⇒ 新形态在格式面即被拒
SB_M2="$TMPD/sb-M2"; build_sb "$SB_M2"
"$PYBIN" - "$SB_M2/scripts/commit-msg-check.sh" <<'PYM2'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
old = "[a-zA-Z0-9_.+#-]"
assert old in t, "未找到 scope 字符类（夹具写集漂移）"
p.write_text(t.replace(old, "[a-zA-Z0-9_.-]", 1), encoding="utf-8")
print("M2 注入: scope 字符类移除 #", file=sys.stderr)
PYM2
expect_c1_mut "M2 scope 字符类移除 #" "$SB_M2"

# M3: 删掉 R4 冲突检查（把 stderr 重新吞掉）⇒ C6 必不再红（劫持面复开）
SB_M3="$TMPD/sb-M3"; build_sb "$SB_M3"
git -C "$SB_M3" checkout -q -b "feat/D1099-branch-anchor" 2>/dev/null || true
git -C "$SB_M3" add -A >/dev/null 2>&1
git -C "$SB_M3" commit -q -m "init" >/dev/null 2>&1
"$PYBIN" - "$SB_M3/scripts/commit-msg-check.sh" <<'PYM3'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
old = '2>"$RESOLVER_ERR" | head -1'
assert old in t, "未找到 stderr 分流捕获点（夹具写集漂移）"
p.write_text(t.replace(old, '2>/dev/null | head -1', 1), encoding="utf-8")  # swallow-ok: 变异注入的**被测字符串**字面量（本行不吞任何错误）
print("M3 注入: 恢复丢弃 stderr（吞掉 RESOLVER-ANCHOR 标记）", file=sys.stderr)  # swallow-ok: 注入日志文本，改写后不含被扫字面量
PYM3
RC_M3=$(rc_of "$SB_M3" "$SB_M3/scripts/commit-msg-check.sh" 'chore(D1223): 分支锚点冲突探针' 'tests/z.test.sh' 1)
if [ "$RC_M3" -ne 1 ]; then
  ok "变异体 M3 R4 冲突检查被删: C6 已翻转（exit=$RC_M3 ≠ 1）⇒ 夹具对劫持面复开有判别力"
else
  no "变异体 M3: C6 仍 exit 1 —— 判别力失效（删掉 R4 检查也抓不到）"
fi

# ── 对照组②: 未变异沙箱重跑 C1 必须仍为 0（证明翻转来自变异本身）──
SB_CTL="$TMPD/sb-ctl"; build_sb "$SB_CTL"
RC_CTL=$(rc_of "$SB_CTL" "$SB_CTL/scripts/commit-msg-check.sh" 'feat(#1284): 新形态探针' 'tests/x.test.sh' 1)
[ "$RC_CTL" -eq 0 ] && ok "对照组②（未变异沙箱副本）: C1 exit 0 ⇒ 变异翻转可归因（非沙箱失真）" \
  || no "对照组② 应 exit 0, 实际 exit=$RC_CTL（沙箱失真，变异体结论不可信）"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
