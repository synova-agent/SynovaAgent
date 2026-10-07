#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check-ownership.py — 路径归属查询/校验器（ownership.yaml 的唯一机器消费者）
#
# 🔴 2026-10-07 · 创始人授权清理「分域」：
#   原职责 = 「模块域归属校验器」（判 mac/win/k3 三域 + 跨域即 exit 1）；
#   分域已废止（创始人：「不分域。谁有空，谁能做就谁做。」）⇒ ownership.yaml 改为单域，
#   「跨域」在结构上不可能发生。本脚本保留的用途 = **归属查询** 与 **CODEOWNERS 生成**。
#   ⚠️ `--owner` 的三值断言（mac/win/k3）随之废止 —— 见 :190 附近注释。

一句话: 回答「这个写集属于哪条线？派给 X 线是否越域？」——把只写在
        docs/synova/coordination/TASK-ROUTING.md 里的人读域划分，变成可机器判定的门禁。

背景（D733 派单 §一）: 域划分此前零机器消费者，Codeowners 26 条规则里 Win 域靠 `src/`
兜底且排在 Mac 例外之后（CODEOWNERS 语义 = 最后匹配者胜出 → 例外被吞）。后果是
CTO 2026-09-13 两次派错线（D728/D729 写集 100% 落 Win 域却派给 Mac 线）。

契约（铁律 47）:
  @input  — 位置参数 FILE...: 待校验文件路径（仓库相对，允许尚未创建的文件，如 src/evidence/x.ts）
            选项 --owner {mac|win|k3}  断言每个文件归属该 owner（越域 → exit 1）
                 --yaml PATH            ownership.yaml 路径（默认 docs/synova/coordination/ownership.yaml）
                 --emit-codeowners      生成 .github/CODEOWNERS 全文到 stdout（不校验文件）
                 --quiet                只输出结论行，不打逐文件明细
  @output — stdout 逐文件一行 "<owner>\\t<path>"；越域/跨域逐行点名「期望 X 实际 Y」；
            --emit-codeowners → CODEOWNERS 全文（UTF-8 + LF，与 .github/CODEOWNERS 逐字节可比）
  @exit   — 0 = 全部文件与声明 owner 一致；或未声明 owner 时全部同域（含全部无归属）
            1 = 越域（声明 owner ≠ 实际归属）或跨域（未声明 owner 但出现 >1 个域）
            2 = 检查执行失败（yaml 缺失/解析失败/未知 owner/无输入/解析器不可用）—— fail-closed
  @degraded — 无规则匹配的文件 → stdout 「⚠️ 无归属规则」明示 + 不计阻断（不静默）；
              其余失败一律 exit 2，绝不与「通过」混同（D328 三态）
  域判定豁免（D734）: ownership.yaml 的 domain_neutral 列出的路径（各线都写自己那一份的
              簿记/过程产物）在**两种模式下都不判域**，只明示 `domain-neutral`；
              它们仍留在 rules 里供 CODEOWNERS 生成使用。
  @error  — 不抛异常给调用方；全部经退出码表达（Ctrl-tower 模式 1）
