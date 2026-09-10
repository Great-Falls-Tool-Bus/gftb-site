import { expect, test, type Page } from '@playwright/test';
import { skipHomeIntro } from './support/intro';

import { contrastRatio, roundRatio } from '../scripts/lib/color-contrast.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	measureExtremesInRects,
	measureGlassExtremes,
	measureTextureInRects,
	resolveRoleRgb,
	setScheme,
} from './support/glass-contrast';

// The same generated map SourceLink and NotesAndGoals read (a JSON import
// needs an import attribute under Playwright's loader; read it directly).
const sourceMap = JSON.parse(
	readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/generated/source-map.json'), 'utf8'),
) as { repoUrl: string; branch: string };

import { publishedGoalEntries } from '../src/lib/generated/goals-manifest';
import { memberBenefits, publicGoals, publicHelpAsks } from '../src/lib/public-goals';
import { bladePoseAt, coversPane, deriveGeometry, parkAngle, sweepSpanDeg } from '../src/lib/wiper/geometry';
import { WIPER_DETENTS, wiperDetent } from '../src/lib/wiper/schedule';
import { awaitTier, forceTierMax } from './support/wiper-tier';

// The home intro's scroll would break this spec's scroll-position premises.
test.beforeEach(async ({ page }) => {
	await skipHomeIntro(page);
});

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
	expect(publicGoals.length).toBe(5);
	// The rendered order IS the SSOT's sort (order asc, then slug), and the
	// first row is the operator's first penciled goal.
	await expect(rows.locator('h3')).toHaveText(publicGoals.map((goal) => goal.metadata.title));
	await expect(rows.first().locator('h3')).toHaveText('Soft opening at the block party');
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
	// Never-cards (2026-08-30) as amended at LOOK 3 (2026-09-09): no border on
	// any side of any row; every row is one translucent glass pane (the site's
	// content-surface fill at 70%), the same for all, so photos and copy share
	// one uniform occlusion over the scene rather than floating on it.
	// The fill lives on the note's ::before (Chromium drops a mask on an
	// element that carries a backdrop-filter), so it is read there.
	const boxes = await rows.evaluateAll((els) =>
		els.map((el) => {
			const s = getComputedStyle(el);
			const fill = getComputedStyle(el, '::before').backgroundColor;
			return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth, fill];
		}),
	);
	const fills = new Set<string>();
	for (const box of boxes) {
		expect(box.slice(0, 4)).toEqual(['0px', '0px', '0px', '0px']);
		expect(box[4]).toMatch(/\/ 0\.7\)$|, 0\.7\)$/u);
		fills.add(box[4]);
	}
	expect(fills.size).toBe(1);
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
	// One control: a radio group named for the speed, Off first, High on load.
	const group = page.getByRole('radiogroup', { name: 'Wiper speed' });
	await expect(group).toHaveCount(1);
	await expect(stalk(page).locator('.wiper-stalk__item')).toHaveText(WIPER_DETENTS.map((entry) => entry.label));
	for (const entry of WIPER_DETENTS) await expect(group.getByRole('radio', { name: entry.label })).toHaveCount(1);
	await expect(group.getByRole('radio', { name: 'High' })).toBeChecked();
	await expect(page.locator('#goals button')).toHaveCount(0);
	await expect(page.locator('#goals [role="switch"]')).toHaveCount(0);
	// Paged: three notes up on a wide viewport, the rest in the DOM but hidden.
	await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused|wiping/u);
	await expect(page.locator('#goals .goal-list')).toHaveClass(/goal-list--paged/u);
	// High is the detent on load, so the page in view may already be the short last one.
	const current = await page.locator('#goals .goal-list > li.is-current').count();
	expect([3, publicGoals.length % 3 || 3]).toContain(current);
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

