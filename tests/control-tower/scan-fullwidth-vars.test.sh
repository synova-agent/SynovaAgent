#!/bin/bash
# D313 M5 UTF-8 强制
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# scan-fullwidth-vars.test.sh — D938 扫描器配对测试（铁律 48: 正常/降级/边界 + 接线）
#
# 被测: scripts/control-tower/scan-fullwidth-vars.sh（**跑生产脚本本体，禁测副本**）
#
# 覆盖矩阵:
#   接线   — 扫描器存在 + 真用 grep -E 家族 + 已在 ci.yml 密封清单（防 D664「建成未接线」M3）
#   反空转 — **金丝雀（核心一票判据）**: 临时目录塞 `$VAR` 紧贴全角标点的 .sh
#            → 扫描器必须抓到（rc=1 且点名文件）。抓不到 = 网是空转的 → 红。
#            沿 tests/control-tower/grep-oP-regression.test.sh 反向哨兵先例。
#   正常   — **判据②（CTO 裁定 A1 后口径）: 本卡写集内 mac 域残留 = 0**（严格判红/绿）
#   接口   — `--domain win` 供 Win 侧新卡消费: 残余文件数在 [1, 10]，且列出的每个违规文件
#            经 check-ownership.py 复核**确属 win 域**（防域过滤串味）
#   边界 1 — `.ps1` 金丝雀落「需专项定性」桶、**不计违规**（PowerShell 变量名语义不同
#            → 误判即产出伪缺陷）
#   边界 2 — 注释行金丝雀不计违规（无害）
#   边界 3 — 非 POSIX shell 的 .md/.py 同样落 triage 桶
#   降级   — 不可读路径 / 不存在路径 / 空扫描集 / --domain 外路径 → **exit 2**（不与 0 混同）
#   负例   — `grep -P` 静默失败陷阱: ① 实测该陷阱在本平台确实存在（`2>/dev/null` → 0 命中）
#            ② 扫描器源码（去注释）不得出现 `-P`；③ 金丝雀证明本扫描器真匹配（非空转）
#   自清   — 扫描器自身文件在网内必须零违规（作者不得把被测缺陷写进检测器）
#
# ⚠️ 棘轮基线（D938-V1 实测 + CTO 裁定 A1，**不是期望值，是上限**）:
#   正确口径（6 字符全角类 `（）：，。；、`，bash 3.2 逐字符实测全触发）下，`scripts/**`:
#     · 本卡写集（5 文件: c1 的 4 个 mac 源文件 + 扫描器自身）残留 = **0** ← 判红/绿口径
#     · 全 mac 域残余 = 6 文件 / 8 处违规（写集外 6 文件按 A1 归新 mac 卡，本卡不动）
#     · 全 win 域残余 = 10 文件 / 18 处违规（+ 2 文件落 triage 桶不计违规）→ 待 Win 侧卡
#   A1 理由（CTO 裁定）: 扩写集会到 15 文件 > PR 预算 12（check-pr-budget.sh 硬拦，禁调高上限）。
#   本测试**不把真红改写成假绿**：写集内严格判 0；写集外只设上限（新增即红，清掉自动收敛）。
#   口径: 命令＋排除项＋截至时刻见扫描器输出的「口径:」行（数字一律来自命令原始输出）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF_TS="$REPO/tests/control-tower/scan-fullwidth-vars.test.sh"   # 本文件自身（§7 自清覆盖它）
SCAN="$REPO/scripts/control-tower/scan-fullwidth-vars.sh"
CI_YML="$REPO/.github/workflows/ci.yml"
MAC_VIOL_BASELINE=8    # 上限（棘轮）：全 mac 域违规**处**数，见文件头说明，非期望值
MAC_RES_BASELINE=6     # 上限（棘轮）：全 mac 域残余**文件**数（CTO 裁定 A1 的登记值）
WIN_FILE_BASELINE=10   # 上限（棘轮）：全 win 域残余文件数（CTO 裁定订正 8 → 10）

