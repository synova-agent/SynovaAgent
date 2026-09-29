# @synova/dsh-dashboards — Synova 控制塔可视化（DSH 左侧栏 · 三个入口）

左侧栏三个入口 → 三张只读面板。**入口各自独立**（D1060「治理线与格子物理分离」）：

| 入口 | 槽位 id / main key | 面板 | 数据源 |
|---|---|---|---|
| 📊 项目总览 | `synova-project-overview` | 六区块（下表） | `/synova/pm/ledger` + `/synova/dashboards/data` |
| 🧰 开发工作台 | `synova-dev-workbench` | ① 四问格子矩阵 ② 今日/本周流水 ③ 待你裁 ④ 阻塞 | `/synova/workbench/data` |
| ⚖️ 治理线 | `synova-governance-line` | 治理卡列表 + 欠账/待规划 | `/synova/governance/data` |

> 早期版本的右侧栏三仪表盘（`shell.overlay`）**已删除**，不再维护第二个侧面入口。

## D1060 · 面板 A「Synova 开发工作台」

D963（宪章格子面板）的升级：从一个静态格子升级为四区块工作台。**全部数字机器生成，禁手写**。

| 区块 | 内容 | 数据源（Host 端每请求实时取数） |
|---|---|---|
| ① 四问格子矩阵 | 16 行（扩展点）× 4 问（加/接/生效/删），四色 + 逐格判据 tooltip | `docs/synova/coordination/宪章三问-48格.json`（D1059 起 64 格） |
| ② 今日/本周流水 | 今日提交数/清单、本周提交数/清单（自本周一）、PR 未合队列 + 本周已合并清单 | `git log --since` + GitHub PR API（`/pulls` + `/search/issues`） |
| ③ 待你裁 | 一句话 + 我的倾向 + 等待天数；另列「卡面扫描『需创始人』」 | `product-progress.json#decisions`（上游 `cockpit-override.yaml#pending_decisions`）+ `task-state/*.json` 文本扫描 |
| ④ 阻塞 | 卡在哪 + 卡了几天 + 需要谁 | `ledger.json#blocked` + `product-progress.json#lines[].blocked`（三要素口径） |

**四色口径**（与 `scripts/control-tower/gen-charter-grid.py:15-16` 同源，禁第二套配色）：
🟢 生效了 / 🟡 接了但没生效 / 🔴 缺失 / **⚪ 未填**。**空格一律显式 ⚪未填 + 「待办 · 未填判据」**，
绝不折算成绿（院方 X27：缺失≠通过）。数据源里出现未知 status → 单列 `❔ 未知态`，不改写。

**口径显式**（可核、可推翻，全部随 payload 返回并由面板原样展示）：
- 阻塞 = 三要素 `{reason, since, needs}` 齐全才计入（`scripts/project/gen-project-board.py:66`）。
  缺要素的卡面 `blocked` **单列「未申报」并计数**，不静默补、不计入阻塞数。
- 待你裁 = `status ≠ resolved` 才算待裁；卡面文本扫描结果**单列**（无选项/无倾向 ⇒ 不混进权威表）。
- 等待天数取该项自带日期锚点；锚点缺失 → `null` → UI 显 `—`（不编天数）。

## D1060 · 面板 B「治理线」（与格子**物理分离**）

两个独立入口、两条独立路由、两块独立降级 —— **不是**同一面板里的两个区块。

| 列 | 含义 | 来源 |
|---|---|---|
| 域 | `domain`（缺失显式写 `—（卡面未声明）`） | `task-state/D###.json#domain` |
| 卡号 | `task_id` | 同上 |
| 状态 | `status`（活卡/终态分流；默认只看活卡） | 同上 |
| 服务哪条主线 | 卡面显式 `line` 字段 → 否则文本抽 `线 N` → 否则 `—（卡面未声明）`，**不猜** | `line` / note / blocked / title |
| 等待天数 | 今天 − `updated_at`（不可解析 → `—`） | `updated_at` |

治理线口径 = 三条**机器可见**信号之一：① `domain=doc-governance` ② 标题以 `CT-` 开头
③ 标题/里程碑含 `治理|门禁|控制塔`。**逐卡回传命中信号**（面板逐卡显示"凭哪条信号入选"），可复核可推翻。

