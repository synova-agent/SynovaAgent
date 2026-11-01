#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# verify-doc-budgets.test.sh — G-DOC-1 指令面体积预算判据的配对测试（W0-1 / P2-b）
#
# 为什么是"判别力"夹具而不是示例夹具:
#   判据能不能拦人，只能由**改坏即红**证明——同一份合规夹具上：
#     · 原脚本 ⇒ exit 0；
#     · 只把阈值常量 sed 改小（`CAP_DOMAIN=100`）的变异体 ⇒ 必须 exit 1。
#   变异体仍 exit 0 ⇒ 阈值根本没被读（纸老虎）⇒ 本测试判红。
#   另一半判别力来自**三态**：看不见（缺 docs／缺根件／缺域守则／零可统计文件）必须 exit 2，
#   而**报告面**（docs/** 超量）必须**不影响 rc** —— 否则"只报不判"就变成了暗门禁。
#
# 覆盖矩阵（A 正常/双测口径 ｜ B 三口径超限 ｜ C 三态降级 ｜ D 自检与用法 ｜ E 变异体 ｜ F 不污染）:
#   A1 合规沙箱（14 件全小）⇒ exit 0 ＋ `BUDGETS: OK 14/14`
#   A2 报告面隔离: docs/ 注入 200KB 的 .md ⇒ 仍 exit 0（docs 不参与 rc；件数/字节含 docs/AGENTS.md）
#   A3 缺省 --root（cwd=仓根）⇒ 由脚本位置推根，exit 0（真实仓只读，不写）
#   B1 单份域守则 4000 B > 3584 ⇒ exit 1 ＋ 点名 `E_BUDGET_OVER: expert/AGENTS.md`（❌ 计数=1）
#   B2 根件 66000 B > 65536 ⇒ exit 1 ＋ 点名 AGENTS.md ＋ `根件上限`
#   B3 合计口径: 根件 30000 B ＋ 13×3584 B = 76592 B（**每件都在单份上限内**）⇒ exit 1 ＋ `合计口径`
#   C1 缺 docs/（整目录，连带判据面一件）⇒ exit 2 ＋ `degraded: E_NO_DOCS`
#   C2 缺根 AGENTS.md ⇒ exit 2 ＋ `degraded: E_MISSING_AGENTS`
#   C3 清单内缺一份域守则 ⇒ exit 2 ＋ `degraded: E_MISSING_DOMAIN`
#   C4 「docs/ 内 0 件」态**结构性不可达**（docs/AGENTS.md 自身即 .md 且被计入）⇒ 断言真实行为：仍 0 且件数=1
#   C5 --root 不存在 ⇒ exit 2 ＋ `degraded: E_NO_ROOT`
#   D1 `--selfcheck` ⇒ rc 0 且末行 `SELFCHECK-OK`
#   D2 未知参数 ⇒ exit 2 ＋ `degraded: E_USAGE`
#   E1 变异体（CAP_DOMAIN 改 10 < 夹具 60 B）在合规夹具上 ⇒ 1；原脚本同一夹具 ⇒ 0（结论翻转）
#   E2 变异体（CAP_TOTAL 改 100）⇒ 1（证明合计口径真的被读）
#   F1 降级日志 JSON 五字段齐全（time/component/code/phase/retryable）
#   F2 同一夹具连跑两次 ⇒ 输出逐字节相同（确定性，无隐藏状态）
#   F3 跑完夹具目录文件集合不变（不写入被检树）
#
# 沙箱: 全部夹具在 mktemp -d 内；`SYNO_GATE_DEGRADED_LOG` 全局指向临时目录 ⇒ 降级日志绝不写仓库。
# 依赖: bash ＋ awk（造精确字节夹具）＋ python（只用于 JSON 断言；缺失 ⇒ 判红不 skip）。
# 运行: bash tests/doc-system/verify-doc-budgets.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set +e

