import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipHomeIntro } from './support/intro';
import { installExternalGuard, stubAnonymousManifest, stubChallenge } from './support/network';

import { HOURS_FIXTURE_GLOBAL, MARQUEE_RESUME_MS } from '../src/lib/hours-band';
import { publicHoursSlots } from '../src/lib/public-hours';
import { buildRsvpMailtoHref, RSVP_OPEN_EVENT } from '../src/lib/rsvp-form';

// Work sessions on the bus (operator interview 2026-10-02, layout revised the
// same day): on the home page the band sits between the FAQ and the log, on
// the shared glass with yellow accents only. The served HTML is clock-free;
// dates expand on the visitor's clock after mount. At every width the dated
// cards are a marquee that scrolls right to left over a duplicated track,
// once one copy fills the band. It is a real horizontal scroller (a finger
// or trackpad moves it), and with no on-screen control it holds still under
// a mouse, while keyboard focus is inside, while a press is held, for a few
// seconds after a hand scroll, and while the RSVP dialog is open. Reduced
// motion and no-JS get the static list; the document never widens. On the
// log pages the same band is a sticky right-hand aside on desktop and the
// marquee above the list on phones and tablets.
//
// Both slots are published (decision 0032): the real content rows run on a
// fixed clock, which is what the visitor's clock would read. The layout rows
// below still run on the band's test hook (window.__gftbHoursFixture,
// published slots that pass the content schema), and the empty state runs on
// an empty fixture, since the real page is no longer empty.

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
	await stubAnonymousManifest(page);
});

// Between the FAQ and the log, not under the hero, and the document never widens.
async function expectPlacement(page: Page) {
	const order = await page.evaluate(() => [
		document.querySelector('.page-shell')?.firstElementChild?.id,
		document.querySelector('.page-shell > #faq + #hours + #log') !== null,
	]);
	expect(order).toEqual(['goals', true]);
	expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
}

const marquee = (root: Locator) => root.locator('.hours-marquee');
const marqueeState = (root: Locator) => marquee(root).getAttribute('data-marquee-state');
const scrollOffset = (root: Locator) => marquee(root).evaluate((element) => element.scrollLeft);
const firstCopy = (root: Locator) => marquee(root).locator('.hours-marquee__list:not(.hours-marquee__dup)');

// Right to left: the scroller's offset grows, so the cards move left. Read
// modulo one copy, since the offset wraps back by exactly one copy (the
// seamless loop). The marquee runs only while it is on screen.
async function expectMovingRightToLeft(root: Locator) {
	await marquee(root).scrollIntoViewIfNeeded();
	await expect.poll(() => marqueeState(root)).toBe('running');
	const copy = await firstCopy(root).evaluate((list) => (list as HTMLElement).offsetWidth);
	const before = await scrollOffset(root);
	const travelled = async () => ((await scrollOffset(root)) - before + copy) % copy;
	await expect.poll(travelled, { timeout: 5000 }).toBeGreaterThan(8);
	expect(await travelled()).toBeLessThan(copy / 2);
}

// Held: the state says so and, once any hand scroll has come to rest, the
// offset stays put.
async function expectHeld(root: Locator) {
	await expect.poll(() => marqueeState(root)).toBe('paused');
	const page = root.page();
	await expect
		.poll(async () => {
			const first = await scrollOffset(root);
			await page.waitForTimeout(150);
			return (await scrollOffset(root)) - first;
		})
		.toBe(0);
	const offset = await scrollOffset(root);
	await page.waitForTimeout(400);
	expect(await scrollOffset(root)).toBe(offset);
	expect(await marqueeState(root)).toBe('paused');
}

/** Indices of the controls in `list` that sit wholly inside the marquee's frame. */
function visibleButtons(list: Locator) {
	return list.evaluate((element) => {
		const frame = element.closest('.hours-marquee')!.getBoundingClientRect();
		return [...element.querySelectorAll('button')]
			.map((button, index) => ({ index, box: button.getBoundingClientRect() }))
			.filter(({ box }) => box.left >= frame.left && box.right <= frame.right)
			.map(({ index }) => index);
	});
}

