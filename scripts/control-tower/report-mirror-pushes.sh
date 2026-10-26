#!/bin/bash
# 契约（铁律 47·裁 421 / K3 §4 P2-⑧）
#   @input  [$1=数量，默认 10]
#   @output 逐条列出 GitHub main 最近提交：sha / 时间 / 作者 / 是否经 PR（无 PR = 直推=绕过保护）
#   @exit   0=报告成功；2=gh/网络不可用（fail-closed，不当作"没有绕过"）
#   @degraded 无 gh 或未登录 → 显式 exit 2 并说明
set -uo pipefail
N="${1:-10}"
# 仅当 gh 不在 PATH 时才补 ~/.local/bin（否则会盖掉测试/调用方的 stub）
command -v gh >/dev/null 2>&1 || export PATH="$HOME/.local/bin:$PATH"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/ghcache}"
REPO="${SYNO_GH_REPO:-synova-agent/SynovaAgent}"
command -v gh >/dev/null 2>&1 || { echo "❌ 无 gh：无法取证（fail-closed）" >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "❌ gh 未登录：无法取证（fail-closed）" >&2; exit 2; }
echo "── GitHub main 最近 $N 条提交（无关联 PR = 直推 = 绕过必需 checks）──"
# swallow-ok: 取数失败时下方循环无输出，由 gh 前置检查与 exit 码兜底（不静默判定“无绕过”）
gh api "repos/$REPO/commits?sha=main&per_page=$N" --jq '.[]|"\(.sha[0:9])|\(.commit.committer.date)|\(.commit.author.name)|\(.commit.message|split("\n")[0])"' 2>/dev/null |  # swallow-ok: gh 取数失败由上方 auth/命令检查兜底，不静默判“无绕过”
while IFS='|' read -r sha date author msg; do
  [ -z "$sha" ] && continue
  prs=$(gh api "repos/$REPO/commits/$sha/pulls" --jq 'length' 2>/dev/null || echo ERR)
  if [ "$prs" = "ERR" ]; then where="查询失败（不可下结论）"; elif [ "$prs" = "0" ]; then where="🔴 直推（绕过保护）"; else where="✅ 经 PR（#$prs 条）"; fi
  printf '%s  %s  %-14s %s  :: %s\n' "$sha" "$date" "${author:0:14}" "$where" "${msg:0:60}"
done
