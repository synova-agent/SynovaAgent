#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-doc-truth.sh — 文档真相验证（治理机制 #2，见 docs/authority/GOVERNANCE.md）
#
# 契约（铁律 47 契约优先）:
#   输入:  仓库根目录（自动 git 探测；测试可传 DOC_TRUTH_ROOT 覆盖）
#   输出:  每项检查 ✅/❌/⚠️ + 汇总
#   退出码（D1133 起为三态，沿用 D328 范式）:
#     0 = 全部硬检查通过（可含 ⚠️ 警告）
#     1 = 存在硬失败（文档与事实不一致）
#     2 = **不可判定 ⇒ fail-closed**（版本真源 AGENTS.md 缺失/不可解析，
#         或 C3 判定面文件缺失/不可解析）。2 绝不与 0 混同。
#   降级:  事实源文件缺失（registry / pre-commit-check.sh）→ 该检查降级为
#          ⚠️ 警告并跳过（禁止静默降级，铁律 24/31）
#
# v1.0 (2026-08-19, DSH 架构线) — 四项硬检查 + 一项警告:
#   C1 专家数:    AGENTS.md / knowledge/shared/README.md 的
#                "N 位专家"声明 vs expert/expert-registry.yaml 实际启用数
#   C2 门禁组数:  AGENTS.md / LOOP.md 的 "pre-commit N 组" 声明 vs
#                scripts/pre-commit-check.sh 自声明组数（"全部 N 组通过"行）
#   C3 版本一致:  **单一真源 = AGENTS.md 头部第 1 个 V#.#.#**；判定面内其他文件
#                （LOOP.md）版本号必须**等于**该源
#   C4 路径存在:  权威层文档必须存在（CHRONICLE/INDEX/START-HERE/docs/authority/*）
#   W1 版本滞后:  文档版本 vs 最新 git tag（版本轴可能不同，仅警告不阻断）
#
# v1.1 (2026-10-03, D1133) — CLAUDE.md 退役配套改造（**门禁语义变更，需 K3 过审**）:
#   ① C1/C2 判定面移出 `CLAUDE.md`（退役为指针件，不再承载"N 位专家"/"N 组"声明）
#   ② C3 从「三处互相一致」（三源等价）改为「**单一真源 = AGENTS.md**，
#      其他文件必须等于该源」⇒ 改版本号只需改 1 处
#   ③ 版本真源缺失/不可解析 ⇒ **exit 2 fail-closed**（原为 ⚠️ 后继续判 0）
#   ④ `CLAUDE.md` 移出 C3 判定面：**只读存在性、不读内容**（兼容期提示用）
#   ⚠️ 顺序约束：本改造必须先于（或同 PR 于）CLAUDE.md 退役件落地，
#      否则中间态会出现 C1/C2 各 1 处 ⚠️（非红，但属噪音）
# ═══════════════════════════════════════════════════════════════════════════════
set +e

ROOT="${DOC_TRUTH_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" # swallow-ok:
HARD_FAIL=0
WARN_COUNT=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'

check() { # $1=名称 $2=通过(0/1) $3=说明
  if [ "$2" -eq 0 ]; then
    echo -e "  ${GREEN}✅ $1${RESET} — $3"
  else
    echo -e "  ${RED}❌ $1${RESET} — $3"; HARD_FAIL=$((HARD_FAIL+1))
  fi
}
warn() { echo -e "  ${YELLOW}⚠️  $1${RESET} — $2"; WARN_COUNT=$((WARN_COUNT+1)); }

echo "═══ check-doc-truth.sh v1.0 — 文档真相验证 (root: $ROOT) ═══"

# ---- C1 专家数 ----
REGISTRY="$ROOT/expert/expert-registry.yaml"
if [ -f "$REGISTRY" ]; then
  TRUTH_EXPERTS=$(grep -cE '^  [a-z0-9_-]+:$' "$REGISTRY")
  # D1133: 判定面移出 CLAUDE.md（退役为指针件，不再承载"N 位专家"声明）
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
PCC="$ROOT/scripts/pre-commit-check.sh"
if [ -f "$PCC" ]; then
  TRUTH_GROUPS=$(grep -oE '全部 [0-9]+ 组通过' "$PCC" | grep -oE '[0-9]+' | head -1)
  if [ -n "$TRUTH_GROUPS" ]; then
    # D1133: 判定面移出 CLAUDE.md（退役为指针件，不再承载"N 组"声明）
    for f in AGENTS.md LOOP.md; do
      [ -f "$ROOT/$f" ] || continue
      # 两段式提取：先剔除"第 N 组硬阻断"行（引用某组的行，非总数声明），再提取计数
      CLAIM=$(grep -vE '第.*组硬阻断' "$ROOT/$f" | grep -oE '[0-9]+ 组 pre-commit|pre-commit [0-9]+ 组|[0-9]+ 组硬阻断' | grep -oE '[0-9]+' | head -1)
      if [ -n "$CLAIM" ]; then
        if [ "$CLAIM" -eq "$TRUTH_GROUPS" ]; then
          check "C2 门禁组数 ($f)" 0 "$CLAIM = pre-commit-check.sh $TRUTH_GROUPS"
        else
          check "C2 门禁组数 ($f)" 1 "$CLAIM ≠ pre-commit-check.sh $TRUTH_GROUPS"
        fi
      else
        warn "C2 门禁组数 ($f)" "未找到组数声明"
      fi
    done
  else
    warn "C2 门禁组数" "degraded: $PCC 无 '全部 N 组通过' 行"
  fi
