---
状态: proposed
日期: 2026-10-09
决策: 打包卫生以「可独立跑红的探针」为判据载体；Docker 构建面改 bundle 取向 + 版本单一来源注入；构建脚本自备 @synova 解析链接
理由: 原 Dockerfile 三条病灶（COPY 指向不存在的 server/、OCI 标签硬编码 0.2.0 漂移于 package.json:0.1.0、CMD 依赖 devDependency tsx）使镜像**构建必失败且容器必起不来**；判据若不落到「改坏即红」的探针上，同类漂移无门禁可察（铁律 35：能自动化不靠 review）。
---

# BS-5 交付打包卫生：探针载体 + bundle 取向 + 版本单一来源（卡 #1464 · K10 第1批）

- 性质：**交付面治理**（不改门禁语义）⇒ 本文为决策沉淀，走 `proposed/`（未过 K3 裁决）。
- 定位：CTO 派单 BS-5（边界C §3.1，rc.1 复核）+ 登记件 `docs/synova/coordination/施工项登记.ts` BS-5。
- 交付判据（机器可判唯一权威）：`bash scripts/control-tower/probe-packaging.sh` ⇒ exit 0。

## 一、病灶（三条，均**确定性**故障而非风格问题）

| # | 病灶 | 物理证据 | 后果 |
|---|---|---|---|
| ① | `COPY server/vendor/ ./vendor/` | `git ls-tree --name-only origin/main \| grep -x server` ⇒ ABSENT；顶层 `vendor` 存在（25 文件） | **构建必失败**（首阶段断） |
| ② | OCI 版本标签写死 `0.2.0` | `Dockerfile:29`=0.2.0 vs `package.json:3`=0.1.0 | 标签漂移**无门禁可察** |
| ③ | `CMD ["node","--import","tsx/esm","src/index.ts"]` | `package-lock` 中 `node_modules/tsx` `dev=true`；构建阶段 `npm ci --omit=dev` | 镜像内无 loader ⇒ **容器必起不来** |

附带发现（决定 ③ 的正确修法）：
- `src` 内 `@synova/*` import **367 处**，靠 tsconfig `paths` 解析（不在 `package.json` dependencies）
  ⇒ 直接跑 `src/index.ts` 在镜像内亦会解析失败。
- 生产后端**已有** esbuild 单文件 bundle 取向：`scripts/desktop/build-backend.sh` → `dist/backend.mjs`
  （`@synova/*` 全部 inline，实测 `from"@synova/…"` 残留 = 0）。桌面端即以此发货
  （`build-synova.cjs` 构建链契约 步骤1）⇒ Docker 与桌面端**同源产物**。

## 二、决策（四条）

1. **判据载体 = 探针**（`scripts/control-tower/probe-packaging.sh`，18 断言，四段 A-V1/B-V3/C-V2/D-V4）：
   fail-closed（断言失败 exit 1；探针自身异常 exit 2），并配 CT-40 硬门禁要求的配对测试
   （`tests/control-tower/probe-packaging.test.sh`，含**变异体判别力**断言 —— 证明红灯来自断言而非环境噪声）。
2. **版本单一来源**：真源 = `package.json:version`；Dockerfile 用 `ARG APP_VERSION=<默认值>` 注入
   OCI 标签。**ARG 必须在消费阶段内重新声明**（Docker 作用域规则）——否则 LABEL 展开为空。
   构建链第三处（`build-synova.cjs` 的 `${version}`、`electron/main.cjs` 的 `app.getVersion()`）
   一律**派生态**，不新增字面量。
3. **Docker 构建面改 bundle 取向**：builder 阶段装含 devDependency 依赖并跑 `build-backend.sh`；
   runtime 阶段 `npm ci --omit=dev`（**去掉** `--ignore-scripts`——原生模块 better-sqlite3/bcrypt
   需 install 脚本）+ COPY bundle + `vendor/`。运行期版本读数依赖 bundle 同级 `package.json`
   （`src/services/update-checker.ts:63-76`，候选路径 `import.meta.dirname/../package.json`）
   ⇒ 镜像**必须**带 `package.json`，否则 `/health` 的 version 静默降级 `0.0.0`（已立 B6 断言钉住）。