test('the chosen detent persists across a reload', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('radio', { name: 'High' })).toBeChecked();
	await selectDetent(page, 'Off');
	await expect(page.locator('#goals .goal-list')).not.toHaveClass(/goal-list--paged/u);
	await page.reload();
	await page.waitForLoadState('networkidle');
	// Off survives the reload: the visitor who cannot tolerate the motion is
	// not made to pick it again.
	await expect(page.getByRole('radio', { name: 'Off' })).toBeChecked();
	await expect(page.locator('#goals .goal-list')).not.toHaveClass(/goal-list--paged/u);
	expect(await page.evaluate(() => localStorage.getItem('wiper-detent'))).toBe('off');
	await selectDetent(page, 'Low');
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('radio', { name: 'Low' })).toBeChecked();
	await expect(page.locator('#goals .goal-list')).toHaveClass(/goal-list--paged/u);
});

test('a wipe masks the outgoing page out along the arc and the incoming page in, then turns the page', async ({
	page,
}) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	// High is the detent on load, so a wipe may already have turned the page
	// by now: hold the rest open, read whichever page is in view under the
	// hold (no stroke can start), and expect the one after it.
	await holdRest(page);
	await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused/u, { timeout: 60_000 });
	await expect(page.locator('#goals [data-wipe]')).toHaveCount(0);
	const firstPage = await currentTitles(page);
	const titles = publicGoals.map((goal) => goal.metadata.title);
	const pageSize = 3;
	const pageCount = Math.ceil(titles.length / pageSize);
	const pageInView = Math.floor(titles.indexOf(firstPage[0]) / pageSize);
	expect(pageInView).toBeGreaterThanOrEqual(0);
	expect(firstPage).toEqual(titles.slice(pageInView * pageSize, (pageInView + 1) * pageSize));
	const nextPage = (pageInView + 1) % pageCount;
	const expectedSecondPage = titles.slice(nextPage * pageSize, (nextPage + 1) * pageSize);
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
	// Swap the rest hold for a stroke hold: the rest resumes counting and the
	// out-stroke freezes at its midpoint the moment it begins; release it
	// after reading the masks.
	await page.evaluate(() => {
		document.documentElement.dataset.wiperFreeze = '0.5';
	});
	await selectDetent(page, 'High');
	await expect(pane(page)).toHaveAttribute('data-state', 'wiping', { timeout: 15_000 });
	await expect(page.locator('#goals li[data-wipe="out"]')).toHaveCount(firstPage.length);
	await expect(page.locator('#goals li[data-wipe="in"]')).toHaveCount(expectedSecondPage.length);
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
	// The hold is applied by the next animation frame; a starved rig can take
	// a while to deliver one.
	await expect
		.poll(() => pane(page).evaluate((el) => el.style.getPropertyValue('--wipe-u')), { timeout: 15_000 })
		.toBe('0.5000');
	// Halfway, the blades stand near vertical over their span midpoints: the
	// row of outgoing notes has been shoved right by the blade's advance past
	// the first note's corner (the contact lands a little before the midpoint
	// at this width), and the reveal underneath has not moved.
	const shove = await page.evaluate(() => {
		const out = document.querySelector<HTMLElement>('#goals li[data-wipe="out"]')!;
		const incoming = document.querySelector<HTMLElement>('#goals li[data-wipe="in"]')!;
		const matrix = new DOMMatrixReadOnly(getComputedStyle(out).transform);
		return { x: matrix.e, y: matrix.f, revealX: new DOMMatrixReadOnly(getComputedStyle(incoming).transform).e };
	});
	expect(shove.x).toBeGreaterThan(0);
	expect(shove.y).toBe(0);
	expect(shove.revealX).toBe(0);
	await page.evaluate(() => {
		delete document.documentElement.dataset.wiperFreeze;
	});
	await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused/u, { timeout: 15_000 });
	const secondPage = await currentTitles(page);
	expect(secondPage).toEqual(expectedSecondPage);
	expect(secondPage).not.toEqual(firstPage);
	const log = await page.evaluate(
		() =>
			(window as unknown as { __wipeLog: Array<{ state: string; unit: number; outs: number; ins: number }> }).__wipeLog,
	);
	// The engine resets the unit to 0 at the apex synchronously, a microtask
	// before Svelte drops the data-wipe attributes, so the log ends with that
	// reset; the rise before it must be monotonic and reach the turnaround.
	const units = log
		.filter((entry) => entry.state === 'wiping' && entry.outs === firstPage.length)
		.map((entry) => entry.unit);
	const peak = Math.max(...units);
	const rising = units.slice(0, units.lastIndexOf(peak) + 1);
	// The hold sits at 0.5 and the release continues upward; on a slow software
	// rail the remaining half-stroke can be a single frame, so the rise is
	// asserted, not the frame count.
	expect(rising.length).toBeGreaterThanOrEqual(2);
	for (let index = 1; index < rising.length; index += 1)
		expect(rising[index]).toBeGreaterThanOrEqual(rising[index - 1]);
	expect(peak).toBeGreaterThanOrEqual(0.5);
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
			expect(item.from).toBeCloseTo((parkAngle(arm) * 180) / Math.PI, 1);
			expect(item.span).toBeCloseTo(sweepSpanDeg(arm), 1);
			expect(Number.isFinite(item.x) && Number.isFinite(item.y)).toBe(true);
			// The hub hangs below the list, never below the stalk or the footer.
			expect(item.y).toBeLessThanOrEqual(arm.pivotY + 1);
		}
	});
}

