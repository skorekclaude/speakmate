/**
 * ALLMA — Telegram Bot Integration
 *
 * Handles incoming messages, routes to appropriate agent,
 * manages sessions, and enforces safety checks.
 */

import { callLLM, type LLMMessage } from "../core/llm.ts";
import { detectLanguage, type Language, t } from "../core/i18n.ts";
import { detectCrisis, buildCrisisResponse, getConsentMessage, checkSessionLimit } from "../core/safety.ts";
import { getUserProfile, getUserProfileByTelegramId, resolveUserId, upsertUserProfile, saveMessage, addFact, getFactsByCategory, searchMemory, getHistory, getOpenCommitments } from "../core/memory.ts";
import { generateCheckin, isDueForCheckin } from "../core/checkin.ts";
import { extractAndStudy } from "../core/self-learning.ts";
import { classifyMessage, getAgentPrompt, getAgentByCommand, getAgent, getCommandsList, DEFAULT_AGENT } from "../agents/registry.ts";
import type { ModelTier } from "../agents/types.ts";
import { handleConversation, type UserSession } from "../core/conversation.ts";
import {
  getSubscription,
  createCheckoutSession,
  createPortalSession,
  getPlansMessage,
  getSubscriptionStatusMessage,
  type SubscriptionInfo,
} from "./stripe.ts";

// ============================================================
// Types
// ============================================================

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number; first_name?: string };
    text?: string;
    voice?: { file_id: string; duration: number };
  };
}

// UserSession imported from ../core/conversation.ts

// ============================================================
// State
// ============================================================

const sessions = new Map<string, UserSession>();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// ============================================================
// Core Message Handler
// ============================================================

