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

// Resolve the var() graph from src/app.css and src/lib/styles/theme-gftb.css in both
// schemes. Text must meet AA. Filled controls must reach WCAG 1.4.11’s 3:1 against their
// surface. e2e/acceptance-contrast.spec.ts measures the computed styles in a browser.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');
const themeCss = readFileSync(path.join(repoRoot, 'src/lib/styles/theme-gftb.css'), 'utf8');

const SCHEMES = schemes({ appCss, themeCss });
type SchemeName = keyof typeof SCHEMES;
const SCHEME_NAMES = Object.keys(SCHEMES) as SchemeName[];

/**
 * Composite each card over the unwashed --bg. The body gradient darkens the light ground
 * and lightens the top 352px in dark mode. At 12% the wash lifts #28222b to #383042. Inside
 * that band error-300 reaches 4.79 instead of 5.89 and primary-300 reaches 4.93 instead of
 * 6.06. Surface-400 reaches 6.17. The ratio varies with each element’s position.
 */
function surfaces(scheme: SchemeName) {
	const tokens = SCHEMES[scheme];
	const page = resolveRole(tokens, '--bg');
	// The global page roles and borderless row ground remain a separate
	// contract. The new glass containers and their locally inherited roles
	// are swept by heroGrounds() below against arbitrary backdrop extremes.
	const card = page;
	return {
		/** Global page ground, outside the glass containers. */
		page,
		card,
		/** Contact field fill; glass surfaces are modeled separately below. */
		panel: resolveRole(tokens, '--panel'),
		/** the .skip-link chip (and the archived yellow livery band rungs) */
		yellow: resolveRole(tokens, '--highlight'),
		/** the restored inverted contact panel (gen_board.py:170) */
		inversePanel: resolveRole(tokens, '--inverse-panel'),
		/** paper-filled controls sitting on that panel (gen_board.py:176) */
		paper: resolveRole(tokens, '--inverse-fg'),
		/**
		 * The accent thumb rides on the D01 mode switch track.
		 */
		controlTrack: resolveRole(tokens, '--control-track'),
		/** Existing .contribute-panel fallback (92%). Its browser-side
		 * appearance checks remain separate from the shared glass surface. */
		contributePanel: compositeOver(resolveColor(tokens, 'color-mix(in oklab, var(--panel) 92%, transparent)'), page),
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
	{ name: 'headings on the page', role: '--heading', on: 'page', minimum: LARGE },
	{ name: 'headings on a card', role: '--heading', on: 'card', minimum: LARGE },
	{ name: 'status-card strong on a card', role: '--heading', on: 'card', minimum: AA },
	{ name: 'secondary button label on the page', role: '--heading', on: 'page', minimum: AA },
	{ name: 'primary button label on its own fill', role: '--accent-contrast', on: 'accentFill', minimum: AA },
	{ name: 'link on the page', role: '--link', on: 'page', minimum: AA },
	{ name: 'link on a card', role: '--link', on: 'card', minimum: AA },
	{ name: 'skip-link label on its chip', role: '--highlight-contrast', on: 'yellow', minimum: AA },
	// The yellow livery band (gen_board.py:166-168): copy on the ratified
	// contrast token, headings and anchors on --highlight-heading. ARCHIVED
	// for the work sessions .hours-band, which moved onto the shared glass
	// (operator feedback 2026-10-02: no yellow fill, yellow accents only); the
	// rungs stay declared and swept so a future livery starts from proven
	// pairs. The skip-link pair above is still shipped paint.
	{ name: 'copy on the yellow livery band', role: '--highlight-contrast', on: 'yellow', minimum: AA },
	{ name: 'headings and anchors on the yellow livery band', role: '--highlight-heading', on: 'yellow', minimum: AA },
	// ARCHIVED RUNGS, not shipped paint. The 2026-08-31 flattening removed
	// every consumer of the --inverse-* group (see .contact-card in
	// src/app.css); the roles stay declared and stay swept here so a future
	// re-inversion starts from proven rungs rather than re-deriving them.
	// Nothing below this marker describes a surface the site currently
	// paints; the shipped contact surface is the plain-page-ground block
	// further down.
	{ name: 'archived inverse panel copy', role: '--inverse-fg', on: 'inversePanel', minimum: AA },
	{ name: 'archived inverse panel helper text', role: '--inverse-fg-muted', on: 'inversePanel', minimum: AA },
	{ name: 'archived inverse panel link', role: '--inverse-link', on: 'inversePanel', minimum: AA },
	{ name: 'archived inverse panel field error', role: '--inverse-danger', on: 'inversePanel', minimum: AA },
	{ name: 'archived inverse panel eyebrow (--highlight)', role: '--highlight', on: 'inversePanel', minimum: AA },
	{ name: 'archived paper control field text', role: '--inverse-control-fg', on: 'paper', minimum: AA },
	{ name: 'archived paper control accent label', role: '--inverse-control-accent', on: 'paper', minimum: AA },
	{ name: 'archived paper control error ink', role: '--inverse-control-danger', on: 'paper', minimum: AA },
	// Contact fields retain their opaque --panel fill inside the glass form.
	// --fg uses the same palette rung globally and locally.
	{ name: 'contact field text on its --panel fill', role: '--fg', on: 'panel', minimum: AA },
	{ name: 'contact helper text on the page', role: '--fg-muted', on: 'page', minimum: AA },
	// ContributeMenu.svelte (review finding C): the trigger's own label, and
	// the panel's four text roles.
	{ name: 'contribute trigger label on its own fill', role: '--accent-contrast', on: 'accentFill', minimum: AA },
	{ name: 'contribute panel eyebrow', role: '--fg-muted', on: 'contributePanel', minimum: AA },
	{ name: 'contribute panel close button', role: '--fg-muted', on: 'contributePanel', minimum: AA },
	{ name: 'contribute panel item label', role: '--heading', on: 'contributePanel', minimum: AA },
	{ name: 'contribute panel item description', role: '--fg-muted', on: 'contributePanel', minimum: AA },
] as Pair[];

const nonTextPairs: Pair[] = [
	{ name: 'primary button fill on the page', role: '--accent', on: 'page', minimum: NON_TEXT_RATIO },
	{ name: 'primary button fill on a card', role: '--accent', on: 'card', minimum: NON_TEXT_RATIO },
	{ name: 'secondary button border on the page', role: '--accent', on: 'page', minimum: NON_TEXT_RATIO },
	{ name: 'skip-link edge on the page', role: '--highlight-edge', on: 'page', minimum: NON_TEXT_RATIO },
	// The rescue edge supplies the livery band's 1.4.11 boundary. The fill alone fails on the
	// light page.
	{ name: 'yellow livery band edge on the page', role: '--highlight-edge', on: 'page', minimum: NON_TEXT_RATIO },
	// The SHIPPED contact surface since the 2026-08-31 flattening. The field
	// border is the 1.4.11 boundary and it adjoins two grounds: the page
	// outside and the field's own --panel fill inside, so both are swept.
	// The invalid-state border swaps that role for --danger, and the focus
	// ring is pushed clear of the field by outline-offset so it lands on the
	// page (the same pair the skip-link edge row already proves).
	{ name: 'contact field border on the page', role: '--accent', on: 'page', minimum: NON_TEXT_RATIO },
	{ name: 'contact field border on its own fill', role: '--accent', on: 'panel', minimum: NON_TEXT_RATIO },
	{ name: 'invalid contact field border on the page', role: '--danger', on: 'page', minimum: NON_TEXT_RATIO },
	{ name: 'invalid contact field border on its own fill', role: '--danger', on: 'panel', minimum: NON_TEXT_RATIO },
	{ name: 'contact field focus ring on the page', role: '--highlight-edge', on: 'page', minimum: NON_TEXT_RATIO },
	// The surface rows retain the archived panel and paper control pairs. The panel-era focus
	// ring and notice edge reached 7.77:1 in both schemes at gen_board.py:221.
	{ name: 'archived inverse panel border on the page', role: '--inverse-edge', on: 'page', minimum: NON_TEXT_RATIO },
	{
		name: 'archived paper control fill on the panel',
		role: '--inverse-fg',
		on: 'inversePanel',
		minimum: NON_TEXT_RATIO,
	},
	{
		name: 'archived success rung on a paper-filled control',
		role: '--inverse-control-positive',
		on: 'paper',
		minimum: NON_TEXT_RATIO,
	},
	{ name: 'archived panel-era yellow outline', role: '--highlight', on: 'inversePanel', minimum: NON_TEXT_RATIO },
	// The D01 thumb needs 1.4.11 contrast against its track and the page. The primary-fill row
	// covers the page. Dark --control-track uses surface-800 because surface-700 gives only
	// 2.53:1.
	{ name: 'mode switch thumb on its track', role: '--accent', on: 'controlTrack', minimum: NON_TEXT_RATIO },
	// ContributeMenu.svelte uses --rule as a decorative divider. It reaches 1.56:1 in light
	// mode and 2.02:1 in dark mode against the panel. Against the page it reaches 1.41:1 and
	// 2.39:1. The primary button row covers the trigger’s --accent-on-page boundary.
];

/**
 * Read the glow opacity inside `.button:focus-visible` in src/app.css. An earlier
 * decorative glow on `.skip-link` could match a file-wide search. The ratios test the
 * shipped glow. RATIFIED_GLOW_PERCENT also catches opacity changes that still meet both
 * floors.
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
		// Anchor `[data-mode='dark']` at line start with `{` immediately after the selector. A
		// match inside `[data-mode='dark'] pre.shiki` would hide a missing dark override and
		// leave the light role active. scripts/lib/css-tokens.mjs uses the same anchor.
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
	it('flattens the contact panel to plain page ground (operator ruling 2026-08-31)', () => {
		// The role table in gen_board.py:157-180 and decisions/0015 retains --inverse-*. PR #25
		// removed it before addendum B1 restored it on 2026-08-20. The 2026-08-31 borderless
		// ruling removed its painted surfaces. ROLES still covers the declared tokens.
		expect(appCss).toMatch(/--inverse-panel:\s*var\(--color-primary-900\)/u);
		expect(appCss).toMatch(/\.contact-card \{\s*border-radius: 0;\s*\}/u);
		expect(appCss).not.toMatch(/\.contact-card \{[\s\S]*?background: var\(--inverse-panel\);/u);
		expect(appCss).toMatch(/\.contact-form input,[\s\S]*?border: 1px solid var\(--accent\);/u);
		expect(appCss).toMatch(/\.contact-form input,[\s\S]*?background: var\(--panel\);/u);
		expect(appCss).toMatch(/\.contact-form input,[\s\S]*?color: var\(--fg\);/u);
		expect(appCss).not.toMatch(/\.contact-form input,[\s\S]*?background: var\(--inverse-fg\);/u);
	});

	it('keeps the field focus indicator on the page-ground rescue edge, same as the skip-link', () => {
		// The panel’s secondary-300 indicator reached 7.77:1 on primary-900 at gen_board.py:221.
		// Since 2026-08-31 the field sits on the page. Bare yellow fails 3:1 there and needs the
		// same --highlight-edge as the skip-link and mode-switch.
		expect(appCss).toMatch(
			/\.contact-form :is\(input, textarea\):focus-visible \{\s*outline: 2px solid var\(--highlight-edge\);/u,
		);
		expect(appCss).toMatch(/\.skip-link \{[\s\S]*?border: 1px solid var\(--highlight-edge\);/u);
	});

	it('keeps the composited surfaces this file models', () => {
		expect(GLASS_FILL.alpha, 'glass must visibly transmit the backdrop').toBe(0.7);
		// GLOW is whatever app.css declares, so this only proves the glow is still
		// painted on the focus rule the ratio assertions below assume.
		expect(appCss).toMatch(
			/\.button:focus-visible \{\s*box-shadow: 0 0 0 4px color-mix\(in oklab, var\(--highlight\)/u,
		);
		// At 56% the weaker contact-panel ratio peaks. The glow reaches 3.54:1 on the paper
		// button and 3.50:1 on the panel. At 65% the paper ratio falls to 2.95:1. Pin the
		// operating point even when a change still clears both floors.
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
 * The 28 named pairs in gen_board.py:200-230 use the board’s WCAG floors. Run each pair in
 * the schemes the board names.
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
			// against the page. Since the 2026-08-31 flattening the /contact
			// submit button is THIS row: it is an ordinary .button on plain
			// page ground. The next test measures the archived inverse table,
			// which nothing paints.
			const grounds = surfaces(scheme);
			const glow = glowOn(scheme, grounds.page);
			const best = Math.max(
				roundRatio(contrastRatio(glow, resolveRole(SCHEMES[scheme], '--accent'))),
				roundRatio(contrastRatio(glow, grounds.page)),
			);
			expect(best, `page focus glow measured ${best}:1`).toBeGreaterThanOrEqual(NON_TEXT_RATIO);
		});

		it('keeps the archived paper-button glow separating from BOTH inverse edges', () => {
			// The 2026-08-31 flattening removed the /contact paper button and panel from
			// gen_board.py:176-177. Keep the pair that sets the 56% glow. The page-ground test
			// accepts opacities that fail on paper.
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
 * Glass contrast uses the actual declared fill and locally inherited inks.
 * Black and white bound every possible sRGB photo/vector backdrop, including
 * the no-filter and reduced-motion paths. These are analytic bounds, not
 * screenshot measurements. The registered browser test independently samples
 * the real composited pixels and local ink colors.
 */
const HERO_SCRIM_RATIFIED_PERCENT = 0;
// Scope both regexes to `.hero__scrim { ... }`, as for `.button:focus-visible`. A global
// search can match `@media print`, a comment or a `max-width` override and leave a broken
// scrim undetected.
const HERO_SCRIM_RULE_BLOCK = /\.hero__scrim\s*\{([^}]*)\}/u.exec(appCss);
if (!HERO_SCRIM_RULE_BLOCK) {
	throw new Error('src/app.css no longer declares a .hero__scrim rule this gate can anchor to');
}
const HERO_SCRIM_BODY = HERO_SCRIM_RULE_BLOCK[1];
const HERO_SCRIM_RULE =
	/--hero-scrim-content:\s*(color-mix\(in oklab, var\(--bg\) (\d+(?:\.\d+)?)%, transparent\))/u.exec(HERO_SCRIM_BODY);
