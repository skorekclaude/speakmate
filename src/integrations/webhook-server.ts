/**
 * ALLMA — Web Server
 *
 * HTTP server for:
 * - Static file serving (landing page + chat UI)
 * - Chat API with SSE streaming
 * - Simple email-based auth (Supabase)
 * - Stripe webhook events
 * - Health check endpoint
 *
 * Runs alongside the Telegram bot on the same Bun process.
 */

import { handleConversation, type UserSession } from "../core/conversation.ts";
import { callLLMStream, type LLMMessage } from "../core/llm.ts";
import { type Language } from "../core/i18n.ts";
import { detectCrisis, buildCrisisResponse } from "../core/safety.ts";
import {
  resolveWebUserId,
  getHistory,
  deleteHistory,
  saveMessage,
  addFact,
  getFactsByCategory,
  getUserProfile,
} from "../core/memory.ts";
import {
  classifyMessage,
  getAgentPrompt,
  getAgent,
} from "../agents/registry.ts";
import type { ModelTier } from "../agents/types.ts";
import { sendOTP, verifyOTP } from "./email.ts";
import { join, resolve } from "path";

// ============================================================
// Emotional Resonance — detect emotional tone in AI responses
// ============================================================

type EmotionTag = "warmth" | "concern" | "celebration" | "reflection" | "calm" | "challenge" | "neutral";

/** Lightweight emotion detection from AI response text — no LLM call needed */
function detectEmotion(text: string): EmotionTag {
  const lower = text.toLowerCase();
  const scores: Record<EmotionTag, number> = {
    warmth: 0, concern: 0, celebration: 0,
    reflection: 0, calm: 0, challenge: 0, neutral: 0,
  };

  // Warmth — empathy, validation, understanding
  for (const w of ["proud of you", "that takes courage", "makes sense", "completely valid",
    "understand", "hear you", "it's okay", "natural to feel", "you're not alone",
    "safe space", "support", "♥", "❤", "💛", "🤗",
    "dumny", "odwaga", "rozumiem", "słyszę cię", "nie jesteś sam",
    "orgulho", "coragem", "entendo", "faz sentido"]) {
    if (lower.includes(w)) scores.warmth += 2;
  }

  // Concern — worry, checking in
  for (const w of ["are you safe", "please reach out", "crisis", "emergency",
    "worried about", "take care", "be gentle", "check in",
    "bezpieczeńst", "kryzys", "proszę", "uważaj na siebie",
    "você está bem", "cuidado", "segurança"]) {
    if (lower.includes(w)) scores.concern += 3;
  }

  // Celebration — positive energy, achievement
  for (const w of ["amazing", "fantastic", "well done", "great job", "congratulat",
    "awesome", "brilliant", "incredible", "excellent", "🎉", "🌟", "⭐", "🔥", "💪",
    "świetnie", "brawo", "wspaniale", "niesamowite",
    "incrível", "parabéns", "fantástico", "maravilh"]) {
    if (lower.includes(w)) scores.celebration += 2;
  }

  // Reflection — questions, Socratic, depth
  for (const w of ["what do you think", "how does that feel", "what comes up",
    "notice", "curious", "wonder", "explore", "consider", "reflect",
    "co myślisz", "jak się z tym czujesz", "zastanów się",
    "o que você acha", "como se sente", "o que percebe"]) {
    if (lower.includes(w)) scores.reflection += 2;
  }

  // Calm — grounding, peace, breathing
  for (const w of ["breathe", "breathing", "ground", "gentle", "slowly", "peace",
    "moment", "pause", "stillness", "rest", "🧘", "🌿", "☁️",
    "oddech", "spokój", "powoli", "chwila",
    "respire", "calma", "devagar", "momento"]) {
    if (lower.includes(w)) scores.calm += 2;
  }

  // Challenge — direct, confrontational warmth
  for (const w of ["but consider", "challenge you", "honest with you", "hard truth",
    "uncomfortable", "pattern", "avoiding", "what if",
    "ale zastanów", "bądź szczery", "wzorzec", "unikasz",
    "mas considere", "padrão", "evitando"]) {
    if (lower.includes(w)) scores.challenge += 2;
  }

  // Find highest scoring emotion
  const sorted = Object.entries(scores)
    .filter(([k]) => k !== "neutral")
    .sort((a, b) => b[1] - a[1]);

  if (sorted[0] && sorted[0][1] >= 2) {
    return sorted[0][0] as EmotionTag;
  }
  return "neutral";
}

