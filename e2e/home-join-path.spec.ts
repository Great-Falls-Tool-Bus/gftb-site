import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { INTEREST_PATH, MEMBER_INTAKE } from '../src/lib/membership';
import { membershipCopyViolations } from '../src/lib/membership-copy';
import { MANIFEST_URL } from '../src/lib/gated/manifest';
import { MEMBER_MANIFEST, installExternalGuard, routeMemberManifest, stubChallenge } from './support/network';
import { skipHomeIntro } from './support/intro';

// The public join path and the membership copy invariant, over the served
// build: the home FAQ answers how to join without conditioning membership on
// money, gear, tools or a pledge.
//
// Every membership link or button is a gated item (operator interview
// 2026-10-04, src/lib/gated/manifest.ts): it is absent from the served HTML
// and JavaScript and is fetched as data from the member app's host behind
// Access. An anonymous visitor sees the prose and none of the links, and the
// layout has no gap where they would be. A member (the manifest route mocked as
// the member app answers it for an Access session) sees them mount, and the
// layout reflows around them. Rows run at a phone width and a desktop width.

const MEMBERS_HOST = 'https://members.greatfallstoolbus.org';
const SIGN_IN_URL = `${MEMBERS_HOST}/login`;

/** Every link into the member app or the /join explainer, however spelled. */
const GATED_LINKS = [
	'a[href*="members.greatfallstoolbus.org"]',
	'a[href="/join"]',
	'a[href^="/join/"]',
	'a[href^="/join#"]',
	'a[href^="https://greatfallstoolbus.org/join"]',
].join(', ');

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

/** Opens `path` as a member: the manifest route answers as the member app does. */
async function asMember(page: Page, baseUrl: string, path = '/', body: unknown = MEMBER_MANIFEST): Promise<Page> {
	// Guard first so the manifest route registered after it takes precedence.
	await installExternalGuard(page, baseUrl);
	await stubChallenge(page);
	await routeMemberManifest(page, body);
	await page.goto(path);
	await page.waitForLoadState('domcontentloaded');
	return page;
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

		test('an anonymous visitor has no membership link or button anywhere, and no wrapper left behind', async ({
			guardedPage,
		}) => {
			const page = await guardedPage('/');
			await expect(page.locator('#faq-membership + dd')).toContainText('Applications are not open yet.');
			// Let the one manifest request come back as an anonymous visitor's does
			// (Access's HTML, refused by content type) before reading the page.
			await page.waitForLoadState('networkidle');
			await expect(page.locator(GATED_LINKS)).toHaveCount(0);
			await expect(page.getByRole('link', { name: /^Member sign in/u })).toHaveCount(0);
			await expect(page.getByRole('link', { name: 'Apply', exact: true })).toHaveCount(0);
			await expect(page.getByRole('link', { name: 'How membership works' })).toHaveCount(0);
			await expect(
				page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Join' }),
			).toHaveCount(0);
			// No reserved space: not even an empty actions row or footer item.
			await expect(page.locator('#faq-membership + dd .join-actions')).toHaveCount(0);
			await expect(page.locator('.site-footer li:empty')).toHaveCount(0);
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
			// The contact route stays public.
			await expect(
				page.locator('#faq-membership + dd').getByRole('link', { name: 'send us a message' }),
			).toHaveAttribute('href', INTEREST_PATH);
		});

		test('an anonymous visitor to /join sees the explanation and the contact route, no sign in', async ({
			guardedPage,
		}) => {
			const page = await guardedPage('/join/');
			await page.waitForLoadState('networkidle');
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Join the Tool Bus');
			await expect(page.locator('#applications')).toContainText('Applications are not open yet.');
			await expect(page.locator(GATED_LINKS)).toHaveCount(0);
			await expect(
				page.locator('#applications').getByRole('link', { name: "Tell us you're interested" }),
			).toHaveAttribute('href', INTEREST_PATH);
			await expect(page.locator('#steps ol li')).toHaveCount(6);
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});

		test('a member sees the header Join and the FAQ Apply and Sign in mount, with honest targets', async ({
			page,
			baseUrl,
		}) => {
			await asMember(page, baseUrl);
			const join = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Join' });
			await expect(join).toHaveAttribute('href', '/join');
			await expect(join).not.toHaveAttribute('target', '_blank');
			await expectInsideViewport(page, '.site-nav a[href="/join"]', 24);
			const answer = page.locator('#faq-membership + dd');
			const apply = answer.getByRole('link', { name: 'Apply', exact: true });
			await expect(apply).toHaveAttribute('href', '/join');
			await expect(apply).not.toHaveAttribute('target', '_blank');
			const signIn = answer.getByRole('link', { name: /^Member sign in/u });
			await expect(signIn).toHaveAttribute('href', SIGN_IN_URL);
			await expect(signIn).toHaveAttribute('target', '_blank');
			await expect(signIn).toHaveAttribute('rel', /noopener/u);
			await expect(answer.getByRole('link', { name: 'How membership works' })).toHaveAttribute('href', '/join');
			await expect(answer).toContainText('Applications are not open yet.');
			await expect(answer.getByRole('link', { name: 'send us a message' })).toHaveAttribute('href', INTEREST_PATH);

			await apply.scrollIntoViewIfNeeded();
			await expectInsideViewport(page, '#faq-membership + dd .join-actions .button');
			await expectInsideViewport(page, '#faq-membership + dd .join-actions__sign-in');
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});

		test('for a member, Apply leads to the explanation, where Sign in mounts beside the contact route', async ({
			page,
			baseUrl,
		}) => {
			await asMember(page, baseUrl);
			await page.locator('#faq-membership + dd').getByRole('link', { name: 'Apply', exact: true }).click();
			await expect(page).toHaveURL(/\/join\/?$/u);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Join the Tool Bus');
			const applications = page.locator('#applications');
			await expect(applications).toContainText('Applications are not open yet.');
			await expect(applications.getByRole('link', { name: "Tell us you're interested" })).toHaveAttribute(
				'href',
				INTEREST_PATH,
			);
			await expect(applications.getByRole('link', { name: /^Member sign in/u })).toHaveAttribute('href', SIGN_IN_URL);
			await expect(page.locator('#steps ol li')).toHaveCount(6);
			await expectInsideViewport(page, '#applications .join-actions .button');
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});
	});
}

