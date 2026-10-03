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
import { skipHomeIntro } from './support/intro';

// The public join path and the membership copy invariant, over the served
// build: the home FAQ answers how to join without conditioning membership on
// money, gear, tools or a pledge; Apply follows the one intake switch in
// src/lib/membership.ts (closed: the on-site /join explanation and the
// contact route, never the member app's form); Sign in always points at the
// member app login. Rows run at a phone width and a desktop width.

const widths = [
	{ label: 'phone', width: 375 },
	{ label: 'desktop', width: 1280 },
];

async function horizontalOverflow(page: Page): Promise<number> {
	return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function expectInsideViewport(page: Page, selector: string) {
	const box = await page.locator(selector).first().boundingBox();
	expect(box, `${selector} has a box`).not.toBeNull();
	const width = page.viewportSize()?.width ?? 0;
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(width);
	// The house tap height (.button and the sign-in link are 3rem).
	expect(box!.height).toBeGreaterThanOrEqual(44);
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

		test('the home FAQ carries Apply and Sign in with honest targets', async ({ guardedPage }) => {
			const page = await guardedPage('/');
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

		test('Apply leads to the explanation and the contact route, not a dead link', async ({ guardedPage }) => {
			const page = await guardedPage('/');
			await page.locator('#faq-membership + dd').getByRole('link', { name: 'Apply', exact: true }).click();
			await expect(page).toHaveURL(/\/join\/?$/u);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Join the Tool Bus');
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
	const page = await guardedPage('/');
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

test('the footer, the sitemap and the sharp-edge rule cover the join path', async ({ page, request }) => {
	await page.goto(JOIN_PATH);
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
	expect(await sitemap.text()).toContain('<loc>https://greatfallstoolbus.org/join/</loc>');
});
