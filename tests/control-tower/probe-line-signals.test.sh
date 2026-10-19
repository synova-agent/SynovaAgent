#!/usr/bin/env bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# probe-line-signals.test.sh — #602 P7-2 回执三信号探针 · 配对测试（W2 · 第 2 轮）
#
# 被测: scripts/control-tower/probe-line-signals.ts（W1）
# 被测件绿跑基准（实测，2026-10-19 R2）: md5=c60b34a681f33ee8bc085453b937b7d3 ｜ wc -l=1831
#   🔴 被测件若变更 ⇒ 必须重跑本测试并同步本行基准（禁拿旧基准当证据）。
# 配对规则: CT-40 scripts/{control-tower,workflow,hooks}/<name>.<sh|py|ts> ↔ tests/control-tower/<name>.test.sh
# 规格真源: handbook 派单件/2026-10-19-P7-602-三信号探针-规格.md @ 634200d3e（**v4.1**）
#           §4.3 夹具 8 子例 A–H ／ §4.2 降级粒度 ／ §4bis 线映射 ／ §4.4 DS-1…DS-11 ／ C1–C3
#
# 【一句话】用夹具（零网络）把「按报告线输出回执三信号」的每一个可观测断言钉死：
#   8 判定点 A–H ＋ 三态退出码 ＋ DS-8 JSON 键集 ＋ 只读证明 ＋ 改坏必红（外部复核口径）。
#
# 【设计哲学】一个分离 ＋ 三条承诺
#   · 一个分离：**测试不实现被测逻辑** —— 只注入夹具读输出，映射/聚合对错全由输出级断言判
#     （只比 exit 会漏「红错条件」）。
#   · 承诺 1「每个子例只让目标条件红」：夹具逐子例独立构造（fx/ 目录，不复用 mutation）。
#   · 承诺 2「看不见 ≠ 没问题」：夹具 open_pr=0 未声明合法零 ⇒ exit 2（C2）；根级 API 失败 ⇒ 2；
#     逐项降级（不可判）既不许被当成 100%，也不许被当成「没做到」（进 gaps、不计 ②）。
#   · 承诺 3「改坏必红」：本测试支持 SYNO_LINE_SIGNALS_TOOL 指向改坏副本（外部复核以 exit 1
#     证明判别力），且内部自带一条突变自证（复制＋改关键输出标记＋断言本测试变红）。
#
# 覆盖矩阵（8 个判定点 ＝ 规格 §4.3 子例 A–G ＋ v4.1 新增 H）:
#   A 基线全绿: exit 0；末行 `LINE-SIGNALS: lines=5 exceptions=0 gaps=0`；5 线齐；
#              基座线 `①=n/a(未映射)`；治理线 `①(merge-conditions)=1/1 ②=0 ③=1(跨线 0)`；无 B 键
#   B 计数自洽: unknown 文件 ⇒ 末行 gaps=1 且明细点名该 PR（DS-2 正例）；
#              drop_gaps_detail 旋钮（明细被丢而计数不变）⇒ 被测件自身红 **或** 计数≠明细被抓出
#   C 零 PR 线: 全局有 PR 而该线 0 ⇒ `①(merge-conditions)=n/a(0)` ＋ `③=0(跨线 0)`，禁「无在飞 PR」；
#              force_s1 旋钮（0 PR 线强行 1/1）⇒ 被测件自身红 **或** 不变量抓出
#   D 根级失败: SYNO_GITEA_API=http://127.0.0.1:1/api/v1 ⇒ exit 2 ＋ stderr `degraded:` ＋ code
#              ＋ degraded-log 字段齐（time/component/code/phase/retryable）
#   E 口径守卫: inject_b_metric=true ⇒ 被测件自身红 **或** 输出出现 B 口径键（可被抓出）
#   F 跨线计入: cross_pr ⇒ 产品线/治理线各 `③=1(跨线 1)`、各 `①(merge-conditions)=1/1`，
#              `gap: PR#301 cross 产品线,治理线` 点名（禁硬归一线）
#   G 跨线漏计: 同一 cross 夹具 ⇒ 两涉线 ③ 数字均 =1、合计=2（每线各计一次；禁漏计/重复计）
#   H ② 只装没做到: 产品线 3 PR ＝ 2 未通过（四条件全可判、非全 ok）＋ 1 不可判（含 degraded）
#              ⇒ `产品线 ①(merge-conditions)=0/3 ②=2 ③=3(跨线 0)`（分母含降级 ⇒ fail-closed）、
#              `gap: PR#623 不可判 E_COND_DEGRADED`、两条 `exception: … NOT-DONE NO: …`、
#              末行 `LINE-SIGNALS: lines=5 exceptions=2 gaps=1`、exit 1、
#              且 ② **不** 因降级 +1（②=2≠3）、不可判项 **不** 出现在 exceptions（DS-11）
#
# 边界/参数断言（单列 EXTRA，不计入 N）:
#   · --selfcheck ⇒ exit 0 ＋ 末行 `SELFCHECK-OK: 8/8`（判别力自检可跑）
#   · --all --json ⇒ DS-8 键集 == {tool,lines,exceptions,gaps,mapping,summary,exit}；
#     python3 -m json.tool 可解析；lines[].s1/s2/s3 与文本行同口径（② 用 v4.1 新语义值）；
#     exceptions[] 只含 code=NOT-DONE（无 E_COND_DEGRADED）、gaps[] 含 kind=unjudgeable
#   · --line <线> 文本末行 `gaps(global)=<n>`，且 n == 同夹具 `--all` 末行 gaps 数（断言具体数值）
#   · --line --json ⇒ 顶层七键不变；summary.gaps_global=<全局 gaps>、summary.gaps=<本次明细数>
#   · --line 不存在线 ⇒ exit 2；--json 与 --selfcheck 同给 ⇒ exit 2
#   · 降级粒度（v4.1 改写）：逐项降级 ⇒ gaps 不可判栏点名 code、② 不加、① 分母含降级（0/1）、
#     整体 exit 1（不是 2）；**不再**是「进 exceptions、② ＋1」（旧口径已废）
#   · 跨线未通过（v4.1 新增）：所涉每条线各 1 条 NOT-DONE（② 每线 1、两线共 2 条），
#     末行 exceptions 计数 == 明细条数
#   · 混合 PR（有线＋unknown）⇒ 命中线计数 ＋ `gap: PR#501 mixed-unassigned 1 files`
#   · DS-8 gaps[] 与文本 `^gap: ` 明细逐条对应（cross 夹具 1==1）
#   · C2 合法零：open_pr=0 未声明 ⇒ exit 2；allow_zero=true ⇒ exit 0
#   · force_root_fail 旋钮 ⇒ exit 2 ＋ degraded
#   · 三态：0（A 全绿夹具）／1（有例外或缺口）／2（根级失败）各一例
#   · 只读证明：运行前后真实仓 `git status --porcelain` 逐字节相同（DS-7）
#   · 内部突变自证：改坏副本跑本测试 ⇒ exit 1
#   · 夹具 JSON 自检：全部夹具可被 python3 -m json.tool 解析
#
# 🔴 接缝口径（规格 v4.1 冻结，W1 已同步）:
#   · ② 的明细 = `exception: PR#<n> <线> NOT-DONE NO: <逗号分隔失败条件>`（行首无缩进；
#     条件名固定顺序 ci,overlap,review,serial；跨线 PR 在所涉每条线各 1 条）；② = 该线 NOT-DONE 条数。
#   · 逐项降级注入 = fixture conditions 任一值 "degraded" ⇒ 明细行 `gap: PR#<n> 不可判 <code>`
#     （行首无缩进）；**不计 ②**；仍进该线 ③ 与 ① 分母（fail-closed）。
#   · gaps 明细 = 行首无缩进 `gap: ` 四形态：`cross <线1>,<线2>` ／ `unknown <k> files` ／
#     `mixed-unassigned <k> files` ／ `不可判 <code>`；末行 gaps == `grep -c '^gap: '`。
#   · 末行 exceptions == `grep -c '^exception: '`（DS-2 同口径）。
#   · 0 PR 线 ① 值字面 `n/a(0)`（渲染为 `①(merge-conditions)=n/a(0)`）；基座线 `①=n/a(未映射)`；
#     ③ 字面 `0(跨线 0)`（全局 open PR=0 时同样 `0(跨线 0)`）。
#   · 单线视图不展开 gap 明细，但必须给末行 `gaps(global)=<全局 gaps 数>`（fail-closed：印了就许看）。
#
# 计数口径：N = 8 判定点（A–H 各一）。边界/参数/只读/突变断言单列（`[边界]` 行），任一失败都计入失败。
#   ⇒ 全绿时末行恒为 `结果: 8 通过, 0 失败`；任何失败 ⇒ 退出码 1。
#
# 沙箱: 全部夹具在系统临时目录（mktemp -d ＋ trap EXIT 清理）；SYNO_GATE_DEGRADED_LOG 指到沙箱
#       （防污染真实仓）。零网络：夹具经 SYNO_LINE_SIGNALS_FIXTURE 注入，且夹具跑一律把
#       SYNO_GITEA_API 指向不可达 http://127.0.0.1:1/api/v1 —— 若被测件绕过夹具去联网，必红。
# 断言: 每判定点**同时**断言 inner_exit ＋ 输出 token（双比对）。
# 验收（改坏必红 / 外部复核口径）:
#   cp scripts/control-tower/probe-line-signals.ts /tmp/mut.ts && <把 ② 改回「exceptions 里数降级」> &&
#   SYNO_LINE_SIGNALS_TOOL=/tmp/mut.ts bash tests/control-tower/probe-line-signals.test.sh ⇒ 必须 exit 1 且 H 失败
# 用法: bash tests/control-tower/probe-line-signals.test.sh
# 退出码: 0 = 全部通过；1 = 有失败（含 W1 未交付 / 环境不可用）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REL_TOOL="scripts/control-tower/probe-line-signals.ts"
# 被测件路径（默认＝仓内 W1；SYNO_LINE_SIGNALS_TOOL 仅供「改坏必红」复核时指向 /tmp 的副本）
TOOL="${SYNO_LINE_SIGNALS_TOOL:-$REPO_DIR/$REL_TOOL}"

