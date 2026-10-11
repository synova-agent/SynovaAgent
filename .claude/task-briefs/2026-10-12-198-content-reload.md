#CRITERIA: A

# K12-15（#198）— reload 重扫 extensions/（运行中热重扫内容面）

> 卡面：Gitea issue **#198**（`[K12-15] reload 重扫 extensions/`，执行态/未开工）
> 判据源：施工项登记件 `1-10` → `npx vitest run tests/deploy/content-reload.test.ts` expectExit 0
> 依赖：K12-14（`src/deploy/content-registry.ts`，已在 local-main）
> 架构基准：院方《产品宪章》v8.1 §5.6/5.7 ＋《extensions内容面规范-v0》§5.3（DSH 三机制）

---

## 坐标系

```
总闸: 不适用
承重件: 不适用
批次: 第0批-止血
命名空间: 不适用
执行态: 未开工
验证级别: L2-真跑通
阻塞源: 无阻塞
```

---

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
内容面（宪章 §5.6）的**装配时效**：此前装配只在 **boot** 发生（`src/init/file-driven-loaders.ts` → `content-registry`）
⇒ 改 `extensions/` 必须重启进程，对"建档后立刻让员工用起来"是硬障碍。本卡把"**改内容不用重启**"做成可跑的能力。

### b) 文件审计（开工实测）
```
$ ls src/deploy/content-reload.ts tests/deploy/content-reload.test.ts
  ⇒ 两者皆不存在（本卡新建）
$ grep -n "^export" src/deploy/content-registry.ts
  ⇒ initContentTypes / describeContentRegistry / ContentInitReport …（复用，不另造第二条装配路径）
$ grep -n "cleanup" src/deploy/content-registry.ts   ⇒ 9 处 loader.cleanup 声明
$ grep -rn "\.cleanup" src/ --include="*.ts" | grep -v test
  ⇒ 生产消费者 **0**（仅注释 + probe-role-pack 核符号存在）
  🔴 这是本卡的关键发现：**不先清缓存，第二次 init() 会读回旧缓存 ⇒ reload 名义生效、实际不重扫**
$ ls src/routes/reload.ts   ⇒ 已存在（POST /api/reload：重扫文件目录 + 重载专家定义；**不含内容面**）
$ grep -n "app.locals.fileScanner" src/server.ts   ⇒ 无命中（真服务未注入该桩，见例外清单）
```

### c) 决策
- 新建 `src/deploy/content-reload.ts`：**复用** `initContentTypes()`（早激活）＋ 逐项分流留清单（失败隔离）＋ 状态文件落盘（标识持久化）。
- `loader.cleanup` 的**第一个生产消费者**放在本文件（否则 reload 是假的）——理由与代价见文件头 §已知边界。
- 接线：`POST /api/reload` 第 4 步调用重扫（**唯一既有的、用户可触发的 reload 端点**）。

---

## Q1: 调研

- **规范 §5.3（三机制）**：早激活（boot 全量解析，选择前暴露失败）｜失败隔离（degraded 留清单、拒新绑定、不阻断）｜标识持久化（会话记录内容项版本，供 ⑥ 进化读）。
  **代际机制不借**（DSH 注册表拥有代际、编辑释放 Loader 会撤销运行中 Agent 的工具；我们无在线编辑需求 ⇒ 不继承该复杂度）。
- **本仓口径**：铁律 11/24/31（降级必须 log + 外传，不空吞）；铁律 47/48（契约先行、测试非空壳）；铁律 39（代码层边界：`src/deploy/` 不在 L1→L3/L4/L5 的层模式内，已跑门禁实证）。
- **decision 参考系**：第一性原理（reload 的充分条件是"读到新磁盘内容"，故必须清缓存）＋ Anthropic 基线（降级不抛、调用方可安全重试）＋ 开源实证（DSH `dsh-invariants`「不生效就报错」）。

---

## Q2: 范围

**做什么**（逐文件 · ＝ Q2 写集；每行一条 `- <裸路径>`，供 G12 认领制匹配）

做什么

- src/deploy/content-reload.ts
- src/routes/reload.ts
- tests/deploy/content-reload.test.ts
- tests/routes/reload.test.ts
- .claude/task-briefs/2026-10-12-198-content-reload.md
- .claude/claims/198.yaml

逐条说明：
- 新建 content-reload 模块（重扫 + 失败隔离 + 标识持久化）
- 改既有热加载端点（第 4 步接重扫；响应体加 content 对象）
- 两个测试文件（5 例模块级 + 3 例真 HTTP 接线级）
- 本件 brief 与写集声明的 claim

不做什么（含文件路径 · 每行一条，紧跟本行为清单）

