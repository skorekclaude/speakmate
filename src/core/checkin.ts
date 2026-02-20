/**
 * ALLMA — Adaptive Daily Check-in System
 *
 * Generates personalized check-in messages based on:
 * - Open commitments (accountability)
 * - Recent insights & patterns
 * - Day of week / time of day
 * - Rotation to avoid repetitive questions
 *
 * Architecture:
 *   buildCheckinPrompt() → LLM generates personalized check-in → sent via Telegram
 */

import { callLLM } from "./llm.ts";
import { getOpenCommitments, getFactsByCategory, getHistory } from "./memory.ts";
import type { Language } from "./i18n.ts";

// ============================================================
// Check-in State (per user)
// ============================================================

interface CheckinState {
  lastCheckinDate: string; // YYYY-MM-DD
  lastQuestionTypes: string[]; // Track last 5 question types to avoid repetition
  streakDays: number;
}

const checkinStates = new Map<string, CheckinState>();

// ============================================================
// Question Pool — rotated to keep things fresh
// ============================================================

const QUESTION_POOLS: Record<string, Record<Language, string[]>> = {
  energy: {
    pl: [
      "Jak się dziś czujesz energetycznie? Skala 1-10?",
      "Jaki jest Twój poziom energii w tym momencie?",
      "Gdybyś miał opisać swoją energię dziś jednym słowem — jakie by to było?",
    ],
    pt: [
      "Como está sua energia hoje? Escala 1-10?",
      "Qual o seu nível de energia neste momento?",
      "Se tivesse que descrever sua energia hoje em uma palavra — qual seria?",
    ],
    en: [
      "How's your energy today? Scale 1-10?",
      "What's your energy level right now?",
      "If you had to describe your energy today in one word — what would it be?",
    ],
  },
  emotion: {
    pl: [
      "Jaka emocja dominuje dziś u Ciebie?",
      "Co czujesz teraz, w tym momencie?",
      "Jakbyś narysował swój nastrój — jaki kolor by miał?",
    ],
    pt: [
      "Qual emoção domina em você hoje?",
      "O que você está sentindo agora, neste momento?",
      "Se desenhasse seu humor — que cor teria?",
    ],
    en: [
      "What emotion is dominant for you today?",
      "What are you feeling right now, in this moment?",
      "If you drew your mood — what color would it be?",
    ],
  },
  body: {
    pl: [
      "Jak Twoje ciało się czuje dziś? Coś boli, jest napięte?",
      "Ruszałeś się dziś? Nawet krótki spacer?",
      "Jak spałeś ostatnio?",
    ],
    pt: [
      "Como seu corpo está se sentindo hoje? Alguma dor ou tensão?",
      "Você se movimentou hoje? Mesmo uma caminhada curta?",
      "Como dormiu ultimamente?",
    ],
    en: [
      "How does your body feel today? Any pain or tension?",
      "Did you move today? Even a short walk?",
      "How's your sleep been lately?",
    ],
  },
  reflection: {
    pl: [
      "Co było najlepszą rzeczą wczoraj?",
      "Czego się dziś nauczyłeś o sobie?",
      "Za co jesteś dziś wdzięczny?",
    ],
    pt: [
      "Qual foi a melhor coisa de ontem?",
      "O que você aprendeu sobre si hoje?",
      "Pelo que você é grato hoje?",
    ],
    en: [
      "What was the best thing about yesterday?",
      "What did you learn about yourself today?",
      "What are you grateful for today?",
    ],
  },
  intention: {
    pl: [
      "Jaka jest Twoja intencja na dziś?",
      "Jedna rzecz, którą chcesz dziś zrobić dla siebie?",
      "Co byłoby 'wygraną' dnia?",
    ],
    pt: [
      "Qual é sua intenção para hoje?",
      "Uma coisa que quer fazer por si mesmo hoje?",
      "O que seria uma 'vitória' do dia?",
    ],
    en: [
      "What's your intention for today?",
      "One thing you want to do for yourself today?",
      "What would be a 'win' for the day?",
    ],
  },
};

const QUESTION_TYPES = Object.keys(QUESTION_POOLS);

// ============================================================
// Core: Generate Adaptive Check-in
// ============================================================

/**
 * Build a personalized daily check-in message for a user.
 * Uses LLM to weave together base questions + user context.
 */
