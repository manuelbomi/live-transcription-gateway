import type { GatewaySocket } from "../src/session.js";

/**
 * Minimal in-memory stand-in for a `ws` WebSocket, used to drive Session in tests without
 * opening a real network socket. `sent` captures every outbound frame in order so tests can
 * assert on exactly what the gateway relayed to the browser.
 */
export class FakeSocket implements GatewaySocket {
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  closed = false;

  private listeners: Record<string, Array<(...args: never[]) => void>> = {
    message: [],
    close: [],
    error: [],
  };

  send(data: string): void {
    if (this.readyState !== this.OPEN) {
      throw new Error("cannot send on a closed socket");
    }
    this.sent.push(data);
  }

  close(): void {
    this.readyState = this.CLOSED;
    this.closed = true;
    for (const listener of this.listeners.close ?? []) listener();
  }

  on(event: "message", listener: (data: Buffer, isBinary: boolean) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: string, listener: (...args: never[]) => void): void {
    (this.listeners[event] ??= []).push(listener);
  }

  /** Test helper: simulate the browser sending a JSON control message. */
  emitControl(message: unknown): void {
    const buf = Buffer.from(JSON.stringify(message));
    for (const listener of this.listeners.message ?? []) (listener as (d: Buffer, b: boolean) => void)(buf, false);
  }

  /** Test helper: simulate the browser sending a binary audio chunk. */
  emitAudioChunk(bytes: Buffer): void {
    for (const listener of this.listeners.message ?? []) (listener as (d: Buffer, b: boolean) => void)(bytes, true);
  }

  /** Parsed JSON view of every message sent to the client so far. */
  get sentMessages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}
