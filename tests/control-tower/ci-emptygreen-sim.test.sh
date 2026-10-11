#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ci-emptygreen-sim.test.sh — 配对测试（CT-40/U7：「控制塔脚本须有配对测试」）
#
# 被测对象：`scripts/control-tower/ci-emptygreen-sim.sh`（复跑 CI 第 ③ 步的复现器）
#
# 本测试**不重跑**那 6 个场景（那是复现器自己的事：它已内置判别力自检，桩没被
#   执行就 exit 2）。本测试判的是**复现器本身值不值得信**：
#     ① 存在 + 可执行 + 语法可过 + 契约缝（SYNO_EG_WF / SYNO_EG_WS）真被消费
#     ② 真工作流副本上：**现状 ⇒ 绿**（6/6）
#     ③ 真工作流副本上：**改坏即红**（纪律③）—— 把 ③ 步正文换回"改动前原样"
#        ⇒ 必须变红，且**失败点具体**（丙/丙2 rc_mismatch = "有代码改动却绿"病根）
#     ④ 缺工作流 ⇒ **exit 2**（三态：0=通过 / 1=失败 / 2=未实现，禁假绿）
#     ⑤ 型 D 防误伤：全程**不碰**真 `.gitea/workflows/local-gates.yml`（跑前跑后哈希一致）
#
# ⚠️ 改坏用的是 `SYNO_EG_WF` 指向的**临时副本**，真文件零写入。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SIM="$REPO/scripts/control-tower/ci-emptygreen-sim.sh"
WF="$REPO/.gitea/workflows/local-gates.yml"

PASS=0; FAIL=0
FAILED_DIGEST=""     # 失败断言名累积（字符串，不用数组：空数组 + `set -u` 会报 unbound，
                     #   且 bash 的报告名取自**上一个 token** ⇒ 实测误报成 `WF_BEFORE: unbound`
                     #   并指向错行，白查一轮。字符串累积无此坑。）
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); FAILED_DIGEST="${FAILED_DIGEST}${1} ; "; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "=== ci-emptygreen-sim 配对测试 ==="

# ── ① 存在 + 可执行 + 语法 ─────────────────────────────────────────────────
if [ -f "$SIM" ] && [ -x "$SIM" ]; then ok "存在且可执行"; else no "不存在或不可执行: $SIM"; fi
if bash -n "$SIM" 2>/dev/null; then ok "语法可过（bash -n）"; else no "语法错（bash -n）"; fi  # swallow-ok: bash -n 的 stderr 只含语法错本身，紧随的断言会报出

# ── ①b 接线：契约缝被消费（行为判别，非纯 grep）────────────────────────────
#   把 SYNO_EG_WF 指向一个**不存在**的路径 ⇒ 若缝真被消费，应立即 exit 2 且报该路径。
MISS_OUT="$(SYNO_EG_WF="$TMP/nope.yml" SYNO_EG_WS="$TMP/ws-miss" bash "$SIM" 2>&1)"; MISS_RC=$?
if [ "$MISS_RC" -eq 2 ] && printf '%s' "$MISS_OUT" | grep -q "nope.yml"; then
  ok "消费 SYNO_EG_WF 缝（指向不存在路径 ⇒ exit 2 且回显该路径）"
else
  no "未消费 SYNO_EG_WF（rc=${MISS_RC} ，期望 2；输出: $(printf '%s' "$MISS_OUT" | head -1)）"
fi

# ── ⑤ 防误伤基线：真工作流哈希（跑前）──────────────────────────────────────
if command -v shasum >/dev/null 2>&1; then
  WF_BEFORE="$(shasum -a 256 "$WF" | awk '{print $1}')"
else
  WF_BEFORE="$(cksum "$WF" | awk '{print $1"-"$2}')"
fi

# ── ② 现状（真工作流副本）⇒ 绿 6/6 ─────────────────────────────────────────
cp "$WF" "$TMP/wf-ok.yml"
OK_OUT="$(SYNO_EG_WF="$TMP/wf-ok.yml" SYNO_EG_WS="$TMP/ws-ok" bash "$SIM" 2>&1)"; OK_RC=$?
if [ "$OK_RC" -eq 0 ] && printf '%s' "$OK_OUT" | grep -q "场景全 PASS"; then
  ok "现状 ⇒ 绿（rc=0，N 场景全 PASS）"

# 场景数自证（纪律 8：判据要自证"它跑的是自己"）—— 防"场景被悄悄删掉却仍报全 PASS"
N_CASES="$(printf '%s' "$OK_OUT" | grep -oE '（[0-9]+ 场景全 PASS）' | grep -oE '[0-9]+' | head -1)"
if [ -n "$N_CASES" ] && [ "$N_CASES" -ge 6 ]; then
  ok "场景数自证：harness 自报 ${N_CASES} 个场景（≥6，未被子集化）"
else
  no "场景数自证失败（harness 自报 '${N_CASES:-无}'，期望 ≥6）"
fi
else
  no "现状应绿，实际 rc=${OK_RC} ；尾部: $(printf '%s' "$OK_OUT" | tail -1)"
fi

