#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════════
# check-package-selfsufficiency.py — 包守则自足性审查（协议 v2 · 第 1–10 项）
#
# 背景（本器存在的唯一理由）:
#   《包自足性审查协议 v2》的十项判据此前只靠"人记得做"。2026-10-18 机器检查实测：
#   判据无命令 9/10 ｜不做无路径 10/10 ｜域守则不在包守则 10/10 ｜事实落点 9/10 缺
#   ⇒ 十份包守则里十项全绿的一份都没有。本器把十项判据变成"每包必跑的机器判"。
#
# 契约（铁律 47；头注释必须写全 @input/@output/@exit/@degraded）:
#   @input    --packages P1,P4     可选，逗号分隔（默认 = 发现到的全部包）
#             --json               可选，输出结构化 JSON（stdout 仅 JSON）
#             --ref <git-ref>      可选，默认 HEAD（内容一律 `git show <ref>:<path>`，不读工作树）
#             --selfcheck          可选，判别力自检（三子例 fixture）
#             --help               用法
#             运行环境：git 可用；cwd 任意（repo root 由脚本自身位置解析）
#             测试注入缝: SYNO_PKG_SELFSUFF_REPO=<dir>（默认 = 脚本所在仓 toplevel；
#                         与 check-required-contexts.py 的 SYNO_REQUIRED_CONTEXTS_GH 同口径）
#   @output   ① 10×10 矩阵（✅/🔴/🟡 ＋ 图例 ＋ 每格证据）② 缺口清单（包/项/缺什么/建议补法）
#             ③ 信息级备注（不阻断）④ 待人工确认（半自动项 8/9）
#             ⑤ 汇总行 `SELFSUFFICIENCY: PASS|GAP(n)|DEGRADED  signal=<N> red=<n> pending=<n> exit=<0|1|2>`
#                （GAP(n) 的 n = 非 ✅ 格数 = red + pending）
#             --json：{tool, protocol, scope_items, repo, ref, as_of, signal_count, matrix,
#                      evidence, gaps[], notes[], manual_pending[], summary{green,red,pending}, exit}
#             --selfcheck：三子例行 ＋ 终行 `SELFCHECK-OK: …`（exit 1）/ `SELFCHECK-FAIL: …`（exit 2）；
#                      该模式无包无矩阵 ⇒ 不打印 SELFSUFFICIENCY 汇总行
#   @exit     0 = 全部 ✅
#             1 = 有 🔴 缺口 或 🟡 待人工（🟡 **不视为通过**，fail-closed）
#             2 = 检查自身失败/降级（git 不可用、ref 无效、**信号量==0**、请求的包不存在、解析/内部异常）
#             `--selfcheck`：三子例全符合 ⇒ **1**（判别力自检的"必红"是 inner 子例，外层语义见 §5.3）；
#             任一不符 ⇒ **2**（绝不 exit 0）
#   @degraded 一律 stderr 一行 `degraded: <原因>` + exit 2（铁律 11；绝无 `except: pass`）
#             只读：不写任何仓库文件；`--selfcheck` 只在系统临时目录建一次性 fixture 并 rmtree
#
# 十项判法（逐项算法见 dev doc §5.1，本器不得自行"优化"判据）:
#   1 落点存在性（②③=引用必须存在／④=目标，父目录在即可记"新建"）  2 判据可执行
#   3 写集精确  4 依赖明确  5 不做含路径  6 域守则清单  7 事实落点
#   8 编号可查（半自动 🟡）  9 跨仓摘要（半自动 🟡）  10 合并规则
#
# 口径（CTO 裁定 188 §B，原样照录）:
#   Q1 写集：显式"不改代码／不写生产码" = 精确的无写集声明 ⇒ ✅
#   Q2 依赖：状态词集合 = 无/无（…）/不依赖/已完成/已合(入)/已落地/已交付/过审/进行中/未开始/未开工/不存在/阻塞
#   Q3 域守则：≥1 份 AGENTS.md ＋ 节标题"必须显式 read" = 已给用途；无逐条用途 ⇒ 信息级备注，不阻断
#   Q4 落点：②③ = 引用（必须存在）｜④ = 目标（父目录在即可；"除…"为排除项）
#   追加：🟡 仍 exit 1，但矩阵必须显式区分「🔴 缺口」与「🟡 待人工」；人工结论的机器可读落点 = 包守则 §十一
#
# 防御断言（不许静默放行）: 1–7/10 只允许 ✅/🔴；8/9 只允许 ✅/🟡；任何其它值 ⇒ exit 2
#
# 启动方式（双语法首行，兼容 `bash <本文件>`）:
#   · `python3 check-package-selfsufficiency.py …`（生产/CI 路径）
#   · `bash check-package-selfsufficiency.py …`（等价；sh 侧 exec 到 python3/python/py）
# ═══════════════════════════════════════════════════════════════════════════════
# 双语法行: sh 读作命令（exec 换 python）；python 读作相邻字符串字面量（无副作用空语句）
"exec" "sh" "-c" 'for p in python3 python py; do command -v "$p" >/dev/null 2>&1 || continue; exec "$p" "$0" "$@"; done; printf "degraded: python 不可用（python3/python/py 均不可用）\n" >&2; exit 2' "$0" "$@"   # PYBIN 三级探测（python3→python→py，禁裸 python3；PLATFORM-CHECKLIST #1）

"""包守则自足性审查（协议 v2 · 第 1–10 项；契约全文见文件头注释块）。"""

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata

VERSION = "1.0.0"
PROTOCOL = "包自足性审查协议 v2 · 第 1–10 项（第 11 项「预设可加载性」不属本脚本）"

EXIT_OK = 0
EXIT_GAP = 1
EXIT_DEGRADED = 2

SEAM_REPO = "SYNO_PKG_SELFSUFF_REPO"   # 测试注入缝: 覆盖 repo root（默认 = 脚本所在 git 仓 toplevel）

# ---------------------------------------------------------------- 判定符号
OK = "✅"
RED = "🔴"
PENDING = "🟡"

AUTOMATIC = (1, 2, 3, 4, 5, 6, 7, 10)   # 只允许 ✅/🔴
SEMI_AUTO = (8, 9)                       # 只允许 ✅/🟡


def _force_utf8():
    """UTF-8 强制（D313 M5）：Windows 控制台默认 GBK ⇒ 中文断言必乱码。

    仅 stdio 编码层，不影响任何判定；py<3.7 无 reconfigure / 非 tty 时 ValueError。
    此处 `return` 是**显式**放弃编码设置（非吞业务异常）——判定与退出码不受影响。
    """
    try:
        sys.stdout.reconfigure(encoding="utf-8")   # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8")   # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        return


class Degrade(Exception):
    """执行失败 / 降级（fail-closed）——main() 统一转成 stderr `degraded:` + exit 2。"""

    def __init__(self, reason):
        Exception.__init__(self, reason)
        self.reason = reason


