import { expect, test, type Page } from '@playwright/test';

import { contrastRatio, roundRatio } from '../scripts/lib/color-contrast.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureGlassExtremes, resolveRoleRgb, setScheme } from './support/glass-contrast';

// The same generated map SourceLink and NotesAndGoals read (a JSON import
// needs an import attribute under Playwright's loader; read it directly).
const sourceMap = JSON.parse(
	readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/generated/source-map.json'), 'utf8'),
) as { repoUrl: string; branch: string };

import { publishedGoalEntries } from '../src/lib/generated/goals-manifest';
import { memberBenefits, publicGoals, publicHelpAsks } from '../src/lib/public-goals';
import { coversPane, deriveGeometry, halfSweepDeg } from '../src/lib/wiper/geometry';
import { WIPER_DETENTS, wiperDetent } from '../src/lib/wiper/schedule';

// Operator ruling 2026-08-31: the home page's goals, help asks, and member
// benefits render from src/content/goals via the generated manifest; GitHub
// joins the header; the AX footer row is retired.
//
// Operator rulings 2026-09-09: the section is "Notes & Goals"; the served
// HTML, reduced motion, the Off detent, print and forced colours are the plain
// borderless grid of every note; once enhanced the list pages under a wiper
// whose wipe is a DOM mask in lockstep with the engine's clock (src/lib/wiper),
// driven by one stalk. Every row stays in the DOM in every state, so the
// manifest pins below hold without a JavaScript branch.

const AA = 4.5;
const LARGE = 3;
const WIDE = { width: 1280, height: 900 };

const section = (page: Page) => page.locator('#goals');

// Away from the section: a resting pointer must never change what is measured.
async function pointerAway(page: Page) {
	await page.mouse.move(0, 0);
}

test('the notes render from the manifest as an ordered, borderless list, soonest first', async ({ page }) => {
	await page.goto('/');
	const list = page.locator('#goals .goal-list');
	expect(await list.evaluate((el) => el.tagName)).toBe('OL');
	await expect(list).toHaveAttribute('role', 'list');
	const rows = list.locator('> li');
	await expect(rows).toHaveCount(publicGoals.length);
	expect(publicGoals.length).toBeGreaterThanOrEqual(6);
	// The rendered order IS the SSOT's sort (order asc, then slug), and the
	// first row is the operator's first penciled goal.
	await expect(rows.locator('h3')).toHaveText(publicGoals.map((goal) => goal.metadata.title));
	await expect(rows.first().locator('h3')).toHaveText('Form the club');
	await expect(page.locator('#goals')).toContainText('Sunday, September 20, 2026');
	// Featured-image home integration (the 2026-09-01 batch's deferred item):
	// a goal that ships the frontmatter image group renders that exact image
	// and alt text in the designed media slot, above the title; an imageless
	// goal renders NO figure and no reserved box (graceful absence). Every
	// expectation derives from the manifest so the pin stays honest as goals
	// gain or lose images.
	for (const [index, goal] of publicGoals.entries()) {
		const media = rows.nth(index).locator('.goal-media');
		if (goal.metadata.image) {
			const expectedAlt = goal.metadata.image_alt ?? '';
			expect(expectedAlt).not.toBe('');
			await expect(media).toHaveCount(1);
			const image = media.locator('img');
			await expect(image).toHaveCount(1);
			await expect(image).toHaveAttribute('src', goal.metadata.image);
			await expect(image).toHaveAttribute('alt', expectedAlt);
		} else {
			await expect(media).toHaveCount(0);
		}
	}
	// Never-cards (2026-08-30): no border on any side of any row, no fill.
	const boxes = await rows.evaluateAll((els) =>
		els.map((el) => {
			const s = getComputedStyle(el);
			return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth, s.backgroundColor];
		}),
	);
	for (const box of boxes) {
		expect(box.slice(0, 4)).toEqual(['0px', '0px', '0px', '0px']);
		expect(box[4]).toBe('rgba(0, 0, 0, 0)');
	}
});

test('member benefits and help asks render with their CTAs', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'What members get' })).toBeVisible();
	await expect(page.locator('#benefits li')).toHaveCount(memberBenefits.length);
	await expect(page.locator('#benefits')).toContainText('latoolb.us');
	await expect(page.locator('#help li')).toHaveCount(publicHelpAsks.length);
	expect(publishedGoalEntries.length).toBe(publicGoals.length + memberBenefits.length + publicHelpAsks.length);
	for (const link of await page.locator('#help a, #goals .goal-cta a').all()) {
		await expect(link).toHaveAttribute('href', '/contact');
	}
});

