#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-bypass-log.test.sh — D414/U1c bypass 证据链对账门禁测试 + D1152 跨机证据链
#
# 覆盖矩阵（铁律 48 三路径 + 接线 + 两头锁死）:
#   正常 — ① fresh clone（真 git clone；本地账本来源天然全空）→ exit 0（D1152/② 空集⇒0）
#          ② 他机已过闸提交（已在 origin/<当前分支>）→ 不再要求本机补记 → exit 0（D1152/①）
#   边界 — ③ 本机新提交无记录（来源全空）→ exit 1（**对账强度不降，不许放宽**）
#          ④ 本机新提交无记录（账本在但无该 HASH）→ exit 1 + 点名缺失 + 他机提交不误列
#          ⑤ 首次推送（origin/<当前分支> 不存在）⇒ 不过滤 ⇒ 无记录必拦（fail-closed，不免检）
#          ⑥ 同一提交补记后 → exit 0（正常路径）
#          ⑦ D451 纯补记提交（只改 .claude/bypass.log）→ 豁免；同提交夹带其他文件 → 不豁免
#          ⑧ 显式 SYNO_BASE_REF 不可解析 → exit 1；缺 base 且无 origin → exit 2
#   降级 — ⑨ git log 执行失败 → exit 2（fail-closed，不当作通过；**接线断言**，故障注入难复现）
#   接线 — ⑩ D513 防御 fetch / D1152 祖先过滤 / merge-base 收窄 代码在位（铁律 0-2）
#   剥离 — ⑪ D508 merge-base 收窄后「merge main 不制造补记噪音」+ 宿主 index 零污染
#
# 隔离（D1152 重写）: 全部用例在 mktemp 沙箱（bare 远端 + A 机工作区 + **真 clone 出的 B 机**）；
#   **不读不写真实仓的 .claude/bypass.log**（旧版在真仓搬移该文件 → 与并发 git/hook 竞态，
#   且真仓自身提交状态会让断言非确定）。沙箱一律显式剥 GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE
#   （M13/D521/D554: hook 上下文会导出它们）+ 关掉 hook（不受开发者本机全局配置影响）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/check-bypass-log.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/d1152-bypass.XXXXXX")"
trap 'rm -rf "$TMPD"' EXIT
mkdir -p "$TMPD/empty-hooks"

# 沙箱 git 归一: 身份 + 禁 hook（hermetic: 不受本机全局 core.hooksPath / 模板目录影响）
sb_git() {  # <dir>
  git -C "$1" config user.name t
  git -C "$1" config user.email t@t
  git -C "$1" config core.hooksPath "$TMPD/empty-hooks"
}
# 在 <dir> 内以 <base> 跑被测门禁（cwd = <dir> ⇒ 门禁的 ROOT/来源解析都落在沙箱）
gate_in() { local d="$1"; shift; (cd "$d" && bash "$GATE" "$@" 2>&1); }
# 「应当是提交」的动作: 断言 rc=0 + HEAD 前进（夹具自身失败 ⇒ 报夹具，不指控被测门禁）
sb_commit() {  # <dir> <描述> <提交信息>  ⇒ git add -A + commit
  local d="$1" desc="$2" msg="$3"
  local before after rc
  before="$(git -C "$d" rev-parse HEAD 2>/dev/null || echo none)"  # swallow-ok: 夹具基线（失败即 none）
  git -C "$d" add -A >/dev/null 2>&1; rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ❌ fixture: commit did not happen (rc=$rc) — ${desc} [stage=add]"
    echo "     判据: 夹具自身失败（不是门禁缺陷）；后续断言不具可解释性 ⇒ 中止（exit 3）"
    exit 3
  fi
  git -C "$d" commit -q -m "$msg" >/dev/null 2>&1; rc=$?
  after="$(git -C "$d" rev-parse HEAD 2>/dev/null || echo none)"  # swallow-ok: 夹具复核（失败即 none ⇒ 判定异常）
  if [ "$rc" -ne 0 ] || [ "$before" = "$after" ]; then
    echo "  ❌ fixture: commit did not happen (rc=$rc) — ${desc} [stage=commit]"
    echo "     判据: 夹具自身失败（不是门禁缺陷）；后续断言不具可解释性 ⇒ 中止（exit 3）"
    exit 3
  fi
}
# 夹具提交（沙箱内 g() 绑定）: 同上 fail-fast，不产生指控型假红
sb_gcommit() {  # <描述> <提交信息>（需先在 case 内定义 g()）
  local desc="$1" msg="$2" before after rc
  before="$(g rev-parse HEAD 2>/dev/null || echo none)"  # swallow-ok: 夹具基线（失败即 none）
  g commit -qm "$msg" >/dev/null 2>&1; rc=$?
  after="$(g rev-parse HEAD 2>/dev/null || echo none)"   # swallow-ok: 夹具复核（失败即 none ⇒ 判定异常）
  if [ "$rc" -ne 0 ] || [ "$before" = "$after" ]; then
    echo "  ❌ fixture: commit did not happen (rc=$rc) — ${desc}"
    echo "     判据: 夹具自身失败（不是门禁缺陷）；后续断言不具可解释性 ⇒ 中止（exit 3）"
    exit 3
  fi
}

