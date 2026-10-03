#!/usr/bin/env bash
# D732 UTF-8 强制
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# pre-dispatch-check.sh — 派单前机械复核（skill: pre-dispatch-check 的可自动化部分）
#
# 背景（D732 前 CTO 亲历）: 派单文档凭印象写写集路径（src/l4/evidence/**，实际代码在
#   src/evidence/），且把员工转述的技术声称当结论 → 执行方拿到的派单本身有错。
# 本脚本只做**机械可判**的四项（①②④⑥）；③技术声称复现 / ⑤写集交集 / ⑦依赖 / ⑧交付物
#   属语义判断，由 skill 强制人工完成，脚本不假装能做。
#
# 用法: bash scripts/control-tower/pre-dispatch-check.sh <派单文档路径>
# 退出码（三态，对齐 ctrl-tower-change 模式 1）:
#   0 = 机械项全通过
#   1 = 发现问题（无 task-state / 路径不存在 / 行号越界）
#   2 = 检查本身执行失败（文档不存在、非 git 仓库）
# 契约: 输入=派单文档路径（可含中文）；输出=逐项 ✅/⚠️ 点名；不修改任何文件
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
DOC="${1:-}"
if [ -z "$DOC" ]; then echo "用法: $0 <派单文档路径>"; exit 2; fi
[ -f "$DOC" ] || { echo "❌ 派单文档不存在: $DOC"; exit 2; }
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "❌ 非 git 仓库"; exit 2; }
FIND=0
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT

echo "── ① 任务号真实性（禁臆写，需 task-state 存在）──"
# D1058/R8 修复（2026-09-28）: 原 'D[0-9]{3}' 对 D1007.json 截成 D100 → 查不到 task-state
#   → 「⚠️ D100 无 task-state」exit 1 → 静默冻结本脚本（纯净 main 上 7过1败，CT-40 双阻断）。
#   改为 {3,4} 贪婪匹配（D1007 整体命中；短号 D100 亦不受影响）。
for d in $(grep -oE 'D[0-9]{3,4}' "$DOC" | sort -u); do
  if [ -f "$ROOT/task-state/$d.json" ]; then echo "  ✅ $d 已登记"
  else echo "  ⚠️ $d 无 task-state（新建须走 alloc-task-id.sh）"; FIND=1; fi
done

echo "── ④ 写集路径存在性（不存在须显式标注「新建」）──"
# D756: 路径根补全 + 边界锚定（防止在 packages/ontology/src/x.ts 里误匹配内层 src/x.ts）
grep -oE '(^|[^A-Za-z0-9_/.-])((src|scripts|tests|docs|packages|extensions|\.github|electron|electron-renderer)/[A-Za-z0-9_./*-]+)' "$DOC" \
  | sed -E 's/^[^A-Za-z./].*//; s/^//' | grep -oE '(src|scripts|tests|docs|packages|extensions|\.github|electron|electron-renderer)/[A-Za-z0-9_./*-]+' \
  | sed 's/[.,，。；、)]*$//' | sort -u > "$tmp"
while read -r p; do
  [ -z "$p" ] && continue
  case "$p" in *\**) base="${p%/**}";; *) base="$p";; esac
  if [ -e "$ROOT/$base" ]; then echo "  ✅ $p"
  else echo "  ⚠️ 不存在: $p"; FIND=1; fi
done < "$tmp"

echo "── ⑥ 引用可核验（D919: 全量不截断 + 含 .md/.html/.txt + 仓外根 + 错误码可归因）──"
# D919 修复三缺口（原实现 `grep ... | head -25`）:
#   ① 截断 → 第 26 条引用起永不校验（M1: 检查未执行 == 检查通过）
#   ② 扩展名白名单不含 .md/.html/.txt → 「docs/**.md:行号」这类权威引用整体漏检（上一任翻车形态）
#   ③ 无仓外根 → DSH 源码引用无处解析；无错误码 → 违规不可归因
CITE_PY="$ROOT/scripts/control-tower/check-citations.py"
if [ ! -f "$CITE_PY" ]; then
  echo "  ⚠️ degraded: 引用核验器缺失（${CITE_PY}）— 本项跳过（显式，不静默）"
