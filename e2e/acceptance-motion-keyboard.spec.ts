import { expect, test } from './support/fixtures';
import { stubContactEndpoint } from './support/network';

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
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await guardedPage();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#main-content$/u);
		await expect(page.locator('#main-content')).toBeFocused();
		const settled = await page.locator('#main-content').evaluate((element) => element.getBoundingClientRect().top);
		// The target lands near the viewport top without a smooth transition.
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

		const expected = await page.evaluate(() => {
			const focusable = Array.from(
				document.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
				),
			);
			return (
				focusable
					.filter((element) => !element.closest('.honeypot'))
					.filter((element) => element.getAttribute('tabindex') !== '-1')
					// Under the 2026-10-02 ruling, the loop repeats its rows in an aria-hidden track with
					// tabindex -1 buttons. Keyboard users reach each row once.
					.filter((element) => !element.closest('[inert], [aria-hidden="true"]'))
					// A native radio group is one tab stop: the checked radio, or the
					// first when none is (the wiper stalk's four detents).
					.filter((element) => {
						if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) return true;
						const group = Array.from(
							document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(element.name)}"]`),
						);
						const checked = group.find((radio) => radio.checked);
						return checked ? element === checked : element === group[0];
					})
					.map(
						(element) =>
							element.id || `${element.tagName.toLowerCase()}:${(element.textContent ?? '').trim().slice(0, 24)}`,
					)
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

		const invisible = await page.evaluate(async () => {
			// Zag tracks keyboard modality at the document level. Press Tab before programmatic focus so
			// the keyboard-only indicator paints during the sweep.
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
			)
				.filter((element) => !element.closest('.honeypot'))
				// The duplicate track is aria-hidden under the 2026-10-02 ruling. Measure each focus
				// indicator on the first copy.
				.filter((element) => !element.closest('[inert], [aria-hidden="true"]'));

			// Wait one frame for Svelte to write Zag's data-focus-visible state before measuring.
			const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

			for (const control of controls) {
				// Zag clips the switch input to 1px and sets data-focus-visible on the root. Measure the
				// rescue-edge outline that app.css paints there.
				const indicatorHost =
					control.tagName === 'INPUT' && control.closest('.mode-switch, .wiper-stalk__item')
						? (control.closest('.mode-switch, .wiper-stalk__item') as HTMLElement)
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
		// Exercise Tab and Enter through submission so the assertion covers receipt of the POST.
		await guardedPage('/contact');
		// Register after the catch-all guard so the contact handler takes precedence on submit.
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
