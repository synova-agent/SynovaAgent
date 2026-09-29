#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# install-dsh-preset.test.sh — DSH 预设一键安装脚本测试（D945: 载体 = profile bundle 层）
#
# 覆盖（铁律 48: 正常/降级/边界; 铁律 0-2: red→green）:
#   1. 首次安装: bundle 层落位（package.json + cordis.patch.yml）+ profile bundle 声明
#      **且不写 legacy** `.agent-presets/`（正常）
#   2. --check 安装后 → exit 0（正常）
#   3. 已安装 persona 被改 → --check exit 1 + 点名（边界）【T3/T3c 承重】
#   4. 未安装 → --check exit 1 "未安装"（边界）
#   5. bundle 源缺 cordis.patch.yml → exit 2 降级 + 无半成品（降级, D328: 不产出坏 bundle）
#   6. profile 不可写 → exit 2 降级（降级）
#   7. 重复安装幂等 → 两次 exit 0, 最终状态一致（正常）
#   8. 仓库 bundle 源可安装 + 声明行形态（生产接线, 非仅静态存在）
#
# D945 载体迁移（CTO 批准，2026-09-25）: 预设落位从 legacy `$DSH_HOME/.agent-presets/<id>/`
#   改为 profile **bundle 层** `$PROFILE_DIR/node_modules/@local/dsh-preset-<id>/` +
#   `package.json` 的 `dsh.profile.bundles[]` 声明。安装器 `--home`/`--standard-from`
#   已成 **DEPRECATED（调用即 exit 2）**，改走 `--profile-dir`/`--bundle-src` + `SYNO_*` 缝。
#   本夹具随之把 T1–T11 的载体假设从 legacy 目录换成 bundle 层（判据语义不变）。
#
# 隔离: mktemp 沙箱（fake profile + fake bundle 源 + fake legacy home）+ --profile-dir/
#   --bundle-src 注入, **完全不碰真实 ~/.dsh**（SYNO_LEGACY_HOME 亦指向沙箱）。
# 用法: bash tests/control-tower/install-dsh-preset.test.sh
# 退出码: 0 = 全部通过
#
# ── 跨平台审计（B3 返修 #3；结论写在此处备查，勿重复修）─────────────────────────
#   · `.gitattributes:24` 为 `*.sh text eol=lf` → 本文件在 Windows runner 上**也是 LF**
#      （实查 `git check-attr eol text` → eol: lf；`tr -cd '\r' | wc -c` → 0），
#      故"CRLF 导致 $ 锚不命中"的假设被证伪，**不需要 CRLF 分支**。
#    · 本文件内的 `$` 锚写法已清零：元变异改为 python3 字面量替换（无锚、无 sed -i 平台差异）；
#      其余 grep 全部是**子串匹配**（无 `^`/`$` 锚），行尾 CR 不影响命中。
#    · 仍存在的行首锚 `^# *synova-devdoc\|`（T11）与 `- id: persona` 首行断言：`^` 锚不受行尾 CR 影响。
#    · `sed -i` 已全部移除（T3b 旧判据替换改用 python3），避免 BSD/GNU `-i` 语法分歧与 stderr 噪音。
#    · 路径假设：`$_self_path` 绝对化 + `SYNO_IDP_REPO_DIR` 注入缝 → /tmp 副本可运行（否则 T11 两处伪失败）。
#    · 平台能力：POSIX 权限位（T6）在 Windows 不强制 → 显式 `T6-SKIP-PLATFORM` 跳过，不静默算通过。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
# ── D313 M5 UTF-8 强制（**B3 Windows 红态的根因修复**）─────────────────────────
#   夹具内嵌 python 会把含中文的 persona 块写进管道；Windows/Git Bash 下 python3 的
#   stdout 默认编码是 cp936/cp1252（非 UTF-8）→ `UnicodeEncodeError: 'charmap' codec …`
#   → 探针输出为空 → "面内计数 = 0"（而注入本身成功 → --check 仍报漂移）→
#   症状 = **T3 绿 + T3c 红**。本机复现命令（与 CI Windows 逐字同形）：
#     PYTHONIOENCODING=cp1252 bash tests/control-tower/install-dsh-preset.test.sh
#   产品脚本 install-dsh-preset.sh:27 一直有这一行；夹具此前漏了 → 只在 windows runner 暴露。
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

# BASH_SOURCE **绝对化**：主运行（`bash tests/...` 相对路径）与 /tmp 变异体（绝对路径）
# 两种语义都要稳 —— 用 cd+pwd 而非直接使用可能相对的 ${BASH_SOURCE[0]}（跨平台脆点，B3 返修 #2）。
_self_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$_self_path")" && pwd)"
# 仓库定位：注入缝优先（元变异体在 /tmp 运行 → 指回真仓库）；缺省回落 BASH_SOURCE/../..
REPO_DIR="${SYNO_IDP_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
INSTALL="$REPO_DIR/scripts/control-tower/install-dsh-preset.sh"
# D945: 仓库 bundle 源（文件驱动注册表：目录名 = 预设 id，package.json 声明 dsh.bundle.patch）
BUNDLE_SRC_REAL="$REPO_DIR/docs/synova/presets"
REAL_ID="synova-squad-lead"
# 注入标记（**拼接构造**：夹具源码内不出现该标记的字面量 →
#   仓库内 grep 该字面量命中 0；红证只存在于 /tmp 沙箱副本）
MARKER="INJECTED""-RED"
MARKER_LINE="      # ${MARKER} persona-drift-marker"

