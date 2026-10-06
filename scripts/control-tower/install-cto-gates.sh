#!/usr/bin/env bash
# D313/D520 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# install-cto-gates.sh — D1163: 把「收件闸 / dispatch 闸」挂到 DSH 档案（CTO 侧）
#
# 为什么不是 git hook: 两道闸管的是「CTO 收发」这一时刻，不是提交时刻；宿主 = DSH，
#   载体 = @deepseek-ai/dsh-hooks-claude-code（CC hooks.json 方言）。
#
# 契约（铁律 47）:
#   @input  — 位置参数（可省）: profile 目录（默认 $HOME/.dsh-trial-017/profiles/desktop）
#             --apply   真写（默认 dry-run，只打印将要做什么）
#             --uninstall 卸载（移除 hooks.json 的闸登记点 + cordis.patch.yml 的挂载块）
#   @output — 逐步骤 ✅/❌ + 结尾「创始人操作步骤」（含重启要求）
#   @exit   — 0 = 完成（dry-run 亦然） ｜ 1 = 前置条件不满足（缺件/环境不对） ｜ 2 = 自身失败
#   @pre    — ① profile 目录存在 ② 三个脚本在仓库里就位（gate-hook-entry / receipt-gate / dispatch-gate）
#             ③ hooks.json 模板存在且可 JSON 解析 ④ python3 可用（钩子解析 payload 要用）
#             ⑤ cordis.patch.yml 存在（挂载点）
#   @side   — 只写 profile 目录内的 hooks.json 与 cordis.patch.yml（**先备份再写**）；
#             不碰仓库、不碰 git、不碰 scripts/audit/**
#   @prereq — 🔴 必须先合 main：本脚本引用的是 main 上的脚本路径；在 PR 未合前 --apply
#             会让每次 UserPromptSubmit/PreToolUse 都撞 GATE-ERROR（闸脚本不在 main）
#
# 退出条件（自繁殖对冲）: --uninstall 一条命令卸净；卸载后无残留登记点（脚本自检打印 grep 计数）。
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
TEMPLATE="$REPO_ROOT/docs/synova/gates/hooks.json"
PROFILE_DEFAULT="$HOME/.dsh-trial-017/profiles/desktop"

APPLY=0; UNINSTALL=0; PROFILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --uninstall) UNINSTALL=1; APPLY=1; shift ;;
    -h|--help) sed -n '6,25p' "$0"; exit 0 ;;
    -*) echo "❌ 未知参数: $1" >&2; exit 2 ;;
    *) PROFILE="$1"; shift ;;
  esac
done
[ -z "$PROFILE" ] && PROFILE="$PROFILE_DEFAULT"
HOOKS_JSON="$PROFILE/hooks.json"
PATCH_YML="$PROFILE/cordis.patch.yml"
BEGIN_MARK="# ── D1163 CTO 侧双闸挂载（install-cto-gates.sh 维护，勿手改）──"
END_MARK="# ── D1163 段结束 ──"
TS="$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || echo ts)"

PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
step() { echo "── $1 ──"; }

echo "=== D1163 装闸（profile=${PROFILE}；模式=$([ "$APPLY" -eq 1 ] && echo 真写 || echo dry-run)$([ "$UNINSTALL" -eq 1 ] && echo '/卸载')) ==="

# ── 前置条件 ──────────────────────────────────────────────────
step "前置条件"
[ -d "$PROFILE" ] && ok "profile 目录存在" || { no "profile 目录不存在: $PROFILE"; echo "结果: $PASS ✅ / $FAIL ❌"; exit 1; }
for f in scripts/control-tower/gate-hook-entry.sh scripts/control-tower/receipt-gate.sh scripts/control-tower/dispatch-gate.sh; do
  [ -f "$REPO_ROOT/$f" ] && ok "闸件就位: $f" || no "闸件缺失: $REPO_ROOT/$f"
