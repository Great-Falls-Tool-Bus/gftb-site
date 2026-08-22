import { expect, test } from '@playwright/test';

// ContributeMenu.svelte (review round 1 finding C, round 2 follow-up):
// shipped with zero e2e coverage, which review round 2 named as exactly why
// the no-js, sharp-edges, print and motion sweeps all stayed green through
// three real defects (dead no-JS control, un-rendered blur, a 320px click
// steal on the footer). This spec exercises the component directly rather
// than relying on generic sweeps to happen to cover it.

test.describe('no-JS', () => {
	test.use({ javaScriptEnabled: false });

	test('the trigger is absent, not dead, without JavaScript', async ({ page }) => {
		// Review round 2 finding C.1: the prior revision shipped the trigger in
		// the served HTML — advertising aria-haspopup/aria-controls to
		// assistive tech — with no menu markup and no working click. The fix
		// mounts nothing until hydrated, so a no-JS visitor sees no trigger at
		// all (absent gracefully) rather than a broken one.
		for (const path of ['/', '/contact', '/log', '/404']) {
			await page.goto(path);
			await expect(page.locator('.contribute-trigger')).toHaveCount(0);
			await expect(page.locator('.contribute-fab')).toHaveCount(0);
		}
	});
});

test.describe('hydrated behaviour', () => {
	test('the trigger mounts after hydration and opens/closes the menu', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.contribute-trigger')).toBeVisible();
		await expect(page.locator('.contribute-panel')).toHaveCount(0);

		await page.locator('.contribute-trigger').click();
		await expect(page.locator('.contribute-panel')).toBeVisible();
		await expect(page.locator('.contribute-trigger')).toHaveAttribute('aria-expanded', 'true');

		await page.keyboard.press('Escape');
		await expect(page.locator('.contribute-panel')).toHaveCount(0);
		await expect(page.locator('.contribute-trigger')).toBeFocused();
	});

	test('role=menu contains only menuitems — no header or close button as direct children (review round 2)', async ({
		page,
	}) => {
		await page.goto('/');
		await page.locator('.contribute-trigger').click();
		const menu = page.locator('[role="menu"]');
		await expect(menu).toBeVisible();
		const directChildTags = await menu.evaluate((el) =>
			Array.from(el.children).map((child) => ({ tag: child.tagName, role: child.getAttribute('role') })),
		);
		// Every direct child of role=menu must itself be role=presentation (the
		// <ul> wrapper) — no <p> header, no <button> close as a sibling inside
		// the menu role.
		for (const child of directChildTags) {
			expect(child.role, `direct child of role=menu: <${child.tag}>`).toBe('presentation');
		}
		// The header and close button live OUTSIDE role=menu, as siblings
		// within .contribute-panel.
		await expect(page.locator('.contribute-panel__header')).toBeVisible();
		const headerInsideMenu = await menu.locator('.contribute-panel__header').count();
		expect(headerInsideMenu, 'header must not be a descendant of role=menu').toBe(0);
	});

	test('menuitems carry aria-posinset/aria-setsize for "N of M" announcement', async ({ page }) => {
		await page.goto('/');
		await page.locator('.contribute-trigger').click();
		const items = page.locator('[role="menuitem"]');
		await expect(items).toHaveCount(2);
		await expect(items.nth(0)).toHaveAttribute('aria-posinset', '1');
		await expect(items.nth(0)).toHaveAttribute('aria-setsize', '2');
		await expect(items.nth(1)).toHaveAttribute('aria-posinset', '2');
		await expect(items.nth(1)).toHaveAttribute('aria-setsize', '2');
	});

	test('the close button is keyboard-reachable (review round 2: it was not)', async ({ page }) => {
		await page.goto('/');
		await page.locator('.contribute-trigger').click();
		// Focus lands on the first item on open (APG menu-button pattern).
		await expect(page.locator('[role="menuitem"]').first()).toBeFocused();
		// Shift+Tab from the first item must reach the close button — the
		// trap now spans the whole panel, not just the items.
		await page.keyboard.press('Shift+Tab');
		await expect(page.locator('.contribute-panel__close')).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.locator('.contribute-panel')).toHaveCount(0);
	});

	test('backdrop-filter actually renders on the panel (review round 2 finding C.2)', async ({ page }) => {
		await page.goto('/');
		await page.locator('.contribute-trigger').click();
		const computed = await page.locator('.contribute-panel').evaluate((el) => getComputedStyle(el).backdropFilter);
		expect(computed, 'computed backdrop-filter on .contribute-panel').not.toBe('none');
		expect(computed, 'computed backdrop-filter on .contribute-panel').toContain('blur');
	});

	test('never renders on a print media emulation', async ({ page }) => {
		await page.goto('/');
		await page.emulateMedia({ media: 'print' });
		await expect(page.locator('.contribute-fab')).toBeHidden();
	});
});

test.describe('320px footer clearance (review round 2 finding C.3)', () => {
	test('the closed trigger does not steal the footer Security link click', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await page.goto('/');
		await page.mouse.wheel(0, 100000); // scroll to the true bottom
		const security = page.getByRole('link', { name: /Security/ });
		await expect(security).toBeVisible();
		// A real click, not a geometry check — this is what the review used to
		// prove the collision (a visual near-miss can still steal the click if
		// the fixed trigger's hit area is on top).
		const [popup] = await Promise.all([page.waitForEvent('popup'), security.click()]);
		expect(popup.url()).toContain('github.com');
		await popup.close();
		// The click must not also have opened the contribute menu.
		await expect(page.locator('.contribute-panel')).toHaveCount(0);
	});

	test('the closed trigger does not steal the footer licensing link click on /log', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 800 });
		await page.goto('/log');
		await page.mouse.wheel(0, 100000);
		const license = page.getByRole('link', { name: /CC BY-SA/ });
		await expect(license).toBeVisible();
		// This particular link is a plain <a> (no target="_blank"), unlike the
		// ExternalLink-rendered Source/Security rows — it navigates same-tab.
		await license.click();
		await expect(page).toHaveURL(/creativecommons\.org/);
	});
});
