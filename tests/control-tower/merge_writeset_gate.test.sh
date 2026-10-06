#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# merge_writeset_gate.test.sh — D708 合并级写集对账 gate 的密封测试
#
# 背景（M2 族第三次止血）: #449 夹带 51 文件 / #442 夹带 6 文件 / D593-FIX 声称提交实未提交。
# 现有门禁的盲区: pre-commit 只看单提交暂存区；verify-parallel（ci.yml L51-57）只比对
# **已合 PR 之间**的写集重叠（inter-PR），不校验单 PR 与自己声明的一致性（intra-PR）。
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   ① 正常放行  — 变更集 ⊆ 声明写集 → exit 0
#   ② 夹带必红  — 1 个声明外文件 → exit 1 + **逐文件点名**
#   ③ fail-closed — 三源皆无声明且含源码变更 → exit 2（绝不静默放行）
#   ④ 声明豁免  — `## 写集豁免` 段落（含理由）→ exit 0 且打印理由
#   ⑤ 内置豁免  — .claude/bypass.log（hook 证据账本）→ exit 0 且打印理由
#   ⑥ 分支豁免  — auto/** 自动分支 → skip
#   ⑦ 判定失败  — 取不到 merge-base → exit 2（degraded，不假装通过）
#   ⑧ 文档降级  — 无声明但全为文档范围 → skip + degraded 登记
#   接线        — ci.yml 真的调用本 gate（防「机制建成未接线」M3；D664 刚踩过同型）
# 沙箱: mktemp git 仓库 + 复制 scripts/control-tower 解析器，零网络零真实仓库依赖
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE
# ── 平台方言硬约束（windows-compat 模式 1/2）: **禁裸 python3** ──
#   Win Git Bash 常无 python3（仅 python/py），且损坏 shim 须试运行才可判可用（D330）。
#   探测失败 → 显式 exit 2（夹具无法判定 ≠ 通过）。
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "  ❌ PYBIN 不可用（python3/python/py 均缺失或不可运行）—— 夹具无法判定，显式失败而非静默跳过" >&2
  exit 2
fi
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$REPO/scripts/control-tower/merge_writeset_gate.py"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

echo "=== D708: merge-writeset-gate ==="

# ── 接线: ci.yml 必须真的调用本 gate（D664 教训: 建了网不接线 = 纸老虎）──
grep -q 'merge_writeset_gate.py' "$REPO/.github/workflows/ci.yml" \
  && ok "接线: ci.yml 调用 merge_writeset_gate.py" || no "接线: ci.yml 未调用（M3 未接线）"

# ── 沙箱仓库 ──
SB="$TMPD/sb"
mkdir -p "$SB/scripts/control-tower" "$SB/.claude/task-briefs" "$SB/src" "$SB/docs"
cp "$REPO/scripts/control-tower/merge_writeset_gate.py" "$SB/scripts/control-tower/"
cp "$REPO/scripts/control-tower/brief_parser.py" "$SB/scripts/control-tower/"
cp "$REPO/scripts/control-tower/devdoc_writeset.py" "$SB/scripts/control-tower/"
git -C "$SB" init -q
git -C "$SB" config user.email t@t.local
git -C "$SB" config user.name t
printf 'seed\n' > "$SB/seed.txt"
git -C "$SB" add -A >/dev/null 2>&1
git -C "$SB" commit -q -m "chore: base"
BASE=$(git -C "$SB" rev-parse HEAD)

mkbrief() { # $1 = 额外段落（写 brief 文件）
  { printf '#CRITERIA: A\n\n# Task Brief: D708 sandbox\n> 认领: 🛠 编码 session\n\n'
    printf '## Q0: 定位\n### a) 拼图\n控制塔。\n\n## Q1: 调研\n铁律 35。\n\n'
    printf '## Q2: 范围 — 最简方案\n做什么:\n- src/a.ts\n不做什么:\n- 不改 scripts/audit/audit-rules.sh\n\n'
    printf '## Q3: 验收\n入口: CI。\n\n## 架构层: scripts\n\n## Done 标准\n- [x] verify: x\n'
    [ -n "$1" ] && printf '%s\n' "$1"
  } > "$SB/.claude/task-briefs/2026-09-12-D708-sandbox.md"
}
run_gate() { # $@ = 额外 gate 参数
  (cd "$SB" && "$PYBIN" "$SB/scripts/control-tower/merge_writeset_gate.py" \
     --repo-root "$SB" --base "$BASE" --head HEAD --branch "${BRANCH:-fix/D708-sandbox}" "$@" 2>&1)
}

