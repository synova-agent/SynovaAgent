---
状态: implemented
日期: 2026-10-11
决策: D782 D2 登记门禁两处同改 —— ① base 链前置 `origin/local-main` ② `extensions/**` 内容 yaml 精度豁免（不含 `.md`）。依据：创始人 2026-10-11 裁定（第 1 步 ①②）。
理由: |
  事故：K12 批 2 三张 PR 的 CI **全部**在 step ①「13 组门禁」硬红，合并门条件①永不满足。
  实测（CI 等效仓逐字复现绿/红两侧）：
    · 红：`base=origin/main` ⇒ `merge-base(origin/main, HEAD)=5a6591c4a`（GitHub 旧 main，且 origin 账号已 suspended）
      ⇒ 源③ range 覆盖 `5a6591c4a..HEAD` 的 **73+** 提交（**不只本 PR 改动**）
      ⇒ 把他人已合并提交里新增的 .md/.yaml 一并索登记 ⇒ 每张 PR 恒红（run 116/121/125）。
    · 绿（local-main @ 22360836f1a）在同一基线下只扫到 2 件且都已登记 ⇒ 通过（不是"没跑"）。
  两处缺一不红——实测（独立复核四象限，我在三支逐一复现）：
    **只改 base 仍红**（K12-20/02/01 = 3/3、3/3、12/12）⇒ base 不是承重件；
    🔴 **只改 EXCLUDE 即绿**（三支均 `rc=0 (1/0)`）⇒ **EXCLUDE 豁免才是"红→绿"的直接且充分原因**。
    ⚠️ **上稿我曾断言「两处缺一仍红 ⇒ 须同时生效」，被独立复核证伪**（V-01 型：把两次不同 HEAD 的观测拼成普遍断言）。
    base 修正的**真实价值** = 收窄扫描面（4→1 件）＋ 登记边界不随他人提交漂移；
    其**副作用面** = 本地 `origin/local-main` 若陈旧至分叉点以下 ⇒ range 反而更宽 ⇒ 原病复现（实测 `检查 4/2 未登记 rc=1`）。
  故必须同时解决"内容件被当文档"这一语义错配：D2 语义是**文档台账**
  （`type ∈ [navigation…archive]`），而 `extensions/**/*.yaml|yml` 是**内容面数据/配置**，登记它不产生真相价值；
  逐条登记的反面代价与既有先例同型（源码内 `docs/synova/product-lines/evidence/` 注释：「逐条登记会使每个任务都要改
  **共享**的 DOCS-REGISTRY.yaml（写冲突机器）」）。
  豁免**精度**：只限 `^extensions/.*\.(yaml|yml)$`，**不含 `.md`** —— 扩展目录下的 `.md` 是说明文档，仍须登记。
  配对测试补 H5/H6 并验"改坏即红"：旧脚本跑新测试 ⇒ **20 通过 / 2 失败**，H5 **红 2 处**（无豁免）、H6 两版皆绿（豁免越界守卫）。
  （上稿写「18 通过 / 4 失败」是错的 —— 18 是**旧测试的例数**；旧脚本+旧测试实测 18/0。经独立复核指出后自纠。）

  🔴 **已知缺口（复核者指出，我确认，须另立卡）**：现有 22 例**无一**能区分 base 链是否前置 ——
  夹具靠**自带的 `main` 分支**解析 base ⇒ 改 base 链在夹具里是 **no-op**（用 base 变体跑全套仍 20/2）
  ⇒ **base 半支无回归护栏**。补法：临时仓构造 `origin/main` 与 `origin/local-main` **分叉**，
  在二者之间放一个未登记 `.md` ⇒ 前置 local-main 后 range 不应再含它（base 未前置则必红）。
---

## 决策上下文

来源：创始人 2026-10-11 开工令「第 1 步：修 D782（两处一起，缺一仍红）」，
判据：CI 三 PR 转绿（pending=0 才可断言）。

## 触发场景（实测，as_of `origin/local-main=8a0fea89f`）

| 项 | 实测 | 处置 |
|---|---|---|
| `doc-registry-gate.sh` base 链 | `origin/main → main → origin/HEAD` ⇒ 取到 `5a6591c4a` | 前置 `origin/local-main`（回退链保留） |
| `EXCLUDE` | 不含 `extensions/`；台账 `extensions/` 条目 = 0 | 增 `^extensions/.*\.(yaml|yml)$` |
| 批 2 三卡未登记数 | K12-20 = 3｜K12-02 = 3｜K12-01 段一 = 12 | 豁免后 ⇒ 0（扫到 0 件） |

## 同病复发计数（本仓已知三处）

① CI `vitest --changed` 基线 —— **已修**（`local-gates.yml` 用 `CHANGED_BASE=origin/local-main`）
② D791 push 门禁 D331 对账基 —— `pre-push-check.sh:423` 仍硬取 `origin/main`（**在飞**，见下）
③ 本项 D782 D2 —— **本次修**

## 未纳入本 PR（须 CTO 裁，已列清单）

`pre-push-check.sh:423` 的 `BYPASS_BASE` **不能照搬本次改法**：其 D508 注释记录真实副作用 ——
「分支 ref 为基时，merge main 后 main 侧新提交落入分支范围 → 它们没有也不该有本分支登记 → **误拦**」。
⇒ D331 的正确修法需同时处理「merge 进来的 main 侧提交」（D1152 的"他机已过闸"过滤**只按当前分支 ref**判祖先，
**覆盖不到**这一情形）⇒ 属**判据设计**变更，归 CTO。
