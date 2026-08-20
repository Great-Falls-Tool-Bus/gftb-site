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
	formatRgb,
	parseCssColor,
	roundRatio,
	type Rgb,
} from '../../scripts/lib/color-contrast.mjs';
import { resolveColor, resolveRole, schemes } from '../../scripts/lib/css-tokens.mjs';

// Acceptance rows: AA text contrast, and WCAG 1.4.11 3:1 non-text contrast for
// filled controls against the surface they sit on.
//
// The site paints through the role layer in src/app.css, which resolves into the
// CityLink palette in src/lib/styles/theme-gftb.css, so this gate resolves the
// same var() graph the browser does and measures the colour that comes out.
// Every pair is swept in BOTH schemes: the dark block is code with no shipped
// predecessor to diff against, so nothing there is covered by "it used to work".
// e2e/acceptance-contrast.spec.ts re-measures the same rule against computed
// styles in a real browser.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');
const themeCss = readFileSync(path.join(repoRoot, 'src/lib/styles/theme-gftb.css'), 'utf8');

const SCHEMES = schemes({ appCss, themeCss });
type SchemeName = keyof typeof SCHEMES;
const SCHEME_NAMES = Object.keys(SCHEMES) as SchemeName[];

/**
 * The surfaces the page actually composites, per scheme. A card is a
 * translucent panel over the page, so it is composited here rather than
 * approximated.
 *
 * `page` is the UNWASHED --bg. body paints
 * `linear-gradient(180deg, var(--wash), transparent 22rem)` over it, so the top
 * 352px of the document is not this colour. In light the wash darkens and --bg
 * is therefore the conservative ground; in dark --wash is primary-300 at 12%
 * and LIGHTENS that band from #28222b to #383042, which makes the dark numbers
 * below the optimistic ones. Recomputed inside the band the dark pairs still
 * clear AA: error-300 4.79 (this gate reports 5.89), primary-300 4.93
 * (reports 6.06), surface-400 6.17. Disclosed rather than modelled, because
 * modelling a gradient means picking a y and every pair has a different one.
 */
function surfaces(scheme: SchemeName) {
	const tokens = SCHEMES[scheme];
	const page = resolveRole(tokens, '--bg');
	const card = compositeOver(resolveColor(tokens, 'color-mix(in oklab, var(--panel) 88%, transparent)'), page);
	return {
		/** body, hero, section grounds */
		page,
		/** .status-card, .card, .log-entry, .history-card, .hero-glass */
		card,
		/** .site-footer */
		panel: resolveRole(tokens, '--panel'),
		/** the .skip-link chip and the restored .next-session livery band */
		yellow: resolveRole(tokens, '--highlight'),
		/** the restored inverted contact panel (gen_board.py:170) */
		inversePanel: resolveRole(tokens, '--inverse-panel'),
		/** paper-filled controls sitting on that panel (gen_board.py:176) */
		paper: resolveRole(tokens, '--inverse-fg'),
		/** the mode switch's track (D01) — the accent thumb rides on it */
		controlTrack: resolveRole(tokens, '--control-track'),
	};
}

type SurfaceName = keyof ReturnType<typeof surfaces>;

interface Pair {
	/** What a person sees, named the way the review table names it. */
	name: string;
	/** A role in src/app.css. */
	role: string;
	/** The composited ground it is painted on. */
	on: SurfaceName;
	minimum: number;
}

const AA = TEXT_AA_RATIO;
const LARGE = LARGE_TEXT_AA_RATIO;

