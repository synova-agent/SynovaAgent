#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Loop Engineering V4.5.1 — check-file-driven.sh
# 文件驱动架构完整性门禁。pre-commit 第8组调用。全部 <2s。
#
# ═══ Anthropic 决策溯源 ═══
# 原则: "先设计验证标准，再设计实现" + "物理强制，零 AI 自律"
# 这个脚本是"文件驱动架构"承诺的物理执法层。没有它，"文件驱动"只是文档里
# 的一句话——和 engine-core 拆分欺诈事故中被反复声称的"已完成拆分"没区别。
# 历史事故: engine-core 拆分被声称完成 4 次，实际全是桥接文件 (铁律 46/47)。
#           同样的模式会在文件驱动架构上重演——除非有物理阻断。
# 决策: 2026-06-22 — 将"文件驱动"从设计承诺升级为可验证的物理约束。
#
# 7 项检查:
#   a. manifest.json 必填字段校验 (staged)                          — 硬阻断
#   b. tags 引用完整性 — JSON 中的 tags 值必须在 tags.json 中存在    — 硬阻断
#   c. 硬编码本体类型回归 — src/ 禁止新增 enum SOGNodeType 成员      — 硬阻断
#   d. extensions/ 目录结构合规 — 新子目录必须有 manifest.json        — 硬阻断
#   e. 🆕 pizza-chain 条件硬阻断 — extensions/ 有变更时测试必须存在   — 条件硬阻断
#   f. 🆕 Feature Flag 审计 — 新增文件驱动路径须有回退 flag           — 硬阻断
#   g. 🆕 旧路径删除审计 — 删除硬编码路径须有对应的 feature flag      — 警告
# ═══════════════════════════════════════════════════════════════════════════════
set +e

HARD_FAIL=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

hard_check() {
  local name="$1" matches="$2"
  local count=0
  [ -n "$matches" ] && count=$(echo "$matches" | grep -c . 2>/dev/null) || count=0
  if [ "$count" -gt 0 ] && [ "${SYNO_GROUP_DOWN:-0}" = "1" ]; then
    echo -e "  ${YELLOW}⚠️  ${name}: ${count} 处  [裁 409 降级 —— 只报不拦]${RESET}"
    echo "$matches" | head -8 | while read -r line; do [ -n "$line" ] && echo "     ${line}"; done
    return 0
  fi
  if [ "$count" -gt 0 ]; then
    echo -e "  ${RED}❌ ${name}: ${count} 处  [硬阻断]${RESET}"
    echo "$matches" | head -8 | while read -r line; do [ -n "$line" ] && echo "     ${line}"; done
    HARD_FAIL=$((HARD_FAIL + 1))
  else
    echo -e "  ${GREEN}✅ ${name}${RESET}"
  fi
}

STAGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null | grep -v node_modules || true)
STAGED_ADDED=$(git diff --cached --name-only --diff-filter=A 2>/dev/null | grep -v node_modules || true)

# ═══ a. manifest.json 必填字段校验 ═══
# Anthropic 决策: 原则 5 "物理强制" — manifest 是扩展的自描述契约。缺字段 = 加载失败 = 静默降级。
# 历史: engine-core 桥接文件伪装成迁移——import 路径合法，manifest 字段缺失同理。
STAGED_MANIFESTS=$(echo "$STAGED" | grep 'manifest\.json$' || true)
MANIFEST_FAIL=""
if [ -n "$STAGED_MANIFESTS" ]; then
  while IFS= read -r mf; do
    [ -z "$mf" ] && continue
    [ ! -f "$mf" ] && continue
    for field in '"$schema"' '"name"' '"version"' '"type"' '"entryPoint"'; do
      if ! grep -q "$field" "$mf" 2>/dev/null; then
        MANIFEST_FAIL="${MANIFEST_FAIL}${mf}: 缺少必填字段 ${field}\n"
      fi
    done
  done <<< "$STAGED_MANIFESTS"
fi
hard_check "manifest.json 必填字段 (\$schema/name/version/type/entryPoint)" "${MANIFEST_FAIL:-}"

