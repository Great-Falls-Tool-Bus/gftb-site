import { expect, test } from '@playwright/test';

// Acceptance rows for the light/dark switcher (D01+D02): the v5 Switch in
// the header's third column, the data-mode re-key, the FOUC script, and the
// demo's mode model — `light | dark | system` with `system` the default for
// new visitors, an explicit choice persisted under `color-mode`, and the
// switch always reflecting the RESOLVED mode.

const MODE = () => document.documentElement.getAttribute('data-mode');

test.describe('mode model', () => {
	test('a new visitor defaults to system and the switch reflects the resolved light mode', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		expect(await page.evaluate(MODE)).toBe('light');
		await expect(page.locator('.mode-switch input')).not.toBeChecked();
		// `system` stores nothing: the absence of the key IS the default.
		expect(await page.evaluate(() => localStorage.getItem('color-mode'))).toBeNull();
		// The affordance says so: the demo's Auto title in the system state.
		await expect(page.locator('.mode-switch')).toHaveAttribute('title', 'Auto (matches your system)');
	});

	test('a system visitor on a dark OS resolves dark before hydration', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		// The FOUC script in app.html sets the attribute synchronously in
		// <head>, so this holds at domcontentloaded — before Svelte mounts.
		expect(await page.evaluate(MODE)).toBe('dark');
		expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('.mode-switch input')).toBeChecked();
	});

	test('flipping the switch persists an explicit mode and repaints the role layer', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const lightBackground = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

		await page.locator('.mode-switch').click();

		await expect(page.locator('.mode-switch input')).toBeChecked();
		expect(await page.evaluate(MODE)).toBe('dark');
		expect(await page.evaluate(() => localStorage.getItem('color-mode'))).toBe('dark');
		expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark');
		await expect(page.locator('.mode-switch')).toHaveAttribute('title', 'Dark mode');
		// The re-keyed dark block actually paints: the page ground flips with
		// the attribute, no OS involvement.
		const darkBackground = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
		expect(darkBackground).not.toBe(lightBackground);
	});

	test('an explicit choice survives reload and wins before hydration', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await page.locator('.mode-switch').click();
		expect(await page.evaluate(() => localStorage.getItem('color-mode'))).toBe('dark');

		await page.reload({ waitUntil: 'domcontentloaded' });
		// Explicit value beats the (light) OS scheme, synchronously.
		expect(await page.evaluate(MODE)).toBe('dark');
		await page.waitForLoadState('networkidle');
		await expect(page.locator('.mode-switch input')).toBeChecked();
	});

	test('a system visitor follows a live OS scheme change', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		expect(await page.evaluate(MODE)).toBe('light');

		// Still on `system` (nothing stored), so the store's matchMedia change
		// listener re-resolves the mode. (The demo-verbatim store updates the
		// DOM attribute here; the switch's own derived state re-reads the
		// media on its next re-evaluation — the demo's shipped behaviour.)
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect.poll(async () => page.evaluate(() => document.documentElement.getAttribute('data-mode'))).toBe('dark');
		// Following the OS is not an explicit choice: still nothing stored.
		expect(await page.evaluate(() => localStorage.getItem('color-mode'))).toBeNull();
	});
});

test.describe('the switch as a control', () => {
	test('the visible control meets the 24px target floor and receives the tap at 375px', async ({ page }) => {
		// The responsive sweeps exempt Zag's clipped 1px hidden input; this is
		// the counterpart row those exemptions cite — the visitor-facing
		// target is the control box.
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const geometry = await page.locator('.mode-switch__control').evaluate((element) => {
			const rect = element.getBoundingClientRect();
			const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
			return {
				width: rect.width,
				height: rect.height,
				fullyInside: rect.left >= 0 && rect.right <= window.innerWidth,
				hittable: hit !== null && (hit.closest('.mode-switch') !== null || hit === element || element.contains(hit)),
			};
		});
		expect(geometry.width, 'control width').toBeGreaterThanOrEqual(24);
		expect(geometry.height, 'control height').toBeGreaterThanOrEqual(24);
		expect(geometry.fullyInside, 'control fully inside the viewport').toBe(true);
		expect(geometry.hittable, 'control receives the tap at its centre').toBe(true);
	});

	test('the switch is keyboard-operable and shows the rescue-edge focus ring', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const input = page.locator('.mode-switch input');
		await input.focus();
		await page.keyboard.press('Space');
		await expect(input).toBeChecked();
		expect(await page.evaluate(() => document.documentElement.getAttribute('data-mode'))).toBe('dark');
		await page.keyboard.press('Space');
		await expect(input).not.toBeChecked();
		// The focusable element carries a computed indicator of its own (the
		// acceptance-motion-keyboard sweep's contract).
		const outline = await input.evaluate((element) => getComputedStyle(element).outlineStyle);
		expect(outline).not.toBe('none');
	});
});
