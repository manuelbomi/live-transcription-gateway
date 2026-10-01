import type { TranscriptKind } from "./providers/SttProvider.js";

/** Messages the browser client sends to the gateway. */
export type ClientMessage = { type: "start" } | { type: "stop" };

/** Messages the gateway sends back to the browser client. */
export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "transcript"; kind: TranscriptKind; text: string; sequence: number }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string };
