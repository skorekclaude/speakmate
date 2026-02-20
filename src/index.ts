/**
 * SpeakMate — AI Language Tutor
 *
 * 8 Specialized Agents:
 *   7 English coaches + 1 Portuguese teacher
 *
 * Stack: Bun + Groq/Anthropic + Supabase + Web Chat
 *
 * Usage: bun run src/index.ts
 */

import { getAllAgents, getCommandsList } from "./agents/registry.ts";

// ============================================================
// Boot
// ============================================================

console.log(`
╔════════════════════════════════════════╗
║   SpeakMate — AI Language Tutor       ║
║   8 Coaching Agents                   ║
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

// Start web server
if (process.env.TELEGRAM_BOT_TOKEN) {
  const { startPolling } = await import("./integrations/telegram.ts");
  console.log("[Boot] Starting Telegram bot");
  startPolling();
}

try {
  const { startWebhookServer } = await import("./integrations/webhook-server.ts");
  startWebhookServer();
} catch (e) {
  console.error("[Boot] Web server failed:", e);
}
