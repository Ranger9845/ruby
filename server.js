// Tiny Ruby server: serves the chat page, plus POST /api/chat.
// Local mode (no key): answers with brain.js, in-memory memory per server run.
// LLM mode (a key set): forwards to an LLM with Ruby's system prompt, then
// falls back to brain.js if every LLM call fails.
// Supported keys (set one — never put a real key in this repo, and never
// paste it in chat; pass it as an environment variable when you start Ruby):
//   OPENAI_API_KEY  — OpenAI, paid, model via OPENAI_MODEL (default gpt-4o-mini)
//   GEMINI_API_KEY  — Google AI Studio, free tier, model via GEMINI_MODEL
//                     (default gemini-3.5-flash-lite, verified working
//                     2026-11-01 in ~1.5s. Do NOT use gemini-3.8-flash here:
//                     it hung past 30s in that test, and gemini-2.5-flash /
//                     -lite now return 404 "no longer available to new users".)
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

// Load a local ".env" file (same folder as server.js) into process.env,
// without any dependency. Only values not already set in the real
// environment are filled in, so a shell export still wins. ".env" is
// gitignored — never commit it, and never put a real key in .env.example.
(function loadDotEnv() {
  try {
    const lines = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch (e) { /* no .env file: running with shell env or local mode */ }
})();

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
    signal: AbortSignal.timeout(30000),
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
  // Header, not a ?key= URL, so the key never lands in a URL / log line.
  // 30s timeout: without this, a slow model hangs Ruby forever instead
  // of falling back to her local brain.
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(30000),
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
      process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', messages)]);
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
