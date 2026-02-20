/**
 * SpeakMate — Chat UI
 *
 * Voice-first interface with:
 * - Agent carousel switching
 * - SSE streaming chat
 * - Correction cards (red → green)
 * - Vocabulary chips
 * - Web Speech API voice input
 * - TTS playback
 */

// ============================================================
// State
// ============================================================

let token = localStorage.getItem('sm_token');
let currentAgent = 'general';
let agents = [];
let isStreaming = false;
let recognition = null;
let isRecording = false;

// ============================================================
// Auth Check
// ============================================================

if (!token) {
  window.location.href = '/';
}

// ============================================================
// Init
// ============================================================

async function init() {
  await loadAgents();
  setupVoiceInput();
  setupTextInput();
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
}

// ============================================================
// Agents
// ============================================================

async function loadAgents() {
  try {
    const res = await fetch('/api/agents');
    const data = await res.json();
    agents = data.agents;
    renderAgentBar();
    selectAgent(agents[0].id);
  } catch (err) {
    console.error('Failed to load agents:', err);
  }
}

function renderAgentBar() {
  const bar = document.getElementById('agentBar');
  bar.innerHTML = agents.map(a =>
    `<button class="agent-chip" data-id="${a.id}" onclick="selectAgent('${a.id}')">
      <span class="chip-emoji">${a.emoji}</span>
      <span>${a.name}</span>
    </button>`
  ).join('');
}

function selectAgent(id) {
  currentAgent = id;
  const agent = agents.find(a => a.id === id);

  // Update chips
  document.querySelectorAll('.agent-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.id === id);
  });

  // Update welcome
  const welcome = document.getElementById('welcomeMsg');
  if (welcome) {
    welcome.querySelector('.welcome-emoji').textContent = agent.emoji;
    welcome.querySelector('h2').textContent = `Hey! I'm ${agent.name}`;
    welcome.querySelector('p').textContent = agent.description;
  }

  // Update placeholder
  const input = document.getElementById('messageInput');
  if (agent.targetLanguage === 'pt-BR') {
    input.placeholder = 'Try some Portuguese...';
  } else {
    input.placeholder = 'Type in English...';
  }
}

// Make globally accessible for onclick
window.selectAgent = selectAgent;

// ============================================================
// Chat
// ============================================================

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || isStreaming) return;

  // Remove welcome
  const welcome = document.getElementById('welcomeMsg');
  if (welcome) welcome.remove();

  // Add user bubble
  addMessage('user', text);
  input.value = '';
  autoResize(input);

  // Show thinking
  const thinkingEl = showThinking();
  isStreaming = true;
  document.getElementById('sendBtn').disabled = true;

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ message: text, agentId: currentAgent }),
    });

    if (res.status === 401) {
      localStorage.removeItem('sm_token');
      window.location.href = '/';
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullRaw = '';
    let bubbleEl = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const event = JSON.parse(trimmed.slice(6));

          if (event.type === 'chunk') {
            fullRaw += event.content;

            // Remove thinking on first chunk
            if (thinkingEl && thinkingEl.parentNode) {
              thinkingEl.remove();
            }

            // Create or update streaming bubble
            if (!bubbleEl) {
              bubbleEl = addStreamingBubble();
            }
            updateStreamingBubble(bubbleEl, fullRaw);
          }

          if (event.type === 'done' && event.parsed) {
            // Replace streaming bubble with final parsed version
            if (bubbleEl) bubbleEl.remove();
            addParsedMessage(event.parsed);
          }

          if (event.type === 'error') {
            if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
            if (bubbleEl) bubbleEl.remove();
            addMessage('assistant', `Error: ${event.error}`);
          }
        } catch (e) { /* skip malformed JSON */ }
      }
    }
  } catch (err) {
    if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
    addMessage('assistant', `Connection error: ${err.message}`);
  }

  isStreaming = false;
  document.getElementById('sendBtn').disabled = false;
  scrollToBottom();
}

// ============================================================
// Message Rendering
// ============================================================

function addMessage(role, text) {
  const chatArea = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = `message ${role}`;

  if (role === 'assistant') {
    const agent = agents.find(a => a.id === currentAgent);
    div.innerHTML = `
      <div class="agent-label">${agent ? agent.emoji + ' ' + agent.name : ''}</div>
      <div class="bubble">${escapeHtml(text)}</div>
    `;
  } else {
    div.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  }

  chatArea.appendChild(div);
  scrollToBottom();
  return div;
}

function addStreamingBubble() {
  const chatArea = document.getElementById('chatArea');
  const agent = agents.find(a => a.id === currentAgent);
  const div = document.createElement('div');
  div.className = 'message assistant streaming';
  div.innerHTML = `
    <div class="agent-label">${agent ? agent.emoji + ' ' + agent.name : ''}</div>
    <div class="bubble"></div>
  `;
  chatArea.appendChild(div);
  scrollToBottom();
  return div;
}

