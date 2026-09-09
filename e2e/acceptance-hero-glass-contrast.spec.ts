import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { contrastRatio, roundRatio } from '../scripts/lib/color-contrast.mjs';
import type { Rgb } from './support/png-luminance';
import { measureGlassExtremes, resolveRoleRgb, setScheme } from './support/glass-contrast';

// Review round 2, finding B: the unit-test model of `.hero-glass`'s AA
// contract (a hardcoded panel percent composited over synthetic
// black/white extremes) silently diverged from what the browser actually
// painted — first because a hand-written -webkit-backdrop-filter line made
// the frost never render at all (Chromium rejects the bare prefixed
// property), and second because the model kept using the 88% opaque
// fallback even after the translucent 68%/74% became the shipped value.
// Both bugs are fixed now (src/app.css, src/lib/design-token-contrast.
// test.ts), but a hardcoded vitest constant cannot re-derive itself if the
// photo, panel percent, or ink roles drift again — so this spec is the
// actual backstop: it measures the REAL rendered pixels, in a real
// browser, on every run, and never trusts a CSS token in isolation.
//
// Methodology: hide everything inside .hero-glass except its own painted
// background (visibility:hidden on descendants leaves the parent's
// background/backdrop-filter untouched), screenshot just that element, and
// scan the resulting PNG for the darkest/lightest pixel by WCAG relative
// luminance. That is the true composite — blur, saturate, panel tint, and
// whatever the scrim contributes underneath, all already baked in by the
// compositor. No token math re-derives it.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contrastTestSource = readFileSync(path.join(repoRoot, 'src/lib/design-token-contrast.test.ts'), 'utf8');

const AA = 4.5;
const LARGE = 3;
const NON_TEXT = 3;

function ratioAgainst(ink: Rgb, extreme: { rgb: Rgb }): number {
	return roundRatio(contrastRatio(ink, extreme.rgb));
}

test.describe('hero glass — real rendered contrast (review round 2, finding B)', () => {
	test('backdrop-filter actually computes a blur, not none', async ({ page, baseURL }) => {
		// Regression guard for the exact bug: a hand-written
		// -webkit-backdrop-filter line made the build emit ONLY the prefixed
		// property, which modern Chromium ignores outright, so the frost never
		// rendered even though @supports reported true and the translucent
		// fill applied.
		await page.goto(baseURL ?? '/');
		await page.waitForLoadState('networkidle');
		const computed = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-glass')!).backdropFilter);
		expect(computed, 'computed backdrop-filter on .hero-glass').not.toBe('none');
		expect(computed, 'computed backdrop-filter on .hero-glass').toContain('blur');
	});

	for (const scheme of ['light', 'dark'] as const) {
		test(`every hero pair clears its floor against the real rendered glass (${scheme})`, async ({ page, baseURL }) => {
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.goto(baseURL ?? '/');
			await page.waitForLoadState('networkidle');
			await setScheme(page, scheme);

			const heroExtremes = await measureGlassExtremes(page, '.hero-glass');
			const statusCardExtremes = await measureGlassExtremes(page, '.status-card.hero-glass');

			// The worse (less contrasty) of the two regions per extreme — this
			// spec proves the conservative pair across both hero-glass surfaces,
			// not an average.
			const darkest =
				heroExtremes.darkest.luminance < statusCardExtremes.darkest.luminance
					? heroExtremes.darkest
					: statusCardExtremes.darkest;
			const lightest =
				heroExtremes.lightest.luminance > statusCardExtremes.lightest.luminance
					? heroExtremes.lightest
					: statusCardExtremes.lightest;

			const pairs: Array<{ name: string; role: string; minimum: number }> = [
				{ name: 'hero lede', role: '--fg', minimum: AA },
				{ name: 'hero h1', role: '--heading', minimum: LARGE },
				{ name: 'secondary button label', role: '--heading', minimum: AA },
				{ name: 'plain link', role: '--link', minimum: AA },
				{ name: 'status-card copy', role: '--fg', minimum: AA },
				{ name: 'status-card muted copy', role: '--fg-muted', minimum: AA },
				{ name: 'status-card heading', role: '--heading', minimum: LARGE },
				{ name: 'status-card strong', role: '--heading', minimum: AA },
				{ name: 'primary button fill', role: '--accent', minimum: NON_TEXT },
				{ name: 'secondary button border', role: '--accent', minimum: NON_TEXT },
			];

			for (const pair of pairs) {
				const ink = await resolveRoleRgb(page, pair.role);
				const ratioDark = ratioAgainst(ink, darkest);
				const ratioLight = ratioAgainst(ink, lightest);
				const worst = Math.min(ratioDark, ratioLight);
				expect(
					worst,
					`${pair.name} (${scheme}) vs real rendered glass: darkest ${ratioDark}:1, lightest ${ratioLight}:1`,
				).toBeGreaterThanOrEqual(pair.minimum);
			}
		});
	}
});

