---
状态: proposed（待独立审计后 git mv 到 implemented/）
日期: 2026-10-24
决策: "把「非平凡模块必须有 expected/snapshot」从形容词变成可查表判据：唯一真源落 tests/contract/triviality-manifest.yaml（schema_version＋meta＋entries；非平凡 ⇔ 有登记行且 surface ≠ none），配三态执行器 scripts/control-tower/check-test-obligations.py（0 满足或 SKIP ｜ 1 真红 ｜ 2 检查自身失败）；新增 src/** 走兜底 triage，存量走 legacy_baseline 棘轮（只减不增），obligation: exempt 须 issue＋expiry＋reason 且过期即红；纯重构逃生用 NoBehaviorChange trailer，且同提交改行为即失效；分层成文落 docs/authority/testing-layers.md（六档现役＋bench·web 显式未建不空转）。本 PR 只落判据底座，不接 CI（①g 归 PR-3／P4）。"
理由: "形容词判据不可判——「非平凡」「必须有资产」各人各解，PR 正文写两句就算过等于逼人造假；存量无法一次补完（src 规模用枚举命令现算，一次要求全补只会逼出豁免大赦）⇒ 必须棘轮只减不增，撤登记逃逸必红；「看不见」与「没问题」必须分开（清单 schema 非法／版本未知／base 不可解析／扫描根空 ⇒ rc=2，禁当通过）；门禁不得静默降级（降级走 degraded: 行＋SYNO_GATE_DEGRADED_LOG，铁律 11／32）。"
---

# #913 批 2 · PR-2 · Q-10 测试分层成文＋快照义务（决策 Note）

## 为什么本 Note 必须存在（门禁实况）

本批含 `scripts/control-tower/` 变更（新建 `check-test-obligations.py`）。`scripts/commit-msg-check.sh` 的
**D395-a／D534 Note 引用门禁**对治理脚本区变更**硬拒绝**：commit message 必须引用 `memory/notes/**.md`
且所引 Note **文件真实存在**（两层判据）。因此本 Note 是提交链路必需的实况件，不是可选留痕。

## 现状（改之前；数量一律给枚举命令，不手写）

- **无「非平凡」台账**：`git ls-files tests/contract/triviality-manifest.yaml` ⇒ 空（无输出）＝「必须补
  expected/snapshot」只存在于散文（提案 Issue 讨论），不可判、不可复跑。
- **无 expected 资产面**：`git ls-files tests/expected` ⇒ 空（无输出）；命名与义务都没有机读位置。
- **分层未成文**：`git ls-files docs/authority/testing-layers.md` ⇒ 空；bench／web 两档无载体
  （`git ls-files 'tests/bench/**' 'tests/web/**'` ⇒ 空）——「没建」与「建了但空转」在文档上不可区分。
- **无判据执行器**：`git ls-files scripts/control-tower/check-test-obligations.py` ⇒ 空 ⇒ 变更集触碰
  surface 模块却无资产时无人拦（只靠人眼）。

## 决定

1. **唯一真源落文件**：`tests/contract/triviality-manifest.yaml`（`schema_version` ＋ `meta.as_of`／`meta.ruling`／
   `meta.legacy_baseline` ＋ `entries[]`）。判据**纯查表**：非平凡 ⇔ 有登记行且 `surface ≠ none`；
   禁止口述表／禁止第二本账（与 `docs/authority/testing-layers.md` 冲突时以清单＋执行器输出为准）。
2. **清单版本化**：`schema_version` 变更须**同 PR** 改清单；执行器遇未知版本 ⇒ **rc=2**（fail-closed，不猜）。
3. **新增兜底**：变更集**新增** `src/**/*.ts` 且有效逻辑行（去空行/注释）≥100 且 ≥1 个 `export`
   ⇒ 必须有 triage 行（`surface` 任意或 `surface: none`＋理由），否则 `untriaged:` 红。
