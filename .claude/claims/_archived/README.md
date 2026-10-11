# 已归档的 claim（认领声明）

## 归档规则（CTO 2026-10-11 裁定 · 创始人选 A）
**claim 对应的分支已合入 `local-main` ⇒ 归档。**

理由：claim 的用途是"开工时声明写集、防跨 session 冲突"。分支合入后声明作用已结束；
留在活跃目录只会：① 让 `--coverage` 越算越慢 ② 稀释"活跃声明"信号 ③ 畸形条目持续制造噪音。

## 判定命令（可复算）
```bash
git fetch origin "+refs/heads/*:refs/remotes/origin/*"
for N in $(ls .claude/claims/*.yaml | xargs -n1 basename | sed "s/.yaml//"); do
  git branch -r | grep -E "(^|[/_-])${N}([/_-]|$)" | while read b; do
    git merge-base --is-ancestor "$b" origin/local-main && echo "$N 已合入 → 可归档"
  done
done
```

## 归档事实（2026-10-11）
归档 31 条 ｜ 保留活跃 [978, 980, 1045, 1047, 1048, 1220, 1282, 1430, 1452, 1457, 1460] 条

## 注意
- 归档 ≠ 删除：历史声明可追溯
- 恢复：`git mv .claude/claims/_archived/<N>.yaml .claude/claims/<N>.yaml`
- 本目录**不参与** `claim_store --coverage`

## 兜底判定命令（分支已删时用 · 2026-10-11 兜底任务组追加）
规则 A 依赖"分支存在"，分支合并后被删除的 claim 判不出。兜底判据：
**在 `gitea/local-main` 的 commit message（merge/feat/fix/chore 提交）里搜 claim 号
（`#N`、`feat(N)`、分支名 `…/N-…` 等以数字边界匹配的形态），任一命中 commit 已是
`gitea/local-main` 祖先 ⇒ 归档。**

```bash
git fetch gitea "+refs/heads/*:refs/remotes/gitea/*"
for N in $(ls .claude/claims/*.yaml | xargs -n1 basename | sed 's/\.yaml$//'); do
  found=""
  while read -r sha subj; do
    git merge-base --is-ancestor "$sha" gitea/local-main && { found="$sha"; break; }
  done < <(git log gitea/local-main --format="%H %s" \
           | awk -v n="$N" '{h=$1; $1=""; s=$0; if (s ~ ("(^|[^0-9])" n "([^0-9]|$)")) print h, s}')
  if [ -n "$found" ]; then
    echo "$N 可归档（落点 $(git log -1 --format=%h "$found")）"
  else
    echo "$N 须保留"
  fi
done
```

要点：
- 匹配限 **commit message 正文**（awk 剥掉 sha 列），避免 40 位十六进制 sha 内偶然出现同号误命中
- 数字边界 `(^|[^0-9])N([^0-9]|$)`：`#980`、`feat(1047)`、`chore/1282-`、`D1220` 均命中；`9800`/`12345` 不误伤
- 本命令是**人工归档判定**用，不改 claim 检查器语义

## 已知局限
分支合并后被删除 ⇒ 规则 A 无法判定 ⇒ 该 claim 留在活跃目录。
（分支已删的残留用上方「兜底判定命令」判定。）