# 环境自足：默认 shell 无 node/npx（规格 §5 / F9）⇒ 测试自己前置 nvm
if ! command -v npx >/dev/null 2>&1; then
  if [ -s "${HOME}/.nvm/nvm.sh" ]; then
    set +u
    # shellcheck disable=SC1090,SC1091
    . "${HOME}/.nvm/nvm.sh" >/dev/null 2>&1 || true
    set -u
  fi
fi
RUNNER=()
if command -v npx >/dev/null 2>&1; then
  RUNNER=(npx --no-install tsx)   # --no-install: 禁联网拉包（仓内/全局 tsx）
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/synova-602-w2.XXXXXX")" || { echo "❌ mktemp 失败" >&2; exit 1; }
cleanup() { rm -rf "$WORK" 2>/dev/null; }
trap cleanup EXIT INT TERM

PASS=0       # 判定点数（必须 = 8）
FAIL=0       # 任何断言失败（判定点 ＋ 边界）
EXTRA=0      # 边界/参数/只读/突变断言通过数（单列，不计入 N）
CF=0         # 当前判定点起始时的 FAIL 快照
pass()  { PASS=$((PASS + 1));  echo "  ✅ $1"; }
extra() { EXTRA=$((EXTRA + 1)); echo "  ✅ [边界] $1"; }
fail()  { FAIL=$((FAIL + 1));  echo "  ❌ $1" >&2; }

OUT=""; ERR=""; RC=0

show_all() { # 失败时打印全量原始输出（禁截断）
  echo "      原始输出（全量，不截断）:" >&2
  sed 's/^/       | /' "$OUT" >&2
  if [ -s "$ERR" ]; then sed 's/^/       | stderr: /' "$ERR" >&2; fi
}
case_begin() { CF="$FAIL"; }
case_end() { # <名称> [extra]（判定点默认计入 N；[边界] 传 extra 单列）
  local kind="${2:-judgment}"
  if [ "$FAIL" = "$CF" ]; then
    if [ "$kind" = "extra" ]; then
      extra "$1（末行: $(last_line "$OUT")）"
    else
      pass "$1（末行: $(last_line "$OUT")）"
    fi
  else
    show_all
  fi
}

last_line() { tail -n 1 "$1" 2>/dev/null; }
# 末行计数解析（只从末行取，禁把明细行混进来）
last_field() { # <字段名>  ⇒ 末行 `... <字段>=<n> ...` 的 n（取不到 ⇒ 空）
  last_line "$OUT" | sed -n "s/.*$1=\\([0-9][0-9]*\\).*/\\1/p"
}
# 按行首前缀计数（DS-2 用；无匹配时 grep -c 输出 0 且 exit 1 ⇒ 兜住）
count_prefix() { # <行首前缀>
  local n; n="$(grep -c -- "^$1" "$OUT" 2>/dev/null || true)"
  printf '%s' "${n:-0}" | tr -d '\r\n'
}

