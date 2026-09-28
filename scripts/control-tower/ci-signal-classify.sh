#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（PLATFORM-CHECKLIST #4）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# ci-signal-classify.sh — control-tower 重活「按需跑」的判据唯一载体（D1039）
#
# 一句话: 回答「本次变更碰了控制塔相关路径吗？」——命中 ⇒ 跑重活；未命中 ⇒ 跳重活
#         （但承载必需 context 的 job 恒被调度；跳过只发生在 job 内的 step 级 `if:`）。
#
# 背景（为什么不能是 job 级 paths: 过滤）:
#   `Control Tower Gate Tests (ubuntu-latest)` / `(windows-latest)` 是 main 分支保护的
#   12 个必需检查之一（scripts/control-tower/ci-red-baseline.txt:65-66；
#   docs/synova/coordination/CI-诊断通道.md:115-116）。job 级路径过滤会让该 job 根本
#   不被创建 ⇒ 不产生 check-run ⇒ 必需 context 永不报告 ⇒ PR 永久 blocked
#   （D971 同型事故: 405 "12 of 12 required status checks are expected."，
#    cf. docs/synova/coordination/周报-20260922.md:58）。
#   ⇒ 判据必须发生在 job 内部；本脚本只产结论，接线在 .github/workflows/ci.yml。
#
# 契约（铁律 47）:
#   @input  — --base <ref>        基准 ref（默认 origin/main）
#             --files "<a b c>"   变更集注入（空白/换行分隔；调用方与测试注入缝）
#                                 缺省 = git diff --name-only "$base"...HEAD
#             --mode github       把 run=true|false 写入 $GITHUB_OUTPUT（缺省 human 可读）
#             --help
#   @output — 结论行（含 run=true|run=false）+ **逐条列出哪些文件命中哪条规则** + 未命中明细
#             （可审计: 每次判定都能在 CI job log 里逐条复核，安全网不靠"信"）
#   @exit   — 0 = 分类成功（run 可真可假；正常路径）
#             1 = 判据失败/调用非法（fail-closed: 同时写 run=true，绝不误跳）
#             2 = 降级（git 不可用 / base ref 不可解析）—— stderr 显式留痕
#   @degraded — base 不可解析或 git 不可用 ⇒ **run=true（全量跑，绝不误跳）** + stderr 留痕 + exit 2。
#             消费方据此「可见但不阻断」: 安全值（全量跑）已在效果上生效，不该把 PR 判红；
#             铁律 11 —— 降级必须显式可见，不与"正常未命中"混同。
#   @seam   — SYNO_CT_CLASSIFY_FILES（等价 --files；测试注入，避免测试改写真实仓库）
#   @consumer — .github/workflows/ci.yml control-tower-tests job 的 `ctsignal` step
#             （exit 2 ⇒ ::warning + 继续；其余非 0 ⇒ step 红）
#
# 路径集覆盖依据（改 RULES 必须同步配对测试的判别性夹具）:
#   实测 tests/control-tower/*.test.sh + tests/doc-system/*.test.sh 共引用 144 个唯一
#   `scripts/...` leaf，且含 scripts/hooks|ci|product-lines|audit|backup|doc-system|setup/
#   与根级 pre-commit-check.sh / pre-push-check.sh / commit-msg-check.sh / install-hooks.sh
#   ⇒ 必须 `^scripts/` 全树；只列 5 条会漏跑（漏跑 = 门禁坏在该跑没跑，比多跑贵得多）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_NAME="ci-signal-classify.sh"
BASE="origin/main"
MODE="human"
FILES_RAW=""
FILES_SET=0

