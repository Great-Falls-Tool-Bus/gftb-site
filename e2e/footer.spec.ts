import { expect, test } from '@playwright/test';

// Breakpoint row B4 (ported from the old apex's verified breakpoint set): the
// footer's computed grid column count matches its declared template — no
// phantom column. The regression class is the old apex footer fix #103: a
// line added as a DIRECT grid child instead of nested inside its cell adds a
// phantom track and breaks the template at every breakpoint. Below 48rem the
// footer must stack to a single column.

// Four tracks: the demo's intro-weighted template (2fr intro + About +
// Get involved + Meta), ported by addendum B1.3.
const GRID_CASES = [
	{ label: 'tablet', width: 768, columns: 4 },
	{ label: 'desktop', width: 1440, columns: 4 },
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
		// The #103 lesson, enforced structurally: exactly one direct child per
		// track. The location and provenance lines live inside the intro cell,
		// so they can never become a phantom track.
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
			// The used value: Chrome resolves the single IMPLICIT column to its
			// pixel size (e.g. "343px"). A NON-grid element also reports the
			// literal 'none' here, which splits to length 1 — so the display
			// pin below is what makes this row able to fail on a flex/block
			// regression, and 'none' is explicitly rejected.
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
	// their cell, never as direct grid children. Four cells: intro + the
	// three nav groups (About / Get involved / Meta).
	expect(stacked.directChildren, 'one direct grid child per cell at 375').toBe(4);
	expect(stacked.sameColumn, 'every footer cell shares the single column').toBe(true);
	expect(stacked.flows, 'footer cells stack in document order').toBe(true);
});

test('the location line nests inside the intro cell, never as a grid child', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const intro = page.locator('.site-footer__intro');
	await expect(intro).toContainText('Lewiston');
	// The provenance line renders only on builds stamped with an explicitly
	// supplied commit identity (src/lib/build-info.ts). When it exists at all,
	// it must exist inside the intro cell — the exact #103 regression shape.
	const provenance = page.locator('.site-footer__provenance');
	expect(await provenance.count()).toBe(await intro.locator('.site-footer__provenance').count());
});
