#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# probe-packaging.sh — BS-5 交付打包卫生 判据探针（#1464 / 施工项登记 BS-5）
#
# 用途: 让「打包卫生」这条链**可被独立跑红**。四段全部断言，任一失败 ⇒ exit 1。
#
# 判据来源:
#   登记件 `docs/synova/coordination/施工项登记.ts` BS-5:
#     { run: 'bash scripts/control-tower/probe-packaging.sh', expectExit: 0 }
#   卡面 #1464 §判据 V1-V4:
#     V1 docker build 成功且容器内服务可起
#     V2 生产路径面 grep '/Users/wane' = 0
#     V3 版本号三处同源
#     V4 产物无 .map（或白名单外为 0）
#
# ⚠️ 等价性边界（V1，判例 V-09 —— 禁把未核写成已核）:
#   本探针**不执行 docker build**（探针必须离线、快、可在 CI 跑）。
#   它对 V1 只做**静态可达性断言**：Dockerfile 每条本地 COPY 的源路径在仓库内存在
#   + 运行阶段入口文件存在 + 构建依赖面自洽。
#   ⇒ 「容器内服务可起」**未由本探针核验**，须在有 docker 的机器上实跑
#     （见交付件的「未核项 U1」）。
#
# 口径界定（V2 —— 「生产路径面」vs「全仓面」）:
#   口径 A（本探针口径）= 进镜像/安装包或由运行时执行的路径面:
#       src/ Dockerfile app/ electron/ mvp-server.cjs
#   口径 B（全仓面，含 docs/ .claude/ .dsh/ ...）= 本卡**不可达**目标，
#       仅作范围声明，不纳入断言（见交付件 §口径界定）。
#
# 契约（铁律 47）:
#   @input    — 无入参。仓库根 = 环境变量 SYNOVA_REPO_ROOT，默认由脚本位置上溯两级。
#   @output   — stdout 四段报告（A-V1 / B-V3 / C-V2 / D-V4）+ 末行 SUMMARY。
#   @degraded — **无降级分支**：任一段失败 ⇒ [FAIL] 明细 + exit 1（fail-closed，禁静默放行）；
#               探针自身异常（缺 jq / 定位不到仓库根 / 缺判据文件 / COPY 解析失效）⇒ exit 2。
# 退出码: 0 = 四段全绿；1 = 至少一条断言失败；2 = 探针自身异常
#
# 白名单（V4）: 产物 `.map` 一律不得存在 —— 无白名单条目。
#   若将来确有需要随包发货的 sourcemap，须在此显式登记并说明理由（禁静默豁免）。
#
# 维护注记（踩坑记录，改动本脚本前必读）:
#   ① bash 参数展开 `$VAR` 后紧跟非 ASCII 字符（如全角括号）时变量名边界解析不可靠
#      ⇒ 本脚本一律写 `${VAR}`。历史：紧跟全角括号的 `$lock_version` 曾触发 unbound variable 中断。
#   ② COPY 源 token 解析须先剥掉 `grep -n` 行号前缀，且排除 `--from=` 阶段引用。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SYNOVA_REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"

FAIL_COUNT=0
PASS_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf '  [PASS] %s\n' "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf '  [FAIL] %s\n' "$1"; }
info() { printf '         %s\n' "$1"; }
section() { printf '\n== %s ==\n' "$1"; }
# 探针自身异常（exit 2 通道）: 判定不可信时**显式中止**，禁静默放行
#   （用于结构缺失使某段无法判定 —— 例如 Dockerfile 无 FROM ⇒ 无法界定运行阶段）
self_err() {
  printf '  [FAIL] %s\n' "$1"
  printf '\n== SUMMARY ==\n  RESULT=ERROR（探针自身异常，判定不可信 —— 见上方 FAIL 明细）\n'
  exit 2
}
# 行数计数
#   坑 ①: `grep -c` 无匹配时输出 "0" 且 exit 1，`|| echo 0` 会追加成两行 → `[: integer expected`
#   坑 ②: `$(cmd)` 剥掉末尾换行 ⇒ 空串经 `printf '%s\n'` 后又变成一个空行 ⇒ NR 误报 1
#   ⇒ 空串显式返回 0，否则按非空行数计
count_nonempty_lines() {
  if [ -z "$1" ]; then printf '0'; return; fi
  printf '%s' "$1" | awk 'NF { n++ } END { print n + 0 }'
}

