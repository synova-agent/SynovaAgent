#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# tag-ancestry.test.sh — D521/不变量1: tag 校验范围收窄（孤儿 tag 不拦他分支）
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常(放) — 孤儿 tag（非 HEAD 祖先，历史事故/其他分支）→ push 检查通过
#   正常(拦) — 本分支 tag（HEAD 祖先）非 origin/main 祖先 → 硬阻断（未合并打 tag）
#   正常(放) — tag 在 origin/main 上 → 通过（main 锚点合法）
#   降级     — origin/main 不可解析 → 跳过收窄段（显式降级，不静默）
#   接线     — check_tag_ancestry 含收窄逻辑（HEAD 祖先才查 origin/main）
# 沙箱: mktemp git 仓库（M13: git -c 一次性身份；update-ref 构造 refs/remotes/origin/main）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
# M13/D521: hook 上下文会导出 GIT_DIR/GIT_WORK_TREE——沙箱 git 命令必须剥掉
# （git -C 不覆盖 GIT_DIR env；D521-3 实证沙箱提交落到宿主分支）
unset GIT_DIR GIT_WORK_TREE
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PP="$REPO/scripts/pre-push-check.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D521 不变量1: tag 锚点收窄 ==="

# ── 接线 ──
grep -q 'is-ancestor "$t" origin/main' "$PP" && grep -q 'is-ancestor "$t" HEAD' "$PP" \
  && ok "接线: HEAD 祖先 ∩ origin/main 祖先 双段检查存在" || no "收窄逻辑缺失"

mk() { # <dir> — 建沙箱仓库: base commit + origin/main ref + VERSION.md
  local R="$1"; mkdir -p "$R/.codex/control-tower"
  git -C "$R" init -q
  git -C "$R" -c user.name=t -c user.email=t@t commit -q --allow-empty -m base
  git -C "$R" update-ref refs/remotes/origin/main HEAD
  printf '## V9.9.9 (test)\n' > "$R/.codex/control-tower/VERSION.md"
}

run_check() { # <repo> → OUT + EC
  OUT=$(cd "$1" && SYNO_TAG_ONLY=1 bash "$PP" 2>&1); EC=$?
}

# ── 场景A: 孤儿 tag（不可达提交）→ 不拦 ──
RA="$TMPD/ra"; mk "$RA"
git -C "$RA" -c user.name=t -c user.email=t@t commit -q --allow-empty -m feat
ORPHAN=$(git -C "$RA" commit-tree $(git -C "$RA" rev-parse HEAD^{tree}) -m orphan-blob)
git -C "$RA" tag V4.7.1 "$ORPHAN"   # 孤儿提交（非 HEAD 祖先、非 main 祖先）
git -C "$RA" tag V9.9.9 refs/remotes/origin/main  # 正常版本 tag 在 main 上（隔离 D319，只测孤儿豁免）
run_check "$RA"
[ "$EC" -eq 0 ] && ok "孤儿 tag（V4.7.1 类）不拦本分支 push" || no "孤儿 tag 仍拦: EC=$EC"
echo "$OUT" | grep -q "V4.7.1 不是 HEAD 祖先" && no "旧报错文案残留（说明没跳过）" || ok "孤儿 tag 被跳过而非点名"

# ── 场景B: 本分支 tag 非 origin/main 祖先（未合并打 tag）→ 拦 ──
RB="$TMPD/rb"; mk "$RB"
git -C "$RB" -c user.name=t -c user.email=t@t commit -q --allow-empty -m feat
git -C "$RB" tag V9.9.9 HEAD   # HEAD 祖先但非 origin/main 祖先
run_check "$RB"
[ "$EC" -eq 1 ] && ok "未合并分支 tag（HEAD∩非main祖先）→ 硬阻断" || no "应拦, EC=$EC"
echo "$OUT" | grep -q "不在 origin/main 上" && ok "报错指明 tag 未在 main 上" || no "报错文案不含 main 锚点: $(echo "$OUT" | grep -E '❌|V9' | head -2)"

# ── 场景C: tag 在 origin/main 上 → 放 ──
RC="$TMPD/rc"; mk "$RC"
git -C "$RC" tag V9.9.9 refs/remotes/origin/main
run_check "$RC"
[ "$EC" -eq 0 ] && ok "main 可达 tag → 通过" || no "main tag 被误拦: EC=$EC"

