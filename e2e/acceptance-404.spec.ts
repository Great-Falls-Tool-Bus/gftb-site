import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './support/fixtures';
import { installExternalGuard } from './support/network';

// Acceptance row (§3): a missing path is answered with a real, branded body —
// and with the same body whether or not the client runs scripts.
//
// The regression this guards is specific. adapter-static was configured with an
// SPA fallback, so `build/404.html` was a shell rendered with `ssr: false`: no
// title, no heading, no link home, an empty <body>. A scriptless visitor saw
// exactly what the zero-byte 404 gave them. `src/routes/404` is now a
// prerendered route with `csr = false`, so those bytes ARE the page.
//
// The serving side of the same behaviour is written twice — `handle_errors` in
// flake.nix (what the image runs) and `_StaticPreviewHandler.send_error` in
// scripts/bazel_output.py (what this suite measures). These tests hold the
// preview half; scripts/test-bazel-cutover-contracts.py pins the two texts
// against each other so neither can be edited away in silence.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// /log and /contact left this fixture with addendum B1: they are real pages
// now. /tools stays missing on purpose — that surface is platform-owned
// (ADR 0014 §1) and must never appear here.
const MISSING_PATHS = ['/nope', '/tools', '/cells', '/keyholders', '/a/b/c.html', '/log/not-a-post'];

test.describe('a missing path', () => {
	test('answers 404 with a real body, with scripts disabled', async ({ browser, baseUrl }) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();
		await installExternalGuard(page, baseUrl);

		for (const missing of MISSING_PATHS) {
			const response = await page.goto(missing);
			expect(response?.status(), `status for ${missing}`).toBe(404);

			// The body, not the shell. A fallback shell passes a byte-count check
			// and fails every one of these.
			await expect(page.getByRole('heading', { name: 'That page is not here.', level: 1 })).toBeVisible();
			await expect(page.getByRole('link', { name: 'Back to the front page' })).toHaveAttribute('href', '/');
			expect(await page.title(), `title for ${missing}`).toBe('Page not found · Great Falls Tool Bus');

			const bodyText = ((await page.locator('body').innerText()) ?? '').trim();
			expect(bodyText.length, `rendered body text for ${missing}`).toBeGreaterThan(100);
		}

		await context.close();
	});

	test('renders identically with scripts enabled', async ({ page, baseUrl }) => {
		await installExternalGuard(page, baseUrl);
		const response = await page.goto('/nope');
		expect(response?.status()).toBe(404);
		await expect(page.getByRole('heading', { name: 'That page is not here.', level: 1 })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Back to the front page' })).toHaveAttribute('href', '/');
		expect(await page.title()).toBe('Page not found · Great Falls Tool Bus');
	});

	test('is kept out of the index and claims no canonical URL', async ({ page, baseUrl }) => {
		await installExternalGuard(page, baseUrl);
		await page.goto('/nope');

		// The layout renders SEOHead for every route, so the assertion is that
		// exactly one robots meta exists and it is the restrictive one — the
		// previous shape emitted the layout's `index, follow` alongside the error
		// page's own tag, and the layout's won.
		const robots = page.locator('meta[name="robots"]');
		await expect(robots).toHaveCount(1);
		await expect(robots).toHaveAttribute('content', 'noindex, nofollow');
		await expect(page.locator('title')).toHaveCount(1);

		// A canonical on a 404 is a soft-404 signal, and one pointing at the home
		// page tells a crawler the missing URL IS the home page.
		await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
		await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
	});

	test('does not shadow anything the site actually serves', async ({ page, baseUrl }) => {
		await installExternalGuard(page, baseUrl);

		for (const [servedPath, expectedType] of [
			['/', 'text/html'],
			['/robots.txt', 'text/plain'],
			['/sitemap.xml', 'xml'],
			['/qr/greatfallstoolbus-apex.svg', 'image/svg+xml'],
			['/photos/great-falls-lewiston-1930s-640.webp', 'image/webp'],
		] as const) {
			const response = await page.request.get(servedPath);
			expect(response.status(), `status for ${servedPath}`).toBe(200);
			expect(response.headers()['content-type'] ?? '', `content-type for ${servedPath}`).toContain(expectedType);
		}

		// The printed apex QR must survive this change byte for byte: it is on
		// physical signage and cannot be proofread by eye.
		const served = await (await page.request.get('/qr/greatfallstoolbus-apex.svg')).body();
		const committed = readFileSync(path.join(repoRoot, 'static/qr/greatfallstoolbus-apex.svg'));
		expect(Buffer.compare(served, committed), 'served QR differs from the committed artefact').toBe(0);
	});
});