test('the layout shifts with the gated items: a member page is taller, an anonymous page leaves no gap', async ({
	page,
	baseUrl,
	guardedPage,
}) => {
	await page.setViewportSize({ width: 375, height: 900 });
	const anonymous = await guardedPage('/');
	await anonymous.waitForLoadState('networkidle');
	const measure = (target: Page) =>
		target.evaluate(() => ({
			faq: document.querySelector('#faq-membership + dd')?.getBoundingClientRect().height ?? Number.NaN,
			footer: document.querySelector('.site-footer')?.getBoundingClientRect().height ?? Number.NaN,
		}));
	const before = await measure(anonymous);

	const memberPage = await page.context().newPage();
	await memberPage.setViewportSize({ width: 375, height: 900 });
	await skipHomeIntro(memberPage);
	await asMember(memberPage, baseUrl);
	await expect(memberPage.locator('#faq-membership + dd .join-actions')).toHaveCount(1);
	await expect(memberPage.locator('.site-footer').getByRole('link', { name: 'Join', exact: true })).toHaveCount(1);
	const after = await measure(memberPage);
	expect(after.faq, 'the FAQ answer grows by the actions row').toBeGreaterThan(before.faq);
	expect(after.footer, 'the footer grows by its Join and Sign in rows').toBeGreaterThan(before.footer);
});

