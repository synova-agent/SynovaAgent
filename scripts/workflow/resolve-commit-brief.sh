#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# resolve-commit-brief.sh — 认领制 brief 解析 (D296, 跨 session 污染根治)
#
# 背景: current-brief 是全局单文件, 多 session 并发时最后启动者覆盖前者。
# 旧解析 (current-brief → find 最新) 让 A session 的提交被 B session 的 brief
# 校验 → 误伤 (D291 事故: D296 的 brief 干扰了 D291 的提交)。
#
# 认领制规则 (每个文件由认领它的 brief 判定):
#   1. current-brief (当日有效) 认领 ≥1 个暂存文件 → 输出它
#   2. 否则 → 今日 brief 中认领暂存文件数最多的 (其他 session 的文件由自己的 brief 认领)
#   3. 无任何认领 → current-brief (当日); 无 → 今日最新
#
# D1231/#1308（与 Q2 口径的关系，写清供 K3 复核）:
#   · 完整裁决顺序 = 「认领数最多 → 身份锚点（强: 分支名 / 暂存 task-state；弱: current-brief）
#     → 同日**字典序** → 回退」。认领数**只由 parse_q2 的 include 决定** ⇒ Q2 条目写法直接决定身份。
#   · Q2 条目若「不可匹配」（反引号包裹 / 行内尾随说明 / 通配符 / 全角分隔符 —— 见
#     brief_parser.q2_entry_hazard），该 brief 的认领数恒为 0，必然 0:1 输给任何一条裸路径声明；
#     现象在提交端报「声明与归属不一致」，根因却在 Q2 写法（#1308 实测排查被引偏一轮）。
#   · 故三件事（本次一并落地）: ① parse_q2 对不可匹配条目打 `Q2-PARSE-WARN`（stderr，带 source:line，
#     本文件在循环里传 source=basename(brief)）；② 同数且身份锚点全未命中（= 纯字典序裁决）时打
#     `RESOLVER-TIE`（stderr）——最弱裁决可见化；③ 本文件**不得**再持第二套 Q2 解析实现
#     （Step B 已删内联副本 30 行；解析器缺失 = 显式 degraded，不猜语义）。
#   · 契约: stdout 仍只输出 brief 路径（不变）；上列标记一律走 stderr 供消费方判别。
#
# 用法: bash resolve-commit-brief.sh "<暂存文件列表 (换行分隔)>"
#       bash resolve-commit-brief.sh --session <sid> "<暂存文件列表>"  (D329: session 专属 current-brief 优先)
# 输出: brief 绝对路径; 无可用 brief → exit 1
#
# 性能: 认领计数用单次 python3 完成 (Windows 下逐路径 grep 子进程太慢)
# ═══════════════════════════════════════════════════════════════════════════════
set +e

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# D317: brief_parser 是 resolver 的兄弟组件（同仓库）——不能用 $ROOT 定位，
# 测试隔离（临时 repo）或 ROOT 与脚本异仓库时 $ROOT 下没有解析器。
RESOLVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSER="$RESOLVER_DIR/../control-tower/brief_parser.py"
# Windows python 不认 MSYS 路径（/d/...）→ cygpath 转 C:/...（sys.path 注入用）
PARSER_DIR_W="$(cygpath -w "$RESOLVER_DIR/../control-tower" 2>/dev/null || echo "$RESOLVER_DIR/../control-tower")"
TODAY=$(date +%Y-%m-%d)
STAGED="${1:-}"

# D329: --session <sid> — 优先读 session 专属 current-brief（.claude/current-brief.<sid>），
# 无则回退全局（单 session 语义）。session 专属文件由 attach.py SessionStart 写入。
SESSION_ID=""
if [ "${1:-}" = "--session" ]; then
  SESSION_ID="${2:-}"
  shift 2
  STAGED="${1:-}"
fi

# D317: PYBIN 跨平台 — Windows 部分机器无 python3.exe（仅 python / py -3）。
# 本机实测 python3 可用（WindowsApps shim），但防御性回退防精简 Git/CI runner。
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

