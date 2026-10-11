#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# content-coupling.test.sh — K12-13（issue #196）CC1–CC4 门禁夹具
#
# 被测: scripts/check-content-coupling.sh（判据源: 院方《extensions内容面规范-v0.1》§3.5）
#
# 🔴 验收形态（创始人 2026-10-11 明令 · 门禁类尤其）：**真触发门禁**，不是扫门禁源码。
#    每条判据都构造**违规样例** ⇒ 断言门禁 exit 1 **且输出点名具体失败点**（文件:行 + CC 编号）；
#    每条判据都构造**合规样例** ⇒ 断言 exit 0（防"永远红"）；合规面另含**不得误报**项
#    （包 import / extensions 内部相对 import / 注释掉的违规 import）。
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 判别性 + 改坏即红）:
#   接线  — 门禁真实存在 + 接入状态如实（本卡未接 pre-commit/CI，接入方案写在门禁头 §接入方案）
#   正常  — 合规夹具（含 @synova/* 包 import、extensions 内部相对 import）⇒ exit 0；真仓 ⇒ exit 0
#   正常  — 棘轮: 基线内条目减少 ⇒ 打印 STALE 但 exit 0（"修好不红"）
#   CC1   — 越界 type import ⇒ exit 1 且点名 `CC1 NEW .../viol-type.ts:1`；越界**值** import ⇒ 同上；
#           动态 import('...src/...') ⇒ 同上；**注释掉的违规 import ⇒ 不得报**（exit 0）
#   CC2   — src 取 extensions type ⇒ exit 1 且点名 `CC2 NEW src/engine.ts:`；
#           src 取 extensions **值** ⇒ 亦红（值向零容忍）；合规（src 内部互相 import）⇒ exit 0
#   CC3   — manifest.type 未登记 ⇒ exit 1；status=reachable 但 loader 不可解析 ⇒ exit 1；
#           status 非法值 ⇒ exit 1；合规（登记 + loader 在盘）⇒ exit 0
#   CC4   — 顶层目录缺 manifest ⇒ exit 1；manifest 缺 type ⇒ exit 1；manifest JSON 坏 ⇒ exit 1；合规 ⇒ exit 0
#   参数闸 — `--help` ⇒ 用法 + exit 0；未知参数（如 --print-basline 拼错）⇒ exit 2（不静默跑成"像成功"）
#   降级  — extensions/ 缺失 / registry 缺失 / 源文件不可读 ⇒ exit 2 + `CONTENT-COUPLING: DEGRADED`
#           （fail-closed，绝不判绿；「读不了 = 没扫」不许静默当通过）
#   真仓  — 真仓 CC1/CC2 存量清单按键计数（113 type + 30 值 / 94 type），SYNO_CI=1 亦 exit 0；
#           CC_STRICT=1 ⇒ exit 1（存量亦判红，证明 strict 位真的起作用）
#
# 沙箱: 夹具全部在 mktemp -d 内（CC_ROOT/CC_EXT_DIR/CC_SRC_DIR/CC_REGISTRY 注入缝），
#       仓库工作区**零写入** —— 收尾有断言（git status --porcelain 前后一致）。
#
# 🔴 改坏即红（本夹具的设计目的，实测证据见交付回执）:
#   把门禁里任一条 CC 关掉/削弱 ⇒ 对应用例立即转红并点名该 CC 的夹具（非笼统 exit 1）；
#   改回 ⇒ 全绿。四条各验一次，原始输出留档。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/check-content-coupling.sh"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
FX="$TMPD/fx"

[ -f "$GATE" ] || { echo "  ❌ 被测门禁缺失: $GATE"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "  ⚠️ python3 不可用 — 门禁自身 fail-closed；本夹具跳过"; exit 0; }

echo "═══ K12-13 内容面耦合门禁 CC1–CC4 ─── 夹具（真触发，非扫源码）═══"

