#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# grep-oP-regression.test.sh — scripts/ 可移植性回归网（D661 建 / D664 扩容 / D718 并入 BOM）
#
# 覆盖矩阵（铁律 48 三路径 + 接线）:
#   正常 — scripts/ 全目录（.sh）内 grep -P 变体零命中
#   边界 — 注释行（描述该问题的注释不执行）+ 检测器自身（grep-P-scan-ok 标记）排除
#   反向 — 哨兵: 塞入一处 -oP 必须被网抓到（防"永远绿"的空转网）
#   D664 — 27 处转译的**语义等价**金值断言（PCRE → ERE 逐模式钉死，含 \K / \s / \S 三类不可直译）
#   接线 — 每个转译后的 ERE 模式必须真实存在于目标脚本（防测试与源码漂移）
#   D718 — 首行 BOM 扫描（同族可移植性缺陷：BOM 顶掉 shebang → `env: No such file or directory`）:
#          全仓库 git 跟踪文件单进程扫描 + **存量待清清单 ratchet**（清单必须与实际完全一致）
#
# 防家族复发: D421(post-commit.sh)/D660(resolve-commit-brief.sh)/D661/D664 四次同型
# （BSD grep 无 -P → 检查静默失效）。本测试是物理回归网——任何新增 grep -P 立即红。
# D718 同族第二条: BOM 使 shebang 失效（脚本"存在但跑不起来"）——同属静默失效家族。
#
# D664 扩容说明（旧版是纸老虎）:
#   ① 旧版只扫 scripts/workflow/ + scripts/control-tower/ 两目录 → hooks/、checks/、
#      根级 check-*.sh 全在网外（本批修的 27 处里 24 处在网外）
#   ② 旧版**不在 ci.yml 密封清单** → 从未在 CI 跑过 = 机制建成未接线（M3 模式）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "=== D661/D664: grep -P 家族回归网 ==="

# ── 回归网主体: scripts/ 全目录 .sh ──
# 排除 ① 注释行（`file:line:#...`）——描述该问题的注释本身不执行
#      ② 检测器自身（本行标记）——脚本内需保留字面量才能检测别人的 -P
HITS=$(grep -rnE 'grep[[:space:]]+-[a-zA-Z]*P' "$REPO/scripts" --include='*.sh' 2>/dev/null \
        | grep -vE ':[0-9]+:[[:space:]]*#' | grep -v 'grep-P-scan-ok' || true)
if [ -z "$HITS" ]; then
  ok "scripts/ 全目录内 grep -P 零命中（排除注释与检测器自身）"
else
  no "残留 grep -P 用法（BSD grep 无 -P，检查会静默失效）："
  echo "$HITS" | sed 's/^/      /' >&2
fi

# 反向哨兵: 回归网必须真的能抓到 -P（防"永远绿"的空转网）
printf '#!/bin/bash\ngrep -oP "x" /dev/null\n' > "$TMP/canary.sh"
CANARY=$(grep -rnE 'grep[[:space:]]+-[a-zA-Z]*P' "$TMP" --include='*.sh' 2>/dev/null | grep -vE ':[0-9]+:[[:space:]]*#' || true)
[ -n "$CANARY" ] && ok "反向哨兵: 塞入 -oP 能被网抓到（网非空转）" || no "反向哨兵: 网抓不到 -oP"

echo ""
echo "=== D664: PCRE → ERE 语义等价金值断言 ==="

# eq <名称> <目标文件> <ERE 模式> <输入> <期望输出> [额外 grep 参数]
# 接线 needle 走环境变量 NEEDLE（缺省 = pat）；源码里含 shell 引号拼接（'"'"'）时模式文本
# 与展开后不同，需显式给 needle。
eq() {
  local name="$1" file="$2" pat="$3" input="$4" want="$5"; shift 5
  local ndl="${NEEDLE:-$pat}"
  if ! grep -qF -- "$ndl" "$REPO/$file" 2>/dev/null; then
    no "$name — 接线: 模式未出现在 ${file}（测试与源码漂移）"; return
  fi
  local got
  got=$(printf '%s\n' "$input" | grep -oE "$@" -- "$pat" 2>/dev/null || true)
  if [ "$got" = "$want" ]; then ok "$name"; else no "$name — 期望 '$want' 实得 '$got'"; fi
}
# eqs <名称> <目标文件> <ERE 模式> <输入> <期望输出> <sed 后缀>  （\K 替代路径）
eqs() {
  local name="$1" file="$2" pat="$3" input="$4" want="$5" sedx="$6"
  if ! grep -qF -- "$pat" "$REPO/$file" 2>/dev/null; then
    no "$name — 接线: 模式未出现在 ${file}"; return
  fi
  local got
  got=$(printf '%s\n' "$input" | grep -oE -- "$pat" 2>/dev/null | sed -E "$sedx" || true)
  if [ "$got" = "$want" ]; then ok "$name"; else no "$name — 期望 '$want' 实得 '$got'"; fi
}

