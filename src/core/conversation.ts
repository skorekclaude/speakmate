/**
 * ALLMA — Channel-Agnostic Conversation Handler
 *
 * Core message processing logic extracted from telegram.ts.
 * Used by both Telegram bot and Web API.
 *
 * Flow:
 *   1. Classify specialist domain
 *   2. Load specialist knowledge + shared knowledge
 *   3. Load user memory context from Supabase
 *   4. Build system prompt + history
 *   5. Call LLM (Groq)
 *   6. Save messages to Supabase
 *   7. Trigger self-learning (async)
 *   8. Return cleaned response
 */

import { callLLM, type LLMMessage } from "./llm.ts";
import type { Language } from "./i18n.ts";
import { checkSessionLimit } from "./safety.ts";
import {
  saveMessage,
  addFact,
  getFactsByCategory,
  searchMemory,
  getHistory,
  getOpenCommitments,
} from "./memory.ts";
import { extractAndStudy } from "./self-learning.ts";
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
  onboardingStep: number; // 0=consent, 1-3=questions, 4=ready
  consented: boolean;
  history: LLMMessage[]; // In-memory conversation history
  onboardingAnswers: string[];
  currentAgent: string; // Always "core"
  specialistOverride?: string; // Manual specialist focus
}

export interface ConversationInput {
  userId: string; // Supabase UUID
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

/**
 * Process a user message and return ALLMA's response.
 * Channel-agnostic — works for Telegram, Web, or any future channel.
 */
export async function handleConversation(
  input: ConversationInput
): Promise<ConversationResult> {
  const { userId, text, session } = input;

  // Session limit check
  const limit = checkSessionLimit(session.messageCount);
  if (!limit.allowed) {
    return {
      reply: `⏰ ${limit.warning}`,
      specialistDomain: "core",
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
      .filter((m) => m.role !== "system")
      .slice(-16);
    session.history = [...systemMsgs, ...convMsgs];
  }

  // ── Detect specialist domain ──
  const specialistDomain =
    session.specialistOverride || classifyMessage(text);
  let specialistContext = "";

  if (specialistDomain !== "core") {
    try {
      const specialistPrompt = await getAgentPrompt(specialistDomain);
      specialistContext = extractSpecialistKnowledge(
        specialistPrompt,
        specialistDomain
      );
      const specAgent = getAgent(specialistDomain);
      console.log(
        `[Router] Enriching core with ${specAgent.emoji} ${specialistDomain} knowledge${session.specialistOverride ? " (manual override)" : ""}`
      );
    } catch (e) {
      console.log(
        `[Router] Failed to load specialist ${specialistDomain}:`,
        e
      );
    }
  }

  // Always use core agent
  const activeAgent = getAgent("core");
  let agentPrompt = await getAgentPrompt("core");
  const modelTier: ModelTier =
    specialistDomain !== "core"
      ? getAgent(specialistDomain).model
      : activeAgent.model;

  // Load shared team knowledge base
  try {
    const { getKnowledgeContext } = await import("./self-learning.ts");
    const knowledgeCtx = await getKnowledgeContext("core", 1500);
    if (knowledgeCtx) {
      agentPrompt += knowledgeCtx;
    }
    if (specialistDomain !== "core") {
      const specKnowledge = await getKnowledgeContext(
        specialistDomain,
        800
      );
      if (specKnowledge) {
        agentPrompt += specKnowledge;
      }
    }
  } catch {}

  // ── Load memory context from Supabase ──
  let memoryContext = "";
  try {
    const [facts, history, searchResults] = await Promise.all([
      getFactsByCategory(userId, "onboarding", 5),
      getHistory(userId, 6),
      searchMemory(userId, text.split(" ").slice(0, 3).join(" "), 5),
    ]);

    const [
      patterns,
      schemas,
      parts,
      values,
      triggers,
      growth,
      resistance,
      commitments,
    ] = await Promise.all([
      getFactsByCategory(userId, "pattern", 10),
      getFactsByCategory(userId, "schema", 5),
      getFactsByCategory(userId, "part", 5),
      getFactsByCategory(userId, "value", 5),
      getFactsByCategory(userId, "trigger", 5),
      getFactsByCategory(userId, "growth", 5),
      getFactsByCategory(userId, "resistance", 5),
      getOpenCommitments(userId, 10),
    ]);

    const sections: string[] = [];

    if (facts.length > 0) {
      sections.push(
        `### Onboarding Profile\n${facts.map((f) => `- ${f.content}`).join("\n")}`
      );
    }
    if (patterns.length > 0) {
      sections.push(
        `### Identified Patterns\n${patterns.map((f) => `- ${f.content}`).join("\n")}`
      );
    }
    if (schemas.length > 0) {
      sections.push(
        `### Active Schemas\n${schemas.map((f) => `- ${f.content}`).join("\n")}`
      );
    }
    if (parts.length > 0) {
      sections.push(
        `### IFS Parts Map\n${parts.map((f) => `- ${f.content}`).join("\n")}`
      );
    }
    if (values.length > 0) {
      sections.push(
        `### Core Values\n${values.map((f) => `- ${f.content}`).join("\n")}`
      );
    }
    if (triggers.length > 0) {
      sections.push(
        `### Known Triggers\n${triggers.map((f) => `- ${f.content}`).join("\n")}`
      );
    }
    if (growth.length > 0) {
      sections.push(
        `### Growth & Breakthroughs\n${growth.map((f) => `- ${f.content}`).join("\n")}`
      );
    }
    if (resistance.length > 0) {
      sections.push(
        `### Areas of Resistance\n${resistance.map((f) => `- ${f.content}`).join("\n")}`
      );
    }
    if (commitments.length > 0) {
      const now = new Date();
      const commitmentLines = commitments.map((c) => {
        const age = Math.floor(
          (now.getTime() - new Date(c.created_at || "").getTime()) /
            (1000 * 60 * 60 * 24)
        );
        const ageSuffix =
          age >= 3
            ? ` ⚠️ (${age} days ago — follow up!)`
            : ` (${age}d ago)`;
        return `- ${c.content}${ageSuffix}`;
      });
      sections.push(
        `### Open Commitments (ACCOUNTABILITY — ask about these!)\n${commitmentLines.join("\n")}`
      );
    }

    if (searchResults.length > 0) {
      const unique = searchResults.filter(
        (s) => !facts.some((f) => f.id === s.id)
      );
      if (unique.length > 0) {
        sections.push(
          `### Related Memory\n${unique.map((f) => `- [${f.type || "fact"}] ${f.content}`).join("\n")}`
        );
      }
    }

    if (history.length > 0) {
      sections.push(
        `### Recent Conversation History\n${history.map((h) => `${h.role}: ${h.content.slice(0, 150)}`).join("\n")}`
      );
    }

    if (sections.length > 0) {
      memoryContext = `\n\n## USER MEMORY CONTEXT (use this actively — reference specific items)\n\n${sections.join("\n\n")}`;
    }

    if (memoryContext) {
      console.log(
        `[Memory] Loaded ${sections.length} sections | Agent: ${activeAgent.emoji} ${activeAgent.id}`
      );
    }
  } catch (e) {
    console.error(`[Memory] Failed to load context:`, e);
  }

  // ── Build messages for LLM ──
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

  const teamContext = `\n\nYou are ALLMA — one expert coach with the knowledge of 7 specialists (Core Psychology, Relations, Career, Body & Fitness, Mindfulness, Habits, Shadow Work). You seamlessly incorporate specialist knowledge when relevant. You NEVER say "let me switch you to another specialist" — YOU are the specialist. If user asks about fitness, relationships, shadow work, etc. — you answer with full expertise. Never deflect to other agents.`;

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        languageInstruction[session.language] +
        agentPrompt +
        specialistContext +
        teamContext +
        memoryContext,
    },
    ...session.history,
  ];

