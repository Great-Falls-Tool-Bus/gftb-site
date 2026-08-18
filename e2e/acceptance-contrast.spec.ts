import { expect, test, type Page } from '@playwright/test';
import {
	LARGE_TEXT_AA_RATIO,
	NON_TEXT_RATIO,
	TEXT_AA_RATIO,
	compositeOver,
	contrastRatio,
	parseCssColor,
	roundRatio,
} from '../scripts/lib/color-contrast.mjs';
import { installExternalGuard, stubChallenge } from './support/network';

// Acceptance rows (§3): AA text contrast, and WCAG 1.4.11 3:1 non-text contrast
// for filled buttons and controls against their surface.
//
// The colour maths is imported from scripts/lib/color-contrast.mjs so this spec and
// the unit suite cannot disagree about what 4.5:1 means. The browser's job here
// is only to report what is actually painted, including inherited colours and
// composited panels the token test can only model.
//
// Known limitation, stated rather than hidden: `body` paints a translucent
// yellow gradient over --cream, which getComputedStyle does not resolve to a
// flat colour. Measurements against the page surface therefore use --cream, the
// darker of the two, so the reported ratio is the conservative one.

interface TextSample {
	label: string;
	color: string;
	background: string;
	fontSize: number;
	fontWeight: number;
}

interface ControlSample {
	label: string;
	fill: string;
	borderColor: string;
	borderWidth: number;
	surface: string;
}

async function openPage(page: Page, baseURL: string | undefined, hash = '') {
	await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
	await stubChallenge(page);
	await page.goto(`/${hash}`);
	await page.waitForLoadState('domcontentloaded');
}

const COLLECTORS = `
	const parse = (value) => {
		const parts = (value.match(/[\\d.]+/g) ?? []).map(Number);
		if (parts.length < 3) return null;
		return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
	};
	const over = (front, back) => ({
		r: front.r * front.a + back.r * (1 - front.a),
		g: front.g * front.a + back.g * (1 - front.a),
		b: front.b * front.a + back.b * (1 - front.a),
		a: 1,
	});
	const toCss = (rgb) => 'rgb(' + Math.round(rgb.r) + ' ' + Math.round(rgb.g) + ' ' + Math.round(rgb.b) + ')';
	// Effective background: composite every translucent layer down to the first
	// opaque ancestor, exactly as the compositor does.
	const effectiveBackground = (element) => {
		const layers = [];
		let node = element;
		while (node && node !== document.documentElement.parentElement) {
			const parsed = parse(getComputedStyle(node).backgroundColor);
			if (parsed && parsed.a > 0) {
				layers.push(parsed);
				if (parsed.a >= 1) break;
			}
			node = node.parentElement;
		}
		if (layers.length === 0) return 'rgb(255 255 255)';
		let result = layers[layers.length - 1];
		for (let index = layers.length - 2; index >= 0; index -= 1) result = over(layers[index], result);
		return toCss(result);
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
				background: effectiveBackground(element),
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
			if (element.disabled) continue;
			if (!visible(element)) continue;
			const style = getComputedStyle(element);
			samples.push({
				label: label(element),
				fill: style.backgroundColor,
				borderColor: style.borderTopColor,
				borderWidth: Number.parseFloat(style.borderTopWidth) || 0,
				surface: effectiveBackground(element.parentElement || document.body),
			});
		}
		return samples;
	})()`) as Promise<ControlSample[]>;
}

function requiredTextRatio(sample: TextSample): number {
	const isLarge = sample.fontSize >= 24 || (sample.fontSize >= 18.66 && sample.fontWeight >= 700);
	return isLarge ? LARGE_TEXT_AA_RATIO : TEXT_AA_RATIO;
}

