#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# install-dsh-preset.sh — DSH 预设落位 + 漂移检查（D945: 落位改走 **bundle 层**）
#
# 迁移（D945，CTO 批准）: 2026-09-23 起 DSH 预设的载体是 profile 的 **bundle 层**
#   （$PROFILE_DIR/node_modules/@local/dsh-preset-<id>/ + profile package.json 的
#   dsh.profile.bundles 声明），legacy 载体 `~/.dsh/.agent-presets/<id>/`（手工 cp +
#   手工编辑 YAML、仓库外、git 外）**已废弃**——旧脚本的 standard 源探测 + persona 行
#   拼装正是多机漂移的来源。本脚本不再写 legacy，只保留「已废弃」提示分支。
#
# 契约（铁律 47）:
#   @input  — --install | --check          二选一（缺/都给 → exit 2）
#             --profile-dir <path>        运行时 profile 目录（bundle 层根）— 测试注入
#             --bundle-src <path>         仓库 bundle 源根 — 测试注入
#             [<preset-id>...]            缺省 = $BUNDLE_SRC 下全部已发现预设
#             --home <path>               **已废弃**（旧 legacy 落位目标）→ 提示 + exit 2
#             --standard-from <path>      **已废弃**（旧 standard 派生源）→ 提示 + exit 2
#   @output — 判定位（夹具可 grep）: INSTALLED: / SYNC-OK: / INSTALL-DRIFT: /
#             RETIRED: / DEPRECATED: / LEGACY-PRESENT: / WARN: / degraded:
#   @exit   — 0 = 安装成功 / 全部一致；1 = 判定不合格（漂移；请求的 id 未注册或已退役）；
#             2 = 执行失败或降级（PYBIN 不可用 / 源缺失或损坏 / profile 不可写 / 废弃用法 /
#             未知参数）—— D328 三态：2 绝不与 0 混同
#   @degraded — stderr `degraded: <原因>` + 追加 $DEGRADED_LOG 五字段
#             {time, component, phase, reason, retryable}（+ schema 版本戳，对齐
#              scripts/control-tower/control_tower_log.py 的 degraded/v1）
#   @error  — 不抛异常给调用方；全部经退出码表达
#
# 落位产物（--install，相对 $PROFILE_DIR）:
#   ① node_modules/@local/dsh-preset-<id>/package.json     ← $BUNDLE_SRC/<id>/package.json（逐字节）
#   ② node_modules/@local/dsh-preset-<id>/cordis.patch.yml ← $BUNDLE_SRC/<id>/cordis.patch.yml（逐字节）
#   ③ package.json 的 dsh.profile.bundles[] 追加 @local/dsh-preset-<id>（已声明则零改动）
#   绝不再写 $HOME/.agent-presets/**；不碰 $PROFILE_DIR/cordis.patch.yml（他域单写者）
#   原子性: 先落 .tmp-<id>.$$ 并校验，再 rm+mv 就位；失败路径无半成品
#
# 注入缝（env）: SYNO_PRESET_REPO_DIR（=$BUNDLE_SRC 默认源）/ SYNO_PROFILE_DIR（=$PROFILE_DIR）
#   / SYNO_LEGACY_HOME（legacy 提示用，只读）/ SYNO_PRESET_DEGRADED_LOG
# 平台: PYBIN 三级探测 + 试运行可用性；无裸 python3；无 grep -P；无 date +%s/-v；无 sed -i
# 用法: bash scripts/control-tower/install-dsh-preset.sh --install|--check [<preset-id>...]
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── 退役登记（D922 可逆留痕机制；本块是「注释即退役」的**活机制**，非死注释）──
#   规则: `# <id>|<说明>` = 该预设已退役 → 永不进默认集；显式请求 → exit 1 点名退役
# synova-devdoc| 2026-09-23 退役（创始人批准 B 案）：常驻 dev-doc session 近 7 天产物 0 变更，
#   职责已被「CTO 派单件（派单即规格）」+「K3 审计协议」吸收；能力保留为 skill dev-doc-spec
#   （.claude/skills + .dsh/skills 双写）；恢复方式：删除本行注释标记即可回到在册。

# ── PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
#    Win Git Bash 无 python3（仅 python/py）；D330: 探测后须试运行，损坏 shim 不得当作可用
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then
    PYBIN="$_c"; break
  fi
