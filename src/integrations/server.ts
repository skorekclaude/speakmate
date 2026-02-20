/**
 * SpeakMate HTTP Server
 *
 * Routes:
 * - POST /api/chat/stream — SSE streaming chat with correction parsing
 * - POST /api/tts — Text-to-speech
 * - GET  /api/agents — List available tutors
 * - GET  /api/vocabulary — User's vocabulary list
 * - GET  /api/progress — Learning progress stats
 * - GET  /* — Static files (web UI)
 *
 * Security:
 * - CORS restricted to known origins
 * - Rate limiting on LLM/TTS endpoints
 * - IDOR protection on vocabulary update
 * - Path traversal protection on static files
 * - Localhost binding for local dev
 */

import { chatStream } from "../core/conversation.ts";
import { parseLLMResponse } from "../core/correction-parser.ts";
import { generateSpeech } from "../core/tts.ts";
import { getOrCreateUser, getVocabulary, getProgress, clearMessages, getRecentMessages, updateVocabMastered } from "../core/memory.ts";
import { getAllAgents, getAgent } from "../agents/registry.ts";
import { getNews, refreshNews } from "../core/news-fetcher.ts";
import * as fs from "fs";
import * as path from "path";

const PORT = parseInt(process.env.PORT || "3478");
const WEB_DIR = path.resolve(path.join(import.meta.dir, "../../web"));

// Allowed origins for CORS (Railway production + localhost dev)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  ALLOWED_ORIGINS.push(`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`);
}
// Always allow Railway domain if set
if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  ALLOWED_ORIGINS.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
}

// Simple session store (token → user)
const sessions = new Map<string, { userId: string; email: string }>();

// ============================================================
// Rate Limiting — sliding window per IP
// ============================================================

const rateLimitStore = new Map<string, { timestamps: number[] }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMITS: Record<string, number> = {
  "/api/chat/stream": 15, // 15 LLM calls per minute per IP
  "/api/tts": 20,         // 20 TTS calls per minute per IP
  "/api/auth/login": 10,  // 10 login attempts per minute per IP
};

function isRateLimited(ip: string, endpoint: string): boolean {
  const limit = RATE_LIMITS[endpoint];
  if (!limit) return false;

  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (entry.timestamps.length >= limit) {
    return true;
  }

  entry.timestamps.push(now);
  return false;
}

// Clean up rate limit store every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (entry.timestamps.length === 0) rateLimitStore.delete(key);
  }
}, 5 * 60_000);

// ============================================================
// Helpers
// ============================================================

/** Build CORS headers for a specific request. Only sets Allow-Origin if the request origin is in the allowlist. */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/** Convenience: JSON response with CORS headers derived from the request. */
function jsonResponse(data: any, status = 200, req?: Request): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (req) {
    Object.assign(headers, corsHeaders(req));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function getClientIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function getSessionFromRequest(req: Request): { userId: string; email: string } | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  return sessions.get(token) || null;
}

function getMimeType(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp3": "audio/mpeg",
    ".woff2": "font/woff2",
  };
  return types[ext] || "application/octet-stream";
}

// ============================================================
// Route Handlers
// ============================================================

async function handleLogin(req: Request): Promise<Response> {
  const { email } = await req.json();
  if (!email) return jsonResponse({ error: "Email required" }, 400, req);

  // Basic email validation
  if (typeof email !== "string" || !email.includes("@") || email.length > 254) {
    return jsonResponse({ error: "Invalid email" }, 400, req);
  }

  try {
    const user = await getOrCreateUser(email);
    const token = crypto.randomUUID();
    sessions.set(token, { userId: user.id!, email });
    console.log(`[Auth] Login: ${email.substring(0, 3)}***`);
    return jsonResponse({ token, user }, 200, req);
  } catch (err: any) {
    console.error(`[Auth] Login error: ${err.message}`);
    return jsonResponse({ error: "Login failed" }, 500, req);
  }
}

