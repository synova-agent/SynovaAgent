#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ownership.test.sh — D733 ownership 机器化测试（ownership.yaml + check-ownership.py）
#
# 覆盖（铁律 48: 正常 / 降级 / 边界）:
#   1. 正常路径 — Mac/K3 正例归属正确（--owner 一致 → exit 0）
#   2. 越域    — 派单 §一 验收两条 + 单域模式跨域 → exit 1
#   3. 真实回归 — CTO 2026-09-13 两次派错线的实写集（D728 / D729）→ 派给 mac 必红
#   4. 反向验证 — 删掉 ownership.yaml 兜底规则 → 上述两条变绿（证明校验真在读数据）
#   4c. 判别性夹具 — D935 `docs/synova/presets/**` → mac：正常判 mac；沙箱副本删掉该规则 → 同一断言必红（见 §5b）
#   4d. 判别性夹具 — D972 `.dsh/**` → mac：同范式（见 §5c）；`.dsh/**` 在 §5c 之前为零覆盖
#   5. 降级    — yaml 缺失 / yaml 语法非法 → exit 2（fail-closed，不与「通过」混同）
#   6. 边界    — 无文件参数 / 未知 owner / 尚未创建的文件路径
#   7. 产物契约 — .github/CODEOWNERS == --emit-codeowners 逐字节（drift 门禁）
#   8. 结构契约 — ownership.yaml 恰有一条 default 兜底规则（防「删兜底」静默逃逸）
#
# 零真实仓库污染: 全部读操作 + mktemp 沙箱（PLATFORM-CHECKLIST #6）；不写仓库任何文件。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOL="$REPO_DIR/scripts/control-tower/check-ownership.py"
YAML="$REPO_DIR/docs/synova/coordination/ownership.yaml"
CODEOWNERS="$REPO_DIR/.github/CODEOWNERS"

# PLATFORM-CHECKLIST #1: PYBIN 三级探测（禁裸 python3 —— Win 部分机器无 python3.exe）
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then echo "❌ python 不可用 — 无法运行 ownership 测试" >&2; exit 2; fi

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }

# run <期望exit> <说明> <args...>  → 捕获 stdout/stderr 到 ${OUT}，比对退出码
OUT=""
run_expect() {
  local want="$1"; shift
  local desc="$1"; shift
  OUT="$("$PYBIN" "$TOOL" "$@" 2>&1)"
  local got=$?
  if [ "$got" = "$want" ]; then pass "$desc (exit=$want)"
  else fail "$desc — 期望 exit=$want 实际 exit=$got"; echo "$OUT" | sed 's/^/      | /' >&2; fi
}

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
OUT="$("$PYBIN" "$TOOL" src/sentinel/runner.ts src/cron/cron-scheduler.ts 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "单域模式: 全 Mac → exit 0" || fail "单域模式: 全 Mac — 期望 exit=0 实际 $_e"
OUT="$("$PYBIN" "$TOOL" src/sentinel/runner.ts src/l3/expert-registry.ts 2>&1)"; _e=$?
[ "$_e" = 1 ] && pass "单域模式: Mac+Win 混合 → exit 1（跨域）" || fail "单域模式: 混合 — 期望 exit=1 实际 $_e"
if echo "$OUT" | grep -q "跨域"; then pass "跨域输出点名「跨域」"; else fail "跨域输出未点名"; fi

echo ""
echo "── 4b. 域判定豁免 domain_neutral（D734 前置：各线都写的簿记不构成域信号）──"
OUT="$("$PYBIN" "$TOOL" .claude/bypass.log tests/control-tower/check-ownership.test.sh 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "bypass.log 豁免: 只剩 mac → exit 0" || fail "bypass.log 豁免失败 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "domain-neutral"; then pass "豁免路径明示 domain-neutral（不静默）"; else fail "豁免路径未明示"; fi
OUT="$("$PYBIN" "$TOOL" .claude/bypass.log src/l3/expert-registry.ts src/sentinel/runner.ts 2>&1)"; _e=$?
[ "$_e" = 1 ] && pass "豁免不掩盖真跨域（Mac+Win 仍 exit 1）" || fail "豁免掩盖了跨域 — 期望 1 实际 $_e"
run_expect 0 "豁免路径不参与 --owner 断言" .claude/bypass.log task-state/D733.json --owner mac
run_expect 1 "非豁免路径仍受 --owner 断言（回归）" src/sentinel/runner.ts --owner win

