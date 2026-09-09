import type { Page } from '@playwright/test';
import { expect, test, type GuardedGoto } from './support/fixtures';

// Acceptance row (§3): the page works at 320, 375, 390, 430, 768, 1280 and
// 1440 CSS pixels and at 200% zoom, with no horizontal scroll and no clipped
// controls. The 390/430/1440 rows absorb the breakpoint set of the retired
// overflow.spec.ts (ported from the previous apex's verified breakpoints).
//
// Zoom is exercised by halving the viewport rather than by driving browser
// chrome: at 200% zoom the layout viewport is exactly half the device width in
// CSS pixels, which is the property every reflow rule is written against. The
// smallest case is held at 320 CSS pixels because that is the WCAG 1.4.10
// reflow floor, and `body { min-width: 320px }` makes anything narrower a
// deliberate non-goal rather than a defect.

const widths = [
	{ label: '320 (reflow floor)', width: 320 },
	{ label: '375 (small phone)', width: 375 },
	{ label: '390 (mobile small)', width: 390 },
	{ label: '430 (mobile large)', width: 430 },
	{ label: '768 (tablet)', width: 768 },
	{ label: '1280 (desktop)', width: 1280 },
	{ label: '1440 (wide desktop)', width: 1440 },
];

// One source of truth: the physical device width. The layout viewport a browser
// reports at 200% zoom is that width halved, so the tested viewport is DERIVED
// here rather than restated (an assertion that `width * 2 === physicalWidth`
// over two literals in the same table proves arithmetic, not the page).
const zoomCases = [1280, 768, 640].map((physicalWidth) => ({
	label: `${physicalWidth} at 200% zoom`,
	physicalWidth,
	width: physicalWidth / 2,
}));

const INTERACTIVE =
	'a[href], button, input:not([type=hidden]), textarea, select, summary, [tabindex]:not([tabindex="-1"])';

async function openPage(page: Page, guardedPage: GuardedGoto, width: number) {
	await page.setViewportSize({ width, height: 900 });
	await guardedPage('/');
}

async function horizontalOverflow(page: Page) {
	return page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth,
		widest: Array.from(document.querySelectorAll<HTMLElement>('body *'))
			// The brand-vectors background is a sanctioned CLIPPED layer (the
			// same precedent as the scroll region above, for painting instead
			// of scrolling). TinyVectors draws its blob world through a square
			// viewBox with preserveAspectRatio="slice" cover behaviour, so on
			// any non-square viewport the SVG geometry's layout rects extend
			// past the viewport edges BY DESIGN while `.brand-vectors-bg`'s
			// `overflow: clip` guarantees none of it paints or scrolls. The
			// layer is `position: fixed` (it cannot contribute to
			// document.scrollWidth, which the assertion below still proves)
			// and `pointer-events: none` with no interactive content (so the
			// clipped-controls sweep still covers everything it ever did).
			.filter((element) => !element.closest('.brand-vectors-bg'))
			.map((element) => ({ tag: element.tagName, right: element.getBoundingClientRect().right }))
			.filter((entry) => entry.right > window.innerWidth + 1)
			.slice(0, 5),
	}));
}

/**
 * A control is "clipped" when part of it sits outside the viewport on the
 * inline axis, or when it has collapsed to nothing. The honeypot is excluded by
 * selector: it is deliberately positioned off-canvas and hidden from everyone.
 */
async function clippedControls(page: Page, selector: string) {
	return page.evaluate((interactive) => {
		const results: Array<{ label: string; left: number; right: number; width: number; height: number }> = [];
		for (const element of Array.from(document.querySelectorAll<HTMLElement>(interactive))) {
			if (element.closest('.honeypot')) continue;
			// Exactly the Zag hidden inputs (the mode switch's checkbox and the
			// wiper stalk's radios, deliberately clipped 1px a11y channels) are
			// exempt; the visitor-facing targets are the 52x28 switch box and
			// the stalk's labelled items. Nothing else in either subtree gets a pass.
			if (element.tagName === 'INPUT' && element.closest('.mode-switch, .wiper-stalk')) continue;
			if (element.offsetParent === null && getComputedStyle(element).position !== 'fixed') continue;
			const box = element.getBoundingClientRect();
			const label = `${element.tagName.toLowerCase()}:${(element.textContent ?? '').trim().slice(0, 24) || element.id}`;
			if (box.width === 0 || box.height === 0 || box.left < -1 || box.right > window.innerWidth + 1) {
				results.push({ label, left: box.left, right: box.right, width: box.width, height: box.height });
			}
		}
		return results;
	}, selector);
}

