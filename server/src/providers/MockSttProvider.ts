import type { SttProvider, TranscriptEvent, TranscriptListener } from "./SttProvider.js";
import { DEFAULT_SCRIPT, type ScriptedEvent } from "./script.js";

export interface MockSttProviderOptions {
  /** ms between scheduler ticks. Production demo uses a human-visible delay; tests pass a
   *  tiny value (e.g. 2ms) so the whole script plays out in milliseconds. */
  tickIntervalMs?: number;
  /** override the canned script - mainly a test seam. */
  script?: ScriptedEvent[];
}

const DEFAULT_TICK_INTERVAL_MS = 250;

/**
 * Deterministically "transcribes" audio by replaying a canned script of partial/final events
 * on a timer, regardless of what bytes it actually receives. This is the provider used by
 * default, by every automated test, and by CI - it needs no network access and no API key,
 * which is what makes the rest of this repo runnable by anyone who clones it.
 *
 * It still exercises the real contract: sendAudioChunk() is called with real audio bytes from
 * the browser, so this class is also a convenient place to assert the gateway is actually
 * forwarding audio (see test/mockProvider.test.ts).
 */
export class MockSttProvider implements SttProvider {
  private readonly script: ScriptedEvent[];
  private readonly tickIntervalMs: number;
  private listeners: TranscriptListener[] = [];
  private timer: NodeJS.Timeout | null = null;
  private scriptIndex = 0;
  private ticksUntilNext = 0;
  private sequence = 0;
  private chunksReceived = 0;

  constructor(options: MockSttProviderOptions = {}) {
    this.script = options.script ?? DEFAULT_SCRIPT;
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.ticksUntilNext = this.script[0]?.afterTicks ?? 0;
  }

  /** Number of audio chunks handed to sendAudioChunk so far (test/demo hook). */
  get receivedChunkCount(): number {
    return this.chunksReceived;
  }

  async connect(): Promise<void> {
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  sendAudioChunk(chunk: Buffer): void {
    // A real provider would forward these bytes to the STT backend here. The mock only
    // counts them, since its output is scripted rather than derived from the audio.
    this.chunksReceived += 1;
    void chunk;
  }

  onTranscript(listener: TranscriptListener): void {
    this.listeners.push(listener);
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.scriptIndex >= this.script.length) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }

    this.ticksUntilNext -= 1;
    if (this.ticksUntilNext > 0) return;

    const scripted = this.script[this.scriptIndex];
    if (!scripted) return;
    this.scriptIndex += 1;
    this.ticksUntilNext = this.script[this.scriptIndex]?.afterTicks ?? 0;

    this.sequence += 1;
    const event: TranscriptEvent = { kind: scripted.kind, text: scripted.text, sequence: this.sequence };
    for (const listener of this.listeners) listener(event);
  }
}
