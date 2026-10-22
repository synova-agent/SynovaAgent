# 派单前复核固定为流程（pre-dispatch-check）

> 状态: implemented | 日期: 2026-09-13 | 决策: 把「派单前复核」从隐式习惯固化为 skill + 脚本 + 硬接入 CTO 必读流程 | 理由: 创始人质询「你每一次给出派单指令之前有没有复核过？」→ 诚实回答「没有完整复核」

## 一、触发（创始人质询）

第三批派单（D727–D731）发出后，创始人问：**「你每一次给出派单指令之前有没有复核过？如果没有就复核一遍，然后一定要把这个流程固定下来。」**

CTO 诚实回答：**没有完整复核**。
- 核了**流程层**：任务号经 alloc 实分配、PR/分支状态、写集零交集推理
- **没核技术层**：`build-synova.cjs:141` 死键、`upsertFromHONA` 死路径、45 处 locale 缺陷、evidence 表不存在——这些直接采信了员工报告的转述

## 二、当场复核结果（三条证实、两处派单错误、一条无法确认）

| 声称 | 复核命令 | 结论 |
|---|---|---|
| `build-synova.cjs` 重复 `beforePack`（:141/:207） | `grep -cE '^\s*beforePack\s*:'` → 2 | ✅ 属实 |
| `evidence` 表在生产库不存在 | `sqlite3 data/synova.db ".tables" \| grep -ci evidence` → 0 | ✅ 属实 |
| `diagnosis-launcher.ts:235` HONA 已删 | 逐字命中 | ✅ 属实 |
| `EvidenceStore` 零生产实例化 | `grep -rn "new EvidenceStore" src/` → 空 | ✅ 属实 |
| **D728 写集 `src/l4/evidence/**`** | `ls -d src/l4/evidence` → **不存在**；实际在 `src/evidence/` | ❌ **CTO 写错，已修正全文** |
| D729 写集「`src/l4/**`」 | `grep -rln upsertFromHONA` → `src/l4/graph-bridge.ts`（**铁律 46 白名单桥接文件**）+ `src/agent/post-diagnosis-processor.ts` | ⚠️ 过宽且触及白名单 → **收窄为两文件并标注** |
| `SqliteGraphStore` 无 `createNodes` | `grep -rn SqliteGraphStore src/l4/*.ts` → 未定位 | ⏳ **未确认** → 派单改为「执行方先复现」 |

## 三、固化（本 Note 对应的交付）

1. **skill `pre-dispatch-check`**（八项复核：任务号真实 / 前置状态真实 / 技术声称亲自复现 / 写集路径验证 / 零交集+串行 / 行号可漂移 / 依赖图 / 交付物齐备）+ 反向自问「如果这条是错的，谁会第一个撞墙？」
   - 双写 `.synova/skills/` 与 `.dsh/skills/`（D370 同步要求）
2. **脚本 `scripts/control-tower/pre-dispatch-check.sh`**：机械化可判的四项（D# 有 task-state / 写集路径存在 / file:line 不越界 / 前置 PR 合并状态），**三态退出码**（0 通过 / 1 发现问题 / 2 检查自身失败），无 token 时显式 degraded 不静默
3. **密封测试 `tests/control-tower/pre-dispatch-check.test.sh`**：5 断言（正常放行 / 缺 task-state 必红 / 路径不存在必红 / 三态 2 / skill 双写接线）
4. **硬接入 `cto-handover` skill**（双写）：CTO 开工必读的流程文档里写入「发出任何派单指令前必须加载 pre-dispatch-check，机械项跑脚本」

## 四、为什么值得固化（第一性原理）

**派单错误比代码错误更贵**：一条写错的写集路径会同时污染所有执行方，且执行方会以为是自己理解错了——
错误在「声明层」传播，比在「实现层」传播快一个数量级。所以复核必须发生在**发指令之前**，且必须留证据。

## 五、遗留

- 脚本尚未写入 CI 密封清单（属控制塔域，转 D730 一并处理）
- `cto-handover` 的引用是**软流程**（靠 skill 加载），是否升级为物理门禁（如派单文档必须附复核证据节）留待 D730 评估
