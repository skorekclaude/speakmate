/**
 * SpeakMate Correction Parser
 *
 * Parses structured LLM output into response + corrections + vocabulary.
 * Expected format from agent:
 *   [RESPONSE]...[/RESPONSE]
 *   [CORRECTION]...[/CORRECTION]
 *   [VOCAB]...[/VOCAB]
 */

import type { ParsedResponse, Correction, VocabSuggestion } from "../agents/types.ts";

export function parseLLMResponse(raw: string): ParsedResponse {
  const result: ParsedResponse = {
    response: "",
    corrections: [],
    vocabulary: [],
  };

  // Extract [RESPONSE] block
  const responseMatch = raw.match(/\[RESPONSE\]([\s\S]*?)\[\/RESPONSE\]/);
  if (responseMatch) {
    result.response = responseMatch[1].trim();
  } else {
    // If no tags, treat entire output as response (graceful fallback)
    result.response = raw
      .replace(/\[CORRECTION\][\s\S]*?\[\/CORRECTION\]/g, "")
      .replace(/\[VOCAB\][\s\S]*?\[\/VOCAB\]/g, "")
      .trim();
  }

  // Extract [CORRECTION] blocks (can be multiple)
  const correctionRegex = /\[CORRECTION\]([\s\S]*?)\[\/CORRECTION\]/g;
  let corrMatch;
  while ((corrMatch = correctionRegex.exec(raw)) !== null) {
    const block = corrMatch[1].trim();
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    let original = "";
    let corrected = "";
    let rule = "";

    for (const line of lines) {
      if (line.toLowerCase().startsWith("original:")) {
        original = line.replace(/^original:\s*/i, "").replace(/^["']|["']$/g, "").trim();
      } else if (line.toLowerCase().startsWith("corrected:")) {
        corrected = line.replace(/^corrected:\s*/i, "").replace(/^["']|["']$/g, "").trim();
      } else if (line.toLowerCase().startsWith("rule:")) {
        rule = line.replace(/^rule:\s*/i, "").trim();
      }
    }

    if (original && corrected) {
      result.corrections.push({ original, corrected, rule });
    }
  }

  // Extract [VOCAB] blocks
  const vocabRegex = /\[VOCAB\]([\s\S]*?)\[\/VOCAB\]/g;
  let vocabMatch;
  while ((vocabMatch = vocabRegex.exec(raw)) !== null) {
    const block = vocabMatch[1].trim();
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      // Format: "word" → "alternatives"
      const arrowMatch = line.match(/["']?(.+?)["']?\s*[→\->]+\s*["']?(.+?)["']?$/);
      if (arrowMatch) {
        result.vocabulary.push({
          word: arrowMatch[1].trim().replace(/^["']|["']$/g, ""),
          alternatives: arrowMatch[2].trim().replace(/^["']|["']$/g, ""),
        });
      }
    }
  }

  return result;
}

/**
 * Accumulate streaming chunks and try to parse once complete.
 * Returns null if stream is still incomplete.
 */
export function tryParseStreaming(accumulated: string): ParsedResponse | null {
  // Check if we have a complete response (all tags closed)
  const hasResponse = accumulated.includes("[/RESPONSE]") || !accumulated.includes("[RESPONSE]");
  
  if (hasResponse) {
    return parseLLMResponse(accumulated);
  }
  return null;
}
