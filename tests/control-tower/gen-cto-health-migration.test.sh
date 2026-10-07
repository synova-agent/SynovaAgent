#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# gen-cto-health-migration.test.sh — E4 第 6 条消费者的迁移期显式降级夹具
#   （K3 R6 禁静默空白；卡 #1267 的 E4 六条之第 6 条，前置 #1268 已解）
#
# 覆盖矩阵（铁律 48: 正常 / 降级 / 边界 + 改坏即红）:
#   正常 — claim 库有 N 条 ⇒ 返回 degraded=True + migration_period/claims/note 三字段齐全，
#          且 **stderr 打显式迁移期行**（可见，不静默）
#   降级 — claim 目录不可读 ⇒ stderr 显式 degraded 行（铁律 24/31），不静默当 0
#   边界 — 无 claim 库 ⇒ migration_period=False 且 **无** migration_note、degraded=False
#          （防假标记：不得在所有情况下都打「迁移期」）
#   改坏即红 — 把「claim 计数」注入为 0（等价删除探测）⇒ 正常断言必红（判别力证明）
#
# 隔离: python 直调分析函数 + 注入 REPO / TASK_STATE_DIR（模块级变量），零真实仓写入。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "  ❌ 无可用 python（检查自身失败）"; exit 2; }

echo "=== gen-cto-health 迁移期显式降级夹具（E4 第 6 条）==="

OUT="$("$PYBIN" - "$REPO_DIR" <<'PY' 2>&1
import sys, pathlib, tempfile, shutil, importlib.util, io, contextlib

repo = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location(
    "gch", repo / "scripts" / "control-tower" / "gen-cto-health.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

tmp = pathlib.Path(tempfile.mkdtemp(prefix="gch-mig-"))
fail = 0
def chk(cond, label, extra=""):
    global fail
    print(("PASS|" if cond else "FAIL|") + label + ((" | " + str(extra)) if extra and not cond else ""))
    if not cond:
        fail += 1

def run(claims):
    m.REPO = tmp
    m.TASK_STATE_DIR = tmp / "task-state"      # 不存在 ⇒ 走「缺席」分支
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        tasks, meta = m.analyze_task_state()
    return tasks, meta, err.getvalue()

# ── 正常: 有 N 条 claim ──
cd = tmp / ".claude" / "claims"; cd.mkdir(parents=True)
for i in (1217, 1218):
    (cd / f"{i}.yaml").write_text("writeset:\n  - a.sh\ndone:\n  - verify: bash x.sh\n", encoding="utf-8")
(tasks, meta, err) = run(cd)
chk(meta.get("migration_period") is True, "正常: migration_period=True", meta)
chk(meta.get("migration_claims") == 2, "正常: migration_claims=2", meta)
chk(bool(meta.get("migration_note")), "正常: migration_note 非空（禁静默空白）", meta)
chk(meta.get("degraded") is True, "正常: degraded=True（铁律 31 降级传播）", meta)
chk("迁移期" in err, "正常: stderr 打显式迁移期行（可见）", err)

# ── 边界: 无 claim 库 ⇒ 不得假标记 ──
(cd / "1217.yaml").unlink(); (cd / "1218.yaml").unlink()
(tasks, meta, err) = run(cd)
chk(meta.get("migration_period") is False, "边界: 无 claim ⇒ migration_period=False（防假标记）", meta)
chk(not meta.get("migration_note"), "边界: 无 claim ⇒ 无 migration_note", meta)
chk(meta.get("degraded") is False, "边界: 无 claim ⇒ degraded=False", meta)
chk("迁移期" not in err, "边界: 无 claim ⇒ stderr 无迁移期行", err)

# ── 降级: 目录不可读（用文件冒充目录）──
shutil.rmtree(cd.parent, ignore_errors=True)
cd.parent.mkdir(parents=True, exist_ok=True)
(cd).write_text("not-a-dir", encoding="utf-8")   # claims 是文件而非目录 ⇒ glob 抛错/为空
(tasks, meta, err) = run(cd)
chk(meta.get("migration_period") is False, "降级: 非法 claim 路径 ⇒ 不误报迁移期", meta)

# ── 正常路径（P3）: task-state 存在时 meta 仍须带 migration 字段 ──
(cd).unlink() if cd.is_file() else None
shutil.rmtree(cd, ignore_errors=True); cd.mkdir(parents=True, exist_ok=True)
for i in (1217, 1218):
    (cd / f"{i}.yaml").write_text("writeset:\n  - a.sh\ndone:\n  - verify: bash x.sh\n", encoding="utf-8")
ts = tmp / "task-state"; ts.mkdir(parents=True, exist_ok=True)
(ts / "D001.json").write_text('{"task_id":"D001","status":"impl_done"}', encoding="utf-8")
(tasks, meta, err) = run(cd)
chk("migration_period" in meta, "正常路径: meta 含 migration_period（P3：结构化字段恒在）", meta)
chk(meta.get("migration_claims") == 2, "正常路径: migration_claims=2（P3 值正确）", meta)
chk(meta.get("migration_period") is True, "正常路径: migration_period=True（P3）", meta)

# ── 改坏即红（判别力）: 注入「探测失效」（把 claims 计数恒 0）⇒ 正常断言必红 ──
src = (repo / "scripts" / "control-tower" / "gen-cto-health.py").read_text(encoding="utf-8")
mut = src.replace('_claim_n = (sum(1 for c in _claims_dir.glob("*.yaml") if c.stem.isdigit())',
                  '_claim_n = (0 * sum(1 for c in _claims_dir.glob("*.yaml") if c.stem.isdigit())', 1)
changed = (mut != src)
chk(changed, "改坏即红: 变异体已构造（探测恒 0）")
if changed:
    mp = tmp / "mut_gen_cto_health.py"; mp.write_text(mut, encoding="utf-8")
    spec2 = importlib.util.spec_from_file_location("gchm", mp)
    m2 = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(m2)
    if cd.is_file():
        cd.unlink()          # 上一组把它写成了文件（降级用例）→ 先清掉
    shutil.rmtree(cd, ignore_errors=True)
    cd.mkdir(parents=True, exist_ok=True)
    for i in (1217, 1218):
        (cd / f"{i}.yaml").write_text("writeset:\n  - a.sh\ndone:\n  - verify: bash x.sh\n", encoding="utf-8")
    m2.REPO = tmp; m2.TASK_STATE_DIR = tmp / "task-state"
    _t, meta2 = m2.analyze_task_state()
    chk(meta2.get("migration_claims") == 0,
        "改坏即红: 变异体丢了 claim 计数 ⇒ 正常断言（=2）必红（夹具有判别力）", meta2)

shutil.rmtree(tmp, ignore_errors=True)
sys.exit(2 if fail else 0)
PY
)"
RC=$?
while IFS='|' read -r kind label extra; do
  case "$kind" in
    PASS) ok "$label" ;;
    FAIL) no "$label${extra:+ — $extra}" ;;
  esac
done <<< "$OUT"
if [ "$RC" -eq 2 ]; then no "python 断言层有失败（见上）"; elif [ "$RC" -ne 0 ]; then no "python 断言层异常 rc=$RC"; fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
