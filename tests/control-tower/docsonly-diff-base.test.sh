#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# docsonly-diff-base.test.sh — 卡 #1323（原号 #1236）: docs-only 判定的 base 解析 + 空变更集第三态
#
# 病灶: ci.yml 的 docs-only 判定在 `push` 事件下用 `origin/main...HEAD` —— push 到 main 时
#   HEAD == origin/main ⇒ 变更集为空 ⇒ `grep -qvE` 无行命中返 1 ⇒ 落 else ⇒ `docs_only=true`
#   ⇒ Gate Integrity / Control Tower 在 main 上**永久 skip**（控制条件 36 处同时倒向"跳过"）。
#
# 零副本原则: 本夹具**从 ci.yml 提取判定块原文执行**（不抄写逻辑）——
#   ① 提取「本分支」的块 ⇒ 新语义；② 提取 `origin/main` 版的块 ⇒ **旧语义**（"先红"取证）。
#   ⇒ 判据漂移会被本夹具直接暴露（提取即失败），不会出现"夹具与真值各说各话"。
#
# 覆盖（铁律 48 三路径 + 判别性）:
#   A 先红后绿   push 事件、origin/main==HEAD（真实 push-to-main 形态）⇒ 旧=true(缺陷) / 新=false
#   B 反例       **真 docs-only** 推送 ⇒ 新语义仍必须 true（防"把所有 PR 改成全量跑"）
#   C 边界       全零 SHA（首次 push / force push）⇒ 显式全量 false + 告警
#   D 结构断言   push 下 base **不是** origin/main（防日后改回去无人知，D1206 同口径）
#   E 回归       pull_request 事件 ⇒ 维持 origin/main 语义（false，与旧一致）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
CI="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

# ── 提取器: 从 DS_RE 赋值行到「外层 fi」（docs_only=true 之后第一个 10 空格缩进的 fi）──
_extract_block() {
  awk '
    /DS_RE="\$\(grep -m1 / { start = 1 }
    start { print }
    start && /docs_only=true/ { seen = 1 }
    seen && /^          fi$/ { exit }
  ' "$1"
}

NEW_BLK="$TMPD/block-new.sh"
# 新版块 = **工作树**的 ci.yml（本地跑测未提交改动即时生效；CI 上工作树 == 已提交态）——
#   ⚠️ 不可用 `git show HEAD:` 取「新版」：本地未提交时 HEAD 仍是旧版 ⇒ 会静默测到旧语义（本夹具首跑即踩）。
cp "$CI" "$TMPD/ci-new.yml"
OLD_BLK="$TMPD/block-old.sh"
_extract_block "$TMPD/ci-new.yml" > "$NEW_BLK"
# 🔴 P0 修复（2026-10-08）: 「先红基准」原先**从 `origin/main` 提取旧块** ⇒ **#1326 一合并，
#   main 上就是修好的版本 ⇒ 基准被合并本身销毁 ⇒ 断言 `A 先红未复现` 必红 ⇒ 卡住所有 PR**。
#   而 main 上该步骤被 skip（#1180 的 ctsignal 轴）⇒ 这个坏夹具在 main 上看不见、只在 PR 上炸。
#   ⇒ 改为**自包含内嵌旧块**（取自 #1326 合并前 `9ddd55f28`），**与 main 是否已修无关**。
cat > "$OLD_BLK" <<'OLD_BLOCK_EOF'
          DS_RE="$(grep -m1 '^DOCSONLY_WHITELIST_RE=' .github/ci-criteria.txt 2>/dev/null || true)"   # swallow-ok: 读失败由下一分支显式 fail-closed
          DS_RE="${DS_RE#DOCSONLY_WHITELIST_RE=}"; DS_RE="${DS_RE%$'\r'}"
          if [ -z "$DS_RE" ]; then
            echo "::warning title=docs-only criteria::.github/ci-criteria.txt 缺 DOCSONLY_WHITELIST_RE 或不可读 ⇒ 显式按非 docs-only 处理（全量跑，绝不误跳）"
            echo "docs_only=false" >> "$GITHUB_OUTPUT"
          elif ! git rev-parse --verify -q origin/main >/dev/null 2>&1; then
            # fail-safe: origin/main 不可解析 ⇒ 按非 docs-only 处理（全量跑，绝不误跳）
            echo "docs_only=false" >> "$GITHUB_OUTPUT"
          elif git diff --name-only origin/main...HEAD | grep -qvE "$DS_RE"; then
            echo "docs_only=false" >> "$GITHUB_OUTPUT"
          else
            echo "docs_only=true" >> "$GITHUB_OUTPUT"
          fi
OLD_BLOCK_EOF

echo "=== #1323: docs-only 判定 base 解析 + 空变更集第三态 ==="
[ -s "$NEW_BLK" ] && ok "提取到新版判定块（$(wc -l < "$NEW_BLK" | tr -d ' ') 行）" \
  || { no "提取新版判定块失败 —— 判据已漂移（提取器需同步）"; }
[ -s "$OLD_BLK" ] && ok "内嵌旧版判定块就位（自包含基准，与 main 是否已修无关）" \
  || no "内嵌旧版判定块缺失（无先红基准）"

