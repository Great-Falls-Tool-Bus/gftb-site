import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	chooseHoursMode,
	datedRows,
	hoursFixtureSlots,
	LOOP_VISIBLE_ROWS,
	reserveRows,
	rowsOnVisitorClock,
	ruleRows,
	type HoursModeInput,
} from './hours-band';
import { upcomingSessions } from './hours-recurrence';
import { publicHoursSlots } from './public-hours';
import { assertPublicHoursSlot } from './public-hours-schema';

const thursdayInput = {
	id: 'thursday-weekly',
	published: true,
	weekday: 'thursday',
	start: '15:00',
	end: '16:00',
	timezone: 'America/New_York',
	staff: ['Jess'],
	repeat: { kind: 'weekly', startsOn: '2026-10-02' },
	location: 'the bus',
};
const mondayInput = {
	id: 'monday-october',
	published: true,
	weekday: 'monday',
	start: '17:00',
	end: '18:00',
	timezone: 'America/New_York',
	staff: [],
	repeat: { kind: 'weekly', startsOn: '2026-10-05', count: 2 },
	location: 'the bus',
	notes: 'We start with a short safety walk-through.',
};
const thursday = assertPublicHoursSlot(thursdayInput);
const monday = assertPublicHoursSlot(mondayInput);

describe('chooseHoursMode', () => {
	const at = (overrides: Partial<HoursModeInput>): HoursModeInput => ({
		rows: 6,
		wide: true,
		reducedMotion: false,
		forcedColors: false,
		...overrides,
	});

	it('shows the empty state with no rows, whatever the media', () => {
		expect(chooseHoursMode(at({ rows: 0 }))).toBe('empty');
		expect(chooseHoursMode(at({ rows: 0, wide: false, reducedMotion: true }))).toBe('empty');
	});

	it('loops at 48rem and up only when the list is longer than the window', () => {
		expect(chooseHoursMode(at({ rows: LOOP_VISIBLE_ROWS + 1 }))).toBe('loop');
		expect(chooseHoursMode(at({ rows: LOOP_VISIBLE_ROWS }))).toBe('static');
		expect(chooseHoursMode(at({ rows: 1 }))).toBe('static');
	});

	it('is a carousel under 48rem once there is more than one card', () => {
		expect(chooseHoursMode(at({ wide: false, rows: 2 }))).toBe('carousel');
		expect(chooseHoursMode(at({ wide: false, rows: 1 }))).toBe('static');
	});

	it('stands every enhancement down under reduced motion and forced colours', () => {
		for (const wide of [true, false]) {
			expect(chooseHoursMode(at({ wide, reducedMotion: true }))).toBe('static');
			expect(chooseHoursMode(at({ wide, forcedColors: true }))).toBe('static');
		}
	});
});

describe('rows', () => {
	it('renders one clock-free rule row per slot on the server', () => {
		expect(ruleRows([monday, thursday])).toEqual([
			{
				id: 'monday-october',
				when: 'Mondays 5 and 12 October, 5 to 6 PM ET',
				repeat: '2 Mondays',
				staff: 'With a keyholder',
				location: 'On the bus',
				notes: 'We start with a short safety walk-through.',
				today: false,
			},
			{
				id: 'thursday-weekly',
				when: 'Thursdays, 3 to 4 PM ET, from 8 October',
				repeat: 'Weekly',
				staff: 'With Jess',
				location: 'On the bus',
				today: false,
			},
		]);
		expect(ruleRows([])).toEqual([]);
	});

	it('turns the visitor-clock expansion into dated rows with their offsets and slot references', () => {
		const slots = [thursday, monday];
		const rows = datedRows(upcomingSessions(slots, new Date('2026-10-02T16:00:00Z')), slots);
		expect(rows.map((row) => [row.id, row.when, row.datetime, row.repeat, row.staff])).toEqual([
			[
				'monday-october@2026-10-05',
				'Monday 5 October, 5 to 6 PM ET',
				'2026-10-05T17:00-04:00',
				'2 Mondays',
				'With a keyholder',
			],
			[
				'thursday-weekly@2026-10-08',
				'Thursday 8 October, 3 to 4 PM ET',
				'2026-10-08T15:00-04:00',
				'Weekly',
				'With Jess',
			],
			[
				'monday-october@2026-10-12',
				'Monday 12 October, 5 to 6 PM ET',
				'2026-10-12T17:00-04:00',
				'2 Mondays',
				'With a keyholder',
			],
			[
				'thursday-weekly@2026-10-15',
				'Thursday 15 October, 3 to 4 PM ET',
				'2026-10-15T15:00-04:00',
				'Weekly',
				'With Jess',
			],
			[
				'thursday-weekly@2026-10-22',
				'Thursday 22 October, 3 to 4 PM ET',
				'2026-10-22T15:00-04:00',
				'Weekly',
				'With Jess',
			],
			[
				'thursday-weekly@2026-10-29',
				'Thursday 29 October, 3 to 4 PM ET',
				'2026-10-29T15:00-04:00',
				'Weekly',
				'With Jess',
			],
		]);
		expect(rows.every((row) => row.location === 'On the bus' && !row.today)).toBe(true);
		expect(rows[0].notes).toBe(mondayInput.notes);
		expect(rows[1].notes).toBeUndefined();
	});

	it('marks the session on the current New York day as today', () => {
		const rows = datedRows(upcomingSessions([thursday], new Date('2026-10-08T13:00:00Z')), [thursday]);
		expect(rows[0]).toMatchObject({ id: 'thursday-weekly@2026-10-08', today: true });
		expect(rows.slice(1).some((row) => row.today)).toBe(false);
	});
});

