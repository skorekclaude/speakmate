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
  userMessage: string
): Promise<ParsedResponse> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const messages = await buildMessages(userId, agentId, userMessage);
  const response = await callLLM(messages, agent.model);

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
  userMessage: string
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

  let fullResponse = "";

  for await (const chunk of callLLMStream(messages, agent.model)) {
    fullResponse += chunk;
    yield chunk;
  }

  // Parse the complete response
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