# ── current-brief (当日有效) ──
CUR=""
CUR_SRC="$ROOT/.claude/current-brief"
# D329: session 专属 current-brief 优先；无则回退全局
if [ -n "$SESSION_ID" ] && [ -f "$ROOT/.claude/current-brief.$SESSION_ID" ]; then
  CUR_SRC="$ROOT/.claude/current-brief.$SESSION_ID"
fi
if [ -f "$CUR_SRC" ]; then
  BN=$(cat "$CUR_SRC" 2>/dev/null | tr -d '[:space:]') # swallow-ok: current-brief 缺失/读失败 → BN 空 → 走认领回退（fail-open 不阻断）
  BD=$(echo "$BN" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)
  if [ -n "$BD" ] && [ "$BD" != "$TODAY" ]; then
    :  # 陈旧的 current-brief，忽略
  elif [ -n "$BN" ] && [ -f "$ROOT/.claude/task-briefs/$BN" ]; then
    CUR="$ROOT/.claude/task-briefs/$BN"
  fi
fi

# ── D718: 任务身份锚点（D#）——跨日任务认领的物理依据 ──
# 背景: 候选集原为「文件名日期 today±1」→ brief 生成 2026-09-10、提交 2026-09-12 时该 brief
#   永不入池 → 认领恒空 → 回退落到无关 brief → D328 认领校验判「他人文件」硬阻断
#   （D664 实测被拦 2 次，处置=把 brief 改名到执行日；跨日任务是常态，日期不是任务身份）。
# 语义: 候选集 = 日期窗口 ∪ {本提交所属任务 D# 的 brief}。身份证据按可靠性分两级：
#   强锚点（分支名 / 暂存 task-state/D#.json = 本提交自身）→ 可参与最终回退；
#   弱锚点（current-brief 文件名 = 本 session 声明）→ 只入候选池，仍由认领计数裁决。
# 不做窗口整体放宽: 那会把**他人**的陈旧 brief 拉回候选池（D291/D296 跨 session 误伤复发）。
# 降级: 提不到锚点 → 行为与修复前完全一致（纯日期窗口，零回归）。
ANCHOR_STRONG_RAW=""
ANCHOR_WEAK_RAW=""
BR_CUR="$(git -C "$ROOT" branch --show-current 2>/dev/null || true)"
[ -n "$BR_CUR" ] && ANCHOR_STRONG_RAW="$BR_CUR"
ANCHOR_STRONG_RAW="$ANCHOR_STRONG_RAW $(printf '%s\n' "$STAGED" | grep -oE 'task-state/D[0-9]+\.json' || true)"
if [ -f "$CUR_SRC" ]; then
  ANCHOR_WEAK_RAW="$(cat "$CUR_SRC" 2>/dev/null || true)"  # swallow-ok: current-brief 读失败→无弱锚点，非错误
fi
# 归一化为纯数字 D# 列表（大小写无关，去重）
_ids_of() {
  printf '%s\n' "$1" | grep -ioE 'D[0-9]+' | tr 'A-Z' 'a-z' | sed 's/^d//' | grep -E '^[0-9]+$' | sort -u | tr '\n' ' ' || true
}
ANCHOR_IDS_STRONG="$(_ids_of "$ANCHOR_STRONG_RAW")"
ANCHOR_IDS_WEAK="$(_ids_of "$ANCHOR_WEAK_RAW")"
# 按 D# 找 brief（文件名含 -D<id>-）
briefs_by_id() {
  local ids="$1" id f
  [ -z "$ids" ] && return 0
  for id in $ids; do
    for f in "$ROOT/.claude/task-briefs/"*"-D${id}-"*.md; do
      [ -e "$f" ] || continue
      echo "$f"
    done
  done
  return 0
}
ANCHORED_STRONG_FILES="$(briefs_by_id "$ANCHOR_IDS_STRONG" | sort -u || true)"
ANCHORED_WEAK_FILES="$(briefs_by_id "$ANCHOR_IDS_WEAK" | sort -u || true)"