export async function handleMessage(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.from) return;

  // Handle voice messages — transcribe first
  let text = msg.text?.trim() || "";

  if (!text && msg.voice) {
    try {
      console.log(`[TG] Voice message from ${msg.from.first_name || msg.from.id} (${msg.voice.duration}s)`);
      await sendChatAction(msg.chat.id, "typing");
      text = await transcribeVoice(msg.voice.file_id);
      if (text) {
        console.log(`[TG] Transcribed: "${text.slice(0, 100)}"`);
        // Don't send transcription separately — it will be shown as prefix in the response
      }
    } catch (e) {
      console.error("[TG] Voice transcription failed:", e);
      await sendMessage(msg.chat.id, "⚠️ Nie udało się przetworzyć wiadomości głosowej. Spróbuj ponownie lub napisz tekstem.");
      return;
    }
  }

  if (!text) return;

  const telegramId = msg.from.id;
  const sessionKey = String(telegramId); // Session key = telegram ID string
  const chatId = msg.chat.id;

  console.log(`[TG] ${msg.from.first_name || sessionKey}: ${text.slice(0, 80)}`);

  // Get or create session
  let session = sessions.get(sessionKey);
  if (!session) {
    session = {
      language: detectLanguage(text),
      messageCount: 0,
      onboardingStep: 0,
      consented: false,
      history: [],
      onboardingAnswers: [],
      currentAgent: "core",
    };

    // Check if returning user (survives bot restart)
    try {
      const profile = await getUserProfileByTelegramId(telegramId);
      if (profile) {
        session.consented = true;
        session.onboardingStep = 4;
        session.language = (profile.language as Language) || session.language;
        console.log(`[TG] Returning user ${sessionKey} (${profile.first_name}) — session restored from DB`);
      }
    } catch (e) {
      console.log(`[TG] Profile check on session create:`, e);
    }

    sessions.set(sessionKey, session);
  }

  session.messageCount++;

  // Resolve Telegram ID → Supabase UUID (cached after first call)
  let userId: string;
  try {
    userId = await resolveUserId(telegramId, msg.from.first_name, undefined, session.language);
  } catch (e) {
    // If DB not reachable, use telegram ID as fallback
    userId = sessionKey;
    console.error(`[TG] resolveUserId failed, using telegram ID:`, e);
  }

  // Track chat ID for proactive check-ins
  userChatIds.set(sessionKey, chatId);

  // ============================================================
  // Safety check FIRST — before anything else
  // ============================================================
  const crisis = detectCrisis(text);
  if (crisis.isCrisis) {
    console.log(`[Safety] Crisis detected for ${userId}: ${crisis.severity} — "${crisis.matchedPattern}"`);
    const response = buildCrisisResponse(session.language, crisis.severity);
    await sendMessage(chatId, response);
    return;
  }

  // ============================================================
  // Commands
  // ============================================================
  if (text.startsWith("/")) {
    const cmd = text.slice(1).split(" ")[0].toLowerCase();

    if (cmd === "start") {
      // Reset session for new onboarding
      session.onboardingStep = 0;
      session.consented = false;
      session.history = [];
      session.onboardingAnswers = [];
      session.language = detectLanguage(text) || "en";

      const disclaimer = t(session.language, "disclaimer");
      await sendMessage(chatId, `🧠 *ALLMA*\n\n${disclaimer}`);

      // Small delay for readability
      await new Promise(r => setTimeout(r, 500));
      await sendMessage(chatId, getConsentMessage(session.language));
      return;
    }

    if (cmd === "delete_my_data") {
      await sendMessage(chatId, "🗑️ Data deletion requested. Use /start to begin fresh.");
      sessions.delete(sessionKey);
      return;
    }

    if (cmd === "lang") {
      const args = text.split(" ");
      const newLang = args[1]?.toLowerCase();
      if (newLang === "pt" || newLang === "pl" || newLang === "en") {
        session.language = newLang;
        const names: Record<Language, string> = { pt: "Português 🇧🇷", pl: "Polski 🇵🇱", en: "English 🇬🇧" };
        await sendMessage(chatId, `✅ Language: ${names[newLang]}`);
      } else {
        await sendMessage(chatId, "🌍 /lang pt | pl | en");
      }
      return;
    }

    if (cmd === "reset") {
      session.history = [];
      session.messageCount = 0;
      session.currentAgent = "core";
      session.specialistOverride = undefined;
      await sendMessage(chatId, "🔄 Session reset. Start fresh!");
      return;
    }

    if (cmd === "team") {
      const list = getCommandsList();
      await sendMessage(chatId, `🧠 *ALLMA — Twój zespół specjalistów*\n\n${list}\n\n_Automatycznie dobieram wiedzę specjalistyczną do tematu. Użyj komendy np. /shadow żeby aktywować tryb głębokiej pracy._`);
      return;
    }

    if (cmd === "research") {
      // Admin command — trigger daily specialist research manually
      await sendMessage(chatId, `🔬 _Uruchamiam badania specjalistów... To może zająć kilka minut._`);
      try {
        const { dailyResearch } = await import("../core/self-learning.ts");
        await dailyResearch();
        await sendMessage(chatId, `✅ _Badania zakończone! Specjaliści wygenerowali nową wiedzę._`);
      } catch (e) {
        console.error("[Research] Manual trigger failed:", e);
        await sendMessage(chatId, `⚠️ _Badania nie powiodły się. Sprawdź logi._`);
      }
      return;
    }

    // Specialist focus commands (e.g., /shadow, /body, /relations)
    // These DON'T switch the agent — they activate specialist knowledge overlay
    const agentMatch = getAgentByCommand(cmd);
    if (agentMatch) {
      if (agentMatch.id === "core") {
        // /core resets specialist override
        session.specialistOverride = undefined;
        await sendMessage(chatId, `🧠 _Wracam do trybu ogólnego._`);
      } else {
        session.specialistOverride = agentMatch.id;
        const agent = getAgent(agentMatch.id);
        await sendMessage(chatId, `${agent.emoji} _Aktywuję wiedzę: ${agent.name}_\n_${agent.description}_\n\n_/core żeby wrócić do trybu ogólnego_`);
      }
      return;
    }

    // ============================================================
    // Payment Commands
    // ============================================================

    if (cmd === "plans" || cmd === "planos" || cmd === "plany") {
      await sendMessage(chatId, getPlansMessage(session.language));
      return;
    }

    if (cmd === "subscribe" || cmd === "assinar" || cmd === "subskrybuj") {
      const args = text.split(" ");
      const tier = args[1]?.toLowerCase();

      if (tier !== "essencial" && tier !== "premium") {
        const msgs: Record<Language, string> = {
          pt: "Use:\n/subscribe essencial — R$29/mes\n/subscribe premium — R$79/mes\n\nOu veja todos os planos: /plans",
          pl: "Uzyj:\n/subscribe essencial — R$29/mies.\n/subscribe premium — R$79/mies.\n\nLub zobacz plany: /plans",
          en: "Use:\n/subscribe essencial — R$29/mo\n/subscribe premium — R$79/mo\n\nOr see all plans: /plans",
        };
        await sendMessage(chatId, msgs[session.language]);
        return;
      }

      await sendChatAction(chatId, "typing");
      const url = await createCheckoutSession(
        userId,
        tier as "essencial" | "premium",
        msg.from.first_name
      );

      if (url) {
        const msgs: Record<Language, string> = {
          pt: `💳 Link de pagamento pronto!\n\n${url}\n\nClique para assinar o plano ${tier === "premium" ? "Premium 👑" : "Essencial ✨"}`,
          pl: `💳 Link do platnosci gotowy!\n\n${url}\n\nKliknij aby subskrybowac plan ${tier === "premium" ? "Premium 👑" : "Essencial ✨"}`,
          en: `💳 Payment link ready!\n\n${url}\n\nClick to subscribe to ${tier === "premium" ? "Premium 👑" : "Essential ✨"}`,
        };
        await sendMessage(chatId, msgs[session.language]);
      } else {
        const msgs: Record<Language, string> = {
          pt: "⚠️ Nao consegui gerar o link de pagamento. Stripe pode nao estar configurado. Tente novamente mais tarde.",
          pl: "⚠️ Nie udalo sie wygenerowac linku do platnosci. Stripe moze nie byc skonfigurowany. Sprobuj pozniej.",
          en: "⚠️ Could not generate payment link. Stripe may not be configured. Try again later.",
        };
        await sendMessage(chatId, msgs[session.language]);
      }
      return;
    }

    if (cmd === "status" || cmd === "minha_conta" || cmd === "konto") {
      await sendChatAction(chatId, "typing");
      const sub = await getSubscription(userId);
      await sendMessage(chatId, getSubscriptionStatusMessage(sub, session.language));
      return;
    }

    if (cmd === "manage" || cmd === "gerenciar" || cmd === "zarzadzaj") {
      await sendChatAction(chatId, "typing");
      const portalUrl = await createPortalSession(userId);

      if (portalUrl) {
        const msgs: Record<Language, string> = {
          pt: `⚙️ Gerencie sua assinatura:\n${portalUrl}`,
          pl: `⚙️ Zarzadzaj subskrypcja:\n${portalUrl}`,
          en: `⚙️ Manage your subscription:\n${portalUrl}`,
        };
        await sendMessage(chatId, msgs[session.language]);
      } else {
        const msgs: Record<Language, string> = {
          pt: "Nenhuma assinatura encontrada. Use /plans para ver os planos.",
          pl: "Nie znaleziono subskrypcji. Uzyj /plans aby zobaczyc plany.",
          en: "No subscription found. Use /plans to see available plans.",
        };
        await sendMessage(chatId, msgs[session.language]);
      }
      return;
    }

    // Unknown command — treat as regular message below
  }

  // ============================================================
  // Consent flow
  // ============================================================
  if (!session.consented) {
    const lower = text.toLowerCase().trim();
    const positive = ["yes", "sim", "tak", "y", "s", "t", "ok", "continue", "continuar", "kontynuuj", "claro", "jasne", "sure", "da", "si"];
    // Match if message starts with a positive word (e.g. "tak i mowic po polsku")
    const isConsent = positive.some(p => lower === p || lower.startsWith(p + " ") || lower.startsWith(p + ",") || lower.startsWith(p + "."));

    if (isConsent) {
      session.consented = true;
      session.onboardingStep = 1;

      // Re-detect language from consent message (may have language cues)
      const detectedLang = detectLanguage(text);
      if (detectedLang !== "en") session.language = detectedLang;

      // Check if returning user (has completed onboarding before)
      try {
        const onboardingFacts = await getFactsByCategory(userId, "onboarding", 1);
        if (onboardingFacts.length > 0) {
          session.onboardingStep = 4;
          const profile = await getUserProfile(userId);
          if (profile?.language) session.language = profile.language as Language;
          await sendMessage(chatId, `${t(session.language, "session_greeting")} 💭`);
          return;
        }
      } catch (e) {
        console.log(`[TG] Returning user check failed (OK for new users):`, e);
      }

      // New user — start onboarding
      await sendMessage(chatId, `💭 ${t(session.language, "onboarding_q1")}`);
      return;
    } else {
      // First message from unknown user — auto /start
      if (!text.startsWith("/")) {
        session.language = detectLanguage(text);
        const disclaimer = t(session.language, "disclaimer");
        await sendMessage(chatId, `🧠 *ALLMA*\n\n${disclaimer}`);
        await new Promise(r => setTimeout(r, 500));
        await sendMessage(chatId, getConsentMessage(session.language));
      }
      return;
    }
  }

  // ============================================================
  // Onboarding flow (3 questions)
  // ============================================================
  if (session.onboardingStep >= 1 && session.onboardingStep <= 3) {
    // Re-detect language from each onboarding answer
    const detectedLang = detectLanguage(text);
    if (detectedLang !== "en") {
      session.language = detectedLang;
      console.log(`[Onboarding] Language switched to ${detectedLang} from answer`);
    }

    session.onboardingAnswers.push(text);
    console.log(`[Onboarding] ${userId} Q${session.onboardingStep}: ${text.slice(0, 100)}`);

    session.onboardingStep++;

    if (session.onboardingStep === 2) {
      await sendMessage(chatId, `💭 ${t(session.language, "onboarding_q2")}`);
    } else if (session.onboardingStep === 3) {
      await sendMessage(chatId, `💭 ${t(session.language, "onboarding_q3")}`);
    } else {
      // Onboarding complete — save profile + answers
      session.onboardingStep = 4;

      try {
        await upsertUserProfile({
          id: userId,
          name: msg.from.first_name || "User",
          timezone: process.env.USER_TIMEZONE || "UTC",
          language: session.language,
        });

        // Save onboarding answers to memory
        const labels = ["motivation", "avoidance", "reaction"];
        for (let i = 0; i < session.onboardingAnswers.length; i++) {
          await addFact(userId, "onboarding", `[${labels[i]}] ${session.onboardingAnswers[i]}`, "core");
        }
      } catch (e) {
        console.error(`[TG] Failed to save profile/onboarding:`, e);
      }

      // Inject onboarding context into conversation history
      session.history.push({
        role: "system",
        content: `User onboarding answers:\n1. Motivation: ${session.onboardingAnswers[0] || "?"}\n2. Avoidance: ${session.onboardingAnswers[1] || "?"}\n3. Reaction style: ${session.onboardingAnswers[2] || "?"}`,
      });

      const ready: Record<Language, string> = {
        pt: "Obrigado por compartilhar 🙏\n\nJá tenho uma boa noção de quem você é. Estou aqui pra te ajudar a se entender melhor.\n\nPode começar quando quiser — me conta o que está na sua cabeça. 💭",
        pl: "Dziękuję za podzielenie się 🙏\n\nMam już obraz tego, kim jesteś. Jestem tu, żeby pomóc Ci lepiej siebie zrozumieć.\n\nZacznij kiedy chcesz — powiedz mi co masz na głowie. 💭",
        en: "Thank you for sharing 🙏\n\nI have a good sense of who you are now. I'm here to help you understand yourself better.\n\nStart whenever you're ready — tell me what's on your mind. 💭",
      };
      await sendMessage(chatId, ready[session.language]);
    }
    return;
  }

  // ============================================================
  // Session limit check
  // ============================================================
  const limit = checkSessionLimit(session.messageCount);
  if (!limit.allowed) {
    await sendMessage(chatId, `⏰ ${limit.warning}`);
    return;
  }

  // ============================================================
  // Main conversation — delegated to conversation.ts
  // ============================================================

  try {
    await sendChatAction(chatId, "typing");

    const result = await handleConversation({ userId, text, session });

    // Build single combined message: transcription prefix + response
    const parts: string[] = [];

    // Voice transcription prefix
    if (msg.voice) {
      parts.push(`🎙️ _${text}_`);
    }

    // Main response
    parts.push(result.reply);

    // Append session warning if approaching limit
    if (result.sessionLimitWarning) {
      parts.push(`_${result.sessionLimitWarning}_`);
    }

    await sendMessage(chatId, parts.join("\n\n"));
  } catch (error) {
    console.error(`[TG] LLM error:`, error);
    const errorMsgs: Record<Language, string> = {
      pt: "Desculpe, tive um problema técnico. Pode repetir?",
      pl: "Przepraszam, miałam problem techniczny. Możesz powtórzyć?",
      en: "Sorry, I had a technical issue. Could you repeat that?",
    };
    await sendMessage(chatId, `⚠️ ${errorMsgs[session.language]}`);
  }
}