function updateStreamingBubble(el, raw) {
  // Show raw text during streaming (strip tags for display)
  const display = raw
    .replace(/\[RESPONSE\]/g, '').replace(/\[\/RESPONSE\]/g, '')
    .replace(/\[CORRECTION\][\s\S]*?(\[\/CORRECTION\]|$)/g, '')
    .replace(/\[VOCAB\][\s\S]*?(\[\/VOCAB\]|$)/g, '')
    .trim();
  el.querySelector('.bubble').textContent = display;
  scrollToBottom();
}

function addParsedMessage(parsed) {
  const chatArea = document.getElementById('chatArea');
  const agent = agents.find(a => a.id === currentAgent);
  const div = document.createElement('div');
  div.className = 'message assistant';

  let html = `<div class="agent-label">${agent ? agent.emoji + ' ' + agent.name : ''}</div>`;
  html += `<div class="bubble">${escapeHtml(parsed.response)}</div>`;

  // Play TTS button
  const safeText = parsed.response.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');
  html += `<button class="play-btn" onclick="playTTS(this, '${safeText}')">🔊 Play</button>`;

  // Correction cards
  if (parsed.corrections && parsed.corrections.length > 0) {
    for (const c of parsed.corrections) {
      html += `
        <div class="correction-card">
          <div class="corr-header">✏️ Correction</div>
          <div class="corr-original">❌ ${escapeHtml(c.original)}</div>
          <div class="corr-fixed">✅ ${escapeHtml(c.corrected)}</div>
          ${c.rule ? `<div class="corr-rule">📝 ${escapeHtml(c.rule)}</div>` : ''}
        </div>
      `;
    }
  }

  // Vocabulary chips
  if (parsed.vocabulary && parsed.vocabulary.length > 0) {
    html += '<div class="vocab-row">';
    for (const v of parsed.vocabulary) {
      html += `<span class="vocab-chip">${escapeHtml(v.word)} <span class="vocab-arrow">→</span> ${escapeHtml(v.alternatives)}</span>`;
    }
    html += '</div>';
  }

  div.innerHTML = html;
  chatArea.appendChild(div);
  scrollToBottom();
}

function showThinking() {
  const chatArea = document.getElementById('chatArea');
  const div = document.createElement('div');
  div.className = 'thinking';
  div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  chatArea.appendChild(div);
  scrollToBottom();
  return div;
}

// ============================================================
// TTS Playback
// ============================================================

let currentAudio = null;

async function playTTS(btn, text) {
  // Stop if already playing
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    document.querySelectorAll('.play-btn.playing').forEach(b => {
      b.classList.remove('playing');
      b.textContent = '🔊 Play';
    });
  }

  btn.textContent = '⏳ Loading...';

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ text, agentId: currentAgent }),
    });

    if (!res.ok) throw new Error('TTS failed');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    currentAudio = new Audio(url);
    btn.textContent = '⏹ Stop';
    btn.classList.add('playing');
    currentAudio.play();
    currentAudio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      btn.textContent = '🔊 Play';
      btn.classList.remove('playing');
    };
  } catch (err) {
    console.error('TTS error:', err);
    btn.textContent = '🔊 Play';
  }
}

// Make globally accessible for onclick
window.playTTS = playTTS;

// ============================================================
// Voice Input (Web Speech API)
// ============================================================

function setupVoiceInput() {
  const micBtn = document.getElementById('micBtn');

  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    micBtn.style.opacity = '0.3';
    micBtn.title = 'Speech recognition not supported in this browser';
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    const input = document.getElementById('messageInput');
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    input.value = transcript;
    autoResize(input);
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove('recording');
    micBtn.textContent = '🎤';

    // Auto-send if we got text
    const input = document.getElementById('messageInput');
    if (input.value.trim()) {
      sendMessage();
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech error:', event.error);
    isRecording = false;
    micBtn.classList.remove('recording');
    micBtn.textContent = '🎤';
  };

  micBtn.addEventListener('click', toggleRecording);
}

function toggleRecording() {
  if (!recognition) return;

  if (isRecording) {
    recognition.stop();
  } else {
    // Update language for current agent
    recognition.lang = currentAgent === 'brasileiro' ? 'pt-BR' : 'en-US';
    recognition.start();
    isRecording = true;
    document.getElementById('micBtn').classList.add('recording');
    document.getElementById('micBtn').textContent = '⏹';
  }
}

// ============================================================
// Text Input
// ============================================================

function setupTextInput() {
  const input = document.getElementById('messageInput');

  input.addEventListener('input', () => autoResize(input));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// ============================================================
// Utilities
// ============================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  const chatArea = document.getElementById('chatArea');
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ============================================================
// Start
// ============================================================

init();
