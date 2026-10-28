#!/bin/bash
# D313 M5 / D732 UTF-8 强制: Windows 控制台/子进程统一 UTF-8（跨平台硬要求，禁删）
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# check-gate-protection.sh — 门禁本体保护：仓内清单自检 ＋ diff 豁免核验（只读、三态）
#
# 设计哲学（一句）: **把「谁能改门禁」写成仓内可判的清单，让每次触碰都必须留下带理由、带裁定号、
#                    可审的证据链 —— 平台字段是刀，本器只是刀的磨刀石（误改报警，不是授权）。**
#
# 契约（铁律 47 / C1）:
#   @usage   bash scripts/control-tower/check-gate-protection.sh [--list <path>] [--changed-base <ref>]
#              [--root <dir>] [--require-review=0|1] [--json] [--help]
#            默认（无 --changed-base）= 清单完整性 ＋ pin
#            --changed-base <ref>     = 上述 ＋ base→HEAD diff 的受保护路径豁免核验
#            --require-review=0|1     = 新增豁免文件的复核件检查开关（默认 1；0＝回滚点，
#                                       见下方「复核件」段）。仅 --changed-base 模式生效。
#   @input   .gitea/protected-files.txt（或 --list / SYNO_GATE_PROTECTED_LIST 注入）；
#            diff 模式：git 仓库（HEAD 与 <ref> 的 merge-base）；新增/存量判定 =
#            `git cat-file -e <merge-base>:<path>`（存在 ⇒ legacy）
#   @output  stdout 逐项 ✅/❌（**含实测数字**）＋ 末行 `结果: N 通过, M 失败`；
#            diff 模式逐件标注豁免文件归属（legacy＝base 已存在／新增＝须带复核件）；
#            --json 时 stdout 仅一份**合法 JSON**（人读行抑制，degraded 仍走 stderr）；
#            降级时 stdout 追加 `DEGRADED: <code> — <原因>`（CI 日志可见，不静默）
#   @exit    0=通过 ｜ 1=真红（pin 漂移 / 受保护变更无合规豁免 / 豁免不合法 /
#            新增豁免文件缺复核件首行）
#            2=检查自身失败（清单缺失·不可读·解析为空·坏 base·base 无清单·
#            git 不可用·参数错：含 --require-review 非 0|1）
#            🔴 三态铁律：2 绝不等于通过（fail-closed）
#   @degraded stderr 一行 `degraded: <原因>` ＋ 追加一行 JSON 到 SYNO_GATE_DEGRADED_LOG
#            （字段 time/component/code/phase/retryable；铁律 11/32）＋ exit 2
#   @error   code ∈ {E_LIST_MISSING, E_LIST_EMPTY, E_PIN_MISMATCH,
#                   E_BAD_BASE, E_EXEMPT_INVALID}（C1 定集；#623 删作者校验相关 code）
#            ＋ E_USAGE（参数用法错，C1 未列；按 DSH B1「typed error 必带 code」补齐）
#            ＋ E_INTERNAL（本器自身异常兜底：宁可 exit 2 也不许把 bug 当"真红"或"绿"）
#            🔴 复核件缺失**复用 E_EXEMPT_INVALID（phase=review）**，不新增 code
#               —— C1 错误码集是契约，扩码需 CTO 裁定；语义上它属「豁免证据链不完整」。
#   @review  复核件（#1100 W3 收窄版；判据 = 证据链指针，非审批签名）:
#            仅**新增**豁免文件（base 上不存在）要求**首行**为下列任一形态：
#              `# review: <PR#>`                       例 `# review: #1234`
#              `# review: docs/synova/reviews/<文件名>.json`
#            存量件（base 已存在 ⇒ legacy）冻结：**不要求**复核件、不迁移、不加 expiry。
#            🔴 legacy 判据 = `git cat-file -e <merge-base>:<path>`（存在性），**禁**用
#               日期/内容启发式；故「改一版旧文件」仍按 legacy 免检（收窄版有意如此）。
#            缺失 ⇒ exit 1 并**点名文件**（逐件一行）；`--require-review=0` 关闭本检查
#            （回滚点，逐件打印「未核复核件」以免读成已检）。
#
# 注入缝（测试必需；生产有默认值）:
#   --list <path> / SYNO_GATE_PROTECTED_LIST   清单路径（--list 优先）
#   --root <dir>                               仓库根（默认 git toplevel，退化 pwd）
#   SYNO_GATE_DEGRADED_LOG                     降级事件日志（默认 <root>/.codex/control-tower/logs/degraded-events.log）
#
# 清单格式（真源，逐字节；与 specs SYNOVA-IMPL-2.5-S1 §2 S1-a ＋ #623 裁 217 一致）:
#   # PROTECTED-PATTERNS-SHA256=<64hex>      pin：PATTERNS 段规范串的 sha256
#   # PATTERNS-BEGIN  …逐行 glob…  # PATTERNS-END
#   pin 规范串 = PATTERNS 段内非空非注释行，按文件顺序，trim，各以 `\n` 收尾（= 行 + \n 串联）
#   🔴 PATTERNS 首行 = 本清单自身、末行 = gate-exemptions/**（#623）：清单与豁免目录自我保护
#
# 豁免格式（gate-exemptions/*.md；README.md 显式排除）:
#   - <路径或 glob> — <理由> — <裁定号>
#   三段校验（#623 裁 217 加严）：路径非空 ｜ 理由 strip 后 ≥10 字（Unicode 字符数）｜
#   裁定号 fullmatch ^(裁\s*[0-9]+|#[0-9]+)$（如 `裁 217`／`#623`）。
#   不合规行**不生效**，且**该行本身计 failure**（E_EXEMPT_INVALID；即使另一行已覆盖该路径）。
#   🔴 不再校验提交作者（作者名单已删）：豁免=可审证据链，授权归裁定号（台账）。
#
# 复核件（#1100 W3 收窄版；见 @review）:
#   **新增**豁免文件（`git cat-file -e <merge-base>:<path>` 不存在）⇒ 首行必须为
#     `# review: <PR#>`  或  `# review: docs/synova/reviews/<文件名>.json`
#   存量件（base 已存在）= legacy ⇒ 冻结，免复核件检查（不迁移、不加 expiry）。
#   🔴 判据只认 base 存在性；新增件缺首行 ⇒ exit 1 并点名文件。
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
#   ③ 参数与注入缝    --list/--root/--changed-base/--require-review/--json；清单与日志默认值解析
#   ④ 清单解析         PATTERNS 段 / pin 声明（空段 ⇒ 信号量 0 ⇒ exit 2）
#   ⑤ glob 引擎        手写 glob→regex（** 跨目录、* 不跨 /、? 单字符、IGNORECASE）
#   ⑥ diff 豁免核验     merge-base / base 清单存在性 / 受保护路径命中 / 豁免三段式加严（不合规行计 failure）
#                      ／ 豁免件 legacy 归属（base 存在性）／新增件复核件首行（--require-review）
#   ⑦ 输出             逐项 ✅❌ ＋ `结果: N 通过, M 失败` ｜ --json 合法 JSON
#   ⑧ 降级              stderr `degraded:` ＋ degraded log JSON ＋ exit 2
#
# 已知限制（做不到什么 —— 禁读成"已检测"）:
#   1. **无平台漂移检测**：只核仓内清单与豁免；Gitea 平台规则是否被改/删，本器核不到（403）。
#   2. **pin 只是误改报警器**：蓄意改者可同步改 pin —— 真防线是 S2 的平台字段（裁）。
#   3. **作者签名语义已消失（#623）**：不再校验提交作者 ⇒ 豁免只证明「有路径/理由/裁定号的
#      证据链」，**不证明谁批准**；授权仍归裁定号（台账）与 S2 的 force-merge 限制。
#   4. **base 无清单 ⇒ 2（E_BAD_BASE）**：清单自 S1（23a4f5a38）起已落 main，不再有"首次落盘"
#      例外；#610 已退役 bootstrap，陈旧/错误 base 一律 fail-closed（不再有一次性开孔）。
#   5. **陈旧但含清单的 base ⇒ 可能假红**：diff 会把 base..HEAD 间别人的变更算进来；
#      本器无远端知识，不判新鲜度（CI 由 ①d 每次刷新，本地开发者自行 `git fetch`）。
#   6. **push 腿 diff 为空**：push 到 local-main 时 merge-base == HEAD ⇒ 跳过 diff 判定；
#      真正的拦截在 pull_request 腿。**禁读成「push 也拦了」**。
#   7. **glob 不支持字符类**（`[abc]` 按字面量处理）；只实现 `*`／`**`／`?`（规格所需）。
#   8. **`X/**/Y` 的 `**/` 可为空目录层**（gobwas 严格语义下可能要求至少一层）⇒ 本器
#      更严（多保护不多放行），偏差方向是 fail-closed。
#   9. **pin 声明缺失按漂移处理**（exit 1）：宁可拦下坏的清单，也不放过未登记清单。
#  10. **`--json` 抑制人读行**（stdout 仅 JSON），便于 `jq`；证据留档请同时存 stderr。
#  11. **豁免行三段式以 em/en 破折号为界**：路径或理由**自身含 `—`/`–`** 会被多切一段
#      ⇒ 该行判不生效（fail-closed）。规避：路径用 glob 表达，理由里不要写破折号。
#  12. **清单与豁免目录自我保护（#623）**：PATTERNS 首行=清单自身、末行=gate-exemptions/** ⇒
#      改清单或改/加豁免文件本身也成为受保护变更（需同 diff 合规豁免行覆盖，含「自覆盖」）。
#      这是有意的无死锁解法；旧口径「目录不加保护是有意设计」已作废。
#  13. **旧作者引述不回改**：历史 `docs/plans/**`、旧 `memory/notes/**`、旧 `.claude/task-briefs/**`
#      中的作者名单／「创始人作者」引述保持原样（历史引述性质）⇒ **全仓** grep 不为 0 是预期；
#      本器只保证清单/检查器/两测试/README 四处零命中。
#  14. **理由字数按 Unicode 字符数**（Python `len()`），中文一字=1；不按字节、不按词。
#  15. **复核件只核首行形态**：不核 PR# 是否真实存在、也不核 `docs/synova/reviews/*.json`
#      指向的文件是否已落盘（复核件通常晚于豁免件产生）⇒ 它是**证据指针**，不是签名校验。
#  16. **legacy 判据 = base 存在性，不是「本次新增」**：base 上已有的豁免文件即使本 diff 内
#      被改，也**不要求**复核件（#1100 收窄版有意如此：存量 86 份冻结，不迁移、不加 expiry）。
#      副作用：蓄意者可「先合入空壳豁免件（无复核件），下一 PR 再填内容」绕过本检查
#      ⇒ 与已知限制 2（pin 只是误改报警器）同性质，真防线仍是独立复核与 K3 审计。
#  17. **`--require-review=0` 是回滚点**：关闭时新增件不判复核件（仍判三段式），
#      逐件打印「未核复核件」以免把「没检查」读成「已通过」；非法值 ⇒ E_USAGE（exit 2）。
#  18. **默认模式（无 --changed-base）不判复核件**：无 diff 就无「新增」语义，只做清单＋pin。
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
GP_REVIEW_ARG=""
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
    --require-review=*)
      # #1100 W3：复核实开关（默认 1；`=0` 为唯一回滚点）。只收 `=0|1` 形态，
      # 其它写法（空格分参、非 0/1 值）一律参数错 ⇒ exit 2（判不了 ≠ 通过）。
      GP_REVIEW_ARG="${1#--require-review=}"; shift ;;
    --json)
      GP_JSON=1; shift ;;
    -h|--help)
      # 头注释即用法文档（单源：改契约只改头部，不留第二份会漂移的用法文本）。
      # 动态取界（原 `sed -n '5,79p'` 写死行号：头部一加行就截掉契约末尾 ⇒ 文档失真）。
      awk 'NR > 5 { if ($0 ~ /^# ═/) exit; print }' "${BASH_SOURCE[0]}" | sed -e 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      GP_USAGE_ERR="未知参数: $1"; break ;;
  esac