欠账/待规划来自 `docs/synova/coordination/board-backlog.json`（PLAN-*）。
`docs/synova/product-lines/todos.yaml`（T-*）**未消费**并在面板上写明原因（插件零依赖，不引 YAML 解析器；
该源由 task-board-adapter 的 Python 派生器消费）—— 宁可少一个源并列明，也不静默漏源。

## D1066 · 看板数据真实性（来源真 / 内容真 / 时效真 / 治理落库）

> 承 D1060 · 深化。病根（CTO+K3 实测）：profile 的 dependency 指过 `file:/tmp/v-ux/...`，
> /tmp 清理后安装目录只剩空目录 ⇒ Host 半加载不到代码，**面板静默消失**。

### ① 来源真（install-dashboards.sh）

| 机制 | 行为 |
|---|---|
| 来源定位 | `--repo-root` > `$SYNOVA_REPO_ROOT` > **git 主工作树**（`git worktree list --porcelain` 首行）> 脚本上溯三级 |
| 易失路径黑名单 | 来源命中 `/tmp`、`/private/tmp`、`/var/folders`、`*/.synova-wt-*/*` ⇒ **exit 2 拒装** |
| 源头体检（fail-closed） | 缺 `lib/`、`lib/*.js` 计数 0、缺 `package.json`/`lib/index.js`/`lib/client.js` ⇒ **exit 2 拒装**（宁可不装，不装空壳） |
| 装后自证 | 副本 `lib/*.js` 非空 + `diff -r` 与源头逐字节一致 ⇒ 才打印成功；否则**回滚**上一份副本 + exit 3 |
| profile 配置 | dependencies / `dsh.profile.bundles` **由脚本生成维护**，禁止手工改 profile package.json |

### ② 内容真（charter-judge-map.json + judge-charter.mjs）

宪章 64 格的状态**由命令退出码派生，不手编**：

```bash
node dsh/plugins/synova-dashboards/scripts/judge-charter.mjs --repo-root <repo> [--dry-run]
```

- `judge_state=ready` 且命令退出 0 ⇒ 🟢 生效了；非 0 ⇒ 🔴 缺失；`judge_state=todo` ⇒ ⚪ 未填/待办（**不折算成绿**）
- 每格落 `judge_cmd`（可复跑）+ `judge_basis`（判据含义）+ `evidence`（退出码与输出）+ `checked_by`
- 判据映射 `docs/synova/coordination/charter-judge-map.json`：16 扩展点 × 4 问；证据路径逐条 grep 实测
- 首批结果：`filled 30/64`（🟢29 🔴1）；q3「生效了吗」16 格 + q4「删了吗」16 格 + 时间尺度 2 格无证据 ⇒ ⚪ 待办
- 执行器当场抓出两处**作者假绿**并修正：报告模板 q2 指错文件（改指 manifest `entryPoint` 声明的 loader 并追到 `src/server.ts` 调用链）；
  公式参数 q2 只命中注释行 → 加严为「排除注释行后 ≥1 命中」⇒ 真结论 🔴（`transfer_function` 声明在边数据里、生产 TS 零读取）

### ③ 时效真（provenance）

每个数据块旁显示 **来源路径 + 来源类型 + 生成时间 + 年龄**；`>24h` ⇒ 变灰并标「⚠ 陈旧(>24h)」；
时间不可解析 ⇒ 显「—」且 `stale=null`（**不默认新鲜**）。
**数据源自检**：来源落在 `/tmp` 或 `.synova-wt-*` ⇒ 面板顶部红色自检横幅逐条点名（防 D1066 病根复发），
同时进 `degraded_sources`（铁律 31）。

### ④ 治理落库（仓库内两件）

```bash
node dsh/plugins/synova-dashboards/scripts/gen-governance-ledger.mjs --repo-root <repo>
```

| 落库件 | 内容 | 面板 |
|---|---|---|
| `docs/synova/coordination/governance-tasks.json` | 治理卡台账（域/卡号/状态/服务的阻塞/等待天数）+ 欠账表 | 面板 B **主源**（`source_mode=in-repo-ledger`） |
| `docs/synova/coordination/pending-decisions.json` | 待裁清单（pending/resolved/卡面扫描） | 面板 A ③ 待你裁主源 |