const scene = (page: Page) => page.locator('#goals canvas.wiper__scene');

test('the scene canvas exists only while the notes page, fills the list box, and is inert', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	await pointerAway(page);
	await expect(scene(page)).toHaveCount(1);
	const tier = await awaitTier(page);
	await expect(scene(page)).toHaveAttribute('aria-hidden', 'true');
	// The blade layer: one transparent canvas over the notes, same box, inert,
	// on the same rung as the scene.
	const blades = page.locator('#goals canvas.wiper__blades');
	await expect(blades).toHaveCount(1);
	await expect(blades).toHaveAttribute('aria-hidden', 'true');
	await expect(blades).toHaveAttribute('data-tier', tier);
	const layering = await page.evaluate(() => {
		const scene = document.querySelector('#goals canvas.wiper__scene')!.getBoundingClientRect();
		const over = document.querySelector('#goals canvas.wiper__blades')!;
		const box = over.getBoundingClientRect();
		const style = getComputedStyle(over);
		const list = getComputedStyle(document.querySelector('#goals .goal-list')!);
		return {
			same: Math.abs(box.width - scene.width) < 1 && Math.abs(box.height - scene.height) < 1,
			z: Number(style.zIndex),
			listZ: Number(list.zIndex),
			pointer: style.pointerEvents,
			radius: style.borderRadius,
		};
	});
	expect(layering.same).toBe(true);
	expect(layering.z).toBeGreaterThan(layering.listZ);
	expect(layering.pointer).toBe('none');
	expect(layering.radius).toBe('0px');
	const boxes = await page.evaluate(() => {
		const canvas = document.querySelector('#goals canvas.wiper__scene')!;
		const list = document.querySelector('#goals .goal-list')!;
		const c = canvas.getBoundingClientRect();
		const l = list.getBoundingClientRect();
		const style = getComputedStyle(canvas);
		return {
			dx: Math.abs(c.x - l.x),
			dy: Math.abs(c.y - l.y),
			dw: Math.abs(c.width - l.width),
			dh: Math.abs(c.height - l.height),
			pointer: style.pointerEvents,
			radius: style.borderTopLeftRadius,
			zIndex: style.zIndex,
			listZ: getComputedStyle(list).zIndex,
			// The canvas is behind the notes: a point inside a note's title hits the DOM, never the canvas.
			hit: document.elementFromPoint(l.x + 40, l.y + 20)?.tagName,
		};
	});
	expect(boxes.dx).toBeLessThanOrEqual(1);
	expect(boxes.dy).toBeLessThanOrEqual(1);
	expect(boxes.dw).toBeLessThanOrEqual(1);
	expect(boxes.dh).toBeLessThanOrEqual(1);
	expect(boxes.pointer).toBe('none');
	expect(boxes.radius).toBe('0px');
	expect(boxes.hit).not.toBe('CANVAS');
	// Off is the plain grid: no scene at all; back on, it returns.
	await selectDetent(page, 'Off');
	await expect(scene(page)).toHaveCount(0);
	await selectDetent(page, 'Intermittent');
	await expect(scene(page)).toHaveCount(1);
});