/** The focused element sits wholly inside the given box. */
function focusedInside(box: Locator) {
	return box.evaluate((frame) => {
		const active = document.activeElement!.getBoundingClientRect();
		const region = frame.getBoundingClientRect();
		return (
			active.top >= region.top - 1 &&
			active.bottom <= region.bottom + 1 &&
			active.left >= region.left - 1 &&
			active.right <= region.right + 1
		);
	});
}

// Decision 0032 (operator interview 2026-10-02): both slots are published.
// The served HTML carries one clock-free rule row per slot, Monday first.
const RULES = [
	['monday-october', 'Mondays 5 and 12 October, 5 to 6 PM ET'],
	['thursday-weekly', 'Thursdays, 3 to 4 PM ET, from 8 October'],
] as const;

test.describe('the published content', () => {
	test('both slots are published, Monday first', () => {
		expect(publicHoursSlots.map((slot) => [slot.id, slot.published])).toEqual([
			['monday-october', true],
			['thursday-weekly', true],
		]);
	});

	test.describe('without JavaScript', () => {
		test.use({ javaScriptEnabled: false });

		test('shows the rule text with a mailto RSVP per slot, and no dates', async ({ page }) => {
			await page.goto('/');
			await expect(band(page)).toHaveAttribute('data-hours-mode', 'rules');
			await expect(band(page).getByRole('heading', { level: 2 })).toHaveText('Work sessions on the bus');
			const rows = band(page).locator('.hours-list > li');
			await expect(rows).toHaveCount(RULES.length);
			await expect(rows.locator('.hours-row__when')).toHaveText(RULES.map(([, rule]) => rule));
			await expect(band(page).locator('time, button, [inert], .hours-row__today')).toHaveCount(0);
			for (const [index, [slotId, rule]] of RULES.entries()) {
				await expect(rows.nth(index).getByRole('link', { name: `RSVP for ${rule}` })).toHaveAttribute(
					'href',
					buildRsvpMailtoHref('keyholders@latoolb.us', { slotId, label: rule }),
				);
			}
			await expect(rows.nth(0)).toContainText('2 Mondays');
			await expect(rows.nth(1)).toContainText('Weekly');
			for (const index of [0, 1]) {
				await expect(rows.nth(index)).toContainText('With Jess');
				await expect(rows.nth(index)).toContainText('On the bus');
			}
			await expect(band(page)).not.toContainText(EMPTY_TEXT);
			await expectPlacement(page);
		});
	});

	test('at 2026-10-02T16:00Z the rows are Monday 5, Thursday 8 and Monday 12 October onward', async ({ page }) => {
		await page.clock.setFixedTime(NOW);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
		const rows = band(page).locator('.hours-list > li');
		await expect(rows).toHaveCount(SESSIONS.length);
		await expect(rows.locator('time')).toHaveText(SESSIONS.map(([, label]) => label));
		for (const [index, [, label, datetime]] of SESSIONS.entries()) {
			await expect(rows.nth(index).locator('time')).toHaveAttribute('datetime', datetime);
			await expect(rows.nth(index).getByRole('button', { name: `RSVP for ${label}` })).toBeVisible();
			await expect(rows.nth(index)).toContainText('With Jess');
		}
		await expect(rows.nth(0)).toContainText('2 Mondays');
		await expect(rows.nth(1)).toContainText('Weekly');
		await expectPlacement(page);
	});

	test('at 2026-10-13 the Monday series is exhausted and only Thursdays remain', async ({ page }) => {
		await page.clock.setFixedTime(new Date('2026-10-13T16:00:00Z'));
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
		const times = band(page).locator('.hours-list > li time');
		await expect(times).toHaveText([
			'Thursday 15 October, 3 to 4 PM ET',
			'Thursday 22 October, 3 to 4 PM ET',
			'Thursday 29 October, 3 to 4 PM ET',
			'Thursday 5 November, 3 to 4 PM ET',
		]);
		await expect(times.nth(3)).toHaveAttribute('datetime', '2026-11-05T15:00-05:00');
		await expect(band(page)).not.toContainText('Monday');
	});

	// The static list (reduced motion, forced colours) shows every row, so the
	// server render reserves the whole clock-free bound for it whenever scripts
	// run: when the rows swap in, the section after the band (the log, since
	// the band moved below the FAQ) moves by less than half a row (the reserve
	// is a per-row estimate). Without the reserve it moved down by four rows.
	for (const [name, media] of [
		['reduced motion', { reducedMotion: 'reduce' }],
		['forced colours', { reducedMotion: 'no-preference', forcedColors: 'active' }],
	] as const) {
		test(`with ${name} the swap after mount does not move the log section after the band`, async ({ page }) => {
			await page.clock.setFixedTime(NOW);
			await page.emulateMedia(media);
			await page.setViewportSize({ width: 1280, height: 900 });
			// Measured from the band's own top, so only the band's height counts.
			const nextTop = () =>
				page.evaluate(async () => {
					await document.fonts.ready;
					const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
					return top('#log') - top('#hours');
				});

			// First paint with scripts on but the bundle held back: the rule rows.
			const bundle = '**/_app/immutable/**/*.js';
			await page.route(bundle, (route) => route.abort());
			await page.goto('/');
			await expect(band(page)).toHaveAttribute('data-hours-mode', 'rules');
			expect(await page.evaluate(() => document.documentElement.classList.contains('js'))).toBe(true);
			const before = await nextTop();

			await page.unroute(bundle);
			await page.goto('/');
			await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
			await expect(band(page).locator('.hours-list > li')).toHaveCount(SESSIONS.length);
			const shift = (await nextTop()) - before;
			expect(shift).toBeGreaterThan(-40);
			expect(shift).toBeLessThan(40);
		});
	}

	test('on a phone the marquee carries both entries', async ({ page }) => {
		await page.clock.setFixedTime(NOW);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'marquee');
		const cards = band(page).locator('.hours-marquee__list:not(.hours-marquee__dup) > li');
		await expect(cards).toHaveCount(SESSIONS.length);
		await expect(band(page).locator('.hours-marquee__dup > li')).toHaveCount(SESSIONS.length);
		await expect(cards.locator('time')).toHaveText(SESSIONS.map(([, label]) => label));
		await expect(cards.filter({ hasText: '2 Mondays' })).toHaveCount(2);
		await expect(cards.filter({ hasText: 'Weekly' })).toHaveCount(4);
		await expectPlacement(page);
	});
});

