import type { Page } from '@playwright/test';
import { expect, test, type GuardedGoto } from './support/fixtures';
import {
	LARGE_TEXT_AA_RATIO,
	NON_TEXT_RATIO,
	TEXT_AA_RATIO,
	compositeOver,
	contrastRatio,
	formatRgb,
	parseCssColor,
	roundRatio,
	type Rgb,
} from '../scripts/lib/color-contrast.mjs';

// §3 covers AA text contrast and WCAG 1.4.11's 3:1 threshold for controls. The browser collects
// computed colours and background layers. scripts/lib/color-contrast.mjs parses them for both
// browser and unit tests. Chromium preserves `oklch()` and returns `oklab(L a b / A)` for a
// `color-mix(in oklab, …)`. Reading those channels as RGB distorts the ratio. getComputedStyle
// leaves the body gradient unresolved, so the measurements use --bg. In dark mode, --wash
// lightens the top 352px from #28222b to #383042. There, error-300 measures 4.79 against the
// wash versus 5.89 against --bg. For primary-300 the ratios are 4.93 and 6.06. The contact card
// sits below the wash.

interface TextSample {
	label: string;
	color: string;
	/** Computed background-color of the element and each ancestor, nearest first. */
	backgroundLayers: string[];
	fontSize: number;
	fontWeight: number;
}

interface ControlSample {
	label: string;
	fill: string;
	borderColor: string;
	borderWidth: number;
	surfaceLayers: string[];
}

/**
 * Composite the nearest background layers first. The shared parser handles Chromium's computed
 * colour formats.
 */
function resolveBackground(layers: string[]): Rgb {
	const painted = layers.map((layer) => parseCssColor(layer)).filter((layer) => layer.alpha > 0);
	const stack: Rgb[] = [];
	for (const layer of painted) {
		stack.push(layer);
		if (layer.alpha >= 1) break;
	}
	const white: Rgb = { red: 255, green: 255, blue: 255, alpha: 1 };
	if (stack.length === 0) return white;
	let result = stack[stack.length - 1];
	if (result.alpha < 1) result = compositeOver(result, white);
	for (let index = stack.length - 2; index >= 0; index -= 1) result = compositeOver(stack[index], result);
	return result;
}

async function openPage(page: Page, guardedPage: GuardedGoto, path = '/') {
	await guardedPage(path);
	// D04 hides sections at opacity 0 until they intersect. Disarm the reveal so the visibility
	// filter includes below-fold content.
	await page.evaluate(() => document.documentElement.classList.remove('motion-safe-ready'));
}

const COLLECTORS = `
	// The page reports; it does not interpret. Every background-color from the
	// element up to the document element is returned verbatim, and Node decides
	// where the stack becomes opaque. No colour maths runs in here, because the
	// only correct parser for what Chromium emits is the shared one.
	const backgroundLayers = (element) => {
		const layers = [];
		let node = element;
		while (node) {
			layers.push(getComputedStyle(node).backgroundColor);
			node = node.parentElement;
		}
		return layers;
	};
	const label = (element) => {
		const classes = String(element.className || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
		const text = (element.textContent || '').trim().slice(0, 32);
		return element.tagName.toLowerCase() + (classes ? '.' + classes : '') + (text ? ' — ' + text : '');
	};
	const visible = (element) => {
		const style = getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
		const box = element.getBoundingClientRect();
		return box.width > 0 && box.height > 0;
	};
`;

async function collectTextSamples(page: Page): Promise<TextSample[]> {
	return page.evaluate(`(() => {
		${COLLECTORS}
		const samples = [];
		for (const element of Array.from(document.body.querySelectorAll('*'))) {
			if (element.closest('.honeypot') || element.closest('noscript')) continue;
			if (!visible(element)) continue;
			const ownText = Array.from(element.childNodes)
				.filter((node) => node.nodeType === Node.TEXT_NODE)
				.map((node) => node.textContent.trim())
				.join('')
				.trim();
			if (ownText.length === 0) continue;
			const style = getComputedStyle(element);
			samples.push({
				label: label(element),
				color: style.color,
				backgroundLayers: backgroundLayers(element),
				fontSize: Number.parseFloat(style.fontSize),
				fontWeight: Number(style.fontWeight) || 400,
			});
		}
		return samples;
	})()`) as Promise<TextSample[]>;
}

async function collectControlSamples(page: Page): Promise<ControlSample[]> {
	return page.evaluate(`(() => {
		${COLLECTORS}
		const selector = 'button, input:not([type=hidden]), textarea, select, altcha-widget, a.button';
		const samples = [];
		for (const element of Array.from(document.querySelectorAll(selector))) {
			if (element.closest('.honeypot')) continue;
			// Exactly the mode switch's <input> — Zag's clipped 1px a11y
			// channel, not a painted control — is exempt; the switch's
			// perceivable 1.4.11 boundary is the accent thumb, swept as a
			// token pair by src/lib/design-token-contrast.test.ts ('mode
			// switch thumb on its track') in both schemes. Nothing else in
			// the switch subtree gets a pass.
			if (element.tagName === 'INPUT' && element.closest('.mode-switch, .wiper-stalk')) continue;
			if (element.disabled) continue;
			if (!visible(element)) continue;
			const style = getComputedStyle(element);
			samples.push({
				label: label(element),
				fill: style.backgroundColor,
				borderColor: style.borderTopColor,
				borderWidth: Number.parseFloat(style.borderTopWidth) || 0,
				surfaceLayers: backgroundLayers(element.parentElement || document.body),
			});
		}
		return samples;
	})()`) as Promise<ControlSample[]>;
}

function requiredTextRatio(sample: TextSample): number {
	const isLarge = sample.fontSize >= 24 || (sample.fontSize >= 18.66 && sample.fontWeight >= 700);
	return isLarge ? LARGE_TEXT_AA_RATIO : TEXT_AA_RATIO;
}

