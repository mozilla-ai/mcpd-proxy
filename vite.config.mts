import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    ssr: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "McpdProxy",
      fileName: () => "index",
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "@modelcontextprotocol/sdk",
        "@mozilla-ai/mcpd",
        /^node:/,
      ],
    },
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [
    dts({
      insertTypesEntry: true,
      copyDtsFiles: true,
    }),
  ],
});
