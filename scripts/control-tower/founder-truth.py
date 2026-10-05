#!/usr/bin/env python3
"""
founder-truth.py — 创始人零信任控制台 L1 物理层（D419 MVP → D424 三问面板扩展）

三问面板（创始人每天最关心的三个问题）:
  面板1 任务真相 — 每任务 声称 status vs git 物理事实（提交/合并）→ 🟢🟡🔴⚪
  面板2 诚信账本 — bypass.log 按 AGENT 对账（COMMITTED/BLOCKED/detected-bypass）
  面板3 北星对齐 — 任务 brief Q0 vs PRODUCT-BRIEF.md 章节关键词 → 对齐/偏离
  附  CI 核验 — GitHub Actions 最近一次运行（--offline 跳过网络）+ 主动告警（红灯写告警文件）

契约 (铁律 47):
  @input  — 无参（含 CI 网络调用）| --offline（跳过 CI，纯 git 物理事实）| --html（自包含页面）
  @output — stdout 三问面板 + docs/synova/founder-console.html（--html）+ 告警文件（有红灯时）
  @exit   — 0 = 全部声称与物理一致；1 = 有"声称但物理不支撑"（疑似忽悠）；2 = 采集降级
  @degraded — git/CI/北星源不可用 → 对应维度标 degraded（不静默当真）
设计公理 (零信任): 数据源只有 git log / merge-base / CI API / PRODUCT-BRIEF——物理事实。
        task-state.json 的人工 status 字段只是"待验证的声称"，不作为真相。
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
TASK_STATE = REPO / "task-state"
BRIEF_DIR = REPO / ".claude" / "task-briefs"
PRODUCT_BRIEF = REPO / ".claude" / "PRODUCT-BRIEF.md"
BYPASS_LOG = REPO / ".claude" / "bypass.log"
# FIX-008: 输出目录可经 `SYNO_FOUNDER_OUT_DIR` 注入（缺省 = 现状 docs/synova，**生产行为不变**）。
#   动机: 测试直接写仓库内 tracked 生成物（founder-console.html / founder-alerts.md）→ 跑完
#   工作区变脏（M8 家族「测试副作用碰 tracked 文件」第 3 例，已复现）。夹具改为写 mktemp 隔离目录。
OUT_DIR = Path(os.environ["SYNO_FOUNDER_OUT_DIR"]) if os.environ.get("SYNO_FOUNDER_OUT_DIR") else (REPO / "docs" / "synova")
HTML_OUT = OUT_DIR / "founder-console.html"
ALERT_OUT = OUT_DIR / "founder-alerts.md"


def sh(cmd):
    """跑 shell，返回 (rc, stdout)。失败不抛（降级由调用方处理）。"""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO, timeout=30)
        return r.returncode, r.stdout
    except Exception:
        return -1, ""


def git_committed_dns():
    """物理事实: 全部提交标题里出现的 D#（impl 证据）+ 已进 origin/main 的 D#（合并证据）。"""
    rc, log = sh(["git", "log", "--all", "--format=%s"])
    if rc != 0:
        return None, None  # git 不可用 → degraded
    committed = set()
    for line in log.splitlines():
        m = re.search(r"\(D(\d{3})\)", line)
        if m:
            committed.add(int(m.group(1)))
    rc2, mainlog = sh(["git", "log", "origin/main", "--format=%s"])
    merged = set()
    if rc2 == 0:
        for line in mainlog.splitlines():
            m = re.search(r"\(D(\d{3})\)", line)
            if m:
                merged.add(int(m.group(1)))
    return committed, merged


