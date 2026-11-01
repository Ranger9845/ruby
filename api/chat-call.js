// Vercel serverless function: POST /api/chat-call
// TEMPORARY, chat-triggered calling — enabled "just for now" at Logan's
// request on 2026-11-01, so messaging Ruby can make a call.
//
// How it is gated, and why it is temporary:
// - It does NOT use the operator CALL_SECRET, because a browser chat
//   page cannot hold a secret safely. Instead, the chat page only
//   calls this endpoint after the user has seen the exact script and
//   replied "yes, call" in that same chat session.
// - That confirmation is NOT a security boundary for a public site:
//   anyone who opens Ruby's public chat page could also confirm a
//   call and spend the Bland balance. The balance is small and
//   auto-refill is off, so the financial exposure is bounded, but it
//   is not zero. Re-enable the operator-only api/call.js gate, or
//   switch to whitelist-only numbers, when this temporary mode ends.
// - Ruby's AI disclosure is forced in code, and any task trying to
//   make her claim she is human / not an AI is rejected.
// - Calls are capped at 5 minutes. No key is in this file;
//   BLAND_API_KEY lives only as a Vercel sensitive env var.
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
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (!body || body.chatConfirmed !== true) {
    res.status(400).json({ error: 'Call not confirmed in chat. No call placed.' });
    return;
  }
  const phoneNumber = body.phoneNumber;
  const task = body.task;
  const onBehalfOf = body.onBehalfOf;
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