// src/lib/design-token-contrast.test.ts checks the tokens. The browser measures the colours
// painted in both schemes.
for (const scheme of ['light', 'dark'] as const) {
	test.describe(`${scheme} scheme`, () => {
		test.use({ colorScheme: scheme });

		test.describe('WCAG 1.4.3 — every painted string reaches AA', () => {
			for (const [name, path] of [
				['the landing view', '/'],
				['the log archive', '/log'],
				// The 2026-08-31 ruling puts this panel directly on the page ground.
				['the contact page', '/contact'],
			] as const) {
				test(`text contrast holds across ${name}`, async ({ page, guardedPage }) => {
					await openPage(page, guardedPage, path);
					const samples = await collectTextSamples(page);
					expect(samples.length, 'text-bearing elements sampled').toBeGreaterThan(20);

					const failures = samples
						.map((sample) => {
							const background = resolveBackground(sample.backgroundLayers);
							return {
								sample,
								background,
								ratio: roundRatio(contrastRatio(sample.color, background)),
								required: requiredTextRatio(sample),
							};
						})
						.filter((entry) => entry.ratio < entry.required)
						.map(
							(entry) =>
								`${entry.sample.label}: ${formatRgb(entry.sample.color)} at ${entry.ratio}:1 on ${formatRgb(entry.background)} (needs ${entry.required})`,
						);

					expect(failures, 'text below its AA threshold').toEqual([]);
				});
			}

			test('validation and error text stays readable once it appears', async ({ page, guardedPage }) => {
				await openPage(page, guardedPage, '/contact');
				await page.getByRole('button', { name: 'Send to keyholders' }).click();
				await expect(page.locator('.field-error').first()).toBeVisible();

				const samples = await collectTextSamples(page);
				const errors = samples.filter((sample) => sample.label.includes('field-error'));
				expect(errors.length, 'error messages sampled').toBeGreaterThan(0);
				for (const sample of errors) {
					const background = resolveBackground(sample.backgroundLayers);
					const ratio = roundRatio(contrastRatio(sample.color, background));
					expect(
						ratio,
						`${sample.label}: ${formatRgb(sample.color)} on ${formatRgb(background)} measured ${ratio}:1`,
					).toBeGreaterThanOrEqual(requiredTextRatio(sample));
				}
			});
		});

		test.describe('WCAG 1.4.11 — filled controls stand out from their surface', () => {
			test('every filled control reaches 3:1 against the surface it sits on', async ({ page, guardedPage }) => {
				await openPage(page, guardedPage, '/contact');
				const samples = await collectControlSamples(page);
				expect(samples.length, 'controls sampled').toBeGreaterThan(3);

				const failures: string[] = [];
				for (const sample of samples) {
					const surface = resolveBackground(sample.surfaceLayers);
					// Either the fill or the border can distinguish the control from its surface.
					const fillRatio = roundRatio(contrastRatio(sample.fill, surface));
					const borderRatio = sample.borderWidth > 0 ? roundRatio(contrastRatio(sample.borderColor, surface)) : 0;
					const best = Math.max(fillRatio, borderRatio);
					if (best < NON_TEXT_RATIO) {
						failures.push(`${sample.label}: fill ${fillRatio}:1, border ${borderRatio}:1 on ${formatRgb(surface)}`);
					}
				}
				expect(failures, 'controls below 3:1 against their surface').toEqual([]);
			});

			test('the focus indicator is distinguishable from the control it rings', async ({ page, guardedPage }) => {
				await openPage(page, guardedPage, '/contact');
				// Reach the button by keyboard: :focus-visible is what paints the ring,
				// and a scripted focus() does not reliably match it.
				await page.locator('#contact-message').focus();
				await page.keyboard.press('Tab');
				await expect(page.getByRole('button', { name: 'Send to keyholders' })).toBeFocused();

				const measured = (await page.evaluate(`(() => {
					${COLLECTORS}
					const control = document.activeElement;
					const style = getComputedStyle(control);
					// The colour inside a box-shadow may be spelled rgb(), oklab() or
					// color(); match the function name, not one specific spelling.
					const ring = (style.boxShadow.match(/(?:rgba?|oklab|oklch|color)\\([^)]*\\)/) || [])[0] || style.outlineColor;
					return {
						ring,
						fill: style.backgroundColor,
						surfaceLayers: backgroundLayers(control.parentElement),
						outlineWidth: style.outlineWidth,
						boxShadow: style.boxShadow,
					};
				})()`)) as {
					ring: string;
					fill: string;
					surfaceLayers: string[];
					outlineWidth: string;
					boxShadow: string;
				};

				expect(
					measured.boxShadow === 'none' && Number.parseFloat(measured.outlineWidth) === 0,
					'the focused submit button paints no indicator at all',
				).toBe(false);

				// The 2026-08-31 ruling places the button on the page ground. Composite the focus ring
				// there first. Under SC 1.4.11 technique G195, either adjacent edge can distinguish the
				// ring. This differs from the unconditional 3:1 against the control in TIN-3855.
				// src/lib/design-token-contrast.test.ts models both edges against the card and page
				// grounds.
				const surface = resolveBackground(measured.surfaceLayers);
				const ringOnPanel = compositeOver(parseCssColor(measured.ring), surface);
				const againstControl = roundRatio(contrastRatio(ringOnPanel, measured.fill));
				const againstSurface = roundRatio(contrastRatio(ringOnPanel, surface));
				expect(
					Math.max(againstControl, againstSurface),
					`focus ring measured ${againstControl}:1 against the button and ${againstSurface}:1 against the panel`,
				).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
			});
		});
	});
}
