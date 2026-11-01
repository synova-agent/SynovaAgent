#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-notes-lifecycle.sh — D472 Agent Notes 四态生命周期迁移门禁
#
# 契约（铁律 47 — 契约优先，先定义再实现）:
#   @input  — 无参数；扫描 $ROOT/memory/notes/proposed/
#             注入缝: ROOT / TASK_STATE_DIR / SYNO_NOTES_DIR / SYNO_NOTES_TIMEOUT（秒，默认 30）
#   @output — 僵尸 proposed 清单（实现已落地但未 git mv）+ 修复指引；
#             迁移期"无 task-state 卡"的条目逐条打印（可见，不阻断）
#   @exit   — 0 = 无僵尸 ｜ 1 = 有僵尸（阻断）｜ 2 = **判不了**（缺 python／超时／目录不可读）
#             🔴 2 绝不等于通过（三态铁律）
#   @degraded — E_NO_PYTHON / E_TIMEOUT / E_INTERNAL / 目录不可读 → exit 2 + stderr `degraded: <code> — <原因>`
#
# 僵尸判定（D472 修正 — 兼容现有 Note 双格式头，保守不误杀）:
#   ① 提取 D#：优先中文头 "任务: DXXX" / "相关 D#: DXXX"；
#      兼容英文头（check-lessons-learned 写入）: name:/class:/description: 中匹配 D\d+
#   ② 判定：提取到 D# 且 task-state/D#.json 存在且 status ∈ {impl_done, spec_done}
#      （实现已落地）→ 判定"实现已落地，提案未迁移"→ 列僵尸清单
#   ③ 其余（无 D# 引用 / D# 未 impl/未 spec）→ 视为真实进行中提议，不阻断（放行）
#
# 设计哲学: 迁移是人的决策（提案是否落地/否决），脚本只检查+阻断，不替人判断。
#
# ═══ #1253（2026-11-01 · P0 · 裁定 429-E）═══
# 原实现**逐文件 spawn 子进程**（每文件 6 次 grep/head）：本机 219 条 note ⇒ 约 1300 次进程启动，
# 实测 90 s 未跑完（bash -x trace 45 s 仅处理 18 个文件），把每次 commit 拖到分钟级 ——
# 而本脚本头自己写的是「保持 <1s」。⇒ 改为**一次 python 进程**解析全部文件（O(1) 进程），并补：
#   ① `timeout` 兜底（默认 30 s）：超时 ⇒ exit 2 + `degraded: E_TIMEOUT`（禁挂死、禁静默 0）；
#   ② 缺 python ⇒ exit 2 + `degraded: E_NO_PYTHON`（禁把"看不见"当"没问题"）。
# 判据：`bash tests/control-tower/check-notes-lifecycle.test.sh`（含**性能回归**与**超时降级**两态）。
# 已知限制：`timeout` 不在 PATH 时退化为裸跑（不挂死逻辑，但极端慢机可能变慢）；Windows 上
#          `timeout` 由 Git for Windows coreutils 提供，CI（mac）自带。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
NOTES_DIR="${SYNO_NOTES_DIR:-$ROOT/memory/notes}"
TASK_STATE_DIR="${TASK_STATE_DIR:-$ROOT/task-state}"
PROPOSED_DIR="$NOTES_DIR/proposed"
NOTES_TIMEOUT="${SYNO_NOTES_TIMEOUT:-30}"

# ── 目录可读性检查（铁律 24: 显式降级，不静默）──
if [ ! -d "$PROPOSED_DIR" ]; then
  echo "✅ [notes-lifecycle] proposed/ 不存在 — 跳过"
  exit 0
fi
if [ ! -d "$TASK_STATE_DIR" ]; then
  echo "degraded: 目录不可读 — task-state/ 不存在: $TASK_STATE_DIR" >&2
  exit 2
fi

# ── PYBIN 三级探测（D520: 不裸 spawn python3；先 command -v ＋ 可用性验证）──
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then
    PYBIN="$_c"; break
  fi
done
if [ -z "$PYBIN" ]; then
  echo "degraded: E_NO_PYTHON — python3/python/py 均不可用，判不了（禁当通过）" >&2
  exit 2