# ── 夹具底座：最小内容面 + 引擎面 + registry ──────────────────────────────────
mk_base() {
  rm -rf "$FX"
  mkdir -p "$FX/extensions/demo" "$FX/src/deploy" "$FX/src/loader"
  cat > "$FX/src/deploy/content-registry.ts" <<'TS'
/** 夹具 registry：唯一 type→loader 真源（形态与 src/deploy/content-registry.ts 同构） */
export const CONTENT_TYPES = [
  {
    type: 'demo',
    face: 'content',
    status: 'reachable',
    loader: { module: '../loader/demo-loader', init: 'initDemo' },
  },
  {
    type: 'demo-retired',
    face: 'config',
    status: 'retired',
  },
];
TS
  printf 'export function initDemo() { return 1; }\n' > "$FX/src/loader/demo-loader.ts"
  cat > "$FX/extensions/demo/manifest.json" <<'J'
{ "name": "demo", "version": "1.0.0", "type": "demo" }
J
  printf 'export const x = 1;\n' > "$FX/extensions/demo/x.ts"
}
run_gate() {  # run_gate <extra env...>   —— 恒以 SYNO_CI=1（硬阻断位）跑，除非显式覆盖
    CC_ROOT="$FX" CC_EXT_DIR="$FX/extensions" CC_SRC_DIR="$FX/src" \
    CC_REGISTRY="$FX/src/deploy/content-registry.ts" SYNO_CI=1 \
      bash "$GATE" "$@" 2>&1
}

REPO_DIRTY_BEFORE="$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')"

# ── 接线（WIRE CHECK）────────────────────────────────────────────────────────
echo "── 接线 ──"
ok "门禁存在: scripts/check-content-coupling.sh"
if grep -q "check-content-coupling" "$REPO/scripts/pre-commit-check.sh" 2>/dev/null; then
  WIRED_PC="已接"; else WIRED_PC="未接"; fi
if grep -q "check-content-coupling" "$REPO/.gitea/workflows/local-gates.yml" 2>/dev/null; then
  WIRED_CI="已接"; else WIRED_CI="未接"; fi
echo "  ℹ️ 接入状态实测: pre-commit=$WIRED_PC ｜ CI(.gitea/local-gates.yml)=${WIRED_CI}"
if grep -q "§接入方案" "$GATE"; then ok "接入方案随门禁落盘（头注释 §接入方案，含 CI 行号级改法）"
else no "门禁头注释缺 §接入方案（未接线又无方案 = 死件）"; fi
if [ "$WIRED_PC" = "未接" ] && [ "$WIRED_CI" = "未接" ]; then
  ok "接入状态如实：两处均未接（未接线被明确标注，未冒充已生效）"
else
  ok "接入状态如实：pre-commit=$WIRED_PC ｜ CI=${WIRED_CI}（与本行同步）"
fi

# ── 参数闸（打错字不许伪装成"跑过了"）────────────────────────────────────────
echo "── 参数闸 ──"
OUT="$(bash "$GATE" --help 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q "^用法:"; then
  ok "--help ⇒ 用法文本 + exit 0（头注释承诺的参数真落地）"
else no "--help 未落地（rc=${RC}）"; fi
OUT="$(bash "$GATE" --print-basline 2>&1)"; RC=$?
if [ "$RC" -eq 2 ] && echo "$OUT" | grep -q "未知参数"; then
  ok "未知参数（拼错）⇒ exit 2 fail-closed（不静默跑成"像成功"）"
else no "未知参数未 fail-closed（rc=${RC}）"; fi
# 🔴 独立复核（2026-10-11）发现并修复: `--print-baseline` 曾是**承诺而未实现**的参数 ——
#   case 只列 `--help|-h`，`-*` 兜底把合法长参一起吞掉 ⇒ exit 2 ⇒ 基线永远刷不了。
#   本断言即该缺陷的回归护栏（修前必红：rc=2 + "未知参数"）。
OUT="$(bash "$GATE" --print-baseline 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q "^CC-BASELINE-BEGIN$" && echo "$OUT" | grep -q "^CC-BASELINE-END$"; then
  ok "--print-baseline ⇒ CC-BASELINE 段 + exit 0（基线的唯一合法刷新口真的可用）"
else
  no "--print-baseline 不可用（rc=${RC}；头注释承诺该 flag 为"基线唯一显式刷新口"，实现缺失=棘轮永久冻结）"
fi
# 且必须与 `--help` 一样**不落进未知参数兜底**（防"改了 help 文本但没放行分支"）
if echo "$OUT" | grep -q "未知参数"; then
  no "--print-baseline 落进未知参数兜底（合法参数被当错字）"
else
  ok "--print-baseline 未被未知参数兜底吞掉"
