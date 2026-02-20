/**
 * SpeakMate — Shared Utilities
 * Auth, API helpers, navigation, animations
 */

// ============================================================
// Constants
// ============================================================

const TOKEN_KEY = 'sm_token';
const EMAIL_KEY = 'sm_email';

// ============================================================
// Auth
// ============================================================

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getEmail() { return localStorage.getItem(EMAIL_KEY); }

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/';
    return false;
  }
  return true;
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
  window.location.href = '/';
}

// ============================================================
// API Helper
// ============================================================

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) { logout(); return null; }
  return res;
}

// ============================================================
// Navigation
// ============================================================

function renderNav(activePage) {
  const nav = document.getElementById('navBar');
  if (!nav) return;

  const email = getEmail() || '';
  const initial = email ? email[0].toUpperCase() : '?';

  nav.innerHTML = `
    <div class="nav-inner">
      <a href="/" class="nav-logo">
        <span class="nav-logo-icon">🗣️</span>
        <span class="nav-logo-text">SpeakMate</span>
      </a>
      <div class="nav-links">
        <a href="/app" class="nav-link ${activePage === 'chat' ? 'active' : ''}">
          <span class="nav-link-icon">💬</span>
          <span class="nav-link-label">Chat</span>
        </a>
        <a href="/progress" class="nav-link ${activePage === 'progress' ? 'active' : ''}">
          <span class="nav-link-icon">📊</span>
          <span class="nav-link-label">Progress</span>
        </a>
        <a href="/vocabulary" class="nav-link ${activePage === 'vocabulary' ? 'active' : ''}">
          <span class="nav-link-icon">📚</span>
          <span class="nav-link-label">Words</span>
        </a>
      </div>
      <div class="nav-user">
        <span class="nav-avatar">${initial}</span>
        <button class="nav-logout" onclick="logout()" title="Logout">⏻</button>
      </div>
    </div>
  `;
}

// ============================================================
// Utilities
// ============================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, ' ');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// ============================================================
// Scroll Animations (IntersectionObserver)
// ============================================================

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-in-up').forEach(el => observer.observe(el));
}
