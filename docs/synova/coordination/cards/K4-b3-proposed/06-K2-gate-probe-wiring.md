# 卡面 · [gate] probe-cycle-edges 无任何自动执行链（恒绿隐患；与 #346 vacuous 绿同族）

> **卡面来源**：K4 批 3 独立复核 V-6（verifier 实测）｜**架构基准**：产品宪章 v8.1｜
> **机器真源**：`docs/synova/product-lines/evidence/K4-b3-VERIFY-238.md`（V-6 条）＋ `K4-b3-lead-closeout-20261012.md` §六
> **纪律**：缺字段问 CTO，不许猜｜**自建自报号**：编号待 CTO 分配（**门禁类**，前缀 `[gate]`）
> **挂称**：里程碑 = K2 · 写入门禁与工具治理｜执行态 = **未开工**｜阻塞源 = 无

---

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：给两个探针**挂上自动执行**——现在它们**只有人手跑才有约束力**，跑不跑没人知道。

**② 解决什么问题**（实测，`ba1b22a8b5`）：
```
$ git grep -n "probe-cycle-edges" -- scripts/pre-commit-check.sh .github/ .gitea/
（零命中）

引用面只有：
  · .claude/claims/*.yaml 的 verify 文本        （人手/CI 都不自动跑）
  · docs/synova/coordination/施工项登记.ts 的 {run, expectExit}
  · docs/ 与 evidence/ 的文档
而该登记件的消费方（check-registry-invariants.ts 等）**只校验登记、不执行 run:**
  （grep 其无 execSync / run: / expectExit）
```
⇒ **探针存在、判据有效、exit code 正确，但没有任何 check 会在提交/CI 时跑它**。
⇒ 结果：**判据只在"有人记得跑"时才生效** ⇒ 属 **恒绿隐患**（与 #346「`--cached` vacuous 绿」同族：
**门禁看着在，实际不判**）。

**③ 做完对项目的推动**：宪章 **§4.7 / 铁律 35**（自动化优先 —— "能写 check-*.sh 的不靠 review"）。
它是"K4 判据能自证"的**前置**：判据不自动跑 ⇒ 所有"探针 exit 0"的交付**只在交付当刻成立**。

**④ 🔴 不做行不行**：**不行**（结构缺口）——
理由：**判据不自动执行 = 判据不成立**（本批已实证：`#238` 的 probe 若被改坏，**没有任何门禁会红**）。
这不是"体验欠账"，是"**防线是否真实存在**"的问题。

**⑤ 现在有什么基础**（实测）：
- ✅ 判据物存在且有效：`scripts/control-tower/probe-cycle-edges.ts`（exit 0/1/2 三态清晰）、`probe-cycle-valves.ts`（同）
- ✅ 门禁骨架存在：`scripts/pre-commit-check.sh`（13 组，支持"注册一个 check"）
- ✅ CI 骨架存在：`.gitea/workflows/`（Gitea Actions）
- ❌ 两个探针**均无任何自动触发点**；❌ 登记件的 `run:` 字段**无人执行**

**⑥ 还需要做什么**：
① 选触发点（**pre-commit 组** 还是 **CI job**——CI 更权威；建议 **CI 为主 + pre-commit 轻量**）；
② 把 `probe-cycle-edges.ts` / `probe-cycle-valves.ts` 挂上（**exit ≠ 0 即红**）；
③ 顺带处置**登记件 `run:` 字段的"只登记不执行"**（要么执行，要么显式声明"仅文档"）；
④ 加**判别性证明**：故意改坏被检体 ⇒ 门禁必红（防"挂了但从不判"）。

**⑦ DSH 借鉴方式**：**参考自研** —— 借方向的**可借**：
「**包自带判据、宿主只保证"不生效就报错"**」（`@deepseek-ai/dsh-invariants/lib/index.js:6-13`）
⇒ 判据物自带，触发点由宿主保证 + **不生效就报错**（本卡正是补"宿主保证"这一半）。
❌ **不借** DSH 的宿主进程模型（我们是仓内 CI + git hooks）。

