#!/bin/bash
# 组装 #980 探针原始 run 输出为仓内证据（M6 收口）。逐字节取自 run_dir。
set -uo pipefail
cd /d/novis-backup-20260526/Novis/.synova-wt-980 || exit 1
OUT=docs/synova/product-lines/evidence/980/evidence-980-probe-run.txt
S=/tmp/synova-980-probe-out/20261008-020519

{
  echo "=== #980 探针原始 run 输出（落仓副本，逐字节取自 $S）==="
  echo "run_dir        = $S"
  echo "probe sha256   = $(sha256sum docs/synova/product-lines/evidence/980/probe-diagnosis.ts | awk '{print $1}')"
  echo "capture sha256 = $(sha256sum docs/synova/product-lines/evidence/980/capture-980-probe.sh | awk '{print $1}')"
  echo "validator sha256 = $(sha256sum src/l4/sog-schema-validator.ts | awk '{print $1}')"
  echo "HEAD           = $(git rev-parse HEAD)"
  echo ""
  echo "════════ [1] probe-output.txt（人读形态 stdout+stderr，逐字节）════════"
  cat "$S/probe-output.txt"
  echo ""
  echo "════════ [2] status-before.txt ════════"
  cat "$S/status-before.txt"
  echo "════════ [2b] status-after.txt ════════"
  cat "$S/status-after.txt"
  echo "──────── status-diff.txt 字节数 = $(wc -c < "$S/status-diff.txt")（0 = 前后逐字一致）────────"
  echo ""
  echo "════════ [3] hashes-before.txt ════════"
  cat "$S/hashes-before.txt"
  echo "════════ [3b] hashes-after.txt ════════"
  cat "$S/hashes-after.txt"
  echo "──────── hashes-diff.txt 字节数 = $(wc -c < "$S/hashes-diff.txt")（0 = 6/6 一致）────────"
  echo ""
  echo "════════ [4] probe-output.json（--json 形态，逐字节）════════"
  cat "$S/probe-output.json"
} > "$OUT"

echo "WROTE=$OUT lines=$(wc -l < "$OUT") bytes=$(wc -c < "$OUT")"
