/**
 * ALLMA Memory System
 *
 * Persistent memory backed by Supabase.
 * Stores facts, goals, conversation history, and user profiles.
 *
 * Supabase Tables:
 * - allma_users: UUID id + telegram_id (bigint). All other tables reference UUID.
 * - allma_memory: facts, insights, patterns (type column, not category)
 * - allma_messages: conversation history (role, content, metadata JSONB)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MemoryFact, UserProfile } from "../agents/types.ts";

// ============================================================
// Supabase Client
// ============================================================

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
    }

    supabase = createClient(url, key);
  }
  return supabase;
}

// ============================================================
// Telegram ID -> UUID Mapping Cache
// ============================================================

/** In-memory cache: telegram_id -> allma_users UUID */
const telegramToUuid = new Map<number, string>();

/**
 * Resolve a Telegram user ID to a Supabase UUID.
 * Creates the user record if it doesn't exist.
 */
export async function resolveUserId(
  telegramId: number,
  firstName?: string,
  username?: string,
  language?: string
): Promise<string> {
  // Check cache first
  const cached = telegramToUuid.get(telegramId);
  if (cached) return cached;

  const sb = getSupabase();

  // Look up by telegram_id
  const { data: existing, error: lookupError } = await sb
    .from("allma_users")
    .select("id")
    .eq("telegram_id", telegramId)
    .single();

  if (existing && !lookupError) {
    telegramToUuid.set(telegramId, existing.id);
    return existing.id;
  }

  // User doesn't exist -- create them
  const { data: created, error: createError } = await sb
    .from("allma_users")
    .insert({
      telegram_id: telegramId,
      first_name: firstName || null,
      username: username || null,
      language: language || "en",
      timezone: "UTC",
      metadata: {},
    })
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create user: ${createError?.message || "unknown error"}`);
  }

  telegramToUuid.set(telegramId, created.id);
  console.log(`[Memory] Created new user: telegram_id=${telegramId} -> uuid=${created.id}`);
  return created.id;
}

// ============================================================
// Memory Operations (allma_memory)
// ============================================================

/** Add a fact/insight/pattern to memory. `type` matches the CHECK constraint. */
export async function addFact(
  userId: string,
  type: string,
  content: string,
  sourceAgent?: string,
  deadline?: string
): Promise<string | null> {
  const sb = getSupabase();
  const metadata: Record<string, any> = {};
  if (sourceAgent) metadata.source_agent = sourceAgent; // Keep backward compat

  const insertData: Record<string, any> = {
    user_id: userId,
    type,
    content,
    metadata,
    source_agent: sourceAgent || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // For commitments, add deadline if provided
  if (type === "commitment" && deadline) {
    insertData.deadline = new Date(deadline).toISOString();
  }

  const { data, error } = await sb.from("allma_memory").insert(insertData).select("id").single();

  if (error) throw new Error(`Failed to add fact: ${error.message}`);
  console.log(`[Memory] Added [${type}]${sourceAgent ? ` via ${sourceAgent}` : ""}${deadline ? ` deadline:${deadline}` : ""}: ${content.slice(0, 60)}...`);
  return data?.id || null;
}

/** Search memory by keyword (ILIKE fallback, works without FTS index) */
export async function searchMemory(
  userId: string,
  query: string,
  limit = 10
): Promise<MemoryFact[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("allma_memory")
      .select("*")
      .eq("user_id", userId)
      .ilike("content", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[Memory] Search error: ${error.message}`);
      return [];
    }

    return (data || []) as MemoryFact[];
  } catch (e) {
    console.error(`[Memory] Search failed:`, e);
    return [];
  }
}

/** Get recent facts by type */
export async function getFactsByCategory(
  userId: string,
  type: string,
  limit = 15
): Promise<MemoryFact[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("allma_memory")
    .select("*")
    .eq("user_id", userId)
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[Memory] Type fetch error: ${error.message}`);
    return [];
  }

  return (data || []) as MemoryFact[];
}

/** Get open commitments (not yet marked as done) — last 20, newest first */
export async function getOpenCommitments(userId: string, limit = 20): Promise<MemoryFact[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("allma_memory")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "commitment")
    .is("done_at", null) // Use done_at column (not metadata.done)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[Memory] Commitments fetch error: ${error.message}`);
    return [];
  }

  return (data || []) as MemoryFact[];
}

/** Mark a commitment as done — sets done_at timestamp */
export async function markCommitmentDone(commitmentId: string): Promise<void> {
  const sb = getSupabase();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("allma_memory")
    .update({
      done_at: now,
      metadata: { done: true, completed_at: now },
      updated_at: now,
    })
    .eq("id", commitmentId);

  if (error) console.error(`[Memory] Mark commitment done error: ${error.message}`);
  else console.log(`[Memory] Commitment ${commitmentId} marked as done`);
}

