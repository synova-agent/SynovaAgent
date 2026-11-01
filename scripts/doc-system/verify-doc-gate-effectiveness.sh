#!/usr/bin/env bash
# 任务: "#1238"
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# verify-doc-gate-effectiveness.sh — G-DOC-1..6「规则 → 判据实现 → 调用点」生效性判据（W0-1 / P2-c）
# 真源: docs/authority/GATE-STANDARD.md v3.1 §五「文档桶 6 组（≤15）」＋ docs/authority/DOC-STANDARD.md
#
# @nature: mechanical
#
# 设计哲学（一句）: **MAP 只是"声明"，普查才是"事实"** ——
#   本器不信任任何自称"已生效"的登记：内嵌 MAP 的每条声明都拿去**实测**
#   （`[ -f ]` ＋ 逐行普查 `grep -F`），声明与实测不符即红；
#   且"有实现"不等于"生效"：无 production/ci 调用点一律按 declared-only 判红
#   （DOC-STANDARD 的 G-DOC-2 原文：只有实现、无生产调用点 ⇒ 标 declared-only，**不得称生效**）。
#
# 契约（铁律 47）:
#   @usage   bash scripts/doc-system/verify-doc-gate-effectiveness.sh [--root <dir>] [--check] [--selfcheck] [--help]
#   @input   · root = `--root <dir>`；缺省 = 本脚本位置上溯两级（即 `<repo>/`），**不经 git、不依赖 cwd**；
#            · 规则源 = `<root>/docs/authority/DOC-STANDARD.md` 中行首形如
#              `- **G-DOC-N <名>**：<正文>` 的行（N=1..6；解析"名"＋行号）；
#            · 映射源 = **本文件顶部**的 `# MAP: G-DOC-N <impl|-> <callpoint|-> <kind>` 行
#              （每规则**恰一行**；`-` = 如实声明"没有"，禁编造）；
#              kind ∈ production|ci|test|registry|none（标注该调用点**是什么性质**，不许混写）；
#            · 普查面（实测调用点）= `<root>` 下 scripts/ tests/ .gitea/ .github/ .claude/ src/
#              packages/ extensions/ ＋ docs/authority/WIRING-REGISTRY.yaml，一次 `grep -rnF -f`。
#   @output  · 每规则一行结论：`✅ G-DOC-N <名> · OK — …` /
#              `❌ G-DOC-N <名> · <CODE> — <缺什么>；期望: <落点>`
#            · 每规则一行实测：`   实测: production=a ci=b test=c registry=d ｜ 调用点: p:l …（≤3 条）`
#            · 汇总行：`生效 n/6 ｜ declared-only n ｜ 无实现 n ｜ 无调用点 n ｜ MAP 不实 n` ＋
#              一行口径说明（真红条数 = 6 − 生效）
#            · 结论行（裁决 #1238 ③ 字面口径）：`EFFECTIVENESS: OK 6/6` 或
#              `EFFECTIVENESS: RED 6 ｜ 生效 <ok>/6 ｜ declared-only <n> ｜ 无实现 <n>（G-DOC-x …）`
#              🔴 **`RED 6` 里的 6 = 判据面规则总数（G-DOC-1..6 共 6 条**全部判过**），
#              不是"6 条全红"**；真红条数 = 总数 − 生效 = 6 − <ok>，由上一行汇总与逐条 ❌ 给出。
#   @exit    · 0 = 6 条规则**全部生效**（有实现件 ＋ 至少 1 个 production/ci 调用点）且 MAP 与实测一致
#            · 1 = 真红：某规则无实现件／声明的实现件不存在／无任何调用点／
#                  只有 test/registry 调用点（declared-only）／MAP 声明与实测不符
#                  （调用点不存在或不引用实现、kind 标注不实）—— **逐条点名**（ID ＋ 缺什么 ＋ 期望落点）
#            · 2 = 判不了：`--root` 不存在／DOC-STANDARD 缺失或不可读／规则行 0 条／
#                  MAP 行 ≠ 6 或规则 ID 双向对齐失败（规则源有而 MAP 无，或反之）／
#                  **调用点普查报错**（grep 报错 ⇒ 调用点集合不完整，宁可 exit 2 也不当"没有调用点"）／
#                  未知参数／内部异常／`--selfcheck` 自检失败
#   @degraded stderr `degraded: <CODE> — <原因>` ＋ 追加一行 JSON 到 `$SYNO_GATE_DEGRADED_LOG`
#            （默认 `<root>/.codex/control-tower/logs/degraded-events.log`；字段
#            time/component/code/phase/retryable；铁律 11/31/32；禁静默降级），随后 exit 2
#   @error   code ∈ {E_USAGE, E_NO_ROOT, E_DOC_STANDARD_MISSING, E_NO_RULE_LINES, E_MAP_MISSING,
#                   E_NO_IMPL, E_IMPL_MISSING, E_NO_CALLPOINT, E_DECLARED_ONLY, E_MAP_MISMATCH,
#                   E_SELFCHECK, E_INTERNAL}
#
# 判据语义（G-DOC-2 生效性 · 本器口径，逐条可核）:
#   · 规则 N **生效** ⇔ ① MAP 声明的实现件存在 ② 普查到**至少 1 个 production 或 ci 调用点**
#     （调用点 = 某文件**非注释行**里字面出现该实现件的文件名）。
#   · 仅有 tests/ 或登记表（.claude/claims、WIRING-REGISTRY、DOCS-REGISTRY）引用 ⇒ `E_DECLARED_ONLY`
#     并**阻断**；理由见 G-DOC-2 原文（本器判"生效性"，不是"实现存在性"）。
#   · **禁把"看不见"当"没问题"**：MAP `-`、实现件不存在、DOC-STANDARD 缺行、MAP 与规则行不齐
#     分别落到 1／1／2／2，一条都不跳过。
#   · MAP 与实测**双向核对**：声明的 callpoint 必须存在且真的引用实现，声明的 kind 必须等于
#     按路径实测归类出的 kind ⇒ 禁编造调用点、禁把测试调用点写成 production。
#   · 不读 WIRING-REGISTRY 的 `status:` 字段（登记表会漂移）：它命中只算 registry 调用点，
#     **不能**把规则抬成生效。
#   · **`RED 6` 口径（裁决 #1238 ③）**：结论行首个数字是**判据面规模**（6 条规则一条不漏全判过），
#     **不是红数**；红数由 `生效 <ok>/6` 反推（6 − ok）。之所以保留这个字面口径，是为了与
#     卡面裁决逐字对齐、避免口径漂移；为防止被读成"6 条全红"，正上方另打一行口径说明，
#     逐条结论里的 ❌/✅ 也一条不缺。
#   · **G-DOC-4 的实现映射依 L1 裁决 #1238 ③**：`scripts/control-tower/check-doc-contract.sh`
#     以 `scripts/pre-commit-check.sh:518` 为生产调用点，即**算** G-DOC-4 的实现。
#     本器只核"有实现件 ＋ 有 production/ci 调用点 ＋ 声明与实测一致"，**不判**该实现的语义
#     是否真覆盖「一事实一归属」（见 Known Limitations 1/6）；裁决归 L1，本器不越权改判。
#
# Explicit authority（谁能调）:
#   · 本批（W0-1 P2-c）**不接** pre-commit 组、**不接** CI 腿 —— 调用点只有
#     配对测试 `tests/doc-system/verify-doc-gate-effectiveness.test.sh`、自身 `--selfcheck` 与 L1/L2 手跑；
#   · 接线属后续 task，须走 A 类判据变更（提案 ＋ 独立送审）；**本器自己的 G-DOC-2 生效性同理**：
#     在它被接进阻断腿之前，它也只能算 declared-only（自指诚实，见 Known Limitations 5）；
#   · 任何人可手工只读运行：不写任何被检文件；唯一可能落盘 = 降级日志（.codex/，不入库）。
#
# 已知限制（Known Limitations）:
#   1. **实现件的语义正确性不在本器射程内**：本器只核"有没有实现件 ＋ 有没有生产调用点 ＋
#      声明与实测是否一致"。若某实现件只查了空集合（`exit 0` 恒真），本器照样判它"生效"——
#      那类假绿靠各器自己的 `--selfcheck`／配对测试与 K3 复核，靠本器抓不出来。
#   2. 调用点判定是**字面量**：只认"非注释行里字面出现实现件文件名"。因此
#      ① 经变量拼接的动态调用（`bash "$DIR/$NAME.sh"`）识别不到；
#      ② 纯注释里提到的路径**不算**调用点（防"注释即接线"的假绿）；
#      ③ 反向假阳性——注释外的日志文案里提到文件名会被误当调用点（本器不解析语法树）。
#   3. 普查面是**白名单目录**：memory/、expert/、cycles/、docs/ 其余部分里提到某实现件不算调用点；
#      新增调用面须同步改本文件与配对测试（否则出现"真接线但本器看不见"的假红）。
#   4. 规则行解析依赖 DOC-STANDARD 的格式（行首 `- **G-DOC-N `）：格式一改即 E_NO_RULE_LINES ⇒ 2。
#      这是有意的强耦合——规则 ID 是两边对齐的锚，宁可疑义失败，不猜。
#   5. **调用点只证明"被某处调用"，不证明"挂在阻断腿上"**：一个 `soft_check`／仅 echo 的调用点
#      同样被算作 production 调用点 ⇒ 本器 rc=0 只说明"6 条规则都有实现且都有生产侧字面调用点"，
#      **不等于**它们真能拦住违规。本器自身（G-DOC-2 的实现）今天同样没有生产调用点 ⇒ 自指下它也是 declared-only。
#   6. 不判"阈值/语义是否与 GATE-STANDARD 一致"（例如某器把 3.5KB 写成 4KB）——判据归 L1/CTO。
#   7. **每次调用在本机（Windows + Git Bash）实测约 1～3 s**（一次递归 grep ＋ 若干 `[ -f ]`）；
#      若日后接 pre-commit 仍须核耗时预算（GATE-STANDARD §七：pre-commit ≤90 s）。
#
# Source map（段锚点 → 职责；在本文件内 grep 锚点即可定位）:
#   | 段锚点 | 职责 |
#   |---|---|
#   | `# MAP: G-DOC-` | 6 条映射声明（唯一真源；kind 标注调用点性质）|
#   | `degraded()` | stderr 一行 ＋ JSON 一行到 SYNO_GATE_DEGRADED_LOG（唯一降级出口）|
#   | `kind_of()` | 路径 → production|ci|test|registry|doc|other（**实测归类**，不信 MAP 自述）|
#   | `# ── ① 参数解析` | --root/--check/--selfcheck/--help；未知参数 ⇒ E_USAGE |
#   | `# ── ② 判别力自检` | 沙箱造 绿态／删一行 MAP／实现件缺失／仅注释调用 四态，断言 0/1/2 |
#   | `# ── ③ 解析规则行` | DOC-STANDARD 的 `- **G-DOC-N ` 行 → 名 ＋ 行号 |
#   | `# ── ④ 对齐校验` | MAP 6 行且 ID 双向对齐（否则 E_MAP_MISSING ⇒ 2）|
#   | `# ── ⑤ 调用点普查` | 一次 `grep -rnF -f` 全家族 ＋ 逐条归类（本器唯一的"事实"来源）|
#   | `# ── ⑥ 逐条判` | 实现件／调用点／kind 三重核对 ＋ 结论行（@mutate-point 判据点在此）|
# ═══════════════════════════════════════════════════════════════════════════════
set +e

