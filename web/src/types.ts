export type TranscriptKind = "partial" | "final";

/** Mirrors server/src/types.ts - kept as a small duplicated contract rather than a cross-workspace
 *  import so the client and server packages stay independently publishable/buildable. */
export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "transcript"; kind: TranscriptKind; text: string; sequence: number }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string };

export type ClientMessage = { type: "start" } | { type: "stop" };

export interface TranscriptLine {
  id: number;
  kind: TranscriptKind;
  text: string;
}

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";
