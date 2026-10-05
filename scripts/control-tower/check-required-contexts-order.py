#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════════
# check-required-contexts-order.py — 必需 context 变更**顺序**检查（放宽允许先行 / 收紧必须等 PR 合并后）
#
# 背景（本器存在的唯一理由 —— K3 门禁治理波次审计 §三 防线缺口收割第 4 行）:
#   #1077（afde93eae）的 branch protection **先于 PR 被 PATCH 到 9**（12 → 9，windows 两腿离必需集），
#   而该 PR 尚未合并 —— K3 判为**顺序风险**：共享基础设施的**效果**在受审变更落地之前就已生效。
#   同族危险的另一半更贵：**加**必需 context（收紧）若先于「产出该 check-run 的 job 合并进 base」
#   执行，则**所有未含该 job 的在飞 PR 永远不上报该 check-run ⇒ 永久 blocked**
#   （D971 同型事故原文: 405 "N of N required status checks are expected."）。
#   此前**没有任何机器检查**这把方向性：既有 `check-required-contexts.py --api-check` 做的是
#   **双向**差集，两侧任一非空**都**判违规 ⇒ 它报得出"不一致"，报不出"这个不一致是不是允许的"
#   （放宽先行 = 合法的在途态，收紧紧等同 merge）。本器补的正是这一格。
#
# 判据（方向性，唯一的判定轴）:
#   记 L = live branch protection 的 required contexts（gh api 只读取数）
#      M = **base-ref（默认 origin/main）里的登记表** —— "main 当前的权威登记态"
#      C = 工作树里的登记表 —— "本候选将要做的变更"
#   ① **L ⊃ M**（live 要求了 M 里没有的 context）⇒ **VIOLATION（收紧先行）**
#      理由: 该 context 的产出 job 尚未随任何已合并变更进入 base ⇒ 未含它的在飞 PR 永不上报
#      ⇒ 永久 blocked。**必须等本分支合并后**再 PATCH live。
#   ② **L ⊆ M** ⇒ **OK**（含 L == M）。live 少掉的每一条 = 移除必需 = **永不阻断**（放宽允许先行），
#      逐条点名但**不判违规**。这与 ① 的不对称是**刻意的**：移除必需只会让门禁变松（可回滚、不卡人），
#      增加必需会让在飞 PR 卡死（且只能靠人工 PATCH 解）。
#   ③ C 与 M 的差集**信息级**（本候选在做什么）: C∖M = 收紧（须等 merge 后再 PATCH）、M∖C = 放宽（可先行）。
#      不在 C 上判违规 —— C 是"意图"，L 是"事实"；判事实。
#
# 契约（铁律 47；头注释必须写全 @input/@output/@exit/@degraded）:
#   @input    --root <dir>        仓库根（默认 = 本脚本上两级）；也是候选登记表与 git refs 的解析根
#             --baseline <file>   候选登记表（默认 <root>/scripts/control-tower/required-checks-baseline.txt）
#             --baseline-path <p> 登记表在仓库内的相对路径（默认 scripts/control-tower/required-checks-baseline.txt；
#                                 `--base-ref` 侧的登记表按此路径取出）
#             --base-ref <ref>    权威登记态来源 git ref（默认 origin/main）
#             --repo <owner/repo> branch protection 所属仓（默认 synova-agent/SynovaAgent）
#             --branch <branch>   （默认 main）
#             --verbose           打印 live / M / C 三份逐条清单（判定不变）
#             --help              用法
#             注入缝（沿用既有器同名缝，仅测试）: SYNO_REQUIRED_CONTEXTS_GH=<gh 可执行文件路径>（默认 "gh"）
#   @output   人类可读三段（取数口径 / 方向性判定 / 本候选将做的变更）+ 末行固定三态之一:
#               `REQUIRED-CONTEXTS-ORDER: OK | VIOLATION(n) | DEGRADED`
#   @exit     0=顺序合法（一致或仅放宽）；1=违规（收紧先行，逐条点名）；2=执行失败/降级（fail-closed）
#             **2 绝不等于通过**。
#   @degraded gh 不可用/未登录/超时/JSON 形状不符、`--base-ref` 不可解析或该 ref 无登记表、
#             登记表不可读/0 条/畸形、复用面（peer 脚本）缺失或加载失败
#             → stderr 一行 `degraded: <原因>` + 末行 `DEGRADED` + exit 2。
#             不写 degraded-events.log（本器可能在只读树上运行；降级信号由调用方捕获，同 peer 口径）。
#
# 只读保证（红线）: 本器**只**调用 gh api 的 GET（经 peer 的 fetch_live_contexts）+ `git show` + 读文件。
#   无任何写保护规则调用（无 --method/-X，无 PATCH/PUT/POST/DELETE），不改任何 job `name:`、
#   不改登记表、不改 branch protection。**branch protection 的变更权限不在本线**（红线）。
#
# 复用面（不重造）: live 取数（含 gh 缺失/超时/形状不符的降级语义）、登记表解析（schema/畸形即降级）、
#   双向差集原语，全部 import 自同目录 `check-required-contexts.py`（按路径加载，**不复制实现**）。
#   ⚠️ 依赖面（peer 若改名/改签名，本器加载失败 ⇒ exit 2 fail-closed，不会静默判绿）。
#   ⚠️ 刻意**不提供** `--allow-degraded`: live 是本器**唯一**判定输入，取数不可用即"无法判定"
#   （不是"静态面仍可判"）⇒ 给旗标只会造出"免检开关"（D1111/收件修正口径: 旗标不得吞违规）。
#   CI 侧若要周期化本检查，须用带 admin 权限的 PAT 通道（不是 github.token），另立卡。
#
# 已知边界（诚实声明，非违规）:
#   · 只读 `required_status_checks.contexts` 的存在性，**不读 app_id/checks 绑定**（同 peer）。
#   · 不判"必需 context 的产出 job 是否有 job 级 `if:`/`paths:` 过滤"（D971 另一半，peer 头注释同款 TODO）。
#   · `--base-ref` 只取**登记表**（登记态），不取 base 的 ci.yml 产出集 —— "live ⊆ base 产出集" 由 peer 承担。
#   · L ⊃ M 时本器**只报不改**（PATCH 权限不在本线）。
#
# 反例意识（判别性由 tests/control-tower/check-required-contexts-order.test.sh 承担）:
#   放宽在途（L ⊂ M）⇒ 必 **0**（不是 1 —— 本器与 peer 双向判据的差异点，夹具①）；
#   收紧先行（L ⊃ M）⇒ 必 **1** 且逐条点名（夹具②）；gh 不可用 / base-ref 缺失 ⇒ 必 **2**（夹具④⑤）。
#
# 启动方式（双语法首行，兼容 `bash <本文件>` 与 `python3 <本文件>`）:
#   · `python3 check-required-contexts-order.py …`（生产/CI 路径；Windows: python/py 亦可）
#   · `bash check-required-contexts-order.py …`（等价；sh 侧 exec 到 python3/python/py）
# ═══════════════════════════════════════════════════════════════════════════════
# 双语法行: sh 读作命令（exec 换 python）；python 读作相邻字符串字面量（无副作用空语句）
"exec" "sh" "-c" 'for p in python3 python py; do command -v "$p" >/dev/null 2>&1 || continue; exec "$p" "$0" "$@"; done; printf "degraded: python 不可用（python3/python/py 均不可用）\n" >&2; exit 2' "$0" "$@"   # PYBIN 三级探测（python3→python→py，禁裸 python3；PLATFORM-CHECKLIST #1）

