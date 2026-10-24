/**
 * tests/routes/config.test.ts — D600: GET /api/config/dump 客户配置检查表面（--dump-config 三件套）
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-D600-cfg-productize-first-command-20260908.md §4
 * 路径说明: 组2b 配对映射 src/routes/config.ts → tests/routes/config.test.ts（tests/routes/ 既有
 *          惯例 *.test.ts，D575 先例）——spec §3.1 原名 config-dump.test.ts 的登记偏差，§3.2 同 commit 回填。
 * 依赖: D599 resolveCustomerConfig（复用不重写）。
 *
 * 验证（修复前无 dump 端点 → 404/模块不存在 → red）:
 *   ① dump 返回逐层 provenance（default/industry/customer/workspace 来源 + contributedKeys）
 *   ② 泄漏键已剥离（顶层保留全局键不出现 + audit 上报 + degraded）
 *   ③ orgId 缺省返回 400
 *   ④ 无包 orgId → degraded 不抛（铁律 24/31）
 *   ⑤ 非法 orgId（路径逃逸尝试）→ 不逃逸、degraded 返回
 *
 * 铁律 12: 集成测试走真实路由（express app + listen(0) + fetch），不 mock 管线。
 * 测试夹具: cwd/customer-config/{orgId}/*.yml（afterAll 只删本测试 orgId 子目录，防并行竞态）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'http';
import { randomBytes } from 'node:crypto';
import { resolveCustomerConfig } from '../../src/config/customer-config-package';

const ORG_FULL = 'd600-dump-full';
const ORG_LEAK = 'd600-dump-leak';
const CONFIG_ROOT = join(process.cwd(), 'customer-config');

interface DumpBody {
  ok?: boolean;
  orgId?: string;
  config?: Record<string, unknown>;
  provenance?: Array<{ layer?: string; present?: boolean; contributedKeys?: string[] }>;
  degraded?: boolean;
  reason?: string;
  audit?: Array<{ path?: string; kind?: string }>;
  code?: string;
  error?: string;
}

async function dump(baseUrl: string, query: string): Promise<{ status: number; body: DumpBody }> {
  // #838 E-2 ②: 路由现在要求「验签身份组织 == ?orgId」。测试用 `x-test-org` 模拟中间件注入
  //   （生产由 jwtAuthMiddleware 注入 req.auth；本文件只挂 config 路由，故自带注入缝）。
  const m = /orgId=([^&]*)/.exec(query);
  const declared = m ? decodeURIComponent(m[1] ?? '') : '';
  const res = await fetch(`${baseUrl}/api/config/dump${query}`, {
    headers: declared ? { 'x-test-org': declared } : {},
  });
  const body = (await res.json()) as DumpBody;
  return { status: res.status, body };
}

describe('D600: GET /api/config/dump 检查表面', () => {
  // ── #838 E-2 ②: 跨租户 fail-closed（两态）────────────────────────────────
  it('E2-②a 无身份（未注入 req.auth）⇒ 403 CROSS_ORG_DENIED / auth_org_missing', async () => {
    const res = await fetch(`${baseUrl}/api/config/dump?orgId=${ORG_FULL}`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as DumpBody;
    expect(body.code).toBe('CROSS_ORG_DENIED');
    expect(body.reason).toBe('auth_org_missing');
  });

  it('E2-②b 身份组织 != ?orgId ⇒ 403 CROSS_ORG_DENIED / org_mismatch', async () => {
    const res = await fetch(`${baseUrl}/api/config/dump?orgId=${ORG_FULL}`, {
      headers: { 'x-test-org': ORG_LEAK },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as DumpBody;
    expect(body.code).toBe('CROSS_ORG_DENIED');
    expect(body.reason).toBe('org_mismatch');
  });

  it('E2-②c 身份组织 == ?orgId ⇒ 200（正常路径不被误伤）', async () => {
    const { status, body } = await dump(baseUrl, `?orgId=${ORG_FULL}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // full 包: industry + customer(composition) + workspace 三层 + default(路由内置空对象)
    mkdirSync(join(CONFIG_ROOT, ORG_FULL), { recursive: true });
    writeFileSync(
      join(CONFIG_ROOT, ORG_FULL, 'industry.yml'),
      'industryKey: industry-value\ndiagnosis:\n  reportDepth: expert\n',
      'utf8',
    );
    writeFileSync(
      join(CONFIG_ROOT, ORG_FULL, 'config.yml'),
      'diagnosis:\n  reportDepth: ceo\n  template: flywheel\ncustomerKey: customer-value\n',
      'utf8',
    );
    writeFileSync(join(CONFIG_ROOT, ORG_FULL, 'workspace.yml'), 'workspaceKey: ws-value\n', 'utf8');
    // leak 包: 顶层保留全局键（剥离 + 审计 + degraded）
    mkdirSync(join(CONFIG_ROOT, ORG_LEAK), { recursive: true });
    writeFileSync(
      join(CONFIG_ROOT, ORG_LEAK, 'config.yml'),
      'process:\n  pid: 1\ndiagnosis:\n  reportDepth: ceo\n',
      'utf8',
    );

    const configRouter = (await import('../../src/routes/config')).default;
    const app = express();
    app.use(express.json());
    // #838 E-2 ② 注入缝：模拟 jwtAuthMiddleware 的 req.auth（生产路径由中间件注入）
    app.use((req, _res, next) => {
      const org = req.headers['x-test-org'];
      if (typeof org === 'string' && org.trim()) {
        (req as unknown as { auth?: { orgId: string } }).auth = { orgId: org.trim() };
      }
      next();
    });
    app.use(configRouter);
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr !== 'string') baseUrl = `http://localhost:${addr.port}`;
    });
    await new Promise<void>(resolve => { const t = setInterval(() => { if (baseUrl) { clearInterval(t); resolve(); } }, 10); });
  });

  afterAll(() => {
    for (const orgId of [ORG_FULL, ORG_LEAK]) {
      rmSync(join(CONFIG_ROOT, orgId), { recursive: true, force: true });
    }
    return new Promise<void>(resolve => { server.close(() => resolve()); });
  });

  it('① dump 返回逐层 provenance（default/industry/customer/workspace 顺序 + contributedKeys）', async () => {
    const { status, body } = await dump(baseUrl, `?orgId=${ORG_FULL}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.orgId).toBe(ORG_FULL);
    const layers = body.provenance?.map(l => l.layer) ?? [];
    expect(layers).toEqual(['default', 'industry', 'customer', 'workspace']);
    const industry = body.provenance?.find(l => l.layer === 'industry');
    expect(industry?.present).toBe(true);
    expect(industry?.contributedKeys).toContain('industryKey');
    // diagnosis 键被 customer 层覆盖 → owner 是 customer 而非 industry
    const customer = body.provenance?.find(l => l.layer === 'customer');
    expect(customer?.contributedKeys).toContain('customerKey');
    expect(industry?.contributedKeys).not.toContain('diagnosis');
  });

  it('② 泄漏键已剥离（config 干净 + audit 上报 + degraded）', async () => {
    const { status, body } = await dump(baseUrl, `?orgId=${ORG_LEAK}`);
    expect(status).toBe(200);
    expect(body.config?.process).toBeUndefined();
    expect(body.degraded).toBe(true);
    expect(body.audit?.some(e => e.path === '$.process')).toBe(true);
    expect(body.audit?.some(e => e.kind === 'reserved-global')).toBe(true);
    // 非泄漏键保留（剥离是 per 键 fail-closed，不整包丢弃）
    expect(body.config?.diagnosis).toBeDefined();
  });

  it('③ orgId 缺省返回 400（校验错误）', async () => {
    const { status, body } = await dump(baseUrl, '');
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('④ 无包 orgId → degraded 不抛（default 层兜底）', async () => {
    const { status, body } = await dump(baseUrl, '?orgId=d600-dump-none');
    expect(status).toBe(200);
    expect(body.degraded).toBe(true);
    expect(body.ok).toBe(true);
    expect(String(body.reason)).toContain('无客户配置包');
    expect(Object.keys(body.config ?? {}).length).toBe(0);
  });

  it('⑤ 非法 orgId（路径逃逸尝试）→ 不逃逸、degraded 返回', async () => {
    const { status, body } = await dump(baseUrl, '?orgId=..%2Fescape');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.orgId).toBe('../escape');
    expect(Object.keys(body.config ?? {}).length).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 914-Q2 · 配置面秘密结构性脱敏（跨 wire 断言无值）
// 规格: .handbook/派单件/2026-10-24-规格-914-Q2-秘密结构脱敏.md §4.2（判据 A）／§4.3（判据 B）
// 铁律 12 / R5: 真实 express app + listen(0) + fetch（不 mock 管线）。
// R4: 上面 8 条既有用例一字不改（本段只追加）。
// 夹具: customer-config/914-q2-secret/*.yml 运行期造、afterAll 删（不把 .yml 夹具提交进仓）。
// 判别力: 同文件内联"故意返回明文"的对照 app（不进产品代码）⇒ 同一断言必抛。
// ═════════════════════════════════════════════════════════════════════════════

const ORG_SECRET = '914-q2-secret';

/** 秘密侧车 wire 形态（判据 A-4）：只有有无/来源，没有任何值片段。 */
interface SecretSidecarWire {
  path: string;
  configured: boolean;
  source: string | null;
}

