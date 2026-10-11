// Minimal fake OpenAI-compatible server for integration smoke-testing ONLY.
// Speaks POST /v1/chat/completions and GET /v1/models so the engine's
// openai-compatible provider treats it as a reachable, genuine endpoint.
import http from 'http';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-llama-1b', object: 'model' }] }));
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let userText = '';
      try {
        const parsed = JSON.parse(body);
        const last = parsed.messages?.[parsed.messages.length - 1];
        userText = last?.content || '';
      } catch {}
      const reply = `GENUINE-MOCK-RESPONSE: received "${String(userText).slice(0, 60)}" — served by the OpenAI-compatible endpoint (no paid service).`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model: 'mock-llama-1b',
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 },
        }),
      );
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(8099, '127.0.0.1', () => console.log('Mock OpenAI-compatible server listening on http://127.0.0.1:8099/v1'));
