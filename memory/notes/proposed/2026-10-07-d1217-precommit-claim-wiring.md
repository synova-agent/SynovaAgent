# 状态: proposed
# 日期: 2026-10-07
# 决策: pre-commit 组 6 声明载体双形态 —— claim 载体不再被散文检查判 4×「未填写」
# 理由: K3 预审 R6「与 D-A2 的 pre-commit 测试面合并核验」；claim 是两字段制，无 Q0/Q1/Q2/Q3

## 决策内容

`pre-commit-check.sh` 组 6 原以 awk 逐节检查 `## Q0/Q1/Q2/Q3` 散文。claim 载体
（`.claude/claims/<issue>.yaml`）只有 `writeset` + `done` ⇒ 四个散文段皆空 ⇒ **4×「未填写」硬红**，
即「合法声明被判违规」。改接方式：

- 单一开关 `SYNO_CLAIM_V2`（**默认关**）：关时逐字节 legacy（回滚=关开关）；
- 开 + resolver 返回 claim ⇒ 散文检查**按设计不适用**，改以 `claim_store.py --check`
  （writeset/done 非空且 done 含 `verify:`）为判据；
- **显式打印**「Q0/Q1/Q2/Q3 散文检查按设计不适用」（禁静默空白，铁律 11）；
- 三态：claim 不合规 → exit 1 计入硬红；检查自身失败 → exit 2 **同样阻断**（不与通过混同）。

## 代价与已知边界

- 组 12（Task Scope）仍有 legacy 散文路径；其 claim 化随 D-A2 第二刀一并处置（本件只做组 6）。
- claim 模式下的「排除项」检查天然为空（claim 无 exclude 字段）—— 已由 D708 写集对账单点承担，
  见 `claim_store.py` 头块留痕。

## 关联

卡 #1224（D-C）／#1222（D-A2）；K3 预审 R6；过渡号 D1217。
夹具：`tests/control-tower/precommit-claim-wiring.test.sh`（9 项，含改坏即红判别力证明）