// ============================================================
// Configuration
// ============================================================

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const WEBHOOK_PORT = parseInt(process.env.PORT || process.env.WEBHOOK_PORT || "3456");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// Resolve web/ directory relative to this file (src/integrations/ → ../../web)
const WEB_DIR = join(import.meta.dir, "..", "..", "web");

// Simple session store: sessionToken -> { userId, email, language }
interface WebSession {
  userId: string;
  email: string;
  language: Language;
  createdAt: number;
}
const webSessions = new Map<string, WebSession>();

// In-memory chat sessions (like Telegram sessions): userId -> UserSession
const chatSessions = new Map<string, UserSession>();

// ============================================================
// Session Cleanup — prevent memory leaks (runs every 15 min)
// ============================================================

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const CHAT_SESSION_IDLE = 4 * 60 * 60 * 1000; // 4 hours idle → purge

setInterval(() => {
  const now = Date.now();
  let webPurged = 0, chatPurged = 0;

  for (const [token, session] of webSessions) {
    if (now - session.createdAt > SESSION_MAX_AGE) {
      webSessions.delete(token);
      webPurged++;
    }
  }

  // Chat sessions don't have timestamps — purge if map grows too large
  if (chatSessions.size > 200) {
    // Keep only the most recent 100 (arbitrary, but prevents OOM)
    const entries = [...chatSessions.entries()];
    chatSessions.clear();
    entries.slice(-100).forEach(([k, v]) => chatSessions.set(k, v));
    chatPurged = entries.length - 100;
  }

  if (webPurged || chatPurged) {
    console.log(`[Cleanup] Purged ${webPurged} web sessions, ${chatPurged} chat sessions (web: ${webSessions.size}, chat: ${chatSessions.size})`);
  }
}, 15 * 60 * 1000);

// ============================================================
// Rate Limiter — per-user, sliding window
// ============================================================

const rateLimits = new Map<string, number[]>(); // userId → timestamps
const RATE_LIMIT_WINDOW = 60_000; // 1 minute window
const RATE_LIMIT_MAX = 15; // max 15 messages per minute

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimits.get(userId) || [];
  // Remove old entries outside window
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  recent.push(now);
  rateLimits.set(userId, recent);
  return recent.length <= RATE_LIMIT_MAX;
}

// Clean rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of rateLimits) {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (recent.length === 0) rateLimits.delete(userId);
    else rateLimits.set(userId, recent);
  }
}, 5 * 60 * 1000);

// ============================================================
// Admin Monitoring — real-time stats
// ============================================================

const SERVER_START_TIME = Date.now();
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomUUID();
if (!process.env.ADMIN_KEY) {
  console.warn("[Security] No ADMIN_KEY in env — generated random key for this session");
}

interface AdminStats {
  totalMessages: number;
  totalSessions: number;
  messagesByAgent: Record<string, number>;
  messagesByLang: Record<string, number>;
  recentUsers: Array<{ email: string; lastActive: number; agent?: string }>;
  errors: Array<{ time: number; message: string }>;
}

const adminStats: AdminStats = {
  totalMessages: 0,
  totalSessions: 0,
  messagesByAgent: {},
  messagesByLang: {},
  recentUsers: [],
  errors: [],
};

/** Track a chat message for admin stats */
function trackMessage(email: string, agent: string, lang: string) {
  adminStats.totalMessages++;
  adminStats.messagesByAgent[agent] = (adminStats.messagesByAgent[agent] || 0) + 1;
  adminStats.messagesByLang[lang] = (adminStats.messagesByLang[lang] || 0) + 1;

  // Update recent users list (keep last 50)
  const existing = adminStats.recentUsers.find(u => u.email === email);
  if (existing) {
    existing.lastActive = Date.now();
    existing.agent = agent;
  } else {
    adminStats.recentUsers.unshift({ email, lastActive: Date.now(), agent });
    if (adminStats.recentUsers.length > 50) adminStats.recentUsers.pop();
  }
}