# ── 探针自身前提（exit 2 通道）──────────────────────────────────────────────────
if [ ! -d "${REPO_ROOT}" ]; then
  printf '[FAIL] 仓库根不存在: %s\n' "${REPO_ROOT}" >&2
  exit 2
fi
cd "${REPO_ROOT}" || exit 2

for required in Dockerfile package.json scripts/desktop/build-backend.sh; do
  if [ ! -f "${required}" ]; then
    printf '[FAIL] 探针前提缺失（无法判定）: %s\n' "${required}" >&2
    exit 2
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  printf '[FAIL] 探针自身异常: 缺 jq（用于读 package.json version，避免正则误判）\n' >&2
  exit 2
fi

printf 'probe-packaging.sh — BS-5 打包卫生判据（#1464）\n'
printf 'repo_root=%s\n' "${REPO_ROOT}"
printf 'as_of=%s\n' "$(git rev-parse HEAD 2>/dev/null || echo 'not-a-git-worktree')"

# ═══ A. V1 — Dockerfile 构建面静态可达性 ═══════════════════════════════════════
section 'A. V1 — Dockerfile 构建面（静态可达性；容器实起未核，见交付件 未核项 U1）'

# A1: 每条**本地** COPY/ADD 的源路径在仓库内存在
#     排除 `--from=<stage>` 的跨阶段 COPY（其源是上一阶段路径，不在仓库内）
local_copy_srcs="$(awk '
  /^COPY[[:space:]]|^ADD[[:space:]]/ {
    if ($0 ~ /--from=/) next            # 跨阶段拷贝，源非仓库路径
    n = 0
    for (i = 2; i <= NF; i++) tok[n++] = $i
    for (i = 0; i < n - 1; i++) print tok[i]   # 末位是 dest，去掉
  }
' Dockerfile)"

if [ -z "${local_copy_srcs}" ]; then
  printf '[FAIL] A1 未从 Dockerfile 解析出任何本地 COPY/ADD 源路径（解析器失效，判定不可信）\n' >&2
  exit 2
fi

a1_bad=0
a1_total=0
while IFS= read -r src; do
  [ -z "${src}" ] && continue
  a1_total=$((a1_total + 1))
  if [ ! -e "${src}" ]; then
    a1_bad=$((a1_bad + 1))
    fail "A1 COPY 源路径在仓库内不存在: ${src}"
  fi
done <<< "${local_copy_srcs}"
if [ "${a1_bad}" -eq 0 ]; then
  pass "A1 全部本地 COPY/ADD 源路径存在（${a1_total} 个源 token）"
fi

# A2: 禁引用不存在的 server/ 前缀（卡面 Dockerfile:19 病灶回归锚）
if grep -qE '^COPY[[:space:]]+server/' Dockerfile; then
  fail 'A2 Dockerfile 仍有 COPY server/…（仓库内无 server/ 目录 ⇒ 构建必失败）'
else
  pass 'A2 Dockerfile 无 COPY server/…（#1464 病灶未回归）'
fi

# A3: 运行阶段入口文件存在（CMD 引用的目标必须在仓库内）
cmd_line="$(grep -E '^CMD[[:space:]]' Dockerfile | head -1)"
if [ -z "${cmd_line}" ]; then
  fail 'A3 Dockerfile 无 CMD 指令（镜像无默认入口）'
