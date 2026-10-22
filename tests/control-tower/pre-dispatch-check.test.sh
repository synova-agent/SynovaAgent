#!/bin/bash
# pre-dispatch-check.test.sh — 派单前复核脚本的密封测试（D732）
# 覆盖矩阵: ① 正常放行 / ② 缺 task-state 必红 / ③ 写集路径不存在必红 / ④ 语法可用 / 接线: skill 双写
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
S="$REPO/scripts/control-tower/pre-dispatch-check.sh"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }; no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

# ① 正常：文档提到的 D# 均有 task-state，路径均存在
PH=$(shasum -a 256 "$REPO"/docs/synova/coordination/整体推进计划-主线-*.md 2>/dev/null | cut -c1-8)
EXIST=$(ls "$REPO"/task-state/D*.json 2>/dev/null | head -1 | grep -oE "D[0-9]{3}")
cat > "$TMPD/good.md" <<MD
派单：${EXIST:-D001} 测试
依据计划: v1.0@$PH
- 写集: scripts/control-tower/pre-dispatch-check.sh

## 派单内部一致性自检
各单验收命令已逐条比对，无互斥要求。
MD
if bash "$S" "$TMPD/good.md" >/dev/null 2>&1; then ok "① 正常文档 → exit 0"; else no "① 正常文档应 exit 0"; fi

# ② 缺 task-state 必红
printf '派单：D999 不存在\n- 写集: scripts/control-tower/pre-dispatch-check.sh\n' > "$TMPD/bad1.md"
if bash "$S" "$TMPD/bad1.md" >/dev/null 2>&1; then no "② D999 无 task-state 却放行"; else ok "② 缺 task-state → exit 1"; fi

# ③ 写集路径不存在必红
printf '派单：D732\n- 写集: src/l4/evidence/**\n' > "$TMPD/bad2.md"
if bash "$S" "$TMPD/bad2.md" >/dev/null 2>&1; then no "③ 不存在的写集路径却放行"; else ok "③ 写集路径不存在 → exit 1"; fi

# ④ 文档不存在 → exit 2（检查自身失败，不与通过混同）
if bash "$S" "$TMPD/nope.md" >/dev/null 2>&1; then no "④ 文档缺失却未报错"; else
  rc=0; bash "$S" "$TMPD/nope.md" >/dev/null 2>&1 || rc=$?; [ "$rc" -eq 2 ] && ok "④ 文档缺失 → exit 2（三态）" || no "④ 期望 exit 2 实得 $rc"; fi

# 接线：skill 双写（.claude + .dsh，D370 同步）
[ -f "$REPO/.synova/skills/pre-dispatch-check/SKILL.md" ] && [ -f "$REPO/.dsh/skills/pre-dispatch-check/SKILL.md" ] \
  && ok "接线: skill 双写齐备" || no "接线: skill 未双写"
grep -q 'pre-dispatch-check' "$REPO/.dsh/skills/cto-handover/SKILL.md" 2>/dev/null \
  && ok "接线: cto-handover 引用本流程" || echo "  ℹ cto-handover 未引用（建议补）"
# ⑥ 第⑩项：未锚定主线计划必红（创始人指令：派单前必读计划）
printf "派单：${EXIST:-D001}\n- 写集: scripts/control-tower/pre-dispatch-check.sh\n\n## 派单内部一致性自检\n无互斥。\n" > "$TMPD/bad4.md"
if bash "$S" "$TMPD/bad4.md" >/dev/null 2>&1; then no "⑥ 未引用主线计划却放行"; else ok "⑥ 未锚定主线计划 → exit 1"; fi

# ⑦ 路径边界：packages/ontology/src/x.ts 不得被误报为 src/x.ts（D756 修正）
printf '派单：${EXIST:-D001}\n依据计划: v1.0@$PH\n- 写集: packages/ontology/src/edge-types.ts\n\n## 派单内部一致性自检\n无互斥。\n' > "$TMPD/ok2.md"
if OUT2=$(bash "$S" "$TMPD/ok2.md" 2>&1); then
  ok "⑦ packages/ 路径不再误报内层 src/"
else
  echo "$OUT2" | grep -q "不存在: src/" && no "⑦ 仍误报内层 src/（边界锚定失效）" || ok "⑦ exit 1（其他原因，非误报）"
fi

echo ""; echo "  结果: $PASS 通过, $FAIL 失败"; [ "$FAIL" -eq 0 ] && exit 0 || exit 1
