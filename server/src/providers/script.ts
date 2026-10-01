import type { TranscriptKind } from "./SttProvider.js";

export interface ScriptedEvent {
  kind: TranscriptKind;
  text: string;
  /** how many scheduler ticks to wait after the previous event before emitting this one */
  afterTicks: number;
}

/**
 * A deterministic canned "conversation" MockSttProvider replays. It mimics how a real
 * streaming STT engine behaves: a sentence is announced as a sequence of growing partials
 * (each one a revision of the last) and then closed off with a single final that often
 * differs slightly from the last partial (capitalization, punctuation, a corrected word).
 */
export const DEFAULT_SCRIPT: ScriptedEvent[] = [
  { kind: "partial", text: "so", afterTicks: 1 },
  { kind: "partial", text: "so today", afterTicks: 1 },
  { kind: "partial", text: "so today we're", afterTicks: 1 },
  { kind: "final", text: "So today we're recording a quick voice memo.", afterTicks: 1 },
  { kind: "partial", text: "the", afterTicks: 2 },
  { kind: "partial", text: "the gateway", afterTicks: 1 },
  { kind: "partial", text: "the gateway streams", afterTicks: 1 },
  { kind: "final", text: "The gateway streams audio in real time.", afterTicks: 1 },
  { kind: "partial", text: "partial", afterTicks: 2 },
  { kind: "partial", text: "partial results show up", afterTicks: 1 },
  { kind: "final", text: "Partial results show up fast, finals arrive a little later.", afterTicks: 1 },
];