**⑧ 涉及代码文件**：
`scripts/pre-commit-check.sh`（**改它 = 门禁语义变更，须 CTO 另裁**）｜
`.gitea/workflows/**`（CI；**同上**）｜
`scripts/control-tower/probe-cycle-edges.ts`、`scripts/control-tower/probe-cycle-valves.ts`（**被挂载方，只读**）｜
`docs/synova/coordination/施工项登记.ts`（`run:` 字段处置）

---

## Q0: 定位 — 项目拼图 + 文件审计
**a) 在哪一块**：**K2 写入门禁与工具治理**（跨 K4 的内容面与门禁面）。
**b) 文件审计**：两探针存在且有效；`pre-commit-check.sh` 有 13 组可容纳；CI 有 `.gitea/workflows/`；**触发点零命中**。
**c) 结论**：**接线**（把已有判据物挂到已有触发点；**可能新建 1 个 workflow 或 1 个 check 脚本**）。

## Q1: 调研
**a) 业界**：判据必须**在 CI 里跑**才算判据；"文档里的判据" = 没有判据。
**b) 顶级团队**：所有 invariant 都在 CI 的必过 job 里；**失败即阻断合并**。
**c) 我们的错**：**铁律 35**（自动化优先）＋ 批 3 **V-6** 实证；
另与 **#346**（`--cached` vacuous 绿）**同族**：门禁存在但不判。

## Q2: 范围
**做什么**：给两个探针挂自动执行（CI 为主）；exit ≠ 0 ⇒ 红；并给"改坏必红"的判别性证明。
**不做什么**（**必须带路径**）：
```
不改 scripts/audit/**                    （K3 域，红线）
不改 scripts/control-tower/probe-*.ts    的判据逻辑（只挂载，不改判）
不改 src/** / cycles/** / extensions/**   （被检体；本卡只加触发点）
```
> ⚠️ **改 `scripts/pre-commit-check.sh` 或新增 CI workflow = 门禁语义变更 ⇒ 须 CTO 另裁**（本卡第一件事即取该裁定）。

## Q3: 验收 — 入口 → 交互 → 结果
**入口**：`git commit`（若走 pre-commit）或 CI 触发（若走 .gitea/workflows）。
**交互**：触发点调 `npx tsx scripts/control-tower/probe-cycle-edges.ts` / `probe-cycle-valves.ts` → 取 exit code。
**结果**：exit 0 ⇒ 绿；exit 1/2 ⇒ **红且阻断**。末行含两探针的摘要行。
**反例（判别性，必做）**：/tmp 沙箱改坏被检体（如把某条引用改成不存在的 `$id`）⇒ **CI/门禁必红**。

## 架构层: K2 写入门禁与工具治理（跨 ①/② 内容面；宪章 §4.7）

## 写集
```
scripts/pre-commit-check.sh          （若裁定走 pre-commit）
.gitea/workflows/<新>.yml            （若裁定走 CI；新建）
docs/synova/coordination/施工项登记.ts（`run:` 字段处置）
.claude/claims/<本卡号>.yaml
docs/synova/product-lines/evidence/K4-b3-probe-wiring-<日期>.md
```

## Done 标准
```
① 两个探针各有**可核的自动触发点**（贴触发配置原文 + 触发记录）
② **判别性证明**：改坏被检体 ⇒ 触发点**必红**（/tmp 沙箱；贴原始输出 + exit code）
③ 复原（口径 W）逐字节一致
④ 登记件 `run:` 字段：**要么执行、要么显式声明"仅文档"**（禁悬空）
⑤ 四元组：值 + 口径 + 时点 + 探针版本
```
⚠️ PR 正文须写 `Closes #<本卡 issue 号>`（号未分配前用 `Refs` 占位）。
⚠️ 本卡触及门禁语义 ⇒ **合并前须 CTO 复核**。