# ═══════════════════════════════════════════════════════════════════════════════
# D-C（K3 预审 R3/R4）: issue claim 优先 + **存在 claim 即禁用 D# 锚点回退**（防双口径劫持）
#
# 病根（K3 预审 §③）: D718 强锚点（分支名/暂存 task-state 里的 D#）**优先于**一切回退。
#   迁移期旧 D# 分支名（feat/D734-…）仍存在，而任务已改挂 issue 号（#1017）⇒
#   新格式声明被旧锚点劫持 → d734→D718 同款假红。
# 修法:
#   ① `SYNO_CLAIM_V2=1` 且本任务身份能定位到 `.claude/claims/<issue>.yaml` →
#      **claim-first**：直接返回 claim 文件（解析语义由 brief_parser 的 claim 分支承担）。
#   ② 无论开关状态，只要 claim 存在 → **跳过末尾的 D# 强锚点回退**（下方 CLAIM_GUARD）。
#      这是**减法**（移除一条回退）：无 claim 时逐字节零行为变化（rollback-safe）。
#   ③ claim 不存在 → 逐字节 legacy（迁移期在途 D# 任务照常可提交）。
# 开关语义（K3 预审 R2）: `SYNO_CLAIM_V2` 控制「claim 是否作为解析源」；
#   防劫持守卫是减法不随开关回退（否则回滚态自带 R3 那个 P0）。
# ═══════════════════════════════════════════════════════════════════════════════
CLAIM_LIB="$RESOLVER_DIR/../control-tower/claim_store.py"
CLAIM_FILE=""
ISSUE_HINT="${SYNO_ISSUE_HINT:-}"
[ -z "$ISSUE_HINT" ] && ISSUE_HINT="$BR_CUR"
# 卡 #1423（判据④ 端到端 / D1245 同族）: **CI 的 PR 检出是分离头（detached HEAD）** ——
#   `git branch --show-current` 为空 ⇒ $BR_CUR 空 ⇒ 本任务 claim 在 CI 里**不可达**
#   ⇒ 退回"日期回退"，取一份**与本 PR 无关**的今日 brief 当声明 ⇒ "新格式只在本机成立"
#   （实测: CI 上被 2026-10-08-1398-*.md / 本地被 1408-*.md 抢走 ⇒ 判 Done 失败/误判）。
#   修法: GH Actions 提供 PR **源分支**名（GITHUB_HEAD_REF，形如 `feat/1423-claim-default-on`）
#   ⇒ 补作 hint，使 claim 在 CI 亦可解析。
#   ⚠️ 刻意**不用** GITHUB_REF_NAME: PR 下它是 `<PR号>/merge`，**PR 号 ≠ issue 号**
#     ⇒ 会指向错误的 claim（比没有更坏）。
if [ -z "$ISSUE_HINT" ] && [ -n "${GITHUB_HEAD_REF:-}" ]; then
  ISSUE_HINT="$GITHUB_HEAD_REF"
fi
ISSUE_ID=""
if [ -n "$PYBIN" ] && [ -f "$CLAIM_LIB" ] && [ -n "$ISSUE_HINT" ]; then
  ISSUE_ID="$("$PYBIN" "$CLAIM_LIB" --root "$ROOT" --issue-of "$ISSUE_HINT" 2>/dev/null | head -1 || true)"  # swallow-ok: 提不到 issue 身份 → 无 claim 分支，纯 legacy（下方零行为变化）
fi
if [ -n "$ISSUE_ID" ]; then
  _CP="$("$PYBIN" "$CLAIM_LIB" --root "$ROOT" --path "$ISSUE_ID" 2>/dev/null | head -1 || true)"  # swallow-ok: 路径查询失败 → 视为无 claim（legacy 继续）
  [ -n "$_CP" ] && [ -f "$_CP" ] && CLAIM_FILE="$_CP"
