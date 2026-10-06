#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-deps-injection.test.sh — D925 检查器夹具（三路径 + 变异体判别 + 两模式）
#
# 契约:
#   @input   — 无（密封：mktemp -d 沙箱，零网络；沙箱内自建 git 仓供 diff 模式）
#   @output  — 逐条 PASS/FAIL + 末行 "D925-FIXTURE: PASS(n)/TOTAL(m)"
#   @exit    — 0 = 全部断言通过；1 = 有断言失败
#   @degraded— 无（夹具自身不降级；被测检查器的降级路径在用例 4/5/6 断言）
#
# 覆盖矩阵（对应队长裁定 3 的逐条要求）:
#   1  正常路径     — 合规模块（含 setXxxDeps 缝）→ exit 0 且**零 ::warning**
#   2  反例 R1      — 入口直连活单例无缝 → report 仍 exit 0 但**必须打印 ::warning**（裁定 3c）
#   2b 反例 +strict — 同一反例 → **exit 1**
#   3  反例 R2      — 注入缝签名缺 `| null` → 命中
#   4  降级         — 扫描器不可用 → **exit 2** + stderr 显式 degraded
#   5  降级         — --dir 无 src/ → exit 2；--base/--head 坏 ref → exit 2
#   6  降级         — 显式 --baseline 不存在 → exit 2
#   7  豁免 fail-closed — exempt 文件**缺失** → 0 条豁免（违规仍报）
#   8  豁免 fail-closed — exempt 行**无理由** → 不生效（违规仍报）
#   9  豁免生效        — exempt 行**带理由** → 违规被吸收（exit 0 且零 warning）
#  10  变异体判别①    — 改坏 R1 主判据 → 同一反例**必须漏判**（证明红样只由真判据捕获）
#  11  变异体判别②    — 改坏 exempt 理由校验 → 无理由豁免**被错误吸收**（证明理由校验承重）
#  12  diff 模式      — 只判 base..head 的新增/改动文件（未改动的存量违规**不报**）
#  13  自我豁免       — 检查器源码副本放进 src/ → **0 命中**（防自吞）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHECKER="$REPO_ROOT/scripts/control-tower/check-deps-injection.sh"

PASS=0; FAIL=0; TOTAL=0
check() { # <描述> <期望> <实际>
  local desc="$1" want="$2" got="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$want" = "$got" ]; then echo "  PASS  $desc (=$got)"; PASS=$((PASS + 1))
  else echo "  FAIL  $desc: 期望 $want 实际 $got"; FAIL=$((FAIL + 1)); fi
}
gcheck() { # <描述> <文件> <正则> <期望: yes|no>
  local desc="$1" f="$2" pat="$3" want="$4" got
  TOTAL=$((TOTAL + 1))
  if grep -qE "$pat" "$f" 2>/dev/null; then got=yes; else got=no; fi
  if [ "$want" = "$got" ]; then echo "  PASS  $desc (hit=$got)"; PASS=$((PASS + 1))
  else echo "  FAIL  $desc: 期望 $want 实际 $got"; FAIL=$((FAIL + 1)); fi
}

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
EMPTY_BASE="$SB/empty-baseline.txt"; : > "$EMPTY_BASE"

# ── 样例构造（常量拼接，避免夹具源码出现可直接被扫的字面违规形态）────────────
mk_compliant() { # <目标文件>
  cat > "$1" <<'TS'
import { getFeedbackCollector } from '../growth/feedback-collector';
export type DemoDeps = { getCollector(): { getAggregatedSignals(): unknown[] } };
let _deps: DemoDeps | null = null;
export function setDemoDeps(deps: DemoDeps | null): void { _deps = deps; }
export async function defaultDemoHandler(): Promise<void> {
  const c = _deps?.getCollector() ?? getFeedbackCollector();
  void c;
}
TS
}
mk_violating() { # <目标文件>  入口直连活单例、无注入缝
  cat > "$1" <<'TS'
import { getFeedbackCollector } from '../growth/feedback-collector';
export async function defaultDemoHandler(): Promise<void> {
  const signals = getFeedbackCollector().getAggregatedSignals();
  void signals;
}
TS
}
mk_bad_signature() { # <目标文件>  缝存在但签名非标准
  cat > "$1" <<'TS'
import { getFeedbackCollector } from '../growth/feedback-collector';
export type DemoDeps = { getCollector(): unknown };
let _deps: DemoDeps | null = null;
export function setDemoDeps(deps: DemoDeps): void { _deps = deps; }
export async function defaultDemoHandler(): Promise<void> {
  void (_deps?.getCollector() ?? getFeedbackCollector());
}
TS
}