/** 层文档的最小 wire 视图（本测试只关心 llm 子树）。 */
interface LayerDocWire {
  llm?: { apiKey?: unknown; model?: unknown };
}

interface ProvenanceWire {
  layer?: string;
  present?: boolean;
  contributedKeys?: string[];
  doc?: LayerDocWire | null;
}

interface DumpBodyWire {
  ok?: boolean;
  orgId?: string;
  config?: LayerDocWire;
  secrets?: SecretSidecarWire[];
  provenance?: ProvenanceWire[];
  degraded?: boolean;
  reason?: string;
}

/** 对象是否有自有键（不用 `as object` 断言，铁律 38）。 */
function hasKey(target: unknown, key: string): boolean {
  return typeof target === 'object' && target !== null && key in target;
}

/**
 * 跨 wire 密文断言（判据 A/B 共用同一判别器）：
 * canary 全文或末 4 位任一出现在 wire body ⇒ 抛。正常路径不抛 = 无泄漏；
 * 明文对照 app ⇒ 必抛（证明本断言真能拦，不是假绿）。
 */
function assertNoSecret(raw: string, canary: string): void {
  if (raw.includes(canary) || raw.includes(canary.slice(-4))) {
    throw new Error('canary leaked（canary 全文或末 4 位出现在 wire body）');
  }
}

