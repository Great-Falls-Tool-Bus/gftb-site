import { defineConfig, devices } from '@playwright/test';

// PLAYWRIGHT_PORT exists so a run can be pointed at a preview server this
// worktree started itself. `reuseExistingServer` is true off CI, so a bare run
// silently attaches to whatever already holds the default port — which, on a
// machine running several worktrees at once, can be another branch's build.
// Overriding the port is how a lane proves it measured its OWN artefact.
// Unset, everything below is exactly what it was: port 3000, `just preview-e2e`.
const port = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '3000', 10);
const baseURL = `http://localhost:${port}`;
const webServerTimeout = process.env.CI ? 600_000 : 180_000;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? 'github' : 'list',
	timeout: 180_000,
	use: {
		baseURL,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		// The WebGPU rung on a headless rig: Chromium's headless shell exposes no
		// adapter by default, so a lane that wants the top rung measured runs this
		// project (PLAYWRIGHT_WEBGPU=1) and gets SwiftShader's. Off by default.
		...(process.env.PLAYWRIGHT_WEBGPU
			? [
					{
						name: 'chromium-webgpu',
						use: {
							...devices['Desktop Chrome'],
							launchOptions: {
								args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--enable-features=Vulkan'],
							},
						},
					},
				]
			: []),
		// Firefox + WebKit gated behind PLAYWRIGHT_ALL_BROWSERS to keep M0 fast.
		// Enable in M1 CI by setting PLAYWRIGHT_ALL_BROWSERS=1.
		...(process.env.PLAYWRIGHT_ALL_BROWSERS
			? [
					{
						name: 'firefox',
						use: { ...devices['Desktop Firefox'] },
					},
					{
						name: 'webkit',
						use: { ...devices['Desktop Safari'] },
					},
				]
			: []),
	],
	webServer: {
		command: `just preview-e2e ${port}`,
		port,
		timeout: webServerTimeout,
		reuseExistingServer: !process.env.CI,
	},
});
