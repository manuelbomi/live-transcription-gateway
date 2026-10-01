import { useCallback, useState } from "react";
import { RecordButton } from "./components/RecordButton";
import { StatusIndicator } from "./components/StatusIndicator";
import { Transcript } from "./components/Transcript";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useTranscriptSocket } from "./hooks/useTranscriptSocket";
import { reduceTranscript } from "./transcriptReducer";
import type { TranscriptKind, TranscriptLine } from "./types";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "ws://localhost:8080";

export function App(): JSX.Element {
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [socketError, setSocketError] = useState<string | null>(null);

  const handleTranscript = useCallback((event: { kind: TranscriptKind; text: string; sequence: number }) => {
    setLines((prev) => reduceTranscript(prev, event));
  }, []);

  const transcriptSocket = useTranscriptSocket({
    url: GATEWAY_URL,
    onTranscript: handleTranscript,
    onError: setSocketError,
  });

  // Every MediaRecorder timeslice chunk is pushed straight onto the WebSocket as a binary
  // frame; sendAudioChunk silently drops it if the socket isn't open yet (e.g. mid-reconnect).
  const audioCapture = useAudioCapture({ onChunk: transcriptSocket.sendAudioChunk });

  const handleRecordClick = useCallback(async () => {
    if (audioCapture.isRecording) {
      audioCapture.stop();
      transcriptSocket.stop();
      return;
    }
    setSocketError(null);
    transcriptSocket.start();
    await audioCapture.start();
  }, [audioCapture, transcriptSocket]);

  const error = audioCapture.error ?? socketError;

  return (
    <main className="app">
      <header className="app-header">
        <h1>Live Transcription Gateway</h1>
        <StatusIndicator status={transcriptSocket.status} />
      </header>

      <RecordButton isRecording={audioCapture.isRecording} onClick={handleRecordClick} />

      {error && <p className="app-error">{error}</p>}

      <Transcript lines={lines} />
    </main>
  );
}
