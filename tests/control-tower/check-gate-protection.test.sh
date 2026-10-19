#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-protection.test.sh — CT-40 配对测试（清单自检 ＋ diff 豁免核验）
#
# 配对对象: scripts/control-tower/check-gate-protection.sh（CT-40：scripts/control-tower/<name>.sh
#           ↔ tests/control-tower/<name>.test.sh）
#
# 覆盖矩阵（三路径 ＋ 五反例 ＋ 陈旧 base/DS-6 ＋ 契约）:
#   正常 — 真清单默认模式 ⇒ exit 0 ｜ 沙箱合规豁免 ⇒ exit 0（DS-3）
#   降级 — 清单缺失 ⇒ exit 2 ｜ PATTERNS 段空 ⇒ exit 2 ｜ 坏 base ⇒ exit 2（DS-5）
#   真红 — pin 漂移 ⇒ exit 1 ｜ 受保护变更无豁免 ⇒ exit 1 且点名（DS-2）
#          ｜ 豁免无理由 ⇒ exit 1 ｜ 豁免作者非 approver ⇒ exit 1（DS-4）
#   边界 — 陈旧 base（无清单）⇒ exit 2 ＋ E_BAD_BASE（禁 BOOTSTRAP；#610 已退役 bootstrap）｜
#          T10b 同族反例：工作树有未跟踪清单仍 ⇒ exit 2 ｜ DS-6 反证：base 有清单
#          且改保护路径无豁免 ⇒ exit 1（同一仓内对照，证明 base 有清单才判 diff）
#   契约 — `--json` 输出合法 JSON ｜ 零平台 API 调用（DS-8：本器对平台 API 路径零命中）
#   接线 — 检查器存在且可执行 ＋ 默认（无参）可跑（WIRE CHECK，铁律 0-2）
#   注入缝 — SYNO_GATE_PROTECTED_LIST 真实生效（不碰真实仓库清单）
#
# 沙箱: mktemp -d ＋ git init ＋ `--root`/`--list`/`SYNO_GATE_PROTECTED_LIST` 注入；
#       🔴 零仓库内容写（不 git add/commit/stash，不改 .gitea/protected-files.txt）；
#       降级日志全部导到 TMPD（export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded-events.log"）；
#       trap 清理；每项打印实测数字（exit / 条数 / 缓存命中数）。
# 判别力自检（D4）: 五反例全部「改坏确实红」，且断言**红的原因原文**（不只断言 exit）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/check-gate-protection.sh"
MANIFEST="$REPO/.gitea/protected-files.txt"
TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
# 降级日志导出（覆盖后续**所有**检查器调用）：全部落 TMPD，不污染仓内 .codex/ 日志
export SYNO_GATE_DEGRADED_LOG="$TMPD/degraded-events.log"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# 平台 API 路径按**拼接**构造（避免本文件自身命中 DS-8 的零命中判据）
API_PAT='/branch_'"protections"

# 沙箱仓：git init ＋ 固定身份（禁受宿主全局 config / hooks 影响）
mk_repo() { # $1=目录
  mkdir -p "$1/.gitea"
  (
    cd "$1" || exit 1
    git init -q
    git config user.email k12@local
    git config user.name k12-batch5
    git config commit.gpgsign false
    git config core.hooksPath /nonexistent-hooks-dir   # 沙箱不跑任何钩子（非 --no-verify）
    mkdir -p gate-exemptions scripts
  ) || return 1
  return 0
}

run_gate() { # $1=root [extra args…] ⇒ 全局 OUT / ERR / RC
  OUT="$(bash "$GATE" --root "$1" "${@:2}" 2>"$TMPD/stderr.txt")"
  RC=$?
  ERR="$(cat "$TMPD/stderr.txt" 2>/dev/null || true)"
}

echo "=== CT-40 check-gate-protection 配对测试 ==="

