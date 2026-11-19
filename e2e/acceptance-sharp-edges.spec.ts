import { expect, test } from '@playwright/test';

// The sharp-edge ruling in §1.5-ii covers computed styles. Skeleton 5's `@utility card {
// border-radius: var(--radius-container) }` can round class="card" after the source check
// passes. Include the <altcha-widget> box and exempt its third-party internals.

const CORNERS = [
	'border-top-left-radius',
	'border-top-right-radius',
	'border-bottom-right-radius',
	'border-bottom-left-radius',
];

// D01 covers both switch states. Skeleton v5 applies pill radii to the control and thumb and
// styles each part by data-state.
test('the mode switch computes sharp corners in both states', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const sweep = () =>
		page.evaluate((corners) => {
			const offenders: string[] = [];
			for (const element of Array.from(
				document.querySelectorAll<HTMLElement>('.mode-switch, .mode-switch__control, .mode-switch__thumb'),
			)) {
				const style = getComputedStyle(element);
				const values = corners.map((corner) => style.getPropertyValue(corner));
				if (values.some((value) => value !== '0px')) {
					offenders.push(`${element.className.split(/\s+/u)[0]}: ${values.join(' ')}`);
				}
			}
			return offenders;
		}, CORNERS);
	expect(await sweep(), 'switch corners at rest').toEqual([]);
	await page.locator('.mode-switch').click();
	await expect(page.locator('.mode-switch input')).toBeChecked();
	expect(await sweep(), 'switch corners checked').toEqual([]);
});

test('the wiper stalk computes sharp corners at rest, Off and High', async ({ page }) => {
	// Skeleton 5's SegmentedControl ships pill radii on its parts; the stalk
	// overrides every one (app.css .wiper-stalk*). The indicator moves between
	// items, so it is swept in three detent states.
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const stalk = page.locator('#goals .wiper-stalk');
	await expect(stalk).toHaveCount(1);
	const sweep = () =>
		page.evaluate((corners) => {
			const offenders: string[] = [];
			for (const element of Array.from(
				document.querySelectorAll<HTMLElement>(
					'.wiper-stalk, .wiper-stalk__control, .wiper-stalk__item, .wiper-stalk__text',
				),
			)) {
				const style = getComputedStyle(element);
				const values = corners.map((corner) => style.getPropertyValue(corner));
				if (values.some((value) => value !== '0px')) {
					offenders.push(`${element.className.split(/\s+/u)[0]}: ${values.join(' ')}`);
				}
			}
			return offenders;
		}, CORNERS);
	expect(await sweep(), 'stalk corners at rest').toEqual([]);
	for (const detent of ['Off', 'High']) {
		await stalk.locator('.wiper-stalk__item', { hasText: detent }).click();
		await expect(page.getByRole('radio', { name: detent })).toBeChecked();
		expect(await sweep(), `stalk corners on ${detent}`).toEqual([]);
	}
});

for (const path of ['/', '/404', '/log', '/contact']) {
	test(`no element computes a rounded corner at ${path}`, async ({ page }) => {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
		const rounded = await page.evaluate((corners) => {
			const offenders: string[] = [];
			for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
				if (element.closest('altcha-widget') && element.tagName.toLowerCase() !== 'altcha-widget') continue;
				// Operator ruling at the M4 ratification (2026-09-09): the two
				// full-bleed bands carry one mirrored radius pair (the hero's
				// bottom corners, the windshield's top corners, app.css
				// --bleed-radius). Every control, pane and card stays at 0.
				if (element.matches('.hero__media, .wiper--paged .wiper__glass')) continue;
				const style = getComputedStyle(element);
				const values = corners.map((corner) => style.getPropertyValue(corner));
				if (values.some((value) => value !== '0px')) {
					const classes = String(element.className || '')
						.split(/\s+/u)
						.filter(Boolean)
						.slice(0, 2)
						.join('.');
					offenders.push(`${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}: ${values.join(' ')}`);
				}
			}
			return offenders.slice(0, 12);
		}, CORNERS);
		expect(rounded, `elements computing a rounded corner at ${path}`).toEqual([]);
	});
}