done

# 复核件开关：未设 ⇒ 1（默认开）。值集只容 0|1 —— 非法值走 E_USAGE（exit 2，禁静默当默认）。
GP_REQUIRE_REVIEW="${GP_REVIEW_ARG:-1}"
if [ -z "$GP_USAGE_ERR" ]; then
  case "$GP_REQUIRE_REVIEW" in
    0|1) ;;
    *) GP_USAGE_ERR="--require-review 只接受 0|1（实测: ${GP_REQUIRE_REVIEW}）" ;;
  esac
fi

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
export GP_ROOT GP_LIST GP_BASE_ARG GP_JSON GP_DEGRADED_LOG GP_REQUIRE_REVIEW

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
    """解析 PATTERNS 段 / pin。返回 (patterns, pin)。"""
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
    for line in lines:
        stripped = line.strip()
        matched = PIN_MASK.match(stripped)
        if matched:
            pin = matched.group(1).lower()

    patterns = []
    for line in lines[begin + 1:end]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        patterns.append(stripped)
    return patterns, pin


def canonical(patterns):
    """pin 规范串：按文件顺序 trim 后各行 + `\\n`（等价于 `\\n` 连接并带末尾换行）。"""
    return "".join(p + "\n" for p in patterns)


# ── ⑥ 豁免解析（gate-exemptions/*.md；README.md 显式排除）──────────────────────
# 三段式分隔符 = em/en 破折号（**不含 ASCII `-`** —— 路径里常有连字符，会被误切）；
# 空格可有可无（`—  —` 空理由也要判成「缺理由」，不能退化成「缺三段式」）。
SEP = re.compile(r"\s*[—–]\s*")
# #623 裁 217：理由 strip 后 ≥10 字（Unicode 字符数）；裁定号只接受 `裁 NNN` 或 `#NNN`。
MIN_REASON_CHARS = 10
RULING_MASK = re.compile(r"^(裁\s*[0-9]+|#[0-9]+)$")


