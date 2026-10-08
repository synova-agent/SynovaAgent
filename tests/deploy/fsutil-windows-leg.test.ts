/**
 * tests/deploy/fsutil-windows-leg.test.ts — #1454 B5 判据 V5（等价实证）
 *
 * 被验对象：`src/routes/healthz.ts:checkDiskFree` 与 `src/deploy/startup-check.ts:checkDiskSpace`
 * 的 Windows 分支调用形态。
 *
 * 修前形态（origin/main@5a6591c4a 两处同型）：
 *   `execSync(\`fsutil volume diskfree "${drive}"\`)`  ← **经 shell**，drive = `C:\`
 *   ⇒ `"C:\"` 里的尾反斜杠吃掉收尾引号 ⇒ 命令行截断 ⇒ 抛错 ⇒ 被外层 catch 吞成
 *   「磁盘检查异常 / 无法获取磁盘信息」⇒ **Windows 上恒降级**。
 * 修后形态：`execFileSync('fsutil', ['volume', 'diskfree', drive])` ← **不经 shell**。
 *
 * 🔴 等价性论证（本机是 macOS，无 Windows —— 本文件**不声称**跑过 Windows）：
 *   修前的失效机制**完全来自 shell 引号解析层**（cmd.exe/CRT 对 `\"` 的处理），
 *   与 fsutil 本体无关。修后调用链里**不存在**字符串命令行，也不存在引号解析层：
 *   argv 由 Node 直接构造并原样传给 CreateProcess。
 *   故本文件在本机可核的部分是三条**可机器判**的物理事实：
 *     ① 调用的是 `execFileSync`（argv 形态），不是 `execSync`（字符串形态）
 *     ② 传入 argv 的 drive 恰为 `C:\` —— 含尾反斜杠、不含任何引号字符
 *     ③ 在「Windows 分支 + 真实 fsutil 输出形态」下，健康检查/启动检查判 **passed**
 *        （即不再恒降级）—— 用 stub 顶替**外部命令**，不 mock 管线本身
 *   ⇒ 未核部分：真实 Windows 主机上的端到端执行（本文件显式标「未核」）。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import express from 'express';

/** 捕获 execFileSync 的实参（argv 形态证据） */
const cap = vi.hoisted(() => {
  const calls: Array<{ file: string; args: string[]; opts?: Record<string, unknown> }> = [];
  return { calls };
});

/** fsutil 的真实输出形态（50GB；含中文标签与 CRLF，走代码里的 /[:：]\s*(\d+)/ 分支） */
const FSUTIL_OUTPUT = '可用空间: 53687091200 字节\r\n';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: (file: string, args: string[], opts?: Record<string, unknown>) => {
      cap.calls.push({ file, args, opts });
      return Buffer.from(FSUTIL_OUTPUT, 'utf-8');
    },
  };
});

import healthzRoutes from '../../src/routes/healthz';
import { runStartupChecks } from '../../src/deploy/startup-check';

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_ENV = {
  USERPROFILE: process.env.USERPROFILE,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  HOME: process.env.HOME,
  SYNOVA_DATA_DIR: process.env.SYNOVA_DATA_DIR,
};

/** 把 process.platform 拨到 win32（可复原） */
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('#1454 V5 · B5（healthz + startup-check）：Windows 腿调用形态为 argv，且不再恒降级', () => {
  let server: ReturnType<typeof express.application.listen>;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(healthzRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/healthz`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setPlatform(ORIGINAL_PLATFORM);
  });

  afterEach(() => {
    cap.calls.length = 0;
    setPlatform(ORIGINAL_PLATFORM);
    process.env.USERPROFILE = ORIGINAL_ENV.USERPROFILE;
    process.env.LOCALAPPDATA = ORIGINAL_ENV.LOCALAPPDATA;
    process.env.HOME = ORIGINAL_ENV.HOME;
    process.env.SYNOVA_DATA_DIR = ORIGINAL_ENV.SYNOVA_DATA_DIR;
  });

  /** 造出「Windows 分支 + 盘根为 `C:\`」的条件（POSIX 的 path.parse 对 `C:` 开头串 root 为空 ⇒ 走 `|| 'C:\\'` 兜底） */
  function forceWindowsDrive(): void {
    setPlatform('win32');
    process.env.USERPROFILE = 'C:\\Users\\synova-test';
    delete process.env.LOCALAPPDATA;
    process.env.HOME = os.tmpdir(); // 平台分支已切到 win32，HOME 不参与取目录
    process.env.SYNOVA_DATA_DIR = path.join(os.tmpdir(), 'synova-1454-v5');
  }

  it('healthz 磁盘检查：argv 形态 + `C:\\` 原样传入 + 判 ok（修前此处恒 degraded）', async () => {
    forceWindowsDrive();

    const res = await fetch(baseUrl);
    const body = (await res.json()) as { checks: { disk_free_gb: { status: string; detail: string } } };

    // ③ 不再恒降级：真实 fsutil 输出形态下判 ok
    expect(body.checks.disk_free_gb.status).toBe('ok');
    expect(body.checks.disk_free_gb.detail).toContain('50.0GB');

    // ① 调用形态 = execFileSync('fsutil', [argv...])，非 execSync(字符串)
    expect(cap.calls).toHaveLength(1);
    const call = cap.calls[0];
    expect(call.file).toBe('fsutil');

    // ② drive 原样：含尾反斜杠、无引号（修前的 bug 正是引号层引入的）
    expect(call.args).toEqual(['volume', 'diskfree', 'C:\\']);
    expect(call.args[2]).toContain('\\');
    for (const a of call.args) {
      expect(a).not.toContain('"');
      expect(a).not.toContain("'");
    }
    // 不经 shell：未传 shell 选项
    expect(call.opts?.shell).toBeFalsy();
    expect(call.opts?.timeout).toBe(5000);
  });

  it('startup-check 磁盘检查（同型修）：argv 形态 + 判 passed', async () => {
    forceWindowsDrive();

    const result = await runStartupChecks();
    // 结果按三态分桶（passed/failed/warnings）——磁盘检查通过时落 passed[]
    const disk = [...result.passed, ...result.failed, ...result.warnings]
      .find((c) => c.name.includes('磁盘空间'));

    expect(cap.calls.length).toBeGreaterThanOrEqual(1);
    const call = cap.calls[0];
    expect(call.file).toBe('fsutil');
    expect(call.args).toEqual(['volume', 'diskfree', 'C:\\']);
    expect(call.opts?.shell).toBeFalsy();

    expect(disk).toBeDefined();
    expect(disk!.passed).toBe(true);
    expect(disk!.detail).toContain('51200MB'); // 53687091200 B = 51200 MB
  });

  it('非 win32 平台：走 statfs 腿，完全不调用 fsutil（防「测试把 Windows 腿当默认腿」）', async () => {
    setPlatform('darwin');
    process.env.HOME = os.tmpdir();

    const res = await fetch(baseUrl);
    await res.json(); // 触发全部检查

    expect(cap.calls).toHaveLength(0);
  });
});
