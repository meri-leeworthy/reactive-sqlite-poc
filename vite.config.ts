import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import arraybuffer from "vite-plugin-arraybuffer";

const allowDir = `/var/${process.env.HOME}/.local/share/pnpm`;
export default defineConfig({
  plugins: [sveltekit(), tailwindcss(), arraybuffer(), wasm(), topLevelAwait()],
  server: {
    host: "127.0.0.1", // matching your dev script
    fs: {
      allow: [allowDir],
    },
    headers: {
      // added to support SQLite in Workers
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2048,
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
});