# 环境隔离（AGENTS.md §8.1 ②）: 夹具不继承外层 git/CI 上下文
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
S="$REPO/scripts/doc-system/verify-doc-budgets.sh"
PASS=0
FAIL=0

ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
t() { if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else no "$1 (期望 $2 实际 $3)"; fi; }

fatal() { # 环境/夹具失败 ⇒ 后续断言不可信：打印汇总后判红（禁 skip 冒充通过）
  no "环境/夹具失败: $1"
  echo ""
  echo "── 汇总: ${PASS} 通过 / ${FAIL} 失败 ──"
  echo "结果: ${PASS} 通过, ${FAIL} 失败"
  exit 1
}

[ -f "$S" ] || fatal "被测脚本缺失: $S"
command -v awk >/dev/null 2>&1 || fatal "awk 不可用 —— 无法造精确字节夹具"

PY=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import json" >/dev/null 2>&1 && PY="$_c" && break
done
[ -n "$PY" ] || fatal "python 三级探测全失败（D520 清单1）—— 无法核降级日志 JSON"

TMPD="$(mktemp -d)" || fatal "mktemp -d 失败"
trap 'rm -rf "$TMPD"' EXIT
LAST="$TMPD/last.out"
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded-events.log"  # 降级只落临时目录，绝不进仓库

# 判据面清单副本（**故意独立一份**：脚本内清单改了而本测试没跟上 ⇒ 下面的 G 组断言会红）
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

gen_bytes() { # $1=字节数 $2=目标文件（内容为 x，便于肉眼分辨夹具）
  awk -v n="$1" 'BEGIN{for(i=0;i<n;i++)printf "x"}' > "$2"
}

mkfix() { # $1=dir [--no-docs] [--no-agents] [--drop <rel>] [--root-bytes N] [--dom-bytes N] [--docs-extra N]
  local d="$1"; shift
  local no_docs=0 no_agents=0 drop="" rootb=60 domb=60 extra=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-docs)    no_docs=1; shift ;;
      --no-agents)  no_agents=1; shift ;;
      --drop)       drop="${2:-}"; shift 2 ;;
      --root-bytes) rootb="$2"; shift 2 ;;
      --dom-bytes)  domb="$2"; shift 2 ;;
      --docs-extra) extra="$2"; shift 2 ;;
      *)            return 1 ;;
    esac
  done
  mkdir -p "$d" || return 1
  if [ "$no_agents" -eq 0 ]; then gen_bytes "$rootb" "$d/AGENTS.md" || return 1; fi
  local rel
  for rel in "${DOMAIN_RULES[@]}"; do
    if [ "$rel" = "$drop" ]; then continue; fi
    mkdir -p "$d/$(dirname "$rel")" || return 1
    gen_bytes "$domb" "$d/$rel" || return 1
  done
  if [ "$no_docs" -eq 0 ]; then
    mkdir -p "$d/docs" || return 1
    gen_bytes 40 "$d/docs/fixture.md" || return 1
    if [ "$extra" -gt 0 ]; then gen_bytes "$extra" "$d/docs/big.md" || return 1; fi
  else
    rm -rf "$d/docs" || return 1   # docs/AGENTS.md 是判据面一件 ⇒ 造"缺 docs"必须整目录删
  fi
  return 0
}

rc_of() { # 跑被测脚本（透传参数）→ 输出落 $LAST，回显 rc
  bash "$S" "$@" > "$LAST" 2>&1
  echo $?
}
out_has() { grep -qF -- "$1" "$LAST"; }
out_cnt() { grep -cF -- "$1" "$LAST" | tr -d '\r\n'; }
snap() { ( cd "$1" && find . -type f | sort ); }

echo "═══ verify-doc-budgets.test.sh — G-DOC-1 指令面体积预算（W0-1 P2-b）═══"
echo "夹具根: $TMPD"

