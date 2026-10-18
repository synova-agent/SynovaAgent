#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-protection.sh — 门禁本体保护：仓内清单自检 ＋ diff 豁免核验（只读、三态）
#
# 设计哲学（一句）: **把「谁能改门禁」写成仓内可判的清单，让每次触碰都必须留下带理由、带裁定号、
#                    带批准人身份的豁免 —— 平台字段是刀，本器只是刀的磨刀石（误改报警，不是授权）。**
#
# 契约（铁律 47 / C1）:
#   @usage   bash scripts/control-tower/check-gate-protection.sh [--list <path>] [--changed-base <ref>]
#              [--root <dir>] [--json] [--help]
#            默认（无 --changed-base）= 清单完整性 ＋ pin ＋ APPROVERS
#            --changed-base <ref>     = 上述 ＋ base→HEAD diff 的受保护路径豁免核验
#   @input   .gitea/protected-files.txt（或 --list / SYNO_GATE_PROTECTED_LIST 注入）；
#            diff 模式：git 仓库（HEAD 与 <ref> 的 merge-base）
#   @output  stdout 逐项 ✅/❌（**含实测数字**）＋ 末行 `结果: N 通过, M 失败`；
#            --json 时 stdout 仅一份**合法 JSON**（人读行抑制，degraded 仍走 stderr）；
#            降级时 stdout 追加 `DEGRADED: <code> — <原因>`（CI 日志可见，不静默）
#   @exit    0=通过 ｜ 1=真红（pin 漂移 / 受保护变更无合规豁免 / 豁免不合法）
#            2=检查自身失败（清单缺失·不可读·解析为空·APPROVERS 空·坏 base·git 不可用·参数错）
#            🔴 三态铁律：2 绝不等于通过（fail-closed）
#   @degraded stderr 一行 `degraded: <原因>` ＋ 追加一行 JSON 到 SYNO_GATE_DEGRADED_LOG
#            （字段 time/component/code/phase/retryable；铁律 11/32）＋ exit 2
#   @error   code ∈ {E_LIST_MISSING, E_LIST_EMPTY, E_APPROVERS_EMPTY, E_PIN_MISMATCH,
#                   E_BAD_BASE, E_EXEMPT_INVALID}（C1 定集）
#            ＋ E_USAGE（参数用法错，C1 未列；按 DSH B1「typed error 必带 code」补齐）
#            ＋ E_INTERNAL（本器自身异常兜底：宁可 exit 2 也不许把 bug 当"真红"或"绿"）
#
# 注入缝（测试必需；生产有默认值）:
#   --list <path> / SYNO_GATE_PROTECTED_LIST   清单路径（--list 优先）
#   --root <dir>                               仓库根（默认 git toplevel，退化 pwd）
#   SYNO_GATE_DEGRADED_LOG                     降级事件日志（默认 <root>/.codex/control-tower/logs/degraded-events.log）
#
# 清单格式（真源，逐字节；与 specs SYNOVA-IMPL-2.5-S1 §2 S1-a 一致）:
#   # PROTECTED-PATTERNS-SHA256=<64hex>      pin：PATTERNS 段规范串的 sha256
#   # APPROVERS=<邮箱[,邮箱…]>                豁免生效所需的提交作者邮箱（空 ⇒ exit 2）
#   # PATTERNS-BEGIN  …逐行 glob…  # PATTERNS-END
#   pin 规范串 = PATTERNS 段内非空非注释行，按文件顺序，trim，各以 `\n` 收尾（= 行 + \n 串联）
#
# 豁免格式（gate-exemptions/*.md；README.md 显式排除）:
#   - <路径或 glob> — <理由> — <裁定号>      三段缺一 ⇒ 不生效（理由、裁定号均须非空）
#   该豁免文件**最后一次提交的作者邮箱**必须 ∈ APPROVERS（缺一 ⇒ exit 1 逐条点名）
#
# glob 语义 = Gitea/gobwas glob（**定义在下方 python 引擎，禁 fnmatch**）:
#   大小写不敏感 ｜ `**` 跨目录 ｜ `*` 不跨 `/` ｜ `?` 单字符（不跨 `/`）
#   🔴 禁 `python3 -c "import fnmatch"` 整串 translate：fnmatch 的 `*` 会跨 `/`（实测
#      `fnmatch.fnmatch('a/b/c','a*c') is True`）⇒ 会把"名字像"的路径误判为受保护。
#
# 只读承诺: 不写仓库内容、不 git add/commit、不调 Gitea API（无平台对账能力，token 403；
#           本文件对平台 API 路径「branch_protections」（带前导斜杠的写法）零命中 = DS-8 判据）。
#           唯一落盘 = 降级日志（.codex/ 不入库）。
#
# 授权（explicit authority）: 调用者 = CI job `local-gates` 的 ①d 步（pull_request 腿为主要拦截点）
#           ＋ 本地任意会话／提交者自检。无特权、无写权限需求；拒绝任何参数要求提权。
#
# 已复用的既有约定（禁重复实现）:
#   D1 三态退出码（scripts/control-tower/AGENTS.md）
#   D2 `@降级` ＋ SYNO_GATE_DEGRADED_LOG JSON（check-gate-integrity.sh 同形）
#   D3 UTF-8 强制（D732 / D313 M5；文件首两行）
#   D4 判别力自检 = 配对测试 tests/control-tower/check-gate-protection.test.sh（CT-40）
#   D5 沙箱注入缝范式 = check-dev-doc-write-set.sh 的 SYNO_DEV_DOC／--root
#
# 结构（Source map）:
#   段                职责
#   ────────────────  ───────────────────────────────────────────────────────────
#   ① 头部契约        本段（@input/@output/@exit/@degraded/@error/已知限制）
#   ② 解释器探测      PYBIN 三级探测（探**可用性**，不只看存在性——D328 P1-1）
#   ③ 参数与注入缝    --list/--root/--changed-base/--json；清单与日志默认值解析
#   ④ 清单解析         PATTERNS 段 / pin 声明 / APPROVERS（空段 ⇒ 信号量 0 ⇒ exit 2）
#   ⑤ glob 引擎        手写 glob→regex（** 跨目录、* 不跨 /、? 单字符、IGNORECASE）
#   ⑥ diff 豁免核验     merge-base / 受保护路径命中 / 豁免三段式 / 作者 ∈ APPROVERS / bootstrap
#   ⑦ 输出             逐项 ✅❌ ＋ `结果: N 通过, M 失败` ｜ --json 合法 JSON
#   ⑧ 降级              stderr `degraded:` ＋ degraded log JSON ＋ exit 2
#
# 已知限制（做不到什么 —— 禁读成"已检测"）:
#   1. **无平台漂移检测**：只核仓内清单与豁免；Gitea 平台规则是否被改/删，本器核不到（403）。
#   2. **pin 只是误改报警器**：蓄意改者可同步改 pin —— 真防线是 S2 的平台字段（裁）。
#   3. **豁免作者校验可被同机身份绕过**：换 git config user.email 即可冒充批准人；
#      真正授权仍是 S2 的 force-merge 限制。
#   4. **bootstrap 是一次性开孔**：仅"base 无清单"时跳过 diff；DS-6 反例保证它不是后门。
#   5. **push 腿 diff 为空**：push 到 local-main 时 merge-base == HEAD ⇒ 跳过 diff 判定；
#      真正的拦截在 pull_request 腿。**禁读成「push 也拦了」**。
#   6. **glob 不支持字符类**（`[abc]` 按字面量处理）；只实现 `*`／`**`／`?`（规格所需）。
#   7. **`X/**/Y` 的 `**/` 可为空目录层**（gobwas 严格语义下可能要求至少一层）⇒ 本器
#      更严（多保护不多放行），偏差方向是 fail-closed。
#   8. **pin 声明缺失按漂移处理**（exit 1）：宁可拦下坏的清单，也不放过未登记清单。
#   9. **`--json` 抑制人读行**（stdout 仅 JSON），便于 `jq`；证据留档请同时存 stderr。
#  10. **豁免行三段式以 em/en 破折号为界**：路径或理由**自身含 `—`/`–`** 会被多切一段
#      ⇒ 该行判不生效（fail-closed）。规避：路径用 glob 表达，理由里不要写破折号。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# ── ② 解释器探测（D520/D328：禁裸 python3；探可用性，不只看 command -v）──
PYBIN=""
for _c in python3 python py; do  # PYBIN 三级探测（PLATFORM-CHECKLIST #1；本行含 PYBIN 标记供 D520 平台扫描识别）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

