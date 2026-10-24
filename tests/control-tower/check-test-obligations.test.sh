#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-test-obligations.test.sh — #913 批 2 · Q-10 测试义务闸的配对判据测试（CT-40）
#
# 被测件: scripts/control-tower/check-test-obligations.py
# 台账  : tests/contract/triviality-manifest.yaml
# 判据源: .handbook/派单件/2026-10-24-规格-913-PR2-分层与快照实施.md §4（S1–S11 两态）
#
# 覆盖矩阵（铁律 48：正常/降级/边界 ＋ ctrl-tower-change 模式 1 三态 0/1/2 ＋ 改坏必红）:
#   S1  clean tree（真实工作树 · --base gitea/local-main→origin/local-main）⇒ rc0 ＋ modules=<台账现算> legacy=<baseline> untriaged=0 ＋ SKIP
#   S2  改 surface 模块、无资产                                ⇒ rc1 点名 module → asset_glob（实际改动：…）
#   S3  同 S2 ＋ 补 tests/expected 资产（**S2 的正态**）        ⇒ rc0，无 O1
#   S4  新增 110 有效行 src 文件、台账无行                     ⇒ rc1 `untriaged: src/x/new.ts`（M1 同案红）
#   S5  删台账一行（**先证 seed 态绿、再证删行红**）            ⇒ rc1 `legacy=3 > baseline=2`（清单级，SKIP 不吞）
#   S6  NoBehaviorChange ＋ hunk 含 `export `                  ⇒ rc1 `trailer 失效`（点名 commit ＋ 命中行）
#   S6b trailer 有效且无行为行（**S6 的正态**）                ⇒ rc0，打印 trailer 免除义务
#   S7  exempt 行 expiry=2020-01-01                            ⇒ rc1 `expiry 已过期`
#   S7b exempt 行 expiry=2030-01-01（**S7 的正态**）           ⇒ rc0
#   S8-a 空变更集 ⇒ rc0 ＋ `SKIP: 无 src/** 变更`
#   S8-b 坏 base  ⇒ rc2 ＋ E_BAD_BASE      ｜ S8-c 扫描根 0 个 src ⇒ rc2 ＋ E_NOSRC
#   S9  新增 tests/expected/x/foo.golden.json                  ⇒ rc1 命名红
#   S9b 新增 *.expected.json（**S9 的正态**）                  ⇒ rc0
#   S10 --selfcheck                                            ⇒ rc0 ＋ SELFCHECK-OK s1..s9=1/1/1/1/1/1/1/1/1
#   S11 SYNO_TEST_OBLIGATIONS=off（规格 §6 回滚点）            ⇒ 红态被短路 rc0 ＋ 打印回滚态
#   改坏必红 S12：两个变异体（剥掉 O1 检出 / 剥掉 T1 trailer 检出）⇒ 对应红态夹具翻绿 ⇒ 断言承重
#
# 隔离: 每个用例独立 mktemp 仓（git init ＋ 本地身份 ＋ commit.gpgsign=false），
#   零网络、零宿主写入；**唯一读真实工作树的用例是 S1/S10**（只读，不写）。
# 依赖: git（缺 ⇒ exit 2）｜python3（缺/不可执行 ⇒ exit 2）｜S1 依赖 `gitea/local-main`（缺失回退 `origin/local-main`）可解析
#   （不可解析 ⇒ exit 2：判据纪律 ⑨②「环境依赖显式，缺什么就报什么」，不静默软化）。
# ═══════════════════════════════════════════════════════════════════════════════
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUT="$REPO/scripts/control-tower/check-test-obligations.py"
MANIFEST="$REPO/tests/contract/triviality-manifest.yaml"
PASS=0
FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
no() {
  echo "  ❌ $1"
  if [ -n "${RUN_OUT:-}" ]; then printf '%s\n' "$RUN_OUT" | sed 's/^/     | /'; fi
  FAIL=$((FAIL + 1))
}
assert_rc() { if [ "$1" -eq "$2" ]; then ok "$3（exit=$1）"; else no "$3 —— exit=$1 期望 $2"; fi; }
assert_has() { if printf '%s' "$RUN_OUT" | grep -qF -- "$2"; then ok "$1"; else no "$1 —— 缺字面量「$2」"; fi; }
assert_hasnt() { if printf '%s' "$RUN_OUT" | grep -qF -- "$2"; then no "$1 —— 不该出现的字面量「$2」"; else ok "$1"; fi; }