// The ladder can be capped from outside before the page mounts: capped at
// WebGL2 on a WebGPU-capable browser both canvases run WebGL2 with nothing
// in the console; capped at none there is no canvas and the notes still page
// under the DOM wipe with the stalk in place.
test('the ladder honours a ceiling set before mount, silently', async ({ browser }) => {
	const capped = await browser.newContext({ viewport: WIDE });
	const page = await capped.newPage();
	const console: string[] = [];
	page.on('console', (message) => {
		if (message.type() !== 'error' && message.type() !== 'warning') return;
		if (message.type() === 'warning' && /GL Driver Message \(OpenGL, Performance,/u.test(message.text())) return;
		console.push(`${message.type()}: ${message.text()}`);
	});
	await forceTierMax(page, 'webgl2');
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	await expect(scene(page)).toHaveAttribute('data-tier', 'webgl2', { timeout: 15_000 });
	await expect(page.locator('#goals canvas.wiper__blades')).toHaveAttribute('data-tier', 'webgl2');
	await page.waitForTimeout(1500);
	expect(console).toEqual([]);
	await capped.close();

	const bare = await browser.newContext({ viewport: WIDE });
	const grid = await bare.newPage();
	await forceTierMax(grid, 'none');
	await grid.goto('/');
	await grid.waitForLoadState('networkidle');
	await pane(grid).scrollIntoViewIfNeeded();
	await expect(grid.locator('#goals .goal-list')).toHaveClass(/goal-list--paged/u, { timeout: 15_000 });
	await expect(grid.locator('#goals canvas')).toHaveCount(0);
	await expect(grid.locator('#goals .wiper-stalk')).toBeVisible();
	await bare.close();
});

test('the scene is absent under reduced motion and hidden on paper and under forced colours', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await expect(scene(page)).toHaveCount(0);
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.reload();
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	await expect(scene(page)).toHaveCount(1);
	await page.emulateMedia({ media: 'print' });
	expect(await scene(page).evaluate((el) => getComputedStyle(el).display)).toBe('none');
	expect(await page.locator('#goals canvas.wiper__blades').evaluate((el) => getComputedStyle(el).display)).toBe('none');
	await page.emulateMedia({ media: 'screen', forcedColors: 'active' });
	// Forced colours stand the whole enhancement down, live: masks, opacity
	// and transforms are not neutralised by forced colours, so the engine
	// does it. No canvases, no paging, no stalk, every note in place.
	await expect(scene(page)).toHaveCount(0);
	await expect(page.locator('#goals canvas.wiper__blades')).toHaveCount(0);
	await expect(page.locator('#goals .goal-list')).not.toHaveClass(/goal-list--paged/u);
	await expect(stalk(page)).toHaveCount(0);
	await expect(pane(page)).toHaveAttribute('data-state', 'off');
	for (const row of await page.locator('#goals .goal-list > li').all()) await expect(row).toBeVisible();
	await page.emulateMedia({ forcedColors: 'none' });
	await expect(page.locator('#goals .goal-list')).toHaveClass(/goal-list--paged/u);
	await expect(scene(page)).toHaveCount(1);
});

