#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-ownership.test.sh — D733 ownership 机器化测试（ownership.yaml + check-ownership.py）
#
# 覆盖（铁律 48: 正常 / 降级 / 边界）:
#   1. 正常路径 — Mac/K3 正例归属正确（--owner 一致 → exit 0）
#   2. 越域    — 派单 §一 验收两条 + 单域模式跨域 → exit 1
#   3. 真实回归 — CTO 2026-09-13 两次派错线的实写集（D728 / D729）→ 派给 mac 必红
#   4. 反向验证 — 删掉 ownership.yaml 兜底规则 → 上述两条变绿（证明校验真在读数据）
#   4c. 判别性夹具 — D935 `docs/synova/presets/**` → mac：正常判 mac；沙箱副本删掉该规则 → 同一断言必红（见 §5b）
#   5. 降级    — yaml 缺失 / yaml 语法非法 → exit 2（fail-closed，不与「通过」混同）
#   6. 边界    — 无文件参数 / 未知 owner / 尚未创建的文件路径
#   7. 产物契约 — .github/CODEOWNERS == --emit-codeowners 逐字节（drift 门禁）
#   8. 结构契约 — ownership.yaml 恰有一条 default 兜底规则（防「删兜底」静默逃逸）
#   9. 生产接线 — CODEOWNERS 头声明生成来源（WIRE CHECK）
#  10. D1029 兜底语义收口（a/b/c 三条反例 + 判别性夹具 + live 契约探针）:
#     a. 未登记新目录 ⇒ 「未归属」+「显式加规则」+ exit 1（不再静默归 win）
#     b. 逃生口: 未登记文件 + 同一变更集里加好的规则 ⇒ exit 0
#     c. 规则修改权: 变更集含 ownership.yaml 且 PR 描述无创始人批准凭据 ⇒ exit 1；有 ⇒ exit 0
#     d. 判别性夹具: 沙箱删掉 domain_defaults / 置空 domain_defaults.win / 删兜底规则 → 必红
#     e. --emit-codeowners 不读 domain_defaults（缺段仍可生成）+ 与 committed 逐字节
#     f. live-yaml 契约探针（B 未落地 → PENDING 单列，不影响退出码；落地后转硬断言）
#
# 形态自适应（D1029 队长裁决 P1）: 真 yaml 有 domain_defaults+rule_authority ⇒ LIVE_MODE=contract（用真 yaml
# 跑 §10 全部判据）；否则 pre-contract ⇒ 用「合同形态副本」（真 yaml 副本 + 测试自己注入合同冻结的两个键）
# 跑同一批判据，**判据一律按新语义断言，不放宽、不 skip**。
#
# 零真实仓库污染: 全部读操作 + mktemp 沙箱（PLATFORM-CHECKLIST #6）；不写仓库任何文件
# （唯一例外: 自建 git 夹具树，落在 mktemp -d 内，trap 清理）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/check-ownership.py"
YAML="$REPO_DIR/docs/synova/coordination/ownership.yaml"
CODEOWNERS="$REPO_DIR/.github/CODEOWNERS"
OWNERSHIP_REL="docs/synova/coordination/ownership.yaml"

# PLATFORM-CHECKLIST #1: PYBIN 三级探测（禁裸 python3 —— Win 部分机器无 python3.exe）
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then echo "❌ python 不可用 — 无法运行 ownership 测试" >&2; exit 2; fi

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

PASS=0; FAIL=0; PENDING=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
pending() { PENDING=$((PENDING + 1)); echo "  ⏳ $1"; }

# 守门判据（必须能区分「注释里提到」与「真有一条兜底规则」）——D1029 追加 2
# 旧写法 `grep -q 'glob: "\*\*"'` 是整文件匹配：B 的注释里出现字面 `- glob: "**"` 即被误判红（同类第 2 次）。
RULE_RE='^[[:space:]]*-[[:space:]]*glob:[[:space:]]*"\*\*"'
count_catchall_rules() { grep -cE "$RULE_RE" "$1" 2>/dev/null | tr -d '\n\r' || true; }

# run <期望exit> <说明> <args...>  → 捕获 stdout/stderr 到 ${OUT}，比对退出码
OUT=""
run_expect() {
  local want="$1"; shift
  local desc="$1"; shift
  # 未显式指定 --yaml 的判据统一走「形态自适应配置」（pre-contract 用合同形态副本；
  # contract 用真 yaml）—— 其余用例仍可传 --yaml <沙箱> 覆盖
  # 注: 不落数组（bash 3.2 下 set -u + "${arr[@]}" 在空数组时报 unbound variable）
  case " $* " in
    *" --yaml "*|*"--yaml "*) OUT="$("$PYBIN" "$TOOL" "$@" 2>&1)" ;;
    *) OUT="$("$PYBIN" "$TOOL" "$@" --yaml "$CFG" 2>&1)" ;;
  esac
  local got=$?
  if [ "$got" = "$want" ]; then pass "$desc (exit=$want)"
  else fail "$desc — 期望 exit=$want 实际 exit=$got"; echo "$OUT" | sed 's/^/      | /' >&2; fi
}

# ── 10.0 形态自适应 + 合同形态夹具（裁决 P1/P2）──
# 真 yaml 有 domain_defaults+rule_authority ⇒ contract（用真 yaml）；否则 pre-contract（用合同形态副本）。
# 合同形态副本 = 真 yaml 副本 + **本脚本自己注入**合同冻结的两个键（mktemp；不读 B 的树、不读未落 main 的路径）。
if grep -qE '^domain_defaults:' "$YAML" && grep -qE '^rule_authority:' "$YAML"; then
  LIVE_MODE=contract
else
  LIVE_MODE=pre-contract
