// Tiny Ruby server: serves the chat page, plus POST /api/chat.
// Local mode (no key): answers with brain.js, in-memory memory per server run.
// LLM mode (OPENAI_API_KEY set): forwards to OpenAI's chat API with Ruby's
// system prompt, then falls back to brain.js if that call fails.
// Never put a real API key in this repo — pass it as an environment variable.
//
//   OPENAI_API_KEY=... node server.js
//   open http://localhost:3000
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const RubyBrain = require('./brain.js');

const PORT = process.env.PORT || 3000;
const brain = RubyBrain.create(RubyBrain.defaultMemory());

const SYSTEM_PROMPT = [
  'You are Ruby, an AI chatbot. You are warm, direct, and a little playful.',
  'You are not a human, and you never pretend to be one. Say so plainly if asked.',
  'You help with small tasks, remember what the user tells you, and you do not',
  'invent live facts (weather, news, prices). If you do not know, say so and',
  'offer a useful next step instead of guessing.',
].join(' ');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/plain' };

async function llmReply(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages.slice(-20)],
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error('LLM request failed: ' + res.status);
  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message.content;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/chat') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const { message, history } = JSON.parse(body || '{}');
          let answer = null;
          let mode = 'local';
          try {
            answer = await llmReply([...(history || []), { role: 'user', text: message }].map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })));
            if (answer) mode = 'llm';
          } catch (e) { /* fall through to local brain */ }
          if (!answer) answer = brain.reply(message, { history: history || [] });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ answer, mode }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Could not understand that request.' }));
        }
      });
      return;
    }

    const file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const safe = path.normalize(path.join(__dirname, file));
    if (!safe.startsWith(__dirname)) { res.writeHead(403); res.end('Forbidden'); return; }
    const data = fs.readFileSync(safe);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(safe)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log('Ruby is running at http://localhost:' + PORT);
  console.log('Mode: ' + (process.env.OPENAI_API_KEY ? 'LLM (OpenAI)' : 'local brain.js'));
});
