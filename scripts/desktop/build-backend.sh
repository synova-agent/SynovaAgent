#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# build-backend.sh — 后端单文件 ESM bundle（D518 prod 运行时修复）
#
# 为什么需要: dist/src/*.js 是 ESM + TS 风格无扩展名 import——裸 node 无法运行
# （ERR_MODULE_NOT_FOUND，main 存量，npm start 同样损坏）；且打包产物内依赖在
# app.asar 里，裸 node/node_modules 解析不可达 + 原生模块 ABI 不匹配。
# 方案: esbuild 单文件 ESM bundle（dist/backend.mjs）+ externals 仅原生模块
# （better-sqlite3/bcrypt，经 extraResources 落 resources/node_modules，electron ABI），
# prod 由包内 Electron 以 node 模式执行（ELECTRON_RUN_AS_NODE=1，ABI 一致，GA 零 Node 前提）。
#
# 契约（铁律 47）:
#   @input  src/index.ts + tsconfig paths（esbuild 原生支持）+ node_modules（externals 解析）
#           + node_modules/@synova/* 符号链接（tsconfig paths 别名指向 packages/*/src/index.ts，
#             而 @synova/* 未声明为 package.json 依赖 ⇒ Node 解析不到，须由本脚本自备）
#   @output dist/backend.mjs（约 5MB，含全部纯 JS 依赖；banner 注入 createRequire 供 CJS 依赖）
#   @degraded — esbuild 失败 → exit 非 0（构建链断，空包防线）
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/../.."

# ── #1464: 自备 @synova/* 解析链接（此前隐含依赖 dev 仓已存在该目录）──
#   背景: tsconfig paths 指向 packages/*/src/index.ts，但 `@synova/*` 不在 package.json
#   dependencies 内 ⇒ 干净 checkout / 容器 builder 阶段（npm ci 后）Node 解析不到，
#   esbuild 报 `Could not resolve "@synova/logger"` 而构建链断。
#   本步骤幂等：已存在则不动；仅在缺失时创建，使构建链在**干净目录**下自足。
if [ -d packages ] && [ ! -d node_modules/@synova ]; then
  mkdir -p node_modules/@synova
  for _pkg_dir in packages/*/; do
    [ -f "${_pkg_dir}package.json" ] || continue
    _pkg_name="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\(@synova\/[^"]*\)".*/\1/p' "${_pkg_dir}package.json" | head -1)"
    [ -n "${_pkg_name}" ] || continue
    _link="node_modules/${_pkg_name}"
    [ -e "${_link}" ] && continue
    ln -sfn "../../${_pkg_dir%/}" "${_link}"
  done
  echo "[build-backend] 已自备 @synova/* 解析链接（$(ls node_modules/@synova | wc -l | tr -d ' ') 个）"
fi

npx esbuild src/index.ts \
  --bundle --platform=node --format=esm --target=es2022 \
  --external:better-sqlite3 --external:bcrypt \
  --banner:js="import { createRequire as __synovaCr } from 'module'; const require = __synovaCr(import.meta.url);" \
  --outfile=dist/backend.mjs \
  --log-level=warning

test -f dist/backend.mjs && echo "[build-backend] dist/backend.mjs OK ($(du -h dist/backend.mjs | cut -f1))"
