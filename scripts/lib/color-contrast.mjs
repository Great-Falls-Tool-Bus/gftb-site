/**
 * WCAG 2.2 colour maths for the shipped design tokens.
 *
 * Deliberately dependency-free and pure so the acceptance suite can assert
 * contrast on the tokens declared in `src/app.css` without booting a browser.
 * The browser-side spot checks in `e2e/` duplicate none of this: they read
 * *computed* colours and feed them through the same ratio definition.
 *
 * Test-only, so it lives here rather than under `src/lib` (the SvelteKit
 * library root): nothing the site ships needs colour maths at run time, and a
 * module that cannot be imported by a route cannot be bundled by accident.
 * Plain ESM so `node` and `vitest` load the same bytes with no transpile step.
 */

/**
 * @typedef {object} Rgb
 * @property {number} red
 * @property {number} green
 * @property {number} blue
 * @property {number} alpha 0..1; 1 for fully opaque colours.
 */

/** WCAG 2.2 SC 1.4.3 — normal body text. */
export const TEXT_AA_RATIO = 4.5;
/** WCAG 2.2 SC 1.4.3 — large text (>=24px, or >=18.66px bold). */
export const LARGE_TEXT_AA_RATIO = 3;
/** WCAG 2.2 SC 1.4.11 — user-interface components and graphical objects. */
export const NON_TEXT_RATIO = 3;

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_RE = /^rgba?\(([^)]*)\)$/i;

/**
 * @param {number} value
 * @returns {number}
 */
function clampChannel(value) {
	return Math.min(255, Math.max(0, value));
}

/**
 * @param {string} value
 * @returns {Rgb}
 */
function parseHex(value) {
	const digits = value.slice(1);
	/** @param {string} pair */
	const expand = (pair) => Number.parseInt(pair.length === 1 ? pair + pair : pair, 16);
	if (digits.length <= 4) {
		const [r, g, b, a] = digits.split('');
		return {
			red: expand(r),
			green: expand(g),
			blue: expand(b),
			alpha: a === undefined ? 1 : expand(a) / 255,
		};
	}
	return {
		red: expand(digits.slice(0, 2)),
		green: expand(digits.slice(2, 4)),
		blue: expand(digits.slice(4, 6)),
		alpha: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
	};
}

/**
 * @param {string} token
 * @param {number} scale
 * @returns {number}
 */
function parseComponent(token, scale) {
	const trimmed = token.trim();
	if (trimmed.endsWith('%')) return (Number.parseFloat(trimmed) / 100) * scale;
	return Number.parseFloat(trimmed);
}

/**
 * Accepts the colour spellings this codebase actually ships: `#rgb`, `#rrggbb`,
 * `#rrggbbaa`, `rgb(r g b / a%)`, `rgb(r, g, b)` and `rgba(...)` — the forms
 * emitted both by `src/app.css` and by `getComputedStyle`.
 *
 * @param {string} input
 * @returns {Rgb}
 */
export function parseCssColor(input) {
	const value = input.trim();
	if (value.toLowerCase() === 'white') return { red: 255, green: 255, blue: 255, alpha: 1 };
	if (value.toLowerCase() === 'black') return { red: 0, green: 0, blue: 0, alpha: 1 };
	if (value.toLowerCase() === 'transparent') return { red: 0, green: 0, blue: 0, alpha: 0 };
	if (HEX_RE.test(value)) return parseHex(value);

	const functional = FUNCTIONAL_RE.exec(value);
	if (!functional) throw new Error(`Unsupported CSS colour: ${input}`);
	const [channels, alphaPart] = functional[1].split('/');
	const parts = channels
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean);
	if (parts.length < 3) throw new Error(`Unsupported CSS colour: ${input}`);
	const alphaToken = alphaPart ?? parts[3];
	return {
		red: clampChannel(parseComponent(parts[0], 255)),
		green: clampChannel(parseComponent(parts[1], 255)),
		blue: clampChannel(parseComponent(parts[2], 255)),
		alpha: alphaToken === undefined ? 1 : Math.min(1, Math.max(0, parseComponent(alphaToken, 1))),
	};
}

/**
 * Simple (non-premultiplied) source-over composite of `foreground` onto `backdrop`.
 *
 * @param {Rgb} foreground
 * @param {Rgb} backdrop
 * @returns {Rgb}
 */
export function compositeOver(foreground, backdrop) {
	const alpha = foreground.alpha;
	return {
		red: foreground.red * alpha + backdrop.red * (1 - alpha),
		green: foreground.green * alpha + backdrop.green * (1 - alpha),
		blue: foreground.blue * alpha + backdrop.blue * (1 - alpha),
		alpha: 1,
	};
}

/**
 * WCAG 2.x relative luminance.
 *
 * @param {Rgb | string} color
 * @returns {number}
 */
export function relativeLuminance(color) {
	const rgb = typeof color === 'string' ? parseCssColor(color) : color;
	const linear = [rgb.red, rgb.green, rgb.blue].map((channel) => {
		const normalized = channel / 255;
		return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/**
 * WCAG contrast ratio. Translucent inputs are composited over `background`
 * first, because a ratio computed against an un-composited alpha colour is
 * meaningless — and quietly optimistic.
 *
 * @param {Rgb | string} foreground
 * @param {Rgb | string} background
 * @returns {number}
 */
export function contrastRatio(foreground, background) {
	const backdrop = typeof background === 'string' ? parseCssColor(background) : background;
	if (backdrop.alpha < 1) throw new Error('The background of a contrast pair must be opaque');
	const rawForeground = typeof foreground === 'string' ? parseCssColor(foreground) : foreground;
	const front = rawForeground.alpha < 1 ? compositeOver(rawForeground, backdrop) : rawForeground;
	const lighter = Math.max(relativeLuminance(front), relativeLuminance(backdrop));
	const darker = Math.min(relativeLuminance(front), relativeLuminance(backdrop));
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Ratios are reported to two decimals so failure messages stay readable.
 *
 * @param {number} ratio
 * @returns {number}
 */
export function roundRatio(ratio) {
	return Math.round(ratio * 100) / 100;
}

/**
 * @param {Rgb | string} foreground
 * @param {Rgb | string} background
 * @returns {boolean}
 */
export function meetsTextAA(foreground, background) {
	return contrastRatio(foreground, background) >= TEXT_AA_RATIO;
}

/**
 * @param {Rgb | string} foreground
 * @param {Rgb | string} background
 * @returns {boolean}
 */
export function meetsLargeTextAA(foreground, background) {
	return contrastRatio(foreground, background) >= LARGE_TEXT_AA_RATIO;
}

/**
 * @param {Rgb | string} foreground
 * @param {Rgb | string} background
 * @returns {boolean}
 */
export function meetsNonTextContrast(foreground, background) {
	return contrastRatio(foreground, background) >= NON_TEXT_RATIO;
}