# ═══ b. tags 引用完整性 ═══
# Anthropic 决策: 原则 2 — "属性驱动消费，不按类型名硬编码"。tags 是属性驱动的枢纽。
# 标签不在 tags.json → queryByTags 静默返回空 → 新本体类型不可见 → 降级为硬编码。
STAGED_ONTOLOGY_JSON=$(echo "$STAGED" | grep -E 'extensions/ontology/.*\.json$|extensions/industries/.*/node-types/.*\.json$|extensions/industries/.*/edge-types/.*\.json$' || true)
TAGS_FAIL=""
if [ -n "$STAGED_ONTOLOGY_JSON" ] && [ -f "$ROOT/extensions/ontology/tags.json" ]; then
  VALID_TAGS=$(grep -oE '"[a-z_]+"' "$ROOT/extensions/ontology/tags.json" 2>/dev/null | tr -d '"' | sort -u || true)
  while IFS= read -r jf; do
    [ -z "$jf" ] && continue
    [ ! -f "$jf" ] && continue
    FILE_TAGS=$(grep -oE '"tags"[[:space:]]*:[[:space:]]*\[[^]]*\]' "$jf" 2>/dev/null | grep -oE '"[a-z_]+"' | tr -d '"' | grep -v '^tags$' || true)
    for ft in $FILE_TAGS; do
      if ! echo "$VALID_TAGS" | grep -qx "$ft"; then
        TAGS_FAIL="${TAGS_FAIL}${jf}: 标签 '${ft}' 不在 tags.json 合法值中\n"
      fi
    done
  done <<< "$STAGED_ONTOLOGY_JSON"
fi
hard_check "tags 引用完整性 (所有标签值必须在 tags.json 中存在)" "${TAGS_FAIL:-}"

# ═══ c. 硬编码本体类型回归检测 ═══
# Anthropic 决策: 原则 2 + 铁律 46 — 文件驱动架构的核心承诺是"新增类型不改代码"。
# 任何人在 src/ 下新增 enum SOGNodeType 或类型联合 → 直接违反承诺。
# 历史: engine-core 拆分后，20 个桥接文件伪装迁移。同样的模式：有人会说"我在 src/ 里加枚举
#        只是为了方便"，然后文件驱动架构被逐渐侵蚀回硬编码。
ENUM_REGRESS=$(git diff --cached -- "src/**/*.ts" 2>/dev/null | grep "^+.*SOGNodeType\." | grep -v "node_modules\|\.test\." | grep -v "graph-bridge|entity-resolver-l2|engine-graph-store|diagnosis-graph-query|engine-core-adapter|engine-context|engine-core-types|orchestrator-adapter" | head -5 || true)
TYPE_UNION_REGRESS=$(git diff --cached -- "src/**/*.ts" 2>/dev/null | grep "^+.*type.*=.*'.*'.*|.*'.*'.*|.*'.*'" | grep -iv "severity\|category\|priority\|node_modules\|\.test\." | head -5 || true)
REGRESS_FAIL=""
if [ -n "$ENUM_REGRESS" ]; then
  REGRESS_FAIL="${REGRESS_FAIL}检测到新增 SOGNodeType 枚举引用 (应在 extensions/ontology/ 中定义):\n${ENUM_REGRESS}\n"
fi
if [ -n "$TYPE_UNION_REGRESS" ]; then
  REGRESS_FAIL="${REGRESS_FAIL}检测到可能的硬编码类型联合 (应为文件驱动):\n${TYPE_UNION_REGRESS}\n"
fi
hard_check "硬编码类型回归 (禁止在 src/ 新增本体类型定义)" "${REGRESS_FAIL:-}"

# ═══ d. extensions/ 目录结构合规 ═══
# Anthropic 决策: 原则 4 "安全边际" — 每个扩展目录必须有 manifest，否则 ExtensionLoader
# 扫不到 → 静默忽略 → "加了文件但系统没反应" → 信任崩塌。
NEW_EXT_DIRS=$(echo "$STAGED_ADDED" | grep -oE '^extensions/[^/]+' | sort -u || true)
STRUCT_FAIL=""
if [ -n "$NEW_EXT_DIRS" ]; then
  for ed in $NEW_EXT_DIRS; do
    [ -z "$ed" ] && continue
    if [ ! -f "$ROOT/$ed/manifest.json" ]; then
      STRUCT_FAIL="${STRUCT_FAIL}${ed}/: 缺少 manifest.json (每个扩展目录必须包含)\n"
    fi
  done
