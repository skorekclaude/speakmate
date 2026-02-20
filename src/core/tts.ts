/**
 * SpeakMate TTS — edge-tts-universal wrapper
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
    const { EdgeTTS } = await import("edge-tts-universal");
    const tts = new EdgeTTS(cleanText, voice);
    const result = await tts.synthesize();

    // result.audio is a Blob — convert to Buffer
    const arrayBuffer = await result.audio.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error("Generated audio is empty");
    }

    console.log(`[TTS] Generated ${buffer.length} bytes for agent ${agentId}`);
    return buffer;
  } catch (err) {
    console.error(`[TTS] Error generating speech: ${err}`);

    // Fallback: try Communicate streaming API
    try {
      console.log("[TTS] Trying streaming fallback...");
      const { Communicate } = await import("edge-tts-universal");
      const comm = new Communicate(cleanText, { voice });
      const chunks: Buffer[] = [];

      for await (const chunk of comm.stream()) {
        if (chunk.type === "audio" && chunk.data) {
          chunks.push(Buffer.from(chunk.data));
        }
      }

      const buffer = Buffer.concat(chunks);
      console.log(`[TTS] Streaming generated ${buffer.length} bytes`);
      return buffer;
    } catch (err2) {
      console.error(`[TTS] Streaming fallback also failed: ${err2}`);
      throw err2;
    }
  }
}

export const voiceMap = VOICE_MAP;
