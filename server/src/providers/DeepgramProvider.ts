import WebSocket from "ws";
import type { SttProvider, TranscriptEvent, TranscriptListener } from "./SttProvider.js";

export interface DeepgramProviderOptions {
  /** defaults to process.env.DEEPGRAM_API_KEY */
  apiKey?: string;
  /** sample rate of the PCM audio being streamed; must match the browser's capture settings */
  sampleRate?: number;
  /** Deepgram encoding name - "linear16" for raw PCM16, see README for other options */
  encoding?: string;
}

const DEEPGRAM_LIVE_URL = "wss://api.deepgram.com/v1/listen";

/**
 * Real streaming STT backend, talking to Deepgram's live transcription WebSocket API
 * (https://developers.deepgram.com/docs/live-streaming-audio). This is the "real" half of the
 * provider abstraction described in SttProvider.ts: everything else in the gateway is
 * identical whether a session uses this or MockSttProvider.
 *
 * Gated behind DEEPGRAM_API_KEY on purpose - construction throws if it's missing, so a
 * misconfigured deployment fails loudly at session start rather than silently falling back to
 * anything. Select it by setting STT_PROVIDER=deepgram (see server/src/gateway.ts).
 */
export class DeepgramProvider implements SttProvider {
  private readonly apiKey: string;
  private readonly sampleRate: number;
  private readonly encoding: string;
  private socket: WebSocket | null = null;
  private listeners: TranscriptListener[] = [];
  private sequence = 0;

  constructor(options: DeepgramProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DeepgramProvider requires DEEPGRAM_API_KEY to be set (server/.env). " +
          "See README > 'Using a real STT provider'."
      );
    }
    this.apiKey = apiKey;
    this.sampleRate = options.sampleRate ?? 16000;
    this.encoding = options.encoding ?? "linear16";
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${DEEPGRAM_LIVE_URL}?encoding=${this.encoding}&sample_rate=${this.sampleRate}&interim_results=true&punctuate=true`;
      const socket = new WebSocket(url, {
        headers: { Authorization: `Token ${this.apiKey}` },
      });
      this.socket = socket;

      const onOpen = () => {
        socket.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        socket.off("open", onOpen);
        reject(err);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);

      socket.on("message", (data) => this.handleMessage(data.toString()));
    });
  }

  sendAudioChunk(chunk: Buffer): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
    }
  }

  onTranscript(listener: TranscriptListener): void {
    this.listeners.push(listener);
  }

  async close(): Promise<void> {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    if (socket.readyState === WebSocket.OPEN) {
      // Tells Deepgram no more audio is coming so it flushes a final transcript before closing.
      socket.send(JSON.stringify({ type: "CloseStream" }));
    }
    socket.close();
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Deepgram sends occasional non-JSON keepalive frames - safe to ignore.
      return;
    }

    const result = parsed as {
      is_final?: boolean;
      channel?: { alternatives?: Array<{ transcript?: string }> };
    };
    const transcript = result.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    this.sequence += 1;
    const event: TranscriptEvent = {
      kind: result.is_final ? "final" : "partial",
      text: transcript,
      sequence: this.sequence,
    };
    for (const listener of this.listeners) listener(event);
  }
}
