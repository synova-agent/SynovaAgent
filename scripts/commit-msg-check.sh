#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Anthropic 标准: Conventional Commits + issue 引用
# 格式: type(scope): subject
# 要求: commit body 含 issue/task 引用 (#C1, P1-2, SOG-001 等)
# ═══════════════════════════════════════════════════════════════════════════════
# D513/①(Win 8f33e82a): merge 提交豁免 D328 —— 本地 merge 的构成提交各自已过
# D328（声明一致），merge commit 本身无新声明语义（GitHub 网页 merge 也不经本地
# hook）。无检测时本地 merge 必被「消息无 D# vs 认领 D#」拦死，Win 被迫走注入缝。
if [ -f "$(git rev-parse --git-dir 2>/dev/null)/MERGE_HEAD" ]; then  # swallow-ok: rev-parse 失败=非 git 环境=条件自然 false
  echo "  ℹ D513: MERGE_HEAD 存在 — merge 提交，D328 一致性检查跳过（构成提交已各自校验）"
  exit 0
fi

set -euo pipefail

COMMIT_MSG=$(cat "$1" 2>/dev/null || echo "")
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

if echo "$COMMIT_MSG" | grep -qE '^Merge |^Revert '; then exit 0; fi

# D-C: scope 字符集加 `#` 与数字（`feat(#1234): …`）。**连字符必须置于字符类末位** ——
#   `\-` 在 BSD grep 的 ERE 字符类里非法（实测 `grep: invalid character range`，
#   正是 check-gate-integrity.sh 头注释记录的跨方言陷阱）。
PATTERN='^(feat|fix|chore|docs|test|refactor|perf|style|ci|build)(\([a-zA-Z0-9_.+#-]+\))?: .{1,140}$'

if ! echo "$COMMIT_MSG" | head -1 | LC_ALL=C grep -qE "$PATTERN"; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${RED}║  ❌ Commit 格式不符合 Conventional Commits                  ║${RESET}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo "  正确格式: type(scope): subject"
  echo "  type: feat | fix | chore | docs | test | refactor | perf | ci"
  echo "  示例: feat(p1-3): 接线 EvidenceManager 到诊断流程"
  echo "        fix(#C1): 修复 Phase 0 状态机流转 bug"
  echo ""
  exit 1
fi

# Anthropic 标准: 检查 issue/task 引用 (warning, not block)
if echo "$COMMIT_MSG" | grep -qE '#[A-Z]+[0-9]+|P[0-9]+-[0-9]+|[A-Z]+-[0-9]{3}|#[0-9]+'; then
  echo -e "${GREEN}✅ Commit 格式正确 + 含 issue 引用${RESET}"
else
  echo -e "${GREEN}✅ Commit 格式正确${RESET}"
  echo -e "${YELLOW}   ⚠ 建议在 commit body 中包含 issue/task 引用 (如 #C1, P1-2, SOG-001)${RESET}"
fi

