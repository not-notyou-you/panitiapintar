import { defineConfig, devices } from "@playwright/test";

// E2E (TESTING §3). The app runs with AI_MOCK=true: no real Gemini call in automated tests.
// Needs local Supabase with the seed loaded (`npx supabase db reset`).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    // Mobile-first: 360 px is the reference width (INTERFACE §4.1).
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 760 } } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { NEXT_DIST_DIR: ".next-e2e", AI_MOCK: "true", APP_URL: BASE_URL, LOG_LEVEL: "info" },
  },
});
