/**
 * ALLMA LLM Router
 *
 * Routes requests to the appropriate LLM backend.
 * Supports:
 * - Anthropic API (Claude Sonnet / Opus) — premium, best quality
 * - Groq API (Llama 3.3 70B) — free, fast fallback
 *
 * Set LLM_BACKEND=anthropic in .env to use Claude.
 * Falls back to Groq if ANTHROPIC_API_KEY is not set.
 */

import type { ModelTier } from "../agents/types.ts";

// ============================================================
// Configuration
// ============================================================

// Backend selection: "anthropic" | "groq" (auto-fallback to groq if no Anthropic key)
const LLM_BACKEND = process.env.LLM_BACKEND || "groq";

// --- Anthropic ---
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_VERSION = "2023-06-01";

/** Anthropic model mapping: tier → Claude model */
/** Hybrid: Sonnet for fast/balanced (cheap), Opus for deep analysis */
const ANTHROPIC_MODEL_MAP: Record<ModelTier, string> = {
  fast: process.env.ANTHROPIC_MODEL_FAST || "claude-sonnet-4-20250514",
  balanced: process.env.ANTHROPIC_MODEL_BALANCED || "claude-sonnet-4-20250514",
  deep: process.env.ANTHROPIC_MODEL_DEEP || "claude-opus-4-20250514",
};

// --- Groq (fallback) ---
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

/** Groq model mapping: tier → Llama model */
const GROQ_MODEL_MAP: Record<ModelTier, string> = {
  fast: process.env.GROQ_MODEL_FAST || "llama-3.1-8b-instant",
  balanced: process.env.GROQ_MODEL_BALANCED || "llama-3.3-70b-versatile",
  deep: process.env.GROQ_MODEL_DEEP || "llama-3.3-70b-versatile",
};

const MAX_TOKENS = 4096;
const TEMPERATURE = 0.7;

/** Resolve which backend to actually use (with auto-fallback) */
function resolveBackend(): "anthropic" | "groq" {
  if (LLM_BACKEND === "anthropic" && ANTHROPIC_API_KEY) return "anthropic";
  if (LLM_BACKEND === "anthropic" && !ANTHROPIC_API_KEY) {
    console.warn("[LLM] LLM_BACKEND=anthropic but no ANTHROPIC_API_KEY — falling back to Groq");
    return "groq";
  }
  return "groq";
}

// ============================================================
// Types
// ============================================================

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  latencyMs: number;
}

// ============================================================
// Anthropic API (Claude)
// ============================================================

/**
 * Call Anthropic Messages API.
 * Splits system message from conversation messages (Anthropic requires separate system param).
 */
async function callAnthropic(
  messages: LLMMessage[],
  tier: ModelTier
): Promise<LLMResponse> {
  const model = ANTHROPIC_MODEL_MAP[tier];
  const startTime = Date.now();

  // Anthropic: system is a separate param, not in messages array
  let systemPrompt = "";
  const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + msg.content;
    } else {
      conversationMessages.push({ role: msg.role, content: msg.content });
    }
  }

  // Anthropic requires messages to start with "user" role
  // If first message is assistant, prepend a user message
  if (conversationMessages.length > 0 && conversationMessages[0].role === "assistant") {
    conversationMessages.unshift({ role: "user", content: "(session start)" });
  }

  // Ensure we have at least one user message
  if (conversationMessages.length === 0) {
    conversationMessages.push({ role: "user", content: "(hello)" });
  }

  const body: Record<string, any> = {
    model,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: conversationMessages,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const latencyMs = Date.now() - startTime;

  // Anthropic response format: { content: [{ type: "text", text: "..." }], usage: {...} }
  const content = data.content?.[0]?.text || "";
  const usage = data.usage || { input_tokens: 0, output_tokens: 0 };

  console.log(
    `[LLM] ${model} | ${usage.input_tokens + usage.output_tokens} tokens | ${latencyMs}ms`
  );

  return {
    content,
    model,
    tokensUsed: {
      prompt: usage.input_tokens || 0,
      completion: usage.output_tokens || 0,
      total: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    },
    latencyMs,
  };
}

