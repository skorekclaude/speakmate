/**
 * ALLMA Agent Loop
 *
 * ReAct-style agentic loop: Reason → Act → Observe → Repeat.
 * Each agent can use tools within their allowed set.
 *
 * Flow:
 * 1. Build prompt (system + memory + history + user message)
 * 2. Call LLM
 * 3. Parse response for [TOOL_CALL] blocks
 * 4. Execute tools, feed results back
 * 5. Repeat until final answer or max turns reached
 */

import { readFile } from "fs/promises";
import { callLLM, type LLMMessage } from "./llm.ts";
import { getHistory, saveMessage, searchMemory } from "./memory.ts";
import { getKnowledgeContext } from "./self-learning.ts";
import type { AgentConfig, ToolResult } from "../agents/types.ts";

// ============================================================
// Constants
// ============================================================

const MAX_CONVERSATION_CHARS = 20_000;
const TOOL_CALL_REGEX = /\[TOOL_CALL\]\s*(\w+)\((.*?)\)\s*\[\/TOOL_CALL\]/gs;

// ============================================================
// Core Agent Loop
// ============================================================

export interface AgentLoopOptions {
  agent: AgentConfig;
  userId: string;
  userMessage: string;
  executeTool: (name: string, params: Record<string, any>) => Promise<ToolResult>;
}

export interface AgentLoopResult {
  response: string;
  agentId: string;
  toolCalls: Array<{ tool: string; params: Record<string, any>; result: ToolResult }>;
  turns: number;
}

export async function agentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { agent, userId, userMessage, executeTool } = options;
  const maxTurns = agent.maxTurns || parseInt(process.env.MAX_AGENT_TURNS || "5");
  const toolCalls: AgentLoopResult["toolCalls"] = [];

  // 1. Load system prompt + accumulated knowledge
  let systemPrompt: string;
  try {
    systemPrompt = await readFile(agent.promptFile, "utf-8");
  } catch {
    systemPrompt = `You are ${agent.name}. ${agent.description}`;
  }

  // Load accumulated self-study knowledge (persistent between restarts)
  try {
    const knowledgeContext = await getKnowledgeContext(agent.id, 2000);
    if (knowledgeContext) {
      systemPrompt += knowledgeContext;
      console.log(`[Agent] ${agent.id}: Loaded accumulated knowledge`);
    }
  } catch (e) {
    // Knowledge loading is optional, don't fail the session
  }

  // 2. Load memory context
  const memoryFacts = await searchMemory(userId, userMessage, 10);
  const memoryContext = memoryFacts.length
    ? "\n\n[Memory]\n" + memoryFacts.map((f) => `- [${f.type}] ${f.content}`).join("\n")
    : "";

  // 3. Load conversation history
  const history = await getHistory(userId, 8);
  const historyMessages: LLMMessage[] = history.map((h) => ({
    role: h.role as "user" | "assistant",
    content: h.content.slice(0, 200),
  }));

  // 4. Build messages
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt + memoryContext },
    ...historyMessages,
    { role: "user", content: userMessage },
  ];

  // 5. Agent loop
  let lastResponse = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    // Check conversation size
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars > MAX_CONVERSATION_CHARS) {
      console.log(`[Agent] ${agent.id}: Conversation too long (${totalChars}ch), forcing final answer`);
      messages.push({
        role: "system",
        content: "IMPORTANT: Conversation is too long. Give your FINAL answer NOW. No more tool calls.",
      });
    }

    // Call LLM
    const llmResponse = await callLLM(messages, agent.model);
    lastResponse = llmResponse.content;

    // Parse tool calls
    const calls = parseToolCalls(lastResponse);

    if (calls.length === 0) {
      // No tool calls — this is the final answer
      break;
    }

    // Execute tool calls
    const toolResults: string[] = [];
    for (const call of calls) {
      // Check if agent is allowed to use this tool
      if (agent.allowedTools && !agent.allowedTools.includes(call.tool)) {
        toolResults.push(`[ERROR] Agent ${agent.id} is not allowed to use tool: ${call.tool}`);
        continue;
      }

      console.log(`[Agent] ${agent.id}: Calling ${call.tool}(${JSON.stringify(call.params)})`);
      const result = await executeTool(call.tool, call.params);
      toolCalls.push({ tool: call.tool, params: call.params, result });
      toolResults.push(
        result.success
          ? `[${call.tool}] ${result.output}`
          : `[${call.tool} ERROR] ${result.error}`
      );
    }

    // Feed tool results back to conversation
    messages.push({ role: "assistant", content: lastResponse });
    messages.push({
      role: "user",
      content: "Tool results:\n" + toolResults.join("\n\n"),
    });
  }

  // Clean up tool call syntax from final response
  const cleanResponse = lastResponse
    .replace(TOOL_CALL_REGEX, "")
    .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, "")
    .trim();

  // Save to history
  await saveMessage(userId, "user", userMessage);
  await saveMessage(userId, "assistant", cleanResponse, agent.id);

  return {
    response: cleanResponse,
    agentId: agent.id,
    toolCalls,
    turns: toolCalls.length + 1,
  };
}

// ============================================================
// Tool Call Parser
// ============================================================

interface ParsedToolCall {
  tool: string;
  params: Record<string, any>;
}

function parseToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  let match;

  // Reset regex state
  TOOL_CALL_REGEX.lastIndex = 0;

  while ((match = TOOL_CALL_REGEX.exec(text)) !== null) {
    const tool = match[1];
    const argsStr = match[2].trim();

    try {
      // Try JSON first
      const params = argsStr ? JSON.parse(argsStr) : {};
      calls.push({ tool, params });
    } catch {
      // Fall back to key=value parsing
      const params: Record<string, any> = {};
      const kvRegex = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*(\S+)/g;
      let kvMatch;
      while ((kvMatch = kvRegex.exec(argsStr)) !== null) {
        const key = kvMatch[1] || kvMatch[3];
        const value = kvMatch[2] || kvMatch[4];
        params[key] = value;
      }
      if (Object.keys(params).length > 0) {
        calls.push({ tool, params });
      }
    }
  }

  return calls;
}