// The panes carry the inks: the scene owes the text nothing (operator ruling
// at the M4 ratification: nothing sits under the text but the pane). Measured
// as the visitor sees it: every pane's contents hidden so its fill stays,
// the blade layer hidden (a passing blade is the wipe, not the ground), the
// real composite of pane over scene read under the notes' text boxes, at
// rest and with an out-stroke held at its midpoint, both schemes, against
// the glass inks the panes set.
async function paneTextRects(page: Page) {
	return page.evaluate(() => {
		const list = document.querySelector('#goals .goal-list')!.getBoundingClientRect();
		const rects: Array<{ left: number; top: number; width: number; height: number }> = [];
		for (const row of document.querySelectorAll(
			'#goals .goal-list > li.is-current, #goals .goal-list > li[data-wipe]',
		)) {
			for (const el of row.querySelectorAll('h3, p, a')) {
				const r = el.getBoundingClientRect();
				if (r.width <= 0 || r.height <= 0) continue;
				rects.push({ left: r.left - list.left, top: r.top - list.top, width: r.width, height: r.height });
			}
		}
		return rects;
	});
}

/** Hold the next rest open so a slow rig can look at it for as long as it needs. */
async function holdRest(page: Page) {
	await page.evaluate(() => {
		document.documentElement.dataset.wiperFreeze = 'rest';
	});
}

async function holdStroke(page: Page, unit: string) {
	await page.evaluate((value) => {
		document.documentElement.dataset.wiperFreeze = value;
	}, unit);
	await page.waitForFunction(
		(value) =>
			(document.querySelector('#goals .wiper') as HTMLElement).style.getPropertyValue('--wipe-u') ===
			Number(value).toFixed(4),
		unit,
		{ timeout: 30_000 },
	);
	await page.waitForTimeout(250);
}

async function releaseHold(page: Page) {
	await page.evaluate(() => {
		delete document.documentElement.dataset.wiperFreeze;
	});
}

for (const scheme of ['light', 'dark'] as const) {
	test(`the glass panes keep the notes' ink on its floor over the scene (${scheme})`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await setScheme(page, scheme);
		await pane(page).scrollIntoViewIfNeeded();
		await pointerAway(page);
		await awaitTier(page);
		// A rest held open: no note moves while the pixels are read.
		await holdRest(page);
		await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused/u, { timeout: 30_000 });
		await expect(page.locator('#goals [data-wipe]')).toHaveCount(0);
		await page.waitForTimeout(1500);
		// Mid-sweep a pane is masked along with its text, so a text box can lie
		// over bare scene where no glyph is painted: those pixels owe nothing.
		// A second capture paints the pane's fill magenta wherever the pane is
		// present and the measure keeps only those pixels.
		const panePresent = {
			style: '#goals .goal-list > li::before { background: #ff00ff !important; backdrop-filter: none !important; }',
			isPresent: (rgb: { red: number; green: number; blue: number }) =>
				rgb.red > 180 && rgb.green < 100 && rgb.blue > 180,
		};
		const check = async (label: string) => {
			const rects = await paneTextRects(page);
			expect(rects.length, `${label}: text rects`).toBeGreaterThan(3);
			const extremes = await measureExtremesInRects(
				page,
				'#goals .goal-list',
				rects,
				'#goals .goal-list > li > *, #goals canvas.wiper__blades',
				panePresent,
			);
			expect(extremes.sampled, `${label}: pixels where a pane is present`).toBeGreaterThan(2000);
			const worst = async (role: string) => {
				const ink = await resolveRoleRgb(page, role, '#goals .goal-list > li');
				return Math.min(
					roundRatio(contrastRatio(ink, extremes.darkest.rgb)),
					roundRatio(contrastRatio(ink, extremes.lightest.rgb)),
				);
			};
			expect(await worst('--fg'), `${label}: body copy`).toBeGreaterThanOrEqual(AA);
			expect(await worst('--fg-muted'), `${label}: window copy`).toBeGreaterThanOrEqual(AA);
			expect(await worst('--link'), `${label}: links`).toBeGreaterThanOrEqual(AA);
			expect(await worst('--heading'), `${label}: titles`).toBeGreaterThanOrEqual(LARGE);
		};
		await check('at rest');
		await selectDetent(page, 'High');
		await holdStroke(page, '0.5');
		await check('mid-sweep');
		await releaseHold(page);
	});
}

