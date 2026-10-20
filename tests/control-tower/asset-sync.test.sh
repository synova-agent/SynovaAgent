#!/usr/bin/env bash
# asset-sync.test.sh —— #776 判据断言（dev doc §4 判据 1/2/5/8c/8d＋幂等＋段外保护）
# 三态退出码：0 全绿｜1 断言失败（真红）｜2 环境失败。WIRE CHECK：grep 零结果=未接线=红。
set -u
export PYTHONIOENCODING=utf-8 LC_ALL=C.UTF-8 2>/dev/null || true
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY=python3
SYNC="$ROOT/scripts/control-tower/asset-sync.py"
MAP="$ROOT/docs/authority/ASSET-MAP.yaml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

t() { # t <名称> <期望码> <实际码>
  if [ "$2" = "$3" ]; then echo "PASS $1 (exit=$3)"; else echo "FAIL $1 期望 exit=$2 实际=$3"; fail=1; fi
}

# ── 判据 5：dry-run 不写（无 token 文件环境也必须能跑 ⇒ 证明未联网未写）──
out=$("$PY" "$SYNC" --dry-run --map "$MAP" --prev HEAD^ --new HEAD 2>&1); rc=$?
t "dry-run 成功" 0 $rc
echo "$out" | grep -q "^SUMMARY mapped=" || { echo "FAIL 无 SUMMARY 行"; fail=1; }
echo "$out" | grep -q "DRY-RUN: 未联网" || { echo "FAIL dry-run 无声明行"; fail=1; }

# ── 判据 1：恒等式（解析 SUMMARY，独立用 ls-tree 复算 total）──
sum=$(echo "$out" | grep "^SUMMARY")
m=$(echo "$sum" | sed -E 's/.*mapped=([0-9]+).*/\1/')
u=$(echo "$sum" | sed -E 's/.*unknown=([0-9]+).*/\1/')
x=$(echo "$sum" | sed -E 's/.*x=([0-9]+).*/\1/')
tt=$(echo "$sum" | sed -E 's/.*total=([0-9]+).*/\1/')
real=$(git -C "$ROOT" ls-tree -r HEAD | wc -l | tr -d ' ')
if [ "$tt" != "$real" ]; then echo "FAIL SUMMARY total($tt) != ls-tree($real)"; fail=1
else echo "PASS SUMMARY total == ls-tree ($real)"; fi
if [ $((m+u+x)) != "$tt" ]; then echo "FAIL 恒等式 $m+$u+$x != $tt"; fail=1
else echo "PASS 恒等式 mapped+unknown+x == total"; fi

# ── 判据 2 / 反例 8d：catch-all 必红 ──
sed 's|^match: first|match: first\n  - glob: "**"\n    module: X\n    owner: P6\n    state: 其他|' "$MAP" > "$TMP/map-catchall.yaml"
"$PY" "$SYNC" --dry-run --map "$TMP/map-catchall.yaml" >"$TMP/out-d" 2>&1
t "反例8d catch-all ⇒ exit 1" 1 $?
grep -q "catch-all" "$TMP/out-d" || { echo "FAIL 8d 无具体失败点"; fail=1; }

# ── 反例 8c：total 造假（用 MAP 条目数）必红 ──
n_entries=$(grep -c '^  - glob:' "$MAP")
sed "s|total = len(files)|total = $n_entries|" "$SYNC" > "$TMP/sync-mutant.py"
out_c=$("$PY" "$TMP/sync-mutant.py" --dry-run --map "$MAP" 2>&1); rc=$?
t "反例8c total 造假 ⇒ 恒等式断言 exit 1" 1 $rc
echo "$out_c" | grep -q "恒等式不成立" || { echo "FAIL 8c 无失败点输出"; fail=1; }

# ── 幂等＋段外逐字节保护（replace_segment 纯函数，本地断言不联网）──
"$PY" - "$SYNC" <<'PYEOF' || fail=1
import importlib.util, hashlib, sys
spec = importlib.util.spec_from_file_location("as_", sys.argv[1])
as_ = importlib.util.module_from_spec(spec); spec.loader.exec_module(as_)
desc = "人工段A\n\n" + as_.BEGIN + "\n旧内容\n" + as_.END + "\n人工段B"
n1, e1 = as_.replace_segment(desc, "新内容 v1")
n2, e2 = as_.replace_segment(n1, "新内容 v1")   # 幂等：同内容两跑
n3, _ = as_.replace_segment(n1, "新内容 v2")    # 更新内容
ok = True
if e1 or e2: print("FAIL replace_segment 报错", e1, e2); ok = False
if n1 != n2: print("FAIL 幂等：两次结果不同"); ok = False
if hashlib.sha256(n1.encode()).hexdigest() == hashlib.sha256(desc.encode()).hexdigest():
    print("FAIL 段内未变化（假幂等）"); ok = False
for label, got in (("v1", n1), ("v3", n3)):
    pre, post = got.split(as_.BEGIN)[0], got.split(as_.END)[1]
    if pre + post != desc.split(as_.BEGIN)[0] + desc.split(as_.END)[1]:
        print(f"FAIL {label} 段外被改"); ok = False
no, eno = as_.replace_segment("无标记描述", "x")
if eno != "no-marker" or no is not None: print("FAIL 无标记未拒写"); ok = False
print("PASS 幂等 sha256 稳定＋段外逐字节不变＋无标记拒写" if ok else "FAIL 段保护")
sys.exit(0 if ok else 1)
PYEOF

# ── 信号量自检：MAP 为空 ⇒ exit 2 ──
printf 'match: first\nentries:\n' > "$TMP/map-empty.yaml"
"$PY" "$SYNC" --dry-run --map "$TMP/map-empty.yaml" >/dev/null 2>&1
t "空 MAP ⇒ exit 2（禁把看不见当没问题）" 2 $?

# ── WIRE CHECK：脚本被本测试接线（零结果=未接线）──
grep -q "asset-sync.py" "$0" || { echo "FAIL wire check"; fail=1; }

if [ $fail -eq 0 ]; then echo "ALL PASS"; exit 0; else echo "HAS FAILURES"; exit 1; fi
