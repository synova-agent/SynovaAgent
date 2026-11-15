import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'path';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import { EnterpriseScanError } from './errors';
import type { FileIdentity, PathIdentity, PreflightSource, ScanAuthorization, SourceFormat } from './types';

const MAX_FILE_BYTES = 1024 * 1024;
const FORMATS: Record<string, SourceFormat> = { '.csv': 'csv', '.md': 'md', '.json': 'json' };

function denyPath(message: string): never {
  throw new EnterpriseScanError('UNAUTHORIZED_PATH', 'preflight', message);
}

function identityOf(stat: { dev: bigint; ino: bigint }): FileIdentity {
  if (stat.dev === 0n || stat.ino === 0n) denyPath('当前文件系统不能提供稳定非零文件身份');
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function normalized(path: string): string {
  return resolve(path).toLowerCase();
}

function formatOf(authorization: ScanAuthorization): SourceFormat {
  const actual = FORMATS[extname(authorization.allowedPath).toLowerCase()];
  if (actual === undefined || actual !== authorization.format) {
    throw new EnterpriseScanError('UNSUPPORTED_FORMAT', 'preflight', `不支持的来源格式: ${basename(authorization.allowedPath)}`);
  }
  return actual;
}

function inspectChain(root: string, candidate: string): PathIdentity[] {
  const chain: PathIdentity[] = [];
  const rootStat = lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) denyPath('授权根不是真实目录');
  chain.push({ path: root, ...identityOf(rootStat) });
  const rel = relative(root, candidate);
  let current = root;
  const parts = rel.split(sep).filter(part => part.length > 0);
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = resolve(current, parts[index]);
    const stat = lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) denyPath('来源路径含符号链接、junction 或非目录段');
    chain.push({ path: current, ...identityOf(stat) });
  }
  return chain;
}

function lexicalAuthorize(authorization: ScanAuthorization): { root: string; candidate: string; chain: PathIdentity[] } {
  if (!isAbsolute(authorization.canonicalRoot) || !isAbsolute(authorization.allowedPath)) denyPath('授权根和 allowed_path 必须为绝对路径');
  if (authorization.allowedPath.split(/[\\/]/).includes('..')) denyPath('allowed_path 禁止包含 ..');
  const root = resolve(authorization.canonicalRoot);
  const candidate = resolve(authorization.allowedPath);
  const rel = relative(root, candidate);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) denyPath('来源不在授权根内');
  const chain = inspectChain(root, candidate);
  const canonicalRoot = realpathSync(root);
  if (normalized(canonicalRoot) !== normalized(root)) denyPath('授权根本身是链接或发生规范化变化');
  const canonicalPath = realpathSync(candidate);
  if (normalized(canonicalPath) !== normalized(candidate)) denyPath('来源路径含链接或目录逃逸');
  return { root, candidate: canonicalPath, chain };
}

function readDescriptor(path: string): {
  identity: FileIdentity;
  sha256: string;
  size: number;
  mtimeMs: number;
  content: string;
} {
  const fd = openSync(path, 'r');
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) denyPath('来源不是普通只读文件');
    const identity = identityOf(before);
    if (before.size > BigInt(MAX_FILE_BYTES)) {
      throw new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'preflight', '单文件超过 1MiB');
    }
    const size = Number(before.size);
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const read = readSync(fd, buffer, offset, size - offset, offset);
      if (read === 0) throw new EnterpriseScanError('FILE_CHANGED_BEFORE_COMMIT', 'preflight', '描述符读取提前结束');
      offset += read;
    }
    const after = fstatSync(fd, { bigint: true });
    if (!sameIdentity(identity, identityOf(after)) || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new EnterpriseScanError('FILE_CHANGED_BEFORE_COMMIT', 'preflight', '读取期间文件身份或元数据变化');
    }
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'preflight', '来源不是有效 UTF-8');
    }
    return {
      identity,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      size,
      mtimeMs: Number(before.mtimeMs),
      content,
    };
  } finally {
    closeSync(fd);
  }
}

export function inspectAuthorizedSource(authorization: ScanAuthorization): PreflightSource {
  formatOf(authorization);
  let lexical: ReturnType<typeof lexicalAuthorize>;
  try {
    lexical = lexicalAuthorize(authorization);
  } catch (error) {
    if (error instanceof EnterpriseScanError) throw error;
    denyPath(error instanceof Error ? error.message : String(error));
  }
  const descriptor = readDescriptor(lexical.candidate);
  return {
    authorization,
    canonicalPath: lexical.candidate,
    identity: descriptor.identity,
    pathChain: lexical.chain,
    sha256: descriptor.sha256,
    size: descriptor.size,
    mtimeMs: descriptor.mtimeMs,
    content: descriptor.content,
  };
}

export function recheckAuthorizedSource(before: PreflightSource): void {
  const after = inspectAuthorizedSource(before.authorization);
  const sameChain = before.pathChain.length === after.pathChain.length
    && before.pathChain.every((entry, index) => {
      const other = after.pathChain[index];
      return normalized(entry.path) === normalized(other.path) && sameIdentity(entry, other);
    });
  if (
    normalized(before.canonicalPath) !== normalized(after.canonicalPath)
    || !sameIdentity(before.identity, after.identity)
    || !sameChain
    || before.sha256 !== after.sha256
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
  ) {
    throw new EnterpriseScanError('FILE_CHANGED_BEFORE_COMMIT', 'transaction', '提交前来源身份、路径、授权或内容发生变化');
  }
}

export function authorizedFileName(authorization: ScanAuthorization): string {
  return basename(authorization.allowedPath);
}

export function authorizedDirectory(authorization: ScanAuthorization): string {
  return dirname(authorization.allowedPath);
}
