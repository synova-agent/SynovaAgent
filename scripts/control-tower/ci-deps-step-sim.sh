#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# ci-deps-step-sim.sh — 复跑 `.gitea/workflows/local-gates.yml` 的「依赖」步（lock 哈希指纹）
#
# 为什么需要它（铁律 47 契约优先 ＋ 纪律③「改坏即红」）:
#   CI 语义变更**无法在本地单测** ⇒ 把该 step 的 bash 正文**逐字抽出**（不复制、不重写），
#   在沙箱工作区里跑 4 个场景，证明判据双向为真：
#     甲 指纹一致     ⇒ 打印「跳过」且**不装**
#     乙 指纹变了     ⇒ 打印「重装」且**真装**（= "依赖变更在 CI 生效"的那一步）
#     丙 指纹文件缺失 ⇒ 走重装（fail-closed，不拿「无记录」当「未变」）
#     丁 哨兵         ⇒ 不许靠"删 node_modules"让它变绿
#
# 契约（铁律 47）:
#   @input  环境变量 SYNO_DEPS_WS   沙箱工作区（默认 $TMPDIR/ci-deps-step-sim）
#   @output 每场景：step 原始 stdout ＋ 判定行 `✅|❌ [甲|乙|丙|丁] …`
#   @exit   0 = 4 场景全 PASS；1 = 有 FAIL；2 = harness 自身失败（抽不出正文/沙箱不可建/假反例）
#   @degraded 无 —— 判不了就 exit 2（fail-closed）
#
# 🔴 本 harness 踩过并已修的三处**假反例/假判据**（写这里防后人复踩）:
#   ① 拿 `npm ci --silent` 的输出当判据 ⇒ **--silent 永不打印 `added N packages`** ⇒ 恒 FAIL。
#      ⇒ 判据改为**与输出无关的副作用**：指纹文件被更新（只在 npm ci 成功后写；step 有 set -e）
#        ＋ node_modules 体量从 1（假 vitest）涨到 >10。
#   ② 沙箱 package.json 用**桩 JSON** ⇒ 与真 lock 不匹配 ⇒ npm 走空转（`up to date, audited 1 package`）
#      ⇒ "重装"与"什么都没装"不可区分。⇒ 必须用**真** package.json。
#   ③ BSD `sed -i.bak '0,/re/s//…/'` 改 lock ⇒ **本机静默不生效** ⇒ 改 python，并断言前后哈希必不同。
#
# ⚠️ 只写 $SYNO_DEPS_WS，**不碰 /Users/wane/.ci-work/**（真 CI 工作区）。
# 用法: bash scripts/control-tower/ci-deps-step-sim.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WF="$ROOT/.gitea/workflows/local-gates.yml"
WS="${SYNO_DEPS_WS:-${TMPDIR:-/tmp}/ci-deps-step-sim}"

[ -f "$WF" ] || { echo "harness: 门禁文件不存在: $WF" >&2; exit 2; }

STEP_BODY="$(
  awk '
    /^      - name: 依赖（lock 哈希指纹/ { inblock=1; next }
    inblock && /^      - name: /      { exit }
    inblock && /^        run: \|/     { yaml=1; next }
    yaml                              { if ($0 ~ /^          /) { sub(/^          /, ""); print } else exit }
  ' "$WF"
)"
[ -n "$STEP_BODY" ] || { echo "harness: 抽不出「依赖（lock 哈希指纹…）」步正文（YAML 结构变了？）" >&2; exit 2; }
echo "═══ 抽出的 step 正文 $(printf '%s\n' "$STEP_BODY" | grep -c .) 行 ═══"

mkdir -p "$WS" 2>/dev/null || { echo "harness: 沙箱不可建: $WS" >&2; exit 2; }
cp "$ROOT/package-lock.json" "$WS/package-lock.json" || { echo "harness: lock 拷不进来" >&2; exit 2; }
cp "$ROOT/package.json"      "$WS/package.json"      || { echo "harness: package.json 拷不进来" >&2; exit 2; }
rm -rf "$WS/node_modules"
mkdir -p "$WS/node_modules/vitest"
echo '{"name":"vitest","version":"0.0.0-sim"}' > "$WS/node_modules/vitest/package.json"