echo "=== D414/U1c + D1152 check-bypass-log 对账门禁测试 ==="

# ═══════════ 接线（铁律 0-2 WIRE CHECK）═══════════
grep -q "git log 执行失败" "$GATE" && grep -q "GIT_LOG_OUT" "$GATE" \
  && ok "接线: git log 失败 fail-closed exit 2 已接入" || no "接线: git log 失败检测代码缺失"
grep -q "防御性刷新 base" "$GATE" && ok "接线/D513: 防御性 fetch 在位" || no "接线/D513: 防御 fetch 缺失"
grep -q "merge-base --is-ancestor" "$GATE" && ok "接线/D1152①: 祖先过滤（他机已过闸）在位" \
  || no "接线/D1152①: 祖先过滤缺失"

# ═══════════ 夹具: bare 远端 + A 机 + B 机（真 clone）═══════════
#   语义: A 机把 feat/x 推到 origin ⇒ B 机 clone 后在该分支上再提交 ⇒ B 机只为本机新提交负责。
#   seed 提交里带上账本解析器（生产形状：clone 内有 scripts/control-tower/bypass-ledger.sh）。
ORIGIN="$TMPD/origin.git"; A="$TMPD/machine-a"; B="$TMPD/machine-b"
mkdir -p "$A/scripts/control-tower"
if ! git init -q --bare -b main "$ORIGIN" 2>/dev/null; then  # swallow-ok: 失败即沙箱不可用，下一行显式报夹具自身失败
  echo "  ❌ fixture: 沙箱 bare 远端不可用（夹具自身失败，非被测缺陷）"
  echo ""; echo "结果: $PASS 通过, $FAIL 失败"; exit 3
fi
if ! git init -q -b main "$A" 2>/dev/null; then  # swallow-ok: 同上（显式报夹具失败）
  echo "  ❌ fixture: 沙箱 git init 不可用（夹具自身失败，非被测缺陷）"
  echo ""; echo "结果: $PASS 通过, $FAIL 失败"; exit 3
fi
sb_git "$A"
cp "$REPO/scripts/control-tower/bypass-ledger.sh" "$A/scripts/control-tower/bypass-ledger.sh"
echo seed > "$A/seed.txt"
sb_commit "$A" "seed 提交" "seed"
git -C "$A" remote add origin "$ORIGIN"
git -C "$A" push -q origin main
git -C "$A" checkout -q -b feat/x
echo a1 > "$A/a1.txt"
sb_commit "$A" "A 机 feat 提交" "feat: A 机提交（A 机过闸）"
A_HASH="$(git -C "$A" rev-parse HEAD)"
git -C "$A" push -q origin feat/x
git clone -q "$ORIGIN" "$B" 2>/dev/null || { echo "  ❌ fixture: 沙箱 clone 失败（夹具自身失败）"; echo ""; echo "结果: $PASS 通过, $FAIL 失败"; exit 3; }
sb_git "$B"

