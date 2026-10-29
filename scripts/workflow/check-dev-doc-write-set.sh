#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-dev-doc-write-set.sh — D313 M3b dev doc 写集验证
#
# 防 D286 类"声明 16 实际 17"漂移: dev doc 写集表声明的文件 vs 代码实际。
#
# 流程: devdoc_writeset.py --extract（4 形态清洗）→ 逐条目核验:
#   (a) 变更命中: 路径 ∈ **带状态**的变更集（声明删除 ⇔ D；声明修改/新建 ⇔ A/C/M/R/T）
#   (b) 存在性: 归一路径在仓库存在（**声明删除的路径免此判** —— 它本就不该还在）
#   (c) 反向对账: 实际变更的代码文件须已登记进写集（D415/U2）
#
# 与 verify-parallel.sh 分工: verify-parallel 管"两 doc 零交集"，
# 本脚本管"单 doc 声明 vs 代码真实"，共用 devdoc_writeset.py。
#
# 🔴 变更集语义（#1125 修）:
#   取数 = `git diff --name-status --diff-filter=ACMRD --no-renames`（staged ∪ worktree-vs-HEAD）。
#   为什么必须 `--no-renames`: `git mv` 在重命名检测下 `--name-only` **只报新路径**，
#     旧路径（＝被删的那一侧）整行不出现 ⇒ 声明"删除"永远对不上 ⇒ 假红 exit 1（本卡缺陷本体）。
#     拆成 D(旧)+A(新) 后，两侧都可被写集声明命中。
#   为什么必须带状态（--name-status 而非 --name-only）: 只有状态能区分
#     「D＝删除声明成立」与「A/C/M/R＝修改/新建声明成立」，且 D 行在 name-only 下与
#     其它状态不可区分 ⇒ 会把"删除"当"零实际变更"误报。
#   🔴 判别力保留: 声明修改 + 零变更 ⇒ 仍 exit 1（测试夹具 B 钉住）。
#
# 三态退出码（scripts/AGENTS.md 既有约定）:
#   @input   [doc-path] [--json]（缺省 = 暂存区里的 dev doc）
#            注入缝: SYNO_DEV_DOC（单文件，跳过正向变更命中判据）/ SYNO_STAGED_FILES（反向对账）
#            环境: git 必须可用（非 git 仓 / GIT_DIR 损坏 ⇒ 判不了）
#   @output  逐条漂移点名 + `声明 N 条 | 漂移 M 条`；--json 追加一行 JSON
#   @exit    0=一致；1=写集漂移（业务阻断）；2=**判不了**（git 不可用 ⇒ fail-closed）
#   @degraded 判不了/无 doc 均落 .codex/control-tower/logs/degraded-events.log（铁律 11）
#
# fail-open: doc 不存在 / 无暂存 dev doc → SKIP + degraded + exit 0（既有契约，本卡不动）。
# 无写集表 → exit 1（U2b，既有契约，本卡不动）。
#
# 已知限制（禁读成"已判操作类型"）:
#   1. **不消费写集表的「操作」列**（该列是人读散文，含 `修改：真实暴露缺失时…` 这类带说明的
#      取值；机器单源解析器 devdoc_writeset.py 只输出路径）⇒ 判据是"路径 × 变更状态"，
#      **不区分**「声明修改」与「声明删除」：同一路径以 D 出现即算命中。
#      要按操作类型严格判，须先让解析器输出操作列（另卡，不在本卡范围）。
#   2. 反向对账只覆盖代码类扩展名（.ts/.tsx/.js/.jsx/.py/.sh/.json）＋既有豁免前缀。
#
# 用法: check-dev-doc-write-set.sh [doc-path] [--json]
#   缺省 = 暂存区 docs/plans/codex/implementation/SYNOVA-IMPL-*.md
#   注入缝: SYNO_DEV_DOC / SYNO_DEV_DOC_DIR（测试免跑真实 git diff）
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRITESET="$REPO_DIR/scripts/control-tower/devdoc_writeset.py"
DEGRADED_LOG="$REPO_DIR/.codex/control-tower/logs/degraded-events.log"
IMPL_DIR="$REPO_DIR/docs/plans/codex/implementation"

JSON_OUT=0
DOC=""
for arg in "$@"; do
  case "$arg" in
    --json) JSON_OUT=1 ;;
    *) [ -z "$DOC" ] && DOC="$arg" ;;
  esac
done

log_degraded() {
  mkdir -p "$(dirname "$DEGRADED_LOG")"
  echo "{\"time\": \"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\", \"component\": \"check-dev-doc-write-set\", \"reason\": \"$1\"}" >> "$DEGRADED_LOG" 2>/dev/null || true
}

