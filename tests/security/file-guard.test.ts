/**
 * tests/security/file-guard.test.ts — FileGuard 三层文件安全防御
 *
 * 铁律 0-2: 每个 public 函数 ≥ 2 用例 (happy + sad)
 */
import { describe, it, expect } from 'vitest';
import { FileGuard, type FileDecisionEvent } from '../../src/security/file-guard';
import * as os from 'os';
import * as path from 'path';

const workDir = path.join(os.tmpdir(), 'synova-test');
const homeDir = os.homedir();

describe('FileGuard.canWrite — write deny list', () => {
  const guard = new FileGuard(workDir);

  it('Given work-dir file, When canWrite, Then allowed=true', () => {
    const result = guard.canWrite(path.join(workDir, 'data.json'));
    expect(result.allowed).toBe(true);
  });

  it('Given work-dir itself, When canWrite, Then allowed=true', () => {
    const result = guard.canWrite(workDir);
    expect(result.allowed).toBe(true);
  });

  it('Given temp dir file, When canWrite, Then allowed=true', () => {
    const result = guard.canWrite(path.join(os.tmpdir(), 'test.txt'));
    expect(result.allowed).toBe(true);
  });

  it('Given synova data dir, When canWrite, Then allowed=true', () => {
    const result = guard.canWrite(path.join(homeDir, '.synova-agent', 'data.db'));
    expect(result.allowed).toBe(true);
  });

  it('Given /etc/passwd, When canWrite, Then allowed=false', () => {
    // On Windows, /etc/passwd path resolves to D:\etc\passwd
    // which falls into "不在工作目录内" (cross-boundary protection)
    const result = guard.canWrite('/etc/passwd');
    expect(result.allowed).toBe(false);
  });

  it('Given ~/.ssh/id_rsa, When canWrite, Then allowed=false', () => {
    const result = guard.canWrite(path.join(homeDir, '.ssh', 'id_rsa'));
    expect(result.allowed).toBe(false);
  });

  it('Given path outside workdir (not whitelisted), When canWrite, Then allowed=false', () => {
    const result = guard.canWrite(path.join(homeDir, 'random-file.txt'));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('不在工作目录内');
  });
});

describe('FileGuard.canRead — read deny list', () => {
  const guard = new FileGuard(workDir);

  it('Given normal text file, When canRead, Then allowed=true', () => {
    const result = guard.canRead('/tmp/log.txt');
    expect(result.allowed).toBe(true);
  });

  it('Given .env file, When canRead, Then allowed=false (credential protected)', () => {
    const result = guard.canRead(path.join(workDir, '.env'));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('凭据文件');
  });

  it('Given credentials.json, When canRead, Then allowed=false', () => {
    const result = guard.canRead(path.join(workDir, 'credentials.json'));
    expect(result.allowed).toBe(false);
  });

  it('Given .pem key file, When canRead, Then allowed=false', () => {
    const result = guard.canRead('/etc/ssl/private/key.pem');
    expect(result.allowed).toBe(false);
  });
});

describe('FileGuard.setWorkDir', () => {
  it('Given new workdir, When set then canWrite, Then respects new boundary', () => {
    const guard = new FileGuard('/old');
    const newDir = path.join(os.tmpdir(), 'new-work');
    guard.setWorkDir(newDir);
    const result = guard.canWrite(path.join(newDir, 'file.txt'));
    expect(result.allowed).toBe(true);
  });
});

describe('FileGuard — #1052 onDecision 回调 + workDir 边界', () => {
  // CTO 2026-10-08 要求②：边界三条 = workDir 自身允许 / 其子路径允许 / 其外拒绝
  it('Given workDir 自身, When canWrite, Then allowed=true（边界①）', () => {
    const dir = path.join(os.tmpdir(), 'fg-1052-self');
    const guard = new FileGuard(dir);
    expect(guard.canWrite(dir).allowed).toBe(true);
  });

  it('Given workDir 子路径, When canWrite, Then allowed=true（边界②）', () => {
    const dir = path.join(os.tmpdir(), 'fg-1052-child');
    const guard = new FileGuard(dir);
    expect(guard.canWrite(path.join(dir, 'nested', 'file.json')).allowed).toBe(true);
  });

  it('Given workDir 之外且非白名单, When canWrite, Then allowed=false（边界③）', () => {
    const dir = path.join(os.homedir(), '.synova-1052-outside-probe');
    const guard = new FileGuard(path.join(os.tmpdir(), 'fg-1052-other'));
    const result = guard.canWrite(path.join(dir, 'file.json'));
    expect(result.allowed).toBe(false);
  });

  it('Given onDecision 装配, When 判定, Then 回调收到同一次判定（含 deny 原因）', () => {
    const seen: FileDecisionEvent[] = [];
    const guard = new FileGuard({ workDir: path.join(os.tmpdir(), 'fg-1052-cb'), onDecision: (e) => seen.push(e) });
    const decision = guard.canWrite('/etc/passwd');
    expect(seen.length).toBe(1);
    expect(seen[0].decision).toEqual(decision);
    expect(seen[0].operation).toBe('write');
    expect(decision.allowed).toBe(false);
  });

  it('Given onDecision 抛错, When 判定, Then 决策结果不变且不抛出（铁律 24/31）', () => {
    const guard = new FileGuard({
      workDir: path.join(os.tmpdir(), 'fg-1052-throw'),
      onDecision: () => { throw new Error('审计回调故意失败'); },
    });
    // 拒绝路径：审计失败**不放行**
    const denied = guard.canWrite('/etc/passwd');
    expect(denied.allowed).toBe(false);
    // 允许路径：审计失败**不改判为拒绝**
    const allowed = guard.canWrite(path.join(os.tmpdir(), 'fg-1052-throw', 'ok.txt'));
    expect(allowed.allowed).toBe(true);
  });

  it('Given 旧构造形态（字符串 workDir）, When canWrite, Then 兼容不破（回归）', () => {
    const guard = new FileGuard(path.join(os.tmpdir(), 'fg-1052-legacy'));
    expect(guard.canWrite(path.join(os.tmpdir(), 'fg-1052-legacy', 'a.txt')).allowed).toBe(true);
  });
});