fi
hard_check "extensions/ 目录结构 (新子目录须有 manifest.json)" "${STRUCT_FAIL:-}"

# ═══ e. 🆕 pizza-chain 条件硬阻断 ═══
# Anthropic 决策: 原则 2 "先设计验证标准，再设计实现"。
# 这是整个文件驱动架构的北极星测试。如果 pizza-chain 测试不存在，"文件驱动"就是不可验证的口号。
#
# 阻断条件:
#   extensions/ 目录下已有核心文件驱动维度 (ontology/ 或 industries/) → pizza-chain 测试必须存在。
#   如果这些目录都不存在 (Phase 0 引导期) → 不阻断。
#
# 为什么是条件阻断而非无条件:
#   Phase 0 (ExtensionLoader 开发期) 时 extensions/ 可能只有空壳，pizza-chain 测试还写不出来。
#   一旦 ontology/ 或 industries/ 有了第一个 JSON Schema 文件，"零代码新增"的承诺就生效了。
PIZZA_TEST="$ROOT/tests/acceptance/zero-code-industry.test.ts"
CORE_ONTOLOGY_EXISTS=""
[ -d "$ROOT/extensions/ontology/node-types" ] && [ "$(ls -A "$ROOT/extensions/ontology/node-types" 2>/dev/null)" ] && CORE_ONTOLOGY_EXISTS="yes"
[ -d "$ROOT/extensions/industries" ] && [ "$(ls -A "$ROOT/extensions/industries" 2>/dev/null | grep -v '^\..*')" ] && CORE_ONTOLOGY_EXISTS="yes"
[ -d "$ROOT/extensions/ontology/edge-types" ] && [ "$(ls -A "$ROOT/extensions/ontology/edge-types" 2>/dev/null)" ] && CORE_ONTOLOGY_EXISTS="yes"

if [ -n "$CORE_ONTOLOGY_EXISTS" ]; then
  # 核心文件驱动维度已存在 → pizza-chain 测试是硬要求
  if [ ! -f "$PIZZA_TEST" ]; then
    echo -e "  ${RED}❌ pizza-chain 验收测试缺失: ${PIZZA_TEST}  [硬阻断]${RESET}"
    echo "     extensions/ontology/ 或 extensions/industries/ 已有内容，"
    echo "     但文件驱动架构的最终验收测试尚未创建。"
    echo "     这意味着'无线拓展'无法被物理验证——可能已被破坏而不自知。"
    echo "     请创建 tests/acceptance/zero-code-industry.test.ts"
    HARD_FAIL=$((HARD_FAIL + 1))
  else
    echo -e "  ${GREEN}✅ pizza-chain 验收测试存在${RESET}"
  fi
else
  # Phase 0 引导期 — 提示但不阻断
  echo -e "  ${YELLOW}⚠️  pizza-chain 验收测试缺失 (Phase 0 引导期 — 暂不阻断)${RESET}"
  echo "     extensions/ontology/ 和 extensions/industries/ 暂无内容。"
  echo "     一旦创建了第一个节点类型或行业模板，pizza-chain 测试即为硬要求。"
fi

# ═══ f. 🆕 Feature Flag 审计 — 新增文件驱动路径须有回退 flag ═══
# Anthropic 决策: 原则 4 "安全边际" — 每一步可回滚。
# 新增文件驱动的代码路径时，必须同时提供回退到旧路径的 feature flag。
# 否则迁移出问题时无法一键回滚 → 生产事故。
#
# 检测模式:
#   新增了 ExtensionLoader.scan() 调用
#   或新增了 loadJSON('extensions/...') 调用
#   → 必须同时有对应的 SYNOVA_USE_FILE_* 或 SYNOVA_USE_OLD_* 环境变量检查
STAGED_SRC=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null | grep -E '^src/.*\.ts$' | grep -v '\.test\.' || true)
FF_FAIL=""
if [ -n "$STAGED_SRC" ]; then
  for file in $STAGED_SRC; do
    [ -z "$file" ] && continue
    [ ! -f "$file" ] && continue

    # 检测新增的文件驱动加载调用
    HAS_NEW_FILE_DRIVEN=$(git diff --cached "$file" 2>/dev/null | grep "^+.*" | grep -E "ExtensionLoader\.scan\(|loadJSON\('extensions/|FileScanner\.scan\(" | grep -v "//\|/\*" | head -1 || true)
    if [ -n "$HAS_NEW_FILE_DRIVEN" ]; then
      # 检查同一文件是否包含 feature flag
      HAS_FLAG=$(grep -E "SYNOVA_USE_FILE_|SYNOVA_USE_OLD_|process\.env\.SYNOVA_" "$file" 2>/dev/null | head -1 || true)
      if [ -z "$HAS_FLAG" ]; then
        FF_FAIL="${FF_FAIL}  ${file}: 新增文件驱动加载路径但无 feature flag (SYNOVA_USE_FILE_*/SYNOVA_USE_OLD_*)\n"
      fi
    fi
  done