else
  entry="$(grep -oE 'dist/[A-Za-z0-9._-]+\.(mjs|js)|src/[A-Za-z0-9._/-]+\.ts' <<< "${cmd_line}" | head -1)"
  if [ -z "${entry}" ]; then
    info "CMD 原文: ${cmd_line}"
    fail 'A3 CMD 未引用可识别的入口文件（dist/*.mjs 或 src/*.ts）'
  elif [ ! -f "${entry}" ]; then
    fail "A3 CMD 入口文件在仓库内不存在: ${entry}"
  else
    pass "A3 CMD 入口存在: ${entry}"
  fi
fi

# A4: 生产构建依赖面自洽 —— 交付资产（vendor/）须在**最终（运行）阶段**可见
#
# 🔴 判别力要求（V-08 教训）: 必须**按阶段**判定，禁止全文件 grep。
#   历史缺陷（#1464 复核 M5 实证）: 原实现是 `grep -cE '^COPY vendor/' Dockerfile | grep -qE '^[1-9]'`
#   —— 全文件计数、不分阶段，却在断言文本里声称「进**运行阶段**」。变异体（把 `COPY vendor/`
#   只留在 builder 阶段）⇒ 仍 PASS ⇒ **零判别力**，且使 R6 反例声称被证伪。
#   合法形态（二者任一）:
#     ① 最终阶段内 `COPY vendor/ …`
#     ② 最终阶段内 `COPY --from=<builder 阶段名> …/vendor …`
#   阶段边界 = `FROM` 行；「最终阶段」= 最后一个 FROM 段落。
FINAL_STAGE_LINE="$(grep -nE '^FROM[[:space:]]' Dockerfile | tail -1 | cut -d: -f1)"
if [ -z "${FINAL_STAGE_LINE}" ]; then
  self_err "A4 Dockerfile 无 FROM 指令（无法判定运行阶段）"
else
  A4_HITS="$(awk -v start="${FINAL_STAGE_LINE}" '
    NR < start { next }                                  # 只看最终阶段段内
    /^COPY[[:space:]]+vendor\//      { print "local"; next }
    /^COPY[[:space:]]+--from=[^ ]+[[:space:]].*\/vendor([[:space:]]|$)/ { print "from-stage"; next }
  ' Dockerfile)"
  if [ -n "${A4_HITS}" ]; then
    pass "A4 vendor/ 在最终阶段可见（形态: $(printf '%s' "${A4_HITS}" | sort -u | tr '\n' '/' | sed 's|/$||')；vendor 是运行时真依赖，见 src/agent/builtin-tools.ts:11）"
  else
    fail 'A4 最终阶段无任何 vendor/ COPY（运行时将缺 vendor/ ⇒ 工具注册失败）'
  fi
fi

# A6: 构建上下文泄漏面 —— 仓库根的宿主配置文件不得进镜像（两条独立断言）
#
# 🔴 断言必须与 Docker 真实语义对齐（#1464 复核纠错，2026-10-09）:
#   复核员推断「`COPY package.json package-lock.json ./` 会把同目录 synova.json 一起考进镜像」——
#   **该推断与 Docker 规范不符**。官方 Dockerfile 参考（COPY → Source）:
#     "You can specify multiple source files or directories with COPY. The last argument must
#      always be the destination. … COPY file1.txt file2.txt /usr/src/things/"
#   ⇒ 多源 COPY 只考**具名**源；未列名的同级文件**不入选**。本仓无任何 `COPY .` / 根目录级 COPY
#   ⇒ `synova.json` **不在镜像内**。故「进镜像」不是事实，不能作为断言。
#   真实且可测的两条:
#     ① 须进镜像的同名具名文件依赖**显式列名**（若将来有人把 `COPY package.json` 泛化成 `COPY .`，
#        宿主配置会被静默带进镜像）⇒ 断言 Dockerfile 无根目录级 `COPY .`。
#     ② `synova.json` 仍在**构建上下文**内（未被 .dockerignore 排除）⇒ 每次 build 都随上下文上传，
#        且 `config-file.ts` 从 `process.cwd()` 读它 ⇒ 一旦镜像里出现（当前没有）即携带宿主值。
#        属上下文卫生欠账 ⇒ 以 .dockerignore 排除为期望态。
A6_COPYDOT="$(grep -nE '^COPY[[:space:]]+(\.[[:space:]]|\./)' Dockerfile || true)"
if [ -n "${A6_COPYDOT}" ]; then
  fail "A6 Dockerfile 含根目录级 COPY 通配（会把未列名的宿主配置带进镜像）: ${A6_COPYDOT}"