describe('rowsOnVisitorClock', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("expands on the clock it runs under, which in the band is the visitor's", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-02T16:00:00Z'));
		const slots = [thursday, monday];
		expect(rowsOnVisitorClock(slots)).toEqual(
			datedRows(upcomingSessions(slots, new Date('2026-10-02T16:00:00Z')), slots),
		);
		vi.setSystemTime(new Date('2026-10-20T16:00:00Z'));
		expect(rowsOnVisitorClock(slots).map((row) => row.id)).toEqual([
			'thursday-weekly@2026-10-22',
			'thursday-weekly@2026-10-29',
			'thursday-weekly@2026-11-05',
			'thursday-weekly@2026-11-12',
		]);
	});
});

describe('reserveRows (the clock-free room the server keeps)', () => {
	it('bounds each slot by the weeks in the horizon and the band by six rows', () => {
		expect(reserveRows([])).toBe(0);
		expect(reserveRows([thursday])).toBe(4);
		expect(reserveRows([monday])).toBe(2);
		expect(reserveRows([thursday, monday])).toBe(6);
		expect(reserveRows([thursday, thursday])).toBe(6);
	});

	it('is never smaller than what the visitor clock can expand', () => {
		const slots = [thursday, monday];
		for (const iso of [
			'2026-09-30T12:00:00Z',
			'2026-10-02T16:00:00Z',
			'2026-10-13T12:00:00Z',
			'2026-11-20T12:00:00Z',
		]) {
			expect(upcomingSessions(slots, new Date(iso)).length).toBeLessThanOrEqual(reserveRows(slots));
		}
	});
});

describe('the server render is clock-free', () => {
	const savedTz = process.env.TZ;

	afterEach(() => {
		vi.useRealTimers();
		if (savedTz === undefined) delete process.env.TZ;
		else process.env.TZ = savedTz;
	});

	// What the prerendered home HTML is built from: the rule rows and the
	// reserve, for the published content and for the fixtures above. The
	// cached build must not bake in the build day.
	function serverRender() {
		return JSON.stringify([publicHoursSlots, [thursday, monday]].map((slots) => [ruleRows(slots), reserveRows(slots)]));
	}

	it('renders identical rows under two wall clocks and two time zones', () => {
		vi.useFakeTimers();
		process.env.TZ = 'UTC';
		vi.setSystemTime(new Date('2026-10-02T16:00:00Z'));
		const first = serverRender();
		process.env.TZ = 'Pacific/Auckland';
		vi.setSystemTime(new Date('2027-03-14T06:30:00Z'));
		const second = serverRender();
		expect(second).toBe(first);
		expect(first).not.toContain('"datetime"');
		expect(first).toContain('Thursdays, 3 to 4 PM ET');
	});

	it('reads no clock and no locale on the server path', () => {
		const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');
		const clockOrLocale = /Date\.now\(|new Date\(|performance\.now\(|toLocale|Intl\./u;
		for (const file of ['hours-format.ts', 'public-hours.ts', 'components/HoursBand.svelte']) {
			expect(read(file), file).not.toMatch(clockOrLocale);
		}
		// hours-band.ts reads the visitor's clock in rowsOnVisitorClock only.
		const band = read('hours-band.ts');
		for (const name of ['ruleRows', 'reserveRows', 'datedRows', 'chooseHoursMode']) {
			const start = band.indexOf(`export function ${name}(`);
			expect(start, name).toBeGreaterThanOrEqual(0);
			const end = band.indexOf('\n}\n', start);
			expect(band.slice(start, end), name).not.toMatch(clockOrLocale);
		}
	});
});

describe('hoursFixtureSlots (the test and LOOK hook)', () => {
	it('takes published slots that pass the content schema', () => {
		expect(hoursFixtureSlots([thursdayInput, mondayInput])).toEqual([thursday, monday]);
		expect(hoursFixtureSlots([])).toEqual([]);
	});

	it('fails closed on anything else', () => {
		expect(hoursFixtureSlots(undefined)).toBeNull();
		expect(hoursFixtureSlots({ slots: [thursdayInput] })).toBeNull();
		expect(hoursFixtureSlots([{ ...thursdayInput, published: false }])).toBeNull();
		expect(hoursFixtureSlots([{ ...thursdayInput, location: 'a parking lot' }])).toBeNull();
		expect(hoursFixtureSlots([{ ...thursdayInput, staff: ['Someone Else'] }])).toBeNull();
		expect(hoursFixtureSlots([{ ...thursdayInput, extra: true }])).toBeNull();
	});
});
