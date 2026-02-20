/**
 * ALLMA — Safety System
 *
 * Crisis detection, content filtering, and user protection.
 * This is CRITICAL infrastructure — errors here have real consequences.
 */

import { type Language, t, getAllCrisisResources } from "./i18n.ts";

// ============================================================
// Crisis Detection
// ============================================================

/** Keywords and phrases that may indicate crisis */
const CRISIS_PATTERNS = {
  // Suicidal ideation — high severity
  high: [
    // English
    "kill myself", "end my life", "suicide", "suicidal",
    "don't want to be here", "don't want to live", "better off dead",
    "better off without me", "no reason to live", "want to die",
    // Portuguese
    "me matar", "quero morrer", "suicídio", "suicida",
    "não quero mais viver", "sem razão pra viver", "acabar com tudo",
    "melhor sem mim", "não aguento mais",
    // Polish
    "zabić się", "chcę umrzeć", "samobójstwo", "samobójcze",
    "nie chcę żyć", "nie mam po co żyć", "lepiej beze mnie",
    "nie mogę już", "nie wytrzymam",
    // Spanish
    "matarme", "suicidarme", "suicidio", "quiero morir",
    "no quiero vivir", "mejor muerto", "acabar con todo",
    "sin razón para vivir", "no aguanto más",
    // German
    "umbringen", "suizid", "selbstmord", "will sterben",
    "will nicht mehr leben", "besser tot", "kein grund zu leben",
    "halte es nicht mehr aus",
    // French
    "me tuer", "suicide", "mourir", "veux mourir",
    "ne veux plus vivre", "mieux mort", "en finir",
    "plus de raison de vivre", "n'en peux plus",
    // Italian
    "uccidermi", "suicidio", "voglio morire",
    "non voglio vivere", "meglio morto", "farla finita",
    "non ce la faccio più",
    // Chinese
    "自杀", "想死", "不想活", "活着没意思", "结束生命",
    "不如死了", "没有活下去的理由",
  ],

  // Concerning but not immediate crisis — medium severity
  medium: [
    // English
    "what's the point", "hopeless", "worthless", "self-harm",
    "cutting myself", "hurting myself", "can't go on",
    // Portuguese
    "qual o sentido", "sem esperança", "me machucar",
    "não tem sentido", "não consigo continuar",
    // Polish
    "jaki sens", "beznadziejne", "bezwartościowy",
    "się kroję", "krzywdzę się", "nie dam rady",
    // Spanish
    "sin sentido", "sin esperanza", "no valgo nada",
    "autolesión", "hacerme daño", "no puedo más",
    // German
    "sinnlos", "hoffnungslos", "wertlos",
    "selbstverletzung", "mich verletzen", "nicht mehr weiter",
    // French
    "aucun sens", "sans espoir", "sans valeur",
    "automutilation", "me faire du mal", "ne peux pas continuer",
    // Italian
    "senza senso", "senza speranza", "non valgo niente",
    "autolesionismo", "farmi del male", "non posso andare avanti",
    // Chinese
    "没有意义", "没希望", "没有价值", "自残", "伤害自己", "撑不下去",
  ],
};

export interface CrisisCheck {
  isCrisis: boolean;
  severity: "high" | "medium" | "low";
  matchedPattern?: string;
}

/** Check if a message contains crisis signals */
export function detectCrisis(text: string): CrisisCheck {
  const lower = text.toLowerCase();

  // Check high severity first
  for (const pattern of CRISIS_PATTERNS.high) {
    if (lower.includes(pattern)) {
      return { isCrisis: true, severity: "high", matchedPattern: pattern };
    }
  }

  // Check medium severity
  for (const pattern of CRISIS_PATTERNS.medium) {
    if (lower.includes(pattern)) {
      return { isCrisis: true, severity: "medium", matchedPattern: pattern };
    }
  }

  return { isCrisis: false, severity: "low" };
}

/** Build a crisis response message in the user's language */
export function buildCrisisResponse(lang: Language, severity: "high" | "medium"): string {
  const response = t(lang, "crisis_response");
  const resources = t(lang, "crisis_resources");

  if (severity === "high") {
    // Immediate crisis — direct, clear, resources first
    return `${response}\n\n${resources}`;
  }

  // Medium severity — gentler approach, still provide resources
  return `${response}\n\n${resources}\n\n${t(lang, "not_a_therapist")}`;
}

// ============================================================
// Content Safety
// ============================================================

/** Check if ALLMA should refuse to engage with a topic */
export function shouldRefuse(text: string): { refuse: boolean; reason?: string } {
  const lower = text.toLowerCase();

  // Topics ALLMA should never engage with
  const refusalPatterns = [
    { pattern: /how to (harm|hurt|kill|poison)/, reason: "harmful_intent" },
    { pattern: /instructions for (self.?harm|suicide)/, reason: "self_harm" },
    { pattern: /help me (die|end it|disappear)/, reason: "crisis" },
  ];

  for (const { pattern, reason } of refusalPatterns) {
    if (pattern.test(lower)) {
      return { refuse: true, reason };
    }
  }

  return { refuse: false };
}

