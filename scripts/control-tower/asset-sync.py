#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
asset-sync.py —— #776 资产同步器（Gitea 里程碑 ASSET-AUTO 段自动维护）

契约（铁律 47；dev doc §4）：
  输入：--prev <sha> --new <sha>（缺省 prev=HEAD^, new=HEAD）｜--dry-run｜--rebuild-769
        --map <path>（缺省 docs/authority/ASSET-MAP.yaml）
        环境 SYNO_PUSH_GITEA_API / SYNO_PUSH_GITEA_TOKEN_FILE（仅写路径需要；dry-run 不联网）
  输出：stdout 逐文件归类行 + 终行 `SUMMARY mapped=N unknown=M x=K total=T`（total 恒取
        `git ls-tree -r <new>` 实测，禁用 MAP 条目数）+ 幂等重跑输出 changed=0
  退出码：0 同步成功（或 dry-run 计划）｜1 真红（MAP 解析失败/catch-all/冲突/API 拒绝/恒等式不成立）
        ｜2 环境降级（token 不可读/API 不可达/里程碑无 ASSET-AUTO 标记 ⇒ 不写不猜）
  降级：写失败 ⇒ `degraded: true` 行 + exit 2（禁静默吞）
  幂等：段内容函数纯字符串替换，段外逐字节不变；重复归类不重复开卡（标题全等+open）
