import type { TranscriptKind, TranscriptLine } from "./types";

export interface TranscriptEventInput {
  kind: TranscriptKind;
  text: string;
  sequence: number;
}

/**
 * Folds one incoming partial/final event into the list of lines to render.
 *
 * A "final" commits a finished line and clears whatever partial was in progress. A "partial"
 * is a revision of the same in-progress utterance - not a new line - so it replaces the
 * previous partial instead of appending one. This mirrors how streaming STT APIs behave: you
 * get several partials for one sentence before the final supersedes them all.
 */
export function reduceTranscript(lines: TranscriptLine[], event: TranscriptEventInput): TranscriptLine[] {
  const withoutInProgressPartial = lines.filter((line) => line.kind !== "partial");
  return [...withoutInProgressPartial, { id: event.sequence, kind: event.kind, text: event.text }];
}