mkdir -p "$SB/normal/src" "$SB/violate/src" "$SB/sigbad/src" "$SB/self/src" "$SB/exemptmiss/src" "$SB/exemptnoreason/src" "$SB/exemptok/src"
mk_compliant   "$SB/normal/src/mod.ts"
mk_violating   "$SB/violate/src/mod.ts"
mk_bad_signature "$SB/sigbad/src/mod.ts"
mk_violating   "$SB/exemptmiss/src/mod.ts"
mk_violating   "$SB/exemptnoreason/src/mod.ts"
mk_violating   "$SB/exemptok/src/mod.ts"
# 个案 13: 把检查器源码本体作为 .ts 放进 src/（若判据自吞，这里必命中）
cp "$CHECKER" "$SB/self/src/checker-copy.ts"

BASE_ARG="--baseline $EMPTY_BASE"   # 用空 baseline，暴露原始命中

echo "[1] 正常路径: 合规模块（含注入缝）→ 期望 exit 0 且零 ::warning"
bash "$CHECKER" --dir "$SB/normal" $BASE_ARG > "$SB/o1" 2>&1; check "合规样例 exit" 0 "$?"
gcheck "合规样例零 ::warning" "$SB/o1" '^::warning' no

echo "[2] 反例 R1: 入口直连活单例无缝 → report 仍 exit 0，但必须打印 ::warning"
bash "$CHECKER" --dir "$SB/violate" $BASE_ARG > "$SB/o2" 2>&1; check "反例 report exit" 0 "$?"
gcheck "裁定3c: 命中以 ::warning 可见" "$SB/o2" '^::warning file=src/mod\.ts,line=' yes
gcheck "命中规则为 R1" "$SB/o2" 'R1' yes
bash "$CHECKER" --dir "$SB/violate" $BASE_ARG --strict >/dev/null 2>&1; check "反例 --strict exit" 1 "$?"

echo "[3] 反例 R2: 注入缝签名缺 '| null' → 期望命中 R2"
bash "$CHECKER" --dir "$SB/sigbad" $BASE_ARG > "$SB/o3" 2>&1; check "签名偏离 exit" 1 "$(bash "$CHECKER" --dir "$SB/sigbad" $BASE_ARG --strict >/dev/null 2>&1; echo $?)"
gcheck "命中 R2" "$SB/o3" 'R2' yes

echo "[4] 降级: 扫描器不可用 → 期望 exit 2 + 显式 degraded"
SYNO_DEPS_GREP="$SB/no-such-grep" bash "$CHECKER" --dir "$SB/normal" $BASE_ARG > "$SB/o4" 2> "$SB/e4"
check "扫描器不可用 exit" 2 "$?"
gcheck "stderr 显式 degraded" "$SB/e4" 'degraded: ' yes
gcheck "降级码 DEPS_SCAN_UNAVAILABLE" "$SB/e4" 'DEPS_SCAN_UNAVAILABLE' yes

echo "[5] 降级: --dir 无 src/ 与坏 ref → 期望 exit 2"
mkdir -p "$SB/nosrc"
bash "$CHECKER" --dir "$SB/nosrc" $BASE_ARG >/dev/null 2> "$SB/e5a"; check "--dir 无 src/ exit" 2 "$?"
bash "$CHECKER" --dir "$REPO_ROOT" --base no-such-ref --head HEAD $BASE_ARG >/dev/null 2> "$SB/e5b"; check "坏 base ref exit" 2 "$?"

echo "[6] 降级: 显式 --baseline 不存在 → 期望 exit 2（fail-closed，不当空）"
bash "$CHECKER" --dir "$SB/normal" --baseline "$SB/does-not-exist.txt" >/dev/null 2> "$SB/e6"; check "baseline 缺失 exit" 2 "$?"
gcheck "降级码 DEPS_BASELINE_UNREADABLE" "$SB/e6" 'DEPS_BASELINE_UNREADABLE' yes

echo "[7] 豁免 fail-closed: exempt 文件缺失 → 0 条豁免（违规仍报）"
bash "$CHECKER" --dir "$SB/exemptmiss" $BASE_ARG --exempt "$SB/no-such-exempt.txt" --strict >/dev/null 2>&1; check "exempt 缺失仍报违规" 1 "$?"