"""
from __future__ import annotations

import argparse
import fnmatch
import sys
from pathlib import Path

# UTF-8 + LF 强制（PLATFORM-CHECKLIST #4；newline="\\n" 防 Windows 把 CODEOWNERS 写成 CRLF）
try:
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
except (AttributeError, ValueError):  # PowerShell 重定向等场景 reconfigure 不可用
    pass

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parent.parent.parent
DEFAULT_YAML = REPO_ROOT / "docs" / "synova" / "coordination" / "ownership.yaml"
CODEOWNERS_GLOB_FOR_CATCHALL = "*"  # ownership.yaml 的 "**" → CODEOWNERS 的 "*"（唯一一条生成期变换）

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


def emit_codeowners(rules, github) -> str:
    """由 ownership.yaml 生成 CODEOWNERS 全文（唯一生成期变换: "**" → "*"）。

    @input  — rules / github（见 load_ownership）
    @output — 文本（UTF-8，LF 结尾）
    @degraded — github 段缺 owner → 该行报错信息写入 stderr 并 exit 2（不产出半截文件）
    """
    out = [
        "# .github/CODEOWNERS — 【生成产物，请勿手改】",
        "# 源: docs/synova/coordination/ownership.yaml（唯一权威；改那里再重跑下面的命令）",
        "# 生成: python3 scripts/control-tower/check-ownership.py --emit-codeowners > .github/CODEOWNERS",
        "# 漂移门禁: tests/control-tower/ownership.test.sh 逐字节断言本文件 == 生成结果（D733）",
        "# 语义: CODEOWNERS「最后匹配者胜出」→ 宽规则在前、例外在后（与 ownership.yaml 同序）。",
        "#",
        "# 2026-10-07 · 分域已废止（创始人：「不分域。谁有空，谁能做就谁做。」）",
        "#   ownership.yaml 已改为单域 ⇒ 本文件只剩一条兜底（* → 最终把关人）。",
        "#   账号体系：改 ownership.yaml 的 github: 段后重跑生成命令即可 —— 本文件不需要手改。",
        "",
    ]
    width = max(len(CODEOWNERS_GLOB_FOR_CATCHALL if r["glob"] == "**" else str(r["glob"])) for r in rules)
    width = max(width, 40)
    for r in rules:
        pattern = CODEOWNERS_GLOB_FOR_CATCHALL if r["glob"] == "**" else str(r["glob"])
        handle = github.get(str(r["owner"]))
        if not handle:
            _die("github 段缺少 owner「%s」的账号（规则 %s）" % (r["owner"], r["glob"]))
        territory = r.get("territory")
        if isinstance(territory, list) and territory:
            # 派单 §一.2「Win 域必须显式列出」：兜底行的领地正面枚举在产物里可见
            out.append("# %s 领地（显式列出）: %s" % (r["owner"], "、".join(str(t) for t in territory)))
        out.append("%-*s %s" % (width, pattern, handle))
    return "\n".join(out) + "\n"


def main(argv) -> int:
    ap = argparse.ArgumentParser(
        prog="check-ownership.py",
        description="模块域归属校验（D733）：越域 exit 1，检查执行失败 exit 2",
    )
    ap.add_argument("files", nargs="*", help="待校验文件（仓库相对路径）")
    # 🔴 2026-10-07: 原 `--owner` 只收 mac/win/k3 三值（越域 ⇒ exit 1）。分域废止后 owner 恒为
    #   ownership.yaml 的单一 owner 键 ⇒ 三值断言无意义且会误报。现放开为「任意 owner 键」：
    #   传了仍逐文件断言（对单域必然全中），不传则只判「全部同域」（单域下恒成立）。
    ap.add_argument("--owner", default=None, help="声明 owner；逐文件断言归属（单域下恒为 ownership.yaml 的那个键）")
    ap.add_argument("--yaml", default=str(DEFAULT_YAML), help="ownership.yaml 路径")
    ap.add_argument("--emit-codeowners", action="store_true", help="生成 CODEOWNERS 全文到 stdout")
    ap.add_argument("--quiet", action="store_true", help="只输出结论行")
    args = ap.parse_args(argv)

    rules, github, neutral = load_ownership(Path(args.yaml))

    if args.emit_codeowners:
        sys.stdout.write(emit_codeowners(rules, github))
        return EXIT_OK

    if not args.files:
        _die("未给出待校验文件（用法: check-ownership.py <文件...> [--owner <键>]）—— owner 键见 ownership.yaml 的 owners: 段")

    rows = []          # (path, owner|None)
    violations = []    # (path, expected, actual)
    unmatched = []
    neutral_rows = []
    for raw in args.files:
        path = normalize(raw)
        if not path:
            continue
        if any(glob_match(g, path) for g in neutral):
            neutral_rows.append(path)   # 域判定豁免：两种模式都不判域，只明示（各线都写的那一份）
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
        print("⚠️  %s 无归属规则匹配 —— 未计入阻断（ownership.yaml 可能缺规则或兜底被删）" % path)
    for path, expected, actual in violations:
        print("❌ 越域: %s —— 声明 owner=%s，实际 owner=%s" % (path, expected, actual))

    if args.owner is not None:
        if violations:
            print("❌ FAIL 越域 %d 处（声明 owner=%s）" % (len(violations), args.owner))
            return EXIT_VIOLATION
        print("✅ PASS %d 个文件全部归属 owner=%s（无归属 %d）" % (len(rows) - len(unmatched), args.owner, len(unmatched)))
        return EXIT_OK

    domains = sorted({owner for _, owner in rows if owner is not None})
    _suffix = "（无归属 %d，域判定豁免 %d）" % (len(unmatched), len(neutral_rows))
    if len(domains) > 1:
        print("❌ FAIL 跨域: 变更落在 %d 个域 %s —— 单个 PR 只许一个域%s" % (len(domains), domains, _suffix))
        return EXIT_VIOLATION
    shown = domains[0] if domains else "无归属"
    print("✅ PASS %d 个文件同域: %s%s" % (len(rows) - len(unmatched), shown, _suffix))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
