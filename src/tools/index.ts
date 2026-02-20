/**
 * ALLMA Tool Registry
 *
 * Central registry for all agent tools. Tools can be:
 * - Memory tools (search, add facts, read/write)
 * - Web tools (search, browse)
 * - Integration tools (Gmail, Calendar)
 * - System tools (shell, filesystem) — dangerous, require confirmation
 *
 * Each tool has a `dangerous` flag — dangerous tools require
 * user confirmation before execution.
 */

import type { Tool, ToolResult, ToolContext } from "../agents/types.ts";

// ============================================================
// Tool Registry
// ============================================================

const _tools = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  _tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return _tools.get(name);
}

export function getAllTools(): Tool[] {
  return Array.from(_tools.values());
}

export function getToolsDescription(): string {
  const tools = getAllTools();
  if (tools.length === 0) return "";

  const lines = tools.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const danger = t.dangerous ? " [REQUIRES CONFIRMATION]" : "";
    return `- ${t.name}(${params}) — ${t.description}${danger}`;
  });

  return "AVAILABLE TOOLS:\n" + lines.join("\n");
}

/**
 * Execute a tool by name with given parameters.
 * Returns result with output and success status.
 */
export async function executeTool(
  name: string,
  params: Record<string, any>,
  context?: ToolContext
): Promise<ToolResult> {
  const tool = _tools.get(name);
  if (!tool) {
    return {
      output: "",
      success: false,
      error: `Unknown tool: ${name}`,
    };
  }

  try {
    return await tool.execute(params, context);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      output: "",
      success: false,
      error: `Tool ${name} error: ${msg}`,
    };
  }
}

/**
 * Check if a tool call requires user confirmation.
 */
export function requiresConfirmation(name: string): boolean {
  const tool = _tools.get(name);
  return tool?.dangerous === true;
}

// ============================================================
// Built-in Tools (Memory)
// ============================================================

import { addFact, searchMemory, getFactsByCategory } from "../core/memory.ts";

registerTool({
  name: "search_memory",
  description: "Search persistent memory for facts, goals, insights",
  parameters: { query: "Search query string" },
  async execute(params) {
    const userId = "default"; // TODO: pass from context
    const facts = await searchMemory(userId, params.query, 10);
    if (facts.length === 0) {
      return { output: "No matching memories found.", success: true };
    }
    const text = facts
      .map((f) => `[${f.type}] ${f.content}`)
      .join("\n");
    return { output: text, success: true };
  },
});

registerTool({
  name: "add_fact",
  description: "Save a fact, insight, or goal to persistent memory",
  parameters: {
    type: "Type: fact, goal, insight, pattern, schema, part, value, trigger, growth, resistance, onboarding",
    content: "The content to remember",
  },
  async execute(params) {
    const userId = "default"; // TODO: pass from context
    const type = params.type || params.category || "fact";
    await addFact(userId, type, params.content);
    return { output: `Saved to memory: [${type}] ${params.content}`, success: true };
  },
});

registerTool({
  name: "memory_read",
  description: "Read facts by type (fact, goal, insight, pattern, schema, part, value, trigger, growth, resistance, onboarding)",
  parameters: { type: "Type to read" },
  async execute(params) {
    const userId = "default"; // TODO: pass from context
    const type = params.type || params.category || "fact";
    const facts = await getFactsByCategory(userId, type, 15);
    if (facts.length === 0) {
      return { output: `No facts of type: ${type}`, success: true };
    }
    const text = facts.map((f) => f.content).join("\n");
    return { output: text, success: true };
  },
});

// ============================================================
// Web Search Tool (placeholder)
// ============================================================

registerTool({
  name: "web_search",
  description: "Search the web for information",
  parameters: { query: "Search query" },
  async execute(params) {
    // TODO: Implement with DuckDuckGo or Perplexity Sonar
    return {
      output: `[web_search] Not yet implemented. Query: ${params.query}`,
      success: false,
      error: "Web search not configured. Set OPENROUTER_API_KEY for Perplexity Sonar.",
    };
  },
});

console.log(`[Tools] Registered ${_tools.size} tools: ${[..._tools.keys()].join(", ")}`);
