---
状态: implemented
日期: 2026-10-18
决策: 「四条件自合」由人判改为一条命令机器判（① CI 全绿 pending=0 ② 零写集重叠 ③ 已过独立复核 ④ 串行），末行恒为 `CAN-自合并` / `NO: <条件>` / `degraded: <原因>`，三态退出码 0/1/2；③ 本批单轨 T1，通过必须写 `③=ok(attested)`（禁裸形态）。
理由: 四条件此前靠人判＋人转述，没人能自证"我能不能合"（判据件不存在：`git ls-tree -r --name-only gitea/local-main -- scripts/control-tower/check-merge-conditions.sh | wc -l` ⇒ `0`）；且"看不见"曾被误当"没问题"——无 CI 的提交被 Gitea 报成 `{"state":"pending","total_count":0,"statuses":null}`，若只判"state≠failure"就会判绿。机器判 ＋ 判别力自检（`--selfcheck` 改坏必红）把"判错"与"看不见"都当场暴露（铁律 35；根 `AGENTS.md` §8 三态退出码与判别力自检口径）。
---

# P7-1 交付：四条件自证检查器（`check-merge-conditions.sh` · Issue #582）

## 现状（改之前）

- **判据件不存在**（复跑即得，勿信本行）：
  - `git ls-tree -r --name-only gitea/local-main -- scripts/control-tower/check-merge-conditions.sh | wc -l` ⇒ `0`
  - `git ls-tree -r --name-only gitea/local-main -- tests/control-tower/check-merge-conditions.test.sh | wc -l` ⇒ `0`
  - `git ls-tree -r --name-only gitea/local-main -- docs/synova/reviews | wc -l` ⇒ `0`（回执落地目录亦不存在）
- **四条件靠人**：Gitea 原生 review 通道从未被使用（`GET /repos/synova-agent/SynovaAgent/pulls/<N>/reviews` ⇒ `[]`，规格 §3 F2）；合并依据记在 handbook 由人转述，无机器凭据。
- **最危险假设未拦**：「无 CI 的提交」被 Gitea 报成 `{"state":"pending","total_count":0,"statuses":null}`（规格 §3 F4）⇒ 只判 `state != failure` 会把"看不见"判成绿。
- **PR 的 `base.sha` 不可当分支点**：Gitea 会把 `base.sha` 刷成当时 tip，而 `git merge-base --is-ancestor` 实际不成立（规格 §3 F5）⇒ ④ 必须用 `merge-base`。

## 决定

- **新建 `scripts/control-tower/check-merge-conditions.sh`（W1）**：四条件编排 ＋ `--selfcheck`；三态退出码 `0` 全绿／`1` 至少一条红／`2` 检查自身失败（API 不可达、HTTP≠200、refs 取不到、**CI 信号量==0**、`--offline`、参数非法）。降级一律 stderr 一行 `degraded: <原因> [code=<CODE>]` ＋ `SYNO_GATE_DEGRADED_LOG` 追记，绝不当绿。
- **四条件口径照规格 §4bis（未自行改）**：
  - **①** 绿 ⇔ HTTP 200 ∧ `state=="success"` ∧ `total_count≥1` ∧ 无 `pending/failure/error`；`total_count==0` ⇒ **exit 2**（"看不见"≠"没问题"）；红则逐条点名 `context=status`。
  - **②** 本 PR 文件集 ＝ `git diff --name-only <merge-base> <head>`，与**在飞 open PR 的实际 diff 文件集**两两比对（分页拉全，禁 `--limit` 饱和）；任一交集非空 ⇒ 红并点名 `<文件> → PR#a,#b`；open PR 列表或任一 ref 取不到 ⇒ **exit 2**（fail-closed）。
  - **③** 本批**单轨 T1 `attested`**：回执 `syno-review-receipt/v1` ＋ 补丁指纹 ＋ 时序，R1–R9 逐条机器判；通过恒输出 **`③=ok(attested)`**（裁 B3-1：级别后缀不许省）。指纹 ＝ `sha256(git diff --no-color -M --full-index --binary <mb> <head> -- . ':(exclude)docs/synova/reviews/**')`；`proven`（Gitea 原生 review）**只写规格、未批未实现**（B6-a ⏸）。
  - **④** S1 用 `git ls-remote gitea refs/heads/<base>` 取**远端真值** ＋ `merge-base --is-ancestor`（禁本地 stale ref）；S2 就绪集 ＝「①∧②∧③∧S1 全绿」者中编号最小者，本 PR 须为队首（缺回执者不进就绪集 ⇒ 不阻塞他人，避免死锁）。
