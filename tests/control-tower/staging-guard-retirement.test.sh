#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# staging-guard-retirement.test.sh — D1225 staging_guard.py 退役 + 替身真实性夹具
#
# 承继: 已退役的 tests/control-tower/staging_guard.test.sh（其被测模块已删）。
# 本件不测已删模块的行为，而测**「退役」这件事本身是否成立**：
#   ① 退役事实   — 件已删 + 生产面（scripts/ .github/）**代码行**零引用
#   ② 替身真实   — 原判据面的承担者必须在 CI **真实存在且可执行调用**（铁律 0-2 WIRE CHECK；
#                  参考 D-D 的 T11c「断言替代物在 CI 真实存在」做法）
#   ③ 处置落地   — 逐消费点（synova-commit 呈报 / self-health 清单 / incident-loop R1 / 隔离台账）
#   ④ 禁静默空白 — 铁律 11：退役结论**恒打印**，只读呈报取不到数据必留降级痕
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 判别性）:
#   正常 — 真实仓库：7 项结构性断言全过
#   降级 — synova-commit 去掉退役结论字面量 ⇒ ④ 必红（显式降级不得静默）
#   边界 — 逐变异体（M1–M6）：替身调用被注释 / 结论被删 / 清单回填 / 件被复活 /
#          R1 回退 / **代码行引用被回注**
#          ⇒ 对应项**必红**；且「未变异沙箱」对照组全过（证明翻转来自变异本身）
#
# 语义边界（本件**不**断言的事，防假绿）:
#   · 「代码行零引用」= 注释与 **.py 文档字符串**不计（留痕≠残留）；其余行（含列表元素里的
#     路径字面量、import、env 变量）零命中。判定实现用 ast + tokenize，非正则猜注释。
#   · 本件不测 D708 门禁的判定正确性（那是 merge_writeset_gate.test.sh 的职责），
#     只测它**在 CI 被真实调用且件存在**（退役后不给"看似有替身"的假通过）。
#
# 隔离: mktemp 沙箱 + 逐文件复制（不复制 .git）；零网络；不改宿主仓库。
# 用法: bash tests/control-tower/staging-guard-retirement.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no()  { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }

echo "=== staging_guard 退役夹具（D1225 · 替代真实 + 改坏即红）==="

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
CHECKER="$WORK/check.py"
cat > "$CHECKER" <<'PY'
# -*- coding: utf-8 -*-
"""结构性断言器: 给定仓库根，逐项判定 staging_guard 退役是否成立。

契约（铁律 47）:
  @input  argv[1] = 仓库根（相对路径按此解析）
  @output stdout 每行 `PASS|<id>|<label>` 或 `FAIL|<id>|<label>`
  @exit   0 = 全部 PASS / 2 = 存在 FAIL（判别性输出，调用方据此计红）
  @降级   任何一项读不到对象文件 → 该项 FAIL（**不静默跳过**，铁律 11）

「代码行」定义（本件唯一的语义取舍，显式写死以便复核）:
  非代码行 = ① `#` 注释行（.sh/.yml/.txt 全套；.py 用 tokenize 判 COMMENT）
             ② .py 的**文档字符串**（ast 判定 Module/ClassDef/FunctionDef 的 docstring 行段）
  理由: 注释与 docstring 里的沿革说明是**留痕**，不是残留；把它们算残留会逼人删掉沿革
        （= 制造静默历史）。而代码行（含列表元素里的路径字面量、import、env 变量）是
        真实引用面，必须零命中。
"""
import ast
import io
import re
import sys
import tokenize
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
results = []


def chk(ok: bool, cid: str, label: str) -> None:
    results.append((bool(ok), cid, label))


def read(rel: str):
    """返回 (Path, text)；文件缺失 → (path, "")（调用方据此判 FAIL，不静默）。"""
    p = ROOT / rel
    if not p.is_file():
        return p, ""
    return p, p.read_text(encoding="utf-8", errors="replace")


