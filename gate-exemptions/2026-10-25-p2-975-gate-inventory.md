# 豁免 · #975 GATE-INVENTORY 三处整改（C10 跨文件映射修正 ＋ C5 label_hash 真校验 ＋ ①i 步名 R1–R6）

> 受保护路径变更的唯一豁免通道（格式见 `gate-exemptions/README.md`）。裁定依据：**裁 399**
> （#975 A 案批复：按真相修 8 件）｜提报卡：Issue #975；规格：handbook `派单件/2026-10-25-规格-975-GATE-INVENTORY三处整改.md`；
> 实施：本批 L2 小队（T1 判据实装＝quality-baseline.py＋配对测试；T2 台账三载体同步＋登记）。
> 逐行三段式（`- <路径> — <理由> — <裁定号>`），逐条判定、不整文件生效；理由内不含破折号。
> 本件覆盖本批 diff 命中的全部受保护路径，含本文件自身的自覆盖行。
> 到期动作：本 PR 合入即失效（豁免只对本 PR diff 生效，历史合入不看后加豁免）。

- scripts/control-tower/quality-baseline.py — 修改：C10 跨文件分支只对 local-gates.yml 折 CI-S 编号；C5 段追加 label_hash 真校验（#975 规格二点一之一与二） — 裁 399
- tests/control-tower/quality-baseline.test.sh — 修改：夹具 label_hash 换实算真值；新增 c5-tamper 与 C10 跨文件回退两反例及跨载体逐字相等断言（#975 规格四） — 裁 399
- docs/authority/GATE-INVENTORY.yaml — 修改：六行 wired_to 改为修正后 compute_wiring 实算值；三个 label_hash 换实算；CI-S12 步名与 what 文案改 R1 至 R6（#975 规格二点一之三至十一） — 裁 399
- .gitea/workflows/local-gates.yml — 修改：仅三零三行的步名 R1 斜杠 R2 斜杠 R3 改 R1 至 R6，run 体与逃生舱一字不动（#975 规格二点一之十二） — 裁 399
- docs/authority/DOCS-REGISTRY.yaml — 修改：仅追加一行登记本豁免件（DOC-0274），既有条目不动（#975 登记门禁要求） — 裁 399
- gate-exemptions/2026-10-25-p2-975-gate-inventory.md — 自覆盖：本文件自身即受保护路径 gate-exemptions/** 的新增件，须逐条豁免含自覆盖行 — 裁 399
