#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# k3-birthcert-fixture.test.sh — 出生证六件套判据夹具（#932 PR-2 / 裁 348-①⑤）
#
# 夹具（本文件内联，可复跑）: 4 份"迷你交付"证据表，逐轴给证据；
#   判定器按 skill `synova-audit` §主判据（G1–G6）的**必备证据**口径机械判定。
# 期望（裁 348-①）: **任一轴缺失或证据不足 ⇒ 结论不得 PASS**（P0/FAIL）；P1 只留"建议"。
#
# 用例:
#   ① 六轴齐（G3 有真实路径断言 ＋ 改坏两态）⇒ 通过
#   ② 缺 G3（只有"测试全绿"结论）        ⇒ 不得 PASS（点名 G3）
#   ③ G3 恒真断言（expect(true)）         ⇒ 不得 PASS（点名 G3）
#   ④ 缺 G6（无三门禁汇总行）             ⇒ 不得 PASS（点名 G6）
#
# 用法: bash tests/control-tower/k3-birthcert-fixture.test.sh
# 退出码: 0 = 四例均符合期望 ｜ 1 = 有例不符（判据退化） ｜ 2 = 判据文本退化（skill 缺 P0 语义/§Q 表）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SKILL="$REPO_DIR/.synova/skills/synova-audit/SKILL.md"
PASS=0; FAIL=0
pass(){ PASS=$((PASS+1)); echo "  ✅ $1"; }
fail(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }

# 判据文本防退化（先查规则本身还在）
[ -f "$SKILL" ] || { echo "degraded: 缺 $SKILL"; exit 2; }
grep -q '不得 PASS' "$SKILL" || { echo "degraded: skill 缺「不得 PASS」语义（裁 348-① 未落）"; exit 2; }
qrows=$(grep -c '^| Q-' "$SKILL")
[ "$qrows" -eq 15 ] || { echo "degraded: skill §Q 表应 15 行，实测 $qrows"; exit 2; }

judge() { python3 - "$1" <<'PY'
import re,sys
txt=open(sys.argv[1],encoding='utf-8').read()
ev={}
for line in txt.splitlines():
    m=re.match(r'^(G[1-6]):\s*(.+)$', line.strip())
    if m: ev[m.group(1)]=m.group(2).strip()
norm=lambda v: v.replace('（','(').replace('）',')')
rules={
 'G1':lambda v: ('src/' in v) and ('WIRING' in v),
 'G2':lambda v: any(k in v for k in ('log.','degraded','throw')),
 'G3':lambda v: (('expect(' in v) or ('断言' in v) or ('assert' in v)) and any(k in v for k in ('两态','改坏','删掉','→')) and ('expect(true)' not in v),
 'G4':lambda v: (('safeParse' in v) or ('parse(' in v) or ('validate' in v)) and (('timeout' in v) or ('signal' in v)),
 'G5':lambda v: any(k in v for k in ('落盘','事务','事件')),
 'G6':lambda v: ('doc-truth' in v) and ('未登记' in v),
}
bad=[]
for ax in ['G1','G2','G3','G4','G5','G6']:
    v=ev.get(ax,'')
    if not v or not rules[ax](norm(v)): bad.append(ax)
print('PASS' if not bad else 'FAIL:'+','.join(bad))
PY
}

T=$(mktemp -d)
mk(){ cat > "$T/$1"; }

mk full.txt <<'EOF'
G1: 生产调用点 src/agent/router.ts:88（非测试）；WIRING 行 status=wired
G2: catch 带 log.warn + degraded:true（router.ts:95）
G3: 真实路径用例 router.test.ts:31 断言跳转表；改坏删除 :40 ⇒ 两态原始输出 2 passed→1 failed
G4: zod safeParse（routes/tool.ts:31）；fetch 带 signal: AbortSignal.timeout(5000)
G5: 事件落盘 append-only（store/events.ts:40）
G6: check-doc-truth ✅ 全部硬检查通过；doc-registry 0 未登记
EOF
mk noG3.txt <<'EOF'
G1: 生产调用点 src/agent/router.ts:88（非测试）；WIRING 行 status=wired
G2: catch 带 log.warn + degraded:true（router.ts:95）
G3: 已写测试，全绿（vitest 12 passed）
G4: zod safeParse（routes/tool.ts:31）；fetch 带 signal: AbortSignal.timeout(5000)
G5: 事件落盘 append-only（store/events.ts:40）
G6: check-doc-truth ✅；doc-registry 0 未登记
EOF
mk tautology.txt <<'EOF'
G1: 生产调用点 src/agent/router.ts:88（非测试）；WIRING 行 status=wired
G2: catch 带 log.warn + degraded:true（router.ts:95）
G3: expect(true) 通过；改坏两态已贴
G4: zod safeParse（routes/tool.ts:31）；fetch 带 signal: AbortSignal.timeout(5000)
G5: 事件落盘 append-only（store/events.ts:40）
G6: check-doc-truth ✅；doc-registry 0 未登记
EOF
mk noG6.txt <<'EOF'
G1: 生产调用点 src/agent/router.ts:88（非测试）；WIRING 行 status=wired
G2: catch 带 log.warn + degraded:true（router.ts:95）
G3: 真实路径用例 router.test.ts:31 断言跳转表；改坏两态原始输出
G4: zod safeParse（routes/tool.ts:31）；fetch 带 signal: AbortSignal.timeout(5000)
G5: 事件落盘 append-only（store/events.ts:40）
EOF

chk(){ local exp="${1}" nm="${2}" got; got=$(judge "$T/$nm"); echo "  夹具[${nm}] ⇒ ${got} （期望 ${exp}）";
  if [ "${exp}" = "PASS" ]; then
    if [ "${got}" = "PASS" ]; then pass "${nm} ⇒ 通过"; else fail "${nm} ⇒ 期望通过，实测 ${got}"; fi
  else
    case "${got}" in
      FAIL:*) case "${got}" in *"${exp}"*) pass "${nm} ⇒ 不得 PASS（点名 ${exp}）";; *) fail "${nm} ⇒ 点名错（实测 ${got}）";; esac;;
      *) fail "${nm} ⇒ 期望不得 PASS，实测 ${got}";;
    esac
  fi
}

echo "── 出生证夹具（4 例）──"
chk PASS full.txt
chk G3 noG3.txt
chk G3 tautology.txt
chk G6 noG6.txt
rm -rf "$T"
echo "── 结果: PASS=$PASS FAIL=$FAIL ──"
[ "$FAIL" -eq 0 ] || exit 1
echo "K3-BIRTHCERT-FIXTURE-OK"