else
  pass 'A6 Dockerfile 无根目录级 COPY 通配（同名具名文件方入选，宿主配置不会静默进镜像）'
fi

A6_SUSPECTS=""
for cand in synova.json synova.json.last-good; do
  [ -f "${cand}" ] || continue
  # 期望态: .dockerignore 显式排除（支持 `name` / `/name`，忽略注释与空行）
  #   ⚠️ 不用 `git ls-files` 判在库 —— 探针可在非 git 目录（如复跑夹具）运行，
  #      把「文件存在但未排除」判红即可（更强的保守判据），在库与否不改变期望态。
  if ! grep -qE "^[[:space:]]*/?${cand//./\\.}[[:space:]]*$" .dockerignore 2>/dev/null; then
    A6_SUSPECTS="${A6_SUSPECTS} ${cand}"
  fi
done
if [ -n "${A6_SUSPECTS}" ]; then
  fail "A6b 宿主配置件未排除出构建上下文:${A6_SUSPECTS}（未进镜像，但随上下文上传；且一旦 COPY 形态被泛化即静默进镜像）"
  info "     处置: 在 .dockerignore 显式加行（见交付件 U5 —— 本卡未处置，需授权面）"
else
  pass 'A6b 宿主配置件（synova.json / .last-good）已被 .dockerignore 排除或不存在'
fi

# A5: 后端生产入口由 bundle 产出（tsx 属 devDependency，镜像内不存在）
if grep -qE '^CMD.*tsx/esm' Dockerfile; then
  fail 'A5 CMD 仍用 tsx/esm —— tsx 是 devDependency 且构建阶段 --omit=dev ⇒ 镜像内无 loader，容器必起不来'
else
  pass 'A5 CMD 不依赖 tsx/esm（devDependency 不进生产镜像）'
fi
if grep -qE '^RUN .*build:backend|^RUN .*build-backend\.sh' Dockerfile; then
  pass 'A5b 构建阶段产出后端 bundle（scripts/desktop/build-backend.sh）'
else
  fail 'A5b 构建阶段未产出后端 bundle（CMD 需消费 dist/backend.mjs）'
fi

# ═══ B. V3 — 版本号单一来源 ════════════════════════════════════════════════════
section 'B. V3 — 版本号单一来源（真源 = package.json）'

pkg_version="$(jq -r '.version' package.json)"
info "真源 package.json version = ${pkg_version}"

# B1: Dockerfile 不得硬编码版本字面量于 OCI 标签
docker_label="$(grep -E '^LABEL[[:space:]]+org\.opencontainers\.image\.version=' Dockerfile | head -1)"
if [ -z "${docker_label}" ]; then
  fail 'B1 Dockerfile 无 org.opencontainers.image.version 标签'
elif [[ "${docker_label}" == *'${APP_VERSION}'* || "${docker_label}" == *'$APP_VERSION'* ]]; then
  pass "B1 Dockerfile 版本标签由变量注入: $(printf '%s' "${docker_label}" | sed 's/^ *//')"
else
  fail "B1 Dockerfile 版本标签硬编码字面量（非单一来源）: $(printf '%s' "${docker_label}" | sed 's/^ *//')"
fi

# B2: ARG 默认值必须等于 package.json version（改一处即两处同步）
arg_version="$(grep -E '^ARG[[:space:]]+APP_VERSION=' Dockerfile | head -1 | sed -E 's/^ARG[[:space:]]+APP_VERSION=//')"
if [ -z "${arg_version}" ]; then
  fail 'B2 Dockerfile 无 ARG APP_VERSION=<default>（无法从单一来源注入版本）'
