import { expect, test } from '@playwright/test';

import { publishedGoalEntries } from '../src/lib/generated/goals-manifest';
import { memberBenefits, publicGoals, publicHelpAsks } from '../src/lib/public-goals';

// Operator ruling 2026-08-31: the home page's goals, help asks, and member
// benefits render from src/content/goals via the generated manifest; GitHub
// joins the header; the AX footer row is retired.

test('near-term goals render from the manifest as an ordered, borderless list, soonest first', async ({ page }) => {
	await page.goto('/');
	const list = page.locator('#goals .goal-list');
	expect(await list.evaluate((el) => el.tagName)).toBe('OL');
	await expect(list).toHaveAttribute('role', 'list');
	const rows = list.locator('> li');
	await expect(rows).toHaveCount(publicGoals.length);
	expect(publicGoals.length).toBeGreaterThanOrEqual(6);
	// The rendered order IS the SSOT's sort (order asc, then slug), and the
	// first row is the operator's first penciled goal.
	await expect(rows.locator('h3')).toHaveText(publicGoals.map((goal) => goal.metadata.title));
	await expect(rows.first().locator('h3')).toHaveText('Form the club');
	await expect(page.locator('#goals')).toContainText('Sunday, September 20, 2026');
	// Never-cards (2026-08-30): no border on any side of any row, no fill.
	const boxes = await rows.evaluateAll((els) =>
		els.map((el) => {
			const s = getComputedStyle(el);
			return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth, s.backgroundColor];
		}),
	);
	for (const box of boxes) {
		expect(box.slice(0, 4)).toEqual(['0px', '0px', '0px', '0px']);
		expect(box[4]).toBe('rgba(0, 0, 0, 0)');
	}
});

test('member benefits and help asks render with their CTAs', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'What members get' })).toBeVisible();
	await expect(page.locator('#benefits li')).toHaveCount(memberBenefits.length);
	await expect(page.locator('#benefits')).toContainText('latoolb.us');
	await expect(page.locator('#benefits')).toContainText('once the mail system is proved');
	await expect(page.locator('#help li')).toHaveCount(publicHelpAsks.length);
	expect(publishedGoalEntries.length).toBe(publicGoals.length + memberBenefits.length + publicHelpAsks.length);
	for (const link of await page.locator('#help a, #goals .goal-cta a').all()) {
		await expect(link).toHaveAttribute('href', '/contact');
	}
});

test('the session band carries one spelling of the Friday hours', async ({ page }) => {
	await page.goto('/');
	const band = page.locator('.next-session');
	await expect(band.getByRole('heading', { level: 2 })).toHaveText('Public work sessions');
	await expect(band.locator('.date-chip')).toHaveText('Fridays, about 3 to 5 PM ET');
	await expect(band).not.toContainText('3–5');
	await expect(page.locator('#status')).not.toContainText('Fridays');
});

test('GitHub sits in the header as an outbound link and the AX footer row is gone', async ({ page }) => {
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	const github = nav.getByRole('link', { name: /^GitHub/u });
	await expect(github).toHaveAttribute('href', 'https://github.com/Great-Falls-Tool-Bus');
	await expect(github).toHaveAttribute('rel', /external/u);
	await expect(nav.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
	await expect(page.locator('footer')).not.toContainText('AGENTS.md');
});
