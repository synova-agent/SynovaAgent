#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# hard-gate-convergence.test.sh — D515 项3 / D1148: 提交端硬阻断收敛
#
# 10 类历史拦截场景（源自 pre-commit-failures.log 真实案例类别）:
#   4 质量根（硬阻断）: ①as any ②测试配对+expect ③Secrets ④接线物理事实
#     + 特例 G12d 生成物单点 / G13 技能同步（spec 明示保留）
#   3 声明类硬闸（D1148 合并 15→3）: ①brief schema ②brief↔代码一致性 ③可证伪 Done
#   旁路（只打印、不判红、不进 gate-hits）: Q0c、plan-integrity non-Q2、
#     G12c dev doc 写集、G12d 声称↔证据表
#   ↳ D1171（P0-5）撤旁路复执法: D782 D1/D2、D734 预算 → v5_soft（本地软/CI strict 硬）
#   ↳ D1176（K3 整改）: 验收 CI 同转 v5_soft（处置表行#5 理由不成立，唯一调用点无执行方）
#   退役: opt_check「PRD 对照」（261 次命中/永不阻断，注释指向 D1148）
#   软提示（不拦本地提交）: 架构边界 ⑥契约门禁 ⑧empty catch ⑩DiagnosticModule/专家配置
# 覆盖矩阵: 结构断言（硬/旁路/退役归属）+ 行为断言（as any 实拦 / 闸② 实拦 + 沙箱降软）
# 沙箱: 行为断言在本仓库暂存探针文件，trap 保证清理（禁止 stash，铁律 0-3）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PC="$REPO/scripts/pre-commit-check.sh"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
PROBE1="$REPO/src/tmp-d515-asany-probe.ts"
PROBE2="$REPO/scripts/tmp-d515-scope-probe.json"
cleanup() {
  # 逐个清理（一次性多 pathspec 在其中一个不存在时会整体失败——本测试踩过的坑）
  for f in "$PROBE1" "$PROBE2"; do
    git -C "$REPO" restore --staged -- "$f" >/dev/null 2>&1 || true
    git -C "$REPO" rm --cached -q -- "$f" >/dev/null 2>&1 || true
  done
  rm -f "$PROBE1" "$PROBE2"
}
trap cleanup EXIT

echo "=== D515 项3: 硬阻断收敛（10 场景：4 保 6 放）==="

# ── 结构断言: 4 质量根 + 2 特例仍是 hard_check ──
KEEP_HARD=(
  'hard_check "as any / as never / as unknown as 零容忍（新增，铁律 38；存量独立清理）"'
  'hard_check "新文件配对: impl 须同 commit 有 test"'
  'hard_check "桩测试: 新测试需 ≥3 expect()"'
  'hard_check "接线审计: 新 export 必须被引用 (物理事实)"'
  'hard_check "接线深度: 新 export 必须被调用(非仅 import)"'
  'hard_check "G12d: 生成物单点生成门禁 (D458)"'
  'hard_check "G13: 技能漂移'
)
for k in "${KEEP_HARD[@]}"; do
  grep -qF "$k" "$PC" && ok "保[硬]: $k" || no "质量根被误降级: $k"
done
# D1148: 声明类三闸 —— 生产（真提交）路径硬阻断 = decl_check；夹具沙箱（SYNO_TEST_ARM/
#   SYNO_BRIEF_DIR/SYNO_GIT_CACHED_* 注入）降软，理由见脚本 _SANDBOX 注释（D749）。
#   本夹具断言的是"生产路径仍是硬闸"：decl_check 在非沙箱下派发 hard_check。
KEEP_DECL=(
  'decl_check "声明闸① brief schema'
  'decl_check "声明闸② brief↔代码一致性'
  'decl_check "声明闸③ Done 可证伪'
)
for k in "${KEEP_DECL[@]}"; do
  grep -qF "$k" "$PC" && ok "保[硬/声明闸]: $k" || no "声明类硬闸缺失/被降级: $k"
