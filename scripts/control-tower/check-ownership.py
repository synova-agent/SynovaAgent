#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check-ownership.py — 路径归属查询/校验器（发现制：目录内嵌 .synova-owner 为唯一真源）

一句话: 回答「这个路径属于谁？」——归属真源是**目录自身**的 `.synova-owner` 标记，
        不是任何中央登记表。中央产物（ownership.yaml / CODEOWNERS）由本脚本**生成**。

背景（卡 #1233「登记制 → 发现制」）:
  创始人裁定原则 **登记点 = 汇聚点 = 冲突点**。旧形态把全仓归属写进一份中央
  `ownership.yaml` ⇒ 每建一个新目录都要改同一份文件（D806/D914/D935/D911 同型事故 ≥4 次），
  该文件既是登记点也是合并冲突点。现改为**目录内嵌发现制**（参考 DSH 上游形态：门禁与
  被检对象同目录、自动发现、无中央登记）：
    · 无标记的目录 → 继承**最近祖先**目录的标记；根标记 = 全仓默认
    · 需不同归属 → 只在本目录放一个 `.synova-owner`，**零中央登记**
    · 新增/移动/删除目录 ⇒ 标记随目录走，无需改任何中央文件
  中央 `ownership.yaml` 与 `.github/CODEOWNERS` 降级为**生成产物**（逐字节漂移门禁）。

契约（铁律 47）:
  @input  — 位置参数 FILE...: 待校验文件路径（仓库相对，允许尚未创建的文件，如 src/evidence/x.ts）
            选项 --owner <键>        断言每个文件归属该 owner（不符 → exit 1）
                 --yaml PATH           **显式覆盖缝**：改用该 yaml 作规则源（旧形态；跳过漂移校验）
                 --emit-ownership      生成 ownership.yaml 全文到 stdout（不校验文件）
                 --emit-codeowners     生成 .github/CODEOWNERS 全文到 stdout（不校验文件）
                 --check-drift         只校验「已提交产物 == 现树重生成结果」（逐字节）
                 --quiet               只输出结论行，不打逐文件明细
  @output — stdout 逐文件一行 "<owner>\\t<path>"；越域逐行点名「期望 X 实际 Y」；
            --emit-ownership / --emit-codeowners → 产物全文（UTF-8 + LF，与仓内文件逐字节可比）；
            漂移诊断走 **stderr**（保持 stdout 可被 scan-fullwidth-vars.sh `_owners()` 逐行解析）
  @exit   — 0 = 归属解析成功（含无标记目录继承成功）；或未声明 owner 时全部同域
            **校验路径**（默认 / `--owner` / `--check-drift`）:
              1 = 越域（声明 owner ≠ 实际归属）**或产物漂移**（标记被改删致产物过期、
                  产物未重生成、**根标记缺失**——树与产物不一致是仓库状态的错，不是校验器坏了）
              2 = 检查自身失败（非 git 仓/标记语法错/handle 缺失或冲突/无输入/解析器不可用）—— fail-closed
            **生成路径**（`--emit-ownership` / `--emit-codeowners`）:
              0 = 产出成功；**2 = 无法产出有效产物（无 `**` 兜底规则，如根标记缺失）—— 拒绝产半成品，不静默**
              （与校验路径的 1 是**两个面**：校验面问"仓库对不对"，生成面问"我能不能产出"。
                R1 取舍：P3 整改后两面各自一致——生成面**两**入口均 2，校验面均 1。）
  @degraded — 无规则匹配的文件 → stdout 「⚠️ 无归属规则」明示 + 不计阻断（不静默）；
              其余失败一律 exit 2，绝不与「通过」混同（D328 三态）。
              记法：**标记缺失不是错误**（继承是正常语义）；**产物与树不一致才是违规**（exit 1）。
  @发现面（重要边界，verifier 实测钉死）—— 发现制**只认 git index 中的标记**：
              判据载体 = `git ls-files`（读 index）⇒ **untracked 的 .synova-owner 一律不生效**
              （`--emit-ownership` 不含它、`--check-drift` 仍 rc=0）。这是**刻意设计**，不是缺陷：
                ① 提交端门禁的准确语义 = "本次要提交的东西"，故 `git add` 后即生效；
                ② CI 在干净 checkout（HEAD）上跑 ⇒ tracked 即真源；
                ③ 免疫 worktree / node_modules / `.pnpm-store` 里同名标记造成的**假发现**。
              反例（不得据此判红）: 只 `mktemp` 落文件而**未 `git add`** ⇒ 发现制看不见它（夹具 §12b 钉死）。
  @error  — 不抛异常给调用方；全部经退出码表达（Ctrl-tower 模式 1）
