import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockSttProvider } from "../src/providers/MockSttProvider.js";
import { Session } from "../src/session.js";
import { FakeSocket } from "./fakeSocket.js";

describe("MockSttProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replays its script as partial/final events with increasing sequence numbers", async () => {
    const provider = new MockSttProvider({
      tickIntervalMs: 10,
      script: [
        { kind: "partial", text: "hel", afterTicks: 1 },
        { kind: "partial", text: "hello", afterTicks: 1 },
        { kind: "final", text: "Hello.", afterTicks: 1 },
      ],
    });
    const received: Array<{ kind: string; text: string; sequence: number }> = [];
    provider.onTranscript((e) => received.push(e));

    await provider.connect();
    await vi.advanceTimersByTimeAsync(40);
    await provider.close();

    expect(received).toEqual([
      { kind: "partial", text: "hel", sequence: 1 },
      { kind: "partial", text: "hello", sequence: 2 },
      { kind: "final", text: "Hello.", sequence: 3 },
    ]);
  });

  it("stops emitting once the script is exhausted", async () => {
    const provider = new MockSttProvider({
      tickIntervalMs: 10,
      script: [{ kind: "final", text: "done.", afterTicks: 1 }],
    });
    const received: unknown[] = [];
    provider.onTranscript((e) => received.push(e));

    await provider.connect();
    await vi.advanceTimersByTimeAsync(200); // far past script length
    await provider.close();

    expect(received).toHaveLength(1);
  });

  it("counts audio chunks it receives without altering its scripted output", () => {
    const provider = new MockSttProvider({ tickIntervalMs: 10, script: [] });
    provider.sendAudioChunk(Buffer.from([1]));
    provider.sendAudioChunk(Buffer.from([2]));
    expect(provider.receivedChunkCount).toBe(2);
  });

  it("relays mock transcript events end to end through a Session to the client socket", async () => {
    const socket = new FakeSocket();
    const createProvider = () =>
      new MockSttProvider({
        tickIntervalMs: 10,
        script: [
          { kind: "partial", text: "hi", afterTicks: 1 },
          { kind: "final", text: "Hi.", afterTicks: 1 },
        ],
      });
    new Session({ socket, createProvider });

    socket.emitControl({ type: "start" });
    await vi.advanceTimersByTimeAsync(30);

    const transcripts = socket.sentMessages.filter((m) => m.type === "transcript");
    expect(transcripts).toEqual([
      { type: "transcript", kind: "partial", text: "hi", sequence: 1 },
      { type: "transcript", kind: "final", text: "Hi.", sequence: 2 },
    ]);
  });
});
