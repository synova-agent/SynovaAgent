#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# verify-doc-budgets.sh — G-DOC-1 指令面体积预算判据（W0-1 / P2-b）
# 任务: "#1238"（登记门禁 R2 的 Issue 来源派生点；仅加注此行，判据逻辑未改）
# 真源: docs/authority/GATE-STANDARD.md v3.1 §五「文档治理」＋§七「加／改」
#
# @nature: mechanical
#
# 设计哲学（一句）: **判据面 = 指令面，可见面 = docs 全量** ——
#   只对「根 AGENTS.md ＋ 13 份域守则」下判决，docs/** 全量只报不判；
#   看不见（缺件／不可读／零文件）一律 exit 2，绝不把「判不了」当「没问题」。
#
# 契约（铁律 47）:
#   @usage   bash scripts/doc-system/verify-doc-budgets.sh [--root <dir>] [--check] [--selfcheck] [--help]
#   @input   · root = `--root <dir>`；缺省 = 本脚本位置上溯两级（即 `<repo>/`），**不经 git、不依赖 cwd**；
#            · 判据面清单 = 根 `AGENTS.md` ＋ 内嵌 13 份域守则（出处 = 根 AGENTS.md §0 索引表；
#              基线 @a025fc47e 实测 13/13 在库）；清单内文件缺一 ⇒ exit 2（禁静默跳过）；
#            · 只报不判面 = 递归 `docs/**` 的 `.md` ＋ `.html` 件数与总字节
#              （实现 = `find … -exec wc -c {} +`，丢弃 wc 的 `… total` 汇总行以免双计）。
#   @output  · 判据面逐条: `✅ <path> <bytes> B ≤ <cap> B` /
#              `❌ E_BUDGET_OVER: <path> <bytes> B > <cap> B（超 <d> B · <口径>）`
#            · 合计行: `指令面合计: <total> B ／ 上限 65536 B ／ 域守则 13 份（单份最大 <file> <bytes> B）`
#            · 只报不判行: `docs/** 全量: <n> 件 / <bytes> B（.md <a> 件 / <b> B ｜ .html <c> 件 / <d> B）`
#            · 结论行: `BUDGETS: OK <pass>/<checked> …` 或 `BUDGETS: VIOLATION <n>`
#   @exit    · 0 = 判据面每一件 ＋ 合计都在预算内
#            · 1 = 有超限（逐条点名 E_BUDGET_OVER，区分「单份上限」「根件上限」「合计口径」）
#            · 2 = 判不了：`--root` 不存在／根 `AGENTS.md` 缺失／清单内域守则缺失／
#                  `docs/` 缺失／`docs/` 内 .md+.html 件数==0（见 Known Limitations 7：今天不可达，
#                  保留为守卫）／文件不可读（`wc -c` 读不到 ⇒ 该件判不了）／
#                  `docs/**` 统计出现 find/wc 报错（统计不完整 ⇒ 判不了）或统计不可解析／
#                  未知参数／内部异常／`--selfcheck` 自检失败
#   @degraded stderr `degraded: <CODE> — <原因>` ＋ 追加一行 JSON 到 `$SYNO_GATE_DEGRADED_LOG`
#            （默认 `<root>/.codex/control-tower/logs/degraded-events.log`；字段
#            time/component/code/phase/retryable；铁律 11/31/32；禁静默降级），随后 exit 2
#   @error   code ∈ {E_USAGE, E_NO_ROOT, E_MISSING_AGENTS, E_MISSING_DOMAIN, E_NO_DOCS, E_NO_FILES,
#                   E_UNREADABLE, E_BUDGET_OVER, E_SELFCHECK, E_INTERNAL}
#
# 阈值（写死在文件顶部常量，运行期无参数可放宽；判据归 GATE-STANDARD §五/§七，不由本器改判）:
#   CAP_DOMAIN=3584 B（13 份域守则每份 ≤3.5KB）｜ CAP_ROOT=65536 B（根件）｜ CAP_TOTAL=65536 B（合计）
#   🔴 本文件**不写死任何实测值**：指令面合计／单份最大／docs 件数与字节一律运行期算，
#      否则文件一改（域守则每批都在动）注释里的数字就漂移成第二个口径。
#
# 判据语义（G-DOC-1）:
#   · 判据面**两个口径都判**：① 逐件比单份上限（域守则 3584 B／根件 65536 B）；
#     ② 再判一次指令面合计（≤65536 B）。任一超 ⇒ exit 1 并逐条点名，两条口径不互相抵销
#     （例：根件 30000 B + 13×3584 B = 76592 B 时单件全绿、合计仍红）。
#   · `docs/**` 只打印，**不参与 rc**（双测口径：门禁按指令面判，docs 全量只报不判）。
#   · `docs/AGENTS.md` 是判据面一件且位于 `docs/` 之内 ⇒ `docs/` 缺失时**必先报 E_NO_DOCS**
#     （检查顺序固定的结果），不会同时报 E_MISSING_DOMAIN —— 两种缺件语义同一原因，报一个即可。
#   · 阈值是 GATE-STANDARD 的判据，本器**不放宽、不参数化**：要改阈值回 L1/CTO，不在命令行开口子。
#
# Explicit authority（谁能调）:
#   · 本批（W0-1 P2-b）**不接** pre-commit 组、**不接** CI 腿 —— 调用点只有
#     配对测试 `tests/doc-system/verify-doc-budgets.test.sh`、自身 `--selfcheck` 与 L1/L2 手跑；
#   · 接线（进 pre-commit 组／CI 腿）属后续 task，须走 A 类判据变更（提案 ＋ 独立送审）；
#   · 任何人可手工只读运行：不写任何被检文件；唯一可能落盘 = 降级日志（.codex/，不入库）。
#
# 已知限制（Known Limitations）:
#   1. 只统计**字节**（`wc -c`）：预算就是字节预算，不做 token／字数换算；
#      因此"3000 个汉字 vs 3000 个 ASCII 字符"在本器眼里差 3 倍，这符合真源口径但不等于"信息量"。
#   2. 域守则清单**内嵌写死**：新增／删除域守则必须同批改本文件清单，否则本器会以
#      E_MISSING_DOMAIN（删了）或"漏判新增件"（加了没登记）的方式漂移；
#      清单不自动从根 AGENTS.md §0 索引表解析（解析文档表格反而更脆）。
#   3. `--root` 不经 git 归一，也不校验"这是不是本仓"：任何带 `AGENTS.md`＋`docs/` 的目录同权可跑
#      ⇒ **本器 rc=0 不能证明"跑的是主干"**，只证明"这个目录的这 14 份文件在预算内"。
#   4. 「只报不判」面靠丢弃 `wc` 的 `… total` 汇总行防双计：路径本身以 ` total` 结尾的文件会被漏计
#      （概率极低但属真实边界）；件数只算 `.md`/`.html`，其余扩展名（json/yaml/png…）**不进统计**。
#   5. **调用点只证明"被某处调用"，不证明"挂在阻断腿上"**：本批无任何 pre-commit 组／CI 腿引用本器
#      ⇒ G-DOC-1 的生效性仍是 declared-only；`verify-doc-gate-effectiveness.sh` 会把本器判为
#      "实现存在但无生产调用点"，那是事实，不是缺陷。
#   6. 不判「跨仓预算」（handbook 仓指令面不在此列），也不判「单份域守则的行数上限」。
#   7. 「docs/ 内 0 件可统计」这一态**今天结构性不可达**：`docs/AGENTS.md` 本身是判据面一件、
#      也是 `docs/` 内一份 `.md`，而 `docs/**` 统计**包含它**（因此主干 docs 件数/字节里含这 1 份）。
#      缺 docs/ ⇒ 先报 E_NO_DOCS；缺那 1 份 ⇒ 先报 E_MISSING_DOMAIN ⇒ 走不到「0 件」。
#      该分支保留为守卫（防将来清单变更后统计静默归零仍判 0），配对测试不以它作可达态断言。
#   8. docs 件数/字节只覆盖 `.md`/`.html`：`docs/` 下 json/yaml/png/csv 等不进统计，
#      因此本行数字**不等于** `du -sb docs`；它是"文档面可见规模指标"，不是磁盘占用。
#   9. **每次调用在本机（Windows + Git Bash 5.3）实测 ≈12 s**（同夹具连跑 3 次：12227／12011／11140 ms，
#      rc 全 0），成本主要在子进程启动（`find`/`wc`/`awk`/`date` 每起一次都有 Windows 进程开销），
#      不是本器算法。⇒ **接 pre-commit 前必须先核耗时预算**（GATE-STANDARD §七：pre-commit ≤90 s），
#      本批因此**不接** pre-commit／CI（见 Explicit authority）。
#
# Source map（段锚点 → 职责；在本文件内 grep 锚点即可定位）:
#   | 段锚点 | 职责 |
#   |---|---|
#   | 常量区 `CAP_DOMAIN=` | 三个阈值（唯一真源在本文件，测试用 sed 变异证明"改小必红"）|
#   | `DOMAIN_RULES=(` | 13 份域守则清单（出处 根 AGENTS.md §0 索引表）|
#   | `degraded()` | stderr 一行 ＋ JSON 一行到 SYNO_GATE_DEGRADED_LOG（唯一降级出口）|
#   | `docstat()` | docs/** 单扩展名 件数＋字节（丢 total 行）|
#   | `mk_sandbox()` | 自检/夹具沙箱构造（缺 docs／缺根件／丢某份域守则）|
#   | `# ── ① 参数解析` | --root / --check / --selfcheck / --help；未知参数 ⇒ E_USAGE |
#   | `# ── ② 判别力自检` | 沙箱造 合规／单份超限／缺 docs／缺根件／缺域守则／未知参数 六态，断言 0/1/2 |
#   | `# ── ③ 检查` | 判据面逐件比对 ＋ docs 只报不判 ＋ 结论行 |
#   | `# ── ④ 出口` | rc 0/1 透传；rc 2 走 degraded（判不了 ≠ 通过）|
# ═══════════════════════════════════════════════════════════════════════════════
set +e