test.describe('WCAG 1.4.3 — every painted string reaches AA', () => {
	for (const [name, hash] of [
		['the landing view', ''],
		['the contact panel', '#contact'],
	] as const) {
		test(`text contrast holds across ${name}`, async ({ page, baseURL }) => {
			await openPage(page, baseURL, hash);
			const samples = await collectTextSamples(page);
			expect(samples.length, 'text-bearing elements sampled').toBeGreaterThan(20);

			const failures = samples
				.map((sample) => ({
					sample,
					ratio: roundRatio(contrastRatio(sample.color, sample.background)),
					required: requiredTextRatio(sample),
				}))
				.filter((entry) => entry.ratio < entry.required)
				.map(
					(entry) => `${entry.sample.label}: ${entry.ratio}:1 on ${entry.sample.background} (needs ${entry.required})`,
				);

			expect(failures, 'text below its AA threshold').toEqual([]);
		});
	}

	test('validation and error text stays readable once it appears', async ({ page, baseURL }) => {
		await openPage(page, baseURL, '#contact');
		await page.getByRole('button', { name: 'Send to keyholders' }).click();
		await expect(page.locator('.field-error').first()).toBeVisible();

		const samples = await collectTextSamples(page);
		const errors = samples.filter((sample) => sample.label.includes('field-error'));
		expect(errors.length, 'error messages sampled').toBeGreaterThan(0);
		for (const sample of errors) {
			const ratio = roundRatio(contrastRatio(sample.color, sample.background));
			expect(ratio, `${sample.label} measured ${ratio}:1`).toBeGreaterThanOrEqual(requiredTextRatio(sample));
		}
	});
});

test.describe('WCAG 1.4.11 — filled controls stand out from their surface', () => {
	test('every filled control reaches 3:1 against the surface it sits on', async ({ page, baseURL }) => {
		await openPage(page, baseURL, '#contact');
		const samples = await collectControlSamples(page);
		expect(samples.length, 'controls sampled').toBeGreaterThan(3);

		const failures: string[] = [];
		for (const sample of samples) {
			// A control may be identified by its fill or by its border; take the
			// stronger of the two, which is what a person actually perceives.
			const fillRatio = roundRatio(contrastRatio(sample.fill, sample.surface));
			const borderRatio = sample.borderWidth > 0 ? roundRatio(contrastRatio(sample.borderColor, sample.surface)) : 0;
			const best = Math.max(fillRatio, borderRatio);
			if (best < NON_TEXT_RATIO) {
				failures.push(`${sample.label}: fill ${fillRatio}:1, border ${borderRatio}:1 on ${sample.surface}`);
			}
		}
		expect(failures, 'controls below 3:1 against their surface').toEqual([]);
	});

	test('the focus indicator is distinguishable from the control it rings', async ({ page, baseURL }) => {
		await openPage(page, baseURL, '#contact');
		// Reach the button by keyboard: :focus-visible is what paints the ring,
		// and a scripted focus() does not reliably match it.
		await page.locator('#contact-message').focus();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Send to keyholders' })).toBeFocused();

		const measured = (await page.evaluate(`(() => {
			${COLLECTORS}
			const control = document.activeElement;
			const style = getComputedStyle(control);
			const ring = (style.boxShadow.match(/rgba?\\([^)]*\\)/) || [])[0] || style.outlineColor;
			return {
				ring,
				fill: style.backgroundColor,
				surface: effectiveBackground(control.parentElement),
				outlineWidth: style.outlineWidth,
				boxShadow: style.boxShadow,
			};
		})()`)) as { ring: string; fill: string; surface: string; outlineWidth: string; boxShadow: string };

		expect(
			measured.boxShadow === 'none' && Number.parseFloat(measured.outlineWidth) === 0,
			'the focused submit button paints no indicator at all',
		).toBe(false);

		// The ring is drawn on the panel, so composite it there first, then
		// measure it against both colours it borders. WCAG 1.4.11 asks for 3:1
		// against adjacent colours; a ring that separates from either edge is
		// perceivable.
		const ringOnPanel = compositeOver(parseCssColor(measured.ring), parseCssColor(measured.surface));
		const againstControl = roundRatio(contrastRatio(ringOnPanel, measured.fill));
		const againstSurface = roundRatio(contrastRatio(ringOnPanel, measured.surface));
		expect(
			Math.max(againstControl, againstSurface),
			`focus ring measured ${againstControl}:1 against the button and ${againstSurface}:1 against the panel`,
		).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
	});
});
