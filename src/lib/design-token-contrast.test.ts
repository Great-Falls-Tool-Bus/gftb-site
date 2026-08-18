import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	LARGE_TEXT_AA_RATIO,
	NON_TEXT_RATIO,
	TEXT_AA_RATIO,
	compositeOver,
	contrastRatio,
	parseCssColor,
	roundRatio,
} from '../../scripts/lib/color-contrast.mjs';

// Acceptance rows: AA text contrast, and WCAG 1.4.11 3:1 non-text contrast for
// filled buttons and controls against the surface they sit on. This measures
// the tokens as shipped in src/app.css so a palette edit fails here in
// milliseconds; e2e/acceptance-contrast.spec.ts re-measures the same rule
// against computed styles in a real browser.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');

function customProperties(css: string): Record<string, string> {
	const rootBlock = /:root\s*\{([\s\S]*?)\}/u.exec(css)?.[1];
	if (!rootBlock) throw new Error('src/app.css: no :root block');
	const tokens: Record<string, string> = {};
	for (const match of rootBlock.matchAll(/--([a-z-]+):\s*([^;]+);/gu)) tokens[match[1]] = match[2].trim();
	return tokens;
}

const token = customProperties(appCss);
const WHITE = '#ffffff';

/** Composited surfaces: the panels these tokens are actually painted on. */
const surface = {
	page: token.cream,
	// .status-card / .card / .log-entry / .history-card use rgb(255 253 247 / 88%).
	card: compositeOver(parseCssColor('rgb(255 253 247 / 88%)'), parseCssColor(token.cream)),
	paper: token.paper,
	yellowPanel: token.yellow,
	contactPanel: token['purple-dark'],
};

interface Pair {
	name: string;
	foreground: string | ReturnType<typeof compositeOver>;
	background: string | ReturnType<typeof compositeOver>;
	minimum: number;
}

const textPairs: Pair[] = [
	{ name: 'body copy on the page', foreground: token.ink, background: surface.page, minimum: TEXT_AA_RATIO },
	{ name: 'body copy on a card', foreground: token.ink, background: surface.card, minimum: TEXT_AA_RATIO },
	{ name: 'muted helper text on a card', foreground: token.muted, background: surface.card, minimum: TEXT_AA_RATIO },
	{ name: 'footer muted text on paper', foreground: token.muted, background: surface.paper, minimum: TEXT_AA_RATIO },
	{ name: 'eyebrow on the page', foreground: token.purple, background: surface.page, minimum: TEXT_AA_RATIO },
	{
		name: 'headings on the page',
		foreground: token['purple-dark'],
		background: surface.page,
		minimum: LARGE_TEXT_AA_RATIO,
	},
	{
		name: 'next-session heading on the yellow panel',
		foreground: token['purple-dark'],
		background: surface.yellowPanel,
		minimum: LARGE_TEXT_AA_RATIO,
	},
	{
		name: 'next-session copy on the yellow panel',
		foreground: token.ink,
		background: surface.yellowPanel,
		minimum: TEXT_AA_RATIO,
	},
	{ name: 'skip link label', foreground: token.ink, background: surface.yellowPanel, minimum: TEXT_AA_RATIO },
	{ name: 'contact panel copy', foreground: WHITE, background: surface.contactPanel, minimum: TEXT_AA_RATIO },
	{
		name: 'contact panel helper text',
		foreground: '#d8c9de',
		background: surface.contactPanel,
		minimum: TEXT_AA_RATIO,
	},
	{
		name: 'contact panel field error',
		foreground: '#ffd0cb',
		background: surface.contactPanel,
		minimum: TEXT_AA_RATIO,
	},
	{ name: 'form notice error text', foreground: '#8b1f25', background: surface.paper, minimum: TEXT_AA_RATIO },
	{ name: 'primary button label', foreground: WHITE, background: token.purple, minimum: TEXT_AA_RATIO },
	{
		name: 'secondary button label',
		foreground: token['purple-dark'],
		background: surface.page,
		minimum: TEXT_AA_RATIO,
	},
	{ name: 'contact panel eyebrow', foreground: token.yellow, background: surface.contactPanel, minimum: TEXT_AA_RATIO },
	{
		name: 'contact panel button label',
		foreground: token['purple-dark'],
		background: token.paper,
		minimum: TEXT_AA_RATIO,
	},
	{ name: 'form field text', foreground: token.ink, background: token.paper, minimum: TEXT_AA_RATIO },
];

/**
 * WCAG 1.4.11 — a filled control must be distinguishable from the surface it
 * is placed on. Every pair here is a control fill (or its focus indicator)
 * against the adjacent colour that forms its perceivable boundary.
 */
