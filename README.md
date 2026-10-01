# live-transcription-gateway

A small, complete example of real-time audio transcription: a browser captures microphone
audio, streams it over a WebSocket to a Node gateway, the gateway forwards it to a
speech-to-text (STT) engine, and partial/final transcripts flow back and render live in a
React UI. I built this to learn the actual mechanics of low-latency audio streaming - framing,
backpressure, reconnects, provider abstraction - rather than just wiring up an SDK.

It runs completely offline out of the box. No API key, no Docker, no paid service required to
try it, build it, or run its test suite.

```
npm install
npm run build
npm test
npm run dev:server   # terminal 1 - starts the gateway on ws://localhost:8080
npm run dev:web       # terminal 2 - opens the client on http://localhost:5173
```

Click **Record**, allow microphone access, and watch text appear. By default you're talking to
`MockSttProvider`, so the transcript you see is a scripted demo conversation, not an actual
transcription of your voice - that's intentional, see below.

## The pipeline, end to end

```
 browser mic                 WebSocket               gateway (Node)              STT backend
┌───────────────┐   chunks  ┌───────────┐  binary   ┌──────────────────┐  audio  ┌───────────┐
│ getUserMedia   │ ───────▶ │  client   │ ─────────▶│  Session          │───────▶│  provider  │
│ MediaRecorder  │           │  socket   │           │  (session.ts)    │         │ (mock/real)│
└───────────────┘           └───────────┘◀───────── └──────────────────┘◀─────── └───────────┘
                               JSON: partial/final      relays transcript          partial/final
                                                         events, applies            events
                                                         backpressure
```

1. **Capture** - `web/src/hooks/useAudioCapture.ts` calls `getUserMedia({ audio: true })` and
   feeds the resulting `MediaStream` into a `MediaRecorder`. Calling `recorder.start(250)` makes
   the browser hand back a `dataavailable` event roughly every 250ms instead of one blob at the
   end of the recording - that periodic hand-off is the "framing" that turns a continuous
   recording into a stream.
2. **Chunk** - each `dataavailable` event carries one `Blob` (encoded `webm/opus` by default).
   It's converted to an `ArrayBuffer` and sent as a **binary** WebSocket frame. A real
   low-latency pipeline could instead use an `AudioWorklet` to get raw PCM samples at a fixed
   frame size (e.g. 20ms) for less encoder latency and jitter - the gateway doesn't care either
   way, it just forwards bytes.
3. **WebSocket** - `web/src/hooks/useTranscriptSocket.ts` owns the connection: it sends a
   `{"type":"start"}` handshake, streams the binary audio frames, and listens for JSON text
   frames with the transcript.
4. **Gateway** - `server/src/session.ts`'s `Session` class is one connection's whole lifecycle:
   handshake, idle timeout, forwarding audio to whichever `SttProvider` is active, and relaying
   transcript events back out with backpressure handling (see below).
5. **STT provider** - the gateway never talks to a specific vendor directly; it talks to the
   `SttProvider` interface (`server/src/providers/SttProvider.ts`). See "Mock vs. real provider"
   below - this is the design choice the whole repo is built around.
6. **Relay** - every `partial`/`final` event the provider emits becomes a
   `{"type":"transcript", kind, text, sequence}` JSON message sent back over the same socket.
7. **Render** - `web/src/transcriptReducer.ts` folds those events into a list of lines;
   `web/src/components/Transcript.tsx` renders finals as normal text and the one in-progress
   partial greyed and italicized.

## Partial vs. final transcripts

Streaming STT engines don't wait for you to finish a sentence before saying anything. They
emit **partial** results - "best guess so far," which may still change - every time they get
enough new audio to revise their hypothesis, and a **final** result once they're confident a
phrase is complete and settled.

This matters for two reasons:

- **Latency.** Finals typically lag partials by hundreds of milliseconds to a couple of seconds
  (the engine wants more context before committing). If a UI only showed finals, the user would
  stare at a blank box for a second or two after talking - it would feel broken. Showing
  partials immediately makes the system *feel* instant even though the "official" text arrives
  later.
- **Correctness.** Partials can and do change - a partial reading "set the time" might become
  the final "set the timer" once more audio arrives. Treating a partial as settled text (storing
  it, acting on it, reading it aloud) is a bug waiting to happen.

