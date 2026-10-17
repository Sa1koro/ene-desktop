import { ChibiAvatar } from "./avatar/chibi";
import type { Avatar } from "./avatar/types";
import { loadVrmAvatar } from "./avatar/vrm";
import { BridgeClient } from "./bridge";
import { Director } from "./director";
import { Stage } from "./stage";
import { Bubble, ChatInput, Chip, ContextMenu } from "./ui";
import { mmd, vrm } from "virtual:models";
import "./styles.css";

const isTauri = "__TAURI_INTERNALS__" in window;
// Whatever model sits in public/models, found at build time (scripts/models.mjs): the
// app can't probe for it, since Tauri serves .pmx files as text/html like a 404 page.
const MMD_URL = mmd && encodeURI(mmd);
const VRM_URL = vrm && encodeURI(vrm);

const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const chibi = new ChibiAvatar();
const stage = new Stage(canvas, chibi);
const bubble = new Bubble();
const chip = new Chip();

let director: Director;
const bridge = new BridgeClient((event) => director.handle(event));
const input = new ChatInput(
  (text) => {
    if (bridge.say(text)) director.userSent(text);
    else chip.set("bridge 未连接，消息没发出去", "warn");
  },
  () => bridge.abort(),
);
director = new Director(chibi, stage, bubble, chip, input);
stage.onTick((dt, t) => director.tick(dt, t));
stage.start();
bridge.connect();

// Swap in a model body if one sits in public/models: the MMD model first, then a VRM.
async function loadModelBody(): Promise<Avatar | null> {
  if (MMD_URL) {
    try {
      // Loaded on demand: the loader and Ammo physics are ~2 MB the chibi doesn't need.
      const { loadMmdAvatar } = await import("./avatar/mmd");
      return await loadMmdAvatar(MMD_URL);
    } catch (err) {
      console.warn("MMD load failed, trying VRM", err);
    }
  }
  if (VRM_URL) return loadVrmAvatar(VRM_URL);
  return null;
}

loadModelBody()
  .then((body) => {
    if (!body) return;
    stage.setAvatar(body);
    director.setAvatar(body);
    if (import.meta.env.DEV) Object.assign(window, { ene: { avatar: body, director, stage } });
  })
  .catch((err) => console.warn("Model load failed, keeping chibi ENE", err));

// Eyes follow the pointer; head sits roughly 40% from the top of the window.
window.addEventListener("pointermove", (e) => {
  const x = (e.clientX / window.innerWidth) * 2 - 1;
  const y = -((e.clientY / window.innerHeight - 0.4) * 2);
  director.pointer(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
});

// Click = poke ENE; press-and-drag = move the window.
let press: { x: number; y: number; dragging: boolean } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 0) press = { x: e.clientX, y: e.clientY, dragging: false };
});
canvas.addEventListener("pointermove", async (e) => {
  if (!press || press.dragging) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) {
    press.dragging = true;
    if (isTauri) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    }
  }
});
canvas.addEventListener("pointerup", () => {
  if (press && !press.dragging) director.poke();
  press = null;
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !input.isOpen) input.open();
});

let alwaysOnTop = true;
new ContextMenu(() => [
  { label: "💬 聊天", action: () => input.open() },
  ...(isTauri
    ? [
        {
          label: alwaysOnTop ? "📌 取消置顶" : "📌 置顶",
          action: async () => {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            alwaysOnTop = !alwaysOnTop;
            await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
          },
        },
      ]
    : []),
  { label: "🔄 重新加载", action: () => location.reload() },
  ...(isTauri
    ? [
        {
          label: "👋 退出",
          action: async () => {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().close();
          },
        },
      ]
    : []),
]);
