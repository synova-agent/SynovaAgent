#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# probe-delivery-hygiene.test.sh — 交付面卫生探针测试（CT-40 配对 / 铁律 48 / 判例 V-08）
#
# 覆盖矩阵:
#   正常 — 夹具仓库三判据全绿 → exit 0
#   反例 — 每条判据各给一个**构造得出来的**坏样本 → exit 1（改坏即红，判例 V-08）
#          V1-a 日期快照 / V1-b 0 字节交付件 / V1-c 占位符桩件 / V1-d 0 字节源码件
#          V2-① 闭包件被排除（客户镜像缺件，反向断言）
#          V3-a 被追踪的 .synova-wt-* / V3-b .gitignore 未覆盖
#   降级 — ref 不可解析 / --repo 不存在 → exit 2（M-02 三态，禁静默放行）
#   边界 — --json 结构（v1/v2/v3/exit）+ --explain
#   接线 — 探针的 .dockerignore 反选＝src/ 闭包（双向），并由夹具验证双向均可判红
#
# 隔离: 全部断言在 mktemp -d 出来的**夹具 git 仓库**内完成（`--repo` 注入缝），
#       不读、不写宿主仓库；env -u GIT_DIR/-u GIT_WORK_TREE/-u GIT_INDEX_FILE 防 D521/D555 污染。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROBE="$REPO/scripts/control-tower/probe-delivery-hygiene.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

FIX="$(mktemp -d "${TMPDIR:-/tmp}/probe-dh-XXXXXX")"
cleanup() { rm -rf "$FIX"; }
trap cleanup EXIT

g() { env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git -C "$FIX" "$@"; }