# ── T0 接线 ＋ DS-8 零平台 API ──────────────────────────────────────────────
if [ -f "$GATE" ] && [ -x "$GATE" ]; then
  ok "接线: 检查器存在且可执行（$(wc -c <"$GATE" | tr -d ' ') bytes）"
else
  no "接线: $GATE 缺失或不可执行"
fi
API_HITS=$(grep -c "$API_PAT" "$GATE" 2>/dev/null | tr -d '\n\r' || true)
API_HITS=${API_HITS:-0}
[ "$API_HITS" = "0" ] && ok "DS-8: 零平台 API 调用（命中 ${API_HITS}）" \
  || no "DS-8: 不应调用平台 API，命中 ${API_HITS}"
PAIR_HITS=$(grep -c "check-gate-protection" "$GATE" 2>/dev/null | tr -d '\n\r' || true)
[ "${PAIR_HITS:-0}" -ge 1 ] && ok "接线: 自述名命中（${PAIR_HITS}）" || no "接线: 自述名未命中"

# ── T1 正常: 真清单默认模式 ⇒ exit 0 ───────────────────────────────────────
bash "$GATE" >"$TMPD/t1.out" 2>"$TMPD/t1.err"
T1RC=$?
T1CNT=$(grep -o 'PATTERNS [0-9][0-9]* 条' "$TMPD/t1.out" | grep -o '[0-9][0-9]*' | head -1)
T1PIN=$(grep -o 'pin 一致（声明 [0-9a-f]*' "$TMPD/t1.out" | awk '{print $NF}' | head -1)
if [ "$T1RC" -eq 0 ] && [ "${T1CNT:-0}" -eq 20 ]; then
  ok "正常: 真清单默认模式 → exit ${T1RC}（条数=${T1CNT}, pin=${T1PIN}）"
else
  no "正常: 真清单默认模式应 exit 0 且条数=20，实际 exit ${T1RC}, 条数=${T1CNT:-?}"
fi

# ── T2 降级: 清单缺失 ⇒ exit 2 ＋ degraded 行（DS-5）────────────────────────
SYNO_GATE_PROTECTED_LIST=/nope/never-exists.txt bash "$GATE" >"$TMPD/t2.out" 2>"$TMPD/t2.err"
T2RC=$?
T2DEG=$(grep -c '^degraded: ' "$TMPD/t2.err" 2>/dev/null | tr -d '\n\r' || true)
T2CODE=$(grep -o 'E_LIST_MISSING' "$TMPD/t2.err" "$TMPD/t2.out" 2>/dev/null | wc -l | tr -d ' ')  # swallow-ok: 读临时文件失败⇒计数 0，后续断言判红，不静默放行
if [ "$T2RC" -eq 2 ] && [ "${T2DEG:-0}" -ge 1 ] && [ "${T2CODE:-0}" -ge 1 ]; then
  ok "DS-5: 清单缺失 → exit ${T2RC}（degraded 行=${T2DEG}, code 命中=${T2CODE}）"
else
  no "DS-5: 清单缺失应 exit 2＋degraded＋E_LIST_MISSING，实际 exit ${T2RC}, degraded=${T2DEG:-0}, code=${T2CODE:-0}"
fi

# ── 沙箱 S1: base 有清单（真清单副本），用于 T3/T4/T5/T6/T7/T8/T9/T11 ──────
S1="$TMPD/s1"
mk_repo "$S1" || no "沙箱 S1 初始化失败"
(
  cd "$S1" || exit 1
  cp "$MANIFEST" .gitea/protected-files.txt
  printf '#!/bin/bash\necho base\n' > scripts/pre-commit-check.sh
  git add -A && git commit -qm "base: 清单 ＋ 受保护脚本"
) || no "沙箱 S1 base 提交失败"
S1_BASE="$(cd "$S1" && git rev-parse HEAD)"

