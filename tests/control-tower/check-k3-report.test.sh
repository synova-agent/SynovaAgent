#!/usr/bin/env bash
# D943 — check-k3-report 判别夹具（密闭：只用 checkout 自身）
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
G="python3 $ROOT/scripts/control-tower/check-k3-report.py"
P=0; F=0
t(){ n="$1"; w="$2"; shift 2; "$@" >/tmp/k3t.out 2>&1; rc=$?
  if [ "$rc" = "$w" ]; then echo "  ✅ $n (rc=$rc)"; P=$((P+1)); else echo "  ❌ $n 期望 $w 实得 $rc"; sed 's/^/      /' /tmp/k3t.out|head -3; F=$((F+1)); fi; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
H=$(git -C "$ROOT" rev-parse HEAD)
# T1 合格报告
printf '# K3 报告\n断面: 0.1.7-rc.1 @ 46a7f68b\ncommit: %s\n\n| 判定 | 证据 |\n| PASS | scripts/pre-commit-check.sh:991 |\n\n```bash\nls\n```\n' "${H:0:8}" > "$T/ok.md"
t "T1 合格 = OK" 0 $G "$T/ok.md" --repo "$ROOT"
# T2 缺断面/对象声明
printf '# r\ncommit: %s\n\nPASS ｜ 无证据\n' "${H:0:8}" > "$T/nosec.md"
t "T2 缺断面声明 = VIOLATION" 1 $G "$T/nosec.md" --repo "$ROOT"
# T3 sha 不可解析
printf '# r\n断面: 0.1.7-rc.1 @ 46a7f68b\ncommit: deadbee\n\n| PASS | scripts/pre-commit-check.sh:991 |\n' > "$T/badsha.md"
t "T3 sha 不可解析 = VIOLATION" 1 $G "$T/badsha.md" --repo "$ROOT"
# T4 引用不存在
printf '# r\n断面: 0.1.7-rc.1 @ 46a7f68b\ncommit: %s\n\n| PASS | scripts/nope/nonexistent.sh:1 |\n' "${H:0:8}" > "$T/badcite.md"
t "T4 引用不存在 = VIOLATION" 1 $G "$T/badcite.md" --repo "$ROOT"
# T5 判定行无证据
printf '# r\n断面: 0.1.7-rc.1 @ 46a7f68b\ncommit: %s\n\n| PASS | 我看了没问题 |\n' "${H:0:8}" > "$T/noev.md"
t "T5 判定行无证据 = VIOLATION" 1 $G "$T/noev.md" --repo "$ROOT"
# T6 计数无命令块 → DEGRADED
printf '# r\n断面: 0.1.7-rc.1 @ 46a7f68b\ncommit: %s\n\n共检查了 12 份文件，均通过。\n' "${H:0:8}" > "$T/count.md"
t "T6 计数无命令 = DEGRADED" 2 $G "$T/count.md" --repo "$ROOT"
# T7 显式不涉及 DSH 断面
printf '# r\n被审对象: 本仓产品代码（不涉及 DSH 断面）\ncommit: %s\n\n| PASS | src/server.ts:1 |\n' "${H:0:8}" > "$T/nodsh.md"
t "T7 显式不涉及 DSH = OK" 0 $G "$T/nodsh.md" --repo "$ROOT"
# T8 报告不可读 → DEGRADED
t "T8 报告不可读 = DEGRADED" 2 $G "$T/missing.md" --repo "$ROOT"
echo "──── 结果: $P 通过, $F 失败 ────"
[ "$F" = "0" ] || exit 1
