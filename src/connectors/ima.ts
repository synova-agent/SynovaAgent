/**
 * src/connectors/ima.ts — Ima 企业知识连接器 (D104)
 *
 * D104 + D105: ImaClient + 加密 → knowledge-agent imaDataSource
 *
 * 铁律 3: ima API 不可用 → degraded, 不阻断诊断管线。
 *
 * 契约:
 *   @input  — ImaConfig (baseUrl/apiKey/enterpriseId)
 *   @output — ImaDocument[] / ExtractedPkbEntry[]
 *   @degraded — ima API 不可用 → log.warn + return empty
 */
import { createLogger } from '@synova/logger';
import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'crypto';

const log = createLogger('connectors/ima');

export interface ImaConfig {
  baseUrl: string;
  apiKey: string;
  enterpriseId: string;
  timeoutMs?: number;
}

export interface ImaDocument {
  id: string;
  title: string;
  type: 'strategy' | 'operations' | 'meetings' | 'other';
  content?: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedPkbEntry {
  text: string;
  sourceType: 'ima_document';
  sourceId: string;
  authorityLevel: 'internal_stored';
  accessLevel: 'team';
  metadata: {
    documentType: string;
    author: string;
    createdAt: string;
    extractedAt: string;
  };
}

export interface DocumentFilter {
  documentTypes?: Array<'strategy' | 'operations' | 'meetings'>;
  limit?: number;
}

// ═══ AES-256-GCM 加密 ═══

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'synova-ima-key-v1';

function deriveKey(secret: string): Buffer {
  return pbkdf2Sync(secret, SALT, 100000, KEY_LENGTH, 'sha256');
}

export function encryptApiKey(apiKey: string, jwtSecret: string): string {
  const key = deriveKey(jwtSecret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptApiKey(ciphertext: string, jwtSecret: string): string {
  try {
    const key = deriveKey(jwtSecret);
    const raw = Buffer.from(ciphertext, 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = raw.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, 'API Key 解密失败');
    throw new Error(`API Key 解密失败: ${msg}`);
  }
}

// ═══ ImaClient ═══

export class ImaClient {
  private config: ImaConfig;
  private accessToken: string | null = null;

  constructor(config: ImaConfig) {
    this.config = { ...config, timeoutMs: config.timeoutMs || 30000 };
  }

  async authenticate(apiKey?: string): Promise<string> {
    const key = apiKey || this.config.apiKey;
    if (!key) { throw new Error('API Key 未配置'); }

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        signal: AbortSignal.timeout(this.config.timeoutMs!),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { accessToken?: string };
      if (!data.accessToken) throw new Error('响应缺少 accessToken');
      this.accessToken = data.accessToken;
      return data.accessToken;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg }, 'ima 认证失败 — 降级');
      throw new Error(`ima 认证失败: ${msg}`);
    }
  }

  async validateToken(apiKey?: string): Promise<boolean> {
    try { await this.authenticate(apiKey); return true; }
    catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "IMA token 校验失败");
      return false;
    }
  }

  async scanDocuments(filter?: DocumentFilter): Promise<ImaDocument[]> {
    try {
      const token = this.accessToken || await this.authenticate().catch(() => { throw new Error('认证失败'); });
      const types = filter?.documentTypes || ['strategy', 'operations', 'meetings'];
      const limit = filter?.limit || 20;
      const response = await fetch(
        `${this.config.baseUrl}/v1/documents?types=${types.join(',')}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(this.config.timeoutMs!) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { documents?: ImaDocument[] };
      // M1b: types 默认值为窄字面量联合，d.type 含 'other' —— 收窄到 string 比较（铁律 38：零 any）。
      return (data.documents || []).filter(d => (types as readonly string[]).includes(d.type));
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'ima 文档扫描失败 — 降级');
      return [];
    }
  }

  async extractContent(documentId: string): Promise<ExtractedPkbEntry | null> {
    try {
      const token = this.accessToken || await this.authenticate().catch(() => { throw new Error('认证失败'); });
      const response = await fetch(`${this.config.baseUrl}/v1/documents/${documentId}/content`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.config.timeoutMs!),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = await response.json() as ImaDocument;
      return {
        text: (doc.content || '').slice(0, 5000),
        sourceType: 'ima_document', sourceId: doc.id,
        authorityLevel: 'internal_stored', accessLevel: 'team',
        metadata: { documentType: doc.type, author: doc.author, createdAt: doc.createdAt, extractedAt: new Date().toISOString() },
      };
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err), documentId }, 'ima 内容提取失败 — 降级');
      return null;
    }
  }

  async checkHealth(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/health`, { signal: AbortSignal.timeout(5000) });
      return response.ok ? { ok: true } : { ok: false, message: `HTTP ${response.status}` };
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "网络请求失败");
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