# ── ③ 改坏即红（纪律③）：副本上把 ③ 步换回"改动前原样" ────────────────────
#   用 python heredoc 做**精确行替换**（不写 .py 文件；输入走 sys.argv，无引号嵌套）
cp "$WF" "$TMP/wf-broken.yml"
python3 - "$TMP/wf-broken.yml" <<'PYEOF'
import sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().split("\n")
NEW = [
    'cd /Users/wane/.ci-work/SynovaAgent',
    'CHANGED_BASE=origin/local-main',
    'git rev-parse --verify -q "$CHANGED_BASE" >/dev/null || CHANGED_BASE=origin/main',
    'echo "增量基线 = $CHANGED_BASE"',
    'PATH="/Users/wane/.nvm/versions/node/v24.19.0/bin:$PATH" npx vitest run --changed "$CHANGED_BASE" 2>&1 | tail -20 || {',
    '  echo "::error::增量测试失败 —— 只跑了本次改动相关的测试"',
    '  exit 1',
    '}',
]
out, i, hit = [], 0, False
while i < len(lines):
    ln = lines[i]
    out.append(ln)
    if ln.strip().startswith("- name: ③ 增量测试"):
        i += 1
        out.append(lines[i])          # run: |
        i += 1
        while i < len(lines) and lines[i].startswith("          ") and lines[i].strip():
            i += 1
        out.extend("          " + b for b in NEW)
        hit = True
        continue
    i += 1
assert hit, "未找到 ③ 增量测试 step（工作流结构变了 ⇒ 本测试需同步）"
open(p, "w", encoding="utf-8").write("\n".join(out))
PYEOF
PY_RC=$?
if [ "$PY_RC" -ne 0 ]; then
  no "改坏脚本失败（rc=${PY_RC} ）⇒ 本测试无法判「改坏即红」"
else
  BR_OUT="$(SYNO_EG_WF="$TMP/wf-broken.yml" SYNO_EG_WS="$TMP/ws-broken" bash "$SIM" 2>&1)"; BR_RC=$?
  if [ "$BR_RC" -eq 1 ]; then
    ok "改坏即红（rc=1）"
  else
    no "改坏应红，实际 rc=$BR_RC ⇒ 复现器**零判别力**（律③违反）"
  fi
  # 失败点必须**具体**：丙/丙2 rc_mismatch = "有代码改动却绿" 正是本卡要治的病根
  if printf '%s' "$BR_OUT" | grep -q "\[丙\] FAIL(rc_mismatch)"; then
    ok "失败点具体：[丙] rc_mismatch（tests/ 改动却绿）"
  else
    no "未报出 [丙] rc_mismatch ⇒ 判据未落在真病根上"
  fi
  if printf '%s' "$BR_OUT" | grep -q "\[丙2\] FAIL(rc_mismatch)"; then
    ok "失败点具体：[丙2] rc_mismatch（src/ 改动却绿）"
  else
    no "未报出 [丙2] rc_mismatch ⇒ 判据未落在真病根上"
  fi
  # 丁（真失败）在改坏版下仍须红 —— 说明"改坏"没把整条链弄崩（差分有分辨力）
  if printf '%s' "$BR_OUT" | grep -q "\[丁\] FAIL"; then
    ok "改坏版下 [丁] 仍红（差分未把整链弄崩 ⇒ 并非「全红即可」）"
  else
    no "改坏版下 [丁] 竟 PASS（异常）"
  fi
fi

# ── ④ 缺工作流 ⇒ exit 2（三态，禁假绿）────────────────────────────────────
if [ "$MISS_RC" -eq 2 ]; then
  ok "缺被测文件 ⇒ exit 2（三态：0/1/2，未实现不冒充通过）"
else
  no "缺被测文件应 exit 2，实际 $MISS_RC"
fi

# ── ⑤ 防误伤：真工作流跑前跑后哈希一致 ────────────────────────────────────
if command -v shasum >/dev/null 2>&1; then
  WF_AFTER="$(shasum -a 256 "$WF" | awk '{print $1}')"
else
  WF_AFTER="$(cksum "$WF" | awk '{print $1"-"$2}')"
fi
if [ "$WF_BEFORE" = "$WF_AFTER" ]; then
  # ⚠️ 多字节字符与 `$VAR` 相邻时**必须包进 `$(printf …)`**：实测 `$WF_BEFORE ⇢ $WF_AFTER`
  #    在 `set -u` 下会让 bash 把 `⇢` 的字节吞进变量名 ⇒ 误报 `WF_BEFORE<乱码>: unbound variable`
  #    （隔离段可复现；换 `->` 即消失）。这是取词层坑，与编码无关。
  ok "真工作流零改动（${WF_BEFORE} ）"
else
  no "真工作流被改写！${WF_BEFORE}$(printf ' ⇢ ')${WF_AFTER}$(printf '（型 D：误伤他物）')"
fi

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && echo "  Status: ✅ ci-emptygreen-sim 配对测试通过" || echo "  Status: ❌ ci-emptygreen-sim 配对测试未通过"
# 失败摘要**必须留最后一行**（CI 只截 tail 进 ::error 注解）
if [ "$FAIL" -gt 0 ]; then
  echo "❌ FAILED(${FAIL}): ${FAILED_DIGEST}"
fi
exit "$FAIL"