# ── T3 降级: PATTERNS 段空（信号量 0）⇒ exit 2 ──────────────────────────────
EMPTY="$TMPD/empty-list.txt"
printf '# 只有注释，PATTERNS 段 0 条\n# PATTERNS-BEGIN\n# PATTERNS-END\n' > "$EMPTY"
SYNO_GATE_PROTECTED_LIST="$EMPTY" bash "$GATE" >"$TMPD/t3.out" 2>"$TMPD/t3.err"
T3RC=$?
T3PAT=$(cat "$TMPD/t3.out" "$TMPD/t3.err" 2>/dev/null | grep -c 'E_LIST_EMPTY' | tr -d '\n\r' || true)
if [ "$T3RC" -eq 2 ] && [ "${T3PAT:-0}" -ge 1 ]; then
  ok "降级: PATTERNS 段 0 条 → exit ${T3RC}（E_LIST_EMPTY 命中=${T3PAT}）"
else
  no "降级: PATTERNS 段空应 exit 2＋E_LIST_EMPTY，实际 exit ${T3RC}, 命中=${T3PAT:-0}"
fi

# ── T4 真红: pin 漂移（改一条 pattern 不改 pin）⇒ exit 1 ────────────────────
DRIFT="$TMPD/drift-list.txt"
awk '{print} /^scripts\/check-\*\.sh$/{print "scripts/evil-new-gate.sh"}' "$MANIFEST" > "$DRIFT"
DRIFT_ADDED=$(grep -c '^scripts/evil-new-gate.sh$' "$DRIFT" | tr -d '\n\r' || true)
SYNO_GATE_PROTECTED_LIST="$DRIFT" bash "$GATE" >"$TMPD/t4.out" 2>"$TMPD/t4.err"
T4RC=$?
T4MSG=$(grep -c 'pin 漂移' "$TMPD/t4.out" 2>/dev/null | tr -d '\n\r' || true)
if [ "$T4RC" -eq 1 ] && [ "${T4MSG:-0}" -ge 1 ] && [ "${DRIFT_ADDED:-0}" -eq 1 ]; then
  ok "反例 R1: pin 漂移 → exit ${T4RC}（新增 pattern=${DRIFT_ADDED}, 'pin 漂移' 命中=${T4MSG}）"
else
  no "反例 R1: pin 漂移应 exit 1，实际 exit ${T4RC}, 新增=${DRIFT_ADDED:-0}, 提示=${T4MSG:-0}"
fi

# ── T5 注入缝: SYNO_GATE_PROTECTED_LIST 生效（默认模式 exit 0）─────────────
SYNO_GATE_PROTECTED_LIST="$S1/.gitea/protected-files.txt" bash "$GATE" --root "$S1" >"$TMPD/t5.out" 2>"$TMPD/t5.err"
T5RC=$?
if [ "$T5RC" -eq 0 ]; then
  ok "注入缝: SYNO_GATE_PROTECTED_LIST → exit ${T5RC}（清单=$(grep -c 'PATTERNS 20 条' "$TMPD/t5.out" | tr -d '\n\r') 匹配）"
else
  no "注入缝: SYNO_GATE_PROTECTED_LIST 应生效 exit 0，实际 exit ${T5RC}"
fi

# ── T6 反例 R2/DS-2: 受保护变更无豁免 ⇒ exit 1 且点名 ──────────────────────
(
  cd "$S1" || exit 1
  printf '#!/bin/bash\necho changed-without-exempt\n' > scripts/pre-commit-check.sh
  git add -A && git commit -qm "改门禁脚本：无豁免"
) || no "沙箱 S1 无豁免提交失败"
run_gate "$S1" --changed-base "$S1_BASE"
T6NAME=$(printf '%s' "$OUT" | grep -c 'scripts/pre-commit-check.sh' | tr -d '\n\r' || true)
if [ "$RC" -eq 1 ] && [ "${T6NAME:-0}" -ge 1 ]; then
  ok "DS-2/R2: 受保护变更无豁免 → exit ${RC}（点名路径命中=${T6NAME}, 受保护变更=$(printf '%s' "$OUT" | grep -o '受保护路径变更 [0-9]* 条' | grep -o '[0-9]*' | head -1)）"