# ── 依赖探测（缺 ⇒ exit 2，禁静默当通过）─────────────────────────────────────
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
[ -n "$PYBIN" ] || { echo "❌ 缺 python3（检查自身失败 exit 2）"; exit 2; }
command -v git >/dev/null 2>&1 || { echo "❌ 缺 git（检查自身失败 exit 2）"; exit 2; }
[ -f "$SUT" ] || { echo "❌ 缺被测件: ${SUT}（检查自身失败 exit 2）"; exit 2; }
[ -f "$MANIFEST" ] || { echo "❌ 缺台账: ${MANIFEST}（检查自身失败 exit 2）"; exit 2; }
BASE_REF="gitea/local-main"
git -C "$REPO" rev-parse --verify -q "${BASE_REF}^{commit}" >/dev/null 2>&1 \
  || BASE_REF="origin/local-main"
git -C "$REPO" rev-parse --verify -q "${BASE_REF}^{commit}" >/dev/null 2>&1 \
  || { echo "❌ S1 依赖 gitea/local-main / origin/local-main 均不可解析（先 git fetch；检查自身失败 exit 2）"; exit 2; }

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

# ── 夹具工具 ─────────────────────────────────────────────────────────────────
mk_repo() { # <dir> —— 骨架仓：空台账（baseline 0）＋ .gitignore；skeleton 提交
  local d="$1"
  mkdir -p "$d/tests/contract"
  (
    cd "$d" || exit 1
    git init -q
    git config user.email t@t
    git config user.name t
    git config commit.gpgsign false
    printf 'schema_version: 1\nmeta: { as_of: "fixture", ruling: "test", legacy_baseline: 0 }\nentries:\n' \
      > tests/contract/triviality-manifest.yaml
    printf '__pycache__/\n' > .gitignore
    git add -A
    git commit -q --no-verify -m skeleton
  )
}

manifest() { # <file> <baseline> [entry-flow-map...]
  local f="$1" b="$2"
  shift 2
  {
    printf 'schema_version: 1\nmeta: { as_of: "fixture", ruling: "test", legacy_baseline: %s }\nentries:\n' "$b"
    local e
    for e in "$@"; do printf '  - { %s }\n' "$e"; done
  } > "$f"
}

ts_module() { # <path> [有效逻辑行数]
  local p="$1" n="${2:-5}" i
  {
    echo "// fixture"
    for ((i = 0; i < n; i++)); do echo "const v$i = $i;"; done
    echo "export function cv(): number { return 1; }"
  } > "$p"
}

commit_all() { ( cd "$1" && git add -A && git commit -q --no-verify -m "${2:-case}" ); }

SUT_ACTIVE=""
runq() { # <dir> [args...] → 输出（stdout+stderr），rc 存 RUN_RC
  local d="$1"
  shift
  RUN_OUT="$( cd "$d" && "$PYBIN" "${SUT_ACTIVE:-$SUT}" --root . "$@" 2>&1 )"
  RUN_RC=$?
}

echo "═══════════════════════════════════════════════════════════════"
echo "  #913 批 2 · Q-10 check-test-obligations（S1–S12 · 两态 ＋ 改坏必红）"
echo "═══════════════════════════════════════════════════════════════"

