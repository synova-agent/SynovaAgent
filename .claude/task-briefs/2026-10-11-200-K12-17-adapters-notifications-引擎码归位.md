> **卡面来源**：库外档案仓同名片（CTO 亲撰）｜架构基准：产品宪章 v8.1｜纪律：缺字段问 CTO，不许猜


# Task Brief: #200 → K12-17（登记件 `1-12`）— adapters / notifications 引擎码归位

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：`extensions/` 里**不该有引擎代码**——把混进去的 `.ts` 搬回 `src/`。

**② 解决什么问题**：宪章**约束 4**：「内核与扩展的边界必须**物理可见**」——
 `extensions/` = 客户的（可改可删）｜`src/` = 我们的（客户不可见）。
 实测现在混装：`extensions/notifications` 有 **4 个 ts adapter**；`extensions/adapters` 有 **2 个 ts**（还 import `src/connectors/types`）。
 ⇒ 客户删一个"内容目录"可能把引擎功能删掉。

**③ 做完对项目的推动**：让"**客户的归客户、我们的归我们**"这条界**看得见**（而不是靠约定）。

**④ 不做行不行**：**不行**。边界不清 ⇒ 客户升级内核时不知道哪些能删；我们改引擎时也不知道会不会踩到客户内容。

**⑤ 现在有什么基础**：
 · ✅ 边界定义已裁（宪章 约束 4）
 · ✅ 目标位置已存在：`src/connectors/`、`src/notifications/`
 · ❌ 搬迁**未做**（.ts 仍在 extensions/ 下）

**⑥ 还需要做什么**：把 adapter `.ts` 搬进 `src/connectors/` 与 `src/notifications/`（**json 留原地**），
 保证**不回归**（原用例全绿）＋ 门禁防回归

**⑦ DSH 借鉴方式**：**参考自研**
 · ✅ 可借：**包只声明、不实现宿主能力**（`packages/webhook/webhook-github/src/index.ts:5` `import type {} from '@deepseek-ai/dsh-host-webserver'`）
   —— 插件只声明对宿主能力的**依赖（类型）**，**实现永远在宿主侧** ⇒ 同型：adapter 实现搬 `src/`
 · ✅ 可借：**目录即契约**（宪章 约束 4）

**⑧ 涉及代码文件**：`src/connectors/*.ts`、`src/notifications/*.ts`（搬入）｜`extensions/{adapters,notifications}/*.json`（留原地）


> 判据源: 登记件 `1-12` → `bash scripts/check-content-coupling.sh` expectExit 0 ｜ 依赖: K12-13 ｜ 等级 **A**

## Q0: 定位 宪章**约束 4**：内核与扩展边界必须**物理可见**。现 `extensions/` 里混着**引擎码**。
### b) 文件审计（实测）`extensions/notifications` = 5 json ＋ **4 ts adapter**（混装）｜`extensions/adapters` = 3 json ＋ **2 ts**（import `src/connectors/types`）。
### c) 决策 adapter.ts **搬** `src/connectors/` 与 `src/notifications/`；json 留原地。

## Q1: 调研
- **院方 §3.2-9/12**：notifications 拆（json＝配置｜ts＝引擎管道码）；adapters＝引擎（⓪连接器适配码）。
- **DSH 依据**：
  | 采纳 | file:line | 说明 |
  |---|---|---|
  | ✅ **包只声明，不实现宿主能力** | `packages/webhook/webhook-github/src/index.ts:5` → `import type {} from '@deepseek-ai/dsh-host-webserver'` | DSH 插件**只声明对宿主能力的依赖（类型）**，实现永远在宿主侧 ⇒ adapter 实现搬 `src/` |
  | ✅ **边界物理可见** | 宪章 约束 4（`extensions/`＝客户的｜`src/`＝我们的） | 目录即契约 |
- **memory 教训**：铁律 46（禁桥接代理）⇒ 搬迁是**真搬**，不建 import 代理。

## Q2: 范围
做什么：`src/connectors/*.ts`、`src/notifications/*.ts`（搬入）｜`extensions/{adapters,notifications}/*.json`（留）｜brief
不做什么：不改 `extensions/` 下 json 内容｜不改 `src/init/file-driven-loaders.ts` 的 adapter 接线语义（只改指向）｜不改 `scripts/audit/**`

## Q3: 验收
入口：原调用链（装配 + 运行时）处理：搬后路径重定向 结果：
- V1 `extensions/{adapters,notifications}` 下 **.ts 归零**
- V2 **不回归**：原用例全绿（穿生产入口）
- V3 CC1 通过：extensions 下若保留 .ts ⇒ import 只走包名/contracts/ALLOWLIST
- V4 反例：把引擎码放回 `extensions/` ⇒ CC1/CC4 **必红**


## 本卡在架构中的位置

```
  【下行流】企业 → 系统
    ⓪ 连接器（数据⓪-a / 人⓪-b）  ⟵ ★ **本卡在这里**
    ① 循环（动力学）
    ② 本体（结构）
    ③ 哨兵（观测）
    ④ 参数（护城河）
    ⑤ 导航（目标生命周期）
  【上行流】
    ⑥ 进化回环
    −1 运行时
  【横切】⊥ 断面层（取证断面）｜数据边界（合同）｜契约线（今天不建）
```

## 架构层: ⓪ 连接器（adapters）＋ 交付面（notifications）
#CRITERIA: D
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL）｜A 诊断 / B 导航 / C 接入与权限 / D 基建兜底 -->

## 写集
| 文件 | 类别 |
|---|---|
| `src/connectors/*.ts` | task（搬入） |
| `src/notifications/*.ts` | task（搬入） |
| `extensions/{adapters,notifications}/*.json` | task（留原地） |
| `.claude/task-briefs/2026-10-11-200-engine-code-归位.md` | task（本件） |

## Done 标准
- [ ] verify: `bash scripts/check-content-coupling.sh`（expectExit 0；登记件 `1-12`）
- [ ] verify: `npx vitest run tests/connectors tests/notifications`（回归面）
- [ ] verify: `npx tsc --noEmit`
- [ ] V1 原始输出：搬迁后 `git ls-tree extensions/adapters extensions/notifications`（.ts = 0）
- [ ] 卡上【读卡确认】+【交付】

---
