---
状态: proposed
日期: 2026-10-07
决策: 密封面测试清单由「登记制」改「发现制」（发现面内自动纳入执行）；纯文档 PR 补 merge 级文档登记对账（#1215）
理由: ① 登记制使新增测试必须逐条写进 ci.yml 才被执行（D526 定罪形态），且同一 65 条清单在 ci.yml 内复制两份（漂移温床）；② docs-only 早退让纯文档 PR 绕过提交端 D782/D2 登记门禁（K3 物理复现 rc=0），需在能读完整 diff 的 CI 层补对账
---

# D1206 — 密封面发现制（D-F/②）+ 纯文档 PR merge 级登记对账（#1215）

- 状态: proposed（2026-10-07，治理线 B）
- 卡: #1227（D-F 登记制→发现制）· #1215（CT-34 上界）· 父卡 #1221（门禁减法与提速 v2.0）
- 关联文件: `scripts/control-tower/sealed-tests.sh`（新建，发现制唯一权威）·
  `scripts/control-tower/gate-integrity-baseline.txt`（段义改「隔离台账」+ 双棘轮）·
  `.github/workflows/ci.yml`（两腿取数单源 + #1215 step）

## 一、判据变更点：登记制 → 发现制

| | 旧口径（登记制） | 新口径（发现制） |
|---|---|---|
| 执行集来源 | 必须逐条**写进 ci.yml**（两份 65 行字面清单） | `sealed-tests.sh --list` = 发现面扫描 − 隔离台账（ci.yml 两腿共用一份） |
| 新增测试 | 零登记 ⇒ **永不执行**（须人工登记进 ci.yml） | 面内新增 ⇒ **零登记自动纳入执行** |
| 排除某测试 | 从 ci.yml 删除该行（无留痕语义） | 写进 `gate-integrity-baseline.txt` [R] 段（= 隔离台账，留痕 + 受棘轮约束） |
| 删除测试 | 无判据 | **红**：面实况 < `FACE-TOTAL`（须同批显式下调） |
| 新增隔离 | 无判据 | **红**：隔离条目数 > `QUARANTINE-TOTAL`（须同批显式上调） |
| 登记闸判定 | 路径出现在 ci.yml 全文 | 执行集 ∪ ci.yml 字面登记（跑在别处 job 的测试可字面声明） |
| 失败方向 | 面内漏登记 ⇒ 静默不执行 | 面为空/删测试/台账失效 ⇒ **fail-closed 红**（绝不"没测试要跑"当绿） |

**行为等价性实测**：新执行集（`--list`）与旧字面清单**逐字相同**——双方均为 66 条，`comm` 双向差集为空
（`bash scripts/control-tower/sealed-tests.sh --list | wc -l` = 67 = 66 + 本卡新增夹具，面内自动纳入）。
窗口内执行时间不变（同一批测试），变化的只是"清单从哪来"。

## 二、判据变更点：#1215 纯文档 PR 的 merge 级登记对账

**旧口径**: docs-only PR 在 `quality` job 早退（跳过 Iron Laws = 提交端 D782 的 D1 truth + D2 登记门禁）
⇒ 未被登记的 `docs/*.md`／根级 `.md` 可零检查入库（K3 物理复现：探针 + `SYNO_CI=1` ⇒ rc=0）。
**新口径**: `quality` job 内新增 step `Docs registry reconciliation (docs-only PRs, #1215)`，
`if: docs_only == 'true'` ⇒ 跑 `scripts/doc-system/doc-registry-gate.sh`（按 `base..HEAD` 新增文档对账
`docs/authority/DOCS-REGISTRY.yaml`）；未登记 ⇒ step 红 ⇒ **必需 context 红（merge 级阻断 + 逐个点名文件）**。
非 docs-only PR **不重复跑**（它们已在 Iron Laws 的 D782 块内硬阻断）。
排除面（生成物/历史区/审计报告/证据区等）沿用该脚本既有 EXCLUDE，不改判据本体。

## 三、回滚方式

- 发现制：`git revert` 本 PR 即回到"ci.yml 内两份字面清单"（无数据/状态迁移；`sealed-tests.sh` 独立文件，删即可）。
- #1215：单 step 删除即回到旧行为（纯文档 PR 无 merge 级登记对账）；`doc-registry-gate.sh` 本体未改。
- 半回滚（推荐路径）：发现制保留 + `FACE-TOTAL`/`QUARANTINE-TOTAL` 调整（棘轮数值即旋钮，改注释行即可）。

## 四、退出条件 / 复活条件

1. 若发现面执行集在 CI 上出现"该跑没跑"（面内测试被静默漏执行）连续 2 次 ⇒ 关闭发现制回滚到字面清单。
2. 若 `#1215` 对合法文档产生误拦（例如新根级 .md 被要求登记但语义上属临时件）⇒ 优先扩 `doc-registry-gate.sh` 的 EXCLUDE（判据本体改动需 K3），而不是关掉 step。
3. 面扩容（新增发现面目录）= 改 `sealed-tests.sh` 的 `SEALED_FACES` 一行 + 同批上调 `FACE-TOTAL`（可见、可审）。
