#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gate-protection-acceptance.test.sh — P4·2.5 S1 门禁本体保护 自证脚本（12 项，只读）
#
# 设计哲学（一句）: **每一项都用一条命令的原始输出说话 —— 12 项不是"我说做好了"，
#                    而是"换台机器照跑，数字仍然一样"。**
#
# 契约（铁律 47 / dsh-code-standards）:
#   @usage   bash tests/control-tower/gate-protection-acceptance.test.sh
#   @input   .gitea/protected-files.txt ｜ scripts/control-tower/check-gate-protection.sh
#            ｜ .gitea/workflows/local-gates.yml ｜ gate-exemptions/README.md
#            ｜ memory/notes/proposed/2026-10-18-gate-protection.md
#            ｜ tests/control-tower/check-gate-protection.test.sh（均为**只读**）
#            沙箱: mktemp -d ＋ git init；注入缝 = `--root` / `--list` / `SYNO_GATE_PROTECTED_LIST`
#   @output  stdout 逐项 ①…⑫（**每项恰一行、含实测数字**）；末行固定 `结果: N 通过, M 失败`
#   @exit    0=12/12 全过 ｜ 1=有项失败（真红）｜ 2=缺基线/不可解析/沙箱不可用（检查自身失败，fail-closed）
#   @degraded stderr 一行 `degraded: <原因>` ＋ stdout `DEGRADED: <code> — <原因>`；本件**不写**
#            SYNO_GATE_DEGRADED_LOG（本件对真实仓库**只读**是硬约束；降级日志落盘归被检器）
#   @error   code ∈ {E_BASELINE_MISSING, E_BASELINE_UNPARSEABLE, E_SANDBOX_BROKEN, E_INTERNAL}
#
# 授权（explicit authority）: 调用者 = CI job `local-gates` 的 ①d 步（裁 210 要求自证进 PR）
#            ＋ 本地任意会话。**只读**：不 git add/commit/stash、不改任何仓内文件、不调 Gitea API。
#
# 复用既有约定（禁重复实现）:
#   D1 三态退出码（0 通过／1 真红／2 检查自身失败；scripts/control-tower/AGENTS.md）
#   D3 UTF-8 强制（D732；文件首两行）
#   D4 判别力自检（③–⑧ 六项沙箱反例：改坏确实红，并断言**红的原因原文**）
#   D2 形制（`degraded:`/`DEGRADED:` 行 ＋ code）；按 @degraded 说明**不落日志**
#
# 12 项（判据源：裁 210 ＋ memory/notes/proposed/2026-10-18-gate-protection.md §自证）:
#   ① 清单存在可读非空（bytes＋条数）          ② pin 独立重算一致（声明/实算前 16 位）
#   ③ 沙箱 改受保护路径无豁免 ⇒ 1              ④ 沙箱 同 diff 合规豁免（作者=approver）⇒ 0
#   ⑤ 沙箱 豁免缺理由 ⇒ 1                      ⑥ 沙箱 豁免作者非 approver ⇒ 1
#   ⑦ 沙箱 清单缺失 ⇒ 2 ／ PATTERNS 段空 ⇒ 2   ⑧ 沙箱 bootstrap（base 无清单）⇒ 0 ＋ BOOTSTRAP
#   ⑨ ①d 已接线（workflow grep）               ⑩ 检查器零平台 API 调用
#   ⑪ ①d 步块内零 origin 回退（awk 块锚；`^` 坑见该步注释）
#   ⑫ push 腿语义: 块内 pull_request/清单完整性 各 ≥1 ＋ 7 件交付件禁语扫描（排除禁止性语境行）
#
# 结构（Source map）:
#   段                 职责
#   ─────────────────  ───────────────────────────────────────────────────────────
#   S0 头部契约        本段
#   S1 前置与夹具      TMPD/trap、PYBIN 探测、REPO 定位；基线缺失/不可解析 ⇒ exit 2
#   S2 清单基线        独立 awk 提取 PATTERNS 段 ＋ python3 hashlib 重算 pin（**不 source 配对测试**）
#   S3 沙箱夹具        mk_repo（git init ＋ 固定身份 ＋ hooksPath=/nonexistent）、run_gate 注入缝
#   S4 十二项判据      ①–⑫ 逐项打印实测数字
#   S5 收口            末行 `结果: N 通过, M 失败`；12/12 才 exit 0
#
# 已知限制（做不到什么 —— 禁读成"已验过"）:
#   1. **不核平台侧**：Gitea 的 protected_file_patterns／block_admin_merge_override 是否生效，
#      本件核不到（活腿 token 403；平台字段属 S2 创始人执行）。
#   2. **不替代功能测试**：本件是验收级自证；检查器 18 项功能覆盖在 CT-40 配对测试
#      tests/control-tower/check-gate-protection.test.sh（两者独立、互不 source）。
#   3. **⑪ 块锚依赖 workflow 步名**：步名 `①d`/`①b` 改名 ⇒ awk 块变 0 行 ⇒ 本件 exit 2（fail loud，
#      不静默放过）。
#   4. **⑫ 禁语扫描是"字面＋禁止性语境排除"**：换行拆词、近义改写（如把"拦"换成"挡"）扫不到。
#   5. **沙箱依赖 git 与可写临时目录**：git 不可用或 mktemp 失败 ⇒ exit 2，不降级为"跳过"。
#   6. **不判"通过"**：本件只给自验结论；通过归 L1 收件闸 ＋ K3 独立复核。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