"""必需 context 变更顺序检查（放宽允许先行 / 收紧必须等 PR 合并后）。契约全文见文件头注释块。"""

import argparse
import importlib.util
import os
import subprocess
import sys
import tempfile

VERSION = "1.0.0"

EXIT_OK = 0
EXIT_VIOLATION = 1
EXIT_DEGRADED = 2

DEFAULT_REPO = "synova-agent/SynovaAgent"
DEFAULT_BRANCH = "main"
DEFAULT_BASE_REF = "origin/main"
BASELINE_REL = "scripts/control-tower/required-checks-baseline.txt"
PEER_NAME = "check-required-contexts.py"

# 复用面出处（实例引用，写进输出，便于审计核对）
ISSUE_ANCHOR = "#1077（afde93eae）—— branch protection 先行 PATCH 到 9 而 PR 未合并"

# UTF-8 强制（D313 M5）: Windows 控制台默认 GBK → 中文 context 名逐字断言必乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")   # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")   # type: ignore[attr-defined]
except (AttributeError, ValueError):
    pass


_PEER = None   # 复用面模块（load_peer 装载）；main() 需要它的 Degrade 类型来兜住 peer 抛出的降级


class Degrade(Exception):
    """执行失败 / 降级（fail-closed）——main() 统一转成 stderr `degraded:` + exit 2。"""

    def __init__(self, reason):
        Exception.__init__(self, reason)
        self.reason = reason