COMPONENT="verify-doc-budgets"

# ── 阈值（@mutate-point: caps —— 测试用 sed 改小 CAP_DOMAIN 证明"改坏必红"）──────────
CAP_DOMAIN=3584    # 单份域守则 ≤3.5KB
CAP_ROOT=65536     # 根 AGENTS.md
CAP_TOTAL=65536    # 指令面合计

# ── 判据面清单（13 份域守则；出处 = 根 AGENTS.md §0 索引表）─────────────────────────
DOMAIN_RULES=(
  extensions/sentinels/AGENTS.md
  extensions/AGENTS.md
  scripts/control-tower/AGENTS.md
  tests/control-tower/AGENTS.md
  docs/AGENTS.md
  .gitea/AGENTS.md
  src/l4/AGENTS.md
  src/routes/AGENTS.md
  memory/notes/AGENTS.md
  src/agent/AGENTS.md
  src/l3/AGENTS.md
  expert/AGENTS.md
  electron-renderer/AGENTS.md
)
DOMAIN_COUNT="${#DOMAIN_RULES[@]}"
DOMAIN_EXPECT=13

SELF="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"  # swallow-ok: cd 失败时 SELF 只用于推默认根，推不出会由下一段 `[ -n "$ROOT" ] || degraded E_NO_ROOT` 显式 exit 2
ROOT=""
ROOT_GIVEN=0
DEG_LOG=""
DEG_LOG_OVERRIDE="${SYNO_GATE_DEGRADED_LOG:-}"

