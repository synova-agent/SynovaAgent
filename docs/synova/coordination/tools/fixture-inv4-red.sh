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
# INV-4 存量棘轮（执法体按 **自身所在目录** 解析它）⇒ 副本目录必须一并复制，
# 否则副本里"存量 7 对"会当成新违规，夹具会把"环境没复制全"误报成"执法体没判别力"。
RAT_REL='docs/synova/coordination/tools/inv4-pair-declared-baseline.txt'
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
[ -f "$ROOT/$RAT_REL" ] && cp "$ROOT/$RAT_REL" "$TMP/tools/inv4-pair-declared-baseline.txt"
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
[ -f "$ROOT/$RAT_REL" ] && cp "$ROOT/$RAT_REL" "$TMP2/tools/inv4-pair-declared-baseline.txt"
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

# ══════════════════════════════════════════════════════════════════════════════
# ③ 第三态：登记件**读不到** ⇒ 必须 exit 2（不是 0、也不是 1）
#   依据判例 M-02：0=过 / 1=违规 / **2=检查自身失败（同样阻断）**。
#   为什么必须有这一段：只测 0/1 两态时，"登记件文件没了"会让执法体走 catch 分支 ——
#   若那分支写成 exit 0 或 exit 1，门禁就把"没检查"与"检查通过/违规"混成一个信号。
#   2026-10-06 实测：把执法体单独放进空目录（无登记件）⇒ exit 2 + stderr 具名。
# ══════════════════════════════════════════════════════════════════════════════
TMP3="$(mktemp -d 2>/dev/null || true)"
if [ -z "$TMP3" ] || [ ! -d "$TMP3" ]; then
  echo "  🔴 检查自身失败：第三个 mktemp -d 失败"
  exit 2
fi
mkdir -p "$TMP3/tools"
cp "$ENF" "$TMP3/tools/check-construction-registry.ts"   # 故意**不**放登记件
printf '{"type":"module"}\n' > "$TMP3/package.json"
OUT_B3="$(run_enf "$TMP3")"; RC_B3=$?
rm -rf "$TMP3"
# ⚠️ 必须同时验 exit code 与**行为特征**：只看 exit code 会把"node 起不来/模块找不到"
#    这类"恰好也是 2"的崩溃当成"三态契约正确"（fixtures-owner 2026-10-06 踩过同款假绿）。
if [ "$RC_B3" -ne 2 ]; then
  echo "  [FAIL] 登记件读不到时应 exit 2，实测 exit=${RC_B3} ⇒ 三态契约破了（把"没检查"混成了别的信号）"
  FAILED=1
elif ! printf '%s' "$OUT_B3" | grep -qF '检查自身失败'; then
  echo "  [FAIL] exit=2 但输出无「检查自身失败」具名行 ⇒ 疑似 node 自身崩溃冒充第三态（假绿通道）"
  printf '%s' "$OUT_B3" | tail -5 | sed 's/^/         /'
  FAILED=1
else
  echo "  [PASS] 第三态：登记件读不到 ⇒ exit=2 且具名「检查自身失败」"
fi

# ══════════════════════════════════════════════════════════════════════════════
# ④ 棘轮通道：**条目失效即红**（判例 M-03：棘轮台账只减不增；修好即须删除条目）
#   构造：往副本棘轮里塞一行"其实早就声明了"的对（0-2 × 2-3）⇒ 必须报 INV-4-STALE 且 exit 1。
#   为什么必须有这一段：没有它，"棘轮只减不增"就只是一句**没人执行**的话
#   （= 本卡刚修掉的那类病：宣称有牙、实际无牙）。
# ══════════════════════════════════════════════════════════════════════════════
if [ -f "$ROOT/$RAT_REL" ]; then
  TMP4="$(mktemp -d 2>/dev/null || true)"
  if [ -z "$TMP4" ] || [ ! -d "$TMP4" ]; then
    echo "  🔴 检查自身失败：第四个 mktemp -d 失败"
    exit 2
  fi
  mkdir -p "$TMP4/tools"
  cp "$REG" "$TMP4/施工项登记.ts"
  cp "$ENF" "$TMP4/tools/check-construction-registry.ts"
  cp "$ROOT/$RAT_REL" "$TMP4/tools/inv4-pair-declared-baseline.txt"
  printf '0-2\t2-3\tsrc/growth/feedback-collector.ts\n' >> "$TMP4/tools/inv4-pair-declared-baseline.txt"
  printf '{"type":"module"}\n' > "$TMP4/package.json"
  OUT_B4="$(run_enf "$TMP4")"; RC_B4=$?
  rm -rf "$TMP4"
  if [ "$RC_B4" -ne 1 ]; then
    echo "  [FAIL] 棘轮条目失效时应 exit 1，实测 exit=${RC_B4} ⇒ 「只减不增」没牙"
    FAILED=1
  else
    echo "  [PASS] 棘轮通道：失效条目 ⇒ exit=1"
  fi
  if printf '%s' "$OUT_B4" | grep -qF 'INV-4-STALE'; then
    echo "  [PASS] 棘轮通道输出含具名：'INV-4-STALE'"
  else
    echo "  [FAIL] 棘轮通道输出缺 'INV-4-STALE'（报不出具名 ⇒ 等于要人读日志）"
    FAILED=1
  fi
