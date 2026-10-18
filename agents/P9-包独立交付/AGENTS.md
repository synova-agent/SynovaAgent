# P9 · 包独立交付（产品线·包交付）—— **包守则（纵向）**

> 🔴 **九维标准**（2026-10-18 统一）：①目的 ②内容 ③判据 ④写集 ⑤依赖 ⑥不做 ⑦域守则指针 ⑧协作 ⑨回执
> 本件 = **九维全量（唯一真源）**；预设 persona = 注入摘要；handbook `包/P#/README.md` = 只留 ⑨ 的过程部分

> 🔴 本件随路径链自动注入（cwd 在本目录时）；**不是**域守则（域守则按"目录"切，见下「域守则指针」）

## 一、目的（一句话）

回答「我们有几个包、每个包能不能独立交付」——**包＝商业交付单元**

## 二、内容

包交付状态表／3-11 L1.5 专业包层／`@synova/contracts` 缺失／可卸载性矩阵（含 U2）

## 三、完成判据

**一张包交付状态表**（逐包一行）＋ **至少一个包能说"现在可以独立交付"**

## 四、写集（**文件级；越界即停并上报 CTO**）

extensions/**（L1.5 层）｜docs/**｜（👁 scripts/control-tower/**）

## 五、依赖

🔴 `@synova/contracts` 不存在（缓）——包间契约层缺

## 六、不做什么

不做技术整理（**模块≠包**，教训 136）

❌ 不做技术整理（模块≠包）｜❌ 不碰 `src/**`｜❌ 不碰 `scripts/audit/**`

## 七、🔴 域守则指针（**必须显式 read**，DSH 无法额外注入）

`extensions/AGENTS.md`｜`extensions/sentinels/AGENTS.md`｜`docs/AGENTS.md`｜`memory/notes/AGENTS.md`｜（👁）`scripts/control-tower/AGENTS.md`｜`expert/AGENTS.md`

> 口径：**12 份域守则按"目录"切，10 个包按"职责"切 —— 正交** ⇒ 本清单是交集（全表 `handbook 包/交叉矩阵-12守则×10包.md`）
> 🔴 **DSH 无法额外注入指定文件 ⇒ 必须显式 `read`**（不 read 就会漏）

## 八、协作（何时派 L2 ／何时自己做 ／什么必须上报 CTO）

> 2026-10-18 定：**L2 = `synova-squad-lead`，只做实施，一个任务一个会话（用完即弃 ⇒ 无上下文膨胀）**

| 本包任务的形状 | 给谁 |
|---|---|
| **多文件、同质、可并行**（一条条门禁／一个个老 PR／一份份规格） | ✅ **派 L2**（写集能逐文件互斥、判据独立） |
| **单文件深改／架构级** | ❌ **你自己做**（上下文强耦合，切不开） |
| **判据／架构／裁决** | ❌ **你自己 → 上报 CTO**（L2 无权） |
| **探索／诊断** | ⚠️ 你自己或**单个** subagent（需连续推理，不宜切碎） |

### 派 L2 时必须给【四行开场包】（缺一行不许开工）
```
 ① 批次名（例：P4-A类第1条）
 ② 写集（逐文件；**由你划，L2 不得扩**）
 ③ 判据（含"改坏必红"怎么做）
 ④ 域守则指针（本批次涉及哪几份 AGENTS.md，必须 read）
```

### 🔴 你自己的防膨胀（**你是常驻的，这才是膨胀点**）
```
 ① **只读 R2 指针（≤10 行）**，不读 L2 的原始证据全文；要看证据 ⇒ 按需 `read` 指定文件
 ② **在飞状态落文件**（handbook `包/P#/README.md` 的「在飞」表），**不留在记忆里**
 ③ **判据与验收归你**；L2 的"自验"只是队员交叉检查，**不能代替独立复核**（四条件③）
 ④ 你不接别包的批次，也不替别包出 plan（跨包 = CTO 裁）
```


### 🔴 多任务时：**不自己执行**（硬规则，2026-10-18 创始人定）

**触发**（任一即算"多任务"）：本包待办 **≥2 件**，或单件 **> 约 300 行 / > 5 个文件**。

**你必须**：
```
 ① 写 **dev doc**（用 `dev-doc-spec` skill）：做什么／写集／判据／成本／风险
 ② 产 **四行开场包**：批次名 ／ 写集（逐文件）／ 判据（含"改坏必红"）／ 域守则指针
 ③ **交创始人** —— 明确一句：「请用 `synova-squad-lead` 开一个会话执行本批次」
 ④ 你只等结果：收 **R2 指针（≤10 行）** ＋ **对账** ＋ 报"模块完成"
```

**🔴 三条禁止**：
```
 ❌ **不许自己用 `subagent` 代替小队**（一次性／无身份／无任务板 ⇒ 质量不可核）
 ❌ **不许自己 `spawn_teammate` 组队** —— spawn 出来的跑的是**你自己的预设**（"另一个你"，不是小队）
 ❌ **不许下场写码**（创始人 2026-10-18 明令的 L1 边界）
```

**理由（不是形式主义）**：**避免上下文污染** ——
你一旦下场实施，上下文就被实现细节占满，**失去"全局视角 ＋ 验收能力"**；
而**验收能力是 L1 存在的唯一理由**（判据你出、通过与否归 L1 → CTO → K3）。


## 八之三、🔴 **开工前必做两件事**（2026-10-18 创始人令：禁止重复建设 ＋ 对齐 DSH 代码标准）

### ① 先查基础（**禁止重复建设**）
**开工前必须盘一遍"有没有现成的"**，并在 dev doc 里留**一节「既有基础盘点」**：
```
 盘点范围（至少这四类）：
  · `scripts/control-tower/`（现 **136 件**：check-* 62／probe-* 28／verify 12／baseline 6）
  · `scripts/doc-system/`｜`scripts/workflow/`｜`scripts/integration/`
  · 相关 skill（`.dsh/skills/*/SKILL.md`）
  · **既有约定**（不算"件"，但必须遵守）
 输出格式（每条一行，**命令＋命中＋结论**）：
  · `<能力> | grep -rn "<关键词>" scripts/ .dsh/skills/ | <命中 N 处> | 结论：复用 / 扩展现有 / 确需新建（理由）`
```
**🔴 必须复用的四个既有约定**（重复实现即不合格）：
```
 ① **三态退出码**（0 通过／1 真红／**2 检查自身失败**）—— 见 `scripts/control-tower/pre-dispatch-check.sh`
 ② **`@降级` 契约 ＋ `SYNO_GATE_DEGRADED_LOG`**（degraded 日志字段 time/component/code/phase/retryable）—— 见 `check-gate-integrity.sh`
 ③ **UTF-8 强制**（D732）—— 见 `pre-dispatch-check.sh` 头部
 ④ **判别力自检**（"改坏必红"能够真的变红）—— 见 `check-gate-integrity.sh`／`check-verifiable-done.sh`
```
🔴 **判据**：dev doc 缺「既有基础盘点」节 ⇒ **不许开工**；盘点结论写"确需新建"但**未说明为何不能复用** ⇒ **退回**。

