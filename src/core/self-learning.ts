/**
 * ALLMA Self-Learning System
 *
 * Two learning modes:
 *
 * A) REACTIVE (after sessions):
 *    extractAndStudy() runs async after every 3rd message
 *    → identifies complex cases from conversation
 *    → generates study notes
 *    → saves to data/knowledge.md
 *
 * B) PROACTIVE (daily research):
 *    dailyResearch() runs once per day at 3:00 AM
 *    → each of 6 specialists studies their domain independently
 *    → generates new clinical knowledge based on recent sessions + domain expertise
 *    → saves to data/knowledge.md
 *
 * Both modes share ONE knowledge file loaded into ALLMA's prompt.
 * Specialists don't talk to patients — they only research and learn.
 * ALLMA (core) is the only agent that talks to patients.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { callLLM } from "./llm.ts";
import { addFact, getRecentSessionTopics } from "./memory.ts";
import { getAgentPrompt, getAgent } from "../agents/registry.ts";

// ============================================================
// Constants
// ============================================================

const isWindows = process.platform === "win32";
const KNOWLEDGE_FILE = isWindows
  ? resolve(process.cwd(), "data", "knowledge.md")
  : resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "data", "knowledge.md");
const KNOWLEDGE_DIR = dirname(KNOWLEDGE_FILE);

const MAX_KNOWLEDGE_FILE_SIZE = 80_000; // 80KB shared — enough for ~800 study notes
const STUDY_COOLDOWN_MS = 30 * 60 * 1000; // 30 min cooldown (shared across all agents)

// Track last study time globally
let lastStudyTime = 0;

// ============================================================
// Knowledge File Management
// ============================================================

/**
 * Load the shared knowledge base (persistent between restarts)
 */
export async function loadKnowledge(): Promise<string> {
  try {
    const content = await readFile(KNOWLEDGE_FILE, "utf-8");
    return content;
  } catch {
    return ""; // No knowledge file yet
  }
}

/**
 * Append new knowledge to the shared knowledge base
 */
async function saveKnowledge(agentId: string, newKnowledge: string): Promise<void> {
  try {
    await mkdir(KNOWLEDGE_DIR, { recursive: true });

    let existing = "";
    try {
      existing = await readFile(KNOWLEDGE_FILE, "utf-8");
    } catch {
      // File doesn't exist — will create
    }

    // Check file size limit
    if (existing.length + newKnowledge.length > MAX_KNOWLEDGE_FILE_SIZE) {
      // Trim oldest entries (keep last 80%)
      const entries = existing.split("\n---\n");
      const keepFrom = Math.floor(entries.length * 0.2);
      existing = entries.slice(keepFrom).join("\n---\n");
      console.log(`[SelfLearn] Trimmed knowledge.md — removed ${keepFrom} oldest entries`);
    }

    const timestamp = new Date().toISOString().split("T")[0];
    const entry = existing
      ? `${existing}\n---\n## ${timestamp} [${agentId}]\n${newKnowledge}`
      : `# ALLMA — Shared Knowledge Base\n\nAccumulated clinical knowledge from all agents' self-study sessions.\nThis knowledge is loaded into every agent's context for continuous improvement.\n\n---\n## ${timestamp} [${agentId}]\n${newKnowledge}`;

    await writeFile(KNOWLEDGE_FILE, entry, "utf-8");
    console.log(`[SelfLearn] Saved to shared knowledge (+${newKnowledge.length} chars, by ${agentId})`);
  } catch (e) {
    console.error(`[SelfLearn] Failed to save knowledge:`, e);
  }
}

// ============================================================
// Core: Analyze Session & Generate Study Material
// ============================================================

/**
 * After a session, analyze what the agent encountered and generate study material.
 * Runs async (fire-and-forget) to not block user experience.
 * Saves to ONE shared knowledge file used by ALL agents.
 *
 * @param agentId - Which agent handled the session
 * @param userId - User ID for saving learning facts
 * @param conversationSummary - Recent messages from the session
 */
