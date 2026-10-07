#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# tag-bypass-wiring.test.sh — D331 D329 审计 P1 修复测试
#
# 五合一: tag-祖先校验 + bypass 对账 + 呈报段 PYBIN + --session 能力保留 + write-set task_id
# 🔴 D1223（2026-10-07）: 暂存区隔离件 staging_guard.py 退役 —— 用例 6/7/8/9/11 的 SUT 随迁:
#   6/7/8 改测 synova-commit 的**只读归属呈报段**（同一 PYBIN 三级探测 + 显式降级语义）；
#   9 从「--session 生产调用点 ≥1」改为「能力保留（可调用）」——其原唯一生产调用方即退役件；
#     生产接线断言移到 claim 单源（tests/control-tower/staging-guard-retirement.test.sh:R4）；
#   11 从「消费侧同任务互认」改为**生产者侧** task_id 继承不变量。
# 覆盖（铁律 48: 正常/降级/边界; 铁律 0-2: red→green 已证）:
#   1. 孤儿 tag（非 HEAD 祖先）→ pre-push 硬阻断 exit 1（red: 无检查 → exit 0）
#   2. VERSION.md 最新版本 tag 非祖先 → exit 1
#   3. bypass 对账: 新提交缺记录 → exit 1 + 列出缺失（red: 无脚本 → 127）
#   4. bypass 对账: 记录存在 → exit 0
#   5. bypass 对账 base 边界: 无 base 无 origin → fail-open exit 0 显式跳过;
#      SYNO_BASE_REF 显式不可解析 → exit 1
#   6. synova-commit 呈报段 PYBIN 回退: python3 缺失 → shim python 执行呈报
#      （red: 裸 python3 静默 → 无 shim 调用）
#   7. 呈报段崩溃（非 JSON, rc=3）→ 显式降级提示 + 降级放行（red: || true 吞）
#   8. 全无 python → 显式降级提示（不静默跳过）
#   9. --session **能力保留**（resolve-commit-brief.sh 仍实现该 flag）；生产调用点 0 如实打印
#      （D1223 后原唯一生产调用方已退役；生产接线断言改由 claim 单源夹具承担）
#  10. write-set 条目含 task_id（red: 无 → 断言失败）
#  11. 同任务并行 session 的 task_id 继承（生产者不变量，承接原"不误伤"语义）
#
# 隔离: mktemp -d 临时 repo + git init; SYNO_TAG_ONLY=1 → pre-push 只跑 tag 检查
#       （D319 一致性 + D331 祖先）; SYNO_PRE_COMMIT 指向不存在文件 → synova-commit
#       走降级路径（exit 2 但 commit 成功）; SYNO_BASE_REF 注入对账 base。
# 用法: bash tests/control-tower/tag-bypass-wiring.test.sh
# 退出码: 0 = 全部通过
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRE_PUSH="$REPO_DIR/scripts/pre-push-check.sh"
SYNOVA_COMMIT="$REPO_DIR/scripts/control-tower/synova-commit"
CHECK_BYPASS="$REPO_DIR/scripts/control-tower/check-bypass-log.sh"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
assert_exit() { # <got_exit> <want_exit> <msg>
  if [ "$1" -eq "$2" ]; then pass "$3 (exit=$1)"; else fail "$3 — exit=$1 期望 $2"; fi
}
assert_contains() { # <haystack> <needle> <msg>
  if echo "$1" | grep -qF "$2"; then pass "$3"; else fail "$3 — 未找到: $2"; fi
}

# ── 新建临时 repo（main 分支 + VERSION.md + .claude/）──
new_repo() { # <dir> <version>
  mkdir -p "$1"
  git -C "$1" init -q 2>/dev/null || true
  git -C "$1" config user.name "test" 2>/dev/null || true
  git -C "$1" config user.email "test@test" 2>/dev/null || true
  git -C "$1" checkout -q -b main 2>/dev/null || true
  mkdir -p "$1/.codex/control-tower" "$1/.claude"
  printf '## %s (test)\n' "$2" > "$1/.codex/control-tower/VERSION.md"
}

