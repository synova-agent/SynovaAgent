#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（与 scripts/doc-system/ 同域脚本一致）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-truth.sh — 文档真相验证（治理机制 #2，见 docs/authority/GOVERNANCE.md）
#
# 设计哲学（一句）: 真值只从**物理事实**取（脚本实际存在的组横幅数 / registry 实际启用数），
#   绝不从文档或脚本自声明的**字面数字**取——字面数字会与事实一起漂移（#595）。
#
# 契约（铁律 47 契约优先）:
#   @input  — 仓库根（自动 git 探测；DOC_TRUTH_ROOT 可覆盖，供测试/沙箱注入）
#             读取: <root>/AGENTS.md、<root>/LOOP.md、<root>/knowledge/shared/README.md、
#                   <root>/expert/expert-registry.yaml、<root>/scripts/pre-commit-check.sh
#   @truth  — C2 组数真值 = grep -cE '── 组 [0-9]+:' <PCC>（数横幅；非字面总数）
#   @checks — C1 专家数 ｜ C2 组数（① 横幅数 > 0 ② 无 '全部 N 组通过' 字面量
#             ③ 每份文档声明 claim == TRUTH_GROUPS）｜ C3 版本一致 ｜ C4 权威层路径存在
#             ｜ W1 版本滞后（仅警告，不阻断）
#   @output — 每项 ✅/❌/⚠️ 行（失败点含实际计数/命中行）+ `── 汇总 ──` 段
#   @exit   — 0 = 全部硬检查通过（警告不阻断）；1 = 存在硬失败（含 C2 两条硬断言）；
#             本脚本**不使用 exit 2**：检查自身失败（横幅=0 / 字面量回潮）按 C2 硬失败 exit 1
#   @degraded — 事实源文件缺失（registry / pre-commit-check.sh）⇒ 该项 ⚠️ 警告并跳过，
#             继续跑其余项（禁止静默降级，铁律 24/31）
#
# Explicit authority（谁能调）:
#   · scripts/pre-commit-check.sh 的 D782 D1 步（提交端：本地软提示 / CI strict 硬阻断）
#   · .gitea/workflows/local-gates.yml（SYNO_CI=1 权威面）
#   · tests/doc-system/check-doc-truth.test.sh、doc-truth-probe.test.sh（经 DOC_TRUTH_ROOT 注入）
#   · 任何人可手工只读运行（无写入、无网络、无副作用）
#
# v1.0 (2026-08-19, DSH 架构线) — 四项硬检查 + 一项警告:
#   C1 专家数:    AGENTS.md / knowledge/shared/README.md 的
#                "N 位专家"声明 vs expert/expert-registry.yaml 实际启用数
#   C2 门禁组数:  文档 "pre-commit N 组" / "N 组硬阻断" 声明 vs scripts/pre-commit-check.sh
#                **实际组横幅数**（grep -cE '── 组 [0-9]+:'；#595 起不再读字面总数）
#   C3 版本一致:  AGENTS.md / LOOP.md 头部版本号必须一致
#   C4 路径存在:  权威层文档必须存在（CHRONICLE/INDEX/START-HERE/docs/authority/*）
#   W1 版本滞后:  文档版本 vs 最新 git tag（版本轴可能不同，仅警告不阻断）
# v1.1 (2026-10-19, #595) — C2 真值改为"数横幅"＋两条硬断言（禁字面回潮 / 横幅=0 硬失败）
#
# Known Limitations（已知限制）:
#   1. C2 只核 AGENTS.md / LOOP.md 两份文档；其余现行声明（workflow / synova-commit /
#      control-tower 夹具等）靠 tests/control-tower/gate-count-acceptance.test.sh 的 grep
#      断言，不在本脚本内。
#   2. 反例边界：删除组**整块**（含其横幅）⇒ 横幅数下降、C2 红；只删块体而保留横幅 ⇒
#      横幅数不变、C2 **不红**（组号集合/块完整性由自证脚本 DS-11 兜底）。
#   3. 历史件（CHRONICLE.md、已冻结 dev doc、memory/notes 引述）保留旧组数口径
#      （不参与本检查）：全仓 grep 仍有命中，判据必须显式排除历史路径（本脚本只核现行两份文档）。
#   4. 横幅数 = 0 ⇒ C2 硬失败（exit 1）；本脚本**不使用 exit 2**（三态第 3 态不在此件表达）。
# ═══════════════════════════════════════════════════════════════════════════════
set +e

