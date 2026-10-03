import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
	JOIN_PATH,
	MEMBER_APP_ORIGIN,
	MEMBER_APPLY_URL,
	MEMBER_INTAKE,
	MEMBER_SIGN_IN_URL,
} from '../src/lib/membership';
import { membershipCopyViolations } from '../src/lib/membership-copy';
import { installExternalGuard, stubChallenge } from './support/network';
import { skipHomeIntro } from './support/intro';
import { ACCESS_PROBE_URL, MEMBERSHIP_SURFACE_ATTR } from '../src/lib/flags/membership-surface';

// The public join path and the membership copy invariant, over the served
// build: the home FAQ answers how to join without conditioning membership on
// money, gear, tools or a pledge; Apply follows the one intake switch in
// src/lib/membership.ts (closed: the on-site /join explanation and the
// contact route, never the member app's form); Sign in always points at the
// member app login. Rows run at a phone width and a desktop width.
//
// Every membership link or button sits behind the membership surface flag
// (operator rulings 2026-10-03, src/lib/flags/membership-surface.ts): an
// anonymous visitor sees the prose and none of the links. The link rows below
// run with the ?flags=membership preview override, and one row stands in for
// a visitor with an Access session by answering the probe with an image.

const MEMBERSHIP_LINKS = `a[href^="${JOIN_PATH}"], a[href^="${MEMBER_APP_ORIGIN}"]`;

/** Opens `path` with the preview override and waits for the flag. */
async function withOverride(guardedPage: (path?: string) => Promise<Page>, path = '/'): Promise<Page> {
	const page = await guardedPage(`${path}?flags=membership`);
	await expect(page.locator(`html[${MEMBERSHIP_SURFACE_ATTR}="on"]`)).toHaveCount(1);
	return page;
}

/** Every link into /join or the member app, with whether it can be seen. */
async function membershipLinks(page: Page) {
	return page.locator(MEMBERSHIP_LINKS).evaluateAll((links) =>
		links.map((link) => ({
			href: link.getAttribute('href'),
			gated: link.closest('.membership-surface') !== null,
			visible: getComputedStyle(link).visibility === 'visible' && link.getClientRects().length > 0,
		})),
	);
}

const widths = [
	{ label: 'phone', width: 375 },
	{ label: 'desktop', width: 1280 },
];

async function horizontalOverflow(page: Page): Promise<number> {
	return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function expectInsideViewport(page: Page, selector: string, minHeight = 44) {
	const box = await page.locator(selector).first().boundingBox();
	expect(box, `${selector} has a box`).not.toBeNull();
	const width = page.viewportSize()?.width ?? 0;
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(width);
	// The house tap height (.button and the sign-in link are 3rem); header
	// links meet the 24px target floor.
	expect(box!.height).toBeGreaterThanOrEqual(minHeight);
}

test.beforeEach(async ({ page }) => {
	await skipHomeIntro(page);
});

test('intake is closed in this build, so the rows below test the closed path', () => {
	expect(MEMBER_INTAKE).toBe('closed');
});

for (const { label, width } of widths) {
	test.describe(`join path at ${label} width (${width}px)`, () => {
		test.beforeEach(async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
		});

		test('an anonymous visitor sees no membership link or button, and no header Join', async ({ guardedPage }) => {
			const page = await guardedPage('/');
			await expect(page.locator('#faq-membership + dd')).toContainText('Applications are not open yet.');
			// Give the Access probe time to answer (the guard answers as Access does
			// for an anonymous visitor) before reading the flag.
			await page.waitForLoadState('networkidle');
			await expect(page.locator(`html[${MEMBERSHIP_SURFACE_ATTR}]`)).toHaveCount(0);
			const links = await membershipLinks(page);
			expect(links.length).toBeGreaterThan(0);
			for (const link of links) {
				expect(link.gated, link.href ?? '').toBe(true);
				expect(link.visible, link.href ?? '').toBe(false);
			}
			await expect(
				page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Join' }),
			).toHaveCount(0);
			await expect(page.locator('#faq-membership + dd .join-actions')).toBeHidden();
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});

		test('with the override, the header Join and the FAQ Apply and Sign in show with honest targets', async ({
			guardedPage,
		}) => {
			const page = await withOverride(guardedPage);
			const join = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Join' });
			await expect(join).toHaveAttribute('href', JOIN_PATH);
			await expectInsideViewport(page, '.site-nav a[href="/join"]', 24);
			const answer = page.locator('#faq-membership + dd');
			const apply = answer.getByRole('link', { name: 'Apply', exact: true });
			await expect(apply).toHaveAttribute('href', JOIN_PATH);
			await expect(apply).not.toHaveAttribute('target', '_blank');
			const signIn = answer.getByRole('link', { name: /^Member sign in/u });
			await expect(signIn).toHaveAttribute('href', MEMBER_SIGN_IN_URL);
			await expect(signIn).toHaveAttribute('target', '_blank');
			await expect(signIn).toHaveAttribute('rel', /noopener/u);
			await expect(answer).toContainText('Applications are not open yet.');
			await expect(answer.getByRole('link', { name: 'send us a message' })).toHaveAttribute('href', '/contact');

			await apply.scrollIntoViewIfNeeded();
			await expectInsideViewport(page, '#faq-membership + dd .join-actions .button');
			await expectInsideViewport(page, '#faq-membership + dd .join-actions__sign-in');
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});

		test('with the override, Apply leads to the explanation and the contact route', async ({ guardedPage }) => {
			const page = await withOverride(guardedPage);
			await page.locator('#faq-membership + dd').getByRole('link', { name: 'Apply', exact: true }).click();
			await expect(page).toHaveURL(/\/join\/?$/u);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Join the Tool Bus');
			// The override is stored, so it survives the navigation.
			await expect(page.locator(`html[${MEMBERSHIP_SURFACE_ATTR}="on"]`)).toHaveCount(1);
			const applications = page.locator('#applications');
			await expect(applications).toContainText('Applications are not open yet.');
			await expect(applications.getByRole('link', { name: "Tell us you're interested" })).toHaveAttribute(
				'href',
				'/contact',
			);
			await expect(applications.getByRole('link', { name: /^Member sign in/u })).toHaveAttribute(
				'href',
				MEMBER_SIGN_IN_URL,
			);
			await expect(page.locator('#steps ol li')).toHaveCount(6);
			await expectInsideViewport(page, '#applications .join-actions .button');
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});
	});
}

