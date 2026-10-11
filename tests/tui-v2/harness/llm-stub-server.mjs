/**
 * tests/tui-v2/harness/llm-stub-server.mjs — OpenAI 兼容假 LLM（#1348 V3 生产入口取证专用）
 *
 * 边界（V-09）：只存在于 tests/；**不参与生产**；仅替代「外部 LLM 网络边界」这一个外部依赖，
 * 从而在无真实 API Key 的机器上跑通 **真实生产入口** `tsx src/tui-v2/chat.tsx` 的完整会话。
 * 每个请求都追加一行到 STUB_LOG，作为「TUI 真的走完了 N 轮真实 LLM 调用」的原始证据。
 */
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.env.STUB_PORT || 18123);
const LOG = process.env.STUB_LOG || '';

function note(line) {
  if (LOG) appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}

const server = http.createServer((req, res) => {
  note(`${req.method} ${req.url}`);

  if (req.method === 'GET' && (req.url || '').includes('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }));
    return;
  }

  if (req.method === 'POST' && (req.url || '').includes('/chat/completions')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* 诊断用：保留原始体 */ }
      const isStream = parsed.stream === true;
      const content = '收到，请继续补充组织情况。';
      note(`  stream=${isStream} messages=${Array.isArray(parsed.messages) ? parsed.messages.length : '?'} tools=${Array.isArray(parsed.tools) ? parsed.tools.length : 0}`);

      if (isStream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for (const ch of content) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'stub-cmpl-1',
        object: 'chat.completion',
        model: 'stub-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      }));
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  note(`stub-llm listening on 127.0.0.1:${PORT}`);
  console.log(`stub-llm listening on 127.0.0.1:${PORT}`);
});