test('every note carries an Edit link to its own source and the section links the collection', async ({ page }) => {
	await page.goto('/');
	const rows = page.locator('#goals .goal-list > li');
	for (const [index, goal] of publicGoals.entries()) {
		const edits = rows.nth(index).locator('.goal-edit a');
		await expect(edits).toHaveCount(1);
		await expect(edits).toHaveAttribute('href', `${sourceMap.repoUrl}/edit/${sourceMap.branch}/${goal.sourcePath}`);
		await expect(edits).toHaveAttribute('aria-label', `Edit ${goal.metadata.title} on GitHub`);
		await expect(edits).toHaveAttribute('rel', /noopener/u);
		// Edit is not a CTA: the CTA pin above still points every .goal-cta at /contact.
		expect(await edits.evaluate((el) => el.closest('.goal-cta'))).toBeNull();
	}
	const collection = section(page).getByRole('link', { name: 'Edit these notes on GitHub' });
	await expect(collection).toHaveAttribute('href', `${sourceMap.repoUrl}/tree/${sourceMap.branch}/src/content/goals`);
	await expect(section(page).locator('.source-link')).toContainText('These notes live in git.');
});

const pane = (page: Page) => page.locator('#goals .wiper');
const stalk = (page: Page) => page.locator('#goals .wiper-stalk');
const currentTitles = (page: Page) => page.locator('#goals .goal-list > li.is-current h3').allTextContents();

async function selectDetent(page: Page, label: string) {
	await stalk(page).locator('.wiper-stalk__item', { hasText: label }).click();
	await expect(page.getByRole('radio', { name: label })).toBeChecked();
	await pointerAway(page);
}

test('the notes page under one stalk with four detents, and Off is the plain grid', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	await pointerAway(page);
	// One control: a radio group named for the speed, Off first, Intermittent on load.
	const group = page.getByRole('radiogroup', { name: 'Wiper speed' });
	await expect(group).toHaveCount(1);
	await expect(stalk(page).locator('.wiper-stalk__item')).toHaveText(WIPER_DETENTS.map((entry) => entry.label));
	for (const entry of WIPER_DETENTS) await expect(group.getByRole('radio', { name: entry.label })).toHaveCount(1);
	await expect(group.getByRole('radio', { name: 'Intermittent' })).toBeChecked();
	await expect(page.locator('#goals button')).toHaveCount(0);
	await expect(page.locator('#goals [role="switch"]')).toHaveCount(0);
	// Paged: three notes up on a wide viewport, the rest in the DOM but hidden.
	await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused|wiping/u);
	await expect(page.locator('#goals .goal-list')).toHaveClass(/goal-list--paged/u);
	await expect(page.locator('#goals .goal-list > li.is-current')).toHaveCount(3);
	await expect(page.locator('#goals .goal-list > li')).toHaveCount(publicGoals.length);
	// Off is the resting grid at once: every note visible, nothing paged, nothing masked.
	await selectDetent(page, 'Off');
	await expect(pane(page)).toHaveAttribute('data-state', 'off');
	await expect(page.locator('#goals .goal-list')).not.toHaveClass(/goal-list--paged/u);
	for (const row of await page.locator('#goals .goal-list > li').all()) await expect(row).toBeVisible();
	await expect(page.locator('#goals [data-wipe]')).toHaveCount(0);
	// The indicator's slide is the only timed rule; once it has settled nothing animates.
	await page.waitForTimeout(400);
	expect(
		await page.evaluate(
			() =>
				document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest('#goals')).length,
		),
	).toBe(0);
	await selectDetent(page, 'Intermittent');
	await expect(page.locator('#goals .goal-list')).toHaveClass(/goal-list--paged/u);
});

