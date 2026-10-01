import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus, ServerMessage, TranscriptKind } from "../types";

export interface UseTranscriptSocketOptions {
  url: string;
  onTranscript: (event: { kind: TranscriptKind; text: string; sequence: number }) => void;
  onError?: (message: string) => void;
  /** first retry delay; doubles each attempt up to maxBackoffMs (default 500ms) */
  baseBackoffMs?: number;
  /** backoff ceiling (default 8000ms) */
  maxBackoffMs?: number;
}

export interface UseTranscriptSocketResult {
  status: ConnectionStatus;
  /** Opens the socket (if needed) and starts a transcription session. */
  start: () => void;
  /** Ends the session and stops any pending reconnect attempts. */
  stop: () => void;
  /** Streams one chunk of recorded audio to the gateway as a binary WebSocket frame. */
  sendAudioChunk: (chunk: ArrayBuffer) => void;
}

/**
 * Owns the WebSocket connection to the gateway: opening it, sending the start/stop handshake,
 * forwarding audio chunks, and - the part that matters most for a flaky mobile network or a
 * server restart - reconnecting.
 *
 * Reconnect strategy: if the socket drops while the user is still recording, we reconnect with
 * exponential backoff (base -> base*2 -> base*4 -> ... capped at maxBackoffMs) plus random
 * jitter, so a server restart doesn't get hammered by every client retrying in lockstep. A
 * reconnect opens a *new* gateway session (a fresh sessionId and a fresh STT connection) - the
 * transcript already rendered client-side is untouched, but a sentence that was only half
 * transcribed when the link dropped is lost and resumes from the next audio chunk. We never
 * auto-reconnect after an intentional `stop()` - only after a drop while still recording.
 */
export function useTranscriptSocket(options: UseTranscriptSocketOptions): UseTranscriptSocketResult {
  const { url, onTranscript, onError, baseBackoffMs = 500, maxBackoffMs = 8000 } = options;
  const [status, setStatus] = useState<ConnectionStatus>("idle");

  const socketRef = useRef<WebSocket | null>(null);
  const wantsConnectionRef = useRef(false);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // kept in refs so reconnect logic always calls the latest callbacks without re-subscribing
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    clearReconnectTimer();
    setStatus((prev) => (prev === "open" ? prev : attemptRef.current > 0 ? "reconnecting" : "connecting"));

    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      attemptRef.current = 0;
      setStatus("open");
      socket.send(JSON.stringify({ type: "start" }));
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return; // transcripts are always JSON text frames
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === "transcript") {
        onTranscriptRef.current({ kind: message.kind, text: message.text, sequence: message.sequence });
      } else if (message.type === "error") {
        onErrorRef.current?.(message.message);
      }
    });

    const scheduleReconnect = () => {
      socketRef.current = null;
      if (!wantsConnectionRef.current) {
        setStatus("closed");
        return;
      }
      const attempt = attemptRef.current;
      attemptRef.current += 1;
      const delay = Math.min(baseBackoffMs * 2 ** attempt, maxBackoffMs);
      const jitter = Math.random() * delay * 0.2;
      setStatus("reconnecting");
      reconnectTimerRef.current = setTimeout(connect, delay + jitter);
    };

    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => {
      // "close" always follows "error" for a WebSocket, so the actual retry is scheduled there.
      onErrorRef.current?.("socket error");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, baseBackoffMs, maxBackoffMs, clearReconnectTimer]);

  const start = useCallback(() => {
    wantsConnectionRef.current = true;
    attemptRef.current = 0;
    if (!socketRef.current) connect();
  }, [connect]);

  const stop = useCallback(() => {
    wantsConnectionRef.current = false;
    clearReconnectTimer();
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
      socket.close();
    }
    socketRef.current = null;
    setStatus("closed");
  }, [clearReconnectTimer]);

  const sendAudioChunk = useCallback((chunk: ArrayBuffer) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(chunk);
    }
  }, []);

  useEffect(() => {
    return () => {
      wantsConnectionRef.current = false;
      clearReconnectTimer();
      socketRef.current?.close();
    };
  }, [clearReconnectTimer]);

  return { status, start, stop, sendAudioChunk };
}
