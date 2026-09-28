/**
 * tests/routes/settings.test.ts — D1053 入口/E2E 套件（线25 25-8 + 25-9 的 HTTP 面）
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1053-live-restart-settings-20260928.md §8.1
 * 承载断言: C1 两消费者同一新值（同一 it() 内先后读两端点互比）/ C2 400 校验语义 /
 *           C3 未声明清单出现在 HTTP 面 / C4 非法声明 ⇒ 200 + degraded + 规格错误码且涉事键不在 keys[]
 * 对应变异体: M3（消费者侧注入模块级缓存）⇒ C1 必红；M4（yaml 带 applies）⇒ C4 必红
 *
 * 命名偏差（登记）: 本件承载 E2E 语义，铁律 33 偏好 `*.e2e.test.ts`；因 pre-commit 组 2b 配对硬规则
 *   `src/routes/settings.ts → tests/routes/settings.test.ts` 被迫收敛（同 D600 先例
 *   `tests/routes/config.test.ts:5-6` 自述格式）。
 * 铁律 12: 起真实 createServer()（src/server.ts:124）+ PORT=0 + server.address() 取真实端口 + 真实 fetch，
 *   不 mock 管线、不手工挂 handler。先例 tests/routes/llm-config.test.ts:90。
 * 环境隔离: SYNOVA_SETTINGS_ROOT / SYNOVA_SETTINGS_HOME / SYNOVA_DATA_DIR / SYNOVA_DB_PATH 全指 tmp，
 *   绝不写仓库或真实 $HOME。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server';
import { initSettingsBootFence } from '../../src/config/settings-applies';
import { deepEqualJson } from '../../src/config/config-layers';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo, Server } from 'http';

let server: Server;
let BASE: string;
let rootDir: string;
let homeDir: string;
let tmpDataDir: string;
const savedEnv: Record<string, string | undefined> = {};

interface EffectiveKey {
  path?: string;
  applies?: string;
  declared?: boolean;
  effective?: unknown;
  pending?: unknown;
  sourceLayer?: string;
  /** 声明面默认值（DEV-1：live 键也必须给出，不得为 null）。 */
  defaultValue?: unknown;
}
interface EffectiveBody {
  ok?: boolean;
  degraded?: boolean;
  reason?: string;
  code?: string;
  bootId?: string;
  sourceFiles?: { workspace?: string | null; home?: string | null };
  undeclared?: string[];
  undeclaredTotal?: number;
  undeclaredScope?: string;
  truncated?: boolean;
  keys?: EffectiveKey[];
  /** DEV-2：declared/live/restart 只统计已声明行；undeclared 独立计数。 */
  counts?: { declared?: number; live?: number; restart?: number; undeclared?: number };
  error?: string;
}
interface DumpBody {
  ok?: boolean;
  orgId?: string;
  degraded?: boolean;
  settings?: { keys?: EffectiveKey[]; undeclared?: string[]; degraded?: boolean; scope?: string };
}

const VALID_YAML =
  'settings:\n' +
  '  diagnosis:\n' +
  '    gateDataCompleteness: 0.30\n' +
  '  rogue:\n' +
  '    whoAmI: 1\n';

async function getEffective(query = ''): Promise<{ status: number; body: EffectiveBody }> {
  const res = await fetch(`${BASE}/api/settings/effective${query}`);
  return { status: res.status, body: (await res.json()) as EffectiveBody };
}

async function getDump(): Promise<{ status: number; body: DumpBody }> {
  const res = await fetch(`${BASE}/api/config/dump?orgId=default`);
  return { status: res.status, body: (await res.json()) as DumpBody };
}

function writeWorkspace(body: string): void {
  writeFileSync(join(rootDir, 'settings.yaml'), body, 'utf8');
}