ROOT="${DOC_TRUTH_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" # swallow-ok:
HARD_FAIL=0
WARN_COUNT=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

check() { # $1=名称 $2=通过(0/1) $3=说明
  if [ "$2" -eq 0 ]; then
    echo -e "  ${GREEN}✅ $1${RESET} — $3"
  else
    echo -e "  ${RED}❌ $1${RESET} — $3"; HARD_FAIL=$((HARD_FAIL+1))
  fi
}
warn() { echo -e "  ${YELLOW}⚠️  $1${RESET} — $2"; WARN_COUNT=$((WARN_COUNT+1)); }

echo "═══ check-doc-truth.sh v1.1 — 文档真相验证 (root: $ROOT) ═══"

# ---- C1 专家数 ----
REGISTRY="$ROOT/expert/expert-registry.yaml"
if [ -f "$REGISTRY" ]; then
  TRUTH_EXPERTS=$(grep -cE '^  [a-z0-9_-]+:$' "$REGISTRY")
  for f in AGENTS.md knowledge/shared/README.md; do
    [ -f "$ROOT/$f" ] || continue
    CLAIM=$(grep -oE '[0-9]+位专家' "$ROOT/$f" | grep -oE '[0-9]+' | head -1)
    if [ -n "$CLAIM" ]; then
      if [ "$CLAIM" -eq "$TRUTH_EXPERTS" ]; then
        check "C1 专家数 ($f)" 0 "$CLAIM = registry $TRUTH_EXPERTS"
      else
        check "C1 专家数 ($f)" 1 "$CLAIM ≠ registry $TRUTH_EXPERTS"
      fi
    else
      warn "C1 专家数 ($f)" "未找到 'N 位专家' 声明（可能写法不同，人工确认）"
    fi
  done
else
  warn "C1 专家数" "degraded: $REGISTRY 不存在，跳过"
fi

# ---- C2 门禁组数 ----
# 真值 = 脚本里实际存在的组横幅数（`── 组 N:`）：这是"脚本会跑几组"的物理事实，
# 不是任何写在文档或脚本里的字面总数（#595 前 C2 读字面行 ⇒ 文档与脚本同写一错数即恒绿）。
PCC="$ROOT/scripts/pre-commit-check.sh"
if [ -f "$PCC" ]; then
  TRUTH_GROUPS=$(grep -cE '── 组 [0-9]+:' "$PCC" | tr -d '\n\r') # swallow-ok: 无匹配时 grep 输出 0/exit1，0 即信号量（非吞错）
  TRUTH_GROUPS="${TRUTH_GROUPS:-0}"
  HARDCODED_SUMMARY=$(grep -nE '全部 [0-9]+ 组通过' "$PCC")
  # 硬断言①: 信号量==0 禁当通过（横幅被删/被改名 ⇒ 组数无从谈起，硬失败）
  if [ "$TRUTH_GROUPS" -gt 0 ]; then
    check "C2 真值来源: 组横幅数" 0 "grep -cE '── 组 [0-9]+:' = ${TRUTH_GROUPS}（> 0）"
  else
    check "C2 真值来源: 组横幅数" 1 "硬失败: grep -cE '── 组 [0-9]+:' = 0（信号量==0，禁当通过）"
  fi
  # 硬断言②: 禁硬编码汇总回潮（汇总行必须是运行时计数，不能是字面总数）
  if [ -z "$HARDCODED_SUMMARY" ]; then
    check "C2 真值来源: 无字面组数" 0 "grep -cE '全部 [0-9]+ 组通过' = 0（汇总行为运行时计数）"
  else
    HARDCODED_COUNT=$(printf '%s\n' "$HARDCODED_SUMMARY" | grep -c . | tr -d '\n\r')
    check "C2 真值来源: 无字面组数" 1 "硬失败: '全部 N 组通过' 字面量 ${HARDCODED_COUNT} 处: $(printf '%s' "$HARDCODED_SUMMARY" | head -3 | tr '\n' '|')"
  fi
  if [ "$TRUTH_GROUPS" -gt 0 ]; then
    for f in AGENTS.md LOOP.md; do
      [ -f "$ROOT/$f" ] || continue
      # 两段式提取：先剔除"第 N 组硬阻断"行（引用某组的行，非总数声明），再提取计数
      CLAIM=$(grep -vE '第.*组硬阻断' "$ROOT/$f" | grep -oE '[0-9]+ 组 pre-commit|pre-commit [0-9]+ 组|[0-9]+ 组硬阻断' | grep -oE '[0-9]+' | head -1)
      if [ -n "$CLAIM" ]; then
        if [ "$CLAIM" -eq "$TRUTH_GROUPS" ]; then
          check "C2 门禁组数 ($f)" 0 "${CLAIM} = ${TRUTH_GROUPS}（pre-commit-check.sh 横幅数）"
        else
          check "C2 门禁组数 ($f)" 1 "${CLAIM} ≠ ${TRUTH_GROUPS}（pre-commit-check.sh 横幅数）"
        fi
      else
        warn "C2 门禁组数 ($f)" "未找到组数声明"
      fi
    done
  fi
