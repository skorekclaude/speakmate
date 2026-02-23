/**
 * SpeakMate Memory — Supabase integration
 *
 * Uses sm_ prefix tables (shared Supabase instance with ALLMA).
 * Handles: user profiles, messages, vocabulary tracking, progress.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt, maskApiKey } from "./crypto.ts";

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and key required");
    supabase = createClient(url, key);
  }
  return supabase;
}

// ============================================================
// User Management
// ============================================================

export interface SMUser {
  id?: string;
  email: string;
  native_language: string;
  target_language: string;
  level: string;
  allma_user_id?: string;
  created_at?: string;
}

export async function getOrCreateUser(email: string): Promise<SMUser> {
  const sb = getSupabase();

  // Try to find existing user
  const { data: existing } = await sb
    .from("sm_users")
    .select("*")
    .eq("email", email)
    .single();

  if (existing) return existing as SMUser;

  // Create new user
  const newUser: Partial<SMUser> = {
    email,
    native_language: "pl", // Marek's native language
    target_language: "en",
    level: "intermediate",
  };

  const { data, error } = await sb
    .from("sm_users")
    .insert(newUser)
    .select()
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return data as SMUser;
}

export async function getUserByEmail(email: string): Promise<SMUser | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from("sm_users")
    .select("*")
    .eq("email", email)
    .single();
  return data as SMUser | null;
}

// ============================================================
// Message Storage
// ============================================================

export interface SMMessage {
  id?: string;
  user_id: string;
  agent_id: string;
  role: "user" | "assistant";
  content: string;
  correction?: any; // JSONB
  vocab?: any; // JSONB
  created_at?: string;
}

export async function saveMessage(msg: Omit<SMMessage, "id" | "created_at">): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("sm_messages").insert(msg);
  if (error) console.error(`[Memory] Failed to save message: ${error.message}`);
}

export async function getRecentMessages(
  userId: string,
  agentId: string,
  limit: number = 20
): Promise<SMMessage[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("sm_messages")
    .select("*")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[Memory] Failed to get messages: ${error.message}`);
    return [];
  }
  return (data || []).reverse() as SMMessage[];
}

export async function clearMessages(userId: string, agentId?: string): Promise<void> {
  const sb = getSupabase();
  let query = sb.from("sm_messages").delete().eq("user_id", userId);
  if (agentId) query = query.eq("agent_id", agentId);
  await query;
}

// ============================================================
// Vocabulary Tracking
// ============================================================

export interface SMVocab {
  id?: string;
  user_id: string;
  word: string;
  translation: string;
  times_seen: number;
  mastered: boolean;
  created_at?: string;
}

export async function trackVocabulary(
  userId: string,
  word: string,
  translation: string
): Promise<void> {
  const sb = getSupabase();

  // Check if word already tracked
  const { data: existing } = await sb
    .from("sm_vocabulary")
    .select("*")
    .eq("user_id", userId)
    .eq("word", word.toLowerCase())
    .single();

  if (existing) {
    // Increment times_seen
    await sb
      .from("sm_vocabulary")
      .update({ times_seen: (existing.times_seen || 0) + 1 })
      .eq("id", existing.id);
  } else {
    // Insert new
    await sb.from("sm_vocabulary").insert({
      user_id: userId,
      word: word.toLowerCase(),
      translation,
      times_seen: 1,
      mastered: false,
    });
  }
}

export async function updateVocabMastered(vocabId: string, mastered: boolean, userId?: string): Promise<void> {
  const sb = getSupabase();
  let query = sb
    .from("sm_vocabulary")
    .update({ mastered })
    .eq("id", vocabId);
  // IDOR protection: scope update to authenticated user
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  if (error) console.error(`[Memory] Failed to update vocab: ${error.message}`);
}

export async function getVocabulary(userId: string): Promise<SMVocab[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from("sm_vocabulary")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data || []) as SMVocab[];
}

// ============================================================
// Progress Tracking
// ============================================================

export async function trackProgress(userId: string, corrections: number, newWords: number): Promise<void> {
  const sb = getSupabase();
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await sb
    .from("sm_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  if (existing) {
    await sb
      .from("sm_progress")
      .update({
        messages_sent: (existing.messages_sent || 0) + 1,
        corrections_received: (existing.corrections_received || 0) + corrections,
        new_words: (existing.new_words || 0) + newWords,
      })
      .eq("id", existing.id);
  } else {
    await sb.from("sm_progress").insert({
      user_id: userId,
      date: today,
      messages_sent: 1,
      corrections_received: corrections,
      new_words: newWords,
    });
  }
}

export async function getProgress(userId: string, days: number = 30): Promise<any[]> {
  const sb = getSupabase();
  const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

  const { data } = await sb
    .from("sm_progress")
    .select("*")
    .eq("user_id", userId)
    .gte("date", since)
    .order("date", { ascending: true });

  return data || [];
}

// ============================================================
// BYOK — User API Key Storage (encrypted in settings JSONB)
// ============================================================

export type ByokProvider = "anthropic" | "groq";

/**
 * Auto-migration: ensure `settings JSONB` column exists on sm_users.
 * Runs once on first BYOK operation. Uses Supabase REST check —
 * if column missing, creates a one-time RPC to add it.
 */
