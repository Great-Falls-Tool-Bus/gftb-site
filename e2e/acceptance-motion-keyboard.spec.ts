import { expect, test, type Page } from '@playwright/test';
import { installExternalGuard, stubChallenge, stubContactEndpoint } from './support/network';

// Acceptance rows (§3): prefers-reduced-motion is respected (no non-essential
// animation), and the page is fully keyboard operable with a visible, ordered
// focus path.

async function openPage(page: Page, baseURL: string | undefined) {
	await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
	await stubChallenge(page);
	await page.goto('/');
	await page.waitForLoadState('domcontentloaded');
}

test.describe('prefers-reduced-motion', () => {
	test('no element declares a transition, animation, or smooth scroll', async ({ page, baseURL }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await openPage(page, baseURL);

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

	test('nothing is animating on the compositor after load', async ({ page, baseURL }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await openPage(page, baseURL);
		await page.waitForLoadState('networkidle');
		const running = await page.evaluate(() =>
			document
				.getAnimations()
				.filter((animation) => animation.playState === 'running')
				.map((animation) => animation.constructor.name),
		);
		expect(running, 'running animations under prefers-reduced-motion').toEqual([]);
	});

	test('anchor navigation still lands on its target with motion reduced', async ({ page, baseURL }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await openPage(page, baseURL);
		await page.getByRole('link', { name: 'Help build the bus' }).click();
		await expect(page).toHaveURL(/#contact$/u);
		const settled = await page.locator('#contact').evaluate((element) => element.getBoundingClientRect().top);
		// scroll-margin-top is 5rem; the section must be at the top of the
		// viewport immediately, not easing toward it.
		expect(Math.abs(settled)).toBeLessThan(120);
	});

	test('the default (no preference) rendering keeps smooth scrolling as the enhancement', async ({ page, baseURL }) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await openPage(page, baseURL);
		const behavior = await page.locator('html').evaluate((element) => getComputedStyle(element).scrollBehavior);
		expect(behavior, 'smooth scrolling is the thing reduced-motion turns off').toBe('smooth');
	});
});

test.describe('keyboard operability', () => {
	test('tab order follows document order and reaches every control', async ({ page, baseURL }) => {
		await openPage(page, baseURL);

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

	test('the honeypot is unreachable by keyboard', async ({ page, baseURL }) => {
		await openPage(page, baseURL);
		const honeypot = page.locator('#contact-website');
		await expect(honeypot).toHaveAttribute('tabindex', '-1');
		await expect(page.locator('.honeypot')).toHaveAttribute('aria-hidden', 'true');
		await expect(honeypot).toHaveAttribute('autocomplete', 'off');
	});

	test('every focused control shows a visible indicator', async ({ page, baseURL }) => {
		await openPage(page, baseURL);

		const invisible = await page.evaluate(() => {
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

			for (const control of controls) {
				const before = readable(control);
				control.focus();
				const after = readable(control);
				control.blur();
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

	test('the contact form can be completed and submitted without a pointer', async ({ page, baseURL }) => {
		// Submitted, not just typed into: the acceptance row is that a keyboard-only
		// visitor can actually send the form, so this drives Tab/Enter all the way
		// to the POST and asserts the endpoint received it.
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);
		const capture = await stubContactEndpoint(page);
		await page.goto('/');
		await page.waitForLoadState('domcontentloaded');

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
		await expect(page.getByRole('status')).toContainText('your note is on its way');
		expect(capture.payloads).toHaveLength(1);
		expect(capture.payloads[0]).toMatchObject({
			name: 'Keyboard Tester',
			email: 'tester@example.org',
			message,
		});
	});

	test('validation errors move focus to the first field that needs attention', async ({ page, baseURL }) => {
		await openPage(page, baseURL);
		await page.getByRole('button', { name: 'Send to keyholders' }).click();
		await expect(page.locator('#contact-name')).toBeFocused();
		await expect(page.locator('#contact-name')).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#contact-name')).toHaveAttribute('aria-describedby', 'contact-name-error');
		await expect(page.locator('#contact-name-error')).toBeVisible();
	});
});