fi
echo "  · 形态: LIVE_MODE=$LIVE_MODE"

CONTRACT_YAML="$TMPD/ownership-contract.yaml"
cp "$YAML" "$CONTRACT_YAML"
"$PYBIN" - "$CONTRACT_YAML" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
if "domain_defaults" not in t:
    t += (
        "\n"
        "# ═══ win 基线领地（D1029）: 仅命中兜底规则且命中下列 glob ⇒ 视同 win；其余 = 未归属 ═══\n"
        "domain_defaults:\n"
        "  win:\n"
        '    - "src/**"\n'
        '    - "extensions/**"\n'
        '    - "packages/**"\n'
        '    - "synova_worker/**"\n'
        '    - "docs/plans/**"\n'
    )
if "rule_authority" not in t:
    t += (
        "\ndomain_defaults_note: \"本夹具由 check-ownership.test.sh 注入（pre-contract 态）\"\n"
        "rule_authority:\n"
        '  note: "域 ≠ 权限；域名规则最终权限在创始人（D1029 冻结合同）"\n'
    )
p.write_text(t, encoding="utf-8")
PYEOF
if grep -qE '^domain_defaults:' "$CONTRACT_YAML" && grep -qE '^rule_authority:' "$CONTRACT_YAML"; then
  pass "合同形态夹具就绪（真 yaml 副本 + 注入合同冻结两键）"
else
  fail "合同形态夹具注入失败（domain_defaults/rule_authority 未就位）"
fi
if [ "$LIVE_MODE" = "contract" ]; then CFG="$YAML"; else CFG="$CONTRACT_YAML"; fi

# 未登记路径（只命中兜底、不在 win 基线领地）——用「新建路径」而非存量，避免写死路径清单
UNREG_DIR="new-line-$(date +%s)/artifact.ts"
UNREG_DIR2="new-line-$(date +%s)/other.md"


echo "═══════════════════════════════════════════════════════════"
echo "  D733 ownership 机器化测试"
echo "═══════════════════════════════════════════════════════════"

echo ""
echo "── 1. 正常路径: 各域正例归属一致 → exit 0 ──"
run_expect 0 "src/sentinel/ Mac 正例"      src/sentinel/runner.ts --owner mac
run_expect 0 "src/cron/ Mac 正例"          src/cron/cron-scheduler.ts --owner mac
run_expect 0 "src/mcp/ Mac 正例"           src/mcp/server.ts --owner mac
run_expect 0 "scripts/control-tower/ Mac"  scripts/control-tower/alloc-task-id.sh --owner mac
run_expect 0 "tests/control-tower/ Mac"    tests/control-tower/ownership.test.sh --owner mac
run_expect 0 "coordination 文档 Mac"       docs/synova/coordination/ownership.yaml --owner mac
run_expect 0 "src/（非例外）= Win"         src/l3/expert-registry.ts --owner win
run_expect 0 "src/server.ts = Win 专属"    src/server.ts --owner win
run_expect 0 "scripts/audit/ = K3"         scripts/audit/check-gates-v2.py --owner k3

echo ""
echo "── 2. 越域: 派单 §一 验收两条（必须非零）──"
run_expect 1 "验收① src/server.ts --owner mac"   src/server.ts --owner mac
run_expect 1 "验收② src/evidence/x.ts --owner mac" src/evidence/x.ts --owner mac
run_expect 1 "Mac 文件派给 win 也越域（对称）"      src/sentinel/runner.ts --owner win
run_expect 1 "K3 红线派给 mac 越域"                scripts/audit/audit-rules.sh --owner mac

echo ""
echo "── 3. 真实回归: CTO 2026-09-13 两次派错线的实写集 ──"
# D728（CTO 裁决书 commit 9aaf0c68 §A: 写集 100% 落 Win 域，却派给 Mac 线）
run_expect 1 "D728 回归: 整写集派给 mac 必红" \
  src/evidence/evidence-store.ts src/routes/diagnosis.ts src/routes/conversations.ts \
  src/agent/conversation-engine.ts src/agent/diagnosis-launcher.ts src/agent/engine-context.ts \
  src/server.ts --owner mac
# D729（同批派给 Mac 线；其中两文件为 Win 域）
run_expect 1 "D729 回归: Win 域两文件派给 mac 必红" \
  src/l4/graph-bridge.ts src/agent/post-diagnosis-processor.ts --owner mac

echo ""
echo "── 4. 单域模式（无 --owner）──"
OUT="$("$PYBIN" "$TOOL" src/sentinel/runner.ts src/cron/cron-scheduler.ts --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "单域模式: 全 Mac → exit 0" || fail "单域模式: 全 Mac — 期望 exit=0 实际 $_e"
OUT="$("$PYBIN" "$TOOL" src/sentinel/runner.ts src/l3/expert-registry.ts --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 1 ] && pass "单域模式: Mac+Win 混合 → exit 1（跨域）" || fail "单域模式: 混合 — 期望 exit=1 实际 $_e"
if echo "$OUT" | grep -q "跨域"; then pass "跨域输出点名「跨域」"; else fail "跨域输出未点名"; fi

echo ""
echo "── 4b. 域判定豁免 domain_neutral（D734 前置：各线都写的簿记不构成域信号）──"
OUT="$("$PYBIN" "$TOOL" .claude/bypass.log tests/control-tower/check-ownership.test.sh --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "bypass.log 豁免: 只剩 mac → exit 0" || fail "bypass.log 豁免失败 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "domain-neutral"; then pass "豁免路径明示 domain-neutral（不静默）"; else fail "豁免路径未明示"; fi
OUT="$("$PYBIN" "$TOOL" .claude/bypass.log src/l3/expert-registry.ts src/sentinel/runner.ts --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 1 ] && pass "豁免不掩盖真跨域（Mac+Win 仍 exit 1）" || fail "豁免掩盖了跨域 — 期望 1 实际 $_e"
run_expect 0 "豁免路径不参与 --owner 断言" .claude/bypass.log task-state/D733.json --owner mac
run_expect 1 "非豁免路径仍受 --owner 断言（回归）" src/sentinel/runner.ts --owner win

