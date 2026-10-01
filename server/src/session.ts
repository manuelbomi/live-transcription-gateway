import { randomUUID } from "node:crypto";
import type { SttProvider } from "./providers/SttProvider.js";
import type { ClientMessage, ServerMessage } from "./types.js";

/**
 * The narrow slice of the `ws` WebSocket API Session actually needs. Depending on this
 * instead of the concrete `ws` type means tests can drive a Session with a plain in-memory
 * fake instead of opening a real socket.
 */
export interface GatewaySocket {
  readonly OPEN: number;
  readyState: number;
  bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer, isBinary: boolean) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export interface SessionOptions {
  socket: GatewaySocket;
  createProvider: () => SttProvider;
  /** ms to wait for the client's initial "start" message before closing the socket */
  handshakeTimeoutMs?: number;
  /** ms of silence (no audio chunk, no control message) before the session is closed */
  idleTimeoutMs?: number;
  /** outbound messages queued before the oldest pending partial transcript is dropped */
  maxOutboundQueueLength?: number;
  /** ws.bufferedAmount (bytes) above which sends pause until the socket drains */
  highWaterMarkBytes?: number;
  /** ms between drain retries while the socket is backed up */
  drainRetryMs?: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_QUEUE_LENGTH = 50;
const DEFAULT_HIGH_WATER_MARK_BYTES = 1_000_000;
const DEFAULT_DRAIN_RETRY_MS = 50;

/**
 * One browser connection's full lifecycle: handshake, idle timeout, audio forwarding,
 * backpressure-aware transcript relay, and clean shutdown.
 *
 * Lifecycle:
 *   1. Client connects; a handshake timer starts (closes the socket if "start" never arrives).
 *   2. Client sends {"type":"start"} -> an STT provider is created and connected, the
 *      handshake timer is cancelled, an idle timer starts, and a {"type":"ready"} reply is sent.
 *   3. Binary frames after that point are audio chunks and are forwarded to the provider,
 *      resetting the idle timer each time.
 *   4. Provider transcript events are queued for delivery back to the client (see
 *      "Backpressure" below) as {"type":"transcript"} messages.
 *   5. The session ends on {"type":"stop"}, socket close/error, or either timer firing; the
 *      provider is always closed before the socket is.
 *
 * Backpressure:
 * Outbound messages go through a bounded queue instead of straight to `socket.send`. If the
 * browser's network can't keep up, `ws.bufferedAmount` grows; once it crosses
 * `highWaterMarkBytes` we stop sending and let the queue absorb new events. If the queue itself
 * grows past `maxOutboundQueueLength` we drop the oldest *partial* transcript still queued
 * (never a final, and never a control message) - a stale partial is worthless once a newer one
 * (or the final) exists, whereas dropping a final would permanently lose a sentence of real
 * content. A short retry timer keeps flushing the queue as the socket drains.
 */
export class Session {
  readonly id = randomUUID();
  private provider: SttProvider | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private drainTimer: NodeJS.Timeout | null = null;
  private outboundQueue: ServerMessage[] = [];
  private closed = false;
  private droppedPartialCount = 0;

  constructor(private readonly options: SessionOptions) {
    const { socket } = options;
    socket.on("message", (data, isBinary) => void this.handleMessage(data, isBinary));
    socket.on("close", () => void this.close("client-closed"));
    socket.on("error", () => void this.close("socket-error"));
    this.armHandshakeTimeout();
  }

  /** Partial transcripts dropped so far under backpressure (test/metrics hook). */
  get droppedPartials(): number {
    return this.droppedPartialCount;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private armHandshakeTimeout(): void {
    const ms = this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.handshakeTimer = setTimeout(() => void this.close("handshake-timeout"), ms);
  }

  private armIdleTimeout(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const ms = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.idleTimer = setTimeout(() => void this.close("idle-timeout"), ms);
  }

  private async handleMessage(data: Buffer, isBinary: boolean): Promise<void> {
    if (this.closed) return;

    if (isBinary) {
      if (!this.provider) {
        this.enqueue({ type: "error", message: "received audio before handshake completed" });
        return;
      }
      this.armIdleTimeout();
      this.provider.sendAudioChunk(data);
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      this.enqueue({ type: "error", message: "malformed control message" });
      return;
    }

    if (message.type === "start") {
      await this.handleStart();
    } else if (message.type === "stop") {
      await this.close("client-stop");
    }
  }

  private async handleStart(): Promise<void> {
    if (this.provider) return; // duplicate "start" - ignore, session already running
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }

    const provider = this.options.createProvider();
    this.provider = provider;
    provider.onTranscript((event) => {
      this.enqueue({ type: "transcript", kind: event.kind, text: event.text, sequence: event.sequence });
    });

    await provider.connect();
    this.armIdleTimeout();
    this.enqueue({ type: "ready", sessionId: this.id });
  }

  private enqueue(message: ServerMessage): void {
    if (this.closed) return;
    const maxLength = this.options.maxOutboundQueueLength ?? DEFAULT_MAX_QUEUE_LENGTH;
    this.outboundQueue.push(message);
    if (this.outboundQueue.length > maxLength) {
      this.dropOldestPartial();
    }
    this.flush();
  }

  private dropOldestPartial(): void {
    const idx = this.outboundQueue.findIndex((m) => m.type === "transcript" && m.kind === "partial");
    if (idx !== -1) {
      this.outboundQueue.splice(idx, 1);
      this.droppedPartialCount += 1;
      return;
    }
    // Nothing safely droppable is queued (only finals/control) - drop the oldest entry anyway
    // to bound memory. Only reachable under sustained, extreme backpressure.
    this.outboundQueue.shift();
  }

  private flush(): void {
    const { socket } = this.options;
    if (socket.readyState !== socket.OPEN) return;
    const highWaterMark = this.options.highWaterMarkBytes ?? DEFAULT_HIGH_WATER_MARK_BYTES;

    while (this.outboundQueue.length > 0 && socket.bufferedAmount < highWaterMark) {
      const next = this.outboundQueue.shift();
      if (!next) break;
      socket.send(JSON.stringify(next));
    }

    this.scheduleDrainIfNeeded();
  }

  private scheduleDrainIfNeeded(): void {
    if (this.outboundQueue.length === 0) {
      if (this.drainTimer) {
        clearInterval(this.drainTimer);
        this.drainTimer = null;
      }
      return;
    }
    if (this.drainTimer) return;
    const ms = this.options.drainRetryMs ?? DEFAULT_DRAIN_RETRY_MS;
    this.drainTimer = setInterval(() => this.flush(), ms);
  }

  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.drainTimer) clearInterval(this.drainTimer);

    if (this.provider) {
      await this.provider.close();
    }

    const { socket } = this.options;
    if (socket.readyState === socket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "closed", reason } satisfies ServerMessage));
      } catch {
        // socket may already be mid-close; nothing more to do.
      }
      socket.close();
    }
  }
}