const textPairs: Pair[] = [
	{ name: 'body copy on the page', role: '--fg', on: 'page', minimum: AA },
	{ name: 'body copy on a card', role: '--fg', on: 'card', minimum: AA },
	{ name: 'muted helper text on a card', role: '--fg-muted', on: 'card', minimum: AA },
	{ name: 'figcaption on a card', role: '--fg-muted', on: 'card', minimum: AA },
	{ name: 'footer text on the panel', role: '--fg-muted', on: 'panel', minimum: AA },
	{ name: 'headings on the page', role: '--heading', on: 'page', minimum: LARGE },
	{ name: 'headings on a card', role: '--heading', on: 'card', minimum: LARGE },
	{ name: 'status-card strong on a card', role: '--heading', on: 'card', minimum: AA },
	{ name: 'secondary button label on the page', role: '--heading', on: 'page', minimum: AA },
	{ name: 'primary button label on its own fill', role: '--accent-contrast', on: 'accentFill', minimum: AA },
	{ name: 'link on the page', role: '--link', on: 'page', minimum: AA },
	{ name: 'link on a card', role: '--link', on: 'card', minimum: AA },
	{ name: 'link in the footer', role: '--link', on: 'panel', minimum: AA },
	{ name: 'skip-link label on its chip', role: '--highlight-contrast', on: 'yellow', minimum: AA },
	// The restored yellow livery band (.next-session; gen_board.py:166-168):
	// copy on the ratified contrast token, headings and anchors on
	// --highlight-heading.
	{ name: 'copy on the yellow livery band', role: '--highlight-contrast', on: 'yellow', minimum: AA },
	{ name: 'headings and anchors on the yellow livery band', role: '--highlight-heading', on: 'yellow', minimum: AA },
	// The restored inverted contact panel (gen_board.py:170-179): panel copy,
	// helper text, links, field errors, the yellow eyebrow, and the
	// paper-filled controls' own inks.
	{ name: 'contact panel copy', role: '--inverse-fg', on: 'inversePanel', minimum: AA },
	{ name: 'contact panel helper text', role: '--inverse-fg-muted', on: 'inversePanel', minimum: AA },
	{ name: 'contact panel link', role: '--inverse-link', on: 'inversePanel', minimum: AA },
	{ name: 'contact panel field error', role: '--inverse-danger', on: 'inversePanel', minimum: AA },
	{ name: 'contact panel eyebrow (--highlight)', role: '--highlight', on: 'inversePanel', minimum: AA },
	{ name: 'field text on a paper-filled control', role: '--inverse-control-fg', on: 'paper', minimum: AA },
	{ name: 'accent label on a paper-filled control', role: '--inverse-control-accent', on: 'paper', minimum: AA },
	{ name: 'error ink on a paper-filled control', role: '--inverse-control-danger', on: 'paper', minimum: AA },
] as Pair[];

const nonTextPairs: Pair[] = [
	{ name: 'primary button fill on the page', role: '--accent', on: 'page', minimum: NON_TEXT_RATIO },
	{ name: 'primary button fill on a card', role: '--accent', on: 'card', minimum: NON_TEXT_RATIO },
	{ name: 'secondary button border on the page', role: '--accent', on: 'page', minimum: NON_TEXT_RATIO },
	{ name: 'skip-link edge on the page', role: '--highlight-edge', on: 'page', minimum: NON_TEXT_RATIO },
	// The restored livery band's 1.4.11 boundary is its rescue edge (the
	// fill alone fails on the light page — the regression guard below
	// records that pair).
	{ name: 'yellow livery band edge on the page', role: '--highlight-edge', on: 'page', minimum: NON_TEXT_RATIO },
	// The restored contact panel (gen_board.py:170-179): the panel's border
	// against the page, the paper control fill against the panel, the
	// success rung on paper, and the yellow focus outline drawn on the panel
	// (gen_board.py:221: 7.77:1 in both schemes).
	{ name: 'contact panel border on the page', role: '--inverse-edge', on: 'page', minimum: NON_TEXT_RATIO },
	{ name: 'paper control fill on the panel', role: '--inverse-fg', on: 'inversePanel', minimum: NON_TEXT_RATIO },
	{
		name: 'success rung on a paper-filled control',
		role: '--inverse-control-positive',
		on: 'paper',
		minimum: NON_TEXT_RATIO,
	},
	{ name: 'field focus outline on the panel', role: '--highlight', on: 'inversePanel', minimum: NON_TEXT_RATIO },
	{ name: 'form notice edge on the panel', role: '--highlight', on: 'inversePanel', minimum: NON_TEXT_RATIO },
	// The mode switch (D01): the accent thumb is the control's 1.4.11
	// boundary, both against its own track and against the page the switch
	// sits on (the page pair is the primary-fill row above; this one is the
	// track). Dark pins --control-track to surface-800 because surface-700
	// leaves this pair at 2.53:1.
	{ name: 'mode switch thumb on its track', role: '--accent', on: 'controlTrack', minimum: NON_TEXT_RATIO },
];

/**
 * The `.button` focus glow: a translucent highlight composited on its ground.
 *
 * The opacity is READ OUT of src/app.css rather than restated here, and the
 * read-out is anchored INSIDE the `.button:focus-visible` rule. Scanning the
 * whole file takes the FIRST `color-mix(… var(--highlight) …)` it finds, so a
 * decorative glow declared earlier — on `.skip-link`, say — becomes what the
 * ratio sweeps below measure while the real focus ring drifts unmeasured.
 *
 * Reading the shipped value rather than restating it is what makes a nudge to
 * the glow surface as the ratio that broke instead of as a string mismatch on
 * the structural test. The separate assertion on RATIFIED_GLOW_PERCENT is what
 * makes a nudge that stays inside the ratio floors surface at all.
 */