def _degrade_types():
    """本器 Degrade ∪ peer Degrade —— peer 的 read_baseline/fetch_live_contexts 抛**它自己的** Degrade 类，
    必须一并兜住（否则降级会以未捕获异常形式漏出 ⇒ 退出码 1 而非 2，与三态契约不符）。"""
    types = [Degrade]
    if _PEER is not None and isinstance(getattr(_PEER, "Degrade", None), type):
        types.append(_PEER.Degrade)
    return tuple(types)


# ═══ 复用面：按路径加载同目录 peer（不复制实现）════════════════════════════════

def script_dir():
    return os.path.dirname(os.path.abspath(__file__))


def load_peer(root):
    """加载 `check-required-contexts.py` 并返回模块（复用 live 取数 / 登记表解析 / 差集原语）。"""
    global _PEER
    candidates = [
        os.path.join(script_dir(), PEER_NAME),                              # 生产: 同目录
        os.path.join(root, "scripts", "control-tower", PEER_NAME),          # 兜底: 调用方给的 root
    ]
    path = None
    for cand in candidates:
        if os.path.isfile(cand):
            path = cand
            break
    if path is None:
        raise Degrade("复用面缺失: %s 不在 %s（不复制实现、不猜语义 ⇒ fail-closed）"
                      % (PEER_NAME, " / ".join(candidates)))
    try:
        spec = importlib.util.spec_from_file_location("synova_required_contexts_peer", path)
        if spec is None or spec.loader is None:
            raise Degrade("复用面加载失败（spec 为空）: %s" % path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Degrade:
        raise
    except Exception as exc:                                    # noqa: BLE001 —— 任何加载异常都 fail-closed
        raise Degrade("复用面加载失败: %s（%s: %s）" % (path, type(exc).__name__, exc))
    for attr in ("fetch_live_contexts", "read_baseline", "diff_lists", "Degrade"):
        if not hasattr(mod, attr):
            raise Degrade("复用面缺接口 %s（%s）——peer 变更 ⇒ fail-closed 不静默判绿" % (attr, path))
    _PEER = mod
    return mod


# ═══ 取数 ════════════════════════════════════════════════════════════════════

def baseline_names(peer, path):
    """读登记表 → context 名列表（解析失败由 peer 抛 Degrade）。"""
    entries = peer.read_baseline(path)
    return [e.name for e in entries]


def baseline_from_ref(peer, root, ref, rel):
    """`git -C <root> show <ref>:<rel>` → 临时文件 → 按 peer 口径解析 → 名列表。"""
    cmd = ["git", "-C", root, "show", "%s:%s" % (ref, rel)]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    except OSError as exc:
        raise Degrade("git 不可用（%s）——无法读 %s 侧登记表，fail-closed" % (exc, ref))
    except subprocess.TimeoutExpired:
        raise Degrade("git show 超时（30s）: %s —— fail-closed" % " ".join(cmd))
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", "replace").strip()
        raise Degrade("%s 侧登记表取不到（git show rc=%d）: %s ——%s（未合并分支/无该 ref ⇒ 无法判定，fail-closed）"
                      % (ref, proc.returncode, " ".join(cmd), err[:300] or "无 stderr"))
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(prefix="d1159-baseline-", suffix=".txt")
        with os.fdopen(fd, "wb") as fh:
            fh.write(proc.stdout)
        return baseline_names(peer, tmp)
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


# ═══ 主流程 ═════════════════════════════════════════════════════════════════

def build_parser():
    parser = argparse.ArgumentParser(
        prog="check-required-contexts-order.py",
        description="必需 context 变更顺序检查（放宽允许先行 / 收紧必须等 PR 合并后）——0=合法 / 1=收紧先行 / 2=降级",
        add_help=True,
        allow_abbrev=False,
    )
    here = script_dir()
    parser.add_argument("--root", default=os.path.dirname(os.path.dirname(here)), help="仓库根（默认 = 本脚本上两级）")
    parser.add_argument("--baseline", default=None, help="候选登记表（默认 <root>/" + BASELINE_REL + "）")
    parser.add_argument("--baseline-path", default=BASELINE_REL, help="登记表在仓库内的相对路径（默认 " + BASELINE_REL + "）")
    parser.add_argument("--base-ref", default=DEFAULT_BASE_REF, help="权威登记态来源 git ref（默认 " + DEFAULT_BASE_REF + "）")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="branch protection 所属仓（默认 " + DEFAULT_REPO + "）")
    parser.add_argument("--branch", default=DEFAULT_BRANCH, help="（默认 " + DEFAULT_BRANCH + "）")
    parser.add_argument("--verbose", action="store_true", help="打印 live / base-ref / 候选 三份逐条清单（判定不变）")
    parser.add_argument("--version", action="version", version="check-required-contexts-order.py " + VERSION)
    return parser


