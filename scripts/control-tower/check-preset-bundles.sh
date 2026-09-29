#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-preset-bundles.sh — DSH 预设「仓库 bundle 源 ↔ 运行时 bundle 层」校验（D945 段①④）
#
# 背景（D945，CTO 批准）: 2026-09-23 运行时 bundle 迁移已完成（profiles/desktop 的
#   dsh.profile.bundles 16 条 + node_modules/@local/ 12 个），但**仓库侧无 bundle 源**
#   → 迁移不可复现、漂移不可检测（preset-synova-squad-lead 的已装 patch 至今含 legacy
#   `delegation` 行、缺 `agent-team` 行）。本脚本把「仓库源 vs 运行时」变成可判定事实。
#
# 契约（铁律 47）:
#   @input  — --repo                 校验仓库 bundle 源形态（$BUNDLE_SRC/*/{package.json,cordis.patch.yml}）
#             --consistency          运行时 bundle 层 vs 仓库源逐预设对账 + legacy 边界判据
#             --emit [<id>]          由 legacy 源（$LEGACY_HOME/.agent-presets/<id>/）重新生成 patch
#                                    到 stdout（审计复现路径；id 省略时须恰有 1 个已发现预设）
#             [<preset-id>...]       限定预设子集（缺省 = $BUNDLE_SRC 下全部已发现预设）
#   @output — 逐预设一行判定 + 末尾汇总行。点名字符串（夹具可 grep）:
#             REPO-OK: / REPO-DRIFT: / CONSISTENT: / STALE: / RUNTIME-ONLY: /
#             LEGACY-PRESENT: / LEGACY-REVIVED: / LEGACY-RETIRED: / WARN: / degraded:
#   @exit   — 0 = 全部通过；1 = 判定违规（源形态错 / 陈旧 / 未声明 / legacy 在场）；
#             2 = 执行失败或降级（PYBIN 不可用 / 源目录缺失 / JSON 不可解析 / 不可写 / 参数错）
#             —— D328 三态：2 绝不与 0 混同
#   @degraded — stderr `degraded: <原因>` + 追加 $DEGRADED_LOG 五字段
#             {time, component, phase, reason, retryable}（+ schema 版本戳，
#              与 scripts/control-tower/control_tower_log.py 的 degraded/v1 约定对齐）
#   @error  — 不抛异常给调用方；全部经退出码表达（ctrl-tower-change 模式 1）
#
# 注入缝（env；测试隔离用，一次运行不碰真实 home）:
#   SYNO_PRESET_REPO_DIR   仓库 bundle 源根（默认 $REPO/docs/synova/presets）
#   SYNO_PROFILE_DIR       运行时 profile 目录（默认解析序见下方 resolve 段；每次运行都打印）
#   SYNO_LEGACY_HOME       legacy home（默认 $DSH_HOME 或 $HOME/.dsh-trial-017 或 $HOME/.dsh）
#   SYNO_PRESET_DEGRADED_LOG  降级日志（默认 $REPO/.codex/control-tower/logs/degraded-events.log）
#   SYNO_PRESET_LEGACY_JOURNAL legacy 观察日志（默认 <降级日志同目录>/preset-legacy-journal.log）
#                          —— 「在场→红」是状态判据；「曾退役后又出现→红」需跨运行记忆
#   SYNO_EMIT_DATE         --emit 生成日期（默认今天；钉住可逐字节复现已入库文件）
#
# 平台（windows-compat / PLATFORM-CHECKLIST）: PYBIN 三级探测 + 试运行可用性；无裸 python3；
#   无 grep -P；无 date +%s / date -v；无 sed -i；无权限位判据。
# 用法: bash scripts/control-tower/check-preset-bundles.sh --repo|--consistency|--emit
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
#    Win Git Bash 无 python3（仅 python/py）；D330: 探测后须试运行，损坏 shim 不得当作可用
PYBIN=""
for _c in python3 python py; do  # D520/PYBIN: 探测候选名单（非裸调用；实际调用一律走 "$PYBIN"）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then
    PYBIN="$_c"; break
  fi
done