STEP_RUN="$(printf '%s\n' "$STEP_BODY" | sed "s#/Users/wane/.ci-work/SynovaAgent#${WS}#g")"

FAILS=0
run_case() {
  local tag="$1" expect="$2" label="$3" out rc verdict="PASS" nm_after hash_now
  # NPM_CONFIG_CACHE: 不改 CI 正文，只在复跑环境把 npm 缓存内联到沙箱
  #   （本机沙箱态 HOME 下 ~/.npm/_cacache 不可写 ⇒ EPERM；CI runner 不受影响）
  out="$(NPM_CONFIG_CACHE="$WS/.npm-cache" bash -c "$STEP_RUN" 2>&1)"; rc=$?
  printf '──── 场景%s（%s）rc=%s ────\n%s\n' "$tag" "$label" "$rc" "$out"
  case "$expect" in
    skip)
      printf '%s' "$out" | grep -q "lock 未变，依赖已存在，跳过 npm ci" || verdict="FAIL(未打印跳过)"
      [ "$(ls "$WS/node_modules" | wc -l | tr -d ' ')" -le 2 ] || verdict="FAIL(竟然装了)"
      ;;
    install)
      nm_after="$(ls "$WS/node_modules" | wc -l | tr -d ' ')"
      hash_now="$(shasum -a 256 "$WS/package-lock.json" | awk '{print $1}')"
      printf '%s' "$out" | grep -q "lock 已变更 ⇒ 重装" || verdict="FAIL(未识别为变更)"
      [ "$(cat "$WS/.deps-lock-hash" 2>/dev/null)" = "$hash_now" ] || verdict="FAIL(指纹未更新 ⇒ npm ci 未成功)"
      [ "$verdict" = "PASS" ] && { [ "$nm_after" -gt 10 ] || verdict="FAIL(node_modules 仅 ${nm_after} 项 ⇒ 没真装)"; }
      [ "$verdict" = "PASS" ] || verdict="${verdict}；判据面: $(printf '%s' "$out" | grep -iE 'npm error|EPERM|EBADENGINE|EJSONPARSE' | head -2 | tr '\n' '|')"
      ;;
  esac
  if [ "$verdict" = "PASS" ]; then echo "  ✅ [${tag}] PASS — ${label}"; else echo "  ❌ [${tag}] ${verdict} — ${label}"; FAILS=$((FAILS+1)); fi
}

shasum -a 256 "$WS/package-lock.json" | awk '{print $1}' > "$WS/.deps-lock-hash"
run_case 甲 skip "指纹一致 ⇒ 跳过 npm ci（不装）"

LOCK_BEFORE="$(shasum -a 256 "$WS/package-lock.json" | awk '{print $1}')"
python3 - "$WS/package-lock.json" <<'PYLOCK'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding='utf-8'))
d["name"] = d["name"] + "-simlock"     # 合法 JSON、语义无关，但内容必变
json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PYLOCK
LOCK_AFTER="$(shasum -a 256 "$WS/package-lock.json" | awk '{print $1}')"
[ "$LOCK_BEFORE" != "$LOCK_AFTER" ] || { echo "harness: 乙场景未能改变 lock 内容（假反例，停止）" >&2; exit 2; }
run_case 乙 install "指纹变了 ⇒ 真跑 npm ci 并更新指纹（= 依赖变更在 CI 生效的那一步）"

rm -f "$WS/.deps-lock-hash"
run_case 丙 install "指纹文件缺失 ⇒ 重装（fail-closed，不拿『无记录』当『未变』）"

if [ -d "$WS/node_modules" ] && [ -f "$WS/package-lock.json" ]; then
  echo "  ✅ [丁] PASS — 不删 node_modules / 不删 lock（结构缺陷不被『删干净』抹掉）"
else
  echo "  ❌ [丁] FAIL — 工作区被删空 ⇒ 有人靠『删 node_modules』绕过缓存判据"; FAILS=$((FAILS+1))
fi

echo
if [ "$FAILS" -eq 0 ]; then echo "CI-DEPS-STEP-SIM: OK（4 场景全 PASS）"; exit 0; fi
echo "CI-DEPS-STEP-SIM: VIOLATION failures=$FAILS"
exit 1
