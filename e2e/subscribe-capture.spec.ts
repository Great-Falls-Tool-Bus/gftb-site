// The list-signup capture modal (rehearsal only, PUBLIC_SUBSCRIBE_CAPTURE).
// These rows run against a flag-on build: the component publishes its arm
// decision on <html data-subscribe-capture>, and a build made with the flag
// off never sets it, so the suite skips itself there instead of failing.
//
// The dwell hook `data-subscribe-capture-dwell-ms` (AGENTS.md "Test and LOOK
// hooks") credits the 45 s dwell; the scroll-past-the-hero half of the arm
// rule is still exercised for real, as is every suppression below.
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { skipHomeIntro } from './support/intro';
import { SUBSCRIBE_URL, stubContactEndpoint } from './support/network';

const modal = (page: Page) => page.getByTestId('subscribe-capture');
// The success notice, not the ALTCHA widget's own role="status" span.
const successNotice = (page: Page) => modal(page).locator('.form-notice--success[role="status"]');
const published = (page: Page) => page.evaluate(() => document.documentElement.dataset.subscribeCapture ?? null);

/** Credits the dwell before the app mounts, the same idiom as skipHomeIntro. */
async function creditDwell(page: Page, dwellMs = 0): Promise<void> {
	await page.addInitScript((value: string) => {
		const apply = () => document.documentElement?.setAttribute('data-subscribe-capture-dwell-ms', value);
		apply();
		document.addEventListener('readystatechange', apply, { once: true });
		document.addEventListener('DOMContentLoaded', apply, { once: true });
	}, String(dwellMs));
}

async function scrollPastHero(page: Page): Promise<void> {
	await page.evaluate(() => {
		const hero = document.querySelector('.hero');
		const bottom = hero ? hero.getBoundingClientRect().bottom + window.scrollY : window.innerHeight;
		window.scrollTo({ top: bottom + 40, left: 0, behavior: 'instant' });
	});
}

/**
 * The suite is inert on a flag-off build: nothing publishes, nothing to prove.
 * The layout mounts the component on browser idle with a 4 s cap, so the wait
 * here is deliberately longer than that cap.
 */
async function flagOn(page: Page): Promise<boolean> {
	try {
		await expect.poll(() => published(page), { timeout: 12_000 }).not.toBeNull();
		return true;
	} catch {
		return false;
	}
}

