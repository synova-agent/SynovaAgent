#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# doc-registry-gate.sh — 登记门禁（治理机制 #1，GOVERNANCE.md）
#
# 契约（铁律 47 契约优先）:
#   输入:  环境 DOC_TRUTH_ROOT 覆盖仓库根（测试用）
#          git 仓库 → **三源并集**：
#            ① untracked（`git ls-files --others --exclude-standard`）
#            ② staged-new（`git diff --cached --diff-filter=A`）
#            ③ **base..HEAD 新增**（CT-D2 新增；`git diff --diff-filter=A <merge-base>..HEAD`）
#          非 git（测试 fixture）→ 全量扫描模式
#   输出:  每文件 ✅/❌ + 扫描源行 + 汇总（**必打印检查数 N**）；
#          任一未登记 → exit 1（硬阻断）；全部登记 → exit 0
#   降级:  DOCS-REGISTRY.yaml 缺失 → ⚠️ 警告 exit 0（台账未建立不阻断）
#          base 全链不可解析 / merge-base 为空 → ⚠️ **显式降级**：源③跳过但**打印留痕**
#          （沿用 pre-push 门禁 0-1 与 check-pr-budget.sh 对「fetch 失败」的既有语义：
#            环境性缺 ref 不把所有 PR 误打成红，但绝不静默——留痕行即证据）
#
# 排除（生成物/历史区/**运行期产物**，无需登记）:
#   - docs/synova/DASHBOARD*.md（自动生成）
#   - 路径含 /archive/ 或 /Archive/（历史归档，只读）
#   - docs/synova/product-lines/evidence/（CT-D2 2026-09-28：任务级 M5 自验证据，
#     **运行期产物口径**，与 DASHBOARD*.md 同类。**只豁免、不登记**——避免双真相源。
#     依据：实测该目录 tracked 文档持续增长（本次实测 30 件，全仓口径 113 件），
#     逐条登记会使每个任务都要改**共享**的 DOCS-REGISTRY.yaml（写冲突机器），
#     且证据是"任务证明"而非"权威文档"，登记不产生真相价值。）
#
# CT-D2（2026-09-28）修 fail-open —— 根因 → 修法 → 判据:
#   根因: 旧实现只取 ① ②。CI `actions/checkout`（fetch-depth: 0）后所有文件都已
#     tracked+committed ⇒ ①② **皆空** ⇒ 汇总「检查 0 个文档」⇒ FAIL=0 ⇒ 放行。
#     即：门禁只在**本地未提交态**有效，在**提交态从未真正行使**（fail-open）。
#   修法: 增源 ③ = 本分支 base..HEAD **新增**的文档；base 解析链 origin/main →
#     main → origin/HEAD（与 scripts/control-tower/check-pr-budget.sh 同口径）。
#     ⚠️ 不做"全仓 tracked 全量登记"：实测全仓 tracked .md/.yaml 过现有排除后仍有
#     **872 件候选、其中 751 件未登记**（台账仅 39 条、面向权威文档）⇒ 全量口径会
#     把每个 PR 都判红。故范围严格限定为"**本分支新增**"（与门禁本来的语义一致）。
#   判据: 纯 tracked 仓库（无 untracked/staged）+ 分支新增未登记文档 ⇒
#     必须「检查 N 个文档」且 N>0、exit 1（见 tests/doc-system/doc-registry-gate.test.sh 用例 H）。
# ═══════════════════════════════════════════════════════════════════════════════
set +e
ROOT="${DOC_TRUTH_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" # swallow-ok:
REGISTRY="$ROOT/docs/authority/DOCS-REGISTRY.yaml"
[ -f "$REGISTRY" ] || { echo "  ⚠️ 降级: DOCS-REGISTRY.yaml 不存在，跳过登记检查（exit 0）"; exit 0; }