# ── 规则表（唯一判据；顺序 = 报告顺序；命中即止）────────────────────────────────
# 每条: "<规则名>|<ERE>"（ERE 锚定，杜绝子串误命中）
# 路径集口径 = 「今天会触发全量 CI、且控制塔域可能受影响的」super-set（宁可多跑，不可漏跑）。
# 逐条理由（排除项须两条都为"否"才允许排除: ① 今天是否触发全量 CI？② 改了它能否让控制塔测试红？）:
#   ci-workflows — **全体 workflow，不止 ci.yml**。实测 tests/control-tower/check-progress-freshness.test.sh:42
#                  直接 grep `progress-freshness-watchdog.yml`，且该测试在 ci.yml canary for 清单内
#                  （ci.yml:450）⇒ 真会跑；tests/control-tower/generated-gate.test.sh:49 同型引
#                  `dashboard-auto.yml`。只列 ci.yml ⇒ 改这两个 yml 会**静默跳过**。
#   gitattributes — `.gitattributes` 含 `*.sh text eol=lf`（Windows runner autocrlf=true 会把 .sh 检出成
#                  CRLF ⇒ bash 全线 `: command not found`）。实测它不在 docs-only 白名单正则内
#                  ⇒ docs_only=false（**今天触发全量**）；不覆盖 = 本批引入「跑 → 静默跳过」净回归。
#   gitmodules    — 同族检出层（D1023/P1 把它移出 docs-only 白名单: 新增子模块+文档即零验证入库）。
#   scripts-tree  — scripts/ 全树。实测 tests/ 共引 149 个唯一 `scripts/...` leaf，其中 66 个非
#                  control-tower/workflow 域（hooks|ci|product-lines|doc-system|audit|backup|setup|
#                  archive + 根级 pre-commit-check.sh / pre-push-check.sh / commit-msg-check.sh /
#                  install-hooks.sh）⇒ 只列 5 条会**漏跑**（漏跑 = 门禁坏在该跑没跑）。
#   ct-tests      — canary 清单本体 + 控制塔测试所在目录。
#   doc-tests     — tests/doc-system/** 亦在 canary for 清单内（ci.yml 清单内实测）。
#   tsconfig      — 仅根级 tsconfig*.json（`^…$` 锚定，子目录同名不误命中）。
#   root-package  — 仅根级 package.json（测试运行时依赖；子目录 package.json 归其自身 job）。
# 已知存量缺口（**非本批引入**，不擅自扩集，已报 CTO 归遗留）:
#   package-lock.json — ① 结论"否"（`.json` 后缀命中 docs-only 白名单 ⇒ 今天它本来就不触发全量）
#                       ⇒ 属既存缺口；本批不扩，登记在遗留清单。
RULES=(
  "ci-workflows|^\\.github/workflows/"
  "gitattributes|^\\.gitattributes$"
  "gitmodules|^\\.gitmodules$"
  "scripts-tree|^scripts/"
  "ct-tests|^tests/control-tower/"
  "doc-tests|^tests/doc-system/"
  "tsconfig|^tsconfig[^/]*\\.json$"
  "root-package|^package\\.json$"
)
MISS_DISPLAY_CAP=15   # 未命中明细显示上限（超出显式声明条数，禁静默截断——铁律 11）

# ── 三态出口（Ctrl-tower 模式 1: 0 过 / 1 业务失败 / 2 执行失败降级）─────────────
_emit_run() {   # $1 = true|false；仅当 $GITHUB_OUTPUT 可用（纯内建，PATH 被剥离时仍工作）
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'run=%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
}

_fail_closed() {   # $1 = 退出码(1)  $2 = 原因；任何不可判 ⇒ run=true（绝不误跳）
  echo "❌ ${SCRIPT_NAME}: fail-closed(exit $1) — ${2}" >&2
  _emit_run true
  exit "$1"
}

_degrade() {   # $1 = 原因；恒 exit 2 + run=true + stderr 留痕（铁律 11 显式降级）
  echo "⚠ degraded: ${1}" >&2
  echo "::warning title=ci-signal-classify::degraded — ${1} ⇒ run=true（全量跑，绝不误跳）" >&2
  _emit_run true
  exit 2
}

_usage() {
  echo "用法: bash ${SCRIPT_NAME} [--base <ref>] [--files \"<a b c>\"] [--mode github|human]"
  echo "  缺省 base = origin/main；缺省变更集 = git diff --name-only \"\$base\"...HEAD"
  echo "  exit: 0=分类成功 / 1=判据失败（fail-closed，run=true） / 2=降级（run=true + stderr 留痕）"
}