# degraded <CODE> <原因> [phase] —— 唯一降级出口：先 stderr 可见，再落 JSON 一行，最后 exit 2
degraded() {
  local code="$1" reason="$2" phase="${3:-resolve}"
  if [ -z "$DEG_LOG" ]; then
    DEG_LOG="${DEG_LOG_OVERRIDE:-${ROOT:-$PWD}/.codex/control-tower/logs/degraded-events.log}"
  fi
  echo "degraded: ${code} — ${reason}" >&2
  if mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null; then  # swallow-ok: 目录不可建走 else 显式提示（不吞）
    printf '{"time":"%s","component":"%s","code":"%s","phase":"%s","retryable":true}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COMPONENT" "$code" "$phase" >> "$DEG_LOG" 2>/dev/null || true  # swallow-ok: 日志写失败不改判定（stderr 已可见）
  else
    echo "degraded: 降级日志目录不可建（$DEG_LOG）—— 判定仍为 2" >&2
  fi
  exit 2
}

file_bytes() { # $1=path → 打印字节数；不可读 ⇒ 打印空（空由调用方显式转成 degraded E_UNREADABLE）
  # 不吞 stderr：wc 读不到时的报错原样可见；"读不到"由调用点 `[ -n "$B" ] || degraded E_UNREADABLE` 承接
  # （见 §③ 根件 与 域守则循环 两处，均紧随其后判空 → exit 2）。
  wc -c < "$1" | tr -d ' \r\n'
}

