# Task Brief: #1464 BS-5 交付打包卫生（Dockerfile 路径 / 版本号同源 / 硬编码路径 / sourcemap）

> 卡号 #1464 | 批次 第1批-补齐 · 模块 K10 平台交付与运行时 | 基线 main `5a6591c4a`
> 判据源: ① 机器判据唯一权威 `docs/synova/coordination/施工项登记.ts` BS-5 `acceptance`
>        ② 卡面正文 = Lead 会话内读得转录 `.synova-out/card-bodies-20261009/1464.md`
> 🔴 GitHub 账号 suspended ⇒ 卡上评论 / PR / push 全线不可用（交付件走 `.synova-out/` 落盘）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
交付/打包面（K10）：Docker 镜像与桌面端的**构建链卫生**。本任务落点在
`Dockerfile`（镜像构建面）、`scripts/desktop/build-backend.sh`（生产后端 bundling）、
新建 `scripts/control-tower/probe-packaging.sh`（判据载体）。
性质 = **扩展**既有构建链，不新增架构层（不涉 L1-L5 分层语义）。
原 Dockerfile 的构建路径 `COPY server/vendor/` 指向仓库内不存在的目录 ⇒ 镜像**构建必失败**。

### b) 文件审计
- `git ls-tree --name-only origin/main | grep -x server` ⇒ ABSENT（无 server/ 目录）
- `git ls-tree --name-only origin/main | grep -x vendor` ⇒ `vendor`（顶层真实存在，25 文件）
- `vendor/` 是运行时真依赖：`src/agent/builtin-tools.ts:11`、`:274`、`:280`、
  `src/mcp/bridge.ts:111`、`src/mcp/skill-installer.ts:50`
- 版本面：`Dockerfile:29`=0.2.0 / `package.json:3`=0.1.0 / `package-lock.json:3`=0.1.0；
  `build-synova.cjs:180` 与 `electron/main.cjs:188` 均为**派生态**（`${version}` / `app.getVersion()`）
