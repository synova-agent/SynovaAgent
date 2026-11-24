# DSH UI 借鉴清单 v1.0（可执行级）

> 归属：UI 重做模块 ｜ 任务 **#1485** ｜ 2026-11-24
> **唯一真源（锁版）**：`D:\novis-backup-20260526\Novis\_r3chain-20261123\install\0.2.2-rc.5\node_modules\@deepseek-ai\`（下文 `path:line` 均相对此根）
> 取证方式：只读 `src/**.ts(x)`、`src/**.module.css`、`locale`、`package.json`；每个数字都有实物行号，**没找到的写「未找到」，不猜**。
> 与另两件的关系：本文是《客户语言词典》§7「借什么」的**展开**，也是 DEV DOC §6.2 批次表的**前置依赖来源**。三件冲突时：宪章 ＞ DEV DOC ＞ 本文（本文只管"怎么借"的数值）。
> 上游硬要求（交接件 §3）：必须参考并复用 DSH 前端与交互的合适部分；**复用要落到我们自己的信息架构与文案体系上，不做换皮**。

---

## 0 怎么读

每条三行固定结构：

1. **DSH 契约**：实物 `path:line` + 原文 + 可执行数值。
2. **我方现状**：在 `8f9683c11` 上的实测差距（带 `path:line`）。
3. **落批**：归到 T2／T3／T4／T5／T6 哪一批。

标记说明：🎯＝可直接照数值实现｜⚠️＝只能借模式、数值需自定｜❌＝DSH 也没有，我们自己定（不得声称"照搬 DSH"）。

---

## 1 窗口·框架：三栏 + 五个壳座位

**DSH 契约**（`dsh-client-ui-layout/lib/types/client/AppFrame.d.ts`）

```
export type AppFrameProps = PropsRuntime<'root'> & PropsRenderSlots<
  'sidebar' | 'main' | 'rightbar' | 'shell.bottom' | 'shell.overlay' | 'shell.leading'>
```

原文注释：`/** The three-column frame (see module doc). */`；`AppFrameInjected.hooks.foldedLandscape` 注释为 `Browser posture supplied by the root registration.`

🎯 **可执行契约**：
- 壳 = **三栏（sidebar / main / rightbar）＋ 5 个壳座位**：`shell.leading`（窗口栏左侧，放侧栏开关/新建）、`shell.bottom`（状态栏）、`shell.overlay`（浮层根）。
- **窗口姿态**（`foldedLandscape`）由根注册注入给整个框架，不是各组件自己读 `window`。→ 我方必须在**根**算一次窗口姿态，往下传，不许每个组件各读一次。

**我方现状**：`App.tsx:126-152` 是 `TitleBar + app-body(left/center/right) + StatusBar`，**没有壳座位概念**，也没有窗口姿态：全 renderer `innerWidth|resize|matchMedia|ResizeObserver` 命中 **0**（只有 `ResizeHandle.tsx` 的拖拽手柄）。`electron/main.cjs:84` 只有 `width:1280,height:800`，**无 `minWidth/minHeight`**。

**落批**：T5（框架重构）＋ T2（窗口最小尺寸）

---

## 2 侧边栏自适应：三态 + 六个断点常量

**DSH 契约**（`dsh-client-ui-layout/lib/types/client/columns.d.ts:12-33`）

```
CENTER_MIN = 400            SIDEBAR_MIN = 264          SIDEBAR_MAX = 420
SIDEBAR_DEFAULT = 280       SIDEBAR_COLLAPSED = 56     SIDEBAR_DRAWER_BREAKPOINT = 768
SIDEBAR_AUTO_COLLAPSE = 1024
RIGHTBAR_MIN = 300          RIGHTBAR_MAX_RATIO = 0.7   RIGHTBAR_DEFAULT_RATIO = 0.45
```

同文件 `:1-5` 原文：`Normal column geometry: the right column shrinks, then loses its track, before the center drops below its minimum. The sidebar never concedes here.`
`:20-21` 原文：`Closed-sidebar rail: a 24px icon column between 16px horizontal paddings.`（24 + 16×2 = 56）
`:24-27` 原文：`a manual toggle below it re-expands over the squeezed center (stores.ts narrowExpanded)`

**SidebarRoot 的三态**（`dsh-client-ui-sidebar/lib/types/client/SidebarRoot.d.ts:7`）
```
function SidebarRoot({ collapsed, width, drawer, startSession, toggleSidebar, ... })
```
🎯 **可执行契约**：
| 态 | 触发 | 表现 |
|---|---|---|
| 展开 | 用户偏好 ∧ 视口 ≥ 1024 | 宽 = 偏好（默认 280，夹在 [264, 420]） |
| **轨道（rail）** | 视口 < 1024 自动折叠；或用户手动收起 | 宽 **56px** = 24px 图标列 + 两侧各 16px |
| **抽屉（drawer）** | 视口 < **768** | 无轨道，侧栏**覆盖**在内容上；手动展开 = 覆盖挤压中的中栏（`narrowExpanded`） |

**缩的顺序（重要）**：右栏先缩 → 右栏让出整条轨 → 中栏才允许低于 `CENTER_MIN=400`。**侧栏不让步**。

### 2.1 收起／恢复控件必须待在「窗口栏」座位上

**DSH 契约**（`dsh-client-ui-sidebar/lib/types/client/HeaderLeadingControls.d.ts:3-8`）

```
/** Full props of the shell.leading occupant. */
...
 * Sidebar-open and New Session controls in the frame's window-chrome seat.
 * The frame mounts this seat for hidden sidebars and owns its placement.
 * Web shows only the sidebar opener; Desktop also retains New Session.