DEGRADED_LOG="${SYNO_PRESET_DEGRADED_LOG:-$REPO_DIR/.codex/control-tower/logs/degraded-events.log}"
JOURNAL="${SYNO_PRESET_LEGACY_JOURNAL:-$(dirname "$DEGRADED_LOG")/preset-legacy-journal.log}"
BUNDLE_SRC="${SYNO_PRESET_REPO_DIR:-$REPO_DIR/docs/synova/presets}"
PROFILE_DIR_IN="${SYNO_PROFILE_DIR:-}"
EMIT_DATE="${SYNO_EMIT_DATE:-$(date -u +%Y-%m-%d)}"

MODE=""
IDS=""

# ── 降级：显式 stderr + 五字段日志 + exit 2（绝不与通过混同）──
degrade() { # <reason>
  local reason="$1" ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "degraded: ${reason} (component=check-preset-bundles, phase=${MODE:-none}, retryable=true)" >&2
  mkdir -p "$(dirname "$DEGRADED_LOG")" 2>/dev/null || true
  if [ -n "$PYBIN" ]; then
    "$PYBIN" -c '
import json,sys
rec={"schema":"control-tower/logs/degraded/v1","time":sys.argv[1],"component":"check-preset-bundles",
     "phase":sys.argv[2],"reason":sys.argv[3],"retryable":True}
try:
    open(sys.argv[4],"a",encoding="utf-8").write(json.dumps(rec,ensure_ascii=False)+"\n")
except OSError as e:
    sys.stderr.write("degraded-log-write-failed: %s\n" % e)
' "$ts" "${MODE:-none}" "$reason" "$DEGRADED_LOG" || true
  else
    # PYBIN 不可用时的兜底（reason 为内部常量，不含双引号）
    printf '{"schema":"control-tower/logs/degraded/v1","time":"%s","component":"check-preset-bundles","phase":"%s","reason":"%s","retryable":true}\n' \
      "$ts" "${MODE:-none}" "$reason" >> "$DEGRADED_LOG" 2>/dev/null || true
  fi
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) MODE="repo" ;;
    --consistency) MODE="consistency" ;;
    --emit) MODE="emit" ;;
    -h|--help) echo "用法: $0 --repo|--consistency|--emit [<preset-id>...]"; exit 0 ;;
    --*) degrade "未知参数: $1" ;;
    *) IDS="$IDS $1" ;;
  esac
  shift
done
[ -n "$MODE" ] || degrade "必须指定 --repo / --consistency / --emit 之一"
[ -n "$PYBIN" ] || degrade "python 不可用（python3/python/py 均缺失或不可运行）"

# ── profile dir 解析（每次运行都打印，可观测不静默）──
#   序: env 注入 → $DSH_HOME/profiles/desktop → ~/.dsh-trial-017/... （已迁移的 trial home）
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
# ── legacy home 解析（与 profile 同口径：优先已迁移的 trial home）──
if [ -n "${SYNO_LEGACY_HOME:-}" ]; then
  LEGACY_HOME="$SYNO_LEGACY_HOME"
elif [ -n "${DSH_HOME:-}" ]; then
  LEGACY_HOME="$DSH_HOME"
elif [ -d "$HOME/.dsh-trial-017/.agent-presets" ]; then
  LEGACY_HOME="$HOME/.dsh-trial-017"
else
  LEGACY_HOME="$HOME/.dsh"
fi

# 解析结果走 stderr（诊断面）—— stdout 只留判定行/生成物，使 --emit 的 stdout 可直接逐字节比对
echo "check-preset-bundles: mode=${MODE}" >&2
echo "  bundle-src:  ${BUNDLE_SRC}" >&2
echo "  profile-dir: ${PROFILE_DIR_IN}" >&2
echo "  legacy-home: ${LEGACY_HOME}" >&2

"$PYBIN" - "$MODE" "$REPO_DIR" "$BUNDLE_SRC" "$PROFILE_DIR_IN" "$LEGACY_HOME" \
  "$DEGRADED_LOG" "$JOURNAL" "$EMIT_DATE" "$IDS" <<'PYENGINE_EOF'
# -*- coding: utf-8 -*-
"""check-preset-bundles python 引擎（bash 已完成参数解析 / PYBIN 探测 / 降级兜底）。"""
import datetime
import json
import sys
from pathlib import Path

