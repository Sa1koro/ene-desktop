// ENE bridge: holds the authenticated OpenClaw Gateway connection and exposes a
// tiny local WebSocket protocol to the ENE frontend.
//
// Why a bridge: Gateway operator clients need an Ed25519 device identity and a
// shared-secret bootstrap. Keeping both in this Node process means the webview
// never sees the gateway token, and the gateway's browser-origin allowlist does
// not need to change.
//
// Frontend -> bridge:  {type:"send", text} | {type:"abort"} | {type:"history"}
// Bridge -> frontend:  {type:"gateway", state, detail?}
//                      {type:"delta", runId, text, replace}
//                      {type:"final", runId, text}
//                      {type:"error", runId?, message}
//                      {type:"status", runId, phase}
//                      {type:"tool", runId, phase, name}
//                      {type:"lifecycle", runId, phase}
//                      {type:"heartbeat"}
//                      {type:"history", messages:[{role,text}]}

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayClient } from "@openclaw/gateway-client";
import { GATEWAY_CLIENT_CAPS } from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { WebSocketServer } from "ws";

const GATEWAY_URL = process.env.ENE_GATEWAY_URL ?? "ws://127.0.0.1:18789";
const SESSION_KEY = process.env.ENE_SESSION_KEY ?? "agent:main:main";
const BRIDGE_PORT = Number(process.env.ENE_BRIDGE_PORT ?? 18790);
const STATE_DIR =
  process.env.ENE_STATE_DIR ??
  path.join(process.env.APPDATA ?? path.join(os.homedir(), ".config"), "ene-desktop");

// Browser origins allowed to talk to the bridge: Vite dev server and Tauri webview.
const ALLOWED_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]);

const log = (...args) => console.log("[ene-bridge]", ...args);

// ---------------------------------------------------------------- credentials

function readGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;
  const configPath =
    process.env.OPENCLAW_CONFIG ?? path.join(os.homedir(), ".openclaw", "openclaw.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config?.gateway?.auth?.token;
  } catch (err) {
    log(`could not read gateway token from ${configPath}: ${err.message}`);
    return undefined;
  }
}

// Ed25519 identity, same derivation as OpenClaw: deviceId = sha256(raw public key).
function rawPublicKey(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

function loadOrCreateDeviceIdentity() {
  const file = path.join(STATE_DIR, "device.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
    const identity = {
      deviceId: crypto.createHash("sha256").update(rawPublicKey(publicKeyPem)).digest("hex"),
      publicKeyPem,
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    };
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
    log(`created device identity ${identity.deviceId.slice(0, 12)}…`);
    return identity;
  }
}

const tokenFile = path.join(STATE_DIR, "device-tokens.json");
const readTokens = () => {
  try {
    return JSON.parse(fs.readFileSync(tokenFile, "utf8"));
  } catch {
    return {};
  }
};
const writeTokens = (tokens) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
};

const hostDeps = {
  loadOrCreateDeviceIdentity,
  signDevicePayload: (privateKeyPem, payload) =>
    crypto.sign(null, Buffer.from(payload, "utf8"), privateKeyPem).toString("base64url"),
  publicKeyRawBase64UrlFromPem: (pem) => rawPublicKey(pem).toString("base64url"),
  loadDeviceAuthToken: ({ deviceId, role }) => readTokens()[`${deviceId}:${role}`] ?? null,
  storeDeviceAuthToken: ({ deviceId, role, token, scopes }) => {
    writeTokens({ ...readTokens(), [`${deviceId}:${role}`]: { token, scopes } });
  },
  clearDeviceAuthToken: ({ deviceId, role }) => {
    const tokens = readTokens();
    delete tokens[`${deviceId}:${role}`];
    writeTokens(tokens);
  },
  logError: (message) => log("gateway:", message),
};

// ---------------------------------------------------------------- frontend fan-out

const clients = new Set();
let gatewayState = { type: "gateway", state: "connecting" };

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
}

function setGatewayState(state, detail) {
  gatewayState = { type: "gateway", state, ...(detail ? { detail } : {}) };
  broadcast(gatewayState);
}

// Assistant message payloads are content-block arrays or plain strings.
function messageText(message) {
  if (!message) return "";
  if (typeof message === "string") return message;
  const content = message.content ?? message.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }
  return "";
}

// ---------------------------------------------------------------- gateway events

const seenEventShapes = new Set();

