import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

// Registered in the finite browser target within the validate action.
//
// The phone-motion permission is a silent first-gesture handshake (operator
// ruling 2026-09-09): no control is rendered, the visitor's first
// neutral tap inside main is borrowed once, and taps on links, buttons and
// fields are never borrowed. Headless Chromium has no
// `DeviceOrientationEvent.requestPermission`, so the harness below installs
// one that counts calls, and holds the layout's idle mount so the deferred
// binding (the moment the handshake can arm) is under test control.
type PermissionApi = 'granted' | 'denied' | 'absent';

async function holdVectorMount(page: Page, permission: PermissionApi = 'granted') {
	await page.addInitScript((result) => {
		if (result !== 'absent') {
			let permissionCalls = 0;
			Object.defineProperty(window, 'DeviceOrientationEvent', {
				configurable: true,
				value: class extends Event {
					static requestPermission() {
						permissionCalls += 1;
						document.documentElement.dataset.motionPermissionCalls = String(permissionCalls);
						return Promise.resolve(result);
					}
				},
			});
		}
		const pending = new Map<number, IdleRequestCallback>();
		let nextId = 0;
		window.requestIdleCallback = (callback) => {
			const id = ++nextId;
			pending.set(id, callback);
			document.documentElement.dataset.vectorMountWaiting = 'true';
			return id;
		};
		window.cancelIdleCallback = (id) => pending.delete(id);
		window.addEventListener('release-vector-mount', () => {
			const callbacks = [...pending.values()];
			pending.clear();
			for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => 50 });
		});
	}, permission);
}

const releaseMount = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('release-vector-mount')));
const html = (page: Page) => page.locator('html');
const noControl = (page: Page) => page.getByRole('button', { name: /blobs|phone|motion/iu });
/** A neutral tap: the section heading is plain text inside main. */
const neutralSpot = (page: Page) => page.locator('#goals h2');

for (const permission of ['granted', 'denied'] as const) {
	test(`the first neutral tap inside main asks once, interactive taps never do: ${permission}`, async ({
		page,
		guardedPage,
	}) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await holdVectorMount(page, permission);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await guardedPage();
		await expect(html(page)).toHaveAttribute('data-vector-mount-waiting', 'true');
		await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(0);
		await expect(html(page)).not.toHaveAttribute('data-motion-handshake');
		await releaseMount(page);
		await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(1);
		// Nothing rendered; the handshake is armed on the deferred binding.
		await expect(noControl(page)).toHaveCount(0);
		await expect(html(page)).toHaveAttribute('data-motion-handshake', 'armed');
		await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');

		// A tap on a control inside main (the wiper stalk's Off detent) does its
		// own job and is never borrowed; Intermittent puts the wipers back.
		const stalk = page.locator('#goals .wiper-stalk');
		await expect(stalk).toHaveCount(1);
		await stalk.locator('.wiper-stalk__item', { hasText: 'Off' }).click();
		await expect(page.getByRole('radio', { name: 'Off' })).toBeChecked();
		await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');
		await stalk.locator('.wiper-stalk__item', { hasText: 'Intermittent' }).click();
		await expect(page.getByRole('radio', { name: 'Intermittent' })).toBeChecked();
		await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');
		await expect(html(page)).toHaveAttribute('data-motion-handshake', 'armed');
		// A tap on a link is never borrowed either (prevent navigation for the assertion only).
		const link = page.locator('#goals .goal-cta a').first();
		await link.evaluate((el) => el.addEventListener('click', (event) => event.preventDefault(), { once: true }));
		await link.click();
		await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');

		// The first neutral tap asks exactly once; later taps never ask again.
		await neutralSpot(page).click();
		await expect(html(page)).toHaveAttribute('data-motion-permission-calls', '1');
		await expect(html(page)).toHaveAttribute('data-motion-handshake', 'asked');
		await neutralSpot(page).click();
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await neutralSpot(page).click();
		await expect(html(page)).toHaveAttribute('data-motion-permission-calls', '1');
		await expect(noControl(page)).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

test('reduced motion never arms; lifting it arms without asking', async ({ page, guardedPage }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await holdVectorMount(page);
	await guardedPage();
	await expect(html(page)).toHaveAttribute('data-vector-mount-waiting', 'true');
	await releaseMount(page);
	await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(1);
	await expect(html(page)).not.toHaveAttribute('data-motion-handshake');
	await neutralSpot(page).click();
	await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await expect(html(page)).toHaveAttribute('data-motion-handshake', 'armed');
	await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await expect(html(page)).not.toHaveAttribute('data-motion-handshake');
	await neutralSpot(page).click();
	await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');
	await expect(noControl(page)).toHaveCount(0);
});

test('browsers without a permission API never arm and still mount the layer', async ({ page, guardedPage }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await holdVectorMount(page, 'absent');
	await guardedPage();
	await releaseMount(page);
	await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(1);
	await neutralSpot(page).click();
	await page.waitForTimeout(300);
	await expect(html(page)).not.toHaveAttribute('data-motion-handshake');
	await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');
	await expect(noControl(page)).toHaveCount(0);
});

test('the contact page never borrows a tap', async ({ page, guardedPage }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await holdVectorMount(page, 'granted');
	await guardedPage('/contact');
	await releaseMount(page);
	await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(1);
	await expect(html(page)).toHaveAttribute('data-motion-handshake', 'armed');
	await page.locator('main h1').first().click();
	await page.waitForTimeout(300);
	await expect(html(page)).not.toHaveAttribute('data-motion-permission-calls');
	await expect(html(page)).toHaveAttribute('data-motion-handshake', 'armed');
	await expect(noControl(page)).toHaveCount(0);
});