# 场景隔离: 每场景先「清 src + 写 brief → 提交 → 记为 BASE」，使 --base..HEAD 只含本场景改动。
# （否则脚手架自身会被算进变更集 → 假夹带）
reset_sandbox() { # $1 = 豁免段落（可空）; $2 = --no-brief 表示删掉 brief
  rm -f "$SB/src/"*.ts 2>/dev/null || true
  if [ "${2:-}" = "--no-brief" ]; then
    rm -f "$SB/.claude/task-briefs/2026-09-12-D708-sandbox.md"
  else
    mkbrief "${1:-}"
  fi
  git -C "$SB" add -A >/dev/null 2>&1
  git -C "$SB" commit -q -m "chore: scaffold"
  BASE=$(git -C "$SB" rev-parse HEAD)
}
commit_it() { # 提交**必须真的产生变更** —— 否则 git 静默失败（无差异），BASE..HEAD 变空，
              # 后续断言会落进 gate 的"变更集为空 → exit 0"早期分支而**恒绿**（假信心）。
              # D954 实测: ⑨b 第二段曾因重复写同内容触发此坑。
  git -C "$SB" add -A >/dev/null 2>&1
  if ! git -C "$SB" commit -q -m "$1"; then
    no "commit_it 未产生提交（无差异或提交失败）: $1 —— 后续断言将失去判别性"
    return 1
  fi
}

# ── ① 正常放行 ──
reset_sandbox ""
printf 'a\n' > "$SB/src/a.ts"; commit_it "feat(D708): declared only"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 0 ] && ok "① 正常放行: 变更集 ⊆ 声明 → exit 0" || no "① 期望 exit 0，实得 $rc :: $(echo "$OUT" | tail -2)"

# ── ② 夹带必红（恰好 1 个写集外文件）──
reset_sandbox ""
printf 'a\n' > "$SB/src/a.ts"; printf 'b\n' > "$SB/src/b_smuggled.ts"; commit_it "feat(D708): smuggle"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 1 ] && ok "② 夹带 → exit 1（业务阻断）" || no "② 期望 exit 1，实得 $rc"
echo "$OUT" | grep -q 'src/b_smuggled.ts' && ok "② 逐文件点名夹带文件" || no "② 未点名夹带文件"
echo "$OUT" | grep -q '夹带文件 1 个' && ok "② 计数正确（1 个）" || no "② 计数不符: $(echo "$OUT" | grep -a 夹带 | head -1)"
echo "$OUT" | grep -q '修复指引' && ok "② 输出修复指引（三选一）" || no "② 缺修复指引"
# D861: 修复指引必须给得出**可执行**输出——逐文件精确路径豁免行可直接粘贴（CTO 实证踩坑：模糊描述不被接受）
echo "$OUT" | grep -q '可直接粘贴的精确豁免行' && ok "② D861 指引含可粘贴豁免行标题" || no "② 缺可粘贴豁免行标题"
echo "$OUT" | grep -q -- '- src/b_smuggled.ts — <理由' && ok "② D861 夹带文件逐条给出精确路径豁免行" || no "② 未逐条给出精确路径豁免行"
echo "$OUT" | grep -q '模糊描述' && ok "② D861 明示模糊描述不被匹配" || no "② 未明示模糊描述风险"
echo "$OUT" | grep -q 'S3:brief.Q2-include' && ok "② 输出声明源（可审计哪个源收录）" || no "② 未标注声明源"

# 撤回夹带 → 转绿（T3 实证的本地等价）
rm -f "$SB/src/b_smuggled.ts"; commit_it "fix(D708): revert smuggle"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 0 ] && ok "② 撤回夹带 → 转绿（exit 0）" || no "② 撤回后仍红: $(echo "$OUT" | tail -2)"

# ── ③ fail-closed: 三源皆无声明 + 含源码变更 ──
reset_sandbox "" --no-brief
printf 'c\n' > "$SB/src/c_undeclared.ts"; commit_it "feat(D708): no declaration"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 2 ] && ok "③ 无声明 + 源码变更 → exit 2（fail-closed）" || no "③ 期望 exit 2，实得 $rc"
echo "$OUT" | grep -q 'fail-closed' && ok "③ 明示 fail-closed 语义" || no "③ 未明示 fail-closed"
grep -q 'merge-writeset-gate' "$SB/.codex/control-tower/logs/degraded-events.log" 2>/dev/null \
  && ok "③ 降级登记落盘（铁律 11 不静默）" || no "③ 未登记 degraded-events.log"

# ── ④ 声明豁免（含理由）生效 ──
reset_sandbox $'## 写集豁免\n- src/c_undeclared.ts — sandbox 豁免演示：该文件属并行线只读引用'
printf 'c\n' > "$SB/src/c_undeclared.ts"; commit_it "feat(D708): exempted"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 0 ] && ok "④ 显式豁免生效 → exit 0" || no "④ 豁免未生效: rc=$rc"
echo "$OUT" | grep -q 'sandbox 豁免演示' && ok "④ 打印豁免理由" || no "④ 未打印豁免理由"
# 反例: 豁免条目无理由 → 不生效（门禁不许被无声改软）
reset_sandbox $'## 写集豁免\n- src/c_undeclared.ts'
printf 'c\n' > "$SB/src/c_undeclared.ts"; commit_it "feat(D708): unreasoned exempt"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 1 ] && ok "④ 反例: 无理由的豁免不生效 → exit 1" || no "④ 无理由豁免被放行（门禁变软）"