EXIT_OK = 0
EXIT_VIOLATION = 1
EXIT_FAILED = 2
COMPONENT = "check-preset-bundles"

# 预设技能要求表（数据驱动，非 if 特例）: <preset-id> → 必须在 patch 中出现的插件行 token
REQUIRED_TOKENS = {
    # D931: 小队能力由 Agent Teams 承载（maxMembers=4）；缺此行 = 队长只会有面板不有成员
    "synova-squad-lead": ["@deepseek-ai/dsh-experimental-agent-team"],
}
# D931: Agent Teams 用同名工具替换 legacy 子代理控制 → 两者不得共存
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
    """文件驱动注册表。返回 (found, undeclared):
    found      — 目录名 → 目录（package.json 声明了 dsh.bundle.patch）
    undeclared — 目录名 → 目录（有 package.json 但缺 bundle 声明行 = 选择器不可见）
    """
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


def select(found, ids):
    if not ids:
        return dict(found)
    return {k: v for k, v in found.items() if k in ids}


def check_repo(bundle_src, ids):
    found, undeclared = discover(bundle_src)
    bad = 0
    for pid in sorted(undeclared):
        if ids and pid not in ids:
            continue
        bad += 1
        # M1: bundle 声明行缺失 → 该预设对 GUI 选择器不可见
        print("REPO-DRIFT: %s package.json 缺 bundle 声明行 dsh.bundle.patch（该预设对选择器不可见）" % pid)
    sel = select(found, ids)
    for want in sorted(ids):
        if want not in found and want not in undeclared:
            bad += 1
            print("REPO-DRIFT: %s 未发现 bundle 源（缺 %s/%s/package.json）" % (want, bundle_src, want))
    if not sel and not undeclared and not ids:
        print("REPO-DRIFT: 未发现任何 bundle 源（%s/*/package.json 零命中）" % bundle_src)
        print("--repo 汇总: 发现 0 个预设, 违规 1 个")
        return EXIT_VIOLATION
    for pid in sorted(sel):
        d = sel[pid]
        pkg = read_json(d / "package.json", "bundle 源 package.json")
        expect_name = "@local/dsh-preset-%s" % pid
        patch_rel = dig(pkg, "dsh", "bundle", "patch")
        problems = []
        if pkg.get("name") != expect_name:
            problems.append("package.json name 不符: %r ≠ %r" % (pkg.get("name"), expect_name))
        pf = d / patch_rel
        if not pf.is_file():
            problems.append("声明的 patch 不存在: %s" % pf)
        else:
            text = read_text_safe(pf)
            for need in (
                "- insert:",
                "    - id: preset-%s" % pid,          # M2: id 改错 → 此处必红
                "      name: '@deepseek-ai/dsh-agent-preset'",
                "        id: %s" % pid,
                "        name: ",
                "        description: ",
                "        plugins:",
            ):
                if need not in text:
                    problems.append("patch 缺结构行: %r" % need.strip())
            for tok in LEGACY_FORBIDDEN_TOKENS:
                if tok in text:
                    problems.append("patch 含 legacy 行 %r（D931: Agent Teams 与 legacy 子代理控制不得共存）" % tok)
            for tok in REQUIRED_TOKENS.get(pid, []):
                if tok not in text:
                    problems.append("patch 缺必需插件行 %s（该预设团队能力不可见）" % tok)
        if problems:
            bad += 1
            for p in problems:
                print("REPO-DRIFT: %s %s" % (pid, p))
        else:
            print("REPO-OK: %s package.json + %s 形态合规" % (pid, patch_rel))
    print("--repo 汇总: 发现 %d 个预设, 违规 %d 个" % (len(sel) + len(undeclared), bad))
    return EXIT_VIOLATION if bad else EXIT_OK


def read_journal(path):
    """legacy 观察日志: <id>\\t<state>\\t<iso>；同一 id 末行胜。"""
    states = {}
    p = Path(path)
    if not p.is_file():
        return states
    for ln in read_text_safe(p).splitlines():
        parts = ln.split("\t")
        if len(parts) >= 2 and parts[0] and parts[1] in ("present", "retired"):
            states[parts[0]] = parts[1]
    return states


