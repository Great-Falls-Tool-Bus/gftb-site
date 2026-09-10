import type { Page } from '@playwright/test';

export type ActiveTier = 'webgpu' | 'webgl2';

/**
 * Wait for the scene to pick a rung and return it. Rows that measure pixels
 * accept either rung: the geometry, the easing and the colours are one
 * uniform block read by two shaders, so the output is the same picture.
 */
export async function awaitTier(page: Page, timeout = 15_000): Promise<ActiveTier> {
	const handle = await page.waitForFunction(
		() => {
			const tier = document.querySelector('#goals canvas.wiper__scene')?.getAttribute('data-tier');
			return tier === 'webgpu' || tier === 'webgl2' ? tier : null;
		},
		null,
		{ timeout },
	);
	return (await handle.jsonValue()) as ActiveTier;
}

/**
 * Cap the ladder before the page mounts: `<html data-wiper-tier-max>` is read
 * at every selection and only lowers. Set at document start and again once
 * the element exists, whichever comes first.
 */
export async function forceTierMax(page: Page, cap: 'webgl2' | 'none'): Promise<void> {
	await page.addInitScript((value: string) => {
		const apply = () => document.documentElement?.setAttribute('data-wiper-tier-max', value);
		apply();
		document.addEventListener('readystatechange', apply, { once: true });
		document.addEventListener('DOMContentLoaded', apply, { once: true });
	}, cap);
}