- 落库件不可用/结构异常 ⇒ 显式回退现场扫描或现场派生，并在 `degraded_sources` 说明原因（**不静默**）
- 两源皆空 ⇒ 生成器 **exit 2 拒写**（不写空台账冒充数据）

## 面板 A（项目总览）六区块

| 面板区块 | 数据 | 数据源（Host 端按请求实时取数，无缓存） |
|---|---|---|
| ① 顶部四数 | 交付度 / 验证率 / 保鲜红灯 / 阻塞数 | `ledger.totals` |
| ② 26 线总览 | 每线 V1 通过 x/y、保鲜色、阻塞标签、断言明细（点行展开） | `ledger.lines` |
| ③ 阻塞清单 | 原因 + 起始 + 需要谁 + 已卡天数 | `ledger.blocked` |
| ④ 执行看板 | D# / 状态 / owner / 停滞天数（降序取前 12 + 状态分布） | `ledger.tasks`（D795 由 `task-state/*.json` 派生） |
| ⑤ 健康 | 真绕过 / 门禁拒绝 / 提交失败 + M 模式复发 + CTO 判定 | `GET /synova/dashboards/data` → `health`（`.claude/bypass.log`、`.claude/pre-commit-failures.log`、AUDIT-FINDINGS-LEDGER、CTO-HEALTH） |
| ⑥ 时间轴 | 里程碑泳道 / 计划×实际 | `ledger.timeline` |

> 原右栏「完成度」页签**已删重复**——其信息（26 线进度）由区块 ② 覆盖。
> 原「任务」「健康」两页签分别并入区块 ④ / ⑤。

**实时性**：60s 轮询 + 回到前台立即刷新 + 手动刷新；由 Host 半每次请求实时取数。

### 面板交互（D794 收口）

| 交互 | 做法 | 记忆 |
|---|---|---|
| 拖动 | 标题栏为拖拽区（Pointer Events + `setPointerCapture`），移动被夹在视口内 | `localStorage["synova.pm.panel.v1"]` |
| 缩放 | 右下角 resize 手柄；min **720×480**，max **视口-32px** | 同上（与位置同一个键） |
| 折叠 | 每个区块标题右侧 ▸/▾ 开关；「26 线总览 / 阻塞清单 / 执行看板 / 健康 / 时间轴」五块各自独立 | `localStorage["synova.pm.collapse.v1"]` |
| 断言明细 | 默认**收起**，点行展开该线断言明细 | 不记忆（会话内状态） |

- 面板为 `position:fixed` 浮动卡片（`z-index:40`），默认视口内居中，四周留 32px。
- 偏好读写失败（隐私模式/配额）只记 `console.warn` 并降级为「不记忆」，**不抛错、不白屏**（铁律 24/31）。
- 几何在写入与读取时都过 `normalizeGeo()`：无论记忆值多离谱，渲染前都被夹进 min/max 且不出视口。

### 修裁切/重叠（根因）

`.spo-body` 是 flex 列容器，子项默认 `flex-shrink:1` —— 26 线这类长列表会把每个区块**压扁并互相裁切**。
修复三件套：

```css
.spo-body>*{flex:none}                     /* ① 区块不再被压缩 */
.spo-sec{flex:none}                        /*    显式兜底 */
.spo-list{max-height:40vh;overflow-y:auto} /* ② 列表类区块自带滚动（外层 .spo-body 仍保留滚动） */
```

区块是 `.spo-body` 的**直接子项**（测试断言 `parentClass === "spo-body"`），故 `flex:none` 必然命中。

## 架构

### 挂载（全局，任意预设会话可见）

- **挂载点**：`~/.dsh/profiles/web/package.json` 的
  `dependencies["@synova/dsh-dashboards"] = "file:…/dsh/plugins/synova-dashboards"`
  \+ `dsh.profile.bundles` 追加 `"@synova/dsh-dashboards"`。
  包内 `cordis.patch.yml` 是 bundle 层（`dsh.bundle.patch` 声明），把 Host 半插进 web profile 树。