test('while intake is closed no page links the member app application form', async ({ guardedPage }) => {
	const page = await withOverride(guardedPage);
	for (const path of ['/', JOIN_PATH, '/contact']) {
		await page.goto(path);
		await expect(page.locator(`a[href^="${MEMBER_APPLY_URL}"]`), path).toHaveCount(0);
		// Every link into the member app is the sign-in entry.
		const memberLinks = await page
			.locator(`a[href^="${MEMBER_APP_ORIGIN}"]`)
			.evaluateAll((links) => links.map((link) => link.getAttribute('href')));
		expect(new Set(memberLinks), path).toEqual(new Set([MEMBER_SIGN_IN_URL]));
	}
});

test('?flags=none clears the override', async ({ guardedPage }) => {
	const page = await withOverride(guardedPage);
	await page.goto('/?flags=none');
	await page.waitForLoadState('networkidle');
	await expect(page.locator(`html[${MEMBERSHIP_SURFACE_ATTR}]`)).toHaveCount(0);
	await page.goto(JOIN_PATH);
	await page.waitForLoadState('networkidle');
	for (const link of await membershipLinks(page)) expect(link.visible, link.href ?? '').toBe(false);
});

test('a visitor with an Access session sees the membership surface', async ({ page, baseUrl }) => {
	// Guard first so the probe route registered after it takes precedence.
	await installExternalGuard(page, baseUrl);
	await stubChallenge(page);
	// Answer the probe as Access does for a signed-in visitor: the image itself.
	await page.route(`${ACCESS_PROBE_URL}?*`, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
		}),
	);
	await page.goto('/');
	await expect(page.locator(`html[${MEMBERSHIP_SURFACE_ATTR}="on"]`)).toHaveCount(1);
	for (const link of await membershipLinks(page)) expect(link.visible, link.href ?? '').toBe(true);
});

test('rendered membership copy never conditions membership on money, gear or a pledge', async ({ guardedPage }) => {
	const home = await guardedPage('/');
	const faq = await home.locator('#faq').innerText();
	expect(membershipCopyViolations(faq)).toEqual([]);
	expect(faq).not.toMatch(/pledge|\$100/iu);
	await expect(home.locator('#faq-contributions + dd')).toContainText('Contributions are optional and separate');

	await home.goto(JOIN_PATH);
	const body = await home.locator('main').innerText();
	expect(membershipCopyViolations(body)).toEqual([]);
	await expect(home.locator('#contributions')).toContainText('Membership never depends on money, gear, or tools.');
});

test('/join is reachable but unlisted, and the footer rows and sharp edges hold', async ({ guardedPage, request }) => {
	const page = await withOverride(guardedPage, JOIN_PATH);
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/u);
	await expect(page.locator('a[href*="/edit/"][href*="join"]')).toHaveCount(0);
	const footer = page.locator('footer');
	await expect(footer.getByRole('link', { name: 'Join', exact: true })).toHaveAttribute('href', JOIN_PATH);
	await expect(footer.getByRole('link', { name: /^Member sign in/u })).toHaveAttribute('href', MEMBER_SIGN_IN_URL);
	const rounded = await page.evaluate(() =>
		[...document.querySelectorAll('main *')]
			.filter((el) => getComputedStyle(el).borderRadius !== '0px')
			.map((el) => el.tagName + '.' + el.className),
	);
	expect(rounded).toEqual([]);
	const sitemap = await request.get('/sitemap.xml');
	expect(await sitemap.text()).not.toContain('/join/');

	await page.goto('/');
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index/u);
});
