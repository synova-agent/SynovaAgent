import { createHash } from 'crypto';
import { EnterpriseScanError } from './errors';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new EnterpriseScanError('VALIDATION_ERROR', 'request', '非有限数值不能进入规范化载荷');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== undefined) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new EnterpriseScanError('VALIDATION_ERROR', 'request', '载荷含不可规范化值');
}

export function fingerprint(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256Text(parts.join('\u0000')).slice(0, 32)}`;
}
