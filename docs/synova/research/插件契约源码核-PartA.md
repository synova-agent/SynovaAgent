# 插件契约源码核 · Part A（DSH 源码逐条）

基准 checkout：`/Users/wane/src/deepseek-harness-020`（版本 0.2.0-rc.1，HEAD `4878cdabd8`，tag `dsh-v0.2.0-rc.1`，`git rev-parse` / `git describe` 实测）。以下所有 file:line 均指该 checkout，除非另注明 `-017`。cordis 实际位置：**`vendor/cordis/`**（包名 `@deepseek-ai/cordis`，version 4.0.4，见 `vendor/cordis/package.json:3-4`），为 pnpm workspace 成员（`pnpm-workspace.yaml:2` `- vendor/*`）。

标注：【实读】= 本 session 用 read/grep 直接读源码；【推断】= 由实读内容推理；【未核实】= 未读到。

---

## ① plugin-compatibility.ts —— 兼容判定【实读，全文件 103 行】

| 契约条款 | DSH 实现（file:line） | 判定 |
|---|---|---|
| 只读 peerDeps、不 import 插件代码 | 文件头注释即声明 `Evaluate plugin dsh peer requirements without importing plugin code`（`plugin-compatibility.ts:1`）；实现只 `JSON.parse(fs.readFileSync(...))` 读 manifest（`:46-48`），无动态 import | 【一致】 |
| 导出函数签名 | `getDshRuntimeVersion(): string`（`:44`）；`evaluatePluginCompatibility(manifest: object, exemptions: Readonly<Record<string, readonly string[]>> = {}, runtimeVersion = getDshRuntimeVersion()): PluginCompatibility \| undefined`（`:61-65`）；`pluginCompatibilityWarning(issue: PluginCompatibility): string`（`:96`） | 【一致】 |
| semver.satisfies 参数 | `semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })`（`:77`）—— prerelease 参与范围判定 | 【一致】 |
| workspace: 协议处理 | `['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtimeVersion : range`（`:76`）—— 三种 workspace 协议直接替换为当前运行时版本（即恒满足，除非 runtime 本身非法） | 【一致】 |
| 只检查 dsh 系 peer | `name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')` 跳过（`:75`） | 【一致】 |
| 豁免机制 | `exemptions` 键为精确 `name@version`，值为运行时版本数组；`exempted = exemptedVersions?.includes(runtimeVersion) === true`（`:84-86`）；提示语指向 `dsh plugin allow-version`（`:101`）；实际豁免文件读取在 `profile-compatibility.ts`（`compatibility-preflight.ts:97` 调 `readProfileCompatibility`） | 【一致】 |
| 返回值结构 | `PluginCompatibility { name, version, runtimeVersion, peers: Record<string,string>, exempted: boolean }`（`:8-15`）；无冲突返回 `undefined`（`:81`） | 【一致】 |
| fail-closed | manifest 无 `peerDependencies` → `undefined`（`:68`）；但字段畸形（peerDependencies 非对象、range 非字符串、不兼容却缺 name/version）→ throw（`:69,:73,:34`）——由 ③ 转为 deny | 【一致】 |

**推翻证据**：若 `plugin-compatibility.ts` 出现 `import()`/`require` 插件入口，或 satisfies 无 `includePrerelease`，则上列判定作废。

## ② app-boot/src/index.ts —— 注册 / 失败分类 / fail-loud【实读，关键段】