done
# Secrets 仍硬: secrets 收集失败 → HARD_FAIL（D1148: 收集器改 par_collect_quiet 以降噪，
#   判据口径不变——仍是「失败即 HARD_FAIL」，此处两种收集器形态都接受）
grep -qE 'par_collect(_quiet)? secrets.*HARD_FAIL' "$PC" && ok "保[硬]: Secrets (收集失败 → HARD_FAIL)" || no "Secrets 被降级"

# ── 结构断言: D1148 转旁路的检查点必须**真的在旁路**（只打印、不判红、不进 gate-hits）──
# 断言一律只看**代码行**（= 去掉行首 # 注释后的正文）——退役/转旁路的留痕注释会逐字引用
#   旧调用形态（"原 `par_collect … || v5_soft "…"` → 转旁路"），拿全文件 grep 会让留痕注释
#   把反向断言打成假红（本夹具首轮实测踩到）。
# ⚠️ pipefail 陷阱（实测 rc=141，同类：today-by-name.test.sh 断言 9）：`pc_code | grep -qF …`
#   的 grep -q 命中即提前退出 → 左侧 grep 收 SIGPIPE(141) → pipefail 把**真实接线判成缺失**。
#   故 pc_code 只落一次文件，全部断言 grep 文件。
PC_CODE_FILE="$(mktemp)"
cleanup_all() { cleanup; rm -f "$PC_CODE_FILE"; }
trap cleanup_all EXIT
pc_code() { grep -vE '^[[:space:]]*#' "$PC"; }
pc_code > "$PC_CODE_FILE" || true
pcgrep() { grep -qF -- "$1" "$PC_CODE_FILE"; }
KEEP_BYPASS=(
  'note_check "plan-integrity: non-Q2 项'
  'note_check "G12c dev doc 写集验证'
  'note_check "G12d 声称↔证据对照表'
)
# D1219（卡 #1225 旁路清场）: 三条 note_check 第三态已退役（立法 §7.1-2 禁旁路第三态）
#   ⇒ 由「断言存在」**反转为「断言不在代码路径」**（反向断言 = 改坏即红：加回任一 note_check ⇒ 本夹具红）。
for k in "${KEEP_BYPASS[@]}"; do
  if pcgrep "$k"; then no "退役项仍在代码路径（D1219 禁第三态）: $k"; else ok "已退役[第三态清零]: $k"; fi
done
# 退役留痕可核（防「删了就算」：注释层仍须指向 D1219）
grep -q 'D1219' "$PC" && ok "退役留痕: 注释指向 D1219" || no "退役未留痕（缺 D1219 注释）"
# D1219: 三处「脚本缺失 fallback」→ **检查自身失败态**（同样阻断；禁降级为旁路观测 = 假绿）
KEEP_SELF_FAIL=(
  'self_fail_missing_script "D782 D1 文档真相"'
  'self_fail_missing_script "D782 D2 登记门禁"'
  'self_fail_missing_script "D734 PR 预算"'
)
for k in "${KEEP_SELF_FAIL[@]}"; do
  pcgrep "$k" && ok "自身失败态[D1219]: $k" || no "脚本缺失 fallback 未改自身失败态: $k"
done
for bad in 'note_check "D782 D1' 'note_check "D782 D2' 'note_check "D734 PR 预算（脚本缺失）'; do
  if pcgrep "$bad"; then no "脚本缺失仍走旁路观测（禁静默放行）: $bad"; else ok "已离开旁路观测: $bad"; fi
done
if pcgrep 'self_fail_missing_script() {'; then
  ok "自身失败态实现: 单一函数（非 3 处内联副本）"
else
  no "自身失败态实现缺失（self_fail_missing_script 未定义）"
fi
# ── D1171（P0-5）: 三处撤旁路复执法 —— 必须 v5_soft（本地软/CI strict 硬）──
KEEP_V5SOFT=(
  'v5_soft "D782 D1 文档真相（D1171 撤旁路复执法）"'
  'v5_soft "D782 D2 登记门禁（D1171 撤旁路复执法）"'
  'v5_soft "D734 PR 预算（D1171 撤旁路复执法）"'
  'v5_soft "验收 CI (V3.9)（D1176 K3 整改复执法）"'
)
for k in "${KEEP_V5SOFT[@]}"; do
  pcgrep "$k" && ok "撤旁路[D1171]: $k" || no "应 v5_soft 却缺失/被回退: $k"