- **为什么是 bundle 而不是预设**：bundle 属于 **web profile 本身**，任何预设会话（synova-cto / cordis / 默认…）
  共用同一棵树 → 入口全局可见（D794 派发 §A.2.1）。早期版本挂在 synova-cto 预设下，仅 CTO 会话可见，已废弃。
- 包内另有进程级 `active` 护栏防并发重复挂载（`lib/index.js`）。

### Host 半（`lib/index.js`，dsh web 进程内 Cordis 插件）

四条**只读** GET 路由：

| 路由 | 成功 | 降级 |
|------|------|------|
| `GET /synova/pm/ledger` | 200 + `{ ...ledger, ok:true, source:"worktree"\|"origin/main"[, source_detail] }` | 200 + `{ok:false, degraded:true, error, attempts}` |
| `GET /synova/dashboards/data` | 健康区 payload（`health` 被面板区块 ⑤ 使用） | 200 + `{degraded:true, error}`（每个 section 独立降级） |
| `GET /synova/workbench/data` | 200 + `{ok, degraded, degraded_sources[], grid, flow, decisions, blocked}`（D1060 面板 A） | 每块独立降级；四块全失败才 `ok:false` |
| `GET /synova/governance/data` | 200 + `{ok, degraded, degraded_sources[], scope, cards, debt}`（D1060 面板 B） | 两源独立降级（治理卡 / 欠账表） |

D1060 新增的取数器（均纯 Node、无 cordis 依赖、可独立 `node --test`、**全程不抛异常**）：

| 模块 | 职责 |
|---|---|
| `lib/repofile.js` | 「工作区 → `origin/main`」二级取数（收敛到一处，避免各源各写一遍导致某个源忘了回退） |
| `lib/flow.js` | `git log` 今日/本周窗口 + GitHub PR API（`/pulls` 未合队列 + `/search/issues` 本周已合并） |
| `lib/workbench.js` | 四问格子 / 待你裁 / 阻塞 三块的解析与口径（四色、三要素、状态归一） |
| `lib/governance.js` | 治理线判定信号 / 「服务哪条主线」/ 活卡终态分流 / 欠账表 |

**PR 取数**（`lib/flow.js`）：token 取自 `~/.dsh/.credentials.yaml`（与 `scripts/project/pr-queue-scan.py` 同源，
**只进请求头，绝不回传/落盘/打印**；可用 `SYNOVA_GITHUB_TOKEN` 覆盖）。失败两级：
① GitHub API → ② 仓库内机器生成的 `docs/synova/project/pr-queue.json` 快照（面板显式标注「快照 + 生成时间」，
且**不伪造「今日/本周已合」**——快照没有合并时间就留空）→ ③ 显式 `degraded`。
> 为什么合并数走 `/search/issues?is:merged merged:>=周一` 而不是 `GET /pulls?state=closed`：
> 后者按 updated 排序，最近关闭的多为未合并清理，统计"本周合并数"会**恒为 0 而不报错**（静默假数）。

**账本三级取数**（`lib/ledger.js`，D794 收口）：

1. 工作区 `<repoRoot>/docs/synova/project/ledger.json` → `source="worktree"`
2. 否则 `git -C <repoRoot> show origin/main:docs/synova/project/ledger.json` → `source="origin/main"`
3. 两级都失败 → 显式 `degraded`，`error`/`attempts` 带上**每一级各自的原因**

> **为什么**：只读工作区文件时，谁 checkout 了别的分支账本就随之消失 →「数据不通」（实测）。
> 第 2 级以 `origin/main`（D334「main 是唯一真相」）为权威回退。
> 工作区账本**坏 JSON 也不直接判死**，会继续尝试第 2 级（并在 `source_detail` 说明）。
> 本模块**不执行 `git fetch`**：`origin/main` ref 的新鲜度依赖仓库既有 fetch 纪律（铁律 0-3 / pre-push）。

- 账本读取器 `lib/ledger.js` 纯 Node（无 cordis 依赖，可独立测试）；三级**全部不抛异常**，
  降级与回退都会 `logger.warn` 留痕（铁律 24/31：禁静默）。
