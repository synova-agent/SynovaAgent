#!/usr/bin/env bash
# install-dashboards.sh — 把 @synova/dsh-dashboards **全局**装入 dsh web profile（D794）
#
# 与旧版的区别：挂载点从「synova-cto 预设专属 loader 块」改为「profile 的 bundle 层」，
# 因此**任意预设会话**都可见（D794 派单 §A.2.1）。幂等：重复执行安全。
#
# 做四件事（全部只写 $DSH_HOME，仓库零写入）：
#   ① 放置包到 profile 的 node_modules（bundle 名的解析锚点；profile 的 node_modules 优先）
#   ② 把副本里 cordis.patch.yml 的 repoRoot 改写成本机实际仓库根（跨机可移植）
#   ③ profile/package.json：dependencies 增 file: 依赖 + dsh.profile.bundles 追加包名
#   ④ 从 synova-cto 预设删除旧的 loader 块（避免与 bundle 层重复挂载）
#
# 生效：重启 dsh web → 刷新浏览器 → 左侧栏出现「项目总览」入口。
# 回滚：脚本尾部打印卸载步骤（并已备份 package.json）。
#
# D1060 变更：目标 profile 可选 —— 桌面端（Electron）用的是自己的 profile，
#   `$DSH_PROFILE_DIR` 由 profile 启动的 dsh 进程注入（本会话实测 = ~/.dsh-trial-017/profiles/desktop）。
#   优先级：--profile-dir 参数 > $DSH_PROFILE_DIR > $DSH_HOME/profiles/web（原行为，逐字不变）。
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="${DSH_PROFILE_DIR:-$DSH_HOME_DIR/profiles/web}"
if [ "${1:-}" = "--profile-dir" ]; then
  PROFILE_DIR="${2:?--profile-dir 需要目录参数}"
fi
echo "==> 目标 profile: $PROFILE_DIR"
PKG_JSON="$PROFILE_DIR/package.json"
DEST="$PROFILE_DIR/node_modules/@synova/dsh-dashboards"
PRESET_FILE="$DSH_HOME_DIR/.agent-presets/synova-cto/agent.cordis.yml"
PKG_NAME="@synova/dsh-dashboards"
ENTRY_ID="synova-dashboards"
MARKER="Synova 全局跟踪三仪表盘"
# 仓库根 = <repo>/dsh/plugins/synova-dashboards 上溯三级
REPO_ROOT_DEFAULT="$(cd "$PLUGIN_DIR/../../.." && pwd)"

echo "==> ① 放置插件包: $PLUGIN_DIR → $DEST"
mkdir -p "$PROFILE_DIR/node_modules/@synova"
rm -rf "$DEST"
cp -R "$PLUGIN_DIR" "$DEST"
rm -f "$DEST/.DS_Store"

echo "==> ② 改写副本 repoRoot → $REPO_ROOT_DEFAULT"
python3 - "$DEST/cordis.patch.yml" "$REPO_ROOT_DEFAULT" <<'PY'
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

echo "==> ③ profile/package.json：dependencies + dsh.profile.bundles"
if [ ! -f "$PKG_JSON" ]; then
  echo "    ❌ profile package.json 不存在: $PKG_JSON"; exit 1
fi
[ -f "$PKG_JSON.synova-bak" ] || cp "$PKG_JSON" "$PKG_JSON.synova-bak"
python3 - "$PKG_JSON" "$PKG_NAME" "file:$PLUGIN_DIR" <<'PY'
import io, json, sys
p, name, spec = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(io.open(p, encoding="utf-8"))
deps = d.setdefault("dependencies", {})
bundles = d.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
changed = []
if deps.get(name) != spec:
    deps[name] = spec
    changed.append("dependencies")
if name not in bundles:
    bundles.append(name)
    changed.append("bundles")
io.open(p, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print("    已更新: " + (", ".join(changed) if changed else "无变化（已就位）"))
PY

echo "==> ④ 【已退役】synova-cto 预设旧 loader 块清理"
# D1105（2026-10-01）：本步骤退役。原路径 $DSH_HOME/.agent-presets/synova-cto/agent.cordis.yml
#   属**目录式载体**，rc.2 下不再被任何代码读取，且该 legacy 目录已删（两个 home 均已清）。
#   保留代码 = 死引用 ⇒ 改为跳过 + 说明。**不删历史行为**：旧版曾靠它避免与 bundle 层重复挂载；
#   若在**旧 home** 上跑本脚本（.agent-presets 仍在场），需人工清一次旧块（见下方提示）。
if [ ! -f "$PRESET_FILE" ]; then
  echo "    跳过（已退役）：legacy 目录不存在 = $PRESET_FILE"
  echo "    ℹ️ 若你仍在旧 home（.agent-presets 未清）上安装，请人工删除该预设里的「$MARKER」块，"
  echo "       否则会与 bundle 层重复挂载。新机制（dsh.profile.bundles）无需此步。"
elif ! grep -qF "$MARKER" "$PRESET_FILE"; then
  echo "    legacy 目录在场但无旧块，跳过"
else
  echo "    ⚠️ 检测到 legacy 目录仍在场且含旧块 —— 执行一次性清理（本步为兼容旧 home 保留）"
  python3 - "$PRESET_FILE" "$MARKER" "$ENTRY_ID" <<'PY'
import io, sys
p, marker, entry_id = sys.argv[1], sys.argv[2], sys.argv[3]
lines = io.open(p, encoding="utf-8").read().split("\n")
start = next((i for i, l in enumerate(lines) if marker in l), None)
if start is None:
    print("    未找到 marker，跳过"); sys.exit(0)
# 把紧邻的上方空行也算进块内
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
        break                      # 意外的结构 → 停止，保守不删
    if ln.startswith((" ", "\t")):  # 条目的缩进续行
        i += 1; continue
    break
if not seen_entry:
    print("    ⚠ 找到 marker 但未找到 '- id: %s' 条目，保守跳过（请人工核对）" % entry_id)
    sys.exit(0)
out = lines[:cut] + lines[i:]
# 收敛连续空行，保持 YAML 整洁
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
echo "✅ 安装完成（全局挂载）。生效步骤："
echo "   1) 重启 dsh web：bash dsh/plugins/synova-dashboards/scripts/restart-dsh-web.sh"
echo "      （该脚本会 kill 占用 3080 的进程 —— 若你正在某个 session 里，请从会话外执行）"
echo "   2) 刷新浏览器 → 左侧栏出现「项目总览」入口，点击打开中央只读面板"
echo "   3) 验证路由：curl -s http://127.0.0.1:3080/synova/pm/ledger | head -c 200"
echo ""
echo "↩︎  回滚 / 卸载："
echo "   1) cp '$PKG_JSON.synova-bak' '$PKG_JSON'   # 或手工删除 dependencies 与 dsh.profile.bundles 里的 $PKG_NAME"
echo "   2) rm -rf '$DEST'"
echo "   3) 重启 dsh web"
echo "   （synova-cto 预设的旧 loader 块已删除；如需恢复预设专属挂载，从 git 取回该文件的对应行）"