# ---------------------------------------------------------------- git 访问层

_GIT_NAME = "git"


def find_git():
    """定位 git 可执行（PATH 差异是误诊重灾区：注册表 PATH 常只含 Git\\cmd）。"""
    found = shutil.which(_GIT_NAME)
    if found:
        return found
    for cand in ("/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git",
                 r"C:\Program Files\Git\cmd\git.exe",
                 r"C:\Program Files\Git\bin\git.exe",
                 r"C:\Program Files (x86)\Git\cmd\git.exe"):
        if os.path.exists(cand):
            return cand
    return None


class Git(object):
    """只读 git 封装：show / cat-file -e / ls-tree / ls-tree -r / rev-parse / grep。"""

    def __init__(self, exe, repo):
        self.exe = exe
        self.repo = repo
        self._basenames = None
        self._tree_paths = None

    def _run(self, argv, what):
        # -c core.quotePath=false：否则非 ASCII 路径（agents/P4-门禁/…）被转义成
        #   "agents/P4-\350\256\276…" ⇒ 包发现恒 0（信号量假 0）。fixture 仓没有本地
        #   config，故必须显式传，不能依赖宿主仓的本地配置。
        cmd = [self.exe, "-C", self.repo, "-c", "core.quotePath=false"] + argv
        try:
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as exc:
            raise Degrade("git 调用失败（%s）: %s" % (what, exc))
        return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")

    def show(self, ref, path):
        """`git show <ref>:<path>` —— 内容一律从 git 对象读，**不读工作树**。"""
        rc, out, err = self._run(["show", "%s:%s" % (ref, path)], "show %s" % path)
        if rc != 0:
            raise Degrade("单文件读失败: %s:%s（%s）" % (ref, path, (err.strip().splitlines() or ["rc=%d" % rc])[-1]))
        return out

    def verify_commit(self, ref):
        rc, out, _err = self._run(["rev-parse", "--verify", "--quiet", "%s^{commit}" % ref], "verify %s" % ref)
        if rc != 0 or not out.strip():
            raise Degrade("ref 无效: %s" % ref)
        return out.strip()

    def short_sha(self, rev):
        return rev[:9]

    def path_exists(self, ref, path):
        """存在性：`git cat-file -e <ref>:<p>` 或 `git ls-tree <ref> -- <p>` 非空（§5.1 判项①）。"""
        rc, _out, _err = self._run(["cat-file", "-e", "%s:%s" % (ref, path)], "cat-file %s" % path)
        if rc == 0:
            return True
        rc2, out2, _err2 = self._run(["ls-tree", ref, "--", path], "ls-tree %s" % path)
        return rc2 == 0 and bool(out2.strip())

    def dir_exists(self, ref, path):
        rc, out, _err = self._run(["ls-tree", ref, "--", path], "ls-tree dir %s" % path)
        return rc == 0 and bool(out.strip())

    def tree_paths(self, ref):
        """`git ls-tree -r --name-only <ref>` 全集（裸文件名索引 + 目录存在性用）。"""
        if self._tree_paths is None:
            rc, out, err = self._run(["ls-tree", "-r", "--name-only", ref], "ls-tree -r")
            if rc != 0:
                raise Degrade("解析失败: git ls-tree -r %s（%s）" % (ref, err.strip()))
            self._tree_paths = [ln for ln in out.splitlines() if ln]
            self._basenames = None
        return self._tree_paths

    def basenames(self, ref):
        if self._basenames is None:
            index = {}
            for path in self.tree_paths(ref):
                index.setdefault(os.path.basename(path), []).append(path)
            self._basenames = index
        return self._basenames

    def grep_files(self, ref, token, exclude=None):
        """`git grep -F -l -e <token> <ref>` —— 判项⑧用。

        `exclude` = `<ref>:<path>`（被审文档自身）。**自身命中必须剔除**：被审文档一定
        含它自己的编号 ⇒ 不剔除则"0 命中 ⇒ 🟡"永不可达，⑧ 变永远 ✅ 的空转判据。
        返回 (非自身命中数, 前 3 个文件)。
        """
        rc, out, err = self._run(["grep", "-F", "-l", "-e", token, ref], "grep %s" % token)
        if rc == 1:
            return 0, []
        if rc != 0:
            raise Degrade("解析失败: git grep -F -l %s %s（%s）" % (token, ref, err.strip()))
        files = [ln.strip() for ln in out.splitlines() if ln.strip()]
        if exclude:
            files = [fname for fname in files if fname != exclude]
        return len(files), files[:3]


