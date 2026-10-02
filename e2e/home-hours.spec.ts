import { expect, test, type Page } from '@playwright/test';
import { skipHomeIntro } from './support/intro';
import { installExternalGuard, stubChallenge } from './support/network';

import { HOURS_FIXTURE_GLOBAL } from '../src/lib/hours-band';
import { publicHoursSlots } from '../src/lib/public-hours';
import { RSVP_OPEN_EVENT } from '../src/lib/rsvp-form';

// Work sessions on the bus (operator interview 2026-10-02): the band beneath
// the hero and above Notes & Goals. The served HTML is clock-free; dates
// expand on the visitor's clock after mount. Under 48rem the dated rows are a
// carousel (scroll snap, one card per view, steps and dots, no auto-advance),
// at 48rem and up a right-hand vertical loop over a duplicated track that
// pauses on hover, on focus and by its button; reduced motion and no-JS get
// the static list; the document never widens.
//
// Every slot is still published: false, so the real page shows the empty
// state. The populated rows run on the band's test hook
// (window.__gftbHoursFixture, published slots that pass the content schema)
// on a fixed clock, which is what the visitor's clock would read.

const NOW = new Date('2026-10-02T16:00:00Z');
const FIXTURE = [
	{
		id: 'thursday-weekly',
		published: true,
		weekday: 'thursday',
		start: '15:00',
		end: '16:00',
		timezone: 'America/New_York',
		staff: ['Jess'],
		repeat: { kind: 'weekly', startsOn: '2026-10-02' },
		location: 'the bus',
	},
	{
		id: 'monday-october',
		published: true,
		weekday: 'monday',
		start: '17:00',
		end: '18:00',
		timezone: 'America/New_York',
		staff: [],
		repeat: { kind: 'weekly', startsOn: '2026-10-05', count: 2 },
		location: 'the bus',
	},
];
// Four weeks from Friday 2 October, soonest first, at most six rows.
const SESSIONS = [
	['monday-october@2026-10-05', 'Monday 5 October, 5 to 6 PM ET', '2026-10-05T17:00-04:00'],
	['thursday-weekly@2026-10-08', 'Thursday 8 October, 3 to 4 PM ET', '2026-10-08T15:00-04:00'],
	['monday-october@2026-10-12', 'Monday 12 October, 5 to 6 PM ET', '2026-10-12T17:00-04:00'],
	['thursday-weekly@2026-10-15', 'Thursday 15 October, 3 to 4 PM ET', '2026-10-15T15:00-04:00'],
	['thursday-weekly@2026-10-22', 'Thursday 22 October, 3 to 4 PM ET', '2026-10-22T15:00-04:00'],
	['thursday-weekly@2026-10-29', 'Thursday 29 October, 3 to 4 PM ET', '2026-10-29T15:00-04:00'],
] as const;

const EMPTY_TEXT = 'No work session is scheduled right now. Use the contact form to ask about a tour.';

const band = (page: Page) => page.locator('#hours');

async function documentOverflow(page: Page) {
	return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function withSessions(page: Page, now: Date = NOW, slots: readonly object[] = FIXTURE) {
	await page.clock.setFixedTime(now);
	await page.addInitScript(
		({ name, fixture }) => {
			(window as unknown as Record<string, unknown>)[name] = fixture;
		},
		{ name: HOURS_FIXTURE_GLOBAL, fixture: slots },
	);
}

test.beforeEach(async ({ page }) => {
	await skipHomeIntro(page);
});

test.describe('the empty state while every slot is unpublished', () => {
	test('the content is still unpublished', () => {
		// The flip PR publishes the slots and replaces these rows with the
		// fixed-clock rows of the real content.
		expect(publicHoursSlots).toEqual([]);
	});

	for (const javaScriptEnabled of [true, false]) {
		test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript', () => {
			test.use({ javaScriptEnabled });

			test('says nothing is scheduled and points at the contact form for a tour', async ({ page }) => {
				await page.goto('/');
				await expect(band(page)).toHaveAttribute('data-hours-mode', 'empty');
				await expect(band(page).getByRole('heading', { level: 2 })).toHaveText('Work sessions on the bus');
				await expect(band(page)).toContainText(EMPTY_TEXT);
				await expect(band(page).getByRole('link', { name: 'contact form', exact: true })).toHaveAttribute(
					'href',
					'/contact',
				);
				await expect(band(page).locator('button, ol, [inert]')).toHaveCount(0);
				// Beneath the hero, above Notes & Goals.
				const order = await page.evaluate(() => {
					const shell = document.querySelector('.page-shell');
					return [shell?.firstElementChild?.id, document.querySelector('#hours + #goals') !== null];
				});
				expect(order).toEqual(['hours', true]);
				expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
			});
		});
	}
});