done

DEGRADED_LOG="${SYNO_PRESET_DEGRADED_LOG:-$REPO_DIR/.codex/control-tower/logs/degraded-events.log}"
BUNDLE_SRC="${SYNO_PRESET_REPO_DIR:-$REPO_DIR/docs/synova/presets}"
PROFILE_DIR_IN="${SYNO_PROFILE_DIR:-}"

MODE=""
IDS=""

degrade() { # <reason> — 降级: 显式 stderr + 五字段日志 + exit 2
  local reason="$1" ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "degraded: ${reason} (component=install-dsh-preset, phase=${MODE:-none}, retryable=true)" >&2
  mkdir -p "$(dirname "$DEGRADED_LOG")" 2>/dev/null || true
  if [ -n "$PYBIN" ]; then
    "$PYBIN" -c '
import json,sys
rec={"schema":"control-tower/logs/degraded/v1","time":sys.argv[1],"component":"install-dsh-preset",
     "phase":sys.argv[2],"reason":sys.argv[3],"retryable":True}
try:
    open(sys.argv[4],"a",encoding="utf-8").write(json.dumps(rec,ensure_ascii=False)+"\n")
except OSError as e:
    sys.stderr.write("degraded-log-write-failed: %s\n" % e)
' "$ts" "${MODE:-none}" "$reason" "$DEGRADED_LOG" || true
  else
    printf '{"schema":"control-tower/logs/degraded/v1","time":"%s","component":"install-dsh-preset","phase":"%s","reason":"%s","retryable":true}\n' \
      "$ts" "${MODE:-none}" "$reason" >> "$DEGRADED_LOG" 2>/dev/null || true
  fi
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --install) MODE="install" ;;
    --check) MODE="check" ;;
    --profile-dir) PROFILE_DIR_IN="${2:-}"; shift ;;
    --bundle-src) BUNDLE_SRC="${2:-}"; shift ;;
    --home)
      echo "DEPRECATED: --home 已废弃（D945: 预设落位改走 bundle 层 \$PROFILE_DIR/node_modules/@local/，不再写 .agent-presets/）" >&2
      echo "  替代: --profile-dir <profile 目录>（缺省自动解析 \$DSH_HOME/profiles/desktop）" >&2
      exit 2 ;;
    --standard-from)
      echo "DEPRECATED: --standard-from 已废弃（bundle 化后 patch 来自仓库 bundle 源，不再从 standard 派生）" >&2
      echo "  替代: --bundle-src <仓库 bundle 源根>（缺省 \$REPO/docs/synova/presets）" >&2
      exit 2 ;;
    -h|--help)
      echo "用法: $0 --install|--check [--profile-dir PATH] [--bundle-src PATH] [<preset-id>...]"
      echo "  （--home / --standard-from 已废弃，调用即 exit 2）"
      exit 0 ;;
    --*) degrade "未知参数: $1" ;;
    *) IDS="$IDS $1" ;;
  esac
  shift
done
[ -n "$MODE" ] || degrade "必须指定 --install 或 --check"
[ -n "$PYBIN" ] || degrade "python 不可用（python3/python/py 均缺失或不可运行）"

# ── profile dir 解析（打印到 stderr，可观测不静默）──
#   序: 注入 → $DSH_HOME/profiles/desktop → ~/.dsh-trial-017/...（已迁移的 trial home）
#       → ~/.dsh/profiles/desktop（兜底；该 home 若未迁移由 python 侧 WARN 显式提示）
if [ -z "$PROFILE_DIR_IN" ]; then
  if [ -n "${DSH_HOME:-}" ] && [ -d "${DSH_HOME}/profiles/desktop" ]; then
    PROFILE_DIR_IN="${DSH_HOME}/profiles/desktop"
  elif [ -d "$HOME/.dsh-trial-017/profiles/desktop" ]; then
    PROFILE_DIR_IN="$HOME/.dsh-trial-017/profiles/desktop"
  else
    PROFILE_DIR_IN="$HOME/.dsh/profiles/desktop"
  fi
fi
if [ -n "${SYNO_LEGACY_HOME:-}" ]; then
  LEGACY_HOME="$SYNO_LEGACY_HOME"