# ── ⑤ 内置豁免: bypass.log（post-commit hook 每次追加的证据账本）──
reset_sandbox ""
printf 'e\n' > "$SB/src/a.ts"; printf 'log\n' >> "$SB/.claude/bypass.log"; commit_it "feat(D708): bypass log"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 0 ] && ok "⑤ bypass.log 内置豁免 → exit 0" || no "⑤ bypass.log 被误判夹带: rc=$rc"
echo "$OUT" | grep -q 'post-commit hook' && ok "⑤ 打印内置豁免理由" || no "⑤ 未打印内置豁免理由"

# ── ⑨ FIX-004 A（P0 收紧）: K3 索引=精确键；archive/=**仅真重命名**（成对反例）──
# K3 定罪: 原实现 `docs/synova/audit-reports/**` + `archive/**` 为路径级 glob → 任意文件
#   （含把 src/**.ts 改名搬入）落该目录即**静默豁免** ⇒ 夹带口子。
# 判据（改坏即红）: 合法场景绿（⒜）/ 滥用场景必红（⒝），两者同夹具对照。
reset_sandbox ""
printf 'a\n' > "$SB/src/a.ts"
mkdir -p "$SB/docs/synova/audit-reports"
printf '| B1 | x | PASS | k3-repo@sha:r.md |\n' > "$SB/docs/synova/audit-reports/INDEX.md"
commit_it "feat(D708): k3 index"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 0 ] && ok "⑨⒜ 合法: audit-reports/INDEX.md 精确键豁免 → exit 0" || { no "⑨⒜ INDEX.md 被误判夹带: rc=$rc"; echo "$OUT" | tail -5; }
echo "$OUT" | grep -q '仅一行式登记文件 INDEX.md' && ok "⑨⒜ 打印收紧后的豁免理由（精确键）" || no "⑨⒜ 未打印精确键豁免理由"

# ⑨⒝-1 滥用: 同目录**非 INDEX** 文件 → 必红并逐文件点名
reset_sandbox ""
printf 'a\n' > "$SB/src/a.ts"; mkdir -p "$SB/docs/synova/audit-reports"
printf 'payload\n' > "$SB/docs/synova/audit-reports/evil.md"
commit_it "feat(D708): abuse non-index"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 1 ] && ok "⑨⒝-1 滥用: audit-reports/evil.md → exit 1（不再静默豁免）" || no "⑨⒝-1 非 INDEX 文件仍被豁免（口子未堵）: rc=$rc"
echo "$OUT" | grep -q -- '- docs/synova/audit-reports/evil.md' && ok "⑨⒝-1 逐文件点名夹带" || no "⑨⒝-1 未点名"

# ⑨⒝-2 滥用: 源码文件复制/改名塞进 audit-reports/ → 必红（源与副本都点名）
reset_sandbox ""
printf 'export const secret = 1;\n' > "$SB/src/secret.ts"
mkdir -p "$SB/docs/synova/audit-reports"
printf 'export const secret = 1;\n' > "$SB/docs/synova/audit-reports/secret.ts"
commit_it "feat(D708): abuse smuggle src into audit-reports"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 1 ] && ok "⑨⒝-2 滥用: 源码夹带进 audit-reports/ → exit 1" || no "⑨⒝-2 源码夹带被放行: rc=$rc"
{ echo "$OUT" | grep -q -- '- docs/synova/audit-reports/secret.ts' && echo "$OUT" | grep -q -- '- src/secret.ts'; } \
  && ok "⑨⒝-2 源与副本双点名" || no "⑨⒝-2 未双点名"

# ⑨⒝-3 滥用: **新增**文件直接放 archive/**（非重命名）→ 必红
reset_sandbox ""
printf 'a\n' > "$SB/src/a.ts"; mkdir -p "$SB/archive/junk"
printf 'payload\n' > "$SB/archive/junk/new.md"
commit_it "feat(D708): abuse new file in archive"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 1 ] && ok "⑨⒝-3 滥用: 新增 archive/junk/new.md → exit 1（glob 豁免已撤）" || no "⑨⒝-3 archive 仍无条件豁免（口子未堵）: rc=$rc"