fi
# 卡 #1423（创始人 2026-10-08「一步到位」裁决）: **默认开** ——
#   未设/真值 ⇒ 开；显式 0|false|off|no|n ⇒ 关（**唯一回滚点**）。
#   口径与单一事实源 claim_store.claim_v2_enabled 逐字对齐。
CLAIM_V2=1
case "$(printf '%s' "${SYNO_CLAIM_V2:-}" | tr '[:upper:]' '[:lower:]')" in
  1|true|on|yes|y) CLAIM_V2=1 ;;
  *) CLAIM_V2=0 ;;
esac
if [ "$CLAIM_V2" = "1" ] && [ -n "$CLAIM_FILE" ]; then
  echo "$CLAIM_FILE"
  exit 0
fi
# claim-first ②: 分支/提交提不到 issue 身份时，按**暂存文件写集命中**兜底（仍需开关）。
# 语义对齐旧认领制（"文件被哪个声明认领就归谁"），但声明载体换成 claim 单库。
if [ "$CLAIM_V2" = "1" ] && [ -z "$CLAIM_FILE" ] && [ -n "$PYBIN" ] && [ -n "$STAGED" ] && [ -f "$CLAIM_LIB" ]; then
  _RP="$("$PYBIN" "$CLAIM_LIB" --root "$ROOT" --resolve-path $(printf '%s' "$STAGED") 2>/dev/null | head -1 || true)"  # swallow-ok: 解析失败/无命中 → 回落 legacy 链（下方逐字节旧行为）
  if [ -n "$_RP" ] && [ -f "$_RP" ]; then
    echo "$_RP"
    exit 0
  fi
fi