# ── 类 1: \s / \S —— PCRE 无 ERE 等价物，必须转 POSIX 类 ──
# (D962-B2: 指向根目录 check-brief-vs-code.sh / check-tech-debt.sh 的条目随脚本退役移除，
#  各类覆盖由 file-driven / checker-review / pre-doc-audit / pre-commit 存活条目保持)

eq '\s→[[:space:]] (tags 字段体)' "scripts/check-file-driven.sh" \
   '"tags"[[:space:]]*:[[:space:]]*\[[^]]*\]' \
   '  "tags": ["finance", "cash"],' '"tags": ["finance", "cash"]'
eq '\s→[[:space:]] 零空格也命中' "scripts/check-file-driven.sh" \
   '"tags"[[:space:]]*:[[:space:]]*\[[^]]*\]' '"tags":["a"]' '"tags":["a"]'

unset NEEDLE
eq '\S→[^[:space:]] (checker-review 测试路径)' "scripts/checker-review.sh" \
   'tests/[^[:space:]]+\.test\.ts' ' FAIL tests/l3/foo.test.ts  ' 'tests/l3/foo.test.ts'

eq '\s→[[:space:]] (pre-doc-audit 枚举值)' "scripts/pre-doc-audit.sh" \
   "[[:space:]]+([A-Za-z_][A-Za-z0-9_]*):[[:space:]]*'" \
   "  DEPENDS_ON: 'dependsOn'," "  DEPENDS_ON: '"
NEEDLE='docs/synova/research/[^][:space:]' \
eq '\S→[^[:space:]] (pre-doc-audit docs 引用)' "scripts/pre-doc-audit.sh" \
   'docs/synova/research/[^][:space:])'"'"'；,;]+' \
   '见 docs/synova/research/a-b.md 与 docs/synova/research/c.md；' \
   'docs/synova/research/a-b.md
docs/synova/research/c.md'

# ── 类 2: \K —— 无 ERE 等价物，取全匹配后 sed 剥前缀 ──
eqs '\K→grep -oE + sed (export 名提取)' "scripts/pre-commit-check.sh" \
   'export (function|class|const) [A-Za-z_][A-Za-z0-9_]*' \
   'export function computeCashFlow(a) {' 'computeCashFlow' \
   's/^export (function|class|const) //'
eqs '\K→… 同模式 const 分支' "scripts/pre-commit-check.sh" \
   'export (function|class|const) [A-Za-z_][A-Za-z0-9_]*' \
   'export const X_1 = 2' 'X_1' 's/^export (function|class|const) //'
# (D962 2a① V5.3 密封同步: 判定体含全角冒号 [:=：]——组7a 增强，断言随语义更新)
eqs '\K→grep -oE + sed (#CRITERIA)' "scripts/pre-commit-check.sh" \
   '#CRITERIA[[:space:]]*[:=：][[:space:]]*[A-D]' '#CRITERIA: B' 'B' \
   's/.*[=:：][[:space:]]*//'
eqs '\K→… 无空格形式' "scripts/pre-commit-check.sh" \
   '#CRITERIA[[:space:]]*[:=：][[:space:]]*[A-D]' '#CRITERIA=C' 'C' \
   's/.*[=:：][[:space:]]*//'
# V5.3 边界翻转: 全角冒号在组7a 增强后【应匹配】（原 PCRE [:=\s] 不匹配——转译语义演进，密封随迁）
eqs '\K 边界: 全角冒号 V5.3 起匹配（组7a 增强）' "scripts/pre-commit-check.sh" \
   '#CRITERIA[[:space:]]*[:=：][[:space:]]*[A-D]' '#CRITERIA：C' 'C' \
   's/.*[=:：][[:space:]]*//'
eqs '\K→grep -oE + sed (brief id)' "scripts/pre-commit-check.sh" \
   '\.claude/task-briefs/[^.]+' '.claude/task-briefs/2026-09-12-D664-x.md' \
   '2026-09-12-D664-x' 's|^\.claude/task-briefs/||'

