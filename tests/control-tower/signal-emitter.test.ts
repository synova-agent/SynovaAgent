/**
 * tests/control-tower/signal-emitter.test.ts — D214 共享信号发射器测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SIGNALS_DIR = path.join(process.cwd(), '.codex', 'signals');

describe('emitSignal — 信号发射', () => {
  afterEach(() => {
    // 清理测试文件
    try { fs.rmSync(path.join(SIGNALS_DIR, 'test-write-lock.json'), { force: true }); } catch {}
    try { fs.rmSync(path.join(SIGNALS_DIR, 'test-signal-emitter.json'), { force: true }); } catch {}
  });

  it('发射绿色信号 → 文件存在且格式正确', async () => {
    const { emitSignal } = await import('../../src/control-tower/signal-emitter');
    emitSignal('test-write-lock', 'green', 'all_healthy');

    const filePath = path.join(SIGNALS_DIR, 'test-write-lock.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.component).toBe('test-write-lock');
    expect(content.status).toBe('green');
    expect(content.reason).toBe('all_healthy');
    expect(content.timestamp).toBeTruthy();
    expect(typeof content.p0_count).toBe('number');
  });

  it('发射红色信号含计数', async () => {
    const { emitSignal } = await import('../../src/control-tower/signal-emitter');
    emitSignal('test-signal-emitter', 'red', 'validation_failed', { p0: 2, p1: 3 });

    const filePath = path.join(SIGNALS_DIR, 'test-signal-emitter.json');
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.status).toBe('red');
    expect(content.p0_count).toBe(2);
    expect(content.p1_count).toBe(3);
  });

  it('信号目录自动创建', async () => {
    const { emitSignal } = await import('../../src/control-tower/signal-emitter');
    const testDir = path.join(process.cwd(), '.codex', 'signals');
    // 先删除目录
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    expect(fs.existsSync(testDir)).toBe(false);

    emitSignal('test-write-lock', 'green', 'dir_created');
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it('降级: 不抛异常', async () => {
    const { emitSignal } = await import('../../src/control-tower/signal-emitter');
    // 即使传入无效参数也不应抛异常
    expect(() => emitSignal('', 'green' as any, '')).not.toThrow();
  });
});

describe('D213 parseSignal 兼容性', () => {
  it('emitSignal JSON 格式可被 D213 parseSignal 解析', async () => {
    const { emitSignal } = await import('../../src/control-tower/signal-emitter');
    emitSignal('test-compat', 'yellow', 'signal_test');

    const filePath = path.join(SIGNALS_DIR, 'test-compat.json');
    const text = fs.readFileSync(filePath, 'utf-8');

    // 模拟 D213 parseSignal
    const data = JSON.parse(text);
    expect(data.status).toBe('yellow');
    expect(data.component).toBe('test-compat');
    expect(data.reason).toBe('signal_test');

    fs.rmSync(filePath, { force: true });
  });
});