  // ── Call LLM ──
  const response = await callLLM(messages, modelTier);

  // Add assistant response to history
  session.history.push({ role: "assistant", content: response.content });

  // Save to Supabase (best effort)
  try {
    await saveMessage(userId, "user", text);
    await saveMessage(userId, "assistant", response.content, "core");
  } catch (e) {
    console.error(`[Conversation] DB save failed:`, e);
  }

  // ── Self-Learning: Extract insights after every 3rd message ──
  if (session.messageCount % 3 === 0 && session.history.length >= 4) {
    extractAndSaveInsights(
      userId,
      session.history,
      session.language,
      "core"
    ).catch((e) => console.error(`[SelfLearn] Extraction failed:`, e));

    const studySummary = session.history
      .filter((m) => m.role !== "system")
      .slice(-8)
      .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
      .join("\n");
    extractAndStudy(
      specialistDomain !== "core" ? specialistDomain : "core",
      userId,
      studySummary
    ).catch((e) => console.error(`[SelfLearn] Study failed:`, e));
  }

  const reply = cleanLLMResponse(response.content);

  return {
    reply,
    specialistDomain,
    tokensUsed: response.tokensUsed.total,
    sessionLimitWarning: limit.warning || undefined,
  };
}

// ============================================================
// Specialist Knowledge Extraction
// ============================================================

/**
 * Extract specialist knowledge sections from a specialist prompt.
 * Skips identity, critical rules, response patterns — only takes
 * the "Academic Foundations" / domain knowledge sections.
 */