def parse_exempt_text(text, source):
    """每行 `- <路径或 glob> — <理由> — <裁定号>`。

    三段校验（#623 加严）：路径非空／理由 strip 后 ≥10 字／裁定号 `^(裁\\s*[0-9]+|#[0-9]+)$`。
    任一段不合规 ⇒ 该行 `problem` 非空、**不生效**，且主流程把**该行本身计 failure**。
    """
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
        glob = parts[0].strip()
        reason = parts[1].strip()
        ruling = parts[2].strip()
        problem = None
        if not glob:
            problem = "路径为空"
        elif not reason:
            problem = "缺理由"
        elif len(reason) < MIN_REASON_CHARS:
            problem = "理由不足 %d 字（实测 %d 字）" % (MIN_REASON_CHARS, len(reason))
        elif not RULING_MASK.match(ruling):
            problem = "裁定号不合规（须 `裁 NNN` 或 `#NNN`，实测 `%s`）" % ruling
        entries.append({
            "glob": glob,
            "reason": reason,
            "ruling": ruling,
            "line": lineno,
            "problem": problem,
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


def is_exempt_file(path):
    """`gate-exemptions/*.md`；README.md（含任意层）显式排除 —— 它是格式说明，不是豁免。"""
    if not path.startswith("gate-exemptions/"):
        return False
    if not path.lower().endswith(".md"):
        return False
    return os.path.basename(path).lower() != "readme.md"


# ── ⑥-b 复核件首行（#1100 W3 收窄版）──────────────────────────────────────────
# 只对**新增**豁免文件（base 上不存在）生效；存量件 legacy 冻结，免检。
# 形态两种：`# review: #<PR#>` ｜ `# review: docs/synova/reviews/<文件名>.json`。
# 🔴 只核首行形态，不核 PR 存在性/指针文件存在性（见已知限制 15）。
REVIEW_MASK = re.compile(r"^#\s*review:\s*(?:#[0-9]+|docs/synova/reviews/[A-Za-z0-9._-]+\.json)$")


def review_evidence(text):
    """返回首行的复核件指针（合规时原样返回，含注释符；不合规/缺首行 ⇒ None）。

    语义边界：**首行** = `splitlines()[0]`（前置空行也算首行 → 直接判不合规，不放宽）。
    """
    lines = text.splitlines()
    if not lines:
        return None
    first = lines[0].rstrip()
    return first if REVIEW_MASK.match(first) else None


def in_base(merge_base, rel, root):
    """该路径是否存在于 <merge_base> 树内（= legacy 判据，**唯一**依据）。

    用 `git cat-file -e <sha>:<path>` 的存在性，禁日期/内容启发式（#1100 硬要求）：
    改一版旧豁免文件仍属 legacy（存量冻结），新增文件才需复核件。
    """
    rc, _, _ = git(["cat-file", "-e", "%s:%s" % (merge_base, rel)], root)
    return rc == 0


# ── 主流程 ────────────────────────────────────────────────────────────────────
def _git_rel(list_path, root):
    """list_path → 相对 root 的 git object 路径（恒正斜杠）。
    Windows: os.path.relpath 产出反斜杠 ⇒ git object spec 失败（E_BAD_BASE 假触发，裁 422-R1）；
    git tree 路径恒为正斜杠 ⇒ 无条件归一（双 replace 兼顾 posix 上的字面反斜杠）。"""
    return os.path.relpath(list_path, root).replace(os.sep, "/").replace("\\", "/")


def main():
    root = os.environ.get("GP_ROOT", "")
    list_path = os.environ.get("GP_LIST", "")
    base_ref = os.environ.get("GP_BASE_ARG", "")
    # 自检缝（裁 422-R1）：只验「路径 → git object spec」归一化，不跑门禁本体（SYNO_DOWN_SELFTEST 同型）
    if os.environ.get("GP_SELFTEST_REL"):
        for _p, _r in (
            ("C:\\repo\\.gitea\\protected-files.txt", "C:\\repo"),
            ("/tmp/r/.gitea/protected-files.txt", "/tmp/r"),
        ):
            try:
                _rel = _git_rel(_p, _r)
            except Exception as _exc:  # pragma: no cover — 自检缝自身失败也要可见
                _rel = "ERR:%s" % _exc
            sys.stdout.write("GP-REL\t%s\t%s\n" % (_p, _rel))
        sys.exit(0)
    json_mode = os.environ.get("GP_JSON", "0") == "1"
    degraded_log = os.environ.get("GP_DEGRADED_LOG", "")
    # #1100 W3：bash 层已把值限死 0|1（非法值在 bash 就 E_USAGE exit 2）；
    # 此处再取一次只为 JSON 报告可见（未设 ⇒ "1"，与 bash 默认同源）。
    require_review = os.environ.get("GP_REQUIRE_REVIEW", "1") == "1"

    checks = []
    failures = []
    report = {
        "component": COMPONENT,
        "ok": False,
        "exit": 0,
        "root": root,
        "list_path": list_path,
        "base_ref": base_ref or None,
        "require_review": require_review,
        "patterns": 0,
        "pin_declared": None,
        "pin_computed": None,
        "merge_base": None,
        "changed_paths": 0,
        "protected_changes": [],
        "exempt_files": [],
        "legacy_exempt_files": [],
        "review_missing": [],
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
        # ④ 清单：存在/可读 → 非空 → pin
        text, nbytes = read_list(list_path)
        report["list_bytes"] = nbytes
        ok("清单存在且可读（bytes=%d）" % nbytes)

        patterns, pin = parse_list(text)
        report["patterns"] = len(patterns)
        report["pin_declared"] = pin

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

            # base 里有没有「本清单」：没有 ⇒ 陈旧/错误 base，fail-closed（#610 已退役 bootstrap）
            rel_list = PROTECTED_REL
            if list_path.startswith(root.rstrip("/") + "/"):
                # Windows: os.path.relpath 产出反斜杠 ⇒ git object spec 失败（E_BAD_BASE 假触发，裁 422-R1）
                # git tree 路径恒为正斜杠 ⇒ 无条件归一（双 replace 兼顾 posix 上的字面反斜杠，供自检缝复算）
                rel_list = _git_rel(list_path, root)
            rc, _, _ = git(["cat-file", "-e", "%s:%s" % (merge_base, rel_list)], root)
            if rc != 0:
                raise GateError("E_BAD_BASE", "list-in-base",
                                "base 无清单（%s@%s 不存在）⇒ 陈旧/错误 base，fail-closed；"
                                "清单自 S1（23a4f5a38）起已落 main，不再有'首次落盘'例外"
                                "（#610 已退役 bootstrap）" % (rel_list, merge_base[:8]))
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
                text = read_exempt_file(root, rel)
                legacy = in_base(merge_base, rel, root)
                exempt_info.append({
                    "path": rel,
                    "entries": parse_exempt_text(text, rel),
                    "legacy": legacy,
                    "review": review_evidence(text),
                })
            report["exempt_files"] = [
                {"path": item["path"], "entries": len(item["entries"]),
                 "legacy": item["legacy"], "review": item["review"]}
                for item in exempt_info
            ]
            report["legacy_exempt_files"] = [i["path"] for i in exempt_info if i["legacy"]]
            legacy_n = len(report["legacy_exempt_files"])
            added = [i for i in exempt_info if not i["legacy"]]
            if exempt_info:
                ok("豁免文件 %d 件（legacy %d 件＝base 已存在 ⇒ 冻结免复核件／新增 %d 件）"
                   % (len(exempt_info), legacy_n, len(added)))
            for info in exempt_info:
                if info["legacy"]:
                    ok("豁免件 legacy（base 已存在，免复核件）: %s" % info["path"])

            # #623 裁 217：豁免文件内的不合规行**本身计 failure**（证据不完整 ⇒ 1），
            # 即使另一行已覆盖该路径 —— 禁因「已覆盖」把坏行洗掉。
            for info in exempt_info:
                for entry in info["entries"]:
                    if entry["problem"]:
                        fail("E_EXEMPT_INVALID", "exempt",
                             "豁免行不合规: %s:%d `%s`（%s）"
                             % (entry["source"], entry["line"], entry["glob"], entry["problem"]))

            # #1100 W3：新增豁免文件的**复核件首行**（收窄版：只判新增；legacy 冻结）。
            # 缺失 ⇒ exit 1 并点名文件（code 复用 E_EXEMPT_INVALID/phase=review，不扩 C1 码集）。
            if require_review:
                for info in added:
                    if info["review"]:
                        ok("新增豁免文件带复核件: %s → %s" % (info["path"], info["review"]))
                    else:
                        report["review_missing"].append(info["path"])
                        fail("E_EXEMPT_INVALID", "review",
                             "新增豁免文件缺复核件首行: %s（首行须 `# review: <PR#>` 或 "
                             "`# review: docs/synova/reviews/*.json`；存量件按 base 存在性判 legacy 免检）"
                             % info["path"])
            else:
                for info in added:
                    ok("新增豁免文件未核复核件（--require-review=0 回滚态，禁读成已通过）: %s"
                       % info["path"])

            if not protected:
                ok("受保护路径变更 0 条（无需豁免）")
            else:
                ok("受保护路径变更 %d 条（需逐条合规豁免）" % len(protected))
                for path in protected:
                    covered = False
                    notes = []
                    for info in exempt_info:
                        for entry in info["entries"]:
                            if entry["problem"]:
                                notes.append("%s:%d %s"
                                             % (entry["source"], entry["line"], entry["problem"]))
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
