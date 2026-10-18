#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# founder-truth.test.sh — D419→D424 创始人零信任控制台测试
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — 输出三问面板（任务真相 + 诚信账本 + 北星对齐）+ 小结（红绿灯计数）
#   降级 — git 不可用 → degraded 标记（不静默当真）
#   边界 — 判定逻辑覆盖（真实/滞后/疑似虚报 三分支）+ 北星无对应标记
#   接线 — 物理核验逻辑 + 新面板函数真实存在（铁律 0-2）
#   🆕 FIX-008 — 输出隔离（M8 家族「测试副作用碰 tracked 文件」第 3 例）:
#     生成物只写 mktemp 隔离目录；判别性判据 = 跑完 `git status --porcelain` 不增加脏度
#     （成对反例：⒜ 隔离 → 干净；⒝ 沙箱内故意改 tracked 生成物 → 同一判据报红）
# ✅ 2026-10-18 B6 修崩溃后：原「既存红（非本卡）」口径**作废**——①「正常」②「判定」的
#    真因是 claim 行缺 id/title/phys 三键 ⇒ judge() KeyError 崩溃（founder-truth.py:90-94）；
#    三键补齐后本测试应全绿（判别力靠收紧断言，不靠放宽绿线；lead 2026-09-26 口径不变）。
# 🆕 2026-10-18 T7/T8 hermeticity 加固：诚信账本断言改「数据面三态感知」（有 AGENT 计分 / 无文件显式降级 /
#    空账本显式真绕过计数 / 其余判红）。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$REPO/scripts/control-tower/founder-truth.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# FIX-008: 生成物输出目录（隔离）——测试**不得**写仓库内 tracked 生成物
OUTDIR="$(mktemp -d)"
trap 'rm -rf "$OUTDIR"' EXIT
GENRUN() { SYNO_FOUNDER_OUT_DIR="$OUTDIR" python3 "$GEN" "$@"; }

# 基线脏度：本测试跑完后不得增加（判别性判据本体；⒜/⒝ 两侧复用同一实现）
#   注：判据用**增量**语义（前 vs 后）——基线本身脏（他人未提交改动）时不得误判为本测试的副作用；
#   基线干净时「不增加」即等价于「跑完为空」。
BEFORE_DIRTY=$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')
BEFORE_GEN=$(git -C "$REPO" status --porcelain -- docs/synova/founder-console.html docs/synova/founder-alerts.md 2>/dev/null | wc -l | tr -d ' ')
gen_paths_dirty() { # $1 = git 仓根；输出仓库内两个生成物的 porcelain 行数
  git -C "$1" status --porcelain -- docs/synova/founder-console.html docs/synova/founder-alerts.md 2>/dev/null | wc -l | tr -d ' '
}

echo "=== D419→D424 founder-truth 控制台测试 ==="

# ── 接线: 物理核验逻辑 + 三问面板函数真实存在 ──
if grep -q "git_committed_dns" "$GEN" && grep -q "integrity_ledger" "$GEN" \
   && grep -q "north_star_alignment" "$GEN" && grep -q "ci_status" "$GEN" \
   && grep -q "write_alert" "$GEN"; then
  ok "接线: 三问面板函数（ledger/north-star/ci/alert）+ git 核验逻辑存在"
else
  no "接线: 面板函数缺失"
fi

# ── 正常: 输出含三问面板 + 小结（FIX-008: 走隔离输出目录）──
OUT=$(GENRUN --offline 2>&1)
if grep -q "创始人控制台" <<< "$OUT" && grep -q "小结" <<< "$OUT" \
   && grep -q "诚信账本" <<< "$OUT" && grep -q "北星对齐" <<< "$OUT" \
   && grep -q "CI 最近一次" <<< "$OUT"; then
  ok "正常: 输出三问面板（任务真相/诚信账本/北星对齐）+ CI + 小结"
else
  no "正常: 输出结构异常"
fi

# ── 判定: 小结行必须给出 🟢 真实计数（收紧：崩溃输出的 traceback 源码行也含 🟢，旧粗匹配恒真）──
if grep -q "小结：🟢" <<< "$OUT"; then
  ok "判定: 小结行含 🟢 真实计数（崩溃输出不再假绿）"
else
  no "判定: 小结行缺 🟢 计数（疑似崩溃或输出异常）"
fi

# ── 边界: 北星对齐含"无对应"标记（方向漂移检测）──
if grep -q "北星无对应" <<< "$OUT"; then
  ok "边界: 北星对齐含'无对应'方向漂移标记"
else
  no "边界: 北星对齐缺'无对应'标记（或当前全部对齐）"