- 不改 src/init/file-driven-loaders.ts
- 不改 src/deploy/content-registry.ts
- 不改 src/sentinel/sentinel-loader.ts
- 不改 src/locale/locale-loader.ts
- 不改 src/l4/ontology-loader.ts
- 不改 src/l3/framework-loader.ts
- 不改 tests/security/department-request-path.test.ts
- 不改 src/middleware/auth.ts

逐条说明：
- boot 路径不动（reload 复用其解析链）
- registry 表/语义不动（只读复用 initContentTypes / describeContentRegistry）
- 任何 loader 实现不动（sentinel / locale / ontology / framework / rule / business-model / adapter / notification / report-template / preset）
- extensions 内容与门禁脚本不动（scripts/** 属治理线，裁定 033）
- 上一批写集（tests/security、src/middleware）不动（已合）

### 🔴 写集扩张声明（相对卡面 §Q2 原文）
卡面 §Q2 写「不改 `src/deploy/content-registry.ts`（K12-14 写集）」，其 §Q3 V2 要求「运行中新增目录 ⇒ 触发 reload ⇒ 无需重启被发现」。
**为满足 V2 的"触发"必须有一个生产入口** ⇒ 本卡把重扫接到**既有** `POST /api/reload`（第 4 步）。
- 代价 Y：写集相对卡面多 2 件（`src/routes/reload.ts` + `tests/routes/reload.test.ts`）
- 理由：① 不接 ⇒ 新 export 无生产消费者 ⇒ pre-commit 组 4（iron law 5）硬阻断 ② 该端点**本来就是**"热加载端点"，加内容面是收口而非扩张
- 未扩张到：任何 loader 实现、registry 表、门禁脚本

---

## Q3: 验收（入口 → 交互 → 结果）

- **入口**：`POST /api/reload`（既有端点）｜直接调用 `reloadContentTypes()`
- **交互**：清 loader 缓存 → 复用 `initContentTypes()` 重扫 → 逐项分流 → 落状态文件
- **结果**：响应 `content.reloaded[]`（`type@version` 身份列表）＋ `content.retained[]`（拒绝新绑定项）＋ `content.persisted`

**判据（全部可复跑，原始输出见 PR 正文）**
- V1 `npx vitest run tests/deploy/content-reload.test.ts tests/routes/reload.test.ts` ⇒ **exit 0**（8 passed）
- V2 **真跑生效**：真 HTTP POST ⇒ `content.reloaded` 含 11 项真身份（`sentinel@1.0.0` … `department@1.0.0`）——**不是"字段存在"**
- V3 **失败隔离**：注入"1 成功 1 失败"⇒ 坏项进 `retained[]` 点名原因 ＋ `degraded=true` ＋ **不抛**
- V4 **标识持久化**：状态文件真落盘；`bound[]` 只含本次真绑定项、`rejected[]` 留失败项
- V5 **写失败不抛**：状态写入失败 ⇒ `persisted=false` ＋ `errors[]` 外传 ＋ **不回滚**已成功的重扫

---

## 架构层: `src/deploy/`（内容面装配，宪章 §5.6）；接线点 = 代码层 L1 `src/routes/`

## Done 标准

- [x] verify: npx vitest run tests/deploy/content-reload.test.ts tests/routes/reload.test.ts
- [x] verify: bash scripts/check-architecture.sh
- [x] verify: npx tsc --noEmit -p tsconfig.json
- 说明：真 HTTP 端点返回真绑定身份；改坏即红已在**真件**上实证（见 PR 正文）

## 自检 5 问
1. **接线检查**：新 export `reloadContentTypes` / `resolveBindingStatePath` / `CONTENT_BINDING_STATE_*` ⇒ 生产消费者 = `src/routes/reload.ts:4 步`（真调用，非空 import）；`tests/**` 亦引用（不计入门禁口径）。
2. **异常处理**：`clearLoaderCaches` 逐项 try/catch（log.warn + 进 errors[]，不中断其余项）；`persistContentBindingState` catch → log.warn + 返回 false + 错误外传；`readContentVersion` catch → log.warn + 返回 undefined（读失败不升级为红）。**本模块对外永不抛**。
3. **类型安全**：`as any` / `as never` / `as unknown as` = 0（`npx tsc --noEmit` 本文件 0 错）。
4. **测试质量**：8 例真 `expect()`，覆盖正常/降级/边界（写失败、连续两次、落点解析优先级）；**无桩管线**（真 express + 真 HTTP + 真 initContentTypes）。
5. **残留清理**：无旧文件可删；`grep -rn "content-reload" src/` ⇒ 仅 `src/routes/reload.ts` 一处 import（生产消费者存在）。