export async function generateCheckin(
  userId: string,
  language: Language
): Promise<string> {
  // 1. Get user state
  const state = getOrCreateState(userId);
  const today = new Date().toISOString().split("T")[0];

  // Already checked in today?
  if (state.lastCheckinDate === today) {
    return ""; // Skip — already sent today
  }

  // 2. Load context
  const [commitments, patterns, growth, recentHistory] = await Promise.all([
    getOpenCommitments(userId, 10),
    getFactsByCategory(userId, "pattern", 5),
    getFactsByCategory(userId, "growth", 3),
    getHistory(userId, 4),
  ]);

  // 3. Pick question types (rotate, avoid last used)
  const availableTypes = QUESTION_TYPES.filter(
    (t) => !state.lastQuestionTypes.slice(-2).includes(t) // Skip last 2 used
  );
  // Pick 2 question types
  const shuffled = availableTypes.sort(() => Math.random() - 0.5);
  const selectedTypes = shuffled.slice(0, 2);

  // Get random question from each pool
  const baseQuestions = selectedTypes.map((type) => {
    const pool = QUESTION_POOLS[type][language] || QUESTION_POOLS[type].en;
    return pool[Math.floor(Math.random() * pool.length)];
  });

  // 4. Build commitment accountability section
  let accountabilityNote = "";
  if (commitments.length > 0) {
    const now = new Date();
    const overdue = commitments.filter((c) => {
      const age = (now.getTime() - new Date(c.created_at || "").getTime()) / (1000 * 60 * 60 * 24);
      return age >= 2;
    });

    if (overdue.length > 0) {
      accountabilityNote = `\nOPEN COMMITMENTS (user promised these — ask gently):\n${overdue.map((c) => `- ${c.content}`).join("\n")}`;
    }
  }

  // 5. Build context for LLM
  const patternNote = patterns.length > 0
    ? `\nKNOWN PATTERNS: ${patterns.map((p) => p.content).join("; ")}`
    : "";
  const growthNote = growth.length > 0
    ? `\nRECENT GROWTH: ${growth.map((g) => g.content).join("; ")}`
    : "";

  const dayOfWeek = new Date().toLocaleDateString("en", { weekday: "long" });
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  const langMap: Record<Language, string> = {
    pl: "Polish",
    pt: "Brazilian Portuguese",
    en: "English",
  };

  const checkinSystemPrompt = `You are ALLMA, a warm personal wellness coach sending a daily check-in message.

CONTEXT:
- It's ${dayOfWeek} ${timeOfDay}
- User's streak: ${state.streakDays} days
- Language: ${langMap[language]}${patternNote}${growthNote}${accountabilityNote}

BASE QUESTIONS TO INCLUDE (reword naturally, don't copy verbatim):
${baseQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

RULES:
- Write in ${langMap[language]}
- Keep it SHORT — max 4-5 sentences total
- Be warm but not cheesy
- If there are open commitments, ask about ONE of them naturally
- If it's Monday, add a "week intention" angle
- If it's Friday, add a "weekend self-care" angle
- Reference known patterns/growth ONLY if very relevant
- End with an open question
- Use a relevant emoji or two, but don't overdo it
- Do NOT include greetings like "Cześć!" or "Oi!" — just start naturally`;

  try {
    const result = await callLLM(
      [{ role: "system", content: checkinSystemPrompt }],
      "fast"
    );

    // Update state
    state.lastCheckinDate = today;
    state.lastQuestionTypes = [...state.lastQuestionTypes, ...selectedTypes].slice(-5);
    state.streakDays++;

    return result.content.trim();
  } catch (e) {
    console.error(`[Checkin] LLM generation failed:`, e);
    // Fallback — just use base questions
    return baseQuestions.join("\n\n");
  }
}

/**
 * Check if a user is due for a check-in today.
 */
export function isDueForCheckin(userId: string): boolean {
  const state = checkinStates.get(userId);
  if (!state) return true;

  const today = new Date().toISOString().split("T")[0];
  return state.lastCheckinDate !== today;
}

// ============================================================
// Internal
// ============================================================

function getOrCreateState(userId: string): CheckinState {
  let state = checkinStates.get(userId);
  if (!state) {
    state = {
      lastCheckinDate: "",
      lastQuestionTypes: [],
      streakDays: 0,
    };
    checkinStates.set(userId, state);
  }
  return state;
}