PASS=0
FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

# ── S1 前置：临时目录 ＋ 清理（只删本件自己 mktemp 出来的目录）─────────────────
TMPD="$(mktemp -d 2>/dev/null || mktemp -d -t syno-gp-acc)"  # swallow-ok: 首个 mktemp 方言不支持 -t 时的回退；两路都失败则脚本后续因 TMPD 空而红
cleanup() {
  case "${TMPD:-}" in
    /tmp/*|/var/folders/*) rm -rf -- "$TMPD" ;;
    *) echo "⚠️ 跳过清理（临时目录不在已知临时根下）: ${TMPD:-<空>}" >&2 ;;
  esac
}
trap cleanup EXIT

degrade_exit() { # $1=code $2=原因 ⇒ stderr degraded ＋ stdout DEGRADED ＋ exit 2
  echo "degraded: $2" >&2
  echo "DEGRADED: $1 — $2"
  echo "结论: 检查自身失败（缺基线/不可解析/沙箱不可用）⇒ exit 2"
  exit 2
}

if [ -z "${TMPD:-}" ] || [ ! -d "$TMPD" ]; then
  degrade_exit E_SANDBOX_BROKEN "临时目录创建失败（mktemp -d）"
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/check-gate-protection.sh"
MANIFEST="$REPO/.gitea/protected-files.txt"
WF="$REPO/.gitea/workflows/local-gates.yml"
PAIR="$REPO/tests/control-tower/check-gate-protection.test.sh"
NOTE="$REPO/memory/notes/proposed/2026-10-18-gate-protection.md"
EXEMPT_README="$REPO/gate-exemptions/README.md"

# Python 解释器探测（D520：禁裸 python3；探**可用性**，不只看存在性）
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then
    PYBIN="$_c"
    break
  fi
done
[ -n "$PYBIN" ] || degrade_exit E_INTERNAL "python 解释器不可用（python3/python/py 均不可执行；禁裸 python3，D520）"
command -v git >/dev/null 2>&1 || degrade_exit E_INTERNAL "git 不可执行（沙箱需要 git init/commit）"

for _f in "$GATE" "$MANIFEST" "$WF" "$PAIR" "$NOTE" "$EXEMPT_README"; do
  [ -r "$_f" ] || degrade_exit E_BASELINE_MISSING "基线文件缺失或不可读: $_f"
done

MANIFEST_BYTES="$(wc -c <"$MANIFEST" | tr -d ' ')"
[ "${MANIFEST_BYTES:-0}" -gt 0 ] || degrade_exit E_BASELINE_MISSING "清单为 0 字节: $MANIFEST"

# ── S2 清单基线：**独立**提取 PATTERNS 段并重算 pin（不调用检查器、不 source 配对测试）──
PATTERNS_TXT="$TMPD/patterns.txt"
awk '
  { line=$0; sub(/^[ \t\r]+/, "", line); sub(/[ \t\r]+$/, "", line) }
  line=="# PATTERNS-BEGIN" { insec=1; next }
  line=="# PATTERNS-END"   { insec=0; next }
  insec && line!="" && substr(line, 1, 1)!="#" { print line }
' "$MANIFEST" >"$PATTERNS_TXT" || degrade_exit E_BASELINE_UNPARSEABLE "PATTERNS 段提取失败（awk，清单不可解析）"
PATTERN_COUNT="$(wc -l <"$PATTERNS_TXT" | tr -d ' ')"
[ "${PATTERN_COUNT:-0}" -gt 0 ] || degrade_exit E_BASELINE_UNPARSEABLE \
  "PATTERNS 段 0 条（信号量 0；与检查器 E_LIST_EMPTY 同判 exit 2）"

# pin 规范串（清单头部契约第 40 行）: PATTERNS 段内非空非注释行，按文件顺序 trim，各以 \n 收尾
COMPUTED_PIN="$("$PYBIN" - "$PATTERNS_TXT" <<'PY'
import hashlib
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    lines = [line.rstrip("\n") for line in fh]
canonical = "".join(pattern + "\n" for pattern in lines)
sys.stdout.write(hashlib.sha256(canonical.encode("utf-8")).hexdigest())
PY
)" || degrade_exit E_BASELINE_UNPARSEABLE "pin 重算失败（python3 hashlib，清单不可解析）"

DECLARED_PIN="$(grep -E '^#[[:space:]]*PROTECTED-PATTERNS-SHA256[[:space:]]*=' "$MANIFEST" \
  | head -1 | sed -E 's/.*=[[:space:]]*//' | tr -d '[:space:]' | tr 'A-F' 'a-f')"

echo "=== P4·2.5 S1 门禁本体保护 自证（12 项；只读 ＋ mktemp 沙箱）==="

# ── ① 清单存在可读非空（打印 bytes 与条数）────────────────────────────────────
if [ -r "$MANIFEST" ] && [ "${MANIFEST_BYTES:-0}" -gt 0 ] && [ "${PATTERN_COUNT:-0}" -gt 0 ]; then
  ok "① 清单存在可读非空 → bytes=${MANIFEST_BYTES}, 条数=${PATTERN_COUNT}"
else
  no "① 清单存在可读非空 → bytes=${MANIFEST_BYTES:-?}, 条数=${PATTERN_COUNT:-?}（应均 >0）"
fi

# ── ② pin 与清单一致（独立重算；打印声明/实算各前 16 位）──────────────────────
if ! printf '%s' "$DECLARED_PIN" | grep -qE '^[0-9a-f]{64}$'; then
  no "② pin 与清单一致 → 声明缺失/非法（声明='${DECLARED_PIN:-<空>}'；检查器同判 exit 1）"
elif [ "$DECLARED_PIN" = "$COMPUTED_PIN" ]; then
  ok "② pin 与清单一致 → 声明=${DECLARED_PIN:0:16}… 实算=${COMPUTED_PIN:0:16}…（独立重算）"
else
  no "② pin 漂移 → 声明=${DECLARED_PIN:0:16}… 实算=${COMPUTED_PIN:0:16}…（改 PATTERNS 未同步 pin）"
fi

# ── S3 沙箱夹具 ───────────────────────────────────────────────────────────────
mk_repo() { # $1=目录 ⇒ 0=成功 1=失败；git init ＋ 固定身份（禁受宿主 config/hooks 影响）
  local _d="$1"
  mkdir -p "$_d/.gitea" "$_d/gate-exemptions" "$_d/scripts" || return 1
  (
    cd "$_d" || exit 1
    git init -q || exit 1
    git config user.email k12@local || exit 1
    git config user.name k12-squad || exit 1
    git config commit.gpgsign false || exit 1
    git config core.hooksPath /nonexistent-hooks-dir || exit 1
  ) || return 1
  return 0
}

run_gate() { # $1=root，余为额外参数 ⇒ 全局 OUT / ERR / RC（降级日志导到 TMPD，不碰仓内）
  local _root="$1"
  shift
  OUT="$(SYNO_GATE_DEGRADED_LOG="$TMPD/degraded-events.log" \
    bash "$GATE" --root "$_root" "$@" 2>"$TMPD/stderr.txt")"
  RC=$?
  ERR="$(cat "$TMPD/stderr.txt" 2>/dev/null)"  # swallow-ok: 读临时 stderr 失败⇒ERR 空，后续断言判红
}

run_gate_env_list() { # $1=root $2=清单路径 ⇒ 走 SYNO_GATE_PROTECTED_LIST 注入缝
  local _root="$1" _list="$2"
  OUT="$(SYNO_GATE_PROTECTED_LIST="$_list" SYNO_GATE_DEGRADED_LOG="$TMPD/degraded-events.log" \
    bash "$GATE" --root "$_root" 2>"$TMPD/stderr.txt")"
  RC=$?
  ERR="$(cat "$TMPD/stderr.txt" 2>/dev/null)"  # swallow-ok: 读临时 stderr 失败⇒ERR 空，后续断言判红
}

sb_commit() { # $1=目录 $2=说明 $3=作者邮箱（空 ⇒ 用仓内默认 k12@local）
  local _d="$1" _msg="$2" _email="${3:-}"
  # 🔴 固定提交时间 ⇒ 沙箱 commit SHA 跨次可复现（"连跑两次同值"是硬要求；否则 ⑧ 的 base 短 SHA 会漂）
  if [ -n "$_email" ]; then
    ( cd "$_d" && git add -A \
      && GIT_AUTHOR_DATE="2026-10-18T00:00:00+0000" GIT_COMMITTER_DATE="2026-10-18T00:00:00+0000" \
        git -c user.email="$_email" -c user.name=synova commit -q -m "$_msg" )
  else
    ( cd "$_d" && git add -A \
      && GIT_AUTHOR_DATE="2026-10-18T00:00:00+0000" GIT_COMMITTER_DATE="2026-10-18T00:00:00+0000" \
        git commit -q -m "$_msg" )
  fi
}

# 沙箱 S1：base 含清单 ＋ 受保护脚本（③④⑤⑥⑦ 共用；每步 diff 均相对同一 base）
S1="$TMPD/s1"
mk_repo "$S1" || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 初始化失败（git init）"
(
  cd "$S1" || exit 1
  cp "$MANIFEST" .gitea/protected-files.txt || exit 1
  printf '#!/bin/bash\necho v1\n' >scripts/pre-commit-check.sh || exit 1
) || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 写基线文件失败"
sb_commit "$S1" "base: 清单＋受保护脚本" || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 base 提交失败"
S1_BASE="$(git -C "$S1" rev-parse HEAD)" || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 取 base 失败"

# ── ③ 沙箱：改受保护路径无豁免 ⇒ exit 1 ──────────────────────────────────────
(
  cd "$S1" || exit 1
  printf '#!/bin/bash\necho changed-without-exempt\n' >scripts/pre-commit-check.sh || exit 1
) || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 ③ 写文件失败"
sb_commit "$S1" "c2: 改受保护路径，无豁免" || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 ③ 提交失败"
run_gate "$S1" --changed-base "$S1_BASE"
M3_PROT="$(printf '%s\n' "$OUT" | grep -o '受保护路径变更 [0-9][0-9]* 条' | grep -o '[0-9][0-9]*' | head -1)"
M3_NAME="$(printf '%s\n' "$OUT" | grep -c '无合规豁免: scripts/pre-commit-check.sh')"
if [ "$RC" -eq 1 ] && [ "${M3_NAME:-0}" -ge 1 ]; then
  ok "③ 沙箱 改受保护路径无豁免 → exit ${RC}（受保护变更=${M3_PROT:-?} 条，点名命中=${M3_NAME}）"
else
  no "③ 沙箱 改受保护路径无豁免应 exit 1 且点名，实际 exit ${RC}（受保护变更=${M3_PROT:-?}，点名命中=${M3_NAME:-0}）"
fi

# ── ④ 沙箱：同 diff 内有合规豁免（作者=huangxuesongvip@163.com）⇒ exit 0 ──────
(
  cd "$S1" || exit 1
  printf '#!/bin/bash\necho changed-with-exempt\n' >scripts/pre-commit-check.sh || exit 1
  printf '# 豁免登记（沙箱自证）\n\n- scripts/pre-commit-check.sh — 批次内同步改门禁脚本与清单 — CTO-2026-10-18-裁901\n' \
    >gate-exemptions/e-compliant.md || exit 1
) || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 ④ 写文件失败"
sb_commit "$S1" "c3: 改受保护路径＋合规豁免（批准人提交）" "huangxuesongvip@163.com" \
  || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 ④ 提交失败"
run_gate "$S1" --changed-base "$S1_BASE"
M4_COVER="$(printf '%s\n' "$OUT" | grep -c '受保护路径有合规豁免')"
M4_AUTH="$(git -C "$S1" log -1 --format=%ae -- gate-exemptions/e-compliant.md)"
if [ "$RC" -eq 0 ] && [ "${M4_COVER:-0}" -ge 1 ]; then
  ok "④ 沙箱 同 diff 合规豁免 → exit ${RC}（覆盖命中=${M4_COVER}，豁免作者=${M4_AUTH}）"
else
  no "④ 沙箱 同 diff 合规豁免应 exit 0，实际 exit ${RC}（覆盖命中=${M4_COVER:-0}，豁免作者=${M4_AUTH:-?}）"
fi

# ── ⑤ 沙箱：豁免缺理由 ⇒ exit 1 ──────────────────────────────────────────────
(
  cd "$S1" || exit 1
  printf '#!/bin/bash\necho changed-reasonless\n' >scripts/pre-commit-check.sh || exit 1
  printf '# 豁免登记\n\n- scripts/pre-commit-check.sh —  — CTO-2026-10-18-裁902\n' \
    >gate-exemptions/e-compliant.md || exit 1
) || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 ⑤ 写文件失败"
sb_commit "$S1" "c4: 豁免缺理由（批准人提交）" "huangxuesongvip@163.com" \
  || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 ⑤ 提交失败"
run_gate "$S1" --changed-base "$S1_BASE"
M5_MSG="$(printf '%s\n' "$OUT" | grep -c '缺理由')"
if [ "$RC" -eq 1 ] && [ "${M5_MSG:-0}" -ge 1 ]; then
  ok "⑤ 沙箱 豁免缺理由 → exit ${RC}（'缺理由' 命中=${M5_MSG}）"
else
  no "⑤ 沙箱 豁免缺理由应 exit 1 且提示缺理由，实际 exit ${RC}（命中=${M5_MSG:-0}）"
fi

# ── ⑥ 沙箱：豁免作者=k12@local（非 approver）⇒ exit 1 ─────────────────────────
(
  cd "$S1" || exit 1
  printf '#!/bin/bash\necho changed-bad-author\n' >scripts/pre-commit-check.sh || exit 1
  printf '# 豁免登记\n\n- scripts/pre-commit-check.sh — 声称有理由 — CTO-2026-10-18-裁903\n' \
    >gate-exemptions/e-compliant.md || exit 1
) || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 ⑥ 写文件失败"
sb_commit "$S1" "c5: 豁免由小队身份提交（非批准人）" "k12@local" \
  || degrade_exit E_SANDBOX_BROKEN "沙箱 S1 ⑥ 提交失败"
run_gate "$S1" --changed-base "$S1_BASE"
M6_MSG="$(printf '%s\n' "$OUT" | grep -c '作者非批准人')"
M6_AUTH="$(git -C "$S1" log -1 --format=%ae -- gate-exemptions/e-compliant.md)"
if [ "$RC" -eq 1 ] && [ "${M6_MSG:-0}" -ge 1 ]; then
  ok "⑥ 沙箱 豁免作者非 approver → exit ${RC}（作者=${M6_AUTH}，'作者非批准人' 命中=${M6_MSG}）"
else
  no "⑥ 沙箱 豁免作者非 approver 应 exit 1，实际 exit ${RC}（作者=${M6_AUTH:-?}，命中=${M6_MSG:-0}）"
fi

# ── ⑦ 沙箱：清单缺失 ⇒ exit 2；PATTERNS 段空 ⇒ exit 2（两子例，打印各自 exit）──
run_gate_env_list "$S1" "$TMPD/absent-manifest.txt"   # 注入缝 SYNO_GATE_PROTECTED_LIST
M7A_RC=$RC
M7A_CODE="$(printf '%s\n%s\n' "$OUT" "$ERR" | grep -c 'E_LIST_MISSING')"
printf '# 只有注释\n# PATTERNS-BEGIN\n# 段内 0 条\n# PATTERNS-END\n' >"$TMPD/empty-list.txt"
run_gate "$S1" --list "$TMPD/empty-list.txt"          # 注入缝 --list
M7B_RC=$RC
M7B_CODE="$(printf '%s\n%s\n' "$OUT" "$ERR" | grep -c 'E_LIST_EMPTY')"
if [ "$M7A_RC" -eq 2 ] && [ "$M7B_RC" -eq 2 ]; then
  ok "⑦ 沙箱 清单缺失 → exit ${M7A_RC}（E_LIST_MISSING 命中=${M7A_CODE}）／PATTERNS 段空 → exit ${M7B_RC}（E_LIST_EMPTY 命中=${M7B_CODE}）"
else
  no "⑦ 沙箱 清单缺失应为 exit 2、PATTERNS 段空应为 exit 2，实际 exit ${M7A_RC} / exit ${M7B_RC}"
fi

# ── ⑧ 沙箱：bootstrap（base 无清单）⇒ exit 0 且输出含 BOOTSTRAP ──────────────
S2="$TMPD/s2"
mk_repo "$S2" || degrade_exit E_SANDBOX_BROKEN "沙箱 S2 初始化失败（git init）"
(
  cd "$S2" || exit 1
  printf '#!/bin/bash\necho v1\n' >scripts/pre-commit-check.sh || exit 1
) || degrade_exit E_SANDBOX_BROKEN "沙箱 S2 c1 写文件失败"
sb_commit "$S2" "c1: 无清单（bootstrap 前）" || degrade_exit E_SANDBOX_BROKEN "沙箱 S2 c1 提交失败"
S2_C1="$(git -C "$S2" rev-parse HEAD)" || degrade_exit E_SANDBOX_BROKEN "沙箱 S2 取 c1 失败"
(
  cd "$S2" || exit 1
  cp "$MANIFEST" .gitea/protected-files.txt || exit 1
  printf '#!/bin/bash\necho v2\n' >scripts/pre-commit-check.sh || exit 1
) || degrade_exit E_SANDBOX_BROKEN "沙箱 S2 c2 写文件失败"
sb_commit "$S2" "c2: 清单首次落盘＋改脚本" || degrade_exit E_SANDBOX_BROKEN "沙箱 S2 c2 提交失败"
run_gate "$S2" --changed-base "$S2_C1"
M8_BOOT="$(printf '%s\n' "$OUT" | grep -c '^BOOTSTRAP: ')"
if [ "$RC" -eq 0 ] && [ "${M8_BOOT:-0}" -ge 1 ]; then
  ok "⑧ 沙箱 bootstrap（base 无清单）→ exit ${RC}（BOOTSTRAP 行=${M8_BOOT}，base=${S2_C1:0:8}）"
else
  no "⑧ 沙箱 bootstrap 应 exit 0 ＋ BOOTSTRAP 行，实际 exit ${RC}（BOOTSTRAP=${M8_BOOT:-0}）"
fi

# ── ⑨ ①d 已接线：workflow grep ≥1（打印命中数）────────────────────────────────
M9_HITS="$(grep -c 'check-gate-protection.sh' "$WF")"
if [ "${M9_HITS:-0}" -ge 1 ]; then
  ok "⑨ ①d 已接线 → grep -c 'check-gate-protection.sh' 命中=${M9_HITS}"
else
  no "⑨ ①d 未接线 → grep -c 'check-gate-protection.sh' 命中=${M9_HITS:-0}（应 ≥1）"
fi

# ── ⑩ 检查器零平台 API 调用：grep -c = 0 ─────────────────────────────────────
# 平台 API 路径按**拼接**构造（避免本文件自身命中同类扫描）
API_PAT='/branch_'"protections"
M10_HITS="$(grep -c "$API_PAT" "$GATE")"
if [ "${M10_HITS:-0}" -eq 0 ]; then
  ok "⑩ 检查器零平台 API 调用 → grep -c 命中=${M10_HITS}"
else
  no "⑩ 检查器不应调用平台 API，命中=${M10_HITS:-0}"
fi

# ── ⑪ ①d 步块内解析链无 origin 回退 ──────────────────────────────────────────
# 🔴 结束锚**不得**带 `^`：实测（2026-10-18）写 `awk '/- name: ①d/,/^- name: ①b/'` 时范围匹配
#    跑到 EOF（209 行），把 ③/④ 既有步的 6 处合法 origin 引用扫进来 ⇒ 本项判据**永假**。
#    故结束锚用无 `^` 的 `/- name: ①b/`（①d 块 = 55 行）。
BLOCK="$TMPD/d1-block.txt"
awk '/- name: ①d/,/- name: ①b/' "$WF" >"$BLOCK" \
  || degrade_exit E_BASELINE_UNPARSEABLE "①d 步块提取失败（awk）"
M11_LINES="$(wc -l <"$BLOCK" | tr -d ' ')"
[ "${M11_LINES:-0}" -gt 0 ] || degrade_exit E_BASELINE_UNPARSEABLE \
  "①d 步块 0 行（workflow 步名被改？不可解析 ⇒ fail loud）"
M11_ORIGIN="$(grep -cE 'origin/local-main|origin/main' "$BLOCK")"
if [ "${M11_ORIGIN:-0}" -eq 0 ]; then
  ok "⑪ ①d 步块内零 origin 回退 → block=${M11_LINES} 行，'origin/local-main|origin/main' 命中=${M11_ORIGIN}"
else
  no "⑪ ①d 步块内出现 origin 回退 → block=${M11_LINES} 行，命中=${M11_ORIGIN}（应 =0）"
fi

# ── ⑫ push 腿语义 ＋ 7 件交付件禁语扫描 ───────────────────────────────────────
M12_PR="$(grep -c 'pull_request' "$BLOCK")"
M12_INTEG="$(grep -c '清单完整性' "$BLOCK")"
# 禁语 pattern 按**单字变量拼接**构造：本文件自身亦在 7 件交付件内，写死字面量会让扫描自我命中。
C_YE='也'; C_LAN='拦'; C_ZU='阻'; C_DUAN='断'; C_JIE='截'
PUSH_FORBID="push ${C_YE}${C_LAN}|push ${C_ZU}${C_DUAN}|push ${C_YE}${C_LAN}${C_JIE}"
SCAN="$TMPD/push-scan.txt"
: >"$SCAN"
for _rel in \
  ".gitea/protected-files.txt" \
  "scripts/control-tower/check-gate-protection.sh" \
  "tests/control-tower/check-gate-protection.test.sh" \
  "tests/control-tower/gate-protection-acceptance.test.sh" \
  ".gitea/workflows/local-gates.yml" \
  "gate-exemptions/README.md" \
  "memory/notes/proposed/2026-10-18-gate-protection.md"; do
  [ -f "$REPO/$_rel" ] || degrade_exit E_BASELINE_MISSING "交付件缺失: $_rel"
  grep -nE "$PUSH_FORBID" "$REPO/$_rel" >>"$SCAN"
done
M12_RAW="$(wc -l <"$SCAN" | tr -d ' ')"
# 排除**禁止性语境行**（含 不得/禁/不要/别/不能）：它们是在禁止该说法，不是违规
grep -E '不得|禁|不要|别|不能' "$SCAN" >"$TMPD/push-excluded.txt"
M12_EXCL="$(wc -l <"$TMPD/push-excluded.txt" | tr -d ' ')"
grep -vE '不得|禁|不要|别|不能' "$SCAN" >"$TMPD/push-violations.txt"
M12_VIOL="$(wc -l <"$TMPD/push-violations.txt" | tr -d ' ')"
if [ "${M12_PR:-0}" -ge 1 ] && [ "${M12_INTEG:-0}" -ge 1 ] && [ "${M12_VIOL:-0}" -eq 0 ]; then
  ok "⑫ push 腿语义 → pull_request=${M12_PR}，清单完整性=${M12_INTEG}；禁语命中=${M12_RAW}（排除禁止性语境=${M12_EXCL}，残留=${M12_VIOL}）"
else
  no "⑫ push 腿语义不足 → pull_request=${M12_PR:-0}，清单完整性=${M12_INTEG:-0}；禁语残留=${M12_VIOL:-0}（命中=${M12_RAW:-0}，排除=${M12_EXCL:-0}）"
fi

# ── S5 收口 ───────────────────────────────────────────────────────────────────
echo ""
echo "结果: $PASS 通过, $FAIL 失败"
if [ "$PASS" -eq 12 ] && [ "$FAIL" -eq 0 ]; then
  exit 0
fi
if [ "$((PASS + FAIL))" -ne 12 ]; then
  # 项数漂移：末行已打印，但退出码仍须 fail loud（不静默）
  echo "degraded: 自证项数漂移（PASS+FAIL=$((PASS + FAIL)) ≠ 12）" >&2
  exit 2
fi
exit 1
