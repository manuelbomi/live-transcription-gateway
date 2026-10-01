import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Session } from "../src/session.js";
import { MockSttProvider } from "../src/providers/MockSttProvider.js";
import { FakeSocket } from "./fakeSocket.js";

describe("Session backpressure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues instead of sending while the socket is backed up, and drops the oldest partial once the queue is full", async () => {
    const socket = new FakeSocket();
    // simulate a client whose network can't keep up: bufferedAmount stays above the watermark
    socket.bufferedAmount = 10_000;

    const script = Array.from({ length: 6 }, (_, i) => ({
      kind: "partial" as const,
      text: `partial-${i}`,
      afterTicks: 1,
    }));
    const createProvider = () => new MockSttProvider({ tickIntervalMs: 5, script });

    const session = new Session({
      socket,
      createProvider,
      maxOutboundQueueLength: 3,
      highWaterMarkBytes: 1_000, // socket.bufferedAmount (10_000) stays above this -> flush() sends nothing
    });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(40); // let all 6 scripted partials fire

    // "ready" + every transcript went into the queue, but flush() never sent anything
    expect(socket.sent).toHaveLength(0);
    expect(session.droppedPartials).toBeGreaterThan(0);
  });

  it("never drops a final transcript, even under sustained backpressure", async () => {
    const socket = new FakeSocket();
    socket.bufferedAmount = 10_000;

    const createProvider = () =>
      new MockSttProvider({
        tickIntervalMs: 5,
        script: [
          { kind: "partial", text: "a", afterTicks: 1 },
          { kind: "partial", text: "b", afterTicks: 1 },
          { kind: "partial", text: "c", afterTicks: 1 },
          { kind: "final", text: "a b c.", afterTicks: 1 },
        ],
      });

    new Session({
      socket,
      createProvider,
      maxOutboundQueueLength: 1, // aggressively small, forces drops on every new partial
      highWaterMarkBytes: 1_000,
    });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(30);

    // drain the backlog now that the "client" caught up
    socket.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(200);

    const kinds = socket.sentMessages.map((m) => m.type === "transcript" && m.kind).filter(Boolean);
    expect(kinds).toContain("final");
    const finalMessage = socket.sentMessages.find((m) => m.type === "transcript" && m.kind === "final");
    expect(finalMessage).toMatchObject({ text: "a b c." });
  });

  it("resumes flushing once the socket drains below the high water mark", async () => {
    const socket = new FakeSocket();
    socket.bufferedAmount = 10_000;

    const createProvider = () =>
      new MockSttProvider({
        tickIntervalMs: 5,
        script: [{ kind: "final", text: "done.", afterTicks: 1 }],
      });

    new Session({ socket, createProvider, highWaterMarkBytes: 1_000, drainRetryMs: 10 });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(20);
    expect(socket.sent).toHaveLength(0);

    socket.bufferedAmount = 0; // client caught up
    await vi.advanceTimersByTimeAsync(20); // drain retry timer should flush the backlog

    expect(socket.sentMessages.some((m) => m.type === "transcript" && m.text === "done.")).toBe(true);
  });
});
