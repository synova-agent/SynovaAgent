# Task Brief: #1463 B3+B7 — Windows 哨兵注册 protocol 'd:' + 45 次重复注册幂等

> 生成: 2026-10-09 | 分支: fix/1463-sentinel-registrar | ref: origin/main=5a6591c4a | as any: 0
> 承接: 登记件 `docs/synova/coordination/施工项登记.ts` 条目 `id: 'B3B7'`（唯一机器判据源，acceptance 见下）｜卡面 Issue #1463（离线转录 `.synova-out/card-bodies-20261009/1463.md`）
> 坐标系: 总闸 不适用 ｜ 承重件 不适用 ｜ 批次 第1批-补齐（卡面；登记件写 `第0批`，口径差异已上报）｜ 命名空间 不适用 ｜ 验证级别 L2-真跑通 ｜ 阻塞源 无阻塞（环境侧 GitHub 账号停用另记）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
Synova = AI 诊断 Agent。本任务在 **L3 洞察层** 的哨兵子系统（`src/sentinel/`，注册与加载路径）。
现状 = 双体系注册：45 个文件驱动哨兵（`extensions/sentinels/**`，loader 负责）+ 4 个内置适配器
（`src/sentinel/adapters/*-sentinel.ts`，builtins 负责）= 49 活跃。
本任务**修**（不新增能力）：① 内置适配器的「路径 → ESM 说明符」转换在 Windows 下产出 `d:` 协议；
② 注册中心对同 id 重复注册静默覆盖。

### b) 文件审计（as_of 5a6591c4a 实测）
- `grep -rn "await import(join\|replace(/\\\\/g" src/sentinel/` ⇒ 全仓仅 `src/sentinel/builtins.ts:131` 一处
  （`sentinel-loader.ts:200` 已正确使用 `pathToFileURL`）⇒ 修复面收敛到 1 处，但**转换逻辑重复实现 2 份**
  ⇒ 抽 `toImportSpecifier()` 作唯一真源（铁律 9：改完核心定义检查所有引用）。
- `grep -n "覆盖旧实例" src/sentinel/registry.ts` ⇒ `:24` 一处（B7 措辞）。
- `registerLoadedSentinels` 调用点 2 个：`src/init/file-driven-loaders.ts:72`、`src/deploy/bootstrap.ts:379`
  ⇒ 同一批 45 哨兵被登记两次 = 卡面「45 次覆盖」的根因（实测 probe 复现，见 Q3）。
- 复用/新建判定：**复用**现有 registry/loader 结构，**不**新建模块（零新文件 → 零配对测试风险）；
  判据交付物 `tests/sentinel/builtin-registration.test.ts` 为**新建**（登记件指定）。

### c) 决策
- 已有覆盖 → 复用（不引入新注册中心、不引入注册策略配置）。
- 冲突 → 无（改动面与在飞 PR #1454 / #1348 写集零交集）。
- 参考：第一性原理（说明符的 scheme 由字符串形态唯一决定，与平台无关）+ Node ESM loader 官方约束
  （只接受 file/data/node 三种 scheme）。

## Q1: 调研 — 决策链 + 执行约束

### a) 决策链
① SPEC（B3 = 说明符必须是 `file:`；B7 = 重复注册必须幂等且可观测）→
② 测试先行（新建 `builtin-registration.test.ts`，先红）→
③ 实现（抽 `toImportSpecifier` + registry 跳过计数 + loader 汇总补 skipped）→
④ 接线（`toImportSpecifier` 被 builtins 与 loader 两处生产路径调用；`getDuplicateSkipCount` 被 loader 调用）→
⑤ 验证（acceptance + 定向集 + tsc 归因 + 改坏即红）。
引用铁律 0-2（测试先行+接线）、9（核心变更 grep 传播）、24/31（降级不静默）、47/48（契约优先/测试非空壳）、
36（vitest 零失败）。

### b) 执行约束
- rule: "说明符必须由 `pathToFileURL` 产出，禁手工字符串替换平台路径"
  verify: "npx vitest run tests/sentinel/builtin-registration.test.ts（V1-d 双形态 file: 协议断言）"
- rule: "重复注册不得改变注册面实例，且必须可计数"
  verify: "npx vitest run tests/sentinel/builtin-registration.test.ts（V2-a/V2-c）"

### c) 决策参考系
参考：第一性原理（URL scheme 解析平台无关 ⇒ 可在 macOS 上逐字重现 Windows 报错）+ Node ESM 官方约束 + 收敛。
结论：把缺陷判据锚在**说明符形态**（平台无关量）而非「Windows 进程内注册结果」（本机不可核），
未核部分显式列出（判例 V-09）。

