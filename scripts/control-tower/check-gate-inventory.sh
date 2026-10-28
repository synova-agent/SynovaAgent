#!/usr/bin/env bash
# D313/D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-inventory.sh — 门禁三分类登记校验（#1089 / W1）
#
# 设计哲学（一句）: **每个门禁都必须有一条可判的"账"（谁负责／哪一类／何时复核／
#                    是否真在强制腿上）；账与盘上件必须双向对齐 —— 少一条 = 漂移，多一条 = 幽灵。**
#
# 背景（2026-10-28 实测）:
#   `docs/authority/GATE-INVENTORY.yaml` 已有 952 行（锚 6e5f321 / checkers 32），
#   但 class/owner/review_after/entrypoint/required_ci **五字段零存在**；且盘上
#   `scripts/control-tower/{check,verify}-*` 已长到 **36 件**（+4 未入册），
#   在册的 `check-citations.py` 已不在盘上（幽灵行）。本器把这三件事变成一次三态判定。
#
# 契约（铁律 47）:
#   @usage  bash scripts/control-tower/check-gate-inventory.sh [--inventory <file>]
#             [--root <dir>] [--json] [--help]
#   @input  默认 <root>/docs/authority/GATE-INVENTORY.yaml 的 `classification:` 段；
#           盘上件枚举面 = <root>/scripts/control-tower/{check,verify}-*.{sh,py,ts,js}；
#           required_ci 真值面 = .gitea/workflows/*.yml ＋ scripts/pre-commit-check.sh
#                                ＋ scripts/pre-push-check.sh
#           环境: SYNO_P0_FLOOR（P0 棘轮下限，默认 8）
#   @output 逐项 ✅/❌（点名 id 与原因）＋ 末行 `结果: N 通过, M 失败`
#           ＋ 机器行 `GATE-INVENTORY: OK` | `GATE-INVENTORY: VIOLATION n` | `GATE-INVENTORY: DEGRADED <code>`
#   @exit   0 = 全部合格 ｜ 1 = 有违规（字段非法／覆盖缺口／幽灵行／required_ci 自相矛盾／P0 低于棘轮）
#           2 = 判不了（清单缺失·不可读·**零条目**·classification 段缺失·python3 不可用）
#           🔴 三态铁律：2 绝不等于通过（信号量==0 ⇒ exit 2）
#           🔴 归一入口（#1112 / W6 接线）：判据子进程的原始退出码一律经 `gate-assert.sh` 的 `ga_run`
#           归一（`ga_normalize_code` 是唯一真源）⇒ 128／137／126／白名单外码**不会原样穿透**成本器
#           退出码，一律归 2 并打 `判据故障: <code>`；本器自身无第二份「码 → 三态」表。
#   @degraded stderr `degraded: <CODE> — <原因>` ＋ 追加 JSON 到 SYNO_GATE_DEGRADED_LOG
#           （time/component/code/phase/retryable；铁律 11/32）
#   @error  code ∈ {E_USAGE, E_NO_PYTHON, E_INV_MISSING, E_SECTION_MISSING, E_EMPTY, E_INTERNAL}
#
# 判据（P0 口径 = 创始人规格 §2：权限/隔离/Secrets/fail-closed/凭证/豁免与白名单保护；
#   P1 = 质量类（类型/参数/错误/枚举/并发/强制力）；P2 = 文书类）:
#   ① 逐件有分类 ≥1；id/class/owner/review_after/entrypoint/required_ci 六字段齐全
#   ② class ∈ {P0,P1,P2}；review_after = YYYY-MM-DD；entrypoint 在盘
#   ③ 双向对齐：盘上件全部入册（防漂移）＋ 在册 entrypoint 全部在盘（防幽灵）
#   ④ required_ci 与真值一致：true ⇔ 三条强制腿里有引用；false ⇔ 一处都没有（防自相矛盾）
#   ⑤ P0 棘轮：P0 计数 < SYNO_P0_FLOOR ⇒ 红（**降级需裁定号改这行，禁静默下调**）
#
# 授权（explicit authority）: P4/CTO 手跑 ／ CI 腿（只读）。只读：不写任何被检文件；
#   唯一落盘 = 降级日志（.codex/ 不入库）。
# 已知限制（Known Limitations）:
#   1. 只校验 `control-tower` 域的 check/verify 件；`scripts/*.sh`（如 check-secrets）与
#      pre-commit 13 组不在本器枚举面（另账，防一次吞掉半个仓库）。
#   2. P0 棘轮只管**计数**不管 **id**：把 A 件 P0 改成 P1、同时把 B 件 P1 改成 P0 可绕过计数
#      （id 级降级追踪需 history，本批不做）；故本器只保证"P0 面不会整体缩水"。
#   3. required_ci 真值只认三处配置文本：动态调用（CI 内部循环派生）会漏判为 false。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT=""; INV=""; JSON=0; P0_FLOOR="${SYNO_P0_FLOOR:-8}"
while [ $# -gt 0 ]; do
  case "$1" in
    --inventory) INV="${2:-}"; shift 2 ;;
    --root)      ROOT="${2:-}"; shift 2 ;;
    --json)      JSON=1; shift ;;
    -h|--help)   sed -n '2,53p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done
