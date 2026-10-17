// Finds the character model and VMD motions under public/models. vite.config.ts hands
// the result to the app as `virtual:models` and scripts/launch.mjs prints it, so files
// work wherever they are dropped in, under any name. (The app can't probe for them at
// runtime: Tauri serves file types it doesn't know, like .pmx and .vmd, as text/html,
// exactly like its fallback page for missing files.)
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * URL paths of the first .pmx (MMD) and first .vrm model under `<root>/public/models`
 * in sorted path order (or null), and the .vmd file names in its motions/ folder.
 * @param {string} root project root
 * @returns {{ mmd: string | null, vrm: string | null, motions: string[] }}
 */
export function findModels(root) {
  const dir = join(root, "public", "models");
  const files = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(`/models/${relative(dir, path).split(sep).join("/")}`);
    }
  };
  if (existsSync(dir)) walk(dir);
  files.sort();
  const first = (ext) => files.find((file) => file.toLowerCase().endsWith(ext)) ?? null;
  const motions = files
    .filter((file) => file.startsWith("/models/motions/") && file.toLowerCase().endsWith(".vmd"))
    .map((file) => file.slice("/models/motions/".length));
  return { mmd: first(".pmx"), vrm: first(".vrm"), motions };
}