def _skip_lines(path: Path, text: str):
    """非代码行行号集（注释 + .py 文档字符串）。"""
    skip = set()
    for i, ln in enumerate(text.splitlines(), 1):
        if ln.strip().startswith("#"):
            skip.add(i)
    if path.suffix == ".py":
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return skip
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            body = getattr(node, "body", None)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                d = body[0]
                skip.update(range(d.lineno, (getattr(d, "end_lineno", None) or d.lineno) + 1))
        try:
            for tok in tokenize.generate_tokens(io.StringIO(text).readline):
                if tok.type == tokenize.COMMENT:
                    skip.add(tok.start[0])
        except (tokenize.TokenError, IndentationError):
            pass
    return skip


def code_lines(path: Path, text: str):
    skip = _skip_lines(path, text)
    for i, line in enumerate(text.splitlines(), 1):
        if i in skip:
            continue
        yield i, line


def ref_hits(path: Path, text: str, needle_re) -> list:
    return [(i, ln.strip()) for i, ln in code_lines(path, text) if needle_re.search(ln)]


GUARD_RE = re.compile(r"staging[_\-]guard", re.IGNORECASE)
GUARD_PATH = "scripts/control-tower/staging_guard.py"

# ── ① 退役事实: 件已不在 ──
chk(not (ROOT / GUARD_PATH).exists(), "R1", f"退役事实: {GUARD_PATH} 已删除")

# ── ① 退役事实: 生产面**代码行**零引用（注释/文档字符串不计）──
hits = []
scan_dirs = [ROOT / "scripts", ROOT / ".github"]
if not any(d.exists() for d in scan_dirs):
    hits.append((0, "<生产面目录不存在 —— 检查对象缺失>"))
else:
    for d in scan_dirs:
        if not d.exists():
            continue
        for f in sorted(d.rglob("*")):
            if not f.is_file() or f.suffix == ".pyc" or "__pycache__" in f.parts:
                continue
            try:
                txt = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                hits.append((0, f"<不可读: {f.relative_to(ROOT)}>"))
                continue
            for ln, txtln in ref_hits(f, txt, GUARD_RE):
                hits.append((ln, f"{f.relative_to(ROOT)}:{ln}: {txtln}"))
chk(not hits, "R2", "生产面代码行零引用（scripts/ + .github/；注释与文档字符串不计）")

# ── ② 替身真实: D708 对账件存在 且 在 ci.yml 被**可执行调用**（非注释/非纸面）──
gate_path = "scripts/control-tower/merge_writeset_gate.py"
gate_exists = (ROOT / gate_path).is_file()
cip, ci = read(".github/workflows/ci.yml")
ci_calls = ref_hits(cip, ci, re.compile(re.escape(gate_path)))
chk(gate_exists and bool(ci_calls), "R3",
    f"替身真实: {gate_path} 存在({'是' if gate_exists else '否'}) 且 ci.yml 可执行调用"
    f"({'%d 处' % len(ci_calls) if ci_calls else '零处'})")

# ── ③ 处置落地 a: synova-commit 走 claim 单源 + 退役结论在**代码行**恒打印（禁静默空白）──
scp, sc = read("scripts/control-tower/synova-commit")
has_claim = bool(ref_hits(scp, sc, re.compile(re.escape("claim_store.py"))))
notice = [(i, ln) for i, ln in code_lines(scp, sc) if "D1225" in ln and "退役" in ln]
old_call = ref_hits(scp, sc, re.compile(r"--staged\s+\$STAGED_LIST"))
chk(bool(sc) and has_claim and bool(notice) and not old_call, "R4",
    "消费点 synova-commit: claim_store 单源读取 + 退役结论恒打印（代码行） + 旧调用形态零残留")

# ── ③ 处置落地 b: self-health 组件清单已摘（否则健康度恒定 degraded）──
shp, sh = read("scripts/control-tower/self-health.py")
m = re.search(r"CORE_COMPONENTS\s*=\s*\[(.*?)\]", sh, re.S)
block = m.group(1) if m else None
items = [x for x in re.findall(r'"([^"]+)"', block or "") if x.strip()]
chk(block is not None and bool(items) and not GUARD_RE.search(block or ""), "R5",
    f"消费点 self-health CORE_COMPONENTS: 已摘除且清单非空（{len(items)} 项）")

# ── ③ 处置落地 c: incident-loop R1 工具表换为真承担者 ──
ilp, il = read("scripts/control-tower/incident-loop.py")
r1 = ""
for _i, _ln in code_lines(ilp, il):
    if re.match(r'^\s*"R1":\s*\{', _ln):
        r1 = _ln
        break