# ── 参数解析（纯内建，保证 PATH 异常时也能给出三态结论）────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --base)
      [ $# -ge 2 ] || _fail_closed 1 "--base 缺参数值"
      BASE="$2"; shift 2 ;;
    --files)
      [ $# -ge 2 ] || _fail_closed 1 "--files 缺参数值"
      FILES_RAW="$2"; FILES_SET=1; shift 2 ;;
    --mode)
      [ $# -ge 2 ] || _fail_closed 1 "--mode 缺参数值"
      MODE="$2"; shift 2 ;;
    -h|--help)
      _usage; exit 0 ;;
    *)
      _fail_closed 1 "未知参数: $1（--help 看用法）" ;;
  esac
done

case "$MODE" in
  github)
    [ -n "${GITHUB_OUTPUT:-}" ] || _fail_closed 1 "--mode github 需要 \$GITHUB_OUTPUT（未设置）"
    ;;
  human) ;;
  *) _fail_closed 1 "未知 --mode: ${MODE}（只接受 github|human）" ;;
esac

# ── 变更集解析（注入缝优先；否则走 git，任何不可判 ⇒ 降级 run=true）─────────────
SOURCE=""
CHANGED_RAW=""
if [ "$FILES_SET" -eq 1 ]; then
  CHANGED_RAW="$FILES_RAW"
  SOURCE="注入（--files）"
elif [ -n "${SYNO_CT_CLASSIFY_FILES+x}" ]; then
  CHANGED_RAW="${SYNO_CT_CLASSIFY_FILES}"
  SOURCE="注入（SYNO_CT_CLASSIFY_FILES）"
else
  SOURCE="git diff --name-only ${BASE}...HEAD"
  command -v git >/dev/null 2>&1 || _degrade "git 不可用（PATH 中找不到 git）"
  git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null 2>&1 \
    || _degrade "base ref 不可解析: ${BASE}"
  CHANGED_RAW="$(git diff --name-only "${BASE}...HEAD" 2>/dev/null)" \
    || _degrade "git diff 执行失败（base=${BASE}）"
fi

# ── 逐文件判定（纯字符串判定: 判据看"改了哪个路径"，与文件是否存在无关——
#    删除/新增/改名同样触发，这正是"删掉依赖即该重跑"的语义）─────────────────────
MATCH_OUT=""
MISS_OUT=""
FILE_COUNT=0
MATCH_COUNT=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  FILE_COUNT=$((FILE_COUNT + 1))
  hit=""
  for entry in "${RULES[@]}"; do
    rname="${entry%%|*}"
    rre="${entry#*|}"
    if [[ "$f" =~ $rre ]]; then hit="$rname"; break; fi
  done
  if [ -n "$hit" ]; then
    MATCH_COUNT=$((MATCH_COUNT + 1))
    MATCH_OUT="${MATCH_OUT}  ${hit}  ←  ${f}"$'\n'
  else
    MISS_OUT="${MISS_OUT}  ${f}"$'\n'
  fi
done < <(printf '%s\n' "$CHANGED_RAW" | tr -s '[:space:]' '\n')

MISS_COUNT=$((FILE_COUNT - MATCH_COUNT))

# ── 人类可读结论（逐条可核: 命中规则 ← 文件）──────────────────────────────────
echo "── ci-signal-classify (D1039) ──"
echo "判据来源: ${SOURCE}"
echo "基准: ${BASE} ｜ 变更文件数: ${FILE_COUNT} ｜ 规则表: ${#RULES[@]} 条"
if [ "$MATCH_COUNT" -gt 0 ]; then
  echo "命中 ${MATCH_COUNT} 个文件（规则 ← 文件）:"
  printf '%s' "$MATCH_OUT"
else
  echo "命中 0 个文件"
fi
if [ "$MISS_COUNT" -gt 0 ]; then
  echo "未命中 ${MISS_COUNT} 个:"
  printf '%s' "$MISS_OUT" | head -n "$MISS_DISPLAY_CAP"
  if [ "$MISS_COUNT" -gt "$MISS_DISPLAY_CAP" ]; then
    echo "  …另 $((MISS_COUNT - MISS_DISPLAY_CAP)) 个未命中文件未展开（仅显示上限，非静默截断）"
  fi
fi

if [ "$MATCH_COUNT" -gt 0 ]; then
  echo "结论: HIT ⇒ run=true（control-tower 重活须执行）"
  _emit_run true
else
  echo "结论: MISS ⇒ run=false（control-tower 重活可跳；job 仍被调度，必需 context 照常上报）"
  _emit_run false
fi
exit 0
