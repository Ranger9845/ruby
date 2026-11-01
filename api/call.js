// Vercel serverless function: POST /api/call
// Ruby's server, serverless version of bland.js (local server).
// This endpoint is OPERATOR-ONLY, not wired to the chat page:
// - It requires the CALL_SECRET env var, sent as x-call-secret header.
//   Without it, it returns 403 and places NO call. This protects the
//   Bland balance (calls are paid) from anyone who finds the URL.
// - Ruby's AI disclosure is forced in code, never from raw user input.
// - Any task trying to make Ruby claim she is human / not an AI is rejected.
// - No key is in this file. BLAND_API_KEY and CALL_SECRET live only as
//   Vercel sensitive environment variables, never in the repo.
//
// To use it (operator only, after approving recipient, task, callback):
//   curl -X POST https://ruby-logans-projects-cdea6129.vercel.app/api/call \
//     -H 'Content-Type: application/json' -H 'x-call-secret: <CALL_SECRET from Vercel dashboard>' \
//     -d '{"phoneNumber":"+14055551234","task":"Do you have milk in stock?","onBehalfOf":"Logan"}'
'use strict';

function disclosure(onBehalfOf) {
  const who = (onBehalfOf || 'Logan').toString().trim() || 'Logan';
  return "Hi, I'm Ruby, an AI assistant calling on behalf of " + who + '. ';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }
  const secret = process.env.CALL_SECRET;
  if (!secret || req.headers['x-call-secret'] !== secret) {
    res.status(403).json({ error: 'Call endpoint is operator-only. No call placed.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const phoneNumber = body && body.phoneNumber;
  const task = body && body.task;
  const onBehalfOf = body && body.onBehalfOf;
  const key = process.env.BLAND_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'No Bland key configured.' });
    return;
  }
  if (!phoneNumber || !/^\+[1-9][0-9]{6,14}$/.test(String(phoneNumber).trim())) {
    res.status(400).json({ error: 'A phone number in E.164 format (e.g. +14055551234) is required.' });
    return;
  }
  if (!task || typeof task !== 'string' || !task.trim()) {
    res.status(400).json({ error: 'A call task is required.' });
    return;
  }
  if (/i am not (an )?ai|i'm not (an )?ai|not an ai|i am human|i'm human|i am (a )?person/i.test(task)) {
    res.status(400).json({ error: 'Ruby will not claim to be human or not an AI. No call placed.' });
    return;
  }
  const fullTask = disclosure(onBehalfOf) + task.trim();
  try {
    const apiRes = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        phone_number: String(phoneNumber).trim(),
        task: fullTask,
        max_duration: 5,
      }),
    });
    if (!apiRes.ok) throw new Error('Bland request failed: ' + apiRes.status);
    const data = await apiRes.json();
    res.status(200).json({ callId: data.call_id || data.c_id || null, taskSpoken: fullTask, mode: 'bland' });
  } catch (e) {
    res.status(502).json({ error: 'Bland request failed.' });
  }
};