- 数据收集器 `lib/collect.js` 同上，逐 section 独立 try/catch。
- **零写入**：Host 半只 `readFile` + 只读 `git show/ls-tree/log` + 只读 HTTP GET，不写工作区/仓库/账本。

### Client 半（`lib/client.js`，浏览器）

以 `window.__ModuleLoader__.load` 工厂格式**手写，无需构建**；只 require 静态种子模块
（react / react/jsx-runtime）。注册**三对**槽位（每对 id 与 key 相同）：

| 槽位 | 签名 | 用途 |
|------|------|------|
| `main`（keyed） | `{key: "synova-project-overview"}` / `"synova-dev-workbench"` / `"synova-governance-line"` | 三张中央面板 |
| `sidebar.panellist`（list） | `{id: 同上, order: 50/51/52, label: "项目总览"/"开发工作台"/"治理线"}` | 左侧栏三个入口图标（收 owner props `{size, active}`） |

> **slot 名出处（不猜，给 file:line）**：编译目录 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` —
> `main` 见该文件 **:1730**（source `packages/client/ui-layout/src/client/index.ts:66`）；
> `sidebar.panellist` 见该文件 **:2989**（source `packages/client/ui-sidebar/src/client/contract/slots.ts:34`）。

**注册降级显式（Done ⑤）**：三对注册逐个包 `try/catch`。任一 `main` cell 注册失败（slot 不存在 / 版本不足）
→ `console.error` 留痕 + 该入口图标改显 **⚠**（title 说明原因）—— 不静默消失、不"点了没反应"。
失败清单另挂在 `exports.__synovaRegistrationDegraded` 供诊断。

样式注入会在每次 `apply` 前移除本插件此前注入的所有 `<style>` 再插当前一份 —— 保证 HMR 后
不残留旧规则。旧版按固定 key 判重会拒绝重注入（改过 CSS 仍跑旧样式）。

> ⚠ **jsx 签名坑（D1060 真机取证）**：`react/jsx-runtime` 的签名是 `jsx(type, props, key)` ——
> 第 3 个参数是 **key 不是 children**。曾写成 `jsx("span", {…}, "📊")`，字形被当成 key 丢掉，
> 三个入口图标**恒为空 span**（真机 DOM：`<span title="项目总览"></span>`）。children 一律写进 props。

> **官方全局面板协议**（依据 `@deepseek-ai/dsh-client-ui-sidebar` README §全局面板入口）：
> `sidebar.panellist` 的**同一个 id** 寻址 root 作用域 `main` keyed slot 的组件；
> **选择未注册的 main key 会抛错并保留当前选中态** ⇒ 必须先注册 `main`，再注册入口行。
> 该插槽已由官方 sidebar（非第三方替换侧栏）声明，故任意环境下都在场；无注册项时整块不渲染。

面板六区块见文首表格；头部有**取数来源标记**（`源 worktree` / `源 origin/main`，验收用）。
**四态降级均显式呈现、不白屏不抛错**（铁律 24/31）：

1. 网络/HTTP 失败 → 硬降级横幅
2. 路由级 `ok:false` → 降级横幅（工作区与 `origin/main` 都无账本时的正常态）
3. 账本级 `degraded:true` → 部分降级警告 + `degraded_sources`
4. 健康路由失败 / `health.ok===false` → **仅健康区**显示降级文案（其余区块照常）

账本与健康是两条独立请求，任一失败不影响另一块（`Promise.allSettled`）。
「返回会话」走 `ctx.layout.selectPanel(null)`。

## 安装

```bash
bash dsh/plugins/synova-dashboards/scripts/install-dashboards.sh
# 目标 profile：--profile-dir <dir> > $DSH_PROFILE_DIR > $DSH_HOME/profiles/web（默认）
#   · 命令行 dsh web      → 默认 ~/.dsh/profiles/web
#   · 桌面端（Electron）   → $DSH_PROFILE_DIR（本机实测 ~/.dsh-trial-017/profiles/desktop）
# 生效：
#   1) 重启守护进程：bash dsh/plugins/synova-dashboards/scripts/restart-dsh-web.sh
#      （该脚本 kill 占用 3080 的进程 —— 若你在某个 session 里，请从会话外执行）
#   2) 刷新页面 → 左侧栏出现「项目总览 / 开发工作台 / 治理线」三个入口
```

安装脚本**幂等**（可重复执行，第二次为 no-op），只写 profile 目录，仓库零写入。四步：
① 复制包到 `<profile>/node_modules/@synova/dsh-dashboards`（bundle 名解析锚点）；
② 把副本 `cordis.patch.yml` 的 `repoRoot` 改写成本机实际仓库根；
③ profile `package.json`：`dependencies` + `dsh.profile.bundles`；
④ 删除 synova-cto 预设里的旧 loader 块（避免与 bundle 层重复挂载）。脚本尾部打印回滚步骤，
并已备份 profile `package.json` 到 `package.json.synova-bak`。

> 注：DSH 的 client 模块扫描在进程启动时缓存包元数据。**实测（2026-09-29，桌面端）**：
> 已装包的内容变更 → `Page.reload(ignoreCache)` 即生效；**新增包**仍需重启守护进程。
> 用 `dsh --profile <p> --dump-config` 可重启前先验证合成树。

## 验证

```bash
cd dsh/plugins/synova-dashboards && npm test
# 81 条：账本三级取数 / Host 四条路由 / 项目总览渲染 / 拖动缩放记忆 / 折叠记忆 / 裁切修复
#        + D1060：四问格子（四色·空格不折算成绿·未知态单列）/ 待你裁 / 阻塞三要素口径 /
#                  治理线信号与「服务哪条主线」/ PR API 与快照回退 / 注册降级 ⚠ / 图标 children 回归 / 零写入

