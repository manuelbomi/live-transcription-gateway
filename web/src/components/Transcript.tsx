import type { TranscriptLine } from "../types";

export interface TranscriptProps {
  lines: TranscriptLine[];
}

/**
 * Renders finalized lines as plain text and the current in-progress partial (if any) visually
 * distinct - greyed and italicized - so it reads unmistakably as "still being transcribed,
 * may still change" rather than finished output. That distinction is the whole UX point of
 * streaming partials: showing text immediately (low perceived latency) without pretending it's
 * final (see README > "partial vs final").
 */
export function Transcript({ lines }: TranscriptProps): JSX.Element {
  if (lines.length === 0) {
    return <p className="transcript-empty">Press record and start talking - the transcript will appear here.</p>;
  }

  return (
    <div className="transcript" aria-live="polite">
      {lines.map((line) => (
        <span key={line.id} data-kind={line.kind} className={line.kind === "partial" ? "transcript-partial" : "transcript-final"}>
          {line.text}{" "}
        </span>
      ))}
    </div>
  );
}
