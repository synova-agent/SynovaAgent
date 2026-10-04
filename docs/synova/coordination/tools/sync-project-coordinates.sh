#!/usr/bin/env bash
# PLATFORM-CHECKLIST: 本脚本过 9 条（UTF-8 头 / PYBIN 三级 / CRLF 清洗 / 路径 / date / …）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# sync-project-coordinates.sh — 把 Issue 正文的【坐标系】块灌进 GitHub Project #1 字段
#
# @input   一个或多个 issue 号，或 --all（扫最近 N 个 open issue）
# @output  逐条打印：issue 号 → 挂板结果 + 已灌字段；末行给汇总
# @exit    0 = 全部成功；1 = 有失败（逐条已打印原因）；2 = 自身失败（gh 不可用/无 token，fail-closed）
# @degraded 无 —— 坐标系是治理输入，不允许降级放行
#
# 设计要点（为什么是本地脚本而不是 CI workflow）：
#   创始人 2026-10-03 选甲方案（用 CTO 现有 PAT）。为使暴露面最小：
#   token 【不进 CI】—— 实测 GitHub 内置工作流不覆盖 `gh issue create` 创建的 Issue，
#   故挂板+灌字段走本地；CI 侧零 secret 引用 ⇒ CI 不成为凭证攻击面。
#
# 规格来源（唯一）：docs/synova/CTO-ROLE.md §7.3 方向坐标系·项目字段规格
#   ⚠️ 字段 id / option id 若在项目里改动，必须同批更新 §7.3 与本文件的映射。
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT_NUMBER=1
PROJECT_OWNER="synova-agent"
PROJECT_ID="PVT_kwDOFAmDns4Blb57"
REPO="synova-agent/SynovaAgent"

# ── 字段映射（照 CTO-ROLE.md §7.3）──
# ⚠️ 不用关联数组：macOS 自带 bash 3.2 不支持 declare -A（实测报错）
FIELD_KEYS="总闸 承重件 批次 命名空间 执行态 验证级别 阻塞源"

# 正文键名 → 项目字段名（bash 3.2 兼容：case 函数）
field_name_of() {
  case "$1" in
    总闸)      echo "总闸" ;;
    承重件)    echo "服务承重件" ;;
    批次)      echo "施工批次" ;;
    命名空间)  echo "命名空间" ;;
    执行态)    echo "执行态" ;;
    验证级别)  echo "验证级别" ;;
    阻塞源)    echo "阻塞源" ;;
    *)         echo "" ;;
  esac
}

fail() { echo "🔴 $*" >&2; exit 2; }
command -v gh >/dev/null 2>&1 || fail "gh 不可用"
gh auth status >/dev/null 2>&1 || fail "gh 未登录（无 token）"
PYBIN=""
for _c in python3 python py; do
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
[ -z "$PYBIN" ] && fail "python 不可用（显式降级，铁律 11）"

# ── 拉字段定义（field id + option id），一次拉全，避免 N 次调用 ──
FIELDS_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json 2>/dev/null) \
  || fail "拉取项目字段失败"

# ── 取 item id 索引（GraphQL；不用 item-list —— 它有 30 条上限陷阱）──
ITEMS_JSON=$(gh api graphql -f query="query{node(id:\"$PROJECT_ID\"){...on ProjectV2{items(first:100){totalCount nodes{id content{...on Issue{number}}}}}}}" 2>/dev/null) \
  || fail "读取项目条目失败"

"$PYBIN" - "$FIELDS_JSON" <<'PYEOF'
import json, sys
d = json.loads(sys.argv[1])
want = {"总闸","服务承重件","施工批次","命名空间","执行态","验证级别","阻塞源"}
found = set()
for f in d.get("fields", []):
    if f.get("name") in want:
        found.add(f["name"])
missing = want - found
if missing:
    print(f"🔴 项目缺少字段: {sorted(missing)}", file=sys.stderr)
    sys.exit(2)
print(f"✅ 字段定义齐（{len(found)}/7）", file=sys.stderr)
PYEOF

# ── 解析某个 issue 正文的坐标系块 ──
parse_coords() {
  local body="$1"
  printf '%s\n' "$body" | "$PYBIN" -c '
import sys, re, json
text = sys.stdin.read()
lines = text.splitlines()
out = {}
inblock = False
pat_start = re.compile(r"^\s*(?:#+\s*坐标系\s*$|\*\*坐标系\*\*\s*$|坐标系\s*[:：]\s*$)")
# 块结束：遇到下一个标题（#）、下一个粗体块标题（**…**）、或空行后接非键值行
for ln in lines:
    s = ln.strip()
    if pat_start.match(s):
        inblock = True
        continue
    if not inblock:
        continue
    if re.match(r"^#+\s", s):          # 下一个标题
        break
    if re.match(r"^\*\*[^*]+\*\*\s*$", s):  # 下一个粗体块
        break
    if re.match(r"^(?:—{3,}|-{3,})$", s):        # 分隔线
        break
    m = re.match(r"^[-*]?\s*(\S+?)\s*[:：]\s*(\S.*)$", s)
    if m and not s.startswith("|"):
        out[m.group(1).strip(" *_")] = m.group(2).strip(" *")
print(json.dumps(out, ensure_ascii=False))
'
}