| 契约条款 | DSH 实现 | 判定 |
|---|---|---|
| 注册调用链 | `boot()` → `await ctx.plugin(Loader)`（`index.ts:1001`，cordis `RegistryService.plugin`，`vendor/cordis/src/registry.ts:316`）→ `mountRootInclude()`（`index.ts:1004`，定义 `:538-585`）→ `ctx.loader.create(rootInclude)`（`:579`）挂 `cordis:include` 根条目；Include/Group 注册为 builtin（`:545-563`） | 【一致】 |
| 失败分类：必需 vs 可选 | `requiredStartupEntryIds` 集合：agent-loop/webserver/modules/connection/headless-runner/acp/sdk-jsonrpc-server（`:746-754`）+ 根 Include（`:931`）。`auditStartupEntries`（`:925-939`）：必需条目 inactive → throw `StartupError`（`:933-937`）；仅可选失败 → `warn(activationDiagnostic(...))` 且成功兄弟继续运行（`:938`） | 【一致】 |
| 重新加载时的"新引入 vs 既有"失败 | `reconcileProfilePatches`（`:273-302`）：先快照 previousFailures/previousFibers（`:278-284`），patch 后 `introduced = failures.filter(...)` 与旧失败按 entry+fiber+options+diagnostic 逐项比对（`:293-295`）；新失败 → throw（`:296`）；旧 fiber 新报错且原先未 failed → 也 throw（`:297-299`）；其余返回诊断字符串 | 【一致】 |
| fail-loud 守卫完整实现 | `installFailLoud(binName, proc = process, release?)`（`:679-728`）：`unhandledRejection` → label `fatal load failure`（`:715-719`）；`uncaughtException` → `fatal uncaught exception`（`:720`）；report：stderr 写 `inspect(err,{depth:4})`（`:691`）→ 无 release 则 `exit(1)`（`:692-695`），有 release 则 `Promise.race([release(), setTimeout(FAIL_LOUD_RELEASE_TIMEOUT_MS=2000)])` 后 `exit(1)`（`:696-713`，超时常量 `:637`）；latch `exiting` 防二次报告（`:684-690`）；Loader rc.5 已折叠的 activation 拒绝经 `assembledActivationRejections` 计数豁免一个 checkpoint（`:609-631,:716`） | 【一致】 |
| 降级路径：跳过 vs 退出 | 挂载前：兼容性 deny → 行级 `disabled`（见③，非退出）。挂载后：非必需失败 → 警告继续（`:938`）；必需失败 / 根 Include 失败 → `StartupError` → `boot()` catch 中 `await ctx.fiber.dispose()` 后重抛（`:1014-1034`）；启动后任何 unhandled rejection → fail-loud exit(1) | 【一致】 |

**推翻证据**：若 `auditStartupEntries` 对必需 id 缺席/disabled 也 throw（现为忽略，`:915` 注释），或 installFailLoud 不设 exitCode 1，判定作废。

## ③ compatibility-preflight.ts —— 前置闸门【实读，全文件 187 行】

| 契约条款 | DSH 实现 | 判定 |
|---|---|---|
| 导出签名 | `prepareProfileEntries(ctx, entries: readonly EntryOptions[], parentURL: string \| undefined, binName = 'dsh'): EntryOptions[]`（`:74-76`）；`prepareProfilePatches(ctx, patches: PatchOptions[], parentURL: string, binName = 'dsh'): PatchOptions[]`（`:180-182`）；内部 `preflight`（`:89`） | 【一致】 |
| deny-not-crash | `deny()` 把 `row.disabled = true`、group 置 false、stderr 报告（`:114-118`）；denial 判定调用 ① 的 `evaluatePluginCompatibility`，`issue === undefined || issue.exempted` 才放行（`:105-106`）；校验抛错也转为 deny（"cannot be validated" 理由，`:107-112`）——**不合规 → deny，不 crash** | 【一致】 |
| 挂载前执行 | 注释明言 "Admission runs before the composed tree mounts"（`:77-78`）；实际调用点在 `mountRootInclude` 里 `ctx.loader.create` 之前：`prepareProfilePatches(ctx, ...)` 于 `index.ts:569`，`loader.create` 于 `index.ts:579` | 【一致】 |
| 与 ① 的关系 | ③ 调 ①：`compatibility-preflight.ts:14` import，`:105` 调用。执行顺序：preflight（读 manifest+豁免）→ 决定 disabled → Loader 才 import 代码 | 【一致】 |
| Include/group 递归 | group 行与 `cordis:include` 的子文件递归 walk（`:119-167`），native Include 整体 deny（"file is never rewritten"，`:162`）；动态 include（path 非字符串/非 yml/json）不判（`:144-147`） | 【一致】（边界：无法判定的动态 include 保持 Loader 自身行为） |
| 非 profile 上下文 | `ctx.get('profileContext') === undefined` → 原样返回（`:94,:183`）——嵌入方不带 profile 闸门 | 【有偏差（有意为之）：preflight 仅对 profile 启动生效；非 profile 嵌入无前置闸门，兼容问题回落到运行时警告/fail-loud】 |

