---
状态: proposed
日期: 2026-10-23
决策: "把「质量」从人工一次性判断变成可复跑的测量：落 G1–G6 标准 v1、wiring 登记表 schema、按模块基线、旧门禁盘点四件，P0 只测量不阻断（零接线）。"
理由: 质量判据目前只存在于一次性人工判定（附卷 A：30 件 0 合格／7 有条件／21 不合格／2 缺件），没有可复跑的测量、能力→消费者的登记账、旧门禁的账 —— 换个人/换一天就不可复现，也无人盯得住漂移。EPIC #836 的后续子卡（13 组能力件逐组修、retire 5 项、登记表全量填充）都以「G1–G6 可机械判」为前提；没有本批，每张卡都要重做一次研究。P0 刻意只加测量不加阻断：先让存量可见并证明判别力，再谈门禁化（新门禁准入条款见标准「新门禁准入」节）。
---

# #841 P4 · P0 质量门禁四件（标准 v1／登记表 schema／基线／旧门禁盘点）

## 现状

- **质量判据无机械判法**：G1–G6 的语义在院方研究附卷 A §1，但仓内没有「标准件」把它落成可跑命令；
  人工判定不可复跑、不可比对、不可盯漂移。
- **能力 → 消费者无登记账**：`src/` 里的能力声明与生产消费者、测试之间的对应关系没有权威登记行，
  「声明了但没人用」只能靠人扫。
- **旧门禁无账（只加不减）**：锚 `gitea/local-main@6e5f321aa` 实测 —— pre-commit **12** 个组横幅、
  **33** 个检查点、**10** 条非编号 banner、CI **9** 步、`scripts/control-tower/` **32** 个 `check-*`／`verify-*`；
  其中 **6 个检查器 C10 复算为孤儿**（`wired_to=[]`），无人知道它们是否还在承重。
- 三处口径缺口（已登记 `GATE-INVENTORY.yaml` 的 `findings`）：组 11 无横幅（并入组 10）；
  `K12-13` 内容面耦合无命名检查点（由 CI ①c 覆盖）；E5 口径只含 `check-*`／`verify-*`
  （另有 27 个 `probe-*.ts` 与 67 个非 check/verify 脚本不在盘点面）。

## 决定

1. **标准 v1**（`docs/authority/quality-standard-g1g6.md`，DOC-0241）：G1–G6 每条五字段
   （判据定义／怎么判（机械）／红条件／证据要求／豁免条件）；**语义真源＝附卷 A §1，本件不重定义**；
   规则 `T1`–`T5` 的**唯一定义**在 #841 规格 §2.3-D3，标准只引用 ID ＋ 给命令（防两套口径）。
2. **登记表 schema**（`docs/authority/WIRING-REGISTRY.yaml`，DOC-0242）：schema ＋ **恰好 3 行**真实样例；
   行号现场复核；`--check-registry` 三态校验（末行 `REGISTRY-OK rows=3`）。**不编造消费者**。
3. **盘点表**（`docs/authority/GATE-INVENTORY.yaml`，DOC-0243）：**35 行**（G12 ＋ B9 ＋ X5 ＋ CI9）；
   32 检查器（`wired_to` 由 C10 机器复算）；`pairing` **5 行**覆盖 T1–T5（判据⑤）；`excluded_headers` **19** 条；
   id／行号／`label_hash` 一律来自枚举器 E1–E7，**禁手写**。本批只**标记** replace/retire，**不删任何门禁**。
4. **P0 零接线**：不改 `scripts/pre-commit-check.sh`、`.gitea/`，不新增任何阻断门禁；
   5 类扫描（T1–T5）只报告。将来门禁化必须走标准的「新门禁准入」四条（配对账 ＋ 判别力自证 ＋ 三态 ＋ E6 参考）。

## 依据

- **Issue #841**（四轮关卡 A 台账）｜**EPIC #836**｜院方研究**附卷 A §1**（G1–G6 语义真源）。
- **规格**：`.handbook/派单件/2026-10-23-规格-841-P4-P0-quality-gate.md`（§2.1 枚举器／§2.3-D1/D2/D3/D4 四件契约／
  §2.4 YAML 子集／§4 J1–J15 ＋ R1–R14／§8 失效条件）。
- **锚上实测**（`gitea/local-main = 6e5f321aab9bca8989de4f32d98e05a1400dbfd6`）：
  `E1=12`／`E2=33`／`E3=10`／`E4=9`／`E5=32`／`E7=24`（`excluded_headers = 24 − 5 = 19`；`rows = 12+9+5+9 = 35`）；
  C10 复算 `orphans=6/32`。全部数字由命令原始输出得到，未手写。
- **复用件**（禁重写）：`scripts/product-lines/productline_yaml.py`（零依赖 YAML 子集解析器，`parse:154`／`load_file:290`）｜
  `scripts/control-tower/gate-retirement-report.sh`（E6 只作参考：干净树无 `.claude/gate-hits.log` ⇒「无数据」）｜
  `scripts/control-tower/devdoc_writeset.py`｜`scripts/doc-system/doc-registry-gate.sh`。
- **口径更正（如实记录，不静默改）**：① 卡面「13 组」→ 锚上 **12** 个组横幅（组 11 并入组 10）；
  ② G6 基线里「登记件不变量」原标 `PC-G13`，锚上 C10 复算是 `CI-S3`（`PC-G13` 是技能同步一致性）⇒
  标准按**实测**写 `CI-S3`，**判据内容不变**；③ D4 样例 F1 的 evidence 写「E2 含 G11 名」，
  锚上实测 E2 的 33 名里 `G11` 命中 **0**（G11 检查点是 `warn_check`／`soft_pass`，不在 E2 的四函数口径内）⇒
  `findings.F1` 按实测改写。

## 生效时点

- **本 Note 状态 `proposed`**：决策**尚未落地**（四件仅在本批 PR 内；零接线）。
- **转 `implemented` 的门槛**：本批 PR 合并进 `gitea/local-main` 且 CI 全绿（pending=0）、独立复核通过后，
  `git mv memory/notes/proposed/2026-10-23-p4-p0-quality-gate.md memory/notes/implemented/2026-10-23-p4-p0-quality-gate.md`
  （状态迁移＝`git mv` 换目录，目录名即状态）。
- **失效条件**（详见标准「失效条件」节）：① 登记表填满 ≥90% 声明 ⇒ 删「3 行样例」条款；
  ② T1–T5 任一类成为阻断门禁 ⇒ 改写「只测量」表述与配对退役条款；③ G5／G6 机械判法建成 ⇒ 删「P1 只给探针」；
  ④ 连续 90 天 `totals` 无新增 ⇒ 提请降级为季度抽检；⑤ 枚举器 E1–E7 结构性变化 ⇒ 盘点表 `meta.counts` 作废、须重扫。
