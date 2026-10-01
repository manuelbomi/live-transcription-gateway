export type TranscriptKind = "partial" | "final";

export interface TranscriptEvent {
  kind: TranscriptKind;
  text: string;
  /** Per-session, strictly increasing sequence number. Lets a client discard a partial
   *  that arrives after a later one (or after the final it was superseded by). */
  sequence: number;
}

export type TranscriptListener = (event: TranscriptEvent) => void;

/**
 * Everything the gateway needs from a speech-to-text backend, and nothing more.
 *
 * The gateway (see session.ts) only ever talks to this interface. That single seam is what
 * lets the whole repo build, run, and test end to end without a paid API key: swap
 * `MockSttProvider` for `DeepgramProvider` (or any other implementation) and nothing else in
 * the gateway changes. In production you select the provider with an environment variable
 * (see server/src/gateway.ts); in tests you inject MockSttProvider directly.
 */
export interface SttProvider {
  /** Open whatever connection/session the backend needs. Resolves once ready to accept audio. */
  connect(): Promise<void>;
  /** Push one chunk of raw audio bytes captured from the browser (see README for the expected format). */
  sendAudioChunk(chunk: Buffer): void;
  /** Register a callback invoked for every partial/final transcript event. May be called multiple times. */
  onTranscript(listener: TranscriptListener): void;
  /** Tear down the connection/session. Must be safe to call more than once. */
  close(): Promise<void>;
}