# T3c 期望值 —— **M4 变异点**（变异用 python3 定点替换该字面量 1→0；置 0 后 T3c 必须失败 = 防恒真）
# 跨平台注记（B3 返修 #1/#3）: 变异**不用 sed**（BSD/GNU `-i`、`$` 锚在不同 sed 上语义有差异）；
#   改用 python3 字面量替换 + "命中数 ≥ 1" 守卫 —— 未命中即 `MUTATION_NOT_APPLIED` 响亮失败，
#   绝不静默产出"未变异的变异体"（那会把守卫缺失误读成断言恒真，正是 Windows 侧红态的成因链）。
EXPECT_MARKERS=1

PASS=0
FAIL=0
SKIP=0
FAILED_IDS=""
pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; return 0; }
fail() { # 记录断言首 token（供 CI 截断日志时仍能点出失败集）
  FAIL=$((FAIL + 1))
  local tok="${1%% *}"; tok="${tok%:}"
  FAILED_IDS="${FAILED_IDS}${FAILED_IDS:+|}${tok}"
  echo "  ❌ $1" >&2
  return 0
}
skip() { # SKIP 也必须进公开摘要通道（CTO 卡内补件：不可见 = 隐性静默）；ASCII 前缀供证据步过滤
  SKIP=$((SKIP + 1))
  echo "  ⏭️  $1"
  printf 'D922-FIXTURE-SKIP: %s\n' "$1" | cut -c1-200
  return 0
}
assert_exit() { # <got> <want> <msg> ；返回 0/1（供状态聚合）
  if [ "$1" -eq "$2" ]; then pass "$3"; return 0; else fail "$3 (got exit=$1, want exit=$2)"; return 1; fi
}
assert_grep() { # <file> <pattern> <msg>
  if grep -q "$2" "$1" 2>/dev/null; then pass "$3"; return 0; else fail "$3 (grep 未命中: $2)"; return 1; fi
}
assert_eq_int() { # <got> <want> <msg>
  if [ "$1" -eq "$2" ]; then pass "$3"; return 0; else fail "$3 (got=$1, want=$2)"; return 1; fi
}

# ── T3/T3c 注入实现（**与文案无关**的结构锚）──────────────────────────────────
#   锚: `- id: persona` 起、下一条 `- id: ` 止（EOF 兜底）—— 与 install-dsh-preset.sh
#   extract_persona 同款边界规则；D926 重写文案后旧字面量判据失效，故本注入不依赖任何文案串。
#   $2 = inside（默认，块内＝判据面内）/ outside（块外，仅 M2 判别性用）
_inject_impl() {
  OUTSIDE="$2" MARKER_LINE="$MARKER_LINE" python3 - "$1" <<'PY'
import os
import sys
path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines()
start = next((i for i, l in enumerate(lines) if l.strip() == "- id: persona"), None)
if start is None:
    sys.exit(3)
end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("- id: ")), len(lines))
if os.environ.get("OUTSIDE") == "outside":
    at = min(end + 1, len(lines))      # 块外：越过终止 `- id: ` 行（EOF 则追加到文件尾）
else:
    at = start + 1                     # 块内：persona 块首行之后（= 判据面内）
lines.insert(at, os.environ["MARKER_LINE"])
open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
}
inject_persona_drift() { # <cordis-file> [inside|outside]
  local f="$1" where="${2:-inside}"
  _inject_impl "$f" "$where"        # M1-MUTATION-POINT（变异: 本行整行替换为 `return 0` ⇒ no-op）
}

# ── 判据面探针（**独立复刻**被测脚本的结构锚，不调用其内部函数）: 输出 persona 块 ──
#   二进制读 + 按实际行尾切分（行尾无关）；输出走 `sys.stdout.buffer`（**字节写**，
#   不受 stdout 编码设置影响 —— 与文件头 PYTHONIOENCODING 双保险，编码类平台差异免疫）。
extract_persona_probe() {
  python3 - "$1" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
nl = b"\r\n" if b"\r\n" in data else b"\n"
lines = data.split(nl)
start = next((i for i, l in enumerate(lines) if l.strip() == b"- id: persona"), None)
if start is None:
    sys.exit(3)
end = next((i for i in range(start + 1, len(lines)) if lines[i].lstrip().startswith(b"- id: ")), len(lines))
sys.stdout.buffer.write(b"\n".join(lines[start:end]) + b"\n")
PY
}

