import { expect, test } from '@playwright/test';
import {
	compositeOver,
	contrastRatio,
	formatRgb,
	parseCssColor,
	roundRatio,
	type Rgb,
} from '../scripts/lib/color-contrast.mjs';

// The colour maths comes from the shared module rather than a local copy. The
// local copy read `getComputedStyle` output with /[\d.]+/ and assumed rgb();
// once the panel moved onto CityLink tokens Chromium started returning
// `oklch(0.3832 0.0755 294.64)`, which that regex read as a red channel of
// 0.3832 — turning a 12.4:1 pair into a reported 1.0:1 failure.

test.use({ viewport: { width: 375, height: 667 } });

test('mobile public front door exposes current status and working anchors', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Great Falls Tool Bus', level: 1 })).toBeAttached();
	await expect(page.getByText('Current status')).toBeAttached();
	await expect(page.locator('.hero .hero-session')).toContainText('Fridays, about 3 to 5 PM ET');
	await expect(page.getByText('Sunday, August 16, 2026 · afternoon')).toHaveCount(0);

	// The primary CTA is a page link now (B1.4): the form lives on /contact.
	await page.getByRole('link', { name: 'Help build the bus' }).click();
	await expect(page).toHaveURL(/\/contact\/?$/);
	await expect(page.getByRole('heading', { name: 'Contact', exact: true })).toBeAttached();
});

test('keyboard users can leave the repeated header and reach main content', async ({ page }) => {
	await page.goto('/');
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/#main-content$/);
	await expect(page.locator('main')).toBeFocused();
});

// B3 (previous apex drawer hit-test, adapted to the anchor nav): every header
// nav link is fully inside the viewport AND actually receives a tap at its
// centre — content stacked over the nav and off-canvas overflow both fail
// here. This is the #139 bug class: a wide brand once pushed the nav control
// past the right edge at this exact viewport.
test('header nav links are on-screen and receive the tap at 375px', async ({ page }) => {
	await page.goto('/');
	const links = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link');
	const count = await links.count();
	expect(count).toBeGreaterThan(0);
	for (let index = 0; index < count; index += 1) {
		const geometry = await links.nth(index).evaluate((element) => {
			const rect = element.getBoundingClientRect();
			const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
			return {
				fullyInside: rect.left >= 0 && rect.right <= window.innerWidth,
				hittable: hit !== null && (element === hit || element.contains(hit)),
			};
		});
		expect(geometry.fullyInside, `nav link ${index} sits fully inside the viewport`).toBe(true);
		expect(geometry.hittable, `nav link ${index} receives the tap at its centre`).toBe(true);
	}
});

// B1 at the 320px reflow floor against a hostile brand: the wordmark column
// must shrink (grid minmax(0,auto) + min-width: 0) rather than push the nav
// off the right edge or widen the document.
test('a long brand string cannot push the nav off-edge at 320px', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 667 });
	await page.goto('/');
	await page.evaluate(() => {
		const wordmark = document.querySelector('.brand span');
		if (wordmark) wordmark.textContent = 'GreatFallsToolBusWordmarkOverflowFixture Extended Edition';
	});
	const state = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth,
		headerHeight: document.querySelector('.site-header')?.getBoundingClientRect().height ?? Number.NaN,
		navLinks: Array.from(document.querySelectorAll('.site-nav a')).map((element) => {
			const rect = element.getBoundingClientRect();
			return rect.left >= 0 && rect.right <= window.innerWidth;
		}),
	}));
	expect(state.navLinks.length).toBeGreaterThan(0);
	expect(state.navLinks.every(Boolean), 'nav links all fully on-screen with the fixture brand').toBe(true);
	expect(state.scrollWidth, 'document overflow with the fixture brand').toBeLessThanOrEqual(state.innerWidth + 1);
	// The wordmark clamps at three lines, so a hostile brand cannot grow the
	// sticky header without bound (unclamped, this fixture reached ~192px —
	// more than half of a 320x568 viewport gone to chrome). Ceiling re-tuned
	// for the ported demo type scale (18px base, B1.3): three clamped lines
	// measure ~87px; 92 keeps the bound tight.
	expect(state.headerHeight, 'sticky header height with the fixture brand').toBeLessThanOrEqual(92);
});

test('mobile navigation links keep a usable minimum target height', async ({ page }) => {
	await page.goto('/');
	const links = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link');
	const boxes = await links.evaluateAll((elements) =>
		elements.map((element) => element.getBoundingClientRect().height),
	);
	expect(boxes.every((height) => height >= 24)).toBe(true);
});

test('reduced-motion preference disables smooth anchor scrolling', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	const scrollBehavior = await page.locator('html').evaluate((element) => getComputedStyle(element).scrollBehavior);
	expect(scrollBehavior).toBe('auto');
});

test('contact surface keeps public discussion and private access distinct', async ({ page }) => {
	await page.goto('/contact');
	await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeAttached();
	await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeAttached();
	await expect(page.getByRole('button', { name: 'Send to keyholders' })).toBeAttached();

	const publicArchive = page.getByRole('link', { name: 'public discussion archive' });
	await expect(publicArchive).toHaveAttribute('href', 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/');
	await expect(page.getByText('Its archive is not public.')).toBeAttached();
});

test('contact helper and validation text remain readable on the contact card', async ({ page }) => {
	await page.goto('/contact');
	await page.getByRole('button', { name: 'Send to keyholders' }).click();

	// The 2026-08-31 flattening left .contact-card with no fill of its own, so
	// the ground this resolves to is now the page itself. The composite walk
	// stays anyway: it reads whatever IS painted rather than assuming, which is
	// exactly what let it keep measuring the truth across the panel era, the
	// translucent-card era and now. Same method acceptance-contrast uses.
	const layers = await page.locator('.form-help').evaluate((element) => {
		const stack: string[] = [];
		let node: Element | null = element;
		while (node) {
			stack.push(getComputedStyle(node).backgroundColor);
			node = node.parentElement;
		}
		return stack;
	});
	const painted = layers.map((layer) => parseCssColor(layer)).filter((layer) => layer.alpha > 0);
	let ground: Rgb = { red: 255, green: 255, blue: 255, alpha: 1 };
	for (let index = painted.length - 1; index >= 0; index -= 1) {
		ground = compositeOver(painted[index], ground);
	}
	const helperColor = await page.locator('.form-help').evaluate((element) => getComputedStyle(element).color);
	const errorColor = await page
		.locator('.field-error')
		.first()
		.evaluate((element) => getComputedStyle(element).color);

	const helperRatio = roundRatio(contrastRatio(helperColor, ground));
	const errorRatio = roundRatio(contrastRatio(errorColor, ground));
	const panel = formatRgb(ground);
	expect(
		helperRatio,
		`helper text ${formatRgb(helperColor)} on ${panel} measured ${helperRatio}:1`,
	).toBeGreaterThanOrEqual(4.5);
	expect(
		errorRatio,
		`field error ${formatRgb(errorColor)} on ${panel} measured ${errorRatio}:1`,
	).toBeGreaterThanOrEqual(4.5);
});
