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

## 已知局限
分支合并后被删除 ⇒ 规则 A 无法判定 ⇒ 该 claim 留在活跃目录。
