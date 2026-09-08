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

// Operator ruling 2026-08-31: the home page's goals, help asks, and member
// benefits render from src/content/goals via the generated manifest; GitHub
// joins the header; the AX footer row is retired.
//
// Operator rulings 2026-09-08: the section is "Notes & Goals" and the rows
// ride the wiper rotator (src/lib/components/WiperRotator.svelte, goals
// consumer NotesAndGoals.svelte). Every pre-rotator pin below still holds
// (the OL/role=list markup, the row count and order, the never-cards sweep,
// the CTA hrefs) because every row stays in the DOM in every state; the
// rotator-specific rows (two controls, pause honesty, focus-follow, the
// stalk, edit links, reduced-motion stillness, print, glass contrast, no-JS
// degradation) follow after them.

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
	// and alt text in the carousel's designed media slot, above the title;
	// an imageless goal renders NO figure and no reserved box (graceful
	// absence). Every expectation derives from the manifest so the pin stays
	// honest as goals gain or lose images.
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
	await expect(page.locator('#benefits')).toContainText('once the mail system is proved');
	await expect(page.locator('#help li')).toHaveCount(publicHelpAsks.length);
	expect(publishedGoalEntries.length).toBe(publicGoals.length + memberBenefits.length + publicHelpAsks.length);
	for (const link of await page.locator('#help a, #goals .goal-cta a').all()) {
		await expect(link).toHaveAttribute('href', '/contact');
	}
});

// Wide viewports page three notes at a time; the pane's dwell/stroke timing
// is read from its own custom properties rather than hardcoded here.
const WIDE = { width: 1280, height: 900 };

const pane = (page: Page) => page.locator('#goals .wiper');
const dwellOf = (page: Page) =>
	pane(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue('--wiper-dwell')));
const strokeOf = (page: Page) =>
	pane(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue('--wiper-stroke')));
const visibleTitles = (page: Page) => page.locator('#goals .goal-list > li.is-current h3').allTextContents();

// Away from the pane: a pointer resting on it is a courtesy pause.
async function pointerAway(page: Page) {
	await page.mouse.move(0, 0);
}

async function selectDetent(page: Page, name: string) {
	await pane(page).getByRole('radiogroup', { name: 'Wiper speed' }).getByRole('radio', { name }).click();
	await pointerAway(page);
}

test('the notes ride a wiper rotator with exactly two controls, and Off is the plain grid', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await expect(page.locator('#goals h2')).toHaveText('Notes & Goals');

	const region = pane(page);
	await expect(region).toHaveAttribute('role', 'group');
	await expect(region).toHaveAttribute('aria-labelledby', 'goals-title');
	// Hydration paged the list and started the wipers on the default detent.
	await expect(region).toHaveClass(/wiper--enhanced/u);
	await expect(region).toHaveAttribute('data-state', /^(dwell|wiping)$/u);
	await expect(region).toHaveAttribute('data-page', '0');

	// Every title stays in the DOM while the pages turn: rows are shown and
	// hidden in place, never mounted and unmounted.
	const list = page.locator('#goals .goal-list');
	await expect(list.locator('> li h3')).toHaveText(publicGoals.map((goal) => goal.metadata.title));
	expect(await visibleTitles(page)).toEqual(publicGoals.slice(0, 3).map((goal) => goal.metadata.title));

	// Exactly two controls: the switch and the four-detent stalk. No
	// previous/next/play/pause anywhere in the section.
	const wipers = region.getByRole('switch', { name: 'Wipers' });
	await expect(wipers).toHaveAttribute('aria-checked', 'true');
	const stalk = region.getByRole('radiogroup', { name: 'Wiper speed' });
	await expect(stalk.getByRole('radio')).toHaveText(['Off', 'Intermittent', 'Low', 'High']);
	await expect(stalk.getByRole('radio', { name: 'Intermittent' })).toHaveAttribute('aria-checked', 'true');
	await expect(page.locator('#goals button')).toHaveCount(5);
	await expect(page.locator('#goals').getByRole('button', { name: /previous|next|play|pause|advance/iu })).toHaveCount(
		0,
	);

	// The status line is silent while rotating.
	const status = region.locator('.wiper-status');
	await expect(status).toHaveAttribute('aria-live', 'off');

	// Off: the resting grid of every note, at once, and a polite status.
	await wipers.click();
	await expect(wipers).toHaveAttribute('aria-checked', 'false');
	await expect(region).toHaveAttribute('data-state', 'off');
	await expect(stalk.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
	await expect(status).toHaveAttribute('aria-live', 'polite');
	await expect(list).not.toHaveClass(/wiper-list--paged/u);
	for (const row of await list.locator('> li').all()) await expect(row).toBeVisible();
	expect(await list.evaluate((el) => getComputedStyle(el).display)).toBe('grid');

	// On again restores the last detent. (The pane shrinks back to one page
	// under the cursor, which may leave the pointer outside it, so the
	// courtesy-pause state is not asserted here; the hover test covers it.)
	await wipers.click();
	await expect(stalk.getByRole('radio', { name: 'Intermittent' })).toHaveAttribute('aria-checked', 'true');
	await pointerAway(page);
	await expect(region).toHaveAttribute('data-state', /^(dwell|wiping)$/u);
	await expect(status).toHaveAttribute('aria-live', 'off');
});

