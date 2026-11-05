import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
export default defineConfig({
  resolve: {alias: {siyuan: fileURLToPath(new URL("./tests/host.ts", import.meta.url))}},
  test: {environment: "jsdom", include: ["tests/**/*.test.ts"], restoreMocks: true}
});
