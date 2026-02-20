/**
 * ALLMA — Chat Frontend
 *
 * Handles:
 * - Auth check + redirect
 * - Onboarding flow
 * - Chat messaging with SSE streaming
 * - Language switching
 * - History loading
 */

// ============================================================
// State
// ============================================================

let currentUser = null;
let currentLanguage = 'en';
let isStreaming = false;

// DOM Elements
const messagesContainer = document.getElementById('messagesContainer');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const sessionWarning = document.getElementById('sessionWarning');
const onboardingModal = document.getElementById('onboardingModal');
const onboardingForm = document.getElementById('onboardingForm');
const logoutBtn = document.getElementById('logoutBtn');

// ============================================================
// Auth
// ============================================================

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();

    if (!data.authenticated) {
      window.location.href = '/';
      return;
    }

    currentUser = data.user;
    // Priority: localStorage (user's explicit choice) > server session > default 'en'
    const storedLang = localStorage.getItem('allma_lang');
    currentLanguage = storedLang || data.user.language || 'en';
    // Sync localStorage with resolved language
    localStorage.setItem('allma_lang', currentLanguage);
    updateLanguageButtons();

    // Check if onboarding needed
    if (data.user.needsOnboarding) {
      showOnboarding();
    } else {
      await loadHistory();
      showWelcomeIfEmpty();
    }
  } catch (err) {
    console.error('Auth check failed:', err);
    window.location.href = '/';
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {}
  window.location.href = '/';
}

// ============================================================
// Onboarding
// ============================================================

function showOnboarding() {
  onboardingModal.style.display = 'flex';
}

onboardingForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const lang = currentLanguage || 'en';
  const t = uiTranslations.onboarding[lang] || uiTranslations.onboarding.en;

  const answers = [
    document.getElementById('q1').value.trim(),
    document.getElementById('q2').value.trim(),
    document.getElementById('q3').value.trim(),
  ].filter(a => a.length > 0);

  if (answers.length === 0) {
    alert(t.alertEmpty);
    return;
  }

  const btn = onboardingForm.querySelector('button');
  btn.disabled = true;
  btn.textContent = t.btnLoading;

  try {
    await fetch('/api/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
      credentials: 'include',
    });

    onboardingModal.style.display = 'none';
    showWelcomeIfEmpty();
  } catch (err) {
    console.error('Onboarding failed:', err);
    btn.disabled = false;
    btn.textContent = t.btn;
  }
});

// ============================================================
// Messages
// ============================================================

function addMessage(role, text, options = {}) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  if (options.crisis) msg.classList.add('crisis');
  if (options.streaming) msg.classList.add('streaming-cursor');
  if (options.welcome) msg.classList.add('welcome-msg');
  if (options.id) msg.id = options.id;

  msg.innerHTML = formatText(text);
  messagesContainer.appendChild(msg);
  scrollToBottom();
  return msg;
}

