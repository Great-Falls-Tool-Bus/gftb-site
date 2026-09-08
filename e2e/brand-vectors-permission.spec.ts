import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';

// Registered in the finite browser target within the validate action.
// Hold the actual layout's idle mount, rather than testing an already-bound
// component that would also pass an erroneous onMount-only capability check.
async function holdVectorMount(page: Page, permission: 'granted' | 'denied' = 'granted') {
	await page.addInitScript((result) => {
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

for (const permission of ['granted', 'denied'] as const) {
	test(`the deferred phone control requests permission only on click: ${permission}`, async ({ page, guardedPage }) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await holdVectorMount(page, permission);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await guardedPage();
		await expect(page.locator('html')).toHaveAttribute('data-vector-mount-waiting', 'true');
		const control = page.getByRole('button', { name: 'Let the blobs feel your phone move', exact: true });
		await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(0);
		await expect(control).toHaveCount(0);
		await page.evaluate(() => window.dispatchEvent(new Event('release-vector-mount')));
		await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(1);
		await expect(control).toBeVisible();
		await expect(control).not.toHaveAttribute('aria-hidden', 'true');
		await expect(page.locator('html')).not.toHaveAttribute('data-motion-permission-calls');
		await control.click();
		await expect(page.locator('html')).toHaveAttribute('data-motion-permission-calls', '1');
		await expect(control).toHaveCount(0);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await expect(control).toHaveCount(0);
		await expect(page.locator('html')).toHaveAttribute('data-motion-permission-calls', '1');
		expect(errors).toEqual([]);
	});
}

test('tracks reduced motion after the deferred mount without prompting', async ({ page, guardedPage }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await holdVectorMount(page);
	await guardedPage();
	await expect(page.locator('html')).toHaveAttribute('data-vector-mount-waiting', 'true');
	await page.evaluate(() => window.dispatchEvent(new Event('release-vector-mount')));
	await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(1);
	const control = page.getByRole('button', { name: 'Let the blobs feel your phone move', exact: true });
	await expect(control).toHaveCount(0);
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await expect(control).toBeVisible();
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await expect(control).toHaveCount(0);
	await expect(page.locator('html')).not.toHaveAttribute('data-motion-permission-calls');
});