assert_eq() { # <期望> <实际> <名称>
  if [ "$2" = "$1" ]; then return 0; fi
  fail "$3 — 期望 [$1]，实际 [$2]"
  return 1
}
assert_has() { # <文件> <字面串> <名称>
  if grep -Fq -- "$2" "$1"; then return 0; fi
  fail "$3 — 输出缺「$2」"
  return 1
}
assert_not_has() { # <文件> <字面串> <名称>
  if grep -Fq -- "$2" "$1"; then fail "$3 — 不应出现「$2」"; return 1; fi
  return 0
}
assert_last() { # <期望> <名称>
  local got; got="$(last_line "$OUT")"
  if [ "$got" = "$1" ]; then return 0; fi
  fail "$2 — 末行=[$got]（期望 [$1]）"
  return 1
}
line_get() { grep -E -- "^$1( |$)" "$OUT" 2>/dev/null; }
assert_line_has() { # <线名> <字面串> <名称>
  if line_get "$1" | grep -Fq -- "$2"; then return 0; fi
  fail "$3 — [$1] 行缺「$2」"
  return 1
}
assert_line_not_has() { # <线名> <字面串> <名称>
  if line_get "$1" | grep -Fq -- "$2"; then fail "$3 — [$1] 行不应出现「$2」"; return 1; fi
  return 0
}

# ── 运行（零网络夹具注入；degraded log 落沙箱）────────────────────────────────
API_DEAD="http://127.0.0.1:1/api/v1"
run_fixture() { # <dir> <fixture> [参数...]
  local dir="$1" fx="$2"; shift 2
  mkdir -p "$dir"
  OUT="$dir/out.txt"; ERR="$dir/err.txt"
  SYNO_GITEA_API="$API_DEAD" \
  SYNO_LINE_SIGNALS_FIXTURE="$fx" \
  SYNO_GATE_DEGRADED_LOG="$dir/degraded.log" \
    "${RUNNER[@]}" "$TOOL" "$@" > "$OUT" 2> "$ERR"
  RC=$?
}
run_nofx() { # <dir> <api> [参数...]（根级失败/参数类；显式清空夹具）
  local dir="$1" api="$2"; shift 2
  mkdir -p "$dir"
  OUT="$dir/out.txt"; ERR="$dir/err.txt"
  SYNO_GITEA_API="$api" \
  SYNO_LINE_SIGNALS_FIXTURE= \
  SYNO_GATE_DEGRADED_LOG="$dir/degraded.log" \
    "${RUNNER[@]}" "$TOOL" "$@" > "$OUT" 2> "$ERR"
  RC=$?
}

# ── 夹具构建（规格 §4.3 schema；逐子例独立 JSON）──────────────────────────────
fx_write() { # <out> <case>
  python3 - "$1" "$2" <<'PY' || return 1
import json, sys
out, case = sys.argv[1], sys.argv[2]
OK = {"ci": "ok", "overlap": "ok", "review": "ok", "serial": "ok"}
def pr(num, files, cond=None):
    return {"number": num, "branch": "ct/p7-%d" % num, "files": files,
            "conditions": dict(cond or OK)}
green    = pr(101, ["scripts/control-tower/probe-line-signals.ts"])
unknown  = pr(201, ["docs/plans/p7-602-x.md"])          # 不属任何报告线 ⇒ gaps
cross    = pr(301, ["src/a.ts", "scripts/b.sh"])        # 产品线 ＋ 治理线（四条件全 ok）
# v4.1：逐项降级 ⇒ 进 gaps 不可判栏（② 不加），仍计 ① 分母与 ③
degraded = pr(401, ["scripts/control-tower/x.sh"],
              {"ci": "degraded", "overlap": "ok", "review": "ok", "serial": "ok"})
mixed    = pr(501, ["src/a.ts", "docs/plans/p7-602-y.md"])   # 归产品线 ＋ 1 个未归属文件
# H 判定点：产品线 3 PR ＝ 2 未通过（全可判、非全 ok）＋ 1 不可判（含 degraded）
notdone  = [pr(621, ["src/h1.ts"], {"ci": "no", "overlap": "no", "review": "no", "serial": "ok"}),
            pr(622, ["src/h2.ts"], {"ci": "ok", "overlap": "no", "review": "ok", "serial": "ok"}),
            pr(623, ["src/h3.ts"], {"ci": "degraded", "overlap": "ok", "review": "ok", "serial": "ok"})]
# 跨线 ＋ 未通过（v4.1：所涉每条线各 1 条 NOT-DONE）
cross_nd = pr(631, ["src/a.ts", "scripts/b.sh"],
              {"ci": "ok", "overlap": "no", "review": "no", "serial": "ok"})
# --line gaps(global) 用：2 条全局缺口（unknown ＋ 不可判），与 ①/② 各自独立
linegaps = [pr(651, ["src/l1.ts"], {"ci": "no", "overlap": "ok", "review": "ok", "serial": "ok"}),
            pr(652, ["docs/plans/p7-602-z.md"]),
            pr(653, ["scripts/control-tower/z.sh"],
               {"ci": "degraded", "overlap": "ok", "review": "ok", "serial": "ok"})]
# 🔴 cross_pr 只在子例 F/G/跨线未通过出现：W1 对 `cross_pr: null` 判 E_FIXTURE_SHAPE（显式给出即必须是对象）
fx = {"open_prs": [], "drop_gaps_detail": False, "force_s1": "",
      "force_root_fail": False, "inject_b_metric": False, "allow_zero": False}
if case == "green":
    fx["open_prs"] = [green]
elif case == "unknown":
    fx["open_prs"] = [unknown]
elif case == "cross":
    fx["cross_pr"] = cross
elif case == "cross_notdone":
    fx["cross_pr"] = cross_nd
elif case == "mixed":
    fx["open_prs"] = [mixed]               # mixed-unassigned：归命中线 ＋ 未归属文件进 gaps
elif case == "zero":
    pass                                   # open_prs=[] 且未声明合法零 ⇒ exit 2（C2）
elif case == "zero_allow":
    fx["allow_zero"] = True                # C2「夹具显式声明合法零」⇒ exit 0
elif case == "drop_gaps":
    fx["open_prs"] = [unknown]
    fx["drop_gaps_detail"] = True          # B 旋钮：明细被丢而计数不变
elif case == "force_s1":
    fx["open_prs"] = [green]
    fx["force_s1"] = "1/1"                 # C 旋钮：0 PR 线强行 1/1
elif case == "inject_b":
    fx["open_prs"] = [green]
    fx["inject_b_metric"] = True           # E 旋钮：混入 B 口径键
elif case == "degraded":
    fx["open_prs"] = [degraded]            # v4.1：进 gaps 不可判栏、② 不加、① 分母含它
elif case == "notdone":
    fx["open_prs"] = notdone               # H 判定点夹具
elif case == "linegaps":
    fx["open_prs"] = linegaps              # --line 末行 gaps(global)=2
elif case == "root_fail":
    fx["open_prs"] = [green]
    fx["force_root_fail"] = True           # D 旋钮：根级失败
else:
    sys.exit("unknown fixture case: %s" % case)
with open(out, "w", encoding="utf-8") as fh:
    json.dump(fx, fh, ensure_ascii=False, indent=2)
PY
}