commit_file() { # <repo> <file> <msg> → CWD 文件提交
  echo "$2" > "$1/$2"
  git -C "$1" add "$2" 2>/dev/null || true
  git -C "$1" commit -q -m "$3" 2>/dev/null || true
}

# ── 孤儿 commit（独立根提交，挂到 tag 上）──
orphan_commit() { # <repo> <tag>
  git -C "$1" checkout -q --orphan orphan-branch 2>/dev/null || true
  echo "o1" > "$1/o1.txt"
  git -C "$1" add o1.txt 2>/dev/null || true
  git -C "$1" commit -q -m "orphan $2" 2>/dev/null || true
  git -C "$1" tag "$2" 2>/dev/null || true
  git -C "$1" checkout -q main 2>/dev/null || true
}

echo "═══════════════════════════════════════════════════════════"
echo "  D331 tag-bypass-wiring 测试 — tag-祖先/bypass 对账/guard PYBIN/接线"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 用例 1: 孤儿 tag → pre-push 硬阻断 exit 1 ──
echo "── 1. 孤儿 tag → pre-push 硬阻断 (exit 1) ──"
R1=$(mktemp -d)
new_repo "$R1" "V4.7.3"
commit_file "$R1" "f0.md" "base"
orphan_commit "$R1" "V8.8.8"
commit_file "$R1" "f1.md" "c1"
git -C "$R1" tag V4.7.3 2>/dev/null || true
set +e
OUT1=$(cd "$R1" && SYNO_TAG_ONLY=1 bash "$PRE_PUSH" 2>&1)
EC1=$?
set -e
# D737 修订: D521/不变量1 起，孤儿 tag（非 HEAD 祖先）属「与本次推送无关」→ **有意豁免不拦**
#   （判据: pre-push-check.sh:189-191 的 D521 注释 + D520 实证「V4.7.1 孤儿 tag 拦死无关分支推送×3」）
#   本用例改为断言「豁免生效」，并在用例 2b 补上真正该拦的路径（防漂移再次无覆盖）
assert_exit "$EC1" 0 "孤儿 tag V8.8.8 → 豁免放行 (D521 现语义)"
assert_contains "$OUT1" "孤儿 tag 已豁免" "输出明示豁免（不静默放过）"
assert_contains "$OUT1" "D331" "输出含 D331 校验标识"
echo ""

# ── 用例 2: VERSION.md 最新版本 tag 非祖先 → exit 1 ──
echo "── 2. 版本 tag 非祖先 → pre-push 硬阻断 (exit 1) ──"
R2=$(mktemp -d)
new_repo "$R2" "V9.9.9"
commit_file "$R2" "f0.md" "base"
orphan_commit "$R2" "V9.9.9"
commit_file "$R2" "f1.md" "c1"
set +e
OUT2=$(cd "$R2" && SYNO_TAG_ONLY=1 bash "$PRE_PUSH" 2>&1)
EC2=$?
set -e
assert_exit "$EC2" 1 "最新版本 V9.9.9 非祖先 → exit 1"
# D737 修订: 现文案为「非 HEAD 祖先」（pre-push-check.sh 的 TAG_FAIL 分支），
#   原断言写的是旧文案「缺失或非祖先」→ 测试漂移的第二处
assert_contains "$OUT2" "非 HEAD 祖先" "输出含「非 HEAD 祖先」提示"
echo ""