4. **存量棘轮**：未登记 = `legacy`；`meta.legacy_baseline` **只减不增**（当前数 > baseline ⇒ 红；
   `--write-baseline` 只许**降到**当前值）⇒ 防「删登记行逃逸」。
5. **豁免与失效**：`obligation: exempt` 必须带 `issue`＋`expiry`＋`reason`，**过期即红**（清单级，不吞
   缺资产/命名等其他判据）；纯重构逃生 = commit message 成行出现 `NoBehaviorChange: <理由 ≥10 字>`，
   但同提交对该模块**新增行**含 `export `／`if (`／`switch (`／`case ` 任一 ⇒ **trailer 失效即红**。
6. **分层成文**：`docs/authority/testing-layers.md` —— 六档现役（unit／integration／e2e／acceptance／
   contract＋门禁自证／snapshot-replay）＋ bench·web 显式标「**未建不空转**」；含义务／命名（S9 三条禁则）／
   豁免／失效条件四节。**G1–G6 只引不复制**：唯一定义 = `docs/authority/quality-standard-g1g6.md`（DOC-0241）。

## 已知限制（继承执行器「已知限制」节要点）

- **T1 是文本级判据**：`export `/`if (`/`switch (`/`case ` 按新增行**字面**匹配（注释/字符串里的同名片段也命中
  ⇒ 宁可误红）；反向「行为改了但新增行零 token」（如只改表达式常量）**抓不到** ⇒ 细粒度语义归 L1 复核。
- **YAML 子集解析**（不依赖 PyYAML）：只收顶层键／flow map／block map／标量／`#` 注释；超出子集 ⇒ **rc=2**。
- **O1 只看「有没有资产文件」**，不判资产内容真伪（内容质量归 PR-3 ①g／独立复核）。
- **只判 committed 变更集**（`merge-base..HEAD`）：未提交/未暂存改动不在视野（本地「改了没 commit」会 SKIP，
  这是口径不是漏判）。
- **本 PR 不接 CI** ⇒ 暂无阻断面（接线归 PR-3 ①g／P4）；`SYNO_TEST_OBLIGATIONS=off` 是唯一整体关闭开关。

## 判据（S1–S11）

逐条定义见规格（**只引路径，不复制全文**）：
`.handbook/派单件/2026-10-24-规格-913-PR2-分层与快照实施.md` §4 表（S1–S11）。可复跑入口：

```bash
python3 scripts/control-tower/check-test-obligations.py --base gitea/local-main
python3 scripts/control-tower/check-test-obligations.py --selfcheck
bash tests/control-tower/check-test-obligations.test.sh
```

## 依据

- **规格（唯一判据准绳）**：`.handbook/派单件/2026-10-24-规格-913-PR2-分层与快照实施.md`
  （§1 写集／§2 非平凡／§3 义务算法／§4 判据／§9 边界与风险）
- **裁定**：裁 353（批准；DOC 登记／trailer 形式／`--changed gitea/local-main`）｜裁 332 ①②③（manifest 落点等）｜
  裁 331（#913 批 2 总批）
- **权威件**：`docs/authority/quality-standard-g1g6.md`（DOC-0241，G1–G6 唯一定义）｜
  `docs/authority/testing-layers.md`（DOC-0265）｜`tests/contract/triviality-manifest.yaml`（DOC-0266）
- **兄弟件**：`gate-exemptions/2026-10-24-p7-913-pr2-docs.md`（DOC-0267，受保护路径豁免，裁 331）

## 生效时点

本 PR 合入 `local-main` 起：清单（`triviality-manifest.yaml`）与分层成文（`testing-layers.md`）生效；
扫描器默认开（`SYNO_TEST_OBLIGATIONS` 未设 = on），但**本 PR 不接 CI** ⇒ 当前只有本地／PR 复跑面，
**无 CI 阻断面**；接 PR-3 ①g（归 P4）后才成为 CI 硬阻断。回滚＝`git revert` 单提交
（改动面见规格 §6，零运行时耦合）；脚本级 `SYNO_TEST_OBLIGATIONS=off` 为唯一整体关闭开关。