if (!HERO_SCRIM_RULE) {
	throw new Error('.hero__scrim no longer declares a --hero-scrim-content mix this gate can measure');
}
const HERO_SCRIM_PERCENT = Number(HERO_SCRIM_RULE[2]);

// Ink spans at 320/375/768/1280 follow e2e/acceptance-responsive.spec.ts:14-19.
// Measurements on 2026-09-19 put the pitch list and about statement inside the 6%/94%
// stops. This fixture tests their visual containment.
// e2e/acceptance-hero-glass-contrast.spec.ts measures live ink and detects drift that
// static CSS cannot.
const HERO_MEASURED_INK_SPAN: Record<number, [number, number]> = {
	320: [7.3, 92.7],
	375: [8.3, 91.7],
	768: [13.2, 86.8],
	1280: [18.4, 81.6],
};
const HERO_SCRIM_CONTENT_STOPS_RULE =
	/--hero-scrim-content\)\s*(\d+(?:\.\d+)?)%,\s*var\(--hero-scrim-content\)\s*(\d+(?:\.\d+)?)%/u.exec(HERO_SCRIM_BODY);
if (!HERO_SCRIM_CONTENT_STOPS_RULE) {
	throw new Error('.hero__scrim no longer declares two --hero-scrim-content gradient stops');
}
const HERO_SCRIM_CONTENT_START = Number(HERO_SCRIM_CONTENT_STOPS_RULE[1]);
const HERO_SCRIM_CONTENT_END = Number(HERO_SCRIM_CONTENT_STOPS_RULE[2]);

