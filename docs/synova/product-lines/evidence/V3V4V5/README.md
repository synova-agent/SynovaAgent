# V3+V4+V5 · 46 项判据契约修复 —— 证据包

> 施工项：`docs/synova/coordination/施工项登记.ts`（blob `95d97801f`，48 项 / 46 活跃 / 12 块；**本卡为唯一写者**）
> 分支：`docs/V3V4V5-criteria-contract` ｜ base：`docs/D1144-registry-unbundle`（**栈式 PR**，见 PR 正文）
> 基线 ref：`origin/docs/D1144-registry-unbundle @ ff5f1caad`（判据件实况与 `origin/main @ 74eb6c44c` **逐行一致**）
> 本包内一切数字均由脚本产出，**禁手写**（判例 S-01③）。

---

## 一、口径（逐条可复跑）

四条判据针对 **46 个活跃项**（`status === 'todo'`）逐条判：

| 判据 | 定义 | 本包实测 |
|---|---|---|
| **A** 判据须落本项写集内 | `acceptance` 命令里出现的每个文件路径，必须等于 `paths` 中某项、或其子路径、或匹配 `paths` 的通配 | 严格口径（含 `data/**`）**39/46**；S5 口径（不含 `data/**`）**41/46 + 5 n/a** |
| **B** 修复前 baseline 上须红 | 在未修复基线上跑该判据，须**以断言失败的方式**红（exit≠0） | **0/46**（6 项实测全绿；40 项判据件缺失，**判不了**） |
| **C** 须在出货姿态成立 | 判据须在干净检出/CI 姿态可跑可判（不依赖 gitignored 运行时状态） | **7/46** |
| **D** 须有「改坏即红」夹具 | 该判据须附「把实现改坏则判据转红」的夹具 | **n/a** —— 由 fixtures 路承担，本卡不碰 |

> B 的 40 项记 `unrunnable`（**既不算红也不算绿**）；把它们记成"通过"或"红"都是编造（判例 V-09）。

---

## 二、三档报数（派单裁决口径，N+M+K = 46）

| 档 | 含义 | 项数 | 明细 |
|----|------|------|------|
| **①** | 判据件在 ref 且**已实跑**（L2） | **6** | `0-5` `0-7` `0-10` `1-7` `2-4` `3-12` |
| **②** | 判据已**改指向 ref 现有物**（V4(b) 真修复） | **1** | `1-1`（phantom path → 存在的 GS-08 场景执行器） |
| **③** | **降级 L1 + 显式「未验」** | **39** | 其余全部 |
| | 合计 | **46** | — |

🔴 **①档 6 项的 B 实测为 `green`**（未修复基线上 exit 0）⇒ **B 不成立**：判据不能区分"未修 / 已修"，
故这 6 项**同样带「未验」声明** —— 标 `L2` 只表示"可跑"，**不表示判据已成立**。

---

## 三、本卡做了什么（逐项，可核）

1. **V5 · 新增 `verifier` 字段**（schema + JSDoc + 48 项取值）
   - 语义：`worker` = 派给谁做（实现者）｜`verifier` = **判据由谁落地**（核验者）—— 必须 ≠ 实现者（判例 V-03）
   - 取值规则依据 **TASK-ROUTING v4 §一「模块所有权表」**，实现在 `assign-verifier.codemod.mjs`
   - 实测：**抽样 10 项 `verifier !== worker` = 10/10 = 100% ≥ 80%**（`v5-verifier.md`）
2. **新增 `verification` 字段**（每项 `L1/L2` + B 实测 + 证据指针 + **未验声明**）
   - 硬约束：`status==='todo'` 且 `level==='L1'` ⇒ `unverified` 必须非空且含「未验」字样（机器可查）
3. **A 修复 3 项**：`0-5` / `2-4` / `3-12` 的判据件并入本项写集（原 A=N）
4. **V4(b) 真修复 1 项**：`1-1` 的判据路径 `scripts/golden-scenarios/run.sh` 是 **phantom path**
   （`git log --all --diff-filter=A` 零命中 ⇒ 从未在任何 ref 存在）⇒ 改指本 ref 存在的
   `scripts/golden-scenarios/GS-08-report-readable/run.sh`

**未改 acceptance 的实质内容**：36 步的判据件仍指向"本卡创建"的交付物 —— 它们**属未建交付物**，
不由本卡伪造（判例 P-03：禁把判据改成"存在即可"的永远真断言）。