def collect(offline=False):
    """采集每个任务的 声称 status vs 物理验证。返回 (rows, git_ok)。

    方案 B（2026-08-18 创始人定）: task-state 目录只有 Mac DSH 侧 52 个任务，
    全项目 git log 有 258 个 D#。历史任务（git 有、task-state 无）也纳入，
    但标记 hist=True——渲染时折叠，红绿灯只算活跃任务（不淹没当下信号）。
    """
    committed, merged = git_committed_dns()
    git_ok = committed is not None
    rows = []
    seen = set()
    if TASK_STATE.exists():
        for p in sorted(TASK_STATE.glob("*.json")):
            if p.name == "TEMPLATE.json":
                continue
            try:
                d = json.loads(p.read_text(encoding="utf-8", errors="replace"))
            except Exception:
                continue
            tid = d.get("task_id", p.stem)
            m = re.search(r"D(\d{3})", tid)
            num = int(m.group(1)) if m else None
            claimed = d.get("status", "?")
            if num is not None:
                seen.add(num)
            if not git_ok:
                phys = "degraded"
            elif num in merged:
                phys = "已提交且进 main"
            elif num in committed:
                phys = "已提交未进 main"
            else:
                phys = "无提交记录"
            rows.append({"id": tid, "title": (d.get("title") or "")[:20],
                         "claimed": claimed, "phys": phys, "num": num, "hist": False})
    # 方案 B: git 里有、task-state 无的历史任务 → 折叠纳入（status 从 git 派生=impl_done）
    if git_ok and committed is not None:
        for num in sorted(committed - seen):
            tid = "D%03d" % num
            phys = "已提交且进 main" if num in (merged or set()) else "已提交未进 main"
            rows.append({"id": tid, "title": "(历史任务)",
                         "claimed": "impl_done", "phys": phys, "num": num, "hist": True})
    return rows, git_ok


def judge(claimed, phys):
    """判定红绿灯: 声称状态 vs 物理证据是否支撑。"""
    if phys == "degraded":
        return "🟡", "物理核验降级（git 不可用），待复核"
    if claimed in ("impl_done", "audited"):
        if phys == "已提交且进 main":
            return "🟢", "声称与物理一致"
        if phys == "已提交未进 main":
            return "🟡", "提交了但还没合并进 main"
        return "🔴", "声称完成但 git 里查不到提交——疑似虚报"
    if claimed == "spec_done":
        return "🟢", "规格已交付"
    if phys == "已提交且进 main":
        return "🟡", "物理已完成但状态未更新（task-state 滞后）"
    if phys == "已提交未进 main":
        return "🟡", "提交了但未合并进 main"
    return "⚪", "进行中"


def integrity_ledger():
    """面板2 诚信账本: bypass.log 按 AGENT 对账 COMMITTED/BLOCKED + 真绕过计数。"""
    if not BYPASS_LOG.exists():
        return None
    try:
        text = BYPASS_LOG.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    agents = {}
    bypass_total = 0
    for line in text.splitlines():
        if "detected-bypass" in line or "possible-bypass" in line:
            bypass_total += 1
            continue
        m = re.search(r"AGENT=(\S+)", line)
        if not m:
            continue
        agent = m.group(1)
        d = agents.setdefault(agent, {"committed": 0, "blocked": 0})
        if "| COMMITTED |" in line:
            d["committed"] += 1
        elif "| BLOCKED |" in line:
            d["blocked"] += 1
    return {"agents": agents, "bypass_total": bypass_total}


def _find_brief(tid):
    """按 task id 找 brief（D# 前缀或日期前缀 D#）。"""
    if not BRIEF_DIR.exists():
        return None
    m = re.search(r"D(\d{3})", tid)
    if not m:
        return None
    n = m.group(1)
    for p in sorted(BRIEF_DIR.glob("*.md")):
        if re.search(rf"D{n}([-._]|$)", p.name):
            return p
    return None


def _extract_q0(brief_path):
    """提取 brief 的 Q0 定位段（用于北星关键词匹配）。"""
    try:
        text = brief_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    lines = text.splitlines()
    in_q0 = False
    buf = []
    for ln in lines:
        if re.match(r"^## Q0", ln):
            in_q0 = True
            continue
        if in_q0 and re.match(r"^## ", ln):
            break
        if in_q0:
            buf.append(ln)
    return " ".join(buf)


