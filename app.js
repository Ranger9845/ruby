// Ruby chat UI — wires the browser page to brain.js and localStorage.
(function () {
  'use strict';

  var MEMORY_KEY = 'ruby-memory-v1';
  var HISTORY_KEY = 'ruby-history-v1';

  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full/blocked: chat still works */ }
  }

  var brain = RubyBrain.create(load(MEMORY_KEY, null) || RubyBrain.defaultMemory());
  var history = load(HISTORY_KEY, []);
  // Temporary chat-to-call state (2026-11-01, "just for now"):
  // a pending call is only set from a "call +number about …" message,
  // and only dialled after the user replies "yes, call" in chat.
  var pendingCall = null;
  if (!Array.isArray(history)) history = [];

  var log = document.getElementById('log');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('input');
  var status = document.getElementById('status');

  function persist() {
    save(MEMORY_KEY, brain.memory);
    save(HISTORY_KEY, history.slice(-100));
  }

  function bubble(role, text) {
    var div = document.createElement('div');
    div.className = 'msg ' + role;
    var who = document.createElement('div');
    who.className = 'who';
    who.textContent = role === 'user' ? 'You' : 'Ruby';
    var body = document.createElement('div');
    body.className = 'body';
    body.textContent = text;
    div.appendChild(who);
    div.appendChild(body);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function showHistory() {
    log.innerHTML = '';
    if (!history.length) {
      bubble('ruby', "Hi, I'm Ruby — an AI chatbot. I'm warm, direct, and a little playful. Try “help”, tell me your name, or ask me to remember something.");
    } else {
      history.forEach(function (m) { bubble(m.role === 'user' ? 'user' : 'ruby', m.text); });
    }
  }

  // Ruby's own brain first, in this browser. Only if it falls back to
  // its generic "I hear you" reply do we try the server (Wikipedia on
  // Vercel, then Gemini) — so she is her own for everything she knows.
  async function serverAnswer(text) {
    try {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 30000);
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(-10) }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      var data = await res.json();
      if (data && data.answer && data.mode) return { answer: data.answer, mode: data.mode };
      return null;
    } catch (e) { return null; }
  }

  async function doChatCall(call) {
    try {
      var res = await fetch('/api/chat-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: call.phone, task: call.task, onBehalfOf: brain.memory.name || 'Logan', chatConfirmed: true }),
      });
      var data = await res.json();
      if (!res.ok) return 'Call did not go through: ' + (data.error || 'unknown error') + ' No call was placed unless you saw a call ID.';
      return 'Calling now. Call ID: ' + (data.callId || 'unknown') + '. Script spoken: "' + data.taskSpoken + '"';
    } catch (e) {
      return 'Call did not go through — check your connection and try again.';
    }
  }

  function send(text) {
    text = (text || '').trim();
    if (!text) return;
    bubble('user', text);
    history.push({ role: 'user', text: text });

    var typing = bubble('ruby', '…');
    typing.classList.add('typing');
    status.textContent = 'Ruby is thinking…';

    // Chat-to-call, temporary mode: "call +14055551234 about milk"
    // shows the script first; "yes, call" dials it, "no" cancels it.
    // Ruby cannot call a shop by name alone — she needs a phone number.
    var callMatch = text.match(/^call\s+(\+[0-9]{7,15})\s+about\s+(.+)$/i);
    if (callMatch) {
      pendingCall = { phone: callMatch[1], task: callMatch[2].trim() };
      typing.remove();
      var script = "Hi, I'm Ruby, an AI assistant calling on behalf of " + (brain.memory.name || 'Logan') + '. I have a question about ' + pendingCall.task + ', if you\'re available!';
      var draft = 'Ready to call ' + pendingCall.phone + ' with this script:\n"' + script + '"\nReply "yes, call" to dial it, or "no" to cancel. I will not dial until you say yes.';
      bubble('ruby', draft);
      history.push({ role: 'ruby', text: draft });
      status.textContent = 'Call ready — waiting for your yes';
      persist();
      return;
    }
    if (/^yes,? call$/i.test(text) && pendingCall) {
      var call = pendingCall;
      pendingCall = null;
      doChatCall(call).then(function (result) {
        typing.remove();
        bubble('ruby', result);
        history.push({ role: 'ruby', text: result });
        status.textContent = 'Call attempted';
        persist();
      });
      return;
    }
    if (/^(no|cancel|nevermind|never mind)$/i.test(text) && pendingCall) {
      pendingCall = null;
      typing.remove();
      bubble('ruby', 'Cancelled — no call placed.');
      history.push({ role: 'ruby', text: 'Cancelled — no call placed.' });
      status.textContent = 'Call cancelled';
      persist();
      return;
    }

    // Small delay so the typing indicator is visible, then answer.
    setTimeout(function () {
      var localAnswer;
      try {
        localAnswer = brain.reply(text, { history: history.slice(-10) });
      } catch (e) {
        localAnswer = 'Something tripped me up on that one — try rephrasing it, or type “help”.';
      }
      // If Ruby's own brain handled it, use that. Only her generic
      // fallback goes to the server (Wikipedia, then Gemini).
      if (localAnswer.indexOf('I hear you') !== 0) {
        typing.remove();
        bubble('ruby', localAnswer);
        history.push({ role: 'ruby', text: localAnswer });
        status.textContent = brain.memory.name ? 'Chatting with ' + brain.memory.name + ' (local brain)' : 'Memory saved in this browser (local brain)';
        persist();
        return;
      }
      serverAnswer(text).then(function (server) {
        typing.remove();
        var answer = server ? server.answer : localAnswer;
        bubble('ruby', answer);
        history.push({ role: 'ruby', text: answer });
        status.textContent = server
          ? (server.mode === 'wikipedia' ? 'Answered from Wikipedia (free, no LLM)'
            : server.mode === 'wikidata' ? 'Answered from Wikidata (free, no LLM)'
            : 'Answered by Gemini')
          : (brain.memory.name ? 'Chatting with ' + brain.memory.name + ' (local brain)' : 'Memory saved in this browser (local brain)');
        persist();
      });
    }, 200);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value;
    input.value = '';
    input.focus();
    send(text);
  });

  document.querySelectorAll('[data-say]').forEach(function (btn) {
    btn.addEventListener('click', function () { send(btn.getAttribute('data-say')); });
  });

  document.getElementById('export-btn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ memory: brain.memory, history: history }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ruby-chat-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('clear-btn').addEventListener('click', function () {
    if (!confirm('Clear this chat and Ruby’s saved memory in this browser?')) return;
    localStorage.removeItem(MEMORY_KEY);
    localStorage.removeItem(HISTORY_KEY);
    brain = RubyBrain.create(RubyBrain.defaultMemory());
    history = [];
    showHistory();
    status.textContent = 'Fresh start';
  });

  showHistory();
  input.focus();
})();