docstat() { # $1=dir $2=glob $3=stderr 落盘文件（**必传**）→ 打印 "<件数> <总字节>"
  # 丢 wc 的 `… total` 汇总行以防双计；**不吞 stderr**：find/wc 的报错写进 $3，
  # 由调用点"$3 非空 ⇒ degraded E_UNREADABLE"承接（见 §③ 只报不判面 的 DOC_ERR 判空）。
  # shellcheck disable=SC2016  # awk 程序体在单引号内，$1 是 awk 字段不是 shell 变量
  find "$1" -type f -name "$2" -exec wc -c {} + 2>"$3" \
    | awk '$0 !~ /[ \t]total$/ {n++; s+=$1} END {printf "%d %d\n", n+0, s+0}'
}

mk_sandbox() { # $1=dir [--no-docs] [--no-agents] [--drop <rel>]  沙箱构造（自检与测试共用契约）
  local d="$1"; shift
  local no_docs=0 no_agents=0 drop=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-docs)   no_docs=1; shift ;;
      --no-agents) no_agents=1; shift ;;
      --drop)      drop="${2:-}"; shift 2 ;;
      *)           return 1 ;;
    esac
  done
  mkdir -p "$d" || return 1
  if [ "$no_agents" -eq 0 ]; then
    printf '# 夹具根件 AGENTS.md\n\n> 沙箱夹具，仅用于判别力自检／配对测试。\n' > "$d/AGENTS.md" || return 1
  fi
  local rel
  for rel in "${DOMAIN_RULES[@]}"; do
    if [ "$rel" = "$drop" ]; then continue; fi
    mkdir -p "$d/$(dirname "$rel")" || return 1
    printf '# 夹具域守则 %s\n\n> 沙箱夹具。\n' "$rel" > "$d/$rel" || return 1
  done
  if [ "$no_docs" -eq 0 ]; then
    mkdir -p "$d/docs" || return 1
    printf '# 夹具文档\n\n沙箱夹具。\n' > "$d/docs/fixture.md" || return 1
  else
    # 注意：`docs/AGENTS.md` 本身就是判据面一件 ⇒ 造"缺 docs/"必须整目录删（连带删该件）。
    # 这正是真实缺件形态；检查顺序里 E_NO_DOCS 先于域守则循环，故不会被 E_MISSING_DOMAIN 抢先。
    rm -rf "$d/docs" || return 1
  fi
  return 0
}

# ── ① 参数解析 ─────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      [ $# -ge 2 ] || degraded E_USAGE "--root 缺参数值" usage
      ROOT="$2"; ROOT_GIVEN=1; shift 2 ;;
    --check)
      shift ;;
    --selfcheck)
      SELFCHECK=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^set \+e$/{exit} NR>1' "$0"; exit 0 ;;
    *)
      degraded E_USAGE "未知参数: $1（支持 --root/--check/--selfcheck/--help）" usage ;;
  esac
done

[ "$DOMAIN_COUNT" -eq "$DOMAIN_EXPECT" ] \
  || degraded E_INTERNAL "内嵌域守则清单 ${DOMAIN_COUNT} 份 ≠ ${DOMAIN_EXPECT} 份（清单被改坏，判不了）" env

