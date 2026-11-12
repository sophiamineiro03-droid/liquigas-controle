import { defineConfig } from '@playwright/test';
const staticPreview = process.env.STATIC_PREVIEW === '1';
export default defineConfig({
  testDir: './tests-browser',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3100', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] } },
  webServer: { command: staticPreview ? 'python3 -m http.server 3100 --bind 127.0.0.1 --directory public' : 'PORT=3100 npm start', url: staticPreview ? 'http://127.0.0.1:3100/' : 'http://127.0.0.1:3100/api/health', reuseExistingServer: false },
});