function addTypingIndicator() {
  const thinkingLabels = {
    en: 'ALLMA is thinking',
    pl: 'ALLMA myśli',
    pt: 'ALLMA está pensando',
    es: 'ALLMA está pensando',
    de: 'ALLMA denkt nach',
    fr: 'ALLMA réfléchit',
    it: 'ALLMA sta pensando',
    zh: 'ALLMA 正在思考',
  };
  const el = document.createElement('div');
  el.className = 'typing-indicator';
  el.id = 'typingIndicator';
  el.innerHTML = `<span class="typing-label">${thinkingLabels[currentLanguage] || thinkingLabels.en}</span><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>`;
  messagesContainer.appendChild(el);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

function showWelcomeIfEmpty() {
  if (messagesContainer.children.length === 0) {
    const greetings = {
      en: "Hi! I'm ALLMA, your personal psychology coach. I'm here to help you explore your thoughts, patterns, and growth. What's on your mind today?",
      pl: "Cześć! Jestem ALLMA, Twój osobisty coach psychologiczny. Jestem tu, żeby pomóc Ci zrozumieć swoje myśli, wzorce i rozwój. Co chodziło Ci dziś po głowie?",
      pt: "Oi! Sou a ALLMA, sua coach pessoal de psicologia. Estou aqui para ajudar você a explorar seus pensamentos, padrões e crescimento. O que está na sua mente hoje?",
      es: "¡Hola! Soy ALLMA, tu coach personal de psicología. Estoy aquí para ayudarte a explorar tus pensamientos, patrones y crecimiento. ¿Qué tienes en mente hoy?",
      de: "Hallo! Ich bin ALLMA, dein persönlicher Psychologie-Coach. Ich bin hier, um dir zu helfen, deine Gedanken, Muster und dein Wachstum zu erkunden. Was beschäftigt dich heute?",
      fr: "Bonjour ! Je suis ALLMA, votre coach personnel en psychologie. Je suis là pour vous aider à explorer vos pensées, vos schémas et votre développement. Qu'avez-vous en tête aujourd'hui ?",
      it: "Ciao! Sono ALLMA, il tuo coach personale di psicologia. Sono qui per aiutarti a esplorare i tuoi pensieri, schemi e crescita. Cosa hai in mente oggi?",
      zh: "你好！我是ALLMA，你的个人心理教练。我在这里帮助你探索你的想法、模式和成长。今天你在想什么？",
    };
    addMessage('assistant', greetings[currentLanguage] || greetings.en, { welcome: true });
  }
}

function formatText(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (```...```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Blockquotes (> text)
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists (- item or * item)
  html = html.replace(/(?:^|\n)((?:[-*]\s.+\n?)+)/g, (match, items) => {
    const lis = items.replace(/^[-*]\s(.+)$/gm, '<li>$1</li>');
    return `<ul>${lis}</ul>`;
  });

  // Ordered lists (1. item)
  html = html.replace(/(?:^|\n)((?:\d+\.\s.+\n?)+)/g, (match, items) => {
    const lis = items.replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>');
    return `<ol>${lis}</ol>`;
  });

  // Headers (### h3, ## h2, # h1)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h3>$1</h3>');

  // Line breaks (but not inside pre/ul/ol)
  html = html.replace(/\n/g, '<br>');

  // Clean up double breaks around block elements
  html = html.replace(/<br>\s*(<\/?(?:pre|ul|ol|li|blockquote|h[1-4]))/g, '$1');
  html = html.replace(/(<\/(?:pre|ul|ol|li|blockquote|h[1-4])>)\s*<br>/g, '$1');

  return html;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ============================================================
// Load History
// ============================================================

async function loadHistory() {
  try {
    const res = await fetch('/api/history', { credentials: 'include' });
    const data = await res.json();

    if (data.messages && data.messages.length > 0) {
      for (const msg of data.messages) {
        addMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
      }
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

// ============================================================
// Send Message (SSE Streaming)
// ============================================================

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isStreaming) return;

  // Add user message
  addMessage('user', text);
  chatInput.value = '';
  chatInput.style.height = 'auto';
  isStreaming = true;
  sendBtn.disabled = true;
  sendBtn.classList.add('sending');

  // Show typing indicator
  addTypingIndicator();

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        language: currentLanguage,
        agent: selectedAgent !== 'core' ? selectedAgent : undefined,
      }),
      credentials: 'include',
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // Session expired — redirect to login
        window.location.href = '/';
        return;
      }
      if (res.status === 429) {
        const rateLimitMsgs = {
          en: 'Too many messages. Please wait a moment.',
          pl: 'Za dużo wiadomości. Poczekaj chwilę.',
          pt: 'Muitas mensagens. Aguarde um momento.',
          es: 'Demasiados mensajes. Espera un momento.',
          de: 'Zu viele Nachrichten. Bitte warte einen Moment.',
          fr: 'Trop de messages. Veuillez patienter.',
          it: 'Troppi messaggi. Attendi un momento.',
          zh: '消息太多。请稍等。',
        };
        throw new Error(rateLimitMsgs[currentLanguage] || rateLimitMsgs.en);
      }
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    // Remove typing, start streaming
    removeTypingIndicator();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let msgEl = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));

          if (data.error) {
            if (msgEl) {
              msgEl.classList.remove('streaming-cursor');
              msgEl.innerHTML = formatText(fullText + '\n\n[Error: ' + data.error + ']');
            } else {
              addMessage('system', 'Error: ' + data.error);
            }
            break;
          }

          if (data.done) {
            // Stream complete
            if (msgEl) {
              msgEl.classList.remove('streaming-cursor');
              msgEl.innerHTML = formatText(fullText);
            }

            // Show crisis class if needed
            if (data.isCrisis && msgEl) {
              msgEl.classList.add('crisis');
            }

            // Update specialist badge
            if (data.specialistDomain) {
              updateSpecialistBadge(data.specialistDomain);
            }

            // Emotional Resonance — set aura on message
            if (data.emotion && data.emotion !== 'neutral' && msgEl) {
              msgEl.setAttribute('data-emotion', data.emotion);
            }
            break;
          }

          if (data.text) {
            fullText += data.text;
            if (!msgEl) {
              msgEl = addMessage('assistant', '', { streaming: true });
            }
            msgEl.innerHTML = formatText(fullText);
            scrollToBottom();
          }
        } catch (e) {
          // Skip malformed JSON
        }
      }
    }

    // Ensure streaming cursor is removed
    if (msgEl) {
      msgEl.classList.remove('streaming-cursor');
    }

  } catch (err) {
    removeTypingIndicator();
    console.error('Chat error:', err);

    const errorMessages = {
      en: { msg: 'Connection lost. Please check your internet and try again.', retry: 'Retry' },
      pl: { msg: 'Połączenie przerwane. Sprawdź internet i spróbuj ponownie.', retry: 'Ponów' },
      pt: { msg: 'Conexão perdida. Verifique sua internet e tente novamente.', retry: 'Tentar novamente' },
      es: { msg: 'Conexión perdida. Revisa tu internet e inténtalo de nuevo.', retry: 'Reintentar' },
      de: { msg: 'Verbindung verloren. Bitte überprüfe dein Internet und versuche es erneut.', retry: 'Erneut versuchen' },
      fr: { msg: 'Connexion perdue. Vérifiez votre internet et réessayez.', retry: 'Réessayer' },
      it: { msg: 'Connessione persa. Controlla la tua connessione e riprova.', retry: 'Riprova' },
      zh: { msg: '连接中断。请检查网络后重试。', retry: '重试' },
    };
    const errI18n = errorMessages[currentLanguage] || errorMessages.en;

    // Show error with retry button
    const errEl = document.createElement('div');
    errEl.className = 'message system error-message';
    errEl.innerHTML = `
      <span>${errI18n.msg}</span>
      <button class="retry-btn" onclick="this.parentElement.remove(); sendMessage();">${errI18n.retry}</button>
    `;
    messagesContainer.appendChild(errEl);
    scrollToBottom();

    // Re-populate input with the failed message so user can retry
    if (!chatInput.value.trim()) {
      const lastUserMsg = [...messagesContainer.querySelectorAll('.message.user')].pop();
      if (lastUserMsg) chatInput.value = lastUserMsg.textContent;
    }
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove('sending');
    chatInput.focus();
  }
}

// ============================================================
// Language Switching
// ============================================================

function updateLanguageButtons() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLanguage);
  });
  // Update dropdown label
  if (currentLangLabel) {
    currentLangLabel.textContent = currentLanguage.toUpperCase();
  }
}

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentLanguage = btn.dataset.lang;
    localStorage.setItem('allma_lang', currentLanguage);
    applyLanguageToUI();
  });
});

// ============================================================
// Input Handling
// ============================================================

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

// Send on Enter (Shift+Enter for newline)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Send button
sendBtn.addEventListener('click', sendMessage);

// Logout
logoutBtn.addEventListener('click', logout);

// ============================================================
// Delete History
// ============================================================

async function handleDeleteHistory(e) {
  e.preventDefault();
  const lang = currentLanguage || 'en';
  const confirmMsg = uiTranslations.deleteConfirm?.[lang] || uiTranslations.deleteConfirm?.en || 'Delete all conversation history?';
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/history', { method: 'DELETE', credentials: 'include' });
    const data = await res.json();
    if (data.ok) {
      // Clear messages from UI
      if (messagesContainer) messagesContainer.innerHTML = '';
      showWelcomeIfEmpty();
    } else {
      console.error('Delete failed:', data.error);
    }
  } catch (err) {
    console.error('Delete history error:', err);
  }
}