done
# D1148: q0c 不转旁路而是**并入闸①**（Q0 系列成员）——按此断言（spec: 闸① = …+Q0 系列）
if pcgrep 'check-q0c-tracking.sh' && pcgrep '${Q0C_MSG}'; then
  ok "并入闸①: Q0c 取消跟踪（Q0 系列成员，不再是独立执行点）"
else
  no "闸① 未收编 Q0c（Q0 系列成员缺失）"
fi
# 反向断言: 旁路/收编项不得仍挂在阻断路径上（只看代码行；hard_check/soft_check 命中即判红）
for bad in 'hard_check "D734' 'soft_check "D1 文档真相' 'v5_soft "plan-integrity' 'v5_soft "Q0c' 'bypass_run "D782' 'bypass_run "D734' 'note_check "验收 CI'; do
  if pcgrep "$bad"; then no "旁路项仍在阻断路径: $bad"; else ok "已离开阻断路径: $bad"; fi
done
# D1148 退役: opt_check（PRD 对照，261 次命中/永不阻断）检查点 + 死函数必须清零
if pcgrep 'opt_check'; then no "退役项 opt_check 仍在代码路径（PRD 对照应有注释指向 D1148）"; else ok "退役: opt_check 检查点与死函数清零"; fi
grep -q 'D1148' "$PC" && ok "退役留痕: 注释指向 D1148" || no "退役未留痕（缺 D1148 注释）"
# 降噪机制接线: 成功静默开关 + 组 7a 显式保留 ✅（gate-failopen-net.test.sh 判据输入）
grep -qF 'QUIET_SUCCESS="${SYNO_QUIET_SUCCESS:-1}"' "$PC" && ok "降噪: 成功静默开关赋值接线（整轮可被 SYNO_QUIET_SUCCESS 覆盖）" || no "成功静默开关未接线"
# 缺省**打印**语义: 静默开关必须来自一次赋值（51 行区），绝不能写进函数条件本体——
#   否则 `sed -n '42,44p;47p'` 提取的片段（ci-strict-visible.test.sh）里变量为空 ⇒ 断言恒红。
#   本条即该坑（首轮实测踩到）的物理防线。
if grep -qF '[ "${SYNO_QUIET_SUCCESS' "$PC_CODE_FILE"; then
  no "函数条件内联 SYNO_QUIET_SUCCESS（提取片段将静默 ⇒ ci-strict-visible 假红）"
else
  ok "静默条件用 \${QUIET_SUCCESS:-0}（缺省=打印，提取片段语义安全）"
fi
grep -q 'QUIET_SUCCESS=0 soft_check "禁止 DiagnosticModule' "$PC" && ok "降噪例外: 组 7a ✅ 行显式保留" || no "组 7a ✅ 行被静默（将打破 gate-failopen-net 判别）"
grep -q 'QUIET_SUCCESS=0 decl_check "声明闸' "$PC" && ok "降噪例外: 三闸 ✅ 行显式保留（收敛可核）" || no "三闸 ✅ 行被静默"

# ── 结构断言: 降级的检查点（软提示，不拦本地提交）──
KEEP_SOFT=(
  'soft_check "架构边界: 禁止跨层引用 (铁律 39)"'
  'soft_check "契约门禁: 声明产出须在暂存区"'
  'soft_check "empty catch 无 log (铁律 24+31)"'
  'soft_check "禁止 DiagnosticModule: 新模块须实现 Sentinel 接口"'
)
for k in "${KEEP_SOFT[@]}"; do
  grep -qF "$k" "$PC" && ok "放[软]: $k" || no "未按 spec 降软: $k"
done
grep -q 'V5 软提示——CI 为权威，本地不阻断' "$PC" && ok "soft_check 输出标记 V5 软提示" || no "软提示标记缺失"
grep -q '⚠ V5: \${SOFT_COUNT} 项软提示' "$PC" && ok "结果汇总行存在（X 项软提示）" || no "汇总行缺失"