// The drawn blade and the mask edge share one clock and one easing. Hold the
// out-stroke where an arm's ray crosses a gutter (no pane there) and read
// the scene's own pixels: something far from the
// ground (rubber in light, chrome in dark) sits on the ray; move the hold to
// the vertical and the same spot is ground and blobs again. The left arm
// crosses the left gutter as it rises; the right arm reaches the right gutter
// near the turnaround.
const BLADE_CONTRAST = 6;

function rayPointAtX(arm: ReturnType<typeof deriveGeometry>['arms'][number], phi: number, x: number) {
	const sin = Math.sin(phi);
	if (Math.abs(sin) < 1e-6) return null;
	const t = (x - arm.pivotX) / sin;
	if (t <= 0) return null;
	return { x, y: arm.pivotY - t * Math.cos(phi) };
}

for (const scheme of ['light', 'dark'] as const) {
	test(`the blades are drawn on the mask edge and move with it (${scheme})`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await setScheme(page, scheme);
		await pane(page).scrollIntoViewIfNeeded();
		await pointerAway(page);
		await awaitTier(page);
		const box = await page.locator('#goals .goal-list').evaluate((el) => {
			const r = el.getBoundingClientRect();
			return { width: r.width, height: r.height };
		});
		const geometry = deriveGeometry(box);
		expect(geometry.arms).toHaveLength(2);
		const ground = await resolveRoleRgb(page, '--bg');
		const sampleX = 24;
		// The first held unit at which each arm's ray crosses its own gutter
		// inside the glass; the pose is what the scene draws at that hold.
		const targets = geometry.arms.map((arm, index) => {
			const x = index === 0 ? sampleX : box.width - sampleX;
			for (let unit = 0.02; unit <= 0.98; unit += 0.01) {
				const pose = bladePoseAt(arm, box, 'out', unit, unit);
				const point = rayPointAtX(arm, pose.phi, x);
				// Inside the band's own 8% feathers, where the blade layer is at full strength.
				if (point && point.y > box.height * 0.12 && point.y < box.height * 0.88) {
					const half = 1.4 * pose.width;
					return {
						unit: unit.toFixed(2),
						rect: { left: Math.max(0, x - half), top: point.y - half, width: 2 * half, height: 2 * half },
					};
				}
			}
			throw new Error(`no gutter crossing for the arm parked at ${parkAngle(arm)}`);
		});
		const peak = async (rect: (typeof targets)[number]['rect']) => {
			// The blade layer alone over the page ground: the notes and the scene
			// (whose beads and frost are sharp too) are hidden for the capture.
			const extremes = await measureExtremesInRects(
				page,
				'#goals canvas.wiper__blades',
				[rect],
				'#goals .goal-list, #goals canvas.wiper__scene',
			);
			return Math.max(
				roundRatio(contrastRatio(ground, extremes.darkest.rgb)),
				roundRatio(contrastRatio(ground, extremes.lightest.rgb)),
			);
		};
		const hold = async (unit: string) => {
			await page.evaluate((value) => {
				document.documentElement.dataset.wiperFreeze = value;
			}, unit);
			// The engine applies the hold on its next frame; wait for the mask to carry it.
			await page.waitForFunction(
				(value) =>
					(document.querySelector('#goals .wiper') as HTMLElement).style.getPropertyValue('--wipe-u') ===
					Number(value).toFixed(4),
				unit,
				{ timeout: 20_000 },
			);
			await page.waitForTimeout(150);
		};
		await hold(targets[0].unit);
		await selectDetent(page, 'High');
		await expect(pane(page)).toHaveAttribute('data-state', 'wiping', { timeout: 15_000 });
		await hold(targets[0].unit);
		expect(await peak(targets[0].rect), 'left blade on its ray').toBeGreaterThanOrEqual(BLADE_CONTRAST);
		await hold(targets[1].unit);
		expect(await peak(targets[1].rect), 'right blade on its ray').toBeGreaterThanOrEqual(BLADE_CONTRAST);
		// At the vertical both blades stand over the span midpoints, far from either gutter.
		await hold('0.5');
		expect(await peak(targets[0].rect), 'left gutter with the blade elsewhere').toBeLessThan(BLADE_CONTRAST);
		expect(await peak(targets[1].rect), 'right gutter with the blade elsewhere').toBeLessThan(BLADE_CONTRAST);
		await page.evaluate(() => {
			delete document.documentElement.dataset.wiperFreeze;
		});
	});
}

