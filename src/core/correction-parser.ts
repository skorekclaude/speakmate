/**
 * SpeakMate Correction Parser
 *
 * Parses structured LLM output into response + corrections + vocabulary.
 *
 * Handles multiple formats (LLMs don't always follow instructions):
 *
 * Format A (tagged):
 *   [RESPONSE]...[/RESPONSE]
 *   [CORRECTION]{"original":"...", ...}[/CORRECTION]
 *   [VOCAB]{"word":"...", ...}[/VOCAB]
 *
 * Format B (loose — no proper tags, inline JSON, RESPONSE: prefix)
 */

import type { ParsedResponse, Correction, VocabSuggestion } from "../agents/types.ts";

export function parseLLMResponse(raw: string): ParsedResponse {
  const result: ParsedResponse = {
    response: "",
    corrections: [],
    vocabulary: [],
  };

  // ── Extract [RESPONSE] block ──────────────────────────
  const responseMatch = raw.match(/\[RESPONSE\]([\s\S]*?)\[\/RESPONSE\]/);
  if (responseMatch) {
    result.response = responseMatch[1].trim();
  } else {
    // Fallback: strip all known tags/markers and use what remains
    result.response = raw
      .replace(/\[CORRECTION\][\s\S]*?(\[\/CORRECTION\]|$)/g, "")
      .replace(/\[VOCAB\][\s\S]*?(\[\/VOCAB\]|$)/g, "")
      .replace(/\[RESPONSE\][\s\S]*?(\[\/RESPONSE\]|$)/g, "")
      // Strip "RESPONSE:" anywhere (LLMs sometimes put it mid-text)
      .replace(/RESPONSE:\s*/gi, "")
      // Strip inline JSON that looks like vocab/correction data
      .replace(/\{"word"\s*:[\s\S]*?\}/g, "")
      .replace(/\{"original"\s*:[\s\S]*?\}/g, "")
      .trim();
  }

  // ── Extract [CORRECTION] blocks ───────────────────────
  const correctionRegex = /\[CORRECTION\]([\s\S]*?)\[\/CORRECTION\]/g;
  let corrMatch;
  while ((corrMatch = correctionRegex.exec(raw)) !== null) {
    const block = corrMatch[1].trim();

    // Skip "no errors" messages
    if (/^brak\s+b[łl]/i.test(block) || /^no\s+(errors|mistakes)/i.test(block)) {
      continue;
    }

    // Try JSON format: {"original":"...","corrected":"...","explanation":"..."}
    const corrJson = tryParseJSON(block);
    if (corrJson && corrJson.original && (corrJson.corrected || corrJson.correction)) {
      result.corrections.push({
        original: corrJson.original,
        corrected: corrJson.corrected || corrJson.correction || "",
        rule: corrJson.explanation || corrJson.rule || "",
      });
      continue;
    }

    // Try extracting JSON from within the block
    const jsonInBlock = block.match(/\{[\s\S]*?"original"\s*:[\s\S]*?\}/);
    if (jsonInBlock) {
      const parsed = tryParseJSON(jsonInBlock[0]);
      if (parsed && parsed.original) {
        result.corrections.push({
          original: parsed.original,
          corrected: parsed.corrected || parsed.correction || "",
          rule: parsed.explanation || parsed.rule || "",
        });
        continue;
      }
    }

    // Fallback: line-based (Original: ... / Corrected: ... / Rule: ...)
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    let original = "";
    let corrected = "";
    let rule = "";

    for (const line of lines) {
      if (/^original:/i.test(line)) {
        original = line.replace(/^original:\s*/i, "").replace(/^["']|["']$/g, "").trim();
      } else if (/^correct(ed|ion):/i.test(line)) {
        corrected = line.replace(/^correct(?:ed|ion):\s*/i, "").replace(/^["']|["']$/g, "").trim();
      } else if (/^(rule|explanation):/i.test(line)) {
        rule = line.replace(/^(?:rule|explanation):\s*/i, "").trim();
      }
    }

    if (original && corrected) {
      result.corrections.push({ original, corrected, rule });
    }
  }

  // ── Extract [VOCAB] blocks ────────────────────────────
  const vocabRegex = /\[VOCAB\]([\s\S]*?)\[\/VOCAB\]/g;
  let vocabMatch;
  while ((vocabMatch = vocabRegex.exec(raw)) !== null) {
    const block = vocabMatch[1].trim();

    // Try JSON format: {"word":"...","translation":"...","example":"..."}
    const vocabJson = tryParseJSON(block);
    if (vocabJson && vocabJson.word) {
      result.vocabulary.push({
        word: vocabJson.word,
        alternatives: vocabJson.translation || vocabJson.meaning || vocabJson.alternatives || "",
        example: vocabJson.example || "",
      });
      continue;
    }

    // Try extracting JSON from within the block
    const jsonInBlock = block.match(/\{[\s\S]*?"word"\s*:[\s\S]*?\}/);
    if (jsonInBlock) {
      const parsed = tryParseJSON(jsonInBlock[0]);
      if (parsed && parsed.word) {
        result.vocabulary.push({
          word: parsed.word,
          alternatives: parsed.translation || parsed.meaning || parsed.alternatives || "",
          example: parsed.example || "",
        });
        continue;
      }
    }

    // Fallback: arrow format ("word → translation")
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // Match arrow separators but NOT hyphens inside words (e.g. "Bem-vindo")
      const arrowMatch = line.match(/["']?(.+?)["']?\s*[→⟶]\s*["']?(.+?)["']?$/);
      if (arrowMatch) {
        result.vocabulary.push({
          word: arrowMatch[1].trim().replace(/^["']|["']$/g, ""),
          alternatives: arrowMatch[2].trim().replace(/^["']|["']$/g, ""),
        });
      }
    }
  }

  // ── Catch loose inline JSON (outside tags) ────────────
  // Some LLMs drop tags and dump raw JSON in the response

  if (result.vocabulary.length === 0) {
    const looseVocab = [...raw.matchAll(/\{"word"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,[\s\S]*?\}/g)];
    for (const m of looseVocab) {
      const parsed = tryParseJSON(m[0]);
      if (parsed && parsed.word) {
        result.vocabulary.push({
          word: parsed.word,
          alternatives: parsed.translation || parsed.meaning || "",
          example: parsed.example || "",
        });
      }
    }
    // Clean response from loose vocab JSON
    if (result.vocabulary.length > 0 && !responseMatch) {
      result.response = result.response
        .replace(/\{"word"\s*:[\s\S]*?\}/g, "")
        .trim();
    }
  }

  return result;
}

/** Safe JSON.parse that returns null on failure */
function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Accumulate streaming chunks and try to parse once complete.
 * Returns null if stream is still incomplete.
 */
export function tryParseStreaming(accumulated: string): ParsedResponse | null {
  const hasResponse = accumulated.includes("[/RESPONSE]") || !accumulated.includes("[RESPONSE]");

  if (hasResponse) {
    return parseLLMResponse(accumulated);
  }
  return null;
}