# ── A 正常 ＋ 双测口径 ──────────────────────────────────────────────────────
echo "── A 正常 ＋ 双测口径 ──"
A="$TMPD/a1"; mkfix "$A" || fatal "A1 夹具构造失败"
t "A1 合规沙箱（14 件全小）⇒ 0" 0 "$(rc_of --root "$A")"
out_has "BUDGETS: OK 14/14" && ok "A1 汇总 BUDGETS: OK 14/14" || no "A1 缺汇总 OK 14/14"
out_has "指令面合计:" && ok "A1 打印指令面合计" || no "A1 未打印指令面合计"
out_has "单份最大" && ok "A1 打印单份最大" || no "A1 未打印单份最大"
out_has "docs/** 全量:" && ok "A1 打印 docs/** 全量（只报不判面）" || no "A1 未打印 docs/** 全量"

B="$TMPD/a2"; mkfix "$B" --docs-extra 200000 || fatal "A2 夹具构造失败"
t "A2 docs/ 注入 200KB 仍 ⇒ 0（只报不判）" 0 "$(rc_of --root "$B")"
# docs 统计含判据面件 docs/AGENTS.md（60 B）⇒ 期望 40 + 200000 + 60 = 200100 B / 3 件
out_has "docs/** 全量: 3 件 / 200100 B" && ok "A2 docs 件数/字节如实打印（3 件 / 200100 B，含 docs/AGENTS.md）" \
  || no "A2 docs 统计不符：$(grep -F 'docs/** 全量' "$LAST")"
[ "$(out_cnt "❌")" = "0" ] && ok "A2 docs 超量不打 ❌" || no "A2 docs 超量打了 ❌（计数=$(out_cnt "❌")）"

( cd "$REPO" && bash "$S" ) > "$LAST" 2>&1
RC=$?
t "A3 缺省 --root（cwd=仓根）⇒ 0" 0 "$RC"
out_has "root: $REPO" && ok "A3 由脚本位置推出仓根（root: $REPO）" || no "A3 推到错误的 root"

# ── B 三口径超限（单份／根件／合计）────────────────────────────────────────
echo "── B 三口径超限 ──"
C="$TMPD/b1"; mkfix "$C" || fatal "B1 夹具构造失败"
gen_bytes 4000 "$C/expert/AGENTS.md" || fatal "B1 造超限件失败"
t "B1 单份 4000 B > 3584 ⇒ 1" 1 "$(rc_of --root "$C")"
out_has "E_BUDGET_OVER: expert/AGENTS.md" && ok "B1 点名 E_BUDGET_OVER: expert/AGENTS.md" || no "B1 未点名超限文件"
out_has "单份上限" && ok "B1 标明口径=单份上限" || no "B1 未标口径"
[ "$(out_cnt "❌")" = "1" ] && ok "B1 只点 1 件（❌ 计数=1）" || no "B1 ❌ 计数=$(out_cnt "❌")（应 1）"
out_has "BUDGETS: VIOLATION 1" && ok "B1 结论行 BUDGETS: VIOLATION 1" || no "B1 结论行不符"

D="$TMPD/b2"; mkfix "$D" --root-bytes 66000 || fatal "B2 夹具构造失败"
t "B2 根件 66000 B > 65536 ⇒ 1" 1 "$(rc_of --root "$D")"
out_has "E_BUDGET_OVER: AGENTS.md 66000 B" && ok "B2 点名根件 66000 B" || no "B2 未点名根件"
out_has "根件上限" && ok "B2 标明口径=根件上限" || no "B2 未标根件上限"

