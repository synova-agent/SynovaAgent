<!-- 卡面来源: 库外档案仓 K12-一致性线-卡面全套.md（CTO 亲撰）
     架构基准: 院方 产品宪章.md v8.1（§0.4 ＋ §4.1 ＋ §5.6/5.7）
     机器真源: docs/synova/coordination/施工项登记.ts 的 K12 块（本站 id=K12-13）
     纪律: 执行 session 只从本文件取施工信息；缺字段 ⇒ 问 CTO，不许猜 -->

# Task Brief: #196 → K12-13（登记件 `0-13`）— check-content-coupling 新门禁（CC1–CC4）

## 〇、为什么要做这个（通俗版 · 先读这一节）

**① 一句话**：加一条**门禁**，防止"**内容面偷偷调用引擎内部代码**"。

**② 解决什么问题**：院方实测：`extensions/**` 里有 **113 条 type import ＋ 28 条值 import** 直接钻进 `src/`
（值 import = 运行时真依赖）。后果很实在：**客户改内容 → 内核就升不了级**（内容把引擎的实现细节焊死了）。
而架构门禁 `check-architecture.sh` 对 `extensions/` **零覆盖**（实测 `grep -c extensions = 0`）。

**③ 做完对项目的推动**：让"**能加文件、也能改内核**"同时成立
（这是宪章 P1「一切皆为内容」＋ 约束 4「内核与扩展边界物理可见」的前提）。

**④ 不做行不行**：**不行**。不做 ⇒ 内容面越写越绑死引擎 ⇒ 将来想换掉任何一块都要动客户的内容。

**⑤ 现在有什么基础**：
 · ✅ 标准已定（内容面规范 §3.5 的四条判据 CC1–CC4，**逐条带现存量**）
 · ✅ 包导入通道已在用：`extensions/**` 里已有 **49 条 `@synova/*` 包 import**（契约化不是新发明）
 · ✅ 已有接线点 `scripts/check-architecture.sh`（补新组即可，不新起脚本）
 · ❌ `scripts/check-content-coupling.sh` **不存在**

**⑥ 还需要做什么**：实现 CC1（方向）／CC2（对称）／CC3（可达）／CC4（结构）四判据 ＋ 门禁自测（含"造违规文件必报"）

**⑦ DSH 借鉴方式**：**参考自研**
 · ✅ 可借：**结构性检查归宿主、语义性检查归包**（`dsh-invariants/lib/index.js:6-13`：包自带 `./invariant`，宿主只提供注册表）
 · ✅ 可借：**只在 CI 权威**（`dsh-tool-workflow/lib/index.js:106` 脚本只协调 ＋ 宪章 D515/D516）
   —— 本门禁**不得进 pre-commit 本地阻断位**（避免重犯"门禁太多 ⇒ --no-verify"的历史病根）
 · **自研**：CC1–CC4 四条判据是我们按自己的耦合现状定的

**⑧ 涉及代码文件**：`scripts/check-content-coupling.sh`（新建，或并入 `check-architecture.sh` 新组）｜
 `tests/control-tower/content-coupling.test.sh`


> 判据源: 登记件 `0-13` → `bash scripts/check-content-coupling.sh` expectExit 0 ｜ 依赖: 无 ｜ 等级 **A**（院方 §3.5 逐条带现存量）

## Q0: 定位 §P1「一切皆为内容」的**执法件**。为 `extensions/` 补耦合方向与可达性门禁（现架构门禁对它**零覆盖**）。
### b) 文件审计（实测）
```
· `grep -c extensions scripts/check-architecture.sh` ⇒ **0**（零覆盖）
· CC1 现存量：**113 条 type ＋ 28 条值**（值 = 27× assert-finite-inputs ＋ 1× l3/key-person-risk）
· CC2 现存量：**27 条**（src/sentinel/types.ts）
· CC3 违规：engine/tools（无 loader）｜locales（死指针）｜llm-providers/business-models（loader 死）
· CC4 违规：context-strategies｜implementation-patterns｜policies｜security（§d 只查 staged 新增，存量漏网）
```
### c) 决策 **并入 `check-architecture.sh` 新组**（不新起脚本，避免门禁堆叠）—— 与 §d/§e/pre-commit 组 2 **正交不重复**。

## Q1: 调研
- **院方 §3.5**：CC1 方向｜CC2 对称｜CC3 可达｜CC4 结构；分工：§d 管结构｜§e 管可载性｜组 2 管质量｜**本门禁管耦合方向与可达性**。
- **DSH 依据**：
  | 采纳/不采纳 | file:line | 说明 |
  |---|---|---|
  | ✅ 采纳：**检查由包自带 / 宿主只保证注册表** | `@deepseek-ai/dsh-invariants/lib/index.js:6-13` | DSH 是**各包自注册**；我们的 CC 是**宿主侧结构性检查**（方向/可达）⇒ **分工**：结构性归宿主，语义性归包 |
  | ✅ 采纳：**CI 权威化（本地软提示）** | 宪章 D515/D516 ＋ `dsh-tool-workflow/lib/index.js:106`（脚本只协调） | 门禁只在 CI 转硬绕断，避免"本地过严 ⇒ `--no-verify`"历史病根 |
- **memory 教训**：**v2.5 教训**（38 项 pre-commit ⇒ `--no-verify` 泛滥）⇒ **本门禁不得进 pre-commit 本地阻断位**，只进 CI。

## Q2: 范围
做什么：`scripts/check-content-coupling.sh`（或 check-architecture.sh 新组）｜`tests/control-tower/content-coupling.test.sh`｜brief
不做什么：不改 `scripts/pre-commit-check.sh`（**门禁语义归 CTO**）｜不改 `scripts/audit/**`（红线）｜不改 `extensions/**` 内容（本卡只加检查，不改被检查物）｜不改 `.github/**`（治理线）

## Q3: 验收
入口：CI 步骤 / 本地手动 处理：四判据扫描 结果：
- V1 `bash scripts/check-content-coupling.sh` ⇒ 对**存量**输出违规清单（**先只报数不 exit 1**）
- V2 `SYNO_CI=1` 时新增违规 ⇒ **硬阻断**
- V3 反例：造一个"extensions 里 import 相对路径引擎码"的文件 ⇒ 门禁**必报**
- V4 **不误报**：对 `@synova/*` 包 import（现 49 条）⇒ **不报**
- V5 与 §d/§e 不重叠：同一违规**不由两个门禁重复报**


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
    −1 运行时
  【横切】⊥ 断面层（取证断面）｜数据边界（合同）｜契约线（今天不建）
```

## 架构层: 横切（内容面 ↔ 引擎面边界执法）
## 写集
| 文件 | 类别 |
|---|---|
| `scripts/check-content-coupling.sh` | task（或并入 check-architecture.sh） |
| `tests/control-tower/content-coupling.test.sh` | task |
| `.claude/task-briefs/2026-10-11-196-content-coupling.md` | task（本件） |

## Done 标准
- [ ] verify: `bash scripts/check-content-coupling.sh`（expectExit 0；登记件 `0-13`）
- [ ] verify: `bash tests/control-tower/content-coupling.test.sh`
- [ ] 反例（改坏必红）：造违规文件 ⇒ 留原始输出
- [ ] V1 现存量清单原始输出（CC1 113/28、CC2 27、CC3 4 项、CC4 4 目录）
- [ ] 卡上【读卡确认】+【交付】

---