test.describe('hero ink-span fixture — staleness backstop (review round 2, finding B.3.1)', () => {
	// HERO_MEASURED_INK_SPAN in design-token-contrast.test.ts is a hand-typed
	// constant; nothing in that file can re-derive it from actual layout.
	// This test extracts the SAME constant from the source text and measures
	// live ink position at every breakpoint it lists, failing loudly if
	// reality has drifted past a small tolerance — so a padding/type-scale
	// change that moves ink can no longer pass 158/158 silently the way the
	// review demonstrated against the old, unguarded fixture.
	const fixtureMatch = /const HERO_MEASURED_INK_SPAN: Record<number, \[number, number\]> = \{([\s\S]*?)\n\};/u.exec(
		contrastTestSource,
	);
	if (!fixtureMatch) {
		throw new Error('design-token-contrast.test.ts no longer declares HERO_MEASURED_INK_SPAN this spec can read');
	}
	const fixtureBody = fixtureMatch[1];
	const rows = [...fixtureBody.matchAll(/(\d+):\s*\[([\d.]+),\s*([\d.]+)\]/gu)].map((m) => ({
		width: Number(m[1]),
		start: Number(m[2]),
		end: Number(m[3]),
	}));
	expect(rows.length, 'HERO_MEASURED_INK_SPAN fixture rows parsed').toBeGreaterThan(0);

	const TOLERANCE_PP = 2; // percentage points — headless-vs-headless font hinting slack

	for (const { width, start, end } of rows) {
		test(`ink span fixture at ${width}px matches live measurement within ${TOLERANCE_PP}pp`, async ({
			page,
			baseURL,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(baseURL ?? '/');
			await page.waitForLoadState('networkidle');
			const measured = await page.evaluate(() => {
				const hero = document.querySelector('.hero');
				const glassEls = document.querySelectorAll(
					'.hero-glass h1, .hero-glass p, .hero-glass .button, .hero-glass strong, .status-card.hero-glass *',
				);
				if (!hero) throw new Error('.hero is missing');
				const heroRect = hero.getBoundingClientRect();
				let top = Infinity;
				let bottom = -Infinity;
				glassEls.forEach((el) => {
					const r = el.getBoundingClientRect();
					if (r.width === 0 && r.height === 0) return;
					if (r.top < top) top = r.top;
					if (r.bottom > bottom) bottom = r.bottom;
				});
				return {
					startPct: ((top - heroRect.top) / heroRect.height) * 100,
					endPct: ((bottom - heroRect.top) / heroRect.height) * 100,
				};
			});
			expect(
				measured.startPct,
				`ink start at ${width}px: fixture says ${start}%, measured ${measured.startPct.toFixed(1)}%`,
			).toBeGreaterThanOrEqual(start - TOLERANCE_PP);
			expect(
				measured.startPct,
				`ink start at ${width}px: fixture says ${start}%, measured ${measured.startPct.toFixed(1)}%`,
			).toBeLessThanOrEqual(start + TOLERANCE_PP);
			expect(
				measured.endPct,
				`ink end at ${width}px: fixture says ${end}%, measured ${measured.endPct.toFixed(1)}%`,
			).toBeGreaterThanOrEqual(end - TOLERANCE_PP);
			expect(
				measured.endPct,
				`ink end at ${width}px: fixture says ${end}%, measured ${measured.endPct.toFixed(1)}%`,
			).toBeLessThanOrEqual(end + TOLERANCE_PP);
		});
	}
});