# ── S1 clean tree（真实工作树；只读）────────────────────────────────────────
echo "── S1 clean tree · --base ${BASE_REF}（真实工作树，只读）──"
runq "$REPO" --base "${BASE_REF}"
assert_rc "$RUN_RC" 0 "S1 clean tree ⇒ exit 0"
# M3（裁 355 M3）：不写死 modules/legacy —— 从台账现算；clean tree 的不变量是
#   modules == 非 none 行数 ∧ legacy == legacy_baseline（相等即证棘轮基线未漂）
read -r M_MODULES M_BASELINE <<< "$("$PYBIN" - "$MANIFEST" <<'PYM3'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
mods = len(re.findall(r'surface:\s*(?!none\b)[A-Za-z-]+', text))
m = re.search(r'legacy_baseline:\s*(\d+)', text)
print(mods, m.group(1) if m else "ERR")
PYM3
)"
[ "${M_BASELINE}" != "ERR" ] || { echo "❌ 台账 legacy_baseline 不可解析（检查自身失败 exit 2）"; exit 2; }
assert_has "S1 汇总行 modules=${M_MODULES} legacy=${M_BASELINE} untriaged=0（台账现算，不写死）" "modules=${M_MODULES} legacy=${M_BASELINE} untriaged=0"
assert_has "S1 SKIP 语义（无 src/** 变更）" "SKIP: 无 src/** 变更"

# ── S2 改 surface 模块、无资产 ⇒ rc1 ───────────────────────────────────────
echo "── S2 改 surface 模块、无资产 ⇒ rc1 点名 ──"
D="$TMPROOT/s2"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src/agent
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/agent/context-compaction.ts, surface: model, obligation: snapshot, asset_glob: "tests/expected/compaction/**"'
  ts_module src/agent/context-compaction.ts
)
commit_all "$D" "seed: 台账 1 条＋模块"
( cd "$D" && printf 'const changed = 1;\n' >> src/agent/context-compaction.ts )
commit_all "$D" "S2 改模块无资产"
runq "$D" --base HEAD~1
assert_rc "$RUN_RC" 1 "S2 改 surface 模块无资产 ⇒ exit 1"
assert_has "S2 点名 context-compaction → tests/expected/compaction/**（实际改动：…）" \
  "context-compaction.ts → tests/expected/compaction/**（实际改动：src/agent/context-compaction.ts）"

# ── S3 同 S2 ＋ 补资产 ⇒ rc0（正态）────────────────────────────────────────
echo "── S3 同 S2 ＋ 补 tests/expected 资产 ⇒ rc0（两态：S2 红 / S3 绿）──"
D="$TMPROOT/s3"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src/agent
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/agent/context-compaction.ts, surface: model, obligation: snapshot, asset_glob: "tests/expected/compaction/**"'
  ts_module src/agent/context-compaction.ts
)
commit_all "$D" "seed: 台账 1 条＋模块"
(
  cd "$D" || exit 1
  printf 'const changed = 1;\n' >> src/agent/context-compaction.ts
  mkdir -p tests/expected/compaction
  printf '{}\n' > tests/expected/compaction/x.expected.json
)
commit_all "$D" "S3 改模块＋补资产"
runq "$D" --base HEAD~1
assert_rc "$RUN_RC" 0 "S3 补 expected 资产 ⇒ exit 0"
assert_hasnt "S3 不再点名 O1（义务已补）" "❌ O1"

