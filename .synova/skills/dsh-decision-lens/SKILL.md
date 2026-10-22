---
name: dsh-decision-lens
description: DSH 决策镜头——遇到"要决策/要取舍/要不要加机制/队列堆积/并发多少"时，用 DSH 源码里可核的六条原则做判断。创始人 2026-09-20 定：以后遇到需要决策的，用 DSH 的思维。含 file:line 证据与借鉴边界。
---

# DSH 决策镜头（决策纪律 · 工作纪律）

> 来源：创始人 2026-09-20 裁定 ——「以后遇到需要决策的，可以用 DSH 的思维」+「把六条原则变成我们决策的纪律、工作的纪律」。
> 用法：任何"要不要加一层机制 / 队列怎么处置 / 并发开多少 / 怎么算健康"的判断，先过这六条。
> **纪律要求：引用必须来自读 DSH 源码，不得凭印象**（本文件已给 file:line，复核路径见 §三）。

---

## 一、六条原则（决策时逐条对照）

| # | 原则 | DSH 证据 | 对我们的操作含义 |
|---|---|---|---|
| 1 | **上限即纪律** | `dsh-experimental-agent-team/lib/index.js:564` `TEAM_MEMBER_LIMIT`、`:1327` `TEAM_TASK_LIMIT`——超限**抛错** | 队列/在飞任务必须有**显式上限**；超限第一动作是**退役**（关闭/合并/拒绝），不是"攒着慢慢来"。**不许无界堆积** |
| 2 | **归属自有 + 可归因** | `dsh-invariants/lib/index.js:6-19`：每个包用 `./invariant` 伴生注册检查；`InvariantError{ code:"INVARIANT", packageName }` | 机制由**它守护的那个对象自己声明**；每个在飞件必须有**主人**，失败要有**机器可读代码 + 归属**（不靠人问） |
| 3 | **只做协调，不干活** | `dsh-tool-workflow/lib/index.js:106` "agents do the work, the script only coordinates them"（并发上限由引擎管） | 编排只负责**上限/并发/取消**；**执行一律派出**（对齐创始人"多数要派出"） |
| 4 | **机械问题与业务语义分离** | `dsh-output-retention/lib/types/index.js` 头注：只回答"留了什么、丢了什么"；`truncated` **不等于**上游不完整 | 队列健康 = **纯机械派生指标**（age / behind / CI / 有无主人）；**不要把"卡住"和"被绕过"揉进一个数字** |
| 5 | **诊断不污染主路径** | 同上：invariant 伴生**不进主入口**；retention 是**库**——不注册服务、不发事件、无跨调用状态 | 检查/协调必须是**旁路**（派生指标挂看板），**不能让每条主路径都过闸**——这条正是我们"每次合并重跑全量 CI"痛处的解药 |
| 6 | **权威账本在 Lead** | agent-team 多处 `authoritative Lead-log transaction owner`；任务带 **advisory** write scopes | 写集是**提示**，权威记录在队长/CTO 手里；对齐我们《小队模式-固化件-v1》M1–M6 |

## 二、决策四步（照做）

1. **先量，不先加机制**：拿机械指标说话（队列长度、behind=N、age、CI 状态、谁在飞）。
2. **先修瓶颈，再加负载**：瓶颈没解，**不开新车道**（新车道只会让合并更慢）。
3. **超限即退役**：过上限就按"退役优先"处置（给关闭理由，不留悬案），**不是"为了不浪费去合"**。
4. **旁路落地**：新机制优先做成**派生指标/旁路检查**；只有"不拦就会真出事"的才进主路径门禁。

## 三、复核路径（引用前先跑）

```bash
D="/Users/wane/Library/Application Support/io.github.hairyf.deepseek-harness-desktop/dependencies/dsh/node_modules/@deepseek-ai"
sed -n '560,570p;1320,1330p' "$D/dsh-experimental-agent-team/lib/index.js"   # 上限
sed -n '1,25p' "$D/dsh-invariants/lib/index.js"                              # 包自有检查 + 归因
sed -n '100,110p' "$D/dsh-tool-workflow/lib/index.js"                        # 只协调不干活 + caps
sed -n '1,25p' "$D/dsh-output-retention/lib/types/index.js"                  # 机械 vs 业务语义
```

## 四、⚠️ 借鉴边界（不许照抄的地方）

DSH 是**一个能力一个独立包、互不共享文件**（每包自带 `lib/ + README + package.json`）→ 它的 **advisory 写集足够**。
我们是**单仓共享文件**（`src/**` 与 `scripts/**` 同仓）→ **必须保留文件级互斥 + 串行合并**（M1–M6），不能只学 advisory。

**判据**：问一句"如果两个 agent 同时改这个文件，坏不坏？"——坏 → 要物理互斥；不坏 → 可以照抄 advisory。

## 五、反模式（见到就退）

- ❌ 用"再加一道门禁"回应"某类错又出现了"——先问是不是**队列/并发上限**的问题。
- ❌ 把多个含义塞进一个指标（卡住 + 被绕过 + 质量差 揉成一个"健康分"）。
- ❌ 让主路径承担诊断（每次提交都跑全量检查）——诊断要旁路。
- ❌ 无界堆积（"先攒着，回头一起处理"）。
- ❌ 引用 DSH 却没给 file:line（凭印象 = 不算借鉴核查）。
