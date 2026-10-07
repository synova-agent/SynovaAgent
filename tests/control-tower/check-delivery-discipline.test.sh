#!/usr/bin/env bash
# tests/control-tower/check-delivery-discipline.test.sh — D796 交付纪律三闸
#
# 覆盖矩阵:
#   C1 归属: 一致(绿) / 跨任务分支-小写真实形态(红) / main 上改代码(红) / 纯文档跳过(绿)
#   C2 完工: impl 空(红) / 写集路径未落库(红) / 完工落库(绿) / 无完工态(跳过绿)
#   C3 派单: 缺四件套(红) / 四件套齐(绿)
#   三态:  非 git 目录(exit 2 DEGRADED)
#   scan:  游离代码改动(红) / 干净(绿)
#   接线:  生产调用点（pre-commit-check.sh 引用本脚本）
# 设计: 全部在 mktemp 夹具 git 仓内跑，零真实仓库写入、零网络。
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GATE="$ROOT/scripts/control-tower/check-delivery-discipline.sh"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
no(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
W="$T/r"
BRIEF_REL=".claude/task-briefs/2026-09-17-D796-t.md"

mk(){ # mk <branch> — 新夹具仓（含首个提交）
  rm -rf "$W"; mkdir -p "$W/.claude/task-briefs"
  ( cd "$W" && git init -q . && git config user.email t@t && git config user.name t \
    && git symbolic-ref HEAD "refs/heads/$1" && echo base > README.md && git add README.md && git commit -qm init )
}
brief(){ # brief <D#> [ws] — [ws] 时附机器写集块（列 dsh/plugins/x/lib/a.js）
  { printf '# Task Brief: %s x\n> 生成: 2026-09-17\n#CRITERIA: A\n## Q0: 定位\n## Q1: 调研\n## Q2: 范围\n## Q3: 验收\n## 架构层: scripts\n## Done 标准\n- [ ] verify: true\n' "$1"
    if [ "${2:-}" = "ws" ]; then
      printf '\n## 写集（机器生成，禁手改）\n\n| 文件 | 类型 |\n|---|---|\n| dsh/plugins/x/lib/a.js | task |\n\n'
    fi
  } > "$W/$BRIEF_REL"
  printf '%s\n' "$W/$BRIEF_REL" > "$W/.claude/current-brief"
}
card(){ # card <status> <impl-json>
  mkdir -p "$W/task-state"
  printf '{"task_id":"D796","status":"%s","impl":%s}\n' "$1" "$2" > "$W/task-state/D796.json"
}
rung(){ ( cd "$W" && bash "$GATE" --repo "$W" 2>&1 ); }
rc(){ ( cd "$W" && bash "$GATE" --repo "$W" >/dev/null 2>&1 ); echo $?; }
code(){ mkdir -p "$W/dsh/plugins/x/lib"; echo "// a" > "$W/dsh/plugins/x/lib/a.js"; }

# ── C1 ──
mk "feat/d796-own"; brief D796; code; ( cd "$W" && git add -A )
out="$(rung)"; r="$(rc)"
if [ "$r" = "0" ] && echo "$out" | grep -q 'C1: 分支归属一致'; then ok "C1 一致(绿)"; else no "C1 一致(绿) rc=$r"; fi

mk "feat/d782-other-task"; brief D796; code; ( cd "$W" && git add -A )
out="$(rung)"; r="$(rc)"
if [ "$r" = "1" ] && echo "$out" | grep -q '别人的任务分支'; then ok "C1 跨任务分支·小写真实形态(红)"; else no "C1 跨任务(红) rc=$r out=$(echo "$out"|grep C1|head -1)"; fi

mk "main"; brief D796; mkdir -p "$W/src"; echo "// a" > "$W/src/a.ts"; ( cd "$W" && git add -A )
out="$(rung)"; r="$(rc)"
if [ "$r" = "1" ] && echo "$out" | grep -q '共享分支'; then ok "C1 main 上改代码(红)"; else no "C1 main(红) rc=$r"; fi

mk "feat/d796-own"; brief D796; mkdir -p "$W/docs"; echo x > "$W/docs/x.md"; ( cd "$W" && git add -A )
out="$(rung)"; r="$(rc)"
if [ "$r" = "0" ] && echo "$out" | grep -q 'C1: 无代码路径变更'; then ok "C1 纯文档跳过(绿)"; else no "C1 纯文档 rc=$r"; fi

# ── C2 ──
mk "feat/d796-own"; brief D796; code; card impl_done null; ( cd "$W" && git add -A )
out="$(rung)"; r="$(rc)"
if [ "$r" = "1" ] && echo "$out" | grep -q 'impl 为空'; then ok "C2 完工无 impl(红)"; else no "C2 无 impl(红) rc=$r"; fi

mk "feat/d796-own"; brief D796 ws; code
mkdir -p "$W/dsh/plugins/y"; echo "// b" > "$W/dsh/plugins/y/b.js"
printf '| dsh/plugins/y/b.js | task |\n' >> "$W/$BRIEF_REL"     # 写集声明了未落库路径
card impl_done '"branch: feat/d796-own"'
( cd "$W" && git add .claude task-state dsh/plugins/x )
out="$(rung)"; r="$(rc)"
if [ "$r" = "1" ] && echo "$out" | grep -q '写集路径未进 git'; then ok "C2 写集路径未落库(红)"; else no "C2 未落库(红) rc=$r out=$(echo "$out"|grep C2|head -1)"; fi

mk "feat/d796-own"; brief D796 ws; code; card impl_done '"branch: feat/d796-own"'
( cd "$W" && git add .claude task-state dsh )
out="$(rung)"; r="$(rc)"
if [ "$r" = "0" ] && echo "$out" | grep -q '写集路径全部已入库'; then ok "C2 完工落库(绿)"; else no "C2 绿 rc=$r out=$(echo "$out"|grep C2|head -1)"; fi

mk "feat/d796-own"; brief D796; code; card claimed null; ( cd "$W" && git add -A )
out="$(rung)"; r="$(rc)"
if [ "$r" = "0" ] && echo "$out" | grep -q 'C2: 无完工态'; then ok "C2 无完工态跳过(绿)"; else no "C2 跳过 rc=$r"; fi

# ── C3 ──
mk "feat/d796-own"; brief D796; mkdir -p "$W/docs/synova/coordination"
echo "# 派单：做点事" > "$W/docs/synova/coordination/派单-x-20260917.md"
( cd "$W" && git add -A )
out="$(rung)"; r="$(rc)"
if [ "$r" = "1" ] && echo "$out" | grep -q '缺交付纪律四件套'; then ok "C3 缺四件套(红)"; else no "C3 缺件(红) rc=$r"; fi

mk "feat/d796-own"; brief D796; mkdir -p "$W/docs/synova/coordination"
cat > "$W/docs/synova/coordination/派单-x-20260917.md" <<'MD'
# 派单：x
执行方请开自己的 worktree 与分支 feat/d796-x。
前置：先建 task brief。
写集：用 declare-write-set 生成机器块。
完工判据：PR 合并 才算完工。
MD
( cd "$W" && git add -A )
out="$(rung)"; r="$(rc)"
if [ "$r" = "0" ] && echo "$out" | grep -q '四件套齐备'; then ok "C3 四件套齐(绿)"; else no "C3 绿 rc=$r out=$(echo "$out"|grep C3|head -1)"; fi

# ── 三态降级 ──
mkdir -p "$T/notgit"; out="$(bash "$GATE" --repo "$T/notgit" 2>&1)"; r=$?
if [ "$r" = "2" ] && echo "$out" | grep -q 'DISCIPLINE-DEGRADED'; then ok "非 git → exit 2 降级"; else no "非 git rc=$r"; fi

# ── scan 模式 ──
mk "feat/d796-own"; brief D796; mkdir -p "$W/dsh"; echo dirty > "$W/dsh/dirty.js"
out="$(cd "$W" && bash "$GATE" --repo "$W" --scan 2>&1)"; r=$?
if [ "$r" = "1" ] && echo "$out" | grep -q '游离代码改动'; then ok "scan 游离改动(红)"; else no "scan 红 rc=$r"; fi
( cd "$W" && rm -f dsh/dirty.js )
out="$(cd "$W" && bash "$GATE" --repo "$W" --scan 2>&1)"; r=$?
if [ "$r" = "0" ] && echo "$out" | grep -q 'DISCIPLINE-OK'; then ok "scan 干净(绿)"; else no "scan 绿 rc=$r"; fi

# ── 接线 ──
if grep -q 'check-delivery-discipline' "$ROOT/scripts/pre-commit-check.sh"; then ok "接线: pre-commit 调用点在场"; else no "接线: pre-commit 未调用"; fi

echo "────────────────────────────────────────────"
echo "  合计: ${PASS} 通过 / ${FAIL} 失败"
[ "$FAIL" -eq 0 ] || exit 1
echo "✅ 全部通过"
