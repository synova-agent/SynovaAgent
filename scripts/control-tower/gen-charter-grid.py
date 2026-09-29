#!/usr/bin/env python3
"""宪章「三问」48 格 · HTML 看板生成器（D943）
输入：docs/synova/coordination/宪章三问-48格.json（机读单源）
输出：docs/synova/charter/三问-48格.html
四色：green=生效了 / yellow=接上了但没生效 / red=缺失 / empty=未填（显式待办，不伪装成绿）
"""
import json, html, os, sys, datetime
for s in ("stdout","stderr"):
    try: getattr(sys,s).reconfigure(encoding="utf-8",errors="replace")
    except Exception: pass
def main():
    repo=sys.argv[1] if len(sys.argv)>1 else "."
    src=os.path.join(repo,"docs/synova/coordination/宪章三问-48格.json")
    dst=os.path.join(repo,"docs/synova/coordination/三问-48格.html")
    d=json.load(open(src,encoding="utf-8")); cells=d["cells"]
    def cnt(st): return sum(1 for c in cells if c.get("status")==st)
    COL={"green":("#0a7d32","🟢 生效了"),"yellow":("#b8860b","🟡 接了但没生效"),
         "red":("#b3261e","🔴 缺失"),"empty":("#6b7280","⚪ 未填")}
    by={}
    for c in cells: by.setdefault((c["layer"],c["ext_point"]),{})[c["question"]]=c
    rows=[]
    for (layer,name),qs in by.items():
        tds=[]
        for qid in ("q1","q2","q3"):
            c=qs.get(qid,{})
            st=c.get("status","empty"); col,label=COL.get(st,COL["empty"])
            note=html.escape(c.get("judgement") or c.get("question_desc") or "")
            tds.append(f'<td class="{st}" title="{note}" style="border-left:4px solid {col}">'
                       f'<b>{label}</b><br><small>{note[:60]}</small></td>')
        pr=qs["q1"].get("priority","P1")
        rows.append(f'<tr><td class="layer">{html.escape(layer)}</td>'
                    f'<td class="name">{html.escape(name)} <small>({pr})</small></td>{"".join(tds)}</tr>')
    ts=datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    out=f"""<!doctype html><html lang="zh"><meta charset="utf-8">
<title>宪章「三问」48 格 · 可扩展性看板</title>
<style>
body{{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;margin:24px;color:#111}}
h1{{font-size:20px}} .sum{{margin:12px 0 20px;padding:12px;background:#f6f7f9;border-radius:8px}}
table{{border-collapse:collapse;width:100%;font-size:13px}}
th,td{{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top}}
th{{background:#f3f4f6}} td.empty{{background:#fafafa;color:#666}} td.green{{background:#e8f5e9}}
td.yellow{{background:#fff8e1}} td.red{{background:#fdecea}} td.layer{{white-space:nowrap;font-weight:600}}
td.name{{font-weight:600}} .rules{{font-size:12px;color:#444;margin-top:16px;line-height:1.7}}
code{{background:#f3f4f6;padding:1px 4px;border-radius:3px}}
</style><body>
<h1>宪章「三问」48 格 · 可扩展性看板</h1>
<div class="sum"><b>16 项扩展点 × 3 问 = 48 格</b> ｜
🟢 生效 {cnt('green')} ｜ 🟡 接了未生效 {cnt('yellow')} ｜ 🔴 缺失 {cnt('red')} ｜
⚪ <b>未填 {cnt('empty')}</b>（未填=待办，<b>不伪装成绿</b>）<br>
生成时间 {ts} ｜ 机读源 <code>docs/synova/coordination/宪章三问-48格.json</code></div>
<table><thead><tr><th>层</th><th>可扩展项</th><th>① 加了吗（存在性）</th><th>② 接上了吗（接线）</th><th>③ 生效了吗（结果）</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<div class="rules">
<b>判据规则</b>：每格必须是<b>穿生产入口的用例</b>，不是 grep 命中｜正向 + <b>改坏即红</b> + 降级三态<br>
<b>一句话判据</b>：非技术用户改完，系统必须能告诉他 ——「你这条改动，生效了／没生效，<b>因为 X</b>」<br>
<b>纪律</b>：同时最多 1 项（3 格）在制｜空格必须显式报（X27 缺失≠通过）｜做完立刻更新 JSON 并重跑本生成器
</div></body></html>"""
    os.makedirs(os.path.dirname(dst),exist_ok=True)
    open(dst,"w",encoding="utf-8").write(out)
    print("  ✅ 已生成: %s（%d 行 × 3 问）" % (dst,len(by)))
    return 0
if __name__=="__main__": sys.exit(main())