# 北星章节 → 关键词（对照 .claude/PRODUCT-BRIEF.md 八节，语义锚定）
NORTH_STAR_SECTIONS = [
    ("一、Synova 是什么（诊断/增长导航）", ["诊断", "增长", "卡点", "导航", "数字孪生"]),
    ("二、谁在用（GA/企业主）", ["GA", "FDE", "企业主", "用户", "客户", "RBAC"]),
    ("三、怎么工作（哨兵巡检/专家）", ["哨兵", "巡检", "专家", "工单", "信号", "按需诊断"]),
    ("四、技术骨架（五层/本体/文件优先）", ["五层架构", "本体", "文件优先", "图", "GraphBridge", "L1", "L2", "L3", "L4", "L5"]),
    ("五、已完成（W1-W4）", ["已完成", "W1", "W2", "W3", "W4"]),
    ("六、还没做（P0/P1/P2 优先级）", ["P0", "P1", "P2", "数据流", "报告质量", "Docker", "前端 UI", "真实数据"]),
    ("七、犯过的错", ["task-start", "硬编码", "跨层", "信号路由"]),
    ("八、Loop Engineering（产品对齐）", ["产品对齐", "全局状态", "决策建议", "pre-commit", "门禁", "控制塔"]),
]


def north_star_alignment(rows):
    """面板3 北星对齐: 每个任务标注服务哪个北星章节。返回 (list[(tid, section|None)], degraded)。"""
    if not PRODUCT_BRIEF.exists():
        return None, True
    result = []
    for r in rows:
        brief = _find_brief(r["id"])
        q0 = _extract_q0(brief) if brief else ""
        hay = q0 + " " + r["title"] + " " + r["id"]
        matched = None
        for name, kws in NORTH_STAR_SECTIONS:
            if any(k.lower() in hay.lower() for k in kws):
                matched = name
                break
        result.append((r["id"], matched))
    return result, False


def _github_repo():
    rc, out = sh(["git", "remote", "get-url", "origin"])
    if rc != 0:
        return None
    m = re.search(r"(?:github\.com[:/])([\w.-]+)/([\w.-]+?)(?:\.git)?$", out.strip())
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    return None


def _github_token():
    """读取 GitHub token（只读）: GITHUB_TOKEN env 优先 → 仓库根 .synova-ci-token → ~/.synova/github-token。"""
    tok = os.environ.get("GITHUB_TOKEN", "").strip()
    if tok:
        return tok
    for p in (REPO / ".synova-ci-token", Path.home() / ".synova" / "github-token"):
        try:
            t = p.read_text(encoding="utf-8").strip()
            if t:
                return t
        except OSError:
            continue
    return ""


def ci_status():
    """CI 核验: GitHub Actions 最近一次运行。返回 (label, detail, ok, degraded)。"""
    repo = _github_repo()
    if not repo:
        return None, "未配置 GitHub 仓库", False, True
    rc, out = sh(["gh", "run", "list", "--repo", repo, "--limit", "1",
                  "--json", "status,conclusion,headSha,workflowName"])
    if rc == 0 and out.strip():
        try:
            runs = json.loads(out)
            if runs:
                r0 = runs[0]
                concl = r0.get("conclusion") or r0.get("status") or "?"
                label = "🟢" if concl == "success" else ("🔴" if concl in ("failure", "cancelled", "timed_out") else "🟡")
                return label, f"{r0.get('workflowName','CI')} {concl} (sha {str(r0.get('headSha',''))[:7]})", concl == "success", False
        except Exception:
            pass
    token = _github_token()
    if not token:
        return None, "未接入 CI（需 gh 或 GITHUB_TOKEN）", False, True
    url = f"https://api.github.com/repos/{repo}/actions/runs?per_page=1"
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"token {token}", "User-Agent": "founder-truth"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        runs = data.get("workflow_runs", [])
        if runs:
            r0 = runs[0]
            concl = r0.get("conclusion") or r0.get("status") or "?"
            label = "🟢" if concl == "success" else ("🔴" if concl in ("failure", "cancelled", "timed_out") else "🟡")
            return label, f"{r0.get('name','CI')} {concl} (sha {str(r0.get('head_sha',''))[:7]})", concl == "success", False
    except Exception:
        return None, "CI API 调用失败（网络/token）", False, True
    return None, "无 CI 运行记录", False, True


