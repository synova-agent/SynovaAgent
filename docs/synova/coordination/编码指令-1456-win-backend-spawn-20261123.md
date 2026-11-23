# 编码指令 / DEV DOC — #1456 Windows dev 模式 Electron 自启后端

> 版本 v1（冻结）｜ 撰者 CTO ｜ 2026-11-23 ｜ base `caf61fcdeb3e00c79abe9211546690ca963549a2`（Gitea main）｜
> 分支 `fix/1456-win-backend-spawn` ｜ worktree `.synova-wt-1456`
> 读者＝**零上下文单任务 coding session**。只凭本件＋仓库即可执行；不得自行改方向。

---

## §1 模块锚

- **模块名称**：Windows dev 模式 Electron 自启 Synova 后端（`electron/backend-spawn.cjs` 的 dev 命令解析）
- **服务的真实客户／用户动作**：要演示、要验收、要联调的**人**在 Windows 上打开桌面端（`electron electron/main.cjs`，dev 模式），窗口起来就能用后端——而不是先手工另起一个隔离 server。
- **本模块完成后用户能做什么**：在 Windows dev 模式下启动桌面 → 后端由 Electron 自己拉起（`/api/healthz` 200）→ 关窗/退出后后端进程被回收，**不留孤儿进程**。
- **与首个客户闭环／部署的关系**：桌面端是客户唯一入口（宪章 §1 ⑤ 导航层的落地载体）。dev 自启坏掉 ⇒ 每次桌面端到端验收都要人工起 server，等于**桌面链路的"开窗即用"从未在 Windows 上被真实证明**；#1455 的 Done 8(a)（Electron 自起后端 → `before-quit` → `backendHandle.stop`）正因此长期 UNVERIFIED。
- **必须遵守的长期产品边界**：不动 Electron 结构／UI／renderer；不动 DSH（内核、版本、适配边界）；不引入联网安装（禁 `npx` 远程取包）；不动门禁与 `scripts/ci/**`。
- **本模块明确不做**：prod 打包路径（`dist/backend.mjs`，D518 已验）；Sidecar supervisor／DSH 启停；桌面 UI 改造；#1434 的隔离环境验收／备份恢复／锁版；POSIX dev 命令改写。
- **验收入口与可观察结果**：入口 = Windows 上从本 worktree 跑 `electron electron/main.cjs`（`app.isPackaged=false`）。
  可观察 = ①主进程 console 出现 `[electron] boot mode=dev` 且**无** `后端自启 degraded`；②`GET http://127.0.0.1:18790/api/healthz` → 200；③后端子进程 PID 存在且其父为 Electron；④退出 Electron 后该 PID 与全部 node/tsx 子进程消失。
- **尚未确认的产品问题**：GA 客户机是否保证 dev 依赖链（本票只承诺开发机；prod 另有路径）。

---

## §2 现状证据（真实入口／调用链／已验证问题／可复用资产）

### 2.1 真实调用链（代码事实，`caf61fcde`）

```
npm run electron:dev  →  electron electron/main.cjs
                          └ app.whenReady() → ensureBackend({mode:'dev', cwd:process.cwd(), serverUrl:'http://localhost:18790'})
                              └ buildCommand('dev') → { bin:'npx', args:['tsx','src/index.ts'] }   ← 缺陷点
                                  └ spawn(bin,args,{shell:false}) → ENOENT（Windows）
```

- `electron/main.cjs:25` `SERVER_URL = 'http://localhost:18790'`；`:252` 调用 `ensureBackend`；`:318` `app.on('before-quit')` → `backendHandle.stop()`。
- `electron/backend-spawn.cjs:68-72` `buildCommand(mode)`：prod → `{bin:process.execPath, args:['dist/backend.mjs']}`；**dev → `{bin:'npx', args:['tsx','src/index.ts']}`**。
- `electron/backend-spawn.cjs:188-195` `spawn(cmd.bin, cmd.args, {shell:false, ...})`。
- `electron/backend-spawn.cjs:197-200` 只登记 `error` 事件到 `lastError`，**不中断探活循环** ⇒ 失败要空转到 60s×(maxRestarts+1) 才 degraded。
- `electron/backend-spawn.cjs:172` `ELECTRON_RUN_AS_NODE='1'` **只在 prod 分支设置**。

### 2.2 已实测的真实断点（本 CTO 会话原始复现，零模型、零外网）

复现脚本 `.tmp-1456-repro/repro.cjs`（原始输出 `.tmp-1456-repro/repro.out.json`），环境 `node v24.16.0 / win32 / Electron 33（node v20.18.3）`：