else
  no "DS-2/R2: 应为 exit 1 且点名 scripts/pre-commit-check.sh，实际 exit ${RC}"
fi

# ── T7 DS-3: 合规豁免（批准人提交）⇒ exit 0 ────────────────────────────────
(
  cd "$S1" || exit 1
  printf '#!/bin/bash\necho changed-with-exempt\n' > scripts/pre-commit-check.sh
  printf '# 豁免登记\n\n- scripts/pre-commit-check.sh — 批次内同步改门禁脚本与清单 — CTO-2026-10-18-裁001\n' \
    > gate-exemptions/e-compliant.md
  git add -A
  git -c user.email=huangxuesongvip@163.com -c user.name=synova commit -qm "改门禁脚本＋合规豁免（批准人提交）"
) || no "沙箱 S1 合规豁免提交失败"
run_gate "$S1" --changed-base "$S1_BASE"
T7COVER=$(printf '%s' "$OUT" | grep -c '受保护路径有合规豁免' | tr -d '\n\r' || true)
T7AUTH=$(cd "$S1" && git log -1 --format=%ae -- gate-exemptions/e-compliant.md)
if [ "$RC" -eq 0 ] && [ "${T7COVER:-0}" -ge 1 ]; then
  ok "DS-3: 合规豁免 → exit ${RC}（覆盖命中=${T7COVER}, 豁免作者=${T7AUTH}）"
else
  no "DS-3: 合规豁免应 exit 0，实际 exit ${RC}（覆盖命中=${T7COVER:-0}）"
fi

# ── T8 反例 R3: 豁免无理由 ⇒ exit 1 ─────────────────────────────────────────
(
  cd "$S1" || exit 1
  printf '#!/bin/bash\necho changed-reasonless\n' > scripts/pre-commit-check.sh
  printf '# 豁免登记\n\n- scripts/pre-commit-check.sh —  — CTO-2026-10-18-裁002\n' \
    > gate-exemptions/e-compliant.md
  git add -A
  git -c user.email=huangxuesongvip@163.com -c user.name=synova commit -qm "豁免无理由"
) || no "沙箱 S1 无理由豁免提交失败"
run_gate "$S1" --changed-base "$S1_BASE"
T8MSG=$(printf '%s' "$OUT" | grep -c '缺理由' | tr -d '\n\r' || true)
if [ "$RC" -eq 1 ] && [ "${T8MSG:-0}" -ge 1 ]; then
  ok "DS-4/R3: 豁免无理由 → exit ${RC}（'缺理由' 命中=${T8MSG}）"
else
  no "DS-4/R3: 豁免无理由应 exit 1 且提示缺理由，实际 exit ${RC}, 命中=${T8MSG:-0}"
fi

# ── T9 反例 R4: 豁免作者非 approver ⇒ exit 1 ───────────────────────────────
(
  cd "$S1" || exit 1
  printf '#!/bin/bash\necho changed-bad-author\n' > scripts/pre-commit-check.sh
  printf '# 豁免登记\n\n- scripts/pre-commit-check.sh — 声称有理由 — CTO-2026-10-18-裁003\n' \
    > gate-exemptions/e-compliant.md
  git add -A
  git -c user.email=k12@local -c user.name=k12-batch5 commit -qm "豁免由 agent 提交（非批准人）"
) || no "沙箱 S1 非批准人豁免提交失败"
run_gate "$S1" --changed-base "$S1_BASE"
T9MSG=$(printf '%s' "$OUT" | grep -c '作者非批准人' | tr -d '\n\r' || true)
T9AUTH=$(cd "$S1" && git log -1 --format=%ae -- gate-exemptions/e-compliant.md)
if [ "$RC" -eq 1 ] && [ "${T9MSG:-0}" -ge 1 ]; then
  ok "DS-4/R4: 豁免作者非 approver → exit ${RC}（作者=${T9AUTH}, '作者非批准人' 命中=${T9MSG}）"