chk(bool(r1) and "merge_writeset_gate.py" in r1 and not GUARD_RE.search(r1), "R6",
    "消费点 incident-loop R1 工具表: 指向 merge_writeset_gate.py（旧件零残留）")

# ── ③ 处置落地 d: 密封面隔离台账无已删件残留（棘轮过期条目 = 门禁违规）──
lp, led = read("scripts/control-tower/gate-integrity-baseline.txt")
stale = [ln.strip() for ln in led.splitlines()
         if ln.strip() and not ln.strip().startswith("#") and GUARD_RE.search(ln)]
chk(bool(led) and not stale, "R7",
    "隔离台账 gate-integrity-baseline.txt: 无已删件残留条目（棘轮不悬空）")

for okflag, cid, label in results:
    print(("PASS|" if okflag else "FAIL|") + cid + "|" + label)
sys.exit(2 if any(not r[0] for r in results) else 0)
PY

# ── 断言器驱动器: 跑一个 root，回显逐项结果并返回「FAIL 项 id 串」──
run_root() {  # $1 = root；stdout = 结果行；返回码 = 断言器返回码
  "$PYBIN" "$CHECKER" "$1" 2>&1
}
fail_ids() {  # $1 = 断言器输出；stdout = FAIL 项 id（空格分隔）
  printf '%s\n' "$1" | awk -F'|' '$1=="FAIL"{printf "%s ", $2}'
}

# ══════════════════════════════════════════════════════════════════════════════
# 正常路径: 真实仓库 —— 6 项结构性断言全过
# ══════════════════════════════════════════════════════════════════════════════
OUT_REAL="$(run_root "$REPO")"; RC_REAL=$?
while IFS='|' read -r kind cid label; do
  case "$kind" in
    PASS) ok "真实仓库 [$cid] $label" ;;
    FAIL) no "真实仓库 [$cid] $label" ;;
  esac
done <<< "$OUT_REAL"
if [ "$RC_REAL" -eq 0 ]; then
  ok "真实仓库: 断言器 rc=0（全过）"
elif [ "$RC_REAL" -eq 2 ]; then
  no "真实仓库: 断言器报告 FAIL（见上方 ❌）"
else
  no "真实仓库: 断言器异常退出 rc=$RC_REAL（检查自身失败）"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 变异体（判别性: 改坏即红）——沙箱构造 + 对照组
# ══════════════════════════════════════════════════════════════════════════════
SB_COPY=(
  "scripts/control-tower/synova-commit"
  "scripts/control-tower/self-health.py"
  "scripts/control-tower/incident-loop.py"
  "scripts/control-tower/merge_writeset_gate.py"
  "scripts/control-tower/gate-integrity-baseline.txt"
  ".github/workflows/ci.yml"
)
new_sandbox() {  # 建一个与真实仓库同构的**最小**沙箱（只含断言器会读的文件）
  local sb="$1"
  local rel
  for rel in "${SB_COPY[@]}"; do
    mkdir -p "$sb/$(dirname "$rel")"
    cp "$REPO/$rel" "$sb/$rel" 2>/dev/null || true
  done
}

# ── 对照组: 未变异沙箱 ⇒ 6 项必须全过（证明后续翻转来自变异本身，而非沙箱失真）──
SB0="$WORK/sb0"; new_sandbox "$SB0"
OUT0="$(run_root "$SB0")"; RC0=$?
if [ "$RC0" -eq 0 ] && [ -z "$(fail_ids "$OUT0")" ]; then
  ok "对照组（未变异沙箱）: 7 项全过 ⇒ 变异体翻转可归因"
else
  no "对照组（未变异沙箱）应全过, 实际 rc=$RC0, FAIL=[$(fail_ids "$OUT0")]"
fi