# ── 降级: origin/main 不可解析 → 显式降级跳过收窄段 ──
RD="$TMPD/rd"; mk "$RD"
git -C "$RD" update-ref -d refs/remotes/origin/main
git -C "$RD" -c user.name=t -c user.email=t@t commit -q --allow-empty -m feat
git -C "$RD" tag V9.9.9 HEAD
run_check "$RD"
[ "$EC" -eq 0 ] && ok "origin/main 缺失 → 降级不拦（沙箱/离线语义）" || no "缺失 origin/main 误拦: EC=$EC"
echo "$OUT" | grep -q "origin/main 不可解析" && ok "降级显式提示（铁律 11 不静默）" || no "缺降级提示"

# ═══════════════════════════════════════════════════════════════
# D1243（卡 #1312）: **第二段**（VERSION.md 最新版本）的孤儿豁免 —— 与第一段对齐
#   病灶: 第一段有 `|| continue` 孤儿豁免，第二段**没有** ⇒ VERSION.md 版本号全局唯一 ⇒
#     本机任一**同名孤儿 tag** ⇒ 全机/全分支/任何 push 全红（D520 实证 ×3，全队 4 人各删过本地 tag）。
#   共享真值 vs 本机残留: 「本地有 tag」= 本机私有状态；「远端有 / 是 HEAD 祖先」= 共享真值 ⇒
#     判定不得把**本机残留**当作对**他人**的阻断理由（`ls-remote` 权威查询，范式同 D1219）。
#   方向: feature ⇒ 孤儿与「tag 未打」同判（黄色中间态）；main ⇒ 仍硬阻断（锚点断裂是客观事实）。
# ═══════════════════════════════════════════════════════════════
echo ""
echo "── D1243 第二段孤儿豁免（本机残留 vs 共享真值）──"

# stdin 喂 pre-push 的 ref 行（第 3 字段 = remote ref ⇒ 决定 PUSH_BRANCH）；
#   ⚠️ 不能靠环境变量 PUSH_BRANCH —— 脚本会从 stdin 重算并**覆盖**它（本夹具首跑即踩）。
mk_orphan() { # <dir> — base + origin/main + VERSION.md(V9.9.9) + feat + **同名孤儿 tag**
  local R="$1"; mkdir -p "$R/.codex/control-tower"
  git -C "$R" init -q
  git -C "$R" -c user.name=t -c user.email=t@t commit -q --allow-empty -m base
  git -C "$R" update-ref refs/remotes/origin/main HEAD
  printf '## V9.9.9 (test)\n' > "$R/.codex/control-tower/VERSION.md"
  git -C "$R" -c user.name=t -c user.email=t@t commit -q --allow-empty -m feat
  local O; O=$(git -C "$R" commit-tree "$(git -C "$R" rev-parse HEAD^{tree})" -m orphan-blob)
  git -C "$R" tag V9.9.9 "$O"          # 孤儿: 非 HEAD 祖先（第二段原先在此拦死）
}
run_push() { # <repo> <branch> → OUT + EC（stdin 喂 refs/heads/<branch>）
  local R="$1" B="$2" S; S="$(git -C "$R" rev-parse HEAD)"
  OUT=$(printf 'refs/heads/%s %s refs/heads/%s %s\n' "$B" "$S" "$B" "$S" | (cd "$R" && SYNO_TAG_ONLY=1 bash "$PP" 2>&1)); EC=$?
}

# ── 场景 E（本卡新增·正向）: 同名孤儿 tag + **feature** 推送 → 黄（不阻断）──
RE="$TMPD/re"; mk_orphan "$RE"
run_push "$RE" "feat/x"
[ "$EC" -eq 0 ] && ok "E 本机孤儿 tag + feature 推送 → 不阻断（EC=0，黄）" || no "E 本机孤儿仍被拦: EC=${EC}（第二段缺豁免）"
echo "$OUT" | grep -q "本机孤儿 tag" && ok "E 报文点名「本机孤儿 tag」（不再让人以为是副作用）" || no "E 未点名孤儿"
echo "$OUT" | grep -qE "自证: 已推送=.*HEAD 祖先=否" && ok "E 自证在位（已推送/HEAD 祖先/远端态）" || no "E 缺自证"
echo "$OUT" | grep -q "解除: git tag -d V9.9.9" && ok "E 给「解除命令」（原先不给 ⇒ 无人敢删他人 tag）" || no "E 缺解除命令"
echo "$OUT" | grep -q "孤儿 tag 已豁免: 第一段 + VERSION.md 段" && ok "E 文案名副其实（点名豁免范围 + 清单）" || no "E 文案仍自相矛盾"
# 兼容锁（D1243）: tag-bypass-wiring.test.sh（他线夹具）按字面量「孤儿 tag 已豁免」断言「豁免要说出来」
#   ⇒ 本卡改真行为 + 保留该措辞 ⇒ 零跨线改动；此处钉住该子串，防后人再改坏他线夹具。
echo "$OUT" | grep -q "孤儿 tag 已豁免" && ok "E 兼容锁: 保留子串「孤儿 tag 已豁免」（他线夹具依赖）" || no "E 丢掉了他线夹具依赖的子串"