COMPONENT="verify-doc-gate-effectiveness"
DOC_STANDARD_REL="docs/authority/DOC-STANDARD.md"

# ── 映射表（唯一真源；`-` = 如实声明"没有"，禁编造）───────────────────────────────
# 实测依据 2026-10-31 @a025fc47e: WIRING-REGISTRY.yaml:344-358 把 G-DOC-3/G-DOC-5 标 declared-only
#   （"本批不接 pre-commit/CI ⇒ 无生产调用点"）；G-DOC-6 在 scripts/** 内无任何检查器。
# G-DOC-4：依 **L1 裁决 #1238 ③** 判为 `check-doc-contract.sh` 的实现，生产调用点 =
#   `scripts/pre-commit-check.sh:518`（`DOC_CONTRACT_OUT=$(bash "$ROOT/scripts/control-tower/check-doc-contract.sh" …)`）。
#   行锚（`:518`）只用于"核这一行是不是字面调用"，存在性/kind 仍按文件判。
# MAP: G-DOC-1 scripts/doc-system/verify-doc-budgets.sh tests/doc-system/verify-doc-budgets.test.sh test
# MAP: G-DOC-2 scripts/doc-system/verify-doc-gate-effectiveness.sh tests/doc-system/verify-doc-gate-effectiveness.test.sh test
# MAP: G-DOC-3 scripts/doc-system/check-doc-g3-datestamp.sh tests/doc-system/check-doc-g3-datestamp.test.sh test
# MAP: G-DOC-4 scripts/control-tower/check-doc-contract.sh scripts/pre-commit-check.sh:518 production
# MAP: G-DOC-5 scripts/doc-system/check-doc-g5-bare-filename.sh tests/doc-system/check-doc-g5-bare-filename.test.sh test
# MAP: G-DOC-6 - - none

