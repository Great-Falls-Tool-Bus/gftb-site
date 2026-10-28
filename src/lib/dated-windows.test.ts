import { describe, expect, it } from 'vitest';

import { newYorkWallClock } from './hours-recurrence';
import { publishedGoalEntries } from './generated/goals-manifest';
import { publicHoursSlots } from './public-hours';
import { dayNumberToIsoDate, isoDateToDayNumber, lastOccurrenceDay, type PublicHoursSlot } from './public-hours-schema';

// A published page must not advertise a dated window that has already passed.
// The static build bakes goal windows into the HTML, so a stale one stays live
// until someone republishes. This suite reads the real clock on purpose: it
// fails on the first run after a dated window ends, which is the prompt to
// retire the goal or slot (delete the file, then rebuild the manifest).

const MONTHS = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december',
];

/** Every full "Month D, YYYY" date in `text`, as ISO dates. Partial dates are ignored. */
export function fullDatesIn(text: string): string[] {
	const found: string[] = [];
	const pattern = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, 'giu');
	for (const match of text.matchAll(pattern)) {
		const month = MONTHS.indexOf(match[1].toLowerCase()) + 1;
		found.push(`${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`);
	}
	return found;
}

/** Ids of goals whose every dated window is before `todayIso`. */
export function pastGoalWindows(
	goals: readonly { slug: string; metadata: { kind: string; window?: string } }[],
	todayIso: string,
): string[] {
	return goals
		.filter((goal) => goal.metadata.kind === 'goal' && goal.metadata.window)
		.filter((goal) => {
			const dates = fullDatesIn(goal.metadata.window ?? '');
			return dates.length > 0 && dates.every((date) => date < todayIso);
		})
		.map((goal) => goal.slug);
}

/** Ids of slots whose last session is before `todayIso`. Open weekly series never end. */
export function endedHoursSlots(slots: readonly PublicHoursSlot[], todayIso: string): string[] {
	const today = isoDateToDayNumber(todayIso);
	return slots
		.filter((slot) => {
			const last = lastOccurrenceDay(slot);
			return last !== null && last < today;
		})
		.map((slot) => slot.id);
}

const todayNewYork = () => newYorkWallClock(new Date()).slice(0, 10);

describe('the detector', () => {
	it('reads full dates and ignores partial ones', () => {
		expect(fullDatesIn('Sunday, September 20, 2026')).toEqual(['2026-09-20']);
		expect(fullDatesIn('Thursdays, 3 to 4 PM ET, from 8 October')).toEqual([]);
		expect(fullDatesIn('After September 4, 2026 or on March 9, 2027')).toEqual(['2026-09-04', '2027-03-09']);
	});

	it('flags a goal window that is in the past and keeps one that is not', () => {
		const goals = [
			{ slug: 'block-party', metadata: { kind: 'goal', window: 'Sunday, September 20, 2026' } },
			{ slug: 'later', metadata: { kind: 'goal', window: 'Saturday, November 14, 2026' } },
			{ slug: 'weekly', metadata: { kind: 'goal', window: 'Thursdays, 3 to 4 PM ET' } },
		];
		expect(pastGoalWindows(goals, '2026-10-28')).toEqual(['block-party']);
		expect(pastGoalWindows(goals, '2026-09-20')).toEqual([]);
	});

	it('flags an hours series whose last session has passed', () => {
		const series = {
			id: 'monday-october',
			weekday: 'monday',
			repeat: { kind: 'weekly', startsOn: '2026-10-05', count: 2 },
		} as PublicHoursSlot;
		const open = {
			id: 'thursday',
			weekday: 'thursday',
			repeat: { kind: 'weekly', startsOn: '2026-10-02' },
		} as PublicHoursSlot;
		expect(endedHoursSlots([series, open], dayNumberToIsoDate(isoDateToDayNumber('2026-10-13')))).toEqual([
			'monday-october',
		]);
		expect(endedHoursSlots([series, open], '2026-10-12')).toEqual([]);
	});
});

describe('the published content on the real clock', () => {
	it('has no goal whose dated window has passed', () => {
		expect(pastGoalWindows(publishedGoalEntries, todayNewYork())).toEqual([]);
	});

	it('has no published hours slot whose series has ended', () => {
		expect(endedHoursSlots(publicHoursSlots, todayNewYork())).toEqual([]);
	});
});
