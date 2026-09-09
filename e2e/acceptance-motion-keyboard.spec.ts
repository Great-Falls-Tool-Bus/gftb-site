import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { stubContactEndpoint } from './support/network';

// The Notes & Goals wipers page the list after hydration; with the wipers
// off every note is a plain grid row, so the keyboard sweeps below meet a
// stable document. The rotator's own keyboard rows (focus-follow, the
// stalk's roving tabindex) live in e2e/home-goals.spec.ts.
async function switchWipersOff(page: Page) {
	const wipers = page.locator('#goals').getByRole('switch', { name: 'Wipers' });
	if ((await wipers.count()) === 0) return;
	// Operate the switch from the keyboard, not the pointer: a real mouse
	// click would flip Chromium into pointer modality (programmatic focus
	// then paints no :focus-visible ring for the indicator sweep) and leave
	// the pointer resting on the pane. Then hand focus back to the document
	// body so the sequential-focus starting point is the top of the page.
	await wipers.focus();
	await page.keyboard.press('Space');
	await expect(wipers).toHaveAttribute('aria-checked', 'false');
	await page.evaluate(() => {
		const body = document.body;
		body.tabIndex = -1;
		body.focus();
		body.removeAttribute('tabindex');
	});
}

// Acceptance rows (§3): prefers-reduced-motion is respected (no non-essential
// animation), and the page is fully keyboard operable with a visible, ordered
// focus path.

