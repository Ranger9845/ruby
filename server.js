// Tiny Ruby server: serves the chat page, plus POST /api/chat.
// Local mode (no key): answers with brain.js, in-memory memory per server run.
// LLM mode (a key set): forwards to an LLM with Ruby's system prompt, then
// falls back to brain.js if every LLM call fails.
// Supported keys (set one — never put a real key in this repo, and never
// paste it in chat; pass it as an environment variable when you start Ruby):
//   OPENAI_API_KEY  — OpenAI, paid, model via OPENAI_MODEL (default gpt-4o-mini)
//   GEMINI_API_KEY  — Google AI Studio, free tier, model via GEMINI_MODEL
//                     (default gemini-3.8-flash — check AI Studio for the
//                     current free-tier model names, they change)
//   GROQ_API_KEY    — Groq, free tier, model via GROQ_MODEL
//                     (default openai/gpt-oss-120b)
// Free-tier note: on Google's free tier, prompts may be used to improve
// Google's products, so don't send private documents through it.
//
//   GEMINI_API_KEY=... node server.js
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

async function openAiCompatibleReply(url, key, model, messages) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages.slice(-20)],
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error('LLM request failed: ' + res.status);
  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message.content;
}

async function geminiReply(key, model, messages) {
  const contents = messages.slice(-20).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.7 },
      }),
    }
  );
  if (!res.ok) throw new Error('Gemini request failed: ' + res.status);
  const data = await res.json();
  const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  return parts && parts.map((p) => p.text || '').join('');
}

// Tries each configured provider in turn. Returns { answer, provider },
// or null when no key is set. Throws only if a key is set and every
// provider fails — the caller then falls back to the local brain.
async function llmReply(messages) {
  const providers = [];
  if (process.env.OPENAI_API_KEY) {
    providers.push(['openai', () => openAiCompatibleReply(
      'https://api.openai.com/v1/chat/completions',
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_MODEL || 'gpt-4o-mini', messages)]);
  }
  if (process.env.GEMINI_API_KEY) {
    providers.push(['gemini', () => geminiReply(
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_MODEL || 'gemini-3.8-flash', messages)]);
  }
  if (process.env.GROQ_API_KEY) {
    providers.push(['groq', () => openAiCompatibleReply(
      'https://api.groq.com/openai/v1/chat/completions',
      process.env.GROQ_API_KEY,
      process.env.GROQ_MODEL || 'openai/gpt-oss-120b', messages)]);
  }
  if (!providers.length) return null;
  let lastError = null;
  for (const [name, fn] of providers) {
    try {
      const answer = await fn();
      if (answer) return { answer, provider: name };
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error('LLM request failed');
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
            const llm = await llmReply([...(history || []), { role: 'user', text: message }].map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })));
            if (llm && llm.answer) { answer = llm.answer; mode = 'llm:' + llm.provider; }
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
  const configured = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'].filter((k) => process.env[k]);
  console.log('Ruby is running at http://localhost:' + PORT);
  console.log('Mode: ' + (configured.length ? 'LLM (' + configured.join(', ') + ')' : 'local brain.js'));
});