else
  no "DS-4/R4: 非批准人豁免应 exit 1 且提示作者非批准人，实际 exit ${RC}, 命中=${T9MSG:-0}"
fi

# ── T10/T12 陈旧 base（无清单）⇒ 2 ⇄ DS-6（同一仓内对照，证明 base 有清单才判 diff）────
S6="$TMPD/s6"
mk_repo "$S6" || no "沙箱 S6 初始化失败"
(
  cd "$S6" || exit 1
  printf '#!/bin/bash\necho v1\n' > scripts/pre-commit-check.sh
  git add -A && git commit -qm "c1: 无清单（陈旧 base）"
) || no "沙箱 S6 c1 提交失败"
S6_C1="$(cd "$S6" && git rev-parse HEAD)"
(
  cd "$S6" || exit 1
  cp "$MANIFEST" .gitea/protected-files.txt
  printf '#!/bin/bash\necho v2\n' > scripts/pre-commit-check.sh
  git add -A && git commit -qm "c2: 清单落盘 ＋ 改脚本"
) || no "沙箱 S6 c2 提交失败"
S6_C2="$(cd "$S6" && git rev-parse HEAD)"
run_gate "$S6" --changed-base "$S6_C1"
T10CODE=$(printf '%s\n%s' "$OUT" "$ERR" | grep -c 'E_BAD_BASE' | tr -d '\n\r' || true)
T10BOOT=$(printf '%s' "$OUT" | grep -c '^BOOTSTRAP: ' | tr -d '\n\r' || true)
if [ "$RC" -eq 2 ] && [ "${T10CODE:-0}" -ge 1 ] && [ "${T10BOOT:-0}" -eq 0 ]; then
  ok "边界: 陈旧 base（无清单）→ exit ${RC}（E_BAD_BASE 命中=${T10CODE}, BOOTSTRAP 行=${T10BOOT}, base=${S6_C1:0:8}）"
else
  no "边界: 陈旧 base（无清单）应 exit 2 ＋ E_BAD_BASE 且禁 BOOTSTRAP，实际 exit ${RC}, E_BAD_BASE=${T10CODE:-0}, BOOTSTRAP=${T10BOOT:-0}"
fi

# ── T10b 同族反例: base 无清单 ＋ 工作树有未跟踪清单 ⇒ 2（不因 diff 未命中放行）──
S8="$TMPD/s8"
mk_repo "$S8" || no "沙箱 S8 初始化失败"
(
  cd "$S8" || exit 1
  printf '#!/bin/bash\necho v1\n' > scripts/pre-commit-check.sh
  git add -A && git commit -qm "c1: 无清单（base）"
) || no "沙箱 S8 c1 提交失败"
S8_C1="$(cd "$S8" && git rev-parse HEAD)"
(
  cd "$S8" || exit 1
  cp "$MANIFEST" .gitea/protected-files.txt          # 未跟踪清单（不 git add、不 commit）
  printf '#!/bin/bash\necho v2-uncommitted\n' > scripts/pre-commit-check.sh  # 工作树改动，不进 diff
) || no "沙箱 S8 工作树写入失败"
run_gate "$S8" --changed-base "$S8_C1"
T10BCODE=$(printf '%s\n%s' "$OUT" "$ERR" | grep -c 'E_BAD_BASE' | tr -d '\n\r' || true)
T10BBOOT=$(printf '%s' "$OUT" | grep -c '^BOOTSTRAP: ' | tr -d '\n\r' || true)
if [ "$RC" -eq 2 ] && [ "${T10BCODE:-0}" -ge 1 ] && [ "${T10BBOOT:-0}" -eq 0 ]; then
  ok "边界: 未跟踪清单（base 无清单）→ exit ${RC}（E_BAD_BASE 命中=${T10BCODE}, BOOTSTRAP 行=${T10BBOOT}, base=${S8_C1:0:8}）"