async function handleChatStream(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401, req);

  const { message, agentId } = await req.json();
  if (!message) return jsonResponse({ error: "Message required" }, 400, req);

  // Validate message length (prevent abuse)
  if (typeof message !== "string" || message.length > 5000) {
    return jsonResponse({ error: "Message too long (max 5000 chars)" }, 400, req);
  }

  const agent = getAgent(agentId || "general");
  if (!agent) return jsonResponse({ error: "Agent not found" }, 404, req);

  console.log(`[Chat] user:${session.userId.substring(0, 8)} → ${agent.id}: ${message.substring(0, 50)}...`);

  // SSE streaming response
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of chatStream(session.userId, agent.id, message)) {
          fullResponse += chunk;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`)
          );
        }

        // Parse complete response and send structured data
        const parsed = parseLLMResponse(fullResponse);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "done",
              parsed: {
                response: parsed.response,
                corrections: parsed.corrections,
                vocabulary: parsed.vocabulary,
              },
            })}\n\n`
          )
        );

        controller.close();
      } catch (err: any) {
        console.error(`[Chat] Stream error: ${err.message}`);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...corsHeaders(req),
    },
  });
}

async function handleTTS(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401, req);

  const { text, agentId } = await req.json();
  if (!text) return jsonResponse({ error: "Text required" }, 400, req);

  // Limit TTS text length
  if (typeof text !== "string" || text.length > 2000) {
    return jsonResponse({ error: "Text too long for TTS (max 2000 chars)" }, 400, req);
  }

  try {
    const audioBuffer = await generateSpeech(text, agentId || "general");
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        ...corsHeaders(req),
      },
    });
  } catch (err: any) {
    console.error(`[TTS] Error: ${err.message}`);
    return jsonResponse({ error: "TTS failed" }, 500, req);
  }
}

async function handleVocabulary(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401, req);

  const vocab = await getVocabulary(session.userId);
  return jsonResponse({ vocabulary: vocab }, 200, req);
}

async function handleProgress(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401, req);

  const progress = await getProgress(session.userId);
  return jsonResponse({ progress }, 200, req);
}

async function handleClearChat(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401, req);

  const { agentId } = await req.json();
  await clearMessages(session.userId, agentId);
  return jsonResponse({ ok: true }, 200, req);
}

async function handleChatHistory(req: Request, url: URL): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401, req);

  const agentId = url.searchParams.get("agentId") || "general";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30"), 100); // cap at 100
  const messages = await getRecentMessages(session.userId, agentId, limit);
  return jsonResponse({ messages }, 200, req);
}

async function handleVocabUpdate(req: Request, url: URL): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401, req);

  const vocabId = url.pathname.split("/").pop();
  if (!vocabId) return jsonResponse({ error: "Vocabulary ID required" }, 400, req);

  // IDOR fix: pass userId so update is scoped to the authenticated user
  const { mastered } = await req.json();
  await updateVocabMastered(vocabId, mastered, session.userId);
  return jsonResponse({ ok: true }, 200, req);
}

function handleAgents(req: Request): Response {
  const agents = getAllAgents().map((a) => ({
    id: a.id,
    name: a.name,
    emoji: a.emoji,
    description: a.description,
    targetLanguage: a.targetLanguage,
  }));
  return jsonResponse({ agents }, 200, req);
}

// ============================================================
// Static File Server (with path traversal protection)
// ============================================================

