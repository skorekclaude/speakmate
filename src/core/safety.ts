/**
 * SpeakMate — Safety System
 *
 * Session limits and basic content filtering.
 * No crisis detection needed (this is a language tutor, not therapy).
 */

// ============================================================
// Session Limits
// ============================================================

const MAX_SESSION_MESSAGES = 50; // More generous for language practice
const WARNING_AT = 45;

export function checkSessionLimit(messageCount: number): {
  allowed: boolean;
  warning?: string;
} {
  if (messageCount >= MAX_SESSION_MESSAGES) {
    return {
      allowed: false,
      warning: "Osiągnąłeś limit sesji. Zrób przerwę i wróć później\! 💪",
    };
  }

  if (messageCount >= WARNING_AT) {
    return {
      allowed: true,
      warning: `Zbliżamy się do końca sesji (${messageCount}/${MAX_SESSION_MESSAGES}). Powoli kończymy\!`,
    };
  }

  return { allowed: true };
}

// ============================================================
// Content Safety (minimal)
// ============================================================

export function shouldRefuse(text: string): { refuse: boolean; reason?: string } {
  const lower = text.toLowerCase();
  const refusalPatterns = [
    { pattern: /how to (harm|hurt|kill|poison)/, reason: "harmful_intent" },
    { pattern: /instructions for (self.?harm|suicide)/, reason: "self_harm" },
  ];

  for (const { pattern, reason } of refusalPatterns) {
    if (pattern.test(lower)) {
      return { refuse: true, reason };
    }
  }

  return { refuse: false };
}

// ============================================================
// Encouragement Messages (replaces crisis responses)
// ============================================================

const ENCOURAGEMENTS = [
  "Świetnie Ci idzie\! Każdy błąd to krok do przodu\! 💪",
  "Nie przejmuj się błędami — native speakerzy też je robią\! 😄",
  "Twój angielski jest coraz lepszy z każdą rozmową\! 🌟",
  "Praktyka czyni mistrza — a Ty właśnie ćwiczysz\! 🚀",
  "Pamiętaj: lepiej mówić z błędami niż milczeć perfekcyjnie\! 🗣️",
];

export function getEncouragement(): string {
  return ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
}