PASS=0; FAIL=0; SKIP=0
FAILED_NAMES=()
FIRST_FAIL=""
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
# D938-CI-2(可见性): ci.yml 注解 tail -8|cut -c1-450 在长输出下截掉末行 FAILED(N) 摘要
#   （#739 windows 实测）。FIRST_FAIL 压进**结果行本身**，窗口含结果行即必可见；叠加不替换。
no()   { echo "  ❌ $1"; FAIL=$((FAIL+1)); FAILED_NAMES+=("$1"); if [ -z "$FIRST_FAIL" ]; then FIRST_FAIL="$1"; fi; }   # D938-CI: 记名以便尾部摘要
skip() { echo "  ⏭ $1"; SKIP=$((SKIP+1)); }
# 绿腿告警必须可见（CI 只打印失败测试的输出 → 绿腿的 SKIP/缩水必须走 annotation）
visible_warn() {
  echo "  ⚠️  $1"
  [ "${GITHUB_ACTIONS:-}" = "true" ] && echo "::warning title=scan-fullwidth-vars.test.sh::$1"
  return 0
}

TMPD="$(mktemp -d)" || { echo "mktemp 失败"; exit 1; }
trap 'rm -rf "$TMPD"' EXIT

# python 三级探测（PLATFORM-CHECKLIST #1）
PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c 'import sys' >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done

# 全角开括号（拼装，避免本文件自身在代码行上出现被测形态 —— 本文件在网外也应自清）
FW='（'
FW2='）'

# 取扫描器输出里的计数: $1=输出 $2=匹配键（如 'viol'|'mac_resid'|'win_files'）
grab_viol()      { printf '%s\n' "$1" | sed -n 's/^【违规（代码行）】\([0-9][0-9]*\) 处 \/ \([0-9][0-9]*\) 文件$/\1 \2/p' | head -1; }
grab_mac_files() { printf '%s\n' "$1" | sed -n 's/^全 mac 域残余.*：\([0-9][0-9]*\) 文件 \/ \([0-9][0-9]*\) 处违规.*$/\1 \2/p' | head -1; }
grab_win_files() { printf '%s\n' "$1" | sed -n 's/^win 域：\([0-9][0-9]*\) 文件待 .*$/\1/p' | head -1; }
grab_win_full()  { printf '%s\n' "$1" | sed -n 's/^全 win 域残余.*：\([0-9][0-9]*\) 文件 \/ \([0-9][0-9]*\) 处违规.*$/\1 \2/p' | head -1; }
grab_ws_resid()  { printf '%s\n' "$1" | sed -n 's/^本卡写集内 mac 域残留：\([0-9][0-9]*\) 处 \/ \([0-9][0-9]*\) 文件$/\1 \2/p' | head -1; }
grab_triage()    { printf '%s\n' "$1" | sed -n 's/^【需专项定性】\([0-9][0-9]*\) 处 \/ \([0-9][0-9]*\) 文件.*$/\1 \2/p' | head -1; }
grab_comment()   { printf '%s\n' "$1" | sed -n 's/^【注释行（无害）】\([0-9][0-9]*\) 处 \/ \([0-9][0-9]*\) 文件$/\1 \2/p' | head -1; }

echo "═══════════════════════════════════════════════════════════"
echo "  D938 scan-fullwidth-vars 扫描器测试"
echo "═══════════════════════════════════════════════════════════"

# ── 0. 接线 ──────────────────────────────────────────────────────────────────
echo ""
echo "── 0. 接线（扫描器存在 + 真匹配 + ci.yml 密封）──"
if [ -f "$SCAN" ]; then ok "扫描器存在: scripts/control-tower/scan-fullwidth-vars.sh"; else no "扫描器缺失"; fi
if grep -qE 'grep[[:space:]]+-[A-Za-z]*n[A-Za-z]*H?[A-Za-z]*E|grep -nHE' "$SCAN"; then
  ok "接线: 走 grep -E 家族（非 -P）"
else
  no "接线: 未检出 grep -nHE/-E 调用"
fi
if grep -qF 'scan-fullwidth-vars.test.sh' "$CI_YML" 2>/dev/null; then
  ok "接线: 已入 .github/workflows/ci.yml control-tower-tests 密封清单"
else
  no "接线缺失: ci.yml 密封清单无本测试 = 机制建成未接线（D664 M3）"
fi

