#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# shared_file_decl.test.sh — D979 FIX-011 共享声明解析器测试（载体/判定/读取顺序/降级）
#
# 被测: scripts/control-tower/shared_file_decl.py（纯解析 + 逐文件双向校验 CLI）
#
# 覆盖（铁律 48：正常/降级/边界）:
#   1. 文本载体 .sh                : `# 共享声明: D582, D979` → 允许
#   2. 文本载体 全角冒号/全角逗号   : `# 共享声明：D582，D979` → 允许
#   3. 文本载体 小写                : `# 共享声明: d582, d979` → 允许（归一化大写）
#   4. 文本载体 尾随散落 D#         : 列表之后的 `D123` 不计入 SHARED(F)（防误扩）
#   5. json 结构化                 : {"shared_with": ["D582","D979"]} → 允许
#   6. yml flow 数组（裸）          : shared_with: [D582, D979] → 允许
#   7. yml flow 数组（引号+中文键） : 共享声明: ["D582", "D979"] → 允许
#   8. 未声明（降级路径）           : 无声明 → 拒绝（fail-closed，不静默放行）
#   9. 双向强制                    : 仅声明自己（只有 D979）→ 拒绝（单独加自己不放行）
#  10. 逐文件强制                  : 两文件其一未声明 → 拒绝（M 中每个 F 都要命中）
#  11. 载体范围限定                : .py 内的文本行不认 → 拒绝（规格 ⒝(a) 扩展名白名单）
#  12. 读取顺序 index 优先①        : 暂存版含声明 + 工作区版删掉 → 允许（读 index）
#  13. 读取顺序 index 优先②        : 暂存版无声明 + 工作区版有 → 拒绝（不回退越过 index）
#  14. 读取顺序 worktree 回退      : 文件未入 index（工作区）→ 允许 + SOURCE=worktree
#  15. 读取顺序 HEAD 回退          : 文件仅存于 HEAD → 允许 + SOURCE=HEAD
#  16. 三处皆不可读               : SOURCE=missing + 拒绝
#  17. 调用错误（三态）            : 空文件列表 / 非法 D# → exit 2（调用方不得据此放行）
#  18. 纯函数降级                 : 非法 JSON / 未知扩展名 → 空集（不抛异常）
#
# 隔离: 每个用例独立 mktemp -d + git init（读取顺序依赖真实 index/HEAD/工作区）
# 用法: bash tests/control-tower/shared_file_decl.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PARSER="$REPO_DIR/scripts/control-tower/shared_file_decl.py"

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_exit() { # <want> <got> <msg>
  if [ "$1" = "$2" ]; then pass "$3 (exit=$2)"; else fail "$3 — 期望 exit=$1 实际=$2"; fi
}
assert_contains() { # <haystack> <needle> <msg>
  if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi
}
assert_not_contains() { # <haystack> <needle> <msg>
  if echo "$1" | grep -qF "$2"; then fail "$3 — 不应包含: $2"; else pass "$3"; fi
}

# 每个用例独立临时 repo（读取顺序用例需要真实 index/HEAD/工作区）
new_repo() {
  local r; r=$(mktemp -d /tmp/gtb-sfd-XXXXXX)
  git -C "$r" init -q -b main
  git -C "$r" config user.email test@synova.local
  git -C "$r" config user.name "Test Runner"
  echo "$r"
}

# 运行解析器（--files-from - 与生产接线同口径；文件列表经 stdin）
run_parser() { # <repo> <msg_did> <claim_did> <files-block>  → 设置 OUT / EC
  local repo="$1" msg="$2" claim="$3" files="$4"
  set +e
  OUT=$(printf '%s\n' "$files" | python3 "$PARSER" \
    --msg-did "$msg" --claim-did "$claim" --root "$repo" --files-from - 2>&1)
  EC=$?
  set -e
}

python3 -c "p='$PARSER'; compile(open(p, encoding='utf-8').read(), p, 'exec')" 2>/dev/null \
  && pass "python 语法编译通过" || fail "python 语法编译失败"