fi

# ── 核心：一次进程解析全部（#1253）──
read -r -d '' _CORE <<'PYCORE'
import json, os, re, sys

proposed, task_state, root = sys.argv[1], sys.argv[2], sys.argv[3]
RE_ZH = re.compile(r"任务: *D[0-9]+|相关 ?D#: *D[0-9]+|相关 ?D# *D[0-9]+")
RE_EN = re.compile(r"^(name|class|description): *[^ ]*D[0-9]+", re.M)
RE_D = re.compile(r"D[0-9]+")
RE_STATUS = re.compile(r'"status"\s*:\s*"([^"]+)"')

try:
    names = sorted(n for n in os.listdir(proposed) if n.endswith(".md"))
except OSError as e:
    print("degraded: 目录不可读 — proposed/ 无法枚举: %s" % e, file=sys.stderr)
    sys.exit(2)

unregistered, zombies = [], []
for name in names:
    if name == "MEMORY.md":
        continue
    path = os.path.join(proposed, name)
    if not os.path.isfile(path):
        continue
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            txt = f.read()
    except OSError:
        continue
    m = RE_ZH.search(txt) or RE_EN.search(txt)
    if not m:
        continue
    dm = RE_D.search(m.group(0))
    if not dm:
        continue
    did = dm.group(0)
    state_file = os.path.join(task_state, did + ".json")
    if not os.path.isfile(state_file):
        unregistered.append(path)
        continue
    status = ""
    try:
        with open(state_file, encoding="utf-8", errors="replace") as f:
            raw = f.read()
        try:
            status = str(json.loads(raw).get("status", ""))
        except Exception:
            mm = RE_STATUS.search(raw)  # 与旧 grep 行为等价的兜底
            status = mm.group(1) if mm else ""
    except OSError:
        status = ""
    if status in ("impl_done", "spec_done"):
        zombies.append((path, did))

if unregistered:
    print("[迁移期] %d 条 proposed Note 的 D# 无 task-state 卡（旧 D# 卡只读；新任务声明在 .claude/claims/）" % len(unregistered))
    print('           ⇒ 僵尸判定对这批条目**未生效**（不是"通过"，是"无判据对象"）。')
    for p in unregistered:
        print("            - " + p.replace("\\", "/"))

if zombies:
    print("")
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  D472 迁移门禁: proposed/ 存在僵尸条目（实现已落地未迁移）     ║")
    print("╠══════════════════════════════════════════════════════════════╣")
    prefix = root.rstrip("/") + "/"
    for p, did in zombies:
        rel = p[len(prefix):] if p.startswith(prefix) else p
        print("║  📋 %s (D#: %s)" % (rel, did))
    print("╠══════════════════════════════════════════════════════════════╣")
    print("║  修复: 若提案已落地 → git mv 到 implemented/ 并更新头字段     ║")
    print("║        若提案已否决 → git mv 到 rejected/                     ║")
    print("║        若确为测试残留 → 删除该文件                            ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print("")
    print("[notes-lifecycle] ❌ %d 个僵尸条目 — 迁移门禁阻断" % len(zombies))
    sys.exit(1)

print("✅ [notes-lifecycle] proposed/ 无僵尸条目")
sys.exit(0)
PYCORE

if command -v timeout >/dev/null 2>&1; then
  OUT="$(timeout "$NOTES_TIMEOUT" "$PYBIN" -c "$_CORE" "$PROPOSED_DIR" "$TASK_STATE_DIR" "$ROOT" 2>&1)"
  RC=$?
else
  OUT="$("$PYBIN" -c "$_CORE" "$PROPOSED_DIR" "$TASK_STATE_DIR" "$ROOT" 2>&1)"
  RC=$?
fi

[ -n "$OUT" ] && printf '%s\n' "$OUT"

case "$RC" in
  0|1) exit "$RC" ;;
  124|137)
    echo "degraded: E_TIMEOUT — notes 生命周期门禁超过 ${NOTES_TIMEOUT}s 未返回（判不了，禁当通过）" >&2
    exit 2 ;;
  *)
    echo "degraded: E_INTERNAL — 扫描失败（rc=$RC）" >&2
    exit 2 ;;
esac
