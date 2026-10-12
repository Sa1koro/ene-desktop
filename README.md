# ENE Desktop

A desktop-pet body for the OpenClaw **ENE** agent. ENE floats on your desktop in a
transparent, always-on-top window, talks in comic speech bubbles, changes expression
sentence by sentence, and acts out what her OpenClaw brain is doing: she dives into the
network while searching, types furiously while running commands, and strikes a
victory pose when a tool-assisted answer lands.

```
┌──────────── Tauri window (transparent) ────────────┐
│  three.js stage  ← Director ← BridgeClient (ws)    │
│  ChibiAvatar | VrmAvatar                           │
└───────────────────────────┬────────────────────────┘
                            │ ws://127.0.0.1:18790 (origin-checked)
                ┌───────────┴───────────┐
                │ bridge/ene-bridge.mjs │  Ed25519 device identity,
                │  @openclaw/gateway-   │  gateway token never reaches
                │  client (Node)        │  the webview
                └───────────┬───────────┘
                            │ ws://127.0.0.1:18789  (Gateway protocol v4)
                     OpenClaw Gateway → ENE agent (memory, tools, persona)
```

## Run it

Requirements: Node 22+, Rust + MSVC build tools, WebView2 (all present on vr03), and a
running OpenClaw gateway on this machine.

```bash
npm install
npm run tauri dev
```

`tauri dev` starts Vite and the window, and the window starts the bridge. Browser-only
development also works: run `npm run bridge` and `npm run dev` in two terminals, then
open http://127.0.0.1:1420.

The first connection registers a device called **ENE Desktop** with the gateway. On
loopback it is approved automatically; from another machine you will see a chip saying
`openclaw devices approve <id>`.

### Controls

| Action | Result |
|---|---|
| Click ENE | Poke her / open chat (poke 3× fast at your own risk) |
| Drag ENE | Move the window |
| Enter / Esc | Open / close the chat box |
| ■ button | Stop the current run (`chat.abort`) |
| Right-click | Menu: chat, toggle always-on-top, reload, quit |

### Bridge settings (env vars)

| Variable | Default |
|---|---|
| `ENE_SESSION_KEY` | `agent:main:main` (same conversation as webchat) |
| `ENE_GATEWAY_URL` | `ws://127.0.0.1:18789` |
| `ENE_BRIDGE_PORT` | `18790` |
| `OPENCLAW_GATEWAY_TOKEN` | read from `~/.openclaw/openclaw.json` |
| `ENE_STATE_DIR` | `%APPDATA%\ene-desktop` (device key + issued token) |

## Expressions

ENE's mood comes from two sources:

1. **Emotion tags** she writes inline: `[happy]`, `[excited]`, `[smug]`, `[angry]`,
   `[surprised]`, `[sad]`, `[thinking]` (plus aliases like `[pout]`, `[grin]`). Tags are
   stripped before display and switch her face at that exact point in the sentence.
2. **Heuristics** when a sentence has no tag: emoji, kaomoji and verbal tics such as
   `☆`, `😏`, `笨蛋`, `呜`, `欸？！`.

Heuristics alone already work. To get deliberate acting, add something like this to the
agent's workspace (for example `AGENTS.md`):

```md
## Desktop body
When chatting through ENE Desktop, you may start a sentence with one emotion tag:
[happy] [excited] [smug] [angry] [surprised] [sad] [thinking]. Use them sparingly,
only when your mood actually changes. They are hidden from the user.
```

## Bodies

- **ChibiAvatar** (default) is built entirely from primitives: toon shading, ink
  outlines, a canvas-painted anime face with 8 expressions, spring-simulated twin tails
  and glowing headphones. It needs no downloads and has no licensing questions.
- **VrmAvatar** loads `public/models/ene.vrm` automatically if it exists. Make one in
  VRoid Studio (free) and export VRM 1.0. Expressions map onto VRM presets and the hair
  uses the model's own spring bones. `*.vrm` is git-ignored: ENE belongs to the Kagerou
  Project, so keep fan-made models private.

Both implement `src/avatar/types.ts`, so a Live2D body can be added later.

## Layout

```
bridge/ene-bridge.mjs   Gateway connection + local WS protocol
src/director.ts         events → speech, mood, poses, idle life
src/emotion.ts          tag parsing, mood heuristics, markdown → speech
src/avatar/chibi.ts     procedural ENE
src/avatar/face.ts      canvas-painted anime face
src/avatar/vrm.ts       VRM body
src/stage.ts            three.js scene, hologram base, sparkles
src/ui.ts               bubble, activity chip, chat input, context menu
src-tauri/              transparent window + bridge process lifecycle
```

## Roadmap

- [x] Phase 1: desktop pet, emotion system, chat, tool-call animations
- [ ] Phase 2: voice. faster-whisper STT + GPT-SoVITS/CosyVoice TTS on the lab
      GTX 1080s, with lip sync from audio amplitude
- [ ] Phase 3: proactive behaviour from heartbeats and cron, approvals UI
- [ ] Phase 4: Live2D body, bundling the bridge as a Tauri sidecar for installers

Note: release installers (`tauri build`) don't bundle the bridge yet. They expect
`node` on PATH and either this checkout or `ENE_BRIDGE_SCRIPT` pointing to the bridge.
