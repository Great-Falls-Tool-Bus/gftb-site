import { test as base, type Page } from '@playwright/test';
import { installExternalGuard, stubChallenge } from './network';

/**
 * Shared Playwright fixtures for the acceptance specs.
 *
 * `baseUrl` is the suite's base URL with the local-preview fallback applied
 * once, replacing the `baseURL ?? 'http://localhost:3000'` expression that
 * was previously restated across the specs.
 *
 * `guardedPage` is the shared acceptance prologue: installExternalGuard →
 * stubChallenge → goto → waitForLoadState('domcontentloaded'). The guard is
 * installed before anything else so more specific routes registered
 * afterwards take precedence (Playwright matches routes in reverse
 * registration order). A spec whose prologue deviates — a failing challenge
 * stub, a captured guard, a different load state — keeps composing the
 * support/network helpers by hand on top of `baseUrl`.
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