// Attach handler on initial load
const deleteHistoryLink = document.getElementById('deleteHistoryLink');
if (deleteHistoryLink) deleteHistoryLink.addEventListener('click', handleDeleteHistory);

// ============================================================
// Theme Toggle (dark/light)
// ============================================================

const themeToggle = document.getElementById('themeToggle');

function getPreferredTheme() {
  const saved = localStorage.getItem('allma_theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('allma_theme', theme);
  if (themeToggle) {
    themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
  // PWA: update status bar / title bar color
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.content = theme === 'dark' ? '#1A1A2E' : '#FAF8F5';
  }
}

// Init theme
applyTheme(getPreferredTheme());

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

// Listen for system theme changes (only if no explicit preference)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('allma_theme')) {
    applyTheme(e.matches ? 'dark' : 'light');
  }
});

// ============================================================
// Specialist Badge
// ============================================================

const specialistBadge = document.getElementById('specialistBadge');
const badgeEmoji = document.getElementById('badgeEmoji');
const badgeName = document.getElementById('badgeName');

const specialistMap = {
  core: { emoji: '🧠', name: 'Core Coach' },
  relations: { emoji: '❤️', name: 'Relations' },
  career: { emoji: '💼', name: 'Career' },
  body: { emoji: '🏃', name: 'Body & Fitness' },
  mindfulness: { emoji: '🧘', name: 'Mindfulness' },
  habits: { emoji: '⚡', name: 'Habits' },
  shadow: { emoji: '🪞', name: 'Shadow' },
  nutrition: { emoji: '🥗', name: 'Nutrition' },
};

function updateSpecialistBadge(domain) {
  const spec = specialistMap[domain];
  if (!spec || !specialistBadge) return;
  badgeEmoji.textContent = spec.emoji;
  badgeName.textContent = spec.name;
  specialistBadge.style.display = 'inline-flex';
}

// ============================================================
// Language Dropdown (mobile)
// ============================================================

const langDropdownToggle = document.getElementById('langDropdownToggle');
const langDropdownMenu = document.getElementById('langDropdownMenu');
const currentLangLabel = document.getElementById('currentLangLabel');

if (langDropdownToggle && langDropdownMenu) {
  langDropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    langDropdownMenu.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', () => {
    langDropdownMenu.classList.remove('open');
  });

  langDropdownMenu.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentLanguage = btn.dataset.lang;
      localStorage.setItem('allma_lang', currentLanguage);
      langDropdownMenu.classList.remove('open');
      applyLanguageToUI();
    });
  });
}

// ============================================================
// Voice Input (Web Speech API)
// ============================================================

const micBtn = document.getElementById('micBtn');
let recognition = null;
let isRecording = false;

// Language codes for Web Speech API
const speechLangMap = {
  en: 'en-US', pl: 'pl-PL', pt: 'pt-BR', es: 'es-ES',
  de: 'de-DE', fr: 'fr-FR', it: 'it-IT', zh: 'zh-CN',
};

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.classList.add('unsupported');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        recognition._finalTranscript = (recognition._finalTranscript || '') + transcript + ' ';
      } else {
        interim = transcript;
      }
    }
    chatInput.value = (recognition._finalTranscript || '') + interim;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  };

  recognition.onerror = (event) => {
    console.error('[Voice] Error:', event.error);
    stopRecording();
  };

  recognition.onend = () => {
    if (isRecording) {
      // Auto-stopped — finalize
      stopRecording();
    }
  };

  micBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
}

function startRecording() {
  if (!recognition) return;
  // Append to existing input text
  const existing = chatInput.value.trim();
  recognition._finalTranscript = existing ? existing + ' ' : '';
  recognition.lang = speechLangMap[currentLanguage] || 'en-US';
  isRecording = true;
  micBtn.classList.add('recording');
  micBtn.title = 'Stop recording';
  recognition.start();
}

function stopRecording() {
  if (!recognition) return;
  isRecording = false;
  micBtn.classList.remove('recording');
  micBtn.title = 'Voice input';
  try { recognition.stop(); } catch {}
  // Reset finalTranscript for next session
  // (value is already in the input)
}

initSpeechRecognition();

// ============================================================
// Agent Tile Selection (left sidebar)
// ============================================================

let selectedAgent = 'core'; // 'core' = auto-routing

const agentTiles = document.querySelectorAll('.agent-tile');
const agentNames = {
  en: { core: 'Auto', relations: 'Relations', career: 'Career', body: 'Body', mindfulness: 'Mind', habits: 'Habits', shadow: 'Shadow', nutrition: 'Nutrition' },
  pl: { core: 'Auto', relations: 'Relacje', career: 'Kariera', body: 'Ciało', mindfulness: 'Umysł', habits: 'Nawyki', shadow: 'Cień', nutrition: 'Dietetyka' },
  pt: { core: 'Auto', relations: 'Relações', career: 'Carreira', body: 'Corpo', mindfulness: 'Mente', habits: 'Hábitos', shadow: 'Sombra', nutrition: 'Nutrição' },
  es: { core: 'Auto', relations: 'Relaciones', career: 'Carrera', body: 'Cuerpo', mindfulness: 'Mente', habits: 'Hábitos', shadow: 'Sombra', nutrition: 'Nutrición' },
  de: { core: 'Auto', relations: 'Beziehung', career: 'Karriere', body: 'Körper', mindfulness: 'Geist', habits: 'Gewohn.', shadow: 'Schatten', nutrition: 'Ernähr.' },
  fr: { core: 'Auto', relations: 'Relations', career: 'Carrière', body: 'Corps', mindfulness: 'Esprit', habits: 'Habitudes', shadow: 'Ombre', nutrition: 'Nutrition' },
  it: { core: 'Auto', relations: 'Relazioni', career: 'Carriera', body: 'Corpo', mindfulness: 'Mente', habits: 'Abitudini', shadow: 'Ombra', nutrition: 'Nutrizione' },
  zh: { core: '自动', relations: '关系', career: '职业', body: '身体', mindfulness: '正念', habits: '习惯', shadow: '阴影', nutrition: '营养' },
};