**推翻证据**：若 deny 路径中出现 `process.exit`，或 `loader.create` 先于 `prepareProfilePatches` 执行，判定作废。

## ④ config-schema/document.ts + --dump-config-schema【实读】

| 契约条款 | DSH 实现 | 判定 |
|---|---|---|
| generateConfigSchema 输入/输出 | 入：`profile: Profile, layers: readonly PatchOptions[][], installAnchor: string`；出：`Promise<ConfigSchemaDump>`（`config-schema/index.ts:21-25`）。不挂载插件、不求值 `!!js`（`:10-13` 注释）；内部 `composeEntries` + `createRuntimeResolution` + `collectConfigSchemas`（`:33-35`） | 【一致】 |
| x-cordis.complete 与 exit code | `complete` = 无 error 级 diagnostic ∧ 无 partial/unsupported/error 状态条目 ∧ 无多 schema 名字冲突（`document.ts:161-166`）；CLI 侧 `if (!dump['x-cordis'].complete) process.exitCode = 1`（`apps/cli/src/dump-config-schema.ts:47`） | 【一致】 |
| --dump-config-schema CLI 入口 | `runDumpConfigSchema(profile, patches, fromDefaultProfile?)`（`dump-config-schema.ts:25-29`）；期间 stdout 重定向到 stderr 防插件顶层输出污染 JSON（`:33-41`）；诊断写 stderr（`:43-46`） | 【一致】 |
| keyless（不依赖具体 key） | schema 按插件名条件化：`entryRules` 以 `name: { const }` 分支（`document.ts:127`），未知名落到 `unknownConfig`（`:55,:103`，注释明言"unknown configuration, not a prohibition"）；patch 规则按 id 索引当前树（`:137-152`）；disabled/dormant 行不要求 config（`:113-126`）。文档整体是"收集到什么就约束什么"的开放 schema | 【一致】 |

**推翻证据**：若 document schema 对未收集名字给出 `additionalProperties: false`，keyless 判定作废（实读为开放）。

## ⑤ 🔴 cordis 插件接口（vendor/cordis/src/registry.ts，实读全文件）【实读】