/**
 * Stream Anthropic Messages API as async generator.
 * Yields text chunks via SSE streaming.
 */
async function* callAnthropicStream(
  messages: LLMMessage[],
  tier: ModelTier
): AsyncGenerator<string> {
  const model = ANTHROPIC_MODEL_MAP[tier];
  const startTime = Date.now();

  // Split system prompt from conversation
  let systemPrompt = "";
  const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + msg.content;
    } else {
      conversationMessages.push({ role: msg.role, content: msg.content });
    }
  }

  if (conversationMessages.length > 0 && conversationMessages[0].role === "assistant") {
    conversationMessages.unshift({ role: "user", content: "(session start)" });
  }
  if (conversationMessages.length === 0) {
    conversationMessages.push({ role: "user", content: "(hello)" });
  }

  const body: Record<string, any> = {
    model,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    messages: conversationMessages,
    stream: true,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalContent = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") break;

        try {
          const parsed = JSON.parse(data);

          // Anthropic streaming events:
          // - content_block_delta: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
          // - message_stop: end of stream
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            totalContent += parsed.delta.text;
            yield parsed.delta.text;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const latencyMs = Date.now() - startTime;
  console.log(`[LLM] Stream ${model} | ~${totalContent.length} chars | ${latencyMs}ms`);
}

// ============================================================
// Groq API (Llama — free fallback)
// ============================================================

async function callGroq(
  messages: LLMMessage[],
  tier: ModelTier
): Promise<LLMResponse> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not set. Get a free key at console.groq.com");
  }

  const model = GROQ_MODEL_MAP[tier];
  const startTime = Date.now();

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const latencyMs = Date.now() - startTime;

  const content = data.choices?.[0]?.message?.content || "";
  const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  console.log(
    `[LLM] ${model} | ${usage.total_tokens} tokens | ${latencyMs}ms`
  );

  return {
    content,
    model,
    tokensUsed: {
      prompt: usage.prompt_tokens,
      completion: usage.completion_tokens,
      total: usage.total_tokens,
    },
    latencyMs,
  };
}

async function* callGroqStream(
  messages: LLMMessage[],
  tier: ModelTier
): AsyncGenerator<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not set. Get a free key at console.groq.com");
  }

  const model = GROQ_MODEL_MAP[tier];
  const startTime = Date.now();

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalContent = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") break;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            totalContent += content;
            yield content;
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const latencyMs = Date.now() - startTime;
  console.log(`[LLM] Stream ${model} | ~${totalContent.length} chars | ${latencyMs}ms`);
}

// ============================================================
// Public API — auto-routes to active backend
// ============================================================

/**
 * Send a request to the LLM backend.
 * Automatically routes to Anthropic or Groq based on LLM_BACKEND env var.
 */
export async function callLLM(
  messages: LLMMessage[],
  tier: ModelTier = "balanced"
): Promise<LLMResponse> {
  const backend = resolveBackend();

  if (backend === "anthropic") {
    return callAnthropic(messages, tier);
  }
  return callGroq(messages, tier);
}

/**
 * Stream LLM response as an async generator.
 * Automatically routes to Anthropic or Groq based on LLM_BACKEND env var.
 */
export async function* callLLMStream(
  messages: LLMMessage[],
  tier: ModelTier = "balanced"
): AsyncGenerator<string> {
  const backend = resolveBackend();

  if (backend === "anthropic") {
    yield* callAnthropicStream(messages, tier);
  } else {
    yield* callGroqStream(messages, tier);
  }
}

/**
 * Get info about the current LLM backend (for diagnostics).
 */
export function getLLMBackendInfo(): { backend: string; models: Record<ModelTier, string> } {
  const backend = resolveBackend();
  return {
    backend,
    models: backend === "anthropic" ? ANTHROPIC_MODEL_MAP : GROQ_MODEL_MAP,
  };
}