# ── 类 3: \d —— ERE 用 [0-9] / {n} 直译 ──
# (合并候选: check-tech-debt.sh 已随 D962 第一批退役——\d 日期条目改指在库真身)
# (D962 2a① V5.3: pre-commit 不再提取 brief 日期——\d 类覆盖改指在库真身 resolve-commit-brief.sh)
eq '\d→[0-9] (brief 日期, resolve-commit-brief 真身)' "scripts/workflow/resolve-commit-brief.sh" \
   '[0-9]{4}-[0-9]{2}-[0-9]{2}' '2026-09-12-D664-x.md' '2026-09-12'

# ── 类 4: 简单直译（-oP → -oE，语义本就 ERE 兼容）──
# (D962-B2: 根目录 check-brief-vs-code.sh 专属模式条目随脚本退役移除)
# D962 task-32 R1: 模式改方括号包裹反引号（POSIX 等价）—— 原 '\`' 转义在 GNU grep 是扩展锚点，
#   实测在 GNU 下恒不匹配（ubuntu 腿红）、BSD 下恰好命中（macOS 腿绿）⇒ 两方言必须同式才能跨平台。
eq 'backtick 路径（workflow brief-vs-code）' "scripts/workflow/check-brief-vs-code.sh" '[`][^`]+\.[a-z]{2,5}[`]' \
   '改 `src/routes/a.ts` 完成' '`src/routes/a.ts`'
eq 'tags 词表' "scripts/check-file-driven.sh" '"[a-z_]+"' '"finance", "cash_flow"' '"finance"
"cash_flow"'
eq 'extensions 顶层目录' "scripts/check-file-driven.sh" '^extensions/[^/]+' \
   'extensions/sentinels/a.json' 'extensions/sentinels'
eq '记忆双链' "scripts/hooks/hook-check-memory.sh" '\[\[[^]]+\]\]' \
   'see [[D665-gitlink]] and [[X]]' '[[D665-gitlink]]
[[X]]'
# (D962 2a① V5.3: pre-commit 不再做 match_file 前缀提取——覆盖改指在库真身 external-auditor.sh)
eq 'match_file 前缀 (external-auditor 真身)' "scripts/control-tower/external-auditor.sh" '^[^:]+' 'src/a.ts:12:内容' 'src/a.ts'
# (合并候选: checks/check-test-quality.sh 已随 D962 第一批退役——exports 提取条目随删，覆盖由上方 pre-commit export 条目保持)

echo ""
echo "=== D664: 转译形态静态守卫（防 sed 参数错位类）==="

# 转译的典型手误: 原命令 grep -oP 'PAT' "$FILE" 改成 "grep -oE 'PAT' | sed -E 'S'" 时
# 把 "$FILE" 留在 sed 之后 → grep 改读 stdin（空）→ 提取恒空、且 sed 把文件当输入。
# 该 bug 不会被"金值断言"抓到（金值只测模式），也不会被"-P 零命中"抓到 →
# 必须有一条针对**命令形态**的静态守卫。实测本次转换中真的踩到（5 处）。
BADSED=$(grep -rnE "\| sed -E '[^']*' \"\$" "$REPO/scripts" --include='*.sh' 2>/dev/null || true)
if [ -z "$BADSED" ]; then
  ok "无「sed 吃掉文件参数」形态（\$FILE 必须在管道左侧）"
else
  no "发现 sed 参数错位（grep 会改读 stdin → 提取恒空）："
  echo "$BADSED" | sed 's/^/      /' >&2
fi

# 可执行断言: 真实生产形态跑一遍（文件参数在 grep 侧才拿得到内容）
printf 'export function foo(a) {\n}\nexport const BAR = 1;\n' > "$TMP/mod.ts"
GOT_EXPORTS=$(grep -oE 'export (function|class|const) [A-Za-z_][A-Za-z0-9_]*' "$TMP/mod.ts" 2>/dev/null | sed -E 's/^export (function|class|const) //' | tr '\n' ',')
[ "$GOT_EXPORTS" = "foo,BAR," ] \
  && ok "可执行: export 提取（真实形态 foo,BAR）" \
  || no "可执行: export 提取异常 → '$GOT_EXPORTS'"

