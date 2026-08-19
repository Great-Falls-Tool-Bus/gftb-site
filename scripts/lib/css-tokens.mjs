/**
 * Resolves the CSS custom-property graph the site paints through.
 *
 * `src/app.css` declares roles (`--heading`, `--inverse-panel`, …) that point at
 * CityLink palette tokens in `src/lib/styles/theme-gftb.css`, which are `oklch()`
 * values. Nothing in the stylesheet is a colour until that chain is walked, so a
 * gate that greps `src/app.css` for `#rrggbb` measures a file that no longer
 * exists. This module walks the chain instead, per scheme, and hands back a
 * colour the WCAG maths in `color-contrast.mjs` can measure.
 *
 * Test-only, so it sits beside the other gate modules under `scripts/lib` rather
 * than in `src/lib`: a module a route cannot import is a module that cannot be
 * bundled by accident. Plain ESM, no dependencies.
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
 * The role layer, per scheme. `dark` is `light` with the
 * `prefers-color-scheme: dark` overrides applied, which is exactly how the
 * cascade resolves it in a browser.
 *
 * @param {string} appCss
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function roleTokens(appCss) {
	const light = declarationsIn(appCss, /^:root\s*\{([\s\S]*?)\n\}/mu);
	const darkOverrides = declarationsIn(
		appCss,
		/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\n\t\}/u,
	);
	return { light, dark: { ...light, ...darkOverrides } };
}

/**
 * Both layers merged, per scheme, ready for {@link resolveColor}.
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
 * Resolves a declaration to a measurable colour.
 *
 * Handles the one `color-mix()` shape this stylesheet uses — a colour mixed with
 * `transparent`, which is just that colour at the given alpha, and is how the
 * browser serialises it back (`oklab(… / 0.16)`).
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
 * Resolves a role by name, e.g. `resolveRole(scheme, '--heading')`.
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
