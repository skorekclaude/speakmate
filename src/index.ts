/**
 * SpeakMate — AI Language Tutor
 * Entry point
 */

import { startServer } from "./integrations/server.ts";

console.log("🗣️  SpeakMate starting...");
console.log(`   LLM Backend: ${process.env.LLM_BACKEND || "groq"}`);
console.log(`   Port: ${process.env.PORT || 3478}`);

startServer();