# ── 1. 负例: grep -P 静默失败陷阱 ─────────────────────────────────────────────
echo ""
echo "── 1. 负例: grep -P 静默失败陷阱（假绿家族）──"
# D938-CI(方言): 改**显式平台探针 + 双分支期望**（CTO 新规范），不再依赖 rc 的巧合分支、不再 skip。
#   探针: 用一条管道判 -P 是否可用（BSD grep 无 -P → 走不支持分支；GNU/msys → 支持分支）。
if printf 'x\n' | grep -qP 'x' 2>/dev/null; then P_SUPPORTED=1; else P_SUPPORTED=0; fi
echo "  平台探针: printf 'x' | grep -qP 'x' → 支持=${P_SUPPORTED}（1=本平台 grep 有 -P）"
if [ "$P_SUPPORTED" = "0" ]; then
  # 支持分支：-P 不存在 ⇒ 陷阱必然存在，实测复现它（rc=2 且 2>/dev/null 后读成 0 命中）
  P_HITS=$(grep -rnP "$(printf '\\$\\w+%s' "$FW")" "$REPO/scripts" 2>/dev/null | wc -l | tr -d ' \r')
  P_RC=$(grep -rnP 'x' "$REPO/scripts" >/dev/null 2>&1; echo $?)
  if [ "$P_RC" = "2" ] && [ "$P_HITS" = "0" ]; then
    ok "陷阱复现: grep -P → rc=2，但 \`2>/dev/null\` 后读到 0 命中（这就是假绿来源）"
  else
    no "陷阱未复现（无 -P 的平台却 rc=${P_RC} hits=${P_HITS}）—— 前提不成立，需人工核"
  fi
else
  # 不支持分支：本平台有 -P ⇒ 陷阱**不适用**，改断言「等效风险」——PCRE 与 ERE 语义不同,
  #   用 -P 写出的门禁在无 -P 平台会静默失效；断言扫描器不写 -P（下条静态断言）+ 金丝雀真匹配（§2）。
  ok "本平台 grep 支持 -P（GNU/msys）→ 陷阱不适用；等效风险由下条静态断言 + §2 金丝雀覆盖"
fi
# ② 静态: 扫描器**代码行**（去注释）不得出现 -P（注释里写"禁 grep -P"不算）
P_CODE=$(grep -vE '^[[:space:]]*#' "$SCAN" | grep -E 'grep[^|]*[[:space:]]-[A-Za-z]*P[A-Za-z]*([[:space:]]|$)')
if [ -z "$P_CODE" ]; then
  ok "扫描器代码行零 grep -P（若出现 -P → 本测试必红）"
else
  no "扫描器代码行出现 grep -P（BSD 下静默失效 = 假绿）: $(printf '%s' "$P_CODE" | head -1)"
fi

# ── 2. 反空转金丝雀: .sh（核心一票判据）───────────────────────────────────────
echo ""
echo "── 2. 反空转金丝雀: 含 \$VAR 紧贴全角的 .sh 必须被网抓到 ──"
CAN="$TMPD/canary"; mkdir -p "$CAN"
printf '#!/bin/bash\necho "$D938_CANARY_VAR%sx)"\n' "$FW" > "$CAN/canary.sh"
OUT=$(bash "$SCAN" --paths "$CAN" 2>&1); RC=$?
if [ "$RC" = "1" ]; then ok "金丝雀被抓到: rc=1"; else no "金丝雀未被抓到: rc=${RC}（期望 1）—— 网可能在空转"; fi
if printf '%s' "$OUT" | grep -qF 'canary.sh'; then ok "金丝雀文件名出现在输出里"; else no "输出未点名金丝雀文件"; fi
V=$(grab_viol "$OUT")
if [ "$V" = "1 1" ]; then ok "违规计数 = 1 处 / 1 文件"; else no "违规计数应为 '1 1'，实得 '$V'"; fi

# ── 3. 边界: .ps1 落 triage 桶、不计违规 ─────────────────────────────────────
echo ""
echo "── 3. 边界: .ps1 计「需专项定性」，**不计违规**（防伪缺陷）──"
PS1="$TMPD/ps1"; mkdir -p "$PS1"
printf 'Write-Host "$failStep%sx)"\n' "$FW" > "$PS1/canary.ps1"
OUT=$(bash "$SCAN" --paths "$PS1" 2>&1); RC=$?
if [ "$RC" = "0" ]; then ok ".ps1 不计违规: rc=0"; else no ".ps1 被判违规: rc=${RC}（期望 0，误判即伪缺陷）"; fi
T=$(grab_triage "$OUT")
if [ "$T" = "1 1" ]; then ok "triage 桶收下 .ps1: 1 处 / 1 文件"; else no "triage 计数应为 '1 1'，实得 '$T'"; fi
if printf '%s' "$OUT" | sed -n '/^【违规（代码行）】/,/^【注释行/p' | grep -qF 'canary.ps1'; then
  no ".ps1 出现在违规清单里"