test('the stalk sets the dwell, rides a roving tabindex, and Off on the stalk is the switch off', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	const region = pane(page);
	const stalk = region.getByRole('radiogroup', { name: 'Wiper speed' });

	const dwells: number[] = [];
	for (const name of ['Intermittent', 'Low', 'High']) {
		await selectDetent(page, name);
		await expect(stalk.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
		await expect(stalk.getByRole('radio', { name })).toHaveAttribute('tabindex', '0');
		await expect(stalk.getByRole('radio', { checked: false })).toHaveCount(3);
		for (const other of await stalk.getByRole('radio', { checked: false }).all()) {
			await expect(other).toHaveAttribute('tabindex', '-1');
		}
		dwells.push(await dwellOf(page));
	}
	// Faster detents dwell for less time; the sweep is always shorter than the dwell.
	expect(dwells[0]).toBeGreaterThan(dwells[1]);
	expect(dwells[1]).toBeGreaterThan(dwells[2]);
	expect(dwells[2]).toBeGreaterThanOrEqual(1000);

	// Arrow keys move the selection (and focus) with wrap-around.
	await stalk.getByRole('radio', { name: 'High' }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(stalk.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
	await expect(stalk.getByRole('radio', { name: 'Off' })).toBeFocused();
	await expect(region).toHaveAttribute('data-state', 'off');
	await expect(region.getByRole('switch', { name: 'Wipers' })).toHaveAttribute('aria-checked', 'false');
	await page.keyboard.press('ArrowLeft');
	await expect(stalk.getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Home');
	await expect(stalk.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('End');
	await expect(stalk.getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');
});

test("a wipe turns the page at the blades' turnaround and every note gets its turn", async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await selectDetent(page, 'High');
	const region = pane(page);
	await region.scrollIntoViewIfNeeded();
	const pageCount = Math.ceil(publicGoals.length / 3);
	// One dwell plus a full sweep per turn, with generous slack: under a
	// loaded parallel run Chromium throttles timers and animation events.
	const cycleMs = 3 * ((await dwellOf(page)) + 2 * (await strokeOf(page))) + 3000;

	// Page index and the titles under it are read in one evaluate: a
	// turnaround between two separate reads would credit a page's titles to
	// its predecessor and skip one.
	const snapshot = () =>
		region.evaluate((el) => ({
			page: el.getAttribute('data-page'),
			titles: Array.from(el.querySelectorAll('li.is-current h3'), (h3) => h3.textContent ?? ''),
		}));
	const seen = new Set<string>();
	for (let turn = 0; turn <= pageCount && seen.size < publicGoals.length; turn += 1) {
		const snap = await snapshot();
		for (const title of snap.titles) seen.add(title);
		await expect.poll(async () => (await snapshot()).page, { timeout: cycleMs }).not.toBe(snap.page);
	}
	expect([...seen].sort()).toEqual(publicGoals.map((goal) => goal.metadata.title).sort());
	// The pane never becomes a scroller and the arms stay inside it.
	expect(await region.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('a pointer over the pane pauses the wipers and leaving resumes them', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await selectDetent(page, 'High');
	const region = pane(page);
	const status = region.locator('.wiper-status');
	const dwell = await dwellOf(page);
	const stroke = await strokeOf(page);

	await region.hover();
	await expect(region).toHaveAttribute('data-state', /^(paused|wiping)$/u);
	// A sweep in flight finishes; from then on the page must not turn while
	// the pointer rests on the pane.
	await expect(region).toHaveAttribute('data-state', 'paused');
	await expect(status).toHaveAttribute('aria-live', 'polite');
	const before = await region.getAttribute('data-page');
	await page.waitForTimeout(dwell + 2 * stroke + 500);
	expect(await region.getAttribute('data-page')).toBe(before);

	await pointerAway(page);
	await expect(region).toHaveAttribute('data-state', /^(dwell|wiping)$/u);
	await expect(status).toHaveAttribute('aria-live', 'off');
	await expect
		.poll(async () => region.getAttribute('data-page'), { timeout: dwell + 2 * stroke + 1500 })
		.not.toBe(before);
});

test('keyboard focus inside the list pauses the wipers and reveals the focused note', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await pointerAway(page);
	const region = pane(page);
	const rows = page.locator('#goals .goal-list > li');
	const lastIndex = publicGoals.length - 1;
	const lastTitle = publicGoals[lastIndex].metadata.title;

	// The last note sits on the last page; focusing its Edit link brings
	// that page forward at once, with no wipe, and holds it.
	const edit = rows.nth(lastIndex).getByRole('link', { name: `Edit ${lastTitle} on GitHub` });
	await edit.focus();
	await expect(region).toHaveAttribute('data-state', 'paused');
	await expect(region).toHaveAttribute('data-page', String(Math.floor(lastIndex / 3)));
	await expect(rows.nth(lastIndex)).toBeVisible();
	await expect(edit).toBeFocused();

	// Focus moves on (to the dash, which is outside the list): rotation resumes.
	await region.getByRole('switch', { name: 'Wipers' }).focus();
	await expect(region).toHaveAttribute('data-state', /^(dwell|wiping)$/u);
});

test('focus during an outbound wipe keeps the selected note visible after that sweep ends', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await selectDetent(page, 'High');
	const region = pane(page);
	// Catch a real CSS animation start and focus in that same browser turn;
	// separate test-driver calls could miss the short outbound stroke.
	const observed = await region.evaluate(
		(el) =>
			new Promise<{
				index: number;
				state: string | null;
				stroke: string | null;
				opacity: string;
				sweepMs: number;
			}>((resolve, reject) => {
				const arm = el.querySelector('.wiper-arm--left');
				if (!arm) return reject(new Error('the wiper arm is missing'));
				const timer = setTimeout(() => {
					arm.removeEventListener('animationstart', onStart);
					reject(new Error('no outbound wiper animation started'));
				}, 10_000);
				function onStart(event: Event) {
					if (event.target !== arm || (event as AnimationEvent).animationName !== 'wiper-sweep') return;
					clearTimeout(timer);
					arm?.removeEventListener('animationstart', onStart);
					const rows = Array.from(el.querySelectorAll<HTMLElement>('.goal-list > li'));
					const index = rows.findIndex((row) => !row.classList.contains('is-current'));
					const row = rows[index];
					const edit = row?.querySelector<HTMLAnchorElement>('.goal-edit a');
					if (!row || !edit) return reject(new Error('an off-page note Edit link is missing'));
					const before = {
						index,
						state: el.getAttribute('data-state'),
						stroke: el.getAttribute('data-stroke'),
						opacity: getComputedStyle(row).opacity,
						sweepMs: 2 * Number.parseFloat(getComputedStyle(el).getPropertyValue('--wiper-stroke')),
					};
					edit.focus();
					resolve(before);
				}
				arm.addEventListener('animationstart', onStart);
			}),
	);
	expect(observed).toMatchObject({ state: 'wiping', stroke: 'out', opacity: '0' });
	expect(observed.sweepMs).toBeGreaterThan(0);
	const focusedRow = page.locator('#goals .goal-list > li').nth(observed.index);
	const edit = focusedRow.locator('.goal-edit a');
	await expect(edit).toBeFocused();
	await expect(region).toHaveAttribute('data-state', 'paused');
	await expect(region).toHaveAttribute('data-page', String(Math.floor(observed.index / 3)));
	await expect(focusedRow).toHaveClass(/is-current/u);
	await expect(focusedRow).toHaveCSS('transition-duration', '0s');
	await expect(focusedRow).toHaveCSS('opacity', '1');
	// Past both the cancelled sweep and its timer failsafe, neither can
	// advance the page while the same link retains keyboard focus.
	await page.waitForTimeout(observed.sweepMs + 500);
	await expect(edit).toBeFocused();
	await expect(region).toHaveAttribute('data-state', 'paused');
	await expect(region).toHaveAttribute('data-page', String(Math.floor(observed.index / 3)));
	await expect(focusedRow).toHaveCSS('opacity', '1');
});

test('every note carries an Edit link to its own source and the pane links the collection', async ({ page }) => {
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
	const collection = pane(page).getByRole('link', { name: 'Edit these notes on GitHub' });
	await expect(collection).toHaveAttribute('href', `${sourceMap.repoUrl}/tree/${sourceMap.branch}/src/content/goals`);
	await expect(pane(page).locator('.source-link')).toContainText('These notes live in git.');
});

test('reduced motion never rotates and offers no rotation controls', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize(WIDE);
	await page.goto('/');
	const region = pane(page);
	const list = page.locator('#goals .goal-list');

	// Enhanced, but not rotatable: the resting grid, no dash, no arms.
	await expect(region).toHaveClass(/wiper--enhanced/u);
	await expect(region).toHaveAttribute('data-state', 'off');
	await expect(page.locator('#goals button')).toHaveCount(0);
	await expect(region.locator('svg')).toHaveCount(0);
	await expect(list).not.toHaveClass(/wiper-list--paged/u);
	for (const row of await list.locator('> li').all()) await expect(row).toBeVisible();

	// Longer than the default dwell: nothing moves on its own, nothing animates.
	await page.waitForTimeout(6000);
	await expect(region).toHaveAttribute('data-state', 'off');
	for (const row of await list.locator('> li').all()) await expect(row).toBeVisible();
	expect(
		await page.evaluate(
			() =>
				document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest('#goals')).length,
		),
	).toBe(0);
	expect(await region.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none');
});

test('paper gets every note and none of the dash', async ({ page }) => {
	await page.setViewportSize(WIDE);
	await page.goto('/');
	await pointerAway(page);
	await expect(pane(page)).toHaveClass(/wiper--paged/u);
	// Hold only the blades when the real dwell starts an outbound sweep;
	// row opacity transitions continue normally and must reach zero first.
	await page.addStyleTag({ content: '.wiper-arm { animation-play-state: paused !important; }' });
	await expect(pane(page)).toHaveAttribute('data-stroke', 'out', { timeout: 10_000 });
	await expect(page.locator('#goals li.is-current').first()).toHaveCSS('opacity', '0');
	await page.emulateMedia({ media: 'print' });
	const rows = page.locator('#goals .goal-list > li');
	const shown = await rows.evaluateAll((els) =>
		els.map((el) => {
			const style = getComputedStyle(el);
			return [style.display !== 'none', style.opacity, style.transitionDuration];
		}),
	);
	expect(shown).toEqual(publicGoals.map(() => [true, '1', '0s']));
	for (const selector of ['.wiper-controls', '.wiper-arms', '.goal-edit']) {
		for (const el of await page.locator(`#goals ${selector}`).all()) {
			expect(await el.evaluate((node) => getComputedStyle(node).display), selector).toBe('none');
		}
	}
});

test('the pane never widens the page on a narrow phone', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto('/');
	await pointerAway(page);
	// One note per page below 48rem.
	expect(await visibleTitles(page)).toHaveLength(1);
	const overflow = await page.evaluate(() => ({
		document: document.documentElement.scrollWidth - window.innerWidth,
		section: document.querySelector('#goals')!.scrollWidth - document.querySelector('#goals')!.clientWidth,
	}));
	expect(overflow.document).toBeLessThanOrEqual(0);
	expect(overflow.section).toBeLessThanOrEqual(0);
});

for (const mode of ['off', 'reduced', 'no-js'] as const) {
	test.describe(`320px resting grid: ${mode}`, () => {
		test.use({
			viewport: { width: 320, height: 700 },
			reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
			javaScriptEnabled: mode !== 'no-js',
		});

		test('keeps every row and its links inside the pane without clipping', async ({ page }) => {
			await page.goto('/');
			const region = pane(page);
			if (mode === 'off') await region.getByRole('switch', { name: 'Wipers' }).click();
			await expect(region).toHaveAttribute('data-state', 'off');
			const list = page.locator('#goals .goal-list');
			await expect(list).not.toHaveClass(/wiper-list--paged/u);
			await expect(list.locator('> li')).toHaveCount(publicGoals.length);
			await expect(list.locator('.goal-edit a')).toHaveCount(publicGoals.length);
			for (const row of await list.locator('> li').all()) await expect(row).toHaveCSS('opacity', '1');

			const geometry = await region.evaluate((el) => {
				const bounds = (node: Element) => {
					const { left, right, width } = node.getBoundingClientRect();
					return { left, right, width };
				};
				const list = el.querySelector('.goal-list')!;
				const rect = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				return {
					list: bounds(list),
					rows: Array.from(list.children, bounds),
					controls: Array.from(el.querySelectorAll('.goal-list a, .wiper-controls button, .source-link a'), bounds),
					paneLeft: rect.left + Number.parseFloat(style.borderLeftWidth),
					paneRight: rect.right - Number.parseFloat(style.borderRightWidth),
					overflow: document.documentElement.scrollWidth - window.innerWidth,
				};
			});
			expect(geometry.list.width).toBeGreaterThan(0);
			expect(geometry.rows).toHaveLength(publicGoals.length);
			for (const row of geometry.rows) {
				expect(row.width).toBeGreaterThan(0);
				expect(row.left).toBeGreaterThanOrEqual(geometry.list.left - 1);
				expect(row.right).toBeLessThanOrEqual(geometry.list.right + 1);
			}
			expect(geometry.controls.length).toBeGreaterThan(publicGoals.length);
			for (const control of geometry.controls) {
				expect(control.width).toBeGreaterThan(0);
				expect(control.left).toBeGreaterThanOrEqual(geometry.paneLeft - 1);
				expect(control.right).toBeLessThanOrEqual(geometry.paneRight + 1);
			}
			expect(geometry.overflow).toBeLessThanOrEqual(0);
		});
	});
}

const AA = 4.5;
const LARGE = 3;

for (const scheme of ['light', 'dark'] as const) {
	test(`the pane's ink clears its floor against the real rendered glass (${scheme})`, async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await setScheme(page, scheme);
		await pane(page).scrollIntoViewIfNeeded();
		await pointerAway(page);
		expect(await pane(page).evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur');

		// Any pixel of the pane can sit behind any of its ink, so every pair
		// is held to the worse of the two extremes.
		// A 16px inset keeps the pane's own 1px --rule border (the same border
		// .hero-glass carries) out of the scan; no ink ever sits on it.
		const extremes = await measureGlassExtremes(page, '#goals .wiper', 16);
		const worst = async (role: string) => {
			const ink = await resolveRoleRgb(page, role);
			return Math.min(
				roundRatio(contrastRatio(ink, extremes.darkest.rgb)),
				roundRatio(contrastRatio(ink, extremes.lightest.rgb)),
			);
		};
		expect(await worst('--fg'), 'body copy on the pane').toBeGreaterThanOrEqual(AA);
		expect(await worst('--fg-muted'), 'window / edit copy on the pane').toBeGreaterThanOrEqual(AA);
		expect(await worst('--link'), 'CTA and edit links on the pane').toBeGreaterThanOrEqual(AA);
		expect(await worst('--heading'), 'note titles on the pane').toBeGreaterThanOrEqual(LARGE);
		expect(await worst('--accent'), 'dash control boundaries on the pane').toBeGreaterThanOrEqual(LARGE);
	});
}

test.describe('without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('the served HTML is the resting grid with no dead chrome', async ({ page }) => {
		await page.goto('/');
		const list = page.locator('#goals .goal-list');
		await expect(list.locator('> li')).toHaveCount(publicGoals.length);
		// No rotator chrome in the static document: no buttons, no switch, no
		// stalk, no arms, no inline style on the list, no hidden rows.
		await expect(page.locator('#goals button')).toHaveCount(0);
		await expect(page.locator('#goals [role="switch"], #goals [role="radiogroup"]')).toHaveCount(0);
		await expect(page.locator('#goals .wiper svg')).toHaveCount(0);
		await expect(list).not.toHaveAttribute('style', /./u);
		await expect(page.locator('#goals [aria-hidden="true"]')).toHaveCount(0);
		await expect(pane(page)).toHaveAttribute('data-state', 'off');
		// The resting layout is the ratified borderless grid inside the pane,
		// not a scroller; the edit links are already there.
		expect(await list.evaluate((el) => getComputedStyle(el).display)).toBe('grid');
		expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe('visible');
		await expect(page.locator('#goals .goal-edit a')).toHaveCount(publicGoals.length);
	});
});

test('the session band carries one spelling of the Friday hours', async ({ page }) => {
	await page.goto('/');
	const band = page.locator('.next-session');
	await expect(band.getByRole('heading', { level: 2 })).toHaveText('Public work sessions');
	await expect(band.locator('.date-chip')).toHaveText('Fridays, about 3 to 5 PM ET');
	await expect(band).not.toContainText('3–5');
	await expect(page.locator('#status')).not.toContainText('Fridays');
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