---

## 四、例外清单（本卡**没做到**的，主动列）

1. **V4(a)「补判据件」未执行 —— 结构性越界，不照做。**
   36 步引用的判据件落在 `scripts/control-tower/probe-*.ts/.sh` 与 `tests/**`；
   本卡写集 = `docs/synova/coordination/施工项登记.ts` + `docs/synova/product-lines/evidence/V3V4V5/`，
   且派单纪律明文禁改 `scripts/**`、D 夹具归 fixtures 路 ⇒ **补判据件越出槽界**。
   按判例 P-01（派单方配方同样要被执行方核）报回：需要一个拥有 `scripts/**` + `tests/**` 的槽。
2. **完成判据 `git cat-file -e origin/main:<判据件>` 覆盖 46/46 —— 本次达不到。**
   实测只到 **7/46**（6 项原有 + 1 项本卡改指向）。余 39 项的判据件**属那些卡自己的交付物**，
   需那些卡执行后才落 ref；且其中 **7 项判据依赖 gitignored 的 `data/synova.db`**，
   `origin/main` **结构性不可能**存在该路径 ⇒ 该判据对至少 7 项**永远不可满足**，须改判据形态。
3. **B 满足率 0/46，本卡无法提升。** 6 项可跑的判据在基线上全绿；要让它们"修复前必红"，
   须补**区分性断言**（新写/改测试文件）—— 同上越界，交还拥有 `tests/**` 的槽。
4. **5 步纯 grep 型判据未改写**（`0-6` / `0-11` / `0-12` / `2-3` / `3-5`，判例 V-02 违规）。
   未改理由：改成 `expectRowsGt` 之类只是**去 grep 字样**，实质缺陷（无执行引擎、依赖 gitignored 数据）不变
   ⇒ 属"化妆式修复"，不如显式记录为违规（已在各 `verification.note` 标注）。
5. **`1-1` 改指向后未能实跑**：本会话沙箱下 `npx` 日志路径解析成 `/tsx.log` 被拒（`Operation not permitted`），
   `fresh-db.ts` 直跑正常 ⇒ 记 `L1 / unrunnable / 未验`，**不记为红/绿**。
6. **D 判据（改坏即红夹具）0/46 —— 归 fixtures 路**，本卡不碰（派单明文）。

---

## 五、🔴 「未验」声明清单（判例 V-09）

**全部 46 项都带 `unverified` 声明**（含 ①档 6 项）—— 因为**没有任何一项的 B 判据成立**。
逐项声明见 `per-item.md` 的「结论 / 未验声明」列，与登记件 `verification.unverified` 字段**同源**（机器生成）。
机器可查：

```bash
$ node --experimental-strip-types -e "
  const m = await import('./docs/synova/coordination/施工项登记.ts');
  const t = m.constructionItems.filter(i=>i.status==='todo');
  console.log('todo', t.length, '| 带未验声明', t.filter(i=>i.verification.unverified).length);"
todo 46 | 带未验声明 46
```

---

## 六、本包文件

| 文件 | 内容 | 生成方式 |
|------|------|----------|
| `per-item.md` | 46 项逐条体检表（id/verifier/L1-L2/A/B/C/判据引用/未验声明） | 机器生成（禁手改） |
| `v3-baseline-run.md` | B 实测：未修复基线上逐项跑 + 合并跑原始输出 | 原始命令输出 |
| `v4-criteria-existence.md` | 判据件存在性：49 条引用的 `git cat-file -e` 原始输出 | 原始命令输出 |
| `v5-verifier.md` | `verifier` 字段语义 + 赋值规则 + 抽样 10 项实测 | 原始命令输出 |
| `analyze.ts` | 可复跑体检器（A/B/C/D + 汇总计数） | 源码 |
| `v5-verifier-sample10.ts` | 抽样 10 项判据脚本（exit 0/1 可机器判） | 源码 |
| `assign-verifier.codemod.mjs` | `verifier` 取值规则的可复核实现（追加入登记件的那一次变换） | 源码 |

**复跑全包**：

```bash
cd <repo>
EV=docs/synova/product-lines/evidence/V3V4V5
node --experimental-strip-types $EV/analyze.ts --ref origin/docs/D1144-registry-unbundle
node --experimental-strip-types $EV/v5-verifier-sample10.ts
```