SELF="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"  # swallow-ok: cd 失败时 SELF 推不出默认根会由 `[ -n "$ROOT" ] || degraded E_NO_ROOT` 显式 exit 2，且 MAP 读不到会由 E_MAP_MISSING exit 2
ROOT=""
ROOT_GIVEN=0
SELFCHECK=0
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

kind_of() { # $1=仓内相对路径 → production|ci|test|registry|doc|other（**实测归类**，不读 MAP 自述）
  case "$1" in
    tests/*)                             echo test ;;
    .gitea/*|.github/*)                  echo ci ;;
    .claude/*)                           echo registry ;;
    docs/authority/WIRING-REGISTRY.yaml) echo registry ;;
    docs/authority/DOCS-REGISTRY.yaml)   echo registry ;;
    docs/*|*.md)                         echo doc ;;
    scripts/*|src/*|packages/*|extensions/*) echo production ;;
    *)                                   echo other ;;
  esac
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

# ── ② 判别力自检（沙箱造 4 态并断言 0/1/2，末行 SELFCHECK-OK）──────────────────────
if [ "$SELFCHECK" -eq 1 ]; then
  SB="$(mktemp -d 2>/dev/null)"  # swallow-ok: 失败由下一行显式 degraded
  { [ -n "$SB" ] && [ -d "$SB" ]; } || degraded E_SELFCHECK "mktemp -d 失败（无法建自检沙箱）" selfcheck
  trap 'rm -rf "$SB"' EXIT
  SC_PASS=0
  SC_FAIL=0
  SC_LAST="$SB/last.out"
  sc_ok() { echo "  ✅ $1"; SC_PASS=$((SC_PASS + 1)); }
  sc_no() { echo "  ❌ $1"; SC_FAIL=$((SC_FAIL + 1)); }
  sc_has() { grep -qF -- "$1" "$SC_LAST"; }
  sc_tail() { sed -n '1,400p' "$SC_LAST" | tail -6 | tr '\n' ' '; }
  sc_run() { # $1=脚本 $2=root → 输出写 $SC_LAST，回显 rc（命令替换是子壳 ⇒ 输出必须落文件）
    local _s="$1" _r="$2"; shift 2
    SYNO_GATE_DEGRADED_LOG="$SB/degraded.log" bash "$_s" --root "$_r" "$@" > "$SC_LAST" 2>&1
    echo $?
  }
  mk_rule_std() { # $1=dir → 6 条规则行
    mkdir -p "$1/docs/authority" || return 1
    : > "$1/docs/authority/DOC-STANDARD.md" || return 1
    local n
    for n in 1 2 3 4 5 6; do
      printf -- '- **G-DOC-%s 夹具规则%s**：沙箱夹具。\n' "$n" "$n" >> "$1/docs/authority/DOC-STANDARD.md" || return 1
    done
    return 0
  }
  mk_green_tree() { # $1=dir → 匹配"绿态变异体"的 MAP（tools/gN.sh ＋ scripts/caller.sh production）
    mk_rule_std "$1" || return 1
    mkdir -p "$1/tools" "$1/scripts" "$1/tests" || return 1
    : > "$1/scripts/caller.sh" || return 1
    local n
    for n in 1 2 3 4 5 6; do
      printf '#!/bin/bash\n# 夹具实现 g%s\n' "$n" > "$1/tools/g$n.sh" || return 1
      printf '#!/bin/bash\n# 夹具测试 g%s\nbash tools/g%s.sh\n' "$n" "$n" > "$1/tests/g$n.test.sh" || return 1
      printf 'bash "$ROOT/tools/g%s.sh"\n' "$n" >> "$1/scripts/caller.sh" || return 1
    done
    return 0
  }
  make_green_variant() { # $1=输出 → MAP 全指向 tools/gN.sh ＋ scripts/caller.sh（production）
    sed -E 's|^# MAP: G-DOC-([1-6]) [^ ]+ [^ ]+ [a-z-]+$|# MAP: G-DOC-\1 tools/g\1.sh scripts/caller.sh production|' \
      "$SELF" > "$1" || return 1
    [ "$(grep -cE '^# MAP: G-DOC-[1-6] tools/g' "$1")" = "6" ] || return 1
    return 0
  }
  make_nomap_variant() { # $1=输出 → 删掉 G-DOC-2 的 MAP 行（MAP 只剩 5 条）
    grep -vE '^# MAP: G-DOC-2 ' "$SELF" > "$1" || return 1
    [ "$(grep -cE '^# MAP: G-DOC-[1-6] ' "$1")" = "5" ] || return 1
    return 0
  }

  echo "── verify-doc-gate-effectiveness --selfcheck: 判别力自检（0/1/2）──"
  echo "沙箱: $SB"

  # ① 绿态（6 规则全有实现 ＋ 生产调用点）⇒ 0
  make_green_variant "$SB/green.sh" || degraded E_SELFCHECK "绿态变异体生成失败（MAP 行格式已变，须同步自检）" selfcheck
  mk_green_tree "$SB/tree" || degraded E_SELFCHECK "沙箱构造失败: 绿态" selfcheck
  RC="$(sc_run "$SB/green.sh" "$SB/tree")"
  [ "$RC" -eq 0 ] && sc_ok "① 全生效沙箱 ⇒ exit 0" || sc_no "① 全生效沙箱应 exit 0，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'EFFECTIVENESS: OK 6/6' && sc_ok "① 汇总 EFFECTIVENESS: OK 6/6" || sc_no "① 汇总行不符；原始输出: $(sc_tail)"

  # ② 删一条 MAP ⇒ 2（映射不齐 = 判不了）
  make_nomap_variant "$SB/nomap.sh" || degraded E_SELFCHECK "删 MAP 变异体生成失败" selfcheck
  RC="$(sc_run "$SB/nomap.sh" "$SB/tree")"
  [ "$RC" -eq 2 ] && sc_ok "② 删一条 MAP ⇒ exit 2" || sc_no "② 删 MAP 应 exit 2，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'degraded: E_MAP_MISSING' && sc_ok "② degraded: E_MAP_MISSING 可见" || sc_no "② 缺 E_MAP_MISSING；原始输出: $(sc_tail)"

  # ③ 实现件不存在 ⇒ 1 且点名该规则
  rm -f "$SB/tree/tools/g3.sh"
  RC="$(sc_run "$SB/green.sh" "$SB/tree")"
  [ "$RC" -eq 1 ] && sc_ok "③ 实现件缺失 ⇒ exit 1" || sc_no "③ 实现件缺失应 exit 1，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'G-DOC-3' && sc_ok "③ 点名 G-DOC-3" || sc_no "③ 未点名 G-DOC-3；原始输出: $(sc_tail)"
  sc_has 'E_IMPL_MISSING' && sc_ok "③ 点名 E_IMPL_MISSING" || sc_no "③ 未点名 E_IMPL_MISSING；原始输出: $(sc_tail)"

  # ④ 生产调用点只剩注释（"注释即接线"假绿）⇒ 1 declared-only
  mk_green_tree "$SB/tree2" || degraded E_SELFCHECK "沙箱构造失败: 注释态" selfcheck
  { printf '#!/bin/bash\n# bash "$ROOT/tools/g1.sh"\n'
    printf 'bash "$ROOT/tools/g2.sh"\nbash "$ROOT/tools/g3.sh"\nbash "$ROOT/tools/g4.sh"\n'
    printf 'bash "$ROOT/tools/g5.sh"\nbash "$ROOT/tools/g6.sh"\n'; } > "$SB/tree2/scripts/caller.sh"
  RC="$(sc_run "$SB/green.sh" "$SB/tree2")"
  [ "$RC" -eq 1 ] && sc_ok "④ 仅注释引用 ⇒ exit 1（注释不算调用点）" || sc_no "④ 仅注释引用应 exit 1，实际 ${RC}；原始输出: $(sc_tail)"
  sc_has 'E_DECLARED_ONLY' && sc_ok "④ 点名 E_DECLARED_ONLY" || sc_no "④ 未点名 E_DECLARED_ONLY；原始输出: $(sc_tail)"

  echo "SELFCHECK: ${SC_PASS}/$((SC_PASS + SC_FAIL)) 通过"
  if [ "$SC_FAIL" -gt 0 ]; then
    degraded E_SELFCHECK "判别力自检 ${SC_FAIL} 条断言失败（自检自身不可信 ⇒ exit 2，禁当通过）" selfcheck
  fi
  echo "SELFCHECK-OK"
  exit 0
fi

# ── ③ 解析规则行（DOC-STANDARD 是唯一规则源；格式强耦合，见 Known Limitations 4）──────
if [ "$ROOT_GIVEN" -eq 1 ]; then
  [ -d "$ROOT" ] || degraded E_NO_ROOT "--root 目录不存在: $ROOT" usage
  ROOT="$(cd "$ROOT" && pwd)"  # swallow-ok: 存在性已上行显式判过
else
  ROOT="$(cd "$(dirname "$SELF")/../.." && pwd)"  # swallow-ok: 脚本自身位置必可达
  [ -n "$ROOT" ] || degraded E_NO_ROOT "无法由脚本位置推出仓根（$SELF）" env
fi
STD="$ROOT/$DOC_STANDARD_REL"
[ -f "$STD" ] || degraded E_DOC_STANDARD_MISSING "规则源缺失（判不了 ⇒ 2）: $DOC_STANDARD_REL" scan
[ -r "$STD" ] || degraded E_DOC_STANDARD_MISSING "规则源不可读（判不了 ⇒ 2）: $DOC_STANDARD_REL" scan

TMPD="$(mktemp -d 2>/dev/null)"  # swallow-ok: 失败由下一行显式 degraded
{ [ -n "$TMPD" ] && [ -d "$TMPD" ]; } || degraded E_INTERNAL "mktemp -d 失败" env
trap 'rm -rf "$TMPD"' EXIT

RULE_COUNT=0
DOC_NAME=("" "" "" "" "" "")
DOC_LINE=("" "" "" "" "" "")
while IFS= read -r ln; do
  case "$ln" in
    '- **G-DOC-'*) ;;
    *) continue ;;
  esac
  no="${ln%%:*}"
  body="${ln#*:}"
  rid="$(printf '%s' "$body" | sed -E 's/^- \*\*G-DOC-([1-6]) .*/\1/')"
  case "$rid" in
    1|2|3|4|5|6) ;;
    *) continue ;;
  esac
  i=$((rid - 1))
  DOC_NAME[$i]="$(printf '%s' "$body" | sed -E 's/^- \*\*G-DOC-[1-6] ([^*]*)\*\*.*$/\1/')"
  DOC_LINE[$i]="$no"
  RULE_COUNT=$((RULE_COUNT + 1))
