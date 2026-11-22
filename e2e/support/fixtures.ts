import { test as base, type Page } from '@playwright/test';
import { installExternalGuard, stubChallenge } from './network';

/**
 * `baseUrl` supplies the local preview fallback. `guardedPage` installs the external guard
 * before the challenge stub because Playwright matches newer routes first. It then navigates
 * and waits for domcontentloaded. Specs with different setup can compose support/network
 * helpers on top of `baseUrl`.
 */

export type GuardedGoto = (path?: string) => Promise<Page>;

export const test = base.extend<{ baseUrl: string; guardedPage: GuardedGoto }>({
	baseUrl: async ({ baseURL }, use) => {
		await use(baseURL ?? 'http://localhost:3000');
	},
	guardedPage: async ({ page, baseUrl }, use) => {
		await use(async (path = '/') => {
			await installExternalGuard(page, baseUrl);
			await stubChallenge(page);
			await page.goto(path);
			await page.waitForLoadState('domcontentloaded');
			return page;
		});
	},
});

export { expect } from '@playwright/test';