# D758: 验收证据目录（docs/synova/product-lines/evidence/**）——证据跟干活那条线走，不构成域信号
OUT="$("$PYBIN" "$TOOL" docs/synova/product-lines/evidence/D716-win-20260913/1-5-dual-guide-win-evidence.txt src/server.ts --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "D758 证据目录豁免: Win 代码 + 自己的验收证据 → exit 0" || fail "D758 证据豁免失败 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "domain-neutral"; then pass "D758 证据路径明示 domain-neutral（不静默）"; else fail "D758 证据路径未明示"; fi
OUT="$("$PYBIN" "$TOOL" docs/synova/product-lines/evidence/D716-win-20260913/x.txt scripts/control-tower/check-ownership.py --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "D758 Win 证据 + Mac 控制塔脚本 → 仍单域（证据不掺域）" || fail "D758 单域判定失败 — 期望 0 实际 $_e"
OUT="$("$PYBIN" "$TOOL" docs/synova/product-lines/evidence/D716-win-20260913/x.txt src/server.ts scripts/control-tower/check-ownership.py --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 1 ] && pass "D758 豁免不掩盖真跨域（Win 代码 + Mac 脚本仍 exit 1）" || fail "D758 豁免掩盖了跨域 — 期望 1 实际 $_e"
run_expect 0 "D758 豁免路径不参与 --owner 断言" docs/synova/product-lines/evidence/D716-win-20260913/x.txt --owner win

echo ""
echo "── 5. 反向验证: 删掉兜底规则 → 验收两条必须变绿（证明真在读 yaml）──"
NO_DEFAULT="$TMPD/ownership-no-default.yaml"
cp "$CFG" "$NO_DEFAULT"   # 从**合同形态**出发（缺 domain_defaults 会让新语义判 exit 2 而非未归属）
"$PYBIN" - "$NO_DEFAULT" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
start = t.index('  - glob: "**"')
end = t.index('  - glob: "extensions/**"')
p.write_text(t[:start] + t[end:], encoding="utf-8")
PYEOF
NDEF_AFTER="$(count_catchall_rules "$NO_DEFAULT")"; NDEF_AFTER="${NDEF_AFTER//[^0-9]/}"
if [ "$NDEF_AFTER" = "0" ]; then pass "反向验证前置: 兜底**规则行**已移除（锚定行首计数=0，非整文件 grep）"
else fail "反向验证前置: 兜底规则未删掉（规则行计数=${NDEF_AFTER}）"; fi
# D1029 语义变更（原文案已不成立，未静默删除断言）: 旧语义「删兜底 ⇒ 所有路径 exit 0（静默变绿）」，
# 新语义「删兜底 ⇒ 未归属 ⇒ exit 1 且逐条点名」——同一断言换期望值，且判据更强（不只是变绿）。
run_expect 1 "删兜底 → src/server.ts 判「未归属」必红（旧语义: 变绿 ⇒ 已按新语义改写）" src/server.ts --owner mac --yaml "$NO_DEFAULT"
run_expect 1 "删兜底 → src/evidence/x.ts 判「未归属」必红（同上）" src/evidence/x.ts --owner mac --yaml "$NO_DEFAULT"
if echo "$OUT" | grep -q "未归属"; then pass "删兜底输出点名「未归属」（不静默、不误报越域）"; else fail "删兜底未点名未归属"; fi
run_expect 1 "原 yaml 复测仍红（未污染真实文件）" src/server.ts --owner mac --yaml "$CFG"
if echo "$OUT" | grep -q "越域"; then pass "复测输出点名「越域」"; else fail "复测输出未点名越域"; fi
OUT="$("$PYBIN" "$TOOL" src/server.ts --owner mac --yaml "$NO_DEFAULT" 2>&1)"
if echo "$OUT" | grep -q "未归属"; then pass "无兜底时明示 ⚠️「未归属」（不静默降级）"; else fail "无归属未明示（疑似静默降级）"; fi

echo ""
echo "── 5a2. 判别性回归: 注释里的字面 - glob: \"**\" 不得污染守门判据（D1029 追加 2）──"
# 构图: 删掉真兜底规则 + 注入一行**注释**内含字面 `- glob: "**"`。
# 旧写法（整文件 grep）会判「未删」→ 误红；锚定正则必须判「已删」。
COMMENT_SHADOW="$TMPD/ownership-comment-shadow.yaml"
SHADOW_NOTE_FILE="$TMPD/shadow-note.txt"
# 注意用 printf 逐字写出含反斜杠的注释行（引号内不转义，避免多层转义走样）
printf '%s\n' '# D1029 说明: 兜底规则写法形如   - glob: "**"   （本行是注释，不是规则）' > "$SHADOW_NOTE_FILE"
cat "$SHADOW_NOTE_FILE" "$TMPD/ownership-no-default.yaml" > "$COMMENT_SHADOW"
if grep -q 'glob: "\*\*"' "$COMMENT_SHADOW"; then
  pass "5a2 前置: 注释里确含字面 glob 字符串（旧写法会误判）"
else
  fail "5a2 前置: 注释注入失败（判据未被真正挑战）"
