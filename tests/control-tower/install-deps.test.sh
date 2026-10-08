#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# install-deps.test.sh — W12/D1167 判别夹具（含**反例**）
#
# 被测物: scripts/control-tower/install-deps.sh（依赖安装「默认拒 + 白名单放行」）
# 治的病: 安装期生命周期脚本 = 任意代码执行；npm 无 per-package 白名单字段
#   ⇒ 本器自建等价语义：`npm ci --ignore-scripts`（默认拒）+ 仅白名单包
#     `npm rebuild --foreground-scripts`（显式放行）。
#
# 契据（铁律 47）
#   @input  env GATE 被测脚本路径（默认 scripts/control-tower/install-deps.sh）
#   @output 逐条 `PASS/FAIL` + 末行 `RESULT: <n> PASS / <m> FAIL`
#   @exit   0 = 全 PASS；1 = 有 FAIL；2 = 调用错误（被测脚本缺失）
#
# 判别性（V-08「改坏即红」）:
#   本夹具**不跑真 npm**（太慢），而是在 PATH 前置一个 **npm 桩**记录调用序列，
#   然后断言**决策**：
#     · 默认拒: 第一步必须是 `ci` 且**带 --ignore-scripts**
#     · 白名单内: 恰好收到一次 `rebuild <pkg> --foreground-scripts`
#     · 🔴 反例: node_modules 里**存在但未列入白名单**的包（本例 `evil-pkg`）
#         ⇒ **一次 rebuild 都不能有**（这就是"未列入白名单 ⇒ 装不上"的机器判据）
#     · 幂等/边界: 白名单里的包**不存在于 node_modules** ⇒ 跳过且不报错（exit 0）
#     · 三态: 白名单缺失 / 为空 ⇒ exit **2**（fail-closed，2 ≠ 通过）
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

GATE="${GATE:-scripts/control-tower/install-deps.sh}"
[ -f "$GATE" ] || { echo "ERROR: 被测脚本不存在: $GATE" >&2; exit 2; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
PASS_N=0; FAIL_N=0
ok() { echo "  ✅ $1"; PASS_N=$((PASS_N+1)); }
no() { echo "  ❌ $1"; FAIL_N=$((FAIL_N+1)); }
chk() { if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else no "$1 expect=$2 got=$3"; fi; }

echo "=== W12 install-deps 判别夹具 ==="
echo "被测: $GATE"; echo

# ── npm 桩：把每次调用逐行记进 $NPM_LOG，并按子命令返回可控结果 ──────────────────
mkdir -p "$TMPD/bin"
cat > "$TMPD/bin/npm" <<'EOS'
#!/usr/bin/env bash
echo "npm $*" >> "${NPM_LOG:?}"
case "$1" in
  ci)      exit 0 ;;
  rebuild) exit 0 ;;
  *)       exit 0 ;;
esac
EOS
cat > "$TMPD/bin/npx" <<'EOS'
#!/usr/bin/env bash
echo "npx $*" >> "${NPM_LOG:?}"
exit 0
EOS
chmod +x "$TMPD/bin/npm" "$TMPD/bin/npx"

# 沙箱工程：node_modules 里放"被允许的包"与"未列入白名单的包"
mk_sandbox() { # <dir> [--no-allow-wl]
  local d="$1"
  rm -rf "$d"; mkdir -p "$d/node_modules/allowed-a" "$d/node_modules/allowed-b" "$d/node_modules/evil-pkg" "$d/patches"
  echo "// patch" > "$d/patches/x.patch"
  # 🔴 D1172 复核整改（B2）: 沙箱包必须是**真包**（含 package.json + postinstall），否则
  #   "含安装脚本的包"在沙箱里是**空集** ⇒ 负对照（未列白名单的包零 rebuild）会**空过**。
  for pk in allowed-a allowed-b evil-pkg; do
    printf '{"name":"%s","version":"1.0.0","private":true,"scripts":{"postinstall":"node -e \"0\""}}\n' "$pk" > "$d/node_modules/$pk/package.json"
  done
  printf 'allowed-a\nallowed-b\n<ROOT>\n' > "$d/wl.txt"
}

