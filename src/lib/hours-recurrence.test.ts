import { describe, expect, it } from 'vitest';

import { expandSlot, MAX_ROWS, newYorkOffset, newYorkWallClock, upcomingSessions } from './hours-recurrence';
import { assertPublicHoursSlot, type PublicHoursSlot } from './public-hours-schema';

const thursday = assertPublicHoursSlot({
	id: 'thursday-weekly',
	published: true,
	weekday: 'thursday',
	start: '15:00',
	end: '16:00',
	timezone: 'America/New_York',
	staff: ['Jess'],
	repeat: { kind: 'weekly', startsOn: '2026-10-02' },
	location: 'the bus',
});

const monday = assertPublicHoursSlot({
	id: 'monday-october',
	published: true,
	weekday: 'monday',
	start: '17:00',
	end: '18:00',
	timezone: 'America/New_York',
	staff: ['Jess'],
	repeat: { kind: 'weekly', startsOn: '2026-10-05', count: 2 },
	location: 'the bus',
});

const dates = (rows: ReturnType<typeof expandSlot>) => rows.map((row) => row.date);
const at = (iso: string) => new Date(iso);

describe('newYorkOffset', () => {
	it.each([
		['2026-10-29', '15:00', '-04:00'],
		['2026-11-05', '15:00', '-05:00'],
		['2027-03-11', '15:00', '-05:00'],
		['2027-03-18', '15:00', '-04:00'],
		// The changeover days themselves, after the 02:00 switch.
		['2026-11-01', '06:00', '-05:00'],
		['2027-03-14', '06:00', '-04:00'],
	])('%s %s is %s', (date, time, offset) => {
		expect(newYorkOffset(date, time)).toBe(offset);
	});
});

describe('newYorkWallClock', () => {
	it('reads the New York calendar date, not the UTC one', () => {
		expect(newYorkWallClock(at('2026-10-09T02:30:00Z'))).toBe('2026-10-08T22:30');
	});
});

describe('expandSlot', () => {
	it('a weekly series starting on Friday 2026-10-02 yields its first Thursday on 2026-10-08', () => {
		const rows = expandSlot(thursday, at('2026-10-02T16:00:00Z'));
		expect(dates(rows)).toEqual(['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
		expect(rows[0]).toMatchObject({
			id: 'thursday-weekly@2026-10-08',
			slotId: 'thursday-weekly',
			startIso: '2026-10-08T15:00-04:00',
			endIso: '2026-10-08T16:00-04:00',
			today: false,
			staff: ['Jess'],
			location: 'the bus',
		});
	});

	it('marks the session "today" at 2026-10-08 09:00 ET', () => {
		const rows = expandSlot(thursday, at('2026-10-08T13:00:00Z'));
		expect(rows[0]).toMatchObject({ date: '2026-10-08', today: true });
		expect(rows.slice(1).every((row) => !row.today)).toBe(true);
	});

	it('keeps a session that has started and drops it once it has ended', () => {
		expect(expandSlot(thursday, at('2026-10-08T19:30:00Z'))[0]).toMatchObject({ date: '2026-10-08', today: true });
		expect(dates(expandSlot(thursday, at('2026-10-08T20:00:00Z')))[0]).toBe('2026-10-15');
	});

	it('skip removes that Thursday', () => {
		const slot: PublicHoursSlot = { ...thursday, skip: ['2026-10-15'] };
		expect(dates(expandSlot(slot, at('2026-10-02T16:00:00Z')))).toEqual(['2026-10-08', '2026-10-22', '2026-10-29']);
	});

	it('resolves the offset per date across the November changeover', () => {
		const rows = expandSlot(thursday, at('2026-10-27T16:00:00Z'));
		expect(rows.map((row) => row.startIso)).toEqual([
			'2026-10-29T15:00-04:00',
			'2026-11-05T15:00-05:00',
			'2026-11-12T15:00-05:00',
			'2026-11-19T15:00-05:00',
		]);
	});

	it('resolves the offset per date across the March changeover', () => {
		const rows = expandSlot(thursday, at('2027-03-01T16:00:00Z'));
		expect(rows.map((row) => row.offset)).toEqual(['-05:00', '-05:00', '-04:00', '-04:00']);
	});

	it('a counted series ends after its count', () => {
		expect(dates(expandSlot(monday, at('2026-10-02T16:00:00Z')))).toEqual(['2026-10-05', '2026-10-12']);
		expect(expandSlot(monday, at('2026-10-13T16:00:00Z'))).toEqual([]);
	});

	it('a skipped date does not extend a counted series', () => {
		const slot: PublicHoursSlot = { ...monday, skip: ['2026-10-05'] };
		expect(dates(expandSlot(slot, at('2026-10-02T16:00:00Z')))).toEqual(['2026-10-12']);
	});

	it('an until series stops on or before its until date', () => {
		const slot: PublicHoursSlot = {
			...thursday,
			repeat: { kind: 'weekly', startsOn: '2026-10-02', until: '2026-10-21' },
		};
		expect(dates(expandSlot(slot, at('2026-10-02T16:00:00Z')))).toEqual(['2026-10-08', '2026-10-15']);
	});

	it('a once slot yields its one date', () => {
		const slot: PublicHoursSlot = { ...thursday, repeat: { kind: 'once', startsOn: '2026-10-22' } };
		expect(dates(expandSlot(slot, at('2026-10-02T16:00:00Z')))).toEqual(['2026-10-22']);
	});

	it('looks four weeks ahead by default and never returns more than six rows', () => {
		expect(expandSlot(thursday, at('2026-10-02T16:00:00Z')).length).toBe(4);
		expect(expandSlot(thursday, at('2026-10-02T16:00:00Z'), 365).length).toBe(MAX_ROWS);
	});

	it('shows nothing before a series is within the horizon', () => {
		const slot: PublicHoursSlot = { ...thursday, repeat: { kind: 'weekly', startsOn: '2027-01-01' } };
		expect(expandSlot(slot, at('2026-10-02T16:00:00Z'))).toEqual([]);
	});
});

describe('upcomingSessions', () => {
	it('merges every slot soonest first, at most six rows', () => {
		const rows = upcomingSessions([thursday, monday], at('2026-10-02T16:00:00Z'));
		expect(rows.map((row) => row.id)).toEqual([
			'monday-october@2026-10-05',
			'thursday-weekly@2026-10-08',
			'monday-october@2026-10-12',
			'thursday-weekly@2026-10-15',
			'thursday-weekly@2026-10-22',
			'thursday-weekly@2026-10-29',
		]);
	});

	it('is empty when nothing is scheduled', () => {
		expect(upcomingSessions([], at('2026-10-02T16:00:00Z'))).toEqual([]);
	});
});