# ⑨⒝-4 滥用: git mv 后**大幅改写**（git 判 A+D，非 R）→ 必红（证明"只能靠真重命名"）
reset_sandbox ""
printf 'a\n' > "$SB/src/a.ts"; mkdir -p "$SB/docs"; printf 'original line\n' > "$SB/docs/legacy.md"
commit_it "docs(D708): add legacy"
BASE_MV=$(git -C "$SB" rev-parse HEAD)
mkdir -p "$SB/archive"; git -C "$SB" mv docs/legacy.md archive/legacy.md
"$PYBIN" -c "open('$SB/archive/legacy.md','w',encoding='utf-8').write('\n'.join('rewritten %d'%i for i in range(40))+'\n')"
git -C "$SB" add -A >/dev/null 2>&1; git -C "$SB" commit -q -m "docs(D708): mv + heavy rewrite"
OUT=$( (cd "$SB" && "$PYBIN" "$SB/scripts/control-tower/merge_writeset_gate.py" --repo-root "$SB" --base "$BASE_MV" --head HEAD --branch fix/D708-sandbox 2>&1) ); rc=$?
[ "$rc" -eq 1 ] && ok "⑨⒝-4 滥用: mv+改写（A+D 非 R）→ exit 1" || no "⑨⒝-4 非 R 的 archive 变更被放行: rc=$rc"

# ⑨⒜-2 合法: 真重命名 git mv → archive/（R）→ 绿，且**源与目标两侧**都打印豁免理由
reset_sandbox ""
printf 'a\n' > "$SB/src/a.ts"; mkdir -p "$SB/docs"; printf 'legacy doc content line\n' > "$SB/docs/legacy2.md"
commit_it "docs(D708): add legacy2"
BASE_MV2=$(git -C "$SB" rev-parse HEAD)
mkdir -p "$SB/archive"; git -C "$SB" mv docs/legacy2.md archive/legacy2.md
git -C "$SB" add -A >/dev/null 2>&1; git -C "$SB" commit -q -m "docs(D708): archive move (pure rename)"
OUT=$( (cd "$SB" && "$PYBIN" "$SB/scripts/control-tower/merge_writeset_gate.py" --repo-root "$SB" --base "$BASE_MV2" --head HEAD --branch fix/D708-sandbox 2>&1) ); rc=$?
[ "$rc" -eq 0 ] && ok "⑨⒜-2 合法: 纯重命名 git mv → archive → exit 0" || { no "⑨⒜-2 真重命名被误判夹带: rc=$rc"; echo "$OUT" | tail -6; }
{ echo "$OUT" | grep -q 'archive/legacy2.md' && echo "$OUT" | grep -q 'docs/legacy2.md'; } \
  && ok "⑨⒜-2 重命名源与目标两侧均打印豁免（可审计）" || no "⑨⒜-2 未打印两侧豁免"
echo "$OUT" | grep -q '仅放行 --find-renames 判为 R 的重命名' && ok "⑨⒜-2 打印归档豁免口径（仅 R）" || no "⑨⒜-2 未打印归档豁免口径"

# 改坏即红: 反证——把精确键改回 glob（模拟回退到旧实现）后，非 INDEX 文件必须被点名夹带
sed 's|"docs/synova/audit-reports/INDEX.md"|"docs/synova/audit-reports/**"|' "$GATE" > "$SB/scripts/control-tower/gate_broken.py"
reset_sandbox ""
printf 'a\n' > "$SB/src/a.ts"; mkdir -p "$SB/docs/synova/audit-reports"
printf 'payload\n' > "$SB/docs/synova/audit-reports/evil.md"
commit_it "feat(D708): abuse non-index (mutant)"
OUT2=$( (cd "$SB" && python3 "$SB/scripts/control-tower/gate_broken.py" --repo-root "$SB" --base "$BASE" --head HEAD --branch fix/D708-sandbox 2>&1) )
if echo "$OUT2" | grep -q 'evil.md'; then no "⑨ 改坏即红失败：glob 变异体仍放行 evil.md（说明断言未守住收紧）"; else ok "⑨ 改坏即红成立：glob 变异体立即放行 evil.md（收紧确有判别力）"; fi