echo "═══ #602 回执三信号探针 · 配对测试（W2 · 第 2 轮 · 8 判定点 A–H）═══"
echo "被测: $REL_TOOL"
echo "沙箱: $WORK"
if [ ! -f "$TOOL" ]; then
  echo "❌ 被测件不存在: ${REL_TOOL}（W1 未交付）" >&2
  echo "结果: 0 通过, 1 失败"
  exit 1
fi
if [ "${#RUNNER[@]}" -eq 0 ]; then
  echo "❌ 环境不可用：npx 不可达（先 source ~/.nvm/nvm.sh 再跑）" >&2
  echo "结果: 0 通过, 1 失败"
  exit 1
fi
if ! "${RUNNER[@]}" --version >/dev/null 2>&1; then
  echo "❌ 环境不可用：npx tsx 跑不起来（无本地/全局 tsx）" >&2
  echo "结果: 0 通过, 1 失败"
  exit 1
fi

RO_BEFORE="$(git -C "$REPO_DIR" status --porcelain)"
mkdir -p "$WORK/fx" "$WORK/j" "$WORK/cli"

# 夹具 JSON 自检（全量可解析）
FX_BAD=0
FX_CASES="green unknown cross cross_notdone mixed zero zero_allow drop_gaps force_s1 inject_b degraded notdone linegaps root_fail"
for c in $FX_CASES; do
  fx_write "$WORK/fx/$c.json" "$c" || { fail "夹具构建失败: $c"; FX_BAD=1; continue; }
  python3 -m json.tool "$WORK/fx/$c.json" >/dev/null 2>&1 || { fail "夹具 JSON 不可解析: $c"; FX_BAD=1; }
done
[ "$FX_BAD" -eq 0 ] && extra "夹具 JSON 自检：$(printf '%s' "$FX_CASES" | wc -w | tr -d ' ') 个夹具全部可解析"

echo
echo "── A 8 个判定点（规格 §4.3 子例 A–H；零网络夹具）──"

# ── A 基线全绿（exit 0 ＋ 末行 exceptions=0 gaps=0 ＋ 5 线齐 ＋ 无 B 键）──────────
case_begin
run_fixture "$WORK/j/A" "$WORK/fx/green.json" --all
assert_eq 0 "$RC" "A inner_exit"
assert_last "LINE-SIGNALS: lines=5 exceptions=0 gaps=0" "A 末行"
assert_eq 5 "$(grep -cE '^(产品线|治理线|CTO|K3|基座线) ' "$OUT")" "A 5 线都出行（基座线不得少一行）"
assert_line_has "治理线" "①(merge-conditions)=1/1" "A 治理线 ① 通过率"
assert_line_has "治理线" "②=0" "A 治理线 ② 例外数"
assert_line_has "治理线" "③=1(跨线 0)" "A 治理线 ③ 在飞数"
assert_line_has "基座线" "n/a(未映射)" "A 基座线 ① 未映射（DS-3 反面；值 token，标签随实现）"
assert_line_has "基座线" "③=0(跨线 0)" "A 基座线 ③ 0(跨线 0)"
assert_line_has "产品线" "①(merge-conditions)=n/a(0)" "A 0 PR 线 ① n/a(0)"
assert_line_has "产品线" "③=0(跨线 0)" "A 0 PR 线 ③ 0(跨线 0)"
assert_eq 0 "$(count_prefix "exception: ")" "A 无例外明细"
assert_not_has "$OUT" "绕过" "A 禁 B 口径键（绕过）"
assert_not_has "$OUT" "拒绝" "A 禁 B 口径键（拒绝）"
assert_not_has "$OUT" "M_recur" "A 禁 B 口径键（M_recur）"
assert_not_has "$OUT" "M 复发" "A 禁 B 口径键（M 复发）"
case_end "A 基线全绿"

# ── B 计数与明细自洽（DS-2：末行 gaps == `^gap: ` 明细条数；改坏必红）────────────
case_begin
run_fixture "$WORK/j/B" "$WORK/fx/unknown.json" --all
assert_eq 1 "$RC" "B inner_exit（有 gaps ⇒ 1）"
assert_last "LINE-SIGNALS: lines=5 exceptions=0 gaps=1" "B 末行"
assert_has "$OUT" "gap: PR#201 unknown 1 files" "B gaps 明细格式与点名（unknown）"
assert_eq 1 "$(count_prefix "gap: ")" "B gaps 明细条数 == 末行 gaps（DS-2）"
assert_eq 1 "$(last_field gaps)" "B 末行 gaps 解析"
# 改坏旋钮：明细被丢而末行计数不变 ⇒ 被测件自身红，或计数≠明细被检查抓出
run_fixture "$WORK/j/B2" "$WORK/fx/drop_gaps.json" --all
GAP_IN_B2="$(count_prefix "gap: ")"
LAST_GAPS_B2="$(last_field gaps)"
if [ "$RC" = "2" ]; then
  extra "B 改坏夹具：被测件自身红（exit 2，计数≠明细守卫）"
elif [ "$GAP_IN_B2" = "0" ] && [ "$LAST_GAPS_B2" = "1" ]; then
  extra "B 改坏夹具：末行 gaps=1 而 ^gap: 明细=0（计数≠明细 ⇒ DS-2 判断抓到）"
else
  fail "B 改坏夹具（drop_gaps_detail）未被抓出：末行 gaps 与 ^gap: 明细仍一致（DS-2 判别力缺失）"
fi
case_end "B 计数与明细自洽"

# ── C 无在飞 PR 当 100% 必红（①(merge-conditions)=n/a(0) ＋ ③=0(跨线 0)；禁「无在飞 PR」）──
case_begin
run_fixture "$WORK/j/C" "$WORK/fx/green.json" --all
assert_line_has "产品线" "①(merge-conditions)=n/a(0)" "C 0 PR 线 ① 必须 n/a(0)（禁 1/1）"
assert_line_has "产品线" "③=0(跨线 0)" "C 0 PR 线 ③ 必须 0(跨线 0)（禁 n/a）"
assert_line_has "产品线" "②=0" "C 0 PR 线 ② 计数"
assert_not_has "$OUT" "无在飞 PR" "C 禁假事实「无在飞 PR」"
assert_line_has "基座线" "n/a(未映射)" "C 基座线恒未映射（值 token）"
# 改坏旋钮：0 PR 线强行 1/1 ⇒ 被测件自身红，或不变量检查抓出
run_fixture "$WORK/j/C2" "$WORK/fx/force_s1.json" --all
if [ "$RC" != "0" ]; then
  extra "C 改坏夹具：被测件自身红（exit=${RC}）"
