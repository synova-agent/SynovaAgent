# D870-C 切片对照表｜模型选择与切换（重点切片）

> 产出物：`docs/synova/research/official-model-switching.md`
> 本件定位：把官方参照系里**模型选择/切换**的既有实现思路，转成我方**可直接落成的必测用例**与**可执行借鉴项**。
> 本件不含任何我方产品代码改动；不含任何依赖引入。

---

## 〇、参照系（唯一，钉死）

```
/Users/wane/src/deepseek-harness/  @  tag dsh-v0.1.6-alpha.2  @  commit ddefc45fbc7f8e46dd73185e68295696d1297887
```

### 〇-1 参照系身份实测（原始输出）

```
$ git -C /Users/wane/src/deepseek-harness rev-parse HEAD
ddefc45fbc7f8e46dd73185e68295696d1297887

$ git -C /Users/wane/src/deepseek-harness describe --tags --exact-match HEAD
dsh-v0.1.6-alpha.2

$ git -C /Users/wane/src/deepseek-harness status --porcelain | wc -l
       0

$ grep -n '"version"' /Users/wane/src/deepseek-harness/package.json
3:  "version": "0.1.6-alpha.2"
```

参照系树本体：`drwxr-xr-x@ 66 wane staff 2112 9月 21 23:37 /Users/wane/src/deepseek-harness`（本件全程只读）。

### 〇-2 ⚠️ 版本错配警示（**四处版本彼此不一致，凡引用官方行为必须标明取自哪一处**）

| 断面 | 实测版本 | 实测命令与原始输出 |
| --- | --- | --- |
| checkout（本件唯一参照系） | **0.1.6-alpha.2** | `grep -n '"version"' package.json` → `3:  "version": "0.1.6-alpha.2"` |
| 打包运行时（.app 内 dsh） | **0.1.6-alpha.1** | `grep -n '"version"' "$HOME/Library/Application Support/io.github.hairyf.deepseek-harness-desktop/dependencies/dsh/package.json"` → `3:  "version": "0.1.6-alpha.1"` |
| .app 壳 | **0.15.7** | `/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "/Applications/Deepseek Harness Desktop.app/Contents/Info.plist"` → `0.15.7` |
| updates 已下载 | **0.15.8（未安装）** | `ls ~/Library/Application\ Support/io.github.hairyf.deepseek-harness-desktop/updates/` → 含 `Deepseek.Harness.Desktop_0.15.8_aarch64.dmg`（9月20 23:32；.app 仍为 0.15.7 = 未安装） |

```
checkout 0.1.6-alpha.2 ｜ 打包运行时 0.1.6-alpha.1 ｜ .app 壳 0.15.7 ｜ updates 已下载 0.15.8 未安装
```

**本件全部 file:line 只取自 checkout（0.1.6-alpha.2）。** 打包运行时为 0.1.6-alpha.1，与 checkout 差一个补丁号，**本件未对打包运行时做任何取证**；若据本件改打包运行时行为，须先在 0.1.6-alpha.1 上复核。

### 〇-3 本件数字口径（canonical：`git grep`，tracked only）

全部计数一律用 `git grep`（只扫 tracked 文件），**不使用文件系统 `grep -rn` 直接计数**（后者会把 untracked 构建产物如 `*.d.ts` 算进来，数字偏高）。

```
$ cd /Users/wane/src/deepseek-harness
$ git grep -n -E '<ERE>' -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' 'packages/**/*.tsx' | wc -l
```

| ERE | canonical 行数（tracked） |
| --- | --- |
| `(switchModel\|setModel\|selectModel\|modelId)` | **119** |
| `(defaultModel\|default-model)` | **115** |
| `(tokenMeter\|token-meter\|tokenUsage)` | **176** |
| `(modelConfig\|model-config)` | **0** |
| `(reasoning_effort\|reasoningEffort)` | **458** |

复现命令（照抄即得）：

```
cd /Users/wane/src/deepseek-harness && git grep -n -E '(switchModel|setModel|selectModel|modelId)' -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' 'packages/**/*.tsx' | wc -l
cd /Users/wane/src/deepseek-harness && git grep -n -E '(defaultModel|default-model)' -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' 'packages/**/*.tsx' | wc -l
cd /Users/wane/src/deepseek-harness && git grep -n -E '(tokenMeter|token-meter|tokenUsage)' -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' 'packages/**/*.tsx' | wc -l
cd /Users/wane/src/deepseek-harness && git grep -n -E '(modelConfig|model-config)' -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' 'packages/**/*.tsx' | wc -l
cd /Users/wane/src/deepseek-harness && git grep -n -E '(reasoning_effort|reasoningEffort)' -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' 'packages/**/*.tsx' | wc -l
```

### 〇-4 派单件前提的实测核对（前提冻结）

派单件列了 5 个密度数字。**本件按 canonical 口径（`git grep`）重测，得 119 / 115 / 176 / 0 / 458**；派单件原列 132 / 117 / 203 / 486 / 0。

- 差异**只源于口径**（派单件原始数字来自未限定 tracked 的文件系统扫描，含 untracked 构建产物）；**关键结论 `(modelConfig|model-config) = 0` 在两种口径下均成立**。
- 派单件另附的"配置机制得另找"已被本件解决，见 §5.5：官方配置机制**不叫 modelConfig**，而是 settings 命名空间 `agent-default-model`（`packages/core/agent-default-model/src/index.ts:21`）。

### 〇-5 写集与红线声明

- 工作树：`/Users/wane/SynovaAgent/.synova-wt-d870`（分支 `feat/d870-official-baseline-study`）。
- 本件**唯一写入文件**：`docs/synova/research/official-model-switching.md`。未改 `src/**`、`scripts/control-tower/**`、`.github/**`；未引入依赖；官方树只读。
- **G1 守卫实测**（工作树内）：`grep -rn "@deepseek-ai" src/ packages/` → `[exit=1] 命中数=0`。
- **M2 冲突扫描**：全工作树 `official-model-switching` 命中 2 处，均为**声明**而非写者（`docs/synova/dispatch/D870-官方参照系学习计划-20260921.md:28`、`task-state/D870.json:10`）；同目录另有 A 切片文件 `official-electron-kernel-runtime.md`，与本件不同文件 → **写集无重叠**。

---

## 一、措辞裁定与实际落点

### 1.1 裁定内容（CTO 2026-09-21，逐字遵守）

**不得**把"第三方插件在模型切换上翻车"写成事实。凡需提及，**只能**写成「**创始人陈述（2026-09-21，无仓库文件证据）**」。

### 1.2 裁定依据的实测复核

派单件称：原指定的两件证据文件对"模型""切换"命中均为 0；全仓库"模型切换"仅 5 个无关文件命中。本件独立复测：

```
$ git show bf325e51:"docs/synova/research/研究院交接-20260918/复盘-插件推荐失误与准入标准-20260919.md" | grep -c "模型"
0
$ git show bf325e51:"docs/synova/research/研究院交接-20260918/复盘-插件推荐失误与准入标准-20260919.md" | grep -c "切换"
0
$ git show bf325e51:"docs/synova/research/研究院交接-20260918/插件尽调-三个第三方控制插件-20260919.md" | grep -c "模型"
0
$ git show bf325e51:"docs/synova/research/研究院交接-20260918/插件尽调-三个第三方控制插件-20260919.md" | grep -c "切换"
0
（两文件行数：205 / 253 —— 文件实体存在，但确无"模型""切换"字样）

$ git -C /Users/wane/SynovaAgent grep -l "模型切换" HEAD            # main HEAD 3643db6a
HEAD:.synova/skills/git-sync-pr/SKILL.md
HEAD:.dsh/skills/git-sync-pr/SKILL.md
HEAD:docs/synova/coordination/派单-D540-clone-pilot-20260827.md
HEAD:docs/synova/research/权威文档07-Agent工程能力对标-20260710/SYNOVA-RESEARCH-路线2-循环与Agent架构设计-20260710.html
HEAD:docs/synova/research/跨文档一致性审计-20260727/txt/权威文档07-Agent工程能力对标-20260710_SYNOVA-RESEARCH-路线2-循环与Agent架构设计-20260710.txt
$ ... | wc -l
       5
```

另实测：两件证据文件**均不在 main**（`git branch -a --contains bf325e51` 只列出 `chore/ingest-institute` / `rs-674` / `remotes/origin/chore/ingest-institute` 等分支）。**故上述陈述不可用作本件任何技术结论的依据。**

### 1.3 本件对该陈述的处理

本件**不依赖该陈述**：§二–§五全部结论由官方源码推导。仅在此处按裁定口径记录一次：

> **创始人陈述（2026-09-21，无仓库文件证据）**——本件不以此作为事实或推断依据。

---

## 二、官方机制总览（模型选择与切换的实际形状）

官方把"模型选择与切换"拆成**五个彼此解耦的层**，每层有独立的可观测对象。这是我方要照搬的**结构**（不是代码）：

| # | 层 | 责任 | 官方实现锚点 | 可观测对象 |
| --- | --- | --- | --- | --- |
| 1 | **配置层**（默认模型） | 无会话选择时的默认值；持久化到 settings | `packages/core/agent-default-model/src/index.ts:21,90-106` | settings 命名空间 `agent-default-model`；`currentSelection()` |
| 2 | **入口层**（选择器 UI） | 双入口（popup + composer seat）共享**同一** per-session directory | `packages/client/ui-model-selection/src/client/service.ts:69-112`、`directory.ts:16-36` | `ModelDirectoryState{current,routable,groups,failures,status,error}` |
| 3 | **校验/落事件层**（Host） | 校验路由 → 归一化 → 落 `model/selection` 事件 → 缓存 | `packages/api/session-controller/src/commands.ts:133-169`、`agent.ts:333-336` | `SessionSelectModelValue{selected}`；session 事件 `model/selection` |
| 4 | **装配/生效层** | 装配时快照，请求时套用快照 → 切换只在**后续 step** 生效 | `packages/core/agent/src/model-selection.ts:26-31,77-121` | `ModelSelectionRef{current,assembled}`；公告消息 |
| 5 | **持久投影层** | 从事件流折叠出 durable 选择与"待应用"意图 | `packages/api/session-controller/src/model-selection-projection.ts:35-68` | `ModelSelectionProjectionState{lastUsed,pending}`；view `{lastUsed,next}` |