# ── ⑥ 分支豁免: auto/**（CI 生成物分支）──
BRANCH="auto/dashboard" OUT=$(run_gate); rc=$?
{ [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'auto/'; } \
  && ok "⑥ auto/** 自动分支 → skip（exit 0）" || no "⑥ auto 分支豁免失效"
BRANCH="fix/D708-sandbox"

# ── ⑥b 分支豁免: main/master（合并后 push 不归本 gate 管）──
BRANCH="main" OUT=$(run_gate); rc=$?
{ [ "$rc" -eq 0 ] && echo "$OUT" | grep -q '合并后 push'; } \
  && ok "⑥b main 分支 → skip（触发点在合并前）" || no "⑥b main 分支未跳过: rc=$rc"
BRANCH="fix/D708-sandbox"

# ── ⑦ 判定失败 → exit 2（不假装通过）──
OUT=$(cd "$SB" && "$PYBIN" "$SB/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB" --base no-such-ref-xyz --head HEAD --branch fix/D708-sandbox 2>&1); rc=$?
[ "$rc" -eq 2 ] && ok "⑦ 取不到 merge-base → exit 2" || no "⑦ 期望 exit 2，实得 $rc"

# ── ⑧ 无声明但全为文档范围 → skip + degraded（不阻断文档 PR）──
reset_sandbox "" --no-brief
printf 'd\n' > "$SB/docs/note.md"; commit_it "docs(D708): docs only"
OUT=$(run_gate); rc=$?
{ [ "$rc" -eq 0 ] && echo "$OUT" | grep -q '降级放行'; } \
  && ok "⑧ 纯文档无声明 → skip + 降级放行" || no "⑧ 纯文档被误阻断: rc=$rc"

# ── ⑨b CJK 文件名（本仓大量中文文档名 → core.quotepath 必须关，否则被误判夹带）──
reset_sandbox ""
mkdir -p "$SB/docs/synova/coordination"
printf 'z\n' > "$SB/docs/synova/coordination/D708-中文设计稿-20260912.md"
mkbrief ""
commit_it "docs(D708): cjk filename"
OUT=$(run_gate); rc=$?
if [ "$rc" -eq 1 ] && echo "$OUT" | grep -q 'D708-中文设计稿-20260912.md'; then
  ok "⑨b CJK 文件名被正确判为夹带并原样点名（quotepath 已关）"
else
  no "⑨b CJK 文件名处理异常: rc=$rc :: $(echo "$OUT" | grep -a 夹带 | head -2)"
fi
# 声明里加入该中文路径 → 必须转绿（证明匹配而非转义串比较）
# D954 修复: 原实现在此**重复写入与上一段相同的 'z'** → 无差异 → commit_it 静默失败 →
#   BASE==HEAD → 变更集为空 → gate 在"变更集为空"分支返回 0 ⇒ 本断言此前是**恒绿**
#   （实测 BASE=HEAD、变更集为空）。改写为不同内容使变更真实存在。
reset_sandbox $'## 写集豁免\n- docs/synova/coordination/D708-中文设计稿-20260912.md — CJK 路径匹配演示'
printf 'z-declared\n' > "$SB/docs/synova/coordination/D708-中文设计稿-20260912.md"; commit_it "docs(D708): cjk declared"
# 非空变更守卫: 本断言的前提是"确有变更可比"（否则又会退回恒绿）
[ -n "$(git -C "$SB" diff --name-only "$BASE"..HEAD)" ] \
  && ok "⑨b 前提: 变更集非空（断言有判别性）" || no "⑨b 前提不成立: 变更集为空 → 后续断言恒绿"
OUT=$(run_gate); rc=$?
[ "$rc" -eq 0 ] && ok "⑨b CJK 路径加入声明后转绿（匹配语义正确）" || no "⑨b CJK 路径声明未生效: rc=$rc"

# ── ⑨ JSON 输出契约（CI 消费）──
OUT=$(run_gate --json | tail -1)
echo "$OUT" | "$PYBIN" -c "
import json,sys
d=json.load(sys.stdin)
assert d['component']=='merge-writeset-gate', d
assert 'status' in d and 'smuggled' in d and 'declared' in d, d
" 2>/dev/null && ok "⑨ --json 输出契约（component/status/smuggled/declared）" || no "⑨ JSON 契约不符"

# ═══ D708 复核修复回归（主 CTO 阻塞项：D# 推断大小写敏感 + 回退链误抓登记提交）═══
echo ""
echo "=== D708 复核修复: D# 推断 ==="

# ⑩ parse_did 大小写不敏感 + 归一化大写（真实输入，主 CTO 复现命令同款）
DID_OUT=$("$PYBIN" - "$REPO" <<'PYEOF'
import importlib.util as u, sys
sp = u.spec_from_file_location("g", sys.argv[1] + "/scripts/control-tower/merge_writeset_gate.py")
m = u.module_from_spec(sp); sp.loader.exec_module(m)
cases = [("feat/win-d702-write-op-no-swallow", "D702"),
         ("docs(d702): 补文档", "D702"),
         ("fix/D708-merge-writeset-gate", "D708"),
         ("no-digit-here", None)]
bad = [f"{t}->{m.parse_did(t)!r}" for t, exp in cases if m.parse_did(t) != exp]
print("OK" if not bad else "BAD:" + ",".join(bad))
PYEOF
)
[ "$DID_OUT" = "OK" ] && ok "⑩ parse_did 大小写不敏感且归一化大写（d702→D702）" || no "⑩ $DID_OUT"

# ⑪ 回退链跳过自动登记影子提交（HEAD 常为登记提交，其 subject 带历史 D#）
#    地形: 分支名小写无大写 D 期 → 提交 feat(d712) → 再叠一个登记影子提交(含 D521)
SB2="$TMPD/d712"; mkdir -p "$SB2/scripts/control-tower" "$SB2/.claude/task-briefs" "$SB2/src"
cp "$REPO/scripts/control-tower/merge_writeset_gate.py" "$SB2/scripts/control-tower/"
cp "$REPO/scripts/control-tower/brief_parser.py" "$SB2/scripts/control-tower/"
cp "$REPO/scripts/control-tower/devdoc_writeset.py" "$SB2/scripts/control-tower/"
git -C "$SB2" init -q; git -C "$SB2" config user.email t@t.local; git -C "$SB2" config user.name t
printf '#CRITERIA: A\n\n# Task Brief: D712\n> 认领: 🛠 编码 session\n\n## Q0: 定位\n### a) 拼图\nx\n\n## Q1: 调研\ny\n\n## Q2: 范围 — 最简方案\n做什么:\n- src/a.ts\n不做什么:\n- 不改 scripts/audit/audit-rules.sh\n\n## Q3: 验收\n入口: CI\n\n## 架构层:\nscripts（控制塔域）\n\n## Done 标准\n- [x] verify: x\n' > "$SB2/.claude/task-briefs/2026-09-12-D712-sandbox.md"
printf 'seed\n' > "$SB2/seed.txt"; git -C "$SB2" add -A >/dev/null 2>&1
git -C "$SB2" commit -q -m "chore: base"; B2=$(git -C "$SB2" rev-parse HEAD)
printf 'a\n' > "$SB2/src/a.ts"; git -C "$SB2" add -A >/dev/null 2>&1
git -C "$SB2" commit -q -m "feat(win-d712): declared file"
git -C "$SB2" commit -q --allow-empty -m "chore: bypass COMMITTED 登记 (auto hook, D521)"
OUT=$(cd "$SB2" && "$PYBIN" "$SB2/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB2" --base "$B2" --head HEAD \
        --branch feat/win-write-op-no-swallow --json 2>&1 | tail -1)
TID=$(echo "$OUT" | "$PYBIN" -c "import json,sys; d=json.load(sys.stdin); print(d.get('task_id') or 'NONE', d.get('task_id_source'), d['status'])" 2>/dev/null || echo "PARSE-FAIL")
case "$TID" in
  "D712 commit-subject pass") ok "⑪ 回退链跳过登记提交 → D712（非 D521）且判定 pass" ;;
  *) no "⑪ 回退链错配: '$TID'（期望 'D712 commit-subject pass'）" ;;
