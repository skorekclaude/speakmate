/**
 * SpeakMate TTS — edge-tts wrapper
 *
 * Uses edge-tts-universal for free Microsoft TTS.
 * Each agent has a mapped voice.
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

export function getVoiceForAgent(agentId: string): string {
  return VOICE_MAP[agentId] || DEFAULT_VOICE;
}

/**
 * Generate speech audio buffer from text using edge-tts.
 * Returns MP3 audio as Buffer.
 */
export async function generateSpeech(
  text: string,
  agentId: string
): Promise<Buffer> {
  const voice = getVoiceForAgent(agentId);

  try {
    // Dynamic import for edge-tts-universal
    const { EdgeTTS } = await import("edge-tts-universal");
    const tts = new EdgeTTS();
    await tts.setMetadata(voice, "audio-24khz-96kbitrate-mono-mp3");

    const readable = tts.toStream(text);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      readable.on("data", (chunk: Buffer) => {
        // edge-tts-universal emits objects with { type, data }
        if (chunk && (chunk as any).type === "audio") {
          chunks.push(Buffer.from((chunk as any).data));
        } else if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        }
      });
      readable.on("end", () => resolve(Buffer.concat(chunks)));
      readable.on("error", reject);
    });
  } catch (err) {
    console.error(`[TTS] Error generating speech: ${err}`);
    throw err;
  }
}

export const voiceMap = VOICE_MAP;