4. **宿主配置件出构建上下文**：`.dockerignore` 增行排除 `synova.json`/`synova.json.last-good`/
   `.synova-state.json`/`.synova-owner`。**注意两处曾错**：①（我的错）`synova.json` **不**优先于
   环境变量 —— `src/config.ts:107` 为 `process.env.PORT || String(filePort || 3000)`，env 在前；
   ②（复核意见的错）`COPY package.json package-lock.json ./` **不会**把同级 `synova.json` 带进镜像
   —— Docker 规范「多源 COPY 只考具名源」。真实缺陷只是**上下文卫生**（未进镜像 + 潜在：
   COPY 被泛化成 `COPY . .` 时才进镜像）。故断言拆两条：A6 禁根目录级 COPY 通配；A6b 配置件须出上下文。
5. **构建脚本自足化**：`build-backend.sh` 在 `node_modules/@synova` 缺失时就地建符号链接。
   原实现隐含依赖「dev 仓已存在该目录」，干净 checkout / 容器 builder 阶段会断链
   （实测报 `Could not resolve "@synova/logger"`）。此为**构建链可复现性**修复，非新增依赖。

## 三、口径界定（V2 —— 本卡最易含糊处）

- **口径 A（执行口径）**：生产路径面 = `src/ Dockerfile app/ electron/ mvp-server.cjs` ⇒ 现 main **0 行**。
- **口径 B（全仓面）**：`git grep '/Users/wane' origin/main` ⇒ **1194 行 / 183 文件**，其中 `docs/` 1132、
  `.claude/` 30、`task-state/` 13，其余 19（含 3 处在 `scripts/` 但**全为注释行**）。
- 裁决：卡面「全仓 grep … **生产路径**=0」以**生产路径**为结果口径 ⇒ 本卡只对口径 A 负责；
  口径 B 归零跨文档域，**非本卡可达**（另卡）。

## 四、等价性边界（判例 V-09：禁把未核写成已核）

本机 `command -v docker` 为空 ⇒ **`docker build` 实跑与容器内服务实起未核**。
等价实证（已跑）：干净目录 + **node 22**（Dockerfile 声明的运行时）下
`npm ci` → `build-backend.sh` → `node dist/backend.mjs` 起服务，
`/health` 返回 `{"status":"ok","name":"Synova-Agent","version":"0.1.0",...}`（HTTP 200）。
**未核**：Docker 引擎行为、alpine/musl 下 better-sqlite3 预编译可用性（有 docker 的机器上须复跑）。

## 五、参考系（D333 四步）

- ①第一性原理：构建不可达 ⇒ 一切上层判据无效 ⇒ 先修可达性并**立可跑红的门禁**。
- ②Anthropic 工程基线：find root cause → 能自动化的不靠 review（铁律 35）。
- ③开源实证：esbuild/Vite 默认**不产** sourcemap（`--sourcemap` 未给 / `build.sourcemap` 未设）；
  Docker `ARG` 作用域按阶段隔离。
- ④收敛检查：以「与桌面端同源 bundle 产物」收敛两条交付链，而非新造 Docker 专用入口。

## 六、复跑命令

```bash
bash scripts/control-tower/probe-packaging.sh      # 判据：期望 exit 0（20 断言）
bash tests/control-tower/probe-packaging.test.sh   # 配对测试：期望 exit 0（19 断言）
bash tests/control-tower/probe-packaging.test.sh   # 配对测试（CT-40）：期望 exit 0
bash scripts/desktop/build-backend.sh              # 生产 bundle：期望产出 dist/backend.mjs
find dist -type f -name '*.map' | wc -l            # V4：期望 0
```
