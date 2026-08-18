import { expect, test } from '@playwright/test';
import { contrastRatio, formatRgb, roundRatio } from '../scripts/lib/color-contrast.mjs';

// The colour maths comes from the shared module rather than a local copy. The
// local copy read `getComputedStyle` output with /[\d.]+/ and assumed rgb();
// once the panel moved onto CityLink tokens Chromium started returning
// `oklch(0.3832 0.0755 294.64)`, which that regex read as a red channel of
// 0.3832 — turning a 12.4:1 pair into a reported 1.0:1 failure.

test.use({ viewport: { width: 375, height: 667 } });

test('mobile public front door exposes current status and working anchors', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Tools belong in motion.' })).toBeAttached();
	await expect(page.getByText('Building, not lending yet.')).toBeAttached();
	await expect(page.getByText('Schedule being confirmed')).toBeAttached();
	await expect(page.getByText('Sunday, August 16, 2026 · afternoon')).toHaveCount(0);

	await page.getByRole('link', { name: 'Help build the bus' }).click();
	await expect(page).toHaveURL(/#contact$/);
	await expect(page.getByRole('heading', { name: 'Bring a question, a skill, or a tool story.' })).toBeAttached();
});

test('keyboard users can leave the repeated header and reach main content', async ({ page }) => {
	await page.goto('/');
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/#main-content$/);
	await expect(page.locator('main')).toBeFocused();
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
	await page.goto('/#contact');
	await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeAttached();
	await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeAttached();
	await expect(page.getByRole('button', { name: 'Send to keyholders' })).toBeAttached();

	const publicArchive = page.getByRole('link', { name: 'public discussion archive' });
	await expect(publicArchive).toHaveAttribute('href', 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/');
	await expect(page.getByText('Its archive is not public.')).toBeAttached();
});

test('contact helper and validation text remain readable on the dark panel', async ({ page }) => {
	await page.goto('/#contact');
	await page.getByRole('button', { name: 'Send to keyholders' }).click();

	const contactBackground = await page
		.locator('.contact-card')
		.evaluate((element) => getComputedStyle(element).backgroundColor);
	const helperColor = await page.locator('.form-help').evaluate((element) => getComputedStyle(element).color);
	const errorColor = await page
		.locator('.field-error')
		.first()
		.evaluate((element) => getComputedStyle(element).color);

	const helperRatio = roundRatio(contrastRatio(helperColor, contactBackground));
	const errorRatio = roundRatio(contrastRatio(errorColor, contactBackground));
	const panel = formatRgb(contactBackground);
	expect(
		helperRatio,
		`helper text ${formatRgb(helperColor)} on ${panel} measured ${helperRatio}:1`,
	).toBeGreaterThanOrEqual(4.5);
	expect(
		errorRatio,
		`field error ${formatRgb(errorColor)} on ${panel} measured ${errorRatio}:1`,
	).toBeGreaterThanOrEqual(4.5);
});