// The glass (M4): beads and frost build on the scene during a rest and the
// blade squeegees them. Both are small and sharp where the blob field is
// smooth, so the edge energy inside a gutter rect (inside the band's own
// feathers) rises through a rest and falls behind a passing blade. Measured
// on the scene canvas alone, notes and blades hidden. The rest is held open
// (data-wiper-freeze="rest") so a slow rig's screenshots cannot outlast it.
const GLASS_HIDE = '#goals .goal-list, #goals canvas.wiper__blades';

async function gutterRects(page: Page) {
	return page.evaluate(() => {
		const box = document.querySelector('#goals canvas.wiper__scene')!.getBoundingClientRect();
		const top = box.height * 0.12;
		const height = box.height * 0.76;
		return {
			left: { left: 6, top, width: 40, height },
			right: { left: box.width - 46, top, width: 40, height },
			// The lower half of the right gutter is swept well before the top corner.
			rightLow: { left: box.width - 46, top: box.height * 0.5, width: 40, height: box.height * 0.38 },
		};
	});
}

for (const scheme of ['light', 'dark'] as const) {
	test(`beads and frost build on the glass through a rest (${scheme})`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await setScheme(page, scheme);
		await pane(page).scrollIntoViewIfNeeded();
		await pointerAway(page);
		await awaitTier(page);
		// A fresh rest after a stroke, then held open. A starved rig counts the
		// rest slowly (a frame advances it a second at most), so allow a while.
		await expect(pane(page)).toHaveAttribute('data-state', 'wiping', { timeout: 60_000 });
		await holdRest(page);
		await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused/u, { timeout: 30_000 });
		const rests = await gutterRects(page);
		await page.waitForTimeout(150);
		const early = await measureTextureInRects(
			page,
			'#goals canvas.wiper__scene',
			[rests.left, rests.right],
			GLASS_HIDE,
		);
		await page.waitForTimeout(4000);
		expect(await pane(page).getAttribute('data-state'), 'the held rest').toMatch(/dwell|paused/u);
		const late = await measureTextureInRects(page, '#goals canvas.wiper__scene', [rests.left, rests.right], GLASS_HIDE);
		await releaseHold(page);
		// The strong-edge share is the measure: beads are small and sharp,
		// the field is smooth, and on a near-black ground the mean step is
		// mostly 8-bit quantisation. Summed over both gutters (dark beads are
		// gentle by ruling), it rises through the rest and ends with beads
		// present; calibrated on the rail 2026-09-09 (light 0.05 to 0.11, dark
		// 0.04 to 0.05).
		const sum = (t: typeof early) => t[0].strong + t[1].strong;
		expect(
			sum(late),
			`strong edges: ${sum(early).toFixed(4)} early, ${sum(late).toFixed(4)} late`,
		).toBeGreaterThanOrEqual(sum(early) * 1.15);
		expect(sum(late), 'beads present late in the rest').toBeGreaterThan(0.03);
		for (const side of [0, 1]) expect(late[side].sampled, `pixels, side ${side}`).toBeGreaterThan(1000);
	});

	test(`the blade squeegees the glass behind it and leaves it wet ahead (${scheme})`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await setScheme(page, scheme);
		await pane(page).scrollIntoViewIfNeeded();
		await pointerAway(page);
		await awaitTier(page);
		// Fill the glass under a held rest, then hold the next out-stroke at its
		// midpoint: both blades stand near vertical over their span midpoints,
		// so the left gutter lies behind the left blade and the right gutter
		// ahead of the right blade.
		await holdRest(page);
		await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused/u, { timeout: 30_000 });
		await page.waitForTimeout(4000);
		await selectDetent(page, 'High');
		await holdStroke(page, '0.5');
		const rests = await gutterRects(page);
		const mid = await measureTextureInRects(
			page,
			'#goals canvas.wiper__scene',
			[rests.left, rests.right, rests.rightLow],
			GLASS_HIDE,
		);
		// Behind a blade the strong-edge share falls to nothing (probe: 0.002
		// light, 0 dark) while ahead it carries the beads (0.05 light, 0.03 dark).
		expect(
			mid[0].strong,
			`behind the left blade: ${mid[0].strong.toFixed(4)} vs ahead ${mid[1].strong.toFixed(4)}`,
		).toBeLessThan(mid[1].strong * 0.3);
		expect(mid[1].strong, 'beads ahead of the right blade').toBeGreaterThan(0.01);
		// Move the hold near the turnaround: the right blade has passed the
		// lower right gutter too.
		await holdStroke(page, '0.98');
		const late = await measureTextureInRects(page, '#goals canvas.wiper__scene', [rests.rightLow], GLASS_HIDE);
		expect(
			late[0].strong,
			`behind the right blade: ${late[0].strong.toFixed(4)} vs ahead ${mid[2].strong.toFixed(4)}`,
		).toBeLessThan(mid[2].strong * 0.3);
		await releaseHold(page);
	});
}