elif [ -n "${DSH_HOME:-}" ]; then
  LEGACY_HOME="$DSH_HOME"
elif [ -d "$HOME/.dsh-trial-017/.agent-presets" ]; then
  LEGACY_HOME="$HOME/.dsh-trial-017"
else
  LEGACY_HOME="$HOME/.dsh"
fi

# 退役 id 由上方注释块解析（单源; 注释行 = 退役，可逆）
RETIRED_IDS="$(grep -E '^# *[a-z0-9-]+\|' "${BASH_SOURCE[0]}" | sed -E 's/^# *([a-z0-9-]+)\|.*/\1/' | tr '\n' ' ')"

echo "install-dsh-preset: mode=${MODE}" >&2
echo "  bundle-src:  ${BUNDLE_SRC}" >&2
echo "  profile-dir: ${PROFILE_DIR_IN}" >&2
echo "  legacy-home: ${LEGACY_HOME}（只读；旧载体已废弃）" >&2

"$PYBIN" - "$MODE" "$REPO_DIR" "$BUNDLE_SRC" "$PROFILE_DIR_IN" "$LEGACY_HOME" \
  "$DEGRADED_LOG" "$RETIRED_IDS" "$IDS" <<'PYENGINE_EOF'
# -*- coding: utf-8 -*-
"""install-dsh-preset python 引擎（bash 已完成参数解析 / PYBIN 探测 / 降级兜底）。"""
import datetime
import json
import os
import shutil
import sys
from pathlib import Path

EXIT_OK = 0
EXIT_VIOLATION = 1
EXIT_FAILED = 2
COMPONENT = "install-dsh-preset"
BUNDLE_FILES = ("package.json", "cordis.patch.yml")
# D931: Agent Teams 用同名工具替换 legacy 子代理控制 → 落位前拒绝含 legacy 行的坏 bundle
LEGACY_FORBIDDEN_TOKENS = ["- id: delegation"]