## Q2: 范围 — 正确的最简方案

做什么
- src/sentinel/builtins.ts
- src/sentinel/registry.ts
- src/sentinel/sentinel-loader.ts
- tests/sentinel/builtin-registration.test.ts
- tests/sentinel/registry.test.ts
- tests/sentinel/builtins.test.ts
- .claude/task-briefs/2026-10-09-1463-B3B7-sentinel-registration.md
- .claude/claims/1463.yaml

不做什么
- 不修改 src/cron/cron-scheduler.ts（#1454 在飞，写集不得相交）
- 不修改 src/tui-v2/（#1348 在飞）
- 不修改 scripts/audit/ 下任何文件（审计红线）
- 不修改 src/sentinel/types.ts（`SentinelRegistry.register` 接口签名保持 `void`，避免接口变更）
- 不修改 extensions/ontology/ 与 extensions/sentinels/（本卡不动哨兵定义面）

## Q3: 验收 — 入口 → 交互 → 结果

入口: `registerBuiltinSentinels()`（`src/agent/synova-agent.ts:79` 启动时调用）
     / `registerLoadedSentinels()`（`src/init/file-driven-loaders.ts:72` + `src/deploy/bootstrap.ts:379`）
处理: 磁盘路径 → `toImportSpecifier()` → `file:` URL → `await import()` → `registry.register()`（同 id 幂等跳过）
结果: 4 个内置适配器全注册；同一批 45 个文件驱动哨兵二次登记时**不覆盖**、按 warn 记「跳过 (幂等)」并累计计数；
     loader 汇总日志同时报 `registered` 与 `skipped`。

复跑实测（原始输出见 `.synova-out/evidence/`）：
- 修前（`.synova-wt-1463-base`，5a6591c4a）：`first.registered=45 / second.registered=45 / count 45→45`，
  日志 `哨兵已注册 — 覆盖旧实例` = **45 行**（与卡面「45 次」一致）。
- 修前 B3：POSIX 腿 `scanned=4, registered=4, total=4`（4/4 全绿——正因如此该缺陷只在 Windows 腿可见）；
  Windows 形态输入 `D:/…` ⇒ `protocol=d:`，`await import()` 抛
  `ERR_UNSUPPORTED_ESM_URL_SCHEME ... Received protocol 'd:'`（卡面报错原文重现）。

## 架构层: L3（洞察层）— src/sentinel/ 内部注册与加载路径；无跨层新增依赖

#CRITERIA: A

## Done 标准
- [x] 登记件 acceptance 通过（expectExit 0）— verify: npx vitest run tests/sentinel/builtin-registration.test.ts
- [x] V1 等价实证：`toImportSpecifier` 对 POSIX 与 Windows 盘符形态均产出 `file:` 协议，且真实路径说明符可被 `await import()` 消费 — verify: npx vitest run tests/sentinel/builtin-registration.test.ts -t "V1"
- [x] V1-c 卡面报错原文重现：旧实现在 Windows 形态下产出 `d:` 协议，真 node 进程 `import()` 抛 `Received protocol 'd:'` — verify: node -e "import('D:/x/y.ts').catch(e=>{process.stdout.write(e.message.split('\n')[0]);process.exit(e.code==='ERR_UNSUPPORTED_ESM_URL_SCHEME'?0:1)})"
- [x] V2 计数对照：修前 45 行「覆盖旧实例」→ 修后 45 条「跳过 (幂等)」+ `getDuplicateSkipCount()=45` — verify: npx tsx .synova-out/probe-1463-b7.ts
- [x] V3 改坏即红各一（B3 一条、B7 一条）：回退修复 ⇒ 对应用例必红，前后原始输出留档 — verify: npx vitest run tests/sentinel/builtin-registration.test.ts
- [x] 定向回归全绿 — verify: npx vitest run tests/sentinel/registry.test.ts tests/sentinel/builtins.test.ts tests/sentinel/sentinel-loader.test.ts
- [x] 类型检查无新增错误：`npx tsc --noEmit` 与基线逐行 diff 零差异 — verify: npx tsc --noEmit

### 复跑命令（原始输出见 .synova-out/evidence/）
- verify: npx vitest run tests/sentinel/builtin-registration.test.ts
- verify: npx vitest run tests/sentinel/registry.test.ts tests/sentinel/builtins.test.ts tests/sentinel/sentinel-loader.test.ts
- verify: npx tsc --noEmit