test.describe('the empty state', () => {
	test('with nothing to show, says so and points at the contact form for a tour', async ({ page }) => {
		// The real page is no longer empty; an empty, schema-valid fixture
		// stands in for a schedule with no upcoming session.
		await withSessions(page, NOW, []);
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'empty');
		await expect(band(page).getByRole('heading', { level: 2 })).toHaveText('Work sessions on the bus');
		await expect(band(page)).toContainText(EMPTY_TEXT);
		await expect(band(page).getByRole('link', { name: 'contact form', exact: true })).toHaveAttribute(
			'href',
			'/contact',
		);
		await expect(band(page).locator('button, ol, [inert]')).toHaveCount(0);
		await expectPlacement(page);
	});
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
			await expect(band(page).locator('.hours-marquee, [inert], [aria-hidden="true"]')).toHaveCount(0);
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

	test('on desktop the cards sit on the glass in one row across the band, with no pause control', async ({ page }) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'marquee');
		await band(page).scrollIntoViewIfNeeded();
		const lists = marquee(band(page)).locator('.hours-marquee__track > ol');
		await expect(lists).toHaveCount(2);
		await expect(lists.nth(0).locator('> li')).toHaveCount(SESSIONS.length);
		await expect(lists.nth(0)).not.toHaveAttribute('aria-hidden', /./u);
		await expect(lists.nth(0)).not.toHaveAttribute('inert');
		// The duplicate only closes the loop: hidden from assistive technology
		// and out of the tab order, but not inert, so a visible RSVP in it
		// still takes a click (a later row).
		await expect(lists.nth(1)).toHaveAttribute('aria-hidden', 'true');
		await expect(lists.nth(1)).not.toHaveAttribute('inert');
		await expect(lists.nth(1).locator('> li')).toHaveCount(SESSIONS.length);
		const duplicateButtons = lists.nth(1).locator('button');
		await expect(duplicateButtons).toHaveCount(SESSIONS.length);
		expect(
			await duplicateButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('tabindex'))),
		).toEqual(SESSIONS.map(() => '-1'));
		await expect(lists.nth(1).locator('[data-rsvp-id]')).toHaveCount(0);
		await expect(lists.nth(0).locator('[data-rsvp-id]')).toHaveCount(SESSIONS.length);

		// Operator ruling 2026-10-02: nothing on screen stops it.
		await expect(band(page).getByRole('button', { name: /pause/iu })).toHaveCount(0);

		// The heading and its line above, the cards across the band beneath.
		const layout = await band(page).evaluate((element) => {
			const intro = element.querySelector('.hours-band__intro')!.getBoundingClientRect();
			const frame = element.querySelector('.hours-marquee')!.getBoundingClientRect();
			const card = element.querySelector('.hours-marquee__list > li')!.getBoundingClientRect();
			return { introBottom: intro.bottom, frameTop: frame.top, frameWidth: frame.width, card: card.width };
		});
		expect(layout.frameTop).toBeGreaterThanOrEqual(layout.introBottom - 1);
		expect(layout.frameWidth).toBeGreaterThan(layout.card * 3);

		// No yellow fill: the band is the hero's own glass, and so are the cards
		// (lighter); yellow is the cards' top rule, an accent.
		const paint = await band(page).evaluate((element) => {
			const probe = document.createElement('span');
			probe.style.color = 'var(--highlight)';
			element.append(probe);
			const yellow = getComputedStyle(probe).color;
			probe.remove();
			const card = getComputedStyle(element.querySelector('.hours-marquee__list > li')!);
			return {
				yellow,
				band: getComputedStyle(element).backgroundColor,
				hero: getComputedStyle(document.querySelector('.hero-glass')!).backgroundColor,
				card: card.backgroundColor,
				cardEdge: card.borderTopColor,
			};
		});
		expect(paint.band).toBe(paint.hero);
		expect(paint.band).not.toBe(paint.yellow);
		expect(paint.card).not.toBe(paint.yellow);
		expect(paint.cardEdge).toBe(paint.yellow);

		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
	});

	// Split from the row above so each stays inside the per-test budget on a
	// loaded lab host.
	test('on desktop the cards move right to left by script and hold under the mouse', async ({ page }) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'marquee');
		await band(page).scrollIntoViewIfNeeded();
		// Motion is the script's, on the scroller's own offset: no CSS animation runs
		// (the reveal's one-off transition is not an animation of the cards).
		expect(
			await page.evaluate(
				() =>
					document
						.getAnimations()
						.filter((a) => a instanceof CSSAnimation && (a.effect as KeyframeEffect | null)?.target?.closest('#hours'))
						.length,
			),
		).toBe(0);
		await page.mouse.move(0, 0);
		await expectMovingRightToLeft(band(page));

		await marquee(band(page)).hover();
		await expectHeld(band(page));
		await page.mouse.move(0, 0);
		await expectMovingRightToLeft(band(page));

		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
	});

	test('on desktop the keyboard reaches each card once, in view, and focus holds the cards', async ({ page }) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'marquee');
		await page.mouse.move(0, 0);

		// From the FAQ's pointer to the band, Tab reaches each card's RSVP once,
		// in the first copy, then leaves the band; the duplicate is never a stop.
		// Each focused card is brought wholly into view and the cards hold
		// still while focus is among them.
		await page.locator('#faq a[href="#hours"]').focus();
		const stops: Array<{ inBand: boolean; inDuplicate: boolean; label: string | null }> = [];
		for (let step = 0; step < SESSIONS.length + 1; step += 1) {
			await page.keyboard.press('Tab');
			if (step < SESSIONS.length) {
				await expect.poll(() => focusedInside(marquee(band(page)))).toBe(true);
				await expect.poll(() => marqueeState(band(page))).toBe('paused');
			}
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
		// Focus left: the cards move on.
		await expectMovingRightToLeft(band(page));

		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
	});

	test('a hand scroll moves the cards, holds them, and they move on after a short rest', async ({ page }) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'marquee');
		await band(page).scrollIntoViewIfNeeded();
		await page.mouse.move(0, 0);
		await expect.poll(() => marqueeState(band(page))).toBe('running');
		const before = await scrollOffset(band(page));
		// A sideways trackpad or wheel scroll over the cards, then the pointer leaves.
		const frame = (await marquee(band(page)).boundingBox())!;
		await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
		await page.mouse.wheel(300, 0);
		await page.mouse.move(0, 0);
		await expect.poll(() => scrollOffset(band(page))).toBeGreaterThan(before + 150);
		// Held by the hand scroll alone, through the rest that follows it.
		expect(await marqueeState(band(page))).toBe('paused');
		await page.waitForTimeout(1000);
		expect(await marqueeState(band(page))).toBe('paused');
		await expect.poll(() => marqueeState(band(page)), { timeout: MARQUEE_RESUME_MS + 4000 }).toBe('running');
		await expectMovingRightToLeft(band(page));
	});

	test('the open RSVP dialog holds the cards, sits above everything, and hands focus back', async ({
		page,
		baseURL,
	}) => {
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'marquee');

		// Hold the cards under the mouse so a moving button can be clicked.
		await marquee(band(page)).hover();
		await expect.poll(() => marqueeState(band(page))).toBe('paused');
		const list = firstCopy(band(page));
		const visible = await visibleButtons(list);
		expect(visible.length).toBeGreaterThan(0);
		const index = visible[0];
		const label = SESSIONS[index][1];
		const trigger = list.getByRole('button', { name: `RSVP for ${label}` });
		await trigger.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(label);

		// The mouse leaves the cards; the open dialog alone holds them.
		await page.mouse.move(4, 450);
		await expectHeld(band(page));

		// Above the header, the band's clip and every other layer: each corner
		// and the centre of the box hit the box itself, and it fits the viewport.
		const placement = await page.getByTestId('rsvp-dialog').evaluate((element) => {
			const box = element.getBoundingClientRect();
			const points = [
				[box.left + 4, box.top + 4],
				[box.right - 4, box.top + 4],
				[box.left + box.width / 2, box.top + box.height / 2],
				[box.left + 4, box.bottom - 4],
				[box.right - 4, box.bottom - 4],
			];
			return {
				fits: box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth,
				hits: points.map(([x, y]) => element.contains(document.elementFromPoint(x, y))),
				inBand: element.closest('#hours') !== null,
			};
		});
		expect(placement).toEqual({ fits: true, hits: [true, true, true, true, true], inBand: false });
		await expect(dialog.locator('altcha-widget')).toBeVisible();

		// Closing hands focus back to the trigger; it was clicked, not reached
		// by keyboard, so the cards move on once the dialog is gone.
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();
		await page.mouse.move(4, 450);
		await expectMovingRightToLeft(band(page));
	});

	test('an RSVP in the visible duplicate copy opens the dialog for its session', async ({ page, baseURL }) => {
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'marquee');
		const view = marquee(band(page));
		const lists = view.locator('.hours-marquee__track > ol');

		// Late in a pass the duplicate fills the band: hold the cards under the
		// mouse and bring the duplicate in, as a hand scroll would.
		await view.hover();
		await view.evaluate((element) => {
			element.scrollLeft = element.querySelector<HTMLElement>('.hours-marquee__list')!.offsetWidth;
		});
		const visible = await visibleButtons(lists.nth(1));
		expect(visible.length).toBeGreaterThan(0);
		const index = visible[0];
		const label = SESSIONS[index][1];

		await lists.nth(1).locator('button').nth(index).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(label);

		// Focus went to the same session's button in the first copy, and
		// comes back to it when the dialog closes.
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(lists.nth(0).getByRole('button', { name: `RSVP for ${label}` })).toBeFocused();
	});

	test('a list too short to fill the band is shown whole on desktop, without a marquee', async ({ page }) => {
		await withSessions(page, NOW, [FIXTURE[1]]);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'static');
		await expect(band(page).locator('.hours-list > li time')).toHaveText([SESSIONS[0][1], SESSIONS[2][1]]);
		await expect(band(page).locator('.hours-marquee, [inert], [aria-hidden="true"]')).toHaveCount(0);
		await expect(band(page).getByRole('button', { name: /pause/iu })).toHaveCount(0);
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

// A phone with a touchscreen: a finger holds the cards while it is down, and
// the scroller pans natively under it (the hand-scroll hold is the desktop
// row above: the harness's headless Chromium does not turn synthetic touch
// gestures into scrolls).
test.describe('on a touch phone', () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

	async function openOnPhone(page: Page) {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.goto('/');
		await expect(band(page)).toHaveAttribute('data-hours-mode', 'marquee');
		await band(page).scrollIntoViewIfNeeded();
		// A point on a card's date line: a tap there opens nothing.
		const when = await firstCopy(band(page)).evaluate((list) => {
			const frame = list.closest('.hours-marquee')!.getBoundingClientRect();
			const line = [...list.querySelectorAll('.hours-row__when')]
				.map((element) => element.getBoundingClientRect())
				.find((box) => box.left >= frame.left && box.left + 40 <= frame.right)!;
			return { x: Math.round(line.left + 20), y: Math.round(line.top + line.height / 2) };
		});
		return { point: when, client: await page.context().newCDPSession(page) };
	}

	test('the cards scroll right to left and a held finger stops them until it lifts', async ({ page }) => {
		const { point, client } = await openOnPhone(page);
		const geometry = await marquee(band(page)).evaluate((element) => ({
			overflowX: getComputedStyle(element).overflowX,
			touchAction: getComputedStyle(element).touchAction,
			width: element.clientWidth,
			cards: [...element.querySelectorAll('.hours-marquee__list > li')].map(
				(card) => card.getBoundingClientRect().width,
			),
		}));
		// A real scroller, and each card narrower than it, so the next one shows.
		expect(geometry.overflowX).toBe('auto');
		// A finger pans it sideways (and the page up and down) natively.
		expect(geometry.touchAction).toBe('pan-x pan-y');
		expect(geometry.cards.every((width) => width < geometry.width)).toBe(true);
		await expect(band(page).getByRole('button', { name: /pause/iu })).toHaveCount(0);
		await expectMovingRightToLeft(band(page));

		await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
		await expectHeld(band(page));
		await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expectMovingRightToLeft(band(page));
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
		await page.setViewportSize({ width: 320, height: 812 });
		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
	});
});