### 2.1 端到端数据流（官方真实路径，逐跳有 file:line）

```
[配置] settings ns 'agent-default-model'
        packages/core/agent-default-model/src/index.ts:21
   │  currentSelection() :90-92
   ▼
[选择器] 双入口 → ModelDirectoryResolver.directoryFor(sessionId)
        packages/client/ui-model-selection/src/client/service.ts:69-85
   │  同一 session 同一 ModelDirectory 实例（WeakMapWithValues）:76-85
   ▼
        ModelDirectory.select(selection)
        packages/client/ui-model-selection/src/client/directory.ts:89-114
   │  ++generation（代次守卫）:91；status='selecting' :92
   ▼
[Host]  session.selectModel RPC
        packages/api/session-controller/src/index.ts:254-256
   │
        ApiSessionCommands.selectModel(request)
        packages/api/session-controller/src/commands.ts:133-169
   │  ctx.llm.resolveCallConfig(...)  ← 唯一校验点 :137-143
   │  agents.selectForNextRequest(agent, selected)  :151
   │      → session.append('model/selection', selection)  agent.ts:334
   │      → selection.current = selection              agent.ts:335
   │  ctx.agentDefaultModel.saveSelection(selected)    :153（失败仅 warn :154-158）
   ▼
[持久投影] sessionProjections.register(modelSelectionProjection)
        packages/api/session-controller/src/model-selection-projection.ts:81-83
   │  apply(): 'model/selection' → pending ; 'request/header' → lastUsed 并清 pending
   │  :39-56
   ▼
[装配]  installModelSelection(agentCtx, selection)   ← 三个入口共用
        packages/core/agent/src/model-selection.ts:76
   │  Web   : packages/api/session-controller/src/agent.ts:323
   │  ACP   : packages/acp/acp/src/model-control.ts:59
   │  headless: packages/bundle/headless/src/index.ts:340
   │
   │  system-prompt/assemble → 快照 current 到 assembled  :77-90
   │  agent/request         → 套用 assembled（丢弃继承 effort） :91-107
   │  agent/pre-step        → 路由变更则追加 durable 公告 :108-121
   ▼
[消费]  request/header 事件 → consumeSelection() 清 pending 缓存
        packages/api/session-controller/src/index.ts:160-167
        packages/api/session-controller/src/agent.ts:314-320
```

### 2.2 接线证明（**引用点**，非"grep 命中即存在"）

坑清单要求：证明"接线了"必须找到**引用（调用）点**。下表每行给出**实际调用处**（不是声明处）：

| 被调用物 | 声明处 | **实际调用处**（判别性引用点） |
| --- | --- | --- |
| `selectForNextRequest` | `agent.ts:333` | `commands.ts:151`（生产路径，非测试） |
| `consumeSelection` | `agent.ts:346` | `index.ts:161`（`session/event` 监听器内，`request/header` 分支） |
| `installModelSelectionProjection` | `model-selection-projection.ts:81` | `index.ts:122`（Host 插件注册路径） |
| `installModelSelection` | `core/agent/src/model-selection.ts:76` | `session-controller/src/agent.ts:323`、`acp/acp/src/model-control.ts:59`、`bundle/headless/src/index.ts:340` |
| `AgentDefaultModelConfig.saveSelection` | `agent-default-model/src/index.ts:100` | `commands.ts:153` |
| `directoryFor` | `service.ts:69` | `ModelSelect.tsx` 座位注入路径 + `/model` 命令入口（`browser-plugin.client.spec.ts:209` 断言两者均注册） |
| 公告消息 `modelSwitchNotice` | `core/agent/src/model-selection.ts:41` | `model-selection.ts:118`（`agent/pre-step` 内），并被 `agent-loop/tests/system-prompt-admission.spec.ts:212-222` 断到精确文本 |

**判别力说明**：这些引用点均在生产非测试路径上（`src/` 内），删掉其一会改变可观测行为（§四每条用例的"失败判据"即是该行为的报红条件）。仅"字符串存在"不构成本件任一结论的依据。

---

## 三、官方已实现 vs 官方无实现（边界，先划清）

| 能力 | 官方状态 | 证据 |
| --- | --- | --- |
| 选择器（UI 双入口 + 配置默认） | **已实现** | `service.ts:69-112`、`ModelSelect.tsx:338-349`、`agent-default-model/src/index.ts:21,90-106` |
| 会话中切换（`pending`/`lastUsed` 折叠） | **已实现** | `model-selection-projection.ts:39-56,65` |
| 切换只在**下一次装配**生效（不打断在飞请求） | **已实现（且是刻意设计）** | `core/agent/src/model-selection.ts:61-63`（"takes effect on a later step instead of splitting the two surfaces"） |
| 切换失败回退（校验先于落事件 → 失败零副作用） | **已实现** | `commands.ts:137-151`、`session-models.host.spec.ts:479-505` |
| **持久化失败不阻断切换**（仅 warn） | **已实现** | `commands.ts:152-158`、`session-models.host.spec.ts:586-594` |
| 限流（同 provider 作用域重试 + Retry-After 上界） | **已实现** | `llm/llm/src/retry-policy.ts:17-25,149`、`llm-retry/tests/retry.spec.ts:368-397` |
| 配额耗尽 vs 瞬时限流分类 | **已实现** | `llm/llm/src/error.ts:88-99` |
| 上下文能力差异（contextWindow / inputModalities） | **已实现（声明 + 准入校验）** | `llm/llm/src/types.ts:309,313`、`commands.ts:338-344` |
| 多 provider一致性（单一校验器 + 局部失败隔离） | **已实现** | `commands.ts:137` / `acp model-control.ts:225` / `headless index.ts:340`；`types.ts:144-150` |
| 切换期 token 计量 | **已实现，但官方明文声明允许不一致** | `token-meter/src/projection.ts:22-28` |
| 子代理模型允许清单（治理） | **已实现** | `subagent/tool-subagent/src/model-selection-state.ts:31-48` |
| 并发写冲突（writer-held / settings CAS） | **已实现** | `agent.ts:219`、`ui-settings-models/src/client/operations.ts:96-101` |
| **每模型"工具调用能力"声明** | **官方无实现** | `git grep -E '(supportsTools\|toolCallSupport\|supportsToolCall\|toolCapability)'` = **0**（§5.6） |
| **限流/失败后自动换模型或换 provider 兜底** | **官方无实现** | `git grep -E '(fallbackModel\|fallbackProvider\|modelFallback\|primaryModel\|secondaryModel\|escalationModel)'` = **0**（§5.6） |
| **切换即中断在飞请求并立即重发** | **官方无实现** | `selectModel`（`commands.ts:133-169`）内无 cancel/abort；取消是**独立 RPC** `cancel`（`commands.ts:499-511`） |
| **切换的显式"回滚"操作/事件** | **官方无实现**（回滚是"失败不落事件"的隐式 no-op，无 revert 事件与通知） | `model-selection-projection.ts:39-43`（只有 `model/selection` 与 `request/header` 两个输入） |

---

## 四、必测用例（12 条，覆盖派单件要求的全部 9 个面）

每条四要素齐备：**前置状态 → 操作 → 期望断言（可观测对象）→ 失败判据（报红条件）**。
断言对象一律是可读的**状态字段 / 事件 / 计量值**，不写"表现正确"这类空断言。

---

### C1 选择器（UI + 配置）：双入口共享单一 per-session directory

- **官方依据**：`packages/client/ui-model-selection/src/client/service.ts:69-85`（`directoryFor` 以 `SessionBinding` 为键进 `WeakMapWithValues`，同 session 复用同一实例）；`packages/client/ui-model-selection/src/client/directory.ts:16-36`（状态形状）；配置面 `packages/core/agent-default-model/src/index.ts:21,90-106`。官方断言先例：`ui-model-selection/tests/browser-plugin.client.spec.ts:284`（"both entries share one directory instance per session, isolated across sessions"）、`:245`、`:270`（双向同步）。
- **前置状态**：session S 存在且 catalog `status='ready'`；`modelSelection` 投影 `lastUsed={p,m}`、`pending=null`；`agentDefaultModel.currentSelection()={p,m}`。
- **操作**：① 用 `/model` popup 入口取 `directoryFor(S)`，选择 `{p, m2}`；② 用 composer seat 入口取 `directoryFor(S)`，读其 `store.getSnapshot()`；③ 另建 session T，取 `directoryFor(T)`。
- **期望断言**：
  1. `directoryFor(S)` 两次返回**同一对象引用**（`===`）；
  2. 切换后 seat 读到的 `state.current = {p, m2}`、`state.status='ready'`、`state.error=null`；
  3. `directoryFor(T) !== directoryFor(S)`，且 T 的 `state.current` 不受 S 切换影响；
  4. `ModelDirectoryResolver.catalog` 是**跨 session 共享**的（同一次 `load()` 复用一个 in-flight Promise，见 `catalog.ts:36-40`）。
- **失败判据**：同一 session 两入口拿到不同 directory 实例；或 popup 切换后 seat 的 `state.current` 仍是旧值；或不同 session 共享了 directory（跨会话串味）；或 `load()` 对同一代次发起第二次 RPC（in-flight 未复用）。
- **官方未做的部分**：官方**不提供**"切换历史/最近使用模型列表"；`ModelDirectoryState` 无历史字段 → 我方若要"最近使用"须自研。

---

### C2 会话中切换时序与状态：代次守卫（latest-wins）