"""
from __future__ import annotations

import argparse
import fnmatch
import subprocess
import sys
from pathlib import Path

# UTF-8 + LF 强制（PLATFORM-CHECKLIST #4；newline="\n" 防 Windows 把 CODEOWNERS 写成 CRLF）
try:
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
except (AttributeError, ValueError):  # PowerShell 重定向等场景 reconfigure 不可用
    pass

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parent.parent.parent
DEFAULT_YAML = REPO_ROOT / "docs" / "synova" / "coordination" / "ownership.yaml"
DEFAULT_CODEOWNERS = REPO_ROOT / ".github" / "CODEOWNERS"
MARKER_NAME = ".synova-owner"                    # 发现制的登记点：每目录一行归属
CODEOWNERS_GLOB_FOR_CATCHALL = "*"               # "**" → "*"（唯一一条生成期变换）
_MARKER_KEYS = ("owner", "handle", "note")       # 严格白名单：未知键 → exit 2（fail-closed）

EXIT_OK = 0
EXIT_VIOLATION = 1
EXIT_FAILED = 2


def _die(msg: str) -> None:
    """检查执行失败 → exit 2（fail-closed，绝不与通过混同）。"""
    print("❌ check-ownership: %s" % msg, file=sys.stderr)
    sys.exit(EXIT_FAILED)


def _load_parser():
    """载入仓内严格 YAML 子集解析器（零三方依赖；本机实测 PyYAML 不可用）。

    @input  — 无
    @output — productline_yaml 模块对象
    @degraded — 不可用 → exit 2（fail-closed；不静默跳过归属校验）
    """
    mod_dir = REPO_ROOT / "scripts" / "product-lines"
    if not mod_dir.is_dir():
        _die("YAML 子集解析器目录不存在: %s" % mod_dir)
    sys.path.insert(0, str(mod_dir))
    try:
        import productline_yaml  # noqa: E402  (路径注入后才能导入)

        return productline_yaml
    except ImportError as e:
        _die("YAML 子集解析器不可用（%s）→ 无法校验归属" % e)


# ══════════════════════════════════════════════════════════════════════════════
# 发现制：扫描目录内嵌标记
# ══════════════════════════════════════════════════════════════════════════════

def parse_marker_text(text: str, rel: str) -> dict:
    """解析单个 .synova-owner 文本 → {owner, handle?, note?}。

    @input  — text: 标记文件全文；rel: 仓库相对路径（仅用于报错点名）
    @output — dict，必含 "owner"；可选 "handle"/"note"（未声明的键不出现）
    @degraded — 未知键 / 重复键 / 空值 / 缺 owner → exit 2（fail-closed，不猜）
    """
    out: dict = {}
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            _die("%s:%d 非法标记行（需 `键: 值`）: %r" % (rel, lineno, raw))
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if key not in _MARKER_KEYS:
            _die("%s:%d 未知标记键 %r（白名单 %s）" % (rel, lineno, key, "|".join(_MARKER_KEYS)))
        if key in out:
            _die("%s:%d 重复键 %r（唯一定义，禁覆盖）" % (rel, lineno, key))
        if not val:
            _die("%s:%d 键 %r 值为空" % (rel, lineno, key))
        if key == "note" and ('"' in val or "\\" in val):
            _die("%s:%d note 含引号/反斜杠（YAML 子集不支持转义）: %r" % (rel, lineno, val))
        out[key] = val
    if "owner" not in out:
        _die("%s 缺 `owner:` 键（标记必填）" % rel)
    return out


def discover_markers(repo_root: Path = REPO_ROOT) -> dict:
    """扫描 git 跟踪/暂存的 .synova-owner 标记 → {目录: 标记dict}。

    用 `git ls-files`（读 index）而非 walk 文件系统：① 免疫 worktree/node_modules/
    .pnpm-store 等未跟踪目录里的同名标记造成的假发现；② 新标记 `git add` 后即被看见
    （提交端门禁的准确语义）；③ 免 BSD/GNU `find` 差异（PLATFORM-CHECKLIST）。

    @input  — repo_root: 仓库根
    @output — {"": {owner:...}, "src/sentinel": {owner:...}}（目录 → 标记；根键为 ""）
    @degraded — 非 git 仓 / git 不可用 → exit 2（无法发现 ≠ 无标记）
    """
    try:
        p = subprocess.run(
            ["git", "-C", str(repo_root), "ls-files", "-z"],
            capture_output=True, text=True, check=False,
        )
    except OSError as e:
        _die("git 不可用（%s）→ 无法发现 %s 标记" % (e, MARKER_NAME))
    if p.returncode != 0:
        _die("git ls-files 失败（rc=%d, %s）→ 非 git 仓或 git 异常" % (p.returncode, p.stderr.strip()))
    markers: dict = {}
    for rel in p.stdout.split("\0"):
        base = rel.rsplit("/", 1)[-1] if rel else ""
        if base != MARKER_NAME:
            continue
        if rel == MARKER_NAME:
            d = ""
        else:
            d = rel[: -len("/" + MARKER_NAME)]
        mpath = repo_root / rel
        try:
            text = mpath.read_text(encoding="utf-8")
        except OSError as e:
            _die("标记不可读 %s（%s）" % (rel, e))
        markers[d] = parse_marker_text(text, rel)
    return markers


def _ancestor_chain(directory: str):
    """目录 → 自身及全部祖先（由近到远），末尾含根 ""。

    @input  — directory: 仓库相对目录（"" = 根）
    @output — 迭代器 ["a/b", "a", ""]（"" = 根）
    @degraded — 无（纯函数）
    """
    parts = [p for p in directory.split("/") if p]
    for i in range(len(parts), -1, -1):
        yield "/".join(parts[:i])


def markers_to_rules(markers: dict):
    """标记树 → (rules, github, notes)。

    语义 = **最近祖先胜出**（等价于 CODEOWNERS「最后匹配者胜出」，产物按深度升序排列使二者一致）：
      · rules 只收录「真正改变归属」的标记（父链同 owner 的标记被塌缩掉 ⇒ 冗余标记零副作用）
      · github / notes 取该 owner 键**最浅**的一次声明（深处置同一 handle 无副作用；
        置**不同** handle → exit 2，禁静默二义）

    @input  — markers: discover_markers() 的返回
    @output — (rules: list[dict], github: dict, notes: dict)
    @degraded — 任一 owner 键在整条祖先链上无 handle → exit 2（产不出可用的 CODEOWNERS）
    """
    if "" not in markers:
        # 根标记缺失：仍能把「有标记的目录」的规则产出来，但无兜底 ⇒ 产物必然与仓内不一致
        # ⇒ 由 --check-drift 判 exit 1（违规），不在此处 exit 2（那是「检查自己坏了」的语义）。
        pass
    rules: list = []
    github: dict = {}
    notes: dict = {}
    # 最浅优先：深度升序 + 同深度字典序（确定性输出，逐字节可比）
    for d in sorted(markers, key=lambda x: (x.count("/") if x else 0, x)):
        owner = markers[d]["owner"]
        parent_owner = None
        for anc in list(_ancestor_chain(d))[1:]:
            if anc in markers:
                parent_owner = markers[anc]["owner"]
                break
        if owner not in github:
            handle = markers[d].get("handle")
            if handle is None:
                # 祖先里同键声明过 → 继承（上面 github 已存）；否则缺 handle
                _die("owner 键 %r（%s）无 handle：该键首次出现处必须声明 `handle: @账号`" % (owner, d or "<root>"))
            github[owner] = handle
        elif "handle" in markers[d] and markers[d]["handle"] != github[owner]:
            _die("owner 键 %r 的 handle 二义：%s 声明 %s，此前为 %s"
                 % (owner, d or "<root>", markers[d]["handle"], github[owner]))
        if owner not in notes:
            if "note" in markers[d]:
                notes[owner] = markers[d]["note"]
        if owner != parent_owner:
            rule = {"glob": (d + "/**") if d else "**", "owner": owner}
            if not d:
                rule["default"] = True
            rules.append(rule)
    for key in github:
        notes.setdefault(key, "")
    return rules, github, notes


def discover(repo_root: Path = REPO_ROOT):
    """发现制入口：标记 → (rules, github, notes)。

    @input  — repo_root
    @output — (rules, github, notes)
    @degraded — 见 discover_markers / markers_to_rules（一律 exit 2）
    """
    return markers_to_rules(discover_markers(repo_root))


# ══════════════════════════════════════════════════════════════════════════════
# 旧形态读取（--yaml 显式覆盖缝；保持逐字兼容）
# ══════════════════════════════════════════════════════════════════════════════

def load_ownership(yaml_path: Path):
    """读 ownership.yaml → (rules, github_owner_map, domain_neutral)。

    @input  — yaml_path: ownership.yaml 路径
    @output — (rules: list[dict], github: dict, neutral: list[str])；
              rules 保持文件顺序（最后匹配者胜出）；neutral 缺省为空列表
    @degraded — 文件缺失 / 解析失败 / 结构非法 → exit 2（fail-closed）
    """
    parser = _load_parser()
    if not yaml_path.is_file():
        _die("ownership.yaml 不存在: %s（检查执行失败，非「通过」）" % yaml_path)
    try:
        data = parser.load_file(str(yaml_path))
    except parser.YamlSubsetError as e:
        _die("ownership.yaml 解析失败: %s" % e)
    if not isinstance(data, dict):
        _die("ownership.yaml 顶层必须是映射（key: value），实际为 %s" % type(data).__name__)
    rules = data.get("rules")
    if not isinstance(rules, list) or not rules:
        _die("ownership.yaml 缺少非空 rules 列表")
    for i, r in enumerate(rules):
        if not isinstance(r, dict) or "glob" not in r or "owner" not in r:
            _die("rules[%d] 必须是含 glob/owner 的映射" % i)
    github = data.get("github") or {}
    if not isinstance(github, dict):
        _die("ownership.yaml 的 github 段必须是映射")
    neutral = data.get("domain_neutral") or []
    if not isinstance(neutral, list):
        _die("ownership.yaml 的 domain_neutral 必须是列表")
    return rules, github, [str(g) for g in neutral]


# ══════════════════════════════════════════════════════════════════════════════
# 归属解析（既有纯函数，语义不变）
# ══════════════════════════════════════════════════════════════════════════════

def glob_match(glob: str, path: str) -> bool:
    """单条 glob 是否匹配仓库相对路径。

    @input  — glob: 规则里的模式（"**" / "dir/**" / 含 * 的路径）；path: 仓库相对路径
    @output — bool
    @degraded — 无（纯函数）
    """
    if glob == "**":
        return True
    if glob.endswith("/**"):
        prefix = glob[:-3]
        return path == prefix or path.startswith(prefix + "/")
    return fnmatch.fnmatchcase(path, glob)


def normalize(path: str) -> str:
    """仓库相对路径归一（Windows 反斜杠 / 前导 ./ 与 /）。"""
    p = path.replace("\\", "/").strip()
    while p.startswith("./"):
        p = p[2:]
    return p.lstrip("/")


def resolve_owner(rules, path: str):
    """按「最后匹配者胜出」解析单文件归属（与 .github/CODEOWNERS 官方语义一致）。

    @input  — rules: 规则列表（文件顺序）；path: 仓库相对路径
    @output — owner 字符串；无任何规则匹配 → None（调用方须明示，不得静默）
    @degraded — 无（纯函数）
    """
    owner = None
    for r in rules:
        if glob_match(str(r["glob"]), path):
            owner = str(r["owner"])
    return owner


# ══════════════════════════════════════════════════════════════════════════════
# 生成产物（卡 #1233：yaml 与 CODEOWNERS 均为产物，逐字节可比）
# ══════════════════════════════════════════════════════════════════════════════

_OWNERSHIP_HEADER = [
    "# ownership.yaml — 【生成产物，请勿手改】",
    "#",
    "# 真源: 各目录内嵌的 %s 标记（**发现制** —— 归属登记点 = 目录自身）" % MARKER_NAME,
    "#   语义: 无标记的目录继承**最近祖先**标记；根标记 = 全仓默认。",
    "#   新增/移动目录 ⇒ 零中央登记；改归属 ⇒ 只改所在目录的标记，不动本文件。",
    "# 生成: python3 scripts/control-tower/check-ownership.py --emit-ownership \\",
    "#         > docs/synova/coordination/ownership.yaml",
    "# 漂移门禁: python3 scripts/control-tower/check-ownership.py --check-drift（**逐字节**断言）",
    "# 规则语义: 按顺序求值，**最后匹配者胜出**（与 .github/CODEOWNERS 官方语义一致）",
    "#   ⇒ 产物按「宽 → 窄」深度升序排列：越具体的目录写在越后面。",
    "#",
    "# ⚠️ 已废止（仅留痕，勿再引用）:",
    "#   · 2026-10-07 前本文件是**手改登记表**（每次新目录都要改它）⇒ 登记点=汇聚点=冲突点，",
    "#     D806/D914/D935/D911 同型事故 ≥4 次。现降级为产物。",
    "#   · 三域 owner 键 `mac` / `win` / `k3`、`domain_neutral:` 段、`territory:` 字段",
    "#     —— 随创始人 2026-10-07「不分域」废止。",
    "",
]


def has_catchall(rules) -> bool:
    """规则表是否含 `**` 兜底（产物有效性的唯一硬条件）。

    @input  — rules: list[dict]
    @output — bool；无兜底 ⇒ 产物对未覆盖路径无归属 ⇒ 生成面拒绝产出（exit 2）
    @degraded — 无（纯函数）
    """
    return any(str(r.get("glob")) == "**" for r in rules)


def emit_ownership(rules, github, notes) -> str:
    """由发现结果生成 ownership.yaml 全文。

    @input  — rules / github / notes（见 markers_to_rules）
    @output — 文本（UTF-8，LF 结尾）；与本文件**逐字节**可比（漂移门禁的基准）
    @degraded — 无 `**` 兜底（如根标记缺失）⇒ exit 2 **拒绝产出**（不产注定漂移的半成品）；
                缺 handle 在 markers_to_rules 已 fail-closed
    """
    if not has_catchall(rules):
        _die("无可生成的兜底规则（根 %s 标记缺失？）→ 拒绝产出无兜底的 ownership.yaml" % MARKER_NAME)
    out = list(_OWNERSHIP_HEADER)
    if any(notes[k] for k in notes):
        out.append("owners:")
        for key in sorted(notes):
            if notes[key]:
                out.append('  %s: "%s"' % (key, notes[key]))
        out.append("")
    out.append("github:")
    for key in sorted(github):
        out.append("  %s: \"%s\"" % (key, github[key]))
    out.append("")
    out.append("rules:")
    for r in rules:
        out.append('  - glob: "%s"' % r["glob"])
        out.append('    owner: "%s"' % r["owner"])
        if r.get("default"):
            out.append("    default: true")
    return "\n".join(out) + "\n"


def emit_codeowners(rules, github) -> str:
    """由发现结果生成 CODEOWNERS 全文（唯一生成期变换: "**" → "*"）。

    @input  — rules / github（见 markers_to_rules）
    @output — 文本（UTF-8，LF 结尾）
    @degraded — github 段缺 owner → 该行报错信息写入 stderr 并 exit 2（不产出半截文件）
    """
    out = [
        "# .github/CODEOWNERS — 【生成产物，请勿手改】",
        "# 真源: 各目录内嵌的 %s 标记（发现制；本文件由 --emit-codeowners 生成）" % MARKER_NAME,
        "# 生成: python3 scripts/control-tower/check-ownership.py --emit-codeowners > .github/CODEOWNERS",
        "# 漂移门禁: check-ownership.py --check-drift 逐字节断言本文件 == 现树生成结果（卡 #1233）",
        "# 语义: CODEOWNERS「最后匹配者胜出」→ 宽规则在前、例外在后（与产物同序）。",
        "#",
        "# 账号体系：在**首次声明该 owner 键**的 .synova-owner 里写 `handle: @账号`，",
        "#   然后重跑生成命令 —— 本文件不需要手改。",
        "",
    ]
    if not has_catchall(rules):
        _die("无可生成的兜底规则（根 %s 标记缺失？）→ 拒绝产出无兜底的 CODEOWNERS" % MARKER_NAME)
    width = max(len(CODEOWNERS_GLOB_FOR_CATCHALL if r["glob"] == "**" else str(r["glob"])) for r in rules)
    width = max(width, 40)
    for r in rules:
        pattern = CODEOWNERS_GLOB_FOR_CATCHALL if r["glob"] == "**" else str(r["glob"])
        handle = github.get(str(r["owner"]))
        if not handle:
            _die("github 段缺少 owner「%s」的账号（规则 %s）" % (r["owner"], r["glob"]))
        out.append("%-*s %s" % (width, pattern, handle))
    return "\n".join(out) + "\n"


def check_drift(repo_root: Path = REPO_ROOT, verbose: bool = True) -> int:
    """校验已提交产物 == 现树重生成结果（**逐字节**）。

    @input  — repo_root；verbose: True 时把逐件 ✅ 打到 stdout（仅显式 --check-drift 用），
              False（默认路径的隐式新鲜度校验）时**成功静默**，避免污染 stdout ——
              该 stdout 被 scan-fullwidth-vars.sh `_owners()` 逐行解析
    @output — EXIT_OK / EXIT_VIOLATION（漂移）；**不改动任何文件**
    @degraded — 产物文件缺失（D 语义）或不可读 → 同样按漂移 exit 1；
                标记解析/发现失败 → exit 2（由 discover 抛出）
    """
    rules, github, notes = discover(repo_root)
    if not has_catchall(rules):
        # 根标记缺失 ⇒ 全仓默认归属无从确定 ⇒ 产物必然与树不一致。
        # 判**违规（exit 1）而非检查失败（exit 2）**：树/产物不一致是仓库状态的错，
        # 不是校验器自己坏了（D328 三态的分界；且「删标记 ⇒ exit 1」是本卡判据②）。
        # ⚠️ 与**生成面**（--emit-* ⇒ exit 2）是两个面：校验面问"仓库对不对"，
        #    生成面问"我能不能产出"（R1 整改后两面各自一致，见模块头 @exit）。
        print("❌ 产物漂移: 根 %s 标记缺失 ⇒ 无兜底规则（全仓归属真源消失）" % MARKER_NAME, file=sys.stderr)
        print("   ⇒ 恢复根标记（owner:/handle:）后重跑生成命令", file=sys.stderr)
        return EXIT_VIOLATION
    expected = {
        DEFAULT_YAML: emit_ownership(rules, github, notes),
        DEFAULT_CODEOWNERS: emit_codeowners(rules, github),
    }
    drifted = 0
    for path, want in expected.items():
        try:
            rel = path.relative_to(repo_root).as_posix()
        except ValueError:
            rel = str(path)
        if not path.is_file():
            print("❌ 产物漂移: %s 不存在（应为生成产物）" % rel, file=sys.stderr)
            drifted += 1
            continue
        got = path.read_text(encoding="utf-8")
        if got == want:
            if verbose:
                print("✅ 产物新鲜: %s（逐字节一致）" % rel)
            continue
        drifted += 1
        got_lines = got.splitlines()
        want_lines = want.splitlines()
        first = next((i for i in range(max(len(got_lines), len(want_lines)))
                      if (got_lines[i] if i < len(got_lines) else None)
                      != (want_lines[i] if i < len(want_lines) else None)), 0)
        print("❌ 产物漂移: %s —— 第 %d 行起不一致（仓内 %d 行 / 重生成 %d 行）"
              % (rel, first + 1, len(got_lines), len(want_lines)), file=sys.stderr)
        print("   仓内: %s" % (got_lines[first] if first < len(got_lines) else "<缺行>"), file=sys.stderr)
        print("   应为: %s" % (want_lines[first] if first < len(want_lines) else "<缺行>"), file=sys.stderr)
        print("   ⇒ 重跑生成命令（改归属请改目录里的 %s，不要手改产物）" % MARKER_NAME, file=sys.stderr)
    if drifted:
        print("❌ FAIL 产物漂移 %d 件（真源 = 目录 %s 标记）" % (drifted, MARKER_NAME), file=sys.stderr)
        return EXIT_VIOLATION
    return EXIT_OK


def main(argv) -> int:
    ap = argparse.ArgumentParser(
        prog="check-ownership.py",
        description="路径归属查询/校验（发现制，卡 #1233）：标记缺失=继承；产物漂移 exit 1；检查自身失败 exit 2",
    )
    ap.add_argument("files", nargs="*", help="待校验文件（仓库相对路径）")
    ap.add_argument("--owner", default=None, help="声明 owner；逐文件断言归属")
    ap.add_argument("--yaml", default=None,
                    help="**显式覆盖缝**：改用该 yaml 作规则源（旧形态；跳过漂移校验）。默认⇒扫描 %s 发现" % MARKER_NAME)
    ap.add_argument("--emit-ownership", action="store_true", help="生成 ownership.yaml 全文到 stdout")
    ap.add_argument("--emit-codeowners", action="store_true", help="生成 CODEOWNERS 全文到 stdout")
    ap.add_argument("--check-drift", action="store_true", help="只校验产物是否逐字节新鲜")
    ap.add_argument("--quiet", action="store_true", help="只输出结论行")
    args = ap.parse_args(argv)

    if args.check_drift:
        return check_drift()

    if args.yaml is not None:
        # 旧形态（显式覆盖缝）：规则源 = 指定 yaml；不做漂移校验（调用方自有基准）
        rules, github, neutral = load_ownership(Path(args.yaml))
        notes = {}
    else:
        rules, github, notes = discover()
        neutral = []

    if args.emit_ownership:
        if args.yaml is not None:
            _die("--emit-ownership 只支持发现制（不要与 --yaml 同用）")
        sys.stdout.write(emit_ownership(rules, github, notes))
        return EXIT_OK

    if args.emit_codeowners:
        sys.stdout.write(emit_codeowners(rules, github))
        return EXIT_OK

    if not args.files:
        _die("未给出待校验文件（用法: check-ownership.py <文件...> [--owner <键>]）")

    rows = []          # (path, owner|None)
    violations = []    # (path, expected, actual)
    unmatched = []
    neutral_rows = []
    for raw in args.files:
        path = normalize(raw)
        if not path:
            continue
        if any(glob_match(g, path) for g in neutral):
            neutral_rows.append(path)   # 域判定豁免：两种模式都不判域，只明示
            continue
        owner = resolve_owner(rules, path)
        rows.append((path, owner))
        if owner is None:
            unmatched.append(path)
        elif args.owner is not None and owner != args.owner:
            violations.append((path, args.owner, owner))

    for path in neutral_rows:
        print("·   domain-neutral  %s" % path)
    if not rows and not neutral_rows:
        _die("待校验文件列表为空（全为空白路径）")

    if not args.quiet:
        for path, owner in rows:
            if owner is None:
                print("⚠️  无归属规则  %s" % path)
            else:
                print("%-4s %s" % (owner, path))
        print("")

    for path in unmatched:
        print("⚠️  %s 无归属规则匹配 —— 未计入阻断（根 %s 标记缺失？）" % (path, MARKER_NAME))
    for path, expected, actual in violations:
        print("❌ 越域: %s —— 声明 owner=%s，实际 owner=%s" % (path, expected, actual))

    # 发现制默认路径：归属判定的**新鲜度**是结论有效性的一部分 —— 产物与树不一致 ⇒ exit 1。
    # 诊断走 stderr（stdout 必须保持可被 scan-fullwidth-vars.sh `_owners()` 逐行解析）。
    drift_rc = EXIT_OK
    if args.yaml is None:
        drift_rc = check_drift(verbose=False)

    if args.owner is not None:
        if violations:
            print("❌ FAIL 越域 %d 处（声明 owner=%s）" % (len(violations), args.owner))
            return EXIT_VIOLATION
        print("✅ PASS %d 个文件全部归属 owner=%s（无归属 %d）" % (len(rows) - len(unmatched), args.owner, len(unmatched)))
        return drift_rc

    domains = sorted({owner for _, owner in rows if owner is not None})
    _suffix = "（无归属 %d，域判定豁免 %d）" % (len(unmatched), len(neutral_rows))
    if len(domains) > 1:
        # 判别性夹具（既有测试 §3）：规则源非单 owner 时，同一变更集跨 owner 必须 exit 1 ——
        # 证明本校验器**真读规则源**，而非对任何输入都静态恒绿地回 "PASS"。
        print("❌ FAIL 跨域: 变更落在 %d 个域 %s —— 单个 PR 只许一个域%s" % (len(domains), domains, _suffix))
        return EXIT_VIOLATION
    shown = domains[0] if domains else "无归属"
    print("✅ PASS %d 个文件同域: %s%s" % (len(rows) - len(unmatched), shown, _suffix))
    return drift_rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
