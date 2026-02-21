/**
 * SpeakMate TTS — Python edge-tts subprocess
 *
 * Uses `python -m edge_tts` CLI via subprocess for reliable TTS.
 * edge-tts-universal (JS) hangs in Bun on Windows due to WebSocket issues.
 * Python edge-tts works flawlessly with the same Microsoft voices.
 *
 * Each agent has a mapped voice.
 */

import { spawn } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// Voice map: agentId → edge-tts voice
const VOICE_MAP: Record<string, string> = {
  general: "en-US-GuyNeural",
  youth: "en-US-JennyNeural",
  chemist: "en-US-AriaNeural",
  dating: "en-GB-RyanNeural",
  artist: "en-GB-SoniaNeural",
  brasileiro: "pt-BR-AntonioNeural",
};

const DEFAULT_VOICE = "en-US-GuyNeural";
const TTS_TIMEOUT_MS = 15_000; // 15 seconds max per TTS request

export function getVoiceForAgent(agentId: string): string {
  return VOICE_MAP[agentId] || DEFAULT_VOICE;
}

/**
 * Generate speech via Python edge-tts subprocess.
 * Streams audio data through stdout pipe (no temp files).
 */
async function generateViaPython(text: string, voice: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("TTS timed out after 15s"));
    }, TTS_TIMEOUT_MS);

    // Use Python inline script to stream audio bytes to stdout
    const script = `
import asyncio, sys, edge_tts

async def main():
    communicate = edge_tts.Communicate(sys.argv[1], sys.argv[2])
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
    sys.stdout.buffer.flush()

asyncio.run(main())
`;

    const proc = spawn("python", ["-c", script, text, voice], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let stderrData = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`edge-tts exited with code ${code}: ${stderrData.trim()}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        reject(new Error("edge-tts returned empty audio"));
        return;
      }
      resolve(buffer);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn python: ${err.message}`));
    });
  });
}

/**
 * Generate speech audio from text using edge-tts.
 * Returns MP3 audio as Buffer.
 */
export async function generateSpeech(
  text: string,
  agentId: string
): Promise<Buffer> {
  const voice = getVoiceForAgent(agentId);

  // Clean text for TTS — remove markdown, emojis that cause issues
  const cleanText = text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,3}\s/g, "")
    .replace(/\[.*?\]/g, "")
    .trim();

  if (!cleanText) {
    throw new Error("No text to synthesize");
  }

  try {
    const buffer = await generateViaPython(cleanText, voice);
    console.log(`[TTS] Generated ${buffer.length} bytes for ${agentId} (${voice})`);
    return buffer;
  } catch (err: any) {
    console.error(`[TTS] Failed: ${err.message}`);
    throw err;
  }
}

export const voiceMap = VOICE_MAP;