else
  # 仓外权威源：DSH 安装目录（可经 SYNO_DSH_SRC 覆盖；不存在则记录为尝试根，不误报为通过）
  DSH_SRC="${SYNO_DSH_SRC:-$(ls -d "$HOME"/.nvm/versions/node/*/lib/node_modules/@deepseek-ai/dsh 2>/dev/null | head -1)}"  # swallow-ok: 未装 nvm/DSH 时目录不存在属预期 → 空值即不启用仓外根（显式降级，下方有分支提示）
  CITE_ARGS=("$DOC" --repo "$ROOT" --owner "pre-dispatch")
  [ -n "$DSH_SRC" ] && CITE_ARGS+=(--external-root "$DSH_SRC")
  CITE_RC=0
  python3 "$CITE_PY" "${CITE_ARGS[@]}" > "$tmp.cite" 2>&1 || CITE_RC=$?
  if [ "$CITE_RC" -eq 0 ]; then
    echo "  ✅ 引用全部可核验（$(grep -oE '[0-9]+ 条' "$tmp.cite" | head -1)）"
  else
    sed 's/^/  /' "$tmp.cite"
    if [ "$CITE_RC" -eq 2 ]; then echo "  ❌ 引用核验执行失败（fail-closed，不当作通过）"; else echo "  ❌ 存在不可核验引用——修正后再派单"; fi
    FIND=1
  fi
fi

echo "── ⑩ 主线计划锚定（CTO 必读：整体推进计划）──"
# ══ 闸 2 增补（D1058，2026-09-28）：派单件 §〇 归属与依据（三项机械检查）══
# 设计依据：CTO-派单规程.md「派单七问」+「分域裁剪」（主线严 / 治理宽 / 两类全域强制）
# ① 归属字段存在：主线卡须含「线 <id> · 点 <id>」；治理卡须含「治理域」+「目的声明」
# ② 权威件回执段存在（③ 全域强制）
# ③ 声明的点 id 在 product-lines.yaml 命中（防臆造/过期）
# 豁免：文件含 `§〇: legacy-exempt`（历史派单件）⇒ 跳过本段并显式打印（不静默）
SEC0="$(grep -c '归属与依据' "$DOC" 2>/dev/null | tr -d '\n\r' || true)"
OWNER="$(grep -oE '线[[:space:]]*[0-9]+[[:space:]]*·[[:space:]]*点[[:space:]]*[0-9]+(-[0-9]+)?' "$DOC" 2>/dev/null | head -1 || true)"
GOV="$(grep -cE '治理域|目的声明|解除.*阻塞' "$DOC" 2>/dev/null | tr -d '\n\r' || true)"
RECEIPT="$(grep -cE '权威件回执|读了.*(权威|研究院|总纲|契约|指引)' "$DOC" 2>/dev/null | tr -d '\n\r' || true)"
if grep -q '§〇: legacy-exempt' "$DOC" 2>/dev/null; then
  echo "  ⚠️ 闸 2：§〇 检查豁免（legacy-exempt 显式标记）"
elif [ "${SEC0:-0}" -eq 0 ]; then
  echo "  ⚠️ 闸 2-①：无「§〇 归属与依据」段（**警告**：新卡按 CTO-派单规程七问填；存量件可标 §〇: legacy-exempt 静默）"
else
  if [ -n "$OWNER" ]; then
    PT="$(echo "$OWNER" | grep -oE '[0-9]+-[0-9]+$' || true)"
    if [ -n "$PT" ] && [ -f "$ROOT/docs/synova/product-lines/product-lines.yaml" ]; then
      if grep -q "id: \"$PT\"" "$ROOT/docs/synova/product-lines/product-lines.yaml" 2>/dev/null; then
        echo "  ✅ 闸 2-①：归属点 $PT 在 yaml 命中"
      else
        echo "  ❌ 闸 2-③：声明的点 $PT 不在 product-lines.yaml（臆造或过期）"; FIND=1
      fi
    fi
  fi
  if [ "${GOV:-0}" -gt 0 ]; then echo "  ✅ 闸 2-①：治理域/目的声明在场"; fi
  if [ "${RECEIPT:-0}" -eq 0 ]; then
    echo "  ❌ 闸 2-②：无「权威件回执」段（全域强制）"; FIND=1
  else
    echo "  ✅ 闸 2-②：权威件回执在场"
  fi