esac

# ⑫ PR 正文声明源（复核建议项）: GITHUB_EVENT_PATH 里的 ## 写集豁免 生效
SB3="$TMPD/prbody"; mkdir -p "$SB3/scripts/control-tower" "$SB3/.claude/task-briefs" "$SB3/src"
cp "$REPO/scripts/control-tower/"*.py "$SB3/scripts/control-tower/"
git -C "$SB3" init -q; git -C "$SB3" config user.email t@t.local; git -C "$SB3" config user.name t
printf '#CRITERIA: A\n\n# Task Brief\n> 认领: 🛠\n\n## Q0\n### a) x\n\n## Q1\ny\n\n## Q2:\n做什么:\n- src/a.ts\n不做什么:\n- 不改 scripts/audit/audit-rules.sh\n\n## Q3\nz\n\n## 架构层:\nscripts\n\n## Done 标准\n- [x] v\n' > "$SB3/.claude/task-briefs/2026-09-12-D708-pb.md"
printf 'seed\n' > "$SB3/seed.txt"; git -C "$SB3" add -A >/dev/null 2>&1
git -C "$SB3" commit -q -m "chore: base"; B3=$(git -C "$SB3" rev-parse HEAD)
printf 'a\n' > "$SB3/src/a.ts"; printf 'b\n' > "$SB3/src/outside.ts"
git -C "$SB3" add -A >/dev/null 2>&1; git -C "$SB3" commit -q -m "feat(D708): outside"
cat > "$TMPD/event.json" <<'JSONEOF'
{"pull_request": {"body": "## 写集豁免\n- src/outside.ts — 并行线只读引用（PR 正文声明演示）"}}
JSONEOF
OUT=$(cd "$SB3" && GITHUB_EVENT_PATH="$TMPD/event.json" "$PYBIN" "$SB3/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB3" --base "$B3" --head HEAD --branch fix/D708-pb 2>&1); rc=$?
{ [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'PR 正文声明演示'; } \
  && ok "⑫ PR 正文（GITHUB_EVENT_PATH）声明源生效 → exit 0 且打印理由" \
  || no "⑫ PR 正文声明源未生效: rc=$rc"

# ═══ D954: --did 显式覆盖 + infer_did 回退诊断（K3 判 #741 建议项）═══
echo ""
echo "=== D954: --did 覆盖 / infer_did 回退诊断 ==="

# 共同地形: **分支名无 D# + 提交 subject 无 D#** → D# 只能来自 --did 或文件声明源。
#   这样才真正压到"推断失败"路径（既有沙箱用 fix/D708-sandbox 分支，分支名自带 D#，压不到）。
mk_sb_nodid() { # $1=目录 [$2=brief 文件名（省略=不写 brief）]
  local d="$1" bf="${2:-}"
  mkdir -p "$d/scripts/control-tower" "$d/.claude/task-briefs" "$d/src" "$d/docs"
  cp "$REPO/scripts/control-tower/merge_writeset_gate.py" "$d/scripts/control-tower/"
  cp "$REPO/scripts/control-tower/brief_parser.py" "$d/scripts/control-tower/"
  cp "$REPO/scripts/control-tower/devdoc_writeset.py" "$d/scripts/control-tower/"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  if [ -n "$bf" ]; then
    { printf '#CRITERIA: A\n\n# Task Brief: D945 sandbox\n> 认领: 🛠 编码 session\n\n'
      printf '## Q0: 定位\n### a) 拼图\n控制塔。\n\n## Q1: 调研\n铁律 35。\n\n'
      printf '## Q2: 范围 — 最简方案\n做什么:\n- src/a.ts\n不做什么:\n- 不改 scripts/audit/audit-rules.sh\n\n'
      printf '## Q3: 验收\n入口: CI。\n\n## 架构层:\nscripts（控制塔域）\n\n## Done 标准\n- [x] verify: x\n'
    } > "$d/.claude/task-briefs/$bf"
  fi
  printf 'seed\n' > "$d/seed.txt"
  git -C "$d" add -A >/dev/null 2>&1
  git -C "$d" commit -q -m "chore: base"        # subject 刻意无 D#
}

# ── ⑬ --did 显式覆盖 ──
SB4="$TMPD/did-override"
mk_sb_nodid "$SB4" "2026-09-25-D945-sandbox.md"
B4=$(git -C "$SB4" rev-parse HEAD)
printf 'a\n' > "$SB4/src/a.ts"
git -C "$SB4" add -A >/dev/null 2>&1
git -C "$SB4" commit -q -m "feat: declared file"          # subject 刻意无 D#
# ⑬-1 判别性对照: 不给 --did → D# 推不出 → 三源全空 → fail-closed
#      （这条证明下面的绿**真的来自 --did**，而不是恒真）
OUT=$(cd "$SB4" && "$PYBIN" "$SB4/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB4" --base "$B4" --head HEAD --branch fix/no-did-anywhere 2>&1); rc=$?
[ "$rc" -eq 2 ] && ok "⑬-1 对照: 无 --did → fail-closed exit 2（D# 推不出）" \
                || no "⑬-1 对照: 期望 exit 2，实得 $rc"
# ⑬-2 给 --did D945 → 来源记为 explicit，声明命中 → exit 0
OUT=$(cd "$SB4" && "$PYBIN" "$SB4/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB4" --base "$B4" --head HEAD --branch fix/no-did-anywhere \
        --did D945 --json 2>&1 | tail -1)
PARSED=$(echo "$OUT" | "$PYBIN" -c "import json,sys;d=json.load(sys.stdin);print(d.get('task_id'),d.get('task_id_source'),d.get('status'))" 2>/dev/null || echo "PARSE-FAIL")
case "$PARSED" in
  "D945 explicit pass") ok "⑬-2 --did D945 → task_id=D945 / source=explicit / pass" ;;
  *) no "⑬-2 --did 覆盖未生效: '$PARSED'（期望 'D945 explicit pass'）" ;;
