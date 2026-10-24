#!/usr/bin/env bash
# post-merge-gate.sh — 合并后跑「未接 CI 的门禁」清单（裁 397 的 A′ 替代）
#
# @input  [<sha>]（缺省 HEAD）；环境：SYNO_PMG_ROOT（仓根，缺省=脚本上两级）
# @output 逐门禁 `PASS|FAIL|DEGRADED <name> rc=<n> :: <末行>` ＋ 汇总行
# @exit   0 全过 | 1 有门禁真红（打印 建议 revert <sha>） | 2 门禁自身失败/环境不可用
# @degraded 缺 git/仓根非法/清单里命令不存在 ⇒ stderr `degraded: ... [code=E_PMG_*]` + exit 2
# @known   清单是**硬编码**的；新增未接 CI 的门禁必须手动加进来（清单漂移 = 漏检）
# @authority CTO（合并后自跑）；任何人可只读运行
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SYNO_PMG_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SHA="${1:-HEAD}"
SELFCHECK=0
[ "${1:-}" = "--selfcheck" ] && { SELFCHECK=1; SHA="HEAD"; }

deg() { printf 'degraded: %s [code=%s]\n' "$1" "$2" >&2; exit 2; }
[ -d "$ROOT/.git" ] || [ -f "$ROOT/.git" ] || deg "不在 git 仓根: $ROOT" E_PMG_ROOT
command -v git >/dev/null 2>&1 || deg "缺 git" E_PMG_ENV
git -C "$ROOT" rev-parse --verify -q "$SHA" >/dev/null 2>&1 || deg "无效提交: $SHA" E_PMG_SHA

run_one() { # <name> <cmd...>
  local name="$1"; shift
  local out rc last
  out="$(cd "$ROOT" && "$@" 2>&1)"; rc=$?
  last="$(printf '%s\n' "$out" | tail -1)"
  case "$rc" in
    0) printf 'PASS %s :: %s\n' "$name" "$last" ;;
    1) printf 'FAIL %s rc=1 :: %s\n' "$name" "$last" ;;
    *) printf 'DEGRADED %s rc=%s :: %s\n' "$name" "$rc" "$last" ;;
  esac
  return "$rc"
}

if [ "$SELFCHECK" = "1" ]; then
  # 判别力自检：造一个必红门禁 ⇒ 必须被计为 FAIL 且汇总 exit 1
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  printf '#!/usr/bin/env bash\necho "SELFCHECK-FAIL 故意红"\nexit 1\n' > "$tmp/always-red.sh"; chmod +x "$tmp/always-red.sh"
  out="$(run_one selfcheck-red bash "$tmp/always-red.sh")"; rc=$?
  case "$out" in *FAIL*selfcheck-red*) : ;; *) echo "SELFCHECK-FAIL: 红夹具未被计 FAIL"; exit 2 ;; esac
  [ "$rc" = "1" ] || { echo "SELFCHECK-FAIL: 红夹具 rc=$rc（期望 1）"; exit 2; }
  # 变绿夹具 ⇒ 必须 PASS
  out2="$(run_one selfcheck-green bash -c 'echo OK; exit 0')"; rc2=$?
  case "$out2" in *PASS*selfcheck-green*) : ;; *) echo "SELFCHECK-FAIL: 绿夹具未计 PASS"; exit 2 ;; esac
  [ "$rc2" = "0" ] || { echo "SELFCHECK-FAIL: 绿夹具 rc=$rc2（期望 0）"; exit 2; }
  echo "SELFCHECK-OK: 2/2（红夹具⇒FAIL/1，绿夹具⇒PASS/0）"
  exit 0
fi

FAIL=0; DEG=0; N=0
while IFS='|' read -r name cmd; do
  [ -z "$name" ] && continue
  N=$((N+1))
  # shellcheck disable=SC2086
  run_one "$name" bash -c "$cmd" || case $? in
    1) FAIL=$((FAIL+1)) ;;
    *) DEG=$((DEG+1)) ;;
  esac
done <<'LIST'
obligations-scan|python3 scripts/control-tower/check-test-obligations.py --root . --base HEAD
obligations-test|bash tests/control-tower/check-test-obligations.test.sh
tool-args-scan|python3 scripts/control-tower/check-tool-args-delta.py --root . --base HEAD
tool-args-test|bash tests/control-tower/check-tool-args-delta.test.sh
merge-cond-selfcheck|bash scripts/control-tower/check-merge-conditions.sh --selfcheck
doc-registry|bash scripts/doc-system/doc-registry-gate.sh
LIST

echo "── 汇总: ${N} 项 · FAIL=${FAIL} · DEGRADED=${DEG} · sha=${SHA}"
if [ "$DEG" -gt 0 ]; then echo "POST-MERGE-GATE: degraded（有门禁自身失败，禁判绿）"; exit 2; fi
if [ "$FAIL" -gt 0 ]; then echo "POST-MERGE-GATE: FAIL — 建议 revert ${SHA}"; exit 1; fi
echo "POST-MERGE-GATE: OK"
exit 0