# ── 沙箱: 三个提交（C1 docs / C2 +code / C3 +docs-only）──
_mk_sb() {
  local d="$1"
  mkdir -p "$d/.github" "$d/docs" "$d/src"
  cp "$REPO/.github/ci-criteria.txt" "$d/.github/ci-criteria.txt"   # 判据单源: 复制真值，不抄正则
  git -C "$d" init -q
  git -C "$d" config user.email "t@t"; git -C "$d" config user.name "t"
  printf 'doc\n' > "$d/docs/note.md";  git -C "$d" add -A >/dev/null 2>&1; git -C "$d" commit -qm c1
  printf 'code\n' > "$d/src/code.ts";  git -C "$d" add -A >/dev/null 2>&1; git -C "$d" commit -qm c2
  printf 'doc2\n' > "$d/docs/note2.md"; git -C "$d" add -A >/dev/null 2>&1; git -C "$d" commit -qm c3
  C3="$(git -C "$d" rev-parse HEAD)";        C2="$(git -C "$d" rev-parse HEAD~1)"
  C1="$(git -C "$d" rev-parse HEAD~2)";      C0="$(git -C "$d" rev-parse HEAD~3 2>/dev/null || echo "$C1")"
}
# $1=block $2=sandbox $3=期望 HEAD $4=origin/main $5=event $6=before(可空)
_run() {
  local blk="$1" d="$2" head="$3" omain="$4" ev="$5" before="${6:-}"
  local out="$d/ghout.txt"; : > "$out"
  git -C "$d" update-ref refs/remotes/origin/main "$omain" 2>/dev/null
  git -C "$d" checkout -q --detach "$head" 2>/dev/null
  ( cd "$d" && env -u GITHUB_EVENT_BEFORE GITHUB_OUTPUT="$out" GITHUB_EVENT_NAME="$ev" \
      ${before:+GITHUB_EVENT_BEFORE="$before"} bash "$blk" ) >"$d/stdout.txt" 2>"$d/stderr.txt"
  grep -m1 '^docs_only=' "$out" 2>/dev/null | cut -d= -f2
}

SB="$TMPD/sb"; _mk_sb "$SB"

# ── A 先红后绿: push-to-main 真实形态（HEAD == origin/main，before 指向上一提交）──
_A_NEW="$(_run "$NEW_BLK" "$SB" "$C2" "$C2" push "$C1")"
_A_OLD=""
[ -s "$OLD_BLK" ] && _A_OLD="$(_run "$OLD_BLK" "$SB" "$C2" "$C2" push "$C1")"
[ "$_A_OLD" = "true" ] && ok "A 先红: 旧语义在 push-to-main 下判 docs_only=true（缺陷复现）" \
  || no "A 先红未复现: 旧语义 docs_only=${_A_OLD:-<无>}（期望 true）"
[ "$_A_NEW" = "false" ] && ok "A 后绿: 新语义同场景判 docs_only=false（用 before 取真实变更集）" \
  || no "A 后绿未达: 新语义 docs_only=${_A_NEW:-<无>}（期望 false）"

# ── B 反例: 真 docs-only 推送 ⇒ 仍必须 true（防把全部 PR 改成全量跑）──
_B="$(  _run "$NEW_BLK" "$SB" "$C3" "$C3" push "$C2")"
[ "$_B" = "true" ] && ok "B 反例: 真 docs-only 推送仍判 true（早退语义未被改坏）" \
  || no "B 反例失真: docs_only=${_B:-<无>}（期望 true —— 早退被误改坏）"

# ── C 边界: 全零 SHA（首次 push / force push）⇒ 显式全量 + 告警 ──
_Z="0000000000000000000000000000000000000000"
_C="$(_run "$NEW_BLK" "$SB" "$C2" "$C2" push "$_Z")"
[ "$_C" = "false" ] && ok "C 边界: 全零 SHA ⇒ 退化到 origin/main，空集 ⇒ 显式 false（全量）" \
  || no "C 边界失真: docs_only=${_C:-<无>}（期望 false）"
grep -q "docs-only empty-diff" "$SB/stdout.txt" 2>/dev/null \
  && ok "C 告警: 空变更集走**显式第三态**并打 ::warning（铁律 11 不静默）" \
  || no "C 告警缺失: 未打 empty-diff 告警（静默归因）"

# ── D 结构断言: push 下 base 不是 origin/main（防改回去无人知）──
grep -q 'GITHUB_EVENT_BEFORE' "$NEW_BLK" && grep -q 'DS_BASE="$GITHUB_EVENT_BEFORE"' "$NEW_BLK" \
  && ok "D 结构: 判定块在 push 下显式取 GITHUB_EVENT_BEFORE 为 base" \
  || no "D 结构: 判定块未用 GITHUB_EVENT_BEFORE（push 下仍会落 origin/main ⇒ 缺陷会回来）"
grep -qE 'git diff --name-only "\$DS_BASE"\.\.\.HEAD' "$NEW_BLK" \
  && ok "D 结构: diff 用 \$DS_BASE（非写死 origin/main）" \
  || no "D 结构: diff 未走 \$DS_BASE"

# ── E 回归: pull_request 事件 ⇒ 维持 origin/main 语义 ──
_E="$(_run "$NEW_BLK" "$SB" "$C2" "$C1" pull_request "")"
[ "$_E" = "false" ] && ok "E 回归: pull_request 下 origin/main...HEAD 含代码 ⇒ false（与旧一致）" \
  || no "E 回归失真: docs_only=${_E:-<无>}（期望 false）"

# ── E 时间无关性（P0 修复的守护断言）: 基准必须是【内嵌】的，不得再依赖 origin/main ──
# 判据取「实际执行语句」而非其字面（否则 grep 会命中本断言自身的模式串 = 自匹配假红）
if grep -qE '^[[:space:]]*git -C "\$REPO" show origin/main' "$0" 2>/dev/null; then
  no "时间无关性: 夹具仍从 origin/main 提取旧块 ⇒ 它一旦被修好，本夹具会自毁（#1326 反噬形态）"
else
  ok "时间无关性: 先红基准为内嵌，不依赖 origin/main 当前内容（main 已修亦成立）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