/** Get overdue commitments — open commitments past deadline or older than N days */
export async function getOverdueCommitments(userId: string, daysOverdue = 2): Promise<MemoryFact[]> {
  const sb = getSupabase();

  // Try RPC first (more efficient, uses DB function from migration-002)
  try {
    const { data, error } = await sb.rpc("get_overdue_commitments", {
      p_user_id: userId,
      p_days_overdue: daysOverdue,
    });
    if (!error && data) return data as MemoryFact[];
  } catch {
    // RPC not available (migration not run yet) — fallback to manual query
  }

  // Fallback: manual query
  const { data, error } = await sb
    .from("allma_memory")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "commitment")
    .is("done_at", null)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error(`[Memory] Overdue commitments error: ${error.message}`);
    return [];
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() - daysOverdue * 24 * 60 * 60 * 1000);

  return ((data || []) as MemoryFact[]).filter(c => {
    // Has deadline that's passed
    if (c.deadline && new Date(c.deadline) < now) return true;
    // No deadline but created more than N days ago
    if (!c.deadline && c.created_at && new Date(c.created_at) < cutoff) return true;
    return false;
  });
}

// ============================================================
// Conversation History (allma_messages)
// ============================================================

/** Save a message to conversation history */
export async function saveMessage(
  userId: string,
  role: "user" | "assistant",
  content: string,
  agentId?: string
): Promise<void> {
  const sb = getSupabase();
  await sb.from("allma_messages").insert({
    user_id: userId,
    role,
    content: content.slice(0, 4000), // Cap at 4000 chars
    metadata: agentId ? { agent_id: agentId } : {},
    created_at: new Date().toISOString(),
  });
}

/** Get recent conversation history */
export async function getHistory(
  userId: string,
  limit = 10
): Promise<Array<{ role: string; content: string; metadata?: Record<string, any> }>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("allma_messages")
    .select("role, content, metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[Memory] History fetch error: ${error.message}`);
    return [];
  }

  return (data || []).reverse(); // Oldest first
}

/** Delete all conversation history for a user */
export async function deleteHistory(userId: string): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("allma_messages")
    .delete()
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.error(`[Memory] Delete history error: ${error.message}`);
    throw new Error("Failed to delete history");
  }

  return data?.length || 0;
}

/**
 * Get recent session topics for specialist research context.
 * Pulls recent user messages from allma_messages (across all users).
 * Returns condensed summary of what patients discussed recently.
 * Used by daily research pipeline to help specialists choose relevant topics.
 */
export async function getRecentSessionTopics(limit = 20): Promise<string> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from("allma_messages")
    .select("content, role, created_at")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[Memory] Recent topics fetch error: ${error.message}`);
    return "No recent session data available.";
  }

  if (!data || data.length === 0) {
    return "No recent sessions.";
  }

  // Condense into topic summaries (truncate each message, most recent first)
  const topics = data
    .map(m => m.content?.slice(0, 120) || "")
    .filter(t => t.length > 5)
    .join("\n- ");

  // Cap at 1500 chars
  const result = `- ${topics}`;
  return result.length > 1500 ? result.slice(0, 1500) + "..." : result;
}

// ============================================================
// User Profile (allma_users)
// ============================================================

/** Get user profile by UUID */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("allma_users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.log(`[Memory] No profile for ${userId}`);
    return null;
  }

  return data as UserProfile;
}

/** Get user profile by Telegram ID */
export async function getUserProfileByTelegramId(telegramId: number): Promise<UserProfile | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("allma_users")
    .select("*")
    .eq("telegram_id", telegramId)
    .single();

  if (error) {
    return null;
  }

  return data as UserProfile;
}

// ============================================================
// Web User Resolution (email-based)
// ============================================================

/** In-memory cache: email -> allma_users UUID */
const emailToUuid = new Map<string, string>();

/**
 * Resolve a web user by email to a Supabase UUID.
 * Creates the user record if it doesn't exist.
 * Used by the Web API (as opposed to resolveUserId which uses telegram_id).
 */
export async function resolveWebUserId(
  email: string,
  firstName?: string,
  language?: string
): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();

  // Check cache first
  const cached = emailToUuid.get(normalizedEmail);
  if (cached) return cached;

  const sb = getSupabase();

  // Look up by email
  const { data: existing, error: lookupError } = await sb
    .from("allma_users")
    .select("id")
    .eq("email", normalizedEmail)
    .single();

  if (existing && !lookupError) {
    emailToUuid.set(normalizedEmail, existing.id);
    return existing.id;
  }

  // User doesn't exist -- create them
  // Note: telegram_id has NOT NULL + UNIQUE constraint in DB,
  // so we use a unique negative number as sentinel for web-only users.
  const webSentinelId = -Math.floor(Date.now() / 1000 + Math.random() * 100000);
  const { data: created, error: createError } = await sb
    .from("allma_users")
    .insert({
      telegram_id: webSentinelId,
      email: normalizedEmail,
      first_name: firstName || null,
      language: language || "en",
      timezone: "UTC",
      auth_provider: "web_email",
      metadata: {},
    })
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create web user: ${createError?.message || "unknown error"}`);
  }

  emailToUuid.set(normalizedEmail, created.id);
  console.log(`[Memory] Created new web user: email=${normalizedEmail} -> uuid=${created.id}`);
  return created.id;
}

/** Update user profile */
export async function upsertUserProfile(profile: Partial<UserProfile> & { id: string }): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("allma_users")
    .update({
      ...profile,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.id);

  if (error) throw new Error(`Failed to update profile: ${error.message}`);
}