// Read the exact shared surface rule rather than restating its alpha or
// local aliases. A missing declaration fails before any contrast calculation.
const GLASS_RULE = /^\.hero-glass,\n[\s\S]*?\.site-footer \{([^}]*)\}/mu.exec(appCss)?.[1];
if (!GLASS_RULE) throw new Error('the shared glass surface rule is missing');
const GLASS_FILL_RULE = /background:\s*([^;]+);/u.exec(GLASS_RULE)?.[1];
if (!GLASS_FILL_RULE) throw new Error('the glass surface fill is missing');
const GLASS_ALIASES = Object.fromEntries(
	[...GLASS_RULE.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2]]),
);
const GLASS_TOKENS = {
	light: { ...SCHEMES.light, ...GLASS_ALIASES },
	dark: { ...SCHEMES.dark, ...GLASS_ALIASES },
};
const GLASS_FILL = resolveColor(GLASS_TOKENS.light, GLASS_FILL_RULE);

function heroGrounds(scheme: SchemeName) {
	const tokens = GLASS_TOKENS[scheme];
	const fill = resolveColor(tokens, GLASS_FILL_RULE!);
	return {
		card: (extreme: 'black' | 'white') =>
			compositeOver(fill, parseCssColor(extreme === 'black' ? '#000000' : '#ffffff')),
	};
}

