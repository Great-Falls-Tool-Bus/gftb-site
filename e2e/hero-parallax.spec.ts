import { expect, test, type Page } from '@playwright/test';

// Restoration rows for the hero backdrop. The drift is a CSS scroll-driven
// animation, double-gated behind `@supports (animation-timeline: view())`
// and `@media (prefers-reduced-motion: no-preference)`.
//
// B5 (inventory Appendix A): under prefers-reduced-motion: reduce the layer
// declares no animation and holds no transform — the acceptance-motion suite
// already sweeps every element, this row pins the hero layer by name.
//
// Clamp: the layer over-scans the band by 20% on the block axis and the
// keyframes travel ±8% of the layer's own height (≤ 11.2% of the band), so
// the layer must cover the band rect at EVERY scroll position. Asserted at
// top and max scroll, at the inventory's widths. The assertions are
// support-agnostic on purpose: in a browser without scroll-driven animations
// (Firefox, behind PLAYWRIGHT_ALL_BROWSERS — WebKit supports
// animation-timeline and animates) the layer is the static centered cover
// image and covers the band trivially — that IS the specified fallback, so
// the same rows prove it.

const WIDTHS = [375, 768, 1440];

async function driftState(page: Page) {
	return page.evaluate(() => {
		const media = document.querySelector('.hero__media');
		const layer = document.querySelector('.hero__drift');
		if (!media || !layer) throw new Error('hero backdrop layers are missing');
		const band = media.getBoundingClientRect();
		const rect = layer.getBoundingClientRect();
		const style = getComputedStyle(layer);
		return {
			animationName: style.animationName,
			transform: style.transform,
			// getBoundingClientRect includes the animated transform, so these
			// four are the clamp, measured, with 0.5px subpixel tolerance.
			coversTop: rect.top <= band.top + 0.5,
			coversBottom: rect.bottom >= band.bottom - 0.5,
			coversLeft: rect.left <= band.left + 0.5,
			coversRight: rect.right >= band.right - 0.5,
		};
	});
}

test('the drift layer is inert under prefers-reduced-motion: reduce (B5)', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const drift = await driftState(page);
	expect(drift.animationName, 'no animation is declared under reduce').toBe('none');
	expect(drift.transform, 'the layer holds no transform under reduce').toBe('none');
	// The reduced-motion state is the same static cover image the no-support
	// fallback ships — still present, still covering the band.
	expect(drift).toMatchObject({ coversTop: true, coversBottom: true, coversLeft: true, coversRight: true });
	await expect(page.locator('.hero__drift img')).toBeVisible();
});

for (const width of WIDTHS) {
	test(`the over-scan clamp holds at every scroll position (${width}px)`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width, height: 800 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		const atTop = await driftState(page);
		expect(atTop, 'layer covers the band before any scroll').toMatchObject({
			coversTop: true,
			coversBottom: true,
			coversLeft: true,
			coversRight: true,
		});

		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		// Scroll-driven animation state is applied on the next rendering frame.
		await page.evaluate(() => new Promise(requestAnimationFrame));
		const atEnd = await driftState(page);
		expect(atEnd, 'layer still covers the band at max scroll').toMatchObject({
			coversTop: true,
			coversBottom: true,
			coversLeft: true,
			coversRight: true,
		});
	});
}

test('the backdrop is decorative and adds no user-facing text', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.hero__media')).toHaveAttribute('aria-hidden', 'true');
	await expect(page.locator('.hero__drift img')).toHaveAttribute('alt', '');
});