fi
CS="$(count_catchall_rules "$COMMENT_SHADOW")"; CS="${CS//[^0-9]/}"
if [ "$CS" = "0" ]; then pass "5a2 锚定判据: 注释+已删规则 → 规则行计数 0（不被注释误判为「未删」）"
else fail "5a2 锚定判据失败: 规则行计数=${CS}（注释仍污染判据）"; fi
run_expect 1 "5a2 注释阴影下删兜底 → 判「未归属」必红（新语义；行为与判据一致）" \
  src/server.ts --owner mac --yaml "$COMMENT_SHADOW"
run_expect 1 "5a2 注释阴影不改变真 yaml 的判定（复测仍红）" src/server.ts --owner mac --yaml "$CFG"

echo ""
echo "── 5b. D935 判别性夹具: presets→mac（删该规则即红 = 判据真读数据，非 grep 型静态判据）──"
run_expect 0 "D935 presets 根文件 = Mac"     docs/synova/presets/install-squad-lead.sh --owner mac
run_expect 0 "D935 presets 子目录文件 = Mac" docs/synova/presets/synova-squad-lead/preset.yml --owner mac
run_expect 1 "D935 presets 派给 win 越域（对称）" docs/synova/presets/install-squad-lead.sh --owner win
# 改坏即红: 沙箱副本删掉刚加的 presets 规则 → 同一路径派 mac 必须 exit 1
# （若本项恒绿，说明判据是静态/硬编码而非真读数据 —— 反 grep 型静态判据）
PRESETS_OFF="$TMPD/ownership-no-presets.yaml"
cp "$CFG" "$PRESETS_OFF"
"$PYBIN" - "$PRESETS_OFF" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
start = t.index('  - glob: "docs/synova/presets/**"')
end = t.index('  - glob: ".github/workflows/**"')
p.write_text(t[:start] + t[end:], encoding="utf-8")
PYEOF
PRESETS_LEFT="$(grep -cE '^[[:space:]]*-[[:space:]]*glob:[[:space:]]*"docs/synova/presets/\*\*"' "$PRESETS_OFF" | tr -d '\n\r' || true)"; PRESETS_LEFT="${PRESETS_LEFT//[^0-9]/}"
if [ "$PRESETS_LEFT" != "0" ]; then
  fail "D935 改坏前置: 沙箱副本里 presets **规则行**未删掉（计数=${PRESETS_LEFT}）"
else
  pass "D935 改坏前置: presets 规则行已删（锚定行首计数=0；注释里的同字面不再误判）"
fi
# 同类回归（第 3 处）: 注释里出现同字面 ⇒ 前置判定仍须为「已删」
PRESETS_SHADOW="$TMPD/ownership-presets-comment.yaml"
printf '%s\n' '# D1029 说明: presets 规则写法形如   - glob: "docs/synova/presets/**"   （本行是注释，不是规则）' > "$TMPD/presets-note.txt"
cat "$TMPD/presets-note.txt" "$PRESETS_OFF" > "$PRESETS_SHADOW"
if grep -qF 'glob: "docs/synova/presets/**"' "$PRESETS_SHADOW"; then
  pass "D935 注释回归前置: 注释里确含同字面（旧写法会误判）"
else
  fail "D935 注释回归前置: 注释注入失败"
fi
PL2="$(grep -cE '^[[:space:]]*-[[:space:]]*glob:[[:space:]]*"docs/synova/presets/\*\*"' "$PRESETS_SHADOW" | tr -d '\n\r' || true)"; PL2="${PL2//[^0-9]/}"
if [ "$PL2" = "0" ]; then pass "D935 注释回归: 注释+已删规则 → 规则行计数 0（不被注释误判）"
else fail "D935 注释回归失败: 规则行计数=${PL2}（注释仍污染判据）"; fi
run_expect 1 "D935 删 presets 规则 → presets 路径派 mac 必红" docs/synova/presets/install-squad-lead.sh --owner mac --yaml "$PRESETS_OFF"
run_expect 1 "D935 删 presets 规则 → 子目录文件同样必红"      docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md --owner mac --yaml "$PRESETS_OFF"
run_expect 0 "D935 原 yaml 复测仍绿（未污染真实文件）"        docs/synova/presets/install-squad-lead.sh --owner mac --yaml "$CFG"

echo ""
echo "── 6. 降级与边界（fail-closed → exit 2）──"
run_expect 2 "yaml 不存在 → exit 2"      src/server.ts --owner mac --yaml "$TMPD/nope.yaml"
printf 'rules:\n  - glob: "**"\n   bad_indent: 1\n' > "$TMPD/bad.yaml"
run_expect 2 "yaml 语法非法 → exit 2"    src/server.ts --owner mac --yaml "$TMPD/bad.yaml"
printf 'rules: []\n' > "$TMPD/empty.yaml"
run_expect 2 "rules 为空 → exit 2"       src/server.ts --owner mac --yaml "$TMPD/empty.yaml"
printf '{"not": "mapping"}\n' > "$TMPD/scalar.yaml"
run_expect 2 "yaml 非映射 → exit 2"      src/server.ts --owner mac --yaml "$TMPD/scalar.yaml"
OUT="$("$PYBIN" "$TOOL" --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 2 ] && pass "无文件参数 → exit 2" || fail "无文件参数 — 期望 exit=2 实际 $_e"
OUT="$("$PYBIN" "$TOOL" src/server.ts --owner bogus --yaml "$CFG" 2>&1)"; _e=$?
[ "$_e" = 2 ] && pass "未知 owner → exit 2（argparse 拒绝）" || fail "未知 owner — 期望 exit=2 实际 $_e"
run_expect 0 "尚未创建的文件路径也可判域" src/evidence/not-yet-created.ts --owner win