- **官方依据**：`packages/client/ui-model-selection/src/client/directory.ts:45-46`（"Latest selection operation wins; an older response never overwrites a newer one"）、`:91-113`（`++generation` → 迟到响应在 `:101-103` 被丢弃）、`:119-127`（`resetConnected` 让上一 Host 代次的在飞响应失效）。官方断言先例：`ui-model-selection/tests/catalog.client.spec.ts:35`、`:54`（invalidated generation 不发布成功也不发布失败）。
- **前置状态**：`state.status='ready'`，`state.current=A`，`generation=g`。
- **操作**：发起 `select(B)`（不 await，令其在飞）→ 立即发起 `select(C)` → 先让 C 成功返回 → 再让 B 的响应（构造为**失败**）到达。
- **期望断言**：
  1. B 的迟到失败**不写 store**：`state.status` 仍为 `'ready'`（不是 `'error'`），`state.error` 仍为 `null`；
  2. `state.current` 由 C 的投影驱动，不含 B；
  3. B 的调用返回值仍是其原始 `RemoteResult`（`ok:false` 原样透传），但 store 未被污染；
  4. 若在 B/C 在飞期间发生 Host 代次切换（`resetConnected`），则 store 的 `status` 由 `'selecting'` 回到 `'idle'`、`error=null`。
- **失败判据**：迟到的 B 响应把 `status` 从 `'ready'` 改写为 `'error'`/`'selecting'`；或把 `current` 改回 B；或 `resetConnected` 后 `status` 卡在 `'selecting'`（UI 永久 busy）。
- **备注（口径）**：`current` 的合成优先级由 `directory.ts:166` 定义为 `projected.next ?? catalog.value.default` —— 断言"谁赢"时必须指明是 store 的 `current` 还是 RPC 返回值，两者语义不同。

---

### C3 工具调用中途切换：装配快照边界（本片最关键用例）

- **官方依据**：`packages/core/agent/src/model-selection.ts:26-31`（`current`="next step that enters prompt assembly"，`assembled`="captured when the **current step** entered prompt assembly"）；`:77-90`（`system-prompt/assemble` 进入时快照 `current`→`assembled`）；`:91-107`（`agent/request` 套用 `assembled`）；`:61-63`（"a concurrent switch takes effect on a later step **instead of splitting the two surfaces**"）。官方断言先例：`packages/core/agent/tests/model-selection.spec.ts:124-142`（**同一 test 内两次改 `current`、只做一次 assemble，公告仍取快照值**）；`packages/api/session-controller/tests/session-models.host.spec.ts:451-463`（step 0 用原 config，step 1 才用新选择）。
- **前置状态**：turn=1，step=0 已记录 `request/header`，其 `config={provider:A, model:a}`；`selection.current=A`、`selection.assembled=A`。
- **操作**：在 step 0 的请求**在飞期间** `selection.current = B` → 再令下一次 `systemPrompt.assemble()` 发生 → 在同一 step 内**再** `selection.current = C` → 触发该 step 的 `agent/request` 与下一步的 `agent/request`。
- **期望断言**：
  1. **在飞 step 的请求 config 仍为 A**（套用 `assembled`，非 `current`）——切换不会"劈开"prompt 变量与请求路由两个面；
  2. 装配后该 step 的请求 config = **B**（快照值），**不是 C**（C 是装配之后才写入的）；
  3. `system-prompt/assemble` 返回的 `variables` 含 `provider/model` = 快照值（`:84-88`）；
  4. 公告消息在**下一个会被真正发出的 request** 的 step 上出现一次，文本精确为
     `[model changed: assistant turns above this point were generated by <from>; the session continues with <to>]`（`:47`），
     其中 `<from>` = **上一次记录的路由**（`agent.session.requestHeader()?.config`，`:116`），`<to>` = `assembled` 的路由；
  5. **仅 effort 变更不产生公告**（`sameRoute` 只比 provider/model，`:33-35`、`:117`）；
  6. 空工具续跑（`step:2, offered: []`）**要**公告，而空的首个决策（`step:1`）**不要**（`:114`；官方断言 `model-selection.spec.ts:179-188`）。
- **失败判据**：在飞 step 的请求被改成 B/C（等价于"劈开两个面"，即本用例要防的核心回归）；或公告用了 `current`（C）而非快照（B）；或 effort-only 切换也追加了公告（context 无谓膨胀）；或公告重复追加多条。
- **官方未做的部分**：官方**不中断**在飞请求、**不立即生效**（明文设计取舍，`:61-63`）。若我方产品要求"切换后立刻中断当前生成并重发"，**官方无实现**，须自研（见 C-21）。

---

### C4 切换失败回退（一）：校验先于落事件，失败零副作用

- **官方依据**：`packages/api/session-controller/src/commands.ts:137-143`（`resolveCallConfig` 校验）→ `:151`（**通过后才** `selectForNextRequest`）→ `:160-167`（抛错包装为 `RemoteError('session/model-unavailable', …, {provider, model})`）；`packages/api/session-controller/src/types.ts:188`（错误详情形状）；`packages/api/session-controller/src/agent.ts:333-336`（落事件与缓存写是**同一个调用**，故校验失败即两者都不发生）。官方断言先例：`session-models.host.spec.ts:479-505`（三种失败后 `currentSelection` 仍是**上一次成功值**）、`:582-584`（"A refused selection never becomes anyone's default"）。
- **前置状态**：`current=A`，投影 `lastUsed=A`、`pending=null`；`agentDefaultModel.currentSelection()=A`。
- **操作**：依次发起三种失败切换：① 未注册 provider（`provider:'missing'`）；② 已注册路由但 effort 不受支持（`effort:'medium'`）；③ adapter 自身抛错（`RemoteError`）。
- **期望断言**：
  1. 三次均 `ok:false` 且 `error.code='session/model-unavailable'`；①的 `details={provider:'missing', model:'model'}`；②的 `message` 含 `does not support reasoning effort`；③保留原 code/message（`gateway/internal`）；
  2. session 事件流中**没有新增任何 `model/selection` 事件**（直接数事件条数）；
  3. 投影 `pending` 仍为 `null`、`next` 仍 = A（不被拒的路由污染）；
  4. `agentDefaultModel.currentSelection()` 仍 = A，且 `saveSelection` 的调用次数为 0。
- **失败判据**：失败路径仍 append 了 `model/selection` 事件；或 `next`/`current` 变成被拒路由；或失败被写成"已切换"的 status；或 `saveSelection` 在失败时被调用。
- **备注**：本用例的"回退"是**隐式 no-op**（什么都没发生），官方**无** revert 事件、**无**"回退到上一个模型"的通知 —— 详见 C-06 与我方差异说明（§6）。

---

### C5 切换失败回退（二）：持久化失败 ≠ 切换失败

- **官方依据**：`packages/api/session-controller/src/commands.ts:152-158`（`saveSelection` 的失败被 catch，仅 `logger.warn`，不 rethrow）；`:159`（仍返回 `{selected}`）。官方断言先例：`session-models.host.spec.ts:562-595`（`:586-588` 注释 "Storage failing is not the selection failing: the switch already applies to this session, so the call still succeeds"，`:589-594` 断言 `ok` 且 `current` 已变）。
- **前置状态**：session 可切换；默认模型存储置为**必然失败**（settings `replace` reject，例如只读文档）。
- **操作**：`select(B)`，随后读 session 内选择与默认值。
- **期望断言**：
  1. `select` 返回 **`ok:true`**，`selected` = 归一化后的 B；
  2. session 内 `current` = B（切换**已生效**）；
  3. **产生 1 条 warn 日志**，文本含 `model selection changed for the Session but the default was not saved`（`:155-156`）；
  4. `agentDefaultModel.currentSelection()` 仍为 A（默认值未被写入）。
- **失败判据**：存储失败使 `select` 返回失败；或 `current` 未变（切换被存储故障连累）；或失败被**静默吞掉**（无 warn 日志 → 违反铁律 11 同类纪律）。
- **备注**：这条把"切换成功 + 持久化失败"这两种事实**分开表达**，是我方必须复刻的错误处理纪律。

---

### C6 限流：同 provider 作用域的重试预算与 Retry-After 上界

- **官方依据**：`packages/llm/llm/src/retry-policy.ts:17-25`（`DEFAULT_RETRYABLE_CODES` 含 `RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`/`EMPTY_RESPONSE` 五码互斥分类）、`:37-79`（`ResolvedRetryPolicy` 双模 `normal`/`always`）、`:149-177`（解析与校验：`retryableCodes` 不得为空/不得重复）；`packages/llm/llm/src/error.ts:14`（"route on this, never by parsing `message`"）、`:88-99`（`isQuotaExceededError`：终态配额 vs 瞬时限流）。官方断言先例：`llm-retry/tests/retry.spec.ts:368-397`（bounded `Retry-After` 原样使用，超上界委派）、`:464`（按失败请求的 provider 选策略）、`:532`（有限预算**作用域限定在失败 provider**）、`:425`（非 transient 不排定时器）、`:312`（有界指数 jitter 且预算耗尽即停）。
- **前置状态**：provider `P` 的策略 `{mode:'normal', maxRetries:n, retryableCodes:['RATE_LIMIT'], backoff:{initialDelayMs, maxDelayMs:M, jitterRatio}}`；测试用可脚本化 mock 端点（见 §5.5）。
- **操作**：令 `P` 依次返回：429（带 `providerRetryAfterMs=2000 ≤ M`）→ 429（带 `providerRetryAfterMs=10001 > M`）→ 429（配额耗尽文案）→ 非 transient 错误；并另起一路由 provider `Q` 的请求失败。
- **期望断言**：
  1. `providerRetryAfterMs=2000` → 调度延迟**原样 = 2000**；
  2. `providerRetryAfterMs=10001` → **不采用**，落回本地 jittered backoff（落在 `[initialDelayMs*(1-jitter), maxDelayMs]` 区间）；
  3. 配额耗尽（`isQuotaExceededError=true`）→ **不重试**；
  4. 非 transient code → **不排定时器**，直接委派；
  5. 预算耗尽 → 停止重试并失败；
  6. `Q` 的失败**不消耗** `P` 的预算，且重试记录里 `provider` 与失败请求路由一致（retry 不跨 provider 漂移）。