fi

# ── 边界: 诚信账本按 agent 计分（含诚信 %）—— 数据面三态感知（T7/T8 hermeticity 加固）──
# 数据面说明: .claude/bypass.log 是 gitignored 运行时数据（.gitignore:40）⇒ 干净 checkout 无此文件；
#   产品行为是显式降级「（bypass.log 缺失）」（铁律 11）⇒ 断言必须区分「有数据必须计分 / 无数据必须显式降级」，
#   两者都没有（如崩溃输出）才判红 —— 否则解除隔离后干净 checkout 假红。
# 第三态（T8）: scripts/hooks/post-commit.sh:138 每次 commit 都写 COMMITTED-only 账本（行内无 AGENT=）⇒
#   文件存在但 agents 为空 ⇒ 面板必打「真绕过(detected-bypass): N 次」（账本区已渲染且显式空）；
#   这是「提交后 hook 造账本态」的可判标记，不得因无 诚信% 判红。
if grep -qE "诚信 [0-9]+%" <<< "$OUT"; then
  ok "边界: 诚信账本按 agent 计分（含诚信百分比）"
elif grep -q "（bypass.log 缺失）" <<< "$OUT"; then
  ok "边界: 无 bypass.log 数据面 ⇒ 显式降级标注（非静默空，铁律 11）"
elif grep -q "真绕过(detected-bypass)" <<< "$OUT"; then
  ok "边界: 账本存在但 0 条 AGENT 记录 ⇒ 面板显式给出真绕过计数（提交后 hook 造账本态）"
else
  no "边界: 诚信账本缺计分（无数据/空账本时均未显式降级）"
fi

# ── 降级: git 不可用 → degraded 或 exit 2（不静默当真）──
FAKEGIT="$(mktemp -d)"
GIT_DIR="$FAKEGIT" SYNO_FOUNDER_OUT_DIR="$OUTDIR" python3 "$GEN" --offline >/dev/null 2>&1
rc=$?
rm -rf "$FAKEGIT"
if [ "$rc" -eq 2 ] || [ "$rc" -eq 0 ]; then
  ok "降级: git 异常路径被处理（exit ${rc}，非崩溃）"
else
  no "降级: git 异常未妥善处理, exit ${rc}"
fi

# ── HTML: --html 生成自包含页面（三面板；FIX-008: 落在隔离目录）──
HTML=$(GENRUN --offline --html 2>&1)
if grep -q "已生成" <<< "$HTML" && [ -f "$OUTDIR/founder-console.html" ]; then
  ok "HTML: 生成自包含页面 founder-console.html（隔离目录）"
else
  no "HTML: 页面生成失败"
fi

# ── B6: 无崩溃（修前 claim 行缺键 ⇒ KeyError；修后 exit ∈ {0,1}，不许 2）──
GENRUN --offline >/dev/null 2>&1
FT_RC=$?
if ! grep -q "Traceback" <<< "$OUT" && { [ "$FT_RC" -eq 0 ] || [ "$FT_RC" -eq 1 ]; }; then
  ok "无崩溃: --offline 输出无 Traceback，且 exit=${FT_RC} ∈ {0,1}"
else
  no "无崩溃: 崩溃或退出码异常（Traceback 行数=$(grep -c Traceback <<< "$OUT")，exit=${FT_RC}）"
fi

# ── B6: claim 行标注（迁移期 claim 必须显式标注"未核验"，不硬编码 issue 号）──
if grep -qE '^\| #[0-9]+ +\| claimed\(claim\) \| 未核验' <<< "$OUT"; then
  ok "claim 行: 显式标注「未核验（claim 无 D# 锚点）」"
else
  no "claim 行: 缺未核验标注（迁移期 claim 未显式声明物理核验口径）"
fi