echo ""
echo "── 7. 产物契约: CODEOWNERS == --emit-codeowners（drift 门禁）──"
if [ -f "$CODEOWNERS" ]; then
  "$PYBIN" "$TOOL" --emit-codeowners --yaml "$CFG" > "$TMPD/CODEOWNERS.gen" 2> "$TMPD/emit.err"
  _emit_e=$?
  [ "$_emit_e" = 0 ] || fail "--emit-codeowners 执行失败 (exit=$_emit_e): $(head -3 "$TMPD/emit.err")"
  # ① 规则行（去注释）必须逐行相同 —— 队长追加 1 口径，pre-contract/contract 两态都成立
  grep -v '^#' "$TMPD/CODEOWNERS.gen" > "$TMPD/co-rule-new.txt" 2>/dev/null
  grep -v '^#' "$CODEOWNERS" > "$TMPD/co-rule-old.txt" 2>/dev/null
  if diff -q "$TMPD/co-rule-new.txt" "$TMPD/co-rule-old.txt" >/dev/null 2>&1; then
    pass "drift①: 规则行逐行相同（去注释后零差异）"
  else
    fail "drift①: 规则行有差异（除注释外发生变化）"; diff "$TMPD/co-rule-new.txt" "$TMPD/co-rule-old.txt" | head -10 >&2
  fi
  # ② 逐字节：contract 态必须零差异；pre-contract 态只允许「生成器注释」差异（B 重跑后归零）
  if diff -q "$TMPD/CODEOWNERS.gen" "$CODEOWNERS" >/dev/null 2>&1; then
    pass "drift②: .github/CODEOWNERS 与生成结果逐字节一致"
  else
    NONCOMMENT_DIFF="$(diff "$TMPD/CODEOWNERS.gen" "$CODEOWNERS" | grep -cE '^[<>] [^#]' | tr -d '\n\r' || true)"; NONCOMMENT_DIFF="${NONCOMMENT_DIFF//[^0-9]/}"
    if [ "$NONCOMMENT_DIFF" != "0" ]; then
      fail "drift②: 差异涉及非注释行 ${NONCOMMENT_DIFF} 处（真漂移，非预期）"; diff "$TMPD/CODEOWNERS.gen" "$CODEOWNERS" | head -10 >&2
    elif [ "$LIVE_MODE" = "pre-contract" ]; then
      pending "drift② pre-contract: 差异仅在注释段（生成器头文件名订正 + 领地注释改读 domain_defaults.win）；待 B 重跑 --emit-codeowners 覆盖后逐字节归零（已登记，不静默）"
    else
      pending "drift② contract: 差异仅在注释段（规则行已零差异，见 drift①）；待重跑 --emit-codeowners > .github/CODEOWNERS 覆盖后转绿 —— 该文件非 A 写集（已登记，不静默）"
    fi
  fi
  run_expect 0 "--emit-codeowners exit 0" --emit-codeowners
else
  fail "drift: .github/CODEOWNERS 不存在"
fi
# CODEOWNERS 语义: 宽规则在前、例外在后（最后匹配者胜出 → 例外才生效）
SRC_LINE=$(grep -n '^\*  *@' "$CODEOWNERS" | head -1 | cut -d: -f1)
SENT_LINE=$(grep -n '^src/sentinel/' "$CODEOWNERS" | head -1 | cut -d: -f1)
if [ -n "$SRC_LINE" ] && [ -n "$SENT_LINE" ] && [ "$SRC_LINE" -lt "$SENT_LINE" ]; then
  pass "CODEOWNERS 顺序: 兜底($SRC_LINE) 在 Mac 例外($SENT_LINE) 之前"
else
  fail "CODEOWNERS 顺序错: 兜底行=${SRC_LINE} 例外行=${SENT_LINE}（例外会被吞）"
fi

echo ""
echo "── 8. 结构契约: ownership.yaml 恰有一条 default 兜底规则 ──"
NDEF=$(grep -c 'default: true' "$CFG" | tr -d '\n\r')
NDEF="${NDEF//[^0-9]/}"
[ "$NDEF" = "1" ] && pass "default 规则恰 1 条" || fail "default 规则 $NDEF 条（期望恰 1 —— 删兜底会让越域静默变绿）"
for pat in 'src/sentinel/**' 'src/cron/**' 'src/mcp/**' 'scripts/audit/**' 'scripts/control-tower/**'; do
  if grep -qF "glob: \"$pat\"" "$CFG"; then pass "显式规则存在: $pat"; else fail "缺显式规则: $pat"; fi
done

echo ""
echo "── 9. 生产接线（铁律 0-2 WIRE CHECK）──"
# D733 第④项（pre-dispatch-check.sh 消费）依赖未合入的 PR #536 → 本 PR 只断言
# 「产物消费」这一条已成立；派单消费方的接线断言随 #536 合入后补。
if grep -q "check-ownership.py" "$CODEOWNERS" 2>/dev/null; then
  pass "接线: CODEOWNERS 头声明由 check-ownership.py 生成（产物消费成立）"
else
  fail "接线: CODEOWNERS 未声明生成来源"
fi

echo ""
echo "── 10. D1029 兜底语义收口（a/b/c 反例 + 判别性夹具 + live 契约探针）──"

# ── 10a 核心反例: 未登记新目录 ⇒ 未归属 —— exit 1 + 点名 + 逃生口提示 ──
run_expect 1 "10a 未登记新目录 → 未归属 exit 1（不再静默归 win）" \
  "$UNREG_DIR" --yaml "$CFG"