esac
# ⑬-3 --did 取小写须归一化为大写（与 parse_did/brief 文件名口径一致）
OUT=$(cd "$SB4" && "$PYBIN" "$SB4/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB4" --base "$B4" --head HEAD --branch fix/no-did-anywhere \
        --did d945 --json 2>&1 | tail -1)
PARSED=$(echo "$OUT" | "$PYBIN" -c "import json,sys;d=json.load(sys.stdin);print(d.get('task_id'),d.get('task_id_source'))" 2>/dev/null || echo "PARSE-FAIL")
[ "$PARSED" = "D945 explicit" ] && ok "⑬-3 --did 小写 d945 归一化为 D945" \
                                || no "⑬-3 大小写未归一化: '$PARSED'"
# ⑬-4 人类可读输出必须打印来源（"同时打印来源便于诊断"）
OUT=$(cd "$SB4" && "$PYBIN" "$SB4/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB4" --base "$B4" --head HEAD --branch fix/no-did-anywhere --did D945 2>&1); rc=$?
{ [ "$rc" -eq 0 ] && echo "$OUT" | grep -q 'D# 推断来源: explicit'; } \
  && ok "⑬-4 打印 D# 推断来源 = explicit（来源可见）" \
  || no "⑬-4 未打印 explicit 来源: rc=$rc"
