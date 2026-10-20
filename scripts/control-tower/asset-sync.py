#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
asset-sync.py —— #776 资产同步器（Gitea 里程碑 ASSET-AUTO 段／#769 资产地图自动维护）

设计哲学：数字只从命令实测来（total 恒取 ls-tree），写入只碰受保护段（段外逐字节不变），
          不认识的路径不猜归属（进「待归类」桶，只上报不裁决）。

授权（explicit authority）：CTO 裁 277（2026-10-21）——一次真跑，限「只改 M1–M10 的
ASSET-AUTO 段 ＋ #769；不建卡」。本脚本默认即按该限段执行；开卡与 A/X 不在默认写面内。

契约（铁律 47）：
  输入：--prev <sha>（缺省 HEAD^）｜--new <sha>（缺省 HEAD）｜--dry-run｜--rebuild-769
        ｜--open-x-cards（默认关）｜--root <path>（缺省 `.`，必须是 git 仓库根——所有 git 调用走
        `git -C <root>`，禁靠 cwd 认树：误树会让 total 静默算错而恒等式仍自洽）
        ｜--map <path>（缺省 <root>/docs/authority/ASSET-MAP.yaml）
        环境：SYNO_PUSH_GITEA_API（缺省 http://127.0.0.1:3000/api/v1，复用 mirror-sync-push.sh 约定）
              SYNO_PUSH_GITEA_REPO（缺省 synova-agent/SynovaAgent）
              SYNO_PUSH_GITEA_TOKEN_FILE（缺省 /Users/wane/gitea/.win-push-token，仅写路径读）
        运行前提：cwd = git 仓库根（ls-tree 实测分母）。
  输出：stdout 每 diff 文件一行 `DRY|SYNC <path> -> <module|待归类(报警,不进X)>`
        ＋ `MOD <module> files=<n>` ＋ `UNKNOWN_TOP ...`（按首路径段聚合）
        ＋ `SUMMARY mapped=N unknown=M x=K total=T`
        ＋ `TREE new=<new 解析后的 full sha> total=<n>`（证据核树用，禁以短 sha/cwd 推断）
        ＋ dry-run 终行 `DRY-RUN: 未联网、未写里程碑、未开卡（判据 5）`｜真跑终行 `CHANGED <n>`
  退出码（三态）：0 成功／dry-run 计划 ｜ 1 真红（业务阻断）｜ 2 环境降级（不写、不猜）
  错误码表（typed error：stderr 一行，前缀 `真红:`/`degraded:` ＋ `code=XXX`）：
    1 MAP_UNREADABLE       MAP 读不到
    1 MAP_PARSE_ERROR      MAP 结构非法（顶层键／条目／match 规则）
    1 MAP_MISSING_FIELD    MAP 条目缺 glob/module/owner/state
    1 MAP_CATCH_ALL        MAP 含 catch-all glob（`**`／裸 `*`／覆盖仓根）——判据 2
    1 MAP_UNKNOWN_MODULE   条目模块既不在 required_modules 也非 X
    1 MAP_MISSING_MODULE   required_modules 声明的模块无任何条目——判据 2 bootstrap
    1 IDENTITY_VIOLATION   mapped+unknown+x != ls-tree total——判据 1
    1 SEGMENT_LEAK         段外字节将被改动／#769 既有 body 非严格前缀（判据 4）
    1 API_REJECTED         Gitea API 明确拒绝（HTTP 4xx）
    2 MAP_EMPTY            MAP 信号量==0（禁把看不见当没问题）
    2 MILESTONE_MISSING    required_modules 声明的里程碑不存在（限段写面无目标）
    2 NO_MARKER            里程碑描述缺 ASSET-AUTO 双标记／#769 标记不完整（判据 8a）
    2 TOKEN_UNREADABLE     token 文件不可读或为空（零请求）
    2 API_UNREACHABLE      API 连接失败／超时／5xx
    2 API_BAD_RESPONSE     API 返回非 JSON／形态不符
    2 BAD_ROOT             --root 不存在／不是 git 仓库（禁在误树上静默算数）
    2 GIT_FAILED           git 命令失败
    2 WRITE_FAILED         写失败（附 `degraded: true` 行）
  降级（铁律 11）：任何网络／写失败 ⇒ 打 `degraded: true` 行 ＋ exit 2，禁静默吞。
  幂等（判据 4）：段内容 = --prev/--new/实测计数的纯函数；仅内容变化才 PATCH；
                  二跑 changed=0 且 description/body 字节不变。
  段外逐字节保护：替换后用纯函数断言「段外前缀+后缀」与原文逐字节相同，不成立 ⇒ exit 1。
  #769：body 已含双标记 ⇒ 只替换段内；不含 ⇒ 仅在文末追加一个段
        （既有 body 必须成为严格前缀，一字不改）。
  已知限制：
   · 限段（裁 277）：只写 `^M(\\d+)\\s` 里程碑的 ASSET-AUTO 段 ＋ #769；A/X 里程碑不写。
   · 默认不开卡：未知一律进「待归类」桶＋#769；--open-x-cards 仅作判据 6/8b 能力验证开关。
   · 不补 issue 标签（规格判据 7 未实现，归后续卡）；不关闭任何验收卡（判据 9）。
   · ASSET-MAP 为手工维护数据件（bootstrap 需人工确认一次），条目顺序敏感（match: first）。
   · glob 语义 = fnmatch（`*` 跨 `/`），不支持 `{}`/`[]` 之外的扩展语法。
   · 标签：开卡不带 labels（禁硬编码 label id）；需要时由调用方补。
  测试：tests/control-tower/asset-sync.test.sh（T1–T11，本地 127.0.0.1 假 Gitea，不联网出本机）。
