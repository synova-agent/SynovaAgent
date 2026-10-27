/**
 * tests/extensions/onboarding-mount.test.ts — #712 建档通道**生产挂载**判据（Closes #712）
 *
 * 设计哲学（一句）：**「路由文件在树」不等于「用户可达」** —— 判据必须穿过 `src/server.ts`
 *   的 `createServer()` 装配出的真实 Express 应用打真 HTTP；否则本卡病灶（路由未挂载 ⇒ 生产不可达，E8）
 *   在测试里**永远看不见**（隔离起 app 的测试未挂载也照样绿 —— 这正是 declared-only 的形态）。
 *
 * 架构位置: **L1 交互**（`src/routes/onboarding.ts`）→ **⓪-b 人侧建档流程**（`src/onboarding/**`）。
 *   本文件断言的是**装配层**（铁律 4「写了代码没接线 ⇒ 交付不完整」＋ §10 装配层判据「摘掉接头 ⇒ 必红」），
 *   断言对象 = 生产 `createServer()` 返回的真 app，**禁夹具 app 替代断言对象**（V-02）。
 *
 * 契约（铁律 47）:
 *   @input  — 真 HTTP（无 mock）：
 *             · `POST /api/onboarding/start`（pre-auth 白名单；`dryRun` 由 body 决定）
 *             · `POST /api/onboarding/apply`（**须凭据**；body `superAdminConfirmed`；dryRun 恒 false）
 *             · `POST /api/auth/register`（取**真签发** JWT —— 禁自造令牌，复用现有签发路径）
 *             落盘根 = `process.cwd()`（`src/routes/onboarding.ts:72`，**不接受请求体路径** —— 防任意路径写入面）
 *             ⇒ 本文件用 `process.chdir(临时目录)` 控制落盘根，`finally` 恢复，**不写主树**。
 *   @output — 断言：① 挂载可达（未挂载 ⇒ 404 ⇒ 本文件红）；② 非 dryRun ⇒
 *             `extensions/presets/roles/<id>/` **真落盘**（磁盘实测，不只看响应体）；
 *             ③ `dryRun=true` ⇒ **零落盘**（反向用例，证明判据不是"只要调就绿"）；
 *             ④ 未鉴权 apply ⇒ fail-closed 且零落盘；⑤ 主树 `data/` **零写入**。
 *   @degraded — 建档流程自身 degraded（零文档/零岗位）由响应 `data.degraded` 透出，本文件**不吞**；
 *             若 `createServer()` 装配失败或 `data/` 被写 ⇒ 本文件**红**（不静默跳过 ——
 *             缺能力必须 fail-loud，Q-15）。
 *
 * 🔴 已知限制（禁写「暂无」）:
 *   ① **「五件套」缺口已由 #1075 P1-b 关闭（原为未决项）**：曾经生产生成器只落 **3 件**
 *      （`knowledge-scope.yaml` / `capabilities.yaml` / `acceptance-criteria.yaml`），而
 *      `src/init/preset-loader.ts` 的期望集为 **6 件**（`manifest.json` ＋ 五件套），
 *      且 `knowledge-scope.yaml` 的键名是 `knowledgeScope:`（loader 要 `scopes:`）⇒ 即使补件也装不上。
 *      #1075 P1-b 把生成器改到 6 件并修键名后，本文件按**该文件自述**把原「已知限制」翻转成**真判据**：
 *      真 HTTP apply ⇒ 6 件落盘 ⇒ 生产 `loadRolePacks()` 对该岗位 `degraded:false`、`missing:[]`
 *      （见 ④ 与 ② 的磁盘实测）。**这是本批唯一允许的 M7 已知限制翻转**，不改其它任何判据。
 *   ② 落盘根由 `process.cwd()` 决定 ⇒ 本文件内用例**串行**执行（不得并发改 cwd）。
 *   ③ 主树 `data/` 零写入只覆盖**本进程路径**（DB 走 `:memory:`）；外部进程写入不在本文件判据面。
 *   ④ 判据文件名按卡面写集冻结为 `*.test.ts`（铁律 33 三档中的集成档名义上该用
 *      `*.integration.test.ts`，此处从卡面，不擅自改名）。
 *   ⑤ 🔴 **#712-b 门序缺陷（#1067 已修；本文件以磁盘零断言钉住门序）**：
 *      · 修复**前**：`POST /api/onboarding/apply` 在 `superAdminConfirmed=false` 时返回 **409**（响应面
 *        fail-closed），但**盘上已写入 3 件** —— 先跑 `runOnboardingFlow`（第 ④ 步已写盘）再判确认
 *        ⇒ 任何**持证用户（非超管亦然）**都能写内容面。
 *      · 修复**后**（#1067）：确认门**前移**到调用 flow 之前 ⇒ 未确认路径**零落盘**。
 *      🔴 本文件 ① 在 409 + code 之后补 `expect(walkFiles(root)).toEqual([])`，把**门序**钉死
 *      （只断响应码时门序回归全套不可见 —— R-A 反向突变实测 6/6 假绿）。
 *      ⚠️ 该断言**依赖 #1067 在本支**：`ct/p3m7-pr5` **单支**（无 #1067）上**预期红**
 *      （1 failed / 5 passed 属预期，禁为转绿而弱化断言）；两支合并态才 6/6 绿。
 *
 * 铁律 48: 每格均有真断言（vitest expect 调用，禁空壳）；覆盖 挂载可达 / 凭证后 fail-closed /
 *          非 dryRun 真落盘 / dryRun 反向 / 未鉴权边界 / 主树零写入 / 缺口可观测 七路径。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createServer } from '../../src/server';
import { EXPECTED_PIECES, loadRolePacks } from '../../src/init/preset-loader';

// ═══ 常量与模块级快照（cwd 在所有 beforeAll 之前仍是仓库根）═══════════
/** 仓库根（= vitest 工作目录）。后续一切 chdir 都以它恢复。 */
const REPO_ROOT = process.cwd();
/** 本文件唯一被建档的角色 id（`SAFE_ROLE_ID` 合法：小写 + 连字符） */
const ROLE_ID = 'mount-probe';
/** 该角色的落盘目录（内容根相对路径 —— 与生产常量同源，不另立口径） */
const ROLE_REL_DIR = `extensions/presets/roles/${ROLE_ID}`;