# ⑬-5 反例: --did 值不合法 → fail-closed exit 2（**拒绝静默改用其它来源推断出的 D#**）
#      自建沙箱（不复用 $SB：⑨b 后 $SB 的 BASE==HEAD，变更集为空 → 会在早期分支返回 0，
#      根本走不到 D# 推断，断言会变成恒绿）。
#      地形刻意让"分支名本身带 D# 且声明齐备"→ 不设此保护就会静默回退到 D708 并 rc=0；
#      设了保护则 rc=2 ⇒ 该断言对保护本身敏感（下方 ⑬-5a 即是"无保护时会绿"的基线证明）。
SB6="$TMPD/did-invalid"
mk_sb_nodid "$SB6" "2026-09-12-D708-guard.md"
B6=$(git -C "$SB6" rev-parse HEAD)
printf 'a\n' > "$SB6/src/a.ts"
git -C "$SB6" add -A >/dev/null 2>&1
git -C "$SB6" commit -q -m "feat: declared file"          # subject 无 D#；D# 只能来自分支名
# ⑬-5a 基线: 不给 --did → 分支名推断出 D708 + 声明齐备 → exit 0（证明本场景"本来会绿"）
OUT=$(cd "$SB6" && "$PYBIN" "$SB6/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB6" --base "$B6" --head HEAD --branch fix/D708-guard --json 2>&1 | tail -1)
PARSED=$(echo "$OUT" | "$PYBIN" -c "import json,sys;d=json.load(sys.stdin);print(d.get('task_id'),d.get('task_id_source'),d.get('status'))" 2>/dev/null || echo "PARSE-FAIL")
case "$PARSED" in
  "D708 branch pass") ok "⑬-5a 基线: 分支名推断 D708 且声明命中 → pass（场景本来会绿）" ;;
  *) no "⑬-5a 基线不成立: '$PARSED'（期望 'D708 branch pass'；本用例失去判别性）" ;;
esac
# ⑬-5b 给非法 --did → 必须 exit 2，绝不静默回退到 D708
OUT=$(cd "$SB6" && "$PYBIN" "$SB6/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB6" --base "$B6" --head HEAD --branch fix/D708-guard \
        --did oops-no-digit 2>&1); rc=$?
[ "$rc" -eq 2 ] && ok "⑬-5b --did 值不含 D# → exit 2（不静默改用其它来源）" \
                || no "⑬-5b --did 非法值被静默忽略（实得 rc=${rc}，期望 2）"
echo "$OUT" | grep -q '不含 D# 形态' \
  && ok "⑬-5b 诊断点名 --did 值不合法" || no "⑬-5b 未诊断非法 --did"

# ── ⑭ 回退诊断: 三源全空 → 退试 commit subject + 诊断打印 + 仍不放行 ──
SB5="$TMPD/did-fallback"
mk_sb_nodid "$SB5"                       # 无 brief
B5=$(git -C "$SB5" rev-parse HEAD)
printf 'c\n' > "$SB5/src/c_undeclared.ts"
git -C "$SB5" add -A >/dev/null 2>&1
git -C "$SB5" commit -q -m "feat: no did anywhere"        # subject 刻意无 D#
OUT=$(cd "$SB5" && "$PYBIN" "$SB5/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB5" --base "$B5" --head HEAD --branch fix/no-did-anywhere 2>&1); rc=$?
[ "$rc" -eq 2 ] && ok "⑭ 三源全空 + 源码变更 → exit 2（fail-closed，绝不静默通过）" \
                || no "⑭ 期望 exit 2（不放行），实得 $rc"
echo "$OUT" | grep -q '源 explicit: 未提供 --did' \
  && ok "⑭ 诊断: explicit 源已尝试并说明未提供" || no "⑭ 诊断缺 explicit 源说明"
echo "$OUT" | grep -q '源 branch:' \
  && ok "⑭ 诊断: 分支名源已尝试" || no "⑭ 诊断缺 branch 源"
echo "$OUT" | grep -q '源 commit-subject:' \
  && ok "⑭ 诊断: **退试 commit subject** 已尝试" || no "⑭ 诊断缺 commit-subject 回退"
echo "$OUT" | grep -q '全部来源皆空' \
  && ok "⑭ 诊断: 明示全部来源皆空" || no "⑭ 诊断未明示全空"
echo "$OUT" | grep -q 'fail-closed' \
  && ok "⑭ 明示 fail-closed 语义（不放行）" || no "⑭ 未明示 fail-closed"
echo "$OUT" | grep -q '登记影子提交' \
  && ok "⑭ 诊断: 保留「跳过自动登记影子提交」既有保护说明" || no "⑭ 诊断未说明登记影子提交保护"
echo "$OUT" | grep -qE '扫过 [0-9]+ 条非登记提交' \
  && ok "⑭ 诊断: 给出实际扫描提交数（可核，非空话）" || no "⑭ 诊断未给扫描计数"
# ⑭ 反例（防"诊断恒打印"）: 能推断出 D# 时不该走诊断块
OUT=$(cd "$SB4" && "$PYBIN" "$SB4/scripts/control-tower/merge_writeset_gate.py" \
        --repo-root "$SB4" --base "$B4" --head HEAD --branch fix/no-did-anywhere --did D945 2>&1)
echo "$OUT" | grep -q 'S1 task-state / S2 dev doc / S3 brief 声明源为空' \
  && no "⑭ 反例: 已命中声明仍打印「声明源为空」诊断（诊断块条件写错）" \
  || ok "⑭ 反例: 命中声明时不打印全空诊断（诊断非恒真）"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