# ── 夹具：最小可判仓库 ────────────────────────────────────────────────────────
mkfix() {
  rm -rf "$FIX"; mkdir -p "$FIX"/{app,src/routes,tests,scripts/control-tower/views}
  # 闭包件（src/ 运行期依赖）
  printf 'export const store = {};\n'                       > "$FIX/scripts/control-tower/enterprise-fact-store.ts"
  printf 'export const scan = () => ({});\n'                > "$FIX/scripts/control-tower/conflict-scanner.ts"
  printf 'print("signal")\n'                                > "$FIX/scripts/control-tower/emit-signal.py"
  printf 'from views import render\nspec_from("founder-truth.py")\nprint(render())\n' > "$FIX/scripts/control-tower/generate-dashboard.py"
  printf 'def collect(): return {}\n'                       > "$FIX/scripts/control-tower/founder-truth.py"
  printf 'from .pm import render\n'                         > "$FIX/scripts/control-tower/views/__init__.py"
  printf 'def render(): return "x"\n'                       > "$FIX/scripts/control-tower/views/pm.py"
  # 非闭包治理件（应被排除出交付面）
  printf '#!/bin/bash\necho gate\n'                         > "$FIX/scripts/control-tower/check-gate.sh"
  printf 'import sys\nprint(sys.argv)\n'                    > "$FIX/scripts/control-tower/check-ownership.py"
  printf '{"a":1}\n'                                        > "$FIX/scripts/control-tower/audit-rules.json"
  printf '# checklist\n'                                    > "$FIX/scripts/control-tower/PLATFORM-CHECKLIST.md"
  # src/ 侧 load-bearing 引用（闭包由此机器推导，不手写清单 —— 判例 M-04 单源）
  cat > "$FIX/src/routes/cockpit.ts" <<'TS'
import { store } from '../../scripts/control-tower/enterprise-fact-store';
const p = 'scripts/control-tower/emit-signal.py';
const d = 'scripts/control-tower/generate-dashboard.py';
export const x = { store, p, d };
TS
  printf 'const c = await import("../../scripts/control-tower/conflict-scanner");\nexport const y = c;\n' > "$FIX/src/deploy.ts"
  # 交付面（干净）
  printf '<html><body>ok</body></html>\n'                   > "$FIX/app/index.html"
  printf 'body{color:#000}\n'                                > "$FIX/app/app.css"
  printf 'export const a = 1;\n'                            > "$FIX/src/routes/ok.ts"
  printf 'export {};\n'                                     > "$FIX/tests/ok.test.ts"
  # .gitignore（V3 防再犯）
  printf 'node_modules/\n.synova-wt-*\n'                    > "$FIX/.gitignore"
  # .dockerignore（V2 剥离面：排除 + 11/闭包件反选）
  cat > "$FIX/.dockerignore" <<'DI'
node_modules/
docs/
*.md
scripts/control-tower/*
!scripts/control-tower/enterprise-fact-store.ts
!scripts/control-tower/conflict-scanner.ts
!scripts/control-tower/emit-signal.py
!scripts/control-tower/generate-dashboard.py
!scripts/control-tower/founder-truth.py
!scripts/control-tower/views
!scripts/control-tower/views/*.py
DI
  g init -q -b main
  g -c user.email=t@t -c user.name=t add -A
  g -c user.email=t@t -c user.name=t commit -q -m "fixture"
}

run() { bash "$PROBE" --repo "$FIX" --ref HEAD "$@" >/tmp/probe-dh.out 2>&1; echo $?; }

echo "=== probe-delivery-hygiene 测试 ==="

# ── 语法 ──
if bash -n "$PROBE" 2>/dev/null; then ok "语法合法（bash -n）"; else no "语法错误"; fi

# ── 正常路径 ──
mkfix
rc=$(run)
if [ "$rc" -eq 0 ]; then ok "正常路径: 夹具三判据全绿 → exit 0"; else no "正常路径应 exit 0，实际 $rc"; sed 's/^/     /' /tmp/probe-dh.out; fi
if grep -q 'V2 PASS' /tmp/probe-dh.out; then ok "V2 正常: 幸存集合 == src/ 闭包"; else no "V2 未 PASS"; fi

# ── 反例 V1-a 日期快照 ──
mkfix; printf '<html>snap</html>\n' > "$FIX/app/dash-20260101.html"
g add -A >/dev/null 2>&1; g -c user.email=t@t -c user.name=t commit -q -m snap
rc=$(run)
if [ "$rc" -eq 1 ] && grep -q 'V1-a 日期快照' /tmp/probe-dh.out; then ok "反例 V1-a: 日期快照 → exit 1 且点名"; else no "反例 V1-a 未判红 (rc=$rc)"; fi

# ── 反例 V1-b 交付面 0 字节件 ──
mkfix; : > "$FIX/app/empty.css"
g add -A >/dev/null 2>&1; g -c user.email=t@t -c user.name=t commit -q -m zero
rc=$(run)
if [ "$rc" -eq 1 ] && grep -q 'V1-b 0 字节空件' /tmp/probe-dh.out; then ok "反例 V1-b: app/ 0 字节件 → exit 1 且点名"; else no "反例 V1-b 未判红 (rc=$rc)"; fi

# ── 反例 V1-c 占位符桩件 ──
mkfix; printf 'dummy' > "$FIX/app/favicon.ico"
g add -A >/dev/null 2>&1; g -c user.email=t@t -c user.name=t commit -q -m stub
rc=$(run)
if [ "$rc" -eq 1 ] && grep -q 'V1-c 占位符桩二进制' /tmp/probe-dh.out; then ok "反例 V1-c: 5B dummy ico → exit 1 且点名"; else no "反例 V1-c 未判红 (rc=$rc)"; fi

# ── 反例 V1-d 0 字节源码件 ──
mkfix; : > "$FIX/src/routes/ghost.ts"
g add -A >/dev/null 2>&1; g -c user.email=t@t -c user.name=t commit -q -m ghost
rc=$(run)
if [ "$rc" -eq 1 ] && grep -q 'V1-d 0 字节空源码/测试件' /tmp/probe-dh.out; then ok "反例 V1-d: src/ 0 字节件 → exit 1 且点名"; else no "反例 V1-d 未判红 (rc=$rc)"; fi

# ── 反例 V2-① 闭包件被排除（安全方向：客户镜像缺件）──
mkfix; grep -v '!scripts/control-tower/enterprise-fact-store.ts' "$FIX/.dockerignore" > /tmp/di-broken
g add -A >/dev/null 2>&1
rc=$(bash "$PROBE" --repo "$FIX" --ref HEAD --dockerignore /tmp/di-broken >/tmp/probe-dh.out 2>&1; echo $?)
if [ "$rc" -eq 1 ] && grep -q 'V2-①闭包件被排除' /tmp/probe-dh.out; then ok "反例 V2-①: 去掉一条反选 → exit 1（启动关键件点名）"; else no "反例 V2-① 未判红 (rc=$rc)"; fi

# ── 反例 V2-② 非闭包件仍在交付面（剥离方向）──
mkfix; printf 'scripts/control-tower/does-not-exist\n' >> /dev/null
python3 - "$FIX/.dockerignore" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding="utf-8").read()
s=s.replace("scripts/control-tower/*\n","")   # 去掉排除面 ⇒ 95→全部幸存
open(p,"w",encoding="utf-8").write(s)
PY
g add -A >/dev/null 2>&1; g -c user.email=t@t -c user.name=t commit -q -m noexcl
rc=$(run)
if [ "$rc" -eq 1 ] && grep -q 'V2-②非闭包件仍在交付面' /tmp/probe-dh.out; then ok "反例 V2-②: 撤掉排除面 → exit 1（非客户功能件点名）"; else no "反例 V2-② 未判红 (rc=$rc)"; fi

# ── 反例 V3-a 被追踪的 .synova-wt-* ──
mkfix; mkdir -p "$FIX/.synova-wt-1466"; printf 'x\n' > "$FIX/.synova-wt-1466/f"
g add -Af >/dev/null 2>&1; g -c user.email=t@t -c user.name=t commit -q -m wt
rc=$(run)
if [ "$rc" -eq 1 ] && grep -q 'V3-a 仓库内被追踪的' /tmp/probe-dh.out; then ok "反例 V3-a: 被追踪的工作树残留 → exit 1（-f 强制入库模拟）"; else no "反例 V3-a 未判红 (rc=$rc)"; fi

# ── 反例 V3-b .gitignore 未覆盖 ──
mkfix; printf 'node_modules/\n' > "$FIX/.gitignore"
g add -A >/dev/null 2>&1; g -c user.email=t@t -c user.name=t commit -q -m noignore
rc=$(run)
if [ "$rc" -eq 1 ] && grep -q 'V3-b .gitignore 未覆盖' /tmp/probe-dh.out; then ok "反例 V3-b: .gitignore 缺守卫 → exit 1（行为化 check-ignore 实测）"; else no "反例 V3-b 未判红 (rc=$rc)"; fi

# ── 降级/三态（M-02）──
mkfix
rc=$(bash "$PROBE" --repo "$FIX" --ref no-such-ref >/tmp/probe-dh.out 2>&1; echo $?)
if [ "$rc" -eq 2 ] && grep -q 'ref 不可解析' /tmp/probe-dh.out; then ok "三态: ref 不可解析 → exit 2（不静默放行）"; else no "三态 ref 未 exit 2 (rc=$rc)"; fi
rc=$(bash "$PROBE" --repo "$FIX/../definitely-missing-$$" --ref HEAD >/tmp/probe-dh.out 2>&1; echo $?)
if [ "$rc" -eq 2 ]; then ok "三态: --repo 目录不存在 → exit 2"; else no "三态 --repo 未 exit 2 (rc=$rc)"; fi

# ── 边界: --json 结构 ──
mkfix
J="$(bash "$PROBE" --repo "$FIX" --ref HEAD --json 2>/dev/null)"
if echo "$J" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert all(k in d for k in ("v1","v2","v3","exit","ref")); assert d["exit"]==0' 2>/dev/null; then
  ok "边界: --json 含 v1/v2/v3/exit/ref 且 exit=0"
else no "边界: --json 结构异常"; fi

# ── 边界: --explain 打印 V2 口径与不可达差额 ──
mkfix
EXPL="$(bash "$PROBE" --repo "$FIX" --ref HEAD --explain 2>&1)"
if printf '%s' "$EXPL" | grep -q '不可达差额'; then
  ok "边界: --explain 打印不可达差额（V-09 显式列出）"
else no "边界: --explain 缺不可达差额"; fi

# ── 边界: 未实现的 dockerignore 语义 ⇒ exit 2（不假装懂）──
mkfix; printf 'scripts/control-tower/[abc]\n' >> "$FIX/.dockerignore"
g add -A >/dev/null 2>&1; g -c user.email=t@t -c user.name=t commit -q -m charclass
rc=$(run)
if [ "$rc" -eq 2 ] && grep -q '未实现的语义' /tmp/probe-dh.out; then ok "边界: 字符类语义 → exit 2（不静默当成懂）"; else no "边界: 字符类未 exit 2 (rc=$rc)"; fi

echo
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
