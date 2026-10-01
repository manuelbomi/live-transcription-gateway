import { createGateway } from "./gateway.js";

const port = Number(process.env.PORT ?? 8080);
const provider = process.env.STT_PROVIDER === "deepgram" ? "deepgram" : "mock";

const wss = createGateway({ port });

// eslint-disable-next-line no-console
console.log(`live-transcription-gateway listening on ws://localhost:${port} (stt provider: ${provider})`);

function shutdown(): void {
  wss.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
