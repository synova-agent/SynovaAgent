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
    // #840 E-4（policy：排除面**只许环境依赖**，不得排除验收件）
    //   留下 = 无法在本机/CI 自足复现的**环境依赖**（3 条）：
    //     · circular-dependency —— Node 运行时模块解析行为（随 Node 版本变）
    //     · e2e/** —— 需要真实 LLM API（凭据 + 网络）
    //     · data-pipeline.*.integration —— 需要 Feishu API
    //   移出（原 3 条，均非环境依赖）：acceptance/zero-code-industry（已按设计语义修正）、
    //     routes/ga-evolution、l4/ontology-loader —— 三条本地实测全绿，现纳入常规运行。
    exclude: process.env.CI
      ? [
          'tests/circular-dependency.test.ts',  // Node 24 import resolution（运行时行为）
          'tests/e2e/**',  // Needs LLM API（凭据+网络）
          'tests/data-pipeline.*.integration.test.ts',  // Feishu API
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
    },
  },
});
