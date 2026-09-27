#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check-ownership.py — 模块域归属校验器（D733；ownership.yaml 的唯一机器消费者）

一句话: 回答「这个写集属于哪条线？派给 X 线是否越域？」——把只写在
        docs/synova/coordination/TASK-ROUTING.md 里的人读域划分，变成可机器判定的门禁。

背景（D733 派单 §一）: 域划分此前零机器消费者，Codeowners 26 条规则里 Win 域靠 `src/`
兜底且排在 Mac 例外之后（CODEOWNERS 语义 = 最后匹配者胜出 → 例外被吞）。后果是
CTO 2026-09-13 两次派错线（D728/D729 写集 100% 落 Win 域却派给 Mac 线）。

D1029 语义变更（兜底不再静默归 win）:
  此前 `**` 兜底 = win，导致「新目录没登记 ⇒ 落兜底判 win ⇒ 混装 PR 跨域红灯」反复 5 次
  （D782 / D793 / D795 / D861 / D914），且 ownership.yaml 自身落兜底 = 执行者可自授权改规则。
  新语义把「兜底命中」与「win 基线领地」拆开：
    a. 命中 domain_neutral            → 域判定豁免（不判域，只明示）—— 不变
    b. 命中任一「非兜底」显式规则      → 该 owner（最后匹配者胜出，保持现行顺序语义）
    c. 未命中 b，但命中兜底规则，且命中 `domain_defaults.win` 里任一 glob → 视同 win（基线领地）
    d. 其余                            → **未归属（unowned）** ⇒ 业务阻断 exit 1
  兜底规则识别（不写死路径清单）: 优先 `default: true`（语义标记），回退 `glob == "**"`（形态）。

契约（铁律 47）:
  @input  — 位置参数 FILE...: 待校验文件路径（仓库相对，允许尚未创建的文件，如 src/evidence/x.ts）
            选项 --owner {mac|win|k3}  断言每个文件归属该 owner（越域 / 未归属 → exit 1）
                 --yaml PATH            ownership.yaml 路径（默认 docs/synova/coordination/ownership.yaml）
                 --emit-codeowners      生成 .github/CODEOWNERS 全文到 stdout（不校验文件；**不读
                                        domain_defaults**，故 B 落地前后 drift 判定无关形态）
                 --quiet                只输出结论行，不打逐文件明细
                 --changed-from REF     取变更集（`git diff --name-only REF`）并与位置参数取并集
                 --claim-check          变更集含 ownership.yaml 时必须从 PR 描述匹配创始人批准凭据
                 --pr-body FILE         PR 描述文件；未给且需要时读 stdin
  @output — stdout 明细行 "<owner>\t<path>[\t<注记>]"（path **恰为第 2 个 TAB 字段**，注记不得混入 path；
            未归属行「⚠️  未归属 …」+ 可复制复核命令）；
            越域/跨域逐行点名「期望 X 实际 Y」；--emit-codeowners → CODEOWNERS 全文
            （UTF-8 + LF，与 .github/CODEOWNERS 逐字节可比）
  @exit   — 0 = 通过（全部同域且无未归属；声明 owner 时全部一致）
            1 = 业务阻断（越域 / 跨域 / **未归属** / claim 缺创始人批准凭据）
            2 = 检查执行失败（yaml 缺失/解析失败/结构非法/无输入/git 不可用/parser 不可用）
                —— fail-closed，绝不与「通过」混同（D328 三态）
  @degraded — 未归属 → stdout 逐条点名 + 阻断（exit 1，不再静默归 win）；
              git 不可用/非仓库而需要变更集 → stderr ❌ + exit 2（**不得造成假绿**）；
              其余失败一律 exit 2，绝不与「通过」混同（D328 三态）
  域判定豁免（D734）: ownership.yaml 的 domain_neutral 列出的路径（各线都写自己那一份的
              簿记/过程产物）在**两种模式下都不判域**，只明示 `domain-neutral`；
              它们仍留在 rules 里供 CODEOWNERS 生成使用。
  @error  — 不抛异常给调用方；全部经退出码表达（Ctrl-tower 模式 1）
