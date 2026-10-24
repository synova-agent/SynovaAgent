#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tests/vitest.known-red.check.py —— 全量测试「已知红」双向棘轮（#840 E-4 · 裁 352）

契约:
  @input  /tmp/vitest-result.json（vitest --reporter=json 产出）＋ tests/vitest.known-red.txt
          ＋ tests/contract/known-red.yaml（#913 登记表，须与新清单一致）
  @output 逐条 ❌/汇总 `KNOWN-RED-OK entries=N failed=M` 或 `❌ ...`
  @exit   0 = 通过；1 = 违例（未列出的失败／列了但已绿／条目超上限／清单与 yaml 不一致）；
          2 = 检查自身失败（无 JSON 等）
  @degraded 无（缺输入按 2，fail-closed）
"""
import json
import re
import sys

MANIFEST = "tests/vitest.known-red.txt"
REGISTRY = "tests/contract/known-red.yaml"
RESULT = "/tmp/vitest-result.json"


def parse_manifest():
    max_n, entries = None, []
    with open(MANIFEST, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if not line.strip():
                continue
            if line.startswith("#"):
                m = re.match(r"#\s*max_entries:\s*(\d+)", line)
                if m:
                    max_n = int(m.group(1))
                continue
            parts = [x.strip() for x in line.split("|")]
            if len(parts) < 5:
                print("❌ 清单行不足五段: " + line)
                sys.exit(1)
            target, _reason, _owner, _expiry, ruling = parts[:5]
            if not ruling.startswith("裁"):
                print("❌ 裁定号格式非法: " + line)
                sys.exit(1)
            entries.append(target)
    return max_n, entries


def covers(target, file, full):
    if target.endswith("::*"):
        return target[:-3] == file
    return target == (file + "::" + full)


def main():
    try:
        with open(RESULT, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        print("❌ 无结构化结果（vitest 未产出 JSON）: " + str(exc))
        return 2
    def norm(f):
        # CI 的 JSON 里 name 可能是**绝对路径**（/Users/.../tests/...）⇒ 统一成仓库相对路径
        i = f.find("/tests/")
        if i >= 0:
            return f[i + 1:]
        return f

    failed = []
    for tr in data.get("testResults", []):
        f = norm(tr.get("name", ""))
        for a in tr.get("assertionResults", []):
            if a.get("status") == "failed":
                failed.append((f, a.get("fullName", "")))
    max_n, entries = parse_manifest()
    if max_n is None:
        print("❌ 清单缺 `# max_entries:`（只减不增无上限）")
        return 1
    if len(entries) > max_n:
        print("❌ 清单条目 %d > max_entries %d（只减不增）" % (len(entries), max_n))
        return 1
    with open(REGISTRY, encoding="utf-8") as fh:
        ytxt = fh.read()
    ytests = [t.strip().strip('"') for t in re.findall(r"^\s+-\s+test:\s*\"?([^\"\n]+)\"?", ytxt, re.M)]
    files_in_manifest = set()
    for e in entries:
        files_in_manifest.add(e[:-3] if e.endswith("::*") else e.split("::")[0])
    missing = [t for t in ytests if t not in files_in_manifest]
    if missing:
        print("❌ known-red.yaml 有而新清单缺: " + str(missing))
        return 1
    new_fail = [(f, n) for f, n in failed if not any(covers(e, f, n) for e in entries)]
    stale = [e for e in entries if not any(covers(e, f, n) for f, n in failed)]
    print("全量失败 %d 条 / 清单 %d 条" % (len(failed), len(entries)))
    if new_fail:
        print("❌ 未列出的失败（新增红）：")
        for f, n in new_fail[:20]:
            print("   " + f + "::" + n)
    if stale:
        print("❌ 列了但已绿（修复后必须删行）：")
        for e in stale:
            print("   " + e)
    if new_fail or stale:
        return 1
    print("KNOWN-RED-OK entries=%d failed=%d" % (len(entries), len(failed)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