elif line_get "产品线" | grep -Fq '1/1'; then
  extra "C 改坏夹具：0 PR 线输出 1/1（不变量抓出）"
else
  fail "C 改坏夹具（force_s1）未被抓出：0 PR 线仍非 1/1 且被测件未红"
fi
case_end "C 无 PR 当 100% 必红"

# ── D 根级失败 ⇒ exit 2 ＋ degraded（fail-closed；禁当 0 在飞）────────────────────
case_begin
run_nofx "$WORK/j/D" "$API_DEAD" --all
assert_eq 2 "$RC" "D inner_exit（根级 API 失败 ⇒ 2）"
assert_has "$ERR" "degraded:" "D stderr 降级行"
if grep -Eq 'code=[A-Z_]+' "$ERR"; then :; else fail "D stderr 降级行缺 code=<CODE>"; fi
if [ -s "$WORK/j/D/degraded.log" ]; then
  for f in time component code phase retryable; do
    grep -Fq "\"$f\"" "$WORK/j/D/degraded.log" || fail "D degraded-log 缺字段 $f"
  done
else
  fail "D degraded-log 未写入（SYNO_GATE_DEGRADED_LOG）"
fi
assert_not_has "$OUT" "exceptions=0 gaps=0" "D 根级失败时禁输出全绿末行（禁当 0 在飞）"
case_end "D 根级失败 exit 2"

# ── E 口径守卫（只 A 三信号；混入 B 口径键必红）──────────────────────────────────
case_begin
run_fixture "$WORK/j/E" "$WORK/fx/inject_b.json" --all
BKEY_HIT=0
for k in 绕过 拒绝 M_recur "M 复发"; do
  if grep -Fq -- "$k" "$OUT" "$ERR" 2>/dev/null; then BKEY_HIT=1; fi
done
if [ "$RC" != "0" ]; then
  extra "E 改坏夹具：被测件自身红（exit=${RC}，口径守卫）"
elif [ "$BKEY_HIT" = "1" ]; then
  extra "E 改坏夹具：B 口径键出现且可被守卫/检查抓出"
else
  fail "E 改坏夹具（inject_b_metric）未被抓出：既未红也未出现 B 口径键"
fi
case_end "E 混入 B 口径必红"

# ── F 跨线计入（两线各计 1 且带 (跨线 1)；禁硬归一线）──────────────────────────
case_begin
run_fixture "$WORK/j/F" "$WORK/fx/cross.json" --all
assert_eq 1 "$RC" "F inner_exit（跨线入 gaps ⇒ 1）"
assert_last "LINE-SIGNALS: lines=5 exceptions=0 gaps=1" "F 末行"
assert_line_has "产品线" "①(merge-conditions)=1/1" "F 产品线 ①"
assert_line_has "产品线" "③=1(跨线 1)" "F 产品线 ③ 计入跨线并标 (跨线 1)"
assert_line_has "治理线" "①(merge-conditions)=1/1" "F 治理线 ①"
assert_line_has "治理线" "③=1(跨线 1)" "F 治理线 ③ 计入跨线并标 (跨线 1)"
assert_has "$OUT" "gap: PR#301 cross 产品线,治理线" "F gaps 明细点名跨线（两线）"
assert_line_not_has "产品线" "③=0(跨线 0)" "F 跨线 PR 不得在产品线漏计"
assert_line_not_has "治理线" "③=0(跨线 0)" "F 跨线 PR 不得在治理线漏计"
case_end "F 跨线不得硬归"

# ── G 跨线漏计（两涉线 ③ 数字均 =1，合计=2；禁漏计/重复计）──────────────────────
case_begin
P3="$(line_get "产品线" | sed -n 's/.*③=\([0-9][0-9]*\)(跨线.*/\1/p')"
H3="$(line_get "治理线" | sed -n 's/.*③=\([0-9][0-9]*\)(跨线.*/\1/p')"
assert_eq 1 "$P3" "G 产品线 ③ 数字（漏计/重复计都会偏离 1）"
assert_eq 1 "$H3" "G 治理线 ③ 数字（漏计/重复计都会偏离 1）"
assert_eq 2 "$((P3 + H3))" "G 跨线 PR 计入所涉两线（逐线各一次 = 2）"
assert_not_has "$OUT" "无在飞 PR" "G 禁假事实「无在飞 PR」"
case_end "G 跨线漏计必红"

# ── H ② 只装「没做到」／降级进 gaps／① 分母含降级（v4.1 新增；DS-11 正例）────────
#    夹具：产品线 3 PR ＝ 2 未通过（四条件全可判、非全 ok）＋ 1 不可判（conditions 含 degraded）
case_begin
run_fixture "$WORK/j/H" "$WORK/fx/notdone.json" --all
assert_eq 1 "$RC" "H inner_exit（有例外＋缺口 ⇒ 1）"
# ① 分母含不可判（3 = 2 未通过 + 1 降级）⇒ fail-closed；② 只装没做到 ⇒ 2（不是 3）
assert_line_has "产品线" "①(merge-conditions)=0/3" "H ① 分母含降级（fail-closed）"
assert_line_has "产品线" "②=2" "H ② 只装没做到（降级不得 +1）"
assert_line_has "产品线" "③=3(跨线 0)" "H ③ 含不可判 PR"
assert_line_not_has "产品线" "②=3" "H ② 不得因降级变成 3（旧口径已废）"
# NOT-DONE 明细：条件名固定顺序 ci,overlap,review,serial
assert_has "$OUT" "exception: PR#621 产品线 NOT-DONE NO: ci,overlap,review" "H NOT-DONE 明细 #621（条件顺序）"
assert_has "$OUT" "exception: PR#622 产品线 NOT-DONE NO: overlap" "H NOT-DONE 明细 #622"
# 不可判项只进 gaps、点名 code；**不**许出现在 exceptions
assert_has "$OUT" "gap: PR#623 不可判 E_COND_DEGRADED" "H 不可判进 gaps 并点名 code"
assert_eq 0 "$(grep -c '^exception: .*E_COND_DEGRADED' "$OUT" 2>/dev/null || true)" "H 不可判项不得混入 exceptions"
# DS-2：末行计数 == 明细条数
assert_last "LINE-SIGNALS: lines=5 exceptions=2 gaps=1" "H 末行"
assert_eq 2 "$(last_field exceptions)" "H 末行 exceptions 解析"
assert_eq 2 "$(count_prefix "exception: ")" "H 例外明细条数 == 末行 exceptions（DS-2）"
assert_eq 1 "$(count_prefix "gap: ")" "H gap 明细条数 == 末行 gaps（DS-2）"
case_end "H ② 只装没做到／降级进 gaps／① 分母含降级"