# ── 用例 2b (D737 新增): HEAD 祖先 tag **但不在 origin/main 上** → 硬阻断 ──
#   为什么补: 用例 1/2 都在测「孤儿 tag」（D521 起有意豁免）→ 门禁真正要拦的那条路径
#   （未合并分支上打 tag）**此前零覆盖**，这正是漂移能潜伏至今的原因。
echo "── 2b. HEAD 祖先 tag 但不在 origin/main → 硬阻断 (exit 1) ──"
R2B=$(mktemp -d)
new_repo "$R2B" "V7.7.7"
commit_file "$R2B" "f0.md" "base"
git -C "$R2B" update-ref refs/remotes/origin/main HEAD 2>/dev/null || true   # origin/main 停在 base
commit_file "$R2B" "f1.md" "c1"           # HEAD 前进一格 —— base 仍是 HEAD 祖先
git -C "$R2B" tag V7.7.7 2>/dev/null || true   # tag 指向 HEAD（是 HEAD 祖先，但不在 origin/main）
set +e
OUT2B=$(cd "$R2B" && SYNO_TAG_ONLY=1 bash "$PRE_PUSH" 2>&1)
EC2B=$?
set -e
assert_exit "$EC2B" 1 "HEAD 祖先 tag 未上 main → exit 1"
assert_contains "$OUT2B" "不在 origin/main 上" "输出点名「不在 origin/main 上」"
echo ""

# ── 用例 3: bypass 对账 — 新提交缺记录 → exit 1 + 列出 ──
echo "── 3. bypass 对账: 缺失记录 → exit 1 ──"
R3=$(mktemp -d)
new_repo "$R3" "V9.9.9"
commit_file "$R3" "f0.md" "base"
C1=$(git -C "$R3" rev-parse HEAD)
commit_file "$R3" "f1.md" "c2"
C2=$(git -C "$R3" rev-parse HEAD)
echo "2026-08-12T00:00:00+00:00 | COMMITTED | pre-commit PASS | TASK_ID=D331-test | AGENT=test | HASH=$C1" > "$R3/.claude/bypass.log"
set +e
OUT3=$(cd "$R3" && SYNO_BASE_REF="$C1" bash "$CHECK_BYPASS" 2>&1)
EC3=$?
set -e
assert_exit "$EC3" 1 "缺失记录 → exit 1"
assert_contains "$OUT3" "${C2:0:8}" "输出列出缺失提交 ${C2:0:8}"
echo ""

# ── 用例 4: bypass 对账 — 记录存在 → exit 0 ──
echo "── 4. bypass 对账: 记录齐全 → exit 0 ──"
echo "2026-08-12T00:00:00+00:00 | COMMITTED | pre-commit PASS | TASK_ID=D331-test | AGENT=test | HASH=$C2" >> "$R3/.claude/bypass.log"
set +e
OUT4=$(cd "$R3" && SYNO_BASE_REF="$C1" bash "$CHECK_BYPASS" 2>&1)
EC4=$?
set -e
assert_exit "$EC4" 0 "记录齐全 → exit 0"
echo ""

# ── 用例 5: bypass 对账 base 边界 ──
echo "── 5. bypass 对账: base 边界 (fail-closed / 显式错误) ──"
R5=$(mktemp -d)
new_repo "$R5" "V9.9.9"
commit_file "$R5" "f0.md" "base"
echo "dummy" > "$R5/.claude/bypass.log"  # 日志存在（缺失检查先于 base 检查）
set +e
OUT5=$(cd "$R5" && bash "$CHECK_BYPASS" 2>&1)
EC5=$?
set -e
assert_exit "$EC5" 2 "无 base 无 origin → fail-closed exit 2（D414 不静默当通过）"
assert_contains "$OUT5" "对账无法执行" "显式提示含对账无法执行（不静默）"
set +e
# 注: 40 位 hex 会被 rev-parse --verify 只查格式放行 → 用 ref 名测不可解析
OUT5b=$(cd "$R5" && SYNO_BASE_REF="D331-no-such-ref" bash "$CHECK_BYPASS" 2>&1)
EC5b=$?
set -e
assert_exit "$EC5b" 1 "SYNO_BASE_REF 显式不可解析 → exit 1"
echo ""

