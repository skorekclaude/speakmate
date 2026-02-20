/**
 * ALLMA — AI Life & Leadership Management Assistant
 *
 * ALLMA Core — one coach with 7 specializations:
 * - Core Coach (IFS/ACT/CBT/MI/Schema) — talks to patients
 * - Relations (Attachment/Gottman/NVC) — researcher
 * - Career (Burnout/SDT/Ikigai) — researcher
 * - Body & Fitness (Training/Running/Strength) — researcher
 * - Mindfulness (MBSR/Meditation/Breathwork/Yoga) — researcher
 * - Habits (Atomic Habits/Productivity/Chronobiology) — researcher
 * - Shadow (Jung/IFS Exile/Inner Child/Trauma) — researcher
 *
 * Specialists don't talk to patients — they research daily
 * and share knowledge with ALLMA Core.
 *
 * Stack: Bun + Groq API (Llama 3.3 70B) + Supabase + Telegram
 *
 * Usage:
 *   bun run src/index.ts
 */

import { getAllAgents, getCommandsList, DEFAULT_AGENT } from "./agents/registry.ts";
import { agentLoop } from "./core/agent-loop.ts";
import { executeTool } from "./tools/index.ts";

// ============================================================
// Boot
// ============================================================

console.log(`
╔════════════════════════════════════════╗
║     ALLMA — Coaching Team              ║
║     7 AI Specialist Agents             ║
╚════════════════════════════════════════╝
`);

// Verify environment
const required = ["GROQ_API_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env and fill in your values.");
  process.exit(1);
}

// Show registered agents
const agents = getAllAgents();
console.log(`[Boot] ${agents.length} agents registered:`);
console.log(getCommandsList());
console.log();

// ============================================================
// Quick test (remove in production)
// ============================================================

if (process.argv.includes("--test-research")) {
  // Manual trigger: bun run src/index.ts --test-research
  console.log("[Test] Running daily specialist research...");
  const { dailyResearch } = await import("./core/self-learning.ts");
  await dailyResearch();
  console.log("[Test] Research complete. Check data/knowledge.md");
  process.exit(0);
} else if (process.argv.includes("--test")) {
  console.log("[Test] Running agent loop test...");

  const result = await agentLoop({
    agent: DEFAULT_AGENT,
    userId: "test-user",
    userMessage: "Hello! What can you do?",
    executeTool: async (name, params) => executeTool(name, params),
  });

  console.log(`[Test] Agent: ${result.agentId}`);
  console.log(`[Test] Turns: ${result.turns}`);
  console.log(`[Test] Tool calls: ${result.toolCalls.length}`);
  console.log(`[Test] Response:\n${result.response}`);
} else if (process.env.TELEGRAM_BOT_TOKEN) {
  // Start Telegram bot
  const { startPolling } = await import("./integrations/telegram.ts");
  console.log("[Boot] Starting Telegram bot: @allma_coach_bot");
  startPolling();

  // Start web server (landing page, chat API, Stripe webhooks, health checks)
  try {
    const { startWebhookServer } = await import("./integrations/webhook-server.ts");
    startWebhookServer();
  } catch (e) {
    console.error("[Boot] Web server failed (bot continues):", e);
  }
} else {
  console.log("[Boot] No TELEGRAM_BOT_TOKEN set. Starting web server only...");
  try {
    const { startWebhookServer } = await import("./integrations/webhook-server.ts");
    startWebhookServer();
  } catch (e) {
    console.error("[Boot] Web server failed:", e);
  }
}
