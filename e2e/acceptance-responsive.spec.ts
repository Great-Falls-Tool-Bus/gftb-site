import { expect, test, type Page } from '@playwright/test';
import { installExternalGuard, stubChallenge } from './support/network';

// Acceptance row (§3): the page works at 320, 375, 768 and 1280 CSS pixels and
// at 200% zoom, with no horizontal scroll and no clipped controls.
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
	{ label: '768 (tablet)', width: 768 },
	{ label: '1280 (desktop)', width: 1280 },
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

async function openPage(page: Page, baseURL: string | undefined, width: number) {
	await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
	await stubChallenge(page);
	await page.setViewportSize({ width, height: 900 });
	await page.goto('/');
	await page.waitForLoadState('domcontentloaded');
}

async function horizontalOverflow(page: Page) {
	return page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth,
		widest: Array.from(document.querySelectorAll<HTMLElement>('body *'))
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
	test(`home page reflows without horizontal scroll at ${label}`, async ({ page, baseURL }) => {
		await openPage(page, baseURL, width);
		const overflow = await horizontalOverflow(page);
		expect(overflow.widest, `elements overflowing at ${label}`).toEqual([]);
		expect(overflow.scrollWidth, `document overflow at ${label}`).toBeLessThanOrEqual(overflow.innerWidth + 1);
	});

	test(`every control stays on screen and hittable at ${label}`, async ({ page, baseURL }) => {
		await openPage(page, baseURL, width);
		expect(await clippedControls(page, INTERACTIVE), `clipped controls at ${label}`).toEqual([]);
	});
}

for (const { label, width } of zoomCases) {
	test(`home page reflows without horizontal scroll at ${label}`, async ({ page, baseURL }) => {
		await openPage(page, baseURL, width);
		const overflow = await horizontalOverflow(page);
		expect(overflow.widest, `elements overflowing at ${label}`).toEqual([]);
		expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
	});

	test(`every control stays on screen and hittable at ${label}`, async ({ page, baseURL }) => {
		await openPage(page, baseURL, width);
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
test('interactive targets satisfy WCAG 2.2 target size on a phone', async ({ page, baseURL }) => {
	await openPage(page, baseURL, 375);
	const offenders = await page.evaluate((interactive) => {
		const targets = Array.from(document.querySelectorAll<HTMLElement>(interactive))
			.filter((element) => !element.closest('.honeypot'))
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

/**
 * TIN-3932. `.history-card img` carried `height: 100%`, so the photo consumed
 * the whole grid row and the <figcaption> spilled out of its <figure> into the
 * next row. Above 48rem that row is empty and the card looked correct; below it
 * the row holds `.history-card__copy`, so the credit line printed across the
 * "Why Great Falls?" eyebrow — 41 CSS px of overlap at 320, 17 at 600.
 *
 * The assertion is geometric rather than visual, and both rectangles are read in
 * one evaluate so no scroll can happen between them: the caption's border box
 * and the copy block's border box may not intersect at any tested width. The
 * two-column widths are included so a future fix cannot trade the phone bug for
 * a desktop one.
 */
test('the photo credit never overlaps the history copy', async ({ page, baseURL }) => {
	const collisions: Array<{ width: number; overlapX: number; overlapY: number }> = [];
	for (const width of [320, 375, 414, 480, 600, 768, 1280]) {
		await openPage(page, baseURL, width);
		await page.locator('.history-card').scrollIntoViewIfNeeded();
		const overlap = await page.evaluate(() => {
			const caption = document.querySelector('.history-card figcaption');
			const copy = document.querySelector('.history-card__copy');
			if (!caption || !copy) return null;
			const a = caption.getBoundingClientRect();
			const b = copy.getBoundingClientRect();
			return {
				overlapX: Math.min(a.right, b.right) - Math.max(a.left, b.left),
				overlapY: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
			};
		});
		expect(overlap, `.history-card figcaption and __copy must both exist at ${width}`).not.toBeNull();
		if (overlap!.overlapX > 0 && overlap!.overlapY > 0) {
			collisions.push({ width, overlapX: Math.round(overlap!.overlapX), overlapY: Math.round(overlap!.overlapY) });
		}
	}
	expect(collisions, 'widths where the photo credit intersects the history copy').toEqual([]);
});

/**
 * Restoration PR-3 (inventory acceptance row): the BPL credit line must be
 * fully visible at the two-column widths, in both colour schemes. #18 fixed
 * the root cause (the figure is a flex column; the caption is normal-flow),
 * and the overlap test above guards the caption-vs-copy collision — but a
 * caption pushed past the card's own `overflow: hidden` bottom edge
 * intersects nothing and would pass it.
 *
 * Measurement discipline (review finding on this row's first cut): an
 * `overflow: hidden` box is still programmatically scrollable, so a
 * scrollIntoView aimed at the caption can scroll the CLIP BOX itself and
 * manufacture a pass over a clipped caption. Only the document scrolls here
 * — with `behavior: 'instant'` so `html { scroll-behavior: smooth }` cannot
 * animate under the measurement — and the card must prove both of its own
 * scroll offsets are still zero. Every geometry read happens inside one
 * evaluate so nothing can move between reads.
 */
for (const scheme of ['light', 'dark'] as const) {
	test(`the photo credit stays visible and hittable at desktop widths (${scheme})`, async ({ page, baseURL }) => {
		await page.emulateMedia({ colorScheme: scheme });
		for (const width of [768, 1024, 1440]) {
			await openPage(page, baseURL, width);
			const state = await page.evaluate(() => {
				const caption = document.querySelector('.history-card figcaption');
				const card = document.querySelector('.history-card');
				if (!caption || !card) return null;
				// Document-level scroll only: centre the caption's layout slot in
				// the viewport without touching any inner scroll container.
				const target = caption.getBoundingClientRect();
				window.scrollBy({ top: target.top + target.height / 2 - window.innerHeight / 2, behavior: 'instant' });
				const rect = caption.getBoundingClientRect();
				const cardRect = card.getBoundingClientRect();
				const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
				return {
					cardScrollTop: card.scrollTop,
					cardScrollLeft: card.scrollLeft,
					captionHeight: rect.height,
					insideClipBox:
						rect.top >= cardRect.top - 1 &&
						rect.bottom <= cardRect.bottom + 1 &&
						rect.left >= cardRect.left - 1 &&
						rect.right <= cardRect.right + 1,
					centreHitsCaption: hit !== null && (hit === caption || caption.contains(hit)),
				};
			});
			expect(state, `.history-card and its figcaption must both exist at ${width}`).not.toBeNull();
			expect(state!.cardScrollTop, `card clip box unscrolled vertically at ${width} (${scheme})`).toBe(0);
			expect(state!.cardScrollLeft, `card clip box unscrolled horizontally at ${width} (${scheme})`).toBe(0);
			expect(state!.captionHeight, `caption has real height at ${width} (${scheme})`).toBeGreaterThan(0);
			expect(state!.insideClipBox, `caption inside the card's unscrolled clip box at ${width} (${scheme})`).toBe(true);
			expect(state!.centreHitsCaption, `caption centre receives the hit at ${width} (${scheme})`).toBe(true);
		}
	});
}

test('the image that dominates the page cannot force a horizontal scrollbar', async ({ page, baseURL }) => {
	await openPage(page, baseURL, 320);
	const overflowing = await page.evaluate(() =>
		Array.from(document.images)
			.filter((image) => image.getBoundingClientRect().width > window.innerWidth + 1)
			.map((image) => image.currentSrc || image.src),
	);
	expect(overflowing).toEqual([]);
});
