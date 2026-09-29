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
# D1069 规范 3（队长裁决 · 两级定位）: D#→brief 定位按「一级身份集 / 二级提及集」分级。
# ── 一级「身份集」= 文件名 basename 中「第一个」D<digits> token == 锚点 D#（briefs_by_id）。
#   旧实现用 glob *-D<id>-*（要求首 D# 后紧跟分隔符）→ 文件名形如
#   `2026-08-22-D471.md` / `D311-multi-session-coordination.md` / `D808.md` 的 brief
#   对**其自身** D# 物理不可达（实测 19 例，见 brief Q0b 与 D1069-C1C5 原始输出）。
#   边界对齐 alloc-task-id.sh:191 `(^|[^0-9a-z])d<num>([^0-9]|$)`（该处 grep -i ⇒ 大小写无关）：
#     左边界 = 串首 或 前一字符非 [0-9A-Za-z]；右边界 = 数字串止于串尾或非数字（内层循环已保证）。
# ── 二级「提及集」= 锚点 D# 出现在**非首位**（briefs_by_id_mention = 旧 glob 语义）。
#   合卡 brief（D313-D314-control-tower-finalize.md）的 D314 无独立身份件，纯一级会让
#   task-state/D314.json 彻底失去锚点 → 故二级只在「一级为空」时兜底。
#   而 2026-09-29-D1064-FIX-D1032-*.md 的 D1032 有真身份件 → 一级即命中，消除旧 glob 双命中歧义。
# 性能: 纯 bash 逐字符扫描（零子进程）—— 每文件 1 次 grep 在 Windows ×160 brief 是分钟级。
briefs_by_id() {
  local ids="$1" id f b len i j ch prev num
  [ -z "$ids" ] && return 0
  for id in $ids; do
    for f in "$ROOT/.claude/task-briefs/"*.md; do
      [ -e "$f" ] || continue
      b=${f##*/}
      len=${#b}; i=0; num=""
      while [ "$i" -lt "$len" ]; do
        ch="${b:$i:1}"
        if [ "$ch" = "d" ] || [ "$ch" = "D" ]; then
          prev=""
          [ "$i" -eq 0 ] || prev="${b:$((i - 1)):1}"
          if [ -z "$prev" ] || [ -n "${prev//[0-9A-Za-z]/}" ]; then
            j=$((i + 1)); num=""
            while [ "$j" -lt "$len" ]; do
              ch="${b:$j:1}"
              case "$ch" in
                [0-9]) num="$num$ch" ;;
                *) break ;;
              esac
              j=$((j + 1))
            done
            [ -n "$num" ] && break
          fi
        fi
        i=$((i + 1))
      done
      [ -n "$num" ] && [ "$num" = "$id" ] && echo "$f"
    done
  done
  return 0
}
# 二级「提及集」—— 保留旧 glob *-D<id>-* 语义（首 D# 后紧跟分隔符），仅在身份集为空时兜底。
# 不参与 P0 定案（P0 只认一级身份集），只入候选池 / 参与同数 tie-break。
briefs_by_id_mention() {
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
# 候选池 + tie-break 集合: 一级非空 ⇒ 一级（消除双命中歧义）；一级为空 ⇒ 二级（保住合卡覆盖）。
# P0 的身份集在下方注入缝内单独计算（缝外不得引用缝内变量）。
ANCHORED_STRONG_FILES="$(briefs_by_id "$ANCHOR_IDS_STRONG" | sort -u || true)"
if [ -z "$ANCHORED_STRONG_FILES" ]; then
  ANCHORED_STRONG_FILES="$(briefs_by_id_mention "$ANCHOR_IDS_STRONG" | sort -u || true)"
fi
ANCHORED_WEAK_FILES="$(briefs_by_id "$ANCHOR_IDS_WEAK" | sort -u || true)"

# ── D1069 规范 1: P0 强锚点优先级（显式优先级 > 启发投票）─────────────────────────
# 第一性原理（证据分级）: ①自证级 = 本提交自身的载荷（暂存 task-state/D<id>.json 就是本次
#   提交的 D# 声明）+ 分支名（本 session 的任务声明）；③启发级 = 日期窗口 + 路径认领计数。
#   修复前 ③ 恒压 ① —— 锚点只在「同数」时 tie-break（:230）、只在认领全空时末位回退（:246），
#   故 D1061 自己的提交被 D1039 的陈旧 brief（ci.yml 在 Q2 写了 4 次）劫持。
# P0: **一级身份集**（文件名首 D# token == 锚点 D#）的 brief 存在且 parse_criteria 通过
#   ⇒ 直接输出，不再进入认领计数。二级「提及集」（次位交叉引用）P0 不认 —— 只入候选池 /
#   参与同数 tie-break（队长裁决 规范 3 两级定位）。
# D# 来源优先级（规范 1）: 暂存 task-state/D<id>.json  >  分支名 D#。
# 降级（规范 1/5）: 无锚点 ⇒ 本块零 spawn（不进 python）；锚点 brief 缺失或不可解析 ⇒ 下探
#   P1..P4，不阻断，行为与修复前一致（绝不静默返回坏 brief）。
# 注: 本块是规范 4「改坏即红」注入缝 —— 测试方按标记区间 sed 删除构造变异副本，故块外
#   不得引用块内变量（块内变量一律以 p0 前缀命名，删除后块外零残留引用），且本块不得
#   依赖块外的 RESULT 初值。P0 用到的身份集在本缝内就地计算（不复用缝外变量）。
# <<<ANCHOR-PRIORITY-START>>>
_p0_state_ids="$(_ids_of "$(printf '%s\n' "$STAGED" | grep -oE 'task-state/D[0-9]+\.json' || true)")"
_p0_branch_ids="$(_ids_of "$BR_CUR")"
# 一级身份集，按来源优先序拼接：暂存 task-state D# 优先，其后分支名 D#（顺序即优先级）。
_p0_files="$(printf '%s\n%s\n' \
  "$(briefs_by_id "$_p0_state_ids" | sort -u || true)" \
  "$(briefs_by_id "$_p0_branch_ids" | sort -u || true)")"
if [ -n "$PYBIN" ] && [ -n "${_p0_state_ids}${_p0_branch_ids}" ]; then
  RESULT=$("$PYBIN" -c "
import sys
sys.path.insert(0, r'$PARSER_DIR_W')
from brief_parser import parse_criteria

seen = set()
for b in '''$_p0_files'''.split(chr(10)):
    b = b.strip()
    if not b or b in seen:
        continue
    seen.add(b)
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
    exit 0
  fi
fi
# <<<ANCHOR-PRIORITY-END>>>

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
import re, sys
sys.path.insert(0, r'$ROOT/scripts/control-tower')
try:
    from brief_parser import parse_q2, match_path
except ImportError:
    # fail-open: 解析器缺失 → 降级到内联语义（不阻断认领流程）
    def parse_q2(text):
        paths = []
        in_q2 = in_inc = False
        for line in text.split('\n'):
            line = line.rstrip('\r')
            if re.match(r'^## Q2:', line):
                in_q2 = True
                in_inc = False
                continue
            if in_q2 and re.match(r'^## ', line):
                break
            if in_q2 and re.match(r'^不做什么', line):
                in_inc = False
                continue
            if in_q2 and re.match(r'^做什么', line):
                in_inc = True
                continue
            if in_q2 and in_inc and line.startswith('- '):
                # D521/不变量3: 与 brief_parser.parse_q2 同步剥壳（动词前缀 + 括号描述）
                raw = re.sub(r'^(修改|新增|新建|修复|扩展|实现|更新|重构|升级|创建|编写|增加|优化|调整|添加|改)\s*', '', line[2:])
                p = raw.split(':', 1)[0].split('：', 1)[0].split(' — ', 1)[0].strip()
                p = re.split(r'[（(]', p, 1)[0].strip()
                if p:
                    paths.append(p)
        # D329: 对齐 brief_parser.parse_q2 契约（返回 dict）——旧实现返回 list，
        # 调用方 parse_q2(text)['include'] 在解析器缺失路径上 TypeError → 认领恒空
        # 注意: 本段嵌入 bash 双引号串，python 字符串必须用单引号（勿在注释写双引号）
        return {'include': paths, 'exclude': []}
    def match_path(path, pat):
        return re.search(r'(^|/)' + re.escape(pat) + r'\$', path) is not None

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
    # D1069 规范 2: 认领计数 = 去重文件数 —— scope 去空去重 × staged 去空去重，每文件至多计 1。
    # 不变式: 同一路径在 Q2 写 N 次 ⇒ 对任一暂存文件贡献恒为 1（修复前 = (staged × scope) 出现
    #   次数，D1039 brief 的 ci.yml 在 Q2 出现 4 次 → 单文件暂存即可得 n=4，压过真身锚点）。
    scope = sorted({p.strip() for p in parse_q2(text)['include'] if p.strip()})
    n = sum(1 for sf in sorted({s.strip() for s in staged if s.strip()})
            if any(match_path(sf, p) for p in scope))
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
    print(top[0])
    sys.exit(0)

# 3. 回退: current-brief
if cur:
    print(cur)
    sys.exit(0)
" 2>/dev/null || true)
fi

if [ -n "$RESULT" ] && [ -f "$RESULT" ]; then
  echo "$RESULT"
  exit 0
fi

# D718: 强锚点回退——认领计数为空时，本提交自身身份（分支名 / 暂存 task-state/D#.json）
# 指向的 brief 优先于「日期最新可解析」。跨日任务若落到下面的纯日期回退，会拿到无关 brief
# （= D328 判「他人文件」硬阻断，D664 实测）。只认可解析的强锚点 brief，缺失则原样下探。
if [ -n "$ANCHORED_STRONG_FILES" ] && [ -n "$PYBIN" ]; then
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
