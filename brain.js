// Ruby — a small, honest AI chatbot brain.
// Works in the browser and in Node (no dependencies).
// Local mode: no live internet, no real LLM. It remembers facts, notes
// and todos, answers with tools (calculator, date/time), and keeps a
// conversation going. server.js can swap in a real LLM when an API
// key is configured — see README.md.

(function (root) {
  'use strict';

  var JOKES = [
    "Why did the chatbot cross the road? To get to the other side of the conversation.",
    "I asked my code for a joke once. It said it was still debugging its sense of humour.",
    "Why do programmers prefer dark mode? Because light attracts bugs.",
    "I would tell you a UDP joke, but you might not get it.",
  ];

  function clean(s) { return String(s || '').trim(); }
  function lower(s) { return clean(s).toLowerCase(); }

  // Safe arithmetic: recursive-descent parser for + - * / ( ) and decimals.
  // Returns a number, or null if the expression is not valid arithmetic.
  function evalArithmetic(expr) {
    var src = String(expr).replace(/\s+/g, '');
    if (!/^[0-9+\-*/().]+$/.test(src) || !src) return null;
    var i = 0;
    function peek() { return src[i]; }
    function eat(ch) { if (src[i] === ch) { i++; return true; } return false; }
    function number() {
      var start = i;
      while (/[0-9.]/.test(src[i] || '')) i++;
      if (start === i) return null;
      var v = parseFloat(src.slice(start, i));
      return isFinite(v) ? v : null;
    }
    function factor() {
      if (eat('-')) { var v = factor(); return v === null ? null : -v; }
      if (eat('(')) {
        var v = expr_();
        if (v === null || !eat(')')) return null;
        return v;
      }
      return number();
    }
    function term() {
      var v = factor();
      if (v === null) return null;
      while (peek() === '*' || peek() === '/') {
        var op = src[i++];
        var r = factor();
        if (r === null) return null;
        if (op === '*') v *= r; else { if (r === 0) return null; v /= r; }
      }
      return v;
    }
    function expr_() {
      var v = term();
      if (v === null) return null;
      while (peek() === '+' || peek() === '-') {
        var op = src[i++];
        var r = term();
        if (r === null) return null;
        v = (op === '+') ? v + r : v - r;
      }
      return v;
    }
    var out = expr_();
    return (out !== null && i === src.length) ? out : null;
  }

  function defaultMemory() {
    return {
      name: null,
      facts: [],
      preferences: {},
      notes: [],
      todos: [],
      customReplies: {},
      jokeIndex: 0,
      pendingQuestion: null,
      turnCount: 0,
    };
  }

  function createRubyBrain(memory) {
    var mem = memory || defaultMemory();
    mem.facts = mem.facts || [];
    mem.notes = mem.notes || [];
    mem.todos = mem.todos || [];
    mem.preferences = mem.preferences || {};
    mem.customReplies = mem.customReplies || {};
    if (typeof mem.jokeIndex !== 'number') mem.jokeIndex = 0;
    if (typeof mem.turnCount !== 'number') mem.turnCount = 0;

    function rememberFact(fact) {
      fact = clean(fact).replace(/\.+$/, '');
      if (fact && mem.facts.indexOf(fact) === -1) mem.facts.push(fact);
    }

    function memorySummary() {
      var parts = [];
      if (mem.name) parts.push('Your name is ' + mem.name + '.');
      Object.keys(mem.preferences).forEach(function (k) {
        parts.push('You like ' + k + ': ' + mem.preferences[k] + '.');
      });
      mem.facts.forEach(function (f) { parts.push(f.charAt(0).toUpperCase() + f.slice(1) + '.'); });
      if (!parts.length) return "I don't have anything saved about you yet. Tell me something with “remember that …” and I'll keep it.";
      return 'Here is what I remember:\n' + parts.map(function (p) { return '• ' + p; }).join('\n');
    }

    function todoListText() {
      if (!mem.todos.length) return 'Your todo list is empty. Try “add buy milk to my todos”.';
      return 'Your todos:\n' + mem.todos.map(function (t, idx) {
        return (idx + 1) + '. [' + (t.done ? 'x' : ' ') + '] ' + t.text;
      }).join('\n');
    }

    function reply(input, opts) {
      opts = opts || {};
      var now = opts.now instanceof Date ? opts.now : new Date();
      var raw = clean(input);
      var text = lower(raw);
      mem.turnCount++;

      if (!raw) return 'Say something and I will answer — try “help” to see what I can do.';

      // Custom reply taught with: when I say <x>, say <y>
      var teach = text.match(/^when i say (.+?), say (.+)$/);
      if (teach) {
        mem.customReplies[clean(teach[1])] = clean(teach[2]);
        return 'Got it. When you say “' + clean(teach[1]) + '”, I will say “' + clean(teach[2]) + '”.';
      }
      if (mem.customReplies[text]) return mem.customReplies[text];

      // Answer a pending follow-up first (e.g. Ruby asked for a name).
      if (mem.pendingQuestion === 'name' && raw.split(/\s+/).length <= 3 && !text.match(/^(hi|hello|hey|no|nevermind|never mind)/)) {
        mem.name = raw.replace(/^(my name is|call me|i'm|i am)\s+/i, '');
        mem.pendingQuestion = null;
        return 'Nice to meet you, ' + mem.name + '! I will remember that. What would you like to do next?';
      }
      mem.pendingQuestion = null;

      if (/^(help|what can you do|commands|what do you do)$/.test(text)) {
        return 'I can chat, remember things, and help with small tasks. Try:\n' +
          '• “my name is Logan” / “remember that I like blue”\n' +
          '• “what do you remember about me?”\n' +
          '• “add buy milk to my todos” / “list my todos” / “done with buy milk”\n' +
          '• “note that the shop closes at 9” / “list my notes”\n' +
          '• “what is 12 * 8 + 5?” / “what time is it?” / “tell me a joke”\n' +
          '• “when I say good morning, say …” to teach me a reply';
      }

      if (/are you (a )?human|are you real|are you a person/.test(text)) {
        return "I'm Ruby, an AI assistant — not a human. I'm a chatbot program, and I try to be upfront about that.";
      }
      if (/who are you|what is your name|your name/.test(text)) {
        return "I'm Ruby, an AI chatbot. I'm warm, direct, and a little playful — I keep track of the details that matter, help with small tasks, and I don't pretend to be human.";
      }
      if (/^(hi|hello|hey|hey ruby|hi ruby|hello ruby)\b/.test(text)) {
        return mem.name
          ? 'Hey, ' + mem.name + '! Good to see you. What are we working on?'
          : 'Hey! I\'m Ruby. What should I call you?';
      }
      if (/^(bye|goodbye|see you|good night)\b/.test(text)) {
        return mem.name ? 'Bye for now, ' + mem.name + '! I will keep your notes and todos saved.' : 'Bye for now! Your notes and todos are saved here.';
      }
      if (/^(thanks|thank you|thx)\b/.test(text)) return 'Anytime. That is what I am here for.';
      if (/how are you|how is it going|how are you doing/.test(text)) {
        return 'Running well, thanks — ready to help. How are you doing?';
      }

      // Name — capture from the original input so capitalisation survives.
      var nameMatch = raw.match(/^(my name is|call me|i'm|i am)\s+(.+)$/i);
      if (nameMatch && !/^(i'm|i am) (good|fine|ok|okay|tired|great|not good)/.test(text)) {
        mem.name = nameMatch[2].replace(/\.+$/, '');
        return 'Nice to meet you, ' + mem.name + '! I will remember that.';
      }
      if (/what is my name|do you know my name|who am i/.test(text)) {
        if (mem.name) return 'You are ' + mem.name + '.';
        mem.pendingQuestion = 'name';
        return "I don't know yet — what should I call you?";
      }

      // Remember / forget
      var remember = text.match(/^remember (that )?(.+)$/);
      if (remember) {
        var fact = remember[2];
        var like = fact.match(/^(i like|my favorite|my favourite) (.+?) (is|are) (.+)$/) ||
          fact.match(/^(i like|my favorite|my favourite) (.+)$/);
        if (like) {
          // Keep these as plain-language facts so summaries read naturally,
          // e.g. “you like blue” instead of “you like thing: blue”.
          var natural = like[1] === 'i like' && !like[4]
            ? 'you like ' + like[2]
            : 'your favourite ' + like[2] + ' is ' + like[4];
          rememberFact(natural);
          return 'Noted — ' + natural + '.';
        }
        rememberFact(fact);
        return 'Got it, I will remember that: ' + fact.replace(/\.+$/, '') + '.';
      }
      if (/^forget everything|forget all/.test(text)) {
        var keptName = mem.name;
        var fresh = defaultMemory();
        fresh.name = keptName;
        Object.keys(fresh).forEach(function (k) { mem[k] = fresh[k]; });
        return 'Done — I cleared your facts, notes, and todos. I kept your name, ' + (keptName || 'friend') + '.';
      }
      var forget = text.match(/^forget (that )?(.+)$/);
      if (forget) {
        var target = forget[2].replace(/\.+$/, '');
        var before = mem.facts.length;
        mem.facts = mem.facts.filter(function (f) { return f.toLowerCase() !== target; });
        mem.notes = mem.notes.filter(function (n) { return n.toLowerCase() !== target; });
        return mem.facts.length < before ? 'Forgotten: ' + target + '.' : 'I could not find that in what I have saved.';
      }
      if (/what do you remember|what do you know about me|show my memory/.test(text)) return memorySummary();

      // Todos
      var addTodo = text.match(/^(add|remind me to|remember to) (.+?) (to my todos|to my todo list|to my list)?$/);
      if (/add .* to my todos|add .* to my todo list|remind me to /.test(text) || (addTodo && /todo|list/.test(text))) {
        var item = (text.match(/add (.+?) to my (todos|todo list|list)/) || [])[1] ||
          (text.match(/remind me to (.+)$/) || [])[1];
        if (item) {
          mem.todos.push({ text: clean(item), done: false });
          return 'Added to your todos: ' + clean(item) + '.';
        }
      }
      if (/^(list|show) my todos|my todos|todo list/.test(text)) return todoListText();
      var doneTodo = text.match(/^(done with|complete|finish|mark done) (.+)$/);
      if (doneTodo) {
        var needle = doneTodo[2].replace(/\.+$/, '');
        var found = null;
        mem.todos.forEach(function (t) { if (t.text.toLowerCase().indexOf(needle) !== -1) found = t; });
        if (found) { found.done = true; return 'Done: ' + found.text + '. Nice one.'; }
        return 'I could not find a todo matching “' + needle + '”. ' + todoListText();
      }
      if (/clear (completed|done) todos/.test(text)) {
        mem.todos = mem.todos.filter(function (t) { return !t.done; });
        return 'Cleared your completed todos.';
      }

      // Notes
      var note = text.match(/^(note that|make a note that|save a note) (.+)$/);
      if (note) {
        mem.notes.push(clean(note[2]));
        return 'Note saved: ' + clean(note[2]) + '.';
      }
      if (/^(list|show) my notes|my notes/.test(text)) {
        if (!mem.notes.length) return 'No notes yet. Try “note that the shop closes at 9”.';
        return 'Your notes:\n' + mem.notes.map(function (n, idx) { return (idx + 1) + '. ' + n; }).join('\n');
      }

      // Calculator
      var calc = text.match(/^(what is|what'?s|calculate|how much is|compute)\s+(.+?)\??$/);
      if (calc && /[0-9]/.test(calc[2])) {
        var value = evalArithmetic(calc[2].replace(/x/g, '*').replace(/÷/g, '/'));
        if (value !== null) return calc[2].replace(/\?$/, '') + ' = ' + value;
      }

      // Time / date
      if (/what time is it|current time|time now/.test(text)) {
        return 'It is ' + now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' where this device is set.';
      }
      if (/what (day|date) is it|today'?s date/.test(text)) {
        return 'Today is ' + now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '.';
      }

      if (/tell me a joke|joke/.test(text)) {
        var joke = JOKES[mem.jokeIndex % JOKES.length];
        mem.jokeIndex++;
        return joke;
      }
      if (/weather/.test(text)) {
        return 'In this local mode I cannot check live weather — I have no weather source connected here. If you connect one (or add an API key in server mode), I can answer that for real instead of guessing.';
      }
      if (/news/.test(text)) {
        return 'I cannot fetch live news in local mode, so I will not guess at headlines. With a news source connected in server mode, I could summarise the latest for you.';
      }
      if (/summari[sz]e (our|this|the) conversation/.test(text)) {
        var hist = (opts.history || []).slice(-8).map(function (m) { return (m.role === 'user' ? 'You: ' : 'Ruby: ') + m.text; });
        if (!hist.length) return 'We have only just started — ask me something and I will keep track from here.';
        return 'So far in this chat:\n' + hist.join('\n') + '\n\nWant me to turn any of that into a note or a todo?';
      }

      // Fallback: stay helpful, don't invent facts, ask one clear follow-up.
      if (/^(yes|yeah|yep|sure|ok|okay)$/.test(text)) return 'Great — what next? I can save that as a note or a todo if you want.';
      if (/^(no|nope|not really)$/.test(text)) return 'No problem. Tell me what would help instead.';
      return 'I hear you — “' + raw + '”. In local mode I work best with concrete asks: I can remember it, note it, add it as a todo, or calculate it. Want me to save that as a note?';
    }

    return {
      memory: mem,
      reply: reply,
      memorySummary: memorySummary,
      todoListText: todoListText,
      evalArithmetic: evalArithmetic,
    };
  }

  root.RubyBrain = { create: createRubyBrain, defaultMemory: defaultMemory, evalArithmetic: evalArithmetic };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.RubyBrain;
}