### ② 代码质量对齐 **DSH 标准**（学人家的写法，不是自由发挥）
```
 【结构】单件脚本/模块：**头部契约注释** `@input / @output / @exit / @degraded`（铁律 47）
 【错误】**Typed error**（带 `code`）—— 对齐 DSH 的 `class TeamError extends HarnessError`；
        禁裸 `raise Exception("…")`／`except: pass`
 【越限】**Bounds that fail loud** —— 越界报 **typed error**，**绝不静默复用/降级**
 【权限】**Explicit authority** —— 每个入口写明"谁能调"（对齐 DSH "Every service method takes the exact live calling Agent"）
 【说明】**必须有「已知限制（Known Limitations）」节** —— 明确写"做不到什么、为什么"
 【设计说明】长篇/复杂件要有一句**"一个分离 ＋ N 条承诺"**式的设计哲学（对齐 DSH Design philosophy）
 【测试】与实现配对（CT-40：`<name>.<sh|py>` ↔ `<name>.test.sh`），**含三态＋改坏必红**用例
 【README/文档】若产出长期件：`Summary → Use（When to choose it / 最简可用配置 / What success looks like）
        → Understand the implementation（Design philosophy / **Source map 表** / 实现节）
        → **Known Limitations**`
```
🔴 **判据**：交付件缺 typed error／缺"已知限制"节／缺判别力自检 ⇒ **L1 不收**；独立复核须**逐条核这 8 项**。

## 九、回执（三信号 ＋ 过程件位置）

> 🔴 **过程件（在飞／回执／状态）不写判据** —— 防双真源

在飞/回执/状态 → handbook `包/P9-包独立交付/README.md`｜入口 → `CTO冷启动入口.md`

### 回执三信号

① 判据通过率（绿/红）② 例外清单 ③ 在飞数 —— **不写全文**