export async function extractAndStudy(
  agentId: string,
  userId: string,
  conversationSummary: string
): Promise<void> {
  // Cooldown check — don't study too frequently
  if (Date.now() - lastStudyTime < STUDY_COOLDOWN_MS) {
    return; // Too soon, skip
  }

  try {
    // Step 1: Identify what was discussed and what needs deeper study
    const analysisPrompt = `You are a clinical supervisor reviewing a session transcript. Identify:

1. What clinical topics/conditions were discussed?
2. Were there any areas where the practitioner might need deeper knowledge?
3. Were there unusual presentations, rare conditions, or complex case combinations?
4. What evidence-based approaches could strengthen the practitioner's response?

SESSION (agent: ${agentId}):
${conversationSummary.slice(0, 3000)}

OUTPUT FORMAT:
- If nothing unusual or complex, output exactly: ROUTINE
- If study material is needed, output in this format:
TOPICS: [comma-separated list of topics to study]
GAPS: [what knowledge gaps were observed]
PRIORITY: [high/medium/low]

Be strict — most sessions are routine. Only flag genuinely complex, novel, or specialized clinical material that would benefit from deeper study.`;

    const analysis = await callLLM(
      [{ role: "system", content: analysisPrompt }],
      "fast"
    );

    const analysisText = analysis.content.trim();

    if (analysisText === "ROUTINE" || !analysisText.includes("TOPICS:")) {
      console.log(`[SelfLearn] ${agentId}: Routine session, no study needed`);
      return;
    }

    // Parse topics
    const topicsMatch = analysisText.match(/TOPICS:\s*(.+)/i);
    const gapsMatch = analysisText.match(/GAPS:\s*(.+)/i);
    const priorityMatch = analysisText.match(/PRIORITY:\s*(\w+)/i);

    if (!topicsMatch) return;

    const topics = topicsMatch[1].trim();
    const gaps = gapsMatch?.[1]?.trim() || "";
    const priority = priorityMatch?.[1]?.toLowerCase() || "medium";

    console.log(`[SelfLearn] ${agentId}: Studying — ${topics} (priority: ${priority})`);

    // Step 2: Check if we already have knowledge on this topic
    const existingKnowledge = await loadKnowledge();
    const topicWords = topics.toLowerCase().split(/[,\s]+/).filter(w => w.length > 3);
    const alreadyStudied = topicWords.some(word =>
      existingKnowledge.toLowerCase().includes(word)
    );

    if (alreadyStudied && priority !== "high") {
      console.log(`[SelfLearn] ${agentId}: Topic already in knowledge base, skipping (use priority: high to force)`);
      return;
    }

    // Step 3: Generate deep clinical knowledge
    const studyPrompt = `You are a doctoral-level clinical researcher. Generate a STUDY NOTE on the following topics for a team of specialist coaches (psychology, relationships, career, fitness, mindfulness, habits, shadow work).

TOPICS TO STUDY: ${topics}
${gaps ? `KNOWLEDGE GAPS TO ADDRESS: ${gaps}` : ""}
STUDIED BY: Agent ${agentId} (after encountering these topics in a session)

REQUIREMENTS:
- Write as concise clinical notes (not an essay)
- Include: key concepts, evidence-based interventions, clinical techniques
- Reference specific researchers, studies, or frameworks
- Focus on ACTIONABLE knowledge any coach specialist could use
- Include 2-3 specific questions/techniques
- Maximum 400 words — dense and practical
- Write in English (for consistency across all agents)

FORMAT:
### [Topic Name]
**Key insight**: [one sentence]
**Evidence**: [researcher/framework]
**Approach**: [what to do clinically]
**Techniques**: [specific questions/interventions]
**Watch for**: [red flags or complications]`;

    const studyResult = await callLLM(
      [{ role: "system", content: studyPrompt }],
      "balanced" // Use better model for study generation
    );

    const studyNotes = studyResult.content.trim();

    if (studyNotes.length < 50) {
      console.log(`[SelfLearn] ${agentId}: Study result too short, skipping`);
      return;
    }

    // Step 4: Save to shared knowledge file
    await saveKnowledge(agentId, studyNotes);

    // Step 5: Also save a fact to user's memory for searchability
    await addFact(
      userId,
      "learning",
      `Team studied: ${topics}. Triggered by ${agentId} session. Knowledge saved to shared base.`,
      agentId
    );

    // Update cooldown
    lastStudyTime = Date.now();

    console.log(`[SelfLearn] ${agentId}: Study complete — ${studyNotes.length} chars saved to shared knowledge`);
  } catch (e) {
    console.error(`[SelfLearn] Study failed for ${agentId}:`, e);
  }
}

// ============================================================
// Proactive Daily Research — Specialists Study Independently
// ============================================================

const RESEARCH_SPECIALISTS = ["relations", "career", "body", "mindfulness", "habits", "shadow"];

/**
 * Proactive Daily Research — each specialist studies their domain.
 * Runs once daily (scheduled from telegram.ts at 3:00 AM).
 * Each specialist generates new knowledge based on:
 *   - Their domain expertise (from prompt file)
 *   - Recent patient session topics
 *   - What's already in the knowledge base (to avoid duplicates)
 *
 * Patients never talk to specialists — specialists only research.
 * ALLMA Core uses their knowledge in sessions.
 */
export async function dailyResearch(): Promise<void> {
  const existingKnowledge = await loadKnowledge();

  console.log(`[Research] 🔬 Starting daily research (${RESEARCH_SPECIALISTS.length} specialists)...`);

  let successCount = 0;

  for (const specId of RESEARCH_SPECIALISTS) {
    try {
      const studied = await researchForSpecialist(specId, existingKnowledge);
      if (studied) successCount++;
      // Rate limiting — 5s delay between specialists
      await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
      console.error(`[Research] ${specId} failed:`, e);
    }
  }

  console.log(`[Research] ✅ Daily research complete — ${successCount}/${RESEARCH_SPECIALISTS.length} specialists generated new knowledge`);
}