function handleGatewayEvent(evt) {
  const p = evt.payload ?? {};
  switch (evt.event) {
    case "chat": {
      if (p.sessionKey && p.sessionKey !== SESSION_KEY) return;
      if (p.spawnedBy) return; // subagent chatter is not ENE talking
      if (p.state === "delta") {
        broadcast({ type: "delta", runId: p.runId, text: p.deltaText ?? "", replace: !!p.replace });
      } else if (p.state === "final") {
        broadcast({ type: "final", runId: p.runId, text: messageText(p.message) });
      } else if (p.state === "error" || p.state === "aborted") {
        broadcast({ type: "error", runId: p.runId, message: p.errorMessage ?? p.state });
      } else if (p.state === "status") {
        broadcast({ type: "status", runId: p.runId, phase: p.phase });
      }
      return;
    }
    case "agent": {
      const data = p.data ?? {};
      if (p.stream === "tool") {
        broadcast({
          type: "tool",
          runId: p.runId,
          phase: data.phase ?? data.state ?? "update",
          name: data.name ?? data.toolName ?? data.tool ?? "tool",
        });
      } else if (p.stream === "lifecycle") {
        broadcast({ type: "lifecycle", runId: p.runId, phase: data.phase });
      }
      return;
    }
    case "heartbeat":
      broadcast({ type: "heartbeat" });
      return;
    case "tick":
    case "health":
    case "presence":
      return;
    default:
      if (!seenEventShapes.has(evt.event)) {
        seenEventShapes.add(evt.event);
        log(`(unhandled event family: ${evt.event})`);
      }
  }
}

// ---------------------------------------------------------------- gateway client

const token = readGatewayToken();
if (!token) log("no gateway token found; set OPENCLAW_GATEWAY_TOKEN or gateway.auth.token");

const gateway = new GatewayClient({
  url: GATEWAY_URL,
  token,
  clientName: "gateway-client",
  clientDisplayName: "ENE Desktop",
  clientVersion: "0.1.0",
  platform: process.platform,
  mode: "ui",
  role: "operator",
  scopes: ["operator.read", "operator.write"],
  caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS],
  minProtocol: PROTOCOL_VERSION,
  maxProtocol: PROTOCOL_VERSION,
  hostDeps,
  onHelloOk: (hello) => {
    log(`connected to gateway ${hello.server?.version ?? ""} (scopes: ${hello.auth?.scopes?.join(", ")})`);
    setGatewayState("connected", { sessionKey: SESSION_KEY });
  },
  onConnectError: (err) => {
    const details = err.details ?? {};
    const code = details.code ?? err.code;
    if (code === "PAIRING_REQUIRED" || /pairing/i.test(err.message)) {
      const requestId = details.requestId ?? details.pairingRequestId;
      log(`pairing required${requestId ? `: run  openclaw devices approve ${requestId}` : ""}`);
      setGatewayState("pairing", { requestId, message: err.message });
    } else {
      log(`connect error: ${err.message}`);
      setGatewayState("error", { message: err.message, code });
    }
  },
  onReconnectPaused: (info) => setGatewayState("paused", info),
  onClose: (code, reason) => {
    if (gatewayState.state === "connected") setGatewayState("disconnected", { code, reason });
  },
  onEvent: handleGatewayEvent,
});

async function gatewayRequest(method, params) {
  try {
    return await gateway.request(method, params);
  } catch (err) {
    broadcast({ type: "error", message: `${method}: ${err.message}` });
    return undefined;
  }
}

// ---------------------------------------------------------------- local server

const server = new WebSocketServer({
  host: "127.0.0.1",
  port: BRIDGE_PORT,
  // Blocks drive-by connections from arbitrary web pages.
  verifyClient: ({ origin }) => !origin || ALLOWED_ORIGINS.has(origin),
});

server.on("listening", () => log(`listening on ws://127.0.0.1:${BRIDGE_PORT}`));
server.on("error", (err) => {
  log(`bridge server error: ${err.message}`);
  if (err.code === "EADDRINUSE") process.exit(1);
});

server.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(gatewayState));
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "send" && typeof msg.text === "string" && msg.text.trim()) {
      await gatewayRequest("chat.send", {
        sessionKey: SESSION_KEY,
        message: msg.text,
        idempotencyKey: crypto.randomUUID(),
      });
    } else if (msg.type === "abort") {
      await gatewayRequest("chat.abort", { sessionKey: SESSION_KEY });
    } else if (msg.type === "history") {
      const res = await gatewayRequest("chat.history", { sessionKey: SESSION_KEY, limit: 20 });
      const messages = (res?.messages ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, text: messageText(m) }))
        .filter((m) => m.text);
      ws.send(JSON.stringify({ type: "history", messages }));
    }
  });
});

gateway.start();

const shutdown = () => {
  gateway.stop();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Tauri closes our stdin when the app exits; treat that as shutdown.
if (process.env.ENE_EXIT_ON_STDIN_CLOSE === "1") {
  process.stdin.on("end", shutdown);
  process.stdin.resume();
}