[ -z "$ROOT" ] && ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"  # swallow-ok: 失败由下一行显式 exit 2
[ -n "$ROOT" ] || { echo "❌ 非 git 仓库（且未给 --root）" >&2; exit 2; }
[ -n "$INV" ] || INV="$ROOT/docs/authority/GATE-INVENTORY.yaml"
DEG_LOG="${SYNO_GATE_DEGRADED_LOG:-$ROOT/.codex/control-tower/logs/degraded-events.log}"

degraded() { # <CODE> <reason>
  echo "degraded: $1 — $2" >&2
  if mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null; then  # swallow-ok: 目录不可建走 else 显式提示，不吞
    printf '{"time":"%s","component":"check-gate-inventory","code":"%s","phase":"resolve","retryable":true}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$DEG_LOG" 2>/dev/null || true  # swallow-ok: 日志写失败不改判定
  else
    echo "degraded: 降级日志目录不可建（$DEG_LOG）" >&2
  fi
  echo "GATE-INVENTORY: DEGRADED $1"
  exit 2
}

PYBIN="$(command -v python3 2>/dev/null)"  # swallow-ok: 缺失由下一行显式 degraded exit 2；D520 平台敏感命令经 PYBIN 间接调用
[ -n "$PYBIN" ] || degraded E_NO_PYTHON "python3 不在 PATH"
[ -f "$INV" ] || degraded E_INV_MISSING "清单不存在: $INV"
[ -r "$INV" ] || degraded E_INV_MISSING "清单不可读: $INV"

# ── 🔴 判不了归 2：归一入口（#1112 / W6 接线）─────────────────────────────────
# 判据子进程的原始退出码**一律**交给 `ga_run` 归一：0 透传／1 透传／2 透传，
# 128／137／126／白名单外码 ⇒ 2 并打 `判据故障: <code>`（禁原样穿透成本器退出码）。
# 归一真源 = 邻件 gate-assert.sh（禁在本器抄第二份 case）；库缺失 ⇒ 判不了 ⇒ 2（fail-closed）。
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"  # swallow-ok: 取不到时下一行按「库缺失」degraded exit 2
GA_LIB="${LIB_DIR:+$LIB_DIR/gate-assert.sh}"
{ [ -n "$GA_LIB" ] && [ -f "$GA_LIB" ]; } || degraded E_INTERNAL "判据归一库缺失（判不了 ⇒ 2）: ${GA_LIB:-<脚本目录不可解析>}"
# shellcheck source=scripts/control-tower/gate-assert.sh
. "$GA_LIB" || degraded E_INTERNAL "判据归一库不可载入（判不了 ⇒ 2）: $GA_LIB"

OUT="$(ga_run "check-gate-inventory" -- "$PYBIN" - "$INV" "$ROOT" "$P0_FLOOR" "$JSON" <<'PYEOF'
import glob, json, os, re, sys
inv_path, root, floor_s, json_mode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1"
viol, ok = [], []

def v(code, msg):
    viol.append((code, msg))

try:
    with open(inv_path, encoding="utf-8") as f:
        lines = f.read().splitlines()
except OSError as e:
    print("E_INV_MISSING: 清单不可读 (%s)" % e); sys.exit(2)

# ── 抽取 classification 段（纯追加段；到下一个顶格 key 为止）────────────────
start = next((i for i, ln in enumerate(lines) if re.match(r"^classification:\s*$", ln)), None)
if start is None:
    print("E_SECTION_MISSING: 清单无 classification: 段"); sys.exit(2)
block = []
for ln in lines[start + 1:]:
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*:", ln):
        break
    block.append(ln)

entries, cur = [], None
for idx, ln in enumerate(block, 1):
    m = re.match(r"^\s+-\s+id:\s*(.*)$", ln)
    if m:
        cur = {"id": m.group(1).strip().strip('"'), "_line": idx}
        entries.append(cur); continue
    m = re.match(r"^\s+([A-Za-z_]+):\s*(.*)$", ln)
    if m and cur is not None:
        cur[m.group(1)] = m.group(2).strip().strip('"')
if not entries:
    print("E_EMPTY: classification 段零条目（信号量==0 ⇒ 判不了，禁当通过）"); sys.exit(2)

DISC = os.path.join(root, "scripts", "control-tower")
disk, perr = set(), []
for pat in ("check-*.sh", "check-*.py", "check-*.ts", "check-*.js",
            "verify-*.sh", "verify-*.py", "verify-*.ts", "verify-*.js"):
    for p in glob.glob(os.path.join(DISC, pat)):
        disk.add(os.path.basename(p))
if not disk:
    print("E_EMPTY: 盘上无 check/verify 件（枚举面为空 ⇒ 判不了）"); sys.exit(2)

# ── required_ci 真值面 ────────────────────────────────────────────────────
truth_src = []
for p in glob.glob(os.path.join(root, ".gitea", "workflows", "*.yml")) + [
        os.path.join(root, "scripts", "pre-commit-check.sh"),
        os.path.join(root, "scripts", "pre-push-check.sh")]:
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            truth_src.append(f.read())
    except OSError:
        perr.append(p)
