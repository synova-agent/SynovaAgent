#!/usr/bin/env bash
# install-dashboards.sh — 把 @synova/dsh-dashboards **全局**装入 dsh profile（D794 起；D1066 加固来源）
#
# 做五件事（只写 profile 目录，仓库零写入）：
#   ① **定位主仓交付件**并做**源头 fail-closed 体检**（D1066：空壳源头一律拒装）
#   ② 放置包到 profile 的 node_modules（bundle 名的解析锚点；profile 的 node_modules 优先）
#   ③ 把副本里 cordis.patch.yml 的 repoRoot 改写成本机实际仓库根（跨机可移植）
#   ④ profile/package.json：dependencies 增 file: 依赖 + dsh.profile.bundles 追加包名
#      —— **由本脚本生成/维护**，禁止手工改 profile package.json（D1066 §一.1）
#   ⑤ 从 synova-cto 预设删除旧的 loader 块（避免与 bundle 层重复挂载）
#
# 生效：重启守护进程 → 刷新页面 → 左侧栏出现「项目总览 / 开发工作台 / 治理线」。
# 回滚：脚本尾部打印卸载步骤（并已备份 package.json）。
#
# ── D1066 来源加固（治「来源易失 ⇒ lib/ 空壳」）─────────────────────────────
# 病根（CTO+K3 实测）：profile 的 dependency 曾写成 `file:/tmp/v-ux/dsh/plugins/…`。
#   /tmp 会被清理 ⇒ 安装目录只剩 lib/ scripts/ test/ 三个**空目录** ⇒ Host 半加载不到任何代码，
#   面板静默消失（不报错）。对照 `@synova/task-board-adapter` = 主仓路径（一直正常）。
# 修法三条：
#   ① **来源 = 主仓交付件**：优先 `--repo-root` > `$SYNOVA_REPO_ROOT` > git 主工作树
#      （`git worktree list --porcelain` 第一行 = 主仓，跑在 linked worktree 里也解析到主仓）
#      > 退化为脚本自身所在仓库（`$PLUGIN_DIR/../../..`）。**绝不接受 /tmp 或 .synova-wt-* 作来源**。
#   ② **源头体检 fail-closed**：源头缺 lib/、lib/*.js 计数为 0、缺 package.json/index.js/client.js
#      ⇒ 直接 exit 2，**不装**（宁可没装，也不装一个空壳冒充成功）。
#   ③ **装后自证**：副本 lib/ 非空 + `diff -r` 与源头逐字节一致 ⇒ 才打印成功；不一致 ⇒ 回滚 exit 3。
# 参数：--profile-dir <dir>（默认 $DSH_PROFILE_DIR > $DSH_HOME/profiles/web）
#       --repo-root  <dir>（默认 $SYNOVA_REPO_ROOT > git 主工作树 > 脚本上溯三级）
# 退出码：0 成功 ｜ 1 参数/环境错 ｜ 2 源头体检不过（拒装）｜ 3 装后自证不过（已回滚）
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="${DSH_PROFILE_DIR:-$DSH_HOME_DIR/profiles/web}"
REPO_ROOT_ARG=""

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --profile-dir) PROFILE_DIR="${2:?--profile-dir 需要目录参数}"; shift 2 ;;
    --profile-dir=*) PROFILE_DIR="${1#--profile-dir=}"; shift ;;
    --repo-root) REPO_ROOT_ARG="${2:?--repo-root 需要目录参数}"; shift 2 ;;
    --repo-root=*) REPO_ROOT_ARG="${1#--repo-root=}"; shift ;;
    *) echo "❌ 未知参数: $1（支持 --profile-dir / --repo-root）" >&2; exit 1 ;;
  esac
done

echo "==> 目标 profile: $PROFILE_DIR"

# ── ① 定位「主仓交付件」────────────────────────────────────────────────────
resolve_repo_root() {
  if [ -n "$REPO_ROOT_ARG" ]; then printf '%s\n' "$REPO_ROOT_ARG"; return; fi
  if [ -n "${SYNOVA_REPO_ROOT:-}" ]; then printf '%s\n' "$SYNOVA_REPO_ROOT"; return; fi
  # git 主工作树：`git worktree list --porcelain` 首行 = 主仓（linked worktree 里跑也解析到主仓）
  local wt
  wt="$(git -C "$PLUGIN_DIR" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')"
  if [ -n "$wt" ] && [ -d "$wt" ]; then printf '%s\n' "$wt"; return; fi
  # 退化：脚本自身所在仓库（上溯三级）
  (cd "$PLUGIN_DIR/../../.." && pwd)
}
REPO_ROOT="$(resolve_repo_root)"
SRC="$REPO_ROOT/dsh/plugins/synova-dashboards"
echo "==> 安装来源（主仓交付件）: $SRC"