# ── ② 判别力自检（--selfcheck：沙箱造多态并断言三态，末行 SELFCHECK-OK）─────────────
if [ "${SELFCHECK:-0}" -eq 1 ]; then
  SB="$(mktemp -d 2>/dev/null)"  # swallow-ok: 失败由下一行显式 degraded
  { [ -n "$SB" ] && [ -d "$SB" ]; } || degraded E_SELFCHECK "mktemp -d 失败（无法建自检沙箱）" selfcheck
  trap 'rm -rf "$SB"' EXIT
  SC_PASS=0
  SC_FAIL=0
  sc_ok() { echo "  ✅ $1"; SC_PASS=$((SC_PASS + 1)); }
  sc_no() { echo "  ❌ $1"; SC_FAIL=$((SC_FAIL + 1)); }
  SC_LAST="$SB/last.out"
  # sc_run: 命令替换是子壳 ⇒ 函数内的 SC_OUT 传不回来（2026-10-31 实测踩过）⇒ 子进程输出一律落文件
  sc_run() { # $1=root [额外参数…] → 跑自身（降级日志落沙箱外），stdout+stderr 写 $SC_LAST，回显 rc
    local _r="$1"; shift
    SYNO_GATE_DEGRADED_LOG="$SB/degraded.log" bash "$SELF" --root "$_r" "$@" > "$SC_LAST" 2>&1
    echo $?
  }
  sc_has() { grep -qF -- "$1" "$SC_LAST"; }
  sc_tail() { sed -n '1,400p' "$SC_LAST" | tail -6 | tr '\n' ' '; }  # 失败时贴原始输出尾段
  echo "── verify-doc-budgets --selfcheck: 判别力自检（三态 0/1/2）──"
  echo "沙箱: $SB"

  # ① 合规 ⇒ 0
  mk_sandbox "$SB/ok" || degraded E_SELFCHECK "沙箱构造失败: 合规态" selfcheck
  RC="$(sc_run "$SB/ok")"
  [ "$RC" -eq 0 ] && sc_ok "① 合规沙箱 ⇒ exit 0" \
    || sc_no "① 合规沙箱应 exit 0，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'BUDGETS: OK' \
    && sc_ok "① 合规沙箱打印结论行 BUDGETS: OK" || sc_no "① 合规沙箱缺结论行；原始输出: $(sc_tail)"

  # ② 单份超限 ⇒ 1 且点名该文件
  mk_sandbox "$SB/over" || degraded E_SELFCHECK "沙箱构造失败: 超限态" selfcheck
  OVER_BYTES="$((CAP_DOMAIN + 416))"
  awk -v n="$OVER_BYTES" 'BEGIN{for(i=0;i<n;i++)printf "x"}' > "$SB/over/expert/AGENTS.md" \
    || degraded E_SELFCHECK "沙箱造超限文件失败" selfcheck
  [ "$(file_bytes "$SB/over/expert/AGENTS.md")" = "$OVER_BYTES" ] \
    || degraded E_SELFCHECK "夹具自身不达标（超限文件字节 ≠ ${OVER_BYTES}）—— 自检不可信" selfcheck
  RC="$(sc_run "$SB/over")"
  [ "$RC" -eq 1 ] && sc_ok "② 单份超限（${OVER_BYTES} B > ${CAP_DOMAIN} B）⇒ exit 1" \
    || sc_no "② 单份超限应 exit 1，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'E_BUDGET_OVER: expert/AGENTS.md' \
    && sc_ok "② 点名 E_BUDGET_OVER: expert/AGENTS.md" || sc_no "② 未点名超限文件；原始输出: $(sc_tail)"

  # ③ 缺 docs ⇒ 2（且 degraded 行可见）
  mk_sandbox "$SB/nodocs" --no-docs || degraded E_SELFCHECK "沙箱构造失败: 缺 docs 态" selfcheck
  RC="$(sc_run "$SB/nodocs")"
  [ "$RC" -eq 2 ] && sc_ok "③ 缺 docs/ ⇒ exit 2" \
    || sc_no "③ 缺 docs/ 应 exit 2，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'degraded: E_NO_DOCS' \
    && sc_ok "③ degraded: E_NO_DOCS 可见" || sc_no "③ 缺 degraded: E_NO_DOCS；原始输出: $(sc_tail)"

  # ④ 缺根 AGENTS.md ⇒ 2
  mk_sandbox "$SB/noagents" --no-agents || degraded E_SELFCHECK "沙箱构造失败: 缺根件态" selfcheck
  RC="$(sc_run "$SB/noagents")"
  [ "$RC" -eq 2 ] && sc_ok "④ 缺根 AGENTS.md ⇒ exit 2" \
    || sc_no "④ 缺根 AGENTS.md 应 exit 2，实际 ${RC}；原始输出: $(sc_tail)"

  # ⑤ 清单内域守则缺一份 ⇒ 2（禁静默跳过）
  mk_sandbox "$SB/drop" --drop src/l3/AGENTS.md || degraded E_SELFCHECK "沙箱构造失败: 缺域守则态" selfcheck
  RC="$(sc_run "$SB/drop")"
  [ "$RC" -eq 2 ] && sc_ok "⑤ 清单内缺 src/l3/AGENTS.md ⇒ exit 2" \
    || sc_no "⑤ 缺域守则应 exit 2，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'E_MISSING_DOMAIN' \
    && sc_ok "⑤ 点名 E_MISSING_DOMAIN" || sc_no "⑤ 未点名 E_MISSING_DOMAIN；原始输出: $(sc_tail)"

  # ⑥ 未知参数 ⇒ 2（E_USAGE；三态里"用错"也不能算通过）
  RC="$(sc_run "$SB/ok" --bogus-flag)"
  [ "$RC" -eq 2 ] && sc_ok "⑥ 未知参数 ⇒ exit 2" \
    || sc_no "⑥ 未知参数应 exit 2，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'degraded: E_USAGE' \
    && sc_ok "⑥ degraded: E_USAGE 可见" || sc_no "⑥ 缺 degraded: E_USAGE；原始输出: $(sc_tail)"

  echo "SELFCHECK: ${SC_PASS}/$((SC_PASS + SC_FAIL)) 通过"
  if [ "$SC_FAIL" -gt 0 ]; then
    degraded E_SELFCHECK "判别力自检 ${SC_FAIL} 条断言失败（自检自身不可信 ⇒ exit 2，禁当通过）" selfcheck
  fi
  echo "SELFCHECK-OK"
  exit 0
