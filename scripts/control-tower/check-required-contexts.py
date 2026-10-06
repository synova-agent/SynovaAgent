#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════════
# check-required-contexts.py — 必需 context ⇄ job `name:` 展开名 一致性门禁
#
# 背景（本器存在的唯一理由）:
#   main 分支保护的必需状态检查（legacy branch protection）与 .github/workflows/*.yml 里
#   job `name:` 的**展开名**之间，
#   🔴 W9/D1165 口径更正: 原写「12 个 / 2026-10-01 实测 contexts_count=12」——**已过期**。
#   **现值 = 9 条**（D1147 把 `(windows-latest)` 两腿移出必需集）；真值源 =
#   `required-checks-baseline.txt:48-56`，2026-10-06 与 `gh api …/branches/main/protection` 逐字一致。
#   （本器**无硬编码名单**，改的只是这句描述性注释；判定逻辑一字未动。）
#   对照:
#   此前**没有任何机器检查**。改一个 job `name:` 的一个字符 ⇒ 必需 context 静默失配
#   ⇒ 该 check-run 永不上报 ⇒ PR 永久 blocked（D971 同型事故:
#   `405 "12 of 12 required status checks are expected."`）。本器把这条链变成物理门禁。
#
# 契约（铁律 47；头注释必须写全 @input/@output/@exit/@degraded）:
#   @input    --root <dir>       仓库根（默认 = 本脚本上两级；测试注入缝）
#             --baseline <file>  必需 context 登记表
#                                （默认 <root>/scripts/control-tower/required-checks-baseline.txt）
#             --workflows <dir>  workflow 目录（默认 <root>/.github/workflows）
#             --api-check        **只读**调 gh api 读 live branch protection，与基线**双向**比对
#             --repo <owner/repo>  branch protection 所属仓（默认 synova-agent/SynovaAgent）
#             --branch <branch>  （默认 main）
#             --reverse          追加「会产出 check-run 但不在必需集」清单（信息级；报告模式）
#             --verbose          打印逐条 job→展开名明细（判定不变）
#             --help             用法
#             注入缝（仅测试）: SYNO_REQUIRED_CONTEXTS_GH=<gh 可执行文件路径>（默认 "gh"）
#   @output   人类可读统计 + 逐条点名（`VIOLATION: ...` / `NOTE: ...`）+ 末行固定三态之一:
#               `REQUIRED-CONTEXTS: OK | VIOLATION(n) | DEGRADED`
#   @exit     0=一致（或 --reverse 报告模式）；1=违规（逐条点名）；2=执行失败/降级（fail-closed）
#             2 绝不等于通过。--reverse 单独使用时**不判违规**（报告模式，exit 0）；
#             与 --api-check 同给时以 --api-check 的判定为准（并追加清单）。
#   @degraded 依赖缺失/不可读/解析失败/gh 不可用 → stderr 一行 `degraded: <原因>` + exit 2
#             （不写 degraded-events.log: 本器可能运行在只读树上，降级信号由调用方 step 捕获，
#              同 ct-test-gate.sh 口径）
#
# 核心能力（job `name:` → check-run 名全集）:
#   · 解析 .github/workflows/*.yml|yaml 的 jobs 段（**YAML 子集**解析器，零第三方依赖——
#     PyYAML 在 CI/本机不一定存在，门禁不得引入安装依赖）:
#       支持: 块映射 / 块序列 / 流序列 `[a, b]` / 流映射 `{a: b}` / 对象数组（`include:` 列表）
#             / 引号标量 / 行内注释 / 块标量（`run: |`、`if: >-` 的正文整段跳过）
#       不支持（遇到即 fail-closed，不猜）: 制表符缩进 / 锚点与别名 / 多行流序列 /
#             合并键 `<<` / 其它非本子集语法
#   · job `name:` 里的 `${{ matrix.X }}` 用**同 job 块内** `strategy.matrix.X` 的取值展开
#     （直接键值 + `include:` 对象数组取值；两个来源取并集）；未声明 name 的 job 按
#     GitHub 语义取 **job id** 作为 check-run 名；矩阵笛卡尔积展开为多个 check-run 名。
#   · 断言「必需集 ⊆ 本仓能产出的 check-run 名全集」，缺一条即逐条点名。
#   · `--reverse` 反向列出「产出但非必需」（如 `Gate Integrity (...)`）——人类读的漂移视图。
#
# --api-check（只读，绝不写保护规则）:
#   `gh api repos/<repo>/branches/<branch>/protection`（GET）→ required_status_checks.contexts
#   与基线做**双向**比对: live 独有（基线缺 live）/ 基线独有（live 缺基线）/ 基线重复。
#   **本器不调用任何写方法**（无 --method/-X，无 PATCH/PUT/POST/DELETE）——
#   branch protection 的变更权限不在本线（红线），本器只报不改。
#   gh 不存在/未登录/网络失败/超时/JSON 非法/形状不符 → stderr `degraded: <原因>` + exit 2。
#   已知边界（诚实声明）: 只读 contexts 字段的存在性，**不读 app_id/checks 绑定**；
#   不判断「job 级 if:/paths: 过滤会不会让必需 context 被 skip」（相邻风险，见下方 TODO）。
#
# 已知边界（诚实声明，非违规）:
#   · `matrix.exclude:` 不参与缩减 ⇒ 展开集是**超集**（保守方向：只会漏报，不会误报"缺失"）。
#   · 同一 `matrix.X` 在 name 中出现两次 → 笛卡尔积 → 仍为超集。
#   · 判定只看名字集合，不看 job 是否真会被调度（job 级 `if:`/`paths:` 是 D971 的另一半，
#     本卡不判；建议另立卡加「必需 context 的产出 job 不得有 job 级 if:/paths:」）。
#   · 本器**只读** ci.yml 与基线，绝不修改任何 job 的 `name:`。
#
# 反例意识（判别性由 tests/control-tower/check-required-contexts.test.sh 承担）:
#   把夹具里任一 job `name:` 改一个字符 → 必须 exit 1 且点名该 context（②）；
#   基线缺失 → exit 2（④，不是 0 也不是 1）；gh 不可用 → exit 2（⑤）。
#
# 启动方式（双语法首行，兼容本卡验收命令 `bash <本文件>`）:
#   · `python3 check-required-contexts.py …`（生产/CI 路径；Windows: python/py 亦可）
#   · `bash check-required-contexts.py …`（等价；sh 侧 exec 到 python3/python/py）
# ═══════════════════════════════════════════════════════════════════════════════
# 双语法行: sh 读作命令（exec 换 python）；python 读作相邻字符串字面量（无副作用空语句）
"exec" "sh" "-c" 'for p in python3 python py; do command -v "$p" >/dev/null 2>&1 || continue; exec "$p" "$0" "$@"; done; printf "degraded: python 不可用（python3/python/py 均不可用）\n" >&2; exit 2' "$0" "$@"   # PYBIN 三级探测（python3→python→py，禁裸 python3；PLATFORM-CHECKLIST #1）

