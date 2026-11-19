/**
 * Resolve the roles in `src/app.css` against CityLink palette tokens in
 * `src/lib/styles/theme-gftb.css`. The test can then calculate each scheme's WCAG contrast
 * with `color-contrast.mjs`. Keep this resolver under `scripts/lib` so routes cannot bundle
 * it.
 */

import { parseCssColor } from './color-contrast.mjs';

/** Nesting depth a `var()` chain may reach before we call it a cycle. */
const MAX_DEPTH = 32;

/**
 * Declarations inside the first block matching `selector`.
 *
 * @param {string} css
 * @param {RegExp} selector Anchored at a block opening; must capture the body.
 * @returns {Record<string, string>}
 */
function declarationsIn(css, selector) {
	const body = selector.exec(css)?.[1];
	if (!body) throw new Error(`no block matched ${selector}`);
	/** @type {Record<string, string>} */
	const declarations = {};
	for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/giu)) {
		declarations[match[1]] = match[2].trim();
	}
	return declarations;
}

/**
 * The palette layer: every `--color-*` token, plus the pinned anchor/brand ones.
 *
 * @param {string} themeCss
 * @returns {Record<string, string>}
 */
export function paletteTokens(themeCss) {
	return declarationsIn(themeCss, /\[data-theme='gftb'\]\s*\{([\s\S]*?)\n\}/u);
}

/**
 * Apply `[data-mode='dark']` overrides to the light roles. Match the selector through its
 * opening brace to exclude compound rules such as `[data-mode='dark'] pre.shiki`.
 *
 * @param {string} appCss
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function roleTokens(appCss) {
	const light = declarationsIn(appCss, /^:root\s*\{([\s\S]*?)\n\}/mu);
	const darkOverrides = declarationsIn(appCss, /^\[data-mode='dark'\]\s*\{([\s\S]*?)\n\}/mu);
	return { light, dark: { ...light, ...darkOverrides } };
}

/**
 * Merge the two layers for each scheme before calling {@link resolveColor}.
 *
 * @param {{ appCss: string, themeCss: string }} sources
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function schemes({ appCss, themeCss }) {
	const palette = paletteTokens(themeCss);
	const roles = roleTokens(appCss);
	return {
		light: { ...palette, ...roles.light },
		dark: { ...palette, ...roles.dark },
	};
}

/**
 * Expands every `var(--x)` in `value` against `tokens`, honouring fallbacks.
 *
 * @param {Record<string, string>} tokens
 * @param {string} value
 * @param {number} [depth]
 * @returns {string}
 */
export function expandVars(tokens, value, depth = 0) {
	if (depth > MAX_DEPTH) throw new Error(`var() chain does not terminate: ${value}`);
	if (!value.includes('var(')) return value.trim();

	const start = value.indexOf('var(');
	let cursor = start + 4;
	let open = 1;
	while (cursor < value.length && open > 0) {
		if (value[cursor] === '(') open += 1;
		else if (value[cursor] === ')') open -= 1;
		cursor += 1;
	}
	if (open !== 0) throw new Error(`unbalanced var() in: ${value}`);

	const inner = value.slice(start + 4, cursor - 1);
	const comma = inner.indexOf(',');
	const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
	const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();

	const declared = tokens[name];
	const replacement = declared ?? fallback;
	if (replacement === undefined) throw new Error(`undeclared custom property: ${name}`);

	return expandVars(tokens, value.slice(0, start) + replacement + value.slice(cursor), depth + 1);
}

const COLOR_MIX_TRANSPARENT_RE = /^color-mix\(\s*in\s+[a-z-]+\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/iu;

/**
 * Resolve each CSS declaration to a colour. Mixing with `transparent` in `color-mix()` scales
 * that colour's alpha.
 *
 * @param {Record<string, string>} tokens
 * @param {string} value A declaration body or a raw colour.
 * @returns {import('./color-contrast.mjs').Rgb}
 */
export function resolveColor(tokens, value) {
	const expanded = expandVars(tokens, value);
	const mixed = COLOR_MIX_TRANSPARENT_RE.exec(expanded);
	if (mixed) {
		const base = parseCssColor(mixed[1].trim());
		return { ...base, alpha: base.alpha * (Number.parseFloat(mixed[2]) / 100) };
	}
	return parseCssColor(expanded);
}

/**
 * Resolve a named role, such as `resolveRole(scheme, '--heading')`.
 *
 * @param {Record<string, string>} tokens
 * @param {string} name
 * @returns {import('./color-contrast.mjs').Rgb}
 */
export function resolveRole(tokens, name) {
	const declared = tokens[name];
	if (declared === undefined) throw new Error(`undeclared custom property: ${name}`);
	return resolveColor(tokens, declared);
}