class Degraded(Exception):
    """执行失败/降级 → exit 2（D328：绝不与 0 混同）。"""


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_degraded(log_path, phase, reason):
    """五字段 {time,component,phase,reason,retryable} + schema 版本戳。"""
    rec = {
        "schema": "control-tower/logs/degraded/v1",
        "time": now_iso(),
        "component": COMPONENT,
        "phase": phase,
        "reason": reason,
        "retryable": True,
    }
    try:
        p = Path(log_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError as e:
        sys.stderr.write("degraded-log-write-failed: %s\n" % e)


def read_json(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Degraded("%s 不存在: %s" % (what, path))
    except (json.JSONDecodeError, ValueError) as e:
        raise Degraded("%s 不可解析: %s (%s)" % (what, path, e))
    except OSError as e:
        raise Degraded("%s 不可读: %s (%s)" % (what, path, e))


def dig(obj, *keys):
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def read_text_safe(path):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError:
        return ""


def discover(bundle_src):
    """文件驱动注册表: 目录名 = 预设 id（package.json 声明 dsh.bundle.patch）。"""
    root = Path(bundle_src)
    if not root.is_dir():
        raise Degraded("bundle 源目录不存在: %s" % bundle_src)
    found, undeclared = {}, {}
    for d in sorted([p for p in root.iterdir() if p.is_dir()]):
        pkg = d / "package.json"
        if not pkg.is_file():
            continue
        data = read_json(pkg, "bundle 源 package.json")
        patch_rel = dig(data, "dsh", "bundle", "patch")
        if isinstance(patch_rel, str) and patch_rel.strip():
            found[d.name] = d
        else:
            undeclared[d.name] = d
    return found, undeclared


def load_profile(profile_dir):
    pd = Path(profile_dir)
    if not pd.is_dir():
        raise Degraded("profile 目录不存在: %s" % profile_dir)
    prof_pkg = pd / "package.json"
    prof = read_json(prof_pkg, "运行时 profile package.json")
    bundles = dig(prof, "dsh", "profile", "bundles")
    if not isinstance(bundles, list):
        raise Degraded("运行时 profile package.json 无 dsh.profile.bundles 列表: %s" % prof_pkg)
    local_root = pd / "node_modules" / "@local"
    if not local_root.is_dir():
        print("WARN: %s 无 node_modules/@local/（疑似未迁移 home；--install 将新建）" % pd)
    return pd, prof_pkg, prof, local_root


def write_profile(prof_pkg, prof):
    """JSON round-trip（indent=2, ensure_ascii=False）—— 已实测该 profile 文件往返逐字节稳定。"""
    try:
        Path(prof_pkg).write_text(json.dumps(prof, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except OSError as e:
        raise Degraded("profile package.json 不可写: %s (%s)" % (prof_pkg, e))


def legacy_notice(legacy_home):
    """只读提示（不改退出码；legacy 判红归 check-preset-bundles.sh）。"""
    ap = Path(legacy_home) / ".agent-presets"
    if ap.is_dir():
        n = len([p for p in ap.iterdir() if p.is_dir()])
        print("LEGACY-PRESENT: %s 仍在场（%d 个子目录）— 旧载体已废弃，收口判红归 check-preset-bundles --consistency；本脚本不代删" % (ap, n))


def staging_dir(local_root, pid):
    return local_root / (".tmp-%s.%d" % (pid, os.getpid()))


def stage_bundle(src, tmp, pid):
    """落位前先在 .tmp 造好并校验（失败即清理，无半成品）。"""
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    for fn in BUNDLE_FILES:
        s = src / fn
        if not s.is_file():
            shutil.rmtree(tmp, ignore_errors=True)
            raise Degraded("仓库 bundle 源缺文件: %s" % s)
        shutil.copyfile(s, tmp / fn)
    read_json(tmp / "package.json", "staged bundle package.json")
    text = read_text_safe(tmp / "cordis.patch.yml")
    for need in ("- insert:", "    - id: preset-%s" % pid):
        if need not in text:
            shutil.rmtree(tmp, ignore_errors=True)
            raise Degraded("仓库 bundle patch 缺结构行 %r（拒绝落位坏 bundle）" % need.strip())
    for tok in LEGACY_FORBIDDEN_TOKENS:
        if tok in text:
            shutil.rmtree(tmp, ignore_errors=True)
            raise Degraded("仓库 bundle patch 含 legacy 行 %r（D931 不得与 Agent Teams 共存）" % tok)
    return tmp


def do_install(bundle_src, profile_dir, retired, legacy_home, ids):
    pd, prof_pkg, prof, local_root = load_profile(profile_dir)
    found, undeclared = discover(bundle_src)
    # 请求校验优先——任一请求不可满足即整体拒绝（不做部分落位）
    for want in ids:
        if want in retired:
            print("RETIRED: %s 已于 2026-09-23 退役（能力已技能化为 dev-doc-spec；不再落位）" % want)
            return EXIT_VIOLATION
        if want not in found:
            print("INSTALL-DRIFT: %s 未注册预设（仓库无 bundle 源: %s/%s/package.json）" % (want, bundle_src, want))
            if want in undeclared:
                print("INSTALL-DRIFT: %s package.json 缺 bundle 声明行 dsh.bundle.patch" % want)
            return EXIT_VIOLATION
    sel = {k: v for k, v in found.items() if not ids or k in ids}
    if not sel:
        if undeclared:
            print("INSTALL-DRIFT: 无可用 bundle 源（%s 下 %s 缺 dsh.bundle.patch）" % (bundle_src, ", ".join(sorted(undeclared))))
        else:
            print("INSTALL-DRIFT: 未发现任何 bundle 源（%s/*/package.json 零命中）" % bundle_src)
        return EXIT_VIOLATION

    local_root.mkdir(parents=True, exist_ok=True)
    changed, count = False, 0
    for pid in sorted(sel):
        src = sel[pid]
        decl = "@local/dsh-preset-%s" % pid
        dst = local_root / ("dsh-preset-%s" % pid)
        tmp = staging_dir(local_root, pid)
        stage_bundle(src, tmp, pid)
        try:
            if dst.exists():
                shutil.rmtree(dst)
            tmp.rename(dst)
        except OSError as e:
            shutil.rmtree(tmp, ignore_errors=True)
            raise Degraded("就位失败: %s (%s)" % (dst, e))
        bundles = dig(prof, "dsh", "profile", "bundles")
        if decl in bundles:
            decl_state = "既有"
        else:
            bundles.append(decl)
            decl_state = "新增"
            changed = True
        count += 1
        print("INSTALLED: %s → %s（bundle 声明 %s）" % (pid, dst, decl_state))
    if changed:
        write_profile(prof_pkg, prof)
        print("INSTALLED: bundle 声明已更新 %s" % prof_pkg)
    print("--install 汇总: 落位 %d 个预设, profile=%s" % (count, pd))
    legacy_notice(legacy_home)
    return EXIT_OK


def do_check(bundle_src, profile_dir, retired, legacy_home, ids):
    pd, prof_pkg, prof, local_root = load_profile(profile_dir)
    bundles = dig(prof, "dsh", "profile", "bundles")
    found, undeclared = discover(bundle_src)
    for want in ids:
        if want in retired:
            print("RETIRED: %s 已于 2026-09-23 退役（能力已技能化为 dev-doc-spec）" % want)
            return EXIT_VIOLATION
        if want not in found:
            print("INSTALL-DRIFT: %s 未注册预设（仓库无 bundle 源: %s/%s/package.json）" % (want, bundle_src, want))
            return EXIT_VIOLATION
    sel = {k: v for k, v in found.items() if not ids or k in ids}
    drift, ok = 0, 0
    for pid in sorted(sel):
        src = sel[pid]
        decl = "@local/dsh-preset-%s" % pid
        dst = local_root / ("dsh-preset-%s" % pid)
        problems = []
        if decl not in bundles:
            problems.append("选择器不可见: %s 的 dsh.profile.bundles 未声明 %s" % (prof_pkg, decl))
        if not dst.is_dir():
            problems.append("未安装: %s 不存在" % dst)
        else:
            for fn in BUNDLE_FILES:
                a, b = dst / fn, src / fn
                if not a.is_file():
                    problems.append("未安装: %s 不存在" % a)
                elif not b.is_file():
                    problems.append("仓库源缺: %s" % b)
                elif a.read_bytes() != b.read_bytes():
                    problems.append("内容不一致: %s ≠ %s" % (a, b))
        if problems:
            drift += 1
            for p in problems:
                print("INSTALL-DRIFT: %s %s" % (pid, p))
        else:
            ok += 1
            print("SYNC-OK: %s bundle 层与仓库源一致（%s）" % (pid, dst))
    for pid in sorted(undeclared):
        if ids and pid not in ids:
            continue
        drift += 1
        print("INSTALL-DRIFT: %s 仓库 package.json 缺 bundle 声明行 dsh.bundle.patch（选择器不可见）" % pid)
    if not sel and not undeclared and not ids:
        drift += 1
        print("INSTALL-DRIFT: 仓库侧零 bundle 源（%s）— 无对账基准" % bundle_src)
    print("preset bundle 漂移检查: 发现 %d 个预设, %d 个漂移" % (len(sel) + len(undeclared), drift))
    legacy_notice(legacy_home)
    return EXIT_VIOLATION if drift else EXIT_OK


def main():
    a = sys.argv[1:]
    # bash 传 8 个位置参数: MODE REPO_DIR BUNDLE_SRC PROFILE_DIR LEGACY_HOME DEGRADED_LOG RETIRED_IDS IDS
    mode, _repo_dir, bundle_src, profile_dir, legacy_home, degraded_log, retired_ids, ids_raw = a[0:8]
    ids = ids_raw.split()
    retired = set(retired_ids.split())
    try:
        if mode == "install":
            return do_install(bundle_src, profile_dir, retired, legacy_home, ids)
        if mode == "check":
            return do_check(bundle_src, profile_dir, retired, legacy_home, ids)
        raise Degraded("未知模式: %s" % mode)
    except Degraded as e:
        write_degraded(degraded_log, mode, str(e))
        sys.stderr.write("degraded: %s\n" % e)
        return EXIT_FAILED
    except OSError as e:
        # mkdir/copy/rename/read 等 OS 层失败一律降级（fail-closed，绝不半成品静默）
        msg = "OS 错误: %s" % e
        write_degraded(degraded_log, mode, msg)
        sys.stderr.write("degraded: %s\n" % msg)
        return EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
PYENGINE_EOF
RC=$?

if [ "$RC" -eq 2 ]; then
  echo "[exit 2] 判定不可信（执行失败/降级）— 详见上方 degraded: 行" >&2
fi
exit "$RC"