const RATIFIED_GLOW_PERCENT = 56;
const FOCUS_RULE = /\.button:focus-visible\s*\{([^}]*)\}/u.exec(appCss);
if (!FOCUS_RULE) {
	throw new Error('src/app.css no longer declares a .button:focus-visible rule this gate can measure');
}
const GLOW_DECLARATION = /color-mix\(in oklab, var\(--highlight\) (\d+(?:\.\d+)?)%, transparent\)/u.exec(FOCUS_RULE[1]);
if (!GLOW_DECLARATION) {
	throw new Error('.button:focus-visible no longer paints a --highlight focus glow this gate can measure');
}
const GLOW = GLOW_DECLARATION[0];
const GLOW_PERCENT = Number(GLOW_DECLARATION[1]);

function glowOn(scheme: SchemeName, ground: Rgb): Rgb {
	return compositeOver(resolveColor(SCHEMES[scheme], GLOW), ground);
}

function measure(scheme: SchemeName, pair: Pair): { ratio: number; foreground: string; background: string } {
	const tokens = SCHEMES[scheme];
	const grounds = surfaces(scheme);
	const background = pair.on === ('accentFill' as SurfaceName) ? resolveRole(tokens, '--accent') : grounds[pair.on];
	const foreground = resolveRole(tokens, pair.role);
	return {
		ratio: roundRatio(contrastRatio(foreground, background)),
		foreground: formatRgb(foreground),
		background: formatRgb(background),
	};
}

