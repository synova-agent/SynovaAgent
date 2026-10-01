#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# check-preset-parity.sh — C2 跨机预设/技能一致性检查（X30 落地同步 v2 · C 组）
#
# 规格源（唯一依据，只读）: /Users/wane/山河研究院/05-组织协作工作流/补充研究-2-Win侧完整规格.md
#   [W]:261 §八 G4 行     方案 = 导出指纹（**16 skill sha256 ＋ 预设 cordis.patch.yml sha256
#                         ＋ DSH 断面 tag ＋ bundles 行数**）落 `docs/synova/parity/{mac,win}.json`；
#                         两侧各提交；**CI diff 腿**（两文件逐字节比对，不一致即红）＋周检兜底
#   [W]:277 §九-7 落地行  验收 = 两侧各跑各提交；CI 上两 json 逐字节一致；人为改一侧→CI 红
#                         （改坏即红夹具 = tests/control-tower/check-preset-parity.test.sh）
#   [W]:284 §九-14 (#14)  **parity diff 腿先建议级（不阻断）**；升级必需集走 1a/1b 流程
#
# 契约（铁律 47）:
#   @input  — --generate [--side mac|win|auto]        生成 <parity-dir>/<side>.json（**只写这一份**）
#             --check [--a <f>] [--b <f>] [--advisory] 比对两份指纹（缺省 mac.json ↔ win.json）
#             --dir <parity 目录>      缺省 $REPO_DIR/docs/synova/parity
#             注入缝（env；夹具隔离用，一次运行不碰真实 home / 真实仓）:
#               SYNO_PARITY_REPO_DIR / SYNO_PARITY_SKILLS_DIR / SYNO_PARITY_PRESET_DIR /
#               SYNO_PARITY_ANCHOR / SYNO_PROFILE_DIR / SYNO_DSH_TREE
#   @output — 四项逐条判定行（`[OK]` / `[DIFF]` + 逐条点名）+ 末尾**一行摘要**
#             （`PARITY: GENERATED|OK|DIFF|PENDING|VIOLATION|DEGRADED …`，夹具按固定串 grep）
#   @exit   — 0 = 一致（或对侧为**合法占位**）；1 = 不一致 / 形态非法（→ CI 里是**建议级红**）；
#             2 = 执行失败或降级（参数错 / PYBIN 不可用 / 文件缺失 / JSON 不可解析 / 不可写）
#             —— D328 三态：2 绝不与 0 混同
#   @degraded — **只走 stderr 显式 `degraded: …` + exit 2，不写任何日志文件**。
#             本器受「除 docs/synova/parity/*.json（生成模式）外零写入」硬契约约束，故**不落**
#             control-tower 五字段降级日志（与 check-preset-bundles.sh 的有意差异；
#             理由与替代留痕见 docs/synova/parity/README.md §7）。
#
# 指纹四项（逐字对齐 [W]:261 —— 不多不少）:
#   ① skills_sha256                `.dsh/skills/<id>/` 各一条（当前 16 条）
#   ② preset_cordis_patch_sha256   预设源下每个 `<id>/cordis.patch.yml` 各一条
#   ③ dsh_anchor_tag               DSH 断面唯一源 `docs/synova/coordination/DSH-断面.json` 的 current.tag
#   ④ bundles_line_count           运行时 profile `package.json` 的 `dsh.profile.bundles` 条数
#
# 口径（复现命令见 docs/synova/parity/README.md）:
#   · skill 摘要 = sha256( 按相对路径排序的 "<relpath> <file-sha256>" 行拼接 + "\n" )
#     —— 取**整目录**（不只 SKILL.md：dev-doc-delivery/template/ 会漏）
#   · 一律按 **LF 归一**后取 sha256（Win autocrlf 检出 CRLF 不得产生跨机假红）
#   · json 以 UTF-8 字节直写（不经文本模式 → 不落 CRLF）；键序固定 + 子表按名排序 ⇒ 幂等可复跑
#   · bundles「行数」= 数组条数（每条一行；与 §九-4「Mac bundles 行同步移除」同口径）
#
# 平台（PLATFORM-CHECKLIST.md #1/#4）: PYBIN 三级探测（禁裸 python3）；无 grep -P；无 sed -i；
#   无 date +%s / date -v；无权限位判据；UTF-8 强制。
# 用法: bash scripts/control-tower/check-preset-parity.sh --generate [--side mac|win]
#       bash scripts/control-tower/check-preset-parity.sh --check [--advisory]
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${SYNO_PARITY_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

# ── PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
#    Win Git Bash 无 python3（仅 python/py）；D330: 探测后须试运行，损坏 shim 不得当作可用
PYBIN=""
for _c in python3 python py; do  # D520/PYBIN: 探测候选名单（非裸调用；实际调用一律走 "$PYBIN"）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then
    PYBIN="$_c"; break
  fi
done

MODE=""
SIDE="auto"
PARITY_DIR=""
FILE_A=""
FILE_B=""
ADVISORY=0

usage() {
  cat <<'USAGE'
用法: bash scripts/control-tower/check-preset-parity.sh --generate [--side mac|win|auto]
      bash scripts/control-tower/check-preset-parity.sh --check [--a <file>] [--b <file>] [--advisory]
  --generate       导出本侧指纹到 <parity-dir>/<side>.json（唯一写文件模式；只写本侧那一份）
  --side <s>       本侧标识；auto（缺省）= 按 uname 识别（Darwin→mac / MINGW|MSYS|CYGWIN→win）
  --check          比对两份指纹（缺省 <parity-dir>/mac.json ↔ <parity-dir>/win.json）
  --a <file>       A 侧 json（缺省 <parity-dir>/mac.json；夹具注入用）
  --b <file>       B 侧 json（缺省 <parity-dir>/win.json；夹具注入用）
  --advisory       不一致时仍 exit 0（建议级用；缺省 exit 1 以便夹具断言"改坏即红"）
  --dir <d>        parity 目录（缺省 <repo>/docs/synova/parity）
  -h, --help       本帮助
退出码: 0 = 一致/对侧合法占位；1 = 不一致或形态非法（建议级红）；2 = 降级（见脚本头 @degraded）
USAGE
}

# ── 降级出口（铁律 11/32）：stderr 显式 + 一行摘要 + exit 2；**零文件写入**
degrade() { # <reason>
  printf 'degraded: %s (component=check-preset-parity, phase=%s, retryable=true)\n' "$1" "${MODE:-none}" >&2
  printf 'PARITY: DEGRADED\n'
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --generate) MODE="generate" ;;
    --check) MODE="check" ;;
    --side) shift; SIDE="${1:-}" ;;
    --dir) shift; PARITY_DIR="${1:-}" ;;
    --a) shift; FILE_A="${1:-}" ;;
    --b) shift; FILE_B="${1:-}" ;;
    --advisory) ADVISORY=1 ;;
    -h|--help) usage; exit 0 ;;
    --*) degrade "未知参数: $1" ;;
    *) degrade "未知位置参数: $1" ;;
  esac
  shift