# ── 用例 6/7/8: synova-commit guard PYBIN 回退 + 崩溃显式降级 ──
# 环境: PATH 剔除 python（python3/python/py 全不可见），shim dir 提供 python
# shim: 探测（-c "import sys"）→ 转真实 python；guard 调用 → 按用例记录/崩溃
SHIM_DIR=$(mktemp -d)
SHIM_MARKER="$SHIM_DIR/guard-ran.marker"
REAL_PY="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || echo '')"
if [ -z "$REAL_PY" ]; then
  fail "用例 6-8 环境: 无真实 python 可用 — 跳过（setup 问题，非被测缺陷）"
else
  # WindowsApps shim 目录重引入 python3 → 用 sys.executable 取真实解释器目录
  REAL_PY_BIN="$("$REAL_PY" -c "import sys; print(sys.executable)" 2>/dev/null || echo "$REAL_PY")"
  REAL_PY_DIR="$(dirname "$REAL_PY_BIN")"
  CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -Eiv 'python|windowsapps' | grep -v '^$' | paste -sd: -)
  if PATH="$SHIM_DIR:$REAL_PY_DIR:$CLEAN_PATH" sh -c 'command -v python3' >/dev/null 2>&1; then
    echo "  ⚠️  环境检查: python3 仍可发现 — 用例 6/7 回退断言可能受环境干扰"
  fi

  run_guard_case() { # <shim_body_file> <repo> <msg> → OUT + EC（cwd 为 repo）
    # shim 同时提供 python 和 python3——macOS 系统自带 /usr/bin/python3，仅提供 python
    # shim 无法拦截（PYBIN 遍历 python3→python→py 先命中系统 python3，回退永不触发）。
    for _shimname in python python3; do
      cat > "$SHIM_DIR/$_shimname" <<SHIMEOF
#!/bin/bash
# D331 测试 shim: -c 探测 → 转真实 python；其余调用按用例脚本行为
if [[ "\$*" == *"-c"* ]]; then
  exec "$REAL_PY_BIN" "\$@"   # 绝对路径（sys.executable），不依赖 python 在 PATH
fi
$(cat "$1")
SHIMEOF
      chmod +x "$SHIM_DIR/$_shimname"
    done
    rm -f "$SHIM_MARKER"  # 运行前清零（断言在函数返回后检查 marker 残留）
    set +e
    OUT=$(cd "$2" && SYNO_PRE_COMMIT="$2/.missing-pre-commit" PATH="$SHIM_DIR:$CLEAN_PATH" \
      bash "$SYNOVA_COMMIT" --task-id "D331-test" --agent "test" --message "$3" --files "x.md" 2>&1)
    EC=$?
    set -e
  }

  # ── 用例 6: PYBIN 回退 — python3 缺失 → shim python 执行 guard ──
  echo "── 6. 呈报段 PYBIN 回退 (python3 缺失 → python shim) ──"
  R6=$(mktemp -d)
  new_repo "$R6" "V9.9.9"
  echo "x" > "$R6/x.md"  # 不提交 — synova-commit 的 git add 暂存新文件
  SHIM_BODY=$(mktemp)
  # 实值嵌入（heredoc 的 $(cat) 输出不二次展开 — 字面 $ 会落空）
  printf 'touch "%s"\nexec "%s" "$@"\n' "$SHIM_MARKER" "$REAL_PY_BIN" > "$SHIM_BODY"
  run_guard_case "$SHIM_BODY" "$R6" "test: guard pybin"
  assert_exit "$EC" 2 "降级路径 commit 完成 (exit 2)"
  if [ -f "$SHIM_MARKER" ]; then pass "呈报段经 shim python 执行（PYBIN 回退生效）"; else fail "呈报段未经 shim 执行 — PYBIN 未回退"; fi
  LOG6=$(git -C "$R6" log --oneline 2>/dev/null | head -1) # swallow-ok: 测试日志读取（无提交时预期非零）
  assert_contains "$LOG6" "guard pybin" "提交已创建"
  echo ""

  # ── 用例 7: guard 崩溃（非 JSON rc=3）→ 显式 degraded 提示 + 放行 ──
  echo "── 7. 呈报段崩溃 → 显式 degraded（不静默吞）──"
  SHIM_BODY7=$(mktemp)
  printf 'echo "CRASHED (shim)"\nexit 3\n' > "$SHIM_BODY7"
  echo "v2" >> "$R6/x.md"  # 复用 R6：追加变更让 git add 有新内容可暂存
  run_guard_case "$SHIM_BODY7" "$R6" "test: guard crash"
  assert_exit "$EC" 2 "呈报段崩溃 → 降级放行 (exit 2)"
  assert_contains "$OUT" "归属呈报降级" "显式 degraded 提示出现（非静默）"
  LOG7=$(git -C "$R6" log --oneline 2>/dev/null | head -1) # swallow-ok: 测试日志读取（无提交时预期非零）
  assert_contains "$LOG7" "guard crash" "崩溃后提交仍完成"
  echo ""

  # ── 用例 8: 全无可用 python → fail-open 显式提示 ──
  # 影子 shim（python3/python/py 全部 -c 探测失败）→ PYBIN 空 → 显式跳过提示
  echo "── 8. 全无 python → 显式降级提示 ──"
  R8=$(mktemp -d)
  SHIM8_DIR=$(mktemp -d)
  for _s in python3 python py; do
    printf '#!/bin/bash\nexit 1\n' > "$SHIM8_DIR/$_s"
    chmod +x "$SHIM8_DIR/$_s"
  done
  new_repo "$R8" "V9.9.9"
  echo "x" > "$R8/x.md"  # 不提交 — synova-commit 的 git add 暂存新文件
  set +e
  OUT8=$(cd "$R8" && SYNO_PRE_COMMIT="$R8/.missing-pre-commit" PATH="$SHIM8_DIR:$CLEAN_PATH" \
    bash "$SYNOVA_COMMIT" --task-id "D331-test" --agent "test" --message "test: no python" --files "x.md" 2>&1)
  EC8=$?
  set -e
  assert_exit "$EC8" 2 "全无 python → 降级放行 (exit 2)"
  assert_contains "$OUT8" "归属呈报降级: python 不可用" "显式提示 python 不可用降级（不静默）"
  echo ""
  rm -f "$SHIM_BODY" "$SHIM_BODY7" 2>/dev/null || true