E="$TMPD/b3"; mkfix "$E" --root-bytes 30000 --dom-bytes 3584 || fatal "B3 夹具构造失败"
t "B3 合计 76592 > 65536（每件都在单份上限内）⇒ 1" 1 "$(rc_of --root "$E")"
out_has "E_BUDGET_OVER: 指令面合计 76592 B" && ok "B3 点名合计 76592 B" || no "B3 未点名合计"
out_has "合计口径" && ok "B3 标明口径=合计口径" || no "B3 未标合计口径"
[ "$(out_cnt "✅")" = "14" ] && ok "B3 逐件判定不被合计污染（14 件全 ✅）" \
  || no "B3 ✅ 计数=$(out_cnt "✅")（应 14：单件全绿、只有合计红）"

# ── C 三态降级（判不了 ≠ 通过）──────────────────────────────────────────────
echo "── C 三态降级 ──"
F="$TMPD/c1"; mkfix "$F" --no-docs || fatal "C1 夹具构造失败"
t "C1 缺 docs/ ⇒ 2" 2 "$(rc_of --root "$F")"
out_has "degraded: E_NO_DOCS" && ok "C1 degraded: E_NO_DOCS" || no "C1 缺 E_NO_DOCS"

G="$TMPD/c2"; mkfix "$G" --no-agents || fatal "C2 夹具构造失败"
t "C2 缺根 AGENTS.md ⇒ 2" 2 "$(rc_of --root "$G")"
out_has "degraded: E_MISSING_AGENTS" && ok "C2 degraded: E_MISSING_AGENTS" || no "C2 缺 E_MISSING_AGENTS"

H="$TMPD/c3"; mkfix "$H" --drop src/l3/AGENTS.md || fatal "C3 夹具构造失败"
t "C3 清单内缺 src/l3/AGENTS.md ⇒ 2" 2 "$(rc_of --root "$H")"
out_has "degraded: E_MISSING_DOMAIN" && ok "C3 degraded: E_MISSING_DOMAIN" || no "C3 缺 E_MISSING_DOMAIN"
out_has "src/l3/AGENTS.md" && ok "C3 点名缺件路径" || no "C3 未点名缺件路径"

I="$TMPD/c4"; mkfix "$I" || fatal "C4 夹具构造失败"
rm -f "$I/docs/fixture.md"
# 「docs/ 内 0 件」态结构性不可达：docs/AGENTS.md 是判据面一件、也是 docs 内一份 .md，
# 且 docs/** 统计**包含它** ⇒ 删掉所有其它文档后，件数仍为 1。此处断言这个**真实行为**，
# 而不是断言一个永远走不到的 E_NO_FILES（脚本 Known Limitations 7 已写明该分支仅作守卫）。
t "C4 docs/ 只剩判据面件时仍 ⇒ 0（0 件态结构性不可达，见 Known Limitations 7）" 0 "$(rc_of --root "$I")"
out_has "docs/** 全量: 1 件" && ok "C4 docs 件数=1（即 docs/AGENTS.md 被计入）" || no "C4 docs 件数不符：$(grep -F 'docs/** 全量' "$LAST")"

t "C5 --root 不存在 ⇒ 2" 2 "$(rc_of --root "$TMPD/no-such-root")"
out_has "degraded: E_NO_ROOT" && ok "C5 degraded: E_NO_ROOT" || no "C5 缺 E_NO_ROOT"

# ── D 自检与用法 ────────────────────────────────────────────────────────────
echo "── D 自检与用法 ──"
bash "$S" --selfcheck > "$LAST" 2>&1
t "D1 --selfcheck ⇒ 0" 0 "$?"
tail -1 "$LAST" | grep -qx "SELFCHECK-OK" && ok "D1 末行 SELFCHECK-OK" || no "D1 末行不是 SELFCHECK-OK: $(tail -1 "$LAST")"
out_has "SELFCHECK: " && ok "D1 打印断言计数" || no "D1 未打印断言计数"

t "D2 未知参数 ⇒ 2" 2 "$(rc_of --bogus)"
out_has "degraded: E_USAGE" && ok "D2 degraded: E_USAGE" || no "D2 缺 E_USAGE"

