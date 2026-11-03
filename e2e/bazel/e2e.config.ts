import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// //:e2e_test (R583, TIN-7477): every e2e spec against Bazel's declared
// //:build, with the Chromium that //tools/chromium resolves (the Nix store
// Chromium on a lab host). It keeps the discipline of
// browser-acceptance.config.ts: only the enclosing harness supplies the
// loopback base URL and the scratch output; no webServer, no preview rebuild,
// no ambient base URL, no browser download.
const baseURL = process.env.GF_BROWSER_ACCEPTANCE_BASE_URL;
const outputDir = process.env.GF_BROWSER_ACCEPTANCE_OUTPUT_DIR;
const executablePath = process.env.GF_E2E_CHROMIUM_EXECUTABLE;
// The harness's short browser-only TMPDIR (the 108-byte socket limit).
const chromiumTmpdir = process.env.GF_BROWSER_ACCEPTANCE_CHROMIUM_TMPDIR;
const testDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!baseURL || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/u.test(baseURL) || !outputDir) {
	throw new Error('the declared-build browser harness must supply its loopback URL and scratch output');
}
if (!executablePath || !executablePath.startsWith('/')) {
	throw new Error('the resolved Chromium toolchain executable is required');
}
if (!chromiumTmpdir || !/^\/tmp\/gftb-chromium-[^/]+$/u.test(chromiumTmpdir)) {
	throw new Error('the declared-build browser harness must supply its short Chromium TMPDIR');
}

// Every e2e/*.spec.ts, by name. //:bazel_output_contract_test fails when this
// list and the directory differ (the spec census), so a new spec cannot skip
// the Bazel lane.
export const E2E_SPECS = [
	'acceptance-404.spec.ts',
	'acceptance-contact.spec.ts',
	'acceptance-contrast.spec.ts',
	'acceptance-contribute-menu.spec.ts',
	'acceptance-copy-deslop.spec.ts',
	'acceptance-hero-glass-contrast.spec.ts',
	'acceptance-legal.spec.ts',
	'acceptance-mode-switch.spec.ts',
	'acceptance-motion-keyboard.spec.ts',
	'acceptance-no-js.spec.ts',
	'acceptance-print.spec.ts',
	'acceptance-public-log.spec.ts',
	'acceptance-responsive.spec.ts',
	'acceptance-reveal.spec.ts',
	'acceptance-sharp-edges.spec.ts',
	'brand-vectors-permission.spec.ts',
	'footer.spec.ts',
	'hero-parallax.spec.ts',
	'home-goals.spec.ts',
	'home-hours.spec.ts',
	'home-intro.spec.ts',
	'home-join-path.spec.ts',
	'home-rsvp.spec.ts',
	'mobile-nav.spec.ts',
	'subscribe-capture.spec.ts',
	'tailnet-prompt.spec.ts',
	'wiper-parity.spec.ts',
];

export default defineConfig({
	testDir,
	testMatch: E2E_SPECS.map((name) => resolve(testDir, name)),
	fullyParallel: false,
	forbidOnly: true,
	retries: 0,
	workers: 1,
	reporter: 'list',
	// The per-test limit of the retired host playwright.config.ts.
	timeout: 180_000,
	globalTimeout: 3_300_000,
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