/** Track an error for admin stats */
function trackError(message: string) {
  adminStats.errors.unshift({ time: Date.now(), message });
  if (adminStats.errors.length > 100) adminStats.errors.pop();
}

// ============================================================
// Stripe Webhook Handlers
// ============================================================

type WebhookHandler = (event: any) => Promise<void>;
const handlers: Record<string, WebhookHandler> = {};

export function onStripeEvent(eventType: string, handler: WebhookHandler) {
  handlers[eventType] = handler;
}

// ============================================================
// Stripe Webhook Verification
// ============================================================

async function verifyStripeSignature(
  payload: string,
  signature: string
): Promise<boolean> {
  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn("[Webhook] No STRIPE_WEBHOOK_SECRET configured — rejecting unverified webhook");
    return false;
  }

  try {
    const parts = signature.split(",").reduce(
      (acc, part) => {
        const [key, value] = part.split("=");
        if (key === "t") acc.timestamp = value;
        if (key === "v1") acc.signatures.push(value);
        return acc;
      },
      { timestamp: "", signatures: [] as string[] }
    );

    if (!parts.timestamp || parts.signatures.length === 0) return false;

    const age = Math.abs(Date.now() / 1000 - parseInt(parts.timestamp));
    if (age > 300) {
      console.warn("[Webhook] Event too old:", age, "seconds");
      return false;
    }

    const signedPayload = `${parts.timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedPayload)
    );

    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return parts.signatures.some((s) => s === expected);
  } catch (error) {
    console.error("[Webhook] Signature verification failed:", error);
    return false;
  }
}

// ============================================================
// Telegram notification helper
// ============================================================

async function sendTelegramNotification(
  telegramId: string,
  text: string
): Promise<void> {
  if (!BOT_TOKEN) return;

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: parseInt(telegramId),
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (error) {
    console.error("[Webhook] Failed to send TG notification:", error);
  }
}

// ============================================================
// Default Stripe Event Handlers
// ============================================================

onStripeEvent("checkout.session.completed", async (event) => {
  const session = event.data.object;
  const telegramId = session.metadata?.telegram_id;
  const tier = session.metadata?.tier || "essencial";

  console.log(`[Stripe] Checkout completed: ${telegramId} -> ${tier}`);

  if (telegramId) {
    const msgs: Record<string, string> = {
      essencial: "✨ *Assinatura Essencial ativada!*\n\nVoce agora tem 8 sessoes por mes. Aproveite! 🧠",
      premium: "👑 *Assinatura Premium ativada!*\n\nSessoes ilimitadas + Board of Directors completo. Vamos la! 🚀",
    };
    await sendTelegramNotification(telegramId, msgs[tier] || msgs.essencial);
  }
});

onStripeEvent("invoice.payment_failed", async (event) => {
  const invoice = event.data.object;
  const customerId = invoice.customer;

  if (customerId) {
    try {
      const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      });
      const customer = (await res.json()) as Record<string, any>;
      const telegramId = customer.metadata?.telegram_id;

      if (telegramId) {
        await sendTelegramNotification(
          telegramId,
          "⚠️ *Problema no pagamento*\n\nNao conseguimos processar seu pagamento. " +
            "Use /manage para atualizar seus dados de pagamento."
        );
      }
    } catch (e) {
      console.error("[Webhook] Failed to look up customer:", e);
    }
  }
});

onStripeEvent("customer.subscription.deleted", async (event) => {
  const sub = event.data.object;
  const telegramId = sub.metadata?.telegram_id;

  console.log(`[Stripe] Subscription canceled: ${telegramId}`);

  if (telegramId) {
    await sendTelegramNotification(
      telegramId,
      "ℹ️ *Assinatura cancelada*\n\nSua assinatura foi cancelada. " +
        "Voce pode assinar novamente a qualquer momento com /plans."
    );
  }
});

// ============================================================
// Auth Helpers
// ============================================================

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getSessionFromRequest(req: Request): WebSession | null {
  const cookies = req.headers.get("cookie") || "";
  const match = cookies.match(/allma_session=([a-f0-9]{64})/);
  if (!match) return null;
  const session = webSessions.get(match[1]);
  if (!session) return null;
  // Expire after 7 days
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
    webSessions.delete(match[1]);
    return null;
  }
  return session;
}

function getChatSession(userId: string, language: Language): UserSession {
  let session = chatSessions.get(userId);
  if (!session) {
    session = {
      language,
      messageCount: 0,
      onboardingStep: 4, // Skip onboarding on web for now (MVP)
      consented: true,
      history: [],
      onboardingAnswers: [],
      currentAgent: "core",
    };
    chatSessions.set(userId, session);
  }
  return session;
}

// ============================================================
// CORS helper
// ============================================================

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [
  "http://localhost:3456",
  "https://allma-production.up.railway.app",
];
let _currentOrigin = ALLOWED_ORIGINS[0];

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": _currentOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ============================================================
// MIME types for static files
// ============================================================

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

// ============================================================
// HTTP Server
// ============================================================

export function startWebhookServer(): void {
  const server = Bun.serve({
    port: WEBHOOK_PORT,
    hostname: "0.0.0.0",

    async fetch(req) {
      const url = new URL(req.url);
      const reqOrigin = req.headers.get("origin") || "";
      _currentOrigin = ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0];

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // ── Health check ──
      if (url.pathname === "/health") {
        return jsonResponse({
          status: "ok",
          service: "allma",
          timestamp: new Date().toISOString(),
        });
      }

      // ── Stripe webhook ──
      if (url.pathname === "/webhook/stripe" && req.method === "POST") {
        try {
          const payload = await req.text();
          const signature = req.headers.get("stripe-signature") || "";

          const valid = await verifyStripeSignature(payload, signature);
          if (!valid) {
            console.warn("[Webhook] Invalid Stripe signature");
            return new Response("Invalid signature", { status: 400 });
          }

          const event = JSON.parse(payload);
          console.log(`[Webhook] Stripe event: ${event.type}`);

          const handler = handlers[event.type];
          if (handler) {
            handler(event).catch((e) =>
              console.error(`[Webhook] Handler error for ${event.type}:`, e)
            );
          }

          return jsonResponse({ received: true });
        } catch (error) {
          console.error("[Webhook] Error processing:", error);
          return new Response("Error", { status: 500 });
        }
      }

      // ════════════════════════════════════════════════════════
      // WEB API ROUTES
      // ════════════════════════════════════════════════════════

      // ── Auth: Direct login (email only — OTP after domain setup with Resend) ──
      if (url.pathname === "/api/auth/login" && req.method === "POST") {
        try {
          const body = (await req.json()) as Record<string, any>;
          const email = body.email?.trim()?.toLowerCase();
          const name = body.name?.trim();

          if (!email || !email.includes("@")) {
            return jsonResponse({ error: "Valid email required" }, 400);
          }

          // Resolve or create user in Supabase
          const userId = await resolveWebUserId(email, name);
          const profile = await getUserProfile(userId);

          // Create session token — prefer language from request, fall back to profile
          const token = generateToken();
          const language = (body.language as Language) || (profile?.language as Language) || "en";
          webSessions.set(token, {
            userId,
            email,
            language,
            createdAt: Date.now(),
          });

          // Check if user needs onboarding
          const onboardingFacts = await getFactsByCategory(userId, "onboarding", 1);
          const needsOnboarding = onboardingFacts.length === 0;

          console.log(`[Web] Login: ${email} -> ${userId} (lang: ${language}, new: ${needsOnboarding})`);
          adminStats.totalSessions++;

          const isHTTPS = req.headers.get("x-forwarded-proto") === "https" || req.url.startsWith("https");
          const securePart = isHTTPS ? "; Secure" : "";

          return new Response(
            JSON.stringify({
              ok: true,
              user: {
                id: userId,
                email,
                name: profile?.first_name || name || null,
                language,
                needsOnboarding,
              },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": `allma_session=${token}; Path=/; HttpOnly; SameSite=Lax${securePart}; Max-Age=${7 * 24 * 60 * 60}`,
                ...corsHeaders(),
              },
            }
          );
        } catch (error: any) {
          console.error("[Web] Login error:", error);
          return jsonResponse({ error: "Login failed" }, 500);
        }
      }

      // ── Auth: OTP (ready — activate after domain + Resend verification) ──
      if (url.pathname === "/api/auth/send-otp" && req.method === "POST") {
        return jsonResponse({ error: "OTP will be enabled after domain setup" }, 410);
      }
      if (url.pathname === "/api/auth/verify-otp" && req.method === "POST") {
        return jsonResponse({ error: "OTP will be enabled after domain setup" }, 410);
      }

      // ── Auth: Me (check current session) ──
      if (url.pathname === "/api/auth/me" && req.method === "GET") {
        const session = getSessionFromRequest(req);
        if (!session) {
          return jsonResponse({ authenticated: false }, 401);
        }

        const profile = await getUserProfile(session.userId);
        const onboardingFacts = await getFactsByCategory(session.userId, "onboarding", 1);

        return jsonResponse({
          authenticated: true,
          user: {
            id: session.userId,
            email: session.email,
            name: profile?.first_name || null,
            language: session.language,
            needsOnboarding: onboardingFacts.length === 0,
          },
        });
      }

      // ── Auth: Logout ──
      if (url.pathname === "/api/auth/logout" && req.method === "POST") {
        const cookies = req.headers.get("cookie") || "";
        const match = cookies.match(/allma_session=([a-f0-9]{64})/);
        if (match) webSessions.delete(match[1]);

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `allma_session=; Path=/; HttpOnly; Max-Age=0`,
            ...corsHeaders(),
          },
        });
      }

      // ── Chat: Send message (SSE streaming) ──
      if (url.pathname === "/api/chat" && req.method === "POST") {
        const webSession = getSessionFromRequest(req);
        if (!webSession) {
          return jsonResponse({ error: "Not authenticated" }, 401);
        }

        try {
          const body = (await req.json()) as Record<string, any>;
          const text = body.message?.trim();
          const lang = (body.language as Language) || webSession.language;

          if (!text) {
            return jsonResponse({ error: "Message required" }, 400);
          }

          console.log(`[Web] Chat: ${webSession.email} -> "${text.slice(0, 60)}..."`);

          // Crisis detection
          const crisis = detectCrisis(text);
          if (crisis.isCrisis) {
            const crisisResponse = buildCrisisResponse(lang, crisis.severity as "high" | "medium");
            // Save to history
            await saveMessage(webSession.userId, "user", text);
            await saveMessage(webSession.userId, "assistant", crisisResponse, "core");

            return jsonResponse({
              reply: crisisResponse,
              isCrisis: true,
              severity: crisis.severity,
            });
          }

          // Get/create chat session, update language on every request
          const chatSession = getChatSession(webSession.userId, lang);
          chatSession.language = lang;
          chatSession.messageCount++;

          // Use handleConversation for non-streaming response
          const result = await handleConversation({
            userId: webSession.userId,
            text,
            session: chatSession,
          });

          // Track for admin
          trackMessage(webSession.email, result.specialistDomain || "core", lang);

          return jsonResponse({
            reply: result.reply,
            specialistDomain: result.specialistDomain,
            tokensUsed: result.tokensUsed,
            sessionLimitWarning: result.sessionLimitWarning || null,
          });
        } catch (error: any) {
          console.error("[Web] Chat error:", error);
          trackError(error.message || "Chat error");
          return jsonResponse({ error: "Chat failed: " + error.message }, 500);
        }
      }

      // ── Chat: Stream message (SSE) ──
      if (url.pathname === "/api/chat/stream" && req.method === "POST") {
        const webSession = getSessionFromRequest(req);
        if (!webSession) {
          return jsonResponse({ error: "Not authenticated" }, 401);
        }

        // Rate limiting
        if (!checkRateLimit(webSession.userId)) {
          return jsonResponse({ error: "Rate limit exceeded. Please slow down." }, 429);
        }

        try {
          const body = (await req.json()) as Record<string, any>;
          const text = body.message?.trim();
          const lang = (body.language as Language) || webSession.language;
          const forcedAgent = body.agent as string | undefined; // from sidebar tile

          if (!text) {
            return jsonResponse({ error: "Message required" }, 400);
          }

          console.log(`[Web] Stream: ${webSession.email} -> "${text.slice(0, 60)}..."${forcedAgent ? ` [agent: ${forcedAgent}]` : ''}`);

          // Crisis check
          const crisis = detectCrisis(text);
          if (crisis.isCrisis) {
            const crisisResponse = buildCrisisResponse(lang, crisis.severity as "high" | "medium");
            await saveMessage(webSession.userId, "user", text);
            await saveMessage(webSession.userId, "assistant", crisisResponse, "core");

            // Return crisis as SSE
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: crisisResponse, done: false })}\n\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, isCrisis: true })}\n\n`));
                controller.close();
              },
            });

            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                ...corsHeaders(),
              },
            });
          }

          // Build messages for streaming
          const chatSession = getChatSession(webSession.userId, lang);
          chatSession.messageCount++;
          chatSession.history.push({ role: "user", content: text });

          // Trim history
          if (chatSession.history.length > 20) {
            const systemMsgs = chatSession.history.filter((m) => m.role === "system");
            const convMsgs = chatSession.history.filter((m) => m.role !== "system").slice(-16);
            chatSession.history = [...systemMsgs, ...convMsgs];
          }

          // Classify: forced agent from UI tile > session override > auto-classify
          const specialistDomain = forcedAgent || chatSession.specialistOverride || classifyMessage(text);
          let agentPrompt = await getAgentPrompt("core");

          // Load specialist knowledge if applicable
          if (specialistDomain !== "core") {
            try {
              const specialistPromptText = await getAgentPrompt(specialistDomain);
              const specAgent = getAgent(specialistDomain);
              console.log(`[Web] Specialist: ${specAgent.emoji} ${specialistDomain}${forcedAgent ? ' (user-selected)' : ' (auto-routed)'}`);
              // Use full specialist prompt for richer responses
              agentPrompt += `\n\n## SPECIALIST FOCUS: ${specAgent.emoji} ${specAgent.name}\n${specialistPromptText}`;
            } catch {}
          }

          // Load memory (simplified for streaming — lighter context)
          let memoryContext = "";
          try {
            const facts = await getFactsByCategory(webSession.userId, "onboarding", 5);
            if (facts.length > 0) {
              memoryContext = `\n\n## USER CONTEXT\n${facts.map((f) => `- ${f.content}`).join("\n")}`;
            }
          } catch {}

          const languageInstruction: Record<Language, string> = {
            pt: "🌐 MANDATORY LANGUAGE: You MUST respond ONLY in Brazilian Portuguese. Use informal 'você'. This overrides any other language signals.\n\n",
            pl: "🌐 MANDATORY LANGUAGE: You MUST respond ONLY in Polish. Use informal 'ty' form (not 'Pan/Pani'). This overrides any other language signals.\n\n",
            en: "🌐 MANDATORY LANGUAGE: You MUST respond ONLY in English. Be professionally warm and conversational.\n\n",
            es: "🌐 MANDATORY LANGUAGE: You MUST respond ONLY in Spanish. Use informal 'tú'. This overrides any other language signals.\n\n",
            de: "🌐 MANDATORY LANGUAGE: You MUST respond ONLY in German. Use informal 'du'. This overrides any other language signals.\n\n",
            fr: "🌐 MANDATORY LANGUAGE: You MUST respond ONLY in French. Use informal 'tu'. This overrides any other language signals.\n\n",
            it: "🌐 MANDATORY LANGUAGE: You MUST respond ONLY in Italian. Use informal 'tu'. This overrides any other language signals.\n\n",
            zh: "🌐 MANDATORY LANGUAGE: You MUST respond ONLY in Simplified Chinese. This overrides any other language signals.\n\n",
          };

          const teamContext = `\n\nYou are ALLMA — one expert coach with the knowledge of 7 specialists. You seamlessly incorporate specialist knowledge when relevant. Never deflect to other agents.`;

          const messages: LLMMessage[] = [
            {
              role: "system",
              content: languageInstruction[lang] + agentPrompt + teamContext + memoryContext,
            },
            ...chatSession.history,
          ];

          // Determine model tier
          const modelTier: ModelTier =
            specialistDomain !== "core"
              ? getAgent(specialistDomain).model
              : getAgent("core").model;

          // Stream response via SSE
          let fullContent = "";
          const encoder = new TextEncoder();

          let streamCancelled = false;
          const stream = new ReadableStream({
            async start(controller) {
              try {
                for await (const chunk of callLLMStream(messages, modelTier)) {
                  if (streamCancelled) break;
                  fullContent += chunk;
                  try {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ text: chunk, done: false })}\n\n`)
                    );
                  } catch {
                    // Controller closed (client disconnected)
                    streamCancelled = true;
                    break;
                  }
                }

                // Done signal — with emotional resonance tag
                if (!streamCancelled) {
                  try {
                    const emotion = detectEmotion(fullContent);
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ done: true, specialistDomain, emotion })}\n\n`
                      )
                    );
                    controller.close();
                  } catch {
                    // Controller already closed
                  }
                }

                // Save to history + DB (async, after stream ends)
                if (fullContent) {
                  chatSession.history.push({ role: "assistant", content: fullContent });
                  saveMessage(webSession.userId, "user", text).catch(() => {});
                  saveMessage(webSession.userId, "assistant", fullContent, specialistDomain || "core").catch(() => {});
                  // Track for admin dashboard
                  trackMessage(webSession.email, specialistDomain || "core", lang);
                }
              } catch (error: any) {
                console.error("[Web] Stream error:", error);
                trackError(error.message || "Stream error");
                if (!streamCancelled) {
                  try {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ error: error.message, done: true })}\n\n`
                      )
                    );
                    controller.close();
                  } catch {}
                }
              }
            },
            cancel() {
              streamCancelled = true;
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              ...corsHeaders(),
            },
          });
        } catch (error: any) {
          console.error("[Web] Stream setup error:", error);
          return jsonResponse({ error: "Stream failed" }, 500);
        }
      }

      // ── History: Get recent messages ──
      if (url.pathname === "/api/history" && req.method === "GET") {
        const webSession = getSessionFromRequest(req);
        if (!webSession) {
          return jsonResponse({ error: "Not authenticated" }, 401);
        }

        try {
          const history = await getHistory(webSession.userId, 20);
          return jsonResponse({ messages: history });
        } catch (error: any) {
          return jsonResponse({ error: "Failed to load history" }, 500);
        }
      }

      // ── History: Delete all messages ──
      if (url.pathname === "/api/history" && req.method === "DELETE") {
        const webSession = getSessionFromRequest(req);
        if (!webSession) {
          return jsonResponse({ error: "Not authenticated" }, 401);
        }

        try {
          const deleted = await deleteHistory(webSession.userId);
          // Clear in-memory chat session too
          chatSessions.delete(webSession.userId);
          console.log(`[Web] History deleted: ${webSession.email} (${deleted} messages)`);
          return jsonResponse({ ok: true, deleted });
        } catch (error: any) {
          console.error("[Web] Delete history error:", error);
          return jsonResponse({ error: "Failed to delete history" }, 500);
        }
      }

      // ── Onboarding: Save answers ──
      if (url.pathname === "/api/onboard" && req.method === "POST") {
        const webSession = getSessionFromRequest(req);
        if (!webSession) {
          return jsonResponse({ error: "Not authenticated" }, 401);
        }

        try {
          const body = (await req.json()) as Record<string, any>;
          const answers = body.answers;

          if (!Array.isArray(answers) || answers.length === 0) {
            return jsonResponse({ error: "Answers array required" }, 400);
          }

          // Save each answer as onboarding fact
          for (let i = 0; i < answers.length; i++) {
            if (answers[i]?.trim()) {
              await addFact(
                webSession.userId,
                "onboarding",
                `Q${i + 1}: ${answers[i].trim()}`,
                "core"
              );
            }
          }

          console.log(`[Web] Onboarding complete: ${webSession.email} (${answers.length} answers)`);
          return jsonResponse({ ok: true });
        } catch (error: any) {
          return jsonResponse({ error: "Onboarding failed" }, 500);
        }
      }

      // ════════════════════════════════════════════════════════
      // STATIC FILE SERVING
      // ════════════════════════════════════════════════════════

      // Landing page
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const file = Bun.file(join(WEB_DIR, "index.html"));
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      // Chat page
      if (url.pathname === "/chat" || url.pathname === "/chat.html") {
        const file = Bun.file(join(WEB_DIR, "chat.html"));
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      // Guide page (How It Works)
      if (url.pathname === "/guide" || url.pathname === "/guide.html") {
        const file = Bun.file(join(WEB_DIR, "guide.html"));
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      // Privacy Policy page
      if (url.pathname === "/privacy" || url.pathname === "/privacy.html") {
        const file = Bun.file(join(WEB_DIR, "privacy.html"));
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      // Terms of Service page
      if (url.pathname === "/terms" || url.pathname === "/terms.html") {
        const file = Bun.file(join(WEB_DIR, "terms.html"));
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      // ════════════════════════════════════════════════════════
      // ADMIN MONITORING
      // ════════════════════════════════════════════════════════

      // Admin stats API (JSON)
      if (url.pathname === "/api/admin/stats" && req.method === "GET") {
        const key = url.searchParams.get("key");
        if (key !== ADMIN_KEY) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }

        const uptimeMs = Date.now() - SERVER_START_TIME;
        const memUsage = process.memoryUsage();

        return jsonResponse({
          uptime: {
            ms: uptimeMs,
            human: `${Math.floor(uptimeMs / 3600000)}h ${Math.floor((uptimeMs % 3600000) / 60000)}m`,
          },
          memory: {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
          },
          sessions: {
            web: webSessions.size,
            chat: chatSessions.size,
            rateLimited: rateLimits.size,
          },
          messages: {
            total: adminStats.totalMessages,
            byAgent: adminStats.messagesByAgent,
            byLang: adminStats.messagesByLang,
          },
          recentUsers: adminStats.recentUsers.slice(0, 20).map(u => ({
            email: u.email.replace(/(.{2}).*(@.*)/, "$1***$2"), // partial mask
            lastActive: new Date(u.lastActive).toISOString(),
            agent: u.agent,
          })),
          errors: adminStats.errors.slice(0, 10).map(e => ({
            time: new Date(e.time).toISOString(),
            message: e.message.slice(0, 200),
          })),
        });
      }

      // Admin dashboard page
      if (url.pathname === "/admin") {
        const key = url.searchParams.get("key");
        if (key !== ADMIN_KEY) {
          return new Response("🔒 Admin access requires ?key=YOUR_ADMIN_KEY", {
            status: 401,
            headers: { "Content-Type": "text/plain" },
          });
        }
        const file = Bun.file(join(WEB_DIR, "admin.html"));
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      // Static assets (CSS, JS, images)
      if (url.pathname.startsWith("/assets/")) {
        // Prevent path traversal
        const filePath = resolve(join(WEB_DIR, url.pathname));
        if (!filePath.startsWith(resolve(WEB_DIR))) {
          return new Response("Forbidden", { status: 403 });
        }
        const file = Bun.file(filePath);

        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": getMimeType(filePath) },
          });
        }
      }

      // ── PWA: manifest.json ──
      if (url.pathname === "/manifest.json") {
        const file = Bun.file(join(WEB_DIR, "manifest.json"));
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Type": "application/manifest+json",
              "Cache-Control": "no-cache",
            },
          });
        }
      }

      // ── PWA: service worker (must be served from root scope) ──
      if (url.pathname === "/service-worker.js") {
        const file = Bun.file(join(WEB_DIR, "service-worker.js"));
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Type": "application/javascript; charset=utf-8",
              "Service-Worker-Allowed": "/",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            },
          });
        }
      }

      // ── PWA: icons ──
      if (url.pathname.startsWith("/icons/")) {
        const filePath = resolve(join(WEB_DIR, url.pathname));
        if (!filePath.startsWith(resolve(WEB_DIR))) {
          return new Response("Forbidden", { status: 403 });
        }
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Type": getMimeType(filePath),
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }
      }

      // ── PWA: offline page ──
      if (url.pathname === "/offline" || url.pathname === "/offline.html") {
        const file = Bun.file(join(WEB_DIR, "offline.html"));
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      // ── 404 ──
      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`[Web] Server listening on port ${server.port}`);
  console.log(`[Web] Landing: http://localhost:${server.port}/`);
  console.log(`[Web] Chat:    http://localhost:${server.port}/chat`);
  console.log(`[Web] Admin:   http://localhost:${server.port}/admin?key=${ADMIN_KEY.slice(0, 4)}***`);
}