function extractSpecialistKnowledge(
  fullPrompt: string,
  domain: string
): string {
  const agent = getAgent(domain);

  const stopSections = [
    "## Session Structure",
    "## Response Pattern",
    "## Response Quality",
    "## YOUR ROLE",
    "## SAFETY",
    "## Self-Learning",
    "## Language Behavior",
    "## What You ARE",
    "## Emotional Profile",
    "## Core Clinical Techniques",
    "## Continuity Between",
  ];

  const academicStart = fullPrompt.indexOf("## Academic Foundations");
  if (academicStart === -1) {
    const sections = fullPrompt.split(/(?=^## )/m);
    const knowledgeSections = sections.filter((s) => {
      const header = s.split("\n")[0].toLowerCase();
      return (
        !header.includes("critical") &&
        !header.includes("role") &&
        !header.includes("safety") &&
        !header.includes("response") &&
        !header.includes("session") &&
        !header.includes("language") &&
        !header.includes("self-learning") &&
        header.includes("#")
      );
    });
    if (knowledgeSections.length === 0) return "";
    const knowledge = knowledgeSections.join("\n").slice(0, 3000);
    return `\n\n## SPECIALIST KNOWLEDGE: ${agent.emoji} ${agent.name}\n${knowledge}\n\nUse this specialist knowledge when relevant to the user's current topic. Integrate it naturally — you ARE the expert.`;
  }

  let extracted = fullPrompt.slice(academicStart);

  let cutoffIndex = extracted.length;
  for (const stop of stopSections) {
    const idx = extracted.indexOf(stop);
    if (idx > 0 && idx < cutoffIndex) {
      cutoffIndex = idx;
    }
  }

  extracted = extracted.slice(0, cutoffIndex).trim();

  if (extracted.length > 3000) {
    extracted = extracted.slice(0, 3000);
    const lastNewline = extracted.lastIndexOf("\n");
    if (lastNewline > 2500) {
      extracted = extracted.slice(0, lastNewline);
    }
    extracted += "\n[...truncated for brevity]";
  }

  return `\n\n## SPECIALIST KNOWLEDGE: ${agent.emoji} ${agent.name}\n${extracted}\n\nUse this specialist knowledge when relevant to the user's current topic. Integrate it naturally — you ARE the expert.`;
}

// ============================================================
// Response Cleaning
// ============================================================

/**
 * Remove tag artifacts that Llama sometimes appends to responses.
 */
export function cleanLLMResponse(text: string): string {
  let cleaned = text.trim();

  cleaned = cleaned.replace(/\s+[A-Z][A-Z /\-]{2,}$/gm, "");
  cleaned = cleaned.replace(
    /\s*\[(?:PATTERN|SCHEMA|PART|VALUE|TRIGGER|GROWTH|RESISTANCE|COMMITMENT|CONTACT|CONTACT_UPDATE|CONTACT_NOTE)\][^\n]*/g,
    ""
  );
  cleaned = cleaned.replace(/^\s*[A-Z][A-Z /\-]{3,}\s*$/gm, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

// ============================================================
// Self-Learning: Insight Extraction
// ============================================================

/**
 * Analyze recent conversation and extract psychological insights.
 * Runs in background (async, fire-and-forget).
 */
async function extractAndSaveInsights(
  userId: string,
  history: LLMMessage[],
  language: Language,
  sourceAgent: string = "core"
): Promise<void> {
  const recentHistory = history
    .filter((m) => m.role !== "system")
    .slice(-8)
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const extractionPrompt = `You are a clinical insight extraction system. Analyze this conversation and extract psychological insights.

CONVERSATION:
${recentHistory}

RULES:
- Extract ONLY if there are genuine insights (not small talk)
- Each insight must be tagged with EXACTLY one category
- Write insights in English (for consistency in memory)
- Be specific and actionable — reference exact words/behaviors from the conversation
- Maximum 3 insights per extraction

CATEGORIES (use exactly these tags):
[PATTERN] — Recurring behavioral or emotional patterns
[SCHEMA] — Early maladaptive schemas (abandonment, defectiveness, unrelenting standards, etc.)
[PART] — IFS parts identified (inner critic, protector, exile, etc.)
[VALUE] — Core values that emerged
[TRIGGER] — Emotional triggers identified
[GROWTH] — Progress, breakthroughs, new awareness
[RESISTANCE] — Avoidance patterns, deflection, topic changes
[COMMITMENT] — User committed to doing something specific (exercise, habit, action, call someone, etc.)

OUTPUT FORMAT (one per line, nothing else):
[CATEGORY] YYYY-MM-DD: Insight text here

If no meaningful insights to extract, output exactly: NONE`;

  try {
    const result = await callLLM(
      [{ role: "system", content: extractionPrompt }],
      "fast"
    );

    const lines = result.content
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("["));

    if (lines.length === 0) {
      console.log(`[SelfLearn] No insights extracted this round`);
      return;
    }

    const today = new Date().toISOString().split("T")[0];
    let savedCount = 0;

    for (const line of lines) {
      const match = line.match(
        /^\[(\w+)\]\s*(?:\d{4}-\d{2}-\d{2}:\s*)?(.+)$/
      );
      if (!match) continue;

      const [, tag, content] = match;
      const category = tag.toLowerCase();

      const validCategories = [
        "pattern",
        "schema",
        "part",
        "value",
        "trigger",
        "growth",
        "resistance",
        "commitment",
      ];
      if (!validCategories.includes(category)) continue;

      await addFact(
        userId,
        category,
        `${today}: ${content.trim()}`,
        sourceAgent
      );
      savedCount++;
    }

    if (savedCount > 0) {
      console.log(
        `[SelfLearn] Saved ${savedCount} insights for user ${userId}`
      );
    }
  } catch (e) {
    console.error(`[SelfLearn] LLM extraction error:`, e);
  }
}
