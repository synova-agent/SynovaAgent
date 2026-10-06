#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# fixture-inv4-red.sh — 执法体的「改坏即红」夹具（**判据的判据**）
#
# @why   V2 卡验收判据是「制造一次 INV-4 违规 ⇒ CI 必红」。
#        只把执法体接进 CI 不够——必须证明**执法体真的会红**，否则它只是
#        "跑起来不报错"的装饰（判例 V-08：造不出来的夹具 = 无效夹具）。
#        本脚本构造一个**必然的** INV-4 违规，并断言执法体以【具名项 + 具名违规】红。
#
# @contract（铁律 47）
#   @input  — 无参。在仓库任意目录执行；自己找 git 仓根。
#   @output — 逐条 [PASS]/[FAIL]/[INFO]；末行汇总
#   @exit   — 三态（判例 M-02）：
#              0 = 夹具有效（破坏态 exit=1 且报具名 INV-4；复原态 exit=0）
#              1 = 夹具失效（执法体不具判别力 —— 该红不红 / 不红却红）
#              2 = 检查自身失败（登记件读不到 / 注入没生效 / 依赖缺失）—— 同样阻断
#   @degraded — 不适用（无静默降级：任何取不到的值直接 exit 2）
#
# @design 为什么"生成破坏副本"而不是"提交一份坏登记件"
#   提交坏副本 ⇒ 与真登记件**双份漂移**（改一处忘另一处）。
#   本夹具每次运行时从真件**现做**一个坏副本，且**断言注入真的删掉了 2 行**
#   （删 0 行 = 登记件结构变了 = 夹具已失效 ⇒ exit 2，不许静默变绿）。
#
# @known-trap  /private/tmp/package.json 可能是坏 JSON（2026-10-06 实测：另一会话
#   残留，首行一个 `;`）⇒ 任何在 /tmp 下的裸 specifier 解析都会 ERR_INVALID_PACKAGE_CONFIG。
#   故本夹具在临时目录内**自带 package.json**（隔离上游污染）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "  🔴 检查自身失败：不在 git 仓内（git rev-parse --show-toplevel 取不到）"
  exit 2
fi

REG_REL='docs/synova/coordination/施工项登记.ts'
ENF_REL='docs/synova/coordination/tools/check-construction-registry.ts'
REG="$ROOT/$REG_REL"
ENF="$ROOT/$ENF_REL"

for f in "$REG" "$ENF"; do
  if [ ! -f "$f" ]; then
    echo "  🔴 检查自身失败：缺文件 $f"
    exit 2
  fi
done

command -v node >/dev/null 2>&1 || { echo "  🔴 检查自身失败：node 不在 PATH"; exit 2; }

TMP="$(mktemp -d 2>/dev/null || true)"
if [ -z "$TMP" ] || [ ! -d "$TMP" ]; then
  echo "  🔴 检查自身失败：mktemp -d 失败"
  exit 2