# ── D328: 提交声明-内容一致性（防并行劫持）──
# 背景: D320 劫持 — chore(D318) 提交带走 D320 的 8 个文件, G12(范围)与格式校验全过。
# 本检查绑定"消息声明的 D#"与"暂存文件真实认领 brief 的 D#": 不一致 → 硬阻断。
# 语义 (dev doc §3.1/§4, 修正 §3.2 代码):
#   - 两者都存在且不一致 → exit 1（劫持特征）
#   - 消息无 D# 但认领 brief 有 D# → exit 1（提交未声明任务归属）
#   - Merge/Revert（上方已跳）/无暂存/无认领 brief/认领 brief 无 D#/无真实认领 → fail-open
# 🔴 D1231/#1308 措辞口径（**判定不变，仍 exit 1**）: 「消息侧零声明」与「双方声明冲突」是
#   两类原因，不得共用同一句话 ——
#     确有认领 ∧ 双方都有声明 ∧ 不一致        → 「疑似并行劫持」（唯一该用该措辞的场景）
#     确有认领 ∧ 消息侧零声明（未声明/解析失败）→ 「认领解析失败（非劫持）」
#   历史: 旧实现把两类压成一句「疑似并行劫持」，D328 实测把排查引偏一轮（#1308 现象）。
# 消息文件缺失/异常 → MSG_DID 空 → 一致性检查 fail-open（铁律 24: 显式兜底）
# CT-60: scope 大小写/后缀兼容 — docs(d578)/feat(d577-closeout) 均提取 D#。
# 背景: 旧正则 \(D[0-9]+\) 只认大写 D 且要求括号内纯 D#——小写 scope
# （docs(d578)）被判"声明(无)"误拦（2026-09-06 CTO 单日实测三次），而后缀
# scope（feat(d577-closeout)）同样漏提取。修复: 先取 conventional scope，
# 从 scope 前缀提 D#（大小写兼容→归一为大写，brief 文件名恒为 D578-* 大写）；
# 非常规格式回退旧模式（首行独立 (D578) 引用）。
MSG_DID=$(head -1 "$1" 2>/dev/null | sed -E 's/^[a-zA-Z]+\(([^)]*)\).*/\1/' | grep -oE '^[Dd][0-9]+' | head -1 | tr '[:lower:]' '[:upper:]') || true # swallow-ok: 消息文件异常时声明为空 → fail-open 不误伤
if [ -z "$MSG_DID" ]; then
  # 回退: 非常规格式但首行含独立 (D578)/(d578) 型引用（旧行为兼容，大小写归一）
  MSG_DID=$(head -1 "$1" 2>/dev/null | grep -oE '\([Dd][0-9]+\)' | head -1 | tr -d '()' | tr '[:lower:]' '[:upper:]') || true # swallow-ok: 同上
