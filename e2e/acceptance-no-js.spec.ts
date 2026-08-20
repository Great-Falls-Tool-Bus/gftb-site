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

		await expect(page.getByRole('heading', { name: 'Tools belong in motion.', level: 1 })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Building, not lending yet.' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Waterproofing + measurements' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'A useful thing, built in understandable steps.' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'What changed, in plain language.' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'A name shaped by this place.' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Bring a question, a skill, or a tool story.' })).toBeVisible();
	});

	test('the latest public log renders from the static build', async ({ page }) => {
		await page.goto('/');
		const log = page.locator('.log-entry');
		await expect(log).toBeVisible();
		await expect(log.locator('.log-entry__header h3')).not.toBeEmpty();
		await expect(log.locator('.log-entry__body')).not.toBeEmpty();
		// Tags are frontmatter-only since the de-slop strip (restoration PR-4):
		// the schema still requires them, but the page no longer renders chips.
		await expect(log.getByLabel('Log tags')).toHaveCount(0);
	});

	test('navigation, images and the printed address all work without scripts', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(3);
		await expect(page.locator('img.qr')).toHaveAttribute('src', '/qr/greatfallstoolbus-apex.svg');
		await expect(page.getByText('greatfallstoolbus.org')).toBeVisible();

		const broken = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"], a[href^="/#"]'))
				.map((anchor) => anchor.getAttribute('href') ?? '')
				.map((href) => (href.startsWith('/#') ? href.slice(1) : href))
				.filter((hash) => hash.length > 1 && !document.querySelector(hash)),
		);
		expect(broken).toEqual([]);
	});

	test('the contact form degrades to a plain POST plus an email fallback', async ({ page }) => {
		await page.goto('/');
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
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		const origins = new Set(requested.map((url) => new URL(url).origin));
		origins.delete(new URL(baseURL ?? 'http://localhost:3000').origin);
		expect([...origins]).toEqual([FORM_ORIGIN]);
	});
});
