import { expect, test } from '@playwright/test';

// Acceptance rows for the scroll-reveal system (D04): armed only under
// html.motion-safe-ready (set pre-paint, only when motion is allowed),
// revealed by IntersectionObserver with per-item stagger, and FAIL-OPEN —
// no combination of reduced motion, disabled JavaScript, or a dead bundle
// may ever strand content hidden.

test.describe('motion allowed', () => {
	test('below-fold sections arm hidden, then reveal as they scroll in', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		expect(
			await page.evaluate(() => document.documentElement.classList.contains('motion-safe-ready')),
			'the sync script armed the page before paint',
		).toBe(true);

		// The contact section sits far below a 900px fold: armed, not shown.
		const armedOpacity = await page.locator('#contact').evaluate((element) => getComputedStyle(element).opacity);
		expect(Number(armedOpacity), 'far-below-fold section starts hidden').toBe(0);

		await page.locator('#contact').scrollIntoViewIfNeeded();
		await expect(page.locator('#contact')).toHaveClass(/reveal-in/);
		await expect
			.poll(async () => page.locator('#contact').evaluate((element) => Number(getComputedStyle(element).opacity)))
			.toBe(1);
	});

	test('the layout cancels the fail-open timer once hydrated', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		// Hydration succeeded, so the arm class must still be present well
		// past the 3s failsafe horizon (a fired failsafe would remove it and
		// un-stagger every reveal).
		await page.waitForTimeout(3500);
		expect(await page.evaluate(() => document.documentElement.classList.contains('motion-safe-ready'))).toBe(true);
	});
});

test.describe('fail-open', () => {
	test('reduced motion never arms: content renders at rest', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		expect(await page.evaluate(() => document.documentElement.classList.contains('motion-safe-ready'))).toBe(false);
		const opacities = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('.reveal-armed')).map(
				(element) => getComputedStyle(element).opacity,
			),
		);
		expect(opacities.length).toBeGreaterThan(0);
		expect(opacities.every((opacity) => Number(opacity) === 1)).toBe(true);
	});

	test('a dead bundle trips the 3s failsafe and un-hides everything', async ({ page }) => {
		// Abort every app SCRIPT request (the stylesheet still loads, so the
		// armed-hidden state is real): the inline head script still runs and
		// arms the page, but hydration never happens, so nothing can ever call
		// `use:reveal`. The failsafe is what stands between this state and
		// permanently invisible content.
		await page.route('**/_app/immutable/**/*.js', (route) => route.abort());
		await page.goto('/', { waitUntil: 'domcontentloaded' });

		expect(
			await page.evaluate(() => document.documentElement.classList.contains('motion-safe-ready')),
			'the head script armed the page before the bundle was needed',
		).toBe(true);

		await expect
			.poll(async () => page.evaluate(() => document.documentElement.classList.contains('motion-safe-ready')), {
				timeout: 10_000,
			})
			.toBe(false);

		const opacities = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('.reveal-armed')).map(
				(element) => getComputedStyle(element).opacity,
			),
		);
		expect(opacities.length).toBeGreaterThan(0);
		expect(
			opacities.every((opacity) => Number(opacity) === 1),
			'every armed element is visible after the failsafe',
		).toBe(true);
	});
});

test.describe('no JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('nothing ever arms: content renders at rest in the shipped HTML', async ({ page }) => {
		await page.goto('/');
		expect(await page.evaluate(() => document.documentElement.classList.contains('motion-safe-ready'))).toBe(false);
		const opacities = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('.reveal-armed')).map(
				(element) => getComputedStyle(element).opacity,
			),
		);
		expect(opacities.length).toBeGreaterThan(0);
		expect(opacities.every((opacity) => Number(opacity) === 1)).toBe(true);
	});
});
