# #1033 必需 context 收口：改名对齐 + Gate Integrity 入集 + 三处同步规则

## 做了什么
1. **改名**：ci.yml job `TypeScript + Lint + Iron Laws` → `PR 元信息门禁 (docs/evidence/write-set)`
   （该 job 名下已零 tsc、零 iron-laws；实际跑 docs registry / dev-doc 重放 / 并行声明 / write-set 对账）。
2. **Gate Integrity 入必需集**（K3 §4 P0-③ 的组合炸弹：守卫已修绿后才扩必需集）。
3. **ruleset 24259959** 已 PATCH：9 条 contexts（8 旧 + Gate Integrity，旧名→新名）。
4. `required-checks-baseline.txt` 按 rules 端点**重放为 9 条**（禁止手抄）。
5. `.github/GATE-SPLIT.md` 增「必需 context 真值表」+「改名必须三处同步」+ DeployKey 旁路风险。

## 验收（本地）
- `check-required-contexts.py --api-check` ⇒ `OK: live 9 条与基线逐字一致`、`REQUIRED-CONTEXTS: OK；live=9`
- 配对测试 ⇒ **47 通过 / 0 失败**
