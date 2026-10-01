import { describe, it, expect } from "vitest";
import { reduceTranscript } from "../transcriptReducer";
import type { TranscriptLine } from "../types";

describe("reduceTranscript", () => {
  it("appends a final line to an empty transcript", () => {
    const lines = reduceTranscript([], { kind: "final", text: "Hello.", sequence: 1 });
    expect(lines).toEqual([{ id: 1, kind: "final", text: "Hello." }]);
  });

  it("replaces the in-progress partial with each new partial revision", () => {
    let lines: TranscriptLine[] = [];
    lines = reduceTranscript(lines, { kind: "partial", text: "hel", sequence: 1 });
    lines = reduceTranscript(lines, { kind: "partial", text: "hello", sequence: 2 });

    expect(lines).toEqual([{ id: 2, kind: "partial", text: "hello" }]);
  });

  it("commits the final and clears the in-progress partial", () => {
    let lines: TranscriptLine[] = [];
    lines = reduceTranscript(lines, { kind: "partial", text: "hel", sequence: 1 });
    lines = reduceTranscript(lines, { kind: "final", text: "Hello.", sequence: 2 });

    expect(lines).toEqual([{ id: 2, kind: "final", text: "Hello." }]);
  });

  it("keeps previously committed finals when a new partial starts", () => {
    let lines: TranscriptLine[] = [];
    lines = reduceTranscript(lines, { kind: "final", text: "First.", sequence: 1 });
    lines = reduceTranscript(lines, { kind: "partial", text: "sec", sequence: 2 });

    expect(lines).toEqual([
      { id: 1, kind: "final", text: "First." },
      { id: 2, kind: "partial", text: "sec" },
    ]);
  });
});