# ── ③ 参数与注入缝 ──
GP_ROOT_ARG=""
GP_LIST_ARG=""
GP_BASE_ARG=""
GP_JSON=0
GP_USAGE_ERR=""
OWN_LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --list)
      if [ $# -lt 2 ]; then GP_USAGE_ERR="--list 需要参数 <path>"; break; fi
      GP_LIST_ARG="$2"; OWN_LIST=1; shift 2 ;;
    --changed-base)
      if [ $# -lt 2 ]; then GP_USAGE_ERR="--changed-base 需要参数 <ref>"; break; fi
      GP_BASE_ARG="$2"; shift 2 ;;
    --root)
      if [ $# -lt 2 ]; then GP_USAGE_ERR="--root 需要参数 <dir>"; break; fi
      GP_ROOT_ARG="$2"; shift 2 ;;
    --json)
      GP_JSON=1; shift ;;
    -h|--help)
      # 头注释即用法文档（单源：改契约只改头部，不留第二份会漂移的用法文本）
      sed -n '5,72p' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      GP_USAGE_ERR="未知参数: $1"; break ;;
  esac
done

if [ -n "$GP_ROOT_ARG" ]; then
  GP_ROOT="$GP_ROOT_ARG"
else
  GP_ROOT="$(git -c core.quotepath=false rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if [ -n "$GP_LIST_ARG" ]; then
  GP_LIST="$GP_LIST_ARG"
