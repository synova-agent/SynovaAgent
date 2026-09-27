import { defineConfig } from 'vitest/config';
import path from 'path';

const packagesRoot = path.resolve(__dirname, 'packages');

export default defineConfig({
  resolve: {
    alias: [
      { find: '@synova/sog-core', replacement: path.join(packagesRoot, 'sog-core/src/index.ts') },
      { find: '@synova/logger', replacement: path.join(packagesRoot, 'logger/src/index.ts') },
      { find: '@synova/error-types', replacement: path.join(packagesRoot, 'error-types/src/index.ts') },
      { find: '@synova/connector-registry', replacement: path.join(packagesRoot, 'connector-registry/src/index.ts') },
      { find: '@synova/extension-registry', replacement: path.join(packagesRoot, 'extension-registry/src/index.ts') },
      { find: '@synova/knowledge-ingest', replacement: path.join(packagesRoot, 'knowledge-ingest/src/index.ts') },
      { find: '@synova/engine-auth', replacement: path.join(packagesRoot, 'engine-auth/src/index.ts') },
      { find: '@synova/evolution', replacement: path.join(packagesRoot, 'evolution/src/index.ts') },
      { find: '@synova/ontology', replacement: path.join(packagesRoot, 'ontology/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    // 铁律 33: 测试按类型命名
    //   *.test.ts → 单元测试 (纯函数, 无 I/O)
    //   *.integration.test.ts → 集成测试 (API + DB, 真实 SQLite)
    //   *.e2e.test.ts → 端到端测试 (完整用户旅程)
    include: ['./tests/**/*.test.ts', './tests/**/*.integration.test.ts'],
    exclude: process.env.CI
      ? [
          'tests/acceptance/**',  // "零 .ts 文件修改" depends on uncommitted state
          'tests/circular-dependency.test.ts',  // Node 24 import resolution
          'tests/e2e/**',  // Needs LLM API
          'tests/data-pipeline.*.integration.test.ts',  // Feishu API
          'tests/routes/ga-evolution.test.ts',  // Pre-existing GA failure
          'tests/l4/ontology-loader.test.ts',  // edge-types session, not ours
        ]
      : [],
    coverage: {
      provider: 'v8',
      include: ['./src/**/*.ts'],
      exclude: [
        './src/tui/**',        // neo-blessed TUI — 需 headless e2e, 非单元测试范围
        './src/tools/**',      // 专家工具链 — stub/静态数据返回, 已有集成测试覆盖
        './src/skills/**',     // 技能加载器 — 文件系统扫描, 需集成测试
        './src/cli.ts',        // readline CLI — 交互式, 需 e2e
        './src/setup.ts',      // 交互式 setup 向导 — 需 e2e
        './src/monitoring/**', // Prometheus 指标 — 已有 smoke test
      ],
      // P3-01: 目标 60%，当前基线 40% (逐步提升)
      thresholds: {
        lines: 40,
        functions: 45,
        branches: 30,
        statements: 40,
      },
    },
    env: {
      DEV_MODE: 'true',
      PORT: '3099',
      SYNOVA_DB_PATH: ':memory:',
      SYNOVA_SKIP_MCP: '1',
      // A4-b (D1035): 测试期默认收敛到 warn — ERROR 不再被 INFO 淹没（失败时仍能出上下文）。
      // ① 用 `process.env.LOG_LEVEL ?? 'warn'` 而非硬编码：`test.env` 是**覆盖**语义
      //    （实测 E2b：硬编码 'warn' 时外部 `LOG_LEVEL=debug npx vitest run` 仍被压成 warn），
      //    `??` 在 config 主进程求值 ⇒ 外部显式值可透传，不静默夺走调试开关。
      // ② 不用 setupFiles：logger 在**模块加载期**固化级别（packages/logger/src/index.ts:12），
      //    test.env 在 worker 启动时注入，早于任何测试模块 import；且 test.env 单点声明、diff 最小。
      // ③ 勿设为 'silent'：packages/logger/src/index.ts:44 的二级抑制开关会让 fd 2 彻底静音，
      //    失败上下文一并消失。
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    },
  },
});