done < "$STD"
[ "$RULE_COUNT" -gt 0 ] \
  || degraded E_NO_RULE_LINES "DOC-STANDARD 内规则行 0 条（期望形如 '- **G-DOC-N <名>**：'；信号量==0 ⇒ 判不了）: $DOC_STANDARD_REL" scan

# ── ④ 对齐校验（MAP 6 行 ＋ 规则 ID 双向对齐；任何不齐 ⇒ 2）────────────────────────────
MAP_COUNT=0
MAP_IMPL=("" "" "" "" "" "")
MAP_CP=("" "" "" "" "" "")
MAP_KIND=("" "" "" "" "" "")
while IFS= read -r ln; do
  case "$ln" in
    '# MAP: G-DOC-'*) ;;
    *) continue ;;
  esac
  MAP_COUNT=$((MAP_COUNT + 1))
  rest="${ln#\# MAP: G-DOC-}"
  rid="${rest%% *}"
  rest="${rest#* }"
  im="${rest%% *}"
  rest="${rest#* }"
  cp="${rest%% *}"
  kd="${rest#* }"
  case "$rid" in
    1|2|3|4|5|6) ;;
    *) degraded E_MAP_MISSING "MAP 行规则 ID 越界（只认 G-DOC-1..6）: $ln" map ;;
  esac
  i=$((rid - 1))
  [ -z "${MAP_IMPL[$i]}" ] \
    || degraded E_MAP_MISSING "G-DOC-${rid} 出现多条 MAP 行（一行一规则；多调用点由普查发现，不需重复登记）" map
  MAP_IMPL[$i]="$im"
  MAP_CP[$i]="$cp"
  MAP_KIND[$i]="$kd"