test('a wipe masks the outgoing page out along the arc and the incoming page in, then turns the page', async ({
	page,
}) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	const firstPage = await currentTitles(page);
	expect(firstPage).toHaveLength(3);
	// Observe from inside the page: every data-wipe flip and every page turn,
	// with the mask progress sampled while the out-stroke runs.
	await page.evaluate(() => {
		const host = document.querySelector('#goals .wiper') as HTMLElement;
		const log: Array<Record<string, unknown>> = [];
		(window as unknown as { __wipeLog: typeof log }).__wipeLog = log;
		const observer = new MutationObserver(() => {
			const outs = host.querySelectorAll('li[data-wipe="out"]').length;
			const ins = host.querySelectorAll('li[data-wipe="in"]').length;
			log.push({
				state: host.dataset.state,
				outs,
				ins,
				unit: Number.parseFloat(host.style.getPropertyValue('--wipe-u')) || 0,
			});
		});
		observer.observe(host, {
			attributes: true,
			subtree: true,
			attributeFilter: ['data-wipe', 'data-state', 'class', 'style'],
		});
	});
	// Arm the hold before the stroke starts so the out-stroke freezes at its
	// midpoint the moment it begins; release it after reading the masks.
	await page.evaluate(() => {
		document.documentElement.dataset.wiperFreeze = '0.5';
	});
	await selectDetent(page, 'High');
	await expect(pane(page)).toHaveAttribute('data-state', 'wiping', { timeout: 15_000 });
	await expect(page.locator('#goals li[data-wipe="out"]')).toHaveCount(3);
	await expect(page.locator('#goals li[data-wipe="in"]')).toHaveCount(3);
	const outMask = await page
		.locator('#goals li[data-wipe="out"]')
		.first()
		.evaluate((el) => getComputedStyle(el).maskImage);
	expect(outMask).toContain('conic-gradient');
	const inMask = await page
		.locator('#goals li[data-wipe="in"]')
		.first()
		.evaluate((el) => getComputedStyle(el).maskImage);
	expect(inMask).toContain('conic-gradient');
	expect(await pane(page).evaluate((el) => el.style.getPropertyValue('--wipe-u'))).toBe('0.5000');
	await page.evaluate(() => {
		delete document.documentElement.dataset.wiperFreeze;
	});
	await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused/u, { timeout: 15_000 });
	const secondPage = await currentTitles(page);
	expect(secondPage).toHaveLength(3);
	expect(secondPage).not.toEqual(firstPage);
	expect(secondPage[0]).toBe(publicGoals[3].metadata.title);
	const log = await page.evaluate(
		() =>
			(window as unknown as { __wipeLog: Array<{ state: string; unit: number; outs: number; ins: number }> }).__wipeLog,
	);
	const units = log.filter((entry) => entry.state === 'wiping' && entry.outs === 3).map((entry) => entry.unit);
	expect(units.length).toBeGreaterThan(3);
	for (let index = 1; index < units.length; index += 1) expect(units[index]).toBeGreaterThanOrEqual(units[index - 1]);
	expect(Math.max(...units)).toBeGreaterThan(0.5);
	// Masks live only during the out-stroke: none once the page has turned.
	await expect(page.locator('#goals [data-wipe]')).toHaveCount(0);
	expect(await pane(page).evaluate((el) => el.style.getPropertyValue('--wipe-u'))).toBe('0.0000');
});

for (const width of [320, 390, 768, 1280, 1440]) {
	test(`the blade covers every note at ${width}px and the notes carry that arm's angles`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await pane(page).scrollIntoViewIfNeeded();
		await expect(page.locator('#goals .goal-list')).toHaveClass(/goal-list--paged/u);
		const measured = await page.evaluate(() => {
			const list = document.querySelector('#goals .goal-list') as HTMLElement;
			const box = list.getBoundingClientRect();
			const items = Array.from(list.querySelectorAll<HTMLElement>(':scope > li')).map((li) => {
				const style = getComputedStyle(li);
				return {
					centerX: li.getBoundingClientRect().left - box.left + li.getBoundingClientRect().width / 2,
					from: Number.parseFloat(style.getPropertyValue('--wipe-from')),
					span: Number.parseFloat(style.getPropertyValue('--wipe-span')),
					x: Number.parseFloat(style.getPropertyValue('--wipe-x')),
					y: Number.parseFloat(style.getPropertyValue('--wipe-y')),
				};
			});
			return { width: box.width, height: box.height, items };
		});
		const geometry = deriveGeometry({ width: measured.width, height: measured.height });
		expect(
			coversPane(geometry),
			`coverage of a ${Math.round(measured.width)}x${Math.round(measured.height)} pane`,
		).toBe(true);
		expect(geometry.arms).toHaveLength(width >= 768 ? 2 : 1);
		for (const item of measured.items) {
			const arm =
				geometry.arms.find((candidate) => item.centerX >= candidate.span[0] && item.centerX < candidate.span[1]) ??
				geometry.arms.at(-1)!;
			expect(item.from).toBeCloseTo(-halfSweepDeg(arm), 1);
			expect(item.span).toBeCloseTo(2 * halfSweepDeg(arm), 1);
			expect(Number.isFinite(item.x) && Number.isFinite(item.y)).toBe(true);
			// The hub hangs below the list, never below the stalk or the footer.
			expect(item.y).toBeLessThanOrEqual(arm.pivotY + 1);
		}
	});
}