done

[ -n "$MODE" ] || degrade "必须指定 --generate 或 --check 之一"
[ -n "$PYBIN" ] || degrade "python 不可用（python3/python/py 均缺失或不可运行）"

[ -n "$PARITY_DIR" ] || PARITY_DIR="$REPO_DIR/docs/synova/parity"
SKILLS_DIR="${SYNO_PARITY_SKILLS_DIR:-$REPO_DIR/.dsh/skills}"
PRESET_DIR="${SYNO_PARITY_PRESET_DIR:-$REPO_DIR/docs/synova/presets}"
ANCHOR_FILE="${SYNO_PARITY_ANCHOR:-$REPO_DIR/docs/synova/coordination/DSH-断面.json}"

# ── 侧别识别（只在生成模式需要）──
if [ "$MODE" = "generate" ] && [ "$SIDE" = "auto" ]; then
  case "$(uname -s 2>/dev/null)" in  # swallow-ok: uname 缺失/失败 → 空串 → 走 default 显式降级（不猜侧别）
    Darwin) SIDE="mac" ;;
    MINGW*|MSYS*|CYGWIN*) SIDE="win" ;;
    *) SIDE="" ;;
  esac
  if [ -z "$SIDE" ]; then
    degrade "无法自动识别所在侧（uname 非 Darwin/MINGW/MSYS/CYGWIN）；请显式 --side mac|win"
  fi