test.describe('prefers-reduced-motion', () => {
	test('no element declares a transition, animation, or smooth scroll', async ({ page, guardedPage }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await guardedPage();

		const moving = await page.evaluate(() => {
			const offenders: Array<{ selector: string; property: string; value: string }> = [];
			const describe = (element: Element) =>
				`${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).split(/\s+/u)[0]}` : ''}`;
			for (const element of Array.from(document.querySelectorAll('*'))) {
				const style = getComputedStyle(element);
				const durations = [
					['transition-duration', style.transitionDuration],
					['animation-duration', style.animationDuration],
				] as const;
				for (const [property, value] of durations) {
					if (value && value.split(',').some((entry) => Number.parseFloat(entry) > 0)) {
						offenders.push({ selector: describe(element), property, value });
					}
				}
				if (style.animationName && style.animationName !== 'none') {
					offenders.push({ selector: describe(element), property: 'animation-name', value: style.animationName });
				}
				if (style.scrollBehavior === 'smooth') {
					offenders.push({ selector: describe(element), property: 'scroll-behavior', value: 'smooth' });
				}
			}
			return offenders;
		});
		expect(moving, 'elements still animating under prefers-reduced-motion').toEqual([]);
	});

	test('the wiper pane declares no motion on its pseudo-elements either', async ({ page, guardedPage }) => {
		// The sitewide sweep above reads elements; the aero skin paints its
		// droplets and sheen on the pane's ::before/::after, so read those too.
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await guardedPage();
		const moving = await page.evaluate(() => {
			const offenders: string[] = [];
			for (const element of Array.from(document.querySelectorAll('#goals .wiper, #goals .wiper *'))) {
				for (const pseudo of ['::before', '::after']) {
					const style = getComputedStyle(element, pseudo);
					if (style.content === 'none' || style.content === '') continue;
					if (style.animationName && style.animationName !== 'none')
						offenders.push(`${pseudo} animation-name ${style.animationName}`);
					if (style.transitionDuration.split(',').some((entry) => Number.parseFloat(entry) > 0)) {
						offenders.push(`${pseudo} transition-duration ${style.transitionDuration}`);
					}
					if (style.animationDuration.split(',').some((entry) => Number.parseFloat(entry) > 0)) {
						offenders.push(`${pseudo} animation-duration ${style.animationDuration}`);
					}
				}
			}
			return offenders;
		});
		expect(moving).toEqual([]);
	});

	test('nothing is animating on the compositor after load', async ({ page, guardedPage }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await guardedPage();
		await page.waitForLoadState('networkidle');
		const running = await page.evaluate(() =>
			document
				.getAnimations()
				.filter((animation) => animation.playState === 'running')
				.map((animation) => animation.constructor.name),
		);
		expect(running, 'running animations under prefers-reduced-motion').toEqual([]);
	});

	test('anchor navigation still lands on its target with motion reduced', async ({ page, guardedPage }) => {
		// The contact CTA is a page link now (B1.4); the footer's History link
		// is the surviving same-page anchor this row exercises.
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await guardedPage();
		await page.getByRole('link', { name: 'History', exact: true }).click();
		await expect(page).toHaveURL(/#history$/u);
		const settled = await page.locator('#history').evaluate((element) => element.getBoundingClientRect().top);
		// scroll-margin-top is 5rem; the section must be at the top of the
		// viewport immediately, not easing toward it.
		expect(Math.abs(settled)).toBeLessThan(120);
	});

	test('the default (no preference) rendering keeps smooth scrolling as the enhancement', async ({
		page,
		guardedPage,
	}) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await guardedPage();
		const behavior = await page.locator('html').evaluate((element) => getComputedStyle(element).scrollBehavior);
		expect(behavior, 'smooth scrolling is the thing reduced-motion turns off').toBe('smooth');
	});
});

test.describe('keyboard operability', () => {
	test('tab order follows document order and reaches every control', async ({ page, guardedPage }) => {
		await guardedPage();
		await switchWipersOff(page);

		const expected = await page.evaluate(() => {
			const focusable = Array.from(
				document.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
				),
			);
			return focusable
				.filter((element) => !element.closest('.honeypot'))
				.filter((element) => element.getAttribute('tabindex') !== '-1')
				.map(
					(element) =>
						element.id || `${element.tagName.toLowerCase()}:${(element.textContent ?? '').trim().slice(0, 24)}`,
				);
		});
		expect(expected.length, 'focusable controls on the page').toBeGreaterThan(8);

		const visited: string[] = [];
		await page.locator('body').press('Tab');
		for (let step = 0; step < expected.length; step += 1) {
			const current = await page.evaluate(() => {
				const element = document.activeElement as HTMLElement | null;
				if (!element || element === document.body) return null;
				return element.id || `${element.tagName.toLowerCase()}:${(element.textContent ?? '').trim().slice(0, 24)}`;
			});
			if (current === null) break;
			visited.push(current);
			await page.keyboard.press('Tab');
		}
		expect(visited, 'visited focus order').toEqual(expected);
	});

	test('the honeypot is unreachable by keyboard', async ({ page, guardedPage }) => {
		await guardedPage('/contact');
		const honeypot = page.locator('#contact-website');
		await expect(honeypot).toHaveAttribute('tabindex', '-1');
		await expect(page.locator('.honeypot')).toHaveAttribute('aria-hidden', 'true');
		await expect(honeypot).toHaveAttribute('autocomplete', 'off');
	});

	test('every focused control shows a visible indicator', async ({ page, guardedPage }) => {
		await guardedPage();
		await page.waitForLoadState('networkidle');
		await switchWipersOff(page);

		const invisible = await page.evaluate(async () => {
			// Declare keyboard modality before the sweep: the switch's ring is
			// deliberately keyboard-only (Zag's focus-visible modality
			// tracking — a mouse click paints no ring, by design), and this
			// sweep drives focus programmatically. One Tab keydown is exactly
			// what a keyboard user emits before every focus simulated below;
			// Zag's document-level tracker accepts it and flips the modality
			// to keyboard, so the real indicator becomes observable.
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
			const readable = (element: HTMLElement) => {
				const style = getComputedStyle(element);
				return {
					outlineStyle: style.outlineStyle,
					outlineWidth: style.outlineWidth,
					outlineColor: style.outlineColor,
					boxShadow: style.boxShadow,
					backgroundColor: style.backgroundColor,
					transform: style.transform,
				};
			};
			const offenders: string[] = [];
			const controls = Array.from(
				document.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), textarea, summary',
				),
			).filter((element) => !element.closest('.honeypot'));

			// Reactive components apply their focus state on the next render
			// (Zag transitions the machine, Svelte writes data-focus-visible),
			// so the post-focus read settles a frame before measuring; plain
			// controls are unaffected.
			const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

			for (const control of controls) {
				// The mode switch's hidden input is Zag's clipped 1px a11y
				// channel: its indicator paints on the switch ROOT (Zag flags
				// data-focus-visible there and app.css draws the rescue-edge
				// outline), so that is the element measured — the indicator a
				// person can actually perceive, not a clipped box's computed
				// style (review E7).
				const indicatorHost =
					control.tagName === 'INPUT' && control.closest('.mode-switch')
						? (control.closest('.mode-switch') as HTMLElement)
						: control;
				const before = readable(indicatorHost);
				control.focus();
				await settle();
				const after = readable(indicatorHost);
				control.blur();
				await settle();
				const changed = (Object.keys(before) as Array<keyof typeof before>).some((key) => before[key] !== after[key]);
				const hasOutline = after.outlineStyle !== 'none' && Number.parseFloat(after.outlineWidth) > 0;
				if (!changed && !hasOutline) {
					offenders.push(
						control.id || `${control.tagName.toLowerCase()}:${(control.textContent ?? '').trim().slice(0, 24)}`,
					);
				}
			}
			return offenders;
		});
		expect(invisible, 'controls with no perceivable focus indicator').toEqual([]);
	});

	test('the contact form can be completed and submitted without a pointer', async ({ page, guardedPage }) => {
		// Submitted, not just typed into: the acceptance row is that a keyboard-only
		// visitor can actually send the form, so this drives Tab/Enter all the way
		// to the POST and asserts the endpoint received it.
		await guardedPage('/contact');
		// Registered after the prologue's catch-all guard so it takes precedence
		// for the contact URL; the endpoint is only reached on submit, well after
		// load, so registering it post-goto changes nothing observable.
		const capture = await stubContactEndpoint(page);

		const message = 'I would like to help with the waterproofing session.';
		await page.locator('#contact-name').focus();
		await page.keyboard.type('Keyboard Tester');
		await page.keyboard.press('Tab');
		await expect(page.locator('#contact-email')).toBeFocused();
		await page.keyboard.type('tester@example.org');
		await page.keyboard.press('Tab');
		await expect(page.locator('#contact-message')).toBeFocused();
		await page.keyboard.type(message);

		await expect(page.locator('#contact-name')).toHaveValue('Keyboard Tester');
		await expect(page.locator('#contact-email')).toHaveValue('tester@example.org');

		// Enter inside a textarea inserts a newline, so reaching the submit control
		// has to happen by Tab. Bounded so a focus trap fails the test rather than
		// hanging it.
		const submitButton = page.getByRole('button', { name: 'Send to keyholders' });
		let reached = false;
		for (let step = 0; step < 12 && !reached; step += 1) {
			await page.keyboard.press('Tab');
			reached = await submitButton.evaluate((element) => element === document.activeElement);
		}
		expect(reached, 'the submit button is reachable from the message field by Tab alone').toBe(true);
		await expect(submitButton).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(page.getByRole('status')).toContainText('Your note has been sent');
		expect(capture.payloads).toHaveLength(1);
		expect(capture.payloads[0]).toMatchObject({
			name: 'Keyboard Tester',
			email: 'tester@example.org',
			message,
		});
	});

	test('validation errors move focus to the first field that needs attention', async ({ page, guardedPage }) => {
		await guardedPage('/contact');
		await page.getByRole('button', { name: 'Send to keyholders' }).click();
		await expect(page.locator('#contact-name')).toBeFocused();
		await expect(page.locator('#contact-name')).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#contact-name')).toHaveAttribute('aria-describedby', 'contact-name-error');
		await expect(page.locator('#contact-name-error')).toBeVisible();
	});
});
