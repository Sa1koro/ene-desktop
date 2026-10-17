// Packs the chat bridge for release builds, so ENE.exe can chat on computers without
// Node.js or this project: bridge/ene-bridge.mjs and its dependencies become a single
// file, shipped with a copy of the Node.js that runs this script. scripts/launch.mjs hands
// both to `tauri build` as resources, which land in a bridge/ folder next to the exe;
// src-tauri/src/main.rs starts the bridge from there.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "rolldown";

/**
 * Builds the bridge into `<root>/src-tauri/target/ene-bridge/` and returns the Tauri
 * `bundle.resources` map for it (sources relative to src-tauri/, targets relative to the exe).
 * @param {string} root project root
 * @returns {Promise<Record<string, string>>}
 */
export async function bundleBridge(root) {
  const out = join(root, "src-tauri", "target", "ene-bridge");
  const node = process.platform === "win32" ? "node.exe" : "node";
  mkdirSync(out, { recursive: true });
  await build({
    input: join(root, "bridge", "ene-bridge.mjs"),
    platform: "node",
    // Optional native add-ons of ws: it loads them if present and works without them.
    external: ["bufferutil", "utf-8-validate"],
    output: { file: join(out, "ene-bridge.cjs"), format: "cjs" },
  });
  // The official Windows node.exe is self-contained and keeps its OpenJS Foundation signature.
  copyFileSync(process.execPath, join(out, node));
  return {
    "target/ene-bridge/ene-bridge.cjs": "bridge/ene-bridge.cjs",
    [`target/ene-bridge/${node}`]: `bridge/${node}`,
  };
}
