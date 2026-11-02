#!/bin/bash
# V4.1 T5 — 启动完整性校验。验证扩展引用闭合、标签可解析、依赖存在。失败→拒绝启动。
set +e; ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; FAIL=0; RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'
echo "═══ V4.1 启动完整性校验 ═══"
# 1. manifest entryPoint 文件存在
for mf in $(find "$ROOT/extensions" -name "manifest.json" -not -path "*/node_modules/*" 2>/dev/null); do
  dir=$(dirname "$mf")
  ep=$(python3 -c "import json; print(json.load(open('$mf',encoding='utf-8')).get('entryPoint',''))" 2>/dev/null)
  [ -z "$ep" ] && continue
  [ "$ep" = "./manifest.json" ] && continue
  case "$ep" in
    ../src/*) target="$ROOT/${ep#../}" ;;
    ./*) target="$dir/${ep#./}" ;;
    *) target="$dir/$ep" ;;
  esac
  if [ ! -f "$target" ]; then echo -e "  ${RED}❌ entryPoint 缺失: $mf → $target${RESET}"; FAIL=$((FAIL+1)); fi
done
# 2. 边端点类型闭合
EDGE_DIR="$ROOT/extensions/ontology/edge-types"
NODE_DIR="$ROOT/extensions/ontology/node-types"
if [ -d "$EDGE_DIR" ] && [ -d "$NODE_DIR" ]; then
  NODE_LABELS=$(grep -h '"label"' "$NODE_DIR"/*.json 2>/dev/null | grep -oE '"[A-Z][a-zA-Z]+"' | tr -d '"' | sort -u)  # swallow-ok: 目录无 json 时 grep 报错属正常默认（ENOENT），空值由后续判定处理
  for ef in "$EDGE_DIR"/*.json; do
    [ ! -f "$ef" ] && continue
    for endpoint in $(python3 -c "import json; e=json.load(open('$ef',encoding='utf-8')); print(' '.join(e.get('allowedFrom',[])+e.get('allowedTo',[])))" 2>/dev/null); do
      if ! echo "$NODE_LABELS" | grep -q "$endpoint"; then echo -e "  ${RED}❌ 边类型 $(basename $ef) 引用的节点类型 $endpoint 不存在${RESET}"; FAIL=$((FAIL+1)); fi
    done
  done
fi
# 3. industry extends 引用可解析
IND_DIR="$ROOT/extensions/industries"
if [ -d "$IND_DIR" ]; then
  IND_NAMES=$(for d in "$IND_DIR"/*/; do [ -f "$d/manifest.json" ] && python3 -c "import json; print(json.load(open('${d}manifest.json',encoding='utf-8')).get('name',''))" 2>/dev/null; done | sort -u)
  for d in "$IND_DIR"/*/; do
    [ ! -f "$d/manifest.json" ] && continue
    ext=$(python3 -c "import json; print(json.load(open('${d}manifest.json',encoding='utf-8')).get('extends',''))" 2>/dev/null)
    [ -z "$ext" ] || [ "$ext" = "base" ] && continue
    if ! echo "$IND_NAMES" | grep -q "$ext"; then echo -e "  ${RED}❌ $(basename $d) extends $ext 但 $ext 不存在${RESET}"; FAIL=$((FAIL+1)); fi
  done
fi
if [ "$FAIL" -gt 0 ]; then echo -e "  ${RED}启动完整性: $FAIL 项失败 — 拒绝启动${RESET}"; exit 1; fi
echo -e "  ${GREEN}✅ 启动完整性校验通过${RESET}"; exit 0