function updateAgentTileNames() {
  const names = agentNames[currentLanguage] || agentNames.en;
  agentTiles.forEach(tile => {
    const id = tile.dataset.agent;
    const nameEl = tile.querySelector('.agent-tile-name');
    if (nameEl && names[id]) nameEl.textContent = names[id];
  });
}

agentTiles.forEach(tile => {
  tile.addEventListener('click', () => {
    selectedAgent = tile.dataset.agent;
    agentTiles.forEach(t => t.classList.remove('active'));
    tile.classList.add('active');

    // Update badge immediately
    if (selectedAgent !== 'core') {
      updateSpecialistBadge(selectedAgent);
    }

    // Close mobile sidebar + backdrop
    closeSidebar();
  });
});

// ============================================================
// ALLMA Logo Click → Reset to Auto (Core) agent
// ============================================================

const headerLogo = document.querySelector('.chat-header-logo');
const headerTitle = document.querySelector('.chat-header h1');
[headerLogo, headerTitle].forEach(el => {
  if (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      selectedAgent = 'core';
      agentTiles.forEach(t => t.classList.remove('active'));
      const coreTile = document.querySelector('.agent-tile[data-agent="core"]');
      if (coreTile) coreTile.classList.add('active');
      // Hide specialist badge
      const badge = document.getElementById('specialistBadge');
      if (badge) badge.style.display = 'none';
    });
  }
});

// ============================================================
// Sidebar Toggle (mobile)
// ============================================================

const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarLeft = document.getElementById('sidebarLeft');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

function openSidebar() {
  if (sidebarLeft) sidebarLeft.classList.add('open');
  if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
}

function closeSidebar() {
  if (sidebarLeft) sidebarLeft.classList.remove('open');
  if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
}

if (sidebarToggle && sidebarLeft) {
  sidebarToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sidebarLeft.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  // Backdrop click closes sidebar
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeSidebar);
  }

  // Close sidebar on click outside
  document.addEventListener('click', (e) => {
    if (sidebarLeft.classList.contains('open') && !sidebarLeft.contains(e.target) && e.target !== sidebarToggle) {
      closeSidebar();
    }
  });
}

// ============================================================
// Calorie Bar (updated from nutrition agent responses)
// ============================================================

const calorieTotal = document.getElementById('calorieTotal');
const calorieProtein = document.getElementById('calorieProtein');
const calorieCarbs = document.getElementById('calorieCarbs');
const calorieFat = document.getElementById('calorieFat');

function updateCalorieBar(data) {
  if (calorieTotal && data.kcal !== undefined) {
    calorieTotal.textContent = `${data.kcal} kcal`;
  }
  if (calorieProtein && data.protein !== undefined) {
    calorieProtein.textContent = `P: ${data.protein}g`;
  }
  if (calorieCarbs && data.carbs !== undefined) {
    calorieCarbs.textContent = `C: ${data.carbs}g`;
  }
  if (calorieFat && data.fat !== undefined) {
    calorieFat.textContent = `F: ${data.fat}g`;
  }
}

// ============================================================
// Calorie Tip — Time-aware food suggestions
// ============================================================

const calorieTipEl = document.getElementById('calorieTip');

