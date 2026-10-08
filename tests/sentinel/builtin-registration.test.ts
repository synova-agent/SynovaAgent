/**
 * tests/sentinel/builtin-registration.test.ts — #1463 B3 + B7 判据交付物（批次: 第1批-补齐）
 *
 * 判据源: GitHub #1463 §判据 V1/V2/V3
 *   V1 4 个 builtin 注册成功率 4/4（Windows 腿 or 等价实证，须写明等价性）
 *   V2 重复注册日志「覆盖」→「跳过(幂等)」计数对照
 *   V3 改坏即红各一（B3 一条、B7 一条）
 *
 * ═══ B3（P1·Windows）: 内置哨兵注册失败 "Received protocol 'd:'" ═══
 *   缺陷机理（等价实证，见下方 describe('B3 等价实证') 注释）：
 *   旧实现 `join(adaptersDir, filename).replace(/\\/g, '/')` 在 Windows 下产出
 *   `D:/proj/.../cash-flow-sentinel.ts` ⇒ WHATWG URL 把 `D:` 解析为**协议头** ⇒
 *   Node ESM loader 拒绝 ⇒ 4 个内置适配器全部注册失败。
 *   macOS/Linux 的 adaptersDir 以 `/` 开头（无 scheme）⇒ 旧实现**偶然可用** ⇒ 仅 Windows 腿可见。
 *
 * ═══ B7（P3）: 同 id 重复注册 = 覆盖旧实例（registry.ts 旧 warn 措辞） ═══
 *   生产实测根因：registerLoadedSentinels() 有**两个**调用点
 *   （src/init/file-driven-loaders.ts、src/deploy/bootstrap.ts），同一批 45 个文件驱动哨兵
 *   被登记两次 ⇒ 45 次「覆盖」。改为**显式跳过 + 计数**（幂等，首登实例保留）。
 *
 * 运行: npx vitest run tests/sentinel/builtin-registration.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, win32 as win32Path } from 'path';
import { fileURLToPath } from 'url';

import { getSentinelRegistry, destroySentinelRegistry, SentinelRegistryImpl } from '../../src/sentinel/registry';
import { registerBuiltinSentinels, toImportSpecifier } from '../../src/sentinel/builtins';
import { registerLoadedSentinels, clearSentinelCache } from '../../src/sentinel/sentinel-loader';
import type { Sentinel, SentinelConfig, SentinelCheckResult, SentinelContext } from '../../src/sentinel/types';

// ═══ Test Helpers ═══

function makeConfig(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
  return {
    id: 'test-sentinel',
    name: '测试哨兵',
    description: '单元测试用哨兵',
    category: 'health',
    priority: 'P1',
    mode: 'cron',
    cron: '0 */6 * * *',
    requiredDataSources: [],
    confidenceModel: 'deterministic',
    version: '1.0.0',
    ...overrides,
  };
}

function makeSentinel(overrides: Partial<SentinelConfig> = {}): Sentinel {
  const config = makeConfig(overrides);
  return {
    config,
    async check(_ctx: SentinelContext): Promise<SentinelCheckResult> {
      return { sentinelId: config.id, ok: true, findings: [], durationMs: 0, checkedAt: new Date().toISOString() };
    },
  };
}

/** adapters/ 下的 4 个内置适配器（id 与磁盘文件一一对应，#977 已修的导出名不一致面） */
const BUILTIN_ADAPTER_IDS = [
  'sentinel-cash-flow',
  'sentinel-cpc',
  'sentinel-goal-alignment',
  'sentinel-integration-health',
];

const ADAPTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'sentinel', 'adapters');

/** 与 builtins.ts 的磁盘扫描口径逐字一致（同一 filter，同一目录） */
function adapterFiles(): string[] {
  return readdirSync(ADAPTERS_DIR).filter(f => f.endsWith('-sentinel.ts') || f.endsWith('-sentinel.js'));
}

// ═══ V1: 4 个 builtin 注册成功率 4/4 ═══

