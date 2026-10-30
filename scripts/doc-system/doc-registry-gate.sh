#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# doc-registry-gate.sh — 登记门禁（治理机制 #1，GOVERNANCE.md）
#
# 契约（铁律 47 契约优先）:
#   输入:  环境 DOC_TRUTH_ROOT 覆盖仓库根（测试用）
#          git 仓库 → **三源并集**：
#            ① untracked（`git ls-files --others --exclude-standard`）—— ⚠️ 2026-10-12 起
#               **仅警告不阻断**（CTO P0 裁定: untracked 无法区分"本 PR 的"与"别人的"；
#               判据: 未在本 PR 里的 untracked 文件不得阻断）
#            ② staged-new（`git diff --cached --diff-filter=A`）
#            ③ **base..HEAD 新增**（CT-D2 新增；`git diff --diff-filter=A <merge-base>..HEAD`；
#               base 链前置 gitea 侧真源：gitea/$TRUNK → 本地 $TRUNK；origin 侧引用
#               可能陈旧不作首选 —— 同 check-pr-budget.sh bug 1；$TRUNK=SYNO_TRUNK_REF 缺省 main）
#          非 git（测试 fixture）→ 全量扫描模式
#   输出:  每文件 ✅/❌ + 扫描源行 + 汇总（**必打印检查数 N**）；
#          **唯一性（#942）**：`- id: DOC-<n>` 重号 → 逐条点名 `❌ 重号: DOC-<n>（出现 k 次）`，并 exit 1
#          （唯一性是硬判据，**不得只告警**）
#          **存活（#976）**：`status: active` 且 `path` 不在树内 → 逐条点名 `❌ 存活失配: DOC-<n> path 不存在`，
#          并 exit 1；`status: active` 但**无 path 字段**同样红（否则删掉 path 行即可绕过）；
#          path 含通配（如 `WORKLOG-*.md`）按**字面路径**判 —— 通配不是"存在的文件"，不能算活
#          任一未登记 → exit 1（硬阻断）；全部登记 → exit 0
#          **编号 R1/R2（#1123 批1）**：新登记 DOC 条目 id 必须 `DOC-<Issue#>` 或 `DOC-<Issue#>-NN`；
#            来源须可派生（front-matter `任务: "#N"` 或文件名含 `-<N>-`），两处皆无 ⇒ 逐条点名 exit 1；
#            存量 `DOC-0xxx` 按基线冻结（跳过，不因形态不合红）；非 DOC- 前缀 id（夹具）不参与
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
#   修法: 增源 ③ = 本分支 base..HEAD **新增**的文档；base 解析链
#     **gitea/$TRUNK → $TRUNK → origin/$TRUNK → origin/main → main → origin/HEAD**
#     （2026-10-29 主树迁 main：$TRUNK = `${SYNO_TRUNK_REF:-main}`；gitea 侧为真源，
#      `origin/main` 停在 5a6591c4a ⇒ 不前置会把 73+ 个他线已合并提交算进本 PR）。
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

# ── 唯一性（#942）：`- id: DOC-<n>` 重号即红、逐条点名（不是告警）──
# F1（fail-closed）：正则容**可选引号**（DOC-0255 / "DOC-0255" / 'DOC-0255'）；
#   解析到 0 条 ⇒ 打印「不可见」并 exit 2 —— 禁把"看不见"当"没问题"（#942 F1）。
DOC_ID_RE="^[[:space:]]*-[[:space:]]*id:[[:space:]]*[\"']?DOC-[0-9]+(-[0-9]{2})?[\"']?"
TOTAL_DOC_IDS=$(grep -cE "$DOC_ID_RE" "$REGISTRY")
TOTAL_DOC_IDS=${TOTAL_DOC_IDS:-0}
if [ "$TOTAL_DOC_IDS" -eq 0 ]; then
  echo "  ❌ 不可见: 台账中解析到 0 条 DOC id（正则失配或台账结构变更）"
  echo "  ❌ 登记门禁阻断（唯一性检查不可执行 ⇒ fail-closed exit 2；禁把不可见当没问题）"
  exit 2