echo
echo "── B 边界/参数/只读/突变断言（单列 EXTRA）──"

# B1 --selfcheck（8 子例自证可跑：判别力自检）
case_begin
run_nofx "$WORK/cli/selfcheck" "$API_DEAD" --selfcheck
assert_eq 0 "$RC" "--selfcheck inner_exit"
assert_last "SELFCHECK-OK: 8/8" "--selfcheck 末行"
case_end "--selfcheck 8/8" extra

# B2 --all --json：DS-8 键集 ＋ 可解析 ＋ s1/s2/s3 与文本同口径（② 用 v4.1 新语义值）
case_begin
run_fixture "$WORK/cli/json" "$WORK/fx/notdone.json" --all --json
assert_eq 1 "$RC" "DS-8 inner_exit（有例外＋缺口 ⇒ 1）"
run_fixture "$WORK/cli/json-text" "$WORK/fx/notdone.json" --all
if ! python3 -m json.tool "$WORK/cli/json/out.txt" >/dev/null 2>&1; then
  fail "DS-8 JSON 不可解析（python3 -m json.tool 失败）"
elif python3 - "$WORK/cli/json/out.txt" "$WORK/cli/json-text/out.txt" <<'PY'
import json, sys
jp, tp = sys.argv[1], sys.argv[2]
d = json.load(open(jp, encoding="utf-8"))
want = {"tool", "lines", "exceptions", "gaps", "mapping", "summary", "exit"}
got = set(d.keys())
bad = []
if got != want:
    bad.append("键集=[%s]，期望=[%s]" % (",".join(sorted(got)), ",".join(sorted(want))))
for bk in ("bypass_rate", "拒绝", "绕过", "M_recur", "M 复发"):
    if bk in d:
        bad.append("出现 B 口径键 %r" % (bk,))
lines = d.get("lines")
if not isinstance(lines, list) or len(lines) != 5:
    bad.append("lines 必须是 5 条（实际 %r）" % (lines,))
else:
    text = open(tp, encoding="utf-8").read().splitlines()
    byname = {}
    for e in lines:
        if set(e.keys()) != {"line", "s1", "s2", "s3"}:
            bad.append("lines[] 键集=%r" % (sorted(e.keys()),)); continue
        name = e["line"]
        byname[name] = e
        cand = [l for l in text if l == name or l.startswith(name + " ")]
        if not cand:
            bad.append("文本缺线 [%s]" % name); continue
        row = cand[0]
        for k in ("s1", "s2", "s3"):
            tok = str(e[k])
            if tok not in row:
                bad.append("%s 的 %s=%r 未出现在文本行 %r" % (name, k, tok, row))
    # v4.1 ② 新语义：产品线 ②=2（2 条 NOT-DONE；不可判不计），①=0/3（分母含降级）
    prod = byname.get("产品线")
    if not isinstance(prod, dict):
        bad.append("JSON 缺产品线行")
    else:
        if prod.get("s1") != "0/3":
            bad.append("产品线 JSON s1=%r（期望 0/3，分母含降级）" % (prod.get("s1"),))
        if prod.get("s2") != "2":
            bad.append("产品线 JSON s2=%r（期望 2，只装没做到）" % (prod.get("s2"),))
        if prod.get("s3") != "3(跨线 0)":
            bad.append("产品线 JSON s3=%r（期望 3(跨线 0)）" % (prod.get("s3"),))
ex = d.get("exceptions")
if not isinstance(ex, list) or len(ex) != 2:
    bad.append("exceptions 必须是 2 条（实际 %r）" % (ex,))
else:
    for e in ex:
        if e.get("code") != "NOT-DONE":
            bad.append("exceptions[] 出现非 NOT-DONE 条目：%r" % (e,))
        if set(e.keys()) != {"pr", "line", "lines", "code", "no", "phase", "retryable"}:
            bad.append("exceptions[] 键集=%r" % (sorted(e.keys()),))
gp = d.get("gaps")
if not isinstance(gp, list) or len(gp) != 1:
    bad.append("gaps 必须是 1 条（实际 %r）" % (gp,))
else:
    g = gp[0]
    if g.get("kind") != "unjudgeable":
        bad.append("gaps[0].kind=%r（期望 unjudgeable）" % (g.get("kind"),))
    if g.get("code") != "E_COND_DEGRADED":
        bad.append("gaps[0].code=%r（期望 E_COND_DEGRADED）" % (g.get("code"),))
if not isinstance(d.get("mapping"), dict) or "rule_hits" not in d["mapping"]:
    bad.append("mapping 缺 rule_hits")
if not isinstance(d.get("summary"), dict):
    bad.append("summary 不是对象")
if d.get("exit") != 1:
    bad.append("exit 字段=%r（期望 1）" % (d.get("exit"),))
if bad:
    print("\n".join(bad), file=sys.stderr)
    sys.exit(1)
PY
then
  extra "DS-8 JSON 键集齐 ＋ s1/s2/s3 与文本同口径（②=new 语义 2）＋ exceptions 只 NOT-DONE"
else
  fail "DS-8 JSON 断言失败（详见 stderr）"
fi
case_end "DS-8 --json 输出" extra

# B3 --line 文本末行 `gaps(global)=<n>`，n == 同夹具 --all 的末行 gaps（断言具体数值）
case_begin
run_fixture "$WORK/cli/line-all" "$WORK/fx/linegaps.json" --all
ALL_GAPS="$(last_field gaps)"
run_fixture "$WORK/cli/line" "$WORK/fx/linegaps.json" --line 产品线
LINE_RC="$RC"
LINE_LAST="$(last_line "$OUT")"
assert_eq 1 "$LINE_RC" "--line 产品线 inner_exit（全局有缺口 ⇒ 1）"
assert_eq 1 "$(grep -cE '^(产品线|治理线|CTO|K3|基座线) ' "$OUT")" "--line 只出一行"
assert_line_has "产品线" "①(merge-conditions)=0/1" "--line ① 分母含该线全部已归属 PR"
assert_line_has "产品线" "②=1" "--line ② NOT-DONE 条数"
assert_line_has "产品线" "③=1(跨线 0)" "--line ③"
assert_has "$OUT" "exception: PR#651 产品线 NOT-DONE NO: ci" "--line 例外逐条点名（行首无缩进）"
assert_eq 1 "$(count_prefix "exception: ")" "--line 例外明细条数 == ②"
assert_eq 0 "$(count_prefix "gap: ")" "--line 不展开 gap 明细（全局口径）"
assert_last "gaps(global)=2" "--line 末行 gaps(global)"
assert_eq 2 "$ALL_GAPS" "linegaps 夹具 --all 末行 gaps（基准）"
assert_eq "$ALL_GAPS" "${LINE_LAST#gaps(global)=}" "--line 末行 gaps(global) == --all 末行 gaps"
assert_not_has "$OUT" "治理线 " "--line 不得夹带其它线"
assert_not_has "$OUT" "③=0(跨线 0)" "--line 不输出未选中的空线行"
case_end "--line 末行 gaps(global) 与 --all 同口径" extra