# ── 用例①（D1152/② 正常）: fresh clone 且无本机新提交 → exit 0 ──
#   判据来源 = 复核席实测的假红: 新 clone 里 .claude/bypass.log 天然不存在 ⇒ 旧语义 exit 1。
[ ! -e "$B/.claude/bypass.log" ] && [ ! -e "$B/.sessions" ] \
  && ok "夹具前提: fresh clone 本地账本来源天然全空（.claude/bypass.log / .sessions 均无）" \
  || no "夹具前提失败: fresh clone 竟有本地账本来源（用例判别性丢失）"
OUT1="$(gate_in "$B" origin/main)"; RC1=$?
if [ "$RC1" -eq 0 ]; then
  ok "fresh clone（来源全空 + 无待记录提交）→ exit 0（D1152/② 空集⇒0）"
else
  no "fresh clone 应 exit 0, 实际 ${RC1}（#1075 阻塞根因未修）"; printf '%s\n' "$OUT1" | sed 's/^/     | /'
fi

# ── 用例②（D1152/① 正常）: B 机拉 A 机分支（提交已在 origin）→ 不要求补记 → exit 0 ──
git -C "$B" fetch -q origin feat/x
git -C "$B" checkout -q -b feat/x origin/feat/x
OUT2="$(gate_in "$B" origin/main)"; RC2=$?
if [ "$RC2" -eq 0 ]; then
  ok "他机已过闸提交（${A_HASH:0:8} 已是 origin/feat/x 祖先）不再要求本机补记 → exit 0"
else
  no "他机已过闸提交被重复要求 → exit ${RC2}（跨机永久误拦未修）"; printf '%s\n' "$OUT2" | sed 's/^/     | /'
fi

# ── 用例③（边界，**不许放宽**）: B 机本机新提交 + 来源全空 → exit 1 ──
echo b1 > "$B/b1.txt"
sb_commit "$B" "B 机新提交" "feat: B 机新提交（无记录）"
B1_HASH="$(git -C "$B" rev-parse HEAD)"
OUT3="$(gate_in "$B" origin/main)"; RC3=$?
if [ "$RC3" -eq 1 ]; then
  ok "本机新提交无记录 + 来源全空 → exit 1（D1145 fail-closed 保留，未放宽）"
else
  no "本机新提交无记录应 exit 1, 实际 ${RC3}（对账被放宽 ⇒ 假绿）"; printf '%s\n' "$OUT3" | sed 's/^/     | /'
fi
echo "$OUT3" | grep -q "全部来源均为空" && ok "输出点名「全部来源均为空」（不静默）" || no "输出未点名来源全空"

# ── 用例④（边界）: 账本在但无该 HASH → exit 1 + 点名缺失 + 他机提交不误列 ──
mkdir -p "$B/.claude"; : > "$B/.claude/bypass.log"
OUT4="$(gate_in "$B" origin/main)"; RC4=$?
[ "$RC4" -eq 1 ] && ok "账本存在但缺本机提交记录 → exit 1" || no "应 exit 1, 实际 $RC4"
echo "$OUT4" | grep -q "${B1_HASH:0:8}" && ok "缺失提交被点名（${B1_HASH:0:8}）" || no "缺失提交未被点名"
echo "$OUT4" | grep -q "${A_HASH:0:8}" && no "他机已过闸提交被误列为缺失（D1152① 失效）" \
  || ok "他机已过闸提交未出现在缺失清单（范围收窄生效）"

