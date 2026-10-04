import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  testMatch: "**/*.spec.ts",
  timeout: 60000,
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    headless: true,
  },
  webServer: {
    command: "npm run start -- --port 3001",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: true,
    env: {
      FORMSYNC_DATA_DIR: process.env.FORMSYNC_DATA_DIR || ".tools/qa-data",
    },
  },
  reporter: "list",
  outputDir: ".tools/test-results",
});