# B4 --line --json：顶层七键不变 ＋ summary.gaps_global=<全局>／summary.gaps=<本次明细数>
case_begin
run_fixture "$WORK/cli/line-json" "$WORK/fx/linegaps.json" --line 治理线 --json
if ! python3 -m json.tool "$WORK/cli/line-json/out.txt" >/dev/null 2>&1; then
  fail "--line --json 不可解析"
elif python3 - "$WORK/cli/line-json/out.txt" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
bad = []
want = {"tool", "lines", "exceptions", "gaps", "mapping", "summary", "exit"}
if set(d.keys()) != want:
    bad.append("--line --json 顶层键集=%r（必须仍为 DS-8 七键）" % (sorted(d.keys()),))
s = d.get("summary")
if not isinstance(s, dict):
    bad.append("summary 不是对象")
else:
    if s.get("gaps_global") != 2:
        bad.append("summary.gaps_global=%r（期望 2 = 全局缺口）" % (s.get("gaps_global"),))
    if s.get("gaps") != 0:
        bad.append("summary.gaps=%r（期望 0 = 本次输出明细数）" % (s.get("gaps"),))
if len(d.get("gaps", [])) != 0:
    bad.append("单线视图 gaps[] 必须为空（全局口径不展开）")
if len(d.get("lines", [])) != 1:
    bad.append("lines 必须 1 条（实际 %d）" % len(d.get("lines", [])))
if d.get("exit") != 1:
    bad.append("exit 字段=%r（期望 1：全局有缺口）" % (d.get("exit"),))
if bad:
    print("\n".join(bad), file=sys.stderr)
    sys.exit(1)
PY
then
  extra "--line --json：七键不变 ＋ summary.gaps_global=2／summary.gaps=0"
else
  fail "--line --json 断言失败（详见 stderr）"
fi
case_end "--line --json summary 口径" extra

# B5 参数边界：--line 不存在线 ⇒ 2
case_begin
run_nofx "$WORK/cli/line-bad" "$API_DEAD" --line 不存在的线
assert_eq 2 "$RC" "--line 不存在线 inner_exit"
assert_eq 1 "$([ -s "$ERR" ] && echo 1 || echo 0)" "--line 不存在线 有 stderr 说明"
case_end "--line 不存在线 exit 2" extra

# B6 参数互斥：--json 与 --selfcheck 同给 ⇒ 2
case_begin
run_nofx "$WORK/cli/mutex" "$API_DEAD" --json --selfcheck
assert_eq 2 "$RC" "--json＋--selfcheck inner_exit（互斥）"
case_end "--json/--selfcheck 互斥 exit 2" extra

# B7 C2 边界：open_pr=0 未声明合法零 ⇒ exit 2
case_begin
run_fixture "$WORK/cli/zero" "$WORK/fx/zero.json" --all
assert_eq 2 "$RC" "C2 open_pr=0 未声明 ⇒ exit 2（信号量==0）"
assert_has "$ERR" "degraded:" "C2 0 PR 降级行"
case_end "C2 信号量==0 ⇒ exit 2" extra

# B8 C2 边界：夹具显式声明合法零 ⇒ exit 0
case_begin
run_fixture "$WORK/cli/zero-allow" "$WORK/fx/zero_allow.json" --all
assert_eq 0 "$RC" "C2 allow_zero=true ⇒ exit 0"
assert_last "LINE-SIGNALS: lines=5 exceptions=0 gaps=0" "C2 合法零末行"
assert_has "$OUT" "③=0(跨线 0)" "C2 合法零 ③ 显示 0(跨线 0)"
case_end "C2 合法零 allow_zero" extra

# B9 旋钮：force_root_fail ⇒ exit 2 ＋ degraded（与真实 API 失败同口径）
case_begin
run_fixture "$WORK/cli/rootfail" "$WORK/fx/root_fail.json" --all
assert_eq 2 "$RC" "force_root_fail inner_exit"
assert_has "$ERR" "degraded:" "force_root_fail 降级行"
case_end "force_root_fail 旋钮" extra

# B10 降级粒度（v4.1 改写）：逐项降级 ⇒ gaps 不可判栏、② 不加、① 分母含降级、整体 exit 1（非 2）
case_begin
run_fixture "$WORK/cli/degraded" "$WORK/fx/degraded.json" --all
assert_eq 1 "$RC" "降级粒度 inner_exit（逐项 ⇒ 1，非 2）"
assert_last "LINE-SIGNALS: lines=5 exceptions=0 gaps=1" "降级粒度末行（例外 0／缺口 1）"
assert_eq 0 "$(count_prefix "exception: ")" "降级不得进 exceptions（② 只装没做到）"
assert_eq 1 "$(count_prefix "gap: ")" "降级进 gaps 一条"
assert_has "$OUT" "gap: PR#401 不可判 E_COND_DEGRADED" "gaps 不可判栏点名 PR 与 code"
assert_line_has "治理线" "①(merge-conditions)=0/1" "① 分母含降级（fail-closed）"
assert_line_has "治理线" "②=0" "② 不加（不可判不计 ②）"
assert_line_has "治理线" "③=1(跨线 0)" "③ 仍计降级 PR"
case_end "降级粒度：不可判 ⇒ gaps／② 不加／① 分母含" extra

# B11 跨线未通过（v4.1 新增）：所涉每条线各 1 条 NOT-DONE（② 每线 1、两线共 2 条）
case_begin
run_fixture "$WORK/cli/cross-nd" "$WORK/fx/cross_notdone.json" --all
assert_eq 1 "$RC" "跨线未通过 inner_exit"
assert_last "LINE-SIGNALS: lines=5 exceptions=2 gaps=1" "跨线未通过末行（两线各 1 条 ＋ 跨线缺口）"
assert_line_has "产品线" "②=1" "跨线未通过：产品线 ②=1"
assert_line_has "治理线" "②=1" "跨线未通过：治理线 ②=1"
assert_line_has "产品线" "①(merge-conditions)=0/1" "跨线未通过：产品线 ① 分母含该 PR"
assert_line_has "治理线" "①(merge-conditions)=0/1" "跨线未通过：治理线 ① 分母含该 PR"
assert_has "$OUT" "exception: PR#631 产品线 NOT-DONE NO: overlap,review" "跨线未通过：产品线条目"
assert_has "$OUT" "exception: PR#631 治理线 NOT-DONE NO: overlap,review" "跨线未通过：治理线条目"
assert_eq 2 "$(count_prefix "exception: ")" "跨线未通过：末行 exceptions == 明细条数（DS-2）"
assert_eq 1 "$(count_prefix "gap: ")" "跨线未通过：跨线缺口仍逐项点名"
case_end "跨线未通过 ⇒ 每线各 1 条 NOT-DONE" extra