# ── 用例⑤（边界，fail-closed）: origin/<当前分支> 不存在（首次推送）⇒ 不过滤 ⇒ 必拦 ──
git -C "$B" checkout -q -b feat/first-push origin/main
echo f1 > "$B/f1.txt"
sb_commit "$B" "首次推送分支上的提交" "feat: 首次推送分支（无记录）"
F1_HASH="$(git -C "$B" rev-parse HEAD)"
OUT5="$(gate_in "$B" origin/main)"; RC5=$?
[ "$RC5" -eq 1 ] && ok "origin/feat/first-push 不存在 ⇒ 不过滤 ⇒ 无记录必拦 exit 1（首次推送不免检）" \
  || no "首次推送分支被免检 → exit ${RC5}（假绿路径）"
echo "$OUT5" | grep -q "不可解析" && ok "输出显式说明 ref 不可解析（跳过优化而非静默放行）" \
  || no "输出未显式说明 ref 不可解析"

# ── 用例⑥（正常路径）: 补记本机提交 → exit 0 ──
echo "$(date -Iseconds) | COMMITTED | pre-commit PASS | TASK_ID=test | AGENT=t | HASH=$F1_HASH" >> "$B/.claude/bypass.log"
OUT6="$(gate_in "$B" origin/main)"; RC6=$?
[ "$RC6" -eq 0 ] && ok "本机提交补记后 → exit 0（正常路径）" || no "补记后应 exit 0, 实际 $RC6"

# ── 用例⑦（D451 纯补记豁免）: 只改 .claude/bypass.log 的提交豁免；夹带其他文件则不豁免 ──
D451="$TMPD/d451"
git init -q -b main "$D451" >/dev/null 2>&1 || true
sb_git "$D451"
mkdir -p "$D451/.claude"; echo seed > "$D451/.claude/bypass.log"; echo s > "$D451/seed.txt"
sb_commit "$D451" "D451 夹具 seed" "seed"
git -C "$D451" update-ref refs/remotes/origin/main HEAD
echo "pure-entry" >> "$D451/.claude/bypass.log"
sb_commit "$D451" "D451 纯补记提交" "chore: 纯补记（只改 bypass.log）"
OUT7="$(gate_in "$D451" origin/main)"; RC7=$?
[ "$RC7" -eq 0 ] && ok "D451: 纯补记提交豁免（不要求「自己被自己记录」）" \
  || no "D451: 纯补记提交被要求补记 → exit $RC7"
echo "mixed" >> "$D451/.claude/bypass.log"; echo m > "$D451/mixed.txt"
sb_commit "$D451" "D451 夹带提交" "chore: 夹带其他文件的提交"
OUT7b="$(gate_in "$D451" origin/main)"; RC7b=$?
[ "$RC7b" -eq 1 ] && ok "D451: 同提交夹带其他文件 → 不豁免 → exit 1（豁免面未扩大）" \
  || no "D451: 夹带提交被误豁免 → exit $RC7b"

# ── 用例⑧（边界）: 显式 base 不可解析 → exit 1；缺 base 且无 origin → exit 2 ──
NB="$TMPD/no-remote"
git init -q -b main "$NB" >/dev/null 2>&1 || true
sb_git "$NB"
OUT8="$(cd "$NB" && SYNO_BASE_REF="nonexistent-ref-xyz" bash "$GATE" 2>&1)"; RC8=$?
[ "$RC8" -eq 1 ] && ok "显式 SYNO_BASE_REF 不可解析 → exit 1（硬错误，不静默）" || no "显式不可解析 base 应 exit 1, 实际 $RC8"
mkdir -p "$NB/.claude"; : > "$NB/.claude/bypass.log"
OUT8b="$(gate_in "$NB")"; RC8b=$?
[ "$RC8b" -eq 2 ] && ok "缺 base 且无 origin → exit 2（fail-closed，不当作通过）" || no "缺 base 应 exit 2, 实际 $RC8b"
echo "$OUT8b" | grep -q "对账无法执行" && ok "输出显式提示「对账无法执行」（不静默）" || no "缺 base 未显式提示"