fi
DUP_IDS=$(grep -oE "$DOC_ID_RE" "$REGISTRY" | sed -E 's/.*(DOC-[0-9]+(-[0-9]{2})?).*/\1/' | sort | uniq -d)
DUPFAIL=0
if [ -n "$DUP_IDS" ]; then
  while IFS= read -r _dup; do
    [ -z "$_dup" ] && continue
    # F2（计数失真）：去「严格行尾」锚，改「右边界=非数字后随任意内容」——
    #   既容行尾注释/引号，又不让 DOC-025 误配 DOC-0256（与检出正则同口径）。
    _n=$(grep -cE "^[[:space:]]*-[[:space:]]*id:[[:space:]]*[\"']?${_dup}[\"']?([[:space:]]+#.*)?$" "$REGISTRY")
    echo "  ❌ 重号: ${_dup}（出现 ${_n} 次）"
    DUPFAIL=$((DUPFAIL+1))
  done <<< "$DUP_IDS"
fi

# ── 存活（#976）：`status: active` 且 `path` 不在树内 ⇒ 红、逐条点名 ──
# 背景（K3 #974 D2）: 旧实现只查「**新增**文档是否登记」，**不查已登记的是否还在**
#   ⇒ 台账可长期指向不存在的路径。实测（改造前 27e3433f1）: 138 条 entry 中 33 条 path
#   不在树内，其中 **24 条 status=active**（如 DOC-0121 `CTO-派单规程.md`、DOC-0190 参数清单）。
# 口径: `status: active` = 「现在还在用的文档」⇒ `path` 必须存在于树内（相对仓库根的**字面**路径）。
#   历史件走 `archived` / `superseded` / `draft`（**降级不删条目**：身份证 id 与 note 保留可追溯）。
#   通配（`WORKLOG-*.md`）按字面判 —— 它不是"存在的文件"，不能当活件；要保留语义须改口径再来。
# 判据: active ∧ [ ! -e "$ROOT/$path" ] ⇒ 逐条点名 + exit 1；active ∧ 无 path 字段 ⇒ 同样红。
# fail-closed（三态码 2）: 台账里**一条 status 字段都解析不到** ⇒ 存活检查不可执行 ⇒ exit 2
#   —— 禁把"看不见"当"没问题"（与 #942 F1「0 条 DOC id ⇒ exit 2」同口径）。
STATUS_FIELDS=$(grep -cE '^[[:space:]]+status:[[:space:]]*[A-Za-z]' "$REGISTRY")
STATUS_FIELDS=${STATUS_FIELDS:-0}
if [ "$STATUS_FIELDS" -eq 0 ]; then
  echo "  ❌ 不可见: 台账中解析到 0 条 status 字段（schema 变更或解析失配）"
  echo "  ❌ 登记门禁阻断（存活检查不可执行 ⇒ fail-closed exit 2；禁把不可见当没问题）"
  exit 2
fi
ALIVE_TOTAL=0; ALIVE_FAIL=0
# 逐条 entry 抽 id/path/status（纯 awk，单次遍历；`- id:` 起条目，其后到下一个 `- id:` 属本条目）
while IFS=$'\t' read -r _aid _apath; do
  [ -z "$_aid" ] && continue
  ALIVE_TOTAL=$((ALIVE_TOTAL+1))
  if [ "$_apath" = "<NO-PATH>" ]; then
    echo "  ❌ 存活失配: ${_aid} status=active 但条目无 path 字段"
    ALIVE_FAIL=$((ALIVE_FAIL+1))
  elif [ ! -e "$ROOT/$_apath" ]; then
    echo "  ❌ 存活失配: ${_aid} path 不存在: ${_apath} （降 status 为 archived/superseded，或修 path）"
    ALIVE_FAIL=$((ALIVE_FAIL+1))
  fi
