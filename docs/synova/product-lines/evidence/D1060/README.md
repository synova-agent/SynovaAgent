# D1060 证据 · D963 升级「Synova 开发工作台」双面板

> 任务号 **D1060**（现场 alloc 取号，非臆写）：`bash scripts/control-tower/alloc-task-id.sh "D963升级-Synova开发工作台-双面板" --prefix d1060-`
> → `D1060` + `task-state/D1060.json` + 本卡 brief 骨架。
> 分支：`feat/D1060-synova-workbench`（worktree `.synova-wt-d1060`）
> 目标 profile：桌面端 `$DSH_PROFILE_DIR` = `~/.dsh-trial-017/profiles/desktop`（Electron，PID 实测）
> 验证方式：**真机**（CDP 9222 驱动桌面前端）＋ 81 条自动化测试。

---

## 〇、开工前现场复核（禁臆写：派单前提与实际状态的差异）

| 派单声称 | 现场实测 | 处置 |
|---|---|---|
| 「四问格子已升 64 格（PR #880）」 | `refs/pull/880/head` = `5a937c61`（**未合并**）；main 上仍是 48 格 / `filled:0` | 本分支以 **merge 提交并入 PR #880 前置**（保留出处），否则「16 行 × 4 问」无数据源 |
| 「侧边栏现有『宪章三问 48 格』= D963」 | D963 的 Client/Host 半**只在未合分支** `feat/d963-charter-grid-panel`；该分支相对 main 是 **766 文件反向 diff**（基线过旧）→ 无法干净合并 | 在 main 上新写两面板；旧分支仅作参考，不复活 |
| 「面板落在 dsh/plugins/synova-dashboards」 | ✅ 存在（D794 落，31 测试） | 复用骨架 |
| （未提）桌面端当前安装态 | profile 装的是 **`/tmp/d963-plugin-degraded`**（`repoRoot: /tmp/d963-nosource`）→ 创始人当时看到的是**降级态**麪板 | 本次改为指向交付件并复验 |

`git merge-base --is-ancestor 176f8258 main` → **NO**；`git branch -a --contains 176f8258` → 仅 `feat/d963-charter-grid-four-questions`。

---

## 一、Done ① 加了吗 — panel + slot 注册项存在

**slot 名出处（实读 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`，不猜）**：

| slot | catalog 行 | 官方 source 行 | kind / scope |
|---|---|---|---|
| `main` | `slot-catalog.ts:1730` | `packages/client/ui-layout/src/client/index.ts:66` | keyed / root |
| `sidebar.panellist` | `slot-catalog.ts:2989` | `packages/client/ui-sidebar/src/client/contract/slots.ts:34` | list / root |

> `sidebar`（:2809）明确「注册在这里会**替换**整个导航列」⇒ 只注册到其内部座位 `sidebar.panellist`。
> 原始取证见 `07-slot出处-原始输出.txt`。

**注册项（`dsh/plugins/synova-dashboards/lib/client.js`，`PANEL_ENTRIES` + `apply()` 成对注册循环）**：

| 入口 | `sidebar.panellist` id | `main` key | order | label |
|---|---|---|---|---|
| 项目总览 | `synova-project-overview` | 同名 | 50 | 项目总览 |
| **开发工作台** | `synova-dev-workbench` | 同名 | 51 | 开发工作台 |
| **治理线** | `synova-governance-line` | 同名 | 52 | 治理线 |

**Host 路由（`lib/index.js`）**：`GET /synova/workbench/data`、`GET /synova/governance/data`（只读，200 + JSON）。

**面板文件路径**：
- `dsh/plugins/synova-dashboards/lib/repofile.js`（二级取数）
- `dsh/plugins/synova-dashboards/lib/flow.js`（git log + PR API）
- `dsh/plugins/synova-dashboards/lib/workbench.js`（面板 A 四区块）
- `dsh/plugins/synova-dashboards/lib/governance.js`（面板 B）
- `dsh/plugins/synova-dashboards/lib/index.js`（Host 四条路由）
- `dsh/plugins/synova-dashboards/lib/client.js`（三对槽位 + 两张面板）

## 二、Done ② 接上了吗 — 注册被宿主消费

真机 DOM（CDP `Runtime.evaluate`，桌面端 `dsh-app://app/`）：

```
icons: ["插件", "📊项目总览", "🧰开发工作台", "⚖️治理线"]
```

宿主消费点：官方 sidebar 渲染 `sidebar.panellist` → 每行 `<div data-slot="sidebar.panellist">`；
点击后 layout 按**同 id** 派发到 `main` keyed cell：

```
after: {"roots":1,"titles":["Synova 开发工作台"],"rows":16,"cells":64}
after: {"roots":1,"titles":["治理线"],"rows":0,"cells":0}   ← 治理线无格子（物理分离）
```

## 三、Done ③ 生效了吗 — 桌面端真看到矩阵（截图 + 时间戳）