# ── #1125: git 可用性（判不了 ⇒ exit 2，禁把"看不见"当没问题）──────────────
# 变更集全部来自 git diff。非 git 仓 / GIT_DIR 指向不存在时 diff 不可用 ——
# 旧实现在这种环境里会把"取不到变更集"静默当成"无变更"：要么 fail-open 跳过、
# 要么把每条声明误判成"零实际变更"（假红）。三态口径: 2 = 判不了（fail-closed，同样阻断）。
if ! git rev-parse --git-dir >/dev/null 2>&1 \
   || ! git -c core.quotepath=false diff --name-only --diff-filter=ACMRD >/dev/null 2>&1; then
  log_degraded "git 不可用（非 git 仓 / GIT_DIR 损坏）—— 取不到变更集"
  echo "[check-dev-doc-write-set] ❌ 判不了：git 不可用（非 git 仓 / GIT_DIR 指向不存在）—— exit 2（fail-closed）"
  exit 2
fi

# 注入缝: SYNO_DEV_DOC 单文件 / SYNO_DEV_DOC_DIR 目录
if [ -z "$DOC" ] && [ -n "${SYNO_DEV_DOC:-}" ]; then DOC="$SYNO_DEV_DOC"; fi

if [ -z "$DOC" ]; then
  DOCS=$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMRD 2>/dev/null | grep -E '^docs/plans/codex/implementation/SYNOVA-IMPL-.*\.md$' || true)
  if [ -z "$DOCS" ]; then
    echo "[check-dev-doc-write-set] ✅ 无暂存 dev doc — 跳过"
    exit 0
  fi
  DOC=$(echo "$DOCS" | head -1)
fi

if [ ! -f "$DOC" ]; then
  log_degraded "doc 不存在: $DOC"
  echo "[check-dev-doc-write-set] ⚠️  SKIP $DOC — doc 不存在 (fail-open)"
  exit 0
fi

echo "── check-dev-doc-write-set (D313 M3b): 声明 vs 实际 ──"
echo "  doc: $DOC"

# 提取写集
OUT=$(python3 "$WRITESET" --extract "$DOC" 2>&1 || true)
STATUS=$(echo "$OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','skip'))" 2>/dev/null || echo "skip")
if [ "$STATUS" = "skip" ]; then
  REASON=$(echo "$OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('reason',''))" 2>/dev/null || echo "解析跳过")
  log_degraded "$DOC: $REASON"
  echo "  ❌ dev doc 存在但无写集表 — $REASON (U2b: 有 dev doc 无写集表 → exit 1)"
  exit 1
fi

CLEANED=$(echo "$OUT" | python3 -c "import json,sys; print('\n'.join(json.load(sys.stdin).get('cleaned', [])))" 2>/dev/null || echo "")
if [ -z "$CLEANED" ]; then
  echo "  ❌ 写集表无有效条目 (U2b: 有 dev doc 无写集表 → exit 1)"
  exit 1
fi

# ── #1125: 变更集状态表（带状态；D 也算命中）────────────────────────────────
# 行格式 "<状态>\t<路径>"；staged（--cached）∪ worktree-vs-HEAD，去重。
# --no-renames: 把 R 拆成 D(旧)+A(新) —— 重命名下旧路径必须可见，否则"声明删除"永远对不上。
# 注入缝 SYNO_DEV_DOC 存在时**不建表**（既有契约: 该缝跳过正向变更命中判据）。
CHANGE_STATUS=""
if [ -z "${SYNO_DEV_DOC:-}" ]; then
  CHANGE_STATUS="$( {
    git -c core.quotepath=false diff --cached --name-status --diff-filter=ACMRD --no-renames 2>/dev/null || true  # swallow-ok: 变更集取不到时下方已由 git 可用性探针 exit 2 兜底
    git -c core.quotepath=false diff HEAD --name-status --diff-filter=ACMRD --no-renames 2>/dev/null || true  # swallow-ok: 同上（两源取并集，单源失败不致命）
  } | tr -d '\r' | sort -u)"
fi