fi

# ── 基线夹具：合规 ⇒ exit 0 ───────────────────────────────────────────────────
echo "── 正常（合规夹具 ⇒ 不得红）──"
mk_base
printf "import type { A } from '@synova/contracts';\nimport { b } from './neb';\nimport { c } from 'node:crypto';\n" \
  > "$FX/extensions/demo/ok-imports.ts"
printf "export const neb = 1;\nexport type A = { a: number };\n" > "$FX/extensions/demo/neb.ts"
printf "import type { A } from './neb';\nexport const e = 1;\n" > "$FX/src/engine.ts"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q "CONTENT-COUPLING: OK"; then
  ok "合规夹具（包 import ＋ extensions 内部相对 import ＋ src 内部 import）⇒ exit 0"
else no "合规夹具应 exit 0（rc=${RC}；tail: $(echo "$OUT" | tail -3 | tr '\n' '|')）"; fi

printf "// import type { A } from '../../../src/ghost';\n/* import { g } from '../../src/ghost2'; */\nexport const z = 1;\n" \
  > "$FX/extensions/demo/commented.ts"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 0 ] && ! echo "$OUT" | grep -q "ghost"; then
  ok "注释里的违规 import ⇒ 不报（注释剥离生效，防幽灵违规）"
else no "注释内 import 被误报（rc=${RC}）"; fi
rm -f "$FX/extensions/demo/commented.ts" "$FX/extensions/demo/ok-imports.ts"

# ── CC1 方向 ─────────────────────────────────────────────────────────────────
echo "── CC1 方向 ──"
mk_base
printf "import type { A } from '../../../src/engine';\nexport const t = 1;\n" > "$FX/extensions/demo/viol-type.ts"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC1 NEW extensions/demo/viol-type.ts:1"; then
  ok "CC1 反例①type：越界 type import ⇒ exit 1 且点名 file:line + 说明符"
else no "CC1 反例①type 未红/未点名（rc=${RC}；$(echo "$OUT" | grep -m1 'CC1 NEW' || echo '无 CC1 NEW 行')）"; fi

mk_base
printf "import { check } from '../../../src/sentinel/assert';\nexport const t = 1;\n" > "$FX/extensions/demo/viol-value.ts"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC1 NEW extensions/demo/viol-value.ts:1.*(值)"; then
  ok "CC1 反例②值：越界**值** import ⇒ exit 1 且标注 (值)（值向尤严）"
else no "CC1 反例②值 未红/未标注（rc=${RC}）"; fi

mk_base
printf "export const load = async () => (await import('../../../src/l4/graph-traversal')).f;\n" \
  > "$FX/extensions/demo/viol-dyn.ts"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC1 NEW extensions/demo/viol-dyn.ts:1"; then
  ok "CC1 反例③动态：await import('...src/...') ⇒ exit 1（动态形态不漏）"
else no "CC1 反例③动态 未红（rc=${RC}）"; fi

# ── CC2 对称 ─────────────────────────────────────────────────────────────────
echo "── CC2 对称 ──"
mk_base
printf "import type { X } from '../extensions/demo/x';\nexport const e = 1;\n" > "$FX/src/engine-cc2.ts"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC2 NEW src/engine-cc2.ts:1"; then
  ok "CC2 反例①：src 从 extensions 取 type ⇒ exit 1 且点名"
else no "CC2 反例① 未红/未点名（rc=${RC}）"; fi

mk_base
printf "import { x } from \"../extensions/demo/x\";\nexport const e = x;\n" > "$FX/src/engine-cc2v.ts"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC2 NEW src/engine-cc2v.ts:1.*(值)"; then
  ok "CC2 反例②：src 从 extensions 取**值** ⇒ exit 1（双引号形态亦识别）"
else no "CC2 反例② 未红（rc=${RC}）"; fi

# ── CC3 可达 ─────────────────────────────────────────────────────────────────
echo "── CC3 可达 ──"
mk_base
mkdir -p "$FX/extensions/unreg"
cat > "$FX/extensions/unreg/manifest.json" <<'J'
{ "name": "unreg", "type": "not-registered" }
J
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC3 NEW extensions/unreg — type='not-registered' 在 content-registry 未登记"; then
  ok "CC3 反例①：manifest.type 未登记 ⇒ exit 1 且点名 type 与目录"
