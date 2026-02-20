/**
 * ALLMA — Stripe Payment Integration
 *
 * Handles subscriptions, payment links, and webhook processing.
 * Two tiers:
 *   - Essencial: R$29/month (8 sessions/month)
 *   - Premium: R$79/month (unlimited sessions + voice + priority)
 */

import { type Language } from "../core/i18n.ts";

// ============================================================
// Types
// ============================================================

export type PlanTier = "free" | "essencial" | "premium";

export interface SubscriptionInfo {
  tier: PlanTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: "active" | "past_due" | "canceled" | "trialing" | "none";
  currentPeriodEnd?: string;
  sessionsUsed: number;
  sessionsLimit: number; // -1 = unlimited
}

export interface PlanConfig {
  tier: PlanTier;
  name: Record<Language, string>;
  price: string; // Display price
  priceId: string; // Stripe Price ID
  sessionsPerMonth: number; // -1 = unlimited
  features: Record<Language, string[]>;
}

// ============================================================
// Plan Configuration
// ============================================================

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

export const PLANS: Record<Exclude<PlanTier, "free">, PlanConfig> = {
  essencial: {
    tier: "essencial",
    name: { pt: "Essencial", pl: "Podstawowy", en: "Essential" },
    price: "R$ 29/mes",
    priceId: process.env.STRIPE_PRICE_ESSENCIAL || "",
    sessionsPerMonth: 8,
    features: {
      pt: [
        "8 sessoes por mes",
        "Analise com IA avancada",
        "Memoria persistente",
        "Suporte PT/PL/EN",
      ],
      pl: [
        "8 sesji miesiecznie",
        "Zaawansowana analiza AI",
        "Trwala pamiec",
        "Wsparcie PT/PL/EN",
      ],
      en: [
        "8 sessions per month",
        "Advanced AI analysis",
        "Persistent memory",
        "PT/PL/EN support",
      ],
    },
  },
  premium: {
    tier: "premium",
    name: { pt: "Premium", pl: "Premium", en: "Premium" },
    price: "R$ 79/mes",
    priceId: process.env.STRIPE_PRICE_PREMIUM || "",
    sessionsPerMonth: -1,
    features: {
      pt: [
        "Sessoes ilimitadas",
        "Board of Directors completo (7 agentes)",
        "Voz (em breve)",
        "Prioridade no suporte",
      ],
      pl: [
        "Nieograniczone sesje",
        "Pelna Rada Dyrektorow (7 agentow)",
        "Glos (wkrotce)",
        "Priorytetowe wsparcie",
      ],
      en: [
        "Unlimited sessions",
        "Full Board of Directors (7 agents)",
        "Voice (coming soon)",
        "Priority support",
      ],
    },
  },
};

// Free tier limits
const FREE_TIER: SubscriptionInfo = {
  tier: "free",
  status: "none",
  sessionsUsed: 0,
  sessionsLimit: 3, // 3 free sessions to try
};

// ============================================================
// Stripe API Calls
// ============================================================