// NOTE: extractSpecialistKnowledge, cleanLLMResponse, extractAndSaveInsights
// moved to src/core/conversation.ts

// ============================================================
// Voice Transcription (Groq Whisper)
// ============================================================

async function transcribeVoice(fileId: string): Promise<string> {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");

  // 1. Get file path from Telegram
  const fileRes = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const fileData = await fileRes.json() as any;
  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error(`getFile failed: ${JSON.stringify(fileData)}`);
  }

  const filePath = fileData.result.file_path;
  console.log(`[Voice] Downloading: ${filePath}`);

  // 2. Download voice file from Telegram CDN
  const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const audioRes = await fetch(downloadUrl);
  if (!audioRes.ok) throw new Error(`Download failed: ${audioRes.status}`);

  const audioBuffer = await audioRes.arrayBuffer();
  console.log(`[Voice] Downloaded ${(audioBuffer.byteLength / 1024).toFixed(1)} KB`);

  // 3. Send to Groq Whisper API for transcription
  // Telegram sends .oga files — Groq only accepts .ogg (same codec, different extension)
  const formData = new FormData();
  let ext = filePath.split(".").pop() || "ogg";
  if (ext === "oga") ext = "ogg"; // Fix: Telegram .oga → Whisper-compatible .ogg
  formData.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), `voice.${ext}`);
  formData.append("model", "whisper-large-v3");

  const whisperRes = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: formData,
  });

  if (!whisperRes.ok) {
    const err = await whisperRes.text();
    throw new Error(`Whisper API error ${whisperRes.status}: ${err}`);
  }

  const result = await whisperRes.json() as any;
  const transcript = result.text?.trim() || "";
  console.log(`[Voice] Transcribed (${transcript.length} chars)`);
  return transcript;
}

