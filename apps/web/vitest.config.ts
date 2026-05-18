import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react"
    }
  },
  test: {
    environment: "node",
    globals: true,
    exclude: ["node_modules", "dist", ".next", "e2e/**"]
  }
});
