import { defineConfig } from "vitest/config";

// Vite (開発サーバ・ビルド) と Vitest (テスト) の共通設定
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // CodeMirror を含むため 500 kB を超える。単一ページアプリなので分割しない
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
