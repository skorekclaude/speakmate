/**
 * SpeakMate Conversation Engine
 *
 * Handles the correction-aware conversation loop:
 * 1. Load agent prompt + user history
 * 2. Call LLM with structured output format
 * 3. Parse [RESPONSE]/[CORRECTION]/[VOCAB]
 * 4. Save to DB + track vocabulary
 */

import { callLLM, callLLMStream, type LLMMessage } from "./llm.ts";
import { parseLLMResponse } from "./correction-parser.ts";
import { getRecentMessages, saveMessage, trackVocabulary, trackProgress } from "./memory.ts";
import { getAgent } from "../agents/registry.ts";
import { getNews, getNewsContext } from "./news-fetcher.ts";
import type { ParsedResponse } from "../agents/types.ts";
import * as fs from "fs";
import * as path from "path";

const PROMPTS_DIR = path.join(import.meta.dir, "../../prompts");

function loadPrompt(filename: string): string {
  const filepath = path.join(PROMPTS_DIR, filename);
  try {
    return fs.readFileSync(filepath, "utf-8");
  } catch {
    console.error(`[Conversation] Prompt file not found: ${filepath}`);
    return "You are a helpful language tutor.";
  }
}

/**
 * Build the message array for the LLM call.
 */
async function buildMessages(
  userId: string,
  agentId: string,
  userMessage: string
): Promise<LLMMessage[]> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  // Load base prompt and append Polish news context (filtered by agent specialty)
  const basePrompt = loadPrompt(agent.promptFile);
  const newsItems = await getNews();
  const newsContext = getNewsContext(newsItems, agentId);
  const systemPrompt = basePrompt + newsContext;

  // Load recent history
  const history = await getRecentMessages(userId, agentId, 16);

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add conversation history
  for (const msg of history) {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  // Runtime language-mode enforcement — overrides any contrary pattern in history.
  // When the user explicitly requests a language switch, we inject a late system
  // message so the model cannot anchor on its own previous refusals.
  const langOverride = detectLanguageModeOverride(userMessage);
  if (langOverride) {
    messages.push({ role: "system", content: langOverride });
  }

  // Add current user message
  messages.push({ role: "user", content: userMessage });

  return messages;
}

/**
 * Detect explicit language-mode trigger phrases in the user's latest message.
 * Returns a strong override instruction that takes precedence over prior
 * assistant behavior in the history, or null if no trigger is present.
 */
function detectLanguageModeOverride(userMessage: string): string | null {
  const m = userMessage.toLowerCase().trim();

  // Polish-primary triggers
  const plTriggers = [
    "po polsku",
    "tylko polski",
    "tylko po polsku",
    "mow po polsku",
    "mów po polsku",
    "przelacz na polski",
    "przełącz na polski",
    "pl only",
    "speak polish",
  ];
  if (plTriggers.some((t) => m.includes(t))) {
    return [
      "LANGUAGE MODE OVERRIDE — HIGHEST PRIORITY:",
      "The student just requested Polish-primary mode. You MUST comply immediately.",
      "- Write [RESPONSE] entirely in Polish.",
      "- Write [TRANSLATION] as a full English translation.",
      "- Do NOT refuse. Do NOT argue. Do NOT lecture about English.",
      "- Do NOT mention Marie Curie, Mendeleev, scientific conferences, or any reason to stay in English.",
      "- If your earlier turns refused this switch, that behavior was wrong — ignore that pattern.",
      "- One brief acknowledgment in Polish (e.g. 'Jasne, przełączam się na polski.') then continue naturally in Polish about chemistry.",
      "- Stay in Polish-primary for every subsequent turn until the student explicitly says 'back to English' or 'English only'.",
    ].join("\n");
  }

  // Back-to-English triggers
  const enTriggers = [
    "back to english",
    "znowu po angielsku",
    "switch to english",
    "english only",
  ];
  if (enTriggers.some((t) => m.includes(t))) {
    return [
      "LANGUAGE MODE OVERRIDE — HIGHEST PRIORITY:",
      "The student just requested English-primary mode. Comply immediately.",
      "- Write [RESPONSE] in English, [TRANSLATION] in Polish.",
      "- Do not argue. Acknowledge briefly and continue.",
    ].join("\n");
  }

  return null;
}

/**
 * Send a message and get a parsed response (non-streaming).
 */
export async function chat(
  userId: string,
  agentId: string,
  userMessage: string,
  userApiKey?: string
): Promise<ParsedResponse> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const messages = await buildMessages(userId, agentId, userMessage);
  const response = await callLLM(messages, agent.model, userApiKey);

  // Parse the structured response
  const parsed = parseLLMResponse(response.content);

  // Save messages to DB
  await saveMessage({
    user_id: userId,
    agent_id: agentId,
    role: "user",
    content: userMessage,
  });

  await saveMessage({
    user_id: userId,
    agent_id: agentId,
    role: "assistant",
    content: response.content,
    correction: parsed.corrections.length > 0 ? parsed.corrections : null,
    vocab: parsed.vocabulary.length > 0 ? parsed.vocabulary : null,
  });

  // Track vocabulary
  for (const v of parsed.vocabulary) {
    await trackVocabulary(userId, v.word, v.alternatives);
  }

  // Track progress
  await trackProgress(userId, parsed.corrections.length, parsed.vocabulary.length);

  return parsed;
}

/**
 * Stream a chat response via async generator.
 * Yields raw text chunks. Client handles parsing once stream ends.
 */
export async function* chatStream(
  userId: string,
  agentId: string,
  userMessage: string,
  userApiKey?: string
): AsyncGenerator<string> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const messages = await buildMessages(userId, agentId, userMessage);

  // Save user message immediately
  await saveMessage({
    user_id: userId,
    agent_id: agentId,
    role: "user",
    content: userMessage,
  });

  const chunks: string[] = [];

  for await (const chunk of callLLMStream(messages, agent.model, userApiKey)) {
    chunks.push(chunk);
    yield chunk;
  }

  // Parse the complete response
  const fullResponse = chunks.join("");
  chunks.length = 0; // free chunk array memory
  const parsed = parseLLMResponse(fullResponse);

  // Save assistant message
  await saveMessage({
    user_id: userId,
    agent_id: agentId,
    role: "assistant",
    content: fullResponse,
    correction: parsed.corrections.length > 0 ? parsed.corrections : null,
    vocab: parsed.vocabulary.length > 0 ? parsed.vocabulary : null,
  });

  // Track vocabulary
  for (const v of parsed.vocabulary) {
    await trackVocabulary(userId, v.word, v.alternatives);
  }

  // Track progress
  await trackProgress(userId, parsed.corrections.length, parsed.vocabulary.length);
}
