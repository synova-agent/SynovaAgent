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

PATTERN='^(feat|fix|chore|docs|test|refactor|perf|style|ci|build)(\([a-zA-Z0-9_.-]+\))?: .{1,140}$'

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
#   - D979 FIX-011 ⒝（共享治理文件多卡归属）: 被认领文件集合 M 中**每一个** F 的
#     声明集 SHARED(F) 同时含 MSG_DID 与 CLAIM_DID → 放行（唯一放行口，逐文件双向，
#     声明写在被改文件内 = diff 可见；单独把自己加进声明不足以放行）。
#     其余一切情形（含 MSG_DID 为空、声明缺失、解析器 rc=2）维持上述原语义 = 零回归。
#     解析器: scripts/control-tower/shared_file_decl.py（读取顺序 index→工作区→HEAD）
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
  # D330 (KIMI K3 P1-1): resolver 内部 PYBIN 探测无可用性验证 — broken-shim 下
  # 它选中损坏 python3 → 解析失败 exit 1（D317 语义: python 不可用 → exit 1）。
  # 捕获 rc: 失败且无 brief → 显式 degraded 提示（dev doc §4: 提示+跳过可追溯,
  # 不再静默放行）
  CLAIM_RC=0
  CLAIM_BRIEF=$(bash "$MSG_DIR/workflow/resolve-commit-brief.sh" "$STAGED_LIST" 2>/dev/null | head -1) || CLAIM_RC=$? # swallow-ok: resolver 失败 → degraded 提示（dev doc §3.2）
  if [ -n "$CLAIM_BRIEF" ] && [ -f "$CLAIM_BRIEF" ] && [ -n "$PYBIN" ]; then
    # 防假阳性: 仅当 resolver 返回的 brief 真实认领了 ≥1 个暂存文件才比较 D#；
    # 走最终回退（无真实认领）时跳过——未认领场景由 G12 兜底阻断。
    # D330 (KIMI K3 P1-1): GENUINE 三态 — 输出 0=无真实认领(跳过,G12 兜底) /
    # 1=有真实认领(比较 D#) / 执行失败 rc≠0=degraded 显式提示（不再 || echo 0
    # 把"检查未执行"与"检查通过=无认领"压缩成同一个 0 静默吞掉）
    # D979 FIX-011: 由 GENUINE 布尔升级为「被认领文件集合 M」（逐文件双向校验的输入）。
    # 语义不变: 输出为空 ⇔ 无真实认领（跳过，G12 兜底）；非空 ⇔ 有真实认领（比较 D#）。
    GENUINE_RC=0
    CLAIMED_FILES=$(echo "$STAGED_LIST" | "$PYBIN" -c "
import re, sys
sys.path.insert(0, r'$MSG_DIR_W/control-tower')
from brief_parser import parse_q2, match_path
staged = [s for s in sys.stdin.read().split('\n') if s.strip()]
text = open(r'$CLAIM_BRIEF', encoding='utf-8', errors='replace').read()
inc = parse_q2(text).get('include', [])
print('\n'.join(s for s in staged if any(match_path(s, p) for p in inc)))
" 2>/dev/null) || GENUINE_RC=$? # swallow-ok: 执行失败 → 三态 degraded 显式提示（dev doc §3.2）
    if [ "$GENUINE_RC" != 0 ]; then
      echo -e "${YELLOW}⚠ D328 一致性检查 degraded: GENUINE 判定执行失败 (rc=$GENUINE_RC)，本次跳过${RESET}"
    elif [ -n "$CLAIMED_FILES" ]; then
      CLAIM_DID=$(basename "$CLAIM_BRIEF" .md | grep -oE 'D[0-9]+' | head -1 || true)
      if [ -n "$CLAIM_DID" ] && { [ -z "$MSG_DID" ] || [ "$CLAIM_DID" != "$MSG_DID" ]; }; then
        # ── D979 FIX-011 ⒝: 共享声明放行 —— 唯一放行口 ──
        # 前提: MSG_DID 非空（双向校验需要两侧 D#）。MSG_DID 为空 → 不做声明判定，
        # 维持原阻断（现状零回归，禁止把「提交未声明任务归属」洗成放行）。
        DECL_RC=1
        DECL_OUT=""
        if [ -n "$MSG_DID" ]; then
          # Windows/MSYS: python 不能解析 MSYS 路径 → cygpath -w（对齐 MSG_DIR_W 模式）
          DECL_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
          DECL_ROOT_W="$(cygpath -w "$DECL_ROOT" 2>/dev/null || echo "$DECL_ROOT")"
          DECL_RC=0
          DECL_OUT=$(printf '%s\n' "$CLAIMED_FILES" | "$PYBIN" "$MSG_DIR_W/control-tower/shared_file_decl.py" \
            --msg-did "$MSG_DID" --claim-did "$CLAIM_DID" \
            --root "$DECL_ROOT_W" --files-from - 2>/dev/null) || DECL_RC=$? # swallow-ok: 解析器失败 → 下方按未声明处理（fail-closed），绝不静默放行
        fi
        if [ "$DECL_RC" = 0 ]; then
          echo -e "${GREEN}✅ D328 共享声明放行（D979 FIX-011 ⒝）: 暂存文件逐文件双向声明命中${RESET}"
          echo "   认领 brief: $CLAIM_BRIEF"
          if [ -n "$DECL_OUT" ]; then
            echo "$DECL_OUT" | sed 's/^/   /'
          fi
        else
          if [ "$DECL_RC" = 2 ]; then
            echo -e "${YELLOW}⚠ D328 共享声明检查 degraded (rc=2): 无法判定声明集 — 按未声明处理（不静默放行）${RESET}"
          fi
          echo -e "${RED}❌ D328: 提交声明(${MSG_DID:-无})与暂存文件归属($CLAIM_DID)不一致 — 疑似并行劫持${RESET}"
          echo "   认领 brief: $CLAIM_BRIEF"
          if [ -n "$DECL_OUT" ]; then
            echo "$DECL_OUT" | sed 's/^/   /'
          fi
          echo "   请确认提交的是本任务文件，或拆分暂存区后再提交"
          exit 1
        fi
      fi
    fi
  elif [ "$CLAIM_RC" != 0 ]; then
    echo -e "${YELLOW}⚠ D328 一致性检查 degraded: 认领 brief 解析失败（resolver rc=${CLAIM_RC}），本次跳过${RESET}"
  fi
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
  if ! echo "$COMMIT_MSG" | grep -qE 'memory/notes/'; then
    echo ""
    echo -e "${RED}❌ D395-a/D534 Note 引用门禁: 非平凡变更的 commit 必须引用 Note 路径${RESET}"
    echo "   本次 commit 改动命中治理脚本区/规则文档区（scripts/{control-tower,workflow,hooks}/ 或 src/orchestrator/ 或 AGENTS.md/CLAUDE.md/memory/notes/README.md）:"
    echo "$CT_ORCH_TOUCHED" | sed 's/^/     - /'
    echo "   请在 commit message 中引用决策 Note（如 memory/notes/implemented/2026-08-17-<主题>.md）"
    echo "   （K3 §4.2: 决策可沉淀、可检索、不腐化 — 强化 M7，物理门禁不靠自觉）"
    exit 1
  fi
  NOTE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  NOTE_PATHS=$(echo "$COMMIT_MSG" | grep -oE 'memory/notes/[A-Za-z0-9_./-]+\.md' | sort -u || true)
  if [ -z "$NOTE_PATHS" ]; then
    echo -e "${RED}❌ D395-a Note 引用门禁: commit message 含 memory/notes/ 但无有效 Note 文件路径${RESET}"
    echo "   须引用形如 memory/notes/<四态>/YYYY-MM-DD-<主题>.md 的 Note 文件"
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