"""
from __future__ import annotations

import argparse
import fnmatch
import os
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
# YAML 子集解析器目录（默认仓内 scripts/product-lines）——SYNO_OWNERSHIP_YAML_MOD_DIR 仅供
# 测试把「合同形态沙箱夹具」做成自包含（不改语义；生产不设该变量，走默认仓内路径）。
YAML_MOD_DIR = os.environ.get("SYNO_OWNERSHIP_YAML_MOD_DIR") or str(REPO_ROOT / "scripts" / "product-lines")
CODEOWNERS_GLOB_FOR_CATCHALL = "*"  # ownership.yaml 的 "**" → CODEOWNERS 的 "*"（唯一一条生成期变换）

# D1029 冻结口径（改动须走 PR + K3）：claim 检查的凭据范围与路径
CLAIM_SCOPE_PATH = "docs/synova/coordination/ownership.yaml"
CLAIM_TOKEN_A = "创始人批准"
CLAIM_TOKEN_B = "ownership"

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
    mod_dir = Path(YAML_MOD_DIR)
    if not mod_dir.is_dir():
        _die("YAML 子集解析器目录不存在: %s" % mod_dir)
    sys.path.insert(0, str(mod_dir))
    try:
        import productline_yaml  # noqa: E402  (路径注入后才能导入)

        return productline_yaml
    except ImportError as e:
        _die("YAML 子集解析器不可用（%s）→ 无法校验归属" % e)


def load_ownership(yaml_path: Path):
    """读 ownership.yaml → (rules, github_owner_map, domain_neutral, payload)。

    @input  — yaml_path: ownership.yaml 路径
    @output — (rules: list[dict], github: dict, neutral: list[str], payload: dict)；
              rules 保持文件顺序（最后匹配者胜出）；neutral 缺省为空列表；
              payload 携带可选段（D1029: domain_defaults），供 domain_defaults_win() 校验
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
    return rules, github, [str(g) for g in neutral], data


def domain_defaults_win(payload):
    """取 ownership.yaml 的 `domain_defaults.win`（win 基线领地 glob 列表）。

    @input  — payload: load_ownership 返回的完整映射
    @output — list[str]: win 基线领地 glob（非空）
    @degraded — 缺 `domain_defaults` 段 / 缺 `win` 键 / 非列表 / 空列表 / 元素非字符串
                → exit 2（**结构非法**，fail-closed）。

    语义边界（勿与「未归属」混为一谈）: 缺段 = 载荷结构非法（exit 2，检查没法做）；
    路径命中不了基线领地 = 未归属（exit 1，业务阻断）。两者退出码不同。
    只在「做过归属判定 / claim 检查」时调用；`--emit-codeowners` 不调用（B 落地前后 drift 无关）。
    """
    if "domain_defaults" not in payload:
        _die("ownership.yaml 缺少 domain_defaults 段（结构非法）—— win 基线领地未声明，"
             "无法区分「基线领地」与「未归属」；请补 domain_defaults.win")
    dd = payload.get("domain_defaults")
    if not isinstance(dd, dict) or "win" not in dd:
        _die("ownership.yaml 的 domain_defaults 段必须含 win 键（结构非法）")
    win = dd.get("win")
    if not isinstance(win, list) or not win:
        _die("ownership.yaml 的 domain_defaults.win 必须是非空 glob 列表（结构非法）")
    out = []
    for g in win:
        if not isinstance(g, str) or not g.strip():
            _die("ownership.yaml 的 domain_defaults.win 元素必须是非空字符串 glob（结构非法）")
        out.append(g)
    return out


