import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import { isRecord } from './http';

export const UV04_REPLY = 'UV04 真实流式回复：先确认现金流与回款周期。';
export const UV06_SUMMARY = 'UV06 现金流缺口是当前主要增长约束。';

export interface ModelEndpoint {
  server: Server;
  baseUrl: string;
  requests: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

function completion(content: string, stream: boolean): { status: number; contentType: string; body: string } {
  if (stream) {
    const frames = [content.slice(0, 8), content.slice(8)].map((text) => (
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
    ));
    return {
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: `${frames.join('')}data: [DONE]\n\n`,
    };
  }
  return {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({
      model: 'uv-local-model',
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    }),
  };
}

export async function startModelEndpoint(): Promise<ModelEndpoint> {
  const requests: Array<Record<string, unknown>> = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'uv-local-model' }] }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { raw += chunk; });
    req.on('end', () => {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error('Model request is not an object');
      requests.push(parsed);
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const prompt = messages.map((message) => isRecord(message) ? String(message.content ?? '') : '').join('\n');
      const isDiagnosis = prompt.includes('请基于以上哨兵数据，按 JSON 格式输出诊断结果');
      const content = isDiagnosis
        ? JSON.stringify({
            summary: UV06_SUMMARY,
            hypotheses: [{ dimension: 'financial', summary: '现金跑道不足', confidence: 0.9, evidence: ['两期经营现金流恶化'] }],
            rootCauses: [{ dimension: 'financial', description: '回款周期拉长导致现金缺口', confidence: 0.88 }],
            recommendations: [{ dimension: 'financial', action: '建立每周回款催收清单', priority: 'high' }],
          })
        : UV04_REPLY;
      const response = completion(content, parsed.stream === true);
      res.writeHead(response.status, { 'content-type': response.contentType });
      res.end(response.body);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Model endpoint did not bind a port');
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