interface HeroPair {
	name: string;
	role: string;
	on: 'card';
	minimum: number;
}

// The hero uses --accent on button fills and borders. Keep --link coverage for the hero
// CTAs.
const heroTextPairs: HeroPair[] = [
	{ name: 'hero lede over the hero', role: '--fg', on: 'card', minimum: AA },
	{ name: 'hero h1 over the hero', role: '--heading', on: 'card', minimum: LARGE },
	{ name: 'secondary button label over the hero', role: '--heading', on: 'card', minimum: AA },
	{ name: 'a plain link over the hero', role: '--link', on: 'card', minimum: AA },
	{ name: 'status-card copy over the hero', role: '--fg', on: 'card', minimum: AA },
	{ name: 'status-card muted copy over the hero', role: '--fg-muted', on: 'card', minimum: AA },
	{ name: 'status-card heading over the hero', role: '--heading', on: 'card', minimum: LARGE },
	{ name: 'status-card strong over the hero', role: '--heading', on: 'card', minimum: AA },
	{ name: 'footer muted copy on glass', role: '--fg-muted', on: 'card', minimum: AA },
	{ name: 'content and footer links on glass', role: '--link', on: 'card', minimum: AA },
	{ name: 'contact error text on glass', role: '--danger', on: 'card', minimum: AA },
];

