/**
 * tests/electron/backend-spawn.test.ts — D504 Electron 服务自启契约
 *
 * 契约（铁律 47，先于实现定义 — dev doc §3.5）:
 *   ensureBackend(options):
 *     探活成功（已有健康服务）→ { started: false, reused: true } 不 spawn（端口冲突安全网）
 *     探活失败 → spawn 后端 → 探活成功 → { started: true, pid }
 *     spawn 后探活仍失败 → 重启（≤maxRestarts）→ 超限 { degraded: true, error }
 *     spawn ENOENT（后端不存在）→ { degraded: true } 不抛
 *     prod 模式 env 注入 SYNOVA_DB_PATH；dev 模式命令 = npx tsx src/index.ts
 *   stop() → SIGTERM 回收子进程（无孤儿）
 * 铁律 48: 正常（spawn→healthy）/ 降级（超限/ENOENT → degraded）/ 边界（reused/env 注入/双模式）。
 *
 * 纯 Node 模块（不 require electron）——vitest node 环境直测，CI 无 GUI 可验服务自启。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * D504 落地对象: electron/backend-spawn.cjs（CommonJS，纯 Node）。
 * vitest ESM 下用 createRequire 加载。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const backendSpawnPath = path.resolve(__dirname, '../../electron/backend-spawn.cjs');

// ── W1d/D1164（治理线，2026-10-06）: 子进程登记器 + afterEach 兜底回收 ────────────────
// 病灶（本机实测，非推断）: 本文件多处让 `ensureBackend` **真 spawn** 一个假后端
//   （桩脚本用 `setInterval(...)` 保活），而 `afterEach` 的 `handles` 只登记了
//   `fake.close()`（测试进程内的 HTTP server）与 `fs.unlinkSync(stub)`（删桩文件），
//   **没有登记"杀掉那个子进程"** ⇒ 残留子进程持有的 stdio 句柄让 vitest 的 forks worker
//   退不出去 ⇒ 原始输出：
//     `[vitest-pool]: Timeout terminating forks worker for test files …/backend-spawn.test.ts`
//   ⇒ 本文件所在的 `Vitest (1/2)`（**main 的必需 context**）必被 CI 上限杀掉：
//     实测 17 个用例 **13.97s 全过**，然后永久挂住 ⇒ 整个非 docs-only PR 永久 blocked。
// 修法（**单点**，不动 20+ 处调用点）: `createRequire` 走 Node 模块缓存 ⇒
//   在模块顶层给导出的 `ensureBackend` 套一层登记器，此后所有测试里
//   `const { ensureBackend } = require_(backendSpawnPath)` 取到的都是被套过的那一份；
//   `afterEach` 统一 SIGKILL 全部已登记 pid（幂等：已退出 ⇒ ESRCH ⇒ 忽略）。
// 判别性: 去掉本块 ⇒ `npx vitest run tests/electron/backend-spawn.test.ts` **不再自行退出**
//   （实测修前挂死 >120s）；保留 ⇒ 正常退出。
const _spawnMod = require_(backendSpawnPath) as {
  ensureBackend: (...a: unknown[]) => Promise<{ pid?: number; stop?: () => void } & Record<string, unknown>>;
};
const _spawnedPids: number[] = [];
{
  const _origEnsure = _spawnMod.ensureBackend;
  _spawnMod.ensureBackend = async (...args: unknown[]) => {
    const r = await _origEnsure(...args);
    if (typeof r?.pid === 'number' && r.pid > 0) _spawnedPids.push(r.pid);
    return r;
  };
}

/** 起一个假后端：healthServer 立即 200；delayServer 探活 N 次后转 200（模拟慢启动） */
function startFakeServer(delayOkMs = 0): Promise<{ server: http.Server; port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end('{"status":"healthy"}');
    });
    const start = Date.now();
    // 模拟慢启动：前 delayOkMs 返回 503
    const handler = server.listeners('request')[0] as (...args: unknown[]) => void;
    server.removeListener('request', handler);
    server.on('request', (_req: http.IncomingMessage, res: http.ServerResponse) => {
      if (delayOkMs > 0 && Date.now() - start < delayOkMs) {
        res.statusCode = 503;
        res.end('starting');
      } else {
        res.statusCode = 200;
        res.end('{"status":"healthy"}');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** 探活辅助：等 url 可达或超时 */
async function waitProbe(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/healthz`);
      if (res.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const handles: Array<() => void> = [];
afterEach(() => {
  for (const h of handles.splice(0)) {
    try { h(); } catch { /* cleanup best-effort */ }
  }
  // W1d/D1164: 兜底回收残留的**子进程**与**测试用 HTTP server**。
  // 依据（实测，非推断）: 在 worker 退出前打印 `process._getActiveHandles()` 得到
  //   `[Pipe,Socket,Socket,ChildProcess,ChildProcess,Server,Socket]`
  //   ⇒ afterEach 跑完后**仍有 2 个子进程 + 1 个 server 存活**；它们持有的句柄让 vitest
  //     的 forks worker 退不出去 ⇒ `[vitest-pool]: Timeout terminating forks worker`
  //   ⇒ 本文件所在的 `Vitest (1/2)`（**main 的必需 context**）被 CI 上限杀掉
  //     （实测：17 个用例 14.03s 全过，然后永久挂住）。
  // 为什么按 handle 类型扫、而不是按已登记的 pid: 本文件既有经 `ensureBackend` 的 spawn，
  //   也有直接用 `spawn`（D522 进程树用例）与"桩里再 spawn 孙进程"的形态 —— 逐个登记必然漏。
  //   按类型一次扫全，是**单点**的写法。
  //   🔴 D1170 追账（独立复核实验④ 实测）: **并非不漏** —— `kind==='ChildProcess'` 只覆盖
  //     **直接子进程**；桩里再 spawn 孙进程那种形态的**孙进程不在本扫描半径内**
  //     （实测: PR 扫描后 直接子进程存活=false / 孙进程存活=**true**；补 `process.kill(-pid)` 组杀后才 false）。
  //     产品自己的回收契约用的是**进程组**（`electron/backend-spawn.cjs:106` `process.kill(-pid, sig)`），
  //     ⇒ 本兜底原先比产品契约更弱。现改为「先组杀、失败再单杀」以对齐。
  //   ⚠️ 安全性态: 本段误杀半径依赖 vitest 的 pool/isolate **默认值**（`vitest.config.ts` 未显式钉）；
  //     若将来设 isolate:false / singleFork:true，本段会变成**跨测试文件的全局 kill** ⇒ 那时必须改。
  // 只动 ChildProcess / Server 两类；不动 Pipe（那是 worker 与 pool 的 IPC，动它会自伤）。
  // `_getActiveHandles` 属 Node 内部 API —— 此处刻意使用，理由：它是唯一能枚举"未被引用计数
  //   覆盖的残留句柄"的手段，而本用例的目的正是**清理自己造出来的残留**。
  for (const pid of _spawnedPids.splice(0)) {
    // 先按**进程组**杀（与产品契约 electron/backend-spawn.cjs:106 一致；detached 子进程是组长），
    // 失败再退回单 pid（非组长会 EPERM/ESRCH）。两步都失败 ⇒ 已退出。
    try { process.kill(-pid, 'SIGKILL'); }
    catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出（ESRCH） */ } }
  }
  const _P = process as unknown as { _getActiveHandles?: () => unknown[] };
  for (const h of _P._getActiveHandles?.() ?? []) {
    const c = h as { kill?: (s?: string) => void; close?: () => void; constructor?: { name?: string } };
    const kind = c?.constructor?.name;
    if (kind === 'ChildProcess') {
      // 只覆盖直接子进程（孙进程见上方追账注）；组杀优先、单杀兜底
      const pidOf = (c as { pid?: number }).pid;
      try { if (typeof pidOf === 'number' && pidOf > 0) process.kill(-pidOf, 'SIGKILL'); else c.kill?.('SIGKILL'); }
      catch { try { c.kill?.('SIGKILL'); } catch { /* 已退出 */ } }
    }
    else if (kind === 'Server') { try { c.close?.(); } catch { /* 已关闭 */ } }
  }
});

describe('ensureBackend — 契约三路径', () => {
  it('reused：探活成功（已有健康服务）→ 不 spawn，{ started: false, reused: true }', async () => {
    const fake = await startFakeServer();
    handles.push(() => fake.close());
    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'dev',
      // 指向一个"永远不会被走到"的启动命令（reused 路径不 spawn）
      command: { bin: 'definitely-not-a-real-binary', args: ['--x'] },
    });

    expect(result.started).toBe(false);
    expect(result.reused).toBe(true);
    expect(result.degraded).toBeFalsy();
  }, 20000);

  it('started：探活失败 → spawn 探活服务 → 探活成功 → { started: true, pid }', async () => {
    // 目标端口：先起一个"慢启动"服务（占住端口，前 1.5s 返回 503）
    const fake = await startFakeServer(1500);
    handles.push(() => fake.close());

    // spawn 的"后端"= 一个 node 脚本，仅 sleep 保持存活（探活由上面的慢启动服务响应）
    const stub = path.join(os.tmpdir(), `d504-stub-${Date.now()}.cjs`);
    fs.writeFileSync(stub, 'setInterval(() => {}, 10000);\n');
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ started: boolean; pid?: number; reused?: boolean; degraded?: boolean; stop?: () => void }>;
    };

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'prod', // prod 分支但 command 显式覆盖（测试注入）
      command: { bin: process.execPath, args: [stub] },
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
    });

    expect(result.started).toBe(true);
    expect(typeof result.pid).toBe('number');
    expect(result.degraded).toBeFalsy();

    // 生命周期：stop() 回收子进程（无孤儿）
    result.stop?.();
    await new Promise((r) => setTimeout(r, 300));
  }, 40000);

  it('降级：spawn 后探活始终失败 → 重启 ≤maxRestarts → { degraded: true, error }（不静默，铁律 24/31）', async () => {
    // 占一个端口但永不健康：起一个总 503 的服务
    const always503 = http.createServer((_req, res) => { res.statusCode = 503; res.end('down'); });
    await new Promise<void>((r) => always503.listen(0, '127.0.0.1', r));
    handles.push(() => new Promise<void>((r) => always503.close(() => r())));
    const port = (always503.address() as { port: number }).port;

    const stub = path.join(os.tmpdir(), `d504-stub2-${Date.now()}.cjs`);
    fs.writeFileSync(stub, 'setInterval(() => {}, 10000);\n');
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<Record<string, unknown> & { stop?: () => void }>;
    };

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: process.execPath, args: [stub] },
      maxRestarts: 2,
      probeTimeoutMs: 800,   // 每轮探活窗口 0.8s
      pollIntervalMs: 200,
    });

    expect(result.degraded).toBe(true);
    expect(typeof result.error).toBe('string');
    result.stop?.();
  }, 40000);

  it('异常捕获：spawn ENOENT（后端不存在）→ { degraded: true } 不抛', async () => {
    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    // 空闲端口（探活必失败）
    const free = http.createServer();
    await new Promise<void>((r) => free.listen(0, '127.0.0.1', r));
    const port = (free.address() as { port: number }).port;
    await new Promise<void>((r) => free.close(() => r()));

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: 'no-such-backend-binary', args: [] },
      maxRestarts: 1,
      probeTimeoutMs: 500,
      pollIntervalMs: 100,
    });

    expect(result.degraded).toBe(true);
  }, 30000);
});

describe('ensureBackend — env 与命令契约（DS8 双模式）', () => {
  it('prod 模式默认命令 node dist/index.js 且 env 注入 SYNOVA_DB_PATH（断言 spawn argv/env）', async () => {
    // 捕获 spawn 参数：用一个假 server 立即 200 会导致 reused——所以捕获法：
    // 起慢启动服务（1.2s 后 200），让 ensureBackend 走 spawn 路径，stub 记录 env 到文件
    const fake = await startFakeServer(1200);
    handles.push(() => fake.close());

    const envLog = path.join(os.tmpdir(), `d504-env-${Date.now()}.json`);
    const stub = path.join(os.tmpdir(), `d504-stub3-${Date.now()}.cjs`);
    fs.writeFileSync(stub, `require('fs').writeFileSync(${JSON.stringify(envLog)}, JSON.stringify({ argv: process.argv.slice(1), db: process.env.SYNOVA_DB_PATH || null }));\nsetInterval(() => {}, 10000);\n`);
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } try { fs.unlinkSync(envLog); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ stop?: () => void } & Record<string, unknown>>;
    };

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'prod',
      dbPath: '/tmp/userdata/data/synova.db',
      command: { bin: process.execPath, args: [stub] }, // 覆盖命令（默认命令在本机无 dist 会 ENOENT）
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
    });

    expect(result.degraded).toBeFalsy();
    // env 注入断言：stub 收到 SYNOVA_DB_PATH
    await new Promise((r) => setTimeout(r, 400));
    const recorded = JSON.parse(fs.readFileSync(envLog, 'utf-8')) as { argv: string[]; db: string | null };
    expect(recorded.db).toBe('/tmp/userdata/data/synova.db');
    result.stop?.();
    await new Promise((r) => setTimeout(r, 300));
  }, 40000);

  it('dev 模式默认命令 = npx tsx src/index.ts（模块导出 buildCommand 纯函数，可直测）', () => {
    const { buildCommand } = require_(backendSpawnPath) as {
      buildCommand: (mode: string, opts?: Record<string, unknown>) => { bin: string; args: string[] };
    };
    const dev = buildCommand('dev');
    expect(dev.bin).toBe('npx');
    expect(dev.args).toEqual(['tsx', 'src/index.ts']);
    const prod = buildCommand('prod');
    // D518 prod 运行时: 包内 Electron 二进制（node 模式）跑 esbuild 单文件 bundle
    expect(prod.bin).toBe(process.execPath);
    expect(prod.args).toEqual(['dist/backend.mjs']);
  });

  // ═══ D518 新增: F4 注释漂移回归（K3 D504 审计 F4——注释与磁盘事实不一致）═══
  it('F4 回归: electron/*.cjs 注释零裸 dist/index.js 残留（P0-1 后 prod 契约 = dist/backend.mjs）', () => {
    const electronDir = path.join(ROOT, 'electron');
    const files = fs.readdirSync(electronDir).filter((f) => f.endsWith('.cjs'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = fs.readFileSync(path.join(electronDir, f), 'utf-8');
      // 匹配未被 "src/" 前缀修饰的 dist/index.js（注释或代码——一律禁）
      const stale = src.match(/(?<!src\/)dist\/index\.js/g) ?? [];
      expect(stale, `${f} 存在 F4 注释漂移残留: ${stale.join(', ')}`).toHaveLength(0);
    }
  });

  it('D518 回归: main.cjs 启动首行含 boot mode 显式日志（模式显式化——日志即证据）', () => {
    const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf-8');
    expect(main).toMatch(/\[electron\] boot mode=/);
    expect(main).toMatch(/isProdBoot \? 'prod' : 'dev'/);
  });

  // D584 平台豁免登记: POSIX SIGTERM 语义物理断言，win32 走 taskkill 分支（非删除）
  it.skipIf(process.platform === 'win32')('stop() 生命周期：started 后 stop → 子进程退出（无孤儿，DS 契约 lifecycle）', async () => {
    const stub = path.join(os.tmpdir(), `d504-stub4-${Date.now()}.cjs`);
    fs.writeFileSync(stub, 'process.on(\"SIGTERM\", () => process.exit(0));\nsetInterval(() => {}, 10000);\n');
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ pid?: number; stop?: () => void; child?: { killed: boolean; exitCode: number | null } } & Record<string, unknown>>;
    };

    const fake = await startFakeServer(600);
    handles.push(() => fake.close());

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: process.execPath, args: [stub] },
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
    });

    const pid = result.pid;
    expect(typeof pid).toBe('number');
    result.stop?.();

    // 等子进程退出并验证（SIGTERM handler 立即 exit）
    await new Promise((r) => setTimeout(r, 600));
    // 验证无孤儿：进程应已退出（kill(pid,0) 抛 ESRCH）
    let alive = true;
    try { process.kill(pid as number, 0); } catch (err) { console.warn('[test] 子进程已退出（ESRCH 预期）:', err instanceof Error ? err.message : String(err)); alive = false; }
    expect(alive).toBe(false);
  }, 40000);
});

/**
 * D522 teardown 契约（铁律 47，先于实现定义 — dev doc §7）:
 *   stop():
 *     POSIX: signalTree(pid, 'SIGTERM') → graceMs 后 signalTree(pid, 'SIGKILL')
 *     Win:   taskkillProcessTree(pid)（taskkill /T /F）
 *     幂等（child.killed / pid≤0 短路，重复调用无副作用）
 *     taskkill 失败 → log.warn + 继续（不抛不静默，铁律 11/24）
 *   物理断言: kill(pid, 0) 抛 ESRCH = 进程已死（非 grep 冒充——D510 F1）
 */
describe('D522 teardown — stop() 进程树回收契约', () => {
  /** 物理断言辅助: pid 已死（kill(pid,0) 抛 ESRCH/EPERM 以外错误） */
  const assertDead = (pid: number) => {
    let alive = true;
    // 探活探针：ESRCH = 进程已死 —— 这里的"吞"是**预期控制流**，不是静默降级（铁律 24/31 的例外语义）
    try { process.kill(pid, 0); } catch { alive = false; /* 预期：ESRCH ⇒ 进程已死 */ }
    expect(alive, `pid ${pid} 应已死（kill(pid,0) 应抛 ESRCH）`).toBe(false);
  };

  /** 等待 pid 死亡（轮询，最长 maxMs） */
  const waitDead = async (pid: number, maxMs: number): Promise<boolean> => {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      // 同上：ESRCH 是探针的"真值"，非异常路径
      try { process.kill(pid, 0); } catch { return true; /* 预期：ESRCH ⇒ 已死 */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  // D584 平台豁免登记: kill(pid,0) ESRCH 探活 + SIGTERM 递送为 POSIX 语义
  it.skipIf(process.platform === 'win32')('正常路径：stop() → SIGTERM → 子进程 pid 已死（kill(pid,0) 抛 ESRCH，物理断言非 grep）', async () => {
    const stub = path.join(os.tmpdir(), `d522-term-${Date.now()}.cjs`);
    fs.writeFileSync(stub, 'process.on("SIGTERM", () => process.exit(0));\nsetInterval(() => {}, 10000);\n');
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ pid?: number; stop?: () => void } & Record<string, unknown>>;
    };
    const fake = await startFakeServer(600);
    handles.push(() => fake.close());

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: process.execPath, args: [stub] },
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
    });

    const pid = result.pid as number;
    expect(typeof pid).toBe('number');
    result.stop?.();
    expect(await waitDead(pid, 5000)).toBe(true);
    assertDead(pid);
  }, 40000);

  // D584 平台豁免登记: 同上，POSIX 进程树回收物理路径
  it.skipIf(process.platform === 'win32')('边界：stop() 幂等——连续两次调用不抛、无二次副作用', async () => {
    const stub = path.join(os.tmpdir(), `d522-idem-${Date.now()}.cjs`);
    fs.writeFileSync(stub, 'process.on("SIGTERM", () => process.exit(0));\nsetInterval(() => {}, 10000);\n');
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ pid?: number; stop?: () => void } & Record<string, unknown>>;
    };
    const fake = await startFakeServer(600);
    handles.push(() => fake.close());

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: process.execPath, args: [stub] },
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
    });

    const pid = result.pid as number;
    expect(() => result.stop?.()).not.toThrow();
    expect(await waitDead(pid, 5000)).toBe(true);
    // 第二次 stop：pid 已死，幂等短路——不抛（POSIX 对已死 pid kill 会 ESRCH，必须被吞）
    expect(() => result.stop?.()).not.toThrow();
    assertDead(pid);
  }, 40000);

  it('升级路径：子进程忽略 SIGTERM → graceMs 后 SIGKILL 杀死（物理断言）', async () => {
    const stub = path.join(os.tmpdir(), `d522-sigkill-${Date.now()}.cjs`);
    fs.writeFileSync(stub, 'process.on("SIGTERM", () => {});\nsetInterval(() => {}, 1000);\n');
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ pid?: number; stop?: () => void } & Record<string, unknown>>;
    };
    const fake = await startFakeServer(600);
    handles.push(() => fake.close());

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: process.execPath, args: [stub] },
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
      graceMs: 500, // 测试缩短优雅窗口
    });

    const pid = result.pid as number;
    result.stop?.();
    // SIGTERM 被忽略——graceMs 后 SIGKILL 升级必须杀死
    expect(await waitDead(pid, 5000)).toBe(true);
    assertDead(pid);
  }, 40000);

  it('进程组：spawn detached 后孙进程也被回收（无孤儿，DS3）', async () => {
    const gcPidFile = path.join(os.tmpdir(), `d522-gc-${Date.now()}.pid`);
    const stub = path.join(os.tmpdir(), `d522-group-${Date.now()}.cjs`);
    fs.writeFileSync(stub, `const g = require('child_process').spawn('sleep', ['60'], { stdio: 'ignore' });\nrequire('fs').writeFileSync(${JSON.stringify(gcPidFile)}, String(g.pid));\nsetInterval(() => {}, 1000);\n`);
    handles.push(() => {
      try { fs.unlinkSync(stub); } catch { /* gone */ }
      try { fs.unlinkSync(gcPidFile); } catch { /* gone */ }
    });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ pid?: number; stop?: () => void } & Record<string, unknown>>;
    };
    const fake = await startFakeServer(600);
    handles.push(() => fake.close());

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: process.execPath, args: [stub] },
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
      graceMs: 500,
    });

    const pid = result.pid as number;
    // 等 stub 写出孙进程 pid
    let gcPid = 0;
    for (let i = 0; i < 50; i += 1) {
      try { gcPid = parseInt(fs.readFileSync(gcPidFile, 'utf-8'), 10); if (gcPid > 0) break; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(gcPid).toBeGreaterThan(0);
    process.kill(gcPid, 0); // 孙进程确实活着（前置物理断言）

    result.stop?.();
    expect(await waitDead(pid, 5000)).toBe(true);
    // 孙进程必须也被进程组信号回收（kill(-pgid)）——无孤儿
    expect(await waitDead(gcPid, 5000)).toBe(true);
    assertDead(gcPid);
  }, 40000);

  it('降级：Win taskkill 失败（注入抛错的 taskkill runner）→ 不抛 + 继续（幂等，铁律 11/24）', () => {
    const { signalTree, taskkillProcessTree } = require_(backendSpawnPath) as {
      signalTree: (platform: string, pid: number, sig: NodeJS.Signals, child: { kill: (s: NodeJS.Signals) => void } | null, taskkill?: (pid: number) => void) => void;
      taskkillProcessTree: (pid: number, taskkill?: (pid: number) => void) => void;
    };
    const boom = (_pid: number): void => { throw new Error('taskkill binary missing'); };
    // taskkillProcessTree 捕获 + console.warn（不静默）
    expect(() => taskkillProcessTree(4321, boom)).not.toThrow();
    // signalTree win32 分支传导: 同样不抛
    expect(() => signalTree('win32', 4321, 'SIGTERM', null, boom)).not.toThrow();
  });

  it('边界：pid≤0 / child.killed → stop no-op 不抛', () => {
    const { signalTree, taskkillProcessTree } = require_(backendSpawnPath) as {
      signalTree: (platform: string, pid: number, sig: NodeJS.Signals, child: { kill: (s: NodeJS.Signals) => void } | null, taskkill?: (pid: number) => void) => void;
      taskkillProcessTree: (pid: number, taskkill?: (pid: number) => void) => void;
    };
    let taskkillCalled = false;
    const spy = (): void => { taskkillCalled = true; };
    expect(() => signalTree('win32', 0, 'SIGTERM', null, spy)).not.toThrow();
    expect(() => signalTree('linux', -1, 'SIGTERM', null, spy)).not.toThrow();
    expect(() => taskkillProcessTree(0, spy)).not.toThrow();
    expect(taskkillCalled).toBe(false); // pid≤0 全部 no-op
  });

  it('五段链路集成：慢启动假后端 → started+pid → stop() → 假后端进程已死（L2a 全链）', async () => {
    // spawn 的"后端"自己起 healthz（先 503 后 200）——真实五段链路，探活对象即 spawn 的进程
    const port = 39000 + (Date.now() % 1000);
    const stub = path.join(os.tmpdir(), `d522-full-${Date.now()}.cjs`);
    fs.writeFileSync(stub, `const http = require('http');\nconst t0 = Date.now();\nhttp.createServer((q, s) => {\n  if (Date.now() - t0 < 800) { s.statusCode = 503; s.end('starting'); return; }\n  s.statusCode = 200; s.end('{"status":"healthy"}');\n}).listen(${port}, '127.0.0.1');\n`);
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ started: boolean; pid?: number; reused?: boolean; degraded?: boolean; stop?: () => void } & Record<string, unknown>>;
    };

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: process.execPath, args: [stub] },
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
      graceMs: 500,
    });

    expect(result.started).toBe(true);
    expect(result.reused).toBeFalsy();
    expect(result.degraded).toBeFalsy();
    const pid = result.pid as number;

    result.stop?.();
    expect(await waitDead(pid, 5000)).toBe(true);
    assertDead(pid); // 五段链路终点: stop 回收，无孤儿
  }, 40000);
});

describe('ensureBackend — 日志契约（降级可见，铁律 11/24）', () => {
  it('logFile：spawn 后 stdout/stderr 写入日志文件', async () => {
    const fake = await startFakeServer(1000);
    handles.push(() => fake.close());
    const logFile = path.join(os.tmpdir(), `d504-backend-${Date.now()}.log`);
    handles.push(() => { try { fs.unlinkSync(logFile); } catch { /* gone */ } });

    const stub = path.join(os.tmpdir(), `d504-stub5-${Date.now()}.cjs`);
    fs.writeFileSync(stub, 'console.log(\"backend-up-line\");\nsetInterval(() => {}, 10000);\n');
    handles.push(() => { try { fs.unlinkSync(stub); } catch { /* gone */ } });

    const { ensureBackend } = require_(backendSpawnPath) as {
      ensureBackend: (o: Record<string, unknown>) => Promise<{ stop?: () => void } & Record<string, unknown>>;
    };

    const result = await ensureBackend({
      serverUrl: `http://127.0.0.1:${fake.port}`,
      cwd: process.cwd(),
      mode: 'prod',
      command: { bin: process.execPath, args: [stub] },
      logFile,
      probeTimeoutMs: 30000,
      pollIntervalMs: 200,
    });

    expect(result.degraded).toBeFalsy();
    result.stop?.();
    await new Promise((r) => setTimeout(r, 400));

    const logContent = fs.readFileSync(logFile, 'utf-8');
    expect(logContent).toContain('backend-up-line');
  }, 40000);
});