else
  no "边界: 未跟踪清单应 exit 2（不因 diff 未命中放行），实际 exit ${RC}, E_BAD_BASE=${T10BCODE:-0}, BOOTSTRAP=${T10BBOOT:-0}"
fi

# ── T11 反例: 坏 base ⇒ exit 2 ──────────────────────────────────────────────
run_gate "$S1" --changed-base "no-such-ref-deadbeef"
T11CODE=$(printf '%s\n%s' "$OUT" "$ERR" | grep -c 'E_BAD_BASE' | tr -d '\n\r' || true)
if [ "$RC" -eq 2 ] && [ "${T11CODE:-0}" -ge 1 ]; then
  ok "降级: 坏 base → exit ${RC}（E_BAD_BASE 命中=${T11CODE}）"
else
  no "降级: 坏 base 应 exit 2＋E_BAD_BASE，实际 exit ${RC}, 命中=${T11CODE:-0}"
fi

# ── T12 DS-6: base 有清单 ＋ 改保护路径无豁免 ⇒ exit 1 ─────────────────────
(
  cd "$S6" || exit 1
  printf '#!/bin/bash\necho v3\n' > scripts/pre-commit-check.sh
  git add -A && git commit -qm "c3: 改保护路径，无豁免"
) || no "沙箱 S6 c3 提交失败"
run_gate "$S6" --changed-base "$S6_C2"
T12BOOT=$(printf '%s' "$OUT" | grep -c '^BOOTSTRAP: ' | tr -d '\n\r' || true)
if [ "$RC" -eq 1 ] && [ "${T12BOOT:-0}" -eq 0 ]; then
  ok "DS-6: base 有清单 ＋ 无豁免 → exit ${RC}（BOOTSTRAP 行=${T12BOOT} ⇒ base 有清单才判 diff）"
else
  no "DS-6: base 有清单时应 exit 1 且不得 BOOTSTRAP，实际 exit ${RC}, BOOTSTRAP=${T12BOOT:-0}"
fi

# ── T13 契约: --json 输出合法 JSON ─────────────────────────────────────────
JSON_OUT=$(bash "$GATE" --root "$S1" --changed-base "$S1_BASE" --json 2>"$TMPD/t13.err")
T13RC=$?
JSON_OK=$("${PYTHON_BIN:-python3}" - "$JSON_OUT" <<'PY' 2>/dev/null  # swallow-ok: 解析自身失败⇒JSON_OK 空，契约断言判红
import json, sys
try:
    obj = json.loads(sys.argv[1])
except Exception:
    print("INVALID"); raise SystemExit(0)
need = ["component", "ok", "exit", "patterns", "pin_computed", "approvers", "checks", "failures"]
missing = [k for k in need if k not in obj]
flag = "OK" if obj.get("exit") in (0, 1, 2) else "BADEXIT"
print("%s:%s:%s" % (flag, obj.get("exit"), ",".join(missing) or "-"))
PY
)
case "$JSON_OK" in
  OK:*) ok "契约: --json 合法 JSON（JSON.exit=${JSON_OK#OK:}，stdout 行数=$(printf '%s\n' "$JSON_OUT" | wc -l | tr -d ' ')，与进程 exit=${T13RC} 独立）" ;;
  *) no "契约: --json 输出非法 JSON 或缺字段（${JSON_OK:-解析器不可用}）" ;;
esac