else
  echo "  ℹ️  无棘轮文件（$RAT_REL）⇒ 跳过通道④（不静默当通过，已显式说明）"
fi

# ══════════════════════════════════════════════════════════════════════════════
# ⑤ **真相源不可用** ⇒ 必须 exit 2，**不得假报违规**
#   来源：K3 审计 P1（2026-10-06，我复现）：旧实装在非 git 目录里跑出
#     `exit=1` + `合计 12 处违规`（含 INV-3③ 4 处）—— 把【无法检查】报成了【你违规了】。
#   这一段是那次的**回归锁**：只要有人把 preflight 去掉，本场景立刻红。
# ══════════════════════════════════════════════════════════════════════════════
TMP5="$(mktemp -d 2>/dev/null || true)"
if [ -z "$TMP5" ] || [ ! -d "$TMP5" ]; then
  echo "  🔴 检查自身失败：第五个 mktemp -d 失败"
  exit 2
fi
mkdir -p "$TMP5/tools"
# 故意只放件、**不放 .git**（mktemp -d 不在任何仓内）⇒ 模拟"真相源不可用"
cp "$REG" "$TMP5/施工项登记.ts"
cp "$ENF" "$TMP5/tools/check-construction-registry.ts"
printf '{"type":"module"}\n' > "$TMP5/package.json"
if git -C "$TMP5" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "  🔴 检查自身失败：临时目录竟在某个 git 仓内 ⇒ 本场景无法构造（换 TMPDIR）"
  rm -rf "$TMP5"
  exit 2
fi
OUT_B5="$(cd "$TMP5" && node --experimental-strip-types tools/check-construction-registry.ts 2>&1)"; RC_B5=$?
rm -rf "$TMP5"
if [ "$RC_B5" -ne 2 ]; then
  echo "  [FAIL] 真相源不可用时应 exit 2，实测 exit=${RC_B5}（旧缺陷即在此：假报违规 exit 1）"
  FAILED=1
elif printf '%s' "$OUT_B5" | grep -qE '合计 [0-9]+ 处违规'; then
  # ⚠️ 只用「合计 N 处违规」这一行作针。**不要**用 `INV-3③` 当针 ——
  #    执法体自己的报错文案里就写着 `INV-3③`（解释它靠什么判），会命中 = 假通过通道。
  #    （实测踩到：加 `|INV-3③` 后本场景误报 FAIL。）
  echo "  [FAIL] exit=2 但仍输出违规行 ⇒ 仍然在把【无法检查】报成【违规】"
  printf '%s' "$OUT_B5" | tail -6 | sed 's/^/         /'
  FAILED=1
else
  echo "  [PASS] 真相源不可用：exit=2 且**零假违规**"
fi
if printf '%s' "$OUT_B5" | grep -qF '真相源不可用'; then
  echo "  [PASS] 输出含具名原因：'真相源不可用'"
else
  echo "  [FAIL] 输出缺具名原因「真相源不可用」（报不出原因 ⇒ 等于要人读栈）"
  FAILED=1
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "  ══ 夹具有效：破坏 ⇒ 红且具名（INV-4 / INV-5 / 棘轮失效）；读不到 ⇒ exit 2；真相源不可用 ⇒ exit 2；复原 ⇒ 绿 ══"
  exit 0
fi
echo "  ══ 夹具失效：执法体没有判别力 ══"
exit 1