| 形态 | 结果 |
|---|---|
| A `spawn('npx', ['tsx', file], {shell:false})` | **`ENOENT`（spawn npx ENOENT）** ← 现状 dev 命令 |
| B `spawn('npx.cmd', ['tsx', file], {shell:false})` | **同步抛 `EINVAL`（spawn EINVAL）**，连 `error` 事件都到不了 |
| C `spawn(node.exe, ['<nm>/tsx/dist/cli.mjs', file])` | **exit 0**，`TINY_OK v24.16.0 win32` |
| D `spawn(electron.exe, ['<nm>/tsx/dist/cli.mjs', file], {env:{ELECTRON_RUN_AS_NODE:'1'}})` | **exit 0**，`TINY_OK v20.18.3 win32` |
| E `spawn(electron.exe, [同上])` **不设** `ELECTRON_RUN_AS_NODE` | 也 exit 0（**不可依赖**：不得据此省掉显式 env） |

**结论**：Windows 上唯一稳的 shell-free 形态＝**真实 JS 入口文件 + 真 executable**；`.cmd` shim 一律不可用。

### 2.3 可复用资产

- 本地 `tsx` 5.x→**4.23.13** 实物：`node_modules/tsx/package.json` `bin = "./dist/cli.mjs"`（devDependency 固定版本）。
- 已有测试 `tests/electron/backend-spawn.test.ts`（548 行，含 reused/started/降级/ENOENT 不抛/env 契约/teardown/日志 共 17 例），其中 **L276 `dev 模式默认命令 = npx tsx src/index.ts`** 把缺陷行为写成了断言 ⇒ **本票必须改写该例**（这就是"明确不保留的旧行为"）。
- `ensureBackend` 已支持 `command` 注入与 `graceMs` 注入 ⇒ 单测无需真实网络与真实模型。
- 桌面夹具（#1455 真实链用过）：`D:\novis-backup-20260526\Novis\.synova-wt-1455-r3-chain\node_modules`（含 `electron` + `tsx`）。**只读复用，禁止修改。**

---

## §3 目标行为（入口 → 操作 → 结果）

1. **Windows dev 正常路径**：`electron electron/main.cjs` → `buildCommand('dev')` 返回
   `{ bin: process.execPath, args: [<resolved tsx cli.mjs>, 'src/index.ts'], env: { ELECTRON_RUN_AS_NODE: '1' } }`
   → spawn 成功 → 探活转健康 → `{started:true, pid, stop}` → 主进程 console **无** degraded 行 → 窗口连上后端。
2. **POSIX dev 路径不变**：仍是 `{bin:'npx', args:['tsx','src/index.ts']}`（Mac 上已验的路径不动，避免回归）。
3. **启动失败可见（快失败）**：spawn 同步抛错或收到 `error` 事件（ENOENT/EINVAL/其他）⇒ **立即**返回
   `{started:false, degraded:true, error:'<原 code> + 可操作提示'}`，**不得**继续空转探活窗口；
   `console.error` 必须打出 `[backend-spawn] spawn 失败: <code> <message>`。
4. **tsx 缺失可见**：Windows dev 下找不到本地 `tsx/dist/cli.mjs` ⇒ 显式 degraded，
   `error` 含可操作提示（"先在仓根执行 npm ci / 或确认 node_modules/tsx 存在"）；
   **禁止**回退到 `npx`（那正是本 bug）；**禁止**任何联网取包。
5. **退出回收**：`started:true` 时返回的 `stop()` 在 `before-quit` 被调用后，后端进程树消失（复用现有 `makeStop`/`taskkill` 语义，不重写）。
6. **不允许出现的假象**：`reused:true` 冒充"自启成功"（那是复用他人 server，不是本票能力）；`degraded:true` 却打印成功；把 probe 失败当 spawn 失败；测试只断言"函数被调用"而不断言 argv/env。

---

## §4 范围与边界（写集）

**允许改（写集，超出一律停报）**

| 文件 | 允许的改动 |
|---|---|
| `electron/backend-spawn.cjs` | `buildCommand` 增加平台/本地 CLI 解析；`ensureBackend` 合并 `command.env`、spawn 失败快失败；文件头 JSDoc 契约同步 |
| `tests/electron/backend-spawn.test.ts` | 改写 L276 的 dev 命令断言；新增 §7 用例 |
| `.claude/claims/1456.yaml` | 本票 claim／写集／done 记录 |
| `docs/synova/product-lines/evidence/1456-dev-self-start/**` | 证据（**新增**；脚本只能是 `.mjs`／`.ps1`／`.txt`／`.json`／`.png`） |

