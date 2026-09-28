#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
24-break-red-driver.py — D1051 改坏即红实测驱动（成员 V，独立复核）

对每个「关键断言」注入一处语义故障，取四元组原始证据：
  ① pre-green   （注入前跑 verify 命令，须绿）
  ② 注入         （精确文本替换，恰 1 处命中；带 `INJECTED-RED-<n>` 标记，便于残留自查）
  ③ red         （同一命令，须红；记录失败用例名 + 摘要）
  ④ revert-green（`git checkout --` 复原，sha 必须回到注入前；再跑同一命令，须绿）

判定口径：
  - ① 或 ④ 非绿 ⇒ 证据无效（环境/命令问题），记 INVALID。
  - ③ 仍绿 ⇒ **该断言不具判别力（grep 型静态判据）**，记 NO-RED ⇒ 须退回该断言的验收资格。
  - ③ 红且失败用例名命中 expect 子串 ⇒ PASS（注入即红）。

用法: cd <worktree> && python3 docs/synova/product-lines/evidence/D1051/24-break-red-driver.py
"""
import json
import hashlib
import os
import re
import subprocess
import sys

EV = "docs/synova/product-lines/evidence/D1051"
LOGD = os.path.join(EV, "logs-break-red")
OUT = os.path.join(EV, "20-verify-break-red.json")

CASES = [
    {
        "id": "R1",
        "title": "显式深度短路（?depth=detailed 被强制回浅层）",
        "file": "src/routes/diagnosis.ts",
        "old": "  const viewDepth: ReportViewDepth = normalizedDepth ?? DEFAULT_REPORT_VIEW_DEPTH;",
        "new": "  const viewDepth: ReportViewDepth = DEFAULT_REPORT_VIEW_DEPTH; // INJECTED-RED-1 显式深度短路（强制浅层）",
        "cmd": ["npx", "vitest", "run", "tests/routes/diagnosis-report-depth.test.ts"],
        "expect_red": ["③ 3-2 详细报告"],
        "assertion": "「?depth=detailed → 200 + 五章齐备 + 头回执 detailed」必须报红",
    },
    {
        "id": "R2",
        "title": "默认深度反转（不带 depth 时走 detailed）",
        "file": "src/routes/diagnosis.ts",
        "old": "  const viewDepth: ReportViewDepth = normalizedDepth ?? DEFAULT_REPORT_VIEW_DEPTH;",
        "new": "  const viewDepth: ReportViewDepth = normalizedDepth ?? 'detailed'; // INJECTED-RED-2 默认深度反转",
        "cmd": ["npx", "vitest", "run", "tests/routes/diagnosis-report-depth.test.ts"],
        "expect_red": ["② 零回归判别"],
        "assertion": "「不带 depth 的产物 === ?depth=one_pager 产物（字节相等）」必须报红",
    },
    {
        "id": "R3",
        "title": "详细报告渲染器删章节（行动建议章不再产出）",
        "file": "src/agent/report-assembler.ts",
        "old": "  chapters.push({\n    title: titles[3],\n    body: actionLines.length === 0 ? [`${DEGRADED_MARK} 无行动建议记录`] : actionLines,\n  });",
        "new": "  if (false) chapters.push({ // INJECTED-RED-3 删掉行动建议章\n    title: titles[3],\n    body: actionLines.length === 0 ? [`${DEGRADED_MARK} 无行动建议记录`] : actionLines,\n  });",
        "cmd": ["npx", "vitest", "run", "tests/agent/report-detailed.test.ts"],
        "expect_red": ["① 五章标题字面齐备"],
        "assertion": "「详细报告五章齐备」必须报红",
    },
    {
        "id": "R4",
        "title": "对话意图判定短路（深度词恒不命中）",
        "file": "src/agent/report-depth.ts",
        "old": "  for (const entry of UTTERANCE_KEYWORD_TABLE) {\n    if (text.includes(entry.keyword)) {",
        "new": "  for (const entry of UTTERANCE_KEYWORD_TABLE) {\n    if (false && text.includes(entry.keyword)) { // INJECTED-RED-4 对话意图判定短路",
        "cmd": ["npx", "vitest", "run", "tests/routes/conversations-report-view.test.ts", "tests/agent/report-depth.test.ts"],
        "expect_red": ["① 「讲细一点」"],
        "assertion": "「讲细一点 → report_view.depth=detailed」与 W1 词表命中必须报红",
    },
    {
        "id": "R5",
        "title": "degraded 静默化（详细报告 fallback 的降级标记被抹掉）",
        "file": "src/agent/report-assembler.ts",
        "old": "  const lines = [`# ${report.teamId} 诊断详细报告（降级：模板渲染失败，纯文本输出）`, ''];",
        "new": "  const lines = [`# ${report.teamId} 诊断详细报告（模板不可用，纯文本输出）`, '']; // INJECTED-RED-5 degraded 标记静默化",
        "cmd": ["npx", "vitest", "run", "tests/agent/report-detailed.test.ts"],
        "expect_red": ["⑧ 注册表缺 detailed_report"],
        "assertion": "「注册表缺 detailed_report → 落 fallback 且含降级标记」必须报红",
    },
    {
        "id": "R6",
        "title": "对话帧渲染降级检测恒 false（degraded / reason='RENDER_DEGRADED' 静默化）——T4 补测后覆核",
        "file": "src/routes/conversations.ts",
        "old": "function isDegradedRender(markdown: string): boolean {\n  return markdown.includes('（降级：');\n}",
        "new": "function isDegradedRender(markdown: string): boolean {\n  return false; // INJECTED-RED-6 渲染降级检测恒 false（degraded/RENDER_DEGRADED 静默化）\n}",
        "cmd": ["npx", "vitest", "run", "tests/routes/conversations-report-view.test.ts"],
        "expect_red": ["⑦ 渲染降级路径"],
        "expect_green": ["⑧ 对照"],
        "assertion": "补测后：「⑦ 渲染降级路径 → 帧 degraded:true + reason:RENDER_DEGRADED」必须报红；「⑧ 对照（防恒真）」不得连带红",
    },
    {
        "id": "R6c",
        "title": "降级标记静默化（detailedReportFallback 的「（降级：」被抹掉）→ ⑦ 亦须红（第二独立注入源）",
        "file": "src/agent/report-assembler.ts",
        "old": "  const lines = [`# ${report.teamId} 诊断详细报告（降级：模板渲染失败，纯文本输出）`, ''];",
        "new": "  const lines = [`# ${report.teamId} 诊断详细报告（模板不可用，纯文本输出）`, '']; // INJECTED-RED-6c 降级标记静默化（对话帧侧）",
        "cmd": ["npx", "vitest", "run", "tests/routes/conversations-report-view.test.ts"],
        "expect_red": ["⑦ 渲染降级路径"],
        "assertion": "第二注入源（独立于 R6 的判定点）：帧 degraded 判定依赖 fallback 文面「（降级：」——抹掉后 ⑦ 必须报红",
    },
]


def sha256_file(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def parse_vitest(out: str):
    files = [l.strip() for l in out.splitlines() if re.match(r"\s*Test Files\s", l)]
    tests = [l.strip() for l in out.splitlines() if re.match(r"\s*Tests\s", l)]
    failed = []
    for line in out.splitlines():
        if re.match(r"\s*[×✗]\s", line) or re.match(r"\s*FAIL\s", line):
            failed.append(line.strip())
    return (files[-1] if files else "(无 Test Files 行)"), (tests[-1] if tests else "(无 Tests 行)"), failed


def main() -> int:
    os.makedirs(LOGD, exist_ok=True)
    records = []
    head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()

    # CLI: --only R6,R6c  --out <path>（窄复核用：只跑指定用例，产物另存）
    only = None
    out = OUT
    if "--only" in sys.argv:
        only = [x.strip() for x in sys.argv[sys.argv.index("--only") + 1].split(",") if x.strip()]
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    cases = [c for c in CASES if only is None or c["id"] in only]

    for case in cases:
        cid = case["id"]
        path = case["file"]
        pre_sha = sha256_file(path)
        rec = {
            "id": cid,
            "title": case["title"],
            "assertion": case["assertion"],
            "injection": {"file": path, "old": case["old"], "new": case["new"], "marker": f"INJECTED-RED-{cid[1:]}"},
            "verifyCommand": " ".join(case["cmd"]),
            "preInjectionFileSha256": pre_sha,
        }

        # ① pre-green
        rc_pre, out_pre = run(case["cmd"])
        with open(os.path.join(LOGD, f"{cid}-1-pre-green.log.txt"), "w") as f:
            f.write(out_pre)
        f_pre, t_pre, _ = parse_vitest(out_pre)
        rec["preGreen"] = {"exit": rc_pre, "testFiles": f_pre, "tests": t_pre}

        # ② 注入
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        hits = content.count(case["old"])
        rec["injection"]["occurrences"] = hits
        if hits != 1:
            rec["verdict"] = "INVALID"
            rec["detail"] = f"注入锚点命中 {hits} 处（应恰 1 处）——未注入，跳过本用例"
            records.append(rec)
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(content.replace(case["old"], case["new"], 1))
        rec["injection"]["markerPresent"] = case["new"].split("INJECTED-RED-")[1].split(" ")[0] in open(path).read()

        # ③ red
        rc_red, out_red = run(case["cmd"])
        with open(os.path.join(LOGD, f"{cid}-2-injected-red.log.txt"), "w") as f:
            f.write(out_red)
        f_red, t_red, failed_red = parse_vitest(out_red)
        hit_expect = [e for e in case["expect_red"] if any(e in fl for fl in failed_red)]
        expect_green_missing = [g for g in case.get("expect_green", []) if any(g in fl for fl in failed_red)]
        rec["red"] = {
            "exit": rc_red, "testFiles": f_red, "tests": t_red, "failingTests": failed_red,
            "expectMatched": hit_expect,
            "expectGreenStillGreen": [g for g in case.get("expect_green", []) if g not in expect_green_missing],
            "expectGreenCollateralFailures": expect_green_missing,
        }

        # ④ revert + green
        subprocess.run(["git", "checkout", "--", path], check=True)
        post_sha = sha256_file(path)
        rec["revert"] = {"restoredSha256": post_sha, "shaRestored": post_sha == pre_sha}
        rc_post, out_post = run(case["cmd"])
        with open(os.path.join(LOGD, f"{cid}-3-revert-green.log.txt"), "w") as f:
            f.write(out_post)
        f_post, t_post, _ = parse_vitest(out_post)
        rec["revertGreen"] = {"exit": rc_post, "testFiles": f_post, "tests": t_post}

        if rc_pre != 0 or rc_post != 0 or not rec["revert"]["shaRestored"]:
            rec["verdict"] = "INVALID"
        elif case.get("expect_stay_green"):
            if rc_red == 0:
                rec["verdict"] = "PASS-NO-RED-EXPECTED"
                rec["detail"] = "留痕探针：注入后仍绿 ⇒ 该路径在既有套件中零断言覆盖 = 覆盖盲区（非验收判据失效，另记局限）"
            else:
                rec["verdict"] = "PASS-RED-COVERED"
                rec["detail"] = f"留痕探针：该路径已被间接覆盖（注入即红，失败用例：{failed_red[:2]}）"
        elif rc_red == 0:
            rec["verdict"] = "NO-RED"
            rec["detail"] = "注入后仍绿 ⇒ 该断言不具判别力（grep 型静态判据）⇒ 须退回"
        elif not hit_expect:
            rec["verdict"] = "RED-UNEXPECTED"
            rec["detail"] = f"红了但失败用例未命中期望子串 {case['expect_red']}"
        elif expect_green_missing:
            rec["verdict"] = "RED-UNEXPECTED"
            rec["detail"] = f"连带红（应保持绿的对照组也失败）：{expect_green_missing}"
        else:
            rec["verdict"] = "PASS"
            rec["detail"] = f"注入即红，失败用例命中 {hit_expect}" + (
                f"；对照组保持绿 {case.get('expect_green')}" if case.get("expect_green") else ""
            )
        records.append(rec)
        print(f"[{rec['verdict']}] {cid} {case['title']} | pre={t_pre} | red={t_red} | post={t_post}")

    verdicts = {}
    for r in records:
        verdicts[r["verdict"]] = verdicts.get(r["verdict"], 0) + 1
    ok = sum(v for k, v in verdicts.items() if k.startswith("PASS"))
    payload = {
        "artifact": "D1051 改坏即红实测（独立复核，成员 V）",
        "method": "每例：pre-green → 精确文本注入(恰1处, 带 INJECTED-RED-n 标记) → 同命令须红 → git checkout -- 复原(sha 校验) → 再跑须绿；原始日志见 logs-break-red/",
        "generatedAt": subprocess.run(["date", "-Iseconds"], capture_output=True, text=True).stdout.strip(),
        "head": head,
        "casesRun": [c["id"] for c in cases],
        "verdictCounts": verdicts,
        "cases": records,
        "rawLogs": sorted(f for f in os.listdir(LOGD) if any(f.startswith(c["id"] + "-") for c in cases)),
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[SUMMARY] {json.dumps(verdicts, ensure_ascii=False)} → {out}")
    return 0 if ok == len(records) else 1


if __name__ == "__main__":
    sys.exit(main())