else
  warn "C2 门禁组数" "degraded: $PCC 不存在"
fi

# ---- C3 版本一致（D1133: 单一真源 = AGENTS.md）----
# 语义变更: 由「AGENTS/CLAUDE/LOOP 三处互相一致」（= 三源等价，改一处要对三处）
#   改为「**单一真源 AGENTS.md** + 其他文件必须等于该源」（改一处即可）。
# CLAUDE.md 已退役为指针件 ⇒ **移出判定面**（只读存在性，不读内容）。
VER_SOURCE_FILE="AGENTS.md"
VER_JUDGE="LOOP.md"
VER_SOURCE=""
if [ -f "$ROOT/$VER_SOURCE_FILE" ]; then
  VER_SOURCE=$(grep -oE 'V[0-9]+\.[0-9]+\.[0-9]+' "$ROOT/$VER_SOURCE_FILE" 2>/dev/null | head -1) # swallow-ok: 空=下方判 fail-closed
fi
if [ -z "$VER_SOURCE" ]; then
  echo -e "  ${RED}❌ C3 版本真源不可解析${RESET} — $VER_SOURCE_FILE 缺失或无 V#.#.# 版本号"
  echo -e "${RED}❌ 版本一致性无法判定（fail-closed, D328 三态）— exit 2${RESET}"
  exit 2
fi
VER_JUDGE_VAL=$(grep -oE 'V[0-9]+\.[0-9]+\.[0-9]+' "$ROOT/$VER_JUDGE" 2>/dev/null | head -1) # swallow-ok: 空=下方判 fail-closed
if [ ! -f "$ROOT/$VER_JUDGE" ] || [ -z "$VER_JUDGE_VAL" ]; then
  echo -e "  ${RED}❌ C3 判定面不可判定${RESET} — $VER_JUDGE 缺失或无 V#.#.# 版本号"
  echo -e "${RED}❌ 版本一致性无法判定（fail-closed, D328 三态）— exit 2${RESET}"
  exit 2
fi
if [ "$VER_JUDGE_VAL" = "$VER_SOURCE" ]; then
  check "C3 版本一致" 0 "$VER_JUDGE=$VER_JUDGE_VAL = 真源 $VER_SOURCE_FILE=$VER_SOURCE"
else
  check "C3 版本一致" 1 "$VER_JUDGE=$VER_JUDGE_VAL ≠ 真源 $VER_SOURCE_FILE=$VER_SOURCE"
fi
# 兼容期（D1133）：CLAUDE.md 存在与否**不影响判定**，仅提示其已移出判定面
if [ -f "$ROOT/CLAUDE.md" ]; then
  echo -e "  ${CYAN}ℹ️  C3 兼容: CLAUDE.md 存在，但已移出版本判定面（退役指针件，内容不参与判定）${RESET}"
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
if [ -n "$LATEST_TAG" ] && [ -n "$VER_SOURCE" ] && [ "$LATEST_TAG" != "$VER_SOURCE" ]; then
  warn "W1 版本滞后" "文档头部 $VER_SOURCE vs 最新 tag ${LATEST_TAG}（版本轴可能不同，仅提示）"
fi

echo "── 汇总 ──"
if [ "$HARD_FAIL" -gt 0 ]; then
  echo -e "  ${RED}❌ $HARD_FAIL 项硬失败 — 文档与事实不一致，请修正后重试${RESET}"
  exit 1
fi
[ "$WARN_COUNT" -gt 0 ] && echo -e "  ${YELLOW}⚠️  $WARN_COUNT 项警告${RESET}"
echo -e "  ${GREEN}✅ 全部硬检查通过${RESET}"
exit 0