def write_journal(path, pid, state):
    p = Path(path)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write("%s\t%s\t%s\n" % (pid, state, now_iso()))
    except OSError as e:
        raise Degraded("legacy 观察日志不可写: %s (%s)" % (p, e))


def legacy_check(legacy_home, journal, installed):
    """legacy 边界判据: 在场 → 红；曾退役后又出现（复活）→ 红。返回判红数。
    注意: 空目录也要读日志——否则「present → 消失」这一退役跃迁永远观测不到，
    复活判据就永远无法触发（本函数是 M3 三段判别性用例的被测点）。
    """
    ap = Path(legacy_home) / ".agent-presets"
    subs = sorted([p.name for p in ap.iterdir() if p.is_dir()]) if ap.is_dir() else []
    states = read_journal(journal)
    red = 0
    for name in subs:
        decl = "@local/dsh-preset-%s" % name
        equiv = ("已有 bundle 等价物 %s" % decl) if decl in installed else "尚无 bundle 等价物（仅运行时可读）"
        if states.get(name) == "retired":
            print("LEGACY-REVIVED: %s 曾退役后又出现（%s）— 收口回退，判红" % (ap / name, equiv))
        else:
            print("LEGACY-PRESENT: %s 仍在场（%s）— D945 收口目标：迁移完成后应删除" % (ap / name, equiv))
        red += 1
        write_journal(journal, name, "present")
    for name in sorted(states):
        if states[name] == "present" and name not in subs:
            write_journal(journal, name, "retired")
            print("LEGACY-RETIRED: %s 已不在场（记为退役；若再出现将判 LEGACY-REVIVED）" % (ap / name))
    return red


def check_consistency(bundle_src, profile_dir, legacy_home, journal, ids):
    pd = Path(profile_dir)
    if not pd.is_dir():
        raise Degraded("profile 目录不存在: %s" % profile_dir)
    prof_pkg = pd / "package.json"
    prof = read_json(prof_pkg, "运行时 profile package.json")
    bundles = dig(prof, "dsh", "profile", "bundles")
    if not isinstance(bundles, list):
        raise Degraded("运行时 profile package.json 无 dsh.profile.bundles 列表: %s" % prof_pkg)
    local_root = pd / "node_modules" / "@local"
    installed = {}
    if local_root.is_dir():
        for d in sorted([p for p in local_root.iterdir() if p.is_dir()]):
            installed["@local/%s" % d.name] = d
    else:
        print("WARN: %s 无 node_modules/@local/（疑似未迁移 home，或该 profile 未安装任何 @local bundle）" % pd)

    found, undeclared = discover(bundle_src)
    sel = select(found, ids)
    bad, ok = 0, 0
    for pid in sorted(sel):
        d = sel[pid]
        decl = "@local/dsh-preset-%s" % pid
        inst_expected = local_root / ("dsh-preset-%s" % pid)
        problems = []
        if decl not in bundles:
            # M1(运行时): 声明行缺失 → GUI 选择器不可见
            problems.append("选择器不可见: %s 的 dsh.profile.bundles 未声明 %s" % (prof_pkg, decl))
        inst = installed.get(decl)
        if inst is None or not inst.is_dir():
            problems.append("未安装: %s 不存在" % inst_expected)
        else:
            for fn in ("package.json", "cordis.patch.yml"):
                a = inst / fn
                b = d / fn
                if not a.is_file():
                    problems.append("未安装: %s 不存在" % a)
                elif not b.is_file():
                    problems.append("仓库源缺: %s" % b)
                elif a.read_bytes() != b.read_bytes():
                    reason = "陈旧: %s ≠ %s" % (a, b)
                    if fn == "cordis.patch.yml":
                        ta, tb = read_text_safe(a), read_text_safe(b)
                        reason += (
                            "\n     证据: installed agent-team=%d id-delegation=%d | repo agent-team=%d id-delegation=%d"
                            % (
                                ta.count("agent-team"), ta.count("id: delegation"),
                                tb.count("agent-team"), tb.count("id: delegation"),
                            )
                        )
                    problems.append(reason)
        if problems:
            bad += 1
            for p in problems:
                print("STALE: %s %s" % (pid, p))
        else:
            ok += 1
            print("CONSISTENT: %s bundle 层与仓库源逐字节一致（%s）" % (pid, inst))

    repo_names = set(found)
    for name in sorted(installed):
        pid = name[len("@local/dsh-preset-"):]
        if pid not in repo_names:
            print("RUNTIME-ONLY: %s 已安装但仓库无 bundle 源（%s）" % (name, installed[name]))
    for pid in sorted(undeclared):
        bad += 1
        print("STALE: %s 仓库 package.json 缺 bundle 声明行 dsh.bundle.patch（该预设对选择器不可见）" % pid)
    if not sel and not undeclared and not ids:
        bad += 1
        print("STALE: 仓库侧零 bundle 源（%s）— 无对账基准" % bundle_src)

    lg_red = legacy_check(legacy_home, journal, installed)
    print("--consistency 汇总: 一致 %d, 陈旧 %d, legacy 判红 %d" % (ok, bad, lg_red))
    return EXIT_VIOLATION if (bad or lg_red) else EXIT_OK