# D758: 验收证据目录（docs/synova/product-lines/evidence/**）——证据跟干活那条线走，不构成域信号
OUT="$("$PYBIN" "$TOOL" docs/synova/product-lines/evidence/D716-win-20260913/1-5-dual-guide-win-evidence.txt src/server.ts 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "D758 证据目录豁免: Win 代码 + 自己的验收证据 → exit 0" || fail "D758 证据豁免失败 — 期望 0 实际 $_e"
if echo "$OUT" | grep -q "domain-neutral"; then pass "D758 证据路径明示 domain-neutral（不静默）"; else fail "D758 证据路径未明示"; fi
OUT="$("$PYBIN" "$TOOL" docs/synova/product-lines/evidence/D716-win-20260913/x.txt scripts/control-tower/check-ownership.py 2>&1)"; _e=$?
[ "$_e" = 0 ] && pass "D758 Win 证据 + Mac 控制塔脚本 → 仍单域（证据不掺域）" || fail "D758 单域判定失败 — 期望 0 实际 $_e"
OUT="$("$PYBIN" "$TOOL" docs/synova/product-lines/evidence/D716-win-20260913/x.txt src/server.ts scripts/control-tower/check-ownership.py 2>&1)"; _e=$?
[ "$_e" = 1 ] && pass "D758 豁免不掩盖真跨域（Win 代码 + Mac 脚本仍 exit 1）" || fail "D758 豁免掩盖了跨域 — 期望 1 实际 $_e"
run_expect 0 "D758 豁免路径不参与 --owner 断言" docs/synova/product-lines/evidence/D716-win-20260913/x.txt --owner win

echo ""
echo "── 5. 反向验证: 删掉兜底规则 → 验收两条必须变绿（证明真在读 yaml）──"
NO_DEFAULT="$TMPD/ownership-no-default.yaml"
cp "$YAML" "$NO_DEFAULT"
"$PYBIN" - "$NO_DEFAULT" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
start = t.index('  - glob: "**"')
end = t.index('  - glob: "extensions/**"')
p.write_text(t[:start] + t[end:], encoding="utf-8")
PYEOF
if grep -q 'glob: "\*\*"' "$NO_DEFAULT"; then fail "反向验证前置: 兜底规则未删掉"; else pass "反向验证前置: 兜底规则已移除"; fi
run_expect 0 "删兜底 → src/server.ts 变绿"     src/server.ts --owner mac --yaml "$NO_DEFAULT"
run_expect 0 "删兜底 → src/evidence/x.ts 变绿" src/evidence/x.ts --owner mac --yaml "$NO_DEFAULT"
run_expect 1 "原 yaml 复测仍红（未污染真实文件）" src/server.ts --owner mac --yaml "$YAML"
if echo "$OUT" | grep -q "越域"; then pass "复测输出点名「越域」"; else fail "复测输出未点名越域"; fi
OUT="$("$PYBIN" "$TOOL" src/server.ts --owner mac --yaml "$NO_DEFAULT" 2>&1)"
if echo "$OUT" | grep -q "无归属规则匹配"; then pass "无归属时明示 ⚠️（不静默）"; else fail "无归属未明示（疑似静默降级）"; fi

echo ""
echo "── 5b. D935 判别性夹具: presets→mac（删该规则即红 = 判据真读数据，非 grep 型静态判据）──"
run_expect 0 "D935 presets 根文件 = Mac"     docs/synova/presets/install-squad-lead.sh --owner mac
run_expect 0 "D935 presets 子目录文件 = Mac" docs/synova/presets/synova-squad-lead/preset.yml --owner mac
run_expect 1 "D935 presets 派给 win 越域（对称）" docs/synova/presets/install-squad-lead.sh --owner win
# 改坏即红: 沙箱副本删掉刚加的 presets 规则 → 同一路径派 mac 必须 exit 1
# （若本项恒绿，说明判据是静态/硬编码而非真读数据 —— 反 grep 型静态判据）
PRESETS_OFF="$TMPD/ownership-no-presets.yaml"
cp "$YAML" "$PRESETS_OFF"
"$PYBIN" - "$PRESETS_OFF" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
start = t.index('  - glob: "docs/synova/presets/**"')
end = t.index('  - glob: ".github/workflows/**"')
p.write_text(t[:start] + t[end:], encoding="utf-8")
PYEOF
if grep -qF 'glob: "docs/synova/presets/**"' "$PRESETS_OFF"; then
  fail "D935 改坏前置: 沙箱副本里 presets 规则未删掉"
else
  pass "D935 改坏前置: 沙箱副本已删 presets 规则"
fi
run_expect 1 "D935 删 presets 规则 → presets 路径派 mac 必红" docs/synova/presets/install-squad-lead.sh --owner mac --yaml "$PRESETS_OFF"
run_expect 1 "D935 删 presets 规则 → 子目录文件同样必红"      docs/synova/presets/synova-squad-lead/SYSTEM-PROMPT.md --owner mac --yaml "$PRESETS_OFF"
run_expect 0 "D935 原 yaml 复测仍绿（未污染真实文件）"        docs/synova/presets/install-squad-lead.sh --owner mac --yaml "$YAML"

