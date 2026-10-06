#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# doc-registry-gate.sh — 登记门禁（治理机制 #1，GOVERNANCE.md）
#
# 契约（铁律 47 契约优先）:
#   输入:  环境 DOC_TRUTH_ROOT 覆盖仓库根（测试用）
#          git 仓库 → 检查 untracked 新增 .md/.yaml 是否已登记；
#          非 git（测试 fixture）→ 全量扫描模式
#   输出:  每文件 ✅/❌ + 汇总；任一未登记 → exit 1（硬阻断）；全部登记 → exit 0
#   降级:  DOCS-REGISTRY.yaml 缺失 → ⚠️ 警告 exit 0（台账未建立不阻断）
#
# 排除（生成物/历史区，无需登记）:
#   - docs/synova/DASHBOARD*.md（自动生成）
#   - 路径含 /archive/ 或 /Archive/（历史归档，只读）
#
# D964 追加（文档减负，**并入本检查，不新建脚本**）:
#   同类文档唯一性 —— 新增 .md 的「归一化名」与既有文档撞名，或内容指纹与既有文档完全相同
#   ⇒ 判疑似重复文档，必须在新文件里写明「取代: <路径>」/「合并: <路径>」/「supersedes: <路径>」
#   才放行；否则 exit 1（红）。归一化 = 去日期(YYYYMMDD/YYYY-MM-DD)、去版本(vN)、去 D# 任务号、小写。
#   判据（改坏即红）: 构造重复文档样例 ⇒ 必须红（tests/doc-system/doc-dup-rule.test.sh）。
# ═══════════════════════════════════════════════════════════════════════════════
set +e
ROOT="${DOC_TRUTH_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" # swallow-ok:
REGISTRY="$ROOT/docs/authority/DOCS-REGISTRY.yaml"
[ -f "$REGISTRY" ] || { echo "  ⚠️ 降级: DOCS-REGISTRY.yaml 不存在，跳过登记检查（exit 0）"; exit 0; }
REG=$(cat "$REGISTRY")

EXCLUDE='^tmp/|\.claude/|memory/|docs/plans/codex/implementation/|docs/synova/audit-reports/|docs/authority/chronicle-drafts/|docs/synova/DASHBOARD.*\.md$|/archive/|/Archive/'

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
  # untracked 新增 + staged 新增（git add 过、未提交）都要登记；
  # 提交场景靠 staged 集合（git add 后文件不再出现在 ls-files --others）
  while IFS= read -r rel; do check_file "$rel"; done < <({ git -c safe.directory="$ROOT" -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null; git -c safe.directory="$ROOT" -C "$ROOT" diff --cached --name-only --diff-filter=A 2>/dev/null; } | grep -E '\.(md|yaml)$' | sort -u) # swallow-ok:
else
  while IFS= read -r rel; do check_file "$rel"; done < <(find "$ROOT" -type f \( -name '*.md' -o -name '*.yaml' \) 2>/dev/null | sed "s|^$ROOT/||") # swallow-ok:
fi