const heroNonTextPairs: HeroPair[] = [
	{ name: 'primary button fill over the hero', role: '--accent', on: 'card', minimum: NON_TEXT_RATIO },
	{ name: 'secondary button border over the hero', role: '--accent', on: 'card', minimum: NON_TEXT_RATIO },
	{ name: 'glass focus indicator', role: '--highlight-edge', on: 'card', minimum: NON_TEXT_RATIO },
	{ name: 'invalid contact field edge on glass', role: '--danger', on: 'card', minimum: NON_TEXT_RATIO },
];

/**
 * Against pure black, contrastRatio increases with relative luminance. Use it to order the
 * envelope colours.
 */
function luminanceProxy(color: Rgb): number {
	return contrastRatio(color, parseCssColor('#000000'));
}

describe('hero backdrop scrim', () => {
	it(`declares the ratified ${HERO_SCRIM_RATIFIED_PERCENT}% (fully transparent) content-zone mix`, () => {
		// The demo uses 0% opacity. `.hero-glass` in src/app.css clears AA over the backdrop
		// measured by heroGrounds(), so the scrim can stay transparent.
		expect(HERO_SCRIM_PERCENT, `hero scrim content-zone declared at ${HERO_SCRIM_PERCENT}%`).toBe(
			HERO_SCRIM_RATIFIED_PERCENT,
		);
	});

	it('content-zone stops contain the true measured ink span at every acceptance-responsive breakpoint', () => {
		// Read both --hero-scrim-content stops from src/app.css and check that they contain the
		// measured ink at every breakpoint. Text outside that band would render on the heavier
		// edge tint.
		for (const [viewport, [start, end]] of Object.entries(HERO_MEASURED_INK_SPAN)) {
			expect(
				HERO_SCRIM_CONTENT_START,
				`content-zone start stop (${HERO_SCRIM_CONTENT_START}%) must sit at or before the measured ink start at ${viewport}px (${start}%)`,
			).toBeLessThanOrEqual(start);
			expect(
				HERO_SCRIM_CONTENT_END,
				`content-zone end stop (${HERO_SCRIM_CONTENT_END}%) must sit at or after the measured ink end at ${viewport}px (${end}%)`,
			).toBeGreaterThanOrEqual(end);
		}
	});

	for (const scheme of SCHEME_NAMES) {
		it(`keeps filled glass controls and contact field edges readable (${scheme})`, () => {
			const tokens = GLASS_TOKENS[scheme];
			expect(
				contrastRatio(resolveRole(tokens, '--accent-contrast'), resolveRole(tokens, '--accent')),
			).toBeGreaterThanOrEqual(AA);
			for (const role of ['--accent', '--danger']) {
				expect(contrastRatio(resolveRole(tokens, role), resolveRole(tokens, '--panel'))).toBeGreaterThanOrEqual(
					NON_TEXT_RATIO,
				);
			}
		});

		it(`keeps every hero ink outside the scrim's luminance envelope in the ${scheme} scheme`, () => {
			// Ink inside the envelope could match a photo pixel’s composite luminance and bring
			// contrast toward 1:1.
			const grounds = heroGrounds(scheme);
			for (const pair of [...heroTextPairs, ...heroNonTextPairs]) {
				const ink = luminanceProxy(resolveRole(GLASS_TOKENS[scheme], pair.role));
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
				const ink = resolveRole(GLASS_TOKENS[scheme], pair.role);
				for (const extreme of ['black', 'white'] as const) {
					const ratio = roundRatio(contrastRatio(ink, grounds[pair.on](extreme)));
					expect(ratio, `${pair.name} over ${extreme}: calculated ${ratio}:1`).toBeGreaterThanOrEqual(pair.minimum);
				}
			});
		}
	}
});

describe('regression guards', () => {
	it('records the pair that keeps bare yellow off paper-side grounds', () => {
		// --highlight reaches only 1.57:1 on the light card. The skip-link and livery band need
		// --highlight-edge there to meet 1.4.11. Bare yellow reaches 7.77:1 on primary-900. See
		// item 4 at gen_board.py:167.
		const ratio = roundRatio(contrastRatio(resolveRole(SCHEMES.light, '--highlight'), surfaces('light').card));
		expect(ratio, `light: --highlight on the card measured ${ratio}:1`).toBeLessThan(NON_TEXT_RATIO);
	});
});

// The typed palette module mirrors theme-gftb.css. When it is present, its
// documented hexes must be what the CSS oklch values actually paint.
const palettePath = path.join(repoRoot, 'src/lib/theme/palette.ts');

// A missing palette.ts would skip the `runIf` parity checks. Assert that it exists first.
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
