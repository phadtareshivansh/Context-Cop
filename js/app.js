/* ══════════════════════════════════════════════════════
   Context Cop — Core Logic
   ══════════════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────
let apiKey      = '';
let provider    = 'gemini';    // 'gemini' | 'openai'
let openaiBase  = 'https://api.openai.com/v1';
let demoMode    = false;
let messages    = [];          // { role: 'user'|'model', parts: [{text}] }
let summaryBlob = null;
let totalTokens = 0;
let maxTokens   = 128000;
let threshold   = 0.75;
let isBusy      = false;
let turnCount   = 0;
let summaryCount = 0;
let tokensSaved = 0;
// When summaryBlob is stored we discount its visible weight by this factor
const compressionRatio = 8; // compressed summary counts as ~1/8th of its raw tokens in the UI

function launchApp(options = {}) {
  const shouldDemo = Boolean(options && options.demo);
  document.body.classList.remove('landing-mode');
  document.body.classList.add('app-mode');
  document.getElementById('landing')?.setAttribute('aria-hidden', 'true');

  if (shouldDemo) {
    useDemoMode();
    return;
  }

  if (!apiKey && !demoMode) {
    showKeyModal();
  } else {
    document.getElementById('user-input')?.focus({ preventScroll: true });
  }
}

function scrollLandingTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Model catalogues ─────────────────────────────────────
const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash',       label: 'Gemini 2.0 Flash',       ctx: 128000  },
  { id: 'gemini-2.0-flash-lite',  label: 'Gemini 2.0 Flash Lite',  ctx: 128000  },
  { id: 'gemini-1.5-flash',       label: 'Gemini 1.5 Flash',       ctx: 1000000 },
  { id: 'gemini-1.5-pro',         label: 'Gemini 1.5 Pro',         ctx: 2000000 },
];

const OPENAI_MODELS = [
  { id: 'gpt-4o',           label: 'GPT-4o (128k)',         ctx: 128000  },
  { id: 'gpt-4o-mini',      label: 'GPT-4o Mini (128k)',    ctx: 128000  },
  { id: 'gpt-4.1',          label: 'GPT-4.1 (1M)',          ctx: 1000000 },
  { id: 'gpt-4.1-mini',     label: 'GPT-4.1 Mini (1M)',     ctx: 1000000 },
  { id: 'o1',               label: 'o1 (200k)',              ctx: 200000  },
  { id: 'o1-mini',          label: 'o1 Mini (128k)',         ctx: 128000  },
  { id: 'o3',               label: 'o3 (200k)',              ctx: 200000  },
  { id: 'o3-mini',          label: 'o3 Mini (200k)',         ctx: 200000  },
  { id: 'codex-mini-latest',label: 'Codex Mini (latest)',    ctx: 200000  },
];

function getModels() { return provider === 'openai' ? OPENAI_MODELS : GEMINI_MODELS; }

// ── Provider UI ───────────────────────────────────────────
function selectProvider(p) {
  provider = p;
  
  // Toggle Tab active states
  const tabGemini = document.getElementById('tab-gemini');
  const tabOpenai = document.getElementById('tab-openai');
  const panelGemini = document.getElementById('panel-gemini');
  const panelOpenai = document.getElementById('panel-openai');

  if (tabGemini && tabOpenai) {
    tabGemini.classList.toggle('active', p === 'gemini');
    tabOpenai.classList.toggle('active', p === 'openai');
    tabGemini.setAttribute('aria-selected', p === 'gemini');
    tabOpenai.setAttribute('aria-selected', p === 'openai');
  }
  
  // Safely toggle layout panel visibility
  if (panelGemini && panelOpenai) {
    panelGemini.style.display = p === 'gemini' ? 'block' : 'none';
    panelOpenai.style.display = p === 'openai' ? 'block' : 'none';
  }

  populateModelSelect();
}
function populateModelSelect() {
  const sel = document.getElementById('model-select');
  if (!sel) return;
  sel.innerHTML = '';
  
  for (const m of getModels()) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  const first = getModels()[0];
  maxTokens = first ? first.ctx : 128000;
  updateMeter(estimateActiveTokens());
  
  // update layout pill indicators safely
  const pillIcon = document.getElementById('provider-pill-icon');
  const pillLabel = document.getElementById('provider-pill-label');
  if (pillIcon) pillIcon.textContent = provider === 'openai' ? '⬡' : '✦';
  if (pillLabel) pillLabel.textContent = provider === 'openai' ? 'OpenAI / Codex' : 'Gemini';
}

// ── Gemini API ───────────────────────────────────────────
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function geminiGenerate(model, contents) {
  const body = { contents };
  const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data?.usageMetadata || {};
  return { text, usage };
}

// ── OpenAI API ───────────────────────────────────────────
async function openaiGenerate(model, contents) {
  const oaiMessages = contents.map(m => ({
    role: m.role === 'model' ? 'assistant' : m.role,
    content: m.parts.map(p => p.text).join(''),
  }));

  const base = openaiBase.replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: oaiMessages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const usage = { totalTokenCount: data?.usage?.total_tokens || 0 };
  return { text, usage };
}
// ── Unified dispatcher ───────────────────────────────────
async function generate(model, contents) {
  if (provider === 'openai') return openaiGenerate(model, contents);
  return geminiGenerate(model, contents);
}

// ── Token estimation ─────────────────────────────────────
function estimateTokens(text) {
  // Lowering slightly to 3.4 heuristic since this handles developer payloads/code strings well
  return Math.ceil(String(text ?? '').length / 3.4);
}

function estimateContextTokens() {
  let t = 0;
  if (summaryBlob) t += estimateTokens(summaryBlob);
  for (const m of messages) {
    for (const p of m.parts) t += estimateTokens(p.text);
  }
  return t;
}

// Estimate tokens for active messages only (exclude compressed summary)
function estimateActiveTokens() {
  let t = 0;
  for (const m of messages) {
    for (const p of m.parts) t += estimateTokens(p.text);
  }
  return t;
}

// ── Meter UI ─────────────────────────────────────────────
function updateMeter(activeTokens) {
  // activeTokens: tokens from uncompressed (active) messages
  const activeSafe = Math.max(0, Number(activeTokens) || 0);
  const summaryWeight = summaryBlob ? Math.ceil(estimateTokens(summaryBlob) / compressionRatio) : 0;
  const visibleTokens = Math.max(0, activeSafe + summaryWeight);
  totalTokens = visibleTokens;

  const pct = Math.min(visibleTokens / maxTokens, 1);
  const pctInt = Math.round(pct * 100);

  const compressedEl = document.getElementById('meter-bar-compressed');
  const activeEl = document.getElementById('meter-bar-active');
  const count = document.getElementById('token-count');
  const activeCount = document.getElementById('active-count');
  const compressedCount = document.getElementById('compressed-count');
  const pctBadge = document.getElementById('pct-badge');
  const meter = document.getElementById('token-meter-wrap');

  // compute separate percentages
  const compWeight = summaryWeight;
  const compPct = Math.min(compWeight / maxTokens, 1);
  const activePct = Math.min(activeSafe / maxTokens, 1);
  const compWidthPct = compPct * 100;
  const activeWidthPct = Math.min(activePct * 100, Math.max(0, 100 - compWidthPct));

  if (compressedEl) compressedEl.style.width = compWidthPct + '%';
  if (activeEl) {
    activeEl.style.left = compWidthPct + '%';
    activeEl.style.width = activeWidthPct + '%';
  }
  if (count) count.textContent = visibleTokens.toLocaleString();
  if (activeCount) activeCount.textContent = `${activeSafe.toLocaleString()} act`;
  if (compressedCount) compressedCount.textContent = `${summaryWeight.toLocaleString()} comp`;
  if (pctBadge) pctBadge.textContent = `${pctInt}%`;
  if (meter) meter.setAttribute('aria-valuenow', pctInt);

  if (count) {
    if (pct < 0.6) {
      count.className = 'safe';
    } else if (pct < threshold) {
      count.className = 'warn';
    } else {
      count.className = 'danger';
    }
  }

  const maxLabel = document.getElementById('token-max');
  if (maxLabel) {
    maxLabel.textContent = (maxTokens >= 1_000_000) ? (maxTokens / 1_000_000) + 'M' : (maxTokens / 1000) + 'k';
  }
}

// ── Stats sidebar ─────────────────────────────────────────
function updateStats() {
  const turns = document.getElementById('stat-turns');
  const summaries = document.getElementById('stat-summaries');
  const saved = document.getElementById('stat-saved');
  if (turns) turns.textContent = turnCount;
  if (summaries) summaries.textContent = summaryCount;
  if (saved) saved.textContent = tokensSaved >= 1000
    ? (tokensSaved / 1000).toFixed(1) + 'k'
    : tokensSaved;
}

// ── Activity log ──────────────────────────────────────────
function logActivity(text, type = 'default') {
  const el = document.createElement('div');
  el.className = `activity-entry ${type}`;
  el.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  const log = document.getElementById('activity-log');
  if (!log) return;
  log.prepend(el);
  // cap at 20 entries
  while (log.children.length > 20) log.lastChild.remove();
}

// ── Message rendering ─────────────────────────────────────
function removeEmptyState() {
  const es = document.getElementById('empty-state');
  if (es) es.remove();
}

function appendMessage(role, text, tokenEst) {
  const wrap = document.createElement('div');
  wrap.className = `msg-wrap ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? '👤' : role === 'ai' ? '🤖' : '📋';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.innerHTML = `<span>${time}</span>`;
  if (tokenEst !== undefined) {
    const chip = document.createElement('span');
    chip.className = 'token-chip';
    chip.textContent = `~${tokenEst} tok`;
    meta.appendChild(chip);
  }

  body.appendChild(bubble);
  body.appendChild(meta);
  wrap.appendChild(avatar);
  wrap.appendChild(body);

  const messagesEl = document.getElementById('messages');
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrap;
}

function appendSummaryCard(summaryText, savedTokens) {
  const card = document.createElement('div');
  card.className = 'summary-card';
  card.innerHTML = `
    <div class="summary-card-header">
      <div class="summary-card-badge">✨ Compressed</div>
      <div class="summary-card-title">Context Snapshot</div>
      <div class="summary-card-meta">~${savedTokens.toLocaleString()} tok freed</div>
    </div>
    <div class="summary-card-body">${escapeHtml(summaryText).replace(/\n/g, '<br>')}</div>
  `;
  const messagesEl = document.getElementById('messages');
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendTypingIndicator() {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap ai';
  wrap.id = 'typing-wrap';
  wrap.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-body">
      <div class="msg-bubble typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  const messagesEl = document.getElementById('messages');
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return wrap;
}

function removeTypingIndicator() {
  document.getElementById('typing-wrap')?.remove();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Auto-grow textarea ────────────────────────────────────
const textarea = document.getElementById('user-input');
textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px';
  // live token preview
  const est = estimateTokens(textarea.value);
  updateMeter(estimateActiveTokens() + est);
});

textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Threshold slider ──────────────────────────────────────
document.getElementById('threshold-slider').addEventListener('input', function () {
  threshold = this.value / 100;
  document.getElementById('threshold-val').textContent = this.value + '%';
  updateMeter(estimateActiveTokens());
  logActivity(`Threshold set to ${this.value}%`, 'info');
});

// ── Model selector ────────────────────────────────────────
document.getElementById('model-select').addEventListener('change', function () {
  const found = getModels().find(m => m.id === this.value);
  maxTokens = found ? found.ctx : 128000;
  updateMeter(estimateActiveTokens());
  logActivity(`Model: ${this.value}`, 'info');
});

// ── Summarisation ─────────────────────────────────────────
// ── Summarisation with Notification Toasts ────────────────
// ── Summarisation with Interactive Permission Check ──────
async function autoSummarizeIfNeeded() {
  if (messages.length < 2) return;

  const tokens = estimateActiveTokens();

  // If we've hit or exceeded the hard token limit, auto-compress immediately (no prompt)
  if (tokens >= maxTokens) {
    appendMessage('system', '⚡ Token limit reached — compressing history to free context...', 0);
    logActivity('Token limit reached; auto-compressing without prompt', 'summarize');
    // Small UI pause for smoother UX
    await sleep(200);
    await runSummarization();
    return;
  }

  // If over the user-configured threshold (but below hard max), ask for permission first
  if (tokens / maxTokens < threshold) return;

  // Prompt the user for explicit permission via a modal popup box
  const userApproved = confirm("🚨 Context Cop Alert:\n\nYour chat history has passed the threshold percentage limit! Would you like to compress older history turns right now to save context window space?");

  if (userApproved) {
    // If user selects "Yes" (OK), execute compression routines
    appendMessage('system', '⚡ Compressing older history frames to clear context workspace paths...', 0);
    logActivity('Auto-compress approved by user', 'info');

    // Tiny visual break delay for UI smoothness
    await sleep(800);
    await runSummarization();
  } else {
    // If user selects "No" (Cancel), bypass and log activity
    logActivity('Auto-compress deferred by user configuration', 'warn');
  }
}

async function runSummarization(force = false) {
  if (isBusy) {
    logActivity('Wait for the current reply before compressing.', 'warn');
    return;
  }
  const turnsBefore = messages.length;

  // Take oldest half to summarise; manual force compresses everything available.
  const keepCount = Math.max(2, Math.floor(messages.length / 2));
  let toSummarise = force ? messages.slice(0) : messages.slice(0, messages.length - keepCount);
  if (toSummarise.length === 0) return;

  // Token estimate before (active messages + summary for internal bookkeeping)
  let tokensBefore = estimateContextTokens();
  const tokensBeforeActive = estimateActiveTokens();

  setBusy(true);
  showSummarising(true);
  logActivity('Compressing old context…', 'summarize');

  try {
    let summaryText;

    if (demoMode) {
      await sleep(1400);
      const topics = toSummarise
        .filter(m => m.role === 'user')
        .map(m => m.parts[0].text.slice(0, 60))
        .join('; ');
      summaryText = `[DEMO SUMMARY] The conversation so far covered: ${topics || 'the opening context and assistant guidance'}. Key facts were discussed and context maintained.`;
    } else {
      const model = document.getElementById('model-select').value;
      const summaryPrompt = buildSummaryPrompt(toSummarise);
      const { text } = await generate(model, summaryPrompt);
      summaryText = text.trim();
    }

    // Build new summary blob
    const prevBlob = summaryBlob ? summaryBlob + '\n\n' : '';
    summaryBlob = prevBlob + summaryText;

    // Drop old messages, keep recent (if we summarised everything because of force, we may keep none)
    const keepCount2 = (toSummarise.length === messages.length) ? 0 : Math.max(2, Math.floor(messages.length / 2));
    messages = keepCount2 > 0 ? messages.slice(messages.length - keepCount2) : [];

    // Estimate tokens after
    const tokensAfter = estimateContextTokens();
    const tokensAfterActive = estimateActiveTokens();
    const saved = Math.max(0, tokensBeforeActive - tokensAfterActive);
    tokensSaved += saved;
    summaryCount++;
    updateStats();
    updateMeter(tokensAfterActive);

    appendSummaryCard(summaryText, saved);
    logActivity(`Compressed: ${turnsBefore} turns → ${messages.length} (saved ~${saved} tok)`, 'summarize');

  } catch (err) {
    logActivity(`Summarisation error: ${err.message}`, 'warn');
    console.error(err);
  } finally {
    setBusy(false);
    showSummarising(false);
  }
}

function buildSummaryPrompt(msgs) {
  let instructions = `You are a context compression engine. Your task is to update the existing ongoing summary by cleanly integrating the new conversation turns provided below. 
  
Create a single, seamless, consolidated bulleted layout. Preserve all critical technical details, parameters, code schemas, and decisions while avoiding conversational filler.\n\n`;

  if (summaryBlob) {
    instructions += `[Current Summary State]\n${summaryBlob}\n\n`;
  }

  instructions += '[New System Sequence to Integrate]\n';
  for (const m of msgs) {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    instructions += `${role}: ${m.parts[0].text}\n`;
  }
  
  instructions += '\nUpdated Consolidated Summary:';

  return [{
    role: 'user',
    parts: [{ text: instructions }]
  }];
}

// ── Corrected buildContents Structure ────────────────────


// ── Send message ──────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('user-input');
  const text  = input.value.trim();
  if (!text || isBusy) return;
  if (!apiKey && !demoMode) { showKeyModal(); return; }

  removeEmptyState();
  input.value = '';
  input.style.height = 'auto';

  const userTok = estimateTokens(text);
  appendMessage('user', text, userTok);
  turnCount++;
  updateStats();

  messages.push({ role: 'user', parts: [{ text }] });

  setBusy(true);
  const typing = appendTypingIndicator();

  try {
    let aiText;

    if (demoMode) {
      await sleep(900 + Math.random() * 600);
      aiText = getDemoReply(text);
    } else {
      const model = document.getElementById('model-select').value;
      const contents = buildContents();

      const { text: reply, usage } = await generate(model, contents);
      aiText = reply.trim() || '(No response)';

      if (usage?.totalTokenCount) updateMeter(estimateActiveTokens());
    }

    removeTypingIndicator();
    const aiTok = estimateTokens(aiText);
    appendMessage('ai', aiText, aiTok);
    messages.push({ role: 'model', parts: [{ text: aiText }] });
    turnCount++;
    updateStats();

    updateMeter(estimateActiveTokens());
    logActivity(`Turn ${Math.ceil(turnCount / 2)}: ${text.slice(0, 40)}…`);

    // check if auto-compress needed
    setBusy(false);
    await autoSummarizeIfNeeded();

  } catch (err) {
    removeTypingIndicator();
    appendMessage('system', `⚠️ Error: ${err.message}`, 0);
    logActivity(`Error: ${err.message}`, 'warn');
  } finally {
    setBusy(false);
  }
}

function buildContents() {
  const all = [];

  // Inject summary as a context message
  if (summaryBlob) {
    all.push({
      role: 'user',
      parts: [{ text: `[Context from earlier in this conversation]\n${summaryBlob}` }]
    });
    all.push({
      role: 'model',
      parts: [{ text: 'Understood. I have the context from earlier in the conversation.' }]
    });
  }

  // Recent messages
  for (const m of messages) all.push(m);
  return all;
}

// ── Demo mode ────────
const DEMO_REPLIES = [
  "That's a fascinating question! Let me think through this carefully. The topic you're exploring has many dimensions worth considering.",
  "Great point! In essence, this comes down to understanding the underlying principles at play. There are several key factors to consider here.",
  "I'd be happy to help with that! This is a nuanced area where context matters a great deal. Let me walk you through the key ideas.",
  "Absolutely! The short answer is that it depends on several variables. Here's a detailed breakdown of the main concepts involved.",
  "Interesting choice of topic! This subject has fascinated researchers for decades. The core insight is that complexity often emerges from simple rules.",
  "The history here is rich and deep. Starting from the earliest recorded accounts, scholars have noted patterns that continue to shape our understanding today.",
];

let demoReplyIdx = 0;
function getDemoReply(userText) {
  const base = DEMO_REPLIES[demoReplyIdx % DEMO_REPLIES.length];
  demoReplyIdx++;
  const extra = userText.length > 20
    ? ` You asked about "${userText.slice(0, 40)}…" — this connects to broader themes in the field.`
    : '';
  return base + extra + ' ' + generateFiller();
}

function generateFiller() {
  const sentences = [
    'Research suggests multiple pathways to understanding this.',
    'The implications span various domains of knowledge.',
    'Experts continue to debate the finer points of this topic.',
    'Both theoretical and practical perspectives are illuminating here.',
    'Historical context adds important nuance to this discussion.',
  ];
  return sentences[Math.floor(Math.random() * sentences.length)];
}

// ── Utility ───────────────────────────────────────────────
function setBusy(v) {
  isBusy = v;
  const send = document.getElementById('send-btn');
  const input = document.getElementById('user-input');
  if (send) send.disabled = v;
  if (input) input.disabled = v;
}

function showSummarising(v) {
  const banner = document.getElementById('summarising-banner');
  if (!banner) return;
  if (v) banner.classList.add('visible');
  else   banner.classList.remove('visible');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function useHint(el) {
  const input = document.getElementById('user-input');
  input.value = el.textContent;
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Controls ──────────────────────────────────────────────
function forceSummarize() {
  logActivity('Manual summarise requested', 'info');
  // Force summarisation even with few turns
  runSummarization(true);
}

function clearChat() {
  messages = [];
  summaryBlob = null;
  totalTokens = 0;
  turnCount = 0;
  summaryCount = 0;
  tokensSaved = 0;
  demoReplyIdx = 0;
  updateMeter(0);
  updateStats();
  const messagesEl = document.getElementById('messages');
  messagesEl.innerHTML = '';
  messagesEl.innerHTML = `
    <div id="empty-state">
      <div class="big-icon">🚨</div>
      <h3>Context Cop is on duty</h3>
      <p>Chat freely. The live token meter watches your context window and auto-compresses old turns before it overflows.</p>
    </div>`;
  logActivity('Chat cleared', 'info');
}

// ── API Key modal ─────────────────────────────────────────
function saveKey() {
  if (provider === 'openai') {
    const val = document.getElementById('openai-key-input').value.trim();
    if (!val) return;
    apiKey = val;
    const base = document.getElementById('openai-base-input').value.trim();
    if (base) openaiBase = base;
    else openaiBase = 'https://api.openai.com/v1';
  } else {
    const val = document.getElementById('gemini-key-input').value.trim();
    if (!val) return;
    apiKey = val;
  }
  demoMode = false;
  document.body.classList.remove('landing-mode');
  document.body.classList.add('app-mode');
  document.getElementById('landing')?.setAttribute('aria-hidden', 'true');
  populateModelSelect();
  document.getElementById('key-modal-bg').style.display = 'none';
  const pLabel = provider === 'openai' ? 'OpenAI / Codex' : 'Gemini';
  logActivity(`Connected: ${pLabel}`, 'info');
}

function useDemoMode() {
  document.body.classList.remove('landing-mode');
  document.body.classList.add('app-mode');
  document.getElementById('landing')?.setAttribute('aria-hidden', 'true');
  demoMode = true;
  apiKey = '';
  populateModelSelect();
  document.getElementById('key-modal-bg').style.display = 'none';
  if (messages.length > 0) {
    logActivity('Demo mode active (no real API calls)', 'info');
    document.getElementById('user-input')?.focus({ preventScroll: true });
    return;
  }
  logActivity('Demo mode active (no real API calls)', 'info');
  removeEmptyState();
  appendMessage('ai', '👋 Welcome to Context Cop Demo Mode!\n\nI\'m a simulated assistant. Chat freely — the token meter tracks estimated usage and will auto-compress when you hit the threshold. Try the hint chips below or ask me anything!', estimateTokens('Welcome'));
  messages.push({ role: 'model', parts: [{ text: 'Welcome to demo mode!' }] });
  updateMeter(estimateActiveTokens());
  document.getElementById('user-input')?.focus({ preventScroll: true });
}

function showKeyModal() {
  document.getElementById('key-modal-bg').style.display = 'flex';
}

// Enter to connect on key fields
['gemini-key-input','openai-key-input','openai-base-input'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveKey();
  });
});

// ── Backend connectivity check ─────────────────────────────────
async function checkBackend() {
  logActivity('Checking backend connectivity…', 'info');
  const btn = document.getElementById('check-conn-btn');
  const orig = btn ? btn.textContent : '';
  if (btn) btn.textContent = 'Checking…';

  try {
    if (demoMode) {
      logActivity('Demo mode is active; no backend needed', 'info');
      alert('Demo mode is active. No backend or provider API is being used.');
      return;
    }

    // Try a local health check first (conventional proxy endpoint)
    if (window.location.protocol !== 'file:') {
      const res = await fetch('/health', { cache: 'no-cache' });
      if (res.ok) {
        logActivity('Backend /health responded OK', 'info');
        alert('Backend reachable at /health');
        return;
      }
    }

    // Provider-specific sanity checks (best-effort; may be subject to CORS)
    if (provider === 'openai' && apiKey) {
      const base = openaiBase.replace(/\/$/, '');
      const res = await fetch(`${base}/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (res.ok) { logActivity('OpenAI API reachable', 'info'); alert('OpenAI reachable'); return; }
      throw new Error(`OpenAI probe returned HTTP ${res.status}`);
    }

    if (provider === 'gemini' && apiKey) {
      // Best-effort probe for Gemini base (may 403/CORS); still useful to attempt
      const res = await fetch(`${GEMINI_BASE}?key=${apiKey}`);
      if (res.ok) { logActivity('Gemini API reachable', 'info'); alert('Gemini reachable'); return; }
      throw new Error(`Gemini probe returned HTTP ${res.status}`);
    }

    throw new Error('No /health endpoint found and no provider key is connected.');
  } catch (err) {
    logActivity(`Connectivity check failed: ${err.message}`, 'warn');
    alert('Connectivity check failed (see activity log).');
  } finally {
    if (btn) btn.textContent = orig;
  }
}

// ── Init ──────────────────────────────────────────────────
populateModelSelect();
updateMeter(0);
updateStats();
logActivity('Context Cop initialised', 'info');
