# SynovaAgent — 组织数字孪生诊断 Agent
# 方案 B: Docker 部署 (用户有 Docker Desktop 或运维帮部署)
#
# 构建: docker buildx build --platform linux/amd64,linux/arm64 -t synova-agent .
# 启动: docker compose up -d
# 或用: docker run -d -p 3000:3000 -v $PWD/data:/app/data synova-agent
#
# ── #1464 BS-5 打包卫生修订（2026-10-09）──
#   ① 版本号单一来源: OCI 版本标签改由 ARG APP_VERSION 注入（真源 = package.json:version；
#      默认值与真源一致）。漂移会被 scripts/control-tower/probe-packaging.sh B1/B2/B4 判红。
#   ② COPY 源路径修正: 原第 19 行 `COPY server/vendor/ ./vendor/` 指向**仓库内不存在**的
#      server/ 目录 ⇒ `docker build` 必然失败（卡面「Dockerfile:19 server/ 路径问题」）。
#      改为顶层 `vendor/`；vendor/ 是运行时真依赖（src/agent/builtin-tools.ts:11、
#      src/mcp/bridge.ts:111、src/mcp/skill-installer.ts:50）。
#   ③ 生产入口与依赖面自洽: 原 CMD 为 `node --import tsx/esm src/index.ts`，而 tsx 是
#      devDependency（package-lock: dev=true）、构建阶段 `--omit=dev` ⇒ 镜像内无该 loader，
#      容器必起不来；且 src 内 367 处 `@synova/*` import 依赖 tsconfig paths，不在
#      node_modules 内。改为运行 esbuild 单文件 bundle（dist/backend.mjs，@synova/* 已 inline），
#      与桌面端生产链路（build-synova.cjs 构建链契约 步骤1）同一产物。
#   ④ 运行阶段改用 `npm ci --omit=dev`（去掉原 `--ignore-scripts`）: better-sqlite3/bcrypt
#      需 install 脚本落原生模块；原 --ignore-scripts 会使原生模块不可用。
#   ⑤ 不 COPY synova.json: 该文件优先于环境变量（src/config-file.ts 加载顺序
#      synova.json > .env），会把宿主配置（含 port:18790）泄进镜像并覆盖
#      docker-compose 的 PORT=3000 ⇒ 容器按宿主端口配置起，属打包卫生污染。
#      容器配置一律走环境变量（见 docker-compose.yml）。
#   判据: bash scripts/control-tower/probe-packaging.sh ⇒ exit 0
#
# ⚠️ 等价性边界（判例 V-09，禁把未核写成已核）:
#   以上修订已过 probe A 段静态可达性断言与宿主等价实证；但 `docker build` 实跑与
#   容器内服务实起**未核**（本机无 docker）。另: node:22-alpine(musl) 下
#   better-sqlite3 预编译可用性未核 ⇒ 见 #1464 交付件 未核项 U1/U3。

# ═══ 版本单一来源（真源 = package.json:version；改真源须同步此默认值）═══
# 注: ARG 必须在**消费它的阶段内**重新声明（Docker 作用域规则）——见阶段 2。
ARG APP_VERSION=0.1.0

# ═══ 阶段 1: 构建（multi-arch）═══
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /app

# 复制构建输入（源路径均须在仓库内真实存在 —— probe A1 判据）
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY vendor/ ./vendor/
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/desktop/build-backend.sh ./scripts/desktop/build-backend.sh

# 安装依赖（含 devDependency —— build-backend.sh 需 esbuild；bundle 即本阶段交付物）
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts

# 后端生产 bundle: dist/backend.mjs（@synova/* 全部 inline，运行时零包解析）
RUN bash scripts/desktop/build-backend.sh

# ═══ 阶段 2: 运行 ═══
FROM node:22-alpine

# 版本 ARG 必须在消费阶段内重新声明（Docker ARG 作用域规则；否则 LABEL 展开为空）
ARG APP_VERSION

LABEL org.opencontainers.image.title="SynovaAgent"
LABEL org.opencontainers.image.description="AI 组织诊断 — 持续增长导航系统"
LABEL org.opencontainers.image.version="${APP_VERSION}"

WORKDIR /app

# 仅生产依赖（不加 --ignore-scripts: better-sqlite3/bcrypt 需 install 脚本落原生模块，
# bundle 以 createRequire 在运行时加载二者 —— 见 build-backend.sh --external 声明）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 后端 bundle（生产入口）+ 运行时资产（vendor/ 是运行时真依赖）
COPY --from=builder /app/dist ./dist
COPY vendor/ ./vendor/

# 数据目录
RUN mkdir -p /app/data /app/logs

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

EXPOSE 3000

# 生产启动（esbuild 单文件 bundle；不依赖任何 devDependency）
ENV NODE_ENV=production
CMD ["node", "dist/backend.mjs"]