const calorieTips = {
  en: {
    morning: [
      "💡 Morning tip: Start with protein — eggs, Greek yogurt, or cottage cheese will keep you full longer.",
      "💡 Morning energy: Oatmeal with nuts and fruit is a great steady-energy breakfast.",
      "💡 Don't skip breakfast — even a small meal kickstarts your metabolism.",
    ],
    lunch: [
      "💡 Lunchtime: A balanced plate = ½ veggies, ¼ protein, ¼ complex carbs.",
      "💡 Stay hydrated — sometimes hunger is actually thirst. Drink a glass of water.",
      "💡 Add colorful vegetables to your lunch — more colors = more nutrients.",
    ],
    afternoon: [
      "💡 Afternoon snack: Try nuts, fruit, or hummus with veggies instead of chips.",
      "💡 Energy dip? A handful of almonds or a banana can help without the sugar crash.",
      "💡 If you're craving sweets, try dark chocolate (70%+) — it's satisfying in small amounts.",
    ],
    evening: [
      "💡 Light dinner tip: Lean protein + vegetables. Avoid heavy carbs before sleep.",
      "💡 Evening: A warm soup or salad keeps you light and helps you sleep better.",
      "💡 Try to finish eating 2-3 hours before bed for better digestion and sleep.",
    ],
    night: [
      "🌙 It's late — if you're hungry, opt for herbal tea or a small handful of nuts.",
      "🌙 Nighttime: Your body is winding down. Avoid heavy meals now.",
      "🌙 Late night? Warm milk or chamomile tea can satisfy without heavy eating.",
    ],
  },
  pl: {
    morning: [
      "💡 Poranna rada: Zacznij od białka — jajka, jogurt grecki lub twarożek nasycą na dłużej.",
      "💡 Poranna energia: Owsianka z orzechami i owocami to super start dnia.",
      "💡 Nie pomijaj śniadania — nawet mały posiłek pobudza metabolizm.",
    ],
    lunch: [
      "💡 Pora lunchu: Zbilansowany talerz = ½ warzywa, ¼ białko, ¼ węglowodany złożone.",
      "💡 Pij wodę — czasem głód to tak naprawdę pragnienie. Wypij szklankę wody.",
      "💡 Dodaj kolorowe warzywa — więcej kolorów = więcej składników odżywczych.",
    ],
    afternoon: [
      "💡 Popołudniowa przekąska: Orzechy, owoce lub hummus z warzywami zamiast chipsów.",
      "💡 Spadek energii? Garść migdałów lub banan pomoże bez skoku cukru.",
      "💡 Ochota na słodycze? Spróbuj gorzkiej czekolady (70%+) — mała ilość zaspokaja.",
    ],
    evening: [
      "💡 Lekka kolacja: Chude białko + warzywa. Unikaj ciężkich węglowodanów przed snem.",
      "💡 Wieczorem: Ciepła zupa lub sałatka nie obciąży i pomoże lepiej spać.",
      "💡 Postaraj się skończyć jeść 2-3h przed snem — lepsze trawienie i sen.",
    ],
    night: [
      "🌙 Jest późno — jeśli jesteś głodny/a, wypij herbatę ziołową lub zjedz garść orzechów.",
      "🌙 Noc: Twoje ciało zwalnia. Unikaj ciężkich posiłków o tej porze.",
      "🌙 Późna pora? Ciepłe mleko lub rumianek zaspokoi bez obciążania.",
    ],
  },
  pt: {
    morning: [
      "💡 Dica matinal: Comece com proteína — ovos, iogurte grego ou queijo cottage saciam por mais tempo.",
      "💡 Energia matinal: Aveia com nozes e frutas é um ótimo café da manhã.",
      "💡 Não pule o café da manhã — até uma refeição pequena acelera o metabolismo.",
    ],
    lunch: [
      "💡 Hora do almoço: Prato equilibrado = ½ vegetais, ¼ proteína, ¼ carboidratos complexos.",
      "💡 Hidrate-se — às vezes a fome é na verdade sede. Beba um copo d'água.",
      "💡 Adicione vegetais coloridos — mais cores = mais nutrientes.",
    ],
    afternoon: [
      "💡 Lanche da tarde: Nozes, frutas ou homus com vegetais ao invés de salgadinhos.",
      "💡 Queda de energia? Um punhado de amêndoas ou uma banana ajudam sem pico de açúcar.",
      "💡 Vontade de doce? Chocolate amargo (70%+) satisfaz em pequenas quantidades.",
    ],
    evening: [
      "💡 Jantar leve: Proteína magra + vegetais. Evite carboidratos pesados antes de dormir.",
      "💡 Noite: Uma sopa quente ou salada deixa leve e ajuda a dormir melhor.",
      "💡 Tente parar de comer 2-3h antes de dormir — melhor digestão e sono.",
    ],
    night: [
      "🌙 Está tarde — se estiver com fome, opte por chá de ervas ou um punhado de nozes.",
      "🌙 Madrugada: Seu corpo está desacelerando. Evite refeições pesadas agora.",
      "🌙 Tarde da noite? Leite morno ou chá de camomila satisfaz sem pesar.",
    ],
  },
  es: {
    morning: [
      "💡 Consejo matutino: Empieza con proteína — huevos, yogur griego o requesón sacian más.",
      "💡 Energía matinal: Avena con nueces y fruta es un gran desayuno.",
      "💡 No te saltes el desayuno — incluso algo pequeño activa tu metabolismo.",
    ],
    lunch: [
      "💡 Hora de comer: Plato equilibrado = ½ verduras, ¼ proteína, ¼ carbohidratos complejos.",
      "💡 Hidrátate — a veces el hambre es en realidad sed. Bebe un vaso de agua.",
      "💡 Añade verduras coloridas — más colores = más nutrientes.",
    ],
    afternoon: [
      "💡 Merienda: Nueces, fruta o hummus con verduras en lugar de patatas fritas.",
      "💡 ¿Bajón de energía? Un puñado de almendras o un plátano ayudan sin pico de azúcar.",
      "💡 ¿Antojo de dulce? Chocolate negro (70%+) satisface en pequeñas cantidades.",
    ],
    evening: [
      "💡 Cena ligera: Proteína magra + verduras. Evita carbohidratos pesados antes de dormir.",
      "💡 Noche: Una sopa caliente o ensalada no pesa y ayuda a dormir mejor.",
      "💡 Intenta terminar de comer 2-3h antes de acostarte — mejor digestión y sueño.",
    ],
    night: [
      "🌙 Es tarde — si tienes hambre, opta por una infusión o un puñado de nueces.",
      "🌙 Noche: Tu cuerpo se está relajando. Evita comidas pesadas ahora.",
      "🌙 ¿Noche tardía? Leche caliente o manzanilla satisface sin cargar.",
    ],
  },
  de: {
    morning: [
      "💡 Morgentipp: Starte mit Protein — Eier, griechischer Joghurt oder Hüttenkäse sättigen länger.",
      "💡 Morgenenergie: Haferflocken mit Nüssen und Obst sind ein toller Start.",
      "💡 Frühstück nicht auslassen — schon eine Kleinigkeit bringt den Stoffwechsel in Gang.",
    ],
    lunch: [
      "💡 Mittagszeit: Ausgewogener Teller = ½ Gemüse, ¼ Protein, ¼ komplexe Kohlenhydrate.",
      "💡 Trinke Wasser — manchmal ist Hunger eigentlich Durst.",
      "💡 Buntes Gemüse zum Mittag — mehr Farben = mehr Nährstoffe.",
    ],
    afternoon: [
      "💡 Nachmittagssnack: Nüsse, Obst oder Hummus statt Chips.",
      "💡 Energietief? Eine Handvoll Mandeln oder eine Banane helfen ohne Zuckerspitze.",
      "💡 Lust auf Süßes? Dunkle Schokolade (70%+) befriedigt in kleinen Mengen.",
    ],
    evening: [
      "💡 Leichtes Abendessen: Mageres Protein + Gemüse. Schwere Kohlenhydrate vor dem Schlaf vermeiden.",
      "💡 Abends: Eine warme Suppe oder Salat hält leicht und hilft beim Schlafen.",
      "💡 Versuche 2-3h vor dem Schlaf aufzuhören zu essen — bessere Verdauung und Schlaf.",
    ],
    night: [
      "🌙 Es ist spät — wenn du Hunger hast, trink Kräutertee oder iss eine Handvoll Nüsse.",
      "🌙 Nacht: Dein Körper fährt herunter. Vermeide schwere Mahlzeiten jetzt.",
      "🌙 Spät abends? Warme Milch oder Kamillentee stillt ohne zu belasten.",
    ],
  },
  fr: {
    morning: [
      "💡 Conseil matinal : Commencez par des protéines — œufs, yaourt grec ou fromage blanc rassasient longtemps.",
      "💡 Énergie du matin : Flocons d'avoine avec noix et fruits, un super petit-déjeuner.",
      "💡 Ne sautez pas le petit-déjeuner — même léger, il relance le métabolisme.",
    ],
    lunch: [
      "💡 Déjeuner : Assiette équilibrée = ½ légumes, ¼ protéines, ¼ glucides complexes.",
      "💡 Hydratez-vous — parfois la faim est en fait de la soif. Buvez un verre d'eau.",
      "💡 Ajoutez des légumes colorés — plus de couleurs = plus de nutriments.",
    ],
    afternoon: [
      "💡 Goûter : Noix, fruits ou houmous plutôt que des chips.",
      "💡 Coup de fatigue ? Une poignée d'amandes ou une banane aide sans pic de sucre.",
      "💡 Envie de sucré ? Le chocolat noir (70%+) satisfait en petites quantités.",
    ],
    evening: [
      "💡 Dîner léger : Protéines maigres + légumes. Évitez les glucides lourds avant le coucher.",
      "💡 Le soir : Une soupe chaude ou salade reste léger et aide à mieux dormir.",
      "💡 Essayez de finir de manger 2-3h avant le coucher — meilleure digestion et sommeil.",
    ],
    night: [
      "🌙 Il est tard — si vous avez faim, optez pour une tisane ou une poignée de noix.",
      "🌙 Nuit : Votre corps ralentit. Évitez les repas lourds maintenant.",
      "🌙 Tard le soir ? Lait chaud ou camomille satisfait sans alourdir.",
    ],
  },
  it: {
    morning: [
      "💡 Consiglio mattutino: Inizia con le proteine — uova, yogurt greco o ricotta saziano a lungo.",
      "💡 Energia mattutina: Fiocchi d'avena con noci e frutta sono un'ottima colazione.",
      "💡 Non saltare la colazione — anche piccola, attiva il metabolismo.",
    ],
    lunch: [
      "💡 Ora di pranzo: Piatto bilanciato = ½ verdure, ¼ proteine, ¼ carboidrati complessi.",
      "💡 Idratati — a volte la fame è in realtà sete. Bevi un bicchiere d'acqua.",
      "💡 Aggiungi verdure colorate — più colori = più nutrienti.",
    ],
    afternoon: [
      "💡 Merenda: Noci, frutta o hummus con verdure invece di patatine.",
      "💡 Calo di energia? Una manciata di mandorle o una banana aiutano senza picco di zucchero.",
      "💡 Voglia di dolce? Cioccolato fondente (70%+) soddisfa in piccole quantità.",
    ],
    evening: [
      "💡 Cena leggera: Proteine magre + verdure. Evita carboidrati pesanti prima di dormire.",
      "💡 Sera: Una zuppa calda o insalata è leggera e aiuta a dormire meglio.",
      "💡 Cerca di smettere di mangiare 2-3h prima di dormire — digestione e sonno migliori.",
    ],
    night: [
      "🌙 È tardi — se hai fame, scegli tisana o una manciata di noci.",
      "🌙 Notte: Il tuo corpo sta rallentando. Evita pasti pesanti ora.",
      "🌙 Tarda notte? Latte caldo o camomilla soddisfa senza appesantire.",
    ],
  },
  zh: {
    morning: [
      "💡 早晨建议：从蛋白质开始——鸡蛋、希腊酸奶或cottage芝士能让你更有饱腹感。",
      "💡 早晨能量：燕麦配坚果和水果是很好的早餐选择。",
      "💡 别跳过早餐——即使是小份也能启动新陈代谢。",
    ],
    lunch: [
      "💡 午餐时间：均衡的盘子 = ½蔬菜，¼蛋白质，¼复杂碳水化合物。",
      "💡 保持水分——有时候饥饿其实是口渴。喝杯水吧。",
      "💡 添加彩色蔬菜——颜色越多 = 营养越丰富。",
    ],
    afternoon: [
      "💡 下午加餐：试试坚果、水果或鹰嘴豆泥配蔬菜，代替薯片。",
      "💡 能量下降？一把杏仁或一根香蕉可以帮助，不会造成血糖飙升。",
      "💡 想吃甜食？试试黑巧克力（70%+）——少量就能满足。",
    ],
    evening: [
      "💡 清淡晚餐：瘦肉蛋白 + 蔬菜。睡前避免过多碳水化合物。",
      "💡 晚上：一碗热汤或沙拉既清淡又有助于睡眠。",
      "💡 尽量在睡前2-3小时结束进食——更好的消化和睡眠。",
    ],
    night: [
      "🌙 很晚了——如果饿了，选择花草茶或一小把坚果。",
      "🌙 深夜：你的身体正在放慢节奏。避免现在吃重食。",
      "🌙 深夜？温牛奶或甘菊茶可以满足而不负担。",
    ],
  },
};