const nonTextPairs: Pair[] = [
	{ name: 'primary button fill on the page', foreground: token.purple, background: surface.page },
	{ name: 'primary button fill on a card', foreground: token.purple, background: surface.card },
	{ name: 'secondary button border on the page', foreground: token.purple, background: surface.page },
	{ name: 'contact panel button fill', foreground: token.paper, background: surface.contactPanel },
	{ name: 'form field fill on the contact panel', foreground: token.paper, background: surface.contactPanel },
	{ name: 'ALTCHA widget fill on the contact panel', foreground: token.paper, background: surface.contactPanel },
	{ name: 'field focus outline on the contact panel', foreground: token.yellow, background: surface.contactPanel },
	{
		name: 'button focus glow against the button it rings, on the page',
		foreground: compositeOver(parseCssColor('rgb(242 200 75 / 65%)'), parseCssColor(surface.page)),
		background: token.purple,
	},
	{
		name: 'button focus glow against the button it rings, on the contact panel',
		foreground: compositeOver(parseCssColor('rgb(242 200 75 / 65%)'), parseCssColor(surface.contactPanel)),
		background: token.paper,
	},
	{
		name: 'button focus glow against the contact panel',
		foreground: compositeOver(parseCssColor('rgb(242 200 75 / 65%)'), parseCssColor(surface.contactPanel)),
		background: surface.contactPanel,
	},
].map((pair) => ({ ...pair, minimum: NON_TEXT_RATIO }));

describe('shipped palette tokens', () => {
	it('declares every token the acceptance pairs measure', () => {
		for (const name of ['ink', 'purple', 'purple-dark', 'yellow', 'cream', 'paper', 'muted', 'line']) {
			expect(token[name], `--${name}`).toMatch(/^#[0-9a-f]{6}$/iu);
		}
	});

	it('still paints the surfaces these pairs assume', () => {
		expect(appCss).toContain('background: var(--purple-dark);');
		expect(appCss).toMatch(/\.contact-card \.button \{[^}]*background: var\(--paper\);/u);
		expect(appCss).toMatch(/\.contact-card \.eyebrow \{[^}]*color: var\(--yellow\);/u);
		expect(appCss).toContain('rgb(255 253 247 / 88%)');
		expect(appCss).toContain('rgb(242 200 75 / 65%)');
	});
});

describe('WCAG 1.4.3 — text contrast on the shipped tokens', () => {
	for (const pair of textPairs) {
		it(`${pair.name} reaches ${pair.minimum}:1`, () => {
			const ratio = roundRatio(contrastRatio(pair.foreground, pair.background));
			expect(ratio, `${pair.name} measured ${ratio}:1`).toBeGreaterThanOrEqual(pair.minimum);
		});
	}
});

describe('WCAG 1.4.11 — non-text contrast for filled controls', () => {
	for (const pair of nonTextPairs) {
		it(`${pair.name} reaches ${NON_TEXT_RATIO}:1`, () => {
			const ratio = roundRatio(contrastRatio(pair.foreground, pair.background));
			expect(ratio, `${pair.name} measured ${ratio}:1`).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
		});
	}

	it('records the pair that motivated the contact-panel inversion', () => {
		// Regression guard: --purple on --purple-dark is the failure this rule
		// caught. If a future palette makes it pass, the override may go.
		expect(roundRatio(contrastRatio(token.purple, token['purple-dark']))).toBeLessThan(NON_TEXT_RATIO);
	});
});

// TIN-3854 introduces a typed palette module. It is not on this branch's base,
// so the suite adapts rather than depending on it: when the module lands, its
// exported hex values must agree with the CSS tokens they mirror.
const palettePath = path.join(repoRoot, 'src/lib/theme/palette.ts');
describe.runIf(existsSync(palettePath))('typed palette module, when present', () => {
	it('agrees with the CSS custom properties it mirrors', () => {
		const source = readFileSync(palettePath, 'utf8');
		const declared = new Map<string, string>();
		for (const match of source.matchAll(/['"]?([A-Za-z][\w-]*)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/gu)) {
			declared.set(match[1].toLowerCase().replace(/_/gu, '-'), match[2].toLowerCase());
		}
		expect(declared.size, 'palette module declares hex colours').toBeGreaterThan(0);
		for (const [name, value] of Object.entries(token)) {
			const mirrored = declared.get(name);
			if (!mirrored) continue;
			expect(mirrored, `--${name} mirrored in palette.ts`).toBe(value.toLowerCase());
		}
	});

	it('keeps every declared palette colour parseable by the contrast maths', () => {
		const source = readFileSync(palettePath, 'utf8');
		for (const match of source.matchAll(/['"](#[0-9a-fA-F]{3,8})['"]/gu)) {
			expect(() => parseCssColor(match[1])).not.toThrow();
		}
	});
});
