// Vercel serverless function: POST /api/chat
// Order: 1) Wikidata (free, no key, no LLM) for "what is / who is /
// tell me about X" questions, 2) Wikipedia (free, no key, no LLM),
// 3) Gemini when GEMINI_API_KEY is set,
// 4) otherwise an error and the chat page falls back to Ruby's local
// brain in the browser — the live site never breaks for lack of a key.
// This is how Wikidata "trains" Ruby: she looks up facts in it at
// answer time, instead of generating them with an LLM, and if a fact
// is not in Wikidata / Wikipedia / her own base, she says so.
//
// Set the key in Vercel (Project Settings > Environment Variables), never
// in this file, never in the repo, and never in chat. Use a fresh key:
// a key shared in chat should be deleted and replaced first.
//
// Verified working model (2026-11-01, ~1.5s): gemini-3.5-flash-lite.
// gemini-3.8-flash hung past 30s in that test; gemini-2.5-flash/-lite
// return 404 "no longer available to new users".
'use strict';

const SYSTEM_PROMPT = [
  'You are Ruby, an AI chatbot. You are warm, direct, and a little playful.',
  'You are not a human, and you never pretend to be one. Say so plainly if asked.',
  'You help with small tasks, remember what the user tells you, and you do not',
  'invent live facts (weather, news, prices). If you do not know, say so and',
  'offer a useful next step instead of guessing.',
].join(' ');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const message = body && body.message;
  const history = Array.isArray(body && body.history) ? body.history : [];
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Missing message.' });
    return;
  }
  // Free database first: Wikidata, no key, no LLM.
  const wdMatch = message.trim().match(/^(what is|who is|tell me about|what'?s)\s+(.+?)\??$/i);
  if (wdMatch) {
    try {
      const search = encodeURIComponent(wdMatch[2].trim());
      const wdRes = await fetch('https://www.wikidata.org/w/api.php?action=wbsearchentities&search=' + search + '&language=en&format=json&origin=*', {
        headers: { 'User-Agent': 'RubyChatbot/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (wdRes.ok) {
        const wd = await wdRes.json();
        const hit = wd && wd.search && wd.search[0];
        if (hit && hit.description) {
          res.status(200).json({ answer: hit.label + ': ' + hit.description + ' (Source: Wikidata, ' + hit.id + ')', mode: 'wikidata' });
          return;
        }
      }
    } catch (e) { /* fall through to Wikipedia */ }
  }

  // Free database second: Wikipedia's summary API needs no key.
  const wikiMatch = message.trim().match(/^(what is|who is|tell me about|what'?s)\s+(.+?)\??$/i);
  if (wikiMatch) {
    try {
      const title = encodeURIComponent(wikiMatch[2].trim().replace(/\s+/g, '_'));
      const wikiRes = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + title, {
        headers: { 'User-Agent': 'RubyChatbot/1.0 (https://ruby-logans-projects-cdea6129.vercel.app/)' },
        signal: AbortSignal.timeout(15000),
      });
      if (wikiRes.ok) {
        const wiki = await wikiRes.json();
        if (wiki && wiki.extract) {
          res.status(200).json({ answer: wiki.extract + ' (Source: Wikipedia)', mode: 'wikipedia' });
          return;
        }
      }
    } catch (e) { /* fall through to Gemini */ }
  }

  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  if (!key) {
    res.status(503).json({ error: 'No Gemini key configured.' });
    return;
  }
  try {
    const contents = [...history, { role: 'user', text: message }]
      .slice(-20)
      .map((m) => ({
        role: m.role === 'ruby' || m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }));
    const apiRes = await fetch(
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
    if (!apiRes.ok) throw new Error('Gemini request failed: ' + apiRes.status);
    const data = await apiRes.json();
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const answer = parts ? parts.map((p) => p.text || '').join('') : '';
    if (!answer) throw new Error('Empty Gemini answer.');
    res.status(200).json({ answer, mode: 'llm:gemini' });
  } catch (e) {
    res.status(502).json({ error: 'Gemini request failed.' });
  }
};