else
  ok ".ps1 未出现在违规清单里"
fi

# ── 4. 边界: 注释行金丝雀不计违规 ────────────────────────────────────────────
echo ""
echo "── 4. 边界: 注释行金丝雀（无害）──"
CMT="$TMPD/comment"; mkdir -p "$CMT"
printf '#!/bin/bash\n# echo "$D938_CANARY_VAR%sx)"\n' "$FW" > "$CMT/c.sh"
OUT=$(bash "$SCAN" --paths "$CMT" 2>&1); RC=$?
if [ "$RC" = "0" ]; then ok "注释行不计违规: rc=0"; else no "注释行被判违规: rc=$RC"; fi
C=$(grab_comment "$OUT")
if [ "$C" = "1 1" ]; then ok "注释桶收下: 1 处 / 1 文件"; else no "注释计数应为 '1 1'，实得 '$C'"; fi

# ── 5. 边界: 非 shell 文件（.md/.py）同样落 triage ───────────────────────────
echo ""
echo "── 5. 边界: .md / .py 同样落 triage（文档/其他语言非本缺陷）──"
MIX="$TMPD/mix"; mkdir -p "$MIX"
printf 'doc: $SOME_VAR%sx)\n' "$FW" > "$MIX/doc.md"
printf 's = "$some_var%sx)"\n' "$FW" > "$MIX/a.py"
OUT=$(bash "$SCAN" --paths "$MIX" 2>&1); RC=$?
T=$(grab_triage "$OUT")
if [ "$RC" = "0" ] && [ "$T" = "2 2" ]; then
  ok ".md/.py 落 triage 且不计违规（rc=0, triage=2 处/2 文件）"
else
  no ".md/.py 边界: rc=${RC}（期望 0），triage='$T'（期望 '2 2'）"
fi

# ── 6. 降级/失败: 三态退出码（2 绝不与 0 混同）────────────────────────────────
echo ""
echo "── 6. fail-closed: 参数/路径/空集异常一律 exit 2（不与 0 混同）──"
bash "$SCAN" --paths "$TMPD/no-such-file-938.sh" >/dev/null 2>&1; RC=$?
[ "$RC" = "2" ] && ok "不存在路径 → rc=2" || no "不存在路径应 rc=2，实得 $RC"
EMPTY="$TMPD/empty"; mkdir -p "$EMPTY"
bash "$SCAN" --paths "$EMPTY" >/dev/null 2>&1; RC=$?
[ "$RC" = "2" ] && ok "空扫描集 → rc=2（不判绿）" || no "空扫描集应 rc=2，实得 $RC"
bash "$SCAN" --bogus-flag >/dev/null 2>&1; RC=$?
[ "$RC" = "2" ] && ok "未知参数 → rc=2" || no "未知参数应 rc=2，实得 $RC"
bash "$SCAN" --domain mac --paths /tmp >/dev/null 2>&1; RC=$?
[ "$RC" = "2" ] && ok "--domain 下域外路径 → rc=2（不猜域）" || no "--domain 域外路径应 rc=2，实得 $RC"
# 不可读文件 → grep rc=2 → 扫描器必须 exit 2（非 0）。root/Windows 下 chmod 无效 → 显式 SKIP
UNR="$TMPD/unread"; mkdir -p "$UNR"; printf 'x\n' > "$UNR/f.sh"; chmod 000 "$UNR/f.sh" 2>/dev/null || true
if [ ! -r "$UNR/f.sh" ]; then
  bash "$SCAN" --paths "$UNR/f.sh" >/dev/null 2>&1; RC=$?
  [ "$RC" = "2" ] && ok "不可读文件 → rc=2（grep rc≥2 不当作「0 命中」）" || no "不可读文件应 rc=2，实得 $RC"
else
  skip "chmod 000 无效（root/MSYS）→ 不可读路径用例跳过"
fi
chmod 600 "$UNR/f.sh" 2>/dev/null || true

