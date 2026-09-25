import type { Page } from '@playwright/test';
import { INTRO_OFF_ATTR, INTRO_OFF_GLOBAL } from '../../src/lib/intro/controller';

/**
 * Keep the home intro from arming: `<html data-intro-off>` is read by the
 * pre-paint script and by the controller. Set at document start and again
 * once the element exists, whichever comes first (the wiper ceiling hook's
 * idiom). No storage: the intro plays on every full load by ruling.
 */
export async function skipHomeIntro(page: Page): Promise<void> {
	await page.addInitScript(
		({ attribute, global }: { attribute: string; global: string }) => {
			(window as unknown as Record<string, unknown>)[global] = true;
			const apply = () => document.documentElement?.setAttribute(attribute, '');
			apply();
			document.addEventListener('readystatechange', apply, { once: true });
			document.addEventListener('DOMContentLoaded', apply, { once: true });
		},
		{ attribute: INTRO_OFF_ATTR, global: INTRO_OFF_GLOBAL },
	);
}