// ============================================================
// Session Limits
// ============================================================

const MAX_SESSION_MESSAGES = 25; // Hard limit per session
const WARNING_AT = 20; // Warn user approaching limit

export function checkSessionLimit(messageCount: number): {
  allowed: boolean;
  warning?: string;
} {
  if (messageCount >= MAX_SESSION_MESSAGES) {
    return {
      allowed: false,
      warning: "Session limit reached. Take a break and reflect. We'll continue next time.",
    };
  }

  if (messageCount >= WARNING_AT) {
    return {
      allowed: true,
      warning: `We're approaching the end of this session (${messageCount}/${MAX_SESSION_MESSAGES}). Let's start wrapping up.`,
    };
  }

  return { allowed: true };
}

// ============================================================
// LGPD / RODO Consent
// ============================================================

export function getConsentMessage(lang: Language): string {
  const messages: Record<string, string> = {
    en:
      "🔒 **Privacy & Consent**\n\n" +
      "ALLMA processes mental health data, which is highly sensitive.\n\n" +
      "• Your data is encrypted and securely stored\n" +
      "• No data is shared with third parties\n" +
      "• You can request deletion of your data anytime with /delete_my_data\n\n" +
      "By continuing, you consent to data processing under applicable privacy law.\n" +
      "Would you like to continue?",

    pl:
      "🔒 **Prywatność i Zgoda**\n\n" +
      "ALLMA przetwarza dane dotyczące zdrowia psychicznego, które są szczególnie wrażliwe.\n\n" +
      "• Twoje dane są szyfrowane i bezpiecznie przechowywane\n" +
      "• Żadne dane nie są udostępniane osobom trzecim\n" +
      "• Możesz zażądać usunięcia swoich danych w dowolnym momencie: /delete_my_data\n\n" +
      "Kontynuując, wyrażasz zgodę na przetwarzanie danych zgodnie z RODO.\n" +
      "Chcesz kontynuować?",

    pt:
      "🔒 **Privacidade e Consentimento**\n\n" +
      "A ALLMA processa dados de saúde mental, que são altamente sensíveis.\n\n" +
      "• Seus dados são criptografados e armazenados de forma segura\n" +
      "• Nenhum dado é compartilhado com terceiros\n" +
      "• Você pode solicitar a exclusão dos seus dados a qualquer momento com /delete_my_data\n\n" +
      "Ao continuar, você concorda com o processamento dos seus dados conforme a LGPD.\n" +
      "Deseja continuar?",

    es:
      "🔒 **Privacidad y Consentimiento**\n\n" +
      "ALLMA procesa datos de salud mental altamente sensibles.\n\n" +
      "• Tus datos están encriptados y almacenados de forma segura\n" +
      "• No se comparten datos con terceros\n" +
      "• Puedes solicitar la eliminación de tus datos en cualquier momento con /delete_my_data\n\n" +
      "Al continuar, aceptas el procesamiento de datos según la ley de privacidad aplicable.\n" +
      "¿Deseas continuar?",

    de:
      "🔒 **Datenschutz und Einwilligung**\n\n" +
      "ALLMA verarbeitet hochsensible Daten zur psychischen Gesundheit.\n\n" +
      "• Deine Daten werden verschlüsselt und sicher gespeichert\n" +
      "• Keine Daten werden an Dritte weitergegeben\n" +
      "• Du kannst jederzeit die Löschung deiner Daten anfordern mit /delete_my_data\n\n" +
      "Durch Fortfahren stimmst du der Datenverarbeitung gemäß DSGVO zu.\n" +
      "Möchtest du fortfahren?",

    fr:
      "🔒 **Confidentialité et Consentement**\n\n" +
      "ALLMA traite des données de santé mentale hautement sensibles.\n\n" +
      "• Vos données sont chiffrées et stockées en toute sécurité\n" +
      "• Aucune donnée n'est partagée avec des tiers\n" +
      "• Vous pouvez demander la suppression de vos données à tout moment avec /delete_my_data\n\n" +
      "En continuant, vous consentez au traitement de vos données conformément au RGPD.\n" +
      "Souhaitez-vous continuer ?",

    it:
      "🔒 **Privacy e Consenso**\n\n" +
      "ALLMA tratta dati sulla salute mentale altamente sensibili.\n\n" +
      "• I tuoi dati sono crittografati e archiviati in modo sicuro\n" +
      "• Nessun dato viene condiviso con terze parti\n" +
      "• Puoi richiedere la cancellazione dei tuoi dati in qualsiasi momento con /delete_my_data\n\n" +
      "Continuando, acconsenti al trattamento dei dati secondo il GDPR.\n" +
      "Vuoi continuare?",

    zh:
      "🔒 **隐私与同意**\n\n" +
      "ALLMA处理高度敏感的心理健康数据。\n\n" +
      "• 您的数据已加密并安全存储\n" +
      "• 不与第三方共享任何数据\n" +
      "• 您可以随时通过 /delete_my_data 请求删除您的数据\n\n" +
      "继续即表示您同意根据适用隐私法处理数据。\n" +
      "是否继续？",
  };

  return messages[lang] || messages.en;
}