fi
PLAN=$(ls "$ROOT"/docs/synova/coordination/整体推进计划-主线-*.md 2>/dev/null | head -1)
if [ -z "$PLAN" ]; then
  echo "  ⚠️ degraded: 未找到整体推进计划文档 → 跳过锚定（须人工确认计划存在）"
else
  PH=$(shasum -a 256 "$PLAN" 2>/dev/null | cut -c1-8)
  PV=$(grep -m1 -oE '版本: *v[0-9]+\.[0-9]+' "$PLAN" | grep -oE 'v[0-9]+\.[0-9]+')
  if grep -q '依据计划:' "$DOC"; then
    if grep -q "$PH" "$DOC"; then echo "  ✅ 派单已锚定计划 ${PV}@${PH}"
    else echo "  ⚠️ 派单引用的计划哈希与当前不符（当前 ${PV}@${PH}）——计划已更新，重读后再派"; FIND=1; fi
  else
    echo "  ⚠️ 派单未引用「依据计划: ${PV}@${PH}」——未证明读过主线计划"; FIND=1
  fi
fi

echo "── ⑨ 派单内部一致性（语义为主；脚本做自检段存在性 + 互斥启发式）──"
if grep -qE '内部一致性' "$DOC"; then echo "  ✅ 含「派单内部一致性」自检段（CTO 已逐条核对）"
else echo "  ⚠️ 缺「派单内部一致性」自检段——D733 教训：同一单两条要求对同一路径互斥，是执行方替我发现的"; FIND=1; fi
grep -oE '(src|scripts|tests|docs)/[A-Za-z0-9_./-]+' "$DOC" | sort -u > "$tmp.paths"
while read -r pp; do
  [ -z "$pp" ] && continue
  ctx=$(grep -- "$pp" "$DOC" 2>/dev/null | tr '\n' ' ')
  if echo "$ctx" | grep -qE '必红|非零|exit 1' && echo "$ctx" | grep -qE '变绿|exit 0'; then
    echo "  ⚠️ 疑似互斥: $pp 同时出现「必红/非零」与「变绿/exit 0」——请人核"
    FIND=1
  fi
done < "$tmp.paths"

echo "── ② 前置 PR 合并状态（需 GITHUB_TOKEN；无则跳过，不静默）──"
TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.dsh/.credentials.yaml" ]; then
  TOKEN=$(grep -E '^\s*GITHUB_TOKEN:' "$HOME/.dsh/.credentials.yaml" 2>/dev/null | sed 's/.*GITHUB_TOKEN:[[:space:]]*//' | tr -d '\r\n')
fi
if [ -z "$TOKEN" ]; then
  echo "  ⚠️ degraded: 无 GITHUB_TOKEN → 跳过前置 PR 核验（须人工核）"
else
  for pr in $(grep -oE '#[0-9]{2,4}' "$DOC" | tr -d '#' | sort -u); do
    st=$(curl -s -H "Authorization: token $TOKEN" "https://api.github.com/repos/tangbaobao520/SynovaAgent/pulls/$pr" 2>/dev/null \
      | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('state'),d.get('merged'))" 2>/dev/null || echo "? ?")  # D520: 平台敏感命令豁免声明（见 PLATFORM-CHECKLIST.md）
    echo "  PR #${pr} → ${st}（派单若声称「已合」须与此一致）"
  done
fi

echo
[ "$FIND" -eq 0 ] && { echo "  ✅ 机械项全通过（③⑤⑦⑧ 仍须按 skill 人工完成）"; exit 0; }
echo "  ❌ 机械项发现问题——修正后再派单"; exit 1