// ============================================================
// Telegram API
// ============================================================

async function sendMessage(chatId: number, text: string): Promise<void> {
  if (!BOT_TOKEN) {
    console.log(`[TG-dry] ${chatId}: ${text.slice(0, 100)}...`);
    return;
  }

  try {
    // Try with Markdown first
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });

    if (!res.ok) {
      const data = await res.json() as any;
      // Only retry without Markdown if it was a parse error
      if (data?.description?.includes("parse") || data?.description?.includes("Can't")) {
        console.log(`[TG] Markdown parse failed, retrying plain text`);
        // Strip markdown formatting before resending
        const plainText = text.replace(/[_*`\[]/g, "");
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: plainText }),
        });
      } else {
        console.error(`[TG] Send failed: ${data?.description || res.status}`);
      }
    }
  } catch (error) {
    console.error(`[TG] Send error:`, error);
  }
}

async function sendChatAction(chatId: number, action: string): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {}
}

// ============================================================
// Daily Check-in Scheduler
// ============================================================

/** Track active users' chat IDs for proactive check-ins */
const userChatIds = new Map<string, number>();

/**
 * Scheduler that runs every 30 minutes.
 * Sends daily check-ins between 8:00-10:00 local time.
 * Only sends to users who have consented and completed onboarding.
 */
function startCheckinScheduler(): void {
  const CHECKIN_INTERVAL = 30 * 60 * 1000; // 30 minutes
  const CHECKIN_HOUR_START = 8;
  const CHECKIN_HOUR_END = 10;

  console.log("[Checkin] Scheduler started (every 30min, 8-10 AM window)");

  setInterval(async () => {
    const now = new Date();
    const hour = now.getHours();

    // Only send between 8-10 AM
    if (hour < CHECKIN_HOUR_START || hour >= CHECKIN_HOUR_END) return;

    for (const [userId, session] of sessions.entries()) {
      // Skip if not onboarded or no consent
      if (!session.consented || session.onboardingStep < 4) continue;

      // Skip if no chat ID known
      const chatId = userChatIds.get(userId);
      if (!chatId) continue;

      // Skip if already checked in today
      if (!isDueForCheckin(userId)) continue;

      try {
        console.log(`[Checkin] Generating for user ${userId}`);
        const checkinMsg = await generateCheckin(userId, session.language);
        if (checkinMsg) {
          await sendMessage(chatId, `💭 ${checkinMsg}`);
          await saveMessage(userId, "assistant", checkinMsg, "checkin");
          console.log(`[Checkin] Sent to ${userId}`);
        }
      } catch (e) {
        console.error(`[Checkin] Failed for ${userId}:`, e);
      }
    }
  }, CHECKIN_INTERVAL);
}

// ============================================================
// Specialist Research Scheduler
// ============================================================

/**
 * Daily research scheduler — specialists study their domains independently.
 * Runs once per day at 3:00 AM (low traffic, no impact on user experience).
 * Each of 6 specialists generates new clinical knowledge.
 */
function startResearchScheduler(): void {
  const RESEARCH_INTERVAL = 60 * 60 * 1000; // Check every hour
  const RESEARCH_HOUR = 3; // Run at 3:00 AM

  let lastResearchDate = "";

  console.log("[Research] Scheduler started (daily at 3:00 AM)");

  setInterval(async () => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    // Only run once per day, at the designated hour
    if (now.getHours() !== RESEARCH_HOUR) return;
    if (lastResearchDate === today) return;

    lastResearchDate = today;
    console.log(`[Research] 🔬 Triggering daily specialist research...`);

    try {
      const { dailyResearch } = await import("../core/self-learning.ts");
      await dailyResearch();
    } catch (e) {
      console.error("[Research] Daily research failed:", e);
    }
  }, RESEARCH_INTERVAL);
}

// ============================================================
// Long-Polling
// ============================================================

export async function startPolling(): Promise<void> {
  console.log("[TG] Starting long-polling for @allma_coach_bot...");

  // Start schedulers
  startCheckinScheduler();
  startResearchScheduler();

  let offset = 0;

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`,
        { signal: AbortSignal.timeout(35000) }
      );
      const data = await res.json();

      if (data.ok && data.result?.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          try {
            await handleMessage(update);
          } catch (error) {
            console.error(`[TG] Handler error:`, error);
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "TimeoutError") {
        console.error("[TG] Polling error:", error);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