done <<< "$(awk '
  # clean(): 去引号 + 去行尾注释 + 去尾空格（`status: "active"` / `path: a.md  # 说明`）
  function clean(s) { gsub("\047", "", s); gsub("\"", "", s); sub(/[[:space:]]+#.*$/, "", s); sub(/[[:space:]]+$/, "", s); return s }
  function emit() { if (id != "" && st == "active") printf "%s\t%s\n", id, (p == "" ? "<NO-PATH>" : p) }
  {
    line = $0
    if (line ~ /^[[:space:]]*-[[:space:]]*id:/) {
      emit()
      id = line; sub(/^[[:space:]]*-[[:space:]]*id:[[:space:]]*/, "", id)
      st = ""; p = ""
    } else if (id != "") {
      if (line ~ /^[[:space:]]+path:/) { p = line; sub(/^[[:space:]]+path:[[:space:]]*/, "", p) }
      else if (line ~ /^[[:space:]]+status:/) { st = line; sub(/^[[:space:]]+status:[[:space:]]*/, "", st) }
    }
    id = clean(id); p = clean(p); st = clean(st)
  }
  END { emit() }
' "$REGISTRY")"

# 🔴 2026-10-11 增 `extensions/` 内容数据豁免（创始人裁定）:
#   本门禁的语义是**文档台账**（`type ∈ [navigation…archive]`，面向权威文档），
#   而 `extensions/**/*.yaml|yml` 是**内容面数据/配置**，**不是文档** ⇒ 登记它不产生真相价值。
#   逐条登记的反面代价与既有先例同型（见下方 `docs/synova/product-lines/evidence/` 条目注释：
#   「逐条登记会使每个任务都要改**共享**的 DOCS-REGISTRY.yaml（写冲突机器）」）。
#   ⚠️ 豁免**只限 `.yaml|.yml`，不含 `.md`** —— `extensions/` 下的 `.md` 是说明文档，仍须登记。
#   实测依据: 批 2 三张 PR 因 3/3/12 件扩展内容 yaml 被判"未登记"而 CI 硬红（run 116/121/125）。
EXCLUDE='^tmp/|\.claude/|memory/|docs/plans/codex/implementation/|docs/synova/audit-reports/|docs/authority/chronicle-drafts/|docs/synova/DASHBOARD.*\.md$|/archive/|/Archive/|docs/synova/product-lines/evidence/|^extensions/.*\.(yaml|yml)$'

FAIL=0; CHECKED=0
check_file() { # $1 = 相对路径；$2 = 可选 "warn"（仅警告不阻断，用于 untracked 源①）
  local rel="$1" mode="${2:-}"
  [ -z "$rel" ] && return
  [ "$rel" = "docs/authority/DOCS-REGISTRY.yaml" ] && return   # 台账自身（自引用）
  [[ "$rel" =~ $EXCLUDE ]] && return   # 纯内建正则（外部 grep 在 SYSTEM 会话下每文件 ~75ms）
  CHECKED=$((CHECKED+1))
  local base="${rel##*/}"
  if [[ "$REG" == *"$rel"* ]] || [[ "$REG" == *"$base"* ]]; then
    echo "  ✅ 已登记: $rel"
  elif [ "$mode" = "warn" ]; then
    echo "  ⚠️ 未登记(仅警告,untracked): $rel"
  else
    echo "  ❌ 未登记: $rel （请加入 docs/authority/DOCS-REGISTRY.yaml）"
    FAIL=$((FAIL+1))
  fi
}

if git -c safe.directory="$ROOT" -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  # ── CT-D2 源③：base 解析链 + merge-base..HEAD 新增文档 ──
  # 🔴 2026-10-29 修 base 口径（#1117 主树迁 main；此前两次修订的病灶保留为历史依据）:
  #   ① 2026-10-11（创始人裁定；同病第三处）: 旧实现以 origin/main 作基，而 GitHub
  #     `origin/main` **停于 5a6591c4a**（且 origin 账号已 suspended）⇒ 源③ range 覆盖
  #     `5a6591c4a..HEAD` 的全部 **73+** 提交（**不只本 PR 改动**）⇒ 把他人已合并提交里
  #     新增的 .md/.yaml 一并索登记 ⇒ 每张 PR 恒红 ⇒ 故 base 必须前置真源。
  #   ② 2026-10-12（CTO P0 裁定，同 check-pr-budget.sh bug 1）: origin 侧引用同样陈旧
  #     （实测停于 28ae513dc，落后 gitea 侧 111 提交）⇒ 取它作 base ⇒ 源③ range 覆盖
  #     他人/历史的已提交文档（实例: 报「未登记: docs/synova/coordination/tools/准度计量口径-v1.md」，
  #     实为 a4cc8fd5f 已提交件）⇒ 修法 = gitea 侧真源前置，范围严格限定"本次 PR 的 diff"。
  #   ③ 本批: trunk 名由 `SYNO_TRUNK_REF`（缺省 `main`）单源给出；链 =
  #     gitea/$TRUNK → 本地 $TRUNK → origin/$TRUNK → origin/main → main → origin/HEAD。
  #   ⚠️ 单改 base **不足以**转绿（内容面 yaml 仍需豁免，见下方 EXCLUDE），两处须同时生效。
  #   口径对齐: `local-gates.yml` 的 ①d 步由 resolve-ci-base.sh 统一解析（同理由）。
  #   判据: 未在本 PR 里的 untracked 文件不得阻断（untracked 已降为警告，见下）。
  TRUNK="${SYNO_TRUNK_REF:-main}"
  BASE_REF=""
  for _cand in "gitea/$TRUNK" "$TRUNK" "origin/$TRUNK" origin/main main origin/HEAD; do
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
    echo "  ⚠️ 降级: base 全链不可解析（尝试过 gitea/$TRUNK / $TRUNK / origin/$TRUNK / origin/main / main / origin/HEAD）→ 源③（base..HEAD 新增）跳过（显式留痕，不静默；请先 git fetch --all）"
  fi
  echo "  ℹ️ 扫描源: ① untracked（仅警告，不阻断）② staged-new ③ base..HEAD 新增（base=${BASE_REF:-不可解析} merge-base=${MERGE_BASE:0:8}）"
  # 🔴 2026-10-12（CTO P0 裁定 bug 2）: 源① untracked 降为**仅警告**——
  #   工作区 untracked 无法区分"本 PR 的"与"别人/别的任务的"（判据: 造一个
  #   未在本 PR 里的 untracked 文件 ⇒ 门禁不得因此阻断）。硬阻断只看
  #   ② staged-new（git add 过 = 明确属于本次提交）与 ③ 本 PR diff 范围内新增。
  while IFS= read -r rel; do check_file "$rel" warn; done < <(git -c safe.directory="$ROOT" -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null | grep -E '\.(md|yaml)$' | sort -u) # swallow-ok:
  while IFS= read -r rel; do check_file "$rel"; done < <({ git -c safe.directory="$ROOT" -C "$ROOT" diff --cached --name-only --diff-filter=A 2>/dev/null; printf '%s\n' "$ADDED_VS_BASE"; } | grep -E '\.(md|yaml)$' | sort -u) # swallow-ok:
else
  echo "  ℹ️ 扫描源: 全量 find（非 git 模式）"
  while IFS= read -r rel; do check_file "$rel"; done < <(find "$ROOT" -type f \( -name '*.md' -o -name '*.yaml' \) 2>/dev/null | sed "s|^$ROOT/||") # swallow-ok:
fi

# ── 编号 R1/R2（#1123 批1）：新登记 DOC 条目的形态 + Issue 来源 ──
# R1 形态: `DOC-<Issue#>` 或 `DOC-<Issue#>-NN`（一卡多件，-NN 两位）
# R2 来源: front-matter `任务: "#N"` 或文件名含 `-<N>-`；两处皆无 ⇒ 红并点名
# R4 存量冻结: 基线（gitea/TRUNK → TRUNK → origin/main）已存在的 id 一律跳过；
#   夹具模式（无基线）下 `DOC-0xxx` legacy 形态同样跳过 —— 不因形态不合误伤存量
ID_CHECKED=0; ID_SKIPPED=0; ID_FAIL=0
BASE_IDS=""
for _ref in "gitea/${TRUNK:-main}" origin/main; do   # 只用远端真源：夹具仓只有本地 main，应走降级而非误判
  if git -c safe.directory="$ROOT" -C "$ROOT" rev-parse --verify -q "$_ref" >/dev/null 2>&1; then
    BASE_IDS="$(git -c safe.directory="$ROOT" -C "$ROOT" show "$_ref:docs/authority/DOCS-REGISTRY.yaml" 2>/dev/null | grep -E '^[[:space:]]*-[[:space:]]*id:' | grep -oE 'DOC-[0-9]+' | sort -u)" # swallow-ok:
    [ -n "$BASE_IDS" ] && break
  fi
done
if [ -z "$BASE_IDS" ] && [ "${SYNO_DOCID_CHECK:-0}" != "1" ]; then
  echo "  ⚠️ 降级: 无基线且未置 SYNO_DOCID_CHECK=1 → R1/R2 编号检查跳过（夹具/裸仓模式；显式留痕，不静默）"
else
while IFS=$'\t' read -r _did _dpath; do
  [ -z "$_did" ] && continue
  [ -z "$_dpath" ] && _dpath="<NO-PATH>"
  case "$_did" in DOC-*) : ;; *) continue ;; esac
  if [ -n "$BASE_IDS" ] && printf '%s\n' "$BASE_IDS" | grep -qxF "$_did"; then ID_SKIPPED=$((ID_SKIPPED+1)); continue; fi
  if [ -z "$BASE_IDS" ] && [[ "$_did" =~ ^DOC-0[0-9]{3}$ ]]; then ID_SKIPPED=$((ID_SKIPPED+1)); continue; fi
  ID_CHECKED=$((ID_CHECKED+1))
  if ! [[ "$_did" =~ ^DOC-[1-9][0-9]*(-[0-9]{2})?$ ]]; then
    echo "  ❌ [R1] 新登记 id 形态不合规: ${_did} （应为 DOC-<Issue#> 或 DOC-<Issue#>-NN）"
    ID_FAIL=$((ID_FAIL+1)); continue
  fi
  _src=""
  if [ "$_dpath" != "<NO-PATH>" ] && [ -f "$ROOT/$_dpath" ]; then
    _src="$(head -12 "$ROOT/$_dpath" 2>/dev/null | grep -oE '任务:[[:space:]]*"?[#N]*[0-9]+' | grep -oE '[0-9]+' | head -1)" # swallow-ok:
  fi
  if [ -z "$_src" ] && [ "$_dpath" != "<NO-PATH>" ]; then
    _src="$(printf '%s' "${_dpath##*/}" | grep -oE '(^|[-_])[0-9]{2,}([-_]|\.|$)' | grep -oE '[0-9]{2,}' | head -1)" # swallow-ok:
  fi
  if [ -z "$_src" ]; then
    echo "  ❌ [R2] 无法派生 Issue 来源: ${_did} （path=${_dpath}；front-matter 任务:\"#N\" 与文件名 -N- 均无）"
    ID_FAIL=$((ID_FAIL+1)); continue
  fi
  echo "  ✅ [R1/R2] ${_did} ← #${_src}"
done < <(awk '
  function clean(s) { gsub("\047", "", s); gsub("\"", "", s); sub(/[[:space:]]+#.*$/, "", s); sub(/[[:space:]]+$/, "", s); return s }
  function emit() { if (id != "") printf "%s\t%s\n", id, (p == "" ? "<NO-PATH>" : p) }
  {
    line = $0
    if (line ~ /^[[:space:]]*-[[:space:]]*id:/) { emit(); id = line; sub(/^[[:space:]]*-[[:space:]]*id:[[:space:]]*/, "", id); p = "" }
    else if (id != "" && line ~ /^[[:space:]]+path:/) { p = line; sub(/^[[:space:]]+path:[[:space:]]*/, "", p) }
    id = clean(id); p = clean(p)
  }
  END { emit() }
' "$REGISTRY")

fi

echo "── 唯一性: ${TOTAL_DOC_IDS} 条 DOC id，重号 ${DUPFAIL} 个 ──"
echo "── 存活: ${ALIVE_TOTAL} 条 status=active，path 失配 ${ALIVE_FAIL} 个（status 字段 ${STATUS_FIELDS} 条）──"
echo "── 编号: 新条目 ${ID_CHECKED}（跳过存量 ${ID_SKIPPED}），不合规 ${ID_FAIL} ──"
echo "── 汇总: 检查 $CHECKED 个文档，$FAIL 个未登记 ──"
if [ "$FAIL" -eq 0 ] && [ "$DUPFAIL" -eq 0 ] && [ "$ALIVE_FAIL" -eq 0 ] && [ "$ID_FAIL" -eq 0 ]; then
  echo "  ✅ 登记门禁通过"; exit 0
else
  [ "$FAIL" -gt 0 ] && echo "  ❌ 登记门禁阻断（未登记 ${FAIL} 个）"
  [ "$DUPFAIL" -gt 0 ] && echo "  ❌ 登记门禁阻断（DOC id 重号 ${DUPFAIL} 个；唯一性不是风格问题，不许只告警）"
  [ "$ALIVE_FAIL" -gt 0 ] && echo "  ❌ 登记门禁阻断（active 条目 path 失配 ${ALIVE_FAIL} 个；台账不许指向不存在的文件）"
  [ "$ID_FAIL" -gt 0 ] && echo "  ❌ 登记门禁阻断（R1/R2 编号形态/Issue 来源不合规 ${ID_FAIL} 个；新条目必须 DOC-<Issue#> 且可派生来源）"
  exit 1
fi
