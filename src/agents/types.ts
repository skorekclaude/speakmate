/**
 * SpeakMate Agent Types
 */

export type ModelTier = "fast" | "balanced" | "deep";

export interface AgentConfig {
  id: string;
  name: string;
  emoji: string;
  model: ModelTier;
  description: string;
  promptFile: string;
  commands: string[];
  allowedTools: string[] | null;
  maxTurns?: number;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  agentId?: string;
}

export interface UserProfile {
  id: string;
  telegram_id: number;
  username?: string | null;
  first_name?: string | null;
  email?: string | null;
  language: string;
  timezone: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface MemoryFact {
  id?: string;
  user_id: string;
  type: string;
  content: string;
  source_agent?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}
