import { expect, test } from '@playwright/test';

// B4 covers the footer grid across breakpoints. In #103, a line outside its cell became an
// extra track. Below 48rem the footer must stack.

// B1.3 weights the intro track. The 2026-09-19 and 2026-11-14 rulings add Site, Members and
// Mail and lists to the sitemap.
const GRID_CASES = [
	{ label: 'tablet', width: 768, columns: 7 },
	{ label: 'desktop', width: 1440, columns: 7 },
];

for (const { label, width, columns } of GRID_CASES) {
	test(`footer grid resolves exactly ${columns} columns at ${label} (${width}px)`, async ({ page }) => {
		await page.setViewportSize({ width, height: 1200 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const resolved = await page.locator('.site-footer__inner').evaluate((inner) => ({
			template: getComputedStyle(inner).gridTemplateColumns,
			directChildren: inner.children.length,
		}));
		// getComputedStyle on a rendered grid returns the used track list
		// ("Xpx Ypx"), so the count below is the number of EXPLICIT tracks.
		expect(resolved.template.split(' ').length, `computed tracks: ${resolved.template}`).toBe(columns);
		// Keep the location and provenance inside the intro cell to avoid the extra track from #103.
		expect(resolved.directChildren, 'one direct grid child per template track').toBe(columns);
	});
}

test('footer stacks to a single column below 48rem', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 1200 });
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const stacked = await page.locator('.site-footer__inner').evaluate((inner) => {
		const style = getComputedStyle(inner);
		const cells = Array.from(inner.children).map((cell) => cell.getBoundingClientRect());
		return {
			display: style.display,
			// Chrome reports an implicit grid column in pixels. A non-grid element returns 'none', which
			// also splits to one item. Check display and reject 'none'.
			template: style.gridTemplateColumns,
			directChildren: inner.children.length,
			sameColumn: cells.every((cell) => Math.abs(cell.left - cells[0].left) < 1),
			flows: cells.every((cell, index) => index === 0 || cell.top >= cells[index - 1].bottom),
		};
	});
	expect(stacked.display, 'the footer is still a grid below 48rem').toBe('grid');
	expect(stacked.template, 'a resolved implicit track, not a non-grid none').not.toBe('none');
	expect(stacked.template.split(' ').length, `one resolved column below 48rem: ${stacked.template}`).toBe(1);
	// The #103 structural pin at mobile too: intro lines stay nested inside
	// their cell, never as direct grid children. Seven cells: intro + the six
	// nav groups (Members / Mail and lists / About / Get involved / Site / Meta).
	expect(stacked.directChildren, 'one direct grid child per cell at 375').toBe(7);
	expect(stacked.sameColumn, 'every footer cell shares the single column').toBe(true);
	expect(stacked.flows, 'footer cells stack in document order').toBe(true);
});

test('the location line nests inside the intro cell, never as a grid child', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const intro = page.locator('.site-footer__intro');
	await expect(intro).toContainText('Lewiston');
	// src/lib/build-info.ts adds provenance only when the build has a commit identity. It belongs
	// inside the intro cell under #103.
	const provenance = page.locator('.site-footer__provenance');
	expect(await provenance.count()).toBe(await intro.locator('.site-footer__provenance').count());
	// The logo designer credit (board instruction 2026-09-20) is always
	// rendered, and it nests inside the same intro cell the same way.
	const credit = page.locator('.site-footer__credit');
	await expect(credit).toHaveText('Logo by Chris H.');
	expect(await credit.count()).toBe(await intro.locator('.site-footer__credit').count());
});
