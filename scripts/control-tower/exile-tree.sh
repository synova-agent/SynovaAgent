#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# exile-tree.sh — **隔离宿主树 · 薄壳**（CTO 裁定 086 · 摘除演练两档共用底座）
#
# 🔴 **本壳零判定逻辑**（可 grep 证：无 glob / 无 find / 无数组聚合）——
#    遍历、搬运、还原、残留自检**全部**在 `exile-tree-core.ts`（一份实现）。
#    壳只做四件事：① 定位仓根 ② 定位 node/tsx/tsc（**真跑一次版本**）③ 建/拆 worktree
#    ④ 透传参数与退出码。
#
# 🔴 为什么不把遍历写在壳里（**实测踩坑**，2026-10-13）：
#    macOS 自带 `/bin/bash` 是 **3.2**，**没有 `globstar`** ⇒ `src/l4/**` 退化成单层 `*`
#    （**少摘且静默**）；且 `set -u` 下 shell 数组拼接易出 `unbound variable`。
#    ⇒ 遍历/搬运一律 Node（跨平台一致）。
#
# 契约（铁律 47）:
#   @input  子命令：
#             `create  <dir> [rev]`   建隔离宿主树（缺省 rev=HEAD；目标已存在 ⇒ exit 2，禁覆盖）
#             `paths   <BlockId>`     打印该块 paths（一行一条；**从生成器取，禁手抄**）
#             `exile   <dir> <BlockId>` 摘除该块的 paths（判定/搬运在 core）
#             `restore <dir>`         还原 ＋ 残留自检
#             `destroy <dir>`         拆树（须先 restore）
#             `matrix  <dir> <outdir>` 复核路全矩阵：基线 ＋ 逐块摘除跑真 tsc（输出**原样落盘**）
#   @output  stdout：子命令原文；matrix 模式另落 `<outdir>/baseline.txt` 与 `<outdir>/after-<X>.txt`
#   @exit    🔴 **三态（D328）**：0 = 成了 ｜ 1 = 真红（摘除面为空 / 有残留）｜ 2 = **判不了**（环境）
#   @degraded — 无（fail-closed：环境失败一律 2，**禁 `|| true` 吞崩溃**）
#
# 🔴 历史教训（逐条对号）:
#   · `#338`：`CMD="$(cmd)"` 在 `set -e` 下子命令失败即整步退出 ⇒ 本壳**不捕获 tsc 输出**，
#     一律重定向文件，用 `rc=$?` 显式接住。
#   · `D328 P1-1`：`command -v` 只探存在性不探可用性 ⇒ 对 node/tsx/tsc **真跑一次版本**。
#   · `git worktree` 共用主仓 `.git` 但**不共用 node_modules** ⇒ create 时补软链（缺了必 127）。
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GEN="${ROOT}/scripts/control-tower/gen-block-paths.ts"
CORE="${ROOT}/scripts/control-tower/exile-tree-core.ts"

# ── ① node（真跑一次版本）────────────────────────────────────────────────────
NODE_BIN_DIR=""
if [ -n "${SYNO_NODE_BIN:-}" ] && [ -x "${SYNO_NODE_BIN}/node" ]; then
  NODE_BIN_DIR="${SYNO_NODE_BIN}"
elif command -v node >/dev/null 2>&1 && [ "$(node -v 2>/dev/null || true)" != "" ]; then
  NODE_BIN_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"