/**
 * Single specialist's research session.
 * The specialist "reads" their domain prompt, looks at recent patient topics,
 * and generates a study note on something new and relevant.
 */
async function researchForSpecialist(specId: string, existingKnowledge: string): Promise<boolean> {
  const agent = getAgent(specId);
  const agentPromptText = await getAgentPrompt(specId);

  // Get recent session topics for context
  let sessionContext = "";
  try {
    sessionContext = await getRecentSessionTopics(20);
  } catch {
    sessionContext = "No recent session data available.";
  }

  // Extract what this specialist already studied (to avoid duplicates)
  const specEntries = existingKnowledge
    .split("\n---\n")
    .filter(e => e.includes(`[${specId}]`))
    .slice(-3) // Last 3 entries from this specialist
    .join("\n")
    .slice(0, 1000);

  // Step 1: LLM picks a topic to study
  const topicPrompt = `You are ${agent.emoji} ${agent.name}, a researcher on the ALLMA coaching team.
Your expertise: ${agent.description}

RECENT PATIENT TOPICS (what patients discussed recently):
${sessionContext || "No recent sessions."}

YOUR RECENT STUDY NOTES (avoid repeating these):
${specEntries || "None yet — this is your first research session."}

TASK: Choose ONE specific clinical topic to research that:
1. Is relevant to your specialty (${agent.description})
2. Relates to what patients have been discussing (if available)
3. Is NOT already covered in your recent study notes
4. Would make ALLMA a better coach for patients
5. Is specific — not broad (e.g., "schema therapy for abandonment wound" not "schema therapy")

Output ONLY the topic name (5-15 words). Nothing else.
If you truly cannot find anything new, output: SKIP`;

  const topicResult = await callLLM(
    [{ role: "system", content: topicPrompt }],
    "fast"
  );

  const topic = topicResult.content.trim();

  if (topic === "SKIP" || topic.length < 5 || topic.length > 200) {
    console.log(`[Research] ${agent.emoji} ${specId}: No new topic to study`);
    return false;
  }

  console.log(`[Research] ${agent.emoji} ${specId}: Studying — "${topic}"`);

  // Step 2: Deep study on the chosen topic
  const studyPrompt = `You are ${agent.emoji} ${agent.name}, a doctoral-level clinical researcher.
Your full expertise: ${agent.description}

RESEARCH TOPIC: ${topic}

Generate a comprehensive STUDY NOTE for the ALLMA coaching team.
This knowledge will be used by ALLMA (the main coach) when talking to patients.

REQUIREMENTS:
- Write as concise clinical notes (not an essay)
- Include: key concepts, evidence-based interventions, clinical techniques
- Reference specific researchers, studies, or frameworks by name
- Focus on ACTIONABLE knowledge — what questions to ask, what to notice, how to respond
- Include 2-3 specific therapeutic questions or interventions
- Maximum 400 words — dense and practical
- Write in English (for consistency)

FORMAT:
### ${topic}
**Key insight**: [one powerful sentence]
**Evidence**: [researcher/framework/study with dates if known]
**Clinical approach**: [step-by-step how to work with this]
**Techniques**:
- [specific question or intervention 1]
- [specific question or intervention 2]
- [specific question or intervention 3]
**Watch for**: [red flags, contraindications, or common mistakes]`;

  const studyResult = await callLLM(
    [{ role: "system", content: studyPrompt }],
    "balanced"
  );

  const studyNotes = studyResult.content.trim();

  if (studyNotes.length < 100) {
    console.log(`[Research] ${agent.emoji} ${specId}: Study notes too short (${studyNotes.length} chars), skipping`);
    return false;
  }

  // Save to shared knowledge
  await saveKnowledge(specId, studyNotes);

  console.log(`[Research] ${agent.emoji} ${specId}: ✅ Study complete — "${topic}" (${studyNotes.length} chars)`);
  return true;
}

// ============================================================
// Get Knowledge Context for Agent Prompt
// ============================================================

/**
 * Load and format shared knowledge for injection into ANY agent's system prompt.
 * Returns a markdown section appended to the agent's prompt.
 * All agents share the same knowledge — one team, one brain.
 */
export async function getKnowledgeContext(agentId: string, maxChars = 2000): Promise<string> {
  const knowledge = await loadKnowledge();
  if (!knowledge || knowledge.length < 50) return "";

  // Take the most recent entries (they're at the end of the file)
  let trimmed = knowledge;
  if (trimmed.length > maxChars) {
    // Take last N chars (most recent studies)
    trimmed = "..." + trimmed.slice(-maxChars);
  }

  return `\n\n## TEAM KNOWLEDGE BASE (shared study notes from all agents)\nUse these insights when relevant — they represent areas the team has studied in depth after encountering them in sessions:\n\n${trimmed}`;
}