# ── S4 新增 110 行 src、台账无行 ⇒ rc1 untriaged ──────────────────────────
echo "── S4 新增 110 有效行 src 文件、台账无行 ⇒ rc1 untriaged ──"
D="$TMPROOT/s4"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/seed.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/seed/**"'
  ts_module src/seed.ts
)
commit_all "$D" "seed: 台账 1 条＋src/seed.ts"
(
  cd "$D" || exit 1
  mkdir -p src/x
  {
    for i in $(seq 1 110); do echo "const v$i = $i;"; done
    echo "export function big(): number { return 1; }"
  } > src/x/new.ts
)
commit_all "$D" "S4 新增未 triage 模块"
runq "$D" --base HEAD~1
assert_rc "$RUN_RC" 1 "S4 新增 110 行 src 且台账无行 ⇒ exit 1"
assert_has "S4 点名 untriaged: src/x/new.ts" "untriaged: src/x/new.ts"
assert_has "S4 同案存量棘轮也红（修法同一处：补 triage 行）" "legacy=1 > baseline=0"

# ── S5 删台账一行 ⇒ legacy > baseline（先证 seed 绿）──────────────────────
echo "── S5 删台账一行 ⇒ rc1 legacy=<n+1> > baseline ──"
D="$TMPROOT/s5"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src/a src/b src/c
  ts_module src/a/x.ts
  ts_module src/a/y.ts
  ts_module src/b/z.ts
  ts_module src/c/w.ts
  manifest tests/contract/triviality-manifest.yaml 2 \
    'module: src/a/x.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/a/**"' \
    'module: src/a/y.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/a/**"'
)
commit_all "$D" "seed: 4 src / 2 登记 ⇒ legacy=2"
runq "$D" --base HEAD
assert_rc "$RUN_RC" 0 "S5 前置两态：seed 态 legacy=2==baseline ⇒ exit 0"
(
  cd "$D" || exit 1
  manifest tests/contract/triviality-manifest.yaml 2 \
    'module: src/a/x.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/a/**"'
)
commit_all "$D" "S5 删一行台账"
runq "$D" --base HEAD~1
assert_rc "$RUN_RC" 1 "S5 删台账一行 ⇒ exit 1（清单级，无 src 变更也判）"
assert_has "S5 点名 legacy=3 > baseline=2" "legacy=3 > baseline=2"

# ── S6 NoBehaviorChange ＋ hunk 含 export ⇒ trailer 失效 ──────────────────
echo "── S6 NoBehaviorChange ＋ hunk 含 export ⇒ rc1 trailer 失效 ──"
D="$TMPROOT/s6"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src/agent
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/agent/context-compaction.ts, surface: model, obligation: snapshot, asset_glob: "tests/expected/compaction/**"'
  ts_module src/agent/context-compaction.ts
)
commit_all "$D" "seed: 台账 1 条＋模块"
( cd "$D" && printf 'export function extra(): number { return 2; }\n' >> src/agent/context-compaction.ts )
commit_all "$D" "refactor: 只重命名

NoBehaviorChange: 本次只重命名局部变量"
runq "$D" --base HEAD~1
assert_rc "$RUN_RC" 1 "S6 trailer ＋行为行 ⇒ exit 1"
assert_has "S6 点名 trailer 失效" "trailer 失效"
assert_has "S6 点名命中行（+export function extra）" "export function extra(): number { return 2; }"
assert_has "S6 点名 commit（sha 前 7 位）" "commit "

# ── S6b 两态：trailer 有效且无行为行 ⇒ rc0 ────────────────────────────────
echo "── S6b trailer 有效且无行为行 ⇒ rc0（两态：S6 红 / S6b 绿）──"
D="$TMPROOT/s6b"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src/agent
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/agent/context-compaction.ts, surface: model, obligation: snapshot, asset_glob: "tests/expected/compaction/**"'
  ts_module src/agent/context-compaction.ts
)
commit_all "$D" "seed: 台账 1 条＋模块"
( cd "$D" && printf 'const renamed = 1;\n' >> src/agent/context-compaction.ts )
commit_all "$D" "refactor: 只重命名

NoBehaviorChange: 本次只重命名局部变量"
runq "$D" --base HEAD~1
assert_rc "$RUN_RC" 0 "S6b trailer 有效且无行为行 ⇒ exit 0（免补资产）"
assert_has "S6b 打印 trailer 免除义务" "trailer 免除义务"

# ── S7 exempt 过期 ⇒ rc1 ──────────────────────────────────────────────────
echo "── S7 exempt 行 expiry=2020-01-01 ⇒ rc1 expiry 已过期 ──"
D="$TMPROOT/s7"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src/legacy
  ts_module src/legacy/x.ts
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/legacy/x.ts, surface: none, obligation: exempt, issue: "#913", expiry: "2020-01-01", reason: "存量豁免（夹具）"'
)
commit_all "$D" "seed: exempt 已过期"
runq "$D" --base HEAD
assert_rc "$RUN_RC" 1 "S7 exempt expiry 过期 ⇒ exit 1（空变更集也判，SKIP 不吞）"
assert_has "S7 点名 expiry 已过期" "expiry 已过期"

# ── S7b 两态：exempt 未过期 ⇒ rc0 ─────────────────────────────────────────
echo "── S7b exempt 行 expiry=2030-01-01 ⇒ rc0（两态）──"
D="$TMPROOT/s7b"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src/legacy
  ts_module src/legacy/x.ts
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/legacy/x.ts, surface: none, obligation: exempt, issue: "#913", expiry: "2030-01-01", reason: "存量豁免（夹具）"'
)
commit_all "$D" "seed: exempt 未过期"
runq "$D" --base HEAD
assert_rc "$RUN_RC" 0 "S7b exempt 未过期 ⇒ exit 0"

# ── S8 边界三态 ───────────────────────────────────────────────────────────
echo "── S8 边界：空变更集 / 坏 base / 扫描根 0 src ──"
D="$TMPROOT/s8a"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src
  ts_module src/keep.ts
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/keep.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/keep/**"'
)
commit_all "$D" "seed: 干净态"
runq "$D" --base HEAD
assert_rc "$RUN_RC" 0 "S8-a 空变更集 ⇒ exit 0"
assert_has "S8-a SKIP 语义" "SKIP: 无 src/** 变更"
runq "$D" --base no-such-ref-xyz
assert_rc "$RUN_RC" 2 "S8-b 坏 base ⇒ exit 2（fail-closed）"
assert_has "S8-b 点名 E_BAD_BASE" "E_BAD_BASE"
D="$TMPROOT/s8c"
mk_repo "$D"
runq "$D" --base HEAD
assert_rc "$RUN_RC" 2 "S8-c 扫描根 0 个 src 文件 ⇒ exit 2"
assert_has "S8-c 点名 E_NOSRC" "E_NOSRC"

# ── S9 golden 命名 ⇒ rc1 ──────────────────────────────────────────────────
echo "── S9 新增 tests/expected/x/foo.golden.json ⇒ rc1 命名红 ──"
D="$TMPROOT/s9"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src
  ts_module src/keep.ts
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/keep.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/keep/**"'
)
commit_all "$D" "seed: 干净态"
(
  cd "$D" || exit 1
  mkdir -p tests/expected/x
  printf '{}\n' > tests/expected/x/foo.golden.json
)
commit_all "$D" "S9 新增 golden"
runq "$D" --base HEAD~1
assert_rc "$RUN_RC" 1 "S9 新增 golden 文件 ⇒ exit 1"
assert_has "S9 命名红（含 golden）" "命名红"
assert_has "S9 点名路径 foo.golden.json" "tests/expected/x/foo.golden.json"

# ── S9b 两态：合规命名 ⇒ rc0 ──────────────────────────────────────────────
echo "── S9b 新增 *.expected.json ⇒ rc0（两态：S9 红 / S9b 绿）──"
D="$TMPROOT/s9b"
mk_repo "$D"
(
  cd "$D" || exit 1
  mkdir -p src
  ts_module src/keep.ts
  manifest tests/contract/triviality-manifest.yaml 0 \
    'module: src/keep.ts, surface: protocol, obligation: expected, asset_glob: "tests/expected/keep/**"'
)
commit_all "$D" "seed: 干净态"
(
  cd "$D" || exit 1
  mkdir -p tests/expected/y
  printf '{}\n' > tests/expected/y/ok.expected.json
)
commit_all "$D" "S9b 合规命名"
runq "$D" --base HEAD~1
assert_rc "$RUN_RC" 0 "S9b 合规命名 ⇒ exit 0"

# ── S10 --selfcheck ───────────────────────────────────────────────────────
echo "── S10 --selfcheck（判别力自检；信号量==0 ⇒ exit 2）──"
runq "$REPO" --selfcheck
assert_rc "$RUN_RC" 0 "S10 --selfcheck ⇒ exit 0"
assert_has "S10 SELFCHECK-OK s1..s9=1/1/1/1/1/1/1/1/1" "SELFCHECK-OK s1..s9=1/1/1/1/1/1/1/1/1"

# ── S11 回滚点（规格 §6）：红态被 SYNO_TEST_OBLIGATIONS=off 短路 ─────────
echo "── S11 SYNO_TEST_OBLIGATIONS=off（唯一回滚点）⇒ 红态短路 rc0 ──"
D="$TMPROOT/s2"
RUN_OUT="$( cd "$D" && SYNO_TEST_OBLIGATIONS=off "$PYBIN" "$SUT" --root . --base HEAD~1 2>&1 )"
RUN_RC=$?
assert_rc "$RUN_RC" 0 "S11 回滚态（S2 红态被短路）⇒ exit 0"
assert_has "S11 打印回滚态（不静默）" "回滚态"

# ── S12 改坏必红（变异体：剥掉规则检出 ⇒ 对应红态夹具翻绿）──────────────
echo "── S12 改坏必红：变异体翻转对应夹具（证明断言承重）──"
MUT1="$TMPROOT/mut-no-o1.py"
"$PYBIN" - "$SUT" "$MUT1" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
needle = "            if not assets:\n"
assert needle in src, "变异点未命中：O1 检出块结构变了（scanner 改了 ⇒ 本用例必须同步）"
open(sys.argv[2], "w", encoding="utf-8").write(src.replace(needle, "            if False:  # MUTANT\n", 1))
PY
if [ ! -f "$MUT1" ]; then
  no "S12 变异体生成失败（$MUT1 不存在）"
else
  ( cd "$TMPROOT/s2" && "$PYBIN" "$MUT1" --root . --base HEAD~1 >/dev/null 2>&1 )
  MRC1=$?
  echo "     两态: 原体 rc=1（S2 已断言）｜变异体 rc=${MRC1}（期望 0）"
  if [ "$MRC1" -eq 0 ]; then
    ok "S12-A 变异体（剥掉 O1 义务检出）⇒ S2 红态翻绿 ⇒ O1 断言承重"
  else
    no "S12-A 变异体仍判红（rc=${MRC1}）⇒ O1 断言可能空转"
  fi
fi

MUT2="$TMPROOT/mut-no-t1.py"
"$PYBIN" - "$SUT" "$MUT2" <<'PY'
import sys
src = open(sys.argv[1], encoding="utf-8").read()
needle = '                        tok = next((t for t in BEHAVIOR_TOKENS if t in one), "")\n'
assert needle in src, "变异点未命中：T1 检出块结构变了（scanner 改了 ⇒ 本用例必须同步）"
open(sys.argv[2], "w", encoding="utf-8").write(src.replace(needle, '                        tok = ""  # MUTANT\n', 1))
PY
if [ ! -f "$MUT2" ]; then
  no "S12 变异体生成失败（$MUT2 不存在）"
else
  ( cd "$TMPROOT/s6" && "$PYBIN" "$MUT2" --root . --base HEAD~1 >/dev/null 2>&1 )
  MRC2=$?
  echo "     两态: 原体 rc=1（S6 已断言）｜变异体 rc=${MRC2}（期望 0）"
  if [ "$MRC2" -eq 0 ]; then
    ok "S12-B 变异体（剥掉 T1 trailer 检出）⇒ S6 红态翻绿 ⇒ T1 断言承重"
  else
    no "S12-B 变异体仍判红（rc=${MRC2}）⇒ T1 断言可能空转"
  fi
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