# 今日全部 brief (认领候选) — D366: 文件名日期前缀 (mtime 会被 git pull 刷, 不可靠)
# D366: 按文件名日期判断"今日" — 替代 find 按 mtime 的今日判定
# D559 (CT-46 连带): 窗口扩 ±1 天 — CI runner UTC vs brief 日期 UTC+8：北京时间 08-29 写的
#   brief 对 UTC runner 是"明天"，认领被排除 → resolver 回退到认领同文件的陈旧 brief
#   （PR #295 实证：D541 brief 架构层为空 → CI 6 字段红）。D506 时区容差同型。
# 用法: today_files_by_prefix <dir>   # brief: YYYY-MM-DD 文件名前缀 (扫描 *.md)
#       today_files_by_suffix <dir>   # dev doc: -YYYYMMDD.md 文件名后缀 (扫描 SYNOVA-IMPL-*.md)
# 性能: 纯 bash for+case 零子进程 — grep|head 每文件 3 spawn × 349 brief = Windows 分钟级 (实测回退)
# 注意: glob 硬编码在函数内 — 变量中的 * 不会被路径名展开 (实测), 字面 glob 才展开
TODAY_DASH=$(date +%Y-%m-%d)
TODAY_COMPACT=$(date +%Y%m%d)
DATES="$("$PYBIN" -c "from datetime import date, timedelta as td; t=date.today(); print(t-td(days=1), t, t+td(days=1))" 2>/dev/null || echo "$TODAY_DASH")"  # swallow-ok: 窗口计算失败→按仅今日处理（原语义）
DATES_C="$("$PYBIN" -c "from datetime import date, timedelta as td; t=date.today(); print((t-td(days=1)).strftime('%Y%m%d'), t.strftime('%Y%m%d'), (t+td(days=1)).strftime('%Y%m%d'))" 2>/dev/null || echo "$TODAY_COMPACT")"  # swallow-ok: 同上
today_files_by_prefix() {
  local dir="$1" f b d
  dir="${dir%/}"
  [ -d "$dir" ] || return 0
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    b=${f##*/}
    d=${b:0:10}
    case " $DATES " in
      *" $d "*) echo "$f" ;;
    esac
  done
  return 0
}
today_files_by_suffix() {
  local dir="$1" f b d
  dir="${dir%/}"
  [ -d "$dir" ] || return 0
  for f in "$dir"/SYNOVA-IMPL-*.md; do
    [ -e "$f" ] || continue
    b=${f##*/}
    d=${b%.md}; d=${d##*-}
    case " $DATES_C " in
      *" $d "*) echo "$f" ;;
    esac
  done
  return 0
}
ALL_TODAY=$(today_files_by_prefix "$ROOT/.claude/task-briefs/" | sort || true)
# D718: 并入身份锚点 brief（强+弱）——跨日任务即使文件名日期在窗口外也能被认领
if [ -n "$ANCHORED_STRONG_FILES$ANCHORED_WEAK_FILES" ]; then
  ALL_TODAY="$(printf '%s\n%s\n%s\n' "$ALL_TODAY" "$ANCHORED_STRONG_FILES" "$ANCHORED_WEAK_FILES" | grep -v '^$' | sort -u || true)"
fi
[ -z "$ALL_TODAY" ] && [ -n "$CUR" ] && ALL_TODAY="$CUR"

if [ -z "$ALL_TODAY" ] && [ -z "$CUR" ]; then
  exit 1
fi

# ── 认领判定 (单次 python) ──
if [ -z "$PYBIN" ]; then
  # D317: python 不可用 → 无法认领 → 直接走最终回退（回退同样无 python 时 exit 1 fail-open）
  RESULT=""
else
RESULT=$("$PYBIN" -c "
import os, sys
# D317（本轮补齐）: 解析器是**本脚本的兄弟组件**，必须按脚本自身目录定位（PARSER_DIR_W 变量），
#   不得用 $ROOT —— 测试隔离（临时 repo）或 ROOT 与脚本异仓库时 $ROOT 下没有解析器。
#   旧实现误用 $ROOT ⇒ 沙箱里 import 必然失败 ⇒ 静默落到内联副本（夹具测的是副本，不是单源）。
sys.path.insert(0, r'$PARSER_DIR_W')
try:
    from brief_parser import parse_q2, match_path
except ImportError as exc:
    # ── D1241/Step B（#1308 同批）: 去内联副本 → **显式 degraded** ──
    # 旧实现在此复制了一整套 parse_q2/match_path（30 行）。副本与单源必然漂移 —— 实测副本缺:
    #   D543（「path L750」行号后缀剥离）/ D749（`## 写集` 机器块优先）/ claim 分支 /
    #   D1231（Q2 不可匹配形态告警）⇒ 「两处同修」不是收敛，是**两条口径**。
    # 「文件同数认领 1:0 误判」正是两套口径并存的温床（#1308 根因段②）。
    # 语义与本文件其余 python 段一致（锚点回退/日期回退同样 import brief_parser）:
    #   解析器缺失 ⇒ 降级，不猜语义；调用方按 CLAIM_RC≠0 走显式 degraded 提示（不静默）。
    sys.stderr.write('RESOLVER-DEGRADED: brief_parser 不可导入（' + str(exc) + '）→ 认领判定跳过\n')
    sys.exit(3)

staged = [s.strip() for s in '''$STAGED'''.split('\n') if s.strip()]
briefs = [b for b in '''$ALL_TODAY'''.split('\n') if b.strip()]
cur = '''$CUR'''
# D718: 身份锚点文件集（强=分支名/暂存 task-state；弱=current-brief）——仅用于**同数**时的
#   优先级，不改变认领计数语义。共享文件常被多个 brief 同时认领（都改过该文件），
#   旧实现稳定排序 = 字典序 → 日期靠前的陈旧 brief 恒胜 → staging_guard 判「认领 brief D#
#   与本 session 任务不一致」硬阻断（D718 修 pre-doc-audit.sh 时真实被拦一次）。
anchored_strong = set(x.strip() for x in '''$ANCHORED_STRONG_FILES'''.split('\n') if x.strip())
anchored_weak = set(x.strip() for x in '''$ANCHORED_WEAK_FILES'''.split('\n') if x.strip())

claims = []
for b in briefs:
    try:
        text = open(b, encoding='utf-8').read()
    except OSError:
        continue
    # D1231/#1308: 传 source ⇒ 解析器告警可定位到「哪个 brief 的哪一行」（Q2-PARSE-WARN，stderr）。
    # 本循环的认领数语义不变: 不可匹配条目照样进 include 列表，只是**不再静默**（告警不改变 n）。
    scope = parse_q2(text, source=os.path.basename(b))['include']
    n = sum(1 for sf in staged for p in scope if match_path(sf, p))
    claims.append((n, b))

# 1. current-brief 认领 ≥1 → 用它
if cur and any(b == cur and n > 0 for n, b in claims):
    print(cur)
    sys.exit(0)

# 2. 认领数最多的 brief；同数时身份锚点优先（强 → 弱 → 其余按原字典序，无锚点零行为变化）
best = max(n for n, _b in claims) if claims else 0
if best > 0:
    top = [b for n, b in claims if n == best]
    top.sort(key=lambda b: (0 if b in anchored_strong else (1 if b in anchored_weak else 2), b))
    if len(top) > 1 and not (top[0] in anchored_strong or top[0] in anchored_weak):
        # ── D1231/#1308 ④: 「同数按**字典序**」是最弱裁决 —— 让它可见 ──
        # 语义: 认领数并列、且身份锚点（强/弱）全部未命中 ⇒ 胜负纯由文件名字典序决定。
        # D718 记录的误伤源正是这条（陈旧 brief 字典序靠前 ⇒ 恒胜）。
        # 只打标记（stderr），**不改变裁决**（仍取 top[0]）——与 RESOLVER-ANCHOR 同型：把
        # 「身份从哪来」交到消费侧，而不是让它在暗处决定。
        sys.stderr.write('RESOLVER-TIE: 认领数并列 ' + str(best) + '（候选 ' + str(len(top))
                         + ' 个，身份锚点均未命中）→ 按字典序取 ' + os.path.basename(top[0]) + '\n')
    print(top[0])
    sys.exit(0)

# 3. 回退: current-brief
if cur:
    print(cur)
    sys.exit(0)
" || true)
# D1241/Step B: **不再吞 stderr** —— `Q2-PARSE-WARN`（brief_parser）与 `RESOLVER-DEGRADED`
#   必须能上到消费方（commit-msg-check.sh 用 2>"\$RESOLVER_ERR" 分流捕获并透传；旧实现的
#   静默重定向会把「为什么认领是 0」整段丢掉 = #1308 排查被引偏的机制之一）。
fi

if [ -n "$RESULT" ] && [ -f "$RESULT" ]; then
  echo "$RESULT"
  exit 0
fi

# D718: 强锚点回退——认领计数为空时，本提交自身身份（分支名 / 暂存 task-state/D#.json）
# 指向的 brief 优先于「日期最新可解析」。跨日任务若落到下面的纯日期回退，会拿到无关 brief
# （= D328 判「他人文件」硬阻断，D664 实测）。只认可解析的强锚点 brief，缺失则原样下探。
# D-C（K3 R3/R4）: 存在 issue claim（CLAIM_FILE 非空）→ **禁用**本条 D# 强锚点回退。
# 理由: 否则迁移期「分支名带旧 D# + 新 claim 并存」时，新声明被旧锚点劫持（预审 §③ 定罪场景）。
#
# 🔴 D1230/② 口径（K3 R4「分支名劫持」· 提交端半边）:
#   **分支名只作"最弱锚点"** —— 它只能补"没有 brief 认领任何暂存文件"这一空档，
#   不得覆盖任何**由认领/claim 得出的身份**（上面的认领制裁决与 claim-first 段均先于此段）。
#   本段命中时向 **stderr** 打 `RESOLVER-ANCHOR: source=branch-anchor d=<D#> brief=<path>`
#   （stdout 契约不变，仍只输出 brief 路径；标记走 stderr 供消费方判"身份来自最弱锚点"）。
#   **无 claim（迁移期默认态）时的行为写清**: 无 issue 声明时本段**照常生效**（兼容期不误伤旧 D#
#   跨日任务），但其结果**不是权威身份** —— 消费方（commit-msg-check.sh）必须以
#   「与提交消息的声明比对」为准，冲突即 fail-closed（见该文件 R4 段）。
if [ -z "$CLAIM_FILE" ] && [ -n "$ANCHORED_STRONG_FILES" ] && [ -n "$PYBIN" ]; then
  RESULT=$("$PYBIN" -c "
import sys
sys.path.insert(0, r'$PARSER_DIR_W')
from brief_parser import parse_criteria

for b in '''$ANCHORED_STRONG_FILES'''.split('\n'):
    b = b.strip()
    if not b:
        continue
    try:
        text = open(b, encoding='utf-8', errors='replace').read()
    except OSError:
        continue
    if parse_criteria(text):
        print(b)
        sys.exit(0)
sys.exit(1)
" 2>/dev/null || true)
  if [ -n "$RESULT" ] && [ -f "$RESULT" ]; then
    echo "$RESULT"
    # D1230/②: 最弱锚点可见化（stderr；stdout 契约不变）
    _ANCH_D=$(basename "$RESULT" | grep -oE '[Dd][0-9]+' | head -1 | tr 'a-z' 'A-Z' || true)  # swallow-ok: 文件名提不到 D# → 标记里留空（消费方按"无锚点身份"处理，不静默当一致）
    echo "RESOLVER-ANCHOR: source=branch-anchor d=${_ANCH_D:-none} brief=$RESULT" >&2
    exit 0
  fi
fi

# D317 最终回退: 最新日期 → 最早, 用 brief_parser 验证可解析性 (criteria A-D),
# 选第一个可解析的。全部不可解析或 python 不可用 → exit 1 (fail-open → G12b 跳过),
# 绝不静默返回坏 brief。
# 背景: CI 干净检出无 staged → 认领为空 → 旧逻辑按日期前缀选最新 = D286 (旧格式,
# criteria=null) → G12b 硬阻断 → Iron Laws 红 (D317 根因)。
# 注意: 不能按 mtime — CI 干净检出时所有文件 mtime 相同 (phase34-nodate.md 事故)。
# 性能: 单次 python 批量解析（281 文件 × 逐文件起 python 进程 = 分钟级超时）。
if [ -z "$PYBIN" ]; then
  exit 1
fi
# D-C（K3 R3/R4 收口，verifier 插桩发现）: **D317 日期回退同样要受防劫持守卫**。
# 病根: 强锚点回退加了守卫，但"日期回退"这条**无守卫** ⇒ 回滚态（开关关 + 仓库有 claim）
#   仍会走到这里挑一个**日期最新**的 brief —— 即"守卫生效了，但解析器继续走到无守卫路径"，
#   回滚态与头注承诺（"存在 claim 即不劫持"）不一致。一处守卫补全，开关语义不变。
# CLAIM_FILE 非空（本任务身份可定位到 claim）⇒ 不再做日期猜测：宁可 exit 1（fail-closed，
#   由调用方按三态处理），也不返回一个**与本次任务无关**的 brief。
if [ -n "$CLAIM_FILE" ]; then
  exit 1
fi
RESULT=$("$PYBIN" -c "
import os, re, sys
sys.path.insert(0, r'$PARSER_DIR_W')
from brief_parser import parse_criteria

briefs = []
for f in os.listdir(r'$ROOT/.claude/task-briefs/'):
    if not f.endswith('.md'):
        continue
    m = re.match(r'(\d{4}-\d{2}-\d{2})', f)
    if m:
        briefs.append((m.group(1), f))
briefs.sort(key=lambda x: x[0], reverse=True)
for _d, _f in briefs:
    try:
        text = open(os.path.join(r'$ROOT/.claude/task-briefs/', _f), encoding='utf-8', errors='replace').read()
    except OSError:
        continue
    if parse_criteria(text):
        print(os.path.join(r'$ROOT/.claude/task-briefs/', _f))
        sys.exit(0)
sys.exit(1)
" 2>/dev/null || true)
[ -n "$RESULT" ] && { echo "$RESULT"; exit 0; }
exit 1