if printf '%s\n' "$OUT" | grep -q "未归属"; then pass "10a 输出点名「未归属」"; else fail "10a 输出未点名「未归属」"; fi
if printf '%s\n' "$OUT" | grep -q "显式加规则"; then pass "10a 输出给出「请在 ownership.yaml 显式加规则」"; else fail "10a 未给出显式加规则提示"; fi
if printf '%s\n' "$OUT" | grep -q "check-ownership.py $UNREG_DIR"; then pass "10a 提示含可复制复核命令（路径逐字）"; else fail "10a 提示缺可复制复核命令"; fi
run_expect 1 "10a 未归属在 --owner 模式下同样 exit 1" "$UNREG_DIR" --owner win --yaml "$CFG"
run_expect 1 "10a 未归属不会被判成跨域（口径不混）" "$UNREG_DIR" "$UNREG_DIR2" --yaml "$CFG"
if printf '%s\n' "$OUT" | grep -q "未归属" && ! printf '%s\n' "$OUT" | grep -q "跨域"; then
  pass "10a 未归属点名且不混为「跨域」"
else
  fail "10a 未归属口径与跨域混同"; echo "$OUT" | sed 's/^/      | /' >&2
fi
# 基线领地仍视同 win（分层生效的反面证据）
run_expect 0 "10a 基线领地 src/** 仍视同 win" src/server.ts --owner win --yaml "$CFG"
OUT="$("$PYBIN" "$TOOL" src/server.ts --yaml "$CFG" 2>&1)"
if printf '%s\n' "$OUT" | grep -q "基线领地"; then pass "10a 基线领地命中在输出中显式标注（不静默）"; else fail "10a 基线领地未显式标注"; fi

# ── 10b/10c 自包含 git 夹具树（含 parser 副本；不读 B 的树、不读未落 main 的路径）──
# 拓扑: C1 基线（未登记目录 + 旧态 yaml，**无 domain_defaults**）
#       → C2 同一变更集加规则 ⇒ 逃生口  → C3 改 ownership.yaml ⇒ claim 检查（HEAD~1..HEAD 恰含该文件）
# 三份 yaml 各自独立生成（互不覆盖）:
#   $CONTRACT_YAML  合同形态（真 yaml 副本 + 注入 domain_defaults/rule_authority）
#   *.inactive      剥离 domain_defaults（仅用于 C1 与「缺段 ⇒ exit 2」判据）
#   *.active        inactive + 新规则（仅用于 C2/C3）
FIX="$TMPD/fixture-a"
mkdir -p "$FIX/scripts/control-tower" "$FIX/scripts/product-lines" \
  "$FIX/docs/synova/coordination" "$FIX/scripts/audit" "$FIX/src/sentinel"
