import { defineConfig, type Plugin } from "vite";
import { findModels } from "./scripts/models.mjs";

// Tells the app which character model and VMD motions sit in public/models (as
// `virtual:models`), so dropping files in works without editing code.
function models(): Plugin {
  const id = "\0virtual:models";
  let root = process.cwd();
  return {
    name: "ene-models",
    configResolved: (config) => void (root = config.root),
    resolveId: (source) => (source === "virtual:models" ? id : undefined),
    load(moduleId) {
      if (moduleId !== id) return;
      const found = findModels(root);
      return Object.entries(found)
        .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};\n`)
        .join("");
    },
    configureServer(server) {
      // A model added or removed while the dev server runs shows up on the next reload.
      const refresh = (file: string) => {
        if (!/[\\/]public[\\/]models[\\/]/.test(file)) return;
        const mod = server.moduleGraph.getModuleById(id);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);
    },
  };
}

// Tauri expects a fixed dev port; the bridge allowlists this origin.
export default defineConfig({
  clearScreen: false,
  plugins: [models()],
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    // The lazily loaded MMD chunk is ~2 MB, almost all of it Ammo.js physics.
    chunkSizeWarningLimit: 2100,
  },
});
