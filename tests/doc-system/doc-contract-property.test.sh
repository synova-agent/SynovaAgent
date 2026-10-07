#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# doc-contract-property.test.sh — DOC-CONTRACT 闸 3 判据**性质**夹具（D1204 / 卡 #1251 #1252）
#
# 为什么另起一份（K3 D1193 复核 L4 防线缺口）:
#   旧夹具（tests/control-tower/{check,validate}_doc_contract.test.sh）是**示例驱动**——
#   挑几个路径试一下，没有「路径空间 × 变更形态」的性质断言 ⇒ 拦不住 X1/X2/X3 三个逃逸
#   （K3 独立反例实测：同名兄弟前缀 / git mv rename / **/README.md 索引后门 全部放行）。
#   本件按**性质**写：边界路径 × 变更形态（A/R/M）× 变异体验证「改坏即红」。
#
# 覆盖矩阵（正常 / 边界 / 反例 / 降级 / 变异体）:
#   A 判据矩阵（路径空间 × 期望判定）—— 含 X1 三类兄弟名、白名单严格性、X3 索引后门
#   B X3 同址豁免的**两半**：同址无代码 ⇒ 拦；同址有代码 ⇒ 仍放行（防一锅端）
#   C 变更形态矩阵（真 git）: A→阻断区 1 ／ M 存量 0 ／ R 入阻断区 1（X2）／
#     R 出阻断区 0（迁移方向不误拦）／ R→同名兄弟 1（X1×R 交叉）／ A→白名单 0
#     —— `--staged` 与 `--base`（CI 腿）双腿各跑一遍
#   D 变异体反例（改坏即红）: 逐条把修复点退回旧形态，断言**逃逸复现**（夹具不是纸老虎）
#   E #1252: 出口条件机器化（0 件 ⇒ 复审模式判红；有存量 ⇒ 不红）＋存量**动态派生**（单源）
#     ＋声明值≠实测 ⇒ 红（K3 §R3 的 214/215 失配同型）
#   F #1252: 过渡台账落 artifact（默认落点 + --hits-out 显式落点 + 不可写 ⇒ degraded 2）
#   G 降级: 出口判据不可解析 ⇒ exit 2（fail-closed，不与通过混同）
#
# 沙箱: 全部夹具在 mktemp -d 内；真契约**只读复制**；零网络。
# 依赖: python（三级探测）+ git（形态矩阵用；不可用则显式 SKIP 并**点名跳过面**）。
# 运行: bash tests/doc-system/doc-contract-property.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
V="$REPO/scripts/control-tower/validate_doc_contract.py"
CONTRACT="$REPO/docs/synova/DOC-CONTRACT.md"
PASS=0; FAIL=0

ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
no()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
t()   { if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else no "$1 (期望 $2 实际 $3)"; fi; }