| 截图 | 内容 | 时间戳 |
|---|---|---|
| `01-面板A-开发工作台-16x4矩阵.png` | 左侧栏三入口 + 面板 A ① 四问格子矩阵（16 行 × 4 问，全 ⚪未填）+ ② 今日/本周流水 | 2026-09-29 01:19–01:27 CST |
| `02-面板A-待你裁与阻塞.png` | ② PR 段（GitHub API 实时）+ ③ 待你裁 + ④ 阻塞 | 同上 |
| `03-面板B-治理线.png` | 面板 B 治理卡列表 + 欠账/待规划（与格子分离） | 同上 |

矩阵实测：`rows=16, cells=64, empty=64`；表头四问 = 加了吗 / 接上了吗 / 生效了吗 / **删了吗**；
空格文案 `⚪ 未填` + `待办 · 未填判据`（**未伪装成绿**，院方 X27）。

## 四、Done ④ 改坏即红 — 删 slot 注册 → 入口消失

原始输出 `04-改坏即红-原始输出.txt`；截图 `04-改坏即红-侧栏无开发工作台.png`。

```
动作：从已安装的 lib/client.js 删除 PANEL_ENTRIES 里开发工作台那一行（slot 注册项）
删除后 WB_PANEL_ID 残留引用数（grep -c）：2
CDP Page.reload(ignoreCache) 后，侧栏实际条目：
  {"sidebarRows":["项目总览","治理线"],"panelRoots":0,"gridTables":0}
点击「开发工作台」的返回：
  "NOT FOUND（改坏即红：入口消失）"
恢复该行 → reload → {"sidebarRows":["项目总览","开发工作台","治理线"]}
```

## 五、Done ⑤ 降级显式 — 不静默（三条路径）

1. **数据源缺失（真缺失，非模拟）**：把 `task-state/` 移走后同路由取数 → 200 + 显式降级；
   面板横幅实测文案 `部分数据源降级：治理卡：task-state 目录不存在`，且欠账表区照常（两源独立）。
   原始输出 `05-降级显式-原始输出.txt`；截图 `05-降级显式-治理线降级横幅.png`。移回后立即复常。
2. **路由级失败 / 未装 / 版本不足**：客户端 `fetch` 失败 → 整面板降级横幅（不白屏、不抛错）。
3. **slot 不存在 / main 注册失败**：注册逐个 `try/catch` → `console.error` 留痕 + 该入口图标改显 **⚠**
   （title 说明「降级：main 面板未注册」），不静默消失、不"点了没反应"；
   清单另挂 `exports.__synovaRegistrationDegraded`。测试：`D1060 降级显式①/②`（2 条）。
4. **PR 取数三级**：API → 仓库快照（显式标注「快照 + 生成时间」，**不伪造今日/本周已合数**）→ 显式 degraded。
5. **仓库文件二级**：工作区 → `origin/main`（`lib/repofile.js` 收敛一处）→ 显式 degraded（带逐级原因）。

## 五之二、独立复核（子代理零上下文）与修复

提交后跑了一轮**独立验证**（只读；8 项声称逐条核 + 未声称问题扫描）。结果：**7 项 TRUE、1 项 FALSE**，
另发现 8 项未声称问题。原始记录：`08-独立验证与修复-原始记录.txt`。

**FALSE 项（口径声明与实际不符）**：声称「三要素齐全才计入阻塞」，但门槛只施加于卡面 `blocked` 对象，
`ledger#blocked` 与 `product-progress#lines[].blocked` **无条件计入**；而面板文案宣称「缺一不计入」。
反例：`ledger.blocked=[{id:'B-EMPTY'}]` → `count:1, reason:"(无原因)"`。

**处置：全部修复并逐条加回归测试**（`test/workbench.test.js` 回归 CE1/CE3/CE4/CE5/CE6/CE7 + finding a/b/d/e/h，
`test/flow.test.js` 回归 finding 5/f）：

| # | 问题 | 修法 |
|---|---|---|
| FALSE | 三要素门槛只覆盖一个入参 | 门槛**统一施加于三个入参**；缺要素 → 单列「上源三要素不全」并标注来源，不计入 |
| a | ledger 不可读但 progress 可读 → 面板展示残缺列表且 `degraded_sources` 为空 | 块级 `degraded` 也入 `degraded_sources`；区块内再加 `spo-warn` 行 |
| b | 任务卡坏 JSON 从不进面板 A payload | 新增 `task_cards{ok,count,error_count,errors}`，坏卡入 `degraded_sources` |
| c | 引用不存在的 `flow.degraded_sources`；丢 git/pr 各自原因 | 逐条拼 git/pr/快照回退原因 |
| d | 非对象格元素被算成「已填」 | 单列 `derived.malformed`，不再进 filled |
| e | `EMPTY_STATUSES` 死导出 | 改为 `normalizeStatus` 直接消费 + 回归测试断言被生产代码引用 |
| f | 凭据文件绝对路径随 200 响应出网 | `credential_source` 只回 `"file"`；回归断言响应体不含凭据目录 |
| g | 标题硬编码「16 行 × 4 问」 | 行/问数取自 `derived`（真机复验：由数据渲染为「16 行 × 4 问」） |
| h | `{"cells":[]}` → 合法空矩阵 | 0 行视为**结构异常** → degraded |
| 5残 | 自定义 fetch 把 Authorization 塞进 error 时原样透传 | 新增 `redact()`，错误串里 token → `***`；回归实测不可复现 |
| CE4 | 卡面三要素齐全 + ledger 不可读 → 真实阻塞静默消失 | ledger 不可读时从卡面**直取补位**（标 source），ledger 可用时不重复计 |
| CE5 | 卡面 `blocked: true/42/[]` 静默丢弃 | 单列「类型非法（boolean/number/array）」 |
| CE6 | 两条无 id 同 reason 的阻塞被误合 | 去重键含 `since`/`needs` |
| CE7 | 上源混入字符串/null/数字被静默跳过 | 单列「非对象条目」，计入 `derived.malformed_upstream` |