fi

# ── 用例 9: --session 能力保留（D1223 后生产调用点为 0，如实打印）──
# D1223 迁移说明: 原断言 = 「resolve-commit-brief.sh.*--session 生产调用点 ≥1」。该唯一生产
#   调用方即已退役的 staging_guard.py（D331 P2-2 的接线落点），故原断言在退役后必然 0 命中。
#   处置（不静默、不假红）: ① 断言**能力仍在**（flag 已实现，未随退役一并删除）；② 生产调用点
#   计数**打印出来**（0 亦可见）；③ 生产接线断言改由 claim 单源夹具承担
#   （tests/control-tower/staging-guard-retirement.test.sh:R4 断言 claim_store 为唯一生产入口）。
echo "── 9. --session 能力保留 + 生产调用点计数（D1223）──"
if grep -q -- '--session' "$REPO_DIR/scripts/workflow/resolve-commit-brief.sh" 2>/dev/null; then
  pass "--session 能力保留（resolve-commit-brief.sh 仍实现该 flag）"
else
  fail "--session 能力被删（退役不应带走 resolver 的 flag）"
fi
HITS9=$(grep -rn "resolve-commit-brief\.sh\"[^#]*--session" "$REPO_DIR/scripts/" 2>/dev/null || true)
N9=$(printf '%s' "$HITS9" | grep -c "resolve-commit-brief" || true)
N9="${N9//[^0-9]/}"; N9="${N9:-0}"
pass "--session 生产调用点 = ${N9}（D1223 后显式登记；≥1 时请同步复核归属）"
echo ""

