/**
 * SpeakMate Agent Registry
 *
 * 6 language tutors: 5 English + 1 Brazilian Portuguese
 */

import type { AgentConfig } from "./types.ts";

const agents: AgentConfig[] = [
  {
    id: "general",
    name: "Alex",
    emoji: "\ud83c\udf93",
    model: "balanced",
    description: "General English tutor. Everyday conversations with grammar corrections.",
    promptFile: "general.md",
    commands: ["general", "alex", "a"],
    targetLanguage: "en",
    voice: "en-US-GuyNeural",
  },
  {
    id: "youth",
    name: "Zara",
    emoji: "\ud83d\udd25",
    model: "balanced",
    description: "Gen-Z slang expert. Modern expressions and youth culture.",
    promptFile: "youth.md",
    commands: ["youth", "zara", "z"],
    targetLanguage: "en",
    voice: "en-US-JennyNeural",
  },
  {
    id: "chemist",
    name: "Dr. Chen",
    emoji: "\ud83e\uddea",
    model: "deep",
    description: "Chemistry professor. Scientific terminology and academic English.",
    promptFile: "chemist.md",
    commands: ["chemist", "chen", "c"],
    targetLanguage: "en",
    voice: "en-US-AriaNeural",
  },
  {
    id: "dating",
    name: "Sam",
    emoji: "\ud83d\udc95",
    model: "balanced",
    description: "British dating coach. Romantic vocabulary and flirting in English.",
    promptFile: "dating.md",
    commands: ["dating", "sam", "d"],
    targetLanguage: "en",
    voice: "en-GB-RyanNeural",
  },
  {
    id: "artist",
    name: "Luna",
    emoji: "\ud83c\udfa8",
    model: "deep",
    description: "Art & philosophy intellectual. Debates, culture, deep conversations.",
    promptFile: "artist.md",
    commands: ["artist", "luna", "l"],
    targetLanguage: "en",
    voice: "en-GB-SoniaNeural",
  },
  {
    id: "brasileiro",
    name: "Rafael",
    emoji: "\ud83c\udde7\ud83c\uddf7",
    model: "balanced",
    description: "Brazilian Portuguese from zero. Teaches PT-BR with Rio spirit!",
    promptFile: "brasileiro.md",
    commands: ["brasileiro", "rafael", "br", "pt"],
    targetLanguage: "pt-BR",
    voice: "pt-BR-AntonioNeural",
  },
];

/** Get agent by ID */
export function getAgent(id: string): AgentConfig | undefined {
  return agents.find((a) => a.id === id);
}

/** Get agent by command keyword */
export function getAgentByCommand(command: string): AgentConfig | undefined {
  const cmd = command.toLowerCase();
  return agents.find((a) => a.commands.includes(cmd));
}

/** Get all agents */
export function getAllAgents(): AgentConfig[] {
  return agents;
}

/** Default agent */
export function getDefaultAgent(): AgentConfig {
  return agents[0]; // Alex
}