# ── 沙箱: fake profile（bundle 层根）+ fake 仓库 bundle 源 + fake legacy home ──
#   D945: 三处都在 mktemp 内 → 真实 ~/.dsh* 与真实 profiles/desktop/ 零读写。
TMP=$(mktemp -d /tmp/idp-preset.XXXXXX)
PROFILE_MOCK="$TMP/profile"
BUNDLE_MOCK="$TMP/bundle-src"
HOME_MOCK="$TMP/dsh-home"                 # legacy home（本脚本只读提示；绝不写）
DEG_LOG="$TMP/degraded.log"
mkdir -p "$PROFILE_MOCK/node_modules/@local" "$BUNDLE_MOCK" "$HOME_MOCK"
trap 'rm -rf "$TMP"' EXIT

# profile package.json —— bundle 选择器的声明面（dsh.profile.bundles）
cat > "$PROFILE_MOCK/package.json" << 'JSON'
{
  "name": "fake-profile",
  "private": true,
  "dsh": { "profile": { "bundles": [] } }
}
JSON

# 仓库 bundle 源（文件驱动注册表：目录名 = 预设 id；package.json 声明 dsh.bundle.patch）
MOCK_ID="synova-dsh"
mkdir -p "$BUNDLE_MOCK/$MOCK_ID"
cat > "$BUNDLE_MOCK/$MOCK_ID/package.json" << 'JSON'
{
  "name": "@local/dsh-preset-synova-dsh",
  "version": "0.0.0",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
JSON
# patch 须满足安装器落位前校验: 含 `- insert:` 与 `    - id: preset-<id>`，且无 `- id: delegation`
cat > "$BUNDLE_MOCK/$MOCK_ID/cordis.patch.yml" << 'YAML'
- insert:
    - id: preset-synova-dsh
      name: '@local/dsh-preset-synova-dsh'
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
YAML

RUN() { # 全部注入缝指向沙箱（含 SYNO_LEGACY_HOME）→ 不碰真实 ~/.dsh*
  SYNO_LEGACY_HOME="$HOME_MOCK" SYNO_PRESET_DEGRADED_LOG="$DEG_LOG" \
    bash "$INSTALL" --profile-dir "$PROFILE_MOCK" --bundle-src "$BUNDLE_MOCK" "$@"
}
INSTALLED="$PROFILE_MOCK/node_modules/@local/dsh-preset-$MOCK_ID"
PATCH_FILE="$INSTALLED/cordis.patch.yml"          # 判据面载体（原 legacy agent.cordis.yml）
SRC_PATCH="$BUNDLE_MOCK/$MOCK_ID/cordis.patch.yml"
PROFILE_PKG="$PROFILE_MOCK/package.json"

# ── 平台能力探针: POSIX 权限位是否被强制（决定 T6 是否可判定）──
PERM_PROBE="$TMP/perm-probe"
mkdir -p "$PERM_PROBE"
chmod 555 "$PERM_PROBE"
if (touch "$PERM_PROBE/x") 2>/dev/null; then POSIX_PERM_ENFORCED=0; else POSIX_PERM_ENFORCED=1; fi   # swallow-ok: 探测型（平台是否强制 POSIX 权限位）；成败由 if/else 两分支显式处理，非静默吞错
chmod 755 "$PERM_PROBE" 2>/dev/null || true
rm -rf "$PERM_PROBE"

# 便捷: 造一个带合法 dsh.profile.bundles 的 profile（缺省空声明）
make_profile() { # <dir>
  mkdir -p "$1/node_modules/@local"
  printf '{\n  "name": "sandbox-profile",\n  "private": true,\n  "dsh": { "profile": { "bundles": [] } }\n}\n' > "$1/package.json"
}

# ── T1: 首次安装（正常路径, bundle 层）──
OUT1=$(RUN --install 2>&1)
EXIT1=$?
assert_exit "$EXIT1" 0 "T1: --install exit 0"
[ -f "$INSTALLED/package.json" ] && pass "T1: package.json 已落位" || fail "T1: package.json 缺失"
[ -f "$INSTALLED/cordis.patch.yml" ] && pass "T1: cordis.patch.yml 已落位" || fail "T1: cordis.patch.yml 缺失"
assert_grep "$PROFILE_PKG" "@local/dsh-preset-$MOCK_ID" "T1: bundle 声明已写入 profile package.json"
cmp -s "$INSTALLED/cordis.patch.yml" "$SRC_PATCH" && pass "T1: patch 与仓库源逐字节一致" || fail "T1: patch 与仓库源不一致"
[ ! -e "$HOME_MOCK/.agent-presets" ] && pass "T1: 未写 legacy .agent-presets/（D945 退役生效）" || fail "T1: 仍写 legacy（退役未生效）"

# ── T11: devdoc 预设退役语义（D922 创始人批准 B 案；D945 改写为 bundle 载体）──
# 三件: ① 默认集**不再**落位 devdoc ② 退役在注册表以注释留痕（可逆）
#       ③ 能力已技能化保留；④ **显式请求退役 id → exit 1 + RETIRED**（新载体上的退役承重面）
DEVDOC_INSTALLED="$PROFILE_MOCK/node_modules/@local/dsh-preset-synova-devdoc"
[ ! -e "$DEVDOC_INSTALLED" ] && pass "T11: devdoc 默认不再落位（退役生效）" || fail "T11: devdoc 仍被落位（退役未生效）"
grep -qE '^# *synova-devdoc\|' "$INSTALL" \
  && pass "T11: 退役在注册表留痕（注释行，可逆）" || fail "T11: 退役无留痕（不可逆）"
RP="$REPO_DIR"; [ -f "$RP/.claude/skills/dev-doc-spec/SKILL.md" ] && [ -f "$RP/.dsh/skills/dev-doc-spec/SKILL.md" ] \
  && pass "T11: 能力技能化保留（dev-doc-spec 双写齐备）" || fail "T11: 能力未保留（skill 缺失）"
OUT11R=$(RUN --check synova-devdoc 2>&1)
EXIT11R=$?
assert_exit "$EXIT11R" 1 "T11: 显式请求已退役 id → exit 1"
echo "$OUT11R" | grep -q "RETIRED" && pass "T11: 输出点名 RETIRED（退役语义可见）" || fail "T11: 未点名 RETIRED"

# ── T2: --check 安装后 → exit 0（正常）──
OUT2=$(RUN --check 2>&1)
EXIT2=$?
assert_exit "$EXIT2" 0 "T2: --check 一致 exit 0"
echo "$OUT2" | grep -qi "SYNC-OK" && pass "T2: 输出含 SYNC-OK" || fail "T2: 无 SYNC-OK 标记"

# ── T3（**承重 / LOAD-BEARING**）: persona 漂移 → --check exit 1 + 点名 ──
#   注入 = 结构锚（块内插标记行），与文案无关；D926 重写后仍成立。
#   T3-STATUS 行是 **ASCII** 状态令牌，供元变异体用（不 grep emoji/中文，避免 locale/编码差异）。
#   **面内前提耦合（B3 返工）**: 标记必须先落在判据面内（与 T3c 同源计数），否则 T3 的绿
#   可能来自"整文件 EOL 变化/空行"等**非目标原因** → 此时 T3 不得记 PASS。
T3_STATUS=PASS
inject_persona_drift "$PATCH_FILE"
T3_INJECT_RC=$?
MARKERS=$(extract_persona_probe "$PATCH_FILE" | tr -d '\r' | grep -c -- "$MARKER" || true)
OUT3=$(RUN --check 2>&1)
EXIT3=$?
assert_exit "$EXIT3" 1 "T3(承重): 结构锚注入 persona 漂移 → --check exit 1" || T3_STATUS=FAIL
echo "$OUT3" | grep -q "cordis.patch.yml" && pass "T3(承重): 输出点名 cordis.patch.yml" || { T3_STATUS=FAIL; fail "T3(承重): 未点名漂移文件"; }
echo "$OUT3" | grep -q "内容不一致" \
  && pass "T3(承重): 漂移原因是内容不一致（非 EOL/结构类假漂移）" \
  || { T3_STATUS=FAIL; fail "T3(承重): 漂移原因不是内容不一致（检查输出无该原因，疑为 EOL/结构类假漂移）"; }
if [ "$MARKERS" -ge 1 ]; then
  pass "T3(承重): 面内前提成立（判据面内 ${MARKER} 计数=${MARKERS} ≥ 1）"
else
  T3_STATUS=FAIL
  fail "T3(承重): 面内前提不成立（判据面内 ${MARKER} 计数=${MARKERS}）——本次 check_rc=${EXIT3} 的绿不作为通过依据"
fi
printf 'T3-STATUS: %s\n' "$T3_STATUS"
echo "T3 LOAD-BEARING: inject=structural(块内) inject_rc=${T3_INJECT_RC} check_rc=${EXIT3} 面内计数=${MARKERS} 点名=$(printf '%s\n' "$OUT3" | grep -c 'cordis.patch.yml' || true) status=${T3_STATUS}"

# ── T3c（**承重 / LOAD-BEARING**）: 落点证明 —— 标记必须落在判据面（persona 块）内 ──
#   失败时输出 **四段自证 dump**（ASCII 前缀 `T3C-DUMP-n:`，供 CI 注解公开检索）：
#   ① python 版本/路径 ② 安装产物前 20 行 ③ 判据面原始输出前 20 行 ④ 标记行所在位置的 od -c 前 32 字节。
#   目的：Windows 侧 job log 匿名取不回（API 403）时，让失败自己把平台形态带到注解里。
T3C_STATUS=PASS
assert_eq_int "$MARKERS" "$EXPECT_MARKERS" "T3c(承重): 判据面内 ${MARKER} 计数 == ${EXPECT_MARKERS}" || T3C_STATUS=FAIL
if [ "$T3C_STATUS" = "FAIL" ]; then
  # 每项 ≤5 行 / 每行 ≤200 字节（适配注解配额；完整版另落 step summary）
  echo "T3C-DUMP-1: python3=$(command -v python3 2>/dev/null || echo MISSING) version=$(python3 -V 2>&1 | cut -c1-120)"
  echo "T3C-DUMP-2: installed head -5 ↓"
  head -5 "$PATCH_FILE" 2>/dev/null | cut -c1-200 | sed 's/^/T3C-DUMP-2: /'   # swallow-ok: 诊断转储（文件缺失则该段留空，dump 仍输出；不影响任何判据）
  echo "T3C-DUMP-3: extract_persona_probe head -5 ↓"
  extract_persona_probe "$PATCH_FILE" 2>&1 | head -5 | cut -c1-200 | sed 's/^/T3C-DUMP-3: /'
  echo "T3C-DUMP-4: 标记行 od -c（前 32 字节）↓"
  grep -a -m1 -- "$MARKER" "$PATCH_FILE" 2>/dev/null | od -c 2>/dev/null | head -2 | cut -c1-200 | sed 's/^/T3C-DUMP-4: /'   # swallow-ok: 诊断转储（探测型 grep：无命中=标记不在文件里，下一行显式打印命中数；非静默吞错）
  echo "T3C-DUMP-4: 文件内标记命中=$(grep -a -c -- "$MARKER" "$PATCH_FILE" 2>/dev/null || echo 0)（0 = 标记根本没写进文件）"
fi
printf 'T3c-STATUS: %s\n' "$T3C_STATUS"
echo "T3c LOAD-BEARING: extract_persona 面内 ${MARKER}=${MARKERS}（期望 ${EXPECT_MARKERS}）→ 注入落在判据面内 status=${T3C_STATUS}"

# ── M2（判别性元变异）: 注入插到**块外** → T3c 面内计数必须为 0（证明 T3c 对落点敏感）──
RUN --install >/dev/null 2>&1
inject_persona_drift "$PATCH_FILE" outside
M2_MARKERS=$(extract_persona_probe "$PATCH_FILE" | tr -d '\r' | grep -c -- "$MARKER" || true)
if [ "$M2_MARKERS" -eq 0 ]; then
  pass "M2 判别性: 块外注入 → 判据面内计数 0（T3c 依赖真实落点，非恒真）"
else
  fail "M2 判别性失败: 块外注入竟被计入判据面内（got=${M2_MARKERS}）"
fi

# ── T3b（**NEGATIVE-CONTROL / 负控，非承重**）: 旧判据（文案字面量）已死 ──
#   旧 T3 用 `s/DeepSeek Harness 编码代理/被篡改的代理/`；D926 重写后该字面量在 persona-block.yml
#   命中 0 → sed 空转 → --check 仍 exit 0。**本断言不是主判据**，只证明"旧判据失效"；
#   承重 = T3（漂移被抓）+ T3c（落点在判据面内）。
RUN --install >/dev/null 2>&1
OLD_LITERAL_HITS=$(grep -c 'DeepSeek Harness 编码代理' "$PATCH_FILE" || true)
# 旧判据的字面量替换用 python3 落地（语义与旧 `sed -i 's/…/…/'` 等价；避开 BSD/GNU `-i` 语法分歧
#   与失败分支的 stderr 噪音）。本断言要证明的只是"该字面量已不存在 → 替换空转 → 旧判据已死"。
OLD_LITERAL='DeepSeek Harness 编码代理' NEW_LITERAL='被篡改的代理' TARGET="$PATCH_FILE" python3 - <<'PY'
import os
p = os.environ["TARGET"]
s = open(p, encoding="utf-8").read()
open(p, "w", encoding="utf-8", newline="\n").write(s.replace(os.environ["OLD_LITERAL"], os.environ["NEW_LITERAL"]))
PY
OUT3B=$(RUN --check 2>&1)
EXIT3B=$?
assert_exit "$EXIT3B" 0 "T3b(NEGATIVE-CONTROL): 旧字面量替换空转 → --check exit 0（旧判据已死）"
echo "T3b NEGATIVE-CONTROL: 旧字面量现存命中=${OLD_LITERAL_HITS}；sed 后 --check rc=${EXIT3B}（非承重，仅证明旧判据失效）"
RUN --install >/dev/null 2>&1    # 复原，供后续 T7 幂等断言

# ── T4: 未安装 → --check exit 1（边界）──
FRESH_HOME="$TMP/fresh-home"
make_profile "$FRESH_HOME"
OUT4=$(SYNO_LEGACY_HOME="$HOME_MOCK" SYNO_PRESET_DEGRADED_LOG="$DEG_LOG" \
  bash "$INSTALL" --profile-dir "$FRESH_HOME" --bundle-src "$BUNDLE_MOCK" --check 2>&1)
EXIT4=$?
assert_exit "$EXIT4" 1 "T4: 未安装 --check exit 1"
echo "$OUT4" | grep -q "未安装" && pass "T4: 输出含'未安装'提示" || fail "T4: 无未安装提示"

# ── T5: bundle 源缺 cordis.patch.yml → exit 2 降级（降级, D328 三态: 不产出坏 bundle）──
#   D945 形态变更: 原「standard 源无 persona 行」判据随 legacy 载体一并消失；
#   等价承重面 = 落位前校验拒绝缺件/坏件（stage_bundle fail-closed）。
BAD_SRC="$TMP/bad-bundle-src"
mkdir -p "$BAD_SRC/synova-bad"
cp "$BUNDLE_MOCK/$MOCK_ID/package.json" "$BAD_SRC/synova-bad/package.json"   # 只给 package.json，故意不给 patch
BAD_PROFILE="$TMP/bad-profile"
make_profile "$BAD_PROFILE"
OUT5=$(SYNO_LEGACY_HOME="$HOME_MOCK" SYNO_PRESET_DEGRADED_LOG="$DEG_LOG" \
  bash "$INSTALL" --profile-dir "$BAD_PROFILE" --bundle-src "$BAD_SRC" --install 2>&1)
EXIT5=$?
assert_exit "$EXIT5" 2 "T5: bundle 源缺 patch → exit 2 (不产出坏 bundle)"
echo "$OUT5" | grep -qi "degraded" && pass "T5: 降级有显式日志" || fail "T5: 降级无日志"
[ ! -e "$BAD_PROFILE/node_modules/@local/dsh-preset-synova-bad" ] && pass "T5: 无半成品残留" || fail "T5: 半成品残留"

# ── T6: profile 不可写 → exit 2 降级（降级；**POSIX 权限语义平台相关**）──
#   平台能力探针: Windows/Git Bash 不强制 chmod 555（无 POSIX 权限位语义）→ 该断言不可判定，
#   显式 SKIP 并写明原因（不静默当通过）；POSIX（macOS 本地 / ubuntu CI）仍为硬断言。
if [ "$POSIX_PERM_ENFORCED" = "1" ]; then
  RO_HOME="$TMP/ro-home"
  make_profile "$RO_HOME"
  # 落位真正写入的是 bundle 层 `node_modules/@local/`（staging 在此 mkdir）——
  # 只 chmod 父目录 555 挡不住嵌套子目录写入（父目录只挡其直接子项的增删），故三层一并只读。
  chmod 555 "$RO_HOME/node_modules/@local" "$RO_HOME/node_modules" "$RO_HOME"
  OUT6=$(SYNO_LEGACY_HOME="$HOME_MOCK" SYNO_PRESET_DEGRADED_LOG="$DEG_LOG" \
    bash "$INSTALL" --profile-dir "$RO_HOME" --bundle-src "$BUNDLE_MOCK" --install 2>&1)
  EXIT6=$?
  chmod -R u+w "$RO_HOME" 2>/dev/null || true   # swallow-ok: 复原权限供 trap 清理；失败不改变 T6 判据（断言已取到 EXIT6）
  assert_exit "$EXIT6" 2 "T6: profile 不可写 exit 2"
else
  skip "T6-SKIP-PLATFORM(no-posix-perm): 平台不强制 chmod 555 → profile 不可写路径不可判定（Windows Git Bash）；POSIX/ubuntu 侧仍是硬断言"
fi

# ── T9: SYNO_* 注入缝路径（等价于旧「DSH_INSTALL_DIR 环境探测」；不注入 CLI 参数）──
#   D945: legacy 的 standard 源探测链（DSH_INSTALL_DIR / npm root -g / nvm）已随载体删除；
#   替代承重面 = 仓库 bundle 源经 env 缝解析（与 --bundle-src 同语义，二者不可同时缺失）。
PROF9="$TMP/home9-profile"
make_profile "$PROF9"
OUT9=$(SYNO_PRESET_REPO_DIR="$BUNDLE_MOCK" SYNO_PROFILE_DIR="$PROF9" \
  SYNO_LEGACY_HOME="$HOME_MOCK" SYNO_PRESET_DEGRADED_LOG="$DEG_LOG" bash "$INSTALL" --install 2>&1)
EXIT9=$?
assert_exit "$EXIT9" 0 "T9: SYNO_* 注入缝（bundle 源 + profile）→ --install exit 0"
[ -f "$PROF9/node_modules/@local/dsh-preset-$MOCK_ID/cordis.patch.yml" ] \
  && pass "T9: 注入缝路径产出 bundle" || fail "T9: 注入缝路径无产出"

# ── T10: bundle 源不可达 → exit 2 降级（D328: 不产出半成品）──
#   受限 PATH（windows-compat 模式 2）保证无外部命令可救场；源目录不存在 → fail-closed。
PROF10="$TMP/home10-profile"
make_profile "$PROF10"
OUT10=$(env PATH="/usr/bin:/bin" SYNO_PRESET_REPO_DIR="$TMP/不存在" SYNO_PROFILE_DIR="$PROF10" \
  SYNO_LEGACY_HOME="$HOME_MOCK" SYNO_PRESET_DEGRADED_LOG="$DEG_LOG" bash "$INSTALL" --install 2>&1)
EXIT10=$?
assert_exit "$EXIT10" 2 "T10: bundle 源不可达 exit 2"
[ ! -e "$PROF10/node_modules/@local/dsh-preset-$MOCK_ID" ] && pass "T10: 无半成品残留" || fail "T10: 半成品残留"

# ── T7: 重复安装幂等（正常）──
OUT7=$(RUN --install 2>&1)
EXIT7=$?
assert_exit "$EXIT7" 0 "T7: 二次 --install exit 0"
OUT7C=$(RUN --check 2>&1)
assert_exit "$?" 0 "T7: 二次安装后 --check 仍 exit 0"

# ── T8: 仓库 bundle 源生产接线（D945: legacy `dsh-preset-draft/persona-block.yml` → bundle 声明行）──
#   静态面（形态）: package.json 声明 dsh.bundle.patch + patch 含 insert/preset 声明行 + D931 硬判据。
#   **执行面（判别性）**: 真实仓库 bundle 源必须**可被安装器落位**——删掉/改坏源即报红，
#   杜绝"grep 型静态判据冒充接线验收"。
T8_SRC="$BUNDLE_SRC_REAL/$REAL_ID"
if [ -f "$T8_SRC/package.json" ] && [ -f "$T8_SRC/cordis.patch.yml" ]; then
  pass "T8: 仓库 bundle 源齐备（package.json + cordis.patch.yml）"
else
  fail "T8: 仓库 bundle 源缺失（期望 $T8_SRC/{package.json,cordis.patch.yml}）"
fi
assert_grep "$T8_SRC/package.json" '"bundle"' "T8: package.json 含 dsh.bundle 声明块"
assert_grep "$T8_SRC/package.json" '"patch"' "T8: package.json 含 dsh.bundle.patch 声明行（文件驱动注册表锚）"
assert_grep "$T8_SRC/cordis.patch.yml" "^- insert:" "T8: patch 含 - insert: 声明行形态"
assert_grep "$T8_SRC/cordis.patch.yml" "    - id: preset-$REAL_ID" "T8: patch 含 preset 声明行"
AT8=$(grep -c "agent-team" "$T8_SRC/cordis.patch.yml" || true)
[ "$AT8" -ge 1 ] && pass "T8: patch 含 agent-team（${AT8} 处, D931 要求 ≥1）" || fail "T8: patch 缺 agent-team"
DL8=$(grep -c "id: delegation" "$T8_SRC/cordis.patch.yml" || true)
[ "$DL8" -eq 0 ] && pass "T8: patch 无 legacy delegation 行（D931 要求 =0）" || fail "T8: patch 含 legacy delegation 行（got=${DL8}）"
T8_PROF="$TMP/t8-profile"
make_profile "$T8_PROF"
OUT8=$(SYNO_PRESET_REPO_DIR="$BUNDLE_SRC_REAL" SYNO_PROFILE_DIR="$T8_PROF" \
  SYNO_LEGACY_HOME="$HOME_MOCK" SYNO_PRESET_DEGRADED_LOG="$DEG_LOG" \
  bash "$INSTALL" --install "$REAL_ID" 2>&1)
EXIT8=$?
assert_exit "$EXIT8" 0 "T8: 仓库 bundle 源可安装（生产接线被执行，非仅静态存在）"
[ -f "$T8_PROF/node_modules/@local/dsh-preset-$REAL_ID/cordis.patch.yml" ] \
  && [ -f "$T8_PROF/node_modules/@local/dsh-preset-$REAL_ID/package.json" ] \
  && pass "T8: 真实 bundle 源落位产物齐备" || fail "T8: 真实 bundle 源落位产物缺失"

# ── M1/M4 判别性元变异（变异体在 /tmp 副本运行；红证只落 /tmp，不入仓库）──
#   M1: 注入器置 no-op → 变异体的 T3 必须红（证明 T3 依赖真实注入，不是恒真）。
#   M4: 期望值 EXPECT_MARKERS 1→0 → 变异体的 T3c 必须失败（证明断言与期望值绑定，防恒真）。
#   机制（B3 返修 #1/#2/#4）:
#     · 变异 = python3 **字面量定点替换**（不用 sed：BSD/GNU `-i`/`$` 锚语义有平台差异）；
#     · 守卫 1: 替换命中数 ≥ 1，否则 `MUTATION_NOT_APPLIED` 响亮失败（禁止静默产出未变异体）；
#     · 守卫 2: 变异体生成物必须含新文本；
#     · 守卫 3: 变异体必须产出 `D922-FIXTURE:` 汇总行，否则 `MUTANT_RUN_FAILED`（防"变异体没跑起来"被误读）；
#     · 判据读 **ASCII 状态令牌**（`T3-STATUS:` / `T3c-STATUS:`），不 grep emoji/中文（locale/编码无关）；
#     · 源路径用 `$_self_path`（绝对化），主运行相对调用与 /tmp 变异体两种语义都稳。
if [ "${SYNO_IDP_NO_META:-0}" = "1" ]; then
  echo "  (元变异副本: 跳过 M1/M4 元断言 —— 防递归)"
else
  META_ASSERTIONS=0
  # 锚用「前后带换行」的整行形态 → 命中数恰为 1（避免把调用处的同名字面量也替换掉）
  M1_OLD_ANCHOR=$'\n  _inject_impl "$f" "$where"'
  M1_NEW_ANCHOR=$'\n  return 0'
  M4_OLD_ANCHOR=$'\nEXPECT_MARKERS=1\n'
  M4_NEW_ANCHOR=$'\nEXPECT_MARKERS=0\n'
  make_mutant() { # $1=tag $2=旧文本 $3=新文本 → stdout=变异体路径；未命中即 fail 且 return 1
    local tag="$1"
    local hits=""
    local out="$TMP/fixture-mutant-${tag}.sh"      # 注意: 不在同一 local 语句里引用刚赋值的变量（bash 3.2 下会 unbound）
    hits="$(SRC="$_self_path" DST="$out" OLD="$2" NEW="$3" python3 - <<'PY' 2>"$TMP/mut-${tag}.err"
import os
import sys
src = os.environ["SRC"]; dst = os.environ["DST"]
old = os.environ["OLD"]; new = os.environ["NEW"]
text = open(src, encoding="utf-8").read()
n = text.count(old)
if n < 1:
    sys.stderr.write("命中 0 次\n")
    sys.exit(3)
open(dst, "w", encoding="utf-8", newline="\n").write(text.replace(old, new))
print(n)
PY
)"
    if [ $? -ne 0 ] || [ -z "$hits" ]; then
      fail "MUTATION_NOT_APPLIED: ${tag}（python 定点替换命中 0 次——锚文本与实际文件不匹配，变异未生效；判据不可信）"
      return 1
    fi
    grep -q -F -- "$3" "$out" || { fail "MUTATION_NOT_APPLIED: ${tag}（生成物未含新文本）"; return 1; }
    printf '%s\n' "$out"
  }
  run_mutant() { # $1=变异体路径 → 输出（stdout+stderr）；注入缝指回真仓库
    SYNO_IDP_REPO_DIR="$REPO_DIR" SYNO_IDP_NO_META=1 bash "$1" 2>&1
  }
  M1_MUT="$(make_mutant 'M1' "$M1_OLD_ANCHOR" "$M1_NEW_ANCHOR")"
  if [ -n "$M1_MUT" ]; then
    M1_OUT="$(run_mutant "$M1_MUT")"
    printf '%s\n' "$M1_OUT" | grep -q '^D922-FIXTURE:' \
      || fail "MUTANT_RUN_FAILED: M1（变异体未产出汇总行）"
    if printf '%s\n' "$M1_OUT" | grep -q '^T3-STATUS: FAIL'; then
      pass "M1 判别性: 注入器置 no-op → 变异体 T3 必红（T3 依赖真注入）"
    else
      fail "M1 判别性失败: 注入器 no-op 后 T3 仍绿（T3 未依赖注入）"
    fi
    META_ASSERTIONS=$((META_ASSERTIONS + 1))
  else
    fail "MUTANT_BUILD_FAILED: M1（变异体路径为空 —— 见上方 MUTATION_NOT_APPLIED 明细）"
  fi
  M4_MUT="$(make_mutant 'M4' "$M4_OLD_ANCHOR" "$M4_NEW_ANCHOR")"
  if [ -n "$M4_MUT" ]; then
    M4_OUT="$(run_mutant "$M4_MUT")"
    printf '%s\n' "$M4_OUT" | grep -q '^D922-FIXTURE:' \
      || fail "MUTANT_RUN_FAILED: M4（变异体未产出汇总行）"
    if printf '%s\n' "$M4_OUT" | grep -q '^T3c-STATUS: FAIL'; then
      pass "M4 判别性: 期望值改 0 → 变异体 T3c 必失败（断言与期望绑定，防恒真）"
    else
      fail "M4 判别性失败: 期望值改 0 后 T3c 仍绿（断言可能恒真）"
    fi
    META_ASSERTIONS=$((META_ASSERTIONS + 1))
  else
    fail "MUTANT_BUILD_FAILED: M4（变异体路径为空 —— 见上方 MUTATION_NOT_APPLIED 明细）"
  fi
  # 元变异自检: 两条元断言必须真的跑过（防"元段静默空转 → 全绿"这一整类假绿）
  [ "$META_ASSERTIONS" -eq 2 ] \
    || fail "META_SECTION_INCOMPLETE: 只跑了 ${META_ASSERTIONS}/2 条元断言（元段自身可能静默失败）"
fi

# ── 汇总 ──
if [ "$FAIL" -eq 0 ]; then FINAL_EXIT=0; else FINAL_EXIT=1; fi
echo "T3 LOAD-BEARING: T3+T3c 为承重判据；T3b 为 NEGATIVE-CONTROL（非承重）"
echo "=== 结果: PASS=$PASS FAIL=$FAIL SKIP=$SKIP exit=$FINAL_EXIT ==="
# FAILED_IDS 让 CI 截断日志（tail -8 / 450 字符）也能一次点出失败集，不必再靠拉全量日志
echo "D922-FIXTURE: preset=install-dsh-preset T3/T3c=承重 T3b=负控 PASS=$PASS FAIL=$FAIL SKIP=$SKIP exit=$FINAL_EXIT FAILED_IDS=[${FAILED_IDS}]"
echo ""
echo "═══════════════════════════════════════"
echo "  PASS=$PASS  FAIL=$FAIL  SKIP=$SKIP"
echo "═══════════════════════════════════════"
[ "$FAIL" -eq 0 ]