for (const { label, width } of widths) {
	test(`home page reflows without horizontal scroll at ${label}`, async ({ page, guardedPage }) => {
		await openPage(page, guardedPage, width);
		const overflow = await horizontalOverflow(page);
		expect(overflow.widest, `elements overflowing at ${label}`).toEqual([]);
		expect(overflow.scrollWidth, `document overflow at ${label}`).toBeLessThanOrEqual(overflow.innerWidth + 1);
	});

	test(`every control stays on screen and hittable at ${label}`, async ({ page, guardedPage }) => {
		await openPage(page, guardedPage, width);
		expect(await clippedControls(page, INTERACTIVE), `clipped controls at ${label}`).toEqual([]);
	});
}

for (const { label, width } of zoomCases) {
	test(`home page reflows without horizontal scroll at ${label}`, async ({ page, guardedPage }) => {
		await openPage(page, guardedPage, width);
		const overflow = await horizontalOverflow(page);
		expect(overflow.widest, `elements overflowing at ${label}`).toEqual([]);
		expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
	});

	test(`every control stays on screen and hittable at ${label}`, async ({ page, guardedPage }) => {
		await openPage(page, guardedPage, width);
		expect(await clippedControls(page, INTERACTIVE), `clipped controls at ${label}`).toEqual([]);
	});
}

/**
 * WCAG 2.2 SC 2.5.8 (Target Size, Minimum) as written, including its two
 * exceptions: a target set inline in a sentence is exempt, and an undersized
 * target passes when a 24 CSS pixel circle centred on it touches no other
 * target. Asserting the bare 24x24 rectangle instead would fail the header nav
 * for a spacing reason the specification explicitly permits.
 */
test('interactive targets satisfy WCAG 2.2 target size on a phone', async ({ page, guardedPage }) => {
	await openPage(page, guardedPage, 375);
	const offenders = await page.evaluate((interactive) => {
		const targets = Array.from(document.querySelectorAll<HTMLElement>(interactive))
			// Exactly the mode-switch input (the clipped 1px a11y channel) is
			// exempt; its real target box (the 52x28 control, ≥24px both
			// dimensions so SC 2.5.8 needs no spacing exception) is asserted
			// by e2e/acceptance-mode-switch.spec.ts. Nothing else inside the
			// switch subtree gets a pass.
			.filter((element) => !element.closest('.honeypot'))
			.filter((element) => !(element.tagName === 'INPUT' && element.closest('.mode-switch, .wiper-stalk')))
			.map((element) => ({ element, box: element.getBoundingClientRect() }))
			.filter((target) => target.box.width > 0 && target.box.height > 0);

		const centreOf = (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
		const label = (element: HTMLElement) =>
			`${element.tagName.toLowerCase()}:${(element.textContent ?? '').trim().slice(0, 24) || element.id}`;

		const results: Array<{ label: string; width: number; height: number; reason: string }> = [];
		for (const target of targets) {
			if (target.box.width >= 24 && target.box.height >= 24) continue;

			// Inline exception: the target sits in a line of text it does not control.
			const display = getComputedStyle(target.element).display;
			const parentText = (target.element.parentElement?.textContent ?? '').trim();
			const ownText = (target.element.textContent ?? '').trim();
			if (display.startsWith('inline') && parentText.length > ownText.length) continue;

			// Spacing exception: a 24px circle on this target may touch nothing else.
			const centre = centreOf(target.box);
			const crowdedBy = targets.find((other) => {
				if (other === target) return false;
				const otherCentre = centreOf(other.box);
				const centreDistance = Math.hypot(centre.x - otherCentre.x, centre.y - otherCentre.y);
				const overlapsBox =
					centre.x + 12 > other.box.left &&
					centre.x - 12 < other.box.right &&
					centre.y + 12 > other.box.top &&
					centre.y - 12 < other.box.bottom;
				return centreDistance < 24 || overlapsBox;
			});
			if (!crowdedBy) continue;

			results.push({
				label: label(target.element),
				width: target.box.width,
				height: target.box.height,
				reason: `24px circle intersects ${label(crowdedBy.element)}`,
			});
		}
		return results;
	}, INTERACTIVE);
	expect(offenders, 'targets failing SC 2.5.8 with both exceptions applied').toEqual([]);
});

test('the image that dominates the page cannot force a horizontal scrollbar', async ({ page, guardedPage }) => {
	await openPage(page, guardedPage, 320);
	const overflowing = await page.evaluate(() =>
		Array.from(document.images)
			.filter((image) => image.getBoundingClientRect().width > window.innerWidth + 1)
			.map((image) => image.currentSrc || image.src),
	);
	expect(overflowing).toEqual([]);
});
