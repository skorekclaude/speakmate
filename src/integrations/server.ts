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
const WEB_DIR = path.join(import.meta.dir, "../../web");

// Simple session store (token → user)
const sessions = new Map<string, { userId: string; email: string }>();

// ============================================================
// Helpers
// ============================================================

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS, DELETE",
    },
  });
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
  if (!email) return jsonResponse({ error: "Email required" }, 400);

  try {
    const user = await getOrCreateUser(email);
    const token = crypto.randomUUID();
    sessions.set(token, { userId: user.id!, email });
    console.log(`[Auth] Login: ${email} → ${user.id}`);
    return jsonResponse({ token, user });
  } catch (err: any) {
    console.error(`[Auth] Login error: ${err.message}`);
    return jsonResponse({ error: "Login failed" }, 500);
  }
}

async function handleChatStream(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);

  const { message, agentId } = await req.json();
  if (!message) return jsonResponse({ error: "Message required" }, 400);

  const agent = getAgent(agentId || "general");
  if (!agent) return jsonResponse({ error: "Agent not found" }, 404);

  console.log(`[Chat] ${session.email} → ${agent.id}: ${message.substring(0, 50)}...`);

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
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleTTS(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);

  const { text, agentId } = await req.json();
  if (!text) return jsonResponse({ error: "Text required" }, 400);

  try {
    const audioBuffer = await generateSpeech(text, agentId || "general");
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error(`[TTS] Error: ${err.message}`);
    return jsonResponse({ error: "TTS failed" }, 500);
  }
}

async function handleVocabulary(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);

  const vocab = await getVocabulary(session.userId);
  return jsonResponse({ vocabulary: vocab });
}

async function handleProgress(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);

  const progress = await getProgress(session.userId);
  return jsonResponse({ progress });
}

async function handleClearChat(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);

  const { agentId } = await req.json();
  await clearMessages(session.userId, agentId);
  return jsonResponse({ ok: true });
}

async function handleChatHistory(req: Request, url: URL): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);

  const agentId = url.searchParams.get("agentId") || "general";
  const limit = parseInt(url.searchParams.get("limit") || "30");
  const messages = await getRecentMessages(session.userId, agentId, limit);
  return jsonResponse({ messages });
}

async function handleVocabUpdate(req: Request, url: URL): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse({ error: "Not authenticated" }, 401);

  const vocabId = url.pathname.split("/").pop();
  if (!vocabId) return jsonResponse({ error: "Vocabulary ID required" }, 400);

  const { mastered } = await req.json();
  await updateVocabMastered(vocabId, mastered);
  return jsonResponse({ ok: true });
}

function handleAgents(): Response {
  const agents = getAllAgents().map((a) => ({
    id: a.id,
    name: a.name,
    emoji: a.emoji,
    description: a.description,
    targetLanguage: a.targetLanguage,
  }));
  return jsonResponse({ agents });
}

// ============================================================
// Static File Server
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
  const server = Bun.serve({
    port: PORT,
    async fetch(req: Request) {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS, DELETE",
          },
        });
      }

      // Health check (Railway / Docker)
      if (url.pathname === "/health") {
        return jsonResponse({ status: "ok", uptime: process.uptime() });
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
        return handleAgents();
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
        if (!session) return jsonResponse({ error: "Not authenticated" }, 401);
        return jsonResponse({ email: session.email, userId: session.userId });
      }

      // News headlines (public endpoint — no auth needed)
      if (url.pathname === "/api/news" && req.method === "GET") {
        const items = await getNews();
        return jsonResponse({ news: items, count: items.length });
      }

      // Static files
      return serveStatic(url.pathname);
    },
  });

  console.log(`\n🗣️  SpeakMate running at http://localhost:${PORT}`);
  console.log(`   App: http://localhost:${PORT}/app`);
  console.log(`   API: http://localhost:${PORT}/api/agents\n`);

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