else
  warn "C2 门禁组数" "degraded: $PCC 不存在"
fi

# ---- C3 版本一致 ----
VER_AGENTS=$(grep -oE 'V[0-9]+\.[0-9]+\.[0-9]+' "$ROOT/AGENTS.md" 2>/dev/null | head -1) # swallow-ok:
VER_LOOP=$(grep -oE 'V[0-9]+\.[0-9]+\.[0-9]+' "$ROOT/LOOP.md" 2>/dev/null | head -1) # swallow-ok:
if [ -n "$VER_AGENTS" ] && [ -n "$VER_LOOP" ]; then
  if [ "$VER_AGENTS" = "$VER_LOOP" ]; then
    check "C3 版本一致" 0 "AGENTS/LOOP 均为 $VER_AGENTS"
  else
    check "C3 版本一致" 1 "AGENTS=$VER_AGENTS LOOP=$VER_LOOP"
  fi
else
  warn "C3 版本一致" "degraded: 版本号缺失 (AGENTS=$VER_AGENTS LOOP=$VER_LOOP)"
fi

# ---- C4 权威层路径存在 ----
for p in CHRONICLE.md INDEX.md START-HERE.md docs/authority/PRD.md docs/authority/ARCHITECTURE.md docs/authority/STATUS.md docs/authority/DOCS-REGISTRY.yaml; do
  if [ -f "$ROOT/$p" ]; then
    check "C4 路径 ($p)" 0 "存在"
  else
    check "C4 路径 ($p)" 1 "缺失"
  fi
done

# ---- W1 版本 vs 最新 tag（仅警告）----
LATEST_TAG=$(git -c safe.directory="$ROOT" -C "$ROOT" tag 2>/dev/null | sort -V | tail -1) # swallow-ok:
if [ -n "$LATEST_TAG" ] && [ -n "$VER_AGENTS" ] && [ "$LATEST_TAG" != "$VER_AGENTS" ]; then
  warn "W1 版本滞后" "文档头部 $VER_AGENTS vs 最新 tag ${LATEST_TAG}（版本轴可能不同，仅提示）"
fi

echo "── 汇总 ──"
if [ "$HARD_FAIL" -gt 0 ]; then
  echo -e "  ${RED}❌ $HARD_FAIL 项硬失败 — 文档与事实不一致，请修正后重试${RESET}"
  exit 1
fi
[ "$WARN_COUNT" -gt 0 ] && echo -e "  ${YELLOW}⚠️  $WARN_COUNT 项警告${RESET}"
echo -e "  ${GREEN}✅ 全部硬检查通过${RESET}"
exit 0
