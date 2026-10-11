---
状态: implemented
日期: 2026-10-11
决策: K12-10（#193 / RB-02）部门轴落成三条硬口径——①部门定义文件驱动真源 `extensions/departments/**`；②身份/部门解析**单一入口** `resolveContext`（除它以外本模块任何导出不得再读原始身份的部门字段）；③多部门 = **并集**、空身份 = **空集合**（永不"默认给全量"）。
理由: 知识分层第二层（部门级）此前**无统一轴线**（单数 `departmentId` 与复数 `departmentIds` 并存）⇒ 同一人的可见范围各处算得不一样；而"解析上下文有多个入口"是一致性从根上破的因（各岗位各读各的 ⇒ 同一事实在不同人那里不一样）。
---

# K12-10 部门轴 —— 三条口径与两条实测教训

## 背景（触发场景）

卡面 #193 的判据源是登记件 `RB-02`：
`npx tsx scripts/control-tower/probe-department-axis.ts --case multi-dept` **expectExit 0**。
交付前实测：该探针不存在、`resolveContext` 全树 0 命中、`extensions/` 下无部门定义目录。

## 决策（三条口径）

1. **文件驱动真源**：部门定义 = `extensions/departments/<id>.yaml`（**部门 id ＝ 文件名去扩展名**，含 `id:` 字段且必须与文件名一致）。
   加一个部门 = 加一个文件 ⇒ `content-registry` 表**零改动**（部门 id 由目录扫描得出，不逐项登记；否则"加文件即可"当场失效）。
2. **单一入口**：`src/services/request-context.ts` 的 `resolveContext(identity)` 是**唯一**读原始身份部门字段的地方。
   `departmentId`（单数）/ `departments`（别名）**只作兼容入参**，取到候选 id 后立刻归一进复数集合 —— 单数语义**不外溢**。
3. **集合语义**：多部门身份 ⇒ `departments` 取**并集**（`departments(A ∪ B) ⊇ departments(A) ∪ departments(B)`）；
   空身份 ⇒ **空集合**（不得退化为"默认给全量"＝越权）；未知 id ⇒ 跳过且**不记降级**（预期路径，非故障）；
   真降级（真源缺失 / 目录不可读 / 解析失败 / id 与文件名不一致）⇒ `degraded: true` + 原因进数组 + `log.warn`（铁律 11/24/31）。

## 教训一：判据的**观测窗口**必须对准"生效面"，否则探针会假绿

初版探针的 `scopeOf()` 用「收集解析结果里**全部**字符串叶子，取其中出现过的已知部门 id」当可见范围。
实测反例（把并集改成覆盖：多部门只保留最后一个）**没被判红** —— 因为 `requestedDepartments` 里仍留着被请求的全部 id，
字符串叶子照样扫到两个部门 ⇒ **RESULT=PASS（假绿）**。
修正：优先读结果对象上的**生效字段** `departments` / `departmentIds`（字符串数组）作为唯一观测窗口，两者都不存在时才退回全叶子扫描。
⇒ 一般规则：**"请求过的" ≠ "生效的"**；判据要锚在语义位上，不能锚在"结果里出现过"。

## 教训二：行为观测会顺带照出**入参未校验**——那一次是真的

探针把「属性被仪表化的身份对象」投给模块的**每一个读形态导出**（`getCurrentFilterClause` 等），
按"谁读了原始身份的部门字段"判有没有第二个解析入口。实测报出 `getCurrentFilterClause` 读了 3 次 ——
细看是**误报**（它读的是自己的入参 `resourceType`，不是身份）。
但同一个现象暴露了**真问题**：旧实现把 `resourceType` **原样**塞进 `log.warn` 的 meta（`{ resourceType }`），
传身份对象进来时 ⇒ **整份身份被打进日志**（身份面泄进日志面）。
处置（本卡最小加固）：`resourceType` 非字符串 ⇒ 立即 fail-closed，只记录 **JS 类型**、**不回显入参值**；条件集语义零变化（仍为拒绝型）。

## 生产触发点（DSH 式"接上 ≠ 会跑"的落点）

`src/deploy/content-registry.ts` 登记 `department` 面（`status: 'reachable'` ＋ loader 按名声明 `resolveContext`）：
链路 `src/server.ts` → `initFileDrivenLoaders()` → `initContentTypes()` **每次启动真调 `resolveContext`**，
并按其实例返回的 `degraded` / `degradedReasons` 传播降级信号。
**未做**（待另立卡）：请求路径侧的消费（把解析结果喂给部门级内容/权限）。
原因：请求路径上唯一带身份的位置是 `src/middleware/auth.ts` 与 `src/routes/**`，两者均被本卡卡面**明令只读**；
为一个尚未接线的解析结果去伪造请求级调用点，属"接线形态交付"（P-02 禁止）⇒ 明确留白并上报，不做假接线。

## 相关

- 卡面: Gitea Issue #193（`[K12-10] 部门轴`）｜登记件 `RB-02`
- 同族先例: K12-20（#203）`extensions/content-layers/**` —— 答「这个部门**看到什么样**」；
  本件答「**有哪几个部门、身份如何解析**」。两者**不是**同一件事，故不共用目录。
- 判据件: `scripts/control-tower/probe-department-axis.ts`（V3 用 getter 行为观测，grep 仅 `[L1-辅证，不参与判定]`，判例 V-02）
- 测试: `tests/security/department-axis.test.ts`（18 例：正常/降级/边界/单一入口/文件驱动/生产触发点）