echo "═══════════════════════════════════════════════════════════"
echo "  D979 共享声明解析器 — 测试"
echo "  SUT: $PARSER"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ─── 1. 文本载体 .sh ───
echo "── 1. 文本载体 .sh: '# 共享声明: D582, D979' → 允许 ──"
R1=$(new_repo); mkdir -p "$R1/scripts"
printf '#!/bin/bash\n# 共享声明: D582, D979\necho hi\n' > "$R1/scripts/gov.sh"
git -C "$R1" add scripts/gov.sh
run_parser "$R1" D979 D582 "scripts/gov.sh"
assert_exit 0 "$EC" "文本载体允许"
assert_contains "$OUT" "DECL_ALLOW" "输出 DECL_ALLOW"
assert_contains "$OUT" "SOURCE=index" "来源 = 暂存 index（读取顺序首位）"
assert_contains "$OUT" "# 共享声明: D582, D979" "证据含声明原文"
rm -rf "$R1"; echo ""

# ─── 2. 全角冒号 + 全角逗号 ───
echo "── 2. 文本载体 全角冒号/逗号: '共享声明：D582，D979' → 允许 ──"
R2=$(new_repo); mkdir -p "$R2/scripts"
printf '#!/bin/bash\n# 共享声明：D582，D979\necho hi\n' > "$R2/scripts/gov.sh"
git -C "$R2" add scripts/gov.sh
run_parser "$R2" D979 D582 "scripts/gov.sh"
assert_exit 0 "$EC" "全角标点允许"
rm -rf "$R2"; echo ""

# ─── 3. 小写归一 ───
echo "── 3. 文本载体 小写: '# 共享声明: d582, d979' → 允许（归一化）──"
R3=$(new_repo); mkdir -p "$R3/scripts"
printf '#!/bin/bash\n# 共享声明: d582, d979\necho hi\n' > "$R3/scripts/gov.sh"
git -C "$R3" add scripts/gov.sh
run_parser "$R3" d979 d582 "scripts/gov.sh"
assert_exit 0 "$EC" "小写声明 + 小写 D# 入参允许"
assert_contains "$OUT" "MSG_DID=D979 CLAIM_DID=D582" "D# 归一化为大写"
rm -rf "$R3"; echo ""