else no "CC3 反例① 未红（rc=${RC}；$(echo "$OUT" | grep -m1 'CC3 NEW' || echo 无)）"; fi

mk_base
mkdir -p "$FX/extensions/dead"
cat > "$FX/extensions/dead/manifest.json" <<'J'
{ "name": "dead", "type": "dead-type" }
J
python3 - "$FX/src/deploy/content-registry.ts" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace("  {\n    type: 'demo-retired',", """  {
    type: 'dead-type',
    face: 'content',
    status: 'reachable',
    loader: { module: '../loader/no-such-loader', init: 'nope' },
  },
  {
    type: 'demo-retired',""")
open(p, 'w', encoding='utf-8').write(s)
PY
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC3 NEW extensions/dead — type='dead-type' status=reachable 但无可达证据"; then
  ok 'CC3 反例②：status=reachable 但 loader 在盘上不可解析 ⇒ exit 1（堵 loader 死）'
else no "CC3 反例② 未红（rc=${RC}）"; fi

mk_base
mkdir -p "$FX/extensions/weird"
cat > "$FX/extensions/weird/manifest.json" <<'J'
{ "name": "weird", "type": "weird-type" }
J
python3 - "$FX/src/deploy/content-registry.ts" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace("  {\n    type: 'demo-retired',", """  {
    type: 'weird-type',
    face: 'content',
    status: 'whatever',
  },
  {
    type: 'demo-retired',""")
open(p, 'w', encoding='utf-8').write(s)
PY
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC3 NEW extensions/weird — type='weird-type' status='whatever' 不在三态内"; then
  ok "CC3 反例③：status 非法值（随便写个状态就过 ⇒ 堵死）⇒ exit 1"
else no "CC3 反例③ 未红（rc=${RC}）"; fi

# ── CC4 结构 ─────────────────────────────────────────────────────────────────
echo "── CC4 结构 ──"
mk_base
mkdir -p "$FX/extensions/no-manifest"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC4 NEW extensions/no-manifest — 顶层目录缺 manifest.json"; then
  ok "CC4 反例①：顶层目录缺 manifest.json ⇒ exit 1 且点名目录"
else no "CC4 反例① 未红（rc=${RC}）"; fi

mk_base
mkdir -p "$FX/extensions/notype"
printf '{ "name": "notype" }\n' > "$FX/extensions/notype/manifest.json"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC4 NEW extensions/notype — manifest.json 缺 type 字段"; then
  ok "CC4 反例②：manifest 缺 type 字段 ⇒ exit 1"
else no "CC4 反例② 未红（rc=${RC}）"; fi

mk_base
mkdir -p "$FX/extensions/badjson"
printf '{ "name": "badjson", "type": \n' > "$FX/extensions/badjson/manifest.json"
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "CC4 NEW extensions/badjson — manifest.json 不可解析"; then
  ok "CC4 反例③：manifest JSON 坏 ⇒ exit 1（不静默当通过）"
else no "CC4 反例③ 未红（rc=${RC}）"; fi

# ── 棘轮语义 ─────────────────────────────────────────────────────────────────
echo "── 棘轮（只减不增）──"
mk_base
OUT="$(run_gate)"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q "STALE"; then
  ok "修好不红：夹具树内基线条目为 0 ⇒ 打印 STALE 但 exit 0（棘轮不反向咬人）"
else no "STALE 语义异常（rc=${RC}）"; fi

# ── local 模式报告诚实性（K12 第5批 缺陷回归护栏）──────────────────────────────
# 缺陷（实测复现）: local 模式下末行**硬编码** `CONTENT-COUPLING: OK（新增 0 …）` ⇒ 即使
#   逐条清单里列着新增违规，末行与退出码都显示"零新增"。后果：pre-commit 接入点以末行取数
#   ⇒ **有新增却报"新增 0"** = 假绿（比不接更糟：接了却告诉人"没问题"）。
# 本断言即该缺陷的回归护栏（修前必红：拿到 `新增 0` 而清单非空）。
#   注: local 的 **exit 0 契约不变**（只报数不判红）——本断言判的是**报告诚实性**，不是判红。
echo "── local 模式报告诚实性（假绿护栏）──"
mk_base
printf "import { x } from '../extensions/demo/x';\nexport const e = x;\n" > "$FX/src/engine-local.ts"
OUT="$(CC_ROOT="$FX" CC_EXT_DIR="$FX/extensions" CC_SRC_DIR="$FX/src" \
       CC_REGISTRY="$FX/src/deploy/content-registry.ts" bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -qE "^CONTENT-COUPLING: 新增 [1-9]"; then
  ok "local 模式有新增 ⇒ 末行如实报「新增 N(>0)」且 exit 0（只报数不判红，但不许假报 0）"