beforeAll(async () => {
  for (const key of ['SYNOVA_DATA_DIR', 'SYNOVA_DB_PATH', 'DEV_MODE', 'PORT', 'SYNOVA_SETTINGS_ROOT', 'SYNOVA_SETTINGS_HOME']) {
    savedEnv[key] = process.env[key];
  }
  rootDir = mkdtempSync(join(tmpdir(), 'd1053-e2e-root-'));
  homeDir = mkdtempSync(join(tmpdir(), 'd1053-e2e-home-'));
  tmpDataDir = mkdtempSync(join(tmpdir(), 'd1053-e2e-data-'));
  process.env.DEV_MODE = 'true';
  process.env.PORT = '0';
  process.env.SYNOVA_DB_PATH = ':memory:';
  process.env.SYNOVA_DATA_DIR = tmpDataDir;
  process.env.SYNOVA_SETTINGS_ROOT = rootDir;
  process.env.SYNOVA_SETTINGS_HOME = homeDir;
  writeWorkspace(VALID_YAML);

  server = await createServer();
  const addr = server.address() as AddressInfo;
  BASE = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  if (server) server.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of [rootDir, homeDir, tmpDataDir]) {
    if (dir && dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
  }
});

describe('入口 GET /api/settings/effective + 第二消费者 /api/config/dump（D1053）', () => {
  it('C1 · 两消费者同一新值：live 键改盘后两端点读回的 effective 相同且为新值（同一 it 内互比）', async () => {
    // 改盘（不重启；live 键下一次读取即新值）
    writeWorkspace(
      'settings:\n  diagnosis:\n    gateDataCompleteness: 0.55\n  rogue:\n    whoAmI: 1\n',
    );

    // 同一 it() 内先后读两个消费者，再互比 —— M3（消费者自缓存）的判别点
    const a = await getEffective('?ns=diagnosis&key=gateDataCompleteness');
    const b = await getDump();

    expect(a.status).toBe(200);
    expect(a.body.degraded).toBe(false);
    const rowA = a.body.keys?.find((k) => k.path === 'diagnosis.gateDataCompleteness');
    expect(rowA?.effective).toBe(0.55);

    expect(b.status).toBe(200);
    const rowB = b.body.settings?.keys?.find((k) => k.path === 'diagnosis.gateDataCompleteness');
    expect(rowB?.effective).toBe(0.55);

    // 硬判据：两值深度相等（无部分消费者滞留旧值）
    expect(deepEqualJson(rowA?.effective, rowB?.effective)).toBe(true);
    expect(deepEqualJson(rowA?.effective, rowA?.effective)).toBe(true);

    // DEV-1 判据（HTTP 契约面）：live 键行的 defaultValue = 声明面默认值 0.3，**不得为 null**
    expect(rowA?.defaultValue).toBe(0.3);
    expect(rowB?.defaultValue).toBe(0.3);

    // 第二消费者同时暴露 scope（进程级，R7）
    expect(b.body.settings?.scope).toBe('process');
  });

  it('C1b · restart 键在两消费者上同样一致（均为 boot 冻结旧值 + pending 新值）', async () => {
    writeWorkspace(
      'settings:\n  diagnosis:\n    gateDataCompleteness: 0.55\n' +
        '  llm:\n    baseUrl: "http://new.invalid"\n  rogue:\n    whoAmI: 1\n',
    );
    const a = await getEffective('?ns=llm&key=baseUrl');
    const b = await getDump();
    const rowA = a.body.keys?.find((k) => k.path === 'llm.baseUrl');
    const rowB = b.body.settings?.keys?.find((k) => k.path === 'llm.baseUrl');
    expect(rowA?.applies).toBe('restart');
    expect(rowA?.pending).toBe('http://new.invalid');
    expect(deepEqualJson(rowA?.effective, rowB?.effective)).toBe(true);
  });

  it('C2 · 400 校验语义（ns 格式 / key 无 ns / includeUndeclared 非法 / limit 越界）', async () => {
    const bad = await getEffective('?ns=BAD');
    expect(bad.status).toBe(400);
    expect(bad.body.ok).toBe(false);

    const noNs = await getEffective('?key=gateDataCompleteness');
    expect(noNs.status).toBe(400);

    const badFlag = await getEffective('?includeUndeclared=maybe');
    expect(badFlag.status).toBe(400);

    const overLimit = await getEffective('?limit=501');
    expect(overLimit.status).toBe(400);

    const zeroLimit = await getEffective('?limit=0');
    expect(zeroLimit.status).toBe(400);

    const nanLimit = await getEffective('?limit=abc');
    expect(nanLimit.status).toBe(400);
  });

  it('C3 · 未声明清单出现在 HTTP 面（undeclared[] + 枚举范围声明 + truncated）', async () => {
    const { status, body } = await getEffective();
    expect(status).toBe(200);
    expect(Array.isArray(body.undeclared)).toBe(true);
    expect(body.undeclared).toContain('rogue.whoAmI');
    expect(body.undeclaredScope).toBe('settings.yaml');
    expect(body.truncated).toBe(false);
    expect(body.undeclaredTotal).toBe(body.undeclared?.length);
    // DEV-2 判据：declared/live/restart 只统计**已声明**行；未声明行独立计数（规格 §7.1 示例 4+5=9）
    const counts = body.counts;
    expect(counts?.declared).toBe(9);
    expect(counts?.live).toBe(4);
    expect(counts?.restart).toBe(5);
    expect(counts?.undeclared).toBe(body.undeclaredTotal);
    expect((counts?.live ?? 0) + (counts?.restart ?? 0)).toBe(counts?.declared);
  });

  it('C3b · 未声明项在 keys[] 中强制 restart + declared:false（默认安全可观测）', async () => {
    const { body } = await getEffective('?ns=rogue&key=whoAmI');
    const row = body.keys?.find((k) => k.path === 'rogue.whoAmI');
    expect(row?.applies).toBe('restart');
    expect(row?.declared).toBe(false);
  });

  it('C4 · 非法声明（yaml 出现 applies 字段）⇒ 200 + degraded + 规格错误码，且涉事键不在 keys[]', async () => {
    // 置非法配置 + 经生产入口重新建立生效边界（createServer() 内已调用一次；此处显式 re-arm）
    writeWorkspace('settings:\n  bad:\n    x:\n      applies: sometimes\n');
    initSettingsBootFence({ force: true });

    const { status, body } = await getEffective();
    expect(status).toBe(200);
    expect(body.degraded).toBe(true);
    // §7.3 行"声明表非法…或 yaml 出现 applies" ⇒ code = SETTINGS_SPEC_INVALID（规格逐字）
    expect(String(body.code)).toContain('SETTINGS_SPEC_INVALID');
    // §4.1 行 init 失败可观测 ⇒ reason 携 SETTINGS_BOOT_FAILED（两码分工：code=底层因，reason=boot 失败面）
    expect(String(body.reason)).toContain('SETTINGS_BOOT_FAILED');
    // 整体响应（V 的 curl 面）必须同时可 grep 到规格错误码
    expect(JSON.stringify(body)).toContain('SETTINGS_SPEC_INVALID');
    // 涉事键不得以默认值冒充正常行（§7.3 禁回落默认值当作正常行）
    expect(body.keys?.length).toBe(0);

    // 第二消费者在同一降级态下形状一致（R7：catch/degraded 分支同样增列）
    const dump = await getDump();
    expect(dump.status).toBe(200);
    expect(dump.body.settings?.degraded).toBe(true);
    expect(dump.body.settings?.scope).toBe('process');
    expect(dump.body.settings?.keys?.length).toBe(0);
  });

  it('C4b · healthz 在规格错误下仍 200（配置面故障不成为启动故障面）', async () => {
    const res = await fetch(`${BASE}/api/healthz`);
    expect(res.status).toBe(200);
  });

  it('C2b · 未知键查询 ⇒ 200 + keys:[]（不是 404）', async () => {
    const { status, body } = await getEffective('?ns=diagnosis&key=notExistKey');
    expect(status).toBe(200);
    expect(body.keys).toEqual([]);
  });

  it('C3c · 边界：limit=1 时截断可见（truncated 与 undeclaredTotal 自洽）', async () => {
    mkdirSync(rootDir, { recursive: true });
    writeWorkspace(
      'settings:\n  rogue:\n    a: 1\n    b: 2\n    c: 3\n',
    );
    initSettingsBootFence({ force: true });
    const { status, body } = await getEffective('?limit=1');
    expect(status).toBe(200);
    expect(body.undeclared?.length).toBe(1);
    expect(body.undeclaredTotal).toBe(3);
    expect(body.truncated).toBe(true);
  });
});