- **失败判据**：超上界的 `Retry-After` 被原样采用（可能挂起数小时）；或配额耗尽被判为可重试（白白烧额度）；或重试跨 provider 漂移；或一次失败把别的 provider 的预算耗尽。
- **官方无做的部分**：**限流/失败后自动切换到备用模型或备用 provider —— 官方无实现**。实测：`git grep -E '(fallbackModel|fallbackProvider|modelFallback|primaryModel|secondaryModel|escalationModel)'` → **0**（§5.6）。官方的重试**始终停留在失败的那个 provider 上**（`retry.spec.ts:464,532` 是判别性证据）。若我方要"限流即降级到备用模型"，须自研（C-20），且不得声称官方有此机制。

---

### C7 上下文与工具能力差异适配：校验落在"准入处"，不在"切换处"

- **官方依据**：`packages/llm/llm/src/types.ts:305-315`（`LlmDiscoveredModel` 只声明 `contextWindow`/`maxTokens`/`inputModalities`）、`:317-327`（`LlmModelInfo` 同上）、`:329-334`（`LlmModelContext{contextWindow}`）；`packages/api/session-controller/src/commands.ts:338-344`（**prompt 准入**时按 `inputModalities` 拒绝图片，`reason:'MODEL_DOES_NOT_SUPPORT_IMAGES'`）；本地化 `packages/client/ui-conversation/src/client/image-labels.ts:34`。官方断言先例：`session-models.host.spec.ts:648-703`（text-only + image → 拒；image-capable + image → 过）、`ui-conversation/tests/image-labels.client.spec.ts:26`。
- **前置状态**：注册两个模型路由：`text-only/plain`（`inputModalities:['text']`）与 `image-capable/vision`（`['text','image']`）。
- **操作**：① 选 `text-only/plain` 后提交含图片的 prompt；② 选 `image-capable/vision` 后提交同一图片（合法与非法 base64 各一次）。
- **期望断言**：
  1. ① → `ok:false`，`error.code='session/attachment-invalid'`，`error.details.reason='MODEL_DOES_NOT_SUPPORT_IMAGES'`；
  2. ② → 合法图片 `ok:true` 且 follow-up 被触发一次；非法 base64 → `reason='INVALID_IMAGE_BASE64'`；
  3. **切换动作本身不因能力而失败**（`inputModalities` 只影响准入）；
  4. UI 把该 reason 映射到文案键 `image.modelUnsupported` → `当前模型不支持图片，请切换支持图片的模型`。
- **失败判据**：切换时不校验、准入时也不校验 → 不支持图片的模型被塞进请求（provider 侧报错，用户看到的是"服务异常"而不是"换个模型"）；或能力校验做在**切换**处导致用户无法先切模型再发图。
- **官方无做的部分（重要）**：官方**没有每模型"工具调用能力"声明** —— `git grep -E '(supportsTools|toolCallSupport|supportsToolCall|toolCapability)'` → **0**（§5.6）。即：官方只声明 `contextWindow` 与 `inputModalities`，**工具能力差异适配是官方空白**，我方若做（切到不支持某工具族的模型时降级工具集）**必须自研**（C-22），断言不得引用官方。
- **官方另有的边界**：图片请求还有**按路由的字节预算**（`LlmImageRequestBudget`，`llm/llm/src/types.ts:336+`；超预算 → `IMAGE_OFFLOAD_REQUIRED`），本件未展开为独立用例（属 A/B 片邻域）。

---

### C8 持久化与恢复：durable fold、幂等与代次失效

- **官方依据**：`packages/api/session-controller/src/model-selection-projection.ts:35-56`（fold：`model/selection` → 写 `pending`；`request/header` → 写 `lastUsed` 且**当 pending 与之一致时清空 pending**）、`:58-68`（`key:'modelSelection'`、`init:{lastUsed:null,pending:null}`、**`stateVersion: 2`**）、`:63-66`（wire view `next = pending ?? lastUsed`）、`:70-75`（`sameSelection` 比全三字段）、`:81-83`（注册）；客户端侧 `directory.ts:119-127`（`resetConnected`）、`:130-134`（`dispose`：迟到结算失去写权）。官方断言先例：`session-projections.host.spec.ts:202-220`；`ui-model-selection/tests/browser-plugin.client.spec.ts:302`（"keeps the durable projected selection while the eager catalog reconnects"）、`:321`、`:346`（scope 销毁后重建得到全新 directory）。
- **前置状态**：session 事件流为：`request/header(A)`（`reason:'initial'`）→ `model/selection(B)`。折叠后 `lastUsed=A`、`pending=B`、`next=B`。
- **操作**：① 再 append 一次**完全相同**的 `model/selection(B)`；② append `request/header(B)`；③ 把事件流从头重放（新进程/新 Host 代次）。
- **期望断言**：
  1. 折叠初态：`{lastUsed:A, pending:B}`，view `{lastUsed:A, next:B}`；
  2. ① 重复写入**不产生新 state**（`apply` 返回**同一引用**，`:40-42` 的 `? state :`），即幂等；
  3. ② 之后 `pending=null`、`lastUsed=B`、`next=B`（一次真实请求**消费**掉待应用意图）；
  4. ③ 重放结果与重放前逐字段相同；`stateVersion=2` 被声明；
  5. `dispose()` 后迟到的 select 响应不写 store；`resetConnected()` 把 `'selecting'` 归 `'idle'` 且清 error。
- **失败判据**：请求发生后 `pending` 未清空（同一选择被反复视为"待应用"，可能重复发公告）；或重复写入产生新 state（多余渲染/告警）；或重放后 `next` 丢失退化为 `null`（会话"失忆"回默认模型）；或 dispose 后迟到响应仍写 store。
- **官方未做的部分**：官方 projection **无**"切回上一个模型"的历史栈（只有 `lastUsed`/`pending` 两个字段）→ 我方若要"模型切换回退栈"须自研（C-06 的 scope_for_us）。

---

### C9 多 provider 一致性：单一校验器 + 目录局部失败隔离

- **官方依据**：三个入口共用同一校验与装配 —— Web `commands.ts:137`、ACP `packages/acp/acp/src/model-control.ts:225`、headless `packages/bundle/headless/src/index.ts:340`（三者均最终走 `ctx.llm.resolveCallConfig` + `installModelSelection`）；目录契约 `packages/api/session-controller/src/types.ts:144-150`（`ModelCatalog{default, routableProviders, groups, failures}`，`routableProviders` 注释="Provider routes currently able to serve a request, **including empty catalogs**"）、`:137-141`（`ModelCatalogFailure{id,name,message}`）。官方断言先例：`session-models.host.spec.ts:350-386`（成功 provider 成组，失败 provider 进 `failures`，成功/失败**并存**）、`:389-428`（非 Error 的字符串失败被归一化）、`acp/acp/tests/model-control.spec.ts:75`（provider catalog 暂不可用仍保留所选路由）。
- **前置状态**：注册 4 条路由：`ok`（2 模型）、`broken`（`listModels` 抛 `Error`）、`string-broken`（抛字符串）、`remote-rejected`（`resolveModel` 抛 `RemoteError`）；当前选择 = `ok/m1`。
- **操作**：① 读 `catalog`；② 用同一 `(ok, m2)` 分别经 Web / ACP / headless 三个入口切换；③ 选择一条**不在 groups 里但路由可服务**的模型。
- **期望断言**：
  1. `catalog.groups` 只含成功 provider；`catalog.failures` 逐个列出失败 provider 的 `{id,name,message}`（含字符串失败被归一化为 message 的情形）；
  2. **局部失败不污染全局**：`ok` 的 groups 仍可用，`catalog` 不因此置为 error/空；
  3. 三个入口对同一 `(provider,model)` 得到**同一归一化结果**（含 `reasoningEffort` 解析一致）；
  4. "未列出但可服务"的模型：切换**成功**，且 `routableProviders.includes(provider) === true`，而该模型 `id` **不在** `groups` 展开的 id 列表里；
  5. catalog 暂不可用时，已选路由**不被清空**（`current` 保持）。
- **失败判据**：某入口绕过 `resolveCallConfig` 直接落 selection（三入口结果不一致）；或一个 provider 的目录失败导致 `catalog.groups` 整体为空/整体 error；或把"catalog 未列出"当成"不可用"而拒绝一个实际可服务的路由（把 advisory 当 authoritative）。
- **备注（口径）**：`directory.ts:20-27` 明文警告：`routable` 是**权威**的，catalog 成员资格是**建议性**的 —— `routable:null` **不等于** blocked，断言必须区分 `null` 与 `false`。

---

### C10 切换时消息与 token 计量一致性：路由归因 + 官方明文的"允许不一致"

- **官方依据**：
  - 归因：`packages/llm/token-meter/src/turn-usage.ts:6-10`（`TurnTokenUsageRoute{provider,model}`）、`:13-27`（`TurnTokenUsage`：`uncachedInputTokens`/`outputTokens`/`totalTokens` 必填，`cacheReadTokens`/`cacheWriteTokens`/`reasoningTokens` **仅当每个 attempt 都报该桶时才存在**，`routes` "Present only when every billed attempt has provider/model attribution"）、`:126-159`（跨 attempt 聚合 + `routes` 按 `provider\0model` **去重**）、`:169-177`（"No attempt is inferred from a usage sample… makes the whole disclosure unavailable"）。
  - 四桶不相交：`packages/llm/token-meter/src/projection.ts:8-18`（"reasoning tokens are **already included** in `outputTokens` and are not accumulated again"）。
  - **切换期的不一致是官方明文取舍**：`projection.ts:22-28` —— "The fields … are deliberately NOT one atomic request observation: each is a last-wins record of a different moment. **Switching models can therefore pair a fresh capacity with the previous route's pressure until the next request reports usage.** This is an intentional trade — the value is a user-facing reference, **not a billing or gating input**."
  - 消息面：切换公告是 durable 事件（`core/agent/src/model-selection.ts:41-56`，`:47` 精确文本），使"历史 assistant turns 由哪个模型生成"在 transcript 中**可读**。