done < "$SELF"
[ "$MAP_COUNT" -eq 6 ] \
  || degraded E_MAP_MISSING "MAP 行数 ${MAP_COUNT} ≠ 6（映射不齐 ⇒ 判不了；格式 '# MAP: G-DOC-N <impl|-> <callpoint|-> <kind>'）" map
i=0
for n in 1 2 3 4 5 6; do
  [ -n "${MAP_IMPL[$i]}" ] || degraded E_MAP_MISSING "G-DOC-${n} 缺 MAP 行（双向对齐失败）" map
  [ -n "${DOC_LINE[$i]}" ] || degraded E_MAP_MISSING \
    "G-DOC-${n} 有 MAP 行但 DOC-STANDARD 无对应规则行（双向对齐失败；规则源 = $DOC_STANDARD_REL）" map
  i=$((i + 1))
done

# ── ⑤ 调用点普查（唯一"事实"来源：一次 grep 覆盖全部实现件；注释行不算调用点）─────────
: > "$TMPD/family.txt"
i=0
for n in 1 2 3 4 5 6; do
  [ "${MAP_IMPL[$i]}" = "-" ] || basename "${MAP_IMPL[$i]}" >> "$TMPD/family.txt"
  i=$((i + 1))
done
SCAN_PATHS=""
for p in scripts tests .gitea .github .claude src packages extensions docs/authority/WIRING-REGISTRY.yaml; do
  [ -e "$ROOT/$p" ] && SCAN_PATHS="$SCAN_PATHS $ROOT/$p"
