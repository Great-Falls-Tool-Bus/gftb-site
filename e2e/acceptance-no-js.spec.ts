import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

import { primaryNavItems } from '../src/lib/nav-items';
import { HOME_LOG_COUNT, publicLogs } from '../src/lib/public-logs';
import { CHALLENGE_URL, CONTACT_URL, FORM_ORIGIN, installExternalGuard, stubChallenge } from './support/network';
import { forceTierMax } from './support/wiper-tier';

async function unresolvedHomeHashes(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const hashes = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
			.map((anchor) => anchor.getAttribute('href') ?? '')
			.filter((href) => href.startsWith('/#') || href.startsWith('#'))
			.map((href) => (href.startsWith('/#') ? href.slice(1) : href));
		return [...new Set(hashes)].filter((hash) => hash.length > 1 && !document.querySelector(hash));
	});
}

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
		await expect(page.getByRole('heading', { name: 'Public work sessions' })).toBeVisible();
		await expect(page.locator('.hero .hero-session')).toContainText('Thursdays, about 3 to 5 PM ET');
		await expect(page.locator('.hero .hero-session').getByText(/Thursdays, about 3 to 5 PM ET/u)).toHaveCount(1);
		await expect(page.getByRole('heading', { name: 'Notes & Goals' })).toBeVisible();
		// exact: the log entry's own title ("First public log entry") would
		// otherwise substring-match this heading query.
		await expect(page.getByRole('heading', { name: 'Public log', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'History', exact: true })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Contact and discussion' })).toBeVisible();
	});

	test('the public log row and archive render their real state from the static build', async ({ page }) => {
		// Addendum B1.2 rendered the newest reviewed entry alone; operator
		// ruling 2026-09-01: latest five minified logs on home — the homepage
		// now renders min(5, published) citation rows, newest first, and the
		// archive still renders the complete approved batch from the
		// prerendered artifact. The remaining published:false draft must not
		// leak into either surface. Counts and ordering derive from the
		// manifest-driven loader so they cannot drift as entries publish.
		const expectedRows = publicLogs.slice(0, HOME_LOG_COUNT);
		await page.goto('/');
		const rows = page.locator('.log-entry');
		await expect(rows).toHaveCount(Math.min(HOME_LOG_COUNT, publicLogs.length));
		for (const [index, entry] of expectedRows.entries()) {
			const row = rows.nth(index);
			const titleLink = row.locator('h3 a');
			await expect(titleLink).toHaveText(entry.metadata.title);
			await expect(titleLink).toHaveAttribute('href', `/log/${entry.slug}`);
			// Operator ruling 2026-08-30: each home row is a citation with a
			// read-more link (scope superseded 2026-09-01: five rows, not one;
			// the citation form stands).
			await expect(row.getByRole('link', { name: 'Read the full entry' })).toHaveAttribute(
				'href',
				`/log/${entry.slug}`,
			);
			// Each title renders exactly once on the homepage.
			await expect(page.getByRole('heading', { level: 3, name: entry.metadata.title, exact: true })).toHaveCount(1);
			// Featured-image home integration (the 2026-09-01 batch's deferred
			// item) evolves the 2026-08-30 no-body-media pin: an entry that
			// ships the frontmatter image group renders exactly that archive
			// thumb and alt text; an imageless entry still ships NO media markup.
			// The citation form and never-inline-body clauses stand — the
			// thumb is entry metadata, and every expectation derives from the
			// manifest so this pin stays honest as entries gain or lose images.
			const media = row.locator('.featured-image--thumb');
			if (entry.metadata.image) {
				const expectedAlt = entry.metadata.image_alt ?? '';
				expect(expectedAlt).not.toBe('');
				await expect(media).toHaveCount(1);
				const image = media.locator('img');
				await expect(image).toHaveCount(1);
				await expect(image).toHaveAttribute('src', entry.metadata.image);
				await expect(image).toHaveAttribute('alt', expectedAlt);
			} else {
				await expect(media).toHaveCount(0);
				await expect(row.locator('img')).toHaveCount(0);
			}
		}
		await expect(rows.locator('img')).toHaveCount(
			expectedRows.filter((entry) => entry.metadata.image !== undefined).length,
		);

		await page.goto('/log');
		await expect(page.locator('.log-list li')).toHaveCount(publicLogs.length);
		const html = await page.content();
		expect(html).not.toContain('Mapping MVP, V0 and beyond');
	});

	test('navigation, images and the printed address all work without scripts', async ({ page }) => {
		await page.goto('/');
		// The nav SSOT's primary items (Log, Contact, GitHub since the operator
		// ruling of 2026-08-31, Discussion archive since the operator ruling of
		// 2026-09-01); the count derives from the SSOT so it cannot drift.
		const headerLinks = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link');
		await expect(headerLinks).toHaveCount(primaryNavItems.length);
		await expect(headerLinks).toHaveText(['Log', 'Contact', /^GitHub/u, /^Discussion archive/u]);

		expect(await unresolvedHomeHashes(page), 'scriptless home hash targets without matching elements').toEqual([]);

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
	// The console gate runs twice: once as the browser is (the top rung the
	// ladder can reach), once capped at WebGL2 from outside. Two exemptions,
	// each by exact shape: headless Chromium on software GL relays its own
	// driver performance notices through the page console, and a headless
	// shell with no WebGPU adapter says so once when the ladder asks; a GPU
	// browser emits neither and neither is the page's doing. The capped run
	// never asks for an adapter, so it carries the first exemption only.
	const cleanConsole = async (
		page: Page,
		baseUrl: string,
		options: { cap?: 'webgl2'; allowAdapterNotice: boolean },
	) => {
		const consoleErrors: string[] = [];
		const pageErrors: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') {
				if (message.type() === 'warning' && /GL Driver Message \(OpenGL, Performance,/u.test(message.text())) return;
				if (options.allowAdapterNotice && message.type() === 'warning' && message.text() === 'No available adapters.')
					return;
				consoleErrors.push(`${message.type()}: ${message.text()}`);
			}
		});
		page.on('pageerror', (error) => pageErrors.push(error.message));

		if (options.cap) await forceTierMax(page, options.cap);
		const guard = await installExternalGuard(page, baseUrl);
		await stubChallenge(page);
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		// Bring the Notes & Goals scene into view and let it run: the strongest
		// console gate on the site must cover the renderer, not only the load.
		await page.locator('#goals').scrollIntoViewIfNeeded();
		await page.waitForTimeout(2000);

		expect(await unresolvedHomeHashes(page), 'hydrated home hash targets without matching elements').toEqual([]);
		expect(pageErrors, 'uncaught page errors').toEqual([]);
		expect(consoleErrors, 'console errors and warnings').toEqual([]);
		// The only third party the page may talk to is the contact API origin.
		for (const url of guard.attempted) expect(url.startsWith(FORM_ORIGIN)).toBe(true);
	};

	test('the page loads with a clean console', async ({ page, baseUrl }) => {
		await cleanConsole(page, baseUrl, { allowAdapterNotice: true });
	});

	test('the page loads with a clean console capped at WebGL2', async ({ page, baseUrl }) => {
		await cleanConsole(page, baseUrl, { cap: 'webgl2', allowAdapterNotice: false });
	});

	test('no request leaves the page for an unexpected origin', async ({ page, baseUrl }) => {
		const requested: string[] = [];
		page.on('request', (request) => requested.push(request.url()));
		await installExternalGuard(page, baseUrl);
		await stubChallenge(page);

		// The root page talks to nobody: the form (and its ALTCHA challenge
		// fetch) moved to /contact (B1.4).
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const rootOrigins = new Set(requested.map((url) => new URL(url).origin));
		rootOrigins.delete(new URL(baseUrl).origin);
		expect([...rootOrigins]).toEqual([]);

		// The contact page may talk to exactly the form origin.
		requested.length = 0;
		// Idle can precede hydration and its auto=onload challenge fetch.
		const challenge = page.waitForRequest((request) => request.url() === CHALLENGE_URL && request.method() === 'GET');
		await Promise.all([challenge, page.goto('/contact')]);
		await page.waitForLoadState('networkidle');
		const contactOrigins = new Set(requested.map((url) => new URL(url).origin));
		contactOrigins.delete(new URL(baseUrl).origin);
		expect([...contactOrigins]).toEqual([FORM_ORIGIN]);
	});
});
