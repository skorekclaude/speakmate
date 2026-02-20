/**
 * SpeakMate — Agent Registry
 *
 * 8 Specialized Language Learning Agents:
 *   7 English coaches + 1 Portuguese from-scratch teacher
 */

import { readFile } from "fs/promises";
import { join } from "path";
import type { AgentConfig } from "./types.ts";

const PROMPTS_DIR = join(import.meta.dir, "../../prompts");

// ============================================================
// Agent Definitions
// ============================================================

export const AGENTS: Record<string, AgentConfig> = {
  conversation: {
    id: "conversation",
    name: "Conversation Coach",
    emoji: "🗣️",
    model: "balanced",
    description: "Swobodna rozmowa po angielsku z korektami",
    promptFile: join(PROMPTS_DIR, "conversation.md"),
    commands: ["conversation", "conv", "c", "talk"],
    allowedTools: [],
    maxTurns: 1,
  },

  grammar: {
    id: "grammar",
    name: "Grammar Coach",
    emoji: "📝",
    model: "balanced",
    description: "Ćwiczenia gramatyczne, testy, wyjaśnienia",
    promptFile: join(PROMPTS_DIR, "grammar.md"),
    commands: ["grammar", "gram", "g"],
    allowedTools: [],
    maxTurns: 1,
  },

  vocabulary: {
    id: "vocabulary",
    name: "Vocabulary Builder",
    emoji: "📚",
    model: "balanced",
    description: "Słówka, kolokacje, idiomy, false friends",
    promptFile: join(PROMPTS_DIR, "vocabulary.md"),
    commands: ["vocabulary", "vocab", "v", "words"],
    allowedTools: [],
    maxTurns: 1,
  },

  pronunciation: {
    id: "pronunciation",
    name: "Pronunciation Coach",
    emoji: "🎤",
    model: "balanced",
    description: "Wymowa, IPA, ćwiczenia z mową",
    promptFile: join(PROMPTS_DIR, "pronunciation.md"),
    commands: ["pronunciation", "pron", "p"],
    allowedTools: [],
    maxTurns: 1,
  },

  business: {
    id: "business",
    name: "Business English",
    emoji: "💼",
    model: "balanced",
    description: "Angielski biznesowy — maile, spotkania, prezentacje",
    promptFile: join(PROMPTS_DIR, "business.md"),
    commands: ["business", "biz", "b", "work"],
    allowedTools: [],
    maxTurns: 1,
  },

  travel: {
    id: "travel",
    name: "Travel English",
    emoji: "✈️",
    model: "balanced",
    description: "Angielski podróżniczy — lotnisko, hotel, restauracja",
    promptFile: join(PROMPTS_DIR, "travel.md"),
    commands: ["travel", "trip", "t"],
    allowedTools: [],
    maxTurns: 1,
  },

  popculture: {
    id: "popculture",
    name: "Pop Culture & Slang",
    emoji: "🎬",
    model: "balanced",
    description: "Slang, filmy, seriale, memy, internet",
    promptFile: join(PROMPTS_DIR, "popculture.md"),
    commands: ["popculture", "pop", "slang", "movies"],
    allowedTools: [],
    maxTurns: 1,
  },

  portuguese: {
    id: "portuguese",
    name: "Portugalski od Zera",
    emoji: "🇧🇷",
    model: "balanced",
    description: "Nauka brazylijskiego portugalskiego od podstaw",
    promptFile: join(PROMPTS_DIR, "portuguese.md"),
    commands: ["portuguese", "port", "pt", "brasil"],
    allowedTools: [],
    maxTurns: 1,
  },

};
// ============================================================
// Prompt Cache
// ============================================================

const promptCache = new Map<string, string>();

export async function getAgentPrompt(agentId: string): Promise<string> {
  const cached = promptCache.get(agentId);
  if (cached) return cached;

  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  try {
    const content = await readFile(agent.promptFile, "utf-8");
    promptCache.set(agentId, content);
    return content;
  } catch (e) {
    console.error(`[Registry] Failed to load prompt for ${agentId}:`, e);
    return `You are SpeakMate ${agent.name}. ${agent.description}. Be warm, patient, and encouraging.`;
  }
}

// ============================================================
// Auto-Routing — classify message → pick agent
// ============================================================