fi

# ── profile dir 解析（与 check-preset-bundles.sh 同口径；每次生成都打印，可观测不静默）──
#   序: env 注入 → $DSH_HOME/profiles/desktop → ~/.dsh-trial-017/profiles/desktop → ~/.dsh/profiles/desktop
PROFILE_DIR="${SYNO_PROFILE_DIR:-}"
if [ -z "$PROFILE_DIR" ]; then
  if [ -n "${DSH_HOME:-}" ] && [ -d "${DSH_HOME}/profiles/desktop" ]; then
    PROFILE_DIR="${DSH_HOME}/profiles/desktop"
  elif [ -d "$HOME/.dsh-trial-017/profiles/desktop" ]; then
    PROFILE_DIR="$HOME/.dsh-trial-017/profiles/desktop"
  else
    PROFILE_DIR="$HOME/.dsh/profiles/desktop"
  fi
fi

if [ "$MODE" = "generate" ]; then
  {
    printf 'check-preset-parity: mode=generate side=%s\n' "$SIDE"
    printf '  repo-dir:    %s\n' "$REPO_DIR"
    printf '  parity-dir:  %s\n' "$PARITY_DIR"
    printf '  skills-dir:  %s\n' "$SKILLS_DIR"
    printf '  preset-dir:  %s\n' "$PRESET_DIR"
    printf '  anchor:      %s\n' "$ANCHOR_FILE"
    printf '  profile-dir: %s\n' "$PROFILE_DIR"
  } >&2
fi

"$PYBIN" - "$MODE" "$SIDE" "$PARITY_DIR" "$SKILLS_DIR" "$PRESET_DIR" "$ANCHOR_FILE" \
  "$PROFILE_DIR" "$FILE_A" "$FILE_B" "$ADVISORY" "$REPO_DIR" <<'PYENGINE_EOF'