elif [ -d "${HOME}/.nvm/versions/node" ]; then
  for _nbin in $(ls -d "${HOME}"/.nvm/versions/node/*/bin 2>/dev/null | sort -r || true); do
    if [ -x "${_nbin}/node" ] && [ "$("${_nbin}/node" -v 2>/dev/null || true)" != "" ]; then
      NODE_BIN_DIR="${_nbin}"; break
    fi
  done
fi
if [ -z "${NODE_BIN_DIR}" ]; then
  echo "❌ 隔离树判不了（exit 2）：找不到可用的 node（PATH / SYNO_NODE_BIN / HOME.nvm）" >&2
  exit 2
fi
PATH="${NODE_BIN_DIR}:${PATH}"

# ── ② tsx / tsc（存在性≠可用性）──────────────────────────────────────────────
TSX=""
for _cand in "${SYNO_TSX:-}" "${ROOT}/node_modules/.bin/tsx" "$(command -v tsx 2>/dev/null || true)"; do
  if [ -n "${_cand}" ] && [ -x "${_cand}" ]; then TSX="${_cand}"; break; fi
done
if [ -z "${TSX}" ] || [ "$("${TSX}" --version 2>/dev/null || true)" = "" ]; then
  echo "❌ 隔离树判不了（exit 2）：tsx 不可用（试过 SYNO_TSX / 仓根 node_modules/.bin/tsx / PATH）" >&2
  exit 2
fi
TSC="${ROOT}/node_modules/.bin/tsc"
if [ ! -x "${TSC}" ] || [ "$("${TSC}" --version 2>/dev/null || true)" = "" ]; then
  echo "❌ 隔离树判不了（exit 2）：tsc 不可用（${TSC}）" >&2
  exit 2
fi
for f in "${GEN}" "${CORE}"; do
  if [ ! -f "${f}" ]; then echo "❌ 隔离树判不了（exit 2）：实现件缺失 ${f}" >&2; exit 2; fi
done
if ! command -v git >/dev/null 2>&1; then
  echo "❌ 隔离树判不了（exit 2）：git 不可用" >&2
  exit 2
fi

# 取某块的 paths（🔴 从生成器取，禁手抄 —— 引用纪律）⇒ 打印 JSON 数组
block_paths_json() {
  local block="$1"
  # 生成器自身的 stderr 诊断（notes）不参与取数；取数失败由下面"空 json"分支 exit 2 兜住
  "${TSX}" "${GEN}" --list 2>/dev/null | awk -F'\t' -v b="${block}" '$1==b{print $3}'  # swallow-ok: 见上一行说明
}

cmd_paths() {
  local block="$1" json
  json="$(block_paths_json "${block}")"
  if [ -z "${json}" ]; then
    echo "❌ 判不了（exit 2）：真源里没有块 ${block}" >&2
    return 2
  fi
  "${NODE_BIN_DIR}/node" -e 'const a=JSON.parse(process.argv[1]); for(const x of a) console.log(x);' "${json}"
}

cmd_create() {
  local dir="$1" rev="${2:-HEAD}"
  if [ -e "${dir}" ]; then
    echo "❌ 判不了（exit 2）：目标已存在 ${dir}（禁覆盖 —— 防误删别人的树）" >&2
    return 2
  fi
  if ! git -C "${ROOT}" worktree add --detach "${dir}" "${rev}" >/dev/null 2>&1; then
    echo "❌ 判不了（exit 2）：git worktree add 失败（rev=${rev} dir=${dir}）" >&2
    return 2
  fi
  if [ ! -e "${dir}/node_modules" ]; then
    ln -s "${ROOT}/node_modules" "${dir}/node_modules"
  fi
  echo "[EXILE-TREE] created ${dir} @ $(git -C "${dir}" rev-parse --short HEAD)"
  return 0
}

cmd_exile() {
  local dir="$1" block="$2" json
  if [ ! -d "${dir}" ]; then
    echo "❌ 判不了（exit 2）：树不存在 ${dir}（先 create）" >&2
    return 2
  fi
  json="$(block_paths_json "${block}")"
  if [ -z "${json}" ]; then
    echo "❌ 判不了（exit 2）：真源里没有块 ${block}" >&2
    return 2
  fi
  "${TSX}" "${CORE}" --op exile --tree "${dir}" --patterns "${json}"
  return $?
}

cmd_restore() {
  local dir="$1" dirty
  if [ ! -d "${dir}" ]; then
    echo "❌ 判不了（exit 2）：树不存在 ${dir}" >&2
    return 2
  fi
  "${TSX}" "${CORE}" --op restore --tree "${dir}" || return $?
  git -C "${dir}" checkout -- . 2>/dev/null || true
  git -C "${dir}" clean -fdq -e node_modules 2>/dev/null || true
  dirty="$(git -C "${dir}" status --porcelain | grep -v '^?? node_modules' | head -3 || true)"
  if [ -n "${dirty}" ]; then
    echo "❌ 真红（exit 1）：还原后仍有改动 ⇒ 隔离树不干净" >&2
    printf '%s\n' "${dirty}" >&2
    return 1
  fi
  echo "[EXILE-TREE] restored ${dir}（git status 干净）"
  return 0
}

cmd_destroy() {
  local dir="$1"
  [ -d "${dir}" ] || { echo "[EXILE-TREE] ${dir} 不存在，无事可做"; return 0; }
  if ! git -C "${ROOT}" worktree remove "${dir}" >/dev/null 2>&1; then
    echo "❌ 判不了（exit 2）：worktree remove 失败（树不干净？先 restore）" >&2
    return 2
  fi
  echo "[EXILE-TREE] destroyed ${dir}"
  return 0
}

cmd_matrix() {
  local dir="$1" outdir="$2" rc blocks b
  [ -d "${dir}" ] || { echo "❌ 判不了（exit 2）：树不存在 ${dir}" >&2; return 2; }
  mkdir -p "${outdir}"
  ( cd "${dir}" && "${TSC}" --noEmit -p tsconfig.json > "${outdir}/baseline.txt" 2>&1 )
  rc=$?
  echo "[EXILE-TREE] baseline tsc rc=${rc}（🔴 基线**本来就是红的** ⇒ 判据一律取差集）"
  # 空结果 ⇒ for 循环零次 ⇒ matrix 无产物，由互证件按"缺行"判不了（不当通过）
  blocks="$("${TSX}" "${GEN}" --list 2>/dev/null | cut -f1 | sort)"  # swallow-ok: 见上一行说明
  for b in ${blocks}; do
    "${TSX}" "${CORE}" --op exile --tree "${dir}" --patterns "$(block_paths_json "${b}")" >/dev/null 2>&1
    rc=$?
    if [ "${rc}" -eq 2 ]; then
      echo "❌ 判不了（exit 2）：摘 ${b} 时环境失败" >&2
      return 2
    fi
    if [ "${rc}" -eq 1 ]; then
      echo "[EXILE-TREE] 摘 ${b}：摘除面为空 ⇒ 不产出 after-${b}.txt（复核路该行判[判不了]）"
    else
      ( cd "${dir}" && "${TSC}" --noEmit -p tsconfig.json > "${outdir}/after-${b}.txt" 2>&1 )
      echo "[EXILE-TREE] 摘 ${b}：tsc 输出已落 after-${b}.txt"
    fi
    "${TSX}" "${CORE}" --op restore --tree "${dir}" >/dev/null || { echo "❌ 真红（exit 1）：还原失败，中止（防污染后续块）" >&2; return 1; }
  done
  echo "[EXILE-TREE] matrix 完成 ⇒ ${outdir}"
  return 0
}

# ── 入口 ─────────────────────────────────────────────────────────────────────
SUB="${1:-}"
shift 2>/dev/null || true
case "${SUB}" in
  paths)   cmd_paths   "${1:-}" ;;
  create)  cmd_create  "${1:-}" "${2:-HEAD}" ;;
  exile)   cmd_exile   "${1:-}" "${2:-}" ;;
  restore) cmd_restore "${1:-}" ;;
  destroy) cmd_destroy "${1:-}" ;;
  matrix)  cmd_matrix  "${1:-}" "${2:-}" ;;
  *)
    echo "用法: exile-tree.sh {create|paths|exile|restore|destroy|matrix} …" >&2
    exit 2 ;;
esac
exit $?