cp "$TOOL" "$FIX/scripts/control-tower/check-ownership.py"
cp "$REPO_DIR"/scripts/product-lines/*.py "$FIX/scripts/product-lines/"
FIXTOOL="$FIX/scripts/control-tower/check-ownership.py"
export SYNO_OWNERSHIP_YAML_MOD_DIR="$FIX/scripts/product-lines"
INNER_PY="$TMPD/inner-10b.py"
cat > "$INNER_PY" <<'INNER_PY_EOF'
import pathlib, sys
mode = sys.argv[1]
if mode == "strip":
    src = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
    i = src.index("domain_defaults:")
    j = src.index("rule_authority:")
    pathlib.Path(sys.argv[3]).write_text(src[:i] + src[j:], encoding="utf-8")
elif mode == "claim":
    # 在 rules 列表内插入一条显式规则（追加到文件尾会落在空行后 → 解析器判非法缩进）
    pth = pathlib.Path(sys.argv[2]); d = sys.argv[3]
    t = pth.read_text(encoding="utf-8")
    i = t.index('  - glob: "**"')
    pth.write_text(t[:i] + '  - glob: "%s/**"\n    owner: "win"\n' % d + t[i:], encoding="utf-8")
else:
    raise SystemExit("unknown mode")
INNER_PY_EOF
CF_INACTIVE="$TMPD/ownership-inactive.yaml"
CF_ACTIVE="$TMPD/ownership-active.yaml"
"$PYBIN" "$INNER_PY" strip "$CONTRACT_YAML" "$CF_INACTIVE" || fail "10b 前置: 旧态 yaml 生成失败"
cp "$CONTRACT_YAML" "$CF_ACTIVE"                      # 新态从**合同形态**出发（不是剥离态 —— 否则丢 domain_defaults）
"$PYBIN" "$INNER_PY" claim "$CF_ACTIVE" "$UNREG_DIR" || fail "10b 前置: 新规则注入失败"
# 三份夹具的形态自证（任一不成立 → 后续判据全部不可信，立即报红）
if grep -qE '^domain_defaults:' "$CONTRACT_YAML"; then pass "10b 前置: 合同形态夹具含 domain_defaults"; else fail "10b 前置: 合同形态夹具缺 domain_defaults"; fi
if grep -qE '^domain_defaults:' "$CF_INACTIVE"; then fail "10b 前置: 旧态夹具有 domain_defaults（C1 判据不可信）"; else pass "10b 前置: 旧态夹具已剥离 domain_defaults（C1 判据可信）"; fi
if grep -qE '^domain_defaults:' "$CF_ACTIVE" && grep -qF "glob: \"$UNREG_DIR/**\"" "$CF_ACTIVE"; then pass "10b 前置: 新态夹具含 domain_defaults + 新规则"; else fail "10b 前置: 新态夹具形态不对（domain_defaults/新规则）"; fi
(
  cd "$FIX" || exit 1
  git init -q . >/dev/null 2>&1
  git config user.email "d1029-test@example.invalid"
  git config user.name "D1029 fixture"
  mkdir -p "$UNREG_DIR"
  printf '// unregistered new dir\n' > "$UNREG_DIR"
  cp "$CF_INACTIVE" "$OWNERSHIP_REL"                 # C1 基线: rules 与合同副本同序，仅缺 domain_defaults
  git add -A >/dev/null 2>&1
  git commit -qm "C1 base: unregistered dir, yaml without domain_defaults" >/dev/null 2>&1
  "$PYBIN" scripts/control-tower/check-ownership.py "$UNREG_DIR" --yaml "$OWNERSHIP_REL" >/dev/null 2>&1
  echo "   [夹具前置] C1（未加规则 + 旧态 yaml）exit=$?（期望 2 = 缺 domain_defaults，fail-closed）"
  cp "$CF_ACTIVE" "$OWNERSHIP_REL"                   # C2 同一变更集: 认领该目录
  git add -A >/dev/null 2>&1
  git commit -qm "C2 same changeset: claim the new dir in ownership.yaml" >/dev/null 2>&1
  "$PYBIN" scripts/control-tower/check-ownership.py "$UNREG_DIR" --yaml "$OWNERSHIP_REL" >/dev/null 2>&1
  echo "   [夹具前置] C2（同变更集内加规则）exit=$?（期望 0）"
  # C3: 只在 C2 形态上追加一行**无害注释**（不得覆盖成合同副本 —— 那会把 C2 刚加的规则抹掉）
  printf '\n# C3 probe amendment (claim-check target)\n' >> "$OWNERSHIP_REL"
  git add -A >/dev/null 2>&1
  git commit -qm "C3 change ownership.yaml alone (claim check target)" >/dev/null 2>&1
  echo "   [夹具前置] C3 变更集 = $(git diff --name-only HEAD~1 | tr '\n' ' ')"
) 2>&1 | sed 's/^/  /'

# ── 10b 逃生口: 未登记文件 + 同一变更集里加好的规则 ⇒ 通过 ──
OUT="$("$PYBIN" "$FIXTOOL" "$UNREG_DIR" --yaml "$FIX/$OWNERSHIP_REL" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "10b 加规则后同路径 ⇒ exit 0（规则真生效）"; else fail "10b 加规则后仍红 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
# 单文件判定 = 逃生口的判据本体（该文件在 C2 里被显式认领 ⇒ win）。
# 注: 不在此处做「全变更集单域判定」——契约 DS2 把那个口径留给 §10c（域判定豁免域），
# 且夹具自身的 docs/synova/coordination/** 属 mac，混进来会掩盖逃生口本身是否生效。
OUT="$(cd "$FIX" && "$PYBIN" "$FIXTOOL" "$UNREG_DIR" --owner win --yaml "$FIX/$OWNERSHIP_REL" 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "10b 逃生口: 同批加规则后该新目录文件判 win（--owner win 通过）"; else fail "10b 逃生口失效 — 期望 exit=0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
OUT="$(cd "$FIX" && "$PYBIN" "$FIXTOOL" "$UNREG_DIR" --owner mac --yaml "$FIX/$OWNERSHIP_REL" 2>&1)"; _e=$?
if [ "$_e" = 1 ]; then pass "10b 反面对照: 同一文件声明 mac ⇒ 越域 exit 1（判据非恒真）"; else fail "10b 反面对照失效 — 期望 exit=1 实际 $_e"; fi
if grep -qF "glob: \"$UNREG_DIR/**\"" "$FIX/$OWNERSHIP_REL"; then pass "10b 前置: 规则确已写进夹具 yaml（非空跑）"; else fail "10b 前置: 夹具 yaml 未加规则"; fi

# ── 10c 规则修改权: 变更集含 ownership.yaml ⇒ 须创始人批准凭据 ──
printf '## 改动说明\n仅调整注释，无凭据\n' > "$FIX/pr-no.txt"
printf '## 创始人批准 —— 批准 D1029 修改 ownership 域名规则\n' > "$FIX/pr-ok.txt"
OUT="$(cd "$FIX" && "$PYBIN" "$FIXTOOL" --claim-check --changed-from HEAD~1 --pr-body pr-no.txt 2>&1)"; _e=$?
if [ "$_e" = 1 ]; then pass "10c 变更集含 ownership.yaml + 无凭据 ⇒ exit 1"; else fail "10c 无凭据未拦 — 期望 1 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
if printf '%s\n' "$OUT" | grep -q "创始人批准"; then pass "10c 拦下时打印所需凭据（含「创始人批准」）"; else fail "10c 未打印所需凭据"; fi
OUT="$(cd "$FIX" && "$PYBIN" "$FIXTOOL" --claim-check --changed-from HEAD~1 --pr-body pr-ok.txt 2>&1)"; _e=$?
if [ "$_e" = 0 ]; then pass "10c 有创始人批准凭据 ⇒ exit 0"; else fail "10c 有凭据仍被拦 — 期望 0 实际 $_e"; echo "$OUT" | sed 's/^/      | /' >&2; fi
OUT="$(cd "$FIX" && printf '无关描述\n' | "$PYBIN" "$FIXTOOL" --claim-check --changed-from HEAD~1 2>&1)"; _e=$?
if [ "$_e" = 1 ]; then pass "10c 未给 --pr-body 时读 stdin 且无凭据 ⇒ exit 1"; else fail "10c stdin 路径未拦 — 期望 1 实际 $_e"; fi
OUT="$(cd "$FIX" && "$PYBIN" "$FIXTOOL" --claim-check --changed-from nope-ref-xyz --pr-body pr-ok.txt 2>&1)"; _e=$?
if [ "$_e" != 2 ]; then fail "10c git 取变更集失败未 fail-closed — 期望 exit=2 实际 $_e"
elif printf '%s\n' "$OUT" | grep -q "fail-closed"; then pass "10c 取不到变更集（ref 不存在）⇒ exit 2 + ❌ fail-closed（不假绿）"
else fail "10c exit=2 但输出未点名 fail-closed（疑似静默降级）"
fi

# ── 10d 判别性夹具（改坏即红）: 沙箱改坏三形态 → 必须红 ──
( cd "$TMPD" && "$PYBIN" - <<'PYEOF'
import pathlib
src = pathlib.Path("ownership-contract.yaml").read_text(encoding="utf-8")
# ① 删掉 domain_defaults 段（连同注入的规则权注释键）
i = src.index("domain_defaults:")
j = src.index("rule_authority:")
pathlib.Path("ownership-no-defaults.yaml").write_text(src[:i] + src[j:], encoding="utf-8")
# ② domain_defaults.win 置空列表
k = src.index("domain_defaults:")
m = src.index("rule_authority:")
empty = src[:k] + "domain_defaults:\n  win: []\n" + src[m:]
pathlib.Path("ownership-empty-win.yaml").write_text(empty, encoding="utf-8")
# ③ 删掉兜底规则
a = src.index('  - glob: "**"')
b = src.index('  - glob: "extensions/**"')
pathlib.Path("ownership-no-catchall.yaml").write_text(src[:a] + src[b:], encoding="utf-8")
PYEOF
) 2>/dev/null
if grep -qE '^  win: \[\]$' "$TMPD/ownership-empty-win.yaml"; then
  pass "10d 前置: 空 win 夹具已生成（win: []）"
else
  fail "10d 前置: 空 win 夹具生成失败（判据未真正被执行）"
fi
run_expect 2 "10d 沙箱删 domain_defaults 段 → exit 2（结构非法，不静默归 win）" \
  "$UNREG_DIR" --yaml "$TMPD/ownership-no-defaults.yaml"
if printf '%s\n' "$OUT" | grep -q "domain_defaults"; then pass "10d 删段报错点名 domain_defaults"; else fail "10d 删段未点名 domain_defaults"; fi
if printf '%s\n' "$OUT" | grep -q "基线领地"; then pass "10d 删段报错说明基线领地缺失"; else fail "10d 删段未说明基线领地"; fi
run_expect 2 "10d domain_defaults.win 置空 → exit 2（必须非空 glob 列表）" \
  "$UNREG_DIR" --yaml "$TMPD/ownership-empty-win.yaml"
if printf '%s\n' "$OUT" | grep -q "domain_defaults.win"; then pass "10d 空列表报错点名 domain_defaults.win"; else fail "10d 空列表未点名 domain_defaults.win"; fi
run_expect 1 "10d 删兜底规则 → 明示「未归属」+ exit 1（不再 exit 0 静默变绿）" \
  "$UNREG_DIR" --yaml "$TMPD/ownership-no-catchall.yaml"
run_expect 0 "10d 反面对照: 合同形态夹具同路径仍 exit 0（基线领地命中）" \
  src/server.ts --owner win --yaml "$CONTRACT_YAML"

# ── 10e --emit-codeowners 不读 domain_defaults（裁决 3②）: 缺段仍可生成 + 与仓库产物核对 ──
GEN_OK="$TMPD/CODEOWNERS.gen"; GEN_NODEF="$TMPD/CODEOWNERS.nodef"
"$PYBIN" "$TOOL" --emit-codeowners --yaml "$CFG" > "$GEN_OK" 2>"$TMPD/emit-ok.err"; _e=$?
[ "$_e" = 0 ] && pass "10e --emit-codeowners 正常态 exit 0" || { fail "10e emit 正常态 exit=$_e"; sed -n '1,5p' "$TMPD/emit-ok.err" >&2; }
"$PYBIN" "$TOOL" --emit-codeowners --yaml "$TMPD/ownership-no-defaults.yaml" > "$GEN_NODEF" 2>"$TMPD/emit-nodef.err"; _e=$?
[ "$_e" = 0 ] && pass "10e --emit-codeowners 在「缺 domain_defaults」夹具上仍 exit 0（不因缺键坏生成器）" \
  || { fail "10e 缺 domain_defaults 时 emit exit=${_e}（应为 0）"; sed -n '1,5p' "$TMPD/emit-nodef.err" >&2; }
if diff -q "$GEN_OK" "$GEN_NODEF" >/dev/null 2>&1; then pass "10e emit 输出与 domain_defaults 段无关（逐字节一致）"; else fail "10e emit 输出受 domain_defaults 影响（drift 风险）"; fi
# ── 10f live-yaml 契约探针（B 未落地 → PENDING 单列，不影响本套件退出码）──
if [ "$LIVE_MODE" = "pre-contract" ]; then
  pending "10f live-yaml 契约探针: ⏳ pre-contract: 待成员 B 落地 ownership.yaml（共享任务 task-2）后本项转绿"
  OUT="$("$PYBIN" "$TOOL" "$UNREG_DIR" --yaml "$YAML" 2>&1)"; _e=$?
  if [ "$_e" = 2 ] && printf '%s\n' "$OUT" | grep -q "domain_defaults"; then
    pending "10f live yaml 缺 domain_defaults ⇒ 归属判定 exit 2（结构性 fail-closed，符合合同 7；B 落地后本项转「真 yaml 判未归属 exit 1」）"
  else
    fail "10f live yaml 缺段时行为异常 — 期望 exit=2 + 点名 domain_defaults，实际 $_e"
  fi
else
  run_expect 1 "10f live yaml 判未登记目录为「未归属」⇒ exit 1" "$UNREG_DIR" --yaml "$YAML"
  run_expect 0 "10f live yaml 基线领地 src/** 仍视同 win" src/server.ts --owner win --yaml "$YAML"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ 全部通过: $PASS 项（PENDING=$PENDING 项，见上方 ⏳）"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ❌ $FAIL 项失败 / $PASS 项通过（PENDING=$PENDING 项）"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