fi
hard_check "Feature Flag 审计 (新增文件驱动路径须有回退 flag)" "${FF_FAIL:-}"

# ═══ g. 🆕 旧路径删除审计 — 删除硬编码路径须有对应的 feature flag ═══
# Anthropic 决策: 原则 4 "安全边际" — 删除旧路径是不可逆操作。
# 如果没有 feature flag 就删了旧路径 → 出问题无法切回 → 生产事故。
# 警告而非阻断: Phase 0 引导期旧路径可能不存在 (全新代码)，硬阻断会误杀。
OLD_PATH_DELETED=""
if [ -n "$STAGED_SRC" ]; then
  for file in $STAGED_SRC; do
    [ -z "$file" ] && continue
    [ ! -f "$file" ] && continue

    # 检测删除了旧的硬编码加载路径 (switch/case 整段删除, enum 成员删除, 硬编码数组删除)
    HAS_DELETED_OLD=$(git diff --cached "$file" 2>/dev/null | grep "^-.*" | grep -E "case '.*':|enum SOG(Node|Edge)Type|DEFAULT_POLICIES|DEFAULT_EXPERTS|BUILTIN_RULES|switch\(.*targetSystem\)" | grep -v "//\|/\*" | head -1 || true)
    if [ -n "$HAS_DELETED_OLD" ]; then
      # 检查同一 commit 是否有对应的 feature flag
      HAS_FLAG=$(grep -E "SYNOVA_USE_FILE_|SYNOVA_USE_OLD_" "$file" 2>/dev/null | head -1 || true)
      [ -z "$HAS_FLAG" ] && HAS_FLAG=$(git diff --cached 2>/dev/null | grep "^+.*" | grep -E "SYNOVA_USE_FILE_|SYNOVA_USE_OLD_" | head -1 || true)
      if [ -z "$HAS_FLAG" ]; then
        OLD_PATH_DELETED="${OLD_PATH_DELETED}  ${file}: 删除旧硬编码路径但无对应 feature flag — 无法回滚\n"
      fi
    fi
  done
fi
# 警告模式 — 不阻断。原因: Phase 0 引导期旧路径可能不存在 (全新代码)。
if [ -n "$OLD_PATH_DELETED" ]; then
  echo -e "  ${YELLOW}⚠️  旧路径删除审计: 删除硬编码路径须有回退 flag  [警告]${RESET}"
  echo -e "$OLD_PATH_DELETED"
  echo "     如果不提供 feature flag，出问题时无法一键切回旧路径。"
  echo "     Phase 0 引导期可忽略此警告。"
fi

# ═══ 结果 ═══
if [ "$HARD_FAIL" -gt 0 ]; then
  echo ""
  echo -e "  ${RED}文件驱动架构: ${HARD_FAIL} 项未通过 — 提交已拒绝${RESET}"
  echo ""
  echo "  ═══ Anthropic 决策追溯 ═══"
  echo "  这些阻断不是为了增加摩擦——是为了物理保证一个承诺:"
  echo "  'SynovaAgent 可以零代码接入新行业、新本体类型、新 LLM。'"
  echo "  如果这个脚本被绕过，这个承诺就和被声称完成 4 次的"
  echo "  engine-core 拆分一样——只存在于文档里。"
  echo "  (见铁律 46/47 — 桥接文件欺诈事故, 2026-05~06)"
  exit 1
else
  exit 0
fi