test('a pointer over the pane pauses the wipers, leaving resumes them, and focus inside reveals the focused note', async ({
	page,
}) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	await pointerAway(page);
	await expect(pane(page)).toHaveAttribute('data-state', 'dwell');
	await pane(page).hover();
	await expect(pane(page)).toHaveAttribute('data-state', 'paused');
	await pointerAway(page);
	await expect(pane(page)).toHaveAttribute('data-state', 'dwell');
	// Focus a note on the last page: the page turns at once, no wipe, and holds.
	const lastIndex = publicGoals.length - 1;
	await page.locator('#goals .goal-list > li').nth(lastIndex).locator('.goal-edit a').focus();
	await expect(pane(page)).toHaveAttribute('data-state', 'paused');
	expect(await currentTitles(page)).toContain(publicGoals[lastIndex].metadata.title);
	await expect(page.locator('#goals .goal-list > li').nth(lastIndex)).toBeVisible();
	await page.waitForTimeout(wiperDetent('intermittent').dwellMs + 500);
	expect(await currentTitles(page)).toContain(publicGoals[lastIndex].metadata.title);
});

test('reduced motion shows the same grid, every note visible, nothing moving', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize(WIDE);
	await page.goto('/');
	const list = page.locator('#goals .goal-list');
	await expect(list.locator('> li')).toHaveCount(publicGoals.length);
	await expect(page.locator('#goals [role="radiogroup"], #goals .wiper-stalk')).toHaveCount(0);
	await expect(list).not.toHaveClass(/goal-list--paged/u);
	await expect(pane(page)).toHaveAttribute('data-state', 'off');
	for (const row of await list.locator('> li').all()) await expect(row).toBeVisible();
	await page.waitForTimeout(3000);
	for (const row of await list.locator('> li').all()) await expect(row).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest('#goals')).length,
		),
	).toBe(0);
});

test('paper gets every note, no stalk and no edit links, even mid-wipe', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	await selectDetent(page, 'High');
	await expect(pane(page)).toHaveAttribute('data-state', 'wiping', { timeout: 15_000 });
	await page.evaluate(() => {
		document.documentElement.dataset.wiperFreeze = '0.5';
	});
	await page.emulateMedia({ media: 'print' });
	const rows = page.locator('#goals .goal-list > li');
	for (const selector of ['.wiper-stalk']) {
		for (const el of await page.locator(`#goals ${selector}`).all()) {
			expect(await el.evaluate((node) => getComputedStyle(node).display), selector).toBe('none');
		}
	}
	expect(await rows.evaluateAll((els) => els.map((el) => getComputedStyle(el).maskImage))).toEqual(
		publicGoals.map(() => 'none'),
	);
	const shown = await rows.evaluateAll((els) =>
		els.map((el) => {
			const style = getComputedStyle(el);
			return [style.display !== 'none', style.opacity, style.transitionDuration];
		}),
	);
	expect(shown).toEqual(publicGoals.map(() => [true, '1', '0s']));
	for (const el of await page.locator('#goals .goal-edit').all()) {
		expect(await el.evaluate((node) => getComputedStyle(node).display)).toBe('none');
	}
	await expect(section(page).getByRole('link', { name: 'Edit these notes on GitHub' })).toHaveCount(1);
});

test('the section never widens the page on a narrow phone', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto('/');
	await pointerAway(page);
	const overflow = await page.evaluate(() => ({
		document: document.documentElement.scrollWidth - window.innerWidth,
		section: document.querySelector('#goals')!.scrollWidth - document.querySelector('#goals')!.clientWidth,
	}));
	expect(overflow.document).toBeLessThanOrEqual(0);
	expect(overflow.section).toBeLessThanOrEqual(0);
});

