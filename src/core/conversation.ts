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

  // Detect language-mode triggers in the user's current message.
  const langOverride = detectLanguageModeOverride(userMessage);

  // Load base prompt. Append news context UNLESS a language switch was
  // requested — news context embeds "discuss in the student's target language"
  // which anchors the model to the agent's default (English for Dr. Majka),
  // fighting against the PL override. We skip news on this turn for a clean switch.
  const basePrompt = loadPrompt(agent.promptFile);
  let systemPrompt = basePrompt;
  if (!langOverride) {
    const newsItems = await getNews();
    const newsContext = getNewsContext(newsItems, agentId);
    systemPrompt = basePrompt + newsContext;
  }

  // Load recent history — but purge it entirely when a language switch is
  // requested. Claude is very prone to anchoring on its own prior refusals in
  // the history, so purging is the most reliable way to break the pattern.
  // Normal conversation continuity resumes automatically on the next turn.
  const history = langOverride?.purgeHistory
    ? []
    : await getRecentMessages(userId, agentId, 16);

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add conversation history (unless purged)
  for (const msg of history) {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  // Inject late system message for language-mode override.
  if (langOverride) {
    messages.push({ role: "system", content: langOverride.systemMessage });
  }

  // Add current user message
  messages.push({ role: "user", content: userMessage });

  return messages;
}

/**
 * Detect explicit language-mode trigger phrases in the user's latest message.
 *
 * Returns:
 *   - systemMessage: strong override instruction appended after the system prompt
 *   - purgeHistory: whether to drop conversation history for this request to
 *     prevent the model from anchoring on its own prior refusals
 *
 * Returns null if no trigger is present.
 */
function detectLanguageModeOverride(
  userMessage: string
): { systemMessage: string; purgeHistory: boolean } | null {
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
    return {
      purgeHistory: true,
      systemMessage: [
        "LANGUAGE MODE OVERRIDE — HIGHEST PRIORITY:",
        "The student just requested Polish-primary mode. You MUST comply immediately.",
        "- Write [RESPONSE] entirely in Polish.",
        "- Write [TRANSLATION] as a full English translation.",
        "- Do NOT refuse. Do NOT argue. Do NOT lecture about English.",
        "- Do NOT mention Marie Curie, Mendeleev, scientific conferences, publishing in English journals, or any reason to stay in English.",
        "- Do NOT set English-practice challenges ('describe equipment in English').",
        "- One brief acknowledgment in Polish (e.g. 'Jasne, przełączam się na polski. O czym chcesz porozmawiać z chemii?') then continue naturally in Polish about chemistry.",
        "- Stay in Polish-primary for every subsequent turn until the student explicitly says 'back to English' or 'English only'.",
      ].join("\n"),
    };
  }

  // Back-to-English triggers
  const enTriggers = [
    "back to english",
    "znowu po angielsku",
    "switch to english",
    "english only",
  ];
  if (enTriggers.some((t) => m.includes(t))) {
    return {
      purgeHistory: false,
      systemMessage: [
        "LANGUAGE MODE OVERRIDE — HIGHEST PRIORITY:",
        "The student just requested English-primary mode. Comply immediately.",
        "- Write [RESPONSE] in English, [TRANSLATION] in Polish.",
        "- Do not argue. Acknowledge briefly and continue.",
      ].join("\n"),
    };
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
