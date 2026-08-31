import { expect, test } from '@playwright/test';

import { publishedGoalEntries } from '../src/lib/generated/goals-manifest';

// Operator ruling 2026-08-31: the home page's goals, help asks, and member
// benefits render from src/content/goals via the generated manifest; GitHub
// joins the header; the AX footer row is retired.

const count = (kind: string) => publishedGoalEntries.filter((entry) => entry.metadata.kind === kind).length;

test('near-term goals render from the manifest, borderless, soonest first', async ({ page }) => {
	await page.goto('/');
	const goals = page.locator('#goals .goal-list > li');
	await expect(goals).toHaveCount(count('goal'));
	await expect(goals.first().getByRole('heading', { level: 3 })).toHaveText('Form the club');
	await expect(page.locator('#goals')).toContainText('Sunday, September 20, 2026');
	const border = await page
		.locator('#goals .goal-list > li')
		.first()
		.evaluate((el) => getComputedStyle(el).borderTopWidth);
	expect(border).toBe('0px');
});

test('member benefits and help asks render with their CTAs', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'What members get' })).toBeVisible();
	await expect(page.locator('#benefits li')).toHaveCount(count('benefit'));
	await expect(page.locator('#benefits')).toContainText('latoolb.us');
	await expect(page.locator('#help li')).toHaveCount(count('help'));
	for (const link of await page.locator('#help a, #goals .goal-cta a').all()) {
		await expect(link).toHaveAttribute('href', '/contact');
	}
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