fi
# ── D-C（K3 R5）: issue 形态声明提取 —— 见下方 PYBIN 定义后的 MSG_ISSUE 段 ──
# D395-a 注入缝: SYNO_STAGED_FILES 覆盖暂存文件集（测试免跑真实 git diff）
STAGED_LIST="${SYNO_STAGED_FILES:-$(git -c core.quotepath=false diff --cached --name-only 2>/dev/null || true)}"  # D339: 中文文件名不被转义，认领 match_path 正常
if [ -n "$STAGED_LIST" ]; then
  # D317 自包含定位: 临时 repo 测试/异仓库时 git rev-parse ROOT 下无脚本目录
  MSG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # Windows/MSYS 边界: python 无法解析 MSYS 路径 (/d/...), 须 cygpath -w 转换
  # (对齐 resolve-commit-brief.sh 的 PARSER_DIR_W 模式 — D317 教训)
  MSG_DIR_W="$(cygpath -w "$MSG_DIR" 2>/dev/null || echo "$MSG_DIR")"
  # D329 (D328 P2 折入): PYBIN 跨平台回退 — 裸 python3 在精简 Git/CI runner
  # 上不存在（仅 python / py -3）。对齐 resolve-commit-brief.sh 的 PYBIN 循环。
  # 全无 python → 显式 degraded 提示（fail-open skip，不静默 — 铁律 24/31）。
  # 注意: 必须放在 resolver 调用之前 — resolver 无 python 时必退空（exit 1），
  # 若把提示放进 CLAIM_BRIEF 非空条件内，无 python 场景提示永不触发 = 静默 skip。
  # D330 (KIMI K3 P1-1): command -v 只验存在性 — Windows Store stub 等损坏 shim
  # 存在但执行即败 → 加可用性验证 ("$_c" -c "import sys"); 全部不可用/损坏 →
  # 显式 degraded 提示（铁律 24/31, 不再静默 skip）
  PYBIN=""
  for _c in python3 python py; do
    if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then
      PYBIN="$_c"
      break
    fi
  done
  if [ -z "$PYBIN" ]; then
    echo -e "${YELLOW}⚠ D328 一致性检查跳过: python 不可用或损坏（fail-open 显式提示，不静默）${RESET}"
  fi
  # ── D-C（K3 R5）: issue 形态声明提取 —— `feat(#1234): …` ──
  # 单源: 提取走 claim_store.parse_issue（**不在此复制正则**；claim 库已覆盖
  #   `#1234` / 分支形态；legacy `docs(d578)` 之类 scope 不产生伪 issue）。
  # 缺 python / claim_store 时 MSG_ISSUE 留空 → 一致性检查退回 D# 口径（显式、不静默）。
  MSG_ISSUE=""
  CLAIM_LIB_D="$MSG_DIR/control-tower/claim_store.py"
  if [ -n "$PYBIN" ] && [ -f "$CLAIM_LIB_D" ]; then
    _SCOPE=$(head -1 "$1" 2>/dev/null | sed -E 's/^[a-zA-Z]+\(([^)]*)\).*/\1/' || true)  # swallow-ok: 非常规格式 → scope 文本 = 整行 → 提不到 issue（合法空）
    MSG_ISSUE=$("$PYBIN" "$CLAIM_LIB_D" --issue-of "$_SCOPE" 2>/dev/null | head -1 || true)  # swallow-ok: 提取失败 → 空 → 退回 D# 口径
  fi
  # D330 (KIMI K3 P1-1): resolver 内部 PYBIN 探测无可用性验证 — broken-shim 下
  # 它选中损坏 python3 → 解析失败 exit 1（D317 语义: python 不可用 → exit 1）。
  # 捕获 rc: 失败且无 brief → 显式 degraded 提示（dev doc §4: 提示+跳过可追溯,
  # 不再静默放行）
  CLAIM_RC=0
  # D1230/②（K3 R4「分支名劫持」· 提交端半边）: 解析器把"身份来自最弱锚点（分支名）"这一事实
  #   打到 **stderr**（stdout 契约不变）⇒ 本处必须**分流捕获**（旧实现把 stderr 整段丢弃 ⇒ 标记被吞，
  #   于是"分支名锚点"与"认领身份"在消费侧不可区分 = 劫持面不可见）。
  RESOLVER_ERR="$(mktemp)"  # 收敛: 无论下游如何分支，函数末尾统一清理
  CLAIM_BRIEF=$(bash "$MSG_DIR/workflow/resolve-commit-brief.sh" "$STAGED_LIST" 2>"$RESOLVER_ERR" | head -1) || CLAIM_RC=$? # swallow-ok: resolver 失败 → degraded 提示（dev doc §3.2）；stderr 已落文件（不丢诊断）
  ANCHOR_MARK="$(grep -m1 '^RESOLVER-ANCHOR:' "$RESOLVER_ERR" 2>/dev/null || true)"  # swallow-ok: 无标记 = 身份非分支锚点（正常路径），下方面向标记判分支
  # ── D1231/#1308: 解析器侧「不可匹配 Q2 条目」告警**透传**（只读，不参与判定）──
  # 为什么必须在这里: 「静默 0 匹配」的**后果**正是在提交端以「认领不一致」暴露；
  #   原因不带到这里，排查就会被再次引偏（#1308 的 D328 误报即此形态）。
  # 来源: brief_parser.parse_q2 打到 stderr 的 Q2-PARSE-WARN 行（不污染 stdout 路径契约）。
  # 不参与判定: 只在确有告警时补充说明；退出码/分支一律不受影响（判定零变更）。
  # 两档显示（降噪，D1241 实测）: ±1 天窗口内候选 brief 上百，逐条展开=每次提交刷 100+ 行，
  #   会把真正的判决行淹掉（噪音→忽视→绕过，V4.x 老教训）。故:
  #     ① 告警属于**本提交任务的 brief**（消息声明的号 / resolver 解析出的 brief）⇒ 逐条展开（5 行上限）
  #     ② 其余 ⇒ 折叠为一行计数 + 自检命令（可见但不刷屏；「不静默」由计数满足，明细在 CLI 自检）
  Q2_WARN_N=$(grep -c '^Q2-PARSE-WARN:' "$RESOLVER_ERR" 2>/dev/null | tr -d ' \r' || true)
  case "${Q2_WARN_N:-0}" in ''|*[!0-9]*) Q2_WARN_N=0 ;; esac
  if [ "$Q2_WARN_N" -gt 0 ]; then
    Q2_WARN_BRIEFS=$(grep '^Q2-PARSE-WARN:' "$RESOLVER_ERR" | sed 's/^Q2-PARSE-WARN: //' | sed 's/:[0-9][0-9]* .*//' | sort -u | grep -c . || true)
    case "${Q2_WARN_BRIEFS:-0}" in ''|*[!0-9]*) Q2_WARN_BRIEFS=0 ;; esac
    Q2_MINE=""
    if [ -n "${MSG_DID:-}" ]; then
      Q2_MINE=$(grep -F -- "$MSG_DID" "$RESOLVER_ERR" 2>/dev/null | grep '^Q2-PARSE-WARN:' || true)  # swallow-ok: 无命中即空（正常路径）→ 走下一档，下方按空判折叠
    fi
    if [ -z "$Q2_MINE" ] && [ -n "${MSG_ISSUE:-}" ]; then
      Q2_MINE=$(grep -F -- "#${MSG_ISSUE}" "$RESOLVER_ERR" 2>/dev/null | grep '^Q2-PARSE-WARN:' || true)  # swallow-ok: 同上
    fi
    if [ -z "$Q2_MINE" ] && [ -n "${CLAIM_BRIEF:-}" ]; then
      Q2_MINE=$(grep -F -- "$(basename "$CLAIM_BRIEF")" "$RESOLVER_ERR" 2>/dev/null | grep '^Q2-PARSE-WARN:' || true)  # swallow-ok: 同上
    fi
    if [ -n "$Q2_MINE" ]; then
      _Q2_MINE_N=$(printf '%s\n' "$Q2_MINE" | grep -c . || true)
      echo -e "${YELLOW}⚠ D1231/#1308: 本提交任务的 Q2 有不可匹配条目（静默 0 匹配已显式化）:${RESET}"
      printf '%s\n' "$Q2_MINE" | head -5 | sed 's/^/     /'
      if [ "${_Q2_MINE_N:-0}" -gt 5 ]; then echo "     …（本任务其余 $((_Q2_MINE_N - 5)) 条省略；全量见 brief_parser.py --q2-include）"; fi
    else
      echo -e "${YELLOW}⚠ D1231/#1308: 另有 ${Q2_WARN_N} 条不可匹配 Q2 条目（涉及 ${Q2_WARN_BRIEFS} 个候选 brief，与本提交任务无关 → 折叠）${RESET}"
      echo "   逐 brief 明细自检: python3 scripts/control-tower/brief_parser.py --q2-include <brief>（stderr 即告警）"
    fi
  fi
  if echo "$ANCHOR_MARK" | grep -q 'source=branch-anchor'; then
    # ── R4 fail-closed: 分支名（最弱锚点）与**提交消息声明**冲突 ⇒ 绝不静默采信任一方 ──
    # 口径: 分支名只作最弱锚点；身份以「提交消息声明」为准，冲突即阻断并给出两条修复路径。
    ANCHOR_DID=$(printf '%s' "$ANCHOR_MARK" | grep -oE 'd=[Dd][0-9]+' | head -1 | sed 's/^d=//' | tr 'a-z' 'A-Z' || true)  # swallow-ok: 提不到 → 空，下方条件自然短路（不误伤）
    if [ -n "$MSG_DID" ] && [ -n "$ANCHOR_DID" ] && [ "$MSG_DID" != "$ANCHOR_DID" ]; then
      echo -e "${RED}❌ D1230/R4: 分支名锚点(${ANCHOR_DID})与提交消息声明(${MSG_DID})冲突 — 疑似分支名劫持${RESET}"
      echo "   身份最弱锚点 = 分支名（只补\"无任何 brief 认领暂存文件\"的空档，不得覆盖消息声明）"
      echo "   锚点 brief: $CLAIM_BRIEF"
      echo "   修复二选一: ①改分支名到本任务号；②消息声明改与分支一致（或补齐本任务的 brief 认领）"
      rm -f "$RESOLVER_ERR" 2>/dev/null || true
      exit 1
    fi
  fi
  if [ -n "$CLAIM_BRIEF" ] && [ -f "$CLAIM_BRIEF" ] && [ -n "$PYBIN" ]; then
    # 防假阳性: 仅当 resolver 返回的 brief 真实认领了 ≥1 个暂存文件才比较 D#；
    # 走最终回退（无真实认领）时跳过——未认领场景由 G12 兜底阻断。
    # D330 (KIMI K3 P1-1): GENUINE 三态 — 输出 0=无真实认领(跳过,G12 兜底) /
    # 1=有真实认领(比较 D#) / 执行失败 rc≠0=degraded 显式提示（不再 || echo 0
    # 把"检查未执行"与"检查通过=无认领"压缩成同一个 0 静默吞掉）
    GENUINE_RC=0
    GENUINE=$(echo "$STAGED_LIST" | "$PYBIN" -c "
import re, sys
sys.path.insert(0, r'$MSG_DIR_W/control-tower')
from brief_parser import parse_q2, match_path
staged = [s for s in sys.stdin.read().split('\n') if s.strip()]
text = open(r'$CLAIM_BRIEF', encoding='utf-8', errors='replace').read()
inc = parse_q2(text).get('include', [])
print(1 if any(match_path(s, p) for s in staged for p in inc) else 0)
" 2>/dev/null) || GENUINE_RC=$? # swallow-ok: 执行失败 → 三态 degraded 显式提示（dev doc §3.2）
    if [ "$GENUINE_RC" != 0 ]; then
      echo -e "${YELLOW}⚠ D328 一致性检查 degraded: GENUINE 判定执行失败 (rc=$GENUINE_RC)，本次跳过${RESET}"
    elif [ "$GENUINE" = "1" ]; then
      # ── D-C（K3 R5）: resolver 返回 claim（`.claude/claims/<issue>.yaml`）→ 按 issue 对账 ──
      # 语义与下方 D# 口径对齐（D1231/#1308 措辞口径）: 两者都有声明且不一致 → 「疑似并行劫持」；
      #   消息侧零声明 → 「认领解析失败（非劫持）」。两类都仍 exit 1（判定零变更）。
      case "$CLAIM_BRIEF" in
        *.yaml)
          CLAIM_ISSUE=$(basename "$CLAIM_BRIEF" .yaml)
          case "$CLAIM_ISSUE" in
            ''|*[!0-9]*) CLAIM_ISSUE="" ;;
          esac
          if [ -n "$CLAIM_ISSUE" ]; then
            if [ -z "$MSG_ISSUE" ]; then
              # D1231/#1308 措辞口径: 消息侧零声明 = 「认领解析失败」，**不是**劫持（判定不变，仍 exit 1）
              echo -e "${RED}❌ D328/D-C: 提交消息未声明 issue 号，无法与暂存文件 claim(#${CLAIM_ISSUE}) 对账 — 认领解析失败（非劫持）${RESET}"
              echo "   认领 claim: $CLAIM_BRIEF"
              echo "   修复: 提交消息首行声明本任务 issue 号（如 feat(#1308): …），或确认提交的是本任务文件"
              exit 1
            elif [ "$CLAIM_ISSUE" != "$MSG_ISSUE" ]; then
              # 确有认领 ∧ 双方都有声明 ∧ 不一致 ⇒ 唯一该用「疑似并行劫持」的场景
              echo -e "${RED}❌ D328/D-C: 提交声明(#${MSG_ISSUE})与暂存文件 claim(#${CLAIM_ISSUE})不一致 — 疑似并行劫持${RESET}"
              echo "   认领 claim: $CLAIM_BRIEF"
              echo "   请确认提交的是本任务文件，或拆分暂存区后再提交"
              exit 1
            fi
          fi
          ;;
        *)
      CLAIM_DID=$(basename "$CLAIM_BRIEF" .md | grep -oE 'D[0-9]+' | head -1 || true)
      if [ -n "$CLAIM_DID" ]; then
        if [ -z "$MSG_DID" ]; then
          # D1231/#1308 措辞口径: 消息侧零声明 = 「认领解析失败」，**不是**劫持（判定不变，仍 exit 1）
          echo -e "${RED}❌ D328: 提交消息未声明任务号，无法与暂存文件归属(${CLAIM_DID}) 对账 — 认领解析失败（非劫持）${RESET}"
          echo "   认领 brief: $CLAIM_BRIEF"
          echo "   修复: 提交消息首行声明本任务号（Conventional Commits scope 位，如 fix(D1241): …），或确认提交的是本任务文件"
          exit 1
        elif [ "$CLAIM_DID" != "$MSG_DID" ]; then
          # 确有认领 ∧ 双方都有声明 ∧ 不一致 ⇒ 唯一该用「疑似并行劫持」的场景
          echo -e "${RED}❌ D328: 提交声明(${MSG_DID})与暂存文件归属(${CLAIM_DID})不一致 — 疑似并行劫持${RESET}"
          echo "   认领 brief: $CLAIM_BRIEF"
          echo "   请确认提交的是本任务文件，或拆分暂存区后再提交"
          exit 1
        fi
      fi
          ;;
      esac
    fi
  elif [ "$CLAIM_RC" != 0 ]; then
    echo -e "${YELLOW}⚠ D328 一致性检查 degraded: 认领 brief 解析失败（resolver rc=${CLAIM_RC}），本次跳过${RESET}"
  fi
  rm -f "$RESOLVER_ERR" 2>/dev/null || true