/** 一次真实 HTTP GET，返回原始文本（判据必须对 raw 断言，不能只对解析后对象断言）。 */
async function getRaw(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; raw: string }> {
  const res = await fetch(url, { headers });
  return { status: res.status, raw: await res.text() };
}

function parseBody(raw: string): DumpBodyWire {
  return JSON.parse(raw) as DumpBodyWire;
}

/** listen(0) 随机端口（不占固定端口，可并行）。 */
async function listenEphemeral(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('listen(0) 未返回 TCP 端口（测试环境异常）');
  }
  return { server, url: `http://localhost:${addr.port}` };
}

function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return Promise.resolve();
  return new Promise<void>((resolve) => { server.close(() => resolve()); });
}

describe('914-Q2: GET /api/config/dump 秘密结构性脱敏（跨 wire 无值 ＋ 判别力）', () => {
  // 32 位随机 canary：config 层一个、workspace 层一个（测"来源层"与 provenance 两态）。
  const canaryConfig = `CANARY-${randomBytes(16).toString('hex')}`;
  const canaryWorkspace = `CANARY2-${randomBytes(16).toString('hex')}`;

  let productServer: Server | undefined;
  let leakyServer: Server | undefined;
  let productUrl = '';
  let leakyUrl = '';

  beforeAll(async () => {
    // 夹具运行期造（三层：industry / config(customer) / workspace）；afterAll 删本 orgId 子目录。
    mkdirSync(join(CONFIG_ROOT, ORG_SECRET), { recursive: true });
    writeFileSync(join(CONFIG_ROOT, ORG_SECRET, 'industry.yml'), 'industryKey: industry-value\n', 'utf8');
    writeFileSync(
      join(CONFIG_ROOT, ORG_SECRET, 'config.yml'),
      `llm:\n  apiKey: ${canaryConfig}\n  model: deepseek-chat\n`,
      'utf8',
    );
    writeFileSync(
      join(CONFIG_ROOT, ORG_SECRET, 'workspace.yml'),
      `llm:\n  apiKey: ${canaryWorkspace}\n`,
      'utf8',
    );

    // 产品路径：挂真路由（R5 真实 HTTP）；身份注入沿用既有 x-test-org 缝。
    const configRouter = (await import('../../src/routes/config')).default;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const org = req.headers['x-test-org'];
      if (typeof org === 'string' && org.trim()) {
        Object.assign(req, { auth: { orgId: org.trim() } });
      }
      next();
    });
    app.use(configRouter);

    // 判据 B 对照 app：故意原样回明文（同源挂载数据，不进产品代码）——
    // 若产品路径退化为"原样回 wire"，同一 assertNoSecret 即在此路径证伪。
    const leakyApp = express();
    leakyApp.get('/leak', async (_req, res) => {
      const mounted = await resolveCustomerConfig(ORG_SECRET, {
        roots: [{ path: CONFIG_ROOT, trust: 'customer' as const }],
      });
      res.json({ config: mounted.config, provenance: mounted.provenance });
    });

    const product = await listenEphemeral(app);
    productServer = product.server;
    productUrl = product.url;
    const leaky = await listenEphemeral(leakyApp);
    leakyServer = leaky.server;
    leakyUrl = leaky.url;
  });

  afterAll(async () => {
    rmSync(join(CONFIG_ROOT, ORG_SECRET), { recursive: true, force: true });
    await Promise.all([closeServer(productServer), closeServer(leakyServer)]);
  });

  it('A-1 秘密值不跨 wire：canary 全文与末 4 位均不出现在 HTTP body', async () => {
    const { status, raw } = await getRaw(`${productUrl}/api/config/dump?orgId=${ORG_SECRET}`, {
      'x-test-org': ORG_SECRET,
    });
    expect(status).toBe(200);
    const body = parseBody(raw);
    // 数据前提：夹具真被挂载（否则"没有 canary"是假绿），非秘密字段确实跨了 wire。
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(false);
    expect(raw).toContain('deepseek-chat');
    assertNoSecret(raw, canaryWorkspace); // 含末 4 位
    assertNoSecret(raw, canaryConfig);
  });

  it('A-2 config.llm.apiKey 仅为 {configured:true}，且无 value 字段', async () => {
    const { raw } = await getRaw(`${productUrl}/api/config/dump?orgId=${ORG_SECRET}`, {
      'x-test-org': ORG_SECRET,
    });
    const body = parseBody(raw);
    expect(body.config?.llm?.apiKey).toEqual({ configured: true });
    expect(hasKey(body.config?.llm?.apiKey, 'value')).toBe(false);
    expect(hasKey(body.config?.llm?.apiKey, 'apiKey')).toBe(false);
  });

  it('A-3 非秘密键原样跨 wire（脱敏不误伤）', async () => {
    const { raw } = await getRaw(`${productUrl}/api/config/dump?orgId=${ORG_SECRET}`, {
      'x-test-org': ORG_SECRET,
    });
    const body = parseBody(raw);
    expect(body.config?.llm?.model).toBe('deepseek-chat');
    expect(raw).toContain('industry-value');
  });

  it('A-4 secrets 侧车给 {path, configured, source}（没有任何值片段）', async () => {
    const { raw } = await getRaw(`${productUrl}/api/config/dump?orgId=${ORG_SECRET}`, {
      'x-test-org': ORG_SECRET,
    });
    const body = parseBody(raw);
    expect(body.secrets).toContainEqual({ path: '$.llm.apiKey', configured: true, source: 'workspace' });
    const slot = body.secrets?.find((s) => s.path === '$.llm.apiKey');
    expect(slot).toBeDefined();
    expect(Object.keys(slot ?? {}).sort()).toEqual(['configured', 'path', 'source']);
  });

  it('A-5 provenance[].doc 第二泄漏面同样脱敏（来源元数据不变）', async () => {
    const { raw } = await getRaw(`${productUrl}/api/config/dump?orgId=${ORG_SECRET}`, {
      'x-test-org': ORG_SECRET,
    });
    const body = parseBody(raw);
    const customerRow = body.provenance?.find((l) => l.layer === 'customer');
    expect(customerRow?.present).toBe(true);
    expect(customerRow?.doc?.llm?.apiKey).toEqual({ configured: true });
    expect(customerRow?.doc?.llm?.model).toBe('deepseek-chat');
    const workspaceRow = body.provenance?.find((l) => l.layer === 'workspace');
    expect(workspaceRow?.doc?.llm?.apiKey).toEqual({ configured: true });
    expect(workspaceRow?.contributedKeys).toContain('llm');
  });

  it('B-1 判别力：明文对照 app ⇒ 同一 assertNoSecret 必抛 /canary leaked/', async () => {
    const { status, raw: leakyRaw } = await getRaw(`${leakyUrl}/leak`);
    expect(status).toBe(200);
    // 前提：对照 app 确实在泄漏（若它没泄漏，本用例证明不了判别力）。
    expect(leakyRaw).toContain(canaryWorkspace);
    expect(() => assertNoSecret(leakyRaw, canaryWorkspace)).toThrow(/canary leaked/);
    // 末 4 位单点判别力：只喂末 4 位也必须抛。
    expect(() => assertNoSecret(canaryWorkspace.slice(-4), canaryWorkspace)).toThrow(/canary leaked/);
  });
});