describe('#1463 V1: registerBuiltinSentinels 4/4', () => {
  beforeEach(() => {
    destroySentinelRegistry();
  });

  it('V1-a 磁盘扫描数 = 注册数 = 4，且 4 个内置 id 全部在场', async () => {
    const files = adapterFiles();
    expect(files).toHaveLength(4);          // 目录空了本身就是坏点

    await registerBuiltinSentinels();
    const ids = getSentinelRegistry().list().map(s => s.config.id);

    expect(ids).toHaveLength(files.length); // 发现 N 个文件就必须注册上 N 个（漏一个即红）
    for (const expected of BUILTIN_ADAPTER_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it('V1-b toImportSpecifier(真实 adapters 路径) 产出可被 await import() 消费的说明符（L2 真跑通）', async () => {
    const spec = toImportSpecifier(join(ADAPTERS_DIR, 'cash-flow-sentinel.ts'));
    expect(new URL(spec).protocol).toBe('file:');

    const mod = await import(/* @vite-ignore */ spec) as { cashFlowSentinel?: Sentinel };
    expect(typeof mod.cashFlowSentinel?.check).toBe('function');
  });
});

// ═══ V1 等价实证（B3·Windows 腿的等价替身） ═══
//
// 等价性论证（本机 macOS，无 Windows 腿；判例 V-09：未核项必须显式列出）：
//
//   ① 缺陷机理 = 说明符的 **scheme** 被 URL 解析器识别。同一字符串在任何平台上解析结果相同
//      （WHATWG URL 是平台无关的），所以「Windows 形态输入 → 产出 d: 协议 → loader 拒绝」
//      这条因果链**可在 macOS 上逐字重现**（下面 V1-c 断言的就是卡面报错原文）。
//   ② 唯一的平台相关输入 = adaptersDir 的原生路径形态：POSIX `/…`（无 scheme，旧实现偶然可用）
//      vs Windows `D:\…`（旧实现 ⇒ `D:/…` ⇒ scheme `d:`）。两种形态下面都覆盖到了。
//   ③ 未核（本机不可核）: 真机 Windows 上 `await import('file:///D:/…')` 的端到端成功，
//      含 tsx / 编译产物在 Windows 下的 ESM 解析；`pathToFileURL` 的 win32 分支是 Node 自带实现，
//      本机未执行，仅按其文档化产物形态断言。
describe('#1463 V1 等价实证（B3）: 路径 → ESM 说明符', () => {
  const winAbs = win32Path.join('D:\\proj\\SynovaAgent', 'src', 'sentinel', 'adapters', 'cash-flow-sentinel.ts');
  const posixAbs = join('/Users/wane/SynovaAgent', 'src', 'sentinel', 'adapters', 'cash-flow-sentinel.ts');

  it('V1-c 旧实现（反斜杠替换）在 Windows 盘符形态下产出 d: 协议，Node ESM loader 拒绝 —— 卡面报错原文重现', () => {
    const legacySpecifier = winAbs.replace(/\\/g, '/');
    expect(legacySpecifier).toBe('D:/proj/SynovaAgent/src/sentinel/adapters/cash-flow-sentinel.ts');
    expect(new URL(legacySpecifier).protocol).toBe('d:');

    // 缺陷面 = Node ESM loader 对 scheme 的拒绝（与卡面 "Received protocol 'd:'" 逐字一致）。
    // ⚠️ 必须起**真 node 进程**跑这次 import：vitest 的 SSR transform 会拦截动态 import 说明符
    //    （实测把 `D:/…` 当本地路径解析 ⇒ ERR_MODULE_NOT_FOUND，掩盖真实 scheme 判定），
    //    而 vitest 的 VM 里 `new Function('return import(s)')` 无 importModuleDynamically 回调。
    //    子进程 = 原生 ESM loader 自己判 scheme —— 即 Windows 上真实发生的那一次判定。
    const probe = `import(${JSON.stringify(legacySpecifier)}).catch(e => {`
      + ` process.stdout.write(String(e.code) + ' | ' + String(e.message).split('\\n')[0]); })`;
    const out = execFileSync(process.execPath, ['-e', probe], { encoding: 'utf-8' });
    expect(out).toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
    expect(out).toContain("Received protocol 'd:'");
  });

  it('V1-d 新实现 toImportSpecifier: POSIX 与 Windows 盘符形态**都**产出 file: 协议', () => {
    for (const abs of [posixAbs, winAbs]) {
      const spec = toImportSpecifier(abs);
      expect(spec.startsWith('file:///')).toBe(true);
      expect(new URL(spec).protocol).toBe('file:');
    }
  });
});

// ═══ V2: 重复注册 = 显式跳过 + 计数（幂等） ═══

describe('#1463 V2: 重复注册 覆盖 → 跳过(幂等)', () => {
  it('V2-a 同 id 二次注册：跳过、旧实例保留、跳过计数 +1', () => {
    const registry = new SentinelRegistryImpl();
    const first = makeSentinel({ id: 'dup', name: 'v1' });
    const second = makeSentinel({ id: 'dup', name: 'v2' });

    registry.register(first);
    expect(registry.count()).toBe(1);
    expect(registry.getDuplicateSkipCount()).toBe(0);

    registry.register(second);          // 修前 = 覆盖（get('dup') === second）
    expect(registry.count()).toBe(1);   // 幂等：数量不增
    expect(registry.get('dup')).toBe(first);
    expect(registry.get('dup')!.config.name).toBe('v1');
    expect(registry.getDuplicateSkipCount()).toBe(1);

    registry.register(makeSentinel({ id: 'dup', name: 'v3' }));
    expect(registry.getDuplicateSkipCount()).toBe(2); // 计数可观测（与修前「覆盖」计数对照）
  });

  it('V2-b 生产路径 registerLoadedSentinels() 连调两次：第二次全部跳过（真实文件驱动哨兵面）', async () => {
    destroySentinelRegistry();
    clearSentinelCache();

    const first = await registerLoadedSentinels();
    const afterFirst = getSentinelRegistry().count();
    expect(first.registered).toBeGreaterThan(0);              // 空面 = 无效证据
    expect(afterFirst).toBe(first.registered);                // 首次零跳过
    expect(getSentinelRegistry().getDuplicateSkipCount()).toBe(0);

    const second = await registerLoadedSentinels();
    expect(second.registered).toBe(first.registered);         // 尝试数不变
    expect(getSentinelRegistry().count()).toBe(afterFirst);   // 幂等：注册面不变
    expect(getSentinelRegistry().getDuplicateSkipCount()).toBe(first.registered); // 每个尝试都被跳过
  });

  it('V2-c 跳过 ≠ 换实例：注册面实例恒等（manifest 注入不因跳过而失效）', async () => {
    destroySentinelRegistry();
    clearSentinelCache();

    await registerLoadedSentinels();
    const before = getSentinelRegistry().list();
    const sample = before[0];
    expect(sample).toBeTruthy();

    await registerLoadedSentinels();
    const after = getSentinelRegistry().list();

    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBe(before[i]);                        // 同一对象（不是被替换成新实例）
    }
  });
});

// ═══ 测试后清理（全局单例 + manifest 缓存，避免污染同文件后续用例） ═══

afterEach(() => {
  destroySentinelRegistry();
  clearSentinelCache();
});