done
: > "$TMPD/hits.txt"
: > "$TMPD/hits.err"
if [ -n "$SCAN_PATHS" ] && [ -s "$TMPD/family.txt" ]; then
  # shellcheck disable=SC2086  # 词分割故意：SCAN_PATHS 是多个已存在路径
  # 不吞 stderr：grep 的报错（不可读路径等）落 hits.err，由下面非空 ⇒ degraded E_UNREADABLE 承接
  grep -rnF -f "$TMPD/family.txt" --exclude-dir=.git --exclude-dir=node_modules \
    --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage --exclude-dir=.next \
    $SCAN_PATHS > "$TMPD/hits.txt" 2>"$TMPD/hits.err"
fi
# 普查只要报过错 ⇒ 调用点集合可能不完整 ⇒ 判不了（禁把"只搜到一半"当"没有调用点"）
[ ! -s "$TMPD/hits.err" ] || degraded E_UNREADABLE \
  "调用点普查出现错误（普查不完整 ⇒ 判不了）: $(awk 'NF{print; exit}' "$TMPD/hits.err")" scan

# ── ⑥ 逐条判 ───────────────────────────────────────────────────────────────
echo "── verify-doc-gate-effectiveness: G-DOC-1..6 生效性（GATE-STANDARD v3.1 §五 · 文档桶 6 组）──"
echo "root: $ROOT"
echo "规则源: $DOC_STANDARD_REL（解析到 ${RULE_COUNT} 条规则行）"
echo "判据: 生效 ⇔ 有实现件 ＋ 至少 1 个 production/ci 调用点；仅 test/registry ⇒ declared-only（判红）"
echo "[逐条]"

