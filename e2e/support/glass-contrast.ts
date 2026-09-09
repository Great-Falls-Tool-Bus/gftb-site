import type { Page } from '@playwright/test';
import { decodePng, luminanceExtremes, type Rgb } from './png-luminance';

// Shared glass-contrast measurement (lifted from
// acceptance-hero-glass-contrast.spec.ts so the Notes & Goals pane backstop
// in home-goals.spec.ts measures with the same implementation).
//
// Methodology: hide everything inside the selected element except its own
// painted background (visibility: hidden on descendants leaves the parent's
// background/backdrop-filter and its ::before untouched), screenshot just
// that element, and scan the PNG for the darkest/lightest pixel by WCAG
// relative luminance. That is the true composite: blur, saturate, panel
// tint and whatever sits underneath, already baked in by the compositor.

export async function setScheme(page: Page, scheme: 'light' | 'dark') {
	await page.evaluate((mode) => {
		localStorage.setItem('color-mode', mode);
		document.documentElement.setAttribute('data-mode', mode);
	}, scheme);
	await page.reload();
	await page.waitForLoadState('networkidle');
}

/** Resolves a CSS custom property to true 8-bit sRGB via a canvas round-trip
 * (getComputedStyle can hand back an oklch() string verbatim; canvas
 * fillStyle always normalizes to a paintable colour). The selected container
 * supplies inherited local roles, including the stronger glass inks. */
export async function resolveRoleRgb(page: Page, role: string, selector = 'body'): Promise<Rgb> {
	return page.evaluate(
		({ cssVar, scope }) => {
			const parent = document.querySelector(scope);
			if (!parent) throw new Error(`${scope} is not present on the page`);
			const el = document.createElement('div');
			el.style.color = `var(${cssVar})`;
			el.style.position = 'absolute';
			el.style.opacity = '0';
			parent.appendChild(el);
			const computed = getComputedStyle(el).color;
			el.remove();
			const canvas = document.createElement('canvas');
			canvas.width = 1;
			canvas.height = 1;
			const ctx = canvas.getContext('2d')!;
			ctx.fillStyle = computed;
			ctx.fillRect(0, 0, 1, 1);
			const [red, green, blue] = ctx.getImageData(0, 0, 1, 1).data;
			return { red, green, blue };
		},
		{ cssVar: role, scope: selector },
	);
}

/**
 * `margin` is the scan inset in CSS px: the hero keeps the original 6; the
 * Notes & Goals pane passes a wider inset because its 1px `--rule` border
 * lands inside the clip at fractional scroll offsets and a border is not a
 * ground any ink sits on.
 */
export async function measureGlassExtremes(page: Page, selector: string, margin = 6) {
	const rect = await page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	}, selector);
	if (!rect) throw new Error(`${selector} is not present on the page`);

	await page.addStyleTag({ content: `${selector} * { visibility: hidden !important; }` });
	const buffer = await page.screenshot({ clip: rect });
	await page.evaluate(() => {
		document.querySelectorAll('style').forEach((s) => {
			if (s.textContent?.includes('visibility: hidden')) s.remove();
		});
	});
	const image = decodePng(buffer);
	return luminanceExtremes(image, margin);
}

/** A CSS-px rect relative to the measured element's box. */
export interface InkSampleRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * The scene canvas is measured as painted, with nothing hidden: screenshot
 * the element and scan only the pixels under the given rects (the notes'
 * text boxes, relative to the element). Returns the darkest and lightest
 * pixel by WCAG relative luminance across all rects.
 */
export async function measureExtremesInRects(
	page: Page,
	selector: string,
	rects: InkSampleRect[],
	hideSelector?: string,
) {
	const box = await page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	}, selector);
	if (!box) throw new Error(`${selector} is not present on the page`);
	// The notes paint over the scene; hide them for the capture so only the
	// scene's own pixels are read under their boxes.
	if (hideSelector) await page.addStyleTag({ content: `${hideSelector} { visibility: hidden !important; }` });
	const buffer = await page.screenshot({ clip: box });
	if (hideSelector) {
		await page.evaluate(() => {
			document.querySelectorAll('style').forEach((s) => {
				if (s.textContent?.includes('visibility: hidden !important')) s.remove();
			});
		});
	}
	const image = decodePng(buffer);
	const scaleX = image.width / box.width;
	const scaleY = image.height / box.height;
	const channel = (r: number) => (r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4);
	let darkest: { luminance: number; rgb: Rgb } | null = null;
	let lightest: { luminance: number; rgb: Rgb } | null = null;
	let sampled = 0;
	for (const rect of rects) {
		const x0 = Math.max(0, Math.floor(rect.left * scaleX));
		const y0 = Math.max(0, Math.floor(rect.top * scaleY));
		const x1 = Math.min(image.width, Math.ceil((rect.left + rect.width) * scaleX));
		const y1 = Math.min(image.height, Math.ceil((rect.top + rect.height) * scaleY));
		for (let y = y0; y < y1; y += 1) {
			for (let x = x0; x < x1; x += 1) {
				const offset = (y * image.width + x) * image.channels;
				const red = image.pixels[offset];
				const green = image.pixels[offset + 1];
				const blue = image.pixels[offset + 2];
				const luminance = 0.2126 * channel(red / 255) + 0.7152 * channel(green / 255) + 0.0722 * channel(blue / 255);
				sampled += 1;
				if (!darkest || luminance < darkest.luminance) darkest = { luminance, rgb: { red, green, blue } };
				if (!lightest || luminance > lightest.luminance) lightest = { luminance, rgb: { red, green, blue } };
			}
		}
	}
	if (!darkest || !lightest) throw new Error(`${selector}: no pixels sampled under ${rects.length} rects`);
	return { darkest, lightest, sampled };
}
