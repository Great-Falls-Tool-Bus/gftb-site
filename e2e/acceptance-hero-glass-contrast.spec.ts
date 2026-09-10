import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { contrastRatio, parseCssColor, roundRatio } from '../scripts/lib/color-contrast.mjs';
import type { Rgb } from './support/png-luminance';
import { measureGlassExtremes, resolveRoleRgb, setScheme } from './support/glass-contrast';

// Real-pixel backstop for the shared translucent surface contract. The unit
// gate bounds arbitrary black/white backdrops with the declared tint and local
// palette inks; this spec verifies the compiled cascade and actual composite.
// Descendant ink is hidden only while each background screenshot is taken.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contrastTestSource = readFileSync(path.join(repoRoot, 'src/lib/design-token-contrast.test.ts'), 'utf8');

const AA = 4.5;
const LARGE = 3;
const NON_TEXT = 3;

function ratioAgainst(ink: Rgb, extreme: { rgb: Rgb }): number {
	return roundRatio(contrastRatio(ink, extreme.rgb));
}

test.describe('glass surfaces: real rendered contrast', () => {
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
		test(`every glass pair clears its floor against the real rendered surfaces (${scheme})`, async ({
			page,
			baseURL,
		}) => {
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.goto(baseURL ?? '/');
			await page.waitForLoadState('networkidle');
			await setScheme(page, scheme);

			const pairs: Array<{ name: string; role: string; minimum: number }> = [
				{ name: 'hero lede', role: '--fg', minimum: AA },
				{ name: 'hero h1', role: '--heading', minimum: LARGE },
				{ name: 'secondary button label', role: '--heading', minimum: AA },
				{ name: 'plain link', role: '--link', minimum: AA },
				{ name: 'status-card copy', role: '--fg', minimum: AA },
				{ name: 'status-card muted copy', role: '--fg-muted', minimum: AA },
				{ name: 'status-card heading', role: '--heading', minimum: LARGE },
				{ name: 'status-card strong', role: '--heading', minimum: AA },
				{ name: 'contact error text', role: '--danger', minimum: AA },
				{ name: 'primary button fill', role: '--accent', minimum: NON_TEXT },
				{ name: 'secondary button border', role: '--accent', minimum: NON_TEXT },
			];

			for (const selector of ['.hero-glass', '.status-card.hero-glass', '#goals .goal-asides', '.site-footer']) {
				const surface = page.locator(selector).first();
				await surface.scrollIntoViewIfNeeded();
				const extremes = await measureGlassExtremes(page, selector);
				for (const pair of pairs) {
					const ink = await resolveRoleRgb(page, pair.role, selector);
					const ratioDark = ratioAgainst(ink, extremes.darkest);
					const ratioLight = ratioAgainst(ink, extremes.lightest);
					expect(
						Math.min(ratioDark, ratioLight),
						`${pair.name} (${scheme}, ${selector}): darkest ${ratioDark}:1, lightest ${ratioLight}:1`,
					).toBeGreaterThanOrEqual(pair.minimum);
				}
			}
			for (const selector of ['.hero-glass', '.status-card.hero-glass', '#goals', '.site-footer']) {
				const fill = await page
					.locator(selector)
					.first()
					.evaluate((el) => getComputedStyle(el).backgroundColor);
				expect(parseCssColor(fill).alpha, `${selector} must transmit 30% of its backdrop`).toBeCloseTo(0.7, 4);
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