| 契约条款 | DSH 实现 | 判定 |
|---|---|---|
| 插件完整接口 | `Plugin<T> = Plugin.Function \| Plugin.Constructor \| Plugin.Object`（`registry.ts:92-95`）。`Base` 共享元数据（`:100-111`）：`name?: string`（仅诊断/日志名）；`Config?: StandardSchemaV1<any,T>`（standard-schema 校验器）；`inject?: Inject`；`provide?: string \| string[]`；`intercept?: Dict<boolean>`。**无 `definePlugin` 助手**——三种裸形状即接口 | 【一致（字段集）/ 无 definePlugin 对应物】 |
| apply 签名 | Object 形状 `apply(ctx: Context, config: T): any`（`:132`）；Function 形状 `(ctx, config) => any`（`:121-123`）；Constructor `new (ctx, config)`（`:127`）。返回值当 Effect 处理（disposer / promise / iterable，见 fiber.ts `:83-93`） | 【一致】 |
| inject 语义 | `Inject = (keyof M)[] \| { [K in keyof M]?: M[K] }`（`:19`）：数组=纯依赖；对象=依赖名→intercept 配置。`Inject.resolve` 归一为 `Dict<any>`（`:71-88`）。fiber 中解析：构造时逐名 `_checkImpl`，任一服务缺席 → epoch=INACTIVE → PENDING（`fiber.ts:314-319,:597-623`）；服务实现变化经 `internal/status` 触发 `_refresh` 重算 epoch，跨 INACTIVE 边界即 reload/unload（`fiber.ts:611-639`）——**依赖驱动的活性，不是一次性解析** | 【一致】 |
| registry.plugin 流程 | `RegistryService.plugin`（`:316-336`）：resolve callback → `ctx.fiber.assertActive()` → 建/复用 runtime（callback 为身份键）→ `new Fiber(ctx, config, Inject.resolve(inject), runtime, stack)` → 返回带 then 的包装 | 【一致】 |
| 与 pnpm workspace 的关系 | `workspace:~` 等**不在 cordis 内处理**——cordis 只见 pnpm 装好的实体包。兼容判定侧把 `workspace:^/~/ *` 视作"当前 runtime 版本"（`plugin-compatibility.ts:76`【①已核】）；`pnpm-workspace.yaml:2` 把 `vendor/*` 纳入 workspace，故仓内 `workspace:~` 解析到 `vendor/cordis`（schedule package.json:66 实测 `workspace:~`） | 【一致（分工：pnpm 管链接，plugin-compatibility 管语义）】 |

**关键发现**：cordis 的"插件"是极简三形状 + 元数据；`name` 仅是诊断名，**服务身份靠 `provide`/reflect，不靠 name**；inject 是持续约束（服务消失即自动卸载）。

**推翻证据**：若 `vendor/cordis/src/registry.ts` 之外另有 definePlugin/Plugin 主定义（已 glob 全 src，无），判定作废。

## ⑥ packages/bundle/base/cordis.patch.yml【实读，529 行，关键段全读】

| 契约条款 | DSH 实现 | 判定 |
|---|---|---|
| 典型行字段 | `- id: session-title` + `name: '@deepseek-ai/dsh-session-title'` + `config: {fallbackMaxWords: 5, ...}`（`cordis.patch.yml:55-60`）；结构 = id/name/config/disabled（group 见其他 bundle） | 【一致】 |
| 条件 disabled | `disabled: !!js "!ctx.get('profileContext')"`（`:22,:30,:99,:103`）；平台条件 `disabled: !!js process.platform === 'win32'`（`:237,:269`）与 `!== 'win32'`（`:243,:273`）；环境条件 `mode: !!js process.env.DSH_TELEMETRY_MODE \|\| 'FEEDBACK_ONLY'`（`:207`） | 【一致】 |
| base 内不可卸载 | 无 `disabled` 字段的行默认启用（timer :24、llm :34、session :40、agent :74 等）；但"不可卸载"仅是默认态——上层 patch 可按 id 覆写 disabled（文件头注释 :2-4 "Later bundle patches and the user's profile cordis.patch.yml address these rows by id, last write winning"；tool-ralph :443-451 注释演示 `disabled: false` 恢复）。base 内默认关闭的：tool-plugin-manager(:18)、skill-badge(:302)、tool-ralph(:449) | 【有偏差（措辞）：base 无"硬不可卸载"行；只有默认值 + 最后写胜的覆写体系。真正强制的是启动审计的 requiredStartupEntryIds（②），不在 patch yml 里】 |
| 叠加顺序 | 文件头 :1-10：base 是"ONE insert over the empty profile root"；模式 bundle 与用户 `cordis.patch.yml` 后置按 id 定位、每行最后写胜；模式差异行不放 base（整 config 替换不合并）。总顺序（document.ts $comment :159）：**bundle → profile → home → CLI** | 【一致】 |