"""
import argparse
import fnmatch
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

try:  # windows-compat（D732）：UTF-8 强制，Windows GBK 控制台兜底
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

BEGIN = "<!-- ASSET-AUTO:BEGIN -->"
END = "<!-- ASSET-AUTO:END -->"
# 判据 2：覆盖仓根的 glob 一律视为 catch-all（只有它们能让恒等式恒真）
CATCH_ALL = ("", "*", "**", "**/*", "*/**", "*/*", "./**", "/**")
MILESTONE_RE = re.compile(r"^M(\d+)\s")
CARD_TITLE = "[ASSET] X · 未归类资产聚合卡（自动维护·永不关闭）"
TOP_N = 10
HTTP_TIMEOUT = 20
ROOT = "."  # 由 --root 设定（git -C 的唯一锚点）


def die(exit_code, code, msg):
    """typed error：三态退出码 ＋ code=XXX（禁静默吞、禁裸 exit）。"""
    print(f"{'真红' if exit_code == 1 else 'degraded'}: code={code} {msg}", file=sys.stderr)
    sys.exit(exit_code)


# ══════════════════════════════════════════════════════════════════════════════
# ASSET-MAP 载入与校验（stdlib 受限 YAML 子集；数据全在 MAP，脚本禁模块字面量清单）
# ══════════════════════════════════════════════════════════════════════════════
def is_catch_all(glob):
    g = glob.strip()
    return g in CATCH_ALL or g.rstrip("/") in ("*", "**")


def load_map(path):
    """解析 ASSET-MAP.yaml → {entries:[(glob,module,owner,state)], required:[module], rule, as_of}。

    解析/语义失败一律 typed error：结构类 exit 1；信号量==0 exit 2（禁把看不见当没问题）。
    """
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        die(1, "MAP_UNREADABLE", f"MAP 不可读 {path}: {e}")
    entries, required, rule, as_of, section, cur = [], [], "first", None, None, None
    for ln, line in enumerate(text.splitlines(), 1):
        s = line.split("#", 1)[0].rstrip()
        if not s.strip():
            continue
        body = s.strip()
        if not s[:1].isspace():  # 顶层键
            m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", body)
            if not m:
                die(1, "MAP_PARSE_ERROR", f"MAP 非法顶层行 L{ln}: {body}")
            section, cur = m.group(1), None
            val = m.group(2).strip().strip('"')
            if section == "match":
                rule = val or "first"
            elif section == "as_of":
                as_of = val
            continue
        if section == "required_modules":
            m = re.match(r"^-\s*(\S+)$", body)
            if not m:
                die(1, "MAP_PARSE_ERROR", f"required_modules 非法条目 L{ln}: {body}")
            required.append(m.group(1))
            continue
        if section == "entries":
            m = re.match(r'^-\s*glob:\s*"?([^"]+?)"?$', body)
            if m:
                cur = {"glob": m.group(1)}
                entries.append(cur)
                continue
            m = re.match(r'^(glob|module|owner|state):\s*"?([^"]+?)"?$', body)
            if m and cur is not None:
                cur[m.group(1)] = m.group(2)
                continue
            die(1, "MAP_PARSE_ERROR", f"MAP 非法条目 L{ln}: {body}")
        # 其余段的缩进行（说明文字）不参与解析
    if rule != "first":
        die(1, "MAP_PARSE_ERROR", f"不支持 match 规则「{rule}」（仅 first）")
    if not entries:
        die(2, "MAP_EMPTY", "MAP 信号量==0（无条目 ⇒ 禁把看不见当没问题）")
    clean = []
    for i, e in enumerate(entries):
        missing = [k for k in ("glob", "module", "owner", "state") if k not in e]
        if missing:
            die(1, "MAP_MISSING_FIELD", f"MAP 条目 #{i + 1} 缺字段 {','.join(missing)}: {e}")
        clean.append((e["glob"], e["module"], e["owner"], e["state"]))
    for i, (g, _mod, _owner, _state) in enumerate(clean):
        if is_catch_all(g):
            die(1, "MAP_CATCH_ALL", f"MAP 含 catch-all glob「{g}」（判据 2，条目 #{i + 1}）")
    if not required:
        die(1, "MAP_MISSING_MODULE", "MAP 缺顶层 required_modules 列表（禁脚本内硬编码模块清单）")
    mods = {mod for _g, mod, _o, _s in clean}
    allowed = set(required) | {"X"}
    for mod in sorted(mods - allowed):
        die(1, "MAP_UNKNOWN_MODULE", f"MAP 条目模块 {mod} 未在 required_modules 也非 X")
    for mod in required:
        if mod not in mods:
            die(1, "MAP_MISSING_MODULE", f"MAP 缺 {mod} 种子条目（required_modules 声明必填，判据 2）")
    return {"entries": clean, "required": required, "rule": rule, "as_of": as_of}


def classify(entries, path):
    """有序首中（match: first）；返回 module 或 None（待归类桶，不猜）。"""
    for glob, mod, _owner, _state in entries:
        if fnmatch.fnmatch(path, glob):
            return mod
    return None


def top_roots(paths, n=TOP_N):
    """未知路径按「首路径段」聚合计数，降序取前 n（同数按字典序，保证幂等）。"""
    counts = {}
    for p in paths:
        root = p.split("/", 1)[0] + "/" if "/" in p else p
        counts[root] = counts.get(root, 0) + 1
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


# ══════════════════════════════════════════════════════════════════════════════
# 段内容（纯函数）：段外逐字节保护 ＋ 幂等的唯一实现点
# ══════════════════════════════════════════════════════════════════════════════
def segment_parts(text):
    """按 ASSET-AUTO 双标记切段 → (段外前缀, 段外后缀)；缺失/重复/顺序错 ⇒ None（不猜）。"""
    if text.count(BEGIN) != 1 or text.count(END) != 1:
        return None
    i = text.index(BEGIN)
    j = text.index(END)
    if i > j:
        return None
    return text[:i], text[j + len(END):]


def outside(text):
    """段外文本（用于逐字节比对）；标记不完整 ⇒ None。"""
    parts = segment_parts(text)
    return None if parts is None else parts[0] + parts[1]


def replace_segment(text, content):
    """纯函数：替换 BEGIN..END 之间内容；段外逐字节不变。返回 (new, None)／(None, "no-marker")。"""
    parts = segment_parts(text)
    if parts is None:
        return None, "no-marker"
    pre, post = parts
    return pre + BEGIN + "\n" + content + "\n" + END + post, None


def milestone_line(mod, n, unknown, xcnt, sha7):
    """里程碑段内容（裁 259：≤2 行 ⇒ 本函数恒 1 行）。"""
    return f"实现覆盖 {n} 文件｜待归类 {unknown}｜X 非 MVP {xcnt}（自动·as_of {sha7}，全量见 #769）"


def issue769_segment(mapped, unknown, xcnt, sha7, roots):
    """#769 段内容两行：恒等式实数＋as_of ／ 待归类 top roots（前 10）。"""
    line1 = (f"实现覆盖 {mapped} 文件｜待归类 {unknown}｜X 非 MVP {xcnt}"
             f"（自动·as_of {sha7}，全量见本条 #769）")
    joined = " ｜ ".join(f"`{root}` {n}" for root, n in roots) if roots else "（无）"
    return line1 + "\n" + f"待归类 top roots（前 10）：{joined}"