# 合成树（不启动服务即可证明 bundle 层挂载）
dsh --profile <profile> --dump-config | grep -A5 "@synova/dsh-dashboards"

# 运行中进程验证四条路由
curl -s http://127.0.0.1:3080/synova/pm/ledger | head -c 200
curl -s http://127.0.0.1:3080/synova/dashboards/data | head -c 300
curl -s http://127.0.0.1:3080/synova/workbench/data | head -c 300
curl -s http://127.0.0.1:3080/synova/governance/data | head -c 300
```

## 卸载 / 回滚

```bash
cp <profile>/package.json.synova-bak <profile>/package.json
rm -rf <profile>/node_modules/@synova/dsh-dashboards
# 重启 dsh web / 桌面端
```

## 已知限制

- 安装/升级后**新增包**需重启守护进程；已装包改内容刷新页面即可（2026-09-29 桌面端实测）。
- **`origin/main` 回退要真正生效，前提是 `docs/synova/project/ledger.json` 已提交进 main**。
  该文件目前只存在于工作区（D795 尚未把产物提交进 main）→ 此时工作区文件一旦消失
  （改名/切换分支）仍会走第 3 级显式降级。D795 提交后回退即自动可用（代码路径已由测试覆盖）。
- 本模块不执行 `git fetch`：`origin/main` ref 若陈旧，回退到的就是陈旧账本。
- 三张面板均为**只读视图**：不写工作区/仓库/账本；localStorage 只存几何/折叠偏好（项目总览 `synova.pm.*`、工作台 `synova.wb.*`、治理线 `synova.gov.*`）。
- 数据为轮询快照（60s），非推送流。
- 执行看板取 `ledger.tasks`（D795 由 `task-state/*.json` 派生），不再独立扫 task-state —— 单一真相源，避免两套口径。
- D1060 面板 B 的「欠账/待规划」只消费 `board-backlog.json`（PLAN-*）；
  `product-lines/todos.yaml`（T-*）**未消费**（插件零依赖，不引 YAML 解析器），面板上已写明原因。
- D1060 面板 A 的 PR 取数依赖 `~/.dsh/.credentials.yaml` 的 `GITHUB_TOKEN`；
  无 token / 断网 → 回退仓库内 `pr-queue.json` 快照并**显式标注**（且不伪造今日/本周已合数）。
- 重新安装 DSH CLI（npm -g）不影响本插件（装在 profile 层）；profile 目录被删除重建时重跑安装脚本。
