import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Session, type GatewaySocket } from "./session.js";
import { MockSttProvider } from "./providers/MockSttProvider.js";
import { DeepgramProvider } from "./providers/DeepgramProvider.js";
import type { SttProvider } from "./providers/SttProvider.js";

export interface GatewayOptions {
  /** attach to an existing HTTP server instead of opening a dedicated port */
  server?: Server;
  port?: number;
  /** provider factory override, mainly for tests; defaults to env-based selection below */
  createProvider?: () => SttProvider;
}

/**
 * Chooses the STT backend for new sessions. MockSttProvider is the default on purpose: the
 * gateway (and CI) must work with zero configuration. Set STT_PROVIDER=deepgram and
 * DEEPGRAM_API_KEY to use the real streaming backend instead.
 */
function defaultProviderFactory(): SttProvider {
  if (process.env.STT_PROVIDER === "deepgram") {
    return new DeepgramProvider();
  }
  return new MockSttProvider();
}

/** Starts the WebSocket gateway and wires every incoming connection to its own Session. */
export function createGateway(options: GatewayOptions = {}): WebSocketServer {
  const wss = new WebSocketServer(options.server ? { server: options.server } : { port: options.port ?? 8080 });
  const createProvider = options.createProvider ?? defaultProviderFactory;

  wss.on("connection", (socket: WebSocket) => {
    // `ws`'s WebSocket already satisfies the GatewaySocket shape Session depends on.
    new Session({ socket: socket as unknown as GatewaySocket, createProvider });
  });

  return wss;
}