def is_catchall_rule(rule) -> bool:
    """兜底规则识别（**不写死路径/规则清单**）。

    @input  — rule: 单条规则映射
    @output — bool: `default: true`（语义标记，主判据）或 `glob == "**"`（形态，回退判据）
    @degraded — 无（纯函数）
    """
    if rule.get("default") is True:
        return True
    return str(rule.get("glob")) == "**"


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


def classify_path(rules, neutral, win_baseline, path: str):
    """D1029 归属解析（唯一语义定义）→ (owner, reason)。

    @input  — rules / neutral / win_baseline（见 load_ownership / domain_defaults_win）；
              path: 仓库相对路径
    @output — (owner|None, reason)：
              ("domain-neutral", "neutral")  命中豁免 · 不判域
              (owner, "explicit")            命中非兜底显式规则（最后匹配者胜出）
              ("win", "baseline")            仅命中兜底，且命中 win 基线领地
              (None, "unowned")              其余 ⇒ 调用方须 exit 1 点名
    @degraded — 无（纯函数；fail-closed 的载荷校验由 domain_defaults_win 负责）
    """
    if any(glob_match(g, path) for g in neutral):
        return "domain-neutral", "neutral"
    explicit = [r for r in rules if not is_catchall_rule(r)]
    owner = resolve_owner(explicit, path)
    if owner is not None:
        return owner, "explicit"
    catchalls = [r for r in rules if is_catchall_rule(r)]
    if not catchalls:
        return None, "unowned"                      # 兜底被删（反向验证用）
    if any(glob_match(g, path) for g in win_baseline):
        return str(catchalls[-1]["owner"]), "baseline"
    return None, "unowned"


def territory_globs(rule, rules, payload):
    """取兜底规则的「领地正面枚举」用于生成注释 —— **单一源优先、且只对兜底规则生效**。

    @input  — rule: 单条规则映射；rules: 全部规则；payload: 完整 ownership.yaml 映射
    @output — list[str]: win 基线领地 glob；该条不是兜底 / 两者皆无 → []（不输出该注释行，不崩）
    @degraded — 无（纯函数）。**不 exit 2**：`--emit-codeowners` 不得因缺 domain_defaults 而坏
                （D1029 裁决 3 ② / 追加 1）

    单一源口径（队长 2026-09-27 追加 1）: `domain_defaults.win` 是 win 领地的**唯一源**；
    规则内联 `territory:` 仅作回退（存量兼容，B 已删该重叠键）。
    注释只写在**兜底规则**那一行（D733 原语义: 兜底行的领地枚举可见），不复制到每条规则。
    """
    if not is_catchall_rule(rule):
        return []
    dd = payload.get("domain_defaults")
    if isinstance(dd, dict):
        win = dd.get("win")
        if isinstance(win, list) and win:
            return [str(t) for t in win]
    terr = rule.get("territory")
    if isinstance(terr, list) and terr:
        return [str(t) for t in terr]
    return []