# ══════════════════════════════════════════════════════════════════════════════
# git 实测（total 的唯一来源）
# ══════════════════════════════════════════════════════════════════════════════
def validate_root(root):
    """--root 必须是存在的 git 仓库根；否则 exit 2（误树 ⇒ 静默算错，宁停不猜）。"""
    if not os.path.isdir(root):
        die(2, "BAD_ROOT", f"--root 不存在或不是目录: {root}（禁在误树上算数）")
    try:
        r = subprocess.run(["git", "-C", root, "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True, encoding="utf-8")
    except OSError as e:
        die(2, "GIT_FAILED", f"git 不可执行: {e}")
    if r.returncode != 0 or not (r.stdout or "").strip():
        die(2, "BAD_ROOT", f"--root 不是 git 仓库: {root}")
    return os.path.abspath(root)


def git(*args):
    """所有 git 调用都锚 --root（禁靠 cwd 认树）。"""
    try:
        r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True,
                           encoding="utf-8")
    except OSError as e:
        die(2, "GIT_FAILED", f"git 不可执行: {e}")
    if r.returncode != 0:
        die(2, "GIT_FAILED", f"git -C {ROOT} {' '.join(args)} 失败: {(r.stderr or '').strip()[:200]}")
    return r.stdout


def tree_files(ref):
    return [p for p in git("ls-tree", "-r", "--name-only", "-z", ref).split("\0") if p]


def diff_files(prev, new):
    return [p for p in git("diff", "--name-only", prev, new).splitlines() if p]


# ══════════════════════════════════════════════════════════════════════════════
# Gitea API（token 先读后连 ⇒ token 不可读时零请求）
# ══════════════════════════════════════════════════════════════════════════════
class Api:
    """最小 Gitea 客户端。构造即读 token（失败 ⇒ exit 2 且零请求）。"""

    def __init__(self):
        self.base = os.environ.get(
            "SYNO_PUSH_GITEA_API", "http://127.0.0.1:3000/api/v1").rstrip("/")
        self.repo = os.environ.get("SYNO_PUSH_GITEA_REPO", "synova-agent/SynovaAgent")
        token_file = os.environ.get(
            "SYNO_PUSH_GITEA_TOKEN_FILE", "/Users/wane/gitea/.win-push-token")
        try:
            with open(token_file, encoding="utf-8") as f:
                self.token = f.read().strip()
        except OSError as e:
            die(2, "TOKEN_UNREADABLE", f"token 不可读 {token_file}: {e}（零请求）")
        if not self.token:
            die(2, "TOKEN_UNREADABLE", f"token 文件为空 {token_file}（零请求）")

    def call(self, method, path, body=None):
        url = f"{self.base}/repos/{self.repo}/{path}"
        data = (json.dumps(body, ensure_ascii=False).encode("utf-8")
                if body is not None else None)
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={"Authorization": f"token {self.token}",
                     "Content-Type": "application/json",
                     "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read()[:200].decode("utf-8", "replace")
            except OSError:
                detail = ""
            if 400 <= e.code < 500:
                die(1, "API_REJECTED", f"Gitea {method} {path} 被拒绝 HTTP {e.code} {detail}")
            die(2, "API_UNREACHABLE", f"Gitea {method} {path} 服务端错误 HTTP {e.code} {detail}")
        except (urllib.error.URLError, OSError) as e:  # 含 socket.timeout
            die(2, "API_UNREACHABLE", f"Gitea {method} {path} 不可达/超时: {e}")
        try:
            return json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            die(2, "API_BAD_RESPONSE", f"Gitea {method} {path} 返回非 JSON")


# ══════════════════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser(description="#776 资产同步器（见文件头契约块）")
    ap.add_argument("--prev", default="HEAD^")
    ap.add_argument("--new", default="HEAD")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--rebuild-769", action="store_true")
    ap.add_argument("--open-x-cards", action="store_true")
    ap.add_argument("--root", default=".")
    ap.add_argument("--map", default=None)
    a = ap.parse_args()

    global ROOT
    ROOT = validate_root(a.root)
    map_path = a.map or os.path.join(ROOT, "docs", "authority", "ASSET-MAP.yaml")
    amap = load_map(map_path)
    files = tree_files(a.new)
    total = len(files)
    full_sha = git("rev-parse", a.new).strip()
    sha7 = full_sha[:7]

    mapped = unknown = xcnt = 0
    per_mod, unknown_paths = {}, []
    for f in files:
        mod = classify(amap["entries"], f)
        if mod is None:
            unknown += 1
            unknown_paths.append(f)
        elif mod == "X":
            xcnt += 1
        else:
            mapped += 1
            per_mod[mod] = per_mod.get(mod, 0) + 1

    # 判据 1：覆盖恒等式（三分类结构 ⇒ 必须等于 ls-tree 实测；total 禁取 MAP 条目数）
    if mapped + unknown + xcnt != total:
        die(1, "IDENTITY_VIOLATION",
            f"恒等式不成立 mapped({mapped})+unknown({unknown})+x({xcnt}) != total({total})")

    for f in diff_files(a.prev, a.new):
        mod = classify(amap["entries"], f)
        print(f"{'DRY' if a.dry_run else 'SYNC'} {f} -> {mod or '待归类(报警,不进X)'}")
    for mod in sorted(per_mod):
        print(f"MOD {mod} files={per_mod[mod]}")
    roots = top_roots(unknown_paths)
    print("UNKNOWN_TOP " + (" ｜ ".join(f"`{r}` {n}" for r, n in roots) if roots else "（无）"))
    print(f"SUMMARY mapped={mapped} unknown={unknown} x={xcnt} total={total}")
    print(f"TREE new={full_sha} total={total}")

    if a.dry_run:  # 判据 5：dry-run 零网络（此处之前不得有任何 HTTP）
        print("DRY-RUN: 未联网、未写里程碑、未开卡（判据 5）")
        return

    api = Api()  # token 不可读 ⇒ exit 2，零请求
    changed = 0

    # ── 原子前置（判据 8a）：先全查「里程碑存在 + 双标记 + 段外保护」，任一不成立 ⇒ 零 PATCH ──
    milestones = api.call("GET", "milestones?state=open&limit=50")
    if not isinstance(milestones, list):
        die(2, "API_BAD_RESPONSE", "GET milestones 返回非数组")
    by_mod = {}
    for m in milestones:
        mm = MILESTONE_RE.match(m.get("title") or "")
        if mm:
            by_mod.setdefault("M" + mm.group(1), m)
    plan = []
    for mod in amap["required"]:
        ms = by_mod.get(mod)
        if ms is None:
            die(2, "MILESTONE_MISSING", f"{mod} 里程碑不存在 ⇒ 限段写面无目标，不写、不猜")
        desc = ms.get("description") or ""
        content = milestone_line(mod, per_mod.get(mod, 0), unknown, xcnt, sha7)
        new_desc, err = replace_segment(desc, content)
        if err:
            die(2, "NO_MARKER",
                f"{mod} 里程碑描述缺 ASSET-AUTO 双标记 ⇒ 先全查再写，零 PATCH（判据 8a）")
        if new_desc == desc:
            continue
        if outside(desc) != outside(new_desc):  # 判据 4：段外逐字节保护（纯函数断言）
            die(1, "SEGMENT_LEAK", f"{mod} 段外将被改动（禁，判据 4）")
        plan.append((mod, ms.get("id"), new_desc))
    for mod, mid, new_desc in plan:
        api.call("PATCH", f"milestones/{mid}", {"description": new_desc})
        print(f"PATCHED milestones/{mid} ({mod})")
        changed += 1

    # ── --rebuild-769：有标记 ⇒ 只替换段内；无标记 ⇒ 仅文末追加（既有 body 严格前缀）──
    if a.rebuild_769:
        issue = api.call("GET", "issues/769")
        if not isinstance(issue, dict):
            die(2, "API_BAD_RESPONSE", "GET issues/769 返回非对象")
        old = issue.get("body") or ""
        content = issue769_segment(mapped, unknown, xcnt, sha7, roots)
        if segment_parts(old) is None:
            sep = "" if (not old or old.endswith("\n")) else "\n"
            new = old + sep + BEGIN + "\n" + content + "\n" + END + "\n"
            if not (new.startswith(old) and new != old):
                die(1, "SEGMENT_LEAK", "#769 追加后既有 body 不是严格前缀（禁，判据 4）")
        else:
            new, err = replace_segment(old, content)
            if err:
                die(2, "NO_MARKER", "#769 双标记不完整 ⇒ 不写")
            if outside(old) != outside(new):
                die(1, "SEGMENT_LEAK", "#769 段外将被改动（禁，判据 4）")
        if new != old:
            api.call("PATCH", "issues/769", {"body": new})
            print("PATCHED issues/769")
            changed += 1

    # ── 判据 6/8b（能力验证开关，默认关＝裁 277「不建卡」）：标题全等＋open 去重 ──
    if a.open_x_cards and unknown:
        issues = api.call("GET", "issues?state=open&limit=50")
        if not isinstance(issues, list):
            die(2, "API_BAD_RESPONSE", "GET issues 返回非数组")
        if any((i.get("title") or "") == CARD_TITLE for i in issues):
            print("CARD exists（标题全等＋open ⇒ 不重复开卡）")
        else:
            body = "\n".join([
                f"待归类 {unknown} 文件（报警，不进 X；as_of {sha7}）",
                "top roots：" + (" ｜ ".join(f"`{r}` {n}" for r, n in roots) if roots else "（无）"),
                "本卡自动维护·永不关闭；未知路径只上报不裁决，全量见 #769。",
            ])
            api.call("POST", "issues", {"title": CARD_TITLE, "body": body})
            print("CREATED issues（" + CARD_TITLE + "）")
            changed += 1

    print(f"CHANGED {changed}")


if __name__ == "__main__":
    main()