- **前置状态**：一个 turn 内跨路由：step 0 在 `A/a1` 上完成一次 attempt（报 usage），step 1 在 `B/b1` 上完成一次 attempt（报 usage），`turn/end` 已落。
- **操作**：① 取该 turn 的事件序列，跑 `deriveTurnTokenUsage(turnEvents)`；② 切换后**立刻**（下一次请求尚未报告 usage 前）读 `contextPressure` 投影。
- **期望断言**：
  1. `routes` 含**两条**路由 `{A,a1}` 与 `{B,b1}`，去重且顺序稳定；若任一 attempt 缺路由归因，则 `routes === undefined`（而不是只报最后一个）；
  2. `uncachedInputTokens + outputTokens === totalTokens`（跨 attempt 精确求和）；
  3. `reasoningTokens`（若存在）⊆ `outputTokens`，**不再单独累加进 total**；
  4. 任一 attempt 缺某桶 → 该桶为 `undefined`（不猜、不补 0）；
  5. 缺 lifecycle 边界（缺 `turn/end`、usage 不完整、count 不安全、total 与桶矛盾）→ **整体返回 `undefined`**；
  6. 切换刚发生时：`contextPressure.contextWindow` 可为**新路由**的容量而 `pressureTokens` 仍为**旧路由**的压力 —— 断言应写"**允许混合**，且两者各自存在"，**不得**写成"必须一致"；
  7. transcript 中该 turn 边界处存在一条 `source.kind='plugin' && source.plugin='model-selection' && source.form='notice'` 的消息，`summary` 为 `<from> → <to>`（跨 provider 时含 provider 名）。
- **失败判据**：`routes` 只报最后一条（丢掉前一路由的计费归因）；四桶与 total 不自洽；缺边界时仍给出数字（伪造精确性）；reasoning 被二次累加；**或**把第 6 点写成"必须一致"的断言（那会与官方明文取舍冲突，属**编造断言**）。
- **备注**：官方明文声明计量值"**不是计费或门控输入**"。我方若拿它做成本门控，属于**官方未覆盖的用法**，须自研并单独验证（C-13/C-14 的 scope_for_us）。

---

### C11 并发与多窗口：写者占用与配置 CAS

- **官方依据**：`packages/api/session-controller/src/agent.ts:61`（错误联合含 `'session/writer-held'`）、`:219`（`new RemoteError('session/writer-held', error.message, {sessionId})`）；`packages/api/session-controller/src/types.ts:194`（详情形状）；UI 本地化 `packages/client/ui-model-selection/src/client/ModelSelect.tsx:288-290`（`code==='session/writer-held'` → `error.sessionInUse`）；配置面 CAS `packages/client/ui-settings-models/src/client/operations.ts:96-101`（`settings.mutate(ns, ops, expectedRevision)`；非 ok 且 `code==='settings/conflict'` → `{kind:'conflict'}`）。官方断言先例：`ui-model-selection/tests/browser-plugin.client.spec.ts:197`、`model-select.client.spec.tsx:185`。
- **前置状态**：同一 session 被两个客户端持有；客户端 A 持写者。另：两个并发 settings 草稿都基于同一 `expectedRevision=r`。
- **操作**：① 客户端 B 对同一 session 调 `selectModel`；② 两个草稿都提交 `settings.mutate(ns, ops, r)`。
- **期望断言**：
  1. B 得 `ok:false`、`error.code='session/writer-held'`、`details={sessionId}`；
  2. UI 座位把它显示为 `error.sessionInUse` 文案（不是通用错误文案）；
  3. 第二个 CAS 提交得 `error.code='settings/conflict'`，被映射为 `{kind:'conflict'}`，**不是** `{kind:'refused'}`；
  4. 冲突后**不静默覆盖**：先提交者的值保持，第二个草稿需重新读取 revision。
- **失败判据**：并发写后到者**静默覆盖**先到者（丢更新）；或 writer-held 被折叠成通用错误而丢掉 `sessionId`；或冲突被当作普通拒绝（UI 无法引导"重新加载再试"）。
- **官方未做的部分**：官方**无**"多人同时切换模型"的合并策略（无 CRDT/无 last-writer 广播）；一致性靠**写者占用 + revision CAS**兜住 → 我方若允许多人同会话，须按此模式设计，不得假设有冲突自动合并。

---

### C12 切换治理：子代理/受限上下文的模型允许清单

- **官方依据**：`packages/subagent/tool-subagent/src/model-selection-state.ts:31-48`（`subagent/model-selection-policy` 投影：`zod` 校验 route 列表；`assertAllowedModelRoutes`；**空清单抛错** `'subagent/model-selection-policy requires at least one route'`）；`tool-subagent/src/index.ts:361-363`（策略存在才注册模型选择能力）；入口侧屏蔽 `packages/client/ui-model-selection/tests/model-select.client.spec.tsx:247`（"renders no Agent-bound control for an addressed subagent session"）、`service.ts:69-73`（未知 session **fail loud**）、`directory.ts:136-140`（`assertAvailable()` 对 addressed subagent session 抛错）、`browser-plugin.client.spec.ts:420`。官方断言先例：`tool-subagent/tests/model-selection-settings.spec.ts:145`（空清单非法）、`:149`（畸形形状非法）、`:373`/`:462`（启用/禁用两态）。
- **前置状态**：session 有 `allowedModels=[{provider:P,model:m1}]`；另无策略的 session 作对照。
- **操作**：① append `subagent/model-selection-policy{allowedModels:[P/m1]}`；② 尝试切到 `P/m2`（清单外）；③ append 空清单；④ 对 addressed subagent session 请求模型目录。
- **期望断言**：
  1. 策略存在时子代理模型选择能力**被注册**，且可选项**只含**清单内路由；
  2. 清单外路由**被拒**；
  3. 空清单 → **抛错**（等价于"无限制"必须不可能）；
  4. addressed subagent session：`directoryFor` 抛 `model selection is unavailable for addressed subagent sessions`，UI **不渲染**该类控件；
  5. 无策略 → 行为与未启用治理时一致（不误伤）。
- **失败判据**：空清单被接受（治理可被"空数组"绕过 = 无限制）；或清单外模型仍可切换；或受限会话仍渲染出 Agent 绑定控件（UI 与 Host 校验不一致）；或策略缺失时误伤正常会话。

---

## 五、官方测试基建（我方写上述用例时的可复用件）

### 5.1 断言先例索引（官方已存在、可直接照搬的断言对象）

| 用例 | 官方测试文件:行 | 断言对象 |
| --- | --- | --- |
| C1 | `ui-model-selection/tests/browser-plugin.client.spec.ts:284,245,270` | directory 实例身份 / 两入口 `state.current` |
| C2 | `ui-model-selection/tests/catalog.client.spec.ts:35,54` | 失效代次不发布（status 不变） |
| C3 | `core/agent/tests/model-selection.spec.ts:124-142,179-188` | assembled 快照 / 公告文本 |
| C3 | `api/session-controller/tests/session-models.host.spec.ts:451-463` | step 0 vs step 1 的 request config |
| C4 | `session-models.host.spec.ts:479-505,582-584` | 失败后 `currentSelection()` 不变 |
| C5 | `session-models.host.spec.ts:562-595` | 存储失败仍 `ok` + `current` 已变 |
| C6 | `llm-retry/tests/retry.spec.ts:312,368-397,425,464,532` | 调度延迟 / 预算作用域 |
| C6 | `llm/llm/tests/service.spec.ts:125-133` | 配额 vs 限流分类 |
| C7 | `session-models.host.spec.ts:648-703` | `attachment-invalid` + reason |
| C8 | `session-projections.host.spec.ts:202-220` | fold 前后 `{lastUsed,pending,next}` |
| C9 | `session-models.host.spec.ts:350-386,389-428` | `groups` / `failures` 并存 |
| C9 | `acp/acp/tests/model-control.spec.ts:75` | catalog 暂不可用保留所选路由 |
| C10 | `token-meter/tests/token-usage-projection.spec.ts`、`context-breakdown-projection.spec.ts` | usage 桶 / breakdown |
| C11 | `browser-plugin.client.spec.ts:197`、`model-select.client.spec.tsx:185` | writer-held 本地化 |
| C12 | `tool-subagent/tests/model-selection-settings.spec.ts:145,149,373,462` | 允许清单校验 |

### 5.2 可脚本化故障服务器（C6/C7 的载体）

`packages/test-support/llm-mock-server/`：`MOCK_LLM_BEHAVIORS` 共 **24** 个具名行为（`:16-40`），本件用得上的：

```
connection_reset, stream_disconnect, empty, partial_eof, partial_disconnect, stall,
malformed_json, malformed_event, wrong_content_type, rate_limit, server_error,
service_unavailable, auth_error, invalid_request, context_overflow, quota_exceeded,
success, reasoning_success, tool_call_success, max_tokens, slow_success, random
```

- `tool_call_success` → 工具调用中途切换（C3）的载体；
- `rate_limit` / `quota_exceeded` / `context_overflow` → C6 的三条分支，正好覆盖"瞬时限流 vs 终态配额 vs 上下文溢出"；
- `random` 有 `DEFAULT_MOCK_LLM_RANDOM_WEIGHTS`（`:56-71`）做可复现混合故障压测（seeded）。
- **判别性夹具**：`packages/test-support/llm-replay/src/index.ts:167-181` 的 `ReplayHandle.assertConsumed()` —— 在 teardown 时**抛错**除非"每条录制脚本都被绑定到 live session 且游标消费完整"。这正是坑清单要的"**删掉即报红**"型夹具：场景少发一次请求就报红，而不是静默通过。