echo "[8] 豁免 fail-closed: exempt 行无理由 → 不生效（违规仍报）"
printf 'src/mod.ts\n' > "$SB/exempt-noreason.txt"
bash "$CHECKER" --dir "$SB/exemptnoreason" $BASE_ARG --exempt "$SB/exempt-noreason.txt" --strict >/dev/null 2>&1; check "无理由豁免不生效" 1 "$?"

echo "[9] 豁免生效: exempt 行带理由 → 违规被吸收（exit 0 且零 warning）"
printf 'src/mod.ts — 该模块为进程级不可替换资源，本就不适用注入（测试样例）\n' > "$SB/exempt-ok.txt"
bash "$CHECKER" --dir "$SB/exemptok" $BASE_ARG --exempt "$SB/exempt-ok.txt" > "$SB/o9" 2>&1
check "带理由豁免生效 exit" 0 "$?"
gcheck "带理由豁免后零 ::warning" "$SB/o9" '^::warning' no

echo "[10] 变异体判别①: 改坏 R1 主判据 → 同一反例必须漏判"
NEWER='__''NEVER_MATCHES''__'
sed "s|^SINGLETON_GETTERS_RE=.*|SINGLETON_GETTERS_RE='$NEWER'|" "$CHECKER" > "$SB/mutant-r1.sh"
bash "$SB/mutant-r1.sh" --dir "$SB/violate" $BASE_ARG --strict >/dev/null 2>&1; check "坏 R1 判据体必须漏判" 0 "$?"

echo "[11] 变异体判别②: 改坏 exempt 理由校验 → 无理由豁免被错误吸收（证明理由校验承重）"
sed "s|^      \*' — '\*) printf '%s\\\\n' \"\${ln%% — \*}\" ;;|      *) printf '%s\\\\n' \"\$ln\" ;;|" "$CHECKER" > "$SB/mutant-exempt.sh"
# 同一输入、同一参数，分别跑【真检查器】与【坏理由校验体】——两条 rc 必须相反才算判别成立
bash "$CHECKER" --dir "$SB/exemptnoreason" $BASE_ARG --exempt "$SB/exempt-noreason.txt" --strict >/dev/null 2>&1; REAL_RC=$?
bash "$SB/mutant-exempt.sh" --dir "$SB/exemptnoreason" $BASE_ARG --exempt "$SB/exempt-noreason.txt" --strict >/dev/null 2>&1; MUT_RC=$?
check "真检查器: 无理由豁免不生效(rc=1)" 1 "$REAL_RC"
check "坏理由校验体: 无理由豁免被吸收(rc=0)" 0 "$MUT_RC"

echo "[12] diff 模式: 只判 base..head 的新增/改动文件"
GR="$SB/gitrepo"; mkdir -p "$GR/src"
mk_violating "$GR/src/old.ts"          # 存量违规（base 已有）
mk_compliant "$GR/src/keep.ts"
( cd "$GR" && git init -q && git add -A \
  && git -c user.email=t@t -c user.name=t commit -q -m base ) >/dev/null 2>&1
G_BASE="$(cd "$GR" && git rev-parse HEAD)"
mk_violating "$GR/src/new.ts"          # 新增违规（head）
( cd "$GR" && git add -A && git -c user.email=t@t -c user.name=t commit -q -m head ) >/dev/null 2>&1
bash "$CHECKER" --dir "$GR" --base "$G_BASE" --head HEAD $BASE_ARG > "$SB/o12" 2>&1
check "diff 模式 exit（只报=0）" 0 "$?"
gcheck "只报新增文件 new.ts" "$SB/o12" 'new\.ts' yes
gcheck "不报未改动的存量 old.ts" "$SB/o12" 'old\.ts' no

echo "[13] 自我豁免: 检查器源码副本放进 src/ → 期望 0 命中（防自吞）"
bash "$CHECKER" --dir "$SB/self" $BASE_ARG > "$SB/o13" 2>&1; check "自扫 exit" 0 "$?"
gcheck "自扫零 ::warning" "$SB/o13" '^::warning' no

echo ""
if [ "$FAIL" -gt 0 ]; then echo "D925-FIXTURE: FAIL ($PASS/$TOTAL 通过)"; exit 1; fi
echo "D925-FIXTURE: PASS($PASS/$TOTAL)"
exit 0
