import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/e2e", timeout: 90_000, workers: 1, use: { baseURL: "http://localhost:8787", headless: true, launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium" }, screenshot: "only-on-failure" } });
