/**
 * SpeakMate — Conversation Handler
 *
 * Core message processing for language tutoring.
 * Flow:
 *   1. Classify agent (conversation/grammar/vocab/etc.)
 *   2. Load agent prompt
 *   3. Load user memory from Supabase
 *   4. Build system prompt + history
 *   5. Call LLM
 *   6. Save messages
 *   7. Return response
 */

import { callLLM, type LLMMessage } from "./llm.ts";
import type { Language } from "./i18n.ts";
import { checkSessionLimit } from "./safety.ts";
import {
  saveMessage,
  getHistory,
  getFactsByCategory,
} from "./memory.ts";
import {
  classifyMessage,
  getAgentPrompt,
  getAgent,
} from "../agents/registry.ts";
import type { ModelTier } from "../agents/types.ts";

// ============================================================
// Types
// ============================================================

export interface UserSession {
  language: Language;
  messageCount: number;
  history: LLMMessage[];
  currentAgent: string;
  specialistOverride?: string;
}

export interface ConversationInput {
  userId: string;
  text: string;
  session: UserSession;
}

export interface ConversationResult {
  reply: string;
  specialistDomain: string;
  tokensUsed: number;
  sessionLimitWarning?: string;
}

// ============================================================
// Main Handler
// ============================================================

export async function handleConversation(
  input: ConversationInput
): Promise<ConversationResult> {
  const { userId, text, session } = input;

  // Session limit check
  const limit = checkSessionLimit(session.messageCount);
  if (\!limit.allowed) {
    return {
      reply: `⏰ ${limit.warning}`,
      specialistDomain: "conversation",
      tokensUsed: 0,
      sessionLimitWarning: limit.warning,
    };
  }

  // Add user message to history
  session.history.push({ role: "user", content: text });

  // Keep history manageable (last 20 messages)
  if (session.history.length > 20) {
    const systemMsgs = session.history.filter((m) => m.role === "system");
    const convMsgs = session.history
      .filter((m) => m.role \!== "system")
      .slice(-16);
    session.history = [...systemMsgs, ...convMsgs];
  }

  // Detect specialist domain
  const specialistDomain =
    session.specialistOverride || classifyMessage(text);

  // Load agent prompt
  const agentPrompt = await getAgentPrompt(specialistDomain);
  const agent = getAgent(specialistDomain);
  const modelTier: ModelTier = agent.model;

  if (specialistDomain \!== "conversation") {
    console.log(
      `[Router] ${agent.emoji} ${specialistDomain}${session.specialistOverride ? " (manual)" : ""}`
    );
  }

  // Load memory context from Supabase
  let memoryContext = "";
  try {
    const [levelFacts, history] = await Promise.all([
      getFactsByCategory(userId, "level_assessment", 3),
      getHistory(userId, 6),
    ]);

    const sections: string[] = [];

    if (levelFacts.length > 0) {
      sections.push(
        `### User Level
${levelFacts.map((f) => `- ${f.content}`).join("
")}`
      );
    }

    if (history.length > 0) {
      sections.push(
        `### Recent History
${history.map((h) => `${h.role}: ${h.content.slice(0, 150)}`).join("
")}`
      );
    }

    if (sections.length > 0) {
      memoryContext = `

## USER CONTEXT

${sections.join("

")}`;
    }
  } catch (e) {
    console.error(`[Memory] Failed:`, e);
  }

  // Build messages for LLM
  const systemContent =
    "🌐 LANGUAGE: UI and corrections in Polish. Conversation in the target language (English or Portuguese depending on the agent).

" +
    agentPrompt +
    memoryContext;

  const messages: LLMMessage[] = [
    { role: "system", content: systemContent },
    ...session.history,
  ];

  // Call LLM
  const response = await callLLM(messages, modelTier);

  // Add to history
  session.history.push({ role: "assistant", content: response.content });

  // Save to Supabase
  try {
    await saveMessage(userId, "user", text);
    await saveMessage(userId, "assistant", response.content, specialistDomain);
  } catch (e) {
    console.error(`[Conversation] DB save failed:`, e);
  }

  const reply = cleanResponse(response.content);

  return {
    reply,
    specialistDomain,
    tokensUsed: response.tokensUsed.total,
    sessionLimitWarning: limit.warning || undefined,
  };
}

// ============================================================
// Response Cleaning
// ============================================================

function cleanResponse(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/
{3,}/g, "

").trim();
  return cleaned;
}