# 来源红线：易失路径不得作来源（/tmp、/var/folders、.synova-wt-*、synova-wt-*）
case "$SRC" in
  /tmp/*|/private/tmp/*|/var/folders/*|*/.synova-wt-*/*|*/synova-wt-*/*)
    echo "❌ 来源命中易失路径黑名单：$SRC" >&2
    echo "   /tmp 与临时 worktree 会被清理 ⇒ 装完即空壳（D1066 病根）。请用 --repo-root 指定主仓。" >&2
    exit 2 ;;
esac

# ── ①b 源头体检（fail-closed：空壳源头一律拒装，不静默装空）──────────────
src_fail() { echo "❌ 源头体检不过：$1" >&2; echo "   来源：$SRC" >&2; echo "   拒装（fail-closed）—— 宁可没装，也不装空壳冒充成功。" >&2; exit 2; }
[ -d "$SRC" ] || src_fail "来源目录不存在"
[ -f "$SRC/package.json" ] || src_fail "缺 package.json"
[ -d "$SRC/lib" ] || src_fail "缺 lib/ 目录"
LIB_JS_COUNT="$(find "$SRC/lib" -maxdepth 1 -name '*.js' -type f 2>/dev/null | wc -l | tr -d ' ')"
[ "$LIB_JS_COUNT" -gt 0 ] || src_fail "lib/*.js 计数为 0（空壳源头）"
[ -f "$SRC/lib/index.js" ] || src_fail "缺 lib/index.js（Host 半入口）"
[ -f "$SRC/lib/client.js" ] || src_fail "缺 lib/client.js（Client 半入口）"
echo "    源头体检 ✅ lib/*.js = $LIB_JS_COUNT"

PKG_JSON="$PROFILE_DIR/package.json"
DEST="$PROFILE_DIR/node_modules/@synova/dsh-dashboards"
PRESET_FILE="$DSH_HOME_DIR/.agent-presets/synova-cto/agent.cordis.yml"
PKG_NAME="@synova/dsh-dashboards"
ENTRY_ID="synova-dashboards"
MARKER="Synova 全局跟踪三仪表盘"

if [ ! -f "$PKG_JSON" ]; then
  echo "❌ profile package.json 不存在: $PKG_JSON" >&2
  echo "   （--profile-dir 指错？或用 \$DSH_PROFILE_DIR 让本机 dsh 进程自报 profile）" >&2
  exit 1
fi

# 备份（回滚锚点）——存在则不覆盖，保留最初一份
[ -f "$PKG_JSON.synova-bak" ] || cp "$PKG_JSON" "$PKG_JSON.synova-bak"
# 旧副本另存一份，装后自证失败时回滚用
ROLLBACK=""
if [ -d "$DEST" ]; then
  ROLLBACK="$(mktemp -d)"
  cp -R "$DEST/." "$ROLLBACK/" 2>/dev/null || true
fi

echo "==> ② 放置插件包: $SRC → $DEST"
mkdir -p "$PROFILE_DIR/node_modules/@synova"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
rm -f "$DEST/.DS_Store"

echo "==> ③ 改写副本 repoRoot → $REPO_ROOT"
python3 - "$DEST/cordis.patch.yml" "$REPO_ROOT" <<'PY'
import io, re, sys
p, root = sys.argv[1], sys.argv[2]
s = io.open(p, encoding="utf-8").read()
new, n = re.subn(r"(?m)^(\s*repoRoot:\s*).*$", lambda m: m.group(1) + root, s)
if n == 0:
    print("    ⚠ 副本 patch 无 repoRoot 行（保留 cwd 默认）")
else:
    io.open(p, "w", encoding="utf-8").write(new)
    print(f"    已改写 {n} 处")
PY

echo "==> ④ profile/package.json：dependencies + dsh.profile.bundles（脚本生成/维护，勿手工改）"
python3 - "$PKG_JSON" "$PKG_NAME" "file:$SRC" <<'PY'
import io, json, sys
p, name, spec = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(io.open(p, encoding="utf-8"))
deps = d.setdefault("dependencies", {})
bundles = d.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
changed = []
if deps.get(name) != spec:
    changed.append("dependencies: %s → %s" % (deps.get(name), spec))
    deps[name] = spec
if name not in bundles:
    bundles.append(name)
    changed.append("bundles += " + name)
io.open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("    已更新: " + ("; ".join(changed) if changed else "无变化（已就位）"))
PY

# ── ⑤b 装后自证（D1066：非空 + 与源头逐字节一致，否则回滚）─────────────────
verify_install() {
  local fail="$1"
  if [ -n "$ROLLBACK" ] && [ -d "$ROLLBACK" ]; then
    rm -rf "$DEST"; mkdir -p "$DEST"; cp -R "$ROLLBACK/." "$DEST/" 2>/dev/null || true
    echo "    ↩︎ 已回滚到上一份副本" >&2
  else
    rm -rf "$DEST"
    echo "    ↩︎ 已删除半成品副本" >&2
  fi
  echo "❌ 装后自证不过：$fail" >&2
  echo "   来源 $SRC" >&2
  rm -rf "$ROLLBACK" 2>/dev/null || true
  exit 3
}
DEST_LIB_COUNT="$(find "$DEST/lib" -maxdepth 1 -name '*.js' -type f 2>/dev/null | wc -l | tr -d ' ')"
[ "$DEST_LIB_COUNT" -gt 0 ] || verify_install "副本 lib/*.js 计数为 0（装出空壳）"
DIFF_OUT="$(diff -r -q --exclude=.DS_Store "$SRC" "$DEST" 2>&1 || true)"
[ -z "$DIFF_OUT" ] || verify_install "副本与源头不一致：$(printf '%s' "$DIFF_OUT" | head -3)"
echo "==> ⑤ 装后自证 ✅ 副本 lib/*.js = $DEST_LIB_COUNT，与源头逐字节一致"
rm -rf "$ROLLBACK" 2>/dev/null || true

echo "==> ⑥ 删除 synova-cto 预设的旧 loader 块（避免重复挂载）"
if [ ! -f "$PRESET_FILE" ]; then
  echo "    预设不存在，跳过: $PRESET_FILE"
elif ! grep -qF "$MARKER" "$PRESET_FILE"; then
  echo "    无旧块，跳过"
else
  python3 - "$PRESET_FILE" "$MARKER" "$ENTRY_ID" <<'PY'
import io, sys
p, marker, entry_id = sys.argv[1], sys.argv[2], sys.argv[3]
lines = io.open(p, encoding="utf-8").read().split("\n")
start = next((i for i, l in enumerate(lines) if marker in l), None)
if start is None:
    print("    未找到 marker，跳过"); sys.exit(0)
cut = start
while cut > 0 and lines[cut - 1].strip() == "":
    cut -= 1
seen_entry = False
i = start
while i < len(lines):
    ln = lines[i]
    if not seen_entry:
        if ln.startswith("#") or ln.strip() == "":
            i += 1; continue
        if ln.startswith("- id: " + entry_id):
            seen_entry = True; i += 1; continue
        break
    if ln.startswith((" ", "\t")):
        i += 1; continue
    break
if not seen_entry:
    print("    ⚠ 找到 marker 但未找到 '- id: %s' 条目，保守跳过（请人工核对）" % entry_id)
    sys.exit(0)
out = lines[:cut] + lines[i:]
res, prev_blank = [], False
for ln in out:
    if ln.strip() == "":
        if prev_blank:
            continue
        prev_blank = True
    else:
        prev_blank = False
    res.append(ln)
io.open(p, "w", encoding="utf-8").write("\n".join(res))
print(f"    已删除旧块（第 {cut + 1}–{i} 行，{i - cut} 行）")
PY
fi

echo ""
echo "✅ 安装完成（来源 = 主仓交付件，已自证非空且一致）。生效步骤："
echo "   1) 重启守护进程：bash dsh/plugins/synova-dashboards/scripts/restart-dsh-web.sh"
echo "      （该脚本 kill 占用 3080 的进程 —— 若你在某个 session 里，请从会话外执行）"
echo "   2) 刷新页面 → 左侧栏出现「项目总览 / 开发工作台 / 治理线」"
echo ""
echo "↩︎  回滚 / 卸载："
echo "   1) cp '$PKG_JSON.synova-bak' '$PKG_JSON'"
echo "   2) rm -rf '$DEST'"
echo "   3) 重启守护进程"