# ── 用例⑨（D508 merge-base 收窄 + 宿主 index 零污染）──
#   沙箱加固（事故教训: 2026-08-23 三次 index 污染）: 沙箱 git 一律 GIT_DIR/GIT_WORK_TREE
#   显式绑定（结构性隔离，与 cwd 无关），并断言宿主 index 前后不变。
case_d508() {
  local SB HOST_BEFORE HOST_AFTER TASK_HASH
  SB="$(mktemp -d "${TMPDIR:-/tmp}/d508-mb.XXXXXX")"
  HOST_BEFORE=$(git -C "$REPO" write-tree 2>/dev/null || echo na)  # swallow-ok: 宿主基线（失败即 na=na 恒等）
  g() { GIT_DIR="$SB/.git" GIT_WORK_TREE="$SB" git "$@"; }
  git -C "$SB" init -q || { no "D508 夹具: 沙箱 init 失败"; rm -rf "$SB"; return 1; }
  g config user.name t; g config user.email t@t
  g config core.hooksPath "$TMPD/empty-hooks"
  mkdir -p "$SB/.claude"; : > "$SB/.claude/bypass.log"
  echo a > "$SB/a"; g add -A; sb_gcommit "D508 夹具 seed" "base"
  g branch -m main
  echo m1 > "$SB/m1"; g add -A; sb_gcommit "D508 夹具 main 侧提交" "main-side"
  g checkout -q -b feat/x HEAD~1
  echo b > "$SB/b"; g add -A; sb_gcommit "D508 夹具 feat 提交" "feat-task"
  TASK_HASH=$(g rev-parse HEAD)
  echo "$(date -Iseconds) | COMMITTED | pre-commit PASS | TASK_ID=X | AGENT=t | HASH=$TASK_HASH" >> "$SB/.claude/bypass.log"
  g merge -q main -m merge-main 2>/dev/null || true  # swallow-ok: 沙箱夹具（无冲突）
  if (cd "$SB" && SYNO_BASE_REF=main bash "$GATE" >/dev/null 2>&1); then
    ok "D508: merge main 后 main 侧提交不再要求补记（补记噪音消除）"
  else
    no "D508: merge 后对账仍失败"; rm -rf "$SB"; return 1
  fi
  echo c > "$SB/c"; g add -A; sb_gcommit "D508 夹具无记录提交" "unrecorded"
  if (cd "$SB" && SYNO_BASE_REF=main bash "$GATE" >/dev/null 2>&1); then
    no "D508: 无记录提交漏拦！"; rm -rf "$SB"; return 1
  else
    ok "D508: 无记录新提交仍被拦（对账强度不降）"
  fi
  HOST_AFTER=$(git -C "$REPO" write-tree 2>/dev/null || echo na)  # swallow-ok: 宿主复核（同上）
  if [ "$HOST_BEFORE" = "$HOST_AFTER" ]; then
    ok "D508: 宿主 index 未被沙箱污染"
  else
    no "D508: 宿主 index 被改写！"; rm -rf "$SB"; return 1
  fi
  rm -rf "$SB"
}
case_d508