done
[ -f "$TEMPLATE" ] && ok "hooks.json 模板存在" || no "模板缺失: $TEMPLATE"
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1 && PYBIN="$_c" && break
done
[ -n "$PYBIN" ] && ok "python 可用（${PYBIN}）——钩子解析 payload 需它" || no "无可用 python：桥将无法解析 payload（闸会 fail-closed 阻断一切）"
[ -f "$PATCH_YML" ] && ok "挂载点存在: cordis.patch.yml" || no "挂载点缺失: $PATCH_YML"
if [ "$FAIL" -gt 0 ] && [ "$UNINSTALL" -eq 0 ]; then
  echo "结果: $PASS ✅ / $FAIL ❌ —— 前置不满足，未做任何写入"
  exit 1
fi

# ── 模板合法性（JSON 解析 + matcher 正则）────────────────────
if [ -f "$TEMPLATE" ] && [ -n "$PYBIN" ]; then
  step "模板校验"
  if "$PYBIN" - "$TEMPLATE" <<'PY'
import json, re, sys
raw = json.load(open(sys.argv[1], encoding="utf-8"))
hooks = raw.get("hooks")
assert isinstance(hooks, dict), "缺 hooks 键"
assert "UserPromptSubmit" in hooks and "PreToolUse" in hooks, "两个事件登记点不齐"
for ev, groups in hooks.items():
    for g in groups:
        m = g.get("matcher")
        if m is not None:
            re.compile(m)                       # 桥对无效 matcher 会整体拒配（SyntaxError）
        for h in g["hooks"]:
            assert h.get("type") == "command", "只支持 command 型"
            assert "gate-hook-entry.sh" in h["command"], "命令未指向 gate-hook-entry.sh"
print("OK")
PY
  then ok "hooks.json 模板可解析且 matcher 合法"; else no "模板校验失败（见上）"; fi
fi

# ── 卸载路径 ──────────────────────────────────────────────────
if [ "$UNINSTALL" -eq 1 ]; then
  step "卸载"
  if [ "$APPLY" -eq 0 ]; then
    echo "  （dry-run）将删除: $HOOKS_JSON 中的闸登记点、$PATCH_YML 中的挂载块"
    echo "结果: $PASS ✅ / $FAIL ❌"; exit 0
  fi
  [ -f "$HOOKS_JSON" ] && cp "$HOOKS_JSON" "$HOOKS_JSON.bak-$TS" && echo "  已备份: $HOOKS_JSON.bak-$TS"
  rm -f "$HOOKS_JSON" && ok "已移除 $HOOKS_JSON"
  if [ -f "$PATCH_YML" ] && grep -qF "$BEGIN_MARK" "$PATCH_YML"; then
    cp "$PATCH_YML" "$PATCH_YML.bak-$TS"
    "$PYBIN" - "$PATCH_YML" "$BEGIN_MARK" "$END_MARK" <<'PY'
import sys
path, beg, end = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path, encoding="utf-8").read().split("\n")
out, skip = [], False
for ln in lines:
    if ln.strip() == beg.strip(): skip = True; continue
    if skip and ln.strip() == end.strip(): skip = False; continue
    if not skip: out.append(ln)
open(path, "w", encoding="utf-8").write("\n".join(out))
PY
    grep -qF "$BEGIN_MARK" "$PATCH_YML" && no "挂载块残留" || ok "已移除挂载块（备份: $PATCH_YML.bak-${TS}）"
  else
    ok "挂载块不存在（无需移除）"
  fi
  echo "  残留检查: grep -c 'gate-hook-entry' $HOOKS_JSON 2>/dev/null → $(grep -c 'gate-hook-entry' "$HOOKS_JSON" 2>/dev/null || echo 0)"
  echo ""
  echo "🔴 创始人操作: 重启 DSH（hooks 属启动加载）→ 卸载生效。"
  echo "结果: $PASS ✅ / $FAIL ❌"
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
fi

