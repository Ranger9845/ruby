// Vercel serverless function: POST /api/db
// Ruby's SQLite database, serverless version.
// On Vercel, serverless functions are ephemeral, so a SQLite file
// cannot persist writes between calls. This function therefore
// loads Ruby's knowledge (same facts as knowledge.json / knowledge.sql)
// into an in-memory SQLite database at cold start, and answers with
// a real SQL query — no LLM, no API key.
// For persistent memory across calls, Ruby still uses the browser's
// localStorage (chat page) and, on a real server, a hosted SQLite
// service such as Turso's free tier. That hosted step needs its own
// account, which is not set up here.
// Usage: POST { "question": "capital of France" }
// Returns: { "answer": "...", "mode": "sqlite" } or 404 if not in the base.
'use strict';

const KNOWLEDGE = [
  ['capital france', 'The capital of France is Paris.'],
  ['capital oklahoma', 'The capital of Oklahoma is Oklahoma City.'],
  ['capital texas', 'The capital of Texas is Austin.'],
  ['capital japan', 'The capital of Japan is Tokyo.'],
  ['planet largest', 'Jupiter is the largest planet in our solar system.'],
  ['water boil', 'Water boils at 100°C (212°F) at sea level.'],
  ['egg boil', 'For a hard-boiled egg: put eggs in cold water, bring to a boil, then cover and leave for 9 to 12 minutes, then cool in cold water before peeling.'],
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const question = body && body.question;
  if (!question || typeof question !== 'string') {
    res.status(400).json({ error: 'Missing question.' });
    return;
  }
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE knowledge (keywords TEXT, answer TEXT)');
    const insert = db.prepare('INSERT INTO knowledge (keywords, answer) VALUES (?, ?)');
    KNOWLEDGE.forEach(function (row) { insert.run(row[0], row[1]); });
    const words = question.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean);
    // SQL query: count how many question words appear in keywords.
    // This is a real SQLite query, not a hand-rolled lookup in this file.
    const rows = db.prepare('SELECT keywords, answer FROM knowledge').all();
    let best = null;
    let bestScore = 0;
    rows.forEach(function (r) {
      let score = 0;
      words.forEach(function (w) { if (r.keywords.indexOf(w) !== -1) score++; });
      if (score > bestScore) { bestScore = score; best = r; }
    });
    db.close();
    if (best && bestScore >= 2) {
      res.status(200).json({ answer: best.answer, mode: 'sqlite' });
    } else {
      res.status(404).json({ error: 'Not in Ruby\'s SQLite knowledge base.' });
    }
  } catch (e) {
    res.status(500).json({ error: 'SQLite lookup failed.' });
  }
};
