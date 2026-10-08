/**
 * tests/deploy/db-path-resolve.test.ts — #1454 B4 判据 V3
 *
 * 被验对象：`src/deploy/data-directory.ts:resolveDbPath` + `src/routes/healthz.ts:checkDatabase`
 * 修前（origin/main@5a6591c4a）：healthz 直取 `path.join(getDataDirectory(), 'synova.db')`，
 * 不看 `SYNOVA_DB_PATH` / `SYNOVA_DATA_DIR` ⇒ 用独立库跑进程时健康检查查的是**另一个库**
 * ⇒ 库不存在/大小不符 ⇒ 恒假降级。
 *
 * 判据口径（三档可判别）：三个候选库给**互不相同**的合法字节数 ——
 *   ① SYNOVA_DB_PATH  → 4096B → detail "4KB"
 *   ② SYNOVA_DATA_DIR → 2048B → detail "2KB"
 *   ③ 平台目录(HOME)   → 8192B → detail "8KB"
 * 走**真实路由**（express + 真 HTTP，非直接调内部函数）：任何一档取错来源，
 * 报出的 KB 数就换人 ⇒ 断言红。改坏必红实证见交付评论（回硬编码 ⇒ 三档全报 8KB）。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import express from 'express';
import healthzRoutes from '../../src/routes/healthz';
import { getDataDirectory, resolveDbPath } from '../../src/deploy/data-directory';
import { loadConfig } from '../../src/config';

/** 造一个「至少前 16 字节合法」的 SQLite 文件，字节数可精确控制（用于判别来源） */
function writeFakeSqliteDb(filePath: string, sizeBytes: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const buf = Buffer.alloc(sizeBytes, 0x20);
  buf.write('SQLite format 3\0', 0, 'utf-8');
  fs.writeFileSync(filePath, buf);
}

const KEYS = ['HOME', 'SYNOVA_DB_PATH', 'SYNOVA_DATA_DIR'] as const;
type EnvKey = (typeof KEYS)[number];

/** 模块加载时的环境快照 —— 必须早于任何测试改动，用于最终无条件复原 */
const ORIGINAL_ENV: Record<EnvKey, string | undefined> = {
  HOME: process.env.HOME,
  SYNOVA_DB_PATH: process.env.SYNOVA_DB_PATH,
  SYNOVA_DATA_DIR: process.env.SYNOVA_DATA_DIR,
};