### 5.3 官方测试文件的量级（说明"有先例"不是空话）

```
$ wc -l packages/api/session-controller/tests/session-models.host.spec.ts \
        packages/core/agent/tests/model-selection.spec.ts \
        packages/core/agent-loop/tests/system-prompt-admission.spec.ts
     740 packages/api/session-controller/tests/session-models.host.spec.ts
     191 packages/core/agent/tests/model-selection.spec.ts
     308 packages/core/agent-loop/tests/system-prompt-admission.spec.ts
    1239 total
```

### 5.4 我方落地时的三条纪律（源自官方做法，非本件发明）

1. **切换只改"下一次装配"**：不要在一次请求中途改路由 —— 官方明文理由在 `core/agent/src/model-selection.ts:61-63`。
2. **失败路径先校验后落事件**：`commands.ts:137-151` 的顺序决定"失败零副作用"，改成先落事件再校验就会破坏 C4。
3. **计量不许当门控**：官方明文 `token-meter/src/projection.ts:26-28`。我方若拿 token 数做预算闸，须自建独立、可复算的账（不得复用展示型投影）。

### 5.5 官方配置机制（回应"`modelConfig` 不存在"的前提）

`(modelConfig|model-config)` 在 canonical 口径下 **0 命中**（§〇-3）。官方的模型配置机制**是 settings 命名空间**，不是名为 `modelConfig` 的对象：

| 事实 | 证据 |
| --- | --- |
| 命名空间常量 | `packages/core/agent-default-model/src/index.ts:21` → `export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'` |
| schema | `:34-38`（`provider`/`model` 必填，`reasoningEffort` 可选） |
| 读 | `:90-92` `currentSelection()`，经 `this.source()` **实时读用户层**（`:76-83` 的 `setSource`） |
| 写 | `:100-106` `saveSelection()` → `settings.replace(NS, …)` |
| 前端写路径（带 CAS） | `packages/client/ui-settings-models/src/client/operations.ts:96-101` |
| 模型候选发现 | 同上 `:102-107`（`remote.llm.discoverModels`） |

**"实时读用户层"这一点值得单列**：官方断言 `session-models.host.spec.ts:509-526`（"reads the Agent default live for a session whose log names no selection"）——默认值在会话创建后**改变**，仍能即时到达该会话。反过来 `:528-543` 断言"日志已有选择时，默认值变化**不**影响该会话"。这两条方向相反，是"默认值 vs 会话选择"优先级的判别性用例。

### 5.6 官方无实现的三项（canonical 实测，原始输出）

```
$ cd /Users/wane/src/deepseek-harness
$ git grep -n -E '(fallbackModel|fallbackProvider|modelFallback|primaryModel|secondaryModel|escalationModel)' \
    -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' 'packages/**/*.tsx' | wc -l
       0
$ git grep -n -E '(supportsTools|toolCallSupport|supportsToolCall|toolCapability)' \
    -- 'apps/**/*.ts' 'apps/**/*.tsx' 'packages/**/*.ts' 'packages/**/*.tsx' | wc -l
       0
$ git grep -n -E '(cancel|abort)' -- 'packages/api/session-controller/src/commands.ts'
packages/api/session-controller/src/commands.ts:496:   * @param request - Session whose active Agent turn is cancelled.
packages/api/session-controller/src/commands.ts:497:   * @returns acknowledgement that cancellation was requested.
packages/api/session-controller/src/commands.ts:499:  cancel(request: SessionCancelRequest): SessionCancelValue {
packages/api/session-controller/src/commands.ts:511:    agent.cancel({ kind: 'user' }, { keepInbox: true })
```

第 3 条的判读：`cancel` **只出现在** `commands.ts:496-511`，而 `selectModel` 位于 `:133-169` —— 两者**不重叠**，即 **`selectModel` 不取消在飞请求**；取消是一条**独立 RPC**。

---

## 六、借鉴项（23 条；分类：可直接复制 / 可参照 / 核心自研）

**复制边界红线（G1 生效）**：模型**选择/切换的实现思路**属可参照/可直接复制；凡落到我方"**诊断/哨兵/专家/本体/度量/参数库**"的能力，一律**核心自研**，不得以"官方有对应物"为由照搬。

