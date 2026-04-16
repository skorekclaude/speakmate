/**
 * SpeakMate Agent Types
 */

export type ModelTier = "fast" | "balanced" | "deep";
export type TargetLanguage = "en" | "pt-BR";

export interface AgentConfig {
  id: string;
  name: string;
  emoji: string;
  model: ModelTier;
  description: string;
  promptFile: string;
  commands: string[];
  targetLanguage: TargetLanguage;
  voice: string; // edge-tts voice name
}

export interface Correction {
  original: string;
  corrected: string;
  rule: string;
}

export interface VocabSuggestion {
  word: string;
  alternatives: string;
  example?: string;
}

export interface ParsedResponse {
  response: string;
  translation?: string; // Polish translation of response (when language-learning bilingual mode is active)
  corrections: Correction[];
  vocabulary: VocabSuggestion[];
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  agentId?: string;
  parsed?: ParsedResponse;
}
