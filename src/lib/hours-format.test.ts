import { describe, expect, it } from 'vitest';

import {
	finiteSeriesDates,
	formatDateList,
	formatDateWords,
	formatRepeat,
	formatRuleText,
	formatSessionLabel,
	formatStaff,
	formatTimeRange,
	formatLocation,
	joinWords,
} from './hours-format';
import { assertPublicHoursSlot, type PublicHoursSlot } from './public-hours-schema';

function slot(overrides: Record<string, unknown> = {}): PublicHoursSlot {
	return assertPublicHoursSlot({
		id: 'thursday-weekly',
		published: true,
		weekday: 'thursday',
		start: '15:00',
		end: '16:00',
		timezone: 'America/New_York',
		staff: ['Jess'],
		repeat: { kind: 'weekly', startsOn: '2026-10-02' },
		location: 'the bus',
		...overrides,
	});
}

describe('formatTimeRange', () => {
	it.each([
		['15:00', '16:00', '3 to 4 PM ET'],
		['17:00', '18:00', '5 to 6 PM ET'],
		['09:30', '11:00', '9:30 to 11 AM ET'],
		['11:00', '13:30', '11 AM to 1:30 PM ET'],
		['12:00', '13:00', '12 to 1 PM ET'],
		['06:00', '07:15', '6 to 7:15 AM ET'],
		['22:00', '23:00', '10 to 11 PM ET'],
	])('%s to %s reads "%s"', (start, end, words) => {
		expect(formatTimeRange(start, end)).toBe(words);
	});
});

describe('dates in words', () => {
	it('writes the weekday, the day and the month, never a year', () => {
		expect(formatDateWords('2026-10-08')).toBe('Thursday 8 October');
		expect(formatDateWords('2026-11-01')).toBe('Sunday 1 November');
		expect(formatDateWords('2027-03-14')).toBe('Sunday 14 March');
	});

	it('lists dates in one month once and spells out a month change', () => {
		expect(formatDateList(['2026-10-05'])).toBe('5 October');
		expect(formatDateList(['2026-10-05', '2026-10-12'])).toBe('5 and 12 October');
		expect(formatDateList(['2026-10-05', '2026-10-12', '2026-10-19'])).toBe('5, 12 and 19 October');
		expect(formatDateList(['2026-10-26', '2026-11-02'])).toBe('26 October and 2 November');
		expect(formatDateList([])).toBe('');
	});

	it('joins words with commas and a final and', () => {
		expect(joinWords([])).toBe('');
		expect(joinWords(['Jess'])).toBe('Jess');
		expect(joinWords(['Jess', 'Sam'])).toBe('Jess and Sam');
		expect(joinWords(['A', 'B', 'C'])).toBe('A, B and C');
	});
});

describe('row words', () => {
	it('names the staffer by first name, or a keyholder when nobody is named', () => {
		expect(formatStaff(['Jess'])).toBe('With Jess');
		expect(formatStaff([])).toBe('With a keyholder');
	});

	it('says where only as "On the bus"', () => {
		expect(formatLocation('the bus')).toBe('On the bus');
		expect(formatLocation(undefined)).toBeUndefined();
	});

	it('says Weekly for an open series, the count for a finite one, Once for a single session', () => {
		expect(formatRepeat(slot())).toBe('Weekly');
		expect(
			formatRepeat(
				slot({ id: 'monday-october', weekday: 'monday', repeat: { kind: 'weekly', startsOn: '2026-10-05', count: 2 } }),
			),
		).toBe('2 Mondays');
		expect(formatRepeat(slot({ repeat: { kind: 'weekly', startsOn: '2026-10-02', until: '2026-10-29' } }))).toBe(
			'4 Thursdays',
		);
		expect(formatRepeat(slot({ repeat: { kind: 'once', startsOn: '2026-10-08' } }))).toBe('Once');
		expect(
			formatRepeat(slot({ repeat: { kind: 'weekly', startsOn: '2026-10-02', count: 2 }, skip: ['2026-10-15'] })),
		).toBe('Once');
	});

	it('labels a dated session for its row and its RSVP', () => {
		expect(formatSessionLabel({ date: '2026-10-08', start: '15:00', end: '16:00' })).toBe(
			'Thursday 8 October, 3 to 4 PM ET',
		);
	});
});

describe('formatRuleText (the clock-free server render)', () => {
	it('starts an open series at its first generated date, not at startsOn', () => {
		// startsOn 2026-10-02 is a Friday; the first Thursday is 8 October.
		expect(formatRuleText(slot())).toBe('Thursdays, 3 to 4 PM ET, from 8 October');
	});

	it('names the skipped dates of an open series', () => {
		expect(formatRuleText(slot({ skip: ['2026-10-22', '2026-10-15'] }))).toBe(
			'Thursdays, 3 to 4 PM ET, from 8 October, except 15 and 22 October',
		);
	});

	it('lists the dates of a short finite series', () => {
		expect(
			formatRuleText(
				slot({
					id: 'monday-october',
					weekday: 'monday',
					start: '17:00',
					end: '18:00',
					repeat: { kind: 'weekly', startsOn: '2026-10-05', count: 2 },
				}),
			),
		).toBe('Mondays 5 and 12 October, 5 to 6 PM ET');
	});

	it('writes a single session as its date', () => {
		expect(formatRuleText(slot({ repeat: { kind: 'once', startsOn: '2026-10-08' } }))).toBe(
			'Thursday 8 October, 3 to 4 PM ET',
		);
		expect(
			formatRuleText(slot({ repeat: { kind: 'weekly', startsOn: '2026-10-02', count: 2 }, skip: ['2026-10-08'] })),
		).toBe('Thursday 15 October, 3 to 4 PM ET');
	});

	it('gives a long finite series its span and the dates it skips', () => {
		expect(
			formatRuleText(slot({ repeat: { kind: 'weekly', startsOn: '2026-10-02', count: 10 }, skip: ['2026-10-22'] })),
		).toBe('Thursdays, 3 to 4 PM ET, 8 October to 10 December, except 22 October');
	});

	it('has nothing to say when every session of a finite series is skipped', () => {
		expect(formatRuleText(slot({ repeat: { kind: 'once', startsOn: '2026-10-08' }, skip: ['2026-10-08'] }))).toBeNull();
	});

	it('reads no clock: the same slot gives the same words', () => {
		const words = formatRuleText(slot());
		expect(formatRuleText(slot())).toBe(words);
		expect(finiteSeriesDates(slot())).toBeNull();
	});

	it('never writes an em dash', () => {
		for (const text of [
			formatRuleText(slot()),
			formatRuleText(slot({ skip: ['2026-10-15'] })),
			formatRepeat(slot()),
			formatStaff([]),
			formatTimeRange('11:00', '13:30'),
		]) {
			expect(text).not.toContain(String.fromCharCode(0x2014));
		}
	});
});
