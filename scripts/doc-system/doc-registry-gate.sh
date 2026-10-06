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
REG=$(cat "$REGISTRY")

EXCLUDE='^tmp/|\.claude/|memory/|docs/plans/codex/implementation/|docs/synova/audit-reports/|docs/authority/chronicle-drafts/|docs/synova/DASHBOARD.*\.md$|/archive/|/Archive/|docs/synova/product-lines/evidence/'

FAIL=0; CHECKED=0
check_file() { # $1 = 相对路径
  local rel="$1"
  [ -z "$rel" ] && return
  [ "$rel" = "docs/authority/DOCS-REGISTRY.yaml" ] && return   # 台账自身（自引用）
  [[ "$rel" =~ $EXCLUDE ]] && return   # 纯内建正则（外部 grep 在 SYSTEM 会话下每文件 ~75ms）
  CHECKED=$((CHECKED+1))
  local base="${rel##*/}"
  if [[ "$REG" == *"$rel"* ]] || [[ "$REG" == *"$base"* ]]; then
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

# ═══ CT-D2 自洽检查（D1177）: 台账自身的 ID 唯一 + path 存在 ═══════════════════
# 背景: 原门禁**只做 substring 登记判定**（`[[ "$REG" == *"$rel"* ]]`），**从不校验台账自身**
#   ⇒ 重复 ID / 悬空 path 可以长期存在而无人知（实测: 59 条目里 **2 个重复 ID**、
#      **3 个仓内相对 path 不存在**）。本段补这两条。
# 🔴 判据设计（避免 D734 式"把存量债一次性转红"）:
#   · ID 唯一 —— **硬**（实测只有 2 个重复，已在本卡内修掉 ⇒ 从第 1 天起就是绿的）
#   · path 存在 —— **只查「仓内相对路径」**：绝对路径 / `~` / 盘符（`D:\…`）**不适用仓内存在性**，跳过；
#     含 glob（`*`）的 path **先展开**再判（`WORKLOG-*.md` 是真实形态）。
#   · 两条都不引入"基线豁免表"——没有存量债就没有豁免表（棘轮台账只减不增，别新开一张）。
SELF_FAIL=0
IDS="$(printf '%s\n' "$REG" | sed -n 's/^[[:space:]]*-[[:space:]]*id:[[:space:]]*"\([^"]*\)".*/\1/p; s/^[[:space:]]*-[[:space:]]*id:[[:space:]]*\([^"[:space:]]*\).*/\1/p')"
ID_TOTAL="$(printf '%s\n' "$IDS" | grep -c . || true)"
DUP_IDS="$(printf '%s\n' "$IDS" | grep . | sort | uniq -d || true)"
if [ -n "$DUP_IDS" ]; then
  echo "  ❌ 台账 ID 重复（应唯一）:"
  printf '%s\n' "$DUP_IDS" | while IFS= read -r d; do
    [ -z "$d" ] && continue
    echo "       · $d 出现 $(printf '%s\n' "$IDS" | grep -c "^${d}$") 次"
  done
  SELF_FAIL=$((SELF_FAIL+1))
else
  echo "  ✅ 台账 ID 唯一（$ID_TOTAL 个）"
fi

# 🔴 逐条取 (status, path) —— **status 参与判定**：
#   `status: draft` = **尚未编写的规划文档**，path 悬空是**预期**（不是缺陷）⇒ 显式打印 SKIP，
#   **不静默、也不判红**（与本线 P3 的 R3 SKIP 同一纪律：跳过必须说出来）。
#   其余 status（active/archived/…）悬空 ⇒ **红**。
P_CHECKED=0; P_MISSING=0; P_DRAFT_SKIP=0
while IFS=$'\t' read -r st rel; do
  [ -z "$rel" ] && continue
  case "$rel" in
    /*|~*|[A-Za-z]:*) continue ;;            # 绝对 / home / 盘符 ⇒ 不适用仓内存在性
  esac
  if [ "$st" = "draft" ]; then
    if [ ! -e "$ROOT/$rel" ]; then
      echo "  ⏭️  台账 path 悬空，但 status=draft（规划中，预期未建）: $rel"
      P_DRAFT_SKIP=$((P_DRAFT_SKIP+1)); continue
    fi
  fi
  case "$rel" in
    *'*'*)                                  # glob: 展开后再判（无匹配 ⇒ 悬空）
      # shellcheck disable=SC2086
      set -- $ROOT/$rel
      if [ -e "$1" ]; then P_CHECKED=$((P_CHECKED+1)); else
        echo "  ❌ 台账 path 悬空（glob 无匹配）: $rel"; P_MISSING=$((P_MISSING+1)); fi
      continue ;;
  esac
  P_CHECKED=$((P_CHECKED+1))
  [ -e "$ROOT/$rel" ] || { echo "  ❌ 台账 path 悬空: $rel"; P_MISSING=$((P_MISSING+1)); }
done < <(printf '%s\n' "$REG" | awk '
  # 🔴 顺序无关：**在新条目出现时才 flush 上一条**。
  #   原实现"path 之后遇到任意其它行就打印"在 `status:` 排在 `path:` **之后**的条目上
  #   会把 status 读成空 ⇒ 整段静默失效（实测: 59 条全 status 空 ⇒ 查 0 条）。
  function flush() { if (path != "") print st "\t" path }
  /^[[:space:]]*-[[:space:]]*id:/ { flush(); st=""; path=""; next }
  /^[[:space:]]*status:/ { v=$0; sub(/^[[:space:]]*status:[[:space:]]*/,"",v); gsub(/"/,"",v); st=v; next }
  /^[[:space:]]*path:/   { v=$0; sub(/^[[:space:]]*path:[[:space:]]*/,"",v); gsub(/^"|"$/,"",v); path=v; next }
  END { flush() }
')
if [ "$P_MISSING" -eq 0 ]; then
  echo "  ✅ 台账仓内 path 全存在（查 $P_CHECKED 条；绝对/~ /盘符已跳过；draft 悬空 $P_DRAFT_SKIP 条已显式 SKIP）"
else
  echo "  ❌ 台账 path 悬空 $P_MISSING 条（共查 $P_CHECKED 条；另有 draft 悬空 $P_DRAFT_SKIP 条已显式 SKIP）"
  SELF_FAIL=$((SELF_FAIL+1))
fi
FAIL=$((FAIL+SELF_FAIL))

# ═══ D3 双真源一致性（D1178）: doc-registry.json 自洽 + 与 YAML 台账交叉 ═══════════
# 🔴 前提更正（判例 P-01: 先核派单方的配方再照做）:
#   派单原文是「双真源 ⇒ **合并**」。**实测两个源近乎不相交（交集 = 1 条）** —— 它们**用途不同**:
#     · docs/authority/DOCS-REGISTRY.yaml  = **登记台账**（59 条；本门禁消费）
#     · scripts/control-tower/doc-registry.json = **权威文档短名 → 路径**（18 docs + 16 aliases；inject-context.py 消费）
#   ⇒ 强行"合并"会把 `inject-context.py` 的消费面打断，**且解决不了一个真实存在的问题**。
#   真正的问题是: **两个源互不校验** —— 任一方写错都无人知（JSON 今天恰好是干净的: 18/18 path 存在、
#   16/16 alias 指向真实 key，但**没有任何检查**保证它明天还是）。⇒ 本段补**交叉一致性**，不合并。
SELF_BEFORE=$SELF_FAIL   # 只把 **D3 段的增量** 计入 FAIL（否则 D2 的失败会被重复计一次）
JSON_REG="$ROOT/scripts/control-tower/doc-registry.json"
if [ -f "$JSON_REG" ]; then
  PYBIN=""
  for _c in python3 python py; do command -v "$_c" >/dev/null 2>&1 && { PYBIN="$_c"; break; }; done
  if [ -z "$PYBIN" ]; then
    echo "  ⚠️ 降级: 无 python 可用 ⇒ doc-registry.json 一致性检查跳过（显式留痕，不静默）"
  else
    D3_OUT="$("$PYBIN" - "$JSON_REG" "$ROOT" "$REGISTRY" <<'PYEOF2' 2>&1
import json, os, re, sys
jp, root, yp = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    d = json.load(open(jp, encoding="utf-8"))
except Exception as e:
    print("FAIL	JSON 解析失败: %s" % e); sys.exit(0)
docs = d.get("docs") or {}; al = d.get("aliases") or {}
fails = []
for k, v in docs.items():
    if not os.path.exists(os.path.join(root, v.rstrip("/"))):
        fails.append("docs[%s] 路径不存在: %s" % (k, v))
for k, v in al.items():
    if v not in docs:
        fails.append("aliases[%s] 指向不存在的 docs key: %s" % (k, v))
# 交叉: 两源同一条路径时必须逐字一致（当前交集只有 1 条，但规则要立住）
try:
    ytxt = open(yp, encoding="utf-8").read()
except Exception:
    ytxt = ""
ypaths = set(re.findall(r'^\s*path:\s*"([^"]+)"', ytxt, re.M)) | \
         set(re.findall(r'^\s*path:\s*([^"\s].*?)\s*$', ytxt, re.M))
inter = set(v for v in docs.values()) & ypaths
if fails:
    for f in fails: print("FAIL	%s" % f)
else:
    print("OK	docs %d 条 path 全存在；aliases %d 条全指向真实 key；与 YAML 交集 %d 条（逐字一致）"
          % (len(docs), len(al), len(inter)))
PYEOF2
)"
    if printf '%s' "$D3_OUT" | grep -q '^FAIL'; then
      printf '%s\n' "$D3_OUT" | while IFS=$'\t' read -r _ msg; do
        [ -n "$msg" ] && echo "  ❌ 双真源: $msg"
      done
      SELF_FAIL=$((SELF_FAIL+1))
    else
      echo "  ✅ 双真源: $(printf '%s' "$D3_OUT" | sed 's/^OK\t//')"
    fi
  fi
else
  echo "  ⏭️  双真源: doc-registry.json 不存在 ⇒ SKIP（显式，不冒充通过）"
fi
FAIL=$((FAIL + SELF_FAIL - SELF_BEFORE))   # 只加 D3 段的增量（SELF_FAIL 的 D2 部分已在上面计过）

echo "── 汇总: 检查 $CHECKED 个文档，$FAIL 个未登记 ──"
if [ "$FAIL" -eq 0 ]; then echo "  ✅ 登记门禁通过"; exit 0; else echo "  ❌ 登记门禁阻断"; exit 1; fi