"""必需 context ⇄ job name 展开名 一致性门禁（契约全文见文件头注释块）。"""

import argparse
import json
import os
import re
import subprocess
import sys

VERSION = "1.0.0"

EXIT_OK = 0
EXIT_VIOLATION = 1
EXIT_DEGRADED = 2

DEFAULT_REPO = "synova-agent/SynovaAgent"
DEFAULT_BRANCH = "main"
SEAM_GH = "SYNO_REQUIRED_CONTEXTS_GH"   # 测试注入缝: gh 可执行文件路径（默认 "gh"）

# UTF-8 强制（D313 M5）: Windows 控制台默认 GBK → 中文 context 名逐字断言必乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")   # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")   # type: ignore[attr-defined]
except (AttributeError, ValueError):
    pass

MATRIX_RE = re.compile(r"\$\{\{\s*matrix\.([A-Za-z0-9_.\-]+)\s*\}\}")
EXPR_RE = re.compile(r"\$\{\{.*?\}\}")
BLOCK_RE = re.compile(r"^[|>][0-9+\-]*$")


class Degrade(Exception):
    """执行失败 / 降级（fail-closed）——main() 统一转成 stderr `degraded:` + exit 2。"""

    def __init__(self, reason):
        Exception.__init__(self, reason)
        self.reason = reason