let server: Server;
let BASE: string;
let origPresetsRoot: string | undefined;

// ═══ 工具：磁盘实测 ═══════════════════════════════════════════════════
/** 递归列出目录下所有文件（相对路径，`/` 分隔，已排序）；目录不存在 ⇒ 空数组 */
function walkFiles(dir: string, base: string = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs, base));
    else if (entry.isFile()) out.push(abs.slice(base.length + 1).split('\\').join('/'));
  }
  return out.sort();
}

/** 目录指纹（路径 + 大小 + mtime）——用于「零写入」断言 */
function fingerprint(dir: string): string {
  return walkFiles(dir)
    .map((rel) => {
      const st = statSync(join(dir, rel));
      return `${rel}|${String(st.size)}|${String(st.mtimeMs)}`;
    })
    .join('\n');
}

/** 在临时落盘根里跑一段（`process.cwd()` = 落盘根），**必恢复** */
async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'synova-onboarding-mount-'));
  process.chdir(root);
  try {
    return await fn(root);
  } finally {
    process.chdir(REPO_ROOT);
    rmSync(root, { recursive: true, force: true });
  }
}

/** 真签发一个 JWT（走 `POST /api/auth/register` —— 禁自造令牌） */
async function issueToken(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // 唯一性 nonce，不参与断言期望值（Q-6 时间语义不适用）
      email: `mount-probe-${String(Date.now())}@dev.local`,
      password: 'devpass1',
      role: 'finance',
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { ok?: boolean; token?: unknown };
  expect(body.ok).toBe(true);
  expect(typeof body.token).toBe('string');
  const token = String(body.token);
  expect(token.length).toBeGreaterThan(20);
  return token;
}