test.describe('with sessions on a fixed clock', () => {
	test('reduced motion shows the static list of every row, at rest, at any width', async ({ page }) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		for (const width of [375, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto('/');
			await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
			const rows = band(page).locator('.hours-list > li');
			await expect(rows).toHaveCount(SESSIONS.length);
			await expect(rows.locator('time')).toHaveText(SESSIONS.map(([, label]) => label));
			for (const [index, [, label, datetime]] of SESSIONS.entries()) {
				await expect(rows.nth(index).locator('time')).toHaveAttribute('datetime', datetime);
				await expect(rows.nth(index).getByRole('button', { name: `RSVP for ${label}` })).toBeVisible();
			}
			await expect(rows.nth(0)).toContainText('2 Mondays');
			await expect(rows.nth(0)).toContainText('With a keyholder');
			await expect(rows.nth(1)).toContainText('Weekly');
			await expect(rows.nth(1)).toContainText('With Jess');
			await expect(rows.nth(1)).toContainText('On the bus');
			await expect(band(page).locator('.hours-row__today')).toHaveCount(0);
			await expect(band(page).locator('.hours-loop, .hours-carousel, [inert], [aria-hidden="true"]')).toHaveCount(0);
			expect(
				await page.evaluate(
					() =>
						document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest('#hours'))
							.length,
				),
			).toBe(0);
			expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
		}
	});

	test('the RSVP button raises the open event, and the RSVP dialog takes it', async ({ page, baseURL }) => {
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
		await page.evaluate((name) => {
			const seen: unknown[] = [];
			(window as unknown as Record<string, unknown>).__rsvpSeen = seen;
			window.addEventListener(name, (event) => seen.push([(event as CustomEvent).detail, event.defaultPrevented]));
		}, RSVP_OPEN_EVENT);
		const [slotId, label] = SESSIONS[1];
		await band(page)
			.getByRole('button', { name: `RSVP for ${label}` })
			.click();
		// Operator interview 2026-10-02 (PR 3 of 4): the RSVP dialog now takes
		// the event (cancels it) instead of the band handing the visitor to
		// the contact section. The dialog's own rows are in e2e/home-rsvp.spec.ts.
		expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__rsvpSeen)).toEqual([
			[{ slotId, label }, true],
		]);
		await expect(page.getByRole('dialog')).toContainText(label);
	});

	test('a session on the current New York day is marked Today', async ({ page }) => {
		await withSessions(page, new Date('2026-10-08T13:00:00Z'));
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
		const first = band(page).locator('.hours-list > li').first();
		await expect(first.locator('time')).toHaveText('Thursday 8 October, 3 to 4 PM ET');
		await expect(first.locator('.hours-row__today')).toHaveText('Today');
		await expect(band(page).locator('.hours-row__today')).toHaveCount(1);
	});

	test('under 48rem the rows are a carousel: one card per view, steps and dots, no auto-advance', async ({ page }) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'carousel');
		const track = band(page).locator('.hours-carousel__track');
		const cards = track.locator('> li');
		const dots = band(page).locator('.hours-carousel__dot');
		const previous = band(page).getByRole('button', { name: 'Previous session' });
		const next = band(page).getByRole('button', { name: 'Next session' });
		await expect(cards).toHaveCount(SESSIONS.length);
		await expect(dots).toHaveCount(SESSIONS.length);
		await expect(band(page).locator('[inert], [aria-hidden="true"]')).toHaveCount(0);

		const geometry = await track.evaluate((element) => ({
			overflowX: getComputedStyle(element).overflowX,
			snap: getComputedStyle(element).scrollSnapType,
			width: element.clientWidth,
			cards: [...element.children].map((card) => Math.round(card.getBoundingClientRect().width)),
		}));
		expect(geometry.overflowX).toBe('auto');
		expect(geometry.snap).toMatch(/^x mandatory/u);
		expect(geometry.cards.every((width) => Math.abs(width - geometry.width) <= 1)).toBe(true);
		expect(await band(page).evaluate((element) => getComputedStyle(element).overflowX)).toBe('hidden');

		const scrolledTo = (index: number) =>
			expect.poll(() => track.evaluate((element) => Math.round(element.scrollLeft / element.clientWidth))).toBe(index);
		await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');
		await expect(previous).toHaveAttribute('aria-disabled', 'true');

		// No auto-advance: the first card stays put.
		await page.waitForTimeout(1500);
		expect(await track.evaluate((element) => element.scrollLeft)).toBe(0);

		await next.click();
		await scrolledTo(1);
		await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
		await expect(dots.nth(0)).not.toHaveAttribute('aria-current', /./u);
		await expect(previous).toHaveAttribute('aria-disabled', 'false');

		await dots.nth(SESSIONS.length - 1).click();
		await scrolledTo(SESSIONS.length - 1);
		await expect(next).toHaveAttribute('aria-disabled', 'true');

		await previous.click();
		await scrolledTo(SESSIONS.length - 2);
		await expect(dots.nth(SESSIONS.length - 2)).toHaveAttribute('aria-current', 'true');

		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
		await page.setViewportSize({ width: 320, height: 812 });
		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
	});

	test('at 48rem and up the rows loop on the right and pause on hover, on focus and by the button', async ({
		page,
	}) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'loop');
		const loop = band(page).locator('.hours-loop');
		const track = loop.locator('.hours-loop__track');
		const lists = track.locator('> ol');
		await expect(lists).toHaveCount(2);
		await expect(lists.nth(0).locator('> li')).toHaveCount(SESSIONS.length);
		await expect(lists.nth(0)).not.toHaveAttribute('aria-hidden', /./u);
		await expect(lists.nth(0)).not.toHaveAttribute('inert');
		// The duplicate only closes the loop: inert and hidden from assistive technology.
		await expect(lists.nth(1)).toHaveAttribute('aria-hidden', 'true');
		await expect(lists.nth(1)).toHaveAttribute('inert');
		await expect(lists.nth(1).locator('> li')).toHaveCount(SESSIONS.length);

		// The heading and its line on the left, the loop on the right.
		const columns = await page.evaluate(() => {
			const intro = document.querySelector('.hours-band__intro')!.getBoundingClientRect();
			const body = document.querySelector('.hours-band__body')!.getBoundingClientRect();
			return { introRight: intro.right, bodyLeft: body.left };
		});
		expect(columns.bodyLeft).toBeGreaterThan(columns.introRight);

		// A window onto three rows, not the whole list.
		const sizes = await loop.evaluate((element) => ({
			window: element.clientHeight,
			list: element.querySelector('ol')!.getBoundingClientRect().height,
			overflow: getComputedStyle(element).overflowY,
		}));
		expect(sizes.overflow).toBe('hidden');
		expect(sizes.window).toBeGreaterThan(0);
		expect(sizes.window).toBeLessThan(sizes.list);

		const playState = () => track.evaluate((element) => getComputedStyle(element).animationPlayState);
		expect(await track.evaluate((element) => getComputedStyle(element).animationName)).toBe('hours-loop');
		await page.mouse.move(0, 0);
		await expect.poll(playState).toBe('running');

		await loop.hover();
		await expect.poll(playState).toBe('paused');
		await page.mouse.move(0, 0);
		await expect.poll(playState).toBe('running');

		const firstRsvp = lists.nth(0).getByRole('button', { name: `RSVP for ${SESSIONS[0][1]}` });
		await firstRsvp.focus();
		await expect.poll(playState).toBe('paused');
		await firstRsvp.blur();
		await expect.poll(playState).toBe('running');

		const pause = band(page).getByRole('button', { name: 'Pause the list' });
		await pause.click();
		await expect(pause).toHaveAttribute('aria-pressed', 'true');
		await pause.blur();
		await page.mouse.move(0, 0);
		await expect.poll(playState).toBe('paused');
		await pause.click();
		await expect(pause).toHaveAttribute('aria-pressed', 'false');
		await pause.blur();
		await page.mouse.move(0, 0);
		await expect.poll(playState).toBe('running');

		// Keyboard: from the pause button, Tab reaches each row once, in the
		// first copy, and then leaves the band; the duplicate is never a stop.
		await pause.focus();
		const stops: Array<{ inBand: boolean; inDuplicate: boolean; label: string | null }> = [];
		for (let step = 0; step < SESSIONS.length + 1; step += 1) {
			await page.keyboard.press('Tab');
			stops.push(
				await page.evaluate(() => {
					const active = document.activeElement;
					return {
						inBand: active?.closest('#hours') !== null,
						inDuplicate: active?.closest('[inert], [aria-hidden="true"]') !== null,
						label: active?.getAttribute('aria-label') ?? null,
					};
				}),
			);
		}
		expect(stops.some((stop) => stop.inDuplicate)).toBe(false);
		expect(stops.slice(0, SESSIONS.length).map((stop) => stop.label)).toEqual(
			SESSIONS.map(([, label]) => `RSVP for ${label}`),
		);
		expect(stops[SESSIONS.length].inBand).toBe(false);

		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
	});

	test('a list that fits the window is shown whole at 48rem and up, without a loop', async ({ page }) => {
		await withSessions(page, NOW, [FIXTURE[1]]);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
		await expect(band(page).locator('.hours-list > li time')).toHaveText([SESSIONS[0][1], SESSIONS[2][1]]);
		await expect(band(page).locator('.hours-loop, [inert]')).toHaveCount(0);
		await expect(band(page).getByRole('button', { name: 'Pause the list' })).toHaveCount(0);
	});

	test('a session after the change to standard time carries its own offset', async ({ page }) => {
		// From Tuesday 20 October the Monday series has ended; the four
		// Thursdays cross the 1 November change from -04:00 to -05:00.
		await withSessions(page, new Date('2026-10-20T16:00:00Z'));
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
		const times = band(page).locator('.hours-list > li time');
		await expect(times).toHaveText([
			'Thursday 22 October, 3 to 4 PM ET',
			'Thursday 29 October, 3 to 4 PM ET',
			'Thursday 5 November, 3 to 4 PM ET',
			'Thursday 12 November, 3 to 4 PM ET',
		]);
		await expect(times.nth(1)).toHaveAttribute('datetime', '2026-10-29T15:00-04:00');
		await expect(times.nth(2)).toHaveAttribute('datetime', '2026-11-05T15:00-05:00');
	});
});