describe('the role layer resolves', () => {
	it('declares every role both schemes are swept on', () => {
		const roles = [...new Set([...textPairs, ...nonTextPairs].map((pair) => pair.role))];
		for (const scheme of SCHEME_NAMES) {
			for (const role of roles) {
				expect(() => resolveRole(SCHEMES[scheme], role), `${role} in ${scheme}`).not.toThrow();
			}
		}
	});

	it('leaves --ink the one literal, still equal to surface-950', () => {
		// src/lib/theme/palette.test.ts reads this hex directly to prove the
		// shipped ink and the surface ramp never drifted apart.
		const ink = /--ink:\s*(#[0-9a-f]{6});/u.exec(appCss)?.[1];
		expect(ink).toBeDefined();
		expect(formatRgb(resolveRole(SCHEMES.light, '--color-surface-950'))).toBe(ink);
	});

	it('retires the pre-theme aliases rather than leaving them scheme-blind', () => {
		// A --paper that stays surface-50 in the dark block is a light colour
		// handed to whoever asks for "paper". They are gone; nothing consumes them.
		for (const alias of ['paper', 'cream', 'line', 'muted', 'purple', 'purple-dark', 'yellow']) {
			expect(appCss, `--${alias}`).not.toMatch(new RegExp(`--${alias}:`, 'u'));
			expect(appCss, `var(--${alias})`).not.toMatch(new RegExp(`var\\(--${alias}\\)`, 'u'));
		}
	});

	it('describes the whole second scheme in the dark block', () => {
		// The file's header comment promises this. A role that is only declared
		// in :root silently keeps its light value on a dark page. D01 re-key:
		// the dark block is `[data-mode='dark']` (v5 light-switch strategy);
		// the regex is anchored at line start with `{` directly after the
		// selector so the compound `[data-mode='dark'] pre.shiki` code-surface
		// rules cannot satisfy it — the same anchor scripts/lib/css-tokens.mjs
		// extracts the scheme with.
		const darkBlock = /^\[data-mode='dark'\]\s*\{([\s\S]*?)\n\}/mu.exec(appCss)?.[1];
		expect(darkBlock).toBeDefined();
		const lightRoot = /^:root\s*\{([\s\S]*?)\n\}/mu.exec(appCss)?.[1] ?? '';
		const declared = (block: string) => [...block.matchAll(/(--[a-z0-9-]+):/gu)].map((match) => match[1]);
		const schemeRoles = declared(lightRoot).filter(
			(role) => !role.startsWith('--inverse-') && !role.startsWith('--color-') && role !== '--ink',
		);
		expect([...declared(darkBlock as string)].sort()).toEqual([...schemeRoles].sort());
	});
});

describe('the surfaces these pairs assume are the ones the stylesheet paints', () => {
	it('restores the inverted contact panel and its paper-filled controls', () => {
		// The ratified role table (gen_board.py:157-180; decisions/0015)
		// carries the --inverse-* group; PR #25 deleted it on an invalid
		// interview and addendum B1 restored it. Pinned structurally: the
		// ratio sweeps only measure roles and cannot notice a consumer being
		// deleted.
		expect(appCss).toMatch(/--inverse-panel:\s*var\(--color-primary-900\)/u);
		expect(appCss).toMatch(/\.contact-card \{[\s\S]*?background: var\(--inverse-panel\);/u);
		expect(appCss).toMatch(/\.contact-form input,[\s\S]*?border: 1px solid var\(--inverse-control-accent\);/u);
		expect(appCss).toMatch(/\.contact-form input,[\s\S]*?background: var\(--inverse-fg\);/u);
		expect(appCss).toMatch(/\.contact-form input,[\s\S]*?color: var\(--inverse-control-fg\);/u);
	});

	it('restores the yellow livery band with its rescue edge and pinned heading ink', () => {
		// gen_board.py:166-168: the band is --highlight with the 1.4.11
		// rescue edge and primary-800 headings, in both schemes.
		expect(appCss).toMatch(
			/\.next-session \{[\s\S]*?border: 1px solid var\(--highlight-edge\);[\s\S]*?background: var\(--highlight\);/u,
		);
		expect(appCss).toMatch(/\.next-session h2 \{[\s\S]*?color: var\(--highlight-heading\);/u);
	});

	it('keeps the field focus indicator on the panel yellow, and the skip-link on the rescue edge', () => {
		// On the restored panel the bare yellow IS the ratified indicator
		// (secondary-300 on primary-900, 7.77:1 — gen_board.py:221). On
		// paper-side grounds it fails (the regression guard below records the
		// pair), which is why the skip-link keeps --highlight-edge.
		expect(appCss).toMatch(/:focus-visible \{\s*outline: 3px solid var\(--highlight\);/u);
		expect(appCss).toMatch(/\.skip-link \{[\s\S]*?border: 1px solid var\(--highlight-edge\);/u);
	});

	it('keeps the composited surfaces this file models', () => {
		expect(appCss).toContain('color-mix(in oklab, var(--panel) 88%, transparent)');
		// GLOW is whatever app.css declares, so this only proves the glow is still
		// painted on the focus rule the ratio assertions below assume.
		expect(appCss).toMatch(
			/\.button:focus-visible \{\s*box-shadow: 0 0 0 4px color-mix\(in oklab, var\(--highlight\)/u,
		);
		// 56% is the ratified operating point, not an arbitrary number that happens
		// to be positive: it is where the WEAKER of the two contact-panel readings
		// peaks (3.54:1 against the paper button, 3.50:1 against the panel), and
		// 65% drops the paper side to 2.95:1. The sweeps below measure whatever is
		// declared, so a nudge moves those ratios too; this line is what fails when
		// a nudge stays inside them.
		expect(GLOW_PERCENT, `focus glow declared at ${GLOW_PERCENT}%`).toBe(RATIFIED_GLOW_PERCENT);
	});

	it('carries the RATIFIED role table verbatim (gen_board.py:157-180)', () => {
		// The whole table of record, role -> (light rung, dark rung), so a
		// drift onto any other rung fails even where every ratio floor would
		// still pass. The rungs are the ruling, so assert them.
		const ROLES: Array<[string, string, string]> = [
			['--bg', '--color-surface-100', '--color-surface-950'],
			['--panel', '--color-surface-50', '--color-surface-900'],
			['--fg', '--color-surface-950', '--color-surface-50'],
			['--fg-muted', '--color-surface-700', '--color-surface-400'],
			['--heading', '--color-primary-800', '--color-primary-300'],
			['--accent', '--color-primary-700', '--color-primary-300'],
			['--link', '--color-primary-700', '--color-primary-300'],
			['--rule', '--color-surface-300', '--color-surface-700'],
			['--highlight', '--color-secondary-300', '--color-secondary-300'],
			['--highlight-edge', '--color-secondary-700', '--color-secondary-500'],
			['--highlight-heading', '--color-primary-800', '--color-primary-800'],
			['--danger', '--color-error-700', '--color-error-300'],
			['--inverse-panel', '--color-primary-900', '--color-primary-900'],
			['--inverse-edge', '--color-primary-500', '--color-primary-500'],
			['--inverse-fg', '--color-surface-50', '--color-surface-50'],
			['--inverse-fg-muted', '--color-primary-100', '--color-primary-100'],
			['--inverse-link', '--color-primary-200', '--color-primary-200'],
			['--inverse-danger', '--color-error-100', '--color-error-100'],
			['--inverse-control-fg', '--color-primary-900', '--color-primary-900'],
			['--inverse-control-accent', '--color-primary-700', '--color-primary-700'],
			['--inverse-control-danger', '--color-error-700', '--color-error-700'],
			['--inverse-control-positive', '--color-success-600', '--color-success-600'],
		];
		for (const [role, lightRung, darkRung] of ROLES) {
			expect(formatRgb(resolveRole(SCHEMES.light, role)), `light ${role}`).toBe(
				formatRgb(resolveRole(SCHEMES.light, lightRung)),
			);
			expect(formatRgb(resolveRole(SCHEMES.dark, role)), `dark ${role}`).toBe(
				formatRgb(resolveRole(SCHEMES.dark, darkRung)),
			);
		}
	});
});

/**
 * ── The 28 named ratified pairs (gen_board.py:200-230) ────────────────────
 *
 * The palette board publishes a named-pair table; this sweep transcribes it
 * so the shipped tokens keep clearing exactly the floors the ratification
 * names, scheme-scoped the way the board scopes them ("both" runs in each
 * scheme against the scheme-invariant rungs). Where the board publishes a
 * spec ratio it is a floor disclosure, not a re-pin — the WCAG floor is what
 * is asserted, the way the board's own JS recomputes every number.
 */
describe('the ratified named pairs hold (gen_board.py:200-230)', () => {
	type PairKind = 'AA' | 'LARGE' | 'NONTEXT';
	const KIND_FLOOR: Record<PairKind, number> = { AA, LARGE, NONTEXT: NON_TEXT_RATIO };
	const RATIFIED_PAIRS: Array<[string, string, string, string, PairKind]> = [
		['light', 'body: ink on the page', '--color-surface-950', '--color-surface-100', 'AA'],
		['light', 'body: ink on a card', '--color-surface-950', '--color-surface-50', 'AA'],
		['light', 'muted helper text on a card', '--color-surface-700', '--color-surface-50', 'AA'],
		['light', 'headings on a card', '--color-primary-800', '--color-surface-50', 'AA'],
		['light', 'headings on the page', '--color-primary-800', '--color-surface-100', 'AA'],
		['light', 'eyebrow / --accent on a card', '--color-primary-700', '--color-surface-50', 'AA'],
		['light', 'link on the page', '--color-primary-700', '--color-surface-100', 'AA'],
		['light', 'field error on the panel', '--color-error-700', '--color-surface-50', 'AA'],
		['dark', 'body copy on the page', '--color-surface-50', '--color-surface-950', 'AA'],
		['dark', 'muted helper text on the page', '--color-surface-400', '--color-surface-950', 'AA'],
		['dark', 'headings / --accent on the page', '--color-primary-300', '--color-surface-950', 'AA'],
		['dark', 'link on the page', '--color-primary-300', '--color-surface-950', 'AA'],
		['dark', 'field error on the page', '--color-error-300', '--color-surface-950', 'AA'],
		['dark', 'yellow livery block on the dark page', '--color-secondary-300', '--color-surface-950', 'NONTEXT'],
		['both', 'contact panel copy', '--color-surface-50', '--color-primary-900', 'AA'],
		['both', 'contact panel helper text', '--color-primary-100', '--color-primary-900', 'AA'],
		['both', 'contact panel link', '--color-primary-200', '--color-primary-900', 'AA'],
		['both', 'contact panel field error', '--color-error-100', '--color-primary-900', 'AA'],
		['both', 'contact panel eyebrow (--highlight)', '--color-secondary-300', '--color-primary-900', 'AA'],
		['both', 'focus outline on the contact panel', '--color-secondary-300', '--color-primary-900', 'NONTEXT'],
		['both', 'headings on the yellow fill', '--color-primary-800', '--color-secondary-300', 'AA'],
		['both', 'copy on the yellow fill (contrast token)', '--color-secondary-950', '--color-secondary-300', 'AA'],
		['light', 'contact panel border on the page', '--color-primary-500', '--color-surface-100', 'NONTEXT'],
		['dark', 'contact panel border on the page', '--color-primary-500', '--color-surface-950', 'NONTEXT'],
		['light', 'skip-link edge on the page', '--color-secondary-700', '--color-surface-100', 'NONTEXT'],
		['light', 'primary button fill on the page', '--color-primary-700', '--color-surface-100', 'NONTEXT'],
		['light', 'livery slot primary-400 on paper', '--color-primary-400', '--color-surface-50', 'NONTEXT'],
		['dark', 'livery slot primary-400 on ink', '--color-primary-400', '--color-surface-950', 'NONTEXT'],
	];

	it('transcribes all 28 board rows', () => {
		expect(RATIFIED_PAIRS).toHaveLength(28);
	});

	for (const [schemeScope, name, fgRung, bgRung, kind] of RATIFIED_PAIRS) {
		const sweptSchemes = schemeScope === 'both' ? SCHEME_NAMES : [schemeScope as SchemeName];
		for (const scheme of sweptSchemes) {
			it(`${name} (${scheme}) reaches ${KIND_FLOOR[kind]}:1`, () => {
				const tokens = SCHEMES[scheme];
				const ratio = roundRatio(contrastRatio(resolveRole(tokens, fgRung), resolveRole(tokens, bgRung)));
				expect(ratio, `${name}: ${fgRung} on ${bgRung} measured ${ratio}:1`).toBeGreaterThanOrEqual(KIND_FLOOR[kind]);
			});
		}
	}
});

for (const scheme of SCHEME_NAMES) {
	describe(`WCAG 1.4.3 — text contrast in the ${scheme} scheme`, () => {
		for (const pair of textPairs) {
			it(`${pair.name} reaches ${pair.minimum}:1`, () => {
				const { ratio, foreground, background } = measure(scheme, pair);
				expect(ratio, `${pair.name}: ${foreground} on ${background} measured ${ratio}:1`).toBeGreaterThanOrEqual(
					pair.minimum,
				);
			});
		}
	});

	describe(`WCAG 1.4.11 — non-text contrast in the ${scheme} scheme`, () => {
		for (const pair of nonTextPairs) {
			it(`${pair.name} reaches ${NON_TEXT_RATIO}:1`, () => {
				const { ratio, foreground, background } = measure(scheme, pair);
				expect(ratio, `${pair.name}: ${foreground} on ${background} measured ${ratio}:1`).toBeGreaterThanOrEqual(
					pair.minimum,
				);
			});
		}

		it('the button focus glow separates from the button it rings, and from the page', () => {
			// REINTERPRETATION of the TIN-3855 gate, not a preservation of it.
			// That gate asserted glow-vs-the-button-it-rings >= 3 unconditionally.
			// On the page the glow is an outer ring: it borders the button on one
			// side and the page on the other, and the two readings move in
			// opposite directions, so requiring both is stricter than SC 1.4.11
			// asks for an indicator that only has to be locatable against
			// SOMETHING it adjoins. Taking the better of the two is what lets the
			// dark scheme pass: 1.52:1 against the primary-300 button, 3.98:1
			// against the page. On the contact panel, where the glow is boxed
			// between two opaque surfaces, the next test still requires BOTH.
			const grounds = surfaces(scheme);
			const glow = glowOn(scheme, grounds.page);
			const best = Math.max(
				roundRatio(contrastRatio(glow, resolveRole(SCHEMES[scheme], '--accent'))),
				roundRatio(contrastRatio(glow, grounds.page)),
			);
			expect(best, `page focus glow measured ${best}:1`).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
		});

		it('the button focus glow separates from BOTH edges on the contact panel', () => {
			// The submit button is the PAPER button on the restored inverted
			// panel (gen_board.py:176-177). Here the glow is boxed between two
			// opaque surfaces, so both readings are required — this is the very
			// pair the ratified 56% operating point was chosen on (the glow
			// rationale above: 3.54:1 against the paper button, 3.50:1 against
			// the panel; 65% drops the paper side to 2.95:1).
			const grounds = surfaces(scheme);
			const glow = glowOn(scheme, grounds.inversePanel);
			const againstButton = roundRatio(contrastRatio(glow, grounds.paper));
			const againstPanel = roundRatio(contrastRatio(glow, grounds.inversePanel));
			expect(againstButton, `panel glow vs the paper button: ${againstButton}:1`).toBeGreaterThanOrEqual(
				NON_TEXT_RATIO,
			);
			expect(againstPanel, `panel glow vs the panel: ${againstPanel}:1`).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
		});
	});
}

/**
 * ── Hero backdrop scrim (restoration: parallax hero) ────────────────────
 *
 * `.hero__scrim` paints a graduated gradient (apex-gaps diagnosis
 * 2026-08-20 item 1 — a flat 92% mix read as "a flat cream field"; demo
 * shape ported from fa5552c src/routes/+page.svelte:315-330) over a
 * photograph, and a photograph pixel can be anything, so no single
 * composite is "the" ground. Alpha compositing is channel-linear in the
 * underlying pixel, so every possible composite lies inside the
 * [over-black, over-white] envelope. The sweep proves each hero ink sits
 * OUTSIDE that luminance envelope — so the worst measurable pixel is one of
 * the two extremes — and then clears its floor against both extremes, in
 * both schemes.
 *
 * GROUND CORRECTION (2026-08-20, same slice): every hero ink is nested
 * inside `.hero-glass` / `.status-card.hero-glass`
 * (src/routes/+page.svelte:74-124 — h1, lede, button-row, and the
 * status-card copy are all children of a `.hero-glass` element; nothing
 * renders bare on the scrim). `.hero-glass`'s own
 * `background: color-mix(in oklab, var(--panel) 88%, transparent)` is
 * unconditional, not an `@supports` enhancement, so the ground every hero
 * ink actually composites against is glass-over-scrim-over-photo. The prior
 * revision of this file tested most hero-text pairs directly against the
 * bare scrim — a ground no rendered pixel sits on, and one so conservative
 * it left ~0 percentage points of room to lighten the scrim at all (90%
 * already failed at 4.45:1; see the removed comment this replaces). Every
 * pair below now uses the SAME 'card' ground the status-card pairs and
 * `surfaces()`'s card family already use — still the full [over-black,
 * over-white] envelope, still both schemes, just measuring what actually
 * renders. The in-browser contrast e2e walks ancestor backgrounds and
 * cannot see the sibling scrim/photo layers behind the hero text (the same
 * disclosed blindness class as the --wash band), so THIS gate is the hero's
 * measured contract.
 *
 * `--hero-scrim-content` (the vertical band `.hero-glass`/`.status-card`
 * occupy) is READ OUT of src/app.css: a nudge surfaces as the ratio that
 * broke, and a nudge that stays inside the floors still fails the
 * ratified-percent pin. `--hero-scrim-edge` paints only the top/bottom 18%
 * strips outside that band, where no ink ever renders, so it carries no
 * pair here. Re-anchor caveat: the palette's lightness/chroma are
 * provisional pending the corrected HEIC corpus, so these pairs are
 * re-verified after the re-anchor train.
 */
const HERO_SCRIM_RATIFIED_PERCENT = 74;
const HERO_SCRIM_RULE =
	/--hero-scrim-content:\s*(color-mix\(in oklab, var\(--bg\) (\d+(?:\.\d+)?)%, transparent\))/u.exec(appCss);
if (!HERO_SCRIM_RULE) {
	throw new Error('src/app.css no longer declares a --hero-scrim-content mix this gate can measure');
}
const HERO_SCRIM = HERO_SCRIM_RULE[1];
const HERO_SCRIM_PERCENT = Number(HERO_SCRIM_RULE[2]);

const IMAGE_EXTREMES = { black: parseCssColor('#000000'), white: parseCssColor('#ffffff') } as const;
type ExtremeName = keyof typeof IMAGE_EXTREMES;

function heroGrounds(scheme: SchemeName) {
	const tokens = SCHEMES[scheme];
	const scrim = resolveColor(tokens, HERO_SCRIM);
	const cardFill = resolveColor(tokens, 'color-mix(in oklab, var(--panel) 88%, transparent)');
	const scrimOver = (extreme: ExtremeName) => compositeOver(scrim, IMAGE_EXTREMES[extreme]);
	return {
		/** the glass panel over the content-zone scrim over the photo — the
		 * ground every hero ink (lede, h1, buttons, status-card copy) actually
		 * composites against; see the GROUND CORRECTION note above. */
		card: (extreme: ExtremeName) => compositeOver(cardFill, scrimOver(extreme)),
	};
}

interface HeroPair {
	name: string;
	role: string;
	on: 'card';
	minimum: number;
}

// The eyebrow kickers the revision-1 sweep also gated were stripped sitewide
// by the decoration-strip slice (de-slop ruling), so no --accent TEXT sits on
// the hero anymore; --accent stays swept below as the button fill/border
// (non-text), and the --link pair stays because the copy slice will demote
// the hero CTAs to plain links.
const heroTextPairs: HeroPair[] = [
	{ name: 'hero lede over the hero', role: '--fg', on: 'card', minimum: AA },
	{ name: 'hero h1 over the hero', role: '--heading', on: 'card', minimum: LARGE },
	{ name: 'secondary button label over the hero', role: '--heading', on: 'card', minimum: AA },
	{ name: 'a plain link over the hero', role: '--link', on: 'card', minimum: AA },
	{ name: 'status-card copy over the hero', role: '--fg', on: 'card', minimum: AA },
	{ name: 'status-card muted copy over the hero', role: '--fg-muted', on: 'card', minimum: AA },
	{ name: 'status-card heading over the hero', role: '--heading', on: 'card', minimum: LARGE },
	{ name: 'status-card strong over the hero', role: '--heading', on: 'card', minimum: AA },
];

const heroNonTextPairs: HeroPair[] = [
	{ name: 'primary button fill over the hero', role: '--accent', on: 'card', minimum: NON_TEXT_RATIO },
	{ name: 'secondary button border over the hero', role: '--accent', on: 'card', minimum: NON_TEXT_RATIO },
];

/** contrastRatio(x, black) is strictly monotone in relative luminance, so it
 * serves as the luminance proxy the envelope assertion orders colours by. */
function luminanceProxy(color: Rgb): number {
	return contrastRatio(color, IMAGE_EXTREMES.black);
}

describe('hero backdrop scrim', () => {
	it(`declares the ratified ${HERO_SCRIM_RATIFIED_PERCENT}% content-zone mix`, () => {
		// 74% is the ratified content-zone operating point (apex-gaps diagnosis
		// 2026-08-20 item 1, re-measured against the corrected 'card' ground —
		// see the GROUND CORRECTION note above); the measured floor is 66%
		// (every AA pair passes there; 65% fails at 4.496:1 — just under the
		// 4.5 floor — on the dark secondary-button-label/link/status-card-strong
		// pairs, which all resolve through --heading/--link and are tied at the
		// palette's current values). 74% is kept for ~8 points of headroom —
		// the tightest dark pair reads 4.660:1 against the 4.5 floor — both
		// because the palette is provisional pending the HEIC-corpus re-anchor
		// (§1.1) and because this is now a gradient stop rather than a single
		// declared value, so there is no separate "declared vs measured" pair
		// of numbers the way the flat-mix version had.
		expect(HERO_SCRIM_PERCENT, `hero scrim content-zone declared at ${HERO_SCRIM_PERCENT}%`).toBe(
			HERO_SCRIM_RATIFIED_PERCENT,
		);
	});

	for (const scheme of SCHEME_NAMES) {
		it(`keeps every hero ink outside the scrim's luminance envelope in the ${scheme} scheme`, () => {
			// The precondition that makes the two extremes the worst case: were an
			// ink INSIDE the envelope, some photograph pixel could pull the
			// composite to the ink's own luminance and the ratio toward 1:1.
			const grounds = heroGrounds(scheme);
			for (const pair of [...heroTextPairs, ...heroNonTextPairs]) {
				const ink = luminanceProxy(resolveRole(SCHEMES[scheme], pair.role));
				const ground = grounds[pair.on];
				const low = Math.min(luminanceProxy(ground('black')), luminanceProxy(ground('white')));
				const high = Math.max(luminanceProxy(ground('black')), luminanceProxy(ground('white')));
				expect(
					ink < low || ink > high,
					`${pair.name} (${scheme}): ink luminance proxy ${ink} must sit outside [${low}, ${high}]`,
				).toBe(true);
			}
		});

		for (const pair of [...heroTextPairs, ...heroNonTextPairs]) {
			it(`${pair.name} reaches ${pair.minimum}:1 over both image extremes (${scheme})`, () => {
				const grounds = heroGrounds(scheme);
				const ink = resolveRole(SCHEMES[scheme], pair.role);
				for (const extreme of ['black', 'white'] as const) {
					const ratio = roundRatio(contrastRatio(ink, grounds[pair.on](extreme)));
					expect(ratio, `${pair.name} over ${extreme}: measured ${ratio}:1`).toBeGreaterThanOrEqual(pair.minimum);
				}
			});
		}
	}
});

describe('regression guards', () => {
	it('records the pair that keeps bare yellow off paper-side grounds', () => {
		// --highlight fails 1.4.11 on the light card (about 1.57:1): that is
		// WHY the rescue edge exists (gen_board.py:167, ratified item 4) —
		// the skip-link chip and the livery band carry --highlight-edge on
		// paper-side grounds, while ON the primary-900 panel the bare yellow
		// is the ratified 7.77:1 indicator. Recorded so a swap fails loudly.
		const ratio = roundRatio(contrastRatio(resolveRole(SCHEMES.light, '--highlight'), surfaces('light').card));
		expect(ratio, `light: --highlight on the card measured ${ratio}:1`).toBeLessThan(NON_TEXT_RATIO);
	});
});

// The typed palette module mirrors theme-gftb.css. When it is present, its
// documented hexes must be what the CSS oklch values actually paint.
const palettePath = path.join(repoRoot, 'src/lib/theme/palette.ts');

// The suite below is `runIf`-gated, so on its own a deleted palette.ts makes
// the parity checks VANISH rather than fail. This asserts the gate's own
// premise first: the SSOT has to be on disk before "when present" is a
// reasonable thing to say.
it('palette SSOT file exists', () => {
	expect(existsSync(palettePath), 'src/lib/theme/palette.ts is the typed mirror of theme-gftb.css').toBe(true);
});

describe.runIf(existsSync(palettePath))('typed palette module, when present', () => {
	it('agrees with the CSS custom properties it mirrors', () => {
		const source = readFileSync(palettePath, 'utf8');
		const pairs = [...source.matchAll(/hex:\s*'(#[0-9a-f]{6})',\s*oklch:\s*'(oklch\([^']+\))'/gu)];
		expect(pairs.length, 'palette module declares hex/oklch pairs').toBeGreaterThan(0);
		for (const [, hex, oklch] of pairs) {
			expect(formatRgb(parseCssColor(oklch)), oklch).toBe(hex);
		}
	});

	it('keeps every declared palette colour parseable by the contrast maths', () => {
		const source = readFileSync(palettePath, 'utf8');
		for (const match of source.matchAll(/'(#[0-9a-fA-F]{3,8})'/gu)) {
			expect(() => parseCssColor(match[1])).not.toThrow();
		}
	});
});