fi

# ── D395-a + D534: Note 引用门禁（非平凡变更的 commit 须引用 Note）──
# 背景: K3 咨询 §4.2 —— 开发组织的决策可沉淀、可检索、不腐化（强化 M7）。
#   形似神不似防线: 目录建了、旧文件归档了，但新决策不写 Note → 三个月后又非结构化。
#   防法 = 物理门禁（commit message 引用 Note 路径），不靠自觉。
# 触发: D395-a 仅 scripts/control-tower/ + src/orchestrator/；D534 扩展为
#   非平凡变更定义 = 治理脚本区（scripts/{control-tower,workflow,hooks}/）+
#   编排器（src/orchestrator/）+ 规则文档区（AGENTS.md/CLAUDE.md/memory/notes/README.md）。
#   排除 *.test.sh（测试产物不承载决策）与 docs/ 纯文档（D534 §4.2）。
# 条件跳过保持 <1s（ctrl-tower-change 模式 3）: 无相关变更 → 软过。
# 两层检查: ① commit message 含 memory/notes/ 引用 ② 引用的 Note 文件真实存在。
# 落点: commit-msg hook（查 commit message），非 pre-commit 组 6（K3 §4.2 L219）。
CT_ORCH_TOUCHED=$(echo "$STAGED_LIST" | grep -E '^(scripts/(control-tower|workflow|hooks)/|src/orchestrator/|AGENTS\.md$|CLAUDE\.md$|memory/notes/README\.md$)' | grep -vE '\.test\.sh$' || true)
if [ -n "$CT_ORCH_TOUCHED" ]; then
  if ! echo "$COMMIT_MSG" | grep -qE 'memory/notes/|decisions/'; then
    echo ""
    echo -e "${RED}❌ D395-a/D534 Note 引用门禁: 非平凡变更的 commit 必须引用 Note 路径${RESET}"
    echo "   本次 commit 改动命中治理脚本区/规则文档区（scripts/{control-tower,workflow,hooks}/ 或 src/orchestrator/ 或 AGENTS.md/CLAUDE.md/memory/notes/README.md）:"
    echo "$CT_ORCH_TOUCHED" | sed 's/^/     - /'
    echo "   请在 commit message 中引用决策 Note（如 memory/notes/implemented/… 或 decisions/process/… —— 2026-09-27 契约 §9 扩展）"
    echo "   （K3 §4.2: 决策可沉淀、可检索、不腐化 — 强化 M7，物理门禁不靠自觉）"
    exit 1
  fi
  NOTE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  NOTE_PATHS=$(echo "$COMMIT_MSG" | grep -oE '(memory/notes|decisions)/[A-Za-z0-9_./-]+\.md' | sort -u || true)
  if [ -z "$NOTE_PATHS" ]; then
    echo -e "${RED}❌ D395-a Note 引用门禁: commit message 含 memory/notes/ 但无有效 Note 文件路径${RESET}"
    echo "   须引用形如 memory/notes/<四态>/YYYY-MM-DD-<主题>.md 的 Note，或 decisions/<lifecycle>/YYYY-MM-DD-<主题>.md"
    exit 1
  fi
  for np in $NOTE_PATHS; do
    if [ ! -f "$NOTE_ROOT/$np" ]; then
      echo -e "${RED}❌ D395-a Note 引用门禁: 引用的 Note 文件不存在: $np${RESET}"
      echo "   请先创建该 Note（四字段头: 状态/日期/决策/理由），或修正 commit message 中的路径"
      exit 1
    fi
  done
  echo -e "${GREEN}✅ D395-a Note 引用门禁: commit 引用 Note ${NOTE_PATHS}（文件存在）${RESET}"
else
  echo -e "${GREEN}✅ D395-a/D534 Note 引用门禁: 无治理/规则区变更（跳过）${RESET}"
fi
exit 0
