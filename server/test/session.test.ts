import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Session } from "../src/session.js";
import { MockSttProvider } from "../src/providers/MockSttProvider.js";
import { FakeSocket } from "./fakeSocket.js";

function createProvider(): MockSttProvider {
  // tick fast and with a tiny script-independent interval so timer-driven tests stay quick
  return new MockSttProvider({ tickIntervalMs: 1000, script: [] });
}

describe("Session lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes the socket if the client never sends start (handshake timeout)", async () => {
    const socket = new FakeSocket();
    new Session({ socket, createProvider, handshakeTimeoutMs: 1000 });

    expect(socket.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);

    expect(socket.closed).toBe(true);
    expect(socket.sentMessages.at(-1)).toMatchObject({ type: "closed", reason: "handshake-timeout" });
  });

  it("sends ready with a session id once the client starts", async () => {
    const socket = new FakeSocket();
    const session = new Session({ socket, createProvider });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(0);

    expect(socket.sentMessages[0]).toMatchObject({ type: "ready", sessionId: session.id });
  });

  it("rejects audio sent before the handshake completes", async () => {
    const socket = new FakeSocket();
    new Session({ socket, createProvider });

    socket.emitAudioChunk(Buffer.from([1, 2, 3]));
    await vi.advanceTimersByTimeAsync(0);

    expect(socket.sentMessages[0]).toMatchObject({ type: "error" });
  });

  it("closes on an idle timeout after start, with no further audio", async () => {
    const socket = new FakeSocket();
    new Session({ socket, createProvider, idleTimeoutMs: 500 });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    expect(socket.closed).toBe(true);
    expect(socket.sentMessages.at(-1)).toMatchObject({ type: "closed", reason: "idle-timeout" });
  });

  it("resets the idle timer on each audio chunk", async () => {
    const socket = new FakeSocket();
    new Session({ socket, createProvider, idleTimeoutMs: 500 });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(0);

    // keep sending audio just inside the idle window - session should stay open
    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(300);
      socket.emitAudioChunk(Buffer.from([i]));
    }
    expect(socket.closed).toBe(false);

    // now go quiet and let the idle timer fire
    await vi.advanceTimersByTimeAsync(500);
    expect(socket.closed).toBe(true);
  });

  it("closes cleanly on an explicit stop message", async () => {
    const socket = new FakeSocket();
    new Session({ socket, createProvider });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(0);

    socket.emitControl({ type: "stop" });
    await vi.advanceTimersByTimeAsync(0);

    expect(socket.closed).toBe(true);
    expect(socket.sentMessages.at(-1)).toMatchObject({ type: "closed", reason: "client-stop" });
  });

  it("tears down the provider when the session closes", async () => {
    const socket = new FakeSocket();
    const provider = new MockSttProvider({ tickIntervalMs: 1000, script: [] });
    const closeSpy = vi.spyOn(provider, "close");
    const session = new Session({ socket, createProvider: () => provider });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(0);

    await session.close("test-shutdown");
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});