# ── E 变异体（改坏即红 = 判别力自证）─────────────────────────────────────────
echo "── E 变异体（改坏即红）──"
MUT="$TMPD/mut"; mkdir -p "$MUT" || fatal "建变异体目录失败"
t "E0 原脚本在合规夹具 ⇒ 0（基线）" 0 "$(rc_of --root "$A")"
# 变异靶: 合规夹具每件 60 B ⇒ 上限降到 10 B 才必然翻转（降到 100 不会红——那正是"变异体没打在靶上"）
sed 's/^CAP_DOMAIN=3584/CAP_DOMAIN=10/' "$S" > "$MUT/mut-domain.sh"
grep -q '^CAP_DOMAIN=10' "$MUT/mut-domain.sh" \
  && ok "E1 变异体已生成（sed 命中 CAP_DOMAIN 常量）" || no "E1 sed 未命中变异靶（常量行已变，须同步本测试）"
bash "$MUT/mut-domain.sh" --root "$A" > "$LAST" 2>&1
t "E1 变异体（CAP_DOMAIN=10 < 夹具 60 B）同一夹具 ⇒ 1（结论翻转）" 1 "$?"
out_has "BUDGETS: VIOLATION" && ok "E1 变异体打 VIOLATION（阈值真的被读）" || no "E1 变异体未打 VIOLATION"

sed 's/^CAP_TOTAL=65536/CAP_TOTAL=100/' "$S" > "$MUT/mut-total.sh"
grep -q '^CAP_TOTAL=100' "$MUT/mut-total.sh" \
  && ok "E2 变异体已生成（sed 命中 CAP_TOTAL 常量）" || no "E2 sed 未命中 CAP_TOTAL"
bash "$MUT/mut-total.sh" --root "$A" > "$LAST" 2>&1
t "E2 变异体（CAP_TOTAL=100）⇒ 1" 1 "$?"
out_has "合计口径" && ok "E2 变异体点名合计口径" || no "E2 变异体未点名合计口径"

# ── F 降级日志 / 确定性 / 不污染 ────────────────────────────────────────────
echo "── F 降级日志 / 确定性 / 不污染 ──"
tail -1 "$SYNO_GATE_DEGRADED_LOG" | "$PY" -c '
import json, sys
d = json.load(sys.stdin)
assert d.get("time"), "time missing"
assert d.get("component") == "verify-doc-budgets", "component=%r" % d.get("component")
assert d.get("code"), "code missing"
assert d.get("phase"), "phase missing"
assert d.get("retryable") is True, "retryable=%r" % d.get("retryable")
' && ok "F1 降级日志 JSON 五字段齐全（time/component/code/phase/retryable）" \
  || no "F1 降级日志字段缺失或不是合法 JSON: $(tail -1 "$SYNO_GATE_DEGRADED_LOG" 2>/dev/null)"

bash "$S" --root "$A" > "$TMPD/det1.out" 2>&1
bash "$S" --root "$A" > "$TMPD/det2.out" 2>&1
diff -q "$TMPD/det1.out" "$TMPD/det2.out" >/dev/null 2>&1 \
  && ok "F2 同一夹具连跑两次输出逐字节相同（确定性）" || no "F2 两次输出不一致（有隐藏状态）"

BEFORE="$(snap "$A")"
bash "$S" --root "$A" > /dev/null 2>&1
AFTER="$(snap "$A")"
[ "$BEFORE" = "$AFTER" ] && ok "F3 跑完夹具文件集合不变（不写入被检树）" \
  || no "F3 夹具被写入（新增/删除了文件）"
[ ! -d "$A/.codex" ] && ok "F3 未在夹具内建降级日志目录（SYNO_GATE_DEGRADED_LOG 生效）" \
  || no "F3 夹具内被建了 .codex/（降级日志逃逸）"

echo ""
echo "── 汇总: ${PASS} 通过 / ${FAIL} 失败 ──"
echo "结果: ${PASS} 通过, ${FAIL} 失败"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