test('the 320px header fits when Join mounts', async ({ page, baseUrl }) => {
	await page.setViewportSize({ width: 320, height: 667 });
	await asMember(page, baseUrl);
	await expect(
		page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Join' }),
	).toHaveCount(1);
	const state = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth,
		headerHeight: document.querySelector('.site-header')?.getBoundingClientRect().height ?? Number.NaN,
		navLinks: Array.from(document.querySelectorAll('.site-nav a')).map((element) => {
			const rect = element.getBoundingClientRect();
			return { text: element.textContent?.trim(), inside: rect.left >= 0 && rect.right <= window.innerWidth };
		}),
	}));
	expect(state.navLinks.some((link) => link.text === 'Join')).toBe(true);
	expect(
		state.navLinks.filter((link) => !link.inside),
		'nav links off-screen with Join mounted',
	).toEqual([]);
	expect(state.scrollWidth, 'document overflow with Join mounted').toBeLessThanOrEqual(state.innerWidth + 1);
	// Join may wrap the nav onto another row (the layout reflows by ruling);
	// the sticky header must still leave most of a phone screen to the page.
	expect(state.headerHeight, 'sticky header height with Join mounted').toBeLessThanOrEqual(160);
});

test('a manifest that fails, or lies, mounts nothing', async ({ page, baseUrl }) => {
	await installExternalGuard(page, baseUrl);
	await stubChallenge(page);
	const answers: Array<{ status: number; type: string; body: string }> = [
		{ status: 500, type: 'application/json', body: JSON.stringify(MEMBER_MANIFEST) },
		{ status: 200, type: 'text/html', body: JSON.stringify(MEMBER_MANIFEST) },
		{ status: 200, type: 'application/json', body: '{not json' },
		{
			status: 200,
			type: 'application/json',
			body: JSON.stringify({
				items: [{ slot: 'header-join', kind: 'join', label: 'Join', href: 'https://evil.example/join' }],
			}),
		},
	];
	for (const answer of answers) {
		await page.unroute(MANIFEST_URL).catch(() => undefined);
		await page.route(MANIFEST_URL, (route) =>
			route.fulfill({
				status: answer.status,
				contentType: answer.type,
				headers: {
					'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost',
					'access-control-allow-credentials': 'true',
				},
				body: answer.body,
			}),
		);
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await expect(page.locator(GATED_LINKS), JSON.stringify(answer.status + answer.type)).toHaveCount(0);
		await expect(page.locator('a[href*="evil.example"]')).toHaveCount(0);
	}
});

test('while intake is closed no page links the member app application form', async ({ page, baseUrl }) => {
	await asMember(page, baseUrl);
	for (const path of ['/', '/join/', '/contact']) {
		await page.goto(path);
		await expect(page.locator('footer').getByRole('link', { name: /^Member sign in/u }), path).toHaveCount(1);
		await expect(page.locator(`a[href^="${MEMBERS_HOST}/apply"]`), path).toHaveCount(0);
		// Every link into the member app is the sign-in entry.
		const memberLinks = await page
			.locator(`a[href^="${MEMBERS_HOST}"]`)
			.evaluateAll((links) => links.map((link) => link.getAttribute('href')));
		expect(new Set(memberLinks), path).toEqual(new Set([SIGN_IN_URL]));
	}
});

test('rendered membership copy never conditions membership on money, gear or a pledge', async ({ guardedPage }) => {
	const home = await guardedPage('/');
	const faq = await home.locator('#faq').innerText();
	expect(membershipCopyViolations(faq)).toEqual([]);
	expect(faq).not.toMatch(/pledge|\$100/iu);
	await expect(home.locator('#faq-contributions + dd')).toContainText('Contributions are optional and separate');

	await home.goto('/join/');
	const body = await home.locator('main').innerText();
	expect(membershipCopyViolations(body)).toEqual([]);
	await expect(home.locator('#contributions')).toContainText('Membership never depends on money, gear, or tools.');
});

test('/join is reachable but unlisted, and the footer rows and sharp edges hold for a member', async ({
	page,
	baseUrl,
	request,
}) => {
	await asMember(page, baseUrl, '/join/');
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/u);
	await expect(page.locator('a[href*="/edit/"][href*="join"]')).toHaveCount(0);
	const footer = page.locator('footer');
	await expect(footer.getByRole('link', { name: 'Join', exact: true })).toHaveAttribute('href', '/join');
	await expect(footer.getByRole('link', { name: /^Member sign in/u })).toHaveAttribute('href', SIGN_IN_URL);
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
