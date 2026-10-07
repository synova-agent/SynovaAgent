# 2026-10-08 · 卡 #1361（D1245）候选 B —— helper 前提缺失 ⇒ 显式点名（仅消息层）

- 状态: implemented（卡 #1361 三候选中 Lead 指定的**候选 B**；A/C 属行为变更，须 K3→CTO 裁）
- 决策人: Lead（#1361 卡面三候选 + 四条判据）；执行: line-g-parser
- 依据: #1353 的**唯一变量对照**（只去掉 helper 树 ⇒ rc=2 + 复现「四源皆空」观感 ⇒ 因果锁定真因）

## 病灶（一句话）

`scripts/control-tower/merge_writeset_gate.py` 的 `collect_declared` 把 helper 脚本
（`brief_parser.py` / `devdoc_writeset.py`）按 **`<repo-root>/scripts/control-tower/`** 定位 ——
这是**隐性前提**：该树缺失时 `python3 <缺失路径>` 退出码 **2**（Python "can't open file"）⇒
S0/S2 被记为「解析失败」⇒ 四源皆空 ⇒ fail-closed。报错**观感**是"claim 读不到"，
**真因是前提缺失**（`claim_store` 自身可读；变更集/merge-base 已正确指向该 root）。

## 改法（候选 B = 仅消息层；定位策略**未改**）

1. 新增 `_helper_precondition(helper, source_label)`：helper **不存在** ⇒ 追加一条独立告警
   `S0/S2/S3 解析失败(前提缺失): helper 脚本缺失（<路径>）—— --repo-root 必须带本仓 scripts/ 树 …
   **这是前提缺失，不是「claim 读不到」**`；helper 在场 ⇒ 一字不改（零误报）。
2. 新增 `helper_missing_in_warns()`：让「四源皆空 ⇒ fail-closed」分支的报文**指认真因**
   （附修法二选一：带 helper 树 / 见 #1361 候选 A·C）。
3. **稳定串保留**：`S0 claim 解析失败` 字面不变（#1353 夹具钉着它）⇒ **跨 PR 零夹具 churn**。

## 判据（#1361 四条，逐条落位）

| 判据 | 落位 |
|---|---|
| ① 裸沙箱不得表现为"claim 读不到" | 夹具 §①：rc=2（行为不变）+ 点名「helper 脚本缺失」+ 真因行 + 显式否定误导读法 |
| ② 真仓等价前提行为不变 | 夹具 §②：pass rc=0 + 零前提告警；**配对夹具 63/0 未回归** |
| ③ 变异体（定位改回/改为他法）⇒ 因果断言必红 | 夹具 §③：把定位改成**脚本相对**（候选 A 形态）⇒ 裸沙箱**能解析**（rc=0、零告警）⇒ 本件 ① 与 #1353 的 D 断言**同时必红** ⇒ 回路成立 |
| ④ 联动 #1353 | §① 断言稳定串仍在；#1353 的 D 用例逐字不受影响 |
| 反例（不误报） | 夹具 §④：helper 在场 + claim 畸形 ⇒ 走既有「畸形」路径，**不出现** helper 缺失字样 |

## 未做（诚实列）

- **定位策略未改**（候选 A/C）：属 **A 类行为变更** ⇒ 须 K3→CTO 裁；本件只做消息层。
- **`claim → 未推断出` 显示口径**（claim 命中时读起来像推断失败）：Lead 已批修为消息层，但**不属本卡**（本卡只做 helper 前提点名）⇒ 留待单独小件。
- **`not declared` 分支不消费 PR 正文豁免、却把「正文豁免」列为可修路径**：Lead 已批（二选一）；若选"真消费"属语义变更 ⇒ 须 K3。本件未动。