**禁止**
- 改 `electron/main.cjs`、`electron-renderer/**`、UI；改 prod 分支行为；改 DSH 与 `scripts/dsh-sidecar/**`
- 改 `scripts/ci/**`、`.gitea/**`、任何门禁脚本或阈值
- **新增 `scripts/**/*.ts` 文件**（CI `core-tests.sh` 会把 `scripts/*.ts` 归为 source_change，若无受影响测试即 `affected-no-tests` 判红——#1457 已踩过；证据脚本一律 `.mjs`）
- `npm install`／联网取包／跑真实模型／碰真实客户数据或生产 DB／写主树
- 提交 `node_modules` 或 junction 链接

**依赖与冲突**：与 #1457（`feat/1455-r3-chain`）写集零重叠（见其 claim）；与 #1434 线用不同 worktree/分支。

---

## §5 关键契约

```js
// buildCommand(mode, ctx?) → { bin: string, args: string[], env?: Record<string,string>, error?: string }
//   mode: 'prod' | 'dev'
//   ctx.cwd?: string           // dev 下用于解析本地 node_modules/tsx（缺省 process.cwd()）
//   ctx.platform?: string      // 仅测试注入（缺省 process.platform）
//   ctx.exists?: (p)=>boolean  // 仅测试注入（缺省 fs.existsSync）
//   win32 + dev: bin = <解析到的 node 可执行文件>   ← v2 修正：不是 process.execPath
//                解析顺序：npm_node_execpath → process.execPath（basename 为 node/node.exe）
//                         → 'node'；全不可用 ⇒ { bin:'', args:[], error:'<可操作提示>' }
//                args = [<abs tsx/dist/cli.mjs>, 'src/index.ts']；env 不含 ELECTRON_RUN_AS_NODE
//   prod: { bin: process.execPath, args:['dist/backend.mjs'], env:{ELECTRON_RUN_AS_NODE:'1'} }（逐字不变）
//   POSIX + dev: { bin:'npx', args:['tsx','src/index.ts'] }（逐字不变）
```
> **v2 修正依据（硬证据）**：dev 的 `node_modules` 原生模块是**系统 Node ABI**（NODE_MODULE_VERSION 137），Electron 33 要 130；
> 打包配置 `build-synova.cjs:69-73,170-172` 只在打包前 rebuild 成 Electron ABI。控制实验：同一 argv 下
> `electron.exe + ELECTRON_RUN_AS_NODE=1` ⇒ `better-sqlite3` `ERR_DLOPEN_FAILED`；系统 `node.exe` ⇒ `/api/healthz` **200**。

- `ensureBackend` 合并顺序：`{...process.env}` ← prod 注入 ← `cmd.env`（**cmd.env 最后生效**）。
- spawn 失败路径：同步 throw 被 `try/catch` 捕获 → 不再 `spawnOnce` 循环；`error` 事件 → 立即置 fail 标记并跳出探活循环。两种都返回 `degraded:true` 且 `error` 保留原始 `err.code`。
- `stop()` 语义不变（幂等、SIGTERM→graceMs→SIGKILL；Win 走 `taskkill /T /F`）。
- 探活语义不变：`probeOnce` 只看 `GET /api/healthz` 的 200。

---

## §6 单任务拆分（本 session 只做这一个任务）

**任务 T1：修好 Windows dev 自启并自证**

- 目标：§3 的 1/3/4/5 全部成立，且 §7 全绿。
- 前置依赖：worktree `.synova-wt-1456`（已建，分支 `fix/1456-win-backend-spawn`，base `caf61fcde`）；
  `node_modules` 用**只读夹具 junction**：
  `cmd /c mklink /J .synova-wt-1456\node_modules D:\novis-backup-20260526\Novis\.synova-wt-1455-r3-chain\node_modules`
  （不提交、不进写集；若 junction 不可用则停报，不要 npm install 造新依赖树）。
- 验收：§7。
- 失败回退：改回 `caf61fcde` 的 `electron/backend-spawn.cjs` 即恢复原状（本票不动其他文件，无数据迁移）。
- 停点（必须退回 CTO）：需要改 `main.cjs` 才能验证；需要改门禁/CI；需要联网装包；需要真实模型；夹具 junction 不可用；发现 dev 路径还有第二处 Windows 缺陷。

---

## §7 验收与反例（每条都要贴原始输出）

