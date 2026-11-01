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

  function send(text) {
    text = (text || '').trim();
    if (!text) return;
    bubble('user', text);
    history.push({ role: 'user', text: text });

    var typing = bubble('ruby', '…');
    typing.classList.add('typing');
    status.textContent = 'Ruby is thinking…';

    setTimeout(function () {
      typing.remove();
      var answer;
      try {
        answer = brain.reply(text, { history: history.slice(-10) });
      } catch (e) {
        answer = 'Something tripped me up on that one — try rephrasing it, or type “help”.';
      }
      bubble('ruby', answer);
      history.push({ role: 'ruby', text: answer });
      status.textContent = brain.memory.name ? 'Chatting with ' + brain.memory.name : 'Memory saved in this browser';
      persist();
    }, 350);
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