| ID | 标题 | 分类 | 官方 file:line | 可执行动作 | 我方验收口径（改到什么程度算完成） |
| --- | --- | --- | --- | --- | --- |
| C-01 | 双入口共享单一 per-session 选择器状态 | 可参照 | `packages/client/ui-model-selection/src/client/service.ts:69-85`；`directory.ts:16-36` | 我方模型选择器若有 ≥2 个入口（如设置页 + 对话栏），必须共用**同一个** per-session 状态实例（按会话 ID 键控、会话销毁即回收） | 同一会话两入口读到同一实例（`===`）；两个会话互不影响；会话销毁后无残留实例（无泄漏） |
| C-02 | 选择代次守卫（latest-wins，迟到响应不得回写） | 可直接复制 | `packages/client/ui-model-selection/src/client/directory.ts:45-46,91-113,119-127` | 每次切换递增代次号；响应回来先比代次，不匹配则丢弃；Host 重连时代次失效并复位在飞状态 | 连发两次切换、让旧响应迟到 → store 的 status/error/current 均不被旧响应改写（C2 用例） |
| C-03 | 持久选择折叠：`pending` / `lastUsed` / `next` | 可参照 | `packages/api/session-controller/src/model-selection-projection.ts:35-68` | 把"用户选了"与"真正用了"拆成两个字段：选=写 pending；真正发出请求=写 lastUsed 并清 pending；`next = pending ?? lastUsed` | 请求发生后 pending 必为 null；重复写入幂等；重放事件流后 next 一致；投影带 stateVersion（可迁移） |
| C-04 | 装配快照边界（`current` / `assembled` 双字段） | 可参照 | `packages/core/agent/src/model-selection.ts:26-31,77-107` | 切换**不**改在飞请求；进入装配时快照，请求时套用快照，下一次装配才吃新值 | 在飞 step 路由不变；下一步用装配时的快照值（不是最新值）；prompt 变量与请求路由**不劈叉**（C3 用例） |
| C-05 | 模型变更公告（durable notice + 精确文案） | 可参照 | `packages/core/agent/src/model-selection.ts:41-56,108-121`；`README.md:141` | 路由变更时向 transcript 追加一条 plugin 来源的 notice，标明"上方轮次由 X 生成，此后用 Y"；仅 effort 变更**不**追加 | 公告恰一条、文案与 summary 可断言；仅 effort 变更零公告；请求头未落盘而失败时下次仍会再次公告 |
| C-06 | 切换失败零副作用（校验先于落事件） | 可直接复制 | `packages/api/session-controller/src/commands.ts:137-151,160-167` | 顺序固定为"校验 → 归一化 → 落事件/缓存"；校验失败直接抛，**不落任何事件** | 失败后事件流无新增选择事件、next 不变、默认值未写（C4 用例）；错误带 `{provider,model}` 详情 |
| C-07 | 存储失败不阻断本次切换（仅告警） | 可直接复制 | `packages/api/session-controller/src/commands.ts:152-158` | 把"本会话已切换"与"默认值已保存"分成两件事；后者失败只 warn + 返回成功 | 存储失败时切换仍生效、返回成功、且**必有** warn 日志（C5 用例） |
| C-08 | adapter 默认值不回放为会话选择 | 可直接复制 | `packages/api/session-controller/src/agent.ts:303-308`；先例 `session-models.host.spec.ts:545-558` | 对"适配器自己填的默认参数"打标记；恢复会话选择时**丢弃**该类默认值，避免"没改也像改了" | 日志里 effort 来自 adapter 默认 → 恢复出的选择**不含** effort 字段；显式选择的 effort 必须保留 |
| C-09 | 配置写入带 revision（CAS），冲突显式返回 | 可直接复制 | `packages/client/ui-settings-models/src/client/operations.ts:96-101`；`packages/core/agent-default-model/src/index.ts:100-106` | 配置写入必须携带读取时的 revision；服务端不匹配即拒；前端把冲突映射成独立结果类型（可引导"重新加载"） | 两草稿并发提交同一 revision → 后者得冲突（非静默覆盖）；冲突与普通拒绝在 UI 上可区分（C11 用例） |
| C-10 | "目录未列出" ≠ "不可用"（advisory vs authoritative） | 可直接复制 | `packages/client/ui-model-selection/src/client/directory.ts:20-27`；先例 `session-models.host.spec.ts:598-627` | 可路由性由宿主（权威）判定；模型清单只作展示建议；三态 `true/false/null` 必须区分，`null`（未知）不得当作禁用 | 选一条"清单未列但路由可服务"的模型 → 成功且可用；`routable===null` 时不锁输入（C9 用例） |
| C-11 | provider 局部失败隔离（可用分组仍可用） | 可直接复制 | `packages/api/session-controller/src/types.ts:137-150`；先例 `session-models.host.spec.ts:350-386,389-428` | 目录拉取按 provider 独立成败；失败者进 failures 列表，成功者照常展示；非 Error 的失败也要归一化成可展示 message | 一个 provider 挂掉时其余仍可用；failures 逐条可展示；字符串异常不漏（不变成 `undefined` 文案） |
| C-12 | 能力校验放在准入处 + 文案键本地化 | 可直接复制 | `packages/api/session-controller/src/commands.ts:338-344`；`packages/client/ui-conversation/src/client/image-labels.ts:34` | 模态/能力校验放在"提交内容时"，不在"切换时"；错误给机器可读 `reason` 码 + UI 映射到可操作文案（"请切换支持图片的模型"） | text-only 模型提交图片 → 稳定 `reason=MODEL_DOES_NOT_SUPPORT_IMAGES`；UI 文案引导用户换模型而非报"服务异常"（C7 用例） |
| C-13 | token 计量的路由归因与去重聚合 | 可参照 | `packages/llm/token-meter/src/turn-usage.ts:6-27,126-159,169-177` | 按 turn 聚合 attempt；四桶精确求和；**仅当每个 attempt 都有 provider/model 归因**才输出 routes；缺边界即整体不可用（返回 undefined，不猜） | 一个 turn 跨两路由 → routes 含两条（去重）；缺任一路由 → routes 为 undefined；四桶与 total 自洽（C10 用例） |
| C-14 | 切换期"容量/压力混合"显式声明（不假装一致） | 可参照 | `packages/llm/token-meter/src/projection.ts:19-38` | 状态展示类指标允许 last-wins 混合，但**必须**在契约里写明允许不一致，并明确"非计费/非门控输入" | 契约注释含"切换后容量与压力可来自不同时刻"；对应测试断言写"允许混合"而非"必须一致"（C10 第 6 点） |
| C-15 | provider 作用域重试预算 + Retry-After 上界 | 可参照 | `packages/llm/llm/src/retry-policy.ts:17-25,37-79,149-177`；先例 `llm-retry/tests/retry.spec.ts:312,368-397,464,532` | 重试策略按 provider 解析；预算不跨 provider 借用；服务端 Retry-After 在封顶内原样用、超封顶落回本地 jittered backoff；非瞬时错误不排定时器 | 超上界 Retry-After 不被采纳；A 的失败不消耗 B 的预算；预算耗尽即停（C6 用例） |
| C-16 | 终态配额 vs 瞬时限流的分类 | 可直接复制 | `packages/llm/llm/src/error.ts:14,88-99` | 建**错误码分类**（不解析 message 做路由）；额外识别"配额/余额/预算耗尽"文案为终态，不重试 | 配额耗尽文案 → 不重试；限流文案 → 可重试；分类结果有单一函数可单测（C6 第 3 点） |
| C-17 | 受限上下文的模型允许清单（治理） | 可参照 | `packages/subagent/tool-subagent/src/model-selection-state.ts:31-48`；`tool-subagent/src/index.ts:361-363` | 对子代理/受限会话引入持久化的模型允许清单；**空清单必须非法**（不能等价于无限制）；UI 与宿主校验一致（受限会话不渲染选择控件） | 清单外模型被拒；空清单抛错；受限会话无选择控件；无策略时不误伤（C12 用例） |
| C-18 | 判别性夹具：消费完整性断言（少调用即报红） | 可直接复制 | `packages/test-support/llm-replay/src/index.ts:167-181` | 测试收尾必须能**证明**"每个录制脚本都被真实消费完"；少发一次请求、或脚本从未绑定 → 直接抛错 | 故意删掉一次调用 → 测试**报红**；未删则绿（这是"接线了 ≠ 被执行"的判别力来源） |
| C-19 | 可脚本化故障序列服务器 | 可直接复制 | `packages/test-support/llm-mock-server/src/index.ts:16-71` | 用一份具名故障清单（限流/配额/上下文溢出/工具调用成功/流中断…）+ 可复现随机权重，替代手写 mock | 故障序列按次消费；`rate_limit`/`quota_exceeded`/`context_overflow`/`tool_call_success` 四个行为可被本片用例直接引用 |
| C-20 | **限流/失败后自动切换备用模型或 provider** | **核心自研** | **官方无实现**：`git grep -E '(fallbackModel\|fallbackProvider\|modelFallback\|primaryModel\|secondaryModel\|escalationModel)'` → **0**（§5.6）；官方重试停留在失败 provider（`retry.spec.ts:464,532`） | 自研"降级路由"：定义备用顺序、切换判据（终态 vs 瞬时）、切换后如何标注（不得静默）、以及预算与成本账 | 限流达阈值时按序降级到备用模型，且**必有一条可见标注**说明已降级；终态配额不盲目重试；全程有可复算的账 |
| C-21 | **切换即中断在飞请求并立即重发** | **核心自研** | **官方无实现**：`selectModel`（`commands.ts:133-169`）内无 cancel/abort；取消是独立 RPC（`commands.ts:499-511`，§5.6） | 自研"切换即生效"语义：明确是"中断当前生成"还是"等当前 step 结束"；中断后的重发策略；半截产出的处理与标注 | 切换后当前生成在可界定时间内停止；不再有旧路由的后续产出；半截内容被明确标注而非混入正常输出 |
| C-22 | **每模型工具能力声明与工具集适配** | **核心自研** | **官方无实现**：`git grep -E '(supportsTools\|toolCallSupport\|supportsToolCall\|toolCapability)'` → **0**（§5.6）；官方仅声明 `contextWindow`（`llm/llm/src/types.ts:309`）与 `inputModalities`（`:313`） | 自研模型能力元数据（是否支持工具调用/并行调用/结构化输出等）+ 切换时对工具集做适配与降级提示 | 切到不支持某工具族的模型时，请求里的工具集按规则收敛，且用户可见提示"该模型不支持 X 工具"；不得静默丢工具 |
| C-23 | **模型选择与我方"诊断/专家/哨兵/本体/度量/参数库"的边界** | **核心自研** | 借鉴边界（按 G1 守卫与 CTO 口径），非官方对应物 | 明确"能不能照抄"：选择器/切换时序/投影/错误处理**可参照**；一旦涉及专家路由、哨兵配额、本体推理、度量口径、参数库，**一律自研且不得引用官方实现作为正确性依据** | 每个涉及上述能力的改动都能指出其证据来自我方自有规格/实测，而非"官方这么做" |

**汇总**：共 **23** 条 —— 可直接复制 11 条（C-02/C-06/C-07/C-08/C-09/C-10/C-11/C-12/C-16/C-18/C-19）、可参照 8 条（C-01/C-03/C-04/C-05/C-13/C-14/C-15/C-17）、核心自研 4 条（C-20/C-21/C-22/C-23）。其中 **3 条（C-20/C-21/C-22）为"官方无实现"项**，理由见 §5.6 的 canonical 实测。

---

## 七、覆盖对账与遗留

### 7.1 派单件 9 个必测面 → 用例映射

| 派单件要求的面 | 本件用例 |
| --- | --- |
| 选择器（UI + 配置） | C1（UI 双入口）+ C1/§5.5（配置命名空间 + CAS） |
| 会话中切换时序与状态 | C2 |
| 工具调用中途切换 | C3 |
| 切换失败回退 | C4（校验失败零副作用）+ C5（持久化失败不阻断） |
| 限流 | C6 |
| 上下文与工具能力差异适配 | C7（官方已实现部分）+ C7 末/§三（工具能力=官方无实现） |
| 持久化与恢复 | C8 |
| 多 provider 一致性 | C9 |
| 切换时消息与 token 计量一致性 | C10（消息=公告 durable 记录；计量=路由归因 + 官方明文的允许不一致） |
| （额外）并发与治理 | C11、C12 |

### 7.2 覆盖度自评（如实）

- **必测用例 12 条**（配额 ≥8），四要素齐备；覆盖派单件全部 9 面 + 2 条额外面。
- **借鉴项 23 条**（配额 ≥10），每条含分类 / 官方 file:line / 可执行动作 / 我方验收口径。
- 每条用例的官方依据均给到 `file:line`；**官方未做的部分已逐处明标"官方无实现"**，并给出 canonical 0 命中的原始输出（§5.6）。**本件未编造任何官方断言。**

### 7.3 未覆盖 / 存疑项（如实列）

1. **`maxTokens` 与上下文溢出的完整适配**未展开为独立用例（`context_overflow` mock 行为与 `LlmModelContext.maxTokens` 存在，但属 B/A 片邻域，本件未取全证）。
2. **图片请求字节预算**（`LlmImageRequestBudget` / `IMAGE_OFFLOAD_REQUIRED`）仅提示存在，未取行号级证据。
3. **`reasoningEffort` 归一化的完整取值域**未穷举（官方 458 行命中里大部分属适配器侧，本件只取了 `resolveCallConfig` 与 effort 默认值相关路径）。
4. **打包运行时（0.1.6-alpha.1）与本 checkout（0.1.6-alpha.2）的差异未核**：本件 100% 取证在 checkout；两处版本不同，未做交叉验证。
5. **ACP 侧 `serialize()` 的具体串行语义**只取到调用点（`acp model-control.ts:59,93,104`），未展开其队列语义。
6. **`llm-replay` 的 override/patch 机制**（`ReplayOverrideDoc`、注入瞬时故障）只取到接口，未取端到端用例。

以上 6 项均**不影响**本件已给的 12 用例与 23 借鉴项的自洽性；列为后续切片或改法卡细化时的输入。

---

## 八、机器可读块（供总表机械聚合）