function serveStatic(pathname: string): Response {
  let filepath = pathname === "/" || pathname === ""
    ? path.join(WEB_DIR, "index.html")
    : pathname === "/app"
    ? path.join(WEB_DIR, "app.html")
    : pathname === "/progress"
    ? path.join(WEB_DIR, "progress.html")
    : pathname === "/vocabulary"
    ? path.join(WEB_DIR, "vocabulary.html")
    : path.join(WEB_DIR, pathname);

  // Resolve to absolute and verify it's within WEB_DIR (prevent path traversal)
  filepath = path.resolve(filepath);
  if (!filepath.startsWith(WEB_DIR)) {
    console.warn(`[Security] Path traversal attempt blocked: ${pathname}`);
    return new Response("Forbidden", { status: 403 });
  }

  try {
    if (!fs.existsSync(filepath)) {
      return new Response("Not Found", { status: 404 });
    }

    const content = fs.readFileSync(filepath);
    return new Response(content, {
      headers: {
        "Content-Type": getMimeType(filepath),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// ============================================================
// Main Server
// ============================================================

export function startServer() {
  // Bind to localhost in dev, 0.0.0.0 in production (Railway needs it)
  const hostname = process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1";

  const server = Bun.serve({
    port: PORT,
    hostname,
    async fetch(req: Request) {
      const url = new URL(req.url);
      const ip = getClientIP(req);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: corsHeaders(req),
        });
      }

      // Health check (Railway / Docker)
      if (url.pathname === "/health") {
        return jsonResponse({ status: "ok", uptime: process.uptime() });
      }

      // Rate limiting on expensive endpoints
      if (RATE_LIMITS[url.pathname] && isRateLimited(ip, url.pathname)) {
        return jsonResponse(
          { error: "Too many requests. Please wait a moment." },
          429,
          req
        );
      }

      // API Routes
      if (url.pathname === "/api/auth/login" && req.method === "POST") {
        return handleLogin(req);
      }
      if (url.pathname === "/api/chat/stream" && req.method === "POST") {
        return handleChatStream(req);
      }
      if (url.pathname === "/api/tts" && req.method === "POST") {
        return handleTTS(req);
      }
      if (url.pathname === "/api/agents" && req.method === "GET") {
        return handleAgents(req);
      }
      if (url.pathname === "/api/vocabulary" && req.method === "GET") {
        return handleVocabulary(req);
      }
      if (url.pathname === "/api/progress" && req.method === "GET") {
        return handleProgress(req);
      }
      if (url.pathname === "/api/chat/clear" && req.method === "POST") {
        return handleClearChat(req);
      }
      if (url.pathname === "/api/chat/history" && req.method === "GET") {
        return handleChatHistory(req, url);
      }
      if (url.pathname.startsWith("/api/vocabulary/") && req.method === "PATCH") {
        return handleVocabUpdate(req, url);
      }
      if (url.pathname === "/api/auth/me" && req.method === "GET") {
        const session = getSessionFromRequest(req);
        if (!session) return jsonResponse({ error: "Not authenticated" }, 401, req);
        return jsonResponse({ email: session.email, userId: session.userId }, 200, req);
      }

      // News headlines (public endpoint — no auth needed)
      if (url.pathname === "/api/news" && req.method === "GET") {
        const items = await getNews();
        return jsonResponse({ news: items, count: items.length }, 200, req);
      }

      // Static files
      return serveStatic(url.pathname);
    },
  });

  console.log(`\n🗣️  SpeakMate running at http://${hostname}:${PORT}`);
  console.log(`   App: http://localhost:${PORT}/app`);
  console.log(`   API: http://localhost:${PORT}/api/agents`);
  console.log(`   CORS: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   Rate limits: chat=${RATE_LIMITS["/api/chat/stream"]}/min, tts=${RATE_LIMITS["/api/tts"]}/min\n`);

  // Initial news fetch (non-blocking)
  refreshNews()
    .then((n) => console.log(`📰 News: ${n} headlines loaded`))
    .catch((err) => console.warn(`📰 News: initial fetch failed — ${err.message}`));

  // Refresh news every 24h
  setInterval(() => {
    refreshNews()
      .then((n) => console.log(`📰 News refresh: ${n} headlines`))
      .catch((err) => console.warn(`📰 News refresh failed: ${err.message}`));
  }, 24 * 60 * 60 * 1000);

  return server;
}