async function stripeRequest(
  endpoint: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: Record<string, string>
): Promise<any> {
  if (!STRIPE_SECRET_KEY) {
    console.warn("[Stripe] No API key configured");
    return null;
  }

  const url = `https://api.stripe.com/v1${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
  };

  const options: RequestInit = { method, headers };

  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(body).toString();
  }

  try {
    const res = await fetch(url, options);
    const data = await res.json();

    if (!res.ok) {
      console.error(`[Stripe] API error:`, data.error?.message || data);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`[Stripe] Request failed:`, error);
    return null;
  }
}

// ============================================================
// Customer Management
// ============================================================

/** Create or retrieve a Stripe customer for a Telegram user */
export async function getOrCreateCustomer(
  userId: string,
  name?: string
): Promise<string | null> {
  // Search for existing customer by metadata
  const search = await stripeRequest(
    `/customers/search?query=metadata['telegram_id']:'${userId}'`
  );

  if (search?.data?.length > 0) {
    return search.data[0].id;
  }

  // Create new customer
  const customer = await stripeRequest("/customers", "POST", {
    name: name || `Telegram User ${userId}`,
    "metadata[telegram_id]": userId,
    "metadata[source]": "allma_bot",
  });

  return customer?.id || null;
}

// ============================================================
// Subscription Management
// ============================================================

/** Get subscription info for a user */
export async function getSubscription(
  userId: string
): Promise<SubscriptionInfo> {
  if (!STRIPE_SECRET_KEY) return { ...FREE_TIER };

  const search = await stripeRequest(
    `/customers/search?query=metadata['telegram_id']:'${userId}'`
  );

  if (!search?.data?.length) return { ...FREE_TIER };

  const customerId = search.data[0].id;

  // Get active subscriptions
  const subs = await stripeRequest(
    `/subscriptions?customer=${customerId}&status=active&limit=1`
  );

  if (!subs?.data?.length) {
    // Check for past_due
    const pastDue = await stripeRequest(
      `/subscriptions?customer=${customerId}&status=past_due&limit=1`
    );

    if (pastDue?.data?.length) {
      const sub = pastDue.data[0];
      const tier = identifyTier(sub);
      return {
        tier,
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        status: "past_due",
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        sessionsUsed: 0,
        sessionsLimit: PLANS[tier]?.sessionsPerMonth || 0,
      };
    }

    return { ...FREE_TIER, stripeCustomerId: customerId };
  }

  const sub = subs.data[0];
  const tier = identifyTier(sub);

  return {
    tier,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
    sessionsUsed: 0,
    sessionsLimit: tier === "premium" ? -1 : PLANS[tier]?.sessionsPerMonth || 0,
  };
}

/** Identify plan tier from subscription price */
function identifyTier(sub: any): Exclude<PlanTier, "free"> {
  const priceId = sub.items?.data?.[0]?.price?.id || "";
  if (priceId === PLANS.premium.priceId) return "premium";
  return "essencial"; // default
}

// ============================================================
// Payment Links (Checkout Sessions)
// ============================================================

/** Create a Stripe Checkout Session for subscription */
export async function createCheckoutSession(
  userId: string,
  tier: "essencial" | "premium",
  name?: string
): Promise<string | null> {
  if (!STRIPE_SECRET_KEY) {
    console.warn("[Stripe] No API key — cannot create checkout");
    return null;
  }

  const plan = PLANS[tier];
  if (!plan.priceId) {
    console.error(`[Stripe] No price ID configured for tier: ${tier}`);
    return null;
  }

  // Get or create customer
  const customerId = await getOrCreateCustomer(userId, name);
  if (!customerId) return null;

  const session = await stripeRequest("/checkout/sessions", "POST", {
    customer: customerId,
    "line_items[0][price]": plan.priceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    success_url: process.env.STRIPE_SUCCESS_URL || "https://allma.ai/success?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: process.env.STRIPE_CANCEL_URL || "https://allma.ai/cancel",
    "metadata[telegram_id]": userId,
    "metadata[tier]": tier,
    "subscription_data[metadata][telegram_id]": userId,
    "subscription_data[metadata][tier]": tier,
  });

  return session?.url || null;
}

/** Create a Stripe Customer Portal link for managing subscription */
export async function createPortalSession(
  userId: string
): Promise<string | null> {
  if (!STRIPE_SECRET_KEY) return null;

  const search = await stripeRequest(
    `/customers/search?query=metadata['telegram_id']:'${userId}'`
  );

  if (!search?.data?.length) return null;

  const session = await stripeRequest(
    "/billing_portal/sessions",
    "POST",
    {
      customer: search.data[0].id,
      return_url: process.env.STRIPE_PORTAL_RETURN_URL || "https://allma.ai",
    }
  );

  return session?.url || null;
}

// ============================================================
// Plan Display Messages
// ============================================================

export function getPlansMessage(lang: Language): string {
  const headers: Record<Language, string> = {
    pt: "Planos ALLMA",
    pl: "Plany ALLMA",
    en: "ALLMA Plans",
  };

  const freeLabel: Record<Language, string> = {
    pt: "Gratuito — 3 sessoes de teste",
    pl: "Darmowy — 3 sesje probne",
    en: "Free — 3 trial sessions",
  };

  let msg = `💎 *${headers[lang]}*\n\n`;
  msg += `🆓 *${freeLabel[lang]}*\n\n`;

  for (const tier of ["essencial", "premium"] as const) {
    const plan = PLANS[tier];
    const name = plan.name[lang];
    const features = plan.features[lang];

    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `${tier === "premium" ? "👑" : "✨"} *${name}* — ${plan.price}\n\n`;

    for (const feat of features) {
      msg += `  • ${feat}\n`;
    }
    msg += `\n`;
  }

  const cta: Record<Language, string> = {
    pt: "Para assinar, use:\n/subscribe essencial\n/subscribe premium",
    pl: "Aby subskrybowac, uzyj:\n/subscribe essencial\n/subscribe premium",
    en: "To subscribe, use:\n/subscribe essencial\n/subscribe premium",
  };

  msg += `${cta[lang]}`;

  return msg;
}

export function getSubscriptionStatusMessage(
  sub: SubscriptionInfo,
  lang: Language
): string {
  if (sub.tier === "free") {
    const msgs: Record<Language, string> = {
      pt: `🆓 *Plano Gratuito*\nVoce tem ${sub.sessionsLimit - sub.sessionsUsed} sessoes restantes.\n\nUse /plans para ver os planos pagos.`,
      pl: `🆓 *Plan Darmowy*\nMasz ${sub.sessionsLimit - sub.sessionsUsed} sesji pozostalych.\n\nUzyj /plans aby zobaczyc plany platne.`,
      en: `🆓 *Free Plan*\nYou have ${sub.sessionsLimit - sub.sessionsUsed} sessions remaining.\n\nUse /plans to see paid plans.`,
    };
    return msgs[lang];
  }

  const planName = PLANS[sub.tier as keyof typeof PLANS]?.name[lang] || sub.tier;
  const sessionsText = sub.sessionsLimit === -1
    ? { pt: "ilimitadas", pl: "nieograniczone", en: "unlimited" }[lang]
    : `${sub.sessionsUsed}/${sub.sessionsLimit}`;

  const statusEmoji = sub.status === "active" ? "✅" : sub.status === "past_due" ? "⚠️" : "❌";
  const statusLabel: Record<string, Record<Language, string>> = {
    active: { pt: "Ativo", pl: "Aktywny", en: "Active" },
    past_due: { pt: "Pagamento pendente", pl: "Zalegla platnosc", en: "Past due" },
    canceled: { pt: "Cancelado", pl: "Anulowany", en: "Canceled" },
    trialing: { pt: "Periodo de teste", pl: "Okres probny", en: "Trial" },
    none: { pt: "Sem assinatura", pl: "Brak subskrypcji", en: "No subscription" },
  };

  let msg = `${statusEmoji} *${planName}*\n`;
  msg += `Status: ${statusLabel[sub.status]?.[lang] || sub.status}\n`;
  msg += `${lang === "pt" ? "Sessoes" : lang === "pl" ? "Sesje" : "Sessions"}: ${sessionsText}\n`;

  if (sub.currentPeriodEnd) {
    const date = new Date(sub.currentPeriodEnd).toLocaleDateString(
      lang === "pt" ? "pt-BR" : lang === "pl" ? "pl-PL" : "en-US"
    );
    msg += `${lang === "pt" ? "Renovacao" : lang === "pl" ? "Odnowienie" : "Renewal"}: ${date}\n`;
  }

  msg += `\n${lang === "pt" ? "Gerenciar assinatura" : lang === "pl" ? "Zarzadzaj subskrypcja" : "Manage subscription"}: /manage`;

  return msg;
}
