import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    // The indexer client and the ledger codecs are published for Node and
    // reach for assert, buffer and process on the way in.
    nodePolyfills({ include: ["assert", "buffer", "process", "util", "stream"] }),
  ],
  build: {
    // Top level await is used by the WebAssembly runtime and is supported by
    // every browser that can run this app, so it is left for the browser
    // rather than transformed away.
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes("onchain-runtime-v3") ? "midnight-runtime" : undefined,
      },
    },
  },
  optimizeDeps: {
    include: ["@midnight-ntwrk/compact-runtime"],
    exclude: ["@midnight-ntwrk/onchain-runtime-v3"],
    esbuildOptions: { target: "esnext" },
  },
  resolve: {
    alias: {
      // isomorphic-ws maps to a browser file with only a default export, while
      // the indexer client imports WebSocket by name.
      "isomorphic-ws": new URL("./src/shims/websocket.ts", import.meta.url).pathname,
    },
    mainFields: ["browser", "module", "main"],
  },
});
