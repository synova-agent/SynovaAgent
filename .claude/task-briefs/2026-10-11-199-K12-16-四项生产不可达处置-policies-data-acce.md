> **卡面来源**：库外档案仓同名片（CTO 亲撰）｜架构基准：产品宪章 v8.1｜纪律：缺字段问 CTO，不许猜


# Task Brief: #199 → K12-16（登记件 `1-11`）— 四项生产不可达处置 ＋ policies/data-access

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：把"**注册了、但根本没人读**"的内容**要么接线、要么删掉**。

**② 解决什么问题**：院方实测 4 项生产不可达：`llm-providers` / `business-models` / `engine` / `tools`
 ＋ 半孤儿 `policies/data-access.yaml`。最坏的一处是 `llm-providers`：
 **死的一套（文件驱动）和活的一套（`src/providers` 硬编码类）并存** —— 这是"两套并行系统"病。
 危险不在于浪费，而在于**有人以为改了文件就生效**（假信号）。

**③ 做完对项目的推动**：让"**内容面可达性**"变成可验证的事实（16/20 → 20/20 或明确删除）；
 顺手消解一处"两套并行"。

**④ 不做行不行**：**不行**（但方式可议）。不做 ⇒ 客户/我们改内容不生效且**不报错**——
 这正是内容面规范点名的"**最坏体验：他以为自己配好了**"。

**⑤ 现在有什么基础**：
 · ✅ 事实已清（院方 §3.2 逐项实测；复跑命令在 §九）
 · ✅ 注册表机制将由 K10 的 EXT-WIRE 提供（`src/deploy/content-registry.ts` 已存在于 local-main）
 · ❌ 该卡要做的"逐项生死判定"**未做**

**⑥ 还需要做什么**：**逐项二元化**（接线 or 删除）＋ 删除项清 manifest 与引用 ＋ 接线项给"穿生产入口"用例

**⑦ DSH 借鉴方式**：**参考自研**
 · ✅ 可借：**"没接线就不算数"**（宪章 约束 2 三问 ＋ `dsh-invariants/lib/index.js:6-13`：宿主保证"**不生效就报错**"）
 · ⚠️ **取舍本身不可从 DSH 推**（院方 §七-2 明写"需 CTO/创始人裁"）

**⑧ 涉及代码文件**：`extensions/{llm-providers,business-models,engine,tools}/**`｜`extensions/policies/data-access.yaml`（逐项接线或删除）


> 判据源: 登记件 `1-11` → `bash scripts/check-content-coupling.sh` expectExit 0 ｜ 依赖: K12-14 ｜ 等级 **A**（院方 §3.2 逐项实测）

## Q0: 定位 清掉"注册了但没人读"的内容（院方叫它**第四处「两套并行系统」**）。
### b) 文件审计（实测）
```
· llm-providers：**死文件驱动系 vs 活 src/providers 硬编码类**（复跑：loader 零调用 = 0 除自身）
· business-models：唯一读者是其**自身死 loader** ⇒ 生产不可达
· engine / tools：路径**零读者**（孤儿）
· policies/data-access.yaml：**零读者**（半孤儿；同目录 escalation-rules.json 有读者）
· 汇总：**16/20 生产可达**
```
### c) 决策 院方 §七-2 明写「取舍是**产品判断**」⇒ 本卡**逐项二元化**（接线 或 删除），不留"不可达"。

## Q1: 调研
- **院方 §3.2 汇总**：4 项不可达＋1 半孤儿；**§七-2** 需 CTO/创始人裁。
- **DSH 依据**：
  | 采纳 | file:line | 说明 |
  |---|---|---|
  | ✅ **"没接线就不算数"** | 宪章 约束 2（加了吗/接上了吗/生效了吗）＋ `@deepseek-ai/dsh-invariants/lib/index.js:6-13`（宿主保证"不生效就报错"） | DSH 插件**生效是运行时事实**；同型 ⇒ 不许"注册了但没人读" |
  | ⚠️ **取舍本身不可从 DSH 推** | 内容面规范 §七-2 | 明写需 CTO/创始人裁 |
- **memory 教训**：铁律 37（Dead code 入仓库即违规）⇒ 删除项要**连带**清 manifest 与引用。

## Q2: 范围
做什么：`extensions/{llm-providers,business-models,engine,tools}/**`、`extensions/policies/data-access.yaml`（逐项接线或删）｜brief
不做什么：不改 `src/providers/**`（活的那套 —— 若选"接线"则改注册表而非硬编码）｜不改 `scripts/audit/**`｜不改 `extensions/` 其余 16 项

## Q3: 验收
入口：装配期 + 生产调用点 处理：逐项判定 结果：
- V1 **逐项二元**：5 项每项明确"已接线"或"已删除"（**不允许"留着但不可达"**）
- V2 接线项：**穿生产入口**用例证生效
- V3 删除项：`git ls-tree` 零残留 + 无引用（CC3 通过）
- V4 **两套并行消解**：`llm-providers` 与 `src/providers` **只留一套**
- V5 反例：留一个"没人读的 manifest.type" ⇒ CC3 **必红**


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

## 架构层: −1 运行时（装配）＋ ⓪ 连接器（provider 面）
## 写集
| 文件 | 类别 |
|---|---|
| `extensions/llm-providers/**` | task（接线或删） |
| `extensions/business-models/**` | task（同上） |
| `extensions/engine/**`、`extensions/tools/**` | task（同上） |
| `extensions/policies/data-access.yaml` | task（同上） |
| `.claude/task-briefs/2026-10-11-199-unreachable-disposal.md` | task（本件） |

## Done 标准
- [ ] verify: `bash scripts/check-content-coupling.sh`（expectExit 0；登记件 `1-11`）
- [ ] verify: `npx tsc --noEmit`
- [ ] V1 五项判定表原始输出（二元，无"不可达"）
- [ ] 卡上【读卡确认】+【交付】

---