else
  no "local 模式有新增却报「新增 0」/ 未如实（rc=${RC}；末行=$(echo "$OUT" | grep -E '^CONTENT-COUPLING:' | tail -1)）"
fi

# ── 降级（fail-closed）───────────────────────────────────────────────────────
echo "── 降级（判不了 ⇒ 绝不判绿）──"
mk_base
OUT="$(CC_ROOT="$FX" CC_EXT_DIR="$FX/no-such-ext" CC_SRC_DIR="$FX/src" \
       CC_REGISTRY="$FX/src/deploy/content-registry.ts" SYNO_CI=1 bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ] && echo "$OUT" | grep -q "CONTENT-COUPLING: DEGRADED 扫描面缺失"; then
  ok "扫描面缺失 ⇒ exit 2 + DEGRADED（fail-closed）"
else no "扫描面缺失未 fail-closed（rc=${RC}）"; fi

mk_base
OUT="$(CC_ROOT="$FX" CC_EXT_DIR="$FX/extensions" CC_SRC_DIR="$FX/src" \
       CC_REGISTRY="$FX/no-registry.ts" SYNO_CI=1 bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ] && echo "$OUT" | grep -q "注册表真源缺失"; then
  ok "registry 缺失 ⇒ exit 2 + DEGRADED（fail-closed）"
else no "registry 缺失未 fail-closed（rc=${RC}）"; fi

mk_base
printf 'export const a = 1;\n' > "$FX/extensions/demo/secret.ts"
chmod 000 "$FX/extensions/demo/secret.ts"
OUT="$(run_gate)"; RC=$?
chmod 644 "$FX/extensions/demo/secret.ts" 2>/dev/null || true
if [ "$RC" -eq 2 ] && echo "$OUT" | grep -q "源文件不可读"; then
  ok "源文件不可读 ⇒ exit 2 + DEGRADED（未扫 ≠ 通过；防 fail-open 假绿）"
else no "不可读文件被静默跳过（rc=${RC}；静默跳过 = 假绿）"; fi

# ── 真仓（存量棘轮 + strict 位真起作用）─────────────────────────────────────
echo "── 真仓（存量棘轮位）──"
OUT="$(SYNO_CI=1 bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && echo "$OUT" | grep -q "CONTENT-COUPLING: OK"; then
  ok "真仓 SYNO_CI=1 ⇒ exit 0（存量在棘轮内，新增 0）"
else no "真仓 SYNO_CI=1 应 exit 0（rc=${RC}）"; fi
if echo "$OUT" | grep -qE "CC1 方向: .*违规 [0-9]+ 文件 / [0-9]+ type ＋ [0-9]+ 值" \
   && echo "$OUT" | grep -qE "CC2 对称: .*违规 [0-9]+ 文件"; then
  ok "真仓存量清单可读（CC1/CC2 逐条计数落在输出里，可核）"
else no "真仓存量清单输出缺失"; fi
OUT="$(CC_STRICT=1 bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 1 ] && echo "$OUT" | grep -q "STRICT：存量亦判红"; then
  ok "CC_STRICT=1 ⇒ exit 1（strict 位不是摆设，存量真能判红）"
else no "CC_STRICT=1 未判红（rc=${RC}）"; fi

# ── 沙箱洁净 ─────────────────────────────────────────────────────────────────
REPO_DIRTY_AFTER="$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')"
if [ "$REPO_DIRTY_BEFORE" = "$REPO_DIRTY_AFTER" ]; then
  ok "沙箱洁净：夹具未写仓库工作区（前后 git status --porcelain 行数一致 = ${REPO_DIRTY_BEFORE}）"
else no "夹具污染工作区（前 $REPO_DIRTY_BEFORE → 后 ${REPO_DIRTY_AFTER}）"; fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