# ═══ YAML 子集解析（零依赖）═══════════════════════════════════════════════════

class Line(object):
    __slots__ = ("no", "indent", "text")

    def __init__(self, no, indent, text):
        self.no = no
        self.indent = indent
        self.text = text


def read_lines(path):
    """读文件 → [Line]（去空行/整行注释；制表符缩进 → degrade）。"""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            raw = fh.read()
    except OSError as exc:
        raise Degrade("workflow 不可读: %s（%s）" % (path, exc))
    out = []
    for no, line in enumerate(raw.split("\n"), 1):
        line = line.rstrip("\r")
        if not line.strip():
            continue
        stripped = line.lstrip(" ")
        if stripped.startswith("#"):
            continue
        if stripped.startswith("\t"):
            raise Degrade("%s:%d 制表符缩进（YAML 缩进必须空格）——解析中止，fail-closed" % (path, no))
        out.append(Line(no, len(line) - len(stripped), stripped))
    return out


def strip_comment(text):
    """去行内注释（引号内 `#` 保留；`#` 前须为空白或行首，YAML 同规则）。"""
    out = []
    quote = None
    for idx, ch in enumerate(text):
        if quote:
            out.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            quote = ch
            out.append(ch)
            continue
        if ch == "#" and (idx == 0 or text[idx - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def split_key(text):
    """`key: value` → (key, value)；非映射行 → (None, None)。要求 `:` 后为空白或行尾（YAML 块映射规则）。"""
    quote = None
    depth = 0
    for idx, ch in enumerate(text):
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            quote = ch
            continue
        if ch in "[{":
            depth += 1
            continue
        if ch in "]}":
            depth -= 1
            continue
        if ch == ":" and depth == 0:
            nxt = text[idx + 1:idx + 2]
            if nxt == "" or nxt in " \t":
                key = text[:idx].strip()
                if len(key) >= 2 and key[0] == key[-1] and key[0] in ("'", '"'):
                    key = key[1:-1]
                if key == "":
                    return None, None
                return key, text[idx + 1:].strip()
    return None, None


def split_flow(inner):
    """按顶层逗号切分流序列/流映射正文（引号与嵌套括号内的逗号不切）。"""
    parts = []
    buf = []
    quote = None
    depth = 0
    for ch in inner:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"'):
            quote = ch
            buf.append(ch)
            continue
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return [p.strip() for p in parts if p.strip() != ""]


def unquote(text):
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        inner = text[1:-1]
        if text[0] == '"':
            inner = inner.replace('\\"', '"').replace("\\\\", "\\")
        else:
            inner = inner.replace("''", "'")
        return inner
    return text


def parse_scalar(text):
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        return [parse_scalar(p) for p in split_flow(text[1:-1])]
    if text.startswith("{") and text.endswith("}"):
        out = {}
        for part in split_flow(text[1:-1]):
            k, v = split_key(part)
            if k is None:
                out[part] = None
            else:
                out[k] = parse_scalar(v) if v else None
        return out
    return unquote(text)


class YamlSubset(object):
    """GitHub Actions workflow 用到的 YAML 子集解析器（遇到子集外语义 → degrade，绝不猜）。"""

    def __init__(self, lines, path):
        self.lines = lines
        self.path = path

    def fail(self, line, why):
        raise Degrade("%s:%d YAML 子集解析失败: %s（fail-closed：无法枚举 job name）" % (self.path, line.no, why))

    def parse_document(self):
        if not self.lines:
            return {}
        if self.lines[0].indent != 0:
            self.fail(self.lines[0], "文档首行缩进非 0")
        node, _ = self.parse_mapping(0, 0)
        return node

    def parse_mapping(self, i, indent):
        node = {}
        while i < len(self.lines):
            line = self.lines[i]
            if line.indent < indent:
                break
            if line.indent > indent:
                self.fail(line, "意外的更深缩进（父键缺 ':'）")
            key, rest = split_key(strip_comment(line.text))
            if key is None:
                self.fail(line, "非 'key: value' 行")
            i += 1
            value, i = self.parse_value(i, line.indent, rest, line)
            node[key] = value
        return node, i

    def parse_value(self, i, indent, rest, line):
        if rest == "":
            if i < len(self.lines) and self.lines[i].indent > indent:
                child = self.lines[i]
                if child.text.startswith("-"):
                    return self.parse_sequence(i, child.indent)
                return self.parse_mapping(i, child.indent)
            return None, i
        if BLOCK_RE.match(rest):
            return "<block-scalar:%d>" % line.no, self.skip_block_scalar(i, indent)
        return parse_scalar(rest), i

    def skip_block_scalar(self, i, indent):
        while i < len(self.lines) and self.lines[i].indent > indent:
            i += 1
        return i

    def parse_sequence(self, i, indent):
        items = []
        while i < len(self.lines):
            line = self.lines[i]
            if line.indent < indent:
                break
            if line.indent > indent:
                self.fail(line, "序列项缩进异常")
            if not line.text.startswith("-"):
                break
            body = line.text[1:]
            if body[:1] not in ("", " ", "\t"):
                break
            body_stripped = body.lstrip()
            lead = len(body) - len(body_stripped)
            if body_stripped == "":
                i += 1
                if i < len(self.lines) and self.lines[i].indent > indent:
                    child = self.lines[i]
                    if child.text.startswith("-"):
                        value, i = self.parse_sequence(i, child.indent)
                    else:
                        value, i = self.parse_mapping(i, child.indent)
                else:
                    value = None
                items.append(value)
                continue
            key, _rest = split_key(strip_comment(body_stripped))
            if key is None:
                items.append(parse_scalar(body_stripped))
                i += 1
                continue
            # `- key: value` → 把该项改写成虚拟缩进的映射首行，后续更深行自动归入同一项
            virtual = indent + 1 + lead
            self.lines[i] = Line(line.no, virtual, body_stripped)
            value, i = self.parse_mapping(i, virtual)
            items.append(value)
        return items, i


# ═══ job name / matrix 展开 ═══════════════════════════════════════════════════

def to_str(value):
    if value is None:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


def matrix_values(matrix, var):
    """matrix 变量取值（直接键值 + include 对象数组，并集）→ (list, None) 或 (None, 原因)。"""
    vals = []
    key = var
    if isinstance(matrix, dict) and key not in matrix and "." in var:
        key = var.split(".")[0]
    direct = matrix.get(key) if isinstance(matrix, dict) else None
    if isinstance(direct, list):
        vals.extend(direct)
    elif direct is not None and not isinstance(direct, dict):
        vals.append(direct)
    inc = matrix.get("include") if isinstance(matrix, dict) else None
    if isinstance(inc, list):
        for item in inc:
            if isinstance(item, dict) and key in item:
                value = item[key]
                if isinstance(value, list):
                    vals.extend(value)
                else:
                    vals.append(value)
    if not vals:
        return None, "同 job 的 strategy.matrix 未声明 %s" % var
    return vals, None


def expand_name(raw, matrix, ctx):
    """job `name:` → check-run 名列表（矩阵笛卡尔积）；不可解析 → degrade（fail-closed）。"""
    if "${{" not in raw:
        return [raw]
    placeholders = MATRIX_RE.findall(raw)
    if not placeholders:
        raise Degrade("job name 含不可解析表达式（非 matrix.*）: %s → %r" % (ctx, raw))
    if EXPR_RE.search(MATRIX_RE.sub("", raw)):
        raise Degrade("job name 混入非 matrix 表达式: %s → %r" % (ctx, raw))
    combos = [[]]
    for var in placeholders:
        if not isinstance(matrix, dict):
            raise Degrade("job name 引用 ${{ matrix.%s }} 但本 job 无 strategy.matrix: %s → %r" % (var, ctx, raw))
        values, why = matrix_values(matrix, var)
        if values is None:
            raise Degrade("job name 引用 ${{ matrix.%s }} 但 %s: %s → %r" % (var, why, ctx, raw))
        options = [to_str(v) for v in values]
        combos = [combo + [opt] for combo in combos for opt in options]
    out = []
    for combo in combos:
        name = raw
        for opt in combo:
            name = MATRIX_RE.sub(lambda _m, _o=opt: _o, name, count=1)
        if name not in out:
            out.append(name)
    return out


def job_line_map(lines):
    """job id → 源文件行号（仅 --verbose 展示用；取 jobs 段直接子键的首个匹配行）。"""
    out = {}
    idx = None
    for i, line in enumerate(lines):
        if line.indent == 0:
            key, _rest = split_key(strip_comment(line.text))
            if key == "jobs":
                idx = i
                break
    if idx is None:
        return out
    child_indent = None
    for line in lines[idx + 1:]:
        if line.indent == 0:
            break
        if child_indent is None:
            child_indent = line.indent
        if line.indent == child_indent:
            key, _rest = split_key(strip_comment(line.text))
            if key:
                out.setdefault(key, line.no)
    return out


def collect_produced(workflows_dir):
    """扫描 workflows 目录 → [(check-run 名, 文件名, job id, 行号)]（含矩阵展开）。"""
    if not os.path.isdir(workflows_dir):
        raise Degrade("workflows 目录不存在或不可读: %s" % workflows_dir)
    files = sorted([f for f in os.listdir(workflows_dir) if f.endswith((".yml", ".yaml"))])
    if not files:
        raise Degrade("workflows 目录无 *.yml/*.yaml: %s（无法枚举 check-run 名，fail-closed）" % workflows_dir)
    entries = []
    for fn in files:
        path = os.path.join(workflows_dir, fn)
        if not os.path.isfile(path):
            continue
        lines = read_lines(path)
        doc = YamlSubset(lines, path).parse_document()
        jobs = doc.get("jobs")
        if jobs is None:
            continue
        if not isinstance(jobs, dict):
            raise Degrade("%s: jobs 段不是映射（%s）" % (path, type(jobs).__name__))
        lines_map = job_line_map(lines)
        for job_key in jobs:
            job = jobs[job_key]
            if not isinstance(job, dict):
                continue   # 空 job 不产出 check-run（保守：不入全集）
            raw = job.get("name", job_key)
            if not isinstance(raw, str):
                raise Degrade("%s[%s] job name 非标量: %r" % (fn, job_key, raw))
            strategy = job.get("strategy")
            matrix = None
            if isinstance(strategy, dict) and isinstance(strategy.get("matrix"), dict):
                matrix = strategy.get("matrix")
            for name in expand_name(raw, matrix, "%s[%s]" % (fn, job_key)):
                entries.append((name, fn, job_key, lines_map.get(job_key, 0)))
    if not entries:
        raise Degrade("未解析到任何 job name（workflows=%s）——解析器或目录疑似失效，fail-closed 不判绿" % workflows_dir)
    return entries, files


# ═══ 基线登记表 ══════════════════════════════════════════════════════════════

class BaseEntry(object):
    __slots__ = ("name", "fields", "no")

    def __init__(self, name, fields, no):
        self.name = name
        self.fields = fields
        self.no = no


def read_baseline(path):
    """读基线（`<CONTEXT_NAME> | k=v | k=v ...`，`#` 注释；格式全文见文件头）。"""
    if not os.path.isfile(path):
        raise Degrade("基线缺失或不是文件: %s（无登记簿 ⇒ 无法比对，fail-closed 不判绿）" % path)
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            raw = fh.read()
    except OSError as exc:
        raise Degrade("基线不可读: %s（%s）" % (path, exc))
    entries = []
    for no, line in enumerate(raw.split("\n"), 1):
        line = line.rstrip("\r").strip()
        if line == "" or line.startswith("#"):
            continue
        parts = line.split("|")
        name = parts[0].strip()
        if name == "":
            raise Degrade("%s:%d 数据行缺少 CONTEXT_NAME（fail-closed）" % (path, no))
        fields = {}
        for part in parts[1:]:
            if "=" not in part:
                raise Degrade("%s:%d 数据行字段非 `key=value`（fail-closed）: %r" % (path, no, part.strip()))
            key, value = part.split("=", 1)
            key = key.strip()
            if key == "":
                raise Degrade("%s:%d 数据行空键名（fail-closed）" % (path, no))
            fields[key] = value.strip()
        if not fields:
            raise Degrade("%s:%d 数据行缺 `key=value` 字段（schema 见文件头；fail-closed）" % (path, no))
        entries.append(BaseEntry(name, fields, no))
    if not entries:
        raise Degrade("基线 0 条数据行: %s（空登记簿 ⇒ 比对无意义，fail-closed 不判绿）" % path)
    return entries


def duplicates(names):
    seen = {}
    for name in names:
        seen[name] = seen.get(name, 0) + 1
    return sorted([n for n, c in seen.items() if c > 1])


# ═══ 比对 ════════════════════════════════════════════════════════════════════

def diff_sets(required, produced):
    """必需集 ∖ 产出集（保持必需集顺序、去重）。"""
    out = []
    for name in required:
        if name not in produced and name not in out:
            out.append(name)
    return out


def diff_lists(live, baseline):
    """双向差集: (live 独有, 基线独有)（各保持各自顺序、去重）。"""
    live_set = set(live)
    base_set = set(baseline)
    live_only = []
    for name in live:
        if name not in base_set and name not in live_only:
            live_only.append(name)
    base_only = []
    for name in baseline:
        if name not in live_set and name not in base_only:
            base_only.append(name)
    return live_only, base_only


# ═══ gh api（只读）════════════════════════════════════════════════════════════

def fetch_live_contexts(repo, branch):
    """`gh api repos/<repo>/branches/<branch>/protection`（GET，只读）→ live contexts 列表。"""
    gh_bin = os.environ.get(SEAM_GH, "") or "gh"
    env = dict(os.environ)
    env["GH_PROMPT_DISABLED"] = "1"          # 未登录时不要交互式提问（否则挂死）
    env["GH_NO_UPDATE_NOTIFIER"] = "1"
    cmd = [gh_bin, "api", "repos/%s/branches/%s/protection" % (repo, branch)]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, env=env)
    except OSError as exc:
        raise Degrade("gh 不可用（%s: %s）——gh api 无法执行，fail-closed 不判绿" % (gh_bin, exc))
    except subprocess.TimeoutExpired:
        raise Degrade("gh api 超时（30s）: %s——网络不可用，fail-closed 不判绿" % " ".join(cmd))
    out = proc.stdout.decode("utf-8", "replace")
    err = (proc.stderr or b"").decode("utf-8", "replace").strip()
    if proc.returncode != 0:
        raise Degrade("gh api 失败（rc=%d）: %s——%s" % (proc.returncode, " ".join(cmd), err[:300] or "无 stderr"))
    try:
        data = json.loads(out)
    except ValueError as exc:
        raise Degrade("gh api 输出非 JSON（%s）: %s" % (exc, out[:200]))
    if not isinstance(data, dict):
        raise Degrade("gh api 输出根不是对象: %s" % type(data).__name__)
    rsc = data.get("required_status_checks")
    if not isinstance(rsc, dict):
        raise Degrade("branch protection 缺 required_status_checks（API 形状不符或未配置必需检查）——fail-closed")
    live = rsc.get("contexts")
    if not isinstance(live, list):
        checks = rsc.get("checks")
        if isinstance(checks, list):
            live = [c.get("context") for c in checks if isinstance(c, dict)]
        else:
            raise Degrade("required_status_checks 缺 contexts/checks 字段——API 形状不符，fail-closed")
    return [c for c in live if isinstance(c, str) and c != ""], data


# ═══ 主流程 ═════════════════════════════════════════════════════════════════

def build_parser():
    parser = argparse.ArgumentParser(
        prog="check-required-contexts.py",
        description="必需 context（branch protection）⇄ job `name:` 展开名 一致性门禁（0=一致 / 1=违规 / 2=降级）",
        add_help=True,
        allow_abbrev=False,
    )
    parser.add_argument("--root", default=None, help="仓库根（默认 = 本脚本上两级）")
    parser.add_argument("--baseline", default=None, help="基线文件（默认 <root>/scripts/control-tower/required-checks-baseline.txt）")
    parser.add_argument("--workflows", default=None, help="workflow 目录（默认 <root>/.github/workflows）")
    parser.add_argument("--api-check", action="store_true", help="只读调 gh api，把 live contexts 与基线双向比对（只报不改）")
    parser.add_argument("--allow-degraded", action="store_true",
                        help="CI 专用: live 对账不可用时降为显式 warning（exit 0）；"
                             "静态面判定不受影响。不带则 Degrade ⇒ exit 2（fail-closed）")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="branch protection 所属仓（默认 %s）" % DEFAULT_REPO)
    parser.add_argument("--branch", default=DEFAULT_BRANCH, help="分支名（默认 %s）" % DEFAULT_BRANCH)
    parser.add_argument("--reverse", action="store_true", help="追加「产出但非必需」清单（信息级；报告模式不判违规）")
    parser.add_argument("--verbose", action="store_true", help="打印逐条 job→展开名明细（判定不变）")
    parser.add_argument("--version", action="version", version="check-required-contexts %s" % VERSION)
    return parser