function getMealPeriod() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'lunch';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 21) return 'evening';
  return 'night'; // 21:00 - 5:59
}

function updateCalorieTip() {
  if (!calorieTipEl) return;
  const lang = currentLanguage || 'en';
  const period = getMealPeriod();
  const tips = (calorieTips[lang] || calorieTips.en)[period];
  const tip = tips[Math.floor(Math.random() * tips.length)];
  calorieTipEl.textContent = tip;
}

// Refresh calorie tip every 30 min (initial call is in applyLanguageToUI)
setInterval(updateCalorieTip, 30 * 60 * 1000);

// ============================================================
// i18n — Full UI translation
// ============================================================

const uiTranslations = {
  onboarding: {
    en: { title: '🧠 Welcome to ALLMA', desc: "Let's get to know each other a bit. Answer these questions so I can better understand how to help you.", q1: '1. What brings you here today? What would you like to work on?', q1ph: "e.g. I've been feeling stressed at work and want to understand my patterns better...", q2: '2. Have you done therapy or coaching before? What worked or didn\'t?', q2ph: 'e.g. I did CBT for a year, it helped with anxiety but I stopped...', q3: '3. What\'s one thing you\'d like to change about yourself in the next month?', q3ph: 'e.g. I want to stop procrastinating on important decisions...', btn: 'Start Coaching Session', btnLoading: 'Setting up...', alertEmpty: 'Please answer at least one question.' },
    pl: { title: '🧠 Witaj w ALLMA', desc: 'Poznajmy się trochę. Odpowiedz na te pytania, żebym lepiej zrozumiała jak Ci pomóc.', q1: '1. Co Cię tu dziś sprowadza? Nad czym chciałbyś/chciałabyś popracować?', q1ph: 'np. Czuję się zestresowany/a w pracy i chcę lepiej zrozumieć swoje wzorce...', q2: '2. Czy miałeś/aś wcześniej terapię lub coaching? Co działało, a co nie?', q2ph: 'np. Robiłem/am CBT przez rok, pomogło z lękiem ale przerwałem/am...', q3: '3. Co chciałbyś/chciałabyś zmienić w sobie w ciągu najbliższego miesiąca?', q3ph: 'np. Chcę przestać odkładać ważne decyzje...', btn: 'Rozpocznij sesję coachingową', btnLoading: 'Przygotowuję...', alertEmpty: 'Odpowiedz na przynajmniej jedno pytanie.' },
    pt: { title: '🧠 Bem-vindo à ALLMA', desc: 'Vamos nos conhecer um pouco. Responda estas perguntas para que eu possa entender melhor como te ajudar.', q1: '1. O que te traz aqui hoje? No que gostaria de trabalhar?', q1ph: 'ex: Tenho me sentido estressado/a no trabalho e quero entender meus padrões...', q2: '2. Já fez terapia ou coaching antes? O que funcionou ou não?', q2ph: 'ex: Fiz TCC por um ano, ajudou com ansiedade mas parei...', q3: '3. O que gostaria de mudar em si mesmo/a no próximo mês?', q3ph: 'ex: Quero parar de procrastinar decisões importantes...', btn: 'Iniciar Sessão de Coaching', btnLoading: 'Preparando...', alertEmpty: 'Responda pelo menos uma pergunta.' },
    es: { title: '🧠 Bienvenido a ALLMA', desc: 'Conozcámonos un poco. Responde estas preguntas para que pueda entender mejor cómo ayudarte.', q1: '1. ¿Qué te trae aquí hoy? ¿En qué te gustaría trabajar?', q1ph: 'ej: Me he sentido estresado/a en el trabajo y quiero entender mis patrones...', q2: '2. ¿Has hecho terapia o coaching antes? ¿Qué funcionó o no?', q2ph: 'ej: Hice TCC por un año, ayudó con la ansiedad pero lo dejé...', q3: '3. ¿Qué cambiarías de ti mismo/a en el próximo mes?', q3ph: 'ej: Quiero dejar de procrastinar decisiones importantes...', btn: 'Iniciar Sesión de Coaching', btnLoading: 'Preparando...', alertEmpty: 'Responde al menos una pregunta.' },
    de: { title: '🧠 Willkommen bei ALLMA', desc: 'Lass uns uns ein wenig kennenlernen. Beantworte diese Fragen, damit ich besser verstehen kann, wie ich dir helfen kann.', q1: '1. Was bringt dich heute hierher? Woran möchtest du arbeiten?', q1ph: 'z.B. Ich fühle mich bei der Arbeit gestresst und möchte meine Muster besser verstehen...', q2: '2. Hast du schon Therapie oder Coaching gemacht? Was hat funktioniert?', q2ph: 'z.B. Ich habe ein Jahr KVT gemacht, es half bei Angst aber ich hörte auf...', q3: '3. Was möchtest du im nächsten Monat an dir ändern?', q3ph: 'z.B. Ich möchte aufhören, wichtige Entscheidungen aufzuschieben...', btn: 'Coaching-Sitzung starten', btnLoading: 'Wird vorbereitet...', alertEmpty: 'Bitte beantworte mindestens eine Frage.' },
    fr: { title: '🧠 Bienvenue sur ALLMA', desc: 'Faisons connaissance. Répondez à ces questions pour que je puisse mieux comprendre comment vous aider.', q1: '1. Qu\'est-ce qui vous amène ici aujourd\'hui ? Sur quoi aimeriez-vous travailler ?', q1ph: 'ex: Je me sens stressé(e) au travail et je veux mieux comprendre mes schémas...', q2: '2. Avez-vous fait de la thérapie ou du coaching avant ? Qu\'est-ce qui a fonctionné ?', q2ph: 'ex: J\'ai fait de la TCC pendant un an, ça a aidé avec l\'anxiété mais j\'ai arrêté...', q3: '3. Que souhaitez-vous changer chez vous dans le prochain mois ?', q3ph: 'ex: Je veux arrêter de procrastiner les décisions importantes...', btn: 'Commencer la Séance de Coaching', btnLoading: 'Préparation...', alertEmpty: 'Veuillez répondre à au moins une question.' },
    it: { title: '🧠 Benvenuto su ALLMA', desc: 'Conosciamoci un po\'. Rispondi a queste domande così potrò capire meglio come aiutarti.', q1: '1. Cosa ti porta qui oggi? Su cosa vorresti lavorare?', q1ph: 'es: Mi sento stressato/a al lavoro e voglio capire meglio i miei schemi...', q2: '2. Hai fatto terapia o coaching prima? Cosa ha funzionato?', q2ph: 'es: Ho fatto CBT per un anno, ha aiutato con l\'ansia ma ho smesso...', q3: '3. Cosa vorresti cambiare di te stesso/a nel prossimo mese?', q3ph: 'es: Voglio smettere di procrastinare le decisioni importanti...', btn: 'Inizia la Sessione di Coaching', btnLoading: 'Preparazione...', alertEmpty: 'Rispondi ad almeno una domanda.' },
    zh: { title: '🧠 欢迎来到 ALLMA', desc: '让我们互相了解一下。回答这些问题，让我更好地理解如何帮助你。', q1: '1. 今天是什么让你来到这里？你想解决什么问题？', q1ph: '例如：工作压力很大，想更好地了解自己的行为模式...', q2: '2. 你以前做过心理治疗或教练吗？效果如何？', q2ph: '例如：做了一年的CBT，帮助缓解了焦虑但中断了...', q3: '3. 下个月你最想改变自己什么？', q3ph: '例如：我想不再拖延重要的决定...', btn: '开始教练课程', btnLoading: '准备中...', alertEmpty: '请至少回答一个问题。' },
  },
  placeholder: {
    en: 'Type your message...', pl: 'Napisz wiadomość...', pt: 'Digite sua mensagem...',
    es: 'Escribe tu mensaje...', de: 'Schreibe deine Nachricht...', fr: 'Écrivez votre message...',
    it: 'Scrivi il tuo messaggio...', zh: '输入你的消息...',
  },
  infoTitle: {
    en: 'Info', pl: 'Informacje', pt: 'Informações', es: 'Información',
    de: 'Info', fr: 'Info', it: 'Info', zh: '信息',
  },
  infoPlaceholder: {
    en: 'Start a conversation to see insights here', pl: 'Rozpocznij rozmowę, aby zobaczyć spostrzeżenia',
    pt: 'Inicie uma conversa para ver insights aqui', es: 'Inicia una conversación para ver insights aquí',
    de: 'Starte ein Gespräch, um Einblicke zu sehen', fr: 'Commencez une conversation pour voir des insights ici',
    it: 'Inizia una conversazione per vedere gli insight', zh: '开始对话以查看洞察',
  },
  todayLabel: {
    en: 'Today', pl: 'Dzisiaj', pt: 'Hoje', es: 'Hoy',
    de: 'Heute', fr: "Aujourd'hui", it: 'Oggi', zh: '今天',
  },
  footerHelp: {
    en: 'Help', pl: 'Pomoc', pt: 'Ajuda', es: 'Ayuda',
    de: 'Hilfe', fr: 'Aide', it: 'Aiuto', zh: '帮助',
  },
  footerPrivacy: {
    en: 'Privacy', pl: 'Prywatność', pt: 'Privacidade', es: 'Privacidad',
    de: 'Datenschutz', fr: 'Confidentialité', it: 'Privacy', zh: '隐私',
  },
  footerTerms: {
    en: 'Terms', pl: 'Regulamin', pt: 'Termos', es: 'Términos',
    de: 'Nutzungsbedingungen', fr: 'Conditions', it: 'Termini', zh: '条款',
  },
  footerDelete: {
    en: 'Delete history', pl: 'Usuń historię', pt: 'Excluir histórico', es: 'Borrar historial',
    de: 'Verlauf löschen', fr: 'Supprimer l\'historique', it: 'Elimina cronologia', zh: '删除记录',
  },
  deleteConfirm: {
    en: 'Delete all your conversation history? This cannot be undone.',
    pl: 'Usunąć całą historię rozmów? Tego nie można cofnąć.',
    pt: 'Excluir todo o histórico de conversas? Isso não pode ser desfeito.',
    es: '¿Borrar todo el historial de conversaciones? Esto no se puede deshacer.',
    de: 'Gesamten Gesprächsverlauf löschen? Dies kann nicht rückgängig gemacht werden.',
    fr: 'Supprimer tout l\'historique des conversations ? Cette action est irréversible.',
    it: 'Eliminare tutta la cronologia delle conversazioni? Non è possibile annullare.',
    zh: '删除所有对话记录？此操作无法撤消。',
  },
};