# ── 场景 F（反例·**防纸老虎**）: 同场景但推 **main** → 仍须红 ──
run_push "$RE" "main"
[ "$EC" -eq 1 ] && ok "F 反例: 同场景推 main → 仍硬阻断（EC=1，锚点断裂是客观事实）" || no "F 把判据放宽了: main 未拦住 EC=$EC"
echo "$OUT" | grep -q "main 上不做孤儿豁免" && ok "F 报文说明 main 侧不豁免（方向显式）" || no "F 未说明 main 侧方向"

# ── 场景 G（共享真值 vs 本机残留 —— 卡面要求"把这条线画出来"）──
#   造一个**真实可查的 origin**（本地 bare 仓）: 未推 tag ⇒ ls-remote --exit-code 返 2 ⇒「远端确无」
RG="$TMPD/rg"; BARE="$TMPD/rg-origin.git"; git init -q --bare "$BARE"; mk_orphan "$RG"
git -C "$RG" remote add origin "$BARE"
git -C "$RG" push -q origin HEAD:refs/heads/feat/x >/dev/null 2>&1
run_push "$RG" "feat/x"
[ "$EC" -eq 0 ] && ok "G 远端可查且**无**该 tag → 判「本机独有」仍不阻断（EC=0）" || no "G 误拦本机残留: EC=$EC"
echo "$OUT" | grep -q "本机独有" && ok "G 报文区分「远端确无 ⇒ 本机独有」（不把空/失败混为一谈）" || no "G 未区分远端确无"
#   反向: 把 tag 真的推到 origin ⇒ 共享真值「远端存在」（feature 侧仍不阻断，但报文须变）
git -C "$RG" push -q origin refs/tags/V9.9.9 >/dev/null 2>&1
run_push "$RG" "feat/x"
[ "$EC" -eq 0 ] && ok "G′ 远端**有**该 tag（共享真值）→ feature 侧仍不阻断（EC=0）" || no "G′ 共享态误拦: EC=$EC"
echo "$OUT" | grep -q "远端\*\*存在\*\*" && ok "G′ 报文改判「远端存在（共享 tag）」—— 两态可区分" || no "G′ 未区分远端存在"

# ── 场景 H（变异体·改坏即红）: 去掉孤儿豁免 ⇒ 场景 E 重回红 ──
MUT="$TMPD/pre-push-mutant.sh"
python3 - "$PP" "$MUT" <<'PY'
import pathlib, sys
src, dst = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[2]
marker = "# 🔴 孤儿（tag 存在但非 HEAD 祖先）"
cond = 'if [[ -n "${PUSH_BRANCH:-}" && "$PUSH_BRANCH" != "main" ]]; then'
i = src.index(marker); j = src.index(cond, i)
pathlib.Path(dst).write_text(src[:j] + "if false; then" + src[j + len(cond):], encoding="utf-8")
PY
if [ -s "$MUT" ]; then
  ok "H 变异体已生成（第二段孤儿豁免被去掉）"
  OUT=$(printf 'refs/heads/feat/x %s refs/heads/feat/x %s\n' "$(git -C "$RE" rev-parse HEAD)" "$(git -C "$RE" rev-parse HEAD)" | (cd "$RE" && SYNO_TAG_ONLY=1 bash "$MUT" 2>&1)); EC=$?
  [ "$EC" -eq 1 ] && ok "H 变异体: 去掉豁免 ⇒ 场景 E 重回红（EC=1，夹具判据承重）" || no "H 变异体未变红: EC=${EC}（夹具不判别）"
else
  no "H 变异体生成失败（判据不被检验）"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
