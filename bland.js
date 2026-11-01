// Ruby + Bland calling.
//
// This module is deliberately strict about honesty:
// - Ruby ALWAYS identifies herself as an AI assistant at the start of a call.
// - She never claims to be human, and never pretends to be the person she
//   is calling for. The task she speaks is built here, not supplied raw,
//   so a caller cannot strip the disclosure out by editing a script.
// - A call is only placed when BLAND_API_KEY is set in the environment.
//   That key is never written to a file in this repo. Put it in a local
//   .env (gitignored) on the computer running Ruby, or in a Vercel
//   environment variable — never in chat, never in the repo.
//
// Usage (server.js /api/call):
//   blandCall({ phoneNumber, task, onBehalfOf })
//   -> { callId } on success, or throws.
//
// onBehalfOf is the name of the person Ruby is helping, e.g. "Logan".
// If the person being helped is not Logan, that person must have agreed
// that Ruby may call on their behalf — Ruby does not assume that consent.
'use strict';

const BLAND_URL = 'https://api.bland.ai/v1/calls';

function disclosure(onBehalfOf) {
  const who = (onBehalfOf || 'Logan').toString().trim() || 'Logan';
  return "Hi, I'm Ruby, an AI assistant calling on behalf of " + who + '. ';
}

function buildTask(task, onBehalfOf) {
  const clean = String(task || '').trim();
  if (!clean) throw new Error('A call task is required.');
  // Reject any attempt to make Ruby claim she is not an AI, or to
  // impersonate a human. This check is on top of the forced disclosure.
  if (/i am not (an )?ai|i'm not (an )?ai|not an ai|i am human|i'm human|i am (a )?person/i.test(clean)) {
    throw new Error('Ruby will not claim to be human or not an AI.');
  }
  return disclosure(onBehalfOf) + clean;
}

async function blandCall({ phoneNumber, task, onBehalfOf, voice }) {
  const key = process.env.BLAND_API_KEY;
  if (!key) throw new Error('No Bland key configured. Set BLAND_API_KEY in the environment.');
  if (!phoneNumber || !/^\+[1-9][0-9]{6,14}$/.test(String(phoneNumber).trim())) {
    throw new Error('A phone number in E.164 format (e.g. +14055551234) is required.');
  }
  const fullTask = buildTask(task, onBehalfOf);
  const res = await fetch(BLAND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      phone_number: String(phoneNumber).trim(),
      task: fullTask,
      // Voice is optional: omit it and Bland uses its default, unless the
      // person running Ruby sets a specific Bland voice name.
      ...(voice ? { voice } : {}),
      // Keep calls short and cheap unless the caller explicitly changes this.
      max_duration: 5,
    }),
  });
  if (!res.ok) throw new Error('Bland request failed: ' + res.status);
  const data = await res.json();
  return { callId: data.call_id || data.c_id || null, taskSpoken: fullTask, raw: data };
}

module.exports = { blandCall, buildTask, disclosure };