test('a pointer over the pane pauses the wipers, leaving resumes them, and focus inside reveals the focused note', async ({
	page,
}) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await pane(page).scrollIntoViewIfNeeded();
	// The courtesy pause belongs to the intermittent detent alone (operator
	// ruling at the M4 ratification). Settle on Intermittent with no stroke in
	// flight before reading states: a stroke in flight completes under a pause
	// and would turn the page under the focus check below.
	await selectDetent(page, 'Intermittent');
	await pointerAway(page);
	await expect(pane(page)).toHaveAttribute('data-state', /dwell|paused/u, { timeout: 30_000 });
	await expect(page.locator('#goals [data-wipe]')).toHaveCount(0);
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
	// On High a resting pointer changes nothing: the wipers keep time.
	await page.locator('body').click({ position: { x: 5, y: 5 } });
	await selectDetent(page, 'High');
	await pane(page).hover();
	await expect(pane(page)).toHaveAttribute('data-state', /dwell|wiping/u);
	await page.waitForTimeout(400);
	await expect(pane(page)).toHaveAttribute('data-state', /dwell|wiping/u);
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
	await page.waitForLoadState('networkidle');
	await pointerAway(page);
	// The paged wiper is full bleed on the hero band's idiom (html clips x
	// overflow), so the measure is the document and every element in the
	// section against the viewport, not the section's own scroll width.
	const overflow = await page.evaluate(() => {
		const offenders: string[] = [];
		for (const el of document.querySelectorAll<HTMLElement>('#goals, #goals *')) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.left < -1 || r.right > window.innerWidth + 1) offenders.push(el.tagName + '.' + el.className.split(' ')[0]);
		}
		return { document: document.documentElement.scrollWidth - window.innerWidth, offenders };
	});
	expect(overflow.document).toBeLessThanOrEqual(0);
	expect(overflow.offenders).toEqual([]);
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
	test(`content glass clears its floor over the blob layer (${scheme})`, async ({ page }) => {
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
			const ink = await resolveRoleRgb(page, role, '#goals .goal-asides');
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
	await expect(session.getByText(/Thursdays, about 3 to 5 PM ET/u)).toHaveCount(1);
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