truth = "\n".join(truth_src)

seen_id, seen_ep, p0 = set(), set(), 0
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
for e in entries:
    eid, ep, cls = e.get("id", ""), e.get("entrypoint", ""), e.get("class", "")
    base = os.path.basename(ep) if ep else ""
    stem = os.path.splitext(base)[0]
    if not eid:
        v("R1", "第 %s 条缺 id" % e.get("_line")); continue
    if eid in seen_id:
        v("R1", "%s 重复登记" % eid)
    seen_id.add(eid)
    if cls not in ("P0", "P1", "P2"):  # @mutate-point: class
        v("R2", "%s class 非法: %r（只许 P0/P1/P2）" % (eid, cls))
    if cls == "P0":
        p0 += 1
    if not e.get("owner", "").strip():
        v("R2", "%s owner 为空" % eid)
    if not DATE.match(e.get("review_after", "")):
        v("R2", "%s review_after 非 YYYY-MM-DD: %r" % (eid, e.get("review_after")))
    if not ep:
        v("R2", "%s entrypoint 为空" % eid)
    elif not os.path.isfile(os.path.join(root, ep)):
        v("R3", "%s entrypoint 在盘不存在（幽灵行）: %s" % (eid, ep))
    if ep in seen_ep:
        v("R1", "%s entrypoint 重复: %s" % (eid, ep))
    seen_ep.add(ep)
    if base and eid not in ("CT-" + stem, "CT-" + base):
        v("R2", "%s id 与 entrypoint 不匹配（应 CT-%s 或 CT-%s）" % (eid, stem, base))
    rc = e.get("required_ci", "").lower()
    if rc not in ("true", "false"):
        v("R2", "%s required_ci 非布尔: %r" % (eid, rc))
    elif base:
        referenced = base in truth
        if rc == "true" and not referenced:
            v("R4", "%s 声明 required_ci=true 但三条强制腿零引用（自相矛盾）" % eid)
        if rc == "false" and referenced:
            v("R4", "%s 声明 required_ci=false 但真被 CI/提交腿引用（账实不符）" % eid)

# ── 双向对齐 ─────────────────────────────────────────────────────────────
seen_base = {os.path.basename(ep) for ep in seen_ep if ep}
for f in sorted(disk - seen_base):
    v("R3", "盘上件未入册（漂移）: %s" % f)
for ep in sorted(seen_ep):
    if ep and os.path.basename(ep) not in disk:
        v("R3", "在册件不在枚举面: %s" % ep)

# ── P0 棘轮 ──────────────────────────────────────────────────────────────
try:
    floor = int(floor_s)
except ValueError:
    floor = 8
if p0 < floor:
    v("R5", "P0 计数 %d < 棘轮下限 %d（P0 降级需裁定号并显式下调 SYNO_P0_FLOOR）" % (p0, floor))

print("── 门禁三分类登记校验（#1089 / W1）──")
print("清单: %s" % inv_path)
print("条目 %d ／ 盘上件 %d ／ P0 %d（下限 %d）" % (len(entries), len(disk), p0, floor))
if perr:
    print("⚠️  真值面缺失 %d 件（required_ci 判定可能偏严）：%s" % (len(perr), ", ".join(os.path.basename(x) for x in perr)))
for code, msg in viol:
    print("  ❌ [%s] %s" % (code, msg))
if not viol:
    print("  ✅ 六字段齐全／双向对齐／required_ci 账实一致／P0 棘轮未破")
print("结果: %d 通过, %d 失败" % (len(entries) - 0 if not viol else 0, len(viol)))
if json_mode:
    print(json.dumps({"entries": len(entries), "disk": len(disk), "p0": p0,
                      "violations": [{"code": c, "msg": m} for c, m in viol]}, ensure_ascii=False))
print("GATE-INVENTORY: OK" if not viol else "GATE-INVENTORY: VIOLATION %d" % len(viol))
sys.exit(0 if not viol else 1)
PYEOF
)"
RC=$?
printf '%s\n' "$OUT"
if [ "$RC" -eq 2 ]; then
  CODE="$(printf '%s' "$OUT" | grep -oE 'E_[A-Z_]+' | head -1)"
  echo "degraded: ${CODE:-E_INTERNAL} — 见上（判不了 ≠ 通过；经 gate-assert 归一后三态=2，原码点名见 stderr「判据故障」行）" >&2
  if mkdir -p "$(dirname "$DEG_LOG")" 2>/dev/null; then  # swallow-ok: 目录不可建已由上方 stderr 可见
    printf '{"time":"%s","component":"check-gate-inventory","code":"%s","phase":"parse","retryable":true}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${CODE:-E_INTERNAL}" >> "$DEG_LOG" 2>/dev/null || true  # swallow-ok: 日志失败不改判定
  fi
  exit 2
fi
# RC 已由 ga_run 归一到 {0,1,2}（128/137/126/白名单外码不会走到这里）⇒ 原样透传三态
exit "$RC"