# ── 7. 自清: 扫描器自身 + **本测试文件自身** 零违规 ───────────────────────────
echo ""
echo "── 7. 自清: 扫描器自身 + 本测试文件自身 在网内零违规 ──"
OUT=$(bash "$SCAN" --paths "$SCAN,$SELF_TS" 2>&1); RC=$?
V=$(grab_viol "$OUT")
if [ "$V" = "0 0" ] && [ "$RC" = "0" ]; then
  ok "扫描器自身 + 本测试文件自身零违规（作者未把被测缺陷写进检测器/夹具）"
else
  no "自清失败: $V 违规（rc=${RC}）—— 检测器或夹具自身带病（本文件曾漏扫自身，被 D938-v 抓到）"
fi

# ── 8. 判据②（CTO 裁定 A1 后口径）: **本卡写集内** mac 域残留 = 0 ──────────────
# 卡面原文「mac 域已清 / 残留 0」在全 mac 域不可达（写集外 6 文件、超 PR 预算 12 → 裁定不扩写集）。
# 故判红/绿的口径改为「本卡写集内残留 0」；**全 mac 域残余只作登记信息打印，不是失败条件**。
# D938-v 复核 + CTO 裁定（第三次 reopen）: 本断言原先只覆盖 5 文件（c1 写集 4 + 扫描器自身）
#   → **判据空转**（连本文件自己的 2 处同类缺陷都照不到）。现按 brief 的 **9 个 task 文件**全覆盖，
#   并加**条数自检**（窄化即红）—— 使该断言真的等于「本卡写集内 mac 域残留 = 0」。
# task-26 改指在库真身: 原第 2 个路径 `scripts/control-tower/check-sentinel-type-net.sh` 已随
#   D962 2a 退役（plan §一 #33「合并到 check-architecture.sh」）⇒ 扫描器对该路径 fail-closed
#   （rc=2「路径不存在」）且不打印标签 ⇒ 本断言此前以「标签格式漂移」**误报**。
#   现替换为承接真身 `scripts/check-architecture.sh`：**判据强度不变**（仍 9 文件全覆盖 + 条数自检）。
D938_WS="scripts/control-tower/alloc-task-id.sh,scripts/check-architecture.sh,scripts/doc-system/check-doc-truth.sh,scripts/doc-system/doc-truth-probe.sh,scripts/control-tower/scan-fullwidth-vars.sh,tests/control-tower/scan-fullwidth-vars.test.sh,tests/control-tower/alloc-task-id.test.sh,tests/control-tower/alloc-task-id-lock.test.sh,.github/workflows/ci.yml"
D938_WS_COUNT=$(printf '%s\n' "$D938_WS" | tr ',' '\n' | grep -c . || true)
echo ""
echo "── 8. 判据②: 本卡写集内 mac 域残留 = 0（严格判红/绿）──"
if [ "$D938_WS_COUNT" = "9" ]; then
  ok "写集断言覆盖面 = ${D938_WS_COUNT} 文件（brief 的 task 文件全集：4 scripts + 扫描器 + 3 测试 + ci.yml）"
else
  fail "写集断言只覆盖 ${D938_WS_COUNT} 文件（须 9）—— 窄化即判据空转（D938-v 实测过）"
fi
OUT=$(bash "$SCAN" --domain mac --paths "$D938_WS" 2>&1); RC=$?
WS=$(grab_ws_resid "$OUT")
if [ -z "$WS" ]; then
  # task-26: 区分「标签格式漂移」与「扫描器 fail-closed」——后者 rc=2，此前被误归为前者（诊断黑洞）
  if [ "$RC" = "2" ]; then
    no "写集模式未输出标签且扫描器 fail-closed (rc=2): $(printf '%s\n' "$OUT" | grep -m1 '❌' | sed 's/^ *//')"
  else
    no "写集模式未输出「本卡写集内 mac 域残留：…」（标签格式漂移，rc=${RC}）"
  fi
elif [ "$WS" = "0 0" ]; then
  ok "本卡写集内 mac 域残留 = 0 处 / 0 文件（${D938_WS_COUNT} 文件全覆盖：4 scripts + 扫描器 + 3 测试 + ci.yml）"
else
  # 红形态必须**点名 file:line**（否则判别信息丢失 —— 只有一句「仍有违规」等于没信号）
  no "本卡写集内 mac 域残留 = ${WS}（应为 '0 0'）—— 本卡写集内仍有违规，逐行清单如下:"
  printf '%s\n' "$OUT" | sed -n '/^【违规（代码行）】/,/^【注释行/p' | sed 's/^/      /' >&2