def resolve_repo(git_exe):
    """repo root 解析：测试注入缝优先，其次脚本自身位置（cwd 任意）。"""
    seam = os.environ.get(SEAM_REPO, "").strip()
    if seam:
        if not os.path.isdir(seam):
            raise Degrade("%s 指向的目录不存在: %s" % (SEAM_REPO, seam))
        return os.path.abspath(seam)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    try:
        proc = subprocess.run([git_exe, "-C", script_dir, "rev-parse", "--show-toplevel"],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise Degrade("git 不可用: %s" % exc)
    if proc.returncode != 0:
        raise Degrade("git rev-parse --show-toplevel 失败（脚本不在 git 仓内）")
    root = proc.stdout.decode("utf-8", "replace").strip()
    if not root:
        raise Degrade("git rev-parse --show-toplevel 返回空")
    return root


# ---------------------------------------------------------------- 文本解析层

HEADING_RE = re.compile(r"^##\s+([一二三四五六七八九十]+)、\s*(.*)$")
CN_NUMERALS = ("一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二")

KNOWN_EXTS = (".ts", ".tsx", ".sh", ".md", ".json", ".yml", ".yaml", ".mjs", ".cjs",
              ".py", ".js", ".txt", ".toml", ".cfg", ".ini", ".lock", ".sql", ".css", ".html")

TRAIL_PUNCT = "，。、；：！？）」』】…·,.;:!?)\"'`”’>"


class Doc(object):
    """一份包守则的文本视图（节解析：缺节返回 None，**不得返回空串**）。"""

    def __init__(self, package, path, text):
        self.package = package       # 例: "P4-门禁"
        self.path = path             # 例: "agents/P4-门禁/AGENTS.md"
        self.text = text
        self.lines = text.splitlines()
        self.sections = self._parse_sections()

    def _parse_sections(self):
        sections = {}
        current = None
        buf = []
        for line in self.lines:
            m = HEADING_RE.match(line)
            if m:
                if current is not None:
                    sections[current] = "\n".join(buf)
                current = m.group(1)
                buf = []
                continue
            if current is not None:
                buf.append(line)
        if current is not None:
            sections[current] = "\n".join(buf)
        return sections

    def section(self, numeral):
        """_section(n)：缺节 ⇒ None（不返回空串；不许有"通过"默认值）。"""
        return self.sections.get(numeral)

    def titles(self):
        out = []
        for line in self.lines:
            m = HEADING_RE.match(line)
            if m:
                out.append((m.group(1), m.group(2)))
        return out


def backtick_tokens(text):
    """反引号 token 抽取（去尾部标点）。"""
    out = []
    for m in re.finditer(r"`([^`]+)`", text or ""):
        tok = m.group(1).strip().rstrip(TRAIL_PUNCT).strip()
        if tok:
            out.append(tok)
    return out


def expand_braces(token):
    """`{a,b}` 展开（其余原样返回）。"""
    m = re.match(r"^(.*?)\{([^{}]*)\}(.*)$", token)
    if not m:
        return [token]
    head, body, tail = m.group(1), m.group(2), m.group(3)
    out = []
    for part in body.split(","):
        out.extend(expand_braces(head + part.strip() + tail))
    return out


def is_path_token(tok):
    """反引号 token → 是否视为路径（§5.1 判项① 引用口径）。"""
    if not tok or len(tok) > 200:
        return False
    if tok.startswith("..") or tok.startswith("@") or tok.startswith("#"):
        return False
    if any(bad in tok for bad in (" ", "\t", "=", "<", ">", "∧")):
        return False
    if "/" in tok:
        return not any(bad in tok for bad in ("{", ",", "}", "*"))  or tok.endswith("/**")
    base = os.path.basename(tok)
    return base.lower().endswith(KNOWN_EXTS) and "\n" not in tok


def referenced_paths(text):
    """②③ 的引用路径集合（反引号 → 路径化 → {a,b} 展开）。"""
    out = []
    for tok in backtick_tokens(text):
        if not is_path_token(tok):
            continue
        for path in expand_braces(tok):
            path = path.strip()
            if path and ".." not in path.split("/")[0] and path not in out:
                out.append(path)
    return out


TARGET_TOKEN_RE = re.compile(r"[A-Za-z0-9_.\-/]+\.(?:%s)\b|[A-Za-z0-9_.\-/]+/\*\*" %
                             "|".join(ext.lstrip(".") for ext in KNOWN_EXTS))


def _expand_segment(seg):
    """`{a,b}` 逐段展开（`src/routes/{chat,conv}.ts` ⇒ 两条目标）。"""
    m = re.match(r"^(.*?)\{([^{}]*)\}(.*)$", seg)
    if not m:
        return [seg]
    head, body, tail = m.group(1), m.group(2), m.group(3)
    out = []
    for part in body.split(","):
        out.extend(_expand_segment(head + part.strip() + tail))
    return out


def target_paths(section_text):
    """④ 的写集目标集合（按 ｜/换行切段；`（除…）` 为排除项；`{a,b}` 展开）。"""
    if section_text is None:
        return []
    plain = re.sub(r"（除[^）]*）", " ", section_text)   # 排除项跳过
    plain = re.sub(r"\(除[^)]*\)", " ", plain)
    out = []
    for seg in re.split(r"[｜|\n]", plain):
        for expanded in _expand_segment(seg):
            for m in TARGET_TOKEN_RE.finditer(expanded):
                tok = m.group(0).strip().rstrip(TRAIL_PUNCT)
                if tok and tok not in out:
                    out.append(tok)
    return out


def _ref_exists(git, ref, path):
    """引用（Q4 ②③）：必须存在。含 `/` 走路径存在性；裸文件名走 `ls-tree -r` basename 索引。"""
    if "/" in path:
        probe = path[:-3] if path.endswith("/**") else path
        return git.path_exists(ref, probe) or git.dir_exists(ref, probe)
    index = git.basenames(ref)
    return bool(index.get(os.path.basename(path)))


def _target_exists(git, ref, path):
    """目标（Q4 ④）：`/**` 目标的"自身"是目录；其它按路径存在性。"""
    probe = path[:-3] if path.endswith("/**") else path
    return git.path_exists(ref, probe) or git.dir_exists(ref, probe)


def _target_parent(path):
    """目标的父目录（`/**` 目标的父 = 该目录的上一级）。"""
    base = path[:-3] if path.endswith("/**") else path
    return base.rsplit("/", 1)[0] if "/" in base else ""


NO_WRITESET_RE = re.compile(r"不改代码|不写生产码|无写集|不改任何代码")


def has_no_writeset(section_text):
    return bool(NO_WRITESET_RE.search(section_text or ""))


# ---------------------------------------------------------------- 十项判法

CMD_TOKEN_RE = re.compile(r"\b(?:bash|git|npm|npx|python3|node|curl)\b|(?<![\w-])--[A-Za-z]")
COUNTER_TOKEN_RE = re.compile(r"改坏|必红|反例")
WRITESET_EXT_RE = re.compile(r"\.(?:ts|tsx|sh|md|json|yml|yaml|mjs|cjs)\b")

DEP_STATUS_RE = re.compile(
    r"无（|无\(|(?<![A-Za-z0-9_])无(?![A-Za-z0-9_])|不依赖|已完成|已合(?:入)?|已落地|已交付|过审|进行中|未开始|未开工|不存在|阻塞")
AGENTS_MD_RE = re.compile(r"`[^`]*AGENTS\.md`")
NOTE_HEADING_RE = re.compile(r"必须显式")
FACTS_TITLE = "事实落点"
MERGE_RULE_RE = re.compile(r"四条件|自合并|合并例外")
NUM_TOKEN_RES = (
    re.compile(r"\bB\d+\b"),
    re.compile(r"\b\d+\.\d+\b"),
    re.compile(r"\bK\d+-\d+\b"),
)
HANDBOOK_KEYS = ("handbook", "过程档案")
POINTER_MARKERS = ("README", "入口", "过程件", "在飞")


def judge(doc, git, ref):
    """返回 {项号: (verdict, evidence)}；缺节一律记 🔴，不许有"通过"默认值。"""
    cells = {}
    notes = []
    questions = []

    # ── ① 落点存在性 ──────────────────────────────────────────────
    refs = []
    for numeral in ("二", "三"):
        refs.extend(referenced_paths(doc.section(numeral)))
    missing = [p for p in refs if not _ref_exists(git, ref, p)]
    targets = target_paths(doc.section("四"))
    target_missing_parent = []
    target_new = []
    for path in targets:
        if _target_exists(git, ref, path):
            continue
        parent = _target_parent(path)
        if parent and not git.dir_exists(ref, parent):
            target_missing_parent.append(path)
        else:
            target_new.append(path)
    parts = []
    if refs:
        parts.append("引用 %d 条（缺 %d）" % (len(refs), len(missing)))
    if targets:
        parts.append("目标 %d 条（新建 %d，父目录缺 %d）" % (len(targets), len(target_new), len(target_missing_parent)))
    if missing:
        parts.append("缺引用: %s" % "、".join(missing[:5]))
    if target_missing_parent:
        parts.append("父目录不存在: %s" % "、".join(target_missing_parent[:5]))
    if not refs and not targets and not has_no_writeset(doc.section("四")):
        parts.append("②③ 零反引号路径且 ④ 无目标且无无写集声明")
    if missing or target_missing_parent:
        cells[1] = (RED, "；".join(parts))
    elif not refs and not targets and not has_no_writeset(doc.section("四")):
        cells[1] = (RED, "；".join(parts))
    else:
        cells[1] = (OK, "；".join(parts) or "N/A")

    # ── ② 判据可执行 ──────────────────────────────────────────────
    sec3 = doc.section("三")
    if sec3 is None:
        cells[2] = (RED, "§三 缺节")
    else:
        has_cmd = bool(CMD_TOKEN_RE.search(sec3))
        has_counter = bool(COUNTER_TOKEN_RE.search(sec3))
        if has_cmd and has_counter:
            cells[2] = (OK, "§三 命令 token ✓ ＋ 反例 token ✓")
        else:
            lack = []
            if not has_cmd:
                lack.append("命令 token（bash|git|npm|npx|python3|node|curl 或 --flag）")
            if not has_counter:
                lack.append("反例 token（改坏|必红|反例）")
            cells[2] = (RED, "§三 缺 " + "、".join(lack))

    # ── ③ 写集精确 ────────────────────────────────────────────────
    sec4 = doc.section("四")
    if sec4 is None:
        cells[3] = (RED, "§四 缺节")
    elif WRITESET_EXT_RE.search(sec4):
        cells[3] = (OK, "§四 命中文件级扩展名")
    elif has_no_writeset(sec4):
        cells[3] = (OK, "§四 显式无写集声明（Q1）")
    else:
        cells[3] = (RED, "§四 无文件级扩展名（仅目录级/通配）且无无写集声明")

    # ── ④ 依赖明确 ────────────────────────────────────────────────
    sec5 = doc.section("五")
    if sec5 is None:
        cells[4] = (RED, "§五 缺节")
    elif not sec5.strip():
        cells[4] = (RED, "§五 为空")
    else:
        m = DEP_STATUS_RE.search(sec5)
        if m:
            cells[4] = (OK, "§五 命中状态词「%s」" % m.group(0))
        else:
            cells[4] = (RED, "§五 无状态词（Q2 集合）: %s" % sec5.strip().splitlines()[0][:60])

    # ── ⑤ 不做含路径 ──────────────────────────────────────────────
    sec6 = doc.section("六")
    if sec6 is None:
        cells[5] = (RED, "§六 缺节")
    else:
        hits = [t for t in backtick_tokens(sec6) if "/" in t or t.endswith("/**")]
        if hits:
            cells[5] = (OK, "§六 含路径 token %d 个（例 %s）" % (len(hits), hits[0]))
        else:
            cells[5] = (RED, "§六 无反引号路径（须给具体禁碰路径）")

    # ── ⑥ 域守则清单 ──────────────────────────────────────────────
    sec7 = doc.section("七")
    title7 = dict((n, t) for n, t in doc.titles()).get("七", "")
    if sec7 is None:
        cells[6] = (RED, "§七 缺节")
    else:
        guides = AGENTS_MD_RE.findall(sec7)
        has_decl = bool(NOTE_HEADING_RE.search(title7)) or bool(NOTE_HEADING_RE.search(sec7))
        with_use = re.findall(r"`[^`]*AGENTS\.md`（[^）]+）", sec7)
        if not guides:
            cells[6] = (RED, "§七 无 `…AGENTS.md` 指针")
        elif has_decl or with_use:
            cells[6] = (OK, "§七 %d 份域守则；%s" % (len(guides),
                                                    "节标题声明必须显式 read" if has_decl else "%d 条带用途" % len(with_use)))
        else:
            cells[6] = (RED, "§七 既无节标题「必须显式」声明，也无任何一条带（用途）")
        if guides and not with_use:
            notes.append((doc.package, 6, "逐条无（用途）标注，仅节标题声明必须显式 read（Q3：信息级，不阻断）"))

    # ── ⑦ 事实落点 ────────────────────────────────────────────────
    titles = [t for _n, t in doc.titles()]
    if any(FACTS_TITLE in t for t in titles):
        cells[7] = (OK, "存在标题含「事实落点」的节")
    else:
        cells[7] = (RED, "缺「事实落点」节（不是跳过）")

    # ── ⑧ 编号可查（半自动）────────────────────────────────────────
    short = ref[:9]
    tokens = []
    for rx in NUM_TOKEN_RES:
        for m in rx.finditer(doc.text):
            if m.group(0) not in tokens:
                tokens.append(m.group(0))
    manual = doc.section("十一")
    manual_v = manual_cell(manual, 8)
    if manual_v is not None:
        cells[8] = (manual_v[0], "§十一 人工结论优先 ⇒ %s：%s" % (manual_v[0], manual_v[1]))
    elif not tokens:
        cells[8] = (OK, "0 个编号（N/A）")
    else:
        # 逐一验**全部**编号；且只认「非自身命中」——被审文档自身必含该编号，
        # 不排除它则「0 命中 ⇒ 🟡」永不可达（⑧ 会退化成永远 ✅ 的空转判据）。
        self_ref = "%s:%s" % (ref, doc.path)
        hit_parts = []
        misses = []
        for tok in tokens:
            count, _files = git.grep_files(ref, tok, exclude=self_ref)
            hit_parts.append("%s=%d" % (tok, count))
            if count == 0:
                misses.append(tok)
        if misses:
            cells[8] = (PENDING, "%d 个编号中 %s 在 %s 无非自身命中 ⇒ 待人工；全部命中数: %s"
                        % (len(tokens), "、".join(misses), short, "、".join(hit_parts)))
            questions.append((8, "这些编号在产品仓无（非自身）定义，请确认：%s" % "、".join(misses)))
        else:
            cells[8] = (OK, "%d 个编号全部可查（非自身命中，%s）: %s"
                        % (len(tokens), short, "、".join(hit_parts)))

    # ── ⑨ 跨仓摘要（半自动）────────────────────────────────────────
    manual_v = manual_cell(manual, 9)
    if manual_v is not None:
        cells[9] = (manual_v[0], "§十一 人工结论优先 ⇒ %s：%s" % (manual_v[0], manual_v[1]))
    else:
        cells[9] = judge_cross_repo(doc)

    # ── ⑩ 合并规则 ────────────────────────────────────────────────
    m = MERGE_RULE_RE.search(doc.text)
    if m:
        cells[10] = (OK, "全文命中「%s」" % m.group(0))
    else:
        cells[10] = (RED, "全文未命中（四条件|自合并|合并例外）")

    return cells, notes, questions


def manual_cell(section_text, item_no):
    """§十一 人工结论（机器可读落点）：表格行 | 8 | 编号可查 | ✅ | 说明 |。"""
    if section_text is None:
        return None
    for line in section_text.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or cells[0] != str(item_no):
            continue
        verdict = cells[2]
        if verdict not in (OK, RED, PENDING):
            raise Degrade("非法 verdict（§十一 第 %d 项 = %r）" % (item_no, verdict))
        body = cells[3] if len(cells) > 3 else ""
        return verdict, body
    return None


def _strip_prose(line):
    """去反引号/标记/空白后计字数（判项⑨）。"""
    out = re.sub(r"`[^`]*`", "", line)
    out = re.sub(r"[*_#>~|│]", "", out)
    out = re.sub(r"\s+", "", out)
    return out


def _line_prefix(line):
    m = re.match(r"^(\s*[^\w\s\u4e00-\u9fff]*)", line)
    return (m.group(1).strip() if m else "")


def judge_cross_repo(doc):
    hits = [(i, ln) for i, ln in enumerate(doc.lines)
            if any(k in ln for k in HANDBOOK_KEYS)]
    if not hits:
        return OK, "0 行（N/A）"
    kept = []
    for i, ln in hits:
        if "→" in ln and any(k in ln for k in POINTER_MARKERS):
            continue   # 位置指针排除
        kept.append((i, ln))
    if not kept:
        return OK, "0 行（N/A；全部为位置指针）"
    blocks = []
    for i, ln in kept:
        if blocks and i - blocks[-1][-1][0] <= 2 and _line_prefix(ln) == _line_prefix(blocks[-1][-1][1]):
            blocks[-1].append((i, ln))
        else:
            blocks.append([(i, ln)])
    best = max(len("".join(_strip_prose(ln) for _i, ln in blk)) for blk in blocks)
    if best >= 30:
        return OK, "%d 行跨仓引用；最长连续块正文 %d 字（≥30）" % (len(kept), best)
    return PENDING, "%d 行跨仓引用；最长连续块正文仅 %d 字（<30）⇒ 待人工" % (len(kept), best)


# ---------------------------------------------------------------- 包发现与主流程

PKG_RE = re.compile(r"^agents/(P\d+-[^/]+)/AGENTS\.md$")


def discover(git, ref):
    """信号量：`git ls-tree -r --name-only <ref> -- agents` 过滤包守则路径。"""
    paths = git.tree_paths(ref)
    found = []
    for path in paths:
        m = PKG_RE.match(path)
        if m:
            found.append((m.group(1), path))
    found.sort(key=lambda t: int(re.match(r"P(\d+)", t[0]).group(1)))
    return found


def select_packages(discovered, requested):
    if not requested or not requested.strip():
        return discovered
    by_dir = dict(discovered)
    by_num = {}
    for name, path in discovered:
        by_num[re.match(r"(P\d+)", name).group(1)] = (name, path)
    out = []
    for raw in requested.split(","):
        token = raw.strip()
        if not token:
            continue
        if token in by_dir:
            out.append((token, by_dir[token]))
            continue
        hit = by_num.get(token.upper()) or by_num.get(token)
        if hit is None:
            raise Degrade("请求的包守则不存在：%s" % token)
        out.append(hit)
    if not out:
        return discovered
    seen = []
    for item in out:
        if item not in seen:
            seen.append(item)
    seen.sort(key=lambda t: int(re.match(r"P(\d+)", t[0]).group(1)))
    return seen


def compute(rows):
    """统计 ✅/🔴/🟡（只数十项格，忽略 `_path` 这类元键）。"""
    green = red = pending = 0
    for _pkg, cells in rows:
        for n in range(1, 11):
            verdict = cells.get(n, (RED, ""))[0]
            if verdict == OK:
                green += 1
            elif verdict == RED:
                red += 1
            elif verdict == PENDING:
                pending += 1
    return green, red, pending, green + red + pending


def validate_verdicts(rows):
    """防御断言：1–7/10 只允许 ✅/🔴；8/9 只允许 ✅/🟡；其它值 ⇒ exit 2。"""
    for pkg, cells in rows:
        for item in range(1, 11):
            verdict = cells.get(item, (RED, "未判"))[0]
            allowed = (OK, RED) if item in AUTOMATIC else (OK, PENDING)
            if verdict not in allowed:
                raise Degrade("非法 verdict: %s 第 %d 项 = %r（允许 %s）"
                              % (pkg, item, verdict, "/".join(allowed)))


def _disp_width(text):
    width = 0
    for ch in text:
        width += 2 if _is_wide(ch) else 1
    return width


def _is_wide(ch):
    return unicodedata.east_asian_width(ch) in ("W", "F")


def _pad(text, width):
    return text + " " * max(0, width - _disp_width(text))


def print_matrix(rows, meta):
    print("P4 包自足性审查（%s）" % PROTOCOL)
    print("repo=%s  ref=%s  as_of=%s  signal=%d  python=%s"
          % (meta["repo"], meta["ref"], meta["as_of"], meta["signal_count"], meta["python"]))
    print("")
    name_w = max([len("包")] + [_disp_width(p) for p, _c in rows] + [12])
    print((_pad("包", name_w) + "  " + " ".join("%2d" % n for n in range(1, 11))).rstrip())
    print((_pad("", name_w) + "  " + " ".join(_pad(ITEM_NUM[n], 2) for n in range(1, 11))).rstrip())
    for pkg, cells in rows:
        cells_txt = []
        for n in range(1, 11):
            v = cells.get(n, (RED, "未判"))[0]
            cells_txt.append(_pad(v, 2))
        print((_pad(pkg, name_w) + "  " + " ".join(cells_txt)).rstrip())
    print("")
    print("图例：✅ 通过 ｜ 🔴 缺口 ｜ 🟡 待人工确认（不视为通过，仍 exit 1）")


def print_evidence(rows):
    print("")
    print("── 每格证据 ──")
    for pkg, cells in rows:
        print("%s（%s）" % (pkg, cells.get("_path", "")))
        for n in range(1, 11):
            verdict, evidence = cells.get(n, (RED, "未判"))
            print("  %2d %s %s" % (n, verdict, evidence))


def print_gaps(rows):
    gaps = []
    for pkg, cells in rows:
        for n in range(1, 11):
            verdict, evidence = cells.get(n, (RED, "未判"))
            if verdict == RED:
                gaps.append((pkg, n, evidence))
    print("")
    print("## 缺口清单（%d 条；可直接贴派单）" % len(gaps))
    if not gaps:
        print("（无）")
        return gaps
    print("| 包 | 项 | 具体缺什么 | 建议补法 |")
    print("|---|---|---|---|")
    for pkg, n, evidence in gaps:
        print("| %s | %s %s | %s | %s |" % (pkg, ITEM_NUM[n], ITEM_NAME[n], evidence, FIX_HINT[n]))
    return gaps


ITEM_NUM = {n: "①②③④⑤⑥⑦⑧⑨⑩"[n - 1] for n in range(1, 11)}
ITEM_NAME = {
    1: "落点存在性", 2: "判据可执行", 3: "写集精确", 4: "依赖明确", 5: "不做含路径",
    6: "域守则清单", 7: "事实落点", 8: "编号可查", 9: "跨仓摘要", 10: "合并规则",
}
FIX_HINT = {
    1: "②③ 的反引号路径必须在仓内存在；④ 目标无父目录 ⇒ 补父目录或改路径",
    2: "§三 给 `bash <脚本> <参数>` ＋ 期望输出；补「反例：改坏 <X> ⇒ 必红」",
    3: "§四 写到文件级（`.ts/.sh/.md/...`）或显式写「不改代码/不写生产码」",
    4: "§五 补状态词（已完成/进行中/未开始/无/不依赖/过审/阻塞…）",
    5: "§六 补具体禁碰路径（反引号内 `scripts/audit/**` 这类）",
    6: "§七 补 `…AGENTS.md` 指针，并逐条标（用途）",
    7: "补一节标题含「事实落点」的节（条目 → 可复跑落点 → 现状）",
    8: "补编号定义（B\d+/K\d+-\d+ 在仓内可查），或 §十一 记人工结论",
    9: "handbook 引用旁内联≥30 字摘要（不能只有路径），或 §十一 记人工结论",
    10: "全文补「四条件/自合并/合并例外」的合并规则",
}


def build_rows(docs, git, ref):
    rows = []
    notes = []
    questions = []
    for doc in docs:
        cells, doc_notes, doc_questions = judge(doc, git, ref)
        cells["_path"] = doc.path
        rows.append((doc.package, cells))
        notes.extend(doc_notes)
        for item, question in doc_questions:
            questions.append((doc.package, item, question))
    return rows, notes, questions


DEFAULT_QUESTION = "请人工确认该项（人工结论的机器可读落点 = 包守则 §十一）"


def to_json(meta, rows, notes, questions=None, degraded=None):
    matrix = []
    evidence = []
    gaps = []
    manual_pending = []
    question_map = dict(((pkg, item), q) for pkg, item, q in (questions or []))
    for pkg, cells in rows:
        cell_map = {}
        for n in range(1, 11):
            verdict, ev = cells.get(n, (RED, "未判"))
            cell_map[str(n)] = {"item": ITEM_NAME[n], "verdict": verdict, "evidence": ev}
            evidence.append("%s/%s %s: %s" % (pkg, ITEM_NUM[n], verdict, ev))
            if verdict == RED:
                gaps.append({"package": pkg, "item": n, "item_name": ITEM_NAME[n],
                             "missing": ev, "fix_hint": FIX_HINT[n]})
            elif verdict == PENDING:
                manual_pending.append({"package": pkg, "item": n, "item_name": ITEM_NAME[n],
                                       "missing": ev, "fix_hint": FIX_HINT[n],
                                       "question": question_map.get((pkg, n), DEFAULT_QUESTION)})
        matrix.append({"package": pkg, "path": cells.get("_path", ""), "cells": cell_map})
    green, red, pending, _cells = compute(rows)
    exit_code = EXIT_DEGRADED if degraded else (EXIT_OK if (red == 0 and pending == 0) else EXIT_GAP)
    payload = {
        "tool": "check-package-selfsufficiency",
        "version": VERSION,
        "protocol": PROTOCOL,
        "scope_items": list(range(1, 11)),
        "repo": meta.get("repo"),
        "ref": meta.get("ref"),
        "as_of": meta.get("as_of"),
        "signal_count": meta.get("signal_count"),
        "python": meta.get("python"),
        "matrix": matrix,
        "evidence": evidence,
        "gaps": gaps,
        "notes": [{"package": p, "item": n, "note": t} for (p, n, t) in notes],
        "manual_pending": manual_pending,
        "summary": {"green": green, "red": red, "pending": pending},
        "exit": exit_code,
    }
    if degraded:
        payload["degraded"] = degraded
    return payload


def run(args):
    git_exe = find_git()
    if git_exe is None:
        raise Degrade("git 不可用")
    repo = resolve_repo(git_exe)
    git = Git(git_exe, repo)
    ref = (args.ref or "HEAD").strip() or "HEAD"
    rev = git.verify_commit(ref)
    discovered = discover(git, rev)
    signal_count = len(discovered)
    py_ver = "%d.%d.%d" % sys.version_info[:3]
    meta = {"repo": repo, "ref": ref, "as_of": git.short_sha(rev), "signal_count": signal_count, "python": py_ver}

    if signal_count == 0:
        raise Degrade("发现 0 份包守则（信号量==0）")
    selected = select_packages(discovered, args.packages)
    if not selected:
        raise Degrade("发现 0 份包守则（信号量==0）")

    docs = []
    for name, path in selected:
        docs.append(Doc(name, path, git.show(rev, path)))
    rows, notes, questions = build_rows(docs, git, rev)
    validate_verdicts(rows)
    green, red, pending, _cells = compute(rows)
    exit_code = EXIT_OK if (red == 0 and pending == 0) else EXIT_GAP
    meta["exit"] = exit_code

    if args.json:
        print(json.dumps(to_json(meta, rows, notes, questions), ensure_ascii=False, indent=2))
        return exit_code

    print_matrix(rows, meta)
    print_evidence(rows)
    gaps = print_gaps(rows)
    print("")
    print("## 信息级备注（不阻断）")
    if notes:
        print("| 包 | 项 | 备注 |")
        print("|---|---|---|")
        for pkg, n, note in notes:
            print("| %s | %s %s | %s |" % (pkg, ITEM_NUM[n], ITEM_NAME[n], note))
    else:
        print("（无）")
    pending_cells = [(p, n, c[n][1]) for p, c in rows for n in range(1, 11) if c.get(n, (None,))[0] == PENDING]
    question_map = dict(((pkg, item), q) for pkg, item, q in questions)
    print("")
    print("## 待人工确认（%d 条；⚠ 人工结论优先取包守则 §十一）" % len(pending_cells))
    if pending_cells:
        print("| 包 | 项 | 怎么判出来的 | 请确认什么 |")
        print("|---|---|---|---|")
        for pkg, n, ev in pending_cells:
            print("| %s | %s %s | %s | %s |"
                  % (pkg, ITEM_NUM[n], ITEM_NAME[n], ev, question_map.get((pkg, n), DEFAULT_QUESTION)))
    else:
        print("（无）")
    print("")
    given_up = green + red + pending
    status = "PASS" if (red == 0 and pending == 0) else "GAP(%d)" % (given_up - green)
    print("SELFSUFFICIENCY: %s  signal=%d red=%d pending=%d exit=%d"
          % (status, signal_count, red, pending, exit_code))
    return exit_code


def build_parser():
    parser = argparse.ArgumentParser(
        prog="check-package-selfsufficiency.py",
        description="包守则自足性审查（协议 v2 · 第 1–10 项）")
    parser.add_argument("--packages", default="",
                        help="只审指定包（逗号分隔，例 P1,P4；默认 = 发现到的全部包）")
    parser.add_argument("--json", action="store_true", help="输出结构化 JSON（stdout 仅 JSON）")
    parser.add_argument("--ref", default="HEAD", help="审哪个 git ref（默认 HEAD）")
    parser.add_argument("--selfcheck", action="store_true", help="判别力自检（fixture 跑三子例）")
    parser.add_argument("--version", action="version", version="check-package-selfsufficiency %s" % VERSION)
    return parser


def _emit_degrade(args, reason):
    """降级落点：stderr 一行 `degraded: …` + exit 2（铁律 11 / dev doc §5.2）。"""
    sys.stderr.write("degraded: %s\n" % reason)
    if args.selfcheck:
        print("SELFCHECK-FAIL: degraded: %s" % reason)
    elif args.json:
        print(json.dumps(to_json({"repo": None, "ref": args.ref, "as_of": None,
                                  "signal_count": 0,
                                  "python": "%d.%d.%d" % sys.version_info[:3]},
                                 [], [], degraded=reason), ensure_ascii=False, indent=2))
    else:
        print("SELFSUFFICIENCY: DEGRADED  signal=0 red=0 pending=0 exit=2")
    return EXIT_DEGRADED


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        if args.selfcheck:
            return run_selfcheck(args)
        return run(args)
    except Degrade as exc:
        return _emit_degrade(args, exc.reason)
    except Exception as exc:   # noqa: BLE001 —— §5.2「解析/内部异常 ⇒ exit 2」：
        # 绝不裸 Traceback（那是 exit 1 且无 `degraded:` 行），也绝不静默放行。
        return _emit_degrade(args, "内部异常: %s: %s" % (type(exc).__name__, exc))


# ---------------------------------------------------------------- --selfcheck

FIXTURE_BASE = """# P0 · 自测夹具 —— 包守则（纵向）

> 本件是 `--selfcheck` 的一次性夹具基线：十项判据全绿。不是任何真实包。

## 一、目的（一句话）

证明判据的正向路径不是写死红

## 二、内容

夹具内容／`src/example.ts` 落点／自测脚本

## 三、完成判据

`bash scripts/selftest.sh` ⇒ 输出 `SELFTEST: OK`｜反例：改坏 `scripts/selftest.sh` ⇒ 必红

## 四、写集（**文件级**）

src/example.ts｜scripts/selftest.sh

## 五、依赖

无（夹具不依赖任何包）

## 六、不做什么

❌ 不碰 `scripts/audit/**`（K3 专属）

## 七、🔴 域守则指针（**必须显式 read**）

`memory/notes/AGENTS.md`（夹具改动须引四态 Note）

## 九、回执

过程档案在 handbook 仓；夹具内联摘要：判据正向路径已由本基线子例证明可跑通全绿，不再另给路径。

## 十、事实落点

| # | 条 | 落点（可复跑） |
|---|---|---|
| 1 | 夹具自测 | `scripts/selftest.sh` |

## 十一、自足性审查记录

合并规则：四条件自合并（夹具无 PR，仅占位）。编号自查用 B6。
"""

SELFTEST_SH = "#!/bin/sh\n# 夹具自测脚本（--selfcheck 用）\nprintf 'SELFTEST: OK\\n'\n"
EXAMPLE_TS = "export const example = 1;\n"
# README 内含 B6 的**定义**：让夹具 A 的判项⑧ 走「非自身命中 ≥1 ⇒ ✅」的正向路径
# （只写在自己那份包守则里的编号 = 无定义 ⇒ 🟡，见判项⑧ 与 Fixture D/E 反例）。
README_MD = "# 夹具仓（--selfcheck）\n\n编号定义索引：B6 = 夹具自测编号（本行为非自身命中来源）。\n"

SELFTEST_PKG = "P0-自测"


def _git_env():
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    return env


def _raw_git(git_exe, cwd, argv):
    """不抛异常的 git 调用（fixture 准备与诊断用）；返回 (rc, stdout, stderr)。"""
    try:
        proc = subprocess.run([git_exe, "-C", cwd, "-c", "core.quotePath=false"] + argv,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_git_env())
    except OSError as exc:
        return 127, "", str(exc)
    return (proc.returncode,
            proc.stdout.decode("utf-8", "replace"),
            proc.stderr.decode("utf-8", "replace"))


def _sh(git_exe, cwd, argv, what):
    rc, _out, err = _raw_git(git_exe, cwd, argv)
    if rc != 0:
        raise Degrade("selfcheck 准备失败（%s）: %s" % (what, (err.strip().splitlines() or ["rc=%d" % rc])[-1]))
    return rc


def _make_repo(git_exe, root, name, files):
    """建一次性 fixture 仓（系统临时目录内；绝不写产品仓）。"""
    path = os.path.join(root, name)
    os.makedirs(path)
    _sh(git_exe, path, ["init", "-q"], "git init")
    for rel, content in files.items():
        full = os.path.join(path, *rel.split("/"))
        parent = os.path.dirname(full)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent)
        with open(full, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
    _sh(git_exe, path, ["add", "-A"], "git add")
    _sh(git_exe, path, ["-c", "user.email=fixture@selfcheck.local",
                        "-c", "user.name=selfcheck", "-c", "commit.gpgsign=false",
                        "-c", "core.hooksPath=" + os.path.join(path, ".git", "hooks"),
                        "commit", "-qm", "fixture"], "git commit")
    return path


def _inner(repo_path, args):
    """跑一次**真实的自身 CLI**（子进程）：repo root 由注入缝显式钉到 fixture。"""
    env = dict(os.environ)
    env[SEAM_REPO] = os.path.abspath(repo_path)
    env["GIT_TERMINAL_PROMPT"] = "0"
    cmd = [sys.executable or "python3", os.path.abspath(__file__)] + args
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    except OSError as exc:
        raise Degrade("selfcheck inner 进程启动失败: %s" % exc)
    return (proc.returncode,
            proc.stdout.decode("utf-8", "replace"),
            proc.stderr.decode("utf-8", "replace"))


def _parse_inner(stdout, which):
    """inner 的 `--json` 输出 → (summary, {项号: verdict})；非 JSON/形状不符 ⇒ degrade。"""
    try:
        payload = json.loads(stdout)
    except ValueError:
        raise Degrade("selfcheck %s 子例 inner 输出非 JSON（前 200 字: %r）" % (which, stdout[:200]))
    if not isinstance(payload, dict):
        raise Degrade("selfcheck %s 子例 inner JSON 形状不符（非对象）" % which)
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        raise Degrade("selfcheck %s 子例 inner JSON 缺 summary" % which)
    for need in ("green", "red", "pending"):
        if need not in summary:
            raise Degrade("selfcheck %s 子例 inner JSON 缺 summary.%s" % (which, need))
    cells = {}
    for row in payload.get("matrix") or []:
        for key, cell in (row.get("cells") or {}).items():
            cells[str(key)] = (cell or {}).get("verdict")
    return summary, cells


def _fixture_diag(git_exe, repo_path, which, err):
    """fixture 诊断证据（子例不符期望时打印；不许静默 inner=2）。"""
    rc, out, gerr = _raw_git(git_exe, repo_path, ["ls-tree", "-r", "--name-only", "HEAD"])
    files = out.strip().splitlines() if rc == 0 else ["(ls-tree 失败: %s)" % gerr.strip()[:120]]
    rc2, out2, gerr2 = _raw_git(git_exe, repo_path, ["log", "--oneline"])
    log = out2.strip().splitlines() if rc2 == 0 else ["(log 失败: %s)" % gerr2.strip()[:120]]
    tail = err.strip().splitlines()[-3:] if err.strip() else ["(空)"]
    return [
        "[selfcheck]   %s 诊断: git ls-tree -r --name-only HEAD = %s" % (which, files),
        "[selfcheck]   %s 诊断: git log --oneline = %s" % (which, log),
        "[selfcheck]   %s 诊断: inner stderr 末 3 行 = %s" % (which, tail),
    ]


def run_selfcheck(args):
    """判别力自检：fixture 三子例。A 基线全绿 / B 改坏必红 / C 空仓信号量==0。"""
    git_exe = find_git()
    if git_exe is None:
        raise Degrade("git 不可用")
    root = tempfile.mkdtemp(prefix="pkg-selfsufficiency-")
    subcases = []
    diag = []
    try:
        base_files = {
            "agents/%s/AGENTS.md" % SELFTEST_PKG: FIXTURE_BASE,
            "README.md": README_MD,
            "src/example.ts": EXAMPLE_TS,
            "scripts/selftest.sh": SELFTEST_SH,
        }
        repo_a = _make_repo(git_exe, root, "A", base_files)
        broken = FIXTURE_BASE.replace("`bash scripts/selftest.sh` ⇒ ", "")
        if broken == FIXTURE_BASE:
            raise Degrade("selfcheck 准备失败：夹具 §三 未找到可删除的 `bash …` 命令")
        files_b = dict(base_files)
        files_b["agents/%s/AGENTS.md" % SELFTEST_PKG] = broken
        repo_b = _make_repo(git_exe, root, "B", files_b)
        repo_c = _make_repo(git_exe, root, "C", {"README.md": README_MD})

        rc_a, out_a, err_a = _inner(repo_a, ["--ref", "HEAD", "--json"])
        rc_b, out_b, err_b = _inner(repo_b, ["--ref", "HEAD", "--json"])
        rc_c, out_c, err_c = _inner(repo_c, ["--ref", "HEAD", "--json"])

        sum_a, cells_a = _parse_inner(out_a, "A")
        sum_b, cells_b = _parse_inner(out_b, "B")

        a_ok = (rc_a == EXIT_OK and sum_a["green"] == 10
                and sum_a["red"] == 0 and sum_a["pending"] == 0)
        b_ok = (rc_b == EXIT_GAP and sum_b["red"] == 1 and cells_b.get("2") == RED)
        c_ok = (rc_c == EXIT_DEGRADED and "信号量==0" in err_c)

        label_b = "改坏（仅删 §三 的 `bash …` 命令）"
        label_c = "空仓（无 agents/）"
        subcases.append({"case": "A", "label": "基线", "inner_exit": rc_a,
                         "summary": dict(sum_a), "cells": cells_a, "ok": a_ok,
                         "detail": "期望 10✅ / inner_exit=0"})
        subcases.append({"case": "B", "label": label_b, "inner_exit": rc_b,
                         "summary": dict(sum_b), "cells": cells_b, "ok": b_ok,
                         "detail": "期望 ②🔴 / inner_exit=1（实 ②=%s）" % cells_b.get("2")})
        subcases.append({"case": "C", "label": label_c, "inner_exit": rc_c,
                         "summary": {"green": 0, "red": 0, "pending": 0}, "cells": {},
                         "ok": c_ok, "degraded_reason": (err_c.strip().splitlines() or [""])[-1],
                         "detail": "期望 inner_exit=2 且 stderr 含「信号量==0」"})

        failures = []
        if not a_ok:
            failures.append("A 基线非全绿（inner_exit=%d %d✅/%d🔴/%d🟡，期望 10✅ inner_exit=0）"
                            % (rc_a, sum_a["green"], sum_a["red"], sum_a["pending"]))
        if not b_ok:
            failures.append("B 改坏未被判红（inner_exit=%d %d🔴 ②=%s，期望 1🔴 ②=🔴 inner_exit=1）"
                            % (rc_b, sum_b["red"], cells_b.get("2")))
        if not c_ok:
            failures.append("C 空仓未 fail-closed（inner_exit=%d，期望 2 且 stderr 含「信号量==0」）"
                            % rc_c)
        for item, repo_path, rc, err in (("A", repo_a, rc_a, err_a),
                                         ("B", repo_b, rc_b, err_b),
                                         ("C", repo_c, rc_c, err_c)):
            if any(f.startswith(item + " ") for f in failures):
                diag.extend(_fixture_diag(git_exe, repo_path, item, err))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    ok = not failures
    if args.json:
        print(json.dumps({"tool": "check-package-selfsufficiency", "mode": "selfcheck",
                          "subcases": subcases, "ok": ok,
                          "exit": EXIT_GAP if ok else EXIT_DEGRADED},
                         ensure_ascii=False, indent=2))
        return EXIT_GAP if ok else EXIT_DEGRADED
    for sub in subcases:
        if sub["case"] == "C":
            print("[selfcheck] C %s inner_exit=%d stderr=%s"
                  % (sub["label"], sub["inner_exit"], sub.get("degraded_reason") or "(空)"))
            continue
        off = [ITEM_NUM[n] for n in range(1, 11) if sub["cells"].get(str(n)) != OK]
        print("[selfcheck] %s %s inner_exit=%d verdict=%d✅/%d🔴/%d🟡 %s"
              % (sub["case"], sub["label"], sub["inner_exit"],
                 sub["summary"]["green"], sub["summary"]["red"], sub["summary"]["pending"],
                 ("非绿: " + "/".join(off)) if off else "全绿"))
    for line in diag:
        print(line)
    if not ok:
        print("SELFCHECK-FAIL: %s" % "；".join(failures))
        return EXIT_DEGRADED
    print("SELFCHECK-OK: 改坏必红（B inner=1）；空仓信号量==0（C inner=2）")
    return EXIT_GAP


if __name__ == "__main__":
    _force_utf8()
    sys.exit(main())