# ── D964 同类文档唯一性（并入本检查；只查**新增**文档，成本与新增数成正比）──
# 归一化名撞名 或 内容指纹相同 ⇒ 必须写明「取代:/合并:/supersedes: <路径>」，否则红。
DUP=0
if git -c safe.directory="$ROOT" -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  NEW_MD=$( { git -c safe.directory="$ROOT" -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null; git -c safe.directory="$ROOT" -C "$ROOT" diff --cached --name-only --diff-filter=A 2>/dev/null; } | grep -E '\.md$' | grep -vE "$EXCLUDE" | sort -u ) # swallow-ok:
  if [ -n "$NEW_MD" ]; then
    EXIST_MD=$(git -c safe.directory="$ROOT" -C "$ROOT" ls-files '*.md' | grep -vE "$EXCLUDE") # swallow-ok:
    # 归一化 + 指纹比对交给 python（bash sed/tr 在 CJK 路径下会破坏多字节变量，
    # 且 Windows 无 GNU sed —— ctrl-tower-change 模式 2 / windows-compat 要求）
    DUP_OUT=$("${PYBIN:-python3}" - "$ROOT" "$EXCLUDE" "$NEW_MD" <<'PYEOF'
import os, re, sys, hashlib
root, exclude = sys.argv[1], re.compile(sys.argv[2])
new = [l for l in sys.argv[3].splitlines() if l.strip()] if len(sys.argv) > 3 else []
DATE = re.compile(r"\d{4}-?\d{2}-?\d{2}")
VER = re.compile(r"[Vv]\d+(\.\d+)*")
DID = re.compile(r"D\d{3,4}")
def norm(p):
    b = os.path.basename(p)[:-3] if p.endswith(".md") else os.path.basename(p)
    b = DID.sub("", VER.sub("", DATE.sub("", b)))
    b = re.sub(r"[-_ ]+", "-", b.lower()).strip("-")
    return b
tracked = [l for l in os.popen('git -C "%s" ls-files "*.md"' % root).read().splitlines() if l.strip()]
# 新增文件若已 git add（staged），也会出现在 ls-files 中 → 必须先剔除自身，否则自我撞名（误拦实证）
_newset = set(new)
tracked = [t for t in tracked if not exclude.search(t) and t not in _newset]
# FIX-004 C: 取代声明目标校验用的「tracked 全集」（不限 *.md、不受 EXCLUDE 影响）
_tracked_all = set(l for l in os.popen('git -C "%s" ls-files' % root).read().splitlines() if l.strip())
existing = {}
for t in tracked:
    n = norm(t)
    if n:
        existing.setdefault(n, []).append(t)
# FIX-004 B（P1）: 撞名判定必须加**同目录约束**。
#   原实现只比归一化 basename ⇒ 新目录里放一个 README.md / index.md 就与仓库里任意
#   同名文件「撞名」→ 误拦正常文档工作（K3 定罪「新判据是否误拦」）。
#   规则：① 同目录撞名 → 判（同目录同名即真重复）
#        ② 跨目录撞名 → 仅**非通用名**判；通用名（README/index/CHANGELOG…）本就按目录各存一份。
GENERIC_NAMES = {"readme", "index", "changelog", "license", "contributing", "authors",
                 "makefile", "todo", "summary", "overview"}
def _same_dir(a, b):
    return os.path.dirname(a) == os.path.dirname(b)
for rel in new:
    n = norm(rel)
    hit = None
    if n and n in existing:
        cands = existing[n]
        same = [t for t in cands if _same_dir(t, rel)]
        if same:
            hit = "归一化名撞名（同目录 %s；既有: %s）" % (n, same[0])
        elif n not in GENERIC_NAMES:
            hit = "归一化名撞名（跨目录 %s；既有: %s）" % (n, cands[0])
    if hit is None:
        p = os.path.join(root, rel)
        # 空文件（0 字节）不做指纹比对：空 == 空 无信息量，历史上全是夹具/占位文件（误拦实证）
        if os.path.isfile(p) and os.path.getsize(p) > 0:
            try:
                h = hashlib.md5(open(p, "rb").read()).hexdigest()
            except OSError:
                h = None
            if h:
                for c in tracked[:800]:
                    q = os.path.join(root, c)
                    if os.path.isfile(q) and os.path.getsize(q) == os.path.getsize(p):
                        try:
                            if hashlib.md5(open(q, "rb").read()).hexdigest() == h:
                                hit = "内容完全相同（与 %s）" % c
                                break
                        except OSError:
                            continue
    if hit:
        txt = ""
        try:
            txt = open(os.path.join(root, rel), encoding="utf-8", errors="replace").read()
        except OSError:
            pass
        # FIX-004 C（P1）: 取代声明必须**指向真实存在**的被取代对象。
        #   原实现只匹配「取代: <任意非空 token>」⇒ 写一行「取代: 不存在」即放行
        #   （K3 定罪「无意义声明绕过」）。现校验目标 ∈ tracked 集合 ∪ 本次新增集合。
        decl = re.search(r"^[ \t]*(取代|合并|supersedes)[ \t]*[:：][ \t]*(\S+)", txt, re.M)
        if decl:
            target = decl.group(2).strip().strip("\"'").strip(chr(96))
            target = re.sub(r"[（(].*$", "", target).strip()
            if target and (target in _tracked_all or target in _newset):
                print("DECLARED\t%s\t%s" % (rel, target))
            else:
                print("VIOLATION\t%s\t取代声明目标不存在（tracked 集合无 %s）" % (rel, target or "<空>"))
        else:
            print("VIOLATION\t%s\t%s" % (rel, hit))
PYEOF
)
    while IFS=$'\t' read -r kind rel detail; do
      [ -z "${kind:-}" ] && continue
      if [ "$kind" = "DECLARED" ]; then
        echo "  ✅ 疑似重复但已声明取代/合并: $rel"
      else
        echo "  ❌ 疑似重复文档: $rel — $detail"
        echo "     修法: 不新增（改既有那份），或在新文件头部写「取代: <被取代的路径>」/「合并: <被合并的路径>」"
        DUP=$((DUP+1))
      fi
    done <<< "$DUP_OUT"
    [ "$DUP" -gt 0 ] && FAIL=$((FAIL+DUP))
  fi
fi

echo "── 汇总: 检查 $CHECKED 个文档，$FAIL 个未登记，$DUP 个疑似重复 ──"
if [ "$FAIL" -eq 0 ]; then echo "  ✅ 登记门禁通过"; exit 0; else echo "  ❌ 登记门禁阻断"; exit 1; fi
