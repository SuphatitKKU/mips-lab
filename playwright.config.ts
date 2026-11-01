import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:8788",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx wrangler pages dev dist --port 8788 --ip 127.0.0.1",
    url: "http://127.0.0.1:8788/api/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