elif [ "${arg_version}" = "${pkg_version}" ]; then
  pass "B2 ARG APP_VERSION 默认值与 package.json 一致（${arg_version}）"
else
  fail "B2 ARG APP_VERSION=${arg_version} != package.json version=${pkg_version}（已漂移）"
fi

# B3: 构建链第三处必须是派生态，不得新增字面量
if grep -qE 'artifactName:.*\$\{version\}' build-synova.cjs; then
  pass 'B3 build-synova.cjs 产物名用 ${version} 派生（不新增字面量）'
else
  fail 'B3 build-synova.cjs artifactName 未使用 ${version} 派生'
fi

# B4: Dockerfile 内不得出现与真源不一致的裸版本字面量（防回归）
docker_literals="$(grep -nE '"[0-9]+\.[0-9]+\.[0-9]+"' Dockerfile || true)"
if [ -z "${docker_literals}" ]; then
  pass 'B4 Dockerfile 内无裸版本字面量'
else
  b4_bad=0
  while IFS= read -r line; do
    [ -z "${line}" ] && continue
    lit="$(grep -oE '"[0-9]+\.[0-9]+\.[0-9]+"' <<< "${line}" | tr -d '"')"
    if [ "${lit}" != "${pkg_version}" ]; then
      b4_bad=$((b4_bad + 1))
      fail "B4 Dockerfile 含漂移版本字面量: ${line}"
    fi
  done <<< "${docker_literals}"
  [ "${b4_bad}" -eq 0 ] && pass "B4 Dockerfile 内版本字面量与真源一致（${pkg_version}）"
fi

# B5: lockfile 顶层 version 与真源一致
lock_version="$(jq -r '.version' package-lock.json)"
if [ "${lock_version}" = "${pkg_version}" ]; then
  pass "B5 package-lock.json version 与真源一致（${lock_version}）"
else
  fail "B5 package-lock.json version=${lock_version} != 真源=${pkg_version}"
fi

# B6: 运行期版本读数必须可达 —— /health 的 version 来自 getCurrentVersion()，
#     它在运行期读 bundle 同级的 package.json（src/services/update-checker.ts:63-76，
#     候选路径 `import.meta.dirname/../package.json`）⇒ 镜像必须带 package.json，
#     否则版本静默降级为 '0.0.0'（探针此前已实测 /health 返回 0.1.0）
#     Dockerfile 字段名来自 Docker 官方前端保留键，改动须同步本断言
if grep -qE '^COPY[[:space:]]+package\.json' Dockerfile; then
  pass 'B6 package.json 进镜像（/health version 运行期读数可达，不降级 0.0.0）'
else
  fail 'B6 Dockerfile 未 COPY package.json ⇒ 运行期 getCurrentVersion() 读不到，/health version 降级 0.0.0'
fi

# ═══ C. V2 — 硬编码路径（生产路径面 = 0） ══════════════════════════════════════
section 'C. V2 — 硬编码 /Users/wane（口径 A：生产路径面）'

PROD_PATHS="src Dockerfile app electron mvp-server.cjs"
info "口径 A 路径面: ${PROD_PATHS}"
info '口径 B（全仓面，含 docs/ .claude/ .dsh/）非本卡可达目标，不作为断言 —— 见交付件 口径界定'

prod_hits="$(grep -rIn '/Users/wane' ${PROD_PATHS} 2>/dev/null || true)"
prod_count="$(count_nonempty_lines "${prod_hits}")"
if [ "${prod_count}" -eq 0 ]; then
  pass 'C1 生产路径面 /Users/wane 命中 = 0'
else
  fail "C1 生产路径面 /Users/wane 命中 = ${prod_count}（应为 0）"
  while IFS= read -r l; do [ -n "${l}" ] && info "  ${l}"; done <<< "${prod_hits}"
