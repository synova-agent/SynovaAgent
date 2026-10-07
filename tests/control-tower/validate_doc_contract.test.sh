#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# validate_doc_contract.test.sh — 三闸判据内核测试（铁律 48: 非空壳）
# 覆盖矩阵（正常 / 边界 / 降级 / 判据来源）:
#   A 三块齐 → 白名单命中放行              exit 0
#   B 判据来自契约文本（改契约即改行为）    加一条阻断 → 原本放行的路径变红
#   C 缺块 → degraded（fail-closed）      移除 blocked 块 → exit 2
#   D --json 形状                          含 checked / transition_hits
#   E 闸 1 对缺段决策件判红                夹具决策件缺 决定/后果 → exit 1
#   F --baseline 可跑且 JSON 可解析        真仓全量
#   ── D1203（K3 复核整改）性质断言矩阵：边界路径 × 变更形态 ──
#   G 前缀闭包矩阵     base.md 拦 / base/ 拦 / base-archive/ 不误拦（7 条阻断前缀 × 3 形态）
#   G2 过渡条目同名前缀仍走过渡（不算违规）
#   H rename(X2)      git mv 进阻断区：--staged 与 --base 两形态都必须拦
#   H2 M 形态         改阻断区存量件不返工（exit 0）
#   I 过渡落盘(R3)    命中写 .claude/doc-contract-transition.log；落盘失败 warn 且不阻断
# 运行: bash tests/control-tower/validate_doc_contract.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IMPL="$REPO/scripts/control-tower/check-doc-contract.sh"
PASS=0; FAIL=0

t() { if [ "$2" = "$3" ]; then echo "  OK   $1 (=$3)"; PASS=$((PASS+1)); else echo "  FAIL $1 (期望 $2 实际 $3)"; FAIL=$((FAIL+1)); fi; }

# D520 清单1: PYBIN 三级探测（禁裸 python3 —— Windows 可能只有 python/py）
PYBIN=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done

FIX=$(mktemp -d); FIX2=$(mktemp -d); FIX3=$(mktemp -d)
trap 'rm -rf "$FIX" "$FIX2" "$FIX3"' EXIT
for d in "$FIX" "$FIX2" "$FIX3"; do mkdir -p "$d/docs/synova"; cp "$REPO/docs/synova/DOC-CONTRACT.md" "$d/docs/synova/DOC-CONTRACT.md"; done

bash "$IMPL" --repo-root "$FIX" --files docs/research/ok.md >/dev/null 2>&1; t "A 白名单命中→0" 0 "$?"

"$PYBIN" - "$FIX2/docs/synova/DOC-CONTRACT.md" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding='utf-8')
s = s.replace('novis-backup-20260526/**', 'novis-backup-20260526/**\ndocs/synova/research/**', 1)
p.write_text(s, encoding='utf-8')
PYEOF
bash "$IMPL" --repo-root "$FIX2" --files docs/synova/research/ok.md >/dev/null 2>&1; t "B 改契约即改行为→1" 1 "$?"
bash "$IMPL" --repo-root "$FIX" --files docs/synova/research/ok.md >/dev/null 2>&1; t "B 原契约同件仍放行→0" 0 "$?"

"$PYBIN" - "$FIX3/docs/synova/DOC-CONTRACT.md" <<'PYEOF'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1]); fence = chr(96) * 3
s = p.read_text(encoding='utf-8')
s = re.sub(re.escape(fence) + 'doc-contract-blocked.*?' + re.escape(fence), '', s, flags=re.S)
p.write_text(s, encoding='utf-8')
PYEOF
bash "$IMPL" --repo-root "$FIX3" --files docs/x.md >/dev/null 2>&1; t "C 缺 blocked 块→2" 2 "$?"

J=$(bash "$IMPL" --repo-root "$FIX" --files .claude/task-briefs/a.md --json 2>/dev/null)  # swallow-ok: 夹具只看 JSON 形状，失败由 exit code 用例覆盖
D1=no; case "$J" in *'"checked"'*) D1=yes;; esac
D2=no; case "$J" in *'"transition_hits"'*) D2=yes;; esac
t "D --json 含 checked/transition_hits" "yes yes" "$D1 $D2"

H=$(mktemp -d); mkdir -p "$H/docs/synova" "$H/decisions/process"
cp "$REPO/docs/synova/DOC-CONTRACT.md" "$H/docs/synova/DOC-CONTRACT.md"
printf '# 决策: 夹具\n\n状态: implemented\n日期: 2026-10-07\n\n## 一句话\n夹具\n' > "$H/decisions/process/2026-10-07-fixture.md"
bash "$IMPL" --repo-root "$H" --all-decisions >/dev/null 2>&1; t "E 闸1 缺段→1" 1 "$?"
rm -rf "$H"