printf '#CRITERIA: A\n' > "$TMP/b.md"
GOT_CRIT=$(grep -oE '#CRITERIA[[:space:]]*[:=][[:space:]]*[A-D]' "$TMP/b.md" 2>/dev/null | sed -E 's/.*[=:][[:space:]]*//')
[ "$GOT_CRIT" = "A" ] && ok "可执行: #CRITERIA 提取（真实形态 A）" || no "可执行: #CRITERIA 提取异常 → '$GOT_CRIT'"

# ── D718: 首行 BOM 扫描（ratchet）──
# 语义: 全仓库 git 跟踪文件行首 BOM 集合 必须与下方待清清单**完全一致**——
#   新增 BOM → 红（防新脚本再落坑）；清单里的文件被清掉却没删条目 → 也红（防僵尸条目）。
# 扫描用单进程 git grep（BSD grep 无 -P，用 $'...' 文字字节 + ^ 锚点）：逐文件 head/od
#   在 Windows CI 是分钟级（D664 性能教训），故不做 per-file spawn。
# 待清清单（D718 首批清 scripts/pre-doc-audit.sh；D782 清 check-doc-truth.sh/doc-registry-gate.sh
#   ——二者接线进 pre-commit 后输出直进提交流，BOM 噪音行不可留；其余按域派工，CTO 不越域）:
#   scripts/audit/check-gates-v2.py            — K3 审计域（CTO 红线禁碰）
#   scripts/doc-system/*.sh (3)                — 文档系统域（D782 PR-2 重写版已清 2; 余 3 待 PR-3）
#   tests/doc-system/doc-registry-gate.test.sh  — 文档系统域（.sh，BOM 使 shebang 失效 → 有害）
#   scripts/archive/ scripts/*.py (6)          — .py 的 BOM 属 PEP 263 可容忍，但仍应清
BOM_PENDING="scripts/archive/gen-survey.py
scripts/audit/check-gates-v2.py
scripts/control-tower/generate-dashboard.py
scripts/control-tower/product-health.py
scripts/doc-system/doc-staleness.sh
scripts/doc-system/generate-chronicle-monthly.sh
scripts/doc-system/install-chronicle-schedule.sh
scripts/jtbd-dedup-v2.py
scripts/jtbd-dedup.py
tests/doc-system/doc-registry-gate.test.sh"
BOM_BYTES="$(printf '\xef\xbb\xbf')"
BOM_ACTUAL=$(cd "$REPO" && git grep -lI -e "^${BOM_BYTES}" -- \
  '*.sh' '*.py' '*.json' '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.yml' '*.yaml' 2>/dev/null | sort || true)  # swallow-ok: git grep 无命中=exit 1，属正常
BOM_EXPECT=$(printf '%s\n' "$BOM_PENDING" | grep -v '^$' | sort)
if [ "$BOM_ACTUAL" = "$BOM_EXPECT" ]; then
  ok "行首 BOM 与存量待清清单一致（$(printf '%s\n' "$BOM_EXPECT" | grep -c .) 个待清，无新增；本批已清 scripts/pre-doc-audit.sh）"
else
  no "行首 BOM 清单漂移（新增 BOM 或待清清单未同步清理）:"
  diff <(printf '%s\n' "$BOM_EXPECT") <(printf '%s\n' "$BOM_ACTUAL") | sed 's/^/      /' >&2
fi

# 反向哨兵: 扫描器本身必须真能命中 BOM（防"永远绿"的空转网 —— 实测踩过假阴性：
# `od -An -tx1 | grep 'ef bb bf'` 因 od 十六进制对之间是两个空格而永不命中）
printf '\xef\xbb\xbf#!/bin/bash\necho hi\n' > "$TMP/bom-probe.sh"
BOM_PROBE=$(cd "$TMP" && git init -q . 2>/dev/null; cd "$TMP" && git add -f bom-probe.sh 2>/dev/null; cd "$TMP" && git grep -lI -e "^${BOM_BYTES}" -- '*.sh' 2>/dev/null || true)  # swallow-ok: 无命中=exit 1，非错误
[ "$BOM_PROBE" = "bom-probe.sh" ] \
  && ok "哨兵: 塞入 BOM 文件必被扫到（扫描器非空转）" \
  || no "哨兵: 扫描器未命中已知 BOM 样本 → 本检查不可信（假阴性）: '$BOM_PROBE'"

echo ""
echo "  结果: $PASS 通过, $FAIL 失败"
if [ "$FAIL" -gt 0 ]; then
  echo "  Status: ❌ grep -P 回归网未通过"
  exit 1
fi
echo "  Status: ✅ grep -P 回归网全部通过"
exit 0