**A. 单测（真实断言，非空壳）** —— 命令：`node node_modules/vitest/vitest.mjs run tests/electron/backend-spawn.test.ts`
1. `buildCommand('dev')` 在 win32 返回 `bin` = **解析到的 node 可执行文件**（`path.basename(bin)` 命中 `node(.exe)?`；**不是** `process.execPath` 的 electron.exe）、`args[0]` 指向**存在的** `tsx/dist/cli.mjs`、`env` **不含** `ELECTRON_RUN_AS_NODE`；`args` **不含** `npx`／`.cmd`。（v2 修正）
2. 强行让 CLI 解析失败（注入不可达 cwd／模拟查询）⇒ 返回 `error` 且 `ensureBackend` 得 `degraded:true`，`error` 文案含可操作提示；**断言未发生 spawn**。
3. spawn 同步抛 EINVAL 的形态（注入 `command` 或桩）⇒ `ensureBackend` **不抛**、立即 `degraded:true`、`error` 含 `EINVAL`，且**不再进入 60s 探活**（用注入的短窗口断言耗时 < 1s）。
4. `error` 事件（ENOENT 注入）⇒ 同上快失败语义。
5. `started:true` 后 `stop()` 仍回收进程树（沿用既有物理断言用例，必须仍绿）。
6. 既有 17 例中：被改写的 L276 按 v2 契约更新；**Windows 存量红 1 例**（`sleep 60` 用例，Windows 无此二进制）按 **D584 同组先例**加 `it.skipIf(process.platform==='win32')`（**仅 1 行，必须在 PR 正文与 claim 记为"存量红修复，非本票引入"，并附 base 同点位同红证据**）；其余全部保持绿。

**B. 反例（证明"改坏会红"）**：把 `buildCommand` 临时改回 `{bin:'npx'}` 跑 A.1 ⇒ 必红；改完恢复。
（原始输出贴证据目录 `NEGATIVE-*`）

**C. 桌面单点验证 = #1455 Done 8(a)**（零模型轮次、零外网，只用夹具）
- 前置（v2 补，缺任一条则拿不到 200，不得判 UNVERIFIED 了事）：
  ① `DEV_MODE=true`（否则 `deploy/bootstrap` 以 `MASTER_SECRET_MISSING` fail-closed 终止，属正确行为）；
  ② **清掉继承来的 `ELECTRON_RUN_AS_NODE`**（否则 `electron.exe` 退化成纯 node，`app` undefined 直接崩）；
  ③ `SYNOVA_DB_PATH` 指向临时隔离目录；④ `SYNOVA_ORG_ID` 固定值（与扫描 graph 对齐时用）。
- 命令（在 `.synova-wt-1456`，先建好 node_modules junction）：
  `node node_modules/electron/dist/electron.exe electron/main.cjs --remote-debugging-port=9222`
- 必须留证：
  1. 主进程 console 原文（含 `[electron] boot mode=dev`，**不含** `后端自启 degraded`／`spawn 失败`）
  2. `GET http://127.0.0.1:18790/api/healthz` 原始响应（200 + body）
  3. 后端 PID：Electron 启动前 18790 owner（应为空/非本链）、启动后 owner PID、且**后端进程链回到 Electron**（实测 tsx CLI 会再 exec 一层 node，故监听 18790 的那个是 Electron 的**孙进程**；Electron 的直接子进程是 tsx CLI 层）
  4. 退出：经 CDP `Browser.close` 或 `taskkill /PID <electron>` 正常退出 → 后端 PID 消失，`netstat` 18790 无监听，无 `tsx|node .*src/index.ts` 残留
- **判据**：8(a) 只在"自启成功 + 退出后回收"两段都成立时才算 PASS；`reused:true` 一律记 UNVERIFIED（复用不是自启）。

**D. 防假绿**：确认 18790 上**没有 LISTENING**（启动前 `netstat -ano | findstr 18790` **不得有 LISTENING 行**；健康探活留下的 `TIME_WAIT` 客户端行属预期残留，不算占用），否则 `reused:true` 会伪装成自启成功。

---

## §8 未决项与变更规则

- 未决：Mac 上 `npx` 路径是否也该改成直跑 CLI（本票**不动**；需要时另票）。
- 未决：`electron/main.cjs` dev 下的 `cwd` 是否应从 `process.cwd()` 改为 `app.getAppPath()`（本票只在**不改 main.cjs** 的前提下做解析兜底：`cwd` 与 `__dirname/..` 都试）。
- 变更规则：方向变化先改本 DEV DOC 再继续；技术事实变化可修正实现但必须留原始证据；**验收者不得在交付时临时增加本件没有的目标**。
- 完成后不变式：本票**不**主张"#1455 Done 8(a) 全链已过"以外的任何产品结论；不把 8(a) 单点 = 桌面端到端验收全部通过。

---

## 交付回执（coding 按六字段返回）

实际改动｜真实入口验证｜测试与失败路径结果｜与 DEV DOC 的偏差｜未验证项｜需要 CTO 裁定的问题