# ── 安装路径 ──────────────────────────────────────────────────
step "安装"
if [ "$APPLY" -eq 0 ]; then
  echo "  （dry-run）将做三件事:"
  echo "    ① 备份并写入 ${HOOKS_JSON}（内容 = ${TEMPLATE}）"
  echo "    ② 在 $PATCH_YML 追加挂载块（id: hooks-claude-code → @deepseek-ai/dsh-hooks-claude-code）"
  echo "    ③ 校验并打印创始人重启步骤"
  echo "  真写请加 --apply"
  echo "结果: $PASS ✅ / $FAIL ❌"
  exit 0
fi

[ -f "$HOOKS_JSON" ] && { cp "$HOOKS_JSON" "$HOOKS_JSON.bak-$TS"; echo "  已备份: $HOOKS_JSON.bak-$TS"; }
cp "$TEMPLATE" "$HOOKS_JSON" && ok "已写入 hooks.json（$(wc -c < "$HOOKS_JSON" | tr -d ' ') 字节）" || no "写 hooks.json 失败"

if grep -qF "$BEGIN_MARK" "$PATCH_YML"; then
  ok "挂载块已存在（幂等：不改动）"
else
  cp "$PATCH_YML" "$PATCH_YML.bak-$TS"
  {
    echo ""
    echo "$BEGIN_MARK"
    echo "- id: hooks-claude-code"
    echo "  name: '@deepseek-ai/dsh-hooks-claude-code'"
    echo "  config:"
    echo "    configPath: $HOOKS_JSON"
    echo "    projectDir: $REPO_ROOT"
    echo "    defaultTimeoutMs: 20000"
    echo "$END_MARK"
  } >> "$PATCH_YML"
  grep -qF "$BEGIN_MARK" "$PATCH_YML" && ok "已挂载 hooks 桥（备份: $PATCH_YML.bak-${TS}）" || no "挂载写入失败"
fi

step "落地自检"
grep -q "gate-hook-entry.sh" "$HOOKS_JSON" 2>/dev/null && ok "登记点指向 gate-hook-entry.sh" || no "登记点未接上入口脚本"
grep -q "dsh-hooks-claude-code" "$PATCH_YML" 2>/dev/null && ok "cordis 挂载含 @deepseek-ai/dsh-hooks-claude-code" || no "cordis 挂载缺失"
if [ -n "$PYBIN" ]; then
  # swallow-ok: 解析失败走 else 的显式 no 分支（不静默放行）
  if "$PYBIN" -c "import json,sys;json.load(open(sys.argv[1],encoding='utf-8'))" "$HOOKS_JSON" 2>/dev/null; then  # swallow-ok: else 分支显式 no
    ok "落地后的 hooks.json 可解析"
  else
    no "落地后的 hooks.json 不可解析"
  fi
fi

echo ""
echo "🔴 创始人操作步骤（缺一步则不生效）:"
echo "  ① 确认本卡 PR 已合入 main（闸脚本必须在 main 上，否则每个动作都撞 GATE-ERROR）:"
echo "       git -C $REPO_ROOT ls-tree origin/main scripts/control-tower/receipt-gate.sh"
echo "  ② 重启 DSH（hooks 属【启动时加载】，不重启则登记点不点火）:"
echo "       退出 DSH 桌面端 → 重新打开（或等价的重启动作）"
echo "  ③ 生效验证（在 CTO 会话里）:"
echo "       发一条缺「基线 ref」的回执 → 应被拒收并点名缺项;"
echo "       发一条引用不存在路径的指令 → 应被拦并点名该路径。"
echo "  ④ 回退（一条命令）: bash $SELF_DIR/install-cto-gates.sh --uninstall && 重启 DSH"
echo "  ⑤ 软启动（先软后硬）: 如需先观察不阻断，把 hooks.json 里两条命令改为"
echo "       SYNO_GATE_MODE=advise bash ... （违规只留痕 + ADVISORY，不阻断）"
echo "结果: $PASS ✅ / $FAIL ❌"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