# ── T14 glob 语义（禁 fnmatch：`*` 不跨 `/`、`**` 跨目录、`?` 单字符、大小写不敏感）──
# 判别力: 若实现退回 `fnmatch` 整串 translate（`*` 会跨 `/`），(a) 会变红 ⇒ 本项能抓住它。
G="$TMPD/g"
mk_repo "$G" || no "沙箱 G 初始化失败"
GLIST="$TMPD/glob-list.txt"
"${PYTHON_BIN:-python3}" - "$GLIST" <<'PY' || no "glob 清单生成失败"
import hashlib, sys
patterns = ["files/*.sh", "deep/**", "q/check-?.sh"]
pin = hashlib.sha256("".join(p + "\n" for p in patterns).encode("utf-8")).hexdigest()
body = ["# glob 语义测试清单（pin 由测试独立复算）",
        "# PROTECTED-PATTERNS-SHA256=%s" % pin,
        "# APPROVERS=huangxuesongvip@163.com",
        "# PATTERNS-BEGIN"] + patterns + ["# PATTERNS-END", ""]
open(sys.argv[1], "w", encoding="utf-8").write("\n".join(body))
PY
(
  cd "$G" || exit 1
  cp "$GLIST" .gitea/protected-files.txt
  mkdir -p files deep/x q
  printf 'v1\n' > files/a.sh
  printf 'v1\n' > deep/x/y.sh
  printf 'v1\n' > q/check-a.sh
  printf 'v1\n' > q/check-ab.sh
  git add -A && git commit -qm "g1: 清单＋样本"
) || no "沙箱 G base 提交失败"
G_PREV="$(cd "$G" && git rev-parse HEAD)"
GLOB_OK=0; GLOB_TOTAL=4; GLOB_DETAIL=""

g_step() { # $1=提交说明 ⇒ echo 新 HEAD；无实际变更 ⇒ 返回 1（禁空提交静默过关）
  local _before _after
  _before="$(cd "$G" && git rev-parse HEAD)" || return 1
  ( cd "$G" || exit 1; git add -A && git commit -qm "$1" ) || return 1
  _after="$(cd "$G" && git rev-parse HEAD)" || return 1
  [ "$_before" != "$_after" ] || return 1
  printf '%s\n' "$_after"
}
g_case() { # $1=标签 $2=期望 rc $3=实际 rc $4=受保护变更数
  if [ "$3" -eq "$2" ]; then
    GLOB_OK=$((GLOB_OK + 1))
  else
    GLOB_DETAIL="${GLOB_DETAIL}${1}:期望${2}/实际${3};"
  fi
}
# (a) `*` 不跨 `/`：files/sub/new.sh 不命中 files/*.sh ⇒ 0
( cd "$G" || exit 1; mkdir -p files/sub; printf 'v1\n' > files/sub/new.sh ) || no "G (a) 写文件失败"
G_CUR="$(g_step 'g2: files/sub/new.sh')" || no "G (a) 提交失败"
run_gate "$G" --changed-base "$G_PREV"
GA_RC=$RC; GA_PROT=$(printf '%s' "$OUT" | grep -o '受保护路径变更 [0-9]* 条' | grep -o '[0-9]*' | head -1)
g_case "*不跨/" 0 "$GA_RC" "${GA_PROT:-?}"; G_PREV="$G_CUR"
# (b) `**` 跨目录：deep/x/y.sh 命中 deep/** ⇒ 1
( cd "$G" || exit 1; printf 'v2\n' > deep/x/y.sh ) || no "G (b) 写文件失败"
G_CUR="$(g_step 'g3: deep/x/y.sh')" || no "G (b) 提交失败"
run_gate "$G" --changed-base "$G_PREV"
GB_RC=$RC; GB_PROT=$(printf '%s' "$OUT" | grep -o '受保护路径变更 [0-9]* 条' | grep -o '[0-9]*' | head -1)
g_case "**跨目录" 1 "$GB_RC" "${GB_PROT:-?}"; G_PREV="$G_CUR"
# (c) 大小写不敏感：Q/CHECK-C.SH 命中 q/check-?.sh ⇒ 1
#     🔴 文件名必须避开"已有同名小写文件"——macOS APFS 默认大小写不敏感，否则写不出新路径。
( cd "$G" || exit 1; mkdir -p Q; printf 'v1\n' > Q/CHECK-C.SH ) || no "G (c) 写文件失败"
G_CUR="$(g_step 'g4: Q/CHECK-C.SH')" || no "G (c) 提交失败"
run_gate "$G" --changed-base "$G_PREV"
GC_RC=$RC; GC_PROT=$(printf '%s' "$OUT" | grep -o '受保护路径变更 [0-9]* 条' | grep -o '[0-9]*' | head -1)
g_case "大小写不敏感" 1 "$GC_RC" "${GC_PROT:-?}"; G_PREV="$G_CUR"
# (d) `?` 单字符：q/check-ab.sh（两字符）不命中 q/check-?.sh ⇒ 0
( cd "$G" || exit 1; printf 'v2\n' > q/check-ab.sh ) || no "G (d) 写文件失败"
G_CUR="$(g_step 'g5: q/check-ab.sh')" || no "G (d) 提交失败"
run_gate "$G" --changed-base "$G_PREV"
GD_RC=$RC; GD_PROT=$(printf '%s' "$OUT" | grep -o '受保护路径变更 [0-9]* 条' | grep -o '[0-9]*' | head -1)
g_case "?单字符" 0 "$GD_RC" "${GD_PROT:-?}"; G_PREV="$G_CUR"
if [ "$GLOB_OK" -eq "$GLOB_TOTAL" ]; then
  ok "glob 语义: ${GLOB_OK}/${GLOB_TOTAL}（*不跨/${GA_PROT:-?} ｜ **跨目录/${GB_PROT:-?} ｜ 大小写/${GC_PROT:-?} ｜ ?单字符/${GD_PROT:-?} 受保护变更数）"