fi

# C2: 打包卫生口径 —— 生产构建链内非注释行不得出现宿主绝对路径（$HOME）
home_hits="$(grep -rIn "${HOME}" Dockerfile scripts/desktop/build-backend.sh build-synova.cjs 2>/dev/null | grep -vE '^[^:]*:[0-9]+:[[:space:]]*#' || true)"
home_count="$(count_nonempty_lines "${home_hits}")"
if [ "${home_count}" -eq 0 ]; then
  pass "C2 打包链（Dockerfile/build-backend.sh/build-synova.cjs）非注释行不含宿主绝对路径 ${HOME}"
else
  fail "C2 打包链含宿主绝对路径 ${HOME} 共 ${home_count} 行"
  while IFS= read -r l; do [ -n "${l}" ] && info "  ${l}"; done <<< "${home_hits}"
fi

# ═══ D. V4 — 产物无 sourcemap ═════════════════════════════════════════════════
section 'D. V4 — 产物无 .map'

# D1: 仓库跟踪面不得有 .map
tracked_maps="$(git ls-files '*.map' 2>/dev/null || true)"
tracked_count="$(count_nonempty_lines "${tracked_maps}")"
if [ "${tracked_count}" -eq 0 ]; then
  pass 'D1 仓库跟踪面无 .map 文件'
else
  fail "D1 仓库跟踪面有 ${tracked_count} 个 .map 文件"
  while IFS= read -r l; do [ -n "${l}" ] && info "  ${l}"; done <<< "${tracked_maps}"
fi

# D2: 构建产物面（若已构建）不得有 .map —— 未构建时显式标 SKIP，禁静默
if [ -d dist ]; then
  dist_maps="$(find dist -type f -name '*.map' 2>/dev/null || true)"
  dist_count="$(count_nonempty_lines "${dist_maps}")"
  dist_files="$(find dist -type f | awk 'END { print NR + 0 }')"
  if [ "${dist_count}" -eq 0 ]; then
    pass "D2 dist/ 产物面无 .map（实查 ${dist_files} 个产物文件）"
  else
    fail "D2 dist/ 产物面有 ${dist_count} 个 .map"
    while IFS= read -r l; do [ -n "${l}" ] && info "  ${l}"; done <<< "${dist_maps}"
  fi
else
  info 'D2 [SKIP 未构建] dist/ 不存在 —— 本项未核，须在 bash scripts/desktop/build-backend.sh 之后复跑'
fi

# D3: 生产构建链不得开启 sourcemap
backend_sm="$(grep -nE 'sourcemap|source-map' scripts/desktop/build-backend.sh || true)"
if [ -z "${backend_sm}" ]; then
  pass 'D3 scripts/desktop/build-backend.sh 无 sourcemap 开关（esbuild 默认不产 .map）'
else
  fail "D3 build-backend.sh 出现 sourcemap 开关: ${backend_sm}"
fi

renderer_cfg='electron-renderer/vite.config.ts'
if [ -f "${renderer_cfg}" ]; then
  if grep -qE 'sourcemap[[:space:]]*:[[:space:]]*true' "${renderer_cfg}"; then
    fail "D3b ${renderer_cfg} 开启 sourcemap: true"
  else
    pass "D3b ${renderer_cfg} 未开启 sourcemap（Vite 默认 false）"
  fi
else
  info "D3b [SKIP 文件缺失] ${renderer_cfg} 不存在"
fi

# ═══ SUMMARY ══════════════════════════════════════════════════════════════════
section 'SUMMARY'
printf '  PASS=%s  FAIL=%s\n' "${PASS_COUNT}" "${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -eq 0 ]; then
  printf '  RESULT=PASS（V1 仅静态可达性；容器实起未核 —— 见头部等价性边界）\n'
  exit 0
fi
printf '  RESULT=FAIL（%s 条断言失败）\n' "${FAIL_COUNT}"
exit 1