/**
 * 建档请求体（单角色；六块齐 —— #1075 P1-b 起生成器要求六块，缺任一即 400/零写入）。
 *
 * 🔴 夹具纪律：`contexts[].source` **只许** scope（本包 knowledge-scope 带锚）＋
 *   `profile.business-plan` 两类。落盘根是 `process.cwd()`（临时根），file 类 ref（如
 *   `extensions/ontology/…json`）在临时根必悬空 ⇒ 生产 loader 的 `kind=file` 存在性检查会假红。
 */
function roleSeedBody(): Record<string, unknown> {
  return {
    documents: ['org-roster.md', 'finance-sop.md'],
    roles: [
      {
        roleId: ROLE_ID,
        knowledgeScope: ['finance.statements', 'finance.budget'],
        capabilities: ['knowledge.finance.read'],
        acceptanceCriteria: ['monthly close within 5 business days'],
        contexts: [
          {
            id: 'finance.statements-ref',
            label: '财务报表口径',
            source: `${ROLE_REL_DIR}/knowledge-scope.yaml#finance.statements`,
            required: true,
          },
          {
            id: 'finance.budget-ref',
            label: '预算口径',
            source: `${ROLE_REL_DIR}/knowledge-scope.yaml#finance.budget`,
            required: true,
          },
          { id: 'company.bp', label: '公司业务说明', source: 'profile.business-plan' },
        ],
        systemAddendum: '你在为岗位 mount-probe 提供支持。\n结论必须标明口径来源；缺数据先追问。',
        outputTemplate: {
          templateId: 'mount-probe.standard',
          sections: [{ id: 'headline', title: '一句话结论', must: ['结论', '报告期'] }],
        },
      },
    ],
  };
}

/** 取响应里的某一步记录 */
function stepOf(
  data: { steps?: { name?: string; status?: string }[] },
  name: string,
): { name?: string; status?: string } | undefined {
  return (data.steps ?? []).find((s) => s.name === name);
}

// ═══ 装配：真 `createServer()`（不是夹具 app）═══════════════════════════
beforeAll(async () => {
  // 与 `tests/smoke.test.ts` 同形：port 0 = OS 随机端口；DB 走 :memory:（主树零写入）
  process.env['PORT'] = '0';
  process.env['SYNOVA_DB_PATH'] = ':memory:';
  // 🔴 真签发 JWT 需要 `JWT_SECRET`（`src/middleware/auth.ts:69-84`：**DEV_MODE=true 时无
  //   JWT_SECRET ⇒ getSecret() 显式返回 null ⇒ `signJwtToken` null ⇒ register 500
  //   「JWT signing failed」**——本会话实测踩到，不是本卡要治的东西，故显式注入 ≥16 字符）
  if (!process.env['JWT_SECRET'] || process.env['JWT_SECRET'].length < 16) {
    process.env['JWT_SECRET'] = 'pr5-onboarding-mount-secret-0123456789';
  }
  // 落盘根必须由 cwd 决定 —— 保证 `SYNOVA_PRESETS_ROOT` 注入缝不干扰本判据
  origPresetsRoot = process.env['SYNOVA_PRESETS_ROOT'];
  delete process.env['SYNOVA_PRESETS_ROOT'];

  server = await createServer();
  expect(server.listening).toBe(true);
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('createServer 未返回可解析的监听地址');
  BASE = `http://127.0.0.1:${String(addr.port)}`;
}, 60_000);

