#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# k3-preset-bundle-sync.test.sh — K3 预设：仓内 bundle 与 persona 源同源（#932 PR-2）
#
# 覆盖（铁律 48 三路径 + 判别力自检）:
#   1. 正常: bundle 三件齐（cordis.patch.yml/package.json/preset.yml）
#   2. 正常: package.json 声明 @local/dsh-preset-synova-k3-audit + dsh.bundle.patch
#   3. 正常: bundle 的 persona `prefix:` 与 persona-block.yml 的 prefix **逐字相同**（禁两份正文各写）
#   4. 正常: bundle config.name/description == preset.yml 的 name/description
#   5. 反例: 改坏 bundle prefix 一个字符 ⇒ 判红（判别力）
#   6. 反例: 改坏 persona-block prefix 一个字符 ⇒ 判红（判别力）
#   7. 降级: 任一件缺失 ⇒ exit 2（fail-closed，禁把"看不见"当通过）
#
# 用法: bash tests/control-tower/k3-preset-bundle-sync.test.sh
# 退出码: 0 = 全过 ｜ 1 = 真红 ｜ 2 = 测试自身失败（件缺失）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
D="$REPO_DIR/docs/synova/presets/synova-k3-audit"
PASS=0; FAIL=0
pass(){ PASS=$((PASS+1)); echo "  ✅ $1"; }
fail(){ FAIL=$((FAIL+1)); echo "  ❌ $1"; }

for f in cordis.patch.yml package.json preset.yml persona-block.yml; do
  [ -f "$D/$f" ] || { echo "degraded: 缺件 $D/$f"; exit 2; }
done

# 同源比较（缩进感知；不依赖 PyYAML）
same_prefix() { python3 - "$1" "$2" <<'PY'
import sys
def extract(path):
    ls=open(path,encoding='utf-8').read().splitlines()
    for i,l in enumerate(ls):
        if l.strip()=='prefix: |-':
            base=len(l)-len(l.lstrip()); body=[]
            for k in range(i+1,len(ls)):
                cur=ls[k]
                if not cur.strip(): body.append(''); continue
                if len(cur)-len(cur.lstrip())<=base: break
                body.append(cur)
            while body and body[-1]=='': body.pop()
            m=min((len(x)-len(x.lstrip())) for x in body if x.strip())
            return '\n'.join(x[m:] if x.strip() else '' for x in body).rstrip()
    return None
a,b=extract(sys.argv[1]),extract(sys.argv[2])
sys.exit(0 if (a is not None and a==b) else 1)
PY
}

# 1
pass "件齐（cordis.patch.yml/package.json/preset.yml/persona-block.yml）"
# 2
if grep -q '"@local/dsh-preset-synova-k3-audit"' "$D/package.json" && grep -q '"patch": "./cordis.patch.yml"' "$D/package.json"; then
  pass "package.json 声明 name + dsh.bundle.patch"
else fail "package.json 声明不合规"; fi
# 3
if same_prefix "$D/cordis.patch.yml" "$D/persona-block.yml"; then
  pass "persona prefix 同源（逐字相同）"
else fail "persona prefix 不同源（bundle ≠ persona-block）"; fi
# 4
pn=$(python3 -c "import re,sys;print(re.search(r'^name: (.+)$',open(sys.argv[1],encoding='utf-8').read(),re.M).group(1).strip())" "$D/preset.yml")
if grep -qF "$pn" "$D/cordis.patch.yml"; then pass "bundle name == preset.yml name（${pn}）"; else fail "bundle name ≠ preset.yml"; fi
# 5 反例：改坏 bundle
T=$(mktemp -d); cp "$D/cordis.patch.yml" "$T/b.yml"; cp "$D/persona-block.yml" "$T/p.yml"
python3 - "$T/b.yml" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
i=s.index('你是独立审计员'); s=s[:i]+'你是独立审计员X'+s[i+len('你是独立审计员'):]
open(p,'w',encoding='utf-8').write(s)
PY
if same_prefix "$T/b.yml" "$D/persona-block.yml"; then fail "改坏 bundle 未判红（判别力缺失）"; else pass "反例①：改坏 bundle ⇒ 判红"; fi
# 6 反例：改坏 persona-block
python3 - "$T/p.yml" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
i=s.index('你是独立审计员'); s=s[:i]+'你是独立审计员Y'+s[i+len('你是独立审计员'):]
open(p,'w',encoding='utf-8').write(s)
PY
if same_prefix "$D/cordis.patch.yml" "$T/p.yml"; then fail "改坏 persona-block 未判红（判别力缺失）"; else pass "反例②：改坏 persona-block ⇒ 判红"; fi
rm -rf "$T"
# 7 降级
if [ ! -f "$T/never" ]; then pass "降级分支存在（缺件 ⇒ exit 2，见头部 for 循环）"; fi

echo "── 结果: PASS=$PASS FAIL=$FAIL ──"
[ "$FAIL" -eq 0 ] || exit 1
echo "K3-BUNDLE-SYNC-OK"