RED_N=0; DECL_N=0; NOIMPL_N=0; NOCALL_N=0; MISM_N=0; NOIMPL_IDS=""

i=0
for n in 1 2 3 4 5 6; do
  im="${MAP_IMPL[$i]}"; cp="${MAP_CP[$i]}"; kd="${MAP_KIND[$i]}"; nm="${DOC_NAME[$i]}"
  V_RC=0; V_CODE="OK"; V_WHY=""; V_EXPECT=""
  PROD=0; CI=0; TEST=0; REG=0; CLIST=""; CLN=0

  if [ "$im" != "-" ] && [ -f "$ROOT/$im" ]; then
    ib="$(basename "$im")"
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      # 解析 "<path>:<line>:<text>"（正则贪婪前缀 ⇒ 兼容带盘符路径与正文里的冒号）
      if [[ "$hit" =~ ^(.*):([0-9]+):(.*)$ ]]; then
        hp="${BASH_REMATCH[1]}"; hl="${BASH_REMATCH[2]}"; ht="${BASH_REMATCH[3]}"
      else
        continue
      fi
      rel="${hp#"$ROOT/"}"
      [ "$rel" = "$im" ] && continue                  # 实现件不是自己的调用点
      case "$ht" in *"$ib"*) ;; *) continue ;; esac    # 只认本实现件的行（一次 grep 多模式）
      case "$ht" in \#*) continue ;; esac             # 注释行不算调用点（防"注释即接线"）
      case "$(kind_of "$rel")" in
        production) PROD=$((PROD + 1)) ;;
        ci)         CI=$((CI + 1)) ;;
        test)       TEST=$((TEST + 1)) ;;
        registry)   REG=$((REG + 1)) ;;
        *)          continue ;;                        # doc/other 不算调用点
      esac
      if [ "$CLN" -lt 3 ]; then CLIST="$CLIST $rel:$hl"; CLN=$((CLN + 1)); fi
    done < "$TMPD/hits.txt"
  fi

  if [ "$im" = "-" ]; then
    NOIMPL_N=$((NOIMPL_N + 1)); NOIMPL_IDS="$NOIMPL_IDS G-DOC-$n"
    # @mutate-point: no-impl-is-red
    V_RC=1; V_CODE="E_NO_IMPL"
    V_WHY="无实现件（MAP 如实声明 '-'；实测 scripts/** 无该规则检查器）"
    V_EXPECT="新增实现件（建议 scripts/doc-system/check-doc-g${n}-*.sh）"
  elif [ ! -f "$ROOT/$im" ]; then
    NOIMPL_N=$((NOIMPL_N + 1)); NOIMPL_IDS="$NOIMPL_IDS G-DOC-$n"
    V_RC=1; V_CODE="E_IMPL_MISSING"
    V_WHY="MAP 声明的实现件不存在: $im"
    V_EXPECT="把 MAP 改到真实实现，或补上该实现件"
  else
    if [ "$cp" != "-" ]; then
      # 调用点可带行锚（裁决 #1238 ③ 的 MAP 形如 scripts/pre-commit-check.sh:518）：
      # 行锚只用于"核这一行是不是字面调用"，存在性与 kind 仍按**文件**判（行锚不改变归类）。
      cp_path="$cp"; cp_line=""
      if [[ "$cp" =~ ^(.*):([0-9]+)$ ]]; then cp_path="${BASH_REMATCH[1]}"; cp_line="${BASH_REMATCH[2]}"; fi
      if [ ! -f "$ROOT/$cp_path" ]; then
        MISM_N=$((MISM_N + 1)); V_RC=1; V_CODE="E_MAP_MISMATCH"
        V_WHY="MAP 声明的调用点不存在: $cp"
        V_EXPECT="删掉该 MAP 声明，或补上真实调用点"
      elif [ -n "$cp_line" ] && ! sed -n "${cp_line}p" "$ROOT/$cp_path" | grep -qF -- "$(basename "$im")"; then
        MISM_N=$((MISM_N + 1)); V_RC=1; V_CODE="E_MAP_MISMATCH"
        V_WHY="MAP 声明的调用点行锚对不上: ${cp_path}:${cp_line} 不含 '$(basename "$im")' 的字面引用（编造行锚）"
        V_EXPECT="把行锚改到真实调用行，或只留文件路径（去掉 :${cp_line}）"
      elif ! grep -qF -- "$(basename "$im")" "$ROOT/$cp_path"; then
        MISM_N=$((MISM_N + 1)); V_RC=1; V_CODE="E_MAP_MISMATCH"
        V_WHY="MAP 声明的调用点 $cp 内不含 '$im' 的字面引用（编造调用点）"
        V_EXPECT="把 MAP 指向真实引用该实现的文件"
      else
        real_kind="$(kind_of "$cp_path")"
        if [ "$kd" != "$real_kind" ]; then
          MISM_N=$((MISM_N + 1)); V_RC=1; V_CODE="E_MAP_MISMATCH"
          V_WHY="MAP 标注 kind=${kd}，按路径实测应为 ${real_kind}（kind 标注不实）: $cp"
          V_EXPECT="把 kind 改成 ${real_kind}"
        fi
      fi
    fi
    if [ "$PROD" -eq 0 ] && [ "$CI" -eq 0 ] && [ "$V_RC" -eq 0 ]; then
      if [ "$TEST" -eq 0 ] && [ "$REG" -eq 0 ]; then
        NOCALL_N=$((NOCALL_N + 1)); V_RC=1; V_CODE="E_NO_CALLPOINT"
        V_WHY="有实现件但普查到 0 个调用点（test=0 registry=0）"
        V_EXPECT="在 scripts/pre-commit-check.sh 或 .gitea/workflows/ 加字面调用点"
      else
        DECL_N=$((DECL_N + 1))
        # @mutate-point: declared-only-is-red
        V_RC=1; V_CODE="E_DECLARED_ONLY"
        V_WHY="仅有 test=${TEST} registry=${REG} 调用点，无 production/ci ⇒ declared-only，不得称生效"
        V_EXPECT="在 scripts/pre-commit-check.sh 或 .gitea/workflows/ 加字面调用点（接管线路由归 L1）"
      fi
    fi
  fi

  if [ "$V_RC" -ne 0 ]; then
    RED_N=$((RED_N + 1))
    printf '❌ G-DOC-%s %s · %s — %s；期望: %s\n' "$n" "${nm:-<无名>}" "$V_CODE" "$V_WHY" "$V_EXPECT"
  else
    printf '✅ G-DOC-%s %s · OK — 实现 %s ＋ production/ci 调用点 %d 个\n' "$n" "${nm:-<无名>}" "$im" "$((PROD + CI))"
  fi
  printf '   实测: production=%d ci=%d test=%d registry=%d ｜ 调用点:%s\n' \
    "$PROD" "$CI" "$TEST" "$REG" "${CLIST:- <无>}"
  i=$((i + 1))
done

echo "[汇总]"
OK_N=$((6 - RED_N))
printf '生效 %d/6 ｜ declared-only %d ｜ 无实现 %d ｜ 无调用点 %d ｜ MAP 不实 %d\n' \
  "$OK_N" "$DECL_N" "$NOIMPL_N" "$NOCALL_N" "$MISM_N"
printf '（口径: 结论行首个数字 = 判据面规则总数 6，不是"6 条全红"；真红条数 = 6 − 生效 = %d 条）\n' "$RED_N"
if [ "$RED_N" -gt 0 ]; then
  NOIMPL_TXT="${NOIMPL_IDS# }"; [ -n "$NOIMPL_TXT" ] || NOIMPL_TXT="无"
  printf 'EFFECTIVENESS: RED 6 ｜ 生效 %d/6 ｜ declared-only %d ｜ 无实现 %d（%s）\n' \
    "$OK_N" "$DECL_N" "$NOIMPL_N" "$NOIMPL_TXT"
  exit 1
fi
echo "EFFECTIVENESS: OK 6/6"
exit 0