fi
cleanup() { rm -rf "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

mkdir -p "$TMP/tools"
cp "$REG" "$TMP/施工项登记.ts"
cp "$ENF" "$TMP/tools/check-construction-registry.ts"
printf '{"type":"module"}\n' > "$TMP/package.json"

FAILED=0

run_enf() {
  # $1 = 目录。stdout+stderr 合并；返回执法体 exit code
  ( cd "$1" && REG_GIT_ROOT="$ROOT" node --experimental-strip-types tools/check-construction-registry.ts 2>&1 )
}

# ── ① 复原态：真登记件必须 0 违规 / exit 0 ────────────────────────────────────
OUT_OK="$(run_enf "$TMP")"; RC_OK=$?
if [ "$RC_OK" -ne 0 ]; then
  echo "  [FAIL] 复原态应 exit 0，实测 exit=${RC_OK}（真登记件自身已违规 ⇒ 先修登记件再看本夹具）"
  echo "$OUT_OK" | tail -20 | sed 's/^/         /'
  FAILED=1
else
  echo "  [PASS] 复原态：exit=0（真登记件当前 0 违规）"
fi

# ── ② 注入：删掉 0-11 与 2-4 **两侧**共写声明（只删一侧不触发，见执法体 :220 `ids2.some`）──
BROKEN="$TMP/施工项登记.ts"
BEFORE=$(grep -c 'sharedWrite: \["\(0-11\|2-4\): src/tools/tool-registry.ts' "$BROKEN" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 计数用，grep 无命中=(0) 是**期望**语义，紧随其后有 before/after 断言兜底
BEFORE=${BEFORE:-0}
grep -v 'sharedWrite: \["2-4: src/tools/tool-registry.ts' "$BROKEN" > "$BROKEN.t1" && mv "$BROKEN.t1" "$BROKEN"
grep -v 'sharedWrite: \["0-11: src/tools/tool-registry.ts' "$BROKEN" > "$BROKEN.t2" && mv "$BROKEN.t2" "$BROKEN"
AFTER=$(grep -c 'sharedWrite: \["\(0-11\|2-4\): src/tools/tool-registry.ts' "$BROKEN" 2>/dev/null | tr -d '\n\r')  # swallow-ok: 同上（无命中=0 是期望值，非错误）
AFTER=${AFTER:-0}

if [ "$BEFORE" != "2" ] || [ "$AFTER" != "0" ]; then
  echo "  🔴 检查自身失败：注入未生效（期望删 2 行，实测 before=${BEFORE} after=${AFTER}）"
  echo "         ⇒ 登记件的 sharedWrite 写法已变，**夹具已失效**。本夹具不许静默变绿。"
  exit 2
fi
echo "  [INFO] 已注入 INV-4 违规：删去 0-11 × 2-4 对 src/tools/tool-registry.ts 的两侧共写声明（before=${BEFORE} → after=${AFTER}）"

# ── ③ 破坏态：必须 exit 1，且报**具名项 + 具名违规** ──────────────────────────
OUT_BAD="$(run_enf "$TMP")"; RC_BAD=$?
if [ "$RC_BAD" -ne 1 ]; then
  echo "  [FAIL] 破坏态应 exit 1，实测 exit=${RC_BAD} ⇒ 执法体不具判别力（改坏不红）"
  echo "$OUT_BAD" | tail -20 | sed 's/^/         /'
  FAILED=1
else
  echo "  [PASS] 破坏态：exit=1"
fi

check_contains() { # $1=needle $2=说明
  if printf '%s' "$OUT_BAD" | grep -qF -- "$1"; then
    echo "  [PASS] 破坏态输出含 $2：'$1'"
  else
    echo "  [FAIL] 破坏态输出缺 $2：'$1'（报不出具名 ⇒ 等于要人去读日志）"
    FAILED=1
  fi
}
# ⚠️ 针必须**只可能出现在违规行**——'INV-4' 这个词在表头「判据：INV-1 … / INV-4 写集 …」里也有，
#    拿它当针 = 假通过通道（实测：把 INV-4 判据改瞎后，'INV-4' 断言照样 PASS）。
#    改用违规行全文三元组：具名不变量 + 具名项 × 具名项 + 具名路径。
check_contains 'INV-4: 1 处'                        'INV-4 违规计数行'
check_contains '0-11 × 2-4 同写 src/tools/tool-registry.ts' '具名违规三元组'
check_contains '写集同路径且未声明共写'                  '违规消息正文'

# ══════════════════════════════════════════════════════════════════════════════
# ②' INV-5 场景：把 sharedWrite 引用的项 id 改成不存在的 ⇒ 必须红且具名
#    （2026-10-06 加：INV-5 此前"表头写了、实装没有"⇒ 本场景就是它有没有牙的判据）
# ══════════════════════════════════════════════════════════════════════════════
TMP2="$(mktemp -d 2>/dev/null || true)"
if [ -z "$TMP2" ] || [ ! -d "$TMP2" ]; then
  echo "  🔴 检查自身失败：第二个 mktemp -d 失败"
  exit 2
fi
mkdir -p "$TMP2/tools"
cp "$REG" "$TMP2/施工项登记.ts"
cp "$ENF" "$TMP2/tools/check-construction-registry.ts"
printf '{"type":"module"}\n' > "$TMP2/package.json"
B2="$TMP2/施工项登记.ts"
sed 's|"2-3: src/growth/feedback-collector.ts|"2-3-NOT-A-REAL-ID: src/growth/feedback-collector.ts|' "$B2" > "$B2.1" && mv "$B2.1" "$B2"
if ! grep -q '2-3-NOT-A-REAL-ID' "$B2"; then
  echo "  🔴 检查自身失败：INV-5 注入未生效（找不到 2-3 的共写声明写法）—— 夹具已失效，不许静默变绿"
  rm -rf "$TMP2"
  exit 2
fi
OUT_B2="$(run_enf "$TMP2")"; RC_B2=$?
rm -rf "$TMP2"
if [ "$RC_B2" -ne 1 ]; then
  echo "  [FAIL] INV-5 场景应 exit 1，实测 exit=${RC_B2} ⇒ INV-5 没有牙（则表头"INV-5 共写声明引用可判"是假陈述）"
  FAILED=1
else
  echo "  [PASS] INV-5 场景：exit=1"
fi
# ⚠️ 针同样不许用 'INV-5' 裸词——它在新表头「INV-5 共写声明引用可判」里也有，= 假通过通道。
for needle in 'INV-5: 1 处' '2-3-NOT-A-REAL-ID'; do
  if printf '%s' "$OUT_B2" | grep -qF -- "$needle"; then
    echo "  [PASS] INV-5 场景输出含：'$needle'"
  else
    echo "  [FAIL] INV-5 场景输出缺：'$needle'"
    FAILED=1
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "  ══ 夹具有效：破坏 ⇒ 红且具名（INV-4 与 INV-5 两场景）；复原 ⇒ 绿 ══"
  exit 0
fi
echo "  ══ 夹具失效：执法体没有判别力 ══"
exit 1