echo ""
echo "── 5c. D972 判别性夹具: .dsh→mac（沿用 §5b D935 同范式；删该规则即红 = 判据真读数据）──"
run_expect 0 "D972 .dsh 路径 = Mac"                    .dsh/skills/squad-discipline/SKILL.md --owner mac
# 改坏即红: 沙箱副本删掉 .dsh 规则 → 同一路径派 mac 必须 exit 1
# （若本项恒绿，说明判据是静态/硬编码而非真读数据 —— 反 grep 型静态判据）
DSH_OFF="$TMPD/ownership-no-dsh.yaml"
cp "$YAML" "$DSH_OFF"
"$PYBIN" - "$DSH_OFF" <<'PYEOF'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
start = t.index('  - glob: ".dsh/**"')
end = t.index('  - glob: "electron/**"')
p.write_text(t[:start] + t[end:], encoding="utf-8")
PYEOF
# 前置（仅在夹具构造失败时红，正常不计项）：确认规则真被删掉，否则下面「必红」断言是假绿
if grep -qF 'glob: ".dsh/**"' "$DSH_OFF"; then
  fail "D972 改坏前置: 沙箱副本里 .dsh 规则未删掉（后续必红断言不可信）"
fi
run_expect 1 "D972 删 .dsh 规则 → .dsh 路径派 mac 必红" .dsh/skills/squad-discipline/SKILL.md --owner mac --yaml "$DSH_OFF"

echo ""
echo "── 6. 降级与边界（fail-closed → exit 2）──"
run_expect 2 "yaml 不存在 → exit 2"      src/server.ts --owner mac --yaml "$TMPD/nope.yaml"
printf 'rules:\n  - glob: "**"\n   bad_indent: 1\n' > "$TMPD/bad.yaml"
run_expect 2 "yaml 语法非法 → exit 2"    src/server.ts --owner mac --yaml "$TMPD/bad.yaml"
printf 'rules: []\n' > "$TMPD/empty.yaml"
run_expect 2 "rules 为空 → exit 2"       src/server.ts --owner mac --yaml "$TMPD/empty.yaml"
printf '{"not": "mapping"}\n' > "$TMPD/scalar.yaml"
run_expect 2 "yaml 非映射 → exit 2"      src/server.ts --owner mac --yaml "$TMPD/scalar.yaml"
OUT="$("$PYBIN" "$TOOL" 2>&1)"; _e=$?
[ "$_e" = 2 ] && pass "无文件参数 → exit 2" || fail "无文件参数 — 期望 exit=2 实际 $_e"
OUT="$("$PYBIN" "$TOOL" src/server.ts --owner bogus 2>&1)"; _e=$?
[ "$_e" = 2 ] && pass "未知 owner → exit 2（argparse 拒绝）" || fail "未知 owner — 期望 exit=2 实际 $_e"
run_expect 0 "尚未创建的文件路径也可判域" src/evidence/not-yet-created.ts --owner win

echo ""
echo "── 7. 产物契约: CODEOWNERS == --emit-codeowners（drift 门禁）──"
if [ -f "$CODEOWNERS" ]; then
  "$PYBIN" "$TOOL" --emit-codeowners > "$TMPD/CODEOWNERS.gen" 2> "$TMPD/emit.err"
  _emit_e=$?
  [ "$_emit_e" = 0 ] || fail "--emit-codeowners 执行失败 (exit=$_emit_e): $(head -3 "$TMPD/emit.err")"
  if diff -q "$TMPD/CODEOWNERS.gen" "$CODEOWNERS" >/dev/null 2>&1; then
    pass "drift: .github/CODEOWNERS 与生成结果逐字节一致"
  else
    fail "drift: CODEOWNERS 漂移 —— 重跑 --emit-codeowners > .github/CODEOWNERS"; diff "$TMPD/CODEOWNERS.gen" "$CODEOWNERS" | head -10 >&2
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
NDEF=$(grep -c 'default: true' "$YAML" | tr -d '\n\r')
NDEF="${NDEF//[^0-9]/}"
[ "$NDEF" = "1" ] && pass "default 规则恰 1 条" || fail "default 规则 $NDEF 条（期望恰 1 —— 删兜底会让越域静默变绿）"
for pat in 'src/sentinel/**' 'src/cron/**' 'src/mcp/**' 'scripts/audit/**' 'scripts/control-tower/**'; do
  if grep -qF "glob: \"$pat\"" "$YAML"; then pass "显式规则存在: $pat"; else fail "缺显式规则: $pat"; fi
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
echo "═══════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ 全部通过: $PASS 项"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ❌ $FAIL 项失败 / $PASS 项通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