- **新建 `tests/control-tower/check-merge-conditions.test.sh`（W2）**：CT-40 强制配对件。12 判定点（A 全绿基线／B ①／C ②／D1–D4 ③ 四型／E ④S1／F CI 信号量==0／G ④S2／H 身份未分离仍绿＋`warn`／I open PR 不可达），每子例**独立**夹具仓 ＋ `SYNO_MERGE_COND_FIXTURE` 注入，**同时**断言 `inner_exit` 与末行文本（只比 exit 会漏"红错条件"）；另覆盖 C2 边界（`total_count=0`、success 与 pending 并存点名 context、回执 fp 差 1 hex 且以 63 hex 前缀证明禁前缀匹配、`checks=4`、PR 取不到、`--json`＋`--selfcheck` 互斥、`--offline`、head 取不到）与只读证明。
- **新建 `docs/synova/reviews/README.md`（W3）**：③ 回执格式（`syno-review-receipt/v1` 逐字段）／指纹定义／R1–R9／生成流程（只走路径二，路径一本批未启用）／Known Limitations。
- **不接 CI**（规格 §1.2 ＋ CTO 令②）：本件只产本地/人判判据，`.gitea/**` 一行未动；WIRE CHECK 由 `--help` 参数完备 ＋ `--selfcheck` 12 判定点替代自证。
- **W3b 跳过**：`docs/authority/DOCS-REGISTRY.yaml` 的 1 条登记待裁 B6-b，本批**未改台账**（README 内已登记该差额）。
- 本 Note 即该非平凡变更的决策沉淀（铁律 49；commit-msg 门禁要求引用）。

## 依据

- **冻结 dev doc**：`docs/plans/codex/implementation/SYNOVA-IMPL-582-merge-conditions-20261018.md`（blob `a22509208b08fa6a`；`git rev-parse HEAD:<path>` 现场复跑即得）。
- **创始人 2026-10-18 五裁**（附录 B）：**B1 批**（W2 写集扩 1 行，CT-40 铁律）／**B2 确认**（④ ＝ S1 ∧ S2，S1 必用远端真值）／**B3 接受带两硬条件**（① 不许把声明显示成证明 ⇒ `③=ok(attested)`；② 局限必须落 README 的 Known Limitations ＋ C3）／**B4 追认**（Issue #582 自建）／**B5 不批**（`--offline` 不引本地 CI 缓存 ⇒ ① 恒 exit 2）。
- **域守则**（本次显式 read）：`scripts/control-tower/AGENTS.md`（三态退出码／失败给具体失败点／改坏必红留档）｜`tests/control-tower/AGENTS.md`（新增 `check-*` ⇒ 断言同步；测试非空壳）｜`docs/AGENTS.md`（数量给枚举命令）｜`memory/notes/AGENTS.md`（四态 Note）。
- **既有约定复用**（不重复建设）：三态退出码／`degraded:` ＋ degraded log／UTF-8 强制（D732）／判别力自检；CT-40 配对规则（`scripts/control-tower/ct-test-gate.sh:18`）。既有门禁件（`verify-parallel.sh`／`check-dev-doc-write-set.sh`／`devdoc_writeset.py`／`merge_writeset_gate.py`／`check-board-truth.ts`／`ct-test-gate.sh`／`pre-commit-check.sh`）**只读复用，一行未改**。
- **实跑证据**（`as_of` 本批工作树 `d64fa879f`；输出原文，禁截断）：
  - `bash scripts/control-tower/check-merge-conditions.sh --selfcheck` ⇒ exit `0`，末行 `SELFCHECK-OK: 12/12`
  - `bash tests/control-tower/check-merge-conditions.test.sh` ⇒ exit `0`，末行 `结果: 12 通过, 0 失败`
  - `bash scripts/control-tower/check-merge-conditions.sh --pr 558` ⇒ exit `1`；真实仓证据：`② … ok (比对 13 对，0 处文件重叠)`、`③ … no (fp=22c39c019020)` ＋ `R1 缺回执`、`④ … no (S1=no S2=ok 就绪集=空)` ＋ `S1 tip 23a4f5a38 不是 head 祖先（落后 88 commits）`；机器行 `MERGE-COND: no ①=ok ②=ok ③=no ④=no`；末行 `NO: ③ 已过独立复核, ④ 串行`
  - `--pr 558 --json | python3 -m json.tool` ⇒ `JSON-OK`（stdout 仅 JSON，含 `tool/pr/base/tip/head/fp/conditions/verdict/exit`）
  - `--pr 558 --offline` ⇒ exit `2`，`degraded: --offline 无 CI 真值（不引本地缓存，裁 B5） [code=E_CI_OFFLINE]`
  - 只读：以上全部运行前后 `git status --porcelain` 仅本次交付的新文件，无被写文件（DS-10）