# ── B6: 契约成对反例（照 FIX-008 ⒜/⒝ 范式；同一检查器两侧各跑一次 ⇒ 判据非恒真）──
#   ⒜ 真行: collect() 的 claim 行三键齐 ⇒ missing=0 且 claims>0
#   ⒝ 合成 legacy 行（缺 id/title/phys 三键）⇒ 同一检查器 missing=3
CONTRACT=$(python3 - "$GEN" 2>&1 <<'PY'
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("founder_truth_under_test", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

REQUIRED = ("id", "title", "phys")  # B6 W1 补的 3 键（行契约见 dev doc C1）


def missing_keys(row):
    return sum(1 for k in REQUIRED if k not in row)


rows, _git_ok = mod.collect(offline=True)
real_claims = [r for r in rows if r.get("migration")]
missing_real = sum(missing_keys(r) for r in real_claims)
# 修复前的 6 键 legacy claim 行（task_id/num/claimed/hist/source/migration）
legacy = [{"task_id": "#9999", "num": None, "claimed": "claimed(claim)",
           "hist": False, "source": ".claude/claims/9999.yaml", "migration": True}]
missing_legacy = sum(missing_keys(r) for r in legacy)
print("⒜ real missing=%d claims=%d" % (missing_real, len(real_claims)))
print("⒝ legacy missing=%d" % missing_legacy)
sys.exit(0 if (missing_real == 0 and len(real_claims) > 0 and missing_legacy == 3) else 1)
PY
)
CRC=$?
while IFS= read -r ln; do echo "  [契约] $ln"; done <<< "$CONTRACT"
if [ "$CRC" -eq 0 ] && grep -q "⒜ real missing=0 claims=[1-9]" <<< "$CONTRACT" \
   && grep -q "⒝ legacy missing=3" <<< "$CONTRACT"; then
  ok "契约⒜⒝: 真行 missing=0 且 claims>0；缺 3 键合成行 missing=3（判别性成立）"
else
  no "契约⒜⒝: 判别性不成立（rc=${CRC}；见上方 [契约] 原始输出）"
fi

# ═══════════════════════════════════════════════════════════════
# FIX-008 判别性夹具: 测试输出隔离（成对反例 ⒜ 干净 / ⒝ 报红）
# ═══════════════════════════════════════════════════════════════
# ⒜ 隔离: 上面两次生成（--offline / --offline --html）均已跑完 → 仓库不得变脏
AFTER_DIRTY=$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')
D_REPO=$(gen_paths_dirty "$REPO")
echo "  [⒜] 仓库脏度: 跑测试前=${BEFORE_DIRTY} 跑测试后=${AFTER_DIRTY}；生成物 porcelain 行数: 前=${BEFORE_GEN} 后=${D_REPO}"
if [ "$D_REPO" -eq 0 ]; then
  ok "FIX-008⒜ 隔离: 仓库两个 tracked 生成物 git status 为空（绝对判据，基线干净时必满足）"
elif [ "$D_REPO" -le "$BEFORE_GEN" ]; then
  ok "FIX-008⒜ 隔离: 生成物脏度未增加（前=${BEFORE_GEN} 后=${D_REPO}；基线非零=他人未提交改动，非本测试副作用）"
else
  no "FIX-008⒜ 隔离失败: 生成物被本测试写脏（前=${BEFORE_GEN} 后=${D_REPO}）"
fi
if [ "$AFTER_DIRTY" -le "$BEFORE_DIRTY" ]; then
  ok "FIX-008⒜ 隔离: 本测试未增加仓库脏度（前=${BEFORE_DIRTY} 后=${AFTER_DIRTY}）"
else
  no "FIX-008⒜ 隔离失败: 仓库脏度增加（前=${BEFORE_DIRTY} 后=${AFTER_DIRTY}）"
fi
[ -s "$OUTDIR/founder-console.html" ] \
  && ok "FIX-008⒜ 隔离: HTML 实落在隔离目录（非仓库）" || no "FIX-008⒜ 隔离目录内未见 HTML"

# ⒝ 反例（沙箱 git 仓，**绝不在真仓库制造脏树**）: 同一判据在脏树必须报红 ⇒ 判据非恒真
SBX="$(mktemp -d)"
git -C "$SBX" init -q
git -C "$SBX" -c user.email=t@t.local -c user.name=t config user.email t@t.local
git -C "$SBX" -c user.email=t@t.local -c user.name=t config user.name t
mkdir -p "$SBX/docs/synova"
printf '# console\n' > "$SBX/docs/synova/founder-console.html"
git -C "$SBX" add -A >/dev/null 2>&1
git -C "$SBX" -c user.email=t@t.local -c user.name=t commit -q -m base
D_BEFORE=$(gen_paths_dirty "$SBX")
printf '# console modified by test\n' >> "$SBX/docs/synova/founder-console.html"
D_AFTER=$(gen_paths_dirty "$SBX")
echo "  [⒝] 沙箱脏树: 改动前 porcelain 行数=${D_BEFORE} → 故意改 tracked 后=${D_AFTER}"
{ [ "$D_BEFORE" -eq 0 ] && [ "$D_AFTER" -ge 1 ]; } \
  && ok "FIX-008⒝ 反例: 同一判据在脏树报红（判别性成立，非恒真）" \
  || no "FIX-008⒝ 反例失败: 判据不判别（前=${D_BEFORE} 后=${D_AFTER}）"
rm -rf "$SBX"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