elif [ -n "${SYNO_GATE_PROTECTED_LIST:-}" ]; then
  GP_LIST="${SYNO_GATE_PROTECTED_LIST}"
else
  GP_LIST="$GP_ROOT/.gitea/protected-files.txt"
fi
GP_DEGRADED_LOG="${SYNO_GATE_DEGRADED_LOG:-$GP_ROOT/.codex/control-tower/logs/degraded-events.log}"
export GP_ROOT GP_LIST GP_BASE_ARG GP_JSON GP_DEGRADED_LOG

# 降级出口（bash 层：参数错 / 解释器缺失 / 目录不存在 —— 这些还没到 python 就已经判不了）
_degrade_log() { # $1=code $2=phase $3=原因
  mkdir -p "$(dirname "$GP_DEGRADED_LOG")" 2>/dev/null || true  # swallow-ok: 日志目录建不了也仍有 stderr + exit 2
  printf '{"time":"%s","component":"check-gate-protection","code":"%s","phase":"%s","retryable":false}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$GP_DEGRADED_LOG" 2>/dev/null || true  # swallow-ok: 同上，退出码已是 2
  # 说明: 降级日志不可写时，stderr 的 degraded: 行与 exit 2 已先行给出（铁律 11 不静默放行）
}
_degrade_exit() { # $1=code $2=phase $3=原因
  printf 'degraded: %s\n' "$3" >&2
  _degrade_log "$1" "$2" "$3"
  printf 'DEGRADED: %s — %s\n' "$1" "$3"
  printf '结果: 0 通过, 1 失败\n'
  exit 2
}

if [ -n "$GP_USAGE_ERR" ]; then
  _degrade_exit "E_USAGE" "args" "${GP_USAGE_ERR}（见 --help）"
fi
if [ ! -d "$GP_ROOT" ]; then
  _degrade_exit "E_BAD_BASE" "root" "仓库根不存在或不可进入: ${GP_ROOT}"
fi
if [ -z "$PYBIN" ]; then
  _degrade_exit "E_INTERNAL" "python" "python 解释器不可用（python3/python/py 均不可执行；禁裸 python3，D520）"
fi

# ── ④⑤⑥⑦⑧ 核心（单进程 python3；glob/sha256/JSON 均走标准库）──
"$PYBIN" - <<'PYCODE'
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

