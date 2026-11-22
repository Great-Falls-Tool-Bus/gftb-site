import { expect, test, type Page } from '@playwright/test';
import { skipHomeIntro } from './support/intro';

// The home intro's scroll would break this spec's scroll-position premises.
test.beforeEach(async ({ page }) => {
	await skipHomeIntro(page);
});

// B5 in inventory Appendix A requires a static cover image under reduced motion. Animation also
// requires `@supports (animation-timeline: view())`. The layer overscans the band by 20% and
// travels ±8% of its own height. Verify coverage at both scroll limits, including browsers that
// use the static fallback.

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
	// Reduced motion keeps the static cover image across the band.
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