**推翻证据**：若 Loader/include 对 patch 引入 `deep-merge`（实读注释与 `document.ts:29` 明言 wholesale replace），"整替换"判定作废。

## ⑦ 插件形状样本【实读】

**Host：`packages/schedule/schedule/src/index.ts`（class 形状）**
- `export default ScheduleService`（`:462`）——默认导出类即 Constructor 插件。
- `ScheduleService extends TypertRemoteService`（`:100`），`static inject = ['agents','sessions','tools','storageDomain','sessionController','sessionPersistence']`（`:101`）；`static Config: z<Config>`（`:103-106`）。
- `constructor(ctx: Context, config: Config)`（`:120`）——cordis 以 `new callback(ctx, config)` 实例化（`fiber.ts:251-257`，构造后跑 `symbols.initHooks` 与 `[symbols.init]`）。
- ctx 用法【推断自实读】：`declare module '@deepseek-ai/cordis'` 扩展 `Context.schedule`（`:65-70`）声明服务面。判定：【一致】

**Client：`packages/client/ui-layout/src/client/index.ts`（object 形状）**
- `export const inject = ['slots','theme','locale','shortcuts']`（`:143`，注释 :142 说明 loader 把模块全部导出当 object 插件）。
- `export function apply(ctx: ClientContext): void`（`:151`）——loader 调 `plugin.apply`（`registry.ts:9,:226`）。
- Client 特有：无默认导出、无 name；主体是两个 `ctx.effect(...)`（`:155-206,:210-218`），内含 `ctx.slots.register({name:'root', children:{...}, store}, AppFrame)`（`:171-182`）声明五个子 slot、`ctx.reflect.provide('layout', ...)`（`:170`）、`ctx.shortcuts.register`（`:183`）、`ctx.locale.register`（`:152`）；slot 类型经 `declare module '@deepseek-ai/dsh-client-ui-slots'` 的 `SlotMap` 声明（`:42-114`）。判定：【一致】

**推翻证据**：若 client 侧另有 apply 之外的 loader 专有入口函数名，判定作废（实读仅 apply）。

## ⑧ 🔴 fiber 生命周期（vendor/cordis/src/fiber.ts，实读全文件 754 行）【实读】