for (const mode of ['enhanced', 'no-js'] as const) {
	test.describe(`320px grid: ${mode}`, () => {
		test.use({ viewport: { width: 320, height: 700 }, javaScriptEnabled: mode !== 'no-js' });

		test('keeps every row and its links inside the section without clipping', async ({ page }) => {
			await page.goto('/');
			const list = page.locator('#goals .goal-list');
			await expect(list.locator('> li')).toHaveCount(publicGoals.length);
			// Nothing may be clipped by the viewport: rows and links stay inside
			// the 320px width (the per-row Edit link keeps its 0.15rem optical
			// overhang past the column, which is why the section box is not the
			// reference; the responsive sweep's viewport rule is).
			const bounds = await page.evaluate(() => {
				const offenders: string[] = [];
				for (const el of document.querySelectorAll<HTMLElement>('#goals .goal-list > li, #goals .goal-list a')) {
					const r = el.getBoundingClientRect();
					if (r.width === 0 || r.height === 0) continue;
					if (r.left < -1 || r.right > window.innerWidth + 1)
						offenders.push(el.tagName + ':' + (el.textContent ?? '').trim().slice(0, 30));
				}
				return offenders;
			});
			expect(bounds).toEqual([]);
			expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe('visible');
		});
	});
}

for (const scheme of ['light', 'dark'] as const) {
	test(`body copy on bare ground clears its floor over the blob layer (${scheme})`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await setScheme(page, scheme);
		await expect(page.getByTestId('brand-vectors-bg')).toHaveCount(1);
		// The layer fades in after its idle mount; sample once it is opaque.
		await page.waitForTimeout(1200);
		const ground = page.locator('#goals .goal-asides');
		await ground.scrollIntoViewIfNeeded();
		await pointerAway(page);
		const extremes = await measureGlassExtremes(page, '#goals .goal-asides', 2);
		const worst = async (role: string) => {
			const ink = await resolveRoleRgb(page, role);
			return Math.min(
				roundRatio(contrastRatio(ink, extremes.darkest.rgb)),
				roundRatio(contrastRatio(ink, extremes.lightest.rgb)),
			);
		};
		expect(await worst('--fg'), 'body copy on the ground').toBeGreaterThanOrEqual(AA);
		expect(await worst('--fg-muted'), 'muted copy on the ground').toBeGreaterThanOrEqual(AA);
		expect(await worst('--link'), 'links on the ground').toBeGreaterThanOrEqual(AA);
		expect(await worst('--heading'), 'headings on the ground').toBeGreaterThanOrEqual(LARGE);
	});
}

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the served HTML is the grid with no dead chrome', async ({ page }) => {
		await page.goto('/');
		const list = page.locator('#goals .goal-list');
		await expect(list.locator('> li')).toHaveCount(publicGoals.length);
		// No chrome in the static document: no buttons, no switch, no stalk, no
		// canvas, no inline style on the list, no hidden rows.
		await expect(page.locator('#goals button')).toHaveCount(0);
		await expect(page.locator('#goals [role="switch"], #goals [role="radiogroup"], #goals .wiper-stalk')).toHaveCount(
			0,
		);
		await expect(page.locator('#goals svg, #goals canvas')).toHaveCount(0);
		await expect(list).not.toHaveClass(/goal-list--paged/u);
		await expect(list).not.toHaveAttribute('style', /./u);
		await expect(page.locator('#goals [aria-hidden="true"]')).toHaveCount(0);
		// The resting layout is the ratified borderless grid, not a scroller;
		// the edit links are already there.
		expect(await list.evaluate((el) => getComputedStyle(el).display)).toBe('grid');
		expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe('visible');
		await expect(page.locator('#goals .goal-edit a')).toHaveCount(publicGoals.length);
	});
});

test('the hero carries one spelling of the Thursday hours', async ({ page }) => {
	await page.goto('/');
	const session = page.locator('.hero .hero-session');
	await expect(session.getByRole('heading', { level: 3 })).toHaveText('Public work sessions');
	await expect(session).toContainText('Thursdays, about 3 to 5 PM ET');
	await expect(session).not.toContainText('3–5');
	await expect(page.getByText(/Thursdays, about 3 to 5 PM ET/u)).toHaveCount(1);
});

test('GitHub sits in the header as an outbound link and the AX footer row is gone', async ({ page }) => {
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	const github = nav.getByRole('link', { name: /^GitHub/u });
	await expect(github).toHaveAttribute('href', 'https://github.com/Great-Falls-Tool-Bus');
	await expect(github).toHaveAttribute('rel', /external/u);
	await expect(nav.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
	await expect(page.locator('footer')).not.toContainText('AGENTS.md');
});