def default_root():
    return os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir))


def run(args):
    root = os.path.abspath(args.root) if args.root else default_root()
    if not os.path.isdir(root):
        raise Degrade("--root 目录不存在或不可进入: %s" % root)
    workflows = os.path.abspath(args.workflows) if args.workflows else os.path.join(root, ".github", "workflows")
    baseline_path = (os.path.abspath(args.baseline) if args.baseline
                     else os.path.join(root, "scripts", "control-tower", "required-checks-baseline.txt"))

    entries, files = collect_produced(workflows)
    produced = {}
    for name, fn, job_key, no in entries:
        produced.setdefault(name, (fn, job_key, no))
    base_entries = read_baseline(baseline_path)
    required = [e.name for e in base_entries]

    print("REQUIRED-CONTEXTS-CHECK: root=%s workflows=%s(%d 文件) baseline=%s(%d 条) api_check=%d reverse=%d"
          % (root, workflows, len(files), baseline_path, len(required), 1 if args.api_check else 0, 1 if args.reverse else 0))
    sources = sorted(set(e.fields.get("source", "") for e in base_entries if e.fields.get("source")))
    as_ofs = sorted(set(e.fields.get("as_of", "") for e in base_entries if e.fields.get("as_of")))
    print("基线: source=%s；as_of=%s" % ("/".join(sources) or "未记", "/".join(as_ofs) or "未记"))

    if args.verbose:
        print("── job `name:` → check-run 名（%d 个唯一名 / 展开自 %d 个 job）──" % (len(produced), len(entries)))
        for name in sorted(produced):
            fn, job_key, no = produced[name]
            print("  [%s] %s  ← job=%s%s" % (fn, name, job_key, (":%d" % no) if no else ""))
    else:
        print("本仓可产出 check-run 名: %d 个唯一名（展开自 %d 个 job）" % (len(produced), len(entries)))

    violations = []
    for name in duplicates(required):
        lns = [str(e.no) for e in base_entries if e.name == name]
        violations.append("基线重复登记必需 context: %s（%d 次，行 %s）——重复名无法逐条核对，须去重" % (name, len(lns), ",".join(lns)))
    missing = diff_sets(required, produced)
    for name in missing:
        violations.append("必需 context 无任何 workflow job 产出: %s（job `name:` 被改动 ⇒ check-run 永不上报 ⇒ PR 永久 blocked，D971 同型）" % name)

    print("── 必需集 ⊆ 本仓可产出集: %d/%d 命中 ──" % (len(required) - len(missing), len(required)))

    live_note = ""
    live_degraded = False
    if args.api_check:
        # 🔴 D1111/收件修正（由 ct-gate 夹具 ③ 抓出）: `--allow-degraded` **只**把「live 取数不可用」
        #   降为 warning，**绝不**吞掉静态面违规。若在此处直接抛 Degrade，静态面已判出的
        #   `missing` 会被丢掉 ⇒ 旗标变"免检开关"（本窗实测：静态 11/12 + 坏 gh + 旗标 曾得 exit 0）。
        #   故：allow_degraded 时**就地降级**（记 live_degraded，继续走到末尾判定）；
        #   不带旗标时保持原语义（抛 Degrade ⇒ main 捕获 ⇒ exit 2，fail-closed）。
        try:
            live, _data = fetch_live_contexts(args.repo, args.branch)
        except Degrade as exc:
            if not args.allow_degraded:
                raise
            live_degraded = True
            sys.stderr.write("degraded: %s\n" % exc.reason)
            sys.stderr.write(
                "warning: --allow-degraded 已启用 —— live 对账不可用（本仓 CI 的 github.token 无 admin "
                "权限读 branch protection）⇒ 本次只出静态判定；live 双向对账请用带 PAT 的定期任务\n")
            print("── live branch protection ⇄ 基线（双向，只报不改）──")
            print("  SKIPPED(degraded): 取数不可用 ⇒ 本次不做 live 对账（静态判定不受影响）")
        else:
            live_only, base_only = diff_lists(live, required)
            print("── live branch protection ⇄ 基线（双向，只报不改）──")
            print("  live contexts = %d 条（gh api repos/%s/branches/%s/protection）" % (len(live), args.repo, args.branch))
            for name in live_only:
                violations.append("live 必需 context 未登记进基线（基线缺 live）: %s" % name)
            for name in base_only:
                violations.append("基线登记但 live 已不是必需 context（live 缺基线）: %s" % name)
            if not live_only and not base_only:
                print("  OK: live %d 条与基线逐字一致（双向零差集）" % len(live))
            live_note = "；live=%d" % len(live)
    if live_degraded:
        live_note = "；live=SKIPPED(degraded)"

    if args.reverse:
        extra = [name for name in sorted(produced) if name not in set(required)]
        print("── 产出但非必需（信息级；%d 个）──" % len(extra))
        for name in extra:
            fn, job_key, _no = produced[name]
            print("  %s  ← %s[job=%s]" % (name, fn, job_key))
        if not extra:
            print("  （无）")

    for msg in violations:
        print("VIOLATION: %s" % msg)
    if args.reverse and not args.api_check:
        for name in missing:
            print("NOTE: 必需 context 无 job 产出（--reverse 报告模式不判违规；默认模式会判红）: %s" % name)
        print("REQUIRED-CONTEXTS: OK（--reverse 报告模式%s）" % live_note)
        return EXIT_OK
    if violations:
        print("REQUIRED-CONTEXTS: VIOLATION(%d)" % len(violations))
        return EXIT_VIOLATION
    print("REQUIRED-CONTEXTS: OK%s" % live_note)
    return EXIT_OK


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except Degrade as exc:
        sys.stderr.write("degraded: %s\n" % exc.reason)
        print("REQUIRED-CONTEXTS: DEGRADED")
        # 注意: `--allow-degraded` 的降级处理**只**发生在 run() 内的 live 取数点（就地，见上）。
        #   凡逃逸到此处的一律是「判据源缺失/不可读 ⇒ 静态面都没能完成」⇒ **永远 exit 2**，
        #   不因旗标而放行（否则旗标会变成免检开关）。
        return EXIT_DEGRADED


if __name__ == "__main__":
    sys.exit(main())