fi
[ "$RC" = "0" ] && ok "写集模式零违规 → rc=0" || no "写集模式应 rc=0，实得 ${RC}"

# ── 8b. 登记信息: 全 mac 域残余（**scripts/ 半径内**，棘轮上限，非失败条件）──────
echo ""
echo "── 8b. 登记: 全 mac 域残余（棘轮上限 ${MAC_RES_BASELINE} 文件 / ${MAC_VIOL_BASELINE} 处）──"
OUT=$(bash "$SCAN" --domain mac 2>&1); RC=$?
MF=$(grab_mac_files "$OUT")
if [ -z "$MF" ]; then
  no "未输出「全 mac 域残余：…」标签（CTO 要求的两段标签缺失）"
else
  M_FILES=${MF% *}; M_LINES=${MF#* }
  if [ "$M_FILES" -le "$MAC_RES_BASELINE" ] && [ "$M_LINES" -le "$MAC_VIOL_BASELINE" ]; then
    ok "全 mac 域残余 $M_FILES 文件 / $M_LINES 处 ≤ 上限 $MAC_RES_BASELINE / $MAC_VIOL_BASELINE"
  else
    no "全 mac 域残余 ${M_FILES} 文件 / ${M_LINES} 处 > 上限 ${MAC_RES_BASELINE} / ${MAC_VIOL_BASELINE}（**回退/新增**，真红）"
  fi
  if [ "$M_LINES" -gt 0 ]; then
    visible_warn "全 mac 域残余 $M_FILES 文件 / $M_LINES 处（写集外，按 CTO 裁定 A1 归新 mac 卡，本卡不动）—— 见 --domain mac 逐行清单"
  fi
  [ "$RC" = "1" ] && ok "全 mac 域有残余时 rc=1" || no "全 mac 域有残余应 rc=1，实得 ${RC}"
fi
# 半径注记（防 K3 把 scripts/ 半径误读成全仓口径）: 默认半径 = scripts/**，不含 tests/**
OUT=$(bash "$SCAN" --domain mac 2>&1)
if printf '%s\n' "$OUT" | grep -q "scripts/ 半径内"; then
  ok "残余标签带半径注记「scripts/ 半径内」（默认半径不含 tests/**，防误读为全仓口径）"
else
  no "残余标签缺半径注记 —— 会被误读为全仓口径（tests/** 另有存量，不在本卡半径内）"
fi
if printf '%s\n' "$OUT" | grep -qE '^扫描集: .*（默认 scripts/\*\*）'; then
  ok "扫描集口径行明示默认半径 scripts/**"
else
  no "扫描集口径行未明示默认半径"
fi

# ── 9. 接口冒烟: --domain win（供 Win 侧新卡消费）────────────────────────────
echo ""
echo "── 9. 接口: --domain win（Win 卡可直接复用；棘轮上限 $WIN_FILE_BASELINE 文件）──"
OUT=$(bash "$SCAN" --domain win 2>&1); RC=$?
WF=$(grab_win_files "$OUT")
if [ -z "$WF" ]; then
  no "--domain win 未输出可解析的文件数（接口格式漂移）"
else
  if [ "$WF" -ge 1 ] && [ "$WF" -le "$WIN_FILE_BASELINE" ]; then
    ok "win 待处理 $WF 文件 ∈ [1, $WIN_FILE_BASELINE]（域过滤生效）"
  elif [ "$WF" -eq 0 ]; then
    no "win 文件数 0 —— 域过滤可能失效（或 Win 卡已全清；若已全清请复核本断言与密封清单）"
  else
    no "win 文件数 $WF > 上限 ${WIN_FILE_BASELINE}（**新增缺陷**，真红）"
  fi
  if [ "$WF" -lt "$WIN_FILE_BASELINE" ] && [ "$WF" -ge 1 ]; then
    visible_warn "win 域已少于基线 ${WIN_FILE_BASELINE}（现 ${WF}）→ Win 侧新卡可能已落地，请复核本测试上限与密封清单"
  fi
fi
WL=$(grab_win_full "$OUT")
if [ -z "$WL" ]; then
  no "未输出「全 win 域残余：…」标签（CTO 要求的两段标签缺失）"
else
  ok "全 win 域残余标签存在：${WL}（文件 / 违规处）"
fi
# 域过滤真伪: win 模式列出的每个违规文件必须**确属 win**
WIN_FILES=$(printf '%s\n' "$OUT" | sed -n '/^【违规（代码行）】/,/^【注释行/p' | sed -n 's/^  \([^ ]*\):[0-9][0-9]*:.*$/\1/p' | sort -u)
WIN_N=$(printf '%s\n' "$WIN_FILES" | grep -c . || true)
if [ -n "$PYBIN" ] && [ "$WIN_N" -ge 1 ]; then
  if printf '%s\n' "$WIN_FILES" | (cd "$REPO" && xargs "$PYBIN" "$REPO/scripts/control-tower/check-ownership.py" --owner win --quiet >/dev/null 2>&1); then
    ok "域过滤真伪: win 模式列出的 $WIN_N 个文件经 check-ownership.py --owner win 复核全部属 win"
  else
    no "域过滤串味: win 模式列出的文件里有非 win 归属（check-ownership.py --owner win 失败）"
  fi
else
  skip "无 python 或无违规文件 → 归属复核跳过（域判定能力缺失，非通过）"
fi

# ── 10. --json 机器可读 ──────────────────────────────────────────────────────
echo ""
echo "── 10. --json: stdout 是合法 JSON ──"
# D938-CI(方言): 原实现 `open('$TMPD/out.json')` —— mktemp 的 MSYS 绝对路径 `/tmp/...`
#   交给 native Windows python（py/python）解析不了 → FileNotFoundError → 仅 CI windows 红
#   （#739 windows FIRST_FAIL=--json 实证；同族问题见 alloc-task-id-lock.test.sh L44-46 注释）。
#   改**方言无关构造**: JSON 走 stdin 管道（sys.stdin），不跨方言传路径。
#   SCAN 侧 `|| true`: 扫描器有违规时 rc=1，若直接进 pipefail 管道会误伤本断言（本断言只判 JSON 合法性）。
if [ -n "$PYBIN" ]; then
  if { bash "$SCAN" --json 2>/dev/null || true; } | "$PYBIN" -c "import json,sys; d=json.load(sys.stdin); assert d['counts']['violations']>=0; assert 'mac' in d['domains'] or d['domains'].get('status'); print('ok')" >/dev/null 2>&1; then
    ok "--json 输出可被 python json.load 解析且字段完整"
  else
    no "--json 输出非法或字段缺失"
  fi
else
  skip "无 python → JSON 合法性未校验"
fi

# ── 11. --paths-file ────────────────────────────────────────────────────────
echo ""
echo "── 11. --paths-file: 路径集从文件读入 ──"
printf '# 注释行忽略\n\n%s\n' "$CAN/canary.sh" > "$TMPD/paths.txt"
OUT=$(bash "$SCAN" --paths-file "$TMPD/paths.txt" 2>&1); RC=$?
V=$(grab_viol "$OUT")
if [ "$RC" = "1" ] && [ "$V" = "1 1" ]; then
  ok "--paths-file 生效（忽略注释/空行，抓到金丝雀 1 处）"
else
  no "--paths-file 未生效: rc=$RC, viol='$V'"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
# D938-CI-2: FAIL>0 但 FIRST_FAIL 为空 = 夹具自身缺陷，显式红，不得静默
if [ "$FAIL" -gt 0 ] && [ -z "$FIRST_FAIL" ]; then
  echo "  ❌ SELF-CHECK: FAIL=$FAIL 但 FIRST_FAIL 为空（no() 记名机制缺陷）"
  exit 2
fi
echo "  结果: PASS=$PASS FAIL=$FAIL SKIP=$SKIP${FIRST_FAIL:+ FIRST_FAIL=${FIRST_FAIL}}"
echo "═══════════════════════════════════════════════════════════"
[ "$SKIP" -gt 0 ] && visible_warn "本测试有 $SKIP 项 SKIP（平台能力缺失，非通过）—— 计数已进入结果行"
# 失败摘要（**必须留在最后一行**：CI 只截 tail -8 进 ::error 注解，无摘要就只能靠猜）
if [ "$FAIL" -gt 0 ]; then
  D938_DIGEST=""
  for _n in ${FAILED_NAMES[@]+"${FAILED_NAMES[@]}"}; do D938_DIGEST="${D938_DIGEST}${_n} ; "; done
  echo "❌ FAILED(${FAIL}): ${D938_DIGEST}"
fi
[ "$FAIL" -eq 0 ] || exit 1
exit 0
