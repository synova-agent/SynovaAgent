<!-- 卡面来源: 库外档案仓 K12-一致性线-卡面全套.md（CTO 亲撰）
     架构基准: 院方 产品宪章.md v8.1（§0.4 ＋ §4.1 ＋ §5.6/5.7）
     机器真源: docs/synova/coordination/施工项登记.ts 的 K12 块（本站 id=K12-15）
     纪律: 执行 session 只从本文件取施工信息；缺字段 ⇒ 问 CTO，不许猜 -->

# Task Brief: #198 → K12-15（登记件 `1-10`）— reload 重扫 extensions/

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：**改了内容不用重启**——运行中新增/修改内容文件，系统能立刻发现。

**② 解决什么问题**：现在装配只在 **boot** 发生 ⇒ 改 `extensions/` 必须重启进程。
 对"建档后立刻让员工用起来"是硬障碍：建档生成配置 → 要么重启（中断服务）→ 要么等下次。

**③ 做完对项目的推动**：让"**建档 → 立刻可用**"成立（一致性第②层的体验前提）。

**④ 不做行不行**：**可以做，但代价明确**：每次建档/改配置都要重启。
 ⇒ 判定：**不是安全底线，是体验与运维成本**。优先级低于上线闸与探针批，但仍要做（否则"加文件即生效"只是半句真话）。

**⑤ 现在有什么基础**：
 · ✅ 装配路径清楚：`src/init/file-driven-loaders.ts` 已接 **9 路**
 · ✅ 解析逻辑可复用（reload 复用同一套解析）
 · ❌ `src/deploy/content-reload.ts` **不存在**

**⑥ 还需要做什么**：重扫 extensions/ ＋ 解析 ＋ 重新绑定（**失败隔离**：坏内容拒绝绑定但不阻断）＋ 测试

**⑦ DSH 借鉴方式**：**参考自研（三机制借、代际不借）**
 · ✅ 借 **早激活**（boot 全量解析，失败在**选择前**暴露）、**失败隔离**（degraded 留清单、拒新绑定、不阻断启动）、
   **标识持久化**（会话记录内容项版本，供 ⑥ 进化读）—— 均见 `内容面规范 §5.3`（DSH 三机制）
 · ❌ **不借**：DSH 注册表的**代际机制**（编辑释放 Loader 会撤销运行中 Agent 的工具）——
   它服务于**在线编辑**；我们无该需求 ⇒ **不继承这个复杂度**

**⑧ 涉及代码文件**：`src/deploy/content-reload.ts`（新建）｜`tests/deploy/content-reload.test.ts`


> 判据源: 登记件 `1-10` → `npx vitest run tests/deploy/content-reload.test.ts` expectExit 0 ｜ 依赖: K12-14 ｜ 等级 **A**

## Q0: 定位 现装配只在 **boot** 发生 ⇒ 改 `extensions/` 必须重启进程（**对"建档后立刻让员工用"是障碍**）。
### b) 文件审计（实测）`src/init/file-driven-loaders.ts` 9 路已接线；**无 reload 能力**；`src/deploy/content-reload.ts` **不存在**。
### c) 决策 采纳 DSH 三机制（**早激活/失败隔离/标识持久化**）；**不采纳**其代际机制。

## Q1: 调研
- **院方 §5.4**：加＝建目录＋manifest＋内容＋过 CC1/CC4；删＝删目录＋CC2 保无 type 残留＋requires 显式失败；**0 宿主改动**（哨兵路径 10-03 已实证 3 文件 0 宿主）
- **DSH 依据（三机制，逐条给依据）**：
  | 机制 | 出处 | 说明 |
  |---|---|---|
  | ✅ **早激活** | 内容面规范 §5.3（DSH 三机制之一：boot 全量解析，**选择前暴露失败**） | 失败在**选择前**暴露，不是首次使用时炸 |
  | ✅ **失败隔离** | 同 §5.3（degraded 留清单、拒新绑定、**不阻断启动**）｜DSH preset 文档亲证，与铁律 31 一致 | 直接借 |
  | ✅ **标识持久化** | 同 §5.3（会话记录内容项版本，供 ⑥ 进化读） | 直接借 |
  | ❌ **代际机制** | 同 §5.3 原文（DSH 注册表**拥有代际**：编辑释放 Loader 会撤销运行中 Agent 工具） | **我们无在线编辑内容需求** ⇒ 不继承该复杂度 |
- **memory 教训**：宪章 4.3 硬要求③（可版本化）⇒ 标识持久化同时服务参数层。

## Q2: 范围
做什么：`src/deploy/content-reload.ts`｜`tests/deploy/content-reload.test.ts`｜brief
不做什么：不改 `src/init/file-driven-loaders.ts` 既有 9 路行为（reload 复用其解析）｜不改 `src/deploy/content-registry.ts`（K12-14 写集）｜不改 `extensions/**` 内容

## Q3: 验收
入口：运行中触发 reload 处理：重扫目录 → 解析 → 绑定（失败隔离）结果：
- V1 `npx vitest run tests/deploy/content-reload.test.ts` ⇒ exit 0
- V2 **生效**：运行中新增目录 ⇒ 触发 reload ⇒ **无需重启**被发现
- V3 失败隔离：非法 manifest ⇒ 拒新绑定 + 留清单 + **不阻断**
- V4 早激活：boot 全量解析，失败在选择前暴露
- V5 标识持久化：会话记录内容项版本
- V6 反例：reload 不清旧绑定 ⇒ V2 **必红**（重复注册）


## 本卡在架构中的位置

```
  【下行流】企业 → 系统
    ⓪ 连接器（数据⓪-a / 人⓪-b）
    ① 循环（动力学）
    ② 本体（结构）
    ③ 哨兵（观测）
    ④ 参数（护城河）
    ⑤ 导航（目标生命周期）
  【上行流】
    ⑥ 进化回环
    −1 运行时  ⟵ ★ **本卡在这里**
  【横切】⊥ 断面层（取证断面）｜数据边界（合同）｜契约线（今天不建）
```

## 架构层: −1 运行时（装配 / 加载）
## 写集
| 文件 | 类别 |
|---|---|
| `src/deploy/content-reload.ts` | task（新建） |
| `tests/deploy/content-reload.test.ts` | task |
| `.claude/task-briefs/2026-10-11-198-content-reload.md` | task（本件） |

## Done 标准
- [ ] verify: `npx vitest run tests/deploy/content-reload.test.ts`（expectExit 0；登记件 `1-10`）
- [ ] verify: `npx tsc --noEmit`
- [ ] 反例（改坏必红）：reload 不清旧绑定 ⇒ 留原始输出
- [ ] 卡上【读卡确认】+【交付】

---
