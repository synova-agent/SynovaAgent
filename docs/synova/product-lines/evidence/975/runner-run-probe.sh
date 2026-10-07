#!/usr/bin/env bash
# runner: 跑 batch0a 探针，原始 stdout/stderr 落 $2/$1.{stdout,stderr}.log，并自动恢复探针造成的仓库污染
set -u
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
WT=/Users/wane/SynovaAgent/.synova-wt-0gate
TAG="$1"; OUT="$2"
cd "$WT" || exit 1
echo "--- [$TAG] cwd=$WT HEAD=$(git rev-parse HEAD) node=$(node --version) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
node_modules/.bin/tsx tests/loops/probes/batch0a-probes.ts > "$OUT/$TAG.stdout.log" 2> "$OUT/$TAG.stderr.log"
echo "probe_exit=$?"
echo "D9_hits=$(grep -c 'D9] MainAgent 未注入' "$OUT/$TAG.stderr.log" || true)"
git checkout -- extensions/industries/ 2>/dev/null
echo "pollution_restored=yes"