```

文案（`dsh-client-ui-sidebar/lib/client.js` zh 词表，键集 `lib/types/client/locales.d.ts:6-9`）：`'toggle.open': '打开侧边栏'`、`'toggle.collapse': '收起侧边栏'`、`'session.new': '新会话'`、`'session.new.label': '新建会话'`。

🎯 **可执行契约**：
- 侧栏开关与「新建」住在 **`shell.leading`（窗口栏左侧座位）**，由框架负责摆放——**不是**各自塞在侧栏内部。
- **侧栏隐藏时该座位仍然挂载**（原文 `The frame mounts this seat for hidden sidebars`）⇒ **收起后一定有可见恢复入口**。
- **平台差异是有意的**：Web 只保留"打开侧栏"，**Desktop 额外保留"新建会话"**。我方是桌面端 ⇒ 两者都要有。
- 两个 tooltip 文案必须存在（打开／收起）。

**我方现状**：`TitleBar.tsx:50-65` 只有 通知／主题／快捷键 三颗按钮，**没有侧栏开关、没有新建**；开关只在 `useKeyboard.ts:28-35` 的 `Ctrl+B`/`Ctrl+J`；收起后折叠态只画 4 个能力图标（`LeftPanel.tsx:310-329`）⇒ **无可见恢复入口**（= §2.1 的现成解法）。

**落批**：T5

**我方现状**：
- `app-store.ts:169-170`：`leftPanelOpen:true, rightPanelOpen:true, leftPanelWidth:240, rightPanelWidth:320` —— 宽度写死，**无 min/max 夹取**（`setLeftPanelWidth` 直接 set，`app-store.ts:193`）。
- `App.tsx:122`：收起态 **44px**（不是 56），且只画 4 个能力图标（`LeftPanel.tsx:310-329`）。
- **零断点**：视口变窄时侧栏不变、中栏被压；**无抽屉态**。
- 无 `minWidth`（`main.cjs:84`）⇒ 窗口可缩到不可用。

**落批**：T5（三态＋夹取）＋ T2（`minWidth/minHeight`）

---

## 3 侧边栏：列表的每一像素都是契约

### 3.1 会话行：32px 高 + 16px 前导格 + 相对时间 + 行菜单

**DSH 契约**（`dsh-client-ui-workspace/lib/types/client/rows/Rows.d.ts:81-89`）

> `One top-level 32px session row: leading 16px cell (status dot, or the leading seat while the row's primary state is idle), title, relative time or compact pending label, and the row actions menu. ... The row accepts Tab focus and opens with unmodified Enter or Space; descendant controls handle their own activation without opening the row.`

🎯 **可执行契约**：
- 行高 **32px**；前导格 **16px**（状态点／前导座位）；内容 = 标题 + **相对时间**（或紧凑 pending 标签）+ **行操作菜单**。
- 归档行：前导格**留空**（状态点与前导座位都不画），活状态只出现在 hover card。
- 键盘：`Tab` 聚焦，**无修饰 Enter/Space 打开**；行内子控件自己处理激活，**不触发打开行**。
- 双击标题改名，但**有前置条件**：自窗口上次失焦以来对该标题仅单击过一次（防误触）。

### 3.2 工作区组头：hover 才显箭头与"新建"

**DSH 契约**（同文件 `:42-49`）

> `Project (workspace) header row: folder + title; hover reveals the chevron and, on a real Workspace, the create button; dwelling on a real Workspace shows its hover card. The ungrouped bucket has neither...`

🎯 **可执行契约**：组头 = 文件夹图标 + 标题；**箭头与"新建会话"按钮只在 hover 时出现**；"未分组"桶两者都没有（它背后没有真实 workspace，不能在其中开会话）。祖先被选中时即使子树折叠也要高亮（`containsCurrentDescendant`）。

### 3.3 长列表渐进披露：「展开其余 {n} 个会话」/「收起」

**DSH 契约**（`dsh-client-ui-workspace/lib/client.js` zh 词表，键集见 `lib/types/client/locales.d.ts:33-34`）

```
"sessions.expand":   "展开其余 {n} 个会话"
"sessions.collapse": "收起"
```

🎯 **可执行契约**：会话列表**默认折叠**，超出部分用一条「展开其余 {n} 个会话」显式披露，展开后给「收起」。`{n}` 是真实剩余数，不是估计。

### 3.4 四种空态必须分开（我方 D4 病灶的现成答案）

**DSH 契约**（`dsh-client-ui-workspace/lib/client.js` zh 词表；键集 `locales.d.ts:35-38`）

```
"empty.none":         "暂无会话"
"empty.noneArchived": "暂无已归档会话"
"empty.viewOthers":   "查看其他会话"
"empty.noMatches":    "无匹配结果"
```

🎯 **可执行契约**：**空 = 四种不同的话**（本来没有／当前筛选下没有已归档／别的视图里可能有／搜索无匹配）。这正好是《词典》§4.2「数据不足四种原因必须分开」的同构实现——**借它的分法，换我们的词**。

### 3.5 导航先让位、列表后滚（滚动接力）

**DSH 契约**（`dsh-client-ui-sidebar/lib/types/client/scroll-handoff.d.ts:1-9` 原文）

> `Scrolling down moves the navigation away before the section scroller moves; scrolling up returns the section scroller to its top before the navigation reappears. A gesture whose first event must move the viewport, or starts outside the section scroller, is split in JavaScript until it ends, including its momentum...`

🎯 **可执行契约**：侧栏纵向空间不够时，**先让顶部导航块滚出视野，再滚分组列表**；向上滚时**先把分组列表滚回顶，导航才回来**；同一次手势（含惯性）必须跨这两段边界连续，不许在边界处"吃掉"滚动。

### 3.6 我方现状（逐条差距）

| 项 | 我方实测 | 差在哪 |
|---|---|---|
| 行高/前导格 | `LeftPanel.tsx:251-259`：`panel-item` + 3 个内联 `fontSize:12/10`，无固定行高、无前导格 | 无 32/16 网格 |
| 相对时间 | `updatedAt` 在 `LeftPanel.tsx:90` 被存进 store，但 **`:255-256` 只渲染 title 与 `preview`（`阶段 {n}`）——`updatedAt` 从未被渲染** | 有数据不用 |
| 行操作菜单 | 无 | 缺 |
| hover card | 无 | 缺 |
| 键盘（Tab/Enter/Space） | 会话行是 `<div>`（`:243`），不可聚焦 | 缺 |
| 分组 hover 才显箭头 | 无组头概念（分组名是无交互的 `panel-section-title`） | 缺 |
| 展开其余 N | 无：`LeftPanel.tsx:75` 写死 `?limit=20`，超出既看不到也不提示 | 缺 |
| 四种空态 | 三种里只做了 1 种（客户列表 `:292` 有加载/失败两态）；最近对话、工作区**空时什么都不渲染** | 缺 3 种 |
| 滚动接力 | 无（单一滚动容器） | 缺 |
| 键盘可达性 | 顶部 4 图标只切高亮（`:174-180`） | 与 DSH 契约方向相反 |

**落批**：T3（空态四态 + 相对时间）｜T5（行网格、行菜单、键盘、组头 hover、渐进披露）｜T2（滚动接力样式）

---

## 4 输入框：九个座位、一个 336px 上限、三职圆钮

**DSH 契约**（`dsh-client-ui-conversation/src/client/contract/slots.ts:286-362`）

```
'conversation.composer'        kind:'chain'  owner:ComposerChainProps
'conversation.input.dock'      kind:'list'   owner:InputZone
'conversation.composer.dock'   kind:'list'
'conversation.input.attachments' kind:'single' owner:ComposerAttachmentsOwnerProps
```

`InputBar.tsx:489-545` 给出卡内自上而下顺序；`:504-593` 给出控制行分组。

### 4.1 卡的内部结构

🎯 **可执行契约**：卡内自上而下 =「浮层锚 → 可选 accessory → 附件栏 → 文本滚动区 → 控制行」；控制行 **左组 = `+` 按钮 → 权限 chip → 计划 chip →（预留位）/ 右组 =（预留位）→ 模型 → activity → 停止 → 主按钮**。

### 4.2 多行高度：不是 `rows`，是 **14 行 × 24px = 336px** 单一滚动口

**DSH 契约**（`dsh-client-ui-conversation/src/client/skeleton/ConversationRoot.module.css:434-441`）

```
/* One cap for every scrolling text region a composer seat can hold: the
   InputBar draft (figma Input 75:8208 max 14 lines × 24px line) ... */
--dsh-composer-text-max-height: 336px;
```
`InputBar.module.css:142-147` 原文：`The draft's scrollport, and the ONLY scrolling box in the composer. The contenteditable grows with its content inside; the 14-line cap lives here...`
`InputBar.module.css:186-190`：`.input { min-height: 36px; }`（停靠态 1 行 + 4px 上留白）；`:257-259`：`.hero .input { min-height: 52px; }`；`:88-92`：`@media (pointer: coarse) { font-size: max(16px, …) }`

🎯 **可执行契约**：
- 正文**随内容自然增高**；**上限 336px（14×24）**，到顶后**只有这一个盒子滚动**；
- 停靠态最低 **36px**，空会话居中（hero）态最低 **52px**；
- 行高 **24px**，字号默认 **14px**，且**随"设置里的字号偏好"整体缩放**（DSH 用 `--dsh-content-font-delta` 实现；px 上限固定，视觉行数随字号微变）；
- **触屏设备字号强制 ≥16px**（防 iOS 聚焦放大）；
- **DSH 完全没有 `rows/minRows/maxRows/autoResize` 这类 API**——尺寸只有 CSS 变量与 min-height。⇒ 我方**不要**引入 JS 算高度的方案。

### 4.3 滚动接力：草稿到边就把手势让给对话流

**DSH 契约**（`.../input/editor/view-binding.ts:89-97`）
```ts
if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atEnd)) return
e.preventDefault(); host.scrollTop += e.deltaY
```
🎯 **可执行契约**：草稿未到自己顶/底 ⇒ 自己滚；**一旦到边，同一次滚轮事件转发给外层对话容器**（短草稿不吃手势）。

### 4.4 一枚圆钮三职 + 禁用条件

**DSH 契约**（`InputBar.tsx:380-382`）
```tsx
const primaryDisabled = primaryStops ? stopAction === undefined
  : (!primaryRetries && empty) || disabled || machineBusy || uploadsPending
```
`InputBar.tsx:97-104`：`empty = draft.trim()==='' && attachments.length===0`；`InputBar.tsx:162-164,376`：`sending` 时主按钮变转圈。

🎯 **可执行契约**：
- 圆钮**三职**：运行中 ∧ 草稿空 ⇒ **停止**；`sending` ⇒ **转圈**（保持满填充、`cursor:progress`）；否则 ⇒ **发送**。
- **禁用条件** = `(空草稿 ∧ 无附件) ∨ locked ∨ machineBusy ∨ 有附件未上传完`；**纯空白不算内容**（`trim()`）。
- 失败的附件**保持禁用并提示重试，绝不静默丢弃**（原文 `a failed upload is retried or removed, never silently dropped`）。

### 4.5 无权限时**不渲染**，而不是置灰

**DSH 契约**（`InputBar.tsx:60-66, 562`）
```tsx
const promptDenied = useAccess('session/prompt') === false
...
{(primaryStops ? cancelDenied : promptDenied) ? null : ( … )}
```
🎯 **可执行契约**：没权限 ⇒ 按钮**整颗不出现**（不是 disabled）；`+` 与文件投放同理随之关闭。理由（原文注释）：`rather than a disabled control`。

### 4.6 键位：Enter/Shift+Enter/Ctrl+Enter 三分

**DSH 契约**（`.../input/editor/keymap.ts:258-281`）
```ts
if (event?.shiftKey === true) return false          // Shift+Enter = 原生换行
if (event?.repeat === true) return true             // 按住 Enter 只发一次
handlers.submit(event?.ctrlKey === true || event?.metaKey === true)
```
🎯 **可执行契约**：
- `Enter` = 提交；`Shift+Enter` = 换行；`Ctrl/Cmd+Enter` = 提交并"加速投递"；
- `Alt+Enter`／`Ctrl+Meta+Enter`／`Shift+Cmd(Ctrl)+Enter` = **既不提交也不换行**（吞掉）；
- **按住 Enter 只发一次**（`event.repeat` 直接 return）；
- **IME 组合中的 Enter 既不提交也不换行**；
- 菜单打开时 Enter 先选高亮项。

### 4.7 发送中：草稿不清空、正文只读

**DSH 契约**（`.../contract/input.ts:313-319`）
```ts
readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting' | 'sending'
```
`.../input/machine.ts:5-9` 原文：`A message stays in the read-only editor until the Host accepts it; only then does the editor clear, and a refusal or failure returns it to editing unchanged.`
停止键盘入口 = **Esc 两下**（`.../stop-sequence.ts:1,38-50`：两次独立按下才真停）。

🎯 **可执行契约**：发送中**正文与附件只读**；**Host 接受后才清空**；失败/拒绝 ⇒ **原样回到可编辑**并提示。pending 阶段在工具行显示 8px 呼吸圆点。

### 4.8 草稿按会话持久化

**DSH 契约**（`.../stores.ts:8,43-47`）：`localStorage` 键 `dsh.conversation.<sessionId>`，结构化快照（文本 + 引用 + 命令 token + 引用块，schema `.../src/client/draft.ts:34-59`）；解析失败退回空草稿不报错。
🎯 **可执行契约**：切会话/刷新可恢复草稿；**解析失败静默退空，不阻塞输入**。

### 4.9 附件四条入口 + 图片整批拒绝

**DSH 契约**（`InputBar.tsx:243-246,506-527`；`.../attachment/src/client/ComposerAttachments.tsx:56-64`；`keymap.ts:282-298`）
🎯 **可执行契约**：四条入口 = `+` 按钮／隐藏 `<input type=file multiple>`／**文档级拖拽投放**／编辑器粘贴。图片受 3 项上限（张数/单张/总量）且**超限整批拒绝**（不静默丢一张）；普通文件无客户端大小/数量限制。附件栏在正文上方，缩略图 **64×64** 圆角，hover 才出删除键。

### 4.10 触发菜单（`/`、`@`）

**DSH 契约**（`dsh-client-ui-input-trigger/src/types.ts:33-40`；`MenuView.module.css:1-7`）
🎯 **可执行契约**：触发符只有两个（`/` 命令、`@` 文件/会话）；菜单**向上打开、宽度等于输入卡宽**（不是跟光标的 popover），`max-height:400px` 且按上方空间收缩。

### 4.11 我方现状

| 项 | 我方实测（`8f9683c11`） | 差在哪 |
|---|---|---|
| 高度 | `Composer.tsx:219` `rows={2}` —— **固定 2 行，不增高、无上限、无滚动口** | 与 14×24 契约完全不符 |
| 三职圆钮 | `Composer.tsx:225` `disabled={!value.trim() \|\| disabled}`；只有"发送"一职，运行中无停止、无转圈 | 缺 2 职 |
| 无权限不渲染 | 无权限概念（前端不做 access 判定） | 缺 |
| Enter 语义 | `Composer.tsx:104` `if (!trimmed \|\| disabled) return` —— 仅有提交；无 Shift/Ctrl 区分、无 `repeat` 防连发、无 IME 处理 | 缺 4 条 |
| 发送中草稿 | 无 `phase` 概念 | 缺 |
| 草稿持久化 | 无 | 缺 |
| 附件 | `Composer.tsx:136-140` `handleDrop` 内仅注释 `// Phase 1.3: 实际文件上传` —— **拖拽是空实现** | 承诺未兑现（假控件） |
| 组件数 | 1 个 `Composer`，无座位概念 | 缺 9 座位 |

**落批**：T4（键位/只读/三职/无权限不渲染）｜T2（336px 上限、36/52px 地板、字号缩放、触屏 ≥16px）｜T5（座位拆分、附件栏、菜单锚）

---

## 5 权限 chip（截图里的「工作区内修改」）

**先纠正一件事**：它**不是"作用域"、不是"模式"、不是 agent preset**，是**本会话的权限预设**。

**DSH 契约**（`dsh-client-ui-permission-presets/src/client/locales.ts:12-14`；`presentation.ts:4-7,15-19`）

```
'preset.readOnly':       '仅可查看'
'preset.workspaceWrite': '工作区内修改'
'preset.fullAccess':     '完全权限'
```

机器值：`read-only` / `workspace-write` / `danger-full-access`（另有实验 `auto`，带 `EXP` 后缀角标）。

🎯 **可执行契约**：
- **取值集合来自宿主目录，不写死在前端**；内置三值有产品文案，其余显示宿主给的 name。
- 切换**只改当前会话**，落法是给该会话发 `/permission <preset>`（与斜杠命令同一条写入路径）；确认来自**会话投影**，不是前端乐观状态。
- `danger-full-access` 与 `auto` **必须过二次风险确认**（勾选"我已了解风险"才能启用）。
- 尺寸：高 **28px**、字号 **13/20**、`font-weight:500`、无底色、`max-width:220px`、圆角 `--dsw-radius-sm`。
- **窄容器断点 460px**：`@container (max-width:460px)` 时**只留 14px 图标、隐藏文字**（前提是该预设带内置图标；宿主自定义无图标则保留文字）。
- 位置：控制行**左组**，`+` 之后、计划 chip 之前。
- **计划 chip 是"状态灯 + 出口"不是选择器**：只在计划模式生效时出现，点它 = 关闭。

**我方现状**：无权限 chip、无计划 chip；`Composer.tsx` 控制行只有「发送」。能力访问控制散在 `capability.ts`（`canAccessCap`），与输入区无关。

**落批**：T5

---

## 6 模型选择器（截图里的「DeepSeek-V4.1-Flash Max」）

### 6.1 「Max」是**推理档位**，不是成本档、不是模型版本

**DSH 契约**（`dsh-llm-deepseek/src/model-info.ts:10-30`）
```ts
{ id: MAX_REASONING_EFFORT, name: 'Max',
  description: 'Reserve for the hardest quality-first tasks.' }
```
🎯 **可执行契约**：四个档位固定 `off/low/high/max` ↔ `Off/Low/High/Max`；默认档由连接配置决定（缺省 `high`）；**档位名来自适配器，不是前端词表**。
**视觉上是两段拼接**：`ModelSelect.tsx:400,467-470` → 模型名 span + 档位 span（4px 间距、caption 色、**无分隔符**）；只有 `title`/aria 里用 `·`。

### 6.2 两级菜单 + >4 才搜索

**DSH 契约**（`ModelSelect.tsx:1-13` 原文）：`Two-level selection ... the root menu is the Model / Effort row pair (label + current value + a right chevron), each drilling into its own list`；`:115` 目录 > 4 个模型才出现搜索框，搜索保留焦点、`↑/↓` 循环、`Enter`/`Tab` 接受。
🎯 **可执行契约**：点开先两行（模型／推理等级）→ 各自钻子列表；**>4 才给搜索**。

### 6.3 窄化时**先牺牲档位文字**，再牺牲模型名

**DSH 契约**（`ModelSelect.module.css:56-67`）
```css
.triggerEffort { flex-shrink: 1000; text-overflow: ellipsis; ... }
```
原文：`the effort absorb all deficit first — it ellipsizes away to nothing before the model name loses a single pixel, and the chevron stays snug throughout.`
🎯 **可执行契约**：宽度不足 ⇒ 档位字先缩到消失 ⇒ 才轮到模型名 ⇒ **chevron 永不缩**。

### 6.4 三种"没有模型"三套表达 + 已保存选择不丢

**DSH 契约**（`ModelSelect.tsx:217,395-399`；`directory.ts:20-25`）
🎯 **可执行契约**：能力不可用 ⇒ **整个 seat 不渲染**；加载中 ⇒「正在加载模型…」；已加载但当前值不在目录 ⇒「请选择模型」占位；**已保存但目录里消失的选择仍继续显示**（`routable=false`）；选择失败走锚定在输入卡的瞬时 Toast，不弹模态。

### 6.5 持久化：按会话，不是全局偏好

**DSH 契约**（`.../directory.ts:92-106`；`dsh-agent/src/model-selection.ts:114`）——写会话日志事件 `model/selection`。
🎯 **可执行契约**：**按会话**持久化；同一会话的 `/model` 弹层与 composer seat **共用同一个目录实例**（两边永远显示同一当前值）；"新会话默认模型"是**另一份配置**。

**我方现状**：只有 `LlmSetupCard.tsx` 的全局配置（provider/model/baseUrl/apiKey），**无按会话模型、无推理档位、无两级菜单、无 seat**。

**落批**：T6（模型/档位语义与持久化）＋T5（seat 位置与窄化）

---

## 7 状态 meta：两个 pill + 一个环，全在卡片**下方**

**DSH 契约**（`InputBar.tsx:596-601`；`dsh-client-ui-chat/src/client/apply.ts:345,348`）

```tsx
<div className={css.dock} data-composer-dock>
```
dock 内固定顺序 = `activity`(order 0) → `usage`(order 1) → 上下文环；**只在停靠态（已有会话）显示统计 pill**，hero 不显示；activity 展开时隐藏上下文环。

### 7.1 「2 轮 148 步」

**DSH 契约**（`dsh-session-stats/src/types.ts:25-28`）
```
turns: number  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
steps: number  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
```
🎯 **可执行契约**：轮 = **有至少一个已结束 step 的不同轮次**（被拒/空轮不计）；步 = **`step/end` 事件数**（完成/失败/取消都算）；统计取自**整个持久日志的投影**，与屏幕滚到哪无关。

### 7.2 「234 tok/s」

**DSH 契约**（`.../chat/message-chrome.ts:66-74`）
```ts
return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
```
🎯 **可执行契约**：`tok/s` = **会话级平均**（所有记录到输出 token 的 step 的解码 token 总量 ÷ 解码秒数），**不是瞬时值**；显示 **≥10 取整、<10 保留 1 位小数**；文案 `{tps} tok/s`。

### 7.3 「34.6M tok」

**DSH 契约**（`.../chat/token-format.ts:9-15`；`dsh-client-locale/src/locales/zh.ts:42-43`）
```ts
candidate >= 100 ? round : round(×10)/10
```
🎯 **可执行契约**：<1000 原数；≥1000 用 `K`；≥1e6 用 `M`；**缩放后 <100 保留 1 位小数、≥100 取整**；总量 = **未缓存输入 + 缓存读 + 缓存写 + 输出**（四桶互斥，推理 token 已含在输出里不重复计）。

### 7.4 「缓存命中 99%」——**永不把未满的命中率舍成 100%**

**DSH 契约**（`.../chat/token-format.ts:59-66` 原文）
> `Display-ready cache-hit share without rounding a partial hit to 100%. ... partial hits that would round to 100 automatically use enough additional precision to stay honest.`
`StatsPills.tsx:108-120`：分母 = 未缓存输入 + 缓存读 + 缓存写。
🎯 **可执行契约**：默认整数百分比；**若会进位到 100 则自动加小数位**（最多 `99.99…x`）；无提示输入 ⇒ 返回 `null`，**整条 pill 不显示**（不是显示 0%）。

### 7.5 「32%」上下文环

**DSH 契约**（`.../context-occupancy.ts:15-25`）
```ts
percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100))
```
🎯 **可执行契约**：= **下一次请求**的上下文占用 ÷ 最新已知容量，**四舍五入整数并夹在 100**；分子**不含本轮输出**（流式输出不会推高百分比）；分子或容量任一未知 ⇒ **整块不渲染**；形态 = **14px 圆环 + 百分数**的按钮，点开是对话框（`~已用 / 窗口` + 三段条），**`~` 前缀标明是启发式估值**；明确定位为"展示参考，不作计费/闸门"。

### 7.6 布局：dock 预留 22px 防跳高

**DSH 契约**（`InputBar.module.css:13-29`；`StatsPills.module.css:6-34`）

```css
.root:not(.hero) > .dock { min-height: calc(22px + var(--dsh-content-font-delta-secondary, 0px)); }
.pill { padding: 1px 8px; border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
```
🎯 **可执行契约**：meta 条在卡**下方居中**、间距 12px；字号 **12/20**、**`tabular-nums`**（数字跳动不抖宽）、第三者色文字；**dock 预留 22px 最小高度 ⇒ 读数到达时输入区不跳高**；两段读数之间用 `·`；**没有定时刷新**，随会话投影更新；单击 pill 打开详情对话框，hover 只在文字被 ellipsis 截断时出 tooltip。

**我方现状**：`CenterPanel.tsx` 无 dock、无轮/步/tok/s/缓存/上下文任何指标；`StatusBar.tsx:40-51` 只有「N 条告警」与「上次诊断」（且 `alertCount` 实为 open 工单数）。⇒ 客户看不到"这一切到底花了多少、跑到哪了"。

**落批**：T6（口径与精度）＋T5（dock 位置与防跳）

---

## 8 相对时间：六档 + 两套写法

**DSH 契约**（`dsh-client-ui-workspace/src/client/locales.ts:121-127`）
```ts
'time.now': '刚刚', 'time.minutes': '{n}分钟', 'time.hours': '{n}小时',
'time.days': '{n}天', 'time.months': '{n}个月', 'time.years': '{n}年', 'time.ago': '{t}前',
```
🎯 **可执行契约**：
- 中文**只有 6 档**：`now/minutes/hours/days/months/years`；**没有"周"档**（全树零 `time.weeks`）⇒ 不许出现"X 周"。
- **两套写法**：侧栏行内用**紧凑式**（`12分钟`/`1小时`/`7天`/`2个月`）；hover card 用 **`{t}前`**（`12分钟前`），且 `now` 档**不带"前"**。
- **刷新节奏**：`now = Date.now()` 在**渲染时取一次**并下传，**没有定时器**；静止 1 小时不会自己从"12分钟"跳到"1小时"（原文 `WorkspaceBrowser.tsx:414,723`；`Rows.tsx` 全文件无 `setInterval`）。

⚠️ **未找到（不许猜）**：`relativeTime()` 的**分档阈值与取整规则**实现在 `@deepseek-ai/dsh-client-ui-primitives`，而**该包的目录在锁版安装树中不存在**（`Get-ChildItem -Directory -Filter dsh-client-ui-primitives*` 对 `_r3chain-20261123` = **0 命中**）；调用点确实是外部引用而非内联实现（`.../rows/Rows.tsx:20` 的 import、`dsh-client-ui-workspace/lib/client.js` 的 `require("@deepseek-ai/dsh-client-ui-primitives")`）。
⚠️ **措辞更正（R5 指出）**：字符串 `dsh-client-ui-primitives` **是**有命中的（多个 `package.json` 的依赖声明、`dsh-client-shortcuts/src/client/dom.ts:2` 等）——所以准确说法是"**被声明为依赖但未随安装树落地**"，**不是**"全树零命中"。阈值因此读不到，结论不变。
✅ 可确证的只有：输出必须落在那 6 个 `unit` 内（`Rows.tsx:151-160`），否则 `t(\`time.${unit}\`)` 查不到键。
⇒ **我方自定阈值**（属我们的设计决定，不冒充 DSH）：`<60s → 刚刚`；`<60m → n分钟`；`<24h → n小时`；`<30d → n天`；`<12mo → n个月`；其余 `n年`；均**向下取整**。写进《词典》后由 T3 实现。

**我方现状**：`updatedAt` 取了不渲染（`LeftPanel.tsx:90` vs `:255-256`）。

**落批**：T3

---

## 9 长列表：分块不可变列表

**DSH 契约**（`dsh-chunked-list/lib/types/index.d.ts:15-33`）
```ts
appendChunkedList(head, value)   // 最多复制一个 64 值块
iterateChunkedList(head)          // 插入序，O(N) 时间 / O(N/64) 暂存
chunkedListSchema(valueSchema)    // 校验非空检查点，拒空块/超长块/未知字段
```
🎯 **可执行契约**：长列表用**追加式分块（每块 64）**，旧块按引用共享 ⇒ 追加不复制全表；**遍历用生成器**，不一次性展开；检查点校验拒绝空块/超长块。适用对象：对话事件流、审计/操作日志。

**我方现状**：会话列表一次 `limit=20`；事件流一次全渲染（`DshRunPanel.tsx:187-189` 直接 `events.map`）。

**落批**：T3（长列表渲染策略）——**先只借"生成器遍历 + 分块追加"两条**，不引入 DSH 的 zod 校验（我们无此依赖）。

---

## 10 窄化优先级：四级取舍（同一条控制行）

**DSH 契约**（四份实物合成）
| 级 | 触发 | 动作 | 实物 |
|---|---|---|---|
| 1 | 行宽 ≤ **560px** | 三组间距 **12→8px** | `InputBar.module.css:327-333` |
| 2 | 行宽 ≤ **460px** | 权限 chip **掉文字留图标** | `PermissionSelect.module.css:88-98` |
| 3 | 由 JS 实测行宽 | 模型 seat 加 `data-model-compact`，转图标；档位字 `flex-shrink:1000` 先消失 | `control-row-layout.ts:10-22`；`ModelSelect.module.css:56-67` |
| 4 | 仍放不下 | 整行 `flex-wrap: wrap`，"模型+发送"换到第二行 | `InputBar.module.css:273-324` |

🎯 **可执行契约**：窄化顺序 = **间距 → 权限 chip 文字 → 模型 seat 文字/图标 → trailing 组换行**；**发送按钮与 `+` 永不缩**（`.primary` 34px、`.add` 28px，均 `flex:none`）。
⚠️ 第 3 级**必须由 JS 实测行宽**而非纯 CSS（模型名长度不可预测，CSS 表达不了"优先牺牲谁"）——这正是"做不好细节"的典型处。

**落批**：T5

---

## 11 内容宽度轴：一条变量管四个面

**DSH 契约**（`ConversationRoot.module.css:465-475`）
```css
--dsh-chat-content-width: var(--dsh-chat-user-width,
  clamp(680px, calc(var(--dsh-conversation-column-width, 0px) * 0.64), 920px));
--dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 32px);
--dsh-composer-side-clearance: 16px;
```
`MessageItem.module.css:20`：用户气泡 `max-width: min(内容宽 × 0.702, 82%)`。

🎯 **可执行契约**：
- **一条** `内容宽 C = clamp(680px, 列宽×64%, 920px)` 同时约束：消息列、输入卡、dock 卡、takeover 卡；**输入卡 = C + 32px**，两侧再各 16px。
- 用户气泡 = `min(C × 0.702, 栏宽 82%)`。
- **唯一例外是 meta 条**：`max-width:100%` 且居中 ⇒ 宽屏下会比输入卡宽、视觉上"浮"在卡下居中，**不与卡片左右对齐**（有意为之）。

**我方现状**：`CenterPanel.tsx` 消息列与 `Composer` 无共享宽度轴；输入区不 sticky。

**落批**：T2（布局轴）＋T3（消息列）

---

## 12 sticky 与 portal：两个硬约束

**DSH 契约**（`ConversationRoot.module.css:514-548`）
```css
position: sticky; bottom: 0; z-index: 9;
background: linear-gradient(180deg,
  color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px,
  var(--dsw-alias-bg-base) 36px);
```
原文：`该 seat 有 will-change: transform ⇒ 成为 fixed 子元素的包含块 ⇒ composer 内的 tooltip/menu/面板一律 portal 到 document.body`。

🎯 **可执行契约**：
- 输入区永久 **sticky 在会话列底部**，`z-index:9`（高于代码块横幅 6 / 压缩头与 turn rail 7 / 回到底部 8）。
- 顶部固定 **36px** 从透明到 `bg-base` 的**渐隐带**；停点用 **px 不用百分比** ⇒ 草稿变高只加长实色区、**不拉伸渐隐带**。
- 因 `will-change:transform` 形成包含块，**输入区内一切浮层必须 portal 到 `document.body`**（否则被裁剪/错位）。

**我方现状**：`CenterPanel` 输入区在流底部，无 sticky、无渐隐带；`CommandPalette`/`NotificationCenter` 在 `App.tsx:156-157` 顶层渲染（这点已符合 portal 精神）。

**落批**：T2

---

## 13 字号/间距/圆角语言（做"看起来一致"的地方）

**DSH 契约**（六份实物合成）
| 语义 | 值 | 实物 |
|---|---|---|
| chip / model trigger | **13px / 20px**，`gap:4px`，高 **28px** | `PermissionSelect.module.css:7,15-16`；`ModelSelect.module.css:20,28-29` |
| meta pill | **12px / 20px**，`tabular-nums` | `StatsPills.module.css:9-10,24-26` |
| 草稿正文 | 行高 **24px**，字号 14px（随偏好缩放） | `InputBar.module.css:73-78` |
| 圆角 | chip/pill `--dsw-radius-sm`；输入卡 `--dsw-radius-panel`；两枚圆钮 **999px** | `InputBar.module.css:70,343,405` |
| 圆钮尺寸 | `+` **28px**；主按钮 **34px** 且 `translateY(-2px)` 抵消控制行 2px 下移 | `InputBar.module.css:340-341,402-416` |
| dock 间距 | **12px**，`padding-top:4px`，`min-height:22px` | `InputBar.module.css:13-29` |

🎯 **可执行契约**：把上表抽成我方令牌（`--sn-*`），**不要在组件里写裸数值**。

**我方现状**：`global.css` 内联 `fontSize:12/10/11` 散落（如 `LeftPanel.tsx:246-247,283`、`RightPanel.tsx:103`），**无字号/圆角令牌层级**。

**落批**：T2

---

## 14 「不做换皮」的可机判判据

交接件要求复用要落到我们自己的 IA 与文案上。**必须能机器证明**，否则"没换皮"只是声明。

| # | 判据 | 判法 |
|---|---|---|
| N1 | 我方**一级导航项集合** 与 DSH 侧栏导航项集合**交集为空** | 我方一级项取自《词典》§6.3（我的目标／卡在哪／该做什么／做到了什么／设置）；DSH 侧栏项取自 `dsh-client-ui-sidebar` 与 `dsh-client-ui-workspace` 的 zh 词表（新会话／插件／自动化任务／更多／全局面板／导航）。**逐项比较，断言交集 = ∅** |
| N2 | 每个我方一级项必须能映射到**宪章 ⑤ 五件事**之一 | 表格固定映射；新增一级项若无映射 ⇒ 红 |
| N3 | 客户面**不得出现** DSH 的产品术语 | 复用《词典》§1 禁用词：`DSH`、`新会话`（用我方"问一个问题"类说法）、`插件`、`Agent`、`skill`、`workflow` |
| N4 | 借来的**结构**必须换词：同一结构下我方文案 ≠ DSH 文案 | 抽样：空态四态、展开其余 N、相对时间六档、权限三档——**结构可同、字面必须不同**（《词典》§2 给映射） |
| N5 | 不得引入 DSH 的会话第一公民模型 | 我方一级导航第 1 项是「我的目标」，**不是会话列表**；会话不作为导航一级项 |

**落批**：T5 验收项（N1/N2/N5）＋T1 已建的禁用词基线（N3/N4）

---

## 15 明确不可借／未找到（防冒充）

| 项 | 结论 |
|---|---|
| 相对时间分档阈值 | **未找到**：`dsh-client-ui-primitives` **包目录**不在锁版安装树（被多处 `package.json` 声明为依赖但未落地）⇒ 实现由宿主运行时提供、阈值不可读。⇒ 我方自定，见 §8 |
| 输入框 `rows/minRows/maxRows/autoResize` | **DSH 无此 API** ⇒ 我方改为 CSS 上限 + min-height，不写 JS 算高 |
| 「Max = 更贵/成本档」 | **未找到**；`Max` 只是推理档位文案 `Reserve for the hardest quality-first tasks.` |
| DSH 的导航结构 / 会话当第一公民 / 内部术语 | **禁止照搬**（宪章 §6.3 壳属我们） |
| `dsh-client-ui-trajectory` / `dsh-experimental-client-ui-stats` 参与 composer meta | **否**：前者是视图页签，后者是独立的 Statistics 页 |
| 空态组件可借实现 | **没有** `dsh-client-ui-empty` 包 ⇒ 空态 Expression 我方自定（只借"分四态"的分法） |

---

## 16 变更规则

- 本文所有数值以**锁版实物**为准；DSH 换版后须重新取证，**不得沿用旧数字**。
- 标 ⚠️／❌ 的项是我方设计决定，**不得在对外材料中表述为"DSH 的做法"**。
- 本文升版必须同步 DEV DOC §6.2 批次表与《词典》§7.1 指针。