```json
{"d870_borrow_items":[
{"id":"C-01","title":"双入口共享单一 per-session 选择器状态","class":"可参照","official":"packages/client/ui-model-selection/src/client/service.ts:69-85 与 packages/client/ui-model-selection/src/client/directory.ts:16-36","action":"多个选择入口共用同一个按会话键控的状态实例，会话销毁即回收","scope_for_us":"同一会话两入口读到同一实例(===)；两会话互不影响；无实例泄漏"},
{"id":"C-02","title":"选择代次守卫(latest-wins，迟到响应不回写)","class":"可直接复制","official":"packages/client/ui-model-selection/src/client/directory.ts:45-46,91-113,119-127","action":"每次切换递增代次；响应回来先比代次，不匹配即丢弃；Host 重连时代次失效并复位在飞状态","scope_for_us":"连发两次切换+旧响应迟到 → status/error/current 均不被旧响应改写"},
{"id":"C-03","title":"持久选择折叠 pending/lastUsed/next","class":"可参照","official":"packages/api/session-controller/src/model-selection-projection.ts:35-68","action":"选=写 pending；真正发请求=写 lastUsed 并清 pending；next = pending ?? lastUsed；带 stateVersion","scope_for_us":"请求后 pending 必为 null；重复写入幂等；重放事件流后 next 一致"},
{"id":"C-04","title":"装配快照边界(current/assembled 双字段)","class":"可参照","official":"packages/core/agent/src/model-selection.ts:26-31,77-107","action":"切换不改在飞请求；装配时快照、请求时套用快照，下一次装配才吃新值","scope_for_us":"在飞 step 路由不变；下一步用快照值而非最新值；prompt 变量与请求路由不劈叉"},
{"id":"C-05","title":"模型变更公告(durable notice+精确文案)","class":"可参照","official":"packages/core/agent/src/model-selection.ts:41-56,108-121 与 packages/core/agent/README.md:141","action":"路由变更时追加 plugin 来源 notice，标明上方轮次由 X 生成、此后用 Y；仅 effort 变更不追加","scope_for_us":"公告恰一条且文案/summary 可断言；effort-only 零公告；请求头未落盘失败则下次再公告"},
{"id":"C-06","title":"切换失败零副作用(校验先于落事件)","class":"可直接复制","official":"packages/api/session-controller/src/commands.ts:137-151,160-167","action":"顺序固定为校验→归一化→落事件/缓存；校验失败直接抛且不落任何事件","scope_for_us":"失败后事件流无新增选择事件、next 不变、默认值未写；错误带 provider/model 详情"},
{"id":"C-07","title":"存储失败不阻断本次切换(仅告警)","class":"可直接复制","official":"packages/api/session-controller/src/commands.ts:152-158","action":"把本会话已切换与默认值已保存拆成两件事；后者失败只 warn 且返回成功","scope_for_us":"存储失败时切换仍生效、返回成功、且必有 warn 日志"},
{"id":"C-08","title":"adapter 默认值不回放为会话选择","class":"可直接复制","official":"packages/api/session-controller/src/agent.ts:303-308 与 packages/api/session-controller/tests/session-models.host.spec.ts:545-558","action":"对适配器自填默认参数打标记；恢复会话选择时丢弃该类默认值","scope_for_us":"日志 effort 来自 adapter 默认 → 恢复出的选择不含该字段；显式选择必须保留"},
{"id":"C-09","title":"配置写入带 revision(CAS)且冲突显式返回","class":"可直接复制","official":"packages/client/ui-settings-models/src/client/operations.ts:96-101 与 packages/core/agent-default-model/src/index.ts:100-106","action":"配置写入携带读取时 revision；不匹配即拒；前端把冲突映射为独立结果类型","scope_for_us":"并发提交同一 revision → 后者得冲突(非静默覆盖)；冲突与普通拒绝在 UI 可区分"},
{"id":"C-10","title":"目录未列出不等于不可用(advisory vs authoritative)","class":"可直接复制","official":"packages/client/ui-model-selection/src/client/directory.ts:20-27 与 packages/api/session-controller/tests/session-models.host.spec.ts:598-627","action":"可路由性由宿主权威判定；模型清单仅作展示建议；true/false/null 三态必须区分","scope_for_us":"清单未列但路由可服务的模型可切换成功；routable===null 时不锁输入"},
{"id":"C-11","title":"provider 局部失败隔离","class":"可直接复制","official":"packages/api/session-controller/src/types.ts:137-150 与 packages/api/session-controller/tests/session-models.host.spec.ts:350-386,389-428","action":"目录拉取按 provider 独立成败；失败者进 failures，成功者照常用；非 Error 失败也归一化为可展示 message","scope_for_us":"一个 provider 挂掉其余仍可用；failures 逐条可展示；字符串异常不漏"},
{"id":"C-12","title":"能力校验放在准入处+文案键本地化","class":"可直接复制","official":"packages/api/session-controller/src/commands.ts:338-344 与 packages/client/ui-conversation/src/client/image-labels.ts:34","action":"模态/能力校验放在提交内容时而非切换时；给机器可读 reason 码并映射到可操作文案","scope_for_us":"text-only 提交图片 → 稳定 reason=MODEL_DOES_NOT_SUPPORT_IMAGES 且文案引导换模型"},
{"id":"C-13","title":"token 计量的路由归因与去重聚合","class":"可参照","official":"packages/llm/token-meter/src/turn-usage.ts:6-27,126-159,169-177","action":"按 turn 聚合 attempt；四桶精确求和；仅当每个 attempt 都有 provider/model 归因才输出 routes；缺边界即返回 undefined","scope_for_us":"跨两路由 turn → routes 含两条且去重；缺任一路由 → routes=undefined；四桶与 total 自洽"},
{"id":"C-14","title":"切换期容量/压力混合显式声明(不假装一致)","class":"可参照","official":"packages/llm/token-meter/src/projection.ts:19-38","action":"展示类指标允许 last-wins 混合，但契约必须写明允许不一致，并明确非计费/非门控","scope_for_us":"契约注释含切换后容量与压力可来自不同时刻；测试断言写允许混合而非必须一致"},
{"id":"C-15","title":"provider 作用域重试预算+Retry-After 上界","class":"可参照","official":"packages/llm/llm/src/retry-policy.ts:17-25,37-79,149-177 与 packages/llm/llm-retry/tests/retry.spec.ts:312,368-397,464,532","action":"重试策略按 provider 解析；预算不跨 provider 借用；封顶内 Retry-After 原样用、超封顶落回本地 jittered backoff；非瞬时错误不排定时器","scope_for_us":"超上界 Retry-After 不被采纳；A 的失败不消耗 B 的预算；预算耗尽即停"},
{"id":"C-16","title":"终态配额 vs 瞬时限流的分类","class":"可直接复制","official":"packages/llm/llm/src/error.ts:14,88-99","action":"建错误码分类(不解析 message 做路由)；额外识别配额/余额/预算耗尽文案为终态，不重试","scope_for_us":"配额耗尽文案→不重试；限流文案→可重试；分类集中于单一可单测函数"},
{"id":"C-17","title":"受限上下文的模型允许清单(治理)","class":"可参照","official":"packages/subagent/tool-subagent/src/model-selection-state.ts:31-48 与 packages/subagent/tool-subagent/src/index.ts:361-363","action":"对子代理/受限会话引入持久化模型允许清单；空清单必须非法；UI 与宿主校验一致","scope_for_us":"清单外被拒；空清单抛错；受限会话无选择控件；无策略时不误伤"},
{"id":"C-18","title":"判别性夹具:消费完整性断言(少调用即报红)","class":"可直接复制","official":"packages/test-support/llm-replay/src/index.ts:167-181","action":"测试收尾必须证明每个录制脚本被真实消费完；少发一次请求或从未绑定即抛错","scope_for_us":"故意删掉一次调用 → 测试报红；未删则绿(提供接线了≠被执行的判别力)"},
{"id":"C-19","title":"可脚本化故障序列服务器","class":"可直接复制","official":"packages/test-support/llm-mock-server/src/index.ts:16-71","action":"用具名故障清单(限流/配额/上下文溢出/工具调用成功/流中断)+可复现随机权重替代手写 mock","scope_for_us":"故障按次消费；rate_limit/quota_exceeded/context_overflow/tool_call_success 四行为可直接被本片用例引用"},
{"id":"C-20","title":"限流或失败后自动切换备用模型/provider","class":"核心自研","official":"官方无实现：git grep -E (fallbackModel|fallbackProvider|modelFallback|primaryModel|secondaryModel|escalationModel) = 0 命中(见 §5.6)；官方重试停留在失败 provider(retry.spec.ts:464,532)","action":"自研降级路由:备用顺序、切换判据(终态vs瞬时)、切换后的可见标注、预算与成本账","scope_for_us":"达阈值按序降级且必有可见降级标注；终态配额不盲目重试；全程有可复算的账"},
{"id":"C-21","title":"切换即中断在飞请求并立即重发","class":"核心自研","official":"官方无实现：selectModel(packages/api/session-controller/src/commands.ts:133-169)内无 cancel/abort；取消是独立 RPC(commands.ts:499-511，见 §5.6)","action":"自研切换即生效语义:中断当前生成还是等当前 step 结束、重发策略、半截产出处理与标注","scope_for_us":"切换后可界定时间内停止旧路由产出；半截内容被明确标注而非混入正常输出"},
{"id":"C-22","title":"每模型工具能力声明与工具集适配","class":"核心自研","official":"官方无实现：git grep -E (supportsTools|toolCallSupport|supportsToolCall|toolCapability) = 0 命中(见 §5.6)；官方仅声明 contextWindow(packages/llm/llm/src/types.ts:309)与 inputModalities(:313)","action":"自研模型能力元数据(工具调用/并行调用/结构化输出等)+切换时工具集适配与降级提示","scope_for_us":"切到不支持某工具族的模型时工具集按规则收敛且用户可见提示；不得静默丢工具"},
{"id":"C-23","title":"模型选择与我方诊断/专家/哨兵/本体/度量/参数库的边界","class":"核心自研","official":"借鉴边界(按 G1 守卫与 CTO 口径)，非官方对应物","action":"明确可照抄范围:选择器/切换时序/投影/错误处理可参照；涉专家路由、哨兵配额、本体推理、度量口径、参数库一律自研","scope_for_us":"每个涉及上述能力的改动都能指出证据来自我方自有规格或实测，而非官方这么做"}]}
```

---

**本件边界重申**：本件为对照表，**不含**任何我方产品代码改动，**不含**依赖引入，**不含**"通过"类评语；`docs/synova/research/official-model-switching.md` 为本件在工作树内**唯一**写入文件。是否可采用、能否合并，归 CTO 收件闸与 K3 终审。