# ═══════════════════════════════════════════════════════════════
# D1157（P0 假绿根修 — 提案待裁）: 记录判定必须锚到「COMMITTED 记录行的 HASH= 字段」
#   实测行格式（对 140 份真实账本语料 / 118,077 行 / 2501 条 distinct 行普查，见 brief §格式普查）:
#     记录行  : <ts> | COMMITTED | <描述> | … | HASH=<sha>   ← 2002 条 distinct，**全部**以时间戳开头
#               · HASH 值**可为短 sha** —— 实测 10 条为 8 位（如 HASH=c30335e2）
#               · 另有 1 条**空格分隔、无 `|`** 的记录行（2026-08-25T14:12:40Z COMMITTED …）
#               · 实测 1 条"两条记录挤同一行"⇒ 无界抽取会把后随时间戳的 `2026` 吃进来（44 位过捕）
#     非记录行: <ts> detected-bypass head-mismatch marker=<sha> parent=<sha>   ← P0 假绿来源
#     散文行  : <ts> | LEDGER-RETRACT | … 提了"COMMITTED 记录"字样 ← 锚行首排除之（改坏即绿）
#   本组夹具（判别性: 改坏 ⇒ ①②⑤ 必红；过紧 ⇒ ③④⑥ 必红）:
#     ① 只有 parent=<sha>（该 sha 无自身记录）⇒ 不算记录 ⇒ **必 exit 1**（改前: 假绿 exit 0）
#     ② 只有 marker=<sha>                    ⇒ 同上
#     ③ 负对照: HASH=<8 位短 sha> 的记录行   ⇒ **仍算记录** ⇒ exit 0（防"过紧"误红）
#     ④ 负对照: 空格分隔（无 `|`）的记录行   ⇒ **仍算记录** ⇒ exit 0
#     ⑤ 反例: 散文行含 `COMMITTED` + `HASH=<该 sha>`（非记录行）⇒ **不算记录** ⇒ exit 1
#     ⑥ 负对照: 两条记录挤同一行（40 位在前）⇒ 前一条**仍算记录** ⇒ exit 0（防过捕漏认）
# ═══════════════════════════════════════════════════════════════
P0="$TMPD/d1157-p0"
git init -q -b main "$P0" >/dev/null 2>&1 || no "D1157 夹具自身失败: 沙箱 init 不可用"
sb_git "$P0"
echo s > "$P0/seed.txt"; sb_commit "$P0" "D1157 夹具 seed" "seed"
git -C "$P0" update-ref refs/remotes/origin/main HEAD
git -C "$P0" checkout -q -b feat/p0
echo c > "$P0/c.txt"; sb_commit "$P0" "D1157 夹具待记录提交" "feat: 待记录提交（无自身记录）"
P0_SHA="$(git -C "$P0" rev-parse HEAD)"; P0_SHA8="${P0_SHA:0:8}"
ZERO40="0000000000000000000000000000000000000000"
P0_LEDGER="$P0/.claude/bypass.log"; mkdir -p "$P0/.claude"
echo "  夹具: 待记录提交 ${P0_SHA8}（origin/feat/p0 不存在 ⇒ D1152 过滤关闭 ⇒ 必进待记录集）"

# ① 只有 parent=<sha> → 不算记录
printf '%s\n' "2026-10-05T00:00:00Z detected-bypass head-mismatch marker=$ZERO40 parent=$P0_SHA" > "$P0_LEDGER"
OUTP1="$(gate_in "$P0" origin/main)"; RCP1=$?
[ "$RCP1" -eq 1 ] && ok "D1157① 仅 parent=<sha> 出现 ⇒ 不算记录 ⇒ exit 1（P0 假绿已堵）" \
  || no "D1157① **假绿仍在**: 账本只有 parent=${P0_SHA8}、无该提交自身记录，门禁却 exit ${RCP1}（应为 1）"

# ② 只有 marker=<sha> → 不算记录
printf '%s\n' "2026-10-05T00:00:00Z detected-bypass head-mismatch marker=$P0_SHA parent=$ZERO40" > "$P0_LEDGER"
OUTP2="$(gate_in "$P0" origin/main)"; RCP2=$?
[ "$RCP2" -eq 1 ] && ok "D1157② 仅 marker=<sha> 出现 ⇒ 不算记录 ⇒ exit 1" \
  || no "D1157② **假绿仍在**: 账本只有 marker=${P0_SHA8}，门禁却 exit ${RCP2}（应为 1）"