> 独立复核另指出：安装副本 `cordis.patch.yml` 的 `repoRoot` 指向本任务 worktree，
> 主工作区 `/Users/wane/SynovaAgent` 的格子文件仍是 48 格/3 问 —— 故把标题里的行列数改为**取自数据**（修 g）；
> 本 PR 合入 main 后主工作区即为 64 格/4 问。
> **线上 Host 半的时点差异**：Host 半在进程启动时载入，本轮修复后**未重启桌面端**（重启会打断创始人当前会话），
> 故线上路由仍跑修复前一版；修复后的 Host 代码已用「真仓库根 + 假 webServer」在进程内端到端复跑
> （`grid 16×4 / flow PR api / task_cards 378 张 0 坏卡 / leak_token=false`），并另有 94 条自动化测试覆盖。

## 六、Done ⑥ 死声明已核/修（dsh-client-runtime 注入）

实测：锚定版（`/Users/wane/src/deepseek-harness-017/packages/client/`）包清单中
**不存在 `@deepseek-ai/dsh-client-runtime`**（实际为 `dsh-client-connection` / `-resources` / `-ui-layout` … …）。

修复：`package.json` `dsh.client.inject` 由 `["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-layout"]`
→ `["@deepseek-ai/dsh-client-ui-layout"]`。client 半本身只 require 静态种子模块（react / react/jsx-runtime），
服务注入为 `const inject = ["slots", "layout"]`。

## 七、顺带修的两个真机缺陷（同文件，非扩范围）

1. **入口图标恒为空 span**：`react/jsx-runtime` 签名是 `jsx(type, props, key)` —— 第 3 个参数是
   **key 不是 children**。原写法 `jsx("span", {…}, "📊")` 把字形当 key 丢掉。
   真机 DOM 取证（修复前）：`<span title="项目总览"></span>`（无文本），三个入口全空。
   修复后真机：`📊项目总览 / 🧰开发工作台 / ⚖️治理线`。回归测试 1 条。
2. **安装脚本只认 web profile**：桌面端用 `$DSH_PROFILE_DIR`；脚本改为
   `--profile-dir` > `$DSH_PROFILE_DIR` > `$DSH_HOME/profiles/web`（默认行为逐字不变）。

## 八、自动化测试

```
npm test → tests 94 | pass 94 | fail 0      （原始输出：06-npm-test-原始输出.txt）
```

新增覆盖（81 → 94 条：含独立复核 13 条回归）：四问格子（四色 / 空格不折算成绿 / 未知态单列 / 坏 JSON / 缺 cells / 空数组 / 畸形元素）、
待你裁（权威源 vs 卡面扫描单列 / 无锚点不编天数）、阻塞（三要素口径 / 未申报单列 / 两源去重）、
治理线（三信号 / 服务主线显式优先-文本抽取-不猜 / 活卡终态分流排序 / 两源独立降级）、
PR（API 正常 / 无 token 回退快照且不伪造合并数 / 两级失败 / HTTP 非 200）、
注册降级 ⚠、图标 children 回归、三面板零写入（只 GET）、
阻塞三要素门槛三入参统一 + 卡面补位 + 类型非法不静默丢 + 去重键含 since/needs、
降级清单覆盖块级 partial（ledger 不可读 / 坏卡 / PR 快照回退）、token 脱敏。

## 九、红线自查

- ❌ 未改 `src/**`（`git diff --name-only origin/main...HEAD | grep '^src/'` 为空）
- ❌ 未改 `scripts/audit/**`、未改 `docs/synova/coordination/ownership.yaml`
- ❌ **未填格**：`docs/synova/coordination/宪章三问-48格.json` 的 64 格内容零改动（仅随 PR #880 前置并入）
- ❌ 未引新依赖（`package.json` `dependencies` 保持空；PR 取数用 Node 内建 `fetch`）
- ✅ 空格显式 ⚪未填（X27），未知态单列，无任何"折算成绿"路径
