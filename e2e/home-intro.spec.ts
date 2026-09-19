// The home page's first-load intro (operator rulings 2026-09-10 and
// 2026-09-19, the mark drives in and parks): armed
// before first paint on every full load, self-hiding with no bundle, the
// veil held until the wiper stack has hydrated, landing Notes & Goals under
// the header, replayed on a reload, never under reduce, a fragment, the
// data-intro-off hook, JS off or paper, cancelled by any input, and never in
// the way of the skip link.
import { expect, test, type Page } from '@playwright/test';
import { skipHomeIntro } from './support/intro';
import { forceTierMax } from './support/wiper-tier';

const intro = (page: Page) => page.getByTestId('home-intro');
const armed = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('intro-armed'));
const state = (page: Page) => page.evaluate(() => document.documentElement.dataset.intro ?? null);
const visibility = (page: Page) => intro(page).evaluate((el) => getComputedStyle(el).visibility);
const goalsTop = (page: Page) =>
	page.evaluate(() => {
		const goals = document.querySelector('#goals');
		if (!goals) return null;
		const margin = Number.parseFloat(getComputedStyle(goals).scrollMarginTop) || 0;
		const max = document.documentElement.scrollHeight - window.innerHeight;
		return { top: goals.getBoundingClientRect().top, margin, scrollY: window.scrollY, max };
	});
