// The home page's first-load intro (operator ruling 2026-09-10): armed before
// first paint, self-hiding with no bundle, landing Notes & Goals under the
// header, once per session, never under reduce, a fragment, JS off or paper,
// cancelled by any input, and never in the way of the skip link.
import { expect, test, type Page } from '@playwright/test';
import { forceTierMax } from './support/wiper-tier';

const intro = (page: Page) => page.getByTestId('home-intro');
const armed = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('intro-armed'));
const state = (page: Page) => page.evaluate(() => document.documentElement.dataset.intro ?? null);
const played = (page: Page) => page.evaluate(() => sessionStorage.getItem('intro-played'));
const visibility = (page: Page) => intro(page).evaluate((el) => getComputedStyle(el).visibility);
const goalsTop = (page: Page) =>
	page.evaluate(() => {
		const goals = document.querySelector('#goals');
		if (!goals) return null;
		const margin = Number.parseFloat(getComputedStyle(goals).scrollMarginTop) || 0;
		const max = document.documentElement.scrollHeight - window.innerHeight;
		return { top: goals.getBoundingClientRect().top, margin, scrollY: window.scrollY, max };
	});

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
		expect(early.animation).toBe('intro-veil');
		await expect.poll(() => visibility(page), { timeout: 2500 }).toBe('hidden');
		await page.waitForTimeout(3200);
		expect(await armed(page)).toBe(false);
	});

	test('the full sequence lands Notes & Goals under the header and marks the session', async ({ page }) => {
		const problems: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') {
				// The two lines acceptance-no-js exempts: the software rasteriser's
				// note and Chrome's own word that it has no WebGPU adapter.
				const text = message.text();
				if (/GL Driver Message \(OpenGL, Performance,/u.test(text) || text === 'No available adapters.') return;
				problems.push(text);
			}
		});
		page.on('pageerror', (error) => problems.push(error.message));
		await page.goto('/');
		await expect.poll(() => state(page), { timeout: 10_000 }).toBe('done');
		const box = await goalsTop(page);
		expect(box).not.toBeNull();
		if (box) {
			const clamped = box.scrollY >= box.max - 1;
			if (!clamped) expect(Math.abs(box.top - box.margin)).toBeLessThanOrEqual(2);
			expect(box.scrollY).toBeGreaterThan(0);
		}
		expect(await played(page)).toBe('1');
		expect(await visibility(page)).toBe('hidden');
		expect(await armed(page)).toBe(false);
		expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
		expect(problems).toEqual([]);

		// A second visit in the same session does not arm. Away and back, not a
		// reload or a same-URL navigation: Chrome restores those scroll
		// positions on its own, which is not the intro.
		await page.goto('/log', { waitUntil: 'domcontentloaded' });
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		expect(await armed(page)).toBe(false);
		await expect.poll(() => state(page)).toBe('skipped');
		await page.waitForTimeout(2000);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
	});

	test('a fragment never arms', async ({ page }) => {
		await page.goto('/#goals', { waitUntil: 'domcontentloaded' });
		expect(await armed(page)).toBe(false);
		await expect.poll(() => state(page)).toBe('skipped');
		expect(await played(page)).toBeNull();
	});

	test('a key during the scroll stops the page where it is', async ({ page }) => {
		await page.goto('/');
		await expect.poll(() => state(page), { timeout: 8000 }).toBe('scroll');
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(40);
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

	test('the skip link stays reachable and on top of the veil, and the veil holds no focusable node', async ({
		page,
	}) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		expect(await intro(page).evaluate((el) => el.querySelectorAll('a, button, input, [tabindex]').length)).toBe(0);
		// During the veil the pointer passes through it.
		const hit = await page.evaluate(() => {
			const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
			return el?.closest('.home-intro') ? 'veil' : 'page';
		});
		expect(hit).toBe('page');
		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'Skip to content' });
		await expect(skip).toBeFocused();
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

	test('paper hides it even when armed', async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => document.documentElement.classList.add('intro-armed'));
		await page.emulateMedia({ media: 'print' });
		expect(await intro(page).evaluate((el) => getComputedStyle(el).display)).toBe('none');
	});

	test('with no canvas the hold ends at once and the scroll starts about 1.5 s in', async ({ page }) => {
		await forceTierMax(page, 'none');
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		const start = Date.now();
		await expect.poll(() => state(page), { timeout: 6000 }).toBe('scroll');
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThan(1000);
		expect(elapsed).toBeLessThan(4000);
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
		expect(await played(page)).toBeNull();
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