## 生效时点

- **随本 PR 合并生效**：`bash scripts/control-tower/check-merge-conditions.sh --pr <N>` 成为四条件的判据入口；CT-40 此后对 W1 强制跑 W2（缺配对/测试红 ⇒ 阻断）。
- **失效条件（规则级）**：仓库改用**原生合并队列**时，③ 的 T1 回执机制与 ④ 的 S2 队首逻辑退役，保留 ①②（S1 仍按新基线判）；🔴 ② 零写集重叠**不在退役范围**——合并队列不阻止两个 PR 改同一文件。② 自身仅当仓库提供**按文件的并发锁**并由门禁强制执行时才可退役。撤除动作：删 W1／W2／W3，并在 `agents/P7-交付自证与真值/AGENTS.md` 记一次口径变更（判据真源归 CTO）。
- **前提变更不得带病续跑**：CI 换多 workflow（status context 名变化）⇒ 必须重跑 `--selfcheck`；Gitea 若把"无 status"改报 `state:unknown` ⇒ 必须同步 F4 的 exit 2 判据，否则"看不见"会被判绿。

## 已知限制（Known Limitations）

1. **③ 的"独立"只有 attested 级**：T1 能保证「回执与补丁指纹绑定 ∧ 回执之后无代码改动 ∧ reviewer≠author 的**声明**」，改码不重做复核必红；但「作者冒用 reviewer 名」**抓不到**（R9 只告警，不阻断）。`proven`（Gitea 原生 review，author≠login ∧ `commit_id==head`）**规格已写、未批未实现**（B6-a ⏸）；批了也不许两套并存。
2. **② 只比"文件路径"，不比内容**：两个 PR 改同一文件的**不同行**仍判重叠（有意 fail-closed，减少误放行）。
3. **① 只认 CI 的最终态**：不判"这次红是不是存量红"（那属 `check-ci-stale-red.sh`）；`--offline` 时 ① 恒 exit 2，**不引本地 CI 缓存**（裁 B5：缓存过期即产假绿）。
4. **④ 的 S2 依赖各 PR 的 ①②③ 可判**：缺回执的 PR **不进就绪集** ⇒ 不阻塞他人（有意，避免死锁）；「本 PR 是队首」只等于"同时刻没有更小的就绪者"，不等于"本 PR 好"。
5. **③ 身份矩阵是 `as_of` 快照，现场已变**：规格 §3 F2／§4bis ③-0 记的是 `synova`(id 1) 与 `win-push`(id 3) 两账号；**本批现场实测 `git remote get-url gitea` 内嵌 token 身份 ＝ `win-push`(id 3)**，不是 `synova`(1)。复跑：`SYNO_TOK=$(git remote get-url gitea | sed -E "s#.*x-access-token:([^@]+)@.*#\1#")`；`curl -s -H "Authorization: token $SYNO_TOK" ${SYNO_GITEA_API:-http://127.0.0.1:3000/api/v1}/user`。矩阵一变，③ 的升级前提（B6-a）须重核。
6. **W3b 未落**：`docs/synova/reviews/README.md` **未登记** `docs/authority/DOCS-REGISTRY.yaml`（B6-b 未批，本批按裁跳过）。现场登记门禁因按 **basename** 匹配（`README.md` 撞上台账里一条无关路径）而放行 —— 这是规格附录 B-6 记过的**门禁漏洞**，不属本件；转 P4 另批，本件不动台账。
