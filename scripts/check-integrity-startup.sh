#!/bin/bash
# V4.1 T5 — 启动完整性校验。验证扩展引用闭合、标签可解析、依赖存在。失败→拒绝启动。
#
# Issue #1417（2026-11-18）性能修复：原实现逐 manifest / 逐边类型 / 逐行业各起一个
# `python3 -c` 子进程（本机 python 启动 ~0.4s/次，实测全量 268s）。改为**单进程批量**
# （一个 python 进程遍历全部 manifest / 边类型 / 行业），判据与逐条输出文案保持不变。
# 回滚：git show <merge_commit>^:scripts/check-integrity-startup.sh
set +e
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
echo "═══ V4.1 启动完整性校验 ═══"
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "  ❌ 启动完整性: 判不了（python3/python/py 均不可用；禁当通过）" >&2
  exit 2
fi
OUT="$("$PYBIN" - "$ROOT" <<'PYBATCH'
import json
import os
import re
import sys

ROOT = sys.argv[1]
FAIL = 0


def emit(msg):
    sys.stdout.write("  " + msg + "\n")


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# 1. manifest entryPoint 文件存在（原 `find "$ROOT/extensions" -name manifest.json`）
ext_root = os.path.join(ROOT, "extensions")
for dirpath, dirnames, filenames in os.walk(ext_root):
    if "node_modules" in dirnames:
        dirnames.remove("node_modules")
    if "manifest.json" not in filenames:
        continue
    mf = os.path.join(dirpath, "manifest.json")
    data = load_json(mf)
    ep = data.get("entryPoint", "") if isinstance(data, dict) else ""
    if not ep or ep == "./manifest.json":
        continue
    if ep.startswith("../src/"):
        target = os.path.join(ROOT, ep[3:])
    elif ep.startswith("./"):
        target = os.path.join(dirpath, ep[2:])
    else:
        target = os.path.join(dirpath, ep)
    if not os.path.isfile(target):
        emit("❌ entryPoint 缺失: %s → %s" % (mf, target))
        FAIL += 1

# 2. 边端点类型闭合（节点标签口径与原实现一致：仅取 "[A-Z][a-zA-Z]+" 形态）
LABEL_RE = re.compile(r'"[A-Z][a-zA-Z]+"')
EDGE_DIR = os.path.join(ROOT, "extensions/ontology/edge-types")
NODE_DIR = os.path.join(ROOT, "extensions/ontology/node-types")
if os.path.isdir(EDGE_DIR) and os.path.isdir(NODE_DIR):
    node_labels = set()
    for name in sorted(os.listdir(NODE_DIR)):
        path = os.path.join(NODE_DIR, name)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if '"label"' not in line:
                        continue
                    for hit in LABEL_RE.findall(line):
                        node_labels.add(hit.strip('"'))
        except OSError:
            continue
    for name in sorted(os.listdir(EDGE_DIR)):
        path = os.path.join(EDGE_DIR, name)
        if not os.path.isfile(path):
            continue
        edge = load_json(path)
        if not isinstance(edge, dict):
            continue
        endpoints = list(edge.get("allowedFrom", []) or []) + list(edge.get("allowedTo", []) or [])
        for endpoint in endpoints:
            if endpoint not in node_labels:
                emit("❌ 边类型 %s 引用的节点类型 %s 不存在" % (name, endpoint))
                FAIL += 1

# 3. industry extends 引用可解析
IND_DIR = os.path.join(ROOT, "extensions/industries")
if os.path.isdir(IND_DIR):
    ind_names = set()
    subs = [d for d in sorted(os.listdir(IND_DIR)) if os.path.isdir(os.path.join(IND_DIR, d))]
    for sub in subs:
        mf = os.path.join(IND_DIR, sub, "manifest.json")
        if not os.path.isfile(mf):
            continue
        data = load_json(mf)
        name = data.get("name", "") if isinstance(data, dict) else ""
        if name:
            ind_names.add(name)
    for sub in subs:
        mf = os.path.join(IND_DIR, sub, "manifest.json")
        if not os.path.isfile(mf):
            continue
        data = load_json(mf)
        ext = data.get("extends", "") if isinstance(data, dict) else ""
        if not ext or ext == "base":
            continue
        if ext not in ind_names:
            emit("❌ %s extends %s 但 %s 不存在" % (sub, ext, ext))
            FAIL += 1

sys.exit(1 if FAIL > 0 else 0)
PYBATCH
)"
RC=$?
if [ -n "$OUT" ]; then printf '%s\n' "$OUT"; fi
if [ "$RC" -ne 0 ]; then
  echo -e "  \033[0;31m启动完整性: $(printf '%s\n' "$OUT" | grep -c '❌') 项失败 — 拒绝启动\033[0m"
  exit 1
fi
echo -e "  \033[0;32m✅ 启动完整性校验通过\033[0m"
exit 0