def emit_codeowners(rules, github, payload=None) -> str:
    """由 ownership.yaml 生成 CODEOWNERS 全文（唯一生成期变换: "**" → "*"）。

    @input  — rules / github（见 load_ownership）；payload 用于领地注释单一源（缺省 → 只用规则内联 territory）
    @output — 文本（UTF-8，LF 结尾）
    @degraded — github 段缺 owner → 该行报错信息写入 stderr 并 exit 2（不产出半截文件）；
                **缺 domain_defaults 不报错**（生成器不读语义载荷，D1029 裁决 3 ②）
    """
    payload = payload if isinstance(payload, dict) else {}
    out = [
        "# .github/CODEOWNERS — 【生成产物，请勿手改】",
        "# 源: docs/synova/coordination/ownership.yaml（唯一权威；改那里再重跑下面的命令）",
        "# 生成: python3 scripts/control-tower/check-ownership.py --emit-codeowners > .github/CODEOWNERS",
        "# 漂移门禁: tests/control-tower/check-ownership.test.sh 逐字节断言本文件 == 生成结果（D733）",
        "# 语义: CODEOWNERS「最后匹配者胜出」→ 宽规则在前、例外在后（与 ownership.yaml 同序）。",
        "#",
        "# owner 账号体系待创始人定（2026-08-16 B1 落地）：当前全部指向主账号 @tangbaobao520",
        "# （兜底 = 创始人最终把关）。建议建三个团队 @synova-dsh / @synova-claude / @synova-k3，",
        "# 改 ownership.yaml 的 github: 段后重跑生成命令即可 —— 本文件不需要手改。",
        "",
    ]
    width = max(len(CODEOWNERS_GLOB_FOR_CATCHALL if r["glob"] == "**" else str(r["glob"])) for r in rules)
    width = max(width, 40)
    for r in rules:
        pattern = CODEOWNERS_GLOB_FOR_CATCHALL if r["glob"] == "**" else str(r["glob"])
        handle = github.get(str(r["owner"]))
        if not handle:
            _die("github 段缺少 owner「%s」的账号（规则 %s）" % (r["owner"], r["glob"]))
        territory = territory_globs(r, rules, payload)
        if territory:
            # 派单 §一.2「Win 域必须显式列出」：兜底行的领地正面枚举在产物里可见
            # （单一源 = domain_defaults.win；domain_defaults 未落地时回退规则内联 territory）
            out.append("# %s 领地（显式列出）: %s" % (r["owner"], "、".join(territory)))
        out.append("%-*s %s" % (width, pattern, handle))
    return "\n".join(out) + "\n"


def git_changed_files(ref: str):
    """`git diff --name-only REF` → 变更文件列表（仓库相对）。

    @input  — ref: git 引用（如 HEAD / origin/main）
    @output — list[str]（已归一；空列表合法 = 无变更）
    @degraded — git 不可用 / 非 git 仓库 / ref 不存在 → stderr 显式 ❌ + **exit 2**
                （取不到变更集 ⇒ 无权判定通行，绝不造成假绿）
    """
    if not (REPO_ROOT / ".git").exists():
        _die("不在 git 仓库内（%s 无 .git）—— 无法取变更集（--changed-from %s），fail-closed"
             % (REPO_ROOT, ref))
    try:
        proc = subprocess.run(
            ["git", "-c", "core.quotepath=false", "diff", "--name-only", ref],
            cwd=str(REPO_ROOT), capture_output=True, text=True,
        )
    except OSError as e:
        _die("git 不可用（%s）—— 无法取变更集（--changed-from %s），fail-closed" % (e, ref))
    if proc.returncode != 0:
        _die("git diff --name-only %s 失败（exit=%d）—— 取不到变更集，fail-closed，不得假绿: %s"
             % (ref, proc.returncode, (proc.stderr or "").strip()[:200]))
    out = []
    for line in (proc.stdout or "").splitlines():
        p = normalize(line)
        if p:
            out.append(p)
    return out


def has_claim_credential(text: str) -> bool:
    """PR 描述是否含创始人批准凭据（冻结口径：同一行含「创始人批准」且含 ownership，大小写不敏感）。

    @input  — text: PR 描述全文
    @output — bool
    @degraded — 无（纯函数）；空文本 = 无凭据（调用方 exit 1）
    """
    for line in (text or "").splitlines():
        low = line.lower()
        if CLAIM_TOKEN_A in line and CLAIM_TOKEN_B in low:
            return True
    return False


def read_pr_body(path_or_none):
    """读 PR 描述：--pr-body FILE 优先；未给则读 stdin。

    @input  — path_or_none: 文件路径或 None
    @output — str（描述全文）
    @degraded — 文件不存在 / stdin 是 TTY（交互等待无意义）→ exit 2（fail-closed，不静默当空）
    """
    if path_or_none:
        p = Path(path_or_none)
        if not p.is_file():
            _die("--pr-body 指定的文件不存在: %s" % p)
        return p.read_text(encoding="utf-8")
    if sys.stdin.isatty():
        _die("需要 PR 描述但未给 --pr-body 且 stdin 是终端 —— 请传 --pr-body <文件> 或管道输入")
    return sys.stdin.read()