# 逐条目核验: (a) 变更命中（带状态）(b) 存在性 (c) 零实际变更
DRIFT=""
CHECKED=0
while IFS= read -r entry; do
  entry=$(echo "$entry" | tr -d '\r')  # 剥 CR（Windows CRLF）
  [ -z "$entry" ] && continue
  CHECKED=$((CHECKED + 1))
  # 目录级声明 → 检查目录存在
  if [ "${entry: -1}" = "/" ]; then
    if [ -d "$REPO_DIR/$entry" ]; then
      :
    else
      DRIFT="${DRIFT}  ${entry}（目录不存在）\n"
    fi
    continue
  fi
  # D316: 非文件条目（操作类，如 "git 推送"，无扩展名）→ 不参与文件核验
  if ! echo "$entry" | grep -q '\.'; then
    continue
  fi
  # (a) #1125: 变更集命中（**带状态**；匹配语义沿用改前的 grep -F 子串口径，避免误伤
  #     "写集只写裸文件名"的历史 doc）:
  #       · D  ⇒ 声明"删除"成立（文件本应不在）⇒ 直接通过，**免存在性检查**
  #       · A/C/M/R/T ⇒ 声明"修改/新建"成立
  #     两者不满足 ⇒ 落到 (b)(c) 走原有判据（存在性 / 零实际变更）。
  if [ -n "$CHANGE_STATUS" ]; then
    _st="$(printf '%s\n' "$CHANGE_STATUS" | awk -F'\t' -v p="$entry" '
      BEGIN { key = tolower(p) }
      { path = tolower($2); if (index(path, key) > 0) { print $1; exit } }')"
    case "$_st" in
      D)         continue ;;   # 删除声明成立
      A*|C*|M*|R*|T*) continue ;;   # 修改/新建声明成立（R/T 兼容旧口径）
    esac
  fi
  # (b) 文件存在性
  if [ ! -f "$REPO_DIR/$entry" ]; then
    DRIFT="${DRIFT}  ${entry}（文件不存在）\n"
    continue
  fi
  # D316: gitignore 文件（运行时产物，如 logs/version.log）→ 存在即声明满足
  if git check-ignore -q "$REPO_DIR/$entry" 2>/dev/null; then  # swallow-ok: 探测型（ignore 判定失败走 else）
    continue
  fi
  # (c) 走到这里 = 既不在变更集、也非 gitignore ⇒ 声明修改/新建但零实际变更（#1125 判别力保留）
  if [ -z "${SYNO_DEV_DOC:-}" ]; then
    DRIFT="${DRIFT}  ${entry}（声明修改但零实际变更；声明删除须以 D 出现在变更集）\n"
  fi
done <<< "$CLEANED"

# U2a/D415: 反向对账 — 实际变更的代码文件须已登记进写集（改了没登记 → 漂移, M2/M7）
# 豁免口径对齐 G12 skip_re（.claude/docs/memory/task-state/.codex/.github/scripts/workflow 豁免, 原则 7 文档豁免）
# ACTUAL 注入缝: SYNO_STAGED_FILES（测试免真实 git 暂存）; 否则 git diff --cached
REVERSE_DRIFT=$(CLEANED_ENTRIES="$CLEANED" python3 - "$REPO_DIR" <<'PYEOF'
import os, subprocess, sys, re
repo = sys.argv[1]
declared = set(l.strip().rstrip("\r").lower() for l in os.environ.get("CLEANED_ENTRIES","").split("\n") if l.strip())
inj = os.environ.get("SYNO_STAGED_FILES")
if inj is not None:
    out = inj
else:
    try:
        out = subprocess.run(["git","-c","core.quotepath=false","diff","--cached","--name-only","--diff-filter=ACMRD"],capture_output=True,text=True,cwd=repo).stdout
    except Exception:
        out = ""
CODE = re.compile(r'\.(ts|tsx|js|jsx|py|sh|json)$')
SKIP = re.compile(r'^(\.claude/|docs/|memory/|task-state/|\.codex/|\.github/|scripts/workflow/)')
drift = []
for af in out.split("\n"):
    af = af.strip()
    if not af or not CODE.search(af) or SKIP.search(af):
        continue
    afl = af.lower()
    if afl in declared or any(d.endswith("/") and afl.startswith(d) for d in declared):
        continue
    drift.append("  " + af + "（实际变更但未登记进写集）")
print("\n".join(drift))
PYEOF
)
if [ -n "$REVERSE_DRIFT" ]; then
  DRIFT="${DRIFT}${REVERSE_DRIFT}\n"
fi

echo "  声明 $CHECKED 条 | 漂移 $(echo -e "$DRIFT" | grep -c '^  ' || echo 0) 条"
if [ -n "$DRIFT" ]; then
  echo -e "  ❌ 写集漂移:"
  echo -e "$DRIFT"
  if [ "$JSON_OUT" -eq 1 ]; then
    echo "{\"status\":\"block\",\"doc\":\"$DOC\",\"declared\":$CHECKED,\"drift\":$(echo -e "$DRIFT" | grep '^  ' | wc -l)}"
  fi
  exit 1
fi

echo "  ✅ 声明与实际一致"
if [ "$JSON_OUT" -eq 1 ]; then
  echo "{\"status\":\"pass\",\"doc\":\"$DOC\",\"declared\":$CHECKED,\"drift\":0}"
fi
exit 0