const ROUTING_KEYWORDS: Record<string, string[]> = {
  grammar: [
    "grammar", "gramatyka", "czas", "tense", "article", "przedimek", "a/the",
    "present perfect", "past simple", "conditional", "preposition", "przyimek",
    "ćwiczenie", "exercise", "test", "quiz", "fill in", "popraw", "correct",
    "subject", "verb", "noun", "adjective", "adverb", "passive", "reported speech",
    "word order", "szyk", "zdanie", "sentence", "rule", "zasada", "wyjątek", "exception",
  ],

  vocabulary: [
    "vocabulary", "słówka", "słownictwo", "word", "słowo", "phrase", "zwrot",
    "idiom", "false friend", "phrasal verb", "collocation", "kolokacja",
    "synonym", "antonym", "synonim", "translate", "przetłumacz", "jak powiedzieć",
    "how to say", "what does", "co znaczy", "meaning", "znaczenie",
  ],

  pronunciation: [
    "pronunciation", "wymowa", "pronounce", "wymów", "sound", "dźwięk",
    "accent", "akcent", "stress", "IPA", "th sound", "tongue", "język",
    "intonation", "intonacja", "minimal pair", "rhyme", "rym",
  ],

  business: [
    "business", "biznes", "email", "mail", "meeting", "spotkanie", "presentation",
    "prezentacja", "office", "biuro", "professional", "formal", "negotiate",
    "negocjac", "interview", "rozmowa kwalifikacyjna", "CV", "resume", "salary",
    "corporate", "manager", "colleague", "deadline",
  ],

  travel: [
    "travel", "podróż", "airport", "lotnisko", "hotel", "restaurant", "restauracja",
    "taxi", "train", "flight", "lot", "booking", "reservation", "rezerwacja",
    "customs", "passport", "luggage", "bagaż", "check-in", "checkout",
    "directions", "tourist", "turysta", "abroad", "za granicą",
  ],

  popculture: [
    "slang", "movie", "film", "series", "serial", "Netflix", "YouTube", "TikTok",
    "meme", "song", "piosenka", "lyrics", "tekst", "informal", "casual",
    "cool", "vibes", "internet", "gaming", "gra", "social media",
  ],

  portuguese: [
    "portuguese", "portugalski", "Brazil", "Brazylia", "brasileiro", "Brasil",
    "olá", "oi", "bom dia", "obrigado", "como vai", "tudo bem",
    "po portugalsku", "nauka portugalskiego", "kurs portugalskiego",
  ],
};

function normalizePolish(text: string): string {
  const map: Record<string, string> = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
    'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
  };
  return text.replace(/[ąćęłńóśźż]/gi, (ch) => map[ch.toLowerCase()] || ch);
}

export function classifyMessage(text: string): string {
  const lower = text.toLowerCase();
  const normalized = normalizePolish(lower);
  const scores: Record<string, number> = {};

  for (const [agentId, keywords] of Object.entries(ROUTING_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      const kwNorm = normalizePolish(kw);
      if (lower.includes(kw) || normalized.includes(kwNorm)) {
        score += kw.includes(" ") ? 3 : kw.length >= 4 ? 2 : 1;
      }
    }
    if (score > 0) scores[agentId] = score;
  }

  if (Object.keys(scores).length === 0) return "conversation";

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestAgent, bestScore] = sorted[0];

  if (bestScore < 2) return "conversation";

  console.log(`[Router] Classified → ${bestAgent} (score: ${bestScore})`);
  return bestAgent;
}

// ============================================================
// Helpers
// ============================================================

export function getAgent(id: string): AgentConfig {
  const agent = AGENTS[id];
  if (!agent) throw new Error(`Unknown agent: ${id}`);
  return agent;
}

export function getAgentByCommand(cmd: string): AgentConfig | undefined {
  return Object.values(AGENTS).find((a) => a.commands.includes(cmd.toLowerCase()));
}

export function getAllAgents(): AgentConfig[] {
  return Object.values(AGENTS);
}

export function getCommandsList(): string {
  return getAllAgents()
    .map((a) => `${a.emoji} /${a.commands[0]} — ${a.description}`)
    .join("
");
}

export const DEFAULT_AGENT = AGENTS.conversation;