# ── 灌一个字段 ──
set_field() {
  local item_id="$1" field_name="$2" option_name="$3"
  local fid oid
  fid=$("$PYBIN" -c "
import json,sys
d=json.loads(sys.argv[1])
for f in d.get('fields',[]):
    if f.get('name')==sys.argv[2]: print(f['id']); break
" "$FIELDS_JSON" "$field_name")
  oid=$("$PYBIN" -c "
import json,sys
d=json.loads(sys.argv[1])
for f in d.get('fields',[]):
    if f.get('name')==sys.argv[2]:
        for o in f.get('options',[]) or []:
            if o['name']==sys.argv[3]: print(o['id']); break
        break
" "$FIELDS_JSON" "$field_name" "$option_name")
  if [ -z "$fid" ] || [ -z "$oid" ]; then
    echo "    ⚠️  跳过 $field_name=$option_name（字段或选项不在词表中）"
    return 1
  fi
  gh project item-edit --id "$item_id" --field-id "$fid" --project-id "$PROJECT_ID" \
    --single-select-option-id "$oid" >/dev/null 2>&1
}

# ── 处理一个 issue ──
process_issue() {
  local num="$1"
  echo "── #$num ──"
  local body
  body=$(gh issue view "$num" --repo "$REPO" --json body --jq .body 2>/dev/null) || { echo "    🔴 读不到正文"; return 1; }
  local coords
  coords=$(parse_coords "$body")
  local ncoord
  ncoord=$("$PYBIN" -c "import json,sys;print(len(json.loads(sys.argv[1])))" "$coords")
  if [ "$ncoord" -eq 0 ]; then
    echo "    ⚠️  正文无【## 坐标系】块 ⇒ 不灌（由校验器兜）"
    return 1
  fi
  # 挂板（幂等）
  local item_id
  item_id=$("$PYBIN" -c "
import json,sys
d=json.loads(sys.argv[1])
for n in d['data']['node']['items']['nodes']:
    c=n.get('content') or {}
    if c.get('number')==int(sys.argv[2]): print(n['id']); break
" "$ITEMS_JSON" "$num")
  if [ -z "$item_id" ]; then
    local url="https://github.com/$REPO/issues/$num"
    gh project item-add "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --url "$url" >/dev/null 2>&1 || true
    sleep 2
    ITEMS_JSON=$(gh api graphql -f query="query{node(id:\"$PROJECT_ID\"){...on ProjectV2{items(first:100){totalCount nodes{id content{...on Issue{number}}}}}}}" 2>/dev/null)
    item_id=$("$PYBIN" -c "
import json,sys
d=json.loads(sys.argv[1])
for n in d['data']['node']['items']['nodes']:
    c=n.get('content') or {}
    if c.get('number')==int(sys.argv[2]): print(n['id']); break
" "$ITEMS_JSON" "$num")
    if [ -z "$item_id" ]; then echo "    🔴 挂板失败（item-add 未生效）"; return 1; fi
    echo "    ✅ 已挂板"
  else
    echo "    ✅ 已在板上"
  fi
  # 灌字段
  local k v rel
  for k in $FIELD_KEYS; do
    v=$("$PYBIN" -c "
import json,sys
d=json.loads(sys.argv[1]); print(d.get(sys.argv[2],''))
" "$coords" "$k")
    [ -z "$v" ] && continue
    rel="$(field_name_of "$k")"
    [ -z "$rel" ] && continue
    if set_field "$item_id" "$rel" "$v"; then echo "    ✅ $rel = $v"; else echo "    ⚠️  $rel = $v （词表外）"; fi
  done
}

# ── 主流程 ──
if [ "$#" -eq 0 ]; then
  echo "用法: $0 <issue号>... | --all [N]"
  echo "示例: $0 991 992 | $0 --all 50"
  exit 0
fi

issues=()
if [ "$1" = "--all" ]; then
  lim="${2:-50}"
  while read -r n; do [ -n "$n" ] && issues+=("$n"); done < <(gh issue list --repo "$REPO" --state open --limit "$lim" --json number --jq '.[].number')
else
  issues=("$@")
fi

ok=0; bad=0
for n in "${issues[@]}"; do
  if process_issue "$n"; then ok=$((ok+1)); else bad=$((bad+1)); fi
done
echo
echo "── 汇总: 成功 $ok ｜ 失败/跳过 $bad ──"
[ "$bad" -eq 0 ]