run_gate() { # run_gate <sandbox> <allowlist> → 设 RC / 输出入 $TMPD/out
  NPM_LOG="$TMPD/npm.log"; : > "$NPM_LOG"; export NPM_LOG
  ( cd "$1" && PATH="$TMPD/bin:$PATH" bash "$OLDPWD/$GATE" --prefix . --allowlist "$2" ) > "$TMPD/out" 2>&1
  RC=$?
}

# ── ① 正例：默认拒 + 白名单放行，未列入白名单的包**一次都不跑** ─────────────────
mk_sandbox "$TMPD/sb1"
run_gate "$TMPD/sb1" "$TMPD/sb1/wl.txt"
chk "① exit=0" "0" "$RC"
# 🔴 D1175: 原用**子串**匹配 `grep -q -- "--ignore-scripts"` ⇒ `--ignore-scripts=false` 照样命中
if head -1 "$TMPD/npm.log" | grep -qE '^npm ci --ignore-scripts( |$)'; then ok "① 第一步是默认拒（ci --ignore-scripts，整行匹配）"; else no "① 第一步不是默认拒: $(head -1 "$TMPD/npm.log")"; fi
chk "① 第一步不得带 --ignore-scripts=false（= 默认拒被关掉）" "0" "$(head -1 "$TMPD/npm.log" | grep -c -- '--ignore-scripts=false' || true)"
chk "① allowed-a 被重建" "1" "$(grep -c '^npm rebuild allowed-a --foreground-scripts' "$TMPD/npm.log")"
chk "① allowed-b 被重建" "1" "$(grep -c '^npm rebuild allowed-b --foreground-scripts' "$TMPD/npm.log")"
# 🔴 反例核心断言：未列入白名单的包（存在！）一次 rebuild 都不能有
chk "① 🔴 未列入白名单的 evil-pkg 零 rebuild" "0" "$(grep -c 'evil-pkg' "$TMPD/npm.log")"
# 🔴 D1173 复核整改（B2 **根修**）: 上一版补的两条是**按拼写**匹配
#   （`^npm rebuild( --foreground-scripts)?$` / `^npm rebuild `），**不是**按"这次调用会不会跑脚本"。
#   独立复核用两条新突变击穿它，而夹具仍 19/0：
#     · M7 `npm i --no-save node-gyp@12`（= 本 PR 自己在 S5 登记的"默认拒绕过路径"形态）
#     · M8 `npm --prefix . rebuild --foreground-scripts`（语义与 M5 的裸全量重建**相同**，只换拼写）
#   ⇒ 教训：**枚举黑名单拼写永远有下一个变体**。改为**白名单式**——把 stub 记下的
#     **整条 npm 调用序列**与期望集合比对：**任何一行不在白名单里 ⇒ 红**。
#     这一条同时杀掉 M5（裸 rebuild）/ M7（npm i）/ M8（--prefix 前置）以及未来的变体。
# 🔴 D1175 复核整改（B2，第三次复核判阻塞）: 上一版**只有 `^` 没有 `$`** ⇒ 那是**前缀匹配**，
#   不是白名单。复核构造的两条突变让**默认拒真失效而夹具仍 19/0**：
#     · M9  `npm ci --ignore-scripts` → `npm ci --ignore-scripts=false`
#     · M12 `npm ci --ignore-scripts --ignore-scripts=false`
#   复核用真 npm 10.9.8 + 本地 file: 包（postinstall 写 marker）实证：
#     `--ignore-scripts` ⇒ marker=not-run；`--ignore-scripts=false` ⇒ **marker=RAN**（exit 0）
#   ⇒ 加 `$` 锚，并把每条写成**完整行**（含全部 flag）。
#   ⚠️ 代价（写清楚）: 从此合法地改一个 flag 就会误红 —— 那正是「有意同步期望值」的要求，
#      不是缺陷；但不要把它当「拼写枚举」来增补：改 flag 必须**同时**改这里。
EXPECTED_NPM='^npm ci --ignore-scripts --no-audit --no-fund$|^npm rebuild (allowed-a|allowed-b) --foreground-scripts --no-audit --no-fund$|^npx --no-install patch-package$'
UNEXPECTED="$(grep -vE "$EXPECTED_NPM" "$TMPD/npm.log" || true)"
chk "① 🔴 白名单外的 npm 调用数 = 0（M5/M7/M8 皆命中此条）" "0" "$(printf '%s' "$UNEXPECTED" | grep -c . || true)"
chk "① npm rebuild 调用次数 == 白名单内已装包数（多一次即越权）" "2" "$(grep -c '^npm rebuild ' "$TMPD/npm.log")"
chk "① 根 postinstall(patch-package) 被执行" "1" "$(grep -c 'patch-package' "$TMPD/npm.log")"