let _byokMigrationDone = false;

async function ensureByokColumn(): Promise<void> {
  if (_byokMigrationDone) return;
  _byokMigrationDone = true; // prevent re-entry

  try {
    const sb = getSupabase();
    // Quick probe — select settings from any row (limit 1)
    const { error } = await sb.from("sm_users").select("settings").limit(1);

    if (error && error.code === "42703") {
      // Column doesn't exist — create it via RPC
      console.log("[BYOK] Column 'settings' missing, creating auto-migration RPC...");

      // First create the migration function
      const { error: rpcCreateErr } = await sb.rpc("exec_sql", {
        query: "ALTER TABLE sm_users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'"
      }).single();

      if (rpcCreateErr) {
        // RPC doesn't exist — we'll create settings on first write by patching the row
        // This is a soft fallback — column must be added via SQL editor
        console.warn("[BYOK] Cannot auto-migrate — please run migration_002_byok.sql manually:");
        console.warn("  ALTER TABLE sm_users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';");
        console.warn("  CREATE INDEX IF NOT EXISTS idx_sm_users_settings ON sm_users USING gin (settings);");
      } else {
        console.log("[BYOK] ✅ Column 'settings' added to sm_users");
      }
    } else {
      console.log("[BYOK] Column 'settings' exists — migration OK");
    }
  } catch (e) {
    console.warn("[BYOK] Migration check failed (non-critical):", e);
  }
}

export async function getUserApiKey(userId: string, provider: ByokProvider): Promise<string | null> {
  try {
    if (!process.env.BYOK_ENCRYPTION_KEY) return null;
    await ensureByokColumn();
    const sb = getSupabase();
    const { data, error } = await sb
      .from("sm_users")
      .select("settings")
      .eq("id", userId)
      .single();
    if (error || !data?.settings?.api_keys?.[provider]) return null;
    return decrypt(data.settings.api_keys[provider]);
  } catch (e) {
    console.error(`[BYOK] Failed to get ${provider} key for ${userId}:`, e);
    return null;
  }
}

export async function setUserApiKey(userId: string, provider: ByokProvider, apiKey: string): Promise<void> {
  await ensureByokColumn();
  const sb = getSupabase();
  const { data: user } = await sb.from("sm_users").select("settings").eq("id", userId).single();
  const settings = user?.settings || {};
  if (!settings.api_keys) settings.api_keys = {};
  settings.api_keys[provider] = encrypt(apiKey);
  const { error } = await sb.from("sm_users").update({ settings }).eq("id", userId);
  if (error) throw new Error(`Failed to save API key: ${error.message}`);
  console.log(`[BYOK] Saved ${provider} key for user ${userId} (${maskApiKey(apiKey)})`);
}

export async function removeUserApiKey(userId: string, provider: ByokProvider): Promise<void> {
  const sb = getSupabase();
  const { data: user } = await sb.from("sm_users").select("settings").eq("id", userId).single();
  const settings = user?.settings || {};
  if (settings.api_keys?.[provider]) {
    delete settings.api_keys[provider];
    const { error } = await sb.from("sm_users").update({ settings }).eq("id", userId);
    if (error) throw new Error(`Failed to remove API key: ${error.message}`);
    console.log(`[BYOK] Removed ${provider} key for user ${userId}`);
  }
}

export async function getUserByokStatus(userId: string): Promise<Record<ByokProvider, boolean>> {
  const result: Record<ByokProvider, boolean> = { anthropic: false, groq: false };
  try {
    if (!process.env.BYOK_ENCRYPTION_KEY) return result;
    const sb = getSupabase();
    const { data } = await sb.from("sm_users").select("settings").eq("id", userId).single();
    const keys = data?.settings?.api_keys || {};
    result.anthropic = !!keys.anthropic;
    result.groq = !!keys.groq;
  } catch {}
  return result;
}