# ③ 负对照: 短 sha 记录仍须被认（实测历史 10 条 8 位 HASH）
printf '%s\n' "2026-10-05T00:00:00Z | COMMITTED | pre-commit PASS（D451 补记） | TASK_ID=D1157 | AGENT=t | HASH=$P0_SHA8" > "$P0_LEDGER"
OUTP3="$(gate_in "$P0" origin/main)"; RCP3=$?
[ "$RCP3" -eq 0 ] && ok "D1157③ 负对照: HASH=<8 位短 sha> 记录 ⇒ 仍算记录 ⇒ exit 0（未过紧）" \
  || no "D1157③ 过紧误红: 短 sha 记录未被认（exit ${RCP3}，应为 0）"

# ④ 负对照: 空格分隔（无 `|`）的记录行仍须被认（实测历史 1 条）
printf '%s\n' "2026-08-25T14:12:40Z COMMITTED pre-commit PASS（D451 补记） TASK_ID=D530 AGENT=dsh-cto HASH=$P0_SHA" > "$P0_LEDGER"
OUTP4="$(gate_in "$P0" origin/main)"; RCP4=$?
[ "$RCP4" -eq 0 ] && ok "D1157④ 负对照: 无 \`|\` 空格分隔记录行 ⇒ 仍算记录 ⇒ exit 0" \
  || no "D1157④ 过紧误红: 空格分隔记录行未被认（exit ${RCP4}，应为 0）"

# ⑤ 反例: 散文行（LEDGER-RETRACT 形状）提了 COMMITTED 且带 HASH=<该 sha>
#    ⇒ 只按"含 COMMITTED 子串"宽松抽取的实现会把它当记录（假绿回归）⇒ 本夹具改坏即红
printf '%s\n' "2026-10-05T03:22:06+08:00 | LEDGER-RETRACT | 撤销 1 条 COMMITTED 记录（误报，涉及 OID 不在推送分支）HASH=$P0_SHA | USER=t" > "$P0_LEDGER"
OUTP5="$(gate_in "$P0" origin/main)"; RCP5=$?
[ "$RCP5" -eq 1 ] && ok "D1157⑤ 散文行提及 COMMITTED+HASH= ⇒ 不算记录 ⇒ exit 1（锚行首生效）" \
  || no "D1157⑤ **假绿回归**: 散文行（非记录行）被当成记录，门禁 exit ${RCP5}（应为 1）"

# ⑥ 负对照: 两条记录挤同一行（第一字段 40 位），无界抽取会把后随时间戳吃进来 ⇒ 前一条漏认
P0_OTHER="$(git -C "$P0" rev-parse HEAD~1)"  # seed 提交（另一条 OID，仅用于凑出"挤行"形状）
# 两条记录行**真正挤成一行**（去掉换行 = 历史实测形状），验第一字段仍被认
printf '%s' "2026-08-23T12:40:00+00:00 | COMMITTED | pre-commit PASS (merge 补记) | TASK_ID=D506 | AGENT=t | HASH=$P0_SHA" > "$P0_LEDGER"
printf '%s\n' "2026-08-23T21:40:00+08:00 | COMMITTED | pre-commit PASS (合并引入补记) | TASK_ID=CT | AGENT=t | HASH=$P0_OTHER" >> "$P0_LEDGER.tmp"
tr -d '\n' < "$P0_LEDGER.tmp" >> "$P0_LEDGER"; rm -f "$P0_LEDGER.tmp"
OUTP6="$(gate_in "$P0" origin/main)"; RCP6=$?
[ "$RCP6" -eq 0 ] && ok "D1157⑥ 负对照: 两记录挤一行时前一条仍被认 ⇒ exit 0（HASH 长度有界，未过捕）" \
  || no "D1157⑥ 过捕漏认: 挤行场景下前一条记录未被认（exit ${RCP6}，应为 0）"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