afterAll(async () => {
  process.chdir(REPO_ROOT);
  if (origPresetsRoot === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = origPresetsRoot;
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ═══ ① 挂载可达（本卡先红点：未挂载 ⇒ 404 ⇒ 本 describe 红）═══════════
describe('#712 ① 生产可达：`src/server.ts` 真挂载 onboarding 路由', () => {
  it('POST /api/onboarding/start ⇒ 200（未挂载 ⇒ 404 NOT_FOUND ⇒ 本断言红）', async () => {
    await withTempRoot(async () => {
      const res = await fetch(`${BASE}/api/onboarding/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...roleSeedBody(), dryRun: true }),
      });
      // 🔴 未挂载时 server.ts 尾部 404 兜底返回 { ok:false, code:'NOT_FOUND' } —— 404 ≠ 200
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok?: boolean; data?: { steps?: { name?: string }[] } };
      expect(body.ok).toBe(true);
      // 六步齐（有序；证明打到的是真建档流程，不是某个 echo 端点）
      expect((body.data?.steps ?? []).map((s) => s.name)).toEqual([
        'intake',
        'ontology-align',
        'gap-questions',
        'config-pack',
        'super-admin-confirm',
        'deploy',
      ]);
    });
  });

  it('POST /api/onboarding/apply **带真凭据**但未超管确认 ⇒ 409（不是 401、更不是 404）', async () => {
    // 🔴 本格必须带真凭据才能**分辨**「已挂载」与「未挂载」：
    //   未挂载 ⇒ auth 过后直接落到 server.ts 尾部 404 兜底 ⇒ 404；
    //   已挂载 ⇒ 真路由返回 409 SUPER_ADMIN_CONFIRMATION_REQUIRED（fail-closed）。
    //   ⚠️ 裸打（不带凭据）只会得 401 —— 401 在路由匹配**之前**发生，故 401 不能证明挂载（本会话实测）。
    const token = await issueToken();
    await withTempRoot(async (root) => {
      const res = await fetch(`${BASE}/api/onboarding/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(roleSeedBody()),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { ok?: boolean; code?: string };
      expect(body.ok).toBe(false);
      expect(body.code).toBe('SUPER_ADMIN_CONFIRMATION_REQUIRED');

      // 🔴 磁盘零断言 —— 本格真正的牙齿：409 只是「响应面 fail-closed」，**盘上不得有副作用**。
      //   该断言**依赖 #1067 的门序修复**（确认门前移到 `runOnboardingFlow` 之前）：
      //     · 修复前（`src/routes/onboarding.ts` 先跑 flow 再判确认）⇒ 第 ④ 步
      //       `generateConfigPack` 以 `dryRun:false` **已写盘 3 件** ⇒ 本断言必红
      //       （原始输出 `expected [ …(3) ] to deeply equal []`）；
      //     · 修复后 ⇒ 未确认路径**零落盘** ⇒ 本断言绿。
      //   ⇒ 即：本断言把「门序」钉死。只断 409 + code 时，门序回归在**全套测试里不可见**
      //      （R-A 反向突变实测 6/6 假绿；本断言即其最小红例）。
      //   ⚠️ 本断言在**不含 #1067 的单支（`ct/p3m7-pr5`）上预期红** ⇒ 单支 1 failed / 5 passed 属预期；
      //      两支合并态才 6/6 绿（见 PR #1056 正文 a–d 证据）。
      expect(walkFiles(root)).toEqual([]);
    });
  }, 60_000);
});

// ═══ ② 正常：非 dryRun ⇒ 真落盘（磁盘实测）════════════════════════════
describe('#712 ② 正常：`apply`（非 dryRun）⇒ 配置包真落盘', () => {
  it('真签发 JWT + superAdminConfirmed ⇒ 200 且 extensions/presets/roles/<id>/ 真写盘', async () => {
    // 令牌在仓库根签发（与落盘根无关），避免 chdir 干扰注册路径
    const token = await issueToken();
    const dataDir = join(REPO_ROOT, 'data');
    const dataBefore = fingerprint(dataDir);

    await withTempRoot(async (root) => {
      const res = await fetch(`${BASE}/api/onboarding/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...roleSeedBody(), superAdminConfirmed: true }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        ok?: boolean;
        data?: {
          steps?: { name?: string; status?: string }[];
          configPack?: { written?: string[]; planned?: string[] };
          degraded?: boolean;
        };
      };
      expect(body.ok).toBe(true);

      // ⓪ deploy 步必须是 ok（不是 skipped）—— 证明走的是「非 dryRun + 已确认」真部署支路
      expect(stepOf(body.data ?? {}, 'deploy')?.status).toBe('ok');
      expect(stepOf(body.data ?? {}, 'config-pack')?.status).toBe('ok');

      // ① 响应体（生产自述）与 ② 磁盘实测**必须一致** —— 只看响应会被"报了不算"骗过
      const written = (body.data?.configPack?.written ?? []).slice().sort();
      const landed = walkFiles(root).filter((p) => p.startsWith(ROLE_REL_DIR + '/'));
      expect(landed).toEqual(written);
      // #1075 P1-b：六件（与 loader 期望集同源，禁手抄第二份清单）
      expect(EXPECTED_PIECES.length).toBe(6);
      expect(written.length).toBe(EXPECTED_PIECES.length);
      expect(written).toEqual([...EXPECTED_PIECES].sort().map((piece) => `${ROLE_REL_DIR}/${piece}`));

      // ③ 逐文件非空 + 内容可核（knowledge-scope.yaml 必须带真 scope 值，不是空壳）
      for (const rel of landed) {
        expect(statSync(join(root, rel)).size).toBeGreaterThan(0);
      }
      const scopeYaml = readFileSync(join(root, `${ROLE_REL_DIR}/knowledge-scope.yaml`), 'utf8');
      // #1075 P1-b：载荷键名必须是 loader 期望的 `scopes:`（不是 `knowledgeScope:`）
      expect(scopeYaml).toMatch(/^scopes:\s*$/m);
      expect(scopeYaml).not.toContain('knowledgeScope:');
      expect(scopeYaml).toContain('finance.statements');
      expect(scopeYaml).toContain('finance.budget');
      const capsYaml = readFileSync(join(root, `${ROLE_REL_DIR}/capabilities.yaml`), 'utf8');
      expect(capsYaml).toContain('knowledge.finance.read');
      const contextYaml = readFileSync(join(root, `${ROLE_REL_DIR}/context-manifest.yaml`), 'utf8');
      expect(contextYaml).toContain('systemAddendum: |');
      // ④ #1075 P1-b：超管确认留痕必须带本次写入件数（P3 审批票据的对齐字段）
      const audit = readFileSync(join(root, '.synova', 'onboarding-audit.log'), 'utf8');
      expect(audit).toContain('SUPER_ADMIN_CONFIRMED');
      expect(audit).toContain('pieces=6');
      expect(audit).toContain('granted=');
    });

    // ④ 🔴 主树 data/ 零写入（落盘只进临时根）
    expect(fingerprint(dataDir)).toBe(dataBefore);
  }, 60_000);
});

// ═══ ③ 反向：dryRun=true ⇒ 零落盘（证明判据不是"只要调就绿"）═══════════
describe('#712 ③ 反向：`dryRun=true` ⇒ 一个文件都不落', () => {
  it('200 且 configPack.written 为空 / planned 非空 / 磁盘无 extensions 目录', async () => {
    await withTempRoot(async (root) => {
      const res = await fetch(`${BASE}/api/onboarding/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...roleSeedBody(), dryRun: true }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data?: { configPack?: { written?: string[]; planned?: string[] }; steps?: { name?: string; status?: string }[] };
      };
      // 自述：没写、只在计划里（#1075 P1-b：完整 seed ⇒ planned = 六件）
      expect(body.data?.configPack?.written ?? []).toEqual([]);
      expect((body.data?.configPack?.planned ?? []).length).toBe(EXPECTED_PIECES.length);
      expect((body.data?.configPack?.planned ?? []).length).toBe(6);
      // deploy 步 skipped（dryRun 不部署）
      expect(stepOf(body.data ?? {}, 'deploy')?.status).toBe('skipped');

      // 🔴 磁盘实测：连目录都不该出现（这才是"不落盘"的物理证据）
      expect(existsSync(join(root, 'extensions'))).toBe(false);
      expect(walkFiles(root).filter((p) => p.startsWith(ROLE_REL_DIR + '/'))).toEqual([]);
    });
  }, 60_000);
});

// ═══ ④ #1075 P1-b：「已知限制 ①」翻转成真判据（真 HTTP ⇒ 6 件 ⇒ 可装载）═════════
describe('#1075 P1-b ④ 已知限制①翻转：真 HTTP apply ⇒ 6 件落盘 ⇒ 生产 loader degraded:false、missing:[]', () => {
  it('真 apply 后 loadRolePacks() 对该岗位：pieces=6、missing=[]、degraded=false、declared=true', async () => {
    const token = await issueToken();
    await withTempRoot(async (root) => {
      const res = await fetch(`${BASE}/api/onboarding/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...roleSeedBody(), superAdminConfirmed: true }),
      });
      expect(res.status).toBe(200);

      // 磁盘实测（不是响应自述）
      expect(walkFiles(root).filter((p) => p.startsWith(ROLE_REL_DIR + '/')).length).toBe(
        EXPECTED_PIECES.length,
      );

      // 用**生产 loader**（不写第二份期望清单）判「装得上」
      const report = loadRolePacks();
      const pack = report.roles.find((r) => r.roleId === ROLE_ID);
      expect(pack).toBeDefined();
      expect(report.degraded).toBe(false);
      expect(report.errors).toEqual([]);
      expect(pack?.missing).toEqual([]);
      expect([...(pack?.pieces ?? [])].sort()).toEqual([...EXPECTED_PIECES].sort());
      // J4b 的同位断言：内容侧真声明（scope 非空、键名 scopes）
      expect(pack?.schemaValid).toBe(true);
      expect(pack?.knowledgeScope.declared).toBe(true);
      expect([...(pack?.knowledgeScope.scopeIds ?? [])].sort()).toEqual(['finance.budget', 'finance.statements']);
    });
  }, 60_000);
});

// ═══ ⑤ 落盘根隔离：请求体 path 被忽略（防任意路径写入面）═══════════════
describe('#712 ⑤ 边界：请求体指定 rootDir 被忽略（一律 cwd）', () => {
  it('body.rootDir 指向临时“evil”目录 ⇒ 该目录零写入，落盘只进 cwd', async () => {
    const evilRoot = mkdtempSync(join(tmpdir(), 'synova-onboarding-evil-'));
    try {
      await withTempRoot(async (root) => {
        const res = await fetch(`${BASE}/api/onboarding/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // ⑤ 判据的目的是 **rootDir 隔离**（请求体路径被忽略），不是确认语义 ⇒
          //   显式带上 `superAdminConfirmed: true` 才是「合法部署请求」（否则被 #1067 确认门挡成 409，
          //   本格就会把 C1 缺陷「未确认 ⇒ 写盘」固化成期望 —— 见 R-A 回执 活2 §3）。
          body: JSON.stringify({
            ...roleSeedBody(),
            dryRun: false,
            superAdminConfirmed: true,
            rootDir: evilRoot,
          }),
        });
        expect(res.status).toBe(200);
        // evil 目录零写入
        expect(walkFiles(evilRoot)).toEqual([]);
        // 落盘只进 cwd（临时根）—— 六件（#1075 P1-b；与 loader 期望集同源）
        expect(walkFiles(root).filter((p) => p.startsWith(ROLE_REL_DIR + '/'))).toHaveLength(
          EXPECTED_PIECES.length,
        );
      });
    } finally {
      rmSync(evilRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
