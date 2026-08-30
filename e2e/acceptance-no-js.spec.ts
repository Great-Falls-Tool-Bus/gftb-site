import { expect, test } from '@playwright/test';
import { CONTACT_URL, FORM_ORIGIN, installExternalGuard, stubChallenge } from './support/network';

// Acceptance row (§3): core content works with JavaScript disabled, and the
// JavaScript-enabled page logs no console errors.
//
// The site is prerendered by adapter-static, so "works without JavaScript" is a
// claim about the shipped HTML rather than about hydration. These tests assert
// the claim on a context that never runs a script.

test.describe('JavaScript disabled', () => {
	test.use({ javaScriptEnabled: false });

	test('the whole public narrative is present in the served HTML', async ({ page }) => {
		await page.goto('/');

		// Heading strings are interim placeholders pending Jess's final copy
		// (restoration PR-5); update in lockstep with src/routes/+page.svelte.
		await expect(page.getByRole('heading', { name: 'Great Falls Tool Bus', level: 1 })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Current status' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Next public work session' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Near-term goals' })).toBeVisible();
		// exact: the log entry's own title ("First public log entry") would
		// otherwise substring-match this heading query.
		await expect(page.getByRole('heading', { name: 'Public log', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Contact and discussion' })).toBeVisible();
	});

	test('the public log row and archive render their real state from the static build', async ({ page }) => {
		// Addendum B1.2: the homepage renders the newest of the four reviewed
		// entries and the archive renders the complete approved batch from the
		// prerendered artifact. The remaining published:false draft must not
		// leak into either surface.
		await page.goto('/');
		const latest = page.locator('.log-entry');
		await expect(latest).toHaveCount(1);
		const latestLink = latest.locator('h3 a');
		await expect(latestLink).toHaveText('We laugh, we graph, we diagramming the system');
		await expect(latestLink).toHaveAttribute('href', '/log/2026-08-14-the-system-in-diagrams');

		await page.goto('/log');
		await expect(page.locator('.log-list li')).toHaveCount(4);
		const html = await page.content();
		expect(html).not.toContain('Mapping MVP, V0 and beyond');
	});

	test('navigation, images and the printed address all work without scripts', async ({ page }) => {
		await page.goto('/');
		// The nav SSOT renders two primary items (Log, Contact) — B1.3.
		await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(2);

		const broken = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"], a[href^="/#"]'))
				.map((anchor) => anchor.getAttribute('href') ?? '')
				.map((href) => (href.startsWith('/#') ? href.slice(1) : href))
				.filter((hash) => hash.length > 1 && !document.querySelector(hash)),
		);
		expect(broken).toEqual([]);

		// The printed QR rides the contact page (B1.4).
		await page.goto('/contact');
		await expect(page.locator('img.qr')).toHaveAttribute('src', '/qr/greatfallstoolbus-apex.svg');
		await expect(page.getByText('greatfallstoolbus.org')).toBeVisible();
	});

	test('the contact form degrades to a plain POST plus an email fallback', async ({ page }) => {
		await page.goto('/contact');
		const form = page.locator('form.contact-form');
		await expect(form).toHaveAttribute('method', 'post');
		await expect(form).toHaveAttribute('action', CONTACT_URL);
		await expect(form.locator('#contact-name')).toHaveAttribute('required', '');
		await expect(form.locator('#contact-email')).toHaveAttribute('type', 'email');

		// The <noscript> fallback is inert markup to Playwright's DOM query, so
		// assert on its source rather than on visibility.
		const html = await page.content();
		expect(html).toContain('<noscript>');
		expect(html).toContain('mailto:keyholders@latoolb.us');
		expect(html).toContain('if JavaScript is unavailable');
	});

	test('no script-only content is load bearing', async ({ page }) => {
		await page.goto('/');
		// Nothing on the page may start hidden and wait for hydration to appear.
		const hiddenSections = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('section, main, header, footer'))
				.filter((element) => {
					const style = getComputedStyle(element);
					return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
				})
				.map((element) => element.id || element.tagName.toLowerCase()),
		);
		expect(hiddenSections).toEqual([]);
	});
});

test.describe('JavaScript enabled', () => {
	test('the page loads with a clean console', async ({ page, baseURL }) => {
		const consoleErrors: string[] = [];
		const pageErrors: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') {
				consoleErrors.push(`${message.type()}: ${message.text()}`);
			}
		});
		page.on('pageerror', (error) => pageErrors.push(error.message));

		const guard = await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		expect(pageErrors, 'uncaught page errors').toEqual([]);
		expect(consoleErrors, 'console errors and warnings').toEqual([]);
		// The only third party the page may talk to is the contact API origin.
		for (const url of guard.attempted) expect(url.startsWith(FORM_ORIGIN)).toBe(true);
	});

	test('no request leaves the page for an unexpected origin', async ({ page, baseURL }) => {
		const requested: string[] = [];
		page.on('request', (request) => requested.push(request.url()));
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);

		// The root page talks to nobody: the form (and its ALTCHA challenge
		// fetch) moved to /contact (B1.4).
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const rootOrigins = new Set(requested.map((url) => new URL(url).origin));
		rootOrigins.delete(new URL(baseURL ?? 'http://localhost:3000').origin);
		expect([...rootOrigins]).toEqual([]);

		// The contact page may talk to exactly the form origin.
		requested.length = 0;
		await page.goto('/contact');
		await page.waitForLoadState('networkidle');
		const contactOrigins = new Set(requested.map((url) => new URL(url).origin));
		contactOrigins.delete(new URL(baseURL ?? 'http://localhost:3000').origin);
		expect([...contactOrigins]).toEqual([FORM_ORIGIN]);
	});
});
