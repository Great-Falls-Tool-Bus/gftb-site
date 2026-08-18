import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * QA-evidence variant of the CI Playwright config.
 *
 * Same testDir, same projects, same timeouts — the only difference is that this
 * one starts no web server. `just qa-packet` already has the preview running on
 * a port it chose, and starting a second server on the CI port would either
 * fight another lane for it or quietly reuse whatever is already listening
 * there, which is the one thing an evidence packet must never do.
 *
 * playwright.config.ts is untouched on purpose: CI reads that file, and this
 * file has no path into it.
 */
const baseURL = process.env.QA_PACKET_BASE_URL;
if (!baseURL) {
	throw new Error('QA_PACKET_BASE_URL is required. Run the acceptance suite through `just qa-packet`.');
}

export default defineConfig({
	...base,
	webServer: undefined,
	use: { ...base.use, baseURL },
});