/** 按 patch 设置环境：值为 undefined ⇒ 删除该变量 */
function applyEnv(patch: Partial<Record<EnvKey, string | undefined>>): void {
  for (const k of KEYS) {
    if (k in patch) {
      const v = patch[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function restoreEnv(): void {
  applyEnv(ORIGINAL_ENV);
}

describe('#1454 V3 · resolveDbPath 取值链（纯函数级）', () => {
  afterEach(restoreEnv);

  it('① SYNOVA_DB_PATH 最高优先（原样返回，不做归一化）', () => {
    applyEnv({ SYNOVA_DB_PATH: '/tmp/synova-explicit.db', SYNOVA_DATA_DIR: '/tmp/synova-datadir' });
    expect(resolveDbPath()).toBe('/tmp/synova-explicit.db');
  });

  it('② 无 DB_PATH 时取 SYNOVA_DATA_DIR/synova.db', () => {
    applyEnv({ SYNOVA_DB_PATH: undefined, SYNOVA_DATA_DIR: '/tmp/synova-datadir' });
    expect(resolveDbPath()).toBe(path.join('/tmp/synova-datadir', 'synova.db'));
  });

  it('③ 两者皆无 ⇒ 平台数据目录/synova.db（与 getDataDirectory 同源）', () => {
    applyEnv({ SYNOVA_DB_PATH: undefined, SYNOVA_DATA_DIR: undefined });
    expect(resolveDbPath()).toBe(path.join(getDataDirectory(), 'synova.db'));
  });

  it('空白值等同未设置（不产生空路径拼接）', () => {
    applyEnv({ SYNOVA_DB_PATH: '   ', SYNOVA_DATA_DIR: '   ' });
    expect(resolveDbPath()).toBe(path.join(getDataDirectory(), 'synova.db'));
  });
});

describe('#1454 V3 · healthz 走真实路由读同一库（三档判别）', () => {
  let tmpRoot: string;
  let homeDir: string;
  let dataDir: string;
  let explicitDb: string;
  let server: ReturnType<typeof express.application.listen>;
  let baseUrl: string;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'synova-1454-v3-'));
    homeDir = path.join(tmpRoot, 'home');

    // ③ 平台目录（由 HOME 派生）—— 先定 HOME 再算路径
    applyEnv({ HOME: homeDir, SYNOVA_DB_PATH: undefined, SYNOVA_DATA_DIR: undefined });
    writeFakeSqliteDb(path.join(getDataDirectory(), 'synova.db'), 8192); // → "8KB"

    // ② SYNOVA_DATA_DIR
    dataDir = path.join(tmpRoot, 'data-dir');
    writeFakeSqliteDb(path.join(dataDir, 'synova.db'), 2048); // → "2KB"

    // ① SYNOVA_DB_PATH（独立库，显式指定）
    explicitDb = path.join(tmpRoot, 'explicit', 'my-own.db');
    writeFakeSqliteDb(explicitDb, 4096); // → "4KB"

    const app = express();
    app.use(healthzRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/healthz`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restoreEnv();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    // 每个用例后回到「有临时 HOME」的状态，防用例间串味
    applyEnv({ HOME: homeDir, SYNOVA_DB_PATH: undefined, SYNOVA_DATA_DIR: undefined });
  });

  async function fetchDatabaseCheck(): Promise<{ status: string; detail: string }> {
    const res = await fetch(baseUrl);
    const body = (await res.json()) as { checks: { database: { status: string; detail: string } } };
    return body.checks.database;
  }

  it('① SYNOVA_DB_PATH 指独立库 ⇒ healthz 报的是该库（4KB），不是平台库（8KB）', async () => {
    applyEnv({ HOME: homeDir, SYNOVA_DATA_DIR: dataDir, SYNOVA_DB_PATH: explicitDb });

    const db = await fetchDatabaseCheck();
    expect(db.status).toBe('ok');
    expect(db.detail).toContain('4KB');
    expect(db.detail).not.toContain('8KB');
  });

  it('② 去掉 SYNOVA_DB_PATH ⇒ 退档到 SYNOVA_DATA_DIR 的库（2KB）', async () => {
    applyEnv({ HOME: homeDir, SYNOVA_DATA_DIR: dataDir, SYNOVA_DB_PATH: undefined });

    const db = await fetchDatabaseCheck();
    expect(db.status).toBe('ok');
    expect(db.detail).toContain('2KB');
  });

  it('③ 两档皆无 ⇒ 平台目录的库（8KB）—— 证明前两档不是「恰好相等」', async () => {
    applyEnv({ HOME: homeDir, SYNOVA_DATA_DIR: undefined, SYNOVA_DB_PATH: undefined });

    const db = await fetchDatabaseCheck();
    expect(db.status).toBe('ok');
    expect(db.detail).toContain('8KB');
  });

  it('反例前置：SYNOVA_DB_PATH 指向不存在的库 ⇒ 明确报「不存在」而非误报平台库正常', async () => {
    applyEnv({ HOME: homeDir, SYNOVA_DATA_DIR: dataDir, SYNOVA_DB_PATH: path.join(tmpRoot, 'explicit', 'nope.db') });

    const db = await fetchDatabaseCheck();
    expect(db.status).toBe('degraded');
    expect(db.detail).toContain('数据库文件不存在');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 档③ 对照（独立复核 2026-10-09 提出的覆盖缺口）
//
// 复核结论：卡面 B4「健康检查读同一个库」在**两个 env 都未设**时仍未同源 ——
//   healthz 档③ = 平台数据目录（getDataDirectory()）
//   运行时档③ = `src/config.ts:104-105` ⇒ './data/synova.db'（**CWD 相对**），
//              由 `src/init/engine-context.ts:66 new Database(config.dbPath)` 真正打开
// ⇒ 属**存量、非本卡引入**（卡面 §④ 明确排除 src/config.ts：不反向改基准去迁就 healthz），
//   但**原交付测试对这条不可见**（没有任何一条把 resolveDbPath() 与 loadConfig().dbPath 对照）。
// 本组用例的作用：把「档③不同源」从「没人知道」变成「**测试里写着**」——
//   这正是卡面 V3 的判据边界，也是「覆盖缺口比缺陷更值得修」的那条。
// ═══════════════════════════════════════════════════════════════════════════

describe('#1454 V3 · 与运行时 `loadConfig().dbPath` 逐档对照（含档③已知存量分歧）', () => {
  /** loadConfig() 读 CWD/synova.json（ConfigRecovery 在「损坏」时有写回路径）⇒ 用例前后快照复原，保证不污染被 git 跟踪的配置文件 */
  const CONFIG_FILE = path.join(process.cwd(), 'synova.json');
  let cfgSnapshot: string | null = null;

  beforeEach(() => {
    cfgSnapshot = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf-8') : null;
  });
  afterEach(() => {
    if (cfgSnapshot !== null) fs.writeFileSync(CONFIG_FILE, cfgSnapshot, 'utf-8');
    restoreEnv();
  });

  it('档①/档②：resolveDbPath() 与 loadConfig().dbPath **同源**（文件级相等；跨平台用 path.resolve 比较）', () => {
    applyEnv({ SYNOVA_DB_PATH: '/tmp/synova-x.db', SYNOVA_DATA_DIR: '/tmp/synova-d' });
    expect(path.resolve(resolveDbPath())).toBe(path.resolve(loadConfig().dbPath));

    applyEnv({ SYNOVA_DB_PATH: undefined, SYNOVA_DATA_DIR: '/tmp/synova-d' });
    expect(path.resolve(resolveDbPath())).toBe(path.resolve(loadConfig().dbPath));
  });

  it('【已知存量·非契约】档③：两 env 全空 ⇒ healthz 走平台目录、运行时走 CWD 相对 ⇒ **不同源**', () => {
    applyEnv({ SYNOVA_DB_PATH: undefined, SYNOVA_DATA_DIR: undefined });
    const healthzPath = resolveDbPath();
    const runtimePath = loadConfig().dbPath;

    // 运行时真值锚（src/config.ts:104-105）：若 config 侧改了档③，本行先红 —— 提醒同步本卡的边界声明
    expect(runtimePath).toBe('./data/synova.db');
    expect(path.resolve(runtimePath)).toBe(path.resolve('./data/synova.db'));

    // 现状（**存量、非本卡引入**，且已在交付件「未决项」披露）：不是同一个库
    expect(healthzPath).not.toBe(runtimePath);
    expect(path.resolve(healthzPath)).not.toBe(path.resolve(runtimePath));

    // 边界复述（`src/deploy/data-directory.ts` 的 @invariant 只声明档①/档② 同源）：
    //   若有人把档③对齐（真修好）⇒ **本用例会红** ⇒ 请把断言改为相等并删掉「已知存量」标注。
    //   这是刻意的注意力机制，不是把缺陷钉成永久契约。
  });
});