# ── ② 反例对照：把 evil-pkg 写进白名单 ⇒ 它**必须**被重建 ───────────────────────
mk_sandbox "$TMPD/sb2"; printf 'allowed-a\nallowed-b\nevil-pkg\n<ROOT>\n' > "$TMPD/sb2/wl.txt"
run_gate "$TMPD/sb2" "$TMPD/sb2/wl.txt"
chk "② 反例对照 evil-pkg 被重建=1（证明①的断言有判别力）" "1" "$(grep -c '^npm rebuild evil-pkg --foreground-scripts' "$TMPD/npm.log")"

# ── ③ 边界：白名单里的包不存在于 node_modules ⇒ 跳过且仍 exit 0 ─────────────────
mk_sandbox "$TMPD/sb3"; printf 'allowed-a\nnot-installed-pkg\n<ROOT>\n' > "$TMPD/sb3/wl.txt"
run_gate "$TMPD/sb3" "$TMPD/sb3/wl.txt"
chk "③ 缺包不报错 exit=0" "0" "$RC"
chk "③ 缺包被跳过（零 rebuild）" "0" "$(grep -c 'not-installed-pkg' "$TMPD/npm.log")"

# ── ④ 三态：白名单缺失 / 空白名单 ⇒ 2（fail-closed，2 ≠ 通过）───────────────────
mk_sandbox "$TMPD/sb4"; run_gate "$TMPD/sb4" "$TMPD/sb4/nope.txt"
chk "④ 白名单缺失 exit=2" "2" "$RC"
printf '# 只有注释\n' > "$TMPD/empty.txt"; run_gate "$TMPD/sb4" "$TMPD/empty.txt"
chk "④ 空白名单 exit=2" "2" "$RC"
grep -q "DEGRADED" "$TMPD/out" && ok "④ 降级末行显式 DEGRADED" || no "④ 降级末行未标 DEGRADED"

# ── ⑤ 接线: ci.yml 里不得再有**裸** `npm ci`（默认拒必须走安装器）──────────────
CIY=".github/workflows/ci.yml"
# 🔴 D1172 复核整改（S4）: 原判据只匹配单行 `run: npm ci` 且只查 ci.yml ⇒
#   ① `run: |` 块内的裸 `npm ci` 测不到（本 PR 自己就转换过一个这样的点）；
#   ② desktop-build.yml / product-progress.yml 完全没查。
#   ⇒ 改为：剥掉注释后，三个 workflow **全文**搜 `npm ci` / `npm i ` / `npm install` 形态。
for f in .github/workflows/ci.yml .github/workflows/desktop-build.yml .github/workflows/product-progress.yml; do
  [ -f "$f" ] || { echo "  ⚠️ SKIP ⑤: 无 $f"; continue; }
  # 判据 = **会跑脚本**的安装命令；显式带 `--ignore-scripts` 的行不算（那正是本机制本身）
  BARE=$(grep -v '^\s*#' "$f" | grep -E 'npm ci|npm i |npm install' | grep -vc -- '--ignore-scripts' || true)
  chk "⑤ ${f##*/} 裸安装命令数 = 0" "0" "$(printf '%s' "$BARE" | tr -d '[:space:]')"
done
grep -q "install-deps.sh" .github/workflows/ci.yml && ok "⑤ ci.yml 已调用安装器" || no "⑤ ci.yml 未调用安装器"
grep -q "install-deps.sh" .github/workflows/desktop-build.yml && ok "⑤ desktop-build.yml 已调用安装器" || no "⑤ desktop-build.yml 未调用安装器"

echo
echo "RESULT: $PASS_N PASS / $FAIL_N FAIL"
[ "$FAIL_N" -gt 0 ] && exit 1
exit 0
