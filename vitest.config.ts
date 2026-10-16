import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({ resolve: { alias: { siyuan: fileURLToPath(new URL("./tests/siyuan-host.ts", import.meta.url)) } }, test: { environment: "node", include: ["tests/**/*.test.ts"], restoreMocks: true } });
