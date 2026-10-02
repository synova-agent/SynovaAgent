#!/usr/bin/env bash
# D943 — check-dsh-anchor 判别夹具（密闭：只用 checkout 自身与临时目录，不依赖本机 DSH 树）
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="python3 $ROOT/scripts/control-tower/check-dsh-anchor.py"
PASS=0; FAIL=0
t() { local name="$1"; shift; local want="$1"; shift
  "$@" >/tmp/dsh-anchor-t.out 2>&1; local rc=$?
  if [ "$rc" = "$want" ]; then echo "  ✅ $name (rc=$rc)"; PASS=$((PASS+1));
  else echo "  ❌ $name 期望 rc=$want 实得 rc=$rc"; sed 's/^/      /' /tmp/dsh-anchor-t.out | head -3; FAIL=$((FAIL+1)); fi; }
# D943-FIX: rc + 结论串双断言（T11/T12 需证明"判到违规/判到通过"，而非仅"退出码非零"）
tg() { local name="$1"; shift; local want="$1"; shift; local pat="$1"; shift
  "$@" >/tmp/dsh-anchor-t.out 2>&1; local rc=$?
  if [ "$rc" = "$want" ] && grep -qF "$pat" /tmp/dsh-anchor-t.out; then
    echo "  ✅ $name (rc=$rc, 输出含「${pat}」)"; PASS=$((PASS+1));
  else echo "  ❌ $name 期望 rc=$want 且输出含「${pat}」，实得 rc=$rc"; sed 's/^/      /' /tmp/dsh-anchor-t.out | head -3; FAIL=$((FAIL+1)); fi; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
HEAD=$(git -C "$ROOT" rev-parse --short HEAD)
mk(){ python3 - "$1" "$2" "$3" <<'PY'
import json,sys
path,head,out=sys.argv[1],sys.argv[2],sys.argv[3]
json.dump({"current":{"version":"0.1.7-rc.1","head":head,"tag":"dsh-v0.1.7-rc.1","path":path,"recorded_at":"test"},
 "superseded":[{"version":"0.1.7-alpha.2","head":"00102833","retired_at":"2026-09-24","reason":"test"}],
 "known_versions":["0.1.7-rc.1","0.1.7-alpha.2"]},open(out,"w",encoding="utf-8"),ensure_ascii=False)
PY
}
mk "$ROOT" "$HEAD" "$TMP/ok.json"            # 事实源绑定 checkout 自身 → 密闭
mkdir -p "$TMP/empty" "$TMP/s1" "$TMP/s2" "$TMP/s3" "$TMP/s4" "$TMP/s5"
echo 'DSH = 0.1.9-alpha.9' > "$TMP/s1/a.md"
echo 'TS: 0.1.7-alpha.2 @ 00102833' > "$TMP/s2/b.md"
printf '# x\n\n## 引用豁免\n\n- 0.1.7-alpha.2 @ 00102833 — 历史留档\n' > "$TMP/s3/c.md"
# T11（K3 批次4 §1.4 逃逸向量原样复现）：行内含 superseded 字样但不在豁免段 → 不得触发豁免
printf '# t11\nsuperseded 历史留档\n现状断面为 0.1.7-alpha.2 @ 00102833（本行含 superseded 逃逸字样）\n' > "$TMP/s4/a.md"
# T12：`## 引用豁免` 段内的逐行显式条目 → 生效
printf '# t12\n\n## 引用豁免\n\n- 0.1.7-alpha.2 @ 00102833 — 历史留档（逐行显式条目）\n\n## 下一节\n\n正文无断面引用。\n' > "$TMP/s5/a.md"

t "T1 正常（事实源=checkout，树在场且一致）= OK" 0 $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --tree "$ROOT" --scan-dir "$TMP/empty"
t "T2 事实源缺失 = DEGRADED" 2 $GATE --repo "$ROOT" --anchor "$TMP/none.json" --tree "$ROOT" --scan-dir "$TMP/empty"
echo '{ bad' > "$TMP/bad.json"
t "T3 事实源非法 JSON = DEGRADED" 2 $GATE --repo "$ROOT" --anchor "$TMP/bad.json" --tree "$ROOT" --scan-dir "$TMP/empty"
mk "$ROOT" deadbeef "$TMP/moved.json"
t "T4 树已移动（head 不符）= DEGRADED" 2 $GATE --repo "$ROOT" --anchor "$TMP/moved.json" --tree "$ROOT" --scan-dir "$TMP/empty"
t "T5 未登记版本串 = VIOLATION" 1 $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --tree "$ROOT" --scan-dir "$TMP/s1"
t "T6 引用已作废断面 = VIOLATION" 1 $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --tree "$ROOT" --scan-dir "$TMP/s2"
t "T7 豁免段内 = OK" 0 $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --tree "$ROOT" --scan-dir "$TMP/s3"
t "T8 空扫描 = OK" 0 $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --tree "$ROOT" --scan-dir "$TMP/empty"
t "T9 树路径不存在 = DEGRADED" 2 $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --tree "$TMP/nodir" --scan-dir "$TMP/empty"
t "T10 CI 模式 --no-tree-check（无本地 DSH 树仍只查文档）= OK" 0 $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --no-tree-check --scan-dir "$TMP/empty"
tg "T11 段外 keyword(superseded) 不豁免 = VIOLATION(1)" 1 "VIOLATION(1)" $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --tree "$ROOT" --scan-dir "$TMP/s4"
tg "T12 豁免段内逐行显式条目 = OK" 0 "DSH-ANCHOR: OK" $GATE --repo "$ROOT" --anchor "$TMP/ok.json" --tree "$ROOT" --scan-dir "$TMP/s5"
echo "──── 结果: $PASS 通过, $FAIL 失败 ────"
[ "$FAIL" = "0" ] || exit 1