def run(args):
    root = os.path.abspath(args.root)
    peer = load_peer(root)

    cand_path = args.baseline or os.path.join(root, args.baseline_path)

    # live（唯一判定输入；取数不可用 ⇒ Degrade ⇒ exit 2）
    live, _data = peer.fetch_live_contexts(args.repo, args.branch)
    main_names = baseline_from_ref(peer, root, args.base_ref, args.baseline_path)
    cand_names = baseline_names(peer, cand_path)

    live_only, base_only = peer.diff_lists(live, main_names)      # live∖M（收紧先行候选）, M∖live（放宽）
    cand_add, cand_rem = peer.diff_lists(cand_names, main_names)  # 本候选将新增登记 / 移除登记

    print("REQUIRED-CONTEXTS-ORDER: root=%s base_ref=%s baseline=%s repo=%s branch=%s"
          % (root, args.base_ref, cand_path, args.repo, args.branch))
    print("取数: live=%d 条（gh api repos/%s/branches/%s/protection，只读 GET）｜%s 登记表=%d 条｜候选登记表=%d 条"
          % (len(live), args.repo, args.branch, args.base_ref, len(main_names), len(cand_names)))

    if args.verbose:
        for label, names in (("live", live), (args.base_ref, main_names), ("候选", cand_names)):
            print("── [%s] %d 条 ──" % (label, len(names)))
            for name in names:
                print("  %s" % name)

    print("── 方向性判定: live ⇄ %s 登记表（本器唯一判定轴）──" % args.base_ref)
    if live_only:
        for name in live_only:
            print("  🔴 收紧先行: live 已要求「%s」，但 %s 登记表里没有它" % (name, args.base_ref))
    if base_only:
        for name in base_only:
            print("  🟢 放宽在途（合法）: live 已不再要求「%s」（%s 登记表仍有，属放宽先行）" % (name, args.base_ref))
    if not live_only and not base_only:
        print("  OK: live 与 %s 登记表逐字一致（%d 条，零差集）" % (args.base_ref, len(live)))

    print("── 本候选（工作树 vs %s 登记表）将要做的事（信息级，不在 C 上判违规）──" % args.base_ref)
    if cand_add:
        for name in cand_add:
            print("  + 收紧登记: %s —— ⚠️ 必须先合并本分支（产出该 check-run 的 job 进 base），**再** PATCH live"
                  % name)
    if cand_rem:
        for name in cand_rem:
            print("  - 放宽登记: %s —— 可先行 PATCH live（移除必需永不阻断）" % name)
    if not cand_add and not cand_rem:
        print("  （本候选不改登记表）")

    print("── 引用 ──")
    print("  顺序风险实例: %s" % ISSUE_ANCHOR)
    print("  相邻检查: scripts/control-tower/%s（必需集 ⊆ 可产出集；live ⇄ 登记表双向）" % PEER_NAME)
    print("  本器只报不改: branch protection 的变更权限不在本线（红线）")

    violations = []
    for name in live_only:
        violations.append(
            "收紧先行: live 必需 context「%s」不在 %s 登记表里 —— 产出它的 job 尚未随已合并变更进 base，"
            "未含该 job 的在飞 PR 永不上报该 check-run ⇒ 永久 blocked（D971 同型 405）。"
            "处置: 先把产出该 check-run 的变更合并进 %s（并同 PR 更新登记表），**再** PATCH live。"
            % (name, args.base_ref, args.base_ref)
        )
    for msg in violations:
        print("VIOLATION: %s" % msg)
    if violations:
        print("REQUIRED-CONTEXTS-ORDER: VIOLATION(%d)" % len(violations))
        return EXIT_VIOLATION
    print("REQUIRED-CONTEXTS-ORDER: OK")
    return EXIT_OK


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except _degrade_types() as exc:                       # 本器 + peer 的降级一并兜（三态契约: 降级恒 2）
        sys.stderr.write("degraded: %s\n" % getattr(exc, "reason", str(exc)))
        print("REQUIRED-CONTEXTS-ORDER: DEGRADED")
        return EXIT_DEGRADED


if __name__ == "__main__":
    sys.exit(main())