def gen_patch(pid, cordis_path, preset_path, date):
    """由 legacy 源生成 bundle patch（形态与已入库参考件逐字节一致）。"""
    lines = read_text_safe(cordis_path).split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    meta = {}
    for ln in read_text_safe(preset_path).splitlines():
        if ln.startswith("name: "):
            meta["name"] = ln[len("name: "):]
        elif ln.startswith("description: "):
            meta["description"] = ln[len("description: "):]
    if "name" not in meta or "description" not in meta:
        raise Degraded("legacy preset.yml 缺 name/description: %s" % preset_path)

    def needs_quote(v):
        if ": " in v or " #" in v:
            return True
        return v[:1] in ("-", "?", "!", "&", "*", "|", ">", "%", "@", "`", "'", '"', "[", "{", ",", " ")

    def yq(v):
        return json.dumps(v, ensure_ascii=False) if needs_quote(v) else v

    head = (
        "# 由 %s/preset.yml + agent.cordis.yml 迁移生成（%s）\n"
        "# 迁移规则见 @deepseek-ai/dsh-agent-preset 的 editing-cordis-compositions SKILL。\n"
        "- insert:\n"
        "    - id: preset-%s\n"
        "      name: '@deepseek-ai/dsh-agent-preset'\n"
        "      config:\n"
        "        id: %s\n"
        "        name: %s\n"
        "        description: %s\n"
        "        plugins:\n" % (pid, date, pid, pid, yq(meta["name"]), yq(meta["description"]))
    )
    body = "\n".join(("          " + ln) if ln.strip() else "" for ln in lines)
    return head + body + "\n"


def do_emit(bundle_src, legacy_home, emit_date, ids):
    found, _undeclared = discover(bundle_src)
    if ids:
        chosen = sorted(ids)
    elif len(found) == 1:
        chosen = sorted(found)
    else:
        raise Degraded("--emit 需指定预设 id（仓库已发现 %d 个 bundle 源）" % len(found))
    for pid in chosen:
        base = Path(legacy_home) / ".agent-presets" / pid
        cordis, preset = base / "agent.cordis.yml", base / "preset.yml"
        if not cordis.is_file():
            raise Degraded("legacy 源缺失: %s" % cordis)
        if not preset.is_file():
            raise Degraded("legacy 源缺失: %s" % preset)
        sys.stdout.write(gen_patch(pid, cordis, preset, emit_date))
    return EXIT_OK


def main():
    a = sys.argv[1:]
    mode, _repo_dir, bundle_src, profile_dir, legacy_home, degraded_log, journal, emit_date = a[0:8]
    ids = a[8].split() if len(a) > 8 else []
    try:
        if mode == "repo":
            return check_repo(bundle_src, ids)
        if mode == "consistency":
            return check_consistency(bundle_src, profile_dir, legacy_home, journal, ids)
        if mode == "emit":
            return do_emit(bundle_src, legacy_home, emit_date, ids)
        raise Degraded("未知模式: %s" % mode)
    except Degraded as e:
        write_degraded(degraded_log, mode, str(e))
        sys.stderr.write("degraded: %s\n" % e)
        return EXIT_FAILED
    except OSError as e:
        # 读/写 OS 层失败 → 判不了 ≠ 通过（fail-closed）
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