# ── 行为断言A: as any 探针 → 实际硬拦（exit 1）──
echo 'export const probeVal = (x: unknown) => x as any;' > "$PROBE1"
git -C "$REPO" add -- "$PROBE1" >/dev/null 2>&1
OUTA=$(cd "$REPO" && SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rcA=$?
[ "$rcA" -eq 1 ] && ok "行为A: as any 探针被硬拦 (exit 1)" || no "行为A: 应 exit 1, 实际 $rcA"
echo "$OUTA" | grep -q "as any / as never / as unknown as 零容忍" && ok "行为A: 命中 as any 零容忍检查点" || no "行为A: 未点名 as any"
echo "$OUTA" | grep -q "提交已拒绝" && ok "行为A: 硬失败输出「提交已拒绝」标记" || no "行为A: 缺硬失败标记"
cleanup

# ── 行为断言A2 (CT-46): as never 探针 → 硬拦（mcp L236 同型逃逸）──
echo 'export const probeNever = (x: unknown) => x as never;' > "$PROBE1"
git -C "$REPO" add -- "$PROBE1" >/dev/null 2>&1
OUTA2=$(cd "$REPO" && SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rcA2=$?
[ "$rcA2" -eq 1 ] && ok "行为A2: as never 探针被硬拦 (exit 1)" || no "行为A2: 应 exit 1, 实际 $rcA2"
echo "$OUTA2" | grep -q "as any / as never / as unknown as 零容忍" && ok "行为A2: 命中扩展检查点" || no "行为A2: 未点名 as never"
cleanup

# ── 行为断言A3 (CT-46): as unknown as 双断言链 → 硬拦 ──
echo 'export const probeDouble = (x: unknown) => x as unknown as string;' > "$PROBE1"
git -C "$REPO" add -- "$PROBE1" >/dev/null 2>&1
OUTA3=$(cd "$REPO" && SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rcA3=$?
[ "$rcA3" -eq 1 ] && ok "行为A3: as unknown as 双断言被硬拦 (exit 1)" || no "行为A3: 应 exit 1, 实际 $rcA3"
cleanup

# ── 行为断言A4 (CT-46): 裸 as unknown（合法中间态）→ 不拦（exit 0，防过度阻断）──
# 设计: 追加行到已有跟踪文件（新建 .ts 文件会触发"新文件配对"门禁，测不到组 1 本意）
# D1148 修（夹具与 D749 语义漂移）: 原实现不加沙箱缝 → 声明三闸（生产路径硬）把未认领的
#   探针宿主判红，断言实际测的是"G12 是否报未认领"而非"组 1 是否误拦"（改前 6 红之一）。
#   加 SYNO_TEST_ARM=1 只把**声明三闸**降到沙箱软档；组 1 的 hard_check 不受影响
#   （A/A2/A3 仍证明组 1 硬拦，故本断言仍只测组 1 边界）。
PROBE_HOST="$REPO/src/agent/diagnosis-launcher.ts"
echo "" >> "$PROBE_HOST"
echo 'const __probeA4 = (x: unknown) => x as unknown; // CT-46 probe' >> "$PROBE_HOST"
git -C "$REPO" add -- "$PROBE_HOST" >/dev/null 2>&1
OUTA4=$(cd "$REPO" && SYNO_TEST_ARM=1 SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rcA4=$?
[ "$rcA4" -eq 0 ] && ok "行为A4: 裸 as unknown 不误拦 (exit 0)" || no "行为A4: 应 exit 0, 实际 $rcA4 :: $(echo "$OUTA4" | grep -B2 '提交已拒绝' | head -8)"
git -C "$REPO" restore --staged --worktree -- "$PROBE_HOST" >/dev/null 2>&1 || true
cleanup

# ── 行为断言B (D1148): G12 越界（无 brief 认领的探针）→ **真提交路径硬拦**（声明闸②）──
# 改前状态: G12 走 decl_check → 非沙箱下已硬拦，但本夹具期望"软放行"（夹具与 D749 语义漂移，
#   改前 6 红之一）。D1148 spec 明示闸② = brief↔代码一致性 = 硬闸 ⇒ 生产路径必须 exit 1
#   且点名闸② + 探针文件（报告能力不减）。
echo '{}' > "$PROBE2"
git -C "$REPO" add -- "$PROBE2" >/dev/null 2>&1
OUTB=$(cd "$REPO" && SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rcB=$?
[ "$rcB" -eq 1 ] && ok "行为B: G12 越界在真提交路径被闸② 硬拦 (exit 1)" || no "行为B: 应 exit 1, 实际 $rcB"
echo "$OUTB" | grep -q "声明闸②" && ok "行为B: 失败点名声明闸②（M1 类失败不点名的反向防线）" || no "行为B: 未点名闸②"
echo "$OUTB" | grep -q "tmp-d515-scope-probe.json" && ok "行为B: 越界文件被点名（报告能力不减）" || no "行为B: 越界文件未点名"
echo "$OUTB" | grep -q "提交已拒绝" && ok "行为B: 硬失败输出「提交已拒绝」标记" || no "行为B: 缺硬失败标记"
# B2: 沙箱档（夹具注入缝）→ 声明闸降软，不阻断（测试/夹具友好性保留，D749 语义）
OUTB2=$(cd "$REPO" && SYNO_TEST_ARM=1 SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rcB2=$?
[ "$rcB2" -eq 0 ] && ok "行为B2: 沙箱档下闸② 降软不阻断 (exit 0)" || no "行为B2: 应 exit 0, 实际 $rcB2"
echo "$OUTB2" | grep -q "tmp-d515-scope-probe.json" && ok "行为B2: 沙箱档下仍点名越界文件" || no "行为B2: 沙箱档下未点名"
cleanup

cleanup

# ── 行为断言C (D1171/P0-5): 未登记 .md 探针 → CI strict 下 D782 D2 硬拦；本地软放 ──
# 改坏即红闭环: 若把 D2 的 v5_soft 块改回 bypass_run（旁路），C1 即红（旁路不判红 ⇒ exit 0）。
# 探针用根级 .yaml 而非 docs/*.md: CT-34 纯文档早退（豁免 12 组）会把纯文档提交挡在
#   D782 块之前——.yaml 不在白名单 ⇒ 走全量路径 ⇒ 到达 D2 判定点（首轮实测踩到）。
PROBE3="$REPO/tmp-d1171-unregistered-probe.yaml"
cleanup3() { git -C "$REPO" restore --staged -- "$PROBE3" >/dev/null 2>&1 || true
  git -C "$REPO" rm --cached -q -- "$PROBE3" >/dev/null 2>&1 || true; rm -f "$PROBE3"; }
trap cleanup3 EXIT
printf 'probe: d1171\n' > "$PROBE3"
git -C "$REPO" add -- "$PROBE3" >/dev/null 2>&1
OUTC=$(cd "$REPO" && SYNO_CI=1 SYNO_TEST_ARM=1 SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rcC=$?
[ "$rcC" -eq 1 ] && ok "行为C1: 未登记 .md 在 CI strict 下被 D2 硬拦 (exit 1)" || no "行为C1: 应 exit 1, 实际 $rcC :: $(echo "$OUTC" | grep -B2 '提交已拒绝' | head -6)"
echo "$OUTC" | grep -q "D782 D2 登记门禁" && ok "行为C1: 点名 D782 D2 登记门禁" || no "行为C1: 未点名 D2"
OUTC2=$(cd "$REPO" && SYNO_TEST_ARM=1 SYNO_GATEKEEPER_ACK=1 SYNO_SKIP_PARALLEL_WARN=1 \
  SYNO_GATE_HITS_LOG="$(mktemp)" bash "$PC" 2>&1); rcC2=$?
[ "$rcC2" -eq 0 ] && ok "行为C2: 本地（非 CI strict）同一探针软放行 (exit 0)" || no "行为C2: 应 exit 0, 实际 $rcC2"
echo "$OUTC2" | grep -q "D782 D2 登记门禁" && ok "行为C2: 本地仍点名 D2（报告可见，软提示）" || no "行为C2: 本地未点名 D2（静默 = 违铁律 11）"
cleanup3

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
