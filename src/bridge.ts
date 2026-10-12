// Client for the local ENE bridge (bridge/ene-bridge.mjs).

export type GatewayState = "connecting" | "connected" | "disconnected" | "pairing" | "paused" | "error";

export type BridgeEvent =
  | { type: "gateway"; state: GatewayState; detail?: Record<string, unknown> }
  | { type: "delta"; runId: string; text: string; replace: boolean }
  | { type: "final"; runId: string; text: string }
  | { type: "error"; runId?: string; message: string }
  | { type: "status"; runId: string; phase: string }
  | { type: "tool"; runId: string; phase: string; name: string }
  | { type: "lifecycle"; runId: string; phase: string }
  | { type: "heartbeat" }
  | { type: "bridge"; connected: boolean };

const BRIDGE_URL = import.meta.env.VITE_ENE_BRIDGE_URL ?? "ws://127.0.0.1:18790";

export class BridgeClient {
  private ws: WebSocket | null = null;
  private retryMs = 500;

  constructor(private readonly onEvent: (event: BridgeEvent) => void) {}

  connect() {
    const ws = new WebSocket(BRIDGE_URL);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 500;
      this.onEvent({ type: "bridge", connected: true });
    };
    ws.onmessage = (msg) => {
      try {
        this.onEvent(JSON.parse(String(msg.data)) as BridgeEvent);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      this.onEvent({ type: "bridge", connected: false });
      // The bridge may still be starting (Tauri spawns it alongside the window).
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 8000);
    };
  }

  private send(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  say(text: string) {
    return this.send({ type: "send", text });
  }

  abort() {
    return this.send({ type: "abort" });
  }
}