# ── 变异体驱动器: 建沙箱 → 施变异 → 断言「预期项必为 FAIL」且整体 rc≠0 ──
expect_mut() {  # $1 = 变异体名  $2 = 预期 FAIL 的项 id集合(空格分隔)
  local name="$1" want="$2" sb="$WORK/sb-$3"
  local out rc got
  out="$(run_root "$sb")"; rc=$?
  got="$(fail_ids "$out")"
  local miss="" cid
  for cid in $want; do
    case " $got " in *" $cid "*) : ;; *) miss="$miss $cid" ;; esac
  done
  if [ -z "$miss" ] && [ "$rc" -ne 0 ]; then
    ok "变异体 $name: 预期项必红 [$(echo "$want" | tr ' ' ',')] —— 实红 [$got]"
  else
    no "变异体 $name: 判别力失效（缺红:$miss / rc=$rc / 实红 [$got]）"
  fi
}

# M1: 替身调用被注释 ⇒ R3 必红（"看似有替身"不再放行）
new_sandbox "$WORK/sb-M1"
"$PYBIN" - "$WORK/sb-M1" <<'PY'
import sys, re
from pathlib import Path
p = Path(sys.argv[1]) / ".github/workflows/ci.yml"
t = p.read_text(encoding="utf-8")
n = t.count("python3 scripts/control-tower/merge_writeset_gate.py")
t = t.replace("python3 scripts/control-tower/merge_writeset_gate.py",
              "# python3 scripts/control-tower/merge_writeset_gate.py")
p.write_text(t, encoding="utf-8")
print(f"M1 注入: 注释掉 {n} 处替身调用", file=sys.stderr)
PY
expect_mut "M1 替身调用被注释" "R3" "M1"

# M2: 退役结论字面量被删 ⇒ R4 必红（禁静默空白失守）
new_sandbox "$WORK/sb-M2"
"$PYBIN" - "$WORK/sb-M2" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1]) / "scripts/control-tower/synova-commit"
t = p.read_text(encoding="utf-8")
p.write_text(t.replace("已退役（D1225）", "已退役"), encoding="utf-8")
PY
expect_mut "M2 退役结论字面量被删" "R4" "M2"

# M3: self-health 清单回填 ⇒ R5 必红（否则健康度恒定 degraded = 静默空白）
new_sandbox "$WORK/sb-M3"
"$PYBIN" - "$WORK/sb-M3" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1]) / "scripts/control-tower/self-health.py"
t = p.read_text(encoding="utf-8")
t = t.replace('    "scripts/control-tower/wait_manager.py",',
              '    "scripts/control-tower/staging_guard.py",\n    "scripts/control-tower/wait_manager.py",', 1)
p.write_text(t, encoding="utf-8")
PY
expect_mut "M3 self-health 清单回填" "R5 R2" "M3"

# M4: 退役件被复活（空壳占位）⇒ R1 必红
new_sandbox "$WORK/sb-M4"
mkdir -p "$WORK/sb-M4/scripts/control-tower"
printf '# -*- coding: utf-8 -*-\n"""复活占位（变异注入）"""\n' > "$WORK/sb-M4/scripts/control-tower/staging_guard.py"
expect_mut "M4 退役件被复活" "R1" "M4"

# M5: incident-loop R1 工具表回退 ⇒ R6 必红
new_sandbox "$WORK/sb-M5"
"$PYBIN" - "$WORK/sb-M5" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1]) / "scripts/control-tower/incident-loop.py"
t = p.read_text(encoding="utf-8")
t = t.replace('"tools": ["verify-parallel.sh", "merge_writeset_gate.py", "wait_manager.py"]',
              '"tools": ["verify-parallel.sh", "staging_guard.py", "wait_manager.py"]', 1)
p.write_text(t, encoding="utf-8")
PY
expect_mut "M5 R1 工具表回退" "R6 R2" "M5"

# M6: 代码行引用被回注（复活一个调用变量）⇒ R2 必红（证明 R2 不是纸老虎）
new_sandbox "$WORK/sb-M6"
"$PYBIN" - "$WORK/sb-M6" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1]) / "scripts/control-tower/synova-commit"
t = p.read_text(encoding="utf-8")
anchor = "STAGED_LIST=$(git -c core.quotepath=false diff --cached --name-only 2>/dev/null || true)"
inj = 'STAGING_GUARD="$PROJECT_ROOT/scripts/control-tower/staging_guard.py"\n' + anchor
assert anchor in t
p.write_text(t.replace(anchor, inj, 1), encoding="utf-8")
PY
expect_mut "M6 代码行引用回注" "R2" "M6"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