fi

# ── ③ 检查 ─────────────────────────────────────────────────────────────────
if [ "$ROOT_GIVEN" -eq 1 ]; then
  [ -d "$ROOT" ] || degraded E_NO_ROOT "--root 目录不存在: $ROOT" usage
  ROOT="$(cd "$ROOT" && pwd)"  # swallow-ok: 存在性已上行显式判过
else
  ROOT="$(cd "$(dirname "$SELF")/../.." && pwd)"  # swallow-ok: 脚本自身位置必可达
  [ -n "$ROOT" ] || degraded E_NO_ROOT "无法由脚本位置推出仓根（$SELF）" env
fi

AGENTS="$ROOT/AGENTS.md"
DOCS="$ROOT/docs"
[ -f "$AGENTS" ] || degraded E_MISSING_AGENTS "根 AGENTS.md 不存在（判不了 ⇒ 2）: $AGENTS" scan
[ -d "$DOCS" ]   || degraded E_NO_DOCS "docs/ 目录不存在（只报不判面 0 数据 ⇒ 判不了）: $DOCS" scan

echo "── verify-doc-budgets: G-DOC-1 指令面体积预算（GATE-STANDARD v3.1 §五/§七）──"
echo "root: $ROOT"
echo "阈值: 域守则 ≤${CAP_DOMAIN} B/份 ｜ 根件 ≤${CAP_ROOT} B ｜ 合计 ≤${CAP_TOTAL} B"
echo "[判据面 · 影响 rc]"

TOTAL=0
CHECKED=0
PASS=0
OVER=0
MAXB=0
MAXF=""

# 根件
RB="$(file_bytes "$AGENTS")"
[ -n "$RB" ] || degraded E_UNREADABLE "根 AGENTS.md 不可读（wc -c 失败）: $AGENTS" scan
CHECKED=$((CHECKED + 1))
TOTAL=$((TOTAL + RB))
if [ "$RB" -gt "$CAP_ROOT" ]; then
  printf '❌ E_BUDGET_OVER: AGENTS.md %d B > %d B（超 %d B · 根件上限）\n' "$RB" "$CAP_ROOT" "$((RB - CAP_ROOT))"
  OVER=$((OVER + 1))
else
  printf '✅ AGENTS.md %d B ≤ %d B\n' "$RB" "$CAP_ROOT"
  PASS=$((PASS + 1))
fi

# 13 份域守则
for REL in "${DOMAIN_RULES[@]}"; do
  F="$ROOT/$REL"
  [ -f "$F" ] || degraded E_MISSING_DOMAIN "清单内域守则不存在（判不了 ⇒ 2）: $REL（清单出处 根 AGENTS.md §0 索引表）" scan
  B="$(file_bytes "$F")"
  [ -n "$B" ] || degraded E_UNREADABLE "域守则不可读（wc -c 失败）: $REL" scan
  CHECKED=$((CHECKED + 1))
  TOTAL=$((TOTAL + B))
  if [ "$B" -gt "$MAXB" ]; then MAXB="$B"; MAXF="$REL"; fi
  if [ "$B" -gt "$CAP_DOMAIN" ]; then
    printf '❌ E_BUDGET_OVER: %s %d B > %d B（超 %d B · 单份上限）\n' "$REL" "$B" "$CAP_DOMAIN" "$((B - CAP_DOMAIN))"
    OVER=$((OVER + 1))
  else
    printf '✅ %s %d B ≤ %d B\n' "$REL" "$B" "$CAP_DOMAIN"
    PASS=$((PASS + 1))
  fi
