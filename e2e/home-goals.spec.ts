import { expect, test } from '@playwright/test';

import { publishedGoalEntries } from '../src/lib/generated/goals-manifest';
import { memberBenefits, publicGoals, publicHelpAsks } from '../src/lib/public-goals';

// Operator ruling 2026-08-31: the home page's goals, help asks, and member
// benefits render from src/content/goals via the generated manifest; GitHub
// joins the header; the AX footer row is retired.
//
// The goals list now cycles as an accessible carousel
// (src/lib/components/GoalCarousel.svelte). Every pre-carousel pin below
// still holds — the OL/role=list markup, the row count and order, the
// never-cards sweep, the CTA hrefs — because every slide stays in the DOM;
// the carousel-specific rows (region semantics, controls, pause honesty,
// reduced-motion stillness, no-JS degradation) follow after them.

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

test('the goals cycle inside an accessible carousel region with working controls', async ({ page }) => {
	await page.goto('/');
	const region = page.locator('#goals [aria-roledescription="carousel"]');
	await expect(region).toHaveAttribute('role', 'region');
	// The region is named by the section's own heading.
	await expect(region).toHaveAttribute('aria-labelledby', 'goals-title');

	const list = page.locator('#goals .goal-list');
	// Every goal title stays in the DOM while the carousel cycles — slides
	// are paged by scroll position, never mounted and unmounted.
	await expect(list.locator('> li h3')).toHaveText(publicGoals.map((goal) => goal.metadata.title));

	// Auto-advance is running on load, and the live region is honest about
	// it: "off" while cycling (Zag flips it to "polite" whenever paused).
	await expect(list).toHaveAttribute('aria-live', 'off');

	// Visible prev/next and a pause/play control.
	const prev = region.getByRole('button', { name: 'Previous goal' });
	const next = region.getByRole('button', { name: 'Next goal' });
	await expect(prev).toBeVisible();
	await expect(next).toBeVisible();
	await expect(region.getByRole('button', { name: 'Pause auto-advance' })).toBeVisible();

	// Stop rotation first so the manual-navigation assertions are
	// deterministic, then prove the toggle is honest in both directions.
	await region.getByRole('button', { name: 'Pause auto-advance' }).click();
	await expect(list).toHaveAttribute('aria-live', 'polite');

	await next.click();
	await expect.poll(async () => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
	await prev.click();
	await expect.poll(async () => list.evaluate((el) => el.scrollLeft)).toBeLessThan(1);

	await region.getByRole('button', { name: 'Play auto-advance' }).click();
	await expect(list).toHaveAttribute('aria-live', 'off');
	await region.getByRole('button', { name: 'Pause auto-advance' }).click();
	await expect(list).toHaveAttribute('aria-live', 'polite');
});

test('hovering the goals pauses auto-advance and leaving resumes it', async ({ page }) => {
	await page.goto('/');
	const list = page.locator('#goals .goal-list');
	await expect(list).toHaveAttribute('aria-live', 'off');

	await list.hover();
	await expect(list).toHaveAttribute('aria-live', 'polite');

	// Longer than the 7s auto-advance interval: the scroller must not move
	// while the pointer rests on it.
	const before = await list.evaluate((el) => el.scrollLeft);
	await page.waitForTimeout(8000);
	expect(await list.evaluate((el) => el.scrollLeft)).toBe(before);

	// Pointer leaves — the courtesy pause lifts.
	await page.mouse.move(0, 0);
	await expect(list).toHaveAttribute('aria-live', 'off');
});

test('keyboard focus inside the goals pauses auto-advance', async ({ page }) => {
	await page.goto('/');
	const list = page.locator('#goals .goal-list');
	await expect(list).toHaveAttribute('aria-live', 'off');

	const cta = page.locator('#goals .goal-cta a').first();
	await cta.focus();
	await expect(list).toHaveAttribute('aria-live', 'polite');

	// Focus moves on, the courtesy pause lifts.
	await cta.blur();
	await expect(list).toHaveAttribute('aria-live', 'off');
});

test('the play control restarts rotation even after wheel engagement parks the machine', async ({ page }) => {
	await page.goto('/');
	const list = page.locator('#goals .goal-list');
	await expect(list).toHaveAttribute('aria-live', 'off');

	// A vertical wheel over the slides is direct engagement: rotation stops
	// and stays stopped (no courtesy resume when the pointer leaves). Under
	// the hood this is also the gesture that walks Zag into its userScroll
	// state with no SCROLL.END ever coming — the item group never scrolled.
	await list.hover();
	await page.mouse.wheel(0, 1);
	await expect(list).toHaveAttribute('aria-live', 'polite');
	await page.mouse.move(0, 0);
	await expect(list).toHaveAttribute('aria-live', 'polite');

	// The Play control must genuinely restart rotation from that parked
	// state (userScroll ignores AUTOPLAY.START; the component re-asserts
	// the current page to reach idle first) — a Play button may not lie.
	const region = page.locator('#goals [aria-roledescription="carousel"]');
	await region.getByRole('button', { name: 'Play auto-advance' }).click();
	await expect(list).toHaveAttribute('aria-live', 'off');
	await expect(region.getByRole('button', { name: 'Pause auto-advance' })).toBeVisible();
});

test('reduced motion never auto-advances; manual navigation still works', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	const list = page.locator('#goals .goal-list');

	// The machine is created without autoplay: the live region reports the
	// paused state and the rotation control is not offered at all — there
	// is no rotation to control under reduced motion.
	await expect(list).toHaveAttribute('aria-live', 'polite');
	await expect(page.locator('#goals').getByRole('button', { name: /auto-advance/u })).toHaveCount(0);

	// Longer than the auto-advance interval: nothing moves on its own.
	expect(await list.evaluate((el) => el.scrollLeft)).toBe(0);
	await page.waitForTimeout(8000);
	expect(await list.evaluate((el) => el.scrollLeft)).toBe(0);

	// Manual prev/next still work (with instant, non-smooth scrolls).
	const region = page.locator('#goals [aria-roledescription="carousel"]');
	await region.getByRole('button', { name: 'Next goal' }).click();
	await expect.poll(async () => list.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
	await region.getByRole('button', { name: 'Previous goal' }).click();
	await expect.poll(async () => list.evaluate((el) => el.scrollLeft)).toBeLessThan(1);
});

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the served HTML degrades to the resting goals grid with no dead chrome', async ({ page }) => {
		await page.goto('/');
		const list = page.locator('#goals .goal-list');
		await expect(list.locator('> li')).toHaveCount(publicGoals.length);
		// No carousel chrome in the static document: no inert buttons, no
		// scroll-snap inline layout on the list, no hidden slides.
		await expect(page.locator('#goals button')).toHaveCount(0);
		await expect(list).not.toHaveAttribute('style', /./u);
		await expect(page.locator('#goals [aria-hidden="true"]')).toHaveCount(0);
		// The resting layout is the ratified borderless grid, not a scroller.
		expect(await list.evaluate((el) => getComputedStyle(el).display)).toBe('grid');
		expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe('visible');
	});
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