# D520 清单1: PYBIN 三级探测（禁裸 python3 —— Windows 可能只有 python/py）
PY=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PY="$_c" && break
done
if [ -z "$PY" ]; then echo "  ⚠️ SKIP: python 三级探测全失败（D520 清单1）—— 无法核判据"; exit 0; fi
[ -f "$V" ] || { echo "  ❌ 被测执行体缺失: $V"; exit 1; }
[ -f "$CONTRACT" ] || { echo "  ❌ 契约缺失: $CONTRACT"; exit 1; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
LAST="$TMPD/last.out"

# ── 夹具工厂 ────────────────────────────────────────────────────────────────
# 判据夹具: 只复制真契约（判据源），路径本身可以是虚构的（--files 模式）
mk_fix() { # $1 = 夹具根
  mkdir -p "$1/docs/synova"
  cp "$CONTRACT" "$1/docs/synova/DOC-CONTRACT.md"
}

# rc_of: 跑执行体，stdout+stderr 落 $LAST，stdout 回 $LAST 供 grep
rc_of() { # $1 = 夹具根；其余 = 执行体参数
  local d="$1"; shift
  "$PY" "$V" --repo-root "$d" "$@" >"$LAST" 2>&1
  echo $?
}
rc_out() { # 同上，但只回 stdout（stderr 丢弃）—— 用于 --json 取件
  local d="$1"; shift
  "$PY" "$V" --repo-root "$d" "$@" 2>/dev/null
}

verdict() { # $1 = 夹具根 $2 = 路径 → block|allow|transition|degraded
  local d="$1" p="$2" out rc
  out="$("$PY" "$V" --repo-root "$d" --files "$p" --json 2>/dev/null)"; rc=$?
  [ "$rc" -eq 2 ] && { echo "degraded"; return; }
  printf '%s' "$out" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
g = d["gate3_inbound"]
if g["violations"]:
    print("block")
elif g.get("transition_hits"):
    print("transition")
else:
    print("allow")'
}

# 变异器（BSD/GNU 安全；不用 sed -i）
mutate() { # $1=src $2=dst $3=old $4=new
  "$PY" - "$1" "$2" "$3" "$4" <<'PYEOF'
import sys
src, dst, old, new = sys.argv[1:5]
t = open(src, encoding="utf-8").read()
if old not in t:
    sys.stderr.write("mutant-miss: %r\n" % old)
    sys.exit(3)
open(dst, "w", encoding="utf-8").write(t.replace(old, new, 1))
PYEOF
}

echo "═══ DOC-CONTRACT 闸 3 性质夹具（D1204）═══"

# ── A 判据矩阵: 路径空间 × 期望判定 ─────────────────────────────────────────
echo "── A 判据矩阵（边界路径）──"
FXA="$TMPD/fx-a"; mk_fix "$FXA"
# 形态: 路径|期望|性质说明
while IFS='|' read -r p want why; do
  [ -n "$p" ] || continue
  t "$why [$p]" "$want" "$(verdict "$FXA" "$p")"
done <<'MATRIX'
docs/plans/x.md|block|子树（D1193 既有语义）
docs/plans.md|block|X1 同名兄弟**文件**（旧实测放行=P1）
docs/plans.html|block|X1 同名兄弟（html 形态）
docs/plansX/y.md|block|X1 同前缀兄弟目录
docs/synova/coordination/moved.md|block|子树
docs/synova/coordination.md|block|X1 同名兄弟
docs/synova/coordinationX/y.md|block|X1 同前缀兄弟（旧实测放行=P1）
docs/synova/audit-reportsX/y.md|block|X1 另一条阻断行同型
docs/plans-old/z.md|block|闭包代价: 同前缀无关路径一并阻断（显式接受，fail-closed）
docs/planning/z.md|allow|口径边界: planning 不是 plans 的前缀 ⇒ 不受闭包影响
docs/x.md|allow|白名单子树（不受阻断侧闭包影响）
docs-old/x.md|block|白名单**不开闭包**（否则 docs/** 放过 docs-old/ = 开后门）
appendix/x.md|block|白名单不开闭包（app/** 不放宽）
decisions/process/x.md|allow|B 层决策
.github/workflows/x.yml|allow|CI 源码
.claude/task-briefs/a.md|transition|§9.1 过渡例外（不算违规）
reports/README.md|block|X3 索引后门（同址无代码）
reports/AGENTS.md|block|X3 同族（AGENTS）
reports/SKILL.md|block|X3 同族（SKILL）
reports/notes-2026.md|block|未授权新目录的普通 md（对照: 与 README 同判）
MATRIX

# ── B X3 的两半: 同址无代码 ⇒ 拦；同址有代码 ⇒ 仍放行 ───────────────────────
echo "── B X3 同址豁免（防一锅端）──"
FXB="$TMPD/fx-b"; mk_fix "$FXB"
mkdir -p "$FXB/packages/demo" "$FXB/reports" "$FXB/src/emptydir"
printf 'export const x = 1\n' > "$FXB/packages/demo/index.ts"
printf '#!/bin/bash\necho hi\n' > "$FXB/src/tool.sh"
t "同址有代码（packages/demo + index.ts）⇒ 仍放行" allow "$(verdict "$FXB" packages/demo/README.md)"
t "同址有代码（src/ + tool.sh）⇒ 仍放行" allow "$(verdict "$FXB" src/README.md)"
t "目录存在但同址只有文档 ⇒ 拦" block "$(verdict "$FXB" reports/README.md)"
t "目录不存在（新播种）⇒ 拦" block "$(verdict "$FXB" brandnew/README.md)"
t "top-level README（白名单显式条目）⇒ 放行" allow "$(verdict "$FXB" README.md)"
t "docs/** 子树内 README ⇒ 放行（走目录白名单，不看同址）" allow "$(verdict "$FXB" docs/research/README.md)"

# ── C 变更形态矩阵（真 git；A/R/M × --staged / --base）──────────────────────
echo "── C 变更形态矩阵（A/R/M）──"
if ! command -v git >/dev/null 2>&1; then
  echo "  ⚠️ SKIP: git 不可用 —— C/D 的形态矩阵面**未执行**（不是通过）"
else
  mk_git_fix() { # $1 = 夹具根
    local d="$1"
    mkdir -p "$d/docs/synova/coordination" "$d/docs/plans"
    cp "$CONTRACT" "$d/docs/synova/DOC-CONTRACT.md"
    printf 'x\n' > "$d/docs/synova/coordination/existing.md"
    printf 'y\n' > "$d/docs/plans/existing.md"
    printf 'z\n' > "$d/docs/old.md"
    ( cd "$d" && git init -q . && git config user.email t@t && git config user.name t \
      && git add -A && git commit -qm base ) >/dev/null 2>&1
  }
  git_head() { ( cd "$1" && git rev-parse HEAD 2>/dev/null ); }
  # CI 腿 `--base ref...HEAD` 比的是**提交**，故每条用例: 先 --staged（暂存态）→ commit → --base
  step_commit() { ( cd "$1" && git -c user.email=t@t -c user.name=t commit -qm step ) >/dev/null 2>&1; }

  # C1 A → 阻断目录: 双腿皆 1
  D="$TMPD/c1"; mk_git_fix "$D"; B="$(git_head "$D")"
  printf 'n\n' > "$D/docs/synova/coordination/new.md"
  ( cd "$D" && git add docs/synova/coordination/new.md )
  t "C1 A→阻断目录  --staged ⇒ 1" 1 "$(rc_of "$D" --staged)"
  step_commit "$D"
  t "C1 A→阻断目录  --base   ⇒ 1" 1 "$(rc_of "$D" --base "$B")"

  # C2 M 存量件 → 阻断目录: 双腿皆 0（契约 §7 存量不返工）
  D="$TMPD/c2"; mk_git_fix "$D"; B="$(git_head "$D")"
  printf 'changed\n' >> "$D/docs/synova/coordination/existing.md"
  ( cd "$D" && git add docs/synova/coordination/existing.md )
  t "C2 M 存量件  --staged ⇒ 0（不返工）" 0 "$(rc_of "$D" --staged)"
  step_commit "$D"
  t "C2 M 存量件  --base   ⇒ 0（不返工）" 0 "$(rc_of "$D" --base "$B")"

  # C3 R（git mv）既有文档 → 阻断目录: 双腿皆 1 ← X2 本体
  D="$TMPD/c3"; mk_git_fix "$D"; B="$(git_head "$D")"
  ( cd "$D" && git mv docs/old.md docs/synova/coordination/moved.md ) >/dev/null 2>&1
  t "C3 R→阻断目录（git mv）--staged ⇒ 1" 1 "$(rc_of "$D" --staged)"
  grep -q "docs/synova/coordination/moved.md" "$LAST" \
    && ok "C3 点名**目标路径**（rename 右侧）" || no "C3 未点名目标路径"
  step_commit "$D"
  t "C3 R→阻断目录（git mv）--base   ⇒ 1" 1 "$(rc_of "$D" --base "$B")"

  # C4 R 出阻断目录 → 白名单目录: 双腿皆 0（迁移方向不得误拦）
  D="$TMPD/c4"; mk_git_fix "$D"; B="$(git_head "$D")"
  ( cd "$D" && git mv docs/synova/coordination/existing.md docs/moved-out.md ) >/dev/null 2>&1
  t "C4 R→出阻断目录 --staged ⇒ 0（迁移方向）" 0 "$(rc_of "$D" --staged)"
  step_commit "$D"
  t "C4 R→出阻断目录 --base   ⇒ 0（迁移方向）" 0 "$(rc_of "$D" --base "$B")"

  # C5 R → 同名兄弟（X1 × R 交叉）: 双腿皆 1
  D="$TMPD/c5"; mk_git_fix "$D"; B="$(git_head "$D")"
  ( cd "$D" && git mv docs/old.md docs/plans.md ) >/dev/null 2>&1
  t "C5 R→同名兄弟 docs/plans.md --staged ⇒ 1" 1 "$(rc_of "$D" --staged)"
  step_commit "$D"
  t "C5 R→同名兄弟 docs/plans.md --base   ⇒ 1" 1 "$(rc_of "$D" --base "$B")"

  # C6 A → 白名单: 双腿皆 0
  D="$TMPD/c6"; mk_git_fix "$D"; B="$(git_head "$D")"
  printf 'ok\n' > "$D/docs/new-ok.md"
  ( cd "$D" && git add docs/new-ok.md )
  t "C6 A→白名单   --staged ⇒ 0" 0 "$(rc_of "$D" --staged)"
  step_commit "$D"
  t "C6 A→白名单   --base   ⇒ 0" 0 "$(rc_of "$D" --base "$B")"

  # C7 A → 新建目录的 README（X3 × A）: 双腿皆 1
  D="$TMPD/c7"; mk_git_fix "$D"; B="$(git_head "$D")"
  mkdir -p "$D/reports"; printf 'idx\n' > "$D/reports/README.md"
  ( cd "$D" && git add reports/README.md )
  t "C7 A→新目录 README --staged ⇒ 1" 1 "$(rc_of "$D" --staged)"
  step_commit "$D"
  t "C7 A→新目录 README --base   ⇒ 1" 1 "$(rc_of "$D" --base "$B")"
fi

# ── D 变异体反例（改坏即红 = 夹具判别性自证）────────────────────────────────
echo "── D 变异体反例（改坏即红）──"
if ! command -v git >/dev/null 2>&1; then
  echo "  ⚠️ SKIP: git 不可用 —— 变异体面未执行（不是通过）"
else
  MUT="$TMPD/mut"; mkdir -p "$MUT"
  FXM="$TMPD/fx-mut"; mk_fix "$FXM"

  # D1 X1 变异: 阻断侧前缀闭包 → 关掉
  mutate "$V" "$MUT/m1.py" \
    'return bool(closure and base and rel.startswith(base))  # 同前缀兄弟（仅阻断侧）' \
    'return False  # MUTANT: 闭包关闭' >/dev/null 2>&1 \
    && { "$PY" "$MUT/m1.py" --repo-root "$FXM" --files docs/plans.md >"$LAST" 2>&1
         [ $? -eq 0 ] && ok "D1 变异体（闭包关）⇒ docs/plans.md 逃逸复现（夹具判别性成立）" \
                      || no "D1 变异体未复现逃逸（夹具可能是纸老虎）"; } \
    || no "D1 变异失败（执行体结构已变，须同步本测试的变异靶）"

  # D2 X2 变异: --diff-filter=ACR → A
  mutate "$V" "$MUT/m2.py" \
    'nm = ["--name-status", "--diff-filter=ACR"]' \
    'nm = ["--name-status", "--diff-filter=A"]  # MUTANT' >/dev/null 2>&1 \
    && { D="$TMPD/m2fix"; mk_git_fix "$D"
         ( cd "$D" && git mv docs/old.md docs/synova/coordination/moved.md ) >/dev/null 2>&1
         "$PY" "$MUT/m2.py" --repo-root "$D" --staged >"$LAST" 2>&1
         [ $? -eq 0 ] && ok "D2 变异体（filter=A）⇒ rename 逃逸复现（X2 夹具判别性成立）" \
                      || no "D2 变异体未复现 rename 逃逸"; } \
    || no "D2 变异失败（须同步变异靶）"

  # D3 X3 变异: 同址判定 → 恒放行
  mutate "$V" "$MUT/m3.py" \
    'if is_colocation_exempt(pat) and not colocated_with_code(repo, rel):' \
    'if False:  # MUTANT: 同址判定关闭' >/dev/null 2>&1 \
    && { FX3="$TMPD/fx-m3"; mk_fix "$FX3"; mkdir -p "$FX3/reports"
         "$PY" "$MUT/m3.py" --repo-root "$FX3" --files reports/README.md >"$LAST" 2>&1
         [ $? -eq 0 ] && ok "D3 变异体（同址判定关）⇒ reports/README.md 逃逸复现（X3 夹具判别性成立）" \
                      || no "D3 变异体未复现 README 索引后门"; } \
    || no "D3 变异失败（须同步变异靶）"
fi

# ── E #1252 出口条件机器化 + 存量动态派生 ──────────────────────────────────
echo "── E #1252 出口条件 / 存量派生 ──"
if ! command -v git >/dev/null 2>&1; then
  echo "  ⚠️ SKIP: git 不可用 —— 出口条件面未执行（不是通过）"
else
  mk_brief_fix() { # $1 = 夹具根；$2 = brief 件数；$3 = 过渡行第 5 列（声明存量，可空）
    local d="$1" n="$2" decl="$3" i
    mkdir -p "$d/docs/synova" "$d/.claude/task-briefs"
    cp "$CONTRACT" "$d/docs/synova/DOC-CONTRACT.md"
    i=1; while [ "$i" -le "$n" ]; do printf '# brief %s\n' "$i" > "$d/.claude/task-briefs/b$i.md"; i=$((i+1)); done
    if [ -n "$decl" ]; then
      "$PY" - "$d/docs/synova/DOC-CONTRACT.md" "$decl" <<'PYEOF'
import sys
p, decl = sys.argv[1], sys.argv[2]
t = open(p, encoding="utf-8").read()
old = "| tracked-count:.claude/task-briefs/**=0 | —"
new = "| tracked-count:.claude/task-briefs/**=0 | " + decl
assert old in t, "contract-shape-changed"
open(p, "w", encoding="utf-8").write(t.replace(old, new, 1))
PYEOF
    fi
    ( cd "$d" && git init -q . && git config user.email t@t && git config user.name t \
      && git add -A && git commit -qm base ) >/dev/null 2>&1
  }

  # E1 有存量 ⇒ 复审模式不判「已达出口」
  D="$TMPD/e1"; mk_brief_fix "$D" 2 ""
  rc_of "$D" --baseline >/dev/null
  grep -q "已达出口条件" "$LAST" \
    && no "E1 有存量（2 件）却判「已达出口」（误红）" \
    || ok "E1 有存量（2 件）⇒ 不判已达出口"

  # E2 存量归零 ⇒ 复审模式（--baseline）判红且点名
  D="$TMPD/e2"; mk_brief_fix "$D" 0 ""
  RC="$(rc_of "$D" --baseline)"
  [ "$RC" -eq 1 ] && grep -q "已达出口条件" "$LAST" \
    && ok "E2 存量=0 ⇒ --baseline 判红（出口即失效，防「临时即永久」）" \
    || no "E2 存量=0 应判红并点名，实际 rc=$RC"

  # E3 同上场景的**逐 PR 模式**: 只出 NOTE，不连坐（台账是契约自身棘轮，不是每 PR 判据）
  RC="$(rc_of "$D" --staged)"
  [ "$RC" -eq 0 ] && grep -q "NOTE" "$LAST" \
    && ok "E3 存量=0 在 --staged 只出 NOTE（不连坐无关夹具）" \
    || no "E3 --staged 应 exit 0 + NOTE，实际 rc=$RC"

  # E4 存量**动态派生**（单源）: 报数 == git ls-files 实况（3 件）
  D="$TMPD/e4"; mk_brief_fix "$D" 3 ""
  GOT="$(rc_out "$D" --json | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
rows = d["transition_table"]["rows"]
print(rows[0]["tracked"] if rows else "none")')"
  REAL="$(cd "$D" && git ls-files '.claude/task-briefs/**' | wc -l | tr -d ' ')"
  t "E4 存量动态派生 == git ls-files 实况（$REAL）" "$REAL" "$GOT"

  # E5 声明值 ≠ 实测 ⇒ 红（K3 §R3 的 214/215 失配同型）
  D="$TMPD/e5"; mk_brief_fix "$D" 2 "214"
  RC="$(rc_of "$D" --staged)"
  [ "$RC" -eq 1 ] && grep -q "声明存量 214 ≠ 实测 2" "$LAST" \
    && ok "E5 声明存量 214 ≠ 实测 2 ⇒ 判红（禁双源）" \
    || no "E5 声明≠实测 应判红并点名，实际 rc=$RC"

  # E6 声明值 == 实测 ⇒ 不红（证明不是「有声明就红」）
  D="$TMPD/e6"; mk_brief_fix "$D" 2 "2"
  RC="$(rc_of "$D" --staged)"
  t "E6 声明存量 == 实测（2）⇒ 不红" 0 "$RC"

  # E7 出口判据列缺失（出口条件退回散文）⇒ degraded 2（fail-closed）
  D="$TMPD/e7"; mk_brief_fix "$D" 1 ""
  "$PY" - "$D/docs/synova/DOC-CONTRACT.md" <<'PYEOF'
import sys
p = sys.argv[1]
t = open(p, encoding="utf-8").read()
t = t.replace("| tracked-count:.claude/task-briefs/**=0 | —", "| 迁出仓库即可 | —", 1)
open(p, "w", encoding="utf-8").write(t)
PYEOF
  RC="$(rc_of "$D" --staged)"
  [ "$RC" -eq 2 ] && grep -q "出口判据不可解析" "$LAST" \
    && ok "G 出口判据不可解析 ⇒ exit 2（出口条件必须机器可判，fail-closed）" \
    || no "G 应 exit 2 + 点名，实际 rc=$RC"

  # ── F 过渡台账落 artifact ────────────────────────────────────────────────
  echo "── F 过渡台账 artifact（#1252 ②）──"
  D="$TMPD/f1"; mk_brief_fix "$D" 1 ""
  rc_of "$D" --files .claude/task-briefs/b1.md >/dev/null
  ART="$D/.codex/control-tower/logs/doc-contract-transition.json"
  if [ -f "$ART" ]; then
    ok "F1 默认落点写出 artifact（$ART#）"
    "$PY" -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
assert d["artifact"] == "doc-contract-transition", "artifact tag"
hits = d["gate3"]["transition_hits"]
assert any(h["pattern"] == ".claude/task-briefs/**" for h in hits), "transition_hits missing"
assert d["transition_table"]["rows"][0]["tracked"] == 1, "tracked count"
' "$ART" && ok "F2 artifact 含 transition_hits + 动态存量（可复查载体）" \
          || no "F2 artifact 内容缺项"
  else
    no "F1 未落 artifact（默认落点）"
  fi

  OUTP="$TMPD/explicit-hits.json"
  rc_of "$D" --files .claude/task-briefs/b1.md --hits-out "$OUTP" >/dev/null
  [ -f "$OUTP" ] && ok "F3 --hits-out 显式落点生效" || no "F3 --hits-out 未生效"

  touch "$TMPD/afile"
  RC="$(rc_of "$D" --files .claude/task-briefs/b1.md --hits-out "$TMPD/afile/x.json")"
  [ "$RC" -eq 2 ] && ok "F4 --hits-out 不可写 ⇒ exit 2（显式契约 fail-closed）" \
                  || no "F4 不可写应 exit 2，实际 rc=$RC"

  # F5 非 git 夹具: 台账未评估 ⇒ 显式 warning（不静默、不误判 degraded）
  FXNG="$TMPD/fx-nogit"; mk_fix "$FXNG"
  RC="$(rc_of "$FXNG" --files docs/x.md)"
  [ "$RC" -eq 0 ] && grep -q "未评估" "$LAST" \
    && ok "F5 非 git 夹具 ⇒ 台账显式标注未评估（不静默）" \
    || no "F5 非 git 夹具应 exit 0 + 显式未评估标注，实际 rc=$RC"
fi

echo ""
echo "doc-contract-property.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
