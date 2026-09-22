import {origin} from "./tests/e2e/local.ts";
import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/e2e", timeout: origin.startsWith("https:") ? 180_000 : 90_000, expect: { timeout: origin.startsWith("https:") ? 15_000 : 5_000 }, workers: 1, use: { actionTimeout: 15000, baseURL: origin, headless: true, launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}, screenshot: "only-on-failure" } });