# ─── 4. 尾随散落 D# 不计入 ───
echo "── 4. 边界: 列表后的散落 D# 不计入 SHARED(F) ──"
R4=$(new_repo); mkdir -p "$R4/scripts"
printf '#!/bin/bash\n# 共享声明: D582, D979 — 详见 D123 的改动\n' > "$R4/scripts/gov.sh"
git -C "$R4" add scripts/gov.sh
run_parser "$R4" D979 D582 "scripts/gov.sh"
assert_exit 0 "$EC" "列表内双方命中允许"
assert_contains "$OUT" "HIT=D582,D979" "HIT 仅含列表内 D#"
# 证据行按规格须含声明原文（原文里出现 D123 属正常）——故用纯函数断言解析集合本身
set +e
PURE4=$(python3 -c "
import sys
sys.path.insert(0, '$REPO_DIR/scripts/control-tower')
from shared_file_decl import parse_shared_decl
ids, _ev = parse_shared_decl(open('$R4/scripts/gov.sh', encoding='utf-8').read(), 'scripts/gov.sh')
print(sorted(ids))
" 2>&1); PURE4_EC=$?
set -e
assert_exit 0 "$PURE4_EC" "纯函数读取成功"
assert_contains "$PURE4" "['D582', 'D979']" "SHARED(F) 仅含列表内 D#（尾随 D123 不计入）"
rm -rf "$R4"; echo ""

# ─── 5. json 结构化 ───
echo "── 5. json 结构化: {\"shared_with\": [\"D582\",\"D979\"]} → 允许 ──"
R5=$(new_repo); mkdir -p "$R5/task-state"
printf '{\n  "task_id": "D954",\n  "shared_with": ["D582", "D979"]\n}\n' > "$R5/task-state/D954.json"
git -C "$R5" add task-state/D954.json
run_parser "$R5" D979 D582 "task-state/D954.json"
assert_exit 0 "$EC" "json 结构化允许"
assert_contains "$OUT" 'shared_with' "证据含结构化键"
rm -rf "$R5"; echo ""

# ─── 6. yml flow（裸）───
echo "── 6. yml flow（裸）: shared_with: [D582, D979] → 允许 ──"
R6=$(new_repo); mkdir -p "$R6/.github/workflows"
printf 'name: ci\nshared_with: [D582, D979]\non: push\n' > "$R6/.github/workflows/ci.yml"
git -C "$R6" add .github/workflows/ci.yml
run_parser "$R6" D979 D582 ".github/workflows/ci.yml"
assert_exit 0 "$EC" "yml flow 裸数组允许"
rm -rf "$R6"; echo ""

# ─── 7. yml flow（引号 + 中文键）───
echo "── 7. yml flow（引号 + 中文键）: 共享声明: [\"D582\", \"D979\"] → 允许 ──"
R7=$(new_repo); mkdir -p "$R7/scripts"
printf '共享声明: ["D582", "D979"]\nfoo: bar\n' > "$R7/scripts/gov.yml"
git -C "$R7" add scripts/gov.yml
run_parser "$R7" D979 D582 "scripts/gov.yml"
assert_exit 0 "$EC" "yml flow 引号数组允许"
rm -rf "$R7"; echo ""

# ─── 8. 未声明（降级路径）───
echo "── 8. 降级: 无声明 → 拒绝（fail-closed）──"
R8=$(new_repo); mkdir -p "$R8/scripts"
printf '#!/bin/bash\necho hi\n' > "$R8/scripts/gov.sh"
git -C "$R8" add scripts/gov.sh
run_parser "$R8" D979 D582 "scripts/gov.sh"
assert_exit 1 "$EC" "无声明拒绝"
assert_contains "$OUT" "DECL_DENY" "输出 DECL_DENY"
assert_contains "$OUT" "MISSING=D582,D979" "原因行列出缺双方 D#"
rm -rf "$R8"; echo ""

# ─── 9. 双向强制 ───
echo "── 9. 双向强制: 仅声明自己（只有 D979）→ 拒绝 ──"
R9=$(new_repo); mkdir -p "$R9/scripts"
printf '#!/bin/bash\n# 共享声明: D979\n' > "$R9/scripts/gov.sh"
git -C "$R9" add scripts/gov.sh
run_parser "$R9" D979 D582 "scripts/gov.sh"
assert_exit 1 "$EC" "单独把自己加进声明不放行"
assert_contains "$OUT" "MISSING=D582" "缺 CLAIM_DID=D582"
rm -rf "$R9"; echo ""

# ─── 10. 逐文件强制 ───
echo "── 10. 逐文件强制: 两文件其一未声明 → 拒绝 ──"
R10=$(new_repo); mkdir -p "$R10/scripts"
printf '#!/bin/bash\n# 共享声明: D582, D979\n' > "$R10/scripts/a.sh"
printf '#!/bin/bash\n# 普通文件（无声明）\n' > "$R10/scripts/b.sh"
git -C "$R10" add scripts/a.sh scripts/b.sh
run_parser "$R10" D979 D582 "scripts/a.sh
scripts/b.sh"
assert_exit 1 "$EC" "M 中每个 F 都要命中"
assert_contains "$OUT" "FILE=scripts/b.sh" "原因行点名未声明文件"
assert_contains "$OUT" "FILES=2" "校验文件数 = M 大小"
rm -rf "$R10"; echo ""

# ─── 11. 载体范围限定 ───
echo "── 11. 边界: .py 内的文本声明行不认（规格 ⒝ 扩展名白名单）→ 拒绝 ──"
R11=$(new_repo); mkdir -p "$R11/scripts"
printf '# 共享声明: D582, D979\nprint(1)\n' > "$R11/scripts/gov.py"
git -C "$R11" add scripts/gov.py
run_parser "$R11" D979 D582 "scripts/gov.py"
assert_exit 1 "$EC" "非白名单扩展名不认声明"
rm -rf "$R11"; echo ""

# ─── 12. 读取顺序 index 优先① ───
echo "── 12. 读取顺序: 暂存版含声明 + 工作区版删掉 → 允许（读 index）──"
R12=$(new_repo); mkdir -p "$R12/scripts"
printf '#!/bin/bash\n# 共享声明: D582, D979\n' > "$R12/scripts/gov.sh"
git -C "$R12" add scripts/gov.sh
printf '#!/bin/bash\n# 工作区已删声明（未重新 add）\n' > "$R12/scripts/gov.sh"
run_parser "$R12" D979 D582 "scripts/gov.sh"
assert_exit 0 "$EC" "index 版本优先（提交内容 = index 内容）"
assert_contains "$OUT" "SOURCE=index" "来源标注 index"
rm -rf "$R12"; echo ""

# ─── 13. 读取顺序 index 优先② ───
echo "── 13. 读取顺序: 暂存版无声明 + 工作区版有 → 拒绝（不越过 index 下探）──"
R13=$(new_repo); mkdir -p "$R13/scripts"
printf '#!/bin/bash\n# 尚无声明\n' > "$R13/scripts/gov.sh"
git -C "$R13" add scripts/gov.sh
printf '#!/bin/bash\n# 共享声明: D582, D979\n' > "$R13/scripts/gov.sh"
run_parser "$R13" D979 D582 "scripts/gov.sh"
assert_exit 1 "$EC" "index 命中即定案（工作区未暂存声明不放行）"
rm -rf "$R13"; echo ""

# ─── 14. worktree 回退 ───
echo "── 14. 读取顺序: 文件未入 index（仅工作区）→ 允许 + SOURCE=worktree ──"
R14=$(new_repo); mkdir -p "$R14/scripts"
printf '#!/bin/bash\n# 共享声明: D582, D979\n' > "$R14/scripts/new.sh"
run_parser "$R14" D979 D582 "scripts/new.sh"
assert_exit 0 "$EC" "工作区回退允许"
assert_contains "$OUT" "SOURCE=worktree" "来源标注 worktree"
rm -rf "$R14"; echo ""

# ─── 15. HEAD 回退 ───
echo "── 15. 读取顺序: 文件仅存于 HEAD → 允许 + SOURCE=HEAD ──"
R15=$(new_repo); mkdir -p "$R15/scripts"
printf '#!/bin/bash\n# 共享声明: D582, D979\n' > "$R15/scripts/gov.sh"
git -C "$R15" add scripts/gov.sh
git -C "$R15" commit -q -m "init"
# 三处判定：index 无该项 + 工作区无该文件 + HEAD 有 → 唯 HEAD 可读
git -C "$R15" rm -q --cached scripts/gov.sh
rm "$R15/scripts/gov.sh"
run_parser "$R15" D979 D582 "scripts/gov.sh"
assert_exit 0 "$EC" "HEAD 回退允许"
assert_contains "$OUT" "SOURCE=HEAD" "来源标注 HEAD"
rm -rf "$R15"; echo ""

# ─── 16. 三处皆不可读 ───
echo "── 16. 降级: 三处皆不可读 → SOURCE=missing + 拒绝 ──"
R16=$(new_repo)
run_parser "$R16" D979 D582 "scripts/ghost.sh"
assert_exit 1 "$EC" "不可读 → 按未声明处理（拒绝）"
assert_contains "$OUT" "SOURCE=missing" "来源标注 missing"
rm -rf "$R16"; echo ""

# ─── 17. 调用错误（三态 exit 2）───
echo "── 17. 三态: 空文件列表 / 非法 D# → exit 2 ──"
R17=$(new_repo)
run_parser "$R17" D979 D582 ""
assert_exit 2 "$EC" "空文件列表 = 调用错误"
run_parser "$R17" "not-a-did" D582 "scripts/gov.sh"
assert_exit 2 "$EC" "非法 --msg-did = 调用错误"
set +e
OUT=$(python3 "$PARSER" --msg-did D979 --claim-did D582 --root "$R17" 2>&1); EC=$?
set -e
assert_exit 2 "$EC" "缺 --files-from = 调用错误"
rm -rf "$R17"; echo ""

# ─── 18. 纯函数降级 ───
echo "── 18. 纯函数: 非法 JSON / 未声明扩展名 → 空集（不抛异常）──"
set +e
PURE_OUT=$(python3 -c "
import sys
sys.path.insert(0, '$REPO_DIR/scripts/control-tower')
from shared_file_decl import parse_shared_decl
print(parse_shared_decl('{bad json', 'x.json')[0])
print(parse_shared_decl('# 共享声明: D582, D979', 'x.md')[0] == {'D582', 'D979'})
" 2>&1); PURE_EC=$?
set -e
assert_exit 0 "$PURE_EC" "纯函数调用不抛异常"
assert_contains "$PURE_OUT" "set()" "非法 JSON → 空集"
assert_contains "$PURE_OUT" "True" "文本载体解析命中双方"
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过 / $FAIL 失败"
echo "═══════════════════════════════════════════════════════════"
[ "$FAIL" = "0" ] || exit 1