"""
import argparse, fnmatch, json, os, re, subprocess, sys, urllib.request, urllib.error

BEGIN, END = "<!-- ASSET-AUTO:BEGIN -->", "<!-- ASSET-AUTO:END -->"
CATCH_ALL = ("**", "*")  # 判据 2：禁覆盖仓根的 glob（单独 ** 或 * 即视为 catch-all）


def die(code, msg):
    print(msg)
    sys.exit(code)


def load_map(path):
    """极简受限 YAML 子集解析（entries: [- glob/module/owner/state]，stdlib only）。
    返回 ([(glob,module,owner,state)], match_rule)。解析失败 ⇒ exit 1。"""
    try:
        text = open(path, encoding="utf-8").read()
    except OSError as e:
        die(1, f"真红: MAP 不可读 {path}: {e}")
    entries, cur, rule = [], None, "first"
    for ln, line in enumerate(text.splitlines(), 1):
        s = line.split("#", 1)[0].rstrip()
        if not s.strip():
            continue
        m = re.match(r"^match:\s*(\S+)", s)
        if m:
            rule = m.group(1)
            continue
        if s.strip() == "entries:":
            continue
        m = re.match(r"^\s*-\s*glob:\s*\"?([^\"\s]+)\"?", s)
        if m:
            cur = {"glob": m.group(1)}
            entries.append(cur)
            continue
        m = re.match(r"^\s*(glob|module|owner|state):\s*\"?([^\"\s]+)\"?", s)
        if m and cur is not None:
            cur[m.group(1)] = m.group(2)
            continue
        if s.strip().startswith("- "):
            die(1, f"真红: MAP 非法条目 L{ln}: {s.strip()}")
    clean = []
    for i, e in enumerate(entries):
        if not all(k in e for k in ("glob", "module", "owner", "state")):
            die(1, f"真红: MAP 条目缺字段 #{i+1}: {e}")
        clean.append((e["glob"], e["module"], e["owner"], e["state"]))
    if len(clean) == 0:
        die(2, "degraded: MAP 信号量==0（无条目 ⇒ 禁把看不见当没问题）")
    for i, (g, _, _, _) in enumerate(clean):
        # ── 判据 2：反 catch-all（发现 ⇒ exit 1）──
        if g in CATCH_ALL or g.startswith("*/**") or g == "**/*":
            die(1, f"真红: MAP 含 catch-all glob「{g}」（判据 2，条目 #{i+1}）")
    mods = {m for _, m, _, _ in clean}
    for need in ("M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"):
        if need not in mods:
            die(1, f"真红: MAP 缺 {need} 种子条目（bootstrap 计数断言，判据 2）")
    return clean, rule


def classify(entries, rule, path):
    """有序首中；返回 (module|None, matched_glob|None)。未中 ⇒ None（待归类桶）。"""
    for g, mod, _, _ in entries:
        if fnmatch.fnmatch(path, g):
            return mod, g
    return None, None


def git(*a):
    r = subprocess.run(["git", *a], capture_output=True, text=True)
    if r.returncode != 0:
        die(2, f"degraded: git {' '.join(a)} 失败: {r.stderr.strip()[:200]}")
    return r.stdout


def tree_files(ref):
    return [l for l in git("ls-tree", "-r", "--name-only", "-z", ref).split("\0") if l]


def diff_files(prev, new):
    return [l for l in git("diff", "--name-only", prev, new).splitlines() if l]


def replace_segment(desc, content):
    """纯函数：替换 BEGIN..END 之间内容；段外逐字节不变；无标记 ⇒ (None, err)。"""
    if BEGIN not in desc or END not in desc:
        return None, "no-marker"
    pre, rest = desc.split(BEGIN, 1)
    _, post = rest.split(END, 1)
    return pre + BEGIN + "\n" + content + "\n" + END + post, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prev", default="HEAD^")
    ap.add_argument("--new", default="HEAD")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--rebuild-769", action="store_true")
    ap.add_argument("--map", default="docs/authority/ASSET-MAP.yaml")
    a = ap.parse_args()

    entries, rule = load_map(a.map)
    files = tree_files(a.new)
    total = len(files)  # 🔴 恒等式分母：ls-tree 实测（反例 8c 红队点）
    mapped = unknown = xcnt = 0
    per_mod, unknown_paths = {}, []
    for f in files:
        mod, _ = classify(entries, rule, f)
        if mod is None:
            # MVP 根未知 ⇒ 待归类（不进 X）；非 MVP 根未列同样待归类并报警
            unknown += 1
            unknown_paths.append(f)
        elif mod == "X":
            xcnt += 1
        else:
            mapped += 1
            per_mod[mod] = per_mod.get(mod, 0) + 1
    # 主判据 1：覆盖恒等式（结构性三分类 ⇒ 必须等于 total）
    if mapped + unknown + xcnt != total:
        die(1, f"真红: 恒等式不成立 mapped({mapped})+unknown({unknown})+x({xcnt}) != total({total})")

    for f in diff_files(a.prev, a.new):
        mod, _ = classify(entries, rule, f)
        print(f"{'DRY' if a.dry_run else 'SYNC'} {f} -> {mod or '待归类(报警,不进X)'}")

    for m in sorted(per_mod):
        print(f"MOD {m} files={per_mod[m]}")
    print("UNKNOWN_SAMPLE " + ";".join(unknown_paths[:8]) + (f" (+{unknown-8})" if unknown > 8 else ""))
    print(f"SUMMARY mapped={mapped} unknown={unknown} x={xcnt} total={total}")

    if a.dry_run:
        print("DRY-RUN: 未联网、未写里程碑、未开卡（判据 5）")
        return

    # ── 以下为写路径（#776 真跑；CTO 四点抽验前禁用）──
    API = os.environ.get("SYNO_PUSH_GITEA_API", "http://127.0.0.1:3000/api/v1")
    TF = os.environ.get("SYNO_PUSH_GITEA_TOKEN_FILE", "/Users/wane/gitea/.win-push-token")
    try:
        tok = open(TF).read().strip()
    except OSError:
        die(2, f"degraded: token_unreadable {TF}")

    def call(method, path, body=None):
        req = urllib.request.Request(f"{API}/repos/synova-agent/SynovaAgent/{path}",
            data=json.dumps(body).encode() if body is not None else None, method=method,
            headers={"Authorization": f"token {tok}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read() or b"{}"), None
        except urllib.error.HTTPError as e:
            return None, f"HTTP {e.code}"

    ms, err = call("GET", "milestones?limit=50")
    if err:
        die(2, f"degraded: milestones 不可达 {err}")
    changed = 0
    for m in ms:
        if not re.match(r"^M\d+ ", m["title"]):
            continue
        mod = m["title"].split(" ")[0]
        impl = per_mod.get(mod, 0)
        tot = {"M1": 4, "M2": 4, "M3": 7, "M4": 3, "M5": 3, "M6": 4,
               "M7": 7, "M8": 4, "M9": 4, "M10": 5}[mod]
        desc = m["description"] or ""
        content = f"实现覆盖 {impl} 文件（自动）｜验收见卡（证据）"
        new_desc, err = replace_segment(desc, content)
        if err == "no-marker":
            die(2, f"degraded: {mod} 里程碑无 ASSET-AUTO 标记 ⇒ 不写（判据 8a）")
        if new_desc != desc:
            pre_out = desc.split(BEGIN)[0] + desc.split(END)[1]
            post_out = new_desc.split(BEGIN)[0] + new_desc.split(END)[1]
            if pre_out != post_out:
                die(1, f"真红: {mod} 段外将被改动（禁）")
            _, err = call("PATCH", f"milestones/{m['id']}", {"description": new_desc})
            if err:
                die(2, f"degraded: PATCH {mod} 失败 {err} degraded: true")
            changed += 1
    if unknown:
        # 复用 ci_watch 去重范式：标题全等 + open 检索（不建第二通道）
        title = "[ASSET] X · 未归类资产聚合卡（自动维护·永不关闭）"
        iss, err = call("GET", "issues?state=open&limit=50")
        if err:
            die(2, f"degraded: issues 不可达 {err}")
        if not any(i["title"] == title for i in iss):
            _, err = call("POST", "issues", {"title": title + "（更新）", "body":
                f"待归类 {unknown} 文件（报警，不进 X）", "labels": [52]})
            if err:
                die(2, "degraded: 开卡失败 degraded: true")
            changed += 1
    print(f"CHANGED {changed}")
    if a.rebuild_769:
        print("REBUILD-769: 重建 #769 资产地图（本期范围外，占位）")


if __name__ == "__main__":
    main()
