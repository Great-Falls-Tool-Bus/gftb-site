import type { Page } from '@playwright/test';
import { INTRO_PLAYED_KEY } from '../../src/lib/intro/machine';

/** Mark the home intro as already played before any document script runs. */
export async function skipHomeIntro(page: Page): Promise<void> {
	await page.addInitScript((key: string) => {
		try {
			sessionStorage.setItem(key, '1');
		} catch {
			// Storage unavailable: the page never arms the intro either.
		}
	}, INTRO_PLAYED_KEY);
}
