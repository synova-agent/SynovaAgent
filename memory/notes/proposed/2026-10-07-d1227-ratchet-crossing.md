---
状态: proposed
日期: 2026-10-07
决策: 棘轮余量上限改判「越线者付账」——slack_before ≤ CAP ∧ slack_after > CAP ⇒ 红；纯继承 ⇒ ::warning + 载体 INHERITED-OVER-CAP-SINCE（超期 14 天升级为红）；scan(base) 与 scan(PR) 同一次运行内测量；禁自动写台账
理由: 旧口径对「纯继承 over-cap main」的 PR 也判红 ⇒ 一张无关 PR 承担全批解阻塞、合并序被棘轮绑架（本轮实测三张同冲突）；但降 warning 若无升级载体 ⇒ 余量回到无界增长
---

# D1227 — 棘轮余量上限：「越线者付账」（卡 #1300）

## 一、旧口径的病（实测）
`SLACK-CAP=10` 按「余量 > 上限即红」会对**纯继承**态判红 ⇒ main 一旦累计超过上限，**所有以 main 为 base 的 PR 同时红**（本轮实测多张被同一刀砍中；解药只有"某张 PR 显式上调 FACE-TOTAL 并先合" ⇒ 合并序被棘轮绑架）。

## 二、新判据（三态）
| 情形 | 判定 |
|---|---|
| `slack_before ≤ CAP ∧ slack_after > CAP` | **红**（本 PR 使余量越线 = 增长的唯一来源） |
| 否则 `slack_after > CAP` | **warning**（纯继承态）+ 载体 |
| `slack_after ≤ CAP` | 通过 |

**噪声地板**：`scan(base)` 用 `git ls-tree -r --name-only <base>` 纯 tree 计数（不 checkout）⇒ 与工作树 `scan` **同尺度、同一次运行内测量**；跨运行比较会假红（CI 152 vs 本地 150）。
**注入缝**：`SYNO_BASE_REF`；空/不可解析 ⇒ **显式打印「未给 base ⇒ 不判越线」**并退化为现状语义（禁静默、禁假红）。

## 三、升级载体（风险兜底，卡面 ④）
- 台账单行 `# INHERITED-OVER-CAP-SINCE=<YYYY-MM-DD>`；
- 继承态 ⇒ `::warning title=sealed-ratchet::…`；载体**缺失** ⇒ 打印**可直接粘贴的登记行**；
- 登记**超期**（默认 14 天，`INHERITED_CAP_DAYS` 覆写）⇒ **升级为红**（逼显式上调 FACE-TOTAL 并删登记行）；
- **禁止自动写台账**（自动上调/自动登记 = 削弱棘轮）——只打印，不写。

## 四、判别力（夹具 6 例，均在 `sealed-tests.test.sh`）
越线红 ／ **纯继承反例（不得红）** ／ 载体缺失⇒粘贴行 ／ 载体超期⇒升级红 ／ 未给 base⇒显式打印 ／ **变异体**（把 base 侧计数换掉 ⇒ 反例变越线 ⇒ 夹具抓到"base 测量退化"）。

## 五、回滚
- 不给 `SYNO_BASE_REF` ⇒ 退化为现状语义（**但会恢复"纯继承也红"的病** —— 回滚代价须登记）；
- 删除载体行 ⇒ 继承态回到"每次打印粘贴行"（不会静默）。
