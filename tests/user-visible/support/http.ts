import type { Express } from 'express';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';

export interface RunningHttpServer {
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}

export interface HttpResult {
  status: number;
  headers: Headers;
  raw: string;
  body: unknown;
}

export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function listen(app: Express): Promise<RunningHttpServer> {
  const sockets = new Set<Socket>();
  const server = app.listen(0);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind a port');
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function request(
  baseUrl: string,
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const raw = await response.text();
  const body: unknown = response.headers.get('content-type')?.includes('application/json')
    ? JSON.parse(raw)
    : raw;
  return { status: response.status, headers: response.headers, raw, body };
}

export function parseSse(raw: string): SseFrame[] {
  return raw.split(/\r?\n\r?\n/).flatMap((block) => {
    if (!block.includes('data: ')) return [];
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7).trim() ?? '';
    const dataLine = lines.find((line) => line.startsWith('data: '));
    if (!dataLine) return [];
    const parsed: unknown = JSON.parse(dataLine.slice(6));
    if (!isRecord(parsed)) throw new Error(`SSE data is not an object: ${dataLine}`);
    return [{ event, data: parsed }];
  });
}
