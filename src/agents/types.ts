/**
 * ALLMA Agent Types
 *
 * Core type definitions for the Allma Coach agent system.
 */

/** LLM model tier -- controls quality vs speed tradeoff */
export type ModelTier = "fast" | "balanced" | "deep";

/** Agent configuration -- defines a specialist in the ALLMA coaching team */
export interface AgentConfig {
  /** Unique agent ID (e.g., "core", "shadow", "relations") */
  id: string;

  /** Display name (e.g., "Research Director") */
  name: string;

  /** Emoji prefix for messages */
  emoji: string;

  /** Model tier: "deep" (best reasoning), "balanced" (good+fast), "fast" (cheapest) */
  model: ModelTier;

  /** Short description shown on agent switch */
  description: string;

  /** Path to system prompt markdown file */
  promptFile: string;

  /** Commands that activate this agent (e.g., ["relations", "rel", "r"]) */
  commands: string[];

  /** Tools this agent is allowed to use (null = ALL) */
  allowedTools: string[] | null;

  /** Max agentic turns (overrides global MAX_AGENT_TURNS) */
  maxTurns?: number;
}

/** Result from a tool execution */
export interface ToolResult {
  output: string;
  success: boolean;
  error?: string;
}

/** Tool definition */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, string>;
  dangerous?: boolean;
  execute: (params: Record<string, any>, context?: ToolContext) => Promise<ToolResult>;
}

/** Context passed to tool execution */
export interface ToolContext {
  userId: string;
  workingDir: string;
  supabase?: any;
}

/** Message in conversation history */
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  agentId?: string;
}

/**
 * User profile -- matches allma_users table in Supabase.
 * Table schema:
 *   id UUID PK, telegram_id BIGINT UNIQUE, username TEXT,
 *   first_name TEXT, language TEXT, timezone TEXT,
 *   created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, metadata JSONB
 */
export interface UserProfile {
  id: string;              // UUID
  telegram_id: number;     // Telegram user ID (bigint)
  username?: string | null;
  first_name?: string | null;
  language: string;        // pl, pt, en
  timezone: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

/**
 * Memory fact stored in Supabase (allma_memory table).
 * Table schema:
 *   id UUID PK, user_id UUID FK, type TEXT, content TEXT,
 *   source_agent TEXT, deadline TIMESTAMPTZ, done_at TIMESTAMPTZ,
 *   metadata JSONB, embedding VECTOR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
 */
export interface MemoryFact {
  id?: string;
  user_id: string;         // UUID referencing allma_users.id
  type: string;            // fact, insight, pattern, goal, note, schema, part, value, trigger, growth, resistance, onboarding, commitment, learning
  content: string;
  source_agent?: string;   // Which agent created this fact (e.g., "core", "shadow", "relations")
  deadline?: string;       // For commitments: when it should be done (ISO timestamp)
  done_at?: string;        // For commitments: when it was completed (ISO timestamp)
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  embedding?: number[];
}