# ── 用例 10: write-set 条目含 task_id ──
echo "── 10. write-set 条目含 task_id ──"
R10=$(mktemp -d)
new_repo "$R10" "V9.9.9"
R10_W=$(cygpath -w "$R10" 2>/dev/null || echo "$R10")
REPO_DIR_W=$(cygpath -w "$REPO_DIR" 2>/dev/null || echo "$REPO_DIR")
set +e
OUT10=$(cd "$R10" && python3 - "$R10_W" "$REPO_DIR_W" <<'PYEOF'
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[2] + "/scripts/control-tower")
from session_registry import SessionRegistry
tmp = Path(sys.argv[1])
reg = SessionRegistry(registry_path=tmp / "registry.json", lock_dir=tmp / "locks", degraded_log=tmp / "deg.log")
reg.register("S1", str(tmp / "b.md"), task_id="D331")
reg.write_set("S1", add=["src/x.ts"])
data = json.loads((tmp / "registry.json").read_text(encoding="utf-8"))
entry = [w for s in data["sessions"] if s["session_id"] == "S1" for w in s.get("write_set", [])]
assert entry, "write_set 为空"
assert entry[0].get("task_id") == "D331", "write-set 条目缺 task_id: %r" % entry[0]
print("OK task_id=" + str(entry[0].get("task_id")))
PYEOF
)
EC10=$?
set -e
assert_exit "$EC10" 0 "write-set 条目含 task_id"
assert_contains "$OUT10" "OK task_id=D331" "输出确认 task_id=D331"
echo ""

# ── 用例 11: 同任务并行 session 的 task_id 继承（**生产者侧**不变量）──
# D1223（2026-10-07）迁移说明: 原用例 11 消费已退役的 `staging_guard.check_staging` 做
#   「同任务写集互认（不误伤）」；该消费者随模块整件退役（判据面移交 CI D708 写集对账）。
#   本用例改断言其**生产侧**不变量 —— 同任务并行 session 的写集条目必须携带**继承的**
#   task_id（D331 P2-1）。消费者退役 ≠ 生产者可以不变量：verify-parallel --ci-pr 的归属
#   判定仍读该字段，字段缺失 = 同任务识别能力静默消失。
echo "── 11. 同任务 session task_id 继承（生产者不变量）──"
R11=$(mktemp -d)
new_repo "$R11" "V9.9.9"
R11_W=$(cygpath -w "$R11" 2>/dev/null || echo "$R11")
set +e
OUT11=$(cd "$R11" && python3 - "$R11_W" "$REPO_DIR_W" <<'PYEOF'
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[2] + "/scripts/control-tower")
from session_registry import SessionRegistry
tmp = Path(sys.argv[1])
reg = SessionRegistry(registry_path=tmp / "registry.json", lock_dir=tmp / "locks", degraded_log=tmp / "deg.log")
reg.register("A", str(tmp / "brief-a.md"), task_id="D331")
reg.write_set("A", add=["src/x.ts"])
reg.register("B", str(tmp / "brief-b.md"), task_id="D331")
reg.write_set("B", add=["src/y.ts"])
data = json.loads((tmp / "registry.json").read_text(encoding="utf-8"))
entries = [(w["file"], w.get("task_id")) for s in data["sessions"] for w in s.get("write_set", [])]
assert len(entries) == 2, "写集条目数异常: %r" % entries
assert all(t == "D331" for _, t in entries), "task_id 未继承（同任务识别失效）: %r" % entries
print("OK entries=" + str(sorted(entries)))
PYEOF
)
EC11=$?
set -e
assert_exit "$EC11" 0 "同任务写集 task_id 继承（生产者不变量）"
assert_contains "$OUT11" "OK entries=" "输出确认 task_id 继承"
echo ""

# ── 清理 ──
rm -rf "$R1" "$R2" "$R3" "$R5" "$R6" "$R8" "$R10" "$R11" "$SHIM_DIR" "${SHIM8_DIR:-}" 2>/dev/null || true

echo "═══════════════════════════════════════════════════════════"
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ tag-bypass-wiring 测试未通过"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
echo "  Status: ✅ tag-bypass-wiring 测试全部通过"
echo "═══════════════════════════════════════════════════════════"
exit 0