# B12 混合 PR：命中线计数 ＋ 未归属文件逐项进 gaps（mixed-unassigned）
case_begin
run_fixture "$WORK/cli/mixed" "$WORK/fx/mixed.json" --all
assert_eq 1 "$RC" "mixed inner_exit"
assert_last "LINE-SIGNALS: lines=5 exceptions=0 gaps=1" "mixed 末行"
assert_has "$OUT" "gap: PR#501 mixed-unassigned 1 files" "mixed 明细逐项点名未归属文件数"
assert_eq 1 "$(count_prefix "gap: ")" "mixed 明细条数 == 末行 gaps"
assert_line_has "产品线" "③=1(跨线 0)" "mixed 归命中线（产品线）"
assert_line_has "产品线" "①(merge-conditions)=1/1" "mixed 的 ① 分母含该 PR"
case_end "混合 PR：未归属文件进 gaps" extra

# B13 DS-8 gaps[] 与文本明细一致（cross 夹具：JSON 1 条 == 文本 ^gap: 1 行）
case_begin
run_fixture "$WORK/cli/json-cross" "$WORK/fx/cross.json" --all --json
assert_eq 1 "$RC" "DS-8[cross] inner_exit"
run_fixture "$WORK/cli/json-cross-text" "$WORK/fx/cross.json" --all
if python3 - "$WORK/cli/json-cross/out.txt" "$WORK/cli/json-cross-text/out.txt" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
text = open(sys.argv[2], encoding="utf-8").read().splitlines()
gap_lines = [l for l in text if l.startswith("gap: ")]
bad = []
if len(d.get("gaps", [])) != 1:
    bad.append("gaps[] 长度=%r（期望 1）" % (len(d.get("gaps", [])),))
if len(gap_lines) != 1:
    bad.append("文本 ^gap: 行=%d（期望 1）" % len(gap_lines))
if d.get("exceptions") != []:
    bad.append("exceptions 应为空，实际 %r" % (d.get("exceptions"),))
if d.get("exit") != 1:
    bad.append("exit 字段=%r（期望 1）" % (d.get("exit"),))
if bad:
    print("\n".join(bad), file=sys.stderr)
    sys.exit(1)
PY
then
  extra "DS-8 gaps[] 与文本明细一致（cross：JSON 1 == 文本 ^gap: 1）"
else
  fail "DS-8 gaps[]/文本明细不一致（详见 stderr）"
fi
case_end "DS-8 gaps[] 与文本一致" extra

# B14 三态：0／1／2 各一例（A 全绿 / 有缺口 / 根级失败）
case_begin
run_fixture "$WORK/cli/tri0" "$WORK/fx/green.json" --all; TRI0="$RC"
run_fixture "$WORK/cli/tri1" "$WORK/fx/unknown.json" --all; TRI1="$RC"
run_nofx "$WORK/cli/tri2" "$API_DEAD" --all; TRI2="$RC"
assert_eq 0 "$TRI0" "三态[0] 全绿夹具"
assert_eq 1 "$TRI1" "三态[1] 有缺口"
assert_eq 2 "$TRI2" "三态[2] 根级失败"
case_end "三态 0/1/2 各一例" extra

# B15 只读证明：运行前后真实仓 git status 逐字节相同（DS-7）
case_begin
RO_AFTER="$(git -C "$REPO_DIR" status --porcelain)"
if [ "$RO_BEFORE" = "$RO_AFTER" ]; then :; else
  fail "只读证明失败 — 真实仓 status 变了:"
  diff <(printf '%s\n' "$RO_BEFORE") <(printf '%s\n' "$RO_AFTER") | sed 's/^/       | /' >&2
fi
case_end "只读证明（运行前后 git status 一致）" extra

# B16 内部突变自证：把探针复制到 mktemp 改坏一处关键输出标记 ⇒ 本测试必须 exit 1
if [ -z "${SYNO_LINE_SIGNALS_NO_SELF_MUTATION:-}" ]; then
  case_begin
  mkdir -p "$WORK/mut"
  MUT="$WORK/mut/probe-line-signals-mut.ts"
  if python3 - "$TOOL" "$MUT" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
cands = [
    ("①(merge-conditions)", "①(mc)"),
    ("NOT-DONE", "NOTDONE"),
    ("gaps(global)=", "gapsglobal="),
    ("(跨线 ", "(cross "),
    ("LINE-SIGNALS:", "LINE-SIGNAL:"),
    ("n/a(未映射)", "n/a(nomap)"),
]
for old, new in cands:
    if old in text:
        with open(dst, "w", encoding="utf-8") as fh:
            fh.write(text.replace(old, new))   # 全量替换：连自检期望 token 一起改坏，确保输出可判
        print("mutated: %s -> %s" % (old, new))
        break
else:
    sys.exit(3)
PY
  then
    if cmp -s "$TOOL" "$MUT"; then
      fail "内部突变未生效（副本与原件逐字节相同）"
    else
      SYNO_LINE_SIGNALS_NO_SELF_MUTATION=1 SYNO_LINE_SIGNALS_TOOL="$MUT" \
        bash "$0" > "$WORK/mut/selfproof.txt" 2>&1
      MRC=$?
      if [ "$MRC" = "1" ]; then :; else
        fail "内部突变自证失败 — 改坏副本跑本测试 exit=${MRC}（期望 1）"
        sed 's/^/       | /' "$WORK/mut/selfproof.txt" >&2
      fi
    fi
  else
    fail "内部突变未找到可改坏的关键输出标记（被测件无已知标记）"
  fi
  case_end "内部突变自证（改坏副本 ⇒ 本测试 exit 1）" extra
fi

echo
echo "结果: ${PASS} 通过, ${FAIL} 失败"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
if [ "$PASS" -ne 8 ]; then
  echo "❌ 判定点数 ${PASS} ≠ 8（规格 §4.3 八子例 A–H：N 必须自洽）" >&2
  exit 1
fi
if [ "$EXTRA" -eq 0 ]; then
  echo "❌ 边界断言一条都没跑（判别力自检不可为空）" >&2
  exit 1
fi
exit 0