# ── D1136 ④a（K3 采纳）: 台账自身查重 —— 重复 id / 重复 path ⇒ 硬阻断并点名 ──
#   背景: 本台账历史注释（原 283-284 行）自述「登记门禁不校 id 唯一，靠人工守」= 已知缺口。
#   口径: id 与 path 各自**逐字**去重（不做大小写/空白规范化）；重复即 exit 1（fail-closed）。
_DUP_IDS=$(grep -E '^[[:space:]]*(-[[:space:]]*)?id:[[:space:]]*' "$REGISTRY" 2>/dev/null \
           | sed -E 's/^[[:space:]]*(-[[:space:]]*)?id:[[:space:]]*//' | sed -E 's/[[:space:]]+$//' \
           | grep -v '^$' | sort | uniq -d || true)
_DUP_PATHS=$(grep -E '^[[:space:]]*(-[[:space:]]*)?path:[[:space:]]*' "$REGISTRY" 2>/dev/null \
           | sed -E 's/^[[:space:]]*(-[[:space:]]*)?path:[[:space:]]*//' | sed -E 's/[[:space:]]+$//' \
           | grep -v '^$' | sort | uniq -d || true)
if [ -n "$_DUP_IDS" ] || [ -n "$_DUP_PATHS" ]; then
  echo "  ❌ 台账查重失败（D1136 ④a）:"
  [ -n "$_DUP_IDS" ] && echo "     重复 id:   $(printf '%s' "$_DUP_IDS" | tr '\n' ' ')"
  [ -n "$_DUP_PATHS" ] && echo "     重复 path: $(printf '%s' "$_DUP_PATHS" | tr '\n' ' ')"
  echo "  ❌ 登记门禁阻断（台账内部重复 ⇒ 先去重；见 docs/authority/DOCS-REGISTRY.yaml）"
  exit 1
fi

# ── D1136 ④b: 精确匹配（原为**整表子串匹配** ⇒ 不同目录同名文件互相顶替）──
#   原实现: `[[ "$REG" == *"$rel"* ]] || [[ "$REG" == *"$base"* ]]`
#     · `*"$rel"*`  → `docs/a/x.md` 会被 `docs/a/x.md.bak` 之类子串假命中
#     · `*"$base"*` → **更弱的洞（K3 交叉发现）**：不同目录同名文件互相顶替
#       （实测台账现有 4 条 `SKILL.md` ⇒ 新增未登记的 `new/dir/SKILL.md` 会被判「已登记」）
#   修法: 只与**登记表中的 path 值**做**逐字全行**匹配；basename 兜底**仅**允许命中
#         「登记表里本身就是裸文件名（不含 /）」的条目（如 INDEX.md），
#         这样既保留既有裸名登记，又彻底堵住跨目录顶替。
#   性能: 纯 bash 字符串精确匹配（预拼 `\n`+值+`\n`），零子进程（沿用原实现零 fork 的取向）。
REG_PATHS_NL=""
REG_BARE_NL=""
while IFS= read -r _p; do
  [ -z "$_p" ] && continue
  REG_PATHS_NL="${REG_PATHS_NL}${_p}"$'\n'
  case "$_p" in */*) ;; *) REG_BARE_NL="${REG_BARE_NL}${_p}"$'\n' ;; esac
done < <(grep -E '^[[:space:]]*(-[[:space:]]*)?path:[[:space:]]*' "$REGISTRY" 2>/dev/null \
         | sed -E 's/^[[:space:]]*(-[[:space:]]*)?path:[[:space:]]*//' | sed -E 's/[[:space:]]+$//' || true)
REG_PATHS_NL=$'\n'"${REG_PATHS_NL}"
REG_BARE_NL=$'\n'"${REG_BARE_NL}"

EXCLUDE='^tmp/|\.claude/|memory/|docs/plans/codex/implementation/|docs/synova/audit-reports/|docs/authority/chronicle-drafts/|docs/synova/DASHBOARD.*\.md$|/archive/|/Archive/|docs/synova/product-lines/evidence/'