The UI distinguishes them visually (greyed + italic for partial, normal weight for final) so
the user's eye - and any code consuming the transcript - never confuses "still forming" with
"done." `transcriptReducer.ts` enforces the same rule in data: each new partial *replaces* the
previous one (it's a revision of the same utterance), while a final is appended permanently and
clears the in-progress partial.

## Mock vs. real provider - the core design decision

```ts
// server/src/providers/SttProvider.ts
export interface SttProvider {
  connect(): Promise<void>;
  sendAudioChunk(chunk: Buffer): void;
  onTranscript(listener: TranscriptListener): void;
  close(): Promise<void>;
}
```

The gateway (`Session`) is written entirely against this interface and never imports a vendor
SDK directly. Two implementations exist:

- **`MockSttProvider`** (default, used by every test and by CI) replays a canned, deterministic
  script of partial/final events on a timer. It still receives real audio chunks (and counts
  them - see `receivedChunkCount`), it just doesn't use them to produce its output. This is what
  makes the entire repo clonable and testable by anyone with zero credentials: `npm test` and
  `npm run dev:server` both work with no `.env` file at all.
- **`DeepgramProvider`** (`server/src/providers/DeepgramProvider.ts`) is the real path. It opens
  a WebSocket to Deepgram's live streaming API, forwards audio bytes to it, and parses its JSON
  responses into the same `TranscriptEvent` shape the mock produces. Constructing it without an
  API key throws immediately and explains why, rather than silently degrading.

Because both sides of that interface are interchangeable, swapping providers is one line. To
turn on the real path:

```bash
cp server/.env.example server/.env
# edit server/.env:
#   STT_PROVIDER=deepgram
#   DEEPGRAM_API_KEY=<your key from https://console.deepgram.com>
npm run dev:server
```

`server/src/gateway.ts`'s `defaultProviderFactory()` reads `STT_PROVIDER` and picks the
implementation per session - nothing else in the gateway changes.

If you point the real `DeepgramProvider` at actual browser audio, note that `MediaRecorder`'s
default output here is `webm/opus`, not raw PCM. The provider as written asks Deepgram for
`linear16` encoding (matching a raw-PCM capture path like an `AudioWorklet`); to feed it
`webm/opus` chunks directly, drop the `encoding`/`sample_rate` query parameters and let Deepgram
auto-detect the container instead.

## Backpressure and reconnects

**Backpressure (gateway -> browser).** `Session` never calls `socket.send()` directly from a
transcript callback. Every outbound message goes into a small bounded queue first
(`maxOutboundQueueLength`, default 50) and is drained while `ws.bufferedAmount` stays under a
high-water mark (default 1MB). If the client's network can't keep up and the queue fills up
anyway, the session drops the **oldest queued partial** - never a final, never a control message
- because a stale partial is worthless once a newer one (or the final that supersedes it)
exists, while dropping a final would permanently lose real content. A short retry timer keeps
flushing the queue as the socket drains. See `server/test/backpressure.test.ts` for this
behavior under test.

**Reconnects (browser -> gateway).** `useTranscriptSocket` reconnects with exponential backoff
(500ms, 1s, 2s, 4s, capped at 8s, plus random jitter so many clients don't retry in lockstep)
whenever the socket drops *while the user is still recording*. A reconnect opens a brand-new
gateway session - a new session id, a new STT connection - so a sentence that was only half
transcribed when the link dropped is lost; transcription resumes cleanly from the next audio
chunk, and everything already rendered client-side stays put. Calling `stop()` explicitly
disables auto-reconnect, so ending the recording on purpose never triggers a retry loop.

## Session lifecycle and idle timeout

Each WebSocket connection becomes one `Session` (`server/src/session.ts`):

1. Connect -> a handshake timer starts (default 5s).
2. Client sends `{"type":"start"}` -> the handshake timer is cancelled, a provider is created
   and connected, an idle timer starts (default 30s), and the gateway replies
   `{"type":"ready","sessionId":"..."}`.
3. Binary audio frames reset the idle timer and are forwarded to the provider.
4. `{"type":"stop"}`, a socket close/error, the handshake timeout, or the idle timeout all lead
   to the same cleanup path: the provider is closed first, then a final
   `{"type":"closed","reason":"..."}` message is sent and the socket is closed.

## Audio format notes

The browser streams whatever `MediaRecorder` produces with its default `mimeType`
(`audio/webm;codecs=opus` where supported). Each binary WebSocket frame is one encoded chunk,
not a complete file - `MediaRecorder`'s webm output is a single continuous container, so the
*first* chunk carries header information the rest depend on; a provider that needs raw PCM
instead (like the `linear16` encoding `DeepgramProvider` is configured for by default) would
typically capture via `AudioWorklet` and ship fixed-size Int16 frames instead. Both approaches
hand the gateway "a chunk of bytes every N milliseconds"; `session.ts` and `SttProvider` don't
need to know which one produced them.

## Latency budget

Rough budget for "I stop talking" -> "final text appears," end to end:

| Stage | Typical cost | Notes |
|---|---|---|
| Capture chunking | up to 1 timeslice (default 250ms) | `MediaRecorder` buffers audio for the whole timeslice before emitting it - the single biggest knob you control client-side. Lower it for latency, raise it to cut per-chunk overhead. |
| Network: browser -> gateway | ~10-50ms | one WebSocket hop; worse on mobile/high-RTT networks. |
| Gateway processing | <1ms | `Session` does no audio processing, just forwards bytes. |
| STT engine | 100ms-1s+ for a final; partials much faster | finals intentionally wait for more context; this is where most of the budget lives and is entirely provider-dependent. |
| Network: gateway -> browser | ~10-50ms | same WebSocket, other direction; grows under backpressure (see above) until the queue drains. |
| Render | <1ms | `reduceTranscript` + a React re-render. |

In practice, the capture timeslice and the STT engine's own confidence threshold dominate -
everything this repo's gateway adds (forwarding, queuing, reconnect bookkeeping) is low
single-digit milliseconds by design, so it's rarely the bottleneck.

## Project layout

```
server/            Node + TypeScript WebSocket gateway
  src/providers/    SttProvider interface, MockSttProvider, DeepgramProvider
  src/session.ts    per-connection lifecycle, backpressure
  src/gateway.ts    WebSocketServer + provider selection
  test/             vitest - lifecycle, mock provider relay, backpressure
web/               React + TypeScript client (Vite)
  src/hooks/        useAudioCapture (mic capture), useTranscriptSocket (ws + reconnect)
  src/components/   RecordButton, StatusIndicator, Transcript
  src/test/         vitest + Testing Library - transcript rendering, reducer logic
.github/workflows/ CI: lint, test, build - mock provider only, no secrets needed
```

## Scripts

Run from the repo root (npm workspaces):

- `npm run dev:server` / `npm run dev:web` - run each half in watch mode
- `npm test` - server + web test suites (all against `MockSttProvider`, no network)
- `npm run build` - type-checks and builds both packages
- `npm run lint` - ESLint across both packages

## License

MIT