def _print_credential_requirement() -> None:
    """claim 缺凭据时的「需要什么」说明（可复制）。"""
    print("❌ claim 检查失败: 变更集含 %s —— 改域名规则须创始人批准" % CLAIM_SCOPE_PATH)
    print("   需要: PR 描述里有一行**同时**含「%s」与「%s」（大小写不敏感）" % (CLAIM_TOKEN_A, CLAIM_TOKEN_B))
    print("   例如: ## %s —— 批准 D1029 修改 ownership 域名规则" % CLAIM_TOKEN_A)
    print("   复核命令: python3 scripts/control-tower/check-ownership.py --claim-check --pr-body <PR描述文件>")


def main(argv) -> int:
    ap = argparse.ArgumentParser(
        prog="check-ownership.py",
        description="模块域归属校验（D733/D1029）：越域/未归属/缺凭据 exit 1，检查执行失败 exit 2",
    )
    ap.add_argument("files", nargs="*", help="待校验文件（仓库相对路径）")
    ap.add_argument("--owner", choices=["mac", "win", "k3"], default=None, help="声明 owner；逐文件断言归属")
    ap.add_argument("--yaml", default=str(DEFAULT_YAML), help="ownership.yaml 路径")
    ap.add_argument("--emit-codeowners", action="store_true", help="生成 CODEOWNERS 全文到 stdout")
    ap.add_argument("--quiet", action="store_true", help="只输出结论行")
    ap.add_argument("--changed-from", dest="changed_from", default=None,
                    help="取变更集（git diff --name-only REF）并与位置参数取并集")
    ap.add_argument("--claim-check", dest="claim_check", action="store_true",
                    help="变更集含 ownership.yaml 时要求 PR 描述含创始人批准凭据")
    ap.add_argument("--pr-body", dest="pr_body", default=None, help="PR 描述文件（未给时读 stdin）")
    ap.add_argument("--parser-dir", dest="parser_dir", default=None,
                    help="YAML 子集解析器目录（默认仓内 scripts/product-lines；供自包含沙箱夹具使用）")
    args = ap.parse_args(argv)

    if args.parser_dir:
        global YAML_MOD_DIR
        YAML_MOD_DIR = args.parser_dir

    rules, github, neutral, payload = load_ownership(Path(args.yaml))

    # ── 生成模式: 不读 domain_defaults（裁决 3 ②），必须与 rules 无关地保持 drift 稳定 ──
    if args.emit_codeowners:
        sys.stdout.write(emit_codeowners(rules, github, payload))
        return EXIT_OK

    # 注: domain_defaults 的载荷校验放在 claim/变更集之后（下面），否则「git 取不到变更集」
    #     这类更早、更具体的失败会被「缺 domain_defaults」掩盖，误导排查方向。

    files = []
    seen = set()

    def _add(raw: str):
        p = normalize(raw)
        if p and p not in seen:
            seen.add(p)
            files.append(p)

    for raw in args.files:
        _add(raw)

    want_changeset = (args.changed_from is not None) or args.claim_check
    changed = []
    if want_changeset:
        ref = args.changed_from if args.changed_from is not None else "HEAD"
        changed = git_changed_files(ref)
        for p in changed:
            _add(p)

    # ── claim 检查（D1029）: 改域名规则须创始人批准凭据 ──
    if args.claim_check:
        if CLAIM_SCOPE_PATH in changed:
            if not has_claim_credential(read_pr_body(args.pr_body)):
                _print_credential_requirement()
                return EXIT_VIOLATION
            print("✅ claim 检查通过: 变更集含 %s 且 PR 描述含创始人批准凭据" % CLAIM_SCOPE_PATH)
        else:
            print("·   claim 检查跳过: 变更集（%s）不含 %s" % (args.changed_from or "HEAD", CLAIM_SCOPE_PATH))

    if not files:
        _die("未给出待校验文件（用法: check-ownership.py <文件...> [--owner mac|win|k3]）")

    # ── 归属判定才需要 win 基线领地（缺段 ⇒ exit 2 结构非法，与「未归属 exit 1」不混）──
    win_baseline = domain_defaults_win(payload)

    rows = []          # (path, owner, reason)
    violations = []    # (path, expected, actual)
    unowned = []
    neutral_rows = []
    for path in files:
        owner, reason = classify_path(rules, neutral, win_baseline, path)
        if reason == "neutral":
            neutral_rows.append(path)   # 域判定豁免：两种模式都不判域，只明示（各线都写的那一份）
            continue
        rows.append((path, owner, reason))
        if owner is None:
            unowned.append(path)
        elif args.owner is not None and owner != args.owner:
            violations.append((path, args.owner, owner))

    for path in neutral_rows:
        print("·   domain-neutral  %s" % path)
    if not rows and not neutral_rows:
        _die("待校验文件列表为空（全为空白路径）")

    if not args.quiet:
        for path, owner, reason in rows:
            if owner is not None:
                # 接口契约: 明细行 = "<owner>\t<path>[\t<注记>]" —— path 必须是**纯净**的第 2 个 TAB 字段
                # （消费方 scan-fullwidth-vars.sh 以 awk -F'\t' 取 $2 当路径；注记曾拼进 path 字段
                #   导致该消费者把整行余部当路径 ⇒ grep 报 "No such file or directory" ⇒ 正确 fail-closed 假红。D1029/task-6）
                mark = "(兜底→win 基线领地)" if reason == "baseline" else ""
                if mark:
                    print("%s\t%s\t%s" % (owner, path, mark))
                else:
                    print("%s\t%s" % (owner, path))
    for path in unowned:
        # 未归属逐条点名（quiet 模式下只出这一行 + 复核命令；不静默、不截断）
        print("⚠️  未归属  %s —— 请在 ownership.yaml 显式加规则（认领即改规则；同一 PR 内加规则即通过）"
              % path)
        print("    复核命令: python3 scripts/control-tower/check-ownership.py %s" % path)
    for path, expected, actual in violations:
        print("❌ 越域: %s —— 声明 owner=%s，实际 owner=%s" % (path, expected, actual))
    if rows and not args.quiet:
        print("")

    if args.owner is not None:
        if violations or unowned:
            if violations:
                print("❌ FAIL 越域 %d 处（声明 owner=%s）" % (len(violations), args.owner))
            if unowned:
                print("❌ FAIL 未归属 %d 处（声明 owner=%s；未归属不静默归 win）" % (len(unowned), args.owner))
            return EXIT_VIOLATION
        print("✅ PASS %d 个文件全部归属 owner=%s" % (len(rows), args.owner))
        return EXIT_OK

    # `unowned` 为空时 domains 可能覆盖多个域（即真跨域）；两者都要阻断，但分开点名（口径不许混）
    if unowned:
        print("❌ FAIL 未归属 %d 处 —— 未归属不静默归 win；请在 ownership.yaml 显式加规则"
              "（认领即改规则；同一 PR 内加规则即通过）（域判定豁免 %d）" % (len(unowned), len(neutral_rows)))
        return EXIT_VIOLATION
    domains = sorted({owner for _, owner, _ in rows if owner is not None})
    _suffix = "（域判定豁免 %d）" % len(neutral_rows)
    if len(domains) > 1:
        print("❌ FAIL 跨域: 变更落在 %d 个域 %s —— 单个 PR 只许一个域%s" % (len(domains), domains, _suffix))
        return EXIT_VIOLATION
    shown = domains[0] if domains else "无归属"
    print("✅ PASS %d 个文件同域: %s%s" % (len(rows), shown, _suffix))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