done

# 合计
printf '指令面合计: %d B ／ 上限 %d B ／ 域守则 %d 份（单份最大 %s %d B）\n' \
  "$TOTAL" "$CAP_TOTAL" "$DOMAIN_COUNT" "${MAXF:-<无>}" "$MAXB"
if [ "$TOTAL" -gt "$CAP_TOTAL" ]; then
  printf '❌ E_BUDGET_OVER: 指令面合计 %d B > %d B（超 %d B · 合计口径）\n' "$TOTAL" "$CAP_TOTAL" "$((TOTAL - CAP_TOTAL))"
  OVER=$((OVER + 1))
else
  printf '✅ 指令面合计 %d B ≤ %d B\n' "$TOTAL" "$CAP_TOTAL"
fi

# 只报不判面（绝不参与 rc）。注意：`docs/AGENTS.md` 是判据面一件且是 .md ⇒ 它**也算进 docs 件数/字节**。
echo "[只报不判 · 不影响 rc]"
MD_STAT="$(docstat "$DOCS" '*.md' "$TMPD/docstat-md.err")"
HT_STAT="$(docstat "$DOCS" '*.html' "$TMPD/docstat-html.err")"
case "${MD_STAT}${HT_STAT}" in
  *[!0-9[:space:]]*)
    degraded E_UNREADABLE "docs/** 统计无输出或不可解析（判不了）: md='${MD_STAT:-<空>}' html='${HT_STAT:-<空>}'" scan ;;
esac
# find/wc 的报错不吞：非空即"只扫到一半"⇒ 统计不完整 ⇒ 判不了（禁把部分结果当全量）
DOC_ERR=""
if [ -s "$TMPD/docstat-md.err" ]; then DOC_ERR="$(awk 'NF{print; exit}' "$TMPD/docstat-md.err")"
elif [ -s "$TMPD/docstat-html.err" ]; then DOC_ERR="$(awk 'NF{print; exit}' "$TMPD/docstat-html.err")"; fi
[ -z "$DOC_ERR" ] || degraded E_UNREADABLE "docs/** 扫描出现错误（统计不完整 ⇒ 判不了）: $DOC_ERR" scan
MD_N="${MD_STAT% *}"; MD_B="${MD_STAT#* }"
HT_N="${HT_STAT% *}"; HT_B="${HT_STAT#* }"
[ -n "$MD_N" ] || MD_N=0
[ -n "$MD_B" ] || MD_B=0
[ -n "$HT_N" ] || HT_N=0
[ -n "$HT_B" ] || HT_B=0
DOC_N=$((MD_N + HT_N))
DOC_B=$((MD_B + HT_B))
# 信号量守卫（禁把"看不见"当"没问题"）：今天这一支**结构性不可达**（docs/AGENTS.md 恒是 docs 内一件 .md，
# 它缺失会先以 E_MISSING_DOMAIN 报 2），但保留它，防止将来清单变更后 docs 统计静默归零仍判 0。
[ "$DOC_N" -gt 0 ] \
  || degraded E_NO_FILES "docs/ 内 .md+.html 件数=0（信号量==0 ⇒ 判不了，禁当通过）: $DOCS" scan
printf 'docs/** 全量: %d 件 / %d B（.md %d 件 / %d B ｜ .html %d 件 / %d B）\n' \
  "$DOC_N" "$DOC_B" "$MD_N" "$MD_B" "$HT_N" "$HT_B"

# ── ④ 出口 ─────────────────────────────────────────────────────────────────
echo ""
if [ "$OVER" -gt 0 ]; then
  printf 'BUDGETS: VIOLATION %d\n' "$OVER"
  exit 1
fi
printf 'BUDGETS: OK %d/%d ｜ 合计 %d B ≤ %d B ｜ 单份最大 %s %d B ｜ docs/** %d 件只报不判\n' \
  "$PASS" "$CHECKED" "$TOTAL" "$CAP_TOTAL" "${MAXF:-<无>}" "$MAXB" "$DOC_N"
exit 0