- `src` 内 `@synova/*` import 367 处，靠 tsconfig paths 解析（不在 package.json dependencies）
- 复用/扩展/新建/冲突判定：**扩展**（Dockerfile/构建脚本）+ **新建**（probe-packaging.sh）；
  无冲突（不碰 scripts/audit/**、不碰 src/**、不改既有控制塔脚本）

### c) 决策
无覆盖 ⇒ 新建判据探针（登记件指定交付物）；Dockerfile 路径修正 + 版本注入；
构建链自足性（@synova 解析）就地补齐。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **容器构建面**：Dockerfile 的 `COPY` 源不存在属**确定性构建失败**，任何 CI/本地构建都会在
  首阶段断 ── 故「静态断言全部 COPY 源存在」是可离线复跑的强形态判据（本卡 probe A1）。
- **版本单一来源**：OCI `org.opencontainers.image.version` 应由构建参数注入而非手抄
  （否则标签漂移无门禁可察）。真源取 `package.json:version` —— 它是 npm 与
  electron-builder `${version}` 的共同上游。
- **依赖面自洽**：`ARG` 在 Docker 中有**阶段作用域**——需在消费它的阶段内重新声明，
  否则 `LABEL` 展开为空（本卡初稿曾踩，已修）。
- **SIGPIPE（D1214/D1460 同型教训）**：`printf | grep -q` 在 `set -o pipefail` 下会因
  `grep` 提前退出使上游 `printf` 收 SIGPIPE ⇒ **假红**。#1460 刚修过 checker-review.sh
  同型缺陷；本卡 probe 一律用 herestring `<<<` 消除管道竞态。
- **ERE 转义坑**：`grep -E` 中 `\$` 匹配**字面反斜杠+字母**而非字面 `$`（`\<`/`\>` 例外）
  ⇒ 字面 `$` 用 `[$]` 或 glob。本卡 B1 曾因此假红，已改 glob。
- **BASH 变量名边界**：`$VAR` 后紧跟非 ASCII（如全角括号）时解析不可靠 ⇒ 一律写 `${VAR}`。
- **引用纪律**：量真值一律 `git show origin/main:<path>` / 具名 sha，禁手写数字。
- 决策参考系：参考 Anthropic 工程基线（门禁可机器判 / 判据可复跑）+ 第一性原理
  （构建失败 → 先修可达性）⇒ 结论：以「可独立跑红的探针」作交付载体。

## Q2: 范围 — 正确的最简方案
做什么：

写集（本段为 Q2 判据锚；每行一条**裸路径**，无引号无包裹无行内说明 —— 依据
`scripts/workflow/resolve-commit-brief.sh` D1231/#1308 注记：反引号包裹/行内尾随说明/通配符
会使条目「不可匹配」⇒ 该 brief 认领数恒为 0 ⇒ 提交端误报「今日无 task brief」）：

- Dockerfile
- scripts/desktop/build-backend.sh
- scripts/control-tower/probe-packaging.sh
- tests/control-tower/probe-packaging.test.sh
- .claude/claims/1464.yaml
- .claude/task-briefs/2026-10-09-1464-packaging-hygiene.md

逐文件改动说明（说明与锚分离，避免行内尾随文字污染解析）：

- Dockerfile — ① COPY server/vendor/ → COPY vendor/（病灶本体）；② OCI 版本标签改
  ARG APP_VERSION 注入（真源 package.json）；③ CMD 改执行 esbuild bundle（消除
  tsx=devDependency 与 @synova 解析双缺口）；④ 运行阶段 npm ci --omit=dev 去掉
  --ignore-scripts（原生模块需 install 脚本）；⑤ 不 COPY synova.json（防宿主配置覆盖
  compose 的 PORT=3000）
- scripts/desktop/build-backend.sh — 自备 node_modules/@synova/* 解析链接（此前隐含依赖
  dev 仓已存在；干净 checkout / 容器 builder 阶段会断链）
- scripts/control-tower/probe-packaging.sh — 新建（登记件 acceptance 判据载体，18 断言）
- tests/control-tower/probe-packaging.test.sh — 新建（U7/CT-40 硬门禁要求：控制塔脚本配对测试）
- .claude/claims/1464.yaml — 写集声明（D708 S0 源）
- memory/notes/proposed/2026-10-09-packaging-hygiene-probe-and-version-single-source.md

不做什么（含文件路径）：
- 不改 `package.json`（版本真源保持 0.1.0；构建链已能自足，无需新增依赖）
- 不改 `package-lock.json`
- 不改 `scripts/audit/**`（红线）
- 不改任何**既有**脚本（治理线窗：只新建 `scripts/control-tower/probe-packaging.sh` 一个文件）
- 不改 `src/routes/health.ts` 等任何 `src/**`（实测生产路径面硬编码 = 0 ⇒ 无 src 常量需改）
- 不追求全仓 `/Users/wane` 归零（1194 行横跨 docs/ .claude/ .dsh/ ⇒ 非本卡可达，另卡）
- 不碰 `src/cron/**`(#1454) / `src/sentinel/**`(#1463) / `src/tui-v2/**`(#1348) / `src/loops/**`
- 不改 `docs/authority/DOCS-REGISTRY.yaml`（本卡不新增需登记的正典文档；交付件放 `.synova-out/` 交付目录）
- 不动 `VERSION.md` 的 V4.9.1 谱系（属版本命名决策，报 CTO 裁，见交付件 未核项 U4）
- 不合并 PR（Lead 走）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/probe-packaging.sh`（登记件 BS-5 acceptance）
处理：四段断言 —— A(V1 构建面静态可达性) / B(V3 版本单一来源) / C(V2 生产路径面硬编码)
      / D(V4 产物无 sourcemap)
结果：exit 0 + stdout 末行 `RESULT=PASS`；任一断言失败 ⇒ exit 1 并列 [FAIL] 明细；
      探针自身异常（缺 jq / 缺判据文件 / COPY 解析失效）⇒ exit 2（fail-closed）

## 架构层: 交付/打包面（非 L1-L5 语义层；与桌面端生产链路同源：build-synova.cjs 构建链契约步骤1）

## Done 标准
- [x] verify: bash scripts/control-tower/probe-packaging.sh 期望 exit 0
- [x] verify: bash -n scripts/control-tower/probe-packaging.sh 期望 exit 0
- [x] verify: bash -n scripts/desktop/build-backend.sh 期望 exit 0
- [x] verify: bash scripts/desktop/build-backend.sh 期望 exit 0 且 dist/backend.mjs 产出
- [x] verify: find dist -type f -name '*.map' 期望 0 行
- [x] verify: git grep -c '/Users/wane' -- src Dockerfile app electron mvp-server.cjs 期望 0 行

## 判据诚实标注（判例 V-09）
V1 的 **docker build 实跑 + 容器内服务实起未核**（本机 `command -v docker` 空）。
等价实证：① probe A 段全部 COPY 源存在 ② 干净目录（仅 package.json/lock/tsconfig/src/
packages/vendor/scripts）在 **node 22**（Dockerfile 声明的运行时）下 `npm ci` +
`build-backend.sh` + `node dist/backend.mjs` 起服务，`/health` 返回
`{"status":"ok","name":"Synova-Agent","version":"0.1.0",...}`（HTTP 200）。
等价性边界详见 `.synova-out/交付-1464.md` §未核项。
