/**
 * SpeakMate Memory — Supabase integration
 *
 * Uses sm_ prefix tables (shared Supabase instance with ALLMA).
 * Handles: user profiles, messages, vocabulary tracking, progress.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
