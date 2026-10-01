import { useCallback, useEffect, useRef, useState } from "react";

export interface UseAudioCaptureOptions {
  /** called with one chunk of recorded audio every `timesliceMs` */
  onChunk: (chunk: ArrayBuffer) => void;
  /** how often MediaRecorder hands us a chunk, in ms - the real "framing" knob (default 250ms) */
  timesliceMs?: number;
  /** container/codec MediaRecorder should use, if supported by the browser */
  mimeType?: string;
}

export interface UseAudioCaptureResult {
  isRecording: boolean;
  start: () => Promise<void>;
  stop: () => void;
  error: string | null;
}

const DEFAULT_MIME_TYPE = "audio/webm;codecs=opus";

/**
 * Captures real microphone audio with getUserMedia + MediaRecorder and hands it to the caller
 * as a stream of chunks, instead of one blob at the end of the recording.
 *
 * Framing note: passing a `timeslice` to `recorder.start()` is what turns a single continuous
 * recording into periodic `dataavailable` events - each one a self-contained chunk of encoded
 * audio (webm/opus by default here) roughly `timesliceMs` long. That is the browser-side
 * equivalent of the fixed-size frames an AudioWorklet would produce for raw PCM; either way the
 * gateway just sees "chunk arrives over the wire every ~250ms" (see server/src/session.ts).
 * Smaller timeslices lower latency but add per-chunk overhead; see the README's latency budget.
 */
export function useAudioCapture(options: UseAudioCaptureOptions): UseAudioCaptureResult {
  const { onChunk, timesliceMs = 250, mimeType = DEFAULT_MIME_TYPE } = options;
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const supported = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(mimeType);
      const recorder = new MediaRecorder(stream, supported ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event: BlobEvent) => {
        if (event.data.size === 0) return;
        void event.data.arrayBuffer().then((buffer) => onChunkRef.current(buffer));
      });
      recorder.addEventListener("stop", releaseStream);

      recorder.start(timesliceMs);
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to access the microphone");
      setIsRecording(false);
      releaseStream();
    }
  }, [mimeType, timesliceMs, releaseStream]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      releaseStream();
    }
    recorderRef.current = null;
    setIsRecording(false);
  }, [releaseStream]);

  useEffect(() => stop, [stop]);

  return { isRecording, start, stop, error };
}
