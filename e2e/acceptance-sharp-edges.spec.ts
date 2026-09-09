import { expect, test } from '@playwright/test';

// Sharp edges is the operator ruling (de-slop directive §1.5-ii; restoration
// PR-4). The grep gate over src/ cannot see the BUILT stylesheet: Skeleton 5
// ships `@utility card { border-radius: var(--radius-container) }`, which
// collided with the semantic class="card" and rounded four elements while
// the rest of the card family computed 0px (review finding on this PR).
// This spec asserts the property the ruling is actually about — what the
// browser computes — so a utility collision can never slip past the source
// grep again.
//
// The ALTCHA widget's internals are vendored third-party chrome, not site
// styling, so descendants of <altcha-widget> are exempt; the widget's own
// box is still swept.

const CORNERS = [
	'border-top-left-radius',
	'border-top-right-radius',
	'border-bottom-right-radius',
	'border-bottom-left-radius',
];

// D01 extension: the mode switch is the first mounted Skeleton component,
// and v5 ships it with pill radii (`border-radius: calc(infinity * 1px)` on
// control and thumb — exactly the built-stylesheet class of collision this
// spec exists for). The sitewide sweep below already covers its resting
// state; this row flips it and sweeps the checked state too, because
// Skeleton styles the parts per data-state.
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

// The wiper dash (operator ruling 2026-09-09): keys restyle per aria-checked
// (a latched detent, the switch off), so sweep the dash at rest and in each
// state, not only the resting document the sitewide row sees.
test('the wiper dash computes sharp corners at rest, switched off, and on every detent', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const dash = page.locator('#goals .wiper-controls');
	await expect(dash).toHaveCount(1);
	const sweep = (label: string) =>
		page
			.evaluate((corners) => {
				const offenders: string[] = [];
				for (const element of Array.from(
					document.querySelectorAll<HTMLElement>('#goals .wiper-controls, #goals .wiper-controls *'),
				)) {
					const style = getComputedStyle(element);
					const values = corners.map((corner) => style.getPropertyValue(corner));
					if (values.some((value) => value !== '0px')) {
						offenders.push(`${element.className.split(/\s+/u)[0]}: ${values.join(' ')}`);
					}
				}
				return offenders;
			}, CORNERS)
			.then((offenders) => expect(offenders, label).toEqual([]));
	await sweep('dash at rest');
	for (const name of ['Off', 'Intermittent', 'Low', 'High']) {
		await dash.getByRole('radio', { name }).click();
		await sweep(`detent ${name}`);
	}
	await dash.getByRole('switch', { name: 'Wipers' }).click();
	await sweep('switch toggled');
});

for (const path of ['/', '/404', '/log', '/contact']) {
	test(`no element computes a rounded corner at ${path}`, async ({ page }) => {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
		const rounded = await page.evaluate((corners) => {
			const offenders: string[] = [];
			for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
				if (element.closest('altcha-widget') && element.tagName.toLowerCase() !== 'altcha-widget') continue;
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