# -*- coding: utf-8 -*-
"""check-preset-parity python 引擎（bash 已完成参数解析 / PYBIN 探测 / 侧别识别 / 降级兜底）。

零写入契约: 除 generate 模式的 <parity-dir>/<side>.json 外，本引擎不创建/修改任何文件
（check 模式零写入 —— 由 tests/control-tower/check-preset-parity.test.sh 以整树摘要断言）。
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

SCHEMA = "synova/parity/v1"
ITEMS = ("skills_sha256", "preset_cordis_patch_sha256", "dsh_anchor_tag", "bundles_line_count")
EXIT_OK, EXIT_VIOLATION, EXIT_FAILED = 0, 1, 2
SKILL_BASELINE = 16   # [W]:261「16 skill」基准；仅用于 NOTE，不做硬判（多/少由 diff 判据抓）
HEX = frozenset("0123456789abcdef")


class Degraded(Exception):
    """执行失败/降级 → exit 2（D328：绝不与 0 混同）。"""


def degraded(reason):
    raise Degraded(reason)


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def read_lf_bytes(path):
    """按 LF 归一读取字节（Win autocrlf 检出的 CRLF 不得产生跨机假红）。"""
    try:
        return Path(path).read_bytes().replace(b"\r\n", b"\n")
    except OSError as exc:
        degraded("不可读 %s (%s)" % (path, exc))


def read_json(path, what):
    try:
        raw = Path(path).read_bytes()
    except OSError as exc:
        degraded("%s 不存在或不可读: %s (%s)" % (what, path, exc))
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        degraded("%s 不可解析: %s (%s)" % (what, path, exc))


# ═══ 指纹四项采集 ═══════════════════════════════════════════════════════════════

def collect_skills(skills_dir):
    """① 每个 skill 目录一条摘要（口径: 整目录 + LF 归一 + 按相对路径排序）。"""
    root = Path(skills_dir)
    if not root.is_dir():
        degraded("skills 目录不存在: %s" % root)
    out = {}
    for entry in sorted(root.iterdir(), key=lambda p: p.name):
        if not entry.is_dir():
            continue
        files = sorted((p for p in entry.rglob("*") if p.is_file()),
                       key=lambda p: p.relative_to(entry).as_posix())
        if not files:
            degraded("skill 目录内无文件（空目录不产生判定价值）: %s" % entry)
        lines = ["%s %s" % (f.relative_to(entry).as_posix(), sha256_bytes(read_lf_bytes(f)))
                 for f in files]
        out[entry.name] = sha256_bytes(("\n".join(lines) + "\n").encode("utf-8"))
    if not out:
        degraded("skills 目录下无子目录（零 skill 的指纹无判定价值）: %s" % root)
    return out


def collect_presets(preset_dir):
    """② 预设源下每个 cordis.patch.yml 一条摘要（单文件 → LF 归一后直接取 sha256）。"""
    root = Path(preset_dir)
    if not root.is_dir():
        degraded("预设源目录不存在: %s" % root)
    out = {}
    for entry in sorted(root.iterdir(), key=lambda p: p.name):
        patch = entry / "cordis.patch.yml"
        if entry.is_dir() and patch.is_file():
            out[entry.name] = sha256_bytes(read_lf_bytes(patch))
    if not out:
        degraded("预设源目录下无 cordis.patch.yml（零预设的指纹无判定价值）: %s" % root)
    return out


def collect_anchor_tag(anchor_path):
    """③ DSH 断面 tag —— 只读唯一源 docs/synova/coordination/DSH-断面.json 的 current.tag。"""
    obj = read_json(anchor_path, "DSH 断面唯一源")
    cur = obj.get("current") if isinstance(obj, dict) else None
    tag = cur.get("tag") if isinstance(cur, dict) else None
    if not isinstance(tag, str) or not tag.strip():
        degraded("DSH 断面唯一源缺 current.tag: %s" % anchor_path)
    return tag.strip()


def collect_bundles_count(profile_dir):
    """④ 运行时 profile 的 dsh.profile.bundles 条数（= 行数口径，见脚本头）。"""
    pkg = Path(profile_dir) / "package.json"
    obj = read_json(pkg, "运行时 profile package.json")
    dsh = obj.get("dsh") if isinstance(obj, dict) else None
    prof = dsh.get("profile") if isinstance(dsh, dict) else None
    bundles = prof.get("bundles") if isinstance(prof, dict) else None
    if not isinstance(bundles, list):
        degraded("运行时 profile 无 dsh.profile.bundles 列表: %s" % pkg)
    return len(bundles)


def build_fingerprint(skills, presets, tag, count):
    """键序固定 + 子表按名排序 ⇒ 两侧同源输入必得同字节（幂等可复跑）。"""
    return {
        "schema": SCHEMA,
        "skills_sha256": {k: skills[k] for k in sorted(skills)},
        "preset_cordis_patch_sha256": {k: presets[k] for k in sorted(presets)},
        "dsh_anchor_tag": tag,
        "bundles_line_count": count,
    }


def dump_bytes(doc):
    """UTF-8 字节直写（不经文本模式 ⇒ 不落 CRLF），尾随单换行。"""
    return (json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=False) + "\n").encode("utf-8")


# ═══ 形态校验（改坏即红的判据面） ═══════════════════════════════════════════════

def _is_sha256(value):
    return isinstance(value, str) and len(value) == 64 and all(c in HEX for c in value)


def validate_fingerprint(doc, label):
    probs = []
    for key in ("skills_sha256", "preset_cordis_patch_sha256"):
        table = doc.get(key)
        if not isinstance(table, dict) or not table:
            probs.append("%s: %s 须为非空对象" % (label, key))
            continue
        for name in sorted(table):
            if not _is_sha256(table[name]):
                probs.append("%s: %s.%s 非 64 位小写 hex sha256" % (label, key, name))
    tag = doc.get("dsh_anchor_tag")
    if not isinstance(tag, str) or not tag.strip():
        probs.append("%s: dsh_anchor_tag 须为非空字符串" % label)
    count = doc.get("bundles_line_count")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        probs.append("%s: bundles_line_count 须为非负整数" % label)
    return probs


def is_placeholder(doc):
    return doc.get("placeholder") is True


def validate_placeholder(doc, label):
    """占位必须是**明确的空壳**：带指纹值即形态非法（禁伪造对侧数据 —— 改坏即红）。"""
    probs = []
    status = doc.get("status")
    if status not in ("pending-mac", "pending-win"):
        probs.append("%s: 占位须含 status=pending-mac|pending-win（实得 %r）" % (label, status))
    note = doc.get("note")
    if not isinstance(note, str) or not note.strip():
        probs.append("%s: 占位须含非空 note（写明待哪一侧生成/提交）" % label)
    for key in ITEMS:
        if doc.get(key) is not None:
            probs.append("%s: 占位 %s 须为 null（占位不得携带指纹值）" % (label, key))
    return probs


def _show(value):
    return "(缺失)" if value is None else str(value)


def _map_diff(a, b, out):
    n = 0
    for name in sorted(set(a) | set(b)):
        va, vb = a.get(name), b.get(name)
        if va == vb:   # MUTATION-SEAM（夹具 M4 自证）: 改为 `if True:` 即"逐条点名"判据失效
            continue
        n += 1
        out.append("      - %s: A=%s B=%s" % (name, _show(va), _show(vb)))
    return n


def diff_items(a, b):
    """逐项比对四项 → (不一致项数, 输出行)。仅用于**点名差异**；红/绿由逐字节比对判定。"""
    out = []
    n_items = 0
    for key in ("skills_sha256", "preset_cordis_patch_sha256"):
        ma = a.get(key) if isinstance(a.get(key), dict) else {}
        mb = b.get(key) if isinstance(b.get(key), dict) else {}
        details = []
        n = _map_diff(ma, mb, details)
        out.append("  [%s] %s（A=%d B=%d，值不同/单侧缺失 %d）"
                   % ("OK" if n == 0 else "DIFF", key, len(ma), len(mb), n))
        out.extend(details)
        if n:
            n_items += 1
    for key in ("dsh_anchor_tag", "bundles_line_count"):
        va, vb = a.get(key), b.get(key)
        if va != vb:
            n_items += 1
            out.append("  [DIFF] %s: A=%s B=%s" % (key, _show(va), _show(vb)))
        else:
            out.append("  [OK] %s（A=%s）" % (key, _show(va)))
    return n_items, out


# ═══ 模式实现 ═══════════════════════════════════════════════════════════════════

def verify_dsh_tree(anchor_obj):
    """Win 侧同步包 §7.1「跨机版本对账命令」并入指纹第三项 —— 本机树在场时对账 HEAD/version。

    只读 + **只告警**（NOTE/WARN 走 stderr，不改退出码）：树不在场 = 无法自证，显式留痕不猜。
    """
    cur = anchor_obj.get("current") if isinstance(anchor_obj, dict) else None
    cur = cur if isinstance(cur, dict) else {}
    tree = os.environ.get("SYNO_DSH_TREE", "")
    if not tree:
        cand = cur.get("path")
        if isinstance(cand, str) and Path(cand).is_dir():
            tree = cand
    if not tree or not Path(tree).is_dir():
        sys.stderr.write("NOTE: 本机 DSH 树不在场（未设 SYNO_DSH_TREE，断面源 current.path 亦非目录）"
                         "→ 跳过 §7.1 跨机版本对账（指纹第三项仍取唯一源 tag）\n")
        return
    try:
        head = subprocess.run(["git", "-C", tree, "rev-parse", "--short", "HEAD"],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              check=False).stdout.decode("utf-8", "replace").strip()
    except OSError as exc:
        sys.stderr.write("WARN: §7.1 对账跳过 —— git 不可用 (%s)\n" % exc)
        return
    ver = ""
    try:
        pkg = json.loads((Path(tree) / "package.json").read_bytes().decode("utf-8"))
        ver = str(pkg.get("version", "")) if isinstance(pkg, dict) else ""
    except (OSError, ValueError):
        ver = ""
    want_head, want_ver = str(cur.get("head", "")), str(cur.get("version", ""))
    if head == want_head and ver == want_ver:
        sys.stderr.write("NOTE: §7.1 跨机版本对账一致 —— 本机 DSH 树 %s @ %s（唯一源同值）\n"
                         % (ver, head))
    else:
        sys.stderr.write("WARN: §7.1 跨机版本对账不一致 —— 本机 DSH 树 %s @ %s vs 唯一源 %s @ %s"
                         "（先拉平源码树；本器只告警不判红）\n" % (ver, head, want_ver, want_head))


def mode_generate(side, parity_dir, skills_dir, preset_dir, anchor_file, profile_dir, repo_dir):
    if side not in ("mac", "win"):
        degraded("--side 须为 mac|win（实得 %r）" % side)
    skills = collect_skills(skills_dir)
    presets = collect_presets(preset_dir)
    anchor_obj = read_json(anchor_file, "DSH 断面唯一源")
    cur = anchor_obj.get("current") if isinstance(anchor_obj, dict) else None
    tag = cur.get("tag") if isinstance(cur, dict) else None
    if not isinstance(tag, str) or not tag.strip():
        degraded("DSH 断面唯一源缺 current.tag: %s" % anchor_file)
    tag = tag.strip()
    count = collect_bundles_count(profile_dir)

    target = Path(parity_dir) / ("%s.json" % side)
    # 写入面自证: 只允许 <parity-dir>/{mac,win}.json（越界即降级，宁可不写）
    if target.name not in ("mac.json", "win.json") or target.parent != Path(parity_dir):
        degraded("内部错误: 目标路径越界 %s" % target)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(dump_bytes(build_fingerprint(skills, presets, tag, count)))
    except OSError as exc:
        degraded("写入失败: %s (%s)" % (target, exc))

    if len(skills) != SKILL_BASELINE:
        sys.stderr.write("NOTE: skills=%d（规格基准 %d）—— 多/少即跨机差异，本器不在此判红\n"
                         % (len(skills), SKILL_BASELINE))
    verify_dsh_tree(anchor_obj)
    try:
        shown = target.relative_to(repo_dir).as_posix()
    except ValueError:
        shown = str(target)
    print("PARITY: GENERATED %s -> %s（skills=%d preset=%d tag=%s bundles=%d）"
          % (side, shown, len(skills), len(presets), tag, count))
    return EXIT_OK


def _load_side(path, label):
    if not Path(path).is_file():
        degraded("%s 不存在: %s（两侧各跑 --generate 后各提交一份）" % (label, path))
    doc = read_json(path, label)
    if not isinstance(doc, dict):
        degraded("%s 非 JSON 对象: %s" % (label, path))
    if doc.get("schema") != SCHEMA:
        degraded("%s 的 schema 非 %s（实得 %r）: %s" % (label, SCHEMA, doc.get("schema"), path))
    return doc


def mode_check(parity_dir, file_a, file_b, advisory):
    path_a = file_a or os.path.join(parity_dir, "mac.json")
    path_b = file_b or os.path.join(parity_dir, "win.json")
    name_a, name_b = Path(path_a).name, Path(path_b).name
    doc_a = _load_side(path_a, "A(mac)")
    doc_b = _load_side(path_b, "B(win)")

    ph_a, ph_b = is_placeholder(doc_a), is_placeholder(doc_b)
    problems = []
    for doc, label, ph in ((doc_a, "A(mac)", ph_a), (doc_b, "B(win)", ph_b)):
        problems.extend(validate_placeholder(doc, label) if ph else validate_fingerprint(doc, label))

    print("PARITY-CHECK: %s <-> %s" % (name_a, name_b))
    if problems:
        for prob in problems:
            print("  [VIOLATION] " + prob)
        print("PARITY: VIOLATION(%d)（指纹形态非法）— ADVISORY-RED 建议级红"
              "（[W]:284 —— CI 不阻断；升级必需集走 1a/1b 流程）" % len(problems))
        return EXIT_OK if advisory else EXIT_VIOLATION

    if ph_a or ph_b:
        pend = "mac" if ph_a else "win"
        holder = name_a if ph_a else name_b
        print("  [PENDING] %s 为占位（待 %s 侧生成/提交）—— 无指纹可比，本判据不判红" % (holder, pend))
        print("PARITY: PENDING（待 %s 侧提交；既非一致、也未判红 —— 占位是明确状态，不是伪造数据）" % pend)
        return EXIT_OK

    byte_equal = read_lf_bytes(path_a) == read_lf_bytes(path_b)
    print("  （LF 归一后逐字节比对: %s）" % ("一致" if byte_equal else "不一致"))
    n_items, lines = diff_items(doc_a, doc_b)
    for line in lines:
        print(line)

    if byte_equal:
        print("PARITY: OK（逐字节一致；skills=%d preset=%d）"
              % (len(doc_a.get("skills_sha256") or {}), len(doc_a.get("preset_cordis_patch_sha256") or {})))
        return EXIT_OK

    if n_items == 0:
        print("PARITY: DIFF（四项语义一致，但两文件**非逐字节一致** —— 键序/缩进/换行/冗余字段）"
              "— ADVISORY-RED 建议级红（[W]:284 —— CI 不阻断）")
    else:
        print("PARITY: DIFF（四项中 %d 项不一致）— ADVISORY-RED 建议级红"
              "（[W]:284 —— parity 先建议级、CI 不阻断；升级必需集走 1a/1b 流程）" % n_items)
    return EXIT_OK if advisory else EXIT_VIOLATION


def main(argv):
    if len(argv) != 11:
        degraded("内部错误: 参数个数 %d != 11" % len(argv))
    mode, side, parity_dir, skills_dir, preset_dir, anchor_file, profile_dir, fa, fb, adv, repo_dir = argv
    advisory = (adv == "1")
    if mode == "generate":
        return mode_generate(side, parity_dir, skills_dir, preset_dir, anchor_file, profile_dir, repo_dir)
    if mode == "check":
        return mode_check(parity_dir, fa, fb, advisory)
    degraded("未知模式: %r" % mode)


if __name__ == "__main__":
    _mode = sys.argv[1] if len(sys.argv) > 1 else "none"
    try:
        sys.exit(main(sys.argv[1:]))
    except Degraded as _exc:
        sys.stderr.write("degraded: %s (component=check-preset-parity, phase=%s, retryable=true)\n"
                         % (_exc, _mode))
        print("PARITY: DEGRADED")
        sys.exit(EXIT_FAILED)
    except Exception as _exc:   # 未预期异常必须显式降级（fail-closed），不得装成通过
        sys.stderr.write("degraded: 内部错误 %s: %s (component=check-preset-parity, phase=%s)\n"
                         % (type(_exc).__name__, _exc, _mode))
        print("PARITY: DEGRADED")
        sys.exit(EXIT_FAILED)
PYENGINE_EOF
rc=$?
exit "$rc"