COMPONENT = "check-gate-protection"
PROTECTED_REL = ".gitea/protected-files.txt"


# ── typed error（DSH B1）：code 必填，phase 标注失败阶段 ──────────────────────
class GateError(Exception):
    """检查自身失败（exit 2）。code ∈ @error 集；message 进 stderr 与 degraded log。"""

    def __init__(self, code, phase, message):
        super().__init__(message)
        self.code = code
        self.phase = phase
        self.message = message


def now_utc():
    """UTC ISO-8601（秒级，Z 后缀）——与 check-gate-integrity.sh 同格式。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def git(args, cwd, check=False):
    """所有 git 调用统一带 `-c core.quotepath=false`（G12c 中文名盲区，禁省）。"""
    cmd = ["git", "-c", "core.quotepath=false"] + list(args)
    try:
        proc = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise GateError("E_BAD_BASE", "git", "git 不可执行: %s" % exc)
    out = proc.stdout.decode("utf-8", "replace")
    err = proc.stderr.decode("utf-8", "replace")
    if check and proc.returncode != 0:
        raise GateError("E_BAD_BASE", "git", "git %s 失败(rc=%d): %s"
                        % (" ".join(args), proc.returncode, err.strip() or out.strip()))
    return proc.returncode, out, err


# ── ⑤ glob 引擎：手写 translate（禁 fnmatch —— 其 `*` 会跨 `/`）─────────────────
_regex_cache = {}


def glob_to_regex(pattern):
    """glob → 正则。`**` 跨目录；`*` 不跨 `/`；`?` 单字符；大小写不敏感。"""
    cached = _regex_cache.get(pattern)
    if cached is not None:
        return cached
    out = []
    i = 0
    n = len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "*":
            if i + 1 < n and pattern[i + 1] == "*":
                i += 2
                if i < n and pattern[i] == "/":
                    # `**/` 允许零层目录（更严：多保护不多放行）
                    out.append("(?:.*/)?")
                    i += 1
                else:
                    out.append(".*")
                continue
            out.append("[^/]*")
            i += 1
            continue
        if ch == "?":
            out.append("[^/]")
            i += 1
            continue
        out.append(re.escape(ch))
        i += 1
    compiled = re.compile("^" + "".join(out) + "$", re.IGNORECASE)
    _regex_cache[pattern] = compiled
    return compiled


def glob_match(pattern, path):
    """判断仓库相对路径是否命中 glob（大小写不敏感）。"""
    try:
        return glob_to_regex(pattern).match(path) is not None
    except re.error:
        # 正则引擎拒绝（如超长嵌套）⇒ 视为不命中但**不静默**：调用方把该行记为问题
        return False


# ── ④ 清单解析 ────────────────────────────────────────────────────────────────
PIN_MASK = re.compile(r"^#\s*PROTECTED-PATTERNS-SHA256\s*=\s*([0-9a-fA-F]{64})\s*$")
APPROVERS_MASK = re.compile(r"^#\s*APPROVERS\s*=\s*(.*)$")


def read_list(path):
    """读清单：不存在/不可读 ⇒ E_LIST_MISSING(2)；非 UTF-8 可解码 ⇒ E_LIST_EMPTY(2)。"""
    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except OSError as exc:
        raise GateError("E_LIST_MISSING", "read", "清单缺失或不可读: %s（%s）" % (path, exc))
    try:
        return raw.decode("utf-8"), len(raw)
    except UnicodeDecodeError as exc:
        raise GateError("E_LIST_EMPTY", "parse",
                        "清单非 UTF-8 可解码: %s（%s）" % (path, exc))


def parse_list(text):
    """解析 PATTERNS 段 / pin / APPROVERS。返回 (patterns, pin, approvers)。"""
    lines = text.splitlines()
    begin = None
    end = None
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if begin is None and stripped == "# PATTERNS-BEGIN":
            begin = idx
        elif begin is not None and end is None and stripped == "# PATTERNS-END":
            end = idx
    if begin is None or end is None or end < begin:
        raise GateError("E_LIST_EMPTY", "parse",
                        "PATTERNS-BEGIN/PATTERNS-END 标记缺失或未成对 ⇒ 无法确定 PATTERNS 段")

    pin = None
    approvers = []
    for line in lines:
        stripped = line.strip()
        matched = PIN_MASK.match(stripped)
        if matched:
            pin = matched.group(1).lower()
        matched = APPROVERS_MASK.match(stripped)
        if matched:
            for item in re.split(r"[,;\s]+", matched.group(1)):
                item = item.strip().lower()
                if item and item not in approvers:
                    approvers.append(item)

    patterns = []
    for line in lines[begin + 1:end]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        patterns.append(stripped)
    return patterns, pin, approvers


def canonical(patterns):
    """pin 规范串：按文件顺序 trim 后各行 + `\\n`（等价于 `\\n` 连接并带末尾换行）。"""
    return "".join(p + "\n" for p in patterns)


# ── ⑥ 豁免解析（gate-exemptions/*.md；README.md 显式排除）──────────────────────
# 三段式分隔符 = em/en 破折号（**不含 ASCII `-`** —— 路径里常有连字符，会被误切）；
# 空格可有可无（`—  —` 空理由也要判成「缺理由」，不能退化成「缺三段式」）。
SEP = re.compile(r"\s*[—–]\s*")


def parse_exempt_text(text, source):
    """每行 `- <路径或 glob> — <理由> — <裁定号>`。三段缺一 ⇒ 该行记问题、不生效。"""
    entries = []
    for lineno, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if not stripped.startswith("- "):
            continue
        body = stripped[2:].strip()
        if not body:
            continue
        parts = SEP.split(body, 2)
        if len(parts) < 3:
            entries.append({"glob": body, "reason": "", "ruling": "", "line": lineno,
                            "problem": "缺「— 理由 — 裁定号」三段式", "source": source})
            continue
        entries.append({
            "glob": parts[0].strip(),
            "reason": parts[1].strip(),
            "ruling": parts[2].strip(),
            "line": lineno,
            "problem": None,
            "source": source,
        })
    return entries


def read_exempt_file(root, rel):
    """读豁免文件内容：优先工作树，退 git show HEAD:<path>（CI 上两者一致）。"""
    abs_path = os.path.join(root, rel)
    if os.path.isfile(abs_path):
        try:
            with open(abs_path, "rb") as fh:
                return fh.read().decode("utf-8", "replace")
        except OSError:
            pass
    rc, out, _ = git(["show", "HEAD:%s" % rel], root)
    if rc == 0:
        return out
    return ""


def last_author(root, rel):
    """该文件最后一次提交的作者邮箱（小写）；读不到 ⇒ 空串（fail-closed 处理）。"""
    rc, out, _ = git(["log", "-1", "--format=%ae", "--", rel], root)
    if rc != 0:
        return ""
    return out.strip().splitlines()[0].strip().lower() if out.strip() else ""


def is_exempt_file(path):
    """`gate-exemptions/*.md`；README.md（含任意层）显式排除 —— 它是格式说明，不是豁免。"""
    if not path.startswith("gate-exemptions/"):
        return False
    if not path.lower().endswith(".md"):
        return False
    return os.path.basename(path).lower() != "readme.md"


# ── 主流程 ────────────────────────────────────────────────────────────────────
def main():
    root = os.environ.get("GP_ROOT", "")
    list_path = os.environ.get("GP_LIST", "")
    base_ref = os.environ.get("GP_BASE_ARG", "")
    json_mode = os.environ.get("GP_JSON", "0") == "1"
    degraded_log = os.environ.get("GP_DEGRADED_LOG", "")

    checks = []
    failures = []
    report = {
        "component": COMPONENT,
        "ok": False,
        "exit": 0,
        "root": root,
        "list_path": list_path,
        "base_ref": base_ref or None,
        "patterns": 0,
        "pin_declared": None,
        "pin_computed": None,
        "approvers": [],
        "merge_base": None,
        "changed_paths": 0,
        "protected_changes": [],
        "exempt_files": [],
        "bootstrap": False,
        "checks": checks,
        "failures": failures,
        "degraded": None,
    }

    def ok(label):
        checks.append({"ok": True, "label": label})

    def fail(code, phase, label):
        checks.append({"ok": False, "label": label})
        failures.append({"code": code, "phase": phase, "message": label})

    def finish():
        if report["degraded"] is not None:
            code = 2
        elif failures:
            code = 1
        else:
            code = 0
        report["exit"] = code
        report["ok"] = code == 0
        passes = sum(1 for item in checks if item["ok"])
        fails = len(failures) + (1 if report["degraded"] else 0)
        if json_mode:
            sys.stdout.write(json.dumps(report, ensure_ascii=False, sort_keys=True) + "\n")
        else:
            sys.stdout.write("check-gate-protection — 门禁本体清单自检（只读，三态）\n")
            sys.stdout.write("root: %s\n" % root)
            sys.stdout.write("清单: %s\n" % list_path)
            for item in checks:
                sys.stdout.write("%s %s\n" % ("✅" if item["ok"] else "❌", item["label"]))
            if report["degraded"]:
                sys.stdout.write("DEGRADED: %s — %s\n"
                                 % (report["degraded"]["code"], report["degraded"]["message"]))
            if report["bootstrap"]:
                sys.stdout.write("BOOTSTRAP: 清单在 base 不存在，diff 模式跳过（首次落盘）\n")
            sys.stdout.write("结果: %d 通过, %d 失败\n" % (passes, fails))
        return code

    def degrade(code, phase, message):
        sys.stderr.write("degraded: %s\n" % message)
        report["degraded"] = {"code": code, "phase": phase, "message": message}
        try:
            directory = os.path.dirname(degraded_log)
            if directory:
                os.makedirs(directory, exist_ok=True)
            with open(degraded_log, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({
                    "time": now_utc(),
                    "component": COMPONENT,
                    "code": code,
                    "phase": phase,
                    "retryable": False,
                }, ensure_ascii=False) + "\n")
        except OSError:
            # swallow-ok: stderr 已给出 degraded 行且退出码为 2（不静默放行；见已知限制）
            pass
        return finish()

    try:
        # ④ 清单：存在/可读 → 非空 → pin → APPROVERS
        text, nbytes = read_list(list_path)
        report["list_bytes"] = nbytes
        ok("清单存在且可读（bytes=%d）" % nbytes)

        patterns, pin, approvers = parse_list(text)
        report["patterns"] = len(patterns)
        report["pin_declared"] = pin
        report["approvers"] = approvers

        if not patterns:
            raise GateError("E_LIST_EMPTY", "parse",
                            "PATTERNS 段为空（信号量 0：全注释/空行 ⇒ 无法判任何路径，禁当作通过）")
        ok("PATTERNS %d 条（信号量 >0）" % len(patterns))

        computed = hashlib.sha256(canonical(patterns).encode("utf-8")).hexdigest()
        report["pin_computed"] = computed
        if pin is None:
            fail("E_PIN_MISMATCH", "pin", "pin 声明缺失：清单缺 `# PROTECTED-PATTERNS-SHA256=` 行"
                                          "（按漂移处理，实算 %s）" % computed[:8])
        elif pin != computed:
            fail("E_PIN_MISMATCH", "pin", "pin 漂移：声明 %s… 实算 %s…（改了 PATTERNS 未同步 pin）"
                                          % (pin[:8], computed[:8]))
        else:
            ok("pin 一致（声明 %s… 实算 %s…）" % (pin[:8], computed[:8]))

        if not approvers:
            raise GateError("E_APPROVERS_EMPTY", "approvers",
                            "APPROVERS 为空：无批准人 ⇒ 任何豁免都无法生效（禁当作通过）")
        ok("APPROVERS %d 项（%s）" % (len(approvers), ",".join(approvers)))

        # ⑥ diff 模式
        if base_ref:
            rc, _, _ = git(["rev-parse", "--verify", "--quiet", "%s^{commit}" % base_ref], root)
            if rc != 0:
                raise GateError("E_BAD_BASE", "rev-parse",
                                "base ref 不可解析: %s（禁退 origin/*；见已知限制）" % base_ref)
            rc, out, _ = git(["merge-base", base_ref, "HEAD"], root)
            if rc != 0 or not out.strip():
                raise GateError("E_BAD_BASE", "merge-base", "merge-base 失败: %s" % base_ref)
            merge_base = out.strip().splitlines()[0].strip()
            report["merge_base"] = merge_base

            # base 里有没有「本清单」：没有 ⇒ 一次性 bootstrap（唯一开孔）
            rel_list = PROTECTED_REL
            if list_path.startswith(root.rstrip("/") + "/"):
                rel_list = os.path.relpath(list_path, root)
            rc, _, _ = git(["cat-file", "-e", "%s:%s" % (merge_base, rel_list)], root)
            if rc != 0:
                report["bootstrap"] = True
                ok("base 无清单（%s@%s 不存在）⇒ 一次性 bootstrap 开孔（唯一开孔，DS-6 反例把守）"
                   % (rel_list, merge_base[:8]))
                return finish()
            ok("base 可解析（%s → merge-base %s）" % (base_ref, merge_base[:8]))

            rc, out, _ = git(["diff", "--name-only", merge_base, "HEAD"], root)
            if rc != 0:
                raise GateError("E_BAD_BASE", "diff", "git diff %s HEAD 失败" % merge_base[:8])
            changed = [line.strip() for line in out.splitlines() if line.strip()]
            report["changed_paths"] = len(changed)
            ok("diff 变更路径 %d 条（base %s → HEAD）" % (len(changed), merge_base[:8]))

            protected = []
            for path in changed:
                for pattern in patterns:
                    if glob_match(pattern, path):
                        protected.append(path)
                        break
            report["protected_changes"] = protected

            exempt_rels = [path for path in changed if is_exempt_file(path)]
            exempt_info = []
            for rel in exempt_rels:
                author = last_author(root, rel)
                author_ok = author in approvers
                entries = parse_exempt_text(read_exempt_file(root, rel), rel)
                exempt_info.append({"path": rel, "author": author,
                                    "author_ok": author_ok, "entries": entries})
            report["exempt_files"] = [
                {"path": item["path"], "author": item["author"], "author_ok": item["author_ok"]}
                for item in exempt_info
            ]

            if not protected:
                ok("受保护路径变更 0 条（无需豁免）")
            else:
                ok("受保护路径变更 %d 条（需逐条合规豁免）" % len(protected))
                for path in protected:
                    covered = False
                    notes = []
                    for info in exempt_info:
                        if not info["author_ok"]:
                            notes.append("%s 作者非批准人(%s)"
                                         % (info["path"], info["author"] or "未知"))
                            continue
                        for entry in info["entries"]:
                            if entry["problem"]:
                                notes.append("%s:%d %s"
                                             % (entry["source"], entry["line"], entry["problem"]))
                                continue
                            if not entry["reason"]:
                                notes.append("%s:%d `%s` 缺理由"
                                             % (entry["source"], entry["line"], entry["glob"]))
                                continue
                            if not entry["ruling"]:
                                notes.append("%s:%d `%s` 缺裁定号"
                                             % (entry["source"], entry["line"], entry["glob"]))
                                continue
                            if glob_match(entry["glob"], path):
                                covered = True
                                break
                        if covered:
                            break
                    if covered:
                        ok("受保护路径有合规豁免: %s" % path)
                    else:
                        reason = "; ".join(notes) if notes else "diff 内无 gate-exemptions/*.md，或豁免行未覆盖该路径"
                        fail("E_EXEMPT_INVALID", "exempt",
                             "受保护路径无合规豁免: %s（%s）" % (path, reason))
        return finish()
    except GateError as exc:
        return degrade(exc.code, exc.phase, exc.message)
    except Exception as exc:  # noqa: BLE001 —— 兜底：宁可 exit 2 也不把自身 bug 当"真红/绿"
        return degrade("E_INTERNAL", "internal", "本器内部异常: %s: %s"
                       % (type(exc).__name__, exc))


if __name__ == "__main__":
    sys.exit(main())
PYCODE
rc=$?
exit "$rc"
