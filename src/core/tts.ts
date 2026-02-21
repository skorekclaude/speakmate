/**
 * SpeakMate TTS — edge-tts-universal wrapper
 *
 * Uses edge-tts-universal for free Microsoft TTS.
 * Each agent has a mapped voice.
 * Includes timeout protection to prevent hanging requests.
 */

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

/** Wrap a promise with a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
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

  // Try Communicate streaming API first (more reliable with Bun)
  try {
    const { Communicate } = await import("edge-tts-universal");
    const comm = new Communicate(cleanText, { voice, connectionTimeout: 10_000 });
    const chunks: Buffer[] = [];

    const streamPromise = (async () => {
      for await (const chunk of comm.stream()) {
        if (chunk.type === "audio" && chunk.data) {
          chunks.push(Buffer.from(chunk.data));
        }
      }
      return Buffer.concat(chunks);
    })();

    const buffer = await withTimeout(streamPromise, TTS_TIMEOUT_MS, "TTS Communicate");

    if (buffer.length === 0) {
      throw new Error("Generated audio is empty");
    }

    console.log(`[TTS] Generated ${buffer.length} bytes for agent ${agentId} (${voice})`);
    return buffer;
  } catch (err: any) {
    console.error(`[TTS] Communicate failed: ${err.message}`);
  }

  // Fallback: try EdgeTTS simple API
  try {
    console.log("[TTS] Trying EdgeTTS fallback...");
    const { EdgeTTS } = await import("edge-tts-universal");
    const tts = new EdgeTTS(cleanText, voice);

    const result = await withTimeout(tts.synthesize(), TTS_TIMEOUT_MS, "TTS EdgeTTS");
    const arrayBuffer = await result.audio.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error("Generated audio is empty");
    }

    console.log(`[TTS] EdgeTTS generated ${buffer.length} bytes for agent ${agentId}`);
    return buffer;
  } catch (err2: any) {
    console.error(`[TTS] EdgeTTS fallback also failed: ${err2.message}`);
    throw new Error(`TTS unavailable: ${err2.message}`);
  }
}

export const voiceMap = VOICE_MAP;
