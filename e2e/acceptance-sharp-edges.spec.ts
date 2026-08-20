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

for (const path of ['/', '/404']) {
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