B=$(bash "$IMPL" --repo-root "$REPO" --baseline --json 2>/dev/null)  # swallow-ok: 夹具只看 JSON 可解析性
F_OK=no; case "$B" in *'"gate3_inbound"'*) F_OK=yes;; esac
t "F --baseline JSON 可解析" yes "$F_OK"

# ── D1203 性质断言矩阵（K3 复核 L4 建议：不只补示例，补覆盖路径空间的断言） ──
# G 前缀闭包：对每条【非过渡】阻断条目 base 断言三形态
# 注：闭包只对**有白名单父级**的阻断条目才有可观测差异（docs/** 会兜住近邻）——
#     顶层阻断条目（novis-*）的近邻本来就因“未命中白名单”拦下，所以分开断言。
for base in docs/synova/coordination docs/synova/audit-reports docs/synova/dispatch docs/plans docs/archive docs/synova/archive; do
  bash "$IMPL" --repo-root "$FIX" --files "${base}.md" >/dev/null 2>&1; t "G ${base}.md 同名前缀文件→1" 1 "$?"
  bash "$IMPL" --repo-root "$FIX" --files "${base}/sub/x.md" >/dev/null 2>&1; t "G ${base}/ 子树→1" 1 "$?"
  bash "$IMPL" --repo-root "$FIX" --files "${base}-archive/x.md" >/dev/null 2>&1; t "G ${base}-archive/ 近邻不误拦→0" 0 "$?"
done
bash "$IMPL" --repo-root "$FIX" --files "novis-backup-20260526.md" >/dev/null 2>&1; t "G novis-*.md 同名前缀→1" 1 "$?"
bash "$IMPL" --repo-root "$FIX" --files "novis-backup-20260526-archive/x.md" >/dev/null 2>&1; t "G novis 近邻→1（非闭包所致，无白名单父级）" 1 "$?"
bash "$IMPL" --repo-root "$FIX" --files ".claude/task-briefs.md" >/dev/null 2>&1; t "G2 过渡条目同名前缀仍过渡→0" 0 "$?"

# H rename 进阻断区（X2）：staged 与 --base 两形态
R2=$(mktemp -d); mkdir -p "$R2/docs/synova/coordination" "$R2/scripts"
cp -R "$REPO/scripts/control-tower" "$R2/scripts/"
mkdir -p "$R2/docs/synova"; cp "$REPO/docs/synova/DOC-CONTRACT.md" "$R2/docs/synova/"
printf 'x\n' > "$R2/docs/foo.md"
( cd "$R2" && git init -q . && git add -A && git -c user.email=t@t -c user.name=t commit -qm init )
BASE2=$( cd "$R2" && git rev-parse HEAD )
( cd "$R2" && git mv docs/foo.md docs/synova/coordination/moved.md )
t "H rename 进阻断区 --staged→1" 1 "$(bash "$R2/scripts/control-tower/check-doc-contract.sh" --repo-root "$R2" --staged >/dev/null 2>&1; echo $?)"
( cd "$R2" && git -c user.email=t@t -c user.name=t commit -qm moved >/dev/null 2>&1 )
t "H rename 进阻断区 --base→1" 1 "$(bash "$R2/scripts/control-tower/check-doc-contract.sh" --repo-root "$R2" --base "$BASE2" >/dev/null 2>&1; echo $?)"
printf 'edit\n' >> "$R2/docs/synova/coordination/moved.md"
( cd "$R2" && git add docs/synova/coordination/moved.md )
t "H2 修改阻断区存量件→0（存量不返工）" 0 "$(bash "$R2/scripts/control-tower/check-doc-contract.sh" --repo-root "$R2" --staged >/dev/null 2>&1; echo $?)"
rm -rf "$R2"

# I 过渡计数落盘（R3） + 落盘失败不静默（铁律 11）
LOGF="$(mktemp -d)/t.log"
SYNO_DOC_CONTRACT_LOG="$LOGF" bash "$IMPL" --repo-root "$FIX" --files .claude/task-briefs/a.md >/dev/null 2>&1
grep -q "doc-contract-transition" "$LOGF" 2>/dev/null && I1=yes || I1=no
t "I 过渡命中落盘" yes "$I1"
SYNO_DOC_CONTRACT_LOG=/proc/nonexistent/x.log bash "$IMPL" --repo-root "$FIX" --files .claude/task-briefs/a.md >/dev/null 2>/tmp/d1203-w.txt; I2=$?
grep -q "^warn:" /tmp/d1203-w.txt && I3=yes || I3=no
t "I 落盘失败不阻断(exit 0)" 0 "$I2"
t "I 落盘失败显式 warn" yes "$I3"

echo ""
echo "validate_doc_contract.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0