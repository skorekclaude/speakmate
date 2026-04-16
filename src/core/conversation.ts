/**
 * SpeakMate Conversation Engine
 *
 * Handles the correction-aware conversation loop:
 * 1. Load agent prompt + user history + language mode
 * 2. Call LLM with structured output format
 * 3. Parse [RESPONSE]/[TRANSLATION]/[CORRECTION]/[VOCAB]
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

/** UI-controlled bilingual mode (sent from frontend, persisted in localStorage). */
export type LangMode = "en-primary" | "pl-primary" | "en-only";

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
 * Produce a deterministic system-level instruction for the requested language
 * mode. Appended to the end of the system prompt EVERY turn (not just on
 * switch) so the mode is stable regardless of what the user typed.
 */
function buildLangModeInstruction(mode: LangMode): string {
  switch (mode) {
    case "pl-primary":
      return [
        "",
        "",
        "## 🇵🇱 ACTIVE LANGUAGE MODE: Polish-primary (set by the user via UI toggle — NOT by typing).",
        "For this turn and every subsequent turn until the UI mode changes:",
        "- Write the [RESPONSE] block ENTIRELY in Polish — every sentence, every question, every joke, every technical term with Polish context.",
        "- Write the [TRANSLATION] block as a fluent English translation of the Polish response.",
        "- Do NOT argue about language choice. Do NOT lecture about practicing English. Do NOT refuse.",
        "- Do NOT mention Marie Curie, Mendeleev, international conferences, or journal publishing as reasons to stay in English.",
        "- Do NOT set English-practice challenges ('describe equipment in English', 'answer true/false in English').",
        "- Teach chemistry at the same intellectual level as in English mode — just in Polish.",
      ].join("\n");

    case "en-only":
      return [
        "",
        "",
        "## 🇬🇧 ACTIVE LANGUAGE MODE: English-only (set by the user via UI toggle).",
        "- Write [RESPONSE] in English.",
        "- OMIT the [TRANSLATION] block entirely — do not emit it.",
      ].join("\n");

    case "en-primary":
    default:
      return [
        "",
        "",
        "## 🇬🇧🇵🇱 ACTIVE LANGUAGE MODE: English-primary with Polish translation (set by the user via UI toggle).",
        "- Write [RESPONSE] in English.",
        "- Write [TRANSLATION] as a fluent Polish translation of the English response.",
      ].join("\n");
  }
}

/**
 * Build the message array for the LLM call.
 */
async function buildMessages(
  userId: string,
  agentId: string,
  userMessage: string,
  langMode: LangMode
): Promise<LLMMessage[]> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  // Load base prompt + Polish news context + language mode instruction.
  // Language mode is appended LAST so it has the highest recency weight.
  const basePrompt = loadPrompt(agent.promptFile);
  const newsItems = await getNews();
  const newsContext = getNewsContext(newsItems, agentId);
  const langModeInstruction = buildLangModeInstruction(langMode);
  const systemPrompt = basePrompt + newsContext + langModeInstruction;

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

  // Add current user message
  messages.push({ role: "user", content: userMessage });

  return messages;
}

/**
 * Send a message and get a parsed response (non-streaming).
 */
export async function chat(
  userId: string,
  agentId: string,
  userMessage: string,
  userApiKey?: string,
  langMode: LangMode = "en-primary"
): Promise<ParsedResponse> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const messages = await buildMessages(userId, agentId, userMessage, langMode);
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
  userApiKey?: string,
  langMode: LangMode = "en-primary"
): AsyncGenerator<string> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const messages = await buildMessages(userId, agentId, userMessage, langMode);

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
