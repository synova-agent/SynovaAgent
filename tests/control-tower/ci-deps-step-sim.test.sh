#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ci-deps-step-sim.test.sh — 判别夹具（含**反例**）· 配对 scripts/control-tower/ci-deps-step-sim.sh
#
# 被测物: scripts/control-tower/ci-deps-step-sim.sh（复跑 `.gitea/workflows/local-gates.yml` 的依赖步）
# 治的病: CI 安装判据与 `package-lock.json` 无关（只看"装过没有"）⇒ 依赖变更在 CI 不生效。
#
# 契据（铁律 47）
#   @input  env GATE / WF  被测脚本（默认 scripts/control-tower/ci-deps-step-sim.sh）｜workflow 路径
#           env WS         沙箱工作区（默认 mktemp -d，**绝不碰 /Users/wane/.ci-work/**）
#   @output 逐条 `PASS/FAIL` + 末行 `RESULT: <n> PASS / <m> FAIL`
#   @exit   0 = 全 PASS；1 = 有 FAIL；2 = 调用错误（被测物缺失）
#
# 判别性（V-08「改坏即红」）:
#   常规: 真跑复跑器 ⇒ 必须 `OK（4 场景全 PASS）`（甲跳过 / 乙真装 / 丙 fail-closed / 丁不删树）
#   🔴 反例: 把 workflow 里那一步的**正文**换回修复前的旧判据（步名保留，保证复跑器还抽得出正文）
#       ⇒ 复跑器必须 `VIOLATION`，且甲/乙/丙**逐条点名**（不是笼统 exit 1）
#   边界: workflow 里**没有**该步 ⇒ 复跑器必须 exit **2**（fail-closed，不拿"抽不到"当"通过"）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

GATE="${GATE:-scripts/control-tower/ci-deps-step-sim.sh}"
WF="${WF:-.gitea/workflows/local-gates.yml}"
PASS=0; FAIL=0
ok() { echo "  ✅ PASS: $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$GATE" ] || { echo "ERROR: 被测脚本不存在: $GATE" >&2; exit 2; }
[ -f "$WF" ]   || { echo "ERROR: workflow 不存在: $WF" >&2; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

# ── ① 常规：真跑（沙箱隔离；显式钉住 SYNO_DEPS_WS）────────────────────────────
OUT="$(SYNO_DEPS_WS="$TMPD/ws1" bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && printf '%s' "$OUT" | grep -q "CI-DEPS-STEP-SIM: OK（4 场景全 PASS）"; then
  ok "① 四个场景全 PASS（甲跳过 / 乙真装并回写指纹 / 丙 fail-closed / 丁不删树）"
else
  no "① 复跑器未达 OK（rc=${RC}；tail: $(printf '%s' "$OUT" | tail -2 | tr '\n' '|')）"
fi
for tag in 甲 乙 丙 丁; do
  printf '%s' "$OUT" | grep -q "✅ \[$tag\] PASS" && ok "①-${tag} 单场景 PASS 有据" || no "①-${tag} 单场景未 PASS"
done

# ── ② 反例：正文换回修复前的旧判据 ⇒ 必红且逐条点名 ──────────────────────────
BAD="$TMPD/bad-workflow.yml"
python3 - "$WF" "$BAD" <<'PYBAD'
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
i = s.index('      - name: 依赖（lock 哈希指纹')
j = s.index('      - name: ① 13 组门禁')
old_body = '''      - name: 依赖（lock 哈希指纹：变了就重装，没变才跳过）
        run: |
          WS=/Users/wane/.ci-work/SynovaAgent
          if [ -d "$WS/node_modules/vitest" ]; then echo "依赖已存在"; else cd "$WS" && /usr/bin/env PATH="/Users/wane/.nvm/versions/node/v24.19.0/bin:$PATH" npm ci --silent; fi
'''
open(dst, 'w', encoding='utf-8').write(s[:i] + old_body + s[j:])
PYBAD
if [ ! -s "$BAD" ]; then
  no "② 反例构造失败（注入后的 workflow 为空）"
else
  # 复跑器按自身路径推 ROOT ⇒ 造一个**最小 root2** 承载坏 workflow（目录与文件分开建！）
  T2="$TMPD/root2"
  mkdir -p "$T2/scripts/control-tower" "$T2/.gitea/workflows"
  cp "$GATE" "$T2/scripts/control-tower/ci-deps-step-sim.sh"
  cp "$BAD"  "$T2/.gitea/workflows/local-gates.yml"
  cp "$TMPD/ws1/package.json"      "$T2/package.json"
  cp "$TMPD/ws1/package-lock.json" "$T2/package-lock.json"
  OUT2="$(SYNO_DEPS_WS="$TMPD/ws3" bash "$T2/scripts/control-tower/ci-deps-step-sim.sh" 2>&1 || true)"; RC2=0
  if printf '%s' "$OUT2" | grep -q "VIOLATION failures="; then
    ok "② 反例（旧判据）⇒ 复跑器 VIOLATION（改坏即红成立）"
  else
    no "② 反例未致红（可能「永远绿」；tail: $(printf '%s' "$OUT2" | tail -2 | tr '\n' '|')）"
  fi
  for tag in 甲 乙 丙; do
    printf '%s' "$OUT2" | grep -q "❌ \[$tag\]" && ok "②-${tag} 具体失败点被点名" || no "②-${tag} 未点名（不可定位）"
  done
fi

# ── ③ 边界：workflow 里没有该步 ⇒ 必须 exit 2（fail-closed）─────────────────
T3="$TMPD/root3"; mkdir -p "$T3/scripts/control-tower" "$T3/.gitea/workflows"
cp "$GATE" "$T3/scripts/control-tower/ci-deps-step-sim.sh"
printf 'name: x\njobs:\n  gates:\n    steps:\n      - name: 别的步\n        run: echo hi\n' > "$T3/.gitea/workflows/local-gates.yml"
bash "$T3/scripts/control-tower/ci-deps-step-sim.sh" >/dev/null 2>&1; RC3=$?
if [ "$RC3" -eq 2 ]; then ok "③ 抽不出该步 ⇒ exit 2（fail-closed，不拿"判不了"当通过）"
else no "③ 应 exit 2（实测 ${RC3}）"; fi

# ── ④ 哨兵：夹具不得碰真 CI 工作区 ──────────────────────────────────────────
if [ -d /Users/wane/.ci-work/SynovaAgent/node_modules ]; then
  ok "④ 真 CI 工作区 node_modules 未被删（创始人明令）"
else
  no "④ 真 CI 工作区 node_modules 不见了 —— 有人删它让 CI 变绿"
fi

echo
echo "RESULT: ${PASS} PASS / ${FAIL} FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
