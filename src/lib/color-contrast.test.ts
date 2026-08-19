import { describe, expect, it } from 'vitest';
import {
	compositeOver,
	contrastRatio,
	formatRgb,
	meetsLargeTextAA,
	meetsNonTextContrast,
	meetsTextAA,
	parseCssColor,
	relativeLuminance,
	roundRatio,
} from '../../scripts/lib/color-contrast.mjs';

describe('WCAG colour maths', () => {
	it('parses every colour spelling this repo ships', () => {
		expect(parseCssColor('#fff')).toEqual({ red: 255, green: 255, blue: 255, alpha: 1 });
		expect(parseCssColor('#512c64')).toEqual({ red: 81, green: 44, blue: 100, alpha: 1 });
		expect(parseCssColor('white')).toEqual({ red: 255, green: 255, blue: 255, alpha: 1 });
		expect(parseCssColor('rgb(242 200 75 / 65%)')).toEqual({ red: 242, green: 200, blue: 75, alpha: 0.65 });
		expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual({ red: 0, green: 0, blue: 0, alpha: 0.5 });
		expect(parseCssColor('rgb(81, 44, 100)')).toEqual({ red: 81, green: 44, blue: 100, alpha: 1 });
		expect(() => parseCssColor('color(display-p3 1 0 0)')).toThrow(/Unsupported CSS colour/u);
	});

	it('reads the OKLab spellings the palette authors and the browser returns', () => {
		// Authored form, straight out of src/lib/styles/theme-gftb.css.
		expect(formatRgb(parseCssColor('oklch(38.32% 0.0755 294.64deg)'))).toBe('#463a67');
		expect(formatRgb(parseCssColor('oklch(84.2% 0.1663 94.09deg)'))).toBe('#efc822');
		expect(formatRgb(parseCssColor('oklch(26.25% 0.0186 314.48deg)'))).toBe('#28222b');
		// Computed form: Chromium serialises the same declaration with a 0..1
		// lightness and a unitless hue, and does not down-convert it to rgb().
		expect(formatRgb(parseCssColor('oklch(0.3832 0.0755 294.64)'))).toBe('#463a67');
		// color-mix(in oklab, …, transparent) comes back as oklab() with alpha.
		expect(parseCssColor('oklab(0.842 -0.0118611 0.165876 / 0.16)').alpha).toBeCloseTo(0.16, 10);
		expect(formatRgb({ ...parseCssColor('oklab(0.842 -0.0118611 0.165876 / 0.16)'), alpha: 1 })).toBe('#efc822');
		// The exact sRGB spelling is accepted; other color() spaces still are not.
		expect(formatRgb(parseCssColor('color(srgb 1 0.5 0)'))).toBe('#ff8000');
	});

	it('reads every CSS angle unit the hue component may carry', () => {
		// 94.09deg is --color-secondary-300, the site's --highlight. Each spelling
		// below is the same angle: 104.544grad, 1.642199rad, 0.2613611turn.
		// `grad` is the trap — it ends in `rad`, so an unanchored radian probe
		// converts it with the wrong factor and lands on #0eddff instead.
		expect(formatRgb(parseCssColor('oklch(84.2% 0.1663 94.09deg)'))).toBe('#efc822');
		expect(formatRgb(parseCssColor('oklch(84.2% 0.1663 104.544grad)'))).toBe('#efc822');
		expect(formatRgb(parseCssColor('oklch(84.2% 0.1663 1.642199rad)'))).toBe('#efc822');
		expect(formatRgb(parseCssColor('oklch(84.2% 0.1663 0.2613611turn)'))).toBe('#efc822');
		expect(formatRgb(parseCssColor('oklch(84.2% 0.1663 94.09)'))).toBe('#efc822');
	});

	it('refuses to guess when a modern colour function is short a component', () => {
		expect(() => parseCssColor('oklch(0.38 0.07)')).toThrow(/Unsupported CSS colour/u);
		expect(() => parseCssColor('oklab(0.38 0.07)')).toThrow(/Unsupported CSS colour/u);
	});

	it('measures an oklch pair the same as the hexes it paints', () => {
		expect(roundRatio(contrastRatio('oklch(0.8906 0.0593 294.64)', 'oklch(0.3832 0.0755 294.64)'))).toBe(
			roundRatio(contrastRatio('#ddd4ff', '#463a67')),
		);
	});

	it('reproduces the reference luminance endpoints', () => {
		expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
		expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
		// sRGB primaries, straight from the WCAG relative-luminance definition.
		expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 6);
		expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 6);
		expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 6);
	});

	it('reproduces published contrast ratios', () => {
		expect(roundRatio(contrastRatio('#000000', '#ffffff'))).toBe(21);
		expect(roundRatio(contrastRatio('#ffffff', '#ffffff'))).toBe(1);
		// Widely published reference pairs.
		expect(roundRatio(contrastRatio('#767676', '#ffffff'))).toBe(4.54);
		expect(roundRatio(contrastRatio('#777777', '#ffffff'))).toBe(4.48);
		expect(roundRatio(contrastRatio('#949494', '#ffffff'))).toBe(3.03);
	});

	it('is symmetric in its arguments', () => {
		expect(contrastRatio('#512c64', '#f7f0df')).toBeCloseTo(contrastRatio('#f7f0df', '#512c64'), 12);
	});

	it('composites a translucent foreground before measuring it', () => {
		const composited = compositeOver(parseCssColor('rgb(0 0 0 / 50%)'), parseCssColor('#ffffff'));
		expect(composited).toEqual({ red: 127.5, green: 127.5, blue: 127.5, alpha: 1 });
		// A naive implementation would report 21:1 for this pair by ignoring alpha.
		expect(roundRatio(contrastRatio('rgb(0 0 0 / 50%)', '#ffffff'))).toBeLessThan(21);
		expect(roundRatio(contrastRatio('rgb(0 0 0 / 0%)', '#ffffff'))).toBe(1);
	});

	it('refuses to measure against a translucent background instead of guessing', () => {
		expect(() => contrastRatio('#000000', 'rgb(255 255 255 / 50%)')).toThrow(/must be opaque/u);
	});

	it('applies the three WCAG thresholds at their exact boundaries', () => {
		expect(meetsTextAA('#767676', '#ffffff')).toBe(true);
		expect(meetsTextAA('#777777', '#ffffff')).toBe(false);
		expect(meetsLargeTextAA('#949494', '#ffffff')).toBe(true);
		expect(meetsLargeTextAA('#959595', '#ffffff')).toBe(false);
		expect(meetsNonTextContrast('#949494', '#ffffff')).toBe(true);
		expect(meetsNonTextContrast('#959595', '#ffffff')).toBe(false);
	});
});