/**
 * Apply all UI translations based on currentLanguage.
 * Called after checkAuth() resolves and on every language switch.
 */
function applyLanguageToUI() {
  const lang = currentLanguage || 'en';

  // 1. Agent tile names
  updateAgentTileNames();

  // 2. Chat input placeholder
  chatInput.placeholder = uiTranslations.placeholder[lang] || uiTranslations.placeholder.en;

  // 3. Calorie tip
  updateCalorieTip();

  // 4. Info sidebar
  const infoTitle = document.querySelector('[data-i18n-info="title"]');
  if (infoTitle) infoTitle.textContent = uiTranslations.infoTitle[lang] || uiTranslations.infoTitle.en;
  const infoPlaceholder = document.querySelector('[data-i18n-info="placeholder"]');
  if (infoPlaceholder) infoPlaceholder.textContent = uiTranslations.infoPlaceholder[lang] || uiTranslations.infoPlaceholder.en;

  // 5. Today label in calorie bar
  const todayLabel = document.querySelector('[data-i18n-info="today"]');
  if (todayLabel) todayLabel.textContent = uiTranslations.todayLabel[lang] || uiTranslations.todayLabel.en;

  // 6. Footer links (including delete history)
  const footerLinks = document.querySelector('.chat-footer-links');
  if (footerLinks) {
    const h = uiTranslations.footerHelp[lang] || uiTranslations.footerHelp.en;
    const p = uiTranslations.footerPrivacy[lang] || uiTranslations.footerPrivacy.en;
    const t = uiTranslations.footerTerms[lang] || uiTranslations.footerTerms.en;
    const d = uiTranslations.footerDelete[lang] || uiTranslations.footerDelete.en;
    footerLinks.innerHTML = `<a href="/guide">❓ ${h}</a> · <a href="/privacy">${p}</a> · <a href="/terms">${t}</a> · <a href="#" id="deleteHistoryLink" class="delete-history-link">🗑️ ${d}</a>`;
    // Re-attach delete handler after re-rendering
    const delLink = document.getElementById('deleteHistoryLink');
    if (delLink) delLink.addEventListener('click', handleDeleteHistory);
  }

  // 7. Onboarding modal
  translateOnboarding();

  // 8. Language buttons highlight
  updateLanguageButtons();
}

function translateOnboarding() {
  const lang = currentLanguage || 'en';
  const t = uiTranslations.onboarding[lang] || uiTranslations.onboarding.en;
  const modal = document.getElementById('onboardingModal');
  if (!modal) return;

  const h2 = modal.querySelector('h2');
  if (h2) h2.textContent = t.title;
  const desc = modal.querySelector('.modal > p');
  if (desc) desc.textContent = t.desc;

  const labels = modal.querySelectorAll('.onboarding-question label');
  if (labels[0]) labels[0].textContent = t.q1;
  if (labels[1]) labels[1].textContent = t.q2;
  if (labels[2]) labels[2].textContent = t.q3;

  const textareas = modal.querySelectorAll('.onboarding-question textarea');
  if (textareas[0]) textareas[0].placeholder = t.q1ph;
  if (textareas[1]) textareas[1].placeholder = t.q2ph;
  if (textareas[2]) textareas[2].placeholder = t.q3ph;

  const btn = modal.querySelector('button[type="submit"]');
  if (btn && !btn.disabled) btn.textContent = t.btn;
}

// ============================================================
// Init
// ============================================================

// checkAuth is async — we must await it before applying UI translations
(async function init() {
  await checkAuth();
  applyLanguageToUI();
})();