// The log pages (operator feedback 2026-10-02): the same band, as a sticky
// right-hand aside on desktop and as the home page's marquee above the list
// on phones and tablets. Breadcrumbs, pagination and the source link stay.
test.describe('on the log pages', () => {
	test('desktop: a sticky glass aside with its own scroll, beside the list, whose RSVP opens the dialog', async ({
		page,
		baseURL,
	}) => {
		await installExternalGuard(page, baseURL ?? 'http://localhost:3000');
		await stubChallenge(page);
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/log/');
		const aside = page.locator('aside#hours');
		await expect(aside).toBeVisible();
		await expect(aside).toHaveAttribute('data-hours-mode', 'static');
		await expect(aside.getByRole('heading', { level: 2 })).toHaveText('Work sessions on the bus');
		await expect(aside.locator('.hours-list > li time')).toHaveText(SESSIONS.map(([, label]) => label));
		await expect(aside.locator('.hours-marquee, [aria-hidden="true"]')).toHaveCount(0);
		await expect(page.locator('#hours-inline')).toBeHidden();
		await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
		await expect(page.locator('.log-list > li').first()).toBeVisible();

		const geometry = await page.evaluate(() => {
			const box = document.querySelector('aside#hours')!;
			const style = getComputedStyle(box);
			return {
				position: style.position,
				top: style.top,
				height: box.getBoundingClientRect().height,
				left: box.getBoundingClientRect().left,
				mainRight: document.querySelector('.log-layout__main')!.getBoundingClientRect().right,
				overflowY: getComputedStyle(box.querySelector('.hours-band__body')!).overflowY,
				background: style.backgroundColor,
				glass: getComputedStyle(document.querySelector('.site-footer')!).backgroundColor,
			};
		});
		expect(geometry.position).toBe('sticky');
		expect(geometry.top).toBe('88px');
		expect(geometry.overflowY).toBe('auto');
		expect(geometry.height).toBeLessThanOrEqual(900);
		expect(geometry.left).toBeGreaterThan(geometry.mainRight);
		expect(geometry.background).toBe(geometry.glass);

		// Scrolled down the page, the aside stays under the header.
		await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
		if ((await page.evaluate(() => window.scrollY)) > 120) {
			await expect.poll(() => aside.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(88);
		}

		const trigger = aside.getByRole('button', { name: `RSVP for ${SESSIONS[0][1]}` });
		await trigger.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(SESSIONS[0][1]);
		const hits = await page.getByTestId('rsvp-dialog').evaluate((element) => {
			const box = element.getBoundingClientRect();
			return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + 4));
		});
		expect(hits).toBe(true);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();
		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
	});

	test('phone: the home page marquee sits above the list, under the intro, and the aside is gone', async ({ page }) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/log/');
		const inline = page.locator('#hours-inline');
		await expect(inline).toBeVisible();
		await expect(inline).toHaveAttribute('data-hours-mode', 'marquee');
		await expect(page.locator('aside#hours')).toBeHidden();
		await expect(firstCopy(inline).locator('> li time')).toHaveText(SESSIONS.map(([, label]) => label));
		const order = await page.evaluate(() => {
			const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
			return {
				introBottom: top('.log-layout__main > p.muted').bottom,
				bandTop: top('#hours-inline').top,
				bandBottom: top('#hours-inline').bottom,
				listTop: top('.log-list').top,
			};
		});
		expect(order.bandTop).toBeGreaterThanOrEqual(order.introBottom);
		expect(order.listTop).toBeGreaterThanOrEqual(order.bandBottom);
		await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
		await inline.scrollIntoViewIfNeeded();
		await expectMovingRightToLeft(inline);
		expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
	});

	test('reduced motion: the phone band is the static list', async ({ page }) => {
		await withSessions(page);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/log/');
		const inline = page.locator('#hours-inline');
		await expect(inline).toHaveAttribute('data-hours-mode', 'static');
		await expect(inline.locator('.hours-list > li')).toHaveCount(SESSIONS.length);
		await expect(inline.locator('.hours-marquee')).toHaveCount(0);
	});
});