| 契约条款 | DSH 实现 | 判定 |
|---|---|---|
| 创建 | `new Fiber(parent, config, inject, runtime, stack)`（`fiber.ts:222-228`）：`uid = registry.counter`（`:235`）；`ctx = parent.extend({ fiber: this })`（`:236`）——**fiber 的上下文是父上下文的扩展**；inject 项带配置时写入 `ctx[Context.intercept]` 原型链（`:238-245`）；`execute` 闭包区分构造器/函数回调（`:250-261`）；`dispose` 挂到 `parent.fiber.effect` 上（**:265-297**——子 fiber 生命周期钉在父 fiber 的一个 effect 里，父卸载必卸子）；发 `internal/plugin` 事件（`:302`）后逐名 `_checkImpl` + `_refresh`（`:314-319`） | 【一致】 |
| 激活 | `_refresh`（`:611-623`）：全部 inject 服务在位 → epoch 变具体串，跨过 INACTIVE → `_setEpoch` → `_reload()`（`:646-673`）：`await Promise.resolve()` 微任务屏障（防过期 epoch，`:650-654`）→ `config = _resolveConfig`（经 `internal/config` waterfall + `resolveConfig` schema 校验，`:641-644,:655`）→ **`await this._execute(this._runner)` 即调用插件 apply/构造**（`:656`）→ 成功清 `_error`；失败则 log + `_error = reason` + epoch 回 INACTIVE（`:659-664`）→ `_updateState` 置 FAILED/ACTIVE（`:665-672`）。**apply 在 LOADING 阶段执行**（`_setEpoch` 先返 `FiberState.LOADING` 再跑 `_reload`，`:630-634`） | 【一致】 |
| 销毁 | `dispose()`（构造时定义 `:265-297`）：清 uid → `emitPluginDisposed` → 从 runtime.fibers 移除（最后一个则删 runtime 记录）→ `_setEpoch(INACTIVE)` 触发 `_unload()`（`:675-696`）：**逆序并发清 `_disposables`**（`Promise.all(clear().map(...))`），单个 disposer 失败仅 `ctx.logger.error`，不阻断其余（`:676-686`）；`await()`（`:704-710`）排空 inertia 后重抛 `_error`。root fiber 特例：uid=0、恒 ACTIVE、dispose=restart（`:320-332`） | 【一致】 |
| 失败的隔离性 | 插件失败只落在该 fiber 的 `_error`/FAILED（`:662`），异常被吞成日志，**不向外抛、不触碰兄弟 fiber**；`restart()`/`update()`（`:718-753`）仅作用于自身。进程级放大只发生在 DSH 层：审计把必需条目失败升级为 StartupError（②），启动后 rejection 走 fail-loud | 【一致】 |
| 上下文隔离 | 每 fiber 一个 `parent.extend({ fiber })` 的 ctx（`:236`）；服务可见性按 reflect 原型链沿 fiber 树过滤（`_updateState` 只 notify `impl.fiber === this` 的键，`:590-594`）；`store` 为本 fiber 的服务实现快照（`:647,:687`）；intercept 配置经原型链叠加（`:240-244`）。**没有进程/realm 级硬隔离**——同进程 JS 作用域共享；`isolate` realm 属 Loader/Group 层（`index.ts:559-563` 注释），未在本次实读范围 | 【一致（软隔离）/ isolate 细节【未核实】】 |

**关键发现**：fiber 生命周期的核心不变量是 **epoch**——依赖集合的指纹（`':' + impl.fiber.uid` 拼接，`:613-622`）。依赖变动重算指纹，跨 INACTIVE 边界自动 reload/unload，这使 inject 成为持续契约而非启动期检查。子 fiber 的 dispose 是父 fiber 的一个 effect（`:265`），所以"父死子必死"由结构保证。

**推翻证据**：若 `_reload` 失败路径存在向上 propagate（实读为 logger.error + 本地 `_error`，`:661-663`），隔离判定作废。

---

## 八项一行结论

1. ① 兼容判定：**【一致】**（peerDeps-only、includePrerelease、workspace 三协议、精确豁免）
2. ② 注册/失败分类/fail-loud：**【一致】**（必需 throw / 可选 warn、新旧失败比对、stderr+exit(1)+release 超时）
3. ③ 前置闸门：**【一致】**（deny-not-crash，挂载前；小偏差：非 profile 嵌入无闸门）
4. ④ config schema：**【一致】**（keyless 开放 schema、complete↔exitCode 1）
5. ⑤ cordis 插件接口：**【一致，无 definePlugin 对应物】**（三形状 + Base 元数据，apply(ctx, config)）
6. ⑥ base patch：**【有偏差】**——无"硬不可卸载"行，只有默认值 + 最后写胜覆写；强制力在 requiredStartupEntryIds
7. ⑦ 插件样本：**【一致】**（Host=class+static inject/Config；Client=module 级 inject+apply+slots）
8. ⑧ fiber 生命周期：**【一致】**（epoch 驱动、apply 在 LOADING、失败本地化、父子 dispose 结构保证；isolate realm 未核实）

## 口径声明

```
基准：0.2.0-rc.1（HEAD 4878cdabd8，tag dsh-v0.2.0-rc.1，git 实测）
路径：/Users/wane/src/deepseek-harness-020（只读，未修改任何文件；-017 未使用）
日期：2026-09-XX
取码登记：已回填（本文件全部 file:line 为本 session 实读输出，未引用 01/04/06 任何结论）
```
