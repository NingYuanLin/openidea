import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
  testMatch: "terminalScroll.spec.ts",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
          : {},
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