test.describe('subscribe capture (flag on)', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
	});

	test('arms after dwell once the hero is scrolled past, and only then', async ({ page, guardedPage }) => {
		await skipHomeIntro(page);
		await creditDwell(page);
		await guardedPage('/');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');

		// Dwell is credited, the hero is still in view: the rule reports it.
		await expect.poll(() => published(page)).toBe('hero');
		await expect(modal(page)).toHaveCount(0);

		await scrollPastHero(page);
		await expect.poll(() => published(page)).toBe('armed');
		await expect(modal(page)).toBeVisible();
		await expect(modal(page)).toHaveAttribute('role', 'dialog');
		await expect(modal(page).getByRole('heading', { level: 2 })).toHaveText('Hear from the Tool Bus');
		await expect(page.locator('#subscribe-email')).toBeFocused();

		// Below the intro on the semantic ladder, above the sticky header.
		const z = await page.evaluate(() => {
			const style = getComputedStyle(document.documentElement);
			const positioner = document.querySelector('.subscribe-capture__positioner');
			const backdrop = document.querySelector('.subscribe-capture__backdrop');
			return {
				intro: Number(style.getPropertyValue('--z-intro')),
				sticky: Number(style.getPropertyValue('--z-sticky')),
				positioner: positioner ? Number(getComputedStyle(positioner).zIndex) : null,
				backdrop: backdrop ? Number(getComputedStyle(backdrop).zIndex) : null,
			};
		});
		expect(z.positioner).not.toBeNull();
		expect(z.backdrop).not.toBeNull();
		expect(z.positioner!).toBeLessThan(z.intro);
		expect(z.backdrop!).toBeLessThan(z.positioner!);
		expect(z.backdrop!).toBeGreaterThan(z.sticky);

		// Sharp edges on every part the dialog dresses.
		const rounded = await page.evaluate(() =>
			Array.from(document.querySelectorAll<HTMLElement>('.subscribe-capture, .subscribe-capture *'))
				.filter((element) => !element.closest('altcha-widget') || element.tagName.toLowerCase() === 'altcha-widget')
				.filter((element) => getComputedStyle(element).borderTopLeftRadius !== '0px')
				.map((element) => element.tagName.toLowerCase()),
		);
		expect(rounded).toEqual([]);
	});

	test('never arms without the dwell', async ({ page, guardedPage }) => {
		await skipHomeIntro(page);
		await guardedPage('/');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');
		await scrollPastHero(page);
		await expect.poll(() => published(page)).toBe('dwell');
		await expect(modal(page)).toHaveCount(0);
	});

	test('never arms under reduced motion', async ({ page, guardedPage }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await creditDwell(page);
		await guardedPage('/');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');
		await scrollPastHero(page);
		await expect.poll(() => published(page)).toBe('reduced-motion');
		await page.waitForTimeout(500);
		expect(await published(page)).toBe('reduced-motion');
		await expect(modal(page)).toHaveCount(0);
	});

	test('never arms on /contact', async ({ page, guardedPage }) => {
		await creditDwell(page);
		await guardedPage('/contact');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		await expect.poll(() => published(page)).toBe('suppressed-path');
		await page.waitForTimeout(500);
		expect(await published(page)).toBe('suppressed-path');
		await expect(modal(page)).toHaveCount(0);
	});

	test('never arms on a narrow viewport', async ({ page, guardedPage }) => {
		await page.setViewportSize({ width: 600, height: 900 });
		await skipHomeIntro(page);
		await creditDwell(page);
		await guardedPage('/');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');
		await scrollPastHero(page);
		await expect.poll(() => published(page)).toBe('viewport-narrow');
		await expect(modal(page)).toHaveCount(0);
	});

	test('never arms while the home intro is live', async ({ page, guardedPage }) => {
		// Dwell is credited and the intro's own scroll lands below the hero, so
		// the only thing holding the modal back during the intro is the intro.
		await creditDwell(page);
		await guardedPage('/');
		const introArmed = await page.evaluate(() => document.documentElement.classList.contains('intro-armed'));
		test.skip(!introArmed, 'the intro did not arm on this rig (headless reduce or forced colours)');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');

		// Sample until the intro reaches a terminal state: while any intro class
		// is on <html>, the modal must not exist and the rule must not say armed.
		const samples = await page.evaluate(
			() =>
				new Promise<Array<{ intro: string; live: boolean; capture: string; modal: number }>>((resolve) => {
					const rows: Array<{ intro: string; live: boolean; capture: string; modal: number }> = [];
					const tick = () => {
						const root = document.documentElement;
						const intro = root.dataset.intro ?? '';
						rows.push({
							intro,
							live: ['intro-armed', 'intro-live', 'intro-lifting'].some((name) => root.classList.contains(name)),
							capture: root.dataset.subscribeCapture ?? '',
							modal: document.querySelectorAll('[data-testid="subscribe-capture"]').length,
						});
						if (['done', 'cancelled', 'skipped'].includes(intro) || rows.length > 150) resolve(rows);
						else setTimeout(tick, 100);
					};
					tick();
				}),
		);
		const duringIntro = samples.filter((row) => row.live);
		expect(duringIntro.length).toBeGreaterThan(0);
		for (const row of duringIntro) {
			expect(row.modal, `modal present during intro (${JSON.stringify(row)})`).toBe(0);
			expect(row.capture, `armed during intro (${JSON.stringify(row)})`).not.toBe('armed');
		}
		expect(duringIntro.some((row) => row.capture === 'intro-live')).toBe(true);

		// The intro lands Notes & Goals under the sticky header, which leaves the
		// hero's bottom edge just inside the viewport: the rule reports the hero,
		// and one more scroll past it arms the box with the intro gone.
		await expect.poll(() => published(page), { timeout: 10_000 }).toBe('hero');
		await scrollPastHero(page);
		await expect.poll(() => published(page)).toBe('armed');
		await expect(modal(page)).toBeVisible();
	});

	test('Escape dismisses, returns focus, and the dismissal is remembered', async ({ page, guardedPage }) => {
		await skipHomeIntro(page);
		await creditDwell(page);
		await guardedPage('/');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');

		const homeLink = page.locator('.site-nav a').first();
		await homeLink.focus();
		await expect(homeLink).toBeFocused();
		await scrollPastHero(page);
		await expect(modal(page)).toBeVisible();
		await expect(page.locator('#subscribe-email')).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(modal(page)).toHaveCount(0);
		await expect(homeLink).toBeFocused();
		expect(await published(page)).toBe('dismissed');
		expect(await page.evaluate(() => /^\d+$/u.test(localStorage.getItem('subscribe-capture-dismissed') ?? ''))).toBe(
			true,
		);

		// Remembered across a reload: the rule refuses before any progress signal.
		await page.reload();
		await page.waitForLoadState('domcontentloaded');
		await scrollPastHero(page);
		// Fresh document: the component mounts on idle again (4 s cap).
		await expect.poll(() => published(page), { timeout: 12_000 }).toBe('dismissed');
		await expect(modal(page)).toHaveCount(0);
	});

	test('the backdrop and Not now also dismiss', async ({ page, guardedPage }) => {
		await skipHomeIntro(page);
		await creditDwell(page);
		await guardedPage('/');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');
		await scrollPastHero(page);
		await expect(modal(page)).toBeVisible();
		await modal(page).getByRole('button', { name: 'Not now' }).click();
		await expect(modal(page)).toHaveCount(0);
		expect(await published(page)).toBe('dismissed');
	});

	test('the honeypot path posts nothing', async ({ page, guardedPage }) => {
		await skipHomeIntro(page);
		await creditDwell(page);
		await guardedPage('/');
		// After the guard: Playwright matches routes newest first, so a stub
		// registered before the fixture's external guard would be shadowed by it.
		const capture = await stubContactEndpoint(page, {}, SUBSCRIBE_URL);
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');
		await scrollPastHero(page);
		await expect(modal(page)).toBeVisible();

		// The honeypot is off-screen and out of the tab order; only a script fills it.
		const honeypot = page.locator('#subscribe-website');
		await expect(honeypot).toHaveAttribute('tabindex', '-1');
		await honeypot.evaluate((element) => {
			const input = element as HTMLInputElement;
			input.value = 'https://spam.example';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.locator('#subscribe-email').fill('bot@example.org');
		await modal(page).getByRole('button', { name: 'Join the list' }).click();

		await expect(successNotice(page)).toBeVisible();
		await page.waitForTimeout(300);
		expect(capture.payloads).toEqual([]);
		expect(await page.evaluate(() => localStorage.getItem('subscribe-capture-subscribed'))).toBeNull();
	});

	test('a real signup posts the email with the proof and is remembered forever', async ({ page, guardedPage }) => {
		await skipHomeIntro(page);
		await creditDwell(page);
		await guardedPage('/');
		const capture = await stubContactEndpoint(page, {}, SUBSCRIBE_URL);
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');
		await scrollPastHero(page);
		await expect(modal(page)).toBeVisible();
		await expect(page.locator('altcha-widget')).toBeVisible();
		await expect
			.poll(async () => page.locator('altcha-widget').evaluate((element) => (element as { state?: string }).state), {
				timeout: 30_000,
			})
			.toBe('verified');

		await page.locator('#subscribe-email').fill('ada@example.org');
		await modal(page).getByRole('button', { name: 'Join the list' }).click();
		await expect(successNotice(page)).toContainText('confirmation email');
		await expect(successNotice(page)).toContainText('unsubscribe');
		expect(capture.payloads).toHaveLength(1);
		expect(Object.keys(capture.payloads[0]).sort()).toEqual(['altcha', 'email', 'website']);
		expect(capture.payloads[0].email).toBe('ada@example.org');
		expect(await page.evaluate(() => /^\d+$/u.test(localStorage.getItem('subscribe-capture-subscribed') ?? ''))).toBe(
			true,
		);

		await modal(page).getByRole('button', { name: 'Close' }).click();
		await expect(modal(page)).toHaveCount(0);
		expect(await published(page)).toBe('subscribed');
	});

	test('the copy is a list signup with no em dash and no motion language', async ({ page, guardedPage }) => {
		await skipHomeIntro(page);
		await creditDwell(page);
		await guardedPage('/');
		test.skip(!(await flagOn(page)), 'flag-off build: the capture component is absent');
		await scrollPastHero(page);
		await expect(modal(page)).toBeVisible();
		const text = (await modal(page).textContent()) ?? '';
		const emDash = String.fromCharCode(0x2014);
		expect(text.includes(emDash)).toBe(false);
		expect(/\b(?:mobile|motion|moving|circulating|rolling)\b|on its way/iu.exec(text)).toBeNull();
		expect(/\b(?:donate|donation|pledge|amount|\$\d)/iu.exec(text)).toBeNull();
	});
});
