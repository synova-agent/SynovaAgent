# AGENTS.md · src/（五层业务代码域）

> 归属：产品线（各包按 `docs/authority/ASSET-MAP.yaml` 映射）｜ as_of `6c85b1925`

## 是什么
五层业务代码：L1 交互（`routes/`、`tui/`、`mcp/`）｜L2 编排（`agent/`、`orchestrator/`）｜L3 洞察（`l3/`、`sentinel/`、`expert-platform/`、`expert/`）｜L4 本体（`l4/`、`evidence/`）｜L5 存储（`store/`、`cron/`）｜以及应用入口 `index.ts`、`server.ts`。

## 谁改
各包负责人（见 ASSET-MAP）。跨层改动先由 CTO 裁「改哪层」；**禁止** L1→L3/L4/L5、L2→L4/L5 跨层 import（`check-architecture.sh` 硬阻断）。

## 怎么算完成（机器可判）
- `npx tsc --noEmit` → exit 0
- `npx vitest run --changed` → 0 failed（禁 skip 冒充通过）
- `git grep -nE "as +(any|never|unknown +as)" -- 'src/**/*.ts'` → 0
- 新增 compute/模块：先写六段契约（`@input/@output/@degraded/@authority/@not-here/@error`）＋配对测试（`tests/**`，含正常/降级/边界）

## 红线
- **铁律 46**：禁止桥接代理文件；`packages/engine-core` 引用白名单外零容忍
- **铁律 38**：`as` 强转家族（any／never／unknown-as）零容忍
- 静默降级禁止：catch 必 `log.warn/error` ＋ `degraded: true`（铁律 11/24/31）
- 不得改 `scripts/audit/**`（审计红线）；改门禁/判据属 A 类另走裁决

## 改本域涉及的包
按 ASSET-MAP 逐文件映射；跨包批次在 Gitea 台账登记（如 #1051/#1054），不靠记忆。
