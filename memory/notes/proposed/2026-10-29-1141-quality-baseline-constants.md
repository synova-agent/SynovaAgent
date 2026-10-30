# Note — #1141 quality-baseline 测试常量随登记表同步（proposed）

## 现状
合并后 `tests/control-tower/quality-baseline.test.sh` 本地 FAIL pass=161 fail=2：
- 断言 `REGISTRY-OK rows=22`，真值 **26**（并入 #1075 `content.rolePackApproval`、#1128 verify-governance、#1138 d331Bypass 等登记后行数增长）；
- 断言 `orphans` 分母 `40$`，真值 **41**。

## 决定
只同步常量（`22→26`、`40→41`）与注释，**不改判据逻辑**；`--check-registry` 真件仍 `EXIT=0`。

## 依据
- 卡 #1141（创始人 2026-10-29 转交，来源：合并后本地红）；
- 现象属**常量漂移**：真件输出 `REGISTRY-OK rows=26`，判据语义未变。

## 生效时点
PR 合入 main 起；该测试当前不在 CI 两腿内 ⇒ 合入后仍需人工/本地跑，是否接线待 CTO 裁。

## 未决
`quality-baseline.test.sh` 未接入 CI（同类漂移只能本地发现）——已作为建议写入 PR，不擅自改 workflow。
