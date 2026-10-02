import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the enclosing Bazel harness supplies these values after opening its
// own loopback listener. No webServer, preview rebuild, or ambient base URL.
const baseURL = process.env.GF_BROWSER_ACCEPTANCE_BASE_URL;
const outputDir = process.env.GF_BROWSER_ACCEPTANCE_OUTPUT_DIR;
const executablePath = process.env.GF_RBE_CHROMIUM_EXECUTABLE;
// The harness's short browser-only TMPDIR, where Chromium binds its
// process-singleton socket; the 108-byte socket limit rules out the scratch.
const chromiumTmpdir = process.env.GF_BROWSER_ACCEPTANCE_CHROMIUM_TMPDIR;
const testDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!baseURL || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/u.test(baseURL) || !outputDir) {
	throw new Error('the declared-build browser harness must supply its loopback URL and scratch output');
}
if (executablePath !== '/bin/chromium') {
	throw new Error('the GF provisioned Chromium runtime is required');
}
if (!chromiumTmpdir || !/^\/tmp\/gftb-chromium-[^/]+$/u.test(chromiumTmpdir)) {
	throw new Error('the declared-build browser harness must supply its short Chromium TMPDIR');
}

export default defineConfig({
	testDir,
	testMatch: [
		'acceptance-copy-deslop.spec.ts',
		'acceptance-no-js.spec.ts',
		'brand-vectors-permission.spec.ts',
		'home-goals.spec.ts',
		'home-hours.spec.ts',
		'mobile-nav.spec.ts',
	].map((name) => resolve(testDir, name)),
	fullyParallel: false,
	forbidOnly: true,
	retries: 0,
	workers: 1,
	reporter: 'list',
	timeout: 30_000,
	// About 80 tests run serially on one worker; a shared lab host needs more than
	// three minutes for the set. Per-test and per-action limits are unchanged.
	// Operator ruling 2026-10-02: eight canvas-reading tests may take 90 s each,
	// so the set gains 8 x 60 s; tracked in Linear under the canvas-reading tests issue.
	globalTimeout: 1_080_000,
	outputDir,
	updateSnapshots: 'none',
	use: {
		baseURL,
		actionTimeout: 10_000,
		navigationTimeout: 15_000,
		trace: 'off',
		screenshot: 'off',
		video: 'off',
		serviceWorkers: 'block',
		launchOptions: {
			executablePath,
			timeout: 15_000,
			env: { ...process.env, TMPDIR: chromiumTmpdir },
			args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'],
		},
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