def write_alert(rows):
    """主动告警: 有红灯时写告警文件（供创始人/cron 拾取）。返回红灯任务列表。"""
    reds = [r for r in rows if judge(r["claimed"], r["phys"])[0] == "🔴"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)   # FIX-008: 注入目录可能尚不存在（缺省路径本就存在 → 生产无变化）
    if not reds:
        if ALERT_OUT.exists():
            ALERT_OUT.write_text("✅ 当前无红灯（所有声称均有物理支撑）。\n", encoding="utf-8")
        return reds
    lines = ["# 🚨 创始人告警 — 疑似虚报（物理核验不通过）", "",
             f"> 生成: {_now_iso()}（物理事实核验，非 agent 自报）", ""]
    for r in reds:
        _, note = judge(r["claimed"], r["phys"])
        lines.append(f"- **{r['id']}** {r['title']}：它说「{r['claimed']}」，物理核验「{r['phys']}」→ {note}")
    lines += ["", "点开 founder-console.html 看证据；K3 可复核：git log --all | grep \"(D#)\"。"]
    ALERT_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return reds


def _now_iso():
    import datetime
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def render_html(rows, green, yellow, red, git_ok, ledger, north, ci):
    """自包含 HTML（创始人双击即开, 内联 CSS 零外部依赖, 大白话 + 红绿灯 + 可复核）。"""
    colors = {"🟢": "#16a34a", "🟡": "#d97706", "🔴": "#dc2626", "⚪": "#9ca3af"}

    def row_html(r):
        emoji, note = judge(r["claimed"], r["phys"])
        return ('<tr><td><b>%s</b> %s</td><td>%s</td><td>%s</td>'
                '<td style="color:%s;font-weight:600">%s %s</td></tr>'
                % (r["id"], r["title"], r["claimed"], r["phys"], colors[emoji], emoji, note))

    # 方案 B: 活跃任务展开，历史任务折叠成一行（可点击展开）
    active_rows = [r for r in rows if not r.get("hist")]
    hist_rows = [r for r in rows if r.get("hist")]
    rows_html = "".join(row_html(r) for r in active_rows)
    if hist_rows:
        hist_in_main = sum(1 for r in hist_rows if r["phys"] == "已提交且进 main")
        hist_detail = "".join(row_html(r) for r in hist_rows)
        hist_html = (
            '<div class="h2">📦 历史任务（' + str(len(hist_rows)) + ' 个，'
            + str(hist_in_main) + ' 个进 main）— git log 全项目派生，点击展开</div>\n'
            '<details><summary style="cursor:pointer;color:#666;padding:8px">'
            '展开/收起历史任务（这些是 task-state 未登记、但 git 里确有提交的全项目任务）</summary>\n'
            '<table><tr><th>任务</th><th>它说</th><th>物理核验</th><th>判定</th></tr>'
            + hist_detail + '</table></details>\n'
        )
    else:
        hist_html = ""
    ok = red == 0
    status_bg = "#16a34a" if ok else "#dc2626"
    status_txt = "全部声称与物理一致 ✅" if ok else "⚠️ 发现 " + str(red) + " 个疑似虚报（点下方任务看证据）"
    degraded = "" if git_ok else '<p style="color:#d97706">⚠️ git 不可用，本次物理核验降级</p>'

    # 面板2 诚信账本
    ledger_html = ""
    if ledger is None:
        ledger_html = '<p style="color:#9ca3af">诚信账本：bypass.log 缺失，暂无记录</p>'
    else:
        rows_l = []
        for ag, d in sorted(ledger["agents"].items(), key=lambda x: -(x[1]["committed"] + x[1]["blocked"])):
            total = d["committed"] + d["blocked"]
            pct = (100 * d["committed"] // total) if total else 0
            rows_l.append(f"<tr><td>{ag}</td><td>{d['committed']}</td><td>{d['blocked']}</td><td>{pct}%</td></tr>")
        rows_l.append(f"<tr><td style=\"color:#dc2626\">真绕过(detected-bypass)</td><td>{ledger['bypass_total']}</td><td colspan=\"2\">全局计数</td></tr>")
        ledger_html = ("<table><tr><th>员工(agent)</th><th>正常提交</th><th>被拦</th><th>诚信分</th></tr>"
                       + "".join(rows_l) + "</table>")

    # 面板3 北星对齐
    north_html = ""
    if north is None:
        north_html = '<p style="color:#9ca3af">北星对齐：PRODUCT-BRIEF.md 缺失，无法对照</p>'
    else:
        nrows = []
        unaligned = 0
        for tid, sec in north:
            if sec:
                nrows.append(f"<tr><td><b>{tid}</b></td><td style=\"color:#16a34a\">✅ {sec}</td></tr>")
            else:
                unaligned += 1
                nrows.append(f"<tr><td><b>{tid}</b></td><td style=\"color:#dc2626\">⚠️ 北星无对应 — 需创始人确认</td></tr>")
        north_head = ("北星对齐 " + str(len(north) - unaligned) + "/" + str(len(north)) + " ✅"
                      if unaligned == 0 else "⚠️ " + str(unaligned) + " 个任务与北星对不上")
        north_html = ('<p style="color:#666">' + north_head + '</p>'
                      "<table><tr><th>任务</th><th>服务北星哪个目标</th></tr>" + "".join(nrows) + "</table>")

    # CI 核验
    ci_label, ci_detail, ci_ok, ci_degraded = ci
    if ci_label is None:
        ci_html = '<div class="card"><div class="n" style="color:#9ca3af">?</div>CI 未知</div>'
    else:
        ci_color = colors.get(ci_label, "#9ca3af")
        ci_html = f'<div class="card"><div class="n" style="color:{ci_color}">{ci_label}</div>{ci_detail}</div>'

    css = ("body{font-family:-apple-system,'PingFang SC',sans-serif;max-width:960px;margin:24px auto;padding:0 16px;background:#f9fafb;color:#111}"
           "h1{font-size:22px}.h2{font-size:16px;margin:20px 0 8px;font-weight:700}.cards{display:flex;gap:12px;margin:16px 0}"
           ".card{flex:1;background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}"
           ".card .n{font-size:28px;font-weight:700}table{width:100%;background:#fff;border-radius:12px;border-collapse:collapse;box-shadow:0 1px 3px rgba(0,0,0,.08);margin:8px 0}"
           "td,th{padding:10px 12px;text-align:left;border-bottom:1px solid #eee;font-size:14px}th{background:#f3f4f6}"
           ".status{padding:12px 16px;border-radius:12px;color:#fff;font-weight:600;background:" + status_bg + "}")
    return ("<!DOCTYPE html>\n<html lang=\"zh\"><head><meta charset=\"utf-8\"><title>创始人控制台 · 零信任</title><style>" + css + "</style></head><body>\n"
            "<h1>🧭 创始人控制台 · 零信任</h1>\n"
            "<p style=\"color:#666\">物理核验（git/CI/北星事实），不是 agent 自报。每个数字都可点查证据。</p>\n"
            "<div class=\"status\">" + status_txt + "</div>\n"
            "<div class=\"cards\">"
            "<div class=\"card\"><div class=\"n\" style=\"color:#16a34a\">" + str(green) + "</div>🟢 真实</div>"
            "<div class=\"card\"><div class=\"n\" style=\"color:#d97706\">" + str(yellow) + "</div>🟡 待复核</div>"
            "<div class=\"card\"><div class=\"n\" style=\"color:#dc2626\">" + str(red) + "</div>🔴 疑似虚报</div>"
            + ci_html
            + "</div>\n" + degraded + "\n"
            "<div class=\"h2\">面板 1 · 哪些真做完了？（任务真相）</div>\n"
            "<table><tr><th>任务</th><th>它说</th><th>物理核验</th><th>判定</th></tr>" + rows_html + "</table>\n"
            + hist_html
            + "<div class=\"h2\">面板 2 · 哪些骗了我？（诚信账本）</div>\n" + ledger_html + "\n"
            "<div class=\"h2\">面板 3 · 方向跑偏了吗？（北星对齐）</div>\n" + north_html + "\n"
            "<p style=\"color:#999;font-size:12px\">每个判定都可复核：git log --all --format=%s | grep \"(D#)\" 验证提交；git merge-base 验证是否进 main。</p>\n"
            "</body></html>")


def main():
    offline = "--offline" in sys.argv
    rows, git_ok = collect(offline)
    if not git_ok:
        print("⚠ degraded: git 不可用，物理核验降级", file=sys.stderr)
    # 方案 B: 红绿灯只算活跃任务（hist=False）；历史任务折叠，不淹没当下信号
    active = [r for r in rows if not r.get("hist")]
    hist = [r for r in rows if r.get("hist")]
    green = sum(1 for r in active if judge(r["claimed"], r["phys"])[0] == "🟢")
    red = sum(1 for r in active if judge(r["claimed"], r["phys"])[0] == "🔴")
    yellow = sum(1 for r in active if judge(r["claimed"], r["phys"])[0] == "🟡")

    ledger = integrity_ledger()
    north, north_degraded = north_star_alignment(rows)
    ci = ci_status() if not offline else (None, "offline（跳过 CI 网络）", False, True)
    write_alert(rows)

    if "--html" in sys.argv:
        OUT_DIR.mkdir(parents=True, exist_ok=True)   # FIX-008: 同上
        HTML_OUT.write_text(render_html(rows, green, yellow, red, git_ok, ledger, north, ci), encoding="utf-8")
        print("已生成: " + str(HTML_OUT))
        return 1 if red > 0 else (2 if not git_ok else 0)

    print("# 创始人控制台 · 零信任（物理核验，非 agent 自报）\n")
    print("| 任务 | 它说 | 物理核验 | 判定 |")
    print("|------|------|----------|------|")
    for r in active:
        emoji, note = judge(r["claimed"], r["phys"])
        print("| " + r["id"] + " " + r["title"] + " | " + r["claimed"] + " | " + r["phys"] + " | " + emoji + " " + note + " |")
    if hist:
        hist_in_main = sum(1 for r in hist if r["phys"] == "已提交且进 main")
        print("\n> 📦 历史任务（已折叠）: " + str(len(hist)) + " 个（" + str(hist_in_main) + " 个进 main）——git log 全项目派生，非 task-state 登记")
    print("\n**小结：🟢 真实 " + str(green) + " · 🟡 待复核 " + str(yellow) + " · 🔴 疑似虚报 " + str(red) + "**（活跃任务 " + str(len(active)) + " 个 + 历史 " + str(len(hist)) + " 个）")
    # 面板2
    print("\n## 诚信账本（bypass.log 对账）")
    if ledger is None:
        print("（bypass.log 缺失）")
    else:
        for ag, d in sorted(ledger["agents"].items(), key=lambda x: -(x[1]["committed"] + x[1]["blocked"])):
            total = d["committed"] + d["blocked"]
            pct = (100 * d["committed"] // total) if total else 0
            print("  " + ag + ": 正常 " + str(d["committed"]) + " / 被拦 " + str(d["blocked"]) + " / 诚信 " + str(pct) + "%")
        print("  真绕过(detected-bypass): " + str(ledger["bypass_total"]) + " 次")
    # 面板3
    print("\n## 北星对齐（对照 PRODUCT-BRIEF.md）")
    if north is None:
        print("（PRODUCT-BRIEF.md 缺失）")
    else:
        for tid, sec in north:
            print("  " + tid + ": " + ("✅ " + sec if sec else "⚠️ 北星无对应 — 需创始人确认"))
    # CI
    ci_label, ci_detail, ci_ok, ci_degraded = ci
    print("\n## CI 最近一次: " + (ci_label + " " if ci_label else "?") + ci_detail)
    if red > 0:
        print("\n🚨 主动告警: " + str(red) + " 个疑似虚报，见 docs/synova/founder-alerts.md")
    return 1 if red > 0 else (2 if not git_ok else 0)


if __name__ == "__main__":
    sys.exit(main())