FAIL=0; CHECKED=0
check_file() { # $1 = 相对路径
  local rel="$1"
  [ -z "$rel" ] && return
  [ "$rel" = "docs/authority/DOCS-REGISTRY.yaml" ] && return   # 台账自身（自引用）
  [[ "$rel" =~ $EXCLUDE ]] && return   # 纯内建正则（外部 grep 在 SYSTEM 会话下每文件 ~75ms）
  CHECKED=$((CHECKED+1))
  local base="${rel##*/}"
  if [[ "$REG_PATHS_NL" == *$'\n'"$rel"$'\n'* ]] || [[ "$REG_BARE_NL" == *$'\n'"$base"$'\n'* ]]; then
    echo "  ✅ 已登记: $rel"
  else
    echo "  ❌ 未登记: $rel （请加入 docs/authority/DOCS-REGISTRY.yaml）"
    FAIL=$((FAIL+1))
  fi
}

if git -c safe.directory="$ROOT" -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  # ── CT-D2 源③：base 解析链 + merge-base..HEAD 新增文档 ──
  BASE_REF=""
  for _cand in origin/main main origin/HEAD; do
    if git -c safe.directory="$ROOT" -C "$ROOT" rev-parse --verify --quiet "$_cand" >/dev/null 2>&1; then BASE_REF="$_cand"; break; fi
  done
  MERGE_BASE=""
  [ -n "$BASE_REF" ] && MERGE_BASE="$(git -c safe.directory="$ROOT" -C "$ROOT" merge-base "$BASE_REF" HEAD 2>/dev/null)" # swallow-ok: merge-base 失败即降级（下一分支显式留痕），不改判定
  ADDED_VS_BASE=""
  if [ -n "$MERGE_BASE" ]; then
    ADDED_VS_BASE="$(git -c safe.directory="$ROOT" -C "$ROOT" diff --name-only --diff-filter=A "$MERGE_BASE"..HEAD 2>/dev/null)" # swallow-ok: diff 失败即源③为空（扫描源行已留痕），不改判定
  elif [ -n "$BASE_REF" ]; then
    echo "  ⚠️ 降级: merge-base($BASE_REF, HEAD) 为空 → 源③（base..HEAD 新增）跳过（显式留痕，不静默）"
  else
    echo "  ⚠️ 降级: base 全链不可解析（尝试过 origin/main / main / origin/HEAD）→ 源③（base..HEAD 新增）跳过（显式留痕，不静默；请先 git fetch origin）"
  fi
  echo "  ℹ️ 扫描源: ① untracked ② staged-new ③ base..HEAD 新增（base=${BASE_REF:-不可解析} merge-base=${MERGE_BASE:0:8}）"
  # untracked 新增 + staged 新增（git add 过、未提交）都要登记；
  # 提交场景靠 staged 集合（git add 后文件不再出现在 ls-files --others）；
  # **CI/纯提交态靠源③**（①② 皆空时仍能扫到本分支新增的文档 —— CT-D2 修 fail-open）
  while IFS= read -r rel; do check_file "$rel"; done < <({ git -c safe.directory="$ROOT" -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null; git -c safe.directory="$ROOT" -C "$ROOT" diff --cached --name-only --diff-filter=A 2>/dev/null; printf '%s\n' "$ADDED_VS_BASE"; } | grep -E '\.(md|yaml)$' | sort -u) # swallow-ok:
else
  echo "  ℹ️ 扫描源: 全量 find（非 git 模式）"
  while IFS= read -r rel; do check_file "$rel"; done < <(find "$ROOT" -type f \( -name '*.md' -o -name '*.yaml' \) 2>/dev/null | sed "s|^$ROOT/||") # swallow-ok:
fi

echo "── 汇总: 检查 $CHECKED 个文档，$FAIL 个未登记 ──"
if [ "$FAIL" -eq 0 ]; then echo "  ✅ 登记门禁通过"; exit 0; else echo "  ❌ 登记门禁阻断"; exit 1; fi