else
  no "glob 语义: ${GLOB_OK}/${GLOB_TOTAL} 子断言通过（明细: ${GLOB_DETAIL:-无}）"
fi

# ── T15 豁免解析显式排除 README.md ─────────────────────────────────────────
S7="$TMPD/s7"
mk_repo "$S7" || no "沙箱 S7 初始化失败"
(
  cd "$S7" || exit 1
  cp "$MANIFEST" .gitea/protected-files.txt
  printf '#!/bin/bash\necho base\n' > scripts/pre-commit-check.sh
  git add -A && git commit -qm "s7-base"
) || no "沙箱 S7 base 提交失败"
S7_BASE="$(cd "$S7" && git rev-parse HEAD)"
(
  cd "$S7" || exit 1
  printf '#!/bin/bash\necho readme-only\n' > scripts/pre-commit-check.sh
  printf '# 只写在 README 里（不应生效）\n\n- scripts/pre-commit-check.sh — 看起来合规 — CTO-2026-10-18-裁009\n' \
    > gate-exemptions/README.md
  git add -A
  git -c user.email=huangxuesongvip@163.com -c user.name=synova commit -qm "豁免只写在 README（批准人提交）"
) || no "沙箱 S7 README 提交失败"
run_gate "$S7" --changed-base "$S7_BASE"
T15COVER=$(printf '%s' "$OUT" | grep -c '受保护路径有合规豁免' | tr -d '\n\r' || true)
T15READMESKIP=$(printf '%s' "$OUT" | grep -c '无合规豁免' | tr -d '\n\r' || true)
if [ "$RC" -eq 1 ] && [ "${T15COVER:-0}" -eq 0 ] && [ "${T15READMESKIP:-0}" -ge 1 ]; then
  ok "边界: 仅 README.md 声明豁免 → exit ${RC}（README 被排除：合规命中=${T15COVER}, 无豁免命中=${T15READMESKIP}）"
else
  no "边界: README.md 不应充当豁免，实际 exit ${RC}, 合规命中=${T15COVER:-0}, 无豁免命中=${T15READMESKIP:-0}"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
