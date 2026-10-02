#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# D1039-A4v-reconcile.sh — A4-v 独立复核的对账命令（**持久化转存**）
#
# 来历: 该脚本由独立复核员 **verifier-v** 编写，原落点为 `/tmp/v-a4-reconcile.sh`（易失）。
#       因「本批交付依赖它产出改动后墙钟对比 + 必需 context 断言」，队长（synova-squad-lead）
#       于 2026-09-28 逐字转存入仓，使 run 出现时**任何人**可复跑，
#       不依赖某个进程或某个 /tmp。
#
# ⚠️ 归属声明: **逻辑与写法属 verifier-v 的工具**，队长只做转存与加头注释；
#    真实性以其证据文件 `D1039-A4v-独立复核-墙钟比对.md` 的 §7 为准。
#
# 契约（铁律 47）:
#   @input  — <run_id> [<run_id> ...]（本仓 Actions run id）
#   @output — ① run 元数据（workflow/event/branch/run_started_at/updated_at/conclusion）
#             ② 逐 job：原始 `started_at` / `completed_at` / **自算 elapsed 秒数**
#             ③ CT 双平台判读：真执行（>60 s）vs 跳过态（<60 s）
#             ④ **必需 context 断言**：两个 `Control Tower Gate Tests (…-latest)` 必须出现且 `success`
#             ⑤ 两种口径墙钟：`max(completed_at) − min(started_at)`（job 跨度）
#                与 `updated_at − run_started_at`（**run 级墙钟，本批判据口径**）
#   @exit   — 恒 0（报告型工具；判读在输出里，不在退出码）
#   @degraded — 无网络 / API 配额耗尽（匿名 60/h）⇒ curl 返回错误体 ⇒ 输出里可见非 JSON；
#               **不以退出码伪装成功**（使用者须看输出）
#   @usage  — bash docs/synova/product-lines/evidence/D1039-A4v-reconcile.sh <run_id> [<run_id>...]
#
# 口径纪律（本批实测得出，见 D1039-收尾三件-diff-自验-遗留.md §二）:
#   1. **run 墙钟 = `updated_at − run_started_at`**，不是 job 跨度
#   2. **任何「提速」结论必须先证明该 step 真跑过**（`conclusion != skipped`）——
#      docs-only run 的同 job 只有 17 s，那是守卫把整个 step skip 掉的形态
# ═══════════════════════════════════════════════════════════════════════════════
set -u
for r in "$@"; do
  export RUNID="$r"
  echo "════════ run $r ════════"
  curl -s "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs/$r" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('workflow:',d.get('name'),'| event:',d.get('event'),'| branch:',d.get('head_branch'))
print('run_started_at:',d.get('run_started_at'),'| updated_at:',d.get('updated_at'),'| conclusion:',d.get('conclusion'),'| status:',d.get('status'))
"
  curl -s "https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs/$r/jobs?per_page=100" \
  | python3 -c "
import json,sys,datetime,os
d=json.load(sys.stdin)
js=d.get('jobs',[])
def sec(a,b):
    if not a or not b: return None
    f='%Y-%m-%dT%H:%M:%SZ'
    return int((datetime.datetime.strptime(b,f)-datetime.datetime.strptime(a,f)).total_seconds())
print('%-58s %-10s %-22s %-22s %8s' % ('JOB','CONCL','STARTED_AT','COMPLETED_AT','ELAPSED_S'))
for j in sorted(js,key=lambda x:x['started_at'] or ''):
    s=sec(j.get('started_at'),j.get('completed_at'))
    print('%-58s %-10s %-22s %-22s %8s' % (j['name'], j.get('conclusion'), j.get('started_at'), j.get('completed_at'), s if s is not None else 'N/A'))
ct=[j for j in js if j['name'].startswith('Control Tower Gate Tests')]
print()
print('--- CT 双平台（必需 context）断言 ---')
for j in ct:
    s=sec(j.get('started_at'),j.get('completed_at'))
    kind='真执行(>60s)' if (s or 0)>60 else '跳过态(<60s)'
    print('  %-46s conclusion=%-8s %s s ⇒ %s' % (j['name'], j.get('conclusion'), s, kind))
for want in ['Control Tower Gate Tests (ubuntu-latest)','Control Tower Gate Tests (windows-latest)']:
    m=[j for j in js if j['name']==want]
    if not m: print('  ❌ 断言失败: 必需 context 缺失 ->',want)
    elif m[0].get('conclusion')!='success': print('  ❌ 断言失败: %s conclusion=%s (非 success)'%(want,m[0].get('conclusion')))
    else: print('  ✅ %s: 出现且 success'%want)
print()
import urllib.request
rd=json.load(urllib.request.urlopen('https://api.github.com/repos/tangbaobao520/SynovaAgent/actions/runs/%s'%os.environ['RUNID']))
starts=[j['started_at'] for j in js if j.get('started_at')]
ends=[j['completed_at'] for j in js if j.get('completed_at')]
tot=sec(min(starts), max(ends)) if starts and ends else None
print('ci.yml 总墙钟(jobs min(started_at)→max(completed_at)):', tot, 's', '| 公式: max(completed_at) - min(started_at)')
print('  min(started_at) =', min(starts), ' max(completed_at) =', max(ends))
print('run 级 run_started_at→updated_at:', sec(rd.get('run_started_at'), rd.get('updated_at')), 's')

"
done