// The section's own reveal transition (a 10 px settle) may still be finishing
// in the frames after the tween lands, so the landing is read with a short
// settle window; the scroll position itself must not move in that window.
const landed = async (page: Page) => {
	const first = await goalsTop(page);
	expect(first).not.toBeNull();
	if (!first) return;
	const clamped = first.scrollY >= first.max - 1;
	if (!clamped) {
		await expect
			.poll(
				async () => {
					const box = await goalsTop(page);
					return box ? Math.abs(box.top - box.margin) : Number.POSITIVE_INFINITY;
				},
				{ timeout: 1500, intervals: [50] },
			)
			.toBeLessThanOrEqual(2);
	}
	const settled = await goalsTop(page);
	expect(settled?.scrollY).toBe(first.scrollY);
	expect(first.scrollY).toBeGreaterThan(0);
};
const cleanConsole = (page: Page) => {
	const problems: string[] = [];
	page.on('console', (message) => {
		if (message.type() !== 'error' && message.type() !== 'warning') return;
		const text = message.text();
		if (/GL Driver Message \(OpenGL, Performance,/u.test(text)) return;
		if (text === 'No available adapters.' || text === 'A valid external Instance reference no longer exists.') return;
		problems.push(text);
	});
	page.on('pageerror', (error) => problems.push(error.message));
	return problems;
};

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('motion allowed', () => {
	test.beforeEach(async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
	});

	test('arms before hydration and clears itself with a dead bundle', async ({ page }) => {
		await page.route('**/_app/immutable/**/*.js', (route) => route.abort());
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		expect(await armed(page)).toBe(true);
		const early = await intro(page).evaluate((el) => ({
			visibility: getComputedStyle(el).visibility,
			animation: getComputedStyle(el).animationName,
		}));
		expect(early.visibility).toBe('visible');
		expect(early.animation).toBe('intro-veil');
		await expect.poll(() => visibility(page), { timeout: 4500 }).toBe('hidden');
		await expect.poll(() => armed(page), { timeout: 2000 }).toBe(false);
	});

	test('the veil waits for the wiper stack, then lands Notes & Goals under the header, and a reload replays it', async ({
		page,
	}) => {
		const problems = cleanConsole(page);
		const start = Date.now();
		await page.goto('/');
		// The veil holds while the canvases are pending and lifts once they report a rung.
		// Sampled every 50 ms: the lift lasts about a second, and the default
		// poll backoff would reach one-second intervals before the 3 s dwell ends.
		await expect.poll(() => state(page), { timeout: 12_000, intervals: [50] }).toBe('lift');
		const liftedAt = Date.now() - start;
		expect(liftedAt).toBeGreaterThan(2700);
		expect(
			await page.evaluate(() =>
				[...document.querySelectorAll('#goals canvas[data-tier]')].every(
					(c) => c.getAttribute('data-tier') !== 'pending',
				),
			),
		).toBe(true);
		await expect.poll(() => state(page), { timeout: 12_000 }).toBe('done');
		await landed(page);
		expect(await visibility(page)).toBe('hidden');
		expect(await armed(page)).toBe(false);
		expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
		expect(problems).toEqual([]);

		// A full reload replays the whole sequence from the top: the restored
		// scroll position is undone beneath the veil and the tween lands again.
		await page.reload();
		await expect.poll(() => state(page), { timeout: 3000 }).toBe('veil');
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
		await expect.poll(() => state(page), { timeout: 12_000 }).toBe('done');
		await landed(page);
		expect(problems).toEqual([]);
	});

	test('the data-intro-off hook keeps it from arming', async ({ page }) => {
		await skipHomeIntro(page);
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		expect(await armed(page)).toBe(false);
		await expect.poll(() => state(page)).toBe('skipped');
		await page.waitForTimeout(2500);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
	});

	test('a fragment never arms', async ({ page }) => {
		await page.goto('/#goals', { waitUntil: 'domcontentloaded' });
		expect(await armed(page)).toBe(false);
		await expect.poll(() => state(page)).toBe('skipped');
	});

	test('a key during the scroll stops the page where it is', async ({ page }) => {
		await page.goto('/');
		// Press the moment the tween starts: it lasts 1.6 s, so a coarse poll
		// could otherwise watch it land before the key arrives.
		await expect.poll(() => state(page), { timeout: 12_000, intervals: [40] }).toBe('scroll');
		await page.keyboard.press('Shift');
		const at = await page.evaluate(() => window.scrollY);
		await page.waitForTimeout(400);
		expect(Math.abs((await page.evaluate(() => window.scrollY)) - at)).toBeLessThanOrEqual(1);
		expect(await state(page)).toBe('cancelled');
		expect(await armed(page)).toBe(false);
		const box = await goalsTop(page);
		expect(box && Math.abs(box.top - box.margin) > 2).toBe(true);
	});

	test('a wheel before hydration disarms the veil', async ({ page }) => {
		await page.route('**/_app/immutable/**/*.js', (route) => route.abort());
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		expect(await armed(page)).toBe(true);
		await page.mouse.move(640, 450);
		await page.mouse.wheel(0, 10);
		await expect.poll(() => armed(page)).toBe(false);
	});

	test('the veil holds no focusable node, sits under the skip link, and passes the pointer through', async ({
		page,
	}) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state(page), { timeout: 5000 }).toBe('veil');
		// Live and visible while these are read: no keypress yet, so nothing has cancelled it.
		expect(await visibility(page)).toBe('visible');
		expect(await intro(page).evaluate((el) => el.querySelectorAll('a, button, input, [tabindex]').length)).toBe(0);
		expect(await intro(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
		const skip = page.getByRole('link', { name: 'Skip to content' });
		await skip.evaluate((el) => (el as HTMLElement).focus());
		await expect(skip).toBeFocused();
		const stack = await page.evaluate(() => {
			const veil = document.querySelector('.home-intro') as HTMLElement;
			const link = document.querySelector('.skip-link') as HTMLElement;
			return { veil: Number(getComputedStyle(veil).zIndex), link: Number(getComputedStyle(link).zIndex) };
		});
		expect(stack.link).toBeGreaterThan(stack.veil);
		// The link is the element at its own centre: nothing paints over it.
		const onTop = await skip.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
			return at === el || el.contains(at);
		});
		expect(onTop).toBe(true);
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#main-content$/u);
		await expect(page.locator('#main-content')).toBeFocused();
	});

	test('the veil holds past the minimum dwell while the wiper canvases are still pending', async ({ page }) => {
		// Stall the WebGL2 rung's chunk (found by its content, the hashes are
		// not known here) so the canvases still sit at pending well past the
		// 3 s minimum: the veil must not lift on the timer alone.
		await forceTierMax(page, 'webgl2');
		await page.route('**/_app/immutable/chunks/*.js', async (route) => {
			const response = await route.fetch();
			const body = await response.text();
			if (body.includes('webglcontextlost')) await new Promise((resolve) => setTimeout(resolve, 4400));
			await route.fulfill({ response, body });
		});
		const start = Date.now();
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state(page), { timeout: 5000 }).toBe('veil');
		await page.waitForTimeout(Math.max(0, 3600 - (Date.now() - start)));
		// Past the 3.0 s minimum, canvases still pending, veil still down.
		expect(
			await page.evaluate(() =>
				[...document.querySelectorAll('#goals canvas[data-tier]')].some(
					(c) => c.getAttribute('data-tier') === 'pending',
				),
			),
		).toBe(true);
		expect(await state(page)).toBe('veil');
		expect(await visibility(page)).toBe('visible');
		await expect.poll(() => state(page), { timeout: 10_000 }).not.toBe('veil');
		// Lifted once the stalled rung came up (or at the 5.5 s cap past mount):
		// well past the minimum, and bounded loosely for a loaded rig.
		const liftedAt = Date.now() - start;
		expect(liftedAt).toBeGreaterThan(3600);
		expect(liftedAt).toBeLessThan(9000);
	});

	test('a phone viewport lands the section under the header as well', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('/');
		await expect.poll(() => state(page), { timeout: 20_000 }).toBe('done');
		await landed(page);
	});

	test('forced colours never arm the veil and never paint it', async ({ page }) => {
		await page.emulateMedia({ forcedColors: 'active' });
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		expect(await armed(page)).toBe(false);
		expect(await intro(page).evaluate((el) => getComputedStyle(el).display)).toBe('none');
		await expect.poll(() => state(page)).toBe('skipped');
	});

	test('paper hides it even when armed', async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => document.documentElement.classList.add('intro-armed'));
		await page.emulateMedia({ media: 'print' });
		expect(await intro(page).evaluate((el) => getComputedStyle(el).display)).toBe('none');
	});

	test('with no canvas the veil lifts at the minimum dwell', async ({ page }) => {
		await forceTierMax(page, 'none');
		const start = Date.now();
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await expect.poll(() => state(page), { timeout: 9000, intervals: [50] }).toBe('lift');
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThan(2700);
		expect(elapsed).toBeLessThan(5600);
	});

	test('the mark drives in from the left and parks at centre before the veil lifts', async ({ page }) => {
		await page.goto('/', { waitUntil: 'commit' });
		await expect.poll(() => state(page), { timeout: 5000 }).toBe('veil');
		// Drive the mark's own animation clock rather than the wall clock, so
		// the row reads the same three moments however loaded the rig is.
		const at = (ms: number) =>
			page.evaluate((time) => {
				const mark = document.querySelector<HTMLElement>('.home-intro__mark');
				const drive = mark?.getAnimations().find((a) => (a as CSSAnimation).animationName === 'intro-mark-drive');
				if (!mark || !drive) return null;
				drive.pause();
				drive.currentTime = time;
				const box = mark.getBoundingClientRect();
				return { centre: box.x + box.width / 2, top: box.top, width: box.width };
			}, ms);
		const viewport = page.viewportSize()!;
		const arriving = await at(400);
		expect(arriving).not.toBeNull();
		expect(arriving!.centre).toBeLessThan(viewport.width / 2 - 8);
		expect(arriving!.width).toBeGreaterThan(100);
		const parked = await at(1400);
		expect(Math.abs(parked!.centre - viewport.width / 2)).toBeLessThanOrEqual(2);
		// After the drive nothing moves it: the finished animation holds the parked box.
		const held = await page.evaluate(() => {
			const mark = document.querySelector<HTMLElement>('.home-intro__mark')!;
			for (const a of mark.getAnimations()) a.finish();
			const box = mark.getBoundingClientRect();
			return { centre: box.x + box.width / 2, top: box.top, width: box.width };
		});
		expect(held).toEqual(parked);
		expect(await state(page)).toBe('veil');
	});
});

test.describe('reduced motion', () => {
	test('never arms and never moves the page', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
		expect(await armed(page)).toBe(false);
		expect(await intro(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
		expect(await visibility(page)).toBe('hidden');
		await page.waitForTimeout(2000);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
	});
});

test.describe('no JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('never shows the veil', async ({ page }) => {
		await page.goto('/');
		expect(await armed(page)).toBe(false);
		expect(await visibility(page)).toBe('hidden');
	});
});
